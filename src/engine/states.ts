// Movement motion states, ported from the decomp's ft/kinds/ftCommon/ftCo_*.c. Each state has the
// game's four callbacks: anim (animation ended / timers), iasa (interrupts, run after input), phys,
// coll. Ground attacks, shield, rolls, grabs and taunts are in groundmoves.ts; a character's specials
// in its behavior modules, ledges in cliff.ts. Checks for things the web version has no use for
// (items, other fighters) are left out.
import type { Engine } from './engine';
import { MF } from './engine';
import { BTN } from './pad';
import { GA, ENV } from './types';
import {
  airPhysics, checkFallFast, clampAirDrift, fall, fallFast, groundDashRun, groundDeaccel,
  groundFriction, selfAccelToVelClamped, selfFromGround,
} from './physics';
import { airCollision, groundCollision, EdgeMode, isOnPlatform } from './collision';
import { def, MS } from './statedefs';
import { atStickRim } from './ucf';
import { ledgeCatchCheck, type LedgeDir } from './cliff';
import {
  appealCheck, attack1Check, attackDashCheck, attackHi4Check, attackS4DashCheck, attacksS4ToLw3, catchCheck,
  charAppealCheck, dashCatchCheck, dashRollCheck, groundIasa, guardCheck, guardFromRunCheck, specialAirCheck,
  specialHiCheck, specialLwCheck, specialNCheck, specialSCheck,
} from './groundmoves';

export { STATES, MS, specials, type StateDef, type SpecialHooks } from './statedefs';

const f = Math.fround;
const abs = Math.abs;

// ============================================================================ shared checks
const lx = (e: Engine) => e.fighter.input.lx;
const ly = (e: Engine) => e.fighter.input.ly;

/** Every ground special, then a grab, the smashes and tilts and a jab (the head of most ground lists). */
function groundAttacks(e: Engine): boolean {
  return specialSCheck(e) || specialHiCheck(e) || specialNCheck(e) || specialLwCheck(e) || catchCheck(e) || attacksS4ToLw3(e) || attack1Check(e);
}

/** ftCo_Jump_CheckInput. */
export function jumpCheck(e: Engine): boolean {
  const input = e.jumpInput();
  if (!input) return false;
  kneeBendEnter(e, input);
  return true;
}

/** fn_800CAF78: jump from Run/RunBrake/TurnRun, with the relaxed tap-jump threshold. */
function relaxedJumpCheck(e: Engine): boolean {
  const fp = e.fighter, c = e.c;
  if (fp.input.ly >= c.relaxed_tap_jump_threshold && fp.timers.lyTimer < c.tap_jump_window) { kneeBendEnter(e, 1); return true; }
  if (fp.input.pressed & (BTN.X | BTN.Y)) { kneeBendEnter(e, 2); return true; }
  return false;
}

/** ftCo_Dash_CheckInput. */
export function dashCheck(e: Engine): boolean {
  const fp = e.fighter, c = e.c;
  if (abs(lx(e)) >= c.dash_stick_threshold && fp.timers.lxTimer < c.dash_stick_window) {
    if (lx(e) * fp.facing < 0) turnEnterSmash(e);
    else dashEnter(e, 1);
    return true;
  }
  return false;
}

/** ftCo_Turn_CheckInput. */
export function turnCheck(e: Engine): boolean {
  if (lx(e) * e.fighter.facing <= e.c.turn_stick_threshold) { turnEnter(e, MS.Turn, 0, e.a.standing_turn_frames, 0); return true; }
  return false;
}

/** ftCo_Walk_CheckInput. */
export function walkCheck(e: Engine): boolean {
  if (lx(e) * e.fighter.facing >= e.c.walk_stick_threshold) { walkEnter(e, 0); return true; }
  return false;
}

/** ftCo_800D5FB0: crouch. */
export function squatCheck(e: Engine): boolean {
  if (ly(e) < -e.c.squat_threshold) { squatEnter(e); return true; }
  return false;
}

/** ftCo_80099F1C: tapped down while standing on a platform. */
export function passInput(e: Engine): boolean {
  const fp = e.fighter, c = e.c;
  return fp.input.ly <= -c.pass_stick_threshold && fp.timers.lyTimer < c.pass_stick_window && isOnPlatform(fp);
}

/** ftCo_80099F9C: arm the platform drop (the Squat state then drops after pass_delay frames). */
function passCheck(e: Engine): boolean {
  const fp = e.fighter;
  if (!fp.mv.passArmed && passInput(e)) {
    fp.mv.passArmed = 1;
    fp.mv.passTimer = e.c.pass_delay;
    return true;
  }
  return false;
}

/** ftCo_800CB870 → ftCo_JumpAerial_CheckInput(false): double jump. */
export function airJumpCheck(e: Engine): boolean {
  const fp = e.fighter, c = e.c;
  if (fp.jumpsUsed < e.a.max_jumps &&
    ((fp.input.ly >= c.tap_jump_threshold && fp.timers.lyTimer < c.tap_jump_window) || (fp.input.pressed & (BTN.X | BTN.Y)))) {
    jumpAerialEnter(e);
    return true;
  }
  return false;
}

/** ftCo_80099A58: air dodge on a digital L/R press. */
function airDodgeCheck(e: Engine): boolean {
  if (e.fighter.input.pressed & (BTN.R | BTN.L)) { escapeAirEnter(e, e.c.escapeair_iasa_timer); return true; }
  return false;
}

/** ftCo_800DF478: c-stick flicked this frame. */
function cstickFlick(e: Engine): boolean {
  const i = e.fighter.input, c = e.c;
  return (abs(i.pcx) < c.aerial_neutral_x && abs(i.cx) >= c.aerial_neutral_x) || (abs(i.pcy) < c.aerial_neutral_y && abs(i.cy) >= c.aerial_neutral_y);
}

