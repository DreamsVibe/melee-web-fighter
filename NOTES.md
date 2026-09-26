# Melee Web Fighter — research notes

Everything here was checked against the user's own NTSC 1.02 disc (`GALE01`, revision 2) and the
doldecomp/melee source (`src/melee/...`, `src/sysdolphin/...`). Decomp paths are relative to the decomp
root; `melee-unlocked` paths are relative to `C:\melee-unlocked`. Offsets are hex, big-endian unless
noted. Nothing in this file is disc data beyond the handful of well-known constants quoted to explain
a format; all real values are read from the user's disc at import time.

## Disc

* Header: `GALE01` at 0, revision byte at 7 (must be 2). FST offset/size at `0x424`/`0x428`.
* FST: entry 0 is the root (`count` at +8). Each entry 12 bytes: `u8 is_dir`, `u24 name_off`,
  `u32 a`, `u32 b`. Files: a = disc offset, b = size. Dirs: a = parent, b = index one past the last
  child. String table follows the entries.
* CISO: `CISO`, u32 LE block size (Melee rips use `0x200000`), then one byte per block (`0x8000`-byte
  header total) saying whether it is stored; stored blocks follow in order, missing ones read as zeros
  (`tools/ciso_to_iso.py`). The importer maps a disc offset to `0x8000 + rank(block) * bs + within`.
* Files we pull: `PlFx.dat` (260 KB), `PlFxNr.dat` (363 KB), `PlFxAJ.dat` (1.5 MB), `PlCo.dat`
  (149 KB), `audio/us/smash2.sem`, `audio/us/main.ssm`, `audio/us/fox.ssm`. NTSC English uses
  `audio/us/` (`setup_audio_lang` in `lb/lbaudio_ax.c`); `audio/` holds the Japanese voice set.

## HSD archive (.dat)

`native/Assets.h` in melee-unlocked. 0x20 header: `u32 file_size, data_size, reloc_count,
root_count, ref_count`. Data block at 0x20; relocation table (u32 data offsets holding pointers)
after it; root table (`u32 offset, u32 name_off` pairs); string table. All pointers are data-relative.

* `PlFx.dat` root `ftDataFox` → `struct ftData` (`ft/types.h`):
  `+0 ftCo_DatAttrs*` (common attributes), `+4 ext_attr` (Fox special attributes, `ftFox_DatAttrs`
  in `ft/kinds/ftFox/types.h`), `+C` action table, `+44 ftData_x44_t*` (ECB bone indices + ledge
  snap), `+4C FtSFX*` (character sound table; `x10` = jump sfx, `x14` = double-jump sfx).
* Action table: 0x18-byte entries `{char* anim_symbol, u32 aj_offset, u32 aj_size, u8* script,
  u32 flags, u32 pad}`. Index = submotion id (`ftCo_Submotion` in `ft/kinds/ftCommon/forward.h`);
  295 common entries (`ftCo_SM_Count`), Fox specials follow (`ftFx_Submotion`: SpecialLwStart = 313
  ... SpecialAirLwEnd = 320). Flags high byte: `0x80000000` = x594_b0 (TransN root motion drives
  velocity), `0x40000000` = loop, `0x20000000` = accumulate frame, `0x10000000` = misc.
* `PlFxAJ.dat` is a concatenation of small archives, each with one `*_figatree` root, 32-byte aligned;
  the action table's `aj_offset/aj_size` address them directly.
* `PlCo.dat` root `ftLoadCommonData` → 23 pointers; `[0]` is `ftCommonData*` (`ft/types.h:78`).
* `PlFxNr.dat` root `PlyFox5K_Share_joint` (model), `PlyFox5K_Share_matanim_joint`.

### Fox attributes (`ftCo_DatAttrs`, `ft/types.h:754`)
Read by name at import; sanity values from the user's disc: walk_max 1.6, ground_friction 0.08,
dash_initial 1.9, dash_max 2.2, jump_startup 3, jump_v 3.68, hop_v 2.1, gravity 0.23,
terminal 2.8, fast_fall 3.4, air_drift_max 0.83, landing lags N/F/B/Hi/Lw = 15/22/20/18/18 (+0xE8..),
normal landing 4, model_scaling 0.96. Fox ext attrs +0x98 reflector release lag (18), +0x9C turn
frames (4), +0xA4 gravity delay (int 4), +0xA8 momentum preserve x (2), +0xAC fall accel.

