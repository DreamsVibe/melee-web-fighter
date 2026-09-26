// PadState: what every input source (adapter, gamepad, keyboard) produces, in the GameCube's own
// terms, and the HSD library's processing that turns it into the floats the game reads
// (sysdolphin/baselib/controller.c HSD_PadClamp/HSD_PadScale with Melee's settings from
// gm/gmmain.c: stick clamp radius 80, scale 80; triggers 0..140, scale 140).

export const BTN = {
  DLEFT: 0x0001, DRIGHT: 0x0002, DDOWN: 0x0004, DUP: 0x0008, Z: 0x0010, R: 0x0020, L: 0x0040,
  A: 0x0100, B: 0x0200, X: 0x0400, Y: 0x0800, START: 0x1000,
} as const;

/** Raw pad: buttons plus stick/c-stick as signed offsets from neutral, triggers 0..255. */
export interface PadState {
  buttons: number;
  stickX: number; stickY: number;
  cX: number; cY: number;
  trigL: number; trigR: number;
}

export const emptyPad = (): PadState => ({ buttons: 0, stickX: 0, stickY: 0, cX: 0, cY: 0, trigL: 0, trigR: 0 });

/** The game's view of a pad after HSD clamp and scale (HSD_PadGameStatus nml_* fields). */
export interface PadFloats {
  buttons: number;
  stickX: number; stickY: number;
  cX: number; cY: number;
  analogL: number; analogR: number;
}

const f32 = Math.fround;
const CLAMP_MIN = 0, CLAMP_MAX = 80, SCALE = 80;
const LR_MIN = 0, LR_MAX = 140, LR_SCALE = 140;

/** HSD_PadClampCheck3 on an s8 pair (with shift = 1). Returns clamped s8 values. */
function clampStick(x: number, y: number): [number, number] {
  x = Math.max(-128, Math.min(127, Math.trunc(x)));
  y = Math.max(-128, Math.min(127, Math.trunc(y)));
  let r = f32(Math.sqrt(f32(f32(x * x) + f32(y * y))));
  if (r < CLAMP_MIN) return [0, 0];
  if (r > CLAMP_MAX) {
    x = Math.trunc(f32(f32(x * CLAMP_MAX) / r));
    y = Math.trunc(f32(f32(y * CLAMP_MAX) / r));
    r = f32(Math.sqrt(f32(f32(x * x) + f32(y * y))));
  }
  if (r > 1.000000013351432e-10) {
    x = Math.trunc(f32(x - f32(f32(x * CLAMP_MIN) / r)));
    y = Math.trunc(f32(y - f32(f32(y * CLAMP_MIN) / r)));
  }
  return [x, y];
}

function clampTrigger(v: number): number {
  v = Math.max(0, Math.min(255, Math.trunc(v)));
  if (v < LR_MIN) return 0;
  if (v > LR_MAX) v = LR_MAX;
  return v - LR_MIN;
}

export function padToFloats(p: PadState, out: PadFloats): PadFloats {
  const [sx, sy] = clampStick(p.stickX, p.stickY);
  const [cx, cy] = clampStick(p.cX, p.cY);
  out.buttons = p.buttons;
  out.stickX = f32(sx / SCALE); out.stickY = f32(sy / SCALE);
  out.cX = f32(cx / SCALE); out.cY = f32(cy / SCALE);
  out.analogL = f32(clampTrigger(p.trigL) / LR_SCALE);
  out.analogR = f32(clampTrigger(p.trigR) / LR_SCALE);
  return out;
}

export const emptyFloats = (): PadFloats => ({ buttons: 0, stickX: 0, stickY: 0, cX: 0, cY: 0, analogL: 0, analogR: 0 });

/**
 * Decodes one port of a WUP-028 report (37 bytes, 0x21 then 9 bytes per port), subtracting the
 * neutral point recorded when the controller connected (melee-unlocked gc_adapter.cpp).
 */
export class AdapterDecoder {
  private origin: Array<number[] | null> = [null, null, null, null];

  decode(report: Uint8Array, port: number, out: PadState): boolean {
    const c = 1 + port * 9;
    if (report.length < 37 || report[0] !== 0x21) return false;
    if (!(report[c] & 0x30)) { this.origin[port] = null; return false; }
    const o = this.origin[port] ??= [report[c + 3], report[c + 4], report[c + 5], report[c + 6], report[c + 7], report[c + 8]];
    const b1 = report[c + 1], b2 = report[c + 2];
    let b = 0;
    if (b1 & 0x01) b |= BTN.A; if (b1 & 0x02) b |= BTN.B; if (b1 & 0x04) b |= BTN.X; if (b1 & 0x08) b |= BTN.Y;
    if (b1 & 0x10) b |= BTN.DLEFT; if (b1 & 0x20) b |= BTN.DRIGHT; if (b1 & 0x40) b |= BTN.DDOWN; if (b1 & 0x80) b |= BTN.DUP;
    if (b2 & 0x01) b |= BTN.START; if (b2 & 0x02) b |= BTN.Z; if (b2 & 0x04) b |= BTN.R; if (b2 & 0x08) b |= BTN.L;
    const axis = (v: number, n: number) => Math.max(-128, Math.min(127, v - n));
    out.buttons = b;
    out.stickX = axis(report[c + 3], o[0]); out.stickY = axis(report[c + 4], o[1]);
    out.cX = axis(report[c + 5], o[2]); out.cY = axis(report[c + 6], o[3]);
    out.trigL = Math.max(0, report[c + 7] - o[4]);
    out.trigR = Math.max(0, report[c + 8] - o[5]);
    return true;
  }
}
