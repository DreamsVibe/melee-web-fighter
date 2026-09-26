// Compares the web engine with reference traces from the real game (tests/expected/*.csv, recorded by
// tests/validation/run_reference.py). Each row is the fighter as the game read its pad at `retrace`
// (i.e. the state after the previous frame) plus that pad. The game acts on a pad two frames after it
// is read (Slippi's input delay), so row R+1 = one engine step from row R with the pad of row R-2.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CharacterData } from '../src/engine/types';
import { Engine } from '../src/engine/engine';
import { emptyPad } from '../src/engine/pad';
import { SegKind, type StageData } from '../src/engine/stagetypes';

export interface Row {
  retrace: number; motion: number; frame: number; x: number; y: number; vx: number; vy: number; gr: number;
  facing: number; air: number; jumps: number; buttons: number; sx: number; sy: number; l: number; r: number;
}

export const INPUT_DELAY = 2;
/** Tolerances: position per the spec; velocities and frames tight enough to find the cause. */
export const TOL = { pos: 0.01, vel: 0.01, frame: 0.001 };

export function readTrace(path: string): Row[] {
  const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/).slice(1);
  return lines.map((l) => {
    const v = l.split(',').map(Number);
    return { retrace: v[0], motion: v[1], frame: v[2], x: v[3], y: v[4], vx: v[5], vy: v[6], gr: v[7], facing: v[8], air: v[9], jumps: v[10], buttons: v[11], sx: v[12], sy: v[13], l: v[14], r: v[15] };
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
