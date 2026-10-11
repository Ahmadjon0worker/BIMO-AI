"""Safe data-only adaptation of whisper.cpp v1.9.4 convert-h5-to-ggml.py.

No torch, transformers, pickle, dynamic import, or repository model code. F32
safetensors are memory mapped and written in the official GGML tensor layout.
"""
import hashlib, json, math, pathlib, struct, sys
import numpy as np

if len(sys.argv) != 2:
    raise SystemExit("Usage: convert-safetensors-to-ggml.py CACHE_DIRECTORY")
ROOT = pathlib.Path(sys.argv[1]).resolve()
OUT = ROOT / 'ggml-navai-small-uz-f16.bin'
EXPECTED = '3662e1baf3a9bc9a3b3df9bb75060c99708f8c461df19e0e3acd80ae6814411e'
EXPECTED_CONFIG = {'vocab_size': 51865, 'max_source_positions': 1500,
    'd_model': 768, 'encoder_attention_heads': 12, 'encoder_layers': 12,
    'max_target_positions': 448, 'decoder_attention_heads': 12,
    'decoder_layers': 12, 'num_mel_bins': 80}
CONV_MAP = {
    'self_attn.k_proj': 'attn.key', 'self_attn.q_proj': 'attn.query',
    'self_attn.v_proj': 'attn.value', 'self_attn.out_proj': 'attn.out',
    'self_attn_layer_norm': 'attn_ln', 'encoder_attn.q_proj': 'cross_attn.query',
    'encoder_attn.v_proj': 'cross_attn.value', 'encoder_attn.out_proj': 'cross_attn.out',
    'encoder_attn_layer_norm': 'cross_attn_ln', 'fc1': 'mlp.0', 'fc2': 'mlp.2',
    'final_layer_norm': 'mlp_ln', 'encoder.layer_norm.bias': 'encoder.ln_post.bias',
    'encoder.layer_norm.weight': 'encoder.ln_post.weight',
    'encoder.embed_positions.weight': 'encoder.positional_embedding',
    'decoder.layer_norm.bias': 'decoder.ln.bias', 'decoder.layer_norm.weight': 'decoder.ln.weight',
    'decoder.embed_positions.weight': 'decoder.positional_embedding',
    'decoder.embed_tokens.weight': 'decoder.token_embedding.weight',
}

def sha(path, algorithm='sha256'):
    h = hashlib.new(algorithm)
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def bytes_to_unicode():
    values = list(range(ord('!'), ord('~') + 1)) + list(range(ord('¡'), ord('¬') + 1)) + list(range(ord('®'), ord('ÿ') + 1))
    chars = values[:]
    extra = 0
    for value in range(256):
        if value not in values:
            values.append(value)
            chars.append(256 + extra)
            extra += 1
    return dict(zip(values, map(chr, chars)))

def map_name(source):
    if not source.startswith('model.'):
        raise ValueError('Unexpected tensor namespace')
    parts = source.split('.')[1:]
    if parts[1] == 'layers':
        parts[1] = 'blocks'
        operation = '.'.join(parts[3:-1])
        target = ('attn.key' if parts[0] == 'encoder' else 'cross_attn.key') if operation == 'encoder_attn.k_proj' else CONV_MAP[operation]
        return '.'.join(parts[:3] + [target] + parts[-1:])
    name = '.'.join(parts)
    return CONV_MAP.get(name, name)

source = ROOT / 'model.safetensors'
if sha(source) != EXPECTED:
    raise ValueError('Unverified safetensors checkpoint')
config = json.loads((ROOT / 'config.json').read_text('utf-8'))
if any(config.get(key) != value for key, value in EXPECTED_CONFIG.items()):
    raise ValueError('Unexpected model architecture')
with source.open('rb') as stream:
    header_length = struct.unpack('<Q', stream.read(8))[0]
    if not 2 <= header_length <= 1024 * 1024:
        raise ValueError('Invalid safetensors header')
    tensors = json.loads(stream.read(header_length))
tensors.pop('__metadata__', None)
data_start = 8 + header_length
regions = []
for name, info in tensors.items():
    shape, offsets = info['shape'], info['data_offsets']
    if info['dtype'] != 'F32' or not 1 <= len(shape) <= 3 or not all(type(x) is int and 0 < x < 100000 for x in shape):
        raise ValueError('Unexpected safetensors tensor type')
    start, end = offsets
    if type(start) is not int or type(end) is not int or start < 0 or end - start != math.prod(shape) * 4 or end > source.stat().st_size - data_start:
        raise ValueError('Invalid safetensors data span')
    regions.append((start, end))
