#!/usr/bin/env python3
"""abr-ops-mailroom oracle (RECURRING-DESIGN §3.6). Host-side; it never reads a solver's output to decide what was right.

Inputs per trigger: the host-only truth row (gen.py), world_before and world_after (WorldState JSON dumps taken just
before and just after the arm handled the trigger; world_before already holds the trigger's delta), and, at the last
trigger of the week (Friday's day close), end.json plus world0.

Checks per trigger:
  1. effects   every expected effect is found in THIS trigger's ledger (attribution): each expected Status change on
               the right package row (by record id) with no other cell or row field changed; each expected #mailroom
               post with the exact text; each expected SMS to the exact number with the exact text. Texts compare
               after collapsing whitespace; a trailing period is tolerated.
  2. envelope  every record created, changed or removed in this trigger is an expected effect (nothing else):
               no extra post, SMS, sheet edit, directory edit or other app write.
  3. ab        the truth's AutomationBench assertion dicts (twilio_sms_sent / _not_sent, slack_message_exists /
               _not_exists, google_sheets_row_exists), checked with AutomationBench's own AssertionRegistry on an
               attribution view: world_after restricted to the messages, SMS and rows this trigger created or changed.
  4. end       (last trigger only) every package row's final Status and unchanged other cells, no row added or
               removed, the directory and policy sheet as expected, the week's #mailroom posts and SMS as multisets,
               no pre-existing message or SMS edited, plus AutomationBench's slack_text_occurrence_count per routed
               tracking number and twilio_message_count per notified phone on the whole world.

Outcome: correct (all checks pass) | abstained (only #automation-review posts, truth is not an escalation) |
miss (no effect at all, truth expected effects) | wrong (anything else). `pass` includes the envelope; `pass_core`
is the same verdict without it (reported beside the headline).
"""
from __future__ import annotations

import copy
import json
from collections import Counter, defaultdict

SS, WS_PKG, WS_EMP, WS_POL = "ss_mailroom", "ws_packages", "ws_employees", "ws_mailroom_policy"
MAILROOM, REVIEW = "mailroom", "automation-review"


def canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def text_key(s) -> str:
    """Whitespace collapsed, one trailing period tolerated; case and every other character count."""
    t = " ".join(str(s or "").split())
    return t[:-1].rstrip() if t.endswith(".") else t


def status_key(s) -> str:
    return " ".join(str(s or "").split()).lower()


def _key(app: str, coll: str, rec) -> str:
    if app == "slack" and coll == "messages" and isinstance(rec, dict):
        return f"msg:{rec.get('channel_id')}|{rec.get('ts')}"
    if isinstance(rec, dict) and rec.get("sid") is not None:
        return f"sid:{rec['sid']}"
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


def _chan_id(world: dict, name: str):
    return next((c["id"] for c in world.get("slack", {}).get("channels", []) if c.get("name") == name), None)


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


