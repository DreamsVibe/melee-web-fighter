// Ground attacks, shield, rolls, spot dodge, grabs and taunts, ported from the decomp's
// ft/kinds/ftCommon: ftCo_Attack1.c (jabs), ftCo_Attack100.c (rapid jab, special inputs),
// ftCo_AttackDash.c, ftCo_AttackS3/Hi3/Lw3.c (tilts), ftCo_AttackS4/Hi4/Lw4.c (smashes),
// ftCo_Guard.c, ftCo_Escape.c, ftCo_Catch.c, ftCo_AppealS.c. Every character has these; what a move
// does comes from its .move file. Shared checks (the *_CheckInput functions) live here too, so each
// state can list its interrupts in the game's order.
import type { Engine } from './engine';
import { MF, PAD_LR } from './engine';
import { BTN } from './pad';
import { def, MS } from './statedefs';
import { groundAttackPhysics, groundFriction, groundRootMotion, groundDeaccel, selfFromGround } from './physics';
import {
  collFallOff, collStop, dashCheck, jumpCheck, kneeBendEnter, passEnter, passInput, squatCheck,
  squatWaitEnter, turnCheck, waitEnter, walkCheck,
} from './states';

const f = Math.fround;
const abs = Math.abs;

const hasAnim = (e: Engine, move: string) => !!e.data.moves.get(move)?.anim;
const lstickAngle = (e: Engine) => Math.atan2(e.fighter.input.ly, abs(e.fighter.input.lx));
const cstickAngle = (e: Engine) => Math.atan2(e.fighter.input.cy, abs(e.fighter.input.cx));

// ============================================================================ specials (ground)
/** ftCo_SpecialS_CheckInput: side B, turning first when the stick points back. */
export function specialSCheck(e: Engine): boolean {
  const fp = e.fighter;
  if (!e.specials.groundS || fp.counters.sideB !== 0) return false;
  if (fp.input.lx * fp.facing < -e.c.special_s_turn_threshold) fp.facing = fp.input.lx >= 0 ? 1 : -1;
  fp.grVel = f(fp.grVel + -f(fp.grVel * f(1 - e.a.specials_ground_speed_retention)));
  e.specials.groundS(e);
  return true;
}

/** ftCo_Attack100_CheckInput (the game's name for it): up B. */
export function specialHiCheck(e: Engine): boolean {
  if (!e.specials.groundHi || e.fighter.counters.upB !== 0) return false;
  e.specials.groundHi(e);
  return true;
}

/** ftCo_800D6824: neutral B. */
export function specialNCheck(e: Engine): boolean {
  if (!e.specials.groundN || e.fighter.counters.neutralB !== 0) return false;
  e.specials.groundN(e);
  return true;
}

/** ftCo_800D68C0: down B. */
export function specialLwCheck(e: Engine): boolean {
  if (!e.specials.groundLw || e.fighter.counters.downB !== 0) return false;
  e.specials.groundLw(e);
  return true;
}

/** ftCo_SpecialAir_CheckInput: B in the air picks up, down, side or neutral B (with the B-reverse). */
export function specialAirCheck(e: Engine): boolean {
  const fp = e.fighter, c = e.c, i = fp.input;
  if (!(i.pressed & BTN.B)) return false;
  if (i.ly >= c.special_lw_threshold) {
    if (!e.specials.airHi) return false;
    e.specials.airHi(e);
    return true;
  }
  if (i.ly <= -c.special_lw_threshold) {
    if (!e.specials.airLw) return false;
    e.specials.airLw(e);
    return true;
  }
  if (abs(i.lx) >= c.special_s_threshold) {
    if (!e.specials.airS) return false;
    if (i.lx * fp.facing < -c.special_s_turn_threshold) fp.facing = i.lx >= 0 ? 1 : -1;
    e.specials.airS(e);
    return true;
  }
  if (!e.specials.airN) return false;
  if (fp.timers.lxDuration < c.special_n_turn_window && ((fp.facing === -1 && fp.x2228_b7 === 1) || (fp.facing === 1 && fp.x2228_b7 === 0))) {
    fp.facing = -fp.facing;
  }
  e.specials.airN(e);
  return true;
}

// ============================================================================ taunts
/** ftCo_800DE9D8: D-pad up taunts, facing right or left (AppealSR/L). */
export function appealCheck(e: Engine): boolean {
  const fp = e.fighter;
  if (!(fp.input.pressed & BTN.DUP)) return false;
  fp.allowInterrupt = false;
  e.changeMotion(fp.facing === -1 && hasAnim(e, 'AppealSL') ? MS.AppealSL : MS.AppealSR, MF.None, 0, 1);
  return true;
}

