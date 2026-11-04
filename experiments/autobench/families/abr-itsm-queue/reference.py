#!/usr/bin/env python3
"""abr-itsm-queue observable-only reference workflow (author-written code, no model). Sees the payload, the policy
constants (family.spec.json) and the tools only; never imports the generator, truth engine, clock engine or oracle;
does its own parsing (N-version against model.py). `Ref(off=..., flags=...)` builds the controls."""
from __future__ import annotations

import calendar
import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE.parents[1]) not in sys.path:
    sys.path.append(str(HERE.parents[1]))
from abr.lib.factory.store import store_for  # noqa: E402

SPEC = json.loads((HERE / "family.spec.json").read_text())
UTC = timezone.utc
CH, CAL, P, ORG = SPEC["channels"], SPEC["calendar"], SPEC["params"], SPEC["org"]
SS, SSP = ORG["ss"], ORG["ss_policy"]
STAMP = re.compile(r"^\s*(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2})?\s*$", re.I)
WORDS = {"high": 1, "medium": 2, "low": 3}
DONE = ("resolved", "closed")


def when(s, offset_as_utc=False):
    m = STAMP.match(str(s or ""))
    if not m:
        return None
    y, mo, d, h, mi, se, zz = m.groups()
    t = datetime(int(y), int(mo), int(d), int(h), int(mi), int(se or 0), tzinfo=UTC)
    if zz and zz.upper() not in ("Z", "UTC", "GMT") and not offset_as_utc:
        sign = -1 if zz[0] == "+" else 1
        t += sign * timedelta(hours=int(zz[1:3]), minutes=int(zz.replace(":", "")[3:5]))
    return t


def z(t):
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def level(s):
    s = str(s or "").strip().lower()
    m = re.match(r"^([123])(\s*-\s*(high|medium|low))?$", s)
    if m:
        return int(m.group(1))
    return WORDS.get(s)


def addr(s):
    m = re.search(r"<([^>]+)>", s or "")
    return (m.group(1) if m else (s or "")).strip().lower()


