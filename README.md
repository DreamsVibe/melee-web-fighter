# Melee Web Fighter

A Chrome extension that drops Fox from Super Smash Bros. Melee onto any webpage. Text lines are
platforms you can stand on and drop through; images and boxes are solid blocks with walls. You play
him with a GameCube controller (through the official adapter), a standard gamepad or the keyboard.
Aerials knock page elements around, and every change reverts when you turn him off.

The extension is code only (about 175 KB). Fox's model, animations, sounds, attributes and move
scripts are extracted in your browser from **your own** NTSC 1.02 disc image and stored locally in
IndexedDB. Nothing from the disc is in this repository or ever leaves your machine.

## Setup

1. Build: `npm install`, then `npm run build`. The unpacked extension ends up in `dist/`, and the
   build prints a size report checked against the 300 KB budget.
2. Load it: open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick `dist/`.
3. Import your disc: the import page opens on install (it is also linked from the settings page).
   Choose your **Super Smash Bros. Melee (USA) v1.02** image (`.iso` or `.ciso`, game id GALE01
   revision 2). Any other disc or revision is refused with a message. The import takes a few
   seconds and ends with a preview where Fox animates and his sounds can be played.
4. Go to any page and click the toolbar icon, or press **Alt+M**. Do the same again to remove him.

### GameCube adapter (Zadig)

The official adapter, and a Mayflash adapter in Wii U mode, is read over WebUSB. On Windows it needs
the WinUSB driver, set up the same way as for Slippi/Dolphin:

1. Download [Zadig](https://zadig.akeo.ie/) and run it.
2. Choose **Options → List All Devices**, then select **WUP-028**.
3. Select **WinUSB** as the driver and click **Replace Driver** (or **Install Driver**).
4. Unplug and replug the adapter.

Then open the extension's settings page, click **Pair GameCube adapter**, pick the adapter and choose
your controller's port. Only one program can hold the adapter, so close Dolphin/Slippi first. On
macOS and Linux no driver is needed (on Linux you may need a udev rule granting access to
`057e:0337`).

## Controls

| GameCube | Keyboard | Standard gamepad (remappable in settings) |
|---|---|---|
| Control stick | Arrows or WASD (hold Shift to walk) | Left stick |
| X (jump) | Space or I | Y |
| A | J | A |
| B (shine) | K | X |
| R (air dodge, L-cancel) | L | Right trigger |
| Z | U | Right bumper |
| D-pad down | O | D-pad down |
| Start | Enter | Start |
| Debug draw | F9 | — |

The v1 moveset covers standing, walking, dashing and dash dance, running, run brake, turning,
crouching, jumpsquat, short hop and full hop, double jump, fast fall, dropping through platforms,
all five aerials with auto-cancel and L-cancel, air dodge, wavedash and waveland, and the shine on
the ground and in the air (multishine, waveshine). Falling off the screen respawns him at the top.

## Settings

The settings page (right-click the toolbar icon → Options) has:

* adapter pairing and port, and the gamepad mapping
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
* `behavior shine` in a header attaches a character behavior module. See
  `src/engine/behaviors/`.

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
    L-cancel, wavedash, waveland, multishine, waveshine).
  * The reference traces come from [melee-unlocked](https://github.com/DreamsVibe/melee-unlocked) built from its
    `fighter-trace` branch. Record them with
    `python tests/validation/run_reference.py --melee-unlocked C:/melee-unlocked`.
  * The traces go to `tests/expected/`, which is git-ignored because they come from your disc.
  * `npm test` then replays the same pads through the web engine and compares every frame: position
    within 0.01 units, motion and frame exact.
* `NOTES.md` has the research notes (formats, offsets, decomp functions) and the list of deviations.
