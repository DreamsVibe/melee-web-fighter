// Being hit: knockback into a damage state, hitstun, tumble, and landing from it. Ported from
// ft/kinds/ftCommon/ftCo_Damage.c (ftCo_8008DCE0 and the Damage/DamageFly states), ftCo_DamageFall.c,
// ftCo_DownBound.c, ftCo_Down.c, ftCo_DownStand.c and ft/kinds/ftSandbag/ftsandbag.c. Tech and getup
// inputs are left out: the only fighter that gets hit, Sandbag, has no controller.
import type { Engine } from './engine';
import { MF } from './engine';
import { GA, type Fighter } from './types';
import { def, MS, type StateDef } from './statedefs';
import { airPhysics, fall, groundFriction, selfDeaccel, clampAirDrift } from './physics';
import { airCollision, groundCollision, EdgeMode } from './collision';
import { fallEnter, waitEnter, landingBasic, airIasa, collFallOff } from './states';
import { groundIasa } from './groundmoves';
import { ledgeCatchCheck } from './cliff';

const f = Math.fround;

export const DMG = {
  DamageFall: 38, DamageHi1: 75, DamageN1: 78, DamageLw1: 81, DamageAir1: 84, DamageAir3: 86,
  DamageFlyHi: 87, DamageFlyN: 88, DamageFlyLw: 89, DamageFlyTop: 90, DamageFlyRoll: 91,
  DownBoundU: 183, DownWaitU: 184, DownStandU: 186, DownBoundD: 191, DownWaitD: 192, DownStandD: 194,
  /** Sandbag's own (ftSb_MS_WaitReverse), standing the other way round after a tumble. */
  WaitReverse: 341,
} as const;

/** ftCo_803C5520[air][knockback level][hurtbox height]: the damage state a hit puts a fighter in. */
const DAMAGE_STATES = [
  [[81, 78, 75], [82, 79, 76], [83, 80, 77], [89, 88, 87]],
  [[84, 84, 84], [85, 85, 85], [86, 86, 86], [89, 88, 87]],
];

/** ftCo_Damage_CalcAngle: the hit's angle, or the Sakurai angle (361) by air/ground and knockback. */
function launchAngle(e: Engine, kb: number): number {
  const fp = e.fighter, c = e.c;
  if (fp.kbAngle !== 361) return f(fp.kbAngle * 0.01745329252);
  if (fp.ga === GA.Air) return c.sakurai_air_angle;
  if (kb < c.sakurai_ground_kb_min) return 0;
  const deg = f(f(c.sakurai_ground_angle * f(f(kb - c.sakurai_ground_kb_min) / f(c.sakurai_ground_kb_max - c.sakurai_ground_kb_min))) + 1);
  const r = f(deg * 0.01745329252), max = f(c.sakurai_ground_angle * 0.01745329252);
  return r > max ? max : r;
}

/** ftCo_Damage_CalcVel: a new launch replaces the old one, or combines with it a while after a hit. */
function setKbVel(e: Engine, x: number, y: number): void {
  const fp = e.fighter, kb = fp.kbVel;
  if (fp.sinceHit < e.c.kb_vel_merge_frames) { kb.x = f(x); kb.y = f(y); return; }
  if (kb.x * x < 0) kb.x = f(kb.x + x); else if (Math.abs(x) > Math.abs(kb.x)) kb.x = f(x);
  if (kb.y * y < 0) kb.y = f(kb.y + y); else if (Math.abs(y) > Math.abs(kb.y)) kb.y = f(y);
}

/** ftCo_Damage_CheckAirMotion: an L/R press right before the hit, while falling, softens it. */
function airMotionSoftens(e: Engine): boolean {
  const fp = e.fighter, c = e.c;
  const falling = [25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 236].includes(fp.motionId);
  return falling && fp.counters.lrDigital <= c.air_motion_frames && fp.counters.lrDigitalPrev >= c.a_after_lr_frames;
}

/**
 * ftCo_8008EC90 → ftCo_8008E908 → ftCo_8008DCE0: knockback becomes a launch. Hitstun is 0.4 frames per
 * unit of knockback; the knockback level picks the state (flinch, stronger flinch, fly); on the
 * ground an upward launch lifts off, a downward one slides along the floor (or bounces off it when
 * strong enough).
 */
