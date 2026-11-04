"""abr-mkt-suppression oracle: grades one trigger, and the end of the week, from world dumps and the host-only truth.

Inputs are world_before (after the trigger's delta, i.e. the world the arm saw), world_after, the trigger's truth record
and its payload. The oracle never reads an arm's output to decide what was right: the truth comes from gen.py.

Per trigger (RECURRING-DESIGN section 3.6):
  1. content     the truth's AutomationBench assertions, checked with AutomationBench's own AssertionRegistry on an
                 *attribution view*: world_after in which Gmail and Slack messages and sheet rows are restricted to the
                 records created or changed during this trigger (an earlier trigger's email never counts again);
  2. exact       our predicates on the effect ledger: the set of Mailchimp members archived during this trigger, the
                 multiset of emails by (recipient, exact subject) with exactly one address in all of To/Cc/Bcc (an
                 entry holding two addresses, e.g. joined by ';', is two recipients) and the required body content
                 (for a confirmation, POLICY.md's sentence, not negated, naming no individual list), the exact Slack
                 texts (plus, at a daily close, one #automation-review post per released row the policy cannot
                 decide), and the new Compliance Log, Bounce Log and Policy Log rows as multisets;
  3. guardrails  `mailchimp_subscriber_in_list` (addresses that must stay) and `gmail_message_not_sent_to`
                 (confirmations that must not go out) assertions in the truth;
  4. envelope    every write in the ledger must be an expected effect or harmless (mail read flags and labels; the
                 member `updated_at` stamp that Mailchimp's archive call refreshes). Earlier sheet rows are never edited.
                 A Slack message posted and then deleted during the trigger is still a write (a real Slack delivered it).
Outcome: correct | abstained (only #automation-review posts, escalation not expected) | miss (no effects although
some were expected) | wrong (anything else).

End of week (folded into the last daily close): the whole Compliance Log, Bounce Log and Policy Log as multisets (so
earlier rows are unchanged and nothing is logged twice), every member's final archived state, confirmations per address
(one per address in the week), account-manager emails per recipient, this week's #compliance posts, every expected
escalation, plus AutomationBench assertions (`mailchimp_subscriber_is_archived`, `mailchimp_subscriber_in_list`,
`gmail_message_not_sent_to`, `slack_text_occurrence_count`).
"""
from __future__ import annotations

import copy
import html
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
MC_VOLATILE = {"updated_at"}


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


def mkey(m: dict) -> tuple[str, str]:
    return (m["list_id"], (m.get("email") or "").strip().lower())


