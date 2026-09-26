// Collision data shared by the stage (DOM side) and the engine (pure). Units are Melee units, y up.

export const enum SegKind { Platform = 0, Floor = 1, Ceiling = 2, WallLeft = 3, WallRight = 4 }

/**
 * One collision line. Floors/platforms run left→right along a top edge; walls are vertical with
 * `x0 === x1`. WallLeft is the left face of a block (blocks movement to the right), WallRight the right
 * face. `group` identifies the page element/line so moving platforms can carry the fighter.
 */
export interface Segment {
  kind: SegKind;
  x0: number; y0: number; x1: number; y1: number;
  group: number;
  /** Ledge flags on floor segments: bit 0 = left end grabbable, bit 1 = right end. */
  ledges: number;
}

export interface StageData {
  segments: Segment[];
  /** Blast zone in Melee units: [left, right, bottom, top]. */
  blast: [number, number, number, number];
  /** Respawn point (top centre of the viewport). */
  spawn: [number, number];
}
