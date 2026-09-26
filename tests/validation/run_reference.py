"""Records reference traces from the real game with melee-unlocked's --fighter-trace option.

    python tests/validation/run_reference.py --melee-unlocked C:\\melee-unlocked [--iso path] [names...]

For every script in tests/validation/scripts/ (prelude.txt + the script's @match section), runs
melee_port headless and writes tests/expected/<name>.csv: one row per frame for port 1's fighter
(state, animation frame, position, velocities, facing, ground/air) plus the pad the game read that
frame. Those traces come from the user's own disc, so tests/expected/ is git-ignored; they are
recreated on each machine. `npm test` then drives the web engine with the same pads and compares.

Needs a melee-unlocked build with --fighter-trace (the fighter-trace branch) and the disc it was
built for (melee.iso at its root, or --iso).
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
OUT = REPO / "tests" / "expected"
# Script frames are relative to this retrace. With the prelude the match scene starts at 1418 and Fox
# can act from 1524 (after his entry and landing), so in-match inputs begin at 200 (= 1600).
MATCH_BASE = 1400


def absolute(script_text: str) -> str:
    out = []
    for line in script_text.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            out.append(line)
            continue
        frame, _, rest = s.partition(" ")
        out.append(f"{int(frame) + MATCH_BASE} {rest}".rstrip())
    return "\n".join(out) + "\n"


def run(exe: Path, iso: Path, cwd: Path, script: Path, trace: Path, card: Path, work: Path, frames: int) -> None:
    user = work / "user"
    user.mkdir(parents=True, exist_ok=True)
    (user / "user.json").write_text("{}", encoding="utf-8")   # signed out: the menus stay offline
    cmd = [str(exe), "--iso", str(iso), "--headless", "--volume", "0", "--fast", "--frames", str(frames),
           "--time-base", "1", "--card-dir", str(card), "--user-dir", str(user),
           "--replay-dir", str(work / "replays"), "--log-file", str(work / f"{script.stem}.log"),
           "--script", str(script)]
    if trace:
        cmd += ["--fighter-trace", str(trace)]
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=900)
    if proc.returncode:
        sys.exit(f"{script.name}: melee_port exited {proc.returncode}\n{proc.stderr[-2000:]}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--melee-unlocked", type=Path, required=True)
    ap.add_argument("--iso", type=Path)
    ap.add_argument("--frames", type=int, default=2300)
    ap.add_argument("names", nargs="*")
    args = ap.parse_args()
    root = args.melee_unlocked.resolve()
    exe = root / "build-review" / "port" / "Release" / "melee_port.exe"
    iso = (args.iso or root / "melee.iso").resolve()
    if not exe.exists():
        sys.exit(f"no melee_port.exe at {exe}: build the fighter-trace branch first")
    if not iso.exists():
        sys.exit(f"no disc at {iso}: pass --iso")

    OUT.mkdir(parents=True, exist_ok=True)
    work = OUT / ".work"
    work.mkdir(exist_ok=True)
    prelude = (HERE / "prelude.txt").read_text(encoding="utf-8")

    # The scripted menu path reaches a VS match only once the memory card holds a save: boot once
    # with the prelude to create it, then copy that card for every run.
    seed = work / "card-seed"
    if not any(seed.glob("*.gci")):
        shutil.rmtree(seed, ignore_errors=True)
        seed_script = work / "seed.txt"
        seed_script.write_text(prelude, encoding="utf-8")
        run(exe, iso, root, seed_script, None, seed, work, 1600)

    scripts = sorted((HERE / "scripts").glob("*.txt"))
    if args.names:
        scripts = [s for s in scripts if s.stem in args.names]
    for s in scripts:
        full = work / f"{s.stem}.full.txt"
        full.write_text(prelude + absolute(s.read_text(encoding="utf-8")), encoding="utf-8")
        card = work / f"card-{s.stem}"
        shutil.rmtree(card, ignore_errors=True)
        shutil.copytree(seed, card)
        trace = OUT / f"{s.stem}.csv"
        run(exe, iso, root, full, trace, card, work, args.frames)
        rows = max(0, len(trace.read_text().splitlines()) - 1) if trace.exists() else 0
        print(f"{s.stem}: {rows} frames -> {trace.relative_to(REPO)}")


if __name__ == "__main__":
    main()
