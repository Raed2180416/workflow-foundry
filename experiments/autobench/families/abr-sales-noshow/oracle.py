#!/usr/bin/env python3
"""abr-sales-noshow oracle (RECURRING-DESIGN §3.6). Host-side; it never reads a solver's output to decide what was right.

Inputs per trigger: the host-only truth row (gen.py), world_before and world_after (WorldState JSON dumps taken just
before and just after the arm handled the trigger), and, at the week-close trigger, end.json plus world0.

Checks per trigger:
  1. effects   every expected effect is found in THIS trigger's ledger (attribution): the reported invitee newly
               flagged; exactly one new follow-up task with the exact subject, contact, status, priority and the
               exact POLICY.md 2.7 description (whitespace runs and one trailing period are policy-neutral), no
               WhatId other than the contact's own account and IsClosed consistent with its status; the retracted
               task changed to Completed with exactly ` | Retracted: joined late` appended to its old description;
               the week-close post with the exact count and no other number; the escalation post naming the
               trigger id.
  2. envelope  every record created, changed or removed in this trigger is an expected effect (nothing else).
  3. guards    decoy invitees (other events of the same email, colleagues, escalation/internal invitees) unflagged.
  4. ab        the truth's AutomationBench assertion dicts, checked with AutomationBench's own AssertionRegistry on
               world_after (content cross-check with the upstream matching rules).

Week verdict (week close only, reported apart from the trigger): the end-of-week state, i.e. exactly the expected
flags, exactly one follow-up task per handled no-show this week with its final status, priority and description, and
no pre-existing record changed. It is returned as `week` and never folded into the week-close trigger's own verdict,
so an earlier trigger's mistake is charged once to that trigger, not again to the week-close post.

Outcome: correct (all checks pass) | abstained (only #automation-review posts, truth is not an escalation) |
miss (no effect at all, truth expected effects) | wrong (anything else). `pass` includes the envelope; `pass_core`
is the same verdict without it (reported beside the headline).
"""
from __future__ import annotations

import json
import re
from collections import defaultdict

SUBJECT_PREFIX = "Follow up on missed call - "
RETRACT_SUFFIX = " | Retracted: joined late"      # POLICY.md section 3 (gen.RETRACT_SUFFIX, checked by the tests)
REVIEW, ALERTS = "automation-review", "sales-alerts"
VOLATILE = {"last_modified_date", "updated_at", "no_show_marked_at", "edited_at"}
FLAG_FIELDS = {"is_no_show", "no_show_marked_at", "updated_at"}


def canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _key(app: str, coll: str, rec) -> str:
    if app == "slack" and coll == "messages" and isinstance(rec, dict):
        return f"msg:{rec.get('channel_id')}|{rec.get('ts')}"
    if isinstance(rec, dict) and rec.get("id") is not None:
        return f"id:{rec['id']}"
    return "c:" + canon(rec)


def _stable(rec):
    return {k: v for k, v in rec.items() if k not in VOLATILE} if isinstance(rec, dict) else rec


def ledger(before: dict, after: dict) -> list[dict]:
    """Every record created, changed (ignoring volatile timestamps) or removed between two world dumps, all apps."""
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
                        elif canon(_stable(rb)) != canon(_stable(ra)):
                            fields = sorted(f for f in set(rb) | set(ra) if canon(rb.get(f)) != canon(ra.get(f)))
                            out.append({"app": app, "coll": coll, "op": "changed", "key": k, "before": rb, "after": ra,
                                        "fields": fields})
            elif canon(_stable(x)) != canon(_stable(y)):
                out.append({"app": app, "coll": coll, "op": "field", "key": f"{app}.{coll}", "before": x, "after": y})
    return out


def _chan_id(world: dict, name: str):
    return next((c["id"] for c in world.get("slack", {}).get("channels", []) if c.get("name") == name), None)


def _norm(s) -> str:
    return " ".join(str(s or "").split())


def _drop_period(s: str) -> str:
    """One trailing period is policy-neutral ('... | Account pipeline: $87,000.')."""
    return s[:-1] if s.endswith(".") else s


def desc_eq(actual, expected: str) -> bool:
    """A description equals the prescribed string exactly, up to whitespace runs and one trailing period. Field
    order, cents, added text and a second value all fail."""
    return _drop_period(_norm(actual)) == _norm(expected)


