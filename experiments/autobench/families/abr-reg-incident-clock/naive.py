"""Naive control (<= 40 lines): what a quick script would do. UTC everywhere, no state, no editions, no authority."""
from datetime import datetime, timedelta, timezone
from abr.lib.factory.store import store_for

R = "reg-reporting"


def t(s):
    try:
        return datetime.fromisoformat(str(s).strip().replace("Z", "+00:00").replace(" UTC", "+00:00")[:16]).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def handle(p, ctx):
    st = store_for(ctx)
    now = t(p["at"])
    if p.get("event") != "check":
        return
    for r in st.rows("sheet-reg-incidents", "Incidents"):
        a = t(r["Aware At"])
        if r["Significant"].lower() != "yes" or a is None:
            continue
        for name, h, sent in (("EARLY-WARNING", 24, "Early Warning Sent At"), ("NOTIFICATION", 72, "Notification Sent At")):
            due = a + timedelta(hours=h)
            if r[sent].strip():
                continue
            if now - timedelta(hours=4) < due <= now:
                st.post(R, f"OVERDUE {r['Incident ID']} {name}")
            elif now < due <= now + timedelta(hours=4):
                st.post(R, f"DUE {r['Incident ID']} {name} {due:%Y-%m-%dT%H:%M:%SZ}")
    st.flush()
