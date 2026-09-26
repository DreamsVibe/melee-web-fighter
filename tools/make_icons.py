"""Draws the extension's toolbar icons (original art: a diamond ECB over a platform line)."""
import struct, zlib, os

def png(path, size):
    px = []
    c = size / 2
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            u, v = (x + 0.5 - c) / c, (y + 0.5 - c) / c
            r = g = b = a = 0
            if abs(u) + abs(v + 0.12) < 0.62:           # the diamond
                r, g, b, a = 255, 138, 36, 255
            if abs(u) + abs(v + 0.12) < 0.40:
                r, g, b, a = 255, 214, 120, 255
            if 0.62 < v < 0.78 and abs(u) < 0.9:         # the platform
                r, g, b, a = 40, 200, 230, 255
            row += bytes([r, g, b, a])
        px.append(bytes(row))
    raw = b''.join(px)
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    data += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)

here = os.path.join(os.path.dirname(__file__), '..', 'src', 'static', 'icons')
for s in (32, 128):
    png(os.path.join(here, 'icon%d.png' % s), s)
