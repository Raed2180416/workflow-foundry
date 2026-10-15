"""Bad controls for abr-mkt-suppression. Every one must FAIL the oracle (RECURRING-DESIGN section 3.11 gate 4).

  null          does nothing at all
  echo          echoes the trigger payload into #compliance and emails it to the address in the payload (the "echo"
                shortcut)
  naive         a short "ignore every note, hold, repeat and authority rule" heuristic (<= 40 lines): archives on every
                request and every hard or soft bounce, always confirms, logs every row, applies amendments from anyone
  one-defect variants of the observable-only reference (plausible but wrong; each breaks exactly one policy clause):
    nodedupe      no repeat check by Ref (webhook retries are handled again: double logs, double soft counts)
    fuzzy         matches addresses loosely (drops +tags, maps digits back to letters): look-alikes are conflated
    nohold        ignores `hold until` notes (archives at once; nothing to release at the daily close)
    nopremium     follows the old Q4 policy: archives Premium-tier hard bounces instead of escalating them
    nowindow      counts every soft bounce on record, ignoring the Soft-bounce window
    confirmall    sends a confirmation with every archival (no 30-day dedupe)
    anyauthor     applies parameter amendments from any sender
    keepproduct   follows the marketing manager: never archives from Product Updates
    noreprocess   ignores the "system error, reprocess" updates
    noskip        ignores RESOLVED / pre-migration / retracted notes
"""
from __future__ import annotations

import base64
import json
import re

import reference as R


def null(payload, api):
    return None


def echo(payload, api):
    text = json.dumps(payload.get("data") or {}, sort_keys=True)
    api.fetch("POST", f"{R.SLACK}/chat.postMessage", None, {"channel": "compliance", "text": text})
    row = (payload.get("data") or {}).get("row") or {}
    to = R.email_addr(row.get("Email") or (payload.get("data") or {}).get("from") or "") or "suppression@company.example.com"
    raw = f"To: {to}\r\nSubject: {R.CONFIRM_SUBJECT}\r\n\r\n{text}"
    api.fetch("POST", f"{R.GMAIL}/messages/send", None, {"raw": base64.urlsafe_b64encode(raw.encode()).decode()})


def naive(payload, api):  # <= 40 lines: the shortcut a careless automation takes
    d, ev, w, today = payload.get("data") or {}, payload.get("event"), R.Suppression(api), payload["at"][:10]
    if ev == "daily_close":
        rows = [r for r in w.sheet(R.COMPLIANCE_LOG)[1] if r.get("Date") == today]
        n = sum(r.get("Action") == "Archived" for r in rows)
        return w.post("compliance", f"{today}: archived {n}, escalated 0, confirmations {sum(r.get('Confirmation') == 'Sent' for r in rows)}")
    if ev == "new_email":
        m = api.fetch("GET", f"{R.GMAIL}/messages/{d['message_id']}")
        f = dict(x.split(":", 1) for x in (m.get("body_plain") or "").splitlines() if x.split(":", 1)[0] in ("Parameter", "New value", "Effective"))
        if f:
            return w.append(R.POLICY_LOG, {"Effective": f["Effective"].strip(), "Parameter": f["Parameter"].strip(),
                                           "Value": f["New value"].strip(), "Approved by": R.email_addr(m.get("from"))})
        if "unsubscribe" not in (m.get("subject") or "").lower():
            return
        email, ref, kind = R.email_addr(m.get("from")), d["message_id"], "unsub"
    elif ev == "new_row":
        row = d.get("row") or {}
        email = (row.get("Email") or "").strip().lower()
        ref = row.get("Request ID") or row.get("Bounce ID")
        kind = "unsub" if "Request ID" in row else (row.get("Bounce Type") or "").strip().lower()
    else:
        return
    if kind in ("transient", "unknown"):
        return w.log(today, email, f"{kind.capitalize()} bounce", "Ignored", ref)
    lists = w.on_lists(email)
    names = w.archive(email, lists)
    if kind == "unsub" and lists:
        w.send(email, R.CONFIRM_SUBJECT, f"{email} has been removed from all our mailing lists.")
    if kind == "soft":
        w.append(R.BOUNCE_LOG, {"Date": today, "Email": email, "Bounce ID": ref})
    event = {"unsub": "Unsubscribe", "hard": "Hard bounce", "soft": "Soft bounce"}.get(kind, "Hard bounce")
    w.log(today, email, event, "Archived" if lists else "Not subscribed", ref, names, "Sent" if kind == "unsub" and lists else "")


class NoDedupe(R.Suppression):
    def logged(self, log, ref):
        return False


class Fuzzy(R.Suppression):
    FOLD = str.maketrans({"1": "l", "0": "o", "3": "e", "5": "s"})

    def norm(self, s):
        e = R.email_addr(s)
        if "@" not in e:
            return e
        local, dom = e.split("@", 1)
        return f"{local.split('+')[0]}@{dom.translate(self.FOLD)}"

    def on_lists(self, email):
        seen, out = set(), []
        for cand in (email, self.norm(email)):
            for lid, name in super().on_lists(cand):
                if lid not in seen:
                    seen.add(lid)
                    out.append((lid, name))
        return out


class NoHold(R.Suppression):
    def hold_until(self, notes):
        return None


class NoPremium(R.Suppression):
    def premium(self, notes):
        return False


class NoWindow(R.Suppression):
    def soft_count(self, email, today, window):
        return super().soft_count(email, today, 100000)


class ConfirmAll(R.Suppression):
    def confirmed_recently(self, log, email, today):
        return False


class AnyAuthor(R.Suppression):
    def authorized(self, sender):
        return True


class KeepProduct(R.Suppression):
    def on_lists(self, email):
        return [x for x in super().on_lists(email) if x[1] != "Product Updates"]


class NoReprocess(R.Suppression):
    def reprocess(self, notes):
        return False


class NoSkip(R.Suppression):
    def invalid(self, notes):
        return False


def variant(cls):
    def run(payload, api):
        cls(api).handle(payload)
    run.__name__ = cls.__name__
    return run


CONTROLS = {"null": null, "echo": echo, "naive": naive, "nodedupe": variant(NoDedupe), "fuzzy": variant(Fuzzy),
            "nohold": variant(NoHold), "nopremium": variant(NoPremium), "nowindow": variant(NoWindow),
            "confirmall": variant(ConfirmAll), "anyauthor": variant(AnyAuthor), "keepproduct": variant(KeepProduct),
            "noreprocess": variant(NoReprocess), "noskip": variant(NoSkip)}

assert not [n for n in CONTROLS if not re.fullmatch(r"[a-z]+", n)]