/** ftCo_AttackAir_CheckItemThrowInput → ftCo_AttackAir_EnterFromCStick. */
function aerialCheck(e: Engine): boolean {
  if ((e.fighter.input.pressed & BTN.A) || cstickFlick(e)) { attackAirEnter(e, aerialFromSticks(e)); return true; }
  return false;
}

/** The common air interrupt list (ftCo_Fall_IASA_Inner, minus items and tether). */
export function airIasa(e: Engine, airDodge = true): boolean {
  if (specialAirCheck(e)) return true;
  if (airDodge && airDodgeCheck(e)) return true;
  if (aerialCheck(e)) return true;
  if (airJumpCheck(e)) return true;
  return false;
}

// ============================================================================ enters
/** ft_8008A348: Wait (from the air lands first). */
export function waitEnter(e: Engine): void {
  if (e.fighter.ga === GA.Air) e.toGround();
  e.changeMotion(MS.Wait, MF.None, 0, 1);
}

/** ftCo_Fall_Enter. */
export function fallEnter(e: Engine): void {
  const fp = e.fighter;
  e.changeMotion(MS.Fall, MF.KeepFastFall, 0, 1);
  clampAirDrift(fp, e.a);
  if (fp.ga === GA.Ground) e.toAir();
}

function frameCountOf(e: Engine, move: string): number {
  return e.data.moves.get(move)?.anim?.frameCount ?? 1;
}

function walkType(e: Engine, accelMul: number): number {
  const v = abs(e.fighter.grVel), a = e.a, c = e.c;
  if (v >= accelMul * f(c.walk_fast_threshold * a.walk_max_vel)) return 2;
  if (v >= accelMul * f(c.walk_middle_threshold * a.walk_max_vel)) return 1;
  return 0;
}

/** ftCo_Walk_Enter → ftWalkCommon_800DFCA4. */
function walkEnter(e: Engine, animStart: number): void {
  const fp = e.fighter, a = e.a;
  const accelMul = 1;
  fp.mv.walkAccelMul = accelMul;
  e.changeMotion(MS.WalkSlow + walkType(e, accelMul), MF.None, animStart, 1);
  e.animStep();
  fp.mv.walkX0 = fp.grVel;
  fp.mv.walkSlowFrame = frameCountOf(e, 'WalkSlow');
  fp.mv.walkMiddleFrame = frameCountOf(e, 'WalkMiddle');
  fp.mv.walkFastFrame = frameCountOf(e, 'WalkFast');
  fp.mv.walkSlowRate = a.slow_walk_max;
  fp.mv.walkMiddleRate = a.mid_walk_point;
  fp.mv.walkFastRate = a.fast_walk_min;
}

/** ftCo_Turn_Enter. */
function turnEnter(e: Engine, msid: number, x8: number, framesToTurn: number, animStart: number): void {
  const fp = e.fighter;
  fp.mv.turnHasTurned = 0;
  fp.mv.turnJustTurned = 0;
  fp.mv.turnFacingAfter = -fp.facing;
  fp.mv.turnFrames = framesToTurn;
  fp.mv.turnX8 = x8;
  fp.mv.turnBuffered = 0;
  e.changeMotion(msid, MF.None, animStart, 1);
  e.animStep();
}

/** ftCo_Turn_Enter_Smash: the dash-back turn. */
function turnEnterSmash(e: Engine): void {
  const fp = e.fighter;
  const facing = fp.facing;
  fp.mv.turnHasTurned = 0;
  fp.mv.turnJustTurned = 0;
  fp.mv.turnFacingAfter = -fp.facing;
  fp.mv.turnFrames = 0;
  fp.mv.turnX8 = facing;
  fp.mv.turnBuffered = 0;
  e.changeMotion(MS.Turn, MF.None, 0, 1);
  e.animStep();
}

/** ftCo_Dash_Enter. */
function dashEnter(e: Engine, x4: number): void {
  const fp = e.fighter, a = e.a;
  fp.cmdVars[0] = 0;
  e.changeMotion(MS.Dash, MF.None, 0, 1);
  e.animStep();
  fp.timers.lxTimer = 0xfe;
  const init = f(fp.facing * a.dash_initial_velocity);
  fp.mv.dashX0 = fp.grVel * fp.facing < 0 ? init : f(init - fp.grVel);
  fp.grAccel2 = fp.mv.dashX0; // ftCommon_800804A0 (ground friction multiplier is 1 on page floors)
  fp.mv.dashX4 = x4;
}

/** ftCo_Run_Enter_Full. */
function runEnter(e: Engine, x0: number, animStart = 0, rate = 1): void {
  const fp = e.fighter;
  e.changeMotion(MS.Run, MF.None, animStart, rate);
  fp.mv.runX0 = x0;
  fp.mv.runX4 = fp.grVel;
}

/** ftCo_RunBrake_Enter. */
function runBrakeEnter(e: Engine): void {
  const fp = e.fighter;
  fp.cmdVars[0] = 0;
  fp.cmdVars[1] = 0;
  e.changeMotion(MS.RunBrake, MF.None, 0, 1);
  fp.mv.brakeX0 = 0;
  fp.mv.brakeFrames = e.a.max_run_brake_frames;
}

/** ftCo_TurnRun_Enter. */
function turnRunEnter(e: Engine, animStart: number): void {
  const fp = e.fighter;
  fp.cmdVars[1] = 0;
  fp.mv.turnRunDir = fp.facing;
  e.changeMotion(MS.TurnRun, MF.SkipAnimVel, animStart, 1);
  fp.mv.turnRunX14 = 0;
}

