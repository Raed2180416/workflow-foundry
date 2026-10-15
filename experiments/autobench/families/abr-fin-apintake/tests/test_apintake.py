"""abr-fin-apintake tests ($0, no model). Run inside AutomationBench's own venv (pinned by its uv.lock):

    corpus/AutomationBench/.venv/bin/python -I -B -m pytest -q -p no:cacheprovider \
        experiments/autobench/families/abr-fin-apintake/tests

Seeds used: practice 601-609 and dev 610-614 only (RECURRING-DESIGN §3.9); held-out seeds are never generated here.
"""
from __future__ import annotations

import asyncio
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
    expected payment of an invoice with an approver follows an approval email from that exact address."""
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
