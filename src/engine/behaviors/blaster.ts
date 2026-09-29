// Fox's and Falco's neutral special (blaster), ported from ft/kinds/ftFox/ftfoxspecialn.c. Pressing B again during
// the loop keeps shooting; each shot is fired when the script sets var 2. Shots fly straight at the
// blaster angle for the laser article's lifetime; they are drawn, and pass through the page.
import type { Engine } from '../engine';
import { MF } from '../engine';
import { BTN } from '../pad';
import { GA } from '../types';
import { STATES, specials, collAirLand, collFallOff, fallEnter, fallSpecialEnter, landFromAir, waitEnter, type StateDef } from '../states';
import { airPhysics, groundFriction } from '../physics';

export const FX_N = { Start: 341, Loop: 342, End: 343, AirStart: 344, AirLoop: 345, AirEnd: 346 } as const;

/** FtPart_RThumbNb: the blaster sits in Fox's right hand. */
const RTHUMB_NB = 49;
/** foxSFX / falcoSFX: the shot's sound facing right, then facing left. */
const LASER_SOUNDS: Record<string, [number, number]> = { fox: [110103, 110106], falco: [100099, 100102] };

function init(e: Engine): void {
  const fp = e.fighter;
  fp.cmdVars[0] = fp.cmdVars[1] = fp.cmdVars[2] = fp.cmdVars[3] = 0;
  e.animStep();
  fp.mv.blasterLoop = 0;
}

function groundEnter(e: Engine): void {
  const fp = e.fighter;
  if (fp.ga === GA.Air) e.toGround();
  e.changeMotion(FX_N.Start, MF.None, 0, 1);
  init(e);
  fp.grVel = 0;
  fp.selfVel.x = fp.selfVel.y = 0;
}

function airEnter(e: Engine): void {
  e.changeMotion(FX_N.AirStart, MF.None, 0, 1);
  init(e);
}

/** ftFx_SpecialN_CreateBlasterShot: the script sets var 2 on the frame a shot leaves the gun. */
function fireCheck(e: Engine): void {
  const fp = e.fighter, s = e.data.special;
  if (!fp.cmdVars[2]) return;
  fp.cmdVars[2] = 0;
  const [x, y] = e.jointPoint(e.data.parts[RTHUMB_NB] ?? 0, 0, 1.2325000762939453, 4.263599872589111);
  const angle = fp.facing === 1 ? s.blaster_angle : Math.PI - s.blaster_angle;
  e.fireProjectile('laser', x, y, angle, s.blaster_velocity, e.data.articles.laser?.lifetime ?? 35);
  const sounds = LASER_SOUNDS[e.data.id];
  if (sounds) e.playSound(sounds[fp.facing === -1 ? 1 : 0]);
}

/** ftFox_SpecialN_CheckLoopInput: B again once the script allows it (var 0) keeps the loop going. */
function loopInput(e: Engine): void {
  const fp = e.fighter;
  if (fp.cmdVars[0] && (fp.input.pressed & BTN.B)) fp.mv.blasterLoop = 1;
}

function startAnim(loop: number) {
  return (e: Engine) => {
    if (!e.isFramesRemaining()) e.changeMotion(loop, MF.KeepGfx, 0, 1);
    fireCheck(e);
  };
}

function loopAnim(loop: number, end: number) {
  return (e: Engine) => {
    const fp = e.fighter;
    if (!e.isFramesRemaining()) {
      if (fp.mv.blasterLoop) {
        e.changeMotion(loop, MF.KeepGfx, 0, 1);
        fp.mv.blasterLoop = 0;
      } else {
        e.changeMotion(end, MF.KeepGfx, 0, 1);
        fp.cmdVars[1] = 1;
      }
    }
    fireCheck(e);
  };
}

const groundPhys = (e: Engine) => groundFriction(e.fighter, e.a, e.c);
const airPhys = (e: Engine) => airPhysics(e.fighter, e.a, e.c, (id) => e.playSound(id));
/** ftCo_AirCatchHit_Coll: an aerial laser lands straight into Wait or Landing. */
const airColl = (e: Engine) => collAirLand(e, landFromAir);

const defs: StateDef[] = [
  { id: FX_N.Start, name: 'SpecialNStart', move: 'SpecialNStart', anim: startAnim(FX_N.Loop), iasa: loopInput, phys: groundPhys, coll: collFallOff },
  { id: FX_N.Loop, name: 'SpecialNLoop', move: 'SpecialNLoop', anim: loopAnim(FX_N.Loop, FX_N.End), iasa: loopInput, phys: groundPhys, coll: collFallOff },
  {
    id: FX_N.End, name: 'SpecialNEnd', move: 'SpecialNEnd',
    anim(e) { if (!e.isFramesRemaining()) waitEnter(e); },
    phys: groundPhys, coll: collFallOff,
  },
  { id: FX_N.AirStart, name: 'SpecialAirNStart', move: 'SpecialAirNStart', anim: startAnim(FX_N.AirLoop), iasa: loopInput, phys: airPhys, coll: airColl },
  { id: FX_N.AirLoop, name: 'SpecialAirNLoop', move: 'SpecialAirNLoop', anim: loopAnim(FX_N.AirLoop, FX_N.AirEnd), iasa: loopInput, phys: airPhys, coll: airColl },
  {
    id: FX_N.AirEnd, name: 'SpecialAirNEnd', move: 'SpecialAirNEnd',
    anim(e) {
      if (e.isFramesRemaining()) return;
      const lag = e.data.special.blaster_landing_lag;
      if (!lag) fallEnter(e);
      else fallSpecialEnter(e, 1, 0, true, 1, lag);
    },
    phys: airPhys, coll: airColl,
  },
];

let registered = false;
export function registerBlaster(): void {
  if (registered) return;
  registered = true;
  for (const d of defs) STATES.set(d.id, d);
  specials.groundN = groundEnter;
  specials.airN = airEnter;
}
