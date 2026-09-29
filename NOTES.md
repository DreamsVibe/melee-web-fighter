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
* The model's Y rotation (`ftPartSetRotY(fp, 0, π/2 × facing)`) is set in `Fighter_ChangeMotionState`
  only, not every frame (`Fighter.rootRotY`). A facing that flips during a state (Turn, TurnRun, the
  back roll, a reversing aerial) leaves the model as it was, and the animation shows the turn; the
  reflector's turn spins it 180° ÷ `reflector_turn_frames` a frame. Re-deriving it from the facing each
  frame made turnarounds turn twice.
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
  0.001. All 24 scripts match for all 710 compared frames: dash dance, run brake, hops, double
  jump, fast fall, five aerials with L-cancel, wavedash, waveland, multishine, waveshine, and (added
  with the full moveset) jab/rapid jab, tilts, smashes with a charge, dash attack and grabs,
  shield/roll/spot dodge/jump out of shield, taunt, blaster, Illusion, Firefox, and `combos` (run →
  dash attack, jumpsquat up smash and grab, Illusion cut short). The trace has no c-stick columns,
  so scripts use the control stick only.
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

## Full moveset (after v1)

Fox now has every move he can do alone on a stage. Where each comes from:

* **Ground attacks, shield, dodges, grabs, taunt** (`src/engine/groundmoves.ts`): `ftCo_Attack1.c`
  (jab window = hitlag_mul, combo/rapid flags from script commands 29/30, `x1A54` press count),
  `ftCo_Attack100.c` (rapid jab ends when a loop passes throw flag b3 with no A activity; also the
  game's names for the up/neutral/down B checks), `ftCo_AttackDash.c`, `ftCo_AttackS3/Hi3/Lw3.c`,
  `ftCo_AttackS4/Hi4/Lw4.c`, `ftCo_Guard.c`, `ftCo_Escape.c`, `ftCo_Catch.c`, `ftCo_AppealS.c`. The
  movement states' interrupt lists (`ftCo_Wait_IASA`, Walk, Turn, Dash, Run, Squat*, Landing,
  KneeBend) now follow the decomp's order in full.
* **Angled tilts and smashes:** `ftData_80085FD4(fp, msid)` is called with motion ids where it wants
  submotion ids. The mismatch lines up so that it checks whether the *angled* animation exists
  (e.g. msid AttackS3S = 53 = submotion AttackS3Hi). `hasAnim(name)` does the same.
* **Smash charge** (`ft/ft_0DF0.c`): command 56 (`smash_charge frames= rate=`) arms it; the input
  step turns it into a charge while A is held (anim rate 0), the anim step counts to the hold
  frames (60) and releases. Charge sound 0x7B at `x7C8` frames.
* **Root motion** (`ftanim.c`, `ft_084E.c` ft_80085030/800850E0/80085134/800851C0): TransN's animated
  translation × model scale, differenced per animation step (`x6A4_transNOffset`). Zeroed on a
  state change; one started mid-animation on the ground takes its speed. Dash attack, rolls, dash
  grab, forward smash and Illusion's dash use it.
* **Shield states have no animation** (`anim_id -1`: the trace reads frame −1 throughout GuardOn,
  Guard and GuardReflect; the pose is a part animation from `ftData +0x20`). They are `poseOnly`:
  no script, no animation step; the renderer shows Guard's first frame. GuardOn lasts
  `fp->x2E8` frames, which is the GuardOn animation's length (8). A digital press within
  `powershield_input_window` of the trigger crossing gives GuardReflect (power shield), which the
  traces confirm is what a digital R does from standing.
* **Shield drops use the UCF gate adjustment** (`groundmoves.ts`, matching Slippi's UCF 0.84
  patch at 800998A4). With an expired horizontal roll timer, a passable floor and a main stick
  above −0.8 at the rim, the main-stick spot-dodge threshold becomes −0.8. The rim check uses
  truncated stick magnitudes ×80 −0.0001, plus two units per axis, with squared radius >6400.
  C-stick dodges keep priority; fresh horizontal taps still roll. Pass's original collision skip
  is unchanged. Disc-backed adapter-report tests cover Fox and
  Falco, both diagonal directions on all Battlefield platforms, and dodge/roll/solid-floor cases.
