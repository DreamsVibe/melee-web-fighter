// Captain Falcon's specials, ported from ft/kinds/ftCaptain: Falcon Punch (ftcaptainspecialn.c), Raptor
// Boost (ftcaptainspecials.c), Falcon Dive (ftcaptainspecialhi.c) and Falcon Kick (ftcaptainspeciallw.c).
// Ganondorf runs the same code (ftCa_Init_OnLoadForGanon). The effects (efSync/efAsync spawns, the
// flame on the kick, the punch's bird) aren't modelled; neither is Falcon Dive's catch, since the
// engine has no grabs yet: the dive's grab box never connects, as with every grab.
import type { Engine } from '../engine';
import { MF } from '../engine';
import { GA, ENV } from '../types';
import {
  addStates, collStop, fallEnter, fallSpecialEnter, landFromAir, landingFallSpecialEnter, waitEnter,
  type Kit, type StateDef,
} from '../states';
import {
  airFallDeaccel, airPhysics, airRootMotion, clampAirDrift, deaccelQuick, driftSimpleNoFriction,
  groundAttackPhysics, groundDeaccel, groundFriction, groundRootMotionSet, selfFromGround,
} from '../physics';
import { airCollision, groundCollision, EdgeMode } from '../collision';
import { ledgeCatchCheck } from '../cliff';

/** ftCaptain_MotionState (341-346 are item swings). */
export const CA = {
  SpecialN: 347, SpecialAirN: 348, SpecialSStart: 349, SpecialS: 350, SpecialAirSStart: 351, SpecialAirS: 352,
  SpecialHi: 353, SpecialAirHi: 354, SpecialHiCatch: 355, SpecialHiThrow: 356,
  SpecialLw: 357, SpecialLwEnd: 358, SpecialAirLw: 359, SpecialAirLwEnd: 360, SpecialAirLwEndAir: 361,
  SpecialLwEndAir: 362, SpecialHiThrow1: 363,
} as const;

const f = Math.fround;

/**
 * The ground/air switches keep the frame and replay the script silently (transition_flags: KeepGfx,
 * UpdateCmd and flags for effects the engine doesn't have).
 */
const GROUND_AIR = MF.UpdateCmd | MF.KeepGfx;

const grounded = (e: Engine) => e.fighter.ga === GA.Ground;
/** ft_80082708: ground collision that runs off edges; false once the fighter left the ground. */
const stayOnGround = (e: Engine) => groundCollision(e.fighter, e.stage, e.moveStart, EdgeMode.Fall);
/** ft_800827A0: ground collision that stops at edges. */
const stayOnGroundStop = (e: Engine) => groundCollision(e.fighter, e.stage, e.moveStart, EdgeMode.Stop);
/** ft_80081D0C: air collision; true when the fighter landed. */
const landed = (e: Engine) => airCollision(e.fighter, e.stage, e.moveStart, null);

// ============================================================================ Falcon Punch
/** ftCaptain_SpecialN_GetAngleVel: the aerial punch's angle from the stick, in radians. */
function punchAngle(e: Engine): number {
  const s = e.data.special, ly = e.fighter.input.ly;
  const max = s.specialn_stick_range_y_pos, min = s.specialn_stick_range_y_neg;
  let y = ly < 0 ? -ly : ly;
  if (y > max) y = max;
  y = f(y - min);
  if (y < 0) y = 0;
  if (ly < 0) y = -y;
  return f(f(Math.PI / 180) * f(f(y * s.specialn_angle_diff) / f(max - min)));
}

function punchEnter(e: Engine, msid: number): void {
  const fp = e.fighter;
  fp.cmdVars[1] = 0;
  fp.cmdVars[0] = 0;
  fp.throwFlags = 0;
  e.changeMotion(msid, MF.None, 0, 1);
  e.animStep();
}

