// User settings, kept in chrome.storage.local (small values only; files live in IndexedDB).

export interface GamepadMapping {
  /** Standard-gamepad button index for each GameCube button. */
  a: number; b: number; x: number; y: number; z: number; l: number; r: number; start: number; dpadDown: number; dpadUp: number;
  /** Axis indices: main stick x/y, c-stick x/y. Triggers use buttons l/r analog values. */
  stickX: number; stickY: number; cX: number; cY: number;
}

/** Keyboard binding: a list of KeyboardEvent.code values for each pad input. */
export const KEY_ACTIONS = [
  'up', 'down', 'left', 'right', 'walk', 'a', 'b', 'x', 'y', 'z', 'l', 'r', 'start', 'dpadUp', 'dpadDown',
  'cUp', 'cDown', 'cLeft', 'cRight',
] as const;
export type KeyAction = typeof KEY_ACTIONS[number];
export type KeyboardMapping = Record<KeyAction, string[]>;

/** The characters a player can pick (their folders are characters/<id>/). */
export const CHARACTERS = [{ id: 'fox', name: 'Fox' }, { id: 'falco', name: 'Falco' }] as const;
export type CharacterId = typeof CHARACTERS[number]['id'];

export interface Settings {
  /** Who you play. */
  character: CharacterId;
  adapterPort: number;           // 1-4
  fighterHeightPx: number;       // Fox's standing height on the page, sets px_per_unit (Falco is drawn to the same scale)
  volume: number;                // 0-1
  debug: boolean;                // collision/hitbox draw (also F9)
  disabledOverrides: string[];   // override paths switched off
  plugins: Record<string, boolean>;
  gamepad: GamepadMapping;
  keyboard: KeyboardMapping;
  /** Sandbag stands next to the player to hit; with sandbagDamage off it stays at 0%. */
  sandbag: boolean;
  sandbagDamage: boolean;
  minSolidPx: number;
  minSegmentPx: number;
  maxSegments: number;
}

export const DEFAULT_GAMEPAD: GamepadMapping = {
  // Standard mapping (Xbox layout): A=0 B=1 X=2 Y=3 LB=4 RB=5 LT=6 RT=7 back=8 start=9 ... dpad up=12, down=13
  a: 0, b: 2, x: 3, y: 1, z: 5, l: 6, r: 7, start: 9, dpadDown: 13, dpadUp: 12,
  stickX: 0, stickY: 1, cX: 2, cY: 3,
};

export const DEFAULT_KEYBOARD: KeyboardMapping = {
  up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  walk: ['ShiftLeft', 'ShiftRight'],
  a: ['KeyJ'], b: ['KeyK'], x: ['Space', 'KeyI'], y: [], z: ['KeyU'], l: [], r: ['KeyL'], start: ['Enter'],
  dpadUp: ['KeyP'], dpadDown: ['KeyO'],
  cUp: [], cDown: [], cLeft: [], cRight: [],
};

export const DEFAULT_SETTINGS: Settings = {
  character: 'fox',
  adapterPort: 1,
  fighterHeightPx: 90,
  volume: 0.7,
  debug: false,
  disabledOverrides: [],
  plugins: { 'moon-gravity': false },
  gamepad: DEFAULT_GAMEPAD,
  keyboard: DEFAULT_KEYBOARD,
  sandbag: true,
  sandbagDamage: true,
  minSolidPx: 40,
  minSegmentPx: 24,
  maxSegments: 400,
};

export function withDefaults(raw: Record<string, unknown>): Settings {
  const s = { ...DEFAULT_SETTINGS, ...raw } as Settings;
  s.gamepad = { ...DEFAULT_GAMEPAD, ...(raw.gamepad as object ?? {}) };
  const kb = (raw.keyboard ?? {}) as Partial<Record<string, unknown>>;
  s.keyboard = { ...DEFAULT_KEYBOARD };
  for (const a of KEY_ACTIONS) if (Array.isArray(kb[a])) s.keyboard[a] = (kb[a] as unknown[]).filter((k): k is string => typeof k === 'string');
  s.plugins = { ...DEFAULT_SETTINGS.plugins, ...(raw.plugins as object ?? {}) };
  if (!CHARACTERS.some((c) => c.id === s.character)) s.character = DEFAULT_SETTINGS.character;
  return s;
}

export async function loadSettings(): Promise<Settings> {
  return withDefaults(await chrome.storage.local.get(null));
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch);
}
