// Draws a 2D canvas (the debug layer) over the WebGL frame as one textured full-screen quad, so the
// overlay stays a single DOM canvas.
export class CanvasQuad {
  private program: WebGLProgram;
  private tex: WebGLTexture;
  private vao: WebGLVertexArrayObject;

  constructor(private gl: WebGL2RenderingContext) {
    const vs = `#version 300 es
    out vec2 uv;
    void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); uv = vec2(p.x, 1.0 - p.y); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
    const fs = `#version 300 es
    precision mediump float; in vec2 uv; uniform sampler2D t; out vec4 o; void main() { o = texture(t, uv); }`;
    const mk = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(this.program, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(this.program);
    this.tex = gl.createTexture()!;
    this.vao = gl.createVertexArray()!;
  }

  draw(source: OffscreenCanvas | HTMLCanvasElement): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
}
