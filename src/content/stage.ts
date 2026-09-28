// The page as a stage: visible text lines, media, controls and boxes with a visible background or
// border each become a pass-through platform along their top edge, like Battlefield's side platforms.
// Nothing is solid: no walls, ceilings or floors that can't be dropped through, so a fighter can
// never get boxed in by page layout. Only the viewport plus half a screen of margin (the blast zone)
// is scanned, a few milliseconds per frame.
// Rebuilt on scroll (throttled), resize and DOM changes (debounced); fixed/sticky elements are
// re-positioned every frame so they move with the viewport.
import { SegKind, type Segment, type StageData } from '../engine/stagetypes';
import type { View } from './view';

export interface StageOptions { minSolidPx: number; minSegmentPx: number; maxSegments: number }

interface Rect { l: number; t: number; r: number; b: number }
interface Block { rect: Rect; solid: boolean; fixed: boolean; group: number }
interface ScanJob {
  /** Depth-first work stack (elements and text nodes) with each entry's flags and depth. */
  nodes: Node[]; flags: number[]; depths: number[];
  blocks: Block[]; lines: Map<string, Block>;
  /** Scan region in page coordinates, fixed when the scan starts. */
  region: Rect; vw: number; vh: number;
  maxSlice: number; total: number;
}

const SOLID_TAGS = new Set(['IMG', 'VIDEO', 'CANVAS', 'SVG', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'IFRAME', 'PICTURE', 'OBJECT', 'EMBED']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'BR', 'WBR']);
const FIXED = 1, VISIBLE = 2;
/** Per-frame time for a rescan in progress. */
const SLICE_MS = 2.5;

export class PageStage {
  data: StageData = { segments: [], blast: [0, 0, 0, 0], spawn: [0, 0] };
  /** Page-space blocks from the last scan (client space for fixed ones). */
  private blocks: Block[] = [];
  private groups = new WeakMap<object, number>();
  /** Ancestors of fixed/sticky elements seen so far: never culled, since their children follow the viewport. */
  private fixedHolders = new WeakSet<Element>();
  private nextGroup = 1;
  private dirty = true;
  private lastScan = 0;
  private observer: MutationObserver;
  private timer = 0;
  /** The rescan in progress, worked through a few milliseconds per frame. */
  private job: ScanJob | null = null;
  /** Longest time one frame spent on the last rebuild (scan slice + segments), and the whole rebuild. */
  lastBuildMs = 0;
  lastScanTotalMs = 0;
  /** Elements our own overlay added; never part of the stage. */
  ignore = new Set<Element>();
  /** The first scan is complete (spawning waits for it, to pick a platform that's really there). */
  ready = false;

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

