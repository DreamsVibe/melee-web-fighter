// The engine for one fighter: a fixed 60 Hz step, deterministic, no DOM. Each step follows the order
// of the game's fighter procs (ft/fighter.c Fighter_Create): hitlag, animation + script + anim
// callback, input + interrupts (IASA), physics + velocity integration, collision + landing/falling,
// then hitbox positions, attack collision and damage. A World (world.ts) runs several engines phase
// by phase, as the game runs every fighter's proc of one priority before the next priority.
import type { Cmd } from '../shared/move';
import { applyConstraints, eulerToQuat, restPose, slerp, worldMatrices, type JointQuats } from '../render/pose';
import { applyAnim } from '../render/animator';
import { sampleTrack } from '../render/fobj';
import { BTN, emptyFloats, padToFloats, type PadFloats, type PadState } from './pad';
import { runScript, startScript, F32_MAX } from './script';
import { clampGroundVel } from './physics';
import { loadEcb, ECB_AIR, ECB_GROUND } from './collision';
import { SegKind, type Segment, type StageData } from './stagetypes';
import { GA, Smash, type Afterimage, type CharacterData, type EngineApi, type EngineEvent, type Fighter, type HitboxState, type ItemCmd, type Named, type Plugin, type Projectile } from './types';
import { STATES, MS, type SpecialHooks, type StateDef } from './states';
import { collResolve, fighterNudge, moveIdOf, staleMultiplier } from './hits';
import { damageExitHitlag, WAIT_REVERSE } from './damage';
import type { World } from './world';
import { Ucf } from './ucf';
import { hitlagSdi, hitlagAsdi } from './hitlag';

const f = Math.fround;

// Synthetic button bits (sysdolphin HSD_PAD_*), on top of the GameCube bits in pad.ts.
export const PAD_LR = 0x80000000;
export const PAD_XY = BTN.X | BTN.Y;

// ChangeMotionState flags (ft/forward.h Ft_MF_*).
export const MF = {
  None: 0, KeepFastFall: 1 << 0, KeepGfx: 1 << 1, SkipHit: 1 << 3, SkipAnimVel: 1 << 5, UpdateCmd: 1 << 14,
  SkipNametagVis: 1 << 15, SkipParasol: 1 << 10, FreezeState: 1 << 21,
  /** Ours, not the game's: keep the afterimage trail (Fox's Illusion hands it from state to state). */
  KeepGhosts: 1 << 30,
} as const;

/** ftFx_MS_SpecialSStart .. SpecialAirSEnd: while the fighter is in these, its afterimage stays. */
const FX_SPECIAL_S_FIRST = 347, FX_SPECIAL_S_LAST = 352;

/** Wait and the walks keep the jab window open (Fighter_ChangeMotionState resets hitlag_mul otherwise). */
const KEEPS_JAB_WINDOW = (msid: number) => msid >= MS.Wait && msid <= MS.WalkFast;

export function newHitbox(id: number): HitboxState {
  return {
    active: false, id, group: 0, bone: 0, damage: 0, count: 0, size: 0, offset: [0, 0, 0], angle: 0, kbg: 0, bkb: 0, wkb: 0,
    element: 0, sfxLevel: 0, sfxKind: 0, shieldDamage: 0, ground: true, air: true, fighters: true,
    pos: [0, 0], prevPos: [0, 0], pos3: [0, 0, 0], prevPos3: [0, 0, 0], fresh: true, victims: new Set(), tipVictims: new Set(), contact: [0, 0, 0], overlap: 0,
  };
}

function newFighter(data: CharacterData): Fighter {
  const J = data.skeleton.length;
  const ecb = () => ({ top: 8, bottom: 0, left: -4, right: 4, sideY: 4 });
  return {
    pos: { x: 0, y: 0 }, prevPos: { x: 0, y: 0 }, selfVel: { x: 0, y: 0 }, selfAccel: { x: 0, y: 0 },
    grVel: 0, grAccel1: 0, grAccel2: 0, facing: 1, facing1: 1, ga: GA.Air, jumpsUsed: 0, fallFast: false,
    motionId: -1, motionName: '', move: null, animFrame: 0, animRate: 1, animEnd: 0, animLoop: false, animDone: true,
    animFirst: false, frameAccum: 0,
    script: { move: null, pc: 0, timer: 0, frameCount: 0, loopStack: [], callStack: [] },
    cmdVars: [0, 0, 0, 0], throwFlags: 0, allowInterrupt: false, reflecting: false,
    jabWindow: 0, jabCombo: false, jabRapid: false, jabLast: 0, jabPresses: 0,
    smash: { state: Smash.None, frames: 0, hold: 0, rate: 1, sfx: false, damageMul: 1 },
    rootPos: { x: 0, y: 0, z: 0 }, rootDelta: { x: 0, y: 0, z: 0 }, xRot: NaN, rootRotY: Math.PI / 2,
    shieldHealth: data.common.shield_start_health ?? 60, lightshield: 0, shielding: false, ghosts: [], ghostRot: [],
    shieldDamage: 0, shieldHitDamage: 0, shieldHitDir: 1,
    hitboxes: Array.from({ length: 4 }, (_, id) => newHitbox(id)),
    input: { lx: 0, ly: 0, plx: 0, ply: 0, cx: 0, cy: 0, pcx: 0, pcy: 0, trigger: 0, ptrigger: 0, held: 0, pheld: 0, pressed: 0, released: 0 },
    hasPrevInput: false,
    timers: { lxTimer: 254, lyTimer: 254, lxSticky: 254, lySticky: 254, lxActivity: 254, lyActivity: 254, lxDuration: 254, lyDuration: 254, trigTimer: 254 },
    counters: { a: 255, aPrev: 255, b: 255, xy: 255, lr: 255, lrDigital: 255, lrDigitalPrev: 255, dUp: 255, dDown: 255, jump: 255, jumpPrev: 255, upB: 255, upBPrev: 255, downB: 255, sideB: 255, neutralB: 255 },
    x2228_b7: 0, x2229_b0: 0,
    mv: {},
    ecb: ecb(), prevEcb: ecb(), desiredEcb: ecb(), ecbLock: 0, ecbLocked: false,
    floor: null, floorSkip: null, envFlags: 0, lstickAngle: 0, dead: false,
    local: new Float32Array(J * 9), world: new Float32Array(J * 12), poseDirty: true,
    blend: { move: null, frame: 0, first: false, weight: 0 }, onDealDamage: null, onDetect: null, detected: null,
    percent: 0, percentTemp: 0, damageApplied: 0, kbApplied: 0, kbAngle: 0, hitDir: 1, hurtHeight: 1, dealtDamage: 0, sinceHit: -1,
    damageLog: [], tipLog: [], phantomHitlag: 0, phantomFrames: 0, phantomDamage: 0, phantomSource: null, hitlagMul: 1, kbVel: { x: 0, y: 0 }, groundKbVel: 0, hitlag: 0, inHitlag: false, allowSdi: false, postHitlag: null,
    hitstun: 0, inHitstun: false, invincible: false, intangible: false, invincibleFrames: 0, intangibleFrames: 0, bodyState: 0,
    ledge: null, ledgeCooldown: 0, nudge: 0, attackId: 1, attackInstance: 0,
    stale: { index: 0, moves: Array.from({ length: 10 }, () => ({ id: 0, instance: 0 })) },
  };
}