* **UCF 0.84** is on by default (`src/engine/ucf.ts`; `e.ucf.enabled = false` is available to
  reference tests). The public Slippi patches are the source:
  https://github.com/project-slippi/slippi-ssbm-asm/tree/master/External/UCF%200.84/UCF
  Raw signed pad samples keep two-frame movement intent before deadzones/cardinal correction.
  Cardinal snapping requires |raw axis| ≥80 and |other axis| ≤6, for both sticks. Dashback patches
  Turn IASA's temporary facing flip on action frame 2, with active X timer ≤1 and raw X delta² >5625.
  Tumble gets the same fast-intent fallback when its X timer is 1 and previous |X| is below the
  drift threshold. Crouch's rim release threshold becomes 0.59 only while X timer <1; no extra
  crouch dash frame is granted. High shield notches at Y ≤−0.609375 require two consecutive rim
  samples after raw Y delta² >1936 and Y timer ≤1. Normal lower notches still drop immediately.
  The Ice Climbers partner synchronization and Zelda grounded up-B exclusion have no consumers
  in the supported Fox/Falco roster.
* **Hitlag displacement and shield hits** (`hitlag.ts`, `hits.ts`, `groundmoves.ts`): body SDI moves
  six units times the stick, shield SDI moves horizontally at 0.66 of that scale, and ASDI runs
  on hitlag exit. UCF's reset-active-timer fallback uses unreset sticky timers ≤1, previous input
  below the SDI threshold and raw delta² >3844 (2D for body, X only for shield). It preserves the
  shield patch's signed previous-X comparison. Consumed active timers are stamped 254.
  Swept hitboxes test the shield joint's sphere before hurtboxes, share hit-group victims and
  enter GuardSetOff with disc-derived damage/stun/push constants. Shield stun freezes during
  hitlag and returns to Guard/GuardOff. Existing folders get verified NTSC 1.02 defaults for
  newly exported constants. Tests compare UCF on/off for both characters and directions,
  including real collision-generated damage/shield hitlag, cardinal boundaries and held inputs.
* **Fox's specials** (`src/engine/behaviors/`): `blaster.ts` (ftfoxspecialn.c: shot when the script
  sets var 2, from RThumbNb + (0, 1.2325, 4.2636), angle `blaster_angle` mirrored when facing
  left, sounds 110103/110106), `illusion.ts` (ftfoxspecials.c), `firefox.ts` (ftfoxspecialhi.c:
  XRotN set to 2π − angle; platforms pass through for `firefox_bounce_frames` of the flight via
  ftCo_8009A134; steep floor hits → SpecialHiBound), `appeal.ts` (ftfoxappeals.c, on D-pad down).
* **New disc data** (format version 2 forces a re-import): Fox's special attributes
  `ext_attr +0x00..+0xC4` (`FOX_SPECIAL_FIELDS`, names follow what the code does with each, not the
  decomp's sometimes misleading names), more `ftCommonData` fields (tilt/smash thresholds and
  angles, shield, dodge, grab, special-input thresholds), the part → joint table
  (`ftLoadCommonData[4]` → per-kind `FighterPartsTable`, Fox = kind 1; XRotN = joint 2, RThumbNb =
  67, also the item joint), the shield joint (`ftData +0x8 → +0x11` = 71) and article 0 (`FoxLaserAttr`: lifetime 35,
  scale 3). Fox's Corneria taunt submotions are named `SpecialAppeal*` because the common taunt
  already uses `AppealSR/L`.

### Page as a stage, revised

* Everything on the page is a pass-through platform along its top edge: text lines, media, controls
  and boxes alike. No walls, ceilings or solid floors: with many page boxes, walls and ceilings
  trapped Fox between elements. `SegKind.Floor/Wall*/Ceiling` remain in the engine for Final
  Destination (validation).
* Page reactions are gone: hits no longer move page elements. The page is never touched; lasers,
  shield, reflector and flames are drawn on the overlay (`src/content/effects.ts`).

### Deviations (full moveset)

* Throws, pummel and grab release are unreachable: there is no one to catch, so every grab whiffs.
* A shield worn to zero just drops (no ShieldBreak states); the power shield doesn't reflect.
* Blaster shots have no hitbox or collision and fly for their lifetime; the blaster gun model and
  the Arwing (a stage object) aren't drawn.
* The game's particle effects (command 10) are not modelled; the shield bubble, reflector hexagon,
  laser beam and Firefox flames are 2D stand-ins. Illusion's afterimages are the fighter redrawn
  translucently at its last four positions (the game keeps the same four).
* Command 18 (smash attack voice from the FtSFX list) stays raw.
* The Arwing taunt plays anywhere on D-pad down; in the game it needs Corneria.

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

## Hits and Sandbag

Sandbag stands next to Fox and takes hits. Everything below is checked frame by frame against the
real game with Sandbag as player 2 (the `sb_*` validation scripts).

### Reference traces with a second fighter

* melee-unlocked's `fighter-trace` branch also writes Fox's hitlag and player slot 2's fighter
  (`p2_*` columns: kind, motion, animation frame, position, self and knockback velocity, ground
  speed, facing, ground/air, percent, hitlag).