  /** Called once per engine step: advances a rescan when needed, then refreshes fixed elements. */
  update(): void {
    let rebuild = false;
    if (this.dirty && !this.job) { this.dirty = false; this.job = this.startScan(); }
    const job = this.job;
    if (job) {
      const t0 = performance.now();
      // Time-sliced, the first scan too: Fox spawns at the top of the screen and the stage is complete
      // a few frames into his fall.
      const done = this.scanStep(job, SLICE_MS);
      if (done) {
        for (const b of job.lines.values()) job.blocks.push(b);
        this.blocks = job.blocks;
        this.buildSegments();
        this.job = null;
        this.lastScan = performance.now();
        this.ready = true;
      }
      const slice = performance.now() - t0;
      job.maxSlice = Math.max(job.maxSlice, slice);
      job.total += slice;
      if (done) { this.lastBuildMs = job.maxSlice; this.lastScanTotalMs = job.total; }
    }
    const sx = window.scrollX, sy = window.scrollY;
    if (sx !== this.lastSX || sy !== this.lastSY || window.innerWidth !== this.lastW || window.innerHeight !== this.lastH) {
      this.lastSX = sx; this.lastSY = sy; this.lastW = window.innerWidth; this.lastH = window.innerHeight;
      rebuild = this.hasFixed;
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

  private startScan(): ScanJob {
    const vw = window.innerWidth, vh = window.innerHeight, sx = window.scrollX, sy = window.scrollY;
    // Scan region: the viewport plus half a screen (past that is the blast zone), in page coordinates.
    const region: Rect = { l: sx - vw / 2, t: sy - vh / 2, r: sx + 1.5 * vw, b: sy + 1.5 * vh };
    const root = document.body ?? document.documentElement;
    return { nodes: [root], flags: [VISIBLE], depths: [0], blocks: [], lines: new Map(), region, vw, vh, maxSlice: 0, total: 0 };
  }

  /** Works through the scan stack for up to `budget` ms; returns true when the scan is complete. */
  private scanStep(job: ScanJob, budget: number): boolean {
    const t0 = performance.now();
    const sx = window.scrollX, sy = window.scrollY;
    // Boxes are read in client coordinates, so the region is too (the page may scroll between slices).
    const region: Rect = { l: job.region.l - sx, t: job.region.t - sy, r: job.region.r - sx, b: job.region.b - sy };
    const { nodes, flags, depths } = job;
    for (let n = 1; nodes.length; n++) {
      if ((n & 7) === 0 && performance.now() - t0 > budget) return false;
      const node = nodes.pop()!, f = flags.pop()!, depth = depths.pop()!;
      if (node.nodeType === Node.TEXT_NODE) this.textLines(node as Text, (f & FIXED) !== 0, sx, sy, job.lines, region);
      else this.visit(job, node as Element, (f & FIXED) !== 0, (f & VISIBLE) !== 0, depth, region, sx, sy);
    }
    return true;
  }

  /** One element: culls it, reads its style when it could matter, records a solid block, queues its children. */
  private visit(job: ScanJob, el: Element, fixedAncestor: boolean, parentVisible: boolean, depth: number, region: Rect, sx: number, sy: number): void {
    if (SKIP_TAGS.has(el.tagName) || this.ignore.has(el)) return;
    const minSolid = this.opts.minSolidPx, vh = job.vh;
    const r = el.getBoundingClientRect();
    const inRegion = r.right > region.l && r.left < region.r && r.bottom > region.t && r.top < region.b;
    // Content can overflow its parent's box (Wikipedia's body is one screen tall): cull by the box
    // grown to its scroll size, before the (costlier) style read. Fixed children are always kept.
    if (!inRegion && !fixedAncestor && !(Math.max(r.right, r.left + el.scrollWidth) > region.l && r.left < region.r &&
      Math.max(r.bottom, r.top + el.scrollHeight) > region.t && r.top < region.b) && depth > 2 && !this.fixedHolders.has(el)) return;
    const w = r.width, h = r.height;
    let fixed = fixedAncestor, visible = parentVisible;
    // Too small to be solid (and not media): only its text matters, so skip the style read. Zero-size
    // boxes still read it, so display:none subtrees are pruned.
    if (!(inRegion && w >= 1 && h >= 1 && (w < minSolid || h < minSolid) && !SOLID_TAGS.has(el.tagName.toUpperCase()))) {
      const style = getComputedStyle(el);
      if (style.display === 'none') return;
      fixed = fixedAncestor || style.position === 'fixed' || style.position === 'sticky';
      if (fixed && !fixedAncestor) for (let a = el.parentElement; a && !this.fixedHolders.has(a); a = a.parentElement) this.fixedHolders.add(a);
      if (!inRegion && !fixed && style.overflow !== 'visible') return;
      visible = parentVisible && style.visibility !== 'hidden' && Number(style.opacity) > 0.05;
      if (visible && inRegion && w >= 1 && h >= 1) this.solidCheck(el, style, r, w, h, fixed, sx, sy, job.vw, vh, job.blocks);
      if (SOLID_TAGS.has(el.tagName.toUpperCase()) && w >= 8 && h >= 8) return; // media/controls: their insides are not terrain
    }

    // Long child lists (an article body) are in block flow, so their boxes run top to bottom: find
    // the part near the region by bisection instead of reading every child's box.
    const kids = el.children, n = kids.length;
    let first: ChildNode | null = el.firstChild, last: ChildNode | null = el.lastChild;
    if (n > 64 && !fixed) {
      const top = region.t - vh / 2, bottom = region.b + vh / 2;
      let lo = 0, hi = n;
      while (lo < hi) { const m = (lo + hi) >> 1; if (kids[m].getBoundingClientRect().bottom < top) lo = m + 1; else hi = m; }
      const a = lo;
      hi = n;
      while (lo < hi) { const m = (lo + hi) >> 1; if (kids[m].getBoundingClientRect().top <= bottom) lo = m + 1; else hi = m; }
      if (a < lo) { first = kids[a]; last = kids[lo - 1]; } else first = last = null;
      for (let i = 0; i < n; i++) if ((i < a || i >= lo) && this.fixedHolders.has(kids[i])) this.push(job, kids[i], fixed, visible, depth + 1);
    }
    // Pushed last to first, so they come off the stack in document order.
    const text = visible && inRegion;
    for (let c = last; c; c = c === first ? null : c.previousSibling) {
      if (c.nodeType === Node.ELEMENT_NODE || (text && c.nodeType === Node.TEXT_NODE && c.nodeValue && /\S/.test(c.nodeValue))) {
        this.push(job, c, fixed, visible, depth + 1);
      }
    }
  }

  private push(job: ScanJob, node: Node, fixed: boolean, visible: boolean, depth: number): void {
    job.nodes.push(node);
    job.flags.push((fixed ? FIXED : 0) | (visible ? VISIBLE : 0));
    job.depths.push(depth);
  }

  /** Media and controls are solid; so is any other element big enough with a background or border. */
  private solidCheck(el: Element, style: CSSStyleDeclaration, r: DOMRect, w: number, h: number, fixed: boolean, sx: number, sy: number, vw: number, vh: number, blocks: Block[]): void {
    const minSolid = this.opts.minSolidPx;
    let solid: boolean;
    if (SOLID_TAGS.has(el.tagName.toUpperCase())) solid = w >= 8 && h >= 8;
    else {
      if (w < minSolid || h < minSolid || el === document.body || el === document.documentElement) return;
      // Page-sized wrappers with a background are layout, not terrain.
      if (h > vh * 1.5 || (w >= vw * 0.95 && h >= vh * 0.6)) return;
      const bg = style.backgroundColor;
      solid = (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) || style.backgroundImage !== 'none' ||
        ['top', 'right', 'bottom', 'left'].some((s) => parseFloat(style.getPropertyValue(`border-${s}-width`)) > 0 && style.getPropertyValue(`border-${s}-style`) !== 'none');
    }
    if (!solid) return;
    const rect = fixed ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : { l: r.left + sx, t: r.top + sy, r: r.right + sx, b: r.bottom + sy };
    blocks.push({ rect, solid: true, fixed, group: this.groupOf(el) });
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

  /** Turns blocks into Melee-unit platforms (fixed blocks follow the viewport). */
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
      const x0 = Math.fround(v.toUnitsX(r.l)), x1 = Math.fround(v.toUnitsX(r.r)), y0 = Math.fround(v.toUnitsY(r.t));
      segs.push({ kind: SegKind.Platform, x0, y0, x1, y1: y0, group: b.group, ledges: 0, d });
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
