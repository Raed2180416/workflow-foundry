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
                 be one message to each recipient. Per kind of email:
                   forward          the subject is exactly `HR request <Employee ID>: <Category>` (letter case and the
                                    spaces around ':' ignored), so a wrong-shaped forward fails where it is sent;
                   acknowledgement  a line says `Your request has been routed to <Category>` followed by '.' or the
                                    end of the line, no other category is named, and no sentence claims the request
                                    was changed, approved or done (quoted lines and the employee's own text excepted);
                   fraud report     the subject starts with `Possible fraud` and holds the email's subject; no claim
                                    that anything was changed;
                   week close       the body's `<label>: <number>` lines are exactly the eight labels in policy order
                                    (bullets, a greeting or a sign-off around them are fine; another count line is
                                    not), no name, Employee ID or Case ID, and each number is what POLICY section 8
                                    counts in world_before: this week's Sent mail whose subject is `HR request
                                    <Employee ID>: <Category>`, the `Possible fraud` emails, and the tracker rows
                                    Filed this week whose Status starts with `Routed to`. In carry mode that is the
                                    arm's own record, so an earlier error is never charged a second time at the close;
               - each expected Grievance Tracker Status is set (and no other cell of the row changed);
               - each expected Policy Log row is appended (Effective to the minute, Parameter, Value, Approved by);
               - an expected escalation is a new #automation-review message naming the trigger id.
  2. envelope  every record created, changed or removed in this trigger is an expected effect or harmless (marking
               mail read, labels): no other email, no CC, no sheet edit, no Slack post.
  3. slack     no Slack message created or changed in this trigger contains a Case ID (grievances are confidential);
               on a grievance trigger, none contains that grievance's details either: its Case ID in any separator
               form (`GR 2026 141`, `case 141`), the employee's name or Employee ID, the tracker's Manager, anyone
               the Description names (full or last name), or any six consecutive words of the Description.
  4. ab        the truth's AutomationBench assertion dicts (gmail_message_sent_to_with_body_contains,
               gmail_message_not_sent_to, google_sheets_row_updated, google_sheets_row_exists, slack_message_exists,
               slack_message_not_exists), checked with AutomationBench's own AssertionRegistry on an attribution view:
               world_after with the Gmail and Slack messages and the sheet rows restricted to what this trigger
               created or changed.
  5. end       (last trigger only) a SEPARATE end-of-week verdict (`week`), never part of the close trigger's own
               `pass`: the Grievance Tracker exactly as the week's correct handling leaves it; the Policy Log rows as a
               multiset; Routing Rules and Employee Directory unchanged; per address, the number of emails sent this
               week (exactly once: no duplicate forward, acknowledgement or route); no Slack message anywhere with a
               Case ID, and no new one with any grievance's details; the week's new Slack messages are the expected
               escalations only; no pre-existing message edited or removed; plus AutomationBench's
               slack_message_not_exists per Case ID and gmail_message_not_sent_to for every mailbox that should get
               nothing this week, on the week's view. A clean week is every trigger passing AND this verdict passing.

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
ID_RE = re.compile(r"(?<![A-Za-z0-9])emp[-\s]?\d{4}(?![0-9])", re.I)


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


def plain_of(m: dict) -> str:
    """The message body as lines: the plain part, or the HTML part with its tags turned into line breaks."""
    return str(m.get("body_plain") or "") or re.sub(r"<[^>]+>", "\n", str(m.get("body_html") or ""))


def phrase(k: str) -> re.Pattern:
    """A word or phrase as a whole, ignoring letter case and runs of spaces."""
    return re.compile(r"(?<![A-Za-z0-9])" + r"\s+".join(re.escape(w) for w in str(k).split()) + r"(?![A-Za-z0-9])", re.I)


def subj_key(s) -> str:
    """A subject compared ignoring letter case, runs of spaces and the spaces around ':'."""
    return re.sub(r"\s*:\s*", ": ", wsk(s)).strip()


FWD_SUBJECT = re.compile(r"^hr request (emp-\d{4}): (.+)$")


def forward_category(subject, categories) -> str | None:
    """POLICY section 8: the category of a Sent forward whose subject is `HR request <Employee ID>: <Category>`."""
    m = FWD_SUBJECT.match(subj_key(subject))
    if not m:
        return None
    return next((c for c in categories if wsk(c) == m.group(2)), None)


def summary_lines(body: str) -> list[tuple[str, int]]:
    """The `<label>: <number>` lines of a summary body, in order (an optional '-', '*' or '•' bullet is tolerated)."""
    out = []
    for ln in str(body or "").splitlines():
        m = re.match(r"^\s*[-*•]?\s*([A-Za-z][A-Za-z /-]*?)\s*:\s*(\d+)\s*\.?\s*$", ln)
        if m:
            out.append((wsk(m.group(1)), int(m.group(2))))
    return out


def summary_counts(body: str) -> dict:
    """`<label>: <number>` lines of a summary body, by label (a label written twice keeps both numbers)."""
    out: dict = defaultdict(list)
    for k, v in summary_lines(body):
        out[k].append(v)
    return out


def unquoted(body: str, orig: dict | None) -> str:
    """The body, whitespace collapsed and lower-cased, without lines starting with '>' and without any line, sentence
    or subject of the inbound email it may quote: what the automation itself says."""
    t = " " + wsk(" ".join(ln for ln in str(body or "").splitlines() if not ln.lstrip().startswith(">"))) + " "
    pieces = []
    if orig:
        pieces.append(orig.get("subject"))
        for ln in str(orig.get("body") or "").splitlines():
            ln = ln.strip().lstrip(">").strip()
            pieces += [ln] + re.split(r"(?<=[.!?])\s+", ln)
    for p in sorted({wsk(p) for p in pieces if len(wsk(p)) >= 8}, key=len, reverse=True):
        t = t.replace(p, " ")
    return t


# A sentence that says the request was resolved: "I have made the change", "we've updated your bank details", "your
# password has been reset", "it is now approved", "no further action needed". Conditional forms ("once it has been
# approved", "when your address has been updated") are not claims. Routing words (routed, forwarded, received,
# passed on) never match.
_VERBS = r"(?:changed|updated|approved|reset|granted|resolved|fixed|completed|actioned|made\s+the\s+changes?|taken\s+care\s+of)"
CLAIMS = [
    re.compile(r"\b(?:i|we)(?:'ve|\s+have|\s+had)?(?:\s+(?:also|already|now|just|gone\s+ahead\s+and|went\s+ahead\s+and))*\s+" + _VERBS + r"\b", re.I),
    re.compile(r"\b(?:has|have)(?:\s+(?:now|already|also|just))*\s+been\s+(?:changed|updated|approved|reset|granted|resolved|fixed|"
               r"completed|actioned|done|made)\b", re.I),
    re.compile(r"\b(?:is|are)\s+(?:now|already|all)\s+(?:done|approved|updated|changed|resolved|fixed|complete|sorted)\b", re.I),
    re.compile(r"\b(?:approved|done)\s+and\s+(?:done|approved|complete|completed)\b", re.I),
    re.compile(r"\bno\s+further\s+action\b", re.I),
]
_CONDITIONAL = re.compile(r"\b(?:once|when|after|until|if|whether|before|as\s+soon\s+as)\b[^.!?;]*$", re.I)


def resolution_claims(text: str) -> list[str]:
    out = []
    for pat in CLAIMS:
        for m in pat.finditer(text):
            if pat is not CLAIMS[-1] and _CONDITIONAL.search(text[max(0, m.start() - 60):m.start()]):
                continue
            out.append(m.group(0))
    return out


def routed_line_ok(body: str, cat: str) -> bool:
    """A line (not quoted) says `Your request has been routed to <Category>` followed by '.' or the end of the line."""
    pat = re.compile(r"your\s+request\s+has\s+been\s+routed\s+to\s+" + r"\s+".join(re.escape(w) for w in cat.split())
                     + r"\s*(?:\.|$)", re.I)
    return any(pat.search(ln) for ln in str(body or "").splitlines() if not ln.lstrip().startswith(">"))


def content_ok(m: dict, em: dict, ctx: dict | None = None) -> tuple[bool, str]:
    """ctx: {'categories': the Routing Rules categories, 'counts': the week close's expected counts}."""
    ctx = ctx or {}
    subj, body = str(m.get("subject") or ""), body_of(m)
    miss = [t for t in em.get("subject_has", []) if not has(subj, t)]
    miss += [t for t in em.get("body_has", []) if not has(body, t)]
    if miss:
        return False, f"missing {miss[:3]}"
    if "subject_is" in em and subj_key(subj) != subj_key(em["subject_is"]):
        return False, f"subject {subj[:70]!r} is not {em['subject_is']!r}"
    if "subject_prefix" in em and not subj_key(subj).startswith(subj_key(em["subject_prefix"])):
        return False, f"subject {subj[:70]!r} does not start with {em['subject_prefix']!r}"
    plain = plain_of(m)
    if "routed_to" in em:
        cat = em["routed_to"]
        if not routed_line_ok(plain, cat):
            return False, f"no line 'Your request has been routed to {cat}.' (that category alone)"
        said = unquoted(plain, em.get("orig"))
        others = [c for c in ctx.get("categories") or [] if wsk(c) != wsk(cat) and phrase(c).search(said)]
        if others:
            return False, f"the acknowledgement also names {others[:3]}"
    if em.get("no_claims"):
        said = resolution_claims(unquoted(plain, em.get("orig")))
        if said:
            return False, f"claims the request was resolved: {said[:2]}"
    bad = [t for t in em.get("body_not", []) if has(body, t)]
    if "counts" in em:                     # the week-close summary: counts only, no Employee ID or Case ID of any form
        bad += [x.group(0) for x in (ID_RE.search(body), CASE_RE.search(body)) if x]
    if bad:
        return False, f"body names {bad[:3]}"
    if "counts" in em:
        want = ctx.get("counts") or em["counts"]
        lines = summary_lines(plain)
        order = [wsk(k) for k in em.get("labels") or list(want)]
        if [k for k, _ in lines] != order:
            return False, f"count lines {[k for k, _ in lines][:10]} are not exactly {order} in that order"
        got = summary_counts(plain)
        wrong = [f"{k}: {got.get(wsk(k))} (want {v})" for k, v in want.items() if got.get(wsk(k)) != [v]]
        if wrong:
            return False, "counts " + "; ".join(wrong[:4])
    return True, ""


def derive_counts(world: dict, em: dict) -> dict:
    """POLICY section 8 applied to a world (world_before at the week close): this week's Sent mail whose subject is
    `HR request <Employee ID>: <Category>`, per category; the `Possible fraud` emails sent this week; the Grievance
    Tracker rows Filed this week whose Status starts with `Routed to`."""
    labels = em.get("labels") or list(em["counts"])
    since = datetime.fromisoformat(em["derive"]["since"].replace("Z", "+00:00"))
    since_ms, first, last = int(since.timestamp() * 1000), since.date().isoformat(), em["derive"]["until"]
    cats = [str(c.get("cells", {}).get("Category") or "") for c in sheet_rows(world, WS_RULES)]
    out = {k: 0 for k in labels}
    key = {wsk(k): k for k in labels}
    for m in world.get("gmail", {}).get("messages", []):
        if not is_sent(m) or int(m.get("date") or 0) < since_ms:
            continue
        cat = forward_category(m.get("subject"), cats)
        if cat is not None and wsk(cat) in key:
            out[key[wsk(cat)]] += 1
        elif subj_key(m.get("subject")).startswith("possible fraud") and "fraud reports" in key:
            out[key["fraud reports"]] += 1
    for r in sheet_rows(world, WS_GRIEV):
        c = r.get("cells") or {}
        filed = str(c.get("Filed") or "").strip()[:10]
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", filed) and first <= filed <= last and wsk(c.get("Status")).startswith("routed to") \
                and "grievances" in key:
            out[key["grievances"]] += 1
    return out


def slack_leaks(text: str, sec: dict, strict: bool = True) -> list[str]:
    """Grievance details (POLICY section 6) in one Slack text. strict (the grievance's own trigger): the case number
    alone counts too; otherwise only with a `GR` or `case` in front of it."""
    t = str(text or "")
    hits = []
    m = re.match(r"^GR-(\d{4})-0*(\d+)$", str(sec["case_id"]).strip(), re.I)
    if m:
        year, num = m.group(1), m.group(2)
        forms = [rf"GR\W*{year}\W*0*{num}(?!\d)", rf"(?:\b(?:gr|case|grievance|no|number)|#)\W*0*{num}(?!\d)"]
        if strict:
            forms.append(rf"(?<!\d)0*{num}(?!\d)")
        if any(re.search(f, t, re.I) for f in forms):
            hits.append(f"case {sec['case_id']}")
    for name in sec.get("names") or []:
        last_name = name.split()[-1]
        if phrase(name).search(t) or (len(last_name) >= 4 and phrase(last_name).search(t)):
            hits.append(f"name {name}")
    for eid in sec.get("employee_ids") or []:
        d = re.sub(r"\D", "", str(eid))
        if d and re.search(rf"(?<![A-Za-z0-9])emp\W*{d}(?!\d)", t, re.I):
            hits.append(f"id {eid}")
    words = re.findall(r"[a-z0-9']+", str(sec.get("description") or "").lower())
    tw = " " + " ".join(re.findall(r"[a-z0-9']+", t.lower())) + " "
    spans = [words[i:i + 6] for i in range(max(1, len(words) - 5))] if words else []
    if any(" " + " ".join(s) + " " in tw for s in spans):
        hits.append("description")
    return hits


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
        assertions = list(truth["assertions"])
        derived = {}
        categories = [str((r.get("cells") or {}).get("Category") or "") for r in sheet_rows(before, WS_RULES)]

        def check(name, ok, detail="", group="effects"):
            checks.append({"name": name, "ok": bool(ok), "detail": detail, "group": group})

        # 1a. emails -------------------------------------------------------------------------------------------------
        new_sent = [i for i, it in enumerate(L) if it["app"] == "gmail" and it["coll"] == "messages" and it["op"] == "new"
                    and is_sent(it["after"])]
        for em in exp["emails"]:
            want = sorted(em["to"])
            ctx = {"categories": categories}
            if "derive" in em:
                # The week close counts the arm's own record (world_before), as POLICY section 8 says; AutomationBench's
                # handler checks the same numbers.
                ctx["counts"] = derived = derive_counts(before, em)
                assertions.append({"type": "gmail_message_sent_to_with_body_contains", "to": want[0],
                                   "subject_contains": em["subject_has"][0],
                                   "body_contains": [f"{k}: {v}" for k, v in derived.items()]})
            why = []
            cands = []
            for i in new_sent:
                if i in used or recipients(L[i]["after"]) != want:
                    continue
                ok, w = content_ok(L[i]["after"], em, ctx)
                (cands.append(i) if ok else why.append(w))
            if cands:
                used.add(cands[0])
                check(f"email {em['tag']} {want}", True)
                continue
            if em.get("split_ok"):
                picks = []
                for r in want:
                    one = [i for i in new_sent if i not in used and i not in picks and recipients(L[i]["after"]) == [r]
                           and content_ok(L[i]["after"], em, ctx)[0]]
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
        texts = [str((it["after"] or {}).get("text") or "") for it in L
                 if it["app"] == "slack" and it["coll"] == "messages" and it["op"] in ("new", "changed")]
        leaks = [t[:80] for t in texts if CASE_RE.search(t)]
        check("slack.no-case-id", not leaks, f"Case ID in Slack: {leaks[:2]}", group="guard")
        if exp.get("slack_secret"):
            details = [(t[:80], h) for t in texts for h in [slack_leaks(t, exp["slack_secret"])] if h]
            check("slack.no-grievance-details", not details, f"grievance details in Slack: {details[:2]}", group="guard")

        # 4. AutomationBench's own assertion handlers ---------------------------------------------------------------
        if self.use_ab and assertions:
            view = self.attribution_view(after, L)
            failed = []
            for a in assertions:
                try:
                    ok = bool(self.Registry.check(view, a))
                except Exception as e:  # noqa: BLE001  a raising handler is a failed check, reported
                    ok, a = False, dict(a, error=f"{type(e).__name__}: {e}")
                if not ok:
                    failed.append(a)
            check("ab", not failed, f"{len(failed)} failed: {[(a['type'], a.get('to') or a.get('cell_contains') or a.get('text_contains')) for a in failed][:4]}",
                  group="ab")

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
        out = {"trigger": truth["trigger"], "kind": truth["kind"], "expected": truth["outcome"],
               "outcome": outcome, "pass": ok_all, "pass_core": ok_core,
               "score": round(sum(c["ok"] for c in checks) / len(checks), 4) if checks else 1.0,
               "n_effects": len(real), "failed": [c for c in checks if not c["ok"]], "n_checks": len(checks)}
        if derived:
            out["derived_counts"] = derived
        # 5. end of week: a separate per-stream verdict, never part of the week-close trigger's own pass ------------
        if end is not None:
            wk = self.end_checks(end, after, world0)
            out["week"] = {"pass": all(c["ok"] for c in wk), "failed": [c for c in wk if not c["ok"]], "n_checks": len(wk)}
        return out

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
            details = [(str(m.get("text"))[:60], h) for m in new_s for sec in end.get("slack_secrets") or []
                       for h in [slack_leaks(m.get("text"), sec, strict=False)] if h]
            check("end.no-grievance-details-in-slack", not details, f"{details[:2]}")
            if self.use_ab and end["assertions"]:
                keep = {("gmail", "messages", _key("gmail", "messages", m)) for m in week}
                keep |= {("slack", "messages", _key("slack", "messages", m)) for m in after["slack"]["messages"]}
                keep |= {("google_sheets", "rows", _key("google_sheets", "rows", r)) for r in after["google_sheets"]["rows"]}
                w = self.view_of(after, keep)
                failed = [a for a in end["assertions"] if not self.Registry.check(w, a)]
                check("end.ab", not failed, f"{len(failed)} failed: {[(a['type'], a.get('to') or a.get('text_contains')) for a in failed][:4]}")
        return out