/** A character's own taunt on D-pad down (ftFx_AppealS_CheckInput for Fox and Falco). */
export function charAppealCheck(e: Engine): boolean {
  if (!e.specials.appeal || !(e.fighter.input.pressed & BTN.DDOWN)) return false;
  e.specials.appeal(e);
  return true;
}

// ============================================================================ jabs
/** ftCo_Attack1_CheckInput: A starts a jab, or continues the combo within the jab window. */
export function attack1Check(e: Engine): boolean {
  const fp = e.fighter;
  if (fp.input.pressed & BTN.A) {
    if (!(fp.jabWindow > 0 && fp.jabCombo)) { attack11Enter(e); return true; }
    if (fp.jabLast === MS.Attack11) { attack12Enter(e); return true; }
    if (fp.jabLast === MS.Attack12) { attack13Enter(e); return true; }
  }
  if (fp.jabWindow > 0) fp.jabWindow -= 1;
  return false;
}

function attack11Enter(e: Engine): void {
  const fp = e.fighter;
  fp.allowInterrupt = false;
  fp.jabCombo = false;
  e.changeMotion(MS.Attack11, MF.None, 0, 1);
  e.animStep();
  fp.jabWindow = e.a.jab_2_input_window;
  fp.jabLast = MS.Attack11;
  fp.jabRapid = false;
  fp.mv.jabQueued = 0;
  fp.jabPresses = 0;
}

function attack12Enter(e: Engine): void {
  const fp = e.fighter;
  fp.allowInterrupt = false;
  fp.jabCombo = false;
  e.changeMotion(MS.Attack12, MF.None, 0, 1);
  fp.jabWindow = e.a.jab_3_input_window;
  fp.jabLast = MS.Attack12;
  fp.mv.jabQueued = 0;
}

function attack13Enter(e: Engine): void {
  const fp = e.fighter;
  fp.allowInterrupt = false;
  fp.jabCombo = false;
  e.changeMotion(MS.Attack13, MF.None, 0, 1);
}

/** checkAttack12 / checkAttack13: A pressed during the window queues the next jab. */
function nextJabCheck(e: Engine, enter: (e: Engine) => void): boolean {
  const fp = e.fighter;
  if (fp.jabWindow > 0) {
    fp.jabWindow -= 1;
    if (fp.input.pressed & BTN.A) fp.mv.jabQueued = 1;
  }
  if (fp.mv.jabQueued && fp.jabCombo) { enter(e); return true; }
  return false;
}

/** ftCo_Attack_800D6A50: mashing A (presses and releases) turns the jab into a rapid jab. */
function rapidJabCheck(e: Engine): boolean {
  const fp = e.fighter;
  if ((fp.input.pressed & BTN.A) || (fp.input.released & BTN.A)) fp.jabPresses++;
  if (fp.jabPresses >= e.a.rapid_jab_window && fp.jabRapid) {
    fp.throwFlags = 0;
    e.changeMotion(MS.Attack100Start, MF.None, 0, 1);
    e.animStep();
    fp.mv.rapidLooped = 0;
    fp.mv.rapidMashed = 0;
    return true;
  }
  return false;
}

/** Tilts and smashes, in the order jabs and taunts check them. */
function attacksS4ToLw3(e: Engine): boolean {
  return attackS4Check(e) || attackHi4Check(e) || attackLw4Check(e) || attackS3Check(e) || attackHi3Check(e) || attackLw3Check(e);
}

function jabIasa(e: Engine, next: (e: Engine) => void): void {
  const fp = e.fighter;
  if (fp.allowInterrupt && attacksS4ToLw3(e)) return;
  if (rapidJabCheck(e)) return;
  if (nextJabCheck(e, next)) return;
  if (fp.allowInterrupt) {
    if (jumpCheck(e) || dashCheck(e) || squatCheck(e) || turnCheck(e)) return;
    walkCheck(e);
  }
}

const toWaitWhenDone = (e: Engine) => { if (!e.isFramesRemaining()) waitEnter(e); };
const attackPhys = (e: Engine) => groundAttackPhysics(e.fighter, e.a, e.c);
const frictionPhys = (e: Engine) => groundFriction(e.fighter, e.a, e.c);
/** ftCo_Wait_IASA once the move's script allows interrupts. */
const waitIasaWhenAllowed = (e: Engine) => { if (e.fighter.allowInterrupt) groundIasa(e); };

