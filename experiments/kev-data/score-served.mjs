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
// Library: parseKevText, loadKevRecords, subsetRecords, requestOf, questionKeys, scoreServed, describeServed, rawRead,
// compareReads, floorAndRenormalize, servedClient, bridgeServedClient, jevConfig, jevClient, requestLedger, readRows, permuteRead. CLI:
//   node experiments/kev-data/score-served.mjs --data <kev.jsonl> --out <rows.jsonl> \
//        (--url http://127.0.0.1:8008 | --bridge) [--concurrency 1] [--expect-run <run>] [--reread 20] \
//        [--limit N] [--resume] [--timeout-ms 120000] [--repeat 2] [--max-request-bytes N (default with --bridge: the daemon's limits.jsonBytes)]
//   node experiments/kev-data/score-served.mjs --data <kev.jsonl> --out <permute.json> --permute 200 (--url ... | --bridge)
// --repeat 2 sends every request twice in a row (the second is answered from kev.serve's prefix cache): fresh and cached latency (§6.5).
// --permute N runs POST /v1/systemone/permute on N items and writes the flip rate (§6.4 item 4) instead of scoring.
// --url is the kev.serve base (for a local service); --bridge connects through bridge/cloud/client.mjs
// (FOUNDRY_BRIDGE_URL or discovery) and signs every request. Exit 0 = valid run, 3 = invalid, 2 = usage.
//
// --jev (2026-10-09, owner direction: Jev replaces Kev for the judge program) scores against TypeSafe's hosted Jev instead:
//   node experiments/kev-data/score-served.mjs --data <kev.jsonl> --out <rows.jsonl> --jev [--jev-model <id>] \
//        [--concurrency 2] [--reread 20] [--resume] [--request-cap 1400 --request-ledger <requests.jsonl>]
// The request names the pinned version JEV_MODEL (jev-1.13.0, the policy's judgment model since 2026-10-15), never the
// moving alias. --jev-model is the explicit override for a deliberate re-read on another version; that id must be listed
// in policy judgmentModels too (jevConfig refuses any other).
// The model id and the base URL come from policy/models.json (judgmentModels, provider kind systemone-http); the bearer is
// whatever the environment variable the policy names holds (SystemOneClient reads FOUNDRY_SYSTEMONE_API_KEY), never a file.
// Jev documents no /v1/models, so the served version is read from every response's `model` field and written on every row;
// a run whose responses name more than one version is flagged (same_model false, the versions and their counts listed).
// Every row also carries the request's `usage`. 429, 529, other 5xx, network errors and timeouts are retried with
// exponential backoff and logged as faults (report.faults), never scored as answers; a record that still fails is a failed
// record (the run is invalid until --resume reads it). Every attempt is logged, before it is sent, to the request ledger,
// and a run that would take the ledger past --request-cap is refused up front; an attempt past the cap stops the run.
// Responses are kept verbatim in <rows>.raw.jsonl; the --reread rows go to <rows>.reread.jsonl.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, truncateSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FoundryError } from '../../src/data.mjs';
import { SystemOneClient } from '../../src/judgment.mjs';
import { JUDGMENT_KIND, judgmentModelById, loadPolicy } from '../../src/models/policy.mjs';
import { canonical, sha256 } from './lib/hash.mjs';

export const ROWS_SCHEMA = 'kev-data/served-rows@1';
export const PROB_FLOOR = 5e-5;                 // §7.5: probabilities are floored at 5e-5 before any transform
export const PROB_DECIMALS = 4;                 // kev.api.round_prob
export const STABLE_DP = 0.01;                  // §7.5 stability test and the 20-record raw re-read
export const STABLE_FLIP_RATE = 0.005;          // §7.5: at most 0.5% argmax flips
export const SERVED_MODEL = 'kev-latest';       // kev.serve MODEL_NAMES: kev-latest and jev-latest serve the same checkpoint
export const JEV_MODEL = 'jev-1.13.0';          // hosted Jev, pinned: a policy judgment model (policy/models.json judgmentModels), checked there
export const JEV_RETRY = Object.freeze({ max: 6, baseMs: 2000, capMs: 60_000 });   // 2, 4, 8, 16, 32, 60 s: rate limits are undocumented
export const JEV_CONCURRENCY = 2;
const JEV_CREDENTIAL_ENV = 'FOUNDRY_SYSTEMONE_API_KEY';   // the variable SystemOneClient reads (src/judgment.mjs); the policy must name it

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

