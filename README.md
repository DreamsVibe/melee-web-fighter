# Melee Web Fighter

Play Fox or Falco from Super Smash Bros. Melee on any webpage. Every line of text, image and box on
the page becomes a platform he can stand on and drop through, and images, buttons and boxes have
ledges at their top corners to catch and hang from. Play with a GameCube controller, any gamepad or
the keyboard. Your fighter never changes the page: his attacks and lasers are drawn on
his own overlay.

<img width="1714" height="963" alt="meleefighterweb" src="https://github.com/user-attachments/assets/e7487902-f118-458f-b790-ec02106ef9b2" />


**Pick Fox or Falco** in the extension's settings; a page that already has a fighter on it switches
at once. Falco runs on the same code as Fox, as he does in the game, with his own data: he's
heavier, jumps higher, falls slower, and his lasers make opponents flinch.

**There's Melee's Sandbag to hit.** It stands next to your fighter and takes hits like in the game:
damage adds up and knocks it further, strong hits send it tumbling. When it leaves the screen it
comes back at 0%. Fox's moveset and his hits on Sandbag are checked frame by frame against the real
game.

**Nothing from the game is included.** The extension is code only (about 250 KB). Fox's, Falco's
and Sandbag's models, animations, sounds and moves are read in your browser from **your own** Melee disc
image and stored locally. Nothing is uploaded anywhere.

## Quick install (about 2 minutes)

You need **Chrome** (or Edge, Brave, any Chromium browser) and your own **Super Smash Bros. Melee
(USA) v1.02** disc image, as `.iso` or `.ciso`. This is the same version Slippi uses.

1. **Download** [`melee-web-fighter.zip`](../../releases/latest/download/melee-web-fighter.zip) and
   unzip it somewhere it can stay, like `Documents\melee-web-fighter`. Chrome runs it from that
   folder, so don't delete it afterwards.
2. In Chrome, go to **`chrome://extensions`** and turn on **Developer mode** (switch in the top
   right corner).
3. Click **Load unpacked** and choose the **`extension`** folder inside what you unzipped.
4. A page opens asking for your disc. **Choose your Melee `.iso` or `.ciso`.** After a few seconds
   you'll see Fox animating; that means it worked.
