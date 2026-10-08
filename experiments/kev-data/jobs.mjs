// Bridge job writer, file router, J0 analysis and laptop-time budget (JUDGE-PROGRAM.md §4.1, §7.4, §7.5;
// JUDGE-BUILD-PLAN.json group served-scorer-jobs). Nothing in this module submits a job on import, and the
// only code path that talks to the laptop bridge is runPlan() with an explicit client and `confirm: true` (CLI:
// `submit --confirm-submit`). bridge/ is imported read-only and lazily, only to validate specs (validateStages)
// and to connect (the CLI). Served reads are experiments/kev-data/score-served.mjs.
//
// A PLAN is an ordered list of STAGES. Bridge-job stages carry exactly the POST /jobs body the daemon will
// validate (kind + params); the others are the steps around them:
//   kev.train | kev.benchmark | kev.serve   a bridge job (params as bridge/laptop/jobs.mjs KINDS)
//   serve.stop                               cancel the running kev.serve of stage `serve`, wait until it is gone
//   score                                    score-served.mjs against that service (all questions of a record in one
//                                            request; role 'latency' = concurrency 1, every request twice: fresh and cached)
//   permute                                  POST /v1/systemone/permute on n items (§6.4 item 4)
//   observe                                  a fact only the laptop agent can give (`free -m`): the runner asks for it
//                                            in a file, it does not guess
// `{{stage-id}}` inside a run reference ("runs/{{J2-5000-s1}}") is replaced by the job id that stage got.
//
//   J0   throughput (§7.4): J0a three training jobs at about 300 / 2K / 8K real tokens, J0b shared_prefix A/B
//        (the plan's cut line), J0k kernel-path probe, J0c served throughput at concurrency 1 and 4
//   J1   stock reads      J2 curve points (nestedPrefixes)      J3 reads of a J2 run      J4 grid      J5 final read
//   the writers:  j0Stages, j1Stages, j2Stage, j2FinalStage, j3Stages, j4Stage, j5Stages, curveStages/finalStages (from a build
//                 directory: buildInfo, readUnits, batteryUnits), assemblePlan
//   the router:   routeFile / routeFiles / routeFromResults: a file goes to kev.benchmark only if every record fits Kev's training
//                 context (kev.model.fits at state 384 / branch 1,024 / packed 2,048); every other file goes to the served scorer
//   checks:       checkSequence (never a second kev.serve, never a GPU job queued while a service runs, one served model at a
//                 time), validateStages (bridge validateParams + buildCommand + the real Kev argparse), checkTrainJob,
//                 checkBenchmarkReport
//   analysis:     analyzeJ0 (seconds per record and per forward token, tokens/s, peak RSS and device bytes, free -m, free disk,
//                 kernel path, served throughput, J0b verdict) -> buildSchedule / renderScheduleTable (the §7.4 table, the priority
//                 order, the reduced plan below 1,500 tokens/s), BudgetTracker, reconcileJ2 (after J2 at 5K)
//
// Assumptions recorded where they are made; the ones that resolve program ambiguities are listed in the header of
// test/served-scorer-jobs.test.mjs and in the final report of the group.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FoundryError } from '../../src/data.mjs';
import { canonical, sha256 } from './lib/hash.mjs';
import { HF_HOME, KEV, PYTHON, TOKENIZER, checkKevPin, kevBatch, measureRecords, validateKevFile } from './lib/tokens.mjs';

