// The page as a stage: visible text lines become pass-through platforms; media, controls and boxes
// with a visible background or border become solid blocks (floor, walls, ceiling, ledges). Only the
// viewport plus one screen of margin is scanned. Rebuilt on scroll (throttled), resize and DOM changes
// (debounced); fixed/sticky elements are re-positioned every frame so they move with the viewport.
import { SegKind, type Segment, type StageData } from '../engine/stagetypes';
import type { View } from './view';

export interface StageOptions { minSolidPx: number; minSegmentPx: number; maxSegments: number }

interface Rect { l: number; t: number; r: number; b: number }
interface Block { rect: Rect; solid: boolean; fixed: boolean; group: number }

const SOLID_TAGS = new Set(['IMG', 'VIDEO', 'CANVAS', 'SVG', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'IFRAME', 'PICTURE', 'OBJECT', 'EMBED']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'BR', 'WBR']);

export class PageStage {
  data: StageData = { segments: [], blast: [0, 0, 0, 0], spawn: [0, 0] };
  /** Page-space blocks from the last scan (client space for fixed ones). */
  private blocks: Block[] = [];
  private groups = new WeakMap<object, number>();
  private nextGroup = 1;
  private dirty = true;
  private lastScan = 0;
  private observer: MutationObserver;
  private timer = 0;
  lastBuildMs = 0;
  /** Elements our own overlay added; never part of the stage. */
  ignore = new Set<Element>();

  constructor(private view: View, public opts: StageOptions) {
    this.observer = new MutationObserver((records) => {
      if (records.every((r) => this.ignore.has(r.target as Element))) return;
      this.invalidate(250);
    });
    this.observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    window.addEventListener('scroll', this.onScroll, { passive: true, capture: true });
    window.addEventListener('resize', this.onResize, { passive: true });
  }

  private onScroll = () => this.invalidate(120);
  private onResize = () => this.invalidate(0);

  /** Schedules a rebuild at most every `ms` milliseconds. */
  invalidate(ms: number): void {
    if (this.timer) return;
    const wait = Math.max(0, this.lastScan + ms - performance.now());
    this.timer = window.setTimeout(() => { this.timer = 0; this.dirty = true; }, wait);
  }

  private groupOf(key: object): number {
    let g = this.groups.get(key);
    if (!g) { g = this.nextGroup++; this.groups.set(key, g); }
    return g;
  }

  /** Called once per engine step: rescans when needed, then refreshes fixed elements. */
  update(): void {
    let rebuild = false;
    if (this.dirty) {
      this.dirty = false;
      const t0 = performance.now();
      this.scan();
      this.lastScan = performance.now();
      this.lastBuildMs = this.lastScan - t0;
      rebuild = true;
    }
    const sx = window.scrollX, sy = window.scrollY;
    if (sx !== this.lastSX || sy !== this.lastSY || window.innerWidth !== this.lastW || window.innerHeight !== this.lastH) {
      this.lastSX = sx; this.lastSY = sy; this.lastW = window.innerWidth; this.lastH = window.innerHeight;
      rebuild = rebuild || this.hasFixed;
      this.updateBounds();
    }
    if (rebuild) this.buildSegments();
  }

  private lastSX = NaN;
  private lastSY = NaN;
  private lastW = 0;
  private lastH = 0;
  private hasFixed = false;

  /** Blast zone and respawn point follow the viewport (updated in place). */
  private updateBounds(): void {
    const [l, rgt, bot, top] = this.view.viewport();
    const halfW = (rgt - l) / 2, halfH = (top - bot) / 2;
    // Past the left, right or bottom edge by more than half a screen: KO. The top stays open.
    const b = this.data.blast;
    b[0] = l - halfW; b[1] = rgt + halfW; b[2] = bot - halfH; b[3] = top + 1e6;
    this.data.spawn[0] = (l + rgt) / 2; this.data.spawn[1] = top - 4;
  }

