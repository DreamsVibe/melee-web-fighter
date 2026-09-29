// Fox's up special (Firefox), ported from ft/kinds/ftFox/ftfoxspecialhi.c. Fox charges, then launches
// in the stick's direction for a fixed number of frames with his model pointed along the flight
// (XRotN), slows down, and ends helpless. Early in the flight he passes through platforms; after
// that, hitting a floor steeply bounces him off it (SpecialHiBound). The flight and its end catch
// ledges facing either way; the charge in the air, only the way he faces.
import type { Engine } from '../engine';
import { MF } from '../engine';
import { GA } from '../types';
import { STATES, specials, collAirLand, collStop, fallSpecialEnter, waitEnter, type StateDef } from '../states';
import { airPhysics, clampAirDrift, deaccelQuickAir, fall, groundDeaccel, groundFriction, selfDeaccel, selfFromGround } from '../physics';
import { airCollision, groundCollision, EdgeMode, isOnPlatform } from '../collision';
import { ledgeCatchCheck } from '../cliff';

export const FX_HI = { Hold: 353, HoldAir: 354, Ground: 355, Air: 356, Landing: 357, Fall: 358, Bound: 359 } as const;

/** FTFOX_SPECIALHI_COLL_FLAG: ground/air switches keep the frame and replay the script silently. */
const GROUND_AIR = MF.UpdateCmd | MF.KeepGfx;
const f = Math.fround;
const HALF_PI = 1.5707963705062866;
const TWO_PI = 6.2831854820251465;

/** ftFox_SpecialHi_RotateModel: point Fox along his flight. */
function rotate(e: Engine, angle: number): void {
  e.fighter.mv.firefoxAngle = angle;
  e.fighter.xRot = TWO_PI - angle;
}
/** After a state change (which resets the part rotation), keep pointing the same way. */
const keepRotation = (e: Engine) => rotate(e, e.fighter.mv.firefoxAngle);

function groundEnter(e: Engine): void {
  const fp = e.fighter, s = e.data.special;
  fp.mv.firefoxGravityDelay = s.firefox_gravity_delay;
  fp.grVel = f(fp.grVel / s.firefox_vel_div);
  e.changeMotion(FX_HI.Hold, MF.None, 0, 1);
  e.animStep();
}

function airEnter(e: Engine): void {
  const fp = e.fighter, s = e.data.special;
  fp.mv.firefoxGravityDelay = s.firefox_gravity_delay;
  fp.selfVel.x = f(fp.selfVel.x / s.firefox_vel_div);
  fp.selfVel.y = 0;
  e.changeMotion(FX_HI.HoldAir, MF.None, 0, 1);
  e.animStep();
}

function startTravel(e: Engine, msid: number): void {
  const fp = e.fighter;
  e.changeMotion(msid, MF.None, 0, 1);
  fp.mv.firefoxTravel = e.data.special.firefox_duration;
  fp.mv.firefoxFrames = 0;
  fp.mv.firefoxCollFrames = 0;
}

/** ftFx_SpecialAirHi_Enter: launch in the air toward the stick (straight up without one). */
function airLaunch(e: Engine): void {
  const fp = e.fighter, s = e.data.special, i = fp.input;
  let angle = HALF_PI;
  if (Math.abs(i.lx) + Math.abs(i.ly) >= s.firefox_direction_stick_min) {
    if (Math.abs(i.lx) > s.firefox_facing_stick_min) fp.facing = i.lx >= 0 ? 1 : -1;
    angle = Math.atan2(i.ly, i.lx * fp.facing);
  }
  startTravel(e, FX_HI.Air);
  fp.selfVel.x = f(fp.facing * (s.firefox_speed * Math.cos(angle)));
  fp.selfVel.y = f(s.firefox_speed * Math.sin(angle));
  rotate(e, angle);
  fp.jumpsUsed = e.a.max_jumps;
}

/**
 * ftFx_SpecialAirHi_AirToGround: launching from the ground. Aimed along or into the floor, Fox
 * travels on it; aimed into a platform, he drops through it; aimed up, he flies.
 */
