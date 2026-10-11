"""Offline, one-shot Whisper.cpp transcription; no action dispatch or logging.

Audio and the decoder's JSON live only in a random temporary directory below
the per-user runtime. The installed decoder/model/DLLs must match the packaged
manifest; model identities are checked against pinned upstream or reproducibly
converted checkpoints. An optional Uzbek-only pack leaves Russian and English
on the original multilingual model.
"""
from __future__ import annotations

import array
import base64
import binascii
import ctypes
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time
import wave

from toolbox import WindowsJob, _ExtendedLimits, Toolbox

LANGUAGES = ('uz', 'en', 'ru')
MAX_AUDIO_BYTES = 2 * 1024 * 1024
MAX_DURATION = 15
SAMPLE_RATE = 16000
MAX_TEXT_UNITS = 4000
MAX_JSON_BYTES = 256 * 1024
CLI_TIMEOUT = 60
TTS_TIMEOUT = 30
MAX_TTS_TEXT_UNITS = 1000
MAX_TTS_AUDIO_BYTES = 1024 * 1024
MAX_MODEL_ASSET_BYTES = 768 * 1024 * 1024
MAX_STT_ASSET_BYTES = 1024 * 1024 * 1024
MODEL_SHA1 = {
    'tiny': 'bd577a113a864445d4c299885e0cb97d4ba92b5f',
    'base': '465707469ff3a37a2b9b8d8f89f2f99de7299dac',
    'small': '55356645c2b361a969dfd0ef2c5a50d530afd8d5',
    # Maintainer's official multilingual model card, quantized Q5_1 variant:
    # https://huggingface.co/ggerganov/whisper.cpp
    'small-q5_1': '6fe57ddcfdd1c6b07cdcc73aaf620810ce5fc771',
    # Official v1.9.4 models/README.md, multilingual turbo Q5_0 (547 MiB).
    'large-v3-turbo-q5_0': 'e050f7970618a659205450ad97eb95a18d69c9ee',
    # NavAI Uzbek small, Apache-2.0 checkpoint revision 4b432caf21c2752bca3384b5df1d41cf0da2801d.
    # Reproducible safetensors -> GGML F16 -> official b5130 Q5_1; MODEL-SOURCE.json records the lineage.
    'navai-small-uz-q5_1': '5a549f1750434650c3bcbc2fb2c85ff91b30cbcc',
}
MODEL_LANGUAGES = {'navai-small-uz-q5_1': ('uz',)}
VAD_SHA256 = {'silero-v6.2.0': '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987'}


class VoiceError(ValueError):
    """Only fixed local errors; never decoder output, audio or transcripts."""
    def __init__(self, message, code='voice_failed'):
        super().__init__(message)
        self.code = code


