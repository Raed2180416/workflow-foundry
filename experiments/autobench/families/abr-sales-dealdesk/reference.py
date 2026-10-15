"""Observable-only reference workflow for abr-sales-dealdesk.

Written from POLICY.md alone. It sees exactly what an arm sees: the trigger payload, and the simulated apps through the
AutomationBench `api_fetch` tool (the `api` object passed in; in the stream harness its `fetch` calls
automationbench.tools.api.fetch.api_fetch on the live world, the same routing the agent's tool uses). It imports only
the Python standard library: never the generator, its truth, the oracle or lib.py, so agreement with the generator's
truth is evidence from two independent implementations (RECURRING-DESIGN section 3.5, 3.11 gate 3).

Entry point: handle(payload, api). The class is split into small methods so that controls.py can build one-defect
"plausible but wrong" variants by overriding exactly one rule.
"""
from __future__ import annotations

import base64
import re
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from urllib.parse import quote

SF = "https://dealdesk.my.salesforce.com/services/data/v61.0"
SHEETS = "https://sheets.googleapis.com/v4/spreadsheets"
DOCUSIGN = "https://demo.docusign.net/restapi/v2.1/accounts/dealdesk"
GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me"
SLACK = "https://slack.com/api"

HIERARCHY = ("sheet-account-hierarchy", "Hierarchy")
FX_RATES = ("sheet-fx-rates", "Rates")
DEAL_LOG = ("sheet-deal-desk-log", "Log")
POLICY_LOG = ("sheet-deal-desk-policy", "Policy Log")

SALES_OPS = "sales-ops@company.example.com"
ESCALATION = "support-escalation@company.example.com"
SUBJECT = "Deal Closed Notification"
PARAMS = ("Enterprise mailbox", "Mid-Market mailbox", "SMB mailbox", "Default mailbox", "Exec threshold")
TIER_PARAM = {"Enterprise": "Enterprise mailbox", "Mid-Market": "Mid-Market mailbox", "SMB": "SMB mailbox"}


class Undecidable(Exception):
    pass


def norm(s) -> str:
    return re.sub(r"\s+", " ", str(s or "").strip()).lower()


def money(usd: int) -> str:
    return f"${usd:,}"


def utc_date(stamp: str) -> str:
    t = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    return (t if t.tzinfo else t.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).date().isoformat()


def parse_amount(text) -> Decimal:
    s = str(text).strip().replace(" ", "").replace(" ", "")
    if re.search(r",\d{1,2}$", s):  # comma is the decimal mark: periods (or spaces) group thousands
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", "")
    return Decimal(s)


def soql_str(s: str) -> str:
    return str(s).replace("\\", "\\\\").replace("'", "\\'")


def email_addr(s: str) -> str:
    m = re.search(r"<([^>]+)>", s or "")
    return (m.group(1) if m else (s or "")).strip().lower()


