// Behavior modules by the name a .move file gives them (`behavior shine`). Adding a character with its
// own special logic means adding a module here, never touching the engine core. Each adds its states
// and special entry points to the kit of the character whose moves name it.
import type { Kit } from '../statedefs';
import { registerShine } from './shine';
import { registerBlaster } from './blaster';
import { registerIllusion } from './illusion';
import { registerFirefox } from './firefox';
import { registerAppeal } from './appeal';
import { registerFalconPunch, registerRaptorBoost, registerFalconDive, registerFalconKick } from './captain';

export const BEHAVIORS: Record<string, (kit: Kit) => void> = {
  shine: registerShine,
  blaster: registerBlaster,
  illusion: registerIllusion,
  firefox: registerFirefox,
  appeal: registerAppeal,
  falconpunch: registerFalconPunch,
  raptorboost: registerRaptorBoost,
  falcondive: registerFalconDive,
  falconkick: registerFalconKick,
};
