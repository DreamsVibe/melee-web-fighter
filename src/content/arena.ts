// Where the fight happens. A PageArena is the web page itself: every text line, image and box a
// platform, the page's scroll the camera. A StageArena is one of Melee's stages from the disc, on the
// extension's stage page: its collision, spawn points and blast zones, its model, and a camera that
// follows the fighters.
import { View, type ViewLike } from './view';
import { PageStage } from './stage';
import { SegKind, type StageData } from '../engine/stagetypes';
import type { Fighter } from '../engine/types';
import type { Settings } from '../shared/settings';
import type { StageFile } from '../shared/stages';
import { loadModelDir, type FileMap } from '../shared/character';
import { FighterRenderer } from '../render/fighter';
import { restPose, worldMatrices } from '../render/pose';
import { lookAt, multiply, ortho, perspective, placement } from '../render/mat4';
import { stageDir } from '../shared/stages';

export interface Arena {
  readonly view: ViewLike;
  readonly data: StageData;
  /** Ready to play (a page after its first scan). */
  readonly ready: boolean;
  /** What the overlay is cleared to: transparent over a page, the stage's backdrop colour. */
  readonly clearColor: [number, number, number, number];
  /** Once per engine step, before the fighters move. */
  update(fighters: Fighter[]): void;
  /** Where the player appears first and after a KO; where Sandbag does, given the player. */
  playerSpawn(): [number, number, number];
  playerRespawn(): [number, number];
  sandbagSpawn(player: Fighter): [number, number, number];
  sandbagRespawn(player: Fighter): [number, number];
  /** Sandbag's own KO bounds, or null for the stage's blast zones. */
  sandbagBounds(): [number, number, number, number] | null;
  /** The view-projection matrix for this frame. */
  projection(out: Float32Array): void;
  /** Draws what's behind the fighters. */
  drawBackground(viewProj: Float32Array): void;
  applySettings(s: Settings, fighterHeight: number): void;
  /** A line for the debug overlay. */
  stats(): string;
  destroy(): void;
}

/** How far from the player (Melee units) Sandbag appears on a page, and how far off screen it may go. */
const SANDBAG_GAP = 22;
const SANDBAG_OFFSCREEN = 12;
/**
 * Spawn spots on a page: a platform at least this far below the top of the screen (room for a fighter
 * to stand in view, and below fixed headers), and this far in from the sides.
 */
const SPAWN_HEADROOM = 22;
const SPAWN_SIDE = 8;
/** Sandbag comes back at least this far from the player. */
const RESPAWN_AWAY = 40;

export class PageArena implements Arena {
  readonly view = new View();
  readonly clearColor: [number, number, number, number] = [0, 0, 0, 0];
  private stage: PageStage;

  constructor(settings: Settings, overlayCanvas: HTMLCanvasElement) {
    this.stage = new PageStage(this.view, { minSolidPx: settings.minSolidPx, minSegmentPx: settings.minSegmentPx, maxSegments: settings.maxSegments });
    this.stage.ignore.add(overlayCanvas);
    this.stage.update();
  }

  get data(): StageData { return this.stage.data; }
  get ready(): boolean { return this.stage.ready; }

  update(): void { this.stage.update(); }

  /**
   * A place to appear that's in view: on top of a platform on screen, with room above it (so not on a
   * fixed header or the top of the page), as near `preferX` as possible and otherwise high up. The
   * point is just above the platform, so the fighter drops onto it. Null when the screen has none.
   */
  private visibleSpot(preferX: number): [number, number] | null {
    const [l, r, b, t] = this.view.viewport();
    let best: [number, number] | null = null, bestScore = Infinity;
    for (const s of this.stage.data.segments) {
      if ((s.kind !== SegKind.Platform && s.kind !== SegKind.Floor) || s.y0 !== s.y1) continue;
      if (s.y0 > t - SPAWN_HEADROOM || s.y0 < b + 2) continue;
      const lo = Math.max(s.x0, l + SPAWN_SIDE) + 3, hi = Math.min(s.x1, r - SPAWN_SIDE) - 3;
      if (hi < lo) continue;
      const x = Math.min(hi, Math.max(lo, preferX));
      const score = Math.abs(x - preferX) + 0.3 * (t - s.y0);
      if (score < bestScore) { bestScore = score; best = [x, s.y0 + 0.5]; }
    }
    return best;
  }

