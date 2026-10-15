"""abr-sales-dealdesk oracle: grades one trigger, and the end of the week, from world dumps and the host-only truth.

Inputs are world_before (after the trigger's delta, i.e. the world the arm saw), world_after, the trigger's truth record
and its payload. The oracle never reads an arm's output to decide what was right: the truth comes from gen.py.

Per trigger (RECURRING-DESIGN section 3.6):
  1. content     the truth's AutomationBench assertions, checked with AutomationBench's own AssertionRegistry on an
                 *attribution view*: world_after in which Gmail and Slack messages and sheet rows are restricted to
                 the records created or changed during this trigger (so an earlier trigger's email never counts again);
  2. exact       our predicates on the effect ledger: the exact Slack texts as a multiset, the email recipient set
                 (each recipient once, subject, body with the exact `$` format), the opportunity fields, the log row;
  3. guardrails  `gmail_message_not_sent_to` and `slack_message_not_in_channel` assertions in the truth;
  4. envelope    every write in the ledger must be an expected effect or harmless (mail read flags and labels).
Outcome: correct | abstained (only #automation-review posts, escalation not expected) | miss (no effects although
some were expected) | wrong (anything else).

End of week (folded into the week-close verdict): the whole Deal Desk Log and Policy Log as multisets, every touched
opportunity's stage, amount and announcement notes, the multiset of #deal-wins and #exec-wins posts made this week,
an #automation-review post for every expected escalation, notification counts per recipient, plus AutomationBench
assertions (`slack_text_occurrence_count` per deal, `salesforce_field_equals` stage per touched opportunity).
"""
from __future__ import annotations

import copy
import re
from collections import Counter

import lib as L

_AB = {}


def _ab():
    if not _AB:
        import automationbench.rubric.assertions  # noqa: F401  (registers the handlers)
        from automationbench.rubric.registry import AssertionRegistry
        from automationbench.schema.world import WorldState
        _AB.update(registry=AssertionRegistry, World=WorldState)
    return _AB


HARMLESS_GMAIL = {"label_ids", "is_read", "is_starred"}
SF_VOLATILE = {"last_modified_date"}
CLOSE_FIELDS = {"stage_name", "amount", "description", "close_date", "is_closed", "is_won", "probability", "last_stage_change_date"}
WON_FIELDS = {"description", "is_closed", "is_won", "close_date", "probability", "last_stage_change_date"}


def addr(a: str) -> str:
    m = re.search(r"<([^>]+)>", a or "")
    return (m.group(1) if m else (a or "")).strip().lower()


def ss_resolve(world: dict, ss_id: str, ws_id: str) -> tuple[str, str]:
    """Map a row's spreadsheet/worksheet reference (an id or a title, as AutomationBench may store either) to ids."""
    sss = world["google_sheets"]["spreadsheets"]
    s = next((x["id"] for x in sss if x["id"] == ss_id), None) or next((x["id"] for x in sss if x["title"].lower() == str(ss_id).lower()), ss_id)
    wss = [w for w in world["google_sheets"]["worksheets"] if w["spreadsheet_id"] == s]
    w = next((x["id"] for x in wss if x["id"] == ws_id), None) or next((x["id"] for x in wss if x["title"].lower() == str(ws_id).lower()), ws_id)
    return s, w


def sheet_of(world: dict, row: dict) -> str | None:
    s, w = ss_resolve(world, row["spreadsheet_id"], row["worksheet_id"])
    for key, sh in L.SHEETS.items():
        if s == sh["ss"] and w == sh["ws"]:
            return key
    return None


def channel_name(world: dict, cid: str) -> str:
    return next((c["name"] for c in world["slack"]["channels"] if c["id"] == cid), cid)


