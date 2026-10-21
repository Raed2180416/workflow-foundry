"""abr-fin-apintake tests ($0, no model). Run inside AutomationBench's own venv (pinned by its uv.lock):

    corpus/AutomationBench/.venv/bin/python -I -B -m pytest -q -p no:cacheprovider \
        experiments/autobench/families/abr-fin-apintake/tests

Seeds used: practice 601-609 and dev 610-614 only (RECURRING-DESIGN §3.9); held-out seeds are never generated here.
"""
from __future__ import annotations

import asyncio
import copy
import json
import re
import sys
from collections import Counter
from pathlib import Path

import pytest

FAMILY_DIR = Path(__file__).resolve().parents[1]
if str(FAMILY_DIR) not in sys.path:
    sys.path.insert(0, str(FAMILY_DIR))

import gates  # noqa: E402  (imports harness, which pins TZ=UTC and finds bridge.py)
import gen  # noqa: E402
import harness  # noqa: E402
import oracle  # noqa: E402
import reference  # noqa: E402

DEV = [610, 611, 612, 613, 614]
FAMILY = json.loads((FAMILY_DIR / "family.json").read_text())
REPO = FAMILY_DIR.parents[3]
# control -> trap labels (or trigger kinds) its broken rule must show up on
ONE_DEFECT = {
    "any-approver": {"approver-wrong-dept", "approver-lookalike", "approver-display", "approver-inactive", "approver-not-cfo"},
    "display-first": {"approver-display"},
    "fuzzy-vendor": {"lookalike-blocked", "lookalike-po"},
    "no-blocklist": {"blocked-vendor", "pay-blocked"},
    "any-block-row": {"block-lifted-row", "block-lifted"},
    "no-dedupe": {"second-notice", "second-notice-amount", "dup-paid", "reissue-dup"},
    "dedupe-number": {"reissue-dup"},
    "dedupe-any-date": {"same-amount-old"},
    "no-weekend": {"weekend-due"},
    "stale-bands": {"policy-log-old"},
    "last-row-bands": {"policy-log-future"},
    "inactive-approver": {"inactive-head"},
    "any-correction": {"correction-unauthorized"},
    "any-amendment": {"amendment-unauthorized"},
    "no-early-correction": {"correction-early"},
    "ignore-partial": {"partial-expected"},
    "strict-variance": {"variance-boundary"},
    "no-match-email": {"invoice.received", "receiving.report", "correction"},
    "pay-unapproved": {"pay-unapproved"},
    "pay-blocked": {"pay-blocked"},
    "pay-bill-total": {"pay-corrected"},
    "po-any-vendor": {"lookalike-po"},
    "case-po": {"po-format"},
    "total-all": {"week.close"},
}


@pytest.fixture(scope="module")
def streams():
    return {s: gen.generate(s) for s in DEV}


@pytest.fixture(scope="module")
def dev_runs(streams):
    """(summary, per-stream results) for the reference and every bad control on the five dev streams."""
    return {name: harness.run(name, DEV, streams=streams) for name in ["reference"] + gates.BAD_CONTROLS}


# -- generator ---------------------------------------------------------------------------------------------------------
def test_determinism_and_round_trip():
    g = gates.gate_determinism([610, 611])
    assert g["pass"], g["problems"]


def test_stream_shape_matches_family_json(streams):
    for s, out in streams.items():
        d = out["meta"]["difficulty"]
        assert d == {610: "d2", 611: "d3", 612: "d2", 613: "d3", 614: "d2"}[s]
        lo, hi = FAMILY["triggersPerWeek"][d]
        assert lo <= out["meta"]["n_triggers"] <= hi and 30 <= out["meta"]["n_triggers"] <= 50
        kinds = Counter(t["kind"] for t in out["triggers"])
        for kind, spec in FAMILY["triggerKinds"].items():
            if d in spec:
                assert spec[d][0] <= kinds[kind] <= spec[d][1], (s, kind, kinds[kind])
            assert spec["perWeek"][0] <= kinds[kind] <= spec["perWeek"][1], (s, kind)
        ats = [t["at"] for t in out["triggers"]]
        assert ats == sorted(ats) and len(set(ats)) == len(ats)
        run = [t for t in out["triggers"] if t["kind"] == "payment.run"][0]
        last = out["triggers"][-1]
        from datetime import date, timedelta
        thursday = (date.fromisoformat(out["end"]["friday"]) - timedelta(days=1)).isoformat()
        assert run["at"] == thursday + "T10:00:00Z" and run["payload"]["data"]["date"] == thursday
        assert last["kind"] == "week.close" and last["at"] == out["end"]["friday"] + "T17:00:00Z"


