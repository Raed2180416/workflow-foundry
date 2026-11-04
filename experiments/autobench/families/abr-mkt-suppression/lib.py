"""abr-mkt-suppression: constants and pure helpers shared by the generator (gen.py) and the oracle (oracle.py).

The observable-only reference (reference.py) deliberately does NOT import this module: it is a second implementation
written from POLICY.md alone, so a disagreement between it and the generator's truth exposes a bug in one of them.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import date, timedelta

FAMILY = "abr-mkt-suppression"
VERSION = "1.0.0"
APPS = ["mailchimp", "google_sheets", "gmail", "slack"]

ORG = "company.example.com"
COMPLIANCE = f"compliance@{ORG}"
INBOX = f"suppression@{ORG}"
CONFIRM_SUBJECT = "Unsubscribe confirmation"
CONFIRM_PHRASE = "has been removed from all our mailing lists"  # POLICY.md: "<address> has been removed from all our mailing lists."
AM_SUBJECT_PREFIX = "Premium-tier hard bounce: "
CONFIRM_WINDOW = 30

PARAMS = ["Soft-bounce threshold", "Soft-bounce window"]
DEFAULTS = {"Soft-bounce threshold": "3", "Soft-bounce window": "30"}

LIST_NAMES = ["Newsletter", "Product Updates", "Events & Webinars", "Partner Offers"]

SHEETS = {
    "requests": {"ss": "sheet-unsubscribe-requests", "title": "Unsubscribe Requests", "ws": "ws-requests", "ws_title": "Requests",
                 "headers": ["Request ID", "Email", "Requested At", "Source", "Notes"], "id": "Request ID"},
    "bounces": {"ss": "sheet-email-bounces", "title": "Email Bounces", "ws": "ws-bounces", "ws_title": "Bounces",
                "headers": ["Bounce ID", "Email", "Bounce Type", "Bounced At", "Campaign", "Notes"], "id": "Bounce ID"},
    "bouncelog": {"ss": "sheet-bounce-log", "title": "Bounce Log", "ws": "ws-soft-bounces", "ws_title": "Soft Bounces",
                  "headers": ["Date", "Email", "Bounce ID"]},
    "log": {"ss": "sheet-compliance-log", "title": "Compliance Log", "ws": "ws-log", "ws_title": "Log",
            "headers": ["Date", "Email", "Event", "Action", "Lists", "Confirmation", "Ref"]},
    "managers": {"ss": "sheet-account-managers", "title": "Account Managers", "ws": "ws-managers", "ws_title": "Managers",
                 "headers": ["Email", "Account", "Account Manager"]},
    "policy": {"ss": "sheet-suppression-policy", "title": "Suppression Policy Log", "ws": "ws-policy", "ws_title": "Policy Log",
               "headers": ["Effective", "Parameter", "Value", "Approved by"]},
}
APPEND_ONLY = ("log", "bouncelog", "policy")
CHANNELS = {"compliance": "C0COMPLNC01", "automation-review": "C0AUTOREVW1", "marketing": "C0MARKETNG1"}
CHANNEL_NAME = {v: k for k, v in CHANNELS.items()}
SINK = "automation-review"

ACTIONS = ["Archived", "Escalated", "Logged", "Ignored", "Skipped", "Not subscribed"]
EVENTS = ["Unsubscribe", "Unsubscribe (reprocess)", "Hard bounce", "Soft bounce", "Transient bounce", "Unknown bounce"]

HOLD_RE = re.compile(r"hold until (\d{4}-\d{2}-\d{2})", re.I)


import sys as _b0_sys  # B0: experiments/autobench on the path for the shared abr.lib
from pathlib import Path as _B0Path
if str(_B0Path(__file__).resolve().parents[2]) not in _b0_sys.path:
    _b0_sys.path.append(str(_B0Path(__file__).resolve().parents[2]))
from abr.lib import common as _abr_common  # noqa: E402
from abr.lib import host as _abr_host  # noqa: E402


canon = _abr_common.canon


def member_id(email: str) -> str:
    """Mailchimp's subscriber hash: md5 of the lower-cased address."""
    return hashlib.md5(email.lower().encode()).hexdigest()


def addr(s: str | None) -> str:
    """The bare address of a header value ('Ann Lee <Ann@x.example.com>' -> 'ann@x.example.com')."""
    m = re.search(r"<([^>]+)>", s or "")
    return (m.group(1) if m else (s or "")).strip().lower()


def is_unsub_subject(subject: str | None) -> bool:
    s = (subject or "").strip()
    while True:
        m = re.match(r"(?i)\s*(re|fwd|fw)\s*:\s*", s)
        if not m:
            break
        s = s[m.end():]
    return s.strip().lower() == "unsubscribe"


def hold_date(notes: str | None) -> str | None:
    m = HOLD_RE.search(notes or "")
    return m.group(1) if m else None


def is_duplicate(notes: str | None) -> bool:
    return "duplicate" in (notes or "").lower()


def is_invalid(notes: str | None) -> bool:
    n = (notes or "").lower()
    return any(w in n for w in ("resolved", "pre-migration", "retracted"))


def is_premium(notes: str | None) -> bool:
    return "premium-tier" in (notes or "").lower()


def is_reprocess(notes: str | None) -> bool:
    n = (notes or "").lower()
    return "system error" in n and "reprocess" in n


def in_window(d: str, today: str, days: int) -> bool:
    t = date.fromisoformat(today)
    return (t - timedelta(days=days - 1)).isoformat() <= d <= today


def lists_text(names) -> str:
    return "; ".join(sorted(names))


def daily_text(day: str, archived: int, escalated: int, confirmations: int) -> str:
    return f"{day}: archived {archived}, escalated {escalated}, confirmations {confirmations}"


def bounce_event(bounce_type: str) -> str | None:
    t = (bounce_type or "").strip().lower()
    return {"hard": "Hard bounce", "soft": "Soft bounce", "transient": "Transient bounce", "unknown": "Unknown bounce"}.get(t)


def am_subject(email: str) -> str:
    return AM_SUBJECT_PREFIX + email
