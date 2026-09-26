// Runs .move scripts with Melee's command timing (ft/ftaction.c ftAction_80073240 and friends,
// lb/lbcommand.c Command_00..08): `wait N` adds to the timer, `frame N` sets it to N - frame_count,
// and commands run while the timer is not positive.
import type { Cmd } from '../shared/move';
import type { CompiledMove, Fighter } from './types';

export const F32_MAX = 3.4028234663852886e38;
const f = Math.fround;

export interface ScriptHost {
  /** Executes one fighter command (anything that is not control flow). */
  exec(fp: Fighter, c: Cmd): void;
}

/** Starts a move's script (Fighter_ChangeMotionState: cmd.u = script, timer by anim_start). */
export function startScript(fp: Fighter, move: CompiledMove | null, animStart: number): void {
  const s = fp.script;
  s.move = move && move.cmds.length ? move : null;
  s.pc = 0;
  s.loopStack.length = 0;
  s.callStack.length = 0;
  s.timer = animStart ? f(-animStart) : 0;
}

/** Control commands (Command_Execute); returns false for fighter commands. */
function control(s: Fighter['script'], c: Cmd, move: CompiledMove): boolean {
  switch (c.op) {
    case 'end': s.move = null; return true;
    case 'wait': s.timer = f(s.timer + c.n); s.pc++; return true;
    case 'frame': s.timer = f(c.n - s.frameCount); s.pc++; return true;
    case 'loop': s.pc++; s.loopStack.push({ pc: s.pc, count: c.n }); return true;
    case 'endloop': {
      const top = s.loopStack[s.loopStack.length - 1];
      if (top && --top.count) { s.pc = top.pc; return true; }
      s.loopStack.pop();
      s.pc++;
      return true;
    }
    case 'call': s.callStack.push(s.pc + 1); s.pc = move.labels.get(c.label) ?? move.cmds.length; return true;
    case 'return': s.pc = s.callStack.pop() ?? move.cmds.length; return true;
    case 'goto': s.pc = move.labels.get(c.label) ?? move.cmds.length; return true;
    case 'wait_anim_end': s.pc++; s.timer = F32_MAX; return true;
    case 'label': s.pc++; return true;
    default: return false;
  }
}

/**
 * One script update. `skipEvents` mirrors ftAction_8007349C (advance through commands without
 * running them, used when a walk changes speed mid-animation).
 */
export function runScript(fp: Fighter, host: ScriptHost, skipEvents = false): void {
  const s = fp.script;
  s.frameCount = f(fp.animFrame + fp.frameAccum);
  if (!s.move) return;
  if (s.timer !== F32_MAX) s.timer = f(s.timer - fp.animRate);
  for (let guard = 0; guard < 10000; guard++) {
    const move = s.move;
    if (!move) break;
    if (s.timer === F32_MAX) {
      if (s.frameCount >= fp.animRate) break;
      s.timer = f(-s.frameCount);
    } else if (s.timer > 0) break;
    if (s.pc >= move.cmds.length) { s.move = null; break; }
    const c = move.cmds[s.pc];
    if (!control(s, c, move)) {
      s.pc++;
      if (!skipEvents) host.exec(fp, c);
    }
    if (s.timer === F32_MAX) break;
  }
}
