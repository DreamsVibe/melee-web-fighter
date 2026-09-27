// WebGL2 skinned fighter renderer. Hand-written, no dependencies: one program, a bone palette in a
// float texture, one draw per batch. Used by the page overlay and the importer preview.
import type { MaterialDef, MeshData, SkeletonJoint, TextureData } from '../shared/modelfile';
import { bc1ToRgba } from '../importer/gx';
import { mul34 } from './pose';

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUV;
layout(location=3) in uvec4 aBones;
layout(location=4) in vec4 aWeights;
uniform highp sampler2D uPalette;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform vec2 uUVScale;
out vec3 vNrm;
out vec2 vUV;
mat4 bone(uint b) {
  int x = int(b) * 3;
  vec4 r0 = texelFetch(uPalette, ivec2(x, 0), 0);
  vec4 r1 = texelFetch(uPalette, ivec2(x + 1, 0), 0);
  vec4 r2 = texelFetch(uPalette, ivec2(x + 2, 0), 0);
  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0);
}
void main() {
  mat4 m = bone(aBones.x) * aWeights.x + bone(aBones.y) * aWeights.y + bone(aBones.z) * aWeights.z + bone(aBones.w) * aWeights.w;
  vec4 p = uModel * m * vec4(aPos, 1.0);
  vNrm = normalize(mat3(uModel) * mat3(m) * aNrm);
  vUV = aUV * uUVScale;
  gl_Position = uViewProj * p;
}`;

const FS = `#version 300 es
precision mediump float;
in vec3 vNrm;
in vec2 vUV;
uniform sampler2D uTex;
uniform bool uHasTex;
uniform vec4 uDiffuse;
uniform vec4 uAmbient;
uniform float uAlpha;
uniform bool uTranslucent;
uniform vec4 uTint;
uniform float uGhost;
out vec4 frag;
void main() {
  vec4 t = uHasTex ? texture(uTex, vUV) : vec4(1.0);
  if (!uTranslucent && t.a < 0.5) discard;
  vec3 n = normalize(vNrm);
  float lambert = max(dot(n, normalize(vec3(0.35, 0.55, 0.75))), 0.0);
  float rim = pow(1.0 - abs(n.z), 3.0) * 0.15;
  vec3 light = uAmbient.rgb * 0.55 + uDiffuse.rgb * (0.35 + 0.75 * lambert) + rim;
  vec3 c = t.rgb * light;
  c = mix(c, uTint.rgb, uTint.a);
  frag = vec4(c, (uTranslucent ? t.a * uAlpha * uDiffuse.a : 1.0) * uGhost);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program: ' + gl.getProgramInfoLog(p));
  return p;
}

export interface FighterModel {
  joints: SkeletonJoint[];
  mesh: MeshData & { gpuVertices: Uint8Array };
  materials: MaterialDef[];
  textures: Map<string, TextureData>;
  /** DObj indices hidden by default (the low-detail set). */
  hidden: Set<number>;
}

export class FighterRenderer {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private palette: WebGLTexture;
  private paletteData: Float32Array;
  private textures = new Map<string, WebGLTexture>();
  private u: Record<string, WebGLUniformLocation | null> = {};
  private indexType: number;
  readonly jointCount: number;
  private drawOrder: number[];
  /** Mixed over the final colour, e.g. a red flash. Alpha = strength. */
  tint = new Float32Array([1, 0, 0, 0]);