/** ftCo_KneeBend_Enter (jump squat). input: 1 stick, 2 X/Y, 3 c-stick. */
export function kneeBendEnter(e: Engine, input: number): void {
  const fp = e.fighter;
  fp.mv.jumpInput = input;
  fp.mv.shortHop = 0;
  e.changeMotion(MS.KneeBend, MF.None, 0, 1);
}

/** ftCo_Jump_Enter + ftCo_800CB110. */
function jumpEnter(e: Engine): void {
  const fp = e.fighter, a = e.a, c = e.c;
  e.toAir();
  const msid = fp.input.lx * fp.facing > -c.jump_back_threshold ? MS.JumpF : MS.JumpB;
  e.changeMotion(msid, MF.None, 0, 1);
  const mul = 1;
  fp.mv.jumpX4 = 0;
  fp.selfVel.x = f(fp.selfVel.x * f(a.ground_to_air_jump_momentum_multiplier * mul));
  fp.selfVel.y = f(fp.selfVel.y * c.jump_y_velocity_keep);
  const hInit = f(fp.input.lx * a.jump_h_initial_velocity);
  let h = f(mul * hInit);
  fp.selfVel.y = f(fp.mv.shortHop ? a.hop_v_initial_velocity * mul : a.jump_v_initial_velocity * mul);
  h = f(fp.selfVel.x + h);
  const hMax = f(a.jump_h_max_velocity * mul);
  if (abs(h) > hMax) h = h < 0 ? -hMax : hMax;
  fp.selfVel.x = h;
  fp.timers.lyTimer = 0xfe;
  if (e.data.sfx.jump) e.playSound(e.data.sfx.jump);
}

/** ftCo_JumpAerial_Enter_Basic + ftCo_800CBAC4. */
export function jumpAerialEnter(e: Engine): void {
  const fp = e.fighter, a = e.a, c = e.c;
  e.toAir();
  fp.cmdVars[0] = 1;
  const msid = fp.input.lx * fp.facing > -c.jump_back_threshold ? MS.JumpAerialF : MS.JumpAerialB;
  const vx = f(fp.input.lx * a.air_jump_h_multiplier);
  const vy = f(a.jump_v_initial_velocity * a.air_jump_v_multiplier);
  e.changeMotion(msid, MF.SkipNametagVis, 0, 1);
  fp.selfVel.x = vx;
  fp.selfVel.y = vy;
  fp.timers.lyTimer = 0xfe;
  fp.jumpsUsed += 1;
  if (e.data.sfx.doubleJump) e.playSound(e.data.sfx.doubleJump);
}

function fallAerialEnter(e: Engine): void {
  e.changeMotion(MS.FallAerial, MF.None, 0, 1);
}

/** ftCo_80096900 → FallSpecial (helpless fall). */
export function fallSpecialEnter(e: Engine, xC: number, x10: number, allowInterrupt: boolean, mobility: number, landingLag: number): void {
  const fp = e.fighter, a = e.a;
  e.changeMotion(MS.FallSpecial, MF.KeepFastFall, 0, 1);
  fp.mv.fsMobility = f(a.air_drift_max * mobility);
  fp.mv.fsXC = xC;
  fp.mv.fsX10 = x10;
  fp.mv.fsLag = landingLag;
  fp.mv.fsAllow = allowInterrupt ? 1 : 0;
  if (fp.ga === GA.Ground) e.toAirNoJumps();
  else fp.jumpsUsed = a.max_jumps;
}

function squatEnter(e: Engine): void {
  const fp = e.fighter;
  e.changeMotion(MS.Squat, MF.None, 0, 1);
  e.animStep();
  fp.mv.passArmed = 0;
}

export function squatWaitEnter(e: Engine, flags: number): void {
  e.changeMotion(MS.SquatWait, flags, 0, 1);
}

/** ftCo_8009A228: drop through a platform. */
export function passEnter(e: Engine): void {
  const fp = e.fighter, c = e.c;
  const platform = fp.floor;
  e.toAir();
  clampAirDrift(fp, e.a);
  fp.selfVel.y = c.pass_y_velocity;
  e.changeMotion(MS.Pass, MF.None, 0, 1);
  fp.floorSkip = platform; // mpUpdateFloorSkip
  fp.timers.lyTimer = 0xfe;
}

/** ftCo_Landing_Enter. */
function landingEnter(e: Engine, msid: number, allowInterrupt: boolean, rate: number): void {
  const fp = e.fighter;
  e.toGround();
  e.changeMotion(msid, MF.None, 0, rate);
  fp.mv.landingAllow = allowInterrupt ? 1 : 0;
}

export function landingBasic(e: Engine): void {
  landingEnter(e, MS.Landing, true, 1);
  e.emitLanding(e.a.normal_landing_lag, false);
}

/** ftCo_LandingFallSpecial_Enter: the wavedash/waveland landing. */
export function landingFallSpecialEnter(e: Engine, allowInterrupt: boolean, lag: number): void {
  const landingFrames = frameCountOf(e, 'Landing');
  landingEnter(e, MS.LandingFallSpecial, allowInterrupt, f((0.1 + landingFrames) / lag));
  e.emitLanding(lag, false);
}

/** ft_80082B1C: landing from a jump or fall; soft landings go straight to Wait. */
export function landFromAir(e: Engine): void {
  if (e.fighter.selfVel.y > -e.c.landing_speed_threshold) { waitEnter(e); e.emitLanding(0, false); }
  else landingBasic(e);
}

const AERIALS = [MS.AttackAirN, MS.AttackAirF, MS.AttackAirB, MS.AttackAirHi, MS.AttackAirLw];
const LAG_ATTR = ['landingairn_lag', 'landingairf_lag', 'landingairb_lag', 'landingairhi_lag', 'landingairlw_lag'];

