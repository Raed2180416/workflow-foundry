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

**Fix phase, before any money ($0):**

1. Correct prereg §11 and the banner to `POWER.json` (four D-3 cells, §4 item 7 above); review code and prereg; record
   the decision (proposed D31, prereg §16) and the seed claim.
2. Freeze F-A and commit it: `node experiments/durability/freeze.mjs write A --commit $(git rev-parse HEAD)`, then
   `git add research/durability-20261021/FREEZE-A.json` and commit.

**P1, the sealed author (Opus 5.5 xhigh, $2 and 60 min per session, one revision; row cap $4):**

    setsid nohup sh experiments/durability/dur1-chain.sh author > research/durability-20261021/runs/chain-author.log 2>&1 &

It writes the bundle to `/var/tmp/foundry-work/dur1-sealed/bundle.json` (outside the repository) and
`research/durability-20261021/SEALED.json` (sha256 and counts only); commit `SEALED.json` without reading the bundle.

**F-B, then everything else:**

    node experiments/durability/power.mjs --out research/durability-20261021/POWER.json
    # prereg status -> FROZEN; commit; then:
    node experiments/durability/freeze.mjs write B --commit $(git rev-parse HEAD)
    git add research/durability-20261021/FREEZE.json && git commit (trailers as usual)
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
| WC-1 end, ADV-SET | `wc1 --when end`, `advset` | $0 |
| P8 | `windows --paid --kind A-Ox` (<= 6 cases, stop rule before each) | <= $7 |
| P9 | `forks --paid` (MH-stale on s1, LD-H x 6) | <= $5 |
| analysis | `analyze` (writes runs/REPORT.json; owner table first) | $0 |

Exit codes: 3 stops the chain (freeze changed or `--paid` missing), 4 budget-stops a row and moves on, 75 is an
environment fault (wait 30 minutes, resume the same step), anything else is retried once and then excluded and reported.
Resume after a restart: the same `setsid nohup sh ... after-author` line (finished steps leave `runs/.done-<step>`).
