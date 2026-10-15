"""abr-mkt-reviews: constants and pure helpers shared by the generator (gen.py) and the oracle (oracle.py).

The observable-only reference (reference.py) deliberately does NOT import this module: it is a second implementation
written from POLICY.md alone, so a disagreement between it and the generator's truth exposes a bug in one of them.
"""
from __future__ import annotations

import hashlib
import json
import re

FAMILY = "abr-mkt-reviews"
VERSION = "1.0.0"
APPS = ("gmail", "hubspot", "slack")

ORG = "company.example.com"
INBOX = f"marketing@{ORG}"
SUMMARY_TO = f"app-reviews@{ORG}"
PRODUCT = f"product@{ORG}"
DEV = f"dev@{ORG}"
INTERN = f"intern@{ORG}"
STORE_SENDERS = ("reviews@appstore.example.com", "review-noreply@appstore.example.com")
APP_NAME = "Fernleaf Planner"

THANKS_SUBJECT = "Thank you for your review"
SUMMARY_SUBJECT = "Review triage summary "          # + YYYY-MM-DD
AMEND_SUBJECT = "Review policy amendment"
HIGH = "[HIGH PRIORITY] "
STAR = "★"                                      # the black star in `App review <n>★`
REVIEW_TEAM_USER = "App Review Team"
CODE_POST = "Triage code for the week of {week}: {code}"

APP_REVIEWS, REVIEW = "app-reviews", "automation-review"
CHANNELS = (APP_REVIEWS, REVIEW, "marketing")

PARAMS = ("Ticket ratings", "Thank-you ratings")
DEFAULTS = {"Ticket ratings": "1-2", "Thank-you ratings": "4-5"}
ALLOWED = {"Ticket ratings": ("1-2", "1-3"), "Thank-you ratings": ("4-5", "5")}

HIGH_WORDS = ("crash", "crashes", "crashed", "crashing", "freeze", "freezes", "freezing", "froze", "frozen")
HIGH_RE = re.compile(r"(?<![A-Za-z])(?:" + "|".join(HIGH_WORDS) + r")(?![A-Za-z])", re.I)

NOTE_TEXT = {
    "bot": "Bot Suspected - automated submission detected, do not process",
    "abuse": "Known abuse account - all actions suppressed per fraud policy",
    "eng": "Escalated to Engineering - ticket ENG-{n} open, no customer-facing response",
    "comp": "COMP account - do not contact per legal non-solicitation agreement",
}
BENIGN_NOTES = ["Verified purchase", "Reviewer is on the beta channel", "Translated from Spanish",
                "Reviewer has 3 earlier reviews", "Device: tablet", "Mentioned in the weekly digest"]


def canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(obj) -> str:
    return hashlib.sha256((obj if isinstance(obj, str) else canon(obj)).encode()).hexdigest()


def rating_set(value: str) -> set[int]:
    a, _, b = value.partition("-")
    return set(range(int(a), int(b or a) + 1))


def ticket_subject(rating: int, reviewer: str, code: str, high: bool) -> str:
    return f"{HIGH if high else ''}App review {rating}{STAR} - {reviewer} - {code}"


def summary_line(code: str, tickets: int, thanks: int) -> str:
    return f"{code}: tickets {tickets}, thank-yous {thanks}"


def ack_text(param: str, value: str) -> str:
    return f"Policy updated: {param} = {value}"


def norm(s) -> str:
    return " ".join(str(s or "").split())


def addr(s: str | None) -> str:
    """The bare, lower-cased address of a header value ('Ann Lee <Ann@x.example.com>' -> 'ann@x.example.com')."""
    m = re.search(r"<([^>]+)>", s or "")
    return (m.group(1) if m else (s or "")).strip().lower()


def has_token(text, token: str) -> bool:
    """`token` occurs in `text` (whitespace-normalized, ignoring case) and is not the prefix of a longer number or
    word: 'tickets 1, thank-yous 2' does not match 'tickets 1, thank-yous 23', and 's610/t01' does not match
    's610/t012'."""
    return re.search(re.escape(norm(token).lower()) + r"(?![\w-])", norm(text).lower()) is not None
