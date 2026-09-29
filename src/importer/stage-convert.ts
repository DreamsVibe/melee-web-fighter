// A stage from its Gr*.dat: collision lines (coll_data, mp/types.h MapCollData), the general points
// (map_head +0: joint trees whose joints mark spawns, blast zones and the camera range; Ground_801C1E94
// and Ground_801C2D24 in gr/ground.c) and the model parts (map_head +8, one joint tree per gobj).
import { Archive } from './hsd';
import { extractModel, readRig } from './model';
import { tidy } from './data-convert';
import { restPose, worldMatrices } from '../render/pose';
import { writeMesh, writeSkeleton, writeTexture, type MaterialDef, type SkeletonJoint } from '../shared/modelfile';
import { SegKind, type Segment } from '../engine/stagetypes';
import { FORMAT_VERSION } from '../shared/db';
import { stageDir, type StageEntry, type StageFile } from '../shared/stages';
import type { Log, OutFile } from './pipeline';
import { readStageAnimation } from './stage-animation';
import { writeStageAnimation } from '../shared/stage-animation';

/** MapLine lo_flags (mp/forward.h). */
const LINE_FLAG_PLATFORM = 1 << 8;
const LINE_FLAG_LEDGE = 1 << 9;
/** MapLineGroup order in MapCollData.ranges. */
const GROUP_KIND = [SegKind.Floor, SegKind.Ceiling, SegKind.WallRight, SegKind.WallLeft];

/** Every line as an engine segment. Floors run left to right; walls from their top point down. */
export function readCollision(a: Archive): Segment[] {
  const c = a.root('coll_data');
  const verts = a.ptr(c), lines = a.ptr(c + 8);
  const v = (i: number): [number, number] => [a.f32(verts + 8 * i), a.f32(verts + 8 * i + 4)];
  // Collision joints (MapJoint, 0x28 bytes): lines of a moving part share a group.
  const joints = a.ptr(c + 0x24), jointCount = a.u32(c + 0x28);
  const groupOf = (line: number) => {
    for (let j = 0; j < jointCount; j++) {
      const mj = joints + 0x28 * j;
      for (let g = 0; g < 5; g++) {
        const start = a.s16(mj + 4 * g), n = a.s16(mj + 4 * g + 2);
        if (line >= start && line < start + n) return 1 + j;
      }
    }
    return 1;
  };
  const floorLines: number[] = [];
  const segs: Segment[] = [];
  for (let g = 0; g < 4; g++) {
    const start = a.s16(c + 0x10 + 4 * g), n = a.s16(c + 0x12 + 4 * g);
    for (let i = start; i < start + n; i++) {
      const o = lines + 0x10 * i;
      let [p0, p1] = [v(a.u16(o)), v(a.u16(o + 2))];
      const lo = a.u16(o + 0xe);
      const kind = GROUP_KIND[g] === SegKind.Floor && lo & LINE_FLAG_PLATFORM ? SegKind.Platform : GROUP_KIND[g];
      if (g <= 1 && p0[0] > p1[0]) [p0, p1] = [p1, p0];
      if (g >= 2 && p0[1] < p1[1]) [p0, p1] = [p1, p0];
      const seg: Segment = { kind, x0: tidy(p0[0]), y0: tidy(p0[1]), x1: tidy(p1[0]), y1: tidy(p1[1]), group: groupOf(i), ledges: 0 };
      if (g === 0) {
        // The engine's floors are flat (Final Destination's and Battlefield's are).
        if (seg.y0 !== seg.y1) seg.y0 = seg.y1 = tidy((seg.y0 + seg.y1) / 2);
        if (lo & LINE_FLAG_LEDGE) floorLines.push(segs.length);
      }
      segs.push(seg);
    }
  }
  // A ledge line's ends are ledges where no other floor continues it (the game finds this through
  // its line-of-sight checks; the middle joins of a split floor are never catchable).
  const floors = segs.filter((s) => s.kind === SegKind.Floor || s.kind === SegKind.Platform);
  const joined = (x: number, y: number, self: Segment) => floors.some((s) => s !== self && ((s.x0 === x && s.y0 === y) || (s.x1 === x && s.y1 === y)));
  for (const k of floorLines) {
    const s = segs[k];
    s.ledges = (joined(s.x0, s.y0, s) ? 0 : 1) | (joined(s.x1, s.y1, s) ? 0 : 2);
  }
  return segs;
}

/** General points: id → world position of the joint that marks it (Ground_801C2D24). */
export function readPoints(a: Archive): Map<number, [number, number]> {
  const head = a.root('map_head');
  const entries = a.ptr(head), count = a.u32(head + 4);
  const out = new Map<number, [number, number]>();
  for (let e = 0; e < count; e++) {
    const o = entries + 0xc * e;
    const { joints } = readRig(a, a.ptr(o));
    const skel: SkeletonJoint[] = joints.map((j) => ({ ...j, inverseBind: null }));
    const world = new Float32Array(skel.length * 12);
    worldMatrices(skel, restPose(skel), world, new Float32Array(skel.length * 3));
    const pairs = a.ptr(o + 4), n = a.u32(o + 8);
    for (let k = 0; k < n; k++) {
      const index = a.s16(pairs + 4 * k), id = a.s16(pairs + 4 * k + 2);
      if (index < skel.length) out.set(id, [tidy(world[index * 12 + 3]), tidy(world[index * 12 + 7])]);
    }
  }
  return out;
}

