#!/usr/bin/env python3
"""abr-hr-inbox oracle (RECURRING-DESIGN §3.6). Host-side; it never reads a solver's output to decide what was right.

Inputs per trigger: the host-only truth row (gen.py), world_before and world_after (WorldState JSON dumps taken just
before and just after the arm handled the trigger; world_before already holds the trigger's delta), and, at the last
trigger of the week (Friday's week close), end.json plus world0.

Checks per trigger:
  1. effects   every expected effect is found in THIS trigger's ledger (attribution):
               - each expected email is one new Sent message whose recipients (To + CC + BCC) are exactly the
                 expected ones, whose subject holds the expected parts and whose body holds the expected parts (texts
                 compare with whitespace collapsed and letter case ignored). A two-recipient grievance route may also
                 be one message to each recipient. The week-close summary must hold each `<label>: <number>` line
                 once with the expected number and no name, Employee ID or Case ID;
               - each expected Grievance Tracker Status is set (and no other cell of the row changed);
               - each expected Policy Log row is appended (Effective to the minute, Parameter, Value, Approved by);
               - an expected escalation is a new #automation-review message naming the trigger id.
  2. envelope  every record created, changed or removed in this trigger is an expected effect or harmless (marking
               mail read, labels): no other email, no CC, no sheet edit, no Slack post.
  3. slack     no Slack message created or changed in this trigger contains a Case ID (grievances are confidential).
  4. ab        the truth's AutomationBench assertion dicts (gmail_message_sent_to_with_body_contains,
               gmail_message_not_sent_to, google_sheets_row_updated, google_sheets_row_exists, slack_message_exists,
               slack_message_not_exists), checked with AutomationBench's own AssertionRegistry on an attribution view:
               world_after with the Gmail and Slack messages and the sheet rows restricted to what this trigger
               created or changed.
  5. end       (last trigger only) the Grievance Tracker exactly as the week's correct handling leaves it; the Policy
               Log rows as a multiset; Routing Rules and Employee Directory unchanged; per address, the number of
               emails sent this week (exactly once: no duplicate forward, acknowledgement or route); no Slack message
               anywhere with a Case ID; the week's new Slack messages are the expected escalations only; no
               pre-existing message edited or removed; plus AutomationBench's slack_message_not_exists per Case ID and
               gmail_message_not_sent_to for every mailbox that should get nothing this week, on the week's view.

Outcome: correct (all checks pass) | abstained (only #automation-review posts, truth is not an escalation) |
miss (no effect at all, truth expected effects) | wrong (anything else). `pass` includes the envelope; `pass_core`
is the same verdict without it (reported beside the headline).
"""
from __future__ import annotations

import copy
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone

SS = "ss_hr_ops"
WS_RULES, WS_DIR, WS_GRIEV, WS_POLICY = "ws_routing_rules", "ws_directory", "ws_grievances", "ws_policy_log"
REVIEW = "automation-review"
HARMLESS_GMAIL = {"is_read", "label_ids"}
CASE_RE = re.compile(r"GR-\d{4}-\d{3,}", re.I)


def canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def wsk(s) -> str:
    return " ".join(str(s or "").split()).lower()


def text_key(s) -> str:
    """Whitespace collapsed, letter case ignored, one trailing period tolerated."""
    t = wsk(s)
    return t[:-1].rstrip() if t.endswith(".") else t


def addr(s) -> str:
    m = re.search(r"<([^<>]+)>\s*$", str(s or ""))
    return (m.group(1) if m else str(s or "")).strip().lower()


def minute(at) -> str | None:
    """An Effective cell to the minute (UTC): '2026-03-04T10:12:00Z', '2026-03-04 10:12', '2026-03-04T10:12:00+00:00'."""
    t = str(at or "").strip()
    if not t:
        return None
    try:
        dt = datetime.fromisoformat(t.replace("Z", "+00:00").replace(" ", "T", 1))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M")


