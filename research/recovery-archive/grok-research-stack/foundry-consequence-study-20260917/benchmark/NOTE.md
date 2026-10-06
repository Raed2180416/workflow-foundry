The construction benchmark is executable and calibrated. The evaluator-author supplied workflow and a version with renamed nodes and reversed declaration order both pass all 5 public development cases and all 8 sealed cases. All six deliberately broken, structurally valid workflows fail each complete suite. Seven additional integration tests and the CLI smoke test pass. No external model/provider call, dependency installation, existing Foundry source edit, or production operation was performed.

All files in this note are under `/home/raed/Projects/grok-research-stack/foundry-consequence-study-20260917/benchmark/`, unless an absolute native path is given. Prime owns `campaign-*` subdirectories; this worker did not inspect or edit them. The old ARC/AMP report and all earlier recovery receipts remain untouched.

**Public contract and supplied knowledge.** `PUBLIC.json` contains the natural-language batch task, input and manifest schemas, capability descriptors, budgets and precise evidence/disposition rules. The task itself does not name `map`, `branch` or `verification`. It asks for one cheap screening attempt per sample, one reproduction attempt only after a usable positive screen, exactly one report per input sample, and retention of errors/inconclusive outcomes. It supplies no candidate workflow or node identities.

The structured rules explicitly supply what counts as complete independent evidence, when to call reproduction, and how to label outcomes. The experiment therefore tests construction of executable orchestration from given semantics. It does not test discovery of those semantics from a vague request. The available runtime language, schema validator, generic JSON operations, `data.one` selection helper and synthetic instruments are also supplied machinery. `data.one` only selects exactly one non-null input; it never classifies observations or builds a report. Every control in `supplied.mjs` is labeled supplied and must be excluded from model construction context.

`development/SUITE.json` is public development evidence, including expected outputs. It may inform development and repair and cannot be called held out. `sealed/SUITE.json` and `sealed/TRUTH.json` are provider-hidden fixed evaluator cases when the generation process receives only PUBLIC and development material. The evaluator author knows the cases. This is not a population sample, a blind human evaluation, a generalization guarantee, or a calibrated physical instrument study. No concrete sealed cases are disclosed in this note or in the aggregate audit sent to prime.

**Execution and oracle.** `capabilities.mjs` exports `registryFactory`. It returns only the selected built-in JSON/artifact capabilities, two local instruments, and the generic `data.one` helper. All capabilities are low risk, require no approval and reserve zero monetary cost. Screening and reproduction consume respectively 1 and 10 synthetic work units in an independent call log; these are neither dollars nor elapsed-time estimates. `core.artifact` writes inside the current run artifact directory.

Each suite has separate input, instrument observations and exact expected manifest contents. Physical truth is in a separate TRUTH file and is not put in the runtime fixture. Instrument handlers read only the observation table. A direct test changes fixture truth while keeping observations fixed and confirms that returned observations do not change. A constructor receives ordinary input and actual declared tool outputs; it has no capability for reading the fixture or evaluator truth.

`oracle.mjs` calls the actual Foundry `evaluateWorkflow`, which constructs the actual `Runtime`. The native evaluator parses the real `manifest.json` and compares canonical JSON against the frozen expected value. Key order and whitespace are irrelevant; sample array order is part of the public contract. No expected graph shape, node count, node identifier or specific field path inside a candidate is used to judge task outcome.

The wrapper additionally checks module-private instrument logs against the native event chain, exact requested sample identity, exact returned observation/error, required calls, forbidden calls, duplicate calls, screening-before-reproduction order and synthetic cost. Logs count attempts before instrument return, including thrown errors. The instruments deliberately permit a forbidden synthetic attempt to be observed and counted; the independent evaluator rejects it. They do not quietly suppress an unnecessary attempt and then award the workflow success.

The native evidence chain used here is `/home/raed/Projects/workflow-foundry/src/evaluation.mjs:70-96,101-151` for artifact-content evaluation and native runtime invocation; `src/runtime.mjs:47-56,236-277,295-348` for run creation, per-item execution and handled errors. Those sources were inspected and hash-pinned, not modified. New wrapper logic has separate calibration evidence.

**Calibration results.** Counts below are passing cases; a mutant is rejected when it fails the complete suite. Some cases correctly cannot distinguish a particular mutant, including an empty batch.

| Candidate, all supplied | Development cases passed | Sealed cases passed | Complete-suite result |
| --- | ---: | ---: | --- |
| Positive upper bound | 5/5 | 8/8 | Pass |
| Renamed/reordered equivalent | 5/5 | 8/8 | Pass |
| Process only the first item | 1/5 | 3/8 | Rejected |
| Reproduce every item | 2/5 | 4/8 | Rejected |
| Confirm from screening alone | 1/5 | 2/8 | Rejected |
| Accept missing evidence | 4/5 | 6/8 | Rejected |
| Do nothing and claim success | 0/5 | 0/8 | Rejected |
| Process the first item twice | 1/5 | 1/8 | Rejected |

The reproduce-every-item mutant is decisive for oracle adequacy: it passes the native artifact/status evaluator on **5/5 development and 8/8 sealed cases**. The wrapper catches **4 forbidden reproduction calls in development and 7 in sealed evaluation** and rejects both suites. Bare `suiteEvaluator` therefore omits a material part of this benchmark. A separate integration test writes the exact expected public manifest without any instrument call: native content evaluation passes, and the wrapper rejects the missing attempts.

`calibration-001/CONTROL_FREEZE.json` freezes the supplied control source/graphs before their execution. `calibration-001/AUDIT.json` is an aggregate matrix without concrete scenarios; raw per-case execution reports and event stores are retained in that calibration directory and must stay out of model context. There were no failed calibration runs to repair and no post-freeze oracle changes.

