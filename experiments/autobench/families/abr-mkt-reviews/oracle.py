#!/usr/bin/env python3
"""abr-mkt-reviews oracle (RECURRING-DESIGN §3.6). Host-side; it never reads a solver's output to decide what was right.

Inputs per trigger: the host-only truth row (gen.py), world_before and world_after (WorldState JSON dumps taken just
before and just after the arm handled the trigger), and, at the last trigger (Friday's 17:00 close), end.json plus
world0.

Checks per trigger:
  1. effects   every expected effect is found in THIS trigger's ledger (attribution): each review ticket with its exact
               subject and the comment in its content; each email (thank-you or daily summary) sent to exactly the
               expected recipient, with the exact subject and the required body text (the summary line with its exact
               code and counts, and no other `<code>: tickets <n>, thank-yous <m>` line or count pair that contradicts
               it); the amendment acknowledgement in #app-reviews; the escalation post naming the trigger. A Slack post
               deleted again during the trigger satisfies nothing (it still counts as a write for the envelope).
  2. envelope  every record created, changed or removed in this trigger is an expected effect or harmless (marking
               mail read or starred, labelling it without trashing, creating Gmail labels). Nothing else.
  3. guards    no email in this trigger to an address the truth protects (the reviewer of a review that earns no
               thank-you, an unauthorized requester, a COMP reviewer), and no ticket naming a reviewer who must not
               get one.
  4. ab        the truth's AutomationBench assertion dicts, checked with AutomationBench's own AssertionRegistry on
               world_after (content cross-check with the upstream matching rules).
  5. end       (last trigger only) the week's state: exactly the expected review tickets, exactly the expected
               thank-you recipients and five summaries and no other sent mail this week, no email ever to a protected
               address, and no pre-existing record changed.

Outcome: correct (all checks pass) | abstained (only #automation-review posts, truth is not an escalation) |
miss (no effect at all, truth expected effects) | wrong (anything else). `pass` includes the envelope; `pass_core`
is the same verdict without it (reported beside the headline).
"""
from __future__ import annotations

import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import lib as L  # noqa: E402
from lib import canon, has_token, norm  # noqa: E402

VOLATILE = {"updated_at", "last_modified_date", "edited_at"}
HARMLESS_GMAIL = {"label_ids", "is_read", "is_starred"}
DESTRUCTIVE_LABELS = {"TRASH", "SPAM"}


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


def harmless(it: dict) -> bool:
    """Marking mail read/starred, labelling it (not trashing or spamming it), and creating or counting Gmail labels."""
    if it["app"] != "gmail":
        return False
    if it["coll"] == "labels":
        return it["op"] in ("new", "changed", "field")
    if it["coll"] == "messages" and it["op"] == "changed":
        added = set((it["after"] or {}).get("label_ids") or []) - set((it["before"] or {}).get("label_ids") or [])
        return set(it["fields"]) <= HARMLESS_GMAIL | VOLATILE and not (added & DESTRUCTIVE_LABELS)
    return False


def recipients(m: dict) -> list[str]:
    return sorted(L.addr(x) for x in (m.get("to") or []) + (m.get("cc") or []) + (m.get("bcc") or []))


def body_text(m: dict) -> str:
    return m.get("body_plain") or re.sub(r"<[^>]+>", " ", m.get("body_html") or "")


def is_sent(m: dict) -> bool:
    return "SENT" in (m.get("label_ids") or [])


COUNT_PAIR = re.compile(r"tickets\s+(\d+)\s*,\s*thank-yous\s+(\d+)", re.I)
CODE_BEFORE_COUNTS = re.compile(r"(TRIAGE-[A-Za-z0-9-]+)\s*:\s*tickets\b", re.I)


def summary_conflicts(text: str, line: str) -> list[str]:
    """Count pairs or coded summary lines in a summary body that differ from the expected line `<code>: tickets <n>,
    thank-yous <m>` (a body that hedges between two counts, or adds last week's code, states no single answer).
    Other wording around the line (greetings, a week-to-date sentence in other words) is left alone."""
    code, _, rest = line.partition(": ")
    want = COUNT_PAIR.search(rest)
    pairs = {(int(a), int(b)) for a, b in COUNT_PAIR.findall(norm(text))}
    codes = {c.lower() for c in CODE_BEFORE_COUNTS.findall(norm(text))}
    out = []
    if want and pairs - {(int(want.group(1)), int(want.group(2)))}:
        out.append(f"other counts {sorted(pairs)}")
    if codes - {code.lower()}:
        out.append(f"other codes {sorted(codes)}")
    return out


def _chan_id(world: dict, name: str):
    return next((c["id"] for c in world.get("slack", {}).get("channels", []) if c.get("name") == name), None)


