# Offline construction dataflow review

Completed 2026-09-13 by worker-8. Scope is this dossier and
`tests/dataflow-audit.test.mjs`. Prime owns `src/dataflow.mjs`, validator
integration and any skill changes. No provider invocation or historical artifact
mutation is authorized for this review.

Final scoped result: **48 tests passed, zero failed or skipped**, with all 84
inspected source/skill/schema/test/package inputs unchanged during the run.
The checker rejects reference-01's impossible `last.done` wrapper, diagnoses its
potential recurrence gap, and accepts reference-02 under its actual open
capability catalog. This validates construction behavior, not model performance.

## Evidence boundary

The complete reference-02 `result-v2.json` was reread. Construction passed the
five neutral transcript cases and the six mutation controls. Its construction
receipt remains partial with `deploymentQualified:false` and
`taskQualified:false`. The actual original DefaultAgent completed bucket count
in three calls and passed 70/70 hidden cases. The generated bucket module passed
70/70 hidden cases, but the third invocation returned HTTP 429
`FreeUsageLimitError` before submission: `success:false`,
`classification:"provider-unavailable"` remain the correct whole-task record.
Both last-occurrence arms returned HTTP 429 before any environment operation;
the retained 16/60 values describe unchanged baseline code, not model performance.

Reference-02 closure is
`4bf7d86d40b2ce27e0bf3071e283784d9055711a159d77fd90695c666cfbecfb`, with
4,769 copied file/link entries and 830 host dependency fingerprints. Its in-run
result records `closureChanged:[]`, `systemChanged:[]`, `sourceStable:true`.
Reference-01 and its failed source-stability gate remain historical observations.
Neither study establishes a global parity metric.

## Static contract and its limits

Reviewed runtime `src/runtime.mjs:266-290` wraps map results as
`{items:[bodyOutputs,...],count}` and loop results as
`{iterations,last:bodyOutputs}`. Each `bodyOutputs` object is keyed by body node
ids. `previous` starts as the resolved initializer, then becomes the complete
previous body output. Therefore initial and recurrent shapes are independent
obligations for reached phases of a multi-iteration loop. Treating them as
alternatives in a union can conceal a reference that fails in one phase. A
single-iteration loop has no recurrence phase. A larger maximum also does not
prove recurrence happens: an `until` condition satisfied in iteration zero can
stop first. Phase-specific `when` guards can legitimately use an initializer-only
or recurrence-only field. Two executable neutral controls cover those cases.

The original reference-01 graph reads `previous.messages` and
`nodes.repair-loop.last.done`. Its first initializer contains `messages`, but its
recurrence and `last` values contain `query` and `act` wrappers. These absent
wrapper paths can be rejected statically even though both real capability
output schemas deliberately say only `{type:"object"}`. The corrected
reference-02 graph uses `previous.act.messages` and `last.act.done`.

Static shape checks cannot establish that an action receives the assistant
message appended by the immediately preceding query. Both pre-query and
post-query histories can have exactly the same JSON type. Reference-02's
approved study-only rule captures this causal handoff: action input uses the
query's returned message and returned history; the next query uses the action's
returned history. Prime promoted an original generic reference at
`skills/runtime-native/references/control-dataflow.md`, linked from native skill
lines 75-76. It covers causal message handoffs, wrappers, phase guards and neutral
controls, and explicitly separates conformance from task outcomes. The historical
study file `research/reference-swe/CONSTRUCTION-RULE-v2.md` remains preserved.

An output schema is not closed merely because it has a `properties` object.
Only an actual closed-object restriction can justify rejecting an undeclared
field. Open schemas, unknown descendants, unresolved schema references, and
unions containing a permitting or unknown branch must remain unknown. A
`patternProperties` schema can admit otherwise undeclared keys even with
`additionalProperties:false`; a bounded checker should defer those patterns
rather than infer absence or execute arbitrary expressions.

Runtime `src/data.mjs:52-82` explicitly permits defaults and `exists` tests for
missing references. Preserve these semantics. The nominal capability output
also has an alternative `{ok:false,error}` on `onError:"continue"`.
Optional declared properties are possible rather than guaranteed. Unknown or
structurally accepted paths do not qualify a workflow: one test intentionally
passes static validation under an open schema, then demonstrates the real
`MISSING_REFERENCE` failure during a pure local runtime execution.

## Independent tests and integration findings

Tests use `validateWorkflow` as the public integration surface, not private
implementation helpers. They read the exact frozen graphs and catalogs when
available, check their byte hashes, and never alter them. All other fixtures are
neutral local observations, loops, maps, human-output schemas and guards. They
contain no coding answers or provider import.