def({ id: MS.Attack11, name: 'Attack11', move: 'Attack11', anim: toWaitWhenDone, iasa: (e) => jabIasa(e, attack12Enter), phys: attackPhys, coll: collStop });
def({ id: MS.Attack12, name: 'Attack12', move: 'Attack12', anim: toWaitWhenDone, iasa: (e) => jabIasa(e, attack13Enter), phys: attackPhys, coll: collStop });
def({
  id: MS.Attack13, name: 'Attack13', move: 'Attack13', anim: toWaitWhenDone,
  iasa(e) { if (!rapidJabCheck(e)) waitIasaWhenAllowed(e); },
  phys: attackPhys, coll: collStop,
});
def({
  id: MS.Attack100Start, name: 'Attack100Start', move: 'Attack100Start',
  anim(e) { if (!e.isFramesRemaining()) e.changeMotion(MS.Attack100Loop, MF.None, 0, 1); },
  phys: attackPhys, coll: collStop,
});
def({
  id: MS.Attack100Loop, name: 'Attack100Loop', move: 'Attack100Loop',
  anim(e) {
    // Each pass through the loop the script raises throw flag b3; without A activity since the last
    // one, the rapid jab ends.
    const fp = e.fighter;
    // ft_800892A0: each pass through the loop is a new attack for staling.
    if (fp.animFrame >= 0 && fp.animFrame < fp.animRate) { fp.mv.rapidLooped = 1; e.renewAttack(); }
    if (fp.throwFlags & (1 << 3)) {
      fp.throwFlags &= ~(1 << 3);
      if (fp.mv.rapidLooped && !fp.mv.rapidMashed) e.changeMotion(MS.Attack100End, MF.None, 0, 1);
      else fp.mv.rapidMashed = 0;
    }
  },
  iasa(e) { const i = e.fighter.input; if ((i.pressed & BTN.A) || (i.released & BTN.A)) e.fighter.mv.rapidMashed = 1; },
  phys: attackPhys, coll: collStop,
});
def({ id: MS.Attack100End, name: 'Attack100End', move: 'Attack100End', anim: toWaitWhenDone, phys: attackPhys, coll: collStop });

// ============================================================================ dash attack
/** ftCo_AttackDash_CheckInput. */
function attackDashCheck(e: Engine): boolean {
  const fp = e.fighter;
  if (!(fp.input.pressed & BTN.A)) return false;
  fp.allowInterrupt = false;
  e.changeMotion(MS.AttackDash, MF.None, 0, 1);
  e.animStep();
  // ftCo_AttackDash_SetMv0: holding the shield early in the dash attack still grabs.
  fp.mv.dashGrabWindow = e.c.dash_grab_window;
  return true;
}

def({
  id: MS.AttackDash, name: 'AttackDash', move: 'AttackDash', anim: toWaitWhenDone,
  iasa(e) {
    const fp = e.fighter;
    // ftCo_800D8AE0: shield held within the window turns it into a dash grab.
    if ((fp.input.held & PAD_LR) && fp.mv.dashGrabWindow) { catchEnter(e, MS.CatchDash); return; }
    if (fp.mv.dashGrabWindow) fp.mv.dashGrabWindow -= 1;
    waitIasaWhenAllowed(e);
  },
  phys(e) { groundRootMotion(e.fighter, f(e.c.dash_attack_friction_mul * e.a.ground_friction), e.fighter.facing); },
  coll: collStop,
});

// ============================================================================ tilts
/** ftCo_AttackS3_CheckInput: forward tilt, angled up or down when the character has those. */
export function attackS3Check(e: Engine): boolean {
  const fp = e.fighter, c = e.c;
  if (!(fp.input.pressed & BTN.A) || fp.input.lx * fp.facing < c.ftilt_stick_threshold || abs(lstickAngle(e)) >= c.aerial_angle) return false;
  const a = lstickAngle(e);
  let msid: number = MS.AttackS3S;
  if (a > c.ftilt_angle_hi && hasAnim(e, 'AttackS3Hi')) msid = MS.AttackS3Hi;
  else if (a > c.ftilt_angle_his && hasAnim(e, 'AttackS3HiS')) msid = MS.AttackS3HiS;
  else if (a < c.ftilt_angle_lw && hasAnim(e, 'AttackS3Lw')) msid = MS.AttackS3Lw;
  else if (a < c.ftilt_angle_lws && hasAnim(e, 'AttackS3LwS')) msid = MS.AttackS3LwS;
  fp.allowInterrupt = false;
  e.changeMotion(msid, MF.None, 0, 1);
  e.animStep();
  return true;
}

