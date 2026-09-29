// Environmental collision against page segments. ECB (the collision diamond) follows the game's
// mpColl_LoadECB_JObj: bounding box of six bones relative to the fighter's position, bottom pinned
// to 0 on the ground, kept while "locked" after takeoff, sanitised by mpColl_80042384. Line tests are
// our own swept-point tests against flat page geometry, structured like mpColl_80046904 (air) and
// mpColl_8004ACE4 (ground): walls, then ceiling, then floor.
import { SegKind, type Segment, type StageData } from './stagetypes';
import { ENV, GA, type Ecb, type Fighter } from './types';

const f = Math.fround;
const EPS = 1e-4;

export const ECB_AIR = 6;     // mpColl_LoadECB(): CanGrabLedge, no expansion
export const ECB_GROUND = 5;  // mpColl_LoadECB_inline(5): bottom pinned to 0

/** mpColl_LoadECB_JObj + mpColl_80042384, from bone positions relative to the fighter. */
export function loadEcb(fp: Fighter, bones: number[], sideOffset: number, flags: number, minSize = 10): void {
  const w = fp.world;
  const d = fp.desiredEcb;
  const savedBottom = d.bottom;
  let left = 0, right = 0, bottom = 0, top = 0;
  bones.forEach((b, i) => {
    const x = w[b * 12 + 3], y = w[b * 12 + 7];
    if (i === 0) { left = right = x; bottom = top = y; return; }
    if (left > x) left = x; else if (right < x) right = x;
    if (bottom > y) bottom = y; else if (top < y) top = y;
  });
  if (!(flags & 4)) { left -= 2; right += 2; bottom -= 2; top += 2; }
  const minW = Math.max(4, minSize);
  const width = Math.abs(right - left);
  if (width < minW) { right = f(0.5 * width); left = -right; }
  const height = Math.abs(top - bottom);
  if (height < Math.max(4, minSize)) { const mid = f(0.5 * (top + bottom)); top = f(mid + 0.5 * height); bottom = f(mid - 0.5 * height); }
  if (flags & 8) { left = -1; right = 1; }
  else { if (right < 2) right = 2; if (left > -2) left = -2; }
  if (flags & 1) { bottom = 0; if (flags & 0x10) top = 2; }
  else {
    if (bottom < 0) bottom = 0;
    if (flags & 0x10) { const mid = 0.5 * (bottom + top); bottom = mid - 1; top = mid + 1; if (bottom < 0) { bottom = 0; top = 2; } }
  }
  d.top = f(top); d.bottom = f(bottom); d.right = f(right); d.left = f(left);
  d.sideY = f(sideOffset + 0.5 * (bottom + top));
  if (fp.ecbLocked) d.bottom = savedBottom;
  // mpColl_80042384
  if (Math.abs(d.top - d.bottom) < 1) { d.top = f(d.top + 1); d.sideY = f(0.5 * (d.top + d.bottom)); }
  if (d.top < 1) d.top = 1;
  if (d.left > -1) d.left = -1;
  if (d.right < 1) d.right = 1;
  if (d.top < d.bottom) d.top = f(1 + d.bottom);
  if (d.sideY > d.top || d.sideY < d.bottom) d.sideY = f(0.5 * (d.top + d.bottom));
  if (d.top - d.sideY < 0.001 || d.sideY - d.bottom < 0.001) d.sideY = f(0.5 * (d.top + d.bottom));
}

function copyEcb(dst: Ecb, src: Ecb): void { dst.top = src.top; dst.bottom = src.bottom; dst.left = src.left; dst.right = src.right; dst.sideY = src.sideY; }
function lerpEcb(e: Ecb, d: Ecb, t: number): void {
  e.top = f(e.top + t * (d.top - e.top)); e.bottom = f(e.bottom + t * (d.bottom - e.bottom));
  e.left = f(e.left + t * (d.left - e.left)); e.right = f(e.right + t * (d.right - e.right)); e.sideY = f(e.sideY + t * (d.sideY - e.sideY));
}

export type FloorAccept = (seg: Segment) => boolean;

export interface CollisionWorld { stage: StageData }

/** Is a floor segment under x (inclusive) at height y (within tolerance)? */
function floorAt(stage: StageData, x: number, y: number, prefer: Segment | null): Segment | null {
  if (prefer && x >= prefer.x0 - EPS && x <= prefer.x1 + EPS && Math.abs(prefer.y0 - y) < 0.01) return prefer;
  for (const s of stage.segments) {
    if ((s.kind === SegKind.Floor || s.kind === SegKind.Platform) && x >= s.x0 - EPS && x <= s.x1 + EPS && Math.abs(s.y0 - y) < 0.01) return s;
  }
  return null;
}

