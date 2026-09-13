import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const directory = path.resolve(process.argv[2]);
const load = p => JSON.parse(readFileSync(p, 'utf8'));
const sha = b => createHash('sha256').update(b).digest('hex');
const result = load(path.join(directory, 'result.json'));
const frozen = load(path.join(directory, 'freeze.json'));
const checksums = load(path.join(directory, 'SHA256SUMS.json'));
const badHashes = Object.entries(checksums).filter(([p, hash]) => sha(readFileSync(path.join(directory, p))) !== hash).map(([p]) => p);
const relative = path.relative(root, directory);
const receipts = [];
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith('isolated-') && e.name !== 'source') walk(p);
    else if (e.isFile() && e.name === 'response.json') {
      const response = load(p); const evidence = response.evidence;
      const exportPath = path.join(dir, 'session-export.json');
      let exported = null;
      if (existsSync(exportPath)) { const process = load(exportPath); exported = JSON.parse(process.stdout); }
      receipts.push({ path: path.relative(directory, p), evidence,
        exportVerified: exported?.info?.model?.providerID === 'opencode' && exported?.info?.model?.id === 'ling-3.0-flash-fin-free' && exported?.info?.cost === 0 && evidence?.reportedCost === 0,
        exportSessionId: exported?.info?.id ?? null });
    }
  }
}
walk(directory);
const architecture = receipts.filter(x => x.path.includes('/generation/'));
const rows = [];
const pairPrompts = {};
for (const outcome of result.arms) {
  const prefix = `${outcome.task}-${outcome.arm}`;
  const dir = path.join(directory, prefix);
  const calls = receipts.filter(x => x.path.startsWith(prefix + '/'));
  const hidden = load(path.join(dir, 'hidden.json'));
  const first = path.join(dir, 'call-1/prompt.txt');
  if (existsSync(first)) (pairPrompts[outcome.task] ??= {})[outcome.arm] = sha(readFileSync(first));
  const artifactsComplete = calls.length === outcome.calls && calls.every(x => x.exportVerified) && hidden.transportError === null;
  const generationMs = calls.reduce((sum, x) => sum + (x.evidence.elapsedMs ?? 0), 0);
  rows.push({ ...outcome, artifactsComplete, comparisonEligible: artifactsComplete && result.sourceDrift.length === 0, modelGenerationMs: generationMs,
    approximateWallMs: statSync(path.join(dir, 'outcome.json')).mtimeMs - statSync(path.join(dir, 'input.json')).mtimeMs,
    observedReportedCost: calls.reduce((sum, x) => sum + x.evidence.reportedCost, 0) });
}
const promptPairs = Object.fromEntries(Object.entries(pairPrompts).map(([task, arms]) => [task, { ...arms, identical: !!arms.reference && arms.reference === arms.foundry }]));
const architecturePromptPath = architecture[0] ? path.join(directory, path.dirname(architecture[0].path), 'prompt.txt') : null;
const architecturePrompt = architecturePromptPath ? readFileSync(architecturePromptPath, 'utf8') : '';
const taskLeakChecks = frozen.tasks.map(t => ({ task: t.id, functionNameAbsent: !architecturePrompt.includes(t.fn), solutionCasesAbsent: !architecturePrompt.includes(t.source) && !architecturePrompt.includes(JSON.stringify(t.hidden)) }));
const evidence = { resultHash: sha(readFileSync(path.join(directory, 'result.json'))), manifestHash: sha(readFileSync(path.join(directory, 'SHA256SUMS.json'))),
  freezeHash: sha(readFileSync(path.join(directory, 'freeze.json'))), badHashes, receipts, rows, promptPairs, taskLeakChecks,
  sourceDrift: result.sourceDrift, completedModelCalls: receipts.length, architectureCalls: architecture.length,
  generationCostSum: receipts.reduce((sum, r) => sum + (r.evidence.reportedCost ?? NaN), 0) };