const punch: StateDef[] = [
  {
    id: CA.SpecialN, name: 'SpecialN', move: 'SpecialN',
    anim(e) { if (!e.isFramesRemaining()) waitEnter(e); },
    phys(e) { groundAttackPhysics(e.fighter, e.a, e.c); },
    coll(e) {
      if (stayOnGroundStop(e)) return;
      e.toAir();
      e.changeMotion(CA.SpecialAirN, GROUND_AIR, e.fighter.animFrame, 1);
      clampAirDrift(e.fighter, e.a);
    },
  },
  {
    id: CA.SpecialAirN, name: 'SpecialAirN', move: 'SpecialAirN',
    anim(e) { if (!e.isFramesRemaining()) fallEnter(e); },
    // ftCa_SpecialAirN_IASA: when the script says so, the punch sets off at the stick's angle.
    iasa(e) {
      const fp = e.fighter, s = e.data.special;
      if (!fp.cmdVars[0]) return;
      fp.cmdVars[0] = 0;
      const angle = punchAngle(e);
      fp.selfVel.y = f(s.specialn_vel_x * f(Math.sin(angle)));
      fp.selfVel.x = f(s.specialn_vel_x * f(fp.facing * f(Math.cos(angle))));
    },
    // The script picks the physics with var 1: fall with friction, slow down, or drift freely.
    phys(e) {
      const fp = e.fighter, s = e.data.special;
      if (fp.cmdVars[1] === 0) airFallDeaccel(fp, e.a);
      else if (fp.cmdVars[1] === 1) { fp.selfVel.y = f(fp.selfVel.y * s.specialn_vel_mul); fp.selfVel.x = f(fp.selfVel.x * s.specialn_vel_mul); }
      else if (fp.cmdVars[1] === 2) airPhysics(fp, e.a, e.c, (id) => e.playSound(id));
    },
    coll(e) {
      if (!landed(e)) return;
      e.toGround();
      e.changeMotion(CA.SpecialN, GROUND_AIR, e.fighter.animFrame, 1);
    },
  },
];

export function registerFalconPunch(kit: Kit): void {
  addStates(kit, punch);
  kit.specials.groundN = (e) => punchEnter(e, CA.SpecialN);
  kit.specials.airN = (e) => punchEnter(e, CA.SpecialAirN);
}

// ============================================================================ Raptor Boost
/**
 * ftCa_SpecialS_OnDetect: the startup's inert hitboxes touched a fighter (hurtbox_detect_cb) while the
 * script allows it (var 0): the lunge that hits starts.
 */
function boostDetect(e: Engine): void {
  const fp = e.fighter;
  if (!fp.cmdVars[0]) return;
  if (fp.motionId === CA.SpecialSStart) {
    e.toGround();
    e.changeMotion(CA.SpecialS, GROUND_AIR, 0, 1);
    fp.selfVel.y = 0;
    fp.grVel = f(fp.grVel * e.data.special.specials_gr_vel_x);
  } else if (fp.motionId === CA.SpecialAirSStart) {
    e.changeMotion(CA.SpecialAirS, GROUND_AIR, 0, 1);
  }
}

function boostGroundEnter(e: Engine): void {
  const fp = e.fighter;
  fp.cmdVars[0] = fp.cmdVars[1] = fp.cmdVars[2] = fp.cmdVars[3] = 0;
  e.toGround();
  e.changeMotion(CA.SpecialSStart, MF.None, 0, 1);
  e.animStep();
  fp.onDetect = boostDetect;
  fp.selfVel.x = fp.selfVel.y = 0;
  fp.grVel = 0;
}

function boostAirEnter(e: Engine): void {
  const fp = e.fighter;
  fp.cmdVars[0] = fp.cmdVars[1] = fp.cmdVars[2] = fp.cmdVars[3] = 0;
  e.changeMotion(CA.SpecialAirSStart, MF.None, 0, 1);
  e.animStep();
  fp.onDetect = boostDetect;
  fp.selfVel.x = fp.selfVel.y = 0;
  fp.mv.boostGrav = 0;
  e.toAirNoJumps();
}

/** Helpless with the move's landing lag, or a plain fall when it has none (ftCo_80096900). */
function boostHelpless(e: Engine, lag: number, clamp: boolean): void {
  if (lag === 0) { fallEnter(e); return; }
  if (clamp) clampAirDrift(e.fighter, e.a);
  fallSpecialEnter(e, 1, 1, false, 1, lag);
}

/** The aerial boost's own gravity (mv.ca.specials.grav), down to its terminal speed. */
function boostFall(e: Engine): void {
  const fp = e.fighter, s = e.data.special;
  let g = f((fp.mv.boostGrav ?? 0) - s.specials_grav);
  if (g < -s.specials_terminal_vel) g = f(-s.specials_terminal_vel);
  fp.mv.boostGrav = g;
  fp.selfVel.y = g;
}

