// Ledges ("cliffs"), ported from ft/ftcliffcommon.c and ft/kinds/ftCommon/ftCo_CliffWait.c,
// ftCo_CliffClimb.c, ftCo_CliffAttack.c, ftCo_CliffEscape.c and ftCo_CliffJump.c. A fighter falling
// past a ledge while facing it catches it (the air collision's ledge check, ftCliffCommon_80081298),
// hangs with a moment of intangibility, then climbs up, attacks, rolls or jumps (quick below the
// percent threshold, slow above it), or lets go by pushing away or down. Hanging too long drops it
// into a tumble. The ledge animations carry the fighter by root motion (TransN) from the ledge corner.
import type { Engine } from './engine';
import { MF, PAD_LR } from './engine';
import { BTN } from './pad';
import { GA } from './types';
import type { Segment } from './stagetypes';
import { def } from './statedefs';
import { airCollision, findLedge, ledgePoint } from './collision';
import { airPhysics, groundAttackPhysics } from './physics';
import { collStop, fallEnter, landFromAir, waitEnter } from './states';
import { damageFallEnter } from './damage';

/** ftCo_MS_Cliff*. */
export const CLIFF = {
  Catch: 252, Wait: 253, ClimbSlow: 254, ClimbQuick: 255, AttackSlow: 256, AttackQuick: 257,
  EscapeSlow: 258, EscapeQuick: 259, JumpSlow1: 260, JumpSlow2: 261, JumpQuick1: 262, JumpQuick2: 263,
} as const;

const f = Math.fround;
const abs = Math.abs;

/** Which way an air state looks for ledges: the way the fighter faces, or both (CLIFFCATCH_BOTH). */
export type LedgeDir = 'facing' | 'both';

/**
 * The ledge part of the game's air collision (CollisionFlagAir_CanGrabLedge, mpColl_80044164 /
 * 800443C4), then ftCliffCommon_80081298: catch it unless the stick is held down. Only while falling,
 * never for Sandbag (is_sandbag), and not during the cooldown after letting go (x2064).
 */
export function ledgeCatchCheck(e: Engine, which: LedgeDir): boolean {
  const fp = e.fighter;
  if (e.data.id === 'sandbag' || fp.ledgeCooldown || !(fp.pos.y < e.moveStart.y)) return false;
  const s = e.data.modelScale, [x, y, h] = e.data.ledgeSnap;
  const dir = which === 'both' ? 0 : fp.facing < 0 ? -1 : 1;
  const ledge = findLedge(fp, e.stage, e.moveStart, dir, [f(x * s), f(y * s), f(h * s)]);
  if (!ledge || fp.input.ly <= -e.c.cliff_grab_stick_threshold) return false;
  catchEnter(e, ledge);
  return true;
}

/** ftCliffCommon_80081370: turn to face the stage, stop dead and catch the ledge. */
function catchEnter(e: Engine, ledge: { seg: Segment; side: 1 | -1 }): void {
  const fp = e.fighter;
  fp.facing = ledge.side;
  e.toAir(); // ftCommon_8007D5D4: one jump used, so the double jump comes back
  e.changeMotion(CLIFF.Catch, MF.None, 0, 1);
  e.animStep();
  e.toAir();
  // ftCommon_8007E2FC: every velocity and acceleration to zero.
  fp.grVel = fp.grAccel1 = fp.grAccel2 = 0;
  fp.selfVel.x = fp.selfVel.y = fp.selfAccel.x = fp.selfAccel.y = 0;
  fp.kbVel.x = fp.kbVel.y = fp.groundKbVel = 0;
  fp.ledge = ledge;
  hang(e);
  if (e.data.sfx.x28) e.playSound(e.data.sfx.x28);
  e.playSound(4);
}

/**
 * ftCo_CliffCatch_Phys: the fighter sits at the ledge corner plus the animation's TransN offset. A
 * ledge that went away (its element scrolled out of the scan or disappeared) means a fall.
 */
function hang(e: Engine): boolean {
  const fp = e.fighter;
  if (!fp.ledge) { fallEnter(e); return false; }
  const [x, y] = ledgePoint(fp.ledge);
  fp.pos.x = f(fp.rootPos.z * fp.facing + x);
  fp.pos.y = f(y + fp.rootPos.y);
  return true;
}

