// Engine data types: the character data the engine runs on (built from the character folder), the
// fighter state (the subset of the decomp's `Fighter` that v1 needs), events and plugin hooks.
import type { AnimData } from '../shared/animfile';
import type { Cmd } from '../shared/move';
import type { SkeletonJoint } from '../shared/modelfile';
import type { PadState } from './pad';
import type { Segment, StageData } from './stagetypes';
import type { Kit } from './statedefs';

export type Named = Record<string, number>;

/** A .move file compiled for the interpreter: labels resolved to command indices. */
export interface CompiledMove {
  name: string;
  anim: AnimData | null;
  animName: string | null;
  /** Action table flags (0x80000000 root motion, 0x40000000 loop, 0x20000000 frame accumulate). */
  animFlags: number;
  landingLag?: number;
  behavior?: string;
  cmds: Cmd[];
  /** Index of the command after each label. */
  labels: Map<string, number>;
}

export interface CharacterData {
  name: string;
  attrs: Named;
  special: Named;
  common: Named;
  moves: Map<string, CompiledMove>;
  skeleton: SkeletonJoint[];
  modelScale: number;
  /** Joints whose positions bound the ECB (ftData +0x44), and its side offset. */
  ecbBones: number[];
  ecbSideOffset: number;
  /** Ledge-grab box (ftData +0x44: x reach, y offset, height), unscaled. */
  ledgeSnap: [number, number, number];
  /** Joint index of TransN (root motion carrier). */
  transN: number;
  /** Joint index of each Fighter_Part (TopN, TransN, XRotN, YRotN, HipN, ... TransN2). */
  parts: number[];
  /** Joints the shield bubble and held items attach to (ftData +0x8 → +0x11, +0x10). */
  shieldJoint: number;
  itemJoint: number;
  /** Article (projectile) attributes, e.g. the blaster shot's lifetime. */
  articles: Record<string, Named>;
  /** Named sound ids from the character's sound table (jump, doubleJump, ...). */
  sfx: Named;
  /** Sound id by name, for scripts and plugins. */
  soundIds: Map<string, number>;
  /** Character id ("fox", "sandbag"). Sandbag has its own knockback deceleration and landings. */
  id: string;
  /** Hurtboxes (ftData +0x30): capsules on joints that attacks test against. */
  hurtboxes: HurtboxDef[];
  /** Push box (ftData +0x50): x offset and half width. */
  push: [number, number];
  /** Joint constraints the character's code sets up (HSD RObj), applied after posing. */
  constraints: ConstraintDef[];
  /** Fox's blaster shot: its item scripts (state 0 from the blaster). */
  laser: { lifetime: number; scale: number; states: ItemCmd[][] } | null;
  /**
   * The side special's afterimage item (Fox's Illusion, Falco's Phantasm): how long it can hit, how
   * long it lingers after, its scale, and its item scripts (0 from the ground, 1 from the air, 2 after).
   */
  illusion: { lifetime: number; endLifetime: number; scale: number; states: ItemCmd[][] } | null;
  /** Its motion states (the common ones plus its own from 341) and special-move entry points. */
  kit: Kit;
  /** Move id (FtMoveId, for stale moves) of each own motion state, from its motion table. */
  moveIds: Map<number, number>;
}

export interface HurtboxDef { bone: number; height: number; grabbable: boolean; a: [number, number, number]; b: [number, number, number]; radius: number }
export interface ConstraintDef { joint: number; position?: number[]; aim?: number; rotXMin?: number; rotXMax?: number }
export type ItemCmd =
  | { op: 'wait'; n: number }
  | { op: 'hitbox'; id: number; group: number; bone: number; damage: number; size: number; offset: [number, number, number]; angle: number; kbg: number; wkb: number; bkb: number; element: number; sfxLevel: number; sfxKind: number; ground: number; air: number; fighters: number }
  | { op: 'hitbox_damage'; id: number; value: number }
  | { op: 'remove_hitbox'; id: number }
  | { op: 'clear_hitboxes' };

export const enum GA { Ground = 0, Air = 1 }