const fail = (code, message, details) => new FoundryError(code, message, details);
const round = (x, d = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

// ---- pins and the recipe (§7.1, §7.2) ------------------------------------------------------------------------------

export const PINS = Object.freeze({
  kevCommit: KEV.commit,
  base: TOKENIZER.repo, baseRevision: TOKENIZER.revision,
  initFrom: 'jaredpalmer/kev-0.8b@v1.0',
  replaySuite: 'evals/v7/decision-v7', replaySuiteRepo: 'jaredpalmer/kev-suites@cc4bac803e73112689ec327ffa481c519cbc7a05'
});
// Kev records `suite_sha256` = sha256 of the suite's manifest.json (kev.suite.digest) in training_config.json; the expected value is
// the manifest of the pinned checkout, so a laptop checkout with another suite is caught (acceptance: "checks its hash").
export function suiteSha256(kevRoot = KEV.root, suite = PINS.replaySuite) {
  const file = path.join(kevRoot, suite, 'manifest.json');
  return existsSync(file) ? sha256(readFileSync(file)) : null;
}
// lora_targets all, head_dim 256, p_none 0.1, p_none_distract 0.12 and p_distract 0.15 are Kev's own defaults
// at the pinned commit (kev/train.py); head_dim, p_none* and p_distract are not bridge parameters.
export const RECIPE = Object.freeze({ epochs: 1, lr: 2e-5, batch: 1, accum: 8, dtype: 'bf16', checkpointing: 1, lora: 16, replay: 2000, pNonePair: 0.25, seed: 1, loraTargets: 'all', longRowBudget: 16384 });
export const POINT_ROWS = Object.freeze({ '2.5K': 2500, '5K': 5000, '10K': 10000, '20K': 20000, '40K': 40000 });
export const CURVE_POINTS = Object.freeze(['2.5K', '5K', '10K', '20K']);
// §4.1 token model [E crit-G]: forward tokens per requested training row and per replay record.
export const TOKEN_MODEL = Object.freeze({ perRow: 800, perReplay: 500 });
export const GRID = Object.freeze({
  lr4: { label: 'lr4', change: { lr: 4e-5 } },
  ep2: { label: 'ep2', change: { epochs: 2 } },
  rp6: { label: 'rp6', change: { extra: { replay: 6000 } } },
  np0: { label: 'np0', change: { extra: { p_none_pair: 0 } } }
});
const J0_CLASSES = Object.freeze({
  '0300': { tokens: 300, records: 400, maxSteps: 50, long: false },
  '2k': { tokens: 2000, records: 400, maxSteps: 30, long: true },
  '8k': { tokens: 8000, records: 120, maxSteps: 10, long: true, weightsDtype: 'bf16' }
});
export const J0_DATA = Object.freeze({
  ...J0_CLASSES,
  '0300-q4': { tokens: 300, records: 400, questions: 4 },
  kernel: { tokens: 200, records: 16 }
});

// ---- deterministic pseudo-randomness (no Math.random, no clock) -------------------------------------------------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const seedOf = text => parseInt(sha256(String(text)).slice(0, 8), 16);

// ---- J0 data: throughput-only records of a requested real-token length ---------------------------------------------
// Log-line states with questions whose label is read off the lines by a scan (generator truth). These files
// measure speed only: placeholder-grade content, never training data, never read for quality, and the
// checkpoints of the jobs that train on them (runs/<jobId>) are throwaway.

export const SERVICES = Object.freeze(['ledger', 'billing', 'gateway', 'search', 'inventory', 'notifier', 'scheduler', 'mailer', 'catalog', 'sessions', 'exporter', 'indexer']);
export const LEVELS = Object.freeze(['DEBUG', 'INFO', 'WARN', 'ERROR']);
const MESSAGES = Object.freeze({
  DEBUG: ['pool stats active={a} idle={b}', 'heartbeat ok peer={p}', 'config reload skipped no change rev={r}', 'gc pause {a}ms heap={b}MB'],
  INFO: ['request completed route=/v2/orders status=200 bytes={a}', 'cache hit key=cust-{a} ttl=300', 'job scheduled id=j-{a} queue=default', 'session opened user=u{a} region=eu-{b}', 'export finished rows={a} file=part-{b}.csv', 'index segment merged seg={a} docs={b}'],
  WARN: ['retrying upstream call attempt={b} backoff=400ms host=h-{p}', 'slow query table=orders rows={a}', 'queue depth {a} above soft limit', 'certificate expires in {b} days host=h-{p}'],
  ERROR: ['upstream timeout after 5000ms host=db-{p}', 'write failed disk quota exceeded vol=vol-{b}', 'unhandled exception code=E{a} retry=false', 'checksum mismatch part={a} expected={b}']
});
const pad2 = n => String(n).padStart(2, '0');

// One log line. `i` orders the timestamps; `pad` appends that many one-token filler words before the latency
// field (the fine adjustment that lands a record on its token target; a line alone is about 45 tokens).
const FILLER = Object.freeze(['the', 'and', 'of', 'to', 'in', 'is', 'it', 'for', 'on', 'as', 'at', 'by', 'be', 'or', 'an', 'if', 'we', 'so', 'do', 'no', 'up', 'out', 'new', 'old', 'one', 'two', 'all', 'any', 'can', 'not', 'but', 'was', 'are', 'has', 'had', 'its', 'our', 'who', 'how', 'now']);
function logLine(rng, i, level, service, latency, pad = 0, padRng = rng) {
  const pick = a => a[Math.floor(rng() * a.length)];
  const fill = tpl => tpl.replace(/\{(\w)\}/g, (_, k) => (k === 'p' ? String(1 + Math.floor(rng() * 9)) : String(1 + Math.floor(rng() * (k === 'b' ? 97 : 9800)))));
  const sec = i * 3 + Math.floor(rng() * 3), h = Math.floor(sec / 3600) % 24, m = Math.floor(sec / 60) % 60, s = sec % 60;
  const id = Math.floor(rng() * 0xffffff).toString(16).padStart(6, '0');
  const filler = Array.from({ length: pad }, () => FILLER[Math.floor(padRng() * FILLER.length)]).join(' ');   // its own stream: the other lines do not change with the pad
  return `2026-10-07T${pad2(h)}:${pad2(m)}:${pad2(s)}Z ${service} ${level} ${fill(pick(MESSAGES[level]))}${filler ? ` ${filler}` : ''} latency=${latency}ms id=${id}`;
}
// A log of n lines (the first line carries `pad` filler words). The first ERROR and one WARN are placed up front,
// so every question has an answer.
export function makeLog(seedText, n, pad = 0) {
  const rng = mulberry32(seedOf(seedText)), plan = [];
  const firstError = Math.min(n - 1, Math.floor(rng() * Math.min(n - 1, 12)) + (n > 14 ? 2 : 0));
  const warnAt = (firstError + 1 + Math.floor(rng() * Math.max(1, n - 1))) % n;
  for (let i = 0; i < n; i++) {
    const r = rng();
    let level = r < 0.10 ? 'DEBUG' : r < 0.80 ? 'INFO' : r < 0.95 ? 'WARN' : 'ERROR';
    if (i < firstError && level === 'ERROR') level = 'INFO';
    if (i === firstError) level = 'ERROR';
    else if (i === warnAt) level = 'WARN';
    plan.push({ level, service: SERVICES[Math.floor(rng() * SERVICES.length)], latency: 5 + Math.floor(rng() * 900) });
  }
  const top = Math.max(...plan.map(l => l.latency)), tops = plan.filter(l => l.latency === top);
  if (tops.length > 1) tops[0].latency = top + 1;                                  // a unique slowest line
  const padRng = mulberry32(seedOf(`${seedText}/pad`));
  return plan.map((l, i) => logLine(rng, i, l.level, l.service, l.latency, i === 0 ? pad : 0, padRng));
}
const parseLine = line => { const m = /^\S+ (\S+) (DEBUG|INFO|WARN|ERROR) .* latency=(\d+)ms id=\w+$/.exec(line); if (!m) throw fail('J0_DATA', `unparseable log line ${JSON.stringify(line.slice(0, 80))}`); return { service: m[1], level: m[2], latency: Number(m[3]) }; };

// The answers, read off the lines (a second path: the generator never states them).
export function scanLog(lines) {
  const p = lines.map(parseLine);
  const firstError = p.find(x => x.level === 'ERROR'), lastWarn = [...p].reverse().find(x => x.level === 'WARN');
  const top = Math.max(...p.map(x => x.latency)), slowest = p.filter(x => x.latency === top);
  if (!firstError || !lastWarn || slowest.length !== 1) throw fail('J0_DATA', 'a log needs an ERROR line, a WARN line and a unique slowest line');
  return { firstErrorService: firstError.service, lastWarnService: lastWarn.service, slowestService: slowest[0].service, lastLevel: p.at(-1).level };
}

// options: the truth plus three other services, in an order fixed by the record's seed
function serviceOptions(rng, truth) {
  const others = SERVICES.filter(s => s !== truth), picked = [];
  while (picked.length < 3) picked.push(others.splice(Math.floor(rng() * others.length), 1)[0]);
  const all = [truth, ...picked];
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  return Object.fromEntries(all.map(s => [s, '']));
}
const QUESTIONS = Object.freeze([
  { id: 'first_error', text: 'Which service logged the first ERROR line?', truth: s => s.firstErrorService, options: 'service' },
  { id: 'last_warn', text: 'Which service logged the last WARN line?', truth: s => s.lastWarnService, options: 'service' },
  { id: 'slowest', text: 'Which service logged the line with the highest latency?', truth: s => s.slowestService, options: 'service' },
  { id: 'last_level', text: 'What is the level of the final log line?', truth: s => s.lastLevel, options: 'level' }
]);

export function probeRecord({ id, lines, seedText, questions = 1 }) {
  const truth = scanLog(lines), rng = mulberry32(seedOf(`${seedText}/options`));
  const qs = {};
  for (const q of QUESTIONS.slice(0, questions)) {
    qs[q.id] = { type: 'choice', instructions: q.text, criteria: q.options === 'level' ? Object.fromEntries(LEVELS.map(l => [l, ''])) : serviceOptions(rng, q.truth(truth)), label: q.truth(truth), src: 'j0_probe' };
  }
  return { state: { system: `ATLAS-${pad2(1 + (seedOf(seedText) % 90))}`, log: lines.join('\n') }, questions: qs, _meta: { id } };
}

// Records whose rendered state has a requested number of real Qwen3.5 tokens (the <state> token included,
// as kev.model.fits counts it), within `tolerance`. Line counts are adjusted from measured token counts; the
// answers are re-read off the final lines, so adjusting never changes what is true. `measure` defaults to the
// pinned tokenizer through /opt/kev-venv (one Python process per pass).
export function buildProbeRecords({ prefix, targets, questions = 1, tolerance = 0.02, measure = records => measureRecords(records, { maxState: 8192 }), maxPasses = 10, perLine = 45 }) {
  const n = targets.length, lines = targets.map(t => Math.max(2, Math.floor(t / perLine))), pad = targets.map(() => 0);
  const make = i => probeRecord({ id: `${prefix}/${i}`, lines: makeLog(`${prefix}/${i}`, lines[i], pad[i]), seedText: `${prefix}/${i}`, questions });
  const records = Array.from({ length: n }, (_, i) => make(i)), results = measure(records);
  const off = () => results.map((r, i) => i).filter(i => !results[i].ok || Math.abs(results[i].stateTokens - targets[i]) > tolerance * targets[i]);
  for (let pass = 0; pass < maxPasses; pass++) {
    const todo = off();
    if (!todo.length) break;
    for (const i of todo) {
      const have = results[i].stateTokens, gap = targets[i] - have, avg = Math.max(1, (have - pad[i]) / lines[i]);
      if (gap < 0 && pad[i] >= -gap) pad[i] += gap;                                   // too long: shed filler first
      else if (gap < 0) { lines[i] = Math.max(2, lines[i] - Math.max(1, Math.floor(-gap / avg))); pad[i] = 0; }
      else if (gap >= avg) lines[i] += Math.floor(gap / avg);                          // too short by a line or more
      else pad[i] += gap;
    }
    const redo = todo.map(i => make(i)), redoResults = measure(redo);
    todo.forEach((i, k) => { records[i] = redo[k]; results[i] = redoResults[k]; });
  }
  const bad = off();
  if (bad.length) throw fail('J0_DATA', `${bad.length} of ${n} records are off their token target by more than ${tolerance * 100}% after ${maxPasses} passes`);
  return { records, stateTokens: results.map(r => r.stateTokens), results };
}

// The J0 files, deterministically: j0-0300, j0-2k, j0-8k (one question per record: a record is a row), j0-0300-q4
// (the same states with four questions each, for the shared_prefix A/B) and j0-kernel (16 short records for the
// kernel-path probe). Returns the manifest {name: {file, sha256, records, stateTokens: {min, mean, max}, questions}}.
export function buildJ0Data({ dir, only = null, measure } = {}) {
  mkdirSync(dir, { recursive: true });
  const out = {};
  for (const [klass, def] of Object.entries(J0_DATA)) {
    if (only && !only.includes(klass)) continue;
    const questions = def.questions ?? 1, targets = Array(def.records).fill(def.tokens);
    const { records, stateTokens } = buildProbeRecords({ prefix: `j0/${klass}`, targets, questions, ...(measure ? { measure } : {}) });
    const name = `j0-${klass}.jsonl`, file = path.join(dir, name), body = records.map(r => JSON.stringify(r)).join('\n') + '\n';
    writeFileSync(file, body);
    out[klass] = { name, file, sha256: sha256(body), bytes: Buffer.byteLength(body), records: records.length, questionsPerRecord: questions,
      stateTokens: { min: Math.min(...stateTokens), mean: round(stateTokens.reduce((a, b) => a + b, 0) / stateTokens.length, 1), max: Math.max(...stateTokens) } };
  }
  return out;
}

// ---- the file router (§7.4 J1, §7.5) ------------------------------------------------------------------------------

export const TRAINING_CONTEXT = Object.freeze({ maxState: 384, maxBranch: 1024, maxPacked: 2048 });
// kev.benchmark --data scores a record only if it encodes strictly inside Kev's training context (state 384,
// branch 1,024, packed 2,048 tokens: kev.suite.CONTEXT) and counts every other record in
// coverage.rejected_records while the job still succeeds. So a file goes to kev.benchmark only if EVERY record
// passes kev.model.fits() at that context (the state test, plus the branch and packed limits the benchmark also
// enforces); any other file goes to the served scorer, which reads states to 65,536 tokens.
export function routeFromResults(results, { file = null } = {}) {
  if (!Array.isArray(results) || !results.length) throw fail('ROUTE_INVALID', `${file ?? 'the file'} has no records`);
  const broken = results.filter(r => !r.ok);
  if (broken.length) throw fail('ROUTE_INVALID', `${broken.length} record(s) do not load as Kev requests (first: ${broken[0].error})`);
  const over = results.filter(r => !r.fits), states = results.map(r => r.stateTokens);
  const route = over.length === 0 ? 'benchmark' : 'served';
  return {
    route, records: results.length, fitting: results.length - over.length, overflowing: over.length,
    maxStateTokens: Math.max(...states), over384: results.filter(r => r.stateTokens > TRAINING_CONTEXT.maxState).length,
    reason: route === 'benchmark'
      ? `every record fits the training context (${TRAINING_CONTEXT.maxState} state / ${TRAINING_CONTEXT.maxBranch} branch / ${TRAINING_CONTEXT.maxPacked} packed tokens)`
      : `${over.length} of ${results.length} records exceed the training context (largest state ${Math.max(...states)} tokens): kev.benchmark would reject them, so the file is scored through kev.serve`
  };
}
const needFile = file => { if (!existsSync(file)) throw fail('ROUTE_INVALID', `${file} does not exist`); };
export function routeFile(file, { measure = validateKevFile } = {}) {
  needFile(file);
  let loaded;
  try { loaded = measure(file, { maxState: TRAINING_CONTEXT.maxState }); }
  catch (error) { throw fail('ROUTE_INVALID', `${file} does not load as a Kev file: ${String(error.message).replace(/^KEV_PYTHON: /, '').slice(0, 300)}`); }
  return { file, ...routeFromResults(loaded.results, { file }), sha256: sha256(readFileSync(file)) };
}
// Many files, one Python process (Kev's import costs seconds): [{file, route, ...}] in the order given.
export function routeFiles(files, { batch = kevBatch } = {}) {
  if (!files.length) return [];
  files.forEach(needFile);
  let loaded;
  try { loaded = batch(files.map(file => ({ op: 'load_file', path: file, maxState: TRAINING_CONTEXT.maxState }))); }
  catch (error) { throw fail('ROUTE_INVALID', `a file does not load as a Kev file: ${String(error.message).replace(/^KEV_PYTHON: /, '').slice(0, 300)}`); }
  return files.map((file, i) => ({ file, ...routeFromResults(loaded[i].results, { file }), sha256: sha256(readFileSync(file)) }));
}
export function routeRecords(records, { measure = measureRecords } = {}) {
  return routeFromResults(measure(records, { maxState: TRAINING_CONTEXT.maxState }));
}

// ---- stages ---------------------------------------------------------------------------------------------------------

const REF = /\{\{([A-Za-z0-9._-]+)\}\}/g;
export const refsOf = value => [...JSON.stringify(value ?? null).matchAll(REF)].map(m => m[1]);
const hubRun = run => /^jaredpalmer\/kev-[0-9.]+b(@v[0-9.]+)?$/.test(run);
// content-addressed names: the same file is uploaded once, different content never collides
export const remoteName = (sha, hint = 'read') => `data/${hint.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 40) || 'read'}-${String(sha).replace(/^sha256:/, '').slice(0, 12)}.jsonl`;

const trainParams = ({ dataset, maxState, extra = {}, ...over }) => ({
  dataset, base: PINS.base, initFrom: PINS.initFrom, epochs: RECIPE.epochs, lr: RECIPE.lr, batch: RECIPE.batch, accum: RECIPE.accum, dtype: RECIPE.dtype,
  maxState, checkpointing: RECIPE.checkpointing, lora: RECIPE.lora, ...over, extra: { base_revision: PINS.baseRevision, ...extra }
});
const fileOf = (entry, remote) => ({ local: entry.file, remote, sha256: entry.sha256 ?? null, bytes: entry.bytes ?? null });

// J0 data manifest used when the files are not built yet (spec validation, schedules): the names, no digests.
export const unbuiltJ0Data = () => Object.fromEntries(Object.entries(J0_DATA).map(([k, d]) => [k, { name: `j0-${k}.jsonl`, file: `j0/j0-${k}.jsonl`, sha256: null, bytes: null, records: d.records, questionsPerRecord: d.questions ?? 1 }]));

export function j0Stages({ data = unbuiltJ0Data(), port = 8008, concurrency = [1, 4], includeJ0b = true } = {}) {
  const stages = [];
  const up = (klass) => [fileOf(data[klass], `data/${data[klass].name}`)];
  stages.push({ id: 'J0-observe-host', job: 'J0', kind: 'observe', observe: 'free-m',
    request: 'On the laptop, with kev.serve stopped and no training running, run `free -m` and save the output to observations/free-m.txt in the plan directory (the bridge has no job that reports free memory).', file: 'observations/free-m.txt', needs: [] });
  for (const [klass, def] of Object.entries(J0_CLASSES)) {
    const extra = { max_steps: def.maxSteps, seed: RECIPE.seed, suite: PINS.replaySuite, replay: 50 };
    if (def.long) { extra.row_budget = RECIPE.longRowBudget; extra.length_sort = 1; }
    if (def.weightsDtype) extra.weights_dtype = def.weightsDtype;        // the long-state probe only, never a curve point (§7.2)
    stages.push({ id: `J0a-${klass}`, job: 'J0a', kind: 'kev.train', params: trainParams({ dataset: `data/${data[klass].name}`, maxState: 8192, extra }), files: up(klass), needs: [], budgetStep: 'J0',
      fetch: ['training_metrics.json', 'training_config.json'], accept: { kind: 'train', fileRecords: data[klass].records, replay: 50, throughputProbe: true } });
  }
  if (includeJ0b) {
    // J0b (the plan's cut line): the same 4-question records with shared_prefix 0 and 1. Adopt if >= 1.5x faster and the
    // 50-step losses match within 1%. Both arms are run on one file, so the comparison is between arms, not between files.
    for (const [arm, sp] of [['A', 0], ['B', 1]]) {
      const extra = { max_steps: J0_CLASSES['0300'].maxSteps, seed: RECIPE.seed, suite: PINS.replaySuite, replay: 50, shared_prefix: sp };
      stages.push({ id: `J0b-${arm}`, job: 'J0b', kind: 'kev.train', params: trainParams({ dataset: `data/${data['0300-q4'].name}`, maxState: 8192, extra }), files: up('0300-q4'), needs: [], budgetStep: 'J0',
        fetch: ['training_metrics.json', 'training_config.json'], accept: { kind: 'train', fileRecords: data['0300-q4'].records, replay: 50, throughputProbe: true } });
    }
  }
  // kernel-path probe: kev.benchmark records its kernel environment (packages, the DeltaNet forward) in report.json
  stages.push({ id: 'J0k-kernels', job: 'J0k', kind: 'kev.benchmark', params: { run: PINS.initFrom, data: `data/${data.kernel.name}`, rotations: 1 }, files: up('kernel'), needs: [], budgetStep: 'J0',
    fetch: ['report.json'], accept: { kind: 'benchmark' } });
  // J0c: stock kev.serve, then the served scorer on the 300- and 2K-token files at each concurrency; then stop
  stages.push({ id: 'J0c-serve', job: 'J0c', kind: 'kev.serve', params: { run: PINS.initFrom, port }, needs: [] });
  for (const klass of ['0300', '2k']) for (const c of concurrency) {
    stages.push({ id: `J0c-score-${klass}-c${c}`, job: 'J0c', kind: 'score', serve: 'J0c-serve', data: data[klass].file, dataSha256: data[klass].sha256 ?? null, rows: `rows/J0c-${klass}-c${c}.jsonl`,
      concurrency: c, expectRun: PINS.initFrom, reread: 0, needs: ['J0c-serve'], budgetStep: 'J0' });
  }
  stages.push({ id: 'J0c-stop', job: 'J0c', kind: 'serve.stop', serve: 'J0c-serve', needs: ['J0c-serve'] });
  return stages;
}

// One read of a set of files by one model: benchmark-routed files first (no service running), then one
// kev.serve for all served files, then stop. `reads`: [{id, file, sha256, bytes?, route?, role?}] with the route
// already decided (routeFile) or decided here with `router`. A unit with role 'latency' (the LAT gate, §6.5: fresh and
// cached p50/p90 at concurrency 1) or 'permute' (§6.4 item 4: /permute flip rate on 200 items) needs the service,
// whatever its size, and is never routed to kev.benchmark.
export function readStages({ tag, run, reads, router = routeFile, port = 8008, concurrency = 4, expectRun = run, budgetStep = null }) {
  const stages = [], bench = [], served = [];
  for (const r of reads) {
    const route = r.role ? { route: 'served', reason: `a ${r.role} read needs the service` } : (r.route ?? router(r.file));
    (route.route === 'benchmark' ? bench : served).push({ ...r, routeInfo: route });
  }
  const pathFor = r => ({ local: r.file, remote: remoteName(r.sha256 ?? sha256(readFileSync(r.file)), r.id), sha256: r.sha256 ?? null, bytes: r.bytes ?? null });
  const job = tag.split('-')[0];
  for (const r of bench) {
    const f = pathFor(r);
    stages.push({ id: `${tag}-bench-${r.id}`, job, kind: 'kev.benchmark', params: { run, data: f.remote, rotations: 1 }, files: [f], needs: [], fetch: ['report.json', 'rows.json'],
      accept: { kind: 'benchmark' }, budgetStep, read: { id: r.id, route: 'benchmark', reason: r.routeInfo.reason } });
  }
  if (served.length) {
    const serveId = `${tag}-serve`;
    stages.push({ id: serveId, job, kind: 'kev.serve', params: { run, port }, needs: [] });
    for (const r of served) {
      const common = { id: `${tag}-${r.role ?? 'score'}-${r.id}`, job, serve: serveId, data: r.file, dataSha256: r.sha256 ?? null, expectRun, needs: [serveId], budgetStep, read: { id: r.id, route: 'served', role: r.role ?? null, reason: r.routeInfo.reason } };
      if (r.role === 'permute') stages.push({ ...common, kind: 'permute', out: `rows/${tag}/${r.id}.permute.json`, n: r.n ?? 200, nPerm: r.nPerm ?? 6 });
      else stages.push({ ...common, kind: 'score', rows: `rows/${tag}/${r.id}.jsonl`, concurrency: r.role === 'latency' ? 1 : concurrency, repeat: r.role === 'latency' ? 2 : 1, reread: r.reread ?? 0 });
    }
    stages.push({ id: `${tag}-stop`, job, kind: 'serve.stop', serve: serveId, needs: [serveId] });
  }
  return stages;
}

export const j1Stages = ({ reads, ...opts }) => readStages({ tag: 'J1', run: PINS.initFrom, reads, budgetStep: 'J1', ...opts });
// J3: the J1 reads with run = runs/<J2 jobId> of the stage that trained it
export const j3Stages = ({ of, reads, ...opts }) => readStages({ tag: `J3-${of.replace(/^J[24]-/, '')}`, run: `runs/{{${of}}}`, reads, budgetStep: `read:${of}`, ...opts });
// J5: stock then candidate, never concurrent (each block stops its service before the next block starts)
export function j5Stages({ reads, candidate, ...opts }) {
  if (!/^runs\/(j-\d{8}-\d{6}-[0-9a-f]{6}|\{\{[A-Za-z0-9._-]+\}\})$/.test(candidate ?? '')) throw fail('PLAN_CANDIDATE', 'J5 reads the candidate run: runs/<jobId> (or a {{stage}} reference)');
  return [...readStages({ tag: 'J5-stock', run: PINS.initFrom, reads, budgetStep: 'J5', ...opts }), ...readStages({ tag: 'J5-candidate', run: candidate, reads, budgetStep: 'J5', ...opts })];
}

// J2 / J4: one training stage. `train` = {file, sha256, bytes, records (file records), rows}. `maxState` is the build's
// job maxState (p99.9 of real state tokens, clamped to [384, 8192]).
export function trainStage({ id, job = 'J2', train, maxState, seed = RECIPE.seed, change = {}, longStates = false, needs = [] }) {
  if (!Number.isInteger(maxState)) throw fail('PLAN_MAXSTATE', 'a training stage needs the build\'s job maxState');
  const extra = { seed, suite: PINS.replaySuite, replay: RECIPE.replay, p_none_pair: RECIPE.pNonePair, lora_targets: RECIPE.loraTargets, ...(change.extra ?? {}) };
  if (longStates) { extra.row_budget = RECIPE.longRowBudget; extra.length_sort = 1; }                  // states over 2K real tokens (§7.2)
  const { extra: _drop, ...rest } = change;
  const params = trainParams({ dataset: remoteName(train.sha256 ?? sha256(readFileSync(train.file)), `train-${train.rows ?? train.records}`), maxState, extra, ...rest });
  const replay = params.extra.replay;
  return { id, job, kind: 'kev.train', params, files: [{ local: train.file, remote: params.dataset, sha256: train.sha256 ?? null, bytes: train.bytes ?? null }], needs, budgetStep: id,
    fetch: ['training_metrics.json', 'training_config.json'],
    accept: { kind: 'train', fileRecords: train.records, replay, rows: train.rows ?? null, datasetSha256: train.sha256 ?? null, parentSha256: train.parentSha256 ?? null, epochs: params.epochs, initFrom: params.initFrom, baseRevision: PINS.baseRevision, maxState },
    plan: { rows: train.rows ?? train.records, replay, epochs: params.epochs } };
}
export const j2Stage = ({ point, seed = RECIPE.seed, train, maxState, longStates = false }) => trainStage({ id: `J2-${POINT_ROWS[point] ?? point}-s${seed}`, job: 'J2', train, maxState, seed, longStates });
export const j4Stage = ({ config, train, maxState, longStates = false }) => {
  const g = GRID[config];
  if (!g) throw fail('PLAN_GRID', `unknown grid config ${config}; known: ${Object.keys(GRID).join(', ')}`);
  return trainStage({ id: `J4-${g.label}`, job: 'J4', train, maxState, seed: RECIPE.seed, change: g.change, longStates });
};

// The final retrain at the N the curve selects, with the winning grid config's change (null = base): the step the budget calls J2-final.
export const j2FinalStage = ({ train, maxState, config = null, longStates = false, seed = RECIPE.seed }) => {
  if (config !== null && !GRID[config]) throw fail('PLAN_GRID', `unknown grid config ${config}; known: ${Object.keys(GRID).join(', ')}`);
  return trainStage({ id: 'J2-final', job: 'J2', train, maxState, seed, change: config ? GRID[config].change : {}, longStates });
};

// Nested curve files (§4.4: each larger set contains the smaller one in the same seed order). The train file is
// assumed to be in the assembler's order; point N takes the longest prefix whose question rows are <= N. The
// files are byte prefixes of one another by construction; shortfalls (a train file with fewer rows than a
// point) and inexact rows are reported, never padded.
export function nestedPrefixes(trainFile, { points = CURVE_POINTS, outDir, names = (rows) => `train-${rows}.jsonl` } = {}) {
  const text = readFileSync(trainFile, 'utf8'), lines = text.split('\n').filter(l => l.trim());
  const rowsOfLine = l => Object.keys(JSON.parse(l).questions).length;
  const per = lines.map(rowsOfLine), cum = []; let acc = 0;
  for (const n of per) cum.push((acc += n));
  mkdirSync(outDir, { recursive: true });
  const out = [];
  for (const point of points) {
    const target = POINT_ROWS[point] ?? Number(point);
    let k = 0; while (k < lines.length && cum[k] <= target) k++;
    const body = k ? lines.slice(0, k).join('\n') + '\n' : '', rows = k ? cum[k - 1] : 0, file = path.join(outDir, names(target));
    writeFileSync(file, body);
    out.push({ point, targetRows: target, rows, records: k, exact: rows === target, shortfall: acc < target, file, sha256: sha256(body), bytes: Buffer.byteLength(body), parentSha256: sha256(text) });
  }
  for (let i = 1; i < out.length; i++) if (!readFileSync(out[i].file, 'utf8').startsWith(readFileSync(out[i - 1].file, 'utf8'))) throw fail('PLAN_NESTED', `${out[i].point} does not contain ${out[i - 1].point} as a prefix`);
  return out;
}

// ---- from a build directory (build.mjs) and from Kev's own suites ---------------------------------------------------------
// The build manifest names every slice file and its digest; a file whose bytes differ from the manifest is refused (the dataset
// sha256 that reaches the laptop is the build's). Files are hashed here, never opened as records (test slices stay unread).
export function buildInfo(buildDir) {
  const manifestFile = path.join(buildDir, 'manifest.json');
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestFile, 'utf8')); } catch (error) { throw fail('PLAN_BUILD', `cannot read ${manifestFile}: ${error.code ?? error.message}`); }
  if (manifest.schema !== 'kev-data/build@1') throw fail('PLAN_BUILD', `${manifestFile} is not a kev-data build manifest`);
  if (!Number.isInteger(manifest.jobMaxState)) throw fail('PLAN_BUILD_UNMEASURED', 'the build was made without real-token measurement (no jobMaxState); a training job needs the build\'s p99.9');
  const slices = {};
  for (const [slice, def] of Object.entries(manifest.slices ?? {})) {
    const file = path.join(buildDir, def.files.kev.path), body = readFileSync(file), digest = sha256(body);
    if (`sha256:${digest}` !== def.files.kev.sha256) throw fail('PLAN_BUILD_DIGEST', `${def.files.kev.path}: sha256 ${digest} differs from the manifest's ${def.files.kev.sha256}`);
    slices[slice] = { id: slice, file, sha256: digest, bytes: body.length, records: def.records, questions: def.questions };
  }
  const tokenMax = Math.max(0, ...Object.values(manifest.slices?.train?.perPort ?? {}).map(p => p.stateTokens?.max ?? 0));
  return { buildId: manifest.buildId, manifest, slices, jobMaxState: manifest.jobMaxState, longStates: tokenMax > 2048, maxStateTokens: tokenMax, dir: buildDir };
}
export function readUnits(info, ids) {
  return ids.map(id => { const s = info.slices[id]; if (!s) throw fail('PLAN_BUILD', `the build has no ${id} slice`); return { id, file: s.file, sha256: s.sha256, bytes: s.bytes, records: s.records }; });
}
// The forgetting battery's files (§3.6, §6.4): Kev's own development partitions, read from the checkout at the pinned
// commit. test.jsonl is "one read, ever": refused here by name.
export const BATTERY_FILES = Object.freeze([
  { id: 'battery-decision-v7', file: 'evals/v7/decision-v7/development.jsonl', note: 'reported, flagged in-distribution (replay draws from decision-v7 train)' },
  { id: 'battery-transfer-v4', file: 'evals/v4/transfer-v4/development.jsonl', note: 'mandatory, never replayed' },
  { id: 'battery-hard-v1', file: 'evals/hard-v1/development.jsonl', note: 'mandatory, never replayed' }
]);
export function batteryUnits({ kevRoot = KEV.root, files = BATTERY_FILES } = {}) {
  return files.map(f => {
    if (/(^|[\\/])test\.jsonl$/.test(f.file)) throw fail('PLAN_BATTERY_TEST', `${f.file}: Kev's test partitions are never read ("one read, ever")`);
    const file = path.join(kevRoot, f.file), body = readFileSync(file);
    return { id: f.id, file, sha256: sha256(body), bytes: body.length, records: body.toString('utf8').split('\n').filter(Boolean).length, note: f.note };
  });
}
// The curve and the grid as stages (J2 with its J3 reads, seed 2 at 5K and 20K, J4), from a build and its nested files.
// dev-select is read at 5K, 20K and 40K only (§4.3); every point also reads the battery.
// sha256 -> route for the units that carry none. The default router batches (one Python process); a test double is called per file.
function preRoute(units, router) {
  const todo = [...new Map(units.filter(u => !u.route).map(u => [u.sha256, u])).values()];
  const routes = router === routeFile ? routeFiles(todo.map(u => u.file)) : todo.map(u => router(u.file));
  return new Map(todo.map((u, i) => [u.sha256, routes[i]]));
}
export function curveStages({ info, nested, battery = [], router = routeFile, seeds = { '5K': [1, 2], '20K': [1, 2], '2.5K': [1], '10K': [1] }, grid = true }) {
  const routes = preRoute([...readUnits(info, ['calib-ood', 'dev-select', 'dev-ood']), ...battery], router);      // each file is routed once, however many models read it
  const routed = u => ({ ...u, route: u.route ?? routes.get(u.sha256) });
  const reads = rows => [...readUnits(info, ['calib-ood', ...(rows === 5000 || rows === 20000 || rows === 40000 ? ['dev-select'] : []), 'dev-ood']), ...battery].map(routed);
  const stages = [], by = Object.fromEntries(nested.map(n => [n.point, n]));
  for (const point of CURVE_POINTS) {
    const n = by[point];
    if (!n) throw fail('PLAN_BUILD', `no nested file for the ${point} point`);
    if (n.parentSha256 !== info.slices.train.sha256) throw fail('PLAN_NESTED_PARENT', `the ${point} file was cut from a train file that is not the build's (sha256 ${n.parentSha256})`);
    for (const seed of seeds[point] ?? [1]) {
      const stage = j2Stage({ point, seed, train: { file: n.file, sha256: n.sha256, bytes: n.bytes, records: n.records, rows: n.rows, parentSha256: n.parentSha256 }, maxState: info.jobMaxState, longStates: info.longStates });
      stages.push(stage, ...j3Stages({ of: stage.id, reads: reads(n.targetRows), router }));
    }
  }
  if (grid) for (const config of Object.keys(GRID)) {
    const n = by['5K'], stage = j4Stage({ config, train: { file: n.file, sha256: n.sha256, bytes: n.bytes, records: n.records, rows: n.rows, parentSha256: n.parentSha256 }, maxState: info.jobMaxState, longStates: info.longStates });
    stages.push(stage, ...j3Stages({ of: stage.id, reads: reads(5000), router }));
  }
  return stages;
}
// J5: test-in, test-OOD and calib-in, the permutation read and the latency read, stock then candidate.
export function finalStages({ info, candidate, permuteFile, latencyFile, router = routeFile, ...opts }) {
  const units = readUnits(info, ['test-in', 'test-ood', 'calib-in']), routes = preRoute(units, router);
  const reads = units.map(u => ({ ...u, route: routes.get(u.sha256) }));
  const extra = [permuteFile && { ...permuteFile, id: 'permute', role: 'permute' }, latencyFile && { ...latencyFile, id: 'latency', role: 'latency' }].filter(Boolean);
  return j5Stages({ reads: [...reads, ...extra], candidate, router, ...opts });
}

