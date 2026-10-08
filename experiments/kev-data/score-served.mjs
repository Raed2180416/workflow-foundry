// Served scorer (JUDGE-PROGRAM.md §7.5, §7.4 J0c/J1/J3/J5; JUDGE-BUILD-PLAN.json group served-scorer-jobs).
//
// `kev.benchmark --data` hard-codes Kev's training context (state 384, branch 1,024, packed 2,048 tokens) and
// counts every longer record in coverage.rejected_records while the job still succeeds. So any file with a
// state over 384 real tokens is scored here instead, against a running `kev.serve` (states to 65,536 tokens,
// the bf16 path that serves), through the repository's own client:
//
//   new SystemOneClient({ url: `${client.endpoint}/svc/kev`, fetchImpl: client.bridgeFetch })
//
// (bridge/PROTOCOL.md "From code": every /svc/kev request is signed; a bearer token is never read or sent).
// All questions of a record go in ONE request, one served model at a time (the run id is read from
// /v1/models before and after, and a change invalidates the run), probabilities come back at 4 decimals and
// are written as returned to a rows file in Kev's own prediction_rows shape (kev.benchmark), so the analysis
// can read served rows and kev.benchmark rows with one reader. Flooring at 5e-5 and renormalising is a
// calibration step, not a scoring step: floorAndRenormalize() is exported for it.
//
// Coverage is reported the way kev.benchmark reports it, and a run is VALID only if nothing was rejected
// (HTTP 422), failed, or came back truncated: the program rule "a report with rejected_records > 0 is
// invalid" applies here too. Nothing is dropped silently: rejected and failed records are listed.
//
// Labels in the input file are carried into the rows (they are the file's, never produced here). The model is
// never called for anything but the file's own requests (api_request: state and typed questions only, never
// labels, targets or metadata).
//
// Library: parseKevText, loadKevRecords, requestOf, questionKeys, scoreServed, describeServed, rawRead,
// compareReads, floorAndRenormalize, servedClient, bridgeServedClient, readRows. CLI:
//   node experiments/kev-data/score-served.mjs --data <kev.jsonl> --out <rows.jsonl> \
//        (--url http://127.0.0.1:8008 | --bridge) [--concurrency 1] [--expect-run <run>] [--reread 20] \
//        [--limit N] [--resume] [--timeout-ms 120000]
// --url is the kev.serve base (for a local service); --bridge connects through bridge/cloud/client.mjs
// (FOUNDRY_BRIDGE_URL or discovery) and signs every request. Exit 0 = valid run, 3 = invalid, 2 = usage.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, truncateSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FoundryError } from '../../src/data.mjs';
import { SystemOneClient } from '../../src/judgment.mjs';
import { canonical, sha256 } from './lib/hash.mjs';

export const ROWS_SCHEMA = 'kev-data/served-rows@1';
export const PROB_FLOOR = 5e-5;                 // §7.5: probabilities are floored at 5e-5 before any transform
export const PROB_DECIMALS = 4;                 // kev.api.round_prob
export const STABLE_DP = 0.01;                  // §7.5 stability test and the 20-record raw re-read
export const STABLE_FLIP_RATE = 0.005;          // §7.5: at most 0.5% argmax flips
export const SERVED_MODEL = 'kev-latest';       // kev.serve MODEL_NAMES: kev-latest and jev-latest serve the same checkpoint

