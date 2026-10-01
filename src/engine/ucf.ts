// UCF 0.84, translated from project-slippi/slippi-ssbm-asm/External/UCF 0.84/UCF.
// Raw signed pad history is deliberately separate from deadzones/cardinal snapping.
import type { Fighter } from './types';
import type { PadFloats, PadState } from './pad';

const f = Math.fround;
const raw = (n: number) => Math.max(-128, Math.min(127, Math.trunc(n)));

/** UCF restores integer magnitudes with a small downward bias and two units of tolerance. */
export function atStickRim(x: number, y: number): boolean {
  const ix = Math.trunc(Math.abs(x) * 80 - 0.0001) + 2;
  const iy = Math.trunc(Math.abs(y) * 80 - 0.0001) + 2;
  return ix * ix + iy * iy > 6400;
}

export class Ucf {
  enabled = true;
  private history = Array.from({ length: 3 }, () => [0, 0]);
  highDropFrames = 0;

  /** Pad Buffer + 1.0 Cardinals: only raw cardinals >=80 with the other axis within ±6. */
  cardinals(p: PadState, out: PadFloats): void {
    if (!this.enabled) return;
    const snap = (x: number, y: number): [number, number] | null => {
      x = raw(x); y = raw(y);
      if (Math.abs(x) >= 80 && Math.abs(y) <= 6) return [Math.sign(x), 0];
      if (Math.abs(y) >= 80 && Math.abs(x) <= 6) return [0, Math.sign(y)];
      return null;
    };
    const main = snap(p.stickX, p.stickY), c = snap(p.cX, p.cY);
    if (main) [out.stickX, out.stickY] = main;
    if (c) [out.cX, out.cY] = c;
  }

  record(p: PadState): void {
    this.history.pop(); this.history.unshift([raw(p.stickX), raw(p.stickY)]);
  }

  delta(axis: number): number { return this.history[0][axis] - this.history[2][axis]; }
  fastX(): boolean { return this.enabled && this.delta(0) ** 2 > 5625; }

  /** Extended drop needs fast downward intent, then two consecutive frames on a high notch. */
  afterInput(fp: Fighter): void {
    if (!this.enabled || fp.input.ly > f(-0.609375) || !atStickRim(fp.input.lx, fp.input.ly)) {
      this.highDropFrames = 0;
    } else if (this.highDropFrames || (fp.timers.lyTimer <= 1 && this.delta(1) ** 2 > 1936)) {
      this.highDropFrames = (this.highDropFrames + 1) & 0xff;
    }
  }

  /** First-frame hit resets active timers; sticky timers retain fast input intent. */
  sdi(fp: Fighter, min: number, shield: boolean): boolean {
    if (!this.enabled || fp.timers.lxSticky > 1 && (shield || fp.timers.lySticky > 1)) return false;
    if (shield) {
      // The original patch compares previous X directly (including negative X).
      return fp.input.plx < min && this.delta(0) ** 2 > 3844;
    }
    return f(f(fp.input.plx * fp.input.plx) + f(fp.input.ply * fp.input.ply)) < f(min * min)
      && this.delta(0) ** 2 + this.delta(1) ** 2 > 3844;
  }
}