/** plStale_IncrementAttackInstance: one counter for the whole match (ids only need to differ). */
let attackInstanceCounter = 1;
export function nextAttackInstance(): number {
  const n = attackInstanceCounter;
  attackInstanceCounter = attackInstanceCounter >= 0xffff ? 1 : attackInstanceCounter + 1;
  return n;
}

export class Engine implements EngineApi {
  readonly fighter: Fighter;
  frame = 0;
  stage: StageData = { segments: [], blast: [-1e9, 1e9, -1e9, 1e9], spawn: [0, 0] };
  readonly events: EngineEvent[] = [];
  /** Projectiles in flight (Fox's blaster shots). */
  readonly projectiles: Projectile[] = [];
  /** The side special's afterimage items (Illusion, Phantasm): they carry its hitbox. */
  readonly afterimages: Afterimage[] = [];
  plugins: Plugin[] = [];
  /** Effective attributes this frame (plugins may change them), and the common constants. */
  a: Named;
  c: Named;
  pad: PadFloats = emptyFloats();
  readonly ucf = new Ucf();
  private rawPad: PadState = { buttons: 0, stickX: 0, stickY: 0, cX: 0, cY: 0, trigL: 0, trigR: 0 };
  private rest: Float32Array;
  private blendLocal: Float32Array;
  private quats: JointQuats;
  private quatTmp = new Float32Array(8);
  private scratch: Float32Array;
  private lastPos = { x: 0, y: 0 };
  /** Behavior modules by name (`behavior shine` in a .move file). */
  behaviors = new Map<string, Partial<StateDef>>();
  /** The world this fighter is in, when there are others to hit and be hit by. */
  world: World | null = null;
  /** Percent never goes up (the settings' "Sandbag takes damage" switched off). */
  noDamage = false;
  /** This fighter's own KO bounds [left, right, bottom, top], instead of the stage's blast zone. */
  blast: [number, number, number, number] | null = null;

  constructor(public data: CharacterData) {
    this.fighter = newFighter(data);
    // Sandbag's one own state (motion 341) comes from the damage code, not a behavior module.
    if (data.id === 'sandbag') data.kit.states.set(WAIT_REVERSE.id, WAIT_REVERSE);
    this.a = { ...data.attrs };
    this.c = data.common;
    this.rest = restPose(data.skeleton);
    this.blendLocal = new Float32Array(data.skeleton.length * 9);
    this.quats = { q: new Float32Array(data.skeleton.length * 4), on: new Uint8Array(data.skeleton.length) };
    this.scratch = new Float32Array(data.skeleton.length * 3);
  }

  /** Swaps in reloaded data (live override reload) without resetting the fighter. */
  setData(data: CharacterData): void {
    this.data = data;
    this.a = { ...data.attrs };
    this.c = data.common;
    const fp = this.fighter;
    if (fp.move) {
      const m = data.moves.get(fp.move.name);
      if (m) { fp.move = m; if (fp.script.move) fp.script.move = m; }
    }
  }

  // ------------------------------------------------------------------ public API (EngineApi)
  playSound(id: number | string, volume = 127, pan = 64): void {
    const n = typeof id === 'string' ? this.data.soundIds.get(id) ?? Number(id) : id;
    // 0x83D60 and above is the game's "no sound" id.
    if (Number.isFinite(n) && n >= 0 && n < 0x83d60) this.events.push({ type: 'sound', id: n, volume, pan, frame: this.frame });
  }

  changeState(name: string, animStart = 0): void {
    const def = [...this.data.kit.states.values(), ...STATES.values()].find((s) => s.name === name);
    if (def) this.changeMotion(def.id, MF.None, animStart, 1);
  }

  floorBelow(x: number, y: number, maxDistance: number): Segment | null {
    let best: Segment | null = null;
    for (const s of this.stage.segments) {
      if ((s.kind === SegKind.Floor || s.kind === SegKind.Platform) && x >= s.x0 && x <= s.x1 && s.y0 <= y && y - s.y0 <= maxDistance) {
        if (!best || s.y0 > best.y0) best = s;
      }
    }
    return best;
  }

  /** Places the fighter (respawn at the top of the viewport). */
  spawn(x: number, y: number, facing = 1): void {
    const fp = this.fighter;
    fp.pos.x = fp.prevPos.x = f(x);
    fp.pos.y = fp.prevPos.y = f(y);
    fp.selfVel.x = fp.selfVel.y = fp.grVel = 0;
    fp.facing = facing;
    fp.ga = GA.Air;
    fp.jumpsUsed = 1;
    fp.floor = null;
    fp.ledge = null;
    fp.ledgeCooldown = 0;
    fp.dead = false;
    fp.shielding = false;
    fp.shieldHealth = this.c.shield_start_health ?? fp.shieldHealth;
    this.resetDamage();
    this.changeMotion(MS.Fall, MF.None, 0, 1);
  }

  /** Back to 0% with no knockback, hitlag or hitstun (a respawn). */
  resetDamage(): void {
    const fp = this.fighter;
    fp.shieldDamage = fp.shieldHitDamage = 0;
    fp.percent = 0; fp.percentTemp = 0; fp.damageApplied = 0; fp.kbApplied = 0; fp.dealtDamage = 0; fp.damageLog.length = 0;
    fp.tipLog.length = 0; fp.phantomHitlag = 0; fp.phantomFrames = 0; fp.phantomDamage = 0; fp.phantomSource = null; fp.hitlagMul = 1;
    fp.kbVel.x = fp.kbVel.y = 0; fp.groundKbVel = 0; fp.hitlag = 0; fp.inHitlag = false; fp.allowSdi = false; fp.postHitlag = null;
    fp.hitstun = 0; fp.inHitstun = false; fp.sinceHit = -1; fp.invincible = false; fp.intangible = false; fp.invincibleFrames = 0;
    fp.intangibleFrames = 0; fp.bodyState = 0;
  }

  /** Places the fighter standing on a floor (used by validation traces). */
  spawnGrounded(x: number, floor: Segment, facing = 1): void {
    const fp = this.fighter;
    fp.pos.x = fp.prevPos.x = f(x);
    fp.pos.y = fp.prevPos.y = floor.y0;
    fp.ga = GA.Ground;
    fp.floor = floor;
    fp.facing = facing;
    fp.jumpsUsed = 0;
    this.changeMotion(MS.Wait, MF.None, 0, 1);
  }

  setStage(stage: StageData): void {
    // The same stage again (a Melee stage passes the same one every frame): nothing moved.
    if (stage === this.stage) return;
    const fp = this.fighter;
    // A line's counterpart in the new stage: the same place among the lines of its group and kind (a
    // page element has one line; a stage's collision joint has many).
    const prev = this.stage;
    const counterpart = (old: Segment, extra: (s: Segment) => boolean = () => true): Segment | null => {
      const like = (s: Segment) => s.group === old.group && s.kind === old.kind;
      const nth = Math.max(0, prev.segments.filter(like).indexOf(old));
      return stage.segments.filter((s) => like(s) && extra(s))[nth] ?? null;
    };
    // Moving platforms: carry a grounded fighter with the element he stands on (mpGetSpeed).
    if (fp.ga === GA.Ground && fp.floor) {
      const old = fp.floor;
      const moved = counterpart(old);
      if (moved) {
        const dx = moved.x0 - old.x0, dy = moved.y0 - old.y0;
        if (dx || dy) { fp.pos.x = f(fp.pos.x + dx); fp.pos.y = f(fp.pos.y + dy); }
        fp.floor = moved;
      } else fp.floor = null;
    }
    if (fp.floorSkip) fp.floorSkip = counterpart(fp.floorSkip);
    // The ledge the fighter hangs from moves with its element; if the element (or its ledge) went,
    // the ledge states see no ledge and fall (mpLib_80054ED8).
    if (fp.ledge) {
      const bit = fp.ledge.side === 1 ? 1 : 2, seg = counterpart(fp.ledge.seg);
      fp.ledge = seg && seg.ledges & bit ? { seg, side: fp.ledge.side } : null;
    }
    this.stage = stage;
  }

