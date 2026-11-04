"""Naive control (<= 40 lines): triage and breach from the tracker, UTC only, no pause, no problems, no CAB, no editions."""
from datetime import datetime, timedelta, timezone
from abr.lib.factory.store import store_for

T = {"P1": 4, "P2": 8, "P3": 92, "P4": 329}


def t(s):
    try:
        return datetime.fromisoformat(str(s).strip()[:19].replace(" ", "T")).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def handle(p, ctx):
    if p.get("event") != "check":
        return
    st, now = store_for(ctx), t(p["at"].replace("Z", ""))
    for r in st.rows("sheet-itsm", "Incidents"):
        iid, cells = r["Incident ID"], {}
        if not r["Priority"]:
            try:
                s = int(r["Impact"][:1]) + int(r["Urgency"][:1])
            except ValueError:
                continue
            pr = {2: "P1", 3: "P2", 4: "P3"}.get(s, "P4")
            cells = {"Priority": pr, "SLA Due": (t(r["Opened At"]) + timedelta(hours=T[pr])).strftime("%Y-%m-%dT%H:%M:%SZ")}
        due = t((cells.get("SLA Due") or r["SLA Due"]).replace("Z", ""))
        if due and due <= now and not r["Breached At"] and r["Status"] not in ("Resolved", "Closed"):
            st.post("itsm-escalation", f"BREACHED {iid} {cells.get('Priority') or r['Priority']}")
            cells["Breached At"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
        if cells:
            st.set_cells("sheet-itsm", "Incidents", "Incident ID", iid, cells)
    st.flush()