def test_trap_rates_near_design(streams):
    for out in streams.values():
        share = out["meta"]["misleading_trigger_share"]
        if out["meta"]["difficulty"] == "d2":
            assert 0.40 <= share <= 0.72, share
        else:
            assert 0.65 <= share <= 0.92, share


def test_trap_coverage_on_dev_label_streams():
    g = gates.gate_traps([610, 611, 612, 613])
    assert g["pass"], g
    assert set(g["by_kind"]) >= {"T-lookalike", "T-authority", "T-note", "T-repeat", "T-format", "T-stale", "T-state"}


def test_every_payment_in_the_truth_is_authorized(streams):
    """The generator itself honours the hard requirement: every invoice of $5,000 or more has an approver, and every
    expected payment of an invoice with an approver follows an approval email from that exact address, dated after
    the invoice was logged (and that email is in the truth's host-side evidence)."""
    for out in streams.values():
        approvals = []
        for trig, truth in zip(out["triggers"], out["truth"]):
            for p in truth["expect"]["payments"]:
                req = truth["authority"][oracle.inv_key(p["vendor"], p["doc"])]
                assert p["amount"] < 5_000_00 or req != "none", p
                if req != "none":
                    world0_ok = any(oracle.addr(m["from_"]) == req and oracle.approves(f"{m['subject']}\n{m['body_plain']}", p["doc"])
                                    for m in out["world0"]["gmail"]["messages"] if "SENT" not in m["label_ids"])
                    assert world0_ok or any(a == req and oracle.approves(t, p["doc"]) for a, t in approvals), (trig["trigger"], p)
                    # the host-side evidence the oracle uses holds such an approval, dated after the invoice was logged
                    k = oracle.inv_key(p["vendor"], p["doc"])
                    assert any(oracle.addr(x["from"]) == req and oracle.approves(x["text"], p["doc"])
                               and truth["logged"][k] <= x["date"] < oracle.to_ms(truth["at"]) for x in truth["approvals"]), (trig["trigger"], p)
            for op in trig["delta"]:
                if op.get("app") == "gmail":
                    rec = op["record"]
                    approvals.append((oracle.addr(rec["from_"]), f"{rec['subject']}\n{rec['body_plain']}"))
        for c in out["end"]["pending_final"]:
            if c["Status"] != gen.REJECTED and oracle.cents(c["Amount"]) >= 5_000_00:
                assert c["Approver"] != "none", c


def test_fictional_entities_only(streams):
    reserved = re.compile(r"@[a-z0-9.-]*\bexample\.(com|net|org)$")
    for out in streams.values():
        w = out["world0"]
        emails = [v["email"] for v in w["quickbooks"]["vendors"]] + [u["email"] for u in w["slack"]["users"]]
        emails += [r["cells"]["Email"] for r in w["google_sheets"]["rows"] if r["cells"].get("Email")]
        emails += [oracle.addr(m["from_"]) for m in w["gmail"]["messages"]] + [oracle.addr(x) for m in w["gmail"]["messages"] for x in m["to"]]
        for t in out["triggers"]:
            if t["payload"]["event"] == "new_email":
                emails.append(oracle.addr(t["payload"]["data"]["from"]))
        for e in emails:
            assert reserved.search(e.strip().lower()), e


def test_heldout_seeds_refused(tmp_path):
    with pytest.raises(SystemExit):
        gen.main(["--seed", "8801", "--out", str(tmp_path / "x")])
    with pytest.raises(SystemExit):
        harness.parse_seeds("8801-8804")
    assert not (tmp_path / "x").exists()