// ---- the sequence check: one service at a time, nothing queued behind it -------------------------------------------

export class SequenceError extends FoundryError {}
const GPU_KINDS = new Set(['kev.train', 'kev.benchmark', 'sys.selftest']);
// Simulates the daemon's state over the plan. Violations: a kev.serve while a service runs (the daemon refuses it
// with 409 service_exists), a GPU job (a kev.train above all) while a service runs (8 GB of VRAM, §7.4: "kev.serve
// is stopped before every training job"), a score against anything but the running model (one served model at a
// time), a stop of nothing, an unknown or later {{reference}}, a duplicate id, a service left running at the end.
// Returns the simulated timeline; throws a SequenceError listing every violation.
export function checkSequence(stages, { allowBenchmarkDuringService = false } = {}) {
  const errors = [], timeline = [], ids = new Set(), trained = new Set();
  let service = null;
  for (const [i, s] of stages.entries()) {
    const where = `stage ${i + 1} ${s?.id}`;
    if (!s?.id || ids.has(s.id)) errors.push(`${where}: duplicate or missing id`);
    ids.add(s.id);
    for (const ref of refsOf(s)) if (!trained.has(ref)) errors.push(`${where}: references {{${ref}}}, which is not an earlier kev.train stage`);
    for (const need of s.needs ?? []) if (!ids.has(need) || need === s.id) errors.push(`${where}: needs ${need}, which does not come before it`);
    switch (s.kind) {
      case 'kev.serve':
        if (service) errors.push(`${where}: a second kev.serve while ${service.id} is running`);
        else service = { id: s.id, run: s.params?.run };
        break;
      case 'serve.stop':
        if (!service || service.id !== s.serve) errors.push(`${where}: stops ${s.serve}, which is not the running service`);
        else service = null;
        break;
      case 'score':
      case 'permute':
        if (!service || service.id !== s.serve) errors.push(`${where}: reads ${s.serve}, which is not the running service`);
        else if (s.expectRun !== service.run) errors.push(`${where}: expects ${s.expectRun} but the service runs ${service.run} (one served model at a time)`);
        break;
      case 'kev.train':
        if (service) errors.push(`${where}: a kev.train is queued while the service ${service.id} runs`);
        trained.add(s.id);
        break;
      default:
        if (GPU_KINDS.has(s.kind) && service && !(s.kind === 'kev.benchmark' && allowBenchmarkDuringService)) errors.push(`${where}: a ${s.kind} is queued while the service ${service.id} runs`);
        if (!['observe', 'kev.benchmark', 'sys.selftest'].includes(s.kind)) errors.push(`${where}: unknown stage kind ${s.kind}`);
    }
    timeline.push({ stage: s.id, kind: s.kind, service: service?.id ?? null });
  }
  if (service) errors.push(`the plan ends with ${service.id} still running`);
  if (errors.length) throw new SequenceError('PLAN_SEQUENCE', `${errors.length} sequence violation(s): ${errors.join('; ')}`, { errors });
  return timeline;
}

