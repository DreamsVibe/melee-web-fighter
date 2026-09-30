"""Finds input timings for a validation script by recording variants in the real game.

    python tests/validation/search.py --melee-unlocked C:/melee-unlocked NAME TEMPLATE --values 250,254,258 \
        --want 352 [--p2-want 88] [--keep]

TEMPLATE is a script file whose text contains {T} (and optionally {T+n} / {T-n}), e.g. a run that stops at
frame {T} before an attack. Each value becomes tests/validation/scripts/zz_NAME_<value>.txt, all of
them are recorded at once, and each is reported with whether player 1 passed through motion id --want
(and player 2 through --p2-want) and where. With --keep, the first value that reaches every target is
saved as scripts/NAME.txt with its trace, and the variants are removed either way.
"""
import argparse
import csv
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
SCRIPTS = HERE / "scripts"
EXPECTED = REPO / "tests" / "expected"


def fill(template: str, t: int) -> str:
    return re.sub(r"\{T([+-]\d+)?\}", lambda m: str(t + int(m.group(1) or 0)), template)


def summary(trace: Path, want: int | None, p2_want: int | None) -> tuple[bool, str]:
    if not trace.exists():
        return False, "no trace"
    rows = list(csv.DictReader(trace.open()))
    hit1 = next((r for r in rows if want is not None and int(r["motion_id"]) == want), None)
    hit2 = next((r for r in rows if p2_want is not None and r.get("p2_motion_id") and int(r["p2_motion_id"]) == p2_want), None)
    ok = (want is None or hit1 is not None) and (p2_want is None or hit2 is not None)
    last = rows[-1] if rows else {}
    xs = [float(r["pos_x"]) for r in rows if int(r["retrace"]) >= 1590]
    parts = []
    if want is not None:
        parts.append(f"p1 {want} at {int(hit1['retrace']) - 1400} x={float(hit1['pos_x']):.1f}" if hit1 else f"p1 never {want}")
    if p2_want is not None:
        parts.append(f"p2 {p2_want} at {int(hit2['retrace']) - 1400}" if hit2 else f"p2 never {p2_want}")
    if xs:
        parts.append(f"x range [{min(xs):.1f}, {max(xs):.1f}]")
    pct = [float(r["p2_percent"]) for r in rows if r.get("p2_percent")]
    if pct:
        parts.append(f"p2 up to {max(pct):.0f}%")
    parts.append(f"ends motion {last.get('motion_id')}")
    return ok, "; ".join(parts)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--melee-unlocked", type=Path, required=True)
    ap.add_argument("name")
    ap.add_argument("template", type=Path)
    ap.add_argument("--values", required=True, help="comma-separated values for {T}")
    ap.add_argument("--want", type=int, help="player 1 motion id that must appear")
    ap.add_argument("--p2-want", type=int, help="player 2 motion id that must appear")
    ap.add_argument("--keep", action="store_true", help="save the first variant that works as NAME")
    ap.add_argument("-j", "--jobs", type=int, default=8)
    args = ap.parse_args()

    template = args.template.read_text(encoding="utf-8")
    values = [int(v) for v in args.values.split(",")]
    names = []
    for v in values:
        n = f"zz_{args.name}_{v}"
        (SCRIPTS / f"{n}.txt").write_text(fill(template, v), encoding="utf-8")
        names.append(n)
    subprocess.run([sys.executable, str(HERE / "run_reference.py"), "--melee-unlocked", str(args.melee_unlocked),
                    "-j", str(args.jobs), *names], check=True, capture_output=True)
    chosen = None
    for v, n in zip(values, names):
        ok, text = summary(EXPECTED / f"{n}.csv", args.want, args.p2_want)
        print(f"{'OK ' if ok else '-- '} {v}: {text}")
        if ok and chosen is None:
            chosen = (v, n)
    if args.keep and chosen:
        v, n = chosen
        (SCRIPTS / f"{args.name}.txt").write_text(fill(template, v), encoding="utf-8")
        (EXPECTED / f"{n}.csv").replace(EXPECTED / f"{args.name}.csv")
        print(f"kept {v} as scripts/{args.name}.txt")
    for n in names:
        (SCRIPTS / f"{n}.txt").unlink(missing_ok=True)
        (EXPECTED / f"{n}.csv").unlink(missing_ok=True)


if __name__ == "__main__":
    main()
