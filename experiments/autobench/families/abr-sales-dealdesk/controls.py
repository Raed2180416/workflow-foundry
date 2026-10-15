"""Bad controls for abr-sales-dealdesk. Every one must FAIL the oracle (RECURRING-DESIGN section 3.11 gate 4).

  null        does nothing at all
  echo        echoes the trigger payload into #deal-wins and to the default mailbox (the "echo" shortcut)
  naive       a short "ignore every note and authority rule" heuristic: Salesforce tier, newest FX row, default
              mailboxes, any open case, no dedupe, amendments from anyone, the whole log at week close
  one-defect variants of the observable-only reference (plausible but wrong; each breaks exactly one policy clause):
    nodedupe    no repeat check (retries and the integration's own stage change are announced again)
    asof        ignores "on or before the close date" for Account Hierarchy and FX rows (future-dated rows leak in)
    noparent    escalation looks at the account's own cases only, never the parent's
    anyauthor   applies amendments from any sender
    sftier      uses the Salesforce account tier instead of the Account Hierarchy sheet
    nocomma     writes amounts as $156000 instead of $156,000
    noretract   ignores reopened deals
"""
from __future__ import annotations

import base64
import json
from decimal import Decimal

import reference as R


def null(payload, api):
    return None


def echo(payload, api):
    text = json.dumps(payload.get("data") or {}, sort_keys=True)
    api.fetch("POST", f"{R.SLACK}/chat.postMessage", None, {"channel": "deal-wins", "text": text})
    raw = f"To: sales-team@company.example.com\r\nSubject: {R.SUBJECT}\r\n\r\n{text}"
    api.fetch("POST", f"{R.GMAIL}/messages/send", None, {"raw": base64.urlsafe_b64encode(raw.encode()).decode()})


def naive(payload, api):  # <= 40 lines: the shortcut a careless automation takes
    d, ev, w = payload.get("data") or {}, payload.get("event"), R.DealDesk(api)
    if ev == "week_close":
        _, log = w.sheet(R.DEAL_LOG)
        rows = [r for r in log if r.get("Status") == "Announced"]
        return w.post("deal-wins", f"Weekly closed-won: ${sum(int(r['USD']) for r in rows):,} across {len(rows)} deals")
    if ev == "new_email":
        m = api.fetch("GET", f"{R.GMAIL}/messages/{d['message_id']}")
        f = dict(x.split(":", 1) for x in (m.get("body_plain") or "").splitlines() if x.split(":", 1)[0] in ("Parameter", "New value", "Effective"))
        if f:
            hdr, _ = w.sheet(R.POLICY_LOG)
            w.append(R.POLICY_LOG, hdr, {"Effective": f["Effective"].strip(), "Parameter": f["Parameter"].strip(), "Value": f["New value"].strip(), "Approved by": R.email_addr(m.get("from"))})
        return
    if ev == "envelope_completed":
        env = api.fetch("GET", f"{R.DOCUSIGN}/envelopes/{d['envelope_id']}")
        cf = env.get("customFields") or {}
        oid = cf.get("Opportunity ID") or next((o["Id"] for o in w.soql("SELECT Id, Name FROM Opportunity") if R.norm(o["Name"]) == R.norm(d["deal_name"])), None)
        if not oid:
            return
        amount, upd = R.parse_amount(cf.get("Amount", d["amount"])), {"StageName": "Closed Won", "Amount": float(R.parse_amount(cf.get("Amount", d["amount"])))}
    elif ev == "opportunity_stage_changed" and d.get("new_stage") == "Closed Won":
        oid, upd = d["opportunity_id"], {}
        amount = Decimal(str(w.sobject("Opportunity", oid)["Amount"]))
    else:
        return
    opp = w.sobject("Opportunity", oid)
    acct = w.sobject("Account", opp["AccountId"])
    tier, cur = acct.get("Tier") or "Unknown", (opp.get("Currency") or "USD")
    rates = [r for r in w.sheet(R.FX_RATES)[1] if r["Currency"] == cur]
    usd = w.to_usd(amount, Decimal(max(rates, key=lambda r: r["Updated"])["USD Rate"]) if rates and cur != "USD" else None)
    box = {"Enterprise": "executive-team", "Mid-Market": "vp-sales", "SMB": "smb-team"}.get(tier, "sales-team") + "@company.example.com"
    cases = w.soql(f"SELECT Id, Status FROM Case WHERE AccountId = '{acct['Id']}'")
    to = [box] + (["support-escalation@company.example.com"] if any(c.get("Status") != "Closed" for c in cases) else [])
    owner = w.sobject("User", opp["OwnerId"])["Name"]
    text = f"CLOSED: {opp['Name']} | ${usd:,} | {tier} | AE: {owner}"
    w.send(to, R.SUBJECT, f"{opp['Name']} closed for ${usd:,} ({tier})")
    w.post("deal-wins", text)
    if usd >= 250000:
        w.post("exec-wins", text)
    date = (d.get("completed_at") or d.get("changed_at"))[:10]
    api.fetch("PATCH", f"{R.SF}/sobjects/Opportunity/{oid}", None, dict(upd, Description=f"Announced in #deal-wins {date}"))
    hdr, _ = w.sheet(R.DEAL_LOG)
    w.append(R.DEAL_LOG, hdr, {"Event ID": d["event_id"], "Opportunity ID": oid, "Opportunity": opp["Name"], "Closed At": date, "USD": str(usd), "Tier": tier, "Routed To": ", ".join(to), "Status": "Announced"})


class NoDedupe(R.DealDesk):
    def is_repeat(self, log, event_id, opp_id):
        return False


class AsOfBlind(R.DealDesk):  # newest row overall, even when it is dated after the close date
    def tier_for(self, account, close_date):
        return super().tier_for(account, "9999-12-31")

    def rate_for(self, currency, close_date):
        return super().rate_for(currency, "9999-12-31")


class NoParent(R.DealDesk):
    def escalation(self, account):
        return super().escalation(dict(account, ParentId=None))


class AnyAuthor(R.DealDesk):
    def authorized(self, sender):
        return True


class SfTier(R.DealDesk):
    def tier_for(self, account, close_date):
        return account.get("Tier") or "Unknown"


class NoComma(R.DealDesk):
    def fmt(self, usd):
        return f"${usd}"


class NoRetract(R.DealDesk):
    def on_reopen(self, p, data):
        return None


def variant(cls):
    def run(payload, api):
        cls(api).handle(payload)
    run.__name__ = cls.__name__
    return run


CONTROLS = {"null": null, "echo": echo, "naive": naive, "nodedupe": variant(NoDedupe), "asof": variant(AsOfBlind),
            "noparent": variant(NoParent), "anyauthor": variant(AnyAuthor), "sftier": variant(SfTier),
            "nocomma": variant(NoComma), "noretract": variant(NoRetract)}
