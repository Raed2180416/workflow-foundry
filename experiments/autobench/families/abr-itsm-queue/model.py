#!/usr/bin/env python3
"""abr-itsm-queue: seeded generator + truth engine (host-only). Arrival weekday shares, the priority mix (tempered),
the pause share and resolution-time quantiles are parameters mined from the UCI incident log (ID 498, CC BY 4.0;
research/breadth-20261021/factory/params/uci-498-params.json); every record is fictional. The truth is computed over
LATENT state (typed incidents and the model's own state of record), never from tracker text.

    python3 -I model.py --seed 2113 [--out DIR]
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
SS, SSP = ORG["ss"], ORG["ss_policy"]
INC = SPEC["sheets"]["Incidents"]
APPS = SPEC["host"]["apps"]
SEALED = range(8850, 8874)
# UCI 498 parameters (uci-498-params.json): weekday shares Mon..Sun; resolution-hour quantiles p10..p90 per priority
WEEKDAY = [0.2387, 0.1987, 0.196, 0.1647, 0.1537, 0.0256, 0.0226]
RESOLVE_Q = {"P1": [2.6, 17.38, 80.24, 274.51, 616.44], "P2": [1.23, 5.17, 38.23, 200.72, 381.57],
             "P3": [0.1, 0.4, 21.55, 146.68, 374.61], "P4": [0.03, 0.15, 5.02, 162.8, 502.3]}
LOG_MIX = {"P1": 0.0108, "P2": 0.0164, "P3": 0.9417, "P4": 0.0311}
MIX = {k: v ** 0.5 for k, v in LOG_MIX.items()}                        # tempered (sqrt) so P1/P2 occur at all
PAUSE_SHARE = 0.2338
LEVEL = {1: "High", 2: "Medium", 3: "Low"}
CIS = ["db-prod-01", "web-gw-02", "erp-app-03", "mail-relay-01", "vpn-edge-02", "k8s-node-07", "print-srv-01"]
LOOK = "db-prod-011"
PRIO = {2: "P1", 3: "P2", 4: "P3", 5: "P4", 6: "P4"}


def target_in_force(policy: list[dict], prio: str, d: date) -> int:
    rows = [r for r in policy if r["param"] == f"{prio} target hours" and r["eff"] <= d]
    return max(rows, key=lambda r: (r["eff"], r["ed"]))["val"]


class Gen(G.Gen):
    FAMILY, VERSION, SPEC = FAMILY, VERSION, SPEC

    def plan(self):
        r = self.rng
        start = date(2027, 1, 4) + timedelta(weeks=r.randint(1, 46), days=self.shift_days)
        self.start, self.start_dt = start, datetime(start.year, start.month, start.day, tzinfo=UTC)
        self.days = [start + timedelta(days=k) for k in range(28)]
        self.checks = C.check_times(start, 28, CAL["checks_utc"], HOLS)
        self.month_end_days = C.month_ends_in(self.days, HOLS)
        self.idp = "INC" if not self.rename else "TKT"
        self.cis = CIS if not self.rename else [c.replace("prod", "live") for c in CIS]
        self.look = LOOK if not self.rename else LOOK.replace("prod", "live")
        self.policy = [{"ed": 0, "param": "P3 target hours", "val": P["targets_stale"]["P3"], "eff": date(2025, 3, 1)}] + \
                      [{"ed": 1, "param": f"{k} target hours", "val": v, "eff": date(2026, 1, 1)} for k, v in P["targets"].items()]
        self.incs, self.changes, self.used = [], [], set()
        self.seq = r.randint(41000, 47000)
        for _ in range(r.randint(4, 6)):
            self.incident(pre=True)
        n_per_week = [r.randint(9, 12) for _ in range(4)]
        for w, n in enumerate(n_per_week):
            for _ in range(n):
                self.incident(week=w)
        self.burst()
        self.partial()
        self.plan_changes()
        self.plan_emails()
        for t in self.checks:
            me = t.date() in self.month_end_days and t.strftime("%H:%M") == CAL["month_end_check"]
            self.event(t, "check", "schedule", "check", {"schedule": f"{', '.join(CAL['checks_utc'])} UTC, working days"},
                       [], (), "month-end" if me else "tick", month_end=me)

    def next_id(self):
        self.seq += self.rng.randint(1, 37)
        return f"{self.idp}{self.seq:07d}"

    def first_check_after(self, t):
        return next((c for c in self.checks if c > t), None)

    def sample_resolve(self, prio):
        q = RESOLVE_Q[prio]
        u = self.rng.random() * 4
        k = min(3, int(u))
        return max(0.2, q[k] + (q[k + 1] - q[k]) * (u - k))

    def render_open(self, t):
        if self.rng.random() < 0.25:
            s = C.render_local(t, "Europe/London")
            return s, ([] if s.endswith("+00:00") else ["T-format"])
        return C.iso_z(t), []

    def render_level(self, v):
        if v is None:
            return ""
        return self.rng.choice([str(v), f"{v} - {LEVEL[v]}", LEVEL[v]])

    def incident(self, pre=False, week=0, at=None, ci=None, prio=None, story="plain"):
        r = self.rng
        prio = prio or r.choices(list(MIX), list(MIX.values()))[0]
        s = {"P1": 2, "P2": 3, "P3": 4, "P4": r.choice([5, 6])}[prio]
        pairs = [(i, s - i) for i in (1, 2, 3) if 1 <= s - i <= 3]
        imp, urg = r.choice(pairs)
        if at is None:
            if pre:
                at = self.start_dt - timedelta(hours=r.uniform(4, 200))
            else:
                wd = r.choices(range(7), WEEKDAY)[0]
                day = self.days[7 * week + wd]
                at = datetime(day.year, day.month, day.day, r.randint(7, 19), r.randrange(0, 60), tzinfo=UTC)
        ci = ci or r.choices(self.cis, [4, 2, 2, 1, 1, 1, 1])[0]
        at = at.replace(second=0, microsecond=0)          # Opened At is rendered to the minute in local style
        otext, tr = self.render_open(at)
        x = {"id": self.next_id(), "opened": at, "opened_text": otext, "imp": imp, "urg": urg,
             "imp_text": self.render_level(imp), "urg_text": self.render_level(urg), "ci": ci, "prio_true": prio,
             "desc": r.choice(["Users cannot log in", "Slow responses", "Job failed overnight", "Disk nearly full",
                               "Certificate warning", "Intermittent 502s", "Queue backlog growing"]),
             "pre": pre, "traps": tr, "story": story, "rid": f"inc{len(self.incs):03d}s{self.seed}",
             "status": [(at, "New", at)], "fields_at": [], "priority": None, "due": None, "paused": None,
             "breached": None, "problem": None}
        if pre:
            x["priority"] = prio
            x["due"] = at + timedelta(hours=target_in_force(self.policy, prio, at.date()))
            if ci == "db-prod-01" and r.random() < 0.0:
                x["problem"] = "PRB:db-prod-01"
        fc = self.start_dt if pre else self.first_check_after(at)
        resolve = at + timedelta(hours=self.sample_resolve(prio))
        t_prog = max(at + timedelta(minutes=r.randint(10, 90)), (fc or at) + timedelta(minutes=r.randint(5, 50)) if pre else at + timedelta(minutes=10))
        if not pre and fc is not None:
            t_prog = fc + timedelta(minutes=r.randint(5, 50))
        if pre:
            t_prog = self.start_dt + timedelta(minutes=r.randint(-600, -30))
        x["status"].append((t_prog, "In Progress", t_prog))
        if r.random() < PAUSE_SHARE and fc is not None:
            p0 = max(t_prog, fc) + timedelta(minutes=r.randint(20, 600))
            p1 = (p0 + timedelta(hours=r.uniform(1, 40))).replace(microsecond=0)
            if p0 < resolve:
                x["status"].append((p0, "Awaiting User", p0))
                x["status"].append((p1, "In Progress", p1))
                resolve = max(resolve, p1 + timedelta(minutes=30)) + (p1 - p0)
                x["pause"] = (p0, p1)
        resolve = resolve.replace(microsecond=0)
        if resolve > t_prog:
            x["status"].append((resolve, "Resolved", resolve))
        self.incs.append(x)
        return x

    def burst(self):
        r = self.rng
        day = self.days[r.choice([1, 2, 8, 9, 15, 16])]
        t0 = datetime(day.year, day.month, day.day, r.randint(9, 15), r.randrange(0, 50), tzinfo=UTC)
        ci = r.choice(self.cis[1:])
        for k in range(r.choice([3, 3, 4])):
            x = self.incident(at=t0 + timedelta(minutes=12 * k + r.randint(0, 10)), ci=ci, story="burst")
            x["traps"].append("T-burst")
        # a look-alike CI near a problem CI
        x = self.incident(week=r.randint(1, 3), ci=self.look, story="lookalike-ci")
        x["traps"].append("T-lookalike")

    def partial(self):
        r = self.rng
        x = self.incident(week=r.randint(0, 2), story="partial")
        x["imp_blank_until"] = (x["opened"] + timedelta(hours=r.uniform(2, 20))).replace(microsecond=0)
        x["traps"].append("T-partial")

    def plan_changes(self):
        r = self.rng
        n = r.randint(4, 6)
        for k in range(n):
            day = self.days[r.randint(0, 20)]
            at = datetime(day.year, day.month, day.day, r.randint(8, 17), r.randrange(0, 60), tzinfo=UTC)
            ci = r.choice(self.cis)
            c = {"id": f"CHG{r.randint(10000, 99999)}", "ci": ci, "by": r.choice(["a.ford", "j.mehta", "k.olsen", "p.ng"]),
                 "planned": C.iso_z(at + timedelta(days=r.randint(3, 10))), "at": at, "rid": f"chg{k}s{self.seed}",
                 "cab": None, "decided": None}
            self.changes.append(c)
        # conflict: one change on a CI with an open P1 at decision time
        c = self.changes[0]
        p1 = self.incident(at=c["at"] + timedelta(hours=2), ci=c["ci"], prio="P1", story="conflict")
        p1["status"] = [s for s in p1["status"] if s[1] != "Resolved"] + [(c["at"] + timedelta(days=3), "Resolved", c["at"] + timedelta(days=3))]
        c["conflict_p1"] = p1["id"]

    def plan_emails(self):
        r = self.rng
        for k, c in enumerate(self.changes):
            fc = self.first_check_after(c["at"] + timedelta(hours=1)) or c["at"]
            t = (fc + timedelta(hours=r.uniform(1, 30))) if k else (fc + timedelta(hours=r.uniform(4, 12)))
            verb = "approved" if (k == 0 or r.random() < 0.7) else "rejected"
            body = f"CAB decision: {c['id']} is {verb}.\n\nCAB chair\n"
            self.email_event(t, ORG["cab"], ORG["inbox"], f"CAB decision {c['id']}", body,
                             ["T-conflict"] if k == 0 else [], "cab", change=c["id"], verb=verb)
            if k == 1:
                self.email_event(t + timedelta(minutes=r.randint(5, 90)), ORG["cab"], ORG["inbox"], f"Re: CAB decision {c['id']}",
                                 body, ["T-replay"], "cab-replay", change=c["id"], verb=verb)
            if k == 2:
                bad = r.choice(ORG["lookalike_cab"] + ["j.mehta@halden.example.com"])
                self.email_event(t - timedelta(minutes=r.randint(30, 300)), bad, ORG["inbox"], f"CAB decision {c['id']}",
                                 f"Approved {c['id']} - go ahead.\n", ["T-lookalike"] if bad in ORG["lookalike_cab"] else ["T-replay"],
                                 "cab-unauthorized", change=c["id"], verb="approved")
        week3 = [d for d in self.days[14:21] if C.is_business_day(d, HOLS)]
        day = r.choice(week3[1:3] or week3)
        eff = day if r.random() < 0.6 else day + timedelta(days=7 - day.weekday())
        self.email_event(datetime(day.year, day.month, day.day, r.randint(9, 15), r.randrange(0, 60), tzinfo=UTC),
                         ORG["owner"], ORG["inbox"], "SLA policy edition 2",
                         f"Team,\n\nParameter: {P['amend_param']}\nNew value: {P['amend_value']}\nEffective: {eff.isoformat()}\n\nService owner\n",
                         ["T-stale"], "amendment", amend={"param": P["amend_param"], "val": P["amend_value"], "eff": eff, "ok": True})
        bad = r.choice(ORG["lookalike_owner"])
        d2 = self.days[r.randint(7, 11)]
        self.email_event(datetime(d2.year, d2.month, d2.day, 10, r.randrange(0, 60), tzinfo=UTC), bad, ORG["inbox"], "SLA change",
                         f"Parameter: P1 target hours\nNew value: 2\nEffective: {d2.isoformat()}\n", ["T-lookalike"], "amendment-unauthorized",
                         amend={"ok": False})
        if r.random() < 0.5:
            d3 = self.days[r.randint(22, 25)]
            self.email_event(datetime(d3.year, d3.month, d3.day, 10, 5, tzinfo=UTC), ORG["owner"], ORG["inbox"], "SLA change",
                             f"Parameter: P4 target hours\nNew value: 900\nEffective: {d3.isoformat()}\n", [], "amendment-out-of-range",
                             amend={"ok": "range"})
        for _ in range(r.randint(1, 2)):
            d4 = self.days[r.randint(0, 25)]
            self.email_event(datetime(d4.year, d4.month, d4.day, r.randint(8, 18), 0, tzinfo=UTC), "noreply@vendor-status.example.net",
                             ORG["inbox"], "Scheduled maintenance notice", "Our maintenance window is Sunday 02:00 UTC. No action needed.\n",
                             [], "noise")

    # -- tracker rendering and row events ------------------------------------------------------------------------------
    def human(self, x, at):
        st = [s for s in x["status"] if s[0] <= at]
        blank = x.get("imp_blank_until") and at < x["imp_blank_until"]
        return {"Incident ID": x["id"], "Opened At": x["opened_text"], "Impact": "" if blank else x["imp_text"],
                "Urgency": x["urg_text"], "CI": x["ci"], "Status": st[-1][1], "Status Changed At": C.iso_z(st[-1][2]),
                "Short Description": x["desc"]}

    def triggers(self):
        last = self.checks[-1]
        for x in self.incs:          # whole seconds everywhere (trigger times and tracker stamps are to the second)
            x["status"] = sorted((t.replace(microsecond=0), s, c.replace(microsecond=0)) for t, s, c in x["status"])
        for x in self.incs:
            if not x["pre"]:
                self.event(x["opened"], "opened", "google_sheets", "new_row",
                           {"spreadsheet_id": SS, "worksheet": "Incidents", "row": self.human(x, x["opened"])},
                           [{"op": "insert_row", "ss": SS, "sheet": "Incidents", "rid": x["rid"], "cells": self.human(x, x["opened"])}],
                           (), x["story"])
            times = sorted({s[0] for s in x["status"][1:]} | ({x["imp_blank_until"]} if x.get("imp_blank_until") else set()))
            for t in times:
                if t <= (self.start_dt if x["pre"] else x["opened"]) or t > last:
                    continue
                cells = self.human(x, t)
                sub = next((s[1] for s in x["status"] if s[0] == t), "edit")
                self.event(t, "updated", "google_sheets", "updated_row", {"spreadsheet_id": SS, "worksheet": "Incidents", "row": cells},
                           [{"op": "update_row", "ss": SS, "sheet": "Incidents", "key_col": "Incident ID", "key": x["id"], "cells": cells}],
                           (), sub, inc=x["id"])
                if sub == "Awaiting User" and self.rng.random() < 0.35:
                    t2 = t + timedelta(minutes=self.rng.randint(3, 25))
                    nxt = [s for s in x["status"] if s[0] > t]
                    if not nxt or nxt[0][0] > t2:
                        self.event(t2, "updated", "google_sheets", "updated_row", {"spreadsheet_id": SS, "worksheet": "Incidents", "row": cells},
                                   [{"op": "update_row", "ss": SS, "sheet": "Incidents", "key_col": "Incident ID", "key": x["id"], "cells": cells}],
                                   ("T-replay",), "replay", inc=x["id"], order=1)
        for c in self.changes:
            cells = {"Change ID": c["id"], "CI": c["ci"], "Requested By": c["by"], "Planned Start": c["planned"]}
            self.event(c["at"], "opened", "google_sheets", "new_row", {"spreadsheet_id": SS, "worksheet": "Changes", "row": cells},
                       [{"op": "insert_row", "ss": SS, "sheet": "Changes", "rid": c["rid"], "cells": cells}], (), "change")
        self.events = [e for e in self.events if e["at"] <= last]
        return super().triggers()

    def world0(self):
        t0 = self.start_dt
        rows = []
        for x in self.incs:
            if not x["pre"]:
                continue
            c = self.human(x, t0 - timedelta(seconds=1))
            paused = None
            if x.get("pause") and x["pause"][0] < t0 <= x["pause"][1]:
                paused = x["pause"][0]
            x["paused"] = paused
            c.update({"Priority": x["priority"], "SLA Due": C.iso_z(x["due"]), "Paused Since": C.iso_z(paused) if paused else "",
                      "Breached At": "", "Problem Ref": x["problem"] or ""})
            if x["due"] <= t0 and self.status_at(x, t0) not in ("resolved", "closed") and not paused:
                x["breached"] = x["due"] + timedelta(minutes=30)
                c["Breached At"] = C.iso_z(x["breached"])
            rows.append((x["rid"], c))
        cfg = [("Former CAB Chair (until 2026-09-30)", "cab-office@halden.example.com"), ("Service Owner", ORG["owner"]),
               ("CAB Chair", ORG["cab"]), ("Escalation Channel", "#" + CH["escalation"]), ("Changes Channel", "#" + CH["changes"]),
               ("Reports Channel", "#" + CH["reports"]), ("Review Channel", "#" + CH["sink"]), ("Jira Problem Project", "PRB")]
        pol = sorted(self.policy, key=lambda p: (self.rng.random(), p["ed"]))
        sheets = W.sheets([
            {"id": SS, "title": "Service Desk", "worksheets": [
                {"id": INC["ws"], "title": "Incidents", "headers": INC["human"] + INC["state"], "rows": rows},
                {"id": "ws-changes", "title": "Changes", "headers": ["Change ID", "CI", "Requested By", "Planned Start", "CAB Status", "Decided At"], "rows": []},
                {"id": "ws-config", "title": "Config", "headers": ["Setting", "Value"],
                 "rows": [(f"cfg{i:02d}", {"Setting": a, "Value": b}) for i, (a, b) in enumerate(cfg)]},
                {"id": "ws-holidays", "title": "Holidays", "headers": ["Date", "Name"],
                 "rows": [(f"hol{i:02d}", {"Date": d, "Name": n}) for i, (d, n) in enumerate(sorted(HOL.items()))]}]},
            {"id": SSP, "title": "SLA Policy Log", "worksheets": [
                {"id": "ws-policy", "title": "Policy Log", "headers": ["Edition", "Parameter", "Value", "Effective", "Approved by"],
                 "rows": [(f"pol{i}", {"Edition": str(p["ed"]), "Parameter": p["param"], "Value": str(p["val"]),
                                       "Effective": p["eff"].isoformat(), "Approved by": ORG["owner"] if p["ed"] else "itsm-office@halden.example.com"})
                          for i, p in enumerate(pol)]}]}])
        users = [W.slack_user("U0ITSMBOT1", "itsm-bot", "ITSM Automation", is_bot=True),
                 W.slack_user("U0SVCOWN01", "owner", "Ruth Calder", ORG["owner"])]
        cids = {CH["escalation"]: "C0ITSMESC1", CH["changes"]: "C0CHANGES1", CH["reports"]: "C0ITSMREP1", CH["sink"]: "C0AUTOREV1"}
        chans = [W.slack_channel(cid, n, [u["id"] for u in users], n) for n, cid in cids.items()]
        jira = W.jira([("PRB", "Problems", "service_desk"), ("OPS", "Operations", "software")])
        return {"meta": {"schema_version": "0.1.0", "current_time": C.iso_z(t0), "allowed_services": sorted(APPS), "no_same_sender_noise": False},
                "google_sheets": sheets, "slack": {"channels": chans, "messages": [], "users": users, "dms": []},
                "gmail": {"messages": [], "labels": [], "drafts": [], "attachments": [], "threads": []}, "jira": jira}

    # -- truth engine ----------------------------------------------------------------------------------------------------
    def status_at(self, x, now):
        st = [s for s in x["status"] if s[0] <= now]
        return st[-1][1].lower() if st else "new"

    def visible(self, x, now):
        return x["pre"] or x["opened"] <= now

    def readable(self, x, now):
        return not (x.get("imp_blank_until") and now < x["imp_blank_until"])

    def cells(self, x, cells, clause):
        inst = [k for k in cells if k in ("SLA Due", "Paused Since", "Breached At")]
        return {"t": "cells", "ss": SS, "ws_id": INC["ws"], "sheet": "Incidents", "key_col": "Incident ID", "key": x["id"],
                "cells": cells, "instants": inst, "clause": clause}

    def decide(self, trig):
        e = trig["_e"]
        now = datetime.fromisoformat(trig["at"].replace("Z", "+00:00"))
        info = {"traps": set()}
        if e["kind"] == "check":
            return self.decide_check(now, e, trig, info), info
        if e["kind"] == "updated" and e.get("inc"):
            return self.decide_update(now, e, info), info
        if e["kind"] == "email":
            return self.decide_email(now, e, trig, info), info
        return [], info

    def decide_check(self, now, e, trig, info):
        out, rowcells = [], {}
        tr = info["traps"]
        vis = [x for x in self.incs if self.visible(x, now)]
        for x in vis:
            if x["priority"] in (None, "UNTRIAGED"):
                if self.readable(x, now):
                    x["priority"] = PRIO[x["imp"] + x["urg"]]
                    x["due"] = x["opened"] + timedelta(hours=target_in_force(self.policy, x["priority"], x["opened"].date()))
                    rowcells.setdefault(x["id"], {}).update({"Priority": x["priority"], "SLA Due": C.iso_z(x["due"])})
                    tr.update(t for t in x["traps"] if t in ("T-format", "T-partial"))
                    if x["priority"] == "P3" and any(p["ed"] >= 2 for p in self.policy) or (x["priority"] == "P3"):
                        tr.add("T-stale")
                elif x["priority"] is None:
                    x["priority"] = "UNTRIAGED"
                    rowcells.setdefault(x["id"], {})["Priority"] = "UNTRIAGED"
                    out.append({"t": "post", "channel": CH["sink"], "contains": [trig["trigger"], x["id"]], "clause": "Q1"})
                    tr.add("T-partial")
        window = timedelta(hours=P["problem_window_hours"])
        by_ci = {}
        for x in vis:
            by_ci.setdefault(x["ci"], []).append(x)
        for ci, xs in sorted(by_ci.items()):
            has = any(x["problem"] for x in self.incs if x["ci"] == ci)
            recent = [x for x in xs if now - window < x["opened"] <= now]
            if not has and len(recent) >= P["problem_min"]:
                out.append({"t": "issue", "project": "PRB", "summary": f"Problem: {ci}", "clause": "Q4"})
                for x in recent:
                    x["problem"] = f"PRB:{ci}"
                    rowcells.setdefault(x["id"], {})["Problem Ref"] = x["problem"]
                tr.add("T-burst")
                if any(i["ci"] == self.look for i in vis) or ci == self.look:
                    tr.add("T-lookalike")
            elif has:
                for x in recent:
                    if not x["problem"]:
                        x["problem"] = f"PRB:{ci}"
                        rowcells.setdefault(x["id"], {})["Problem Ref"] = x["problem"]
        for x in vis:
            if x["priority"] in (None, "UNTRIAGED") or x["breached"] or x["paused"]:
                if x["breached"] and self.status_at(x, now) not in ("resolved", "closed"):
                    info["needs_state"] = True
                continue
            if self.status_at(x, now) in ("resolved", "closed"):
                continue
            if x["due"] <= now:
                x["breached"] = now
                out.append({"t": "post", "channel": CH["escalation"], "text": f"BREACHED {x['id']} {x['priority']}", "clause": "Q3"})
                rowcells.setdefault(x["id"], {})["Breached At"] = C.iso_z(now)
                tr.update(t for t in x["traps"] if t == "T-format")
                if x.get("pause"):
                    tr.add("T-replay")
        for x in self.incs:
            if x["id"] in rowcells:
                c = rowcells[x["id"]]
                cl = "Q1" if "Priority" in c else ("Q3" if "Breached At" in c else "Q4")
                out.append(self.cells(x, c, cl))
        if e.get("month_end"):
            n = sum(1 for x in self.incs if x["breached"] and (x["breached"].year, x["breached"].month) == (now.year, now.month))
            m = sum(1 for x in vis if x["priority"] not in (None, "UNTRIAGED") and self.status_at(x, now) not in ("resolved", "closed"))
            out.append({"t": "post", "channel": CH["reports"], "text": f"MONTH-END {now:%Y-%m} breached={n} open={m}", "clause": "Q7"})
        return out

    def decide_update(self, now, e, info):
        x = next(i for i in self.incs if i["id"] == e["inc"])
        if x["priority"] in (None, "UNTRIAGED"):
            return []
        st = [s for s in x["status"] if s[0] <= now][-1]
        if st[1] == "Awaiting User":
            if x["paused"] is None:
                x["paused"] = st[2]
                return [self.cells(x, {"Paused Since": C.iso_z(st[2])}, "Q2")]
            info["needs_state"] = True
            return []
        if x["paused"] is not None:
            x["due"] = x["due"] + (st[2] - x["paused"])
            x["paused"] = None
            return [self.cells(x, {"SLA Due": C.iso_z(x["due"]), "Paused Since": ""}, "Q2")]
        return []

    def decide_email(self, now, e, trig, info):
        sub, frm = e["sub"], e["data"]["from"]
        if sub.startswith("cab"):
            c = next(ch for ch in self.changes if ch["id"] == e["change"])
            if frm != ORG["cab"]:
                return [{"t": "post", "channel": CH["sink"], "contains": [trig["trigger"], c["id"]], "clause": "Q5"}]
            if c["cab"] is not None or c["at"] > now:
                info["needs_state"] = True
                return []
            if e["verb"] == "approved":
                conflict = any(x["ci"] == c["ci"] and x["priority"] == "P1" and self.visible(x, now)
                               and self.status_at(x, now) not in ("resolved", "closed") for x in self.incs)
                c["cab"] = "On Hold" if conflict else "Approved"
            else:
                c["cab"] = "Rejected"
            c["decided"] = now
            word = {"On Hold": "ON HOLD", "Approved": "APPROVED", "Rejected": "REJECTED"}[c["cab"]]
            if c["cab"] == "On Hold":
                info["traps"].add("T-conflict")
            return [{"t": "cells", "ss": SS, "ws_id": "ws-changes", "sheet": "Changes", "key_col": "Change ID", "key": c["id"],
                     "cells": {"CAB Status": c["cab"], "Decided At": C.iso_z(now)}, "instants": ["Decided At"], "clause": "Q5"},
                    {"t": "post", "channel": CH["changes"], "text": f"CHANGE {c['id']} {word}", "clause": "Q5"}]
        if sub.startswith("amendment"):
            a = e["amend"]
            if frm != ORG["owner"]:
                return []
            if a["ok"] == "range":
                return [{"t": "post", "channel": CH["sink"], "contains": [trig["trigger"]], "clause": "Q6"}]
            ed = max(p["ed"] for p in self.policy) + 1
            self.policy.append({"ed": ed, "param": a["param"], "val": a["val"], "eff": a["eff"]})
            return [{"t": "append", "ss": SSP, "ws_id": "ws-policy", "sheet": "Policy Log",
                     "cells": {"Edition": str(ed), "Parameter": a["param"], "Value": str(a["val"]), "Effective": a["eff"].isoformat(),
                               "Approved by": ORG["owner"]}, "clause": "Q6"}]
        return []

    def end_tables(self):
        rows = {x["id"]: {"Priority": x["priority"] or "", "SLA Due": C.iso_z(x["due"]) if x["due"] else "",
                          "Paused Since": C.iso_z(x["paused"]) if x["paused"] else "",
                          "Breached At": C.iso_z(x["breached"]) if x["breached"] else "", "Problem Ref": x["problem"] or ""}
                for x in self.incs if self.visible(x, self.checks[-1])}
        chg = {c["id"]: {"CAB Status": c["cab"] or "", "Decided At": C.iso_z(c["decided"]) if c["decided"] else ""} for c in self.changes}
        return [{"ss": SS, "sheet": "Incidents", "key_col": "Incident ID", "rows": rows, "instants": ["SLA Due", "Paused Since", "Breached At"], "clause": "Q1"},
                {"ss": SS, "sheet": "Changes", "key_col": "Change ID", "rows": chg, "instants": ["Decided At"], "clause": "Q5"},
                {"ss": SSP, "sheet": "Policy Log", "key_col": "Parameter", "rows": {}, "count": len(self.policy), "clause": "Q6"}]


def generate(seed: int, rename: bool = False, shift_days: int = 0, allow_sealed: bool = False) -> dict:
    if seed in SEALED and not allow_sealed:
        raise SystemExit(f"seed {seed} is sealed (SEED-LEDGER factory-v-sealed): only experiments/breadth/factory/seal.py generates it")
    return Gen(seed, rename, shift_days).run()


def serve_input(seed: int, trigger: dict, intake: str = "policy", intake_text: str | None = None) -> dict:
    return G.serve_input(FAMILY, (HERE / "POLICY.md").read_text(), APPS, seed, trigger, intake_text if intake == "messy" else None)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, required=True)
    a = ap.parse_args()
    print(json.dumps(generate(a.seed)["meta"], default=str))
