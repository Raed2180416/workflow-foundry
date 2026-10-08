// The probe's failure-class templates rewritten to the THESIS taxonomy and the time-of-decision state
// (JUDGE-PROGRAM.md §1.2 F1 "Families" -> templates; at most 20% of F1 training rows; never test evidence).
//
// Source: experiments/kev-probe/datasets.mjs `T` (35 templates in 5 classes: flake 7, env 8, model_output 7, budget 6,
// defect 7). The two revision-1 classes model_output and budget are decided by code before F1 is asked and have no
// template here (13 dropped); flake, env and defect are kept and rewritten (22) with the runtime's real error codes in
// place of the probe's invented ones (NODE_FAILED, CODE_FAILED); variance, impossible and finding get new templates
// (17), because the probe had none. The probe's `previous` string ("passed on rerun of the same build", "fails
// identically on replay", "control run on version 3 passes") was a replay or control-build outcome and alone predicted
// the class at 1.000; it is gone. What replaces it is prior_runs: counts from earlier runs, drawn independently of the
// class (exec/plan.mjs regime weights).
//
// A template's label is the class of the brief it was written to (labelSource 'authored-brief'); a template row is a
// training-surface row only.
export const TEMPLATE_VERSION = 1;
const P = (r, tag, list) => r.pick(tag, list);