/** ftCo_AttackHi3_CheckInput. */
export function attackHi3Check(e: Engine): boolean {
  const fp = e.fighter;
  if (!(fp.input.pressed & BTN.A) || fp.input.ly < e.c.utilt_stick_threshold || lstickAngle(e) <= e.c.aerial_angle) return false;
  fp.allowInterrupt = false;
  e.changeMotion(MS.AttackHi3, MF.None, 0, 1);
  e.animStep();
  return true;
}

function attackLw3Enter(e: Engine): void {
  const fp = e.fighter;
  fp.cmdVars[0] = 0;
  fp.allowInterrupt = false;
  fp.mv.lw3Again = 0;
  e.changeMotion(MS.AttackLw3, MF.None, 0, 1);
  // ftCo_AttackLw3 callUnk (x21EC): every down tilt, even a repeated one, is a new attack for staling.
  e.renewAttack();
  e.animStep();
}

/** ftCo_AttackLw3_CheckInput. */
export function attackLw3Check(e: Engine): boolean {
  const fp = e.fighter;
  if (!(fp.input.pressed & BTN.A) || fp.input.ly > e.c.dtilt_stick_threshold || lstickAngle(e) >= -e.c.aerial_angle) return false;
  attackLw3Enter(e);
  return true;
}

const S3: Array<[number, string, string]> = [
  [MS.AttackS3Hi, 'AttackS3Hi', 'AttackS3Hi'], [MS.AttackS3HiS, 'AttackS3HiS', 'AttackS3HiS'], [MS.AttackS3S, 'AttackS3S', 'AttackS3'],
  [MS.AttackS3LwS, 'AttackS3LwS', 'AttackS3LwS'], [MS.AttackS3Lw, 'AttackS3Lw', 'AttackS3Lw'], [MS.AttackHi3, 'AttackHi3', 'AttackHi3'],
];
for (const [id, name, move] of S3) def({ id, name, move, anim: toWaitWhenDone, iasa: waitIasaWhenAllowed, phys: frictionPhys, coll: collStop });

def({
  id: MS.AttackLw3, name: 'AttackLw3', move: 'AttackLw3',
  anim(e) {
    // The script opens a window (var 0) in which a buffered A restarts the down tilt.
    const fp = e.fighter;
    if (fp.cmdVars[0] && fp.mv.lw3Again) { attackLw3Enter(e); return; }
    if (!e.isFramesRemaining()) squatWaitEnter(e, MF.None);
  },
  iasa(e) {
    const fp = e.fighter;
    if (fp.allowInterrupt && (attackS4Check(e) || attackHi4Check(e) || attackLw4Check(e) || attackS3Check(e) || attackHi3Check(e))) return;
    if (fp.input.pressed & BTN.A) {
      if (fp.cmdVars[0]) { attackLw3Enter(e); return; }
      fp.mv.lw3Again = 1;
    }
    if (fp.allowInterrupt) {
      if (attackLw3Check(e) || attack1Check(e) || jumpCheck(e) || dashCheck(e)) return;
      // ftCo_Squat_CheckInput only looks: with the stick held down the down tilt plays out.
      if (fp.input.ly < -e.c.squat_threshold || turnCheck(e)) return;
      walkCheck(e);
    }
  },
  phys: frictionPhys, coll: collStop,
});

// ============================================================================ smashes
function attackS4Enter(e: Engine, sign: number, angle: number): void {
  const fp = e.fighter, c = e.c;
  fp.facing = sign;
  let msid: number = MS.AttackS4S;
  if (angle > c.fsmash_angle_hi && hasAnim(e, 'AttackS4Hi')) msid = MS.AttackS4Hi;
  else if (angle > c.fsmash_angle_his && hasAnim(e, 'AttackS4HiS')) msid = MS.AttackS4HiS;
  else if (angle < c.fsmash_angle_lw && hasAnim(e, 'AttackS4Lw')) msid = MS.AttackS4Lw;
  else if (angle < c.fsmash_angle_lws && hasAnim(e, 'AttackS4LwS')) msid = MS.AttackS4LwS;
  fp.allowInterrupt = false;
  fp.cmdVars[0] = 0;
  fp.throwFlags = 0;
  e.changeMotion(msid, MF.None, 0, 1);
  e.animStep();
}

