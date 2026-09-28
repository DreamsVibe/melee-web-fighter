// Settings page: adapter helper status, mapping, display/sound, plugins, overrides (edit, toggle, zip).
import { DEFAULT_KEYBOARD, KEY_ACTIONS, loadSettings, saveSettings, type GamepadMapping, type KeyAction, type Settings } from '../shared/settings';
import { ADAPTER_PORT, describeAdapter, type AdapterMessage } from '../shared/adapter-link';
import { AdapterDecoder, BTN, emptyPad } from '../engine/pad';
import { announceChange, deleteFiles, getFile, listFiles, putFiles, asText } from '../shared/db';
import { mergeJson, text } from '../shared/character';
import { readZip, writeZip } from '../shared/zip';
import { parseMove } from '../shared/move';
import { PLUGIN_INFO } from '../plugins/info';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let settings: Settings;

function download(name: string, data: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Live adapter status and what each plugged-in controller is pressing, straight from the helper. */
function watchAdapter(): void {
  const state = $('adapterState'), input = $('adapterInput');
  const port = chrome.runtime.connect({ name: ADAPTER_PORT });
  const decoder = new AdapterDecoder();
  const pad = emptyPad();
  let lastDraw = 0;
  port.onMessage.addListener((m: AdapterMessage) => {
    if (m.type === 'status') {
      state.textContent = describeAdapter(m.s, m.d);
      state.className = m.s === 'connected' ? '' : 'muted';
      if (m.s !== 'connected') input.textContent = '';
      return;
    }
    const now = performance.now();
    if (now - lastDraw < 50) return;
    lastDraw = now;
    const lines: string[] = [];
    for (let p = 0; p < 4; p++) {
      if (!decoder.decode(new Uint8Array(m.r), p, pad)) continue;
      const held = Object.entries(BTN).filter(([, bit]) => pad.buttons & bit).map(([name]) => name).join(' ') || '—';
      lines.push(`Port ${p + 1}: stick ${pad.stickX},${pad.stickY}  C ${pad.cX},${pad.cY}  L ${pad.trigL} R ${pad.trigR}  ${held}`);
    }
    input.textContent = lines.join('\n') || 'No controller plugged into the adapter.';
  });
  port.onDisconnect.addListener(() => setTimeout(watchAdapter, 1000));
}

async function init(): Promise<void> {
  settings = await loadSettings();
  const imported = await getFile('characters/fox/character.json');
  $('importState').innerHTML = imported
    ? 'Fox is imported. <a href="import.html">Re-import or preview</a>.'
    : '<b>Fox is not imported yet:</b> <a href="import.html">import your Melee disc</a> first.';

  // --- controller
  const port = $<HTMLSelectElement>('port');
  port.value = String(settings.adapterPort);
  port.onchange = () => void saveSettings({ adapterPort: Number(port.value) });
  $('installCmd').textContent = `powershell -ExecutionPolicy Bypass -File helper\\install.ps1 -ExtensionId ${chrome.runtime.id}`;
  watchAdapter();
  renderMapping();
  renderKeys();
  $('resetKeys').onclick = async () => {
    settings.keyboard = DEFAULT_KEYBOARD;
    await saveSettings({ keyboard: settings.keyboard });
    $('keysMsg').textContent = 'Keyboard reset to defaults.';
    renderKeys();
  };

  // --- display
  const height = $<HTMLInputElement>('height');
  height.value = String(settings.fighterHeightPx);
  height.onchange = () => void saveSettings({ fighterHeightPx: Math.max(30, Math.min(400, Number(height.value) || 90)) });
  const volume = $<HTMLInputElement>('volume');
  volume.value = String(settings.volume);
  volume.oninput = () => void saveSettings({ volume: Number(volume.value) });
  const debug = $<HTMLInputElement>('debug');
  debug.checked = settings.debug;
  debug.onchange = () => void saveSettings({ debug: debug.checked });

  // --- plugins
  $('plugins').replaceChildren(...PLUGIN_INFO.map((p) => {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!settings.plugins[p.id];
    box.onchange = async () => { settings.plugins = { ...settings.plugins, [p.id]: box.checked }; await saveSettings({ plugins: settings.plugins }); };
    label.append(box, ` ${p.name} `);
    const d = document.createElement('span'); d.className = 'muted'; d.textContent = `— ${p.description}`;
    label.append(d);
    return label;
  }));

  await renderOverrides();
  await fillFileSelect();
  $('edit').onclick = () => void openEditor($<HTMLSelectElement>('fileSelect').value);
  $('close').onclick = () => { $('editor').hidden = true; };
  $('save').onclick = () => void saveEditor();
  $('revert').onclick = () => void removeOverride($('editPath').textContent!);
  $('exportOverrides').onclick = async () => {
    const files = (await listFiles('overrides/')).map((f) => ({ path: f.path.slice('overrides/'.length), data: f.data }));
    download('melee-web-fighter-overrides.zip', writeZip(files));
  };
  $<HTMLInputElement>('importOverrides').onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const entries = await readZip(new Uint8Array(await file.arrayBuffer()));
    const files = entries
      .map((en) => ({ path: 'overrides/' + en.path.replace(/^overrides\//, ''), data: en.path.endsWith('.json') || en.path.endsWith('.move') ? new TextDecoder().decode(en.data) : en.data }))
      .filter((f) => /^overrides\/(characters|common)\//.test(f.path));
    await putFiles(files);
    announceChange(files.map((f) => f.path));
    await renderOverrides();
    alert(`Imported ${files.length} override file(s).`);
  };
  $('exportFolder').onclick = async () => {
    const files = (await listFiles()).filter((f) => /^(characters|common)\//.test(f.path));
    download('fox-folder.zip', writeZip(files.map((f) => ({ path: f.path, data: f.data }))));
  };
}

// ---------------------------------------------------------------- gamepad mapping
const GC_BUTTONS: Array<keyof GamepadMapping> = ['a', 'b', 'x', 'y', 'z', 'l', 'r', 'start', 'dpadDown', 'dpadUp'];
function renderMapping(): void {
  const t = $<HTMLTableElement>('mapping');
  t.replaceChildren(...GC_BUTTONS.map((b) => {
    const tr = document.createElement('tr');
    const btn = document.createElement('button');
    btn.textContent = 'remap';
    btn.onclick = () => waitForPadButton(btn).then(async (idx) => {
      if (idx === null) return;
      settings.gamepad = { ...settings.gamepad, [b]: idx };
      await saveSettings({ gamepad: settings.gamepad });
      renderMapping();
  renderKeys();
  $('resetKeys').onclick = async () => {
    settings.keyboard = DEFAULT_KEYBOARD;
    await saveSettings({ keyboard: settings.keyboard });
    $('keysMsg').textContent = 'Keyboard reset to defaults.';
    renderKeys();
  };
    });
    tr.innerHTML = `<td><b>${b.toUpperCase()}</b></td><td>pad button ${settings.gamepad[b]}</td>`;
    const td = document.createElement('td'); td.append(btn); tr.append(td);
    return tr;
  }));
}

function waitForPadButton(btn: HTMLButtonElement): Promise<number | null> {
  btn.textContent = 'press a pad button…';
  const t0 = performance.now();
  return new Promise((resolve) => {
    const poll = () => {
      for (const gp of navigator.getGamepads()) {
        if (!gp) continue;
        const i = gp.buttons.findIndex((b) => b.pressed);
        if (i >= 0) { btn.textContent = 'remap'; resolve(i); return; }
      }
      if (performance.now() - t0 > 8000) { btn.textContent = 'remap'; resolve(null); return; }
      requestAnimationFrame(poll);
    };
    poll();
  });
}

// ---------------------------------------------------------------- keyboard mapping
const KEY_LABELS: Record<KeyAction, string> = {
  up: 'Stick up', down: 'Stick down', left: 'Stick left', right: 'Stick right', walk: 'Walk (half tilt, hold)',
  a: 'A', b: 'B (specials)', x: 'X (jump)', y: 'Y (jump)', z: 'Z', l: 'L', r: 'R (air dodge, L-cancel)', start: 'Start',
  dpadUp: 'D-pad up (taunt)', dpadDown: 'D-pad down (Arwing taunt)',
  cUp: 'C-stick up', cDown: 'C-stick down', cLeft: 'C-stick left', cRight: 'C-stick right',
};
const ARROWS: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };

function keyName(code: string): string {
  if (ARROWS[code]) return ARROWS[code];
  const m = /^(Key|Digit)(.)$/.exec(code);
  if (m) return m[2];
  return code.replace(/^Numpad/, 'Num ').replace(/^(Shift|Control|Alt|Meta)(Left|Right)$/, '$2 $1');
}

function renderKeys(): void {
  const t = $<HTMLTableElement>('keys');
  t.replaceChildren(...KEY_ACTIONS.map((action) => {
    const tr = document.createElement('tr');
    const name = document.createElement('td'); name.innerHTML = `<b>${KEY_LABELS[action]}</b>`;
    const keys = document.createElement('td');
    const bound = settings.keyboard[action];
    if (!bound.length) keys.innerHTML = '<span class="muted">unbound</span>';
    for (const code of bound) {
      const chip = document.createElement('button');
      chip.textContent = `${keyName(code)} ×`;
      chip.title = `Unbind ${code}`;
      chip.onclick = () => void setKeys({ [action]: bound.filter((c) => c !== code) }, `Unbound ${keyName(code)}.`);
      keys.append(chip, ' ');
    }
    const add = document.createElement('button');
    add.textContent = 'add key';
    add.onclick = () => waitForKey(add).then((code) => {
      if (code === null) { $('keysMsg').textContent = ''; return; }
      if (code === 'F9') { $('keysMsg').textContent = 'F9 is the debug draw toggle; pick another key.'; return; }
      if (/^(Control|Alt|Meta|OS)/.test(code)) { $('keysMsg').textContent = "Ctrl, Alt and the Windows key can't be bound: they're left to the browser's shortcuts."; return; }
      if (bound.includes(code)) { $('keysMsg').textContent = ''; return; }
      const patch: Partial<Record<KeyAction, string[]>> = {};
      const from = KEY_ACTIONS.filter((a) => a !== action && settings.keyboard[a].includes(code));
      for (const a of from) patch[a] = settings.keyboard[a].filter((c) => c !== code);
      patch[action] = [...bound, code];
      const moved = from.length ? ` (moved from ${from.map((a) => KEY_LABELS[a]).join(', ')})` : '';
      void setKeys(patch, `${keyName(code)} → ${KEY_LABELS[action]}${moved}.`);
    });
    const td = document.createElement('td'); td.append(add);
    tr.append(name, keys, td);
    return tr;
  }));
}

async function setKeys(patch: Partial<Record<KeyAction, string[]>>, msg: string): Promise<void> {
  settings.keyboard = { ...settings.keyboard, ...patch };
  await saveSettings({ keyboard: settings.keyboard });
  $('keysMsg').textContent = msg;
  renderKeys();
}

/** The next key pressed (its KeyboardEvent.code), or null on Escape, a click elsewhere, or 8 s idle. */
function waitForKey(btn: HTMLButtonElement): Promise<string | null> {
  btn.textContent = 'press a key… (Esc cancels)';
  return new Promise((resolve) => {
    const done = (code: string | null) => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
      clearTimeout(timer);
      btn.textContent = 'add key';
      resolve(code);
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      done(e.code === 'Escape' || !e.code ? null : e.code);
    };
    const onPointer = () => done(null);
    const timer = setTimeout(() => done(null), 8000);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
  });
}

// ---------------------------------------------------------------- overrides
async function renderOverrides(): Promise<void> {
  const files = await listFiles('overrides/');
  const t = $<HTMLTableElement>('overrides');
  if (!files.length) { t.innerHTML = '<tr><td class="muted">No overrides yet. Pick a file below and edit it.</td></tr>'; return; }
  t.replaceChildren(...files.map((f) => {
    const target = f.path.slice('overrides/'.length);
    const tr = document.createElement('tr');
    const on = document.createElement('input');
    on.type = 'checkbox';
    on.checked = !settings.disabledOverrides.includes(target);
    on.onchange = async () => {
      settings.disabledOverrides = on.checked ? settings.disabledOverrides.filter((p) => p !== target) : [...settings.disabledOverrides, target];
      await saveSettings({ disabledOverrides: settings.disabledOverrides });
    };
    const td1 = document.createElement('td'); td1.append(on);
    const td2 = document.createElement('td'); td2.innerHTML = `<code>${target}</code> <span class="muted">${new Date(f.mtime).toLocaleString()}</span>`;
    const edit = document.createElement('button'); edit.textContent = 'edit'; edit.onclick = () => void openEditor(target);
    const del = document.createElement('button'); del.textContent = 'delete'; del.onclick = () => void removeOverride(target);
    const td3 = document.createElement('td'); td3.append(edit, ' ', del);
    tr.append(td1, td2, td3);
    return tr;
  }));
}

async function fillFileSelect(): Promise<void> {
  const files = (await listFiles()).filter((f) => /^(characters|common)\/.*\.(json|move)$/.test(f.path));
  $('fileSelect').replaceChildren(...files.map((f) => new Option(f.path, f.path)));
  const sel = $<HTMLSelectElement>('fileSelect');
  if (files.some((f) => f.path === 'characters/fox/attributes.json')) sel.value = 'characters/fox/attributes.json';
}

async function openEditor(path: string): Promise<void> {
  const base = asText(await getFile(path));
  const over = asText(await getFile('overrides/' + path));
  let shown = over ?? base ?? '';
  if (path.endsWith('.json') && base && over) shown = JSON.stringify(mergeJson(JSON.parse(base), JSON.parse(over)), null, 2);
  $('editPath').textContent = path;
  $('editMsg').textContent = over ? '(showing your override merged over the import)' : '(imported data — saving creates an override)';
  $<HTMLTextAreaElement>('editText').value = shown;
  $('editor').hidden = false;
}

/** Keys of `edited` that differ from `base`, recursively (the override stores only these). */
function jsonDiff(base: unknown, edited: unknown): unknown {
  if (edited && typeof edited === 'object' && !Array.isArray(edited) && base && typeof base === 'object' && !Array.isArray(base)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(edited)) {
      const d = jsonDiff((base as Record<string, unknown>)[k], v);
      if (d !== undefined) out[k] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return JSON.stringify(base) === JSON.stringify(edited) ? undefined : edited;
}

async function saveEditor(): Promise<void> {
  const path = $('editPath').textContent!;
  const edited = $<HTMLTextAreaElement>('editText').value;
  let data = edited;
  try {
    if (path.endsWith('.json')) {
      const base = asText(await getFile(path));
      const diff = base ? jsonDiff(JSON.parse(base), JSON.parse(edited)) : JSON.parse(edited);
      if (diff === undefined) { await removeOverride(path); return; }
      data = JSON.stringify(diff, null, 2) + '\n';
    } else if (path.endsWith('.move')) {
      const soundsJson = [...await listFiles()].filter((f) => f.path.endsWith('sounds/sounds.json'));
      const names = new Map<string, number>();
      for (const f of soundsJson) for (const [id, d] of Object.entries(JSON.parse(text(f.data)!))) names.set((d as { name: string }).name, Number(id));
      parseMove(edited, (n) => {
        const id = names.get(n) ?? Number(n);
        if (Number.isNaN(id)) throw new Error(`unknown sound "${n}"`);
        return id;
      });
    }
  } catch (e) {
    $('editMsg').textContent = `Not saved: ${(e as Error).message}`;
    return;
  }
  await putFiles([{ path: 'overrides/' + path, data }]);
  announceChange(['overrides/' + path]);
  $('editMsg').textContent = 'Saved. Fox reloads it live.';
  await renderOverrides();
}

async function removeOverride(path: string): Promise<void> {
  await deleteFiles(['overrides/' + path]);
  announceChange(['overrides/' + path]);
  $('editor').hidden = true;
  await renderOverrides();
}

void init();