### Common data (`ftCommonData`) used by the engine
+0 / +4 stick dead zones (0.28), +8/+C smash dead zones (0.25), +10 shoulder dead zone (0.3),
+14 Z analog value (0.35), +18 shield press threshold, +1C (40), +20 aerial angle (radians),
+24 walk threshold, +28/+2C walk mid/fast anim thresholds, +30 walk taper, +34 turn threshold
(-0.25), +38 turn-run threshold, +3C dash stick threshold (0.8), +40 dash window (2), +44/+48/+4C
dash IASA frames, +54 dash reverse friction, +58 run threshold, +5C run taper, +60 run/dash
friction multiplier, +6C friction above walk speed (2.0), +70 tap-jump threshold, +74 tap-jump
window, +78 jump B threshold, +7C short-hop release, +80 relaxed tap jump, +88/+8C fast-fall
threshold/window, +90/+94 squat thresholds, +DC/+E0 aerial neutral thresholds, **+E4 L-cancel
window (7), +E8 L-cancel divisor (2.0)**, +1FC aerial friction out of bounds, +21C down-B threshold,
+25C platform pass threshold in Fall, +310 landing speed threshold, +32C air dodge dead zones,
+334 air dodge IASA timer, +338 air dodge force (3.1), +33C air dodge decay (0.9), +340 FallSpecial
mobility, +344 air dodge landing lag (10), +42C/+430 run brake / run anim, +438 jump y keep,
+440 walk anim ratio, +444/+448 fall blend, +464/+468 pass stick/window, +46C pass y velocity,
+470 pass delay.

## Subaction (move) scripts — `ft/ftaction.c`, `lb/lbcommand.c`

Opcode = top 6 bits of the first byte (`byte >> 2`); commands are 4-byte words, some span several.
0 end, 1 wait N frames, 2 wait until frame N, 3 set loop, 4 loop, 5 subroutine, 6 return, 7 goto,
8 wait for animation end, 9 bg flash. From 10 the table `ftAction_803C06E8` (lengths in words from
`ftAction_803C0870`): 10 GFX (5), 11 hitbox (5), 12 hitbox damage, 13 hitbox size, 14 hitbox flags,
15 remove hitbox, 16 clear hitboxes, 17 sound (3: behavior, sfx id, volume/pan), 18 smash sfx,
19 set cmd_var (`cmd_vars[0]`: **non-zero = landing lag applies, i.e. autocancel off**; `[1]`
used by RunBrake/TurnRun/shine), 20 throw flag b3/b4 (b3 in aerials = turn around), 21-22 throw
flags, **23 allow interrupt (IASA)**, 24 throw flag b0, 25 set airborne state, 26-27 body state,
28 hurtbox state, 29 jab combo, 30 rapid jab, 31 model/dobj visibility, 32-33 model, 34 throw
hitbox (3), 35 ..., 36 article visibility, 37 fighter visibility, 38 random sfx (7), ... up to 58.
Hitbox fields (5 words): id, hit group, bone, damage; size/z offset; y/x offset; angle, kbg, wkb,
flags; bkb, element, shield dmg, sfx severity/kind, hit air/ground. Units are /256.

Script timing (`ftAction_80073240`): `frame_count = cur_anim_frame`; the timer counts down by the
animation rate; "wait until frame N" sets `timer = N - frame_count`.

## Frame order (fighter.c `Fighter_Create` proc priorities)

procAnim (1: advance animation, run script, `anim_cb` — state-end transitions) → procInput (3:
build input, pressed/released edges, stick timers, B/jump/LR counters, then `input_cb` = IASA
checks) → procUpdate (4: `phys_cb`, add ground/self accel to velocity, position += self_vel)
→ procMap (6: `coll_cb`, landing/falling transitions). The engine follows this order exactly.

## State logic sources

All in `ft/kinds/ftCommon/`: `ftCo_Wait.c`, `ftCo_Walk.c` + `ft/ftwalkcommon.c`, `ftCo_Dash.c`,
`ftCo_Run.c`, `ftCo_RunBrake.c`, `ftCo_Turn.c`, `ftCo_TurnRun.c`, `ftCo_Squat*.c`,
`ftCo_KneeBend.c`, `ftCo_Jump.c`, `ftCo_JumpAerial.c`, `ftCo_Fall.c`, `ftCo_FallAerial.c`,
`ftCo_FallSpecial.c`, `ftCo_Landing.c`, `ftCo_LandingAir.c`, `ftCo_EscapeAir.c`, `ftCo_Pass.c`,
`ftCo_AttackAir.c`. Physics helpers `ft/ftcommon.c` (CalcGroundAccel_*, CalcSelfAccel_*, Fall,
FallFast, CheckFallFast), `ft/ft_084E.c` (ft_80084F3C ground friction, ft_80084DB0 air physics).
Collision callbacks `ft/ft_081B.c`. State change `Fighter_ChangeMotionState` (`ft/fighter.c:935`):
resets fast fall unless KeepFastFall, sets `cur_anim_frame = start - rate`, runs the frame-0
script; many Enter functions call `ftAnim_8006EBA4` right after to step one frame.
Fox shine: `ft/kinds/ftFox/ftfoxspeciallw.c`; motion ids 360-369 (`ftFx_MS_*`).
Animation timing: HSD AObj (`sysdolphin/baselib/aobj.c`): first interpret after a request does not
advance; non-looping animations stop when `curr_frame >= end_frame`, which is when
`ftAnim_IsFramesRemaining` turns false.