/** ftCo_800DF1C8: the c-stick flicked sideways this frame. */
const cstickSide = (e: Engine) => abs(e.fighter.input.pcx) < e.c.dash_stick_threshold && abs(e.fighter.input.cx) >= e.c.dash_stick_threshold;

/** ftCo_AttackS4_CheckInput: A with a fresh sideways smash of the stick, or the c-stick. */
export function attackS4Check(e: Engine): boolean {
  const fp = e.fighter, c = e.c, i = fp.input;
  if ((i.pressed & BTN.A) && abs(i.lx) >= c.dash_stick_threshold && fp.timers.lxTimer < c.dash_stick_window) attackS4Enter(e, i.lx >= 0 ? 1 : -1, lstickAngle(e));
  else if (cstickSide(e)) attackS4Enter(e, i.cx >= 0 ? 1 : -1, cstickAngle(e));
  else return false;
  return true;
}

/** ftCo_AttackS4_8008C114: out of a dash the stick only has to point forward. */
function attackS4DashCheck(e: Engine): boolean {
  const fp = e.fighter, i = fp.input;
  if ((i.pressed & BTN.A) && i.lx * fp.facing >= e.c.dash_stick_threshold) attackS4Enter(e, fp.facing, lstickAngle(e));
  else if (cstickSide(e)) attackS4Enter(e, i.cx >= 0 ? 1 : -1, cstickAngle(e));
  else return false;
  return true;
}

function smashEnter(e: Engine, msid: number): true {
  e.fighter.allowInterrupt = false;
  e.changeMotion(msid, MF.None, 0, 1);
  e.animStep();
  return true;
}

/** ftCo_AttackHi4_CheckInput (window = false: ftCo_AttackHi4_CheckInputNoD0, used in jump squat). */
export function attackHi4Check(e: Engine, window = true): boolean {
  const fp = e.fighter, c = e.c, i = fp.input;
  const stick = (i.pressed & BTN.A) && i.ly >= c.usmash_stick_threshold && (!window || fp.timers.lyTimer < c.usmash_stick_window);
  const cstick = i.pcy < c.usmash_stick_threshold && i.cy >= c.usmash_stick_threshold;
  return stick || cstick ? smashEnter(e, MS.AttackHi4) : false;
}

/** ftCo_AttackLw4_CheckInput. */
export function attackLw4Check(e: Engine): boolean {
  const fp = e.fighter, c = e.c, i = fp.input;
  const stick = (i.pressed & BTN.A) && i.ly <= c.dsmash_stick_threshold && fp.timers.lyTimer < c.dsmash_stick_window;
  const cstick = i.pcy > c.dsmash_stick_threshold && i.cy <= c.dsmash_stick_threshold;
  return stick || cstick ? smashEnter(e, MS.AttackLw4) : false;
}

const S4: Array<[number, string, string]> = [
  [MS.AttackS4Hi, 'AttackS4Hi', 'AttackS4Hi'], [MS.AttackS4HiS, 'AttackS4HiS', 'AttackS4HiS'], [MS.AttackS4S, 'AttackS4S', 'AttackS4'],
  [MS.AttackS4LwS, 'AttackS4LwS', 'AttackS4LwS'], [MS.AttackS4Lw, 'AttackS4Lw', 'AttackS4Lw'],
];
for (const [id, name, move] of S4) {
  def({
    id, name, move, anim: toWaitWhenDone,
    iasa(e) {
      const fp = e.fighter;
      if (fp.allowInterrupt && (specialSCheck(e) || specialHiCheck(e) || specialNCheck(e) || specialLwCheck(e) || catchCheck(e))) return;
      if (!fp.allowInterrupt) return;
      if (attacksS4ToLw3(e) || attack1Check(e) || guardCheck(e) || appealCheck(e) || jumpCheck(e) || dashCheck(e) || squatCheck(e) || turnCheck(e)) return;
      walkCheck(e);
    },
    phys: attackPhys, coll: collStop,
  });
}
def({ id: MS.AttackHi4, name: 'AttackHi4', move: 'AttackHi4', anim: toWaitWhenDone, iasa: waitIasaWhenAllowed, phys: frictionPhys, coll: collStop });
def({ id: MS.AttackLw4, name: 'AttackLw4', move: 'AttackLw4', anim: toWaitWhenDone, iasa: waitIasaWhenAllowed, phys: frictionPhys, coll: collStop });

