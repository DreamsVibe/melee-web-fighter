// Fox's action (submotion) table from PlFx.dat: one entry per action with its animation (an archive
// inside PlFxAJ.dat) and its subaction script. See NOTES.md "HSD archive".
import { Archive } from './hsd';
import type { AnimData } from '../shared/animfile';
import type { Track } from '../render/fobj';

export interface ActionEntry {
  index: number;
  /** Animation name without the PlyFox5K_Share_ACTION_ prefix and _figatree suffix ("" if none). */
  anim: string;
  ajOffset: number;
  ajSize: number;
  script: number; // data offset in PlFx.dat, 0 when none
  flags: number;
}

export function ftDataRoot(plfx: Archive): number {
  for (const [name, off] of plfx.roots) if (name.startsWith('ftData')) return off;
  throw new Error('PlFx.dat has no ftData root');
}

export function readActionTable(plfx: Archive): ActionEntry[] {
  const root = ftDataRoot(plfx);
  const table = plfx.ptr(root + 0xc);
  const demo = plfx.ptr(root + 0x14);
  // The common+special table runs up to the win/lose ("demo") table that follows it.
  const count = demo > table ? (demo - table) / 0x18 : 295;
  const out: ActionEntry[] = [];
  for (let i = 0; i < count; i++) {
    const e = table + 0x18 * i;
    let anim = '';
    if (plfx.isPtr(e)) {
      const s = plfx.cstr(plfx.ptr(e));
      anim = s.replace(/^Ply\w+?_Share_ACTION_/, '').replace(/_figatree$/, '');
    }
    out.push({
      index: i, anim, ajOffset: plfx.u32(e + 4), ajSize: plfx.u32(e + 8),
      script: plfx.isPtr(e + 12) ? plfx.ptr(e + 12) : 0, flags: plfx.u32(e + 16),
    });
  }
  return out;
}

/** Reads the figatree archive at `offset` in PlFxAJ.dat. */
export function readFigatree(aj: Uint8Array, offset: number, size: number): AnimData {
  const a = new Archive(aj.subarray(offset, offset + size));
  const [, tree] = a.rootEndingWith('_figatree');
  const type = a.u32(tree), flags = a.u32(tree + 4), frameCount = a.f32(tree + 8);
  const counts = a.ptr(tree + 12);
  let tracks = a.ptr(tree + 16);
  const out: Track[][] = [];
  for (let node = 0; ; node++) {
    if (node > 4096) throw new Error('Unterminated animation node table');
    const n = a.u8(counts + node);
    if (n === 0xff) break;
    const list: Track[] = [];
    for (let k = 0; k < n; k++, tracks += 12) {
      const len = a.u16(tracks);
      list.push({
        startFrame: a.s16(tracks + 2), channel: a.u8(tracks + 4), valueFormat: a.u8(tracks + 5), slopeFormat: a.u8(tracks + 6),
        bytes: a.bytesAt(a.ptr(tracks + 8), len).slice(),
      });
    }
    out.push(list);
  }
  return { frameCount, type, flags, tracks: out };
}