def policy_key(cells: dict) -> tuple:
    return (minute(cells.get("Effective")), wsk(cells.get("Parameter")), addr(cells.get("Value")), addr(cells.get("Approved by")))


def has(text: str, token: str) -> bool:
    return wsk(token) in wsk(text)


# ---------------------------------------------------------------------------------------------------------------------
# the ledger
# ---------------------------------------------------------------------------------------------------------------------
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


def _chan_id(world: dict, name: str):
    return next((c["id"] for c in world.get("slack", {}).get("channels", []) if c.get("name") == name), None)


def sheet_ids(world: dict, row: dict) -> tuple[str, str]:
    """A row's (spreadsheet id, worksheet id), resolving a title written in place of an id."""
    gs = world.get("google_sheets", {})
    s = row.get("spreadsheet_id")
    if not any(x.get("id") == s for x in gs.get("spreadsheets", [])):
        s = next((x["id"] for x in gs.get("spreadsheets", []) if wsk(x.get("title")) == wsk(s)), s)
    w = row.get("worksheet_id")
    if not any(x.get("id") == w and x.get("spreadsheet_id") == s for x in gs.get("worksheets", [])):
        w = next((x["id"] for x in gs.get("worksheets", []) if x.get("spreadsheet_id") == s
                  and wsk(x.get("title")) == wsk(w)), w)
    return s, w


def sheet_rows(world: dict, ws: str) -> list[dict]:
    return sorted((r for r in world.get("google_sheets", {}).get("rows", []) if sheet_ids(world, r) == (SS, ws)),
                  key=lambda r: (r.get("row_id") if isinstance(r.get("row_id"), int) else 10 ** 9))


def recipients(m: dict) -> list[str]:
    return sorted(addr(x) for x in (m.get("to") or []) + (m.get("cc") or []) + (m.get("bcc") or []))


def is_sent(m: dict) -> bool:
    return "SENT" in (m.get("label_ids") or [])


def body_of(m: dict) -> str:
    return f"{m.get('body_plain') or ''}\n{m.get('body_html') or ''}"


def harmless(it: dict) -> bool:
    if it["app"] == "gmail" and it["coll"] == "labels":
        return True
    if it["app"] == "gmail" and it["coll"] == "messages" and it["op"] == "changed":
        added = set(it["after"].get("label_ids") or []) - set(it["before"].get("label_ids") or [])
        return set(it["fields"]) <= HARMLESS_GMAIL and not added & {"TRASH", "SPAM", "SENT"}
    return False


def summarize(it: dict) -> str:
    rec = it.get("after") or it.get("before") or {}
    if it["app"] == "gmail" and it.get("coll") == "messages":
        return f"gmail.{it['op']} to={recipients(rec)} {str(rec.get('subject'))[:60]!r} {it.get('fields', '')}"
    if it["app"] == "slack" and it.get("coll") == "messages":
        return f"slack.{it['op']} {rec.get('channel_id')}: {str(rec.get('text'))[:80]!r}"
    if it["app"] == "google_sheets" and it.get("coll") == "rows":
        return f"sheets.row.{it['op']} {rec.get('worksheet_id')}#{rec.get('row_id')} {it.get('fields', '')}"
    return f"{it['app']}.{it.get('coll')}.{it['op']} {it['key']}"


def summary_counts(body: str) -> dict:
    """`<label>: <number>` lines of a summary body (an optional '-' or '*' bullet is tolerated)."""
    out: dict = defaultdict(list)
    for ln in str(body or "").splitlines():
        m = re.match(r"^\s*[-*]?\s*([A-Za-z][A-Za-z /-]*?)\s*:\s*(\d+)\s*\.?\s*$", ln)
        if m:
            out[wsk(m.group(1))].append(int(m.group(2)))
    return out