The suite covers closed versus unknown fields, union/pattern/ref uncertainty,
independent local schema-reference roots, `allOf`, array `length`, literal
defaults, initializer and recurrence defects, loop guards, map/loop nesting,
human/assert/wait wrappers, child input rebinding and an actual runtime
counterexample to static qualification. Historical graph tests
are explicitly skipped in environments where those optional research artifacts
are absent; the neutral cases remain active.

At initial inspection `src/dataflow.mjs` was absent. Prime's first implementation
landed before the first test run. The following development receipts are retained;
earlier failures have not been overwritten or counted as successful executions.

| UTC on 2026-09-13 | Checker SHA-256 prefix | Tests | Result | Finding |
|---|---|---:|---|---|
| 13:59:04 | `9c92aaa854fc` | 39 | 35 pass, 4 fail | `exists` falsely rejected; unguarded per-phase gaps only warned |
| 14:03:25 | `49141c1ab572` | 45 | 45 pass | Missing-path guards and strict unguarded-phase cases corrected; executable phase-guard controls pass |
| 14:04:51 | `49141c1ab572` | 48 | 45 pass, 3 fail | Three final reachability/data-context counterexamples below |
| 14:11:27 | `7f3c4894b32f` | 48 | 48 pass | Corrected condition/data distinction, parent guards and first-exit handling; source-stable final scoped run |

The three final counterexamples were corrected by prime without additional model
evaluation. An ordinary capability argument can contain `op:"exists"` or
`op:"all"` as data. Its references are resolved eagerly by the runtime; only
actual `when`, `checks`, `until` and `acceptance` expressions get missing-value or
short-circuit behavior. The initial checker incorrectly treated these data
objects as conditions and accepted a known absent required argument. Second, a
loop with maximum five iterations and `until: iteration == 0` stops before its
missing recurrent field is read. Third, a parent map with `when: 0 == 1` never
executes a child that references a nonexistent input. The checker rejected both
valid unreachable-read controls. The landed implementation passes explicit
condition context through the inspector, propagates parent guards, and separately
marks whether first-exit analysis proves recurrence required. These cases were
sent to prime; worker-8 made no source edits. Expression context, ancestor guards,
and proved first-iteration termination are distinct from unknown-schema handling.

The historical graph assertion was refined to accept its `previous.messages`
recurrence diagnostic as either an error or a warning. Its `until` reads unknown
`act.done` and could stop first, so recurrence is not statically guaranteed. The
same test still requires a hard error for the always-wrong `last.done` wrapper.
The separate neutral fixture with `until: iteration == 1` retains a hard-error
requirement for its unguarded recurrence gap. No historical graph was modified.

Raw command for each run:

```sh
node --test --test-reporter=tap tests/dataflow-audit.test.mjs
```

All listed targeted runs recorded identical before/after hashes for their inspected
source closure. The raw receipts are in these task-created temporary directories:

| Receipt directory under `/home/raed/.cache/cos-tmp/` | TAP SHA-256 |
|---|---|
| `foundry-dataflow-baseline-9gMYVp` | `ebe968ca3f7441a7e1aa4f4acc64dde4191ae23ad0fba903328886cdb429a406` |
| `foundry-dataflow-followup-88hFyq` | `32a6d8a378ce66fb5badbacd02d14997689b8da9492cb74355e65323b8b13447` |
| `foundry-dataflow-guards-PKjoGX` | `74aa8cba3dd9aaed24d57bbd12ef1da6ae74bd295465ca69a059ae39a863a6c1` |
| `foundry-dataflow-qualified-BXDEYG` | `b01f35271b904ffe24a17b631aee364f2eabdf0423be9c13912569cf0d91849b` |

Each directory contains `stdout.tap`, `stderr.txt`, and `result.json`; the latter
records timestamps and complete before/after hashes. The development findings
and checksums above remain in this dossier even if temporary files are later
cleaned. The 48-test source SHA-256 for the three-failure development receipt was
`1a06332e27d8e636ce1c24c010bcf79b002f5544d0fc670ef3da26c796d5fc97`.
Its final SHA-256, including the historical diagnostic-severity refinement, is
listed below.

The final targeted run started `2026-09-13T14:11:27.321Z` and finished
`2026-09-13T14:11:27.546Z`, exit 0, with `sourceChanged:[]` across 84 inspected
inputs. Its raw receipt is
`/home/raed/.cache/cos-tmp/foundry-dataflow-qualified-BXDEYG/result.json`, SHA-256
`e4655ff1a50774c29a0388a25d812cd5f464ebdea02d95bf2a53ab355836e2b1`.