  private scan(): void {
    const vw = window.innerWidth, vh = window.innerHeight;
    // Scan region: the viewport plus one screen of margin, in client coordinates.
    const region: Rect = { l: -vw, t: -vh, r: 2 * vw, b: 2 * vh };
    const sx = window.scrollX, sy = window.scrollY;
    const blocks: Block[] = [];
    const lines = new Map<string, Block>();
    const minSolid = this.opts.minSolidPx;

    const visit = (el: Element, fixedAncestor: boolean): void => {
      if (SKIP_TAGS.has(el.tagName) || this.ignore.has(el)) return;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (style.display === 'none') return;
      const fixed = fixedAncestor || style.position === 'fixed' || style.position === 'sticky';
      const inRegion = r.right > region.l && r.left < region.r && r.bottom > region.t && r.top < region.b;
      // Overflowing children can escape a parent's box; only cull boxes that clip or are far away.
      if (!inRegion && (style.overflow !== 'visible' || r.bottom < region.t - vh || r.top > region.b + vh)) return;
      const visible = style.visibility !== 'hidden' && Number(style.opacity) > 0.05;
      const w = r.width, h = r.height;
      if (visible && inRegion && w >= 1 && h >= 1) {
        const tag = el.tagName.toUpperCase();
        let solid = SOLID_TAGS.has(tag);
        if (!solid && w >= minSolid && h >= minSolid && el !== document.body && el !== document.documentElement) {
          const bg = style.backgroundColor;
          const hasBg = (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) || style.backgroundImage !== 'none';
          const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some((s) =>
            parseFloat(style.getPropertyValue(`border-${s.toLowerCase()}-width`)) > 0 && style.getPropertyValue(`border-${s.toLowerCase()}-style`) !== 'none');
          // Page-sized wrappers with a background are layout, not terrain.
          const container = h > vh * 1.5 || (w >= vw * 0.95 && h >= vh * 0.6);
          solid = (hasBg || hasBorder) && !container;
        }
        if (solid && (SOLID_TAGS.has(el.tagName.toUpperCase()) ? w >= 8 && h >= 8 : true)) {
          const rect = fixed ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : { l: r.left + sx, t: r.top + sy, r: r.right + sx, b: r.bottom + sy };
          blocks.push({ rect, solid: true, fixed, group: this.groupOf(el) });
          if (SOLID_TAGS.has(el.tagName.toUpperCase())) return; // media/controls: their insides are not terrain
        }
      }
      for (let c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === Node.ELEMENT_NODE) visit(c as Element, fixed);
        else if (c.nodeType === Node.TEXT_NODE && visible && inRegion && c.nodeValue && /\S/.test(c.nodeValue)) this.textLines(c as Text, fixed, sx, sy, lines, region);
      }
    };
    visit(document.body ?? document.documentElement, false);
    for (const b of lines.values()) blocks.push(b);
    this.blocks = blocks;
  }

  private range = document.createRange();

  private textLines(node: Text, fixed: boolean, sx: number, sy: number, lines: Map<string, Block>, region: Rect): void {
    this.range.selectNodeContents(node);
    const rects = this.range.getClientRects();
    const parent = node.parentElement!;
    for (let i = 0; i < rects.length; i++) {
      const q = rects[i];
      if (q.width < 1 || q.bottom < region.t || q.top > region.b) continue;
      const ox = fixed ? 0 : sx, oy = fixed ? 0 : sy;
      const top = Math.round(q.top + oy);
      // Merge rects on the same line (same top, touching horizontally) from any text node.
      const key = `${fixed ? 'f' : 'p'}${top}`;
      const existing = lines.get(key);
      const rect = { l: q.left + ox, t: q.top + oy, r: q.right + ox, b: q.bottom + oy };
      if (existing && rect.l <= existing.rect.r + 12 && rect.r >= existing.rect.l - 12) {
        existing.rect.l = Math.min(existing.rect.l, rect.l);
        existing.rect.r = Math.max(existing.rect.r, rect.r);
        existing.rect.b = Math.max(existing.rect.b, rect.b);
      } else if (existing) {
        lines.set(key + ':' + Math.round(rect.l), { rect, solid: false, fixed, group: this.groupOf(parent) * 64 + (lines.size % 64) });
      } else {
        lines.set(key, { rect, solid: false, fixed, group: this.groupOf(parent) * 64 + (i % 64) });
      }
    }
  }

  /** Turns blocks into Melee-unit segments (fixed blocks follow the viewport). */
  private buildSegments(): void {
    const v = this.view;
    const sx = window.scrollX, sy = window.scrollY;
    const cx = sx + window.innerWidth / 2, cy = sy + window.innerHeight / 2;
    const minSeg = this.opts.minSegmentPx;
    const segs: Array<Segment & { d: number }> = [];
    for (const b of this.blocks) {
      const r = b.fixed ? { l: b.rect.l + sx, t: b.rect.t + sy, r: b.rect.r + sx, b: b.rect.b + sy } : b.rect;
      if (r.r - r.l < minSeg) continue;
      const d = Math.abs((r.t + r.b) / 2 - cy) + Math.abs((r.l + r.r) / 2 - cx) * 0.25;
      // float32 like the game, so a fighter integrated in float32 lines up exactly with a floor.
      const x0 = Math.fround(v.toUnitsX(r.l)), x1 = Math.fround(v.toUnitsX(r.r)), y0 = Math.fround(v.toUnitsY(r.t)), y1 = Math.fround(v.toUnitsY(r.b));
      if (!b.solid) {
        segs.push({ kind: SegKind.Platform, x0, y0, x1, y1: y0, group: b.group, ledges: 0, d });
        continue;
      }
      segs.push({ kind: SegKind.Floor, x0, y0, x1, y1: y0, group: b.group, ledges: 3, d });
      if (r.b - r.t >= minSeg) {
        segs.push({ kind: SegKind.WallLeft, x0, y0, x1: x0, y1, group: b.group, ledges: 0, d });
        segs.push({ kind: SegKind.WallRight, x0: x1, y0, x1, y1, group: b.group, ledges: 0, d });
        segs.push({ kind: SegKind.Ceiling, x0, y0: y1, x1, y1, group: b.group, ledges: 0, d });
      }
    }
    if (segs.length > this.opts.maxSegments) {
      segs.sort((a, b) => a.d - b.d);
      segs.length = this.opts.maxSegments;
    }
    this.data.segments = segs;
    this.hasFixed = this.blocks.some((b) => b.fixed);
    this.updateBounds();
  }

  destroy(): void {
    this.observer.disconnect();
    window.removeEventListener('scroll', this.onScroll, { capture: true });
    window.removeEventListener('resize', this.onResize);
    clearTimeout(this.timer);
  }
}