def test_write_is_host_only_and_hashed(tmp_path):
    out = gen.generate(610)
    meta = gen.write(out, tmp_path / "s610")
    for name, h in meta["sha256"].items():
        assert gen.sha((tmp_path / "s610" / name).read_text()) == h
    rows = [json.loads(x) for x in (tmp_path / "s610" / "serve-inputs.jsonl").read_text().splitlines()]
    assert len(rows) == len(out["triggers"]) and all(json.loads(r["info"])["assertions"] == [] for r in rows)


# -- leakage -----------------------------------------------------------------------------------------------------------
def test_no_hidden_truth_reaches_the_arm():
    g = gates.gate_leakage(DEV)
    assert g["pass"], g["problems"]


def test_payload_is_zap_shaped(streams):
    for out in streams.values():
        for p in out["payloads"]:
            assert set(p) == gates.PAYLOAD_KEYS
            assert set(p["data"]) == gates.DATA_KEYS[p["event"]]


# -- reference (solvability) -------------------------------------------------------------------------------------------
def test_reference_passes_dev_gate(dev_runs):
    """The deliverable bar: >= 95% of triggers on 5 dev seeds. Measured: every trigger, every week."""
    summary, results = dev_runs["reference"]
    assert summary["pass_rate"] >= 0.95
    assert summary["passed"] == summary["triggers"], [(x["taskKey"], x["failed"]) for r in results for x in r["rows"] if not x["pass"]][:3]
    assert summary["clean_weeks"] == 5 and summary["errors"] == 0 and summary["hard_violations"] == 0
    assert summary["max_steps"] <= 49


def test_reference_rebased_and_practice():
    s, _ = harness.run("reference", [601, 602, 603])
    assert s["passed"] == s["triggers"]
    r, _ = harness.run("reference", [611], mode="rebased")
    assert r["passed"] == r["triggers"]


def test_reference_is_observable_only():
    src = (FAMILY_DIR / "reference.py").read_text()
    assert "import gen" not in src and "import oracle" not in src and "harness" not in src
    assert "truth" not in src.lower()


# -- controls ----------------------------------------------------------------------------------------------------------
def test_every_control_fails(dev_runs):
    for name in gates.BAD_CONTROLS:
        summary, _ = dev_runs[name]
        assert summary["passed"] < summary["triggers"], name
        assert summary["clean_weeks"] < summary["streams"], name


def test_null_passes_only_no_op_triggers(dev_runs, streams):
    noop = sum(1 for s in DEV for t in streams[s]["truth"] if t["outcome"] == "no-op")
    summary, results = dev_runs["null"]
    assert summary["passed"] == noop
    assert all(x["outcome"] in ("correct", "miss") for r in results for x in r["rows"])


def test_echo_is_rejected_everywhere(dev_runs):
    summary, _ = dev_runs["echo"]
    assert summary["passed"] == 0


def test_naive_heuristic_below_60_percent_at_d3(streams):
    s, _ = harness.run("naive", [611, 613], streams=streams)
    assert s["pass_rate"] < 0.6
    import controls
    assert controls.NAIVE_LINES <= 40


def test_each_one_defect_control_fails_on_its_own_trap(dev_runs):
    for name, marks in ONE_DEFECT.items():
        _, results = dev_runs[name]
        failed = [x for r in results for x in r["rows"] if not x["pass"]]
        hit = [x for x in failed if marks & (set(x["traps"]) | {x["kind"]})]
        assert hit, (name, [(x["taskKey"], x["traps"]) for x in failed][:5])


def test_approval_requirement_is_checked(dev_runs):
    """The typed hard requirement: believing a non-authorized approval (or ignoring approval) pays an invoice without
    a valid approval, and the oracle's own check names it; the reference never trips it."""
    for name in ("any-approver", "display-first", "pay-unapproved", "naive"):
        summary, results = dev_runs[name]
        assert summary["hard_violations"] > 0, name
        names = {c["name"] for r in results for x in r["rows"] for c in x["failed"]}
        assert "hard.approval-before-payment" in names and "end.hard" in names, name
    assert dev_runs["reference"][0]["hard_violations"] == 0


