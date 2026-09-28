// Hits between fighters: hitbox against hurtbox tests, the damage log, stale moves, knockback and the
// reaction to it. Ported from ft/ftcoll.c (ftColl_80078C70 fighter attacks, ftColl_8007925C item
// attacks, ftColl_80076ED8 registering a hit, ftColl_8007A06C picking the strongest, the KNOCKBACK
// formula of ftColl_80079AB0), lb/lbcollision.c (lbColl_8000805C / lbColl_80006E58 capsule test),
// ft/fighter.c (Fighter_procCollResolve), pl/plstale.c + ft/ft_0881.c (stale moves) and
// ft/kinds/ftCommon/ftCo_Damage.c (ftCo_8008DCE0 knockback into a damage state).
import type { Engine } from './engine';
import { GA, type DamageEntry, type Fighter, type HitboxState, type HurtboxDef } from './types';
import { enterDamage } from './damage';

const f = Math.fround;
const DEG = Math.PI / 180;

/** HitElement_Catch: grab boxes never damage. HitElement_Electric: longer hitlag for the victim. */
const ELEMENT_CATCH = 8;
const ELEMENT_ELECTRIC = 2;

/**
 * lbColl_803B9880: the sound a landed hit plays, by the hitbox's sound kind and severity (0x83D60 =
 * none). Only the common bank's ids are imported.
 */
const HIT_SOUNDS = [
  0x83d60, 0x83d60, 0x83d60, 0x5b, 0x5a, 0x59, 0x58, 0x57, 0x56, 0x6f, 0x70, 0x71, 0x54, 0x54, 0x54, 0x5a, 0x59, 0xdf,
  0xe1, 0xe1, 0xe1, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x4461b, 0x4461b, 0x4461b, 0xf1, 0xf1, 0xf1, 0x5e, 0x5d, 0x5c,
  0x35baf, 0x35bb2, 0x35bb5, 0x83d60, 0x83d60, 0x20d,
];

// ============================================================================ stale moves
/** The move id a motion state gives its attacks (the motion table's move_id, FtMoveId). */
export function moveIdOf(msid: number): number {
  if (msid === 44) return 2;
  if (msid === 45) return 3;
  if (msid === 46) return 4;
  if (msid >= 47 && msid <= 49) return 5;
  if (msid === 50) return 6;
  if (msid >= 51 && msid <= 55) return 7;
  if (msid === 56) return 8;
  if (msid === 57) return 9;
  if (msid >= 58 && msid <= 62) return 10;
  if (msid === 63) return 11;
  if (msid === 64) return 12;
  if (msid >= 65 && msid <= 69) return 13 + msid - 65;
  if (msid >= 70 && msid <= 74) return 13 + msid - 70; // landing keeps its aerial's move id
  // Fox's specials (ftFx_Init_MotionStateTable): neutral, side, up, down B.
  if (msid >= 341 && msid <= 346) return 18;
  if (msid >= 347 && msid <= 352) return 19;
  if (msid >= 353 && msid <= 359) return 20;
  if (msid >= 360 && msid <= 369) return 21;
  return 1;
}

/** ft_80089118: 1 minus the stale multiplier of each of the last nine hits that were this move. */
export function staleMultiplier(fp: Fighter, attackId: number, c: Record<string, number>): number {
  if (attackId === 1) return 1;
  const t = fp.stale;
  let mul = 1;
  let k = t.index !== 0 ? t.index - 1 : 9;
  for (let i = 0; i < 9; i++) {
    if (t.moves[k].id === 0) return mul;
    if (t.moves[k].id === attackId) mul = f(mul - c[`stale_${i}`]);
    k = k !== 0 ? k - 1 : 9;
  }
  return mul;
}

/** plStale_UpdateStaleMovesFromFighter / FromItem: a hit adds its attack to the queue once. */
function recordStale(fp: Fighter, attackId: number, instance: number): void {
  if (attackId === 1) return;
  const t = fp.stale;
  for (const m of t.moves) if (m.id === attackId && m.instance === instance) return;
  t.moves[t.index].id = attackId;
  t.moves[t.index].instance = instance;
  t.index = t.index === 9 ? 0 : t.index + 1;
}

