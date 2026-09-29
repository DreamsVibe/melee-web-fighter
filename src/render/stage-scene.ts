import type { StageFile } from '../shared/stages';

/** Battlefield's VS background: random 40–60 second holds, transition animation, then a fade. */
export class StageScene {
  frame = 0;
  current = 0;
  previous = -1;
  private currentStart = 0;
  private previousStart = 0;
  private transitionStart = -1;
  private fadeStart = -1;
  private wait: number;
  constructor(readonly spec: NonNullable<StageFile['background']>, private transitionFrames: number,
    private random = Math.random) { this.wait = this.nextWait(); }
  private nextWait(): number { return this.spec.waitMin + Math.floor(this.random() * this.spec.waitRange); }
  step(): void {
    this.frame++;
    if (this.transitionStart < 0) {
      if (--this.wait <= 0) this.transitionStart = this.frame;
    } else if (this.fadeStart < 0 && this.frame - this.transitionStart >= this.transitionFrames) {
      this.previous = this.current;
      this.previousStart = this.currentStart;
      this.current = (this.current + 1 + Math.floor(this.random() * (this.spec.scenes.length - 1))) % this.spec.scenes.length;
      this.currentStart = this.frame;
      this.fadeStart = this.frame;
    } else if (this.fadeStart >= 0 && this.frame - this.fadeStart >= this.spec.fadeFrames) {
      this.previous = -1;
      this.transitionStart = this.fadeStart = -1;
      this.wait = this.nextWait();
    }
  }
  layers(): Array<{ dir: string; frame: number; alpha: number }> {
    const fade = this.fadeStart < 0 ? 1 : (this.frame - this.fadeStart) / this.spec.fadeFrames;
    const layers = [];
    if (this.previous >= 0) layers.push({ dir: this.spec.scenes[this.previous], frame: this.frame - this.previousStart, alpha: 1 - fade });
    layers.push({ dir: this.spec.scenes[this.current], frame: this.frame - this.currentStart, alpha: fade });
    if (this.transitionStart >= 0) layers.push({ dir: this.spec.transition, frame: this.frame - this.transitionStart, alpha: 1 });
    return layers;
  }
}
