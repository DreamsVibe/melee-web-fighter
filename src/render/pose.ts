// Joint world matrices from local rotation/scale/translation, as HSD computes them
// (melee-unlocked native/Geometry.h: Z*Y*X Euler rotation, inherited-scale compensation).
import type { SkeletonJoint } from '../shared/modelfile';

/** Per-joint local transform channels: 9 floats (rot xyz, scale xyz, pos xyz). */
export type LocalPose = Float32Array;

export function restPose(joints: SkeletonJoint[]): LocalPose {
  const p = new Float32Array(joints.length * 9);
  joints.forEach((j, i) => { p.set(j.rotation, i * 9); p.set(j.scale, i * 9 + 3); p.set(j.position, i * 9 + 6); });
  return p;
}

/**
 * Computes 3x4 row-major world matrices into `out` (12 floats per joint).
 * `scratch` holds accumulated scales (3 per joint). Allocation-free.
 */
export function worldMatrices(joints: SkeletonJoint[], local: LocalPose, out: Float32Array, scratch: Float32Array, classical: Uint8Array | null = null): void {
  for (let i = 0; i < joints.length; i++) jointMatrix(joints, local, out, scratch, i, classical);
}

/** One joint's world matrix from its local channels and its parent's (already computed) matrix. */
export function jointMatrix(joints: SkeletonJoint[], local: LocalPose, out: Float32Array, scratch: Float32Array, i: number, classical: Uint8Array | null = null): void {
  const j = joints[i];
  const o = i * 9;
  const rx = local[o], ry = local[o + 1], rz = local[o + 2];
  const sx = local[o + 3], sy = local[o + 4], sz = local[o + 5];
  const px = local[o + 6], py = local[o + 7], pz = local[o + 8];
  const sX = Math.sin(rx), cX = Math.cos(rx), sY = Math.sin(ry), cY = Math.cos(ry), sZ = Math.sin(rz), cZ = Math.cos(rz);
  let psx = 1, psy = 1, psz = 1;
  if (j.parent >= 0) { psx = scratch[j.parent * 3]; psy = scratch[j.parent * 3 + 1]; psz = scratch[j.parent * 3 + 2]; }
  const isClassical = classical ? classical[i] === 1 : (j.flags & 8) !== 0;
  scratch[i * 3] = isClassical ? psx : psx * sx;
  scratch[i * 3 + 1] = isClassical ? psy : psy * sy;
  scratch[i * 3 + 2] = isClassical ? psz : psz * sz;
  // Rotation R = Rz * Ry * Rx, then column c scaled by s[c]*ps[c]/ps[r].
  const r00 = cZ * cY, r01 = cZ * sX * sY - cX * sZ, r02 = cZ * cX * sY + sX * sZ;
  const r10 = sZ * cY, r11 = sZ * sX * sY + cX * cZ, r12 = sZ * cX * sY - sX * cZ;
  const r20 = -sY, r21 = cY * sX, r22 = cY * cX;
  const c0 = sx * psx, c1 = sy * psy, c2 = sz * psz;
  const l00 = r00 * c0 / psx, l01 = r01 * c1 / psx, l02 = r02 * c2 / psx;
  const l10 = r10 * c0 / psy, l11 = r11 * c1 / psy, l12 = r12 * c2 / psy;
  const l20 = r20 * c0 / psz, l21 = r21 * c1 / psz, l22 = r22 * c2 / psz;
  const m = i * 12;
  if (j.parent < 0) {
    out[m] = l00; out[m + 1] = l01; out[m + 2] = l02; out[m + 3] = px;
    out[m + 4] = l10; out[m + 5] = l11; out[m + 6] = l12; out[m + 7] = py;
    out[m + 8] = l20; out[m + 9] = l21; out[m + 10] = l22; out[m + 11] = pz;
  } else {
    const p = j.parent * 12;
    for (let r = 0; r < 3; r++) {
      const a0 = out[p + r * 4], a1 = out[p + r * 4 + 1], a2 = out[p + r * 4 + 2], a3 = out[p + r * 4 + 3];
      out[m + r * 4] = a0 * l00 + a1 * l10 + a2 * l20;
      out[m + r * 4 + 1] = a0 * l01 + a1 * l11 + a2 * l21;
      out[m + r * 4 + 2] = a0 * l02 + a1 * l12 + a2 * l22;
      out[m + r * 4 + 3] = a0 * px + a1 * py + a2 * pz + a3;
    }
  }
}

/** A joint constraint (HSD RObj) as the character's code sets it up; see ConstraintDef in engine/types. */
export interface JointConstraint { joint: number; position?: number[]; aim?: number; rotXMin?: number; rotXMax?: number }

const MIN = 1.17549435e-38;
const tmpLocal = new Float32Array(12);
const calcVal = (x: number, y: number) => (Math.abs(x) <= MIN ? (y >= 0 ? Math.PI / 2 : -Math.PI / 2) : Math.atan2(y, x));

/**
 * HSD_RObjUpdateAll for the constraint kinds fighters use, run after the pose in joint order:
 * position (type 1: the average of the targets' positions), direction (type 2, resolveCnsDirUp: the X
 * axis points at the target, Y towards world up), then rotation limits (resolveLimits: the local X
 * rotation is clamped and the matrix rebuilt from the local channels).
 */
