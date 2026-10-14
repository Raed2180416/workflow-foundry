export const meta = {
  name: 'phase1-review-fixes',
  description: 'Fix the 10 confirmed Phase 1 review findings (two disjoint agents), then verify',
  phases: [{ title: 'Fix', detail: 'runtime/model-layer agent || sandbox/schema agent' }, { title: 'Verify', detail: 'full suite + review tests + adversarial diff check' }],
}
const COMMON = `Repo /home/user/workflow-foundry (Node 24.21 on PATH; node:test; do NOT git commit; do NOT add npm deps). An adversarial review wrote tests/review-phase1.test.mjs with 10 failing tests (one per confirmed finding). Your job: make YOUR findings' tests pass by fixing PRODUCT code, never by weakening a test (only fix a review test if it is itself wrong, and say exactly why). Spec: research/core-20261006/DESIGN.md. Another agent is fixing other findings in parallel in OTHER files: edit only the files listed for you. Be surgical; keep the surrounding dense style. Run: node --test tests/review-phase1.test.mjs (your tests must pass) and the test files covering what you touch. Report every fix, test counts, rejected findings with reasons.`

const RUNTIME = `${COMMON}
You own: src/runtime.mjs, src/models/port.mjs, src/models/providers/claude-cli.mjs, src/models/providers/llama-server.mjs, src/journal.mjs, src/context.mjs, src/verdict.mjs, experiments/lib/services.mjs.
Findings:
2. MED port.mjs:194 + runtime.mjs:585-597 — cancelled model calls are journaled with their cost but never charged to run.cost/node cost. Carry journalId+cost on the CANCELLED error and charge before rethrow (dedupe by journalId as elsewhere).
3. MED runtime.mjs:676 oracle() — capability verifiers never charge cap.cost or check the budget; do it like task().
4. MED claude-cli.mjs:101 + port.mjs:168 — timed-out/killed hosted calls are journaled as exactly $0. Record costUnknown:true plus an upper bound (min of the per-call --max-budget-usd cap and an input-token list-price estimate); surface costUnknown/upper bound in journal costForRun and on node state/run (e.g. run.costUnknownUpperUsd) so experiments can report bounds. run.cost stays = known cost.
5. MED runtime.mjs:587/604 — a call cut short by the run deadline must be DEADLINE (inconclusive), not MODEL_TIMEOUT/CODE_TIMEOUT/TOOL_TIMEOUT.
6. MED port.mjs:37/130 — replay key must include a digest of the policy model entry + its provider config, and providers must resolve their own decoding defaults into the hashed decoding (e.g. llama max_tokens default 1024).
7. MED runtime.mjs:452/465, childLabels:250 — map failure:collect $error text from failed items must contribute the failed items' input/arg labels to the map output label.
9. LOW runtime.mjs:606 + context.mjs:105 — the E1 retry note embeds model-produced property names (steerable by untrusted input) outside the untrusted fence; render it inside a labelled block carrying the node's input label, or reduce it to schema paths only.
Also: experiments/lib/services.mjs uses runId 'gateway' for every session with seq restarting at 0; make the default runId unique per session (randomUUID).`

const SANDBOX = `${COMMON}
You own: src/schema-subset.mjs, src/sandbox.mjs (and tests/sandbox.test.mjs only to ADD tests).
Findings:
1. HIGH schema-subset.mjs:73 (quarantinedSchemaViolations) — quarantined schemas have unbounded output capacity (arrays of 1-char enums with maxItems 4096; arrays of floats), so untrusted text can be carried through and relabelled trusted. Fix: compute and cap total output capacity (about 64 bits: log2(enum size) per enum, log2(range+1) per bounded integer, booleans 1 bit, × maxItems for arrays; numbers must be integers with minimum and maximum, or rejected); require maxItems on arrays; reject strings that are not enums.
8. MED sandbox.mjs:87-88/102 — no effective memory/process limits: JS Buffers bypass --max-old-space-size, Python unlimited, fork possible. Apply prlimit (or setrlimit via the launcher) inside the namespace: address space ~1 GiB for python (JS: limit via --max-old-space-size plus an RLIMIT_AS compatible with V8, or RLIMIT_DATA), NPROC small, FSIZE small; keep all existing escape hardening intact.
10. LOW sandbox.mjs:11 MASKED_PATHS is a denylist: /mnt (uploads), /opt/corpus, /opt/claude-code are readable. Mask /mnt, every /opt subdirectory except the node runtime actually used (resolve from process.execPath, e.g. /opt/node24) , /home entirely, /srv, /media; if an allowlist root (pivot_root onto a minimal tree) is feasible within the existing design, prefer it.`

phase('Fix')
const [rt, sb] = await parallel([
  () => agent(RUNTIME, { label: 'fix:runtime+model-layer', phase: 'Fix' }),
  () => agent(SANDBOX, { label: 'fix:sandbox+schema', phase: 'Fix' }),
])
phase('Verify')
const verify = await agent(`Repo /home/user/workflow-foundry (Node 24). Two agents just fixed the Phase 1 review findings. Their reports:
--- runtime ---
${rt}
--- sandbox ---
${sb}
Do NOT edit files except to fix a clear regression the fixers introduced (say so). Run: node --test tests/review-phase1.test.mjs (expect 10/10 pass) and the full npm test (report exact tests/pass/fail/skip; the previous baseline was 735 tests, 718 pass, 0 fail, 17 skip plus the 10 review tests). Then adversarially re-read the diff (git diff) for: weakened tests, fixes that only special-case the test, broken replay determinism (do identical calls still produce identical replay keys across runs?), cost double-counting introduced by the cancel/charge changes, and sandbox hardening regressions. Report concrete problems with file:line, or 'no problems found'.`, { label: 'verify-fixes', phase: 'Verify' })
return { rt, sb, verify }
