// Dev tool: an end-to-end check in real Chrome. Loads a copy of extension/ over a CDP pipe (branded
// Chrome ignores --load-extension), imports the disc on import.html, opens tests/pages/sample.html
// from a local server, drops the fighter in, hits Sandbag with the keyboard, shoots, switches to the
// other character live and saves screenshots.
//   node tools/e2e.mjs <output folder>        (from the repo root; CHROME=<path> to pick a browser,
//                                             PAGE=<html file> for another test page,
//                                             CHARACTER=falco to start as Falco instead of Fox,
//                                             SCENARIO=ledge with PAGE=tests/pages/ledge.html to catch,
//                                             hang from and climb a ledge,
//                                             RELOAD=1 to reload the extension with the fighter on
//                                             the page and bring the new version in)
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readdirSync, cpSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const OUT = process.argv[2] ?? join(tmpdir(), 'mwf-e2e');
const CHARACTER = process.env.CHARACTER ?? 'fox';
const OTHER = CHARACTER === 'fox' ? 'falco' : 'fox';
const REPO = process.cwd();
const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const prof = join(OUT, 'e2e-prof');
rmSync(prof, { recursive: true, force: true });
mkdirSync(prof, { recursive: true });
const iso = process.env.MELEE_ISO ?? join(REPO, readdirSync(REPO).find((f) => /\.(c?iso|gcm)$/i.test(f)));
// A test copy of the extension that may also script the local test page (the real one relies on
// activeTab, which needs a real click on the toolbar button).
const ext = join(OUT, 'e2e-ext');
rmSync(ext, { recursive: true, force: true });
cpSync(join(REPO, 'extension'), ext, { recursive: true });
const man = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
man.host_permissions = [...(man.host_permissions ?? []), 'http://127.0.0.1/*'];
writeFileSync(join(ext, 'manifest.json'), JSON.stringify(man));
const server = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(readFileSync(process.env.PAGE ?? join(REPO, 'tests', 'pages', 'sample.html'))); }).listen(8765);