  /** A platform in view near the top middle of the screen. */
  playerSpawn(): [number, number, number] {
    const [l, r, , t] = this.view.viewport();
    const [x, y] = this.visibleSpot((l + r) / 2) ?? [(l + r) / 2, t - 4];
    return [x, y, 1];
  }

  /** After a KO: a platform in view near the middle of the screen. */
  playerRespawn(): [number, number] {
    const [l, r] = this.view.viewport();
    return this.visibleSpot((l + r) / 2) ?? this.stage.data.spawn;
  }

  /** Beside the player (on the side with more room), facing them. */
  sandbagSpawn(fp: Fighter): [number, number, number] {
    const [l, r] = this.view.viewport();
    let side = fp.facing;
    if (fp.pos.x + side * SANDBAG_GAP > r - SPAWN_SIDE || fp.pos.x + side * SANDBAG_GAP < l + SPAWN_SIDE) side = -side;
    const [x, y] = this.visibleSpot(fp.pos.x + side * SANDBAG_GAP) ?? [fp.pos.x + side * SANDBAG_GAP, fp.pos.y + 0.5];
    return [x, y, x > fp.pos.x ? -1 : 1];
  }

  /**
   * Near the middle of the screen, not at the player: if they're standing there, to one side of them,
   * so the fight can move around the page.
   */
  sandbagRespawn(fp: Fighter): [number, number] {
    const [l, r, , t] = this.view.viewport(), mid = (l + r) / 2, fx = fp.pos.x;
    const preferX = Math.abs(mid - fx) >= RESPAWN_AWAY ? mid : fx < mid ? fx + RESPAWN_AWAY : fx - RESPAWN_AWAY;
    return this.visibleSpot(preferX) ?? [mid, t - 4];
  }

  /** Off the screen on any side: back at 0%. */
  sandbagBounds(): [number, number, number, number] {
    const [l, r, b, t] = this.view.viewport(), m = SANDBAG_OFFSCREEN;
    return [l - m, r + m, b - m, t + m];
  }

  projection(out: Float32Array): void {
    const [l, r, b, t] = this.view.viewport();
    ortho(out, l, r, b, t, -100, 100);
  }

  drawBackground(): void { /* the page itself */ }

  applySettings(s: Settings, fighterHeight: number): void {
    this.view.ppu = s.fighterHeightPx / fighterHeight;
    this.stage.opts = { minSolidPx: s.minSolidPx, minSegmentPx: s.minSegmentPx, maxSegments: s.maxSegments };
    this.stage.invalidate(0);
  }

  stats(): string {
    return `stage ${this.stage.data.segments.length} segs, scan ${this.stage.lastBuildMs.toFixed(1)} ms/frame, last rebuild ${this.stage.lastScanTotalMs.toFixed(2)} ms`;
  }

  destroy(): void { this.stage.destroy(); }
}

/**
 * A camera looking straight at the stage's plane (z = 0) from in front, in perspective: the fighting
 * plane maps linearly to the screen (one px_per_unit), while the stage's backgrounds get their depth.
 */
class CameraView implements ViewLike {
  ppu = 1;
  cx = 0;
  cy = 0;
  /** Half the visible height of the plane z = 0, in Melee units. */
  halfH = 60;
  private l = 0; private r = 0; private b = 0; private t = 0;

  set(cx: number, cy: number, halfH: number): void {
    this.cx = cx; this.cy = cy; this.halfH = halfH;
    this.ppu = window.innerHeight / (2 * halfH);
    const halfW = window.innerWidth / 2 / this.ppu;
    this.l = cx - halfW; this.r = cx + halfW; this.b = cy - halfH; this.t = cy + halfH;
  }

  viewport(): [number, number, number, number] { return [this.l, this.r, this.b, this.t]; }
  toClient(x: number, y: number): [number, number] { return [(x - this.l) * this.ppu, (this.t - y) * this.ppu]; }
}

/** The camera's vertical field of view. */
const FOV = 30 * Math.PI / 180;
/** Room kept around the fighters, the least the camera shows, and how quickly it follows. */
const CAMERA_MARGIN_X = 45, CAMERA_MARGIN_TOP = 35, CAMERA_MARGIN_BOTTOM = 25;
const CAMERA_MIN_HALF_H = 55;
const CAMERA_EASE = 0.08;

