// attributes.json (Fox) and common.json (PlCo.dat constants), with readable float values.
import { Archive } from './hsd';
import { ftDataRoot } from './actions';
import { ATTRIBUTE_FIELDS, COMMON_FIELDS, FOX_SPECIAL_FIELDS, readFields, type NamedValues } from '../shared/attributes';

/** Shortest decimal that reads back as the same 32-bit float. */
export function tidy(v: number): number {
  for (let d = 1; d <= 9; d++) {
    const t = Number(v.toPrecision(d));
    if (Math.fround(t) === Math.fround(v)) return t;
  }
  return v;
}
const tidyAll = (o: NamedValues) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, tidy(v)]));

export function readAttributes(plfx: Archive): { attributes: NamedValues; special: NamedValues } {
  const root = ftDataRoot(plfx);
  return {
    attributes: tidyAll(readFields(plfx, plfx.ptr(root), ATTRIBUTE_FIELDS)),
    special: tidyAll(readFields(plfx, plfx.ptr(root + 4), FOX_SPECIAL_FIELDS)),
  };
}

export function readCommon(plco: Archive): NamedValues {
  const root = plco.root('ftLoadCommonData');
  return tidyAll(readFields(plco, plco.ptr(root), COMMON_FIELDS));
}

/** Ft_Kind_Fox: index into PlCo.dat's per-character tables. */
const FOX_KIND = 1;
/** Fighter_Part enum up to TransN2 (ft/forward.h). */
const PART_COUNT = 53;

/**
 * Data the engine needs besides attributes: Fox's part → joint table (ftPartsTable in PlCo.dat,
 * ftLoadCommonData[4]), the shield and item-hold joints (ftData +0x8 → +0x11/+0x10) and the blaster
 * shot's lifetime and drawn size (article 0, FoxLaserAttr +0, +4).
 */
export function readExtras(plfx: Archive, plco: Archive): { parts: number[]; shieldJoint: number; itemJoint: number; laserLifetime: number; laserScale: number } {
  const tables = plco.ptr(plco.root('ftLoadCommonData') + 4 * 4);
  const fox = plco.ptr(tables + 4 * FOX_KIND);
  const p2j = plco.ptr(fox + 4);
  const parts = Array.from({ length: PART_COUNT }, (_, i) => plco.u8(p2j + i));
  const root = ftDataRoot(plfx);
  const x8 = plfx.ptr(root + 8);
  const articles = plfx.ptr(root + 0x48);
  const laser = plfx.ptr(articles);
  return { parts, shieldJoint: plfx.u8(x8 + 0x11), itemJoint: plfx.u8(x8 + 0x10), laserLifetime: tidy(plfx.f32(plfx.ptr(laser + 4))), laserScale: tidy(plfx.f32(plfx.ptr(laser + 4) + 4)) };
}