// ============================================================================ pushing
/**
 * ftCommon_8007E0E4 / ftCommon_8007DD7C: a grounded fighter overlapping another grounded fighter's
 * push box on the same floor gets pushed away by push_speed this frame.
 */
export function fighterNudge(e: Engine, all: Engine[]): number {
  const fp = e.fighter;
  if (fp.inHitlag || fp.ga !== GA.Ground) return 0;
  let nudge = 0, selfSeen = false;
  const [ox, w] = e.data.push;
  for (const o of all) {
    if (o === e) { selfSeen = true; continue; }
    const of = o.fighter;
    if (of.ga !== GA.Ground || !of.floor || !fp.floor || of.floor.group !== fp.floor.group) continue;
    const d = f(f(ox * fp.facing + fp.pos.x) - f(o.data.push[0] * of.facing + of.pos.x));
    if (Math.abs(d) < w + o.data.push[1]) {
      const push = e.c.push_speed;
      nudge = f(nudge + (d ? (d < 0 ? -push : push) : (selfSeen ? -push : push)));
    }
  }
  return nudge;
}

// ============================================================================ capsule test
const hitClosest = [0, 0, 0], hurtClosest = [0, 0, 0];

/** ft_80005EBC: closest point on segment a→b to p (squared distance, parameter). */
function closestOnSegment(a: number[], b: number[], p: number[]): [number, number] {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = dx * dx + dy * dy + dz * dz;
  let t = len < 1e-10 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / len;
  if (t > 1) t = 1; else if (t < 0) t = 0;
  const x = a[0] + dx * t - p[0], y = a[1] + dy * t - p[1], z = a[2] + dz * t - p[2];
  return [x * x + y * y + z * z, t];
}

/**
 * lbColl_80006E58: does the swept hitbox (prev → now, radius hitR) touch the hurt capsule (a → b,
 * radius hurtR measured in the joint's space: `inv` maps a world direction into it)? Writes the contact
 * point and the overlap (hurt_coll_pos, coll_distance) into the hitbox.
 */
function capsuleTest(h: HitboxState, a: number[], b: number[], hurtR: number, inv: number[], hitR: number, broad: number): boolean {
  const s = h.prevPos3, e = h.pos3;
  const bp = hurtR * broad + hitR;
  // Broad phase: the hit segment's box, grown, must reach one of the hurt ends on every axis.
  for (let k = 0; k < 3; k++) {
    const lo = Math.min(s[k], e[k]) - bp, hi = Math.max(s[k], e[k]) + bp;
    if ((lo > a[k] && lo > b[k]) || (hi < a[k] && hi < b[k])) return false;
  }
  const d1 = [e[0] - s[0], e[1] - s[1], e[2] - s[2]], d2 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const r = [s[0] - a[0], s[1] - a[1], s[2] - a[2]];
  const aa = d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2], ee = d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2];
  const ff = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2], bb = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
  const cc = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2];
  const denom = aa * ee - bb * bb;
  const zero = (v: number) => Math.abs(v) < 1e-5;
  let sh = 0, th = 0;
  if (zero(ee)) {
    if (!zero(aa)) { sh = -cc / aa; if (sh > 1) sh = 1; else if (sh < 0) sh = 0; }
  } else if (zero(denom)) {
    // Parallel: from whichever hit end is nearer the hurt capsule's middle.
    const mid = [a[0] + 0.5 * d2[0], a[1] + 0.5 * d2[1], a[2] + 0.5 * d2[2]];
    const ds = (s[0] - mid[0]) ** 2 + (s[1] - mid[1]) ** 2 + (s[2] - mid[2]) ** 2;
    const de = (e[0] - mid[0]) ** 2 + (e[1] - mid[1]) ** 2 + (e[2] - mid[2]) ** 2;
    sh = ds < de ? 0 : 1;
    th = closestOnSegment(a, b, sh ? e : s)[1];
  } else {
    sh = (bb * ff - ee * cc) / denom;
    th = (aa * ff - bb * cc) / denom;
    if (sh > 1 || sh < 0 || th > 1 || th < 0) {
      const [dh, ch] = sh < 0 ? closestOnSegment(a, b, s) : closestOnSegment(a, b, e);
      const [du, cu] = th < 0 ? closestOnSegment(s, e, a) : closestOnSegment(s, e, b);
      if (dh < du) { sh = sh < 0 ? 0 : 1; th = ch; } else { sh = cu; th = th < 0 ? 0 : 1; }
    }
  }
  for (let k = 0; k < 3; k++) { hitClosest[k] = s[k] + d1[k] * sh; hurtClosest[k] = a[k] + d2[k] * th; }
  const sx = hitClosest[0] - hurtClosest[0], sy = hitClosest[1] - hurtClosest[1], sz = hitClosest[2] - hurtClosest[2];
  const dist = Math.sqrt(sx * sx + sy * sy + sz * sz);
  if (zero(dist)) {
    h.overlap = hitR + hurtR - dist;
    h.contact[0] = hitClosest[0]; h.contact[1] = hitClosest[1]; h.contact[2] = hitClosest[2];
    return true;
  }
  // The hurt radius is in the joint's space: a scaled joint makes the capsule fatter.
  const lx = inv[0] * sx + inv[1] * sy + inv[2] * sz, ly = inv[3] * sx + inv[4] * sy + inv[5] * sz, lz = inv[6] * sx + inv[7] * sy + inv[8] * sz;
  const local = Math.sqrt(lx * lx + ly * ly + lz * lz);
  const scaledR = hurtR * dist / local;
  const lerp = scaledR / dist, allowed = hitR + scaledR;
  h.overlap = allowed - dist;
  for (let k = 0; k < 3; k++) h.contact[k] = lerp * (hitClosest[k] - hurtClosest[k]) + hurtClosest[k];
  return allowed >= dist;
}