writeFileSync(path.join(here, 'comparison-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o400 });

const table = rows.map(r => `| ${r.task} | ${r.arm} | ${r.runtimeStatus} | ${r.calls} | ${r.operations} | ${r.submitted} | ${r.passedCases}/${r.totalCases} | ${r.success} | ${r.artifactsComplete} |`).join('\n');
const report = `# Constrained original DefaultAgent comparison

The bounded run produced a successful original-agent last-occurrence repair and
two observed Foundry history-binding failures. The bucket reference arm was
interrupted by a provider HTTP 503. The campaign is blocked from a clean aggregate
comparison because the final source-drift check also detected concurrent edits.
Preserve the individual raw observations without pooling them into a win rate.

The run used the actual cloned mini-swe-agent DefaultAgent and an actual
Ling-generated Foundry workflow. This is diagnostic evidence on two tiny Python
repair tasks under custom narrow tools, not SWE-bench, full CLI, TUI, separate
SWE-agent-repository or commercial-product parity.

## Results

| Task | Arm | Runtime status | Executor calls | Operations | Submitted | Hidden cases | Task success | Complete model/oracle evidence |
|---|---|---|---:|---:|---|---:|---|---|
${table || '| No completed arm | — | — | — | — | — | — | — | — |'}

Run-level exception: ${JSON.stringify(result.blocker ?? null)}. Comparison gate:
${JSON.stringify(result.claimBlocked ?? 'No source-drift blocker recorded')}.
Run source drift: ${JSON.stringify(result.sourceDrift)}.
Artifact hash mismatches at report creation: ${JSON.stringify(badHashes)}.
Missing arms or incomplete model/oracle evidence cannot be scored as model failures.
Success requires a submission, a successful original/native runtime exit and all
independent hidden cases. Merely accepting a workflow or exiting Python with zero
is insufficient. Per-arm generation latency and observed cost are recorded in
\`research/reference-swe/comparison-evidence.json\`.

The bucket reference arm made one completed response containing four JSON
operations; the shared parser returned a visible format error. Its second
provider invocation returned HTTP 503 with "Endpoint is unavailable" after
75,329 ms, with no completed response or session export. This arm is an
infrastructure-interrupted observation, not a model task failure. Its raw process
is \`${relative}/bucket-reference/call-2/generation.json\`.

Both Foundry arms record an actual ERR_ASSERTION at
\`root/repair-loop:0/act\`: the supplied history omits the executor's just-returned
assistant message. The runtime conservatively records \`effect.uncertain\`
because the capability declares non-idempotent effects. Audit counters show
zero dispatched environment operations in both arms; the initial buggy modules
remain unchanged. The original last-occurrence arm performed write, test and
finish in three calls and passed all 60 hidden cases, including unchanged inputs.

The drift detector found changes to src/evaluation.mjs and four skill files,
including runtime-native. Frozen source snapshots and the exact generated prompt
remain available; the aggregate source-stability gate remains failed. Do not
relabel this as a fully stable frozen-source campaign or claim parity.

## Actual construction and failure interpretation

Architecture consumed ${architecture.length} observed completed Ling calls, with
${result.architecture?.attempts?.length ?? 0} recorded construction attempts, under
the preregistered maximum of three. The accepted candidate is
\`${relative}/candidate-workflow.json\`; its Foundry canonical digest is
\`${result.workflowHash ?? 'unavailable'}\`. No candidate bytes were hand-patched.

The accepted candidate's action arguments use \`previous.messages\` instead of
\`nodes.query.messages\` (candidate lines 67–73). That omits the immediately
preceding assistant response. Subsequent iterations also expect
\`previous.messages\`, although the native runtime carries the body-output object
containing \`query\` and \`act\`. Root acceptance reads
\`nodes.repair-loop.last.done\` rather than the action's nested result. The first
history mismatch is checked at the shared operation boundary; the other two
defects are source inspection findings, not claims that those paths were reached.

The structure-only evaluator accepted the two-node loop shape. The generator's
raw \`deploymentQualified:true\` is retained with its explicit evaluator envelope:
generic loop structure only, no task qualification. This field does not establish
working dataflow or correct repairs. Frozen output and raw failures are preserved;
repairing the architecture would require a separately labeled future condition.

## Source and documented interface conformance

Upstream: https://github.com/SWE-agent/mini-swe-agent, commit
\`04d809ceab9df28f9adaed044884180159172930\`, package version 2.4.6, MIT license.
Acquisition is recorded in \`research/manifests/software.json:229–245\`; the
original license remains in the clone and the frozen source snapshot.

Original implementation:
\`corpus/SWE-agent--mini-swe-agent/src/minisweagent/agents/default.py:88–157\`
owns run/step/query/execute_actions, call accounting, history and exit handling.
Its serialize/save methods are at lines 159–190. Custom Model/Environment protocols
are in \`src/minisweagent/__init__.py:43–70\`. The adapter imports and instantiates
that original class; it does not reproduce its agent loop. Official documentation:
https://mini-swe-agent.com/latest/advanced/control_flow/ and
https://mini-swe-agent.com/latest/advanced/environments/ .

The imported package creates a global configuration directory, attempts a dotenv
read, and configures logging (\`__init__.py:26–36\`, \`utils/log.py:7–32\`). The
reference process runs with an empty isolated \`MSWEA_GLOBAL_CONFIG_DIR\`, silent
startup, no credential environment and no host home or network. Dependencies are
exact-pinned wheels in the owned environment; no upstream install hooks ran.

Original settings changed deliberately: custom system/instance templates, custom
Model/Environment adapters, five steps, 300 seconds, and cost_limit=0 (disables
the original monetary ceiling; the shared provider instead requires explicit
zero prices and exported zero cost). Default bash parsing, local environment,
provider classes, default YAML and CLI integration are not exercised. Each model
response carries one operation; malformed JSON creates the same visible error
observation in either arm. This is a constrained reference integration.

The native arm uses actual \`WorkflowGenerator\`, selected installed skills,
schema and custom capabilities. Native loop nodes schedule each query and action,
carry the message list, and decide when to stop. Each capability performs exactly
one model query or one operation. Host bookkeeping verifies provenance and
budgets; it contains no repair policy or hidden agent loop.

## Fairness, isolation and evidence

Both arms use only \`opencode/ling-3.0-flash-fin-free\` through the existing
\`src/opencode-free.mjs\` noninteractive product bridge. Each completed call has
raw version/catalog/generation/export records. Completed export checks:
${receipts.filter(x => x.exportVerified).length}/${receipts.length}. Total observed
reported cost across completed receipts: ${evidence.generationCostSum}.
The bridge's metadata describes a product smoke transport; these executions are
the separately labeled constrained comparison, never TUI evidence.

Initial executor-prompt hash equality by task: ${JSON.stringify(promptPairs)}.
Architecture task-leak checks: ${JSON.stringify(taskLeakChecks)}. The frozen
architect prompt uses only the generic workflow/API contract, schema and skills;
actual task definitions, code and test cases enter executor inputs after
construction. Hidden expected outputs remain on the evaluator side.

The shared operations are read, whole-module write, fixed public test and finish.
There is no arbitrary shell, path selection or test-edit tool. Candidate Python
runs only inside fresh no-network bubblewrap with read-only candidate/oracle
mounts, empty home, 2 CPU seconds, 4 wall seconds, 256 MiB address space, 64
processes, 64 KiB captured output and 1 MiB file-size limits. Process limits are
applied after namespace creation so host user process counts do not prevent the
sandbox from starting. Host comparisons inspect function return values and input
mutation; Python exit status and candidate text cannot self-certify success.

Freeze: \`${relative}/freeze.json\`, SHA-256 \`${evidence.freezeHash}\`.
Raw sources: \`${relative}/source/\`. Dependency file hashes are frozen beside it.
Full run artifacts: \`${relative}/SHA256SUMS.json\`, SHA-256
\`${evidence.manifestHash}\`. Every included artifact was rehashed for this report.
Files are mode 0400 after closure. Hashes detect changes; this does not establish
protection against a malicious host administrator. Isolated provider state is
excluded from the public manifest; raw provider exports and outputs are included.

## Validation and remaining limits

The 13 targeted conformance tests passed before model calls; final preflight is
\`research/reference-swe/preflight-final.tap\`. They exercise the actual original
class with a scripted no-model provider, original five-call stopping, malformed
responses, history rejection, correct controls, initial/wrong fixes, test-file
tampering, forged stdout, early exit, input mutation, namespace isolation and CPU
termination. Scripted controls are plumbing evidence, never model outcomes.

Repository doctor passed. Broader test output is
\`research/reference-swe/repository-tests.txt\` (271 passed, one skipped, zero
failed at that source state). There is no configured repository formatter,
linter or typechecker script. Serena's manual tool was disabled. CoS quality-map
found no GitHub workflows or configured local Semgrep rules; the repository has
no remote. No nested worker was spawned; independent review of the comparison
remains prime's integration responsibility.

The full deterministic security profile ran Betterleaks, OSV and Trivy. OSV and
Trivy initially flagged python-dotenv 1.1.1; the pin was upgraded to 1.2.2 before
freeze. Rescan found no dependency vulnerabilities. Three later Betterleaks
matches are public advisory example strings embedded in the retained initial
scanner report, not application credentials. Both raw reports are retained as
\`research/reference-swe/security-initial.json\` and \`security-after-pin.json\`.
No local Semgrep rules were available, so no Semgrep result is claimed.

Development failures are retained separately in \`preflight-v2.tap\`; v3 and final
preflight pass. The initial namespace-launch defect and the test's interpretation
of bubblewrap exit code 137 were corrected before source/case freeze and any
model call. No concrete task/model outcome was used to patch the frozen campaign.

This small experiment cannot establish general model reasoning improvement,
production safety, harness equivalence, reliability rates or whole-product
parity. Tool confinement, history checks and the external oracle are explicit
host mechanisms. Stochastic provider behavior and custom prompt/adapter choices
remain material conditions. Preserve this condition separately from skills-only,
host-contract incident fixtures, TUI studies and old frozen comparator runs.
`;
const reportPath = path.join(root, 'research/dossiers/reference-swe-comparison.md');
writeFileSync(reportPath, report, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ reportPath, rows, completedCalls: receipts.length, exportsVerified: receipts.filter(x => x.exportVerified).length, badHashes, sourceDrift: result.sourceDrift, blocker: result.blocker ?? null }, null, 2));
