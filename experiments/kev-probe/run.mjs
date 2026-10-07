// Engine runs for the Kev probe. DEVELOPMENT evidence (dev-split bed seeds, generator labels).
//   node experiments/kev-probe/run.mjs rule [datasets]      rule baselines, both halves (JudgmentPort 'rule')
//   node experiments/kev-probe/run.mjs kev-cal [datasets]   Kev, calibration half, wordings A and B packed in one request
//   node experiments/kev-probe/run.mjs freeze               choose the wording per dataset on calibration Brier
//   node experiments/kev-probe/run.mjs kev-eval [datasets]  Kev, evaluation half, frozen wording (JudgmentPort 'systemone')
//   node experiments/kev-probe/run.mjs model [datasets]     hosted model, <= 50 evaluation items (JudgmentPort 'model')
//   node experiments/kev-probe/run.mjs permute [datasets]   option-order sensitivity (/v1/systemone/permute) + packing check
// Every run is resumable: items already in the raw file are skipped.
import path from 'node:path';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { JudgmentPort } from '../../src/ports.mjs';
import { JudgmentLedger, toSystemOneQuestion, fromSystemOneAnswer, calibrationReport } from '../../src/judgment.mjs';
import { createModelPort } from '../lib/models.mjs';
import { rng } from '../../beds/lib/rng.mjs';
import { RUN_DIR, kevClient, kevIdentity, kevPost, spend, load, appendJsonl, readJsonl } from './lib.mjs';
import { loadDataset, BUILDERS } from './datasets.mjs';
import { QUESTIONS, requestFor, modelRequestFor } from './questions.mjs';
import { RULES } from './rules.mjs';

export const HOSTED_MODEL = process.env.KEV_PROBE_HOSTED ?? 'claude-sonnet-5-5'; // owner request: no Haiku arm (see report §1)
export const KEV_RUN = 'jaredpalmer/kev-0.8b@v1.0';
const FROZEN_FILE = path.join(RUN_DIR, 'frozen.json');
export const rawFile = (engine, dataset) => path.join(RUN_DIR, 'raw', `${engine}-${dataset}.jsonl`);
export const ledgerFile = (engine, dataset) => path.join(RUN_DIR, 'ledger', `${engine}-${dataset}.jsonl`);
const doneIds = (engine, dataset, key = r => `${r.itemId}|${r.wording}`) => new Set(readJsonl(rawFile(engine, dataset)).filter(r => !r.error).map(key));
const judgmentReq = r => ({ port: r.port, question: r.question, criteria: r.criteria, state: r.state, options: r.options });
export const frozen = () => (existsSync(FROZEN_FILE) ? JSON.parse(readFileSync(FROZEN_FILE, 'utf8')) : {});

// Items the hosted model sees: a label-stratified, seeded sample of at most 50 evaluation items.
export function hostedSubset(items) {
  const ev = items.filter(i => i.half === 'evaluation');
  if (ev.length <= 50) return ev;
  const r = rng('kev-probe', 'hosted-subset', items[0].dataset);
  const byLabel = new Map();
  for (const it of r.shuffle(ev)) { if (!byLabel.has(it.truth)) byLabel.set(it.truth, []); byLabel.get(it.truth).push(it); }
  const out = [], lists = [...byLabel.values()];
  for (let i = 0; out.length < 50; i++) for (const l of lists) if (l[i] && out.length < 50) out.push(l[i]);
  return out;
}

async function runRule(datasets) {
  for (const ds of datasets) {
    const ledger = new JudgmentLedger(ledgerFile('rule', ds));
    const port = new JudgmentPort({ engine: 'rule', rule: RULES[ds], ledger });
    const done = doneIds('rule', ds);
    for (const item of loadDataset(ds)) {
      for (const wording of ['A']) { // the rule ignores wording except for slot text (applicability)
        if (done.has(`${item.id}|${wording}`)) continue;
        const req = requestFor(item, wording);
        const res = await port.judge({ ...judgmentReq(req), split: item.half, meta: { itemId: item.id, wording } });
        ledger.label(res.ledgerId, item.truth, { source: 'generator' });
        appendJsonl(rawFile('rule', ds), { itemId: item.id, half: item.half, wording, truth: item.truth, chosen: res.chosen, probabilities: res.probabilities, confidence: res.confidence, wallMs: res.latencyMs, ledgerId: res.ledgerId });
      }
    }
    console.log('rule', ds, 'done');
  }
}

