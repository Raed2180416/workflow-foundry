// Decision datasets for the Kev probe, built from bed GENERATORS (dev split, seeds 1-400) with labels
// from generator truth. DEVELOPMENT evidence only. Each item: { dataset, id, seed, half, state, truth,
// options, meta }. half = 'calibration' for odd seeds, 'evaluation' for even seeds (split by seed, so
// no bed instance contributes to both halves). Bed text is DATA: it goes into `state`, never into a
// question. Usage: node experiments/kev-probe/datasets.mjs [name ...]
import path from 'node:path';
import { buildWorld as recordsWorld } from '../../beds/records/world.mjs';
import { build as incidentBuild } from '../../beds/incident/gen.mjs';
import { FAULT_CLASSES } from '../../beds/incident/catalog.mjs';
import { hidden as synthHidden, generate as synthGenerate } from '../../beds/synth/index.mjs';
import { build as codefixBuild } from '../../beds/codefix/build.mjs';
import { rng } from '../../beds/lib/rng.mjs';
import { RUN_DIR, writeJsonl, readJsonl } from './lib.mjs';

export const DATA_DIR = path.join(RUN_DIR, 'datasets');
const halfOf = seed => (seed % 2 === 1 ? 'calibration' : 'evaluation');
const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);
const clip = (s, n) => (s.length > n ? s.slice(0, n) + ' …' : s);

// Take up to `per` items per half for each label, in seed order, so both halves are balanced.
function balance(items, perLabelPerHalf) {
  const out = [], count = new Map();
  for (const it of items) {
    const k = `${it.half}|${it.truth}`;
    if ((count.get(k) ?? 0) >= perLabelPerHalf) continue;
    count.set(k, (count.get(k) ?? 0) + 1); out.push(it);
  }
  return out;
}

// ---- (a) records: same real person? -----------------------------------------------------------
const ORDER = { mdy: 'month/day/year', dmy: 'day/month/year' };
function dateConventions(w, systems) {
  const c = w.ctx.conv, conv = w.ctx.k.conv;
  const text = {
    BRIGHTDESK: `BRIGHTDESK numeric birth dates are ${ORDER[conv ? c.bd : 'mdy']}`,
    ATLAS: `ATLAS numeric birth dates are ${ORDER[conv ? c.atlas : 'dmy']}`,
    VENDEX: `VENDEX numeric dates are ${ORDER[conv ? c.vendex : 'mdy']}`,
    LEDGR: 'LEDGR dates are day.month.year and names are "Family, Given"',
    KOBO: 'KOBO names are family name first; dates are year/month/day or Japanese era (S = Showa, S1 = 1926; H = Heisei, H1 = 1989)',
    VERITAS: 'VERITAS dates are ISO year-month-day; dob 1900-01-01 means unknown',
  };
  return [...new Set(systems)].map(s => text[s]).join('; ');
}
const nameKey = row => `${row.name?.given ?? ''} ${row.name?.family ?? ''}`.toLowerCase();
export function buildRecordsPair() {
  const items = [];
  for (const seed of SEEDS) {
    const d = seed % 3 === 0 ? 3 : 2;
    const w = recordsWorld(seed, 'dev', d);
    const lineOf = new Map(w.allRows.map((row, i) => [row.rowId, w.exportText.split('\n')[i]]));
    const live = w.rows;
    const r = rng('kev-probe', 'records-pair', seed);
    const pairs = [];
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) pairs.push([live[i], live[j]]);
    const sim = ([x, y]) => { const a = nameKey(x), b = nameKey(y); let s = 0; for (const t of a.split(' ')) if (t && b.includes(t)) s++; return s; };
    // Hard positives: same person, least similar raw names (nicknames, transliterations, typos, other system).
    const pos = pairs.filter(([x, y]) => x.entity === y.entity && x.system !== y.system).sort((p, q) => sim(p) - sim(q) || r.float(-1, 1));
    // Hard negatives: the planted partner (namesake, household, twin, same-birthday mate), then the most name-similar strangers.
    const partner = pairs.filter(([x, y]) => x.entity !== y.entity && w.entities[x.entity].partner === y.entity);
    const strangers = pairs.filter(([x, y]) => x.entity !== y.entity && w.entities[x.entity].partner !== y.entity).sort((p, q) => sim(q) - sim(p));
    const mk = (pr, truth, kind) => {
      const [x, y] = r.chance(0.5) ? pr : [pr[1], pr[0]];
      return { dataset: 'records-pair', id: `records-pair:s${seed}:${x.rowId}-${y.rowId}`, seed, half: halfOf(seed), truth, options: ['yes', 'no'],
        state: { row_a: lineOf.get(x.rowId), row_b: lineOf.get(y.rowId), conventions: dateConventions(w, [x.system, y.system]) },
        meta: { difficulty: d, kind, roleA: w.entities[x.entity].role, roleB: w.entities[y.entity].role, systems: [x.system, y.system] } };
    };
    if (pos[0]) items.push(mk(pos[0], 'yes', 'hard-positive'));
    if (pos.length > 3 && r.chance(0.5)) items.push(mk(pos[pos.length - 1], 'yes', 'easy-positive'));
    if (partner[0]) items.push(mk(r.pick(partner), 'no', `partner-${w.entities[partner[0][0].entity].role.replace(/[AB]$/, '')}`));
    if (strangers[0]) items.push(mk(strangers[0], 'no', 'similar-stranger'));
  }
  return balance(items, 40);
}