export function applyConstraints(joints: SkeletonJoint[], constraints: JointConstraint[], local: LocalPose, out: Float32Array, scratch: Float32Array): void {
  for (const c of constraints) {
    const m = c.joint * 12;
    if (c.position?.length) {
      let x = 0, y = 0, z = 0;
      for (const t of c.position) { x += out[t * 12 + 3]; y += out[t * 12 + 7]; z += out[t * 12 + 11]; }
      const k = 1 / c.position.length;
      out[m + 3] = x * k; out[m + 7] = y * k; out[m + 11] = z * k;
    }
    if (c.aim !== undefined) {
      const t = c.aim * 12;
      let dx = out[t + 3] - out[m + 3], dy = out[t + 7] - out[m + 7], dz = out[t + 11] - out[m + 11];
      let ux = 0, uy = 1, uz = 0;
      if (Math.abs(1 - dy) < 1e-10) { uy = 0; uz = 1; }
      // set_dirup_matrix: z = dir x up, then up = z x dir, all unit length.
      let zx = dy * uz - dz * uy, zy = dz * ux - dx * uz, zz = dx * uy - dy * ux;
      const kd = Math.sqrt(1 / (1e-10 + dx * dx + dy * dy + dz * dz));
      dx *= kd; dy *= kd; dz *= kd;
      const kz = Math.sqrt(1 / (1e-10 + zx * zx + zy * zy + zz * zz));
      zx *= kz; zy *= kz; zz *= kz;
      ux = zy * dz - zz * dy; uy = zz * dx - zx * dz; uz = zx * dy - zy * dx;
      out[m] = dx; out[m + 4] = dy; out[m + 8] = dz;
      out[m + 1] = ux; out[m + 5] = uy; out[m + 9] = uz;
      out[m + 2] = zx; out[m + 6] = zy; out[m + 10] = zz;
      // Type 0x37: the local rotation that gives this world matrix.
      const p = joints[c.joint].parent * 12;
      const l = tmpLocal;
      invertMul34(out, p, out, m, l);
      const len0 = Math.hypot(l[0], l[4], l[8]), len1 = Math.hypot(l[1], l[5], l[9]), len2 = Math.hypot(l[2], l[6], l[10]);
      const o = c.joint * 9;
      if (len0 >= MIN && len1 >= MIN && len2 >= MIN) {
        const sy = -l[8] / len0;
        const ry = sy >= 1 ? Math.PI / 2 : sy <= -1 ? -Math.PI / 2 : Math.asin(sy);
        local[o + 1] = ry;
        if (Math.cos(ry) >= MIN) { local[o] = calcVal(l[10] / len2, l[9] / len1); local[o + 2] = calcVal(l[0], l[4]); }
        else { local[o] = calcVal(l[5], l[1]); local[o + 2] = 0; }
      } else { local[o] = local[o + 1] = local[o + 2] = 0; }
    }
    if (c.rotXMin !== undefined || c.rotXMax !== undefined) {
      const o = c.joint * 9;
      if (c.rotXMin !== undefined && local[o] < c.rotXMin) local[o] = c.rotXMin;
      if (c.rotXMax !== undefined && local[o] > c.rotXMax) local[o] = c.rotXMax;
      jointMatrix(joints, local, out, scratch, c.joint);
    }
  }
}

/** out = inverse(a) * b for 3x4 affine matrices (HSD_MtxInverseConcat). */
function invertMul34(a: Float32Array, ao: number, b: Float32Array, bo: number, out: Float32Array): void {
  const a00 = a[ao], a01 = a[ao + 1], a02 = a[ao + 2], a03 = a[ao + 3];
  const a10 = a[ao + 4], a11 = a[ao + 5], a12 = a[ao + 6], a13 = a[ao + 7];
  const a20 = a[ao + 8], a21 = a[ao + 9], a22 = a[ao + 10], a23 = a[ao + 11];
  const det = a00 * (a11 * a22 - a12 * a21) - a01 * (a10 * a22 - a12 * a20) + a02 * (a10 * a21 - a11 * a20);
  const id = 1 / det;
  const i00 = (a11 * a22 - a12 * a21) * id, i01 = (a02 * a21 - a01 * a22) * id, i02 = (a01 * a12 - a02 * a11) * id;
  const i10 = (a12 * a20 - a10 * a22) * id, i11 = (a00 * a22 - a02 * a20) * id, i12 = (a02 * a10 - a00 * a12) * id;
  const i20 = (a10 * a21 - a11 * a20) * id, i21 = (a01 * a20 - a00 * a21) * id, i22 = (a00 * a11 - a01 * a10) * id;
  const inv = [i00, i01, i02, -(i00 * a03 + i01 * a13 + i02 * a23), i10, i11, i12, -(i10 * a03 + i11 * a13 + i12 * a23), i20, i21, i22, -(i20 * a03 + i21 * a13 + i22 * a23)];
  mul34(inv, 0, b, bo, out, 0);
}

/** out = a * b for 3x4 affine matrices (row-major). */
export function mul34(a: Float32Array | number[], ao: number, b: Float32Array | number[], bo: number, out: Float32Array, oo: number): void {
  for (let r = 0; r < 3; r++) {
    const a0 = a[ao + r * 4], a1 = a[ao + r * 4 + 1], a2 = a[ao + r * 4 + 2], a3 = a[ao + r * 4 + 3];
    out[oo + r * 4] = a0 * b[bo] + a1 * b[bo + 4] + a2 * b[bo + 8];
    out[oo + r * 4 + 1] = a0 * b[bo + 1] + a1 * b[bo + 5] + a2 * b[bo + 9];
    out[oo + r * 4 + 2] = a0 * b[bo + 2] + a1 * b[bo + 6] + a2 * b[bo + 10];
    out[oo + r * 4 + 3] = a0 * b[bo + 3] + a1 * b[bo + 7] + a2 * b[bo + 11] + a3;
  }
}
