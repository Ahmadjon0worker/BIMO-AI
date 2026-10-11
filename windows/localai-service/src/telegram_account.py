"""Explicit personal Telegram RPCs; encrypted credentials and memory sessions only.

No update handlers, background chat polling, implicit login or automatic replies.
Every explicit send consumes one recipient/text proof before attempting RPC.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import copy
import importlib.util
import json
import logging
from pathlib import Path
import re
import secrets
import threading
import time

PHONE = re.compile(r'^\+[1-9][0-9]{6,14}$')
HASH = re.compile(r'^[a-fA-F0-9]{32}$')
CHAT_ID = re.compile(r'^-?[1-9][0-9]{0,18}$')
USERNAME = re.compile(r'^[a-zA-Z][a-zA-Z0-9_]{4,31}$')
MAX_SECONDS = 25
PREVIEW_SECONDS = 120
CURSOR_SECONDS = 300
MAX_DIALOG_CACHE = 1000
MAX_MESSAGE_REFS = 512
FILTERS = ('all', 'unread', 'users', 'groups', 'channels')


class AccountError(ValueError):
    """Only locally written messages may cross the API boundary."""
    def __init__(self, message, *, code='account_error', retry_after_seconds=None):
        self.safe_message = message
        self.code = code
        self.retry_after_seconds = retry_after_seconds
        super().__init__(message)

    def response(self):
        value = {'error': self.safe_message, 'error_kind': 'telegram_account_safe', 'code': self.code}
        if isinstance(self.retry_after_seconds, int) and not isinstance(self.retry_after_seconds, bool):
            value['retry_after_seconds'] = min(86400, max(1, self.retry_after_seconds))
        return value


def utf16_units(value):
    try:
        return len(value.encode('utf-16-le')) // 2
    except UnicodeEncodeError:
        raise AccountError('Matnda yaroqsiz Unicode belgisi bor', code='invalid_text') from None


def message_text(value):
    if (not isinstance(value, str) or not value.strip() or '\x00' in value
            or utf16_units(value) > 4000):
        raise AccountError('Xabar matni 1–4000 belgidan iborat bo‘lsin; emoji ikkita belgi hisoblanadi', code='invalid_text')
    return value


def bounded_query(value):
    if (not isinstance(value, str) or any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in value)
            or utf16_units(value) > 100):
        raise AccountError('Qidiruv matni 100 belgidan oshmasin', code='invalid_query')
    return value.strip()


def positive_message_id(value):
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 2**31 - 1:
        raise AccountError('Xabar ID noto‘g‘ri', code='invalid_message_id')
    return value


def truncate_utf16(value, maximum):
    # Decode at a complete UTF-16 boundary; never split an emoji surrogate pair.
    try:
        encoded = value.encode('utf-16-le')
    except UnicodeEncodeError:
        value = value.encode('utf-8', errors='replace').decode('utf-8')
        encoded = value.encode('utf-16-le')
    return encoded[:maximum * 2].decode('utf-16-le', errors='ignore'), len(encoded) // 2 > maximum


def safe_rpc_error(error):
    """Map known RPC types to local text, never remote text/request details."""
    fallback = 'Telegram amali bajarilmadi; ulanish va sozlamani tekshiring'
    if isinstance(error, OSError):
        return 'Telegramga tarmoq orqali ulanib bo‘lmadi. Internet/VPN holatini tekshiring va keyin o‘zingiz qayta urinib ko‘ring.'
    try:
        from telethon import errors
    except ImportError:
        return fallback
    messages = (
        (errors.PhoneCodeInvalidError, 'Tasdiqlash kodi noto‘g‘ri. Telegramdagi eng yangi kodni qayta kiriting.'),
        (errors.PhoneCodeExpiredError, 'Kodning vaqti tugagan. Ulanishni uzing va telefon raqami bilan yangi kod so‘rang.'),
        (errors.PasswordHashInvalidError, '2FA parol noto‘g‘ri. Parolni mahalliy oynada qayta kiriting.'),
        (errors.PhoneNumberInvalidError, 'Telefon raqami noto‘g‘ri. + va mamlakat kodi bilan xalqaro shaklda qayta kiriting.'),
        (errors.PhoneNumberBannedError, 'Telegram bu telefon raqamini bloklagan. Telegram yordamiga murojaat qiling.'),
        (errors.PhoneNumberFloodError, 'Telegram kod so‘rashni vaqtincha cheklagan. Biroz kuting va keyin o‘zingiz qayta urinib ko‘ring.'),
        (errors.ApiIdInvalidError, 'Telegram API ID yoki API hash yaroqsiz. App API sozlamalarini tekshiring.'),
        (errors.ApiIdPublishedFloodError, 'Telegram bu API ilovasini vaqtincha cheklagan. App API sozlamalarini tekshiring.'),
        (errors.AuthRestartError, 'Telegram kirishni qayta boshlashni so‘radi. Ulanishni uzing va keyin o‘zingiz qayta urinib ko‘ring.'),
        (errors.SendCodeUnavailableError, 'Telegram hozir tasdiqlash kodini yubora olmaydi. Rasmiy Telegram ilovasini tekshiring va keyinroq o‘zingiz qayta urinib ko‘ring.'),
        (errors.SmsCodeCreateFailedError, 'Telegram SMS kodini yarata olmadi. Rasmiy Telegram ilovasini tekshiring va keyinroq o‘zingiz qayta urinib ko‘ring.'),
        (errors.PhonePasswordFloodError, 'Telegram kirish urinishlarini vaqtincha cheklagan. Biroz kuting va keyin o‘zingiz qayta urinib ko‘ring.'),
        (errors.PhonePasswordProtectedError, 'Telegram bu raqam uchun qo‘shimcha kirish himoyasini talab qildi. Rasmiy Telegram ilovasini tekshiring.'),
        (errors.PhoneNumberAppSignupForbiddenError, 'Ushbu Telegram ilovasi orqali yangi akkaunt ochib bo‘lmaydi. Avval rasmiy Telegram ilovasida mavjud akkauntga kiring.'),
        (errors.UpdateAppToLoginError, 'Telegram ushbu login klientini yangilashni talab qildi. Kirish hozircha bajarilmadi.'),
        (errors.ConnectionApiIdInvalidError, 'Telegram ulanishidagi API ID yaroqsiz. App API sozlamalarini tekshiring.'),
        (errors.PhoneMigrateError, 'Telegram ulanish manzilini yana o‘zgartirdi. Ulanishni uzing va keyin o‘zingiz qayta urinib ko‘ring.'),
        (errors.NetworkMigrateError, 'Telegram ulanish manzilini yana o‘zgartirdi. Ulanishni uzing va keyin o‘zingiz qayta urinib ko‘ring.'),
    )
    for error_type, message in messages:
        if isinstance(error, error_type):
            return message
    if isinstance(error, errors.FloodWaitError):
        seconds = getattr(error, 'seconds', None)
        seconds = min(86400, max(1, seconds)) if isinstance(seconds, int) and not isinstance(seconds, bool) else 1
        return f'Telegram vaqtincha chekladi. Kamida {seconds} soniya kuting va keyin o‘zingiz qayta urinib ko‘ring.'
    # Only actual exported library classes supply a diagnostic code. Never
    # trust remote RPC.message, request repr, or an arbitrary/impostor type.
    kind = type(error).__name__
    trusted = (isinstance(error, errors.RPCError) and re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,79}', kind)
               and getattr(errors, kind, None) is type(error))
    if trusted:
        if isinstance(error, (errors.ServerError, errors.TimedOutError)):
            fallback = 'Telegram serverida vaqtinchalik xato. Biroz kuting va keyin o‘zingiz qayta urinib ko‘ring.'
        return f'{fallback} [{kind}]'
    return fallback


def rpc_account_error(error):
    code, seconds = 'account_error', None
    if isinstance(error, OSError):
        code = 'network_unavailable'
    try:
        from telethon import errors
        if isinstance(error, errors.FloodWaitError):
            code, seconds = 'rate_limited', getattr(error, 'seconds', None)
        elif isinstance(error, (errors.AuthKeyUnregisteredError, errors.SessionRevokedError, errors.SessionExpiredError)):
            code = 'session_expired'
        elif isinstance(error, errors.PhoneCodeInvalidError):
            code = 'code_invalid'
        elif isinstance(error, errors.PhoneCodeExpiredError):
            code = 'code_expired'
        elif isinstance(error, errors.PasswordHashInvalidError):
            code = 'password_invalid'
    except ImportError:
        pass
    text = safe_rpc_error(error)
    if code == 'session_expired':
        text = 'Telegram sessiyasi tugagan. Telefon raqami bilan akkauntga qayta kiring.'
    return AccountError(text, code=code, retry_after_seconds=seconds)


class EncryptedJSONVault:
    def __init__(self, path):
        from capabilities import TokenVault
        self.vault = TokenVault(Path(path))

    def read(self):
        value = self.vault.read()
        return None if value is None else json.loads(value)

    def write(self, value):
        self.vault.write(json.dumps(value, ensure_ascii=True, separators=(',', ':')))


def default_client_factory(*, api_id, api_hash, session_string):
    from telethon import TelegramClient
    from telethon.sessions import StringSession
    # Prevent third-party diagnostic handlers from persisting auth/RPC details.
    logger = logging.Logger('localai.personal_telegram', level=logging.CRITICAL + 1)
    logger.addHandler(logging.NullHandler())
    logger.propagate = False
    return TelegramClient(StringSession(session_string), api_id, api_hash,
        timeout=10, request_retries=0, raise_last_call_error=True,
        connection_retries=0, auto_reconnect=False,
        flood_sleep_threshold=0, receive_updates=False, catch_up=False,
        base_logger=logger, device_model='LocalAI Coucou', app_version='1.0', lang_code='uz')


def canonical_chat_id(value):
    if not isinstance(value, str) or not CHAT_ID.fullmatch(value) or not -(2**63) < int(value) < 2**63:
        raise AccountError('Chat ID noto‘g‘ri; ro‘yxatdan chat tanlang')
    return value


def fields(payload, allowed):
    if not isinstance(payload, dict) or set(payload) - set(allowed):
        raise AccountError('Telegram so‘rovi maydonlari noto‘g‘ri')


class PersonalTelegram:
    def __init__(self, root, *, vault=None, client_factory=None, timeout_seconds=MAX_SECONDS):
        self.root = Path(root)
        self.vault = vault or EncryptedJSONVault(self.root / 'config' / 'telegram-account.dpapi')
        self.client_factory = client_factory or default_client_factory
        self.available = client_factory is not None or importlib.util.find_spec('telethon') is not None
        self.timeout = min(MAX_SECONDS, max(.05, float(timeout_seconds)))
        self.lock = threading.RLock()
        self.lifecycle = threading.RLock()
        self._generation = 0
        self._loop = None
        self._thread = None
        self._serial = None
        self._futures = set()
        self._client = None
        self._teardown_clients = []
        self._phone = None
        self._phone_code_hash = None
        self._credentials = None
        self._dialogs = {}
        self._resolved = {}  # Explicit username results, separate from the 30-chat list.
        self._pending = None
        self._cursors = {}
        self._message_refs = {}
        self._state = 'disconnected'
        self._authorized = False
        self._username = None
        self._selected = None
        self._last_error = None
        self._last_error_code = None
        self._closed = False
        try:
            saved = self.vault.read()
            if saved is not None:
                self._validate_credentials(saved)
                self._credentials = copy.deepcopy(saved)
        except Exception:
            self._last_error = 'Saqlangan Telegram sozlamasini qayta kiriting'

    @staticmethod
    def _validate_credentials(value):
        if not isinstance(value, dict):
            raise AccountError('Telegram sozlamasi noto‘g‘ri')
        api_id, api_hash, session = value.get('api_id'), value.get('api_hash'), value.get('session', '')
        if isinstance(api_id, bool) or not isinstance(api_id, int) or not 1 <= api_id <= 2**31 - 1:
            raise AccountError('API ID musbat butun son bo‘lsin')
        if not isinstance(api_hash, str) or not HASH.fullmatch(api_hash):
            raise AccountError('API hash 32 ta hex belgidan iborat bo‘lsin')
        if not isinstance(session, str) or len(session) > 2048:
            raise AccountError('Saqlangan Telegram sessiyasi noto‘g‘ri')

    def revision(self):
        with self.lock:
            return self._generation

    def status(self):
        with self.lock:
            saved = self._credentials or {}
            connected = False
            if self._client is not None:
                try:
                    connected = self._client.is_connected() is True
                except Exception:
                    pass
            if self._last_error_code in ('network_unavailable', 'session_expired', 'timeout'):
                connected = False
            return {'available': self.available, 'configured': self._credentials is not None,
                'api_id': saved.get('api_id'), 'state': self._state, 'authorized': self._authorized,
                'busy': any(not item.done() for item in self._futures),
                'has_saved_session': bool(saved.get('session')), 'username': self._username,
                'dialog_count': len(self._dialogs), 'selected_chat_id': self._selected,
                'last_error': self._last_error, 'stop_complete': not self._teardown_clients,
                'teardown_pending': bool(self._teardown_clients), 'connected': connected,
                'session_epoch': self._generation}

    def _ensure_loop(self):
        with self.lock:
            if self._closed:
                raise AccountError('Telegram vositasi yopilgan')
            if self._loop is not None:
                return self._loop
            loop = asyncio.new_event_loop()
            ready = threading.Event()
            def run():
                asyncio.set_event_loop(loop)
                # RPC diagnostics can embed auth fields. Public calls already
                # expose locally written errors; never log background contexts.
                loop.set_exception_handler(lambda unused_loop, unused_context: None)
                self._serial = asyncio.Lock()
                ready.set()
                loop.run_forever()
            self._loop = loop
            self._thread = threading.Thread(target=run, name='LocalAI-Telegram-account', daemon=True)
            self._thread.start()
        if not ready.wait(2):
            raise AccountError('Telegram vositasi ishga tushmadi')
        return loop

    def _check(self, generation, *, authorized=False):
        with self.lock:
            if generation != self._generation or self._closed:
                raise AccountError('Telegram amali bekor qilingan', code='cancelled')
            if authorized and (not self._authorized or self._client is None):
                raise AccountError('Avval shaxsiy Telegram akkauntiga kiring', code='login_required')

    def _submit(self, factory, *, generation=None, serial=True, timeout=None):
        with self.lock:
            generation = self._generation if generation is None else generation
        self._check(generation)
        loop = self._ensure_loop()
        deadline = self.timeout if timeout is None else min(MAX_SECONDS, timeout)
        async def execute():
            async def operation():
                self._check(generation)
                if serial:
                    async with self._serial:
                        self._check(generation)
                        return await factory(generation)
                return await factory(generation)
            task = asyncio.create_task(operation())
            def consume_result(item):
                if not item.cancelled():
                    item.exception()  # Retrieve late exceptions without printing RPC details.
            task.add_done_callback(consume_result)
            return await asyncio.wait_for(task, timeout=deadline)
        with self.lock:
            self._check(generation)
            future = asyncio.run_coroutine_threadsafe(execute(), loop)
            self._futures.add(future)
        try:
            result = future.result(timeout=deadline + .5)
            with self.lock:
                if generation == self._generation:
                    self._last_error = self._last_error_code = None
            return result
        except (concurrent.futures.TimeoutError, TimeoutError):
            future.cancel()
            with self.lock:
                if generation == self._generation:
                    self._last_error = 'Telegram so‘rovi vaqti tugadi; holatni tekshiring'
                    self._last_error_code = 'timeout'
            raise AccountError('Telegram so‘rovi vaqti tugadi; holatni tekshiring', code='timeout') from None
        except concurrent.futures.CancelledError:
            raise AccountError('Telegram amali bekor qilingan') from None
        except AccountError as error:
            with self.lock:
                if generation == self._generation:
                    self._last_error = error.safe_message
                    self._last_error_code = error.code
            raise
        except Exception as error:
            safe = rpc_account_error(error)
            with self.lock:
                if generation == self._generation:
                    self._last_error, self._last_error_code = safe.safe_message, safe.code
                    if safe.code == 'session_expired':
                        self._authorized = False
                        self._state = 'error'
            raise safe from None
        finally:
            with self.lock:
                self._futures.discard(future)

    def _invalidate(self):
        with self.lock:
            self._generation += 1
            generation = self._generation
            futures = list(self._futures)
            client, self._client = self._client, None
            if client is not None and all(item is not client for item in self._teardown_clients):
                self._teardown_clients.append(client)
            self._dialogs.clear()
            self._resolved.clear()
            self._cursors.clear()
            self._message_refs.clear()
            self._pending = None
            self._selected = None
            self._phone = self._phone_code_hash = None
            self._authorized = False
            self._username = None
            self._state = 'disconnected'
            self._last_error = None
            self._last_error_code = None
        for future in futures:
            future.cancel()
        return generation, list(self._teardown_clients)

    def stop(self):
        with self.lifecycle:
            generation, clients = self._invalidate()
            if clients:
                async def cleanup(unused):
                    for client in clients:
                        await client.disconnect()
                        with self.lock:
                            self._teardown_clients = [item for item in self._teardown_clients if item is not client]
                try:
                    self._submit(cleanup, generation=generation, serial=False, timeout=min(5, self.timeout))
                except AccountError:
                    with self.lock:
                        if self._generation == generation:
                            self._state = 'error'
                            self._last_error = 'Ulanish uzilmoqda; oldingi amallar bekor qilindi'
            return self.status()

    def disconnect(self, payload=None):
        fields({} if payload is None else payload, ())
        return self.stop()

    def configure(self, payload):
        fields(payload, ('api_id', 'api_hash'))
        with self.lifecycle:
            with self.lock:
                old = dict(self._credentials or {})
            supplied_hash = payload.get('api_hash', '')
            if not isinstance(supplied_hash, str):
                raise AccountError('API hash maydoni noto‘g‘ri')
            if not supplied_hash and payload.get('api_id') != old.get('api_id'):
                raise AccountError('API ID o‘zgarsa yangi API hash ham kiriting')
            value = {'version': 1, 'api_id': payload.get('api_id'),
                'api_hash': supplied_hash or old.get('api_hash', ''), 'session': ''}
            self._validate_credentials(value)
            value['api_hash'] = value['api_hash'].lower()
            if old.get('api_id') == value['api_id'] and old.get('api_hash') == value['api_hash']:
                value['session'] = old.get('session', '')
            self.stop()
            with self.lock:
                self._generation += 1
                self.vault.write(value)
                self._credentials = value
                if not self._teardown_clients:
                    self._last_error = None
            return self.status()

    def connect(self, payload):
        fields(payload, ('phone',))
        # A failed connection's bounded teardown must finish before a retry
        # can capture credentials/generation and schedule a fresh client.
        with self.lifecycle:
            with self.lock:
                credentials = copy.deepcopy(self._credentials)
                generation = self._generation
                if self._teardown_clients:
                    raise AccountError('Avval eski Telegram ulanishini to‘liq uzing')
            if credentials is None or not self.available:
                raise AccountError('Avval API ID va API hash sozlang')
        phone = payload.get('phone', '')
        if not isinstance(phone, str) or (phone and not PHONE.fullmatch(phone)):
            raise AccountError('Telefon raqamini + va mamlakat kodi bilan xalqaro shaklda kiriting')
        if not phone and not credentials.get('session'):
            raise AccountError('Birinchi kirishda telefon raqamini mahalliy oynaga kiriting')
        async def operation(revision):
            with self.lock:
                self._check(revision)
                if self._teardown_clients:
                    raise AccountError('Avval eski Telegram ulanishini to‘liq uzing')
                if self._client is not None:
                    raise AccountError('Avval mavjud Telegram ulanishini uzing')
                self._state = 'connecting'
                self._last_error = None
                client = self.client_factory(api_id=credentials['api_id'], api_hash=credentials['api_hash'],
                                             session_string=credentials.get('session', ''))
                self._client = client
                self._phone = phone or None
            await client.connect()
            self._check(revision)
            authorized = await client.is_user_authorized()
            self._check(revision)
            if authorized:
                me = await client.get_me()
                self._check(revision)
                actual = str(getattr(me, 'phone', '') or '').lstrip('+')
                if phone and actual != phone.lstrip('+'):
                    raise AccountError('Saqlangan sessiya boshqa akkauntga tegishli; ulanishni uzing')
                self._persist_authorized(revision, client, me)
            else:
                if not phone:
                    raise AccountError('Saqlangan sessiya yaroqsiz; telefon raqami bilan qayta kiring')
                result = await self._request_login_code(client, phone, revision,
                    credentials['api_id'], credentials['api_hash'])
                self._check(revision)
                with self.lock:
                    self._check(revision)
                    self._phone_code_hash = result.phone_code_hash
                    self._state = 'code_required'
                    self._last_error = None
            return self.status()
        try:
            self._submit(operation, generation=generation)
            return self.status()
        except AccountError:
            self._recover_failed_connect(generation)
            raise

    def _recover_failed_connect(self, generation):
        # Never clean or overwrite a newer session after Stop/configuration.
        # Reuse Stop's ownership, cancellation and pending-teardown behavior.
        with self.lifecycle:
            with self.lock:
                if self._generation != generation or self._state != 'connecting':
                    return
                failure = self._last_error or 'Telegramga ulanish boshlanmadi. Telefon va API sozlamalarini tekshiring.'
            result = self.stop()
            with self.lock:
                self._state = 'error'
                self._last_error = failure
                if not result['stop_complete']:
                    self._last_error += ' Ulanish hali uzilmoqda; Ulanishni uzish tugmasi bilan qayta tekshiring.'

    async def _request_login_code(self, client, phone, generation, api_id, api_hash):
        from telethon.errors import NetworkMigrateError, PhoneMigrateError
        from telethon.tl.functions.auth import SendCodeRequest
        from telethon.tl.types import CodeSettings
        from telethon.tl.types.auth import (SentCode, SentCodePaymentRequired,
            SentCodeSuccess, SentCodeTypeApp, SentCodeTypeCall, SentCodeTypeSms,
            SentCodeTypeEmailCode, SentCodeTypeSetUpEmailRequired)
        for attempt in range(2):
            await asyncio.sleep(0)
            self._check(generation)
            before_dc = getattr(client.session, 'dc_id', None)
            try:
                # The public RPC avoids the high-level helper's AuthRestart
                # recursion and its .type access on PaymentRequired results.
                result = await client(SendCodeRequest(phone_number=phone[1:],
                    api_id=api_id, api_hash=api_hash, settings=CodeSettings()))
            except (PhoneMigrateError, NetworkMigrateError) as error:
                self._check(generation)
                target = error.new_dc
                switched = getattr(client.session, 'dc_id', None)
                with self.lock:
                    self._check(generation)
                    if (attempt or type(error) not in (PhoneMigrateError, NetworkMigrateError)
                            or self._authorized or not isinstance(target, int) or isinstance(target, bool)
                            or not 1 <= target <= 255 or target == before_dc or switched != target):
                        raise
                # _call already awaited _switch_dc on the unauthorized client.
                # The rejected request at the old DC did not deliver a code.
                # Reuse that switched client; never switch or retry other RPCs.
                continue
            self._check(generation)
            if isinstance(result, SentCodePaymentRequired):
                raise AccountError('Telegram bu login uchun to‘lov/Premium bosqichini talab qildi. To‘lov qilinmadi; rasmiy Telegram ilovasida kirishni tekshiring.')
            if isinstance(result, SentCodeSuccess):
                raise AccountError('Telegram kutilmagan tayyor kirish natijasini qaytardi. Bu oqim qo‘llanmaydi; yangi sessiya saqlanmadi.')
            if not isinstance(result, SentCode):
                raise AccountError('Telegram kutilmagan kod natijasini qaytardi. Rasmiy Telegram ilovasida kirishni tekshiring.')
            if isinstance(result.type, (SentCodeTypeEmailCode, SentCodeTypeSetUpEmailRequired)):
                raise AccountError('Telegram email bilan qo‘shimcha kirish bosqichini talab qildi. Bu bosqichni rasmiy Telegram ilovasida bajaring.')
            length = getattr(result.type, 'length', None)
            if (type(result.type) not in (SentCodeTypeApp, SentCodeTypeSms, SentCodeTypeCall)
                    or not isinstance(length, int) or isinstance(length, bool) or not 4 <= length <= 8):
                raise AccountError('Telegram bu oynada qo‘llanmaydigan tasdiqlash usulini talab qildi. Rasmiy Telegram ilovasida kirishni tekshiring.')
            code_hash = result.phone_code_hash
            if not isinstance(code_hash, str) or not 1 <= len(code_hash) <= 2048 or '\x00' in code_hash:
                raise AccountError('Telegram kod sessiyasini qaytarmadi. Ulanishni uzing va keyin o‘zingiz qayta urinib ko‘ring.')
            return result

    def _persist_authorized(self, generation, client, me):
        with self.lock:
            self._check(generation)
            saved = dict(self._credentials)
            saved['session'] = client.session.save()
            self._validate_credentials(saved)
            self.vault.write(saved)
            self._credentials = saved
            self._authorized = True
            self._state = 'authorized'
            username = getattr(me, 'username', None)
            self._username = username[:64] if isinstance(username, str) else None
            self._cache_self(me)
            self._phone = self._phone_code_hash = None
            self._last_error = None

    def verify(self, payload):
        fields(payload, ('code', 'password'))
        if set(payload) not in ({'code'}, {'password'}):
            raise AccountError('Kod yoki 2FA parolni alohida mahalliy oynaga kiriting')
        code, password = payload.get('code'), payload.get('password')
        if 'code' in payload and (not isinstance(code, str) or not re.fullmatch(r'[0-9]{4,8}', code)):
            raise AccountError('Tasdiqlash kodi shakli noto‘g‘ri')
        if 'password' in payload and (not isinstance(password, str) or not 1 <= len(password) <= 256):
            raise AccountError('2FA parol maydoni noto‘g‘ri')
        async def operation(generation):
            from telethon.errors import SessionPasswordNeededError
            with self.lock:
                client, phone, code_hash, state = self._client, self._phone, self._phone_code_hash, self._state
            if client is None or (code is not None and state != 'code_required') or (password is not None and state != 'password_required'):
                raise AccountError('Avval Telegram kirish bosqichini boshlang')
            try:
                if code is not None:
                    me = await client.sign_in(phone=phone, code=code, phone_code_hash=code_hash)
                else:
                    me = await client.sign_in(password=password)
            except SessionPasswordNeededError:
                self._check(generation)
                with self.lock:
                    self._check(generation)
                    self._state = 'password_required'
                    self._phone_code_hash = None
                    self._last_error = None
                return self.status()
            self._check(generation)
            if not await client.is_user_authorized():
                raise AccountError('Telegram kirishi tasdiqlanmadi')
            self._check(generation)
            self._persist_authorized(generation, client, me)
            return self.status()
        self._submit(operation)
        return self.status()

    @staticmethod
    def _fingerprint(peer):
        return (type(peer).__name__, getattr(peer, 'user_id', None), getattr(peer, 'chat_id', None),
                getattr(peer, 'channel_id', None), getattr(peer, 'access_hash', None))

    @staticmethod
    def _can_send(entity):
        if any(getattr(entity, key, False) for key in ('deleted', 'left', 'kicked')):
            return False
        admin = bool(getattr(entity, 'creator', False) or getattr(entity, 'admin_rights', None))
        if getattr(entity, 'broadcast', False):
            rights = getattr(entity, 'admin_rights', None)
            return bool(getattr(entity, 'creator', False) or getattr(rights, 'post_messages', False))
        if any(getattr(getattr(entity, 'banned_rights', None), key, False) for key in ('send_messages', 'send_plain')):
            return False
        return admin or not any(getattr(getattr(entity, 'default_banned_rights', None), key, False)
                                for key in ('send_messages', 'send_plain'))

    def _cache_entry(self, identifier, entry, *, resolved=False):
        old = self._entry(identifier)
        if old is not None and old['fingerprint'] != entry['fingerprint']:
            self._message_refs.pop(identifier, None)
        target = self._resolved if resolved else self._dialogs
        target[identifier] = entry
        maximum = 64 if resolved else MAX_DIALOG_CACHE
        while len(target) > maximum:
            victim = next((key for key in target if key != self._selected and key != identifier
                           and not target[key]['dto'].get('is_self')), None)
            if victim is None:
                break
            target.pop(victim)
            self._message_refs.pop(victim, None)

    @staticmethod
    def _matches_chat(dto, query, filter_name):
        from telegram_intent import normalized
        if filter_name == 'unread' and not dto['unread_count']:
            return False
        kinds = {'users': 'user', 'groups': 'group', 'channels': 'channel'}
        if filter_name in kinds and dto['kind'] != kinds[filter_name]:
            return False
        haystack = dto['title'] + ' ' + (dto.get('username') or '')
        return not query or normalized(query)[0] in normalized(haystack)[0]

    def dialogs(self, payload=None):
        payload = {} if payload is None else payload
        fields(payload, ('limit', 'cursor', 'query', 'filter'))
        limit = payload.get('limit', 30)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 30:
            raise AccountError('Chatlar limiti 1–30 bo‘lsin')
        query = bounded_query(payload.get('query', ''))
        filter_name = payload.get('filter', 'all')
        if filter_name not in FILTERS:
            raise AccountError('Chat filtri noto‘g‘ri', code='invalid_filter')
        cursor = payload.get('cursor')
        if cursor is not None and (not isinstance(cursor, str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,128}', cursor)):
            raise AccountError('Chat sahifasi eskirgan; ro‘yxatni yangilang', code='stale_cursor')
        async def operation(generation):
            self._check(generation, authorized=True)
            client = self._client
            options = {'ignore_migrated': True}
            pinned_seen = set()
            with self.lock:
                if cursor is not None:
                    page = self._cursors.get(cursor)
                    if (page is None or page['generation'] != generation or time.monotonic() >= page['expires']
                            or page['query'] != query or page['filter'] != filter_name):
                        raise AccountError('Chat sahifasi eskirgan yoki qidiruv o‘zgargan; ro‘yxatni yangilang', code='stale_cursor')
                    options.update(page['offset'])
                    options['ignore_pinned'] = page.get('ignore_pinned', True)
                    pinned_seen.update(page.get('pinned_seen', []))
            # A pinned message can be much older than unpinned messages. Never
            # use its timestamp as the chronological offset. Continue the
            # bounded pinned prefix separately, then start newest unpinned.
            scan_limit = 100 if query or filter_name != 'all' or pinned_seen else limit
            previous_pins = len(pinned_seen)
            dialogs = await client.get_dialogs(limit=scan_limit + 1, **options)
            self._check(generation, authorized=True)
            cache, values = {}, []
            scanned, anchor = 0, None
            for dialog in dialogs[:scan_limit]:
                scanned += 1
                anchor = dialog
                identifier = canonical_chat_id(str(dialog.id))
                if getattr(dialog, 'pinned', False):
                    if identifier in pinned_seen:
                        continue
                    pinned_seen.add(identifier)
                title = str(dialog.name or 'Nomsiz chat')[:256]
                entity, peer = dialog.entity, dialog.input_entity
                dto = {'chat_id': identifier, 'title': title,
                    'kind': 'user' if dialog.is_user else 'group' if dialog.is_group else 'channel',
                    'unread_count': max(0, int(getattr(dialog, 'unread_count', 0) or 0)),
                    'can_send': self._can_send(entity),
                    'username': self._public_username(entity), 'is_self': getattr(entity, 'is_self', False) is True}
                cache[identifier] = {'peer': peer, 'fingerprint': self._fingerprint(peer), 'dto': dto}
                if self._matches_chat(dto, query, filter_name) and not any(value['chat_id'] == identifier for value in values):
                    values.append(dto)
                    if len(values) == limit:
                        break
            # Telethon may end a100-result server chunk inside the pinned
            # prefix and derive an old timestamp for its lookahead. Always
            # give the newest unpinned stream one explicit bounded page.
            pinned_anchor = anchor is not None and bool(getattr(anchor, 'pinned', False))
            has_more = anchor is not None and (len(dialogs) > scanned or pinned_anchor)
            next_cursor = None
            with self.lock:
                self._check(generation, authorized=True)
                for identifier, entry in cache.items():
                    self._cache_entry(identifier, entry)
                now = time.monotonic()
                self._cursors = {key: value for key, value in self._cursors.items() if value['expires'] > now}
                if has_more:
                    message = getattr(anchor, 'message', None)
                    offset_id = getattr(message, 'id', 0)
                    offset_id = offset_id if isinstance(offset_id, int) and not isinstance(offset_id, bool) else 0
                    next_cursor = secrets.token_urlsafe(24)
                    while len(self._cursors) >= 32:
                        self._cursors.pop(next(iter(self._cursors)))
                    prefix_complete = (pinned_anchor and (scanned == len(dialogs)
                                       or not getattr(dialogs[scanned], 'pinned', False)))
                    if (pinned_anchor and previous_pins and len(pinned_seen) == previous_pins
                            and scanned == scan_limit and not prefix_complete):
                        raise AccountError('Mahkamlangan chatlar ro‘yxati juda katta; qidiruvni aniqlashtiring', code='pagination_limit')
                    self._cursors[next_cursor] = {'generation': generation, 'expires': now + CURSOR_SECONDS,
                        'query': query, 'filter': filter_name, 'ignore_pinned': not pinned_anchor or prefix_complete,
                        'pinned_seen': list(pinned_seen) if pinned_anchor and not prefix_complete else [],
                        'offset': {} if pinned_anchor else {'offset_date': getattr(anchor, 'date', None)
                            or getattr(message, 'date', None), 'offset_id': offset_id, 'offset_peer': anchor.input_entity}}
                loaded = len(self._dialogs)
            return {'chats': values, 'limit': limit, 'query': query, 'filter': filter_name,
                    'next_cursor': next_cursor, 'has_more': has_more, 'scanned_count': scanned,
                    'loaded_count': loaded, 'session_epoch': generation}
        return self._submit(operation)

    @staticmethod
    def _public_username(entity):
        value = getattr(entity, 'username', None)
        return value if isinstance(value, str) and USERNAME.fullmatch(value) else None

    def _cache_self(self, me):
        from telethon.tl.types import InputPeerSelf
        identifier = canonical_chat_id(str(getattr(me, 'id', '')))
        peer = InputPeerSelf()
        dto = {'chat_id': identifier, 'title': 'Saqlangan xabarlar', 'kind': 'user',
               'unread_count': 0, 'can_send': True, 'username': self._public_username(me), 'is_self': True}
        entry = {'peer': peer, 'fingerprint': self._fingerprint(peer), 'dto': dto}
        self._cache_entry(identifier, entry, resolved=True)
        return entry

    def resolve(self, payload):
        fields(payload, ('recipient',))
        recipient = payload.get('recipient')
        if (not isinstance(recipient, str) or recipient != 'self'
                and (not recipient.startswith('@') or not USERNAME.fullmatch(recipient[1:]))):
            raise AccountError('Oluvchini @username ko‘rinishida yozing yoki Saqlangan xabarlarni tanlang', code='invalid_recipient')
        generation = self.revision()
        if recipient == 'self':
            self._check(generation, authorized=True)
            with self.lock:
                entry = next((value for value in self._resolved.values() if value['dto'].get('is_self')), None)
            if entry is None:
                async def operation(revision):
                    self._check(revision, authorized=True)
                    me = await self._client.get_me()
                    with self.lock:
                        self._check(revision, authorized=True)
                        return self._cache_self(me)
                entry = self._submit(operation, generation=generation)
        else:
            result, reason = self.command_recipient(recipient, expected_generation=generation, require_send=False)
            if result is None:
                raise AccountError(reason, code='recipient_unavailable')
            with self.lock:
                self._check(generation, authorized=True)
                entry = self._entry(result['chat_id'])
        with self.lock:
            self._check(generation, authorized=True)
            return {'chat': copy.deepcopy(entry['dto']), 'session_epoch': generation}

    def _entry(self, identifier):
        return self._dialogs.get(identifier) or self._resolved.get(identifier)

    @staticmethod
    def _recipient_dto(entry):
        dto = entry['dto']
        return {'chat_id': dto['chat_id'], 'title': dto['title'], 'kind': dto['kind'],
                'username': dto.get('username'), 'is_self': dto.get('is_self') is True}

    def command_recipient(self, label=None, *, chat_id=None, expected_generation=None, require_send=True):
        """Resolve one explicitly named/selected recipient; never load history.

        Public @username resolution is one bounded RPC. Names match the cached
        list exactly; missing or duplicate names ask the user to select a chat.
        A backend last-read chat is deliberately not implicit command context.
        """
        from telegram_intent import normalized
        with self.lock:
            generation = self._generation if expected_generation is None else expected_generation
            self._check(generation, authorized=True)
            entries = {**self._resolved, **self._dialogs}
            if label is None or label == 'selected':
                if chat_id is None:
                    return None, 'Oluvchi tanlanmagan. Chatni tanlang yoki @username ni yozing.'
                identifier = canonical_chat_id(chat_id)
                entry = entries.get(identifier)
                if entry is None:
                    return None, 'Tanlangan chat eskirgan. Chatni qayta tanlang.'
                if require_send and not entry['dto']['can_send']:
                    return None, 'Bu chatga xabar yozish mumkin emas. Boshqa chatni tanlang.'
                return self._recipient_dto(entry), None
            if not isinstance(label, str) or not 1 <= len(label) <= 256:
                raise AccountError('Oluvchi shakli noto‘g‘ri')
            if label.startswith('@'):
                username = label[1:]
                if not USERNAME.fullmatch(username):
                    return None, 'Username ni @username ko‘rinishida yozing.'
                matches = [entry for entry in entries.values()
                    if isinstance(entry['dto'].get('username'), str)
                    and entry['dto']['username'].casefold() == username.casefold()]
            else:
                name = normalized(label)[0].strip()
                self_names = ('saved messages', "saqlangan xabarlar", "o'zim", 'ozim')
                matches = [entry for entry in entries.values() if
                    (entry['dto'].get('is_self') is True if name in self_names else
                     normalized(entry['dto']['title'])[0].strip() == name)]
            if len(matches) > 1:
                return None, 'Bir xil nomli bir nechta chat bor. Ro‘yxatdan aynan kerakli chatni tanlang.'
            if matches:
                if require_send and not matches[0]['dto']['can_send']:
                    return None, 'Bu chatga xabar yozish mumkin emas. Boshqa chatni tanlang.'
                return self._recipient_dto(matches[0]), None
            if not label.startswith('@'):
                return None, 'Bunday nomli chat yuklangan ro‘yxatda yo‘q. Chatni tanlang yoki @username ni yozing.'
        async def operation(revision):
            from telethon.tl.functions.contacts import ResolveUsernameRequest
            from telethon.tl.types import PeerUser, PeerChannel, User, Channel
            from telethon.utils import get_peer_id, get_input_peer, get_display_name
            self._check(revision, authorized=True)
            result = await self._client(ResolveUsernameRequest(username))
            self._check(revision, authorized=True)
            target = getattr(result, 'peer', None)
            if isinstance(target, PeerUser):
                values, entity_type, entity_id = getattr(result, 'users', []), User, target.user_id
            elif isinstance(target, PeerChannel):
                values, entity_type, entity_id = getattr(result, 'chats', []), Channel, target.channel_id
            else:
                return None, 'Username uchun yozish mumkin bo‘lgan chat topilmadi.'
            matches = [entity for entity in values[:100] if isinstance(entity, entity_type)
                       and entity.id == entity_id and isinstance(self._public_username(entity), str)
                       and self._public_username(entity).casefold() == username.casefold()]
            if len(matches) != 1:
                return None, 'Username oluvchisi aniq tasdiqlanmadi. Chatni ro‘yxatdan tanlang.'
            entity = matches[0]
            if require_send and not self._can_send(entity):
                return None, 'Bu chatga xabar yozish mumkin emas. Boshqa chatni tanlang.'
            peer = get_input_peer(entity)
            identifier = canonical_chat_id(str(get_peer_id(entity)))
            dto = {'chat_id': identifier, 'title': get_display_name(entity)[:256] or '@' + username,
                   'kind': 'user' if isinstance(entity, User) else 'group' if getattr(entity, 'megagroup', False) else 'channel', 'unread_count': 0,
                   'can_send': self._can_send(entity), 'username': self._public_username(entity),
                   'is_self': getattr(entity, 'is_self', False) is True}
            entry = {'peer': peer, 'fingerprint': self._fingerprint(peer), 'dto': dto}
            with self.lock:
                self._check(revision, authorized=True)
                # Existing reviewed proposals retain their bound peer. Eviction
                # affects future planning only and never broadens list limits.
                self._cache_entry(identifier, entry, resolved=True)
            return self._recipient_dto(entry), None
        try:
            return self._submit(operation, generation=generation)
        except AccountError as error:
            if error.code in ('rate_limited', 'network_unavailable', 'timeout', 'session_expired'):
                raise
            self._check(generation, authorized=True)
            return None, 'Username topilmadi yoki Telegram javob bermadi. Username yoniga «ga» ni bo‘shliq bilan yozing yoki chatni ro‘yxatdan tanlang.'

    @staticmethod
    def _message_valid(message, identifier, message_id=None):
        if (message is None or getattr(message, 'deleted', False) or type(message).__name__ == 'MessageEmpty'
                or getattr(message, 'date', None) is None):
            return False
        value = getattr(message, 'id', None)
        if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 2**31 - 1:
            return False
        if message_id is not None and value != message_id:
            return False
        try:
            from telethon.utils import get_peer_id
            peer = getattr(message, 'peer_id', None)
            actual = get_peer_id(peer) if peer is not None else getattr(message, 'chat_id', None)
            return str(actual) == identifier
        except (ValueError, TypeError):
            return False

    @staticmethod
    def _sender_name(message):
        # Message.sender is Telethon's cached entity, never a get_sender RPC.
        sender = getattr(message, 'sender', None)
        values = [getattr(sender, key, None) for key in ('first_name', 'last_name')]
        name = getattr(sender, 'title', None) or ' '.join(value for value in values if isinstance(value, str))
        name = name or getattr(message, 'post_author', None)
        return truncate_utf16(name, 256)[0] if isinstance(name, str) and name else None

    @staticmethod
    def _media_kind(message):
        for kind in ('photo', 'video', 'voice', 'audio', 'sticker', 'document'):
            if getattr(message, kind, None):
                return kind
        media = getattr(message, 'media', None)
        names = {'MessageMediaContact': 'contact', 'MessageMediaGeo': 'location',
                 'MessageMediaGeoLive': 'location', 'MessageMediaVenue': 'location', 'MessageMediaPoll': 'poll'}
        if media is None or type(media).__name__ == 'MessageMediaEmpty':
            return None
        # A web-page preview still has its original text; it is not an attachment.
        if type(media).__name__ == 'MessageMediaWebPage':
            return None
        return names.get(type(media).__name__, 'other')

    def read(self, payload, *, expected_generation=None):
        fields(payload, ('chat_id', 'limit', 'before_id', 'query'))
        identifier = canonical_chat_id(payload.get('chat_id'))
        limit = payload.get('limit', 20)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 50:
            raise AccountError('Xabarlar limiti 1–50 bo‘lsin')
        before = positive_message_id(payload['before_id']) if 'before_id' in payload else None
        query = bounded_query(payload.get('query', ''))
        async def operation(generation):
            self._check(generation, authorized=True)
            with self.lock:
                entry = self._entry(identifier)
            if entry is None:
                raise AccountError('Avval ro‘yxatdan chat tanlang')
            options = {'limit': limit + 1}
            if before is not None:
                options['offset_id'] = before
            if query:
                options['search'] = query
            messages = await self._client.get_messages(entry['peer'], **options)
            self._check(generation, authorized=True)
            valid, seen = [], set()
            for message in messages:
                if (not self._message_valid(message, identifier) or message.id in seen
                        or before is not None and message.id >= before):
                    continue
                seen.add(message.id)
                valid.append(message)
            valid.sort(key=lambda message: message.id, reverse=True)
            values, budget = [], 50000 if limit > 20 else 24000
            for message in valid[:limit]:
                original = str(getattr(message, 'message', '') or '')
                text, truncated = truncate_utf16(original, min(4000, budget))
                budget -= utf16_units(text)
                sender = getattr(message, 'sender_id', None)
                date = getattr(message, 'date', None)
                reply_id = getattr(getattr(message, 'reply_to', None), 'reply_to_msg_id', None)
                if isinstance(reply_id, bool) or not isinstance(reply_id, int) or not 1 <= reply_id <= 2**31 - 1:
                    reply_id = None
                values.append({'id': int(message.id), 'date': date.isoformat() if date is not None else '',
                    'sender_id': str(sender) if isinstance(sender, int) and not isinstance(sender, bool) else None,
                    'text': text, 'out': bool(getattr(message, 'out', False)),
                    'sender_name': self._sender_name(message), 'media_kind': self._media_kind(message),
                    'reply_to_id': reply_id, 'truncated': truncated})
            with self.lock:
                self._check(generation, authorized=True)
                self._selected = identifier
                self._remember_refs(identifier, entry['fingerprint'], [value['id'] for value in values])
            return {'chat_id': identifier, 'title': entry['dto']['title'], 'messages': list(reversed(values)),
                    'limit': limit, 'has_more': len(valid) > limit,
                    'before_id': values[-1]['id'] if values else None, 'query': query, 'session_epoch': generation}
        return self._submit(operation, generation=expected_generation)

    def _reply_reference(self, identifier, entry, reply_id):
        if self._message_refs.get(identifier, {}).get(reply_id) != entry['fingerprint']:
            raise AccountError('Javob beriladigan xabarni shu chat tarixidan tanlang', code='reply_unavailable')

    def _remember_refs(self, identifier, fingerprint, message_ids):
        refs = self._message_refs.setdefault(identifier, {})
        for value in message_ids:
            refs[value] = fingerprint
        while len(refs) > MAX_MESSAGE_REFS:
            refs.pop(next(iter(refs)))

    async def _verify_reply(self, client, identifier, peer, reply_id, generation):
        message = await client.get_messages(peer, ids=reply_id)
        self._check(generation, authorized=True)
        if not self._message_valid(message, identifier, reply_id):
            raise AccountError('Javob beriladigan xabar o‘chirilgan yoki boshqa chatga tegishli; qayta tanlang', code='reply_unavailable')
        return message

    def reply_context(self, chat_id, reply_to_id, *, expected_generation=None):
        """Fetch only an explicitly loaded reply target, before AI generation."""
        identifier, reply_id = canonical_chat_id(chat_id), positive_message_id(reply_to_id)
        with self.lock:
            generation = self._generation if expected_generation is None else expected_generation
            self._check(generation, authorized=True)
            entry = self._entry(identifier)
            if entry is None or not entry['dto']['can_send']:
                raise AccountError('Javob beriladigan chatni qayta tanlang', code='reply_unavailable')
            self._reply_reference(identifier, entry, reply_id)
        async def operation(revision):
            self._check(revision, authorized=True)
            message = await self._verify_reply(self._client, identifier, entry['peer'], reply_id, revision)
            text, truncated = truncate_utf16(str(getattr(message, 'message', '') or ''), 4000)
            return {'id': reply_id, 'text': text, 'truncated': truncated,
                    'out': bool(getattr(message, 'out', False)), 'media_kind': self._media_kind(message)}
        return self._submit(operation, generation=generation)

    def preview_send(self, payload, expected_generation=None):
        fields(payload, ('chat_id', 'text', 'reply_to_id'))
        identifier, text = canonical_chat_id(payload.get('chat_id')), message_text(payload.get('text'))
        reply_id = positive_message_id(payload['reply_to_id']) if 'reply_to_id' in payload else None
        with self.lock:
            generation = self._generation if expected_generation is None else expected_generation
            self._check(generation, authorized=True)
            entry = self._entry(identifier)
            if entry is None or not entry['dto']['can_send']:
                raise AccountError('Yozish mumkin bo‘lgan chatni ro‘yxatdan tanlang')
            if reply_id is not None:
                self._reply_reference(identifier, entry, reply_id)
        def bind():
            with self.lock:
                self._check(generation, authorized=True)
                current = self._entry(identifier)
                if current is None or current['fingerprint'] != entry['fingerprint'] or not current['dto']['can_send']:
                    raise AccountError('Chat oluvchisi o‘zgargan; qayta tanlang', code='recipient_changed')
                return self._bind_preview(identifier, text, reply_id, entry, generation)
        if reply_id is not None:
            async def operation(revision):
                self._check(revision, authorized=True)
                await self._verify_reply(self._client, identifier, entry['peer'], reply_id, revision)
                return bind()
            return self._submit(operation, generation=generation)
        return bind()

    def _bind_preview(self, identifier, text, reply_id, entry, generation):
        # Caller holds the state lock and has checked this exact peer/generation.
        with self.lock:
            dto = {'id': secrets.token_urlsafe(24), 'chat_id': identifier, 'recipient': entry['dto']['title'],
                'text': text, 'expires_in': PREVIEW_SECONDS, 'approval_required': True, 'session_epoch': generation}
            if reply_id is not None:
                dto['reply_to_id'] = reply_id
            self._pending = {'dto': dto, 'generation': generation, 'expires': time.monotonic() + PREVIEW_SECONDS,
                'peer': entry['peer'], 'fingerprint': entry['fingerprint'], 'reply_to_id': reply_id, 'attempted': False}
            return copy.deepcopy(dto)

    def cancel_preview(self, payload):
        """Consume only the named pending proposal; no RPC or session changes."""
        fields(payload, ('id',))
        identifier = payload.get('id')
        if not isinstance(identifier, str) or not 1 <= len(identifier) <= 128:
            raise AccountError('Xabar taklifi ID noto‘g‘ri')
        with self.lock:
            pending = self._pending
            if pending is not None and secrets.compare_digest(identifier, pending['dto']['id']):
                self._pending = None
                return {'cancelled': True}
            return {'cancelled': False}

    def confirm_send(self, payload):
        fields(payload, ('id',))
        identifier = payload.get('id')
        with self.lock:
            pending = self._pending
            if not isinstance(identifier, str) or pending is None or not secrets.compare_digest(identifier, pending['dto']['id']):
                raise AccountError('Xabar taklifi eskirgan yoki allaqachon ishlatilgan')
            self._pending = None
            generation = pending['generation']
            self._check(generation, authorized=True)
            if time.monotonic() >= pending['expires']:
                raise AccountError('Xabar taklifi vaqti tugagan; qayta ko‘rib chiqing')
        dto = pending['dto']
        async def operation(revision):
            self._check(revision, authorized=True)
            if self._fingerprint(pending['peer']) != pending['fingerprint']:
                raise AccountError('Chat oluvchisi o‘zgargan; qayta ko‘rib chiqing')
            reply_id = pending.get('reply_to_id')
            if reply_id is not None:
                await self._verify_reply(self._client, dto['chat_id'], pending['peer'], reply_id, revision)
            # Let scheduled Stop cancellation run before dispatching any RPC.
            await asyncio.sleep(0)
            with self.lock:
                self._check(revision, authorized=True)
                pending['attempted'] = True
                client = self._client
            options = {'reply_to': reply_id} if reply_id is not None else {}
            message = await client.send_message(pending['peer'], dto['text'], parse_mode=None, link_preview=False, **options)
            self._check(revision, authorized=True)
            return positive_message_id(message.id)
        try:
            message_id = self._submit(operation, generation=generation)
            with self.lock:
                self._check(generation, authorized=True)
                # A confirmed RPC acknowledgement is an authorized visible
                # message ref. Reply preview still checks its actual peer/ID.
                self._remember_refs(dto['chat_id'], pending['fingerprint'], [message_id])
            return {'id': identifier, 'chat_id': dto['chat_id'], 'status': 'sent', 'message_id': message_id,
                    'session_epoch': generation, **({'reply_to_id': dto['reply_to_id']} if 'reply_to_id' in dto else {})}
        except AccountError:
            return {'id': identifier, 'chat_id': dto['chat_id'],
                'status': 'unknown' if pending['attempted'] else 'cancelled', 'message_id': None,
                'session_epoch': generation, **({'reply_to_id': dto['reply_to_id']} if 'reply_to_id' in dto else {})}

    def close(self):
        """Internal shutdown: stop the owned client before draining its event loop."""
        with self.lock:
            if self._closed:
                return
        self.stop()
        with self.lock:
            self._closed = True
            loop, thread = self._loop, self._thread
        if loop is None:
            return
        async def drain():
            tasks = [task for task in asyncio.all_tasks() if task is not asyncio.current_task()]
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.wait(tasks, timeout=1)
        future = asyncio.run_coroutine_threadsafe(drain(), loop)
        try:
            future.result(timeout=2)
        except Exception:
            future.cancel()
        loop.call_soon_threadsafe(loop.stop)
        thread.join(timeout=2)
        if not thread.is_alive():
            loop.close()
