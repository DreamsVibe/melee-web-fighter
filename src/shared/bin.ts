// Little-endian binary writer/reader for the character folder's compact files.

export class BinWriter {
  private buf = new Uint8Array(1024);
  private dv = new DataView(this.buf.buffer);
  pos = 0;

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf);
    this.buf = next;
    this.dv = new DataView(next.buffer);
  }
  u8(v: number): this { this.ensure(1); this.dv.setUint8(this.pos, v); this.pos += 1; return this; }
  i8(v: number): this { this.ensure(1); this.dv.setInt8(this.pos, v); this.pos += 1; return this; }
  u16(v: number): this { this.ensure(2); this.dv.setUint16(this.pos, v, true); this.pos += 2; return this; }
  i16(v: number): this { this.ensure(2); this.dv.setInt16(this.pos, v, true); this.pos += 2; return this; }
  u32(v: number): this { this.ensure(4); this.dv.setUint32(this.pos, v, true); this.pos += 4; return this; }
  i32(v: number): this { this.ensure(4); this.dv.setInt32(this.pos, v, true); this.pos += 4; return this; }
  f32(v: number): this { this.ensure(4); this.dv.setFloat32(this.pos, v, true); this.pos += 4; return this; }
  magic(s: string): this { for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i)); return this; }
  bytes(b: Uint8Array): this { this.ensure(b.length); this.buf.set(b, this.pos); this.pos += b.length; return this; }
  str(s: string): this { const b = new TextEncoder().encode(s); this.u16(b.length); return this.bytes(b); }
  align(n: number): this { while (this.pos % n) this.u8(0); return this; }
  finish(): Uint8Array { return this.buf.slice(0, this.pos); }
}

export class BinReader {
  private dv: DataView;
  pos = 0;
  constructor(readonly buf: Uint8Array) { this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); }
  u8(): number { return this.dv.getUint8(this.pos++); }
  i8(): number { return this.dv.getInt8(this.pos++); }
  u16(): number { const v = this.dv.getUint16(this.pos, true); this.pos += 2; return v; }
  i16(): number { const v = this.dv.getInt16(this.pos, true); this.pos += 2; return v; }
  u32(): number { const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
  i32(): number { const v = this.dv.getInt32(this.pos, true); this.pos += 4; return v; }
  f32(): number { const v = this.dv.getFloat32(this.pos, true); this.pos += 4; return v; }
  magic(expect: string): void {
    const s = String.fromCharCode(this.u8(), this.u8(), this.u8(), this.u8());
    if (s !== expect) throw new Error(`Expected a ${expect} file, found ${JSON.stringify(s)}`);
  }
  bytes(n: number): Uint8Array { const b = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return b; }
  str(): string { return new TextDecoder().decode(this.bytes(this.u16())); }
  align(n: number): void { while (this.pos % n) this.pos++; }
}