class DealDesk:
    def __init__(self, api):
        self.api = api

    # ------------------------------------------------------------------ tool access
    def call(self, method, url, params=None, body=None):
        r = self.api.fetch(method, url, params, body)
        if isinstance(r, dict) and r.get("error"):
            raise RuntimeError(f"{method} {url}: {r['error']}")
        return r

    def soql(self, q: str) -> list[dict]:
        return self.call("GET", f"{SF}/query", {"q": q}).get("records", [])

    def sobject(self, kind: str, rid: str) -> dict:
        return self.call("GET", f"{SF}/sobjects/{kind}/{rid}")

    def sheet(self, ref: tuple[str, str]) -> tuple[list[str], list[dict]]:
        vals = self.call("GET", f"{SHEETS}/{ref[0]}/values/{quote(ref[1])}").get("values", [])
        if not vals:
            return [], []
        hdr = vals[0]
        return hdr, [dict(zip(hdr, [str(v) for v in row] + [""] * (len(hdr) - len(row)))) for row in vals[1:]]

    def append(self, ref: tuple[str, str], hdr: list[str], cells: dict):
        self.call("POST", f"{SHEETS}/{ref[0]}/values/{quote(ref[1])}:append", {"valueInputOption": "RAW"},
                  {"values": [[cells.get(h, "") for h in hdr]]})

    def post(self, channel: str, text: str):
        self.call("POST", f"{SLACK}/chat.postMessage", None, {"channel": channel, "text": text})

    def send(self, to: list[str], subject: str, body: str):
        raw = f"To: {', '.join(to)}\r\nSubject: {subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{body}"
        self.call("POST", f"{GMAIL}/messages/send", None, {"raw": base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")})

    def escalate(self, p: dict, reason: str):
        self.post("automation-review", f"{p['trigger']}: {reason}")

    # ------------------------------------------------------------------ rules (one method per policy clause)
    def params(self, as_of: str) -> dict:
        _, rows = self.sheet(POLICY_LOG)
        best: dict[str, tuple[str, str]] = {}
        for r in rows:  # newest Effective on or before as_of; a later row wins a tie
            name, eff = r.get("Parameter", "").strip(), r.get("Effective", "").strip()
            if name in PARAMS and eff <= as_of and (name not in best or eff >= best[name][0]):
                best[name] = (eff, r.get("Value", "").strip())
        missing = [n for n in PARAMS if n not in best]
        if missing:
            raise Undecidable(f"no Policy Log value for {', '.join(missing)} on {as_of}")
        return {k: v for k, (_, v) in best.items()}

    def tier_for(self, account: dict, close_date: str) -> str:
        _, rows = self.sheet(HIERARCHY)
        cand = [r for r in rows if r.get("Account ID", "").strip() == account["Id"] and r.get("Updated", "").strip() <= close_date]
        if cand:
            best = cand[0]
            for r in cand[1:]:
                if r["Updated"].strip() >= best["Updated"].strip():
                    best = r
            return best["Tier"].strip()
        if not account.get("Tier"):
            raise Undecidable("no tier for the account")
        return account["Tier"]

    def rate_for(self, currency: str, close_date: str) -> Decimal | None:
        if not currency or currency.upper() == "USD":
            return None
        _, rows = self.sheet(FX_RATES)
        cand = [r for r in rows if r.get("Currency", "").strip().upper() == currency.upper() and r.get("Updated", "").strip() <= close_date]
        if not cand:
            raise Undecidable(f"no {currency} rate on or before {close_date}")
        best = cand[0]
        for r in cand[1:]:
            if r["Updated"].strip() >= best["Updated"].strip():
                best = r
        return Decimal(best["USD Rate"].strip())

    def to_usd(self, amount: Decimal, rate: Decimal | None) -> int:
        v = amount if rate is None else amount * rate
        return int(v.quantize(Decimal("1"), rounding=ROUND_HALF_UP))

    def fmt(self, usd: int) -> str:
        return money(usd)

    def escalation(self, account: dict) -> bool:
        ids = [account["Id"]] + ([account["ParentId"]] if account.get("ParentId") else [])
        cases = self.soql("SELECT Id, AccountId, Priority, Status FROM Case WHERE AccountId IN ("
                          + ", ".join(f"'{soql_str(i)}'" for i in ids) + ")")
        return any(c.get("AccountId") in ids and c.get("Priority") in ("Critical", "High") and c.get("Status") != "Closed" for c in cases)

    def is_repeat(self, log: list[dict], event_id: str, opp_id: str) -> bool:
        return any(r.get("Event ID", "").strip() == event_id or
                   (r.get("Opportunity ID", "").strip() == opp_id and r.get("Status", "").strip() == "Announced") for r in log)

    def authorized(self, sender: str) -> bool:
        return email_addr(sender) == SALES_OPS

    def identify(self, env: dict, data: dict) -> str:
        cf = env.get("customFields") or {}
        if str(cf.get("Opportunity ID") or "").strip():
            return str(cf["Opportunity ID"]).strip()
        signers = (env.get("recipients") or {}).get("signers") or []
        if len(signers) != 1:
            raise Undecidable("envelope has no single signer and no Opportunity ID")
        email = signers[0]["email"].strip()
        contacts = [c for c in self.soql(f"SELECT Id, AccountId, Email FROM Contact WHERE Email = '{soql_str(email)}'")
                    if (c.get("Email") or "").strip().lower() == email.lower()]
        accounts = sorted({c.get("AccountId") for c in contacts if c.get("AccountId")})
        if len(accounts) != 1:
            raise Undecidable(f"signer {email} matches {len(accounts)} Salesforce accounts")
        name = cf.get("Deal Name") or data.get("deal_name")
        opps = [o for o in self.soql(f"SELECT Id, Name FROM Opportunity WHERE AccountId = '{soql_str(accounts[0])}'")
                if norm(o.get("Name")) == norm(name)]
        if len(opps) != 1:
            raise Undecidable(f"deal name '{name}' matches {len(opps)} opportunities on the signer's account")
        return opps[0]["Id"]

    # ------------------------------------------------------------------ events
    def handle(self, p: dict):
        ev, data = p.get("event"), p.get("data") or {}
        try:
            if ev == "envelope_completed":
                self.on_envelope(p, data)
            elif ev == "opportunity_stage_changed":
                if data.get("new_stage") == "Closed Won":
                    self.on_won(p, data)
                elif data.get("old_stage") == "Closed Won":
                    self.on_reopen(p, data)
            elif ev == "new_email":
                self.on_email(p, data)
            elif ev == "week_close":
                self.on_week(p, data)
            # new_row (reference data) and anything else: nothing
        except Undecidable as e:
            self.escalate(p, str(e))

    def on_envelope(self, p: dict, data: dict):
        env = self.call("GET", f"{DOCUSIGN}/envelopes/{quote(data['envelope_id'])}")
        opp_id = self.identify(env, data)
        hdr, log = self.sheet(DEAL_LOG)
        if self.is_repeat(log, data["event_id"], opp_id):
            return
        cf = env.get("customFields") or {}
        opp = self.sobject("Opportunity", opp_id)
        amount = parse_amount(cf.get("Amount") or data.get("amount"))
        currency = (cf.get("Currency") or data.get("currency") or opp.get("Currency") or "USD").strip()
        close_date = utc_date(data.get("completed_at") or env.get("completedDateTime"))
        self.announce(p, data, opp, amount, currency, close_date, hdr, {"StageName": "Closed Won", "Amount": float(amount)})

    def on_won(self, p: dict, data: dict):
        opp_id = data["opportunity_id"]
        hdr, log = self.sheet(DEAL_LOG)
        if self.is_repeat(log, data["event_id"], opp_id):
            return
        opp = self.sobject("Opportunity", opp_id)
        amount = Decimal(str(opp.get("Amount")))
        self.announce(p, data, opp, amount, (opp.get("Currency") or "USD").strip(), utc_date(data["changed_at"]), hdr, {})

    def announce(self, p, data, opp, amount, currency, close_date, log_hdr, updates: dict):
        account = self.sobject("Account", opp["AccountId"])
        tier = self.tier_for(account, close_date)
        usd = self.to_usd(amount, self.rate_for(currency, close_date))
        params = self.params(close_date)
        recipients = [params[TIER_PARAM.get(tier, "Default mailbox")]]
        if self.escalation(account) and ESCALATION not in recipients:
            recipients.append(ESCALATION)
        owner = self.sobject("User", opp["OwnerId"])["Name"]
        name = opp["Name"]
        text = f"CLOSED: {name} | {self.fmt(usd)} | {tier} | AE: {owner}"
        self.send(recipients, SUBJECT, f"Deal closed: {name}\nAmount (USD): {self.fmt(usd)}\nTier: {tier}\n"
                                        f"AE: {owner}\nClose date: {close_date}\n")
        self.post("deal-wins", text)
        if usd >= int(params["Exec threshold"].replace(",", "").replace("$", "")):
            self.post("exec-wins", text)
        note = f"Announced in #deal-wins {close_date}"
        desc = opp.get("Description") or ""
        self.call("PATCH", f"{SF}/sobjects/Opportunity/{opp['Id']}", None,
                  dict(updates, Description=f"{desc}\n{note}" if desc.strip() else note))
        self.append(DEAL_LOG, log_hdr, {"Event ID": data["event_id"], "Opportunity ID": opp["Id"], "Opportunity": name,
                                         "Closed At": close_date, "USD": str(usd), "Tier": tier,
                                         "Routed To": ", ".join(recipients), "Status": "Announced"})

    def on_reopen(self, p: dict, data: dict):
        hdr, log = self.sheet(DEAL_LOG)
        idx = [i for i, r in enumerate(log) if r.get("Opportunity ID", "").strip() == data["opportunity_id"]
               and r.get("Status", "").strip() == "Announced"]
        if not idx:
            return
        i = idx[-1]
        opp = self.sobject("Opportunity", data["opportunity_id"])
        self.post("deal-wins", f"RETRACTED: {opp['Name']}")
        row, col = i + 2, chr(ord("A") + hdr.index("Status"))  # data row i is sheet row i + 2 (row 1 holds the headers)
        # the simulated Sheets API returns every row from the range's first row on, so the first one must be ours
        check = self.call("GET", f"{SHEETS}/{DEAL_LOG[0]}/values/{quote(DEAL_LOG[1])}!A{row}:{chr(ord('A') + len(hdr) - 1)}{row}").get("values", [])
        if not check or check[0][hdr.index("Event ID")] != log[i]["Event ID"]:
            raise Undecidable("could not locate the Deal Desk Log row to retract")
        self.call("PUT", f"{SHEETS}/{DEAL_LOG[0]}/values/{quote(DEAL_LOG[1])}!{col}{row}", {"valueInputOption": "RAW"},
                  {"values": [["Retracted"]]})

    def on_email(self, p: dict, data: dict):
        msg = self.call("GET", f"{GMAIL}/messages/{quote(data['message_id'])}")
        if not self.authorized(msg.get("from") or data.get("from") or ""):
            return
        body = msg.get("body_plain") or ""
        found = {k.lower(): v.strip() for k, v in re.findall(r"^\s*(Parameter|New value|Effective)\s*:\s*(.+?)\s*$", body, re.M | re.I)}
        if not found:
            return  # not an amendment: nothing to do
        param = next((x for x in PARAMS if x.lower() == found.get("parameter", "").lower()), None)
        eff = found.get("effective", "")
        value = found.get("new value", "")
        if param is None or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", eff) or not value:
            raise Undecidable("amendment from sales-ops could not be read")
        if param == "Exec threshold":
            value = re.sub(r"[^\d.]", "", value).split(".")[0]
        hdr, _ = self.sheet(POLICY_LOG)
        self.append(POLICY_LOG, hdr, {"Effective": eff, "Parameter": param, "Value": value, "Approved by": SALES_OPS})

    def on_week(self, p: dict, data: dict):
        friday = utc_date(p["at"])
        monday = data.get("week_start") or (date.fromisoformat(friday) - timedelta(days=4)).isoformat()
        end = data.get("week_end") or friday
        _, log = self.sheet(DEAL_LOG)
        rows = [r for r in log if r.get("Status", "").strip() == "Announced" and monday <= r.get("Closed At", "").strip() <= end]
        total = sum(int(Decimal(str(r["USD"]).replace(",", "").replace("$", "").strip())) for r in rows)
        self.post("deal-wins", f"Weekly closed-won: {self.fmt(total)} across {len(rows)} deals")


def handle(payload: dict, api) -> None:
    DealDesk(api).handle(payload)