/** ftCo_AttackAir_GetMsidFromCStick. */
function aerialFromSticks(e: Engine): number {
  const fp = e.fighter, c = e.c;
  let sx: number, sy: number;
  if (cstickFlick(e)) { sx = fp.input.cx; sy = fp.input.cy; } else { sx = fp.input.lx; sy = fp.input.ly; }
  const angle = Math.atan2(sy, abs(sx));
  if (abs(sx) < c.aerial_neutral_x && abs(sy) < c.aerial_neutral_y) return MS.AttackAirN;
  if (angle > c.aerial_angle) return MS.AttackAirHi;
  if (angle < -c.aerial_angle) return MS.AttackAirLw;
  return sx * fp.facing >= 0 ? MS.AttackAirF : MS.AttackAirB;
}

function attackAirEnter(e: Engine, msid: number): void {
  const fp = e.fighter;
  fp.allowInterrupt = false;
  fp.cmdVars[0] = 0;
  fp.throwFlags = 0;
  e.changeMotion(msid, MF.KeepFastFall, 0, 1);
  e.animStep();
}

/** ftCo_LandingAir_EnterWithLag: landing lag from the move, halved by an L-cancel. */
function landingAirEnterWithLag(e: Engine): void {
  const fp = e.fighter, c = e.c;
  const i = AERIALS.indexOf(fp.motionId as typeof AERIALS[number]);
  if (fp.cmdVars[0] && i >= 0) {
    let lag = fp.move?.landingLag ?? e.a[LAG_ATTR[i]];
    const lcancel = fp.counters.lr < c.lcancel_window;
    if (lcancel) {
      const div = f(lag / c.lcancel_divisor);
      lag = Math.trunc(div) === 0 ? 1 : Math.trunc(div);
    }
    e.toGround();
    e.changeMotion(MS.LandingAirN + i, MF.None, 0, 1);
    e.setAnimRate(f((e.animEndFrame() + 0.1) / lag));
    e.emitLanding(lag, lcancel);
  } else landingBasic(e);
}

/** ftCo_80099A9C: air dodge. */
function escapeAirEnter(e: Engine, timer: number): void {
  const fp = e.fighter, c = e.c;
  fp.mv.eaVelX = fp.selfVel.x;
  fp.mv.eaVelY = fp.selfVel.y;
  if (abs(fp.input.lx) < c.escapeair_deadzone_x && abs(fp.input.ly) < c.escapeair_deadzone_y) {
    fp.selfVel.x = 0; fp.selfVel.y = 0;
  } else {
    const angle = Math.atan2(fp.input.ly, fp.input.lx);
    fp.selfVel.x = f(c.escapeair_force * Math.cos(angle));
    fp.selfVel.y = f(c.escapeair_force * Math.sin(angle));
  }
  fp.cmdVars[0] = 0;
  fp.mv.eaTimer = timer;
  e.changeMotion(MS.EscapeAir, MF.None, 0, 1);
  e.animStep();
}

// ============================================================================ collision callbacks
/** ft_80084280 (Wait, Walk, Landing): stop at edges when facing them, otherwise fall off. */
export function collTeeter(e: Engine): void {
  const fp = e.fighter;
  if (groundCollision(fp, e.stage, e.moveStart, EdgeMode.Teeter)) return;
  if (fp.envFlags & ENV.Edge) {
    // The game enters Ottotto (teeter), which is not in v1: hold still at the edge instead.
    fp.grVel = 0; fp.selfVel.x = 0; fp.selfVel.y = 0;
    return;
  }
  fallEnter(e);
}

/** ft_800844EC / ft_80083F88: run off edges. */
export function collFallOff(e: Engine): void {
  if (!groundCollision(e.fighter, e.stage, e.moveStart, EdgeMode.Fall)) fallEnter(e);
}

/** ft_80084104: attacks and dodges stop at an edge instead of running off it. */
export function collStop(e: Engine): void {
  if (!groundCollision(e.fighter, e.stage, e.moveStart, EdgeMode.Stop)) fallEnter(e);
}

/** ftCo_80096CC8: platforms are solid unless the stick is held down. */
const acceptPlatform = (e: Engine) => () => e.fighter.input.ly > e.c.fall_platform_pass_threshold;

/**
 * Air collision that lands with `land`. States that can catch ledges (ft_800831CC, ft_800835B0,
 * ft_80083090, ft_80082F28 ...) look for one when they didn't land.
 */
export function collAirLand(e: Engine, land: (e: Engine) => void, platformCallback = true, ledge: LedgeDir | null = null): void {
  if (airCollision(e.fighter, e.stage, e.moveStart, platformCallback ? acceptPlatform(e) : null)) land(e);
  else if (ledge) ledgeCatchCheck(e, ledge);
}

// ============================================================================ states
def({
  id: MS.Wait, name: 'Wait', move: 'Wait1_0',
  anim(e) {
    // ftCo_8008A7A8: restart the idle animation (the game may pick Wait2 at random; v1 keeps Wait1
    // so the engine stays deterministic).
    if (!e.isFramesRemaining()) {
      const fp = e.fighter;
      fp.animFrame = 0; fp.animFirst = true; fp.animDone = false;
      fp.script.move = fp.move; fp.script.pc = 0; fp.script.timer = 0; fp.script.loopStack.length = 0; fp.script.callStack.length = 0;
      fp.animRate = 1;
      e.animStep();
    }
  },
  iasa: groundIasa,
  phys(e) { groundFriction(e.fighter, e.a, e.c); },
  coll: collTeeter,
});