5. Go to any website and press **Alt+M** (or click the extension's icon). Press it again to remove Fox.

Tip: click the puzzle-piece icon in Chrome's toolbar and pin Melee Web Fighter so its icon is
always visible.

**Updating:** open the extension's settings (right-click its icon → **Options**) and click
**Check for updates**, then **Update now**. The first time, Chrome asks you to pick the folder you
unzipped and to let the extension edit it; after that an update is one click. The **Changelog**
below the button lists what changed in each version. Your settings and edits are kept, and if an
update needs more from the disc, it asks you to choose it again.

Updating by hand works too: download the new zip, unzip it over the old folder, and click the ↻
reload arrow on Melee Web Fighter in `chrome://extensions`. Version 0.1.0 has no update button,
so moving from it to a newer version has to be done this way once.

## Controls

| GameCube | Keyboard (default) | Standard gamepad (default) |
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

Both the keyboard and the gamepad can be remapped in the extension's settings; there you can also
bind Y, L and the C-stick, which have no keys by default. On the keyboard a direction with A is a
smash; hold Shift as well for a tilt. Falling off the
screen respawns your fighter at the top.

Fox and Falco have their whole movesets: dash dance, wavedash and waveland, short hop and fast fall, dropping
through platforms, jabs, tilts, chargeable smashes, dash attack, all five aerials with L-cancel and
auto-cancel, Blaster, Illusion/Phantasm, Firefox/Fire Bird (aimable), Reflector with multishine
and waveshine, light and power shield, rolls, spot dodge, grabs, and both taunts.

**Shield drops.** Hold shield on a platform, angle the stick sideways without rolling, then
rotate down to the diagonal notch. The UCF 0.84 shield-drop adjustments make this reliable across
GameCube controllers. A straight-down tap still spot dodges; solid floors cannot be dropped through.

**UCF 0.84 is enabled by default** for Fox and Falco: dashback, dash/dashback out of crouch,
tumble escape, 1.0 cardinals, standard and high-notch shield drops, and first-frame SDI/shield SDI.
Shield hits now block attacks, wear down the shield and cause shield stun. Existing character
folders work without re-importing; new imports read the added hitlag constants from the disc.

**Ledges.** Fall past the top corner of an image, button or box while facing it and you catch the
ledge, as in Melee: you're briefly intangible and get your double jump back. From the ledge, push
toward the page or tilt up to climb, press A or B to attack, L or R to roll, jump to jump off, and
push away or down to let go. Over 100% the getups are the slow ones, and after about 10 seconds of
hanging you drop. Hold down to fall past a ledge without catching it. Text lines have no ledges,
like Melee's platforms.

## Stages

Press **Alt+Shift+M** anywhere (or use **Play on a Melee stage** in the settings) to open the stage
select. Choosing a stage opens it in its own tab, with your fighter and Sandbag on their starting
points, the stage's blast zones, and a camera that follows the fight. **Esc** or Alt+Shift+M brings
the menu back (the game pauses), and it lets you switch between Fox and Falco too.

**Final Destination and Battlefield** are playable: their collision, spawn points, blast zones and
models come from your disc, like the characters. Battlefield includes its three pass-through
platforms, both ledges, animated stage structures and scrolling textures. Its background cycles
between three scenes with an animated transition. Opening the menu pauses the scenery too.
The background's particle scripts and the GameCube's full material pipeline aren't emulated, so
some effects differ from Melee. Final Destination's scenery is still static.

Dream Land, Yoshi's Story, Fountain of Dreams and Pokémon Stadium are listed and come later. If
Battlefield says **Import your disc again**, reload the extension and re-import your disc to add it.

## Using a GameCube controller (Windows, optional)

A regular gamepad or the keyboard works right away. The official GameCube adapter (or a Mayflash
in Wii U mode) needs one extra step, because Chrome isn't allowed to read that adapter by itself. A
small helper in the `helper` folder reads it for Chrome. It's a short C# program that Windows'
built-in PowerShell compiles, so there's nothing else to download.

1. **Driver:** if Slippi or Dolphin already sees your adapter, skip this step. Otherwise, run
   [Zadig](https://zadig.akeo.ie/), choose **Options → List All Devices**, select **WUP-028**,
   pick **WinUSB** and click **Replace Driver**.
2. **Helper:** open the unzipped folder, click the address bar, type `powershell` and press
   Enter. In the window that opens, paste this and press Enter:
   ```
   powershell -ExecutionPolicy Bypass -File helper\install.ps1
   ```
   It needs no admin rights and only registers the helper for your Windows user.
3. Back in `chrome://extensions`, click ↻ on Melee Web Fighter.

Open the extension's settings (right-click its icon → **Options**) to see whether the adapter is
connected and what each controller is pressing. If the ID shown there doesn't match what the
installer printed, the settings page gives you the exact command to run instead.

* Only one program can use the adapter at a time: close Dolphin and Slippi first (and Steam, if
  its GameCube adapter support is on).
* If it says the adapter isn't answering, unplug both of its cables and plug them back in.
* To remove the helper: `powershell -ExecutionPolicy Bypass -File helper\uninstall.ps1`

The adapter helper is Windows only for now. On Mac and Linux, use a gamepad or the keyboard.

## Troubleshooting

* **The import says it's the wrong disc:** it has to be the USA v1.02 image (game id GALE01,
  revision 2). PAL, Japanese, and v1.00/v1.01 images aren't supported.
* **Nothing happens on a page:** Chrome doesn't allow extensions on `chrome://` pages or the Chrome
  Web Store. Try any normal website.
* **Alt+M does nothing:** another extension may use that shortcut. Change it at
  `chrome://extensions/shortcuts`.
* **Want to import again:** the import page is linked from the settings page.

## Settings

Right-click the toolbar icon → **Options**:

* which character you play (Fox or Falco)
* updates and the changelog
* the adapter's status, a live input readout, which adapter port to use, and the gamepad and
  keyboard mappings
* Sandbag: whether it appears, and whether it takes damage (off: it stays at 0% and every hit knocks it
  back as at 0%)
* your fighter's size on the page (set as Fox's height; Falco is drawn to the same scale, a little
  taller)