  // ------------------------------------------------------------------ one frame
  /** One frame for a fighter on its own (a World runs the same phases for every fighter in turn). */
  step(pad: PadState): void {
    if (this.world) { this.world.step([pad]); return; }
    this.beginFrame(pad);
    this.procHitlag();
    this.procAnim();
    this.itemsAnim();
    this.procInput();
    this.procUpdate();
    this.itemsPhys();
    this.procMap();
    this.collPos();
    collResolve(this);
    this.endFrame();
  }

  beginFrame(pad: PadState): void {
    this.events.length = 0;
    for (const p of this.plugins) p.input?.(this, pad);
    padToFloats(pad, this.pad);
    Object.assign(this.rawPad, pad);
    this.ucf.cardinals(pad, this.pad);
    this.frame++;
    // Attributes for this frame (the moon gravity plugin edits a copy, never the data).
    Object.assign(this.a, this.data.attrs);
    for (const p of this.plugins) { const r = p.attributes?.(this, this.a); if (r) Object.assign(this.a, r); }
    for (const p of this.plugins) p.frameStart?.(this);
  }

  /** After damage: the blast zones (a KO respawns), then the plugins' end of frame. */
  endFrame(): void {
    const fp = this.fighter;
    const [l, r, b, t] = this.blast ?? this.stage.blast;
    if (fp.pos.x < l || fp.pos.x > r || fp.pos.y < b || (this.world && fp.pos.y > t)) {
      this.events.push({ type: 'ko', frame: this.frame });
      const [sx, sy] = this.world?.spawnPoint(this) ?? this.stage.spawn;
      this.spawn(sx, sy, fp.facing);
    }
    for (const p of this.plugins) p.frameEnd?.(this);
  }

  // ---- Fighter_procHitlag
  procHitlag(): void {
    const fp = this.fighter;
    if (fp.hitlag > 0) {
      fp.hitlag -= 1;
      if (fp.hitlag <= 0) {
        fp.hitlag = 0;
        this.exitHitlag();
        fp.allowSdi = false;
      }
    }
  }

  /** Fighter_8006D10C: hitlag ends (post_hitlag_cb, then unfreeze). */
  exitHitlag(): void {
    const fp = this.fighter;
    hitlagAsdi(this);
    if (fp.postHitlag === 'damage') damageExitHitlag(this);
    fp.postHitlag = null;
    fp.inHitlag = false;
  }

  /** Fighter_UnkRecursiveFunc_8006D044: freeze for hitlag. */
  enterHitlag(): void {
    this.fighter.inHitlag = true;
  }

  // ---- Fighter_procAnim
  procAnim(): void {
    const fp = this.fighter;
    // Intangibility (x1990, a ledge catch) and the invincibility after a strong launch (x1994) run out.
    if (fp.intangibleFrames) { fp.intangibleFrames -= 1; if (!fp.intangibleFrames) fp.intangible = false; }
    if (fp.invincibleFrames) { fp.invincibleFrames -= 1; if (!fp.invincibleFrames) fp.invincible = false; }
    if (!fp.inHitlag) {
      if (fp.sinceHit !== -1) fp.sinceHit++;
      this.animStep();
      this.smashChargeTick();
      this.def().anim?.(this);
    }
    // ftCommon_8007E0E4: grounded fighters overlapping each other get pushed apart.
    fp.nudge = this.world ? fighterNudge(this, this.world.fighters) : 0;
  }

  /** ftCo_800DEF38: count charge frames; a full charge releases on its own. */
  private smashChargeTick(): void {
    const s = this.fighter.smash;
    if (s.state !== Smash.Charging) return;
    s.frames++;
    if (s.frames >= s.hold) {
      s.frames = s.hold;
      s.state = Smash.Release;
      this.setAnimRate(s.rate);
    }
    if (!s.sfx && s.frames >= this.c.smash_charge_sound_frame) { this.playSound(0x7b); s.sfx = true; }
  }

  /** ftCo_800DF0D0: holding A turns a pending charge into a charge; letting go releases it. */
  private smashChargeInput(): void {
    const fp = this.fighter, s = fp.smash;
    if (s.state === Smash.PreCharge) {
      if (fp.input.held & BTN.A) {
        s.state = Smash.Charging;
        s.rate = fp.animRate;
        s.sfx = false;
        this.setAnimRate(0);
      } else s.state = Smash.None;
    } else if (s.state === Smash.Charging && !(fp.input.held & BTN.A)) {
      s.state = Smash.Release;
      this.setAnimRate(s.rate);
    }
  }

  /** ftAnim_8006EBA4: advance the animation, then run the script at the new frame. */
  animStep(skipEvents = false): void {
    this.animAdvance();
    runScript(this.fighter, this, skipEvents);
  }

  /** ftAnim_8006E9B4 on the HSD AObj model. */
  animAdvance(): void {
    const fp = this.fighter;
    if (!fp.move) return;
    const prev = fp.animFrame;
    if (!fp.animDone) {
      if (fp.animFirst) fp.animFirst = false;
      else fp.animFrame = f(fp.animFrame + fp.animRate);
      if (fp.animLoop && fp.animEnd <= fp.animFrame) {
        fp.animFrame = fp.animEnd > 0 ? f(fp.animFrame % fp.animEnd) : 0;
      } else if (!fp.animLoop && fp.animEnd <= fp.animFrame) {
        fp.animDone = true;
      }
    }
    if ((fp.move.animFlags & 0x20000000) && fp.animFrame < prev) fp.frameAccum = f(fp.frameAccum + prev + fp.animRate);
    fp.poseDirty = true;
    if (fp.move.animFlags & 0x80000000) this.sampleRootMotion();
  }

  /** ftAnim: TransN's translation this frame (scaled like the model) and its change since the last one. */
  private sampleRootMotion(): void {
    const fp = this.fighter, joint = this.data.transN, o = joint * 9;
    let x = this.rest[o + 6], y = this.rest[o + 7], z = this.rest[o + 8];
    for (const t of fp.move?.anim?.tracks[joint] ?? []) {
      if (t.channel < 5 || t.channel > 7) continue;
      const v = sampleTrack(t, fp.animFrame);
      if (v === undefined) continue;
      if (t.channel === 5) x = v; else if (t.channel === 6) y = v; else z = v;
    }
    const s = this.data.modelScale, r = fp.rootPos, d = fp.rootDelta;
    x = f(x * s); y = f(y * s); z = f(z * s);
    d.x = f(x - r.x); d.y = f(y - r.y); d.z = f(z - r.z);
    r.x = x; r.y = y; r.z = z;
  }

  isFramesRemaining(): boolean { return !this.fighter.animDone; }

  setAnimRate(rate: number): void { this.fighter.animRate = f(rate); }

  /** End frame of the current animation (ftAnim_8006F484). */
  animEndFrame(): number { return this.fighter.animEnd; }