export function assemblePlan(stages, { id = null, note = null } = {}) {
  const timeline = checkSequence(stages);
  const body = { schema: 'kev-data/jobs-plan@1', pins: PINS, recipe: RECIPE, stages };
  return { ...body, planId: id ?? `plan-${sha256(canonical(body)).slice(0, 12)}`, note, timeline };
}
export function resolveRefs(value, jobIds) {
  return JSON.parse(JSON.stringify(value ?? null).replace(REF, (_, ref) => {
    if (!jobIds[ref]) throw fail('RUN_UNRESOLVED', `{{${ref}}} has no job id yet`);
    return jobIds[ref];
  }));
}

// ---- validation against the bridge's own schemas and the real Kev argparse (acceptance: every J-spec) ----------------
// bridge/ is imported read-only. A throwaway JobManager over a scratch workdir resolves data files and
// runs/<jobId> references exactly as the daemon would (a planted record of a successful kev.train job per
// {{stage}}); validateParams and buildCommand then run on every bridge-job stage, and the command lines are parsed
// by kev.train / kev.benchmark / kev.serve at the pinned Kev commit, in /opt/kev-venv under `python -I`, offline,
// with no model loaded. A parsed value that differs from what the spec asked for is an error.

const ARGPARSE_PY = String.raw`
import sys, json, argparse, runpy, io, contextlib
sys.path.insert(0, sys.argv[1])
cases = json.loads(sys.stdin.read())
class _Captured(Exception): pass
orig = argparse.ArgumentParser.parse_args
holder = {}
def capture(self, *a, **k):
    ns = orig(self, *a, **k)
    holder["ns"] = vars(ns)
    raise _Captured()
out = []
for c in cases:
    holder.clear(); err = io.StringIO()
    try:
        with contextlib.redirect_stderr(err):
            if c["module"] == "kev.train":
                from kev.train import parse_args
                sys.argv = ["kev.train", *c["argv"]]
                ns = parse_args(); holder["ns"] = vars(ns)
            else:
                argparse.ArgumentParser.parse_args = capture
                try:
                    sys.argv = [c["module"], *c["argv"]]
                    runpy.run_module(c["module"], run_name="__main__")
                finally:
                    argparse.ArgumentParser.parse_args = orig
        out.append({"id": c["id"], "args": json.loads(json.dumps(holder["ns"], default=str))} if "ns" in holder else {"id": c["id"], "error": "the module ran to its end without parsing"})
    except _Captured:
        out.append({"id": c["id"], "args": json.loads(json.dumps(holder["ns"], default=str))})
    except SystemExit as e:
        out.append({"id": c["id"], "error": "argparse exit %s: %s" % (e.code, err.getvalue().strip().split("\n")[-1][:300])})
    except Exception as e:
        out.append({"id": c["id"], "error": type(e).__name__ + ": " + str(e)[:300]})
print("@@KEV_ARGPARSE@@" + json.dumps(out))
`;

// Parses each {id, module, argv} with the real Kev argparse. One Python process for all of them (the imports cost seconds).
export function kevArgparse(cases, { python = PYTHON, kevRoot = KEV.root, timeoutMs = 10 * 60_000 } = {}) {
  checkKevPin();
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', LANG: 'C.UTF-8', HF_HOME, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_DATASETS_OFFLINE: '1', TOKENIZERS_PARALLELISM: 'false', PYTHONDONTWRITEBYTECODE: '1' };
  const r = spawnSync(python, ['-I', '-c', ARGPARSE_PY, kevRoot], { input: JSON.stringify(cases), encoding: 'utf8', env, maxBuffer: 1 << 28, timeout: timeoutMs });
  const line = (r.stdout ?? '').split('\n').find(l => l.startsWith('@@KEV_ARGPARSE@@'));
  if (r.status !== 0 || !line) throw fail('KEV_PYTHON', `kev argparse: exit ${r.status ?? r.signal}: ${(r.stderr ?? '').trim().split('\n').slice(-4).join(' | ')}`);
  return JSON.parse(line.slice('@@KEV_ARGPARSE@@'.length));
}

const MODULE_OF = Object.freeze({ 'kev.train': 'kev.train', 'kev.benchmark': 'kev.benchmark', 'kev.serve': 'kev.serve' });
function expectedArgs(kind, value, resolved, out, cfg, kevRoot) {
  if (kind === 'kev.train') {
    const e = { data: resolved.dataset, out, base: value.base, epochs: value.epochs, lr: value.lr, batch: value.batch, accum: value.accum, dtype: value.dtype, max_state: value.maxState,
      checkpointing: value.checkpointing, lora: value.lora, device: cfg.device, init_from: resolved.initFrom ?? '' };
    for (const [k, v] of Object.entries(value.extra ?? {})) e[k] = k === 'suite' ? path.join(kevRoot, v) : v;
    return e;
  }
  if (kind === 'kev.benchmark') return { run: resolved.run, data: resolved.data, out, rotations: value.rotations, device: cfg.device };
  return { run: resolved.run, port: value.port, host: '127.0.0.1' };
}
const sameValue = (got, want) => (typeof want === 'number' ? Number(got) === want : String(got) === String(want));