/** A hurtbox's ends in the world and the inverse of its joint's rotation/scale. */
function hurtCapsule(e: Engine, hb: HurtboxDef, a: number[], b: number[], inv: number[]): void {
  e.updatePose();
  const w = e.fighter.world, m = hb.bone * 12, fp = e.fighter;
  for (const [p, o] of [[a, hb.a], [b, hb.b]] as const) {
    p[0] = fp.pos.x + w[m] * o[0] + w[m + 1] * o[1] + w[m + 2] * o[2] + w[m + 3];
    p[1] = fp.pos.y + w[m + 4] * o[0] + w[m + 5] * o[1] + w[m + 6] * o[2] + w[m + 7];
    p[2] = w[m + 8] * o[0] + w[m + 9] * o[1] + w[m + 10] * o[2] + w[m + 11];
  }
  const a00 = w[m], a01 = w[m + 1], a02 = w[m + 2], a10 = w[m + 4], a11 = w[m + 5], a12 = w[m + 6], a20 = w[m + 8], a21 = w[m + 9], a22 = w[m + 10];
  const det = a00 * (a11 * a22 - a12 * a21) - a01 * (a10 * a22 - a12 * a20) + a02 * (a10 * a21 - a11 * a20);
  const id = det ? 1 / det : 0;
  inv[0] = (a11 * a22 - a12 * a21) * id; inv[1] = (a02 * a21 - a01 * a22) * id; inv[2] = (a01 * a12 - a02 * a11) * id;
  inv[3] = (a12 * a20 - a10 * a22) * id; inv[4] = (a00 * a22 - a02 * a20) * id; inv[5] = (a02 * a10 - a00 * a12) * id;
  inv[6] = (a10 * a21 - a11 * a20) * id; inv[7] = (a01 * a20 - a00 * a21) * id; inv[8] = (a00 * a11 - a01 * a10) * id;
}

// ============================================================================ attack collision (priority 13)
/** Whether a hitbox can hit this fighter now (state, element, air/ground, not already hit). */
function canHit(h: HitboxState, victim: Engine): boolean {
  if (!h.active || !h.fighters || h.element === ELEMENT_CATCH || h.victims.has(victim)) return false;
  const air = victim.fighter.ga === GA.Air;
  return (h.air && air) || (h.ground && !air);
}

/**
 * Fighter_procAttackColl for one victim: every other fighter's hitboxes (ftColl_80078C70), then their
 * items' (ftColl_8007925C), against this fighter's hurtboxes. Hits go into its damage log.
 */
