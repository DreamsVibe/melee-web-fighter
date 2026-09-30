// Fox's down special (reflector, "shine"), ported from ft/kinds/ftFox/ftfoxspeciallw.c. Registered by
// the character's moves naming `behavior shine`; nothing here is in the engine core. The loop state
// accepts a jump on its first frame, which is what makes multishine and waveshine work.
import type { Engine } from '../engine';
import { MF } from '../engine';
import { BTN } from '../pad';
import { GA } from '../types';
import { addStates, kneeBendEnter, jumpAerialEnter, type Kit, type StateDef } from '../states';
import { deaccelQuickAir, fall, groundFriction, clampAirDrift } from '../physics';
import { airCollision, groundCollision, EdgeMode, isOnPlatform } from '../collision';

export const FX = {
  SpecialLwStart: 360, SpecialLwLoop: 361, SpecialLwHit: 362, SpecialLwEnd: 363, SpecialLwTurn: 364,
  SpecialAirLwStart: 365, SpecialAirLwLoop: 366, SpecialAirLwHit: 367, SpecialAirLwEnd: 368, SpecialAirLwTurn: 369,
} as const;

// ftFx_MF_SpecialLw_Coll = ftCommon_GroundAirColl_MF | KeepGfx (keeps the frame, replays the script silently).
const GROUND_AIR = MF.UpdateCmd | MF.KeepGfx;

function setVars(e: Engine): void {
  const fp = e.fighter, s = e.data.special;
  fp.mv.shineReleaseLag = s.reflector_release_lag;
  fp.mv.shineRelease = 0;
  fp.cmdVars[1] = 4;
  fp.mv.shineGravityDelay = s.reflector_gravity_delay;
}

function groundEnter(e: Engine): void {
  e.changeMotion(FX.SpecialLwStart, MF.None, 0, 1);
  e.animStep();
  setVars(e);
}

function airEnter(e: Engine): void {
  const fp = e.fighter;
  fp.selfVel.y = 0;
  fp.selfVel.x = Math.fround(fp.selfVel.x / e.data.special.reflector_momentum_preserve_x);
  e.changeMotion(FX.SpecialAirLwStart, MF.None, 0, 1);
  e.animStep();
  setVars(e);
}

function updateRelease(e: Engine): void {
  const fp = e.fighter;
  if (!(fp.input.held & BTN.B)) fp.mv.shineRelease = 1;
  if (fp.mv.shineReleaseLag > 0) fp.mv.shineReleaseLag--;
}

function airPhys(e: Engine): void {
  const fp = e.fighter;
  if (fp.mv.shineGravityDelay !== 0) fp.mv.shineGravityDelay--;
  else fall(fp, e.data.special.reflector_fall_accel, e.a.terminal_velocity);
  deaccelQuickAir(fp, e.a, e.c);
}

function loopEnter(e: Engine): void {
  e.changeMotion(e.fighter.ga === GA.Ground ? FX.SpecialLwLoop : FX.SpecialAirLwLoop, MF.KeepGfx, 0, 1);
  e.fighter.reflecting = true;
}

function endEnter(e: Engine): void {
  e.changeMotion(e.fighter.ga === GA.Ground ? FX.SpecialLwEnd : FX.SpecialAirLwEnd, MF.None, 0, 1);
}

/** ftFx_SpecialLwTurn_Check: a turn input while reflecting spins Fox around. */
function turnCheck(e: Engine): boolean {
  const fp = e.fighter;
  if (fp.input.lx * fp.facing > e.c.turn_stick_threshold) return false;
  e.changeMotion(fp.ga === GA.Ground ? FX.SpecialLwTurn : FX.SpecialAirLwTurn, MF.KeepGfx, 0, 1);
  fp.reflecting = true;
  fp.mv.shineTurnFrames = e.data.special.reflector_turn_frames;
  fp.cmdVars[0] = 0;
  turnStep(e);
  return true;
}

function turnStep(e: Engine): void {
  const fp = e.fighter;
  fp.mv.shineTurnFrames--;
  if (fp.cmdVars[0] === 0 && fp.mv.shineTurnFrames <= e.data.special.reflector_turn_frames) {
    fp.cmdVars[0] = 1;
    fp.facing = -fp.facing;
  }
}

/** ftFx_SpecialLwHit_Check: after a turn or reflect, end if released, otherwise keep looping. */
function hitCheck(e: Engine): void {
  const fp = e.fighter;
  if (fp.mv.shineReleaseLag <= 0 && fp.mv.shineRelease) endEnter(e);
  else loopEnter(e);
}

/** Drop through a platform while shining on it (ftFx_SpecialLwStart_Pass / Loop_Pass). */
function passCheck(e: Engine, airMsid: number): boolean {
  const fp = e.fighter, c = e.c;
  if (!(fp.input.ly <= -c.pass_stick_threshold && fp.timers.lyTimer < c.pass_stick_window && isOnPlatform(fp))) return false;
  const platform = fp.floor;
  const frame = fp.animFrame;
  e.toAir();
  clampAirDrift(fp, e.a);
  fp.selfVel.y = c.pass_y_velocity;
  e.changeMotion(airMsid, GROUND_AIR, frame, 1);
  fp.floorSkip = platform;
  fp.timers.lyTimer = 0xfe;
  fp.reflecting = true;
  return true;
}

