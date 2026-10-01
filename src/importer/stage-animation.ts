// HSD_AnimJoint / MatAnimJoint trees, with linked FObjDesc streams (unlike fighter figatrees).
import { Archive } from './hsd';
import type { ExtractedModel } from './model';
import type { StageAnimation, StageTrackGroup } from '../shared/stage-animation';

export function readStageAnimation(a: Archive, gobj: number, model: ExtractedModel): StageAnimation {
  const groups: StageTrackGroup[] = [];
  const loop = !!(a.ptr(gobj + 0x28) && a.u8(a.ptr(gobj + 0x28)));
  const add = (ad: number, target: StageTrackGroup['target'], index: number) => {
    if (!ad) return;
    const group: StageTrackGroup = { target, index, duration: a.f32(ad + 4), loop: loop || !!(a.u32(ad) & (1 << 29)), tracks: [] };
    const seen = new Set<number>();
    for (let f = a.ptr(ad + 8); f; f = a.ptr(f)) {
      if (seen.has(f)) throw new Error('Cyclic stage animation tracks');
      seen.add(f);
      group.tracks.push({ channel: a.u8(f + 12), valueFormat: a.u8(f + 13), slopeFormat: a.u8(f + 14),
        startFrame: a.f32(f + 8), bytes: a.bytesAt(a.ptr(f + 16), a.u32(f + 4)).slice() });
    }
    if (group.tracks.length) groups.push(group);
  };
  const walk = (root: number, material: boolean) => {
    let joint = 0;
    const seen = new Set<number>();
    const visit = (node: number) => {
      for (; node; node = a.ptr(node + 4)) {
        if (seen.has(node) || joint >= model.joints.length) throw new Error('Invalid stage animation hierarchy');
        seen.add(node);
        const index = joint++;
        if (!material) add(a.ptr(node + 8), 'joint', index);
        else {
          const materials = model.materials.map((m, i) => ({ m, i })).filter(({ m }) => m.joint === index);
          let mat = a.ptr(node + 8);
          for (const { m, i } of materials) {
            if (!mat) break;
            add(a.ptr(mat + 4), 'material', i);
            const visited = new Set<number>();
            for (let tex = a.ptr(mat + 8); tex; tex = a.ptr(tex)) {
              if (visited.has(tex)) throw new Error('Cyclic stage texture animations');
              visited.add(tex);
              // Only the texture selected by the model converter is used by our material shader.
              if (a.u32(tex + 4) === m.textureId) add(a.ptr(tex + 8), 'texture', i);
            }
            mat = a.ptr(mat);
          }
        }
        visit(a.ptr(node));
      }
    };
    visit(root);
  };
  if (a.ptr(gobj + 4)) walk(a.ptr(a.ptr(gobj + 4)), false);
  if (a.ptr(gobj + 8)) walk(a.ptr(a.ptr(gobj + 8)), true);
  return { groups };
}
