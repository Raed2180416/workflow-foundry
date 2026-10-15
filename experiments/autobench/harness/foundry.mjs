// Arm A1 of PREREG-AB-v1: claude-haiku-5-5 + the Foundry harness, inside the official AutomationBench protocol.
// (experiments/autobench/harness; run with `node experiments/autobench/run.mjs --harness foundry ...`.)
//
// What A1 changes, and nothing else:
//   1. The session's system prompt is the official system prompt VERBATIM, then the same tool section A0 gets
//      (lib.mjs adapterText), then one clearly delimited, task-agnostic harness section (harnessSection below): a
//      six-phase procedure (discover read-only, requirement ledger in REQUIREMENTS.md, plan against the ledger, act,
//      verify by re-reading the world, then stop). The user message is the official one, verbatim.
//   2. A step guard: the CLI runs with `--max-turns <maxSteps - 1>` through a host-written wrapper kept read-only
//      outside the workdir, so the session cannot run past the official limit. The CLI counts turns its own way (it may
//      count parallel tool calls separately), so the guard can only stop a session earlier than the official loop,
//      never later. The exact official count is applied host-side after the session (accounting.mjs, H3).
//   3. Host-side collection of REQUIREMENTS.md after the session (collectLedger): never followed through a link,
//      size-capped, copied into the host-only directory; only its statistics enter the results.
// No extra model call, no fork, no rehearsal, no task identity, no assertion, rubric or grade reaches the session.
// The procedure text contains no domain, app or task specific content (test/harness.test.mjs scans it).
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync, constants as fsc } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellQuote } from '../../../src/executors/claude-code.mjs';
import { REPO, adapterText, sha256 } from '../lib.mjs';

export const HARNESS_ID = 'foundry';
export const HARNESS_VERSION = 'a1-v1';
export const LEDGER_FILE = 'REQUIREMENTS.md';
export const SECTION_BEGIN = '## Harness procedure (begin)';
export const SECTION_END = '## Harness procedure (end)';
export const LEDGER_MAX_BYTES = 256 * 1024;

/** The harness section: identical for every task (only the step limit, a protocol constant, is filled in). */
export function harnessSection({ maxSteps = 50 } = {}) {
  const n = maxSteps - 1;
  return `${SECTION_BEGIN}
This section is added by the evaluation harness. It is the same for every task and says nothing about this task: the task is the user message, and everything above still applies. Work in these six phases, in order.

1. Discover (read only). Find out what the request touches before you change anything. Use api_search to find the endpoints for every app and action that the request, and anything you read, refers to. Read the messages, documents, pages, sheets and records that can hold the instructions, policies, people, thresholds and data the request depends on, including anything it only alludes to (a policy, a process, a list, "the latest" version). Make no change in this phase: nothing that creates, updates, sends, posts or deletes.

2. Requirement ledger. Write ${LEDGER_FILE} in your working directory. List every rule, constraint and instruction you found, in the request and in everything you read, one per line:
   - [ ] R1: <what must be done, with the exact values: who, which record, amounts, dates, fields, required wording or format> (source: <app and message, document, row or record>; date: <the source's date, or undated>)
   List what must not be done on separate lines (F1, F2, ...): people, records, channels or actions that a rule excludes or limits.
   When two items conflict, the newer or more specific one wins: keep both lines and mark the losing one "(superseded by R<k>: newer)" or "(superseded by R<k>: more specific)". Mark records that look stale or misleading (outdated, duplicated, or contradicted by another source) with "(flag: <why>; rely on <which record> instead)".
   ${LEDGER_FILE} is your private working file: never send, post or copy its content into any app.

3. Plan. Add "## Plan" to ${LEDGER_FILE}: each write you will make (method, endpoint, target record or recipient, key values) and the R items it satisfies. Check every planned write against the F items. Every R item needs a planned write or a reason why it needs none.

4. Act. Make the planned writes, in order where one depends on another; use batch for independent writes.

5. Verify. Re-read the world for every write: fetch each record you created or changed and the messages you sent or posted. Compare them with the ledger: every R item done with the exact values, nothing an F item forbids done, nothing done twice. Fix anything wrong or missing, then re-read it. Add "## Verification" to ${LEDGER_FILE}: one line per item, marked done, not needed (why) or blocked (why).

6. Stop. Only after the verification, end with the short summary the instructions above ask for.

Steps: every response in which you run a command counts as one step, whether the command calls the environment or only writes ${LEDGER_FILE}. At most ${n} such responses run; then the session ends. Keep the procedure lean: batch independent calls, and write ledger updates in the same command as your next tool call where you can (\`cat > ${LEDGER_FILE} <<'EOF'\` ... \`EOF\`, then \`node tool.mjs batch ...\` on the next line).
${SECTION_END}`;
}

