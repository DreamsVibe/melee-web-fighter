// Movement helpers ported from the decomp: ft/ftcommon.c (ftCommon_CalcGroundAccel_*, CalcSelfAccel_*,
// Fall, FallFast, CheckFallFast), ft/ft_084E.c (ft_80084F3C ground friction, ft_80084DB0 air physics).
// Values are stored as 32-bit floats (Math.fround) like the game's.
import type { Fighter, Named } from './types';

const f = Math.fround;
const abs = Math.abs;

/** ftCommon_CalcGroundAccel_Deaccel. */
export function groundDeaccel(fp: Fighter, friction: number): void {
  if (abs(friction) > abs(fp.grVel)) friction = -fp.grVel;
  else if (fp.grVel > 0) friction = -friction;
  fp.grAccel1 = f(friction);
}

export function groundDashRun(fp: Fighter, a: Named, accel: number, target: number, friction: number): void {
  if (!target) { groundDeaccel(fp, friction); return; }
  const v = fp.grVel;
  if (!(v * accel < 0)) {
    if (accel > 0) {
      if (f(v + accel) > target) {
        accel = -friction;
        if (f(v + accel) < target) accel = f(target - v);
        if (f(v + accel) > a.ground_max_horizontal_velocity) accel = f(a.ground_max_horizontal_velocity - v);
      }
    } else if (f(v + accel) < target) {
      accel = friction;
      if (f(v + accel) > target) accel = f(target - v);
      if (f(v + accel) < -a.ground_max_horizontal_velocity) accel = f(-a.ground_max_horizontal_velocity - v);
    }
  }
  fp.grAccel1 = f(accel);
}

/** ftCommon_SetSelfMovementFromGroundedMovement on flat ground (normal (0, 1)). */
export function selfFromGround(fp: Fighter): void {
  fp.selfAccel.x = fp.grAccel1;
  fp.selfAccel.y = 0;
  fp.selfVel.x = fp.grVel;
  fp.selfVel.y = 0;
}

/** ft_80084F3C: ground friction, doubled above walk speed. */
export function groundFriction(fp: Fighter, a: Named, c: Named): void {
  let friction = a.ground_friction;
  if (abs(fp.grVel) > a.walk_max_vel) friction = f(friction * c.friction_above_walk_speed);
  groundDeaccel(fp, friction);
  selfFromGround(fp);
}

/** ftCommon_CalcSelfAccel_Deaccel. */
export function selfDeaccel(fp: Fighter, friction: number): void {
  let fr = friction;
  if (abs(fr) >= abs(fp.selfVel.x)) fr = -fp.selfVel.x;
  else if (fp.selfVel.x > 0) fr = -fr;
  fp.selfAccel.x = f(fr);
}

export function selfAccelToVelClamped(fp: Fighter, a: Named, vel: number, accel: number, target: number, friction: number): void {
  if (!target) { selfDeaccel(fp, friction); return; }
  if (!(vel * accel < 0)) {
    if (accel > 0) {
      if (f(vel + accel) > target) {
        accel = -friction;
        if (f(vel + accel) < target) accel = f(target - vel);
        if (f(vel + accel) > a.air_max_horizontal_velocity) accel = f(a.air_max_horizontal_velocity - vel);
      }
    } else if (f(vel + accel) < target) {
      accel = friction;
      if (f(vel + accel) > target) accel = f(target - vel);
      if (f(vel + accel) < -a.air_max_horizontal_velocity) accel = f(-a.air_max_horizontal_velocity - vel);
    }
  }
  fp.selfAccel.x = f(accel);
}

/** ftCommon_CalcSelfAccel_Drift (from the current self velocity). */
export function airDrift(fp: Fighter, a: Named): void {
  const lsx = fp.input.lx;
  const scaled = f(lsx * a.air_drift_stick_mul);
  const flat = lsx > 0 ? a.aerial_drift_base : -a.aerial_drift_base;
  selfAccelToVelClamped(fp, a, fp.selfVel.x, f(scaled + flat), f(lsx * a.air_drift_max), a.aerial_friction);
}

/** ftCommon_Fall. */
export function fall(fp: Fighter, gravity: number, terminal: number): void {
  fp.selfVel.y = f(fp.selfVel.y - gravity);
  if (fp.selfVel.y < -terminal) fp.selfVel.y = f(-terminal);
}

export function fallFast(fp: Fighter, a: Named): void {
  fp.selfVel.y = f(-a.fast_fall_velocity);
}

/** ftCommon_CheckFallFast: returns true on the frame fast fall starts (and plays its sound). */
export function checkFallFast(fp: Fighter, c: Named, sound: (id: number) => void): boolean {
  if (!fp.fallFast && fp.selfVel.y < 0 && fp.input.ly <= -c.fast_fall_threshold && fp.timers.lyTimer < c.fast_fall_window) {
    fp.fallFast = true;
    fp.timers.lyTimer = 0xfe;
    sound(0x96);
    return true;
  }
  return false;
}