class VoiceTools:
    def __init__(self, root, *, assets=None, runner=None):
        self.root = Path(root).resolve()
        service = Path(__file__).resolve().parents[1]
        if assets is None:
            assets = service / 'voice'
            # Source development uses the same public, pinned assets. Installed
            # services have only the bundled voice directory; no outside search.
            if not assets.exists() and (service / 'public-voice' / 'manifest.json').is_file():
                assets = service / 'public-voice'
        # Keep the selected path intact so directory links can be rejected before
        # resolution; resolving here would hide a redirected voice package.
        self.assets = Path(assets).absolute()
        self.scratch = self.root / 'runtime' / 'voice'
        self.lock = threading.RLock()
        self.serial = threading.Lock()
        self.active = None
        self.generation = 0
        self.halted = False
        self.verified = {}
        self.tts_verified = None
        self.runner = runner or self._run_cli

    def _stopped(self):
        return self.halted or (self.root / 'runtime' / 'emergency-stop').exists()

    def _check(self, generation):
        if generation != self.generation or self._stopped():
            raise VoiceError('Ovoz jarayoni to‘xtatildi; davom etish uchun profilni tanlang', 'voice_cancelled')

    @staticmethod
    def _stamp(path):
        value = path.stat()
        return (value.st_size, value.st_mtime_ns, value.st_ctime_ns, value.st_ino)

    @staticmethod
    def _link(path):
        return path.is_symlink() or (hasattr(path, 'is_junction') and path.is_junction())

    def _assets(self, language=None):
        """No downloader or discovery outside the service-relative voice folder."""
        directory = self.assets
        uzbek = self.assets / 'uzbek'
        if language == 'uz' and (uzbek.exists() or self._link(uzbek)):
            directory = uzbek
        manifest_path = directory / 'manifest.json'
        if not manifest_path.is_file():
            raise VoiceError('Lokal ovoz paketi o‘rnatilmagan', 'voice_assets_missing')
        try:
            if (self._link(self.assets) or self._link(directory) or self._link(manifest_path)
                    or manifest_path.stat().st_size > 65536):
                raise ValueError()
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            if (not isinstance(manifest, dict) or manifest.get('schema') != 1
                    or manifest.get('engine') != 'whisper.cpp' or manifest.get('model') not in MODEL_SHA1
                    or manifest.get('exe') != 'whisper-cli.exe'
                    or manifest.get('model_file') != 'ggml-' + manifest['model'] + '.bin'):
                raise ValueError()
            if language is not None and language not in MODEL_LANGUAGES.get(manifest['model'], LANGUAGES):
                raise VoiceError('Tanlangan ovoz modeli bu tilni qo‘llamaydi', 'voice_model_language')
            vad = manifest.get('vad')
            if 'vad' in manifest and (not isinstance(vad, dict) or set(vad) != {'model', 'model_file'}
                    or vad.get('model') not in VAD_SHA256
                    or vad.get('model_file') != 'ggml-' + vad['model'] + '.bin'):
                raise ValueError()
            files = manifest.get('files')
            if not isinstance(files, list) or not 2 <= len(files) <= 64:
                raise ValueError()
            signatures, names, total = [], set(), 0
            for item in files:
                if not isinstance(item, dict) or set(item) != {'path', 'size', 'sha256'}:
                    raise ValueError()
                name, size, digest = item['path'], item['size'], item['sha256']
                if (not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', name)
                        or name.lower() in names or name.lower() == 'manifest.json'
                        or isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= MAX_MODEL_ASSET_BYTES
                        or not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest)):
                    raise ValueError()
                names.add(name.lower())
                total += size
                if total > MAX_STT_ASSET_BYTES:
                    raise ValueError()
                path = directory / name
                if self._link(path) or not path.is_file() or path.resolve().parent != directory.resolve():
                    raise ValueError()
                stamp = self._stamp(path)
                if stamp[0] != size:
                    raise ValueError()
                signatures.append((name, digest, stamp))
            if not {manifest['exe'].lower(), manifest['model_file'].lower()} <= names:
                raise ValueError()
            if vad is not None and vad['model_file'].lower() not in names:
                raise ValueError()
            actual = {path.name.lower() for path in directory.iterdir()}
            # TTS is an independent, recursively verified package. A broken TTS
            # pack disables speech output without disabling transcription.
            if 'tts' in actual:
                tts = directory / 'tts'
                if self._link(tts) or not tts.is_dir():
                    raise ValueError()
                actual.remove('tts')
            if directory == self.assets and 'uzbek' in actual:
                if self._link(uzbek) or not uzbek.is_dir():
                    raise ValueError()
                actual.remove('uzbek')
            if actual != names | {'manifest.json'}:
                raise ValueError()
            signature = (str(directory), self._stamp(manifest_path), tuple(signatures))
            cached = self.verified.get(str(directory)) if isinstance(self.verified, dict) else None
            if cached is not None and cached[0] == signature:
                return cached[1]
            for name, expected, _ in signatures:
                sha256, sha1 = hashlib.sha256(), hashlib.sha1()
                with (directory / name).open('rb') as source:
                    for block in iter(lambda: source.read(1024 * 1024), b''):
                        sha256.update(block)
                        if name.lower() == manifest['model_file'].lower():
                            sha1.update(block)
                if sha256.hexdigest() != expected:
                    raise ValueError()
                if vad is not None and name.lower() == vad['model_file'].lower() and sha256.hexdigest() != VAD_SHA256[vad['model']]:
                    raise ValueError()
                if name.lower() == manifest['model_file'].lower() and sha1.hexdigest() != MODEL_SHA1[manifest['model']]:
                    raise ValueError()
            # Reject files that changed while their bytes were being checked.
            if signature != (str(directory), self._stamp(manifest_path),
                             tuple((name, digest, self._stamp(directory / name))
                                   for name, digest, _ in signatures)):
                raise ValueError()
            value = {'model': manifest['model'], 'exe': directory / manifest['exe'],
                     'model_file': directory / manifest['model_file']}
            if vad is not None:
                value['vad_model'] = directory / vad['model_file']
            if not isinstance(self.verified, dict):
                self.verified = {}
            self.verified[str(directory)] = (signature, value)
            return value
        except VoiceError:
            raise
        except (OSError, ValueError, KeyError, TypeError, UnicodeError):
            self.verified = {}
            raise VoiceError('Lokal ovoz paketining fayllari buzilgan yoki mos emas', 'voice_assets_invalid') from None

    def _tts_assets(self):
        directory = self.assets / 'tts'
        manifest_path = directory / 'manifest.json'
        if not manifest_path.is_file():
            raise VoiceError('Lokal ovoz chiqarish paketi o‘rnatilmagan', 'voice_tts_assets_missing')
        try:
            if self._link(self.assets) or self._link(directory) or self._link(manifest_path) or manifest_path.stat().st_size > 256 * 1024:
                raise ValueError()
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            if (not isinstance(manifest, dict) or manifest.get('schema') != 1
                    or manifest.get('engine') != 'espeak-ng' or manifest.get('exe') != 'espeak-ng.exe'):
                raise ValueError()
            files = manifest.get('files')
            if not isinstance(files, list) or not 2 <= len(files) <= 1024:
                raise ValueError()
            signatures, names, directories, total = [], set(), set(), 0
            for item in files:
                if not isinstance(item, dict) or set(item) != {'path', 'size', 'sha256'}:
                    raise ValueError()
                name, size, digest = item['path'], item['size'], item['sha256']
                if not isinstance(name, str) or not 1 <= len(name) <= 256:
                    raise ValueError()
                parts = name.split('/')
                if (any(not re.fullmatch(r'[A-Za-z0-9!][A-Za-z0-9_!. -]{0,127}', part)
                        or part.endswith(('.', ' ')) for part in parts)
                        or name.lower() in names or name.lower() == 'manifest.json'
                        or isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= 32 * 1024 * 1024
                        or not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest)):
                    raise ValueError()
                total += size
                if total > 64 * 1024 * 1024:
                    raise ValueError()
                names.add(name.lower())
                path = directory.joinpath(*parts)
                if not path.is_file() or not path.resolve().is_relative_to(directory.resolve()):
                    raise ValueError()
                for index in range(1, len(parts) + 1):
                    relative = '/'.join(parts[:index])
                    if self._link(directory.joinpath(*parts[:index])):
                        raise ValueError()
                    if index < len(parts):
                        directories.add(relative.lower())
                stamp = self._stamp(path)
                if stamp[0] != size:
                    raise ValueError()
                signatures.append((name, digest, stamp))
            required = {'espeak-ng.exe', 'libespeak-ng.dll', 'espeak-ng-data/phondata',
                        'espeak-ng-data/phontab', 'espeak-ng-data/phonindex', 'espeak-ng-data/uz_dict',
                        'espeak-ng-data/lang/trk/uz', 'espeak-ng-data/lang/gmw/en', 'espeak-ng-data/lang/zle/ru'}
            if not required <= names:
                raise ValueError()
            actual_files, actual_dirs = set(), set()
            for current, children, entries in os.walk(directory, followlinks=False):
                current = Path(current)
                for child in children:
                    path = current / child
                    if self._link(path):
                        raise ValueError()
                    actual_dirs.add(path.relative_to(directory).as_posix().lower())
                for entry in entries:
                    path = current / entry
                    if self._link(path):
                        raise ValueError()
                    actual_files.add(path.relative_to(directory).as_posix().lower())
                if len(actual_files) > 1025 or len(actual_dirs) > 1024:
                    raise ValueError()
            if actual_files != names | {'manifest.json'} or actual_dirs != directories:
                raise ValueError()
            signature = (self._stamp(manifest_path), tuple(signatures))
            if self.tts_verified is not None and self.tts_verified[0] == signature:
                return self.tts_verified[1]
            for name, expected, _ in signatures:
                digest = hashlib.sha256()
                with (directory / name).open('rb') as source:
                    for block in iter(lambda: source.read(1024 * 1024), b''):
                        digest.update(block)
                if digest.hexdigest() != expected:
                    raise ValueError()
            if signature != (self._stamp(manifest_path), tuple((name, digest, self._stamp(directory / name))
                                                              for name, digest, _ in signatures)):
                raise ValueError()
            value = {'exe': directory / 'espeak-ng.exe', 'directory': directory}
            self.tts_verified = (signature, value)
            return value
        except (OSError, ValueError, KeyError, TypeError, UnicodeError):
            self.tts_verified = None
            raise VoiceError('Lokal ovoz chiqarish paketining fayllari buzilgan yoki mos emas', 'voice_tts_assets_invalid') from None

    def status(self):
        value = {'ok': True, 'voice_api': 1, 'available': False, 'engine': 'whisper.cpp', 'model': None,
                 'languages': list(LANGUAGES), 'sample_rate': SAMPLE_RATE, 'max_duration_seconds': MAX_DURATION,
                 'max_audio_bytes': MAX_AUDIO_BYTES, 'max_text_units': MAX_TEXT_UNITS, 'offline': True,
                 'cpu_threads': min(4, os.cpu_count() or 1), 'tts_available': False, 'tts_engine': 'espeak-ng',
                 'tts_languages': list(LANGUAGES), 'tts_max_text_units': MAX_TTS_TEXT_UNITS,
                 'tts_max_audio_bytes': MAX_TTS_AUDIO_BYTES}
        with self.lock:
            value.update(busy=self.serial.locked(), halted=self._stopped())
            try:
                models = {language: self._assets(language)['model'] for language in LANGUAGES}
                value.update(available=True, model=models['uz'], models_by_language=models)
            except VoiceError as error:
                value['reason'] = error.code
            try:
                self._tts_assets()
                value['tts_available'] = True
            except VoiceError as error:
                value['tts_reason'] = error.code
        return value

    @staticmethod
    def _audio(arguments):
        if not isinstance(arguments, dict) or set(arguments) - {'audio_base64', 'language', 'duration_seconds', 'request_id'}:
            raise VoiceError('Ovoz so‘rovi maydonlari noto‘g‘ri', 'voice_invalid_audio')
        language = arguments.get('language', 'uz')
        request_id = arguments.get('request_id')
        if language not in LANGUAGES:
            raise VoiceError('Ovoz tili uz, en yoki ru bo‘lsin', 'voice_invalid_audio')
        if request_id is not None and (not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', request_id)):
            raise VoiceError('Ovoz so‘rovi identifikatori noto‘g‘ri', 'voice_invalid_audio')
        encoded = arguments.get('audio_base64')
        if not isinstance(encoded, str) or not 1 <= len(encoded) <= 4 * ((MAX_AUDIO_BYTES + 2) // 3):
            raise VoiceError('Audio hajmi ruxsat etilgan chegaradan tashqarida', 'voice_invalid_audio')
        try:
            raw = base64.b64decode(encoded, validate=True)
            if not 44 <= len(raw) <= MAX_AUDIO_BYTES or raw[:4] != b'RIFF' or raw[8:12] != b'WAVE':
                raise ValueError()
            if int.from_bytes(raw[4:8], 'little') + 8 != len(raw):
                raise ValueError()
            with wave.open(io.BytesIO(raw), 'rb') as source:
                frames = source.getnframes()
                if (source.getcomptype() != 'NONE' or source.getnchannels() != 1 or source.getsampwidth() != 2
                        or source.getframerate() != SAMPLE_RATE or not 1 <= frames <= SAMPLE_RATE * MAX_DURATION):
                    raise ValueError()
                pcm = source.readframes(frames)
                if len(pcm) != frames * 2:
                    raise ValueError()
            duration = frames / SAMPLE_RATE
            claimed = arguments.get('duration_seconds', duration)
            if (isinstance(claimed, bool) or not isinstance(claimed, (int, float)) or not math.isfinite(claimed)
                    or not 0 < claimed <= MAX_DURATION or abs(claimed - duration) > .1):
                raise ValueError()
            samples = array.array('h', pcm)
            if sys.byteorder != 'little':
                samples.byteswap()
            silent = max(abs(sample) for sample in samples) <= 32
            # Send a canonical PCM container to the native decoder. Discard
            # metadata/extra chunks so two WAV parsers cannot disagree about
            # the validated audio's channels, frames or duration.
            canonical = io.BytesIO()
            with wave.open(canonical, 'wb') as target:
                target.setnchannels(1)
                target.setsampwidth(2)
                target.setframerate(SAMPLE_RATE)
                target.writeframes(pcm)
            return canonical.getvalue(), duration, language, request_id, silent
        except (ValueError, binascii.Error, wave.Error, EOFError, UnicodeError, OverflowError):
            raise VoiceError('Audio 16 kHz, mono, 16-bit PCM WAV va ko‘pi bilan 15 soniya bo‘lsin', 'voice_invalid_audio') from None

    def _directory(self):
        try:
            target = self.scratch.resolve()
            if not target.is_relative_to(self.root):
                raise OSError()
            target.mkdir(parents=True, exist_ok=True)
            if target.resolve() != target or not target.is_dir():
                raise OSError()
            return target
        except OSError:
            raise VoiceError('Vaqtinchalik ovoz papkasini tayyorlab bo‘lmadi') from None

    @staticmethod
    def _result(path):
        try:
            if not path.is_file() or path.is_symlink() or path.stat().st_size > MAX_JSON_BYTES:
                raise ValueError()
            value = json.loads(path.read_text(encoding='utf-8'))
            segments = value.get('transcription') if isinstance(value, dict) else None
            if not isinstance(segments, list) or len(segments) > 256:
                raise ValueError()
            parts = []
            for segment in segments:
                part = segment.get('text') if isinstance(segment, dict) else None
                if (not isinstance(part, str) or '\x00' in part or any(ord(char) < 32 and char not in '\t\n\r' for char in part)
                        or len(part.encode('utf-16-le')) // 2 > MAX_TEXT_UNITS):
                    raise ValueError()
                parts.append(part)
            transcript = ''.join(parts).strip()
            if len(transcript.encode('utf-16-le')) // 2 > MAX_TEXT_UNITS:
                raise ValueError()
            return transcript
        except (OSError, ValueError, TypeError, UnicodeError):
            raise VoiceError('Ovoz modeli yaroqli matn qaytarmadi') from None

    def transcribe(self, arguments):
        if not self.serial.acquire(blocking=False):
            raise VoiceError('Boshqa ovoz tanish jarayoni ishlayapti', 'voice_busy')
        started = time.monotonic()
        try:
            with self.lock:
                generation = self.generation
                self._check(generation)
            raw, duration, language, request_id, silent = self._audio(arguments)
            with self.lock:
                self._check(generation)
                assets = self._assets(language)
            transcript = ''
            if not silent:
                with tempfile.TemporaryDirectory(prefix='utterance-', dir=self._directory()) as folder:
                    folder = Path(folder)
                    audio, output = folder / 'input.wav', folder / 'result'
                    audio.write_bytes(raw)
                    args = [str(assets['exe']), '-m', str(assets['model_file']), '-f', str(audio),
                            '-l', language, '-t', str(min(4, os.cpu_count() or 1)), '-p', '1', '-ng', '-np',
                            '-oj', '-of', str(output)]
                    # The Uzbek checkpoint was trained/decoded without timestamps.
                    # Use its actual decoding mode; never repair literal message text.
                    if assets['model'] in MODEL_LANGUAGES:
                        args.append('--no-timestamps')
                    if 'vad_model' in assets:
                        args.extend(['--vad', '-vm', str(assets['vad_model']), '-vt', '0.5', '-vp', '200'])
                    result = self.runner(args, cwd=assets['exe'].parent, timeout=CLI_TIMEOUT,
                                         env=Toolbox.environment(), generation=generation)
                    with self.lock:
                        self._check(generation)
                    if result.get('timed_out'):
                        raise VoiceError('Ovoz tanish vaqti tugadi; qisqaroq gapirib qayta sinang', 'voice_timeout')
                    if result.get('exit_code') != 0:
                        raise VoiceError('Lokal ovoz modeli ishga tushmadi; ovoz paketini tekshiring')
                    transcript = self._result(output.with_suffix('.json'))
            with self.lock:
                self._check(generation)
            return {'ok': True, 'voice_api': 1, 'text': transcript, 'language': language,
                    'model': assets['model'], 'engine': 'whisper.cpp', 'duration_seconds': duration,
                    'processing_ms': round((time.monotonic() - started) * 1000),
                    'speech_detected': bool(transcript) if 'vad_model' in assets else not silent,
                    'execution_performed': False, **({'request_id': request_id} if request_id is not None else {})}
        except (OSError, subprocess.SubprocessError):
            raise VoiceError('Vaqtinchalik ovoz jarayonini yakunlab bo‘lmadi') from None
        finally:
            self.serial.release()

    @staticmethod
    def _speech(arguments):
        try:
            if not isinstance(arguments, dict) or set(arguments) - {'text', 'language', 'request_id'}:
                raise ValueError()
            text, language, request_id = arguments.get('text'), arguments.get('language', 'uz'), arguments.get('request_id')
            if (not isinstance(text, str) or not text.strip() or language not in LANGUAGES
                    or any(ord(char) < 32 and char not in '\t\n\r' for char in text)
                    or len(text.encode('utf-16-le')) // 2 > MAX_TTS_TEXT_UNITS):
                raise ValueError()
            if request_id is not None and (not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', request_id)):
                raise ValueError()
            return text, language, request_id
        except (ValueError, TypeError, UnicodeError):
            raise VoiceError('Ovoz chiqarish uchun uz, en yoki ru tilida 1–1000 belgili matn kiriting', 'voice_invalid_text') from None

    @staticmethod
    def _speech_result(path):
        try:
            if not path.is_file() or VoiceTools._link(path) or not 44 <= path.stat().st_size <= MAX_TTS_AUDIO_BYTES:
                raise ValueError()
            raw = path.read_bytes()
            if raw[:4] != b'RIFF' or raw[8:12] != b'WAVE' or int.from_bytes(raw[4:8], 'little') + 8 != len(raw):
                raise ValueError()
            with wave.open(io.BytesIO(raw), 'rb') as source:
                frames, rate = source.getnframes(), source.getframerate()
                if (source.getcomptype() != 'NONE' or source.getnchannels() != 1 or source.getsampwidth() != 2
                        or not 8000 <= rate <= 48000 or frames <= 0):
                    raise ValueError()
                pcm = source.readframes(frames)
                if len(pcm) != frames * 2:
                    raise ValueError()
            # Native output is reparsed and canonicalized before WebView playback.
            stream = io.BytesIO()
            with wave.open(stream, 'wb') as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(rate)
                output.writeframes(pcm)
            return stream.getvalue(), frames / rate, rate
        except (OSError, ValueError, wave.Error, EOFError, UnicodeError):
            raise VoiceError('Ovoz fayli yaroqsiz yoki juda katta; matnni qisqartirib qayta sinang', 'voice_tts_output_invalid') from None

    def speak(self, arguments):
        """Generate a bounded WAV for caller playback; never play or dispatch it."""
        if not self.serial.acquire(blocking=False):
            raise VoiceError('Boshqa ovoz jarayoni ishlayapti', 'voice_busy')
        started = time.monotonic()
        try:
            with self.lock:
                generation = self.generation
                self._check(generation)
            text, language, request_id = self._speech(arguments)
            with self.lock:
                self._check(generation)
                assets = self._tts_assets()
            with tempfile.TemporaryDirectory(prefix='speech-', dir=self._directory()) as folder:
                text_path, output = Path(folder) / 'input.txt', Path(folder) / 'output.wav'
                with text_path.open('w', encoding='utf-8', newline='') as source:
                    source.write(text)
                args = [str(assets['exe']), '--path=' + str(assets['directory']), '-v', language,
                        '-s', '155', '-b', '1', '-w', str(output), '-f', str(text_path)]
                result = self.runner(args, cwd=assets['directory'], timeout=TTS_TIMEOUT,
                                     env=Toolbox.environment(), generation=generation)
                with self.lock:
                    self._check(generation)
                if result.get('timed_out'):
                    raise VoiceError('Ovoz chiqarish vaqti tugadi; matnni qisqartirib qayta sinang', 'voice_timeout')
                if result.get('exit_code') != 0:
                    raise VoiceError('Lokal ovoz chiqarish dasturi ishga tushmadi; ovoz paketini tekshiring')
                raw, duration, rate = self._speech_result(output)
            with self.lock:
                self._check(generation)
            return {'ok': True, 'voice_api': 1, 'audio_base64': base64.b64encode(raw).decode('ascii'),
                    'format': 'wav', 'language': language, 'engine': 'espeak-ng', 'duration_seconds': duration,
                    'sample_rate': rate, 'processing_ms': round((time.monotonic() - started) * 1000),
                    'execution_performed': False, **({'request_id': request_id} if request_id is not None else {})}
        except (OSError, subprocess.SubprocessError):
            raise VoiceError('Vaqtinchalik ovoz chiqarish jarayonini yakunlab bo‘lmadi') from None
        finally:
            self.serial.release()

    def _run_cli(self, args, *, cwd, timeout, env, generation):
        """Register the suspended child atomically with Stop before resuming it."""
        process, job, record = None, None, None
        try:
            with self.lock:
                self._check(generation)
                if os.name == 'nt':
                    job = WindowsJob()
                    limits = _ExtendedLimits()
                    limits.BasicLimitInformation.LimitFlags = 0x2000 | 0x100 | 0x200
                    limits.ProcessMemoryLimit = limits.JobMemoryLimit = 2 * 1024**3
                    if not job.kernel.SetInformationJobObject(job.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
                        raise VoiceError('Ovoz jarayoni uchun xotira chegarasini o‘rnatib bo‘lmadi')
                process = subprocess.Popen(args, cwd=str(cwd), env=env, shell=False,
                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    creationflags=subprocess.CREATE_NO_WINDOW | 0x4 if os.name == 'nt' else 0,
                    start_new_session=os.name != 'nt')
                record = {'process': process, 'job': job}
                self.active = record
                if job:
                    job.attach_and_resume(process)
            try:
                process.wait(timeout=timeout)
                timed_out = False
            except subprocess.TimeoutExpired:
                self._terminate(record)
                process.wait(timeout=3)
                timed_out = True
            return {'exit_code': process.returncode, 'timed_out': timed_out}
        except VoiceError:
            if record:
                self._terminate(record)
            raise
        except Exception:
            if record:
                self._terminate(record)
            raise VoiceError('Lokal ovoz jarayonini ishga tushirib bo‘lmadi') from None
        finally:
            if job:
                job.close()
            if process is not None and process.poll() is None:
                process.kill()
                process.wait(timeout=3)
            with self.lock:
                if self.active is record:
                    self.active = None

    @staticmethod
    def _terminate(record):
        job, process = record['job'], record['process']
        if job:
            job.terminate()
        elif os.name != 'nt':
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except OSError:
                pass
        if process.poll() is None:
            process.kill()

    def stop(self):
        with self.lock:
            self.generation += 1
            self.halted = True
            if self.active:
                self._terminate(self.active)
            return {'ok': True, 'stopped': True}

    def resume(self):
        with self.lock:
            if (self.root / 'runtime' / 'emergency-stop').exists():
                raise VoiceError('Stop faol; davom etish uchun profilni tanlang', 'voice_cancelled')
            self.generation += 1
            self.halted = False
            return {'ok': True, 'resumed': True}
