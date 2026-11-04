#!/usr/bin/env python3
"""family.spec compiler (PLAN §6.2: one spec, four artifacts).

    python3 -I experiments/autobench/abr/lib/factory/spec.py experiments/autobench/families/<family> [--check]

From family.spec.json it writes POLICY.md (what every arm receives on a policy-intake stream) and compiled.json (oracle
attribution, hard clauses, the sink, the control roster, the static G0 lint). The generator + truth engine (model.py)
and the observable-only reference (reference.py) read the same spec for every constant, so they share the spec and not
code (N-version). Controls are generated from the clause and trap rosters (controls.py). --check fails when the
committed POLICY.md / compiled.json differ from a fresh compile.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def flat_params(spec: dict) -> dict:
    p = dict(spec.get("params", {}))
    lead = p.get("lead_hours") or {}
    out = {k: v for k, v in p.items() if not isinstance(v, dict)}
    if lead:
        out["lead_range_lo"], out["lead_range_hi"] = lead["range"]
    for k, v in p.items():
        if k.endswith("range") and isinstance(v, list) and len(v) == 2:
            out[f"{k}_lo"], out[f"{k}_hi"] = v
    for k, v in (spec.get("tolerance") or {}).items():
        out[f"tol_{k}"] = v
    out.update({k: v for k, v in spec.get("channels", {}).items()})
    out.update({k: v for k, v in spec.get("calendar", {}).items() if isinstance(v, str)})
    out.update({k: v for k, v in spec.get("org", {}).items() if isinstance(v, str)})
    return out


def fill(text: str, params: dict) -> str:
    def rep(m):
        k = m.group(1)
        if k not in params:
            raise KeyError(f"clause text names unknown parameter {{{k}}}")
        return str(params[k])
    return re.sub(r"\{([a-z_0-9]+)\}", rep, text)


def lint(spec: dict) -> list[str]:
    """G0, static part: every trap resolvable by a declared clause; every effect attributed to a clause; every clause
    either produces an attributed effect or is a declared quiet clause; every parameter in clause text defined; every
    sheet column a clause names exists."""
    problems = []
    ids = {c["id"] for c in spec["clauses"]}
    params = flat_params(spec)
    for t in spec["traps"]:
        if not t.get("resolved_by") or not set(t["resolved_by"]) <= ids:
            problems.append(f"trap {t['id']} has no resolving clause in {sorted(ids)}")
        if not t.get("control"):
            problems.append(f"trap {t['id']} has no named control")
    attributed = set()
    for k, cl in spec["effects"].items():
        for c in cl.split("|"):
            if c not in ids:
                problems.append(f"effect {k} attributed to unknown clause {c}")
            attributed.add(c)
    for c in spec["clauses"]:
        if c["id"] not in attributed and not c.get("quiet") and "Quiet" not in c["title"]:
            problems.append(f"clause {c['id']} produces no attributed effect and is not declared quiet")
        try:
            fill(c["text"], params)
        except KeyError as e:
            problems.append(f"clause {c['id']}: {e}")
    cols = {s: set(v["human"]) | set(v["state"]) for s, v in spec["sheets"].items()}
    for k in spec["effects"]:
        parts = k.split(":")
        if parts[0] in ("cells",) and (parts[1] not in cols or parts[2] not in cols[parts[1]]):
            problems.append(f"effect {k} names a column that no sheet has")
        if parts[0] == "append" and parts[1] not in cols:
            problems.append(f"effect {k} names an unknown sheet")
    return problems


def controls_roster(spec: dict) -> list[str]:
    out = ["null", "echo", "naive", "memoryless"]
    out += [f"clause_{c['id']}" for c in spec["clauses"]]
    out += sorted({t["control"] for t in spec["traps"]})
    return out


def render_policy(spec: dict) -> str:
    p = flat_params(spec)
    org, ch, cal = spec["org"], spec["channels"], spec["calendar"]
    lines = [f"# {spec['title']}: standing automation policy (edition 1)", "",
             f"*{spec['fiction']}*", "",
             "You run as a standing automation: you are invoked once per trigger (a scheduled check, a new or changed "
             "tracker row, or an email to the automation inbox) with the trigger payload and the tools "
             "`api_search`, `api_fetch` and `base64_encode` on the simulated apps "
             f"({', '.join(spec['host']['apps'])}). You keep no memory between triggers: everything you need is in "
             "the apps, and the tracker's state columns are the state of record.", "",
             "## Where things are", "",
             f"- Automation inbox: `{org['inbox']}`. Channels: " + ", ".join(f"#{v}" for v in ch.values()) + ".",
             f"- Scheduled checks: {', '.join(cal['checks_utc'])} UTC on working days. Working day: Monday to Friday, "
             "not a date on the Holidays sheet." + (f" Local time zone for calendar days: {cal['tz']}." if cal.get("tz") else ""),
             ""]
    for name, s in spec["sheets"].items():
        cols = ", ".join(s["human"])
        st = (" State columns you maintain: " + ", ".join(s["state"]) + ".") if s["state"] else ""
        lines.append(f"- Sheet **{name}** (spreadsheet `{s['ss']}`): {cols}.{st}")
    lines += ["", "Names, ids, addresses and statuses compare exactly unless a rule says otherwise; post texts compare "
              "ignoring letter case and runs of spaces. Times you write are UTC instants `YYYY-MM-DDTHH:MM:SSZ`.", "",
              "## Rules", ""]
    for c in spec["clauses"]:
        lines += [f"### {c['id']}. {c['title']}", "", fill(c["text"], p), ""]
    lines += ["## Anything else", "",
              f"Do nothing that no rule asks for. When a rule cannot be applied as written, post one line naming the "
              f"trigger id in #{ch['sink']} and change nothing else.", ""]
    return "\n".join(lines)


def compile_family(d: Path, check: bool = False) -> dict:
    spec = json.loads((d / "family.spec.json").read_text())
    problems = lint(spec)
    compiled = {"id": spec["id"], "version": spec["version"], "sink": spec["channels"]["sink"],
                "attribution": spec["effects"], "hard_clauses": [c["id"] for c in spec["clauses"] if c.get("hard")],
                "controls": controls_roster(spec), "clauses": [c["id"] for c in spec["clauses"]],
                "traps": [t["id"] for t in spec["traps"]], "g0_static": {"pass": not problems, "problems": problems}}
    policy = render_policy(spec)
    ctext = json.dumps(compiled, indent=1) + "\n"
    if check:
        same = (d / "POLICY.md").read_text() == policy and (d / "compiled.json").read_text() == ctext
        if not same:
            raise SystemExit(f"{d.name}: POLICY.md or compiled.json is stale; recompile")
    else:
        (d / "POLICY.md").write_text(policy)
        (d / "compiled.json").write_text(ctext)
    return compiled


if __name__ == "__main__":
    out = compile_family(Path(sys.argv[1]).resolve(), check="--check" in sys.argv)
    print(json.dumps(out["g0_static"]))
    sys.exit(0 if out["g0_static"]["pass"] else 1)