class Ref:
    def __init__(self, payload, ctx, off=frozenset(), flags=frozenset()):
        self.p, self.st = payload, store_for(ctx)
        self.now = when(payload.get("at"))
        self.off, self.flags = set(off), set(flags)

    def on(self, c):
        return c not in self.off

    def state(self, row, col):
        return "" if "memoryless" in self.flags else row.get(col, "").strip()

    def config(self):
        return {" ".join(r["Setting"].split()): r["Value"].strip() for r in self.st.rows(SS, "Config")}

    def policy(self):
        out = []
        for r in self.st.rows(SSP, "Policy Log"):
            try:
                out.append((" ".join(r["Parameter"].split()).lower(), date.fromisoformat(r["Effective"].strip()),
                            int(re.sub(r"\D", "", r["Edition"]) or 0), int(re.sub(r"\D", "", r["Value"]))))
            except ValueError:
                continue
        return out

    def target(self, pol, prio, d):
        rows = [r for r in pol if r[0] == f"{prio.lower()} target hours"]
        if "trap_stale_policy" in self.flags:
            return rows[0][3]
        return max(r for r in rows if r[1] <= d)[3]

    def run(self):
        ev = (self.p.get("app"), self.p.get("event"))
        if ev == ("schedule", "check"):
            self.check()
        elif ev == ("gmail", "new_email"):
            self.email()
        elif ev == ("google_sheets", "updated_row") and (self.p.get("data") or {}).get("worksheet") == "Incidents":
            self.update()
            if "eager" in self.flags:
                self.check()
        elif "eager" in self.flags:
            self.check()
        self.st.flush()

    # -- updates: pause and resume -------------------------------------------------------------------------------------
    def update(self):
        if not self.on("Q2"):
            return
        iid = ((self.p.get("data") or {}).get("row") or {}).get("Incident ID", "").strip()
        row = next((r for r in self.st.rows(SS, "Incidents") if r["Incident ID"].strip() == iid), None)
        if row is None or row["Priority"].strip() not in ("P1", "P2", "P3", "P4"):
            return
        status, changed = row["Status"].strip().lower(), when(row["Status Changed At"])
        paused = self.state(row, "Paused Since")
        if "trap_no_once" in self.flags and status == "awaiting user":
            paused = ""
        if status == "awaiting user":
            if not paused:
                self.st.set_cells(SS, "Incidents", "Incident ID", iid, {"Paused Since": z(changed)}, row_id=row["_row_id"])
        elif paused:
            due = when(row["SLA Due"]) + (changed - when(paused))
            self.st.set_cells(SS, "Incidents", "Incident ID", iid, {"SLA Due": z(due), "Paused Since": ""}, row_id=row["_row_id"])

    # -- scheduled check ------------------------------------------------------------------------------------------------
    def check(self):
        rows = self.st.rows(SS, "Incidents")
        pol = self.policy()
        hol = {r["Date"].strip() for r in self.st.rows(SS, "Holidays")}
        writes: dict[str, dict] = {}
        for r in rows:
            pr = self.state(r, "Priority")
            if pr not in ("", "UNTRIAGED") or not self.on("Q1"):
                continue
            i, u = level(r["Impact"]), level(r["Urgency"])
            if "trap_partial" in self.flags:
                i, u = i or 3, u or 3
            if i and u:
                prio = {2: "P1", 3: "P2", 4: "P3"}.get(i + u, "P4")
                opened = when(r["Opened At"], "trap_offset_as_utc" in self.flags)
                due = opened + timedelta(hours=self.target(pol, prio, opened.date()))
                writes.setdefault(r["Incident ID"].strip(), {}).update({"Priority": prio, "SLA Due": z(due)})
                r.update({"Priority": prio, "SLA Due": z(due)})
            elif pr == "":
                self.st.post(CH["sink"], f"{self.p.get('trigger')}: {r['Incident ID'].strip()} cannot be triaged (Impact or Urgency unreadable)")
                writes.setdefault(r["Incident ID"].strip(), {})["Priority"] = "UNTRIAGED"
                r["Priority"] = "UNTRIAGED"
        if self.on("Q4"):
            window = timedelta(hours=P["problem_window_hours"])
            norm = (lambda c: c.strip().lower().rstrip("1")) if "trap_lookalike" in self.flags else (lambda c: c.strip())
            cis = {}
            for r in rows:
                cis.setdefault(norm(r["CI"]), []).append(r)
            for ci, rs in sorted(cis.items()):
                has = any(self.state(r, "Problem Ref") for r in rs)
                if "trap_no_window" in self.flags:
                    recent = rs
                else:
                    recent = [r for r in rs if (o := when(r["Opened At"])) is not None and self.now - window < o <= self.now]
                if not has and len(recent) >= P["problem_min"]:
                    name = recent[0]["CI"].strip()
                    self.st.issue("PRB", "Problem", f"Problem: {name}", f"{len(recent)} incidents on {name} in {P['problem_window_hours']} hours")
                    for r in recent:
                        writes.setdefault(r["Incident ID"].strip(), {})["Problem Ref"] = f"PRB:{name}"
                        r["Problem Ref"] = f"PRB:{name}"
                elif has:
                    ref = next(self.state(r, "Problem Ref") for r in rs if self.state(r, "Problem Ref"))
                    for r in recent:
                        if not self.state(r, "Problem Ref"):
                            writes.setdefault(r["Incident ID"].strip(), {})["Problem Ref"] = ref
                            r["Problem Ref"] = ref
        for r in rows:
            pr = r.get("Priority", "").strip()
            if pr not in ("P1", "P2", "P3", "P4") or not self.on("Q3"):
                continue
            if r["Status"].strip().lower() in DONE or self.state(r, "Paused Since") or self.state(r, "Breached At"):
                continue
            due = when(r.get("SLA Due"))
            if due is not None and due <= self.now:
                self.st.post(CH["escalation"], f"BREACHED {r['Incident ID'].strip()} {pr}")
                writes.setdefault(r["Incident ID"].strip(), {})["Breached At"] = z(self.now)
                r["Breached At"] = z(self.now)
        for r in rows:
            iid = r["Incident ID"].strip()
            if iid in writes:
                self.st.set_cells(SS, "Incidents", "Incident ID", iid, writes[iid], row_id=r["_row_id"])
        if self.on("Q7") and self.month_end(hol):
            n = sum(1 for r in rows if (t := when(r.get("Breached At"))) and (t.year, t.month) == (self.now.year, self.now.month))
            m = sum(1 for r in rows if r.get("Priority", "").strip() in ("P1", "P2", "P3", "P4") and r["Status"].strip().lower() not in DONE)
            self.st.post(CH["reports"], f"MONTH-END {self.now:%Y-%m} breached={n} open={m}")

    def month_end(self, hol):
        if self.now.strftime("%H:%M") != CAL["month_end_check"]:
            return False
        d = date(self.now.year, self.now.month, calendar.monthrange(self.now.year, self.now.month)[1])
        while d.weekday() >= 5 or d.isoformat() in hol:
            d -= timedelta(days=1)
        return d == self.now.date()

    # -- email -----------------------------------------------------------------------------------------------------------
    def email(self):
        msg = self.st.message((self.p.get("data") or {}).get("message_id"))
        sender, text = addr(msg.get("from")), f"{msg.get('subject') or ''}\n{msg.get('body_plain') or ''}"
        cfg = self.config()
        if re.search(r"^\s*Parameter\s*:", text, re.M | re.I):
            return self.amendment(sender, text, cfg)
        if re.search(r"\b(approve|approved|reject|rejected)\b", text, re.I):
            return self.cab(sender, text, cfg)

    def authorized(self, sender, want):
        if "trap_no_authority" in self.flags:
            return True
        if "trap_lookalike" in self.flags:
            return re.sub(r"[.\-]", "", sender.split("@")[0]) == re.sub(r"[.\-]", "", want.lower().split("@")[0])
        return sender == want.lower()

    def cab(self, sender, text, cfg):
        if not self.on("Q5"):
            return
        rows = self.st.rows(SS, "Changes")
        ids = [r["Change ID"].strip() for r in rows]
        hit = [i for i in ids if re.search(rf"(?<![\w-]){re.escape(i)}(?![\w-])", text)]
        cid = hit[0] if hit else (re.findall(r"\bCHG\d+\b", text) or [""])[0]
        if not self.authorized(sender, cfg.get("CAB Chair", "")):
            return self.st.post(CH["sink"], f"{self.p.get('trigger')}: CAB decision for {cid} from {sender} is not from the CAB Chair; nothing changed")
        row = next((r for r in rows if r["Change ID"].strip() == cid), None)
        if row is None or (self.state(row, "CAB Status") and "trap_no_once" not in self.flags):
            return
        if re.search(r"\breject(ed)?\b", text, re.I):
            status = "Rejected"
        else:
            p1 = any(r["CI"].strip() == row["CI"].strip() and r["Priority"].strip() == "P1" and r["Status"].strip().lower() not in DONE
                     for r in self.st.rows(SS, "Incidents"))
            status = "On Hold" if p1 and "trap_no_conflict" not in self.flags else "Approved"
        self.st.set_cells(SS, "Changes", "Change ID", cid, {"CAB Status": status, "Decided At": z(self.now)}, row_id=row["_row_id"])
        self.st.post(CH["changes"], f"CHANGE {cid} {status.upper()}")

    def amendment(self, sender, text, cfg):
        if not self.on("Q6") or not self.authorized(sender, cfg.get("Service Owner", "")):
            return
        f = {k.lower(): v.strip() for k, v in re.findall(r"^\s*(Parameter|New value|Effective)\s*:\s*(.+?)\s*$", text, re.M | re.I)}
        val = re.sub(r"\D", "", f.get("new value", ""))
        lo, hi = P["value_range"]
        if not re.fullmatch(r"P[1-4] target hours", " ".join(f.get("parameter", "").split()), re.I) or not val \
                or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", f.get("effective", "")) or not lo <= int(val) <= hi:
            return self.st.post(CH["sink"], f"{self.p.get('trigger')}: amendment from the service owner cannot be applied as written; nothing changed")
        eds = [int(re.sub(r"\D", "", r["Edition"]) or 0) for r in self.st.rows(SSP, "Policy Log")]
        param = " ".join(f["parameter"].split())
        self.st.append(SSP, "Policy Log", [str(max(eds, default=0) + 1), param[0].upper() + param[1:], val, f["effective"], sender])


def handle(payload, ctx, off=frozenset(), flags=frozenset()):
    Ref(payload, ctx, off, flags).run()
