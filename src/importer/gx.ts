// GameCube GX texture decoding. Everything decodes to RGBA8, except CMPR which is transcoded
// losslessly into BC1 (DXT1): same 4x4 blocks and endpoint rules, different byte and bit order.
import { Archive, HsdError } from './hsd';

export const GX = { I4: 0, I8: 1, IA4: 2, IA8: 3, RGB565: 4, RGB5A3: 5, RGBA8: 6, CI4: 8, CI8: 9, CI14X2: 10, CMPR: 14 } as const;

export interface DecodedTexture {
  width: number;
  height: number;
  /** 'bc1' data is BC1 blocks in row-major block order; 'rgba8' is plain pixels. */
  kind: 'rgba8' | 'bc1';
  data: Uint8Array;
}

const e4 = (v: number) => (v << 4) | v;
const e5 = (v: number) => (v << 3) | (v >> 2);
const e6 = (v: number) => (v << 2) | (v >> 4);
const e3 = (v: number) => (v << 5) | (v << 2) | (v >> 1);

function rgb565(c: number, out: Uint8Array, o: number): void {
  out[o] = e5(c >> 11); out[o + 1] = e6((c >> 5) & 63); out[o + 2] = e5(c & 31); out[o + 3] = 255;
}
function rgb5a3(c: number, out: Uint8Array, o: number): void {
  if (c & 0x8000) { out[o] = e5((c >> 10) & 31); out[o + 1] = e5((c >> 5) & 31); out[o + 2] = e5(c & 31); out[o + 3] = 255; }
  else { out[o] = e4((c >> 8) & 15); out[o + 1] = e4((c >> 4) & 15); out[o + 2] = e4(c & 15); out[o + 3] = e3((c >> 12) & 7); }
}

const BLOCK: Record<number, [number, number, number]> = {
  // format: [block width, block height, bytes per block]
  0: [8, 8, 32], 1: [8, 4, 32], 2: [8, 4, 32], 3: [4, 4, 32], 4: [4, 4, 32], 5: [4, 4, 32], 6: [4, 4, 64],
  8: [8, 8, 32], 9: [8, 4, 32], 10: [4, 4, 32], 14: [8, 8, 32],
};

/** Decodes the texture referenced by a TObj (image desc at +0x4C, palette desc at +0x50). */
export function decodeTObj(a: Archive, tobj: number): DecodedTexture | null {
  const image = a.ptr(tobj + 0x4c);
  if (!image) return null;
  const data = a.ptr(image);
  const width = a.u16(image + 4), height = a.u16(image + 6), format = a.u32(image + 8);
  if (!width || !height || width > 4096 || height > 4096) throw new HsdError('Invalid texture dimensions');
  const pal = a.ptr(tobj + 0x50);
  let palette: Uint8Array | null = null;
  if (format === GX.CI4 || format === GX.CI8 || format === GX.CI14X2) {
    if (!pal) throw new HsdError('Paletted texture without a palette');
    const count = a.u16(pal + 12), pfmt = a.u32(pal + 4), pdata = a.ptr(pal);
    palette = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) {
      const c = a.u16(pdata + 2 * i);
      if (pfmt === 0) { palette[4 * i] = palette[4 * i + 1] = palette[4 * i + 2] = c & 255; palette[4 * i + 3] = c >> 8; }
      else if (pfmt === 1) rgb565(c, palette, 4 * i);
      else rgb5a3(c, palette, 4 * i);
    }
  }
  if (format === GX.CMPR) return { width, height, kind: 'bc1', data: cmprToBc1(a, data, width, height) };
  const info = BLOCK[format];
  if (!info) throw new HsdError(`Unsupported texture format ${format}`);
  const [bw, bh, bytes] = info;
  const out = new Uint8Array(width * height * 4);
  const bx = Math.ceil(width / bw), by = Math.ceil(height / bh);
  const src = a.bytesAt(data, bx * by * bytes);
  let cur = 0;
  const px = new Uint8Array(4);
  for (let tby = 0; tby < by; tby++) for (let tbx = 0; tbx < bx; tbx++) {
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = y * bw + x;
      switch (format) {
        case GX.I4: { const v = e4((src[cur + (i >> 1)] >> (i & 1 ? 0 : 4)) & 15); px[0] = px[1] = px[2] = px[3] = v; break; }
        case GX.I8: { const v = src[cur + i]; px[0] = px[1] = px[2] = px[3] = v; break; }
        case GX.IA4: { const v = src[cur + i]; px[0] = px[1] = px[2] = e4(v & 15); px[3] = e4(v >> 4); break; }
        case GX.IA8: { px[3] = src[cur + 2 * i]; px[0] = px[1] = px[2] = src[cur + 2 * i + 1]; break; }
        case GX.RGB565: rgb565((src[cur + 2 * i] << 8) | src[cur + 2 * i + 1], px, 0); break;
        case GX.RGB5A3: rgb5a3((src[cur + 2 * i] << 8) | src[cur + 2 * i + 1], px, 0); break;
        case GX.RGBA8: { px[3] = src[cur + 2 * i]; px[0] = src[cur + 2 * i + 1]; px[1] = src[cur + 32 + 2 * i]; px[2] = src[cur + 32 + 2 * i + 1]; break; }
        case GX.CI4: case GX.CI8: case GX.CI14X2: {
          const idx = format === GX.CI4 ? (src[cur + (i >> 1)] >> (i & 1 ? 0 : 4)) & 15
            : format === GX.CI8 ? src[cur + i] : ((src[cur + 2 * i] << 8) | src[cur + 2 * i + 1]) & 0x3fff;
          if (!palette || idx * 4 >= palette.length) throw new HsdError('Texture palette index out of range');
          px.set(palette.subarray(idx * 4, idx * 4 + 4));
          break;
        }
      }
      const X = tbx * bw + x, Y = tby * bh + y;
      if (X < width && Y < height) out.set(px, (Y * width + X) * 4);
    }
    cur += bytes;
  }
  return { width, height, kind: 'rgba8', data: out };
}