// ============================================================================ grabs
/** ftCo_800D8C54: a grab. With no one to catch it always whiffs and returns to Wait. */
function catchEnter(e: Engine, msid: number): void {
  const fp = e.fighter;
  fp.selfAccel.x = fp.selfAccel.y = 0;
  e.changeMotion(msid, MF.None, 0, 1);
}

/** ftCo_Catch_CheckInput: A while holding the shield (Z does both). */
export function catchCheck(e: Engine): boolean {
  const i = e.fighter.input;
  if (!((i.held & PAD_LR) && (i.pressed & BTN.A))) return false;
  catchEnter(e, MS.Catch);
  return true;
}

/** ftCo_800D8A38: the same out of a dash or run is a dash grab. */
export function dashCatchCheck(e: Engine): boolean {
  const i = e.fighter.input;
  if (!((i.held & PAD_LR) && (i.pressed & BTN.A))) return false;
  catchEnter(e, MS.CatchDash);
  return true;
}

def({
  id: MS.Catch, name: 'Catch', move: 'Catch', anim: toWaitWhenDone,
  phys(e) { const fp = e.fighter; groundDeaccel(fp, f(e.c.catch_friction_mul * e.a.ground_friction)); selfFromGround(fp); },
  coll: collStop,
});
def({
  id: MS.CatchDash, name: 'CatchDash', move: 'CatchDash', anim: toWaitWhenDone,
  phys(e) { groundRootMotion(e.fighter, f(e.c.catch_friction_mul * e.a.ground_friction), e.fighter.facing); },
  coll: collStop,
});

// ============================================================================ shield
/** Light shield amount from the analog trigger (ftCo_800921DC, ftCo_800925A4). */
function lightshield(e: Engine, fallback: number): number {
  const dz = e.c.shoulder_deadzone;
  const v = f((e.fighter.input.trigger - dz) / (1 - dz));
  return v < 0 ? fallback : v;
}

/** ftCo_80091A4C: a fresh digital press power-shields; a held shield raises it. */
export function guardCheck(e: Engine): boolean {
  const fp = e.fighter;
  if ((fp.input.pressed & (BTN.R | BTN.L)) && fp.timers.trigTimer < e.c.powershield_input_window) { guardReflectEnter(e, MF.None, 0); return true; }
  if (!((fp.input.held & PAD_LR) && fp.shieldHealth > 0)) return false;
  guardOnEnter(e);
  return true;
}

/** ftCo_800921DC: the shield comes up. */
function guardInit(e: Engine): void {
  const fp = e.fighter;
  fp.mv.guardFrames = 0;
  fp.mv.guardReleased = 0;
  fp.mv.guardMinHold = e.c.shield_min_hold_frames;
  fp.mv.guardGrabWindow = 0;
  fp.lightshield = lightshield(e, 0);
  fp.shielding = true;
  e.playSound(110);
}

/** ftCo_800924C0. */
function guardOnEnter(e: Engine): void {
  e.changeMotion(MS.GuardOn, MF.None, 0, 1);
  e.animStep();
  guardInit(e);
}

/**
 * ftCo_80093A50 (from standing) / ftCo_8009388C (early in GuardOn): the power shield. It reflects
 * for a few frames in the game; with nothing to reflect it is the shield coming up at once.
 */
function guardReflectEnter(e: Engine, flags: number, animStart: number): void {
  const fp = e.fighter;
  const fresh = fp.motionId !== MS.GuardOn;
  e.changeMotion(MS.GuardReflect, flags, animStart, 1);
  fp.timers.trigTimer = 0xfe;
  if (fresh) { e.animStep(); guardInit(e); } else fp.shielding = true;
}

/** ftCo_80092908: fully raised. */
function guardEnter(e: Engine): void {
  e.changeMotion(MS.Guard, MF.None, 0, 1);
  e.fighter.shielding = true;
}

function guardOffEnter(e: Engine): void {
  e.fighter.shielding = false;
  e.changeMotion(MS.GuardOff, MF.None, 0, 1);
  e.playSound(127);
}

/** ftCo_800925A4: the shield shrinks while held, faster at full press. Returns true when it breaks. */
function shieldDecay(e: Engine): boolean {
  const fp = e.fighter, c = e.c;
  if (!fp.shielding) return false;
  fp.lightshield = lightshield(e, fp.lightshield);
  fp.shieldHealth = f(fp.shieldHealth - c.shield_decay * (fp.lightshield * (c.shield_decay_full - c.shield_decay_light) + c.shield_decay_light));
  if (fp.shieldHealth < 0) {
    // A broken shield would stun the fighter (ShieldBreak states); here it just drops.
    fp.shieldHealth = 0;
    guardOffEnter(e);
    return true;
  }
  if (fp.mv.guardMinHold > 0) fp.mv.guardMinHold -= 1;
  return false;
}