  // ---- Fighter_procInput
  procInput(): void {
    const fp = this.fighter, c = this.c, inp = fp.input, t = fp.timers, k = fp.counters;
    this.ucf.record(this.rawPad);
    const pad = this.pad;
    if (!fp.hasPrevInput) {
      inp.plx = inp.lx; inp.ply = inp.ly; inp.pcx = inp.cx; inp.pcy = inp.cy; inp.ptrigger = inp.trigger; inp.pheld = inp.held;
      fp.hasPrevInput = true;
    } else {
      inp.plx = inp.lx; inp.ply = inp.ly; inp.pcx = inp.cx; inp.pcy = inp.cy; inp.ptrigger = inp.trigger; inp.pheld = inp.held;
    }
    inp.lx = pad.stickX; inp.ly = pad.stickY; inp.cx = pad.cX; inp.cy = pad.cY;
    inp.trigger = pad.analogL > pad.analogR ? pad.analogL : pad.analogR;
    if (Math.abs(inp.lx) <= c.stick_deadzone_x) inp.lx = 0;
    if (Math.abs(inp.ly) <= c.stick_deadzone_y) inp.ly = 0;
    if (Math.abs(inp.cx) <= c.stick_deadzone_x) inp.cx = 0;
    if (Math.abs(inp.cy) <= c.stick_deadzone_y) inp.cy = 0;
    if (inp.trigger <= c.shoulder_deadzone) inp.trigger = 0;
    let held = pad.buttons >>> 0;
    if (held & (BTN.L | BTN.R)) { held = (held | PAD_LR) >>> 0; inp.trigger = 1; }
    else if (inp.trigger) held = (held | PAD_LR) >>> 0;
    if (held & BTN.Z) { held = (held | PAD_LR | BTN.A) >>> 0; inp.trigger = c.z_analog_value; }
    inp.held = held;
    // Fighter_procInput_Inner1: during hitlag presses pile up until the fighter can act on them.
    const pressed = (held & ((inp.pheld ^ held) >>> 0)) >>> 0, released = (inp.pheld & ((inp.pheld ^ held) >>> 0)) >>> 0;
    if (fp.inHitlag) { inp.pressed = (inp.pressed | pressed) >>> 0; inp.released = (inp.released | released) >>> 0; }
    else { inp.pressed = pressed; inp.released = released; }

    const clamp = (v: number) => (v > 254 ? 254 : v);
    t.lxDuration = clamp(t.lxDuration + 1);
    const sdx = c.smash_deadzone_x, sdy = c.smash_deadzone_y;
    if (inp.lx >= sdx) {
      if (inp.plx >= sdx) { t.lxTimer = clamp(t.lxTimer + 1); t.lxSticky = clamp(t.lxSticky + 1); t.lxActivity = clamp(t.lxActivity + 1); }
      else { t.lxDuration = 0; t.lxSticky = 0; t.lxTimer = 0; fp.x2228_b7 = 1; }
    } else if (inp.lx <= -sdx) {
      if (inp.plx <= -sdx) { t.lxTimer = clamp(t.lxTimer + 1); t.lxSticky = clamp(t.lxSticky + 1); t.lxActivity = clamp(t.lxActivity + 1); }
      else { t.lxDuration = 0; t.lxSticky = 0; t.lxTimer = 0; fp.x2228_b7 = 0; }
    } else { t.lxActivity = 254; t.lxSticky = 254; t.lxTimer = 254; }
    t.lyDuration = clamp(t.lyDuration + 1);
    if (inp.ly >= sdy) {
      if (inp.ply >= sdy) { t.lyTimer = clamp(t.lyTimer + 1); t.lySticky = clamp(t.lySticky + 1); t.lyActivity = clamp(t.lyActivity + 1); }
      else { t.lyDuration = 0; t.lySticky = 0; t.lyTimer = 0; fp.x2229_b0 = 0; }
    } else if (inp.ly <= -sdy) {
      if (inp.ply <= -sdy) { t.lyTimer = clamp(t.lyTimer + 1); t.lySticky = clamp(t.lySticky + 1); t.lyActivity = clamp(t.lyActivity + 1); }
      else { t.lyDuration = 0; t.lySticky = 0; t.lyTimer = 0; fp.x2229_b0 = 1; }
    } else { t.lyActivity = 254; t.lySticky = 254; t.lyTimer = 254; }
    if (inp.trigger >= c.shield_press_threshold) {
      t.trigTimer = inp.ptrigger >= c.shield_press_threshold ? clamp(t.trigTimer + 1) : 0;
    } else t.trigTimer = 254;

    const pr = inp.pressed;
    if (pr & BTN.A) { k.aPrev = k.a; k.a = 0; } else if (k.a < 255) k.a++;
    if (pr & BTN.B) k.b = 0; else if (k.b < 255) k.b++;
    if (pr & PAD_XY) k.xy = 0; else if (k.xy < 255) k.xy++;
    if (pr & BTN.DUP) k.dUp = 0; else if (k.dUp < 255) k.dUp++;
    if (pr & BTN.DDOWN) k.dDown = 0; else if (k.dDown < 255) k.dDown++;
    // The L-cancel counter (fp->x67F): frames since the last press of L/R/analog/Z.
    if (pr & PAD_LR) k.lr = 0; else if (k.lr < 255) k.lr++;
    if (pr & (BTN.L | BTN.R)) { k.lrDigitalPrev = k.lrDigital; k.lrDigital = 0; } else if (k.lrDigital < 255) k.lrDigital++;
    this.ucf.afterInput(fp);
    if (fp.inHitlag) return;
    this.smashChargeInput();
    // Fighter_UnkIncrementCounters_8006ABEC
    if (this.jumpInput()) { k.jumpPrev = k.jump; k.jump = 0; } else if (k.jump < 255) k.jump++;
    if ((pr & BTN.B) && inp.ly >= c.special_lw_threshold) { k.upBPrev = k.upB; k.upB = 0; } else if (k.upB < 255) k.upB++;
    if ((pr & BTN.B) && inp.ly < -c.special_lw_threshold) k.downB = 0; else if (k.downB < 255) k.downB++;
    // ftCo_SpecialS_HasInput and ftCo_800D67C4 (side and neutral B).
    if ((pr & BTN.B) && Math.abs(inp.lx) >= c.special_s_threshold) k.sideB = 0; else if (k.sideB < 255) k.sideB++;
    if ((pr & BTN.B) && Math.abs(inp.lx) < c.special_s_threshold && Math.abs(inp.ly) < c.special_lw_threshold) k.neutralB = 0;
    else if (k.neutralB < 255) k.neutralB++;

    this.def().iasa?.(this);
  }

  /** ftCo_Jump_GetInput: 1 = stick (tap jump), 2 = X/Y, 0 = none. */
  jumpInput(): number {
    const fp = this.fighter, c = this.c;
    if (fp.input.ly >= c.tap_jump_threshold && fp.timers.lyTimer < c.tap_jump_window) return 1;
    if (fp.input.pressed & PAD_XY) return 2;
    return 0;
  }

