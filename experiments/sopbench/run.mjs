#!/usr/bin/env node
// SOP-Bench runner (experiments/sopbench; research/sopbench-20261021/NOTES.md, DESIGN.md).
//
// Per row: bridge.py prepares the row from the pinned clone; a bridge process serves the SOP's own mock tools through a
// file mailbox (tool.mjs) while ONE sandboxed `claude -p` session (src/executors/claude-code.mjs) works the row with
// upstream's function-calling prompt (the SOP, the task lines) and returns a <final_output> JSON; the answer is graded
// host-side twice: upstream's verdict (bridge grade: the real Evaluator.run_single_task, plus the JS port where it
// applies) and our strict verdict (Python and JS, which must agree). Live files stay outside the repo; the aggregate summary is copied
// into research/sopbench-20261021/runs/<run-id>/ at the end (per-row records: ROWS_ROOT, never the repo).
//
//   node experiments/sopbench/run.mjs --model claude-haiku-5-5 --cap 8 [--rows-per-sop 20] [--sops a,b] [--concurrency 3]
//   node experiments/sopbench/run.mjs --scripted oracle|wrong|labelswap|gaming|empty [--sops ...]   ($0: no model)
// Options: --budget 0.25 (USD per session, reserved against --cap) --max-steps 10 (tool steps per row: upstream's
//   function-calling agent makes at most 10 model calls) --timeout-min 10 --effort low|medium|high --run-id ID
//   --live DIR --out DIR (the repo copy: summary.json only) --no-copy --keep (workdirs) --resume --sealed --freeze FILE
//   (sealed rows; refused without both). Per-row records (answers, grades) go to ROWS_ROOT/<run-id>/, outside the repo.
//   --exclude a,b (default for model runs: patient_intake, pending the owner's scope decision; NOTES.md §7)
// Split hygiene: rows come from SPLIT.json dev rows (build then repair); assertRows here and allowed_rows in the bridge
// refuse sealed rows unless --sealed is given with a freeze file naming this split.
// Environment faults (a rate or usage limit, the model unavailable, no sandbox; experiments/lib ENV_FAULTS) are never
// scored: the row's record goes to results.faults.jsonl, no new session starts and the run stops (exit 3); `--resume`
// with the same command keeps every recorded row and reruns the rest. Reaching the cap stops the run too (exit 4).
import { appendFileSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync, constants as fsc } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { runClaudeCode, WORK_ROOT, nestedModelUses } from '../../src/executors/claude-code.mjs';
import { loadPolicy, modelById, CHILD_ENV_ALLOWED } from '../../src/models/policy.mjs';
import { ENV_FAULTS } from '../lib/runner.mjs';
import { commandFlags, sameModel, readStream, sessionResponses } from '../autobench/accounting.mjs';
import { BRIDGE, REPO, RESEARCH, SPLIT_FILE, TOOL_CLIENT, UPSTREAM, UPSTREAM_PIN, bridgeOk, materializeWorkdir, readJson, sha256, startServe, writeJson } from './lib.mjs';
import { assertRows, devRows, loadSplit } from './split.mjs';
import { finalOutputText, strictVerdict, upstreamVerdict } from './scorer.mjs';

export const DEFAULTS = Object.freeze({ budgetUsd: 0.25, concurrency: 3, maxSteps: 10, timeoutMin: 10, rowsPerSop: 20, tools: ['Bash'] });
export const MODEL_EXCLUDE = Object.freeze(['patient_intake']);
/** Per-row records live outside the repo (CC BY-NC upstream-derived values); research/ keeps aggregates only. */
export const ROWS_ROOT = '/var/tmp/foundry-work/sopbench-rows';
const INFRA_FAULT = /ENOSPC|EDQUOT|EMFILE|ENFILE|No usable temporary directory/;
export const isEnvFault = r => ENV_FAULTS.has(r?.sessionError) || INFRA_FAULT.test(r?.harnessError ?? '');
/** The benchmark's own distribution, for the L5 audit (the AutomationBench pattern in accounting.mjs does not cover it). */
export const SOP_REF = /sop[-_ ]?bench|amazon[-_]sop|huggingface\.co|\bhf_hub\b|\bsnapshot_download\b/i;