const boost: StateDef[] = [
  {
    id: CA.SpecialSStart, name: 'SpecialSStart', move: 'SpecialSStart',
    anim(e) { if (!e.isFramesRemaining()) waitEnter(e); },
    phys(e) { groundAttackPhysics(e.fighter, e.a, e.c); },
    coll(e) {
      const fp = e.fighter, s = e.data.special;
      if (fp.cmdVars[2] === 0) { collStop(e); return; }
      if (!stayOnGround(e)) {
        e.toAirNoJumps();
        boostHelpless(e, s.specials_miss_landing_lag, true);
        return;
      }
      // Running into a wall ends it.
      if (fp.cmdVars[0] === 1 && ((fp.facing === 1 && fp.envFlags & ENV.LeftWall) || (fp.facing === -1 && fp.envFlags & ENV.RightWall))) waitEnter(e);
    },
  },
  {
    id: CA.SpecialS, name: 'SpecialS', move: 'SpecialS',
    anim(e) { if (!e.isFramesRemaining()) waitEnter(e); },
    phys(e) { groundAttackPhysics(e.fighter, e.a, e.c); },
    coll(e) {
      if (stayOnGround(e)) return;
      e.toAirNoJumps();
      boostHelpless(e, e.data.special.specials_hit_landing_lag, true);
    },
  },
  {
    id: CA.SpecialAirSStart, name: 'SpecialAirSStart', move: 'SpecialAirSStart',
    anim(e) {
      if (e.isFramesRemaining()) return;
      e.toAirNoJumps();
      boostHelpless(e, e.data.special.specials_miss_landing_lag, false);
    },
    phys(e) { airRootMotion(e.fighter); if (e.fighter.cmdVars[1] === 1) boostFall(e); },
    coll(e) { if (landed(e)) landingFallSpecialEnter(e, false, e.data.special.specials_miss_landing_lag); },
  },
  {
    id: CA.SpecialAirS, name: 'SpecialAirS', move: 'SpecialAirS',
    anim(e) {
      if (e.isFramesRemaining()) return;
      e.toAirNoJumps();
      boostHelpless(e, e.data.special.specials_hit_landing_lag, false);
    },
    phys(e) { airRootMotion(e.fighter); boostFall(e); },
    coll(e) {
      if (!landed(e)) return;
      e.fighter.grVel = e.fighter.selfVel.x;
      landingFallSpecialEnter(e, false, e.data.special.specials_hit_landing_lag);
    },
  },
];

export function registerRaptorBoost(kit: Kit): void {
  addStates(kit, boost);
  kit.specials.groundS = boostGroundEnter;
  kit.specials.airS = boostAirEnter;
}

// ============================================================================ Falcon Dive
/** ftCa_SpecialLw_800E49FC (x21EC, run as the state change finishes): no jumps left, no drift yet. */
function diveVars(e: Engine): void {
  const fp = e.fighter, s = e.data.special;
  fp.jumpsUsed = e.a.max_jumps;
  fp.mv.diveX0 = s.specialhi_air_var;
  fp.cmdVars[0] = 0;
  fp.cmdVars[1] = Math.trunc(s.specialhi_unk2);
  fp.mv.diveVelX = 0;
  fp.mv.diveVelY = 0;
  fp.mv.diveCatch = 0;
  fp.mv.diveCanLand = 0;
}

function diveEnter(e: Engine, msid: number): void {
  e.changeMotion(msid, MF.None, 0, 1);
  diveVars(e);
  e.animStep();
}

/** ftCa_SpecialHi_IASA: from the script's signal on, it can land and grab ledges, and turn once. */
function diveIasa(e: Engine): void {
  const fp = e.fighter;
  if (!fp.cmdVars[0]) return;
  fp.cmdVars[0] = 0;
  fp.mv.diveCanLand = 1;
  if (Math.abs(fp.input.lx) > e.data.special.specialhi_input_var) fp.facing = fp.input.lx >= 0 ? 1 : -1;
}

/**
 * ftCa_SpecialHi_Phys: the rise is the animation's root motion, plus a drift of its own kept in
 * mv.vel: slowed by air friction, or steered by the stick within specialhi_horz_vel of the air speed.
 */
