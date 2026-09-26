// Compact binary files for a character's model, written by the importer and read by the renderer.
//   model/skeleton.skel  joints (parent, flags, rest SRT, inverse bind)
//   model/mesh.mesh      vertices, indices, batches
//   model/materials.json one entry per batch material (readable, editable)
//   textures/texNN.tex   RGBA8 or BC1 pixels
import { BinReader, BinWriter } from './bin';

export interface SkeletonJoint {
  parent: number;
  flags: number;
  rotation: [number, number, number];
  scale: [number, number, number];
  position: [number, number, number];
  inverseBind: Float32Array | null;
}

export interface MeshData {
  /** 8 floats per vertex: position xyz, normal xyz, uv st. */
  vertices: Float32Array;
  /** 4 palette indices per vertex (j = joint * inverse bind, J + j = joint alone). */
  bones: Uint8Array;
  /** 4 weights per vertex, summing to 255. */
  weights: Uint8Array;
  indices: Uint16Array | Uint32Array;
  batches: Array<{ first: number; count: number; material: number }>;
}

export interface MaterialDef {
  diffuse: [number, number, number, number];
  ambient: [number, number, number, number];
  texture: string | null;
  uvScale: [number, number];
  wrap: [number, number];
  translucent: boolean;
  alpha: number;
  /** Index of the DObj in the model (for part visibility). */
  dobj: number;
  joint: number;
}

export interface TextureData { width: number; height: number; kind: 'rgba8' | 'bc1'; data: Uint8Array }

export function writeSkeleton(joints: SkeletonJoint[]): Uint8Array {
  const w = new BinWriter().magic('MWSK').u32(1).u32(joints.length);
  for (const j of joints) {
    w.i16(j.parent).u16(0).u32(j.flags);
    for (const v of [...j.rotation, ...j.scale, ...j.position]) w.f32(v);
    w.u8(j.inverseBind ? 1 : 0).u8(0).u16(0);
    if (j.inverseBind) for (const v of j.inverseBind) w.f32(v);
  }
  return w.finish();
}

export function readSkeleton(buf: Uint8Array): SkeletonJoint[] {
  const r = new BinReader(buf);
  r.magic('MWSK'); r.u32();
  const n = r.u32();
  const out: SkeletonJoint[] = [];
  for (let i = 0; i < n; i++) {
    const parent = r.i16(); r.u16();
    const flags = r.u32();
    const f = () => r.f32();
    const rotation: [number, number, number] = [f(), f(), f()];
    const scale: [number, number, number] = [f(), f(), f()];
    const position: [number, number, number] = [f(), f(), f()];
    const hasIb = r.u8(); r.u8(); r.u16();
    let inverseBind: Float32Array | null = null;
    if (hasIb) { inverseBind = new Float32Array(12); for (let k = 0; k < 12; k++) inverseBind[k] = r.f32(); }
    out.push({ parent, flags, rotation, scale, position, inverseBind });
  }
  return out;
}

export function writeMesh(m: MeshData): Uint8Array {
  const n = m.vertices.length / 8;
  const wide = n > 65535;
  const w = new BinWriter().magic('MWMS').u32(1).u32(n).u32(m.indices.length).u32(m.batches.length).u32(wide ? 4 : 2);
  for (const b of m.batches) w.u32(b.first).u32(b.count).u32(b.material);
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    w.f32(m.vertices[o]).f32(m.vertices[o + 1]).f32(m.vertices[o + 2]);
    // Normals as signed bytes, UVs as float (Melee UVs exceed [0,1] with repeat).
    for (let k = 3; k < 6; k++) w.i8(Math.max(-127, Math.min(127, Math.round(m.vertices[o + k] * 127))));
    w.u8(0);
    w.f32(m.vertices[o + 6]).f32(m.vertices[o + 7]);
    for (let k = 0; k < 4; k++) w.u8(m.bones[i * 4 + k]);
    for (let k = 0; k < 4; k++) w.u8(m.weights[i * 4 + k]);
  }
  for (const idx of m.indices) wide ? w.u32(idx) : w.u16(idx);
  return w.finish();
}

/** Returns the mesh plus the raw interleaved vertex bytes, ready for a GPU buffer (32 bytes each). */
export function readMesh(buf: Uint8Array): MeshData & { gpuVertices: Uint8Array } {
  const r = new BinReader(buf);
  r.magic('MWMS'); r.u32();
  const n = r.u32(), ni = r.u32(), nb = r.u32(), isz = r.u32();
  const batches = [];
  for (let i = 0; i < nb; i++) batches.push({ first: r.u32(), count: r.u32(), material: r.u32() });
  const gpuVertices = buf.slice(r.pos, r.pos + n * 32);
  const vertices = new Float32Array(n * 8), bones = new Uint8Array(n * 4), weights = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    vertices[i * 8] = r.f32(); vertices[i * 8 + 1] = r.f32(); vertices[i * 8 + 2] = r.f32();
    vertices[i * 8 + 3] = r.i8() / 127; vertices[i * 8 + 4] = r.i8() / 127; vertices[i * 8 + 5] = r.i8() / 127; r.u8();
    vertices[i * 8 + 6] = r.f32(); vertices[i * 8 + 7] = r.f32();
    for (let k = 0; k < 4; k++) bones[i * 4 + k] = r.u8();
    for (let k = 0; k < 4; k++) weights[i * 4 + k] = r.u8();
  }
  const raw = buf.slice(r.pos, r.pos + ni * isz);
  const indices = isz === 4 ? new Uint32Array(raw.buffer) : new Uint16Array(raw.buffer);
  return { vertices, bones, weights, indices, batches, gpuVertices };
}

export function writeTexture(t: TextureData): Uint8Array {
  return new BinWriter().magic('MWTX').u16(t.width).u16(t.height).u8(t.kind === 'bc1' ? 1 : 0).u8(0).u16(0).u32(t.data.length).bytes(t.data).finish();
}

export function readTexture(buf: Uint8Array): TextureData {
  const r = new BinReader(buf);
  r.magic('MWTX');
  const width = r.u16(), height = r.u16(), kind = r.u8() === 1 ? 'bc1' : 'rgba8';
  r.u8(); r.u16();
  const len = r.u32();
  return { width, height, kind, data: r.bytes(len).slice() };
}