export interface HitboxState {
  active: boolean;
  id: number;
  group: number;
  /** Joint index the hitbox follows. */
  bone: number;
  /** Damage after staling and smash charge (HitCapsule damage), and the unstaled integer (unk_count). */
  damage: number;
  count: number;
  size: number;
  /** Offset in the joint's space (b_offset; the command's "z", "y", "x" words, in that order). */
  offset: [number, number, number];
  angle: number;
  kbg: number;
  bkb: number;
  wkb: number;
  element: number;
  sfxLevel: number;
  sfxKind: number;
  /** Hits fighters on the ground / in the air (x40_b3 / x40_b2), fighters at all (x42_b5). */
  ground: boolean; air: boolean; fighters: boolean;
  /** World position this frame and last frame (hitboxes are swept capsules), with depth. */
  pos: [number, number]; prevPos: [number, number]; pos3: [number, number, number]; prevPos3: [number, number, number]; fresh: boolean;
  /** Who this hitbox (and the others of its group) already hit (victims_1), and only just grazed (victims_2). */
  victims: Set<object>;
  tipVictims: Set<object>;
  /** Contact point and overlap of the last capsule test (hurt_coll_pos, coll_distance). */
  contact: [number, number, number]; overlap: number;
}

export interface ScriptState {
  move: CompiledMove | null;
  pc: number;
  timer: number;
  frameCount: number;
  loopStack: Array<{ pc: number; count: number }>;
  callStack: number[];
}

export interface Ecb { top: number; bottom: number; left: number; right: number; sideY: number }

/** Smash attack charge (SmashAttr, ft/ft_0DF0.c). */
export const enum Smash { None = 0, PreCharge = 1, Charging = 2, Release = 3 }

/** A projectile the fighter fired (Fox's blaster shot): an item with its own script and hitboxes. */
export interface Projectile {
  kind: string;
  x: number; y: number; prevX: number; prevY: number;
  vx: number; vy: number;
  angle: number;
  age: number;
  lifetime: number;
  /** Ray length (the joint's Z scale, grows with speed up to the article's scale). */
  scale: number;
  speed: number;
  facing: number;
  hitboxes: HitboxState[];
  script: { cmds: ItemCmd[]; pc: number; timer: number } | null;
  /** The owner's attack at the time of the shot (for stale moves). */
  attackId: number; attackInstance: number;
  /** Dealt damage this frame: the item goes away (FoxLaser dmg_dealt). */
  hit: boolean;
  dead: boolean;
}

/**
 * The side special's afterimage (it/kinds/itfoxillusion.c): an item that trails the fighter's dash
 * one frame behind and carries the move's hitbox. Hitting doesn't remove it.
 */
export interface Afterimage {
  x: number; y: number;
  facing: number;
  /** Its joint's X rotation (the fighter's TopN one frame behind). */
  rotX: number;
  /** Item state: 0 from the ground, 1 from the air, 2 fading (no hitbox). */
  state: number;
  /** Frames left in this state (xD44_lifeTimer). */
  timer: number;
  age: number;
  hitboxes: HitboxState[];
  script: { cmds: ItemCmd[]; pc: number; timer: number } | null;
  /** The owner's attack when it appeared (for stale moves). */
  attackId: number; attackInstance: number;
  dead: boolean;
}

/** One hit registered this frame (dmg_log0 entries), resolved into damage in procCollResolve. */
export interface DamageEntry {
  source: 'fighter' | 'item';
  /** Attacker position (fighter) or item position and velocity (item), for the hit direction. */
  x: number; vx: number;
  hit: HitboxState;
  hurt: HurtboxDef;
  attacker: object; attackId: number; instance: number;
  hurtA: [number, number, number]; hurtB: [number, number, number];
  contact: [number, number, number];
  count: number;
  damage: number;
}

/** Input as Fighter_procInput builds it (lstick[0] current, [1] previous frame). */
export interface FighterInput {
  lx: number; ly: number; plx: number; ply: number;
  cx: number; cy: number; pcx: number; pcy: number;
  trigger: number; ptrigger: number;
  held: number; pheld: number;
  pressed: number; released: number;
}

