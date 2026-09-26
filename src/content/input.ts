// Input sources → one PadState per engine step: GameCube adapter (reports relayed from the bridge
// iframe), any standard gamepad (Gamepad API), and the keyboard as a fallback.
import { AdapterDecoder, BTN, emptyPad, type PadState } from '../engine/pad';
import { DEFAULT_GAMEPAD, type GamepadMapping } from '../shared/settings';

const KEY_BUTTONS: Record<string, number> = {
  KeyJ: BTN.A, KeyK: BTN.B, Space: BTN.X, KeyI: BTN.X, KeyL: BTN.R, KeyU: BTN.Z, KeyO: BTN.DDOWN, Enter: BTN.START,
};
const KEY_STICK: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
  ArrowUp: [0, 1], KeyW: [0, 1], ArrowDown: [0, -1], KeyS: [0, -1],
};

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

export class InputManager {
  private keys = new Set<string>();
  /** Keys pressed since the last sample: a tap shorter than a frame still counts for one frame. */
  private latched = new Set<string>();
  private adapter = new AdapterDecoder();
  private lastReport: Uint8Array | null = null;
  private lastReportAt = 0;
  port = 0;
  mapping: GamepadMapping = DEFAULT_GAMEPAD;
  adapterStatus = 'waiting';
  /** Which source drove the last sample, for the debug display. */
  source = 'none';
  onKey: ((code: string) => void) | null = null;
  private readonly down = (e: KeyboardEvent) => {
    if (isEditable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code in KEY_BUTTONS || e.code in KEY_STICK || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this.keys.add(e.code);
      this.latched.add(e.code);
      e.preventDefault(); // keep arrows/space from scrolling the page while Fox is on it
    }
    this.onKey?.(e.code);
  };
  private readonly up = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private readonly blur = () => { this.keys.clear(); this.latched.clear(); };

  constructor() {
    window.addEventListener('keydown', this.down, true);
    window.addEventListener('keyup', this.up, true);
    window.addEventListener('blur', this.blur);
  }

  adapterReport(report: Uint8Array): void {
    this.lastReport = report;
    this.lastReportAt = performance.now();
  }

  private keyboard(out: PadState): boolean {
    const keys = this.latched.size ? new Set([...this.keys, ...this.latched]) : this.keys;
    this.latched.clear();
    if (!keys.size) return false;
    let x = 0, y = 0;
    for (const k of keys) {
      const s = KEY_STICK[k];
      if (s) { x += s[0]; y += s[1]; }
      const b = KEY_BUTTONS[k];
      if (b) out.buttons |= b;
    }
    const walk = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const mag = walk ? 40 : 80;
    const len = Math.hypot(x, y) || 1;
    out.stickX = Math.round((x / len) * mag);
    out.stickY = Math.round((y / len) * mag);
    if (out.buttons & BTN.R) out.trigR = 255;
    return true;
  }

  private gamepad(out: PadState): boolean {
    const pads = navigator.getGamepads?.() ?? [];
    const m = this.mapping;
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const btn = (i: number) => gp.buttons[i]?.pressed ?? false;
      let b = 0;
      if (btn(m.a)) b |= BTN.A; if (btn(m.b)) b |= BTN.B; if (btn(m.x)) b |= BTN.X; if (btn(m.y)) b |= BTN.Y;
      if (btn(m.z)) b |= BTN.Z; if (btn(m.start)) b |= BTN.START; if (btn(m.dpadDown)) b |= BTN.DDOWN;
      const lv = gp.buttons[m.l]?.value ?? 0, rv = gp.buttons[m.r]?.value ?? 0;
      // A full trigger press is also the digital click, as on a GameCube controller.
      if (lv > 0.95 || (btn(m.l) && lv === 0)) b |= BTN.L;
      if (rv > 0.95 || (btn(m.r) && rv === 0)) b |= BTN.R;
      const ax = (i: number) => gp.axes[i] ?? 0;
      const stick = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) * 100);
      const active = b !== 0 || Math.abs(ax(m.stickX)) > 0.2 || Math.abs(ax(m.stickY)) > 0.2 || Math.abs(ax(m.cX)) > 0.2 || Math.abs(ax(m.cY)) > 0.2 || lv > 0.1 || rv > 0.1;
      if (!active) continue;
      out.buttons |= b;
      out.stickX = stick(ax(m.stickX)); out.stickY = -stick(ax(m.stickY));
      out.cX = stick(ax(m.cX)); out.cY = -stick(ax(m.cY));
      out.trigL = Math.round(lv * 140); out.trigR = Math.round(rv * 140);
      return true;
    }
    return false;
  }

  /** One pad for this engine step. The adapter wins when a controller is plugged into our port. */
  sample(out: PadState): PadState {
    Object.assign(out, emptyPad());
    if (this.lastReport && performance.now() - this.lastReportAt < 500 && this.adapter.decode(this.lastReport, this.port, out)) {
      this.source = 'adapter';
      const kb = emptyPad();
      if (this.keyboard(kb)) out.buttons |= kb.buttons;
      return out;
    }
    if (this.gamepad(out)) { this.source = 'gamepad'; return out; }
    if (this.keyboard(out)) { this.source = 'keyboard'; return out; }
    this.source = 'none';
    return out;
  }

  destroy(): void {
    window.removeEventListener('keydown', this.down, true);
    window.removeEventListener('keyup', this.up, true);
    window.removeEventListener('blur', this.blur);
  }
}