/** ftCo_CliffCatch_Coll / ft_800821DC: an air collision with no ledge check; a floor means landing. */
function hangColl(e: Engine): void {
  if (airCollision(e.fighter, e.stage, e.moveStart, null)) landFromAir(e);
}

/** ftCo_8009A804: hanging. Intangible for a moment; the time until it drops depends on percent. */
function waitEnter_(e: Engine): void {
  const fp = e.fighter, c = e.c;
  e.changeMotion(CLIFF.Wait, MF.None, 0, 1);
  fp.mv.cliffNeutral = 0;
  fp.mv.cliffTimer = fp.percent < c.cliff_slow_percent ? c.cliff_wait_frames : c.cliff_wait_frames_slow;
  // ftColl_8007B760.
  if (c.cliff_intangible_frames > fp.intangibleFrames) fp.intangibleFrames = c.cliff_intangible_frames;
  fp.intangible = true;
}

/** ftCo_Cliff_EnterState: a getup, then back to the ledge corner. */
function actionEnter(e: Engine, quick: number, slow: number): void {
  const fp = e.fighter;
  e.changeMotion(fp.percent < e.c.cliff_slow_percent ? quick : slow, MF.None, 0, 1);
  e.animStep();
  hang(e);
}

/** ftCo_8009AE38: A or B, or the C-stick flicked up, attacks. */
function attackCheck(e: Engine): boolean {
  const i = e.fighter.input, t = e.c.cliff_attack_cstick_threshold;
  if (!(i.pressed & (BTN.A | BTN.B)) && !(i.pcy < t && i.cy >= t)) return false;
  actionEnter(e, CLIFF.AttackQuick, CLIFF.AttackSlow);
  return true;
}

/** ftCo_8009AFD4: L or R, or the C-stick flicked toward the stage, rolls. */
function escapeCheck(e: Engine): boolean {
  const fp = e.fighter, i = fp.input, t = e.c.cliff_escape_cstick_threshold;
  if (!(i.pressed & PAD_LR) && !(fp.facing * i.pcx < t && fp.facing * i.cx >= t)) return false;
  actionEnter(e, CLIFF.EscapeQuick, CLIFF.EscapeSlow);
  return true;
}

/** ftCo_8009B170: a jump input jumps off. */
function jumpCheck(e: Engine): boolean {
  if (!e.jumpInput()) return false;
  actionEnter(e, CLIFF.JumpQuick1, CLIFF.JumpSlow1);
  return true;
}

/**
 * ftCo_8009AA0C / ftCo_8009AAFC: once the stick has been neutral, pushing it up or toward the stage
 * climbs; down or away lets go (the C-stick can let go but not climb).
 */
function climbOrDropCheck(e: Engine): boolean {
  const fp = e.fighter, i = fp.input, t = e.c.cliff_climb_stick_threshold;
  let x: number, angle: number, main: boolean;
  if (abs(i.lx) >= t || abs(i.ly) >= t) { x = i.lx; angle = Math.atan2(i.ly, abs(i.lx)); main = true; }
  else if (abs(i.cx) >= t || abs(i.cy) >= t) { x = i.cx; angle = Math.atan2(i.cy, abs(i.cx)); main = false; }
  else { fp.mv.cliffNeutral = 1; return false; }
  const toward = angle > e.c.aerial_angle || (angle > -e.c.aerial_angle && x * fp.facing >= 0);
  if (toward) {
    if (!main || !fp.mv.cliffNeutral) return false;
    actionEnter(e, CLIFF.ClimbQuick, CLIFF.ClimbSlow);
    return true;
  }
  if (!fp.mv.cliffNeutral) return false;
  fp.ledgeCooldown = e.c.ledge_cooldown;
  fallEnter(e);
  return true;
}

/** ftCo_8009A9AC: hung too long: it lets go into a tumble. */
function timeoutCheck(e: Engine): boolean {
  const fp = e.fighter;
  if (fp.mv.cliffTimer > 0) return false;
  fp.ledgeCooldown = e.c.ledge_cooldown;
  damageFallEnter(e);
  return true;
}

