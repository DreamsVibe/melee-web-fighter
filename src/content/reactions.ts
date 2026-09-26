// Page reactions: when an active hitbox overlaps a page element, the element shakes and flies off in
// the hit's direction, with the move's hit sound. Done with the Web Animations API only, so the page's
// DOM and styles are never changed; turning the overlay off cancels every animation.
import type { View } from './view';
import type { AudioPlayer } from '../audio/audio';
import type { Fighter, HitboxState } from '../engine/types';
import { HIT_SOUNDS } from '../shared/hitsounds';

export class PageReactions {
  private animations: Animation[] = [];
  private hitThisSwing = new WeakMap<HitboxState, Set<Element>>();
  private flown = new WeakSet<Element>();

  constructor(private view: View, private audio: AudioPlayer) {}

  private pick(x: number, y: number): Element | null {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (x < 0 || y < 0 || x >= vw || y >= vh) return null;
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === document.documentElement || el === document.body || el.hasAttribute('data-melee-web-fighter')) continue;
      if (this.flown.has(el)) continue;
      const r = el.getBoundingClientRect();
      // Skip page-sized containers: knock off things, not the layout.
      if (r.width * r.height > vw * vh * 0.35 || r.width < 6 || r.height < 6) continue;
      return el;
    }
    return null;
  }

  hit(h: HitboxState, fp: Fighter): void {
    if (!h.active) return;
    const [cx, cy] = this.view.toClient(h.pos[0], h.pos[1]);
    const el = this.pick(cx, cy);
    if (!el) return;
    let seen = this.hitThisSwing.get(h);
    if (!seen || h.fresh) { seen = new Set(); this.hitThisSwing.set(h, seen); }
    if (seen.has(el)) return;
    seen.add(el);
    this.flown.add(el);
    // Launch direction: the hitbox angle (361 = Sakurai angle, ~40° on the ground).
    const deg = h.angle === 361 ? 40 : h.angle;
    const rad = (deg * Math.PI) / 180;
    const power = 250 + h.damage * 25 + h.bkb * 2;
    const dx = Math.cos(rad) * power * fp.facing, dy = -Math.sin(rad) * power;
    const spin = (Math.random() < 0.5 ? -1 : 1) * (90 + h.damage * 12);
    const shake = [
      { transform: 'translate(0,0)' }, { transform: 'translate(4px,-2px)' }, { transform: 'translate(-4px,2px)' },
      { transform: 'translate(3px,1px)' }, { transform: 'translate(0,0)' },
    ];
    const a1 = (el as HTMLElement).animate(shake, { duration: 120, easing: 'linear' });
    const a2 = (el as HTMLElement).animate(
      [{ transform: 'translate(0,0) rotate(0deg)', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) rotate(${spin}deg)`, opacity: 0.85 }],
      { duration: 900, delay: 110, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'forwards' },
    );
    this.animations.push(a1, a2);
    const id = HIT_SOUNDS[h.sfxKind * 3 + h.sfxLevel];
    if (id !== undefined && id < 0x83d60) this.audio.play(id);
  }

  /** Puts every knocked element back exactly as it was. */
  restoreAll(): void {
    for (const a of this.animations) a.cancel();
    this.animations = [];
    this.flown = new WeakSet();
  }
}
