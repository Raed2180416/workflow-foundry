#!/usr/bin/env python3
"""abr-fin-receipts oracle (RECURRING-DESIGN §3.6). Host-side; it never reads a solver's output to decide what was right.

Inputs per trigger: the host-only truth row (gen.py), world_before and world_after (WorldState JSON dumps taken just
before and just after the arm handled the trigger; world_before already holds the trigger's delta), and, at the last
trigger of the week (Friday's week close), end.json plus world0.

Checks per trigger:
  1. effects   every expected effect is found in THIS trigger's ledger (attribution):
               - each expected new Submissions row: exactly one new row with that Message TS, every column equal
                 (Employee, Category and Status ignoring letter case and extra spaces; Amount as POLICY.md section 4
                 writes it, text with two decimals and no `$` or commas (`1250.00`) or a number cell of that value;
                 Attendees compared as numbers; dates exactly `YYYY-MM-DD`) and no other non-empty cell;
               - each expected row update: the receipt's existing row (found by Message TS in world_before) changed in
                 place to the expected cells (row id and position kept);
               - each expected thread reply: a new #expense-submissions message whose thread_ts is the receipt's ts and
                 whose text is the expected text (whitespace collapsed, letter case ignored, money compared by value so
                 `$1,250.00` = `$1250.00`, one trailing period tolerated);
               - the weekly email: one sent message to finance@ only, the expected subject, and the body's lines of
                 the three shapes POLICY.md section 6 lists (`<name>: $<amount>`, `Total: $<amount>`,
                 `Pending pre-approval: <N>`) equal to the expected lines as a multiset. Other lines (a greeting, a
                 dated header), line order, blank lines, list markers (`- `, `* `, `• `, `1. `) and HTML markup
                 (`<br>`, `<p>`, `<li>`; an HTML-only body) are ignored; a missing, extra or wrong line of those
                 shapes fails;
               - an escalation: a new #automation-review post naming the trigger id.
  2. envelope  every record created, changed or removed in this trigger is an expected effect or harmless (a thread
               parent's reply_count; read flags or labels on mail that was already there). Anything else is overreach.
  3. ab        the truth's AutomationBench assertion dicts (google_sheets_row_exists / _not_exists, slack_message_exists,
               gmail_message_sent_to_with_body_contains), checked with AutomationBench's own AssertionRegistry on an
               attribution view: world_after with the Slack messages, the sheet rows and the mail restricted to what
               this trigger created or changed.
  4. end       (last trigger only) the Submissions worksheet equals the week's expected rows (world0 rows, appends,
               corrections and approvals), with no duplicate Message TS; Employees and Expense Policy unchanged; no
               pre-existing Slack message edited or removed (reply counts excepted); the week's automation posts in
               #expense-submissions equal the expected thread replies as a multiset, #automation-review holds exactly
               the expected escalations, and nothing was posted anywhere else; exactly one email sent this week; plus
               AutomationBench's google_sheets_row_exists per final row on the whole world.

Outcome: correct (all checks pass) | abstained (only #automation-review posts, truth is not an escalation) |
miss (no effect at all, truth expected effects) | wrong (anything else). `pass` includes the envelope; `pass_core`
is the same verdict without it (reported beside the headline).
"""
from __future__ import annotations

import copy
import html
import json
import re
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation

SS, WS_SUB, WS_EMP, WS_POL = "ss_expense_tracker", "ws_submissions", "ws_employees", "ws_policy"
CHAN, REVIEW = "expense-submissions", "automation-review"
FINANCE = "finance@company.example.com"
COLUMNS = ["Message TS", "Submitted", "Employee", "Date", "Amount", "Category", "Attendees", "Status"]
HARMLESS_MSG = {"reply_count"}
AMOUNT_TEXT = re.compile(r"^\d+\.\d{2}$")          # POLICY.md section 4: `1250.00`
HTML_TAG = re.compile(r"<\s*/?\s*(?:br|p|div|li|ul|ol|tr|td|th|table|tbody|thead|html|body|head|span|b|strong|em|i|u|"
                      r"pre|h[1-6]|font|meta|style|title)\b[^>]*>", re.I)
