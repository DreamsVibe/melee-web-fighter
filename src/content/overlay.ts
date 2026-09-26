// The overlay: one transparent full-viewport canvas that never takes the mouse, plus the frame loop.
// Everything it adds to the page is removed again by destroy().

const STEP_MS = 1000 / 60;

export class Overlay {
  readonly canvas: HTMLCanvasElement;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private disposers: Array<() => void> = [];
  private message: HTMLDivElement | null = null;
  /** Called once per engine step (exactly 1/60 s of game time). */
  onStep: (() => void) | null = null;
  /** Called once per animation frame after the steps, with the fraction into the next step. */
  onRender: ((alpha: number) => void) | null = null;

  constructor() {
    const c = document.createElement('canvas');
    c.setAttribute('data-melee-web-fighter', '');
    c.style.cssText = [
      'all:initial', 'position:fixed', 'left:0', 'top:0', 'width:100vw', 'height:100vh',
      'pointer-events:none', 'z-index:2147483647', 'display:block', 'background:transparent',
    ].map((s) => s + ' !important').join(';');
    this.canvas = c;
    document.documentElement.appendChild(c);
    this.resize();
    this.listen(window, 'resize', () => this.resize());
    this.listen(document, 'visibilitychange', () => {
      // A background tab pauses: drop the time that passed while hidden.
      this.last = performance.now();
      this.acc = 0;
    });
  }

  listen<K extends string>(target: EventTarget, type: K, fn: (e: Event) => void, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    this.disposers.push(() => target.removeEventListener(type, fn, opts));
  }

  addDisposer(fn: () => void): void {
    this.disposers.push(fn);
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
  }

  async start(): Promise<void> {
    this.last = performance.now();
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      this.acc += Math.min(now - this.last, 250);
      this.last = now;
      try {
        let steps = 0;
        while (this.acc >= STEP_MS && steps < 8) {
          this.onStep?.();
          this.acc -= STEP_MS;
          steps++;
        }
        if (steps === 8) this.acc = 0;
        this.onRender?.(this.acc / STEP_MS);
      } catch (err) {
        // Never let an engine bug break the page: stop the loop and say what happened.
        cancelAnimationFrame(this.raf);
        console.error('[melee-web-fighter]', err);
        this.showError(String((err as Error)?.message ?? err));
      }
    };
    this.raf = requestAnimationFrame(frame);
  }

  showError(text: string): void {
    if (!this.message) {
      const m = document.createElement('div');
      m.style.cssText = [
        'all:initial', 'position:fixed', 'right:16px', 'bottom:16px', 'max-width:360px', 'padding:10px 14px',
        'font:13px/1.4 system-ui,sans-serif', 'color:#fff', 'background:rgba(20,20,28,.92)', 'border-radius:8px',
        'z-index:2147483647', 'pointer-events:none', 'white-space:pre-wrap',
      ].map((s) => s + ' !important').join(';');
      document.documentElement.appendChild(m);
      this.message = m;
    }
    this.message.textContent = 'Melee Web Fighter: ' + text;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    for (const d of this.disposers.splice(0).reverse()) {
      try { d(); } catch (e) { console.warn(e); }
    }
    this.canvas.remove();
    this.message?.remove();
  }
}