const fail = (code, message, details) => new FoundryError(code, message, details);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const round = (x, d = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

// ---- input: Kev labelled JSONL (kev.data.load_records, in JS) ---------------------------------------------------

// One record per non-blank line; a line's id is `_meta.id` or `<source>/<line number>` (the number counts blank
// lines, as Kev's enumerate does). Every question needs a type and a label. Ids must be unique, because rows,
// resume and re-reads are keyed by them.
export function parseKevText(text, { file = '<memory>', source = 'custom' } = {}) {
  const records = [], seen = new Set();
  const lines = String(text).split('\n');
  lines.forEach((raw, n) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!line.trim()) return;
    let r;
    try { r = JSON.parse(line); } catch { throw fail('SERVED_INPUT', `${file}:${n + 1} is not JSON`); }
    if (!r || typeof r !== 'object' || !('state' in r) || !r.questions || typeof r.questions !== 'object' || Array.isArray(r.questions) || !Object.keys(r.questions).length) {
      throw fail('SERVED_INPUT', `${file}:${n + 1}: a record needs a state and a non-empty questions object`);
    }
    for (const [qid, q] of Object.entries(r.questions)) {
      if (!q || typeof q !== 'object' || !('label' in q)) throw fail('SERVED_INPUT', `${file}:${n + 1}: question ${JSON.stringify(qid)} has no label`);
      if (!['choice', 'noul', 'score'].includes(q.type)) throw fail('SERVED_INPUT', `${file}:${n + 1}: question ${JSON.stringify(qid)} has type ${JSON.stringify(q.type)}`);
      q.src ??= `${source}_${q.type}`;
    }
    const id = r._meta?.id ?? `${source}/${n}`;
    if (typeof id !== 'string' || !id) throw fail('SERVED_INPUT', `${file}:${n + 1}: _meta.id must be a non-empty string`);
    if (seen.has(id)) throw fail('SERVED_INPUT_DUPLICATE_ID', `${file}:${n + 1}: record id ${id} appears twice`);
    seen.add(id);
    r._meta = { source, variant: 'clean', group_id: id, ...r._meta, id };
    records.push(r);
  });
  if (!records.length) throw fail('SERVED_INPUT', `${file}: no records`);
  return records;
}
export function loadKevRecords(file, opts = {}) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (error) { throw fail('SERVED_INPUT', `cannot read ${file}: ${error.code ?? error.message}`); }
  return { records: parseKevText(text, { file, ...opts }), sha256: sha256(text), bytes: Buffer.byteLength(text) };
}

// kev.data.api_request: what leaves this machine, never a label, a target or metadata.
export function requestOf(record) {
  const questions = {};
  for (const [qid, q] of Object.entries(record.questions)) {
    const out = {};
    for (const k of ['type', 'instructions', 'criteria']) if (k in q) out[k] = q[k];
    questions[qid] = out;
  }
  return { state: record.state, questions };
}

// A JS object lists integer-like keys first and in ascending order, so a choice whose option names look like
// array indices would reach the model in a different order than the file wrote them. Refused, not reordered.
const INDEX_LIKE = /^(0|[1-9][0-9]{0,8})$/;
export function questionKeys(q) {
  if (q.type === 'choice') {
    if (!q.criteria || typeof q.criteria !== 'object' || Array.isArray(q.criteria)) throw fail('SERVED_INPUT', 'a choice question needs criteria');
    const keys = Object.keys(q.criteria);
    if (!keys.length) throw fail('SERVED_INPUT', 'a choice question needs at least one option');
    const bad = keys.filter(k => INDEX_LIKE.test(k));
    if (bad.length) throw fail('SERVED_KEYS', `option name(s) ${bad.join(', ')} look like array indices; JavaScript would reorder them, so the model would see another option order`);
    return keys;
  }
  if (q.type === 'noul') return ['false', 'true'];
  if (!Array.isArray(q.criteria) || !q.criteria.length) throw fail('SERVED_INPUT', 'a score question needs a criteria list');
  return q.criteria.map((_, i) => String(i));
}
function labelIndex(q, keys) {
  if (q.type === 'choice') { const i = keys.indexOf(q.label); if (i < 0) throw fail('SERVED_INPUT', `label ${JSON.stringify(q.label)} is not an offered option`); return i; }
  if (q.type === 'noul') return q.label ? 1 : 0;
  const i = Number(q.label);
  if (!Number.isInteger(i) || i < 0 || i >= keys.length) throw fail('SERVED_INPUT', `score label ${JSON.stringify(q.label)} is not a level index`);
  return i;
}
function targetVector(q, keys) {
  if (q.target === undefined || q.target === null) return null;
  const t = keys.map(k => Number(q.target[k] ?? 0));
  const s = t.reduce((a, b) => a + b, 0);
  return s > 0 ? t.map(x => x / s) : null;
}

// ---- output: the served answer of one question, checked like kev.benchmark.validate_distribution --------------------

