// Melee sound data: smash2.sem (per-sound-id scripts) and .ssm banks (DSP-ADPCM samples).
// See NOTES.md "Audio"; sources sysdolphin/baselib/axdriver.c (AXDriverInterp) and lb/lbaudio_ax.c.
import { BinWriter } from '../shared/bin';

const be = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

export interface Sem {
  bankBase: number[];
  /** Command words for each global sound script index. */
  scriptAt(index: number): Uint32Array;
}

export function readSem(buf: Uint8Array): Sem {
  const dv = be(buf);
  let o = 0;
  const sections: Array<[number, number]> = [];
  for (let k = 0; k < 4; k++) {
    const n = dv.getUint32(o);
    sections.push([o + 4, n]);
    o += 4 + 4 * n;
  }
  const bankBase = Array.from({ length: sections[2][1] }, (_, i) => dv.getUint32(sections[2][0] + 4 * i));
  const [scriptTable, scriptCount] = sections[3];
  return {
    bankBase,
    scriptAt(index: number): Uint32Array {
      if (index < 0 || index >= scriptCount) return new Uint32Array(0);
      const p = dv.getUint32(scriptTable + 4 * index);
      const words: number[] = [];
      for (let k = 0; k < 64 && p + 4 * k + 4 <= buf.length; k++) {
        const w = dv.getUint32(p + 4 * k);
        words.push(w);
        if (w >>> 24 === 14 || w >>> 24 === 15) break;
      }
      return new Uint32Array(words);
    },
  };
}

/** One sample start inside a sound: after `delayMs`, play sample `fid` with these params. */
export interface SoundStep { delayMs: number; fid: number; volume: number; pitchCents: number; pan: number }

/** AXDriver's interpreter, flattened: each wait/end with a pending "play" becomes a step. */
export function soundSteps(sem: Sem, soundId: number): SoundStep[] {
  const bank = Math.floor(soundId / 10000), entry = soundId % 10000;
  if (bank >= sem.bankBase.length) return [];
  const words = sem.scriptAt(sem.bankBase[bank] + entry);
  const steps: SoundStep[] = [];
  let fid = -1, pending = false, vol = 255, pan = 128, pitch = 0, time = 0;
  const flush = () => { if (pending && fid >= 0) steps.push({ delayMs: time * 5, fid, volume: vol, pitchCents: pitch, pan }); pending = false; };
  for (const w of words) {
    const type = w >>> 24;
    switch (type) {
      case 0: flush(); time += w & 0xffffff; break;
      case 1: fid = w & 0xffff; pending = true; break;
      case 6: vol = w & 0xff; break;
      case 7: vol = Math.max(0, Math.min(255, vol + ((w << 24) >> 24))); break;
      case 8: pan = w & 0xff; break;
      case 9: pan = Math.max(0, Math.min(255, pan + ((w << 24) >> 24))); break;
      case 12: pitch = (w << 16) >> 16; break;
      case 13: pitch = Math.max(-0x2a30, Math.min(0x960, pitch + ((w << 16) >> 16))); break;
      case 14: case 15: flush(); return steps;
    }
  }
  flush();
  return steps;
}

export interface SsmChannel { loop: boolean; loopStart: number; start: number; end: number; coefs: Int16Array; ps: number; yn1: number; yn2: number }
export interface SsmEntry { fid: number; sampleRate: number; channels: SsmChannel[] }
export interface Ssm { firstFid: number; entries: SsmEntry[]; data: Uint8Array }

export function readSsm(buf: Uint8Array): Ssm {
  const dv = be(buf);
  const tableSize = dv.getUint32(0), dataSize = dv.getUint32(4), count = dv.getUint32(8), firstFid = dv.getUint32(12);
  const entries: SsmEntry[] = [];
  let o = 16;
  for (let i = 0; i < count; i++) {
    const nch = dv.getUint32(o), sampleRate = dv.getUint32(o + 4);
    o += 8;
    const channels: SsmChannel[] = [];
    for (let c = 0; c < nch; c++, o += 0x40) {
      const coefs = new Int16Array(16);
      for (let k = 0; k < 16; k++) coefs[k] = dv.getInt16(o + 16 + 2 * k);
      channels.push({
        loop: dv.getUint32(o) !== 0, loopStart: dv.getUint32(o + 4), end: dv.getUint32(o + 8), start: dv.getUint32(o + 12),
        coefs, ps: dv.getUint16(o + 0x32), yn1: dv.getInt16(o + 0x34), yn2: dv.getInt16(o + 0x36),
      });
    }
    entries.push({ fid: firstFid + i, sampleRate, channels });
  }
  return { firstFid, entries, data: buf.subarray(16 + tableSize, 16 + tableSize + dataSize) };
}

/** Nibble address → sample index (8-byte frames: 2 header nibbles + 14 sample nibbles). */
export const nibbleToSample = (n: number) => Math.floor(n / 16) * 14 + (n % 16) - 2;

/**
 * .snd: our container for one sample, still DSP-ADPCM compressed.
 * 'MWSD' u32 version, u32 sampleRate, u8 channels, pad; per channel: u8 loop, pad, u32 loopStart
 * (samples), u32 sampleCount, i16 coefs[16], u32 byteLength, frames (starting at a frame boundary;
 * the first frame's first sample is skipped by `skip` samples).
 */
export function writeSnd(ssm: Ssm, e: SsmEntry): Uint8Array {
  const w = new BinWriter().magic('MWSD').u32(1).u32(e.sampleRate).u8(e.channels.length).u8(0).u16(0);
  for (const c of e.channels) {
    const firstFrame = Math.floor(c.start / 16);
    const lastFrame = Math.floor(c.end / 16);
    const frames = ssm.data.subarray(firstFrame * 8, lastFrame * 8 + 8);
    const skip = (c.start % 16) - 2;
    const count = nibbleToSample(c.end) - nibbleToSample(c.start) + 1;
    const loopStart = c.loop ? nibbleToSample(c.loopStart) - nibbleToSample(c.start) : 0;
    w.u8(c.loop ? 1 : 0).u8(skip).u16(0).u32(Math.max(0, loopStart)).u32(count);
    for (const k of c.coefs) w.i16(k);
    w.u32(frames.length).bytes(frames);
  }
  return w.finish();
}