  // ---- Fighter_procUpdate
  procUpdate(): void {
    const fp = this.fighter, c = this.c;
    this.lastPos.x = fp.pos.x; this.lastPos.y = fp.pos.y;
    fp.prevPos.x = fp.pos.x; fp.prevPos.y = fp.pos.y;
    if (fp.inHitlag) { hitlagSdi(this); return; }
    if (fp.ledgeCooldown) fp.ledgeCooldown -= 1;
    this.def().phys?.(this);
    // Knockback velocity decays: in the air along its own direction (Sandbag per axis, by its own
    // deceleration); on the ground by friction, along the floor.
    const kb = fp.kbVel;
    if (kb.x !== 0 || kb.y !== 0) {
      if (fp.ga === GA.Air) {
        if (this.data.id === 'sandbag') {
          kb.x = sandbagDecel(kb.x, this.data.special.kb_decel_x ?? 0);
          kb.y = sandbagDecel(kb.y, this.data.special.kb_decel_y ?? 0.051);
        } else {
          const angle = Math.atan2(kb.y, kb.x);
          if (Math.sqrt(kb.x * kb.x + kb.y * kb.y) < c.kb_decay) kb.x = kb.y = 0;
          else { kb.x = f(kb.x - f(c.kb_decay * Math.cos(angle))); kb.y = f(kb.y - f(c.kb_decay * Math.sin(angle))); }
        }
        fp.groundKbVel = 0;
      } else {
        if (fp.groundKbVel === 0) fp.groundKbVel = kb.x;
        // ftCommon_ApplyGroundedKnockbackFriction (floors are flat: normal (0, 1)).
        const friction = f(this.a.ground_friction * c.ground_kb_friction_mul);
        if (fp.groundKbVel < 0) { fp.groundKbVel = f(fp.groundKbVel + friction); if (fp.groundKbVel > 0) fp.groundKbVel = 0; }
        else { fp.groundKbVel = f(fp.groundKbVel - friction); if (fp.groundKbVel < 0) fp.groundKbVel = 0; }
        kb.x = fp.groundKbVel; kb.y = 0;
      }
    }
    fp.grVel = f(fp.grVel + fp.grAccel1 + fp.grAccel2);
    fp.grAccel1 = fp.grAccel2 = 0;
    fp.selfVel.x = f(fp.selfVel.x + fp.selfAccel.x);
    fp.selfVel.y = f(fp.selfVel.y + fp.selfAccel.y);
    fp.selfAccel.x = fp.selfAccel.y = 0;
    fp.pos.x = f(fp.pos.x + fp.nudge);
    fp.pos.x = f(f(fp.pos.x + fp.selfVel.x) + kb.x);
    fp.pos.y = f(f(fp.pos.y + fp.selfVel.y) + kb.y);
  }

  // ---- Fighter_procMap
  procMap(): void {
    const fp = this.fighter;
    if (fp.ecbLock) { fp.ecbLock--; if (!fp.ecbLock) fp.ecbLocked = false; }
    this.updatePose();
    loadEcb(fp, this.data.ecbBones, this.data.ecbSideOffset, fp.ga === GA.Ground ? ECB_GROUND : ECB_AIR);
    this.def().coll?.(this);
  }

  /** Position before this frame's movement (collision sweeps from here). */
  get moveStart(): { x: number; y: number } { return this.lastPos; }

  /** Pose of the current animation frame: local channels and world matrices relative to the fighter. */
  updatePose(): void {
    const fp = this.fighter;
    if (!fp.poseDirty) return;
    fp.poseDirty = false;
    fp.local.set(this.rest);
    const move = fp.move;
    if (move?.anim) {
      applyAnim(move.anim, Math.max(0, fp.animFrame), fp.local);
      // Root-motion animations: the game moves TransN's translation into the fighter's velocity.
      if (move.animFlags & 0x80000000) { const o = this.data.transN * 9; fp.local[o + 6] = fp.local[o + 7] = fp.local[o + 8] = 0; }
    }
    this.quats.on.fill(0);
    if (fp.blend.weight && fp.blend.move?.anim) this.blendPose();
    // ftPartSetRotX on XRotN (Firefox points Fox along his flight).
    const xRotN = this.data.parts[2];
    if (!Number.isNaN(fp.xRot) && xRotN !== undefined) fp.local[xRotN * 9] = fp.xRot;
    // Root: its Y rotation (set from the facing on each motion change) and model scale.
    fp.local[1] = fp.rootRotY;
    const s = this.data.modelScale;
    fp.local[3] = fp.local[4] = fp.local[5] = s;
    worldMatrices(this.data.skeleton, fp.local, fp.world, this.scratch, null, this.quats);
    if (this.data.constraints.length) applyConstraints(this.data.skeleton, this.data.constraints, fp.local, fp.world, this.scratch);
  }

  /**
   * ftAnim_8006FE9C / 8006FF74: the second animation's pose over the main one, for every part from
   * TransN on. Translation and scale mix linearly; rotations are slerped as quaternions (lb_8000C490)
   * unless they're within 0.0001 already. TransN and part 0x35 (flags_b4), and everything at weight 1,
   * take the second pose outright. Bones moved by dynamics (flags_b0) aren't simulated here.
   */
  private blendPose(): void {
    const fp = this.fighter, b = fp.blend, L = fp.local, S = this.blendLocal, q = this.quats.q;
    S.set(this.rest);
    applyAnim(b.move!.anim!, Math.max(0, b.frame), S);
    const t = b.weight, ti = f(1 - t), parts = this.data.parts;
    for (let part = 1; part < parts.length; part++) {
      const j = parts[part];
      if (j === undefined || j < 0 || j >= this.data.skeleton.length) continue;
      const o = j * 9;
      if (t === 1 || part === 1 || part === 0x35) { for (let k = 0; k < 9; k++) L[o + k] = S[o + k]; continue; }
      for (let k = 3; k < 9; k++) L[o + k] = f(S[o + k] * t + L[o + k] * ti);
      if (Math.abs(S[o] - L[o]) <= 0.0001 && Math.abs(S[o + 1] - L[o + 1]) <= 0.0001 && Math.abs(S[o + 2] - L[o + 2]) <= 0.0001) {
        L[o] = S[o]; L[o + 1] = S[o + 1]; L[o + 2] = S[o + 2];
        continue;
      }
      const q1 = this.quatTmp;
      eulerToQuat(S[o], S[o + 1], S[o + 2], q1, 0);
      eulerToQuat(L[o], L[o + 1], L[o + 2], q1, 4);
      let sums = 0, diffs = 0;
      for (let k = 0; k < 4; k++) { sums += (q1[k] + q1[4 + k]) ** 2; diffs += (q1[k] - q1[4 + k]) ** 2; }
      if (diffs > sums) for (let k = 4; k < 8; k++) q1[k] = -q1[k];
      slerp(q1, 0, q1, 4, q, j * 4, ti);
      this.quats.on[j] = 1;
    }
  }

  /** Starts the blended second animation at `frame` (ftAnim_8006EDD0); its first step doesn't advance. */
  setBlendAnim(moveName: string, frame: number): void {
    const b = this.fighter.blend;
    b.move = this.data.moves.get(moveName) ?? null;
    b.frame = frame;
    b.first = true;
    this.fighter.poseDirty = true;
  }

  /** HSD_JObjAnimAll on the second animation: one frame at rate 1 (AObj rules, like animAdvance). */
  blendAnimStep(): void {
    const b = this.fighter.blend, m = b.move;
    if (!m?.anim) return;
    const end = m.anim.frameCount;
    if (b.first) b.first = false;
    else if (b.frame < end || (m.animFlags & 0x40000000)) b.frame = f(b.frame + 1);
    if ((m.animFlags & 0x40000000) && end <= b.frame) b.frame = end > 0 ? f(b.frame % end) : 0;
    this.fighter.poseDirty = true;
  }

  // ------------------------------------------------------------------ state machine
  /** The character's own state for a motion id, or the common one. */
  stateOf(msid: number): StateDef | undefined { return this.data.kit.states.get(msid) ?? STATES.get(msid); }
  /** Its special-move entry points (ftData_SpecialN/S/Hi/Lw). */
  get specials(): SpecialHooks { return this.data.kit.specials; }
  def(): StateDef { return this.stateOf(this.fighter.motionId) ?? STATES.get(MS.Fall)!; }