export function enterDamage(e: Engine): void {
  const fp = e.fighter, c = e.c;
  const kb = fp.kbApplied;
  const scaled = f(kb * c.hitstun_mul);
  fp.hitstun = Math.trunc(scaled) || 1;
  const level = scaled < c.kb_level_1 ? 0 : scaled < c.kb_level_2 ? 1 : scaled < c.kb_level_3 ? 2 : 3;
  let speed = f(kb * c.kb_launch_speed);
  const angle = launchAngle(e, kb);
  let x = f(speed * Math.cos(angle)), y = f(speed * Math.sin(angle));
  fp.facing = fp.hitDir;
  const height = Math.min(2, Math.max(0, fp.hurtHeight));
  let msid: number;
  let bounced = false;
  if (fp.ga === GA.Air) {
    msid = DAMAGE_STATES[1][level][height];
    if (airMotionSoftens(e)) { speed = f(speed * c.air_motion_kb_mul); x = f(speed * Math.cos(angle)); y = f(speed * Math.sin(angle)); }
    setKbVel(e, f(-x * fp.facing), y);
    fp.groundKbVel = 0;
  } else {
    // Floors are flat (normal (0, 1)): the launch's angle to the floor normal decides.
    const px = f(-x * fp.facing), py = y;
    const floorAngle = Math.acos(Math.max(-1, Math.min(1, py / (Math.hypot(px, py) || 1))));
    msid = DAMAGE_STATES[0][level][height];
    if (floorAngle < Math.PI / 2) {
      e.toAir();
      setKbVel(e, px, py);
      fp.groundKbVel = 0;
    } else if (level === 3) {
      e.toAir();
      if (floorAngle > Math.PI / 2 + c.ground_bounce_angle) { setKbVel(e, px, f(-py * c.ground_bounce_mul)); bounced = true; }
      else setKbVel(e, px, py);
      fp.groundKbVel = 0;
    } else {
      fp.groundKbVel = px;
      setKbVel(e, px, 0);
    }
  }
  fp.selfVel.x = fp.selfVel.y = 0;
  fp.grVel = 0;
  if (level === 3 && fp.ga === GA.Air && angle > c.fly_top_angle_min && angle < c.fly_top_angle_max) msid = DMG.DamageFlyTop;
  // (The game may also pick DamageFlyRoll at high percent with its random number generator; the
  // engine stays deterministic and never does.)
  e.changeMotion(msid, MF.None, 0, 1);
  e.animStep();
  fp.mv.dmgCollide = kb > c.kb_collide_threshold ? 1 : 0;
  fp.postHitlag = 'damage';
  fp.timers.lxTimer = fp.timers.lyTimer = 0xfe;
  fp.inHitstun = true;
  fp.sinceHit = 0;
  fp.counters.lr = 0xff;
  // A strong launch plays the "fly" sound when hitlag ends (x1908: 0x4F / 0x50).
  fp.mv.dmgFlySfx = bounced ? 0 : scaled >= c.fly_sfx_1 ? 0x4f : scaled >= c.fly_sfx_2 ? 0x50 : 0;
}

/** ftCo_Damage_OnExitHitlag: the fly sound; a strong launch leaves the fighter invincible a moment. */
export function damageExitHitlag(e: Engine): void {
  const fp = e.fighter;
  if (fp.mv.dmgFlySfx) { e.playSound(fp.mv.dmgFlySfx); fp.mv.dmgFlySfx = 0; }
  if (fp.mv.dmgCollide) {
    fp.mv.dmgCollide = 0;
    if (e.c.kb_collide_frames > fp.invincibleFrames) fp.invincibleFrames = e.c.kb_collide_frames;
    fp.invincible = true;
  }
  fp.postHitlag = null;
}

/** ftCo_8008F744: hitstun counts down; when it runs out the fighter can act again. */
function hitstunTick(fp: Fighter): void {
  if (fp.hitstun > 0) fp.hitstun -= 1;
  if (fp.inHitstun && fp.hitstun <= 0) fp.inHitstun = false;
}

/** ft_80084EEC: in hitstun only gravity and air friction act. */
function hitstunAirPhysics(e: Engine): void {
  fall(e.fighter, e.a.gravity, e.a.terminal_velocity);
  selfDeaccel(e.fighter, e.a.aerial_friction);
}

function damageAirPhysics(e: Engine): void {
  if (e.fighter.inHitstun) hitstunAirPhysics(e);
  else airPhysics(e.fighter, e.a, e.c, (id) => e.playSound(id));
}

/** Air collision for the damage states: platforms hold unless the stick is held down. */
function landed(e: Engine): boolean {
  return airCollision(e.fighter, e.stage, e.moveStart, () => e.fighter.input.ly > e.c.fall_platform_pass_threshold);
}