const box = (p: [number, number] | undefined, q: [number, number] | undefined): [number, number, number, number] | null =>
  p && q ? [Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[1], q[1])] : null;

export function convertStage(data: Uint8Array, spec: StageEntry, log: Log): OutFile[] {
  const a = new Archive(data);
  const dir = stageDir(spec.id);
  const segments = readCollision(a);
  const points = readPoints(a);
  const modelScale = a.roots.has('grGroundParam') ? a.f32(a.root('grGroundParam')) : 1;
  if (!(modelScale > 0 && Number.isFinite(modelScale))) throw new Error(`${spec.name}: invalid stage scale`);
  for (const s of segments) for (const key of ['x0', 'y0', 'x1', 'y1'] as const) s[key] = tidy(s[key] * modelScale);
  for (const [id, p] of points) points.set(id, [tidy(p[0] * modelScale), tidy(p[1] * modelScale)]);
  const files: OutFile[] = [];
  // Model parts (map_head +8: 0x34-byte gobj descriptions, the joint tree first).
  const head = a.root('map_head');
  const gobjs = a.ptr(head + 8), gobjCount = a.u32(head + 0xc);
  const models: string[] = [];
  for (let g = 0; g < gobjCount; g++) {
    // Part 5 is Battlefield's alternate single-player scenery, not part of the VS scene.
    if (spec.id === 'battlefield' && g === 5) continue;
    const root = a.ptr(gobjs + 0x34 * g);
    if (!root) continue;
    let m;
    try { m = extractModel(a, root, spec.id === 'battlefield'); } catch (e) {
      if (spec.id === 'battlefield') throw new Error(`${spec.name} part ${g}: ${(e as Error).message}`);
      log(`${spec.name} part ${g}: skipped (${(e as Error).message})`); continue;
    }
    if (!m.indices.length) continue;
    // Laid out like a character folder (model/, textures/), so the same loader reads it.
    const md = `parts/${g}/`;
    models.push(md);
    files.push({ path: dir + md + 'model/skeleton.skel', data: writeSkeleton(m.joints.map((j) => ({ ...j, inverseBind: j.inverseBind ? new Float32Array(j.inverseBind) : null }))) });
    files.push({
      path: dir + md + 'model/mesh.mesh',
      data: writeMesh({
        vertices: new Float32Array(m.vertices), bones: new Uint8Array(m.bones), weights: new Uint8Array(m.weights),
        indices: m.vertices.length / 8 > 65535 ? new Uint32Array(m.indices) : new Uint16Array(m.indices), batches: m.batches,
      }),
    });
    const materials: MaterialDef[] = m.materials.map((mt) => ({
      diffuse: mt.diffuse, ambient: mt.ambient, texture: mt.texture >= 0 ? `textures/tex${String(mt.texture).padStart(2, '0')}.tex` : null,
      uvScale: mt.uvScale, wrap: mt.wrap, translucent: mt.translucent, alpha: mt.alpha, dobj: mt.dobj, joint: mt.joint,
      ...(spec.id === 'battlefield' ? { environment: mt.environment, uvOffset: mt.uvOffset, uvRotation: mt.uvRotation,
        textureScale: mt.textureScale, unlit: g !== 6 } : {}),
    }));
    files.push({ path: dir + md + 'model/materials.json', data: JSON.stringify(materials) });
    m.textures.forEach((t, i) => files.push({ path: dir + md + `textures/tex${String(i).padStart(2, '0')}.tex`, data: writeTexture(t) }));
    if (spec.id === 'battlefield') {
      const animation = readStageAnimation(a, gobjs + 0x34 * g, m);
      if (animation.groups.length) files.push({ path: dir + md + 'animation.json', data: writeStageAnimation(animation) });
    }
  }
  const spawns = [0, 1, 2, 3].map((i) => points.get(i)).filter((p): p is [number, number] => !!p);
  const respawns = [4, 5, 6, 7].map((i) => points.get(i)).filter((p): p is [number, number] => !!p);
  const stage: StageFile = {
    id: spec.id, name: spec.name, formatVersion: FORMAT_VERSION, segments,
    spawns, respawns: respawns.length ? respawns : spawns,
    // The game's own fallbacks when a stage has no such points (Ground_801C3BB4, Ground_801C39C0).
    blast: box(points.get(0x97), points.get(0x98)) ?? [-250, 250, -100, 200],
    camera: box(points.get(0x95), points.get(0x96)) ?? [-170, 170, -60, 120],
    models, modelScale,
    ...(spec.id === 'battlefield' ? { background: { scenes: ['parts/1/', 'parts/2/', 'parts/4/'], transition: 'parts/3/',
      waitMin: 2400, waitRange: 1200, fadeFrames: 200 } } : {}),
  };
  files.push({ path: dir + 'stage.json', data: JSON.stringify(stage, null, 2) + '\n' });
  log(`${spec.name}: ${segments.length} collision lines, ${points.size} points, ${models.length} model parts`);
  return files;
}
