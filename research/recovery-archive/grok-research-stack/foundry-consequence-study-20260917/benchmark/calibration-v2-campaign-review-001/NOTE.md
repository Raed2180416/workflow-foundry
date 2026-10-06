Saved campaign review — worker-2 — 17 September 2026.

The saved first candidate's development 5/5 and sealed 8/8 results are consistent with its actual stored workflow, registry, native event chains, instrument observations and artifact bytes. The separately applied run also succeeds and passes an additive v2 audit of its saved evidence. Seven review groups passed. No workflow, model, provider, calibration suite or candidate generation was rerun.

All paths below are relative to `/home/raed/Projects/grok-research-stack/foundry-consequence-study-20260917/` unless written in full. Review output is exclusively new material in `benchmark/calibration-v2-campaign-review-001/`. The stable v2 evaluator, both original freezes, campaign files, supplied controls and independent worker1 review were not edited.

**Identity and evidence.** The canonical workflow digest is `5cc364ca2bd741330968016c582f6f6c2f4464aff5e3a75a99d2c9b908f62510`. It agrees across the parsed `packet/RESPONSE_1.json`, `CANDIDATE.json`, candidate freeze, generation assessment, immutable Store workflow, applied proposal, development and sealed reports, both qualification records, applied run and delivery. The raw response SHA-256 is `f36751ebbfa5d489b393250185c98b9387390b0fadf604a62e708add2f9cc978`; the separately serialized candidate file has its own byte hash. JSON formatting differences were not misrepresented as a changed workflow.

The original packet and the generator's recorded prompt are identical, 48,508 bytes, SHA-256 `b206c8661870cf5eae98b7f1539271f626f9ee39aea22c23dfd0ebeb81a35033`. The context digest, public task/rules, actual registry descriptors, workflow schema and both generic skill texts were independently reconstructed or compared with their source files. The packet contains no current workflow or diagnostic repair, and no previous-candidate feedback. There is one recorded generation attempt. The relay consumed the previously authored response; its receipt at 03:24 is not another model inference. Sources: `benchmark/campaign-cos-001/packet/{PROMPT_1.txt,RESPONSE_1.json,AUTHOR_1.json,CALL_1.json,RECEIVED_1.json}`, the campaign's generation `context.json` and round `01/{prompt.txt,response.json,assessment.json}`, and `relay-provider.mjs:21-45`.

The database was opened using `DatabaseSync(..., {readOnly:true})`, never through a writable `Store` constructor. Each saved case's event hashes, consecutive sequence, previous-hash chain, run head, engine, registry, workflow, input and policy hashes were checked. Checkpoint outputs agree with their corresponding completed/handled-error events. Each attached observation fixture equals its suite fixture plus the native Store's initial empty action bookkeeping. Actual manifest bytes agree with the exact expected JSON and stored artifact SHA-256. Instrument arguments, idempotency identities, raw logs, native completion/error outputs, descriptor schemas and publication ordering were checked using observed tool/node bindings, without requiring an expected graph or node names. See `run-001/AUDIT.json:38-194` and the reproducible `check.mjs` in this directory.

| Saved evidence | Cases/runs | Native events inspected | Permitted instrument attempts | Result |
| --- | ---: | ---: | ---: | --- |
| Development v2 report | 5 | 270 | 18 | All consistent and passed |
| Sealed v2 report | 8 | 507 | 37 | All consistent and passed |
| Separately applied run | 1 | 67 | 5 | Succeeded; recomputed v2 passed |

The candidate does consume observed output: screening and reproduction feed schema/identity checks, their results select per-sample rows, and publication follows the completed batch and manifest checks. This is observable source/dataflow evidence for the inspected candidate, not a population or causal-treatment estimate. All fourteen saved runs also satisfy the stronger all-processing-before-publication diagnostic. That diagnostic remains non-gating in the unchanged evaluator. Candidate source locators: `benchmark/campaign-cos-001/CANDIDATE.json:118-267,348-546,575-725`.

**Applied audit version discrepancy.** `cos-campaign.mjs:10` imports `auditInstruments` from v1, while line 36 imports the development/sealed evaluator from v2. Consequently the original `APPLIED_RUN.json.audit` is v1-only. The driver also omits an explicit final `run.status === 'succeeded'` assertion at `:67-77`, and its protocol comparison at `:35` compares only three hash fields, not all operational settings. These limitations were not repaired in place or hidden by this review.

For this saved campaign the actual applied run status is `succeeded`, its durable chain has 67 events, delivery reports local execution success, and its input/artifact/proposal lineage matches. This review passed the exact saved run, events, private-log copy and independently read artifact into the stable v2 `auditInstruments` implementation. The resulting receipt is `run-001/APPLIED_V2_AUDIT.json`. Thus the applied result is now v2-checked as an additive later audit; it was not originally v2-audited by the campaign driver. Future driver revisions should use the intended auditor with actual artifact/run bindings, require final runtime success and compare all fixed protocol settings. Stable files are unchanged.