export function attackColl(victim: Engine, all: Engine[]): void {
  victim.fighter.tipLog.length = 0;
  const hb = victim.data.hurtboxes;
  if (!hb.length || victim.fighter.intangible) return;
  const a = [0, 0, 0], b = [0, 0, 0], inv = new Array<number>(9);
  const hit = (h: HitboxState): HurtboxDef | null => {
    for (const hurt of hb) {
      hurtCapsule(victim, hurt, a, b, inv);
      if (capsuleTest(h, a, b, hurt.radius, inv, h.size, 3)) return hurt;
    }
    return null;
  };
  for (const attacker of all) {
    if (attacker === victim) continue;
    for (const h of attacker.fighter.hitboxes) {
      if (!canHit(h, victim)) continue;
      const hurt = hit(h);
      if (hurt && registerHit(attacker, h, victim, hurt, a, b, attacker.fighter.pos.x, 0, attacker.fighter.hitboxes, attacker.fighter.attackId, attacker.fighter.attackInstance, false)) {
        // ftColl_80078C70: the attacker's hit sound (lbColl_80005BB0), or a dull one on an invincible fighter.
        const sound = victim.fighter.invincible ? [141, 142, 143][h.sfxLevel] ?? 141 : HIT_SOUNDS[h.sfxKind * 3 + h.sfxLevel];
        if (sound !== undefined && sound < 10000) attacker.playSound(sound);
      }
    }
  }
  for (const attacker of all) {
    if (attacker === victim) continue;
    for (const p of attacker.projectiles) {
      if (p.dead) continue;
      for (const h of p.hitboxes) {
        if (!canHit(h, victim)) continue;
        const hurt = hit(h);
        if (hurt && registerHit(attacker, h, victim, hurt, a, b, p.x, p.vx, p.hitboxes, p.attackId, p.attackInstance, true) && !victim.fighter.invincible) p.hit = true;
      }
    }
  }
}

/**
 * ftColl_80076ED8 / ftColl_80077C60: a hit connects. A graze (overlap under phantom_threshold) is a
 * phantom hit: half the damage, logged separately, and only if nothing really hit this frame yet.
 * Otherwise everything of the hitbox's group now counts the victim as hit; the attacker's strongest
 * damage this frame sets its hitlag; unless the victim is invincible, the damage goes into its log.
 * Returns whether the hit registered (the attacker's hit sound plays).
 */
function registerHit(
  attacker: Engine, h: HitboxState, victim: Engine, hurt: HurtboxDef, a: number[], b: number[],
  x: number, vx: number, group: HitboxState[], attackId: number, instance: number, item: boolean,
): boolean {
  const vf = victim.fighter, af = attacker.fighter;
  const dmg = h.damage;
  const entry = (damage: number, count: number): DamageEntry => ({
    source: item ? 'item' : 'fighter', x, vx, hit: h, hurt, hurtA: [a[0], a[1], a[2]], hurtB: [b[0], b[1], b[2]],
    contact: [h.contact[0], h.contact[1], h.contact[2]], count, damage, attacker, attackId, instance,
  });
  if (h.overlap < victim.c.phantom_threshold) {
    if (vf.damageLog.length || vf.phantomFrames || h.tipVictims.has(victim)) return false;
    let half: number, count: number;
    if (item) {
      // ftColl_80077C60 halves the integer damage.
      half = f(0.5 * Math.trunc(dmg));
      if (!Math.trunc(half) && Math.trunc(dmg)) half = 1;
      count = Math.trunc(Math.trunc(h.count) / 2) || (h.count ? 1 : 0);
    } else {
      half = f(0.5 * dmg);
      if (!Math.trunc(half) && dmg) half = 1;
      count = h.count >>> 1 || (h.count ? 1 : 0);
    }
    for (const o of group) if (o.active && o.group === h.group) o.tipVictims.add(victim);
    if (!vf.invincible) {
      if (Math.trunc(half) > vf.phantomHitlag) vf.phantomHitlag = Math.trunc(half);
      vf.tipLog.push(entry(half, count));
    }
    return true;
  }
  vf.tipLog.length = 0;
  for (const o of group) if (o.active && o.group === h.group) o.victims.add(victim);
  const intDmg = dmg ? Math.trunc(dmg) || 1 : 0;
  if (!item && intDmg > af.dealtDamage) af.dealtDamage = intDmg;
  if (vf.invincible) return true;
  vf.percentTemp = f(vf.percentTemp + dmg);
  if (intDmg > vf.damageApplied) vf.damageApplied = intDmg;
  vf.damageLog.push(entry(dmg, h.count));
  recordStale(af, attackId, instance);
  return true;
}

