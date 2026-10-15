#!/usr/bin/env python3
"""abr-hr-referral oracle (RECURRING-DESIGN §3.6). Host-side; it never reads a solver's output to decide what was right.

Inputs per trigger: the host-only truth row (gen.py), world_before and world_after (WorldState JSON dumps taken just
before and just after the arm handled the trigger; world_before already holds the trigger's delta), and, at the last
trigger of the week (Friday's payout run), end.json plus world0.

Checks per trigger:
  1. effects   every expected effect is found in THIS trigger's ledger (attribution): each expected Referral Log cell
               change on the right row (by record id) with no other cell or row field changed (Status compared ignoring
               letter case and extra spaces, Hold `Yes` or empty, Bonus as a whole-dollar amount, Paid On exactly
               YYYY-MM-DD); each expected email as a new SENT message with exactly one recipient (To, CC and BCC
               together), the exact subject (whitespace collapsed, letter case ignored) and the required facts in the
               body (letter case ignored, digit-grouping commas ignored, no partial-number matches).
  2. envelope  every record created, changed or removed in this trigger is an expected effect or harmless (marking
               mail read or labelling it, creating Gmail labels). Anything else is overreach: another email or recipient,
               any Slack post, any other sheet edit.
  3. ab        the truth's AutomationBench assertion dicts (gmail_message_sent_to_with_body_contains with only_recipient,
               gmail_message_not_sent_to[_with_body_contains], slack_message_not_exists, google_sheets_row_exists),
               checked with AutomationBench's own AssertionRegistry on an attribution view: world_after with Gmail
               messages, Slack messages and sheet rows restricted to what this trigger created or changed.
  4. end       (last trigger only) every Referral Log row's final cells, no row added or removed; Employees and Bonus
               Policy as expected; the week's sent mail as a multiset (recipients, subject); no Slack message posted all
               week; on the arm's own final world: every referrer's total for the year within the $10,000 cap, no
               Referral ID sent to payroll twice, no payout dated before day 90; no pre-existing message edited; plus
               AutomationBench's own end assertions on the whole world.

Outcome: correct (all checks pass) | abstained (only #automation-review posts, truth is not an escalation) |
miss (no effect at all, truth expected effects) | wrong (anything else). `pass` includes the envelope; `pass_core`
is the same verdict without it (reported beside the headline).
"""
from __future__ import annotations

import copy
import json
import re
from collections import Counter, defaultdict
from datetime import date, timedelta

SS, WS_LOG, WS_EMP, WS_POL = "ss_referral", "ws_referrals", "ws_employees", "ws_bonus_policy"
REVIEW = "automation-review"
PAYROLL = "payroll@company.example.com"
AUTO_COLS = ("Hold", "Status", "Bonus", "Paid On")
HARMLESS_GMAIL = {"is_read", "label_ids"}
MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def ws_key(s) -> str:
    return " ".join(str(s or "").split()).lower()


def subject_key(s) -> str:
    return " ".join(str(s or "").split()).lower()


def addr(s) -> str:
    m = re.search(r"<([^<>]+)>\s*$", str(s or ""))
    return (m.group(1) if m else str(s or "")).strip().lower()


def body_norm(s) -> str:
    t = str(s or "").lower()
    t = re.sub(r"(\d),(\d)", r"\1\2", t)
    return re.sub(r"(\d)\.0+(?!\d)", r"\1", t)


def contains(hay: str, needle: str) -> bool:
    n = body_norm(needle)
    pre = r"(?<![a-z0-9])" if n[:1].isalnum() else ""
    suf = r"(?!\d|\.\d)" if n[-1:].isdigit() else ""
    return re.search(pre + re.escape(n) + suf, body_norm(hay)) is not None


def money_of(s) -> int | None:
    t = str(s or "").strip()
    if not re.fullmatch(r"\$?\s?\d{1,3}(,\d{3})*(\.00?)?|\$?\s?\d+(\.00?)?", t):
        return None
    return int(re.sub(r"[^\d]", "", t.split(".")[0]))


