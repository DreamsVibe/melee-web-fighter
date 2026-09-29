// Extracts a model's skeleton, skinned mesh and materials: a fighter's costume archive (PlFxNr.dat),
// or one of a stage's model parts (a joint tree in GrNLa.dat).
// Follows melee-unlocked's native/Geometry.h, which follows HSD's JObj/DObj/MObj/PObj layout.
import { Archive, HsdError } from './hsd';
import { decodeTObj, type DecodedTexture } from './gx';

export interface Joint {
  address: number;
  parent: number;
  flags: number;
  rotation: [number, number, number];
  scale: [number, number, number];
  position: [number, number, number];
  inverseBind: number[] | null; // 3x4 row-major
}

export interface Material {
  diffuse: [number, number, number, number];
  ambient: [number, number, number, number];
  texture: number; // index into textures, -1 = none
  uvScale: [number, number];
  wrap: [number, number]; // 0 clamp, 1 repeat, 2 mirror
  renderMode: number;
  texFlags: number;
  alpha: number;
  translucent: boolean;
  joint: number;
  dobj: number;
}

/** Palette slot: joint index, and whether the joint's inverse bind matrix applies. */
interface Influence { joint: number; weight: number; bind: boolean }

export interface ExtractedModel {
  joints: Joint[];
  /** Interleaved per vertex: pos xyz, normal xyz, uv st. */
  vertices: number[];
  /** Up to 4 influences per vertex, as palette indices (joint or joints+joint for bind-less). */
  bones: number[];
  weights: number[];
  indices: number[];
  batches: Array<{ first: number; count: number; material: number }>;
  materials: Material[];
  textures: DecodedTexture[];
}

export function readRig(a: Archive, rootOffset: number): { joints: Joint[]; index: Map<number, number> } {
  const joints: Joint[] = [];
  const index = new Map<number, number>();
  const visit = (at: number, parent: number): void => {
    // Iterative over siblings to keep recursion depth to the tree depth.
    for (let o = at; o; o = a.ptr(o + 12)) {
      if (joints.length > 4096 || index.has(o)) throw new HsdError('Invalid joint hierarchy');
      const v3 = (b: number): [number, number, number] => [a.f32(o + b), a.f32(o + b + 4), a.f32(o + b + 8)];
      const ib = a.ptr(o + 0x38);
      const j: Joint = {
        address: o, parent, flags: a.u32(o + 4),
        rotation: v3(0x14), scale: v3(0x20), position: v3(0x2c),
        inverseBind: ib ? Array.from({ length: 12 }, (_, k) => a.f32(ib + 4 * k)) : null,
      };
      const me = joints.length;
      index.set(o, me);
      joints.push(j);
      const child = a.ptr(o + 8);
      if (child) visit(child, me);
    }
  };
  visit(rootOffset, -1);
  return { joints, index };
}

interface Attr { attr: number; type: number; count: number; format: number; frac: number; stride: number; data: number }

function componentWidth(format: number): number { return format < 2 ? 1 : format < 4 ? 2 : 4; }

function readComponent(a: Archive, at: number, format: number, frac: number): number {
  if (format === 4) return a.f32(at);
  const v = format === 0 ? a.u8(at) : format === 1 ? a.s8(at) : format === 2 ? a.u16(at) : a.s16(at);
  return v / (1 << frac);
}

function directSize(t: Attr): number {
  if (t.attr <= 8) return 1;
  if (t.attr === 11 || t.attr === 12) return [2, 3, 4, 2, 3, 4][t.format] ?? 4;
  const n = t.attr === 9 ? (t.count === 0 ? 2 : 3) : t.attr === 10 ? (t.count === 0 ? 3 : 9) : (t.count === 0 ? 1 : 2);
  return n * componentWidth(t.format);
}