// ============================================================================ damage (priority 14)
/**
 * The KNOCKBACK macro of ftColl_80079AB0 (attack, defense and handicap ratios 1): set knockback uses
 * its fixed damage; otherwise the victim's percent after this frame's damage and the hit's unstaled
 * damage, all scaled by weight and growth.
 */
function knockback(e: Engine, entry: DamageEntry): number {
  const c = e.c, h = entry.hit, fp = e.fighter;
  const w = f(e.a.weight * c.kb_weight_scale);
  let inner: number;
  if (h.wkb !== 0) inner = f(f(c.kb_set_damage * c.kb_percent_mul) + f(c.kb_damage_mul * f(c.kb_set_damage * h.wkb)));
  else {
    // Percent as the game counts it (an int), plus what this frame added.
    const p = f(Math.trunc(fp.percent) + fp.percentTemp);
    inner = f(f(c.kb_percent_mul * p) + f(c.kb_damage_mul * f(entry.count * p)));
  }
  const weightTerm = f(c.kb_weight_base - f(f(w * c.kb_weight_base) / f(1 + w)));
  let kb = f(f(f(0.01 * h.kbg) * f(f(c.kb_scale * f(weightTerm * inner)) + c.kb_add)) + h.bkb);
  if (kb >= c.kb_max) kb = c.kb_max;
  return kb;
}

/**
 * Fighter_procCollResolve, the parts a hit between fighters uses: the shield regenerates, the
 * strongest logged hit becomes knockback (ftColl_8007A06C, ftCo_Damage_CalcKnockback), the damage is
 * added, the victim enters a damage state, and hitlag is set for victim and attacker alike.
 */
