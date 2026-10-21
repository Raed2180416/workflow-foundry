#!/usr/bin/env python3
"""abr-sup-gdpr oracle (RECURRING-DESIGN §3.6). Host-side; it never reads a solver's output to decide what was right.

Inputs per trigger: the host-only truth row (gen.py), world_before and world_after (WorldState JSON dumps taken just
before and just after the arm handled the trigger; world_before already holds the trigger's delta), and, at the last
trigger of the week (Friday's day close), end.json plus world0.

Checks per trigger:
  1. audit     the hard requirement: no Compliance Log row that existed before the trigger was changed or removed
               (append-only), and the trigger appended exactly the expected rows: one per transition, matched as a
               multiset on (Request ID, Email, Transition, At, Reference), in the expected order per request.
     effects   every expected effect is found in THIS trigger's ledger (attribution): each email (exactly one
               recipient, the exact subject, the Request ID in the body, sent and neither trashed nor marked spam);
               each anonymized ticket (subject = the prefix + the old subject, character for character; tags = the
               old tags + gdpr-purged, exactly and in any order; nothing else changed); each deleted user; each
               #privacy-ops summary (the exact text).
  2. envelope  every record created, changed or removed in this trigger is an expected effect or harmless (marking
               mail read or labelling it, creating Gmail labels, a ticket or user `updated_at` touch with no other
               change). Anything else is overreach: another email (or a required one moved to Trash or Spam), post,
               ticket or user change, a sheet edit.
  3. ab        the truth's AutomationBench assertion dicts (zendesk_ticket_exists / _has_tag / _not_has_tag,
               zendesk_user_exists / _not_exists, gmail_message_sent_to_with_body_contains / _not_sent_to,
               google_sheets_row_exists / _row_not_updated, slack_message_exists), checked with AutomationBench's own
               AssertionRegistry on an attribution view: world_after with Gmail, Slack and sheet rows restricted to
               what this trigger created or changed (Zendesk is state and is checked whole).
  4. end       (last trigger only) the Compliance Log: world0 rows unchanged and in place, the week's rows equal to
               the truth multiset; the statutory deadline computed from the arm's own world (no request 30 or more
               days old at Friday without a terminal or hold state); the Zendesk users and every ticket's subject and
               tags; the request, hold and config sheets unedited; the week's emails and summaries as multisets; no
               pre-existing message edited; plus AutomationBench's own end assertions on the whole world.

Outcome: correct (all checks pass) | abstained (only #automation-review posts, truth is not an escalation) |
miss (no effect at all, truth expected effects) | wrong (anything else). `pass` includes the envelope; `pass_core`
is the same verdict without it (reported beside the headline).

Exactness (tightened 2026-10-21 after review; family.json `exactness`). Every text POLICY.md fixes is compared as
written, with no case folding, whitespace collapsing or trailing-period tolerance:
  - a ticket subject and its tags: exactly (tags as a multiset, so their order is free);
  - a #privacy-ops summary: exactly (POLICY.md §8.2 "exactly");
  - a log row: Request ID, Transition and Reference exactly as text (AutomationBench's own google_sheets_row_exists,
    run beside it, compares Request ID and Transition exactly too); for Purged and Blocked rows the Reference is a
    comma-separated list (POLICY.md: "comma-separated"), compared as a set of ids, a space after a comma allowed; At
    as the event's `at` in any UTC spelling of that instant (`+00:00` for `Z`, a space for `T`, no seconds when they
    are 0, no offset); another offset, or another instant even within the same minute, is a different At;
  - an email subject: exactly after trimming its ends (a header's surrounding whitespace is not part of it).
The only normalisation that is not an exact match is the address rule POLICY.md §3 itself states (letter case and
surrounding spaces): the log row's Email and the email recipient compare as addresses.
"""
from __future__ import annotations

import copy
import json
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

