// Input sources → one PadState per engine step: GameCube adapter (reports relayed from the bridge
// iframe), any standard gamepad (Gamepad API), and the keyboard as a fallback.
import { AdapterDecoder, BTN, emptyPad, type PadState } from '../engine/pad';
import { DEFAULT_GAMEPAD, DEFAULT_KEYBOARD, KEY_ACTIONS, type GamepadMapping, type KeyAction, type KeyboardMapping } from '../shared/settings';

const KEY_BUTTONS: Partial<Record<KeyAction, number>> = {
  a: BTN.A, b: BTN.B, x: BTN.X, y: BTN.Y, z: BTN.Z, l: BTN.L, r: BTN.R, start: BTN.START, dpadUp: BTN.DUP, dpadDown: BTN.DDOWN,
};
/** Direction each stick key pushes: [main stick (0) or C-stick (1), x, y]. */
const KEY_STICK: Partial<Record<KeyAction, [number, number, number]>> = {
  left: [0, -1, 0], right: [0, 1, 0], up: [0, 0, 1], down: [0, 0, -1],
  cLeft: [1, -1, 0], cRight: [1, 1, 0], cUp: [1, 0, 1], cDown: [1, 0, -1],
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
  /** Key code → the pad inputs it drives (a key can be bound to more than one). */
  private keyMap = new Map<string, KeyAction[]>();
  adapterStatus = 'waiting';
  /** Adapter port actually read (0-3), -1 when no controller is plugged in. */
  adapterPort = -1;
  /** Which source drove the last sample, for the debug display. */
  source = 'none';
  onKey: ((code: string) => void) | null = null;
  private readonly down = (e: KeyboardEvent) => {
    if (isEditable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.keyMap.has(e.code)) {
      this.keys.add(e.code);
      this.latched.add(e.code);
      e.preventDefault(); // keep arrows/space from scrolling the page while Fox is on it
    }
    this.onKey?.(e.code);
  };
  private readonly up = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private readonly blur = () => { this.keys.clear(); this.latched.clear(); };

  constructor() {
    this.setKeyboard(DEFAULT_KEYBOARD);
    window.addEventListener('keydown', this.down, true);
    window.addEventListener('keyup', this.up, true);
    window.addEventListener('blur', this.blur);
  }

  setKeyboard(mapping: KeyboardMapping): void {
    this.keyMap.clear();
    for (const action of KEY_ACTIONS) {
      for (const code of mapping[action]) {
        const list = this.keyMap.get(code);
        if (list) list.push(action); else this.keyMap.set(code, [action]);
      }
    }
    this.keys.clear(); this.latched.clear();
  }

  adapterReport(report: Uint8Array): void {
    this.lastReport = report;
    this.lastReportAt = performance.now();
  }

  private keyboard(out: PadState): boolean {
    const keys = this.latched.size ? new Set([...this.keys, ...this.latched]) : this.keys;
    this.latched.clear();
    if (!keys.size) return false;
    const dir = [0, 0, 0, 0]; // main x, y, C x, y
    let walk = false, any = false;
    for (const k of keys) {
      for (const action of this.keyMap.get(k) ?? []) {
        any = true;
        const s = KEY_STICK[action];
        if (s) { dir[s[0] * 2] += s[1]; dir[s[0] * 2 + 1] += s[2]; }
        const b = KEY_BUTTONS[action];
        if (b) out.buttons |= b;
        if (action === 'walk') walk = true;
      }
    }
    if (!any) return false;
    const mag = walk ? 40 : 80;
    const len = Math.hypot(dir[0], dir[1]) || 1;
    out.stickX = Math.round((dir[0] / len) * mag);
    out.stickY = Math.round((dir[1] / len) * mag);
    const clen = Math.hypot(dir[2], dir[3]) || 1;
    out.cX = Math.round((dir[2] / clen) * 80);
    out.cY = Math.round((dir[3] / clen) * 80);
    if (out.buttons & BTN.L) out.trigL = 255;
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
      if (btn(m.z)) b |= BTN.Z; if (btn(m.start)) b |= BTN.START; if (btn(m.dpadDown)) b |= BTN.DDOWN; if (btn(m.dpadUp)) b |= BTN.DUP;
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
    if (this.lastReport && performance.now() - this.lastReportAt < 500 && this.adapterPad(this.lastReport, out)) {
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

  /** The selected port; if nothing is plugged in there, the first port that has a controller. */
  private adapterPad(report: Uint8Array, out: PadState): boolean {
    if (this.adapter.decode(report, this.port, out)) { this.adapterPort = this.port; return true; }
    for (let p = 0; p < 4; p++) if (p !== this.port && this.adapter.decode(report, p, out)) { this.adapterPort = p; return true; }
    this.adapterPort = -1;
    return false;
  }

  destroy(): void {
    window.removeEventListener('keydown', this.down, true);
    window.removeEventListener('keyup', this.up, true);
    window.removeEventListener('blur', this.blur);
  }
}