HTML_BREAK = re.compile(r"<\s*br\s*/?\s*>|<\s*/?\s*(?:p|div|li|tr|h[1-6]|pre|ul|ol|table)\b[^>]*>", re.I)
LIST_MARK = re.compile(r"^\s*(?:[-*\u2022\u00b7]|\d{1,2}[.)])\s+")
EMAIL_LINE = re.compile(r"^(?:[^:$]+: \$\d+\.\d{2}|pending pre-approval: \d+)$")   # on text_key()
HARMLESS_MAIL = {"is_read", "label_ids"}


def canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def norm(s) -> str:
    return " ".join(str(s if s is not None else "").split()).lower()


def _money(m) -> str:
    try:
        return f"${Decimal(m.group(1).replace(',', '')):.2f}"
    except InvalidOperation:
        return m.group(0)


def text_key(s) -> str:
    """Whitespace collapsed, letter case ignored, money by value, one trailing period tolerated."""
    t = norm(s)
    t = re.sub(r"\$\s?(\d[\d,]*(?:\.\d+)?)", _money, t)
    t = re.sub(r"(?<=\d),(?=\d{3}\b)", "", t)
    return t[:-1].rstrip() if t.endswith(".") else t


def num(v) -> Decimal | None:
    s = str(v if v is not None else "").strip().replace("$", "").replace(",", "")
    if not s:
        return None
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def amount_cell_ok(got, want) -> bool:
    """POLICY.md section 4: the Amount cell is the amount with two decimals and no `$` or commas (`1250.00`), as
    text, or a number cell holding the same value. `$1,975.89`, `1,975.89`, `145`, `145.0`, `145.000` as text fail."""
    if isinstance(got, bool) or num(want) is None:
        return False
    if isinstance(got, (int, float)):
        return num(got) == num(want)
    s = str(got if got is not None else "").strip()
    return bool(AMOUNT_TEXT.match(s)) and Decimal(s) == num(want)


def cells_equal(got: dict, want: dict) -> list[str]:
    """Column-by-column comparison of a Submissions row; returns the differences."""
    bad = []
    for k in COLUMNS:
        g, w = got.get(k), want.get(k)
        if k == "Amount":
            ok = amount_cell_ok(g, w)
        elif k == "Attendees":
            ok = (num(w) is None and num(g) is None and norm(g) == "") or (num(w) is not None and num(g) == num(w))
        elif k in ("Message TS", "Submitted", "Date"):
            ok = str(g if g is not None else "").strip() == str(w)
        else:
            ok = norm(g) == norm(w)
        if not ok:
            bad.append(f"{k} {g!r} (want {w!r})")
    extra = [k for k, v in got.items() if k not in COLUMNS and str(v if v is not None else "").strip()]
    if extra:
        bad.append(f"extra cells {extra}")
    return bad


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


def chan_id(world: dict, name: str):
    return next((c["id"] for c in world.get("slack", {}).get("channels", []) if c.get("name") == name), None)


def sheet_ids(world: dict, row: dict) -> tuple[str, str]:
    """A row's (spreadsheet id, worksheet id), resolving a title written in place of an id."""
    gs = world.get("google_sheets", {})
    s = row.get("spreadsheet_id")
    if not any(x.get("id") == s for x in gs.get("spreadsheets", [])):
        s = next((x["id"] for x in gs.get("spreadsheets", []) if norm(x.get("title")) == norm(s)), s)
    w = row.get("worksheet_id")
    if not any(x.get("id") == w and x.get("spreadsheet_id") == s for x in gs.get("worksheets", [])):
        w = next((x["id"] for x in gs.get("worksheets", []) if x.get("spreadsheet_id") == s
                  and norm(x.get("title")) == norm(w)), w)
    return s, w


def sheet_rows(world: dict, ws: str) -> list[dict]:
    return [r for r in world.get("google_sheets", {}).get("rows", []) if sheet_ids(world, r) == (SS, ws)]


def addr(a: str) -> str:
    m = re.search(r"<([^>]+)>", a or "")
    return (m.group(1) if m else (a or "")).strip().lower()


def body_text(body) -> str:
    """The email body as plain lines: HTML markup turned into line breaks and removed, entities decoded."""
    s = str(body or "")
    if HTML_TAG.search(s):
        s = HTML_BREAK.sub("\n", s)
        s = re.sub(r"<[^>]*>", "", s)
        s = html.unescape(s)
    return s