export class StageArena implements Arena {
  readonly view = new CameraView();
  readonly data: StageData;
  readonly ready = true;
  readonly clearColor: [number, number, number, number] = [0.02, 0.02, 0.06, 1];
  private parts: Array<{ renderer: FighterRenderer; world: Float32Array }> = [];
  private place = placement(new Float32Array(16), 0, 0, 0, 0, 1);
  private viewM = new Float32Array(16);
  private projM = new Float32Array(16);
  private started = false;

  constructor(readonly file: StageFile, data: StageData, files: FileMap, gl: WebGL2RenderingContext) {
    this.data = data;
    // Stage parts stand still for now: their rest pose, placed at the origin.
    for (const dir of file.models) {
      const model = loadModelDir(files, stageDir(file.id) + dir);
      const world = new Float32Array(model.joints.length * 12);
      worldMatrices(model.joints, restPose(model.joints), world, new Float32Array(model.joints.length * 3));
      this.parts.push({ renderer: new FighterRenderer(gl, model), world });
    }
    const [l, r, b, t] = file.camera;
    this.view.set((l + r) / 2, (b + t) / 2 * 0.5, CAMERA_MIN_HALF_H);
  }

  /** Follows the fighters: frames them with some room, never tighter than a minimum, inside the stage's camera range. */
  update(fighters: Fighter[]): void {
    if (!fighters.length) return;
    let l = Infinity, r = -Infinity, b = Infinity, t = -Infinity;
    for (const fp of fighters) {
      l = Math.min(l, fp.pos.x); r = Math.max(r, fp.pos.x);
      b = Math.min(b, fp.pos.y); t = Math.max(t, fp.pos.y + 15);
    }
    const [cl, cr, cb, ct] = this.file.camera;
    l = Math.max(l - CAMERA_MARGIN_X, cl); r = Math.min(r + CAMERA_MARGIN_X, cr);
    b = Math.max(b - CAMERA_MARGIN_BOTTOM, cb); t = Math.min(t + CAMERA_MARGIN_TOP, ct);
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const halfH = Math.max(CAMERA_MIN_HALF_H, (t - b) / 2, (r - l) / 2 / aspect);
    let cx = (l + r) / 2, cy = (b + t) / 2;
    // Keep the centre where the stage's camera may look.
    cx = Math.min(cr, Math.max(cl, cx)); cy = Math.min(ct, Math.max(cb, cy));
    const v = this.view;
    if (!this.started) { this.started = true; v.set(cx, cy, halfH); return; }
    v.set(v.cx + (cx - v.cx) * CAMERA_EASE, v.cy + (cy - v.cy) * CAMERA_EASE, v.halfH + (halfH - v.halfH) * CAMERA_EASE);
  }

  playerSpawn(): [number, number, number] {
    const [x, y] = this.file.spawns[0] ?? this.data.spawn;
    return [x, y, x <= 0 ? 1 : -1];
  }

  playerRespawn(): [number, number] { return this.file.respawns[0] ?? this.data.spawn; }

  sandbagSpawn(): [number, number, number] {
    const [x, y] = this.file.spawns[1] ?? this.data.spawn;
    return [x, y, x <= 0 ? 1 : -1];
  }

  sandbagRespawn(): [number, number] { return this.file.respawns[1] ?? this.data.spawn; }

  sandbagBounds(): null { return null; }

  projection(out: Float32Array): void {
    const v = this.view, d = v.halfH / Math.tan(FOV / 2);
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    perspective(this.projM, FOV, aspect, 5, d + 60000);
    lookAt(this.viewM, v.cx, v.cy, d, v.cx, v.cy, 0);
    multiply(out, this.projM, this.viewM);
  }

  drawBackground(viewProj: Float32Array): void {
    for (const p of this.parts) p.renderer.draw(p.world, this.place, viewProj);
  }

  applySettings(): void { /* the camera sets the scale */ }

  stats(): string {
    return `${this.file.name}: ${this.data.segments.length} lines, camera (${this.view.cx.toFixed(0)}, ${this.view.cy.toFixed(0)}) ±${this.view.halfH.toFixed(0)}`;
  }

  destroy(): void { /* its GL resources go with the context */ }
}
