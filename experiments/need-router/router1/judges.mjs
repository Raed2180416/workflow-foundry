// ROUTER-1 judge passes ("ask X directly", and the material for the router's middle band): every item of one split is put
// to one judge with the typed question of src/need/judge-prompt.mjs. Resumable (rows are appended; a re-run asks only what
// is missing), metered with hard caps, and journaled (Haiku and Mercury through ModelPort; Jev raw bodies in a JSONL file).
// Frozen by PREREG-ROUTER-1.md before any paid call.
//
//   node experiments/need-router/router1/judges.mjs --judge haiku   --split dev  [--samples 2] [--cap-usd 3]
//   bash with-inception.sh experiments/need-router/router1/judges.mjs --judge mercury --split dev [--token-cap 200000]
//   FOUNDRY_SYSTEMONE_API_KEY=... node experiments/need-router/router1/judges.mjs --judge jev --split dev [--request-cap 1200]
//   node experiments/need-router/router1/judges.mjs --judge haiku --split dev --dry      # count calls, no network
//
// Jev sees only items whose text is synthetic (jevEligible: authored, Mercury-written, anchor beds, family policies, E-bed
// specs); AutomationBench public text never goes to TypeSafe (decision Q5b, MEMORY-ROUTING-RECURSION.md §6 row 9).
import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { SYSTEM, judgePrompt, JUDGE_SCHEMA, readJudgeAnswer, jevQuestion, jevState, rotations, MODES, NEEDS_WORKFLOW } from '../../../src/need/judge-prompt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const DIR = path.join(ROOT, 'research/need-router-20261014/router1');
export const RUNS = path.join(DIR, 'runs');
export const LIVE = '/var/tmp/foundry-work/need/router1';
export const HAIKU = 'claude-haiku-5-5', MERCURY = 'mercury-3';
export const HAIKU_PER_CALL_USD = 0.05;          // the per-call bound reserved against the cap while a call is in flight
export const SALT = 'router1-v1';
const sha = s => createHash('sha256').update(s).digest('hex');