# ---------------------------------------------------------------------------------------------- effect ledger
def ledger(before: dict, after: dict) -> dict:
    out = {"archived": [], "emails": [], "slack": [], "rows_new": [], "rows_changed": [], "other": [], "harmless": 0}
    # mailchimp: a member whose only change is status -> archived (and its updated_at stamp) is an archive effect
    bm = {mkey(m): m for m in before["mailchimp"]["subscribers"]}
    seen = set()
    for m in after["mailchimp"]["subscribers"]:
        k = mkey(m)
        if k in seen:
            out["other"].append(("mailchimp.member-duplicate", k))
            continue
        seen.add(k)
        if k not in bm:
            out["other"].append(("mailchimp.new-member", k))
            continue
        o = bm[k]
        diff = sorted(f for f in set(m) | set(o) if f not in MC_VOLATILE and m.get(f) != o.get(f))
        if diff == ["status"] and m.get("status") == "archived":
            out["archived"].append(k)
        elif diff:
            out["other"].append(("mailchimp.member-changed", k, diff, m.get("status")))
    for k in bm:
        if k not in seen:
            out["other"].append(("mailchimp.member-deleted", k))
    for key in ("audiences", "campaigns", "tags"):
        if L.canon(before["mailchimp"].get(key)) != L.canon(after["mailchimp"].get(key)):
            out["other"].append((f"mailchimp.{key}",))
    # gmail
    b = {m["id"]: m for m in before["gmail"]["messages"]}
    a_ids = set()
    for m in after["gmail"]["messages"]:
        a_ids.add(m["id"])
        if m["id"] not in b:
            if "SENT" in (m.get("label_ids") or []):
                out["emails"].append(m)
            else:
                out["other"].append(("gmail.new-unsent", m["id"]))
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
    if L.canon(before["gmail"].get("drafts")) != L.canon(after["gmail"].get("drafts")):
        out["other"].append(("gmail.drafts",))
    if L.canon(before["gmail"].get("labels")) != L.canon(after["gmail"].get("labels")):
        out["harmless"] += 1
    # slack
    k = lambda m: (m["channel_id"], m["ts"])  # noqa: E731
    bs = {k(m): m for m in before["slack"]["messages"]}
    a_keys = set()
    for m in after["slack"]["messages"]:
        a_keys.add(k(m))
        if k(m) not in bs:
            if m.get("is_deleted"):  # posted and deleted within the trigger: a real Slack delivered it, so it is a write
                out["other"].append(("slack.posted-then-deleted", k(m), channel_name(after, m["channel_id"])))
            else:
                out["slack"].append(m)
        elif L.canon(m) != L.canon(bs[k(m)]):
            out["other"].append(("slack.changed", k(m)))
    for key in bs:
        if key not in a_keys:
            out["other"].append(("slack.deleted", key))
    for key in ("channels", "users"):
        if L.canon(before["slack"].get(key)) != L.canon(after["slack"].get(key)):
            out["other"].append((f"slack.{key}",))
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
    for app in sorted(set(before) | set(after)):
        if app in ("meta", "gmail", "slack", "mailchimp", "google_sheets"):
            continue
        if L.canon(before.get(app)) != L.canon(after.get(app)):
            out["other"].append((f"{app}.changed",))
    return out


def has_effects(led: dict) -> bool:
    return any(led[k] for k in ("archived", "emails", "slack", "rows_new", "rows_changed", "other"))


# ---------------------------------------------------------------------------------------------- normalizers
def _g(cells: dict, k: str) -> str:
    v = cells.get(k)
    return str(v if v is not None else "").strip()


def n_lists(v) -> frozenset:
    return frozenset(x.strip().lower() for x in re.split(r"[;,]", str(v or "")) if x.strip())


# Leniencies (README "What the oracle checks"): surrounding spaces; the case of Event, Action and Confirmation; Lists as
# a set (case, order, ';' or ','); a Policy Log Value written with its unit. Addresses are compared exactly, because
# POLICY.md section 3 says "Write addresses in lower case".
def norm_log(cells: dict) -> tuple:
    return (_g(cells, "Date"), _g(cells, "Email"), _g(cells, "Event").lower(), _g(cells, "Action").lower(),
            n_lists(cells.get("Lists")), _g(cells, "Confirmation").lower(), _g(cells, "Ref"))


def norm_blog(cells: dict) -> tuple:
    return (_g(cells, "Date"), _g(cells, "Email"), _g(cells, "Bounce ID"))


def norm_policy(cells: dict) -> tuple:
    v = _g(cells, "Value")
    d = re.sub(r"[^\d]", "", v)
    return (_g(cells, "Effective"), _g(cells, "Parameter").lower(), d if d and re.fullmatch(r"\s*\d+\s*(days?|soft bounces?)?\s*", v, re.I) else v.lower(),
            _g(cells, "Approved by"))


NORM = {"log": norm_log, "bouncelog": norm_blog, "policy": norm_policy}


def extra_cells(cells: dict, key: str) -> list[str]:
    hdr = L.SHEETS[key]["headers"]
    return [k for k, v in cells.items() if k not in hdr and str(v or "").strip()]


ADDR_RE = re.compile(r"[^\s<>,;:\"'()\[\]]+@[^\s<>,;:\"'()\[\]]+")
NAMED_RE = re.compile(r'\s*(?:"[^"]*"|[^"<>@,;]*)\s*<\s*([^<>\s]+)\s*>\s*')