async function runKevCal(datasets) {
  const client = kevClient();
  for (const ds of datasets) {
    const ledger = new JudgmentLedger(ledgerFile('kev', ds));
    const done = doneIds('kev', ds, r => r.itemId);
    const items = loadDataset(ds).filter(i => i.half === 'calibration');
    for (const item of items) {
      if (done.has(item.id)) continue;
      const reqs = { A: requestFor(item, 'A'), B: requestFor(item, 'B') };
      spend('kev', 1, `cal ${ds}`);
      const t0 = performance.now();
      let body, error = null;
      try { body = await client.ask({ state: item.state, questions: { A: toSystemOneQuestion(reqs.A), B: toSystemOneQuestion(reqs.B) } }); }
      catch (e) { error = { code: e.code, message: String(e.message).slice(0, 300) }; }
      const wallMs = Math.round(performance.now() - t0), load1 = load().one;
      if (error) { appendJsonl(rawFile('kev', ds), { itemId: item.id, half: item.half, error, wallMs, load1 }); console.log('ERR', ds, item.id, error.code); continue; }
      for (const wording of ['A', 'B']) {
        const out = fromSystemOneAnswer(body.answers[wording], item.options);
        const ledgerId = ledger.record({ port: reqs[wording].port, engine: 'systemone', model: KEV_RUN, request: judgmentReq(reqs[wording]), result: { ...out, latencyMs: wallMs }, split: 'calibration', meta: { itemId: item.id, wording, packed: 2 } });
        ledger.label(ledgerId, item.truth, { source: 'generator' });
        appendJsonl(rawFile('kev', ds), { itemId: item.id, half: item.half, wording, truth: item.truth, chosen: out.chosen, probabilities: out.probabilities, confidence: out.confidence,
          wallMs, serverMs: body.latency_ms, inputTokens: body.usage?.input_tokens ?? null, packed: 2, load1, ledgerId });
      }
    }
    console.log('kev-cal', ds, 'done');
  }
}

function runFreeze() {
  const out = frozen();
  for (const ds of Object.keys(BUILDERS)) {
    const rows = new JudgmentLedger(ledgerFile('kev', ds)).rows().filter(r => r.split === 'calibration');
    if (!rows.length) continue;
    const by = Object.fromEntries(['A', 'B'].map(w => [w, calibrationReport(rows.filter(r => r.meta.wording === w))]));
    const pick = by.A.brier < by.B.brier || (by.A.brier === by.B.brier && by.A.accuracy >= by.B.accuracy) ? 'A' : 'B';
    if (out[ds] && out[ds].wording !== pick) console.log(`freeze: ${ds} already frozen at ${out[ds].wording}; keeping it`);
    out[ds] ??= { wording: pick, frozenAt: new Date().toISOString(), calibration: Object.fromEntries(Object.entries(by).map(([w, r]) => [w, { n: r.n, accuracy: r.accuracy, brier: r.brier, ece: r.ece }])) };
  }
  writeFileSync(FROZEN_FILE, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}

async function runKevEval(datasets) {
  const client = kevClient(), fz = frozen();
  for (const ds of datasets) {
    if (!fz[ds]) { console.log('kev-eval: no frozen wording for', ds); continue; }
    const wording = fz[ds].wording;
    const ledger = new JudgmentLedger(ledgerFile('kev', ds));
    const port = new JudgmentPort({ engine: 'systemone', systemOne: client, systemOneModel: KEV_RUN, ledger });
    const done = doneIds('kev', ds);
    for (const item of loadDataset(ds).filter(i => i.half === 'evaluation')) {
      if (done.has(`${item.id}|${wording}`)) continue;
      const req = requestFor(item, wording);
      spend('kev', 1, `eval ${ds}`);
      let res;
      try { res = await port.judge({ ...judgmentReq(req), optionDescriptions: req.optionDescriptions, split: 'evaluation', meta: { itemId: item.id, wording, packed: 1 } }); }
      catch (e) { appendJsonl(rawFile('kev', ds), { itemId: item.id, half: item.half, wording, error: { code: e.code, message: String(e.message).slice(0, 300) }, load1: load().one }); console.log('ERR', ds, item.id, e.code); continue; }
      ledger.label(res.ledgerId, item.truth, { source: 'generator' });
      appendJsonl(rawFile('kev', ds), { itemId: item.id, half: item.half, wording, truth: item.truth, chosen: res.chosen, probabilities: res.probabilities, confidence: res.confidence,
        wallMs: res.latencyMs, serverMs: res.serverLatencyMs, packed: 1, load1: load().one, ledgerId: res.ledgerId });
    }
    console.log('kev-eval', ds, 'done');
  }
}

async function runModel(datasets) {
  const fz = frozen();
  const { port: modelPort, db } = createModelPort({ journalFile: path.join(RUN_DIR, 'journal.sqlite'), concurrency: { 'claude-cli': 3 } });
  try {
    for (const ds of datasets) {
      if (!fz[ds]) { console.log('model: no frozen wording for', ds); continue; }
      const wording = fz[ds].wording;
      const ledger = new JudgmentLedger(ledgerFile('model', ds));
      const port = new JudgmentPort({ engine: 'model', model: modelPort, modelId: HOSTED_MODEL, classBudget: 16000, runId: 'kev-probe', decoding: { maxTokens: 128, reasoning: 'none' }, ledger });
      const done = doneIds('model', ds);
      const todo = hostedSubset(loadDataset(ds)).filter(i => !done.has(`${i.id}|${wording}`));
      const one = async item => {
        const req = modelRequestFor(item, wording);
        spend('hosted', 1, `model ${ds}`);
        try {
          const res = await port.judge({ ...judgmentReq(req), split: 'evaluation', meta: { itemId: item.id, wording, modelId: HOSTED_MODEL }, nodeKey: `kev-probe/${ds}/${item.id}` });
          ledger.label(res.ledgerId, item.truth, { source: 'generator' });
          appendJsonl(rawFile('model', ds), { itemId: item.id, half: item.half, wording, truth: item.truth, chosen: res.chosen, probabilities: res.probabilities, confidence: res.confidence,
            wallMs: res.latencyMs, costUsd: res.costUsd, modelId: res.model, ledgerId: res.ledgerId });
        } catch (e) {
          appendJsonl(rawFile('model', ds), { itemId: item.id, half: item.half, wording, error: { code: e.code, message: String(e.message).slice(0, 300) } });
          console.log('ERR', ds, item.id, e.code, String(e.message).slice(0, 120));
        }
      };
      const queue = [...todo];
      await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) await one(queue.shift()); }));
      console.log('model', ds, 'done');
    }
  } finally { db.close(); }
}