function groundLaunch(e: Engine): void {
  const fp = e.fighter, s = e.data.special, i = fp.input;
  if (Math.abs(i.ly) + Math.abs(i.lx) >= s.firefox_direction_stick_min && i.ly <= 0) {
    // lbVector_AngleXY(floor normal, stick) >= 90 degrees on flat ground means "not upward".
    if (isOnPlatform(fp)) fp.floorSkip = fp.floor;
    else {
      fp.facing = i.lx >= 0 ? 1 : -1;
      startTravel(e, FX_HI.Ground);
      fp.grVel = f(s.firefox_speed * fp.facing);
      rotate(e, 0);
      return;
    }
  }
  e.toAirNoJumps();
  airLaunch(e);
}

function travelAnim(e: Engine): void {
  const fp = e.fighter;
  fp.mv.firefoxTravel -= 1;
  if (fp.mv.firefoxTravel > 0) return;
  if (fp.ga === GA.Air) e.changeMotion(FX_HI.Fall, MF.None, 0, 1);
  else e.changeMotion(FX_HI.Landing, MF.None, 0, 1);
}

function helpless(e: Engine): void {
  const s = e.data.special;
  fallSpecialEnter(e, 1, 0, true, s.firefox_freefall_mobility, s.firefox_landing_lag);
}

/** ftFx_SpecialHiBound_Enter: bounce off a floor hit too steeply. */
function boundEnter(e: Engine): void {
  const fp = e.fighter;
  e.changeMotion(FX_HI.Bound, MF.None, 0, 1);
  e.animStep();
  fp.selfVel.x = f(fp.selfVel.x * e.data.special.firefox_bound_vel_x);
  fp.cmdVars[0] = 0;
}