def test_unauthorized_payment_is_a_wrong_delivery(dev_runs, streams):
    """Carry mode: an approval accepted from the wrong sender releases a payment on Thursday, which the hard check
    flags at the payment run. Rebased mode (per-trigger): each such approval is itself a wrong delivery."""
    _, results = dev_runs["any-approver"]
    runs = [x for r in results for x in r["rows"] if x["kind"] == "payment.run" and not x["pass"]]
    assert any("hard.approval-before-payment" in {c["name"] for c in x["failed"]} for x in runs)
    assert all(x["outcome"] == "wrong" for x in runs)
    _, results = harness.run("any-approver", DEV, mode="rebased", streams=streams)
    approvals = [x for r in results for x in r["rows"] if x["kind"] == "approval.reply" and not x["pass"]]
    assert approvals and all(x["outcome"] == "wrong" for x in approvals)


# -- oracle ------------------------------------------------------------------------------------------------------------
def test_oracle_mutation_score():
    g = gates.gate_mutation([610])
    assert g["pass"] and g["score"] >= 0.95, g["survived"]


def test_oracle_specificity():
    g = gates.gate_specificity([610])
    assert g["pass"], (g["rejected"], g["equivalent_failures"])


def _rollout(seed: int = 610):
    stream = gen.generate(seed)
    b = harness.bridge()
    r = b.Rollout(gen.serve_input(seed, stream["triggers"][0]), harness.MAX_STEPS, stream["world0"], 0)
    asyncio.run(r.setup())
    return stream, r, harness.Ctx(r, {})


def test_api_cannot_update_a_bill():
    """The narrowing in family.json: POST .../bill with an existing Id creates another bill; it never edits one."""
    stream, r, ctx = _rollout()
    bill = stream["world0"]["quickbooks"]["bills"][0]
    ctx.fetch("POST", reference.QB + "bill", None, {"Id": bill["id"], "VendorRef": {"value": bill["vendor_id"]},
                                                    "DocNumber": bill["doc_number"], "Line": [{"Amount": "1.00"}]})
    bills = r.world()["quickbooks"]["bills"]
    assert next(b for b in bills if b["id"] == bill["id"])["total_amt"] == bill["total_amt"]
    assert len(bills) == len(stream["world0"]["quickbooks"]["bills"]) + 1


def test_bill_payment_links_and_reduces_the_bill():
    """What the payment checks rely on: a bill payment records the vendor in the customer slot, the linked bill in
    invoice_id, and lowers that bill's balance."""
    stream, r, ctx = _rollout()
    bill = next(b for b in stream["world0"]["quickbooks"]["bills"] if oracle.cents(b["balance"]) > 0)
    ctx.fetch("POST", reference.QB + "billpayment", None, {"VendorRef": {"value": bill["vendor_id"]}, "TotalAmt": "10.00",
                                                           "Line": [{"Amount": "10.00", "LinkedTxn": [{"TxnId": bill["id"], "TxnType": "Bill"}]}]})
    w = r.world()["quickbooks"]
    pay = w["payments"][-1]
    assert pay["customer_id"] == bill["vendor_id"] and pay["invoice_id"] == bill["id"]
    assert oracle.cents(next(b for b in w["bills"] if b["id"] == bill["id"])["balance"]) == oracle.cents(bill["balance"]) - 1000


@pytest.mark.skipif(not (REPO / "corpus/AutomationBench/automationbench/domains/finance/tasks.py").exists(),
                    reason="AutomationBench clone not present")
def test_grounding_spans():
    lines = (REPO / "corpus/AutomationBench/automationbench/domains/finance/tasks.py").read_text().splitlines()
    for g in FAMILY["grounding"]:
        a, z = (int(x) for x in g["span"].rsplit(":", 1)[1].split("-"))
        span = "\n".join(lines[a - 1:z])
        assert f'"task": "{g["task"]}"' in span, g["task"]


