// Fox's own taunt, ported from ft/kinds/ftFox/ftfoxappeals.c: the three-part animation where he calls
// his Arwing (on Corneria it flies in). Here it plays on D-pad down, anywhere; the Arwing itself is a
// stage object and does not come.
import type { Engine } from '../engine';
import { MF } from '../engine';
import { addStates, collTeeter, waitEnter, type Kit, type StateDef } from '../states';
import { groundFriction } from '../physics';

/** ftFx_MS_AppealSStartR ... EndL: [facing right, facing left] × [start, loop, end]. */
const MSID = [[370, 372, 374], [371, 373, 375]];
const MOVES = [['SpecialAppealStartR', 'SpecialAppealR', 'SpecialAppealEndR'], ['SpecialAppealStartL', 'SpecialAppealL', 'SpecialAppealEndL']];

function enter(e: Engine): void {
  const fp = e.fighter;
  fp.mv.appealPart = 0;
  fp.mv.appealDir = fp.facing === 1 ? 0 : 1;
  fp.throwFlags = 0;
  e.changeMotion(MSID[fp.mv.appealDir][0], MF.None, 0, 1);
}

const defs: StateDef[] = MSID.flatMap((ids, dir) => ids.map((id, part): StateDef => ({
  id, name: MOVES[dir][part], move: MOVES[dir][part],
  anim(e) {
    const fp = e.fighter;
    // Throw flag b3 is where the game calls the Arwing in; there is none to call.
    fp.throwFlags &= ~(1 << 3);
    if (e.isFramesRemaining()) return;
    fp.mv.appealPart += 1;
    if (fp.mv.appealPart >= 3) waitEnter(e);
    else e.changeMotion(MSID[fp.mv.appealDir][fp.mv.appealPart], MF.None, 0, 1);
  },
  phys(e) { groundFriction(e.fighter, e.a, e.c); },
  coll: collTeeter,
})));

export function registerAppeal(kit: Kit): void {
  addStates(kit, defs);
  kit.specials.appeal = enter;
}
