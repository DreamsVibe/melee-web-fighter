// The engine: one fighter, a fixed 60 Hz step, deterministic, no DOM. Each step follows the order of
// the game's fighter procs (ft/fighter.c Fighter_Create): animation + script + anim callback, input +
// interrupts (IASA), physics + velocity integration, collision + landing/falling.
import type { Cmd } from '../shared/move';
import { restPose, worldMatrices } from '../render/pose';
import { applyAnim } from '../render/animator';
import { sampleTrack } from '../render/fobj';
import { BTN, emptyFloats, padToFloats, type PadFloats, type PadState } from './pad';
import { runScript, startScript, F32_MAX } from './script';
import { clampGroundVel } from './physics';
import { loadEcb, ECB_AIR, ECB_GROUND } from './collision';
import { SegKind, type Segment, type StageData } from './stagetypes';
import { GA, Smash, type CharacterData, type EngineApi, type EngineEvent, type Fighter, type HitboxState, type Named, type Plugin, type Projectile } from './types';
import { STATES, MS, type StateDef } from './states';

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

/** Wait and the walks keep the jab window open (Fighter_ChangeMotionState resets hitlag_mul otherwise). */
const KEEPS_JAB_WINDOW = (msid: number) => msid >= MS.Wait && msid <= MS.WalkFast;

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
    smash: { state: Smash.None, frames: 0, hold: 0, rate: 1, sfx: false },
    rootPos: { x: 0, y: 0, z: 0 }, rootDelta: { x: 0, y: 0, z: 0 }, xRot: NaN,
    shieldHealth: data.common.shield_start_health ?? 60, lightshield: 0, shielding: false, ghosts: [],
    hitboxes: Array.from({ length: 4 }, (_, id): HitboxState => ({ active: false, id, group: 0, bone: 0, damage: 0, size: 0, offset: [0, 0, 0], angle: 0, kbg: 0, bkb: 0, wkb: 0, element: 0, sfxLevel: 0, sfxKind: 0, pos: [0, 0], prevPos: [0, 0], fresh: true })),
    input: { lx: 0, ly: 0, plx: 0, ply: 0, cx: 0, cy: 0, pcx: 0, pcy: 0, trigger: 0, ptrigger: 0, held: 0, pheld: 0, pressed: 0, released: 0 },
    hasPrevInput: false,
    timers: { lxTimer: 254, lyTimer: 254, lxSticky: 254, lySticky: 254, lxActivity: 254, lyActivity: 254, lxDuration: 254, lyDuration: 254, trigTimer: 254 },
    counters: { a: 255, aPrev: 255, b: 255, xy: 255, lr: 255, lrDigital: 255, lrDigitalPrev: 255, dUp: 255, dDown: 255, jump: 255, jumpPrev: 255, upB: 255, upBPrev: 255, downB: 255, sideB: 255, neutralB: 255 },
    x2228_b7: 0, x2229_b0: 0,
    mv: {},
    ecb: ecb(), prevEcb: ecb(), desiredEcb: ecb(), ecbLock: 0, ecbLocked: false,
    floor: null, floorSkip: null, envFlags: 0, lstickAngle: 0, dead: false,
    local: new Float32Array(J * 9), world: new Float32Array(J * 12), poseDirty: true,
  };
}

export class Engine implements EngineApi {
  readonly fighter: Fighter;
  frame = 0;
  stage: StageData = { segments: [], blast: [-1e9, 1e9, -1e9, 1e9], spawn: [0, 0] };
  readonly events: EngineEvent[] = [];
  /** Projectiles in flight (Fox's blaster shots). */
  readonly projectiles: Projectile[] = [];
  plugins: Plugin[] = [];
  /** Effective attributes this frame (plugins may change them), and the common constants. */
  a: Named;
  c: Named;
  pad: PadFloats = emptyFloats();
  private rest: Float32Array;
  private scratch: Float32Array;
  private states = STATES;
  private lastPos = { x: 0, y: 0 };
  /** Behavior modules by name (`behavior shine` in a .move file). */
  behaviors = new Map<string, Partial<StateDef>>();

