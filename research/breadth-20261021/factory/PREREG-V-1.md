# PREREG-V-1 (DRAFT, not frozen): node V, enterprise streams against Opus xhigh at full horizon

*Drafted 2026-11-04 by the family-factory build session (Opus 5.5), which wrote the three families. PLAN §6.6 asks for
this draft "after B3's gates pass and before any V arm runs". The author-run gates are development evidence only; the
admission rule (PLAN §6.3) needs a session that did not write the families. So this file is a draft: it is frozen only
when every blocker in §0 is cleared, by writing `FREEZE-V-1.json` = {"sha256": <sha256 of this file>, "date", "by"}.
`experiments/breadth/factory/run.mjs --sealed` refuses to run without that file and a matching `--prereg`. No V arm has
run; no sealed stream has been read by anyone.*

## 0. Blockers before freeze (each needs an owner action or a separate session)

| # | Blocker | Who | Cost |
|---|---|---|---|
| F1 | G0-G12 run by a session that did not write the families; aggregates only (`gates.py --family <f>`, AutomationBench venv) | independent session | $0 |
| F2 | G5's per-trigger bar "naive < 0.60" is missed by construction on all three families (no-op share 0.72-0.80, so even the null control passes 0.72-0.79). Proposed replacement **OD-F1**: naive < 0.60 on acting triggers and zero clean weeks (met: acting pass rate 0.00 reg, 0.03 itsm, 0.58 p2p, 0 clean weeks everywhere; p2p only narrowly, because a clean P2P population is mostly plain approvals). The bar was written for AB-R d3 weeks; changing it after seeing control results needs the owner | owner | $0 |
| F3 | Phrase panel (Haiku 5.5, Sonnet 5.5, Mercury 3; admit at 2 of 3) for the messy intake; until then the 12 messy sealed streams carry intake `v0-prepanel` | paid | about $2 |
| F4 | G8 blind arm, G9 second reader (20 practice outcomes), G11 differential tier (optional) | paid / independent session | $0.05 + $1 + $5-12 per family |
| F5 | B0 falsifier: the 12 AB-R families' gate JSONs identical before and after the shared-harness extraction (run in progress at drafting time; see b0/B0.md) | this track | $0 |
| F6 | **OD-V2**: A-O's "one long Claude Code session per stream with a notes file" is not implementable with the one-shot executor today; the runner implements one session per trigger plus a NOTES.md carried across the stream. Per-trigger A-O costs about $623 (cached) on the 24 streams against PLAN's $8-20 per stream. Options: (a) build a long-session driver (mailbox-fed triggers, one bridge per trigger) before freeze; (b) accept the per-trigger design and its cost; (c) run A-O on 12 of 24 streams | owner | (a) about 1 engineer-day |

## 1. Hypothesis and test

