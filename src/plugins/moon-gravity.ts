// Example plugin: moon gravity. Uses only the plugin hooks (attributes, render), never the engine
// internals: a sixth of Fox's gravity, gentler falls, and a small moon in the debug view.
import type { Plugin } from '../engine/types';

export const moonGravity: Plugin = {
  id: 'moon-gravity',
  attributes(_api, a) {
    return {
      gravity: Math.fround(a.gravity / 6),
      terminal_velocity: Math.fround(a.terminal_velocity / 2.5),
      fast_fall_velocity: Math.fround(a.fast_fall_velocity / 2.5),
    };
  },
  render(api, ctx, toClient) {
    const [x, y] = toClient(api.fighter.pos.x, api.fighter.pos.y + 22);
    ctx.save();
    ctx.fillStyle = '#e8e4d0';
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.arc(x + 4, y - 2, 7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },
};