// -> probabilities by key, from the three answer shapes kev.api.to_answers writes.
function rawByKey(answer, q, keys) {
  if (!answer || typeof answer !== 'object' || answer.type !== q.type) throw fail('SERVED_ANSWER', `answer type ${JSON.stringify(answer?.type)} for a ${q.type} question`);
  if (q.type === 'noul') {
    const x = answer.noul;
    if (typeof x !== 'number') throw fail('SERVED_ANSWER', 'a noul answer carries p(true) as a number');
    return { false: 1 - x, true: x };
  }
  if (!answer.probabilities || typeof answer.probabilities !== 'object') throw fail('SERVED_ANSWER', 'the answer carries no probabilities');
  return answer.probabilities;
}
export function validateDistribution(raw, keys) {
  const got = Object.keys(raw);
  if (got.length !== keys.length || !keys.every(k => Object.hasOwn(raw, k))) throw fail('SERVED_ANSWER', 'probability keys do not match the requested options');
  const p = keys.map(k => Number(raw[k]));
  if (!p.every(x => Number.isFinite(x) && x >= 0 && x <= 1 + 1e-12)) throw fail('SERVED_ANSWER', 'non-finite or out-of-range probabilities');
  const total = p.reduce((a, b) => a + b, 0);
  if (!(total > 0) || Math.abs(total - 1) > Math.max(1e-5, keys.length * 0.005 + 1e-8)) throw fail('SERVED_ANSWER', `invalid probability sum: ${total}`);
  return { p, total };
}

// p floored at `floor`, then renormalised (§7.5 calibration input).
export function floorAndRenormalize(p, floor = PROB_FLOOR) {
  const q = p.map(x => Math.max(x, floor)), s = q.reduce((a, b) => a + b, 0);
  return q.map(x => x / s);
}

// Kev's prediction_rows shape, with the served fields added. `p` is exactly what the server returned (4 decimals).
export function rowsOf(record, body, extra = {}) {
  const meta = record._meta, answers = body?.answers;
  if (!answers || typeof answers !== 'object') throw fail('SERVED_ANSWER', 'the response carries no answers');
  const asked = Object.keys(record.questions), got = Object.keys(answers);
  if (asked.length !== got.length || !asked.every(q => Object.hasOwn(answers, q))) throw fail('SERVED_ANSWER', 'answer ids differ from request ids');
  return asked.map(qid => {
    const q = record.questions[qid], keys = questionKeys(q);
    const { p, total } = validateDistribution(rawByKey(answers[qid], q, keys), keys);
    const row = { id: meta.id, group: meta.group_id ?? meta.id, question: qid, source: meta.source ?? 'custom', task: q.src, type: q.type, variant: meta.variant ?? 'clean',
      keys, label: labelIndex(q, keys), control_id: meta.control_id ?? null, pair_id: meta.pair_id ?? null, sibling: meta.sibling ?? null,
      parent: meta.parent_id ?? ((meta.variant ?? 'clean') === 'clean' ? meta.id : meta.group_id), p, raw_probability_sum: round(total, 6), zero_count: p.filter(x => x === 0).length };
    const target = targetVector(q, keys);
    if (target) row.target = target;
    return { ...row, ...extra };
  });
}

// ---- the served model ---------------------------------------------------------------------------------------------

// One TypeSafe model card per accepted name, all for the same checkpoint (kev.serve MODEL_NAMES).
export function identityOf(raw) {
  const cards = raw?.models ?? [];
  if (!cards.length) throw fail('SERVED_MODEL', '/v1/models lists no model');
  const runs = [...new Set(cards.map(m => m.run ?? m.name))];
  if (runs.length !== 1) throw fail('SERVED_MODEL_AMBIGUOUS', `/v1/models lists ${runs.length} different runs (${runs.join(', ')}); one served model at a time`);
  const m = cards.find(c => c.name === SERVED_MODEL) ?? cards[0];
  return { run: runs[0], base: m.base ?? null, lora: m.lora ?? null, device: m.device ?? null, backend: m.backend ?? null, dtype: m.dtype ?? null,
    temperature: m.temperature ?? null, max_state_tokens: m.max_state_tokens ?? null, truncate_states: m.truncate_states ?? null,
    cuda_graphs: m.cuda_graphs ? true : m.cuda_graphs === null ? false : null, prefix_cache_size: m.prefix_cache?.size ?? null, release_date: m.release_date ?? null };
}
export async function describeServed(served, { signal } = {}) {
  const { raw } = await served.describe({ signal });
  return identityOf(raw);
}
const runMatches = (run, expect) => expect === undefined || expect === null || (expect instanceof RegExp ? expect.test(run) : run === expect || run.endsWith(`/${expect}`));

// ---- clients ---------------------------------------------------------------------------------------------------------