/** CMPR is 8x8 tiles of four 4x4 DXT1-like blocks (big-endian colors, MSB-first 2-bit indices). */
function cmprToBc1(a: Archive, data: number, width: number, height: number): Uint8Array {
  const bw = Math.ceil(width / 4), bh = Math.ceil(height / 4);
  const tilesX = Math.ceil(width / 8), tilesY = Math.ceil(height / 8);
  const src = a.bytesAt(data, tilesX * tilesY * 32);
  const out = new Uint8Array(bw * bh * 8);
  let cur = 0;
  for (let ty = 0; ty < tilesY; ty++) for (let tx = 0; tx < tilesX; tx++) {
    for (let sub = 0; sub < 4; sub++, cur += 8) {
      const bx = tx * 2 + (sub & 1), by = ty * 2 + (sub >> 1);
      if (bx >= bw || by >= bh) continue;
      const o = (by * bw + bx) * 8;
      out[o] = src[cur + 1]; out[o + 1] = src[cur];
      out[o + 2] = src[cur + 3]; out[o + 3] = src[cur + 2];
      for (let r = 0; r < 4; r++) {
        const b = src[cur + 4 + r];
        out[o + 4 + r] = ((b >> 6) & 3) | (((b >> 4) & 3) << 2) | (((b >> 2) & 3) << 4) | ((b & 3) << 6);
      }
    }
  }
  return out;
}

/** Software BC1 decode, for the fallback when WEBGL_compressed_texture_s3tc is missing. */
export function bc1ToRgba(width: number, height: number, bc1: Uint8Array): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const bw = Math.ceil(width / 4), bh = Math.ceil(height / 4);
  const pal = new Uint8Array(16);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const o = (by * bw + bx) * 8;
    const c0 = bc1[o] | (bc1[o + 1] << 8), c1 = bc1[o + 2] | (bc1[o + 3] << 8);
    rgb565(c0, pal, 0); rgb565(c1, pal, 4);
    for (let k = 0; k < 3; k++) {
      if (c0 > c1) { pal[8 + k] = (2 * pal[k] + pal[4 + k]) / 3 | 0; pal[12 + k] = (pal[k] + 2 * pal[4 + k]) / 3 | 0; }
      else { pal[8 + k] = (pal[k] + pal[4 + k]) >> 1; pal[12 + k] = 0; }
    }
    pal[11] = 255; pal[15] = c0 > c1 ? 255 : 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const X = bx * 4 + x, Y = by * 4 + y;
      if (X >= width || Y >= height) continue;
      const idx = (bc1[o + 4 + y] >> (2 * x)) & 3;
      out.set(pal.subarray(idx * 4, idx * 4 + 4), (Y * width + X) * 4);
    }
  }
  return out;
}