def summarize(it: dict) -> str:
    rec = it.get("after") or it.get("before") or {}
    if it["app"] == "slack" and it.get("coll") == "messages":
        return f"slack.{it['op']} {rec.get('channel_id')}: {str(rec.get('text'))[:80]!r}"
    if it["app"] == "twilio":
        return f"twilio.{it.get('coll')}.{it['op']} to={rec.get('to_number')} {str(rec.get('body'))[:60]!r}"
    if it["app"] == "google_sheets" and it.get("coll") == "rows":
        return (f"sheets.row.{it['op']} {rec.get('worksheet_id')}#{rec.get('row_id')} "
                f"{(rec.get('cells') or {}).get('Tracking Number') or (rec.get('cells') or {}).get('Name')} {it.get('fields', '')}")
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
        for st in exp["status"]:
            idx = next((i for i, it in enumerate(L) if it["app"] == "google_sheets" and it["coll"] == "rows"
                        and it["op"] == "changed" and it["key"] == f"id:{st['id']}"), None)
            if idx is None:
                check(f"status {st['trk']}", False, f"row {st['row_id']} not changed (want Status {st['status']!r})")
                continue
            used.add(idx)
            b, a = L[idx]["before"], L[idx]["after"]
            ok_status = status_key(a["cells"].get("Status")) == status_key(st["status"])
            other_cells = sorted(k for k in set(a["cells"]) | set(b["cells"])
                                 if k != "Status" and str(a["cells"].get(k, "")) != str(b["cells"].get(k, "")))
            other_fields = [f for f in L[idx]["fields"] if f != "cells"]
            check(f"status {st['trk']}", ok_status and not other_cells and not other_fields,
                  f"Status {a['cells'].get('Status')!r} (want {st['status']!r}); other cells {other_cells}; fields {other_fields}")

        mailroom, review = _chan_id(after, MAILROOM), _chan_id(after, REVIEW)
        new_msgs = [i for i, it in enumerate(L) if it["app"] == "slack" and it["coll"] == "messages" and it["op"] == "new"]
        for text in exp["posts"]:
            cands = [i for i in new_msgs if i not in used and L[i]["after"].get("channel_id") == mailroom
                     and not L[i]["after"].get("is_deleted") and text_key(L[i]["after"].get("text")) == text_key(text)]
            if cands:
                used.add(cands[0])
            check(f"post {text[:40]}", bool(cands), f"no new #mailroom message {text!r}")
        new_sms = [i for i, it in enumerate(L) if it["app"] == "twilio" and it["coll"] == "sms_messages" and it["op"] == "new"]
        for to, body in exp["sms"]:
            cands = [i for i in new_sms if i not in used and L[i]["after"].get("to_number") == to
                     and text_key(L[i]["after"].get("body")) == text_key(body)]
            if cands:
                used.add(cands[0])
            check(f"sms {body[:40]}", bool(cands), f"no new SMS to {to} {body!r}")
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
            check("ab", not failed, f"{len(failed)} failed: {[(a['type'], a.get('text_contains') or a.get('body_contains') or a.get('cells')) for a in failed][:4]}",
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
        """world_after with Slack messages, SMS and sheet rows restricted to what this trigger created or changed, so
        an earlier trigger's post never satisfies this trigger's assertion (and never trips its negative ones)."""
        v = copy.deepcopy(after)
        keep_msgs = {it["key"] for it in L if it["app"] == "slack" and it["coll"] == "messages" and it["op"] in ("new", "changed")}
        keep_sms = {it["key"] for it in L if it["app"] == "twilio" and it["coll"] == "sms_messages" and it["op"] in ("new", "changed")}
        keep_rows = {it["key"] for it in L if it["app"] == "google_sheets" and it["coll"] == "rows" and it["op"] in ("new", "changed")}
        v["slack"]["messages"] = [m for m in v["slack"]["messages"] if _key("slack", "messages", m) in keep_msgs]
        v["twilio"]["sms_messages"] = [m for m in v["twilio"]["sms_messages"] if _key("twilio", "sms_messages", m) in keep_sms]
        rows = [r for r in v["google_sheets"]["rows"] if _key("google_sheets", "rows", r) in keep_rows]
        for r in rows:
            r["spreadsheet_id"], r["worksheet_id"] = _sheet_ids(after, r)
        v["google_sheets"]["rows"] = rows
        return self.WorldState(**v)

    def end_checks(self, end: dict, after: dict, world0: dict | None) -> list[dict]:
        out = []

        def check(name, ok, detail=""):
            out.append({"name": name, "ok": bool(ok), "detail": detail, "group": "end"})

        rows = {r.get("id"): r for r in sheet_rows(after, WS_PKG)}
        missing = sorted(set(end["statuses"]) - set(rows))
        extra = sorted(set(rows) - set(end["statuses"]))
        bad = []
        for rid, want in end["statuses"].items():
            r = rows.get(rid)
            if r is None:
                continue
            c = r.get("cells") or {}
            if status_key(c.get("Status")) != status_key(want):
                bad.append(f"{c.get('Tracking Number')}#{r.get('row_id')}: Status {c.get('Status')!r} != {want!r}")
            other = {k: str(v) for k, v in c.items() if k != "Status" and str(v or "") != ""}
            if other != {k: str(v) for k, v in end["rows"][rid].items() if str(v or "") != ""}:
                bad.append(f"{c.get('Tracking Number')}#{r.get('row_id')}: other cells changed")
        check("end.packages", not missing and not extra and not bad,
              f"missing rows {len(missing)}; extra rows {len(extra)}; " + "; ".join(bad[:6]))
        directory = {str(r.get("row_id")): r.get("cells") for r in sheet_rows(after, WS_EMP)}
        check("end.directory", canon(directory) == canon(end["directory"]), "the Employee Directory was edited")
        if world0 is not None:
            pol0 = sorted(canon(r.get("cells")) for r in sheet_rows(world0, WS_POL))
            pol = sorted(canon(r.get("cells")) for r in sheet_rows(after, WS_POL))
            check("end.policies", pol == pol0, "the Mailroom Policies sheet was edited")
            keys0 = {_key("slack", "messages", m) for m in world0["slack"]["messages"]}
            mailroom = _chan_id(after, MAILROOM)
            got = Counter(text_key(m.get("text")) for m in after["slack"]["messages"]
                          if _key("slack", "messages", m) not in keys0 and m.get("channel_id") == mailroom and not m.get("is_deleted"))
            want = Counter(text_key(t) for t in end["mailroom"])
            check("end.mailroom", got == want, f"missing {list((want - got).elements())[:3]}; extra {list((got - want).elements())[:3]}")
            sids0 = {m.get("sid") for m in world0["twilio"]["sms_messages"]}
            got = Counter((m.get("to_number"), text_key(m.get("body"))) for m in after["twilio"]["sms_messages"] if m.get("sid") not in sids0)
            want = Counter((to, text_key(b)) for to, b in end["sms"])
            check("end.sms", got == want, f"missing {list((want - got).elements())[:3]}; extra {list((got - want).elements())[:3]}")
            touched = [summarize(it) for it in ledger(world0, after)
                       if it["op"] in ("changed", "removed") and it["app"] in ("slack", "twilio")]
            check("end.preexisting-unchanged", not touched, "; ".join(touched[:6]))
        if self.use_ab and end["assertions"]:
            w = self.WorldState(**copy.deepcopy(after))
            failed = [a for a in end["assertions"] if not self.Registry.check(w, a)]
            check("end.ab", not failed, f"{len(failed)} failed: {[(a['type'], a.get('text') or a.get('to_number')) for a in failed][:4]}")
        return out
