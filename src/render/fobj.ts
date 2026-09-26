// FObj keyframe interpreter, ported from the decomp's sysdolphin/baselib/fobj.c and spline.c the same
// way melee-unlocked's tools/generate_fobj_host.py adapts them: the original state machine and Hermite
// expression, bounded reads, and a local result instead of guest callbacks. `sampleTrack` does what
// HSD_FObjReqAnim(frame) + HSD_FObjInterpretAnim(rate 0) does: seek to a frame and report the value.

export interface Track {
  channel: number;
  valueFormat: number;
  slopeFormat: number;
  startFrame: number;
  bytes: Uint8Array;
}

const OP_CON = 1, OP_LIN = 2, OP_SPL0 = 3, OP_SPL = 4, OP_SLP = 5, OP_KEY = 6;

const f32 = Math.fround;

function splGetHelmite(fterm: number, time: number, p0: number, p1: number, d0: number, d1: number): number {
  const _1_T2 = f32(time * time);
  const t2 = f32(fterm * fterm);
  const t2_T = f32(_1_T2 * fterm);
  const t3_T2 = f32(t2 * f32(_1_T2 * time));
  const _2t3_T3 = f32(f32(2 * t3_T2) * fterm);
  const _3t2_T2 = f32(f32(3 * _1_T2) * t2);
  return f32(f32(d1 * f32(t3_T2 - t2_T)) + f32(f32(d0 * f32(time + f32(f32(t3_T2 - t2_T) - t2_T))) +
    f32(f32(p0 * f32(1 + f32(_2t3_T3 - _3t2_T2))) + f32(p1 * f32(-_2t3_T3 + _3t2_T2)))));
}

/** One FObj's interpreter state (a class so sampling allocates nothing after warm-up). */
class FObj {
  bytes: Uint8Array = new Uint8Array(0);
  ad = 0;
  flags = 0;
  state = 0;
  op = 0;
  opIntrp = 0;
  fracValue = 0;
  fracSlope = 0;
  nbPack = 0;
  fterm = 0;
  time = 0;
  p0 = 0; p1 = 0; d0 = 0; d1 = 0;
  value = 0;
  sampled = false;

  private byte(): number {
    if (this.ad >= this.bytes.length) throw new Error('truncated animation track');
    return this.bytes[this.ad++];
  }

