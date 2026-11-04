#!/usr/bin/env python3
"""abr-sup-routing oracle (RECURRING-DESIGN §3.6). Host-side; it never reads a solver's output to decide what was right.

Inputs per trigger: the host-only truth row (gen.py), world_before and world_after (WorldState JSON dumps taken just
before and just after the arm handled the trigger; world_before already holds the trigger's delta), and, at the last
trigger of the week (Friday's day close), end.json plus world0.

Checks per trigger:
  1. effects   every expected effect is found in THIS trigger's ledger (attribution): each expected route is a change
               of that ticket (by record id) whose group_id is the expected queue, with exactly one new note whose
               text is the expected `routed to <queue> (<rule>)` and which is private (internal), earlier notes
               unchanged, and no other ticket field changed (updated_at excepted: the API sets it); each expected
               #support-routing post with the exact text. Texts compare after collapsing whitespace and ignoring
               letter case; one trailing period is tolerated.
  2. envelope  every record created, changed or removed in this trigger is an expected effect (nothing else):
               no other ticket change or note, no extra post, no sheet, contact or company edit.
  3. ab        the truth's AutomationBench assertion dicts (freshdesk_ticket_exists with group_id,
               freshdesk_ticket_has_note / _not_has_note, slack_message_exists), checked with AutomationBench's own
               AssertionRegistry on an attribution view: world_after with each ticket's notes, the Slack messages
               and the sheet rows restricted to what this trigger created or changed.
  4. end       (last trigger only) every ticket's final group, status, priority, tags, subject, description and
               requester, its earlier notes unchanged and its routing notes as a multiset; no ticket added or
               removed; contacts and companies unchanged; Customer Tiers as the week's deltas left it and the Queue
               Routing Config unchanged; the week's #support-routing messages as a multiset; no pre-existing Slack
               message edited or removed; plus AutomationBench's freshdesk_ticket_exists per routed ticket and
               slack_text_occurrence_count per daily post on the whole world.

Outcome: correct (all checks pass) | abstained (only #automation-review posts, truth is not an escalation) |
miss (no effect at all, truth expected effects) | wrong (anything else). `pass` includes the envelope; `pass_core`
is the same verdict without it (reported beside the headline).
"""
from __future__ import annotations

import copy
import json
from collections import Counter, defaultdict

SS, WS_TIERS, WS_QUEUE = "ss_support_ops", "ws_tiers", "ws_queue_config"
ROUTING, REVIEW = "support-routing", "automation-review"
TICKET_FIELDS_ALLOWED = {"group_id", "notes", "updated_at"}
END_FIELDS = ("group_id", "status", "priority", "tags", "subject", "description", "requester_id")


import sys as _b0_sys  # B0: experiments/autobench on the path for the shared abr.lib
from pathlib import Path as _B0Path
if str(_B0Path(__file__).resolve().parents[2]) not in _b0_sys.path:
    _b0_sys.path.append(str(_B0Path(__file__).resolve().parents[2]))
from abr.lib import common as _abr_common  # noqa: E402
from abr.lib import host as _abr_host  # noqa: E402


canon = _abr_common.canon


def text_key(s) -> str:
    """Whitespace collapsed, letter case ignored, one trailing period tolerated."""
    t = " ".join(str(s or "").split()).lower()
    return t[:-1].rstrip() if t.endswith(".") else t


def _key(app: str, coll: str, rec) -> str:
    if app == "slack" and coll == "messages" and isinstance(rec, dict):
        return f"msg:{rec.get('channel_id')}|{rec.get('ts')}"
    if isinstance(rec, dict) and rec.get("id") is not None:
        return f"id:{rec['id']}"
    return "c:" + canon(rec)