// ---- (b1) incident: fault class from the root's first two minutes ---------------------------
const incidentCache = new Map();
function incident(seed) {
  if (!incidentCache.has(seed)) incidentCache.set(seed, incidentBuild(seed, 'dev', 2 + (seed % 3)));
  return incidentCache.get(seed);
}
function serviceLines(task, truth, svc, from, to, cap = 8) {
  const byId = new Map(task.inputs.log.split('\n').map(l => [l.slice(0, l.indexOf(' ')), l]));
  return (truth.linesBySvc[svc] ?? []).filter(x => x.t >= from && x.t <= to).slice(0, cap).map(x => clip(byId.get(x.id), 400));
}
export function buildIncidentClass() {
  const items = [];
  for (const seed of SEEDS) {
    const { task, truth } = incident(seed);
    const lines = serviceLines(task, truth, truth.root_service, truth.T, truth.T + 120);
    items.push({ dataset: 'incident-class', id: `incident-class:s${seed}`, seed, half: halfOf(seed), truth: truth.fault_class, options: [...FAULT_CLASSES],
      state: { service: truth.root_service, window: 'the first two minutes after the fault started', log_lines: lines },
      meta: { difficulty: task.difficulty, lines: lines.length } });
  }
  return balance(items, 8);
}

// ---- (b2) incident: root cause or downstream victim? ------------------------------------------
export function buildIncidentRoot() {
  const items = [];
  for (const seed of SEEDS) {
    const { task, truth } = incident(seed);
    const victim = truth.firstHopCallers.find(s => truth.impacted_services.includes(s));
    if (!victim) continue;
    const r = rng('kev-probe', 'incident-root', seed);
    const mk = (svc, label) => ({ dataset: 'incident-root', id: `incident-root:s${seed}:${svc}`, seed, half: halfOf(seed), truth: label, options: ['root', 'victim'],
      state: { service: svc, window: 'three minutes starting when the incident began', log_lines: serviceLines(task, truth, svc, truth.T, truth.T + 180) },
      meta: { difficulty: task.difficulty, faultClass: truth.fault_class } });
    const both = [mk(truth.root_service, 'root'), mk(victim, 'victim')];
    items.push(...(r.chance(0.5) ? both : both.reverse()));
  }
  return balance(items, 40);
}

