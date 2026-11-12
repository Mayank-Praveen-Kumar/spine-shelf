"""Cache verified Microsoft prerequisites and write Inno Setup build definitions."""
from datetime import date
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache' / 'installer'
CACHE.mkdir(parents=True, exist_ok=True)

def download(url, path):
    if not path.exists():
        print('Downloading', path.name, flush=True)
        with urlopen(url, timeout=120) as source, path.open('wb') as output:
            while chunk := source.read(1024 * 1024):
                output.write(chunk)
    return path.read_bytes()

with urlopen('https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/10.0/releases.json', timeout=30) as source:
    releases = json.load(source)['releases']
release = next(item for item in releases if item['release-date'] <= date.today().isoformat() and item.get('windowsdesktop'))
runtime = next(item for item in release['windowsdesktop']['files'] if item['rid'] == 'win-x64' and item['url'].endswith('.exe'))
runtime_path = CACHE / Path(runtime['url']).name
payload = download(runtime['url'], runtime_path)
if hashlib.sha512(payload).hexdigest().casefold() != runtime['hash'].casefold():
    runtime_path.unlink(missing_ok=True)
    raise SystemExit('Microsoft .NET runtime checksum mismatch; the cache entry was removed. Retry the build.')
bootstrapper = CACHE / 'MicrosoftEdgeWebview2Setup.exe'
# Refresh this tiny Evergreen bootstrapper; it is signature-checked before packaging.
if bootstrapper.exists():
    bootstrapper.unlink()
download('https://go.microsoft.com/fwlink/p/?LinkId=2124703', bootstrapper)
definitions = {
    'DotNetUrl': runtime['url'],
    'DotNetSHA256': hashlib.sha256(payload).hexdigest(),
    'DotNetVersion': release['windowsdesktop']['version'],
    'WebViewInstaller': str(bootstrapper),
}
(CACHE / 'Prerequisites.iss').write_text(''.join(f'#define {key} "{value}"\n' for key, value in definitions.items()), encoding='utf-8')
print('Prepared verified .NET', definitions['DotNetVersion'], 'and WebView2 bootstrapper.', flush=True)
