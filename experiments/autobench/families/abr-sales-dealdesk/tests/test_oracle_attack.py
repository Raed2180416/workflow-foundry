"""Oracle attack tests for abr-sales-dealdesk ($0, no model).

Each case takes the world exactly as an arm sees it at one trigger (the reference handled every earlier trigger), runs
a variant of the reference on that trigger, and grades it. Three groups:
  - valid alternatives the policy allows: the oracle must accept them (no false rejects);
  - tolerated representations, documented in README "What the oracle tolerates": accepted on purpose;
  - plausible-but-wrong runs: the oracle must reject them as `wrong`.

    corpus/AutomationBench/.venv/bin/python -I -m pytest -p no:cacheprovider -q \
        experiments/autobench/families/abr-sales-dealdesk/tests
"""
from __future__ import annotations

import base64
import copy
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

import pytest

FAM = Path(__file__).resolve().parents[1]
if str(FAM) not in sys.path:
    sys.path.insert(0, str(FAM))

import controls as C  # noqa: E402
import gen as G  # noqa: E402
import harness as H  # noqa: E402
import oracle as O  # noqa: E402
import reference as R  # noqa: E402

SEEDS = (611, 613)  # d3 weeks: every trigger kind, both amendments


@pytest.fixture(scope="module")
def streams():
    """Per seed: the generated week and the world before every trigger (after its delta), under the reference."""
    out = {}
    for s in SEEDS:
        g = G.generate(s)
        world = H.new_world(g["world0"])
        befores = []
        for trig in g["triggers"]:
            H.apply_delta(world, trig["delta"], trig["at"])
            befores.append(world.model_dump(mode="json"))
            R.handle(copy.deepcopy(trig["payload"]), H.Api(world))
        out[s] = (g, befores)
    return out


def _grade(streams, seed, idx, cls, edit_after=None):
    g, befores = streams[seed]
    world = H.new_world(befores[idx])
    before = world.model_dump(mode="json")
    cls(H.Api(world)).handle(copy.deepcopy(g["triggers"][idx]["payload"]))
    after = world.model_dump(mode="json")
    if edit_after:
        edit_after(before, after)
    return O.grade_trigger(before, after, g["truth"][idx], g["triggers"][idx]["payload"])


def _closing(g, idx):
    return g["truth"][idx]["expect"].get("closing")


def _opp_before(befores, idx, opp_id):
    return next(o for o in befores[idx]["salesforce"]["opportunities"] if o["id"] == opp_id)


PICK = {
    "won": lambda g, b: next(i for i, t in enumerate(g["truth"]) if t["outcome"] == "act" and t["kind"] == "deal.won"),
    "signed": lambda g, b: next(i for i, t in enumerate(g["truth"]) if t["outcome"] == "act" and t["kind"] == "deal.signed"),
    "signed-fx": lambda g, b: next((i for i, t in enumerate(g["truth"]) if t["outcome"] == "act" and t["kind"] == "deal.signed"
                                    and "currency" in t["traps"]), None),
    "described": lambda g, b: next(i for i, t in enumerate(g["truth"]) if _closing(g, i)
                                   and (_opp_before(b, i, _closing(g, i)["opp"]).get("description") or "").strip()),
    "retract": lambda g, b: next(i for i, t in enumerate(g["truth"]) if t["expect"].get("retract")),
    "escalate": lambda g, b: next(i for i, t in enumerate(g["truth"]) if t["outcome"] == "escalate"),
    "amend": lambda g, b: next(i for i, t in enumerate(g["triggers"]) if t["sub"] == "authorized"),
    "unauth": lambda g, b: next(i for i, t in enumerate(g["triggers"]) if t["sub"] == "unauthorized"),
    "week": lambda g, b: len(g["triggers"]) - 1,
}


def _raw(to, subject, body, cc=None, bcc=None):
    head = f"To: {', '.join(to)}\r\n" + (f"Cc: {', '.join(cc)}\r\n" if cc else "") + (f"Bcc: {', '.join(bcc)}\r\n" if bcc else "")
    return {"raw": base64.urlsafe_b64encode(f"{head}Subject: {subject}\r\n\r\n{body}".encode()).decode()}


def _retract_rows(dd, data):
    hdr, log = dd.sheet(R.DEAL_LOG)
    i = [k for k, r in enumerate(log) if r.get("Opportunity ID") == data["opportunity_id"] and r.get("Status") == "Announced"][-1]
    dd.post("deal-wins", f"RETRACTED: {dd.sobject('Opportunity', data['opportunity_id'])['Name']}")
    return hdr, log, i


