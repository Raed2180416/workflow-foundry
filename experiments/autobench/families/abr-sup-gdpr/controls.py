"""abr-sup-gdpr bad controls (code, no model). Each must FAIL the family; together they show the oracle rejects a
do-nothing run, an echo, and plausible-but-wrong runs, and that every policy rule they break is load-bearing.

  null             does nothing at all
  echo             repeats every trigger's data back into #privacy-ops
  naive            the <= 40-line "ignore every note and rule" heuristic (RECURRING-DESIGN §3.11 gate 4): every request
                   gets a verification email, every email quoting an id purges that request's user (no sender, state or
                   hold check), the summary counts today's Purged rows and uses the first Batch setting, holds and
                   deadlines are ignored
  one-defect variants of the observable-only reference (plausible but wrong; each breaks exactly one rule):
    any-sender       accepts a reply quoting the Request ID from any address (spoofed and forwarded verifications)
    display-first    reads the sender as the first address-like text of the From header (display-name spoof)
    fuzzy-address    compares addresses by local part only (look-alike domains, holds on similar addresses)
    case-sensitive   compares addresses with letter case (a capitalized request or reply address)
    no-hold          ignores the Legal Hold sheet (purges held users)
    any-hold-row     counts Lifted hold rows as holds
    no-lift          never purges when a hold is lifted
    text-search      finds the user's tickets by free-text search for the address (tickets that mention a CC'd user)
    org-purge        purges every ticket of the user's organization
    name-match       purges every user with the requester's name (same-name users)
    replace-tags     sets the tags to ['gdpr-purged'] instead of adding it
    edit-log         records a transition by editing the request's latest Compliance Log row (breaks append-only)
    skip-verified    does not log the Verified transition (only the outcome)
    no-dedupe        handles a duplicate request as a new one (a second verification)
    dedupe-any       treats any earlier request for the address as open (re-requests after Not Found / Closed)
    exact-deadline   closes only at exactly day 30 (misses a request already past day 30 at its first close)
    late-deadline    closes from day 31
    close-held       at the daily close also closes requests Blocked - Legal Hold at day 30 or later, as if the deadline
                     applied to every request that is not purged (a held request is verified and answered)
    count-all        the summary counts every Purged / Blocked row in the log, not today's
    stale-batch      takes the first setting whose name contains 'Batch' (the previous batch at d3)
    snippet-only     looks for the Request ID in the payload subject and snippet only (never reads the message)
    at-date          writes At as the date only
"""
from __future__ import annotations

import json
import re

from reference import (BLOCKED, CLOSED, GMAIL, PURGED, REQUEST_ID, SHEETS, SLACK, SS, TAG, VERIFIED, WS_CFG, WS_LOG,
                       ZENDESK, Gdpr, address, norm, utc_date)


def null(trigger, ctx):
    return None


def echo(trigger, ctx):
    text = json.dumps(trigger.get("data") or {}, sort_keys=True, ensure_ascii=False)
    ctx.fetch("POST", SLACK + "chat.postMessage", None, {"channel": "privacy-ops", "text": text})


def naive(trigger, ctx):  # <= 40 lines: the shortcut a careless automation takes
    g, d = Gdpr(trigger, ctx), trigger.get("data") or {}
    if trigger.get("event") == "day_close":
        n = sum(1 for c in g.log() if c.get("Transition") == PURGED and str(c.get("At", "")).startswith(d["date"]))
        batch = next(c["Value"] for _, c in g.sheet(WS_CFG) if "Batch" in c.get("Setting", ""))
        return g.post(f"{d['date']}: {n} purged, 0 blocked, batch {batch}")
    if trigger.get("event") == "new_row" and norm(d.get("worksheet")) == "erasure requests":
        rid, email = d["row"]["Request ID"], d["row"]["Email"]
        g.send(email, f"Verify your erasure request {rid}", rid, f"Please confirm {rid}.")
        return g.append_log(rid, email, "Verification Sent")
    if trigger.get("event") != "new_email":
        return None
    ids = REQUEST_ID.findall(f"{d.get('subject')} {d.get('snippet')}")
    reqs = {c["Request ID"]: c for _, c in g.requests()}
    if not ids or ids[0] not in reqs:
        return None
    rid, email = ids[0], reqs[ids[0]]["Email"]
    g.append_log(rid, email, VERIFIED, d["message_id"])
    users = [u for u in ctx.fetch_json("GET", ZENDESK + "users")["users"] if address(u.get("email")) == address(email)]
    if not users:
        return None
    for t in ctx.fetch_json("GET", ZENDESK + "tickets")["tickets"]:
        if t.get("requester_id") == users[0]["id"]:
            g.anonymize(t)
    ctx.fetch("DELETE", ZENDESK + f"users/{users[0]['id']}")
    g.append_log(rid, email, PURGED, "")