/** ftCommon_8007D92C: a getup that ends in the air falls, on the ground stands. */
function actionEnd(e: Engine): void {
  if (e.isFramesRemaining()) return;
  if (e.fighter.ga === GA.Air) fallEnter(e); else waitEnter(e);
}

/**
 * ftCo_CliffClimb_Phys: hanging until the animation brings the fighter up onto the corner (TransN
 * forward and up of it), then on the ground, carried by root motion (ft_80084FA8).
 */
function actionPhys(e: Engine): void {
  const fp = e.fighter;
  if (fp.ga === GA.Ground) { groundAttackPhysics(fp, e.a, e.c); return; }
  if (!hang(e)) return;
  if (fp.rootPos.z >= 0 && fp.rootPos.y >= 0) {
    fp.floor = fp.ledge!.seg;
    e.toGround();
  }
}

/** ftCo_CliffClimb_Coll: in the air, land on a floor (ftCo_8009AE14); on the ground, stop at edges. */
function actionColl(e: Engine): void {
  if (e.fighter.ga === GA.Air) { if (airCollision(e.fighter, e.stage, e.moveStart, null)) e.toGround(); }
  else collStop(e);
}

/** ftCo_8009B2F8: the jump itself, from the ledge jump attributes. */
function jump2Enter(e: Engine): void {
  const fp = e.fighter;
  e.changeMotion(fp.motionId === CLIFF.JumpQuick1 ? CLIFF.JumpQuick2 : CLIFF.JumpSlow2, MF.None, 0, 1);
  e.animStep();
  fp.mv.cliffJumpStarted = 0;
  fp.selfVel.x = f(fp.selfVel.x + fp.facing * e.a.ledge_jump_horizontal_velocity);
  fp.selfVel.y = e.a.ledge_jump_vertical_velocity;
}

def({
  id: CLIFF.Catch, name: 'CliffCatch', move: 'CliffCatch',
  anim(e) { if (!e.isFramesRemaining()) waitEnter_(e); },
  phys: hang,
  coll: hangColl,
});

def({
  id: CLIFF.Wait, name: 'CliffWait', move: 'CliffWait',
  anim(e) { if (e.fighter.mv.cliffTimer > 0) e.fighter.mv.cliffTimer -= 1; },
  iasa(e) { attackCheck(e) || escapeCheck(e) || jumpCheck(e) || climbOrDropCheck(e) || timeoutCheck(e); },
  phys: hang,
  coll: hangColl,
});

for (const [id, name] of [
  [CLIFF.ClimbSlow, 'CliffClimbSlow'], [CLIFF.ClimbQuick, 'CliffClimbQuick'],
  [CLIFF.AttackSlow, 'CliffAttackSlow'], [CLIFF.AttackQuick, 'CliffAttackQuick'],
  [CLIFF.EscapeSlow, 'CliffEscapeSlow'], [CLIFF.EscapeQuick, 'CliffEscapeQuick'],
] as const) {
  def({ id, name, move: name, anim: actionEnd, phys: actionPhys, coll: actionColl });
}

for (const [id, name] of [[CLIFF.JumpSlow1, 'CliffJumpSlow1'], [CLIFF.JumpQuick1, 'CliffJumpQuick1']] as const) {
  def({
    id, name, move: name,
    anim(e) { if (!e.isFramesRemaining()) jump2Enter(e); },
    phys: hang,
    coll: actionColl,
  });
}

for (const [id, name] of [[CLIFF.JumpSlow2, 'CliffJumpSlow2'], [CLIFF.JumpQuick2, 'CliffJumpQuick2']] as const) {
  def({
    id, name, move: name,
    anim(e) { if (!e.isFramesRemaining()) fallEnter(e); },
    phys(e) {
      // No gravity on the frame of the jump.
      const fp = e.fighter;
      if (!fp.mv.cliffJumpStarted) { fp.mv.cliffJumpStarted = 1; return; }
      airPhysics(fp, e.a, e.c, (s) => e.playSound(s));
    },
    coll(e) {
      if (airCollision(e.fighter, e.stage, e.moveStart, () => e.fighter.input.ly > e.c.fall_platform_pass_threshold)) landFromAir(e);
      else ledgeCatchCheck(e, 'facing');
    },
  });
}
