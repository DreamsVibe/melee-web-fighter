// Fox's side special (Illusion), ported from ft/kinds/ftFox/ftfoxspecials.c. The dash itself is the
// animation's root motion; B during it cuts it short. The last four positions are kept for the
// afterimages the renderer draws; the dash also leaves an afterimage item that carries the hitbox
// (it/kinds/itfoxillusion.c, Engine.spawnAfterimage). Falco's Phantasm runs the same code.
import type { Engine } from '../engine';
import { MF } from '../engine';
import { BTN } from '../pad';
import { GA } from '../types';
import { STATES, specials, collStop, fallSpecialEnter, landingFallSpecialEnter, waitEnter, type StateDef } from '../states';
import { airRootMotion, fall, groundDeaccel, groundFriction, groundRootMotionSet, selfDeaccel, selfFromGround } from '../physics';
import { airCollision, groundCollision, EdgeMode } from '../collision';

export const FX_S = { Start: 347, Dash: 348, End: 349, AirStart: 350, AirDash: 351, AirEnd: 352 } as const;

/** ftCommon_GroundAirColl_MF: keep the frame, replay the script silently, keep the trail. */
const GROUND_AIR = MF.UpdateCmd | MF.KeepGfx | MF.KeepGhosts;
const f = Math.fround;

function groundEnter(e: Engine): void {
  const fp = e.fighter, s = e.data.special;
  fp.cmdVars[2] = 0;
  fp.mv.illusionGravityDelay = s.illusion_gravity_delay;
  fp.grVel = f(fp.grVel / s.illusion_ground_vel_div);
  e.changeMotion(FX_S.Start, MF.None, 0, 1);
  e.animStep();
}

function airEnter(e: Engine): void {
  const fp = e.fighter, s = e.data.special;
  fp.cmdVars[2] = 0;
  fp.mv.illusionGravityDelay = s.illusion_gravity_delay;
  fp.selfVel.y = 0;
  fp.selfVel.x = f(fp.selfVel.x / s.illusion_ground_vel_div);
  e.changeMotion(FX_S.AirStart, MF.None, 0, 1);
  e.animStep();
  fp.jumpsUsed = e.a.max_jumps;
}

/** ftPartGetRotX(fp, 0): TopN's X rotation in the current pose. */
function topRotX(e: Engine): number {
  e.updatePose();
  return e.fighter.local[(e.data.parts[0] ?? 0) * 9];
}

/** ftFox_SpecialS_SetVars: the trail starts at the dash's starting point. */
function dashEnter(e: Engine, msid: number): void {
  const fp = e.fighter;
  e.changeMotion(msid, MF.None, 0, 1);
  fp.ghosts.length = fp.ghostRot.length = 0;
  const rot = topRotX(e);
  for (let i = 0; i < 4; i++) { fp.ghosts.push(fp.pos.x, fp.pos.y); fp.ghostRot.push(rot); }
}

/** ftFox_SpecialS_SetPhys: shift the trail and add this frame's position and TopN rotation. */
function trail(e: Engine): void {
  const g = e.fighter.ghosts, r = e.fighter.ghostRot;
  if (g.length < 8) return;
  for (let i = 6; i >= 2; i -= 2) { g[i] = g[i - 2]; g[i + 1] = g[i - 1]; }
  g[0] = e.fighter.pos.x; g[1] = e.fighter.pos.y;
  r[3] = r[2]; r[2] = r[1]; r[1] = r[0]; r[0] = topRotX(e);
}

/**
 * ftFox_SpecialS_CreateGhostItem: when the dash's script sets var 2 to 1, the afterimage item appears
 * (Fox's Illusion, Falco's Phantasm), carrying the move's hitbox.
 */
function afterimageCheck(e: Engine): void {
  const fp = e.fighter;
  if (fp.cmdVars[2] !== 1) return;
  fp.cmdVars[2] = 0;
  e.spawnAfterimage();
}

function endEnter(e: Engine): void {
  const fp = e.fighter, s = e.data.special;
  if (fp.ga === GA.Air) {
    fp.selfVel.x = f(s.illusion_air_end_vel_x * fp.facing);
    fp.selfVel.y = 0;
    e.changeMotion(FX_S.AirEnd, MF.KeepGhosts, 0, 1);
  } else {
    fp.grVel = f(s.illusion_ground_end_vel_x * fp.facing);
    e.changeMotion(FX_S.End, MF.KeepGhosts, 0, 1);
  }
  fp.mv.illusionGravityDelay = s.illusion_end_gravity_delay;
}