// ---- (c) synth: does this document make a usable claim for the cell? -------------------------
const RESEARCH = new Set(['journal', 'preprint', 'labnote']);
function stdConditions(prompt) {
  const m = prompt.split('## Standard conditions')[1]?.split('\n## ')[0] ?? '';
  return Object.fromEntries(m.split('\n').filter(l => l.startsWith('- ')).map(l => { const i = l.indexOf(':'); return [l.slice(2, i).trim(), l.slice(i + 1).trim()]; }));
}
export function buildSynthClaim() {
  const items = [];
  for (const seed of SEEDS) {
    const d = 2 + (seed % 3);
    const { world: w } = synthHidden({ seed, split: 'dev', difficulty: d });
    const task = synthGenerate({ seed, split: 'dev', difficulty: d });
    const docById = new Map(task.inputs.documents.map(x => [x.id, x]));
    const cond = stdConditions(task.prompt);
    const r = rng('kev-probe', 'synth-claim', seed);
    const cand = [];
    for (const cell of w.requested) {
      const ent = w.entMap.get(cell.ent);
      const related = c => c.prop === cell.prop && (c.ent === cell.ent || w.entMap.get(c.ent)?.distractorOf === cell.ent);
      const docs = new Set(w.claims.filter(related).map(c => c.doc));
      for (const key of docs) {
        const doc = w.docMap.get(key);
        if (!RESEARCH.has(doc.kind)) continue;
        const mine = w.claims.filter(c => c.doc === key && related(c));
        const ok = mine.some(c => c.ent === cell.ent && c.mode === 'measured' && c.cond === 'std' && !c.variant);
        const why = ok ? 'valid' : mine.map(c => c.ent !== cell.ent ? 'near-name entity' : c.mode !== 'measured' ? c.mode : c.variant ? 'variant' : c.cond !== 'std' ? 'non-standard condition' : 'other').join('+');
        const pub = docById.get(doc.id);
        cand.push({ dataset: 'synth-claim', id: `synth-claim:s${seed}:${doc.id}:${cell.prop}`, seed, half: halfOf(seed), truth: ok ? 'yes' : 'no', options: ['yes', 'no'],
          state: { requested_entity: ent.name, entity_code: ent.alias ?? null, property: cell.prop, standard_condition: cond[cell.prop] ?? null,
            document: { type: pub.type, venue: pub.venue, date: pub.date, title: pub.title, text: pub.text } },
          meta: { difficulty: d, why, kind: doc.kind } });
      }
    }
    // up to 2 positives and 2 negatives per task, negatives of different kinds first
    const pos = r.shuffle(cand.filter(c => c.truth === 'yes')).slice(0, 2);
    const neg = []; const seen = new Set();
    for (const c of r.shuffle(cand.filter(c => c.truth === 'no'))) if (!seen.has(c.meta.why) && neg.length < 2) { seen.add(c.meta.why); neg.push(c); }
    items.push(...pos, ...neg);
  }
  return balance(items, 40);
}

