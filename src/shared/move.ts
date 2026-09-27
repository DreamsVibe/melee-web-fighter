// The .move language: Melee subaction scripts as readable text, one command per line.
//
//   move AttackAirN
//   animation AttackAirN
//   landing_lag 15
//   frame 2   raw 0xa0040005          # (commands the engine does not model stay as raw words)
//   frame 4   autocancel off
//   frame 4   hitbox 0 bone=2 damage=12 size=3.5 angle=361 kbg=100 bkb=10 ...
//   wait 4    clear_hitboxes
//   frame 42  iasa
//
// `frame N` waits until animation frame N (async timer), `wait N` waits N frames (sync timer); both
// may stand alone or prefix a command. `label x:` / `goto x` / `call x` / `return` / `loop N` /
// `endloop` / `end` / `wait_anim_end` mirror Melee's control commands. The encoder turns a parsed
// move back into Melee command words, which is how round-tripping is checked (tests/).

export type Cmd =
  | { op: 'end' } | { op: 'wait'; n: number } | { op: 'frame'; n: number }
  | { op: 'loop'; n: number } | { op: 'endloop' } | { op: 'call'; label: string } | { op: 'return' }
  | { op: 'goto'; label: string } | { op: 'wait_anim_end' }
  | { op: 'hitbox'; f: Record<string, number> }
  | { op: 'hitbox_damage'; id: number; value: number } | { op: 'hitbox_size'; id: number; value: number }
  | { op: 'remove_hitbox'; id: number } | { op: 'clear_hitboxes' }
  | { op: 'sound'; id: number; behavior: number; volume: number; pan: number; extra: number }
  | { op: 'footstep' | 'landing_sound'; id: number; w0: number; w2: number }
  | { op: 'var'; idx: number; value: number }
  | { op: 'iasa' } | { op: 'reverse' } | { op: 'flag20'; value: number }
  | { op: 'airborne'; state: number }
  | { op: 'jab_combo'; disabled: number } | { op: 'rapid_jab'; state: number }
  | { op: 'smash_charge'; frames: number; rate: number; w1: number }
  | { op: 'label'; name: string }
  | { op: 'raw'; words: number[] };

export interface MoveFile {
  name: string;
  animation: string | null;
  landingLag?: number;
  behavior?: string;
  /** Action table flags: 0x80000000 root motion, 0x40000000 loop. */
  animFlags?: number;
  body: Cmd[];
}

// ---- bitfields (MSB-first, as lb/types.h) -------------------------------------------------------
const F = (w: number, from: number, bits: number) => (w >>> (32 - from - bits)) & ((2 ** bits) - 1);
const S = (w: number, from: number, bits: number) => { const v = F(w, from, bits); return v >= 2 ** (bits - 1) ? v - 2 ** bits : v; };
const put = (v: number, from: number, bits: number) => ((v & ((2 ** bits) - 1)) * 2 ** (32 - from - bits));
const word = (...parts: number[]) => parts.reduce((a, b) => a + b, 0) >>> 0;

/** Hitbox fields: [name, word, from bit, bits, signed, scale]. Word 0 carries the opcode in bits 0-5. */
const HITBOX: Array<[string, number, number, number, boolean, number]> = [
  ['id', 0, 6, 3, false, 1], ['group', 0, 9, 3, false, 1], ['grabbed_only', 0, 12, 1, false, 1],
  ['bone', 0, 13, 8, false, 1], ['common_bone', 0, 21, 1, false, 1], ['damage', 0, 22, 10, false, 1],
  ['size', 1, 0, 16, false, 256], ['z', 1, 16, 16, true, 256],
  ['y', 2, 0, 16, true, 256], ['x', 2, 16, 16, true, 256],
  ['angle', 3, 0, 9, false, 1], ['kbg', 3, 9, 9, false, 1], ['wkb', 3, 18, 9, false, 1], ['items', 3, 27, 1, false, 1],
  ['ignore_thrown', 3, 28, 1, false, 1], ['ignore_scale', 3, 29, 1, false, 1], ['clank', 3, 30, 1, false, 1], ['rebound', 3, 31, 1, false, 1],
  ['bkb', 4, 0, 9, false, 1], ['element', 4, 9, 5, false, 1], ['shield', 4, 14, 8, true, 1], ['sfx_level', 4, 22, 3, false, 1],
  ['sfx_kind', 4, 25, 5, false, 1], ['ground', 4, 30, 1, false, 1], ['air', 4, 31, 1, false, 1],
];

