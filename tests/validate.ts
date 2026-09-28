// Compares the web engine with reference traces from the real game (tests/expected/*.csv, recorded by
// tests/validation/run_reference.py). Each row is the fighter as the game read its pad at `retrace`
// (i.e. the state after the previous frame) plus that pad. The game acts on a pad two frames after it
// is read (Slippi's input delay), so row R+1 = one engine step from row R with the pad of row R-2.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CharacterData } from '../src/engine/types';
import { Engine } from '../src/engine/engine';
import { World } from '../src/engine/world';
import { emptyPad } from '../src/engine/pad';
import { SegKind, type StageData } from '../src/engine/stagetypes';

export interface Row {
  retrace: number; motion: number; frame: number; x: number; y: number; vx: number; vy: number; gr: number;
  facing: number; air: number; jumps: number; buttons: number; sx: number; sy: number; l: number; r: number;
  /** Newer traces: hitlag, and player 2 (Sandbag in the scripts that ask for it). */
  hitlag?: number; p2?: { kind: number; motion: number; frame: number; x: number; y: number; vx: number; vy: number; kbx: number; kby: number; gr: number; facing: number; air: number; percent: number; hitlag: number };
}

export const INPUT_DELAY = 2;
/** Tolerances: position per the spec; velocities and frames tight enough to find the cause. */
export const TOL = { pos: 0.01, vel: 0.01, frame: 0.001 };

export function readTrace(path: string): Row[] {
  const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/).slice(1);
  return lines.map((l) => {
    const cells = l.split(',');
    const v = cells.map(Number);
    const row: Row = { retrace: v[0], motion: v[1], frame: v[2], x: v[3], y: v[4], vx: v[5], vy: v[6], gr: v[7], facing: v[8], air: v[9], jumps: v[10], buttons: v[11], sx: v[12], sy: v[13], l: v[14], r: v[15] };
    if (cells.length > 18) row.hitlag = v[18];
    if (cells.length > 19 && cells[19] !== '') {
      row.p2 = { kind: v[19], motion: v[20], frame: v[21], x: v[22], y: v[23], vx: v[24], vy: v[25], kbx: v[26], kby: v[27], gr: v[28], facing: v[29], air: v[30], percent: v[31], hitlag: v[32] };
    }
    return row;
  });
}

/** Final Destination's main floor (the game keeps grounded fighters at y = 0.0001). */
export function fdStage(): StageData {
  // float32 like the game: a double 0.0001 would sit just above a fighter integrated in float32.
  const L = Math.fround(-85.5657), R = Math.fround(85.5657), Y = Math.fround(0.0001);
  return {
    segments: [
      { kind: SegKind.Floor, x0: L, y0: Y, x1: R, y1: Y, group: 1, ledges: 3 },
      { kind: SegKind.WallLeft, x0: L, y0: Y, x1: L, y1: -40, group: 1, ledges: 0 },
      { kind: SegKind.WallRight, x0: R, y0: Y, x1: R, y1: -40, group: 1, ledges: 0 },
      { kind: SegKind.Ceiling, x0: L, y0: -40, x1: R, y1: -40, group: 1, ledges: 0 },
    ],
    blast: [-246, 246, -140, 188],
    spawn: [0, 50],
  };
}

export interface Mismatch { retrace: number; field: string; expected: number; actual: number; context: string[] }

export interface Result { name: string; frames: number; mismatches: Mismatch[] }

const f4 = (n: number) => n.toFixed(4);

