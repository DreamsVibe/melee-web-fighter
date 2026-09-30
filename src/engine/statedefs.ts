// The motion state registry and ids, shared by the state modules (states.ts, attacks.ts, guard.ts) and
// the character behaviors. Kept free of imports so any of them can register states at load time.
import type { Engine } from './engine';

export interface StateDef {
  id: number;
  name: string;
  /** Move (submotion) whose animation and script this state plays. */
  move: string;
  /**
   * The game plays no animation or script in this state (anim_id -1; the shield states pose Fox with
   * a separate part animation). The move's animation is only shown, frozen on its first frame.
   */
  poseOnly?: boolean;
  anim?(e: Engine): void;
  iasa?(e: Engine): void;
  phys?(e: Engine): void;
  coll?(e: Engine): void;
}

/** Common motion ids (enum ftCommon_MotionState in ft/kinds/ftCommon/forward.h). */
export const MS = {
  Wait: 14, WalkSlow: 15, WalkMiddle: 16, WalkFast: 17, Turn: 18, TurnRun: 19, Dash: 20, Run: 21, RunBrake: 23,
  KneeBend: 24, JumpF: 25, JumpB: 26, JumpAerialF: 27, JumpAerialB: 28, Fall: 29, FallAerial: 32, FallSpecial: 35,
  Squat: 39, SquatWait: 40, SquatRv: 41, Landing: 42, LandingFallSpecial: 43,
  Attack11: 44, Attack12: 45, Attack13: 46, Attack100Start: 47, Attack100Loop: 48, Attack100End: 49, AttackDash: 50,
  AttackS3Hi: 51, AttackS3HiS: 52, AttackS3S: 53, AttackS3LwS: 54, AttackS3Lw: 55, AttackHi3: 56, AttackLw3: 57,
  AttackS4Hi: 58, AttackS4HiS: 59, AttackS4S: 60, AttackS4LwS: 61, AttackS4Lw: 62, AttackHi4: 63, AttackLw4: 64,
  AttackAirN: 65, AttackAirF: 66, AttackAirB: 67, AttackAirHi: 68, AttackAirLw: 69,
  LandingAirN: 70, LandingAirF: 71, LandingAirB: 72, LandingAirHi: 73, LandingAirLw: 74,
  GuardOn: 178, Guard: 179, GuardOff: 180, GuardReflect: 182, Catch: 212, CatchDash: 214,
  EscapeF: 233, EscapeB: 234, EscapeN: 235, EscapeAir: 236, Pass: 244, AppealSR: 264, AppealSL: 265,
} as const;

/** The common motion states (ids below 341), shared by every character. */
export const STATES = new Map<number, StateDef>();
export const def = (d: StateDef) => STATES.set(d.id, d);

/**
 * Entry points a character's behaviors register for its specials (ftData_SpecialN/S/Hi/Lw and their
 * air versions) and a character taunt. A missing one means "this input does nothing".
 */
export interface SpecialHooks {
  groundN?(e: Engine): void; airN?(e: Engine): void;
  groundS?(e: Engine): void; airS?(e: Engine): void;
  groundHi?(e: Engine): void; airHi?(e: Engine): void;
  groundLw?(e: Engine): void; airLw?(e: Engine): void;
  /** A character's own taunt on D-pad down (Fox and Falco call their Arwing). */
  appeal?(e: Engine): void;
}

/**
 * One character's motion states and special entry points. Motion ids from 341 mean something different
 * for each character (Fox's 347 is Illusion, Falcon's is Falcon Punch), so each character gets its own
 * table of its own states (what its behavior modules add); anything else is looked up in STATES.
 */
export interface Kit { states: Map<number, StateDef>; specials: SpecialHooks }
export const newKit = (): Kit => ({ states: new Map(), specials: {} });
/** A behavior module adds its states and entry points to a character's kit. */
export const addStates = (kit: Kit, defs: StateDef[]) => { for (const d of defs) kit.states.set(d.id, d); };
