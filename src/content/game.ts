// Wires the parts together on the page: bridge (data + adapter), input, stage, engine (Fox, and
// Sandbag when it's on), renderers and audio. Owns the overlay and tears everything down on destroy().
import { Overlay } from './overlay';
import { BridgeClient } from './bridge-client';
import { View } from './view';
import { effectiveFiles, loadModel, text, type CharacterInfo } from '../shared/character';
import { FighterRenderer, type FighterModel } from '../render/fighter';
import { ortho, placement } from '../render/mat4';
import { InputManager } from './input';
import { DebugLayer } from './debug';
import { EffectsLayer } from './effects';
import { CanvasQuad } from '../render/quad';
import { emptyPad } from '../engine/pad';
import { withDefaults, type Settings } from '../shared/settings';
import { PageStage } from './stage';
import { Engine } from '../engine/engine';
import { World } from '../engine/world';
import { loadCharacter } from '../engine/load';
import { AudioPlayer } from '../audio/audio';
import { pluginsFor } from '../plugins';
import { ADAPTER_PORT, describeAdapter, type AdapterMessage } from '../shared/adapter-link';
import { FORMAT_VERSION } from '../shared/db';
import type { Fighter } from '../engine/types';

const CHAR = 'characters/fox/';
const SANDBAG = 'characters/sandbag/';
/** How far from Fox (Melee units) Sandbag appears, and how far past the screen edge it may go. */
const SANDBAG_GAP = 22;
const SANDBAG_OFFSCREEN = 12;
/** Sandbag's collision bottom while falling, above its feet (its ECB bones in the Fall pose). */
const SANDBAG_AIR_ECB_BOTTOM = 5.7;

export class Game {
  readonly overlay = new Overlay();
  readonly view = new View();
  readonly input = new InputManager();
  readonly debug = new DebugLayer();
  readonly effects = new EffectsLayer();
  private bridge: BridgeClient;
  private gl: WebGL2RenderingContext | null = null;
  private renderer: FighterRenderer | null = null;
  private model: FighterModel | null = null;
  private info: CharacterInfo | null = null;
  private quad: CanvasQuad | null = null;
  private stage: PageStage | null = null;
  private engine: Engine | null = null;
  private readonly world = new World();
  private sandbag: Engine | null = null;
  private sandbagRenderer: FighterRenderer | null = null;
  private audio: AudioPlayer | null = null;
  private settings: Settings = withDefaults({});
  private pad = emptyPad();
  private proj = new Float32Array(16);
  private place = new Float32Array(16);
  /** Fox's standing height in Melee units (measured from his idle pose at load). */
  private fighterHeight = 14;
  private stepMs = 0;
  /** Worst per-frame stage update since the last stats line (dev builds log it). */
  private stageMaxMs = 0;
  /** Runtime port to the service worker, which runs the adapter helper. */
  private adapterLink: chrome.runtime.Port | null = null;
  private adapterLatency = 0;
  private destroyed = false;

  constructor() {
    this.bridge = new BridgeClient({
      onChanged: () => this.reload(),
      onSettings: () => { this.applySettings(); this.reload(); },
    });
  }