export async function validateStages(stages, { python = PYTHON, kevRoot = KEV.root, device = 'cuda', argparse = true, scratch = process.env.KEV_DATA_SCRATCH ?? undefined } = {}) {
  const [{ KINDS, validateParams, buildCommand, JobManager }, { normalizeConfig }] = await Promise.all([import('../../bridge/laptop/jobs.mjs'), import('../../bridge/laptop/config.mjs')]);
  const { mkdtempSync, mkdirSync: mk, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const root = mkdtempSync(path.join(scratch ?? tmpdir(), 'kev-jobs-validate-')), workdir = path.join(root, 'work');
  try {
    const cfg = normalizeConfig({ workdir, python, kevDir: kevRoot, device, mailbox: { enabled: false }, tunnel: { metrics: null, log: null } });
    mk(path.join(workdir, 'data'), { recursive: true }); mk(path.join(workdir, 'jobs'), { recursive: true }); mk(path.join(workdir, 'runs'), { recursive: true });
    // one planted successful kev.train job per {{reference}}, with the head.pt sha the daemon records
    const ids = {}, now = '2026-10-08T00:00:00.000Z';
    for (const ref of new Set(stages.flatMap(refsOf))) {
      const id = `j-20261008-000000-${sha256(ref).slice(0, 6)}`;
      ids[ref] = id;
      mk(path.join(workdir, 'runs', id), { recursive: true });
      writeFileSync(path.join(workdir, 'runs', id, 'head.pt'), '');
      writeFileSync(path.join(workdir, 'jobs', `${id}.json`), JSON.stringify({ id, kind: 'kev.train', class: 'gpu', params: {}, state: 'succeeded', createdAt: now, startedAt: now, endedAt: now, exitCode: 0, signal: null, error: null, result: null, outputs: null, log: `logs/${id}.log`, outputDir: `runs/${id}`, checkpoint: { dir: `runs/${id}`, headSha256: sha256('') } }));
    }
    for (const s of stages) for (const f of s.files ?? []) {
      const dest = path.join(workdir, ...f.remote.split('/'));
      mk(path.dirname(dest), { recursive: true }); writeFileSync(dest, '{}\n');
    }
    const jm = new JobManager({ config: cfg, workdir });
    await jm.init();
    const report = [], cases = [];
    for (const s of stages) {
      if (!MODULE_OF[s.kind]) continue;
      const entry = { id: s.id, kind: s.kind, errors: [] };
      report.push(entry);
      try {
        const params = resolveRefs(s.params, ids);
        const { value, resolved } = await validateParams(KINDS[s.kind].params, params, jm);
        const out = s.kind === 'kev.serve' ? null : path.join(workdir, 'runs', 'j-20261008-999999-abcdef');
        const built = buildCommand(s.kind, { params: value }, resolved, cfg, out);
        entry.validated = true; entry.argv = built.args.slice(2);
        cases.push({ id: s.id, module: MODULE_OF[s.kind], argv: built.args.slice(2), expect: expectedArgs(s.kind, value, resolved, out, cfg, kevRoot) });
      } catch (error) { entry.validated = false; entry.errors.push(`bridge: ${error.message}`); }
    }
    if (argparse && cases.length) {
      const parsed = new Map(kevArgparse(cases.map(({ id, module, argv }) => ({ id, module, argv })), { python, kevRoot }).map(p => [p.id, p]));
      for (const c of cases) {
        const entry = report.find(r => r.id === c.id), p = parsed.get(c.id);
        entry.parsed = p?.args ?? null;
        if (!p || p.error) { entry.errors.push(`kev argparse: ${p?.error ?? 'no result'}`); continue; }
        for (const [k, want] of Object.entries(c.expect)) if (!sameValue(p.args[k], want)) entry.errors.push(`kev argparse: --${k} is ${JSON.stringify(p.args[k])}, the spec asked for ${JSON.stringify(want)}`);
      }
    }
    return { ok: report.every(r => !r.errors.length), stages: report, kev: { commit: KEV.commit }, plantedRuns: ids };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// ---- per-job acceptance (§7.4 "Acceptance per job" [crit G17]) --------------------------------------------------------

export function parseTrainLog(text) {
  const lines = String(text ?? '').split('\n');
  const dropped = lines.filter(l => /^dropped \d+ of \d+ records that exceed the training context/.test(l));
  const req = /^(\d+) training requests\b/m.exec(text ?? '');
  const rep = /^replay: (\d+) of (\d+) suite training records mixed with (\d+) from /m.exec(text ?? '');
  const losses = [...String(text ?? '').matchAll(/^ep(\d+) step (\d+)\/(\d+) loss ([0-9.]+)/gm)].map(m => ({ epoch: Number(m[1]), step: Number(m[2]), steps: Number(m[3]), loss: Number(m[4]) }));
  const oom = lines.filter(l => /\bKilled\b|MemoryError|out of memory|OutOfMemory|\bOOM\b|signal=SIGKILL|exit=137/i.test(l));
  const fallback = [...String(text ?? '').matchAll(/`(\w+)` is falling back to its reference PyTorch implementation because `([\w-]+)` is not installed/g)].map(m => ({ function: m[1], missing: m[2] }));
  const end = /\[bridge [^\]]+\] end (\w+)(?: exit=(\d+))?(?: signal=(\w+))?/.exec(text ?? '');
  return { dropped, requests: req ? Number(req[1]) : null, replay: rep ? { used: Number(rep[1]), pool: Number(rep[2]), fileRecords: Number(rep[3]) } : null, losses, oom, fallback,
    saved: /^saved /m.test(text ?? ''), end: end ? { state: end[1], exit: end[2] === undefined ? null : Number(end[2]), signal: end[3] ?? null } : null };
}

// -> { ok, errors, facts }. job: the bridge's job record (outputDir, outputs, state); config: training_config.json;
// metrics: training_metrics.json; expect: the stage's accept block plus {jobId, uploadedSha256?, manifestSha256?, suiteSha256?}.
export function checkTrainJob({ log, config = null, metrics = null, job = null, expect }) {
  const errors = [], p = parseTrainLog(log), facts = { requests: p.requests, replay: p.replay };
  if (p.dropped.length) errors.push(`train.log has a "dropped" line: ${p.dropped[0]}`);
  const replayWanted = expect.replay ?? 0;
  if (replayWanted > 0) {
    if (!p.replay) errors.push('train.log has no "replay:" line although replay was requested');
    else if (p.replay.used !== replayWanted) errors.push(`replay: the suite supplied ${p.replay.used} records, ${replayWanted} were requested`);
    else if (expect.fileRecords !== undefined && p.replay.fileRecords !== expect.fileRecords) errors.push(`replay line counts ${p.replay.fileRecords} file records, the dataset has ${expect.fileRecords}`);
  } else if (p.replay) errors.push('train.log mixes replay records although none were requested');
  const wanted = (expect.fileRecords ?? NaN) + (replayWanted > 0 ? (p.replay?.used ?? replayWanted) : 0);
  if (p.requests === null) errors.push('train.log has no "N training requests" line');
  else if (p.requests !== wanted) errors.push(`${p.requests} training requests, expected ${expect.fileRecords} file records + ${replayWanted} replay = ${wanted}`);
  if (p.oom.length) errors.push(`train.log shows an out-of-memory kill: ${p.oom[0].slice(0, 120)}`);
  if (p.end && p.end.state !== 'succeeded') errors.push(`the bridge ended the job ${p.end.state}`);
  if (job) {
    if (job.state !== undefined && job.state !== 'succeeded') errors.push(`job state is ${job.state}`);
    const dir = `runs/${expect.jobId ?? job.id}`;
    if (job.outputDir !== dir) errors.push(`outputs are in ${job.outputDir}, expected ${dir}`);
    const files = (job.outputs?.files ?? []).map(f => f.path);
    if (job.outputs && files.length) {
      if (job.outputs.dir !== dir) errors.push(`outputs listing is for ${job.outputs.dir}, expected ${dir}`);
      for (const f of files) if (!f.startsWith(`${dir}/`)) errors.push(`output ${f} is outside ${dir}/`);
      for (const need of ['head.pt', 'training_metrics.json', 'training_config.json']) if (!files.includes(`${dir}/${need}`)) errors.push(`outputs lack ${need}`);
    } else if (!expect.throughputProbe && job.outputs) errors.push('outputs listing is empty');
  }
  if (config) {
    const a = config.args ?? {};
    if (config.base_revision !== (expect.baseRevision ?? PINS.baseRevision)) errors.push(`training_config.json base_revision is ${config.base_revision}, pinned ${expect.baseRevision ?? PINS.baseRevision}`);
    const init = expect.initFrom ?? PINS.initFrom;
    if (init) { const got = a.init_from ?? ''; if (!(got === init || (init.startsWith('runs/') && got.endsWith(`/${init}`)))) errors.push(`training_config.json init_from is ${JSON.stringify(got)}, expected ${init}`); }
    if (expect.maxState !== undefined && a.max_state !== expect.maxState) errors.push(`max_state is ${a.max_state}, expected ${expect.maxState}`);
    if (expect.epochs !== undefined && a.epochs !== expect.epochs) errors.push(`epochs is ${a.epochs}, expected ${expect.epochs}`);
    if (replayWanted && a.replay !== replayWanted) errors.push(`replay is ${a.replay}, expected ${replayWanted}`);
    if (expect.suiteSha256 && config.suite_sha256 !== expect.suiteSha256) errors.push(`suite_sha256 is ${config.suite_sha256}, expected ${expect.suiteSha256}`);
  }
  if (expect.datasetSha256) {
    for (const [what, got] of [['uploaded', expect.uploadedSha256], ['build manifest', expect.manifestSha256]]) {
      if (got !== undefined && String(got).replace(/^sha256:/, '') !== String(expect.datasetSha256).replace(/^sha256:/, '')) errors.push(`dataset sha256 differs from the ${what} sha256`);
    }
  }
  if (metrics) {
    if (metrics.rejected_records) errors.push(`training_metrics.json rejected_records is ${metrics.rejected_records}`);
    if (metrics.truncated_records) errors.push(`training_metrics.json truncated_records is ${metrics.truncated_records}`);
    if (!(metrics.optimizer_steps > 0)) errors.push('no optimizer step ran');
    facts.optimizerSteps = metrics.optimizer_steps;
  }
  return { ok: errors.length === 0, errors, facts };
}

// A benchmark report with coverage.rejected_records > 0 is invalid (§7.4).
export function checkBenchmarkReport(report, { expectRecords = null } = {}) {
  const errors = [], c = report?.coverage;
  if (!c) return { ok: false, errors: ['report.json has no coverage block'] };
  if (c.rejected_records > 0) errors.push(`coverage.rejected_records is ${c.rejected_records}`);
  if (c.truncated_records > 0) errors.push(`coverage.truncated_records is ${c.truncated_records}`);
  if (c.evaluated_records !== c.requested_records) errors.push(`evaluated ${c.evaluated_records} of ${c.requested_records} records`);
  if (expectRecords !== null && c.requested_records !== expectRecords) errors.push(`requested ${c.requested_records} records, the file has ${expectRecords}`);
  return { ok: errors.length === 0, errors };
}
// kev.benchmark rows.json -> the served rows shape (path: 'benchmark'), so the analysis reads one format.
export const benchmarkRowsToServedShape = (rows, { run = null } = {}) => rows.map(r => ({ ...r, path: 'benchmark', run }));

// ---- the runner: the client side of a plan ----------------------------------------------------------------------------
// runPlan() is the only code here that talks to the bridge, and only through the client it is given
// (bridge/cloud/client.mjs BridgeClient in production, a stand-in in tests). It needs `confirm: true`: the owner (or
// the orchestrator on the owner's behalf) decides when a plan is submitted; writing a plan never submits it.
// Guards, on top of the plan's own sequence check: before a kev.train or kev.benchmark it asks the daemon whether a
// service is live and refuses to queue behind it; before a kev.serve it asks the same and refuses to request a second
// one (the daemon would answer 409 service_exists). State is kept in <dir>/state.json so a restart re-attaches to
// a submitted job instead of submitting it again.

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'stopped', 'lost']);
const isLive = j => j.class === 'service' && !TERMINAL.has(j.state);
// GET /info lists the live services (jobs.services()); GET /jobs is {jobs, queue} and only the 50 newest, so it is the fallback.
async function liveServices(client) {
  const info = typeof client.info === 'function' ? await client.info() : null;
  if (Array.isArray(info?.services)) return info.services.filter(s => !TERMINAL.has(s.state));
  const r = await client.jobs();
  return (Array.isArray(r) ? r : r?.jobs ?? []).filter(isLive);
}
const writeJson = (file, value) => { mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.tmp`; writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n'); renameSync(tmp, file); };

async function defaultScorer({ stage, dir, client, jobIds }) {
  const { loadKevRecords, scoreServed, servedClient } = await import('./score-served.mjs');
  const url = `${client.endpoint}/svc/kev`, served = servedClient({ url, fetchImpl: client.bridgeFetch });
  const { records, sha256: digest } = loadKevRecords(path.resolve(dir, stage.data));
  if (stage.dataSha256 && String(stage.dataSha256).replace(/^sha256:/, '') !== digest) throw fail('RUNNER_DATASET_SHA', `${stage.data}: sha256 ${digest} differs from the plan's ${stage.dataSha256}`);
  return scoreServed({ records, served, url, fetchImpl: client.bridgeFetch, rowsFile: path.join(dir, 'results', stage.rows), concurrency: stage.concurrency, expectRun: resolveRefs(stage.expectRun, jobIds),
    reread: stage.reread ?? 0, repeat: stage.repeat ?? 1, inputFile: path.basename(stage.data), inputSha256: digest });
}
// POST /v1/systemone/permute on n items of a file (§6.4 item 4); writes the flip rate to results/<stage.out>
async function defaultPermuter({ stage, dir, client, jobIds }) {
  const { loadKevRecords, permuteRead, describeServed, servedClient, runMatches } = await import('./score-served.mjs');
  const url = `${client.endpoint}/svc/kev`, served = servedClient({ url, fetchImpl: client.bridgeFetch });
  const identity = await describeServed(served), expect = resolveRefs(stage.expectRun, jobIds);
  if (!runMatches(identity.run, expect)) throw fail('SERVED_MODEL_MISMATCH', `the service runs ${identity.run}, expected ${expect}`);
  const { records, sha256: digest } = loadKevRecords(path.resolve(dir, stage.data));
  const result = await permuteRead({ records, url, fetchImpl: client.bridgeFetch, n: stage.n, nPerm: stage.nPerm });
  const after = await describeServed(served);
  if (after.run !== identity.run) throw fail('SERVED_MODEL_CHANGED', `the service changed from ${identity.run} to ${after.run} during the permutation read`);
  const out = { schema: 'kev-data/served-permute@1', input: { file: path.basename(stage.data), sha256: digest }, served: { identity }, ...result };
  writeJson(path.join(dir, 'results', stage.out), out);
  return out;
}

export async function runPlan(plan, { client, dir, confirm = false, log = () => {}, scorer = defaultScorer, permuter = defaultPermuter, waitOpts = {}, only = null, tracker = null, continueOnReject = false, suiteSha256: expectedSuite = suiteSha256() } = {}) {
  if (confirm !== true) throw fail('RUN_NOT_CONFIRMED', 'runPlan submits jobs to the laptop; pass confirm: true (the owner decides when a plan runs)');
  if (!client || typeof client.submitJob !== 'function') throw fail('RUN_CLIENT', 'runPlan needs a BridgeClient');
  checkSequence(plan.stages);
  mkdirSync(dir, { recursive: true });
  const stateFile = path.join(dir, 'state.json');
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { planId: plan.planId, stages: {}, uploaded: {} };
  if (state.planId !== plan.planId) throw fail('RUN_STATE', `${stateFile} belongs to ${state.planId}, not ${plan.planId}`);
  const save = () => writeJson(stateFile, state);
  const jobIds = Object.fromEntries(Object.entries(state.stages).filter(([, s]) => s.kind === 'kev.train' && s.jobId).map(([id, s]) => [id, s.jobId]));
  const serveJobs = Object.fromEntries(Object.entries(state.stages).filter(([, s]) => s.kind === 'kev.serve' && s.jobId).map(([id, s]) => [id, s.jobId]));
  const results = {};
  try { writeJson(path.join(dir, 'observations', 'info.json'), await client.info()); } catch (error) { log(`GET /info failed: ${error.message}`); }   // free disk, GPU, memory total, kernel-relevant versions

  for (const stage of plan.stages) {
    if (only && !only.includes(stage.id)) continue;
    const st = (state.stages[stage.id] ??= { kind: stage.kind, status: 'pending' });
    if (st.status === 'done') { results[stage.id] = st; continue; }
    st.startedAt ??= new Date().toISOString();
    const mark = (status, extra = {}) => { Object.assign(st, { status }, extra); save(); };
    log(`${stage.id} (${stage.kind})`);

    if (stage.kind === 'observe') {
      const file = path.join(dir, stage.file);
      if (!existsSync(file)) { mark('needs-input', { request: stage.request }); throw fail('RUN_NEEDS_INPUT', `${stage.id}: ${stage.request}`); }
      mark('done', { endedAt: new Date().toISOString(), observed: stage.file });
      continue;
    }

    if (stage.kind === 'score') {
      const { report } = await scorer({ stage, plan, dir, client, jobIds, serveJobId: serveJobs[stage.serve] });
      const verdict = { valid: report.valid, coverage: report.coverage, seconds_per_request: report.timing?.seconds_per_request ?? null, rows: report.rows?.file ?? null };
      if (!report.valid) { mark('invalid', { verdict }); throw fail('RUN_SCORE_INVALID', `${stage.id}: the served read is invalid (${JSON.stringify(report.coverage)})`, { verdict }); }
      mark('done', { endedAt: new Date().toISOString(), verdict });
      tracker?.record(stage.budgetStep, (report.timing?.wall_seconds ?? 0) / 3600);
      continue;
    }

    if (stage.kind === 'permute') {
      const result = await permuter({ stage, plan, dir, client, jobIds, serveJobId: serveJobs[stage.serve] });
      mark('done', { endedAt: new Date().toISOString(), verdict: { items: result.items, flip_rate: result.flip_rate } });
      continue;
    }

    if (stage.kind === 'serve.stop') {
      const id = serveJobs[stage.serve];
      if (!id) throw fail('RUN_STATE', `${stage.id}: no job id for ${stage.serve}`);
      await client.cancel(id);
      const end = await client.waitJob(id, { pollMs: 1000, until: 'terminal', ...waitOpts });
      if (end.state !== 'stopped') throw fail('RUN_SERVE_STOP', `${stage.id}: the service ended ${end.state}, not stopped`);
      mark('done', { endedAt: new Date().toISOString(), jobId: id });
      continue;
    }

    // a bridge job. Never queue behind a service, never ask for a second one.
    const live = await liveServices(client);
    if (stage.kind === 'kev.serve' && live.length) { mark('refused'); throw fail('RUN_SERVICE_EXISTS', `${stage.id}: ${live[0].kind} ${live[0].id} is running; refusing to request a second service`); }
    if (stage.kind !== 'kev.serve' && live.length) { mark('refused'); throw fail('RUN_SERVICE_LIVE', `${stage.id}: ${live[0].kind} ${live[0].id} is running; refusing to queue a ${stage.kind} behind it`); }

    const uploadedShas = [];
    for (const f of stage.files ?? []) {
      const local = path.resolve(dir, f.local), body = readFileSync(local), digest = sha256(body);
      if (f.sha256 && String(f.sha256).replace(/^sha256:/, '') !== digest) throw fail('RUNNER_DATASET_SHA', `${f.local}: sha256 ${digest} differs from the plan's ${f.sha256}`);
      if (state.uploaded[f.remote] !== digest) { const up = await client.upload(local, f.remote, { overwrite: true }); if (up.sha256 !== digest) throw fail('RUNNER_UPLOAD', `${f.remote}: the daemon stored sha256 ${up.sha256}, expected ${digest}`); state.uploaded[f.remote] = digest; save(); }
      uploadedShas.push(digest);
    }
    const params = resolveRefs(stage.params, jobIds);
    let id = st.jobId;
    if (!id) { const job = await client.submitJob(stage.kind, params); id = job.id; st.jobId = id; mark('submitted', { jobId: id }); }
    if (stage.kind === 'kev.train') jobIds[stage.id] = id;

    let text = '';
    const end = await client.waitJob(id, { pollMs: 2000, timeoutMs: 12 * 3600_000, onLog: s => { text += s; }, ...waitOpts });
    if (stage.kind === 'kev.serve') {
      if (end.state !== 'running') { mark('failed', { error: end.error }); throw fail('RUN_JOB_FAILED', `${stage.id}: the service is ${end.state} (${end.error ?? 'no error'})`); }
      serveJobs[stage.id] = id;
      mark('done', { endedAt: new Date().toISOString(), jobId: id });
      continue;
    }
    const out = path.join(dir, 'results', stage.id);
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, 'train.log'), text);            // the bridge job log (stdout and stderr), which is what Kev's train.log means here
    if (end.state !== 'succeeded') { mark('failed', { error: end.error ?? end.state }); throw fail('RUN_JOB_FAILED', `${stage.id}: ${end.state} (${end.error ?? 'no error'})`, { tail: text.slice(-1500) }); }
    const fetched = {};
    for (const name of stage.fetch ?? []) { const dest = path.join(out, name); await client.download(`runs/${id}/${name}`, dest); fetched[name] = dest; }
    let acceptance = { ok: true, errors: [] };
    if (stage.accept?.kind === 'train') {
      const read = n => (fetched[n] ? JSON.parse(readFileSync(fetched[n], 'utf8')) : null);
      acceptance = checkTrainJob({ log: text, config: read('training_config.json'), metrics: read('training_metrics.json'), job: end, expect: { ...stage.accept, jobId: id, uploadedSha256: uploadedShas[0], manifestSha256: stage.accept.datasetSha256, ...(stage.params.extra?.suite && expectedSuite ? { suiteSha256: expectedSuite } : {}) } });
    } else if (stage.accept?.kind === 'benchmark') {
      acceptance = checkBenchmarkReport(JSON.parse(readFileSync(fetched['report.json'], 'utf8')));
    }
    if (!acceptance.ok) {
      mark('rejected', { acceptance });
      if (!continueOnReject) throw fail('RUN_ACCEPTANCE', `${stage.id}: ${acceptance.errors.join('; ')}`, { acceptance });
    } else mark('done', { endedAt: new Date().toISOString(), acceptance });
    const hours = end.startedAt && end.endedAt ? (Date.parse(end.endedAt) - Date.parse(end.startedAt)) / 3.6e6 : null;
    if (hours !== null) tracker?.record(stage.budgetStep ?? stage.id, hours);
    results[stage.id] = state.stages[stage.id];
  }
  return { state, results };
}