// `env: {}` so the client never reads a credential variable (the bridge strips Authorization anyway).
export function servedClient({ url, fetchImpl = globalThis.fetch, timeoutMs = 120_000, model = SERVED_MODEL } = {}) {
  return new SystemOneClient({ url, model, timeoutMs, fetchImpl, env: {} });
}
// Through the signed bridge: <endpoint>/svc/kev with client.bridgeFetch. bridge/ is imported read-only and lazily,
// so the scorer is usable (and testable) without it.
export async function bridgeServedClient({ timeoutMs, model, ...connectOpts } = {}) {
  const { connect } = await import('../../bridge/cloud/client.mjs');
  const { client } = await connect(connectOpts);
  const url = `${client.endpoint}/svc/kev`;
  return { client, url, fetchImpl: client.bridgeFetch, served: servedClient({ url, fetchImpl: client.bridgeFetch, timeoutMs, model }) };
}

// The raw API: one POST /v1/systemone through a plain fetch, no SystemOneClient, no retries. The 20-record
// re-read (acceptance) and the §7.5 stability reads go through here.
export async function rawRead({ url, fetchImpl = globalThis.fetch, request, model = SERVED_MODEL, timeoutMs = 120_000, signal } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const res = await fetchImpl(`${url.replace(/\/+$/, '')}/v1/systemone`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state: request.state, model, questions: request.questions }), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  const text = await res.text();
  if (res.status !== 200) throw fail('SERVED_RAW', `POST /v1/systemone returned ${res.status}: ${text.slice(0, 200)}`, { status: res.status });
  try { return JSON.parse(text); } catch { throw fail('SERVED_RAW', 'POST /v1/systemone returned non-JSON'); }
}

// ---- comparing two reads of the same requests ------------------------------------------------------------------

// Rows joined by (id, question). maxAbsDp is over every option of every question; the §7.5 stability test is
// mean max-p within 0.01 and at most 0.5% argmax flips.
export function compareReads(a, b, { dp = STABLE_DP, flipRate = STABLE_FLIP_RATE } = {}) {
  const key = r => `${r.id}\u0000${r.question}`, bm = new Map(b.map(r => [key(r), r]));
  let n = 0, maxAbsDp = 0, sumAbs = 0, cells = 0, flips = 0, sumMaxA = 0, sumMaxB = 0, missing = 0, mismatched = 0;
  for (const ra of a) {
    const rb = bm.get(key(ra));
    if (!rb) { missing++; continue; }
    if (ra.p.length !== rb.p.length) { mismatched++; continue; }
    n++;
    ra.p.forEach((x, i) => { const d = Math.abs(x - rb.p[i]); maxAbsDp = Math.max(maxAbsDp, d); sumAbs += d; cells++; });
    const argmax = p => p.reduce((best, x, i) => (x > p[best] ? i : best), 0);
    if (argmax(ra.p) !== argmax(rb.p)) flips++;
    sumMaxA += Math.max(...ra.p); sumMaxB += Math.max(...rb.p);
  }
  const meanMaxPDiff = n ? Math.abs(sumMaxA - sumMaxB) / n : null;
  return { questions: n, missing, mismatched, maxAbsDp: round(maxAbsDp, 6), meanAbsDp: cells ? round(sumAbs / cells, 6) : null, meanMaxPA: n ? round(sumMaxA / n, 6) : null,
    meanMaxPB: n ? round(sumMaxB / n, 6) : null, meanMaxPDiff: round(meanMaxPDiff, 6), argmaxFlips: flips, flipRate: n ? round(flips / n, 6) : null,
    agree: n > 0 && !missing && !mismatched && maxAbsDp < dp,                                                  // every probability within dp
    stable: n > 0 && !missing && !mismatched && meanMaxPDiff <= dp && flips / n <= flipRate };                 // §7.5
}

// ---- scoring ---------------------------------------------------------------------------------------------------

