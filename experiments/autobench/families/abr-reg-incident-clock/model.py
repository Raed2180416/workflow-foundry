#!/usr/bin/env python3
"""abr-reg-incident-clock: seeded generator + truth engine (host-only). The truth comes from a typed model of the
business simulated trigger by trigger over LATENT state (datetimes, the generator's own story records), never from
tracker text; the observable-only reference (reference.py) shares the spec, not this code.

    python3 -I model.py --seed 2113 [--out DIR]          # host-only stream files; refuses sealed seeds
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
AB = HERE.parents[1]
if str(AB) not in sys.path:
    sys.path.append(str(AB))

from abr.lib.factory import clock as C  # noqa: E402
from abr.lib.factory import genbase as G  # noqa: E402
from abr.lib.factory import world as W  # noqa: E402

SPEC = json.loads((HERE / "family.spec.json").read_text())
_COMPILED = json.loads((HERE / "compiled.json").read_text())
SPEC.update({k: _COMPILED[k] for k in ("attribution", "hard_clauses", "sink", "controls")})
FAMILY, VERSION = SPEC["id"], SPEC["version"]
UTC = timezone.utc
ORG, CH, CAL, P = SPEC["org"], SPEC["channels"], SPEC["calendar"], SPEC["params"]
HOL = json.loads((AB / "abr" / "lib" / "factory" / "holidays.json").read_text())["tables"][CAL["holidays"]]
HOLS = frozenset(HOL)
TZ = CAL["tz"]
SS, SSP = ORG["ss_incidents"], ORG["ss_policy"]
INC = SPEC["sheets"]["Incidents"]
REPORTS = SPEC["reports"]
APPS = SPEC["host"]["apps"]
SEALED = range(8850, 8874)
LEAD_PARAM = P["amend_param"]


def lead_in_force(rows: list[dict], now: datetime) -> int:
    """Truth side: rows are (edition, value, effective date) tuples kept by the model."""
    live = [r for r in rows if r["eff"] <= now.date()]
    return max(live, key=lambda r: (r["eff"], r["ed"]))["val"]


def final_due(notified: datetime) -> datetime:
    local_day = notified.astimezone(C.ZoneInfo(TZ)).date()
    d = C.roll_forward(C.add_months_clipped(local_day, P["final_months"]), HOLS)
    return C.end_of_local_day(d, TZ)


def final_traps(notified: datetime) -> set:
    """Where a solver ignoring one rule of the final-report clock would write a different Final Due."""
    local_day = notified.astimezone(C.ZoneInfo(TZ)).date()
    m = C.add_months_clipped(local_day, P["final_months"])
    d = C.roll_forward(m, HOLS)
    out = set()
    if m != local_day + timedelta(days=30):
        out.add("T-clock:month-end")          # month arithmetic (same date, clipped) differs from 30 days
    if d != m:
        out.add("T-clock:roll")
    if C.end_of_local_day(d, TZ).astimezone(C.ZoneInfo(TZ)).utcoffset() != timedelta(hours=1):
        out.add("T-clock:dst")
    return out


class Gen(G.Gen):
    FAMILY, VERSION, SPEC = FAMILY, VERSION, SPEC

    # -- plan ---------------------------------------------------------------------------------------------------------
    def plan(self):
        r = self.rng
        mondays = [date(2027, 1, 4) + timedelta(weeks=k) for k in range(1, 47)]
        dst = [m for m in mondays if date(2027, 3, 8) <= m <= date(2027, 3, 22) or date(2027, 10, 11) <= m <= date(2027, 10, 25)]
        start = r.choice(dst) if r.random() < 0.35 else r.choice(mondays)
        start += timedelta(days=self.shift_days)
        self.start = start
        self.start_dt = datetime(start.year, start.month, start.day, tzinfo=UTC)
        self.days = [start + timedelta(days=k) for k in range(28)]
        self.checks = C.check_times(start, 28, CAL["checks_utc"], HOLS)
        self.month_end_days = C.month_ends_in(self.days, HOLS)
        self.idp = "INC-SEC-" if not self.rename else "SEC-INC-"
        self.incs: list[dict] = []
        self.policy = [{"ed": 0, "val": P["lead_hours"]["stale"], "eff": date(2025, 6, 1)},
                       {"ed": 1, "val": P["lead_hours"]["edition1"], "eff": date(2026, 1, 1)}]
        self.policy_rows_order = [1, 0] if r.random() < 0.5 else [0, 1]
        self.used_ids: set = set()
        for k in range(r.randint(3, 4)):
            self.pre_existing(k)
        n_new = r.randint(8, 11)
        for k in range(n_new):
            self.new_incident(k)
        self.plan_emails()
        for t in self.checks:
            me = t.date() in self.month_end_days and t.strftime("%H:%M") == CAL["month_end_check"]
            self.event(t, "check", "schedule", "check", {"schedule": f"{', '.join(CAL['checks_utc'])} UTC, working days"},
                       [], (), "month-end" if me else "tick", month_end=me)

    def new_id(self) -> str:
        while True:
            n = self.rng.randint(300, 980)
            i = f"{self.idp}{n:04d}"
            if i not in self.used_ids:
                self.used_ids.add(i)
                return i

    def render_aware(self, t: datetime) -> tuple[str, list]:
        style = self.rng.choices(["local", "z", "utc", "us"], [0.55, 0.2, 0.15, 0.1])[0]
        if style == "local":
            s = C.render_local(t, TZ)
            return s, (["T-clock:offset"] if not s.endswith("+00:00") else [])
        if style == "z":
            return C.iso_z(t), []
        if style == "utc":
            return t.strftime("%Y-%m-%d %H:%M UTC"), []
        return C.render_local(t, "America/New_York"), ["T-clock:offset"]

    def biz_time(self, day: date, lo=8, hi=18) -> datetime:
        return datetime(day.year, day.month, day.day, self.rng.randint(lo, hi - 1), self.rng.randrange(0, 60, 5), tzinfo=UTC)

    def inc(self, iid, title, aware, opened, sig_timeline, sent, status_timeline=(), pre=False, traps=(), state=None):
        sent = {k: v.replace(microsecond=0) for k, v in dict(sent).items()}
        sig_timeline = [(t.replace(microsecond=0), v) for t, v in sig_timeline]
        aware_text, tr = self.render_aware(aware)
        x = {"id": iid, "title": title, "aware": aware, "aware_text": aware_text, "opened": opened,
             "sig": list(sig_timeline), "sent": dict(sent), "status": list(status_timeline) or [(opened, "Open")],
             "pre": pre, "traps": list(traps) + tr, "rid": f"inc{len(self.incs):02d}s{self.seed}",
             "due": {}, "reminded": {}, "overdue": {}, "retracted": None, "sent_rendered": {}}
        for k, v in (state or {}).items():
            x[k] = v
        self.incs.append(x)
        return x

    TITLES = ["Ransomware on file server", "Credential stuffing on customer portal", "DDoS on payment API",
              "Misdirected bulk email", "Compromised admin account", "Data exfiltration alert", "Supply-chain update tampering",
              "Outage of OT gateway", "Phishing with account takeover", "Leaked API key in public repo"]

    def pre_existing(self, k: int):
        r = self.rng
        iid = self.new_id()
        kind = ["closed", "final-pending", "backfill", "not-significant"][k % 4]
        if kind == "backfill":
            # notification sent before the stream; Notification Sent At recorded late (week 1): the final clock starts in-stream
            day = r.choice([d for d in (self.start - timedelta(days=x) for x in range(26, 34)) if d.day >= 27] or
                           [self.start - timedelta(days=r.randint(26, 33))])
            notified = self.biz_time(day, 9, 17)
            aware = notified - timedelta(hours=r.randint(30, 66))
            mark = self.biz_time(self.days[r.randint(1, 4)], 9, 17)
            x = self.inc(iid, r.choice(self.TITLES), aware, aware + timedelta(hours=1), [(aware, "Yes")],
                         {"EARLY-WARNING": aware + timedelta(hours=r.randint(3, 20)), "NOTIFICATION": notified}, pre=True)
            x["mark"] = {"NOTIFICATION": mark}
            x["due"] = {"EARLY-WARNING": aware + timedelta(hours=24), "NOTIFICATION": aware + timedelta(hours=72)}
            x["story"] = "backfill"
        elif kind == "final-pending":
            notified = self.biz_time(self.start - timedelta(days=r.randint(20, 30)), 9, 17)
            aware = notified - timedelta(hours=r.randint(20, 60))
            x = self.inc(iid, r.choice(self.TITLES), aware, aware + timedelta(hours=2), [(aware, "Yes")],
                         {"EARLY-WARNING": aware + timedelta(hours=r.randint(2, 22)), "NOTIFICATION": notified}, pre=True)
            x["due"] = {"EARLY-WARNING": aware + timedelta(hours=24), "NOTIFICATION": aware + timedelta(hours=72),
                        "FINAL": final_due(notified)}
            fd = x["due"]["FINAL"]
            if r.random() < 0.5 and fd > self.start_dt + timedelta(days=2):
                x["sent"]["FINAL"] = fd - timedelta(hours=r.randint(2, 30))
            x["story"] = "final-pending"
        elif kind == "closed":
            notified = self.biz_time(self.start - timedelta(days=r.randint(40, 60)), 9, 17)
            aware = notified - timedelta(hours=40)
            final = final_due(notified) - timedelta(days=2)
            x = self.inc(iid, r.choice(self.TITLES), aware, aware + timedelta(hours=1), [(aware, "Yes")],
                         {"EARLY-WARNING": aware + timedelta(hours=10), "NOTIFICATION": notified, "FINAL": final},
                         [(aware, "Closed")], pre=True)
            x["due"] = {"EARLY-WARNING": aware + timedelta(hours=24), "NOTIFICATION": aware + timedelta(hours=72),
                        "FINAL": final_due(notified)}
            x["story"] = "closed"
        else:
            aware = self.biz_time(self.start - timedelta(days=r.randint(3, 9)))
            x = self.inc(iid, r.choice(self.TITLES), aware, aware + timedelta(hours=1), [(aware, "No")], {}, pre=True)
            x["story"] = "not-significant"
        if k == 0:
            # a look-alike id pair: a closed old incident whose id is a prefix of a live one
            twin = iid + str(r.randint(0, 9))
            self.used_ids.add(twin)
            x["twin"] = twin

    def new_incident(self, k: int):
        r = self.rng
        iid = self.new_id()
        story = r.choices(["prompt", "late-ew", "late-notif", "confirmed-later", "weekend", "not-significant", "retract-after",
                           "retract-early"], [3, 2, 2, 2, 2, 1, 1, 1])[0]
        if k == 0:
            story = "retract-after"
        if k == 1:
            story = "weekend"
        day = self.days[r.randint(0, 20)]
        if story == "weekend":
            fri = next(d for d in self.days[r.choice([0, 7, 14]):] if d.weekday() == 4)
            aware = datetime(fri.year, fri.month, fri.day, r.randint(17, 23), r.randrange(0, 60, 5), tzinfo=UTC)
        else:
            aware = datetime(day.year, day.month, day.day, r.randint(0, 22), r.randrange(0, 60, 5), tzinfo=UTC)
        opened = aware + timedelta(minutes=r.randint(20, 300))
        sig = [(opened, "Yes")]
        sent = {}
        if story in ("prompt", "retract-after", "weekend"):
            sent["EARLY-WARNING"] = aware + timedelta(hours=r.choice([r.uniform(2, 14), r.uniform(14, 23.5)]))
            sent["NOTIFICATION"] = aware + timedelta(hours=r.uniform(26, 71))
            if story == "weekend" and r.random() < 0.5:
                sent.pop("EARLY-WARNING")
                sent["EARLY-WARNING"] = aware + timedelta(hours=r.uniform(60, 70))
        elif story == "late-ew":
            sent["EARLY-WARNING"] = aware + timedelta(hours=r.uniform(26, 50))
            sent["NOTIFICATION"] = aware + timedelta(hours=r.uniform(55, 71))
        elif story == "late-notif":
            sent["EARLY-WARNING"] = aware + timedelta(hours=r.uniform(3, 20))
            if r.random() < 0.6:
                sent["NOTIFICATION"] = aware + timedelta(hours=r.uniform(75, 110))
        elif story == "confirmed-later":
            sig = [(opened, "Pending"), (opened + timedelta(hours=r.uniform(20, 60)), "Yes")]
            sent["EARLY-WARNING"] = sig[1][0] + timedelta(hours=r.uniform(1, 6))
            sent["NOTIFICATION"] = sig[1][0] + timedelta(hours=r.uniform(8, 30))
        elif story == "not-significant":
            sig = [(opened, "Pending"), (opened + timedelta(hours=r.uniform(6, 40)), "No")]
        elif story == "retract-early":
            pass
        x = self.inc(iid, r.choice(self.TITLES), aware, opened, sig, sent)
        x["story"] = story
        if story in ("retract-after", "retract-early"):
            base = sent.get("EARLY-WARNING", opened + timedelta(hours=2))
            x["retract_at"] = (base + timedelta(hours=r.uniform(1, 30)) if story == "retract-after"
                               else opened + timedelta(hours=r.uniform(2, 10))).replace(microsecond=0)
        return x

    def plan_emails(self):
        r = self.rng
        week3 = [d for d in self.days[14:21] if C.is_business_day(d, HOLS)]
        amend_day = r.choice(week3[1:3] or week3)
        at = self.biz_time(amend_day, 9, 15)
        if r.random() < 0.6:
            eff = amend_day
        else:
            eff = amend_day + timedelta(days=(7 - amend_day.weekday()))
        self.email_event(at, ORG["owner"], ORG["inbox"], "Reporting policy edition 2",
                         f"Hello,\n\nPolicy edition 2 of the reporting automation:\n\nParameter: {LEAD_PARAM}\n"
                         f"New value: {P['lead_hours']['edition2']}\nEffective: {eff.isoformat()}\n\nThanks,\nCompliance\n",
                         ["T-stale"], "amendment", amend={"val": P["lead_hours"]["edition2"], "eff": eff, "ok": True})
        # an unauthorized amendment (week 2) and, in half the streams, an out-of-range one from the owner (week 4)
        bad_from = r.choice(ORG["lookalike_owner"] + ["soc-lead@nordwerk.example.com"])
        self.email_event(self.biz_time(self.days[r.randint(7, 11)], 9, 16), bad_from, ORG["inbox"], "Reminder lead time",
                         f"Hi,\n\nParameter: {LEAD_PARAM}\nNew value: 2\nEffective: {self.days[8].isoformat()}\n",
                         ["T-authority", "T-lookalike"] if "nordwerk" in bad_from and bad_from != "soc-lead@nordwerk.example.com"
                         else ["T-authority"], "amendment-unauthorized", amend={"ok": False})
        if r.random() < 0.5:
            self.email_event(self.biz_time(self.days[r.randint(22, 25)], 9, 15), ORG["owner"], ORG["inbox"], "Lead time",
                             f"Parameter: {LEAD_PARAM}\nNew value: 72\nEffective: {self.days[24].isoformat()}\n",
                             ["T-authority"], "amendment-out-of-range", amend={"val": 72, "ok": "range"})
        # retractions
        for x in self.incs:
            if x.get("retract_at"):
                t = x["retract_at"]
                self.email_event(t, ORG["ciso"], ORG["inbox"], f"Retract {x['id']}",
                                 f"Please retract {x['id']}: our assessment is that it is not significant after all.\n\nCISO\n",
                                 ["T-retract"], "retract", target=x["id"])
                if r.random() < 0.5:
                    self.email_event(t + timedelta(hours=r.uniform(2, 20)), ORG["ciso"], ORG["inbox"], f"Re: Retract {x['id']}",
                                     f"Re-sending: please retract {x['id']}.\n", ["T-repeat"], "retract-repeat", target=x["id"])
        live = [x for x in self.incs if not x["pre"] and not x.get("retract_at") and x["story"] != "not-significant"]
        if live:
            x = r.choice(live)
            frm = r.choice(ORG["lookalike_ciso"] + ["soc-analyst@nordwerk.example.com"])
            self.email_event(max(x["opened"] + timedelta(hours=3), self.start_dt + timedelta(hours=9)), frm, ORG["inbox"],
                             f"Retract {x['id']}", f"Please retract {x['id']}, it was a false positive.\n",
                             ["T-authority"] + (["T-lookalike"] if frm in ORG["lookalike_ciso"] else []),
                             "retract-unauthorized", target=x["id"])
        twin = next((x for x in self.incs if x.get("twin")), None)
        if twin and r.random() < 0.7:
            self.email_event(self.biz_time(self.days[r.randint(2, 18)]), ORG["ciso"], ORG["inbox"], f"Retract {twin['twin']}",
                             f"Please retract {twin['twin']}.\n", ["T-lookalike"], "retract-unknown", target=twin["twin"])
        for k in range(r.randint(1, 3)):
            self.email_event(self.biz_time(self.days[r.randint(0, 25)]), "newsletter@threatwatch.example.org", ORG["inbox"],
                             "Weekly threat digest", "Top advisories this week. Nothing to retract or amend.\n", [], "noise")

    # -- events for incidents ------------------------------------------------------------------------------------------
    def human_cells(self, x: dict, at: datetime) -> dict:
        sig = [v for t, v in x["sig"] if t <= at]
        st = [v for t, v in x["status"] if t <= at]
        cells = {"Incident ID": x["id"], "Title": x["title"], "Aware At": x["aware_text"],
                 "Significant": (sig[-1] if sig else "Pending"), "Status": (st[-1] if st else "Open")}
        for rep in REPORTS:
            t = self.sent_mark(x, rep["name"])
            cells[rep["sent"]] = x["sent_rendered"].setdefault(rep["name"], self.render_sent(x["sent"][rep["name"]])) \
                if t is not None and t <= at else ""
        return cells

    def render_sent(self, t: datetime) -> str:
        return C.iso_z(t) if self.rng.random() < 0.6 else C.render_local(t, TZ)

    def sent_mark(self, x, rep):
        if rep not in x["sent"]:
            return None
        return x.get("mark", {}).get(rep, x["sent"][rep])

    def triggers(self):
        for x in self.incs:
            if not x["pre"]:
                self.event(x["opened"], "opened", "google_sheets", "new_row",
                           {"spreadsheet_id": SS, "worksheet": "Incidents", "row": self.human_cells(x, x["opened"])},
                           [{"op": "insert_row", "ss": SS, "sheet": "Incidents", "rid": x["rid"],
                             "cells": self.human_cells(x, x["opened"])}], (), x["story"])
            changes = sorted({t for t, _ in x["sig"][1:]} | {self.sent_mark(x, r["name"]) for r in REPORTS if r["name"] in x["sent"]}
                             | {t for t, _ in x["status"][1:]})
            for t in changes:
                if t is None or t <= (self.start_dt if x["pre"] else x["opened"]) or t >= self.start_dt + timedelta(days=26):
                    continue
                cells = self.human_cells(x, t)
                self.event(t, "updated", "google_sheets", "updated_row",
                           {"spreadsheet_id": SS, "worksheet": "Incidents", "row": cells},
                           [{"op": "update_row", "ss": SS, "sheet": "Incidents", "key_col": "Incident ID", "key": x["id"],
                             "cells": cells}], (), x["story"])
        # nothing after the last check
        last = self.checks[-1]
        self.events = [e for e in self.events if e["at"] <= last]
        return super().triggers()

    # -- world0 -----------------------------------------------------------------------------------------------------------
    def world0(self) -> dict:
        t0 = self.start_dt
        rows = []
        for x in self.incs:
            if not x["pre"]:
                continue
            c = self.human_cells(x, t0 - timedelta(minutes=1))
            for rep in REPORTS:
                n = rep["name"]
                c[rep["due"]] = C.iso_z(x["due"][n]) if n in x["due"] else ""
                c[rep["reminded"]] = ""
                c[rep["overdue"]] = ""
            c["Retracted At"] = ""
            rows.append((x["rid"], c))
            if x.get("twin"):
                rows.append((f"twin{self.seed}", {"Incident ID": x["twin"], "Title": "Lost laptop (encrypted)",
                                                  "Aware At": C.iso_z(t0 - timedelta(days=50)), "Significant": "No",
                                                  "Status": "Closed"}))
                self.world_traps.append("T-lookalike")
        cfg = [("Former CISO (until 2026-06-30)", "ciso-office@nordwerk.example.com"), ("Policy Owner", ORG["owner"]),
               ("CISO", ORG["ciso"]), ("Regulator Liaison", ORG["liaison"]), ("Reporting Channel", "#" + CH["report"]),
               ("Review Channel", "#" + CH["sink"]), ("Check Schedule", ", ".join(CAL["checks_utc"]) + " UTC, working days"),
               ("Calendar Time Zone", TZ)]
        pol = {0: ("0", LEAD_PARAM, str(P["lead_hours"]["stale"]), "2025-06-01", "ciso-office@nordwerk.example.com"),
               1: ("1", LEAD_PARAM, str(P["lead_hours"]["edition1"]), "2026-01-01", ORG["owner"])}
        sheets = W.sheets([
            {"id": SS, "title": "Incident Register", "worksheets": [
                {"id": INC["ws"], "title": "Incidents", "headers": INC["human"] + INC["state"], "rows": rows},
                {"id": "ws-config", "title": "Config", "headers": ["Setting", "Value"],
                 "rows": [(f"cfg{i:02d}", {"Setting": a, "Value": b}) for i, (a, b) in enumerate(cfg)]},
                {"id": "ws-holidays", "title": "Holidays", "headers": ["Date", "Name"],
                 "rows": [(f"hol{i:02d}", {"Date": d, "Name": n}) for i, (d, n) in enumerate(sorted(HOL.items()))]}]},
            {"id": SSP, "title": "Reporting Policy Log", "worksheets": [
                {"id": "ws-policy", "title": "Policy Log", "headers": ["Edition", "Parameter", "Value", "Effective", "Approved by"],
                 "rows": [(f"pol{i}", dict(zip(["Edition", "Parameter", "Value", "Effective", "Approved by"], pol[i])))
                          for i in self.policy_rows_order]}]}])
        users = [W.slack_user("U0REGBOT01", "reg-bot", "Reg Automation", is_bot=True),
                 W.slack_user("U0CISO0001", "ciso", "Dana Krüger", ORG["ciso"]),
                 W.slack_user("U0COMPL001", "compliance", "Jonas Albers", ORG["owner"])]
        cids = {CH["report"]: "C0REGREP01", CH["sink"]: "C0AUTOREV1", CH["general"]: "C0SECGEN01"}
        chans = [W.slack_channel(cid, name, [u["id"] for u in users], name) for name, cid in cids.items()]
        hist = t0 - timedelta(days=3, hours=-9)
        msgs = [W.slack_message(f"{int(hist.timestamp())}.100100", cids[CH["general"]], "U0CISO0001",
                                "Reminder: mark reports sent in the register the moment they go out.",
                                hist.replace(tzinfo=None).isoformat())]
        mails = [W.gmail_message(self.hexid(), self.hexid(), ORG["owner"], [ORG["inbox"]], "Reporting automation live",
                                 "The reporting automation runs at the scheduled checks. Policy changes come by email.",
                                 int((t0 - timedelta(days=20)).timestamp() * 1000), is_read=True)]
        return {"meta": {"schema_version": "0.1.0", "current_time": C.iso_z(t0), "allowed_services": sorted(APPS), "no_same_sender_noise": False},
                "google_sheets": sheets, "slack": {"channels": chans, "messages": msgs, "users": users, "dms": []},
                "gmail": {"messages": mails, "labels": [], "drafts": [], "attachments": [], "threads": []}}

    # -- truth engine ------------------------------------------------------------------------------------------------------
    def cells_eff(self, x, cells: dict, clause: str, instants=True) -> dict:
        return {"t": "cells", "ss": SS, "ws_id": INC["ws"], "sheet": "Incidents", "key_col": "Incident ID", "key": x["id"],
                "cells": cells, "instants": list(cells) if instants else [], "clause": clause}

    def post(self, text, clause, channel=None):
        return {"t": "post", "channel": channel or CH["report"], "text": text, "clause": clause}

    def visible(self, x, now):
        return x["pre"] or x["opened"] <= now

    def sig_at(self, x, now):
        v = [s for t, s in x["sig"] if t <= now]
        return (v[-1] if v else "Pending").lower()

    def sent_at(self, x, rep, now):
        t = self.sent_mark(x, rep)
        return t is not None and t <= now

    def decide(self, trig):
        e = trig["_e"]
        now = datetime.fromisoformat(trig["at"].replace("Z", "+00:00"))
        info = {}
        if e["kind"] == "check":
            return self.decide_check(now, e, info), info
        if e["kind"] == "email":
            return self.decide_email(now, e, trig, info), info
        return [], info

    def decide_check(self, now, e, info):
        out = []
        tr = info.setdefault("traps", set())
        lead = timedelta(hours=lead_in_force(self.policy, now))
        for x in self.incs:
            if not self.visible(x, now):
                continue
            running = self.sig_at(x, now) == "yes" and x["retracted"] is None
            if not running:
                continue
            cells = {}
            if "EARLY-WARNING" not in x["due"]:
                x["due"]["EARLY-WARNING"] = x["aware"] + timedelta(hours=P["ew_hours"])
                x["due"]["NOTIFICATION"] = x["aware"] + timedelta(hours=P["notification_hours"])
                cells["EW Due"] = C.iso_z(x["due"]["EARLY-WARNING"])
                cells["Notification Due"] = C.iso_z(x["due"]["NOTIFICATION"])
                out.append(self.post(f"CLOCK {x['id']} EARLY-WARNING {cells['EW Due']} NOTIFICATION {cells['Notification Due']}", "R1"))
                tr.update(t for t in x["traps"] if t == "T-clock:offset")
            if self.sent_at(x, "NOTIFICATION", now) and "FINAL" not in x["due"]:
                x["due"]["FINAL"] = final_due(x["sent"]["NOTIFICATION"])
                cells["Final Due"] = C.iso_z(x["due"]["FINAL"])
                out.append(self.post(f"CLOCK {x['id']} FINAL {cells['Final Due']}", "R1"))
                tr.update(final_traps(x["sent"]["NOTIFICATION"]))
            for rep in REPORTS:
                n = rep["name"]
                if n not in x["due"] or self.sent_at(x, n, now):
                    continue
                due = x["due"][n]
                if due <= now:
                    if n not in x["overdue"]:
                        x["overdue"][n] = now
                        cells[rep["overdue"]] = C.iso_z(now)
                        out.append(self.post(f"OVERDUE {x['id']} {n}", "R3"))
                        out.append({"t": "mail", "to": ORG["ciso"], "subject": f"OVERDUE {x['id']} {n}", "clause": "R3"})
                        if n != "FINAL":
                            tr.update(t for t in x["traps"] if t == "T-clock:offset")
                    else:
                        info["needs_state"] = True
                elif due - now <= lead:
                    if n not in x["reminded"]:
                        x["reminded"][n] = now
                        cells[rep["reminded"]] = C.iso_z(now)
                        out.append(self.post(f"DUE {x['id']} {n} {C.iso_z(due)}", "R2"))
                        if due - now > timedelta(hours=P["lead_hours"]["stale"]):
                            tr.add("T-stale")
                        if n != "FINAL":
                            tr.update(t for t in x["traps"] if t == "T-clock:offset")
                        elif "NOTIFICATION" in x["sent"]:
                            tr.update(final_traps(x["sent"]["NOTIFICATION"]))
                    else:
                        info["needs_state"] = True
            if cells:
                # one cells effect per row; clause of the row write = the first clause that wrote here
                cl = "R1" if any(k.endswith("Due") for k in cells) else ("R3" if any("Overdue" in k for k in cells) else "R2")
                out.append(self.cells_eff(x, cells, cl))
        if e.get("month_end"):
            n_open = sum(1 for x in self.incs if self.visible(x, now) and self.sig_at(x, now) == "yes"
                         and x["retracted"] is None and self.status_at(x, now) != "closed")
            m = sum(1 for x in self.incs for t in x["overdue"].values() if (t.year, t.month) == (now.year, now.month))
            out.append(self.post(f"MONTH-END {now:%Y-%m} open={n_open} overdue={m}", "R6"))
        return out

    def status_at(self, x, now):
        v = [s for t, s in x["status"] if t <= now]
        return (v[-1] if v else "Open").lower()

    def decide_email(self, now, e, trig, info):
        sub, frm = e["sub"], e["data"]["from"]
        if sub.startswith("amendment"):
            a = e["amend"]
            if frm != ORG["owner"]:
                return []
            if a["ok"] == "range":
                return [{"t": "post", "channel": CH["sink"], "contains": [trig["trigger"]], "clause": "R5"}]
            ed = max(r["ed"] for r in self.policy) + 1
            self.policy.append({"ed": ed, "val": a["val"], "eff": a["eff"]})
            return [{"t": "append", "ss": SSP, "ws_id": "ws-policy", "sheet": "Policy Log",
                     "cells": {"Edition": str(ed), "Parameter": LEAD_PARAM, "Value": str(a["val"]),
                               "Effective": a["eff"].isoformat(), "Approved by": ORG["owner"]}, "clause": "R5"}]
        if sub.startswith("retract"):
            target = e["target"]
            x = next((i for i in self.incs if i["id"] == target), None)
            if frm != ORG["ciso"]:
                return [{"t": "post", "channel": CH["sink"], "contains": [trig["trigger"], target], "clause": "R4"}]
            if x is None or not self.visible(x, now) or self.sig_at(x, now) != "yes":
                return []
            if x["retracted"] is not None:
                info["needs_state"] = True
                return []
            x["retracted"] = now
            out = [self.cells_eff(x, {"Retracted At": C.iso_z(now)}, "R4"), self.post(f"RETRACT {x['id']}", "R4")]
            info["traps"] = {"T-retract"}
            if self.sent_at(x, "EARLY-WARNING", now) or self.sent_at(x, "NOTIFICATION", now):
                out.append({"t": "mail", "to": ORG["liaison"], "subject": f"Retraction {x['id']}", "clause": "R4"})
            return out
        return []

    def end_tables(self):
        rows = {}
        for x in self.incs:
            c = {}
            for rep in REPORTS:
                n = rep["name"]
                c[rep["due"]] = C.iso_z(x["due"][n]) if n in x["due"] else ""
                c[rep["reminded"]] = C.iso_z(x["reminded"][n]) if n in x["reminded"] else ""
                c[rep["overdue"]] = C.iso_z(x["overdue"][n]) if n in x["overdue"] else ""
            c["Retracted At"] = C.iso_z(x["retracted"]) if x["retracted"] else ""
            rows[x["id"]] = c
        n_pol = len(self.policy)
        return [{"ss": SS, "sheet": "Incidents", "key_col": "Incident ID", "rows": rows,
                 "instants": INC["state"], "clause": "R1"},
                {"ss": SSP, "sheet": "Policy Log", "key_col": "Edition", "rows": {str(r["ed"]): {"Value": str(r["val"])} for r in self.policy},
                 "count": n_pol, "clause": "R5"}]


def generate(seed: int, rename: bool = False, shift_days: int = 0, allow_sealed: bool = False) -> dict:
    if seed in SEALED and not allow_sealed:
        raise SystemExit(f"seed {seed} is sealed (SEED-LEDGER factory-v-sealed): only experiments/breadth/factory/seal.py generates it")
    return Gen(seed, rename, shift_days).run()


def serve_input(seed: int, trigger: dict, intake: str = "policy", intake_text: str | None = None) -> dict:
    policy = (HERE / "POLICY.md").read_text()
    return G.serve_input(FAMILY, policy, APPS, seed, trigger, intake_text if intake == "messy" else None)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--out")
    a = ap.parse_args()
    out = generate(a.seed)
    if a.out:
        d = Path(a.out)
        d.mkdir(parents=True, exist_ok=True)
        for k in ("world0", "end", "meta"):
            (d / f"{k}.json").write_text(json.dumps(out[k], indent=1, default=str) + "\n")
        for k in ("triggers", "truth"):
            (d / f"{k}.jsonl").write_text("".join(json.dumps(x, default=str) + "\n" for x in out[k]))
    print(json.dumps(out["meta"], default=str))