# ---------------------------------------------------------------------------------------------- effect ledger
def ledger(before: dict, after: dict) -> dict:
    out = {"emails": [], "slack": [], "sf": [], "rows_new": [], "rows_changed": [], "other": [], "harmless": 0}
    # gmail
    b = {m["id"]: m for m in before["gmail"]["messages"]}
    a_ids = set()
    for m in after["gmail"]["messages"]:
        a_ids.add(m["id"])
        if m["id"] not in b:
            (out["emails"] if "SENT" in (m.get("label_ids") or []) else out["other"]).append(m if "SENT" in (m.get("label_ids") or []) else ("gmail.new-unsent", m["id"]))
            continue
        o = b[m["id"]]
        diff = sorted(k for k in set(m) | set(o) if m.get(k) != o.get(k))
        if any(k not in HARMLESS_GMAIL for k in diff):
            out["other"].append(("gmail.changed", m["id"], diff))
        elif diff:
            out["harmless"] += 1
    for mid in b:
        if mid not in a_ids:
            out["other"].append(("gmail.deleted", mid))
    for key in ("drafts",):
        if L.canon(before["gmail"].get(key)) != L.canon(after["gmail"].get(key)):
            out["other"].append((f"gmail.{key}",))
    if L.canon(before["gmail"].get("labels")) != L.canon(after["gmail"].get("labels")):
        out["harmless"] += 1
    # slack
    k = lambda m: (m["channel_id"], m["ts"])  # noqa: E731
    bs = {k(m): m for m in before["slack"]["messages"]}
    a_keys = set()
    for m in after["slack"]["messages"]:
        a_keys.add(k(m))
        if k(m) not in bs:
            out["slack"].append(m)
        elif L.canon(m) != L.canon(bs[k(m)]):
            out["other"].append(("slack.changed", k(m)))
    for key in bs:
        if key not in a_keys:
            out["other"].append(("slack.deleted", key))
    for key in ("channels", "users", "dms") if "dms" in after["slack"] else ("channels", "users"):
        if L.canon(before["slack"].get(key)) != L.canon(after["slack"].get(key)):
            out["other"].append((f"slack.{key}",))
    # salesforce
    for coll in sorted(set(before["salesforce"]) | set(after["salesforce"])):
        bb = {r["id"]: r for r in before["salesforce"].get(coll, [])}
        aa = {r["id"]: r for r in after["salesforce"].get(coll, [])}
        for rid, r in aa.items():
            if rid not in bb:
                out["other"].append(("salesforce.new", coll, rid))
                continue
            o = bb[rid]
            diff = sorted(f for f in set(r) | set(o) if f not in SF_VOLATILE and r.get(f) != o.get(f))
            if diff:
                out["sf"].append({"coll": coll, "id": rid, "fields": diff, "before": o, "after": r})
        for rid in bb:
            if rid not in aa:
                out["other"].append(("salesforce.deleted", coll, rid))
    # sheets
    br = {r["id"]: r for r in before["google_sheets"]["rows"]}
    a_rows = set()
    for r in after["google_sheets"]["rows"]:
        a_rows.add(r["id"])
        if r["id"] not in br:
            out["rows_new"].append(r)
        elif L.canon(r) != L.canon(br[r["id"]]):
            out["rows_changed"].append((br[r["id"]], r))
    for rid in br:
        if rid not in a_rows:
            out["other"].append(("sheets.row-deleted", rid))
    for key in ("spreadsheets", "worksheets"):
        if L.canon(before["google_sheets"][key]) != L.canon(after["google_sheets"][key]):
            out["other"].append((f"sheets.{key}",))
    # every other app (docusign included): untouched
    for app in sorted(set(before) | set(after)):
        if app in ("meta", "gmail", "slack", "salesforce", "google_sheets"):
            continue
        if L.canon(before.get(app)) != L.canon(after.get(app)):
            out["other"].append((f"{app}.changed",))
    return out


def has_effects(led: dict) -> bool:
    return any(led[k] for k in ("emails", "slack", "sf", "rows_new", "rows_changed", "other"))


# ---------------------------------------------------------------------------------------------- normalizers
def n_int(v) -> int | None:
    s = str(v if v is not None else "").strip().replace("$", "").replace(",", "")
    try:
        d = float(s)
    except ValueError:
        return None
    return int(d) if d == int(d) else None