export function collResolve(e: Engine): void {
  const fp = e.fighter, c = e.c;
  // The shield regenerates while it is down (shield_health += x27C).
  if (!fp.shielding && fp.shieldHealth < c.shield_start_health) {
    fp.shieldHealth = f(Math.min(c.shield_start_health, fp.shieldHealth + c.shield_regen));
  }
  // ftColl_8007AB48: the strongest real hit becomes this frame's knockback.
  const best = strongest(e, fp.damageLog);
  if (best) {
    // The victim faces whoever hit it; an item flying fast enough pushes the way it flies.
    if (best.entry.source === 'item' && Math.abs(best.entry.vx) >= 0.1) fp.hitDir = best.entry.vx < 0 ? 1 : -1;
    else fp.hitDir = fp.pos.x > best.entry.x ? -1 : 1;
    fp.kbAngle = best.entry.hit.angle;
    fp.hurtHeight = best.entry.hurt.height;
    fp.kbApplied = best.kb;
    if (best.entry.hit.angle === 362) {
      // 0x16A: towards the hurtbox's middle from the contact point.
      const en = best.entry;
      const dx = 0.5 * (en.hurtA[0] + en.hurtB[0]) - en.contact[0], dy = 0.5 * (en.hurtA[1] + en.hurtB[1]) - en.contact[1];
      fp.hitDir = dx < 0 ? 1 : -1;
      fp.kbAngle = Math.abs(dx) < 1e-5 ? 0 : Math.trunc(Math.atan(dy / Math.abs(dx)) / DEG);
    }
    if (best.entry.hit.element === ELEMENT_ELECTRIC) fp.hitlagMul = c.hitlag_electric_mul;
    e.events.push({ type: 'hit', x: best.entry.contact[0], y: best.entry.contact[1], damage: best.entry.damage, kb: best.kb, frame: e.frame });
  }
  // ftColl_8007AB80: the strongest phantom hit (its knockback only says whether there was one).
  const tip = strongest(e, fp.tipLog);
  let phantomKb = 0;
  if (tip) {
    phantomKb = tip.kb;
    fp.phantomDamage = tip.entry.damage;
    fp.phantomSource = { attacker: tip.entry.attacker, attackId: tip.entry.attackId, instance: tip.entry.instance, item: tip.entry.source === 'item' };
    if (tip.entry.hit.element === ELEMENT_ELECTRIC) fp.hitlagMul = c.hitlag_electric_mul;
    e.events.push({ type: 'hit', x: tip.entry.contact[0], y: tip.entry.contact[1], damage: tip.entry.damage, kb: 0, frame: e.frame });
  }
  // A phantom hit's damage lands when its hitlag is over (x189C, ftColl_8007BE3C).
  if (fp.phantomFrames > 0) {
    fp.phantomFrames -= 1;
    if (fp.phantomFrames <= 0 && !fp.kbApplied) {
      fp.phantomFrames = 0;
      const d = fp.phantomDamage, intDmg = d ? Math.trunc(d) || 1 : 0;
      fp.percentTemp = f(fp.percentTemp + d);
      if (intDmg > fp.damageApplied) fp.damageApplied = intDmg;
      // ftColl_8007BE3C → plStale_*: the attacker's attack at the time the damage lands (a fighter may
      // have started a new one since), an item's own.
      const src = fp.phantomSource;
      if (src) {
        const af = (src.attacker as Engine).fighter;
        if (src.item) recordStale(af, src.attackId, src.instance);
        else recordStale(af, af.attackId, af.attackInstance);
      }
    }
  }
  let hitlagFrom = 0, phantom = false;
  if (fp.kbApplied) {
    fp.phantomFrames = 0;
    takeDamage(e, fp.percentTemp);
    calcKnockback(e);
    enterDamage(e);
    hitlagFrom = fp.damageApplied;
  } else if (phantomKb) {
    hitlagFrom = fp.phantomHitlag;
    phantom = true;
  } else if (fp.dealtDamage) {
    hitlagFrom = fp.dealtDamage;
  }
  if (!fp.kbApplied && fp.percentTemp) takeDamage(e, fp.percentTemp);
  if (hitlagFrom) {
    // ftCommon_CalcHitlag, capped.
    let frames = Math.trunc(Math.trunc(f(f(hitlagFrom * c.hitlag_damage_mul) + c.hitlag_add)) * fp.hitlagMul);
    if (fp.motionId === 39 || fp.motionId === 40) frames = Math.trunc(frames * c.hitlag_crouch_mul);
    if (frames > 0) {
      if (frames > c.hitlag_max) frames = c.hitlag_max;
      fp.hitlag = frames;
      fp.allowSdi = true;
      if (phantom) fp.phantomFrames = frames;
      if (!fp.inHitlag) e.enterHitlag();
    }
  }
  fp.percentTemp = 0; fp.damageApplied = 0; fp.kbApplied = 0; fp.dealtDamage = 0; fp.damageLog.length = 0;
  fp.tipLog.length = 0; fp.phantomHitlag = 0; fp.hitlagMul = 1;
  for (const p of e.projectiles) if (p.hit) p.dead = true;
}

/** ftColl_8007A06C: the entry with the most knockback (the first of equals). */
function strongest(e: Engine, log: DamageEntry[]): { entry: DamageEntry; kb: number } | null {
  let best: DamageEntry | null = null, bestKb = -1;
  for (const entry of log) {
    const kb = knockback(e, entry);
    if (kb > bestKb) { bestKb = kb; best = entry; }
  }
  return best ? { entry: best, kb: bestKb } : null;
}

/** Fighter_TakeDamage_8006CC7C (with the "no damage" setting keeping the percent at 0). */
function takeDamage(e: Engine, amount: number): void {
  const fp = e.fighter;
  if (e.noDamage) return;
  fp.percent = f(fp.percent + amount);
  if (fp.percent > 999) fp.percent = 999;
}

/** ftCo_Damage_CalcKnockback: crouching and charging a smash soften it; never below the minimum. */
function calcKnockback(e: Engine): void {
  const fp = e.fighter, c = e.c;
  if (!fp.kbApplied) return;
  if (fp.motionId === 39 || fp.motionId === 40) fp.kbApplied = f(fp.kbApplied * c.kb_squat_mul);
  if (fp.kbApplied < c.kb_min) fp.kbApplied = c.kb_min;
}