// Option-order sensitivity on a few evaluation items per dataset (/v1/systemone/permute: n_perm forward
// passes on the cached state), plus a packing check: the packed calibration answer vs a one-question request.
async function runPermute(datasets) {
  const fz = frozen(), client = kevClient();
  const PER = 15, NPERM = 4;
  for (const ds of datasets) {
    if (!fz[ds]) continue;
    const wording = fz[ds].wording;
    const done = new Set(readJsonl(rawFile('permute', ds)).map(r => `${r.kind}|${r.itemId}`));
    const ev = loadDataset(ds).filter(i => i.half === 'evaluation').slice(0, PER);
    for (const item of ev) {
      if (done.has(`permute|${item.id}`)) continue;
      const req = requestFor(item, wording);
      spend('kev', NPERM, `permute ${ds}`);
      const body = await kevPost('/v1/systemone/permute', { request: { state: item.state, model: 'kev-latest', questions: { q: toSystemOneQuestion(req) } }, question: 'q', n_perm: NPERM, seed: 7 });
      const choices = body.runs.map(x => x.choice);
      appendJsonl(rawFile('permute', ds), { kind: 'permute', itemId: item.id, truth: item.truth, argmaxStable: body.argmax_stable, choices, maxSpread: Math.max(...Object.values(body.spread)),
        correctShare: choices.filter(c => c === item.truth).length / choices.length, latencyMs: body.runs.map(x => x.latency_ms) });
    }
    // packing check: 5 calibration items, wording A alone vs the packed A+B answer already recorded
    const packed = new Map(readJsonl(rawFile('kev', ds)).filter(r => r.wording === 'A' && r.packed === 2).map(r => [r.itemId, r]));
    for (const item of loadDataset(ds).filter(i => i.half === 'calibration' && packed.has(i.id)).slice(0, 5)) {
      if (done.has(`packing|${item.id}`)) continue;
      spend('kev', 1, `packing ${ds}`);
      const body = await client.ask({ state: item.state, questions: { A: toSystemOneQuestion(requestFor(item, 'A')) } });
      const single = fromSystemOneAnswer(body.answers.A, item.options).probabilities, two = packed.get(item.id).probabilities;
      appendJsonl(rawFile('permute', ds), { kind: 'packing', itemId: item.id, maxAbsDiff: Math.max(...item.options.map(o => Math.abs(single[o] - two[o]))) });
    }
    console.log('permute', ds, 'done');
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const datasets = rest.length ? rest : Object.keys(BUILDERS);
if (cmd) console.log('kev', JSON.stringify(await kevIdentity().catch(e => ({ error: e.message }))), 'load', load().uptime);
if (cmd === 'rule') await runRule(datasets);
else if (cmd === 'kev-cal') await runKevCal(datasets);
else if (cmd === 'freeze') runFreeze();
else if (cmd === 'kev-eval') await runKevEval(datasets);
else if (cmd === 'model') await runModel(datasets);
else if (cmd === 'permute') await runPermute(datasets);
else if (cmd) throw new Error(`unknown command ${cmd}`);