export interface Fighter {
  pos: { x: number; y: number };
  prevPos: { x: number; y: number };
  selfVel: { x: number; y: number };
  selfAccel: { x: number; y: number };
  grVel: number;
  grAccel1: number;
  grAccel2: number;
  facing: number;
  facing1: number;
  ga: GA;
  jumpsUsed: number;
  fallFast: boolean;
  motionId: number;
  motionName: string;
  // Animation (HSD AObj model).
  move: CompiledMove | null;
  animFrame: number;
  animRate: number;
  animEnd: number;
  animLoop: boolean;
  animDone: boolean;
  animFirst: boolean;
  frameAccum: number;
  // Script.
  script: ScriptState;
  cmdVars: [number, number, number, number];
  throwFlags: number;
  allowInterrupt: boolean;
  hitboxes: HitboxState[];
  reflecting: boolean;
  // Jabs: frames left to chain the next jab (hitlag_mul), combo/rapid flags from the script
  // (x2218_b1/b2), the last jab (unk_msid) and A presses/releases counted for rapid jab (x1A54).
  jabWindow: number;
  jabCombo: boolean;
  jabRapid: boolean;
  jabLast: number;
  jabPresses: number;
  // Smash charge.
  smash: { state: Smash; frames: number; hold: number; rate: number; sfx: boolean; damageMul: number };
  /** Root motion: TransN's animated translation and its change this frame (x68C / x6A4). */
  rootPos: { x: number; y: number; z: number };
  rootDelta: { x: number; y: number; z: number };
  /** ftPartSetRotX on XRotN (Firefox points Fox along his flight), NaN when the animation's own. */
  xRot: number;
  // Shield (shield_health, lightshield_amount, x221B_b0).
  shieldHealth: number;
  lightshield: number;
  shielding: boolean;
  /** Recent positions for afterimages (Fox's Illusion keeps four), empty when none. */
  ghosts: number[];
  /** TopN's X rotation at each of those positions (mv.fx.SpecialS.blendFrames). */
  ghostRot: number[];
  // Input and its timers.
  input: FighterInput;
  hasPrevInput: boolean;
  timers: { lxTimer: number; lyTimer: number; lxSticky: number; lySticky: number; lxActivity: number; lyActivity: number; lxDuration: number; lyDuration: number; trigTimer: number };
  counters: { a: number; aPrev: number; b: number; xy: number; lr: number; lrDigital: number; lrDigitalPrev: number; dUp: number; dDown: number; jump: number; jumpPrev: number; upB: number; upBPrev: number; downB: number; sideB: number; neutralB: number };
  x2228_b7: number;
  x2229_b0: number;
  // State-specific memory (the decomp's `mv` union), one bag of named fields.
  mv: Record<string, number>;
  // Collision.
  ecb: Ecb;
  prevEcb: Ecb;
  desiredEcb: Ecb;
  ecbLock: number;
  ecbLocked: boolean;
  floor: Segment | null;
  floorSkip: Segment | null;
  envFlags: number;
  lstickAngle: number;
  /** Frames since the fighter respawned (for the respawn fall). */
  dead: boolean;
  /** Pose of the current animation frame (for ECB, hitboxes and rendering). */
  local: Float32Array;
  world: Float32Array;
  poseDirty: boolean;
  /**
   * A second animation blended over the pose (ftCo_Fall_Anim_Inner: Fall and FallAerial lean into the
   * drift with FallF/B), with its own frame, and the weight of its pose (0 = none).
   */
  blend: { move: CompiledMove | null; frame: number; first: boolean; weight: number };
  /**
   * The state's reactions (cleared by every state change): dealing damage this frame (deal_dmg_cb), and
   * an inert hitbox touching someone (hurtbox_detect_cb, with `detected` = whom, unk_gobj).
   */
  onDealDamage: ((e: import('./engine').Engine) => void) | null;
  onDetect: ((e: import('./engine').Engine) => void) | null;
  detected: object | null;
  // Damage (fp->dmg): percent, what this frame's hits add (x1838), the strongest integer damage
  // (x183C, sets hitlag), knockback to apply (kb_applied) with its angle, direction and hurtbox
  // height, the damage this fighter dealt this frame (x1914), and frames since the last hit.
  percent: number;
  percentTemp: number;
  damageApplied: number;
  kbApplied: number;
  kbAngle: number;
  hitDir: number;
  hurtHeight: number;
  dealtDamage: number;
  sinceHit: number;
  damageLog: DamageEntry[];
  /**
   * Phantom hits: a hitbox that only just reaches (overlap under phantom_threshold) logs half its
   * damage here (dmg_log1) instead. That sets hitlag (x1840) and, when the hitlag is over (x189C), the
   * stored damage (x1898) lands, without knockback.
   */
  tipLog: DamageEntry[];
  phantomHitlag: number;
  phantomFrames: number;
  phantomDamage: number;
  phantomSource: { attacker: object; attackId: number; instance: number; item: boolean } | null;
  /** Hitlag multiplier this frame (x1960): electric hits make it last longer. */
  hitlagMul: number;
  /** Knockback velocity (x8C) and its ground speed (xF0). */
  kbVel: { x: number; y: number };
  groundKbVel: number;
  /** Hitlag frames left (x195C) and the frozen flag (x2219_b5); SDI allowed this hitlag (x2219_b4). */
  hitlag: number;
  inHitlag: boolean;
  allowSdi: boolean;
  /** What runs when hitlag ends (post_hitlag_cb): 'damage' for the damage states' exit. */
  postHitlag: 'damage' | null;
  /** Hitstun: frames left (mv.co.damage.x0) and the flag that blocks actions (x221C_b6). */
  hitstun: number;
  inHitstun: boolean;
  /** Hits connect but do nothing (x198C = 1) for invincibleFrames (x1994); intangible: they pass (2), for intangibleFrames (x1990). */
  invincible: boolean;
  intangible: boolean;
  invincibleFrames: number;
  intangibleFrames: number;
  /** The script's body collision state (x1988): 0 normal, 1 invincible, 2 intangible. */
  bodyState: number;
  /** The ledge the fighter hangs from or gets up onto (mv.co.cliff.ledge_id): a floor end, 1 = left end, -1 = right end. */
  ledge: { seg: Segment; side: 1 | -1 } | null;
  /** Frames before a ledge can be caught again (x2064). */
  ledgeCooldown: number;
  /** Push against other fighters this frame (xF8_playerNudgeVel.x). */
  nudge: number;
  /** Stale moves: this move's id and instance (x2068/x206C), and the queue of recent hits. */
  attackId: number;
  attackInstance: number;
  stale: { index: number; moves: Array<{ id: number; instance: number }> };
}