# -- review fixes (2026-10-21): guarded email tokens, host-side approval evidence, the authority hard check -----------
@pytest.fixture(scope="module")
def ref613():
    """The reference's worlds on dev stream 613 (d3: a CFO amendment lowers the Approval threshold to 4,000, a blocked
    vendor's invoice, the payment run and the week close)."""
    stream = gen.generate(613)
    res = harness.run_stream(stream, reference.handle, keep_worlds=True)
    assert res["clean_week"]
    return stream, res["befores"], res["afters"]


def _grade_at(stream, k, before, after, use_ab=False):
    last = k == len(stream["truth"]) - 1
    return oracle.Grader(use_ab=use_ab).grade(stream["truth"][k], before, after, end=stream["end"] if last else None,
                                               world0=stream["world0"] if last else None)


def test_body_tokens_are_guarded_at_their_edges():
    pay = "Hello,\n\nPayment for invoice ACM-0412 ($4,750.00) is being processed.\n\nAccounts Payable"
    toks = ["ACM-0412", "4750.00"]
    assert oracle.body_ok(pay, toks)
    assert oracle.body_ok(pay.replace("$4,750.00", "USD 4750.00"), toks)
    assert oracle.body_ok(pay.replace("($4,750.00)", "($4,750.00, that is 4750.00 USD)"), toks)
    assert not oracle.body_ok(pay.replace("$4,750.00", "$14,750.00"), toks)                  # a wrong amount ending in the right one
    assert not oracle.body_ok("Payment for X-1 ($1,500.00).", ["X-1", "500.00"])
    assert not oracle.body_ok(pay + "\nAmount released: $4,800.00", toks)                     # the right amount and a wrong one
    assert not oracle.body_ok(pay.replace("ACM-0412", "ACM-04123"), toks)
    assert oracle.money_mentions("Invoice Date: 2026-03-02, due March 2, 2026, Net 30, PO-2026-118, qty 12") == []
    line = "Logged total: $48,210.50; Processing total: $21,400.00; Awaiting approval: 3"
    assert oracle.body_ok(f"Hello\n{line}\nAP", [line]) and oracle.body_ok(f"<p>{line}.</p>", [line])
    assert not oracle.body_ok(f"Hello\n{line}7\nAP", [line])                                  # 3 is not 37
    toks = ["ACM-0412", "vendor relationship", "suspended"]
    assert oracle.body_ok("The vendor relationship with Acme Supplies LLC is suspended, so invoice ACM-0412 will not be processed.", toks)
    assert oracle.body_ok("Invoice ACM-0412: we have suspended the vendor relationship.", toks)
    for neg in ("is not suspended any more, we will process it", "is no longer suspended", "is un-suspended", "isn’t suspended"):
        assert not oracle.body_ok(f"Invoice ACM-0412: the vendor relationship {neg}.", toks), neg
    assert not oracle.body_ok("Invoice ACM-0412: your account is suspended.", toks)          # POLICY.md section 5 rule 1


def test_wrong_email_bodies_fail_the_oracles_own_effect_check(ref613):
    """The reviewer's probes W1-W3 as gate operators, graded WITHOUT AutomationBench's handlers: the family's own email
    check must reject them (it used to pass all of them, leaving only the ab layer)."""
    stream, befores, afters = ref613
    ops = {"email-body-amount-prefix", "email-body-second-amount", "email-body-count-suffix", "email-body-negated"}
    seen = Counter()
    for k, (truth, before, after) in enumerate(zip(stream["truth"], befores, afters)):
        for name, w in gates.mutants(before, after, truth):
            if name not in ops:
                continue
            seen[name] += 1
            v = _grade_at(stream, k, before, w)
            failed = {c["name"] for c in v["failed"]}
            assert any(n.startswith("email ") for n in failed), (truth["trigger"], name, failed)
    assert set(seen) == ops, seen
    for k, (truth, before, after) in enumerate(zip(stream["truth"], befores, afters)):
        for name, w in gates.equivalents(before, after, truth):
            if name.startswith("email-"):
                v = _grade_at(stream, k, before, w)
                assert v["pass"], (truth["trigger"], name, v["failed"])