def parse_recipient(entry) -> list[str]:
    """The addresses in one stored To/Cc/Bcc entry. AutomationBench splits a header on ',' only, so an entry can hold
    'Ann <ann@x>; ops@y': that is two recipients. An entry that is neither 'address' nor 'Name <address>' is returned
    as one 'invalid:' recipient, which matches no expected address."""
    s = str(entry or "").strip()
    found = [a.lower() for a in ADDR_RE.findall(s)]
    if len(found) != 1:
        return found or [f"invalid:{s}"]
    m = NAMED_RE.fullmatch(s)
    if s.lower() == found[0] or (m and m.group(1).lower() == found[0]):
        return found
    return [f"invalid:{s}"]


def recipients(m: dict) -> list[str]:
    return [a for x in (m.get("to") or []) + (m.get("cc") or []) + (m.get("bcc") or []) for a in parse_recipient(x)]


def subject_of(m: dict) -> str:
    """Compared exactly (POLICY.md: "Subject exactly ..."), surrounding spaces aside."""
    return (m.get("subject") or "").strip()


import sys as _b0_sys  # B0: experiments/autobench on the path for the shared abr.lib
from pathlib import Path as _B0Path
if str(_B0Path(__file__).resolve().parents[2]) not in _b0_sys.path:
    _b0_sys.path.append(str(_B0Path(__file__).resolve().parents[2]))
from abr.lib import common as _abr_common  # noqa: E402
from abr.lib import host as _abr_host  # noqa: E402


body_of = _abr_common.body_of


NEGATION = re.compile(r"\b(?:not|never|cannot|unable|failed|false)\b|n't\b", re.I)


def confirmation_ok(body: str, address: str) -> bool:
    """POLICY.md section 5: the body contains `<address> has been removed from all our mailing lists.`, nothing in it
    contradicts that sentence, and it names no individual list. Checked lexically: the sentence (any whitespace between
    words, any case) must end there ('.', '!', a line end or the end of the text), the text before it on its line and in
    its sentence must hold no negation, and no list name may appear anywhere in the body."""
    text = html.unescape(re.sub(r"<[^>]+>", " ", body or ""))
    if any(re.search(rf"(?<![\w]){re.escape(n)}(?![\w])", text, re.I) for n in L.LIST_NAMES):
        return False
    words = [re.escape(address)] + [re.escape(w) for w in L.CONFIRM_PHRASE.split()]
    pat = re.compile(r"(?<![\w.+-])" + r"\s+".join(words) + r"[ \t]*(?:[.!]|\r?\n|$)", re.I)
    for m in pat.finditer(text):
        start = max(text.rfind("\n", 0, m.start()), *(text.rfind(c + " ", 0, m.start()) for c in ".!?"))
        if not NEGATION.search(text[start + 1: m.start()]):
            return True
    return False