/** A1's system prompt: official system prompt verbatim + A0's tool section + the harness section. */
export function harnessSystemPrompt(officialSystem, catalog, maxSteps) {
  if (typeof officialSystem !== 'string' || !officialSystem) throw new Error('the official system prompt is required');
  return `${officialSystem}\n\n${adapterText(catalog, maxSteps)}\n\n${harnessSection({ maxSteps })}`;
}

/** The step guard: a host-written wrapper (directory kept read-only in the sandbox, outside the workdir) that runs the
 * CLI with --max-turns. `target` is the CLI (by PATH lookup, as A0's runner does); tests point it at a stand-in. */
export function writeCliGuard(dir, { maxTurns, target = 'claude' } = {}) {
  if (!Number.isInteger(maxTurns) || maxTurns < 1) throw new Error(`step guard: maxTurns must be a positive integer (got ${maxTurns})`);
  mkdirSync(dir, { recursive: true });
  const binary = path.join(dir, 'claude-a1');
  writeFileSync(binary, `#!/bin/sh\n# Foundry A1 step guard (experiments/autobench/harness/foundry.mjs): the CLI with --max-turns ${maxTurns}.\nexec ${shellQuote(target)} --max-turns ${maxTurns} "$@"\n`, { mode: 0o755 });
  return { dir, binary, maxTurns, target };
}

/** Ledger statistics (informational): items in the ledger proper (before "## Plan"/"## Verification"), R/F items,
 * superseded and flagged items, sources and dates given, plan and verification sections. */
export function ledgerStats(text) {
  const lines = String(text ?? '').split('\n');
  const item = /^\s*(?:[-*+]|\d+[.)])\s+\S/;
  let section = 'ledger';
  const s = { lines: lines.length, items: 0, requirements: 0, forbidden: 0, superseded: 0, flagged: 0, withSource: 0, withDate: 0, checked: 0, hasPlan: false, planItems: 0, hasVerification: false, verificationItems: 0 };
  for (const l of lines) {
    if (/^\s*#{1,6}\s*plan\b/i.test(l)) { section = 'plan'; s.hasPlan = true; continue; }
    if (/^\s*#{1,6}\s*verification\b/i.test(l)) { section = 'verification'; s.hasVerification = true; continue; }
    if (!item.test(l)) continue;
    if (/^\s*[-*+]\s+\[[xX]\]/.test(l)) s.checked += 1;
    if (section === 'plan') { s.planItems += 1; continue; }
    if (section === 'verification') { s.verificationItems += 1; continue; }
    s.items += 1;
    if (/\bR\d+\s*[:.)]/.test(l)) s.requirements += 1;
    if (/\bF\d+\s*[:.)]/.test(l)) s.forbidden += 1;
    if (/supersed/i.test(l)) s.superseded += 1;
    if (/\bflag\b|stale|misleading|outdated|duplicat/i.test(l)) s.flagged += 1;
    if (/source\s*:/i.test(l)) s.withSource += 1;
    if (/date\s*:/i.test(l)) s.withDate += 1;
  }
  return s;
}

/** Copy the session's REQUIREMENTS.md into the host-only directory after the session. The workdir is agent-writable, so
 * the file is opened without following a link and must be a regular file with one link (a planted symlink, FIFO,
 * directory or hard link is refused, whatever it points at); at most LEDGER_MAX_BYTES are read. */