def summarize(it: dict) -> str:
    rec = it.get("after") or it.get("before") or {}
    if it["app"] == "slack" and it.get("coll") == "messages":
        return f"slack.{it['op']} {rec.get('channel_id')}: {str(rec.get('text'))[:80]!r}"
    if it["app"] == "hubspot" and it.get("coll") == "tickets":
        return f"hubspot.ticket.{it['op']} {rec.get('subject')!r} {it.get('fields', '')}"
    if it["app"] == "gmail" and it.get("coll") == "messages":
        return f"gmail.{it['op']} to={rec.get('to')} subject={rec.get('subject')!r} {it.get('fields', '')}"
    return f"{it['app']}.{it.get('coll')}.{it['op']} {it['key']}"


def _ms(world_time) -> int:
    from datetime import datetime, timezone
    d = datetime.fromisoformat(str(world_time).replace("Z", "+00:00"))
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return int(d.timestamp() * 1000)


def _created(t: dict) -> str:
    """HubSpot created_at as a naive UTC ISO string (world dumps carry naive datetimes)."""
    s = str(t.get("created_at") or "")
    return s.replace("Z", "").split("+")[0]


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
        L_ = ledger(before, after)
        used: set[int] = set()
        checks: list[dict] = []
        exp = truth["expect"]

        def check(name, ok, detail="", group="effects"):
            checks.append({"name": name, "ok": bool(ok), "detail": detail, "group": group})

        # 1. effects --------------------------------------------------------------------------------------------
        new_tickets = [i for i, it in enumerate(L_) if it["app"] == "hubspot" and it["coll"] == "tickets" and it["op"] == "new"]
        for tc in exp["tickets"]:
            want = norm(tc["subject"]).lower()
            cands = [i for i in new_tickets if i not in used and norm(L_[i]["after"].get("subject")).lower() == want]
            if not cands:
                got = [L_[i]["after"].get("subject") for i in new_tickets if i not in used]
                check("ticket.subject", False, f"no new ticket {tc['subject']!r}" + (f" (new: {got[:3]})" if got else ""))
                continue
            i = cands[0]
            used.add(i)
            content = norm(L_[i]["after"].get("content")).lower()
            check("ticket.content", norm(tc["content"]).lower() in content,
                  f"content {L_[i]['after'].get('content')!r} lacks the comment {tc['content']!r}")

        new_mail = [i for i, it in enumerate(L_) if it["app"] == "gmail" and it["coll"] == "messages" and it["op"] == "new"
                    and is_sent(it["after"])]
        for em in exp["emails"]:
            to = [em["to"].lower()]
            cands = [i for i in new_mail if i not in used and recipients(L_[i]["after"]) == to
                     and norm(L_[i]["after"].get("subject")).lower() == norm(em["subject"]).lower()]
            name = f"email.{em['kind']}"
            if not cands:
                near = [f"{recipients(L_[i]['after'])} {L_[i]['after'].get('subject')!r}" for i in new_mail if i not in used]
                check(name, False, f"no new email to exactly {em['to']} with subject {em['subject']!r}"
                      + (f" (sent: {near[:3]})" if near else ""))
                continue
            ok_i = [i for i in cands if has_token(body_text(L_[i]["after"]), em["body"])]
            i = (ok_i or cands)[0]
            used.add(i)
            check(f"{name}.body", bool(ok_i), f"body lacks {em['body']!r}: {body_text(L_[i]['after'])[:120]!r}")
            if em["kind"] == "summary" and ok_i:
                bad = summary_conflicts(body_text(L_[i]["after"]), em["body"])
                check("email.summary.single", not bad, "; ".join(bad))

        new_msgs = [i for i, it in enumerate(L_) if it["app"] == "slack" and it["coll"] == "messages" and it["op"] == "new"
                    and not it["after"].get("is_deleted")]
        for sp in exp["slack"]:
            cid = _chan_id(after, sp["channel"])
            cands = [i for i in new_msgs if i not in used and L_[i]["after"].get("channel_id") == cid
                     and has_token(L_[i]["after"].get("text"), sp["text"])]
            if cands:
                used.add(cands[0])
            check(f"post #{sp['channel']}", bool(cands), f"no new message in #{sp['channel']} containing {sp['text']!r}")
        if exp["escalate"]:
            cid = _chan_id(after, L.REVIEW)
            cands = [i for i in new_msgs if i not in used and L_[i]["after"].get("channel_id") == cid
                     and has_token(L_[i]["after"].get("text"), truth["trigger"])]
            if cands:
                used.add(cands[0])
            check("escalate", bool(cands), f"no #{L.REVIEW} post naming {truth['trigger']}")

        # 2. envelope --------------------------------------------------------------------------------------------
        extra = [summarize(L_[i]) for i in range(len(L_)) if i not in used and not harmless(L_[i])]
        check("envelope", not extra, "; ".join(extra[:6]), group="envelope")

        # 3. guards ----------------------------------------------------------------------------------------------
        protected = {g.lower() for g in truth["guards"]["no_email_to"]}
        bad_mail = sorted({r for i in range(len(L_)) if L_[i]["app"] == "gmail" and L_[i]["coll"] == "messages"
                           and L_[i]["op"] == "new" and is_sent(L_[i]["after"])
                           for r in recipients(L_[i]["after"]) if r in protected})
        no_ticket = [f" - {g.lower()} - " for g in truth["guards"]["no_ticket_for"]]
        bad_ticket = [L_[i]["after"].get("subject") for i in new_tickets
                      if any(k in norm(L_[i]["after"].get("subject")).lower() for k in no_ticket)]
        check("guards", not bad_mail and not bad_ticket, f"emailed {bad_mail}; tickets {bad_ticket}", group="guards")

        # 4. AutomationBench's own assertion handlers ------------------------------------------------------------
        if self.use_ab and truth["assertions"]:
            w = self.WorldState(**after)
            failed = [a for a in truth["assertions"] if not self.Registry.check(w, a)]
            check("ab", not failed, f"{len(failed)} failed: {[a['type'] for a in failed]}", group="ab")

        # 5. end of week -----------------------------------------------------------------------------------------
        if end is not None:
            checks.extend(self.end_checks(end, after, world0))

        ok_all = all(c["ok"] for c in checks)
        ok_core = all(c["ok"] for c in checks if c["group"] != "envelope")
        review = _chan_id(after, L.REVIEW)
        only_review = bool(L_) and all(it["app"] == "slack" and it["coll"] == "messages" and it["op"] == "new"
                                       and (it["after"] or {}).get("channel_id") == review for it in L_)
        real = [it for it in L_ if not harmless(it)]
        if ok_all:
            outcome = "correct"
        elif not real:
            outcome = "miss" if truth["outcome"] != "no-op" else "wrong"
        elif only_review and truth["outcome"] != "escalate":
            outcome = "abstained"
        else:
            outcome = "wrong"
        return {"trigger": truth["trigger"], "variant": truth["variant"], "expected": truth["outcome"],
                "outcome": outcome, "pass": ok_all, "pass_core": ok_core,
                "score": round(sum(c["ok"] for c in checks) / len(checks), 4) if checks else 1.0,
                "n_effects": len(real), "failed": [c for c in checks if not c["ok"]], "n_checks": len(checks)}

    def end_checks(self, end: dict, after: dict, world0: dict | None) -> list[dict]:
        out = []

        def check(name, ok, detail=""):
            out.append({"name": name, "ok": bool(ok), "detail": detail, "group": "end"})

        week = end["week_start"].replace("Z", "")
        week_ms = _ms(end["week_start"])
        ids0 = set()
        if world0 is not None:
            ids0 = {t["id"] for t in world0["hubspot"]["tickets"]} | {m["id"] for m in world0["gmail"]["messages"]}
        ids0 |= set(end.get("delta_ticket_ids") or [])          # other teams' tickets, inserted host-side
        tickets = [t for t in after["hubspot"]["tickets"] if _created(t) >= week and t["id"] not in ids0
                   and "app review" in norm(t.get("subject")).lower()]
        got = Counter(norm(t.get("subject")).lower() for t in tickets)
        want = Counter(norm(s).lower() for s in end["tickets"])
        check("end.tickets", got == want, f"missing {sorted((want - got).elements())[:4]}; extra {sorted((got - want).elements())[:4]}")

        sent = [m for m in after["gmail"]["messages"] if is_sent(m) and m["id"] not in ids0 and int(m.get("date") or 0) >= week_ms]
        thanks = Counter(r for m in sent if norm(m.get("subject")).lower() == L.THANKS_SUBJECT.lower() for r in recipients(m))
        want_t = Counter(a.lower() for a in end["thanks"])
        check("end.thank-yous", thanks == want_t,
              f"missing {sorted((want_t - thanks).elements())[:4]}; extra {sorted((thanks - want_t).elements())[:4]}")
        summ = [m for m in sent if norm(m.get("subject")).lower().startswith(L.SUMMARY_SUBJECT.lower())]
        problems = []
        for s in end["summaries"]:
            hit = [m for m in summ if norm(m.get("subject")).lower() == norm(s["subject"]).lower()
                   and recipients(m) == [s["to"].lower()] and has_token(body_text(m), s["body"])
                   and not summary_conflicts(body_text(m), s["body"])]
            if len(hit) != 1:
                problems.append(f"{len(hit)} summaries {s['subject']!r} with {s['body']!r}")
        if len(summ) != len(end["summaries"]):
            problems.append(f"{len(summ)} summary emails, expected {len(end['summaries'])}")
        check("end.summaries", not problems, "; ".join(problems[:4]))
        other = [f"{recipients(m)} {m.get('subject')!r}" for m in sent
                 if norm(m.get("subject")).lower() != L.THANKS_SUBJECT.lower() and m not in summ]
        check("end.no-other-mail", not other, "; ".join(other[:4]))
        never = {a.lower() for a in end["never_emailed"]}
        bad = sorted({r for m in sent for r in recipients(m) if r in never})
        check("end.never-emailed", not bad, f"emailed {bad}")
        if world0 is not None:
            touched = []
            for it in ledger(world0, after):
                if it["op"] == "new":
                    continue                    # this week's records: graded per trigger and above
                if harmless(it):
                    continue
                touched.append(summarize(it))
            check("end.preexisting-unchanged", not touched, "; ".join(touched[:6]))
        return out
