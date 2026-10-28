# D20: the heal-kit policy drift (HEAL_POLICY_DRIFT), decided (2026-10-21)

*Decision record. Owner choice pending since 2026-10-15 (README "Heal-kit drift"; PREREG-NEED-V1 §13 D6), taken under the
owner's complete permissions of 2026-10-21. Reversible. Changed: `experiments/heal/kit.mjs` (two exemption lists and one proof
function), `experiments/heal/test/helpers.mjs` (comment and skip text), `experiments/heal/test/kit-gate.test.mjs` (the D6 tests
replaced by D20 tests); new `experiments/heal/d20-proof.mjs` and its output [`d20-proof.json`](d20-proof.json). The frozen kit
(`/opt/foundry-kit/7e8f0f83153c5efb`, commit 880c6b9), its pins and its policy of record are not touched.*

**Text for `research/decisions-20261021.md`** (not edited in the main tree from this worktree; to be appended on merge):

| # | Pending question | Decision | Why | Reversal cost |
|---|---|---|---|---|
| D20 | The heal-kit policy drift (README "Heal-kit drift", PREREG-NEED-V1 §13 D6): (a) re-freeze the kit's policy of record, or (b) a proved exemption for `defaultsByRole` | **Neither as posed; (b) extended with a second kind of proof.** `defaultsByRole` takes the existing "unread" proof (no file of the frozen kit names it). The class budgets `inputBudgetTokensByClass.{F,L,M}` take a new **envelope** proof: the kit reads them only from its policy of record and only as an upper bound (`Math.min` of node and class limits; over → truncate or `CONTEXT_OVERFLOW`), and per class the record's bound (8K/16K/32K) is at most the owner's (100K), so every call the kit can make is inside the owner's current envelope. The proof is re-checked on every load and lapses if the owner lowers a bound below the record, bounds a class the record leaves unbounded, drops a bound, or any kit source reads the key anywhere but the three audited sites. The policy of record is unchanged | Measured at $0 (`d20-proof.json`): under D20 all 2,631 recorded C0-dev and P1 calls keep their replay keys and the runs keep policy hash `fe63f99b`; option (a) breaks **all 2,631** replay keys (the owner file's `claude-cli` provider config enters every model digest) and changes the hash; a narrow re-freeze (a') keeps the keys but changes the policy hash in every run identity and committed `runs/H-*.json`, and would run new heal calls under budgets the recorded evidence never had. (b) alone would leave the three budget paths blocking. The 66 skipped heal tests run again: the suite is 98 tests with 0 skipped; 98 of 98 pass (one P1 replay test failed once under load about 20 and passed on rerun; §4) | Empty `ENVELOPE_BOUNDS_READ_BY_KIT` and drop `defaultsByRole` from `TOP_LEVEL_KEYS_UNREAD_BY_KIT` |

## 1. What blocked, exactly

`loadKit` compares the live owner file `policy/models.json` with the frozen kit's policy of record (`policyDrift`, Q6 of
2026-10-09). The P0 policy batch (`2026-10-15.1`) deleted `defaultsByRole` and raised the class budgets M, L and F from 8,000,
16,000 and 32,000 to 100,000 tokens. Measured on the live file (policy `2026-10-21.2`) before this change:

```
blocking: defaultsByRole, inputBudgetTokensByClass.F, inputBudgetTokensByClass.L, inputBudgetTokensByClass.M
```

Every heal replay refused with `HEAL_POLICY_DRIFT`, and 66 of 95 heal tests skipped on that reason.

## 2. The options, measured ($0)

`node experiments/heal/d20-proof.mjs` recomputes, for every recorded model call of the two journals the heal kit replays (C0-dev:
768 calls; P1: 1,863), the replay key under each candidate policy of record (kit `src/models/port.mjs` `replayKeyOf`,
`modelDigestOf`), and the policy hash each option gives the runs:

