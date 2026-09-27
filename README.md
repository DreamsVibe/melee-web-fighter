# Melee Web Fighter

A Chrome extension that drops Fox from Super Smash Bros. Melee onto any webpage. Every line of text,
image and box on the page is a platform along its top edge: you can stand on it and drop through it
(tap down, or hold down while falling), and nothing on the page is a wall or a floor you can get stuck
under. You play him with a GameCube controller (through the official adapter), a standard gamepad or
the keyboard. Fox never changes the page: his attacks, lasers and everything else are drawn on his
own overlay.

The extension is code only (about 210 KB). Fox's model, animations, sounds, attributes and move
scripts are extracted in your browser from **your own** NTSC 1.02 disc image and stored locally in
IndexedDB. Nothing from the disc is in this repository or ever leaves your machine.

## Setup

1. Build: `npm install`, then `npm run build`. The unpacked extension ends up in `dist/`, and the
   build prints a size report checked against the 300 KB budget.
2. Load it: open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick `dist/`.
3. Import your disc: the import page opens on install (it is also linked from the settings page).
   Choose your **Super Smash Bros. Melee (USA) v1.02** image (`.iso` or `.ciso`, game id GALE01
   revision 2). Any other disc or revision is refused with a message. The import takes a few
   seconds and ends with a preview where Fox animates and his sounds can be played. After an update
   that changes what is extracted (like the one that added his specials), the page asks you to
   import again; your overrides are kept.
4. Go to any page and click the toolbar icon, or press **Alt+M**. Do the same again to remove him.

### GameCube adapter (Zadig + helper, Windows)

Chrome can't read the official adapter (or a Mayflash in Wii U mode) on its own. The adapter reports
itself as a HID device, and Chrome's WebUSB never lets a page or extension claim one ("The requested
interface implements a protected class"). A small helper in `helper/` reads it instead, through the
same WinUSB driver Slippi and Dolphin use, and Chrome starts it through native messaging. The helper
is C# compiled by the PowerShell that ships with Windows, so it needs nothing else installed.