// ---- decode raw words → commands ----------------------------------------------------------------
const LENGTHS_FROM_10 = [5, 5, 1, 1, 1, 1, 1, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 1, 1, 1, 7, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 3, 2, 1, 4];
export const cmdLength = (op: number) => (op < 10 ? (op === 5 || op === 7 ? 2 : 1) : LENGTHS_FROM_10[op - 10] ?? 1);

/** Decodes one command's words. `labelOf` names jump targets (offsets). */
export function decodeCommand(words: number[], labelOf: (target: number) => string): Cmd {
  const w0 = words[0];
  const op = w0 >>> 26;
  switch (op) {
    case 0: return { op: 'end' };
    case 1: return { op: 'wait', n: F(w0, 6, 26) };
    case 2: return { op: 'frame', n: F(w0, 6, 26) };
    case 3: if (F(w0, 6, 26) === (w0 & 0x3ffffff)) return { op: 'loop', n: F(w0, 6, 26) }; break;
    case 4: if (w0 === 0x10000000) return { op: 'endloop' }; break;
    case 5: return { op: 'call', label: labelOf(words[1]) };
    case 6: if (w0 === 0x18000000) return { op: 'return' }; break;
    case 7: if (w0 === 0x1c000000) return { op: 'goto', label: labelOf(words[1]) }; break;
    case 8: if (w0 === 0x20000000) return { op: 'wait_anim_end' }; break;
    case 11: {
      if (words[5] !== undefined) break;
      const f: Record<string, number> = {};
      for (const [n, wi, from, bits, signed, scale] of HITBOX) f[n] = (signed ? S(words[wi], from, bits) : F(words[wi], from, bits)) / scale;
      return { op: 'hitbox', f };
    }
    case 12: return { op: 'hitbox_damage', id: F(w0, 6, 3), value: F(w0, 9, 23) };
    case 13: return { op: 'hitbox_size', id: F(w0, 6, 3), value: F(w0, 9, 23) / 256 };
    case 15: return { op: 'remove_hitbox', id: F(w0, 6, 26) };
    case 16: if (w0 === 0x40000000) return { op: 'clear_hitboxes' }; break;
    case 17: return { op: 'sound', behavior: F(w0, 6, 8), extra: F(w0, 14, 18), id: words[1], volume: F(words[2], 16, 8), pan: F(words[2], 24, 8) };
    case 19: if (F(w0, 6, 2) <= 3) return { op: 'var', idx: F(w0, 6, 2), value: F(w0, 8, 24) }; break;
    case 20: return F(w0, 6, 26) === 0 ? { op: 'reverse' } : { op: 'flag20', value: F(w0, 6, 26) };
    case 23: if (w0 === 0x5c000000) return { op: 'iasa' }; break;
    case 25: return { op: 'airborne', state: F(w0, 6, 26) };
    case 29: return { op: 'jab_combo', disabled: F(w0, 6, 26) };
    case 30: return { op: 'rapid_jab', state: F(w0, 6, 26) };
    case 56: if (words.length === 2) return { op: 'smash_charge', frames: F(w0, 6, 10), rate: F(w0, 16, 16), w1: words[1] }; break;
    case 54: return { op: 'footstep', id: words[1], w0, w2: words[2] };
    case 55: return { op: 'landing_sound', id: words[1], w0, w2: words[2] };
  }
  return { op: 'raw', words: [...words] };
}