// Results are committed in input order whatever the concurrency, as kev.benchmark does. Commits are serialised.
async function mapOrdered(items, concurrency, work, commit) {
  const results = new Array(items.length), done = new Array(items.length).fill(false);
  let next = 0, committed = 0, failure = null, chain = Promise.resolve();
  const flush = () => (chain = chain.then(async () => {
    while (committed < items.length && done[committed]) { const i = committed++, r = results[i]; results[i] = undefined; await commit(r, i); }
  }));
  const worker = async () => {
    while (!failure) {
      const i = next++;
      if (i >= items.length) return;
      try { results[i] = await work(items[i], i); done[i] = true; await flush(); }
      catch (error) { failure ??= error; return; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
  if (failure) throw failure;
  await flush();
}

const RETRYABLE = new Set(['MODEL_UNAVAILABLE', 'MODEL_TIMEOUT', 'MODEL_QUOTA']);
const quantile = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]; };
const stats = xs => (xs.length ? { median: round(quantile(xs, 0.5)), p95: round(quantile(xs, 0.95)), mean: round(xs.reduce((a, b) => a + b, 0) / xs.length), max: round(Math.max(...xs)) } : null);

// Reads rows already written (resume): a record is done when all its questions have a row. A torn last line is cut.
export function readRows(file, { repair = false } = {}) {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8'), rows = [];
  let good = 0, offset = 0;
  for (const line of text.split('\n')) {
    const end = offset + Buffer.byteLength(line) + 1;
    if (line.trim()) {
      try { rows.push(JSON.parse(line)); good = end; }
      catch { if (repair) { truncateSync(file, good); } else throw fail('SERVED_ROWS', `${file}: a row is not JSON`); break; }
    } else good = end;
    offset = end;
  }
  return rows;
}

export async function scoreServed({
  records, served, rowsFile = null, fetchImpl = globalThis.fetch, url = null, concurrency = 1, expectRun = null, reread = 0, resume = false,
  retry = {}, signal = null, onProgress = null, pingRounds = 3, maxConsecutiveFailures = 8, inputFile = null, inputSha256 = null, model = SERVED_MODEL, timeoutMs = 120_000
} = {}) {
  if (!Array.isArray(records) || !records.length) throw fail('SERVED_INPUT', 'scoreServed needs records');
  if (!served) throw fail('SERVED_INPUT', 'scoreServed needs a SystemOneClient (servedClient or bridgeServedClient)');
  const { max: maxRetries = 4, baseMs = 500 } = retry;
  const startedAt = new Date().toISOString(), t0 = performance.now();

  // one served model at a time: read the identity first, and again at the end
  const identity = await describeServed(served, { signal });
  if (!runMatches(identity.run, expectRun)) throw fail('SERVED_MODEL_MISMATCH', `the service runs ${identity.run}, expected ${expectRun}`);
  const rtts = [];
  for (let i = 0; i < pingRounds; i++) { const t = performance.now(); await served.describe({ signal }); rtts.push(performance.now() - t); }

  // validate the whole file before the first request: a bad question must not cost an hour of served reads
  const questionCount = records.reduce((n, r) => n + Object.keys(r.questions).length, 0);
  for (const r of records) for (const q of Object.values(r.questions)) { const keys = questionKeys(q); labelIndex(q, keys); }

  const rowsByRecord = new Map();
  if (rowsFile) {
    mkdirSync(path.dirname(path.resolve(rowsFile)), { recursive: true });
    if (resume) for (const r of readRows(rowsFile, { repair: true })) (rowsByRecord.get(r.id) ?? rowsByRecord.set(r.id, []).get(r.id)).push(r);
    else writeFileSync(rowsFile, '');
  }
  const doneIds = new Set(records.filter(r => (rowsByRecord.get(r._meta.id)?.length ?? 0) === Object.keys(r.questions).length).map(r => r._meta.id));
  if (rowsFile && resume) {   // rows of records that are not complete (or not in this input) are dropped, so a record is never scored twice
    const keep = [...doneIds].flatMap(id => rowsByRecord.get(id)), total = [...rowsByRecord.values()].reduce((n, x) => n + x.length, 0);
    if (keep.length !== total) { const tmp = `${rowsFile}.tmp`; writeFileSync(tmp, keep.map(r => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : '')); renameSync(tmp, rowsFile); }
  }
  const todo = records.filter(r => !doneIds.has(r._meta.id));
  const coverage = { requested_records: records.length, requested_questions: questionCount, evaluated_records: doneIds.size,
    evaluated_questions: [...doneIds].reduce((n, id) => n + rowsByRecord.get(id).length, 0), rejected_records: 0, failed_records: 0, truncated_records: 0 };
  const rejected = [], failed = [], truncated = [], samples = [], inputTokens = [];
  const allRows = [...doneIds].flatMap(id => rowsByRecord.get(id));
  let consecutiveFailures = 0;

  const ask = async record => {
    const request = requestOf(record), rq = sha256(canonical(request)).slice(0, 16);
    for (let attempt = 0; ; attempt++) {
      const t = performance.now();
      try {
        const body = await served.ask({ state: request.state, questions: request.questions, signal });
        return { body, rq, wallMs: performance.now() - t };
      } catch (error) {
        if (signal?.aborted || error.code === 'CANCELLED') throw error;
        if (error.code === 'MODEL_AUTH') throw error;                                       // a refused credential ends the run
        if (error.code === 'MODEL_CONTEXT') return { rejected: String(error.message).slice(0, 300), rq };
        if (RETRYABLE.has(error.code) && attempt < (error.code === 'MODEL_TIMEOUT' ? Math.min(1, maxRetries) : maxRetries)) { await sleep(Math.min(baseMs * 2 ** attempt, 15_000)); continue; }
        return { failed: { code: error.code ?? 'ERROR', message: String(error.message).slice(0, 300) }, rq };
      }
    }
  };

  await mapOrdered(todo, concurrency, async record => ({ record, ...(await ask(record)) }), async result => {
    const { record, body, rq, wallMs } = result, id = record._meta.id;
    if (result.rejected) { coverage.rejected_records++; rejected.push({ id, error: result.rejected }); return; }
    if (result.failed) {
      coverage.failed_records++; failed.push({ id, ...result.failed });
      if (++consecutiveFailures >= maxConsecutiveFailures) throw fail('SERVED_UNAVAILABLE', `${consecutiveFailures} records in a row failed (last: ${result.failed.code}); the service is not answering`);
      return;
    }
    consecutiveFailures = 0;
    if (body.truncated === true) { coverage.truncated_records++; truncated.push({ id, state_tokens: body.usage?.state_tokens ?? null, used: body.usage?.state_tokens_used ?? null }); return; }
    const rows = rowsOf(record, body, { rq, latency_ms: body.latency_ms ?? null, wall_ms: round(wallMs, 1), input_tokens: body.usage?.input_tokens ?? null, path: 'served', run: identity.run });
    if (rowsFile) appendFileSync(rowsFile, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    allRows.push(...rows);
    coverage.evaluated_records++; coverage.evaluated_questions += rows.length;
    samples.push({ wall: wallMs, server: typeof body.latency_ms === 'number' ? body.latency_ms : null });
    if (typeof body.usage?.input_tokens === 'number') inputTokens.push(body.usage.input_tokens);
    if (onProgress) onProgress({ done: coverage.evaluated_records + coverage.rejected_records + coverage.failed_records + coverage.truncated_records, total: records.length });
  });
  const scoringSeconds = (performance.now() - t0) / 1000;

  // the raw API re-read: records in a fixed order (hash of id), through a plain fetch, compared to the rows just written
  let rereadReport = null;
  if (reread > 0) {
    if (!url) throw fail('SERVED_INPUT', 'a raw re-read needs the service url');
    const byId = new Map(records.map(r => [r._meta.id, r]));
    const ids = [...new Set(allRows.map(r => r.id))].sort((x, y) => (sha256(x) < sha256(y) ? -1 : 1)).slice(0, reread);
    const fresh = [];
    try {
      for (const id of ids) {
        const record = byId.get(id), body = await rawRead({ url, fetchImpl, request: requestOf(record), model, timeoutMs, signal });
        fresh.push(...rowsOf(record, body));
      }
      const original = allRows.filter(r => ids.includes(r.id));
      rereadReport = { records: ids.length, ...compareReads(original, fresh) };
    } catch (error) { rereadReport = { records: ids.length, agree: false, stable: false, error: `${error.code ?? 'ERROR'}: ${String(error.message).slice(0, 200)}` }; }
  }

  const after = await describeServed(served, { signal });
  const sameModel = after.run === identity.run;
  const rowsSha = rowsFile && existsSync(rowsFile) ? sha256(readFileSync(rowsFile)) : null;
  const report = {
    schema: ROWS_SCHEMA, started_at: startedAt, path: 'served',
    input: { file: inputFile, sha256: inputSha256, records: records.length, questions: questionCount },
    rows: { file: rowsFile, sha256: rowsSha, n: allRows.length },
    served: { endpoint: url ? new URL(url).origin : null, requested_model: model, identity, identity_after: after, same_model: sameModel, expected_run: expectRun === null ? null : String(expectRun) },
    concurrency, retry: { max: maxRetries, base_ms: baseMs }, coverage,
    rejected, failed, truncated,
    reread: rereadReport,
    timing: {
      wall_seconds: round(scoringSeconds, 2), requests: samples.length,
      seconds_per_request: samples.length ? round(scoringSeconds / samples.length, 4) : null,        // throughput: what J0c's 0.3 s threshold means
      requests_per_second: samples.length ? round(samples.length / scoringSeconds, 3) : null,
      wall_ms: stats(samples.map(x => x.wall)), server_latency_ms: stats(samples.filter(x => x.server !== null).map(x => x.server)),
      overhead_ms: stats(samples.filter(x => x.server !== null && x.wall >= x.server).map(x => x.wall - x.server)),
      rtt_ms: stats(rtts), input_tokens_per_request: stats(inputTokens)
    },
    valid: coverage.rejected_records === 0 && coverage.failed_records === 0 && coverage.truncated_records === 0 && coverage.evaluated_records === coverage.requested_records && sameModel
      && (!rereadReport || rereadReport.agree)
  };
  if (rowsFile) writeJsonAtomic(reportFileOf(rowsFile), report);
  return { report, rows: allRows };
}

export const reportFileOf = rowsFile => rowsFile.replace(/\.jsonl$/, '') + '.report.json';
function writeJsonAtomic(file, value) { const tmp = `${file}.tmp`; writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n'); renameSync(tmp, file); }

// ---- CLI ---------------------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const o = { concurrency: 1, reread: 0, resume: false, bridge: false, timeoutMs: 120_000 };
  const take = (i, name) => { if (i + 1 >= argv.length) throw fail('USAGE', `${name} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data') o.data = take(i++, a);
    else if (a === '--out') o.out = take(i++, a);
    else if (a === '--url') o.url = take(i++, a);
    else if (a === '--bridge') o.bridge = true;
    else if (a === '--concurrency') o.concurrency = Number(take(i++, a));
    else if (a === '--reread') o.reread = Number(take(i++, a));
    else if (a === '--limit') o.limit = Number(take(i++, a));
    else if (a === '--expect-run') o.expectRun = take(i++, a);
    else if (a === '--timeout-ms') o.timeoutMs = Number(take(i++, a));
    else if (a === '--resume') o.resume = true;
    else throw fail('USAGE', `unknown argument ${a}`);
  }
  if (!o.data || !o.out) throw fail('USAGE', '--data and --out are required');
  if (!!o.url === o.bridge) throw fail('USAGE', 'give exactly one of --url or --bridge');
  for (const k of ['concurrency', 'reread', 'timeoutMs']) if (!Number.isInteger(o[k]) || o[k] < 0 || (k !== 'reread' && o[k] < 1)) throw fail('USAGE', `--${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)} must be a positive integer`);
  return o;
}

async function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (error) { console.error(`score-served: ${error.message}`); return 2; }
  const { records, sha256: inputSha256 } = loadKevRecords(o.data);
  const subset = o.limit ? records.slice(0, o.limit) : records;
  let served, url, fetchImpl;
  if (o.bridge) ({ served, url, fetchImpl } = await bridgeServedClient({ timeoutMs: o.timeoutMs }));
  else { url = o.url.replace(/\/+$/, ''); fetchImpl = globalThis.fetch; served = servedClient({ url, fetchImpl, timeoutMs: o.timeoutMs }); }
  let last = 0;
  const { report } = await scoreServed({ records: subset, served, url, fetchImpl, rowsFile: o.out, concurrency: o.concurrency, expectRun: o.expectRun ?? null, reread: o.reread, resume: o.resume,
    inputFile: path.basename(o.data), inputSha256, timeoutMs: o.timeoutMs, onProgress: ({ done, total }) => { if (done - last >= 50 || done === total) { last = done; console.error(`scored ${done}/${total}`); } } });
  console.log(JSON.stringify({ valid: report.valid, coverage: report.coverage, timing: { seconds_per_request: report.timing.seconds_per_request }, reread: report.reread, rows: report.rows }, null, 2));
  return report.valid ? 0 : 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(code => process.exit(code), error => { console.error(`score-served: ${error.code ?? 'ERROR'}: ${error.message}`); process.exit(error.code === 'USAGE' ? 2 : 1); });
}