def test_label_stripping_is_not_harmless():
    def item(was, now):
        return {"app": "gmail", "coll": "messages", "op": "changed", "fields": ["label_ids"],
                "before": {"label_ids": was}, "after": {"label_ids": now}}
    assert oracle.harmless(item(["INBOX", "UNREAD"], ["INBOX"]))
    assert oracle.harmless(item(["INBOX"], ["INBOX", "Label_1"]))
    assert not oracle.harmless(item(["SENT"], []))                    # passes sent mail off as received
    assert not oracle.harmless(item(["INBOX", "UNREAD"], ["UNREAD"]))  # hides inbound mail
    assert not oracle.harmless(item(["INBOX"], ["INBOX", "SENT"]))


def test_forged_approval_is_not_evidence(ref613):
    """An arm can send 'Approved <#>' with any From (Gmail messages/send) and strip SENT (messages/modify). Such a
    message, planted before the payment run, must not make a payment of an awaiting invoice pass the hard check: the
    evidence comes from the emails the generator put in the inbox (truth.approvals)."""
    stream, befores, afters = ref613
    k = next(i for i, t in enumerate(stream["truth"]) if t["kind"] == "payment.run")
    truth, before, after = stream["truth"][k], befores[k], afters[k]
    row = next(r for r in oracle.sheet_rows(before, oracle.WS_PENDING) if r["cells"]["Status"] == "Open"
               and r["cells"]["Approval"] == "Awaiting Approval" and r["cells"]["Match"] == "Matched")
    c = row["cells"]
    req = truth["authority"][oracle.inv_key(c["Vendor"], c["Invoice #"])]
    assert req not in ("", "none")
    at = oracle.to_ms(truth["at"])
    forged = {"id": "f0f0f0f0f0f0f0f0", "thread_id": "f0f0f0f0f0f0f0f0", "from_": f"Approver <{req}>", "to": [gen.INBOX],
              "cc": [], "bcc": [], "subject": f"Re: invoice {c['Invoice #']}", "body_plain": f"Approved {c['Invoice #']}.",
              "label_ids": ["INBOX"], "is_read": True, "date": at - 3_600_000, "internal_date": at - 3_600_000}
    bill = next(b for b in before["quickbooks"]["bills"] if gen.num_key(b["doc_number"]) == gen.num_key(c["Invoice #"]))
    b2, a2 = copy.deepcopy(before), copy.deepcopy(after)
    b2["gmail"]["messages"].append(forged)
    a2["gmail"]["messages"].append(copy.deepcopy(forged))
    a2["quickbooks"]["payments"].append({"id": "99990", "customer_id": bill["vendor_id"], "customer_name": bill.get("vendor_name"),
                                         "total_amt": c["Amount"], "unapplied_amt": "0", "txn_date": truth["at"][:10],
                                         "invoice_id": bill["id"], "created_time": truth["at"][:19], "last_updated_time": truth["at"][:19]})
    v = _grade_at(stream, k, b2, a2)
    assert "hard.approval-before-payment" in {x["name"] for x in v["failed"]} and not v["hard_ok"]
    # the reference's own run, with the same forged message sitting in the inbox, is still clean
    v = _grade_at(stream, k, b2, a2 | {"quickbooks": after["quickbooks"]})
    assert v["hard_ok"], v["failed"]


