// Behavior modules by the name a .move file gives them (`behavior shine`). Adding a character with its
// own special logic means adding a module here, never touching the engine core.
import { registerShine } from './shine';

export const BEHAVIORS: Record<string, () => void> = {
  shine: registerShine,
};
