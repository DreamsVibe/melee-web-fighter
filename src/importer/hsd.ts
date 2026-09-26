// HSD archive (.dat) reader. Layout (see NOTES.md): 0x20 header, data block, relocation table, root
// and reference tables, string table. Offsets handed around are data-relative, as in the file.

export class HsdError extends Error {}

export class Archive {
  readonly dv: DataView;
  readonly dataSize: number;
  readonly roots = new Map<string, number>();
  /** Data offsets that hold a relocated pointer (i.e. a pointer that is really there). */
  readonly relocs = new Set<number>();
  private readonly base: number;

  constructor(readonly bytes: Uint8Array, at = 0) {
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.base = at;
    const len = this.dv.getUint32(at);
    this.dataSize = this.dv.getUint32(at + 4);
    const nReloc = this.dv.getUint32(at + 8);
    const nRoot = this.dv.getUint32(at + 12);
    const nRef = this.dv.getUint32(at + 16);
    if (len < 0x20 || at + len > bytes.length || this.dataSize > len - 0x20) throw new HsdError('Invalid HSD archive header');
    const relocTable = at + 0x20 + this.dataSize;
    for (let i = 0; i < nReloc; i++) this.relocs.add(this.dv.getUint32(relocTable + 4 * i));
    const rootTable = relocTable + 4 * nReloc;
    const strings = rootTable + 8 * (nRoot + nRef);
    for (let i = 0; i < nRoot; i++) {
      const off = this.dv.getUint32(rootTable + 8 * i);
      const nameOff = this.dv.getUint32(rootTable + 8 * i + 4);
      this.roots.set(this.cstrAbs(strings + nameOff), off);
    }
  }

  /** Total length of this archive in its containing buffer (for concatenated archives). */
  get length(): number { return this.dv.getUint32(this.base); }

  private cstrAbs(at: number): string {
    let e = at;
    while (e < this.bytes.length && this.bytes[e]) e++;
    return String.fromCharCode(...this.bytes.subarray(at, e));
  }

  private check(o: number, n: number): number {
    if (o < 0 || o + n > this.dataSize) throw new HsdError(`Archive read out of bounds at 0x${o.toString(16)}`);
    return this.base + 0x20 + o;
  }

  u8(o: number): number { return this.bytes[this.check(o, 1)]; }
  s8(o: number): number { return this.dv.getInt8(this.check(o, 1)); }
  u16(o: number): number { return this.dv.getUint16(this.check(o, 2)); }
  s16(o: number): number { return this.dv.getInt16(this.check(o, 2)); }
  u32(o: number): number { return this.dv.getUint32(this.check(o, 4)); }
  s32(o: number): number { return this.dv.getInt32(this.check(o, 4)); }
  f32(o: number): number { return this.dv.getFloat32(this.check(o, 4)); }
  /** A pointer field: 0 when null. */
  ptr(o: number): number { return this.u32(o); }
  isPtr(o: number): boolean { return this.relocs.has(o); }
  bytesAt(o: number, n: number): Uint8Array {
    const a = this.check(o, n);
    return this.bytes.subarray(a, a + n);
  }
  cstr(o: number): string { return this.cstrAbs(this.check(o, 1)); }

  root(name: string): number {
    const v = this.roots.get(name);
    if (v === undefined) throw new HsdError(`Archive has no root ${name}`);
    return v;
  }

  rootEndingWith(suffix: string): [string, number] {
    for (const [k, v] of this.roots) if (k.endsWith(suffix)) return [k, v];
    throw new HsdError(`Archive has no root *${suffix}`);
  }
}
