"""abr-ops-slawatch: constants and pure helpers shared by the generator (gen.py) and the oracle (oracle.py).

The observable-only reference (reference.py) deliberately does NOT import this module: it is a second implementation
written from POLICY.md alone, so a disagreement between it and the generator's truth exposes a bug in one of them.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone

FAMILY = "abr-ops-slawatch"
VERSION = "1.1.0"
UTC = timezone.utc
APPS = ["gmail", "google_sheets", "jira", "slack", "twilio"]

ORG = "company.example.com"
MANAGER = f"support-manager@{ORG}"
FORMER_MANAGER = f"helpdesk-lead@{ORG}"
INBOX = f"sla-watch@{ORG}"
SMS_FROM = "+15550001111"
JIRA_PROJECT = "SUPPORT"
ESC, SINK, GENERAL = "support-escalation", "automation-review", "support-general"
CHANNELS = {ESC: "C0SUPESCAL1", SINK: "C0AUTOREVW1", GENERAL: "C0SUPGENRL1"}

TICKETS_SS, POLICY_SS = "sheet-support-tickets", "sheet-sla-policy"
WS_OPEN, WS_CONFIG, WS_HOLD, WS_POLICY = "ws-open-tickets", "ws-sla-config", "ws-sla-hold", "ws-policy-log"
TITLES = {WS_OPEN: "Open Tickets", WS_CONFIG: "SLA Config", WS_HOLD: "SLA Hold Policy", WS_POLICY: "Policy Log"}
TICKET_COLS = ["Ticket ID", "Subject", "Customer", "Assigned Agent", "Agent Phone", "Priority", "Status", "SLA Deadline",
               "Notes"]
STATE_COLS = ["Warned At", "Warned Agent", "Warned Deadline", "Breached At"]
OPEN_HEADERS = TICKET_COLS + STATE_COLS
CONFIG_HEADERS = ["Setting", "Value"]
HOLD_HEADERS = ["Rule Name", "Condition", "Action", "Reference"]
POLICY_HEADERS = ["Effective", "Parameter", "Value", "Approved by"]
PARAM = "Warning window"
WINDOW_MIN, WINDOW_MAX = 60, 180
DEFAULT_WINDOW = 120

CHECK_HOURS = range(10, 18)          # hourly checks 10:00-17:00 UTC, Monday to Friday
MONITORED = ("open", "in progress")

LGL_RE = re.compile(r"LGL-\d", re.I)


def canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(obj) -> str:
    return hashlib.sha256((obj if isinstance(obj, str) else canon(obj)).encode("utf-8")).hexdigest()


def iso_z(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def hhmm(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%H:%M")


_SPACE_UTC = re.compile(r"^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?\s*(?:UTC|GMT)$", re.I)


def parse_instant(s) -> datetime | None:
    """An instant written by a person or an arm: ISO 8601 with Z or an offset, or 'YYYY-MM-DD HH:MM[:SS] UTC'. A
    naive ISO value is read as UTC (the shim's naive clock is UTC). Anything else -> None."""
    if s is None:
        return None
    t = str(s).strip()
    if not t:
        return None
    m = _SPACE_UTC.match(t)
    if m:
        t = f"{m.group(1)}T{m.group(2)}+00:00"
    if t.endswith(("Z", "z")):
        t = t[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(t)
    except ValueError:
        return None
    if "T" not in t and " " not in t:
        return None                     # a bare date is not an instant
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def phone_e164(s) -> str | None:
    d = re.sub(r"\D", "", str(s or ""))
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    return "+1" + d if len(d) == 10 else None


def norm(s) -> str:
    return " ".join(str(s or "").split())


def norm_ci(s) -> str:
    return norm(s).lower()


def has_token(text, token: str) -> bool:
    """`token` occurs in `text` (whitespace-normalized, ignoring case), is not glued to a preceding word character, and
    is not the prefix of a longer id or number: 'SLA warning TK-4001:' never matches inside 'SLA warning TK-40010:',
    'BREACHED TK-4001' does not match 'BREACHED TK-40010', 's610/t01' does not match 's610/t012'."""
    return _token_match(text, token) is not None


# Words that negate, retract or cancel an alert. Checked only OUTSIDE the policy literal (the literal of a warning post
# holds the ticket's Subject, which may itself say "not", e.g. "Two-factor codes not arriving").
NEGATION_RE = re.compile(r"\b(?:not|no longer|never ?mind|ignore|disregard|error|mistake|mistaken|mistakenly|"
                         r"false alarm|cancel(?:l?ed|s)?|retract(?:ed|s)?|withdraw[ns]?|withdrew|rescind(?:ed|s)?|"
                         r"void(?:ed)?|test(?:ing)? only)\b|n't\b", re.I)
GREETING_MAX_WORDS = 4      # 'Hi Ravi,' / ':warning:' / 'Hello Ravi Menon -' before the alert literal


def _token_match(text, token: str):
    tok = norm(token).lower()
    if not tok:
        return None
    pre = r"(?<![\w-])" if tok[0].isalnum() else ""
    return re.search(pre + re.escape(tok) + r"(?![\w])", norm(text).lower())


def alert_ok(text, token: str, max_prefix_words: int = GREETING_MAX_WORDS) -> bool:
    """An alert that carries the policy literal `token` and says nothing else that changes its meaning: has_token, at
    most a short greeting before the literal, and no negation or retraction words outside the literal. 'Hi Ravi, SLA
    warning TK-1: due 11:10 UTC. Please take a look.' passes; 'Ignore previous. SLA warning TK-1: due 11:10 UTC was
    sent in error' does not."""
    m = _token_match(text, token)
    if m is None:
        return False
    t = norm(text)
    prefix, rest = t[:m.start()], t[:m.start()] + " " + t[m.end():]
    return len(prefix.split()) <= max_prefix_words and NEGATION_RE.search(rest) is None


_EDGE_PUNCT = " \t\r\n.!;:,"


def exact_text_ok(text, want: str) -> bool:
    """Equality ignoring case, whitespace and trailing punctuation ('post exactly BREACHED <ID>')."""
    return norm_ci(text).strip(_EDGE_PUNCT) == norm_ci(want).strip(_EDGE_PUNCT)


def visible_post(rec: dict) -> bool:
    """A Slack message people reading the channel see: not deleted, and top-level (conversations.history drops thread
    replies: automationbench/schema/slack.py filters `not m.thread_ts`). A thread parent carries thread_ts == ts."""
    th = rec.get("thread_ts")
    return not rec.get("is_deleted") and (not th or str(th) == str(rec.get("ts")))


def address(s) -> str:
    m = re.search(r"<([^>]+)>", str(s or ""))
    return (m.group(1) if m else str(s or "")).strip().lower()


# The automation inbox sends all email (POLICY.md section 2). AutomationBench's gmail messages/send records the
# authenticated mailbox as `user@gmail.com` when the request names no sender (automationbench/tools/zapier/gmail/
# message.py: `from_=from_ or "user@gmail.com"`), so that default is the inbox too.
AB_DEFAULT_SENDER = "user@gmail.com"
INBOX_SENDERS = {"", f"sla-watch@{ORG}", AB_DEFAULT_SENDER}


def sender_ok(rec: dict) -> bool:
    return address(rec.get("from_")) in INBOX_SENDERS


def digits_value_ok(value, want: str) -> bool:
    """Policy Log Value: 'the minutes, digits only' (surrounding spaces tolerated)."""
    return re.fullmatch(r"\s*\d+\s*", str(value if value is not None else "")) is not None \
        and int(str(value).strip()) == int(want)


def warn_sms(tid: str, due: datetime) -> str:
    return f"SLA warning {tid}: due {hhmm(due)} UTC"


def warn_line(tid: str, subject: str, due: datetime, agent: str) -> str:
    return f"{tid} | {subject} | due {hhmm(due)} UTC | {agent}"


def breach_post(tid: str) -> str:
    return f"BREACHED {tid}"


def breach_summary(tid: str) -> str:
    return f"SLA breach {tid}"


def warn_subject(tid: str) -> str:
    return f"SLA warning {tid}"


def checks_of_week(monday: datetime) -> list[datetime]:
    return [monday + timedelta(days=d, hours=h) for d in range(5) for h in CHECK_HOURS]
