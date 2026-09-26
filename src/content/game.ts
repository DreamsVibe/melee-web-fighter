// Wires the parts together on the page: bridge (data + adapter), renderer, and later input, stage,
// engine and audio. Owns the overlay and tears everything down on destroy().
import { Overlay } from './overlay';
import { BridgeClient } from './bridge-client';
import { View } from './view';
import { effectiveFiles, loadModel, type CharacterInfo } from '../shared/character';
import { FighterRenderer, type FighterModel } from '../render/fighter';
import { restPose, worldMatrices } from '../render/pose';
import { applyAnim } from '../render/animator';
import { readAnim, type AnimData } from '../shared/animfile';
import { bytes } from '../shared/character';
import { ortho, placement } from '../render/mat4';
import { InputManager } from './input';
import { DebugLayer } from './debug';
import { CanvasQuad } from '../render/quad';
import { emptyPad } from '../engine/pad';
import { withDefaults } from '../shared/settings';

const CHAR = 'characters/fox/';

export class Game {
  readonly overlay = new Overlay();
  readonly view = new View();
  private bridge: BridgeClient;
  private gl: WebGL2RenderingContext | null = null;
  private renderer: FighterRenderer | null = null;
  private model: FighterModel | null = null;
  private info: CharacterInfo | null = null;
  private local: Float32Array = new Float32Array(0);
  private rest: Float32Array = new Float32Array(0);
  private anim: AnimData | null = null;
  private frame = 0;
  private world = new Float32Array(0);
  private scratch = new Float32Array(0);
  private proj = new Float32Array(16);
  private place = new Float32Array(16);
  /** Fighter position in Melee units (placeholder until the engine drives it). */
  pos = { x: 0, y: 0 };
  readonly input = new InputManager();
  readonly debug = new DebugLayer();
  private pad = emptyPad();
  private quad: CanvasQuad | null = null;

  constructor() {
    this.bridge = new BridgeClient({
      onChanged: () => this.reload(),
      onSettings: () => { this.applySettings(); this.reload(); },
      onAdapterReport: (r) => this.input.adapterReport(r),
      onAdapterStatus: (st) => this.adapterStatus(st),
    });
  }

  async start(): Promise<void> {
    const t0 = performance.now();
    await this.bridge.load();
    if (DEV) console.log('[mwf] folder', this.bridge.files.size, 'files in', (performance.now() - t0).toFixed(0), 'ms');
    if (!this.bridge.files.has(CHAR + 'character.json')) {
      throw new Error('Fox is not imported yet. Open the extension options → Import, and pick your Melee disc.');
    }
    const files = this.folder();
    const { model, info } = loadModel(files, CHAR);
    this.model = model;
    this.info = info;
    const gl = this.overlay.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: true });
    if (!gl) throw new Error('WebGL2 is not available on this page.');
    this.gl = gl;
    this.renderer = new FighterRenderer(gl, model);
    this.quad = new CanvasQuad(gl);
    this.rest = restPose(model.joints);
    this.local = new Float32Array(this.rest);
    const wait = files.get(CHAR + 'anims/Wait1.anim');
    if (wait) this.anim = readAnim(bytes(wait)!);
    this.overlay.onStep = () => this.step();
    this.input.onKey = (code) => { if (code === 'F9') this.debug.setEnabled(!this.debug.enabled); };
    this.applySettings();
    this.overlay.addDisposer(() => { this.input.destroy(); this.debug.destroy(); });
    this.world = new Float32Array(model.joints.length * 12);
    this.scratch = new Float32Array(model.joints.length * 3);
    const [l, r, , t] = this.view.viewport();
    this.pos = { x: (l + r) / 2, y: t - 20 };
    this.overlay.onRender = () => this.render();
    if (DEV) console.log('[mwf] started', this.pos, this.view.viewport());
    await this.overlay.start();
  }

  private applySettings(): void {
    const s = withDefaults(this.bridge.settings);
    this.input.port = s.adapterPort - 1;
    this.input.mapping = s.gamepad;
    this.debug.setEnabled(s.debug || this.debug.enabled);
  }

  private relayOn = false;
  private adapterStatus(status: string): void {
    this.input.adapterStatus = status;
    // WebUSB blocked in the page frame: ask the service worker for the offscreen relay.
    if (status === 'unsupported' && !this.relayOn) {
      this.relayOn = true;
      chrome.runtime.onMessage.addListener(this.relayListener);
      void chrome.runtime.sendMessage({ type: 'mwf:relay-start' });
    }
  }
  private relayLatency = 0;
  private readonly relayListener = (msg: { type?: string; report?: number[]; t?: number; status?: string }) => {
    if (msg.type === 'mwf:relay-report' && msg.report) {
      this.input.adapterReport(new Uint8Array(msg.report));
      if (msg.t) this.relayLatency = performance.timeOrigin + performance.now() - msg.t;
    } else if (msg.type === 'mwf:relay-status' && msg.status) this.input.adapterStatus = 'relay ' + msg.status;
  };

  private step(): void {
    this.input.sample(this.pad);
    this.frame++;
  }

  /** The character folder as the engine sees it: imports with enabled overrides merged on top. */
  private folder() {
    const disabled = new Set((this.bridge.settings.disabledOverrides as string[] | undefined) ?? []);
    return effectiveFiles(this.bridge.files, disabled);
  }

  /** Live reload after an override or setting changed. */
  private reload(): void {
    if (!this.gl) return;
    try {
      const files = this.folder();
      const { model, info } = loadModel(files, CHAR);
      this.model = model;
      this.info = info;
      this.renderer = new FighterRenderer(this.gl, model);
      const wait = files.get(CHAR + 'anims/Wait1.anim');
      this.anim = wait ? readAnim(bytes(wait)!) : null;
    } catch (e) {
      this.showError(`Reload failed: ${(e as Error).message}`);
    }
  }

  private render(): void {
    const gl = this.gl!;
    const c = this.overlay.canvas;
    gl.viewport(0, 0, c.width, c.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const [l, r, b, t] = this.view.viewport();
    ortho(this.proj, l, r, b, t, -100, 100);
    this.local.set(this.rest);
    if (this.anim) applyAnim(this.anim, this.frame % this.anim.frameCount, this.local);
    worldMatrices(this.model!.joints, this.local, this.world, this.scratch);
    placement(this.place, this.pos.x, this.pos.y, 0, Math.PI / 2, this.info!.modelScale);
    this.renderer!.draw(this.world, this.place, this.proj);
    const ctx = this.debug.begin();
    if (ctx) {
      this.debug.drawInput(ctx, this.pad, this.input.source, `adapter: ${this.input.adapterStatus}` + (this.relayOn ? ` (${this.relayLatency.toFixed(1)} ms)` : ''));
      this.quad!.draw(this.debug.canvas);
    }
  }

  showError(text: string): void { this.overlay.showError(text); }

  destroy(): void {
    this.overlay.destroy();
    this.bridge.destroy();
    if (this.relayOn) { chrome.runtime.onMessage.removeListener(this.relayListener); void chrome.runtime.sendMessage({ type: 'mwf:relay-stop' }); }
    const lose = this.gl?.getExtension('WEBGL_lose_context');
    lose?.loseContext();
  }
}
