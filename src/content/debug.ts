// Debug draw (F9): an offscreen 2D canvas for collision, ECB, hitboxes and the input display, which
// the renderer composites into the overlay's WebGL frame (the page gets no second canvas).
import type { PadState } from '../engine/pad';
import { BTN } from '../engine/pad';

export class DebugLayer {
  readonly canvas = new OffscreenCanvas(1, 1);
  readonly ctx = this.canvas.getContext('2d')!;
  enabled = false;

  setEnabled(on: boolean): void { this.enabled = on; }

  begin(): OffscreenCanvasRenderingContext2D | null {
    if (!this.enabled) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(window.innerWidth * dpr), h = Math.round(window.innerHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    return ctx;
  }

  /** Small controller display in the bottom-left corner. */
  drawInput(ctx: OffscreenCanvasRenderingContext2D, pad: PadState, source: string, extra: string): void {
    const x0 = 16, y0 = window.innerHeight - 120;
    ctx.save();
    ctx.fillStyle = 'rgba(15,15,20,0.8)';
    ctx.fillRect(x0 - 8, y0 - 22, 250, 124);
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText(`input: ${source}  ${extra}`, x0, y0 - 8);
    const stick = (cx: number, cy: number, sx: number, sy: number, color: string) => {
      ctx.strokeStyle = '#888'; ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx + (sx / 80) * 30, cy - (sy / 80) * 30, 7, 0, Math.PI * 2); ctx.fill();
    };
    stick(x0 + 32, y0 + 40, pad.stickX, pad.stickY, '#ddd');
    stick(x0 + 104, y0 + 40, pad.cX, pad.cY, '#f5d000');
    const btns: Array<[string, number, string]> = [['A', BTN.A, '#1fbf6e'], ['B', BTN.B, '#e0453a'], ['X', BTN.X, '#ccc'], ['Y', BTN.Y, '#ccc'], ['Z', BTN.Z, '#8a5cf6'], ['L', BTN.L, '#999'], ['R', BTN.R, '#999']];
    btns.forEach(([n, bit, col], i) => {
      ctx.fillStyle = pad.buttons & bit ? col : '#333';
      ctx.fillRect(x0 + 150 + (i % 4) * 22, y0 + 10 + Math.floor(i / 4) * 24, 18, 18);
      ctx.fillStyle = '#fff'; ctx.fillText(n, x0 + 154 + (i % 4) * 22, y0 + 23 + Math.floor(i / 4) * 24);
    });
    ctx.fillStyle = '#999';
    ctx.fillRect(x0 + 150, y0 + 62, (pad.trigL / 140) * 40, 6);
    ctx.fillRect(x0 + 196, y0 + 62, (pad.trigR / 140) * 40, 6);
    ctx.restore();
  }

  destroy(): void { this.canvas.width = this.canvas.height = 1; }
}
