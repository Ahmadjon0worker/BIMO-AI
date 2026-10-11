"""Synthetic Telethon contract tests. No credentials, network or real messages."""
from __future__ import annotations

import asyncio
import copy
from datetime import datetime, timezone
from pathlib import Path
import sys
import tempfile
import threading
import time
from types import SimpleNamespace as NS
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from telegram_account import (AccountError, PersonalTelegram, message_text, bounded_query,
                              truncate_utf16, utf16_units)
from telegram_intent import parse_command
from capabilities import CapabilityRuntime, CapabilityError
from telethon import errors
from telethon.tl.types import (User, InputPeerUser, InputPeerSelf, InputPeerChannel, PeerUser,
                               PeerChannel, Channel, ChatPhotoEmpty, MessageEmpty)
from telethon.utils import get_peer_id

NOW = datetime(2026, 10, 10, tzinfo=timezone.utc)


class MemoryVault:
    def __init__(self):
        self.value = {'api_id': 12345, 'api_hash': 'a' * 32, 'session': 'SYNTHETIC_ONLY'}
        self.writes = []

    def read(self):
        return copy.deepcopy(self.value)

    def write(self, value):
        self.value = copy.deepcopy(value)
        self.writes.append(copy.deepcopy(value))


def peer_key(peer):
    return '777' if isinstance(peer, InputPeerSelf) else str(get_peer_id(peer))


def message(identifier, chat=1001, text=None, **extra):
    peer = PeerUser(chat) if chat > 0 else PeerChannel(-chat - 10**12)
    value = NS(id=identifier, peer_id=peer, message=text if text is not None else f'Message {identifier}',
               sender_id=chat, sender=NS(first_name='Synthetic', last_name='Sender'),
               date=NOW, out=False, media=None, reply_to=None)
    for name, item in extra.items():
        setattr(value, name, item)
    return value


def dialog(index):
    user = User(id=1000 + index, access_hash=42, first_name=f'Chat {index}', username=f'user{index:04}')
    return NS(id=user.id, name=user.first_name, entity=user, input_entity=InputPeerUser(user.id, 42),
              message=message(1000 - index, chat=user.id), date=NOW, is_user=True,
              is_group=False, unread_count=index % 3)


class FakeClient:
    def __init__(self):
        self.connected = False
        self.me = User(id=777, access_hash=7, first_name='Synthetic owner', username='syntheticowner', is_self=True)
        self.session = NS(dc_id=2, save=lambda: 'SYNTHETIC_ONLY')
        self.dialog_values = [dialog(index) for index in range(1, 71)]
        self.history = {'1001': [message(index) for index in range(120, 0, -1)]}
        self.dialog_calls, self.message_calls, self.sends, self.resolves = [], [], [], []
        self.dialog_error = self.send_error = None
        self.send_delay = 0
        self.lookup_delay = 0
        self.lookup_started = threading.Event()
        self.resolve_entity = User(id=9000, access_hash=4, first_name='Resolved synthetic', username='testperson')

    async def connect(self):
        self.connected = True

    async def disconnect(self):
        self.connected = False

    def is_connected(self):
        return self.connected

    async def is_user_authorized(self):
        return True

    async def get_me(self):
        return self.me

    async def get_dialogs(self, **options):
        self.dialog_calls.append(options)
        if self.dialog_error:
            raise self.dialog_error
        values = [value for value in self.dialog_values
                  if not options.get('ignore_pinned') or not getattr(value, 'pinned', False)]
        start = 0
        peer = options.get('offset_peer')
        if peer is not None:
            key = peer_key(peer)
            start = next(index + 1 for index, value in enumerate(values) if str(value.id) == key)
        return values[start:start + options['limit']]

    async def get_messages(self, peer, **options):
        key = peer_key(peer)
        self.message_calls.append((key, options.copy()))
        values = self.history.get(key, [])
        if 'ids' in options:
            self.lookup_started.set()
            await asyncio.sleep(self.lookup_delay)
            return next((value for value in values if value is not None and value.id == options['ids']), None)
        before = options.get('offset_id', 2**31)
        query = options.get('search', '').casefold()
        values = [value for value in values if value is None or value.id < before
                  and query in (getattr(value, 'message', '') or '').casefold()]
        return values[:options['limit']]

    async def send_message(self, peer, text, **options):
        self.sends.append((peer_key(peer), text, options.copy()))
        await asyncio.sleep(self.send_delay)
        if self.send_error:
            raise self.send_error
        self.history.setdefault(peer_key(peer), []).insert(0, message(9999, chat=int(peer_key(peer)), text=text, out=True))
        return NS(id=9999)

    async def __call__(self, request):
        self.resolves.append(request.username)
        entity = self.resolve_entity
        if isinstance(entity, Channel):
            return NS(peer=PeerChannel(entity.id), chats=[entity], users=[])
        return NS(peer=PeerUser(entity.id), users=[entity], chats=[])


class AccountTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='coucou-synthetic-telegram-')
        self.client = FakeClient()
        self.vault = MemoryVault()
        self.account = PersonalTelegram(self.temp.name, vault=self.vault, client_factory=lambda **unused: self.client)
        self.account.connect({})

    def tearDown(self):
        self.account.close()
        self.temp.cleanup()

    def load(self):
        self.account.dialogs({})

    def runtime(self, request=None):
        return CapabilityRuntime(Path(self.temp.name), account=self.account, request=request)

    def test_connection_has_epoch_and_saved_messages_without_loading_chats(self):
        status = self.account.status()
        self.assertTrue(status['authorized'])
        self.assertTrue(status['connected'])
        result = self.account.resolve({'recipient': 'self'})
        self.assertEqual(result['chat']['chat_id'], '777')
        self.assertTrue(result['chat']['is_self'])
        self.assertEqual(result['session_epoch'], status['session_epoch'])
        self.assertEqual(self.client.dialog_calls, [])
        self.assertEqual(self.client.message_calls, [])

    def test_chat_pagination_is_bounded_and_preserves_loaded_chat(self):
        first = self.account.dialogs({})
        self.assertEqual(len(first['chats']), 30)
        self.assertEqual(first['query'], '')
        self.assertEqual(first['filter'], 'all')
        self.assertRegex(first['next_cursor'], r'^[A-Za-z0-9_-]{32}$')
        self.account.read({'chat_id': '1001'})
        second = self.account.dialogs({'cursor': first['next_cursor']})
        third = self.account.dialogs({'cursor': second['next_cursor']})
        self.assertEqual([len(value['chats']) for value in (first, second, third)], [30, 30, 10])
        ids = [chat['chat_id'] for page in (first, second, third) for chat in page['chats']]
        self.assertEqual(len(set(ids)), 70)
        self.assertFalse(third['has_more'])
        self.assertIsNone(third['next_cursor'])
        self.assertEqual(self.account.status()['selected_chat_id'], '1001')
        self.account.preview_send({'chat_id': '1001', 'text': 'Still loaded'})
        self.assertTrue(all(call['limit'] == 31 for call in self.client.dialog_calls))
        self.assertTrue(self.client.dialog_calls[1]['ignore_pinned'])

    def test_cursor_is_bound_to_query_filter_expiration_and_session(self):
        page = self.account.dialogs({})
        cursor = page['next_cursor']
        for payload in ({'cursor': cursor, 'query': 'Chat'}, {'cursor': cursor, 'filter': 'unread'},
                        {'cursor': 'A' * 32}):
            with self.assertRaises(AccountError) as result:
                self.account.dialogs(payload)
            self.assertEqual(result.exception.code, 'stale_cursor')
        self.account._cursors[cursor]['expires'] = time.monotonic() - 1
        with self.assertRaises(AccountError):
            self.account.dialogs({'cursor': cursor})
        self.assertEqual(len(self.client.dialog_calls), 1)
        self.account.stop()
        self.account.connect({})
        with self.assertRaises(AccountError):
            self.account.dialogs({'cursor': cursor})

    def test_search_is_explicit_bounded_and_echoes_query(self):
        self.client.dialog_values = [dialog(index) for index in range(1, 241)]
        first = self.account.dialogs({'query': 'Missing'})
        self.assertEqual(first['chats'], [])
        self.assertEqual(first['scanned_count'], 100)
        self.assertTrue(first['has_more'])
        self.assertEqual(self.client.dialog_calls[-1]['limit'], 101)
        second = self.account.dialogs({'query': 'Missing', 'cursor': first['next_cursor']})
        self.assertEqual(second['scanned_count'], 100)
        self.assertEqual(second['query'], 'Missing')
        self.assertEqual(self.account.dialogs({'query': 'user0240'})['chats'], [])
        filtered = self.account.dialogs({'filter': 'unread'})
        self.assertTrue(all(value['unread_count'] > 0 for value in filtered['chats']))

    def test_pinned_prefix_never_becomes_chronological_offset_for_small_pages(self):
        self.client.dialog_values = [dialog(index) for index in range(1, 6)]
        for value in self.client.dialog_values[:2]:
            value.pinned = True
            value.date = value.message.date = datetime(2020, 1, 1, tzinfo=timezone.utc)
        loaded, cursor = [], None
        for unused in range(5):
            payload = {'limit': 1}
            if cursor is not None:
                payload['cursor'] = cursor
            page = self.account.dialogs(payload)
            loaded.extend(value['chat_id'] for value in page['chats'])
            cursor = page['next_cursor']
        self.assertEqual(loaded, ['1001', '1002', '1003', '1004', '1005'])
        self.assertIsNone(cursor)
        self.assertNotIn('offset_date', self.client.dialog_calls[1])
        self.assertNotIn('offset_date', self.client.dialog_calls[2])
        self.assertTrue(self.client.dialog_calls[2]['ignore_pinned'])

    def test_plain_text_bans_disable_group_compose_but_admin_ignores_default_ban(self):
        value = self.client.dialog_values[0]
        value.is_user, value.is_group = False, True
        value.entity = NS(default_banned_rights=NS(send_messages=False, send_plain=True))
        page = self.account.dialogs({})
        self.assertFalse(page['chats'][0]['can_send'])
        with self.assertRaises(AccountError):
            self.account.preview_send({'chat_id': '1001', 'text': 'Blocked plain text'})
        value.entity.creator = True
        self.assertTrue(self.account.dialogs({})['chats'][0]['can_send'])
        value.entity.banned_rights = NS(send_plain=True)
        self.assertFalse(self.account.dialogs({})['chats'][0]['can_send'])

    def test_full_pinned_server_chunk_continues_from_newest_unpinned(self):
        pinned = [dialog(index) for index in range(1, 101)]
        unpinned = [dialog(index) for index in range(101, 104)]
        for value in pinned:
            value.pinned = True
            value.date = value.message.date = datetime(2020, 1, 1, tzinfo=timezone.utc)
        self.client.dialog_values = pinned + unpinned
        original = self.client.get_dialogs
        async def simulate_sdk_chunk(**options):
            if not options.get('ignore_pinned'):
                self.client.dialog_calls.append(options)
                return pinned[:min(options['limit'], 100)]
            return await original(**options)
        self.client.get_dialogs = simulate_sdk_chunk
        cursor, loaded = None, []
        for unused in range(6):
            payload = {'limit': 30}
            if cursor:
                payload['cursor'] = cursor
            page = self.account.dialogs(payload)
            loaded.extend(value['chat_id'] for value in page['chats'])
            cursor = page['next_cursor']
            if not cursor:
                break
        self.assertEqual(loaded, [str(1000 + index) for index in range(1, 104)])
        self.assertIsNone(cursor)
        self.assertTrue(self.client.dialog_calls[-1]['ignore_pinned'])
        self.assertNotIn('offset_date', self.client.dialog_calls[-1])

    def test_username_resolve_opens_read_only_channel_but_send_is_blocked(self):
        self.client.resolve_entity = Channel(id=9000, access_hash=4, title='Synthetic channel',
            photo=ChatPhotoEmpty(), date=NOW, broadcast=True, username='testperson')
        result = self.account.resolve({'recipient': '@testperson'})
        self.assertEqual(result['chat']['kind'], 'channel')
        self.assertFalse(result['chat']['can_send'])
        recipient, reason = self.account.command_recipient('@testperson')
        self.assertIsNone(recipient)
        self.assertIsInstance(reason, str)
        with self.assertRaises(AccountError):
            self.account.preview_send({'chat_id': result['chat']['chat_id'], 'text': 'Blocked'})
        self.assertEqual(self.client.sends, [])

    def test_history_pages_are_chronological_and_forward_search_and_before(self):
        self.load()
        first = self.account.read({'chat_id': '1001', 'limit': 50})
        self.assertEqual([value['id'] for value in first['messages']], list(range(71, 121)))
        self.assertTrue(first['has_more'])
        self.assertEqual(first['before_id'], 71)
        second = self.account.read({'chat_id': '1001', 'limit': 50, 'before_id': 71, 'query': 'Message'})
        self.assertEqual([value['id'] for value in second['messages']], list(range(21, 71)))
        self.assertEqual(self.client.message_calls[-1][1], {'limit': 51, 'offset_id': 71, 'search': 'Message'})
        self.assertEqual(second['query'], 'Message')

    def test_history_omits_deleted_empty_duplicate_and_wrong_chat(self):
        self.load()
        self.client.history['1001'] = [None, MessageEmpty(10, peer_id=PeerUser(1001)), message(9, deleted=True),
                                      message(8, chat=1002), message(7), message(7), message(6)]
        result = self.account.read({'chat_id': '1001'})
        self.assertEqual([value['id'] for value in result['messages']], [6, 7])

    def test_history_metadata_and_utf16_truncation(self):
        self.load()
        media = type('MessageMediaContact', (), {})()
        self.client.history['1001'] = [message(3, text='😀' * 2001, reply_to=NS(reply_to_msg_id=2)),
                                      message(2, text='', media=media), message(1, text='', voice=object())]
        result = self.account.read({'chat_id': '1001'})['messages']
        self.assertEqual(result[0]['media_kind'], 'voice')
        self.assertEqual(result[1]['media_kind'], 'contact')
        self.assertEqual(result[2]['sender_name'], 'Synthetic Sender')
        self.assertEqual(result[2]['reply_to_id'], 2)
        self.assertTrue(result[2]['truncated'])
        self.assertEqual(result[2]['text'], '😀' * 2000)
        self.assertLessEqual(sum(utf16_units(value['text']) for value in result), 24000)

    def test_history_total_text_budget_is_bounded(self):
        self.load()
        self.client.history['1001'] = [message(index, text='😀' * 2000) for index in range(60, 0, -1)]
        result = self.account.read({'chat_id': '1001', 'limit': 50})['messages']
        self.assertEqual(len(result), 50)
        self.assertEqual(sum(utf16_units(value['text']) for value in result), 50000)
        self.assertTrue(any(value['truncated'] for value in result))

    def test_compose_preserves_exact_text_and_is_one_use(self):
        self.load()
        original = '  Literal **body**\nnew line 😀  '
        preview = self.account.preview_send({'chat_id': '1001', 'text': original})
        self.assertEqual(preview['text'], original)
        self.assertEqual(self.account.confirm_send({'id': preview['id']})['status'], 'sent')
        self.assertEqual(self.client.sends, [('1001', original, {'parse_mode': None, 'link_preview': False})])
        with self.assertRaises(AccountError):
            self.account.confirm_send({'id': preview['id']})
        self.assertEqual(len(self.client.sends), 1)

    def test_concurrent_confirm_dispatches_at_most_once(self):
        self.load()
        preview = self.account.preview_send({'chat_id': '1001', 'text': 'One concurrent attempt'})
        values = []
        def confirm():
            try:
                values.append(self.account.confirm_send({'id': preview['id']}))
            except AccountError:
                values.append({'status': 'rejected'})
        threads = [threading.Thread(target=confirm) for unused in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(2)
        self.assertEqual(sorted(value['status'] for value in values), ['rejected', 'sent'])
        self.assertEqual(len(self.client.sends), 1)

    def test_emoji_limit_nul_surrogate_and_invalid_reply_rejected_before_send(self):
        self.load()
        self.account.preview_send({'chat_id': '1001', 'text': '😀' * 2000})
        for body in ('😀' * 2001, 'bad\x00body', '\ud800', '   '):
            with self.assertRaises(AccountError):
                self.account.preview_send({'chat_id': '1001', 'text': body})
        for reply in (True, 0, -1, 2**31, '1'):
            with self.assertRaises(AccountError):
                self.account.preview_send({'chat_id': '1001', 'text': 'Body', 'reply_to_id': reply})
        self.assertEqual(self.client.sends, [])

    def test_reply_requires_loaded_same_chat_message(self):
        self.load()
        with self.assertRaises(AccountError) as result:
            self.account.preview_send({'chat_id': '1001', 'text': 'Reply', 'reply_to_id': 120})
        self.assertEqual(result.exception.code, 'reply_unavailable')
        self.account.read({'chat_id': '1001'})
        with self.assertRaises(AccountError):
            self.account.preview_send({'chat_id': '1002', 'text': 'Reply', 'reply_to_id': 120})
        self.assertEqual(self.client.sends, [])

    def test_reply_is_verified_twice_and_bound_to_original_peer_text_and_id(self):
        self.load()
        self.account.read({'chat_id': '1001'})
        preview = self.account.preview_send({'chat_id': '1001', 'text': 'Exact reply', 'reply_to_id': 120})
        self.assertEqual(preview['reply_to_id'], 120)
        self.account.read({'chat_id': '1002'})
        result = self.account.confirm_send({'id': preview['id']})
        self.assertEqual(result['status'], 'sent')
        self.assertEqual(result['reply_to_id'], 120)
        self.assertEqual(self.client.sends[-1], ('1001', 'Exact reply', {'parse_mode': None, 'link_preview': False, 'reply_to': 120}))
        self.assertEqual(len([call for call in self.client.message_calls if 'ids' in call[1]]), 2)

    def test_deleted_or_wrong_peer_reply_cannot_be_prepared(self):
        self.load()
        self.account.read({'chat_id': '1001'})
        self.client.history['1001'][0] = message(120, chat=1002)
        with self.assertRaises(AccountError) as result:
            self.account.preview_send({'chat_id': '1001', 'text': 'Reply', 'reply_to_id': 120})
        self.assertEqual(result.exception.code, 'reply_unavailable')
        self.client.history['1001'] = []
        with self.assertRaises(AccountError):
            self.account.preview_send({'chat_id': '1001', 'text': 'Reply', 'reply_to_id': 120})
        self.assertEqual(self.client.sends, [])

    def test_reply_deleted_after_preview_consumes_token_without_send(self):
        self.load()
        self.account.read({'chat_id': '1001'})
        preview = self.account.preview_send({'chat_id': '1001', 'text': 'Reply', 'reply_to_id': 120})
        self.client.history['1001'] = []
        result = self.account.confirm_send({'id': preview['id']})
        self.assertEqual(result['status'], 'cancelled')
        with self.assertRaises(AccountError):
            self.account.confirm_send({'id': preview['id']})
        self.assertEqual(self.client.sends, [])

    def test_confirmed_outgoing_message_can_be_replied_to_after_server_verification(self):
        self.load()
        preview = self.account.preview_send({'chat_id': '1001', 'text': 'Outgoing'})
        result = self.account.confirm_send({'id': preview['id']})
        reply = self.account.preview_send({'chat_id': '1001', 'text': 'Follow-up', 'reply_to_id': result['message_id']})
        self.assertEqual(reply['reply_to_id'], 9999)
        self.assertEqual(self.client.message_calls[-1], ('1001', {'ids': 9999}))

    def test_stop_during_reply_lookup_cancels_generation_without_send(self):
        self.load()
        self.account.read({'chat_id': '1001'})
        preview = self.account.preview_send({'chat_id': '1001', 'text': 'Reply', 'reply_to_id': 120})
        self.client.lookup_started.clear()
        self.client.lookup_delay = 10
        values = []
        thread = threading.Thread(target=lambda: values.append(self.account.confirm_send({'id': preview['id']})))
        thread.start()
        self.assertTrue(self.client.lookup_started.wait(1))
        self.account.stop()
        thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertEqual(values[0]['status'], 'cancelled')
        self.assertEqual(self.client.sends, [])
        self.assertFalse(self.account.status()['authorized'])

    def test_timeout_after_dispatch_is_unknown_and_never_replays(self):
        self.load()
        self.account.timeout = .05
        self.client.send_delay = 10
        preview = self.account.preview_send({'chat_id': '1001', 'text': 'One attempt'})
        result = self.account.confirm_send({'id': preview['id']})
        self.assertEqual(result['status'], 'unknown')
        self.assertEqual(len(self.client.sends), 1)
        with self.assertRaises(AccountError):
            self.account.confirm_send({'id': preview['id']})
        self.assertEqual(len(self.client.sends), 1)

    def test_safe_flood_error_preserves_bounded_retry_without_raw_exception(self):
        self.client.dialog_error = errors.FloodWaitError(request=None, capture=1000000)
        status, value = self.runtime().handle('POST', '/telegram/account/chats', {})
        self.assertEqual(status, 429)
        self.assertEqual(value['error_kind'], 'telegram_account_safe')
        self.assertEqual(value['code'], 'rate_limited')
        self.assertEqual(value['retry_after_seconds'], 86400)
        self.assertNotIn('1000000', value['error'])

    def test_network_and_session_expiry_statuses_are_actionable_and_private(self):
        self.client.dialog_error = OSError('SECRET request details')
        status, value = self.runtime().handle('POST', '/telegram/account/chats', {})
        self.assertEqual(status, 503)
        self.assertEqual(value['code'], 'network_unavailable')
        self.assertNotIn('SECRET', value['error'])
        self.assertFalse(self.account.status()['connected'])
        self.client.dialog_error = errors.SessionRevokedError(request=None)
        status, value = self.runtime().handle('POST', '/telegram/account/chats', {})
        self.assertEqual(value['code'], 'session_expired')
        self.assertFalse(self.account.status()['authorized'])
        self.assertFalse(self.account.status()['connected'])

    def test_compose_and_resolve_routes_retain_flat_contract(self):
        self.load()
        runtime = self.runtime()
        status, value = runtime.handle('POST', '/telegram/account/compose', {'chat_id': '1001', 'text': 'Literal'})
        self.assertEqual(status, 200)
        self.assertEqual(value['text'], 'Literal')
        self.assertEqual(value['session_epoch'], self.account.revision())
        self.assertEqual(runtime.handle('POST', '/telegram/account/resolve', {'recipient': 'self'})[1]['chat']['chat_id'], '777')
        self.assertEqual(self.client.sends, [])

    def test_ai_draft_reports_provider_and_reply_without_sending(self):
        self.load()
        self.account.read({'chat_id': '1001'})
        requests = []
        def request(path, body, **options):
            requests.append((path, body, options))
            return {'provider': 'groq', 'model': 'synthetic-model', 'choices': [{'message': {'content': 'Generated reply'}}]}
        status, value = self.runtime(request).handle('POST', '/telegram/account/draft',
                {'chat_id': '1001', 'instruction': 'Qisqa javob', 'reply_to_id': 120})
        self.assertEqual(status, 200)
        self.assertEqual(value['ai'], {'provider': 'groq', 'model': 'synthetic-model'})
        self.assertEqual(value['reply_to_id'], 120)
        self.assertEqual(self.client.sends, [])
        self.assertEqual(requests[0][1]['model'], 'localai-auto')
        self.assertIn('TELEGRAM_XABARLARI', requests[0][1]['messages'][1]['content'])

    def test_ai_failures_do_not_expose_provider_errors_or_prepare_send(self):
        self.load()
        def request(*unused, **kwargs):
            raise CapabilityError('PRIVATE bearer key and model request')
        status, value = self.runtime(request).handle('POST', '/telegram/account/draft',
                            {'chat_id': '1001', 'instruction': 'Qisqa javob'})
        self.assertEqual(status, 503)
        self.assertEqual(value['code'], 'ai_unavailable')
        self.assertNotIn('PRIVATE', value['error'])
        self.assertIsNone(self.account._pending)

    def test_ai_older_reply_is_verified_and_included_in_prompt_before_generation(self):
        self.load()
        self.account.read({'chat_id': '1001', 'before_id': 21})
        requests = []
        def request(path, body, **options):
            requests.append(body)
            return {'provider': 'ollama', 'model': 'synthetic', 'choices': [{'message': {'content': 'Answer to older message'}}]}
        status, value = self.runtime(request).handle('POST', '/telegram/account/draft',
                       {'chat_id': '1001', 'instruction': 'Tanlangan xabarga javob ber', 'reply_to_id': 10})
        self.assertEqual(status, 200)
        prompt = requests[0]['messages'][1]['content']
        self.assertIn('JAVOB_BERILADIGAN_XABAR:', prompt)
        self.assertIn('"id": 10', prompt)
        self.assertIn('Message 10', prompt)
        self.assertEqual(value['reply_to_id'], 10)
        self.assertEqual(self.client.sends, [])

    def test_ai_invalid_reply_does_not_invoke_inference(self):
        self.load()
        requests = []
        runtime = self.runtime(lambda *args, **options: requests.append(args))
        status, value = runtime.handle('POST', '/telegram/account/draft',
                    {'chat_id': '1001', 'instruction': 'Javob ber', 'reply_to_id': 10})
        self.assertEqual(status, 400)
        self.assertEqual(value['code'], 'reply_unavailable')
        self.assertEqual(requests, [])

    def test_ai_untrusted_metadata_is_sanitized_without_losing_valid_preview(self):
        self.load()
        runtime = self.runtime(lambda *args, **options: {'provider': 'other', 'model': '\ud800',
                                  'choices': [{'message': {'content': 'Valid text'}}]})
        status, value = runtime.handle('POST', '/telegram/account/draft', {'chat_id': '1001', 'instruction': 'Javob ber'})
        self.assertEqual(status, 200)
        self.assertEqual(value['ai'], {'provider': None, 'model': None})
        self.assertEqual(value['text'], 'Valid text')

    def test_stop_during_ai_generation_does_not_restore_pending_or_session(self):
        self.load()
        def request(*unused, **kwargs):
            self.account.stop()
            return {'choices': [{'message': {'content': 'Late reply'}}]}
        status, value = self.runtime(request).handle('POST', '/telegram/account/draft',
                            {'chat_id': '1001', 'instruction': 'Qisqa javob'})
        self.assertEqual(status, 400)
        self.assertEqual(value['error_kind'], 'telegram_account_safe')
        self.assertIsNone(self.account._pending)
        self.assertFalse(self.account.status()['authorized'])
        self.assertEqual(self.client.sends, [])


class TextTests(unittest.TestCase):
    def test_utf16_counts_preserves_body_and_never_splits_emoji(self):
        self.assertEqual(utf16_units('😀'), 2)
        self.assertEqual(message_text('  Body\n😀  '), '  Body\n😀  ')
        self.assertEqual(truncate_utf16('A😀B', 2), ('A', True))
        self.assertEqual(truncate_utf16('A😀B', 3), ('A😀', True))

    def test_queries_reject_controls_surrogates_and_excess_utf16(self):
        self.assertEqual(bounded_query('  search  '), 'search')
        for query in ('\r', '\n', '\x7f', '\x85', '\x00', '\ud800', '😀' * 51):
            with self.assertRaises(AccountError):
                bounded_query(query)

    def test_command_grammar_preserves_literal_and_rejects_excess_emojis(self):
        valid = parse_command('@testperson ga "' + '😀' * 2000 + '" yubor')
        self.assertEqual(valid['text'], '😀' * 2000)
        invalid = parse_command('@testperson ga "' + '😀' * 2001 + '" yubor')
        self.assertEqual(invalid['kind'], 'clarification')
        with self.assertRaises(ValueError):
            parse_command('@testperson ga "\ud800" yubor')


if __name__ == '__main__':
    unittest.main()