/** Shield bubble radius in Melee units (ftCo_80091D58), for drawing. */
export function shieldRadius(e: Engine): number {
  const fp = e.fighter, c = e.c;
  const n1 = (fp.shieldHealth / c.shield_start_health) * (fp.lightshield * (c.shield_size_full - c.shield_size_light) + c.shield_size_light);
  return ((1 - c.shield_min_size) * n1 + c.shield_min_size) * e.a.initial_shield_size * e.data.modelScale;
}

/** Released and held long enough, the shield drops (inlineC0 in ftCo_Guard.c). */
function guardReleaseCheck(e: Engine): boolean {
  const fp = e.fighter;
  if (!(fp.input.held & PAD_LR)) fp.mv.guardReleased = 1;
  if ((fp.mv.guardReleased && !fp.mv.guardMinHold) || !fp.shielding) { guardOffEnter(e); return true; }
  return false;
}

/** ftCo_8009980C: spot dodge out of shield (stick or c-stick down). */
function spotdodgeCheck(e: Engine): boolean {
  const fp = e.fighter, c = e.c;
  if ((fp.input.ly <= c.spotdodge_stick_threshold && fp.timers.lyTimer < c.spotdodge_stick_window) || fp.input.cy <= c.spotdodge_stick_threshold) {
    escapeNEnter(e);
    return true;
  }
  return false;
}

/** ftCo_80099794: spot dodge from standing (shield held, stick tapped down). */
export function standSpotdodgeCheck(e: Engine): boolean {
  const fp = e.fighter, c = e.c;
  if ((fp.input.held & PAD_LR) && fp.input.ly <= c.spotdodge_stick_threshold && fp.timers.lyTimer < c.spotdodge_stick_window) {
    escapeNEnter(e);
    return true;
  }
  return false;
}

/** ftCo_8009917C: roll forward or back out of shield. */
function rollCheck(e: Engine): boolean {
  const fp = e.fighter, c = e.c;
  let x: number;
  if (abs(fp.input.lx) >= c.roll_stick_threshold && fp.timers.lxTimer < c.roll_stick_window) x = fp.input.lx;
  else if (abs(fp.input.cx) >= c.roll_stick_threshold) x = fp.input.cx;
  else return false;
  escapeEnter(e, x * fp.facing >= 0 ? MS.EscapeF : MS.EscapeB);
  return true;
}

/** ftCo_800CB024: jump out of shield (c-stick up counts too). */
function jumpOutOfShield(e: Engine): boolean {
  if (jumpCheck(e)) return true;
  if (e.fighter.input.cy >= e.c.tap_jump_threshold) { kneeBendEnter(e, 3); return true; }
  return false;
}

/** ftCo_8009A080: shield drop through a platform. */
function shieldDropCheck(e: Engine): boolean {
  if ((e.fighter.input.held & PAD_LR) && passInput(e)) { passEnter(e); return true; }
  return false;
}

function guardIasa(e: Engine, powershield: boolean): void {
  const fp = e.fighter, c = e.c;
  if (guardReleaseCheck(e)) return;
  // ftCo_80093694: a second press right after raising the shield still power-shields.
  if (powershield && fp.mv.guardFrames < c.powershield_input_window && (fp.input.pressed & (BTN.R | BTN.L)) && fp.timers.trigTimer < c.powershield_input_window) {
    guardReflectEnter(e, MF.KeepGfx, fp.animFrame);
    return;
  }
  if (spotdodgeCheck(e) || rollCheck(e)) return;
  // ftCo_800D8B9C: A in the dash-shield window is a dash grab.
  if ((fp.input.pressed & BTN.A) && fp.mv.guardGrabWindow) { catchEnter(e, MS.CatchDash); return; }
  if (fp.mv.guardGrabWindow) fp.mv.guardGrabWindow -= 1;
  if (catchCheck(e) || jumpOutOfShield(e)) return;
  shieldDropCheck(e);
}

/** GuardOn's timing (fp->x2E8): as long as the GuardOn animation, though that animation never plays. */
function raisingAnim(e: Engine): void {
  const fp = e.fighter;
  fp.mv.guardFrames += 1;
  if (!shieldDecay(e) && fp.mv.guardFrames >= (e.data.moves.get('GuardOn')?.anim?.frameCount ?? 8)) guardEnter(e);
}

