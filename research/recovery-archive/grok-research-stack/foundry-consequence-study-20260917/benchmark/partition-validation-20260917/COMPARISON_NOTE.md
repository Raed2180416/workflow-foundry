# Completed 196-case validation

The repaired primary passed all 98 frozen cases. After the primary completed, prime explicitly authorized the exact `../outcome-model-001/FAULTY_CANDIDATE.json` for the second slot. That counterpart passed 80 cases and produced 18 runtime-successful but incorrect outcomes, all rejected by native v2 and the independently expected artifact comparison. The two native runner processes completed once each: primary session 17917 exited 0; counterpart session 96745 exited 1 with all results preserved.

| Measurement | Repaired primary | Faulty counterpart |
| --- | ---: | ---: |
| Executions | 98 | 98 |
| Runtime succeeded | 98 | 98 |
| Native v2 passed | 98 | 80 |
| Independently exact manifests | 98 | 80 |
| Runtime false successes | 0 | 18 |
| Incorrect sample rows | 0 | 28 |
| Exact permitted instrument-attempt multisets | 98 | 98 |
| All-status completion before publication diagnostic | 98 | 98 |
| Agreement with native publication diagnostic | 98 | 98 |
| Missing / forbidden / duplicate instrument calls | 0 / 0 / 0 | 0 / 0 / 0 |
| Native completion / evidence-order / premature-confirmation errors | 0 / 0 / 0 | 0 / 0 / 0 |
| Screening / reproduction attempts | 197 / 128 | 197 / 128 |
| Total steps | 1,799 | 1,799 |
| Synthetic work units | 1,477 | 1,477 |

The saved candidate JSON objects differ at exactly two paths: `/nodes/0/body/nodes/6/args/disposition` is `confirmed` in the repaired candidate and `inconclusive` in the faulty candidate, and `/version` is 2 versus 1. Every guard, evidence-validation schema, dependency, retry policy, and budget is identical. In particular, the faulty `confirmedRow` still requires complete positive reproduction but emits the wrong disposition.

Normalized instrument traces and native audited attempt/publication sequence intervals matched in all 98 paired cases. Both candidates complete the permitted attempts and publish afterward. This negative control isolates an output-label defect. It supplies no rejection witness for faulty reproduction guards or premature publication. The faulty candidate emits no confirmed rows, so the confirmation-specific publication condition alone would not reject this defect; the exact artifact expectation does.

Every faulty case containing an expected confirmed row failed, and all 28 such rows were changed to inconclusive with their sample identities preserved. Other rows matched. These are runtime false successes, not false defect confirmations.

| Partition family | Repaired passes | Faulty passes | False successes | Incorrect rows |
| --- | ---: | ---: | ---: | ---: |
| Reproduction tensor | 54/54 | 53/54 | 1 | 1 |
| Screening contrasts | 18/18 | 18/18 | 0 | 0 |
| Reproduction error | 1/1 | 1/1 | 0 | 0 |
| Whitespace evidence | 2/2 | 1/2 | 1 | 1 |
| Batch lengths | 5/5 | 2/5 | 3 | 3 |
| Input-order permutations | 4/4 | 0/4 | 4 | 4 |
| Six-sample stress | 6/6 | 5/6 | 1 | 6 |
| Identical-input evidence/claim contrasts | 8/8 | 0/8 | 8 | 13 |

Exact false-success case IDs:

```text
p7-053-tensor
p7-075-whitespace
p7-077-length2
p7-079-length4
p7-080-length5
p7-081-order0
p7-082-order1
p7-083-order2
p7-084-order3
p7-085-stress-confirmed
p7-091-swap0
p7-092-swap1
p7-093-swap2
p7-094-swap3
p7-095-swap4
p7-096-swap5
p7-097-claim-only
p7-098-swap-all-positive
```

`compare-saved.mjs` passed syntax validation and completed its saved-evidence comparison with exit code 0, executing no workflows. It reread all 196 actual artifact files, checked artifact hashes against native evidence bindings, checked exact JSON against the independent frozen expectations, compared permitted attempt multisets, recomputed all-status completion from independently authored requirements and saved native v2 audited intervals, compared paired traces, and checked the exact candidate differences. Its result is write-once `COMPARISON.json`.

The interval findings use native v2's audited events as evidence; this is not a separately implemented raw-event auditor. The stronger all-status publication rule remains a non-gating diagnostic, while native confirmed-before-publication remains a gate. These deterministic cases establish conformance and the stated negative-control separation only within their frozen schema-valid partition and finite contrasts. They do not establish universal correctness, general causal use, population performance, arbitrary scheduling behavior, or broad model qualification.

## Preserved evidence

`primary/RESULTS.json` and `counterpart/RESULTS.json` contain the independent replay checks. Each arm retains its native v1/v2 reports, all case stores and artifacts, candidate bytes, and binding receipt. `COMPARISON.json` contains every paired check, mismatch row, case ID, candidate digest, and input-file hash. `PRIMARY_REVIEW.md` records the earlier primary-only checkpoint; its unconsumed-counterpart statement describes that checkpoint and is superseded by the explicit later authorization and `EXECUTION-counterpart.json`.

| Evidence | SHA-256 / native digest |
| --- | --- |
| Repaired workflow | `1c88cfc1168d192c8e8e1d0f498f84bc64ceeedfa1c5f73492421c0facc239ac` |
| Faulty workflow | `ace61076c1694141ff04e4ab29e7cf8713af7087755e646e4476fb559a21ccd8` |
| Primary results | `38530fce107366e42f5ac580c4fd09fffc3a5e18b326123df9755b4808960e4d` |
| Counterpart results | `9d6ed0628577386801681d0bd76cd4bbe6a25c1340e3cae2ab43e5a6e5802402` |
| Saved comparison | `85cd2171fd53a6b175a768ede5e4751fc2c6a9f3b102ed43882be1bb1973cfb1` |

Both original freeze and runner addendum remain unchanged. The native maxSteps limit remains 160. The execution receipt closes both 98-case slots at 196 total, below the 200-case ceiling. No further candidate execution or model call was made, and no candidate information or results were sent to the builder. Only new evidence and comparison files were added inside the owned directory.
