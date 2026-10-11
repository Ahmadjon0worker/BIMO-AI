"""Bounded Telegram command grammar; never runs a model, shell or send RPC.

Only command syntax is normalized. Literal message slices always come from the
original input, so punctuation, case, line breaks and quoted whitespace survive.
"""
from __future__ import annotations

import re

CYRILLIC = dict(zip('абвгдезийклмнопрстуфхцъыьэ',
                    ('a','b','v','g','d','e','z','i','y','k','l','m','n','o','p','r','s','t','u','f','x','ts',"'",'i','', 'e')))
CYRILLIC.update({'ё': 'yo', 'ж': 'j', 'ч': 'ch', 'ш': 'sh', 'щ': 'sh', 'ю': 'yu', 'я': 'ya',
                 'ў': "o'", 'қ': 'q', 'ғ': "g'", 'ҳ': 'h'})
APOSTROPHES = "’‘ʻʼ`"
SEND = re.compile(r"\b(?:yubor(?:ing|gin|sin|ib\s*ber|vor|aver)?|jo'?nat(?:ing|gin|sin|ib\s*ber)?|jonat(?:ing|sin)?|yoz(?:ing|gin)?|send)\b")
NEGATIVE = re.compile(r"\b(?:yubor(?:ma|mang|may|masin)|jo'?nat(?:ma|mang|may|masin)|(?:yoz|ber)(?:ma|mang|masin|mayin)|yuborish|jo'?natish)\b")
REPLY_WRITE = r"yoz(?:ing|gin|sin|aver(?:sin|ing)?|ib\s*ber(?:ing|gin|sin)?)?"
REPLY_GIVE = r"ber(?:ing|gin|sin)?"
REPLY = rf"javob\s+(?:{REPLY_WRITE}|{REPLY_GIVE})"
DRAFT = re.compile(rf"\b(?:qoralama|{REPLY}|yozib\s*ber|tayyorla(?:b\s*ber)?)\b")
USERNAME = re.compile(r'@[a-z][a-z0-9_]{4,31}\b', re.I)
QUOTES = {'"': '"', "'": "'", '“': '”', '«': '»'}
TEXT_REFERENCES = ('shuni', 'buni', 'shu xabarni', 'shu habarni', 'shu matnni', 'shu javobni',
                   'oxirgi javobni', 'oldingi javobni', 'mana shuni')
COMMAND_PREFIX = re.compile(r'^(?:(?:iltimos|telegramdan|telegramda|telegramga|telegram\s+orqali|telegram)(?:\s+|$))*')


def normalized(value):
    result, positions = [], []
    for index, char in enumerate(value):
        lowered = char.lower()
        transformed = "'" if char in APOSTROPHES else CYRILLIC.get(lowered, lowered)
        result.extend(transformed)
        positions.extend([index] * len(transformed))
    positions.append(len(value))
    return ''.join(result), positions


def quote_spans(value):
    """Top-level paired quotes, excluding Uzbek apostrophes inside words."""
    spans, index = [], 0
    while index < len(value):
        char = value[index]
        if char not in QUOTES or (char == "'" and index and value[index - 1].isalnum()):
            index += 1
            continue
        end = value.find(QUOTES[char], index + 1)
        while (char == "'" and end != -1 and end > 0 and end + 1 < len(value)
               and value[end - 1].isalnum() and value[end + 1].isalnum()):
            end = value.find("'", end + 1)
        if end == -1:
            return spans, True
        spans.append((index, end + 1, value[index + 1:end]))
        index = end + 1
    return spans, False


def clarification(text):
    return {'kind': 'clarification', 'text': text}


def text_units(value):
    try:
        return len(value.encode('utf-16-le')) // 2
    except UnicodeEncodeError:
        raise ValueError('Matnda yaroqsiz Unicode belgisi bor') from None