for (const [id, name] of [[MS.WalkSlow, 'WalkSlow'], [MS.WalkMiddle, 'WalkMiddle'], [MS.WalkFast, 'WalkFast']] as const) {
  def({
    id, name, move: name,
    anim(e) {
      // ftWalkCommon_800DFDDC: animation speed follows ground speed.
      const fp = e.fighter;
      const v = fp.grVel;
      let rate = 0;
      if (v * fp.facing > 0) {
        const t = fp.motionId - MS.WalkSlow;
        rate = f(abs(v) / (t === 0 ? fp.mv.walkSlowRate : t === 1 ? fp.mv.walkMiddleRate : fp.mv.walkFastRate));
      }
      e.setAnimRate(rate);
    },
    iasa(e) {
      const fp = e.fighter;
      if (catchCheck(e) || specialSCheck(e) || specialHiCheck(e) || specialNCheck(e) || specialLwCheck(e)) return;
      if (attacksS4ToLw3(e) || attack1Check(e) || guardCheck(e) || appealCheck(e)) return;
      if (jumpCheck(e) || dashCheck(e) || squatCheck(e)) return;
      // ft_8008A244: back to Wait when the stick lets go or points back.
      if (fp.input.lx * fp.facing < 0 || abs(fp.input.lx) < e.c.walk_stick_threshold) { waitEnter(e); return; }
      // ftWalkCommon_800DFEC8: change walk speed, keeping the phase of the step.
      const type = walkType(e, fp.mv.walkAccelMul);
      if (MS.WalkSlow + type !== fp.motionId) {
        const target = type === 0 ? fp.mv.walkSlowFrame : type === 1 ? fp.mv.walkMiddleFrame : fp.mv.walkFastFrame;
        const end = e.animEndFrame();
        const q = Math.trunc(fp.animFrame / end);
        const phase = f(fp.animFrame - end * q);
        walkEnter(e, Math.trunc(target * (phase / end)));
      }
    },
    phys(e) {
      // ftWalkCommon_800E0060.
      const fp = e.fighter, a = e.a, c = e.c;
      const mul = fp.mv.walkAccelMul;
      let accel = f(fp.input.lx * a.walk_accel_mul * mul);
      accel = f(accel + (fp.input.lx > 0 ? mul * a.walk_accel_base : mul * -a.walk_accel_base));
      const target = f(fp.input.lx * a.walk_max_vel * mul);
      if (target) {
        const ratio = fp.grVel / target;
        if (ratio > 0 && ratio < 1) accel = f(accel * f((1 - ratio) * c.walk_accel_taper));
      }
      fp.mv.walkX0 = f(target * c.walk_anim_speed_ratio);
      groundDashRun(fp, a, accel, target, a.ground_friction);
      selfFromGround(fp);
    },
    coll: collTeeter,
  });
}

def({
  id: MS.Turn, name: 'Turn', move: 'Turn',
  anim(e) {
    const fp = e.fighter;
    if (fp.mv.turnFrames > 0) fp.mv.turnFrames -= 1;
    else if (!fp.mv.turnHasTurned) { fp.mv.turnHasTurned = 1; fp.mv.turnJustTurned = 1; fp.facing = -fp.facing; }
    if (!e.isFramesRemaining()) waitEnter(e);
  },
  iasa(e) {
    const fp = e.fighter;
    if (fp.mv.turnJustTurned) fp.input.pressed |= fp.mv.turnBuffered;
    // Attacks out of a turn face the new way; the turn itself flips on its own frame.
    if (!fp.mv.turnHasTurned) fp.facing = -fp.facing;
    // UCF patches this temporary facing flip in IASA, before attacks, on frame two.
    if (!fp.mv.turnHasTurned && fp.animFrame === 2 && fp.input.lx * fp.facing >= e.c.dash_stick_threshold
        && fp.timers.lxTimer <= 1 && e.ucf.fastX()) {
      fp.mv.turnHasTurned = fp.mv.turnJustTurned = fp.mv.turnX8 = 1;
    }
    if (specialSCheck(e) || specialLwCheck(e) || specialHiCheck(e) || catchCheck(e) || attacksS4ToLw3(e) || attack1Check(e)) return;
    if (!fp.mv.turnHasTurned) fp.facing = -fp.facing;
    if (guardCheck(e) || appealCheck(e) || jumpCheck(e)) return;
    // fn_800C9C2C: a smash input toward the new direction during the turn makes it a dash turn.
    if (fp.input.lx * fp.mv.turnFacingAfter >= e.c.dash_stick_threshold && fp.timers.lxTimer < e.c.dash_stick_window) fp.mv.turnX8 = fp.mv.turnFacingAfter;
    if (fp.mv.turnJustTurned && fp.mv.turnX8 && fp.input.lx * fp.mv.turnFacingAfter >= e.c.dash_stick_threshold) { dashEnter(e, 0); return; }
    if (fp.input.pressed & BTN.A) fp.mv.turnBuffered |= BTN.A;
    if (fp.input.pressed & BTN.B) fp.mv.turnBuffered |= BTN.B;
    if (fp.mv.turnJustTurned) fp.mv.turnJustTurned = 0;
  },
  phys(e) { groundFriction(e.fighter, e.a, e.c); },
  coll: collFallOff,
});