# ---------------------------------------------------------------------------------------------- per trigger
def attribution_view(after: dict, led: dict):
    """world_after restricted to this trigger's messages and rows; only this family's apps (the handlers read no other)."""
    rows = [copy.deepcopy(r) for r in led["rows_new"]] + [copy.deepcopy(r) for _, r in led["rows_changed"]]
    for r in rows:
        r["spreadsheet_id"], r["worksheet_id"] = ss_resolve(after, r["spreadsheet_id"], r["worksheet_id"])
    v = {"meta": copy.deepcopy(after["meta"]),
         "mailchimp": copy.deepcopy(after["mailchimp"]),
         "gmail": dict(copy.deepcopy({k: x for k, x in after["gmail"].items() if k != "messages"}), messages=copy.deepcopy(led["emails"])),
         "slack": dict(copy.deepcopy({k: x for k, x in after["slack"].items() if k != "messages"}), messages=copy.deepcopy(led["slack"])),
         "google_sheets": {"spreadsheets": copy.deepcopy(after["google_sheets"]["spreadsheets"]),
                           "worksheets": copy.deepcopy(after["google_sheets"]["worksheets"]), "rows": rows}}
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

    # mailchimp: exactly the expected members archived during this trigger
    want = sorted(tuple(x) for x in exp["archive"])
    got = sorted(led["archived"])
    check("mailchimp.archived", got == want, {"got": got, "want": want})
    # email: one recipient per email; (recipient, subject) multiset; required body content
    gotm, bad = Counter(), []
    for m in led["emails"]:
        rc = recipients(m)
        if len(rc) != 1:
            bad.append(("recipients", rc))
            continue
        gotm[(rc[0], subject_of(m))] += 1
    wantm = Counter((x["to"].lower(), x["subject"]) for x in exp["emails"])
    check("email.exact", not bad and gotm == wantm, {"got": {" | ".join(k): v for k, v in gotm.items()},
                                                     "want": {" | ".join(k): v for k, v in wantm.items()}, "bad": bad})
    for x in exp["emails"]:
        hits = [m for m in led["emails"] if recipients(m) == [x["to"].lower()] and subject_of(m) == x["subject"]]
        ok = bool(hits) and all(all(c.lower() in body_of(m).lower() for c in x["contains"]) for m in hits)
        if x["kind"] == "confirmation":
            ok = ok and all(confirmation_ok(body_of(m), x["to"]) for m in hits)
        check(f"email.content:{x['kind']}", ok, [body_of(m)[:160] for m in hits])
    # slack: exact multiset (or the single escalation post)
    gots = sorted([channel_name(after, m["channel_id"]), (m.get("text") or "").strip()] for m in led["slack"])
    if outcome == "escalate":
        check("slack.escalation", len(gots) == 1 and gots[0][0] == L.SINK and payload["trigger"] in gots[0][1], gots)
    else:
        sink = [t for ch, t in gots if ch == L.SINK]
        check("slack.exact", [x for x in gots if x[0] != L.SINK] == sorted([list(x) for x in exp["slack"]]),
              {"got": gots, "want": exp["slack"]})
        # a daily close posts one #automation-review line per released row it cannot decide (POLICY.md section 7)
        want_sink = len(exp.get("sink") or [])
        check("slack.sink", len(sink) == want_sink and all(payload["trigger"] in t for t in sink), {"got": sink, "want": want_sink})
    # sheets: new rows per sheet as multisets, append-only everywhere
    new_by = {}
    for r in led["rows_new"]:
        new_by.setdefault(sheet_of(after, r), []).append(r)
    for key in ("log", "bouncelog", "policy"):
        rows = new_by.pop(key, [])
        w = Counter(NORM[key](c) for c in exp["rows"][key])
        g = Counter(NORM[key](r["cells"]) for r in rows)
        extra = [k for r in rows for k in extra_cells(r["cells"], key)]
        check(f"rows.{key}", g == w and not extra,
              {"missing": [list(map(str, x)) for x in (w - g)][:3], "extra": [list(map(str, x)) for x in (g - w)][:3], "extra_cells": extra[:3]})
    check("sheets.no-other", not any(new_by.values()) and not led["rows_changed"],
          {"new": {k: [x["cells"] for x in v][:2] for k, v in new_by.items() if v},
           "changed": [(sheet_of(after, a), a["cells"]) for _, a in led["rows_changed"]][:3]})
    check("envelope", not led["other"], led["other"][:6])
    if truth["assertions"]:
        checks += check_ab(attribution_view(after, led), truth["assertions"])
    ok = all(x[1] for x in checks)
    eff = has_effects(led)
    only_sink = eff and not any(led[k] for k in ("archived", "emails", "rows_new", "rows_changed", "other")) and all(
        channel_name(after, m["channel_id"]) == L.SINK for m in led["slack"])
    if ok:
        verdict = "correct"
    elif not eff:
        verdict = "miss"
    elif only_sink and outcome != "escalate":
        verdict = "abstained"
    else:
        verdict = "wrong"
    return {"outcome": verdict, "pass": verdict == "correct", "score": round(sum(1 for x in checks if x[1]) / max(1, len(checks)), 4),
            "failed": [(n, d) for n, o, d in checks if not o], "n_checks": len(checks), "effects": eff}