1. Driver: download [Zadig](https://zadig.akeo.ie/) and run it. Choose **Options → List All
   Devices**, select **WUP-028**, pick **WinUSB** and click **Replace Driver**. If Slippi already
   works with your adapter, this is done.
2. Helper: from this folder, run once:
   `powershell -ExecutionPolicy Bypass -File helper\install.ps1`
   It works out the extension's id from `dist/`, copies the helper to
   `%LOCALAPPDATA%\melee-web-fighter\helper` and registers it for Chrome (and Edge, Brave and
   Chromium). If you loaded the extension from another folder, pass `-ExtensionId <id>`; the
   settings page shows the exact command. `helper\uninstall.ps1` removes it.
3. Reload the extension in `chrome://extensions`.

The settings page shows the adapter's state and, live, what each plugged-in controller is pressing.
Only one program can hold the adapter at a time, so close Dolphin, Slippi or melee-unlocked first
(and Steam, if its GameCube adapter support is on). Fox is played from the port chosen in the
settings, or from the first port with a controller if that one is empty. If the state says the
adapter isn't answering, unplug both of its cables and plug them back in.

## Controls

| GameCube | Keyboard | Standard gamepad (remappable in settings) |
|---|---|---|
| Control stick | Arrows or WASD (hold Shift to walk) | Left stick |
| X (jump) | Space or I | Y |
| A | J | A |
| B (specials) | K | X |
| R (air dodge, L-cancel) | L | Right trigger |
| Z | U | Right bumper |
| D-pad up (taunt) | P | D-pad up |
| D-pad down (Arwing taunt) | O | D-pad down |
| Start | Enter | Start |
| Debug draw | F9 | — |

Fox has his whole moveset:

* **Movement:** walking, dashing and dash dance, running, run brake, turning, crouching, jumpsquat,
  short hop and full hop, double jump, fast fall, dropping through platforms, air dodge, wavedash
  and waveland.
* **Ground attacks:** jab, jab 2 and rapid jab; forward tilt (angled up or down), up tilt, down tilt;
  forward smash, up smash, down smash, all chargeable by holding A; dash attack.
* **Aerials:** all five, with auto-cancel and L-cancel.
* **Specials:**
  * Blaster (neutral B), on the ground and in the air. Press B again to keep firing.
  * Illusion (side B). Press B during it to cut it short.
  * Firefox (up B). Hold the stick to aim it. Early in the flight it passes through platforms.
  * Reflector (down B), with jump-cancel, multishine and waveshine.
* **Shield:** light and power shield, with the bubble shrinking as it wears down. Out of it: rolls,
  spot dodge, grab, jump out of shield and shield drop.
* **Grabs:** standing, dash and out of shield. With no one to catch, every grab whiffs.
* **Taunts:** his taunt, and the Arwing taunt from Corneria.

Tilts and smashes follow the stick as in the game. On the keyboard's digital stick a direction
with A is a smash; hold Shift as well for the tilt. Falling off the screen respawns him at the top.

## Settings

The settings page (right-click the toolbar icon → Options) has:

* the adapter helper's status, a live input readout, the adapter port, and the gamepad mapping
* Fox's height on the page, which sets the engine's `px_per_unit` scale
* volume
* a debug draw toggle (collision segments, ECB, hitboxes, input display)
* plugins (the example is **moon gravity**)
* the override editor

## Modding

After an import, Fox is a folder of plain files:

```
characters/fox/
  character.json      model/animation wiring, ECB bones, sound names
  attributes.json     every Melee attribute by name (gravity, jump_v_initial_velocity, ...)
  moves/*.move        subaction scripts as text, one command per line
  anims/*.anim        animations
  model/, textures/   skeleton, mesh, materials, textures
  sounds/             his sound effects
common/common.json    shared constants (dead zones, friction, input windows, ...)
```

**Overrides.** In the settings page, pick a file and click **Edit**, change it, and click
**Save override**. It is saved as `overrides/<path>` on top of the imported file. A JSON override
only needs the keys you changed, for example `{ "gravity": 0.1 }`. If Fox is on a page, he reloads
at once with the change. Overrides survive a re-import. You can turn each one off or remove it,
and export or import them all as a `.zip`. **Export Fox's folder** zips the whole effective folder.

**.move files** are Melee's subaction scripts in a readable form:

```
move AttackAirN
animation AttackAirN
landing_lag 15
frame 4   autocancel off
frame 4   hitbox 0 bone=2 damage=12 size=3.5 angle=361 kbg=100 bkb=10 ...
wait 4    clear_hitboxes
frame 42  iasa
```

* `frame N` waits until animation frame N, and `wait N` waits N frames.
* Commands the engine doesn't model stay as `raw 0x…` words, so every file converts back to the
  game's bytes exactly (the tests check this round trip).
* `behavior shine` in a header attaches a character behavior module (Fox has `blaster`, `illusion`,
  `firefox`, `shine` and `appeal`). See `src/engine/behaviors/`.

**Plugins** are TypeScript objects with optional hooks: `input`, `frameStart`, `frameEnd`,
`stateEnter`, `stateExit`, `landing`, `hitboxContact`, `attributes`, `render` (see
`src/engine/types.ts`). `src/plugins/moon-gravity.ts` changes gravity and fall speeds and draws a
moon using only those hooks. Register a plugin in `src/plugins/index.ts`.

## Development

* `npm run build` builds the extension (add `--dev` for sourcemaps; `npm run watch` rebuilds on save).
* `npm run typecheck` runs the TypeScript checks.
* `npm test` runs the Node tests.
  * They find your disc through `MELEE_ISO` or an `.iso`/`.ciso` in the repo root, which is git-ignored.
  * Disc tests: parsing, the `.move` round trip, animation and engine smoke tests.
  * Validation against the real game: `tests/validation/` holds input scripts for Fox on Final
    Destination (dash dance, run brake, hops, double jump, fast fall, each aerial with and without
    L-cancel, wavedash, waveland, multishine, waveshine, jabs and rapid jab, tilts, smashes with a
    charge, dash attack and grabs, shield with roll, spot dodge and jump out of shield, taunt,
    blaster, Illusion, Firefox, and run, jumpsquat and Illusion-cancel combinations).
  * The reference traces come from [melee-unlocked](https://github.com/DreamsVibe/melee-unlocked) built from its
    `fighter-trace` branch. Record them with
    `python tests/validation/run_reference.py --melee-unlocked C:/melee-unlocked`.
  * The traces go to `tests/expected/`, which is git-ignored because they come from your disc.
  * `npm test` then replays the same pads through the web engine and compares every frame: position
    within 0.01 units, motion and frame exact.
* `NOTES.md` has the research notes (formats, offsets, decomp functions) and the list of deviations.
