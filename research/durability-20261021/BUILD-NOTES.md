# DUR-1 build notes (2026-11-04)

*The build of [BUILD-PLAN.md](BUILD-PLAN.md) in the durability worktree (`worktree-wf_bd674a6e-71f-11`). Status: built and
exercised end to end at $0 with stub and scripted sessions; **not frozen** (F-A and F-B are the Fix phase's) and **no
model was called**. The $0 dry-run output and the exact paid commands are at the end. Development evidence only.*

## 1. Sources and imports

| What | How | Commit |
|---|---|---|
| Design, prereg (DRAFT), build plan, evidence map | copied unchanged from the synthesis scratchpad | `6bfc0c32` |
| Heal kit with the D20 unblock and the FH-1 result | `git merge` of `worktree-wf_0f86d12b-ab5-2` at `9e2a2b61` (no rebase); the frozen FH-1 kit is imported, never edited | `76b09d01` |
| Move 0 certification (`certify.mjs`, `gauntlet.mjs`, their tests, `MOVE0-CERTIFY.md`) | read-only checkout from `d3bd7acf` (Move 0 is not on main); `stats.mjs` and `stats-builds.mjs` are byte-identical to main's | `bef78d0a` |
| Draft seed claim (prereg Appendix A) | dated sentences in the `use` texts of `ebed-dev` and `ebed-e8-rehearsal`, `SEED-CLAIMS.json` (status draft); the ledger test stays green | `db43a058` |

No frozen file of a live experiment was edited (FREEZE-p2 pins, PREREG-OT0 and AMEND-1 pins, A1-C manifests, the FH-1 kit,
the bed). Every DUR-1 file is new under `experiments/durability/` and `research/durability-20261021/`.

## 2. What exists (experiments/durability/)

| File | Role (BUILD-PLAN row) |
|---|---|
| `schedule.mjs` | the frozen schedule, seeds and the seed guard (1) |
| `changes.mjs` | change injector: P1 edition + edition-following carriers, E1/E1r F5 rename, R1 gated D1 edit + review load, L1 MR11 load, F crash ramp + restarts + delayed duplicates, ADV documents, sealed bundle loader (hash-checked) and world operators in a VM, spec text in force, visible configuration, practice and history bundles (2) |
| `exposure.mjs` | incremental twins and twin0, exposure by reference signatures, change-induced attribution (3) |
| `oracle.mjs` | reference pools, K-1 control check, case grades with critical-at-first-divergence and complaint topic (4) |
| `complaints.mjs` | true, false and adversarial complaints, arm-independent draws (5) |
| `edetector.mjs` | m6 conformal e-CUSUM on `profile.mjs` features (6) |
| `monitor.mjs` | m1-m5 per world-day on journal prefixes, incidents (rules 1-6), verifier-blind rule (7) |
| `registry.mjs` | hash-chained version registry, compare-and-swap, proposer != approver (8) |
| `heal-evidence.mjs`, `heal-adapter.mjs` | FAILURES.md with raw effect results (import-free, V-7), evidence sets, patch session (FH-1 machinery, stub or paid), heal until clean, code gate, stub patchers (9) |
| `contracts-owner.mjs` | C-O sessions and their $0 certification; verifier-blind acceptance (10) |
| `stream.mjs` | the stream driver: timelines, day-by-day monitor, incidents, heal, shadow canary, CAS promotion, rollback, re-run with prefix identity checks, forks (11) |
| `windows.mjs` | case-routed agent windows (A-H, A-Ox) with the AGENTV validator (12) |
| `ld.mjs`, `rmaint.mjs` | LD-H latent-defect streams; R-static, R-maint(L), R-ceil (13; REF-M is `run.mjs refm` = the stream loop with S1-S3 and the Opus patcher) |
| `knobs.mjs`, `wc-search.mjs` | WC-1: knob DSL, Poisson/HT, ESS, CVaR, local search, LDFI pairs, confirmation, transfer (14) |
| `redteam/` | J2 probe mailbox (25 probes), validity gate, session driver, blind baseline (15) |
| `shield-harm.mjs`, `sweep.mjs` | +SH ablation policy, retroactive sweep (16) |
| `analyze.mjs`, `model.mjs`, `report.mjs` | every rule K-0, D-1...D-11; the run-to-model adapter with attribution and `certifyHeal` per promotion; the owner table (17) |
| `freeze.mjs`, `dur1-chain.sh` | F-A / F-B freezes and checks; the detached, resumable chain (18) |
| `run.mjs`, `paid.mjs`, `author.mjs` | one CLI for every stage; paid stages on one ledger (rows, flow-down, per-tick meter); the sealed author and its count-only gates |
| `power.mjs` | prereg §11 numbers, reproducible (20); output `research/durability-20261021/POWER.json` |
| `test/*.test.mjs` | tests with teeth, one file at a time (19) |

## 3. Defects found and fixed during the build (all in the recovered 2026-10-28 code; each has a test now)

1. **notify.send effects were attributed to no order.** `notify.send` names its order (or fulfilment, `<orderId>-F<n>`) in
   `about`, never in `orderId`, so m1 findings, the raw effect results of FAILURES.md and the gate ignored every notice
   error. The gate could never accept a fix of an unannounced notify rename (E2s-like). Fixed with `orderOfArgs`
   (`monitor.mjs`) and its import-free twin in `heal-evidence.mjs`. Test: `loop.test.mjs` "the code gate".
2. **The gate saw m1 findings of finished orders only**, so an error on an order still in flight at the alarm could not be
   shown fixed. m1 and m3 findings now cover every order of the replay (all of it is before the alarm); contracts still
   judge finished orders only.
3. **The window-only bootstrap fed lineage-averaged fractions to `nonInferiority`** (which needs 0/1); written out as a
   window-cluster bootstrap that is printed and never decides. **`twoWayBootstrap` accepted pairs without units**; it now
   refuses a pair without lineage, window and case (template B7). Test: `analysis.test.mjs` "D-3 unit teeth".
4. **Environment faults could be scored**: a C-O session hitting a rate limit became a K-2 quarantine, an agent tick an arm
   error, a heal session a skipped attempt. Now: heal sessions wait 30 minutes and re-run once fresh, then stop the stream;
   C-O, red-team and author sessions throw `DUR1_ENV_FAULT`; agent windows freeze the host run (quota) and write no record;
   `run.mjs` exits 75 and the chain waits and resumes.
5. **Two parallel heal workers could both pay for the same announced C-O session**: a directory lock makes one session per
   change; the other worker waits for its reading.
6. The smoke report could print a negative "passing" count (it now counts finished orders only).
7. **The harm shield refused correct effects**: the host's `ctx.query` takes `{ where }`, so its bare filter returned
   every row and the reference's first charge looked like a second one; it also refused idempotent re-emissions under
   the F ramp. Found by the first full dry run (shielded 1/27 against 15/27); test: the reference passes unchanged
   under the shield, with and without F (`loop.test.mjs`).
8. **Routed ticks were undercounted under F**: each restart makes a new routing arm (the dry run showed 0 routed ticks).
9. **Promotion attribution fell to 'base' when a heal repaired its own evidence cases**; it now falls back to exposure.
10. **A missing import** (`runBundle` in `paid.mjs`) in the red-team windows, caught by `stages.test.mjs`.

## 4. Deviations from the design and build plan (with reasons)

1. **Resume granularity is the lineage-stream** (a killed stream restarts from its first world; spend so far stays on the
   ledger and counts). Finer resume would need the version registry, incident book and complaint history serialised per
   world-day; the cost of a restart is at most one lineage-stream's sessions (<= $1.50).
2. **MH-stale forks at W3 t0** with MH-H's W3 starting version (not at R1's publication, W3 d2 09:00), and keeps s1's W1 in
   its regression set (`regressionW1`). A promotion on W3 d1-d2 would be missed by the fork; reported if it happens.