/** ft_80084DB0: gravity or fast fall, then air drift. */
export function airPhysics(fp: Fighter, a: Named, c: Named, sound: (id: number) => void): void {
  checkFallFast(fp, c, sound);
  if (fp.fallFast) fallFast(fp, a);
  else fall(fp, a.gravity, a.terminal_velocity);
  airDrift(fp, a);
}

/** ftCommon_CalcSelfAccel_DeaccelQuickAir. */
export function deaccelQuickAir(fp: Fighter, a: Named, c: Named): void {
  const vel = fp.selfVel.x;
  const fr = abs(vel) > a.air_drift_max ? c.aerial_friction_out_of_bounds : a.aerial_friction;
  let accel = fr;
  if (abs(accel) >= abs(vel)) accel = -vel;
  else if (vel > 0) accel = -fr;
  fp.selfAccel.x = f(accel);
}

/** ftCommon_ClampAirDrift. */
export function clampAirDrift(fp: Fighter, a: Named): void {
  if (fp.selfVel.x < -a.air_drift_max) fp.selfVel.x = f(-a.air_drift_max);
  else if (fp.selfVel.x > a.air_drift_max) fp.selfVel.x = f(a.air_drift_max);
}

export function clampGroundVel(fp: Fighter, max: number): void {
  if (fp.grVel < -max) fp.grVel = f(-max);
  else if (fp.grVel > max) fp.grVel = f(max);
}

const rootMotion = (fp: Fighter) => !!fp.move && (fp.move.animFlags & 0x80000000) !== 0;

/** ft_80085030: ground speed from the animation's root motion, or friction when it has none. */
export function groundRootMotion(fp: Fighter, friction: number, facing: number): void {
  if (rootMotion(fp)) fp.grAccel1 = f(fp.rootDelta.z * facing - fp.grVel);
  else groundDeaccel(fp, friction);
  selfFromGround(fp);
}

/** ft_80084FA8: ground attacks, with the doubled friction above walk speed. */
export function groundAttackPhysics(fp: Fighter, a: Named, c: Named): void {
  let friction = a.ground_friction;
  if (abs(fp.grVel) > a.walk_max_vel) friction = f(friction * c.friction_above_walk_speed);
  groundRootMotion(fp, friction, fp.facing);
}

/** ft_800850E0: ground speed set straight from root motion. */
export function groundRootMotionSet(fp: Fighter, friction: number, facing: number): void {
  if (rootMotion(fp)) fp.grVel = f(fp.rootDelta.z * facing);
  else groundDeaccel(fp, friction);
  selfFromGround(fp);
}

/** ft_80085134: air velocity straight from root motion. */
export function airRootMotion(fp: Fighter): void {
  fp.selfVel.x = f(fp.rootDelta.z * fp.facing);
  fp.selfVel.y = fp.rootDelta.y;
}

/** ft_80084EEC: gravity, then plain air friction (no drift). */
export function airFallDeaccel(fp: Fighter, a: Named): void {
  fall(fp, a.gravity, a.terminal_velocity);
  selfDeaccel(fp, a.aerial_friction);
}

/**
 * ftCommon_CalcSelfAccel_DeaccelQuick: air friction, the stronger out-of-bounds one above `max`.
 * Returns whether the speed was above `max`.
 */
export function deaccelQuick(fp: Fighter, max: number, a: Named, c: Named): boolean {
  const vel = fp.selfVel.x, over = abs(vel) > max;
  const fr = over ? c.aerial_friction_out_of_bounds : a.aerial_friction;
  let accel = fr;
  if (abs(accel) >= abs(vel)) accel = -vel;
  else if (vel > 0) accel = -fr;
  fp.selfAccel.x = f(accel);
  return over;
}

/** ftCommon_CalcSelfAccel_AccelToVel. */
export function accelToVel(fp: Fighter, accel: number, target: number): void {
  const v = fp.selfVel.x;
  if (!target) accel = -v;
  else if (!(v * accel < 0)) {
    if (accel > 0) { if (f(v + accel) > target) accel = f(target - v); }
    else if (f(v + accel) < target) accel = f(target - v);
  }
  fp.selfAccel.x = f(accel);
}

/** ftCommon_CalcSelfAccel_DriftSimple_NoFriction: drift towards the stick past `threshold`. */
export function driftSimpleNoFriction(fp: Fighter, threshold: number, accelMax: number, targetMax: number): void {
  const lx = fp.input.lx;
  if (abs(lx) >= threshold) accelToVel(fp, f(lx * accelMax), f(lx * targetMax));
  else accelToVel(fp, 0, 0);
}