* `--p2-ckind 31` turns player 2 into Sandbag. The character select screen doesn't offer it, so the
  option rewrites player 2's pick in `gmVsMelee_StartData` (`0x80480530`, `players[1].ckind` at
  `+0x60 + 0x24`) once the prelude has picked Luigi (7), before the match scene reads it.
  Sandbag's internal kind is 32.
* `run_reference.py` passes the option for a script that says `# p2 sandbag`. Sandbag stands at
  x = +60 on Final Destination, facing left, and is in Wait from retrace 1605, so scripts start
  their inputs at 230.
* The game's Sandbag can't be KO'd in VS mode. Off the stage it falls forever and gains 1% a second,
  so the comparison stops once it leaves Final Destination. Ours respawns instead.

### Frame order with several fighters

Fighter procs by priority (`Fighter_Create`): 0 hitlag, 1 animation, 2 CPU, 3 input, 4 physics,
6 map collision, 7 IK, 8 accessories, 9 hitbox positions (`procCollPos`), 12 grabs, 13 attack
collision, 14 damage (`procCollResolve`), 16 dynamics. Items use 0, 1, 4, 5, 9, 11–14 and 16. Each
priority runs for every fighter before the next priority starts. `World.step` does the same with one
engine per fighter, and `Engine.step` on its own runs the same phases for one fighter, which is why
the Fox-only traces still match.

### Hitlag

* The hitlag flag (`x2219_b5`) skips the animation step and anim callback, the input callbacks
  (IASA, special-input counters, smash charge) and the whole of `procUpdate`'s physics. Presses pile
  up (`pressed |=`), and map collision still runs.
* Frames = `int(int(damage × x198 + x19C) × mul)` (`ftCommon_CalcHitlag`), with x198 = 1/3,
  x19C = 3, crouching × x1A0 (0.667), capped at x194. Electric hits (element 2) set the victim's
  multiplier to x1A4 (1.5); the attacker keeps 1.
* The victim's hitlag uses the strongest integer damage it took this frame. The attacker's uses the
  strongest it dealt (`x1914`). Items give their owner no hitlag.

### Hitboxes against hurtboxes

* Hurtboxes are in the character file: `ftData +0x30 → {count, inits}`, 0x28-byte entries (joint,
  height 0/1/2, grabbable, two ends, radius). Sandbag has 3, on joints 36, 4 and 5, each radius 5.5;
  Fox has 13.
* The hitbox command's offset words are named `z`, `y`, `x` in the decomp, and it stores them as
  `b_offset = (z, y, x)`. The engine used to read them as `(x, y, z)`, which only mattered for the
  debug draw until hits used them.
* The test (`lbColl_8000805C` → `lbColl_80006E58`) is 3D. It takes the hitbox swept from last
  frame's position to this frame's, finds the closest points to the hurtbox segment, and measures
  the hurt radius in the joint's own space, so a scaled joint (model scale 0.96 for Fox, 1.2 for
  Sandbag) has a fatter capsule. A freshly created hitbox doesn't sweep on its first frame.
* A hitbox group shares its victims: a new hitbox copies them from an active one of the same group
  (`ftColl_800768A0`), and a hit adds the victim to every hitbox of the group.
* **Phantom hits.** When the overlap is under `x7A8` (0.01), the hit is a graze. It's logged
  separately (`dmg_log1`) with half the damage (at least 1), only if nothing really hit that frame,
  and each hitbox group tracks grazed victims in their own list, so a graze never blocks a later
  real hit. A graze gives the victim hitlag but not the attacker, and the stored damage lands when
  that hitlag ends (`x189C`, `ftColl_8007BE3C`), with no knockback. Its stale entry uses the
  attacker's attack at that moment, not at the graze.

### Knockback

* `KNOCKBACK` (`ftColl_80079AB0`): `kb = ((0.01 × kbg × (x11C × ((xF8 − w·xF8/(1+w)) × inner) + x120)) + bkb)`
  with `w = weight × xF4` and `inner = x110 × p + x114 × d × p`. Here `p` is the victim's integer
  percent plus this frame's damage, and `d` is the hit's unstaled integer damage. Set knockback
  (`wkb`) uses x118 in place of `p`. The result is capped at x108; crouching × x124, minimum x104.
* The strongest logged hit wins (`ftColl_8007A06C`). The victim faces the attacker
  (`victim.x > attacker.x ? −1 : 1`); an item flying fast enough pushes the way it flies.