SS = "ss_gdpr"
WS_REQ, WS_HOLD, WS_LOG, WS_CFG = "ws_requests", "ws_legal_hold", "ws_compliance_log", "ws_config"
LOG_HEADERS = ["Request ID", "Email", "Transition", "At", "Reference"]
PRIVACY_OPS, REVIEW = "privacy-ops", "automation-review"
TAG = "gdpr-purged"
SET_REF_EXACT = ("Purged", "Blocked - Legal Hold")
TERMINAL = {"purged", "not found", "duplicate", "closed - unverified", "blocked - legal hold"}
AGENT_IDS = {"usr_90001", "usr_90002"}
VOLATILE = {"updated_at"}
HARMLESS_GMAIL = {"is_read", "label_ids"}
HIDDEN_LABELS = {"TRASH", "SPAM"}


def canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def subject_key(s) -> str:
    """An email subject: exact, apart from whitespace around it (header parsing drops it)."""
    return str(s if s is not None else "").strip()


def as_text(s) -> str:
    """A sheet cell as text, exactly as written."""
    return str(s if s is not None else "")


def cell(s) -> str:
    """A sheet cell as text, trimmed at both ends (only for reading state back, never for matching a row)."""
    return as_text(s).strip()


def tags_key(tags) -> list[str]:
    """Ticket tags as an exact multiset: order is free, letter case and duplicates are not (the API keeps each tag as
    sent, only trimmed: automationbench/tools/api/impl/zendesk.py zendesk_tickets_update)."""
    return sorted(str(x).strip() for x in (tags or []))


def ws_key(s) -> str:
    return " ".join(str(s or "").split()).lower()


def addr(s) -> str:
    m = re.search(r"<([^<>]+)>\s*$", str(s or ""))
    return (m.group(1) if m else str(s or "")).strip().lower()


def instant(at) -> str:
    """An ISO 8601 UTC time (POLICY.md §9) as the instant it names, to the microsecond. Only the UTC spelling is free:
    Z or +00:00, a space for T, omitted seconds when they are 0, no offset (the column is UTC). Another offset is not
    UTC, and a different instant, even within the same minute, is a different At."""
    s = str(at or "").strip()
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00").replace(" ", "T", 1))
    except ValueError:
        return "unparsed:" + s
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    elif dt.utcoffset() != timedelta(0):
        return "not-utc:" + s
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")


def ref_key(transition: str, ref) -> str:
    """Reference as written. For Purged and Blocked rows it is a comma-separated list (POLICY.md §5, §6), compared as
    a set of ids; any other separator, an empty element or an id with inner whitespace is malformed."""
    r = as_text(ref)
    if transition in SET_REF_EXACT:
        parts = [x.strip() for x in r.split(",")]
        if any(not x or re.search(r"[\s;]", x) for x in parts):
            return "malformed:" + r
        return ",".join(sorted(parts))
    return r


def log_key(cells: dict) -> tuple:
    extra = tuple(sorted(k for k, v in cells.items() if k not in LOG_HEADERS and str(v or "").strip()))
    tr = as_text(cells.get("Transition"))
    return (as_text(cells.get("Request ID")), addr(cells.get("Email")), tr, instant(cells.get("At")),
            ref_key(tr, cells.get("Reference")), extra)


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


def is_live_sent(m: dict) -> bool:
    """Sent and still in the mailbox: a message the automation sent and then moved to Trash or Spam is not a delivered
    policy email (POLICY.md §11: nothing the policy does not ask for)."""
    return is_sent(m) and not HIDDEN_LABELS & set(m.get("label_ids") or [])


def harmless(it: dict) -> bool:
    if it["app"] == "gmail" and it["coll"] == "labels":
        return True
    if it["app"] == "gmail" and it["coll"] == "messages" and it["op"] == "changed":
        added = set(it["after"].get("label_ids") or []) - set(it["before"].get("label_ids") or [])
        return set(it["fields"]) <= HARMLESS_GMAIL and not added & {"TRASH", "SPAM", "SENT"}
    if it["app"] == "zendesk" and it["coll"] in ("tickets", "users") and it["op"] == "changed":
        return set(it["fields"]) <= VOLATILE
    return False


