# Move 2 on composition: compose-runtime/2, the effect registry, and Move 8's $0 steps for heal/COMP (2026-11-04)

**Scope.** ATTACK.md §6 Move 2, composition half, and D28 (3): build `experiments/compose/runtime2.mjs` with
`effects.registry.json` (identity templates per `system.op` mirroring `capabilities.mjs identityOf`; an inbound inbox
that drops re-delivered results per (module, key); a static single-writer gate), apply the two COMP one-line fixes
*behind the registry*, and rerun M4b (crash after apply, with redelivery) and M4d (same-instant duplicate) on dev worlds
1161 d2 s40, 1162 d3 s40 and 1164 d5 s60 with the stored builds. Then the Move 8 $0 steps ATTACK ties to heal and COMP:
tool-effect cards from probes (10 hand-reviewed), collateral vectors, and the H-cfx differential fuzz.

**Labels and evidence class.** Every number in §1–§4 and §8 is **runtime2, development evidence, D28 (3)**: dev worlds, the
six stored COMP-1 builds and the three monolith comparator rows, $0, no model call. §5 (Move 8) is **not** runtime2: the
collateral vectors ran under runtime 1, and the cards and the fuzz gate do not involve the runtime; it is development
evidence, $0, too. **Revised 2026-11-04 after review (§8)**: the review's defects D1, D2 and D6–D10 (and one more found
while verifying them, §8.2) changed runtime2, so **every runtime-2 cell was re-run under the one revised file**
(`runtime2.mjs` sha256 `cde405e3…`): 264 battery cells (`move2/runs-v2/`), 24 fresh-world cells (`move2/runs-fresh-v2/`)
and 54 grading-world cells (`move2/grading-v2/`). Every runtime-2 number in this note is from those rows; runtime-1 numbers
are the unchanged frozen-runtime rows in `move2/runs/`, `runs-fresh/` and `grading/`. The pre-review runtime-2 rows stay in
those directories as the record, and §8.3 compares them cell by cell. PREREG-COMP1 stays frozen: its 16 harness files are
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
collateral/{vectors,collateral}.json}`. Since the review: `move2/runs-v2/`, `runs-fresh-v2/`, `grading-v2/`,
`fresh-analysis.json` (the committed read-back prediction, read again), `recompare-v2.json` (pre- vs post-review, cell by
cell), `mutants-runtime2.json` and `mutants-runtime2-prereview.json` (the teeth); `analysis.json` is regenerated from
`runs/` + `runs-v2/` (a later directory supersedes an earlier one cell by cell; every cell records its runtime2 hash).

---

## 0. Verdicts

Items 1–4 are **runtime2, development evidence, D28 (3), $0**; dev worlds only; "r1" is the frozen compose-runtime/1,
"r2" the envelope (runtime2 `cde405e3…`, after the review), "read-back" r2 with the option `reconcile` (§1.2). Item 5 is
Move 8 and not runtime2 (see the labels above). Item 7 is the review and the re-run.

1. **ATTACK's $0 success lines for COMP** [obs, `move2/analysis.json`], the ones that could have failed first:
   - **COMP M4b/M4d within the monolith band** (oracle-graded case loss; ATTACK does not fix the band's rows, this note
     takes the three COMP-1 monolith comparator rows). **Like for like** (composed and monoliths under the same runtime):
     r2 **36/36** (build, fault, world) cells inside, r1 20/36, read-back 18/18 (crash only). **Against the frozen band**
     (monoliths under r1 only, the stricter reading): r2 **33/36, so the line does not hold for default r2**: ch-e8-1,
     ch-e8-2 and cht-e8-1 are one case over on crash 1161, the orphan cost of §1.2, which also costs two of the three
     monoliths behind the plain envelope a case each there; read-back 18/18. So the line holds for default runtime2 like for like, and
     against the frozen runtime's band only with read-back, which is off by default.
   - **Fault-free behaviour unchanged**: the logical journal and the key-free business rows are equal under r1 and r2 in
     18 of 18 composed and 9 of 9 monolith dev cells, and in 54 of 54 cells on the nine COMP-1 grading worlds, so the
     PREREG-COMP1 M1 numbers reproduce exactly under r2 (974, 955, 886, 1,003, 974 and 920 of 1,022). M4a restart journals
     equal the fault-free ones in 27 of 27 r2 cells.
   - **The distinct-refunds mutant is still flagged**: 12 of 12 cells (two builds × three worlds × fault-free and
     downstream). Without the envelope both refunds commit (8–23 money duplicates per cell); with it the second is refused
     with a visible 409 and an `identity-conflict` finding, never merged.
   - **No false positive on the three C-H-T manifests**: the static single-writer gate passes cht-e8-1/2/3 and flags all
     three C-H manifests (4, 9 and 2 overlapping pairs: the two-writers-of-one-status shape behind D2); 0
     `identity-conflict` findings on any fault-free run.
   - **0 logical duplicates under M4d** (r1: 61, 20 of them outside the universal D4 loss), and 0 in all 264 runtime-2
     battery cells. **[code] This is a mechanism check, circular by construction** (review D3): the registry equals
     `identityOf`, duplicates are counted with `identityOf`, and the host deduplicates any resolved identity, so 0 is
     guaranteed once the envelope is wired in. It shows the wiring, not that the identities are right; the band and the
     business-row digests above are the readouts that could have failed.
2. **The two COMP one-line fixes, behind the registry.** The envelope reproduces both source patches without editing a
   build. D2: in all 27 C-H-T cells (three builds × three worlds × none/crash/dup-same) r2 alone scores at least the
   source-patched program (equal in 25, +1 in 2). D3: ch-e8-2's crash collapse (r1 loses 17 / 15 / 31 cases with 26 / 33 /
   54 critical findings) falls to 1 / 0 / 2 with 0 critical; the source patch reaches 0 / 0 / 1; read-back reaches
   0 / 0 / 0. r2 also removes the D2-type duplicates that the D3 patch leaves (ch-e8-2 under M4d: 4 / 3 / 9 → 0).
3. **M4d is the D4 race, shared with the monoliths.** On M4d, composed builds lose 8 / 2–3 / 10–11 cases against the
   monoliths' 8 / 3 / 10–11, and every case they lose is lost by at least two of the three monoliths: the D4 same-instant
   start race (keyed start, owner-gated).
4. **A defect of plain r2, and the read-back option.** Dropping crash orphans throws away information a program can use:
   behind the plain envelope the monoliths lose 1+1+0 cases more on crash 1161 and 1 more on 1164 than without it. The
   read-back option answers a re-emitted write whose first attempt failed with that failure, once a status read shows
   nothing committed: crash losses summed over 9 subjects × 3 worlds go **r1 80 → r2 19 → read-back 0**, fault-free
   digests unchanged (27/27). After the review's D2 fix only failures are parked, so 62 re-emissions (not 3,750) became
   status reads; all 62 reads showed nothing committed. The prediction committed before the fresh-world check
   (`cd300991`) holds again under the revised file on 1181 d3 and 1183 d5: P1 6/6 and 6/6, P2 6/6 with read-back = 0 in
   6/6, P3 24/24; crash losses r1 44, r2 1, read-back 0 (`move2/fresh-analysis.json`). Those two worlds are no longer
   unseen (the pre-review run is known); the revision was not tuned on them.
5. **Move 8 ($0, not runtime2).** Tool-effect cards: 247 of 329 write routes carded; the 10-card hand review found two
   probe defects (updates read as remove + add; one invalid synthetic value emptied the whole body), both fixed,
   informative cards in the sample 4/10 → 8/10. Collateral (runtime 1): drift patches change 0 of 354 untouched cases and
   fix 48 of 48 converted ones, where an independent rebuild of the same arm disagrees on 3.6–10.9% of cases (0% between
   the two repaired B1N-H lineages). H-cfx differential fuzz (5,000 inputs): Sonnet's patch rejected (427 kind-change
   crashes, found and shrunk automatically), Haiku's and Opus's accepted with 0 spurious disagreements over 4,328
   out-of-class inputs; under D28 (5) Haiku's patch stays inconclusive in the gauntlet and no heal claim follows.
6. **What this does not show.** No paid run, no sealed or look data; dev worlds only; the read-back result is development
   evidence on 5 worlds and 9 programs; **ATTACK's Move 2 kill lines were not evaluated** (more than one false refusal on
   passing worlds; an admitted write that Δ\* cannot explain): they need Move 1's Δ\* and the replay gate, which do not
   exist yet. The composition analogue used here instead (the envelope changes fault-free behaviour, or the gate flags a
   C-H-T manifest) is not crossed, and it is this note's line, not ATTACK's. The commit gate against Δ\* (Move 2's second
   half) is not built; the universal D4 loss stays until keyed start (B6) is approved.
7. **The review of 2026-11-04 (§8).** Three medium defects in runtime2 (D1 surplus by count, D2 read-back answering
   without checking the read or the arguments, D6 teeth narrower than claimed), four low ones (D7–D10), four evidence
   labels (D3–D5, D11, D12) and a sandbox note (D13): all fixed or relabelled, one part of D2 answered differently with
   evidence, and one more defect found while verifying (read-back dropped an effect's own `after`). The re-run of all 264
   runtime-2 battery cells moved **no** per-case pass vector and no business row: 264 of 264 equal to the pre-review
   cells (the 27 read-back crash journals differ only in which re-emissions went out as reads).

---

## 1. What was built

All files are new (D28 (3)); none of the 16 PREREG-COMP1 files, and no file pinned by FREEZE-p2, PREREG-OT0 + AMEND-1, the
A1-C v1/v2 manifests, requirement-ledger-v2 or PREREG-VL1, was edited.

| File | What | Tests |
|---|---|---|
| `experiments/compose/effects.registry.json` | E8 effect registry: one identity template per `system.op` over entity arguments (`charge:{fulfilmentId}`, `status:{orderId}:{fulfilmentId\|-}:{status}`, `notify:{about}:{template}`, …), reads marked `read`. It mirrors `identityOf`; the mirror is a test, not a copy | in `runtime2.test.mjs` |
| `experiments/compose/runtime2.mjs` | compose-runtime/2: the exactly-once envelope (`withEnvelope`), the registry validator, the static gate (`singleWriterProblems`), and the read-back option `reconcile` (§1.2). Imports nothing; inlined into bundles | `runtime2.test.mjs` 27, `runtime2.host.test.mjs` 5, `runtime2-mutants.mjs` 42 |
| `experiments/compose/bundle2.mjs` | bundles a composed program with the frozen `runtime.mjs` + `loader.mjs` plus `runtime2.mjs`; the envelope wraps the composed solver inside the sandbox; the gate refuses a flagged program by default (`enforce`; review D10) or only records it (`report`, which the replays of the stored COMP-1 programs pass explicitly) | in `runtime2.test.mjs` |
| `experiments/compose/fault-run2.mjs` | the fault battery under runtime 1 or 2 (imports the frozen `fault-run.mjs`/`faults.mjs`/`run.mjs` unchanged); monoliths and arm-boundary mutants get the same envelope host-side. Per row: logical journal digest (keys renamed by first appearance, envelope carry and findings removed, key-hashing digests dropped), key-free business-row digest, findings, host dedupes, duplicates by case, carry bytes, per-case pass vector | via the host tests |
| `experiments/compose/mutants2.mjs` | arm-boundary mutants: `dupwrites` (a second caller key for each status write: D2), `splitrefund` (two refunds of one fulfilment with different amounts: the distinct-refunds mutant), `lateundo` (a second result for a charge key read as a late arrival and compensated: D3) | in `runtime2.host.test.mjs` |
| `experiments/compose/move2-battery.mjs`, `move2-analyze.mjs`, `move2-grading.mjs` | the battery (resumable; plans `main`, `fixes`, `mutants`, `readback`, `fresh`, and since the review `v2` (every runtime-2 cell) and `fresh-v2`; `--worlds`), the analysis with the success/kill lines (since the review: two bands with computed `holds`, cell-level merge of run directories with provenance, `--fresh` reads the committed read-back prediction), M1 transparency on the nine grading worlds (since the review `--runtimes`, `--baseline`); `move2-recompare.mjs` compares pre- and post-review rows cell by cell | — |
| `experiments/compose/collateral.mjs` | Move 8: per-case pass vectors under drift D1 and on the grading worlds; patch vs rebuild collateral | — |
| `experiments/lib/difffuzz.mjs` | Move 8: the differential-fuzz gate (crash / spurious / missed, exact Clopper–Pearson bound from `certify.mjs`), pairwise disagreement, ddmin shrinker | `difffuzz.test.mjs` 4 |
| `experiments/heal2/cfx-fuzz.mjs` | Move 8: the H-cfx instance: module-pair generator with 20 edit kinds, model-derived class oracle, sandboxed runner for the stored check scripts (since the review: resource caps, D13) | `heal2/test/cfx-fuzz.test.mjs` 5 |
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
   emissions and delivered results, in the carry; when a second caller key shares an identity it also keeps the order of
   the owed emissions and hands results out first-in first-out (the host answers each system's emissions in order;
   review D8). A result for an identity key with no record is dropped (`orphan`). A result beyond the recorded emissions
   (`surplus`) means an emission the program's rolled-back state does not know came first, so an earlier delivery may have
   been that emission's answer (review D1). The surplus is therefore compared with what the program was told: it is
   **delivered** (`conflicting-result`, not counted) when the program's view would otherwise be wrong (an `ok` when no
   `ok` was delivered, i.e. the effect committed unseen; a 409 key-conflict, i.e. its remembered arguments differ from the
   committed ones; a failure other than the failure delivered), and **dropped** when it agrees (`surplus`) or is a
   failure after a delivered `ok` (`surplus-after-commit`: the effect committed and the program knows it). Before the
   review every surplus was dropped by count. This makes ch-e8-2's `lateUndo` harmless without editing it (the
   skeptic's source edit `lateUndo(...)` → "ignore unless cancelled or failed"). Timer and human-task events are never
   filtered (after a crash the program must see them again: its state rolled back with the envelope's), which is why the
   sweep's "dedupe timers per (module, key)" was not built.
3. **The static single-writer gate.** Two owners (parent or modules) declaring overlapping write kinds (equal, or one a
   qualifier of the other) are a problem; reads never conflict. At run time a second caller key for one identity inside
   an instance is logged (`shared-identity`) and its write is a host no-op. `bundle2.mjs` refuses a flagged program by
   default (since the review, D10; ATTACK says the gate "refuses" such manifests). Every battery row is **gate
   reported**: the stored COMP-1 programs were built before the gate existed, so the replays pass `gate: 'report'`
   (recorded as `gateMode` in the re-run rows) and the three flagged C-H programs ran anyway.

State rides in the carry (`{ cv: 'env2', c: <program carry>, x }`), so a crash rolls it back with the program and a
restart keeps it. Answered entries are evicted first when the state outgrows its byte budget (24 KiB, never more than
the host's 64 KiB carry limit minus the program's own carry), then parked read-back results; an entry still owed a result
is never evicted (review D7: before, it could be, and the program then never saw its own result), and if what remains
does not fit the host's limit the tick throws instead of dropping it. The largest envelope share measured in any cell is
5.3 KB (5.1 KB outside the mutant rows), and no run evicted anything. Findings go to `decisions.envelope` only on ticks that have some (E8 grades
`decisions.subject` only). Two deliberate departures from `identityOf`, both because the grader scopes identities per case
while host keys are world-wide: a notice about no entity (`about: null`) has no identity and keeps its caller's key, and
more generally a null slot without a default leaves the identity unresolved where `identityOf` spells it (`charge:null`);
otherwise every fulfilment-less write of one op would merge world-wide. Slot values are escaped (review D9: `%`, `:` and
`#` as `%XX`, a number as `#n`, a value spelled like its slot's default as `%=` + value), so identities are injective;
E8's identities contain none of these, so they still equal `identityOf`'s (tested on 3,000 fuzzed effects and on every
committed write of a reference run).