  /** Fighter_ChangeMotionState (ft/fighter.c:935), the parts v1 uses. */
  changeMotion(msid: number, flags: number, animStart = 0, animSpeed = 1): void {
    const fp = this.fighter;
    const def = this.stateOf(msid);
    if (!def) return; // states outside v1 are never entered
    const from = fp.motionName;
    if (from) for (const p of this.plugins) p.stateExit?.(this, from);
    // ft_800890D0: a new attack (for stale moves) whenever the move id changes or is the default.
    const moveId = msid >= 341 ? this.data.moveIds.get(msid) ?? 1 : moveIdOf(msid);
    if (moveId === 1 || moveId !== fp.attackId) { fp.attackId = moveId; fp.attackInstance = nextAttackInstance(); }
    const hadRootMotion = !!fp.move && (fp.move.animFlags & 0x80000000) !== 0;
    fp.motionId = msid;
    fp.motionName = def.name;
    fp.facing1 = fp.facing;
    if (!(flags & MF.SkipHit)) for (const h of fp.hitboxes) h.active = false;
    fp.reflecting = false;
    fp.shielding = false; // the shield states raise it again
    // The new animation sets every joint again, so a blended second animation ends with the state.
    fp.blend.move = null; fp.blend.weight = 0;
    fp.onDealDamage = null; fp.onDetect = null;
    fp.bodyState = 0; // Fighter_ChangeMotionState: the script sets it again (ftColl_8007B62C)
    if (!(flags & MF.KeepFastFall)) fp.fallFast = false;
    fp.floorSkip = null;
    fp.lstickAngle = 0;
    fp.xRot = NaN;
    fp.rootRotY = Math.PI / 2 * fp.facing; // ftPartSetRotY(fp, 0, M_PI_2 * facing_dir)
    fp.smash.state = Smash.None;
    if (!KEEPS_JAB_WINDOW(msid)) fp.jabWindow = 0;
    if (!(flags & MF.KeepGhosts)) fp.ghosts.length = fp.ghostRot.length = 0;
    const behavior = this.behaviors.get(def.move) ?? null;
    const move = this.data.moves.get(def.move) ?? null;
    fp.move = move;
    fp.animRate = f(animSpeed);
    fp.frameAccum = 0;
    fp.animLoop = !!move && (move.animFlags & 0x40000000) !== 0;
    fp.animEnd = move?.anim?.frameCount ?? 0;
    fp.animDone = !move?.anim;
    // ftAnim_8006EBE8 + ftAnim_8006E9B4: request the animation, first interpret does not advance.
    fp.animFrame = f(animStart ? animStart - animSpeed : 0);
    fp.animFirst = true;
    const d = fp.rootDelta;
    if (def.poseOnly) {
      // anim_id -1: no animation runs (the frame reads anim_start - rate) and no script. The move's
      // animation is only there for the renderer.
      fp.animFrame = f(animStart - animSpeed);
      fp.animDone = true;
      startScript(fp, null, 0);
      d.x = d.y = d.z = 0;
      fp.poseDirty = true;
    } else {
      const rootMotion = !!move && (move.animFlags & 0x80000000) !== 0;
      if (animStart) { this.animAdvance(); d.x = d.y = d.z = 0; }
      startScript(fp, move, animStart);
      this.animAdvance();
      fp.poseDirty = true;
      // The first frame of a root-motion animation carries no motion; one started mid-way keeps its
      // speed. Without root motion there is none to read.
      if (!rootMotion || !animStart) d.x = d.y = d.z = 0;
      else if (!(flags & MF.SkipAnimVel) && fp.ga === GA.Ground) fp.selfVel.x = fp.grVel = f(d.z * fp.facing);
      // Script frame 0 (or the frame we started at).
      if (flags & MF.UpdateCmd) runScript(fp, this, true);
      else runScript(fp, this, false);
    }
    // Leaving a root-motion animation clamps ground speed to dash speed.
    if (hadRootMotion && !(move && move.animFlags & 0x80000000)) clampGroundVel(fp, this.a.dash_max_velocity);
    void behavior;
    this.events.push({ type: 'state', from, to: def.name, frame: this.frame });
    for (const p of this.plugins) p.stateEnter?.(this, def.name);
  }

  // ------------------------------------------------------------------ script commands
  exec(fp: Fighter, c: Cmd): void {
    switch (c.op) {
      case 'hitbox': {
        // ftAction_8007121C.
        const h = fp.hitboxes[c.f.id & 3];
        if (!h.active || h.group !== c.f.group) {
          h.group = c.f.group; h.active = true; h.fresh = true;
          // ftColl_800768A0: a new hitbox shares the victims of an active one in its group.
          const other = fp.hitboxes.find((o) => o !== h && o.active && o.group === h.group);
          h.victims = other ? new Set(other.victims) : new Set();
          h.tipVictims = other ? new Set(other.tipVictims) : new Set();
        }
        h.bone = c.f.common_bone ? this.data.parts[c.f.bone] ?? 0 : c.f.bone;
        this.setHitboxDamage(h, c.f.damage);
        h.size = c.f.size;
        h.offset[0] = c.f.z; h.offset[1] = c.f.y; h.offset[2] = c.f.x;
        h.angle = c.f.angle; h.kbg = c.f.kbg; h.bkb = c.f.bkb; h.wkb = c.f.wkb; h.element = c.f.element;
        h.sfxLevel = c.f.sfx_level; h.sfxKind = c.f.sfx_kind;
        h.shieldDamage = c.f.shield;
        h.ground = !!c.f.ground; h.air = !!c.f.air; h.fighters = true;
        break;
      }
      case 'hitbox_damage': this.setHitboxDamage(fp.hitboxes[c.id & 3], c.value); break;
      case 'hitbox_size': fp.hitboxes[c.id & 3].size = c.value; break;
      // ftAction_80071708: x42_b5 (hits fighters); x42_b7 only matters for items, which aren't modelled.
      case 'hitbox_flag': if (!c.which) fp.hitboxes[c.id & 3].fighters = !!c.value; break;
      case 'remove_hitbox': fp.hitboxes[c.id & 3].active = false; break;
      case 'clear_hitboxes': for (const h of fp.hitboxes) h.active = false; break;
      case 'sound':
        if (c.behavior <= 6) this.playSound(c.id, c.volume, c.pan);
        break;
      case 'footstep':
        // ftAction_80072CD8 on a plain floor (no material sound): the command's own sound plays.
        this.playSound(c.id, (c.w2 >>> 8) & 0xff, c.w2 & 0xff);
        break;
      case 'landing_sound':
        // ftAction_80072E4C: the landing thud (0x46), then the command's sound unless flagged off.
        this.playSound(0x46);
        if (!((c.w0 >>> 16) & 1)) this.playSound(c.id, (c.w2 >>> 8) & 0xff, c.w2 & 0xff);
        break;
      case 'var': fp.cmdVars[c.idx] = c.value; break;
      case 'iasa': fp.allowInterrupt = true; break;
      case 'reverse': fp.throwFlags |= 1 << 3; fp.mv.throwTimer = fp.script.timer; break;
      case 'flag20': fp.throwFlags |= 1 << 4; break;
      case 'body_state': fp.bodyState = c.state; break;
      case 'airborne':
        if (c.state === 0) this.toGround();
        else if (c.state === 1) this.toAirKeepJumps(10);
        else if (c.state === 2) this.toAirNoJumps();
        break;
      case 'jab_combo': if (!c.disabled) fp.jabCombo = true; break;
      case 'rapid_jab': fp.jabRapid = c.state !== 0; break;
      case 'smash_charge': {
        // ftCo_800DEE84: pending until the input step sees A still held.
        const s = fp.smash;
        s.state = Smash.PreCharge; s.frames = 0; s.hold = c.frames; s.damageMul = f(c.rate * 0.003906);
        break;
      }
      default: break;
    }
  }