def is_retracted(desc) -> bool:
    """The description ends with the exact POLICY.md section 3 suffix (one trailing period allowed)."""
    return _drop_period(_norm(desc)).endswith(RETRACT_SUFFIX)


def count_post_ok(text, token: str, allow: tuple[str, ...] = ()) -> bool:
    """`token` ('No-shows this week: 3') occurs in `text` (has_token), and nothing else in the post is a number that
    could be read as a count: an explanation may follow ('... (Mon-Fri, retractions excluded)'), but a second or a
    contradicting count may not ('...: 3 (actually 4)', '...: 3.5', the post twice with two numbers). ISO dates, HH:MM
    times and the strings in `allow` (the trigger id) are not counts."""
    if not has_token(text, token):
        return False
    rest = re.sub(re.escape(_norm(token).lower()) + r"(?!\w|,\d)", " ", _norm(text).lower())
    for a in allow:
        rest = rest.replace(_norm(a).lower(), " ")
    rest = re.sub(r"\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}\b", " ", rest)
    return re.search(r"\d", rest) is None


def has_token(text, token: str) -> bool:
    """`token` occurs in `text` (whitespace-normalized, ignoring case) and is not the prefix of a longer number or
    id: 'No-shows this week: 1' does not match '... week: 12', 'Account pipeline: $1,250' does not match '$1,250,000',
    and 's610/t01' does not match 's610/t012'."""
    return re.search(re.escape(_norm(token).lower()) + r"(?!\w|,\d)", _norm(text).lower()) is not None


def _task_matches(t: dict, contact_id: str, subject: str, sched: str) -> bool:
    return (t.get("contact_id") == contact_id and _norm(t.get("subject")) == subject
            and sched in (t.get("description") or ""))


def verdict_ok(v: dict) -> bool:
    """The trigger passed and, when the week was graded with it (week close), so did the week verdict. Used by the
    mutation and specificity gates, which ask whether ANY verdict notices a fault."""
    return bool(v["pass"]) and bool(v.get("week", {"pass": True})["pass"])