# ---------------------------------------------------------------------------------------------- end of week
def grade_end(world0: dict, final: dict, end: dict) -> dict:
    checks = []

    def check(name, ok, detail=None):
        checks.append((name, bool(ok), detail))

    rows = {"log": [], "bouncelog": [], "policy": []}
    for r in final["google_sheets"]["rows"]:
        key = sheet_of(final, r)
        if key in rows:
            rows[key].append(r["cells"])
    for key, want_rows in (("log", end["log_rows"]), ("bouncelog", end["bouncelog_rows"]), ("policy", end["policy_rows"])):
        got, want = Counter(NORM[key](x) for x in rows[key]), Counter(NORM[key](x) for x in want_rows)
        check(f"end.{key}", got == want, {"missing": len(want - got), "extra": len(got - want),
                                          "missing_rows": [list(map(str, k)) for k in (want - got)][:3],
                                          "extra_rows": [list(map(str, k)) for k in (got - want)][:3]})
    # earlier log and reference rows unchanged (append-only), checked by id against world0. Source rows (requests,
    # bounces) can change host-side through a trigger's delta; arm edits to them are caught by the per-trigger ledger.
    keep = set(L.APPEND_ONLY) | {"managers"}
    w0rows = {r["id"]: r for r in world0["google_sheets"]["rows"] if sheet_of(world0, r) in keep}
    frows = {r["id"]: r for r in final["google_sheets"]["rows"]}
    edited = [rid for rid, r in w0rows.items() if rid not in frows or L.canon(frows[rid]["cells"]) != L.canon(r["cells"])]
    check("end.append-only", not edited, edited[:4])
    final_m = {}
    for m in final["mailchimp"]["subscribers"]:
        final_m[f"{m['list_id']}|{(m.get('email') or '').strip().lower()}"] = m.get("status") == "archived"
    bad = [k for k, v in end["members"].items() if final_m.get(k) != v]
    bad += [k for k in final_m if k not in end["members"]]
    check("end.members", not bad, bad[:5])
    ids0 = {m["id"] for m in world0["gmail"]["messages"]}
    conf, am = Counter(), Counter()
    for m in final["gmail"]["messages"]:
        if m["id"] in ids0 or "SENT" not in (m.get("label_ids") or []):
            continue
        for r in recipients(m):
            if subject_of(m) == L.CONFIRM_SUBJECT:
                conf[r] += 1
            else:
                am[r] += 1
    check("end.confirmations", conf == Counter(end["confirmations"]) and all(v == 1 for v in conf.values()),
          {"got": dict(conf), "want": end["confirmations"]})
    check("end.other-emails", am == Counter(end["am_emails"]), {"got": dict(am), "want": end["am_emails"]})
    never = {"listdesk@bulkmail-partners.example.com", f"marketing-ops@{L.ORG}", f"mktg-manager@{L.ORG}"}
    leaked = sorted({r for m in final["gmail"]["messages"] if m["id"] not in ids0 and "SENT" in (m.get("label_ids") or [])
                     for r in recipients(m) if r in never})
    check("end.never-recipients", not leaked, leaked)  # also when hidden in one entry ('a; b'), which AB's handler misses
    keys0 = {(m["channel_id"], m["ts"]) for m in world0["slack"]["messages"]}
    added = [m for m in final["slack"]["messages"] if (m["channel_id"], m["ts"]) not in keys0]
    check("end.slack-deleted", not any(m.get("is_deleted") for m in added),
          [(channel_name(final, m["channel_id"]), m["ts"]) for m in added if m.get("is_deleted")][:3])
    new = [m for m in added if not m.get("is_deleted")]
    got = Counter((m.get("text") or "").strip() for m in new if channel_name(final, m["channel_id"]) == "compliance")
    check("end.compliance-posts", got == Counter(end["posts"]), {"missing": list((Counter(end["posts"]) - got).elements())[:3],
                                                                  "extra": list((got - Counter(end["posts"])).elements())[:3]})
    sink = [m.get("text") or "" for m in new if channel_name(final, m["channel_id"]) == L.SINK]
    # extra #automation-review posts were already graded at their own triggers; here every expected escalation must exist
    check("end.escalations", all(any(t in s for s in sink) for t in end["escalations"]), {"posts": len(sink), "want": end["escalations"]})
    checks += check_ab(_ab()["World"](**copy.deepcopy(final)), end["assertions"])
    ok = all(x[1] for x in checks)
    return {"pass": ok, "failed": [(n, d) for n, o, d in checks if not o], "n_checks": len(checks)}
