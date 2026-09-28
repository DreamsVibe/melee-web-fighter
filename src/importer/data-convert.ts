// attributes.json (per character) and common.json (PlCo.dat constants), with readable float values.
import { Archive } from './hsd';
import { ftDataRoot } from './actions';
import { ATTRIBUTE_FIELDS, COMMON_FIELDS, readFields, type Field, type NamedValues } from '../shared/attributes';

/** Shortest decimal that reads back as the same 32-bit float. */
export function tidy(v: number): number {
  for (let d = 1; d <= 9; d++) {
    const t = Number(v.toPrecision(d));
    if (Math.fround(t) === Math.fround(v)) return t;
  }
  return v;
}
const tidyAll = (o: NamedValues) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, tidy(v)]));

export function readAttributes(a: Archive, specialFields: Field[]): { attributes: NamedValues; special: NamedValues } {
  const root = ftDataRoot(a);
  return {
    attributes: tidyAll(readFields(a, a.ptr(root), ATTRIBUTE_FIELDS)),
    special: specialFields.length ? tidyAll(readFields(a, a.ptr(root + 4), specialFields)) : {},
  };
}

export function readCommon(plco: Archive): NamedValues {
  const root = plco.root('ftLoadCommonData');
  const out = tidyAll(readFields(plco, plco.ptr(root), COMMON_FIELDS));
  // Stale-move multipliers (ftLoadCommonData[3], Fighter_804D6548): what the nth most recent use of
  // the same move takes off.
  const stale = plco.ptr(root + 0xc);
  for (let i = 0; i < 9; i++) out[`stale_${i}`] = tidy(plco.f32(stale + 4 * i));
  return out;
}

/** Fighter_Part enum up to TransN2 (ft/forward.h). */
const PART_COUNT = 53;

/**
 * Data the engine needs besides attributes: the character's part → joint table (ftPartsTable in
 * PlCo.dat, ftLoadCommonData[4], indexed by Ft_Kind) and the shield and item-hold joints
 * (ftData +0x8 → +0x11/+0x10).
 */
export function readExtras(a: Archive, plco: Archive, kind: number): { parts: number[]; shieldJoint: number; itemJoint: number } {
  const tables = plco.ptr(plco.root('ftLoadCommonData') + 4 * 4);
  const table = plco.ptr(tables + 4 * kind);
  const p2j = plco.ptr(table + 4);
  const parts = Array.from({ length: PART_COUNT }, (_, i) => plco.u8(p2j + i));
  const x8 = a.ptr(ftDataRoot(a) + 8);
  return { parts, shieldJoint: a.u8(x8 + 0x11), itemJoint: a.u8(x8 + 0x10) };
}

/** A hurtbox (ftHurtboxInit, ftData +0x30 → {count, inits}): a capsule between two points on a joint. */
export interface HurtboxDef { bone: number; height: number; grabbable: boolean; a: [number, number, number]; b: [number, number, number]; radius: number }

export function readHurtboxes(a: Archive): HurtboxDef[] {
  const list = a.ptr(ftDataRoot(a) + 0x30);
  const count = a.u32(list), inits = a.ptr(list + 4);
  const v = (o: number): [number, number, number] => [tidy(a.f32(o)), tidy(a.f32(o + 4)), tidy(a.f32(o + 8))];
  return Array.from({ length: count }, (_, i) => {
    const o = inits + 0x28 * i;
    return { bone: a.u32(o), height: a.u32(o + 4), grabbable: a.u32(o + 8) !== 0, a: v(o + 12), b: v(o + 24), radius: tidy(a.f32(o + 36)) };
  });
}

/**
 * An item's command script (it/itanimlist.c it_803F22A8): the same control commands as a fighter's
 * (end, wait), plus hitboxes in the item layout (6 words: 7-bit bone and 13-bit damage in word 0,
 * `it_create_hitbox_4` in word 4), damage changes and hitbox removal.
 */
export type ItemCmd =
  | { op: 'wait'; n: number }
  | { op: 'hitbox'; id: number; group: number; bone: number; damage: number; size: number; offset: [number, number, number]; angle: number; kbg: number; wkb: number; bkb: number; element: number; sfxLevel: number; sfxKind: number; ground: number; air: number; fighters: number }
  | { op: 'hitbox_damage'; id: number; value: number }
  | { op: 'remove_hitbox'; id: number }
  | { op: 'clear_hitboxes' };

export function readItemScript(a: Archive, at: number): ItemCmd[] {
  const out: ItemCmd[] = [];
  const bits = (w: number, from: number, n: number) => (w >>> (32 - from - n)) & ((1 << n) - 1);
  const sbits = (w: number, from: number, n: number) => { const v = bits(w, from, n); return v >= 1 << (n - 1) ? v - (1 << n) : v; };
  for (let guard = 0; guard < 256; guard++) {
    const w = a.u32(at), op = w >>> 26;
    if (op === 0) break;
    if (op === 1) { out.push({ op: 'wait', n: bits(w, 6, 26) }); at += 4; continue; }
    if (op === 11) {
      const [w0, w1, w2, w3, w4, w5] = [0, 1, 2, 3, 4, 5].map((k) => a.u32(at + 4 * k));
      out.push({
        op: 'hitbox', id: bits(w0, 6, 3), group: bits(w0, 9, 3), bone: bits(w0, 12, 7), damage: bits(w0, 19, 13),
        size: tidy(bits(w1, 0, 16) / 256), offset: [tidy(sbits(w1, 16, 16) / 256), tidy(sbits(w2, 0, 16) / 256), tidy(sbits(w2, 16, 16) / 256)],
        angle: bits(w3, 0, 9), kbg: bits(w3, 9, 9), wkb: bits(w3, 18, 9),
        bkb: bits(w4, 0, 9), element: bits(w4, 9, 5), sfxLevel: bits(w4, 23, 3), sfxKind: bits(w4, 26, 4), ground: bits(w4, 30, 1), air: bits(w4, 31, 1),
        fighters: bits(w5, 17, 1),
      });
      at += 24;
      continue;
    }
    if (op === 12) { out.push({ op: 'hitbox_damage', id: bits(w, 6, 3), value: w & 0x1fff }); at += 4; continue; }
    if (op === 14) { out.push({ op: 'remove_hitbox', id: bits(w, 6, 26) }); at += 4; continue; }
    if (op === 15) { out.push({ op: 'clear_hitboxes' }); at += 4; continue; }
    throw new Error(`item script: unexpected command ${op} at 0x${at.toString(16)}`);
  }
  return out;
}

/**
 * Fox's blaster shot (article 0, `ftData +0x48`): FoxLaserAttr (lifetime, longest drawn length) and the
 * command scripts of its two item states (0 from the ground, 1 from the air), which set its hitboxes.
 */
export function readLaser(a: Archive): { lifetime: number; scale: number; states: ItemCmd[][] } {
  const article = a.ptr(a.ptr(ftDataRoot(a) + 0x48));
  const attr = a.ptr(article + 4), states = a.ptr(article + 0xc);
  return {
    lifetime: tidy(a.f32(attr)), scale: tidy(a.f32(attr + 4)),
    states: [0, 1].map((i) => readItemScript(a, a.ptr(states + 0x10 * i + 0xc))),
  };
}