function divePhys(e: Engine): void {
  const fp = e.fighter, s = e.data.special, a = e.a;
  fp.selfVel.x = fp.mv.diveVelX ?? 0;
  fp.selfVel.y = fp.mv.diveVelY ?? 0;
  const max = f(s.specialhi_horz_vel * a.air_drift_max);
  if (!deaccelQuick(fp, max, a, e.c)) {
    driftSimpleNoFriction(fp, e.c.special_drift_stick_threshold, f(a.air_drift_stick_mul * s.specialhi_air_friction_mul), f(a.air_drift_max * s.specialhi_horz_vel));
  }
  fp.mv.diveVelX = f(fp.selfAccel.x + fp.selfVel.x);
  fp.mv.diveVelY = f(fp.selfAccel.y + fp.selfVel.y);
  airRootMotion(fp);
  fp.selfAccel.x = fp.selfAccel.y = 0;
  fp.selfVel.x = f(fp.selfVel.x + fp.mv.diveVelX);
  fp.selfVel.y = f(fp.selfVel.y + fp.mv.diveVelY);
}

function diveColl(e: Engine): void {
  const fp = e.fighter;
  if (fp.ga === GA.Air) {
    // doAirColl: ft_CheckGroundAndLedge, then a landing only once it may land (x2_b1), and a ledge.
    if (landed(e)) {
      if (fp.mv.diveCanLand) landingFallSpecialEnter(e, false, e.data.special.specialhi_landing_lag);
    } else if (fp.mv.diveCanLand) ledgeCatchCheck(e, 'both');
  } else if (!stayOnGround(e)) e.toAir();
}

function diveAnim(e: Engine): void {
  const s = e.data.special;
  if (!e.isFramesRemaining()) fallSpecialEnter(e, 1, 1, false, s.specialhi_freefall_air_spd_mul, s.specialhi_landing_lag);
}

const dive: StateDef[] = [
  { id: CA.SpecialHi, name: 'SpecialHi', move: 'SpecialHi', anim: diveAnim, iasa: diveIasa, phys: divePhys, coll: diveColl },
  { id: CA.SpecialAirHi, name: 'SpecialAirHi', move: 'SpecialAirHi', anim: diveAnim, iasa: diveIasa, phys: divePhys, coll: diveColl },
];

export function registerFalconDive(kit: Kit): void {
  addStates(kit, dive);
  kit.specials.groundHi = (e) => diveEnter(e, CA.SpecialHi);
  kit.specials.airHi = (e) => diveEnter(e, CA.SpecialAirHi);
}

// ============================================================================ Falcon Kick
/** ftCa_SpecialHi_800E400C (deal_dmg_cb): each hit, up to speciallw_unk2 + 1 of them, slows the kick. */
function kickHit(e: Engine): void {
  const fp = e.fighter, s = e.data.special;
  if ((fp.mv.kickHits ?? 0) <= s.speciallw_unk2) {
    fp.mv.kickHits = (fp.mv.kickHits ?? 0) + 1;
    fp.mv.kickFriction = f((fp.mv.kickFriction ?? 1) * s.speciallw_on_hit_spd_modifier);
  }
}

function resetKick(e: Engine): void {
  const fp = e.fighter;
  fp.cmdVars[2] = fp.cmdVars[1] = fp.cmdVars[0] = 0;
  fp.throwFlags = 0;
}

function kickGroundEnter(e: Engine): void {
  const fp = e.fighter;
  resetKick(e);
  fp.mv.kickHits = 0;
  fp.mv.kickFriction = 1;
  e.changeMotion(CA.SpecialLw, MF.None, 0, 1);
  e.animStep();
  fp.onDealDamage = kickHit;
}

function kickAirEnter(e: Engine): void {
  resetKick(e);
  e.changeMotion(CA.SpecialAirLw, MF.None, 0, 1);
  e.animStep();
}

/** The kick's velocity, scaled by what the hits took off it. */
function kickFriction(e: Engine): void {
  const fp = e.fighter, k = fp.mv.kickFriction ?? 1;
  fp.selfVel.x = f(fp.selfVel.x * k);
  fp.selfVel.y = f(fp.selfVel.y * k);
}

/** ftCa_SpecialLwEnd_Coll: stays grounded (at edges too once var 1 says so), lands from the air. */
function kickEndColl(e: Engine): void {
  const fp = e.fighter;
  if (grounded(e)) {
    if (fp.cmdVars[1] ? !stayOnGroundStop(e) : !stayOnGround(e)) e.toAir();
  } else if (landed(e)) e.toGround();
}

/** The aerial kick lands into its landing (doColl): SpecialAirLwEnd at speciallw_landing_lag_mul. */
function kickAirColl(e: Engine): void {
  if (!landed(e)) return;
  resetKick(e);
  e.toGround();
  e.changeMotion(CA.SpecialAirLwEnd, MF.None, 0, e.data.special.speciallw_landing_lag_mul);
}

