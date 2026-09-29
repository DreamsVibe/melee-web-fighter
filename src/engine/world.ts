// Several fighters on one stage. The game runs its procs by priority across every fighter (and item)
// before moving to the next priority (ft/fighter.c Fighter_Create, it/item.c): hitlag 0, animation 1,
// input 3, physics 4 (then items' physics), map collision 6, hitbox positions 9, attack collision 13,
// damage 14. World.step does the same with each fighter's engine.
import type { Engine } from './engine';
import type { PadState } from './pad';
import { emptyPad } from './pad';
import type { StageData } from './stagetypes';
import { attackColl, collResolve } from './hits';

export class World {
  readonly fighters: Engine[] = [];
  frame = 0;
  /** Where a fighter comes back after a KO (the default is the stage's spawn point). */
  respawn: ((e: Engine) => [number, number]) | null = null;
  private idle = emptyPad();

  /** Adds a fighter, last or at index `at` (fighter i is driven by pad i). */
  add(e: Engine, at = this.fighters.length): Engine {
    e.world = this;
    this.fighters.splice(at, 0, e);
    return e;
  }

  remove(e: Engine): void {
    const i = this.fighters.indexOf(e);
    if (i >= 0) this.fighters.splice(i, 1);
    e.world = null;
  }

  setStage(stage: StageData): void {
    for (const e of this.fighters) e.setStage(stage);
  }

  spawnPoint(e: Engine): [number, number] {
    return this.respawn?.(e) ?? e.stage.spawn;
  }

  /** One frame. `pads[i]` drives fighter i; fighters without a pad (Sandbag) get an idle one. */
  step(pads: PadState[]): void {
    const all = this.fighters;
    this.frame++;
    all.forEach((e, i) => e.beginFrame(pads[i] ?? this.idle));
    for (const e of all) e.procHitlag();
    for (const e of all) e.procAnim();
    for (const e of all) e.itemsAnim();
    for (const e of all) e.procInput();
    for (const e of all) e.procUpdate();
    for (const e of all) e.itemsPhys();
    for (const e of all) e.procMap();
    for (const e of all) e.collPos();
    for (const e of all) attackColl(e, all);
    for (const e of all) collResolve(e);
    for (const e of all) e.endFrame();
  }
}