// A fixed sample of a file: its records in the order of sha256(id), taken until their questions reach `rows` (every record
// when the file has fewer), returned in file order. The same sample for every model that reads the file (§7.5: the 300-row
// served re-read beside kev.benchmark's fp32 read of a file that fits the training context).
export function subsetRecords(records, rows) {
  if (!Number.isInteger(rows) || rows < 1) throw fail('SERVED_INPUT', 'a subset needs a positive number of rows');
  const keep = new Set();
  let n = 0;
  for (const r of [...records].sort((a, b) => (sha256(a._meta.id) < sha256(b._meta.id) ? -1 : 1))) {
    if (n >= rows) break;
    keep.add(r); n += Object.keys(r.questions).length;
  }
  return records.filter(r => keep.has(r));
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
export const runMatches = (run, expect) => expect === undefined || expect === null || (expect instanceof RegExp ? expect.test(run) : run === expect || run.endsWith(`/${expect}`));

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

// Hosted Jev, from the policy only: the judgment model id, its provider's base URL and the name of the credential variable.
export function jevConfig(policy, id = JEV_MODEL) {
  const { entry, provider } = judgmentModelById(policy, id);
  if (provider.kind !== JUDGMENT_KIND) throw fail('JEV_POLICY', `provider ${entry.provider} is not a ${JUDGMENT_KIND} provider`);
  if ((provider.route ?? '/v1/systemone') !== '/v1/systemone') throw fail('JEV_POLICY', `provider ${entry.provider} route ${provider.route} is not the System One route SystemOneClient speaks`);
  if (provider.credentialEnv !== JEV_CREDENTIAL_ENV) throw fail('JEV_POLICY', `provider ${entry.provider} names credential variable ${provider.credentialEnv}; SystemOneClient reads ${JEV_CREDENTIAL_ENV} only`);
  return { model: entry.id, provider: entry.provider, url: provider.baseUrl.replace(/\/+$/, ''), credentialEnv: provider.credentialEnv };
}
// A SystemOneClient for Jev with the bearer from the environment variable the policy names (only that variable is handed to
// the client). A missing variable is refused before any request; its value is never printed, logged or written.
export function jevClient({ policy = loadPolicy().policy, model = JEV_MODEL, fetchImpl = globalThis.fetch, timeoutMs = 120_000, env = process.env } = {}) {
  const config = jevConfig(policy, model), credential = env[config.credentialEnv];
  if (typeof credential !== 'string' || !credential) throw fail('JEV_CREDENTIAL', `${config.credentialEnv} is not set: map the owner's key into it for this command (from the shell environment, never a file)`);
  return { config, served: new SystemOneClient({ url: config.url, model: config.model, timeoutMs, fetchImpl, env: { [config.credentialEnv]: credential } }) };
}

// The request ledger: one line per attempted request, written BEFORE the request is sent (so a killed run never undercounts),
// shared by every run that names the same file; take() refuses an attempt past the cap. A line holds the tag, record id, attempt
// and request hash, never a header or a body.
export function requestLedger({ file = null, cap = null } = {}) {
  if (cap !== null && (!Number.isInteger(cap) || cap < 0)) throw fail('USAGE', 'the request cap must be a non-negative integer');
  if (file) mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  let n = file ? readRows(file, { repair: true }).length : 0;
  return {
    file, cap,
    get count() { return n; },
    room(k) { return cap === null || n + k <= cap; },
    take(entry) {
      if (cap !== null && n + 1 > cap) throw fail('REQUEST_CAP', `the request cap of ${cap} is reached (${n} requests in ${file ?? 'this run'}); nothing more is sent`);
      n++;
      if (file) appendFileSync(file, JSON.stringify({ n, at: new Date().toISOString(), ...entry }) + '\n');
      return n;
    }
  };
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

// ---- the permutation read (§6.4 item 4: /permute on 200 items) --------------------------------------------------------

// kev.serve's POST /v1/systemone/permute re-runs one choice question under n_perm option orders (the first is the given
// order, the rest shuffled from `seed`). The flip rate is the share of items whose argmax is not the same under every
// order. One question per record, the first choice question, records in the order of a hash of their id; n items.
export async function permuteRead({ records, url, fetchImpl = globalThis.fetch, n = 200, nPerm = 6, seed = 0, model = SERVED_MODEL, timeoutMs = 120_000, signal } = {}) {
  const pick = records.map(r => ({ r, qid: Object.keys(r.questions).find(q => r.questions[q].type === 'choice' && Object.keys(r.questions[q].criteria).length >= 2) })).filter(x => x.qid)
    .sort((a, b) => (sha256(a.r._meta.id) < sha256(b.r._meta.id) ? -1 : 1)).slice(0, n);
  if (!pick.length) throw fail('SERVED_INPUT', 'the permutation read needs choice questions with at least two options');
  const items = [];
  for (const { r, qid } of pick) {
    const request = requestOf(r), timeout = AbortSignal.timeout(timeoutMs);
    const res = await fetchImpl(`${url.replace(/\/+$/, '')}/v1/systemone/permute`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request: { state: request.state, model, questions: { [qid]: request.questions[qid] } }, question: qid, n_perm: nPerm, seed }), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    const text = await res.text();
    if (res.status !== 200) throw fail('SERVED_RAW', `POST /v1/systemone/permute returned ${res.status}: ${text.slice(0, 200)}`, { status: res.status });
    const body = JSON.parse(text);
    if (!Array.isArray(body.runs) || body.runs.length !== nPerm || typeof body.argmax_stable !== 'boolean') throw fail('SERVED_ANSWER', 'the permute answer is not {runs[n_perm], argmax_stable, spread}');
    if (body.truncated === true) throw fail('SERVED_ANSWER', 'the permute answer is truncated');
    const spread = Math.max(...Object.values(body.spread ?? {}).map(Number));
    items.push({ id: r._meta.id, question: qid, stable: body.argmax_stable, max_spread: round(spread, 4) });
  }
  const flips = items.filter(x => !x.stable).length;
  return { items: items.length, n_perm: nPerm, seed, flips, flip_rate: round(flips / items.length, 4), mean_max_spread: round(items.reduce((a, x) => a + x.max_spread, 0) / items.length, 4), max_spread: round(Math.max(...items.map(x => x.max_spread)), 4), per_item: items };
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
const stats = xs => (xs.length ? { median: round(quantile(xs, 0.5)), p90: round(quantile(xs, 0.9)), p95: round(quantile(xs, 0.95)), mean: round(xs.reduce((a, b) => a + b, 0) / xs.length), max: round(Math.max(...xs)) } : null);

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
  retry = {}, signal = null, onProgress = null, pingRounds = 3, maxConsecutiveFailures = 8, inputFile = null, inputSha256 = null, model = SERVED_MODEL, timeoutMs = 120_000, repeat = 1,
  maxRequestBytes = null,     // the bridge's limits.jsonBytes: a larger request is a counted rejection, never sent (the daemon would answer 413)
  identityFrom = 'models',    // 'models': one GET /v1/models before and after (kev.serve); 'response': every response's `model` (hosted Jev, no /v1/models)
  ledger = null,              // requestLedger(): every attempt logged before it is sent, and the cap enforced
  rawFile = undefined         // verbatim responses (default with identityFrom 'response': <rows>.raw.jsonl); null = none
} = {}) {
  if (!Array.isArray(records) || !records.length) throw fail('SERVED_INPUT', 'scoreServed needs records');
  if (!served) throw fail('SERVED_INPUT', 'scoreServed needs a SystemOneClient (servedClient or bridgeServedClient)');
  if (!['models', 'response'].includes(identityFrom)) throw fail('SERVED_INPUT', "identityFrom is 'models' or 'response'");
  const perResponse = identityFrom === 'response';
  if (perResponse && repeat > 1) throw fail('SERVED_INPUT', 'the latency repeat is a kev.serve prefix-cache read; a hosted model is not asked twice');
  const { max: maxRetries = 4, baseMs = 500, capMs = 15_000 } = retry;
  const startedAt = new Date().toISOString(), t0 = performance.now();

  // one served model at a time: read the identity first, and again at the end (per response, for a server with no /v1/models)
  const identity = perResponse ? { mode: 'per-response', run: null } : await describeServed(served, { signal });
  if (!perResponse && !runMatches(identity.run, expectRun)) throw fail('SERVED_MODEL_MISMATCH', `the service runs ${identity.run}, expected ${expectRun}`);
  const rtts = [];
  if (!perResponse) for (let i = 0; i < pingRounds; i++) { const t = performance.now(); await served.describe({ signal }); rtts.push(performance.now() - t); }

  // validate the whole file before the first request: a bad question must not cost an hour of served reads
  const questionCount = records.reduce((n, r) => n + Object.keys(r.questions).length, 0);
  for (const r of records) for (const q of Object.values(r.questions)) { const keys = questionKeys(q); labelIndex(q, keys); }

  const rowsByRecord = new Map();
  if (rowsFile && resume) for (const r of readRows(rowsFile, { repair: true })) (rowsByRecord.get(r.id) ?? rowsByRecord.set(r.id, []).get(r.id)).push(r);
  const doneIds = new Set(records.filter(r => (rowsByRecord.get(r._meta.id)?.length ?? 0) === Object.keys(r.questions).length).map(r => r._meta.id));
  const todo = records.filter(r => !doneIds.has(r._meta.id));
  // the request cap: a run that would take the ledger past it is refused before the first request and before any file is
  // touched (each record is one request at least, the re-read one more per record); retries count as they happen, and an
  // attempt past the cap stops the run
  const plannedRequests = todo.length + (reread > 0 ? Math.min(reread, records.length) : 0);
  if (ledger && !ledger.room(plannedRequests)) throw fail('REQUEST_CAP', `this run needs at least ${plannedRequests} requests; the ledger holds ${ledger.count} of a cap of ${ledger.cap}`);
  if (rowsFile) {
    mkdirSync(path.dirname(path.resolve(rowsFile)), { recursive: true });
    if (!resume) writeFileSync(rowsFile, '');
    else {    // rows of records that are not complete (or not in this input) are dropped, so a record is never scored twice
      const keep = [...doneIds].flatMap(id => rowsByRecord.get(id)), total = [...rowsByRecord.values()].reduce((n, x) => n + x.length, 0);
      if (keep.length !== total) { const tmp = `${rowsFile}.tmp`; writeFileSync(tmp, keep.map(r => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : '')); renameSync(tmp, rowsFile); }
    }
  }
  const rawOut = rawFile === undefined ? (perResponse && rowsFile ? rawFileOf(rowsFile) : null) : rawFile;
  if (rawOut) { mkdirSync(path.dirname(path.resolve(rawOut)), { recursive: true }); if (!resume) writeFileSync(rawOut, ''); }
  const coverage = { requested_records: records.length, requested_questions: questionCount, evaluated_records: doneIds.size,
    evaluated_questions: [...doneIds].reduce((n, id) => n + rowsByRecord.get(id).length, 0), rejected_records: 0, failed_records: 0, truncated_records: 0 };
  const rejected = [], failed = [], truncated = [], samples = [], inputTokens = [], cachedSamples = [], faults = [];
  const allRows = [...doneIds].flatMap(id => rowsByRecord.get(id));
  let consecutiveFailures = 0;

  // one request with its retries: transient errors (429, 5xx including 529, network, a timeout once) back off exponentially and
  // are logged as faults; a 422 is a rejection; anything else is a failed record. Never an answer.
  const attempt = async (record, request, rq, phase) => {
    for (let n = 0; ; n++) {
      if (ledger) ledger.take({ tag: phase, input: inputFile, id: record._meta.id, attempt: n + 1, rq });
      const t = performance.now();
      try {
        const body = await served.ask({ state: request.state, questions: request.questions, signal });
        return { body, wallMs: performance.now() - t, attempts: n + 1 };
      } catch (error) {
        if (signal?.aborted || error.code === 'CANCELLED') throw error;
        if (error.code === 'MODEL_AUTH') throw error;                                       // a refused credential ends the run
        if (error.code === 'MODEL_CONTEXT') return { rejected: String(error.message).slice(0, 300), attempts: n + 1 };
        const retryable = RETRYABLE.has(error.code) && n < (error.code === 'MODEL_TIMEOUT' ? Math.min(1, maxRetries) : maxRetries);
        faults.push({ phase, id: record._meta.id, attempt: n + 1, code: error.code ?? 'ERROR', status: error.details?.status ?? null, retried: retryable, at: new Date().toISOString() });
        if (retryable) { await sleep(Math.min(baseMs * 2 ** n, capMs)); continue; }
        return { failed: { code: error.code ?? 'ERROR', status: error.details?.status ?? null, message: String(error.message).slice(0, 300) }, attempts: n + 1 };
      }
    }
  };
  const ask = async record => {
    const request = requestOf(record), rq = sha256(canonical(request)).slice(0, 16);
    if (maxRequestBytes) {
      const bytes = Buffer.byteLength(JSON.stringify({ state: request.state, model, questions: request.questions }));
      if (bytes > maxRequestBytes) return { rejected: `the request is ${bytes} bytes, over the bridge's ${maxRequestBytes}-byte body limit (limits.jsonBytes)`, rq };
    }
    const got = await attempt(record, request, rq, 'score');
    if (!got.body) return { ...got, rq };
    // repeat 2 (the latency gate, §6.5): the same request again straight away, which the server answers from its state-prefix cache
    let cached = null;
    if (repeat > 1) { const t2 = performance.now(), again = await served.ask({ state: request.state, questions: request.questions, signal }); cached = { wallMs: performance.now() - t2, serverMs: typeof again.latency_ms === 'number' ? again.latency_ms : null }; }
    return { body: got.body, rq, wallMs: got.wallMs, attempts: got.attempts, cached };
  };
  // the served version of one response (per-response identity): its `model` field, which must be a non-empty string
  const versionOf = body => { if (typeof body?.model !== 'string' || !body.model) throw fail('SERVED_MODEL', 'the response names no model; every row must record the version that produced it'); return body.model; };
  const jevExtra = (body, attempts) => ({ model: versionOf(body), requested_model: model, usage: body.usage ?? null, output_tokens: body.usage?.output_tokens ?? null, attempts });
  const withAnswerFields = (rows, body) => { for (const r of rows) { const a = body.answers[r.question]; r.choice = a?.choice ?? null; r.confidence = a?.confidence ?? null; } return rows; };

  const tScore = performance.now();
  await mapOrdered(todo, concurrency, async record => ({ record, ...(await ask(record)) }), async result => {
    const { record, body, rq, wallMs, cached } = result, id = record._meta.id;
    if (result.rejected) { coverage.rejected_records++; rejected.push({ id, error: result.rejected }); return; }
    if (result.failed) {
      coverage.failed_records++; failed.push({ id, ...result.failed });
      if (++consecutiveFailures >= maxConsecutiveFailures) throw fail('SERVED_UNAVAILABLE', `${consecutiveFailures} records in a row failed (last: ${result.failed.code}); the service is not answering`);
      return;
    }
    if (rawOut) appendFileSync(rawOut, JSON.stringify({ phase: 'score', id, rq, attempts: result.attempts, at: new Date().toISOString(), body }) + '\n');
    if (body.truncated === true) { coverage.truncated_records++; truncated.push({ id, state_tokens: body.usage?.state_tokens ?? null, used: body.usage?.state_tokens_used ?? null }); return; }
    let rows;
    try {
      rows = rowsOf(record, body, { rq, latency_ms: body.latency_ms ?? null, wall_ms: round(wallMs, 1), input_tokens: body.usage?.input_tokens ?? null,
        path: perResponse ? 'jev' : 'served', run: perResponse ? versionOf(body) : identity.run, ...(perResponse ? jevExtra(body, result.attempts) : {}) });
      if (perResponse) withAnswerFields(rows, body);
    }
    catch (error) {                          // an answer that is not a valid distribution is a failed record, counted and listed
      coverage.failed_records++; failed.push({ id, code: error.code ?? 'SERVED_ANSWER', message: String(error.message).slice(0, 300) });
      if (++consecutiveFailures >= maxConsecutiveFailures) throw fail('SERVED_UNAVAILABLE', `${consecutiveFailures} records in a row failed (last: ${error.code}); the service is not answering sensibly`);
      return;
    }
    consecutiveFailures = 0;
    if (rowsFile) appendFileSync(rowsFile, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    allRows.push(...rows);
    coverage.evaluated_records++; coverage.evaluated_questions += rows.length;
    samples.push({ wall: wallMs, server: typeof body.latency_ms === 'number' ? body.latency_ms : null });
    if (cached) cachedSamples.push(cached);
    if (typeof body.usage?.input_tokens === 'number') inputTokens.push(body.usage.input_tokens);
    if (onProgress) onProgress({ done: coverage.evaluated_records + coverage.rejected_records + coverage.failed_records + coverage.truncated_records, total: records.length });
  });
  const scoringSeconds = (performance.now() - tScore) / 1000;      // the scoring phase only: not the identity reads, the pings or the re-read

  // the raw API re-read: records in a fixed order (hash of id), through a plain fetch, compared to the rows just written.
  // Per-response identity (hosted Jev): through the same authenticated client and retry rule, its rows kept in <rows>.reread.jsonl.
  let rereadReport = null;
  const rereadVersions = new Map();
  if (reread > 0) {
    if (!url && !perResponse) throw fail('SERVED_INPUT', 'a raw re-read needs the service url');
    const byId = new Map(records.map(r => [r._meta.id, r]));
    const ids = [...new Set(allRows.map(r => r.id))].sort((x, y) => (sha256(x) < sha256(y) ? -1 : 1)).slice(0, reread);
    const fresh = [];
    try {
      for (const id of ids) {
        const record = byId.get(id);
        if (perResponse) {
          const request = requestOf(record), rq = sha256(canonical(request)).slice(0, 16), got = await attempt(record, request, rq, 'reread');
          if (!got.body) throw fail('SERVED_RAW', `the re-read of ${id} ${got.rejected ? `was rejected: ${got.rejected}` : `failed: ${got.failed.code}`}`);
          if (rawOut) appendFileSync(rawOut, JSON.stringify({ phase: 'reread', id, rq, attempts: got.attempts, at: new Date().toISOString(), body: got.body }) + '\n');
          const v = versionOf(got.body);
          rereadVersions.set(v, (rereadVersions.get(v) ?? 0) + 1);
          fresh.push(...withAnswerFields(rowsOf(record, got.body, { rq, path: 'jev-reread', run: v, ...jevExtra(got.body, got.attempts) }), got.body));
        } else {
          const body = await rawRead({ url, fetchImpl, request: requestOf(record), model, timeoutMs, signal });
          fresh.push(...rowsOf(record, body));
        }
      }
      const original = allRows.filter(r => ids.includes(r.id));
      rereadReport = { records: ids.length, ...compareReads(original, fresh) };
    } catch (error) {
      if (error.code === 'MODEL_AUTH' || error.code === 'REQUEST_CAP' || error.code === 'CANCELLED') throw error;
      rereadReport = { records: ids.length, agree: false, stable: false, error: `${error.code ?? 'ERROR'}: ${String(error.message).slice(0, 200)}` };
    }
    if (perResponse && rowsFile) writeFileSync(rereadFileOf(rowsFile), fresh.map(r => JSON.stringify(r)).join('\n') + (fresh.length ? '\n' : ''));
    if (perResponse && rereadReport) rereadReport.versions = Object.fromEntries(rereadVersions);
  }

  // the served model: the same at the end as at the start (kev.serve), or one version across every response (hosted Jev)
  const modelCheck = async () => {
    const after = await describeServed(served, { signal });
    const sameModel = after.run === identity.run;
    return { after, sameModel };
  };
  // per response: the versions and the usage of every scored record in the rows file (one request each; resumed rows included),
  // read from each record's first row; re-reads and retried attempts are not in these totals (the ledger counts attempts)
  const versions = new Map(), usageTotals = { requests: 0, input_tokens: 0, output_tokens: 0, missing_usage: 0 };
  if (perResponse) {
    const firstQ = new Map(records.map(r => [r._meta.id, Object.keys(r.questions)[0]]));
    for (const r of allRows) if (firstQ.get(r.id) === r.question) {
      versions.set(r.model ?? null, (versions.get(r.model ?? null) ?? 0) + 1);
      usageTotals.requests++;
      if (typeof r.usage?.input_tokens === 'number') usageTotals.input_tokens += r.usage.input_tokens; else usageTotals.missing_usage++;
      if (typeof r.usage?.output_tokens === 'number') usageTotals.output_tokens += r.usage.output_tokens;
    }
  }
  const allVersions = new Set([...versions.keys(), ...rereadVersions.keys()]);
  const { after, sameModel } = perResponse ? { after: null, sameModel: allVersions.size <= 1 } : await modelCheck();
  if (perResponse) { identity.run = allVersions.size === 1 ? [...allVersions][0] : null; identity.versions = Object.fromEntries(versions); }
  const rowsSha = rowsFile && existsSync(rowsFile) ? sha256(readFileSync(rowsFile)) : null;
  const faultCounts = {};
  for (const f of faults) { const k = `${f.code}${f.status ? `:${f.status}` : ''}`; faultCounts[k] = (faultCounts[k] ?? 0) + 1; }
  const report = {
    schema: ROWS_SCHEMA, started_at: startedAt, path: perResponse ? 'jev' : 'served',
    input: { file: inputFile, sha256: inputSha256, records: records.length, questions: questionCount },
    rows: { file: rowsFile, sha256: rowsSha, n: allRows.length, ...(rawOut ? { raw: rawOut } : {}), ...(perResponse && reread > 0 && rowsFile ? { reread: rereadFileOf(rowsFile) } : {}) },
    served: { endpoint: url ? new URL(url).origin : null, requested_model: model, identity, identity_after: after, same_model: sameModel, expected_run: expectRun === null ? null : String(expectRun),
      ...(perResponse ? { identity_from: 'response', versions: Object.fromEntries(versions), reread_versions: Object.fromEntries(rereadVersions), model_changed: allVersions.size > 1 } : {}) },
    concurrency, repeat, retry: { max: maxRetries, base_ms: baseMs, cap_ms: capMs }, max_request_bytes: maxRequestBytes, coverage,
    rejected, failed, truncated,
    faults: { n: faults.length, by_code: faultCounts, list: faults },
    ...(perResponse ? { usage: { ...usageTotals, scope: 'every scored record in the rows file, one request each; not the re-read or retried attempts (see requests and faults)' } } : {}),
    ...(ledger ? { requests: { ledger: ledger.file, cap: ledger.cap, count_after: ledger.count } } : {}),
    reread: rereadReport,
    timing: {
      wall_seconds: round(scoringSeconds, 2), requests: samples.length,
      seconds_per_request: samples.length ? round(scoringSeconds / samples.length, 4) : null,        // throughput: what J0c's 0.3 s threshold means
      requests_per_second: samples.length ? round(samples.length / scoringSeconds, 3) : null,
      wall_ms: stats(samples.map(x => x.wall)), server_latency_ms: stats(samples.filter(x => x.server !== null).map(x => x.server)),
      overhead_ms: stats(samples.filter(x => x.server !== null && x.wall >= x.server).map(x => x.wall - x.server)),
      rtt_ms: stats(rtts), input_tokens_per_request: stats(inputTokens),
      ...(cachedSamples.length ? { cached_wall_ms: stats(cachedSamples.map(x => x.wallMs)), cached_server_latency_ms: stats(cachedSamples.filter(x => x.serverMs !== null).map(x => x.serverMs)) } : {})
    },
    valid: coverage.rejected_records === 0 && coverage.failed_records === 0 && coverage.truncated_records === 0 && coverage.evaluated_records === coverage.requested_records && sameModel
      && (!rereadReport || rereadReport.agree)
  };
  if (rowsFile) writeJsonAtomic(reportFileOf(rowsFile), report);
  return { report, rows: allRows };
}

export const reportFileOf = rowsFile => rowsFile.replace(/\.jsonl$/, '') + '.report.json';
export const rawFileOf = rowsFile => rowsFile.replace(/\.jsonl$/, '') + '.raw.jsonl';
export const rereadFileOf = rowsFile => rowsFile.replace(/\.jsonl$/, '') + '.reread.jsonl';
function writeJsonAtomic(file, value) { const tmp = `${file}.tmp`; writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n'); renameSync(tmp, file); }

// ---- CLI ---------------------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const o = { concurrency: null, reread: 0, repeat: 1, permute: 0, resume: false, bridge: false, jev: false, timeoutMs: 120_000, maxRequestBytes: 0, requestCap: null, requestLedger: null };
  const take = (i, name) => { if (i + 1 >= argv.length) throw fail('USAGE', `${name} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data') o.data = take(i++, a);
    else if (a === '--out') o.out = take(i++, a);
    else if (a === '--url') o.url = take(i++, a);
    else if (a === '--bridge') o.bridge = true;
    else if (a === '--jev') o.jev = true;
    else if (a === '--jev-model') o.jevModel = take(i++, a);
    else if (a === '--request-cap') o.requestCap = Number(take(i++, a));
    else if (a === '--request-ledger') o.requestLedger = take(i++, a);
    else if (a === '--concurrency') o.concurrency = Number(take(i++, a));
    else if (a === '--reread') o.reread = Number(take(i++, a));
    else if (a === '--repeat') o.repeat = Number(take(i++, a));
    else if (a === '--permute') o.permute = Number(take(i++, a));
    else if (a === '--limit') o.limit = Number(take(i++, a));
    else if (a === '--expect-run') o.expectRun = take(i++, a);
    else if (a === '--timeout-ms') o.timeoutMs = Number(take(i++, a));
    else if (a === '--max-request-bytes') o.maxRequestBytes = Number(take(i++, a));
    else if (a === '--resume') o.resume = true;
    else throw fail('USAGE', `unknown argument ${a}`);
  }
  if (!o.data || !o.out) throw fail('USAGE', '--data and --out are required');
  if ([!!o.url, o.bridge, o.jev].filter(Boolean).length !== 1) throw fail('USAGE', 'give exactly one of --url, --bridge or --jev');
  if (!o.jev && (o.jevModel || o.requestCap !== null || o.requestLedger)) throw fail('USAGE', '--jev-model, --request-cap and --request-ledger go with --jev');
  if (o.jev && (o.permute || o.repeat > 1 || o.expectRun)) throw fail('USAGE', '--permute, --repeat and --expect-run are kev.serve reads; Jev has no /permute, prefix cache or /v1/models');
  if (o.requestCap !== null && (!Number.isInteger(o.requestCap) || o.requestCap < 0)) throw fail('USAGE', '--request-cap must be a non-negative integer');
  if (o.requestCap !== null && !o.requestLedger) throw fail('USAGE', '--request-cap needs --request-ledger (the count is kept across runs)');
  o.concurrency ??= o.jev ? JEV_CONCURRENCY : 1;
  for (const k of ['concurrency', 'reread', 'timeoutMs', 'repeat', 'permute', 'maxRequestBytes']) if (!Number.isInteger(o[k]) || o[k] < 0 || (!['reread', 'permute', 'maxRequestBytes'].includes(k) && o[k] < 1)) throw fail('USAGE', `--${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)} must be a positive integer`);
  return o;
}

async function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (error) { console.error(`score-served: ${error.message}`); return 2; }
  const { records, sha256: inputSha256 } = loadKevRecords(o.data);
  const subset = o.limit ? records.slice(0, o.limit) : records;
  let served, url, fetchImpl, maxRequestBytes = o.maxRequestBytes || null, model = SERVED_MODEL, ledger = null, retry = {};
  if (o.jev) {
    let config;
    ({ config, served } = jevClient({ model: o.jevModel ?? JEV_MODEL, timeoutMs: o.timeoutMs }));     // refuses a missing credential variable
    url = config.url; model = config.model; retry = JEV_RETRY;
    ledger = requestLedger({ file: o.requestLedger ?? null, cap: o.requestCap });
  } else if (o.bridge) {
    let client;
    ({ client, served, url, fetchImpl } = await bridgeServedClient({ timeoutMs: o.timeoutMs }));
    maxRequestBytes ??= (await client.info().catch(() => null))?.limits?.jsonBytes ?? 1024 * 1024;   // the daemon's body limit (bridge default 1 MiB)
  } else { url = o.url.replace(/\/+$/, ''); fetchImpl = globalThis.fetch; served = servedClient({ url, fetchImpl, timeoutMs: o.timeoutMs }); }
  if (o.permute) {
    const identity = await describeServed(served);
    if (!runMatches(identity.run, o.expectRun ?? null)) throw fail('SERVED_MODEL_MISMATCH', `the service runs ${identity.run}, expected ${o.expectRun}`);
    const result = await permuteRead({ records: subset, url, fetchImpl, n: o.permute, timeoutMs: o.timeoutMs });
    mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
    writeJsonAtomic(o.out, { schema: 'kev-data/served-permute@1', input: { file: path.basename(o.data), sha256: inputSha256 }, served: { identity }, ...result });
    console.log(JSON.stringify({ items: result.items, flips: result.flips, flip_rate: result.flip_rate, mean_max_spread: result.mean_max_spread }, null, 2));
    return 0;
  }
  let last = 0;
  const { report } = await scoreServed({ records: subset, served, url, fetchImpl, rowsFile: o.out, concurrency: o.concurrency, expectRun: o.expectRun ?? null, reread: o.reread, repeat: o.repeat, resume: o.resume,
    inputFile: path.basename(o.data), inputSha256, timeoutMs: o.timeoutMs, maxRequestBytes, model, retry, ledger, identityFrom: o.jev ? 'response' : 'models', onProgress: ({ done, total }) => { if (done - last >= 50 || done === total) { last = done; console.error(`scored ${done}/${total}`); } } });
  console.log(JSON.stringify({ valid: report.valid, coverage: report.coverage, timing: { seconds_per_request: report.timing.seconds_per_request }, reread: report.reread, rows: report.rows,
    ...(o.jev ? { served: { requested_model: report.served.requested_model, versions: report.served.versions, model_changed: report.served.model_changed }, usage: report.usage, faults: report.faults.by_code, requests: report.requests } : {}) }, null, 2));
  return report.valid ? 0 : 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(code => process.exit(code), error => { console.error(`score-served: ${error.code ?? 'ERROR'}: ${error.message}`); process.exit(error.code === 'USAGE' ? 2 : 1); });
}
