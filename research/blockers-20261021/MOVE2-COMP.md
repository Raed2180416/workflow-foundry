# Move 2 on composition: compose-runtime/2, the effect registry, and Move 8's $0 steps for heal/COMP (2026-11-04)

**Scope.** ATTACK.md §6 Move 2, composition half, and D28 (3): build `experiments/compose/runtime2.mjs` with
`effects.registry.json` (identity templates per `system.op` mirroring `capabilities.mjs identityOf`; an inbound inbox
that drops re-delivered results per (module, key); a static single-writer gate), apply the two COMP one-line fixes
*behind the registry*, and rerun M4b (crash after apply, with redelivery) and M4d (same-instant duplicate) on dev worlds
1161 d2 s40, 1162 d3 s40 and 1164 d5 s60 with the stored builds. Then the Move 8 $0 steps ATTACK ties to heal and COMP:
tool-effect cards from probes (10 hand-reviewed), collateral vectors, and the H-cfx differential fuzz.

**Labels and evidence class.** Every number here is **runtime2, development evidence, D28 (3)**: dev worlds, the six stored
COMP-1 builds and the three monolith comparator rows, $0, no model call. PREREG-COMP1 stays frozen: its 16 harness files are
imported unchanged (all 16 sha256 prefixes re-checked against the prereg on 2026-11-04), and nothing here is a re-run of
its predictions. Runtime 1 rows are re-runs of the frozen harness through the new driver; where COMP-1 stored the same
cell, the re-run reproduces it (§3.1). Tags: **[obs]** measured by the committed scripts; **[code]** a property shown by
tests; **[carried]** a number from another note. No look-2/look-3, devCheck or test task or grade, and no sealed bed, was
read; nothing below names a dev60 task or describes a grader requirement. The tool-effect cards were mined from
AutomationBench's tool implementations on a scratch world, with the task registry, rubric and domain packages blocked from
import.

**Outputs.** `research/blockers-20261021/move2/runs/*.json` (one file per subject and runtime: every row with the per-case
pass vector, the logical and business-row digests, the envelope's findings and the harness file hashes),
`move2/analysis.json`, `move2/grading/{grading,comparison}.json`, `move2/READBACK-FRESH-PREDICTION.md` (committed before
its run) and `move2/runs-fresh/*.json`; `research/blockers-20261021/move8/{cfx-fuzz.json, cards/cards.json,
collateral/{vectors,collateral}.json}`.

---

## 0. Verdicts

Every line below is **runtime2, development evidence, D28 (3), $0**; dev worlds only; "r1" is the frozen compose-runtime/1,
"r2" the envelope, "read-back" r2 with the option `reconcile` (§1.2).

1. **ATTACK's four $0 success lines for COMP all hold** [obs, `move2/analysis.json`]:
   - **0 logical duplicates** under M4d in all 18 composed cells (r1: 61, the COMP-1 count; 20 of them outside the
     universal D4 loss). Also 0 in all 288 runtime-2 cells of the battery, every fault, mutant and read-back row included.
   - **Fault-free digests unchanged**: the logical journal and the key-free business rows are equal under r1 and r2 in
     18 of 18 composed and 9 of 9 monolith dev cells, and in 54 of 54 cells on the nine COMP-1 grading worlds, so the
     PREREG-COMP1 M1 numbers reproduce exactly under r2 (974, 955, 886, 1,003, 974 and 920 of 1,022). M4a restart journals
     equal the fault-free ones in 27 of 27 r2 cells.
   - **The distinct-refunds mutant is still flagged**: 12 of 12 cells (two builds × three worlds × fault-free and
     downstream). Without the envelope both refunds commit (8–23 money duplicates per cell); with it the second is refused
     with a visible 409 and an `identity-conflict` finding, never merged.
   - **No false positive on the three C-H-T manifests**: the static single-writer gate passes cht-e8-1/2/3 and flags all
     three C-H manifests (4, 9 and 2 overlapping pairs: the two-writers-of-one-status shape behind D2); 0
     `identity-conflict` findings on any fault-free run.
2. **The two COMP one-line fixes, behind the registry.** The envelope reproduces both source patches without editing a
   build. D2: in all 27 C-H-T cells (three builds × three worlds × none/crash/dup-same) r2 alone scores at least the
   source-patched program (equal in 25, +1 in 2). D3: ch-e8-2's crash collapse (r1 loses 17 / 15 / 31 cases with 26 / 33 /
   54 critical findings) falls to 1 / 0 / 2 with 0 critical; the source patch reaches 0 / 0 / 1; read-back reaches
   0 / 0 / 0. r2 also removes the D2-type duplicates that the D3 patch leaves (ch-e8-2 under M4d: 4 / 3 / 9 → 0).
3. **COMP M4b/M4d inside the monolith band.** Against the band ATTACK names (the three monolith rows), r2 puts 6 of 6
   composed builds inside it on all six (fault, world) cells; r1 had 5, 5, 4, 6, 2 and 1 of 6. On M4d, composed builds
   now lose 8 / 2–3 / 10–11 cases against the monoliths' 8 / 3 / 10–11, and every case they lose is lost by the monoliths
   too: the D4 same-instant start race (keyed start, owner-gated).
   **Caveat, measured:** against a strict band built from the monoliths under r1 only, plain r2 is inside on 3 of 6
   builds on crash 1161, one case over (§3.4).