**Freeze and identity.** `FREEZE.json` was created before model construction was authorized by this worker and before any model calls by this worker, which remain zero. It binds 23 exact files: public contract, instrument/evaluator implementations, public/sealed suites and truth, and native runtime dependencies. Its historical calibration status is deliberately still UNVALIDATED because that describes the time of freezing. `READY.json`, the later calibration audit and `VALIDATION.json` carry the completed validation status. All 23 hashes were rechecked after execution with no mismatch. The original freeze is not rewritten to make the chronology look better.

| File or identity | SHA-256 / canonical registry digest |
| --- | --- |
| PUBLIC.json | `1b5d70353084eafc8e3a981729e66717e82e899d2dab8b09098c586a4b9dbcc3` |
| capabilities.mjs | `2697b0ede7cef9a3b5b99df2841113f3ad68b743ff463f50993a77afcb6003fa` |
| oracle.mjs | `ebbdf190674414c29ec2fc7632e8f72b6e3c305c5abd20b322cc8a077304f732` |
| development/SUITE.json | `e3176d5a7727eae412f65b7fc53f5ec8857b937200401651cd012b962f4016b1` |
| sealed/SUITE.json | `3963e87b530118f38686633c0fc202431d48281b9dc917a41965a444764ce2e3` |
| FREEZE.json | `191da6649ceaa22087636059b241de2fd758768aabdfde0aa9d480cb27246f62` |
| calibration-001/AUDIT.json | `a77f5dfb1341a28a91e3f056c5fc76c4581844be857a5a41ac437221632887bd` |
| Canonical registry | `bb3f73d712e174d3084248c8d199a620b7eeb2a7b2655d64b6286ab3af536d0e` |

**Driver interface.** Use the wrapper evaluator in `WorkflowGenerator`, with only the public development suite. It retains the required evaluator ID, candidate hash and registry hash bindings. This exact integration was exercised through the real generator using one deterministic supplied-candidate callback, with zero external model calls. The callback is plumbing evidence and carries no synthesis credit.

```js
import { registryFactory } from './benchmark/capabilities.mjs';
import { makeEvaluator, evaluateCandidate, aggregate } from './benchmark/oracle.mjs';

const registry = registryFactory();
// new Foundry(workspaceUnderBenchmark, { registry });
// new WorkflowGenerator(foundry, actualProvider, { evaluator: makeEvaluator(devSuite), ...budgets });

// TrialRunner has no fixture argument. For public development trials only:
const trialRegistry = registryFactory({ trialCases: devSuite.cases });
const trialPolicy = { allowedCapabilities: trialRegistry.list().map(cap => cap.name) };
// new Foundry(workspaceUnderBenchmark, { registry: trialRegistry, trialPolicy });

// After freezing the candidate and closing generation, host-only sealed evaluation:
const report = await evaluateCandidate(candidate, sealedSuite, {
  directory: '/home/raed/Projects/grok-research-stack/foundry-consequence-study-20260917/benchmark/campaign-OWNED-BY-PRIME/new-evaluation'
});
// Send only this aggregate to the generating context, not report.cases or its stores.
const result = aggregate(report);
```

`registryFactory()` and the public-trial factory have identical descriptor hashes. Trial fallback binds an exact public development input to its fixture; unknown inputs do not silently select a different scenario. Host-created evaluation runs receive their suite fixture directly. A new registry is created per evaluation. `makeEvaluator` rejects heldout suites. Every evidence directory must be beneath benchmark; use a fresh directory and never rerun into an existing receipt path.

From this benchmark directory, the commands exercised were:

```sh
node freeze-public.mjs
node calibrate.mjs calibration-001
node --test --test-concurrency=1 benchmark.test.mjs
node run.mjs calibration-001/positive.json development cli-smoke-001
```

All exited 0. The first command is intentionally one-shot and must not be rerun after the existing freeze. Calibration performs 104 case executions across the eight supplied candidates. `integration-001.tap` records 7/7 tests, including real TrialRunner, real WorkflowGenerator, sealed-feedback refusal, hidden-truth nonexposure, call-order rejection and forged-manifest rejection. `VALIDATION.json` records 8 successful `node --check` results, the successful CLI run, freeze consistency and test/audit hashes. The CLI accepts either a workflow or `{workflow, rationale}` JSON and writes candidate-byte freeze evidence before evaluation. Its stdout is aggregate-only for both splits.

Remaining limits: the hand-built synthetic world supplies instrument outcomes and epistemic semantics; no empirical sensor independence or real laboratory operation is measured. Logs are captured in process and persisted with evaluation reports; crash/restart recovery is outside this benchmark. Procedural exclusion of sealed files is not an OS security boundary against a same-user process with arbitrary file access. A provider with such access must be separately isolated before claiming provider-hidden evaluation. Invalid schemas, every possible request paraphrase, adversarial resource attacks and all possible executable graphs have not been exhaustively tested. A suite pass measures only these cases and budgets.

CoS initially lost chat identity: agent messages/plan operations were refused, and apply_patch returned WORKSPACE_REQUIRED. Exclusive new-file writes through Core terminal succeeded; identity later recovered and subsequent patches/messages succeeded. Serena initial instructions, scoped project-quality inventory and the fast security gate each returned HTTP 404 `tunnel_client_not_seen`; no successful security scan or Serena corroboration is claimed. Existing package.json defines no formatter/linter/typechecker script. Node syntax and executable behavior were checked instead. No benchmark result is presented as proof that existing Foundry source is generally healthy.