def body_lines(body: str) -> Counter:
    """The body's lines of the three shapes POLICY.md section 6 lists, normalized (list markers dropped). Any other
    line (a greeting, a header with a date, a signature) is not one of the required lines and is ignored."""
    out = Counter()
    for x in body_text(body).splitlines():
        k = text_key(LIST_MARK.sub("", x))
        if EMAIL_LINE.match(k):
            out[k] += 1
    return out


def summarize(it: dict) -> str:
    rec = it.get("after") or it.get("before") or {}
    if it["app"] == "slack" and it.get("coll") == "messages":
        return f"slack.{it['op']} {rec.get('channel_id')} thread={rec.get('thread_ts')}: {str(rec.get('text'))[:70]!r}" + \
            (f" fields={it['fields']}" if it["op"] == "changed" else "")
    if it["app"] == "google_sheets" and it.get("coll") == "rows":
        return f"sheets.row.{it['op']} {rec.get('worksheet_id')}#{rec.get('row_id')} {json.dumps(rec.get('cells'))[:90]}"
    if it["app"] == "gmail" and it.get("coll") == "messages":
        return f"gmail.{it['op']} to={rec.get('to')} subject={rec.get('subject')!r}"
    return f"{it['app']}.{it.get('coll')}.{it['op']} {it['key']}"