# ---------------------------------------------------------------------------------------------- valid alternatives
class PerRecipient(R.DealDesk):
    """One email per recipient (upper-case address, prose around the facts), '#deal-wins' as the channel, and the
    Routed To cell reversed with ';'."""

    def send(self, to, subject, body):
        for r in reversed(to):
            self.call("POST", f"{R.GMAIL}/messages/send", None,
                      _raw([r.upper()], subject, f"Hello team,\n\nGreat news, this one is signed.\n\n{body}\nRegards, Deal Desk"))

    def post(self, channel, text):
        super().post("#" + channel, text)

    def append(self, ref, hdr, cells):
        if "Routed To" in cells:
            cells = dict(cells, **{"Routed To": "; ".join(reversed(cells["Routed To"].split(", ")))})
        super().append(ref, hdr, cells)


class CcRecipients(R.DealDesk):
    def send(self, to, subject, body):
        self.call("POST", f"{R.GMAIL}/messages/send", None, _raw(to[:1], subject, body, cc=to[1:]))


class DraftThenSend(R.DealDesk):
    def send(self, to, subject, body):
        d = self.call("POST", f"{R.GMAIL}/drafts", None, {"message": _raw(to, subject, body)})
        self.call("POST", f"{R.GMAIL}/drafts/send", None, {"id": d["id"]})


class WholeRowRetract(R.DealDesk):
    def on_reopen(self, p, data):
        hdr, log, i = _retract_rows(self, data)
        vals = [log[i][h] if h != "Status" else "Retracted" for h in hdr]
        self.call("PUT", f"{R.SHEETS}/{R.DEAL_LOG[0]}/values/{quote(R.DEAL_LOG[1])}!A{i + 2}:H{i + 2}", {"valueInputOption": "RAW"},
                  {"values": [vals]})


class EscalateById(R.DealDesk):
    def escalate(self, p, reason):
        self.call("POST", f"{R.SLACK}/chat.postMessage", None,
                  {"channel": "C0AUTOREVW1", "text": f"Deal desk could not decide trigger {p['trigger']} ({reason}). Please review."})


class Bookkeeping(R.DealDesk):
    """Also sets IsClosed/IsWon, Probability 100 and CloseDate = the close date when closing from an envelope."""

    def announce(self, p, data, opp, amount, currency, close_date, log_hdr, updates):
        if updates:
            updates = dict(updates, IsClosed=True, IsWon=True, Probability=100, CloseDate=close_date)
        return super().announce(p, data, opp, amount, currency, close_date, log_hdr, updates)


class ProseBody(R.DealDesk):
    """A chattier body that quotes the account, its parent, the envelope's typed deal name and the original amount
    in its own currency (no `$`)."""

    def announce(self, p, data, opp, amount, currency, close_date, log_hdr, updates):
        acct = self.sobject("Account", opp["AccountId"])
        parent = self.sobject("Account", acct["ParentId"])["Name"] if acct.get("ParentId") else "none"
        self._extra = (f"Account: {acct['Name']} (parent: {parent})\nAs typed on the envelope: {data.get('deal_name', '-')}\n"
                       f"Contract value: {currency} {amount:,.2f}\n")
        return super().announce(p, data, opp, amount, currency, close_date, log_hdr, updates)

    def send(self, to, subject, body):
        super().send(to, subject, body + self._extra)


class TrailingPeriodNote(R.DealDesk):
    def call(self, method, url, params=None, body=None):
        if method == "PATCH" and body and "Description" in body:
            body = dict(body, Description=body["Description"] + ".")
        return super().call(method, url, params, body)


# ---------------------------------------------------------------------------------------------- tolerated representations
class DollarLogUSD(R.DealDesk):  # '$156,000' in the log's USD cell (the policy asks for digits only)
    def append(self, ref, hdr, cells):
        if "USD" in cells:
            cells = dict(cells, USD=f"${int(cells['USD']):,}")
        super().append(ref, hdr, cells)


class LowerStatus(R.DealDesk):  # 'announced' instead of 'Announced'
    def append(self, ref, hdr, cells):
        if "Status" in cells:
            cells = dict(cells, Status="announced")
        super().append(ref, hdr, cells)


# ---------------------------------------------------------------------------------------------- plausible but wrong
class BccOwner(R.DealDesk):
    def announce(self, p, data, opp, *a, **k):
        self._ae = self.sobject("User", opp["OwnerId"])["Email"]
        return super().announce(p, data, opp, *a, **k)

    def send(self, to, subject, body):
        self.call("POST", f"{R.GMAIL}/messages/send", None, _raw(to, subject, body, bcc=[self._ae]))


class ClearRowRetract(R.DealDesk):
    def on_reopen(self, p, data):
        _, _, i = _retract_rows(self, data)
        self.call("POST", f"{R.SHEETS}/{R.DEAL_LOG[0]}/values/{quote(R.DEAL_LOG[1])}!A{i + 2}:H{i + 2}:clear")