3. **MH-H->O re-runs s1 from its start** (not a fork at the incident) for the lineages whose MH-H s1 record left an
   incident at needs-human, last in P9 and only while P9 has room for an Opus patch: forking mid-stream would need the
   serialised loop state of item 1. The A-H red-team windows of P7 are wired (`run.mjs rtwindows --paid`, after
   `advset`): the two top valid ADV-SET worlds by the median starting version's silent failures, <= 8 of its failing cases.
4. **A-Ox stop rule per case**: each A-Ox case is one routed run of its world (the code arms' world is unchanged), so the
   "stop if 1.5 x mean $/case > remaining P8" check runs before every case, as written.
5. **The harm shield refuses (drops) effects** instead of `port.mjs`'s hold-for-approval (E8's actors never answer
   approvals; a hold would be graded as over-escalation). Disclosed in `shield-harm.mjs`.
6. **The dry run is a plumbing check, not a rehearsal**: two rehearsal worlds (1207-1208) of 24 orders with every change
   compressed into them, the stub sealed bundle (`fixtures/sealed-stub.json`, designer-written), one practice world, two
   lineages, stub patchers and C-O, a do-nothing per-tick agent. Its exposure floors and the author's gates fail at that
   size by design (floors are per 80-order world).
7. **Power numbers vs prereg §11** (`power.mjs` at the frozen seeds, `POWER.json`): SD 0.0433 [0.0292, 0.0829], every sign-
   flip MDE, the durable-share, recall and D-4 characteristics match. **D-3 differs in four cells**: 12 windows, true gap
   +0.05: 0.97 (prereg 0.96); at alpha 0.05: 0.71 / 0.983 at gaps 0 / +0.05 (prereg 0.73 / 0.99); 8 windows at +0.05:
   0.893 (prereg 0.82). The size at the margin is 0.028 (prereg 0.025). The prereg's §11 and banner must be corrected to
   the script's numbers before F-B (BUILD-PLAN row 20 rule); the conclusion (D-3 likely inconclusive at a tie) stands.

