// Melee's stages the extension knows about. Each is read from the user's own disc at import (its
// Gr*.dat) into stages/<id>/: stage.json (collision, spawn points, blast zones, camera range) and
// its model parts. Only the ones with `ready` are converted so far.
import type { Segment } from '../engine/stagetypes';

export interface StageEntry { id: string; name: string; file: string; ready: boolean }

export const STAGE_LIST: StageEntry[] = [
  { id: 'fd', name: 'Final Destination', file: 'GrNLa.dat', ready: true },
  { id: 'battlefield', name: 'Battlefield', file: 'GrNBa.dat', ready: true },
  { id: 'dreamland', name: 'Dream Land', file: 'GrOp.dat', ready: false },
  { id: 'yoshis', name: "Yoshi's Story", file: 'GrSt.dat', ready: false },
  { id: 'fountain', name: 'Fountain of Dreams', file: 'GrIz.dat', ready: false },
  { id: 'stadium', name: 'Pokémon Stadium', file: 'GrPs.dat', ready: false },
];

export const stageDir = (id: string) => `stages/${id}/`;

/** stage.json. Points are [x, y] in Melee units; boxes are [left, right, bottom, top]. */
export interface StageFile {
  id: string;
  name: string;
  formatVersion: number;
  segments: Segment[];
  /** Player start points (general points 0-3) and revival points (4-7). */
  spawns: Array<[number, number]>;
  respawns: Array<[number, number]>;
  /** Blast zones (points 0x97/0x98) and the camera's range (0x95/0x96). */
  blast: [number, number, number, number];
  camera: [number, number, number, number];
  /** Model parts (map_head +8 gobjs): folders laid out like a character's (model/, textures/). */
  models: string[];
  /** Ground parameter scale; collision and points are already in world units. */
  modelScale?: number;
  /** Battlefield scene parts and transition timing (frames at 60 Hz). */
  background?: { scenes: string[]; transition: string; waitMin: number; waitRange: number; fadeFrames: number };
}
