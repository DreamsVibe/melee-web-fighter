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
  for (let i = 0; i < joints.length; i++) {
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
