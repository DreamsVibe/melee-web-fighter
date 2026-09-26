// Column-major 4x4 helpers (only what the renderer needs; all write into `out`).

export function ortho(out: Float32Array, l: number, r: number, b: number, t: number, n: number, f: number): Float32Array {
  out.fill(0);
  out[0] = 2 / (r - l); out[5] = 2 / (t - b); out[10] = -2 / (f - n);
  out[12] = -(r + l) / (r - l); out[13] = -(t + b) / (t - b); out[14] = -(f + n) / (f - n); out[15] = 1;
  return out;
}

export function perspective(out: Float32Array, fovy: number, aspect: number, n: number, f: number): Float32Array {
  const t = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = t / aspect; out[5] = t; out[10] = (f + n) / (n - f); out[11] = -1; out[14] = (2 * f * n) / (n - f);
  return out;
}

/** out = translate(x,y,z) * rotateY(ry) * scale(s). */
export function placement(out: Float32Array, x: number, y: number, z: number, ry: number, s: number): Float32Array {
  const c = Math.cos(ry), si = Math.sin(ry);
  out.fill(0);
  out[0] = c * s; out[2] = -si * s;
  out[5] = s;
  out[8] = si * s; out[10] = c * s;
  out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
  return out;
}

export function multiply(out: Float32Array, a: Float32Array, b: Float32Array): Float32Array {
  const r = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) {
    r[c * 4 + row] = a[row] * b[c * 4] + a[4 + row] * b[c * 4 + 1] + a[8 + row] * b[c * 4 + 2] + a[12 + row] * b[c * 4 + 3];
  }
  out.set(r);
  return out;
}

export function lookAt(out: Float32Array, ex: number, ey: number, ez: number, cx: number, cy: number, cz: number): Float32Array {
  let zx = ex - cx, zy = ey - cy, zz = ez - cz;
  const zl = Math.hypot(zx, zy, zz); zx /= zl; zy /= zl; zz /= zl;
  let xx = zz, xy = 0, xz = -zx; // up = (0,1,0): x = up × z
  const xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * ex + xy * ey + xz * ez); out[13] = -(yx * ex + yy * ey + yz * ez); out[14] = -(zx * ex + zy * ey + zz * ez); out[15] = 1;
  return out;
}