def content_ok(m: dict, em: dict) -> tuple[bool, str]:
    subj, body = str(m.get("subject") or ""), body_of(m)
    miss = [t for t in em.get("subject_has", []) if not has(subj, t)]
    miss += [t for t in em.get("body_has", []) if not has(body, t)]
    if miss:
        return False, f"missing {miss[:3]}"
    bad = [t for t in em.get("body_not", []) if has(body, t)]
    if bad:
        return False, f"body names {bad[:3]}"
    if "counts" in em:
        got = summary_counts(m.get("body_plain") or re.sub(r"<[^>]+>", "\n", str(m.get("body_html") or "")))
        wrong = [f"{k}: {got.get(wsk(k))} (want {v})" for k, v in em["counts"].items() if got.get(wsk(k)) != [v]]
        if wrong:
            return False, "counts " + "; ".join(wrong[:4])
    return True, ""


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

        # 1a. emails -------------------------------------------------------------------------------------------------
        new_sent = [i for i, it in enumerate(L) if it["app"] == "gmail" and it["coll"] == "messages" and it["op"] == "new"
                    and is_sent(it["after"])]
        for em in exp["emails"]:
            want = sorted(em["to"])
            why = []
            cands = []
            for i in new_sent:
                if i in used or recipients(L[i]["after"]) != want:
                    continue
                ok, w = content_ok(L[i]["after"], em)
                (cands.append(i) if ok else why.append(w))
            if cands:
                used.add(cands[0])
                check(f"email {em['tag']} {want}", True)
                continue
            if em.get("split_ok"):
                picks = []
                for r in want:
                    one = [i for i in new_sent if i not in used and i not in picks and recipients(L[i]["after"]) == [r]
                           and content_ok(L[i]["after"], em)[0]]
                    if one:
                        picks.append(one[0])
                if len(picks) == len(want):
                    used.update(picks)
                    check(f"email {em['tag']} {want}", True)
                    continue
            check(f"email {em['tag']} {want}", False,
                  f"no new email to exactly {want} with {em.get('subject_has')} / {em.get('body_has')[:3] if em.get('body_has') else ''}"
                  + (f"; candidates: {why[:2]}" if why else ""))

        # 1b. Grievance Tracker status -----------------------------------------------------------------------------
        def is_row(it, ws):
            return it["app"] == "google_sheets" and it["coll"] == "rows" and sheet_ids(after, it["after"] or it["before"]) == (SS, ws)
        for st in exp["status"]:
            idx = next((i for i, it in enumerate(L) if is_row(it, WS_GRIEV) and it["op"] == "changed"
                        and it["after"].get("row_id") == st["row_id"]), None)
            if idx is None:
                check(f"status row {st['row_id']}", False, f"row {st['row_id']} not changed (want {st['status']!r})")
                continue
            used.add(idx)
            b, a = L[idx]["before"].get("cells") or {}, L[idx]["after"].get("cells") or {}
            other = [k for k in set(a) | set(b) if k != "Status" and str(a.get(k, "")) != str(b.get(k, ""))]
            ok = text_key(a.get("Status")) == text_key(st["status"]) and not other and set(L[idx]["fields"]) <= {"cells"}
            check(f"status row {st['row_id']}", ok, f"Status {a.get('Status')!r} (want {st['status']!r}); other cells {other}")

        # 1c. Policy Log ------------------------------------------------------------------------------------------------
        new_pol = [i for i, it in enumerate(L) if is_row(it, WS_POLICY) and it["op"] == "new"]
        for row in exp["policy"]:
            cands = [i for i in new_pol if i not in used and policy_key(L[i]["after"].get("cells") or {}) == policy_key(row)]
            if cands:
                used.add(cands[0])
            check("policy-log row", bool(cands), f"no new Policy Log row {policy_key(row)}; new: "
                  f"{[policy_key(L[i]['after'].get('cells') or {}) for i in new_pol][:2]}")

        # 1d. escalation -----------------------------------------------------------------------------------------------
        review = _chan_id(after, REVIEW)
        new_msgs = [i for i, it in enumerate(L) if it["app"] == "slack" and it["coll"] == "messages" and it["op"] == "new"]
        if exp.get("escalate"):
            cands = [i for i in new_msgs if i not in used and L[i]["after"].get("channel_id") == review
                     and truth["trigger"] in (L[i]["after"].get("text") or "")]
            if cands:
                used.add(cands[0])
            check("escalate", bool(cands), f"no #{REVIEW} post naming {truth['trigger']}")

        # 2. envelope ------------------------------------------------------------------------------------------------
        extra = [summarize(L[i]) for i in range(len(L)) if i not in used and not harmless(L[i])]
        check("envelope", not extra, "; ".join(extra[:6]), group="envelope")

        # 3. confidentiality: no Case ID in Slack -----------------------------------------------------------------------
        leaks = [(L[i]["after"].get("text") or "")[:80] for i, it in enumerate(L) if it["app"] == "slack" and it["coll"] == "messages"
                 and it["op"] in ("new", "changed") and CASE_RE.search(str((it["after"] or {}).get("text") or ""))]
        check("slack.no-case-id", not leaks, f"Case ID in Slack: {leaks[:2]}", group="guard")

        # 4. AutomationBench's own assertion handlers ---------------------------------------------------------------
        if self.use_ab and truth["assertions"]:
            view = self.attribution_view(after, L)
            failed = []
            for a in truth["assertions"]:
                try:
                    ok = bool(self.Registry.check(view, a))
                except Exception as e:  # noqa: BLE001  a raising handler is a failed check, reported
                    ok, a = False, dict(a, error=f"{type(e).__name__}: {e}")
                if not ok:
                    failed.append(a)
            check("ab", not failed, f"{len(failed)} failed: {[(a['type'], a.get('to') or a.get('cell_contains') or a.get('text_contains')) for a in failed][:4]}",
                  group="ab")

        # 5. end of week ---------------------------------------------------------------------------------------------
        if end is not None:
            checks.extend(self.end_checks(end, after, world0))

        ok_all = all(c["ok"] for c in checks)
        ok_core = all(c["ok"] for c in checks if c["group"] != "envelope")
        real = [it for it in L if not harmless(it)]
        only_review = bool(real) and all(it["app"] == "slack" and it["coll"] == "messages" and it["op"] == "new"
                                         and (it["after"] or {}).get("channel_id") == review for it in real)
        if ok_all:
            outcome = "correct"
        elif not real:
            outcome = "miss" if truth["outcome"] != "no-op" else "wrong"
        elif only_review and not exp.get("escalate"):
            outcome = "abstained"
        else:
            outcome = "wrong"
        return {"trigger": truth["trigger"], "kind": truth["kind"], "expected": truth["outcome"],
                "outcome": outcome, "pass": ok_all, "pass_core": ok_core,
                "score": round(sum(c["ok"] for c in checks) / len(checks), 4) if checks else 1.0,
                "n_effects": len(real), "failed": [c for c in checks if not c["ok"]], "n_checks": len(checks)}

    def view_of(self, after: dict, keep: set):
        v = copy.deepcopy(after)
        for app, coll in (("gmail", "messages"), ("slack", "messages")):
            v[app][coll] = [m for m in v[app][coll] if (app, coll, _key(app, coll, m)) in keep]
        rows = [r for r in v["google_sheets"]["rows"] if ("google_sheets", "rows", _key("google_sheets", "rows", r)) in keep]
        for r in rows:
            r["spreadsheet_id"], r["worksheet_id"] = sheet_ids(after, r)
        v["google_sheets"]["rows"] = rows
        return self.WorldState(**v)

    def attribution_view(self, after: dict, L: list[dict]):
        """world_after with Gmail messages, Slack messages and sheet rows restricted to what this trigger created or
        changed, so an earlier trigger's effect never satisfies this trigger's assertion (and never trips its negative
        ones)."""
        return self.view_of(after, {(it["app"], it["coll"], it["key"]) for it in L if it["op"] in ("new", "changed")})

    def end_checks(self, end: dict, after: dict, world0: dict | None) -> list[dict]:
        out = []

        def check(name, ok, detail=""):
            out.append({"name": name, "ok": bool(ok), "detail": detail, "group": "end"})

        rows = {str(r.get("row_id")): r.get("cells") or {} for r in sheet_rows(after, WS_GRIEV)}
        want = end["grievances"]
        bad = []
        for k in sorted(set(rows) | set(want), key=lambda x: int(x) if x.isdigit() else 10 ** 9):
            a, w = rows.get(k), want.get(k)
            if a is None or w is None:
                bad.append(f"row {k} {'missing' if a is None else 'added'}")
                continue
            for col in sorted(set(a) | set(w)):
                same = text_key(a.get(col)) == text_key(w.get(col)) if col == "Status" else str(a.get(col, "")) == str(w.get(col, ""))
                if not same:
                    bad.append(f"row {k} {col}: {str(a.get(col))[:40]!r} != {str(w.get(col))[:40]!r}")
        check("end.grievances", not bad, "; ".join(bad[:6]))
        got = Counter(policy_key(r.get("cells") or {}) for r in sheet_rows(after, WS_POLICY))
        exp = Counter(policy_key(r) for r in end["policy_log"])
        check("end.policy-log", got == exp, f"missing {list((exp - got).elements())[:2]}; extra {list((got - exp).elements())[:2]}")
        if world0 is not None:
            for ws, name in ((WS_RULES, "routing-rules"), (WS_DIR, "directory")):
                a = [canon(r.get("cells")) for r in sheet_rows(after, ws)]
                b = [canon(r.get("cells")) for r in sheet_rows(world0, ws)]
                check(f"end.{name}-unchanged", a == b, f"the {name} worksheet was edited")
            ids0 = {m.get("id") for m in world0["gmail"]["messages"]}
            week = [m for m in after["gmail"]["messages"] if m.get("id") not in ids0 and is_sent(m)]
            per = Counter(x for m in week for x in recipients(m))
            want_c = Counter(end["mail_counts"])
            diff = sorted(f"{k}: {per.get(k, 0)} (want {want_c.get(k, 0)})" for k in set(per) | set(want_c) if per.get(k, 0) != want_c.get(k, 0))
            check("end.mail-counts", not diff, "; ".join(diff[:6]))
            keys0 = {_key("slack", "messages", m) for m in world0["slack"]["messages"]}
            new_s = [m for m in after["slack"]["messages"] if _key("slack", "messages", m) not in keys0]
            review = _chan_id(after, REVIEW)
            off = [str(m.get("text"))[:60] for m in new_s if m.get("channel_id") != review]
            check("end.slack-posts", not off and len(new_s) == end["escalations"],
                  f"{len(new_s)} new Slack messages (want {end['escalations']} escalations); outside #{REVIEW}: {off[:2]}")
            touched = [summarize(it) for it in ledger(world0, after)
                       if it["op"] in ("changed", "removed") and it["app"] in ("slack", "gmail") and not harmless(it)]
            check("end.preexisting-unchanged", not touched, "; ".join(touched[:6]))
            leaks = [str(m.get("text"))[:60] for m in after["slack"]["messages"] if CASE_RE.search(str(m.get("text") or ""))]
            check("end.no-case-id-in-slack", not leaks, f"{leaks[:2]}")
            if self.use_ab and end["assertions"]:
                keep = {("gmail", "messages", _key("gmail", "messages", m)) for m in week}
                keep |= {("slack", "messages", _key("slack", "messages", m)) for m in after["slack"]["messages"]}
                keep |= {("google_sheets", "rows", _key("google_sheets", "rows", r)) for r in after["google_sheets"]["rows"]}
                w = self.view_of(after, keep)
                failed = [a for a in end["assertions"] if not self.Registry.check(w, a)]
                check("end.ab", not failed, f"{len(failed)} failed: {[(a['type'], a.get('to') or a.get('text_contains')) for a in failed][:4]}")
        return out