### 1.2 The read-back option (`reconcile`), added in this run, revised after the review

The battery showed a cost of the inbox's orphan drop (§3.4): the host remembers committed keys only, so when a crash rolls
the carry back after an attempt that **failed** (a declined charge, a permanent error), the program's re-emission is a
second attempt, and the oracle counts it (`L2:outside-allowed`). A program that keys its own effects deterministically
can avoid that by itself, because without the envelope the orphaned result reaches its rolled-back state; the envelope's
orphan drop takes that information away. With `reconcile`, an orphaned **failure** of a single write is parked in the
carry (three ticks); when the program re-emits that identity (on a system with a `status` read, with no `after`
dependant, and, since the resume of the fix step, not itself carrying `after`: §8.2), the envelope sends a read of the
identity key's status instead of the write. **The read gates the answer**
(review D2): if it shows nothing committed (`not-found`), the re-emission is answered with the parked failure under the
caller's key (`reconciled`); if it shows anything else (committed, pending, a failed read) or never comes (20 ticks), the
re-emitted write is sent as written (`readback-reissued`, `readback-expired`), so the host's own idempotency answers it.
An orphaned `ok` is not parked: the re-emission goes to the host, which answers with the committed result when the
arguments are equal and with 409 key-conflict when they differ (`mocks.mjs` 226–229). Before the review every orphan was
parked and answered whatever the read said, so a re-emission with changed arguments after a committed attempt was told
`ok` instead of 409, and a `not-found` read did not stop a parked `ok` (both reproduced by the review, both now tests).
**Limit:** the host's status read returns `{ key, status }` only (`mocks.mjs` 281), and a failed attempt leaves no
committed arguments, so a re-emission whose arguments differ from those of the failed, rolled-back attempt still gets the
parked failure; comparing them needs a host that records attempted arguments (a SPEC-E question, not a runtime one).
The re-issued write cannot carry `after` (the host's `after` names an effect of the same output only, `output.mjs` 33–35),
which is why a re-emission that carries one is never read back: re-issued later without it, it could commit after a
failed predecessor (`host.mjs` 756–757 would have skipped it). A read-back's own late result is never parked. **Off by default**: with it off the state holds no read-back fields (a test
pins the state shape).