def({ id: MS.GuardOn, name: 'GuardOn', move: 'Guard', poseOnly: true, anim: raisingAnim, iasa: (e) => guardIasa(e, true), phys: frictionPhys, coll: collFallOff });
def({ id: MS.GuardReflect, name: 'GuardReflect', move: 'Guard', poseOnly: true, anim: raisingAnim, iasa: (e) => guardIasa(e, false), phys: frictionPhys, coll: collFallOff });
def({
  id: MS.Guard, name: 'Guard', move: 'Guard', poseOnly: true,
  anim(e) { e.fighter.mv.guardFrames += 1; shieldDecay(e); },
  iasa(e) {
    if (guardReleaseCheck(e)) return;
    if (spotdodgeCheck(e) || rollCheck(e) || catchCheck(e) || jumpOutOfShield(e)) return;
    shieldDropCheck(e);
  },
  phys: frictionPhys, coll: collFallOff,
});
def({
  id: MS.GuardOff, name: 'GuardOff', move: 'GuardOff', anim: toWaitWhenDone,
  iasa(e) { if (!spotdodgeCheck(e)) jumpOutOfShield(e); },
  phys: frictionPhys, coll: collFallOff,
});

/** From a dash or run: shield, and allow a dash grab for a few frames (ftCo_80091B9C). */
export function guardFromRunCheck(e: Engine): boolean {
  if (!guardCheck(e)) return false;
  e.fighter.mv.guardGrabWindow = e.c.dash_grab_window;
  return true;
}

// ============================================================================ rolls and spot dodge
/** ftCo_80099314. */
function escapeEnter(e: Engine, msid: number): void {
  const fp = e.fighter;
  fp.throwFlags = 0;
  e.changeMotion(msid, MF.None, 0, 1);
  e.animStep();
}

/** ftCo_80099264: roll forward out of a dash when the shield is held. */
export function dashRollCheck(e: Engine): boolean {
  if (!(e.fighter.input.held & PAD_LR)) return false;
  escapeEnter(e, MS.EscapeF);
  return true;
}

function escapeNEnter(e: Engine): void {
  e.changeMotion(MS.EscapeN, MF.None, 0, 1);
  e.animStep();
}

for (const [id, name] of [[MS.EscapeF, 'EscapeF'], [MS.EscapeB, 'EscapeB']] as const) {
  def({
    id, name, move: name,
    anim(e) {
      const fp = e.fighter;
      // The script flips the fighter partway through a back roll (throw flag b3).
      if (fp.throwFlags & (1 << 3)) { fp.throwFlags &= ~(1 << 3); fp.facing = -fp.facing; }
      if (!e.isFramesRemaining()) { fp.grVel = 0; waitEnter(e); }
    },
    phys(e) { groundRootMotion(e.fighter, e.a.ground_friction, e.fighter.facing1); },
    coll: collStop,
  });
}
def({ id: MS.EscapeN, name: 'EscapeN', move: 'EscapeN', anim: toWaitWhenDone, phys: frictionPhys, coll: collStop });

// ============================================================================ taunt
for (const [id, name] of [[MS.AppealSR, 'AppealSR'], [MS.AppealSL, 'AppealSL']] as const) {
  def({
    id, name, move: name, anim: toWaitWhenDone,
    iasa(e) {
      if (!e.fighter.allowInterrupt) return;
      if (specialSCheck(e) || specialHiCheck(e) || specialNCheck(e) || specialLwCheck(e) || catchCheck(e)) return;
      if (attacksS4ToLw3(e) || attack1Check(e) || standSpotdodgeCheck(e)) return;
      guardCheck(e);
    },
    phys: attackPhys, coll: collStop,
  });
}

// ============================================================================ the standing interrupt list
/** ftCo_Wait_IASA: everything a standing fighter can do, in the game's order. */
export function groundIasa(e: Engine): void {
  if (specialSCheck(e) || specialHiCheck(e) || specialNCheck(e) || specialLwCheck(e) || catchCheck(e)) return;
  if (attacksS4ToLw3(e) || attack1Check(e)) return;
  if (standSpotdodgeCheck(e) || guardCheck(e) || charAppealCheck(e) || appealCheck(e)) return;
  if (jumpCheck(e) || dashCheck(e) || squatCheck(e) || turnCheck(e)) return;
  walkCheck(e);
}

export { attackDashCheck, attackS4DashCheck, attacksS4ToLw3 };