def summarize(it: dict) -> str:
    rec = it.get("after") or it.get("before") or {}
    if it["app"] == "slack" and it.get("coll") == "messages":
        return f"slack.{it['op']} {rec.get('channel_id')}: {str(rec.get('text'))[:80]!r}"
    if it["app"] == "salesforce" and it.get("coll") == "tasks":
        return f"salesforce.task.{it['op']} {rec.get('subject')!r} who={rec.get('contact_id')} {it.get('fields', '')}"
    if it["app"] == "calendly" and it.get("coll") == "invitees":
        return f"calendly.invitee.{it['op']} {rec.get('id')} {it.get('fields', '')}"
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

        # 1. effects --------------------------------------------------------------------------------------------
        for inv_id in exp["noshow"]:
            idx = next((i for i, it in enumerate(L) if it["app"] == "calendly" and it["coll"] == "invitees"
                        and it["op"] == "changed" and it["key"] == f"id:{inv_id}"), None)
            if idx is None:
                check(f"flag {inv_id}", False, "reported invitee not marked as a no-show in this trigger")
                continue
            it = L[idx]
            used.add(idx)
            ok = (not it["before"].get("is_no_show")) and it["after"].get("is_no_show") is True \
                and set(it["fields"]) <= FLAG_FIELDS
            check(f"flag {inv_id}", ok, "" if ok else f"changed fields {it['fields']}")

        new_tasks = [i for i, it in enumerate(L) if it["app"] == "salesforce" and it["coll"] == "tasks" and it["op"] == "new"]
        for tc in exp["task_create"]:
            cands = [i for i in new_tasks if i not in used and _norm(L[i]["after"].get("subject")) == tc["subject"]
                     and L[i]["after"].get("contact_id") == tc["contact_id"]]
            if not cands:
                same_subj = [L[i]["after"].get("contact_id") for i in new_tasks if _norm(L[i]["after"].get("subject")) == tc["subject"]]
                check("task.create", False, f"no new task {tc['subject']!r} on {tc['contact_id']}"
                      + (f" (found on {same_subj})" if same_subj else ""))
                continue
            i = cands[0]
            used.add(i)
            t = L[i]["after"]
            desc = t.get("description") or ""
            check("task.status", t.get("status") == tc["status"], f"status {t.get('status')!r} != {tc['status']!r}")
            check("task.priority", t.get("priority") == tc["priority"], f"priority {t.get('priority')!r} != {tc['priority']!r}")
            # the verdict is the exact description; the three part checks below only name which part is wrong
            check("task.description", desc_eq(desc, tc["description"]), f"description {desc!r} != {tc['description']!r}")
            check("task.scheduled", tc["scheduled"] in desc, f"description lacks {tc['scheduled']!r}: {desc!r}")
            check("task.pipeline", has_token(desc, f"Account pipeline: {tc['pipeline']}"),
                  f"description lacks 'Account pipeline: {tc['pipeline']}': {desc!r}")
            check("task.repeat", ("repeat no-show" in desc.lower()) == tc["repeat"],
                  f"repeat marker {'missing' if tc['repeat'] else 'present but not a repeat'}: {desc!r}")
            # fields POLICY.md leaves open may stay open, but not point elsewhere or contradict the status
            own_acc = next((c.get("account_id") for c in before.get("salesforce", {}).get("contacts", [])
                            if c.get("id") == tc["contact_id"]), None)
            what = t.get("related_to_id")
            check("task.what-id", what is None or (own_acc is not None and what == own_acc),
                  f"WhatId {what!r} is not the contact's account {own_acc!r}")
            check("task.is-closed", bool(t.get("is_closed")) == (t.get("status") == "Completed"),
                  f"is_closed {t.get('is_closed')!r} with status {t.get('status')!r}")

        for tu in exp["task_update"]:
            cands = [t for t in before.get("salesforce", {}).get("tasks", [])
                     if _task_matches(t, tu["contact_id"], tu["subject"], tu["scheduled"]) and t.get("status") == "Not Started"]
            if not cands:
                check("retract.locate", False, "the follow-up task to retract is not in the world before this trigger")
                continue
            target = max(cands, key=lambda t: str(t.get("created_date")))
            idx = next((i for i, it in enumerate(L) if it["app"] == "salesforce" and it["coll"] == "tasks"
                        and it["op"] == "changed" and it["key"] == f"id:{target['id']}"), None)
            if idx is None:
                check("retract.update", False, f"task {target['id']} not changed")
                continue
            used.add(idx)
            a, b = L[idx]["after"], L[idx]["before"]
            desc = a.get("description") or ""
            check("retract.status", a.get("status") == "Completed", f"status {a.get('status')!r}")
            want = (b.get("description") or "") + RETRACT_SUFFIX
            check("retract.description", desc_eq(desc, want), f"description {desc!r} != {_norm(want)!r}")
            other = [f for f in L[idx]["fields"] if f not in ("status", "description", "is_closed", "last_modified_date")]
            check("retract.only-status-and-description", not other, f"also changed {other}")

        new_msgs = [i for i, it in enumerate(L) if it["app"] == "slack" and it["coll"] == "messages" and it["op"] == "new"]
        for sp in exp["slack_post"]:
            cid = _chan_id(after, sp["channel"])
            cands = [i for i in new_msgs if i not in used and L[i]["after"].get("channel_id") == cid
                     and count_post_ok(L[i]["after"].get("text"), sp["text"], allow=(truth["trigger"],))]
            if cands:
                used.add(cands[0])
            check(f"post #{sp['channel']}", bool(cands),
                  f"no new message in #{sp['channel']} with {sp['text']!r} and no other count")
        if exp["escalate"]:
            cid = _chan_id(after, REVIEW)
            cands = [i for i in new_msgs if i not in used and L[i]["after"].get("channel_id") == cid
                     and has_token(L[i]["after"].get("text"), truth["trigger"])]
            if cands:
                used.add(cands[0])
            check("escalate", bool(cands), f"no #{REVIEW} post naming {truth['trigger']}")

        # 2. envelope --------------------------------------------------------------------------------------------
        extra = [summarize(L[i]) for i in range(len(L)) if i not in used]
        check("envelope", not extra, "; ".join(extra[:6]), group="envelope")

        # 3. guards ----------------------------------------------------------------------------------------------
        inv_after = {i["id"]: i for i in after.get("calendly", {}).get("invitees", [])}
        bad = [g for g in truth["guards"]["not_noshow"] if inv_after.get(g, {}).get("is_no_show")]
        check("guards", not bad, f"decoy invitees marked: {bad}", group="guards")

        # 4. AutomationBench's own assertion handlers ------------------------------------------------------------
        if self.use_ab and truth["assertions"]:
            w = self.WorldState(**after)
            failed = [a for a in truth["assertions"] if not self.Registry.check(w, a)]
            check("ab", not failed, f"{len(failed)} failed: {[a['type'] for a in failed]}", group="ab")

        ok_all = all(c["ok"] for c in checks)
        ok_core = all(c["ok"] for c in checks if c["group"] != "envelope")
        review = _chan_id(after, REVIEW)
        only_review = bool(L) and all(it["app"] == "slack" and it["coll"] == "messages" and it["op"] == "new"
                                      and (it["after"] or {}).get("channel_id") == review for it in L)
        if ok_all:
            outcome = "correct"
        elif not L:
            outcome = "miss" if truth["outcome"] != "no-op" else "wrong"
        elif only_review and truth["outcome"] != "escalate":
            outcome = "abstained"
        else:
            outcome = "wrong"
        out = {"trigger": truth["trigger"], "variant": truth["variant"], "expected": truth["outcome"],
               "outcome": outcome, "pass": ok_all, "pass_core": ok_core,
               "score": round(sum(c["ok"] for c in checks) / len(checks), 4) if checks else 1.0,
               "n_effects": len(L), "failed": [c for c in checks if not c["ok"]], "n_checks": len(checks)}
        # 5. end of week: a separate per-stream verdict, never part of the week-close trigger's own pass ----------
        if end is not None:
            wk = self.end_checks(end, after, world0)
            out["week"] = {"pass": all(c["ok"] for c in wk), "failed": [c for c in wk if not c["ok"]],
                           "n_checks": len(wk)}
        return out

    def end_checks(self, end: dict, after: dict, world0: dict | None) -> list[dict]:
        out = []

        def check(name, ok, detail=""):
            out.append({"name": name, "ok": bool(ok), "detail": detail, "group": "end"})

        inv = {i["id"]: i for i in after.get("calendly", {}).get("invitees", [])}
        missing = [i for i in end["flagged"] if not inv.get(i, {}).get("is_no_show")]
        extra = [i for i in end["not_flagged"] if inv.get(i, {}).get("is_no_show")]
        check("end.flags", not missing and not extra, f"unflagged {missing}; wrongly flagged {extra}")
        week = [t for t in after.get("salesforce", {}).get("tasks", [])
                if _norm(t.get("subject")).startswith(SUBJECT_PREFIX) and str(t.get("created_date")) >= end["week_start"]]
        remaining = list(week)
        problems = []
        for e in end["week_tasks"]:
            m = [t for t in remaining if _task_matches(t, e["contact_id"], e["subject"], e["scheduled"])]
            if len(m) != 1:
                problems.append(f"{len(m)} tasks for {e['subject']!r}/{e['contact_id']}/{e['scheduled']}")
            for t in m:
                remaining.remove(t)
            if m:
                t = m[0]
                if t.get("status") != e["status"] or t.get("priority") != e["priority"]:
                    problems.append(f"{t.get('id')}: status/priority {t.get('status')}/{t.get('priority')} != {e['status']}/{e['priority']}")
                desc = t.get("description") or ""
                if is_retracted(desc) != (e["status"] == "Completed"):
                    problems.append(f"{t.get('id')}: retraction marker mismatch")
                base = _drop_period(_norm(desc))
                if is_retracted(desc):
                    base = base[:-len(RETRACT_SUFFIX)]
                want = e["description"][:-len(RETRACT_SUFFIX)] if e["status"] == "Completed" else e["description"]
                if not desc_eq(base, want):
                    problems.append(f"{t.get('id')}: description {desc!r} != {e['description']!r}")
        if remaining:
            problems.append(f"{len(remaining)} unexpected follow-up tasks this week")
        check("end.week-tasks", not problems, "; ".join(problems[:6]))
        if world0 is not None:
            touched = []
            for it in ledger(world0, after):
                if it["op"] == "new" and it["app"] in ("salesforce", "slack") and it["coll"] in ("tasks", "messages"):
                    continue    # graded per trigger and by end.week-tasks
                if it["op"] == "changed" and it["app"] == "calendly" and it["coll"] == "invitees" \
                        and set(it["fields"]) <= FLAG_FIELDS:
                    continue    # graded by end.flags
                if it["op"] == "changed" and it["app"] == "salesforce" and it["coll"] == "tasks" \
                        and any(t.get("id") == it["after"].get("id") for t in week):
                    continue
                touched.append(summarize(it))
            check("end.preexisting-unchanged", not touched, "; ".join(touched[:6]))
        return out