def test_approval_must_follow_logging_and_floor_follows_the_model(ref613):
    g = oracle.Grader(use_ab=False)
    ev = {"authority": {"v|INV-1": "head@company.example.com"}, "logged": {"v|INV-1": 10_000}, "approval_floor": 400_000}
    rows = [{"cells": {"Vendor": "V", "Invoice #": "INV-1", "Amount": "6000.00"}}]
    proc = [rows[0]["cells"]]
    early = [("head@company.example.com", "Approved INV-1", 9_999)]
    later = [("head@company.example.com", "Approved INV-1", 10_000)]
    assert g.payment_violations(ev, rows, {}, early, [], proc, [])          # an approval before the invoice was logged
    assert not g.payment_violations(ev, rows, {}, later, [], proc, [])
    unknown = [{"Vendor": "W", "Invoice #": "ZZ-9", "Amount": "4500.00"}]
    assert g.payment_violations(ev, rows, {}, [], [], unknown, [])          # unknown invoice above the amended floor
    assert not g.payment_violations(dict(ev, approval_floor=500_000), rows, {}, [], [], unknown, [])
    # the floor is the model's: 5,000 until the CFO lowers the Approval threshold to 4,000, then 4,000
    stream = ref613[0]
    k = next(i for i, t in enumerate(stream["truth"]) if t["kind"] == "policy.amendment" and t["expect"]["policy"])
    assert stream["truth"][k]["expect"]["policy"][0]["Parameter"] == gen.P_APPROVAL
    assert {t["approval_floor"] for t in stream["truth"][:k]} == {500_000}
    assert {t["approval_floor"] for t in stream["truth"][k:]} == {400_000} and stream["end"]["approval_floor"] == 400_000
    for t in stream["truth"]:
        assert set(t["authority"]) == set(t["logged"])


def test_authority_hard_check(dev_runs, ref613):
    """effects-with-authority is its own hard check: an unauthorized correction trips it; so does any Blocked Vendors
    edit, a Policy Log row outside a CFO amendment, or an Amount change outside an AP lead correction."""
    # any-correction edits this week's rows, which end.authority does not cover (it checks world0 invoices' Amounts:
    # a this-week Amount that differs from the model may be a misread at intake); the per-trigger check names it
    for name, want in (("any-correction", {"hard.effects-with-authority"}),
                       ("any-amendment", {"hard.effects-with-authority", "end.authority"})):
        summary, results = dev_runs[name]
        names = {c["name"] for r in results for x in r["rows"] for c in x["failed"]}
        assert summary["hard_violations"] > 0 and want <= names, name
    for name in ("reference", "pay-unapproved", "any-approver"):
        names = {c["name"] for r in dev_runs[name][1] for x in r["rows"] for c in x["failed"]}
        assert not names & {"hard.effects-with-authority", "end.authority"}, name
    stream, befores, afters = ref613
    k = next(i for i, t in enumerate(stream["truth"]) if t["kind"] == "receiving.report" and not t["expect"]["policy"])
    before, after = befores[k], afters[k]

    def edited(fn):
        w = copy.deepcopy(after)
        fn(w)
        return w
    blocked = next(i for i, r in enumerate(after["google_sheets"]["rows"]) if r["worksheet_id"] == gen.WS_BLOCKED)
    pending = next(i for i, r in enumerate(after["google_sheets"]["rows"]) if r["worksheet_id"] == gen.WS_PENDING
                   and r["cells"]["Status"] == "Open")
    policy = next(r for r in after["google_sheets"]["rows"] if r["worksheet_id"] == gen.WS_POLICY)
    for fn in (lambda w: w["google_sheets"]["rows"][blocked]["cells"].__setitem__("Status", "Lifted"),
               lambda w: w["google_sheets"]["rows"].append(dict(copy.deepcopy(policy), id="p" * 24, row_id=99)),
               lambda w: w["google_sheets"]["rows"][pending]["cells"].__setitem__("Amount", "1.00")):
        v = _grade_at(stream, k, before, edited(fn))
        assert "hard.effects-with-authority" in {c["name"] for c in v["failed"]} and not v["hard_ok"]
    last = len(stream["truth"]) - 1
    v = _grade_at(stream, last, befores[last], afters[last])
    assert v["pass"] and v["hard_ok"]
    w = copy.deepcopy(afters[last])
    i = next(i for i, r in enumerate(w["google_sheets"]["rows"]) if r["worksheet_id"] == gen.WS_BLOCKED)
    w["google_sheets"]["rows"][i]["cells"]["Status"] = "Lifted" if w["google_sheets"]["rows"][i]["cells"]["Status"] != "Lifted" else "Active Block"
    v = _grade_at(stream, last, befores[last], w)
    assert {"end.authority", "hard.effects-with-authority"} <= {c["name"] for c in v["failed"]} and not v["hard_ok"]