def({
  id: MS.Dash, name: 'Dash', move: 'Dash',
  anim(e) { if (!e.isFramesRemaining()) waitEnter(e); },
  iasa(e) {
    const fp = e.fighter, c = e.c;
    const frame = fp.animFrame;
    // ftCo_Dash_IASA. Whatever the dash turns into (except a grab, dash attack or run), this dash's
    // leftover speed is cut afterwards; that is what makes dash dancing work.
    const block42 = (): boolean => {
      if (appealCheck(e)) return true;
      if (relaxedJumpCheck(e)) return false;
      if (!fp.cmdVars[0]) return false;
      if (fp.input.lx * fp.facing >= c.run_stick_threshold) runEnter(e, 0);
      return false;
    };
    let applyFriction: boolean;
    if (fp.mv.dashX4 && frame <= c.dash_iasa_frames_a) {
      if (specialSCheck(e)) applyFriction = true;
      else if (dashCatchCheck(e)) return;
      else if (attackS4DashCheck(e) || (frame <= c.dash_iasa_frames_b && dashRollCheck(e))) applyFriction = true;
      else applyFriction = block42();
    } else if (frame <= c.dash_iasa_frames_c) {
      if (specialSCheck(e)) applyFriction = true;
      else if (dashCatchCheck(e) || attackDashCheck(e)) return;
      else if ((fp.input.lx * fp.facing < 0 && dashCheck(e)) || guardCheck(e)) applyFriction = true;
      else applyFriction = block42();
    } else {
      if (dashCatchCheck(e)) return;
      if (dashCheck(e) || guardFromRunCheck(e)) applyFriction = true;
      else applyFriction = block42();
    }
    if (applyFriction) fp.grVel = f(fp.grVel + -f(fp.grVel * c.dash_reverse_friction) * 1);
  },
  phys(e) {
    const fp = e.fighter, a = e.a, c = e.c;
    if (fp.mv.dashX0) fp.mv.dashX0 = 0;
    else {
      const accel = f(fp.input.lx * a.dash_accel_mul + (fp.input.lx > 0 ? a.dash_accel_base : -a.dash_accel_base));
      groundDashRun(fp, a, accel, f(fp.input.lx * a.dash_max_velocity), f(a.ground_friction * c.run_dash_turn_friction_multiplier));
    }
    selfFromGround(fp);
  },
  coll: collFallOff,
});

def({
  id: MS.Run, name: 'Run', move: 'Run',
  anim(e) {
    const fp = e.fighter;
    const v = fp.grVel;
    e.setAnimRate(v * fp.facing <= 0 ? 0 : f(abs(v) / e.a.run_animation_scaling));
    if (fp.mv.runX0 > 0) fp.mv.runX0 -= 1;
  },
  iasa(e) {
    const fp = e.fighter, c = e.c;
    if (specialSCheck(e) || specialHiCheck(e) || specialNCheck(e) || specialLwCheck(e) || dashCatchCheck(e) || attackDashCheck(e)) return;
    if (guardFromRunCheck(e) || appealCheck(e)) return;
    if (relaxedJumpCheck(e)) return;
    if (fp.mv.runX0 <= 0 && fp.input.lx * fp.facing <= c.turnrun_stick_threshold) { turnRunEnter(e, 0); return; }
    if (!(fp.mv.runX0 <= 0)) return;
    if (abs(fp.input.lx) < c.run_stick_threshold) runBrakeEnter(e);
  },
  phys(e) {
    const fp = e.fighter, a = e.a, c = e.c;
    let accel = f(fp.input.lx * a.dash_accel_mul + (fp.input.lx > 0 ? a.dash_accel_base : -a.dash_accel_base));
    const target = f(fp.input.lx * a.dash_max_velocity);
    if (target) {
      const r = fp.grVel / target;
      if (r > 0 && r < 1) accel = f(accel * f((1 - r) * c.run_accel_taper));
    }
    fp.mv.runX4 = f(target * c.walk_anim_speed_ratio);
    groundDashRun(fp, a, accel, target, f(a.ground_friction * c.run_dash_turn_friction_multiplier));
    selfFromGround(fp);
  },
  coll: collFallOff,
});

def({
  id: MS.RunBrake, name: 'RunBrake', move: 'RunBrake',
  anim(e) {
    const fp = e.fighter, c = e.c;
    if (fp.cmdVars[1]) {
      if (!fp.mv.brakeX0) { if (abs(fp.grVel) >= c.runbrake_anim_speed_threshold) { e.setAnimRate(0); fp.mv.brakeX0 = 1; } }
      else if (abs(fp.grVel) <= c.runbrake_anim_speed_threshold) { e.setAnimRate(1); fp.cmdVars[1] = 0; }
    }
    if (fp.mv.brakeFrames) { fp.mv.brakeFrames -= 1; if (fp.mv.brakeFrames < 0) fp.mv.brakeFrames = 0; }
    if (!(e.isFramesRemaining() && fp.mv.brakeFrames)) waitEnter(e);
  },
  iasa(e) {
    const fp = e.fighter;
    if (relaxedJumpCheck(e)) return;
    if (fp.cmdVars[0] && fp.input.lx * fp.facing <= e.c.turnrun_stick_threshold) { turnRunEnter(e, fp.animFrame); return; }
    squatCheck(e);
  },
  phys(e) {
    const fp = e.fighter;
    groundDeaccel(fp, f(e.c.run_dash_turn_friction_multiplier * e.a.ground_friction));
    selfFromGround(fp);
  },
  coll: collTeeter,
});