  constructor(public data: CharacterData) {
    this.fighter = newFighter(data);
    this.a = { ...data.attrs };
    this.c = data.common;
    this.rest = restPose(data.skeleton);
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
    const def = [...this.states.values()].find((s) => s.name === name);
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
    fp.dead = false;
    fp.shielding = false;
    fp.shieldHealth = this.c.shield_start_health ?? fp.shieldHealth;
    this.changeMotion(MS.Fall, MF.None, 0, 1);
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
    const fp = this.fighter;
    // Moving platforms: carry a grounded fighter with the element he stands on (mpGetSpeed).
    if (fp.ga === GA.Ground && fp.floor) {
      const old = fp.floor;
      const moved = stage.segments.find((s) => s.group === old.group && s.kind === old.kind);
      if (moved) {
        const dx = moved.x0 - old.x0, dy = moved.y0 - old.y0;
        if (dx || dy) { fp.pos.x = f(fp.pos.x + dx); fp.pos.y = f(fp.pos.y + dy); }
        fp.floor = moved;
      } else fp.floor = null;
    }
    if (fp.floorSkip) fp.floorSkip = stage.segments.find((s) => s.group === fp.floorSkip!.group && s.kind === fp.floorSkip!.kind) ?? null;
    this.stage = stage;
  }

  // ------------------------------------------------------------------ one frame
  step(pad: PadState): void {
    const fp = this.fighter;
    this.events.length = 0;
    for (const p of this.plugins) p.input?.(this, pad);
    padToFloats(pad, this.pad);
    this.frame++;
    // Attributes for this frame (the moon gravity plugin edits a copy, never the data).
    Object.assign(this.a, this.data.attrs);
    for (const p of this.plugins) { const r = p.attributes?.(this, this.a); if (r) Object.assign(this.a, r); }
    for (const p of this.plugins) p.frameStart?.(this);

    this.procAnim();
    this.procInput();
    this.procUpdate();
    this.procMap();
    this.updateHitboxes();
    this.updateProjectiles();
    // The shield regenerates while it is down (Fighter_procUpdate: shield_health += x27C).
    if (!fp.shielding && fp.shieldHealth < this.c.shield_start_health) {
      fp.shieldHealth = f(Math.min(this.c.shield_start_health, fp.shieldHealth + this.c.shield_regen));
    }

    const [l, r, b] = this.stage.blast;
    if (fp.pos.x < l || fp.pos.x > r || fp.pos.y < b) {
      this.events.push({ type: 'ko', frame: this.frame });
      const [sx, sy] = this.stage.spawn;
      this.spawn(sx, sy, fp.facing);
    }
    for (const p of this.plugins) p.frameEnd?.(this);
  }

