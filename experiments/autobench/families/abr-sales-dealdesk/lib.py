"""abr-sales-dealdesk: constants and pure helpers shared by the generator (gen.py) and the oracle (oracle.py).

The observable-only reference (reference.py) deliberately does NOT import this module: it is a second implementation
written from POLICY.md alone, so a disagreement between it and the generator's truth exposes a bug in one of them.
"""
from __future__ import annotations

import json
import re
from decimal import ROUND_HALF_UP, Decimal

FAMILY = "abr-sales-dealdesk"
VERSION = "1.0.0"
APPS = ["salesforce", "docusign", "google_sheets", "gmail", "slack"]

ORG = "company.example.com"
SALES_OPS = f"sales-ops@{ORG}"
ESCALATION_MAILBOX = f"support-escalation@{ORG}"
SUBJECT = "Deal Closed Notification"

PARAMS = ["Enterprise mailbox", "Mid-Market mailbox", "SMB mailbox", "Default mailbox", "Exec threshold"]
DEFAULTS = {
    "Enterprise mailbox": f"executive-team@{ORG}",
    "Mid-Market mailbox": f"vp-sales@{ORG}",
    "SMB mailbox": f"smb-team@{ORG}",
    "Default mailbox": f"sales-team@{ORG}",
    "Exec threshold": "250000",
}
TIER_PARAM = {"Enterprise": "Enterprise mailbox", "Mid-Market": "Mid-Market mailbox", "SMB": "SMB mailbox"}
TEAM_MAILBOXES = [DEFAULTS[p] for p in PARAMS[:4]] + [ESCALATION_MAILBOX]

SHEETS = {
    "hierarchy": {"ss": "sheet-account-hierarchy", "title": "Account Hierarchy", "ws": "ws-hierarchy", "ws_title": "Hierarchy",
                  "headers": ["Account ID", "Account", "Tier", "Updated"]},
    "fx": {"ss": "sheet-fx-rates", "title": "FX Rates", "ws": "ws-rates", "ws_title": "Rates",
           "headers": ["Currency", "USD Rate", "Updated"]},
    "log": {"ss": "sheet-deal-desk-log", "title": "Deal Desk Log", "ws": "ws-log", "ws_title": "Log",
            "headers": ["Event ID", "Opportunity ID", "Opportunity", "Closed At", "USD", "Tier", "Routed To", "Status"]},
    "policy": {"ss": "sheet-deal-desk-policy", "title": "Deal Desk Policy Log", "ws": "ws-policy", "ws_title": "Policy Log",
               "headers": ["Effective", "Parameter", "Value", "Approved by"]},
}
CHANNELS = {"deal-wins": "C0DEALWINS1", "exec-wins": "C0EXECWINS1", "automation-review": "C0AUTOREVW1",
            "team-updates": "C0TEAMUPDT1", "sales-floor": "C0SALESFLR1"}
CHANNEL_NAME = {v: k for k, v in CHANNELS.items()}
SINK = "automation-review"


def canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def money(usd: int) -> str:
    return f"${usd:,}"


def to_usd(amount: Decimal, rate: Decimal | None) -> int:
    v = amount if rate is None else amount * rate
    return int(v.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def parse_amount(text: str) -> Decimal:
    """An envelope amount as typed: '125000', '125,000.00', '125.000,00' (comma decimal mark)."""
    s = str(text).strip().replace(" ", "").replace(" ", "")
    if re.search(r",\d{2}$", s):  # comma decimal mark
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", "")
    return Decimal(s)


def norm_name(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


def slack_closed(name: str, usd: int, tier: str, owner: str) -> str:
    return f"CLOSED: {name} | {money(usd)} | {tier} | AE: {owner}"


def slack_retracted(name: str) -> str:
    return f"RETRACTED: {name}"


def slack_week(total: int, n: int) -> str:
    return f"Weekly closed-won: {money(total)} across {n} deals"


def announce_note(date: str) -> str:
    return f"Announced in #deal-wins {date}"