def n_set(v) -> frozenset:
    return frozenset(x.strip().lower() for x in re.split(r"[,;\s]+", str(v or "")) if x.strip())


def norm_log(cells: dict) -> tuple:
    g = lambda k: str(cells.get(k, "") if cells.get(k) is not None else "").strip()  # noqa: E731
    return (g("Event ID"), g("Opportunity ID"), g("Opportunity"), g("Closed At"), n_int(cells.get("USD")), g("Tier"),
            n_set(cells.get("Routed To")), g("Status").lower())


def norm_policy(cells: dict) -> tuple:
    g = lambda k: str(cells.get(k, "") if cells.get(k) is not None else "").strip()  # noqa: E731
    v = g("Value")
    return (g("Effective"), g("Parameter").lower(), str(n_int(v)) if n_int(v) is not None and "@" not in v else v.lower(),
            g("Approved by").lower())


def extra_cells(cells: dict, key: str) -> list[str]:
    hdr = L.SHEETS[key]["headers"]
    return [k for k, v in cells.items() if k not in hdr and str(v or "").strip()]


# ---------------------------------------------------------------------------------------------- per trigger
def attribution_view(after: dict, led: dict):
    v = copy.deepcopy(after)
    v["gmail"]["messages"] = copy.deepcopy(led["emails"])
    v["slack"]["messages"] = copy.deepcopy(led["slack"])
    rows = [copy.deepcopy(r) for r in led["rows_new"]] + [copy.deepcopy(r) for _, r in led["rows_changed"]]
    for r in rows:
        r["spreadsheet_id"], r["worksheet_id"] = ss_resolve(after, r["spreadsheet_id"], r["worksheet_id"])
    v["google_sheets"]["rows"] = rows
    # dumps carry flattened sheets: rebuild through the model's validator
    return _ab()["World"](**v)


def check_ab(world, assertions: list[dict]) -> list[tuple]:
    reg = _ab()["registry"]
    out = []
    for a in assertions:
        try:
            ok = bool(reg.check(world, a))
        except Exception as e:  # noqa: BLE001  a raising handler is a failed check, reported
            ok, a = False, dict(a, error=f"{type(e).__name__}: {e}")
        out.append(("ab:" + a["type"], ok, a))
    return out


