// Loads a character folder (imported files with overrides merged on top) into runtime structures.
import type { FileData } from './db';
import { readMesh, readSkeleton, readTexture, type MaterialDef, type TextureData } from './modelfile';
import type { FighterModel } from '../render/fighter';

export type FileMap = Map<string, FileData>;

export function text(d: FileData | undefined): string | undefined {
  if (d === undefined) return undefined;
  return typeof d === 'string' ? d : new TextDecoder().decode(d);
}
export function bytes(d: FileData | undefined): Uint8Array | undefined {
  if (d === undefined) return undefined;
  return typeof d === 'string' ? new TextEncoder().encode(d) : d;
}

/** Deep-merges JSON objects: override keys replace base keys, nested objects merge. */
export function mergeJson(base: unknown, over: unknown): unknown {
  if (over && typeof over === 'object' && !Array.isArray(over) && base && typeof base === 'object' && !Array.isArray(base)) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(over as Record<string, unknown>)) out[k] = k in out ? mergeJson(out[k], v) : v;
    return out;
  }
  return over;
}

/**
 * The folder as the engine sees it: `overrides/<path>` replaces `<path>`, except JSON files, which are
 * merged key by key so an override can hold a single changed value. Disabled overrides are skipped.
 */
export function effectiveFiles(all: FileMap, disabled: Set<string> = new Set()): FileMap {
  const out: FileMap = new Map();
  for (const [p, d] of all) if (!p.startsWith('overrides/')) out.set(p, d);
  for (const [p, d] of all) {
    if (!p.startsWith('overrides/')) continue;
    const target = p.slice('overrides/'.length);
    if (disabled.has(target)) continue;
    if (target.endsWith('.json') && out.has(target)) {
      try {
        out.set(target, JSON.stringify(mergeJson(JSON.parse(text(out.get(target))!), JSON.parse(text(d)!)), null, 2));
        continue;
      } catch { /* a broken override replaces the file and fails loudly later */ }
    }
    out.set(target, d);
  }
  return out;
}

export interface CharacterInfo {
  name: string;
  id: string;
  formatVersion: number;
  modelScale: number;
  hiddenParts: number[];
  costumes: string[];
}

export function loadModel(files: FileMap, dir: string): { model: FighterModel; info: CharacterInfo } {
  const d = files.get(dir + 'character.json');
  if (d === undefined) throw new Error(`The character folder is missing ${dir}character.json. Re-import your disc.`);
  const info = JSON.parse(text(d)!) as CharacterInfo;
  return { model: loadModelDir(files, dir, info.hiddenParts), info };
}

/** A model folder (skeleton, mesh, materials and their textures), a character's or a stage part's. */
export function loadModelDir(files: FileMap, dir: string, hiddenParts: number[] = []): FighterModel {
  const need = (p: string) => {
    const d = files.get(dir + p);
    if (d === undefined) throw new Error(`The folder is missing ${dir + p}. Re-import your disc.`);
    return d;
  };
  const materials = JSON.parse(text(need('model/materials.json') ?? '')!) as MaterialDef[];
  const textures = new Map<string, TextureData>();
  for (const m of materials) if (m.texture && !textures.has(m.texture)) textures.set(m.texture, readTexture(bytes(need(m.texture))!));
  return {
    joints: readSkeleton(bytes(need('model/skeleton.skel'))!),
    mesh: readMesh(bytes(need('model/mesh.mesh'))!),
    materials,
    textures,
    hidden: new Set(hiddenParts),
  };
}