export function collectLedger(workdir, hostDir, { name = LEDGER_FILE, maxBytes = LEDGER_MAX_BYTES } = {}) {
  let fd;
  try { fd = openSync(path.join(workdir, name), fsc.O_RDONLY | fsc.O_NOFOLLOW | fsc.O_NONBLOCK); } catch (e) {
    return { present: false, reason: e.code === 'ENOENT' ? 'absent' : 'refused: not a regular file' };
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1) return { present: false, reason: 'refused: not a regular file' };
    const buf = Buffer.alloc(Math.min(st.size, maxBytes));
    let got = 0;
    while (got < buf.length) { const k = readSync(fd, buf, got, buf.length - got, got); if (!k) break; got += k; }
    const text = buf.subarray(0, got).toString('utf8');
    mkdirSync(hostDir, { recursive: true });
    writeFileSync(path.join(hostDir, 'ledger.md'), text);
    return { present: true, bytes: st.size, truncated: st.size > maxBytes, sha256: sha256(text), ...ledgerStats(text) };
  } finally { closeSync(fd); }
}

// ---------------------------------------------------------------------------------------------------------------
// Manifest (PREREG-AB-v1 §6.1): sha256 of the canonical JSON {files: [{path, sha256}] sorted by path, config}. Files are
// every local module run.mjs loads (static and dynamic imports, transitively), the bridge, the agent-side client and
// the model policy file.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.resolve(HERE, '../run.mjs');
const IMPORT_RE = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g;

/** Local .mjs files reachable from `entry` through relative imports. */
export function localImports(entry = RUNNER) {
  const seen = new Set(), stack = [path.resolve(entry)];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const m of readFileSync(f, 'utf8').matchAll(IMPORT_RE)) stack.push(path.resolve(path.dirname(f), m[1]));
  }
  return [...seen];
}

export function manifestFiles() {
  const extra = ['experiments/autobench/bridge.py', 'experiments/autobench/tool.mjs', 'policy/models.json'].map(p => path.join(REPO, p));
  return [...new Set([...localImports(), ...extra])].map(f => path.relative(REPO, f)).sort();
}

/** The CLI version, read without a model call (`claude --version`, minimal environment). */
export function cliVersion(binary = 'claude') {
  const r = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 20_000, env: { PATH: process.env.PATH ?? '', HOME: '/nonexistent' } });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** The run settings the manifest pins (H3, H4, H9 and §7: model, effort, budgets, step limits, executor options). */
export function harnessConfig(o) {
  return { harness: HARNESS_ID, version: HARNESS_VERSION, model: o.model ?? null, effort: o.effort ?? null, budgetUsd: o.budgetUsd, timeoutMin: o.timeoutMin,
    maxSteps: o.maxSteps, cliMaxTurns: o.cliMaxTurns, tools: o.tools, det: o.det, k: o.k, concurrency: o.concurrency,
    executor: 'src/executors/claude-code.mjs runClaudeCode, DEFAULT_HIDDEN, DEFAULT_KEEP_RO + the step-guard directory', cli: o.cli ?? null };
}

const canon = v => JSON.stringify(sortKeys(v));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]));
  return v;
}

export function harnessManifest(config) {
  const files = manifestFiles().map(p => ({ path: p, sha256: sha256(readFileSync(path.join(REPO, p))) }));
  return { files, config, sha256: sha256(canon({ files, config })) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // node experiments/autobench/harness/foundry.mjs --manifest [--model M --effort E ...]  prints the manifest and hash
  // node experiments/autobench/harness/foundry.mjs --section                                prints the harness section
  const argv = process.argv.slice(2);
  const a = Object.fromEntries(argv.map((x, i) => (x.startsWith('--') ? [x.slice(2), argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true] : null)).filter(Boolean));
  if (a.section) process.stdout.write(harnessSection({ maxSteps: Number(a['max-steps'] ?? 50) }) + '\n');
  else {
    const maxSteps = Number(a['max-steps'] ?? 50);
    const cfg = harnessConfig({ model: a.model ?? 'claude-haiku-5-5', effort: a.effort ?? 'high', budgetUsd: Number(a.budget ?? 0.75), timeoutMin: Number(a['timeout-min'] ?? 20),
      maxSteps, cliMaxTurns: a['cli-max-turns'] === 'off' ? 0 : Number(a['cli-max-turns'] ?? maxSteps - 1), tools: String(a.tools ?? 'Bash').split(','), det: a.det ?? 'record',
      k: 1, concurrency: Number(a.concurrency ?? 4), cli: cliVersion() });
    process.stdout.write(JSON.stringify(harnessManifest(cfg), null, 1) + '\n');
  }
}