// ---- encode commands → raw words (labels resolved by the caller) --------------------------------
export function encodeCommand(c: Cmd, target: (label: string) => number): number[] {
  switch (c.op) {
    case 'end': return [0];
    case 'wait': return [word(put(1, 0, 6), put(c.n, 6, 26))];
    case 'frame': return [word(put(2, 0, 6), put(c.n, 6, 26))];
    case 'loop': return [word(put(3, 0, 6), put(c.n, 6, 26))];
    case 'endloop': return [0x10000000];
    case 'call': return [0x14000000, target(c.label)];
    case 'return': return [0x18000000];
    case 'goto': return [0x1c000000, target(c.label)];
    case 'wait_anim_end': return [0x20000000];
    case 'hitbox': {
      const w = [put(11, 0, 6), 0, 0, 0, 0];
      for (const [n, wi, from, bits, , scale] of HITBOX) w[wi] += put(Math.round((c.f[n] ?? 0) * scale), from, bits);
      return w.map((x) => x >>> 0);
    }
    case 'hitbox_damage': return [word(put(12, 0, 6), put(c.id, 6, 3), put(c.value, 9, 23))];
    case 'hitbox_size': return [word(put(13, 0, 6), put(c.id, 6, 3), put(Math.round(c.value * 256), 9, 23))];
    case 'remove_hitbox': return [word(put(15, 0, 6), put(c.id, 6, 26))];
    case 'clear_hitboxes': return [0x40000000];
    case 'sound': return [word(put(17, 0, 6), put(c.behavior, 6, 8), put(c.extra, 14, 18)), c.id >>> 0, word(put(c.volume, 16, 8), put(c.pan, 24, 8))];
    case 'var': return [word(put(19, 0, 6), put(c.idx, 6, 2), put(c.value, 8, 24))];
    case 'reverse': return [put(20, 0, 6) >>> 0];
    case 'flag20': return [word(put(20, 0, 6), put(c.value, 6, 26))];
    case 'iasa': return [0x5c000000];
    case 'airborne': return [word(put(25, 0, 6), put(c.state, 6, 26))];
    case 'jab_combo': return [word(put(29, 0, 6), put(c.disabled, 6, 26))];
    case 'rapid_jab': return [word(put(30, 0, 6), put(c.state, 6, 26))];
    case 'smash_charge': return [word(put(56, 0, 6), put(c.frames, 6, 10), put(c.rate, 16, 16)), c.w1 >>> 0];
    case 'footstep': case 'landing_sound': return [c.w0 >>> 0, c.id >>> 0, c.w2 >>> 0];
    case 'label': return [];
    case 'raw': return c.words.map((x) => x >>> 0);
  }
}

/** What the commands the engine leaves raw do (comment only). */
const RAW_NAMES: Record<number, string> = {
  9: 'background flash', 10: 'graphic effect', 14: 'hitbox flags', 18: 'smash charge sound', 21: 'throw flag',
  22: 'throw flag', 24: 'throw flag', 26: 'body collision state', 27: 'hurtbox state', 28: 'hurtbox bone state',
  31: 'model part visibility', 34: 'throw hitbox', 36: 'item visibility', 37: 'fighter visibility', 38: 'random sound',
  40: 'eye texture', 43: 'rumble', 52: 'landing effect',
};

// ---- text ----------------------------------------------------------------------------------------
const num = (v: number) => String(v);
const hex = (v: number) => '0x' + (v >>> 0).toString(16).padStart(8, '0');