* volume
* debug draw (collision, ECB, hitboxes, input display)
* plugins (try **moon gravity**)
* the override editor (see Modding)

## Modding

After an import, each character is a folder of plain files (`characters/fox/`,
`characters/falco/` and `characters/sandbag/`, all laid out the same way):

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
only needs the keys you changed, for example `{ "gravity": 0.1 }`. If your fighter is on a page, he
reloads at once with the change. Overrides survive a re-import. You can turn each one off or remove
it, and export or import them all as a `.zip`. **Export the character folders** zips the whole
effective folder.

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
* `body_state 2` makes the fighter intangible until the move ends (1 is invincible, 0 normal); the
  ledge getups, rolls and dodges use it.
* Commands the engine doesn't model stay as `raw 0x…` words, so every file converts back to the
  game's bytes exactly (the tests check this round trip).
* `behavior shine` in a header attaches a character behavior module (Fox and Falco have `blaster`,
  `illusion`, `firefox`, `shine` and `appeal`). See `src/engine/behaviors/`.

**Plugins** are TypeScript objects with optional hooks: `input`, `frameStart`, `frameEnd`,
`stateEnter`, `stateExit`, `landing`, `hitboxContact`, `attributes`, `render` (see
`src/engine/types.ts`). `src/plugins/moon-gravity.ts` changes gravity and fall speeds and draws a
moon using only those hooks. Register a plugin in `src/plugins/index.ts`.

## Development

* `npm install`, then `npm run build` builds into `extension/` and prints a size report against the
  300 KB budget (add `--dev` for sourcemaps; `npm run watch` rebuilds on save). `extension/` is
  committed so people can install without building: rebuild before you commit source changes.
* `npm run typecheck` runs the TypeScript checks.
* `npm test` runs the Node tests.
  * They find your disc through `MELEE_ISO` or an `.iso`/`.ciso` in the repo root, which is git-ignored.
  * Disc tests: parsing, the `.move` round trip, animation and engine smoke tests.
  * Validation against the real game: `tests/validation/` holds input scripts for Fox on Final
    Destination (dash dance, run brake, hops, double jump, fast fall, each aerial with and without
    L-cancel, wavedash, waveland, multishine, waveshine, jabs and rapid jab, tilts, smashes with a
    charge, dash attack and grabs, shield with roll, spot dodge and jump out of shield, taunt,
    blaster, Illusion, Firefox, and run, jumpsquat and Illusion-cancel combinations).
  * The `sb_*` scripts put Sandbag in as player 2 (`# p2 sandbag`) and check Fox's hits on it: jabs
    and the rapid jab, tilts, smashes (charged too), aerials, the shine, lasers, launches, tumbling,
    landing lying down and getting up, phantom hits and stale moves. Sandbag's state, animation
    frame, position, knockback, percent and hitlag are compared every frame too.
  * The reference traces come from [melee-unlocked](https://github.com/DreamsVibe/melee-unlocked) built from its
    `fighter-trace` branch. Record them with
    `python tests/validation/run_reference.py --melee-unlocked C:/melee-unlocked`.
  * The traces go to `tests/expected/`, which is git-ignored because they come from your disc.
  * `npm test` then replays the same pads through the web engine and compares every frame: position
    within 0.01 units, motion and frame exact.
  * `tools/tracediff.ts` prints the game and the engine side by side for a range of frames, and
    `tools/datx.ts` explores the disc's archives (roots, hex, words, pointer paths). Both say how to
    run them at the top.
* `node tools/e2e.mjs <folder>` checks the extension end to end in Chrome: it loads a copy of
  `extension/`, imports your disc, drops Fox onto a test page, hits Sandbag, shoots, switches to
  Falco and saves screenshots (`CHARACTER=falco` starts as Falco).
  Use a dev build with `SCENARIO=stage STAGE=battlefield` (environment variables) to check Battlefield,
  its menu/pause behavior and the background transition. Test profiles and images belong in `.cache/`.
* `NOTES.md` has the research notes (formats, offsets, decomp functions) and the list of deviations.

## Contributors

* [kream-cheese](https://github.com/kream-cheese): Falco, and ledges to catch and hang from.