// ---- prompts ---------------------------------------------------------------------------------------------------------
/** The tool section of the system prompt: how the SOP's tools are reached here (the AutomationBench adapter's wording). */
export function systemPrompt(catalog, maxSteps) {
  return `You execute a Standard Operating Procedure (SOP) for one task, using the procedure's tools.

## Tools in this environment
Your tools are not native function calls here. Call them from Bash with the client in your working directory:
  node tool.mjs call <tool_name> '<arguments as a JSON object>'
  node tool.mjs batch '[{"name": "<tool_name>", "arguments": {...}}, ...]'
\`batch\` runs several calls in one step, in order: use it where you would make parallel tool calls. Arguments can also be given as @file.json or - (stdin, e.g. from a heredoc) when shell quoting is awkward. \`node tool.mjs list\` prints the tool definitions again. Each \`call\` or \`batch\` invocation is one step; the environment runs at most ${maxSteps} steps. The printed output is exactly what the tool returned (JSON), or "Error: ..." when the call failed.

The tools (name, description, JSON input schema):
${JSON.stringify(catalog, null, 1)}`;
}

/** Upstream's function-calling prompt (function_calling.py:208-224) with one change: the final answer is a
 * <final_output> JSON object with the SOP's output columns (the format upstream's parser tries first, parser.py:67-71)
 * instead of a single <final_decision> value, so multi-field SOPs have a defined answer format. */
export function userPrompt(sopText, taskText, outputColumns) {
  const example = Object.fromEntries(outputColumns.map(c => [c, outputColumns.length === 1 ? 'your_decision_value' : `value_of_${c}`.replace(/\s+/g, '_')]));
  return `Please follow this Standard Operating Procedure to process the given task:

<sop>
${sopText}
</sop>

Task to process:
${taskText}

Follow the SOP step by step. Use the available tools to gather information and make decisions.

IMPORTANT: Once you have completed all steps, provide your final answer in the following format, as the last thing in your final message:

${finalOutputText(example)}

The JSON object must have exactly ${outputColumns.length === 1 ? 'this key' : 'these keys'}: ${outputColumns.map(c => JSON.stringify(c)).join(', ')}. Each value should be the final value as specified in the SOP. Provide ONLY the values inside the JSON, without any additional explanation or formatting.`;
}

// ---- scripted policies ($0; host-side fixtures: they read the host-only expected.json) ------------------------------
export const POLICIES = Object.freeze(['oracle', 'wrong', 'labelswap', 'gaming', 'empty']);
const pyValue = e => (e.isna ? null : e.str);
/** The answer object of a policy for one row. labels: {col: [distinct ground-truth strings over the run's dev rows]}. */
export function policyAnswer(policy, expected, labels) {
  const cols = expected.output_columns;
  const ex = expected.expected;
  if (policy === 'empty') return null;
  if (policy === 'oracle') return Object.fromEntries(cols.map(c => [c, pyValue(ex[c])]));
  if (policy === 'wrong') return Object.fromEntries(cols.map(c => [c, 'zz-not-a-label']));
  if (policy === 'labelswap') return Object.fromEntries(cols.map(c => { const ls = (labels[c] ?? []).filter(l => l !== ex[c].str); return [c, ls.length ? ls[0] : 'zz-not-a-label']; }));
  if (policy === 'gaming') return Object.fromEntries(cols.map(c => [c, (labels[c] ?? []).filter(l => !['nan', ''].includes(l.toLowerCase())).join(' / ') || 'zz-not-a-label']));
  throw new Error(`unknown policy ${policy}`);
}
/** Scripted tool steps for a row: up to 3 tools whose required parameters are all task inputs (one batch), then the
 * error paths (an unknown tool, malformed JSON arguments). */
export function scriptedSteps(task, catalog) {
  const call = (name, args) => ({ name, arguments: typeof args === 'string' ? args : JSON.stringify(args) });
  const fill = catalog.filter(t => { const req = t.input_schema?.required ?? Object.keys(t.input_schema?.properties ?? {}); return req.every(p => p in task.inputs); }).slice(0, 3);
  const steps = [];
  if (fill.length) steps.push({ calls: fill.map(t => call(t.name, Object.fromEntries(Object.keys(t.input_schema?.properties ?? {}).filter(p => p in task.inputs).map(p => [p, task.inputs[p]])))) });
  steps.push({ calls: [call('no_such_tool', {}), call(catalog[0].name, '{"broken": ')] });
  return steps;
}
export function scriptedRunner(policy) {
  return async ({ workdir, scripted }) => {
    const t0 = Date.now();
    for (const [i, step] of scripted.steps.entries()) {
      const f = path.join(workdir, `.step-${i}.json`);
      writeFileSync(f, JSON.stringify(step.calls));
      await new Promise(res => { const c = spawn(process.execPath, ['tool.mjs', 'batch', `@${f}`], { cwd: workdir, stdio: 'ignore' }); c.on('close', res); });
    }
    const ans = policyAnswer(policy, scripted.expected, scripted.labels);
    return { ok: true, error: null, result: ans === null ? '' : `Done.\n${finalOutputText(ans)}`, costUsd: 0, costUnknown: false, costUpperUsd: 0, turns: scripted.steps.length + 1, durationMs: Date.now() - t0, toolUses: [], label: `scripted:${policy}` };
  };
}