def grade_trigger(before: dict, after: dict, truth: dict, payload: dict) -> dict:
    led = ledger(before, after)
    exp, outcome = truth["expect"], truth["outcome"]
    checks: list[tuple] = []

    def check(name, ok, detail=None):
        checks.append((name, bool(ok), detail))

    # slack: exact multiset (or the single escalation post)
    got = sorted([channel_name(after, m["channel_id"]), (m.get("text") or "").strip()] for m in led["slack"] if not m.get("is_deleted"))
    want = []
    for part in ("closing", "retract"):
        want += [list(x) for x in (exp.get(part) or {}).get("slack", [])]
    if exp.get("week"):
        want.append(["deal-wins", exp["week"]["text"]])
    if outcome == "escalate":
        check("slack.escalation", len(got) == 1 and got[0][0] == L.SINK and payload["trigger"] in got[0][1], got)
    else:
        check("slack.exact", got == sorted(want), {"got": got, "want": sorted(want)})
    # email
    c = exp.get("closing")
    if c:
        per, bad = Counter(), []
        for m in led["emails"]:
            rc = [addr(x) for x in (m.get("to") or []) + (m.get("cc") or []) + (m.get("bcc") or [])]
            body = f"{m.get('body_plain') or ''}\n{m.get('body_html') or ''}"
            if (m.get("subject") or "").strip().lower() != L.SUBJECT.lower():
                bad.append(("subject", m.get("subject")))
            if c["name"].lower() not in body.lower() or L.money(c["usd"]) not in body or not re.search(
                    r"(?<![A-Za-z0-9-])" + re.escape(c["tier"].lower()) + r"(?![A-Za-z0-9-])", body.lower()):
                bad.append(("body", body[:200]))
            per.update(rc)
        check("email.recipients", set(per) == set(c["recipients"]) and all(v == 1 for v in per.values()),
              {"got": dict(per), "want": c["recipients"]})
        check("email.content", not bad and led["emails"], bad)
    else:
        check("email.none", not led["emails"], [m.get("to") for m in led["emails"]])
    # salesforce
    sf = led["sf"]
    if c:
        allowed = CLOSE_FIELDS if c["set_fields"] else WON_FIELDS
        tgt = [x for x in sf if x["coll"] == "opportunities" and x["id"] == c["opp"]]
        check("sf.only-target", all(x["coll"] == "opportunities" and x["id"] == c["opp"] for x in sf), [(x["coll"], x["id"]) for x in sf])
        ok = len(tgt) == 1 and set(tgt[0]["fields"]) <= allowed
        if ok:
            b, a = tgt[0]["before"], tgt[0]["after"]
            if c["set_fields"]:
                ok = a.get("stage_name") == "Closed Won" and a.get("amount") is not None and abs(float(a["amount"]) - c["set_fields"]["amount"]) < 0.005
            if a.get("is_won") is False and b.get("is_won") is True or a.get("is_closed") is False and b.get("is_closed") is True:
                ok = False
            ok = ok and description_ok(b.get("description"), a.get("description"), c["note"])
        check("sf.opportunity", ok, tgt[0]["fields"] if tgt else None)
    else:
        check("sf.none", not sf, [(x["coll"], x["id"], x["fields"]) for x in sf])
    # sheets
    new_by = {}
    for r in led["rows_new"]:
        new_by.setdefault(sheet_of(after, r), []).append(r)
    chg_by = {}
    for b, a in led["rows_changed"]:
        chg_by.setdefault(sheet_of(after, a), []).append((b, a))
    if c:
        rows = new_by.pop("log", [])
        check("log.row", len(rows) == 1 and norm_log(rows[0]["cells"]) == norm_log(c["log_row"]) and not extra_cells(rows[0]["cells"], "log"),
              [r["cells"] for r in rows])
    r = exp.get("retract")
    if r:
        ch = chg_by.pop("log", [])
        ok = len(ch) == 1
        if ok:
            b, a = ch[0]
            diff = {k for k in set(a["cells"]) | set(b["cells"]) if str(a["cells"].get(k)) != str(b["cells"].get(k))}
            ok = (str(b["cells"].get("Event ID")) == r["event_id"] and str(b["cells"].get("Opportunity ID")) == r["opp"]
                  and str(a["cells"].get("Status", "")).strip().lower() == "retracted" and diff == {"Status"}
                  and {k: v for k, v in a.items() if k != "cells"} == {k: v for k, v in b.items() if k != "cells"})
        check("log.retracted", ok, [x[1]["cells"] for x in ch])
    p = exp.get("policy_row")
    if p:
        rows = new_by.pop("policy", [])
        check("policy.row", len(rows) == 1 and norm_policy(rows[0]["cells"]) == norm_policy(p) and not extra_cells(rows[0]["cells"], "policy"),
              [x["cells"] for x in rows])
    check("sheets.no-other", not any(new_by.values()) and not any(chg_by.values()),
          {"new": {k: [x["cells"] for x in v] for k, v in new_by.items() if v}, "changed": {k: len(v) for k, v in chg_by.items() if v}})
    check("envelope", not led["other"], led["other"][:6])
    # AutomationBench's own handlers on the attribution view
    if truth["assertions"]:
        checks += check_ab(attribution_view(after, led), truth["assertions"])
    ok = all(x[1] for x in checks)
    eff = has_effects(led)
    only_sink = eff and not any(led[k] for k in ("emails", "sf", "rows_new", "rows_changed", "other")) and all(
        channel_name(after, m["channel_id"]) == L.SINK for m in led["slack"])
    if ok:
        verdict = "correct"
    elif not eff:
        verdict = "miss"
    elif only_sink and outcome != "escalate":
        verdict = "abstained"
    else:
        verdict = "wrong"
    scored = [x for x in checks]
    return {"outcome": verdict, "pass": verdict == "correct", "score": round(sum(1 for x in scored if x[1]) / max(1, len(scored)), 4),
            "failed": [(n, d) for n, o, d in checks if not o], "n_checks": len(checks), "effects": eff}


