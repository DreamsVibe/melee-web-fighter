// Wires the parts together: bridge (data + adapter), input, the arena (the web page, or one of Melee's
// stages on the extension's stage page), engine (the player's character, Fox or Falco, and Sandbag
// when it's on), renderers and audio. Owns the overlay and tears everything down on destroy().
import { Overlay } from './overlay';
import { BridgeClient } from './bridge-client';
import { effectiveFiles, loadModel, text, type CharacterInfo } from '../shared/character';
import { FighterRenderer, type FighterModel } from '../render/fighter';
import { placement } from '../render/mat4';
import { InputManager } from './input';
import { DebugLayer } from './debug';
import { EffectsLayer } from './effects';
import { CanvasQuad } from '../render/quad';
import { emptyPad } from '../engine/pad';
import { CHARACTERS, withDefaults, type Settings } from '../shared/settings';
import { PageArena, StageArena, type Arena } from './arena';
import { Engine } from '../engine/engine';
import { World } from '../engine/world';
import { loadCharacter, loadStage } from '../engine/load';
import { AudioPlayer } from '../audio/audio';
import { pluginsFor } from '../plugins';
import { ADAPTER_PORT, describeAdapter, type AdapterMessage } from '../shared/adapter-link';
import { FORMAT_VERSION } from '../shared/db';
import { STAGE_LIST } from '../shared/stages';
import type { Fighter } from '../engine/types';
import { restPose, worldMatrices } from '../render/pose';

const FOX = 'characters/fox/';
const SANDBAG = 'characters/sandbag/';

/** Something the user has to do first (import the disc, or import it again): shown, not logged as an error. */
export class SetupError extends Error {}

/** Whether this script can still reach the extension (a reload or update cuts off the old copy). */
const extensionAlive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };

export interface GameOptions {
  /** Play on this Melee stage (stages/<id>/) instead of the page. */
  stage?: string;
}

export class Game {
  readonly overlay = new Overlay();
  readonly input = new InputManager();
  readonly debug = new DebugLayer();
  readonly effects = new EffectsLayer();
  private bridge: BridgeClient;
  private gl: WebGL2RenderingContext | null = null;
  private renderer: FighterRenderer | null = null;
  private model: FighterModel | null = null;
  private info: CharacterInfo | null = null;
  private quad: CanvasQuad | null = null;
  private arena: Arena | null = null;
  private engine: Engine | null = null;
  /** The fighters have appeared (a page after its first scan). */
  private spawned = false;
  private readonly world = new World();
  private sandbag: Engine | null = null;
  private sandbagRenderer: FighterRenderer | null = null;
  private audio: AudioPlayer | null = null;
  private settings: Settings = withDefaults({});
  private pad = emptyPad();
  private proj = new Float32Array(16);
  private place = new Float32Array(16);
  /** Fox's standing height in Melee units (measured from his model at load); sets a page's scale. */
  private fighterHeight = 14;
  private stepMs = 0;
  /** Worst per-frame arena update since the last stats line (dev builds log it). */
  private stageMaxMs = 0;
  /** Runtime port to the service worker, which runs the adapter helper. */
  private adapterLink: chrome.runtime.Port | null = null;
  private adapterLatency = 0;
  private destroyed = false;
  /** A menu is open over the game: time stands still and the keyboard is the menu's. */
  private paused = false;
  /** Called when the extension went away under this copy and it removed itself from the page. */
  onOrphaned: (() => void) | null = null;

  constructor(private opts: GameOptions = {}) {
    this.bridge = new BridgeClient({
      onChanged: () => this.reload(),
      onSettings: () => { this.applySettings(); this.reload(); },
    });
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.input.enabled = !paused;
  }

  /** The arena's view (the page's scroll, or the stage camera). */
  get view() { return this.arena!.view; }