**Not built, and why.** Keyed start (B6, the D4 race) stays owner-gated with its SPEC-E bump (D28 (3)); the fence-on-cancel
(X1b) needs forward/compensating tags SPEC-E does not yet name; sweep ticks pass through (E8 has no sweeps); the composed
reference (`reference.mjs`) is not run under runtime 2 because it reads the host journal directly, so re-keyed rows would
confound it; the commit gate against Δ\* (Move 2's second half) needs Move 1's Δ\* and belongs to A1-C v2.1.

---

## 2. Tests and their teeth

Each file run alone: `nice -n 15 node --test --test-concurrency=1 <file>`.

| Suite | Result | Teeth |
|---|---|---|
| `experiments/compose/test/runtime2.test.mjs` | 27/27 (was 20) | **42 of 42** mutants in the committed `runtime2-mutants.mjs` are killed (`move2/mutants-runtime2.json`, runtime2 `cde405e3…`); the pre-review `runtime2.mjs` (`f24c2783…`) fails 5 of the 27 (the D1, D2, D7, D8 and D9 tests; `move2/mutants-runtime2-prereview.json`). Before the review the teeth claim rested on 14 uncommitted mutants and the reviewer found 8 of 12 more surviving; each of those 8 is now in the list and killed [code] |
| `experiments/compose/test/runtime2.host.test.mjs` | 5/5 (re-run on `cde405e3…`) | real E8 host, dev seed 1161: the D2, distinct-refunds and D3 mutants each fail without the envelope and pass with it; transparency on a correct monolith and on cht-e8-1 (bundle and host sites); read-back on 1161 s40 (the smallest battery world with a crash-orphaned declined charge): parked and reconciled, no `L2:outside-allowed`, while plain r2 has one; orphaned successes go to the host [code] |
| `experiments/lib/difffuzz.test.mjs` | 4/4 | 7 of 7 mutants killed (crash ignored, spurious ignored, miss ignored, inconclusive accepted, two-sided bound, pairwise blind to crash kinds, ddmin without complements). The pairwise mutant survived the committed test; one assertion block was added in this run [code] |
| `experiments/heal2/test/cfx-fuzz.test.mjs` | 5/5 (was 4) | the gate rejects the Sonnet candidate, a too-lenient script and a field-blind script, and accepts Opus; since the review the runner's caps refuse a 2.5 GiB allocation, a fork and a 2 MiB file; the cap test fails against the pre-review runner (checked on the resume: the 2.5 GiB allocation succeeds there) [code] |
| `experiments/autobench/test/probe.test.mjs` | 1/1 (runs the probe, 3 min) | the two probe fixes of §5.1 are asserted (an update is a change inside one record; Freshdesk's create maps `subject` and `type` → `ticket_type`; Mailchimp's `first_name` → `FNAME`); the committed cards fail both [obs] |

---

## 3. The battery: runtime 1 against runtime 2

**What ran** [obs]. Dev worlds 1161 d2 s40 (43 completed cases), 1162 d3 s40 (44) and 1164 d5 s60 (69). Subjects: the six
stored COMP-1 programs and the three monolith rows COMP-1 used (B1L-H lineage 1, B1N-H lineages 2 and 3). Runtime 1:
none, M4b crash, M4d dup-same. Runtime 2: all six faults (none, M4a restart, M4b crash, M4c dup-delayed, M4d dup-same,
M4e downstream). Plus the source-fix rows, the distinct-refunds mutant, the read-back rows and the fresh-world check:
429 battery cells and 108 grading-world rows before the review, no model call. **Since the review every runtime-2 cell
was re-run under `cde405e3…`** (264 battery cells in `move2/runs-v2/`, 24 fresh-world cells, 54 grading-world cells; no
`harnessChanged` flag in any file; the composed rows record `gateMode: 'report'`), and every runtime-2 number below is
from those rows. The pre-review runtime-2 rows ran under `1c4a6398…` (the 30 main files) and `f24c2783…` (read-back,
fresh worlds, 83 of the 108 grading rows); §8.3 compares them with the re-run.

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
fault-free journal. The envelope's findings by fault (r2, the nine subjects): crash 4,349 `orphan` and 69 `surplus`
drops (every surplus agreed with what the program had been told: 0 `conflicting-result`, as the review expected for E8's
crash model); dup-same 20 `shared-identity` (a second caller key of one identity in one instance, a host no-op); none
elsewhere. The largest envelope share of a carry is 5.1 KB (the program's own carry: up to 6.5 KB; host limit 64 KiB). Arm errors: 1, 1
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

ATTACK's line is "COMP M4b/M4d within the monolith band"; ATTACK does not say which rows make the band, so this note takes
the three COMP-1 monolith comparator rows. The pre-review analysis took the band from the monoliths under both runtimes
at once, which let r2's own orphan cost widen it (review D4); it was committed before any monolith row existed, but after
the first composed rows (review D12), so it could not be tuned to the band. Since the review, `move2-analyze.mjs`
computes two bands with a `holds` each: **like for like** (composed rX against monoliths rX, read-back against monoliths
with read-back) and the **frozen band** (monoliths under r1 only), the stricter one. Like for like: r1 20/36 (does not
hold), r2 36/36 (holds), read-back 18/18 (holds; crash only). Frozen band: r2 33/36 (**does not hold**), read-back
18/18 (holds). The pre-review summary said "r1: 23 of 36"; that count used the band widened by r2's own monoliths (D4).
The re-run rows equal the pre-review rows case for case, so the table is unchanged; its "(inside)" counts are against the
frozen band of the third column, and the like-for-like band of r2 is the "Monoliths r2" column (0–1 on crash 1161) [obs]:

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
B1L-H l1 1 / 3 / 0, B1N-H l2 2 / 3 / 0, B1N-H l3 2 / 2 / 0; **80 / 19 / 0** (the same under the pre-review and the
revised file). Fault-free logical and business digests of read-back equal plain r2 in 27 of 27 cells. In the 27 read-back
crash cells: 0 duplicates, 0 key conflicts, 0 arm errors, no critical finding beyond cht-e8-3's fault-free 26. Under the
revised option only orphaned **failures** are parked: 62 re-emissions went out as status reads, all 62 reads showed
nothing committed, and all 62 were answered with the parked failure (0 re-issued); the orphaned successes go to the host,
whose idempotency answers them (host dedupes 4,376, as under plain r2). Before the review every orphan was parked and
3,750 re-emissions became reads (host dedupes 688); the per-case outcomes are the same either way.

**Fresh worlds (1181 d3 s40, 1183 d5 s40; prediction committed before the run, `move2/READBACK-FRESH-PREDICTION.md`)**
[obs, r1 rows `move2/runs-fresh/`, r2 and read-back rows `move2/runs-fresh-v2/` (revised file), read by
`move2-analyze.mjs --fresh` into `move2/fresh-analysis.json`]:

| Subject | World | Fault-free | Crash loss r1 | r2 | r2 + read-back |
|---|---|---|---|---|---|
| ch-e8-2 | 1181 | 39/44 | 21 (crit 36, comp 5/8) | 0 | 0 |
| ch-e8-2 | 1183 | 38/48 | 22 (crit 41, comp 4/13) | 0 | 0 |
| cht-e8-1 | 1181 | 42/44 | 0 | **1** | 0 |
| cht-e8-1 | 1183 | 45/48 | 0 | 0 | 0 |
| B1L-H l1 | 1181 | 44/44 | 1 | 0 | 0 |
| B1L-H l1 | 1183 | 48/48 | 0 | 0 | 0 |

P1 (fault-free equal) 6/6 for read-back vs r2 and 6/6 for r2 vs r1; P2 (read-back ≤ r2) 6/6 and read-back = 0 in 6/6;
P3 (no duplicate, no 409, no critical finding beyond the fault-free run's) 24/24 runtime-2 cells. The kill line was not
crossed. The plain envelope's orphan cost shows up again (cht-e8-1 on 1181), and read-back removes it again. The same
held under the pre-review file. Caveat: the prediction was written for the pre-review option; this second reading is on
worlds whose pre-review results were known, so it is a regression check of the revised option, not a second
out-of-sample test. Recommendation for compose-runtime/2.1: make `reconcile` the default. The review asked for D1, D2
and D6 to be fixed first; they are (§8). It is still a harness-version change on development evidence, so it is left to
the COMP-2 track and the owner.

### 3.6 M1 transparency on the grading worlds

The six composed builds, fault-free, under r1 and r2 on the nine COMP-1 grading worlds (1232–1234 × d2, d3, d5; 1,022
completed cases per build): logical digest, business-row digest and per-case pass vector equal in 54 of 54 cells, 0
envelope findings, 0 arm errors, under the revised file (`move2/grading-v2/`, r1 rows from `move2/grading/`; the re-run's
r2 rows also equal the pre-review r2 rows in 54 of 54). Pooled M1 per build, r1 = r2: ch-e8-1 974, ch-e8-2 955, ch-e8-3 886, cht-e8-1 1,003,
cht-e8-2 974, cht-e8-3 920 (of 1,022), the PREREG-COMP1 values [obs, `move2/grading/comparison.json`]. So runtime 2 does
not move M1, and ATTACK's projected "pooled M1 ≥ 0.955 → ≥ 0.98 excluding go-live" does not come from runtime 2: M1 is
fault-free, and its failures are seam logic and go-live, not effect identity. What runtime 2 removes is the D2/D3 share
of the fault battery (M4).

---

## 4. ATTACK's success and kill lines, read

All runtime-2 results are from the revised file (`cde405e3…`). "Non-circular" means the readout could have failed with
the mechanism wired in: oracle-graded case loss or the key-free business rows.

| ATTACK Move 2, COMP $0 step | Kind | Result | Reading |
|---|---|---|---|
| COMP M4b/M4d within the monolith band | non-circular (oracle case loss) | like for like: r2 36/36, r1 20/36, read-back 18/18 (crash); frozen band (monoliths under r1): r2 33/36, read-back 18/18 | **holds like for like; does not hold for default r2 against the frozen band** (3 cells, one case each, crash 1161); holds with read-back on both |
| fault-free digests unchanged | non-circular (business rows, journals) | 18/18 composed + 9/9 monolith dev cells, 54/54 grading cells, 6/6 fresh | **holds** |
| the distinct-refunds mutant still flagged | non-circular (the oracle fails it; 409 visible) | 12/12 cells, 409 + `identity-conflict`, never merged | **holds** |
| no false positives on the three C-H-T manifests | static check | gate: 0 of 3 flagged (C-H: 3 of 3 flagged); 0 fault-free `identity-conflict` | **holds** |
| 0 logical duplicates outside the universal D4 loss | **[code] mechanism check, circular** (registry = `identityOf` = counter; host dedupes) | 0 in all 18 composed M4d cells and all 264 r2 cells (r1 under M4d: 61) | holds by construction; not evidence that identities are right |
| X1 (sweep): ch-e8-2 crash within 3 cases of fault-free | non-circular | r1 17 / 15 / 31 → r2 1 / 0 / 2, critical 0 | **holds** |
| **ATTACK kill**: > 1 false refusal on passing worlds; an admitted write Δ\* cannot explain right more often than wrong | — | **not evaluated**: needs Move 1's Δ\* and the replay gate | — |
| Composition analogue of a kill line (this note's, not ATTACK's): the envelope changes fault-free behaviour, or the gate flags a C-H-T manifest | — | not crossed | — |

ATTACK's AutomationBench lines for Move 2 (≥ 6 of the 12 message-mention breaks refused from ≥ 3 tasks, ≤ 1 false refusal
over all passing worlds, duplicates per arm 13/60 → ≤ 2/60) and the AutomationBench half of the $0 step (replaying the
dev60 arms' calls through `replay-gate.mjs --lint` with Move 1's dispositions) belong to the A1-C v2.1 track and are not
evaluated in this note.

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
  187 runs, 0 arm errors, runtime 1 (the frozen harness), so this is not a runtime2 result.

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
  fuzz is a second, independent information path that also accepts Haiku's patch, on the generator's distribution. It
  does not overturn the gauntlet: under D28 (5) Haiku's patch stays **inconclusive** there, the bound is about the
  generator's distribution, not about the incident's natural inputs, and no heal claim follows (the heal kit stays frozen
  and heal replays stay blocked).
- Since the review (D13) the runner caps each stored, model-written script before loading it: 2 GiB of address space,
  1 MiB per written file and 900 s of CPU hold (tested). RLIMIT_NPROC does not: the sandbox maps to the real uid 0, which
  the kernel exempts, so process creation is refused at the Python level instead, which is defence in depth and not a
  boundary (a script can reach the raw syscalls through ctypes). The fuzz result above ran before the caps; none of the
  three candidates allocates, writes or forks, and the cfx-fuzz tests (5/5) pass with the caps on.

---

## 6. What is left, and why

| Item | Why it is not done here | Who |
|---|---|---|
| Make read-back (`reconcile`) the runtime2 default (compose-runtime/2.1) | It changes the harness version; the evidence is development-grade on five dev worlds (3 in-sample, 2 once-fresh) and nine programs. The review's preconditions (D1, D2, D6) are met (§8) | COMP-2 track, owner (D28 (3) approved runtime2, not this default) |
| Make the frozen-band line hold for default runtime2 | It holds only with read-back (3 of 36 cells one case over); the alternative is the default above | COMP-2, owner |
| Read-back when a failed attempt's arguments differ from the re-emission's | The E8 host's status read returns `{ key, status }` and a failed attempt leaves no committed arguments, so the envelope cannot tell (§1.2) | SPEC-E bump (record attempted arguments), owner |
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
nice -n 15 node experiments/compose/move2-battery.mjs --plan v2 --out research/blockers-20261021/move2/runs-v2   # the post-review re-run: every runtime-2 cell (§8)
nice -n 15 node experiments/compose/move2-battery.mjs --plan fresh-v2 --worlds 1181:3:40,1183:5:40 --out research/blockers-20261021/move2/runs-fresh-v2
nice -n 15 node experiments/compose/move2-grading.mjs --runtimes 2 --baseline research/blockers-20261021/move2/grading/grading.json --out research/blockers-20261021/move2/grading-v2
node experiments/compose/move2-analyze.mjs --runs research/blockers-20261021/move2/runs,research/blockers-20261021/move2/runs-v2   # tables + lines -> move2/analysis.json
node experiments/compose/move2-analyze.mjs --fresh 1181,1183 --runs research/blockers-20261021/move2/runs-fresh,research/blockers-20261021/move2/runs-fresh-v2   # -> move2/fresh-analysis.json
node experiments/compose/move2-recompare.mjs --old research/blockers-20261021/move2/runs --new research/blockers-20261021/move2/runs-v2 --out research/blockers-20261021/move2/recompare-v2.json
nice -n 15 node experiments/compose/test/runtime2-mutants.mjs --out research/blockers-20261021/move2/mutants-runtime2.json   # the teeth (42 mutants)
nice -n 15 node experiments/compose/collateral.mjs --worlds all           # Move 8 collateral vectors
nice -n 15 node experiments/heal2/cfx-fuzz.mjs --n 5000 --seed 20261028   # Move 8 H-cfx differential fuzz
corpus/AutomationBench/.venv/bin/python -I experiments/autobench/probe.py --out research/blockers-20261021/move8/cards   # from a neutral cwd
```

Tests, one file at a time (`nice -n 15 node --test --test-concurrency=1 <file>`):
`experiments/compose/test/runtime2.test.mjs` (26), `experiments/compose/test/runtime2.host.test.mjs` (5),
`experiments/lib/difffuzz.test.mjs` (4), `experiments/heal2/test/cfx-fuzz.test.mjs` (5),
`experiments/autobench/test/probe.test.mjs` (1).

---

## 8. The review of 2026-11-04, what changed, and the re-run

### 8.1 Findings and what was done

| Finding (review severity) | What was done | Evidence |
|---|---|---|
| **D1** (medium): the inbox dropped a surplus result by count, so after a crash an `error` for the failed first attempt could be delivered and the `ok` of the committed second attempt dropped | **Fixed.** A surplus is compared with what the program was told (whether an `ok` was delivered; the status/result/error digest of the last failure delivered). It is delivered as `conflicting-result` (not counted) when the program's view would otherwise be wrong: an `ok` when none was delivered, a 409, or a failure other than the one delivered; it is dropped when it agrees. **One deliberate difference from the review's wording:** a failure arriving after a delivered `ok` is dropped (`surplus-after-commit`), because the effect committed and the program knows it; delivering a stale failure would invite compensating a committed effect | `runtime2.test.mjs` "a surplus is compared …" includes the review's error-then-ok case; 7 mutants (`surplus-*`, `last-failure-not-recorded`, `partial-batch-dropped`) killed. Battery: 0 `conflicting-result` in all 288 runtime-2 battery and fresh cells, as the review said: E8's crash model delivers the redelivered events and the orphan in the same tick (`faults.mjs` 65–67), so no battery number moved because of D1 |
| **D2** (medium): read-back answered a re-emission with the parked result without comparing arguments and whatever the read said | **Fixed; one part answered differently.** Only orphaned failures are parked, and the read gates the answer (`not-found`: the parked failure; anything else, or no answer in 20 ticks: the write is re-issued). The review proposed comparing the re-emission's arguments with what the host committed, "the status read can return it": the E8 host's status read returns `{ key, status }` only (`mocks.mjs` 281), so it cannot. Instead an orphaned `ok` is never parked and the re-emission goes to the host, which compares arguments itself (409 on a difference, `mocks.mjs` 226–229). The review's reproduction (parked `ok`, re-emission with amountMinor 90) now leaves as the write, as under plain r2; a `not-found` read no longer yields `ok`. Remaining limit in §1.2 | read-back test (parked failure answered only after `not-found`; re-issue on committed / pending / failed read / expiry; orphaned `ok` goes to the host); 9 read-back mutants killed. Battery: 62 reads, 62 `not-found`, 0 re-issued; case outcomes equal to the pre-review option's in 27/27 crash cells |
| **D3** (medium, evidence): "0 logical duplicates" is circular | **Accepted.** Labelled a [code] mechanism check everywhere (§0, §4, the `analysis.json` key); the non-circular readouts are named: case loss against the monolith band and the key-free business rows | `move2-analyze.mjs` S1 note |
| **D4** (low–medium): the band's upper edge included r2's own monoliths; no computed `holds` | **Accepted.** Two bands, each with `holds`: like for like and frozen. Default r2 is 33/36 on the frozen band, so that line **does not hold** without read-back; the pre-review "r1: 23 of 36" used the widened band and is 20/36 like for like | `analysis.json` verdicts; §3.4 |
| **D5** (low–medium): ATTACK's Move 2 kill lines were never evaluated | **Accepted.** Reported as not evaluated (they need Move 1); the composition analogue is labelled as this note's own | §0 item 6, §4 |
| **D6** (low–medium): teeth narrower than claimed; mutants not committed | **Fixed.** 7 tests added (20 → 27, one of them on the resume) and several strengthened (`compensates` within and across ticks, a partially owed batch, a rate-limited emission followed by a corrected one, read-back expiry and the read's answer); `test/runtime2-mutants.mjs` commits 42 mutants, each written in place, the tests run, the file restored and its sha256 checked: 42/42 killed, including the 8 the reviewer found surviving | `move2/mutants-runtime2.json`; the pre-review file fails 5 of the 27 (`mutants-runtime2-prereview.json`) |
| **D7** (low): eviction could drop an entry still owed a result | **Fixed.** Owed entries are never evicted; parked read-backs go after answered entries; over the host's carry limit the tick throws | eviction test (the review's 64 KiB − 300 B case); 3 mutants killed. No battery cell evicted anything (largest envelope share 5.3 KB) |
| **D8** (low): results for one identity shared by caller keys came back in emitter order | **Fixed.** First-in first-out once a second caller key shares an identity | A, B, A test; 3 mutants killed. 24 `shared-identity` findings in the dup-same cells, outcomes unchanged |
| **D9** (low): identities not injective; undocumented null-slot deviation | **Fixed.** Slot values escaped (`%XX`, `#n` for numbers, `%=` for a value spelled like the slot default); the registry checks separators and defaults; the null-slot deviation from `identityOf` is documented in the registry and asserted in the mirror test instead of skipped | injectivity test; 4 mutants killed; E8 identities still equal `identityOf` (3,000 fuzzed effects, every committed write of a reference run) |
| **D10** (low): the gate only reported by default | **Fixed.** `bundle2.mjs` enforces by default; replays pass `gate: 'report'`, recorded as `gateMode` in every re-run row; the battery rows are labelled "gate reported" | bundle2 test; mutant `gate-default-report` killed |
| **D11** (low): labels ("every line below is runtime2", "settles Haiku's case", "the band ATTACK names") | **Accepted.** Corrected in the header, §0, §3.4, §5.2, §5.3 | — |
| **D12** (low): "written before this run" overstated | **Accepted.** `move2-analyze.mjs`'s header now says it was committed (10-28 18:56) after the first composed rows and before any monolith row | — |
| **D13** (info): stored model-written scripts ran without resource limits | **Fixed in part.** Address space 2 GiB, file size 1 MiB and CPU 900 s are capped; RLIMIT_NPROC does not bind (the sandbox maps to the real uid 0, which the kernel exempts), so process creation is refused at the Python level, which is defence in depth, not a boundary | cfx-fuzz test 5/5; the cap test fails against the pre-review runner |

### 8.2 The resume, and one more defect

The fix step was interrupted after committing the fixes (`0d7c9fc7`, runtime2 `d86b00c8…`) and 31 of the re-run's cells.
Verifying the committed fixes before resuming found one more defect: read-back also converted a re-emission that itself
carries `after` (an effect gated on another effect of the same output) into a status read. The host holds `after` within
one output only, so when the read showed the identity committed, pending or failed, the write was re-issued in a later
output **without** its gate and could commit after a failed predecessor, where the host would have skipped it
(`host.mjs` 756–757). Such a re-emission now goes out as written. A test and a mutant (`read-back-ignores-own-after`)
cover it, which changed the file to `cde405e3…`, so the 31 partial cells were set aside and every runtime-2 cell was
re-run under the final file. Nine of the set-aside read-back cells overlap the final ones: identical journals, pass
vectors and findings, so no battery program re-emitted an `after`-gated write whose first attempt failed. The `v2` plan
was widened at the same time from "the cells the fixes can move" to every runtime-2 cell, so no table mixes envelope
versions.

### 8.3 The re-run against the pre-review rows (`move2/recompare-v2.json`)

| Cells (runtime 2) | Count | Logical journal equal | Per-case pass vector equal | Business rows equal | Passed, before → after |
|---|---|---|---|---|---|
| fault-free (incl. fix and mutant rows) | 45 | 45 | 45 | 45 | 2,124 → 2,124 |
| M4a restart | 27 | 27 | 27 | 27 | 1,302 → 1,302 |
| M4b crash (incl. fix rows) | 39 | 39 | 39 | 39 | 1,834 → 1,834 |
| M4c dup-delayed | 27 | 27 | 27 | 27 | 1,302 → 1,302 |
| M4d dup-same (incl. fix rows) | 39 | 39 | 39 | 39 | 1,578 → 1,578 |
| M4e downstream (incl. mutant rows) | 33 | 33 | 33 | 33 | 1,523 → 1,523 |
| read-back, fault-free | 27 | 27 | 27 | 27 | 1,302 → 1,302 |
| read-back, crash | 27 | 0 | 27 | 27 | 1,302 → 1,302 |
| **All** | **264** | **237** | **264** | **264** | |

The 27 read-back crash journals differ because fewer re-emissions go out as reads (62 instead of 3,750; §3.5). Duplicates
0 → 0, key conflicts 170 → 170 (all in the distinct-refunds mutant rows), arm errors unchanged cell for cell (the mutant
rows' and b1nh-e8-3's / cht-e8-1's M4c errors of §3.2). Fresh worlds: 24 runtime-2 cells, the committed prediction holds
again (§3.5). Grading worlds: 54 of 54 equal to runtime 1 and to the pre-review runtime 2. So the review's fixes changed
behaviour only on paths E8's battery does not reach (D1, D7, D9's escapes, the `after` guard) or reaches without changing
an outcome (D2, D8); their evidence is the unit tests and the mutants, not the battery.