NAIVE_LINES = 25


class AnySender(Gdpr):
    def on_email(self, message_id):
        m = self.call("GET", GMAIL + f"messages/{message_id}")
        reqs = {c["Request ID"].strip(): c for _, c in self.requests()}
        log = self.log()
        hits = [x for x in dict.fromkeys(REQUEST_ID.findall(self.quoted_text(m))) if x in reqs and self.state(x, log) == "Verification Sent"]
        if hits:
            self.verified(hits[0], reqs[hits[0]]["Email"], m.get("id") or message_id)


class DisplayFirst(Gdpr):
    def from_address(self, m):
        hit = re.search(r"[\w.+-]+@[\w.-]+", str(m.get("from") or ""))
        return address(hit.group(0)) if hit else ""


class FuzzyAddress(Gdpr):
    def same(self, a, b):
        def local(x):
            return address(x).split("@")[0].split("+")[0].replace(".", "")
        return local(a) == local(b)


class CaseSensitive(Gdpr):
    def same(self, a, b):
        return str(a or "").strip() == str(b or "").strip()

    def from_address(self, m):
        hit = re.search(r"<([^<>]+)>\s*$", str(m.get("from") or ""))
        return (hit.group(1) if hit else str(m.get("from") or "")).strip()


class NoHold(Gdpr):
    def active_holds(self, email):
        return []


class AnyHoldRow(Gdpr):
    def active_holds(self, email):
        return [c for _, c in self.sheet("ws_legal_hold") if self.same(c.get("Email"), email)]


class NoLift(Gdpr):
    def on_hold_update(self, row_no):
        return None


class TextSearch(Gdpr):
    """Finds the user's tickets by searching for the address (Zendesk free-text search covers subject and description)."""
    def requester_tickets(self, u):
        found = self.call("GET", ZENDESK + "search", {"query": address(u.get("email"))}).get("tickets", [])
        own = [t for t in self.call("GET", ZENDESK + "tickets").get("tickets", []) if t.get("requester_id") == u["id"]]
        return own + [t for t in found if t["id"] not in {x["id"] for x in own}]


class OrgPurge(Gdpr):
    def requester_tickets(self, u):
        return [t for t in self.call("GET", ZENDESK + "tickets").get("tickets", [])
                if t.get("requester_id") == u["id"] or (u.get("organization_id") and t.get("organization_id") == u["organization_id"])]


class NameMatch(Gdpr):
    def purge(self, email):
        users = self.users_with(email)
        if len(users) != 1:
            raise LookupError("no unique user")
        everyone = self.call("GET", ZENDESK + "users").get("users", [])
        ids = []
        for u in [x for x in everyone if norm(x.get("name")) == norm(users[0].get("name"))]:
            for t in self.requester_tickets(u):
                self.anonymize(t)
                ids.append(t["id"])
            self.call("DELETE", ZENDESK + f"users/{u['id']}")
        return ids


class ReplaceTags(Gdpr):
    def anonymize(self, t):
        self.call("PUT", ZENDESK + f"tickets/{t['id']}", None, {"ticket": {"subject": "[GDPR Purged] " + t["subject"], "tags": [TAG]}})