/** Ground → air when running off an edge, air → ground on landing, keeping the animation frame. */
function groundToAir(e: Engine, airMsid: number): void {
  const fp = e.fighter;
  if (groundCollision(fp, e.stage, e.moveStart, EdgeMode.Fall)) return;
  const frame = fp.animFrame;
  e.toAirNoJumps();
  e.changeMotion(airMsid, GROUND_AIR, frame, 1);
  fp.cmdVars[2] = 0;
}

function airToGround(e: Engine, groundMsid: number): void {
  const fp = e.fighter;
  if (!airCollision(fp, e.stage, e.moveStart, null)) return;
  const frame = fp.animFrame;
  e.toGround();
  e.changeMotion(groundMsid, GROUND_AIR, frame, 1);
  fp.cmdVars[2] = 0;
}

const bToEnd = (e: Engine) => { if (e.fighter.input.pressed & BTN.B) endEnter(e); };

const defs: StateDef[] = [
  {
    id: FX_S.Start, name: 'SpecialSStart', move: 'SpecialSStart',
    anim(e) { if (!e.isFramesRemaining()) dashEnter(e, FX_S.Dash); },
    phys(e) { const fp = e.fighter; if (fp.mv.illusionGravityDelay) fp.mv.illusionGravityDelay--; groundFriction(fp, e.a, e.c); },
    coll(e) { groundToAir(e, FX_S.AirStart); },
  },
  {
    id: FX_S.AirStart, name: 'SpecialAirSStart', move: 'SpecialAirSStart',
    anim(e) { if (!e.isFramesRemaining()) dashEnter(e, FX_S.AirDash); },
    phys(e) {
      const fp = e.fighter, s = e.data.special;
      if (fp.mv.illusionGravityDelay) fp.mv.illusionGravityDelay--;
      else fall(fp, s.illusion_start_fall_accel, e.a.terminal_velocity);
      selfDeaccel(fp, s.illusion_start_air_friction);
    },
    coll(e) { airToGround(e, FX_S.Start); },
  },
  {
    id: FX_S.Dash, name: 'SpecialS', move: 'SpecialS',
    anim(e) { if (!e.isFramesRemaining()) endEnter(e); afterimageCheck(e); },
    iasa: bToEnd,
    phys(e) { groundRootMotionSet(e.fighter, e.a.ground_friction, e.fighter.facing); trail(e); },
    coll(e) { groundToAir(e, FX_S.AirDash); },
  },
  {
    id: FX_S.AirDash, name: 'SpecialAirS', move: 'SpecialAirS',
    anim(e) { if (!e.isFramesRemaining()) endEnter(e); afterimageCheck(e); },
    iasa: bToEnd,
    phys(e) { airRootMotion(e.fighter); trail(e); },
    coll(e) { airToGround(e, FX_S.Dash); },
  },
  {
    id: FX_S.End, name: 'SpecialSEnd', move: 'SpecialSEnd',
    anim(e) { if (!e.isFramesRemaining()) waitEnter(e); },
    phys(e) {
      const fp = e.fighter;
      if (fp.mv.illusionGravityDelay) fp.mv.illusionGravityDelay--;
      groundDeaccel(fp, e.data.special.illusion_ground_end_friction);
      selfFromGround(fp);
      trail(e);
    },
    coll: collStop,
  },
  {
    id: FX_S.AirEnd, name: 'SpecialAirSEnd', move: 'SpecialAirSEnd',
    anim(e) {
      const s = e.data.special;
      if (!e.isFramesRemaining()) fallSpecialEnter(e, 1, 0, true, s.illusion_freefall_mobility, s.illusion_landing_lag);
    },
    phys(e) {
      const fp = e.fighter, s = e.data.special;
      if (fp.mv.illusionGravityDelay) fp.mv.illusionGravityDelay--;
      else fall(fp, s.illusion_end_fall_accel, e.a.terminal_velocity);
      selfDeaccel(fp, s.illusion_air_end_friction);
      trail(e);
    },
    coll(e) {
      if (airCollision(e.fighter, e.stage, e.moveStart, null)) landingFallSpecialEnter(e, false, e.data.special.illusion_landing_lag);
    },
  },
];

let registered = false;
export function registerIllusion(): void {
  if (registered) return;
  registered = true;
  for (const d of defs) STATES.set(d.id, d);
  specials.groundS = groundEnter;
  specials.airS = airEnter;
}