4. **A defect of plain r2, found and fixed in this run.** Dropping crash orphans throws away information a program can
   use: behind the plain envelope the three monoliths lose 1+1+0 cases more on crash 1161 and 1 more on 1164 than without
   it. The read-back option answers a re-emitted write with the outcome the platform already produced, via a status
   read: crash losses summed over 9 subjects × 3 worlds go **r1 80 → r2 19 → read-back 0**, with fault-free digests
   unchanged (27/27). This was found in-sample, so a prediction was committed (`cd300991`) and checked on two fresh dev
   worlds (1181 d3, 1183 d5): **all three predictions held** (fault-free equal 6/6 and 6/6; read-back crash loss ≤ r2
   and = 0 in 6/6; no duplicate, 409 or new critical finding). Crash losses there: r1 44, r2 1, read-back 0.
5. **Move 8 ($0).** Tool-effect cards: 247 of 329 write routes carded; the 10-card hand review found two probe defects
   (updates read as remove + add; one invalid synthetic value emptied the whole body), both fixed, informative cards in
   the sample 4/10 → 8/10. Collateral: drift patches change 0 of 354 untouched cases and fix 48 of 48 converted ones,
   where an independent rebuild of the same arm disagrees on 3.6–10.9% of cases (0% between the two repaired B1N-H
   lineages). H-cfx differential fuzz (5,000 inputs): Sonnet's patch rejected (427 kind-change crashes, found and shrunk
   automatically), Haiku's and Opus's accepted with 0 spurious disagreements over 4,328 out-of-class inputs.
6. **What this does not show.** No paid run, no sealed or look data; dev worlds only; the read-back result is development
   evidence on 5 worlds and 9 programs; the commit gate against Δ\* (Move 2's second half) is not built here (it needs
   Move 1); the universal D4 loss stays until keyed start (B6) is approved.

---

## 1. What was built

All files are new (D28 (3)); none of the 16 PREREG-COMP1 files, and no file pinned by FREEZE-p2, PREREG-OT0 + AMEND-1, the
A1-C v1/v2 manifests, requirement-ledger-v2 or PREREG-VL1, was edited.

| File | What | Tests |
|---|---|---|
| `experiments/compose/effects.registry.json` | E8 effect registry: one identity template per `system.op` over entity arguments (`charge:{fulfilmentId}`, `status:{orderId}:{fulfilmentId\|-}:{status}`, `notify:{about}:{template}`, …), reads marked `read`. It mirrors `identityOf`; the mirror is a test, not a copy | in `runtime2.test.mjs` |
| `experiments/compose/runtime2.mjs` | compose-runtime/2: the exactly-once envelope (`withEnvelope`), the registry validator, the static gate (`singleWriterProblems`), and the read-back option `reconcile` (§1.2). Imports nothing; inlined into bundles | `runtime2.test.mjs` 20, `runtime2.host.test.mjs` 5 |
| `experiments/compose/bundle2.mjs` | bundles a composed program with the frozen `runtime.mjs` + `loader.mjs` plus `runtime2.mjs`; the envelope wraps the composed solver inside the sandbox; the gate is reported (`report`) or refuses the program (`enforce`) | in `runtime2.test.mjs` |
| `experiments/compose/fault-run2.mjs` | the fault battery under runtime 1 or 2 (imports the frozen `fault-run.mjs`/`faults.mjs`/`run.mjs` unchanged); monoliths and arm-boundary mutants get the same envelope host-side. Per row: logical journal digest (keys renamed by first appearance, envelope carry and findings removed, key-hashing digests dropped), key-free business-row digest, findings, host dedupes, duplicates by case, carry bytes, per-case pass vector | via the host tests |
| `experiments/compose/mutants2.mjs` | arm-boundary mutants: `dupwrites` (a second caller key for each status write: D2), `splitrefund` (two refunds of one fulfilment with different amounts: the distinct-refunds mutant), `lateundo` (a second result for a charge key read as a late arrival and compensated: D3) | in `runtime2.host.test.mjs` |
| `experiments/compose/move2-battery.mjs`, `move2-analyze.mjs`, `move2-grading.mjs` | the battery (resumable; plans `main`, `fixes`, `mutants`, `readback`, `fresh`; `--worlds`), the analysis with the success/kill lines, M1 transparency on the nine grading worlds | — |
| `experiments/compose/collateral.mjs` | Move 8: per-case pass vectors under drift D1 and on the grading worlds; patch vs rebuild collateral | — |
| `experiments/lib/difffuzz.mjs` | Move 8: the differential-fuzz gate (crash / spurious / missed, exact Clopper–Pearson bound from `certify.mjs`), pairwise disagreement, ddmin shrinker | `difffuzz.test.mjs` 4 |
| `experiments/heal2/cfx-fuzz.mjs` | Move 8: the H-cfx instance: module-pair generator with 20 edit kinds, model-derived class oracle, sandboxed runner for the stored check scripts | `heal2/test/cfx-fuzz.test.mjs` 4 |
| `experiments/autobench/probe.py` | Move 8: tool-effect cards for every AutomationBench write route on a scratch world (no task, no rubric) | `autobench/test/probe.test.mjs` 1 |

### 1.1 The envelope, and why it has this shape

The composition sweep's X1 put the key rewrite at `runtime.mjs`'s namespacing site; that file is frozen, so the envelope
sits at the tick boundary instead, which also makes it one mechanism for composed and monolithic arms (the fairness
condition X1 asked for). Three mechanisms, all driven by the registry:

1. **Outbound identity keys (the D2 fix behind the registry).** Every write the registry knows leaves with key
   `=<identity>` (or `=#<64-bit digest>` when the identity is long or has unsafe characters), whatever key the caller
   chose, and whether it chose one. Two emissions of one logical effect, from any module, instance or trigger, share a
   key; the host's idempotency makes the second a no-op (`effect.deduped`). Same identity, other arguments, after the
   first committed: the host answers 409 `key-conflict` and applies nothing; the envelope also logs `identity-conflict`,
   so the conflict is never silent. `after` and `compensates` follow the rewrite. An identity whose arguments are missing
   keeps the caller's key (`identity-unresolved`). This replaces the skeptic's source edit `occurrence: input.eventId` →
   `occurrence: orderId` without touching a build.
2. **The inbound inbox (the D3 fix behind the registry).** Results go back under the caller's own key (null if it gave
   none), so the wrapped program sees exactly what it saw before. Per (outbound key, caller key) the envelope counts
   emissions and delivered results, in the carry. The host answers each emission once, so a result beyond the recorded
   emissions answers an emission the program's rolled-back state does not know: it is dropped (`surplus`), and so is a
   result for an identity key with no record (`orphan`). Both occur only when a crash rolled the carry back after the
   platform applied the tick's effects; the program's re-emission is then answered by the host's deduplicated result, so
   it still sees one result per emission it remembers. This makes ch-e8-2's `lateUndo` harmless without editing it (the
   skeptic's source edit `lateUndo(...)` → "ignore unless cancelled or failed"). Timer and human-task events are never
   filtered (after a crash the program must see them again: its state rolled back with the envelope's), which is why the
   sweep's "dedupe timers per (module, key)" was not built.
3. **The static single-writer gate.** Two owners (parent or modules) declaring overlapping write kinds (equal, or one a
   qualifier of the other) are a problem; reads never conflict. At run time a second caller key for one identity inside
   an instance is logged (`shared-identity`) and its write is a host no-op.

State rides in the carry (`{ cv: 'env2', c: <program carry>, x }`), so a crash rolls it back with the program and a
restart keeps it. Answered entries are evicted first when the state outgrows its byte budget (24 KiB, never more than
the host's 64 KiB carry limit minus the program's own carry); the largest envelope share measured is about 5.1 KB. Findings
go to `decisions.envelope` only on ticks that have some (E8 grades `decisions.subject` only). One deliberate departure
from `identityOf`: the grader scopes identities per case, host keys are world-wide, so a notice about no entity
(`about: null`) has no identity and keeps its caller's key; otherwise two different customers' about-less notices of one
template would merge.

### 1.2 The read-back option (`reconcile`), added in this run

The battery showed a cost of the inbox's orphan drop (§3.4): the host remembers committed keys only, so when a crash rolls
the carry back after an attempt that **failed** (a declined charge, a permanent error), the program's re-emission is a
second attempt, and the oracle counts it (`L2:outside-allowed`). A program that keys its own effects deterministically
can avoid that by itself, because without the envelope the orphaned result reaches its rolled-back state; the envelope's
orphan drop takes that information away. With `reconcile`, an orphaned result of a single write is parked in the carry
(three ticks); when the program re-emits that identity (with no `after` dependant, on a system with a `status` read),
the envelope sends a read of the identity key's status instead of the write, and answers the re-emission with the parked
result, failures included, under the caller's key. The read is the witness ATTACK's kinetic-proofreading paragraph asks
for: a second, independent observation of the world (`reconciled` findings carry the parked status and the read status,
and `mismatch` when a parked success is not committed). A read-back's own late result is never parked. **Off by
default**: with it off the state carries no read-back fields, so the carry and the journal are byte-identical to the
envelope the battery ran (raw journal digests re-checked equal on two stored cells, one fault-free and one crash with 101
orphans; a test pins the state shape).

**Not built, and why.** Keyed start (B6, the D4 race) stays owner-gated with its SPEC-E bump (D28 (3)); the fence-on-cancel
(X1b) needs forward/compensating tags SPEC-E does not yet name; sweep ticks pass through (E8 has no sweeps); the composed
reference (`reference.mjs`) is not run under runtime 2 because it reads the host journal directly, so re-keyed rows would
confound it; the commit gate against Δ\* (Move 2's second half) needs Move 1's Δ\* and belongs to A1-C v2.1.

---

## 2. Tests and their teeth

Each file run alone: `nice -n 15 node --test --test-concurrency=1 <file>`.

| Suite | Result | Teeth |
|---|---|---|
| `experiments/compose/test/runtime2.test.mjs` | 20/20 | 14 of 14 hand-written mutants of `runtime2.mjs` make it fail (caller key kept, surplus kept, gate exact-only, reads conflict, identity conflict silenced, digest kept after an error, unanswered evicted first, timers filtered, read-back always on, read-back ignoring `after`, read-back parking its own reads, `ctx.status` not mapped, `after` not rewritten, key-less writes not keyed); the original restored byte-for-byte each time [code] |
| `experiments/compose/test/runtime2.host.test.mjs` | 5/5 | real E8 host, dev seed 1161 s24: the D2, distinct-refunds and D3 mutants each fail without the envelope and pass with it; transparency on a correct monolith and on cht-e8-1 (bundle and host sites) [code] |
| `experiments/lib/difffuzz.test.mjs` | 4/4 | 7 of 7 mutants killed (crash ignored, spurious ignored, miss ignored, inconclusive accepted, two-sided bound, pairwise blind to crash kinds, ddmin without complements). The pairwise mutant survived the committed test; one assertion block was added in this run [code] |
| `experiments/heal2/test/cfx-fuzz.test.mjs` | 4/4 | the gate rejects the Sonnet candidate, a too-lenient script and a field-blind script, and accepts Opus [code] |
| `experiments/autobench/test/probe.test.mjs` | 1/1 (runs the probe, 3 min) | the two probe fixes of §5.1 are asserted (an update is a change inside one record; Freshdesk's create maps `subject` and `type` → `ticket_type`; Mailchimp's `first_name` → `FNAME`); the committed cards fail both [obs] |

---

## 3. The battery: runtime 1 against runtime 2

**What ran** [obs]. Dev worlds 1161 d2 s40 (43 completed cases), 1162 d3 s40 (44) and 1164 d5 s60 (69). Subjects: the six
stored COMP-1 programs and the three monolith rows COMP-1 used (B1L-H lineage 1, B1N-H lineages 2 and 3). Runtime 1:
none, M4b crash, M4d dup-same. Runtime 2: all six faults (none, M4a restart, M4b crash, M4c dup-delayed, M4d dup-same,
M4e downstream). Plus the source-fix rows, the distinct-refunds mutant, the read-back rows and the fresh-world check:
429 battery cells and 108 grading-world rows, no model call. The 30 main files ran under `runtime2.mjs` sha256
`1c4a6398…` (no `harnessChanged` flag); the read-back and fresh-world files, and 83 of the 108 grading rows, under
`f24c2783…` (the option added; with it off the carry and journal are byte-identical, §1.2).

### 3.1 Runtime 1 reproduces COMP-1

Every runtime-1 cell this driver re-ran matches COMP-1's stored table (RESULT-COMP1.md §6.2) in passed/completed and in
logical duplicates: 81 of 81 [obs].

### 3.2 M4b and M4d, case losses against each subject's own fault-free run (1161 / 1162 / 1164)

| Subject | Fault-free | M4b crash loss r1 | r2 | r2 + read-back | M4b critical r1 → r2 | M4d loss r1 | r2 | M4d duplicates r1 → r2 |
|---|---|---|---|---|---|---|---|---|
| ch-e8-1 | 40/43, 39/44, 60/69 | 1 / 0 / 3 | 1 / 0 / 1 | 0 / 0 / 0 | 0 → 0 | 8 / 3 / 11 | 8 / 3 / 11 | 9 / 5 / 13 → 0 / 0 / 0 |
| ch-e8-2 | 40/43, 38/44, 60/69 | **17 / 15 / 31** | 1 / 0 / 2 | 0 / 0 / 0 | **26 / 33 / 54** → 0 | 8 / 4 / 14 | 8 / 3 / 11 | 4 / 3 / 9 → 0 / 0 / 0 |
| ch-e8-3 | 42/43, 42/44, 56/69 | 0 / 0 / 2 | 0 / 0 / 2 | 0 / 0 / 0 | 0 → 0 | 8 / 4 / 13 | 8 / 3 / 10 | 0 / 3 / 3 → 0 / 0 / 0 |
| cht-e8-1 | 42/43, 42/44, 65/69 | 1 / 0 / 2 | 1 / 0 / 2 | 0 / 0 / 0 | 0 → 0 | 8 / 4 / 14 | 8 / 3 / 11 | 0 / 1 / 3 → 0 / 0 / 0 |
| cht-e8-2 | 40/43, 39/44, 60/69 | 1 / 0 / 2 | 0 / 0 / 1 | 0 / 0 / 0 | 0 → 0 | 8 / 4 / 14 | 8 / 3 / 11 | 0 / 1 / 3 → 0 / 0 / 0 |
| cht-e8-3 | 37/43, 36/44, 59/69 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 12 / 8 / 6 → same (fault-free ones) | 8 / 3 / 14 | 8 / 2 / 11 | 0 / 1 / 3 → 0 / 0 / 0 |
| B1L-H l1 (b1lh-e8-1) | 43/43, 44/44, 68/69 | 0 / 0 / 1 | **1** / 0 / **2** | 0 / 0 / 0 | 0 → 0 | 8 / 3 / 11 | 8 / 3 / 11 | 0 → 0 |
| B1N-H l2 (b1nh-e8-2) | 43/43, 44/44, 68/69 | 0 / 0 / 2 | **1** / 0 / 2 | 0 / 0 / 0 | 0 → 0 | 8 / 3 / 10 | 8 / 3 / 10 | 0 → 0 |
| B1N-H l3 (b1nh-e8-3) | 43/43, 44/44, 68/69 | 0 / 0 / 2 | 0 / 0 / 2 | 0 / 0 / 0 | 0 → 0 | 8 / 3 / 11 | 8 / 3 / 11 | 0 → 0 |
| **Sum, composed** | | 75 | 11 | 0 | 139 → 26 (cht-e8-3's own) | 150 | 130 | 61 → 0 |
| **Sum, monoliths** | | 5 | 8 | 0 | 0 → 0 | 65 | 65 | 0 → 0 |

Under r2, M4a restart and M4c dup-delayed lose 0 cases in all 27 cells each, and every restart journal equals its
fault-free journal. The envelope's findings by fault (r2, all subjects): crash 4,349 `orphan` and 69 `surplus` drops;
dup-same 20 `shared-identity` (a second caller key of one identity in one instance, a host no-op); none elsewhere. The
largest envelope share of a carry is 5.1 KB (the program's own carry: up to 6.5 KB; host limit 64 KiB). Arm errors: 1, 1
and 4 for b1nh-e8-3 under M4c and 1 for cht-e8-1 1164 M4c; the b1nh-e8-3 one on 1161 was re-run under r1 and is the same
error (`merge: target is not an open instance`, case o0037), so it is the program's, not the envelope's; outcomes equal
the fault-free ones [obs].

### 3.3 The source fixes against the envelope (same three faults, both runtimes)

| Program | Fault | r1 | r1 + source fix | r2 (envelope only) | r2 + read-back |
|---|---|---|---|---|---|
| ch-e8-2 (D3, `lateUndo`) | crash, 1161 / 1162 / 1164 | 23, 23, 29 (crit 26, 33, 54) | 40, 38, 59 | 39, 38, 58 | 40, 38, 60 |
| ch-e8-2 | dup-same | 32, 34, 46 (dup 4, 3, 9) | 32, 34, 46 (dup 4, 3, 9) | 32, 35, 49 (dup 0) | — |
| cht-e8-1 (D2, notice key) | dup-same | 34, 38, 51 (dup 0, 1, 3) | 34, 39, 54 | 34, 39, 54 | — |
| cht-e8-2 (D2) | dup-same | 32, 35, 46 (dup 0, 1, 3) | 32, 36, 49 | 32, 36, 49 | — |
| cht-e8-3 (D2) | dup-same | 29, 33, 45 (dup 0, 1, 3) | 29, 34, 48 | 29, 34, 48 | — |

The fault-free and crash cells of the three C-H-T builds are equal across r1, r1 + fix and r2 (cht-e8-2 crash: r2 one
case better than r1 on 1161 and 1164). r2 + source fix has the same per-case pass vector and the same business rows as
r2 in all 36 fix cells: behind the envelope the patches change nothing a case or the systems of record can see. The D3
row is the one place the plain envelope stays below the source patch (one case on 1161 and 1164): the patched program
uses the redelivered result that the envelope's orphan drop takes away. Read-back gives it back.

### 3.4 The monolith band

ATTACK's line is "COMP M4b/M4d within the monolith band". The analysis took the band from the monolith rows under both
runtimes (`move2-analyze.mjs`, written before the run). Here it is also against the stricter band, monoliths under r1
only [obs]:

| Fault | World | Monolith band, r1 (B1L-H l1, B1N-H l2, l3) | Composed r1 (inside) | Composed r2 (inside) | Composed r2 + read-back (inside) | Monoliths r2 | Monoliths r2 + read-back |
|---|---|---|---|---|---|---|---|
| crash | 1161 | 0–0 (0, 0, 0) | 1, 17, 0, 1, 1, 0 (2/6) | 1, 1, 0, 1, 0, 0 (3/6) | 0, 0, 0, 0, 0, 0 (6/6) | 1, 1, 0 | 0, 0, 0 |
| crash | 1162 | 0–0 | 0, 15, 0, 0, 0, 0 (5/6) | all 0 (6/6) | all 0 (6/6) | 0, 0, 0 | 0, 0, 0 |
| crash | 1164 | 1–2 (1, 2, 2) | 3, 31, 2, 2, 2, 0 (4/6) | 1, 2, 2, 2, 1, 0 (6/6) | all 0 (6/6) | 2, 2, 2 | 0, 0, 0 |
| dup-same | 1161 | 8–8 | all 8 (6/6) | all 8 (6/6) | — | 8, 8, 8 | — |
| dup-same | 1162 | 3–3 | 3, 4, 4, 4, 4, 3 (2/6) | 3, 3, 3, 3, 3, 2 (6/6) | — | 3, 3, 3 | — |
| dup-same | 1164 | 10–11 | 11, 14, 13, 14, 14, 14 (1/6) | 11, 11, 10, 11, 11, 11 (6/6) | — | 11, 10, 11 | — |

- **M4d.** Under r2 every case a composed build loses is lost by the monoliths too: on 1161 and 1162 all are in the
  universal D4 set (cases all three monoliths lose: 8 and 3); on 1164, 10 of 11 are, and the eleventh (o0055) is lost by
  two of the three monoliths. The residual is the D4 same-instant start race (42 to 64 cases open a second instance under
  dup-same), which only keyed start (B6) removes; with identity keys the twin instances' effects are deduplicated, so
  it costs cases, not duplicates.
- **M4b.** On the strict band, plain r2 is one case over on crash 1161 for ch-e8-1, ch-e8-2 and cht-e8-1, all the same
  case (o0037), and two monoliths lose one case each behind the plain envelope that they pass without it (B1L-H l1
  o0037, B1N-H l2 o0015). That is the orphan-information loss of §1.2: a declined charge's result arrives after the crash,
  the rolled-back program re-emits the charge, and with the orphan dropped the platform makes a second attempt
  (`L2:outside-allowed`). Read-back removes it everywhere. [inference from the journals: both cases' charges are declined
  with 402 on 1161, and read-back removes every `L2:outside-allowed` code the crash added, in all nine subjects.]

### 3.5 Read-back: in-sample, then on fresh worlds

**In-sample (worlds 1161/1162/1164, 9 subjects)** [obs]: crash losses r1 / r2 / read-back, summed over the three worlds:
ch-e8-1 4 / 2 / 0, ch-e8-2 63 / 3 / 0, ch-e8-3 2 / 2 / 0, cht-e8-1 3 / 3 / 0, cht-e8-2 3 / 1 / 0, cht-e8-3 0 / 0 / 0,
B1L-H l1 1 / 3 / 0, B1N-H l2 2 / 3 / 0, B1N-H l3 2 / 2 / 0; **80 / 19 / 0**. Fault-free logical and business digests of
read-back equal plain r2 in 27 of 27 cells. In the 27 read-back crash cells: 0 duplicates, 0 key conflicts, 0 arm errors,
no critical finding beyond cht-e8-3's fault-free 26; 3,750 re-emitted writes went out as status reads instead of a second
attempt (host dedupes fell from 4,376 to 688; most of the rest answer batch items, which read-back leaves to the host's
deduplication).

**Fresh worlds (1181 d3 s40, 1183 d5 s40; prediction committed before the run, `move2/READBACK-FRESH-PREDICTION.md`)**
[obs, `move2/runs-fresh/`]:

| Subject | World | Fault-free | Crash loss r1 | r2 | r2 + read-back |
|---|---|---|---|---|---|
| ch-e8-2 | 1181 | 39/44 | 21 (crit 36, comp 5/8) | 0 | 0 |
| ch-e8-2 | 1183 | 38/48 | 22 (crit 41, comp 4/13) | 0 | 0 |
| cht-e8-1 | 1181 | 42/44 | 0 | **1** | 0 |
| cht-e8-1 | 1183 | 45/48 | 0 | 0 | 0 |
| B1L-H l1 | 1181 | 44/44 | 1 | 0 | 0 |
| B1L-H l1 | 1183 | 48/48 | 0 | 0 | 0 |

P1 (fault-free equal) 6/6 for read-back vs r2 and 6/6 for r2 vs r1; P2 (read-back ≤ r2) 6/6 and read-back = 0 in 6/6;
P3 (no duplicate, no 409, no new critical) held. The kill line was not crossed. The plain envelope's orphan cost shows up
again (cht-e8-1 on 1181), and read-back removes it again. Recommendation for compose-runtime/2.1: make `reconcile` the
default. That is a harness-version change, so it is left to the COMP-2 track and the owner.

### 3.6 M1 transparency on the grading worlds

The six composed builds, fault-free, under r1 and r2 on the nine COMP-1 grading worlds (1232–1234 × d2, d3, d5; 1,022
completed cases per build): logical digest, business-row digest and per-case pass vector equal in 54 of 54 cells, 0
envelope findings, 0 arm errors. Pooled M1 per build, r1 = r2: ch-e8-1 974, ch-e8-2 955, ch-e8-3 886, cht-e8-1 1,003,
cht-e8-2 974, cht-e8-3 920 (of 1,022), the PREREG-COMP1 values [obs, `move2/grading/comparison.json`]. So runtime 2 does
not move M1, and ATTACK's projected "pooled M1 ≥ 0.955 → ≥ 0.98 excluding go-live" does not come from runtime 2: M1 is
fault-free, and its failures are seam logic and go-live, not effect identity. What runtime 2 removes is the D2/D3 share
of the fault battery (M4).

---

## 4. ATTACK's success and kill lines, read

| ATTACK Move 2, COMP $0 step | Result | Reading |
|---|---|---|
| 0 logical duplicates outside the universal D4 loss | 0 in all 108 r2 cells of the six builds, every fault (r1 under M4d: 61) | **holds** |
| fault-free digests unchanged | 18/18 composed + 9/9 monolith dev cells, 54/54 grading cells, 6/6 fresh | **holds** |
| the distinct-refunds mutant still flagged | 12/12 cells, 409 + `identity-conflict`, never merged | **holds** |
| no false positives on the three C-H-T manifests | gate: 0 of 3 flagged (C-H: 3 of 3 flagged); 0 fault-free `identity-conflict` | **holds** |
| COMP M4b/M4d within the monolith band | 6/6 builds inside on all six cells (r1: 23 of 36); strict band: 33/36, the 3 misses one case each, removed by read-back (36/36) | **holds**, with the caveat of §3.4 |
| X1 (sweep): ch-e8-2 crash within 3 cases of fault-free | r1 17 / 15 / 31 → r2 1 / 0 / 2, critical 0 | **holds** |
| Kill (COMP): the envelope changes fault-free behaviour or flags C-H-T falsely | not crossed | — |

The AutomationBench half of Move 2's $0 step (replaying the dev60 arms' calls through `replay-gate.mjs --lint` with Move
1's dispositions) belongs to the A1-C v2.1 track and is not part of this note.

---

## 5. Move 8, the $0 steps for heal and COMP

### 5.1 Tool-effect cards (`probe.py`), with 10 cards reviewed by hand

**What it does.** For each of the 329 write routes (POST, PUT, PATCH, DELETE) of the 46 AutomationBench app routers, the
probe calls the route on a fork of a scratch world (`WorldState()` with a fixed clock) with synthetic arguments built
from the implementing function's signature, and diffs the world: which collections changed, which records were added,
removed or changed, which action key was recorded, and under which field each argument value was stored. Routes with
path ids run on a world seeded by the probe's own create calls. The task registry, the rubric and the domain packages are
blocked from import, so a card is a description of the tool, never of a task. Runs in AutomationBench's own venv,
`python -I`, from a neutral directory; about 2 minutes [obs].

**Hand review (10 cards, drawn with seed 20261104 from the 245 that succeeded on the committed run; each checked against
the implementing function in `automationbench/tools/api/impl/*.py`).**

| Route | Card before | Implementation | Verdict |
|---|---|---|---|
| `calendly.one_off_event_types_create` | collection right; **no argument mapping** (empty body) | stores name, host as `owner_id`, duration | partial → fixed: now `host → owner_id` |
| `freshdesk.tickets_create` | collection right; **empty body** | stores subject, description, status, `type` as `ticket_type` | partial → fixed |
| `linkedin_conversions.events_create` | 13 arguments mapped | stores them verbatim | correct |
| `quickbooks.item_create` | collection right; no mapping | takes one `body: dict` with a schema the probe cannot synthesise | partial (still) |
| `quickbooks.billpayment_create` | collection right; no mapping | same `body: dict` pattern | partial (still) |
| `asana.tasks_add_tag` | action `add_tag_to_task`, `tag`, path id → `task_id` | as carded | correct |
| `helpscout.conversations_update` | **add 1 + remove 1**; only the path id | an update of one record | wrong shape → fixed: `change 1`, `assignTo → assigned_to` |
| `intercom.conversations_reply` | add 1 + remove 1; body, `contact_id → author_id` | appends a part to one conversation | wrong shape → fixed: `change 1` |
| `mailchimp.members_create` | only the path id | stores email, tags, `first_name`/`last_name` as merge fields `FNAME`/`LNAME` | partial → fixed |
| `zoho_desk.tickets_update` | add 1 + remove 1; only the path id | an update of one record | wrong shape → fixed (`change 1`; one field mapped) |

Two probe defects explain every wrong or partial card but the QuickBooks pair: (a) lists of records were diffed by
content, so any update read as a removal plus an addition; (b) one synthetic value outside a pydantic `Literal` (a
priority of 6, a status string) failed the whole body, and the probe fell back to the empty body, which succeeds and maps
nothing. Fixed in this run: records with unique ids are matched by id (an update is a change inside one record), and a
pydantic validation error drops only the fields it names. Re-run [obs]:

| | committed probe | fixed probe |
|---|---|---|
| routes probed successfully | 245 / 329 | 247 / 329 |
| cards whose update reads as remove + add | 55 | 2 (`gmail.drafts_send`, `xero.invoice_email`: the record's id changes) |
| cards with a `change` | 0 | 53 |
| cards mapping at least one argument to a stored field | 93 | 106 |
| cards with a stored name the agent cannot see in the API (renamed beyond case) | 33 | 40 |
| action keys recorded | 75 | 76 |
| reviewed sample informative (correct or fixed) | 4 / 10 | 8 / 10 |

Of the 247 successful cards, 79 call routes that take no argument beyond path ids, so an empty body is right there. The
QuickBooks-style `body: dict` routes stay partial: the probe would need the pydantic model behind the dict, which is the
next step if cards go into a brief. **What the cards are for (Move 8):** injected into the inventory brief, they are the
paid step's treatment ("cards flip ≥ 4 of the 12 never-passed non-defect tasks"); that step is paid and was not run.

### 5.2 Collateral vectors (patch vs rebuild), runtime 1

Per-case pass vectors of the six composed programs, their six drift-D1 patches (`review-timeout-clears`) and the five
monolith lineages, on the two drifted dev worlds (1165 d2 s30, 1166 d3 s30; 4 converted cases each) and the nine
undrifted grading worlds. Collateral = cases other than the drift-converted ones whose outcome changed [obs]:

- **Patch collateral.** The six programs' drift-D1 patches (the stored COMP-1 M5 patches) change **0 of 354** untouched
  cases on the drifted worlds and fix **48 of 48** converted cases (4 per program per world) [obs].
- **Rebuild collateral.** Independent builds of the same arm disagree on cases nobody asked to change [obs]:

| Arm (pairs of builds) | Drifted worlds, cases compared | Disagree | Grading worlds, cases compared | Disagree |
|---|---|---|---|---|
| C-H (3 builds, 3 pairs) | 177 | 10 (5.6%) | 3,066 | 334 (10.9%) |
| C-H-T (3 builds) | 177 | 18 (10.2%) | 3,066 | 170 (5.5%) |
| B1L-H raw (3 lineages) | 177 | 16 (9.0%) | 3,066 | 110 (3.6%) |
| B1N-H repaired (2 lineages) | 59 | 0 | 1,022 | 0 |

- **Reading.** A drift handled as a patch moves only the cases the drift converts; a rebuild of the same arm moves 3.6–10.9%
  of the other cases (the repaired monolith lineages, which converged, are the exception). That is the $0 measurement behind
  Move 8's "change-driven maintenance": the diff is the unit of change, and a rebuild is not a safe substitute for a patch.
  It does not show that patches are always safe: these are six patches of one drift, each with 4 converted cases per world.
  187 runs, 0 arm errors, runtime 1 (the frozen harness).

### 5.3 H-cfx differential fuzz (`difffuzz.mjs`, `cfx-fuzz.mjs`)

The 2026-10-08 codefix incident H-cfx: the deterministic check node refused fixes whose only API change was a documented
default value. Three proposers (Sonnet, Haiku, Opus) each wrote a replacement check, justified as
"default-value-changed". The gate runs the base check and the three stored candidates in the executor sandbox on 5,000
generated module pairs (seed 20261028; 20 edit kinds; the class of each pair computed from the two structured models,
never from the edit labels): outside the justified class the base is the oracle; inside it the intended verdict is "ok"
[obs, `move8/cfx-fuzz.json`].

| Candidate | Verdict | Crashes | Spurious disagreements (out of class) | Justified flips | Upper 95% bound on the spurious rate |
|---|---|---|---|---|---|
| base (unrepaired) | reject | 0 | 0 / 4,328 | 0 / 672 (misses all 672) | 0.00069 |
| Sonnet r2 | **reject** | 427 (all on a `func-to-class` edit; `TypeError`) | 0 / 3,901 | 672 / 672 | 0.00077 |
| Haiku r3 | **accept** | 0 | 0 / 4,328 | 672 / 672 | 0.00069 |
| Opus r4 | **accept** | 0 | 0 / 4,328 | 672 / 672 | 0.00069 |

- ATTACK's expectation holds: the gate rediscovered the Sonnet kind-change crash automatically (427 of the 472 inputs
  that change a function into a class), ddmin shrank a failing pair to one definition (`def score()` → `class score`),
  and there were 0 spurious disagreements over 4,328 out-of-class inputs for the accepted candidates.
- Haiku and Opus agree on all 5,000 inputs; each disagrees with Sonnet on exactly the 427 crashes.
- Against Move 0's gauntlet re-score (Sonnet rejected; Haiku inconclusive; Opus accepted in deterministic mode only), the
  fuzz is a second, independent information path: it settles Haiku's case on the generator's distribution. The bound is
  about that distribution, not about the incident's natural inputs, and no heal claim follows (D28 (5): the heal kit stays
  frozen and heal replays stay blocked).

---

## 6. What is left, and why

| Item | Why it is not done here | Who |
|---|---|---|
| Make read-back (`reconcile`) the runtime2 default (compose-runtime/2.1) | It changes the harness version; the evidence is development-grade on five dev worlds (3 in-sample, 2 fresh) and nine programs | COMP-2 track, owner (D28 (3) approved runtime2, not this default) |
| Keyed start (B6) for the D4 same-instant start race | Owner-gated with its SPEC-E bump (D28 (3)); it is the whole residual M4d loss (8 / 3 / 10–11 cases per world, the same for composed and monolithic arms) | owner |
| The commit gate against Δ\* (Move 2's second half: admit a write with a certificate, or hold it) | Needs Move 1's Δ\*; E8's grader-side identity is mirrored, but a closed-world expected diff for E8 is not derived here | A1-C v2.1 / COMP-2 |
| AutomationBench half of Move 2's $0 step (`replay-gate.mjs --lint` over the dev60 arms' calls) | A1-C track; needs Move 1's dispositions | A1-C v2.1 |
| Fence-on-cancel (X1b) | SPEC-E names no forward/compensating tags | COMP-2 with a SPEC-E bump |
| The composed reference (`reference.mjs`) under runtime 2 | It reads the host journal directly; re-keyed rows would confound it | — |
| Read-back for batch writes | Batch items keep the host's deduplication (they were 597 of the orphans under read-back, with no loss measured) | COMP-2 if a batch case appears |
| Cards into a brief, and the paid cards arm (12 never-passed non-defect tasks + 20 controls, ≤ $3) | Paid; needs a preregistration under D22 and a harness after the frozen A1-C v2 | A1-C v2.1 |
| Cards for `body: dict` routes (QuickBooks-style) | The probe would need the pydantic model behind the dict | probe v2 |
| SR-1 notice-withheld arm (≈ $0.5–2) and the M5 monolith baseline (`patch-drift.mjs --monolith`) | Paid model sessions | heal / COMP-2, preregistered first |
| A heal claim from the fuzz gate | D28 (5): heal claims only through the certification gauntlet, and the heal kit stays frozen; the fuzz bound is about the generator's distribution | heal track, owner (kit decision) |
| A pooled-M1 improvement | Not a runtime2 effect: M1 is fault-free and identical under r2 (§3.6) | Move 5 (go-live extraction), seam logic |

---

## 7. Reproduce ($0)

```
nice -n 15 node experiments/compose/move2-battery.mjs --plan all          # runtime 1 vs 2, fixes, mutant (resumable)
nice -n 15 node experiments/compose/move2-battery.mjs --plan readback     # read-back rows, same worlds
nice -n 15 node experiments/compose/move2-battery.mjs --plan fresh --worlds 1181:3:40,1183:5:40 --out research/blockers-20261021/move2/runs-fresh
nice -n 15 node experiments/compose/move2-grading.mjs                     # M1 transparency, nine grading worlds
node experiments/compose/move2-analyze.mjs                                # tables + success/kill -> move2/analysis.json
nice -n 15 node experiments/compose/collateral.mjs --worlds all           # Move 8 collateral vectors
nice -n 15 node experiments/heal2/cfx-fuzz.mjs --n 5000 --seed 20261028   # Move 8 H-cfx differential fuzz
corpus/AutomationBench/.venv/bin/python -I experiments/autobench/probe.py --out research/blockers-20261021/move8/cards   # from a neutral cwd
```

Tests, one file at a time (`nice -n 15 node --test --test-concurrency=1 <file>`):
`experiments/compose/test/runtime2.test.mjs` (20), `experiments/compose/test/runtime2.host.test.mjs` (5),
`experiments/lib/difffuzz.test.mjs` (4), `experiments/heal2/test/cfx-fuzz.test.mjs` (4),
`experiments/autobench/test/probe.test.mjs` (1).
