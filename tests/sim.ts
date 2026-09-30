// Test helpers: build the character folders from the disc in memory and run the engine on a flat stage.
import type { Disc } from '../src/importer/disc';
import { buildFolder } from '../src/importer/pipeline';
import { effectiveFiles, type FileMap } from '../src/shared/character';
import { loadCharacter } from '../src/engine/load';
import { Engine } from '../src/engine/engine';
import { emptyPad, type PadState } from '../src/engine/pad';
import { SegKind, type StageData } from '../src/engine/stagetypes';
import type { CharacterData } from '../src/engine/types';

let folder: FileMap | null = null;
export async function foxFolder(disc: Disc): Promise<FileMap> {
  if (!folder) {
    const files = await buildFolder(disc, () => {}, () => {});
    folder = new Map(files.map((f) => [f.path, f.data]));
  }
  return folder;
}

export async function foxData(disc: Disc, overrides: FileMap = new Map()): Promise<CharacterData> {
  const all = new Map(await foxFolder(disc));
  for (const [p, d] of overrides) all.set('overrides/' + p, d);
  return loadCharacter(effectiveFiles(all), 'characters/fox/');
}

export async function falcoData(disc: Disc): Promise<CharacterData> {
  return charData(disc, 'falco');
}

/** Any imported character by id (characters/<id>/). */
export async function charData(disc: Disc, id: string): Promise<CharacterData> {
  return loadCharacter(effectiveFiles(new Map(await foxFolder(disc))), `characters/${id}/`);
}

/** Ft_Kind → character id, for reference traces (their `kind` column). */
export const KIND_IDS: Record<number, string> = { 1: 'fox', 2: 'captain', 22: 'falco' };

export async function sandbagData(disc: Disc): Promise<CharacterData> {
  return loadCharacter(effectiveFiles(new Map(await foxFolder(disc))), 'characters/sandbag/');
}

/** Final Destination's main floor: x from -85.5657 to 85.5657 at y = 0 (with walls below). */
export function finalDestination(): StageData {
  const L = -85.5657, R = 85.5657;
  return {
    segments: [
      { kind: SegKind.Floor, x0: L, y0: 0, x1: R, y1: 0, group: 1, ledges: 3 },
      { kind: SegKind.WallLeft, x0: L, y0: 0, x1: L, y1: -40, group: 1, ledges: 0 },
      { kind: SegKind.WallRight, x0: R, y0: 0, x1: R, y1: -40, group: 1, ledges: 0 },
    ],
    blast: [-246, 246, -140, 188],
    spawn: [0, 0],
  };
}

export function newEngine(data: CharacterData, x = 0): Engine {
  const e = new Engine(data);
  const st = finalDestination();
  e.setStage(st);
  e.spawnGrounded(x, st.segments[0]);
  return e;
}

/** A pad from a compact description: buttons as letters, sx/sy/cx/cy as -127..127, l/r 0..255. */
export function pad(desc: { buttons?: string; sx?: number; sy?: number; cx?: number; cy?: number; l?: number; r?: number } = {}): PadState {
  const p = emptyPad();
  const B: Record<string, number> = { A: 0x100, B: 0x200, X: 0x400, Y: 0x800, Z: 0x10, R: 0x20, L: 0x40, S: 0x1000, D: 0x4, U: 0x8 };
  for (const ch of desc.buttons ?? '') p.buttons |= B[ch] ?? 0;
  p.stickX = desc.sx ?? 0; p.stickY = desc.sy ?? 0; p.cX = desc.cx ?? 0; p.cY = desc.cy ?? 0;
  p.trigL = desc.l ?? 0; p.trigR = desc.r ?? 0;
  return p;
}