function groundColl(e: Engine, airMsid: number): void {
  const fp = e.fighter;
  if (!groundCollision(fp, e.stage, e.moveStart, EdgeMode.Fall)) {
    const frame = fp.animFrame;
    e.toAir();
    e.changeMotion(airMsid, GROUND_AIR, frame, 1);
  }
}

function airColl(e: Engine, groundMsid: number): void {
  const fp = e.fighter;
  if (airCollision(fp, e.stage, e.moveStart, null)) {
    const frame = fp.animFrame;
    e.toGround();
    e.changeMotion(groundMsid, GROUND_AIR, frame, 1);
    clampAirDrift(fp, e.a);
  }
}

const defs: StateDef[] = [
  {
    id: FX.SpecialLwStart, name: 'SpecialLwStart', move: 'SpecialLwStart',
    anim(e) { if (!(e.fighter.input.held & BTN.B)) e.fighter.mv.shineRelease = 1; if (!e.isFramesRemaining()) loopEnter(e); },
    iasa(e) { passCheck(e, FX.SpecialAirLwStart); },
    phys(e) { groundFriction(e.fighter, e.a, e.c); },
    coll(e) { groundColl(e, FX.SpecialAirLwStart); },
  },
  {
    id: FX.SpecialAirLwStart, name: 'SpecialAirLwStart', move: 'SpecialAirLwStart',
    anim(e) { if (!(e.fighter.input.held & BTN.B)) e.fighter.mv.shineRelease = 1; if (!e.isFramesRemaining()) loopEnter(e); },
    phys: airPhys,
    coll(e) { airColl(e, FX.SpecialLwStart); },
  },
  {
    id: FX.SpecialLwLoop, name: 'SpecialLwLoop', move: 'SpecialLwLoop',
    anim(e) { updateRelease(e); const fp = e.fighter; if (fp.mv.shineReleaseLag <= 0 && fp.mv.shineRelease) endEnter(e); },
    iasa(e) {
      if (turnCheck(e)) return;
      // Jump cancel: ftCo_Jump_CheckInput from the reflector loop.
      const input = e.jumpInput();
      if (input) { kneeBendEnter(e, input); return; }
      passCheck(e, FX.SpecialAirLwLoop);
    },
    phys(e) { groundFriction(e.fighter, e.a, e.c); },
    coll(e) { groundColl(e, FX.SpecialAirLwLoop); },
  },
  {
    id: FX.SpecialAirLwLoop, name: 'SpecialAirLwLoop', move: 'SpecialAirLwLoop',
    anim(e) { updateRelease(e); const fp = e.fighter; if (fp.mv.shineReleaseLag <= 0 && fp.mv.shineRelease) endEnter(e); },
    iasa(e) {
      if (turnCheck(e)) return;
      // ftCo_800CB870: double jump out of the aerial reflector.
      const fp = e.fighter, c = e.c;
      if (fp.jumpsUsed < e.a.max_jumps && ((fp.input.ly >= c.tap_jump_threshold && fp.timers.lyTimer < c.tap_jump_window) || (fp.input.pressed & (BTN.X | BTN.Y)))) {
        jumpAerialEnter(e);
      }
    },
    phys: airPhys,
    coll(e) { airColl(e, FX.SpecialLwLoop); },
  },
  {
    id: FX.SpecialLwTurn, name: 'SpecialLwTurn', move: 'SpecialLwLoop',
    anim(e) { updateRelease(e); turnStep(e); if (e.fighter.mv.shineTurnFrames <= 0) hitCheck(e); },
    phys(e) { groundFriction(e.fighter, e.a, e.c); },
    coll(e) { groundColl(e, FX.SpecialAirLwTurn); },
  },
  {
    id: FX.SpecialAirLwTurn, name: 'SpecialAirLwTurn', move: 'SpecialAirLwLoop',
    anim(e) { updateRelease(e); turnStep(e); if (e.fighter.mv.shineTurnFrames <= 0) hitCheck(e); },
    phys: airPhys,
    coll(e) { airColl(e, FX.SpecialLwTurn); },
  },
  {
    id: FX.SpecialLwEnd, name: 'SpecialLwEnd', move: 'SpecialLwEnd',
    anim(e) { if (!e.isFramesRemaining()) { if (e.fighter.ga === GA.Air) e.changeState('Fall'); else e.changeState('Wait'); } },
    phys(e) { groundFriction(e.fighter, e.a, e.c); },
    coll(e) {
      const fp = e.fighter;
      if (!groundCollision(fp, e.stage, e.moveStart, EdgeMode.Fall)) {
        const frame = fp.animFrame;
        e.toAir();
        e.changeMotion(FX.SpecialAirLwEnd, MF.UpdateCmd, frame, 1);
      }
    },
  },
  {
    id: FX.SpecialAirLwEnd, name: 'SpecialAirLwEnd', move: 'SpecialAirLwEnd',
    anim(e) { if (!e.isFramesRemaining()) e.changeState('Fall'); },
    phys: airPhys,
    coll(e) {
      const fp = e.fighter;
      if (airCollision(fp, e.stage, e.moveStart, null)) {
        const frame = fp.animFrame;
        e.toGround();
        e.changeMotion(FX.SpecialLwEnd, MF.UpdateCmd, frame, 1);
        clampAirDrift(fp, e.a);
      }
    },
  },
];

/** Registers the shine states and the down-special entry points. */
export function registerShine(kit: Kit): void {
  addStates(kit, defs);
  kit.specials.groundLw = groundEnter;
  kit.specials.airLw = airEnter;
}