class EditLog(Gdpr):
    def append_log(self, rid, email, transition, reference=""):
        rows = [(n, c) for n, c in self.sheet(WS_LOG) if c.get("Request ID", "").strip() == rid]
        if not rows:
            return super().append_log(rid, email, transition, reference)
        self.call("PUT", f"{SHEETS}{SS}/values/{WS_LOG}/rows/{rows[-1][0]}", None,
                  {"cells": {"Transition": transition, "At": self.at, "Reference": reference}})


class SkipVerified(Gdpr):
    def append_log(self, rid, email, transition, reference=""):
        if transition != VERIFIED:
            return super().append_log(rid, email, transition, reference)


class NoDedupe(Gdpr):
    def duplicate_of(self, rid, email, rows, log):
        return None


class DedupeAny(Gdpr):
    def duplicate_of(self, rid, email, rows, log):
        hits = [c["Request ID"].strip() for _, c in rows if c["Request ID"].strip() != rid and self.same(c["Email"], email)
                and self.state(c["Request ID"].strip(), log) is not None]
        return hits[-1] if hits else None


class ExactDeadline(Gdpr):
    def overdue(self, req, day):
        from datetime import date
        return (date.fromisoformat(day) - date.fromisoformat(req["Requested Date"].strip())).days == 30


class LateDeadline(Gdpr):
    def overdue(self, req, day):
        from datetime import date
        return (date.fromisoformat(day) - date.fromisoformat(req["Requested Date"].strip())).days > 30


class CloseHeld(Gdpr):
    def day_close(self, day):
        log = self.log()
        for _, c in self.requests():
            rid = c["Request ID"].strip()
            if self.state(rid, log) == BLOCKED and self.overdue(c, day):
                self.append_log(rid, c["Email"], CLOSED)
                self.send(c["Email"], f"Erasure request {rid}: closed unverified", rid,
                          "We did not receive a confirmation within 30 days, so this request is closed.")
        return super().day_close(day)


class CountAll(Gdpr):
    def count(self, log, transition, day):
        return sum(1 for c in log if c.get("Transition", "").strip() == transition)


class StaleBatch(Gdpr):
    def batch(self):
        return next(c["Value"].strip() for _, c in self.sheet(WS_CFG) if "batch" in c.get("Setting", "").lower())


class SnippetOnly(Gdpr):
    def quoted_text(self, m):
        d = self.t.get("data") or {}
        return f"{d.get('subject') or ''}\n{d.get('snippet') or ''}"


class AtDate(Gdpr):
    def __init__(self, trigger, ctx):
        super().__init__(trigger, ctx)
        self.at = utc_date(self.at)


def variant(cls):
    def run(trigger, ctx):
        try:
            return cls(trigger, ctx).run()
        except LookupError as e:
            ctx.fetch("POST", SLACK + "chat.postMessage", None,
                      {"channel": "automation-review", "text": f"{trigger.get('trigger')}: {e}"})
    run.__name__ = cls.__name__
    return run


CONTROLS = {"null": null, "echo": echo, "naive": naive,
            "any-sender": variant(AnySender), "display-first": variant(DisplayFirst),
            "fuzzy-address": variant(FuzzyAddress), "case-sensitive": variant(CaseSensitive),
            "no-hold": variant(NoHold), "any-hold-row": variant(AnyHoldRow), "no-lift": variant(NoLift),
            "text-search": variant(TextSearch), "org-purge": variant(OrgPurge), "name-match": variant(NameMatch),
            "replace-tags": variant(ReplaceTags), "edit-log": variant(EditLog), "skip-verified": variant(SkipVerified),
            "no-dedupe": variant(NoDedupe), "dedupe-any": variant(DedupeAny), "exact-deadline": variant(ExactDeadline),
            "late-deadline": variant(LateDeadline), "close-held": variant(CloseHeld), "count-all": variant(CountAll), "stale-batch": variant(StaleBatch),
            "snippet-only": variant(SnippetOnly), "at-date": variant(AtDate)}