| option | policy of record | replay keys kept (C0-dev, P1) | run policy hash | consequence |
|---|---|---|---|---|
| (a) re-freeze to the owner file | the live file | **0/768, 0/1,863** | `7447a875…` (changed) | every recorded call misses (`REPLAY_MISS`): localisation, V3/V4 regression replay and every committed `runs/H-*.json` stop reproducing. The cause is not the budgets: the owner file's `claude-cli` provider entry carries `childEnv`, and the provider config is part of every model digest |
| (a') re-freeze only the blocking paths | the record + owner budgets − `defaultsByRole` | 768/768, 1,863/1,863 | `0e3c11c0…` (changed) | replays still hit (budgets are not in the model digest), but the policy hash in every run identity (`run.created`, trial evidence) and in the committed heal records changes, and new heal calls run under 100K budgets that no recorded run had: a candidate's live nodes would be compared with baselines made under a different envelope |
| (b) unread exemption for `defaultsByRole` only | unchanged | 768/768, 1,863/1,863 | `fe63f99b…` | still blocked on the three budget paths |
| **(b') D20** | unchanged | **768/768, 1,863/1,863** | **`fe63f99b…`** (unchanged) | unblocked; nothing about the recorded evidence changes |

No recorded call hit a class budget (`CONTEXT_OVERFLOW` rows: 0 in both journals), so the record's smaller budgets never shaped
the evidence either way; they only bound what new heal calls may send, and they bound it inside the owner's envelope.

## 3. The proof, as code (`experiments/heal/kit.mjs`)

- `TOP_LEVEL_KEYS_UNREAD_BY_KIT` gains `defaultsByRole`. Same rule as `judgmentModels` and `executorModels`: exempt only while no
  file of the frozen kit's `src/` contains the string.
- `ENVELOPE_BOUNDS_READ_BY_KIT.inputBudgetTokensByClass`, checked by `envelopeProof` on every load:
  1. every line of every kit source that names the key contains one of three audited snippets (the read at `src/runtime.mjs:598`,
     the validation at `src/models/policy.mjs:53-54`); any other mention voids the proof for the whole key;
  2. the cap site exists (`const limits = [nodeBudget, classBudget].filter(` and `Math.min(...limits)` in `src/context.mjs`);
  3. per class, both values are positive integers and record ≤ owner. A class the owner bounds and the record does not, a
     class the owner no longer bounds, a non-integer, or an owner bound below the record's is blocking.
  The kit's files are also pinned blob by blob (`verifyKit`), so the audited sites cannot change without `HEAL_KIT_MISMATCH`.
- Each exemption is reported in `kit.policyDrift.ignored` with its proof, e.g.
  `inputBudgetTokensByClass.M: record 8000 <= owner 100000; the kit reads only its record, and only as an upper bound (audited sites)`.

## 4. Tests

`experiments/heal/test/kit-gate.test.mjs` (14 tests, all pass):
- the P0 policy (`a245232`) now passes, with `defaultsByRole` proved unread and each raised budget proved inside the envelope;
- the proof is narrow: an owner budget lowered below the record (M 4,000; S 2,000), a class the owner adds (XS), a class the
  owner drops (F), a fractional bound, a kit source that reads the key elsewhere, a kit whose cap became `Math.max`, and a kit
  that names `defaultsByRole` all block;
- `loadKit` accepts the live owner file, runs under the unchanged record (policy hash `fe63f99b`, budgets 4K/8K/16K/32K/32K,
  `defaultsByRole` kept and unread).

The D6 skip predicate stays in `helpers.mjs`, renamed in its message: it now fires only if the D20 proof fails on exactly those
four paths (for example an owner budget lowered below the record), so that regression shows as a named skip plus a failing
kit-gate test.

Full heal suite after the change (2026-10-21 21:20-21:47 UTC, one file at a time, `nice -n 15 node --test
--test-concurrency=1`, private `HEAL_WORK_ROOT`, load average 12-21 on 4 vCPUs from other agents):

| file | tests | pass | fail | skipped |
|---|---|---|---|---|
| cli | 3 | 3 | 0 | 0 |
| detect | 8 | 8 | 0 | 0 |
| e2e-codefix | 3 | 3 | 0 | 0 |
| kit-gate | 14 | 14 | 0 | 0 |
| learn | 6 | 6 | 0 | 0 |
| live-fixes | 5 | 5 | 0 | 0 |
| localise | 7 | 7 | 0 | 0 |
| ops | 13 | 13 | 0 | 0 |
| p1 | 2 | 1 (2 on rerun) | 1 (0 on rerun) | 0 |
| promote | 3 | 3 | 0 | 0 |
| propose | 7 | 7 | 0 | 0 |
| replay | 8 | 8 | 0 | 0 |
| review-fixes | 6 | 6 | 0 | 0 |
| seeds-v7 | 4 | 4 | 0 | 0 |
| verify | 9 | 9 | 0 | 0 |
| **all** | **98** | **97, then 98** | **1, then 0** | **0** |

**The one failure, investigated.** `p1.test.mjs` "the eleven-op mechanical lint-debt proposal passes V0-V3" asserts that the
P1 incident pools 35 passing trials; the first run counted 30 (`buildIncident` drops a pooled trial whose strict replay does not
reproduce its record, `REPLAY_INFIDELITY`). It did not reproduce three times: the same 36-trial pool replayed with 0 infidelities
sequentially (530 s) and at the test's concurrency of 3 (307 s), and the test file itself passed 2/2 on a rerun (507 s), all
under the same load. So the evidence is intact (the recorded runs replay) and the failure is environmental. Candidate mechanism,
**not confirmed**: the P1 workflow's code nodes run under wall-clock timeouts of 10-30 s (`experiments/workflows/records-v3.mjs`
lines 1196-1246; the frozen runtime enforces them, `src/runtime.mjs:512-519`), so a CPU-starved replay at nice 15 can time a node
out and diverge from its record. The assertion now prints the excluded trials and their reason if it recurs
(`experiments/heal/test/p1.test.mjs`).

**Re-run 2026-10-22 02:21–02:47 UTC** (same method, private work root `/var/tmp/foundry-work/heal-d20-0222`, deleted after;
load average 9 to 18 on 4 vCPUs with FH-1, SOP-Bench and AutomationBench runs alongside): **98 tests, 98 pass, 0 fail, 0
skipped** across the 15 files, `p1` 2/2 (248 s). The 10-21 P1 failure did not recur.

**First use.** FH-1 ([RESULT-FH1.md](../heal-20261021/RESULT-FH1.md)), the failure-handling experiment the unblock was for: C3
supported (dev) on eight real Haiku-built E8 programs.
