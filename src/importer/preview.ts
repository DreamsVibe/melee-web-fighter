// Importer preview: draws an imported character (T-pose, then animations) from the stored folder.
import { listFiles } from '../shared/db';
import { effectiveFiles, loadModel, type FileMap } from '../shared/character';
import { FighterRenderer, type FighterModel } from '../render/fighter';
import { restPose, worldMatrices } from '../render/pose';
import { lookAt, multiply, perspective, placement } from '../render/mat4';

export interface Preview {
  model: FighterModel;
  files: FileMap;
  /** Replace the pose source; called every frame with the time in frames. */
  setPoser(fn: ((frame: number, local: Float32Array) => void) | null): void;
}

export async function startPreview(canvas: HTMLCanvasElement, dir = 'characters/fox/'): Promise<Preview> {
  const all: FileMap = new Map((await listFiles()).map((f) => [f.path, f.data]));
  const files = effectiveFiles(all);
  const { model, info } = loadModel(files, dir);
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false })!;
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  const renderer = new FighterRenderer(gl, model);
  const rest = restPose(model.joints);
  const local = new Float32Array(rest);
  const world = new Float32Array(model.joints.length * 12);
  const scratch = new Float32Array(model.joints.length * 3);
  const proj = new Float32Array(16), view = new Float32Array(16), vp = new Float32Array(16), place = new Float32Array(16);
  let poser: ((frame: number, local: Float32Array) => void) | null = null;
  const t0 = performance.now();
  const frame = () => {
    requestAnimationFrame(frame);
    const f = (performance.now() - t0) / (1000 / 60);
    local.set(rest);
    poser?.(f, local);
    worldMatrices(model.joints, local, world, scratch);
    const w = canvas.clientWidth * devicePixelRatio, h = canvas.clientHeight * devicePixelRatio;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.13, 0.14, 0.17, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    perspective(proj, 0.6, canvas.width / canvas.height, 1, 400);
    lookAt(view, 14, 9, 34, 0, 7, 0);
    multiply(vp, proj, view);
    placement(place, 0, 0, 0, 0.35, info.modelScale);
    renderer.draw(world, place, vp);
  };
  frame();
  return { model, files, setPoser: (fn) => { poser = fn; } };
}