**Chronology is post-authorship and pre-evaluation for v2.** Times below are UTC on 17 September 2026. Full milestones and time-source labels are in `run-001/AUDIT.json:195-299`.

| Event | Time | Evidence basis |
| --- | --- | --- |
| Original v1 freeze | 02:59:21.313 | FREEZE.json field |
| Public packet freeze | 03:17:12.511 | PACKET_FREEZE.json field |
| V2 repair commissioned | 03:17:15 | Prime message timestamp in this conversation |
| Candidate response written | 03:20:16.546 | RESPONSE_1.json filesystem mtime |
| Authorship receipt written | 03:20:51.361 | AUTHOR_1.json filesystem mtime |
| V2 source freeze | 03:23:09.470 | FREEZE_V2.json field |
| Calibrated evaluator readiness check | 03:24:43.443 | EVALUATOR_READY_CHECK.json field |
| Existing response consumed by relay | 03:24:43.575 | RECEIVED_1.json field |
| Development execution interval | 03:24:43.605–03:24:44.110 | Verified native event times |
| Candidate frozen for sealed evaluation | 03:24:44.139 | CANDIDATE_FREEZE.json field |
| Sealed execution interval | 03:24:44.162–03:24:44.968 | Verified native event times |
| Local promotion / proposal application | 03:24:44.995 / 03:24:44.997 | Promotion receipt / database record |
| Applied execution interval | 03:24:45.000–03:24:45.078 | Verified native event times |

V2 was commissioned before this candidate was authored and was frozen and calibrated before its evaluation. V2 was **not source-frozen before candidate authorship**. This evaluator author did not inspect the campaign candidate during the repair or freeze; this later saved-campaign review was the first candidate inspection. The repair used independent F1/F2 witnesses and supplied calibration controls. That is the evaluator author's attestation, not a separate audit of every chat or host access. The original packet predates and does not contain the later v2 addendum. Call this a candidate-unseen, post-authorship/pre-evaluation evaluator amendment, while retaining the original public contract and the independently found defects. Do not retroactively label it a fully pre-authorship v2 precommit. Local timestamps and file mtimes are not independent notarization.

**Visibility and attribution limits.** The exact relayed packet can be reconstructed from public inputs and generic skills. `AUTHOR_1.json:65-73` explicitly discloses ambient prior-conversation summaries, procedural filesystem restrictions and no clean-context certification. This review did not inspect the upstream worker's entire session or every tool access, so it does not prove absence of unrecorded access or supply OS isolation. The declared capabilities expose no fixture-reading tool. This review sent only aggregate findings/paths/hashes to prime, and sent no candidate or campaign result to another worker.

Model `6` / effort `pro` is reported by prime and hardcoded in relay identity (`relay-provider.mjs:17-19`). The author's own receipt says those settings were not visible to the author (`AUTHOR_1.json:40-50`). The upstream CoS spawn metadata was not inspected here; the recorded workflow/evaluation binding is verified, but this review does not independently authenticate model selection, token usage or cost. The reviewer authored v2 and is independent of the campaign constructor/executor, not an independent reviewer of its own evaluator implementation. Worker1's independent evaluator review remains preserved.

**Commands and preservation.** `node --check check.mjs` and `node check.mjs run-001` both exited zero. The first batched invocation was blocked by an indeterminate tool safety-status result and performed no command; the individually invoked commands then succeeded. The initial prime-message attempt returned `WORKER_IDENTITY_LOST`; its single retry after identity recovery was queued successfully. Subsequent aggregate findings were also queued. No package installation, security scan, new worker or external research was needed for this saved-evidence review. No formatter/linter or product-wide health claim is made.

`run-001/SOURCE_INTEGRITY.json` records 146 inspected files with equal before/after byte hashes, including all 87 v2 freeze dependencies. Review script and report hashes are separate from those original inputs. Stable `oracle-v2.mjs` remains `517b7e60d3e674f7fc1189dac8f468dd19d9f6800467a5998fde6a38fbd66e15`, and `FREEZE_V2.json` remains `5e4af4f2d1b3e90e65373cc40b4e8857d9248e769ee47b8dd79fa9d72e4595d2`.

```text
35f95c90b797016cb7e3d644a900b6e04e4826329c05a8f554112a65ede613fb  check.mjs
caad42d94659da4a5cdd25e6a276147730bb1982e7a95dcd46328b276a1f3edf  run-001/AUDIT.json
```

The retained result is one model-attributed construction trajectory that passed the enumerated synthetic task and a separately applied local run. It does not establish comparative model quality, cheap-model benefit, Jev benefit, autonomous learning, general workflow construction, physically independent instrumentation or an end-to-end product-completion claim.