// ---- J0 analysis: seconds per record and per forward token, memory, kernels, served throughput ---------------------------
// Inputs are what the runner fetched: per J0a job its training_metrics.json and job log (train.log), the host facts
// (`free -m` is a file the laptop agent provides; GET /info gives free disk), the kernel environment of the J0k
// benchmark report, and the score-served reports of J0c. A figure whose source is missing is listed in `missing` and
// the report is `complete: false`; nothing is filled in.

export function parseFreeM(text) {
  const lines = String(text ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  const head = lines.find(l => /\btotal\b/.test(l) && /\bused\b/.test(l)), mem = lines.find(l => /^Mem:/i.test(l));
  if (!head || !mem) return null;
  const names = head.split(/\s+/), nums = mem.replace(/^Mem:\s*/i, '').split(/\s+/).map(Number);
  const out = {};
  names.forEach((n, i) => { if (Number.isFinite(nums[i])) out[n === 'buff/cache' ? 'buffCache' : n] = nums[i]; });
  if (!Number.isFinite(out.total) || !Number.isFinite(out.available)) return null;     // `available` is what a new process can use
  return { unit: 'MiB', ...out, raw: lines.join('\n') };
}

// Drops the first optimizer step (CUDA warm-up, first kernels) and scales the totals by the remaining share of steps.
export function steadyState(metrics, { warmupSteps = 1 } = {}) {
  const steps = metrics.step_seconds ?? [], n = steps.length || metrics.optimizer_steps || 0;
  if (n >= warmupSteps + 2) {
    const warm = steps.slice(0, warmupSteps).reduce((a, b) => a + b, 0), seconds = steps.slice(warmupSteps).reduce((a, b) => a + b, 0), share = (n - warmupSteps) / n;
    return { steady: true, steps: n, warmupSeconds: round(warm, 3), seconds, records: metrics.records_seen * share, tokens: metrics.forward_tokens * share };
  }
  return { steady: false, steps: n, warmupSeconds: 0, seconds: metrics.wall_seconds, records: metrics.records_seen, tokens: metrics.forward_tokens };
}

export function jobSummary({ metrics, log = '' }) {
  const ss = steadyState(metrics), p = parseTrainLog(log);
  return {
    records_seen: metrics.records_seen, forward_tokens: metrics.forward_tokens, optimizer_steps: metrics.optimizer_steps, wall_seconds: round(metrics.wall_seconds, 2), warmup_seconds: ss.warmupSeconds, steady: ss.steady,
    steady_records: round(ss.records, 2), steady_tokens: round(ss.tokens, 1), steady_seconds: round(ss.seconds, 3),
    seconds_per_record: round(ss.seconds / ss.records, 4), seconds_per_token: round(ss.seconds / ss.tokens, 7), tokens_per_second: round(ss.tokens / ss.seconds, 1), tokens_per_record: round(ss.tokens / ss.records, 1),
    peak_rss_bytes: metrics.peak_rss_bytes ?? null, peak_device_bytes: metrics.peak_device_bytes ?? null, device: metrics.device ?? null, dtype: metrics.dtype ?? null,
    log: { dropped: p.dropped.length, requests: p.requests, oom_kill: p.oom.length > 0, fallback_kernels: p.fallback, losses: p.losses.length }
  };
}

// Seconds = a * records + b * forward_tokens, least squares on relative error (the 8K job is 20x the seconds of the
// 300-token one). It is accepted when a >= 0, b > 0 and every class is within 10%; otherwise the throughput is
// superlinear in the tokens of a record (attention over a longer state) and the schedule interpolates the measured
// seconds per record over the tokens per record instead. Both are reported.
export function fitThroughput(points, { tolerance = 0.10 } = {}) {
  const usable = points.filter(p => p && p.seconds > 0 && p.records > 0 && p.tokens > 0);
  if (usable.length < 2) return { ok: false, model: null, reason: 'fewer than two usable classes', classes: usable.length };
  let rr = 0, rt = 0, tt = 0, rs = 0, ts = 0;
  for (const p of usable) { const w = 1 / (p.seconds * p.seconds); rr += w * p.records * p.records; rt += w * p.records * p.tokens; tt += w * p.tokens * p.tokens; rs += w * p.records * p.seconds; ts += w * p.tokens * p.seconds; }
  const det = rr * tt - rt * rt;
  if (Math.abs(det) < 1e-18) return { ok: false, model: null, reason: 'the classes do not separate seconds per record from seconds per token' };
  const a = (rs * tt - ts * rt) / det, b = (rr * ts - rt * rs) / det;
  const residuals = usable.map(p => round((a * p.records + b * p.tokens - p.seconds) / p.seconds, 4)), worst = Math.max(...residuals.map(Math.abs));
  return { ok: a >= 0 && b > 0 && worst <= tolerance, model: 'two-parameter', secondsPerRecord: a, secondsPerToken: b, residuals, maxRelativeResidual: round(worst, 4), tolerance, classes: usable.length };
}

// A cost model for the schedule: seconds({rows, replay, epochs}).
export function costModel({ fit = null, perClass = [], rate = null, tokenModel = TOKEN_MODEL }) {
  const classes = perClass.filter(c => c && c.secondsPerRecord > 0 && c.tokensPerRecord > 0).sort((x, y) => x.tokensPerRecord - y.tokensPerRecord);
  const dims = ({ rows, replay }) => ({ records: rows + replay, tokens: rows * tokenModel.perRow + replay * tokenModel.perReplay });
  if (fit?.ok) {
    const { secondsPerRecord: a, secondsPerToken: b } = fit;
    return { kind: 'two-parameter', a, b, seconds: ({ rows, replay = 0, epochs = 1 }) => epochs * (a * (rows + replay) + b * dims({ rows, replay }).tokens) };
  }
  if (classes.length >= 2) {
    const s = t => {                                   // seconds per record at t tokens per record: proportional below the first class, linear between, last slope above
      if (t <= classes[0].tokensPerRecord) return classes[0].secondsPerRecord * t / classes[0].tokensPerRecord;
      for (let i = 1; i < classes.length; i++) if (t <= classes[i].tokensPerRecord || i === classes.length - 1) {
        const lo = classes[i - 1], hi = classes[i];
        return lo.secondsPerRecord + (t - lo.tokensPerRecord) * (hi.secondsPerRecord - lo.secondsPerRecord) / (hi.tokensPerRecord - lo.tokensPerRecord);
      }
    };
    return { kind: 'interpolated', classes: classes.map(c => ({ tokensPerRecord: c.tokensPerRecord, secondsPerRecord: c.secondsPerRecord })), seconds: ({ rows, replay = 0, epochs = 1 }) => epochs * (rows * s(tokenModel.perRow) + replay * s(tokenModel.perReplay)) };
  }
  if (rate > 0) return { kind: 'rate', rate, seconds: ({ rows, replay = 0, epochs = 1 }) => epochs * dims({ rows, replay }).tokens / rate };
  throw fail('J0_MODEL', 'a cost model needs a fit, two measured classes, or a rate');
}
export const scaleModel = (model, k) => ({ ...model, scale: (model.scale ?? 1) * k, seconds: args => k * model.seconds(args) });
export const rateAt = (model, { rows = POINT_ROWS['5K'], replay = RECIPE.replay } = {}) => (rows * TOKEN_MODEL.perRow + replay * TOKEN_MODEL.perReplay) / model.seconds({ rows, replay });

export function kernelPath({ benchmarkReport = null, logs = [] } = {}) {
  const env = benchmarkReport?.environment ?? null, fallbacks = [...new Map(logs.flatMap(l => parseTrainLog(l).fallback).map(f => [`${f.function}/${f.missing}`, f])).values()];
  const pk = env?.packages ?? {}, fla = pk['flash-linear-attention'] ?? null, conv = pk['causal-conv1d'] ?? null;
  const inconsistent = [];
  if (env && fla && fallbacks.some(f => /flash-linear-attention/.test(f.missing))) inconsistent.push('the benchmark report lists flash-linear-attention but a train.log falls back from it');
  if (env && conv && fallbacks.some(f => /causal.conv1d/.test(f.missing))) inconsistent.push('the benchmark report lists causal-conv1d but a train.log falls back from it');
  return {
    source: env ? 'kev.benchmark report.json environment' : fallbacks.length ? 'train.log fallback warnings' : null,
    fast: env ? !!(fla && conv) : fallbacks.length ? false : null,
    flash_linear_attention: fla, causal_conv1d: conv, deltanet: env?.deltanet ?? null, backend: env?.backend ?? null, gpu: env?.gpu ?? null, torch: pk.torch ?? null,
    fallback_warnings: fallbacks, inconsistent
  };
}

// J0b: adopt shared_prefix if >= 1.5x faster and the logged 50-step losses match within 1%.
export function j0bVerdict({ A, B }) {
  if (!A?.metrics || !B?.metrics) return { adopt: null, reason: 'J0b was not run (the plan\'s cut line)' };
  const sa = jobSummary(A), sb = jobSummary(B), la = parseTrainLog(A.log).losses, lb = parseTrainLog(B.log).losses;
  const common = la.filter(x => lb.some(y => y.step === x.step)).map(x => ({ step: x.step, a: x.loss, b: lb.find(y => y.step === x.step).loss }));
  const maxRel = common.length ? Math.max(...common.map(c => Math.abs(c.a - c.b) / Math.max(1e-9, Math.abs(c.a)))) : null;
  const speedup = sa.seconds_per_record / sb.seconds_per_record;
  const adopt = speedup >= 1.5 && maxRel !== null && maxRel <= 0.01;
  return { adopt, speedup: round(speedup, 3), max_relative_loss_difference: round(maxRel, 5), compared_steps: common.length, seconds_per_record: { A: sa.seconds_per_record, B: sb.seconds_per_record },
    reason: adopt ? 'faster and the losses match' : speedup < 1.5 ? `only ${round(speedup, 2)}x faster` : maxRel === null ? 'no logged step in common to compare losses' : `losses differ by ${round(maxRel * 100, 2)}%` };
}

const SERVED_REF_TOKENS = 530;                       // §4.1: mean real state tokens of a Foundry row
export function servedThroughput(served) {
  const out = {};
  for (const [klass, by] of Object.entries(served ?? {})) for (const [c, report] of Object.entries(by ?? {})) {
    const t = report?.timing;
    if (!t) continue;
    out[`${klass}-${c}`] = { klass, concurrency: Number(String(c).replace(/^c/, '')), seconds_per_request: t.seconds_per_request, requests_per_second: t.requests_per_second, server_latency_ms_median: t.server_latency_ms?.median ?? null,
      overhead_ms_median: t.overhead_ms?.median ?? null, rtt_ms_median: t.rtt_ms?.median ?? null, valid: report.valid ?? null, mean_input_tokens: t.input_tokens_per_request?.mean ?? null };
  }
  return out;
}
// seconds per served request at `tokens` real tokens and `concurrency`, interpolated between the 300- and 2K-token files
export function servedSecondsPerRequest(st, { tokens = SERVED_REF_TOKENS, concurrency = 4 } = {}) {
  const lo = st?.[`0300-${concurrency}`] ?? st?.[`0300-c${concurrency}`], hi = st?.[`2k-${concurrency}`] ?? st?.[`2k-c${concurrency}`];
  if (!lo?.seconds_per_request) return null;
  if (!hi?.seconds_per_request) return lo.seconds_per_request;
  const t = Math.min(1, Math.max(0, (tokens - J0_DATA['0300'].tokens) / (J0_DATA['2k'].tokens - J0_DATA['0300'].tokens)));
  return round(lo.seconds_per_request + t * (hi.seconds_per_request - lo.seconds_per_request), 4);
}

export function analyzeJ0(obs, { budgetHours = BUDGET.hours } = {}) {
  const missing = [], jobs = {};
  for (const klass of Object.keys(J0_CLASSES)) {
    const o = obs.train?.[klass];
    if (!o?.metrics) { missing.push(`J0a-${klass} training_metrics.json`); continue; }
    jobs[klass] = jobSummary(o);
    if (jobs[klass].peak_rss_bytes === null) missing.push(`J0a-${klass} peak_rss_bytes`);
    if (jobs[klass].peak_device_bytes === null) missing.push(`J0a-${klass} peak_device_bytes`);
  }
  const freeM = parseFreeM(obs.host?.freeM);
  if (!freeM) missing.push('free -m (the laptop agent saves it to observations/free-m.txt)');
  const disk = obs.host?.disk ?? obs.host?.info?.disk ?? null;
  if (!disk || !Number.isFinite(disk.freeBytes)) missing.push('free disk (GET /info disk.freeBytes)');
  const kernel = kernelPath({ benchmarkReport: obs.kernel?.report ?? null, logs: Object.values(obs.train ?? {}).map(o => o?.log).filter(Boolean) });
  if (kernel.fast === null) missing.push('kernel path (J0k kev.benchmark report.json, or a train.log)');

  const perClass = Object.values(jobs).map(j => ({ secondsPerRecord: j.seconds_per_record, tokensPerRecord: j.tokens_per_record, records: j.steady_records, tokens: j.steady_tokens, seconds: j.steady_seconds }));
  const fit = fitThroughput(perClass.map(c => ({ records: c.records, tokens: c.tokens, seconds: c.seconds })));
  const memory = Object.fromEntries(Object.entries(jobs).map(([k, j]) => [k, {
    peak_rss_bytes: j.peak_rss_bytes, available_ram_bytes: freeM ? freeM.available * 2 ** 20 : null,
    peak_rss_share_of_available: freeM && j.peak_rss_bytes ? round(j.peak_rss_bytes / (freeM.available * 2 ** 20), 4) : null,
    under_80_percent_of_free_ram: freeM && j.peak_rss_bytes ? j.peak_rss_bytes <= 0.8 * freeM.available * 2 ** 20 : null, no_oom_kill: !j.log.oom_kill, peak_device_bytes: j.peak_device_bytes }]));
  const served = servedThroughput(obs.served);
  const sReq = servedSecondsPerRequest(served);
  let model = null, schedule = null, scheduleTable = null;
  if (perClass.length >= 2) {
    model = costModel({ fit, perClass });
    schedule = buildSchedule({ model, secondsPerRequest: sReq ?? undefined, budgetHours });
    schedule.provisional = !sReq || missing.length > 0;     // the served rate, or another J0 figure, is still an assumption
    scheduleTable = renderScheduleTable(schedule);
  } else missing.push('fewer than two J0a classes: no schedule can be regenerated');
  const c4 = Object.values(served).filter(x => x.concurrency === 4 && x.seconds_per_request > 0);
  return {
    schema: 'kev-data/j0-report@1', complete: missing.length === 0, missing,
    jobs, fit: { ...fit, model: model?.kind ?? null }, reference: model ? { point: '5K', tokens_per_second: round(rateAt(model), 1), seconds_per_row: round(model.seconds({ rows: 1, replay: 0 }), 4) } : null,
    host: { free_m: freeM, free_disk: disk ? { freeBytes: disk.freeBytes, totalBytes: disk.totalBytes ?? null } : null, memory },
    kernel_path: kernel, served: { by_file: served, seconds_per_request_at_reference: sReq, tunnel_rtt_ms: Object.values(served).map(x => x.rtt_ms_median).filter(Number.isFinite)[0] ?? null,
      bridge_batch_request_recommended: c4.length ? c4.some(x => x.seconds_per_request > 0.3) : null },
    j0b: j0bVerdict({ A: obs.j0b?.A, B: obs.j0b?.B }), schedule, schedule_table: scheduleTable
  };
}
// J0 "with and without fla" (§7.4, if the owner installs it, O3): two J0 reports compared per class. The kernel paths must differ, or
// the comparison says so instead of reporting a speed-up of nothing.
export function compareJ0Kernels(without, withFla) {
  const classes = Object.keys(without.jobs).filter(k => withFla.jobs[k]);
  const per = Object.fromEntries(classes.map(k => [k, { tokens_per_second: { without: without.jobs[k].tokens_per_second, with: withFla.jobs[k].tokens_per_second },
    speedup: round(withFla.jobs[k].tokens_per_second / without.jobs[k].tokens_per_second, 3), peak_device_bytes: { without: without.jobs[k].peak_device_bytes, with: withFla.jobs[k].peak_device_bytes } }]));
  const differ = without.kernel_path.fast !== null && withFla.kernel_path.fast !== null && without.kernel_path.fast !== withFla.kernel_path.fast;
  return { comparable: differ, reason: differ ? null : 'the two reports have the same (or an unknown) kernel path', without: { fast: without.kernel_path.fast, fallback: without.kernel_path.fallback_warnings }, with: { fast: withFla.kernel_path.fast, flash_linear_attention: withFla.kernel_path.flash_linear_attention }, per_class: per };
}

// Reads what the runner fetched into <dir> (results/<stage>/..., observations/..., results/rows/*.report.json).
export function loadJ0Observations(dir) {
  const read = f => (existsSync(f) ? readFileSync(f, 'utf8') : null), json = f => { const t = read(f); return t === null ? null : JSON.parse(t); };
  const train = {}, j0b = {};
  for (const klass of Object.keys(J0_CLASSES)) { const d = path.join(dir, 'results', `J0a-${klass}`); train[klass] = { metrics: json(path.join(d, 'training_metrics.json')), log: read(path.join(d, 'train.log')) ?? '' }; }
  for (const arm of ['A', 'B']) { const d = path.join(dir, 'results', `J0b-${arm}`); j0b[arm] = { metrics: json(path.join(d, 'training_metrics.json')), log: read(path.join(d, 'train.log')) ?? '' }; }
  const served = {};
  for (const klass of ['0300', '2k']) for (const c of [1, 4]) { const r = json(path.join(dir, 'results', 'rows', `J0c-${klass}-c${c}.report.json`)); if (r) (served[klass] ??= {})[`c${c}`] = r; }
  return { train, j0b, kernel: { report: json(path.join(dir, 'results', 'J0k-kernels', 'report.json')) }, served,
    host: { freeM: read(path.join(dir, 'observations', 'free-m.txt')), info: json(path.join(dir, 'observations', 'info.json')) } };
}

// ---- the schedule and the budget tracker (§7.4 "Budget and priority") -------------------------------------------------

export const BUDGET = Object.freeze({
  hours: 40,                       // at most 5 nights of 8 h (owner decision O7)
  rateFloor: 1500,                 // a measured rate below this tokens/s switches to the reduced plan
  j0Hours: 0.75, batteryHours: 0.1,  // 1.2 h of forgetting battery over the 12 point reads of the full plan
  secondsPerRequestDefault: 0.2,   // §7.4 "0.075-0.3 s each", before J0c measures it
  questionsPerRequest: 1.5,
  readRows: { base: 15200, withSelect: 17800 },   // calib-OOD 7,000 + dev-OOD 8,200 (+ dev-select 2,600 at 5K, 20K, 40K)
  finalReadRows: 6500 + 42000 + 3900,             // test-in + test-OOD + calib-in
  smokeRows: 4000,                                // one combined wave-2 smoke fine-tune
  programRates: [525, 1500, 4953]                 // the three columns of the program's laptop-time table
});

const withSelect = rows => rows === 5000 || rows === 20000 || rows === 40000;
// The steps of the plan, priority order. A step is either a training run or a read (the forgetting battery is part of a read).
function planItems({ reduced, triggered40K, finalRows }) {
  const train = (id, rows, o = {}) => ({ id, kind: 'train', rows, replay: o.replay ?? RECIPE.replay, epochs: o.epochs ?? 1 });
  const read = (of, rows) => ({ id: `read:${of}`, kind: 'read', rows });
  const pair = (id, rows, o) => [train(id, rows, o), read(id, withSelect(rows) ? BUDGET.readRows.withSelect : BUDGET.readRows.base)];
  const seed1 = (reduced ? ['2.5K', '5K', '20K'] : CURVE_POINTS).flatMap(p => pair(`J2-${POINT_ROWS[p]}-s1`, POINT_ROWS[p]));
  const seed2 = (reduced ? ['5K'] : ['5K', '20K']).flatMap(p => pair(`J2-${POINT_ROWS[p]}-s2`, POINT_ROWS[p]));
  const grid = (reduced ? ['lr4'] : ['lr4', 'ep2', 'rp6', 'np0']).flatMap(g => pair(`J4-${g}`, 5000, { epochs: g === 'ep2' ? 2 : 1, replay: g === 'rp6' ? 6000 : RECIPE.replay }));
  const items = [
    { id: 'P1', name: 'J0 (all parts) and J1', steps: [{ id: 'J0', kind: 'fixed', hours: BUDGET.j0Hours }, { id: 'J1', kind: 'read', rows: BUDGET.readRows.withSelect }] },
    { id: 'P2', name: `Curve seed 1 at ${reduced ? '2.5K, 5K, 20K' : '2.5K, 5K, 10K, 20K'}`, steps: seed1 },
    { id: 'P3', name: `Seed 2 at ${reduced ? '5K' : '5K and 20K'}`, steps: seed2 },
    { id: 'P4', name: reduced ? 'Grid {base, lr4} at 5K (no final retrain)' : 'Grid at 5K (lr4, ep2, rp6, np0) and the final retrain', steps: [...grid, ...(reduced ? [] : pair('J2-final', finalRows))] }
  ];
  if (!reduced) items.push({ id: 'P5', name: '40K if triggered; one combined wave-2 smoke fine-tune (4K rows)', steps: [...(triggered40K ? pair('J2-40000-s1', 40000) : []), { id: 'W2-smoke', kind: 'train', rows: BUDGET.smokeRows, replay: RECIPE.replay, epochs: 1 }] });
  return items;
}

// -> the schedule: the plan chosen by the measured rate, the items in priority order with their hours, J5 reserved first,
// and everything that does not fit cut from the bottom (strict priority: the first item that does not fit and every
// item after it are cut, a later small item is never slipped in). `completed` {stepId: actual hours} replaces estimates.
export function buildSchedule({ model = null, rate = null, secondsPerRequest = BUDGET.secondsPerRequestDefault, budgetHours = BUDGET.hours, triggered40K = false, finalRows = POINT_ROWS['20K'],
  completed = {}, forcePlan = null, floor = BUDGET.rateFloor, j0Hours: j0 = BUDGET.j0Hours } = {}) {
  const m = model ?? (rate ? costModel({ rate }) : null);
  if (!m) throw fail('SCHEDULE_MODEL', 'buildSchedule needs a cost model (analyzeJ0) or a rate');
  const measuredRate = rateAt(m), plan = forcePlan ?? (measuredRate < floor ? 'reduced' : 'full'), reduced = plan === 'reduced';
  const hoursOf = s => {
    if (s.id in completed) return { hours: 0, done: true, actual: completed[s.id] };
    if (s.kind === 'fixed') return { hours: s.id === 'J0' ? j0 : s.hours };
    if (s.kind === 'train') return { hours: m.seconds({ rows: s.rows, replay: s.replay, epochs: s.epochs }) / 3600, tokens: s.epochs * (s.rows * TOKEN_MODEL.perRow + s.replay * TOKEN_MODEL.perReplay) };
    return { hours: (s.rows / BUDGET.questionsPerRequest) * secondsPerRequest / 3600 + BUDGET.batteryHours, reads: 1 };
  };
  const j5 = { id: 'P6', name: 'J5 final read (stock and candidate; always runs)', steps: [{ id: 'J5', kind: 'final' }] };
  const j5Hours = 'J5' in completed ? 0 : 2 * (BUDGET.finalReadRows / BUDGET.questionsPerRequest) * secondsPerRequest / 3600;
  const spent = Object.values(completed).reduce((a, b) => a + b, 0);
  const available = budgetHours - spent - j5Hours;
  let cum = 0, cutFrom = null;
  const items = planItems({ reduced, triggered40K, finalRows }).map((item, i) => {
    const steps = item.steps.map(s => ({ id: s.id, kind: s.kind, ...hoursOf(s) }));
    const hours = steps.reduce((a, s) => a + s.hours, 0), trainHours = steps.filter(s => s.kind === 'train').reduce((a, s) => a + s.hours, 0);
    const tokens = steps.reduce((a, s) => a + (s.tokens ?? 0), 0), reads = steps.filter(s => s.reads && !s.done).length;
    let status;
    if (hours === 0 && steps.every(s => s.done)) status = 'done';
    else if (cutFrom) status = 'cut';
    else if (i === 0 || cum + hours <= available + 1e-9) { status = 'scheduled'; cum += hours; }
    else { status = 'cut'; cutFrom = item.id; }
    const readHours = steps.filter(s => s.kind === 'read').reduce((a, s) => a + s.hours, 0);
    return { id: item.id, name: item.name, priority: i + 1, status, hours: round(hours, 3), trainHours: round(trainHours, 3), readHours: round(readHours, 3), tokens, reads, steps };
  });
  items.push({ id: j5.id, name: j5.name, priority: items.length + 1, status: 'reserved', hours: round(j5Hours, 3), trainHours: 0, readHours: round(j5Hours, 3), tokens: 0, reads: 2, steps: [{ id: 'J5', kind: 'final', hours: j5Hours }] });
  const scheduled = items.filter(i => ['scheduled', 'reserved'].includes(i.status));
  const programmeTokens = items.filter(i => ['P2', 'P3', 'P4'].includes(i.id)).reduce((a, i) => a + i.tokens, 0);
  return {
    plan, switched: reduced, rule: `reduced below ${floor} tokens/s`, rate: { tokens_per_second: round(measuredRate, 1), reference: '5K point mix', model: m.kind, scale: m.scale ?? 1 },
    budget_hours: budgetHours, spent_hours: round(spent, 3), reserved_j5_hours: round(j5Hours, 3), available_hours: round(available, 3), items, scheduled_hours: round(scheduled.reduce((a, i) => a + i.hours, 0) + spent, 3),
    cut_from: cutFrom, over_budget: scheduled.reduce((a, i) => a + i.hours, 0) + spent > budgetHours + 1e-9, training_tokens_p2_p4: programmeTokens, seconds_per_request: secondsPerRequest,
    longest_training_hours: round(Math.max(...items.flatMap(i => i.steps).filter(s => s.kind === 'train').map(s => s.hours), 0), 3),
    points: Object.entries(POINT_ROWS).map(([point, rows]) => {
      const tokens = rows * TOKEN_MODEL.perRow + RECIPE.replay * TOKEN_MODEL.perReplay, hours = m.seconds({ rows, replay: RECIPE.replay }) / 3600;
      return { point, rows, tokens, hours: round(hours, 4), tokens_per_second: round(tokens / (hours * 3600), 1), at_program_rates: Object.fromEntries(BUDGET.programRates.map(r => [r, round(tokens / r / 3600, 4)])) };
    })
  };
}

export function renderScheduleTable(s) {
  const fmtH = h => (h < 1 ? `${Math.round(h * 60)} min` : `${round(h, 1)} h`);
  const lines = [`Plan: **${s.plan}** (${s.rule}; measured ${s.rate.tokens_per_second} tokens/s at the 5K mix, ${s.rate.model} model${s.provisional ? ', provisional' : ''})`, '',
    `| Point | Tokens | ${BUDGET.programRates.map(r => `${r} tok/s`).join(' | ')} | measured |`, `|---|---|${BUDGET.programRates.map(() => '---').join('|')}|---|`];
  for (const p of s.points) lines.push(`| ${p.point} | ${(p.tokens / 1e6).toFixed(1)}M | ${BUDGET.programRates.map(r => fmtH(p.at_program_rates[r])).join(' | ')} | ${fmtH(p.hours)} (${p.tokens_per_second} tok/s) |`);
  lines.push('', `Budget ${s.budget_hours} h (spent ${s.spent_hours} h, J5 reserved ${s.reserved_j5_hours} h, available ${s.available_hours} h)`, '', '| Priority | Item | Status | Hours | Training tokens | Point reads |', '|---|---|---|---|---|---|');
  for (const i of s.items) lines.push(`| ${i.priority} | ${i.name} | ${i.status} | ${i.hours} | ${i.tokens ? `${(i.tokens / 1e6).toFixed(1)}M` : '-'} | ${i.reads || '-'} |`);
  lines.push('', `Scheduled ${s.scheduled_hours} h of ${s.budget_hours} h${s.cut_from ? `; cut from ${s.cut_from}` : ''}${s.over_budget ? '; OVER BUDGET' : ''}.`);
  return lines.join('\n');
}

// Actual hours replace estimates as steps finish; a new measured model or served rate re-prices what is left.
export class BudgetTracker {
  constructor({ file = null, ...opts } = {}) { this.file = file; this.opts = opts; this.completed = {}; this.events = []; if (file && existsSync(file)) this.#load(); }
  #load() { for (const l of readFileSync(this.file, 'utf8').split('\n').filter(Boolean)) { const e = JSON.parse(l); this.events.push(e); if (e.type === 'complete') this.completed[e.step] = (this.completed[e.step] ?? 0) + e.hours; } }
  #log(e) { this.events.push(e); if (this.file) { mkdirSync(path.dirname(this.file), { recursive: true }); appendFileSync(this.file, JSON.stringify(e) + '\n'); } }
  record(step, hours) { if (!step || !Number.isFinite(hours)) return; this.completed[step] = (this.completed[step] ?? 0) + hours; this.#log({ type: 'complete', step, hours: round(hours, 4) }); }
  // a new measured model, served rate or trigger: the remaining steps are re-priced, and a switch of plan is logged
  update(opts) { const before = this.schedule().plan; Object.assign(this.opts, opts); const after = this.schedule().plan; this.#log({ type: 'model', plan_before: before, plan_after: after }); if (before !== after) this.#log({ type: 'switch', from: before, to: after }); return after; }
  schedule() { return buildSchedule({ ...this.opts, completed: this.completed }); }
  get usedHours() { return Object.values(this.completed).reduce((a, b) => a + b, 0); }
}

// After J2 at 5K (§7.4 acceptance): the measured wall time against the J0 prediction. Within 20%: keep the schedule.
// Otherwise the model is rescaled to the measurement, the schedule recomputed (the plan can switch), and the
// deviation logged with its cause (the token model, or the rate).
export function reconcileJ2({ model, point = '5K', rows = POINT_ROWS[point], replay = RECIPE.replay, epochs = 1, measured, tolerance = 0.2, logFile = null, schedule = {} }) {
  const predicted = model.seconds({ rows, replay, epochs }), deviation = measured.wallSeconds / predicted - 1, within = Math.abs(deviation) <= tolerance;
  const predictedTokens = epochs * (rows * TOKEN_MODEL.perRow + replay * TOKEN_MODEL.perReplay);
  const entry = { type: 'j2-reconcile', point, predicted_seconds: round(predicted, 1), measured_seconds: round(measured.wallSeconds, 1), deviation: round(deviation, 4), tolerance, within,
    predicted_forward_tokens: predictedTokens, measured_forward_tokens: measured.forwardTokens ?? null, token_model_error: measured.forwardTokens ? round(measured.forwardTokens / predictedTokens - 1, 4) : null,
    measured_tokens_per_second: measured.forwardTokens ? round(measured.forwardTokens / measured.wallSeconds, 1) : null, action: within ? 'keep' : 'recompute' };
  let out = { entry, within, predicted, deviation, action: entry.action, model };
  if (!within) {
    const scaled = scaleModel(model, measured.wallSeconds / predicted);
    out = { ...out, model: scaled, schedule: buildSchedule({ model: scaled, ...schedule }), previous: buildSchedule({ model, ...schedule }) };
    entry.plan_before = out.previous.plan; entry.plan_after = out.schedule.plan; entry.scheduled_hours_after = out.schedule.scheduled_hours;
  }
  if (logFile) { mkdirSync(path.dirname(logFile), { recursive: true }); appendFileSync(logFile, JSON.stringify(entry) + '\n'); }
  return out;
}

// ---- CLI ---------------------------------------------------------------------------------------------------------------
//   data --out <dir> [--only 0300,2k]       build the J0 throughput files (pinned tokenizer, one Python process per pass)
//   plan-j0 --data <dir> --out <plan.json>  write the J0 plan (validated: sequence only)
//   plan-curve --build <dir> --out <plan.json> [--no-battery]   J1 + the curve, seed 2 and the grid from a build (nested files next to the plan)
//   plan-final --build <dir> --candidate runs/<jobId> --out <plan.json> [--permute f] [--latency f]   J5
//   validate [--plan <plan.json>]           bridge validateParams + buildCommand + the real Kev argparse on every bridge-job stage
//   route <file...>                         kev.benchmark or served, per file
//   report-j0 <run dir>                     the J0 report and the regenerated schedule
//   schedule [--rate N | --report <j0 report.json>] [--seconds-per-request s] [--budget h] [--40k]
//   check-train --log f [--config f] [--metrics f] --records N [--replay M]
//   submit --plan <plan.json> --dir <dir> --confirm-submit   (the only command that talks to the laptop)
function cliArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const next = argv[i + 1]; if (next === undefined || next.startsWith('--')) o[k] = true; else { o[k] = next; i++; } } else o._.push(a);
  }
  return o;
}
async function cli(argv) {
  const [cmd, ...rest] = argv, o = cliArgs(rest), out = x => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));
  switch (cmd) {
    case 'data': { if (!o.out) throw fail('USAGE', '--out is required'); out(buildJ0Data({ dir: o.out, only: o.only ? String(o.only).split(',') : null })); return 0; }
    case 'plan-j0': {
      const dir = path.resolve(String(o.data ?? '.')), manifest = {};
      for (const klass of Object.keys(J0_DATA)) { const file = path.join(dir, `j0-${klass}.jsonl`); const body = readFileSync(file); manifest[klass] = { name: `j0-${klass}.jsonl`, file, sha256: sha256(body), bytes: body.length, records: body.toString('utf8').split('\n').filter(Boolean).length }; }
      const plan = assemblePlan(j0Stages({ data: manifest }), { id: 'J0' });
      if (o.out) writeJson(String(o.out), plan);
      out({ planId: plan.planId, stages: plan.stages.map(s => `${s.id} (${s.kind})`) }); return 0;
    }
    case 'plan-curve': {
      if (!o.build || !o.out) throw fail('USAGE', '--build <build dir> and --out <plan.json> are required');
      const info = buildInfo(path.resolve(String(o.build))), outDir = path.dirname(path.resolve(String(o.out)));
      const nested = nestedPrefixes(info.slices.train.file, { outDir: path.join(outDir, 'nested') });
      const battery = o['no-battery'] ? [] : batteryUnits();
      const plan = assemblePlan([...j1Stages({ reads: [...readUnits(info, ['calib-ood', 'dev-select', 'dev-ood']), ...battery] }), ...curveStages({ info, nested, battery })], { id: `curve-${info.buildId}` });
      writeJson(String(o.out), plan);
      out({ planId: plan.planId, stages: plan.stages.length, nested: nested.map(n => ({ point: n.point, rows: n.rows, exact: n.exact, shortfall: n.shortfall })) }); return 0;
    }
    case 'plan-final': {
      if (!o.build || !o.out || !o.candidate) throw fail('USAGE', '--build, --candidate runs/<jobId> and --out are required');
      const info = buildInfo(path.resolve(String(o.build)));
      const plan = assemblePlan(finalStages({ info, candidate: String(o.candidate), permuteFile: o.permute ? { file: String(o.permute) } : undefined, latencyFile: o.latency ? { file: String(o.latency) } : undefined }), { id: `final-${info.buildId}` });
      writeJson(String(o.out), plan); out({ planId: plan.planId, stages: plan.stages.length }); return 0;
    }
    case 'validate': {
      const stages = o.plan ? JSON.parse(readFileSync(String(o.plan), 'utf8')).stages : j0Stages();
      const r = await validateStages(stages);
      out({ ok: r.ok, stages: r.stages.map(s => ({ id: s.id, validated: s.validated, errors: s.errors })) }); return r.ok ? 0 : 3;
    }
    case 'route': { if (!o._.length) throw fail('USAGE', 'route needs files'); out(o._.map(f => routeFile(f))); return 0; }
    case 'report-j0': {
      const dir = path.resolve(String(o._[0] ?? '.')), report = analyzeJ0(loadJ0Observations(dir));
      writeJson(path.join(dir, 'j0-report.json'), report);
      out(report.schedule_table ?? ''); out({ complete: report.complete, missing: report.missing, fit: report.fit, reference: report.reference }); return report.complete ? 0 : 3;
    }
    case 'schedule': {
      let model, sReq = o['seconds-per-request'] ? Number(o['seconds-per-request']) : undefined;
      if (o.report) { const r = JSON.parse(readFileSync(String(o.report), 'utf8')); model = costModel({ fit: r.fit?.ok ? r.fit : null, perClass: Object.values(r.jobs).map(j => ({ secondsPerRecord: j.seconds_per_record, tokensPerRecord: j.tokens_per_record })) }); sReq ??= r.served?.seconds_per_request_at_reference ?? undefined; }
      else if (o.rate) model = costModel({ rate: Number(o.rate) });
      else throw fail('USAGE', 'give --rate tokens-per-second or --report <j0-report.json>');
      const s = buildSchedule({ model, secondsPerRequest: sReq, budgetHours: o.budget ? Number(o.budget) : BUDGET.hours, triggered40K: !!o['40k'] });
      out(renderScheduleTable(s)); return 0;
    }
    case 'check-train': {
      const read = f => (o[f] ? readFileSync(String(o[f]), 'utf8') : null);
      const r = checkTrainJob({ log: read('log') ?? '', config: read('config') ? JSON.parse(read('config')) : null, metrics: read('metrics') ? JSON.parse(read('metrics')) : null, expect: { fileRecords: Number(o.records), replay: Number(o.replay ?? 0), maxState: o['max-state'] ? Number(o['max-state']) : undefined } });
      out(r); return r.ok ? 0 : 3;
    }
    case 'submit': {
      if (o['confirm-submit'] !== true) throw fail('USAGE', 'submit talks to the laptop bridge; add --confirm-submit (the owner decides when a plan runs)');
      const { connect } = await import('../../bridge/cloud/client.mjs');
      const { client } = await connect();
      const plan = JSON.parse(readFileSync(String(o.plan), 'utf8'));
      const r = await runPlan(plan, { client, dir: path.resolve(String(o.dir)), confirm: true, log: m => console.error(m) });
      out({ stages: Object.fromEntries(Object.entries(r.state.stages).map(([k, v]) => [k, v.status])) }); return 0;
    }
    default: console.error('usage: jobs.mjs data|plan-j0|validate|route|report-j0|schedule|check-train|submit ...'); return 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli(process.argv.slice(2)).then(code => process.exit(code), error => { console.error(`jobs: ${error.code ?? 'ERROR'}: ${error.message}`); process.exit(error.code === 'USAGE' ? 2 : 1); });
}
