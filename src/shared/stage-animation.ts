import type { Track } from '../render/fobj';

/** A stage uses independent AObjs, each with its own duration and loop flag. */
export interface StageTrackGroup {
  target: 'joint' | 'material' | 'texture';
  index: number;
  duration: number;
  loop: boolean;
  tracks: Track[];
}
export interface StageAnimation { groups: StageTrackGroup[] }

export function writeStageAnimation(animation: StageAnimation): string {
  return JSON.stringify(animation, (_key, value) => value instanceof Uint8Array ? Array.from(value) : value);
}
export function readStageAnimation(json: string): StageAnimation {
  return JSON.parse(json, (key, value) => key === 'bytes' ? new Uint8Array(value) : value);
}