// ---- ledger, pool, audit -----------------------------------------------------------------------------------------------
export function makeLedger(capUsd) {
  const l = { capUsd, spent: 0, reserved: 0, unknown: 0 };
  l.tryReserve = b => { if (l.spent + l.reserved + b <= capUsd + 1e-9) { l.reserved += b; return true; } return false; };
  l.reserve = async b => { while (!l.tryReserve(b)) { if (l.reserved <= 1e-9) return false; await new Promise(r => setTimeout(r, 250)); } return true; };
  l.settle = (b, cost, unknown) => { l.reserved -= b; l.spent += cost; if (unknown) l.unknown += 1; };
  return l;
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}
function copyTranscript(workdir, hostDir) {
  const src = path.join(workdir, '.executor-transcript.jsonl');
  try { if (!lstatSync(src).isFile()) return; } catch { return; }
  try { copyFileSync(src, path.join(hostDir, 'transcript.jsonl'), fsc.COPYFILE_EXCL); } catch {}
}
/** Host-side audit of one session transcript: model responses, models, L5 flags (network/package commands, network
 * code, references to the benchmark's distribution). */
export function auditTranscript(events, expectModel) {
  const responses = sessionResponses(events);
  const last = events.filter(e => e?.type === 'result').at(-1) ?? null;
  const models = [...new Set([...events.filter(e => e?.type === 'assistant' && typeof e.message?.model === 'string' && e.message.model !== '<synthetic>').map(e => e.message.model),
    ...(last ? Object.keys(last.modelUsage ?? {}) : [])])].sort();
  const flags = responses.flatMap(r => r.commands.filter(c => c.command !== null).flatMap(c => [...commandFlags(c.command), ...(SOP_REF.test(c.command) ? ['benchmark reference'] : [])].map(f => `${f} in response ${r.index}`)));
  const violations = [];
  if (expectModel) for (const m of models) if (!sameModel(m, expectModel)) violations.push(`L5: model ${m} reported (run model ${expectModel})`);
  for (const f of [...new Set(flags)]) violations.push(`L5: ${f}`);
  return { modelResponses: responses.length, toolResponses: responses.filter(r => r.toolUseIds.length).length, models, numTurns: last?.num_turns ?? null,
    resultSubtype: last?.subtype ?? null, compactions: events.filter(e => e?.type === 'system' && e.subtype === 'compact_boundary').length, violations };
}

