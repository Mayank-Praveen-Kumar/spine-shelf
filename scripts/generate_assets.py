"""Generate the app's original icon and soft click sound, using only the stdlib."""
from pathlib import Path
import math
import struct
import wave
import zlib
import json

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ASSETS.mkdir(exist_ok=True)

def png(size, palette):
    stops = [bytes.fromhex(c.lstrip("#")) for c in palette["colors"]]
    ink = tuple(bytes.fromhex(palette["ink"].lstrip("#")))
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            a, b = x * 256 / size, y * 256 / size
            inside = (a - 128)**2 + (b - 128)**2 <= 121**2
            t = min(1, max(0, (a * .35 + b * .65) / 255)) * (len(stops)-1)
            part = min(len(stops)-2, int(t)); fraction = t - part
            background = tuple(round(stops[part][i] * (1-fraction) + stops[part+1][i] * fraction) for i in range(3))
            book = (52 <= a <= 204 and (65 <= b <= 74 or 181 <= b <= 190)
                    or 52 <= a <= 61 and 65 <= b <= 190
                    or 195 <= a <= 204 and 65 <= b <= 190
                    or 123 <= a <= 132 and 65 <= b <= 202)
            rows.extend((*ink,255) if book and inside else (*background,255) if inside else (0,0,0,0))
    def chunk(kind, data):
        return struct.pack('!I',len(data))+kind+data+struct.pack('!I',zlib.crc32(kind+data))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')

def icon(images):
    offset = 6 + 16 * len(images)
    header = struct.pack('<3H',0,1,len(images))
    for size, data in zip((32,48,256),images):
        header += struct.pack('<4B2H2I',size % 256,size % 256,0,0,1,32,len(data),offset)
        offset += len(data)
    return header+b''.join(images)

variants = json.loads((ASSETS/'icon-palettes.json').read_text())
(ASSETS/'icons').mkdir(exist_ok=True)
for name, palette in variants.items():
    images = [png(size,palette) for size in (32,48,256)]
    (ASSETS/'icons'/('spine-'+name+'.ico')).write_bytes(icon(images))
    if name == 'violet':
        (ASSETS/'spine-shelf.ico').write_bytes(icon(images))
        (ASSETS/'spine-shelf.png').write_bytes(images[-1])
with wave.open(str(ROOT / 'button-click.wav'),'wb') as sound:
    sound.setparams((1,2,22050,0,'NONE','not compressed'))
    sound.writeframes(b''.join(struct.pack('<h', int(1800*math.sin(2*math.pi*900*i/22050)*math.exp(-i/95))) for i in range(660)))
print('Generated icon and click sound.')