  // ---- Fighter_procAnim
  private procAnim(): void {
    this.animStep();
    this.smashChargeTick();
    this.def().anim?.(this);
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
  private procInput(): void {
    const fp = this.fighter, c = this.c, inp = fp.input, t = fp.timers, k = fp.counters;
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
    inp.pressed = (held & ((inp.pheld ^ held) >>> 0)) >>> 0;
    inp.released = (inp.pheld & ((inp.pheld ^ held) >>> 0)) >>> 0;
    this.smashChargeInput();

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
  private procUpdate(): void {
    const fp = this.fighter;
    this.lastPos.x = fp.pos.x; this.lastPos.y = fp.pos.y;
    fp.prevPos.x = fp.pos.x; fp.prevPos.y = fp.pos.y;
    this.def().phys?.(this);
    fp.grVel = f(fp.grVel + fp.grAccel1 + fp.grAccel2);
    fp.grAccel1 = fp.grAccel2 = 0;
    fp.selfVel.x = f(fp.selfVel.x + fp.selfAccel.x);
    fp.selfVel.y = f(fp.selfVel.y + fp.selfAccel.y);
    fp.selfAccel.x = fp.selfAccel.y = 0;
    fp.pos.x = f(fp.pos.x + fp.selfVel.x);
    fp.pos.y = f(fp.pos.y + fp.selfVel.y);
  }

  // ---- Fighter_procMap
  private procMap(): void {
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
    // ftPartSetRotX on XRotN (Firefox points Fox along his flight).
    const xRotN = this.data.parts[2];
    if (!Number.isNaN(fp.xRot) && xRotN !== undefined) fp.local[xRotN * 9] = fp.xRot;
    // Root: facing rotation (ftPartSetRotY(fp, 0, pi/2 * facing)) and model scale.
    fp.local[1] = Math.PI / 2 * fp.facing;
    const s = this.data.modelScale;
    fp.local[3] = fp.local[4] = fp.local[5] = s;
    worldMatrices(this.data.skeleton, fp.local, fp.world, this.scratch);
  }

  // ------------------------------------------------------------------ state machine
  def(): StateDef { return this.states.get(this.fighter.motionId) ?? this.states.get(MS.Fall)!; }

  /** Fighter_ChangeMotionState (ft/fighter.c:935), the parts v1 uses. */
  changeMotion(msid: number, flags: number, animStart = 0, animSpeed = 1): void {
    const fp = this.fighter;
    const def = this.states.get(msid);
    if (!def) return; // states outside v1 are never entered
    const from = fp.motionName;
    if (from) for (const p of this.plugins) p.stateExit?.(this, from);
    const hadRootMotion = !!fp.move && (fp.move.animFlags & 0x80000000) !== 0;
    fp.motionId = msid;
    fp.motionName = def.name;
    fp.facing1 = fp.facing;
    if (!(flags & MF.SkipHit)) for (const h of fp.hitboxes) h.active = false;
    fp.reflecting = false;
    fp.shielding = false; // the shield states raise it again
    if (!(flags & MF.KeepFastFall)) fp.fallFast = false;
    fp.floorSkip = null;
    fp.lstickAngle = 0;
    fp.xRot = NaN;
    fp.smash.state = Smash.None;
    if (!KEEPS_JAB_WINDOW(msid)) fp.jabWindow = 0;
    if (!(flags & MF.KeepGhosts)) fp.ghosts.length = 0;
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
        const h = fp.hitboxes[c.f.id & 3];
        if (!h.active || h.group !== c.f.group) { h.fresh = true; }
        h.active = true; h.group = c.f.group; h.bone = c.f.bone; h.damage = c.f.damage; h.size = c.f.size;
        h.offset[0] = c.f.x; h.offset[1] = c.f.y; h.offset[2] = c.f.z;
        h.angle = c.f.angle; h.kbg = c.f.kbg; h.bkb = c.f.bkb; h.wkb = c.f.wkb; h.element = c.f.element;
        h.sfxLevel = c.f.sfx_level; h.sfxKind = c.f.sfx_kind;
        break;
      }
      case 'hitbox_damage': fp.hitboxes[c.id & 3].damage = c.value; break;
      case 'hitbox_size': fp.hitboxes[c.id & 3].size = c.value; break;
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
        s.state = Smash.PreCharge; s.frames = 0; s.hold = c.frames;
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
    clampGroundVelFromSelf(fp, this.a.ground_max_horizontal_velocity);
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

  /** Fires a straight-flying projectile (it_8029C504: angle, speed, lifetime in frames). */
  fireProjectile(kind: string, x: number, y: number, angle: number, speed: number, lifetime: number): Projectile {
    const p: Projectile = { kind, x, y, prevX: x, prevY: y, vx: f(speed * Math.cos(angle)), vy: f(speed * Math.sin(angle)), angle, age: 0, lifetime };
    this.projectiles.push(p);
    this.events.push({ type: 'projectile', projectile: p, frame: this.frame });
    return p;
  }

  private updateProjectiles(): void {
    const list = this.projectiles;
    let n = 0;
    for (const p of list) {
      p.prevX = p.x; p.prevY = p.y;
      p.x = f(p.x + p.vx); p.y = f(p.y + p.vy);
      if (++p.age < p.lifetime) list[n++] = p;
    }
    list.length = n;
  }

  // ------------------------------------------------------------------ hitboxes (debug draw, plugins)
  private updateHitboxes(): void {
    const fp = this.fighter;
    let any = false;
    for (const h of fp.hitboxes) if (h.active) any = true;
    if (!any) return;
    this.updatePose();
    for (const h of fp.hitboxes) {
      if (!h.active) continue;
      const m = h.bone * 12, w = fp.world;
      if (m + 11 >= w.length) continue;
      const [ox, oy, oz] = h.offset;
      const x = w[m] * ox + w[m + 1] * oy + w[m + 2] * oz + w[m + 3];
      const y = w[m + 4] * ox + w[m + 5] * oy + w[m + 6] * oz + w[m + 7];
      const px = fp.pos.x + x, py = fp.pos.y + y;
      if (h.fresh) { h.prevPos[0] = px; h.prevPos[1] = py; h.fresh = false; }
      else { h.prevPos[0] = h.pos[0]; h.prevPos[1] = h.pos[1]; }
      h.pos[0] = px; h.pos[1] = py;
      this.events.push({ type: 'hitbox', hitbox: h, frame: this.frame });
    }
  }
}

/** Landing: gr_vel = self_vel.x clamped to the ground max (ftCommon_8007D6A4). */
function clampGroundVelFromSelf(fp: Fighter, max: number): void {
  fp.grVel = fp.selfVel.x;
  clampGroundVel(fp, max);
}

export { F32_MAX };