def summarize(it: dict) -> str:
    rec = it.get("after") or it.get("before") or {}
    if it["app"] == "slack" and it.get("coll") == "messages":
        return f"slack.{it['op']} {rec.get('channel_id')}: {str(rec.get('text'))[:80]!r}"
    if it["app"] == "gmail" and it.get("coll") == "messages":
        hidden = sorted(HIDDEN_LABELS & set(rec.get("label_ids") or []))
        return (f"gmail.{it['op']} to={rec.get('to')} {str(rec.get('subject'))[:60]!r} {it.get('fields', '')}"
                + (f" labels={hidden}" if hidden else ""))
    if it["app"] == "google_sheets" and it.get("coll") == "rows":
        return f"sheets.row.{it['op']} {rec.get('worksheet_id')}#{rec.get('row_id')} {canon(rec.get('cells'))[:90]} {it.get('fields', '')}"
    if it["app"] == "zendesk":
        return f"zendesk.{it.get('coll')}.{it['op']} {it['key']} {it.get('fields', '')}"
    return f"{it['app']}.{it.get('coll')}.{it['op']} {it['key']}"


def latest_states(log_rows: list[dict]) -> dict[str, str]:
    out = {}
    for r in log_rows:
        c = r.get("cells") or {}
        rid = cell(c.get("Request ID"))
        if rid:
            out[rid] = ws_key(c.get("Transition"))
    return out


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

        def is_log_row(it):
            return it["app"] == "google_sheets" and it["coll"] == "rows" and \
                sheet_ids(after if it["after"] else before, it["after"] or it["before"]) == (SS, WS_LOG)

        # 1. audit: append-only, exactly one row per transition --------------------------------------------------
        touched = [i for i, it in enumerate(L) if is_log_row(it) and it["op"] in ("changed", "removed")]
        check("audit.append-only", not touched, "; ".join(summarize(L[i]) for i in touched[:4]), group="audit")
        new_log = [i for i, it in enumerate(L) if is_log_row(it) and it["op"] == "new"]
        matched: list[tuple[dict, int]] = []
        for row in exp["log"]:
            k = log_key(row)
            cands = [i for i in new_log if i not in used and log_key(L[i]["after"].get("cells") or {}) == k]
            if cands:
                used.add(cands[0])
                matched.append((row, cands[0]))
            check(f"log {row['Request ID']} {row['Transition']}", bool(cands),
                  f"no new Compliance Log row {k[:5]}; new rows: "
                  + "; ".join(canon(L[i]["after"].get("cells")) for i in new_log if i not in used)[:300], group="audit")
        by_req = defaultdict(list)
        for row, i in matched:
            by_req[row["Request ID"]].append(L[i]["after"].get("row_id"))
        order_ok = all(all(isinstance(x, int) for x in ids) and ids == sorted(ids) for ids in by_req.values())
        if len(matched) > 1:
            check("log.order", order_ok, f"rows of one request appended out of order: {dict(by_req)}", group="audit")

        # 1b. emails -------------------------------------------------------------------------------------------------
        # a new message sent and then trashed or marked spam in the same run is never the expected email; it stays
        # unmatched, so the envelope reports it as well
        new_sent = [i for i, it in enumerate(L) if it["app"] == "gmail" and it["coll"] == "messages" and it["op"] == "new"
                    and is_live_sent(it["after"])]
        for em in exp["emails"]:
            cands = [i for i in new_sent if i not in used and recipients(L[i]["after"]) == [em["to"]]
                     and subject_key(L[i]["after"].get("subject")) == em["subject"]
                     and em["rid"] in f"{L[i]['after'].get('body_plain') or ''}\n{L[i]['after'].get('body_html') or ''}"]
            if cands:
                used.add(cands[0])
            check(f"email {em['subject'][:50]}", bool(cands), f"no new email to {em['to']} {em['subject']!r} naming {em['rid']}")

        # 1c. tickets and users --------------------------------------------------------------------------------------
        for t in exp["tickets"]:
            idx = next((i for i, it in enumerate(L) if it["app"] == "zendesk" and it["coll"] == "tickets"
                        and it["op"] == "changed" and it["key"] == f"id:{t['id']}"), None)
            if idx is None:
                check(f"ticket {t['id']}", False, f"ticket {t['id']} not changed (want {t['subject']!r} + {TAG})")
                continue
            used.add(idx)
            a = L[idx]["after"]
            ok_subj = a.get("subject") == t["subject"]                # POLICY §6.2: the prefix "with one space"
            ok_tags = tags_key(a.get("tags")) == tags_key(t["tags"])  # §6.2: keep the other tags, change nothing else
            other = [f for f in L[idx]["fields"] if f not in ("subject", "tags") and f not in VOLATILE]
            check(f"ticket {t['id']}", ok_subj and ok_tags and not other,
                  f"subject {a.get('subject')!r} (want {t['subject']!r}); tags {a.get('tags')} (want {t['tags']}); other {other}")
        for u in exp["delete_users"]:
            idx = next((i for i, it in enumerate(L) if it["app"] == "zendesk" and it["coll"] == "users"
                        and it["op"] == "removed" and it["key"] == f"id:{u['id']}"), None)
            if idx is not None:
                used.add(idx)
            check(f"delete {u['email']}", idx is not None, f"Zendesk user {u['id']} ({u['email']}) not deleted")

        # 1d. posts ----------------------------------------------------------------------------------------------------
        ops, review = _chan_id(after, PRIVACY_OPS), _chan_id(after, REVIEW)
        new_msgs = [i for i, it in enumerate(L) if it["app"] == "slack" and it["coll"] == "messages" and it["op"] == "new"]
        for text in exp["posts"]:
            cands = [i for i in new_msgs if i not in used and L[i]["after"].get("channel_id") == ops
                     and not L[i]["after"].get("is_deleted") and L[i]["after"].get("text") == text]
            if cands:
                used.add(cands[0])
            check(f"post {text[:40]}", bool(cands), f"no new #{PRIVACY_OPS} message {text!r}")
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
            check("ab", not failed, f"{len(failed)} failed: {[(a['type'], a.get('ticket_id') or a.get('email') or a.get('to') or a.get('cells') or a.get('text_contains')) for a in failed][:4]}",
                  group="ab")

        # 4. end of week ---------------------------------------------------------------------------------------------
        if end is not None:
            checks.extend(self.end_checks(end, after, world0))

        ok_all = all(c["ok"] for c in checks)
        ok_core = all(c["ok"] for c in checks if c["group"] != "envelope")
        real = [it for i, it in enumerate(L) if not harmless(it)]
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
        ones). Zendesk is state (tickets renamed, users deleted) and stays whole."""
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

        # the Compliance Log: world0 rows in place and unchanged, the week's rows as a multiset
        log = sheet_rows(after, WS_LOG)
        if world0 is not None:
            log0 = sheet_rows(world0, WS_LOG)
            by_id = {r.get("id"): r for r in log}
            bad = [f"row {r.get('row_id')}" for r in log0 if r.get("id") not in by_id
                   or canon(by_id[r["id"]].get("cells")) != canon(r.get("cells")) or by_id[r["id"]].get("row_id") != r.get("row_id")]
            check("end.log-history-unchanged", not bad, f"{len(bad)} world0 log rows edited, moved or removed: {bad[:4]}")
            ids0 = {r.get("id") for r in log0}
            got = Counter(log_key(r.get("cells") or {}) for r in log if r.get("id") not in ids0)
        else:
            got = Counter(log_key(r.get("cells") or {}) for r in log)
        want = Counter(log_key(c) for c in end["log_week"]) if world0 is not None else \
            Counter(log_key(c) for c in end["log0"] + end["log_week"])
        check("end.log-week", got == want, f"missing {list((want - got).elements())[:3]}; extra {list((got - want).elements())[:3]}")
        # the statutory deadline, from the arm's own world
        states = latest_states(log)
        fri = date.fromisoformat(end["friday"])
        late = []
        for r in sheet_rows(after, WS_REQ):
            c = r.get("cells") or {}
            rid = cell(c.get("Request ID"))
            try:
                age = (fri - date.fromisoformat(str(c.get("Requested Date")).strip())).days
            except ValueError:
                continue
            if age >= 30 and states.get(rid) not in TERMINAL:
                late.append(f"{rid} ({age} days, {states.get(rid)})")
        check("end.statutory-deadline", not late, f"requests past day 30 without a terminal state: {late[:4]}")
        # Zendesk
        users = sorted(u["id"] for u in after.get("zendesk", {}).get("users", []) if u["id"] not in AGENT_IDS)
        check("end.users", users == end["users"], f"missing {sorted(set(end['users']) - set(users))[:4]}; "
                                                  f"extra {sorted(set(users) - set(end['users']))[:4]}")
        tickets = {t["id"]: t for t in after.get("zendesk", {}).get("tickets", [])}
        badt = []
        for tid, want_t in end["tickets"].items():
            t = tickets.get(tid)
            if t is None or t.get("subject") != want_t["subject"] or tags_key(t.get("tags")) != tags_key(want_t["tags"]):
                badt.append(tid)
        badt += sorted(set(tickets) - set(end["tickets"]))
        check("end.tickets", not badt, f"{len(badt)} tickets differ: {badt[:5]}")
        # static sheets: read, never edited
        for ws, key in ((WS_REQ, "requests_rows"), (WS_HOLD, "holds"), (WS_CFG, "config")):
            got_rows = [{k: str(v) for k, v in (r.get("cells") or {}).items() if str(v or "") != ""} for r in sheet_rows(after, ws)]
            want_rows = [{k: str(v) for k, v in c.items() if str(v or "") != ""} for c in end[key]]
            check(f"end.{ws}-unedited", canon(got_rows) == canon(want_rows), f"the {ws} worksheet was edited")
        if world0 is not None:
            ids0 = {m["id"] for m in world0["gmail"]["messages"]}
            got_m = Counter((tuple(recipients(m)), subject_key(m.get("subject"))) for m in after["gmail"]["messages"]
                            if m["id"] not in ids0 and is_live_sent(m))
            # inbound messages of the week arrive by delta; they are not SENT. A sent email later trashed is missing.
            want_m = Counter(((to,), s) for to, s in end["emails"])
            check("end.emails", got_m == want_m, f"missing {list((want_m - got_m).elements())[:3]}; extra {list((got_m - want_m).elements())[:3]}")
            keys0 = {_key("slack", "messages", m) for m in world0["slack"]["messages"]}
            ops = _chan_id(after, PRIVACY_OPS)
            got_p = Counter(m.get("text") for m in after["slack"]["messages"]
                            if _key("slack", "messages", m) not in keys0 and m.get("channel_id") == ops and not m.get("is_deleted"))
            want_p = Counter(end["posts"])
            check("end.posts", got_p == want_p, f"missing {list((want_p - got_p).elements())[:3]}; extra {list((got_p - want_p).elements())[:3]}")
            touched = [summarize(it) for it in ledger(world0, after)
                       if it["op"] in ("changed", "removed") and it["app"] in ("slack", "gmail") and not harmless(it)]
            check("end.preexisting-unchanged", not touched, "; ".join(touched[:6]))
        if self.use_ab and end["assertions"]:
            w = self.WorldState(**copy.deepcopy(after))
            failed = [a for a in end["assertions"] if not self.Registry.check(w, a)]
            check("end.ab", not failed, f"{len(failed)} failed: {[(a['type'], a.get('ticket_id') or a.get('email') or a.get('user_id') or a.get('text')) for a in failed][:4]}")
        return out
