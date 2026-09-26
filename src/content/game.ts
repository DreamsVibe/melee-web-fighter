// Wires the parts together on the page: bridge (data + adapter), input, stage, engine, renderer and
// audio. Owns the overlay and tears everything down on destroy().
import { Overlay } from './overlay';
import { BridgeClient } from './bridge-client';
import { View } from './view';
import { effectiveFiles, loadModel, type CharacterInfo } from '../shared/character';
import { FighterRenderer, type FighterModel } from '../render/fighter';
import { ortho, placement } from '../render/mat4';
import { InputManager } from './input';
import { DebugLayer } from './debug';
import { CanvasQuad } from '../render/quad';
import { emptyPad } from '../engine/pad';
import { withDefaults, type Settings } from '../shared/settings';
import { PageStage } from './stage';
import { Engine } from '../engine/engine';
import { loadCharacter } from '../engine/load';
import { AudioPlayer } from '../audio/audio';
import { PageReactions } from './reactions';
import { pluginsFor } from '../plugins';
import { ADAPTER_PORT, describeAdapter, type AdapterMessage } from '../shared/adapter-link';
import type { Fighter } from '../engine/types';

const CHAR = 'characters/fox/';

export class Game {
  readonly overlay = new Overlay();
  readonly view = new View();
  readonly input = new InputManager();
  readonly debug = new DebugLayer();
  private bridge: BridgeClient;
  private gl: WebGL2RenderingContext | null = null;
  private renderer: FighterRenderer | null = null;
  private model: FighterModel | null = null;
  private info: CharacterInfo | null = null;
  private quad: CanvasQuad | null = null;
  private stage: PageStage | null = null;
  private engine: Engine | null = null;
  private audio: AudioPlayer | null = null;
  private reactions: PageReactions | null = null;
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
    const gl = this.overlay.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: true });
    if (!gl) throw new Error('WebGL2 is not available on this page.');
    this.gl = gl;
    this.quad = new CanvasQuad(gl);
    this.settings = withDefaults(this.bridge.settings);
    this.audio = new AudioPlayer(this.settings.volume);
    this.loadAll();
    this.stage = new PageStage(this.view, { minSolidPx: this.settings.minSolidPx, minSegmentPx: this.settings.minSegmentPx, maxSegments: this.settings.maxSegments });
    this.stage.ignore.add(this.overlay.canvas);
    this.reactions = new PageReactions(this.view, this.audio);
    this.applySettings();
    // Drop in at the top centre of the viewport.
    this.stage.update();
    this.engine!.setStage(this.stage.data);
    const [sx, sy] = this.stage.data.spawn;
    this.engine!.spawn(sx, sy);
    this.overlay.onStep = () => this.step();
    this.overlay.onRender = () => this.render();
    this.input.onKey = (code) => { if (code === 'F9') this.debug.setEnabled(!this.debug.enabled); };
    this.overlay.addDisposer(() => {
      this.input.destroy(); this.debug.destroy(); this.stage?.destroy(); this.audio?.destroy(); this.reactions?.restoreAll();
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
    else this.engine = new Engine(data);
    this.engine.plugins = pluginsFor(this.settings);
    this.audio!.load(files);
    this.fighterHeight = this.measureHeight() || 14;
  }

  /** Live reload after an override or setting changed. */
  private reload(): void {
    if (!this.gl || !this.engine) return;
    try { this.loadAll(); this.applySettings(); } catch (e) { this.showError(`Reload failed: ${(e as Error).message}`); }
  }

  private applySettings(): void {
    const s = (this.settings = withDefaults(this.bridge.settings));
    this.input.port = s.adapterPort - 1;
    this.input.mapping = s.gamepad;
    if (s.debug) this.debug.setEnabled(true);
    this.view.ppu = s.fighterHeightPx / this.fighterHeight;
    this.audio?.setVolume(s.volume);
    if (this.engine) this.engine.plugins = pluginsFor(s);
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
    e.setStage(this.stage!.data);
    this.input.sample(this.pad);
    const t0 = performance.now();
    e.step(this.pad);
    this.stepMs = this.stepMs * 0.95 + (performance.now() - t0) * 0.05;
    if (DEV && e.frame % 300 === 0) { console.log(`[mwf] stats step ${this.stepMs.toFixed(3)} ms, stage worst frame ${this.stageMaxMs.toFixed(2)} ms, last rebuild ${this.stage!.lastScanTotalMs.toFixed(2)} ms, ${this.stage!.data.segments.length} segs`); this.stageMaxMs = 0; }
    for (const ev of e.events) {
      if (ev.type === 'sound') this.audio!.play(ev.id, ev.volume, ev.pan);
      else if (ev.type === 'hitbox') this.reactions!.hit(ev.hitbox, e.fighter);
      else if (DEV && ev.type === 'state') console.log(`[mwf] ${e.frame} ${ev.from} -> ${ev.to} (frame ${e.fighter.animFrame}, vy ${e.fighter.selfVel.y.toFixed(2)})`);
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
    e.updatePose();
    placement(this.place, fp.pos.x, fp.pos.y, 0, 0, 1);
    this.renderer!.draw(fp.world, this.place, this.proj);
    const ctx = this.debug.begin();
    if (ctx) {
      this.debug.drawStage(ctx, this.stage!.data.segments, this.view);
      this.drawFighterDebug(ctx, fp);
      for (const p of e.plugins) p.render?.(e, ctx, (x, y) => this.view.toClient(x, y));
      this.debug.text(ctx, [
        `${fp.motionName}  frame ${fp.animFrame.toFixed(1)}  ${fp.ga ? 'air' : 'ground'}  jumps ${fp.jumpsUsed}`,
        `pos ${fp.pos.x.toFixed(2)}, ${fp.pos.y.toFixed(2)}  vel ${fp.selfVel.x.toFixed(3)}, ${fp.selfVel.y.toFixed(3)}  gr ${fp.grVel.toFixed(3)}`,
        `engine step ${this.stepMs.toFixed(3)} ms · stage ${this.stage!.data.segments.length} segs, scan ${this.stage!.lastBuildMs.toFixed(1)} ms/frame`,
        `px_per_unit ${this.view.ppu.toFixed(2)} · plugins: ${e.plugins.map((p) => p.id).join(', ') || 'none'}`,
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