  // ------------------------------------------------------------------ ground/air transitions
  /** ftCommon_8007D5D4: become airborne (one jump used, ECB bottom locked for 10 frames). */
  toAir(): void {
    const fp = this.fighter;
    fp.ga = GA.Air;
    fp.grVel = 0;
    fp.selfAccel.y = 0;
    fp.jumpsUsed = 1;
    fp.floor = null;
    fp.ecbLock = 10;
    fp.ecbLocked = true;
  }

  private toAirKeepJumps(lock: number): void {
    const fp = this.fighter;
    fp.ga = GA.Air; fp.grVel = 0; fp.selfAccel.y = 0; fp.floor = null;
    fp.ecbLock = lock; fp.ecbLocked = true;
  }

  /** ftCommon_8007D60C: airborne with all jumps used (5-frame ECB lock). */
  toAirNoJumps(): void {
    const fp = this.fighter;
    fp.ga = GA.Air; fp.grVel = 0; fp.selfAccel.y = 0;
    fp.jumpsUsed = this.a.max_jumps;
    fp.floor = null;
    fp.ecbLock = 5; fp.ecbLocked = true;
  }

  /** ftCommon_8007D6A4 / 8007D7FC: land (self velocity becomes ground velocity). */
  toGround(): void {
    const fp = this.fighter;
    // A root-motion animation lands at its own speed (x594_b0: TransN's step this frame).
    if (fp.move && (fp.move.animFlags & 0x80000000)) fp.selfVel.x = f(fp.rootDelta.z * fp.facing);
    // ftCommon_ClampGroundVel runs on the old ground speed, which is then replaced unclamped.
    clampGroundVel(fp, this.a.ground_max_horizontal_velocity);
    fp.grVel = fp.selfVel.x;
    fp.ga = GA.Ground;
    fp.jumpsUsed = 0;
    fp.ecbLock = 0;
    fp.ecbLocked = false;
  }

  emitLanding(lag: number, lcancel: boolean): void {
    this.events.push({ type: 'land', frame: this.frame, lag, lcancel });
    for (const p of this.plugins) p.landing?.(this, lag);
  }

  // ------------------------------------------------------------------ joints and projectiles
  /** World position (Melee units) of a point in a joint's space (lb_8000B1CC). */
  jointPoint(joint: number, ox: number, oy: number, oz: number): [number, number] {
    this.updatePose();
    const fp = this.fighter, w = fp.world, m = joint * 12;
    return [
      f(fp.pos.x + w[m] * ox + w[m + 1] * oy + w[m + 2] * oz + w[m + 3]),
      f(fp.pos.y + w[m + 4] * ox + w[m + 5] * oy + w[m + 6] * oz + w[m + 7]),
    ];
  }

  /** World position with depth of a point in a joint's space. */
  jointPoint3(joint: number, ox: number, oy: number, oz: number, out: [number, number, number]): void {
    this.updatePose();
    const fp = this.fighter, w = fp.world, m = joint * 12;
    out[0] = f(fp.pos.x + w[m] * ox + w[m + 1] * oy + w[m + 2] * oz + w[m + 3]);
    out[1] = f(fp.pos.y + w[m + 4] * ox + w[m + 5] * oy + w[m + 6] * oz + w[m + 7]);
    out[2] = f(w[m + 8] * ox + w[m + 9] * oy + w[m + 10] * oz + w[m + 11]);
  }

  /** ft_800892A0: the same move starts a new attack (a new rapid jab loop, a repeated down tilt). */
  renewAttack(): void {
    this.fighter.attackInstance = nextAttackInstance();
  }

  /** ftColl_8007ABD0: a hitbox's damage, scaled by a charged smash and reduced by staling. */
  setHitboxDamage(h: HitboxState, damage: number): void {
    const s = this.fighter.smash;
    const scaled = s.state === Smash.Release ? f(damage * f(f((s.damageMul - 1) * f(s.frames / s.hold)) + 1)) : damage;
    h.count = Math.trunc(scaled);
    h.damage = f(scaled * staleMultiplier(this.fighter, this.fighter.attackId, this.c));
  }

  /** Fires Fox's blaster shot: an item flying at `angle` (it_8029C504), with its own hitbox script. */
  fireProjectile(kind: string, x: number, y: number, angle: number, speed: number, lifetime: number): Projectile {
    let a = angle;
    while (a < 0) a += Math.PI * 2;
    while (a > Math.PI * 2) a -= Math.PI * 2;
    const fp = this.fighter;
    const p: Projectile = {
      kind, x, y, prevX: x, prevY: y, vx: f(speed * Math.cos(a)), vy: f(speed * Math.sin(a)), angle: a, age: 0, lifetime,
      scale: 0, speed, facing: a < Math.PI / 2 || a > Math.PI * 1.5 ? 1 : -1, hitboxes: Array.from({ length: 4 }, (_, id) => newHitbox(id)),
      script: this.data.laser ? { cmds: this.data.laser.states[0], pc: 0, timer: 0 } : null,
      attackId: fp.attackId, attackInstance: fp.attackInstance, hit: false, dead: false,
    };
    this.projectiles.push(p);
    this.itemScript(p, true);
    this.events.push({ type: 'projectile', projectile: p, frame: this.frame });
    return p;
  }

  /**
   * The side special's afterimage (it_8029CEB4 / it_8029CFF0): where the fighter stands, facing its
   * way, in item state 0 from the ground or 1 from the air, whose script puts up the hitbox at once.
   */
  spawnAfterimage(): void {
    const art = this.data.illusion;
    if (!art) return;
    const fp = this.fighter, state = fp.ga === GA.Air ? 1 : 0;
    const a: Afterimage = {
      x: fp.pos.x, y: fp.pos.y, facing: fp.facing, rotX: 0, state, timer: art.lifetime, age: 0,
      hitboxes: Array.from({ length: 4 }, (_, id) => newHitbox(id)),
      script: { cmds: art.states[state] ?? [], pc: 0, timer: 0 },
      attackId: fp.attackId, attackInstance: fp.attackInstance, dead: false,
    };
    this.afterimages.push(a);
    this.itemScript(a, true, art.scale);
  }