def parse_command(query, *, message_text=None):
    """Return an unresolved local plan or a response discriminant.

    Recipient/body are never inferred from chat history. The optional message
    context is accepted only with an explicit standalone shuni/buni reference.
    """
    if not isinstance(query, str) or not query.strip() or text_units(query) > 6000 or '\x00' in query:
        raise ValueError('Telegram buyrug‘i 1–6000 belgidan iborat bo‘lsin')
    if message_text is not None and (not isinstance(message_text, str) or not message_text.strip() or text_units(message_text) > 4000 or '\x00' in message_text):
        raise ValueError('Tanlangan xabar matni noto‘g‘ri')
    spans, unclosed = quote_spans(query)
    wrapper = list(query)
    for start, end, unused in spans:
        wrapper[start:end] = ' ' * (end - start)
    syntax, positions = normalized(''.join(wrapper))
    action = SEND.search(syntax)
    draft_action = DRAFT.search(syntax)
    if action is None and draft_action is None:
        if NEGATIVE.search(syntax):
            return clarification('Yuborilmasin: hech qanday xabar taklifi tayyorlanmadi.')
        if re.search(r'\bjavob\s+(?:yoz|ber)[a-z\x27]*\b', syntax):
            return clarification('Oluvchi va javob yozish vazifasini aniq ko‘rsating. Masalan: «unga javob yoz».')
        if re.search(r"\b(?:yubor[a-z']*|jo'?nat[a-z']*)\b", syntax):
            return clarification('Oluvchi va xabarni aniq yozing. Masalan: «@username ga "Salom" yubor».')
        return {'kind': 'chat', 'text': ''}
    # A question/negative about sending is never converted to a send proposal.
    if re.search(r'^\s*(?:qanday|nega|nima\s+uchun)\b', syntax):
        return clarification('Xabar yuborish buyrug‘i aniqlanmadi. Oluvchi va yuboriladigan matnni aniq yozing.')
    if unclosed:
        return clarification('Xabar matni qo‘shtirnog‘ini yoping va buyrug‘ini qayta yozing.')
    if len(spans) > 1:
        return clarification('Bitta xabar matnini bitta qo‘shtirnoq ichida yozing.')
    mentions = list(USERNAME.finditer(syntax))
    username_tokens = re.findall(r'@[^\s:]+', syntax)
    if (('@' in syntax and len(mentions) != syntax.count('@')) or
            any(USERNAME.fullmatch(token) is None for token in username_tokens)):
        return clarification('Telegram username shaklini @username ko‘rinishida yozing.')
    if len(mentions) > 1 or re.search(r'\b(?:hamma(?:ga|si|siga)?|barcha(?:ga|siga)?|har\s+bir|all|mass|bulk)\b', syntax):
        return clarification('Bir vaqtda bitta chatga xabar tayyorlanadi. Bitta oluvchini tanlang.')
    # Prefer an explicit final imperative; extra unrecognized syntax after it
    # is not silently treated as message text.
    verb = draft_action or action
    before = query[:positions[verb.start()]].strip()
    after = query[positions[verb.end()]:].strip()
    if after and not after.strip(' .!'):
        after = ''
    before_norm, unused = normalized(before)
    after_norm, unused = normalized(after)
    draft_tail = draft_action is not None and re.fullmatch(
        r'(?:yoz(?:ib\s*ber)?|tayyorla(?:b\s*ber)?)(?:\s+(?:iltimos|yubor))?[.!]*', after_norm)
    prefix = COMMAND_PREFIX.match(before_norm)
    before = before[len(prefix.group(0)):] if prefix else before
    before_norm, unused = normalized(before)
    recipient, body = None, None
    body_from_after = False
    recipient_span = None
    if mentions:
        mention = mentions[0]
        start, end = positions[mention.start()], positions[mention.end()]
        recipient = query[start:end]
        # The separate Uzbek case suffix is syntax. An attached `ga` can be
        # part of a legitimate username, so it is never stripped/guessed.
        suffix = query[end:]
        suffix_norm, unused = normalized(suffix)
        suffix_match = re.match(r'\s*ga\b', suffix_norm)
        if suffix_match:
            end += len(suffix_match.group(0))
        recipient_span = (start, end)
        earlier, unused = normalized(''.join(wrapper)[:start].strip())
        earlier = COMMAND_PREFIX.sub('', earlier)
        if earlier not in ('', 'ni', *TEXT_REFERENCES):
            return clarification('Bitta oluvchini aniq ko‘rsating: «@username ga matn yubor».')
    elif spans:
        wrapper_before = ''.join(wrapper)[:positions[verb.start()]].strip()
        candidate_norm, unused = normalized(wrapper_before)
        candidate_norm = COMMAND_PREFIX.sub('', candidate_norm)
        candidate_norm = re.sub(r'\b(?:xabar(?:ni)?|matn(?:ni)?|ni)\b', '', candidate_norm).strip()
        if candidate_norm:
            if re.fullmatch(r'(?:shunga|unga|shu\s+chatga|shu\s+suhbatga|tanlangan\s+chatga)', candidate_norm):
                recipient = 'selected'
            elif candidate_norm.endswith('ga'):
                # Resolve by exact normalized visible name, never fuzzy-match.
                recipient = candidate_norm[:-2].strip()
            else:
                return clarification('Oluvchini @username yoki chat ro‘yxatidan tanlab ko‘rsating.')
    else:
        # With an unquoted body, a recipient precedes the text and ends in ga.
        recipient_match = re.match(r'^(.{1,256}?)ga\s+', before_norm)
        if recipient_match:
            label = recipient_match.group(1).strip()
            recipient = 'selected' if label in ('shun', 'un', 'shu chat', 'shu suhbat', 'tanlangan chat') else label
            matched, indexes = normalized(before)
            before = before[indexes[recipient_match.end()]:]
        elif re.fullmatch(r'(?:shunga|unga|shu\s+chatga|tanlangan\s+chatga)', before_norm):
            recipient, before = 'selected', ''
    if isinstance(recipient, str) and recipient != 'selected' and re.search(r'\b(?:va|hamda|and)\b|[,;]', recipient):
        return clarification('Bitta oluvchini ko‘rsating; bir nechta chatga yuborish qo‘llanmaydi.')
    if spans:
        body = spans[0][2]
        if recipient_span is not None:
            # Outside a quoted literal, only recipient/action syntax is valid.
            # Do not silently discard another name, invalid username suffix or
            # an additional instruction while preparing the reviewed message.
            remainder = list(''.join(wrapper))
            start, end = recipient_span
            remainder[start:end] = ' ' * (end - start)
            remainder[positions[verb.start()]:positions[verb.end()]] = ' ' * (positions[verb.end()] - positions[verb.start()])
            leftover, unused = normalized(''.join(remainder))
            leftover = COMMAND_PREFIX.sub('', leftover.strip())
            leftover = re.sub(r'\b(?:xabar(?:ni)?|matn(?:ni)?|ni|ber|bering|iltimos|telegramda)\b', '', leftover)
            if draft_tail:
                leftover = re.sub(r'\b(?:yoz(?:ib\s*ber)?|tayyorla(?:b\s*ber)?|yubor)\b', '', leftover)
            if leftover.strip(' .!:'):
                return clarification('Bitta oluvchi va bitta xabarni aniq yozing: «@username ga "matn" yubor».')
    elif recipient_span is not None:
        start, end = recipient_span
        verb_start, verb_end = positions[verb.start()], positions[verb.end()]
        if end <= verb_start:
            body = query[end:verb_start].strip()
            if body.startswith(':'):
                body = body[1:].lstrip()
            if not body:
                reference = query[:start].strip()
                reference_norm, unused = normalized(reference)
                reference_norm = COMMAND_PREFIX.sub('', reference_norm)
                if reference_norm in TEXT_REFERENCES:
                    body = reference_norm
            if not body and after.startswith(':'):
                body = after[1:].strip()
                body_from_after = True
        else:
            # e.g. yubor @username: salom
            return clarification('Buyruqni «@username ga matn yubor» shaklida yozing.')
    else:
        body = before.strip()
        if not body and after.startswith(':'):
            body = after[1:].strip()
            body_from_after = True
    if after.startswith(':') and body and not body_from_after:
        return clarification('Bitta xabar matnini ko‘rsating; buyruqda ikkita matn bor.')
    if after and not after.startswith(':') and after_norm not in ('ber', 'bering', 'iltimos', 'telegramda') and not draft_tail:
        return clarification('Bitta aniq yuborish buyrug‘ini yozing: «@username ga matn yubor».')
    if not spans and isinstance(body, str):
        body = re.sub(r'\s+deb\s*$', '', body, flags=re.I)
    body_norm, unused = normalized(body or '')
    if not spans and body_norm in TEXT_REFERENCES:
        if message_text is None:
            return clarification('«Shuni» uchun xabar matni tanlanmagan. Matnni yozing yoki AI javobini tanlang.')
        body = message_text
    if (not isinstance(body, str) or not body.strip()) and draft_action is not None and draft_action.group(0).startswith('javob'):
        body = 'Chatga mos qisqa javob'
    if not isinstance(body, str) or not body.strip():
        return clarification('Yuboriladigan xabar matnini yozing. Masalan: «@username ga "Salom" yubor».')
    if text_units(body) > (2000 if draft_action else 4000):
        return clarification('Xabar matni juda uzun; qisqartirib qayta yozing.')
    if draft_action:
        # Existing local draft flow understands an instruction, not a literal
        # message. Include the explicitly requested draft action and body.
        instruction = ('Qoralama tayyorla: ' + body).strip()
        if text_units(instruction) > 2000:
            return clarification('Qoralama vazifasini 2000 belgidan qisqa yozing.')
        return {'kind': 'plan', 'source': 'draft', 'recipient': recipient, 'instruction': instruction}
    return {'kind': 'plan', 'source': 'literal', 'recipient': recipient, 'text': body}
