// Applies an animation at a frame to a local pose (9 floats per joint: rot, scale, pos).
import { sampleTrack } from './fobj';
import type { AnimData } from '../shared/animfile';

const CHANNEL_SLOT: Record<number, number> = { 1: 0, 2: 1, 3: 2, 8: 3, 9: 4, 10: 5, 5: 6, 6: 7, 7: 8 };

export function applyAnim(anim: AnimData, frame: number, local: Float32Array): void {
  const n = Math.min(anim.tracks.length, local.length / 9);
  for (let j = 0; j < n; j++) {
    for (const t of anim.tracks[j]) {
      const slot = CHANNEL_SLOT[t.channel];
      if (slot === undefined) continue;
      const v = sampleTrack(t, frame);
      if (v !== undefined) local[j * 9 + slot] = v;
    }
  }
}