/** The model under `root` (a JObj), by default the archive's `*_joint` root. */
export function extractModel(a: Archive, root = a.rootEndingWith('_joint')[1]): ExtractedModel {
  const { joints, index } = readRig(a, root);
  const out: ExtractedModel = { joints, vertices: [], bones: [], weights: [], indices: [], batches: [], materials: [], textures: [] };
  const texIndex = new Map<number, number>();
  const J = joints.length;
  // Vertex de-duplication across a PObj's primitives.
  let dedupe = new Map<string, number>();

  let dobjCounter = 0;
  joints.forEach((joint, owner) => {
    for (let dobj = a.ptr(joint.address + 0x10); dobj; dobj = a.ptr(dobj + 4)) {
      const dobjId = dobjCounter++;
      const mobj = a.ptr(dobj + 8);
      const mat: Material = {
        diffuse: [0.8, 0.8, 0.8, 1], ambient: [0.5, 0.5, 0.5, 1], texture: -1, uvScale: [1, 1], wrap: [1, 1],
        renderMode: 0, texFlags: 0, alpha: 1, translucent: false, joint: owner, dobj: dobjId,
      };
      if (mobj) {
        mat.renderMode = a.u32(mobj + 4);
        const matDesc = a.ptr(mobj + 0xc);
        if (matDesc) {
          mat.ambient = [a.u8(matDesc) / 255, a.u8(matDesc + 1) / 255, a.u8(matDesc + 2) / 255, a.u8(matDesc + 3) / 255];
          mat.diffuse = [a.u8(matDesc + 4) / 255, a.u8(matDesc + 5) / 255, a.u8(matDesc + 6) / 255, a.u8(matDesc + 7) / 255];
          mat.alpha = a.f32(matDesc + 0xc);
        }
        mat.translucent = (mat.renderMode & (1 << 30)) !== 0 || mat.alpha < 0.999;
        // First UV-mapped texture of the chain drives the colour; reflection maps are skipped.
        for (let tobj = a.ptr(mobj + 8); tobj; tobj = a.ptr(tobj + 4)) {
          const flags = a.u32(tobj + 0x40);
          const coord = flags & 0xf;
          if (coord !== 0) continue;
          let ti = texIndex.get(tobj);
          if (ti === undefined) {
            const tex = decodeTObj(a, tobj);
            if (!tex) continue;
            ti = out.textures.length;
            out.textures.push(tex);
            texIndex.set(tobj, ti);
          }
          mat.texture = ti;
          mat.texFlags = flags;
          mat.uvScale = [a.u8(tobj + 0x3c) || 1, a.u8(tobj + 0x3d) || 1];
          mat.wrap = [a.u32(tobj + 0x34), a.u32(tobj + 0x38)];
          break;
        }
      }
      const matIndex = out.materials.length;
      out.materials.push(mat);

      for (let pobj = a.ptr(dobj + 0xc); pobj; pobj = a.ptr(pobj + 4)) {
        const first = out.indices.length;
        dedupe = new Map();
        const kind = a.u16(pobj + 0xc) & 0x3000;
        if (kind === 0x1000) continue; // shape animation: not used by Fox's body
        const palettes: Influence[][] = [];
        if (kind === 0x2000) {
          const table = a.ptr(pobj + 0x14);
          for (let slot = 0; slot < 10; slot++) {
            let env = a.ptr(table + slot * 4);
            if (!env) break;
            const ws: Influence[] = [];
            for (let n = 0; n < J; n++, env += 8) {
              const ref = a.ptr(env);
              if (!ref) break;
              const j = index.get(ref);
              if (j === undefined) throw new HsdError('Envelope names an unknown joint');
              ws.push({ joint: j, weight: a.f32(env + 4), bind: true });
            }
            if (!ws.length) throw new HsdError('Empty envelope');
            if (ws[0].weight >= 1 - 1.192092896e-7) { ws.length = 1; ws[0].bind = false; }
            palettes.push(ws);
          }
        } else {
          palettes.push([{ joint: owner, weight: 1, bind: false }]);
          const shared = a.ptr(pobj + 0x14);
          if (shared && index.has(shared)) palettes.push([{ joint: index.get(shared)!, weight: 1, bind: false }]);
        }
        const attrs: Attr[] = [];
        for (let v = a.ptr(pobj + 8); ; v += 0x18) {
          const attr = a.u32(v);
          if (attr === 0xff) break;
          if (attrs.length > 32) throw new HsdError('Unterminated vertex attribute list');
          attrs.push({ attr, type: a.u32(v + 4), count: a.u32(v + 8), format: a.u32(v + 12), frac: a.u8(v + 16), stride: a.u16(v + 18), data: a.ptr(v + 20) });
        }
        let cur = a.ptr(pobj + 0x10);
        const end = cur + a.u16(pobj + 0xe) * 32;
        while (cur < end) {
          const cmd = a.u8(cur++);
          if (!cmd) continue;
          const prim = cmd & 0xf8;
          if (prim !== 0x80 && prim !== 0x90 && prim !== 0x98 && prim !== 0xa0) throw new HsdError(`Unsupported display list primitive 0x${cmd.toString(16)}`);
          const count = a.u16(cur); cur += 2;
          const verts: number[] = [];
          for (let n = 0; n < count; n++) {
            let pos = [0, 0, 0], nrm = [0, 1, 0], uv = [0, 0], mtx = 0;
            for (const t of attrs) {
              if (!t.type) continue;
              let at = cur;
              if (t.type === 1) cur += directSize(t);
              else if (t.type === 2 || t.type === 3) {
                const idx = t.type === 2 ? a.u8(cur) : a.u16(cur);
                cur += t.type === 2 ? 1 : 2;
                at = t.data + idx * t.stride;
              } else throw new HsdError('Unknown vertex attribute type');
              const w = componentWidth(t.format);
              if (t.attr === 0) mtx = Math.floor(a.u8(at) / 3);
              else if (t.attr === 9) pos = [0, 1, 2].map((k) => (k < (t.count ? 3 : 2) ? readComponent(a, at + k * w, t.format, t.frac) : 0));
              else if (t.attr === 10 && t.count === 0) {
                const frac = t.format === 1 ? 6 : t.format === 3 ? 14 : 0;
                nrm = [0, 1, 2].map((k) => readComponent(a, at + k * w, t.format, frac));
              } else if (t.attr === 13) {
                uv = [readComponent(a, at, t.format, t.frac), t.count ? readComponent(a, at + w, t.format, t.frac) : 0];
              }
            }
            const pal = palettes[mtx];
            if (!pal) throw new HsdError('Vertex matrix index out of range');
            verts.push(emit(out, dedupe, pos, nrm, uv, pal, J));
          }
          const tri = (x: number, y: number, z: number) => out.indices.push(verts[x], verts[y], verts[z]);
          if (prim === 0x90) for (let i = 0; i + 2 < count; i += 3) tri(i, i + 1, i + 2);
          else if (prim === 0x80) for (let i = 0; i + 3 < count; i += 4) { tri(i, i + 1, i + 2); tri(i, i + 2, i + 3); }
          else if (prim === 0x98) for (let i = 2; i < count; i++) (i & 1) ? tri(i - 1, i - 2, i) : tri(i - 2, i - 1, i);
          else for (let i = 2; i < count; i++) tri(0, i - 1, i);
        }
        if (out.indices.length > first) out.batches.push({ first, count: out.indices.length - first, material: matIndex });
      }
    }
  });
  return out;
}

function emit(out: ExtractedModel, dedupe: Map<string, number>, pos: number[], nrm: number[], uv: number[], pal: Influence[], J: number): number {
  // Keep the four heaviest influences, renormalised to sum 255.
  const inf = [...pal].sort((x, y) => y.weight - x.weight).slice(0, 4);
  const total = inf.reduce((s, i) => s + i.weight, 0) || 1;
  const bones = [0, 0, 0, 0], weights = [0, 0, 0, 0];
  let acc = 0;
  inf.forEach((i, k) => {
    bones[k] = i.bind ? i.joint : J + i.joint;
    weights[k] = k === inf.length - 1 ? 255 - acc : Math.round((i.weight / total) * 255);
    acc += weights[k];
  });
  const key = `${pos.join(',')}|${nrm.join(',')}|${uv.join(',')}|${bones.join(',')}|${weights.join(',')}`;
  const found = dedupe.get(key);
  if (found !== undefined) return found;
  const id = out.vertices.length / 8;
  out.vertices.push(pos[0], pos[1], pos[2], nrm[0], nrm[1], nrm[2], uv[0], uv[1]);
  out.bones.push(...bones);
  out.weights.push(...weights);
  dedupe.set(key, id);
  return id;
}