Motion ids (enum `ftCommon_MotionState`): Wait 14, WalkSlow 15, Turn 18, TurnRun 19, Dash 20,
Run 21, RunBrake 23, KneeBend 24, JumpF 25, JumpB 26, JumpAerialF 27, JumpAerialB 28, Fall 29,
FallAerial 32, FallSpecial 35, Squat 39, SquatWait 40, SquatRv 41, Landing 42,
LandingFallSpecial 43, AttackAirN..Lw 65-69, LandingAirN..Lw 70-74, EscapeAir 236, Pass 244.

## FObj / figatree

Figatree root: `u32 type, u32 flags, f32 frame_count, u32 track_count_table, u32 tracks`. Count table
is one byte per joint, `0xFF`-terminated. Track (12 bytes): `u16 length, s16 start_frame, u8 channel,
u8 value_format, u8 slope_format, pad, u32 data`. Channels: 1-3 rotation XYZ, 5-7 translation,
8-10 scale. Interpreter ported from `sysdolphin/baselib/fobj.c` (`HSD_FObjInterpretAnim`,
`FObjLoadData`, `FObjUpdateAnim`) and `spline.c` (`splGetHelmite`), as `tools/generate_fobj_host.py`
does. Opcodes CON/LIN/SPL0/SPL/SLP/KEY; values are float or fixed-point (s16/u16/s8/u8 with
`frac & 0x1F` fractional bits), little-endian inside the stream.

## Model (`native/Geometry.h`)

JObj 0x40: `+4 flags, +8 child, +C next, +10 dobj, +14 rot xyz, +20 scale, +2C pos, +38 inverse bind`.
DObj: `+4 next, +8 mobj, +C pobj`. MObj `+8 tobj, +C material (diffuse RGBA at +4)`. PObj: `+4 next,
+8 vertex attr list, +C flags (0x2000 = envelope), +E display list length (x32), +10 display list,
+14 envelope table / joint`. Attr desc 0x18 bytes: attr, type (direct/idx8/idx16), comp count,
format, frac, stride, data. TObj image at +0x4C (`+0 data, +4 w, +6 h, +8 format`), palette +0x50.
GX formats handled: I4 0, I8 1, IA4 2, IA8 3, RGB565 4, RGB5A3 5, RGBA8 6, CI4 8, CI8 9, CI14x2 10,
CMPR 14 (4x4 blocks in 8x8 tiles, maps directly onto BC1 after byte/bit order swaps).
Envelope vertices: position is in model space; skin with `pose * inverse_bind` per weight.
Single-weight envelopes (weight 1) use the bone matrix directly.

## Audio

* `ft_PlaySFX(fp, id, vol, pan)` (`ft/ft_0877.c:455`) → `lbAudioAx_800237A8` → `HSD_AudioSFXStartParam`
  (`sysdolphin/baselib/axdriver.c:580`): `bank = id / 10000`, `entry = id % 10000`,
  `script_index = sem_bank_base[bank] + entry`. Bank → file: `ssm_files[]` in `lb/lbaudio_ax.c`
  (0 = main.ssm, 11 = fox.ssm). Volume is `vol*2` clamped to 255.
* `smash2.sem`: four sections, each `u32 count` + `count` u32: (empty), (empty), 55 bank base
  indices, 4035 script offsets. A script is a stream of u32 commands (`AXDriverInterp`): type =
  top byte; 0 wait (low 24 bits), 1 play sample `fid` (global sample index), 2/3 loop, 4/5 priority,
  6/7 volume, 8/9 pan, 12/13 pitch in cents (s16), 16-21 reverb sends, 14/15 end, 0xFD marker.
