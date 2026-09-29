import type { FighterModel } from './fighter';
import type { StageAnimation } from '../shared/stage-animation';
import { sampleTrack } from './fobj';
import { restPose, worldMatrices } from './pose';

const SLOTS: Record<number, number> = { 1: 0, 2: 1, 3: 2, 8: 3, 9: 4, 10: 5, 5: 6, 6: 7, 7: 8 };

/** Stage AObjs are evaluated in simulation time, so opening the menu also freezes the scenery. */
export class StagePose {
  readonly world: Float32Array;
  readonly hidden = new Set<number>();
  private rest: Float32Array;
  private local: Float32Array;
  private scales: Float32Array;
  private visible: Uint8Array;
  private baseVisible: Uint8Array;
  private sampledFrame = -1;
  private baseMaterials;
  constructor(readonly model: FighterModel, readonly animation: StageAnimation = { groups: [] }) {
    this.rest = restPose(model.joints);
    this.local = this.rest.slice();
    this.world = new Float32Array(model.joints.length * 12);
    this.scales = new Float32Array(model.joints.length * 3);
    this.visible = new Uint8Array(model.joints.length);
    this.baseVisible = Uint8Array.from(model.joints, (j) => j.flags & 16 ? 0 : 1);
    this.baseMaterials = structuredClone(model.materials);
    this.sample(0);
  }

  sample(frame: number): void {
    if (frame === this.sampledFrame || (this.sampledFrame >= 0 && !this.animation.groups.length)) return;
    this.sampledFrame = frame;
    const { model } = this;
    this.local.set(this.rest);
    this.visible.set(this.baseVisible);
    model.materials.forEach((m, i) => {
      const b = this.baseMaterials[i];
      m.alpha = b.alpha;
      m.diffuse = [...b.diffuse]; m.ambient = [...b.ambient];
      if (b.uvOffset) m.uvOffset = [...b.uvOffset];
      if (b.textureScale) m.textureScale = [...b.textureScale];
      m.uvRotation = b.uvRotation;
    });
    for (const g of this.animation.groups) {
      const at = g.duration > 0 ? g.loop ? frame % g.duration : Math.min(frame, g.duration) : 0;
      for (const t of g.tracks) {
        const v = sampleTrack(t, at);
        if (v === undefined) continue;
        const c = t.channel;
        if (g.target === 'joint') {
          if (c in SLOTS) this.local[g.index * 9 + SLOTS[c]] = c >= 8 && c <= 10 && Math.abs(v) < 0.001 ? 0.001 : v;
          else if (c === 11 || c === 12) {
            this.visible[g.index] = v > 0.5 ? 1 : 0;
            if (c === 12) for (let i = g.index + 1; i < model.joints.length; i++) {
              let p = model.joints[i].parent;
              while (p > g.index) p = model.joints[p].parent;
              if (p === g.index) this.visible[i] = v > 0.5 ? 1 : 0;
            }
          }
        } else {
          const m = model.materials[g.index];
          if (g.target === 'material') {
            if (c >= 1 && c <= 3) m.ambient[c - 1] = v;
            else if (c >= 4 && c <= 6) m.diffuse[c - 4] = v;
            else if (c === 10) m.alpha = Math.max(0, Math.min(1, v));
          } else {
            if (c === 2 || c === 3) (m.uvOffset ??= [0, 0])[c - 2] = v;
            else if (c === 4 || c === 5) (m.textureScale ??= [1, 1])[c - 4] = v;
            else if (c === 8) m.uvRotation = v;
          }
        }
      }
    }
    this.hidden.clear();
    for (const m of model.materials) if (!this.visible[m.joint]) this.hidden.add(m.dobj);
    worldMatrices(model.joints, this.local, this.world, this.scales);
  }
}
