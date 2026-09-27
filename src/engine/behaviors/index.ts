// Behavior modules by the name a .move file gives them (`behavior shine`). Adding a character with its
// own special logic means adding a module here, never touching the engine core.
import { registerShine } from './shine';
import { registerBlaster } from './blaster';
import { registerIllusion } from './illusion';
import { registerFirefox } from './firefox';
import { registerAppeal } from './appeal';

export const BEHAVIORS: Record<string, () => void> = {
  shine: registerShine,
  blaster: registerBlaster,
  illusion: registerIllusion,
  firefox: registerFirefox,
  appeal: registerAppeal,
};