  constructor(private gl: WebGL2RenderingContext, private model: FighterModel) {
    this.program = compile(gl, VS, FS);
    for (const n of ['uPalette', 'uModel', 'uViewProj', 'uUVScale', 'uTex', 'uHasTex', 'uDiffuse', 'uAmbient', 'uAlpha', 'uTranslucent', 'uTint', 'uGhost']) {
      this.u[n] = gl.getUniformLocation(this.program, n);
    }
    const { mesh } = model;
    this.jointCount = model.joints.length;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.gpuVertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.BYTE, true, 32, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 16);
    gl.enableVertexAttribArray(3); gl.vertexAttribIPointer(3, 4, gl.UNSIGNED_BYTE, 32, 24);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.UNSIGNED_BYTE, true, 32, 28);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    this.indexType = mesh.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    gl.bindVertexArray(null);

    this.paletteData = new Float32Array(this.jointCount * 2 * 12);
    this.palette = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.palette);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.jointCount * 2 * 3, 1, 0, gl.RGBA, gl.FLOAT, null);

    const s3tc = gl.getExtension('WEBGL_compressed_texture_s3tc');
    for (const [name, t] of model.textures) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (t.kind === 'bc1' && s3tc && t.width % 4 === 0 && t.height % 4 === 0) {
        gl.compressedTexImage2D(gl.TEXTURE_2D, 0, s3tc.COMPRESSED_RGBA_S3TC_DXT1_EXT, t.width, t.height, 0, t.data);
      } else {
        const px = t.kind === 'bc1' ? bc1ToRgba(t.width, t.height, t.data) : t.data;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, t.width, t.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      this.textures.set(name, tex);
    }
    // Opaque batches first, translucent ones after.
    this.drawOrder = mesh.batches.map((_, i) => i).sort((a, b) =>
      Number(model.materials[mesh.batches[a].material].translucent) - Number(model.materials[mesh.batches[b].material].translucent));
  }

  /**
   * Draws the fighter. `world` is 3x4 world matrices per joint (model space), `model` a column-major
   * 4x4 placing model space in the scene, `viewProj` column-major. `ghost` below 1 draws the whole
   * fighter see-through (afterimages).
   */
  draw(world: Float32Array, model: Float32Array, viewProj: Float32Array, hidden: Set<number> = this.model.hidden, ghost = 1): void {
    const gl = this.gl;
    const J = this.jointCount;
    const pal = this.paletteData;
    for (let j = 0; j < J; j++) {
      const ib = this.model.joints[j].inverseBind;
      if (ib) mul34(world, j * 12, ib, 0, pal, j * 12);
      else pal.set(world.subarray(j * 12, j * 12 + 12), j * 12);
      pal.set(world.subarray(j * 12, j * 12 + 12), (J + j) * 12);
    }
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.palette);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, J * 2 * 3, 1, gl.RGBA, gl.FLOAT, pal);
    gl.uniform1i(this.u.uPalette, 1);
    gl.uniform1i(this.u.uTex, 0);
    gl.uniformMatrix4fv(this.u.uModel, false, model);
    gl.uniformMatrix4fv(this.u.uViewProj, false, viewProj);
    gl.uniform4fv(this.u.uTint, this.tint);
    gl.uniform1f(this.u.uGhost, ghost);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CW);
    gl.activeTexture(gl.TEXTURE0);
    const bytes = this.indexType === gl.UNSIGNED_INT ? 4 : 2;
    let blending = false;
    for (const bi of this.drawOrder) {
      const b = this.model.mesh.batches[bi];
      const m = this.model.materials[b.material];
      if (hidden.has(m.dobj)) continue;
      if ((m.translucent || ghost < 1) !== blending) {
        blending = m.translucent || ghost < 1;
        if (blending) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
        else { gl.disable(gl.BLEND); gl.depthMask(true); }
      }
      const tex = m.texture ? this.textures.get(m.texture) : undefined;
      gl.uniform1i(this.u.uHasTex, tex ? 1 : 0);
      if (tex) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        const wrap = (w: number) => (w === 2 ? gl.MIRRORED_REPEAT : w === 1 ? gl.REPEAT : gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap(m.wrap[0]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap(m.wrap[1]));
      }
      gl.uniform2f(this.u.uUVScale, m.uvScale[0], m.uvScale[1]);
      gl.uniform4fv(this.u.uDiffuse, m.diffuse);
      gl.uniform4fv(this.u.uAmbient, m.ambient);
      gl.uniform1f(this.u.uAlpha, m.alpha);
      gl.uniform1i(this.u.uTranslucent, m.translucent ? 1 : 0);
      gl.drawElements(gl.TRIANGLES, b.count, this.indexType, b.first * bytes);
    }
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.bindVertexArray(null);
  }
}
