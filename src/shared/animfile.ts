// anims/<Name>.anim: one figatree, its FObj tracks kept as the original packed keyframe streams
// (compact and lossless; evaluated by render/fobj.ts).
import { BinReader, BinWriter } from './bin';
import type { Track } from '../render/fobj';

export interface AnimData {
  frameCount: number;
  type: number;
  flags: number;
  /** tracks[joint] = tracks of that joint. */
  tracks: Track[][];
}

export function writeAnim(a: AnimData): Uint8Array {
  const w = new BinWriter().magic('MWAN').u32(1).f32(a.frameCount).u32(a.type).u32(a.flags).u16(a.tracks.length);
  for (const joint of a.tracks) {
    w.u8(joint.length);
    for (const t of joint) w.u8(t.channel).u8(t.valueFormat).u8(t.slopeFormat).u8(0).i16(t.startFrame).u16(t.bytes.length).bytes(t.bytes);
  }
  return w.finish();
}

export function readAnim(buf: Uint8Array): AnimData {
  const r = new BinReader(buf);
  r.magic('MWAN'); r.u32();
  const frameCount = r.f32(), type = r.u32(), flags = r.u32();
  const n = r.u16();
  const tracks: Track[][] = [];
  for (let j = 0; j < n; j++) {
    const count = r.u8();
    const list: Track[] = [];
    for (let k = 0; k < count; k++) {
      const channel = r.u8(), valueFormat = r.u8(), slopeFormat = r.u8(); r.u8();
      const startFrame = r.i16();
      const len = r.u16();
      list.push({ channel, valueFormat, slopeFormat, startFrame, bytes: r.bytes(len).slice() });
    }
    tracks.push(list);
  }
  return { frameCount, type, flags, tracks };
}
