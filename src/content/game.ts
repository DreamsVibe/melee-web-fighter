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

  constructor() {
    this.bridge = new BridgeClient({
      onChanged: () => this.reload(),
      onSettings: () => this.reload(),
    });
  }

  async start(): Promise<void> {
    await this.bridge.load();
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
    this.rest = restPose(model.joints);
    this.local = new Float32Array(this.rest);
    const wait = files.get(CHAR + 'anims/Wait1.anim');
    if (wait) this.anim = readAnim(bytes(wait)!);
    this.overlay.onStep = () => { this.frame++; };
    this.world = new Float32Array(model.joints.length * 12);
    this.scratch = new Float32Array(model.joints.length * 3);
    const [l, r, , t] = this.view.viewport();
    this.pos = { x: (l + r) / 2, y: t - 20 };
    this.overlay.onRender = () => this.render();
    await this.overlay.start();
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
  }

  showError(text: string): void { this.overlay.showError(text); }

  destroy(): void {
    this.overlay.destroy();
    this.bridge.destroy();
    const lose = this.gl?.getExtension('WEBGL_lose_context');
    lose?.loseContext();
  }
}
