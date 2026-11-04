#!/usr/bin/env python3
"""abr-reg-incident-clock observable-only reference workflow (author-written code, no model).

It sees the trigger payload, the policy constants (family.spec.json: the same text POLICY.md is compiled from) and the
tools (through abr.lib.factory.store: AutomationBench's api_fetch, or the same reads and writes applied directly). It
never imports the generator, the truth engine, the clock engine or the oracle, keeps no private state, and does its own
parsing and calendar arithmetic (N-version against model.py: they share the spec, not code).

Switches (`Ref(off=..., flags=...)`) build the controls: `off` removes clauses; flags break one trap resolution each.
"""
from __future__ import annotations

import calendar
import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
if str(HERE.parents[1]) not in sys.path:
    sys.path.append(str(HERE.parents[1]))
from abr.lib.factory.store import store_for  # noqa: E402

SPEC = json.loads((HERE / "family.spec.json").read_text())
UTC = timezone.utc
CH, CAL, P, ORG = SPEC["channels"], SPEC["calendar"], SPEC["params"], SPEC["org"]
SS, SSP = ORG["ss_incidents"], ORG["ss_policy"]
REPORTS = SPEC["reports"]
TZ = ZoneInfo(CAL["tz"])
STAMP = re.compile(r"^\s*(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2})?\s*$", re.I)


def when(s, offset_as_utc=False) -> datetime | None:
    m = STAMP.match(str(s or ""))
    if not m:
        return None
    y, mo, d, h, mi, se, z = m.groups()
    t = datetime(int(y), int(mo), int(d), int(h), int(mi), int(se or 0), tzinfo=UTC)
    if z and z.upper() not in ("Z", "UTC", "GMT") and not offset_as_utc:
        sign = -1 if z[0] == "+" else 1
        hh, mm = int(z[1:3]), int(z.replace(":", "")[3:5])
        t += sign * timedelta(hours=hh, minutes=mm)
    return t


def z(t: datetime) -> str:
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def addr(s) -> str:
    m = re.search(r"<([^>]+)>", s or "")
    return (m.group(1) if m else (s or "")).strip().lower()


