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