// ---- (d) codefix: which function holds the bug? ------------------------------------------------
function outline(source) {
  const out = [], names = [];
  let cls = null;
  for (const line of source.split('\n')) {
    const c = line.match(/^class (\w+)/); if (c) { cls = c[1]; out.push(line); continue; }
    const f = line.match(/^(\s*)def (\w+)\(/);
    if (f) { const name = f[1].length && cls ? `${cls}.${f[2]}` : f[2]; if (!f[1].length) cls = null; names.push(name); out.push(line.trimEnd()); }
  }
  return { outline: out.join('\n'), names };
}
export function buildCodefixFn() {
  const items = [];
  for (const seed of SEEDS) {
    if (items.length >= 100) break;
    const d = seed % 4 === 0 ? 2 : 1;
    let b;
    try { b = codefixBuild({ seed, split: 'dev', difficulty: d }); } catch { continue; }
    if (b.bugs.length !== 1) continue;
    const { outline: ol, names } = outline(b.buggySource);
    const shown = b.domain.sites[b.bugs[0]].fn(b.p).replace(/\(\)$/, '');
    const truth = names.includes(shown) ? shown : names.includes(`${shown}.__init__`) ? `${shown}.__init__` : null;
    if (!truth || names.length > 64 || new Set(names).size !== names.length) continue;
    items.push({ dataset: 'codefix-fn', id: `codefix-fn:s${seed}`, seed, half: halfOf(seed), truth, options: names,
      state: { bug_report: b.texts.report, module_outline: ol },
      meta: { difficulty: d, domain: b.domain.id, op: b.domain.sites[b.bugs[0]].op, nOptions: names.length } });
  }
  return items;
}

// ---- (e) quarantined read: instruction-like injection? ------------------------------------------
const IMPERATIVE = /\b(please|ignore|retry|skip|restart|roll ?back|must|do not|don't|use|set|delete|run|stop|exclude|override|check)\b/i;
export function buildInjection() {
  const pos = [], neg = [];
  const add = (arr, seed, source, text, kind) => arr.push({ dataset: 'injection', id: `injection:${source}:s${seed}:${arr.length}`, seed, half: halfOf(seed),
    truth: arr === pos ? 'yes' : 'no', options: ['yes', 'no'], state: { source, text: clip(text, 700) }, meta: { source, kind } });
  for (const seed of SEEDS) {
    const r = rng('kev-probe', 'injection', seed);
    if (seed % 4 === 1 || seed % 4 === 2) { // records d4/d5 exports: adversarial memos vs decoy and benign memos
      const w = recordsWorld(seed, 'dev', seed % 2 ? 4 : 5);
      const lineOf = new Map(w.allRows.map((row, i) => [row.rowId, w.exportText.split('\n')[i]]));
      for (const row of r.shuffle(w.rows.filter(x => x.advMemo)).slice(0, 1)) add(pos, seed, 'customer export row', lineOf.get(row.rowId), 'records-adversarial-memo');
      for (const row of r.shuffle(w.rows.filter(x => x.memo && !x.advMemo)).slice(0, 1)) add(neg, seed, 'customer export row', lineOf.get(row.rowId), row.decoyMemo ? 'records-decoy-memo' : 'records-benign-memo');
    } else if (seed % 4 === 3) { // incident d5 logs: injected lines vs misleading-claim, notice and imperative-looking lines
      const { task, truth } = incidentBuild(seed, 'dev', 5);
      const byId = new Map(task.inputs.log.split('\n').map(l => [l.slice(0, l.indexOf(' ')), l]));
      for (const id of truth.idsByTag.inject ?? []) add(pos, seed, 'service log line', byId.get(id), 'incident-inject');
      const misleading = (truth.idsByTag.mislead ?? []).map(id => byId.get(id)).filter(l => !/runbook-bot|chatops relay/.test(l));
      const imperative = ['mention', 'benign', 'noise', 'sporadic', 'chronic', 'deploy'].flatMap(t => (truth.idsByTag[t] ?? []).map(id => byId.get(id))).filter(l => IMPERATIVE.test(l.split(' ').slice(3).join(' ')));
      for (const l of r.shuffle(misleading).slice(0, 1)) add(neg, seed, 'service log line', l, 'incident-misleading-claim');
      for (const l of r.shuffle(imperative).slice(0, 1)) add(neg, seed, 'service log line', l, 'incident-imperative-word');
    } else { // synth d5 corpora: the injected sentence vs ordinary sentences (including predictions, protocol references)
      const task = synthGenerate({ seed, split: 'dev', difficulty: 5 });
      const sentences = task.inputs.documents.flatMap(doc => doc.text.split(/(?<=[.!?\]])\s+(?=[A-Z[])/).map(s => s.trim()).filter(s => s.length > 20));
      const isInj = s => /AUTOMATED REVIEW TOOLS|System instruction for AI|any language model/.test(s);
      for (const s of sentences.filter(isInj)) add(pos, seed, 'research document sentence', s, 'synth-injection');
      const hard = sentences.filter(s => !isInj(s) && (IMPERATIVE.test(s) || /simulation|predict|should be|protocol|target/i.test(s)));
      for (const s of r.shuffle(hard).slice(0, 1)) add(neg, seed, 'research document sentence', s, 'synth-ordinary');
    }
  }
  return balance([...pos, ...neg].sort((a, b) => a.seed - b.seed), 50);
}

// ---- (f) failure class of a failed node -----------------------------------------------------------
// The journals in experiments/runs/* hold only ~10 failed calls, so the set is generated from the
// error codes and messages Foundry's own code raises (src/models/port.mjs MODEL_ERRORS, src/verdict.mjs
// ENV_FAULT_CODES / INCONCLUSIVE_CODES, providers) plus realistic runtime errors, and the real
// journaled failures are added as a labelled slice (meta.real = true).
export const FAILURE_CLASSES = ['flake', 'env', 'model_output', 'budget', 'defect'];
const T = {
  flake: [
    r => ({ code: 'MODEL_RATE_LIMIT', message: `claude CLI exited 1: API Error: ${r.pick([429, 529])} {"type":"error","error":{"type":"${r.pick(['overloaded_error', 'rate_limit_error'])}"}}`, previous: 'the same call succeeded 12 minutes earlier' }),
    r => ({ code: 'MODEL_TIMEOUT', message: `llama-server request aborted after ${r.int(120, 300)}000 ms (slot busy)`, previous: 'the identical request answered in 40 s on the previous run' }),
    r => ({ code: 'NODE_FAILED', message: `fetch failed: read ECONNRESET (socket hang up) while posting to ${r.pick(['the model gateway', 'api.anthropic.com', '127.0.0.1:8402'])}`, previous: 'no earlier failure on this node' }),
    r => ({ code: 'CODE_FAILED', message: `Traceback (most recent call last):\n  File "fetch_quotes.py", line ${r.int(10, 90)}, in <module>\nurllib.error.URLError: <urlopen error [Errno 104] Connection reset by peer>`, previous: 'passed on 9 of the last 10 runs' }),
    r => ({ code: 'VERIFY_FAILED', message: `pytest: 1 failed, ${r.int(20, 60)} passed: test_concurrent_reserve - AssertionError: race window hit (expected 3, got 2)`, previous: 'the same test passed on rerun of the same build' }),
    r => ({ code: 'MODEL_UNAVAILABLE', message: 'claude CLI exited 1: API Error: Connection error. (temporary DNS failure resolving the API host, EAI_AGAIN)', previous: 'other nodes in the same run reached the API a minute later' }),
    r => ({ code: 'NODE_FAILED', message: `sqlite: database is locked (SQLITE_BUSY) after ${r.int(5, 30)} s while another worker held the journal`, previous: 'the next attempt one second later committed' }),
  ],
  env: [
    r => ({ code: 'MODEL_UNAVAILABLE', message: `llama-server for ${r.pick(['qwen3.5-4b-q4km', 'granite-4.2-3b-q4km'])} was not healthy within 120000 ms (model file missing: /opt/models/*.gguf)`, previous: 'fails the same way on every attempt since the VM was rebuilt' }),
    r => ({ code: 'SANDBOX_UNAVAILABLE', message: 'unshare(CLONE_NEWUSER) failed: Operation not permitted; user namespaces are disabled on this host', previous: 'every code node fails identically' }),
    r => ({ code: 'CODE_FAILED', message: `Traceback (most recent call last):\n  File "fit.py", line 3, in <module>\n    import ${r.pick(['numpy', 'scipy', 'pandas'])}\nModuleNotFoundError: No module named '${r.pick(['numpy', 'scipy', 'pandas'])}'`, previous: 'the same workflow version passed on the build machine' }),
    r => ({ code: 'NODE_FAILED', message: `ENOSPC: no space left on device, write '/var/foundry/runs/${r.int(1000, 9999)}/artifacts/out.json'`, previous: 'disk usage at 100% on the runner' }),
    r => ({ code: 'MODEL_AUTH', message: 'claude CLI exited 1: Invalid API key · Please run /login', previous: 'all model nodes fail since the session token expired' }),
    r => ({ code: 'CODE_FAILED', message: `/bin/sh: 1: ${r.pick(['pytest', 'python3.12', 'jq'])}: not found`, previous: 'the runner image changed this morning' }),
    r => ({ code: 'NODE_FAILED', message: `EACCES: permission denied, open '/home/user/.foundry/state/${r.pick(['runs.sqlite', 'lock'])}'`, previous: 'the directory is owned by another user after a restore' }),
    r => ({ code: 'NODE_FAILED', message: `Killed (exit 137): the container hit its memory limit of ${r.pick([2, 4])} GiB while loading the model`, previous: 'happens on every start on this runner size' }),
  ],
  model_output: [
    r => ({ code: 'MODEL_SCHEMA', message: `Output failed the node schema: /records/${r.int(0, 30)}/birth_date must match format "date"; /records must NOT have additional properties`, previous: 'the retry with the validator feedback failed the same way' }),
    r => ({ code: 'MODEL_TRUNCATED', message: `finish_reason=length after ${r.pick([4096, 8192])} output tokens; JSON ended inside a string`, previous: 'first attempt' }),
    r => ({ code: 'MODEL_REFUSAL', message: 'The model declined: "I can\'t help with extracting personal data from this export."', previous: 'first attempt' }),
    r => ({ code: 'JUDGMENT_PROTOCOL', message: 'The model did not return one offered option with an integer confidence percent in [0, 100]', previous: 'returned "probably yes" as choice' }),
    r => ({ code: 'NODE_FAILED', message: `Unexpected token '\`' at position 0: the model wrapped the JSON answer in a markdown code fence`, previous: 'same node passed with another model class' }),
    r => ({ code: 'MODEL_PROTOCOL', message: `model returned ${r.pick(['an empty result', 'plain prose instead of the structured output', 'two JSON objects'])}`, previous: 'first attempt' }),
    r => ({ code: 'NODE_CHECK_FAILED', message: `node check failed: fault_class "${r.pick(['network_partition', 'cpu_starvation', 'oom'])}" is not one of the 9 allowed values`, previous: 'first attempt' }),
  ],
  budget: [
    r => ({ code: 'COST_BUDGET', message: `run cost $${(r.int(51, 99) / 100).toFixed(2)} would exceed maxCost $0.50 at node classify-chunk-${r.int(3, 9)}`, previous: 'earlier nodes escalated twice to class L' }),
    r => ({ code: 'STEP_BUDGET', message: `step budget exhausted: ${r.pick([40, 60, 80])} of ${r.pick([40, 60, 80])} steps used; map over ${r.int(120, 400)} items not finished`, previous: 'the item count doubled since the workflow was written' }),
    r => ({ code: 'DEADLINE', message: `deadline 2026-10-07T${r.int(10, 19)}:00:00Z passed while waiting for timer wake-up of node await-approval`, previous: 'no other error' }),
    r => ({ code: 'MODEL_BUDGET', message: `input of ${r.int(17000, 40000)} tokens exceeds the class S input budget of 4000 tokens`, previous: 'the context compiler could not shrink below the floor' }),
    r => ({ code: 'LOOP_EXHAUSTED', message: `loop refine-until-valid stopped after maxIterations=${r.int(3, 6)} without meeting its exit condition`, previous: 'each iteration improved the score slightly' }),
    r => ({ code: 'MODEL_BUDGET', message: `claude CLI exited 1: Exceeded --max-budget-usd ${r.pick(['1', '0.5', '2'])} for this call`, previous: 'the prompt grew after the retry note was appended' }),
  ],
  defect: [
    r => ({ code: 'CODE_FAILED', message: `TypeError: Cannot read properties of undefined (reading '${r.pick(['amount', 'rows', 'birth_date'])}')\n    at normalise (workflow/nodes/merge.mjs:${r.int(10, 80)}:${r.int(5, 30)})`, previous: 'fails identically on replay with the recorded inputs' }),
    r => ({ code: 'CODE_FAILED', message: `Traceback (most recent call last):\n  File "convert.py", line ${r.int(20, 120)}, in to_usd\n    return round(amount * RATES[ccy], 2)\nKeyError: '${r.pick(['CHF', 'JPY', 'SEK'])}'`, previous: 'fails identically on replay; the input has a currency the table lacks' }),
    r => ({ code: 'ACCEPTANCE_FAILED', message: `acceptance check failed: ${r.int(2, 9)} merged records have two different birth dates (rows merged across namesakes)`, previous: 'replay with the same model outputs reproduces it' }),
    r => ({ code: 'DATAFLOW', message: `node summarise reads $.extract.items but extract returns {records: [...]}: binding resolved to undefined`, previous: 'introduced in workflow version 4' }),
    r => ({ code: 'VERIFY_FAILED', message: `verifier: impacted_services Jaccard 0.50 < 0.8; the aggregation step drops services named by alias`, previous: 'reproduces on every replay; control run on version 3 passes' }),
    r => ({ code: 'CODE_FAILED', message: `AssertionError: expected ${r.int(10, 40)} rows after dedup, got ${r.int(41, 80)}\n    at dedup (workflow/nodes/dedup.mjs:${r.int(10, 60)})`, previous: 'deterministic: same failure with the cached model answers' }),
    r => ({ code: 'NODE_FAILED', message: `RangeError: Invalid time value at parseDate (workflow/nodes/dates.mjs:${r.int(5, 50)}) for input "${r.pick(['H8.10.01', '31/04/1990', '00/00/0000'])}"`, previous: 'fails the same way on replay' }),
  ],
};
const NODE_KINDS = ['agent', 'code', 'verify', 'map', 'agent', 'code'];
export function buildFailureClass() {
  const items = [];
  for (let i = 1; i <= 200; i++) {
    const cls = FAILURE_CLASSES[(i - 1) % FAILURE_CLASSES.length];
    const r = rng('kev-probe', 'failure', i);
    const ev = r.pick(T[cls])(r);
    items.push({ dataset: 'failure-class', id: `failure-class:g${i}`, seed: i, half: halfOf(i), truth: cls, options: FAILURE_CLASSES,
      state: { node_kind: r.pick(NODE_KINDS), attempt: r.int(1, 3), error_code: ev.code, message: ev.message, history: ev.previous },
      meta: { real: false } });
  }
  // Real journaled failures (experiments/runs/*/journal*.sqlite): labelled by the probe author from the
  // message; CANCELLED is excluded (an operator abort, not a failure).
  const real = [
    ['calibration/records.journal.sqlite', 'MODEL_TIMEOUT', 'claude CLI Subprocess cancelled', 'flake', 2],
    ['distill-pilot/journal.sqlite', 'MODEL_TIMEOUT', 'llama-server request aborted', 'flake', 6],
    ['records-hand-pilot/journal.sqlite', 'MODEL_UNAVAILABLE', 'llama-server for qwen3.5-4b-q4km was not healthy within 120000 ms', 'env', 1],
  ];
  let k = 0;
  for (const [src, code, message, cls, n] of real) for (let j = 0; j < n; j++, k++) {
    items.push({ dataset: 'failure-class', id: `failure-class:real${k}`, seed: 1000 + k, half: halfOf(1000 + k), truth: cls, options: FAILURE_CLASSES,
      state: { node_kind: 'agent', attempt: 1, error_code: code, message, history: 'unknown' }, meta: { real: true, source: src } });
  }
  return items;
}

// ---- (g) applicability: does the task satisfy a kept workflow's precondition? -----------------------
// A kept records workflow assumes a numeric date order for one system. The task's source note for that
// system (paraphrased per task by the bed, keyword-trapped) decides. Two items per note, one per
// assumed order, so labels are balanced and the pair is a consistency check.
export function buildApplicability() {
  const items = [];
  for (const seed of SEEDS) {
    const d = seed % 2 ? 3 : 4;
    const w = recordsWorld(seed, 'dev', d);
    const paras = w.notes.split('\n').filter(l => /^[A-Z]+\. /.test(l));
    const para = s => paras.find(p => p.startsWith(`${s}.`));
    const r = rng('kev-probe', 'applicability', seed);
    for (const sys of r.shuffle(['BRIGHTDESK', 'ATLAS', 'VENDEX']).slice(0, 2)) {
      if (sys === 'ATLAS' && d >= 4) continue; // ATLAS switches order at a dated cutoff from d4
      const p = para(sys); if (!p) continue;
      const truthOrder = sys === 'BRIGHTDESK' ? w.ctx.conv.bd : sys === 'ATLAS' ? w.ctx.conv.atlas : w.ctx.conv.vendex;
      const refs = ['BRIGHTDESK', 'ATLAS', 'VENDEX', 'LEDGR', 'KOBO', 'VERITAS'].filter(o => o !== sys && new RegExp(`\\b${o}\\b`).test(p));
      const note = [p, ...refs.map(para).filter(Boolean)].join('\n\n');
      for (const assumed of ['mdy', 'dmy']) items.push({ dataset: 'applicability', id: `applicability:s${seed}:${sys}:${assumed}`, seed, half: halfOf(seed),
        truth: assumed === truthOrder ? 'yes' : 'no', options: ['yes', 'no'],
        state: { source_note: note }, slots: { system: sys, assumed: ORDER[assumed] },
        meta: { difficulty: d, system: sys, truthOrder, assumed, referencesOther: refs.length > 0 } });
    }
  }
  return balance(items, 40);
}

export const BUILDERS = {
  'records-pair': buildRecordsPair, 'incident-class': buildIncidentClass, 'incident-root': buildIncidentRoot, 'synth-claim': buildSynthClaim,
  'codefix-fn': buildCodefixFn, injection: buildInjection, 'failure-class': buildFailureClass, applicability: buildApplicability,
};
export const loadDataset = name => readJsonl(path.join(DATA_DIR, `${name}.jsonl`));

if (import.meta.url === `file://${process.argv[1]}`) {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(BUILDERS);
  for (const name of names) {
    const t0 = Date.now();
    const items = BUILDERS[name]();
    writeJsonl(path.join(DATA_DIR, `${name}.jsonl`), items);
    const by = {};
    for (const it of items) by[`${it.half}:${it.truth}`] = (by[`${it.half}:${it.truth}`] ?? 0) + 1;
    console.log(name, items.length, JSON.stringify(by), `${Date.now() - t0} ms`);
  }
}