/** Runs one trace from the first grounded Wait row at or after `startRetrace`. */
export function compareTrace(name: string, rows: Row[], data: CharacterData, startRetrace = 1590, maxMismatches = 1): Result {
  const s = rows.findIndex((r) => r.retrace >= startRetrace && r.motion === 14 && r.air === 0);
  const res: Result = { name, frames: 0, mismatches: [] };
  if (s < 0) { res.mismatches.push({ retrace: 0, field: 'start', expected: 14, actual: -1, context: ['no grounded Wait row to start from'] }); return res; }
  const e = new Engine(data);
  const stage = fdStage();
  e.setStage(stage);
  const r0 = rows[s];
  e.spawnGrounded(r0.x, stage.segments[0], r0.facing);
  e.fighter.pos.y = Math.fround(r0.y);
  e.fighter.animFrame = Math.fround(r0.frame);
  const pad = emptyPad();
  const log: string[] = [];
  for (let i = s; i + 1 < rows.length; i++) {
    const src = rows[i - INPUT_DELAY] ?? rows[i];
    pad.buttons = src.buttons; pad.stickX = src.sx; pad.stickY = src.sy; pad.cX = 0; pad.cY = 0; pad.trigL = src.l; pad.trigR = src.r;
    e.step(pad);
    const exp = rows[i + 1], fp = e.fighter;
    const got: Record<string, number> = { motion: fp.motionId, frame: fp.animFrame, x: fp.pos.x, y: fp.pos.y, vx: fp.selfVel.x, vy: fp.selfVel.y, gr: fp.grVel, facing: fp.facing, air: fp.ga, jumps: fp.jumpsUsed };
    log.push(`${exp.retrace} game ${exp.motion}@${f4(exp.frame)} (${f4(exp.x)},${f4(exp.y)}) v(${f4(exp.vx)},${f4(exp.vy)}) gr ${f4(exp.gr)} | web ${fp.motionName}(${fp.motionId})@${f4(fp.animFrame)} (${f4(fp.pos.x)},${f4(fp.pos.y)}) v(${f4(fp.selfVel.x)},${f4(fp.selfVel.y)}) gr ${f4(fp.grVel)}`);
    if (log.length > 8) log.shift();
    res.frames++;
    const checks: Array<[string, number, number, number]> = [
      ['motion', exp.motion, got.motion, 0], ['frame', exp.frame, got.frame, TOL.frame],
      ['x', exp.x, got.x, TOL.pos], ['y', exp.y, got.y, TOL.pos],
      ['vx', exp.vx, got.vx, TOL.vel], ['vy', exp.vy, got.vy, TOL.vel], ['gr', exp.gr, got.gr, TOL.vel],
      ['facing', exp.facing, got.facing, 0], ['air', exp.air, got.air, 0],
    ];
    for (const [field, want, have, tol] of checks) {
      if (Math.abs(want - have) > tol) {
        res.mismatches.push({ retrace: exp.retrace, field, expected: want, actual: have, context: [...log] });
        break;
      }
    }
    if (res.mismatches.length >= maxMismatches) break;
  }
  return res;
}

export function expectedTraces(dir = join('tests', 'expected')): Array<{ name: string; path: string }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.csv')).sort().map((f) => ({ name: f.slice(0, -4), path: join(dir, f) }));
}

/** Sandbag's internal kind (Ft_Kind_Sandbag) in the trace's p2_kind column. */
export const SANDBAG_KIND = 32;

export function hasSandbag(rows: Row[]): boolean {
  return rows.some((r) => r.p2?.kind === SANDBAG_KIND);
}

/**
 * Fox and Sandbag together (the scripts marked "# p2 sandbag"): both are compared every frame, Sandbag
 * also on its knockback velocity, percent and hitlag, Fox on his hitlag. `show` prints game and web
 * side by side for a range of retraces (tools/tracediff.ts).
 */