* `.ssm`: `u32 table_size, u32 data_size, u32 entry_count, u32 first_fid`, then entries
  `{u32 channels, u32 sample_rate, channel[channels]}`, channel = 0x40 bytes:
  `u32 loop_flag, u32 loop_start_nibble, u32 end_nibble, u32 start_nibble, s16 coefs[16],
  u16 gain, ps, yn1, yn2, lps, lyn1, lyn2, pad`. Sample data starts at `0x10 + table_size`;
  nibble addresses are relative to it (DSP-ADPCM 8-byte frames: header byte + 14 samples).
  us/fox.ssm: 50 entries, first fid 516. us/main.ssm: 246 entries, first fid 0.
* Fast fall sound: id 150 (`ftCommon_CheckFallFast`). Jump: `FtSFX.x10`, double jump `FtSFX.x14`.

## Controller

* HSD pad (`gm/gmmain.c:43`): stick clamp circle radius 80 (min 0, shift on), scale 80;
  triggers clamp 0..140, scale 140. Then `Fighter_procInput`: dead zones 0.28 per axis zero the axis,
  trigger <= 0.3 → 0, digital L/R forces trigger = 1, Z adds LR+A and trigger 0.35 (synthetic `LR`
  bit drives the L-cancel counter x67F; air dodge needs literal L/R).
* WUP-028 (`port/runtime/host/gc_adapter.cpp`): VID 057E PID 0337, interface 0, write `0x13` to the
  OUT endpoint, read 37-byte reports starting `0x21`; per port 9 bytes: status (`&0x30` = plugged),
  buttons1 (A 01, B 02, X 04, Y 08, DL 10, DR 20, DD 40, DU 80), buttons2 (Start 01, Z 02, R 04,
  L 08), stick X, Y, C-X, C-Y, L, R. Neutral = first report after connect (origin subtraction).

## Decisions / deviations

* GameCube adapter: native helper instead of WebUSB. The spec's WebUSB path cannot work in Chrome.
  The WUP-028's only interface is HID class (USB class 03), and Chrome refuses `claimInterface` on
  protected classes for every page and extension: "The requested interface implements a protected
  class". Confirmed on the real adapter. So `helper/` holds a Chrome native messaging host.
  * It is C# compiled at start by Windows PowerShell's `Add-Type`, so there is no binary in the repo
    and nothing to install.
  * It reads the adapter through WinUSB (the Zadig driver Slippi and Dolphin use): SetupAPI finds the
    device path from the interface GUID that libwdi writes under the device's `Device Parameters`.
  * Startup follows melee-unlocked's `gc_adapter.cpp`: reset both pipes, send Dolphin's HID
    SET_PROTOCOL, write `0x13`, then read 37-byte reports.
  * It reports status (`waiting`, `connected`, `silent`, `busy`, `no-driver`, ...) as JSON messages.
  * The service worker runs it with `connectNative` while anything subscribes on the `mwf-adapter`
    runtime port (pages with Fox on them, the settings page).
  * Reports reach the page as port messages; the debug line shows the worker-to-page latency.
  * The iframe/offscreen WebUSB code, the pairing button and the `offscreen` permission are gone.
    `nativeMessaging` replaces them.
  * An unpacked extension's id is sha256 of its UTF-16 folder path (drive letter upper-cased), first
    32 hex digits mapped to a-p. `install.ps1` derives it the same way, and the result matches
    Chrome's.

* Validation traces: the spec asks to keep expected traces in `tests/`, but traces are produced by
  running the user's disc, so they are generated locally into `tests/expected/` (git-ignored). Only
  the input scripts and the comparison tool are committed.

## Engine (src/engine)

* `engine.ts` runs the fighter procs in the game's order: procAnim (AObj advance + script +
  anim callback) → procInput (Fighter_procInput port: dead zones, synthetic LR/Z bits, pressed
  edges, stick timers, B/jump/LR counters) + IASA → procUpdate (phys callback, accel into
  velocity, position) → procMap (ECB lock countdown, pose, ECB load, coll callback).
* `states.ts` ports every v1 state's four callbacks from `ft/kinds/ftCommon/ftCo_*.c`, including
  quirks such as ftCo_Dash_IASA applying the reverse-friction after a dash-back (dash dance),
  the TurnRun `mv` aliasing (walk.middle_anim_frame == turnrun.accel_mul), and KneeBend only
  allowing up-B (so multishine is "shine on the first airborne frame": air shine zeroes the rise
  and Fox stays in SpecialAirLwStart at floor height; the next jump out of the loop is a
  double jump, as the trace of the real game shows).
* `behaviors/shine.ts` is Fox's down special (ftfoxspeciallw.c), registered because his .move files
  say `behavior shine`. `load.ts` builds CharacterData from the folder; nothing is Fox-specific in
  the core except the ECB bone list and TransN index, which come from character.json.
* Script timing (`script.ts`) is ftAction_80073240's: timer decremented by the animation rate,
  `frame N` = N - frame_count, `wait_anim_end` waits for the animation to loop to frame 0.