def cell_ok(col: str, got, want) -> bool:
    if col == "Status":
        return ws_key(got) == ws_key(want)
    if col == "Hold":
        return ws_key(got) == ws_key(want)
    if col == "Bonus":
        return (money_of(got) == money_of(want)) if str(want).strip() else not str(got or "").strip()
    return str(got if got is not None else "").strip() == str(want)


def parse_date(s) -> date | None:
    t = " ".join(str(s or "").split())
    try:
        m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", t)
        if m:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", t)
        if m:
            return date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
        m = re.fullmatch(r"([A-Za-z]{3})[A-Za-z]*\.? (\d{1,2}), (\d{4})", t)
        if m and m.group(1).lower() in MONTHS:
            return date(int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2)))
        m = re.fullmatch(r"(\d{1,2}) ([A-Za-z]{3})[A-Za-z]* (\d{4})", t)
        if m and m.group(2).lower() in MONTHS:
            return date(int(m.group(3)), MONTHS[m.group(2).lower()], int(m.group(1)))
    except ValueError:
        return None
    return None


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
        s = next((x["id"] for x in gs.get("spreadsheets", []) if ws_key(x.get("title")) == ws_key(s)), s)
    w = row.get("worksheet_id")
    if not any(x.get("id") == w and x.get("spreadsheet_id") == s for x in gs.get("worksheets", [])):
        w = next((x["id"] for x in gs.get("worksheets", []) if x.get("spreadsheet_id") == s
                  and ws_key(x.get("title")) == ws_key(w)), w)
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
    if it["app"] == "slack" and it.get("coll") == "messages":
        return f"slack.{it['op']} {rec.get('channel_id')}: {str(rec.get('text'))[:80]!r}"
    if it["app"] == "gmail" and it.get("coll") == "messages":
        return f"gmail.{it['op']} to={recipients(rec)} {str(rec.get('subject'))[:60]!r} {it.get('fields', '')}"
    if it["app"] == "google_sheets" and it.get("coll") == "rows":
        c = rec.get("cells") or {}
        return f"sheets.row.{it['op']} {rec.get('worksheet_id')}#{rec.get('row_id')} {c.get('Referral ID') or c.get('Employee ID')} {it.get('fields', '')}"
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
        used: set[int] = {i for i, it in enumerate(L) if harmless(it)}
        checks: list[dict] = []
        exp = truth["expect"]

        def check(name, ok, detail="", group="effects"):
            checks.append({"name": name, "ok": bool(ok), "detail": detail, "group": group})

        # 1a. Referral Log cells -------------------------------------------------------------------------------------
        for ch in exp["cells"]:
            idx = next((i for i, it in enumerate(L) if it["app"] == "google_sheets" and it["coll"] == "rows"
                        and it["op"] == "changed" and it["key"] == f"id:{ch['id']}"), None)
            name = f"cells {ch['rid']} {sorted(ch['set'])}"
            if idx is None:
                check(name, False, f"row {ch['row_id']} not changed (want {ch['set']})")
                continue
            used.add(idx)
            b, a = L[idx]["before"].get("cells") or {}, L[idx]["after"].get("cells") or {}
            bad = [f"{k}={a.get(k)!r} (want {v!r})" for k, v in ch["set"].items() if not cell_ok(k, a.get(k), v)]
            other = sorted(k for k in set(a) | set(b) if k not in ch["set"] and str(a.get(k) or "") != str(b.get(k) or ""))
            fields = [f for f in L[idx]["fields"] if f != "cells"]
            check(name, not bad and not other and not fields, f"{bad}; other cells {other}; fields {fields}")

        # 1b. emails -----------------------------------------------------------------------------------------------
        new_sent = [i for i, it in enumerate(L) if it["app"] == "gmail" and it["coll"] == "messages" and it["op"] == "new"
                    and is_sent(it["after"])]
        for em in exp["emails"]:
            cands = [i for i in new_sent if i not in used and recipients(L[i]["after"]) == [em["to"]]
                     and subject_key(L[i]["after"].get("subject")) == subject_key(em["subject"])]
            full = [i for i in cands if all(contains(body_of(L[i]["after"]), n) for n in em["needles"])]
            if full:
                used.add(full[0])
            elif cands:
                missing = [n for n in em["needles"] if not contains(body_of(L[cands[0]]["after"]), n)]
                check(f"email {em['kind']} {em['subject'][:40]}", False, f"body lacks {missing}")
                continue
            check(f"email {em['kind']} {em['subject'][:40]}", bool(full),
                  f"no new email to {em['to']} only, subject {em['subject']!r}")
        review = _chan_id(after, REVIEW)
        new_msgs = [i for i, it in enumerate(L) if it["app"] == "slack" and it["coll"] == "messages" and it["op"] == "new"]
        if exp.get("escalate"):
            cands = [i for i in new_msgs if i not in used and L[i]["after"].get("channel_id") == review
                     and truth["trigger"] in (L[i]["after"].get("text") or "")]
            if cands:
                used.add(cands[0])
            check("escalate", bool(cands), f"no #{REVIEW} post naming {truth['trigger']}")

        # 2. envelope ------------------------------------------------------------------------------------------------
        extra = [summarize(L[i]) for i in range(len(L)) if i not in used]
        check("envelope", not extra, "; ".join(extra[:6]), group="envelope")

        # 3. AutomationBench's own assertion handlers ---------------------------------------------------------------
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
            check("ab", not failed, f"{len(failed)} failed: {[(a['type'], a.get('to') or a.get('cells') or a.get('text_contains'), a.get('body_contains')) for a in failed][:4]}",
                  group="ab")

        # 4. end of week ---------------------------------------------------------------------------------------------
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

    def attribution_view(self, after: dict, L: list[dict]):
        """world_after with Gmail messages, Slack messages and sheet rows restricted to what this trigger created or
        changed, so an earlier trigger's effect never satisfies this trigger's assertion (and never trips its negative
        ones)."""
        v = copy.deepcopy(after)
        keep = {(it["app"], it["coll"], it["key"]) for it in L if it["op"] in ("new", "changed")}
        v["gmail"]["messages"] = [m for m in v["gmail"]["messages"] if ("gmail", "messages", _key("gmail", "messages", m)) in keep]
        v["slack"]["messages"] = [m for m in v["slack"]["messages"] if ("slack", "messages", _key("slack", "messages", m)) in keep]
        rows = [r for r in v["google_sheets"]["rows"] if ("google_sheets", "rows", _key("google_sheets", "rows", r)) in keep]
        for r in rows:
            r["spreadsheet_id"], r["worksheet_id"] = sheet_ids(after, r)
        v["google_sheets"]["rows"] = rows
        return self.WorldState(**v)

    def end_checks(self, end: dict, after: dict, world0: dict | None) -> list[dict]:
        out = []

        def check(name, ok, detail=""):
            out.append({"name": name, "ok": bool(ok), "detail": detail, "group": "end"})

        # the Referral Log: every row's final cells
        rows = {r.get("id"): r for r in sheet_rows(after, WS_LOG)}
        missing = sorted(set(end["log"]) - set(rows))
        extra = sorted(set(rows) - set(end["log"]))
        bad = []
        for rid, want in end["log"].items():
            r = rows.get(rid)
            if r is None:
                continue
            c = r.get("cells") or {}
            for k in sorted(set(want) | set(c)):
                w, g = want.get(k, ""), c.get(k, "")
                ok = cell_ok(k, g, w) if k in AUTO_COLS else str(g or "") == str(w or "")
                if not ok:
                    bad.append(f"{want.get('Referral ID')}.{k}={g!r} (want {w!r})")
        check("end.referral-log", not missing and not extra and not bad,
              f"missing rows {len(missing)}; extra rows {len(extra)}; " + "; ".join(bad[:6]))
        emps = {str(r.get("row_id")): r.get("cells") for r in sheet_rows(after, WS_EMP)}
        check("end.employees", canon(emps) == canon(end["employees"]), "the Employees sheet differs from the week's record")
        # invariants on the arm's own final world (design §4.11: totals within the cap, no double pay, not before day 90)
        log = [r.get("cells") or {} for r in sheet_rows(after, WS_LOG)]
        totals: dict[str, int] = {}
        early = []
        week = (date.fromisoformat(end["week_start"]), date.fromisoformat(end["friday"]))
        for c in log:
            if ws_key(c.get("Status")) != "paid":
                continue
            paid_on = parse_date(c.get("Paid On"))
            if paid_on and paid_on.year == end["year"]:
                k = str(c.get("Referrer Email") or "").strip().lower()
                totals[k] = totals.get(k, 0) + (money_of(c.get("Bonus")) or 0)
            hire = parse_date(c.get("Hire Date"))
            if paid_on and week[0] <= paid_on <= week[1] and (hire is None or paid_on < hire + timedelta(days=90)):
                early.append(c.get("Referral ID"))
        over = sorted(k for k, v in totals.items() if v > end["cap"])
        check("end.cap", not over, f"referrers over the yearly cap: {over[:4]}")
        check("end.day90", not early, f"paid this week before day 90: {early[:4]}")
        if world0 is not None:
            pol0 = sorted(canon(r.get("cells")) for r in sheet_rows(world0, WS_POL))
            pol = sorted(canon(r.get("cells")) for r in sheet_rows(after, WS_POL))
            check("end.bonus-policy", pol == pol0, "the Bonus Policy sheet was edited")
            ids0 = {m["id"] for m in world0["gmail"]["messages"]}
            got = Counter((tuple(recipients(m)), subject_key(m.get("subject"))) for m in after["gmail"]["messages"]
                          if m["id"] not in ids0 and is_sent(m))
            want = Counter(((to,), subject_key(s)) for to, s in end["emails"])
            check("end.emails", got == want, f"missing {list((want - got).elements())[:3]}; extra {list((got - want).elements())[:3]}")
            payroll = Counter()
            for m in after["gmail"]["messages"]:
                if is_sent(m) and PAYROLL in recipients(m):
                    for rid in set(re.findall(r"\bREF-\d+\b", f"{m.get('subject') or ''}\n{body_of(m)}")):
                        payroll[rid] += 1
            twice = sorted(k for k, v in payroll.items() if v > 1)
            check("end.paid-once", not twice, f"Referral IDs sent to payroll more than once: {twice[:4]}")
            keys0 = {_key("slack", "messages", m) for m in world0["slack"]["messages"]}
            week_keys = {f"msg:{c}|{t}" for c, t in end["slack_week"]}
            posted = [m.get("text") for m in after["slack"]["messages"]
                      if _key("slack", "messages", m) not in keys0 and _key("slack", "messages", m) not in week_keys]
            check("end.no-slack-posts", not posted, f"{len(posted)} Slack posts: {[str(t)[:60] for t in posted[:3]]}")
            touched = [summarize(it) for it in ledger(world0, after)
                       if it["op"] in ("changed", "removed") and it["app"] in ("slack", "gmail") and not harmless(it)]
            check("end.preexisting-unchanged", not touched, "; ".join(touched[:6]))
        if self.use_ab and end["assertions"]:
            w = self.WorldState(**copy.deepcopy(after))
            failed = [a for a in end["assertions"] if not self.Registry.check(w, a)]
            check("end.ab", not failed, f"{len(failed)} failed: {[(a['type'], a.get('to') or a.get('text_contains')) for a in failed][:4]}")
        return out