def ledger(before: dict, after: dict) -> list[dict]:
    """Every record created, changed or removed between two world dumps, all apps (meta excluded)."""
    out = []
    for app in sorted(set(before) | set(after)):
        if app == "meta":
            continue
        a, b = before.get(app), after.get(app)
        if canon(a) == canon(b):
            continue
        if not isinstance(a, dict) or not isinstance(b, dict):
            out.append({"app": app, "coll": None, "op": "replace", "key": app, "before": a, "after": b})
            continue
        for coll in sorted(set(a) | set(b)):
            x, y = a.get(coll), b.get(coll)
            if canon(x) == canon(y):
                continue
            if isinstance(x, list) and isinstance(y, list) and all(isinstance(r, dict) for r in x + y):
                gx, gy = defaultdict(list), defaultdict(list)
                for r in x:
                    gx[_key(app, coll, r)].append(r)
                for r in y:
                    gy[_key(app, coll, r)].append(r)
                for k in sorted(set(gx) | set(gy)):
                    bx, by = gx.get(k, []), gy.get(k, [])
                    for i in range(max(len(bx), len(by))):
                        rb = bx[i] if i < len(bx) else None
                        ra = by[i] if i < len(by) else None
                        if rb is None:
                            out.append({"app": app, "coll": coll, "op": "new", "key": k, "before": None, "after": ra})
                        elif ra is None:
                            out.append({"app": app, "coll": coll, "op": "removed", "key": k, "before": rb, "after": None})
                        elif canon(rb) != canon(ra):
                            fields = sorted(f for f in set(rb) | set(ra) if canon(rb.get(f)) != canon(ra.get(f)))
                            out.append({"app": app, "coll": coll, "op": "changed", "key": k, "before": rb, "after": ra,
                                        "fields": fields})
            else:
                out.append({"app": app, "coll": coll, "op": "field", "key": f"{app}.{coll}", "before": x, "after": y})
    return out


_chan_id = _abr_common._chan_id


def status_key(s) -> str:
    return " ".join(str(s or "").split()).lower()


def _sheet_ids(world: dict, row: dict) -> tuple[str, str]:
    """A row's (spreadsheet id, worksheet id), resolving a title written in place of an id."""
    gs = world.get("google_sheets", {})
    s = row.get("spreadsheet_id")
    if not any(x.get("id") == s for x in gs.get("spreadsheets", [])):
        s = next((x["id"] for x in gs.get("spreadsheets", []) if status_key(x.get("title")) == status_key(s)), s)
    w = row.get("worksheet_id")
    if not any(x.get("id") == w and x.get("spreadsheet_id") == s for x in gs.get("worksheets", [])):
        w = next((x["id"] for x in gs.get("worksheets", []) if x.get("spreadsheet_id") == s
                  and status_key(x.get("title")) == status_key(w)), w)
    return s, w


def sheet_rows(world: dict, ws: str) -> list[dict]:
    return [r for r in world.get("google_sheets", {}).get("rows", []) if _sheet_ids(world, r) == (SS, ws)]


def new_notes(before_ticket: dict | None, after_ticket: dict) -> list[dict]:
    old = {n.get("id") for n in (before_ticket or {}).get("notes", [])}
    return [n for n in after_ticket.get("notes", []) if n.get("id") not in old]


def summarize(it: dict) -> str:
    rec = it.get("after") or it.get("before") or {}
    if it["app"] == "slack" and it.get("coll") == "messages":
        return f"slack.{it['op']} {rec.get('channel_id')}: {str(rec.get('text'))[:80]!r}"
    if it["app"] == "freshdesk" and it.get("coll") == "tickets":
        extra = ""
        if it["op"] == "changed":
            nn = [n.get("body") for n in new_notes(it["before"], it["after"])]
            extra = f" fields={it['fields']} group={rec.get('group_id')} new_notes={nn[:2]}"
        return f"freshdesk.ticket.{it['op']} {rec.get('id')}{extra}"
    if it["app"] == "google_sheets" and it.get("coll") == "rows":
        return f"sheets.row.{it['op']} {rec.get('worksheet_id')}#{rec.get('row_id')} {it.get('fields', '')}"
    return f"{it['app']}.{it.get('coll')}.{it['op']} {it['key']}"


