"""Shared stream assembly for factory families: events -> triggers (payload, host-only delta, traps), the truth engine's
per-trigger expected effects, the end table, hashes and the serve-input row for model arms.

A family's model.py subclasses Gen and implements: plan() (adds events and the latent world), world0() (the initial
world in AutomationBench's dumped shape), decide(trigger) -> list of expected effects (reading LATENT state only and
updating the latent state of record), end_tables(). The reference never imports this module.
"""
from __future__ import annotations

import hashlib
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .clock import iso_z
from .world import at_ms, gmail_message

UTC = timezone.utc


def canon(x) -> str:
    return json.dumps(x, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(x) -> str:
    return hashlib.sha256((x if isinstance(x, str) else canon(x)).encode()).hexdigest()


class Gen:
    FAMILY = "abr-?"
    VERSION = "0.0.0"
    SPEC: dict = {}
    KIND_ORDER = {"email": 0, "opened": 1, "updated": 2, "check": 3}

    def __init__(self, seed: int, rename: bool = False, shift_days: int = 0):
        self.seed, self.rename, self.shift_days = seed, rename, shift_days
        self.rng = random.Random(f"{self.FAMILY}:{self.VERSION}:{seed}")
        self.events: list[dict] = []
        self.world_traps: list[str] = []
        self.injections: list[dict] = []          # exact labels of planted violations (third oracle where used)

    # -- ids -----------------------------------------------------------------------------------------------------------
    def uid(self, alphabet: str, n: int) -> str:
        return "".join(self.rng.choice(alphabet) for _ in range(n))

    def hexid(self, n=16) -> str:
        return self.uid("0123456789abcdef", n)

    # -- events --------------------------------------------------------------------------------------------------------
    def event(self, at: datetime, kind: str, app: str, ev: str, data: dict, delta: list, traps=(), sub: str = "", **kw):
        if at.microsecond:
            raise ValueError(f"event time {at} has sub-second precision: latent times must be whole seconds")
        self.events.append({"at": at, "kind": kind, "app": app, "event": ev, "data": data, "delta": delta,
                            "traps": sorted(set(traps)), "sub": sub, **kw})

    def email_event(self, at: datetime, frm: str, to: str, subject: str, body: str, traps=(), sub="", from_name=None, **kw):
        at = at.replace(microsecond=0)      # an email's latent time is only its trigger time, so truncation is safe here
        mid = self.hexid(16)
        msg = gmail_message(mid, self.hexid(16), frm, [to], subject, body, at_ms(iso_z(at)), from_name=from_name)
        self.event(at, "email", "gmail", "new_email", {"message_id": mid, "from": frm, "subject": subject},
                   [{"op": "add_email", "message": msg}], traps, sub, msg=msg, **kw)
        return mid

    # -- assembly ------------------------------------------------------------------------------------------------------
    def triggers(self) -> list[dict]:
        ev = sorted(self.events, key=lambda e: (e["at"], self.KIND_ORDER[e["kind"]], e.get("order", 0)))
        start = self.start_dt
        out = []
        for i, e in enumerate(ev):
            tid = f"{self.FAMILY.split('-', 1)[1]}-s{self.seed}-t{i:03d}"
            at = iso_z(e["at"])
            out.append({"index": i, "trigger": tid, "at": at, "kind": e["kind"], "sub": e["sub"],
                        "week": min(3, max(0, (e["at"] - start).days // 7)),
                        "payload": {"trigger": tid, "at": at, "app": e["app"], "event": e["event"], "data": e["data"]},
                        "delta": e["delta"], "traps": e["traps"], "_e": e})
        return out

    def run(self) -> dict:
        self.plan()
        trig = self.triggers()
        w0 = self.world0()
        truth = []
        for t in trig:
            exp, info = self.decide(t)
            t["traps"] = sorted(set(t["traps"]) | set(info.get("traps", ())) | ({"T-repeat"} if info.get("needs_state") else set()))
            truth.append({"trigger": t["trigger"], "index": t["index"], "at": t["at"], "kind": t["kind"],
                          "expect": exp, "clauses": sorted({e["clause"] for e in exp}),
                          "needs_state": bool(info.get("needs_state")), "traps": t["traps"]})
        for t in trig:
            t.pop("_e")
        end = {"tables": self.end_tables()}
        out = {"world0": w0, "triggers": trig, "payloads": [t["payload"] for t in trig], "truth": truth, "end": end,
               "world_traps": sorted(set(self.world_traps)), "injections": self.injections}
        out["meta"] = {"family": self.FAMILY, "version": self.VERSION, "seed": self.seed, "rename": self.rename,
                       "shift_days": self.shift_days, "start": iso_z(self.start_dt), "triggers": len(trig),
                       "sha256": {k: sha(out[k]) for k in ("world0", "payloads", "triggers", "truth", "end")}}
        return out


def serve_input(family: str, policy_text: str, apps: list[str], seed: int, trigger: dict, intake_text: str | None = None) -> dict:
    """The input row for `bridge.py serve --input <row> --world <world_t>` for ONE trigger: the family's apps only, no
    assertions (the truth never enters the serve process), meta.current_time = trigger time. The prompt holds only
    arm-visible text: the policy (or, for a messy-intake stream, the request text) and the payload."""
    info = {"task_name": f"{family}.s{seed}.t{trigger['index']:03d}", "zapier_tools": [], "assertions": [],
            "initial_state": {"meta": {"schema_version": "0.1.0", "current_time": trigger["at"]}, **{a: {} for a in apps}}}
    head = intake_text if intake_text is not None else policy_text
    return {"example_id": trigger["index"],
            "prompt": [{"role": "system", "content": "standing automation " + family},
                       {"role": "user", "content": head + "\n\nTrigger:\n" + canon(trigger["payload"])}],
            "answer": "", "info": json.dumps(info)}


def load_spec(here: Path) -> dict:
    return json.loads((here / "family.spec.json").read_text())
