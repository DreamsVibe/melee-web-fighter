// Move effects the game draws with its own models and particles, drawn here as simple 2D shapes on an
// offscreen canvas that is composited over the fighter (like the debug layer): blaster shots, the
// shield bubble, the reflector, Firefox's flames and hit sparks. Nothing touches the page.
import type { Engine } from '../engine/engine';
import { shieldRadius } from '../engine/groundmoves';
import type { ViewLike } from './view';

/** Item_UpdateRayAnimation: a shot's beam grows to `scale` × this many units. */
const RAY_UNIT = 11.25;
/** How many frames a hit spark shows. */
const SPARK_FRAMES = 8;

export class EffectsLayer {
  readonly canvas = new OffscreenCanvas(1, 1);
  readonly ctx = this.canvas.getContext('2d')!;
  /** Hit sparks (the game's Ef_Id_Unk1000 burst at the contact point): position, size, age. */
  private sparks: Array<{ x: number; y: number; size: number; age: number }> = [];

  /** A hit landed at (x, y); the burst is bigger the harder it hit. */
  spark(x: number, y: number, kb: number): void {
    this.sparks.push({ x, y, size: Math.min(10, 3 + kb * 0.05), age: 0 });
  }

  /** Draws this frame's effects; returns false (and leaves the canvas alone) when there are none. */
  draw(e: Engine, view: ViewLike): boolean {
    const fp = e.fighter, name = fp.motionName;
    const fire = name.startsWith('SpecialHiHold') || name === 'SpecialHi' || name === 'SpecialAirHi';
    if (!e.projectiles.length && !fp.shielding && !fp.reflecting && !fire && !this.sparks.length) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(window.innerWidth * dpr), h = Math.round(window.innerHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const u = view.ppu;

    // Blaster shots: a red beam trailing each shot's head.
    const maxLen = RAY_UNIT * (e.data.articles.laser?.scale ?? 3);
    for (const p of e.projectiles) {
      const len = Math.min(maxLen, Math.hypot(p.vx, p.vy) * (p.age + 1));
      const [hx, hy] = view.toClient(p.x, p.y);
      const [tx, ty] = view.toClient(p.x - Math.cos(p.angle) * len, p.y - Math.sin(p.angle) * len);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(255,40,40,0.9)';
      ctx.shadowBlur = 1.5 * u;
      ctx.strokeStyle = 'rgba(255,40,50,0.95)';
      ctx.lineWidth = 1.6 * u;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,225,225,0.95)';
      ctx.lineWidth = 0.55 * u;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.restore();
    }

    // Hit sparks: a white-hot star that flashes and fades.
    for (const sp of this.sparks) {
      const [x, y] = view.toClient(sp.x, sp.y);
      const t = sp.age / SPARK_FRAMES, r = sp.size * u * (0.6 + 0.8 * t);
      ctx.save();
      ctx.globalAlpha = 1 - t;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,240,150,0.9)');
      g.addColorStop(1, 'rgba(255,140,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + sp.age * 0.3, rr = i % 2 ? r * 0.45 : r;
        if (i) ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); else ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    this.sparks = this.sparks.filter((sp) => ++sp.age < SPARK_FRAMES);

    // Shield bubble at the shield joint, shrinking as it wears down.
    if (fp.shielding) {
      const [x, y] = view.toClient(...e.jointPoint(e.data.shieldJoint, 0, 0, 0));
      const r = shieldRadius(e) * u;
      const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
      g.addColorStop(0, 'rgba(255,120,120,0.15)');
      g.addColorStop(1, 'rgba(255,40,40,0.55)');
      ctx.fillStyle = g;
      ctx.strokeStyle = 'rgba(255,90,90,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }

    // Reflector: the blue hexagon (ReflectDesc bone, offset and size).
    if (fp.reflecting) {
      const s = e.data.special;
      const [x, y] = view.toClient(...e.jointPoint(s.reflector_bone ?? e.data.transN, s.reflector_offset_x ?? 0, s.reflector_offset_y ?? 6.5, s.reflector_offset_z ?? 0));
      const r = (s.reflector_size ?? 8.5) * e.data.modelScale * u;
      const spin = (e.frame % 12) / 12 * (Math.PI / 3);
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = spin + (i * Math.PI) / 3;
        if (i) ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); else ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(90,200,255,0.3)';
      ctx.strokeStyle = 'rgba(170,235,255,0.95)';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(80,200,255,0.9)';
      ctx.shadowBlur = 8;
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // Firefox: flames gathering while he charges, a blaze behind him in flight.
    if (fire) {
      const [x, y] = view.toClient(fp.pos.x, fp.pos.y + 6);
      const flight = !name.startsWith('SpecialHiHold');
      const flicker = 0.85 + 0.15 * Math.sin(e.frame * 1.7);
      const r = (flight ? 9 : 6 + (e.frame % 6)) * u * flicker;
      const back = flight ? Math.atan2(-fp.selfVel.y, -fp.selfVel.x) : 0;
      const cx = flight ? x + Math.cos(back) * r * 0.4 : x, cy = flight ? y - Math.sin(back) * r * 0.4 : y;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(255,245,200,0.7)');
      g.addColorStop(0.35, 'rgba(255,150,30,0.6)');
      g.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }
    return true;
  }

  destroy(): void { this.canvas.width = this.canvas.height = 1; }
}