// Collision env flags (a subset of the game's Collide_* bits).
export const ENV = {
  LeftWall: 1 << 0, RightWall: 1 << 1, Ceiling: 1 << 2, Floor: 1 << 3,
  LeftEdge: 1 << 4, RightEdge: 1 << 5, Edge: 1 << 6,
} as const;

export type EngineEvent =
  | { type: 'hit'; x: number; y: number; damage: number; kb: number; frame: number }
  | { type: 'sound'; id: number; volume: number; pan: number; frame: number }
  | { type: 'land'; frame: number; lag: number; lcancel: boolean }
  | { type: 'state'; from: string; to: string; frame: number }
  | { type: 'ko'; frame: number }
  | { type: 'hitbox'; hitbox: HitboxState; frame: number }
  | { type: 'projectile'; projectile: Projectile; frame: number };

/** Stable API handed to plugins and behaviors. */
export interface EngineApi {
  readonly fighter: Fighter;
  readonly data: CharacterData;
  readonly frame: number;
  readonly stage: StageData;
  playSound(id: number | string, volume?: number, pan?: number): void;
  changeState(name: string, animStart?: number): void;
  /** Floor segment under a point, if any. */
  floorBelow(x: number, y: number, maxDistance: number): Segment | null;
}

export interface Plugin {
  id: string;
  /** Edit the pad before the engine reads it. */
  input?(api: EngineApi, pad: PadState): void;
  frameStart?(api: EngineApi): void;
  frameEnd?(api: EngineApi): void;
  stateEnter?(api: EngineApi, state: string): void;
  stateExit?(api: EngineApi, state: string): void;
  landing?(api: EngineApi, lag: number): void;
  hitboxContact?(api: EngineApi, hitbox: HitboxState, target: unknown): void;
  /** Called by the renderer with the debug 2D context, to draw extra things. */
  render?(api: EngineApi, ctx: OffscreenCanvasRenderingContext2D, toClient: (x: number, y: number) => [number, number]): void;
  /** Physics override hook: return modified attributes (e.g. gravity) for this frame. */
  attributes?(api: EngineApi, attrs: Named): Named | void;
}
