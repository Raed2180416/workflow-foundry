"""Generic per-trigger oracle for factory families (host-side; never reads a solver's output to decide what was right).

Checks per trigger, against the host-only truth row the family's truth engine wrote:
  effects   every expected effect is found in THIS trigger's ledger, each record used once: posts (exact text, case and
            runs of spaces ignored, or `contains` tokens for the review sink), sent mail (recipient exact, subject
            exact as posts, body tokens), Jira create_issue (project, summary), tracker cell writes on the row named by
            its key (values as posts; instants as the same instant in any ISO form), appended rows.
  envelope  nothing else changed: no other record created, changed or removed in any app; on a written row no other
            column changed. Marking inbound mail read / labelling it is harmless.
  timing    every record created carries the trigger's time: within [at, at + 10 min].
  end       (last trigger only) the final state columns of every tracker row equal the truth's end table.
Outcome: correct | abstained (only review-sink posts, none expected) | miss (nothing done, effects expected) | wrong.
Each expected or spurious effect is attributed to a policy clause (spec `attribution`), which gives clause-attributed
accuracy and hard-requirement violations (clauses the spec marks hard).

AutomationBench's own AssertionRegistry runs as a cross-check only (`ab_check`, AutomationBench venv): reported as
`ab_disagree` on passing verdicts, never deciding a trigger, because its matching (raw substrings, exact cells) differs
from the policy's (case and spacing ignored, any ISO instant).
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

from .clock import parse_instant

UTC = timezone.utc
SLACK_HARMLESS: set = set()
GMAIL_HARMLESS = {"is_read", "label_ids", "is_starred"}
WINDOW = timedelta(minutes=10)


def canon(x) -> str:
    return json.dumps(x, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def norm(s) -> str:
    return " ".join(str(s if s is not None else "").split()).casefold()


def _ts_slack(m) -> datetime | None:
    try:
        return datetime.fromisoformat(m["created_at"]).replace(tzinfo=UTC)
    except (TypeError, ValueError, KeyError):
        return None


def _ts_mail(m) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(m["date"]) / 1000, UTC)
    except (TypeError, ValueError, KeyError):
        return None


def _ts_jira(a) -> datetime | None:
    return parse_instant(a.get("created_at"))


def _is_empty(x) -> bool:
    if x is None or x is False or x == 0 or x == "":
        return True
    if isinstance(x, (list, tuple)):
        return all(_is_empty(i) for i in x)
    if isinstance(x, dict):
        return all(_is_empty(v) for v in x.values())
    return False


def ledger(before: dict, after: dict) -> dict:
    """Everything created, changed or removed between two world dumps (factory families' apps). A family world lists
    only its own apps while AutomationBench's dump lists every app with an empty default: an app absent on one side
    and empty on the other is the same app, not a change."""
    before, after = dict(before), dict(after)
    for app in set(before) | set(after):
        if app not in before and _is_empty(after[app]):
            before[app] = after[app]
        elif app not in after and _is_empty(before[app]):
            after[app] = before[app]
    L = {"posts": [], "mails": [], "issues": [], "cells": {}, "appends": [], "bad": []}
    chans = {c["id"]: c["name"] for c in after.get("slack", {}).get("channels", [])}
    bm = {(m["channel_id"], m["ts"]): m for m in before.get("slack", {}).get("messages", [])}
    am = {(m["channel_id"], m["ts"]): m for m in after.get("slack", {}).get("messages", [])}
    for k, m in am.items():
        if k not in bm:
            L["posts"].append({"channel": chans.get(m["channel_id"], m["channel_id"]), "text": m.get("text") or "",
                               "at": _ts_slack(m), "top": not m.get("thread_ts"), "deleted": m.get("is_deleted")})
        elif canon(m) != canon(bm[k]):
            L["bad"].append(f"slack message {k[1]} changed")
    L["bad"] += [f"slack message {k[1]} removed" for k in bm if k not in am]
    for coll in ("channels", "users", "dms"):
        if canon(before.get("slack", {}).get(coll)) != canon(after.get("slack", {}).get(coll)):
            L["bad"].append(f"slack {coll} changed")
    bg = {m["id"]: m for m in before.get("gmail", {}).get("messages", [])}
    ag = {m["id"]: m for m in after.get("gmail", {}).get("messages", [])}
    for k, m in ag.items():
        if k not in bg:
            if "SENT" in (m.get("label_ids") or []):
                L["mails"].append({"to": [str(t).strip().lower() for t in (m.get("to") or [])] + [str(t).strip().lower() for t in (m.get("cc") or [])],
                                   "subject": m.get("subject") or "", "body": m.get("body_plain") or "", "at": _ts_mail(m)})
            else:
                L["bad"].append(f"gmail message {k} created without SENT")
        else:
            changed = {f for f in set(m) | set(bg[k]) if canon(m.get(f)) != canon(bg[k].get(f))}
            if changed - GMAIL_HARMLESS or ("label_ids" in changed and (
                    ("SENT" in (m.get("label_ids") or [])) != ("SENT" in (bg[k].get("label_ids") or []))
                    or ("INBOX" in (bg[k].get("label_ids") or []) and "INBOX" not in (m.get("label_ids") or [])))):
                L["bad"].append(f"gmail message {k} changed {sorted(changed)}")
    L["bad"] += [f"gmail message {k} removed" for k in bg if k not in ag]
    for coll in ("labels", "drafts", "threads", "attachments"):
        if coll == "labels":
            continue
        if canon(before.get("gmail", {}).get(coll)) != canon(after.get("gmail", {}).get(coll)):
            L["bad"].append(f"gmail {coll} changed")
    bj, aj = before.get("jira", {}), after.get("jira", {})
    for ak in set(bj.get("actions", {})) | set(aj.get("actions", {})):
        xs, ys = bj.get("actions", {}).get(ak) or [], aj.get("actions", {}).get(ak) or []
        bx = {canon(x) for x in xs}
        if ak == "create_issue" and all(canon(x) in {canon(y) for y in ys} for x in xs):
            for y in ys:
                if canon(y) not in bx:
                    L["issues"].append({**(y.get("params") or {}), "at": _ts_jira(y)})
        elif canon(xs) != canon(ys):
            L["bad"].append(f"jira actions {ak} changed")
    for coll in ("issues", "projects"):
        if canon(bj.get(coll)) != canon(aj.get(coll)):
            L["bad"].append(f"jira {coll} changed")
    gb, ga = before.get("google_sheets", {}), after.get("google_sheets", {})
    for coll in ("spreadsheets", "worksheets"):
        if canon(gb.get(coll)) != canon(ga.get(coll)):
            L["bad"].append(f"google_sheets {coll} changed")
    wsname = {w["id"]: w["title"] for w in ga.get("worksheets", [])}
    rb = {r["id"]: r for r in gb.get("rows", [])}
    for r in ga.get("rows", []):
        o = rb.pop(r["id"], None)
        sheet = wsname.get(r["worksheet_id"], r["worksheet_id"])
        if o is None:
            L["appends"].append({"ss": r["spreadsheet_id"], "sheet": sheet, "cells": dict(r["cells"]), "row_id": r["row_id"]})
            continue
        if canon(o) == canon(r):
            continue
        other = [f for f in r if f != "cells" and canon(r.get(f)) != canon(o.get(f))]
        if other:
            L["bad"].append(f"{sheet} row {r['row_id']} fields {other} changed")
        diff = {c: (o["cells"].get(c, ""), r["cells"].get(c, "")) for c in set(o["cells"]) | set(r["cells"])
                if str(o["cells"].get(c, "")) != str(r["cells"].get(c, ""))}
        if diff:
            L["cells"][r["id"]] = {"ss": r["spreadsheet_id"], "sheet": sheet, "before": dict(o["cells"]),
                                   "after": dict(r["cells"]), "diff": diff}
    L["bad"] += [f"row {k} removed" for k in rb]
    for app in set(before) | set(after):
        if app in ("meta", "slack", "gmail", "jira", "google_sheets"):
            continue
        if canon(before.get(app)) != canon(after.get(app)):
            L["bad"].append(f"{app} changed")
    return L


def same_value(got, want, instant: bool) -> bool:
    if instant:
        if str(want or "").strip() == "":
            return str(got or "").strip() == ""
        a, b = parse_instant(got), parse_instant(want)
        return a is not None and b is not None and a == b
    return norm(got) == norm(want)


def text_ok(got: str, eff: dict) -> bool:
    if "text" in eff:
        return norm(got) == norm(eff["text"])
    return all(norm(t) in norm(got) for t in eff.get("contains", []))


class Grader:
    def __init__(self, spec: dict):
        self.spec = spec
        self.attr = spec.get("attribution", {})
        self.hard = set(spec.get("hard_clauses", []))
        self.sink = spec.get("sink")

    def attribute(self, kind: str, where: str = "", col: str = "") -> str:
        for k in (f"{kind}:{where}:{col}", f"{kind}:{where}", kind):
            if k in self.attr:
                return self.attr[k]
        return "?"

    def grade(self, truth: dict, before: dict, after: dict, end: dict | None = None) -> dict:
        L = ledger(before, after)
        at = parse_instant(truth["at"])
        checks, matched, missed, spurious = [], [], [], []

        def check(name, ok, detail="", group="effects"):
            checks.append({"name": name, "ok": bool(ok), "detail": detail, "group": group})

        used = {"posts": set(), "mails": set(), "issues": set(), "appends": set(), "rows": set()}
        row_expect: dict[str, set] = {}
        for i, e in enumerate(truth["expect"]):
            t, cl = e["t"], e.get("clause", "?")
            hit = None
            if t == "post":
                hit = next((j for j, p in enumerate(L["posts"]) if j not in used["posts"] and p["channel"] == e["channel"]
                            and p["top"] and not p["deleted"] and text_ok(p["text"], e)), None)
                pool = "posts"
            elif t == "mail":
                hit = next((j for j, m in enumerate(L["mails"]) if j not in used["mails"] and m["to"] == [e["to"].lower()]
                            and norm(m["subject"]) == norm(e["subject"])
                            and all(norm(x) in norm(m["body"]) for x in e.get("body_has", []))), None)
                pool = "mails"
            elif t == "issue":
                hit = next((j for j, s in enumerate(L["issues"]) if j not in used["issues"] and s.get("project") == e["project"]
                            and norm(s.get("summary")) == norm(e["summary"])), None)
                pool = "issues"
            elif t == "append":
                inst = set(e.get("instants", []))
                hit = next((j for j, a in enumerate(L["appends"]) if j not in used["appends"] and a["sheet"] == e["sheet"]
                            and all(same_value(a["cells"].get(c, ""), v, c in inst) for c, v in e["cells"].items())), None)
                pool = "appends"
            elif t == "cells":
                inst = set(e.get("instants", []))
                rid = next((k for k, r in L["cells"].items() if r["sheet"] == e["sheet"]
                            and str(r["before"].get(e["key_col"], "")).strip() == e["key"]
                            and (e.get("row_id") is None or True)), None)
                ok = rid is not None and all(same_value(L["cells"][rid]["after"].get(c, ""), v, c in inst)
                                             for c, v in e["cells"].items())
                if ok:
                    used["rows"].add(rid)
                    row_expect.setdefault(rid, set()).update(e["cells"])
                    hit = rid
                pool = None
            else:
                raise ValueError(f"unknown effect {t}")
            if hit is None:
                check(f"{t} {cl} {e.get('key') or e.get('channel') or e.get('sheet') or e.get('to') or ''}", False,
                      f"expected {json.dumps({k: v for k, v in e.items() if k != 'clause'})[:240]}")
                missed.append(cl)
            else:
                if pool:
                    used[pool].add(hit)
                matched.append(cl)
        # envelope ------------------------------------------------------------------------------------------------
        for j, p in enumerate(L["posts"]):
            if j not in used["posts"]:
                check("envelope.post", False, f"unexpected post in #{p['channel']}: {p['text'][:160]!r}", "envelope")
                spurious.append(self.attribute("post", p["channel"]))
        for j, m in enumerate(L["mails"]):
            if j not in used["mails"]:
                check("envelope.mail", False, f"unexpected mail to {m['to']}: {m['subject'][:120]!r}", "envelope")
                spurious.append(self.attribute("mail"))
        for j, s in enumerate(L["issues"]):
            if j not in used["issues"]:
                check("envelope.issue", False, f"unexpected issue {s.get('project')}: {s.get('summary')!r}", "envelope")
                spurious.append(self.attribute("issue", s.get("project", "")))
        for j, a in enumerate(L["appends"]):
            if j not in used["appends"]:
                check("envelope.append", False, f"unexpected row in {a['sheet']}: {json.dumps(a['cells'])[:160]}", "envelope")
                spurious.append(self.attribute("append", a["sheet"]))
        for rid, r in L["cells"].items():
            extra = sorted(c for c in r["diff"] if c not in row_expect.get(rid, set()))
            if extra:
                check("envelope.cells", False, f"{r['sheet']} row {r['before'].get(next(iter(r['before']), ''), '')!r}: "
                      f"unexpected change of {extra}", "envelope")
                spurious += [self.attribute("cells", r["sheet"], c) for c in extra]
        for b in L["bad"]:
            check("envelope.other", False, b, "envelope")
            spurious.append("?")
        # timing --------------------------------------------------------------------------------------------------
        for kind in ("posts", "mails", "issues"):
            for x in L[kind]:
                ok = x["at"] is not None and at <= x["at"] <= at + WINDOW
                if not ok:
                    check(f"timing.{kind}", False, f"record time {x['at']} outside [{at}, +10 min]", "timing")
        # end -----------------------------------------------------------------------------------------------------
        if end is not None:
            for fail, cl in self.end_checks(end, after):
                check("end", False, fail, "end")
                missed.append(cl)
        failed = [c for c in checks if not c["ok"]]
        core = [c for c in failed if c["group"] != "envelope"]
        nothing = not (L["posts"] or L["mails"] or L["issues"] or L["appends"] or L["cells"] or L["bad"])
        only_sink = (L["posts"] and all(p["channel"] == self.sink for p in L["posts"]) and not (
            L["mails"] or L["issues"] or L["appends"] or L["cells"] or L["bad"]))
        exp_sink = any(e["t"] == "post" and e["channel"] == self.sink for e in truth["expect"])
        if not failed:
            outcome = "correct"
        elif only_sink and not exp_sink:
            outcome = "abstained"
        elif nothing and truth["expect"]:
            outcome = "miss"
        else:
            outcome = "wrong"
        hard = sum(1 for c in missed + spurious if c in self.hard)
        return {"pass": not failed, "pass_core": not core, "outcome": outcome, "failed": failed,
                "expected": "no-op" if not truth["expect"] else "act", "matched": matched, "missed": missed,
                "spurious": spurious, "hard_violations": hard}

    def end_checks(self, end: dict, after: dict):
        from .world import table
        out = []
        for tab in end.get("tables", []):
            rows = table(after, tab["ss"], tab["sheet"])
            by_key: dict = {}
            for r in rows:
                by_key.setdefault(str(r.get(tab["key_col"], "")).strip(), []).append(r)
            for key, want in tab["rows"].items():
                got = by_key.get(key, [])
                if len(got) != 1:
                    out.append((f"{tab['sheet']} {key}: {len(got)} rows at the end", tab.get("clause", "?")))
                    continue
                for col, v in want.items():
                    if not same_value(got[0].get(col, ""), v, col in tab.get("instants", [])):
                        out.append((f"{tab['sheet']} {key}.{col} = {got[0].get(col)!r}, truth {v!r}",
                                    self.attribute("cells", tab["sheet"], col)))
            if "count" in tab and len(rows) != tab["count"]:
                out.append((f"{tab['sheet']} has {len(rows)} rows at the end, truth {tab['count']}", tab.get("clause", "?")))
        return out


def ab_assertions(truth: dict) -> list[dict]:
    """AutomationBench assertion dicts for the expected effects (the cross-check; AutomationBench's raw matching)."""
    out = []
    for e in truth["expect"]:
        if e["t"] == "post":
            out.append({"type": "slack_message_exists", "channel_name": e["channel"],
                        "text_contains": e.get("text") or (e.get("contains") or [""])[0]})
        elif e["t"] == "mail":
            out.append({"type": "gmail_message_sent_to_with_subject_contains", "to": e["to"], "subject_contains": e["subject"]})
        elif e["t"] == "issue":
            out.append({"type": "jira_action_exists", "action_key": "create_issue",
                        "params": {"project": e["project"], "summary": e["summary"]}})
        elif e["t"] in ("cells", "append"):
            cells = dict(e["cells"])
            if e["t"] == "cells":
                cells[e["key_col"]] = e["key"]
            out.append({"type": "google_sheets_row_exists", "spreadsheet_id": e["ss"], "worksheet": e["ws_id"], "cells": cells})
    return out


class ABCheck:
    """AutomationBench's own handlers on world_after (AutomationBench venv only)."""

    def __init__(self):
        import automationbench.rubric.assertions  # noqa: F401  (registers the handlers)
        from automationbench.rubric.registry import AssertionRegistry
        from automationbench.schema.world import WorldState
        self.R, self.W = AssertionRegistry, WorldState

    def failures(self, world: dict, truth: dict) -> list[dict]:
        asserts = ab_assertions(truth)
        if not asserts:
            return []
        w = self.W(**world)
        return [a for a in asserts if not self.R.check(w, a)]
