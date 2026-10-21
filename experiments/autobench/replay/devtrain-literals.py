"""devTrain literals for the A1-C v2 leakage scan (experiments/autobench/test/codeowned-v2.test.mjs, test 18).

Developer tool (not imported by any harness module). It loads the public task definitions the way bridge.py does and
writes, for the scan only:
  names     every public task name (names only, every split: the L1 rule); devTrainNames the devTrain ones,
  strings   the string values (>= 16 characters, whitespace collapsed; not bare timestamps or numbers) of the initial
            worlds of devTrain tasks,
  shingles  the 8-word shingles of the user prompts of devTrain tasks (lower case, the test's tokenization).
devTrain = SPLIT-v1 dev minus devCheck. Nothing of a devCheck or test task is read beyond its name.

usage: python -I devtrain-literals.py --out FILE [--split research/automationbench-20261014/SPLIT-v1.json]
"""
import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]


def words(s):
    return [w for w in re.sub(r"[^a-z0-9@.'-]+", " ", s.lower()).strip().split(" ") if w]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--split", default=str(REPO / "research/automationbench-20261014/SPLIT-v1.json"))
    a = ap.parse_args()
    split = json.loads(Path(a.split).read_text())
    dev_train = set(split["dev"]) - set(split["devCheck"])
    from automationbench.domains import DOMAINS
    names, train_names, strings, shingles = set(), set(), set(), set()
    for d in ["sales", "marketing", "operations", "support", "finance", "hr", "simple"]:
        for row in DOMAINS[d]():
            info = json.loads(row["info"]) if isinstance(row["info"], str) else row["info"]
            name = info["task_name"]
            names.add(name)
            if name not in dev_train:
                continue
            train_names.add(name)
            stack = [info.get("initial_state") or {}]
            while stack:
                v = stack.pop()
                if isinstance(v, dict):
                    stack.extend(v.values())
                elif isinstance(v, list):
                    stack.extend(v)
                elif isinstance(v, str):
                    t = re.sub(r"\s+", " ", v).strip()
                    # Machine values (timestamps, numbers) are not task content: every world shares their shapes.
                    if len(t) >= 16 and not re.fullmatch(r"[\d\s:.,TZ+\-/]+", t):
                        strings.add(t)
            text = "\n".join(m["content"] for m in row["prompt"] if m.get("role") == "user" and isinstance(m.get("content"), str))
            w = words(text)
            for i in range(0, max(0, len(w) - 7)):
                shingles.add(" ".join(w[i:i + 8]))
    Path(a.out).write_text(json.dumps({"devTrain": len(dev_train), "names": sorted(names), "devTrainNames": sorted(train_names), "strings": sorted(strings), "shingles": sorted(shingles)}))
    print(json.dumps({"names": len(names), "strings": len(strings), "shingles": len(shingles)}), file=sys.stderr)


if __name__ == "__main__":
    main()
