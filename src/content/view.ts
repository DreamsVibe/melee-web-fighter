// Page ↔ Melee-unit coordinates. The engine works in Melee units with y up; the page in CSS pixels
// with y down. One scale, px_per_unit, and a flip. Page coordinates are document-relative, so
// scrolling moves the camera, not the stage.

export class View {
  /** CSS pixels per Melee unit. */
  ppu = 7;

  /** Document pixel x → Melee x. */
  toUnitsX(px: number): number { return px / this.ppu; }
  /** Document pixel y → Melee y (flipped). */
  toUnitsY(py: number): number { return -py / this.ppu; }
  toPageX(u: number): number { return u * this.ppu; }
  toPageY(u: number): number { return -u * this.ppu; }

  /** The visible viewport in Melee units: [left, right, bottom, top]. */
  viewport(): [number, number, number, number] {
    const l = window.scrollX / this.ppu, t = -window.scrollY / this.ppu;
    return [l, l + window.innerWidth / this.ppu, t - window.innerHeight / this.ppu, t];
  }

  /** Viewport-relative CSS pixels of a Melee point. */
  toClient(x: number, y: number): [number, number] {
    return [this.toPageX(x) - window.scrollX, this.toPageY(y) - window.scrollY];
  }
}