if len(tensors) != 479 or any(left[1] != right[0] for left, right in zip(sorted(regions), sorted(regions)[1:])):
    raise ValueError('Unexpected tensor count or overlapping data')

vocab = json.loads((ROOT / 'vocab.json').read_text('utf-8'))
added = json.loads((ROOT / 'added_tokens.json').read_text('utf-8'))
if sorted(vocab.values()) != list(range(len(vocab))) or len(vocab) != 50258 or sorted(added.values()) != list(range(50258, config['vocab_size'])):
    raise ValueError('Unexpected tokenizer ids')
decoder = {value: key for key, value in bytes_to_unicode().items()}
filters_archive = ROOT / 'mel_filters.npz'
if sha(filters_archive) != '7450ae70723a5ef9d341e3cee628c7cb0177f36ce42c44b7ed2bf3325f0f6d4c':
    raise ValueError('Unverified mel filters')
with np.load(filters_archive, allow_pickle=False) as archive:
    filters = np.asarray(archive['mel_80'], dtype='<f4')
if filters.shape != (80, 201):
    raise ValueError('Unexpected mel shape')

written = []
with OUT.open('wb') as output:
    header = [0x67676d6c, config['vocab_size'], config['max_source_positions'],
        config['d_model'], config['encoder_attention_heads'], config['encoder_layers'],
        config['max_target_positions'], config['d_model'], config['decoder_attention_heads'],
        config['decoder_layers'], config['num_mel_bins'], 1]
    output.write(struct.pack('<' + 'i' * len(header), *header))
    output.write(struct.pack('<ii', *filters.shape))
    output.write(filters.tobytes(order='C'))
    output.write(struct.pack('<i', len(vocab)))
    for token, token_id in sorted(vocab.items(), key=lambda item: item[1]):
        token_bytes = bytes(decoder[char] for char in token)
        output.write(struct.pack('<i', len(token_bytes)))
        output.write(token_bytes)
    for original, info in tensors.items():
        name = map_name(original)
        if name in {item['name'] for item in written}:
            raise ValueError('Duplicate converted tensor name')
        data = np.memmap(source, dtype='<f4', mode='r', offset=data_start + info['data_offsets'][0], shape=tuple(info['shape'])).squeeze()
        if not np.isfinite(data).all():
            raise ValueError('Non-finite checkpoint weights')
        # Match the official HF converter's F16 rounding before F32 fallback.
        data = data.astype('<f2')
        if name in ('encoder.conv1.bias', 'encoder.conv2.bias'):
            data = data.reshape(data.shape[0], 1)
        tensor_type = 1
        if data.ndim < 2 or name in ('encoder.conv1.bias', 'encoder.conv2.bias', 'encoder.positional_embedding', 'decoder.positional_embedding'):
            data = data.astype('<f4')
            tensor_type = 0
        encoded_name = name.encode('utf-8')
        output.write(struct.pack('<iii', data.ndim, len(encoded_name), tensor_type))
        output.write(struct.pack('<' + 'i' * data.ndim, *reversed(data.shape)))
        output.write(encoded_name)
        data.tofile(output)
        written.append({'source': original, 'name': name, 'shape': list(data.shape), 'ggml_type': tensor_type})
result = {'input_sha256': EXPECTED, 'output': OUT.name, 'bytes': OUT.stat().st_size,
    'sha256': sha(OUT), 'sha1': sha(OUT, 'sha1'), 'tensor_count': len(written),
    'converter_reference': 'https://github.com/ggml-org/whisper.cpp/blob/v1.9.4/models/convert-h5-to-ggml.py',
    'official_converter_sha256': sha(ROOT / 'official-convert-h5-to-ggml.py'),
    'adaptation': 'Safetensors JSON header + numpy memory mapping; no checkpoint code; same tensor names, F16/F32 layout, tokenizer and mel filters.',
    'mel_reference': 'https://github.com/openai/whisper/blob/v20250625/whisper/assets/mel_filters.npz',
    'mel_sha256': sha(filters_archive), 'tensors': written}
(ROOT / 'conversion-verification.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: result[key] for key in ('output', 'bytes', 'sha256', 'sha1', 'tensor_count')}), flush=True)