  async start(): Promise<void> {
    const t0 = performance.now();
    await this.bridge.load();
    if (DEV) console.log('[mwf] folder', this.bridge.files.size, 'files in', (performance.now() - t0).toFixed(0), 'ms');
    this.settings = withDefaults(this.bridge.settings);
    this.checkImported();
    const gl = this.overlay.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: true });
    if (!gl) throw new Error('WebGL2 is not available on this page.');
    this.gl = gl;
    this.quad = new CanvasQuad(gl);
    this.audio = new AudioPlayer(this.settings.volume);
    this.arena = this.makeArena(gl);
    this.loadAll();
    this.applySettings();
    // The fighters appear once the arena is ready (a page after its first scan; see step()).
    this.world.setStage(this.arena.data);
    this.world.respawn = (e) => (e === this.sandbag ? this.arena!.sandbagRespawn(this.engine!.fighter) : this.arena!.playerRespawn());
    this.overlay.onStep = () => this.step();
    this.overlay.onRender = () => this.render();
    this.input.onKey = (code) => { if (code === 'F9') this.debug.setEnabled(!this.debug.enabled); };
    this.overlay.addDisposer(() => {
      this.input.destroy(); this.debug.destroy(); this.effects.destroy(); this.arena?.destroy(); this.audio?.destroy();
    });
    this.connectAdapter();
    if (DEV) console.log('[mwf] started');
    await this.overlay.start();
  }

  private makeArena(gl: WebGL2RenderingContext): Arena {
    if (!this.opts.stage) return new PageArena(this.settings, this.overlay.canvas);
    const id = this.opts.stage;
    const name = STAGE_LIST.find((s) => s.id === id)?.name ?? id;
    const files = this.folder();
    const stage = loadStage(files, id);
    if (!stage) throw new SetupError(`${name} isn't imported yet. Open the extension options → Import, and import your Melee disc again to add stages.`);
    return new StageArena(stage.file, stage.data, files, gl);
  }

  /** The player's character folder. */
  private get charDir(): string { return `characters/${this.settings.character}/`; }

  /** Throws when the chosen character isn't imported, or was imported by an older version. */
  private checkImported(): void {
    const name = CHARACTERS.find((c) => c.id === this.settings.character)?.name ?? 'Fox';
    const info = this.bridge.files.get(this.charDir + 'character.json');
    if (!info) {
      throw new SetupError(this.bridge.files.has(FOX + 'character.json')
        ? `${name} isn't imported yet: this version adds him. Open the extension options → Import, and import your Melee disc again.`
        : `${name} is not imported yet. Open the extension options → Import, and pick your Melee disc.`);
    }
    if ((JSON.parse(text(info) ?? '{}').formatVersion ?? 0) < FORMAT_VERSION) {
      throw new SetupError(`${name}'s data is from an older version of the extension. Open the extension options → Import, and import your Melee disc again.`);
    }
  }

  /** The character folder as the engine sees it: imports with enabled overrides merged on top. */
  private folder() {
    return effectiveFiles(this.bridge.files, new Set(this.settings.disabledOverrides));
  }

  private loadAll(): void {
    const files = this.folder();
    const dir = this.charDir;
    const { model, info } = loadModel(files, dir);
    this.model = model;
    this.info = info;
    this.renderer = new FighterRenderer(this.gl!, model);
    const data = loadCharacter(files, dir);
    if (this.engine && this.engine.data.id === data.id) this.engine.setData(data);
    else {
      // Another character (picked in the settings) takes the old one's place: first in the world, so
      // the pad drives it, and where the old one stood.
      const old = this.engine;
      if (old) this.world.remove(old);
      this.engine = this.world.add(new Engine(data), 0);
      if (this.arena) this.engine.setStage(this.arena.data);
      if (old && this.spawned) this.engine.spawn(old.fighter.pos.x, old.fighter.pos.y + 0.5, old.fighter.facing);
    }
    this.engine.plugins = pluginsFor(this.settings);
    this.loadSandbag(files);
    this.audio!.load(files);
    // A page's scale always comes from Fox, so Falco stands taller, as he does next to Fox in the game.
    const fox = dir === FOX || !files.has(FOX + 'character.json') ? { model, info } : loadModel(files, FOX);
    this.fighterHeight = measureHeight(fox.model, fox.info.modelScale);
  }

  /** Sandbag's data and model (imported with Fox since format 3); in the world while the setting is on. */
  private loadSandbag(files: ReturnType<Game['folder']>): void {
    const want = this.settings.sandbag && files.has(SANDBAG + 'character.json');
    if (!want) {
      if (this.sandbag) { this.world.remove(this.sandbag); this.sandbag = null; this.sandbagRenderer = null; }
      return;
    }
    const data = loadCharacter(files, SANDBAG);
    this.sandbagRenderer = new FighterRenderer(this.gl!, loadModel(files, SANDBAG).model);
    if (this.sandbag) this.sandbag.setData(data);
    else {
      this.sandbag = this.world.add(new Engine(data));
      if (this.arena) { this.sandbag.setStage(this.arena.data); if (this.spawned) this.spawnSandbag(); }
    }
    this.sandbag.plugins = pluginsFor(this.settings).filter((p) => !p.input && !p.render);
    this.sandbag.noDamage = !this.settings.sandbagDamage;
  }

  private spawnPlayer(): void {
    const [x, y, facing] = this.arena!.playerSpawn();
    this.engine!.spawn(x, y, facing);
  }

  private spawnSandbag(): void {
    const [x, y, facing] = this.arena!.sandbagSpawn(this.engine!.fighter);
    this.sandbag!.spawn(x, y, facing);
  }

  /** Live reload after an override or setting changed (or another character was picked). */
  private reload(): void {
    if (!this.gl || !this.engine) return;
    try { this.settings = withDefaults(this.bridge.settings); this.checkImported(); this.loadAll(); this.applySettings(); } catch (e) { this.showError(`Reload failed: ${(e as Error).message}`); }
  }

  private applySettings(): void {
    const s = (this.settings = withDefaults(this.bridge.settings));
    this.input.port = s.adapterPort - 1;
    this.input.mapping = s.gamepad;
    this.input.setKeyboard(s.keyboard);
    if (s.debug) this.debug.setEnabled(true);
    this.arena?.applySettings(s, this.fighterHeight);
    this.audio?.setVolume(s.volume);
    if (this.engine) this.engine.plugins = pluginsFor(s);
    if (this.sandbag) this.sandbag.noDamage = !s.sandbagDamage;
  }

  /**
   * Subscribes to the adapter helper's reports; reconnects if the service worker restarts. If the
   * extension itself went away (reloaded or updated), this copy can't reach it any more: it takes
   * the fighter off the page, and the next toggle brings in the new version.
   */
  private connectAdapter(): void {
    if (!extensionAlive()) { this.orphaned(); return; }
    let port: chrome.runtime.Port;
    try { port = chrome.runtime.connect({ name: ADAPTER_PORT }); } catch { this.orphaned(); return; }
    this.adapterLink = port;
    port.onMessage.addListener((m: AdapterMessage) => {
      if (m.type === 'report') {
        this.input.adapterReport(new Uint8Array(m.r));
        this.adapterLatency = Date.now() - m.t;
      } else this.input.adapterStatus = m.s === 'connected' ? m.s : `${m.s}: ${describeAdapter(m.s, m.d)}`;
    });
    port.onDisconnect.addListener(() => {
      if (this.adapterLink !== port || this.destroyed) return;
      this.adapterLink = null;
      if (!extensionAlive()) { this.orphaned(); return; }
      setTimeout(() => { if (!this.destroyed) this.connectAdapter(); }, 1000);
    });
  }

  private orphaned(): void {
    if (this.destroyed) return;
    this.destroy();
    this.onOrphaned?.();
  }

  /** One engine step (exactly 1/60 s). */
  private step(): void {
    if (this.paused) return;
    const e = this.engine!, arena = this.arena!;
    const ts = performance.now();
    arena.update(this.world.fighters.map((f) => f.fighter));
    this.stageMaxMs = Math.max(this.stageMaxMs, performance.now() - ts);
    this.world.setStage(arena.data);
    if (!this.spawned) {
      // Nothing to play until the arena is ready: then the fighters appear.
      if (!arena.ready) return;
      this.spawned = true;
      this.spawnPlayer();
      if (this.sandbag) this.spawnSandbag();
    }
    if (this.sandbag) this.sandbag.blast = arena.sandbagBounds();
    this.input.sample(this.pad);
    const t0 = performance.now();
    this.world.step([this.pad]);
    this.stepMs = this.stepMs * 0.95 + (performance.now() - t0) * 0.05;
    if (DEV && e.frame % 300 === 0) { console.log(`[mwf] stats step ${this.stepMs.toFixed(3)} ms, arena worst frame ${this.stageMaxMs.toFixed(2)} ms, ${arena.stats()}`); this.stageMaxMs = 0; }
    for (const f of this.world.fighters) {
      for (const ev of f.events) {
        if (ev.type === 'sound') this.audio!.play(ev.id, ev.volume, ev.pan);
        else if (ev.type === 'hit') this.effects.spark(ev.x, ev.y, ev.kb);
        else if (DEV && ev.type === 'state') console.log(`[mwf] ${f.data.id} ${f.frame} ${ev.from} -> ${ev.to} (frame ${f.fighter.animFrame}, vy ${f.fighter.selfVel.y.toFixed(2)})`);
      }
    }
  }

  private render(): void {
    const gl = this.gl!, e = this.engine!, fp = e.fighter, arena = this.arena!;
    const c = this.overlay.canvas;
    gl.viewport(0, 0, c.width, c.height);
    gl.clearColor(...arena.clearColor);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    arena.projection(this.proj);
    arena.drawBackground(this.proj);
    if (!this.spawned) return;
    // Sandbag behind the player. During hitlag it shakes (the game's model shift, ftCo_80090690).
    const sb = this.sandbag;
    if (sb && this.sandbagRenderer) {
      sb.updatePose();
      const sf = sb.fighter, shake = sf.inHitlag && sf.hitlag > 0 ? (sf.hitlag % 2 ? 0.6 : -0.6) : 0;
      placement(this.place, sf.pos.x + shake, sf.pos.y, 0, 0, 1);
      this.sandbagRenderer.draw(sf.world, this.place, this.proj);
    }
    e.updatePose();
    // Afterimages (Fox's Illusion): the same pose at the last few positions, fading out.
    const g = fp.ghosts;
    for (let i = g.length / 2 - 1; i >= 1; i--) {
      placement(this.place, g[i * 2], g[i * 2 + 1], 0, 0, 1);
      this.renderer!.draw(fp.world, this.place, this.proj, undefined, 0.5 - i * 0.12);
    }
    placement(this.place, fp.pos.x, fp.pos.y, 0, 0, 1);
    this.renderer!.draw(fp.world, this.place, this.proj);
    if (this.effects.draw(e, this.view)) this.quad!.draw(this.effects.canvas);
    const ctx = this.debug.begin();
    if (ctx) {
      this.debug.drawStage(ctx, arena.data.segments, this.view);
      this.drawFighterDebug(ctx, fp);
      if (sb) this.drawFighterDebug(ctx, sb.fighter);
      for (const p of e.plugins) p.render?.(e, ctx, (x, y) => this.view.toClient(x, y));
      this.debug.text(ctx, [
        `${e.data.name}  ${fp.motionName}  frame ${fp.animFrame.toFixed(1)}  ${fp.ga ? 'air' : 'ground'}  jumps ${fp.jumpsUsed}`,
        `pos ${fp.pos.x.toFixed(2)}, ${fp.pos.y.toFixed(2)}  vel ${fp.selfVel.x.toFixed(3)}, ${fp.selfVel.y.toFixed(3)}  gr ${fp.grVel.toFixed(3)}`,
        `engine step ${this.stepMs.toFixed(3)} ms · ${arena.stats()}`,
        `px_per_unit ${this.view.ppu.toFixed(2)} · plugins: ${e.plugins.map((p) => p.id).join(', ') || 'none'}`,
        ...(sb ? [`sandbag ${sb.fighter.motionName} ${sb.fighter.percent.toFixed(1)}%  pos ${sb.fighter.pos.x.toFixed(1)}, ${sb.fighter.pos.y.toFixed(1)}  hitlag ${sb.fighter.hitlag}  hitstun ${sb.fighter.hitstun}`] : []),
      ]);
      this.debug.drawInput(ctx, this.pad, this.input.source, `adapter: ${this.input.adapterStatus}${this.input.adapterPort >= 0 ? ` port ${this.input.adapterPort + 1}` : ''}` + (this.input.adapterStatus === 'connected' ? ` (${this.adapterLatency} ms)` : ''));
      this.quad!.draw(this.debug.canvas);
    }
  }

  private drawFighterDebug(ctx: OffscreenCanvasRenderingContext2D, fp: Fighter): void {
    const v = this.view, x = fp.pos.x, y = fp.pos.y, e = fp.ecb;
    const P = (px: number, py: number) => v.toClient(px, py);
    const pts = [P(x, y + e.top), P(x + e.right, y + e.sideY), P(x, y + e.bottom), P(x + e.left, y + e.sideY)];
    ctx.save();
    ctx.strokeStyle = '#ffd400'; ctx.fillStyle = 'rgba(255,212,0,0.15)'; ctx.lineWidth = 2;
    ctx.beginPath(); pts.forEach(([a, b2], i) => (i ? ctx.lineTo(a, b2) : ctx.moveTo(a, b2))); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,40,40,0.45)'; ctx.strokeStyle = '#ff2020';
    for (const h of fp.hitboxes) {
      if (!h.active) continue;
      const [hx, hy] = P(h.pos[0], h.pos[1]);
      ctx.beginPath(); ctx.arc(hx, hy, h.size * v.ppu, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  showError(text: string): void { this.overlay.showError(text); }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.overlay.destroy();
    this.bridge.destroy();
    // With the extension gone (an orphaned copy), even disconnecting throws.
    try { this.adapterLink?.disconnect(); } catch { /* already cut off */ }
    this.adapterLink = null;
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** Height of a model standing in its rest pose at its model scale, in Melee units, from the skinned mesh. */
function measureHeight(m: FighterModel, scale: number): number {
  const J = m.joints.length, v = m.mesh.vertices;
  const local = restPose(m.joints), world = new Float32Array(J * 12);
  // The root as Engine.updatePose sets it: facing rotation and model scale.
  local[1] = Math.PI / 2;
  local[3] = local[4] = local[5] = scale;
  worldMatrices(m.joints, local, world, new Float32Array(J * 3));
  let top = -Infinity;
  for (let i = 0; i < v.length / 8; i++) {
    let y = 0;
    for (let k = 0; k < 4; k++) {
      const w = m.mesh.weights[i * 4 + k] / 255;
      if (!w) continue;
      let b = m.mesh.bones[i * 4 + k];
      const bind = b < J;
      if (!bind) b -= J;
      let px = v[i * 8], py = v[i * 8 + 1], pz = v[i * 8 + 2];
      const ib = m.joints[b].inverseBind;
      if (bind && ib) { const x = ib[0] * px + ib[1] * py + ib[2] * pz + ib[3], yy = ib[4] * px + ib[5] * py + ib[6] * pz + ib[7], z = ib[8] * px + ib[9] * py + ib[10] * pz + ib[11]; px = x; py = yy; pz = z; }
      const o = b * 12;
      y += w * (world[o + 4] * px + world[o + 5] * py + world[o + 6] * pz + world[o + 7]);
    }
    if (y > top) top = y;
  }
  return top > 0 && top < 100 ? top : 14;
}