const chrome = spawn(CHROME, [
  '--headless=new', `--user-data-dir=${prof}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
  '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
const write = chrome.stdio[3], read = chrome.stdio[4];
let buf = '', nextId = 1;
const waiting = new Map(), listeners = [];
read.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (msg.id && waiting.has(msg.id)) { const { res, rej } = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); }
    else for (const l of listeners) l(msg);
  }
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = nextId++;
  waiting.set(id, { res, rej });
  write.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[e2e]', ...a);

async function attach(url) {
  const { targetId } = await send('Target.createTarget', { url });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  // Browser-side warnings (autoplay, deprecations) arrive here, not as console calls.
  await send('Log.enable', {}, sessionId);
  return { targetId, sessionId };
}
const evaluate = async (s, expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, s); if (r.exceptionDetails) log('eval error', JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };
async function shot(s, name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, s);
  writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
  log('screenshot', name);
}

try {
  const { id: extId } = await send('Extensions.loadUnpacked', { path: ext });
  log('extension', extId);
  listeners.push((m) => { if (m.method === 'Runtime.consoleAPICalled') log('console', m.params.type, m.params.args.map((a) => a.value ?? a.description).join(' ')); if (m.method === 'Runtime.exceptionThrown') log('exception', JSON.stringify(m.params.exceptionDetails).slice(0, 400)); if (m.method === 'Log.entryAdded' && m.params.entry.level !== 'verbose') log('browser', m.params.entry.level, m.params.entry.text.slice(0, 200)); });

  // Import the disc.
  const imp = await attach(`chrome-extension://${extId}/import.html`);
  await sleep(1500);
  const doc = await send('DOM.getDocument', {}, imp.sessionId);
  const { nodeId } = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file' }, imp.sessionId);
  await send('DOM.setFileInputFiles', { files: [iso], nodeId }, imp.sessionId);
  await evaluate(imp.sessionId, `document.getElementById('file').dispatchEvent(new Event('change')); document.getElementById('start').click(); 1`);
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    const st = await evaluate(imp.sessionId, `document.getElementById('status').textContent`);
    if (/Done|failed/i.test(st)) { log('import:', st); break; }
  }
  await shot(imp.sessionId, 'e2e-import.png');

  // A page, then the fighter (the service worker's toggle, as the toolbar button does).
  const page = await attach('http://127.0.0.1:8765/');
  await sleep(1500);
  const targets = (await send('Target.getTargets')).targetInfos;
  const sw = targets.find((t) => t.type === 'service_worker' && t.url.includes(extId));
  const { sessionId: swS } = await send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
  await send('Runtime.enable', {}, swS);
  const tabId = await evaluate(swS, `chrome.tabs.query({}).then((t) => t.find((x) => (x.url || '').startsWith('http://127.0.0.1')).id)`);
  log('tab', tabId);
  // The ledge scenario needs the way clear: no Sandbag next to the fighter.
  await evaluate(swS, `chrome.storage.local.set({ character: '${CHARACTER}', sandbag: ${process.env.SCENARIO !== 'ledge'} }).then(() => 'ok')`);
  log('character', CHARACTER);
  await evaluate(swS, `chrome.scripting.executeScript({ target: { tabId: ${tabId} }, files: ['content.js'] }).then(() => chrome.tabs.sendMessage(${tabId}, { type: 'mwf:toggle' })).then(() => 'ok', (e) => String(e))`);
  await sleep(500);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'F9', key: 'F9', windowsVirtualKeyCode: 120 }, page.sessionId);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'F9', key: 'F9', windowsVirtualKeyCode: 120 }, page.sessionId);
  await sleep(3000);
  await shot(page.sessionId, 'e2e-spawn.png');
  const key = async (code, type) => send('Input.dispatchKeyEvent', { type, code, key: code.replace('Key', '').toLowerCase(), windowsVirtualKeyCode: code.startsWith('Key') ? code.charCodeAt(3) : 0 }, page.sessionId);
  const tap = async (code, ms = 50) => { await key(code, 'keyDown'); await sleep(ms); await key(code, 'keyUp'); };
  if (process.env.SCENARIO === 'ledge') {
    // Dash right off the line, then hold left to drift back: still facing right, the fighter falls
    // past the box's top-left corner and catches it. Then climb (toward the stage), roll, and do it
    // again to jump off.
    await key('KeyD', 'keyDown'); await sleep(420); await key('KeyD', 'keyUp');
    await key('KeyA', 'keyDown'); await sleep(900); await key('KeyA', 'keyUp');
    await sleep(300);
    await shot(page.sessionId, 'e2e-ledge-hang.png');
    await tap('KeyD', 60);
    await sleep(200);
    await shot(page.sessionId, 'e2e-ledge-climbing.png');
    await sleep(1200);
    await shot(page.sessionId, 'e2e-ledge-climbed.png');
  } else {
  // Walk right (D) into Sandbag, then jab it several times (J), then a smash-ish sequence.
  await key('KeyD', 'keyDown'); await sleep(70); await key('KeyD', 'keyUp');
  await sleep(500);
  // Past Sandbag now: turn round gently (Shift = half tilt) to face it.
  await key('ShiftLeft', 'keyDown'); await key('KeyA', 'keyDown'); await sleep(60); await key('KeyA', 'keyUp'); await key('ShiftLeft', 'keyUp');
  await sleep(300);
  for (let i = 0; i < 6; i++) { await tap('KeyJ'); await sleep(120); }
  await sleep(200);
  await shot(page.sessionId, 'e2e-hit.png');
  await key('KeyA', 'keyDown'); await tap('KeyJ'); await key('KeyA', 'keyUp');
  await sleep(250);
  await shot(page.sessionId, 'e2e-smash.png');
  await sleep(1500);
  await shot(page.sessionId, 'e2e-after.png');
  // A laser (Falco's make Sandbag flinch), then the other character, picked while on the page. Falco's
  // slower dash leaves him short of Sandbag, facing away after the turn above: face it first.
  if (CHARACTER === 'falco') { await key('ShiftLeft', 'keyDown'); await key('KeyD', 'keyDown'); await sleep(60); await key('KeyD', 'keyUp'); await key('ShiftLeft', 'keyUp'); await sleep(300); }
  await tap('KeyK');
  await sleep(400);
  await shot(page.sessionId, 'e2e-laser.png');
  await evaluate(swS, `chrome.storage.local.set({ character: '${OTHER}' }).then(() => 'ok')`);
  log('switched to', OTHER);
  await sleep(2500);
  await shot(page.sessionId, 'e2e-switched.png');
  await key('KeyD', 'keyDown'); await sleep(300); await key('KeyD', 'keyUp');
  await tap('Space'); await sleep(600);
  await shot(page.sessionId, 'e2e-switched-jump.png');
  // Scroll a screen down: Sandbag is left off screen and comes back in view, at 0%.
  await evaluate(page.sessionId, 'window.scrollBy(0, 700); 1');
  await sleep(2500);
  await shot(page.sessionId, 'e2e-scrolled.png');
  }
  if (process.env.RELOAD) {
    // Reload the extension with the fighter on the page: the old copy must leave quietly (no
    // "Extension context invalidated"), and a toggle must bring in the new one.
    // As the reload arrow in chrome://extensions does: load the same folder again (same id).
    log('reloaded', (await send('Extensions.loadUnpacked', { path: ext })).id === extId ? 'with the same id' : 'with a new id');
    await sleep(3000);
    await shot(page.sessionId, 'e2e-reloaded.png');
    // The new worker starts on demand: opening one of the extension's pages wakes it.
    await attach(`chrome-extension://${extId}/options.html`);
    let sw2;
    for (let i = 0; i < 20 && !sw2; i++) {
      await sleep(250);
      sw2 = (await send('Target.getTargets')).targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(extId));
    }
    const { sessionId: sw2S } = await send('Target.attachToTarget', { targetId: sw2.targetId, flatten: true });
    await send('Runtime.enable', {}, sw2S);
    log('toggle after reload:', await evaluate(sw2S, `chrome.scripting.executeScript({ target: { tabId: ${tabId} }, files: ['content.js'] }).then(() => chrome.tabs.sendMessage(${tabId}, { type: 'mwf:toggle' })).then(() => 'ok', (e) => String(e))`));
    await send('Target.activateTarget', { targetId: page.targetId });
    await sleep(3000);
    await shot(page.sessionId, 'e2e-after-reload.png');
  }
} catch (e) {
  log('error', e.stack);
} finally {
  chrome.kill();
  server.close();
  process.exit(0);
}