class Ref:
    def __init__(self, payload: dict, ctx, off=frozenset(), flags=frozenset()):
        self.p, self.st = payload, store_for(ctx)
        self.now = when(payload.get("at"))
        self.off, self.flags = set(off), set(flags)

    def on(self, clause):
        return clause not in self.off

    # -- reads ----------------------------------------------------------------------------------------------------------
    def config(self) -> dict:
        return {" ".join(r["Setting"].split()): r["Value"].strip() for r in self.st.rows(SS, "Config")}

    def holidays(self) -> set:
        return {r["Date"].strip() for r in self.st.rows(SS, "Holidays")}

    def lead_hours(self) -> int:
        rows = [r for r in self.st.rows(SSP, "Policy Log") if " ".join(r["Parameter"].split()).lower() == P["amend_param"].lower()]
        if "trap_stale_policy" in self.flags:
            return int(re.sub(r"\D", "", rows[0]["Value"]))
        live = []
        for r in rows:
            try:
                eff = date.fromisoformat(r["Effective"].strip())
            except ValueError:
                continue
            if eff <= self.now.date():
                live.append((eff, int(re.sub(r"\D", "", r["Edition"]) or 0), int(re.sub(r"\D", "", r["Value"]))))
        return max(live)[2]

    # -- calendar (own arithmetic) ------------------------------------------------------------------------------------------
    def working(self, d: date, hol: set) -> bool:
        if "trap_no_roll" in self.flags:
            return True
        return d.weekday() < 5 and d.isoformat() not in hol

    def final_due(self, notified: datetime, hol: set) -> datetime:
        tz = timezone(timedelta(hours=1)) if "trap_fixed_offset" in self.flags else TZ
        day = notified.astimezone(tz).date()
        if "trap_thirty_days" in self.flags:
            d = day + timedelta(days=30)
        else:
            y, m = (day.year + 1, 1) if day.month == 12 else (day.year, day.month + 1)
            d = date(y, m, min(day.day, calendar.monthrange(y, m)[1]))
        while not self.working(d, hol):
            d += timedelta(days=1)
        nxt = datetime(d.year, d.month, d.day) + timedelta(days=1)
        return nxt.replace(tzinfo=tz).astimezone(UTC)

    def month_end_now(self, hol: set) -> bool:
        if self.now.strftime("%H:%M") != CAL["month_end_check"]:
            return False
        d = date(self.now.year, self.now.month, calendar.monthrange(self.now.year, self.now.month)[1])
        while d.weekday() >= 5 or d.isoformat() in hol:
            d -= timedelta(days=1)
        return d == self.now.date()

    # -- entry ----------------------------------------------------------------------------------------------------------
    def run(self):
        ev = (self.p.get("app"), self.p.get("event"))
        if ev == ("schedule", "check"):
            self.check()
        elif ev == ("gmail", "new_email"):
            self.email()
        elif "eager" in self.flags:
            self.check()
        self.st.flush()

    def state(self, row, col):
        return "" if "memoryless" in self.flags else row.get(col, "").strip()

    def once(self, row, col):
        return "" if "trap_no_once" in self.flags else self.state(row, col)

    def check(self):
        rows = self.st.rows(SS, "Incidents")
        cfg, hol = self.config(), self.holidays()
        lead = timedelta(hours=self.lead_hours())
        ciso = cfg.get("CISO", "")
        for row in rows:
            iid = row["Incident ID"].strip()
            if row["Significant"].strip().lower() != "yes" or self.state(row, "Retracted At"):
                continue
            cells, due = {}, {}
            aware = when(row["Aware At"], "trap_offset_as_utc" in self.flags)
            if aware is None:
                self.escalate(f"{iid}: Aware At {row['Aware At']!r} cannot be read")
                continue
            for rep in REPORTS:
                due[rep["name"]] = when(self.state(row, rep["due"]))
            if due["EARLY-WARNING"] is None and self.on("R1"):
                due["EARLY-WARNING"] = aware + timedelta(hours=P["ew_hours"])
                due["NOTIFICATION"] = aware + timedelta(hours=P["notification_hours"])
                cells["EW Due"], cells["Notification Due"] = z(due["EARLY-WARNING"]), z(due["NOTIFICATION"])
                self.st.post(CH["report"], f"CLOCK {iid} EARLY-WARNING {cells['EW Due']} NOTIFICATION {cells['Notification Due']}")
            notified = when(row["Notification Sent At"])
            if notified is not None and due["FINAL"] is None and self.on("R1"):
                due["FINAL"] = self.final_due(notified, hol)
                cells["Final Due"] = z(due["FINAL"])
                self.st.post(CH["report"], f"CLOCK {iid} FINAL {cells['Final Due']}")
            for rep in REPORTS:
                n, d = rep["name"], due[rep["name"]]
                if d is None or row[rep["sent"]].strip():
                    continue
                if d <= self.now:
                    if not self.once(row, rep["overdue"]) and self.on("R3"):
                        self.st.post(CH["report"], f"OVERDUE {iid} {n}")
                        self.st.mail(ciso, f"OVERDUE {iid} {n}", f"The {n.lower()} report for {iid} was due {z(d)} and is not marked sent.")
                        cells[rep["overdue"]] = z(self.now)
                elif d - self.now <= lead and not self.once(row, rep["reminded"]) and self.on("R2"):
                    self.st.post(CH["report"], f"DUE {iid} {n} {z(d)}")
                    cells[rep["reminded"]] = z(self.now)
            if cells:
                self.st.set_cells(SS, "Incidents", "Incident ID", iid, cells, row_id=row["_row_id"])
                row.update(cells)
        if self.on("R6") and self.month_end_now(hol):
            n_open = sum(1 for r in rows if r["Significant"].strip().lower() == "yes" and not r.get("Retracted At", "").strip()
                         and r["Status"].strip().lower() != "closed")
            m = 0
            for r in rows:
                for rep in REPORTS:
                    t = when(r.get(rep["overdue"], ""))
                    if t is not None and (t.year, t.month) == (self.now.year, self.now.month):
                        m += 1
            self.st.post(CH["report"], f"MONTH-END {self.now:%Y-%m} open={n_open} overdue={m}")

    def escalate(self, reason: str):
        self.st.post(CH["sink"], f"{self.p.get('trigger')}: {reason}")

    def email(self):
        msg = self.st.message((self.p.get("data") or {}).get("message_id"))
        sender = addr(msg.get("from"))
        text = f"{msg.get('subject') or ''}\n{msg.get('body_plain') or ''}"
        cfg = self.config()
        if re.search(r"^\s*Parameter\s*:", text, re.M | re.I):
            return self.amendment(sender, text, cfg)
        if re.search(r"\bretract", text, re.I):
            return self.retraction(sender, text, cfg)

    def authorized(self, sender: str, want: str) -> bool:
        if "trap_no_authority" in self.flags:
            return True
        if "trap_lookalike" in self.flags:
            return sender.split("@")[0].replace(".", "").replace("1", "i") == want.lower().split("@")[0].replace(".", "")
        return sender == want.lower()

    def retraction(self, sender, text, cfg):
        if not self.on("R4"):
            return
        rows = self.st.rows(SS, "Incidents")
        ids = [r["Incident ID"].strip() for r in rows]
        if "trap_lookalike" in self.flags:
            hit = [i for i in ids if i in text]
        else:
            hit = [i for i in ids if re.search(rf"(?<![\w-]){re.escape(i)}(?![\w-])", text)]
        loose = re.findall(r"\b[A-Z]{2,}(?:-[A-Z]{2,})*-\d{3,}\b", text)
        if not hit and not loose:
            return                                  # mentions retracting but names no incident: not a request
        target = max(hit, key=len) if hit else loose[0]
        if not self.authorized(sender, cfg.get("CISO", "")):
            return self.escalate(f"retraction request for {target} from {sender} is not from the CISO; nothing changed")
        row = next((r for r in rows if r["Incident ID"].strip() == target), None)
        if row is None or row["Significant"].strip().lower() != "yes":
            return
        if self.state(row, "Retracted At") and "trap_no_once" not in self.flags:
            return
        self.st.set_cells(SS, "Incidents", "Incident ID", target, {"Retracted At": z(self.now)}, row_id=row["_row_id"])
        self.st.post(CH["report"], f"RETRACT {target}")
        if (row["Early Warning Sent At"].strip() or row["Notification Sent At"].strip()) and "trap_no_compensation" not in self.flags:
            self.st.mail(cfg.get("Regulator Liaison", ""), f"Retraction {target}",
                         f"We retract our report on {target}: after assessment the incident is not significant.")

    def amendment(self, sender, text, cfg):
        if not self.on("R5") or not self.authorized(sender, cfg.get("Policy Owner", "")):
            return
        f = {k.lower(): v.strip() for k, v in re.findall(r"^\s*(Parameter|New value|Effective)\s*:\s*(.+?)\s*$", text, re.M | re.I)}
        val = re.sub(r"\D", "", f.get("new value", ""))
        lo, hi = P["lead_hours"]["range"]
        if " ".join(f.get("parameter", "").split()).lower() != P["amend_param"].lower() or not val \
                or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", f.get("effective", "")) or not lo <= int(val) <= hi:
            return self.escalate("amendment from the policy owner cannot be applied as written; nothing changed")
        eds = [int(re.sub(r"\D", "", r["Edition"]) or 0) for r in self.st.rows(SSP, "Policy Log")]
        self.st.append(SSP, "Policy Log", [str(max(eds, default=0) + 1), P["amend_param"], val, f["effective"], sender])


def handle(payload: dict, ctx, off=frozenset(), flags=frozenset()) -> None:
    Ref(payload, ctx, off, flags).run()
