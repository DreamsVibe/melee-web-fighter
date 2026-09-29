// Melee hitlag displacement, including UCF 0.84's first-frame SDI repairs.
import type { Engine } from './engine';
import { GA } from './types';

const f = Math.fround;

export function hitlagSdi(e: Engine): void {
  const fp = e.fighter, c = e.c, i = fp.input, t = fp.timers;
  if (!fp.allowSdi || !fp.postHitlag) return;
  const shield = fp.postHitlag === 'shield', min = c.sdi_min_stick_mag;
  if (shield && fp.ga !== GA.Ground) return;
  const magnitude = shield ? Math.abs(i.lx) >= min : f(f(i.lx * i.lx) + f(i.ly * i.ly)) >= f(min * min);
  const fresh = t.lxTimer < c.sdi_stick_window || !shield && t.lyTimer < c.sdi_stick_window;
  if (!magnitude || !(fresh || e.ucf.sdi(fp, min, shield))) return;
  const scale = shield ? f(c.sdi_pos_scale * c.shield_sdi_mul) : c.sdi_pos_scale;
  fp.pos.x = f(fp.pos.x + f(i.lx * scale));
  if (!shield) { fp.pos.y = f(fp.pos.y + f(i.ly * scale)); t.lyTimer = 254; }
  t.lxTimer = 254;
  fp.poseDirty = true;
}

/** Automatic displacement at hitlag exit. Shield displacement follows the flat floor. */
export function hitlagAsdi(e: Engine): void {
  const fp = e.fighter, c = e.c, i = fp.input;
  if (!fp.allowSdi || !fp.postHitlag) return;
  if (fp.postHitlag === 'shield') {
    if (fp.ga === GA.Ground && Math.abs(i.lx) >= c.sdi_min_stick_mag)
      fp.pos.x = f(fp.pos.x + f(f(i.lx * c.asdi_pos_scale) * c.shield_sdi_mul));
  } else {
    const cstick = f(f(i.cx * i.cx) + f(i.cy * i.cy)) >= f(c.sdi_min_stick_mag ** 2);
    const x = cstick ? i.cx : i.lx, y = cstick ? i.cy : i.ly;
    if (f(f(x * x) + f(y * y)) >= f(c.sdi_min_stick_mag ** 2)) {
      fp.pos.x = f(fp.pos.x + f(x * c.asdi_pos_scale));
      fp.pos.y = f(fp.pos.y + f(y * c.asdi_pos_scale));
    }
  }
  fp.poseDirty = true;
}
