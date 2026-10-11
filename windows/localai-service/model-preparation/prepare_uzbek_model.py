"""Build-only pinned Uzbek model preparation; network requires explicit --fetch.

Not imported by the application/service. Never reads user settings, credentials,
microphones or speech. Only public build assets and native GGML conversion.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parent
MODEL = 'navai-small-uz-q5_1'
MODEL_FILE = f'ggml-{MODEL}.bin'
REVISION = '4b432caf21c2752bca3384b5df1d41cf0da2801d'
QUANTIZER_SHA256 = '282a6e5e30ea10b0b63624ec32193ffdb6f3cd0f6a2fbc7d9099e1ec4d972466'
OUTPUT_SHA256 = 'b37c8935d4c2603404bdd7659a9e98c4f1f780712392de43d7a2c96fc5a8196b'
OUTPUT_SHA1 = '5a549f1750434650c3bcbc2fb2c85ff91b30cbcc'
OUTPUT_BYTES = 190085504
NATIVE = ('ggml-base.dll', 'ggml-cpu-alderlake.dll', 'ggml-cpu-cannonlake.dll',
    'ggml-cpu-cascadelake.dll', 'ggml-cpu-haswell.dll', 'ggml-cpu-icelake.dll',
    'ggml-cpu-sandybridge.dll', 'ggml-cpu-skylakex.dll', 'ggml-cpu-sse42.dll',
    'ggml-cpu-x64.dll', 'ggml.dll', 'whisper-cli.exe', 'whisper.dll')


def digest(path, algorithm='sha256'):
    value = hashlib.new(algorithm)
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def matches(path, pin):
    return (path.is_file() and not path.is_symlink() and path.stat().st_size == pin['size']
            and digest(path) == pin['sha256'])


def fetch(cache, pin):
    destination = cache / pin['path']
    if matches(destination, pin):
        return
    temporary = cache / (pin['path'] + '.partial')
    started, count, next_report = time.monotonic(), 0, 32 * 1024 * 1024
    request = urllib.request.Request(pin['source'], headers={'User-Agent': 'Coucou-Uzbek-model-builder/1.0'})
    value = hashlib.sha256()
    with urllib.request.urlopen(request, timeout=60) as response, temporary.open('wb') as output:
        while block := response.read(4 * 1024 * 1024):
            count += len(block)
            if count > pin['size']:
                raise ValueError('Public asset exceeds pinned size')
            output.write(block)
            value.update(block)
            if count >= next_report:
                print(f'{pin["path"]}: {count}/{pin["size"]} bytes; {time.monotonic()-started:.1f}s', flush=True)
                next_report += 32 * 1024 * 1024
    if count != pin['size'] or value.hexdigest() != pin['sha256']:
        raise ValueError(f'Public asset checksum mismatch: {pin["path"]}')
    temporary.replace(destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True, help='Build cache, separate from installed runtime/user data')
    parser.add_argument('--output', type=Path, help='New, empty candidate asset directory; production voice directory is rejected')
    parser.add_argument('--fetch', action='store_true', help='Explicitly download pinned public files if missing or invalid')
    parser.add_argument('--verify-only', action='store_true', help='Only verify existing cache hashes; no native process/conversion')
    args = parser.parse_args()
    cache = args.cache.resolve()
    cache.mkdir(parents=True, exist_ok=True)
    pins = json.loads((HERE / 'source-pins.json').read_text('utf-8'))
    if pins['repository'] != 'navai-uz/whisper-small-uzbek' or pins['revision'] != REVISION:
        raise ValueError('Unexpected pinned model source')
    for pin in pins['files'] + pins['build_assets']:
        if Path(pin['path']).name != pin['path']:
            raise ValueError('Unsafe build asset name')
        if args.fetch:
            fetch(cache, pin)
        if not matches(cache / pin['path'], pin):
            raise ValueError(f'Missing or invalid cached asset: {pin["path"]}; use --fetch explicitly')
    print(f'All {len(pins["files"]) + len(pins["build_assets"])} pinned public build assets verified.', flush=True)
    if args.verify_only:
        return
    if args.output is None:
        parser.error('--output is required unless --verify-only is selected')
    output = args.output.resolve()
    production = HERE.parent / 'public-voice'
    if output == production or output.is_relative_to(production):
        raise ValueError('Write to a separate candidate directory; production promotion is a separate reviewed build step')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Candidate output must be empty')
    subprocess.run([sys.executable, str(HERE / 'convert-safetensors-to-ggml.py'), str(cache)], check=True)
    native = cache / 'native'
    native.mkdir(exist_ok=True)
    with zipfile.ZipFile(cache / 'whisper-bin-x64.zip') as archive:
        for name in NATIVE + ('whisper-quantize.exe',):
            # Exact, fixed member names; no generic ZIP extraction/path traversal.
            (native / name).write_bytes(archive.read('Release/' + name))
    quantizer = native / 'whisper-quantize.exe'
    if digest(quantizer) != QUANTIZER_SHA256:
        raise ValueError('Native quantizer checksum mismatch')
    quantized = cache / MODEL_FILE
    with (cache / 'quantize.log').open('wb') as log:
        subprocess.run([str(quantizer), str(cache / 'ggml-navai-small-uz-f16.bin'),
            str(quantized), 'q5_1'], check=True, stdout=log, stderr=subprocess.STDOUT, cwd=native)
    if (quantized.stat().st_size != OUTPUT_BYTES or digest(quantized) != OUTPUT_SHA256
            or digest(quantized, 'sha1') != OUTPUT_SHA1):
        raise ValueError('Converted GGML model differs from independently verified artifact pin')
    output.mkdir(parents=True, exist_ok=True)
    for name in NATIVE:
        shutil.copy2(native / name, output / name)
    shutil.copy2(quantized, output / MODEL_FILE)
    for source, target in (('LICENSE', 'LICENSE-model.txt'), ('NOTICE', 'NOTICE-model.txt'),
            ('APACHE-2.0.txt', 'APACHE-2.0.txt')):
        shutil.copy2(cache / source, output / target)
    for name in ('LICENSE-whisper.txt', 'LICENSE-base-model.txt'):
        shutil.copy2(HERE / name, output / name)
    vad = pins['vad']
    for name in (vad['model_file'], 'LICENSE-vad.txt'):
        shutil.copy2(cache / name, output / name)
    (output / 'VAD-SOURCE.json').write_text(json.dumps(vad, indent=2) + '\n', encoding='utf-8')
    conversion = json.loads((cache / 'conversion-verification.json').read_text('utf-8'))
    provenance = {
        'repository': pins['repository'], 'revision': REVISION, 'license': 'Apache-2.0',
        'original_weights': next(pin for pin in pins['files'] if pin['path'] == 'model.safetensors'),
        'conversion': {key: value for key, value in conversion.items() if key != 'tensors'},
        'conversion_script_sha256': digest(HERE / 'convert-safetensors-to-ggml.py'),
        'quantization': {'mode': 'q5_1', 'engine': 'whisper.cpp', 'version': '1.9.4-b5130',
            'binary': 'https://github.com/ggml-org/whisper.cpp/releases/tag/b5130',
            'release_archive_sha256': digest(cache / 'whisper-bin-x64.zip'),
            'quantizer_sha256': QUANTIZER_SHA256, 'model_sha256': OUTPUT_SHA256,
            'model_sha1': OUTPUT_SHA1, 'model_bytes': OUTPUT_BYTES},
        'notes': 'Derived F16 GGML and Q5_1 precision; no pickle, torch, transformers, model repository code or private data. NavAI Apache-2.0 NOTICE, full license, OpenAI base model MIT and whisper.cpp MIT preserved.'}
    (output / 'MODEL-SOURCE.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8')
    manifest = {'schema': 1, 'engine': 'whisper.cpp', 'version': '1.9.4-b5130',
        'model': MODEL, 'exe': 'whisper-cli.exe', 'model_file': MODEL_FILE, 'languages': ['uz'],
        'vad': {'model': 'silero-v6.2.0', 'model_file': vad['model_file']},
        'sources': {'binary': provenance['quantization']['binary'],
            'model': f'https://huggingface.co/{pins["repository"]}/tree/{REVISION}'},
        'files': [{'path': path.name, 'size': path.stat().st_size, 'sha256': digest(path)}
            for path in sorted(output.iterdir()) if path.is_file() and path.name != 'manifest.json']}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'candidate': str(output), 'model': MODEL, 'sha256': OUTPUT_SHA256,
        'sha1': OUTPUT_SHA1, 'bytes': OUTPUT_BYTES}, indent=2))


if __name__ == '__main__':
    main()