export function formatCommand(c: Cmd, soundName: (id: number) => string): string {
  switch (c.op) {
    case 'wait': return `wait ${c.n}`;
    case 'frame': return `frame ${c.n}`;
    case 'loop': return `loop ${c.n}`;
    case 'call': return `call ${c.label}`;
    case 'goto': return `goto ${c.label}`;
    case 'label': return `label ${c.name}:`;
    case 'hitbox': {
      const f = c.f;
      const parts = [`hitbox ${f.id}`];
      for (const [n] of HITBOX) if (n !== 'id' && (f[n] !== 0 || ['bone', 'damage', 'size', 'angle', 'kbg', 'bkb'].includes(n))) parts.push(`${n}=${num(f[n])}`);
      return parts.join(' ');
    }
    case 'hitbox_damage': return `hitbox_damage ${c.id} ${c.value}`;
    case 'hitbox_size': return `hitbox_size ${c.id} ${num(c.value)}`;
    case 'remove_hitbox': return `remove_hitbox ${c.id}`;
    case 'sound': {
      let s = `sound ${soundName(c.id)}`;
      if (c.volume !== 127) s += ` volume=${c.volume}`;
      if (c.pan !== 64) s += ` pan=${c.pan}`;
      if (c.behavior !== 0) s += ` behavior=${c.behavior}`;
      if (c.extra !== 0) s += ` extra=${c.extra}`;
      return s;
    }
    case 'footstep': case 'landing_sound': return `${c.op} ${soundName(c.id)} ${hex(c.w0)} ${hex(c.w2)}`;
    case 'var':
      if (c.idx === 0 && (c.value === 0 || c.value === 1)) return `autocancel ${c.value ? 'off' : 'on'}`;
      return `var ${c.idx} ${c.value}`;
    case 'flag20': return `flag20 ${c.value}`;
    case 'airborne': return `airborne ${c.state}`;
    case 'jab_combo': return c.disabled ? `jab_combo ${c.disabled}` : 'jab_combo';
    case 'rapid_jab': return `rapid_jab ${c.state ? 'on' : 'off'}` + (c.state > 1 ? ` ${c.state}` : '');
    case 'smash_charge': return `smash_charge frames=${c.frames} rate=${c.rate}` + (c.w1 ? ` extra=${hex(c.w1)}` : '');
    case 'raw': {
      const what = RAW_NAMES[c.words[0] >>> 26];
      return `raw ${c.words.map(hex).join(' ')}` + (what ? `   # ${what}` : '');
    }
    default: return c.op;
  }
}

export function formatMove(m: MoveFile, soundName: (id: number) => string): string {
  const lines = [`move ${m.name}`];
  if (m.animation) lines.push(`animation ${m.animation}`);
  if (m.landingLag !== undefined) lines.push(`landing_lag ${m.landingLag}`);
  if (m.behavior) lines.push(`behavior ${m.behavior}`);
  if (m.animFlags !== undefined) lines.push(`anim_flags ${hex(m.animFlags)}`);
  let timer: string | null = null;
  for (const c of m.body) {
    if (c.op === 'frame' || c.op === 'wait') {
      if (timer) lines.push(timer);
      timer = formatCommand(c, soundName);
      continue;
    }
    const text = formatCommand(c, soundName);
    if (c.op === 'label') { if (timer) lines.push(timer); timer = null; lines.push(text); continue; }
    lines.push(timer ? timer.padEnd(10) + text : text);
    timer = null;
  }
  if (timer) lines.push(timer);
  return lines.join('\n') + '\n';
}

export class MoveSyntaxError extends Error {}