class AppendRowRetract(R.DealDesk):
    def on_reopen(self, p, data):
        hdr, log, i = _retract_rows(self, data)
        self.append(R.DEAL_LOG, hdr, dict(log[i], Status="Retracted"))


class EscalatePlusEmail(R.DealDesk):
    def escalate(self, p, reason):
        super().escalate(p, reason)
        self.send(["sales-team@company.example.com"], R.SUBJECT, f"Could not process {p['trigger']}")


class EscalateWithoutTriggerId(R.DealDesk):
    def escalate(self, p, reason):
        self.post("automation-review", f"Envelope {p['data'].get('envelope_id')}: {reason}")


class WeekCountsRetracted(R.DealDesk):
    def on_week(self, p, data):
        _, log = self.sheet(R.DEAL_LOG)
        rows = [r for r in log if data["week_start"] <= r["Closed At"] <= data["week_end"]]
        self.post("deal-wins", f"Weekly closed-won: {self.fmt(sum(int(r['USD']) for r in rows))} across {len(rows)} deals")


class HedgedTier(R.DealDesk):  # names a second tier next to the right one
    def send(self, to, subject, body):
        tier = re.search(r"Tier: (.+)\n", body).group(1)
        other = next(t for t in O.TIER_WORDS if t != tier)
        super().send(to, subject, body.replace(f"Tier: {tier}\n", f"Tier: {other} (sheet says {tier})\n"))


class OtherAmount(R.DealDesk):  # adds a second dollar figure
    def send(self, to, subject, body):
        super().send(to, subject, body + "Pipeline value before discount: $1,250,000\n")


class SameLineNote(R.DealDesk):
    def call(self, method, url, params=None, body=None):
        if method == "PATCH" and body and "Description" in body:
            body = dict(body, Description=body["Description"].replace("\nAnnounced", " Announced"))
        return super().call(method, url, params, body)


class OddCloseDate(R.DealDesk):
    def call(self, method, url, params=None, body=None):
        if method == "PATCH" and body and "Description" in body:
            body = dict(body, CloseDate="2020-01-01")
        return super().call(method, url, params, body)


class OddProbability(R.DealDesk):
    def call(self, method, url, params=None, body=None):
        if method == "PATCH" and body and "Description" in body:
            body = dict(body, Probability=3)
        return super().call(method, url, params, body)


class PostThenDelete(R.DealDesk):
    def announce(self, *a, **k):
        r = self.call("POST", f"{R.SLACK}/chat.postMessage", None, {"channel": "exec-wins", "text": "CLOSED: something big"})
        self.call("POST", f"{R.SLACK}/chat.delete", None, {"channel": "exec-wins", "ts": r["ts"]})
        return super().announce(*a, **k)


class ApproverName(R.DealDesk):
    def append(self, ref, hdr, cells):
        if "Approved by" in cells:
            cells = dict(cells, **{"Approved by": "Morgan Ellis"})
        super().append(ref, hdr, cells)


class UsdIntoSalesforce(R.DealDesk):  # a EUR/GBP envelope's amount written to Salesforce in USD
    def announce(self, p, data, opp, amount, currency, close_date, log_hdr, updates):
        if updates:
            updates = dict(updates, Amount=float(self.to_usd(amount, self.rate_for(currency, close_date))))
        return super().announce(p, data, opp, amount, currency, close_date, log_hdr, updates)


ACCEPT = [("won", PerRecipient), ("signed", PerRecipient), ("signed", CcRecipients), ("won", DraftThenSend),
          ("retract", WholeRowRetract), ("escalate", EscalateById), ("signed", Bookkeeping), ("signed", ProseBody),
          ("signed-fx", ProseBody), ("described", TrailingPeriodNote), ("won", TrailingPeriodNote),
          ("won", DollarLogUSD), ("won", LowerStatus)]
REJECT = [("won", BccOwner), ("retract", ClearRowRetract), ("retract", AppendRowRetract), ("escalate", EscalatePlusEmail),
          ("escalate", EscalateWithoutTriggerId), ("week", WeekCountsRetracted), ("won", HedgedTier), ("signed", OtherAmount),
          ("described", SameLineNote), ("won", OddCloseDate), ("signed", OddProbability), ("won", PostThenDelete),
          ("amend", ApproverName), ("unauth", C.AnyAuthor), ("signed-fx", UsdIntoSalesforce)]