def({
  id: MS.TurnRun, name: 'TurnRun', move: 'TurnRun',
  anim(e) {
    const fp = e.fighter;
    if (fp.cmdVars[1]) {
      if (!fp.mv.turnRunX14) { e.setAnimRate(0); fp.mv.turnRunX14 = 1; }
      else if (fp.mv.turnRunDir * fp.grVel <= 0.01) { e.setAnimRate(1); fp.cmdVars[1] = 0; fp.facing = -fp.facing; }
    }
    if (!e.isFramesRemaining()) {
      // fn_800CA644: keep running the other way, or stop.
      if (fp.input.lx * fp.facing >= e.c.run_stick_threshold) runEnter(e, e.c.run_start_frame_from_turnrun);
      else waitEnter(e);
    }
  },
  iasa(e) { relaxedJumpCheck(e); },
  phys(e) {
    const fp = e.fighter, a = e.a, c = e.c;
    const accel0 = f(fp.input.lx * a.dash_accel_mul + (fp.input.lx > 0 ? a.dash_accel_base : -a.dash_accel_base));
    const target = f(fp.input.lx * a.dash_max_velocity);
    const fr = f(a.ground_friction * c.run_dash_turn_friction_multiplier);
    let accel = accel0;
    if (!target) groundDeaccel(fp, fr);
    else if (fp.mv.turnRunDir * accel < 0) {
      if (accel > 0) {
        if (f(fp.grVel + accel) > target) { accel = f(accel - fr); if (f(fp.grVel + accel) < target) accel = f(target - fp.grVel); }
      } else if (f(fp.grVel + accel) < target) { accel = f(accel + fr); if (f(fp.grVel + accel) > target) accel = f(target - fp.grVel); }
      fp.grAccel1 = accel;
    } else groundDeaccel(fp, fr);
    selfFromGround(fp);
  },
  coll(e) { groundCollision(e.fighter, e.stage, e.moveStart, EdgeMode.Stop) || fallEnter(e); },
});

def({
  id: MS.KneeBend, name: 'KneeBend', move: 'Kneebend',
  anim(e) {
    const fp = e.fighter;
    if (fp.animFrame >= e.a.jump_startup_time || !e.isFramesRemaining()) jumpEnter(e);
  },
  iasa(e) {
    const fp = e.fighter, c = e.c;
    // ftCo_KneeBend_IASA: up B, a grab or an up smash straight out of jump squat.
    if (specialHiCheck(e) || catchCheck(e) || attackHi4Check(e, false)) return;
    const inp = fp.mv.jumpInput;
    if ((!(fp.input.held & (BTN.X | BTN.Y)) && inp === 2) || (fp.input.ly < c.short_hop_release_threshold && inp === 1) ||
      (fp.input.cy < c.short_hop_release_threshold && inp === 3)) fp.mv.shortHop = 1;
  },
  phys(e) { groundFriction(e.fighter, e.a, e.c); },
  coll: collFallOff,
});

for (const [id, name] of [[MS.JumpF, 'JumpF'], [MS.JumpB, 'JumpB']] as const) {
  def({
    id, name, move: name,
    anim(e) { if (!e.isFramesRemaining()) fallEnter(e); },
    iasa(e) { airIasa(e); },
    phys(e) {
      const fp = e.fighter;
      if (!fp.mv.jumpX4) { fp.mv.jumpX4 = 1; return; } // no gravity on the take-off frame
      airPhysics(fp, e.a, e.c, (id) => e.playSound(id));
    },
    coll(e) { collAirLand(e, landFromAir, true, 'facing'); },
  });
}

for (const [id, name] of [[MS.JumpAerialF, 'JumpAerialF'], [MS.JumpAerialB, 'JumpAerialB']] as const) {
  def({
    id, name, move: name,
    anim(e) { if (!e.isFramesRemaining()) fallAerialEnter(e); },
    iasa(e) { airIasa(e); },
    phys(e) { airPhysics(e.fighter, e.a, e.c, (id) => e.playSound(id)); },
    coll(e) { collAirLand(e, landFromAir, true, 'facing'); },
  });
}

def({
  id: MS.Fall, name: 'Fall', move: 'Fall',
  iasa(e) { airIasa(e); },
  phys(e) { airPhysics(e.fighter, e.a, e.c, (id) => e.playSound(id)); },
  coll(e) { collAirLand(e, landFromAir, true, 'facing'); },
});

def({
  id: MS.FallAerial, name: 'FallAerial', move: 'FallAerial',
  iasa(e) { airIasa(e); },
  phys(e) { airPhysics(e.fighter, e.a, e.c, (id) => e.playSound(id)); },
  coll(e) { collAirLand(e, landFromAir, true, 'facing'); },
});

def({
  id: MS.FallSpecial, name: 'FallSpecial', move: 'FallSpecial',
  iasa(e) { airJumpCheck(e); },
  phys(e) {
    const fp = e.fighter, a = e.a, c = e.c;
    checkFallFast(fp, c, (id) => e.playSound(id));
    if (fp.fallFast) fallFast(fp, a);
    else fall(fp, a.gravity, fp.mv.fsXC ? a.terminal_velocity : a.fast_fall_velocity);
    const lsx = fp.input.lx;
    const drift = f(lsx * a.air_drift_stick_mul + (lsx > 0 ? a.aerial_drift_base : -a.aerial_drift_base));
    let target = f(lsx * a.air_drift_max);
    if (!fp.mv.fsXC && abs(target) > fp.mv.fsMobility) target = target < 0 ? -fp.mv.fsMobility : fp.mv.fsMobility;
    selfAccelToVelClamped(fp, a, fp.selfVel.x, drift, target, a.aerial_friction);
  },
  coll(e) {
    collAirLand(e, (e2) => {
      const fp = e2.fighter;
      if (fp.mv.fsX10 || fp.selfVel.y < -e2.c.landing_speed_threshold) landingFallSpecialEnter(e2, !!fp.mv.fsAllow, fp.mv.fsLag);
      else waitEnter(e2);
    }, true, 'facing');
  },
});