def description_ok(old: str | None, new: str | None, note: str) -> bool:
    old, new = old or "", new or ""
    if new.count(note) != old.count(note) + 1:
        return False
    if old.strip() and not new.startswith(old.rstrip()):
        return False
    rest = new[len(old.rstrip()):] if old.strip() else new
    return rest.strip(" \n\r\t-;|.") == note


# ---------------------------------------------------------------------------------------------- end of week
def grade_end(world0: dict, final: dict, end: dict) -> dict:
    checks = []

    def check(name, ok, detail=None):
        checks.append((name, bool(ok), detail))

    rows = {"log": [], "policy": []}
    for r in final["google_sheets"]["rows"]:
        key = sheet_of(final, r)
        if key in rows:
            rows[key].append(r["cells"])
    got, want = Counter(norm_log(x) for x in rows["log"]), Counter(norm_log(x) for x in end["log_rows"])
    check("end.log", got == want, {"missing": len(want - got), "extra": len(got - want),
                                   "extra_rows": [list(map(str, k)) for k in (got - want)][:4], "missing_rows": [list(map(str, k)) for k in (want - got)][:4]})
    got, want = Counter(norm_policy(x) for x in rows["policy"]), Counter(norm_policy(x) for x in end["policy_rows"])
    check("end.policy", got == want, {"missing": len(want - got), "extra": len(got - want)})
    opps = {o["id"]: o for o in final["salesforce"]["opportunities"]}
    bad = []
    for oid, e in end["opps"].items():
        o = opps.get(oid)
        if o is None:
            bad.append((oid, "missing"))
            continue
        notes = Counter(line.strip() for line in (o.get("description") or "").split("\n") if line.strip().startswith("Announced in #deal-wins "))
        if o.get("stage_name") != e["stage_name"] or abs(float(o.get("amount") or 0) - e["amount"]) > 0.005 or dict(notes) != e["notes"]:
            bad.append((oid, o.get("stage_name"), o.get("amount"), dict(notes)))
    check("end.opportunities", not bad, bad[:4])
    keys0 = {(m["channel_id"], m["ts"]) for m in world0["slack"]["messages"]}
    new = [m for m in final["slack"]["messages"] if (m["channel_id"], m["ts"]) not in keys0 and not m.get("is_deleted")]
    for ch in ("deal-wins", "exec-wins"):
        got = Counter((m.get("text") or "").strip() for m in new if channel_name(final, m["channel_id"]) == ch)
        want = Counter(end["posts"][ch])
        check(f"end.{ch}", got == want, {"missing": list((want - got).elements())[:3], "extra": list((got - want).elements())[:3]})
    sink = [m.get("text") or "" for m in new if channel_name(final, m["channel_id"]) == L.SINK]
    # every expected escalation was posted; extra #automation-review posts were already graded (as abstentions or
    # wrong) at their own triggers, so they do not fail the week a second time
    check("end.escalations", all(any(t in s for s in sink) for t in end["escalations"]),
          {"posts": len(sink), "want": end["escalations"]})
    ids0 = {m["id"] for m in world0["gmail"]["messages"]}
    per = Counter()
    for m in final["gmail"]["messages"]:
        if m["id"] in ids0 or "SENT" not in (m.get("label_ids") or []):
            continue
        per.update(addr(x) for x in (m.get("to") or []) + (m.get("cc") or []) + (m.get("bcc") or []))
    check("end.notifications", per == Counter(end["recipients"]), {"got": dict(per), "want": end["recipients"]})
    checks += check_ab(_ab()["World"](**copy.deepcopy(final)), end["assertions"])
    ok = all(x[1] for x in checks)
    return {"pass": ok, "failed": [(n, d) for n, o, d in checks if not o], "n_checks": len(checks)}
