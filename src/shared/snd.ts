// Reads .snd files (see importer/sound.ts writeSnd) and decodes their DSP-ADPCM to float PCM.
import { BinReader } from './bin';

export interface SndChannel { loop: boolean; skip: number; loopStart: number; count: number; coefs: Int16Array; frames: Uint8Array }
export interface Snd { sampleRate: number; channels: SndChannel[] }

export function readSnd(buf: Uint8Array): Snd {
  const r = new BinReader(buf);
  r.magic('MWSD'); r.u32();
  const sampleRate = r.u32(), n = r.u8();
  r.u8(); r.u16();
  const channels: SndChannel[] = [];
  for (let c = 0; c < n; c++) {
    const loop = r.u8() === 1, skip = r.u8();
    r.u16();
    const loopStart = r.u32(), count = r.u32();
    const coefs = new Int16Array(16);
    for (let k = 0; k < 16; k++) coefs[k] = r.i16();
    const len = r.u32();
    channels.push({ loop, skip, loopStart, count, coefs, frames: r.bytes(len) });
  }
  return { sampleRate, channels };
}

/** Standard GameCube DSP-ADPCM decode (8-byte frames of 14 4-bit samples). */
export function decodeChannel(ch: SndChannel): Float32Array {
  const out = new Float32Array(ch.count);
  let h1 = 0, h2 = 0, n = 0;
  const total = ch.count + ch.skip;
  const frames = ch.frames;
  for (let f = 0; n < total && f * 8 < frames.length; f++) {
    const header = frames[f * 8];
    const scale = 1 << (header & 15);
    const pred = (header >> 4) & 7;
    const c1 = ch.coefs[pred * 2], c2 = ch.coefs[pred * 2 + 1];
    for (let i = 0; i < 14 && n < total; i++, n++) {
      const byte = frames[f * 8 + 1 + (i >> 1)];
      let nib = i & 1 ? byte & 15 : byte >> 4;
      if (nib >= 8) nib -= 16;
      let s = ((nib * scale) << 11) + c1 * h1 + c2 * h2 + 1024 >> 11;
      s = s < -32768 ? -32768 : s > 32767 ? 32767 : s;
      h2 = h1; h1 = s;
      if (n >= ch.skip) out[n - ch.skip] = s / 32768;
    }
  }
  return out;
}