export function compareWorldTrace(name: string, rows: Row[], fox: CharacterData, sandbag: CharacterData, startRetrace = 1590, maxMismatches = 1, show: [number, number] | null = null): Result {
  const s = rows.findIndex((r) => r.retrace >= startRetrace && r.motion === 14 && r.air === 0 && r.p2?.air === 0 && (r.p2?.motion === 14));
  const res: Result = { name, frames: 0, mismatches: [] };
  if (s < 0) { res.mismatches.push({ retrace: 0, field: 'start', expected: 14, actual: -1, context: ['no row with both fighters standing to start from'] }); return res; }
  const world = new World();
  const stage = fdStage();
  const a = world.add(new Engine(fox)), b = world.add(new Engine(sandbag));
  world.setStage(stage);
  const r0 = rows[s], q0 = r0.p2!;
  a.spawnGrounded(r0.x, stage.segments[0], r0.facing);
  a.fighter.pos.y = Math.fround(r0.y);
  a.fighter.animFrame = Math.fround(r0.frame);
  b.spawnGrounded(q0.x, stage.segments[0], q0.facing);
  b.fighter.pos.y = Math.fround(q0.y);
  b.fighter.animFrame = Math.fround(q0.frame);
  const pad = emptyPad();
  const log: string[] = [];
  for (let i = s; i + 1 < rows.length; i++) {
    const src = rows[i - INPUT_DELAY] ?? rows[i];
    pad.buttons = src.buttons; pad.stickX = src.sx; pad.stickY = src.sy; pad.cX = 0; pad.cY = 0; pad.trigL = src.l; pad.trigR = src.r;
    world.step([pad]);
    const exp = rows[i + 1], q = exp.p2;
    // Off Final Destination the game's Sandbag falls forever (it can't be KO'd in VS mode); ours respawns.
    if (!q || Math.abs(q.x) > 85.5 || q.y < -10) break;
    const fp = a.fighter, sb = b.fighter;
    log.push(`${exp.retrace} game ${exp.motion}@${f4(exp.frame)} (${f4(exp.x)},${f4(exp.y)}) hl ${exp.hitlag} | sb ${q.motion}@${f4(q.frame)} (${f4(q.x)},${f4(q.y)}) kb(${f4(q.kbx)},${f4(q.kby)}) ${q.percent}% hl ${q.hitlag}`);
    log.push(`${' '.repeat(String(exp.retrace).length)}  web ${fp.motionName}(${fp.motionId})@${f4(fp.animFrame)} (${f4(fp.pos.x)},${f4(fp.pos.y)}) hl ${fp.hitlag} | sb ${sb.motionName}(${sb.motionId})@${f4(sb.animFrame)} (${f4(sb.pos.x)},${f4(sb.pos.y)}) kb(${f4(sb.kbVel.x)},${f4(sb.kbVel.y)}) ${sb.percent}% hl ${sb.hitlag}`);
    if (show && exp.retrace >= show[0] && exp.retrace <= show[1]) for (const line of log.slice(-2)) console.log(line);
    while (log.length > 12) log.shift();
    res.frames++;
    const checks: Array<[string, number, number, number]> = [
      ['motion', exp.motion, fp.motionId, 0], ['frame', exp.frame, fp.animFrame, TOL.frame],
      ['x', exp.x, fp.pos.x, TOL.pos], ['y', exp.y, fp.pos.y, TOL.pos],
      ['vx', exp.vx, fp.selfVel.x, TOL.vel], ['vy', exp.vy, fp.selfVel.y, TOL.vel], ['gr', exp.gr, fp.grVel, TOL.vel],
      ['facing', exp.facing, fp.facing, 0], ['air', exp.air, fp.ga, 0], ['hitlag', exp.hitlag ?? 0, fp.hitlag, 0],
      ['sb motion', q.motion, sb.motionId, 0], ['sb frame', q.frame, sb.animFrame, TOL.frame],
      ['sb x', q.x, sb.pos.x, TOL.pos], ['sb y', q.y, sb.pos.y, TOL.pos],
      ['sb vx', q.vx, sb.selfVel.x, TOL.vel], ['sb vy', q.vy, sb.selfVel.y, TOL.vel],
      ['sb kbx', q.kbx, sb.kbVel.x, TOL.vel], ['sb kby', q.kby, sb.kbVel.y, TOL.vel], ['sb gr', q.gr, sb.grVel, TOL.vel],
      ['sb facing', q.facing, sb.facing, 0], ['sb air', q.air, sb.ga, 0],
      ['sb percent', q.percent, sb.percent, 0.001], ['sb hitlag', q.hitlag, sb.hitlag, 0],
    ];
    for (const [field, want, have, tol] of checks) {
      if (Math.abs(want - have) > tol) {
        res.mismatches.push({ retrace: exp.retrace, field, expected: want, actual: have, context: [...log] });
        break;
      }
    }
    if (res.mismatches.length >= maxMismatches) break;
  }
  return res;
}