| Final scoped source identity | SHA-256 |
|---|---|
| `tests/dataflow-audit.test.mjs` | `8b1fc5aaf9347fefe11f28323f5d1b79445823bdeaa2f665b242c64cbefb29d6` |
| `src/dataflow.mjs` | `7f3c4894b32f5dbe691ba3c871e088da8b083f42e7b653404972b647c9e9d41e` |
| `src/validate.mjs` | `70e9cc3e39e7a5d2dcc7479310301b57b916c6fd73e1a5158a374f9af0996284` |
| `src/runtime.mjs` | `af9fcabde20f706fac8ce2e09c0e646c0f100b301b64d1f6e1e4eb77e0b213db` |
| `src/foundry.mjs` | `95f102573760ef92cd352813f66b30cd9f83bda05afb97a4cbe1069c8527a878` |
| `src/store.mjs` | `c22ac8c61781725bdb19ffafd3f786b151e058efd64e969b689e59ea5b14cc78` |
| `skills/runtime-native/SKILL.md` | `a1b1598e663218bc36247d2641119858f9cb4204b3c4a44086640cbb54db4f16` |
| `skills/runtime-native/references/control-dataflow.md` | `b7deb0afdb9c9ce8ab7863d669adb7e6e50137aaff5a3f791daf34e77aadd08a` |

The broader `npm test` run exited 0 with **373 passed, 3 skipped, zero failed**
out of 376 tests. Four skill-file additions/edits landed during that run, so it is
an earlier successful repository command, not a frozen whole-package
qualification. Subsequent integration changes are covered only to the extent of
the final scoped run above. The broader raw receipt is
`/home/raed/.cache/cos-tmp/foundry-dataflow-final-Xc3sT1/repository.json`, SHA-256
`3dba9be87942b57ebace05f4d5ca07089699279a01e8bec773654dd0ef2d8a80`;
its stdout SHA-256 is
`128a77e208b0da277d02a02e38a8005b9cbcd2fdc89dcf0e6287102d921d51c4`.

Syntax check `node --check tests/dataflow-audit.test.mjs` and repository doctor
`npm run check` passed. Serena discovery succeeded but its manual action returned
`PLUGIN_DISABLED`; no Serena semantic verification is claimed. The repository
has no GitHub remote and defines no formatter, linter or typechecker script.
No security-sensitive runtime or dependency edits were made by this worker.

The scope remains conservative and incomplete by design: optional presence,
unknown/open schemas, complex branch reachability, factual freshness and causal
history equivalence require executable checks. String-valued selectors such as
`core.pluck`'s `field` remain runtime-only and are not covered by this static
reference inspector. This review supplies concrete counterexamples and their
regressions; it does not prove static-analysis soundness for every schema or graph.

## Completed post-seal reference reconciliation

The previously blocked post-seal audit was completed read-only during this
offline slice. All **5,175 reference-02 manifest-covered files** and **144
reference-01 manifest-covered files** match their hashes. The reference-02
closure entries, including recorded symlinks, were also checked. There were no
reconciliation failures; the generated graph matches its original model response.
The study's construction status and all task-success/provider-unavailable
classifications remain unchanged.

In addition to the existing read-only audit, each of the six completed responses
was checked directly against its saved prompt hash, returned text hash, streamed
output hash and independent session export. Every completed export reports
`opencode/ling-3.0-flash-fin-free` for the session and each assistant message,
zero cost, matching session identity and matching returned text. The three
unavailable invocations still have no completed export; no estimate or fallback
is substituted. Both task families have byte-identical initial prompts across
their two arms.

| Immutable identity | SHA-256 |
|---|---|
| Reference-01 manifest | `415eb4c70526177350376b3d4e524e2ac0eb83cbc8de09983828f37a07f2a96e` |
| Reference-02 manifest | `35fdc824cdd4bf06685006007cc78df390934a8562563f65b30ad43b97bb8ddb` |
| Reference-02 closure | `4bf7d86d40b2ce27e0bf3071e283784d9055711a159d77fd90695c666cfbecfb` |
| New read-only reconciliation receipt | `563711cc153b933d018152ef3d6ff28b7433f1f8576ebbf6545b6c0675db5998` |

The detailed new receipt is
`/home/raed/.cache/cos-tmp/foundry-dataflow-history-audit-FME5VP/reconciliation.json`.
It was written outside the immutable study directories. This worker has made
**zero provider invocations** in this offline slice. The reconciliation supplies
artifact and attribution evidence only, not new model-performance measurements.
