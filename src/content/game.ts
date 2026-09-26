// Wires the parts together on the page: bridge (data + adapter), renderer, and later input, stage,
// engine and audio. Owns the overlay and tears everything down on destroy().
import { Overlay } from './overlay';
import { BridgeClient } from './bridge-client';
import { View } from './view';
import { effectiveFiles, loadModel, type CharacterInfo } from '../shared/character';
import { FighterRenderer, type FighterModel } from '../render/fighter';
import { restPose, worldMatrices } from '../render/pose';
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
  private world = new Float32Array(0);
  private scratch = new Float32Array(0);
  private proj = new Float32Array(16);
  private place = new Float32Array(16);
  /** Fighter position in Melee units (placeholder until the engine drives it). */
  pos = { x: 0, y: 0 };

  constructor() {
    this.bridge = new BridgeClient({});
  }

  async start(): Promise<void> {
    await this.bridge.load();
    if (!this.bridge.files.has(CHAR + 'character.json')) {
      throw new Error('Fox is not imported yet. Open the extension options → Import, and pick your Melee disc.');
    }
    const files = effectiveFiles(this.bridge.files);
    const { model, info } = loadModel(files, CHAR);
    this.model = model;
    this.info = info;
    const gl = this.overlay.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: true });
    if (!gl) throw new Error('WebGL2 is not available on this page.');
    this.gl = gl;
    this.renderer = new FighterRenderer(gl, model);
    this.local = restPose(model.joints);
    this.world = new Float32Array(model.joints.length * 12);
    this.scratch = new Float32Array(model.joints.length * 3);
    const [l, r, , t] = this.view.viewport();
    this.pos = { x: (l + r) / 2, y: t - 20 };
    this.overlay.onRender = () => this.render();
    await this.overlay.start();
  }

  private render(): void {
    const gl = this.gl!;
    const c = this.overlay.canvas;
    gl.viewport(0, 0, c.width, c.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const [l, r, b, t] = this.view.viewport();
    ortho(this.proj, l, r, b, t, -100, 100);
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