// kinds: node kinds the failure can occur on; code/msg produce the runtime-shaped error
export const TEMPLATES = Object.freeze([
  // ---- flake (7, rewritten) -------------------------------------------------------------------------------------------
  { id: 'flake-rate-limit', label: 'flake', kinds: ['agent'], code: () => 'MODEL_RATE_LIMIT', msg: (r, id) => `${id}: claude CLI exited 1: API Error: ${P(r, 'c', [429, 529])} {"type":"error","error":{"type":"${P(r, 'e', ['overloaded_error', 'rate_limit_error'])}"}}` },
  { id: 'flake-model-timeout', label: 'flake', kinds: ['agent'], code: () => 'MODEL_TIMEOUT', msg: (r, id) => `${id}: request aborted after ${r.int('s', 120, 300)}000 ms (slot busy)` },
  { id: 'flake-socket-reset', label: 'flake', kinds: ['task'], code: () => 'ECONNRESET', msg: (r) => `fetch failed: read ECONNRESET (socket hang up) while posting to ${P(r, 'h', ['the model gateway', 'api.quotes.internal', '127.0.0.1:8402', 'vendor-gw.internal'])}` },
  { id: 'flake-urllib-reset', label: 'flake', kinds: ['code'], code: () => 'CODE_ERROR', msg: (r) => `Code failed (exit 1): Traceback (most recent call last):\n  File "fetch_quotes.py", line ${r.int('l', 10, 90)}, in <module>\nurllib.error.URLError: <urlopen error [Errno 104] Connection reset by peer>` },
  { id: 'flake-race-test', label: 'flake', kinds: ['verify'], code: () => 'VERIFY_FAILED', msg: (r, id) => `${id}: gate verification failed (score ${P(r, 'sc', ['0.97', '0.98', '0.95'])}); pytest: 1 failed, ${r.int('p', 20, 60)} passed: test_concurrent_reserve - AssertionError: race window hit (expected 3, got 2)` },
  { id: 'flake-dns', label: 'flake', kinds: ['agent'], code: () => 'MODEL_UNAVAILABLE', msg: (r, id) => `${id}: claude CLI exited 1: API Error: Connection error. (temporary DNS failure resolving the API host, EAI_AGAIN)` },
  { id: 'flake-sqlite-busy', label: 'flake', kinds: ['task'], code: () => 'SQLITE_BUSY', msg: (r) => `sqlite: database is locked (SQLITE_BUSY) after ${r.int('s', 5, 30)} s while another worker held the journal` },
  // ---- variance (6, new) ----------------------------------------------------------------------------------------------------
  { id: 'variance-check-label', label: 'variance', kinds: ['agent'], code: () => 'NODE_CHECK_FAILED', msg: (r, id) => `${id}: check ${r.int('k', 0, 1)} failed` },
  { id: 'variance-assert-after-model', label: 'variance', kinds: ['assert'], code: () => 'ASSERTION_FAILED', msg: (r, id) => `Assertion ${id} failed` },
  { id: 'variance-verify-model', label: 'variance', kinds: ['verify'], code: () => 'VERIFY_FAILED', msg: (r, id) => `${id}: gate verification failed (score ${P(r, 'sc', ['0', '0.5', '0.33'])})` },
  { id: 'variance-extract-count', label: 'variance', kinds: ['agent'], code: () => 'NODE_CHECK_FAILED', msg: (r, id) => `${id}: check 0 failed (the extraction returned ${r.int('n', 2, 9)} items, the schema check expects at most ${r.int('m', 10, 20)} distinct values per field)` },
  { id: 'variance-assert-labels', label: 'variance', kinds: ['assert'], code: () => 'ASSERTION_FAILED', msg: (r, id) => `Assertion ${id} failed` },
  { id: 'variance-verify-independent', label: 'variance', kinds: ['verify'], code: () => 'VERIFY_FAILED', msg: (r, id) => `${id}: gate verification failed (score ${P(r, 'sc', ['0', '0.25'])})` },
  // ---- defect (7, rewritten) ---------------------------------------------------------------------------------------------------
  { id: 'defect-js-undefined', label: 'defect', kinds: ['code'], code: () => 'CODE_ERROR', msg: (r) => `Code failed (exit 1): foundry-code.mjs:${r.int('l', 3, 40)}\nTypeError: Cannot read properties of undefined (reading '${P(r, 'f', ['amount', 'rows', 'birth_date', 'currency'])}')\n    at normalise (foundry-code.mjs:${r.int('l', 3, 40)}:${r.int('c', 5, 30)})` },
  { id: 'defect-py-keyerror', label: 'defect', kinds: ['code'], code: () => 'CODE_ERROR', msg: (r) => `Code failed (exit 1): Traceback (most recent call last):\n  File "foundry-code.py", line ${r.int('l', 3, 60)}, in to_usd\n    return round(amount * RATES[ccy], 2)\nKeyError: '${P(r, 'k', ['CHF', 'JPY', 'SEK', 'NOK'])}'` },
  { id: 'defect-acceptance-merge', label: 'defect', kinds: ['workflow'], code: () => 'ACCEPTANCE_FAILED', msg: () => 'Acceptance failed for root' },
  { id: 'defect-dataflow', label: 'defect', kinds: ['task'], code: () => 'MISSING_REFERENCE', msg: (r) => `Missing value at nodes.${P(r, 'n', ['extract', 'parse', 'load'])}.${P(r, 'f', ['items', 'rows', 'records'])}` },
  { id: 'defect-verify-alias', label: 'defect', kinds: ['verify'], code: () => 'VERIFY_FAILED', msg: (r, id) => `${id}: gate verification failed (score ${P(r, 'sc', ['0.5', '0.4'])})` },
  { id: 'defect-py-assert', label: 'defect', kinds: ['code'], code: () => 'CODE_ERROR', msg: (r) => `Code failed (exit 1): Traceback (most recent call last):\n  File "foundry-code.py", line ${r.int('l', 3, 60)}, in dedup\nAssertionError: expected ${r.int('a', 10, 40)} rows after dedup, got ${r.int('b', 41, 80)}` },
  { id: 'defect-js-invalid-time', label: 'defect', kinds: ['code'], code: () => 'CODE_ERROR', msg: (r) => `Code failed (exit 1): foundry-code.mjs:${r.int('l', 3, 40)}\nRangeError: Invalid time value\n    at parseDate (foundry-code.mjs:${r.int('l', 3, 40)}:${r.int('c', 5, 30)}) for input "${P(r, 'i', ['H8.10.01', '31/04/1990', '00/00/0000'])}"` },
  // ---- env (8, rewritten) ---------------------------------------------------------------------------------------------------------
  { id: 'env-model-file', label: 'env', kinds: ['agent'], code: () => 'MODEL_UNAVAILABLE', msg: (r, id) => `${id}: llama-server for ${P(r, 'm', ['qwen3.5-4b-q4km', 'granite-4.2-3b-q4km'])} was not healthy within 120000 ms (model file missing: /opt/models/*.gguf)` },
  { id: 'env-sandbox', label: 'env', kinds: ['code'], code: () => 'SANDBOX_UNAVAILABLE', msg: () => 'Sandbox setup failed (exit 1): unshare: unshare failed: Operation not permitted; user namespaces are disabled on this host' },
  { id: 'env-module-missing', label: 'env', kinds: ['code'], code: () => 'CODE_ERROR', msg: (r) => `Code failed (exit 1): Traceback (most recent call last):\n  File "foundry-code.py", line 3, in <module>\n    import ${P(r, 'm', ['numpy', 'scipy', 'pandas'])}\nModuleNotFoundError: No module named '${P(r, 'm', ['numpy', 'scipy', 'pandas'])}'` },
  { id: 'env-enospc', label: 'env', kinds: ['task'], code: () => 'ENOSPC', msg: (r) => `ENOSPC: no space left on device, write '/var/foundry/runs/${r.int('n', 1000, 9999)}/artifacts/out.json'` },
  { id: 'env-api-key', label: 'env', kinds: ['agent'], code: () => 'MODEL_UNAVAILABLE', msg: (r, id) => `${id}: claude CLI exited 1: Invalid API key. Please run /login` },
  { id: 'env-tool-missing', label: 'env', kinds: ['code'], code: () => 'CODE_ERROR', msg: (r) => `Code failed (exit 127): /bin/sh: 1: ${P(r, 't', ['pytest', 'python3.12', 'jq'])}: not found` },
  { id: 'env-eacces', label: 'env', kinds: ['task'], code: () => 'EACCES', msg: (r) => `EACCES: permission denied, open '/home/user/.foundry/state/${P(r, 'f', ['runs.sqlite', 'lock'])}'` },
  { id: 'env-oom', label: 'env', kinds: ['code', 'agent'], code: () => 'CODE_ERROR', msg: (r) => `Code failed (exit 137): Killed: the container hit its memory limit of ${P(r, 'g', [2, 4])} GiB while loading the model` },
  // ---- impossible (5, new) -----------------------------------------------------------------------------------------------------------
  { id: 'impossible-assert', label: 'impossible', kinds: ['assert'], code: () => 'ASSERTION_FAILED', msg: (r, id) => `Assertion ${id} failed` },
  { id: 'impossible-acceptance', label: 'impossible', kinds: ['workflow'], code: () => 'ACCEPTANCE_FAILED', msg: () => 'Acceptance failed for root' },
  { id: 'impossible-schema', label: 'impossible', kinds: ['code'], code: () => 'CODE_OUTPUT', msg: (r, id) => `${id} returned a value outside its declared schema` },
  { id: 'impossible-verify', label: 'impossible', kinds: ['verify'], code: () => 'VERIFY_FAILED', msg: (r, id) => `${id}: gate verification failed (score 0)` },
  { id: 'impossible-check', label: 'impossible', kinds: ['agent'], code: () => 'NODE_CHECK_FAILED', msg: (r, id) => `${id}: check ${r.int('k', 0, 2)} failed` },
  // ---- finding (6, new) -----------------------------------------------------------------------------------------------------------------
  { id: 'finding-assert-sut', label: 'finding', kinds: ['assert'], code: () => 'ASSERTION_FAILED', msg: (r, id) => `Assertion ${id} failed` },
  { id: 'finding-range', label: 'finding', kinds: ['task'], code: () => 'ERROR', msg: () => 'RangeError: Invalid array length' },
  { id: 'finding-null', label: 'finding', kinds: ['task'], code: () => 'ERROR', msg: () => "TypeError: Cannot read properties of null (reading 'lines')" },
  { id: 'finding-verify-sut', label: 'finding', kinds: ['verify'], code: () => 'VERIFY_FAILED', msg: (r, id) => `${id}: gate verification failed (score 0)` },
  { id: 'finding-invariant', label: 'finding', kinds: ['task'], code: () => 'SUT_ERROR', msg: (r) => `Error: ledger invariant violated: balance -${r.int('n', 1, 9)} < 0 after settle()` },
  { id: 'finding-assert-total', label: 'finding', kinds: ['assert'], code: () => 'ASSERTION_FAILED', msg: (r, id) => `Assertion ${id} failed` },
]);
export const TEMPLATE_COUNTS = Object.freeze(TEMPLATES.reduce((m, t) => ({ ...m, [t.label]: (m[t.label] ?? 0) + 1 }), {}));
