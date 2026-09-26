// Test cases. Each either needs the user's disc (read via tests/run.ts) or runs on its own.
import type { Disc } from '../src/importer/disc';
import { Archive } from '../src/importer/hsd';
import { readActionTable } from '../src/importer/actions';
import { scriptBody } from '../src/importer/moves-convert';
import { encodeMove, formatMove, parseMove, type Cmd } from '../src/shared/move';

export interface Test { name: string; needsDisc?: boolean; run(disc: Disc): Promise<void> | void }
export const tests: Test[] = [];
const test = (name: string, run: Test['run'], needsDisc = false) => tests.push({ name, run, needsDisc });

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const cache = new Map<string, Uint8Array>();
export async function discFile(disc: Disc, path: string): Promise<Uint8Array> {
  if (!cache.has(path)) cache.set(path, await disc.readFile(path));
  return cache.get(path)!;
}

test('move scripts round-trip exactly through .move text', async (disc) => {
  const plfx = new Archive(await discFile(disc, 'PlFx.dat'));
  let checked = 0, commands = 0;
  for (const act of readActionTable(plfx)) {
    if (!act.script) continue;
    const { body, raw } = scriptBody(plfx, act.script);
    // 1. decode fidelity: re-encoding the decoded commands gives the original words, except jump
    //    targets, which become word offsets inside the move.
    const direct = encodeMove(body);
    const flat = raw.flat();
    const isJumpWord = new Set<number>();
    let pos = 0;
    for (const words of raw) {
      const op = words[0] >>> 26;
      if (op === 5 || op === 7) isJumpWord.add(pos + 1);
      pos += words.length;
    }
    for (let i = 0; i < flat.length; i++) {
      if (isJumpWord.has(i)) continue;
      assert(direct[i] === flat[i] >>> 0, `action ${act.index} (${act.anim}): word ${i} decodes to 0x${direct[i]?.toString(16)}, disc has 0x${flat[i].toString(16)}`);
    }
    // 2. text fidelity: format → parse → encode is identical.
    const text = formatMove({ name: `a${act.index}`, animation: act.anim || null, body }, (id) => String(id));
    const back = parseMove(text, (n) => Number(n));
    const again = encodeMove(back.body);
    assert(again.length === direct.length && again.every((w, i) => w === direct[i]), `action ${act.index} (${act.anim}): text round trip differs\n${text}`);
    checked++;
    commands += body.filter((c: Cmd) => c.op !== 'label').length;
  }
  assert(checked > 250, `only ${checked} scripts checked`);
  console.log(`      ${checked} scripts, ${commands} commands`);
}, true);

test('override layer merges JSON keys and replaces other files', async () => {
  const { effectiveFiles } = await import('../src/shared/character');
  const all = new Map<string, string>([
    ['characters/fox/attributes.json', JSON.stringify({ gravity: 0.23, walk_max_vel: 1.6, special: { reflector_release_lag: 18 } })],
    ['characters/fox/moves/AttackAirN.move', 'move AttackAirN\n'],
    ['overrides/characters/fox/attributes.json', JSON.stringify({ gravity: 0.1, special: { reflector_release_lag: 1 } })],
    ['overrides/characters/fox/moves/AttackAirN.move', 'move AttackAirN\nframe 1 iasa\n'],
  ]);
  const eff = effectiveFiles(all);
  const attrs = JSON.parse(eff.get('characters/fox/attributes.json') as string);
  assert(attrs.gravity === 0.1 && attrs.walk_max_vel === 1.6 && attrs.special.reflector_release_lag === 1, 'JSON override did not merge key by key');
  assert((eff.get('characters/fox/moves/AttackAirN.move') as string).includes('iasa'), '.move override did not replace the file');
  const off = effectiveFiles(all, new Set(['characters/fox/attributes.json']));
  assert(JSON.parse(off.get('characters/fox/attributes.json') as string).gravity === 0.23, 'disabled override still applied');
});

test('zip writer and reader round-trip', async () => {
  const { writeZip, readZip } = await import('../src/shared/zip');
  const files = [{ path: 'a/b.json', data: '{"x":1}' }, { path: 'c.bin', data: new Uint8Array([0, 1, 2, 255]) }];
  const back = await readZip(writeZip(files));
  assert(back.length === 2 && new TextDecoder().decode(back[0].data) === '{"x":1}' && back[1].data[3] === 255, 'zip round trip failed');
});