/** Walls first (ECB side points against vertical segments), shared by air and ground. */
function collideWalls(fp: Fighter, stage: StageData, px: number, py: number): void {
  const e = fp.ecb, pe = fp.prevEcb;
  for (const s of stage.segments) {
    if (s.kind === SegKind.WallLeft) {
      // Left face of a block: stops the fighter's right side moving right.
      const prevR = px + pe.right, curR = fp.pos.x + e.right, sy = fp.pos.y + e.sideY;
      if (prevR <= s.x0 + EPS && curR > s.x0 && sy <= s.y0 && sy >= s.y1) {
        fp.pos.x = f(s.x0 - e.right);
        fp.envFlags |= ENV.LeftWall;
      }
    } else if (s.kind === SegKind.WallRight) {
      const prevL = px + pe.left, curL = fp.pos.x + e.left, sy = fp.pos.y + e.sideY;
      if (prevL >= s.x0 - EPS && curL < s.x0 && sy <= s.y0 && sy >= s.y1) {
        fp.pos.x = f(s.x0 - e.left);
        fp.envFlags |= ENV.RightWall;
      }
    }
  }
  void py;
}

function collideCeiling(fp: Fighter, stage: StageData, px: number, py: number): boolean {
  const pe = fp.prevEcb, e = fp.ecb;
  for (const s of stage.segments) {
    if (s.kind !== SegKind.Ceiling) continue;
    const prevTop = py + pe.top, curTop = fp.pos.y + e.top, x = fp.pos.x;
    if (prevTop <= s.y0 + EPS && curTop > s.y0 && x > s.x0 && x < s.x1) {
      fp.pos.y = f(s.y0 - e.top);
      fp.envFlags |= ENV.Ceiling;
      return true;
    }
  }
  return false;
}

/** Downward crossing of the ECB bottom through a floor line (mpCheckFloor on the swept bottom). */
function findFloor(fp: Fighter, stage: StageData, px: number, py: number, accept: FloorAccept | null): Segment | null {
  const x0 = px + fp.prevEcb.bottom * 0, y0 = py + fp.prevEcb.bottom;
  const x1 = fp.pos.x, y1 = fp.pos.y + fp.ecb.bottom;
  let best: Segment | null = null, bestT = Infinity;
  for (const s of stage.segments) {
    if (s.kind !== SegKind.Floor && s.kind !== SegKind.Platform) continue;
    if (s === fp.floorSkip) continue;
    // A move that does not go down never lands (a fighter hovering exactly at floor height stays airborne).
    if (!(y0 >= s.y0 - EPS && y1 <= s.y0 && y1 < y0)) continue;
    const t = y0 === y1 ? 0 : (y0 - s.y0) / (y0 - y1);
    const x = x0 + (x1 - x0) * t;
    if (x < s.x0 || x > s.x1) continue;
    if (s.kind === SegKind.Platform && accept && !accept(s)) continue;
    if (t < bestT) { bestT = t; best = s; }
  }
  return best;
}

/**
 * Air collision (mpColl_800471F8 / 80047E14 family). Moves in steps of at most 6 units like
 * mpColl_80043754. Returns true when the fighter landed (position snapped onto the floor).
 */
export function airCollision(fp: Fighter, stage: StageData, lastPos: { x: number; y: number }, accept: FloorAccept | null): boolean {
  const vx = fp.pos.x - lastPos.x, vy = fp.pos.y - lastPos.y;
  const d = fp.desiredEcb;
  let span = Math.max(Math.abs(vx), Math.abs(vy), Math.abs(d.left - fp.ecb.left), Math.abs(d.right - fp.ecb.right), Math.abs(d.top - fp.ecb.top), Math.abs(d.sideY - fp.ecb.sideY));
  const steps = span > 6 ? Math.floor(span / 6) + 1 : 1;
  const sx = vx / steps, sy = vy / steps;
  fp.pos.x = lastPos.x; fp.pos.y = lastPos.y;
  fp.envFlags = 0;
  let landed = false;
  for (let i = 0; i < steps && !landed; i++) {
    copyEcb(fp.prevEcb, fp.ecb);
    lerpEcb(fp.ecb, d, 1 / (steps - i));
    const px = fp.pos.x, py = fp.pos.y;
    fp.pos.x = f(fp.pos.x + sx); fp.pos.y = f(fp.pos.y + sy);
    collideWalls(fp, stage, px, py);
    collideCeiling(fp, stage, px, py);
    const floor = findFloor(fp, stage, px, py, accept);
    if (floor) {
      // mpColl_80044838_Floor: with an unlocked ECB (bottom above the feet) the position itself goes
      // onto the floor; otherwise the ECB bottom does. Past a floor's end, snap to its end.
      fp.pos.y = f(floor.y0 - (fp.ecb.bottom > 0 ? 0 : fp.ecb.bottom));
      if (fp.pos.x < floor.x0) fp.pos.x = floor.x0;
      else if (fp.pos.x > floor.x1) fp.pos.x = floor.x1;
      fp.floor = floor;
      fp.envFlags |= ENV.Floor;
      landed = true;
    }
    span = 0;
  }
  return landed;
}

export const enum EdgeMode { Fall = 0, Teeter = 1, Stop = 2 }

