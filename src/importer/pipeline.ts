// The import pipeline: disc → Fox's files → character folder in IndexedDB.
import { Disc } from './disc';
import { putFiles, deletePrefix, FORMAT_VERSION, META_PATH, type FileData } from '../shared/db';

export type Progress = (fraction: number, text: string) => void;
export type Log = (line: string) => void;

/** Disc files Fox needs. Sound banks are English (NTSC default language). */
export const SOURCE_FILES = [
  'PlFx.dat', 'PlFxNr.dat', 'PlFxAJ.dat', 'PlCo.dat',
  'audio/us/smash2.sem', 'audio/us/main.ssm', 'audio/us/fox.ssm',
] as const;

export async function extractSources(disc: Disc, progress: Progress, log: Log): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  let i = 0;
  for (const path of SOURCE_FILES) {
    progress(0.05 + 0.35 * (i++ / SOURCE_FILES.length), `Reading ${path}…`);
    const data = await disc.readFile(path);
    out.set(path, data);
    log(`read ${path} (${(data.length / 1024).toFixed(0)} KB)`);
  }
  return out;
}

export async function runImport(disc: Disc, progress: Progress, log: Log): Promise<{ files: number; bytes: number }> {
  const sources = await extractSources(disc, progress, log);
  progress(0.5, 'Storing…');
  const files: Array<{ path: string; data: FileData }> = [];
  for (const [path, data] of sources) files.push({ path: 'raw/' + path, data });
  files.push({ path: META_PATH, data: JSON.stringify({ formatVersion: FORMAT_VERSION, importedAt: new Date().toISOString(), disc: `${disc.gameId} rev ${disc.revision}` }) });
  await deletePrefix('raw/');
  await putFiles(files);
  const bytes = files.reduce((s, f) => s + (typeof f.data === 'string' ? f.data.length : f.data.length), 0);
  return { files: files.length, bytes };
}