def harmless(it: dict) -> bool:
    if it["op"] != "changed":
        return False
    if it["app"] == "slack" and it["coll"] == "messages":
        return set(it["fields"]) <= HARMLESS_MSG
    if it["app"] == "gmail" and it["coll"] == "messages":
        return set(it["fields"]) <= HARMLESS_MAIL
    return False


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

        def is_sub_row(it, op):
            return (it["app"] == "google_sheets" and it["coll"] == "rows" and it["op"] == op
                    and sheet_ids(after, it["after"]) == (SS, WS_SUB))

        # 1. effects ------------------------------------------------------------------------------------------------
        for want in exp["new_rows"]:
            ts = want["cells"]["Message TS"]
            cands = [i for i, it in enumerate(L) if i not in used and is_sub_row(it, "new")
                     and str(it["after"].get("cells", {}).get("Message TS", "")).strip() == ts]
            name = f"row {ts}"
            if not cands:
                check(name, False, f"no new Submissions row with Message TS {ts} (want {want['cells']})")
                continue
            used.add(cands[0])
            bad = cells_equal(L[cands[0]]["after"].get("cells", {}), want["cells"])
            check(name, not bad, "; ".join(bad))
        rows_before = {str(r.get("cells", {}).get("Message TS", "")).strip(): r for r in sheet_rows(before, WS_SUB)}
        for want in exp["set_rows"]:
            ts = want["message_ts"]
            name = f"update {ts}"
            r0 = rows_before.get(ts)
            if r0 is None:
                check(name, False, f"no Submissions row with Message TS {ts} before this trigger (cascade)")
                continue
            k = _key("google_sheets", "rows", r0)
            idx = next((i for i, it in enumerate(L) if it["app"] == "google_sheets" and it["coll"] == "rows"
                        and it["op"] == "changed" and it["key"] == k), None)
            if idx is None:
                check(name, False, f"row {r0.get('row_id')} (Message TS {ts}) not updated (want {want['cells']})")
                continue
            used.add(idx)
            a = L[idx]["after"]
            bad = cells_equal(a.get("cells", {}), want["cells"])
            other = [f for f in L[idx]["fields"] if f != "cells"]
            check(name, not bad and not other, "; ".join(bad) + (f"; other fields {other}" if other else ""))
        chan, review = chan_id(after, CHAN), chan_id(after, REVIEW)
        new_msgs = [i for i, it in enumerate(L) if it["app"] == "slack" and it["coll"] == "messages" and it["op"] == "new"]
        for want in exp["replies"]:
            cands = [i for i in new_msgs if i not in used and L[i]["after"].get("channel_id") == chan
                     and not L[i]["after"].get("is_deleted") and L[i]["after"].get("thread_ts") == want["thread_ts"]
                     and text_key(L[i]["after"].get("text")) == text_key(want["text"])]
            if cands:
                used.add(cands[0])
                check(f"reply {want['text'][:40]}", True)
            else:
                near = [L[i]["after"] for i in new_msgs if i not in used and L[i]["after"].get("channel_id") == chan]
                check(f"reply {want['text'][:40]}", False,
                      f"no reply {want['text']!r} in thread {want['thread_ts']}; new posts: "
                      f"{[(m.get('thread_ts'), m.get('text')) for m in near][:3]}")
        if exp.get("email"):
            em = exp["email"]
            want_lines = Counter(text_key(x) for x in em["lines"])
            cands = []
            for i, it in enumerate(L):
                if i in used or it["app"] != "gmail" or it["coll"] != "messages" or it["op"] != "new":
                    continue
                m = it["after"]
                to = [addr(x) for x in m.get("to") or []]
                if "SENT" in (m.get("label_ids") or []) and FINANCE in to:
                    cands.append(i)
            ok, detail = False, "no email sent to " + FINANCE
            for i in cands:
                m = L[i]["after"]
                to = [addr(x) for x in m.get("to") or []]
                problems = []
                if to != [FINANCE] or m.get("cc") or m.get("bcc"):
                    problems.append(f"recipients to={to} cc={m.get('cc')} bcc={m.get('bcc')}")
                if text_key(m.get("subject")) != text_key(em["subject"]):
                    problems.append(f"subject {m.get('subject')!r} (want {em['subject']!r})")
                got = body_lines(m.get("body_plain") or m.get("body_html") or "")
                if got != want_lines:
                    problems.append(f"body lines missing {list((want_lines - got).elements())[:3]} extra {list((got - want_lines).elements())[:3]}")
                used.add(i)
                ok, detail = not problems, "; ".join(problems)
                break
            check("email", ok, detail)
        if exp.get("escalate"):
            cands = [i for i in new_msgs if i not in used and L[i]["after"].get("channel_id") == review
                     and truth["trigger"] in (L[i]["after"].get("text") or "")]
            if cands:
                used.add(cands[0])
            check("escalate", bool(cands), f"no #{REVIEW} post naming {truth['trigger']}")

        # 2. envelope -----------------------------------------------------------------------------------------------
        extra = [summarize(L[i]) for i in range(len(L)) if i not in used and not harmless(L[i])]
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
            check("ab", not failed, f"{len(failed)} failed: {[(a['type'], a.get('cell_contains') or a.get('text_contains') or a.get('to')) for a in failed][:3]}",
                  group="ab")

        # 4. end of week ---------------------------------------------------------------------------------------------
        if end is not None:
            checks.extend(self.end_checks(end, after, world0))

        ok_all = all(c["ok"] for c in checks)
        ok_core = all(c["ok"] for c in checks if c["group"] != "envelope")
        effects = [it for it in L if not harmless(it)]
        only_review = bool(effects) and all(it["app"] == "slack" and it["coll"] == "messages" and it["op"] == "new"
                                            and (it["after"] or {}).get("channel_id") == review for it in effects)
        if ok_all:
            outcome = "correct"
        elif not effects:
            outcome = "miss" if truth["outcome"] != "no-op" else "wrong"
        elif only_review and not exp.get("escalate"):
            outcome = "abstained"
        else:
            outcome = "wrong"
        return {"trigger": truth["trigger"], "kind": truth["kind"], "expected": truth["outcome"],
                "outcome": outcome, "pass": ok_all, "pass_core": ok_core,
                "score": round(sum(c["ok"] for c in checks) / len(checks), 4) if checks else 1.0,
                "n_effects": len(effects), "failed": [c for c in checks if not c["ok"]], "n_checks": len(checks)}

    def attribution_view(self, before: dict, after: dict, L: list[dict]):
        """world_after with Slack messages, sheet rows and mail restricted to what this trigger created or changed, so an
        earlier trigger's row or post never satisfies this trigger's assertion (and never trips its negative ones)."""
        v = copy.deepcopy(after)
        keep_msgs = {it["key"] for it in L if it["app"] == "slack" and it["coll"] == "messages" and it["op"] in ("new", "changed")
                     and not harmless(it)}
        keep_rows = {it["key"] for it in L if it["app"] == "google_sheets" and it["coll"] == "rows" and it["op"] in ("new", "changed")}
        keep_mail = {it["key"] for it in L if it["app"] == "gmail" and it["coll"] == "messages" and it["op"] == "new"}
        v["slack"]["messages"] = [m for m in v["slack"]["messages"] if _key("slack", "messages", m) in keep_msgs]
        rows = [r for r in v["google_sheets"]["rows"] if _key("google_sheets", "rows", r) in keep_rows]
        for r in rows:
            r["spreadsheet_id"], r["worksheet_id"] = sheet_ids(after, r)
        v["google_sheets"]["rows"] = rows
        v["gmail"]["messages"] = [m for m in v["gmail"]["messages"] if _key("gmail", "messages", m) in keep_mail]
        return self.WorldState(**v)

    def end_checks(self, end: dict, after: dict, world0: dict | None) -> list[dict]:
        out = []

        def check(name, ok, detail=""):
            out.append({"name": name, "ok": bool(ok), "detail": detail, "group": "end"})

        rows = sheet_rows(after, WS_SUB)
        by_ts = defaultdict(list)
        for r in rows:
            by_ts[str(r.get("cells", {}).get("Message TS", "")).strip()].append(r)
        dup = sorted(ts for ts, v in by_ts.items() if len(v) > 1)
        missing = sorted(set(end["rows"]) - set(by_ts))
        extra = sorted(set(by_ts) - set(end["rows"]))
        bad = []
        for ts, want in end["rows"].items():
            if ts in by_ts:
                diff = cells_equal(by_ts[ts][0].get("cells", {}), want)
                if diff:
                    bad.append(f"{ts}: {'; '.join(diff)}")
        check("end.submissions", not dup and not missing and not extra and not bad,
              f"missing {missing[:3]}; extra {extra[:3]}; duplicate {dup[:3]}; " + " | ".join(bad[:4]))
        if world0 is not None:
            for ws, name in ((WS_EMP, "employees"), (WS_POL, "policy")):
                a = sorted(canon(r.get("cells")) for r in sheet_rows(world0, ws))
                b = sorted(canon(r.get("cells")) for r in sheet_rows(after, ws))
                check(f"end.{name}", a == b, f"the {name} worksheet was edited")
            msgs0 = {_key("slack", "messages", m): m for m in world0["slack"]["messages"]}
            touched = [summarize(it) for it in ledger(world0, after)
                       if it["app"] == "slack" and it["op"] in ("changed", "removed") and not harmless(it)
                       and (it["op"] == "removed" or it["key"] in msgs0)]
            check("end.preexisting-unchanged", not touched, "; ".join(touched[:6]))
            human = {f"msg:{c}|{t}" for c, t in end["human"]}
            chan, review = chan_id(after, CHAN), chan_id(after, REVIEW)
            auto = [m for m in after["slack"]["messages"]
                    if _key("slack", "messages", m) not in msgs0 and _key("slack", "messages", m) not in human]
            got = Counter((m.get("thread_ts"), text_key(m.get("text"))) for m in auto
                          if m.get("channel_id") == chan and not m.get("is_deleted"))
            want = Counter((r["thread_ts"], text_key(r["text"])) for r in end["replies"])
            check("end.replies", got == want, f"missing {list((want - got).elements())[:3]}; extra {list((got - want).elements())[:3]}")
            rev = [m.get("text") or "" for m in auto if m.get("channel_id") == review and not m.get("is_deleted")]
            ok_rev = len(rev) == len(end["reviews"]) and all(any(t in x for x in rev) for t in end["reviews"])
            check("end.reviews", ok_rev, f"{len(rev)} #automation-review posts, want {len(end['reviews'])} naming {end['reviews']}")
            elsewhere = [m.get("text") for m in auto if m.get("channel_id") not in (chan, review)]
            check("end.elsewhere", not elsewhere, f"posts outside the two channels: {elsewhere[:3]}")
            mail0 = {_key("gmail", "messages", m) for m in world0["gmail"]["messages"]}
            sent = [m for m in after["gmail"]["messages"] if _key("gmail", "messages", m) not in mail0]
            check("end.mail", len(sent) == 1, f"{len(sent)} emails sent this week, want 1 (the weekly totals)")
        if self.use_ab and end["assertions"]:
            w = self.WorldState(**copy.deepcopy(after))
            failed = [a for a in end["assertions"] if not self.Registry.check(w, a)]
            check("end.ab", not failed, f"{len(failed)} failed: {[a.get('cell_contains') for a in failed][:3]}")
        return out
