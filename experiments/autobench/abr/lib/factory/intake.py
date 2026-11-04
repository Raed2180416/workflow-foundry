#!/usr/bin/env python3
"""Messy-intake variants (PLAN §6.2, §6.6): a stream may start from a messy natural-language request instead of
POLICY.md. The request is rendered deterministically from the family's phrasebank (one phrasing per slot, chosen by a
hash of the seed, plus noise), and every phrase must pass, before a stream may use it:

  1. the answerability lint ($0): every slot the truth needs is recoverable from the rendered text: the slot's value
     appears, and the phrase's own pattern extracts exactly that value from the WHOLE request (no other sentence
     competes);
  2. the reference classification ($0): the same extraction recovers every slot of the spec (`classify`), so the
     observable-only reference could be configured from the text alone;
  3. the model-diverse panel (paid; Haiku 5.5, Sonnet 5.5, Mercury 3; admitted at 2 of 3): `panel-prompts` writes the
     exact prompts and the command; nothing here calls a model. Until the panel runs, phrases are `panel: pending` in
     ADMISSION.json and the sealed messy streams carry intake version `v0-prepanel` (a panel veto replaces the vetoed
     phrase by the next variant, deterministically, recorded as a dated amendment before any V arm runs).

    python3 -I intake.py lint --family abr-reg-incident-clock
    python3 -I intake.py render --family abr-reg-incident-clock --seed 2113
    python3 -I intake.py panel-prompts --family abr-reg-incident-clock --out DIR
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FAMILIES = HERE.parents[2] / "families"
VERSION = "v0-prepanel"


def load(family: str) -> tuple[dict, dict]:
    d = FAMILIES / family
    return json.loads((d / "family.spec.json").read_text()), json.loads((d / "phrasebank.json").read_text())


def slot_value(spec: dict, path: str):
    cur = spec
    for part in path.split("."):
        cur = cur[part]
    return cur


def fmt(v) -> str:
    if isinstance(v, list):
        return ", ".join(str(x) for x in v)
    return str(v)


def pick(seed: int, key: str, n: int) -> int:
    return int(hashlib.sha256(f"intake:{seed}:{key}".encode()).hexdigest()[:8], 16) % n


def pattern(phrase: str) -> re.Pattern:
    """A phrase's own extractor: the literal text around {v}, spacing-tolerant, value captured."""
    parts = [re.escape(p).replace("\\ ", r"\s+") for p in phrase.split("{v}")]
    return re.compile(parts[0] + r"(?P<v>.+?)" + (parts[1] if len(parts) > 1 and parts[1] else r"(?=[.;,\n]|$)"), re.I | re.S)


def render(family: str, seed: int, overrides: dict | None = None) -> dict:
    spec, pb = load(family)
    overrides = overrides or {}
    used = {}
    lines = [pb["open"][pick(seed, "open", len(pb["open"]))]]
    slots = list(pb["slots"].items())
    order = sorted(range(len(slots)), key=lambda k: hashlib.sha256(f"order:{seed}:{k}".encode()).hexdigest())
    noise = list(pb["noise"])
    for n, k in enumerate(order):
        name, s = slots[k]
        i = overrides.get(name, pick(seed, name, len(s["phrases"])))
        phrase = s["phrases"][i]
        used[name] = i
        lines.append(phrase.replace("{v}", fmt(slot_value(spec, name))))
        if n % 3 == 1 and noise:
            lines.append(noise.pop(pick(seed, f"noise{n}", len(noise))))
    lines.append(pb["close"][pick(seed, "close", len(pb["close"]))])
    text = "\n\n".join(lines) if pick(seed, "layout", 2) else " ".join(lines)
    return {"family": family, "seed": seed, "intake_version": VERSION, "text": text, "phrases": used,
            "sha256": hashlib.sha256(text.encode()).hexdigest()}


def classify(family: str, text: str) -> dict:
    """The reference's reading of a request: every slot recovered by any of its phrasings' extractors."""
    spec, pb = load(family)
    out = {}
    for name, s in pb["slots"].items():
        hits = set()
        for ph in s["phrases"]:
            for m in pattern(ph).finditer(text):
                hits.add(" ".join(m.group("v").split()).strip(" ."))
        out[name] = sorted(hits)
    return out


def lint(family: str, seeds=range(2101, 2161)) -> dict:
    spec, pb = load(family)
    problems = []
    need = set(spec["intake"]["slots"])
    missing = sorted(need - set(pb["slots"]))
    if missing:
        problems.append(f"slots the truth needs but the phrasebank lacks: {missing}")
    for name, s in pb["slots"].items():
        for i, ph in enumerate(s["phrases"]):
            if ph.count("{v}") != 1:
                problems.append(f"{name}[{i}] must carry exactly one {{v}}")
    checked = 0
    for seed in seeds:
        r = render(family, seed)
        got = classify(family, r["text"])
        for name in pb["slots"]:
            want = fmt(slot_value(spec, name))
            if want not in r["text"]:
                problems.append(f"seed {seed}: value of {name} ({want}) not in the request")
            if got[name] != [want]:
                problems.append(f"seed {seed}: {name} reads as {got[name]}, intended [{want}]")
        checked += 1
    return {"pass": not problems, "family": family, "seeds_checked": checked, "phrases": sum(len(s["phrases"]) for s in pb["slots"].values()),
            "problems": problems[:20], "n_problems": len(problems)}


PANEL_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "mercury-3"]


def panel_prompts(family: str) -> list[dict]:
    spec, pb = load(family)
    out = []
    for name, s in pb["slots"].items():
        for i, ph in enumerate(s["phrases"]):
            text = ph.replace("{v}", fmt(slot_value(spec, name)))
            out.append({"family": family, "slot": name, "variant": i, "sentence": text,
                        "question": f"In this sentence from a request for an automation, what value does the requester give for "
                                    f"'{s.get('ask', name)}'? Answer with the value only, or UNCLEAR.",
                        "intended": fmt(slot_value(spec, name)), "models": PANEL_MODELS, "admit": "2 of 3 answer the intended value"})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["lint", "render", "panel-prompts"])
    ap.add_argument("--family", required=True)
    ap.add_argument("--seed", type=int, default=2113)
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    if a.cmd == "lint":
        res = lint(a.family)
        print(json.dumps(res, indent=1))
        sys.exit(0 if res["pass"] else 1)
    if a.cmd == "render":
        print(json.dumps(render(a.family, a.seed), indent=1))
    else:
        rows = panel_prompts(a.family)
        if a.out:
            Path(a.out).mkdir(parents=True, exist_ok=True)
            p = Path(a.out) / f"panel-{a.family}.jsonl"
            p.write_text("".join(json.dumps(r) + "\n" for r in rows))
        print(json.dumps({"prompts": len(rows), "calls": len(rows) * len(PANEL_MODELS)}))


if __name__ == "__main__":
    main()