* `ftCo_8008DCE0` applies it:
  * hitstun is `int(kb × x154)` (0.4), at least 1;
  * launch speed is `kb × x100` (0.03);
  * the level (x158 / x15C / x160 on `kb × 0.4`) picks the state from
    `ftCo_803C5520[air][level][hurtbox height]`, so Sandbag's mid-height hurtboxes give DamageN* and
    DamageFlyN;
  * the Sakurai angle (361) is x144 in the air, and on the ground grows from 0 over x14C–x150;
  * a grounded upward launch lifts off, a downward one slides, and at level 3 a downward launch
    steeper than x1E8 bounces (y × x1EC).
* In the air, knockback velocity decays by x204 along its own direction. Sandbag instead decays each
  axis by its own attributes (ext_attr: x 0, y 0.051, `ftCommon_SandbagKnockbackDeaccel`). On the
  ground, ground friction × x200 slows it.
* A launch with knockback over x12C leaves the victim invincible for x130 frames after its hitlag
  (`ftColl_8007B7A4`). Hits still connect, which gives the attacker hitlag, but they do nothing.
* Being hit sets a new launch, or combines with the old one when the last hit was more than xFC
  frames ago (`ftCo_Damage_CalcVel`).
* The game may pick DamageFlyRoll at high percent from its random number generator (x23C, x240).
  The engine stays deterministic and never does.

### Stale moves

* Each player has a queue of 10 attacks (`StaleMoveTable`), of which the 9 most recent count. Each
  use of the same move id subtracts `ftLoadCommonData[3][i]` (0.09, 0.08 … 0.01) from 1.
* The move id comes from the motion table (`FtMoveId`: jabs 2–5, dash attack 6, tilts 7–9, smashes
  10–12, aerials 13–17, specials 18–21). Landing keeps its aerial's id.
* A new attack instance starts when the id changes, when it is Default (1), each pass through the
  rapid-jab loop, and on each down tilt (`ft_800892A0`). A hit records (id, instance) once.
* Staling applies when the hitbox is created, together with a charged smash's multiplier:
  `(rate/256 − 1) × charge frames / hold frames + 1`.

### Items: Fox's laser

* The laser is an item (article 0, `ftData +0x48`) with a command script per state. The item
  hitbox layout differs from a fighter's: 6 words, a 7-bit bone and 13-bit damage in word 0, and
  `it_create_hitbox_4` in word 4.
* Neutral B always uses state 0: four hitboxes of 3 damage with no growth and no base or set
  knockback. The longest is removed after the first frame, and the damage drops to 2 after 18.
  Zero knockback means no hitlag and no flinch, only percent.
* The first script run is at spawn from timer 0. Later runs count down first, the same rule as
  fighters.
* The hitbox follows the ray's joint: yaw π/2 × facing, pitch π + atan2(vy, ∓vx), and Z scale growing
  by |speed| / 11.25 up to the article's scale. The offsets lie along −Z.
