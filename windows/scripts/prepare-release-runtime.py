"""Build-only, hash-pinned runtime bootstrap for Windows source checkouts.

Requires only the Python standard library. No app startup downloader, installer
execution, credentials, microphone access, Telegram connection or provider call.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.request
import uuid
import zipfile

HERE = Path(__file__).resolve().parent
DEFAULT_ROOT = HERE.parent
PINS = HERE / 'release-runtime-0.6.3.json'
MAX_MANIFEST = 1024 * 1024
MAX_FILE = 200 * 1024 * 1024
MAX_MEMBERS = 2100
MAX_PAYLOAD = 600 * 1024 * 1024
MFC = ('mfc140u.dll', 'mfc140enu.dll')
CRT = ('msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll',
       'msvcp140_atomic_wait.dll', 'msvcp140_codecvt_ids.dll', 'concrt140.dll')


def sha(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def no_links(path):
    if any(part.is_symlink() or (hasattr(part, 'is_junction') and part.is_junction())
           for part in (path, *path.parents)):
        raise ValueError('Redirected build input or destination')


def safe_name(name):
    if (not isinstance(name, str) or not name or '\\' in name
            or re.search(r'[:\x00-\x1f]', name)):
        raise ValueError('Unsafe public runtime path')
    for part in name.split('/'):
        if (part in ('', '.', '..') or part.endswith(('.', ' '))
                or re.fullmatch(r'(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?', part, re.I)):
            raise ValueError('Unsafe public runtime path segment')
    if re.search(r'(^|/)(config|accounts|logs|captures|workspace)(/|$)|(^|/)(\.env($|\.)|settings\.json$|config\.json$|.*\.(session|session-journal|sqlite|sqlite3|db|log|pem|key)$)', name, re.I):
        raise ValueError('Private state is not a release build input')
    return name


def load_pins():
    pins = json.loads(PINS.read_text('utf-8'))
    if (pins.get('version') != '0.6.3' or pins.get('file') != 'BIMOAI-Windows-runtime-base.zip'
            or pins.get('release_version') != '0.7.1'
            or pins.get('url') != 'https://github.com/Ahmadjon0worker/BIMO-AI/releases/download/v0.7.1/BIMOAI-Windows-runtime-base.zip'
            or not re.fullmatch('[a-f0-9]{64}', pins.get('sha256', ''))
            or not re.fullmatch('[a-f0-9]{64}', pins.get('manifest_sha256', ''))
            or type(pins.get('bytes')) is not int or not 1 <= pins['bytes'] < 600 * 1024 * 1024
            or pins.get('files') != 2068 or pins.get('payload_bytes') != 571951706):
        raise ValueError('Invalid fixed release asset pin')
    return pins


def download(path, pins):
    no_links(path)
    if path.exists():
        if path.is_file() and path.stat().st_size == pins['bytes'] and sha(path) == pins['sha256']:
            return
        raise ValueError('Existing archive differs from the fixed release; refusing to overwrite it')
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.parent / (path.name + '.' + uuid.uuid4().hex + '.partial')
    value, count = hashlib.sha256(), 0
    request = urllib.request.Request(pins['url'], headers={'User-Agent': 'BIMOAI-public-runtime-bootstrap/0.7.1'})
    with urllib.request.urlopen(request, timeout=60) as response, temporary.open('xb') as output:
        while block := response.read(1024 * 1024):
            count += len(block)
            if count > pins['bytes']:
                raise ValueError('Release archive exceeded its pinned size')
            output.write(block)
            value.update(block)
    if count != pins['bytes'] or value.hexdigest() != pins['sha256']:
        raise ValueError('Release archive checksum mismatch')
    no_links(path)
    if path.exists():
        raise ValueError('Archive destination appeared during download')
    temporary.replace(path)


def verify_archive(path, pins, destination=None):
    no_links(path)
    if not path.is_file() or path.stat().st_size != pins['bytes'] or sha(path) != pins['sha256']:
        raise ValueError('Release ZIP size or SHA256 does not match its source-controlled pin')
    with zipfile.ZipFile(path) as archive:
        members = archive.infolist()
        if len(members) != pins['files'] + 1 or len(members) > MAX_MEMBERS:
            raise ValueError('Unexpected public runtime archive member count')
        names = set()
        for item in members:
            name = safe_name(item.filename)
            mode = item.external_attr >> 16
            if (item.is_dir() or (stat.S_IFMT(mode) not in (0, stat.S_IFREG))
                    or item.flag_bits & 1 or not 0 <= item.file_size <= MAX_FILE
                    or name.casefold() in names):
                raise ValueError('Duplicate, encrypted, redirected or oversized ZIP member')
            names.add(name.casefold())
        manifest_info = archive.getinfo('runtime-manifest.json')
        if not 1 <= manifest_info.file_size <= MAX_MANIFEST:
            raise ValueError('Oversized runtime manifest')
        raw = archive.read(manifest_info)
        if hashlib.sha256(raw).hexdigest() != pins['manifest_sha256']:
            raise ValueError('Release runtime manifest checksum mismatch')
        manifest = json.loads(raw)
        if (manifest.get('service') != 'coucou-localai-service' or manifest.get('architecture') != 'x64'
                or manifest.get('python') != '3.12.14' or manifest.get('no_user_config_or_credentials') is not True
                or manifest.get('file_count') != pins['files'] or manifest.get('total_bytes') != pins['payload_bytes']
                or not isinstance(manifest.get('files'), list) or len(manifest['files']) != pins['files']):
            raise ValueError('Unexpected public runtime identity')
        expected = {'runtime-manifest.json': {'bytes': len(raw), 'sha256': pins['manifest_sha256']}}
        folded, total = {'runtime-manifest.json'}, 0
        for entry in manifest['files']:
            if set(entry) != {'path', 'bytes', 'sha256'}:
                raise ValueError('Invalid runtime allowlist entry')
            name = safe_name(entry['path'])
            if (name.casefold() in folded or type(entry['bytes']) is not int
                    or not 0 <= entry['bytes'] <= MAX_FILE
                    or not re.fullmatch('[a-f0-9]{64}', entry['sha256'])):
                raise ValueError('Duplicate or invalid runtime allowlist entry')
            expected[name] = entry
            folded.add(name.casefold())
            total += entry['bytes']
        if total != pins['payload_bytes'] or total > MAX_PAYLOAD or names != folded:
            raise ValueError('Archive members differ from the exact public allowlist')
        for item in members:
            pin = expected[item.filename]
            if item.file_size != pin['bytes']:
                raise ValueError('ZIP member size differs from allowlist')
            target = destination / item.filename if destination is not None else None
            output = None
            if target is not None:
                no_links(target)
                if not target.resolve().is_relative_to(destination.resolve()):
                    raise ValueError('Extraction escaped the staging directory')
                target.parent.mkdir(parents=True, exist_ok=True)
                output = target.open('xb')
            value, count = hashlib.sha256(), 0
            try:
                with archive.open(item) as source:
                    while block := source.read(1024 * 1024):
                        count += len(block)
                        if count > pin['bytes']:
                            raise ValueError('Decompressed ZIP member exceeded allowlist size')
                        value.update(block)
                        if output is not None:
                            output.write(block)
            finally:
                if output is not None:
                    output.close()
            if count != pin['bytes'] or value.hexdigest() != pin['sha256']:
                raise ValueError('Decompressed ZIP member checksum mismatch')
    return manifest


def copy_regular(source, target):
    no_links(source)
    no_links(target)
    if not source.is_file():
        raise ValueError('Missing verified build input')
    if target.exists():
        if target.is_file() and target.stat().st_size == source.stat().st_size and sha(target) == sha(source):
            return
        raise ValueError(f'Refusing to overwrite a different existing generated input: {target.name}')
    target.parent.mkdir(parents=True, exist_ok=True)
    with source.open('rb') as incoming, target.open('xb') as output:
        shutil.copyfileobj(incoming, output, 1024 * 1024)


def hydrate(stage, project, manifest):
    service = project / 'localai-service'
    bundle = service / 'bundle'
    allowed = {'runtime-manifest.json', *(entry['path'] for entry in manifest['files'])}
    no_links(bundle)
    if bundle.exists():
        if not bundle.is_dir():
            raise ValueError('Generated bundle path is not a directory')
        for item in bundle.rglob('*'):
            no_links(item)
            if item.is_file() and item.relative_to(bundle).as_posix() not in allowed:
                raise ValueError('Existing bundle contains an unlisted file; review it before hydration')
    for name in ['runtime-manifest.json'] + [item['path'] for item in manifest['files']]:
        copy_regular(stage / name, bundle / name)
        if name.startswith('voice/'):
            copy_regular(stage / name, service / 'public-voice' / name.removeprefix('voice/'))
    for name in ('gh.exe', 'LICENSE-GitHub-CLI.txt', 'github-cli-provenance.json'):
        copy_regular(stage / 'bin' / name, service / 'public-tools' / name)
    copy_regular(stage / 'licenses/espeak-ng-source.tar.gz', service / 'public-tools/espeak-ng-source.tar.gz')
    for name in MFC:
        copy_regular(stage / 'runtime' / name, service / 'redist-extract/additional/File' / (name + '_amd64'))
    for name in CRT:
        copy_regular(stage / 'runtime' / name, service / 'redist-extract/minimum/File' / (name + '_amd64'))
    copy_regular(stage / 'LICENSE-Microsoft-VC-Redistributable.rtf', service / 'redist-extract/UX/license.rtf')


def main():
    if sys.version_info < (3, 12):
        raise SystemExit('Python 3.12 or newer is required for Windows junction checks. Use py -3.12 to run this build helper.')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, help='Existing release ZIP; no network is used unless --download is supplied')
    parser.add_argument('--download', action='store_true', help='Explicitly fetch the fixed public GitHub release URL')
    parser.add_argument('--verify-only', action='store_true', help='Verify the entire ZIP without extracting or executing anything')
    parser.add_argument('--project-root', type=Path, default=DEFAULT_ROOT, help='Windows source directory, normally inferred from this script')
    parser.add_argument('--skip-sync', action='store_true', help='Only hydrate pinned public inputs; leave source synchronization for a separate command')
    args = parser.parse_args()
    pins = load_pins()
    project = args.project_root.absolute()
    no_links(project)
    cache = project / '.build-inputs'
    no_links(cache)
    archive = args.archive.absolute() if args.archive else cache / pins['file']
    if args.download:
        download(archive, pins)
    if args.verify_only:
        manifest = verify_archive(archive, pins)
        print(f'Verified frozen v0.6.3 runtime base: {manifest["file_count"]} files, {manifest["total_bytes"]} public payload bytes.')
        return
    if sys.platform != 'win32':
        raise ValueError('Hydration and native source synchronization require Windows x64')
    service = project / 'localai-service'
    if not args.skip_sync and not (service / 'build_runtime.py').is_file():
        raise ValueError('Source checkout is missing localai-service/build_runtime.py')
    cache.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='runtime-', dir=cache)).absolute()
    if not stage.is_relative_to(cache.absolute()):
        raise ValueError('Generated staging directory escaped build cache')
    try:
        manifest = verify_archive(archive, pins, stage)
        hydrate(stage, project, manifest)
    finally:
        # This exact temporary directory was created above, below the checked
        # build cache; no archive-provided path controls the cleanup target.
        no_links(stage)
        if not stage.resolve().is_relative_to(cache.resolve()):
            raise ValueError('Refusing cleanup outside the generated build cache')
        shutil.rmtree(stage)
    if not args.skip_sync:
        executable = service / 'bundle/runtime/python.exe'
        no_links(executable)
        subprocess.run([str(executable), '-B', str(service / 'build_runtime.py'), '--sync-source'],
                       cwd=project, check=True)
    print('Verified public runtime, voice, GitHub CLI and private redist inputs are prepared.')
    print('Current source synchronization completed.' if not args.skip_sync else 'Run build_runtime.py --sync-source after adding current service source.')


if __name__ == '__main__':
    main()
