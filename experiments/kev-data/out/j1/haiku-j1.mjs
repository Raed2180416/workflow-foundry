// §5 item 7 (weak model, zero-shot typed) on dev-select only, as a development read: claude-haiku-5-5 through
// experiments/lib/models.mjs createModelPort (journaled, list-price cost per call) and JudgmentPort engine 'model',
// decoding {maxTokens 128, reasoning 'none'}. Items are drawn per port (question id + family) in sha256 order of
// "kev-j1-haiku|<record id>|<question id>", so any cut is a nested prefix. Hard budget: stops submitting once
// spent + in-flight estimate reaches CAP. Resumable (done keys from the rows file).
// Re-pointed 2026-10-09 (laptop, after the cloud builds were lost): the three surviving dev-select files via lib-j1 sources(), so the
// port key is question id + family for kinetics (verified rebuild sidecar) and the question id alone for interactive and runbook.
// A failed call (rate limit, quota, timeout) is kept as a row with its error code: a fault, never a silent drop or a guess.
// KEV_J1_HAIKU_CONC sets the concurrency (designed 4; the laptop run used 2 to keep claude -p processes within RAM).
//   node haiku-j1.mjs <perPort> <capUsd> [outDir]
import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { JudgmentPort } from '../../../../src/ports.mjs';
import { createModelPort } from '../../../lib/models.mjs';
import { WORK, J1_GROUPS, sources, loadDev } from './lib-j1.mjs';

const PER = Number(process.argv[2] ?? 2), CAP = Number(process.argv[3] ?? 0.2), DIR = process.argv[4] ?? path.join(WORK, 'haiku');
const MODEL = 'claude-haiku-5-5', CONC = Number(process.env.KEV_J1_HAIKU_CONC ?? 4);
mkdirSync(DIR, { recursive: true });
const ROWS = path.join(DIR, 'rows.jsonl');
const h = s => createHash('sha256').update(s).digest('hex');
const prior = existsSync(ROWS) ? readFileSync(ROWS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const done = new Set(prior.filter(r => !r.error).map(r => `${r.recId}|${r.qid}`));
let spent = prior.reduce((a, r) => a + (r.costUsd ?? 0), 0);
const src = sources(), todo = [];
for (const g of J1_GROUPS) {
  const dev = loadDev(src[g]), by = new Map();
  for (const r of dev) { const k = r.portKey; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  for (const [k, rs] of by) {
    rs.sort((a, b) => (h(`kev-j1-haiku|${a.recId}|${a.qid}`) < h(`kev-j1-haiku|${b.recId}|${b.qid}`) ? -1 : 1));
    for (const r of rs.slice(0, PER)) if (!done.has(`${r.recId}|${r.qid}`)) todo.push({ group: g, ...r });
  }
}
console.log(`todo ${todo.length}, spent so far $${spent.toFixed(4)}, cap $${CAP}`);
const { port: modelPort, db } = createModelPort({ journalFile: path.join(DIR, 'journal.sqlite'), concurrency: { 'claude-cli': CONC } });
const judge = new JudgmentPort({ engine: 'model', model: modelPort, modelId: MODEL, classBudget: 16000, runId: 'kev-j1-haiku', decoding: { maxTokens: 128, reasoning: 'none' } });
const costs = prior.filter(r => r.costUsd).map(r => r.costUsd);
const est = () => (costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0.01);
let inflight = 0, stopped = false, n = 0;
async function one(it) {
  if (spent + (inflight + 1) * est() * 1.5 > CAP) { stopped = true; return; }
  inflight++;
  const req = { port: it.qid.replace(/[^A-Za-z0-9_.-]/g, '_'), question: it.instructions, options: it.options,
    criteria: it.type === 'choice' ? it.options.map(o => `${o}: ${it.criteria[o]}`).filter(c => c.trim()) : [], state: it.state };
  const t = Date.now();
  try {
    const res = await judge.judge({ ...req, nodeKey: `kev-j1/${it.group}/${it.recId}/${it.qid}` });
    spent += res.costUsd ?? 0; costs.push(res.costUsd ?? 0);
    appendFileSync(ROWS, JSON.stringify({ group: it.group, recId: it.recId, qid: it.qid, portKey: it.portKey, label: it.label, chosen: res.chosen, confidence: res.confidence, probabilities: res.probabilities, costUsd: res.costUsd, wallMs: Date.now() - t, model: res.model }) + '\n');
  } catch (e) {
    appendFileSync(ROWS, JSON.stringify({ group: it.group, recId: it.recId, qid: it.qid, portKey: it.portKey, fault: true, error: { code: e.code ?? null, message: String(e.message).slice(0, 400) }, at: new Date().toISOString(), wallMs: Date.now() - t }) + '\n');
    console.log('ERR', it.portKey, e.code, String(e.message).slice(0, 200));
  } finally { inflight--; n++; if (n % 25 === 0) console.log(`${n} done, spent $${spent.toFixed(4)}, mean $${est().toFixed(5)}/call`); }
}
const queue = [...todo];
await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length && !stopped) await one(queue.shift()); }));
db.close();
console.log(`finished: ${n} calls this run, spent $${spent.toFixed(4)}${stopped ? ' (stopped at the cap)' : ''}, mean $${est().toFixed(5)}/call`);