* Animation timing uses the HSD AObj rules: a new animation's first interpret does not advance,
  loops wrap with fmod, non-looping ones stop at end_frame (that is IsFramesRemaining).
* ECB: `collision.ts loadEcb` is mpColl_LoadECB_JObj (flags 6 in the air, 5 on the ground) over
  the pose's bone positions, with the takeoff lock (10 frames after 8007D5D4, 5 after 8007D60C)
  keeping the previous bottom, and mpColl_80042384's sanity fixes. Fox's bones are joints
  41, 55, 25, 13, 7, 4 (head, hands, knees, hip), so his airborne ECB bottom sits at knee height
  and he lands when the knees reach the floor, as in the game.
* Line tests are ours (page geometry is flat): swept ECB-bottom vs floors (platforms only from
  above, skipped while dropping through or holding down past fall_platform_pass_threshold),
  side points vs walls, top vs ceilings, 6-unit sub-steps like mpColl_80043754. Edge handling
  follows mpColl_8004ACE4: Fall mode (Dash, Run, KneeBend, Squat, Turn) falls off; Teeter mode
  (Wait, Walk, RunBrake, Landing) stops at an edge when facing it with the stick under 0.75.

## Validation (step 17)

* melee-unlocked's `fighter-trace` branch adds `--fighter-trace <csv>` to melee_port: one row per
  retrace with port 1's motion id, animation frame, position, self/ground velocity, facing,
  ground/air, jumps used and the pad read that frame.
* `tests/validation/run_reference.py --melee-unlocked C:/melee-unlocked` seeds a memory card, then
  runs each script headless (`prelude.txt` = menus to a Fox vs Fox match on Final Destination,
  plus the script with frames relative to retrace 1400) into `tests/expected/<name>.csv`
  (git-ignored). `npm test` replays the same pads through the engine and compares each frame:
  position within 0.01, velocities within 0.01, motion id and facing exact, animation frame within
  0.001. All 14 scripts (dash dance, run brake, hops, double jump, fast fall, five aerials with
  L-cancel, wavedash, waveland, multishine, waveshine) match for all 710 compared frames.
* Timing: the game acts on a pad two frames after it reads it, so row R+1 = one engine step from
  row R with the pad of row R-2. The match starts at retrace 1418 and Fox can act from 1524.
* Final Destination's floor is y = 0.0001, x = ±85.5657. Stage coordinates must be float32
  (the page stage rounds them too): a double 0.0001 sits just above a fighter integrated in
  float32, and a hovering air shine then "lands".
* Player 2 stands at x = +60 and fighters push each other (±0.3/frame), which the one-fighter
  engine does not model: scripts keep Fox clear of them and away from ledges (no Ottotto).

### Deviations (v1)

* Ottotto (teeter) is not a v1 state: where the game would enter it, Fox holds still at the edge.
* Wait's idle restart always replays Wait1; the game sometimes picks Wait2 with its RNG, which would
  make the engine non-deterministic.
* Footstep/landing sounds use the "plain floor" material (the command's own sound + 0x46 thud);
  page elements have no stage materials.
* Steps 10–16 landed as one commit: the state machine, script interpreter, collision and the
  page wiring (reactions, plugin hooks) depend on each other and were built and verified together.
* The folder is stored as one packed IndexedDB record and the bridge waits up to 30 s. A fresh
  profile opens the database in milliseconds and loads the folder in about 2 s; a long-lived test
  profile degraded to 20–30 s opens, which is what the packing and the long timeout came from.

## Performance (step 18)

Measured in Chrome for Testing 154 on the World War II Wikipedia article (61,000 px tall, 17,000
elements):

* 60 fps while idle, while running and while scrolling.
* Engine step 0.1–0.3 ms (target 0.5 ms).
* The stage rescan is time-sliced at 2.5 ms per frame (`SLICE_MS` in `stage.ts`). A full rescan
  takes 4–10 ms spread over a few frames, and the typical worst frame is about 2.8 ms.
* Occasional frames reach 5–7 ms, when the first box read of a slice forces style or layout work
  the page itself had queued (Wikipedia mutates its DOM as you scroll).

What made the scan cheap:

* Culling uses each box grown to its scroll size, not the box alone: Wikipedia's `<body>` is one
  screen tall and the article overflows it. The old cull dropped the whole page once scrolled.
* Long child lists (more than 64 children, in block flow) are bisected to the part near the region.
* Elements too small to be solid skip `getComputedStyle`; only their text matters.
* The region is the viewport plus half a screen, which is where the blast zone is.
