# Melee Web Fighter

A Chrome extension that drops Fox from Super Smash Bros. Melee onto any webpage. Every line of text,
image and box on the page becomes a platform: you can stand on it and drop through it. Play with a
GameCube controller (through the official adapter), a standard gamepad or the keyboard. Fox never
changes the page; his attacks and lasers are drawn on his own overlay.

**Nothing from the game is included.** The extension is code only (about 210 KB). Fox's model,
animations, sounds, attributes and move scripts are read in your browser from **your own** disc
image and stored locally. Nothing leaves your machine.

## What you need

* Chrome (116 or newer), or Edge / Brave / another Chromium browser
* Your own **Super Smash Bros. Melee (USA) v1.02** disc image, as `.iso` or `.ciso`
  (game id GALE01, revision 2). Other regions or revisions are refused with a message.

No Node, no build step: the extension in this repo is ready to load.

## Install

1. **Download** this repo: the green **Code** button → **Download ZIP** (or grab
   `melee-web-fighter.zip` from the [Releases](../../releases) page), and unzip it somewhere it can
   stay, such as `Documents\melee-web-fighter`. Chrome loads it from that folder, so don't delete it.
2. **Load it:** open `chrome://extensions`, turn on **Developer mode** (top right), click
   **Load unpacked** and choose the **`extension`** folder.
3. **Import your disc:** the import page opens by itself. Choose your Melee image. It takes a few
   seconds and ends with a preview where Fox animates and his sounds play.
4. **Play:** go to any page and click the toolbar icon or press **Alt+M**. Do it again to remove him.

To update, download the new version over the old folder and click the reload arrow on the
extension in `chrome://extensions`. If the update extracts something new, it asks you to import
the disc again (your overrides are kept).

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

On the keyboard a direction with A is a smash; hold Shift as well for a tilt. Falling off the
screen respawns Fox at the top.

Fox has his whole moveset, checked frame by frame against the real game: dash dance, wavedash and
waveland, short hop and fast fall, jabs, tilts, chargeable smashes, dash attack, all five aerials
with L-cancel and auto-cancel, Blaster, Illusion, Firefox, Reflector with multishine and waveshine,
shield (light and power shield), rolls, spot dodge, grabs, and both taunts.

## GameCube controller adapter (Windows, optional)

Chrome can't read the official GameCube adapter (or a Mayflash in Wii U mode) by itself, so a
small helper in the `helper` folder reads it and hands the inputs to the extension. It's C# that
the PowerShell built into Windows compiles, so there's nothing else to install. A normal gamepad or
the keyboard works without any of this.

1. **Driver:** run [Zadig](https://zadig.akeo.ie/), choose **Options → List All Devices**, select
   **WUP-028**, pick **WinUSB** and click **Replace Driver**. If Slippi or Dolphin already works
   with your adapter, skip this step.
2. **Helper:** open PowerShell in the unzipped folder and run:
   ```
   powershell -ExecutionPolicy Bypass -File helper\install.ps1
   ```
   It works out the extension's id from the `extension` folder and registers the helper for
   Chrome, Edge, Brave and Chromium (current user, no admin). If that id doesn't match, the
   extension's settings page shows the exact command to run instead.
3. Reload the extension in `chrome://extensions`.

The settings page shows the adapter's status and what each controller is pressing. Only one
program can use the adapter at a time, so close Dolphin/Slippi first (and Steam, if its GameCube
adapter support is on). If the adapter isn't answering, unplug both cables and plug them back in.
`helper\uninstall.ps1` removes the helper.

## Settings and modding

Right-click the toolbar icon → **Options** for the adapter status and port, the gamepad mapping,
Fox's size on the page, volume, a debug draw toggle, plugins (try **moon gravity**), and the
override editor.

After an import Fox is a folder of plain files: `attributes.json` (every Melee attribute by name,
such as `gravity`), `moves/*.move` (his subaction scripts as readable text), animations, model and
sounds. In the settings page pick a file, click **Edit**, change it and **Save override**: Fox
reloads with the change immediately. A JSON override only needs the keys you change, for example
`{ "gravity": 0.1 }`. Overrides survive a re-import and can be exported or imported as a `.zip`.

## Troubleshooting

* **"Wrong disc" on import:** it has to be the NTSC-U v1.02 image (GALE01 revision 2).
* **Nothing happens on a page:** Chrome doesn't let extensions run on `chrome://` pages or the
  Chrome Web Store. Try a regular website.
* **Alt+M does nothing:** another extension may own the shortcut; change it at
  `chrome://extensions/shortcuts`.