8. **A bed finding met while testing WC-1 (not a DUR-1 defect, reported):** the bed's own MR11 `injectFailures`
   (`beds/ebed/e8/metamorphic.mjs:424`) on world `generateWorld({ seed: 1302, split: 'fuzz-dur1-adv-b1lh-5', difficulty:
   4, mix: 'tail', size: 12 })` makes the **earliest** reference timing emit an `inventory.reserve` outside the oracle's
   allowed set on case o0014 (an `f6-reserve` with ordinal 2 on a two-fulfilment order); the latest timing passes. WC-1
   and the J2 gate class such worlds as bed findings and exclude them, as designed. L1 uses the same per-kind edits at
   15%, so Stage Z's V-1 on the real stream worlds decides whether it bites there; if it does, L1 skips `f6-reserve` on
   multi-fulfilment orders (recorded before F-B, BUILD-PLAN §6 risk rule).

## 5. Validity gates: where each stands

| Gate | Status at $0 now |
|---|---|
| V-1, V-2 | tested on rehearsal worlds with every change (`world.test.mjs`); Stage Z runs them on every stream world (`run.mjs stagez`) |
| V-3 | computed by `exposure.mjs` per change and world; on the real worlds only after the sealed bundle exists |
| V-4 | effectiveFrom golden passes (a `p > eff` gate fails it); R1 with its gate open equals drift D1 exactly |
| V-5 | `C-O` certification runs before any reading gates (stub readings certified in the dry run) |
| V-6 | prefix identity under a swap, and a hidden-randomness arm caught (`world.test.mjs`); checked on every re-run in `stream.mjs` |
| V-7 | import walk of the evidence builder; planted late and unsettled evidence refused (`loop.test.mjs`) |
| V-8 | complaint draws arm-independent (`units.test.mjs`) |
| V-9 | not built: the payload-derived case index for the contracts (m2 stays truth-indexed; D-6 is also reported without m2 per prereg) |
| V-10 | routing identity and spec-at-tick (`loop.test.mjs`) |
| V-11 | built into Stage Z (`run.mjs stagez`, FH-1's own grader on 1232-1234 x d2, d3, d5); not run yet |
| V-12 | null false-alarm <= 0.10 over 10^4 streams, 4-vs-3 novel cases (`units.test.mjs`) |
| V-13 | the author's count-only gates (`author.mjs`), exercised by the dry run with the stub bundle |
| V-14 | C-O certification (`contracts-owner.mjs`), exercised by the dry run |

## 6. The exact paid commands (none has run; each refuses to spend before its freeze)

Every command runs from the root of this worktree (or of main once this branch is merged); every paid one is launched
detached from the chain script file, never typed inline. All spend goes to one ledger,
`research/durability-20261021/runs/spend.jsonl`; rows and caps are prereg §12 (`run.mjs` `PRIORITY`).

**Fix phase, before any money ($0): done 2026-11-04 (§9, §10).** Prereg §11 corrected to `POWER.json`; both reviews
applied; the seed claim CLAIMED; the tests and the $0 dry run re-run (§7, §8); the prereg FROZEN with every executed
file's sha256 in its Appendix D; F-A written and committed (`FREEZE-A.json`). The order below is the current one (the
prereg's §13.1 as amended).

Before the first launch (the log directory must exist for the redirect):

    mkdir -p research/durability-20261021/runs

**P1, the sealed author (Opus 5.5 xhigh, $2 and 60 min per session, one revision; row cap $4).** The author phase first
runs the $0 dry run on the frozen code (`run.mjs dry --light`, ~35-50 min; the chain stops if it fails), then P1. A
failed author is terminal (exit 5, `SEALED.json` status `failed`; a re-run needs a dated amendment):

    setsid nohup sh experiments/durability/dur1-chain.sh author > research/durability-20261021/runs/chain-author.log 2>&1 &

It writes the bundle to `/var/tmp/foundry-work/dur1-sealed/bundle.json` (outside the repository) and
`research/durability-20261021/SEALED.json` (sha256 and counts only); commit `SEALED.json` without reading the bundle.

**F-B, then everything else:**

    node experiments/durability/freeze.mjs write B --commit $(git rev-parse HEAD)   # refuses unless every digest equals Appendix D
    git add research/durability-20261021/SEALED.json research/durability-20261021/FREEZE.json && git commit (trailers as usual)
    setsid nohup sh experiments/durability/dur1-chain.sh after-author > research/durability-20261021/runs/chain.log 2>&1 &

The chain runs, in prereg §13.1 order, each as `nice -n 15 node experiments/durability/run.mjs ...`:

| Step | Command | Cost |
|---|---|---|
| Stage Z | `stagez` (V-1, V-2, V-3, V-11, exposure, S-H*, REF-S, c-oss, R-static, R-maint(0,2,7), R-ceil on s1-s3; K-0 on s1, stops the chain if it fires) | $0 |
| WC-1 t0 | `wc1 --when t0` (400 / 150 evaluations per target, confirmation, transfer) | $0 |
| P0 | `p0 --paid` (2 lineages x 2 rehearsal worlds with R1, <= 3 Haiku sessions; A-H window of 4 cases; sets k) | <= $2 |
| P2 + P3 | `heal --paid --streams s1,s2 --lineages <half>` twice in parallel (<= 2 paid sessions at once; C-O sessions run inside, one per announced change) | <= $6 + $15 |
| P4 | `windows --paid --streams s1,s2 --kind A-H` (8 windows + the repeat draw on s1 R2s) | <= $13 |
| P5 | `heal --paid --streams s3`, `windows --paid --streams s3 --kind A-H` (skipped by K-4) | <= $13 |
| P6 | `refm --paid` (S1-S3 maintained by Opus 5.5 xhigh on s1) | <= $6 |
| P7 | `redteam --paid` (RT-O1, RT-O2 Opus xhigh, RT-H Haiku; blind baselines) | <= $8 |
| WC-1 end, ADV-SET | `wc1 --when end`, `advset` (readings in force at stream end; sealed overlays in the end pass) | $0 |
| P7 windows | `rtwindows --paid` (A-H on the two top ADV-SET worlds; inside P7's cap) | (P7) |
| P8 | `windows --paid --kind A-Ox` (<= 6 cases, stop rule before each) | <= $7 |
| P9 | `forks --paid` (MH-stale on s1, LD-H x 6, MH-H->O last) | <= $5 |
| analysis | `analyze` (writes runs/REPORT.json; owner table first) | $0 |

Exit codes: 3 stops the chain (freeze changed or `--paid` missing; never a budget), 4 budget-stops a row and moves on,
5 stops the chain (a stop rule: V-1, V-2, V-3, V-11, K-1, V-6, a missing K-0, a failed or repeated sealed author), 75 is
an environment fault, also K-5 low disk at a world start (wait 30
minutes, resume the same step), anything else is retried once and then excluded and reported (the dry run and Stage Z:
the chain stops). K-0 needs `runs/stagez/K0.json` with `"kill": false`.
Resume after a restart: the same `setsid nohup sh ... after-author` line (finished steps leave `runs/.done-<step>`).

## 7. The $0 dry run (plumbing, never evidence)

**Re-run 2026-11-04 after both review batches** (code of commit `249d77f7` plus the VB-prefix stamp and the R1-M18 test
fix): `DUR1_WORK=/var/tmp/foundry-work/dur1-dry nice -n 15 node experiments/durability/run.mjs dry --light` (lineages
`b1lh-e8-1`, `ch-e8-1`; 58.9 min at load average about 30 on the shared machine). **All 20 steps ran** (the 18 of the
first dry run plus `m6-analysis`, the real analysis's m6 path, and the report's new rules). Free disk 1.52 GB at the
start, 1.2-1.3 GB at the end (other runs); DUR-1's own temp use was 3.9 MB, deleted.

| Step | Output |
|---|---|
| seeds | 44 scheduled seeds accepted; 8/8 probes outside the claimed ranges refused |
| author (stub bundle) | reference ok, controls fail; floors not met at size 24 (R2s 2/10, E2s 9/10, U1s 0/6), so the gate correctly refuses to seal; the stub's R2s world operator ran in the sandboxed worker |
| Stage Z gates | V-1 ok (30 and 29 completed); V-2: noop and charge-twice fail both worlds |
| static arms (W1, W2) | S-H* b1lh 23/29, 15/27; ch-e8-1 23/29, 14/27; REF-S S1 23/29, 24/27; R-static 23/29, 24/27; R-maint(2), R-ceil 29/29, 26/27 |
| MH-H (stub patcher) | b1lh: 10 sessions, 1 promotion (the API patch), W2 15/27 -> 23/27, every re-run's prefix identical; ch-e8-1: 12 sessions, 0 promotions |
| MH-stale fork | W2 23/27 |
| attribution | e.g. S-H* b1lh W2: E2s 9, R2s 2, L1 2, ADV 2 induced; MH-H b1lh after its heal: E2s 1 |
| certification | the one promotion: `reject (partial-fix)` |
| windows (stub agent) | 4 cases, 6 ticks, all routed, 8 pairs |
| LD-H ld-k0 | healed, durable, 0 regressions, 0 false-complaint harm |
| WC-1 (toy pool) | 4/4 evaluations; Hajek failure estimate 0.098 (HT 0.220 with N = the pool); the top vector recurred on 2 of the 2 toy fresh salts, not confirmed (confirmation needs 3) |
| red team (stub) | 2 probes, 2 valid scenarios, 0 bed findings |
| +SH | shielded 15/27 = base 15/27, 0 refusals |
| m6 | 10 onsets judged, 0 alarms (W1 0); with the light run's ONE practice world the cross-conformal calibration is degenerate, so these m6 numbers say nothing (the real analysis calibrates on three) |
| report | owner table first; K-0 pass (R1 6/12 = 0.50, L1 4/5, E2s 18/18; E1 no induced failure); D-5 PARTIAL with (b), (c), (d) NOT EVALUATED (fail closed: no ADV-SET, REF-M or routed-window full-monitor fields in a dry run); D-6 FAIL in every variant; m6 N; root-cause ledger 36 records, INCOMPLETE (0 analyst-reviewed), so Q7 says no result text |

None of these numbers is a DUR-1 result: two lineages, two 24-order worlds with every change stacked, designer-written
stand-ins for the sealed changes and scripted patchers. The first dry run (2026-11-04 morning, before the reviews) is
summarised in the git history of this file (`a9b97e29`).

## 8. Tests (run one file at a time: `nice -n 15 node --test --test-concurrency=1 <file>`)

| File | Tests | What has teeth |
|---|---|---|
| `test/schedule.test.mjs` | 4 | schedule == prereg §4.1 (one-cell edits on either side fail); untouched seed ranges refused |
| `test/units.test.mjs` | 6 | registry CAS / self-approval / tamper; complaint draws arm-independent; m6 null false alarms <= 0.10 and 4-vs-3; sealed hash; author bundle bounds; ledger rows, flow-down and meter; freeze change blocks; effort required |
| `test/analysis.test.mjs` | 15 | TTD golden; sign-flip 1/512 and 2/512; Holm; two-way vs window-only bootstrap and the unit refusal; 3-point floor; certification partial-fix; zero-event bound; D-6 bands; R-maint/R-ceil timelines; model/report; HT unbiasedness; shield policy; power SD 0.0433 and D-3 size; review batch 2 (false VB incidents, induced-only detection, U1s loudness, attribution ties, transient F, m6 rule, root-cause completeness, per-class D-6 power) |
| `test/world.test.mjs` | 11 | V-1/V-2/determinism; effectiveFrom golden (p >= eff); R1 == drift D1; stacked anchors; E1r; critical-at-first; monitor rules; no signal on a correct deployment; V-6 prefix identity and hidden randomness; twins; C-O certification accepts the analyst reading and rejects the stale one |
| `test/loop.test.mjs` | 6 | V-7 import walk; raw error payload in FAILURES.md and hygiene refusals; red-team firewall; the gate accepts the API patch and rejects the notice-dropping one; V-10 routing identity; shield on the reference |
| `test/cli.test.mjs` | 3 | paid stages refuse without --paid and without the freeze, writing no ledger row; a scratch ledger and an EMPTY freeze directory, so no test can pass a freeze check once the real freezes exist |
| `test/stages.test.mjs` | 2 | WC-1 pass with resume; ADV-SET cross-run on all 12 t0 code arms; A-H red-team window on the metered ledger |
| `test/fixes.test.mjs` | 14 | both reviews: one world per vector; carried effective dates; budget vs freeze stops; metered end rows; reclaimable locks; one VB session per stream with per-lineage acceptance; contract patches and sealed world operators out of process (escape cannot write, hang times out, empty env); transition token guard; per-case canary findings; every world-day monitored after a promotion; harmful stubs never promoted; budget stops never end a stream; C-O sees the published spec and notice only |

61 tests pass (2026-11-04, after both review batches; about 11 minutes in all on the shared machine): schedule 4,
units 6, cli 3, fixes 14, world 11, loop 6, stages 2, analysis 15. The seed ledger test (`experiments/lib/ebed-seed-ledger.test.mjs`)
6/6 after the claim. Move 0's `experiments/lib/certify.test.mjs` 20/20 and `gauntlet.test.mjs` 46/46 (run after the
imports; unchanged since).

## 9. Fix phase (2026-11-04): the two build reviews of `a9b97e29`, applied

Two reviews of the build (8 blockers, 23 majors, 13 minors; 5 blockers, 12 majors, 10 minors) reached this phase
truncated: review 1 after its M10, review 2 after its M7. Every blocker and every major that was readable is applied
below or disagreed with, with the reason. The rest (review 1's M11-M23 and minors, review 2's M8-M12 and minors) was
recovered from the reviewers' own transcripts and is handled in §10.

| Finding | What changed | Test |
|---|---|---|
| R1-B1 world identity | `knobs.mjs`: split `fuzz-dur1-<base>-<salt>`, MR11/overlay salts and the LDFI draw keyed on (base, salt); the target stays in the key only | `fixes` B1 |
| R1-B2 canary day skipped | `stream.mjs`: a re-run keeps the delivered signals of the days before the swap; after a promotion the loop resumes on the canary day (monitored, no session); the deferred canary's day 1 likewise | `fixes` B2 (stream) |
| R1-B3 / R2-M2 VB reuse | one verifier-blind C-O session per stream; every incident judged with its reading on its own journal; the reading reaches every lineage; VB lock across workers | `fixes` B3/B5 |
| R1-B4 / R2-B1 / R2-B2 budget plumbing | `BudgetStop` (row, total, scope) apart from `FreezeError`; `preflight` and `meteredRun` shared by heal, C-O, red-team and author sessions; the stream checks spend + cap <= its cap before every session and budget-stops the incidents; REF-M $2.00 per solver-stream, MH-H->O $2.50; C-O with no room: quarantine (announced) or needs-human (VB); P0 counts its 3 sessions on the ledger and always writes P0.json; `windowK` refuses a missing P0.json | `fixes` B4 (unit + stream) |
| R1-B5 VB sessions exhaust P2 | <= 1 VB C-O session per stream; rule 3 corroborates on any incident holding the order (any status). $0 computation from the frozen false-complaint draws: 2 / 1 / 5 VB incidents on s1 / s2 / s3 from false complaints alone, the first in W3 / W3 / W1, so each stream's session is expected to go to a false alarm (prereg §6.2 rule 4 discloses it) | `fixes` B3/B5 |
| R1-B6 / R2-B3 fail-open | Stage Z stops (exit 5, `STOP.json`) on V-1, V-2, V-3, V-11; K-1 and V-6 throw `StopError` in `runStream`; the chain stops on 5, needs `K0.json` with `"kill": false`, stops when the dry run or Stage Z is excluded, and a stop in a background P3 worker reaches the chain through `runs/STOP-chain` | `fixes`; chain by reading |
| R1-B7 replayed calendar | dated changes (P1, R1, R2s, E2s's edition) keep their published effective date in every later world (truth, notice, visible configuration, practice); renames, loads, faults stay from t0 (prereg §4.1). **Not adopted:** judging W1 under its own readings (with the replayed calendar it rejects every correct date-gated heal; prereg §6.3) and a true calendar offset (every per-day computation is world-relative; disclosed §15) | `fixes` B7 |
| R1-B8 D-1 critical regressions | `certifyPromotion` finds the cases the candidate fails critically that the incumbent passes; `critRegressionDays` measures days in force; `report` passes them to D-1, which fails closed when they are missing | `analysis` D-1 |
| R2-B4 window timeouts | routed windows get a world limit of 12 ticks x the per-tick limit per case; a non-frozen stop is a harness error; 3 environment-fault attempts make the window invalid (recorded, excluded) | by reading |
| R2-B5 model code in process | C-O contract patches run in `contract-worker.mjs` under Node's permission model (reads limited to code, readings and the item; no writes, no child processes; empty environment); LD-H transition candidates pass a static capability-token guard before import (residual disclosed, prereg §15) | `fixes` R2-B5 (x2) |
| R1-M1 Holm | step-down: the second hypothesis gets level 0 unless the first is rejected; level 0 never passes | `analysis` Holm |
| R1-M2 medians | D-3's falsifier over the windowed changes' cells with infinity; D-4's TTD on s1 cells against REF-M's s1 cells | by reading |
| R1-M3 D-4 inputs | REF-M cells from REF-S's heal-requiring cells (REF-S now attributed); final week pooled over streams | by reading |
| R1-M4 TTD tolerance | heal-requiring = S-H* induced failure AND S-H* TTD infinite; S-H*'s durable share on the wider set is reported | `analysis` (report) |
| R1-M5 classes | attribution first, multi-label; exposure fallback with P1 last | `analysis` (report) |
| R1-M6 D-5(c) | computed (MH-H vs REF-M on s1, REF-S elsewhere); every D-5 clause fails closed | `analysis` D-5 |
| R1-M7 D-5(b) | per ADV-SET world | `analysis` D-5 |
| R1-M8 U1s carve-out | U1s-induced cases only | by reading |
| R1-M9 zero-event unit | N = lineage-worlds evaluated | `analysis` D-5 |
| R1-M10 silent deadline | the last effect time is recorded per case (`wrec.grade[c][6]`); deadline = last effect, else first divergence, else world end, + 1 day; the same rule for windows | `analysis` silent |
| R2-M1 canary/rollback/gate | per case over m1 (incl. arm errors), m2, m3; the gate adds m1/m3 findings and arm errors on practice and W1; a candidate run that does not complete is a rejection, an incumbent one a harness error | `fixes` R2-M1; stream: break/obey never promoted |
| R2-M3 C-O lock | owner-stamped (host, pid, time) locks, reclaimed when the owner is gone or older than 4 h; the reading file is re-checked inside the lock | `fixes` R2-M3 |
| R2-M4 faulted attempts | per-attempt ledger scope `<label>#a<n>` and session directory; `envInvalid` applied in `analyzeRuns`; a thrown `SANDBOX_UNAVAILABLE` gets its end row at $0 | `fixes` R2-M4 |
| R2-M5 truncated worlds | every stream, shadow, re-run and evidence run must complete or is a harness error (never graded); world limit 30 min per 80 orders | by reading |
| R2-M6 labels | `unitOfLabel`: single-unit arms are 'ref' | `analysis` |
| R2-M7 dry run vs paid paths | partly: the paid plumbing has unit and stream tests here (preflight, metered rows, budget stops in a stream, locks, VB reuse, sandbox); a stubbed rehearsal of the whole chain was not built. P0 (<= $2) is the first paid exercise of the heal and window paths, before P3 | - |

**Other changes.** The prereg §11 D-3 cells and the banner now read `POWER.json` (0.97; 0.71 / 0.983 / 0.22; 8 windows
0.89; size at the margin 0.028). The seed claim is CLAIMED (ledger use texts, `SEED-CLAIMS.json`). `stages.test.mjs`'s
ADV-SET vector moved from salt 11 to 12 (with one world per vector the old world held no R1 failure). `freeze.mjs`
freezes the import closure of every module under `experiments/durability` (`executedFiles`) plus the files read at run
time; F-A also covers the prereg, `run.mjs`, `heal-adapter.mjs` and the chain; F-B refuses to write unless every digest
equals the prereg's Appendix D.

**Not done in this phase (open):** V-9 (payload-derived case index); a stubbed rehearsal of the whole chain (R2-M7);
a stream-level rollback test (the per-case comparison is tested as a function); finer resume than the lineage-stream;
the MR11 `f6-reserve` check on the real L1 worlds (Stage Z's V-1 decides it and stops the chain if it bites). The
truncated review items: §10.

## 10. Fix phase, second batch (2026-11-04): the rest of both reviews

The two reviews' full texts were recovered from the reviewer sessions' transcripts (the workflow had relayed them
truncated). Every remaining blocker and major is applied or disagreed with below; cheap minors are applied, the others
disclosed (prereg §15 items 17-19). Tests named in the last column are in `test/analysis.test.mjs` (`review batch 2`)
and `test/fixes.test.mjs`.

| Finding | What changed | Test |
|---|---|---|
| R1-M11 D-5(d) unequal monitors | the agent window is scored under m1-m3 with the readings in force at the world's end (`windowRecord` `silentFull`); D-5(d) decides on MH-H vs A-H both under m1-m3 without complaints; the m1-only pair is printed beside it | by reading (needs a paid window) |
| R1-M12 D-5 without complaints | `D5noComplaints` beside the binding D-5 (with complaints, §4.3) | report |
| R1-M13 D-6 | a detection only on a change-INDUCED failing case; `announcedFired` from m4 within a day of the onset; D-6 with/without m5 and with/without m2; m6 computed on the reference journals of each stream (`m6Analysis`) with the adoption rule (`m6Rule`) | `analysis` batch 2 |
| R1-M14 D-10 U1s | loud = an incident tied to U1s (VB complaints naming a U1s-induced case, or a defect incident holding one), delay 0 when opened before the complaint; lineage-streams without such a complaint excluded and listed | `analysis` batch 2 |
| R1-M15 D-2 cost | marginal $ per lineage-stream from the ledger (every attempt) + C-O share; VB C-O $ charged to U1s's cells of its stream | by reading |
| R1-M16 attribution ties | count, then non-P1, then the smaller exposure set, then the id | `analysis` batch 2 |
| R1-M17 D-7 | A-Ox windows read and paired with MH-H on the same cases; all-in $/case = FH-1 build + commissioning ($1.174 per lineage, RESULT-FH1.md:343) + stream marginal | by reading |
| R1-M18 / R2-M9 C-O inputs | the announced C-O session runs on the spec at publication + 1 ms, the spec just before, and CHANGE.md = the in-world notice (never the sealed label or t0 spec) | `fixes` R1-M18 |
| R1-M19 VB conversion | days 1..d re-judged under the accepted reading; only the m2 findings it ADDS are ingested | by reading; B2 stream test still passes |
| R1-M20 | = R2-M4 (first batch: per-attempt scope) | - |
| R1-M21 false incidents | a VB incident is false iff every complained case passes for the arm; practice evidence left out | `analysis` batch 2 |
| R1-M22 D-8 | the indirect path (false complaint -> accepted VB reading -> later promotion) counts; harm stays a regression against the incumbent (the incumbent is a latent-defect mutant; the prereg text now says so) | by reading |
| R1-M23 root-cause ledger | grade tuple carries the first-divergence rule (`g[7]`); key rule x change class x arm with silent counts; complete only when `runs/ROOT-CAUSE-REVIEW.json` reviews every record | `analysis` batch 2 |
| R1-M23 D-6 power | `recallClassOC`: per class (3 stream clusters x 9 lineages), all classes must pass; prereg restated (0.62 at a true 0.97 with 4 classes, was "1.00") | `analysis` batch 2; POWER.json |
| R1-M23 visible config | preregistered as built (§6.3): rulebook editions and API schema renames published by the alarm are visible configuration (m4), applied to practice from its start | prereg |
| R2-M8 freeze closure | F-A = its roots plus their import closure (113 files); F-B = every executed module's closure + read files (134 in Appendix D) | `freeze.mjs digests` |
| R2-M10 P0 k | first batch (P0 counts its sessions and always writes P0.json) | - |
| R2-M11 author | a failed author is terminal (exit 5); SEALED.json of any status refuses a re-run; attempts already on the ledger count (never more than one session + one revision) | by reading |
| R2-M12 world-operator VM | sealed world operators run in `worldop-worker.mjs` under Node's permission model (no writes, no children, empty env), with a time limit on definition AND call; cached per input digest; output identical to the old VM on the stub | `fixes` R2-M12 |
| R2-M7 rehearsal | **not built** (prereg §15 item 18): Stage Z alone is 8-12 CPU-h; P0 (<= $2) is the first paid exercise | - |
| R1-mi1 HT | every included index evaluated; Hájek ratio over valid worlds (HT kept as `ht`) | `analysis` HT |
| R1-mi2 end pass | end-of-stream WC-1 and ADV-SET judge every arm with the readings in force at stream end; sealed overlays (R2s d4, U1s d3, E2s d5) in the end pass | by reading |
| R1-mi3 transient F | F cells out of every durable share; damage and first clean day reported | `analysis` batch 2 |
| R1-mi4 W6 falsifier | U1s's exposed cases dropped on both sides | by reading |
| R1-mi5 D-9 | R1's exposure only, W3-W6 | by reading |
| R1-mi6 boundary certification | evidence, history replay and regression set from the gating world (k-1) for boundary and deferred promotions (`deferred: true` recorded) | by reading |
| R1-mi7 C-O revision list | not adopted (§6.4 specifies it; practice cases are certification fixtures) | - |
| R1-mi8 leaks | in-world ids CN-1 (R1), CN-2 (R2s), ed-2026-3 (P1) in the spec notice, CHANGE.md and the heal notice list; AUTHOR-BRIEF tells the author its R2s label is published | `fixes` R1-M18 |
| R1-mi9 reference pools in the gate | not adopted (§15 item 18) | - |
| R1-mi10 VB acceptance | journal up to the alarm; others = cases judged in the rule's 3-day window | by reading |
| R1-mi11 V-9 text | monitor header corrected | - |
| R1-mi12 m6 calibration | cross-conformal p over the three leave-one-world-out folds | by reading |
| R1-mi13 power MC error | SEs printed; size at the margin re-simulated with 4,000 replications: 0.020 (SE 0.002) | POWER.json |
| R1-mi14 K-0 | L1 and E2s added to K-0; D-4 names R-maint(2) "not a human" | by reading |
| R2 minor 1 stale freeze | every paid session re-hashes the frozen files (`checkFilesSync`) | by reading |
| R2 minor 2 ledger race | check + start row under one ledger lock (`withLedgerLock`; the agent meter too); a stop in a background P3 worker already reached the chain (first batch) | by reading |
| R2 minor 3 disk | K-5 checked at every world start in `runStream` (exit 75) | by reading |
| R2 minor 4 Opus wait | P1, P6-P9; at most 4 x 30 min | `sh -n` |
| R2 minor 5 model ids | not adopted (§15 item 19): ids are checked against the policy in every preflight | - |
| R2 minor 6 CLI tests | scratch DUR1_RUNS and an EMPTY `DUR1_FREEZE_DIR` (test hook): after the freeze, no test can pass a freeze check and spend; the real ledger is asserted untouched | `cli` |
| R2 minor 7 orphans | disclosed (§15 item 18) | - |
| R2 minor 8 temp dirs | the CLI and stages tests remove `/var/tmp/foundry-work/dur1-test` | - |
| R2 minor 9 Stage Z resume | disclosed | - |
| R2 minor 10 shared files | run from this worktree only (the freeze pins files live workflows edit on main) | - |

**Found while fixing (not in either review).** A reading that becomes visible during a world (an announced change's
certified reading at publication, an accepted verifier-blind reading) reached the later days' m2 only at the next re-run:
the day signals had been computed at the world's start. If no heal landed, the rest of the world was judged by the stale
contracts (silent R1/R2s failures). `stream.mjs` `refreshAfter` now re-judges the days after d whenever the readings
change (prereg §6.3 "Readings in force").