def({
  id: MS.Squat, name: 'Squat', move: 'Squat',
  anim(e) { if (!e.isFramesRemaining()) squatWaitEnter(e, MF.SkipNametagVis); },
  iasa(e) {
    const fp = e.fighter;
    if (groundAttacks(e) || guardCheck(e) || appealCheck(e) || jumpCheck(e) || passCheck(e)) return;
    if (fp.mv.passArmed && fp.mv.passTimer) {
      fp.mv.passTimer -= 1;
      if (!fp.mv.passTimer && isOnPlatform(fp)) passEnter(e);
    }
  },
  phys(e) { groundFriction(e.fighter, e.a, e.c); },
  coll: collFallOff,
});

def({
  id: MS.SquatWait, name: 'SquatWait', move: 'SquatWait',
  anim(e) {
    if (!e.isFramesRemaining()) { const fp = e.fighter; fp.animFrame = 0; fp.animFirst = true; fp.animDone = false; e.animStep(); }
  },
  iasa(e) {
    if (specialLwCheck(e) || specialHiCheck(e) || attacksS4ToLw3(e) || attack1Check(e) || guardCheck(e) || appealCheck(e)) return;
    if (jumpCheck(e) || passCheck(e) || dashCheck(e)) return;
    const fp = e.fighter;
    // UCF DBOOC: keep the rim's transient uncrouch poll inside crouch for this one frame.
    const release = e.ucf.enabled && fp.timers.lxTimer < 1 && atStickRim(fp.input.lx, fp.input.ly)
      ? f(0.59) : e.c.squat_release_threshold;
    if (fp.input.ly > -release) e.changeMotion(MS.SquatRv, MF.None, 0, 1);
  },
  phys(e) { groundFriction(e.fighter, e.a, e.c); },
  coll: collFallOff,
});

def({
  id: MS.SquatRv, name: 'SquatRv', move: 'SquatRv',
  anim(e) { if (!e.isFramesRemaining()) waitEnter(e); },
  iasa(e) {
    if (specialLwCheck(e) || specialHiCheck(e) || attacksS4ToLw3(e) || attack1Check(e) || guardCheck(e) || appealCheck(e)) return;
    if (jumpCheck(e)) return;
    walkCheck(e);
  },
  phys(e) { groundFriction(e.fighter, e.a, e.c); },
  coll: collFallOff,
});

function landingIasa(e: Engine): void {
  const fp = e.fighter;
  if (fp.animFrame < e.a.normal_landing_lag) return;
  if (!fp.mv.landingAllow) return;
  if (groundAttacks(e) || guardCheck(e) || appealCheck(e)) return;
  if (jumpCheck(e)) return;
  if (dashCheck(e)) return;
  if (fp.animFrame < fp.animRate + e.a.normal_landing_lag && squatCheck(e)) return;
  if (turnCheck(e)) return;
  walkCheck(e);
}

def({
  id: MS.Landing, name: 'Landing', move: 'Landing',
  anim(e) { if (!e.isFramesRemaining()) waitEnter(e); },
  iasa: landingIasa,
  phys(e) { groundFriction(e.fighter, e.a, e.c); },
  coll: collTeeter,
});

def({
  id: MS.LandingFallSpecial, name: 'LandingFallSpecial', move: 'LandingFallSpecial',
  anim(e) { if (!e.isFramesRemaining()) waitEnter(e); },
  iasa: landingIasa,
  phys(e) { groundFriction(e.fighter, e.a, e.c); },
  coll: collTeeter,
});

const AIR_NAMES = ['AttackAirN', 'AttackAirF', 'AttackAirB', 'AttackAirHi', 'AttackAirLw'];
AERIALS.forEach((id, i) => {
  def({
    id, name: AIR_NAMES[i], move: AIR_NAMES[i],
    anim(e) {
      const fp = e.fighter;
      if (fp.throwFlags & (1 << 3)) { fp.throwFlags &= ~(1 << 3); fp.facing = -fp.facing; }
      if (!e.isFramesRemaining()) fallEnter(e);
    },
    iasa(e) {
      if (!e.fighter.allowInterrupt) return;
      if (aerialCheck(e)) return;
      airJumpCheck(e);
    },
    phys(e) { airPhysics(e.fighter, e.a, e.c, (id) => e.playSound(id)); },
    coll(e) { collAirLand(e, landingAirEnterWithLag, false); },
  });
  def({
    id: MS.LandingAirN + i, name: 'Landing' + AIR_NAMES[i].slice(6), move: 'Landing' + AIR_NAMES[i].slice(6),
    anim(e) { if (!e.isFramesRemaining()) waitEnter(e); },
    phys(e) { groundFriction(e.fighter, e.a, e.c); },
    coll: collTeeter,
  });
});

def({
  id: MS.EscapeAir, name: 'EscapeAir', move: 'EscapeAir',
  anim(e) { if (!e.isFramesRemaining()) fallSpecialEnter(e, 1, 1, false, e.c.escapeair_fallspecial_mobility, e.c.escapeair_landing_lag); },
  iasa(e) { const fp = e.fighter; if (fp.mv.eaTimer) fp.mv.eaTimer -= 1; },
  phys(e) {
    const fp = e.fighter, c = e.c;
    if (!fp.cmdVars[0]) { fp.selfVel.x = f(fp.selfVel.x * c.escapeair_decay); fp.selfVel.y = f(fp.selfVel.y * c.escapeair_decay); }
    else airPhysics(fp, e.a, c, (id) => e.playSound(id));
  },
  coll(e) { collAirLand(e, (e2) => landingFallSpecialEnter(e2, false, e2.c.escapeair_landing_lag), false); },
});

def({
  id: MS.Pass, name: 'Pass', move: 'Pass',
  anim(e) { if (!e.isFramesRemaining()) fallEnter(e); },
  iasa(e) { airIasa(e); },
  phys(e) { airPhysics(e.fighter, e.a, e.c, (id) => e.playSound(id)); },
  coll(e) { collAirLand(e, landFromAir, false, 'facing'); },
});
