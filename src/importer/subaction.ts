// Decodes Melee subaction scripts (ft/ftaction.c, lb/lbcommand.c) into plain command objects.
// Command words are big-endian; the opcode is the top 6 bits; fields are MSB-first bitfields
// (layouts from lb/types.h). Lengths in words from ftAction_803C0870.
import { Archive } from './hsd';

const LENGTHS_FROM_10 = [5, 5, 1, 1, 1, 1, 1, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 1, 1, 1, 7, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 3, 2, 1, 4];

export function commandLength(op: number): number {
  if (op < 10) return op === 5 || op === 7 ? 2 : 1;
  return LENGTHS_FROM_10[op - 10] ?? 1;
}

export type RawCommand = {
  op: number;
  /** Offset in the archive's data block. */
  at: number;
  words: number[];
  /** For goto/subroutine: the target offset. */
  target?: number;
};

/** Unsigned bitfield `bits` wide starting `from` bits below the MSB of `word`. */
export function field(word: number, from: number, bits: number): number {
  return (word >>> (32 - from - bits)) & (bits === 32 ? 0xffffffff : (1 << bits) - 1);
}
export function sfield(word: number, from: number, bits: number): number {
  const v = field(word, from, bits);
  return v & (1 << (bits - 1)) ? v - (1 << bits) : v;
}

/** Reads one linear script (until end/return/goto), without following jumps. */
export function readScript(a: Archive, start: number, limit = 4096): RawCommand[] {
  const out: RawCommand[] = [];
  let at = start;
  for (let n = 0; n < limit; n++) {
    const w0 = a.u32(at);
    const op = w0 >>> 26;
    const len = commandLength(op);
    const words: number[] = [];
    for (let k = 0; k < len; k++) words.push(a.u32(at + 4 * k));
    const cmd: RawCommand = { op, at, words };
    if ((op === 5 || op === 7) && a.isPtr(at + 4)) cmd.target = a.ptr(at + 4);
    out.push(cmd);
    at += 4 * len;
    if (op === 0 || op === 6 || op === 7) break;
  }
  return out;
}

/** Every script reachable from `start` (the main one first), keyed by offset. */
export function reachableScripts(a: Archive, start: number): Map<number, RawCommand[]> {
  const seen = new Map<number, RawCommand[]>();
  const queue = [start];
  while (queue.length) {
    const s = queue.shift()!;
    if (seen.has(s)) continue;
    const cmds = readScript(a, s);
    seen.set(s, cmds);
    for (const c of cmds) if (c.target !== undefined && !seen.has(c.target)) queue.push(c.target);
  }
  return seen;
}

/** Sound ids named by a command (sound, random sound). */
export function soundIds(c: RawCommand): number[] {
  if (c.op === 17) {
    const behavior = field(c.words[0], 6, 8);
    return behavior <= 6 ? [c.words[1]] : [];
  }
  if (c.op === 38) return c.words.slice(1).filter((w) => w !== 0 && w < 0x83d60);
  // Footstep (54) and landing (55): the command's own id is what plays on a plain floor.
  if (c.op === 54 || c.op === 55) return [c.words[1]];
  return [];
}