@pytest.mark.parametrize("seed", SEEDS)
@pytest.mark.parametrize("where,cls", ACCEPT, ids=[f"{w}-{c.__name__}" for w, c in ACCEPT])
def test_valid_alternatives_and_tolerated_forms_are_accepted(streams, seed, where, cls):
    g, befores = streams[seed]
    idx = PICK[where](g, befores)
    if idx is None:
        pytest.skip(f"no {where} trigger in this week")
    v = _grade(streams, seed, idx, cls)
    assert v["outcome"] == "correct", (g["triggers"][idx]["trigger"], v["failed"])


@pytest.mark.parametrize("seed", SEEDS)
@pytest.mark.parametrize("where,cls", REJECT, ids=[f"{w}-{c.__name__}" for w, c in REJECT])
def test_plausible_but_wrong_runs_are_rejected(streams, seed, where, cls):
    g, befores = streams[seed]
    idx = PICK[where](g, befores)
    if idx is None:
        pytest.skip(f"no {where} trigger in this week")
    v = _grade(streams, seed, idx, cls)
    assert v["outcome"] == "wrong" and not v["pass"], (g["triggers"][idx]["trigger"], v["outcome"])


def test_every_case_has_a_trigger_in_some_week(streams):
    for where in PICK:
        assert any(PICK[where](*streams[s]) is not None for s in SEEDS), where


def test_trailing_period_note_passes_the_whole_week(streams):
    """The per-trigger and end-of-week readings of the description note agree."""
    g, _ = streams[611]
    H.SOLVERS["_trailing"] = C.variant(TrailingPeriodNote)
    try:
        res = H.run_stream("_trailing", 611, g=g)
    finally:
        H.SOLVERS.pop("_trailing")
    assert res["clean_week"], [r for r in res["rows"] if not r["pass"]][:3]


def test_ledger_survives_a_slack_ts_collision(streams):
    """AutomationBench stamps posts `<unix second>.<random 6 digits>`: a new post may share an older post's ts."""
    g, befores = streams[611]
    idx = PICK["week"](g, befores)
    old = next(m for m in befores[idx]["slack"]["messages"] if m["channel_id"] == "C0DEALWINS1")

    def collide(before, after):
        new = [m for m in after["slack"]["messages"] if (m.get("text") or "").startswith("Weekly closed-won") and m not in before["slack"]["messages"]]
        assert len(new) == 1
        new[0]["ts"] = old["ts"]
    assert _grade(streams, 611, idx, R.DealDesk, collide)["outcome"] == "correct"

    def twin(before, after):  # two identical new posts in one channel and second: both must count
        m = next(m for m in after["slack"]["messages"] if (m.get("text") or "").startswith("Weekly closed-won") and m not in before["slack"]["messages"])
        after["slack"]["messages"].append(copy.deepcopy(m))
    v = _grade(streams, 611, idx, R.DealDesk, twin)
    assert v["outcome"] == "wrong" and "slack.exact" in {n for n, _ in v["failed"]}


def test_generation_is_identical_across_processes(tmp_path):
    """Two fresh interpreters (each with its own string-hash seed) write byte-identical files."""
    metas = []
    for k in range(2):
        out = tmp_path / f"g{k}"
        subprocess.run([sys.executable, "-I", str(FAM / "gen.py"), "--seed", "613", "--out", str(out)], check=True,
                       capture_output=True, timeout=300)
        metas.append(json.loads((out / "meta.json").read_text())["sha256"])
    assert metas[0] == metas[1]


BODIES = [  # (body, expected extras) for a closing with tier SMB and $156,000; the deal is 'Meridian Corp - Enterprise Platform'
    ("Strategic win for the team! Meridian Corp - Enterprise Platform closed at $156,000, tier SMB.", []),
    ("Meridian Corp signed the Enterprise Platform deal. Tier: SMB. $156,000", []),
    ("Our enterprise customers love it. Partnership growth continues. Tier SMB, $156,000.00", []),
    ("Tier: Strategic (sheet says SMB). $156,000", [("other-tier", "Strategic")]),
    ("Tier: SMB (Salesforce: Enterprise). $156,000", [("other-tier", "Enterprise")]),
    ("SMB tier. Salesforce shows Mid-Market. $156,000", [("other-tier", "Mid-Market")]),
    ("Tier SMB, $156,000, above the $150,000 bar", [("other-amount", "$150,000")]),
]


@pytest.mark.parametrize("body,want", BODIES)
def test_email_body_other_tier_and_amount_rule(body, want):
    names = O.names_near({"salesforce": {"opportunities": [{"id": "o1", "name": "Meridian Corp - Enterprise Platform", "account_id": "a1"}],
                                         "accounts": [{"id": "a1", "account_name": "Meridian Corp"}]}}, "o1")
    assert O.body_extras(body, {"tier": "SMB", "usd": 156000}, names) == want