export function loadSet() {
  return readFileSync(path.join(DIR, 'SET.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
}
export function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
}
export const rowsFile = (judge, split, dir = RUNS) => path.join(dir, `${judge}-${split}.jsonl`);

async function pool(items, n, fn) {
  let i = 0, stop = null;
  const worker = async () => { while (!stop && i < items.length) { const it = items[i++]; try { await fn(it); } catch (e) { stop = e; } } };
  await Promise.all(Array.from({ length: Math.max(1, n) }, worker));
  if (stop) throw stop;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Haiku or Mercury through a journaled ModelPort. `port` is injectable for $0 tests. */
// runsDir / liveDir: where rows and the journal go (the research directory and /var/tmp by default; a temp dir in tests).
export async function runModelJudge({ judge, items, split, samples = 1, port = null, capUsd = 3, tokenCap = null, concurrency = 4, log = console.log, spentBefore = 0, runsDir = RUNS, liveDir = LIVE }) {
  const modelId = judge === 'haiku' ? HAIKU : MERCURY;
  const file = rowsFile(judge, split, runsDir);
  mkdirSync(runsDir, { recursive: true }); mkdirSync(liveDir, { recursive: true });
  const prior = readJsonl(file).filter(r => r.ok);
  const have = new Set(prior.map(r => `${r.id}|${r.sample}`));
  const todo = items.flatMap(it => Array.from({ length: samples }, (_, s) => ({ it, s }))).filter(({ it, s }) => !have.has(`${it.id}|${s}`));
  let spent = spentBefore, inflight = 0, capped = false, faults = 0;
  log(`${judge} ${split}: ${items.length} items x ${samples} sample(s); ${todo.length} calls to make; spent so far $${spent.toFixed(4)}`);
  if (!todo.length) return { exit: 0, spent };
  const made = port ?? (await import('../../lib/models.mjs')).createModelPort({
    journalFile: path.join(liveDir, `${judge}.sqlite`),
    allowedModels: judge === 'haiku' ? [HAIKU] : [HAIKU, MERCURY],
    maxBudgetUsdPerCall: HAIKU_PER_CALL_USD,
    ...(judge === 'mercury' ? { tokenCap, callTokens: 12000 } : {})
  });
  const p = port ?? made.port;
  await pool(todo, concurrency, async ({ it, s }) => {
    if (capped) return;
    if (judge === 'haiku' && spent + (inflight + 1) * HAIKU_PER_CALL_USD > capUsd + 1e-9) { capped = true; log(`CAP: $${spent.toFixed(4)} + reserved > $${capUsd}; stopping`); return; }
    inflight++;
    let r;
    try {
      r = await p.call({ runId: `router1:${it.id}`, nodeKey: 'need-judge', sampleIndex: s, modelId, system: SYSTEM, prompt: judgePrompt(it.text), schema: JUDGE_SCHEMA,
        decoding: { maxTokens: 1000, reasoning: 'none' }, salt: SALT });
    } catch (e) {
      r = { ok: false, error: { code: e.code ?? 'ERROR', message: String(e.message ?? e).slice(0, 300) }, costUsd: e.details?.costUsd ?? 0, latencyMs: e.details?.latencyMs ?? null };
    } finally { inflight--; }
    spent += r.costUsd ?? 0;
    const a = r.ok ? readJudgeAnswer(r.value) : null;
    const row = { id: it.id, split, judge, modelId, sample: s, ok: !!a, mode: a?.mode ?? null, needsWorkflow: a?.needsWorkflow ?? null, p: a?.p ?? null, value: r.value ?? null,
      usage: r.usage ?? null, costUsd: r.costUsd ?? 0, latencyMs: r.latencyMs ?? null, engineVersion: r.engineVersion ?? null, journalId: r.journalId ?? null,
      error: a ? null : (r.error ?? { code: 'ANSWER', message: 'unreadable answer' }), at: new Date().toISOString() };
    if (!a) faults++;
    appendFileSync(file, JSON.stringify(row) + '\n');
  });
  const tokens = made?.tokens ? made.tokens() : null;
  log(`${judge} ${split}: done; spent $${spent.toFixed(4)}; ${faults} fault(s)${tokens ? `; tokens ${JSON.stringify(tokens)}` : ''}`);
  return { exit: capped ? 4 : faults ? 3 : 0, spent, tokens };
}

/** Jev: 4 cyclic option rotations per item, averaged by option name. `client` is injectable ({ served: {ask}, config }). */
export async function runJevJudge({ items, split, client = null, requestCap = 1200, concurrency = 2, log = console.log, backoffMs = 2000, runsDir = RUNS, liveDir = LIVE }) {
  const { jevClient, requestLedger } = await import('../../kev-data/score-served.mjs');
  const { fromSystemOneAnswer } = await import('../../../src/judgment.mjs');
  const file = rowsFile('jev', split, runsDir), rawFile = path.join(runsDir, `jev-${split}.raw.jsonl`);
  mkdirSync(runsDir, { recursive: true }); mkdirSync(liveDir, { recursive: true });
  const eligible = items.filter(it => it.jevEligible);
  const done = new Set(readJsonl(file).filter(r => r.ok).map(r => r.id));
  const todo = eligible.filter(it => !done.has(it.id));
  const orders = rotations(MODES);
  const ledger = requestLedger({ file: path.join(liveDir, 'jev-requests.jsonl'), cap: requestCap });
  log(`jev ${split}: ${eligible.length} eligible of ${items.length}; ${todo.length} to ask = ${todo.length * orders.length} requests; ledger ${ledger.count}/${requestCap}`);
  if (!todo.length) return { exit: 0 };
  if (!ledger.room(todo.length * orders.length)) { log('REFUSED: the request cap would be passed'); return { exit: 4 }; }
  const { served, config } = client ?? jevClient();
  let faults = 0;
  await pool(todo, concurrency, async it => {
    const rots = [];
    for (const order of orders) {
      const req = { state: jevState(it.text), questions: { mode: jevQuestion(order) } }, hash = sha(JSON.stringify(req));
      let body = null, err = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        ledger.take({ tag: 'router1', id: `${it.id}|${order.join(',')}`, attempt, requestHash: hash });
        const t0 = Date.now();
        try { body = await served.ask(req); appendFileSync(rawFile, JSON.stringify({ id: it.id, order, attempt, ok: true, latencyMs: Date.now() - t0, requestHash: hash, body }) + '\n'); break; }
        catch (e) {
          err = e.code ?? 'ERROR';
          appendFileSync(rawFile, JSON.stringify({ id: it.id, order, attempt, ok: false, requestHash: hash, error: { code: err, message: String(e.message ?? e).slice(0, 300) } }) + '\n');
          if (err === 'REQUEST_CAP') throw e;
          if (!['MODEL_QUOTA', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT'].includes(err)) break;
          if (attempt < 3) await sleep(backoffMs * 2 ** attempt);
        }
      }
      if (!body) { rots.length = 0; err = err ?? 'NO_BODY'; break; }
      let probs;
      try { probs = fromSystemOneAnswer(body.answers?.mode, [...MODES]).probabilities; } catch (e) { err = 'PROTOCOL'; rots.length = 0; break; }
      rots.push({ order, probs, model: body.model ?? null, usage: body.usage ?? null });
    }
    if (rots.length !== orders.length) { faults++; appendFileSync(file, JSON.stringify({ id: it.id, split, judge: 'jev', ok: false, at: new Date().toISOString() }) + '\n'); return; }
    const mean = Object.fromEntries(MODES.map(m => [m, rots.reduce((s, r) => s + r.probs[m], 0) / rots.length]));
    const mode = MODES.reduce((b, m) => (mean[m] > mean[b] ? m : b), MODES[0]);
    const inputTokens = rots.reduce((s, r) => s + (r.usage?.input_tokens ?? 0), 0);
    appendFileSync(file, JSON.stringify({ id: it.id, split, judge: 'jev', ok: true, jevModel: config.model, served: [...new Set(rots.map(r => r.model))], mode, needsWorkflow: NEEDS_WORKFLOW.has(mode),
      p: mean.workflow + mean.recurring, mean, rotations: rots, inputTokens, costUsd: inputTokens * 0.042 / 1e6, at: new Date().toISOString() }) + '\n');
  });
  log(`jev ${split}: done; ${faults} fault(s); ledger ${ledger.count}`);
  return { exit: faults ? 3 : 0 };
}

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

async function main() {
  const judge = arg('--judge'), split = arg('--split');
  if (!['haiku', 'mercury', 'jev'].includes(judge) || !['dev', 'test'].includes(split)) throw new Error('usage: --judge haiku|mercury|jev --split dev|test');
  const items = loadSet().filter(it => it.split === split);
  if (process.argv.includes('--dry')) {
    const n = judge === 'jev' ? items.filter(i => i.jevEligible).length * 4 : items.length * Number(arg('--samples', judge === 'haiku' ? 2 : 1));
    const chars = items.reduce((s, it) => s + judgePrompt(it.text).length + SYSTEM.length, 0);
    console.log(JSON.stringify({ judge, split, items: items.length, requests: n, promptCharsPerSample: chars, approxInputTokensPerSample: Math.ceil(chars / 4) }));
    return;
  }
  if (judge === 'jev') { const r = await runJevJudge({ items, split, requestCap: Number(arg('--request-cap', 1200)) }); process.exitCode = r.exit; return; }
  // Haiku's cap counts the spend of both splits' rows (one budget line for ROUTER-1).
  const spentBefore = judge === 'haiku' ? ['dev', 'test'].flatMap(s => readJsonl(rowsFile('haiku', s))).reduce((s, r) => s + (r.costUsd ?? 0), 0) : 0;
  const r = await runModelJudge({ judge, items, split, samples: Number(arg('--samples', judge === 'haiku' ? 2 : 1)), capUsd: Number(arg('--cap-usd', 3)),
    tokenCap: judge === 'mercury' ? Number(arg('--token-cap', 200000)) : null, concurrency: Number(arg('--concurrency', judge === 'haiku' ? 4 : 2)), spentBefore });
  process.exitCode = r.exit;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