/** Landing traction while var 2 is set, otherwise ordinary ground friction. */
function tractionOrFriction(e: Engine, traction: number): void {
  const fp = e.fighter;
  if (fp.cmdVars[2]) { groundDeaccel(fp, f(traction * e.a.ground_friction)); selfFromGround(fp); }
  else groundFriction(fp, e.a, e.c);
}

const kick: StateDef[] = [
  {
    id: CA.SpecialLw, name: 'SpecialLw', move: 'SpecialLw',
    anim(e) {
      if (e.isFramesRemaining()) return;
      resetKick(e);
      if (grounded(e)) { e.toGround(); e.changeMotion(CA.SpecialLwEnd, MF.None, 0, e.data.special.speciallw_ground_lag_mul); }
      else { e.toAir(); e.changeMotion(CA.SpecialLwEndAir, MF.None, 0, 1); }
    },
    phys(e) {
      const fp = e.fighter;
      if (grounded(e)) groundRootMotionSet(fp, e.a.ground_friction, fp.facing);
      else airRootMotion(fp);
      kickFriction(e);
    },
    coll(e) {
      const fp = e.fighter;
      if (grounded(e)) { if (!stayOnGround(e)) e.toAir(); }
      else if (landed(e)) e.toGround();
      // Into a wall while the script allows it: the rebound (SpecialHiThrow1).
      if (fp.cmdVars[0] && ((fp.facing === -1 && fp.envFlags & ENV.RightWall) || (fp.facing === 1 && fp.envFlags & ENV.LeftWall))) {
        resetKick(e);
        e.toAir();
        e.changeMotion(CA.SpecialHiThrow1, MF.None, 0, 1);
      }
    },
  },
  {
    id: CA.SpecialLwEnd, name: 'SpecialLwEnd', move: 'SpecialLwEnd',
    anim(e) { if (!e.isFramesRemaining()) (grounded(e) ? waitEnter : fallEnter)(e); },
    phys(e) {
      if (grounded(e)) tractionOrFriction(e, e.data.special.speciallw_ground_traction);
      else airFallDeaccel(e.fighter, e.a);
      kickFriction(e);
    },
    coll: kickEndColl,
  },
  {
    id: CA.SpecialLwEndAir, name: 'SpecialLwEndAir', move: 'SpecialLwEndAir',
    anim(e) { if (!e.isFramesRemaining()) (grounded(e) ? waitEnter : fallEnter)(e); },
    phys(e) {
      const fp = e.fighter;
      if (grounded(e)) { groundRootMotionSet(fp, e.a.ground_friction, fp.facing); return; }
      if (fp.cmdVars[0]) airFallDeaccel(fp, e.a);
      else airRootMotion(fp);
    },
    coll: kickEndColl,
  },
  {
    id: CA.SpecialAirLw, name: 'SpecialAirLw', move: 'SpecialAirLw',
    anim(e) {
      if (e.isFramesRemaining()) return;
      resetKick(e);
      e.toAir();
      e.changeMotion(CA.SpecialAirLwEndAir, MF.None, 0, 1);
    },
    phys(e) { airRootMotion(e.fighter); },
    coll: kickAirColl,
  },
  {
    id: CA.SpecialAirLwEnd, name: 'SpecialAirLwEnd', move: 'SpecialAirLwEnd',
    anim(e) { if (!e.isFramesRemaining()) waitEnter(e); },
    phys(e) { tractionOrFriction(e, e.data.special.speciallw_air_landing_traction); },
    coll: collStop,
  },
  {
    id: CA.SpecialAirLwEndAir, name: 'SpecialAirLwEndAir', move: 'SpecialAirLwEndAir',
    anim(e) { if (!e.isFramesRemaining()) fallEnter(e); },
    phys(e) { airFallDeaccel(e.fighter, e.a); },
    coll: kickAirColl,
  },
  {
    // The rebound off a wall (named SpecialHiThrow1 in the game's tables).
    id: CA.SpecialHiThrow1, name: 'SpecialHiThrow1', move: 'SpecialHiThrow1',
    anim(e) { if (!e.isFramesRemaining()) fallEnter(e); },
    phys(e) { airRootMotion(e.fighter); },
    // ftCo_AirCatchHit_Coll: lands standing when slow, otherwise into Landing.
    coll(e) { if (landed(e)) landFromAir(e); },
  },
];

export function registerFalconKick(kit: Kit): void {
  addStates(kit, kick);
  kit.specials.groundLw = kickGroundEnter;
  kit.specials.airLw = kickAirEnter;
}