  async start(): Promise<void> {
    const t0 = performance.now();
    await this.bridge.load();
    if (DEV) console.log('[mwf] folder', this.bridge.files.size, 'files in', (performance.now() - t0).toFixed(0), 'ms');
    if (!this.bridge.files.has(CHAR + 'character.json')) {
      throw new Error('Fox is not imported yet. Open the extension options → Import, and pick your Melee disc.');
    }
    const version = JSON.parse(text(this.bridge.files.get(CHAR + 'character.json')) ?? '{}').formatVersion ?? 0;
    if (version < FORMAT_VERSION) {
      throw new Error("Fox's data is from an older version of the extension (without Sandbag and hits). Open the extension options → Import, and import your Melee disc again.");
    }
    const gl = this.overlay.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: true });
    if (!gl) throw new Error('WebGL2 is not available on this page.');
    this.gl = gl;
    this.quad = new CanvasQuad(gl);
    this.settings = withDefaults(this.bridge.settings);
    this.audio = new AudioPlayer(this.settings.volume);
    this.loadAll();
    this.stage = new PageStage(this.view, { minSolidPx: this.settings.minSolidPx, minSegmentPx: this.settings.minSegmentPx, maxSegments: this.settings.maxSegments });
    this.stage.ignore.add(this.overlay.canvas);
    this.applySettings();
    // Drop in at the top centre of the viewport.
    this.stage.update();
    this.world.setStage(this.stage.data);
    const [sx, sy] = this.stage.data.spawn;
    this.engine!.spawn(sx, sy);
    this.world.respawn = (e) => (e === this.sandbag ? this.besideFox() : this.stage!.data.spawn);
    if (this.sandbag) this.spawnSandbag();
    this.overlay.onStep = () => this.step();
    this.overlay.onRender = () => this.render();
    this.input.onKey = (code) => { if (code === 'F9') this.debug.setEnabled(!this.debug.enabled); };
    this.overlay.addDisposer(() => {
      this.input.destroy(); this.debug.destroy(); this.effects.destroy(); this.stage?.destroy(); this.audio?.destroy();
    });
    this.connectAdapter();
    if (DEV) console.log('[mwf] started');
    await this.overlay.start();
  }

  /** The character folder as the engine sees it: imports with enabled overrides merged on top. */
  private folder() {
    return effectiveFiles(this.bridge.files, new Set(this.settings.disabledOverrides));
  }

  private loadAll(): void {
    const files = this.folder();
    const { model, info } = loadModel(files, CHAR);
    this.model = model;
    this.info = info;
    this.renderer = new FighterRenderer(this.gl!, model);
    const data = loadCharacter(files, CHAR);
    if (this.engine) this.engine.setData(data);
    else this.world.add(this.engine = new Engine(data));
    this.engine.plugins = pluginsFor(this.settings);
    this.loadSandbag(files);
    this.audio!.load(files);
    this.fighterHeight = this.measureHeight() || 14;
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
      if (this.stage) { this.sandbag.setStage(this.stage.data); this.spawnSandbag(); }
    }
    this.sandbag.plugins = pluginsFor(this.settings).filter((p) => !p.input && !p.render);
    this.sandbag.noDamage = !this.settings.sandbagDamage;
  }

  /**
   * A spot beside Fox, on the side with more room on screen. Standing, Sandbag drops onto what he
   * stands on; in the air, its collision bottom lines up with his so it passes the same platforms.
   */
  private besideFox(): [number, number] {
    const fp = this.engine!.fighter, [l, r] = this.view.viewport();
    let side = fp.facing;
    if (fp.pos.x + side * SANDBAG_GAP > r - 8 || fp.pos.x + side * SANDBAG_GAP < l + 8) side = -side;
    const y = fp.ga === 0 ? fp.pos.y + 0.5 : fp.pos.y + fp.ecb.bottom - SANDBAG_AIR_ECB_BOTTOM;
    return [fp.pos.x + side * SANDBAG_GAP, y];
  }

  /** Sandbag appears beside Fox at 0%, facing him. */
  private spawnSandbag(): void {
    const sb = this.sandbag!, [x, y] = this.besideFox();
    sb.spawn(x, y, x > this.engine!.fighter.pos.x ? -1 : 1);
  }

  /** Live reload after an override or setting changed. */
  private reload(): void {
    if (!this.gl || !this.engine) return;
    try { this.settings = withDefaults(this.bridge.settings); this.loadAll(); this.applySettings(); } catch (e) { this.showError(`Reload failed: ${(e as Error).message}`); }
  }

  private applySettings(): void {
    const s = (this.settings = withDefaults(this.bridge.settings));
    this.input.port = s.adapterPort - 1;
    this.input.mapping = s.gamepad;
    this.input.setKeyboard(s.keyboard);
    if (s.debug) this.debug.setEnabled(true);
    this.view.ppu = s.fighterHeightPx / this.fighterHeight;
    this.audio?.setVolume(s.volume);
    if (this.engine) this.engine.plugins = pluginsFor(s);
    if (this.sandbag) this.sandbag.noDamage = !s.sandbagDamage;
    if (this.stage) { this.stage.opts = { minSolidPx: s.minSolidPx, minSegmentPx: s.minSegmentPx, maxSegments: s.maxSegments }; this.stage.invalidate(0); }
  }

  /** Subscribes to the adapter helper's reports; reconnects if the service worker restarts. */
  private connectAdapter(): void {
    const port = chrome.runtime.connect({ name: ADAPTER_PORT });
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
      setTimeout(() => { if (!this.destroyed) this.connectAdapter(); }, 1000);
    });
  }

  /** One engine step (exactly 1/60 s). */
  private step(): void {
    const e = this.engine!;
    const ts = performance.now();
    this.stage!.update();
    this.stageMaxMs = Math.max(this.stageMaxMs, performance.now() - ts);
    this.world.setStage(this.stage!.data);
    if (this.sandbag) {
      // Off the screen on any side: back beside Fox at 0%.
      const [l, r, b, t] = this.view.viewport(), m = SANDBAG_OFFSCREEN;
      this.sandbag.blast = [l - m, r + m, b - m, t + m];
    }
    this.input.sample(this.pad);
    const t0 = performance.now();
    this.world.step([this.pad]);
    this.stepMs = this.stepMs * 0.95 + (performance.now() - t0) * 0.05;
    if (DEV && e.frame % 300 === 0) { console.log(`[mwf] stats step ${this.stepMs.toFixed(3)} ms, stage worst frame ${this.stageMaxMs.toFixed(2)} ms, last rebuild ${this.stage!.lastScanTotalMs.toFixed(2)} ms, ${this.stage!.data.segments.length} segs`); this.stageMaxMs = 0; }
    for (const f of this.world.fighters) {
      for (const ev of f.events) {
        if (ev.type === 'sound') this.audio!.play(ev.id, ev.volume, ev.pan);
        else if (ev.type === 'hit') this.effects.spark(ev.x, ev.y, ev.kb);
        else if (DEV && ev.type === 'state') console.log(`[mwf] ${f.data.id} ${f.frame} ${ev.from} -> ${ev.to} (frame ${f.fighter.animFrame}, vy ${f.fighter.selfVel.y.toFixed(2)})`);
      }
    }
  }

  /** Height of the current pose from the skinned mesh, in Melee units (the idle pose at load). */
  private measureHeight(): number {
    const e = this.engine!, m = this.model!;
    const fp = e.fighter;
    e.updatePose();
    const world = fp.world, J = m.joints.length, v = m.mesh.vertices;
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

  private render(): void {
    const gl = this.gl!, e = this.engine!, fp = e.fighter;
    const c = this.overlay.canvas;
    gl.viewport(0, 0, c.width, c.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const [l, r, b, t] = this.view.viewport();
    ortho(this.proj, l, r, b, t, -100, 100);
    // Sandbag behind Fox. During hitlag it shakes (the game's model shift, ftCo_80090690).
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
      this.debug.drawStage(ctx, this.stage!.data.segments, this.view);
      this.drawFighterDebug(ctx, fp);
      if (sb) this.drawFighterDebug(ctx, sb.fighter);
      for (const p of e.plugins) p.render?.(e, ctx, (x, y) => this.view.toClient(x, y));
      this.debug.text(ctx, [
        `${fp.motionName}  frame ${fp.animFrame.toFixed(1)}  ${fp.ga ? 'air' : 'ground'}  jumps ${fp.jumpsUsed}`,
        `pos ${fp.pos.x.toFixed(2)}, ${fp.pos.y.toFixed(2)}  vel ${fp.selfVel.x.toFixed(3)}, ${fp.selfVel.y.toFixed(3)}  gr ${fp.grVel.toFixed(3)}`,
        `engine step ${this.stepMs.toFixed(3)} ms · stage ${this.stage!.data.segments.length} segs, scan ${this.stage!.lastBuildMs.toFixed(1)} ms/frame`,
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
    this.overlay.destroy();
    this.bridge.destroy();
    this.destroyed = true;
    this.adapterLink?.disconnect();
    this.adapterLink = null;
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
