#!/usr/bin/env python3
"""abr-ops-slawatch oracle (RECURRING-DESIGN §3.6). Host-side; it never reads a solver's output to decide what was right.

Inputs per trigger: the host-only truth row (gen.py), world_before and world_after (WorldState JSON dumps taken just
before and just after the arm handled the trigger), and, at the last trigger (the Friday 17:00 check, the week close),
end.json plus world0.

Checks per trigger:
  1. effects   every expected effect is found in THIS trigger's ledger (attribution), each record used once:
               warning = SMS (to the agent's E.164 phone, from +15550001111, text `SLA warning <ID>: due HH:MM UTC`)
               + a top-level, undeleted #support-escalation post (the line `<ID> | <Subject> | due HH:MM UTC | <Agent>`)
               + one email from the automation inbox to the support manager only (subject `SLA warning <ID>`, body
               holding the line) + the tracker row's Warned At / Warned Agent / Warned Deadline (and nothing else on
               that row); reassignment = SMS to the new phone + Warned Agent only; breach = Jira create_issue (project
               SUPPORT, summary `SLA breach <ID>`) + a top-level, undeleted post exactly `BREACHED <ID>` (case,
               whitespace and trailing punctuation ignored) + Breached At only; authorized amendment = one Policy Log
               row (Value digits only); escalation = at least one top-level #automation-review post naming the trigger.
               SMS and warning posts must carry the policy literal with at most a short greeting before it and no
               negation or retraction words outside it (lib.alert_ok).
  2. envelope  every record created, changed or removed in this trigger is an expected effect (nothing else). Marking
               inbound email read / labelling it is harmless.
  3. timing    every record the trigger created carries the check's time (the determinism shim's clock starts at the
               trigger time): within [at, at + 10 min]; Warned At and Breached At equal the check time (any ISO form).
  4. ab        the truth's AutomationBench assertion dicts, checked with AutomationBench's own AssertionRegistry on
               world_after. A cross-check only: it is reported (`ab_disagree` on a passing verdict) and never decides a
               trigger, because its matching rules (raw substrings, exact cells) differ from the policy's (case and
               whitespace ignored), so it could reject a policy-equivalent value alone. Every effect it covers is also
               covered by checks 1, 2 and 5.
  5. end       (week close only) per ticket, this week's SMS recipients, warning posts, emails, BREACHED posts and Jira
               issues equal the truth's exact counts; every tracker row's final cells (ticket columns untouched, state
               columns as the truth); the Policy Log rows; and no pre-existing record changed.

Outcome: correct (all checks pass) | abstained (only #automation-review posts, truth expected no escalation) |
miss (no effect at all, truth expected effects) | wrong (anything else). `pass` includes the envelope; `pass_core`
is the same verdict without it (reported beside the headline).
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta

import lib as L
from lib import alert_ok, canon, exact_text_ok, has_token, norm, norm_ci, parse_instant, visible_post

GMAIL_HARMLESS = {"is_read", "label_ids", "is_starred"}
TIMING_SLACK = timedelta(minutes=10)


def _key(app: str, coll: str, rec) -> str:
    if app == "slack" and coll == "messages" and isinstance(rec, dict):
        return f"msg:{rec.get('channel_id')}|{rec.get('ts')}"
    if app == "twilio" and isinstance(rec, dict) and rec.get("sid"):
        return f"sid:{rec['sid']}"
    if isinstance(rec, dict) and rec.get("id") is not None:
        return f"id:{rec['id']}"
    return "c:" + canon(rec)


def _diff_lists(app: str, coll: str, x: list, y: list, out: list):
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
                it = {"app": app, "coll": coll, "op": "changed", "key": k, "before": rb, "after": ra, "fields": fields}
                if app == "google_sheets" and coll == "rows":
                    cb, ca = rb.get("cells") or {}, ra.get("cells") or {}
                    it["cells"] = sorted(c for c in set(cb) | set(ca) if canon(cb.get(c, "")) != canon(ca.get(c, "")))
                out.append(it)


def ledger(before: dict, after: dict) -> list[dict]:
    """Every record created, changed or removed between two world dumps, all apps (jira.actions flattened by key)."""
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
            if app == "jira" and coll == "actions" and isinstance(x, dict) and isinstance(y, dict):
                for ak in sorted(set(x) | set(y)):
                    xs, ys = x.get(ak) or [], y.get(ak) or []
                    if canon(xs) != canon(ys):
                        _diff_lists(app, f"actions:{ak}", xs, ys, out)
            elif isinstance(x, list) and isinstance(y, list) and all(isinstance(r, dict) for r in x + y):
                _diff_lists(app, coll, x, y, out)
            else:
                out.append({"app": app, "coll": coll, "op": "field", "key": f"{app}.{coll}", "before": x, "after": y})
    return out


def _chan_id(world: dict, name: str):
    return next((c["id"] for c in world.get("slack", {}).get("channels", []) if c.get("name") == name), None)


def _recipients(m: dict) -> set[str]:
    out = set()
    for f in ("to", "cc", "bcc"):
        for a in m.get(f) or []:
            mm = re.search(r"<([^>]+)>", a or "")
            out.add((mm.group(1) if mm else (a or "")).strip().lower())
    return out


def _sms_time(rec):
    return parse_instant(rec.get("date_created"))


def _slack_time(rec):
    try:
        return datetime.fromtimestamp(float(rec.get("ts")), tz=L.UTC)
    except (TypeError, ValueError):
        return None


def _mail_time(rec):
    try:
        return datetime.fromtimestamp(int(rec.get("date")) / 1000, tz=L.UTC)
    except (TypeError, ValueError):
        return None


def _jira_time(rec):
    return parse_instant(rec.get("created_at"))


def created_at(it: dict):
    rec = it["after"] or {}
    if it["app"] == "twilio":
        return _sms_time(rec)
    if it["app"] == "slack" and it["coll"] == "messages":
        return _slack_time(rec)
    if it["app"] == "gmail" and it["coll"] == "messages":
        return _mail_time(rec)
    if it["app"] == "jira":
        return _jira_time(rec)
    return None


def same_instant(a, b) -> bool:
    x, y = parse_instant(a), parse_instant(b)
    return x is not None and y is not None and x == y


def summarize(it: dict) -> str:
    rec = it.get("after") or it.get("before") or {}
    if it["app"] == "slack" and it.get("coll") == "messages":
        return f"slack.{it['op']} {rec.get('channel_id')}: {str(rec.get('text'))[:90]!r}"
    if it["app"] == "twilio":
        return f"twilio.{it['op']} to={rec.get('to_number')} {str(rec.get('body'))[:70]!r}"
    if it["app"] == "gmail" and it.get("coll") == "messages":
        return f"gmail.{it['op']} to={rec.get('to')} {rec.get('subject')!r} {it.get('fields', '')}"
    if it["app"] == "jira":
        return f"jira.{it['coll']}.{it['op']} {rec.get('params')}"
    if it["app"] == "google_sheets" and it.get("coll") == "rows":
        cid = (rec.get("cells") or {}).get("Ticket ID") or (rec.get("cells") or {}).get("Parameter")
        return f"sheets.row.{it['op']} {rec.get('worksheet_id')}/{cid} {it.get('cells', '')}"
    return f"{it['app']}.{it.get('coll')}.{it['op']} {it['key']}"


def harmless(it: dict) -> bool:
    return it["app"] == "gmail" and it["coll"] == "messages" and it["op"] == "changed" \
        and set(it["fields"]) <= GMAIL_HARMLESS and "SENT" not in ((it["before"] or {}).get("label_ids") or [])


class Grader:
    """Grades one trigger. Loads AutomationBench's assertion handlers lazily (they need its venv)."""

    def __init__(self, use_ab: bool = True):
        self.use_ab = use_ab
        if use_ab:
            import automationbench.rubric.assertions  # noqa: F401  (registers the handlers)
            from automationbench.rubric.registry import AssertionRegistry
            from automationbench.schema.world import WorldState
            self.Registry, self.WorldState = AssertionRegistry, WorldState

    def ab_failures(self, world: dict, asserts: list[dict]) -> list[dict]:
        if not (self.use_ab and asserts):
            return []
        w = self.WorldState(**world)
        return [a for a in asserts if not self.Registry.check(w, a)]

    def grade(self, truth: dict, before: dict, after: dict, end: dict | None = None, world0: dict | None = None) -> dict:
        Lg = ledger(before, after)
        used: set[int] = set()
        checks: list[dict] = []
        exp = truth["expect"]
        now = parse_instant(truth["at"])
        esc, sink = _chan_id(after, L.ESC), _chan_id(after, L.SINK)

        def check(name, ok, detail="", group="effects"):
            checks.append({"name": name, "ok": bool(ok), "detail": detail, "group": group})

        def find(pred, idxs):
            return next((i for i in idxs if i not in used and pred(Lg[i]["after"] or {})), None)

        new_sms = [i for i, it in enumerate(Lg) if it["app"] == "twilio" and it["coll"] == "sms_messages" and it["op"] == "new"]
        new_posts = [i for i, it in enumerate(Lg) if it["app"] == "slack" and it["coll"] == "messages" and it["op"] == "new"]
        new_mail = [i for i, it in enumerate(Lg) if it["app"] == "gmail" and it["coll"] == "messages" and it["op"] == "new"]
        new_jira = [i for i, it in enumerate(Lg) if it["app"] == "jira" and it["coll"] == "actions:create_issue" and it["op"] == "new"]
        row_chg = {(Lg[i]["after"] or {}).get("id"): i for i, it in enumerate(Lg)
                   if it["app"] == "google_sheets" and it["coll"] == "rows" and it["op"] == "changed"}
        new_rows = [i for i, it in enumerate(Lg) if it["app"] == "google_sheets" and it["coll"] == "rows" and it["op"] == "new"]

        def sms_check(name, to, token):
            i = find(lambda r: r.get("to_number") == to and r.get("from_number") == L.SMS_FROM
                     and alert_ok(r.get("body"), token), new_sms)
            if i is None:
                near = [(Lg[j]["after"].get("to_number"), Lg[j]["after"].get("body")) for j in new_sms if j not in used]
                check(name, False, f"no new SMS from {L.SMS_FROM} to {to} with {token!r}" + (f" (new SMS: {near[:3]})" if near else ""))
            else:
                used.add(i)
                check(name, True)

        def row_check(name, rid, allowed: set[str], want: dict):
            i = row_chg.get(rid)
            if i is None:
                check(name, False, f"tracker row {rid} not changed")
                return
            used.add(i)
            it = Lg[i]
            other = [f for f in it["fields"] if f != "cells"]
            extra = [c for c in it["cells"] if c not in allowed]
            check(name + ".only-state-columns", not other and not extra, f"also changed {other + extra}")
            cells = (it["after"] or {}).get("cells") or {}
            for col, (kind, val) in want.items():
                got = cells.get(col)
                if kind == "instant":
                    ok = same_instant(got, val)
                    check(f"{name}.{col}", ok, f"{col} {got!r} != {val}", group="timing" if col in ("Warned At", "Breached At") else "effects")
                else:
                    check(f"{name}.{col}", norm_ci(got) == norm_ci(val), f"{col} {got!r} != {val!r}")

        # 1. effects ----------------------------------------------------------------------------------------------
        for w in exp["warn"]:
            tid = w["tid"]
            sms_check(f"warn.sms {tid}", w["to"], w["sms"])
            i = find(lambda r: r.get("channel_id") == esc and visible_post(r) and alert_ok(r.get("text"), w["line"]),
                     new_posts)
            if i is not None:
                used.add(i)
            check(f"warn.post {tid}", i is not None, f"no new top-level #{L.ESC} post with {w['line']!r}")
            i = find(lambda r: "SENT" in (r.get("label_ids") or []) and _recipients(r) == {L.MANAGER}
                     and L.sender_ok(r) and norm_ci(r.get("subject")) == norm_ci(L.warn_subject(tid))
                     and has_token(r.get("body_plain") or r.get("body_html") or "", w["line"]), new_mail)
            if i is not None:
                used.add(i)
            else:
                near = [(Lg[j]["after"].get("to"), Lg[j]["after"].get("subject")) for j in new_mail if j not in used]
                check(f"warn.email {tid}", False, f"no email from the automation inbox to {L.MANAGER} only, subject "
                                                  f"{L.warn_subject(tid)!r}, body with the line"
                                                  + (f" (new mail: {near[:3]})" if near else ""))
            if i is not None:
                check(f"warn.email {tid}", True)
            row_check(f"warn.row {tid}", w["rid"], {"Warned At", "Warned Agent", "Warned Deadline"},
                      {"Warned At": ("instant", truth["at"]), "Warned Agent": ("text", w["agent"]),
                       "Warned Deadline": ("instant", w["deadline"])})
        for x in exp["reassign"]:
            sms_check(f"reassign.sms {x['tid']}", x["to"], x["sms"])
            row_check(f"reassign.row {x['tid']}", x["rid"], {"Warned Agent"}, {"Warned Agent": ("text", x["agent"])})
        for b in exp["breach"]:
            tid = b["tid"]
            i = find(lambda r: norm((r.get("params") or {}).get("project")) == L.JIRA_PROJECT
                     and norm_ci((r.get("params") or {}).get("summary")) == norm_ci(L.breach_summary(tid)), new_jira)
            if i is not None:
                used.add(i)
            check(f"breach.jira {tid}", i is not None, f"no new Jira issue in {L.JIRA_PROJECT} '{L.breach_summary(tid)}'")
            i = find(lambda r: r.get("channel_id") == esc and visible_post(r) and exact_text_ok(r.get("text"), L.breach_post(tid)),
                     new_posts)
            if i is not None:
                used.add(i)
            check(f"breach.post {tid}", i is not None, f"no new top-level #{L.ESC} post exactly '{L.breach_post(tid)}'")
            row_check(f"breach.row {tid}", b["rid"], {"Breached At"}, {"Breached At": ("instant", truth["at"])})
        for p in exp["policy_rows"]:
            i = next((j for j in new_rows if j not in used and (Lg[j]["after"] or {}).get("worksheet_id") == L.WS_POLICY
                      and self.policy_row_ok((Lg[j]["after"] or {}).get("cells") or {}, p)), None)
            if i is not None:
                used.add(i)
            check("policy.row", i is not None, f"no new Policy Log row {p}")
        if exp["escalate"]:
            # one post per undecidable item or one combined post: every top-level #automation-review post naming the
            # trigger counts, at least one is required
            hits = [j for j in new_posts if j not in used and (Lg[j]["after"] or {}).get("channel_id") == sink
                    and visible_post(Lg[j]["after"] or {}) and has_token((Lg[j]["after"] or {}).get("text"), truth["trigger"])]
            used.update(hits)
            check("escalate", bool(hits), f"no top-level #{L.SINK} post naming {truth['trigger']}")

        # 2. envelope ----------------------------------------------------------------------------------------------
        extra = [summarize(Lg[i]) for i in range(len(Lg)) if i not in used and not harmless(Lg[i])]
        check("envelope", not extra, "; ".join(extra[:6]), group="envelope")

        # 3. timing of every record this trigger created -----------------------------------------------------------
        late = []
        for i in sorted(used):
            if Lg[i]["op"] != "new":
                continue
            ts = created_at(Lg[i])
            if ts is not None and not (now - timedelta(seconds=1) <= ts <= now + TIMING_SLACK):
                late.append(f"{summarize(Lg[i])} at {ts.isoformat()}")
        check("timing.records", not late, "; ".join(late[:4]), group="timing")

        # 4. AutomationBench's own assertion handlers (cross-check, never gating) ---------------------------------
        # One matching rule decides a trigger: the checks above (case and whitespace ignored where POLICY.md allows it).
        # AutomationBench's handlers compare raw substrings / exact cells, so a policy-equivalent value (' Ravi Menon ',
        # double spaces around '|') can fail them alone. They are run and reported (`ab_disagree`), never counted.
        failed = self.ab_failures(after, truth["assertions"])
        if truth["assertions"]:
            check("ab", not failed, f"{len(failed)} failed: {[a['type'] for a in failed][:6]}", group="ab")

        # 5. end of week -----------------------------------------------------------------------------------------
        if end is not None:
            checks.extend(self.end_checks(end, after, world0))

        gating = [c for c in checks if c["group"] != "ab"]
        ok_all = all(c["ok"] for c in gating)
        ok_core = all(c["ok"] for c in gating if c["group"] != "envelope")
        ab_bad = [c for c in checks if c["group"] == "ab" and not c["ok"]]
        meaningful = [it for it in Lg if not harmless(it)]
        only_review = bool(meaningful) and all(it["app"] == "slack" and it["coll"] == "messages" and it["op"] == "new"
                                               and (it["after"] or {}).get("channel_id") == sink for it in meaningful)
        if ok_all:
            outcome = "correct"
        elif not meaningful:
            outcome = "miss" if truth["outcome"] != "no-op" else "wrong"
        elif only_review and not exp["escalate"]:
            outcome = "abstained"
        else:
            outcome = "wrong"
        return {"trigger": truth["trigger"], "kind": truth["kind"], "expected": truth["outcome"], "outcome": outcome,
                "pass": ok_all, "pass_core": ok_core,
                "score": round(sum(c["ok"] for c in gating) / len(gating), 4) if gating else 1.0,
                "n_effects": len(meaningful), "failed": [c for c in gating if not c["ok"]], "n_checks": len(gating),
                # AutomationBench's handlers disagree with a passing verdict (reported, not counted)
                "ab_disagree": [c["name"] + ": " + c["detail"] for c in ab_bad] if ok_all else []}

    @staticmethod
    def policy_row_ok(cells: dict, p: dict) -> bool:
        return (norm(cells.get("Effective")) == p["Effective"] and norm_ci(cells.get("Parameter")) == norm_ci(p["Parameter"])
                and L.digits_value_ok(cells.get("Value"), p["Value"])
                and norm_ci(cells.get("Approved by")) == norm_ci(p["Approved by"]))

    def end_checks(self, end: dict, after: dict, world0: dict | None) -> list[dict]:
        out = []

        def check(name, ok, detail="", group="end"):
            out.append({"name": name, "ok": bool(ok), "detail": detail, "group": group})

        week = parse_instant(end["week_start"])
        esc = _chan_id(after, L.ESC)
        sms = [m for m in after["twilio"]["sms_messages"] if (_sms_time(m) or week) >= week]
        posts = [m for m in after["slack"]["messages"] if m.get("channel_id") == esc and (_slack_time(m) or week) >= week
                 and visible_post(m)]
        mails = [m for m in after["gmail"]["messages"] if "SENT" in (m.get("label_ids") or []) and (_mail_time(m) or week) >= week]
        issues = [a for a in after["jira"]["actions"].get("create_issue", []) if (_jira_time(a) or week) >= week]
        problems = []
        for tid, c in sorted(end["counts"].items()):
            got_sms = sorted(m.get("to_number") for m in sms if has_token(m.get("body"), f"SLA warning {tid}:"))
            if got_sms != c["sms"]:
                problems.append(f"{tid}: SMS to {got_sms} != {c['sms']}")
            n = sum(1 for m in posts if has_token(m.get("text"), f"{tid} |"))
            if n != c["warn_posts"]:
                problems.append(f"{tid}: {n} warning posts != {c['warn_posts']}")
            n = sum(1 for m in posts if exact_text_ok(m.get("text"), L.breach_post(tid)))
            if n != c["breach_posts"]:
                problems.append(f"{tid}: {n} BREACHED posts != {c['breach_posts']}")
            n = sum(1 for m in mails if norm_ci(m.get("subject")) == norm_ci(L.warn_subject(tid)))
            if n != c["emails"]:
                problems.append(f"{tid}: {n} warning emails != {c['emails']}")
            n = sum(1 for a in issues if norm_ci((a.get("params") or {}).get("summary")) == norm_ci(L.breach_summary(tid)))
            if n != c["jira"]:
                problems.append(f"{tid}: {n} Jira breach issues != {c['jira']}")
        check("end.exactly-once", not problems, "; ".join(problems[:6]))

        rows = {r["id"]: r for r in after["google_sheets"]["rows"] if r.get("worksheet_id") == L.WS_OPEN}
        problems = []
        for rid, want in end["rows"].items():
            r = rows.pop(rid, None)
            if r is None:
                problems.append(f"row {want.get('Ticket ID')} missing")
                continue
            cells = r.get("cells") or {}
            for col in L.TICKET_COLS:
                if str(cells.get(col, "")) != str(want[col]):
                    problems.append(f"{want['Ticket ID']}.{col} {cells.get(col)!r} != {want[col]!r}")
            for col in L.STATE_COLS:
                got, w = cells.get(col, ""), want[col]
                ok = (norm(got) == "" and w == "") if not w else \
                    (same_instant(got, w) if col != "Warned Agent" else norm_ci(got) == norm_ci(w))
                if not ok:
                    problems.append(f"{want['Ticket ID']}.{col} {got!r} != {w!r}")
        if rows:
            problems.append(f"{len(rows)} unexpected tracker rows")
        check("end.tracker", not problems, "; ".join(problems[:6]))

        pol = [r.get("cells") or {} for r in after["google_sheets"]["rows"] if r.get("worksheet_id") == L.WS_POLICY]
        want = list(end["policy_rows"])
        rest = []
        for cells in pol:
            j = next((k for k, p in enumerate(want) if self.policy_row_ok(cells, p)), None)
            if j is None:
                rest.append(cells)
            else:
                want.pop(j)
        check("end.policy-log", not want and not rest, f"missing {want}; unexpected {rest}")

        if world0 is not None:
            touched = []
            inbound = set(end.get("inbound_ids") or [])
            for it in ledger(world0, after):
                if it["op"] == "new" and it["app"] in ("twilio", "slack", "jira") \
                        and it["coll"] in ("sms_messages", "messages", "actions:create_issue"):
                    continue                    # graded per trigger and by end.exactly-once
                if it["op"] == "new" and it["app"] == "gmail" and it["coll"] == "messages" \
                        and ("SENT" in ((it["after"] or {}).get("label_ids") or []) or (it["after"] or {}).get("id") in inbound):
                    continue
                if it["app"] == "google_sheets" and it["coll"] == "rows" and it["op"] in ("new", "changed") \
                        and (it["after"] or {}).get("worksheet_id") in (L.WS_OPEN, L.WS_POLICY):
                    continue                    # graded by end.tracker and end.policy-log
                if harmless(it):
                    continue
                touched.append(summarize(it))
            check("end.preexisting-unchanged", not touched, "; ".join(touched[:6]))

        failed = self.ab_failures(after, end.get("assertions") or [])
        check("end.ab", not failed, f"{len(failed)} failed: {[(a['type'], a.get('to_number') or a.get('params')) for a in failed][:4]}",
              group="ab")
        return out
