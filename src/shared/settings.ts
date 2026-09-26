// User settings, kept in chrome.storage.local (small values only; files live in IndexedDB).

export interface GamepadMapping {
  /** Standard-gamepad button index for each GameCube button. */
  a: number; b: number; x: number; y: number; z: number; l: number; r: number; start: number; dpadDown: number;
  /** Axis indices: main stick x/y, c-stick x/y. Triggers use buttons l/r analog values. */
  stickX: number; stickY: number; cX: number; cY: number;
}

export interface Settings {
  adapterPort: number;           // 1-4
  fighterHeightPx: number;       // Fox's standing height on the page, sets px_per_unit
  volume: number;                // 0-1
  debug: boolean;                // collision/hitbox draw (also F9)
  disabledOverrides: string[];   // override paths switched off
  plugins: Record<string, boolean>;
  gamepad: GamepadMapping;
  minSolidPx: number;
  minSegmentPx: number;
  maxSegments: number;
}

export const DEFAULT_GAMEPAD: GamepadMapping = {
  // Standard mapping (Xbox layout): A=0 B=1 X=2 Y=3 LB=4 RB=5 LT=6 RT=7 back=8 start=9 ... dpad down=13
  a: 0, b: 2, x: 3, y: 1, z: 5, l: 6, r: 7, start: 9, dpadDown: 13,
  stickX: 0, stickY: 1, cX: 2, cY: 3,
};

export const DEFAULT_SETTINGS: Settings = {
  adapterPort: 1,
  fighterHeightPx: 90,
  volume: 0.7,
  debug: false,
  disabledOverrides: [],
  plugins: { 'moon-gravity': false },
  gamepad: DEFAULT_GAMEPAD,
  minSolidPx: 40,
  minSegmentPx: 24,
  maxSegments: 400,
};

export function withDefaults(raw: Record<string, unknown>): Settings {
  const s = { ...DEFAULT_SETTINGS, ...raw } as Settings;
  s.gamepad = { ...DEFAULT_GAMEPAD, ...(raw.gamepad as object ?? {}) };
  s.plugins = { ...DEFAULT_SETTINGS.plugins, ...(raw.plugins as object ?? {}) };
  return s;
}

export async function loadSettings(): Promise<Settings> {
  return withDefaults(await chrome.storage.local.get(null));
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch);
}