**H-V (primary).** On recurring multi-tier enterprise streams, Haiku 5.5 constructing a workflow in Foundry (F-H) has
more clean streams than Opus 5.5 xhigh alone (A-O). One-sided exact McNemar on the 24 paired streams, α = 0.025, its
own α (never pooled with the external beds). Power (PLAN §6.6, critique's simulation): 0.81 at 0.75 vs 0.35; 0.35 at
0.70 vs 0.45; size about 0.01 at 0.50 vs 0.50.

Secondary, descriptive with 95% intervals, no test: F-H vs A-H and vs A-S on clean streams; clause-attributed accuracy;
cost per clean stream; the amendment week's pass rate; clean weeks; policy vs messy intake strata.

## 2. Units and data (frozen before any generation; hashes below)

- **Streams:** 24 sealed streams, seeds 8850-8873, family and intake by the hash rule in `SPLIT.json`
  (sha256 `d7ed9e496bd47d748d450556546277199d643c7cdb52690b81bcbb0fb802c5f6`): 8 per family, 4 of each family's 8
  starting from a messy request instead of POLICY.md. A stream = 4 simulated weeks of one family's triggers with a
  month-end and one policy edition in week 3.
- **Generated content:** host-only under `/var/tmp/foundry-work/benches/factory/sealed/` (mode 0600); per-stream
  sha256 in `SEALED-HASHES.json` (file sha256 `0128e3d8c841baee2fd2e05afe480ec134daa0e7a86cae9940e401aaa9d70546`;
  generators itsm 0.1.0, p2p 0.1.1, reg 0.1.0; `seal.py --verify` reproduces every hash). Totals: itsm 1,873 triggers,
  p2p 755, reg 766 (3,394). Re-sealed once before any arm or read: p2p moved to 0.1.1 on 2026-11-04 after its own G6
  found the replay trap exposed only 4 times on 4 dev streams (a second duplicate injection per stream was added).
- **Families:** `abr-itsm-queue`, `abr-p2p-audit`, `abr-reg-incident-clock` (experiments/autobench/families), B4-distinct
  from the 12 AB-R families and E7 at τ = 0.35 (nearest 0.42, 0.51, 0.50; `B4-distinctness.json`).
- **Dev:** seeds 2113-2160 (practice 2101-2112), any number of looks; never sealed seeds.

## 3. Arms (exact commands; every one refuses sealed seeds until frozen)

| Arm | What | Command (sealed) | Cost on 24 streams [estimate, I] |
|---|---|---|---|
| F-H | Haiku constructs `workflow.py` from the builder kit once per stream (plus one repair after week 3 if it raised), the host runs it per trigger at $0 | `node experiments/breadth/factory/run.mjs --arm F-H --family all --seeds 8850-8873 --sealed --prereg research/breadth-20261021/factory/PREREG-V-1.md --cap 15` | $2-7 |
| A-O | Opus 5.5 xhigh, one session per trigger + NOTES.md (OD-V2) | `... --arm A-O ... --cap 700` | $623 cached, $1,833 upper |
| A-H | Haiku 5.5 agent, one session per trigger | `... --arm A-H ... --cap 50` | $13 cached, $46 upper |
| A-S | Sonnet 5.5 agent, one session per trigger | `... --arm A-S ... --cap 250` | $231 cached, $781 upper |
| wf-O | Opus builds the workflow once per family on practice streams 2101-2112 (ceiling) | `... --arm wf-O --family all --seeds 2101 --cap 40` (dev seeds; then run the built workflow on the sealed streams as `--arm scripted --solver <path>`) | $13 cached, $36 upper |

Per-session caps (CLI `--max-budget-usd`): A-H 0.12, A-S 0.80, A-O 1.50, F-H 1.50, wf-O 8. Estimates assume per
session 100-120K input tokens (90% cache reads at 0.1x) and 3-5K output; prices from `policy/models.json`. With
OD-V2 option (a), A-O falls to about $190-480 (PLAN's $8-20 per stream), and V totals $350-880 as planned.

## 4. Endpoints and scoring (all host-side, deterministic, $0)

- **Clean stream** (primary): every trigger passes the family oracle (effects, envelope, timing; end-of-stream table at
  the last trigger) and zero hard-requirement violations (clauses marked hard in family.spec).
- Grading is `abr/lib/factory/oracle.py`; AutomationBench's handlers run as a reported cross-check (`ab_disagree`).
- **Environment faults** (rate or usage limit, model unavailable, sandbox, disk) are never outcomes: the run stops
  (exit 3) and resumes from the last graded trigger; a stream with an unresolved fault after 3 resumes is reported as
  missing for all arms of that pair (both members dropped from McNemar), never as a failure.
- **Carry mode only**: each arm's world carries its own effects; no rebasing.

## 5. Hygiene

Truth, deltas and grades never enter a session (`step.py` host dir; G12 leakage check). Per-trigger results of sealed
streams stay out of git; only aggregates are committed. No arm, prompt, builder kit or family file changes after the
freeze; a change voids the freeze and needs a dated amendment before any further sealed run.