/** ftCommon_SetGroundedKnockbackIfLanded: knockback carried into a landing slides along the floor. */
function groundedKnockbackOnLanding(e: Engine): void {
  const fp = e.fighter, max = e.c.max_grounded_kb_on_landing;
  if (fp.ga === GA.Ground && fp.groundKbVel === 0) {
    let g = fp.kbVel.x;
    if (g > max) g = max;
    if (g < -max) g = -max;
    fp.groundKbVel = f(g);
    fp.kbVel.x = fp.groundKbVel; fp.kbVel.y = 0;
  }
}

/** A joint's world matrix entry (row r, column c; 3x4 row-major). */
const mtx = (fp: Fighter, joint: number, r: number, c: number) => fp.world[joint * 12 + r * 4 + c];

/**
 * ftCo_80097D40: landing out of tumble or a strong launch. Most fighters bounce (DownBound), face up
 * or down by their hip. Sandbag (ftCo_80097AF4) lies down only if its hip lies flat; otherwise it
 * lands standing, the right way round (Wait) or the other (WaitReverse).
 */
function downBoundEnter(e: Engine): void {
  const fp = e.fighter, sandbag = e.data.id === 'sandbag';
  const hip = e.data.parts[4] ?? 0;
  e.updatePose();
  // x2226_b0 (Sandbag) reads the hip's Z axis instead of its Y axis.
  const col = sandbag ? 2 : 1;
  const rot0 = mtx(fp, hip, 0, col), rot1 = mtx(fp, hip, 1, col);
  if (!sandbag || Math.abs(rot0) < Math.abs(rot1)) {
    if (fp.ga === GA.Air) e.toGround();
    e.changeMotion(rot1 > 0 ? DMG.DownBoundU : DMG.DownBoundD, MF.None, 0, 1);
    playBoundSound(e);
    groundedKnockbackOnLanding(e);
    return;
  }
  if (fp.facing * rot0 > 0) waitEnter(e);
  else {
    if (fp.ga === GA.Air) e.toGround();
    e.changeMotion(DMG.WaitReverse, MF.None, 0, 1);
  }
  groundedKnockbackOnLanding(e);
}

/** ftCo_800976A4: the thud of hitting the floor, louder the faster (and heavier). */
function playBoundSound(e: Engine): void {
  const fp = e.fighter, c = e.c;
  const vx = fp.selfVel.x + fp.kbVel.x, vy = fp.selfVel.y + fp.kbVel.y;
  const d = Math.hypot(vx, vy) * e.a.weight;
  e.playSound(d >= c.down_bound_sfx_1 ? 9 : d >= c.down_bound_sfx_2 ? 10 : 12);
}

/** Damage and DamageAir: flinch, then Fall (air) or Wait (ground) once hitstun and the animation end. */
const damageState = (id: number, name: string): StateDef => ({
  id, name, move: name,
  anim(e) {
    const fp = e.fighter;
    hitstunTick(fp);
    if (!e.isFramesRemaining() && !fp.inHitstun) {
      if (fp.ga === GA.Air) fallEnter(e);
      else waitEnter(e);
    }
  },
  iasa(e) {
    if (e.fighter.inHitstun) return;
    if (e.fighter.ga === GA.Air) airIasa(e);
    else groundIasa(e);
  },
  phys(e) {
    if (e.fighter.ga === GA.Air) damageAirPhysics(e);
    else groundFriction(e.fighter, e.a, e.c);
  },
  coll(e) {
    const fp = e.fighter;
    if (fp.ga === GA.Ground) {
      if (!groundCollision(fp, e.stage, e.moveStart, EdgeMode.Fall)) e.toAir();
      return;
    }
    if (!landed(e)) return;
    const mag = Math.hypot(fp.kbVel.x, fp.kbVel.y);
    if (mag >= e.c.damage_land_down_speed) downBoundEnter(e);
    else if (mag >= e.c.damage_land_speed) landingBasic(e);
    else e.toGround();
  },
});

const NAMES: Record<number, string> = {
  75: 'DamageHi1', 76: 'DamageHi2', 77: 'DamageHi3', 78: 'DamageN1', 79: 'DamageN2', 80: 'DamageN3',
  81: 'DamageLw1', 82: 'DamageLw2', 83: 'DamageLw3', 84: 'DamageAir1', 85: 'DamageAir2', 86: 'DamageAir3',
};
for (let id = 75; id <= 86; id++) def(damageState(id, NAMES[id]));