class Grader:
    """Grades one trigger. Loads AutomationBench's assertion handlers lazily (they need its venv)."""

    def __init__(self, use_ab: bool = True):
        self.use_ab = use_ab
        if use_ab:
            import automationbench.rubric.assertions  # noqa: F401  (registers the handlers)
            from automationbench.rubric.registry import AssertionRegistry
            from automationbench.schema.world import WorldState
            self.Registry, self.WorldState = AssertionRegistry, WorldState

    def grade(self, truth: dict, before: dict, after: dict, end: dict | None = None, world0: dict | None = None) -> dict:
        L = ledger(before, after)
        used: set[int] = set()
        checks: list[dict] = []
        exp = truth["expect"]

        def check(name, ok, detail="", group="effects"):
            checks.append({"name": name, "ok": bool(ok), "detail": detail, "group": group})

        # 1. effects ------------------------------------------------------------------------------------------------
        for rt in exp["routes"]:
            idx = next((i for i, it in enumerate(L) if it["app"] == "freshdesk" and it["coll"] == "tickets"
                        and it["op"] == "changed" and it["key"] == f"id:{rt['ticket_id']}"), None)
            name = f"route {rt['ticket_id']}"
            if idx is None:
                check(name, False, f"ticket {rt['ticket_id']} not changed (want {rt['group']}, note {rt['note']!r})")
                continue
            used.add(idx)
            b, a = L[idx]["before"], L[idx]["after"]
            ok_group = a.get("group_id") == rt["group"]
            kept = Counter(canon(n) for n in a.get("notes", [])) >= Counter(canon(n) for n in b.get("notes", []))
            nn = new_notes(b, a)
            ok_note = len(nn) == 1 and text_key(nn[0].get("body")) == text_key(rt["note"]) and nn[0].get("private") is True
            other = [f for f in L[idx]["fields"] if f not in TICKET_FIELDS_ALLOWED]
            check(name, ok_group and ok_note and kept and not other,
                  f"group {a.get('group_id')!r} (want {rt['group']!r}); new notes "
                  f"{[(n.get('body'), n.get('private')) for n in nn][:3]} (want one private {rt['note']!r}); "
                  f"earlier notes kept {kept}; other fields {other}")

        routing, review = _chan_id(after, ROUTING), _chan_id(after, REVIEW)
        new_msgs = [i for i, it in enumerate(L) if it["app"] == "slack" and it["coll"] == "messages" and it["op"] == "new"]
        for text in exp["posts"]:
            cands = [i for i in new_msgs if i not in used and L[i]["after"].get("channel_id") == routing
                     and not L[i]["after"].get("is_deleted") and text_key(L[i]["after"].get("text")) == text_key(text)]
            if cands:
                used.add(cands[0])
            check(f"post {text[:40]}", bool(cands), f"no new #{ROUTING} message {text!r}")
        if exp.get("escalate"):
            cands = [i for i in new_msgs if i not in used and L[i]["after"].get("channel_id") == review
                     and truth["trigger"] in (L[i]["after"].get("text") or "")]
            if cands:
                used.add(cands[0])
            check("escalate", bool(cands), f"no #{REVIEW} post naming {truth['trigger']}")

        # 2. envelope -----------------------------------------------------------------------------------------------
        extra = [summarize(L[i]) for i in range(len(L)) if i not in used]
        check("envelope", not extra, "; ".join(extra[:6]), group="envelope")

        # 3. AutomationBench's own assertion handlers on this trigger's effects -----------------------------------
        if self.use_ab and truth["assertions"]:
            view = self.attribution_view(before, after, L)
            failed = []
            for a in truth["assertions"]:
                try:
                    ok = bool(self.Registry.check(view, a))
                except Exception as e:  # noqa: BLE001  a raising handler is a failed check, reported
                    ok, a = False, dict(a, error=f"{type(e).__name__}: {e}")
                if not ok:
                    failed.append(a)
            check("ab", not failed, f"{len(failed)} failed: {[(a['type'], a.get('ticket_id'), a.get('body_contains') or a.get('group_id') or a.get('text_contains')) for a in failed][:4]}",
                  group="ab")

        # 4. end of week ---------------------------------------------------------------------------------------------
        if end is not None:
            checks.extend(self.end_checks(end, after, world0))

        ok_all = all(c["ok"] for c in checks)
        ok_core = all(c["ok"] for c in checks if c["group"] != "envelope")
        only_review = bool(L) and all(it["app"] == "slack" and it["coll"] == "messages" and it["op"] == "new"
                                      and (it["after"] or {}).get("channel_id") == review for it in L)
        if ok_all:
            outcome = "correct"
        elif not L:
            outcome = "miss" if truth["outcome"] != "no-op" else "wrong"
        elif only_review and not exp.get("escalate"):
            outcome = "abstained"
        else:
            outcome = "wrong"
        return {"trigger": truth["trigger"], "kind": truth["kind"], "expected": truth["outcome"],
                "outcome": outcome, "pass": ok_all, "pass_core": ok_core,
                "score": round(sum(c["ok"] for c in checks) / len(checks), 4) if checks else 1.0,
                "n_effects": len(L), "failed": [c for c in checks if not c["ok"]], "n_checks": len(checks)}

    def attribution_view(self, before: dict, after: dict, L: list[dict]):
        """world_after with ticket notes, Slack messages and sheet rows restricted to what this trigger created or
        changed, so an earlier trigger's note or post never satisfies this trigger's assertion (and never trips its
        negative ones)."""
        v = copy.deepcopy(after)
        keep_msgs = {it["key"] for it in L if it["app"] == "slack" and it["coll"] == "messages" and it["op"] in ("new", "changed")}
        keep_rows = {it["key"] for it in L if it["app"] == "google_sheets" and it["coll"] == "rows" and it["op"] in ("new", "changed")}
        v["slack"]["messages"] = [m for m in v["slack"]["messages"] if _key("slack", "messages", m) in keep_msgs]
        old = {t.get("id"): t for t in before.get("freshdesk", {}).get("tickets", [])}
        for t in v["freshdesk"]["tickets"]:
            t["notes"] = new_notes(old.get(t.get("id")), t)
        rows = [r for r in v["google_sheets"]["rows"] if _key("google_sheets", "rows", r) in keep_rows]
        for r in rows:
            r["spreadsheet_id"], r["worksheet_id"] = _sheet_ids(after, r)
        v["google_sheets"]["rows"] = rows
        return self.WorldState(**v)

    def end_checks(self, end: dict, after: dict, world0: dict | None) -> list[dict]:
        out = []

        def check(name, ok, detail=""):
            out.append({"name": name, "ok": bool(ok), "detail": detail, "group": "end"})

        tickets = {t.get("id"): t for t in after["freshdesk"]["tickets"]}
        missing = sorted(set(end["tickets"]) - set(tickets))
        extra = sorted(set(tickets) - set(end["tickets"]))
        bad = []
        for tid, want in end["tickets"].items():
            t = tickets.get(tid)
            if t is None:
                continue
            for f in END_FIELDS:
                if canon(t.get(f)) != canon(want[f]):
                    bad.append(f"{tid}: {f} {t.get(f)!r} != {want[f]!r}")
            by_id = {n.get("id"): n for n in t.get("notes", [])}
            for n0 in want["notes0"]:
                if n0["id"] not in by_id or by_id[n0["id"]].get("body") != n0["body"]:
                    bad.append(f"{tid}: note {n0['id']} edited or removed")
            ids0 = {n0["id"] for n0 in want["notes0"]}
            got = Counter(text_key(n.get("body")) for n in t.get("notes", []) if n.get("id") not in ids0)
            if got != Counter(text_key(x) for x in want["routing_notes"]):
                bad.append(f"{tid}: notes {sorted(got.elements())[:3]} != {want['routing_notes'][:3]}")
        check("end.tickets", not missing and not extra and not bad,
              f"missing {len(missing)}; extra {len(extra)}; " + "; ".join(bad[:6]))
        tiers = {str(r.get("row_id")): r.get("cells") for r in sheet_rows(after, WS_TIERS)}
        check("end.tiers", canon(tiers) == canon(end["tiers"]), "Customer Tiers differs from the week's own edits")
        if world0 is not None:
            q0 = sorted(canon(r.get("cells")) for r in sheet_rows(world0, WS_QUEUE))
            q = sorted(canon(r.get("cells")) for r in sheet_rows(after, WS_QUEUE))
            check("end.config", q == q0, "the Queue Routing Config was edited")
            check("end.directory", canon(world0["freshdesk"]["contacts"]) == canon(after["freshdesk"]["contacts"])
                  and canon(world0["freshdesk"]["companies"]) == canon(after["freshdesk"]["companies"]),
                  "Freshdesk contacts or companies were edited")
            keys0 = {_key("slack", "messages", m) for m in world0["slack"]["messages"]}
            routing = _chan_id(after, ROUTING)
            got = Counter(text_key(m.get("text")) for m in after["slack"]["messages"]
                          if _key("slack", "messages", m) not in keys0 and m.get("channel_id") == routing and not m.get("is_deleted"))
            want = Counter(text_key(t) for t in end["routing"])
            check("end.routing", got == want, f"missing {list((want - got).elements())[:3]}; extra {list((got - want).elements())[:3]}")
            touched = [summarize(it) for it in ledger(world0, after)
                       if it["op"] in ("changed", "removed") and it["app"] == "slack"]
            check("end.preexisting-unchanged", not touched, "; ".join(touched[:6]))
        if self.use_ab and end["assertions"]:
            w = self.WorldState(**copy.deepcopy(after))
            failed = [a for a in end["assertions"] if not self.Registry.check(w, a)]
            check("end.ab", not failed, f"{len(failed)} failed: {[(a['type'], a.get('ticket_id') or a.get('text')) for a in failed][:4]}")
        return out