const defs: StateDef[] = [
  {
    id: FX_HI.Hold, name: 'SpecialHiHold', move: 'SpecialHiHold',
    anim(e) { if (!e.isFramesRemaining()) { if (e.fighter.ga === GA.Air) airLaunch(e); else groundLaunch(e); } },
    phys(e) { groundFriction(e.fighter, e.a, e.c); },
    coll(e) {
      const fp = e.fighter;
      if (groundCollision(fp, e.stage, e.moveStart, EdgeMode.Fall)) return;
      const frame = fp.animFrame;
      e.toAirNoJumps();
      e.changeMotion(FX_HI.HoldAir, GROUND_AIR, frame, 1);
    },
  },
  {
    id: FX_HI.HoldAir, name: 'SpecialHiHoldAir', move: 'SpecialHiHoldAir',
    anim(e) { if (!e.isFramesRemaining()) { if (e.fighter.ga === GA.Air) airLaunch(e); else groundLaunch(e); } },
    phys(e) {
      const fp = e.fighter, s = e.data.special;
      if (fp.mv.firefoxGravityDelay) fp.mv.firefoxGravityDelay -= 1;
      else fall(fp, s.firefox_hold_fall_accel, e.a.terminal_velocity);
      selfDeaccel(fp, s.firefox_hold_air_friction);
    },
    coll(e) {
      const fp = e.fighter;
      if (!airCollision(fp, e.stage, e.moveStart, null)) { ledgeCatchCheck(e, 'facing'); return; }
      const frame = fp.animFrame;
      e.toGround();
      e.changeMotion(FX_HI.Hold, GROUND_AIR, frame, 1);
      clampAirDrift(fp, e.a);
    },
  },
  {
    id: FX_HI.Ground, name: 'SpecialHi', move: 'SpecialHi',
    anim: travelAnim,
    phys(e) {
      const fp = e.fighter, s = e.data.special;
      fp.mv.firefoxFrames += 1;
      if (fp.mv.firefoxFrames >= s.firefox_decel_start) groundDeaccel(fp, s.firefox_decel);
      selfFromGround(fp);
    },
    coll(e) {
      const fp = e.fighter;
      fp.mv.firefoxCollFrames += 1;
      if (groundCollision(fp, e.stage, e.moveStart, EdgeMode.Fall)) return;
      // Off the edge: keep flying in the air version.
      const frame = fp.animFrame;
      e.toAirNoJumps();
      e.changeMotion(FX_HI.Air, GROUND_AIR | MF.SkipHit, frame, 1);
      keepRotation(e);
    },
  },
  {
    id: FX_HI.Air, name: 'SpecialAirHi', move: 'SpecialHi',
    anim: travelAnim,
    phys(e) {
      const fp = e.fighter, s = e.data.special;
      fp.mv.firefoxFrames += 1;
      if (fp.mv.firefoxFrames >= s.firefox_decel_start) {
        const a = fp.mv.firefoxAngle;
        fp.selfVel.x = f(fp.selfVel.x - fp.facing * (s.firefox_decel * Math.cos(a)));
        fp.selfVel.y = f(fp.selfVel.y - s.firefox_decel * Math.sin(a));
      }
    },
    coll(e) {
      const fp = e.fighter, s = e.data.special;
      // Platforms don't stop him until firefox_bounce_frames in (ftFox_SpecialHi_IsBound).
      const solid = fp.mv.firefoxCollFrames >= s.firefox_bounce_frames;
      if (!airCollision(fp, e.stage, e.moveStart, () => solid)) { ledgeCatchCheck(e, 'both'); return; }
      // Steep hits bounce; glancing ones slide along, re-aimed (the angle to the floor's normal).
      const v = fp.selfVel;
      const len = Math.hypot(v.x, v.y);
      const toNormal = len ? Math.acos(Math.max(-1, Math.min(1, v.y / len))) : 0;
      if (!fp.floor || toNormal >= (Math.PI / 180) * (90 + s.firefox_bound_angle)) {
        boundEnter(e);
        return;
      }
      fp.facing = v.x >= 0 ? 1 : -1;
      rotate(e, Math.atan2(v.y, v.x * fp.facing));
    },
  },
  {
    id: FX_HI.Landing, name: 'SpecialHiLanding', move: 'SpecialHiLanding',
    anim(e) { if (!e.isFramesRemaining()) waitEnter(e); },
    phys(e) { const fp = e.fighter; groundDeaccel(fp, e.data.special.firefox_landing_friction); selfFromGround(fp); },
    coll(e) { if (!groundCollision(e.fighter, e.stage, e.moveStart, EdgeMode.Fall)) helpless(e); },
  },
  {
    id: FX_HI.Fall, name: 'SpecialHiFall', move: 'SpecialHiFall',
    anim(e) { if (!e.isFramesRemaining()) helpless(e); },
    phys(e) { airPhysics(e.fighter, e.a, e.c, (id) => e.playSound(id)); },
    coll(e) {
      // ftFx_SpecialHiFall_Enter: landing out of the flight skips into the landing animation.
      collAirLand(e, (e2) => {
        e2.toGround();
        e2.changeMotion(FX_HI.Landing, MF.UpdateCmd, 13, 1);
        e2.animStep();
      }, true, 'both');
    },
  },
  {
    id: FX_HI.Bound, name: 'SpecialHiBound', move: 'SpecialHiBound',
    anim(e) {
      const fp = e.fighter;
      if (fp.cmdVars[0] && fp.ga === GA.Air) { helpless(e); fp.jumpsUsed = e.a.max_jumps; return; }
      if (e.isFramesRemaining()) return;
      if (fp.ga === GA.Air) { helpless(e); fp.jumpsUsed = e.a.max_jumps; } else waitEnter(e);
    },
    phys(e) {
      const fp = e.fighter;
      if (fp.ga === GA.Air) { fp.selfVel.y = fp.rootDelta.y; deaccelQuickAir(fp, e.a, e.c); }
      else groundFriction(fp, e.a, e.c);
    },
    coll(e) {
      const fp = e.fighter;
      if (fp.ga === GA.Air) { if (airCollision(fp, e.stage, e.moveStart, null)) e.toGround(); }
      else collStop(e);
    },
  },
];

let registered = false;
export function registerFirefox(): void {
  if (registered) return;
  registered = true;
  for (const d of defs) STATES.set(d.id, d);
  specials.groundHi = groundEnter;
  specials.airHi = airEnter;
}