/** DamageFly*: launched; tumble (DamageFall) once hitstun and the animation end. */
const flyState = (id: number, name: string, roll = false): StateDef => ({
  id, name, move: name,
  anim(e) {
    const fp = e.fighter;
    hitstunTick(fp);
    if ((roll || !e.isFramesRemaining()) && !fp.inHitstun) damageFallEnter(e);
  },
  phys(e) {
    const fp = e.fighter;
    if (fp.ga === GA.Air) damageAirPhysics(e);
    else groundFriction(fp, e.a, e.c);
    // DamageFlyRoll points the fighter along its flight.
    if (roll) fp.xRot = f(fp.facing * Math.atan2(fp.selfVel.x + fp.kbVel.x, fp.selfVel.y + fp.kbVel.y));
  },
  coll(e) { if (landed(e)) downBoundEnter(e); },
});
def(flyState(DMG.DamageFlyHi, 'DamageFlyHi'));
def(flyState(DMG.DamageFlyN, 'DamageFlyN'));
def(flyState(DMG.DamageFlyLw, 'DamageFlyLw'));
def(flyState(DMG.DamageFlyTop, 'DamageFlyTop'));
def(flyState(DMG.DamageFlyRoll, 'DamageFlyRoll', true));

/** ftCo_80090780: tumble. */
export function damageFallEnter(e: Engine): void {
  const fp = e.fighter;
  if (fp.ga === GA.Ground) e.toAir();
  e.changeMotion(DMG.DamageFall, MF.KeepFastFall | MF.SkipHit, 0, 1);
  clampAirDrift(fp, e.a);
}

def({
  id: DMG.DamageFall, name: 'DamageFall', move: 'DamageFall',
  iasa(e) {
    if (airIasa(e)) return;
    const fp = e.fighter, c = e.c;
    const original = fp.timers.lxTimer < c.damagefall_drift_window;
    const ucf = fp.timers.lxTimer === 1 && Math.abs(fp.input.plx) < c.damagefall_drift_threshold && e.ucf.fastX();
    if (Math.abs(fp.input.lx) >= c.damagefall_drift_threshold && (original || ucf)) fallEnter(e);
  },
  phys(e) { airPhysics(e.fighter, e.a, e.c, (id) => e.playSound(id)); },
  // ft_8008370C: a tumble can catch a ledge.
  coll(e) { if (landed(e)) downBoundEnter(e); else ledgeCatchCheck(e, 'facing'); },
});

/** ftCo_80097E8C: lying down after the bounce. */
function downWaitEnter(e: Engine): void {
  const fp = e.fighter;
  if (fp.ga === GA.Air) e.toGround();
  fp.mv.downWait = e.c.down_wait_frames;
  e.changeMotion(fp.motionId === DMG.DownBoundU ? DMG.DownWaitU : DMG.DownWaitD, MF.None, 0, 1);
  e.animStep();
}

for (const [bound, wait, stand, suffix] of [[DMG.DownBoundU, DMG.DownWaitU, DMG.DownStandU, 'U'], [DMG.DownBoundD, DMG.DownWaitD, DMG.DownStandD, 'D']] as const) {
  def({
    id: bound, name: `DownBound${suffix}`, move: `DownBound${suffix}`,
    anim(e) { if (!e.isFramesRemaining()) downWaitEnter(e); },
    phys(e) { groundFriction(e.fighter, e.a, e.c); },
    coll: collFallOff,
  });
  def({
    id: wait, name: `DownWait${suffix}`, move: `DownWait${suffix}`,
    // ftCo_DownWait_Anim: after a while the fighter gets up by itself.
    anim(e) {
      const fp = e.fighter;
      fp.mv.downWait -= 1;
      if (fp.mv.downWait <= 0) e.changeMotion(stand, MF.None, 0, 1);
    },
    phys(e) { groundFriction(e.fighter, e.a, e.c); },
    coll: collFallOff,
  });
  def({
    id: stand, name: `DownStand${suffix}`, move: `DownStand${suffix}`,
    anim(e) { if (!e.isFramesRemaining()) waitEnter(e); },
    phys(e) { groundFriction(e.fighter, e.a, e.c); },
    coll: collFallOff,
  });
}

/** Sandbag's WaitReverse (ftSb_WaitReverse_*): it just stands there until hit again. */
export const WAIT_REVERSE: StateDef = {
  id: DMG.WaitReverse, name: 'WaitReverse', move: 'WaitReverse',
  phys(e) { groundFriction(e.fighter, e.a, e.c); },
  coll: collFallOff,
};

export { MS };
