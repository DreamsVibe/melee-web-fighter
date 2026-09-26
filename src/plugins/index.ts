// Plugins enabled in the settings page, in a fixed order.
import type { Plugin } from '../engine/types';
import type { Settings } from '../shared/settings';
import { moonGravity } from './moon-gravity';

const ALL: Plugin[] = [moonGravity];

export function pluginsFor(settings: Settings): Plugin[] {
  return ALL.filter((p) => settings.plugins[p.id]);
}