  /**
   * The item's command script (it/itanimlist.c it_802799E4): wait, hitboxes, damage changes, removal.
   * The run at spawn (Item_80268E5C) starts from timer 0; later ones count the timer down first.
   * Item hitboxes are tested at their size times the item's scale (lbColl_8000805C: x43_b1 is never set).
   */
  private itemScript(p: Pick<Projectile, 'script' | 'hitboxes' | 'attackId'>, first = false, scale = 1): void {
    const s = p.script;
    if (!s) return;
    if (!first) s.timer -= 1;
    while (s.timer <= 0 && s.pc < s.cmds.length) {
      const c: ItemCmd = s.cmds[s.pc++];
      switch (c.op) {
        case 'wait': s.timer += c.n; break;
        case 'hitbox': {
          const h = p.hitboxes[c.id & 3];
          if (!h.active || h.group !== c.group) { h.group = c.group; h.active = true; h.fresh = true; h.victims = new Set(); h.tipVictims = new Set(); }
          h.bone = 0; h.count = c.damage; h.damage = f(c.damage * staleMultiplier(this.fighter, p.attackId, this.c));
          h.size = f(c.size * scale); h.offset[0] = c.offset[0]; h.offset[1] = c.offset[1]; h.offset[2] = c.offset[2];
          h.angle = c.angle; h.kbg = c.kbg; h.wkb = c.wkb; h.bkb = c.bkb; h.element = c.element; h.sfxLevel = c.sfxLevel; h.sfxKind = c.sfxKind;
          h.ground = !!c.ground; h.air = !!c.air; h.fighters = !!c.fighters;
          break;
        }
        case 'hitbox_damage': { const h = p.hitboxes[c.id & 3]; h.count = c.value; h.damage = f(c.value * staleMultiplier(this.fighter, p.attackId, this.c)); break; }
        case 'remove_hitbox': p.hitboxes[c.id & 3].active = false; break;
        case 'clear_hitboxes': for (const h of p.hitboxes) h.active = false; break;
      }
    }
  }

  /** Items' animation step (priority 1): the ray grows (Item_UpdateRayAnimation) and runs its script. */
  itemsAnim(): void {
    for (const p of this.projectiles) {
      if (p.age === 0) continue; // spawned this frame: its first update already ran
      p.vx = f(p.speed * Math.cos(p.angle)); p.vy = f(p.speed * Math.sin(p.angle));
      p.facing = p.vx > 0 ? 1 : -1;
      this.itemScript(p);
    }
    // itFoxillusion_UnkMotion0/1/2_Anim: gone once the fighter leaves the side special
    // (ftFx_SpecialS_CheckGhostRemove); otherwise it hits for its lifetime, then fades without a hitbox.
    const art = this.data.illusion, msid = this.fighter.motionId;
    for (const a of this.afterimages) {
      if (a.age === 0 || a.dead) continue;
      this.itemScript(a, false, art?.scale);
      if (!art || msid < FX_SPECIAL_S_FIRST || msid > FX_SPECIAL_S_LAST) { a.dead = true; continue; }
      a.timer -= 1;
      if (a.timer > 0) continue;
      if (a.state === 2) { a.dead = true; continue; }
      // it_8029D798: the fading state, with its own script (it clears the hitbox).
      a.state = 2;
      a.timer = art.endLifetime;
      a.script = { cmds: art.states[2] ?? [], pc: 0, timer: 0 };
      this.itemScript(a, true, art.scale);
    }
  }

  /** Items' physics (priority 4): move, age, and go when the lifetime is over or they dealt damage. */
  itemsPhys(): void {
    const list = this.projectiles, max = this.data.laser?.scale ?? 3;
    let n = 0;
    for (const p of list) {
      p.scale = f(p.scale + Math.abs(p.speed) / 11.25);
      if (p.scale > max) p.scale = max;
      p.prevX = p.x; p.prevY = p.y;
      p.x = f(p.x + p.vx); p.y = f(p.y + p.vy);
      if (++p.age < p.lifetime && !p.dead) list[n++] = p;
    }
    list.length = n;
    // itFoxillusion_Phys: the afterimage sits on the trail one frame behind the fighter
    // (ghostEffectPos[1]), turned like him then; fading, it stays where it is.
    const g = this.fighter.ghosts, rot = this.fighter.ghostRot, imgs = this.afterimages;
    n = 0;
    for (const a of imgs) {
      if (a.dead) continue;
      if (a.state !== 2 && g.length >= 4) { a.x = g[2]; a.y = g[3]; a.rotX = rot[1] ?? 0; }
      a.age++;
      imgs[n++] = a;
    }
    imgs.length = n;
  }

  // ------------------------------------------------------------------ hitboxes (priority 9)
  /** ftColl_8007AE80 / Item_80269A9C: hitbox positions this frame and last (the swept capsules). */
  collPos(): void {
    const fp = this.fighter;
    let any = false;
    for (const h of fp.hitboxes) if (h.active) any = true;
    if (any) {
      this.updatePose();
      for (const h of fp.hitboxes) {
        if (!h.active) continue;
        if (h.bone * 12 + 11 >= fp.world.length) continue;
        advanceHitbox(h, () => this.jointPoint3(h.bone, h.offset[0], h.offset[1], h.offset[2], h.pos3));
        this.events.push({ type: 'hitbox', hitbox: h, frame: this.frame });
      }
    }
    for (const p of this.projectiles) {
      // The ray's joint: yaw by its facing, pitch along the flight, stretched along Z by its length.
      const ry = Math.PI / 2 * p.facing, rx = Math.PI + Math.atan2(p.vy, p.facing === 1 ? -p.vx : p.vx);
      const sX = Math.sin(rx), cX = Math.cos(rx), sY = Math.sin(ry), cY = Math.cos(ry);
      for (const h of p.hitboxes) {
        if (!h.active) continue;
        advanceHitbox(h, () => {
          const [ox, oy, oz0] = h.offset, oz = oz0 * p.scale;
          // R = Ry * Rx (no Z rotation) applied to the offset.
          const x1 = ox, y1 = cX * oy - sX * oz, z1 = sX * oy + cX * oz;
          h.pos3[0] = f(p.x + cY * x1 + sY * z1); h.pos3[1] = f(p.y + y1); h.pos3[2] = f(-sY * x1 + cY * z1);
        });
      }
    }
    const scale = this.data.illusion?.scale ?? 1;
    for (const a of this.afterimages) {
      // The afterimage's joint: yaw by its facing, pitch by its X rotation, scaled by the item's scale.
      const ry = Math.PI / 2 * a.facing;
      const sX = Math.sin(a.rotX), cX = Math.cos(a.rotX), sY = Math.sin(ry), cY = Math.cos(ry);
      for (const h of a.hitboxes) {
        if (!h.active) continue;
        advanceHitbox(h, () => {
          const ox = h.offset[0] * scale, oy = h.offset[1] * scale, oz = h.offset[2] * scale;
          const x1 = ox, y1 = cX * oy - sX * oz, z1 = sX * oy + cX * oz;
          h.pos3[0] = f(a.x + cY * x1 + sY * z1); h.pos3[1] = f(a.y + y1); h.pos3[2] = f(-sY * x1 + cY * z1);
        });
      }
    }
  }
}

/** A hitbox's new position; the first one after (re)creation is also its previous (no sweep). */
function advanceHitbox(h: HitboxState, compute: () => void): void {
  const prev0 = h.pos3[0], prev1 = h.pos3[1], prev2 = h.pos3[2];
  compute();
  if (h.fresh) { h.prevPos3[0] = h.pos3[0]; h.prevPos3[1] = h.pos3[1]; h.prevPos3[2] = h.pos3[2]; h.fresh = false; }
  else { h.prevPos3[0] = prev0; h.prevPos3[1] = prev1; h.prevPos3[2] = prev2; }
  h.prevPos[0] = h.prevPos3[0]; h.prevPos[1] = h.prevPos3[1];
  h.pos[0] = h.pos3[0]; h.pos[1] = h.pos3[1];
}

/** ftCommon_SandbagKnockbackDeaccel. */
function sandbagDecel(kb: number, d: number): number {
  let r = kb;
  if (kb > 0) { r = f(r - d); if (r < 0) return 0; }
  else if (kb < 0) { r = f(r + d); if (r > 0) return 0; }
  return r;
}

/** Landing: gr_vel = self_vel.x clamped to the ground max (ftCommon_8007D6A4). */
export { F32_MAX };