const readRecords = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** Grade answers through the bridge (upstream's own evaluator + Python strict), then the JS port; returns per answer. */
export async function gradeAnswers(answers, { liveDir, split = SPLIT_FILE, sealed = false, freeze = null, upstream = UPSTREAM, dataDir = null, expectedOf }) {
  const inFile = path.join(liveDir, `grade-in-${process.pid}-${Math.random().toString(36).slice(2)}.jsonl`);
  const outFile = inFile.replace('grade-in', 'grade-out');
  writeFileSync(inFile, answers.map(a => JSON.stringify({ sop: a.sop, row: a.row, id: a.id, text: a.text })).join('\n') + '\n');
  await bridgeOk(['grade', '--answers', inFile, '--out', outFile, ...(sealed ? ['--sealed', '--freeze', freeze] : [])], { liveDir, split, upstream, dataDir });
  const py = readRecords(outFile);
  rmSync(inFile, { force: true }); rmSync(outFile, { force: true });
  return answers.map((a, i) => {
    const exp = expectedOf(a.sop, a.row);
    const jsUp = upstreamVerdict(a.text, exp.expected, exp.output_columns);
    const jsStrict = strictVerdict(a.text, exp.expected, exp.output_columns);
    const p = py[i];
    if (!p || p.sop !== a.sop || p.row !== a.row) throw new Error(`grade output out of order at ${i}`);
    return { upstream: p.upstream.pass, strict: p.strict.pass, upstreamPredicted: p.upstream.predicted, upstreamError: p.upstream.error, strictFields: p.strict.fields ?? null,
      jsUpstream: jsUp.covered ? jsUp.pass : null, jsUpstreamReason: jsUp.covered ? null : jsUp.reason, jsStrict: jsStrict.pass,
      agree: { upstream: jsUp.covered ? jsUp.pass === p.upstream.pass : null, strict: jsStrict.pass === p.strict.pass } };
  });
}

/**
 * One agent session on one row (the A-H arm; phase 1's per-row loop body, unchanged in behaviour): workdir with the tool
 * client, a bridge on the row's world, the session, host-side accounting. Returns { rec, started }; the caller settles the
 * cost and grades rec.answerText. o.tag names the workdir/host directories (default <sop>-<row>).
 */
export async function runAgentRow(o) {
  const { sop, row, prepDir: pdir, live, runner } = o;
  const tag = o.tag ?? `${sop}-${row}`;
  const meta = readJson(path.join(pdir, 'meta.json'));
  const task = readJson(path.join(pdir, 'rows', String(row), 'task.json'));
  const catalog = readJson(path.join(pdir, 'catalog.json'));
  const hostDir = o.hostDir ?? path.join(live, 'host', sop, String(row));
  const workdir = path.join(live, 'w', tag);
  const rec = { sop, row, contract_sha256: meta.contract_sha256, row_sha256: task.row_sha256 };
  let r = null, bridge = null, started = false;
  try {
    rmSync(workdir, { recursive: true, force: true });
    rmSync(hostDir, { recursive: true, force: true });
    materializeWorkdir(workdir, catalog);
    bridge = startServe({ liveDir: live, sop, row, mailbox: path.join(workdir, '.tools'), hostDir, maxSteps: o.maxSteps, sealed: o.sealed, freeze: o.freeze, catalog: o.catalog ?? null, upstream: o.upstream, split: o.split, dataDir: o.dataDir });
    await bridge.ready;
    started = true;
    const sopText = readFileSync(path.join(pdir, 'sop.txt'), 'utf8');
    r = await runner({ model: o.model, prompt: userPrompt(sopText, task.task_text, task.output_columns), systemPrompt: systemPrompt(catalog, o.maxSteps), workdir, files: {},
      budgetUsd: o.budgetUsd, timeoutMs: o.timeoutMin * 60_000, effort: o.effort ?? null, tools: o.tools, task: { name: `${sop}:${row}` },
      scripted: o.scripted ? { ...o.scripted, steps: scriptedSteps(task, catalog) } : undefined });
    Object.assign(rec, { costUsd: r.costUsd ?? r.costUpperUsd ?? o.budgetUsd, costUnknown: Boolean(r.costUnknown), turns: r.turns ?? null, durationMs: r.durationMs ?? null,
      sessionError: r.error?.code ?? null, nestedModelUses: nestedModelUses(r.toolUses ?? []), streamUsage: r.streamUsage ?? null });
    const doneMsg = await bridge.stop();
    rec.steps = doneMsg.steps;
    rec.answerText = String(r.result ?? '');
  } catch (e) {
    rec.harnessError = String(e?.message ?? e).slice(0, 800);
    bridge?.kill();
  } finally {
    if (!r && started) Object.assign(rec, { costUsd: o.budgetUsd, costUnknown: true });
    rec.costUsd ??= 0;
    copyTranscript(workdir, hostDir);
    if (!o.keep) rmSync(workdir, { recursive: true, force: true });
  }
  if (started && existsSync(path.join(hostDir, 'serve.json'))) {
    const sv = readJson(path.join(hostDir, 'serve.json'));
    const calls = readRecords(path.join(hostDir, 'calls.jsonl'));
    rec.world = { steps: sv.steps, calls: sv.calls, upstreamFatal: sv.upstreamFatal, toolErrors: calls.filter(c => c.error).length, unknownTool: calls.filter(c => c.error === 'unknown_tool').length,
      stepLimitRefusals: calls.filter(c => c.refused).length, tools: [...new Set(calls.filter(c => c.name).map(c => c.name))].sort() };
  }
  if (started && o.audit) {
    const events = readStream(path.join(hostDir, 'transcript.jsonl'));
    rec.session = auditTranscript(events, o.model);
    if (!events.length) rec.session.violations.push('L5: no host transcript');
  }
  return { rec, started };
}

// ---- the run -----------------------------------------------------------------------------------------------------------
export async function runRows(o) {
  const opt = { ...DEFAULTS, ...o };
  const log = opt.log ?? (m => process.stderr.write(m + '\n'));
  const scripted = Boolean(opt.policy);
  const runner = opt.runner ?? (scripted ? scriptedRunner(opt.policy) : runClaudeCode);
  const splitFile = opt.split ?? SPLIT_FILE, upstream = opt.upstream ?? UPSTREAM, dataDir = opt.dataDir ?? null;
  const split = loadSplit(splitFile);
  let policy = null;
  if (!scripted) {
    policy = loadPolicy();
    const entry = modelById(policy.policy, opt.model); // refuses ids the policy does not list
    if (entry.provider !== 'claude-cli') throw new Error(`model ${opt.model} is not served by the claude-cli provider`);
    if (!(opt.capUsd > 0)) throw new Error('--cap (hard USD cap for the run) is required for model runs');
  }
  const exclude = new Set(opt.exclude ?? (scripted ? [] : MODEL_EXCLUDE));
  const sops = (opt.sops?.length ? opt.sops : Object.keys(split.sops)).filter(s => !exclude.has(s));
  // 1. selection: dev rows (build then repair), refused if sealed without a freeze
  const rowsBy = Object.fromEntries(sops.map(s => {
    const rows = opt.rows?.[s] ?? devRows(split, s).slice(0, opt.rowsPerSop);
    assertRows(split, s, rows, { sealed: opt.sealed, freeze: opt.freeze });
    return [s, rows];
  }));
  const jobs = [];
  for (let i = 0; i < Math.max(0, ...sops.map(s => rowsBy[s].length)); i++) for (const s of sops) if (rowsBy[s][i] !== undefined) jobs.push({ sop: s, row: rowsBy[s][i] });
  const runId = opt.runId ?? `sb-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-${sha256(String(Math.random())).slice(0, 6)}`;
  const live = opt.liveRoot ?? path.join(WORK_ROOT, 'sopbench', runId);
  mkdirSync(live, { recursive: true });
  const resultsFile = path.join(live, 'results.jsonl'), faultsFile = path.join(live, 'results.faults.jsonl'), launchFile = path.join(live, 'launch.json');
  const launch = { jobs, model: scripted ? null : opt.model, policy: opt.policy ?? null, budgetUsd: opt.budgetUsd, maxSteps: opt.maxSteps, timeoutMin: opt.timeoutMin, effort: opt.effort ?? null,
    tools: opt.tools, sealed: Boolean(opt.sealed), splitSha256: split.splitSha256, capUsd: opt.capUsd ?? null, runnerSha256: sha256(readFileSync(new URL(import.meta.url))) };
  let kept = [];
  if (existsSync(launchFile)) {
    if (!opt.resume) throw new Error(`${live} already holds a run: pass --resume to continue it, or use a new --run-id`);
    const prior = readJson(launchFile);
    const settings = ({ capUsd, runnerSha256, history, ...rest }) => JSON.stringify(rest);
    if (settings(prior) !== settings(launch)) throw new Error(`resume refused: the settings differ from ${launchFile}`);
    if (prior.runnerSha256 !== launch.runnerSha256 && !opt.acceptRunnerChange) throw new Error('resume refused: the runner changed since launch (--accept-runner-change records it)');
    if (launch.capUsd !== null && prior.capUsd !== null && launch.capUsd < prior.capUsd) throw new Error('resume refused: the cap can only be raised');
    writeJson(launchFile, { ...prior, capUsd: launch.capUsd, runnerSha256: launch.runnerSha256, history: [...(prior.history ?? []), { at: new Date().toISOString(), capUsd: [prior.capUsd, launch.capUsd], runnerSha256: [prior.runnerSha256, launch.runnerSha256] }] });
    kept = readRecords(resultsFile);
  } else writeJson(launchFile, launch);
  log(`[sopbench] run ${runId}: ${jobs.length} rows over ${sops.length} SOPs, ${scripted ? `scripted ${opt.policy}` : `model ${opt.model}`}, live ${live}`);

  // 2. prepare (one bridge call per SOP)
  const prep = path.join(live, 'prep');
  for (const s of sops) {
    if (!existsSync(path.join(prep, s, 'meta.json'))) {
      await bridgeOk(['prepare', '--sop', s, '--rows', rowsBy[s].join(','), '--out', path.join(prep, s), ...(opt.sealed ? ['--sealed', '--freeze', opt.freeze] : [])], { liveDir: live, split: splitFile, upstream, dataDir });
    }
  }
  const expectedOf = (s, r) => readJson(path.join(prep, s, 'rows', String(r), 'expected.json'));
  const labelsBy = Object.fromEntries(sops.map(s => {
    const out = {};
    for (const r of rowsBy[s]) { const e = expectedOf(s, r); for (const c of e.output_columns) (out[c] ??= new Set()).add(e.expected[c].str); }
    return [s, Object.fromEntries(Object.entries(out).map(([c, v]) => [c, [...v].sort()]))];
  }));

  // 3. sessions
  const ledger = makeLedger(scripted ? Infinity : opt.capUsd);
  for (const r of [...kept, ...readRecords(faultsFile)]) ledger.spent += r.costUsd ?? 0;
  const done = new Set(kept.map(r => `${r.sop}:${r.row}`));
  const todo = jobs.filter(j => !done.has(`${j.sop}:${j.row}`));
  if (kept.length) log(`[sopbench] resuming: ${kept.length}/${jobs.length} rows kept, $${ledger.spent.toFixed(4)} already spent`);
  const results = [...kept];
  let stopped = null;
  const deferGrade = opt.deferGrade ?? scripted, pending = [];
  /** L5 / nested model use: a violating session scores as a fail in the headline; the live grade is kept. */
  const record = rec => {
    const v = [...(rec.session?.violations ?? []), ...(rec.nestedModelUses ? [`nested model use x${rec.nestedModelUses}`] : [])];
    rec.final = rec.grade ? { upstream: rec.grade.upstream, strict: rec.grade.strict } : { upstream: false, strict: false };
    if (v.length) { rec.liveFinal = rec.final; rec.final = { upstream: false, strict: false }; rec.headlineOverride = v.join('; '); }
    results.push(rec);
    appendFileSync(resultsFile, JSON.stringify(rec) + '\n');
    log(`[sopbench] ${rec.sop}:${rec.row} upstream=${rec.final.upstream ? 1 : 0} strict=${rec.final.strict ? 1 : 0}${rec.headlineOverride ? ` [${rec.headlineOverride}]` : ''} steps=${rec.steps ?? '-'} $${(rec.costUsd ?? 0).toFixed(4)}${rec.sessionError ? ` (${rec.sessionError})` : ''}`);
  };
  await pool(todo, opt.concurrency, async ({ sop, row }, k) => {
    if (stopped) return;
    if (!(await ledger.reserve(opt.budgetUsd))) { stopped ??= `the cap ($${ledger.spent.toFixed(4)} spent + ${opt.budgetUsd} > ${opt.capUsd})`; return; }
    const { rec, started } = await runAgentRow({ sop, row, prepDir: path.join(prep, sop), live, runner, model: opt.model, budgetUsd: opt.budgetUsd, maxSteps: opt.maxSteps,
      timeoutMin: opt.timeoutMin, effort: opt.effort, tools: opt.tools, sealed: opt.sealed, freeze: opt.freeze, upstream, split: splitFile, dataDir, keep: opt.keep,
      scripted: scripted ? { steps: null, expected: expectedOf(sop, row), labels: labelsBy[sop] } : undefined, audit: !scripted });
    ledger.settle(opt.budgetUsd, rec.costUsd, rec.costUnknown);
    if (isEnvFault(rec)) {
      appendFileSync(faultsFile, JSON.stringify({ ...rec, stoppedBy: 'environment fault' }) + '\n');
      stopped ??= `${rec.sessionError ?? rec.harnessError} at ${sop}:${row}`;
      log(`[sopbench] ${sop}:${row}: environment fault (${rec.sessionError ?? rec.harnessError}); not scored`);
      return;
    }
    if (rec.harnessError && !started) {
      appendFileSync(faultsFile, JSON.stringify({ ...rec, stoppedBy: 'harness error before the session' }) + '\n');
      stopped ??= `harness error at ${sop}:${row}: ${rec.harnessError.slice(0, 200)}`;
      return;
    }
    // Grade (host-side; the answer text is all the session leaves behind). Scripted runs grade in one batch at the end.
    if (deferGrade) { pending.push(rec); return; }
    try {
      const [g] = await gradeAnswers([{ sop, row, text: rec.answerText ?? '' }], { liveDir: live, split: splitFile, sealed: opt.sealed, freeze: opt.freeze, upstream, dataDir, expectedOf });
      rec.grade = g;
    } catch (e) { rec.gradeError = String(e?.message ?? e).slice(0, 500); }
    record(rec);
  });
  if (pending.length) {
    try {
      const gs = await gradeAnswers(pending.map(r => ({ sop: r.sop, row: r.row, text: r.answerText ?? '' })), { liveDir: live, split: splitFile, sealed: opt.sealed, freeze: opt.freeze, upstream, dataDir, expectedOf });
      pending.forEach((r, i) => { r.grade = gs[i]; });
    } catch (e) { for (const r of pending) r.gradeError = String(e?.message ?? e).slice(0, 500); }
    for (const r of pending) record(r);
  }

  // 4. summary
  results.sort((a, b) => jobs.findIndex(j => j.sop === a.sop && j.row === a.row) - jobs.findIndex(j => j.sop === b.sop && j.row === b.row));
  const faults = readRecords(faultsFile);
  const bySop = Object.fromEntries(sops.map(s => {
    const rs = results.filter(r => r.sop === s);
    return [s, { n: rs.length, of: rowsBy[s].length, upstream: mean(rs.map(r => (r.final.upstream ? 1 : 0))), strict: mean(rs.map(r => (r.final.strict ? 1 : 0))),
      costUsd: rs.reduce((x, r) => x + (r.costUsd ?? 0), 0), meanCostUsd: mean(rs.map(r => r.costUsd ?? 0)), meanSteps: mean(rs.map(r => r.steps ?? 0)),
      upstreamOnlyPasses: rs.filter(r => r.final.upstream && !r.final.strict).length, noFinalOutput: rs.filter(r => !/<final_output>/i.test(r.answerText ?? '')).length }];
  }));
  const graded = results.filter(r => r.grade);
  const sopsWithRows = sops.filter(s => bySop[s].n);
  const summary = {
    runId, label: scripted ? `scripted ${opt.policy} (no model)` : `model ${opt.model}`, model: scripted ? null : opt.model, policy: opt.policy ?? null,
    evidence: opt.sealed ? 'SEALED rows (frozen split)' : 'development/diagnostic: SOP-Bench dev rows (SPLIT.json build + repair); not held-out',
    stopped, complete: !stopped && results.length === jobs.length, n: results.length, of: jobs.length,
    upstream: { micro: mean(results.map(r => (r.final.upstream ? 1 : 0))), macro: mean(sopsWithRows.map(s => bySop[s].upstream)) },
    strict: { micro: mean(results.map(r => (r.final.strict ? 1 : 0))), macro: mean(sopsWithRows.map(s => bySop[s].strict)) },
    bySop,
    scorer: { graded: graded.length, jsUpstreamCovered: graded.filter(r => r.grade.jsUpstream !== null).length, jsUpstreamAgree: graded.filter(r => r.grade.agree.upstream === true).length,
      jsUpstreamDisagree: graded.filter(r => r.grade.agree.upstream === false).length, strictAgree: graded.filter(r => r.grade.agree.strict).length, gradeErrors: results.filter(r => r.gradeError).length },
    world: { upstreamFatalRows: results.filter(r => r.world?.upstreamFatal).length, unknownToolRows: results.filter(r => r.world?.unknownTool).length,
      stepLimitRows: results.filter(r => r.world?.stepLimitRefusals).length, meanSteps: mean(results.map(r => r.world?.steps ?? 0)) },
    headlineOverrides: results.filter(r => r.headlineOverride).map(r => ({ sop: r.sop, row: r.row, why: r.headlineOverride })),
    sessionErrors: results.filter(r => r.sessionError || r.harnessError).map(r => ({ sop: r.sop, row: r.row, sessionError: r.sessionError ?? null, harnessError: r.harnessError ?? null })),
    cost: { spentUsd: ledger.spent, perRowUsd: results.length ? results.reduce((x, r) => x + (r.costUsd ?? 0), 0) / results.length : null, unknownCostSessions: ledger.unknown,
      faultSpendUsd: faults.reduce((x, r) => x + (r.costUsd ?? 0), 0), capUsd: scripted ? null : opt.capUsd, budgetUsdPerSession: opt.budgetUsd },
    tokens: scripted ? null : ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'].reduce((o, k) => ({ ...o, [k]: results.reduce((x, r) => x + (r.streamUsage?.[k] ?? 0), 0) }), {}),
    envFaults: { records: faults.length },
    settings: { maxSteps: opt.maxSteps, budgetUsd: opt.budgetUsd, timeoutMin: opt.timeoutMin, effort: opt.effort ?? null, tools: opt.tools, concurrency: opt.concurrency, rowsPerSop: opt.rowsPerSop, excluded: [...exclude] },
    provenance: { upstream: UPSTREAM_PIN, splitSha256: split.splitSha256, bridgeSha256: sha256(readFileSync(BRIDGE)), toolClientSha256: sha256(readFileSync(TOOL_CLIENT)),
      runnerSha256: launch.runnerSha256, scorerSha256: sha256(readFileSync(new URL('./scorer.mjs', import.meta.url))), policyVersion: policy?.policy?.policyVersion ?? null,
      policyHash: policy?.hash ?? null, node: process.version, cli: scripted ? null : cliVersion(), childEnv: Object.fromEntries(CHILD_ENV_ALLOWED.map(k => [k, process.env[k] ?? null])) },
    live, finishedAt: new Date().toISOString(),
  };
  writeJson(path.join(live, 'summary.json'), summary);
  const out = opt.outDir === null ? null : (opt.outDir ?? path.join(RESEARCH, 'runs', runId));
  if (out) {
    mkdirSync(out, { recursive: true });
    cpSync(path.join(live, 'summary.json'), path.join(out, 'summary.json'));
    // CC BY-NC data stays out of git (ACQUISITION.md): the repo gets the aggregate summary only; per-row records (answers,
    // graded values) go to ROWS_ROOT/<run-id>/, outside the repo.
    const rowsDir = path.join(opt.rowsRoot ?? ROWS_ROOT, runId);
    mkdirSync(rowsDir, { recursive: true });
    writeFileSync(path.join(rowsDir, opt.sealed ? 'results.sealed.jsonl' : 'results.jsonl'), results.map(r => JSON.stringify(r)).join('\n') + '\n');
    if (faults.length) writeFileSync(path.join(rowsDir, 'results.faults.jsonl'), faults.map(r => JSON.stringify(r)).join('\n') + '\n');
    summary.copiedTo = out;
    summary.rowsDir = rowsDir;
    writeJson(path.join(out, 'summary.json'), summary);
  }
  if (stopped) log(`[sopbench] STOPPED: ${stopped}. ${results.length}/${jobs.length} rows recorded, $${ledger.spent.toFixed(4)} spent.`);
  return { summary, results, stopped, stopKind: stopped ? (stopped.startsWith('the cap') ? 'cap' : 'environment') : null };
}

function cliVersion() { try { return execFileSync('claude', ['--version'], { encoding: 'utf8', timeout: 30_000 }).trim(); } catch { return null; } }

function parseArgs(argv) {
  const a = {}, flags = new Set(['keep', 'no-copy', 'resume', 'sealed', 'accept-runner-change']);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`unexpected argument ${k}`);
    const name = k.slice(2);
    if (flags.has(name)) a[name] = true; else a[name] = argv[++i];
  }
  return a;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  const num = (v, d) => (v === undefined ? d : Number(v));
  if (a.scripted && !POLICIES.includes(a.scripted)) throw new Error(`--scripted must be one of ${POLICIES.join(', ')}`);
  const { summary, stopped, stopKind } = await runRows({
    model: a.model, policy: a.scripted, capUsd: num(a.cap, undefined), budgetUsd: num(a.budget, DEFAULTS.budgetUsd), concurrency: num(a.concurrency, DEFAULTS.concurrency),
    maxSteps: num(a['max-steps'], DEFAULTS.maxSteps), timeoutMin: num(a['timeout-min'], DEFAULTS.timeoutMin), rowsPerSop: num(a['rows-per-sop'], DEFAULTS.rowsPerSop),
    sops: a.sops ? a.sops.split(',').filter(Boolean) : undefined, exclude: a.exclude !== undefined ? a.exclude.split(',').filter(Boolean) : undefined,
    effort: a.effort, runId: a['run-id'], liveRoot: a.live, outDir: a['no-copy'] ? null : a.out, keep: Boolean(a.keep), resume: Boolean(a.resume),
    acceptRunnerChange: Boolean(a['accept-runner-change']), sealed: Boolean(a.sealed), freeze: a.freeze,
  });
  const { bySop, ...head } = summary;
  process.stdout.write(JSON.stringify({ ...head, bySop }, null, 1) + '\n');
  if (stopped) process.exit(stopKind === 'cap' ? 4 : 3);
}