* A laser disappears once it has dealt damage (the FoxLaser logic's `dmg_dealt` returns true).

### Items: the side special's afterimage

The side special's hit isn't in Fox's move scripts: the dash leaves an afterimage item
(`it/kinds/itfoxillusion.c`, `ftFox_SpecialS_CreateGhostItem` in `ftfoxspecials.c`) that carries it.
Engine: `Engine.spawnAfterimage`, `afterimages`; `readIllusion` in the importer.

* **Which article.** Fox's Illusion is article 2 (`ftFx_Init_OnLoad`); Falco's Phantasm is article 3
  (his own OnLoad registers `items[3]` as `It_Kind_Falco_Phantasm`) and uses the same item code.
* **Spawn.** In SpecialS / SpecialAirS's anim callback, after the end-of-dash check, when the script
  has set var 2 to 1 (it's reset to 0). The item starts in state 0 if the fighter is on the ground,
  1 in the air; its script puts up the hitbox at spawn.
* **Position.** Each frame its phys puts it on the trail one frame behind the fighter
  (`ghostEffectPos[1]`), its joint turned by TopN's X rotation from then (`blendFrames[1]`).
* **Life.** Its first attribute (5) counts down in the anim callback (not on the spawn frame, as for
  the laser), then state 2 clears the hitbox for the second (2). It's removed at once when the
  fighter leaves motions 347–352 (`ftFx_SpecialS_CheckGhostRemove`). Hitting doesn't remove it.
* **Scale.** An item's hitbox radius is its size times the item's scale (`lbColl_8000805C`; items
  never set `x43_b1`), and the offset goes through the item's joint, scaled the same. The scale is
  `ItemCommonData x60` × the owner's player scale (1): Fox's Illusion 1, Falco's Phantasm 1.1.
* **Values.** Fox: 7%, electric, 80°, base 68, growth 40 from the ground / 60 in the air, 4.16
  radius, 3.9 above the item. Falco: 7%, electric, 65° from the ground (base 74, growth 60) and
  270° in the air (base 70, growth 70: the spike), 6 above the item.
* Being an item, its hit gives the attacker no hitlag, and a slow item pushes the victim away from
  where it is (ftColl_8007A06C with `x40_vel` 0).
* `sb_illusion` and `sb_airillusion` check Fox's against the game frame by frame. Keep those runs
  away from Final Destination's edge: the game's swept wall check (`mpLib_800515A0`) catches the
  side wall's top corner when a fast dash leaves the floor, which the engine's simpler wall check
  doesn't. Pages have no walls, so this only matters for the test stage.

### Sandbag

* The files are `PlSb.dat` (`ftDataSandbag`), `PlSbNr.dat` (`PlySandbag_Share_joint`, 55 joints)
  and `PlSbAJ.dat` (38 animations). Its Ft_Kind is 0x20, which indexes PlCo's parts table, and it
  has one special action, WaitReverse (submotion 295, motion 341).
* `ftSb_Init_8014FA30` constrains joints in code (HSD RObj). Joint 5 sits at the average of joints
  12 and 17. Joints 7 and 6 aim their X axis at joints 37 and 5 (up = world Y), and their local X
  rotation is then clamped to −90° and −86°. Hurtbox 2 is on joint 5, so the constraints matter for
  hits as well as looks. `applyConstraints` in `render/pose.ts` follows `HSD_RObjUpdateAll`
  (position, `resolveCnsDirUp`, `resolveLimits`).
* Landing out of tumble (`ftCo_80097AF4`, because `is_sandbag`) reads HipN's matrix column 2, not
  column 1 (`x2226_b0`). If the hip lies flat it bounces (DownBound U/D), then after
  `x424` = 220 frames of DownWait it stands up. Otherwise it lands standing, in Wait or, facing the
  other way, WaitReverse, where it stays until hit.
* It skips the fall-animation blend (`ftCo_Fall_Anim`) and never teeters.
* Its collision bottom while falling is 5.7 units above its feet (Fox's is 3.9), which matters when
  it spawns next to Fox (`besideFox` in `content/game.ts`).

### Pushing

On the ground, fighters on the same floor whose push boxes (`ftData +0x50`: x offset, half width; Fox
0/3.3, Sandbag 0/6) overlap are nudged 0.3 units a frame apart (`ftCommon_8007E0E4`, x450). The
nudge is added to the position before self velocity in `procUpdate`.

### Deviations (hits)

* The stage/page UI pits Fox or Falco against Sandbag. The engine supports shield collisions and
  SDI for controlled fighters, but combat grabs, throws, clanks, reflections and teching are still
  absent. Shield break still drops the shield rather than playing the full stun sequence.
* Sandbag has no controller, so it does not use SDI. Knockback angle DI is not implemented.
* Hit sparks and the hitlag shake are 2D stand-ins drawn over the page.
* On a page, Sandbag respawns beside Fox at 0% once it is past the screen edge by 12 units on any
  side. In the game it can't be KO'd.

## Stages

Melee's stages from the disc, on the extension's own stage page (`stage.html`), in place of a web page.
Importer: `src/importer/stage-convert.ts`; engine loader: `loadStage` in `src/engine/load.ts`; page:
`StageArena` in `src/content/arena.ts` and `src/stage/stage-page.ts`.

* **Files.** `Gr*.dat` roots: `coll_data` (`MapCollData`, `mp/types.h`), `map_head`, `grGroundParam`.
  Final Destination is `GrNLa.dat`.
* **Collision** (`MapCollData`): `+0` vertices (`Vec2`), `+8` lines (`MapLine`, 0x10 bytes: vertex
  indices, neighbour links, `hi_flags`, `lo_flags`), `+0x10` line ranges for floor, ceiling, right
  wall, left wall, dynamic, `+0x24` collision joints (`MapJoint`, 0x28: their own ranges; lines of a
  moving part share one, which becomes the segment `group`). `lo_flags` bit 8 = pass-through
  platform, bit 9 = ledge line. A ledge line's ends are ledges where no other floor continues it
  (Final Destination's floor is three lines; only the outer ends are ledges). Right walls face right
  (`SegKind.WallRight`), left walls face left. Stored in `stage.json`, floors left to right, walls
  from the top point down.
* **General points** (`map_head +0`: 0xC-byte entries `{joint tree, pairs, count}`; pairs are
  `s16` depth-first joint index + point id; `Ground_801C1E94`, `Ground_801C2D24`): ids 0-3 player
  starts, 4-7 revival points, 0x94 camera centre, 0x95/0x96 camera range, 0x97/0x98 blast zone
  corners (`Ground_801C3BB4`; without them the game falls back to ±250, -100, 200). Positions are the
  joints' world translations in the rest pose. Final Destination: starts (±60, 10) and (±20, 10), blast
  zones ±246 / -140 / 188, camera range ±170 / -80 / 114.
* **Model** (`map_head +8`: 0x34-byte gobj descriptions, the joint tree first): Final Destination has
  10 parts: the stage (part 3), two floor strips, and backgrounds reaching z = -15000 (the warp
  tunnel). Each part is a folder like a character's (`parts/<n>/model/…`, `textures/`), drawn in its
  rest pose. Part 0 has joints but no geometry.
* **Engine.** Walls and ceilings may now slant (Final Destination's underside): a wall line's x at the
  ECB side point's height, a ceiling's y at the fighter's x. A side point outside the wall at last
  frame's height and inside it at this one goes back out, where "the wall" at last frame's height is
  a connected line of the same kind and group: sliding up a slant and passing the corner between two
  lines both work, which a single-line crossing test missed. Floors are still flat (Final
  Destination's and Battlefield's are). `setStage` with the same stage is a no-op, and a line's
  counterpart in a new stage is found by its place among its group's lines (a page element has one
  line per group, a stage's collision joint many: the first match used to slide fighters along).
* **Camera.** A perspective camera looking straight at z = 0 (30° vertical field of view), so the
  fighting plane maps linearly to the screen and the backgrounds get depth. It frames the fighters
  with a margin, at least ±55 units tall, keeps its centre inside the camera range, and eases toward
  that each frame.
* **The page.** `stage.html` loads `content.js` (which, on an extension page, only exposes `Game`) so
  the game ships once; `stage.js` is the menu. Alt+Shift+M (`choose-stage` command) asks the stage
  page in view to toggle its menu, or opens a new one. The menu pauses the game and takes the keyboard.

### Deviations (stages)

* Not Melee's camera: no tilt, no pan/zoom rules from `grGroundParam`; ours is a simple follow camera.
* Final Destination's parts stand still; its background doesn't morph. Battlefield reads joint and
  material/texture animations (details below). Particle bytecode is not interpreted.
* Floors must be flat; the other legal stages need slopes (Yoshi's Story), moving platforms
  (Fountain of Dreams, Randall) or transformations (Pokémon Stadium).
* Sandbag, which can't be KO'd in the game's VS mode, respawns at revival point 1 after leaving the
  blast zones; the player at revival point 0.

### Battlefield

* `GrNBa.dat`, using the existing stage importer. `grGroundParam +0` is the global scale (0.8 on
  this disc); apply it to collision, general points and the model placement. Without it, Battlefield
  is 25% too large. Floors stay flat. The raw underside has disconnected walls in the same collision
  group: wall continuation must follow shared endpoints, not jump to the nearest unrelated line.
* Fighters on different-height platforms also share that group. Ground push boxes now require the
  same floor height so the player and Sandbag don't push one another from different platforms.
* `src/importer/stage-animation.ts` reads the first AnimJoint/MatAnimJoint trees from the gobj's
  animation pointer arrays at +4/+8. AObjDesc: flags, end frame, FObjDesc list. FObjDesc: next,
  u32 byte length, f32 start frame, channel/value/slope bytes, stream pointer. The gobj's +0x28
  flag forces looping, in addition to AObj flag bit 29. Packed tracks are stored in each part's
  `animation.json` and sampled with the existing FObj interpreter.
* `StagePose` plays SRT and node/branch visibility channels, material RGB/alpha, texture offsets,
  scales and Z rotation. Texture transforms use repeat/scale and negative translation/rotation.
  Stage environment textures use a view-facing normal projection; this approximates HSD's mapping.
* VS scenery follows [grbattle.c](https://github.com/doldecomp/melee/blob/master/src/melee/gr/grbattle.c):
  part 6 is the stage, 1/2/4 the three backgrounds, 3 the transition; part 5 is alternate
  single-player scenery and is excluded. Wait 2400–3599 simulation frames, play the 400-frame
  transition, pick a different scene, then crossfade for 200 frames. The fade is a renderer
  approximation of the two color-overlay scripts in `yakumono_param`. All scenery pauses with play.
* Limitations: particle-emission channel 40 is retained but not played; no particle VM, full GX TEV
  combiner, or original camera rules. Existing hit sparks, shield and recovery effects still run.
* Disc-backed tests cover scale, platforms/drop-throughs, both characters' ledges, underside
  recovery without horizontal teleportation, respawn, push separation and animation loops/visibility/
  texture scrolling. `SCENARIO=stage STAGE=battlefield` checks import, rendering, pause and scene
  transitions in Chrome. Node tools use positional file reads because some Windows Node versions
  truncate `openAsBlob`'s size for padded ISOs over 4 GiB; browser imports still use File slices.

## Ledges

Ported from `ft/ftcliffcommon.c`, `ft/kinds/ftCommon/ftCo_Cliff*.c`, the ledge search in
`mp/mpcoll.c` (`mpColl_80044164` / `800443C4`) and `mp/mplib.c` (`mpLib_80051BA8_Floor`), and the
air-collision variants in `ft/ft_081B.c`. Engine: `src/engine/cliff.ts`, `findLedge` in `collision.ts`.

* **Where ledges are.** On a page, solid blocks (media, controls, boxes with a background or border)
  get a ledge at both top corners (`Segment.ledges`); text lines don't, like Melee's platforms, and
  neither do fixed/sticky blocks, whose corners sit at the edge of the screen. Final Destination's
  floor has both.
* **Catching.** Only while falling, facing the ledge (Firefox's flight and its end: either way,
  `CLIFFCATCH_BOTH`), not during the 30-frame cooldown after letting go (`ledge_cooldown`, x2064,
  counted in procUpdate outside hitlag), not while holding down past 0.66, and never for Sandbag.
  The search box reaches `ledge_snap_x` (11) ahead of the ECB, centred `ledge_snap_y` (13) above the
  fighter, `ledge_snap_height` (9) tall, all × model scale (`ftData +0x44 +0x10..0x18`), swept over
  the frame's movement. The fighter must be past the corner with the ECB bottom below it.
* **Which states catch.** Jump, double jump, Fall, FallAerial, FallSpecial, Pass, DamageFall
  (tumble), CliffJump2, and Fox's/Falco's SpecialHiHoldAir, SpecialAirHi, SpecialHiFall,
  SpecialAirSStart, SpecialAirS, SpecialAirSEnd. Not aerials, air dodge, the reflector or the
  blaster, and not DamageFly (the launch before tumble).
* **Hanging.** The catch turns the fighter to the stage, zeroes every velocity, resets jumps to one
  used (the double jump comes back) and plays sound 4 and FtSFX `x28`. Position is the ledge corner
  plus TransN (`x68C`, the root-motion sample), every frame, so the fighter moves with a scrolling
  page. CliffWait gives `cliff_intangible_frames` (30, x1990, counted in procAnim) of
  intangibility on every catch (Melee has no per-airtime limit), and lets go into DamageFall after
  640 frames (480 at `cliff_slow_percent` = 100% or more).
* **Getups** (CliffWait IASA in the game's order): A/B or C-stick up = attack (move ids 61/62, slow
  above 100%), L/R or C-stick toward the stage = roll, jump input = ledge jump, then the stick (only
  after it has been neutral once): up or toward the stage climbs, down or away lets go with the
  cooldown. A smashed-up stick is a tap jump, which the game checks before climbing. The getups
  hang from the corner until TransN is forward of and above it, then land on that floor and finish
  by root motion on the ground.
* **Body state.** Script command 26 (`body_state` in `.move` files, x1988) is now modelled: 2 makes
  hits pass through, 1 makes them connect without effect, and a motion change resets it. The
  getups, rolls and spot dodges use it. The hurt state is the larger of it and the timed one.
* `FORMAT_VERSION` is 4: the ledge box (`character.json` `ecb.ledgeSnap`) and constants
  (`common.json` `cliff_*`, `ledge_cooldown`) come from the disc, so earlier imports ask for it again.

### Deviations (ledges)

* Not validated frame by frame (no reference traces with ledges yet).
* One fighter per ledge is not enforced (`ft_80082E3C`): only the player can catch ledges.
* The game's line-of-sight checks between the fighter and the ledge always pass: page geometry has
  no walls.
* Ledge-catch effects (the flash, rumble) aren't drawn.

## Falco

Falco is the first character added through `CharacterSpec`. Everything he needs was already data or
Fox's code:

* **Same code as Fox.** `ftFc_Init_MotionStateTable` (`ft/kinds/ftFalco/ftfalco.c`) lists the ftFx
  functions for motion ids 341-375, and `ftFc_Init_LoadSpecialAttrs` calls Fox's. So his action
  names are `FOX_SUBMOTIONS`, his special attributes use `FOX_SPECIAL_FIELDS` (ftFox_DatAttrs, same
  layout), and his `.move` files attach the same behavior modules. The global state table and
  `specials` hooks serve both.
* **Files:** `PlFc.dat` (`ftDataFalco`), `PlFcNr.dat` (`PlyFalco5K_Share_joint`, 67 joints),
  `PlFcAJ.dat` (221 animations), `audio/us/falco.ssm` (bank 10: ids 100000+). Ft_Kind is 0x16 (22),
  which indexes PlCo's part table (RThumbNb = joint 61, the blaster's hand).
* **The one kind branch in Fox's code** that matters here is the blaster shot sound
  (`ftfoxspecialn.c`: `foxSFX` 110103/110106, `falcoSFX` 100099/100102), in `behaviors/blaster.ts`.
  The shot's item kind comes from the special attributes (`x1C`: Fox 54, Falco 55), and both kinds
  run the same FoxLaser item logic (`it/kinds/itfoxlaser.c`); what differs is the article data read
  from `PlFc.dat`: lifetime 100 (Fox 35) and hitboxes with knockback growth 100 and set knockback 5
  (Fox 0/0), which is why his lasers make Sandbag flinch.
* **His values from the disc:** gravity 0.17 (Fox 0.23), jumpsquat 5 (3), full jump 4.1 (3.68),
  weight 80 (75), dash 1.5 (2.2), model scale 1.1 (0.96); Fire Bird travels 22 frames (30); blaster
  velocity 5 (7).
* **On the page** the player's character comes from the `character` setting. Switching it while on a
  page replaces the engine (first in the World, so pad 0 still drives it) where the old one stood.
  The page's scale always comes from Fox's height, so Falco stands taller, as next to Fox in the
  game.
* An import from an earlier version has no `characters/falco/`, but `FORMAT_VERSION` 4 (ledges)
  asks every player to import the disc again anyway, which brings Falco in.
* His Phantasm is Fox's Illusion code with his own afterimage item (article 3, scale 1.1): 65° from
  the ground and a 270° spike in the air. See "Items: the side special's afterimage".

### Deviations (Falco)

* Not validated frame by frame: there are no reference traces of Falco yet. Recording some with
  melee-unlocked (Falco is `ckind` 20 on the character select screen, 22 internally) and running
  them through `tests/validate.ts` is the next step (the trace recorder can only swap player 2's
  character so far). Node tests check that every move plays through, his jumpsquat and jump height
  follow his attributes, his shot plays his sound, his laser flinches Sandbag, and his Phantasm
  hits at his own angles.
* His Phantasm afterimage is drawn like Fox's Illusion trail (the hit is the item's, as in the
  game, but the item's own model isn't drawn), and the lasers, reflector and flames use Fox's 2D
  stand-ins.
* Node's `openAsBlob` reports a disc image over 4 GB with its size mod 2^32, so the tests can't read
  such an `.iso` (a 1.4 GB `.ciso` of the same disc works). Browsers' `File` is not affected.

## Adding a character: what to reuse

The engine and importer now take a character spec (`CharacterSpec` in `importer/pipeline.ts`): file
code, Ft_Kind, its own submotion names, special-attribute fields, behavior modules, sound bank,
model constraints. Adding a fighter is:

1. **Import.** Add a spec, then check the new folder with the importer in Node (see
   `tools/datx.ts`: `roots`, `words` with `->` pointer paths).
2. **States.** Common states are shared. Motion ids from 341 up are the character's own, so the
   engine builds a separate state table for anything that reuses those ids (as Sandbag does).
3. **Specials.** Port the character's `ft/kinds/ftXxx/*.c` behavior like Fox's `behaviors/`.
4. **Validate.** Record traces with the new character as player 1 (or player 2 with
   `--p2-ckind`), then find the first diverging frame with `tools/tracediff.ts`.

`tools/e2e.mjs` checks the whole thing in real Chrome: it loads a copy of the extension over a CDP
pipe (`--remote-debugging-pipe --enable-unsafe-extension-debugging`, then `Extensions.loadUnpacked`;
branded Chrome ignores `--load-extension`), imports the disc with `DOM.setFileInputFiles`, and drives
a local test page with key events. The copy adds `http://127.0.0.1/*` to `host_permissions`, since
the real extension relies on activeTab (a click on the toolbar button).

Tools worth building next:

* A struct printer driven by the decomp headers. `types.h` comments carry every field's offset, so a
  script could turn `ftCommonData`, `ftCo_DatAttrs` or a special-attributes struct into the
  `Field[]` lists in `shared/attributes.ts`. Reading them by hand caused the `x424` mistake (a
  float read as an int).
* A script generator for validation runs. Moving Fox into range took several tries per script; a
  small search that runs the reference with a few timings and keeps the one where the hit connects
  would make coverage cheap.
* A table of motion id → move id / submotion / flags taken from `ftmotionstates.c` and each
  character's `MotionStateTable`, so `moveIdOf` and state names come from data.