  private parseFloat(frac: number): number {
    if (frac === 0) {
      const b0 = this.byte(), b1 = this.byte(), b2 = this.byte(), b3 = this.byte();
      FObj.dv.setUint32(0, (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0, true);
      return FObj.dv.getFloat32(0, true);
    }
    const kind = frac & 0xe0;
    let v: number;
    if (kind === 0x60) { v = this.byte(); if (v >= 128) v -= 256; }              // S8
    else if (kind === 0x80) v = this.byte();                                      // U8
    else if (kind === 0x20) { v = this.byte() | (this.byte() << 8); if (v >= 32768) v -= 65536; } // S16
    else if (kind === 0x40) v = this.byte() | (this.byte() << 8);                 // U16
    else throw new Error('unsupported track value format');
    return f32(v / (1 << (frac & 0x1f)));
  }
  static dv = new DataView(new ArrayBuffer(4));

  private parsePackInfo(): number {
    let d = this.byte();
    let n = ((d >> 4) & 7) + 1;
    if (!(d & 0x80)) return n;
    let shift = 3;
    do { d = this.byte(); n += (d & 0x7f) << shift; shift += 7; } while (d & 0x80);
    return n;
  }

  private parseWait(): number {
    let wait = 0, shift = 0, d: number;
    do { d = this.byte(); wait |= (d & 0x7f) << shift; shift += 7; } while (d & 0x80);
    return wait;
  }

  private launchKeyData(): void {
    if (this.flags & 0x40) { this.opIntrp = this.op; this.flags &= ~0x40; this.flags |= 0x80; this.p0 = this.p1; }
  }

  private loadWait(): number {
    if (this.ad >= this.bytes.length) return 6;
    this.fterm = this.parseWait();
    this.flags |= 0x20;
    return (this.state = 2);
  }

  private loadData(): number {
    if (this.ad >= this.bytes.length) return 6;
    this.opIntrp = this.op;
    if (this.nbPack === 0) {
      this.op = this.bytes[this.ad] & 0xf;
      this.nbPack = this.parsePackInfo();
    }
    this.nbPack--;
    const st = this.state;
    const next = st === 1 ? 3 : 4;
    switch (this.op) {
      case OP_CON:
      case OP_LIN:
        this.p0 = this.p1;
        this.p1 = this.parseFloat(this.fracValue);
        if (this.opIntrp !== OP_SLP) { this.d0 = this.d1; this.d1 = 0; }
        return (this.state = next);
      case OP_SPL0:
        this.p0 = this.p1; this.d0 = this.d1;
        this.p1 = this.parseFloat(this.fracValue); this.d1 = 0;
        return (this.state = next);
      case OP_SPL:
        this.p0 = this.p1;
        this.p1 = this.parseFloat(this.fracValue);
        this.d0 = this.d1;
        this.d1 = this.parseFloat(this.fracSlope);
        return (this.state = next);
      case OP_SLP:
        this.d0 = this.d1;
        this.d1 = this.parseFloat(this.fracSlope);
        return this.state;
      case OP_KEY:
        this.launchKeyData();
        this.p1 = this.parseFloat(this.fracValue);
        this.flags |= 0x40;
        return (this.state = next);
      default:
        return 0;
    }
  }

  private update(): void {
    let v: number;
    switch (this.opIntrp) {
      case OP_KEY:
        if (!(this.flags & 0x80)) return;
        v = this.p0;
        this.flags &= ~0x80;
        break;
      case OP_CON:
        v = this.time >= this.fterm ? this.p1 : this.p0;
        break;
      case OP_LIN:
        if (this.flags & 0x20) {
          this.flags &= ~0x20;
          if (this.fterm !== 0) this.d0 = f32((this.p1 - this.p0) / this.fterm);
          else { this.d0 = 0; this.p0 = this.p1; }
        }
        v = f32(f32(this.d0 * this.time) + this.p0);
        break;
      case OP_SPL0: case OP_SPL: case OP_SLP:
        v = this.fterm !== 0 ? splGetHelmite(f32(1 / this.fterm), this.time, this.p0, this.p1, this.d0, this.d1) : this.p1;
        break;
      default:
        return; // the original leaves the value undefined here; report nothing
    }
    this.value = v;
    this.sampled = true;
  }

  /** HSD_FObjReqAnim(frame) then HSD_FObjInterpretAnim(rate = 0). */
  seek(t: Track, frame: number): void {
    this.bytes = t.bytes;
    this.fracValue = t.valueFormat;
    this.fracSlope = t.slopeFormat;
    this.ad = 0;
    this.time = f32(t.startFrame + frame);
    this.op = 0; this.opIntrp = 0; this.flags = 0; this.nbPack = 0; this.fterm = 0;
    this.p0 = this.p1 = this.d0 = this.d1 = 0;
    this.state = 1;
    this.sampled = false;
    let fterm = 0;
    let state = this.state;
    if (this.time < 0) return;
    for (let guard = 0; guard < 100000; guard++) {
      switch (state) {
        case 6:
          this.time = f32(this.time + fterm);
          this.launchKeyData();
          this.update();
          return;
        case 1: case 2:
          state = this.loadData();
          break;
        case 3:
          if (this.flags & 0x80) this.update();
          state = this.loadWait();
          break;
        case 4:
          if (this.fterm <= this.time) {
            state = 3;
            fterm = this.fterm;
            this.time = f32(this.time - this.fterm);
            this.state = state;
            break;
          }
          this.update();
          this.state = 5;
          return;
        case 5:
          state = this.state = 4;
          break;
        default:
          return;
      }
    }
    throw new Error('animation track does not terminate');
  }
}

const shared = new FObj();

/** Value of a track at an absolute animation frame, or undefined when the track is inactive. */
export function sampleTrack(t: Track, frame: number): number | undefined {
  shared.seek(t, frame);
  return shared.sampled ? shared.value : undefined;
}
