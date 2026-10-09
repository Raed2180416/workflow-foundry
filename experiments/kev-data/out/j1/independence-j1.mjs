// Row 18 (BLOCKER-SYNTHESIS §2.1): Jev independence check, Claude reads. Reads the stratified subset
// research/judge-20261009/independence/data/sample.jsonl (built by sample.mjs from the committed Jev rows) with one Claude model per run,
// the way haiku-j1.mjs does: experiments/lib/models.mjs createModelPort (journaled, list-price cost per call), JudgmentPort engine 'model',
// decoding {maxTokens 128, reasoning 'none'}, request = typed choice question (instructions, options, criteria) + the item's state.
// The label, Jev's answer and the stratum are never sent. K = 1 read per item.
//
// Hard cap: the sum of costUsd over every rows file in the output directory (all models) plus the in-flight estimate must stay under CAP.
// A failed call (rate limit, quota, timeout, malformed answer) is a FAULT, not a failure: it is logged as a fault row, the item is retried
// after backoff (2, 4, 8, 16, 32 s, up to MAX_ATTEMPTS), and only an item that never succeeds ends as a fault in the rows file
// (never dropped, never guessed).
//   node independence-j1.mjs --model claude-haiku-5-5 [--cap 3.00] [--sample FILE] [--out DIR] [--only idx,idx,...] [--limit N]
// RAM: concurrency <= 2 (claude -p processes).
import { appendFileSync, existsSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JudgmentPort } from '../../../../src/ports.mjs';
import { createModelPort } from '../../../lib/models.mjs';
import { sources, loadDev } from './lib-j1.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const MODEL = arg('model', 'claude-haiku-5-5');
const CAP = Number(arg('cap', 3.0));
const SAMPLE = arg('sample', path.join(root, 'research/judge-20261009/independence/data/sample.jsonl'));
const DIR = arg('out', path.join(root, 'research/judge-20261009/independence/data'));
const WORKDIR = process.env.KEV_IND_WORK ?? '/var/tmp/foundry-work/kev/independence';   // journal sqlite lives on disk, outside git
const CONC = Math.min(2, Number(process.env.KEV_IND_CONC ?? 2));
const MAX_ATTEMPTS = 5, BASE_MS = 2000, CAP_MS = 60_000;
const ONLY = arg('only', null)?.split(',').map(Number), LIMIT = Number(arg('limit', Infinity));
mkdirSync(DIR, { recursive: true }); mkdirSync(WORKDIR, { recursive: true });
const short = MODEL.replace('claude-', '').replace(/-5-5$/, '');
const ROWS = path.join(DIR, `rows-${short}.jsonl`), FAULTS = path.join(DIR, `faults-${short}.jsonl`);
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// spend so far, all models, in this directory (the cap is for the whole check)
const spentAll = () => readdirSync(DIR).filter(f => /^rows-.*\.jsonl$/.test(f)).flatMap(f => readJsonl(path.join(DIR, f))).reduce((a, r) => a + (r.costUsd ?? 0), 0)
  + readdirSync(DIR).filter(f => /^faults-.*\.jsonl$/.test(f)).flatMap(f => readJsonl(path.join(DIR, f))).reduce((a, r) => a + (r.costUsd ?? 0), 0);
const done = new Set(readJsonl(ROWS).filter(r => !r.fault).map(r => r.idx));
let spent = spentAll();

const sample = readJsonl(SAMPLE);
const src = sources(), dev = {};
for (const g of ['interactive', 'kinetics', 'runbook']) { dev[g] = new Map(loadDev(src[g]).map(r => [`${r.recId}|${r.qid}`, r])); }
let todo = sample.filter(s => !done.has(s.idx) && (!ONLY || ONLY.includes(s.idx)));
todo = todo.slice(0, LIMIT);
console.log(`model ${MODEL}: todo ${todo.length} of ${sample.length}, spent so far $${spent.toFixed(4)}, cap $${CAP}`);

const { port: modelPort, db } = createModelPort({ journalFile: path.join(WORKDIR, `journal-${short}.sqlite`), concurrency: { 'claude-cli': CONC } });
const judge = new JudgmentPort({ engine: 'model', model: modelPort, modelId: MODEL, classBudget: 16000, runId: `kev-independence-${short}`, decoding: { maxTokens: 128, reasoning: 'none' } });
const costs = readJsonl(ROWS).filter(r => r.costUsd).map(r => r.costUsd);
const est = () => (costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0.01);
let inflight = 0, stopped = false, n = 0, okN = 0, faultN = 0;

async function one(s) {
  const it = dev[s.group].get(`${s.recId}|${s.qid}`);
  if (!it) throw new Error(`sample item ${s.idx} not found in the ${s.group} dev-select file`);
  // sanity: the sampled item is the one we think it is (label option comes from the dev file, never sent)
  if (it.label !== s.jevLabelOption) throw new Error(`label mismatch for item ${s.idx}`);
  const req = { port: it.qid.replace(/[^A-Za-z0-9_.-]/g, '_'), question: it.instructions, options: it.options,
    criteria: it.type === 'choice' ? it.options.map(o => `${o}: ${it.criteria[o]}`).filter(c => c.trim()) : [], state: it.state };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (spent + (inflight + 1) * est() * 1.5 > CAP) { stopped = true; return; }
    inflight++;
    const t = Date.now();
    try {
      const res = await judge.judge({ ...req, nodeKey: `kev-independence/${s.group}/${s.recId}/${s.qid}`, ...(attempt > 1 ? { attempt } : {}) });
      spent += res.costUsd ?? 0; costs.push(res.costUsd ?? 0); okN++;
      appendFileSync(ROWS, JSON.stringify({ idx: s.idx, group: s.group, recId: s.recId, qid: s.qid, port: s.port, label: it.label, chosen: res.chosen, correct: res.chosen === it.label, confidence: res.confidence, probabilities: res.probabilities, costUsd: res.costUsd, wallMs: Date.now() - t, model: res.model, attempts: attempt }) + '\n');
      return;
    } catch (e) {
      faultN++;
      appendFileSync(FAULTS, JSON.stringify({ idx: s.idx, attempt, fault: true, error: { code: e.code ?? null, message: String(e.message).slice(0, 400) }, at: new Date().toISOString(), wallMs: Date.now() - t, costUsd: e.costUsd ?? 0 }) + '\n');
      console.log('FAULT', s.idx, attempt, e.code, String(e.message).slice(0, 160));
      if (attempt === MAX_ATTEMPTS) { appendFileSync(ROWS, JSON.stringify({ idx: s.idx, group: s.group, recId: s.recId, qid: s.qid, port: s.port, fault: true, error: { code: e.code ?? null, message: String(e.message).slice(0, 200) } }) + '\n'); return; }
      await sleep(Math.min(CAP_MS, BASE_MS * 2 ** (attempt - 1)));
    } finally { inflight--; n++; if (n % 20 === 0) console.log(`${n} calls, ${okN} ok, ${faultN} faults, spent $${spent.toFixed(4)}`); }
  }
}
const queue = [...todo];
await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length && !stopped) await one(queue.shift()); }));
// export the journal (request + response of every call) beside the rows: model outputs are irreproducible
import('node:fs').then(fs => {
  const rows = db.prepare('SELECT * FROM model_calls ORDER BY id').all();
  fs.writeFileSync(path.join(DIR, `journal-model-calls-${short}.jsonl`), rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  db.close();
  console.log(`finished ${MODEL}: ${okN} ok, ${faultN} faults, spent $${spent.toFixed(4)} of $${CAP}${stopped ? ' (stopped at the cap)' : ''}, ${queue.length} items left`);
});