/**
 * Ground collision (mpColl_8004ACE4). Returns true while the fighter stays on the ground.
 * Fall: off an edge the fighter falls (Dash, Run, KneeBend, Squat, Turn).
 * Teeter: stops at an edge when facing it and not pushing the stick hard (Wait, Walk, Landing);
 * the caller sees ENV.Edge. Stop: always stops at edges.
 */
export function groundCollision(fp: Fighter, stage: StageData, lastPos: { x: number; y: number }, mode: EdgeMode): boolean {
  copyEcb(fp.prevEcb, fp.ecb);
  copyEcb(fp.ecb, fp.desiredEcb);
  fp.envFlags = 0;
  collideWalls(fp, stage, lastPos.x, lastPos.y);
  const cur = fp.floor;
  const y = cur ? cur.y0 : fp.pos.y;
  const on = floorAt(stage, fp.pos.x, y, cur);
  if (on) {
    fp.floor = on;
    fp.pos.y = on.y0;
    return true;
  }
  if (!cur) return false;
  // Past an edge of the current floor.
  const leftEdge = fp.pos.x <= cur.x0;
  const edgeX = leftEdge ? cur.x0 : cur.x1;
  let stop = false;
  if (mode === EdgeMode.Stop) stop = true;
  else if (mode === EdgeMode.Teeter) {
    stop = leftEdge ? fp.facing === -1 && fp.input.lx > -0.75 : fp.facing === 1 && fp.input.lx < 0.75;
  }
  if (stop) {
    fp.pos.x = edgeX;
    fp.pos.y = cur.y0;
    fp.envFlags |= ENV.Edge | (leftEdge ? ENV.RightEdge : ENV.LeftEdge);
    return mode === EdgeMode.Stop;
  }
  // Walked off: air collision with the current floor skipped (it may land on something lower).
  const skip = fp.floorSkip;
  fp.floorSkip = cur;
  const landed = airCollision(fp, stage, lastPos, null);
  fp.floorSkip = skip;
  if (landed) return true;
  fp.floor = null;
  return false;
}

/**
 * mpColl_80044164 (left ledges, facing right) and mpColl_800443C4 (right ledges, facing left), with
 * mpLib_80051BA8_Floor's search: a box reaching `snap` units ahead of the ECB, around `snapY` above
 * the fighter, swept over this frame's movement, finds the nearest grabbable floor end inside it. The
 * fighter has to be past the end, with the ECB bottom below it. Page lines are flat and there are no
 * walls between the fighter and a ledge, so the game's line-of-sight checks always pass. `dir` 0
 * looks both ways (Firefox's flight).
 */
export function findLedge(fp: Fighter, stage: StageData, lastPos: { x: number; y: number }, dir: -1 | 0 | 1, snap: [number, number, number]): { seg: Segment; side: 1 | -1 } | null {
  const [snapX, snapY, height] = snap, half = 0.5 * height, e = fp.ecb;
  const bottom = Math.min(lastPos.y, fp.pos.y) + snapY - half, top = Math.max(lastPos.y, fp.pos.y) + snapY + half;
  const search = (side: 1 | -1): Segment | null => {
    const left = side === 1 ? Math.min(lastPos.x, fp.pos.x) : -snapX + Math.min(lastPos.x, fp.pos.x) + e.left;
    const right = side === 1 ? snapX + Math.max(lastPos.x, fp.pos.x) + e.right : Math.max(lastPos.x, fp.pos.x);
    let best: Segment | null = null;
    for (const s of stage.segments) {
      if (s.kind !== SegKind.Floor && s.kind !== SegKind.Platform) continue;
      if (!(s.ledges & (side === 1 ? 1 : 2)) || s === fp.floorSkip) continue;
      // The line and the box overlap on both axes (a flat line: its height strictly inside the box).
      if (!(Math.abs(s.x0 + s.x1 - (right + left)) < s.x1 - s.x0 + (right - left))) continue;
      if (!(Math.abs(2 * s.y0 - (top + bottom)) < top - bottom)) continue;
      if (!best || (side === 1 ? s.x0 < best.x0 : s.x1 > best.x1)) best = s;
    }
    if (!best) return null;
    const edgeX = side === 1 ? best.x0 : best.x1;
    // Off the stage past the ledge, and hanging below it.
    if (side === 1 ? !(fp.pos.x < edgeX) : !(fp.pos.x > edgeX)) return null;
    return fp.pos.y + e.bottom < best.y0 ? best : null;
  };
  if (dir >= 0) { const s = search(1); if (s) return { seg: s, side: 1 }; }
  if (dir <= 0) { const s = search(-1); if (s) return { seg: s, side: -1 }; }
  return null;
}

/** A ledge's corner: the left end of its floor for a left ledge, the right end for a right one. */
export function ledgePoint(ledge: { seg: Segment; side: 1 | -1 }): [number, number] {
  return ledge.side === 1 ? [ledge.seg.x0, ledge.seg.y0] : [ledge.seg.x1, ledge.seg.y1];
}

export function isOnPlatform(fp: Fighter): boolean {
  return fp.ga === GA.Ground && !!fp.floor && fp.floor.kind === SegKind.Platform;
}
