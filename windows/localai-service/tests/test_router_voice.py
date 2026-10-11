"""Real loopback HTTP voice contracts with isolated, synthetic voice/provider stubs."""
from __future__ import annotations

import base64
import http.client
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch
import wave

SERVICE = Path(__file__).resolve().parents[1]
TMP = SERVICE.parents[1] / 'tmp' / 'voice-http-tests'
TMP.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(SERVICE / 'src'))
from voice_tools import VoiceTools, VoiceError


def audio():
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(b'\x20\x03' * 1600)
    return stream.getvalue()


class SyntheticVoice:
    """Use production payload validation, but never load a decoder or audio device."""
    def __init__(self, root):
        self.root, self.halted, self.calls = root, False, []
        self.stop_calls, self.resume_calls, self.generation = 0, 0, 0
        self.failure = None

    def _stopped(self):
        return self.halted or (self.root / 'runtime' / 'emergency-stop').exists()

    def status(self):
        return {'ok': True, 'voice_api': 1, 'available': True, 'tts_available': True,
                'languages': ['uz', 'en', 'ru'], 'halted': self._stopped(), 'offline': True}

    def transcribe(self, payload):
        if self._stopped():
            raise VoiceError('Stop faol', 'voice_cancelled')
        _, duration, language, request_id, _ = VoiceTools._audio(payload)
        self.calls.append('transcribe')
        if self.failure:
            raise self.failure
        return {'ok': True, 'voice_api': 1, 'text': 'synthetic private transcript', 'language': language,
                'model': 'base', 'engine': 'whisper.cpp', 'duration_seconds': duration, 'processing_ms': 1,
                'speech_detected': True, 'execution_performed': False, 'request_id': request_id}

    def speak(self, payload):
        if self._stopped():
            raise VoiceError('Stop faol', 'voice_cancelled')
        _, language, request_id = VoiceTools._speech(payload)
        self.calls.append('speak')
        return {'ok': True, 'voice_api': 1, 'audio_base64': base64.b64encode(audio()).decode('ascii'),
                'format': 'wav', 'language': language, 'engine': 'espeak-ng', 'duration_seconds': .1,
                'sample_rate': 16000, 'processing_ms': 1, 'execution_performed': False, 'request_id': request_id}

    def stop(self):
        self.stop_calls += 1
        self.halted = True
        self.generation += 1

    def resume(self):
        if (self.root / 'runtime' / 'emergency-stop').exists():
            raise VoiceError('Stop faol', 'voice_cancelled')
        self.resume_calls += 1
        self.halted = False
        self.generation += 1


class RouterVoiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='voice-http-', dir=TMP)
        self.root = Path(self.temp.name)
        for name in ('runtime', 'config', 'logs', 'workspace'):
            (self.root / name).mkdir()
        with patch.dict(os.environ, {'COUCOU_LOCALAI_DATA_DIR': str(self.root),
                                     'APPDATA': str(self.root / 'roaming'),
                                     'LOCALAPPDATA': str(self.root / 'local'), 'LOCALAI_OLLAMA_PORT': '11434'}):
            spec = importlib.util.spec_from_file_location('isolated_voice_router', SERVICE / 'src' / 'router.py')
            self.router = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.router)
        self.router.BROKER = Mock()
        self.router.BROKER.available.return_value = {'selected': 'auto', 'configured': {}, 'order': []}
        self.router.BROKER.last_model = None
        self.router.loaded = Mock(return_value=[])
        self.router.unload = Mock()
        self.router.log = Mock()
        self.stub = SyntheticVoice(self.root)
        self.factory = patch('voice_tools.VoiceTools', return_value=self.stub)
        self.factory_mock = self.factory.start()
        self.server = self.router.ThreadingHTTPServer(('127.0.0.1', 0), self.router.Handler)
        self.server.daemon_threads = True
        self.router.PORT = self.server.server_port
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .02}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        self.factory.stop()
        self.temp.cleanup()

    def request(self, method, path, payload=None, headers=None, raw=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.router.PORT, timeout=3)
        body = raw if raw is not None else (None if payload is None else json.dumps(payload).encode('utf-8'))
        values = {'Content-Type': 'application/json'}
        if headers:
            values.update(headers)
        try:
            connection.request(method, path, body=body, headers=values)
            response = connection.getresponse()
            return response.status, json.loads(response.read()), dict(response.getheaders())
        finally:
            connection.close()

    def post(self, path, payload, **options):
        return self.request('POST', path, payload, headers={'X-LocalAI-Control': '1'}, **options)

    def test_health_and_status_advertise_voice_without_provider_calls(self):
        status, health, _ = self.request('GET', '/health')
        self.assertEqual(status, 200)
        self.assertEqual(health['capabilities']['voice_api'], 1)
        status, voice, headers = self.request('GET', '/voice/status')
        self.assertEqual(status, 200)
        self.assertEqual(voice['voice_api'], 1)
        self.assertTrue(voice['offline'])
        self.assertTrue(voice['available'])
        self.assertTrue(voice['tts_available'])
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(self.stub.calls, [])
        self.factory_mock.assert_called_once_with(self.root)

    def test_origin_host_and_control_header_reject_before_voice_creation(self):
        for path in ('/voice/transcribe', '/voice/speak', '/voice/cancel'):
            for headers in ({}, {'X-LocalAI-Control': '0'}, {'X-LocalAI-Control': '1', 'Origin': 'https://invalid.test'},
                            {'X-LocalAI-Control': '1', 'Host': 'invalid.test'}):
                status, _, _ = self.request('POST', path, {}, headers)
                self.assertEqual(status, 403)
        for headers in ({'Origin': 'null'}, {'Origin': 'https://invalid.test'}, {'Host': 'invalid.test'}):
            self.assertEqual(self.request('GET', '/voice/status', headers=headers)[0], 403)
        self.factory_mock.assert_not_called()
        self.assertEqual(self.stub.calls, [])

    def test_exact_utterance_and_literal_speech_dtos_are_returned_without_logging(self):
        encoded = base64.b64encode(audio()).decode('ascii')
        status, heard, _ = self.post('/voice/transcribe', {'audio_base64': encoded, 'duration_seconds': .1,
                                                       'language': 'uz', 'request_id': 'voice-1'})
        self.assertEqual(status, 200)
        self.assertEqual(heard['text'], 'synthetic private transcript')
        self.assertFalse(heard['execution_performed'])
        status, spoken, _ = self.post('/voice/speak', {'text': '<speak>literal\r\nO‘zbekiston</speak>', 'language': 'uz'})
        self.assertEqual(status, 200)
        self.assertEqual(spoken['format'], 'wav')
        self.assertEqual(base64.b64decode(spoken['audio_base64']), audio())
        self.assertEqual(self.stub.calls, ['transcribe', 'speak'])
        self.router.log.assert_not_called()
        self.assertEqual(list((self.root / 'logs').iterdir()), [])

    def test_voice_body_limit_is_one_mib_before_runtime_creation(self):
        status, value, _ = self.request('POST', '/voice/transcribe', raw=b'{}',
            headers={'X-LocalAI-Control': '1', 'Content-Length': str(1024 * 1024 + 1)})
        self.assertEqual(status, 400)
        self.assertEqual(value['error'], 'Request too large')
        self.factory_mock.assert_not_called()
        self.assertEqual(self.stub.calls, [])

    def test_bad_payloads_and_decoder_failures_do_not_reflect_audio_or_transcript(self):
        secret = 'synthetic private transcript'
        payloads = [('/voice/transcribe', {'audio_base64': secret}), ('/voice/transcribe', [secret]),
                    ('/voice/transcribe', {'audio_base64': base64.b64encode(audio()).decode('ascii'), 'language': 'xx'}),
                    ('/voice/speak', {'text': secret, 'unknown': secret}), ('/voice/speak', {'text': secret + '\0'}),
                    ('/voice/cancel', {'unknown': secret})]
        for path, payload in payloads:
            status, value, _ = self.post(path, payload)
            self.assertEqual(status, 400)
            self.assertNotIn(secret, json.dumps(value))
        self.stub.failure = RuntimeError(secret)
        status, value, _ = self.post('/voice/transcribe', {'audio_base64': base64.b64encode(audio()).decode('ascii')})
        self.assertEqual(status, 503)
        self.assertNotIn(secret, json.dumps(value))
        self.router.log.assert_not_called()
        self.assertEqual(list((self.root / 'logs').iterdir()), [])

    def test_cancel_stops_active_generation_and_resumes_only_when_global_stop_absent(self):
        status, value, _ = self.post('/voice/cancel', {})
        self.assertEqual(status, 200)
        self.assertTrue(value['cancelled'])
        self.assertEqual((self.stub.stop_calls, self.stub.resume_calls, self.stub.generation), (1, 1, 2))
        self.assertFalse(self.stub.halted)
        self.router.STOP_FILE.write_text('stop', encoding='utf-8')
        self.assertEqual(self.post('/voice/cancel', {})[0], 200)
        self.assertEqual((self.stub.stop_calls, self.stub.resume_calls), (2, 1))
        self.assertTrue(self.stub.halted)
        self.assertEqual(self.post('/voice/speak', {'text': 'Salom'})[0], 409)
        self.router.STOP_FILE.unlink()
        self.router.STATE['halted'] = True
        self.assertEqual(self.post('/voice/cancel', {})[0], 200)
        self.assertEqual((self.stub.stop_calls, self.stub.resume_calls), (3, 1))

    def test_global_stop_then_new_voice_runtime_is_halted_until_successful_mode_resume(self):
        self.assertIsNone(self.router.VOICE_RUNTIME)
        status, value, _ = self.post('/control/stop', {})
        self.assertEqual(status, 200)
        self.assertTrue(value['stopped'])
        deadline = time.monotonic() + 2
        while self.router.STATE['operation'] != 'To‘xtatildi' and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertEqual(self.router.STATE['operation'], 'To‘xtatildi')
        status, voice, _ = self.request('GET', '/voice/status')
        self.assertEqual(status, 200)
        self.assertTrue(voice['halted'])
        self.assertEqual(self.post('/voice/transcribe', {'audio_base64': base64.b64encode(audio()).decode('ascii')})[0], 409)
        self.assertEqual(self.stub.calls, [])
        status, value, _ = self.post('/control/mode', {'mode': 'ECO'})
        self.assertEqual(status, 200)
        self.assertEqual(value['mode'], 'ECO')
        self.assertFalse(self.router.STOP_FILE.exists())
        self.assertFalse(self.router.STATE['halted'])
        self.assertFalse(self.stub.halted)
        self.assertEqual(self.stub.resume_calls, 1)
        self.assertEqual(self.post('/voice/speak', {'text': 'Salom'})[0], 200)
        self.router.BROKER.cancel.assert_called_once()

    def test_global_stop_stops_existing_voice_runtime(self):
        self.request('GET', '/voice/status')
        self.assertEqual(self.post('/control/stop', {})[0], 200)
        self.assertEqual(self.stub.stop_calls, 1)
        self.assertTrue(self.stub.halted)
        deadline = time.monotonic() + 2
        while self.router.STATE['operation'] != 'To‘xtatildi' and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertEqual(self.router.STATE['operation'], 'To‘xtatildi')


if __name__ == '__main__':
    unittest.main(verbosity=2)
