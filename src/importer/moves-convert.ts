// Converts every action's subaction script into a .move file (see shared/move.ts).
import { Archive } from './hsd';
import { readScript, type RawCommand } from './subaction';
import { decodeCommand, formatMove, type Cmd, type MoveFile } from '../shared/move';
import { COMMON_SUBMOTIONS, FOX_SUBMOTIONS } from './submotions';
import type { ActionEntry } from './actions';

export function submotionName(index: number): string {
  return index < COMMON_SUBMOTIONS.length ? COMMON_SUBMOTIONS[index] : FOX_SUBMOTIONS[index - COMMON_SUBMOTIONS.length] ?? `Action${index}`;
}

const LANDING_LAG: Record<string, string> = {
  AttackAirN: 'landingairn_lag', AttackAirF: 'landingairf_lag', AttackAirB: 'landingairb_lag',
  AttackAirHi: 'landingairhi_lag', AttackAirLw: 'landingairlw_lag',
};

/** Fox's moves that need logic data can't express, by the behavior module that runs them. */
const BEHAVIOR_OF: Array<[RegExp, string]> = [
  [/^Special(Air)?N/, 'blaster'], [/^Special(Air)?S/, 'illusion'], [/^SpecialHi/, 'firefox'],
  [/^Special(Air)?Lw/, 'shine'], [/^SpecialAppeal/, 'appeal'],
];

/** Emits the script at `start` and everything it jumps to as one body with labels. */
export function scriptBody(a: Archive, start: number): { body: Cmd[]; raw: number[][] } {
  const scripts: RawCommand[][] = [];
  const emitted = new Map<number, number>(); // command offset → index in scripts
  const queue = [start];
  const targets = new Set<number>();
  while (queue.length) {
    const s = queue.shift()!;
    if (emitted.has(s)) continue;
    const cmds = readScript(a, s);
    scripts.push(cmds);
    for (const c of cmds) {
      emitted.set(c.at, scripts.length - 1);
      if (c.target !== undefined) { targets.add(c.target); if (!emitted.has(c.target)) queue.push(c.target); }
    }
  }
  const label = (off: number) => (off === start ? 'start' : `L${off.toString(16)}`);
  const body: Cmd[] = [];
  const raw: number[][] = [];
  for (const cmds of scripts) for (const c of cmds) {
    if (targets.has(c.at)) body.push({ op: 'label', name: label(c.at) });
    body.push(decodeCommand(c.words, label));
    raw.push(c.words);
  }
  return { body, raw };
}

export function convertMoves(plfx: Archive, actions: ActionEntry[], attributes: Record<string, number>, soundName: (id: number) => string): Array<{ name: string; text: string; move: MoveFile }> {
  const out: Array<{ name: string; text: string; move: MoveFile }> = [];
  for (const act of actions) {
    if (!act.script && !act.anim) continue;
    const name = submotionName(act.index);
    const move: MoveFile = { name, animation: act.anim || null, body: [], animFlags: act.flags };
    if (LANDING_LAG[name]) move.landingLag = attributes[LANDING_LAG[name]];
    const behavior = BEHAVIOR_OF.find(([re]) => re.test(name));
    if (behavior) move.behavior = behavior[1];
    if (act.script) move.body = scriptBody(plfx, act.script).body;
    out.push({ name, move, text: formatMove(move, soundName) });
  }
  return out;
}