function parseCommand(tokens: string[], soundId: (name: string) => number, line: number): Cmd {
  const [op, ...args] = tokens;
  const n = (i: number) => {
    const v = Number(args[i]);
    if (args[i] === undefined || Number.isNaN(v)) throw new MoveSyntaxError(`line ${line}: ${op} needs a number`);
    return v;
  };
  const kv = () => {
    const out: Record<string, number> = {};
    for (const a of args) {
      const eq = a.indexOf('=');
      if (eq > 0) out[a.slice(0, eq)] = Number(a.slice(eq + 1));
    }
    return out;
  };
  switch (op) {
    case 'end': case 'endloop': case 'return': case 'wait_anim_end': case 'clear_hitboxes': case 'iasa': case 'reverse':
      return { op } as Cmd;
    case 'wait': case 'frame': case 'loop': return { op, n: n(0) };
    case 'goto': case 'call': return { op, label: args[0] };
    case 'hitbox': {
      const f: Record<string, number> = {};
      for (const [name] of HITBOX) f[name] = 0;
      Object.assign(f, kv());
      f.id = n(0);
      return { op, f };
    }
    case 'hitbox_damage': return { op, id: n(0), value: n(1) };
    case 'hitbox_size': return { op, id: n(0), value: n(1) };
    case 'remove_hitbox': return { op, id: n(0) };
    case 'sound': {
      const o = kv();
      return { op, id: soundId(args[0]), volume: o.volume ?? 127, pan: o.pan ?? 64, behavior: o.behavior ?? 0, extra: o.extra ?? 0 };
    }
    case 'footstep': case 'landing_sound':
      return { op, id: soundId(args[0]), w0: Number(args[1] ?? (op === 'footstep' ? 0xd8000000 : 0xdc000000)), w2: Number(args[2] ?? 0x7f40) };
    case 'autocancel': return { op: 'var', idx: 0, value: args[0] === 'off' ? 1 : 0 };
    case 'var': return { op, idx: n(0), value: n(1) };
    case 'flag20': return { op, value: n(0) };
    case 'airborne': return { op, state: n(0) };
    case 'jab_combo': return { op, disabled: args[0] === undefined ? 0 : n(0) };
    case 'rapid_jab': return { op, state: args[1] !== undefined ? n(1) : args[0] === 'on' ? 1 : 0 };
    case 'smash_charge': { const o = kv(); return { op, frames: o.frames ?? 60, rate: o.rate ?? 0, w1: o.extra ?? 0 }; }
    case 'raw': return { op, words: args.map((a) => Number(a) >>> 0) };
  }
  throw new MoveSyntaxError(`line ${line}: unknown command "${op}"`);
}

export function parseMove(text: string, soundId: (name: string) => number): MoveFile {
  const m: MoveFile = { name: '', animation: null, body: [] };
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const s = raw.replace(/#.*$/, '').trim();
    if (!s) return;
    let tokens = s.split(/\s+/);
    switch (tokens[0]) {
      case 'move': m.name = tokens[1] ?? ''; return;
      case 'animation': m.animation = tokens[1] ?? null; return;
      case 'landing_lag': m.landingLag = Number(tokens[1]); return;
      case 'behavior': m.behavior = tokens[1]; return;
      case 'anim_flags': m.animFlags = Number(tokens[1]) >>> 0; return;
      case 'label': m.body.push({ op: 'label', name: (tokens[1] ?? '').replace(/:$/, '') }); return;
    }
    if ((tokens[0] === 'frame' || tokens[0] === 'wait') && tokens.length > 2) {
      m.body.push(parseCommand(tokens.slice(0, 2), soundId, line));
      tokens = tokens.slice(2);
    }
    m.body.push(parseCommand(tokens, soundId, line));
  });
  if (!m.name) throw new MoveSyntaxError('missing "move <name>" line');
  return m;
}

/** Encodes a move body to words, resolving labels to word offsets. */
export function encodeMove(body: Cmd[]): number[] {
  const offsets = new Map<string, number>();
  let pos = 0;
  for (const c of body) {
    if (c.op === 'label') offsets.set(c.name, pos);
    else pos += encodeCommand(c, () => 0).length;
  }
  const out: number[] = [];
  for (const c of body) out.push(...encodeCommand(c, (l) => {
    const t = offsets.get(l);
    if (t === undefined) throw new MoveSyntaxError(`unknown label ${l}`);
    return t;
  }));
  return out;
}
