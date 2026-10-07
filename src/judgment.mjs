// Typed-judgment engines and the calibration ledger (ROADMAP §2.4, THESIS §7).
//
// SystemOneClient speaks the TypeSafe System One wire format, which Jev serves and which Kev serves
// locally (`python -m kev.serve`): typed questions in, a probability per option out, in one pass.
// The ledger records every judgment and, later, its verified outcome; calibrationReport turns the
// labelled rows into the per-port numbers a port must show before it may gate anything.
import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { digest, FoundryError } from './data.mjs';

const CREDENTIAL_ENV = 'FOUNDRY_SYSTEMONE_API_KEY';

export class SystemOneClient {
  #fetch; #apiKey;
  constructor({ url = process.env.FOUNDRY_SYSTEMONE_URL, model = 'kev-latest', timeoutMs = 120000, fetchImpl = globalThis.fetch, env = process.env } = {}) {
    if (typeof url !== 'string' || !/^https?:\/\/[^\s]+$/.test(url)) throw new FoundryError('PORT_CONFIG', 'SystemOneClient needs an http(s) url (FOUNDRY_SYSTEMONE_URL)');
    this.url = url.replace(/\/+$/, ''); this.model = model; this.timeoutMs = timeoutMs;
    this.#fetch = fetchImpl; this.#apiKey = env[CREDENTIAL_ENV] || null;
  }
  // The model the server reports (`/v1/models`): recorded with every judgment so a ledger row names
  // the weights that produced it.
  async describe({ signal } = {}) {
    const res = await this.#request('GET', '/v1/models', undefined, signal);
    // Kev lists {models:[{name, run, temperature, ...}]}; OpenAI-style servers list {data:[{id}]}.
    const ids = [...(res?.models ?? []).map(m => m?.run ?? m?.name), ...(res?.data ?? []).map(m => m?.id ?? m?.root)].filter(Boolean);
    return { ids, raw: res };
  }
  async ask({ state, questions, signal }) {
    if (!questions || typeof questions !== 'object' || !Object.keys(questions).length) throw new FoundryError('JUDGMENT_INPUT', 'At least one question is required');
    return this.#request('POST', '/v1/systemone', { state, model: this.model, questions }, signal);
  }
  async #request(method, route, body, signal) {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const headers = { 'content-type': 'application/json', ...(this.#apiKey ? { authorization: `Bearer ${this.#apiKey}` } : {}) };
    let res;
    try {
      res = await this.#fetch(this.url + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch (error) {
      if (signal?.aborted) throw new FoundryError('CANCELLED', 'Judgment request cancelled');
      if (timeout.aborted) throw new FoundryError('MODEL_TIMEOUT', `System One request exceeded ${this.timeoutMs} ms`);
      throw new FoundryError('MODEL_UNAVAILABLE', `System One server unreachable: ${error?.cause?.code ?? error?.message ?? 'error'}`);
    }
    const text = await res.text();
    if (res.status === 401 || res.status === 403) throw new FoundryError('MODEL_AUTH', `System One server refused the credential (${res.status})`);
    if (res.status === 422) throw new FoundryError('MODEL_CONTEXT', `System One server refused the request: ${text.slice(0, 300)}`);
    if (res.status === 429) throw new FoundryError('MODEL_QUOTA', 'System One server rate-limited the request');
    if (res.status >= 500) throw new FoundryError('MODEL_UNAVAILABLE', `System One server error ${res.status}`);
    if (res.status !== 200) throw new FoundryError('MODEL_FAILED', `System One server returned ${res.status}: ${text.slice(0, 300)}`);
    try { return JSON.parse(text); } catch { throw new FoundryError('JUDGMENT_PROTOCOL', 'System One server returned non-JSON'); }
  }
}

// One judgment request as one System One `choice` question. Options become the criteria keys; the
// question and the port's criteria become the instructions. A two-option yes/no question could use
// `noul`, but `choice` keeps every port on one code path and one calibration shape.
export function toSystemOneQuestion({ question, criteria = [], options, optionDescriptions = {} }) {
  const instructions = criteria.length ? `${question}\nCriteria:\n${criteria.map(c => `- ${c}`).join('\n')}` : question;
  return { type: 'choice', instructions, criteria: Object.fromEntries(options.map(o => [o, optionDescriptions[o] ?? ''])) };
}

export function fromSystemOneAnswer(answer, options) {
  if (answer?.type !== 'choice' || !answer.probabilities || typeof answer.probabilities !== 'object') throw new FoundryError('JUDGMENT_PROTOCOL', 'System One answer is not a choice with probabilities');
  const raw = options.map(o => Number(answer.probabilities[o]));
  if (!raw.every(v => Number.isFinite(v) && v >= 0) || Object.keys(answer.probabilities).some(k => !options.includes(k))) throw new FoundryError('JUDGMENT_PROTOCOL', 'System One probabilities must cover exactly the offered options');
  const total = raw.reduce((a, b) => a + b, 0);
  if (!(total > 0)) throw new FoundryError('JUDGMENT_PROTOCOL', 'System One probabilities sum to zero');
  const probabilities = Object.fromEntries(options.map((o, i) => [o, raw[i] / total]));
  const chosen = options.reduce((best, o) => probabilities[o] > probabilities[best] ? o : best, options[0]);
  return { probabilities, chosen, confidence: probabilities[chosen] };
}

// ---- Calibration ledger -------------------------------------------------------------------------
// Append-only JSONL. A `judgment` row is written when the port answers; a `label` row when the truth
// arrives (oracle, replay, control build, human). Rows are joined by id; the latest label wins.
export class JudgmentLedger {
  constructor(file) {
    if (typeof file !== 'string' || !file) throw new FoundryError('PORT_CONFIG', 'JudgmentLedger needs a file path');
    this.file = file; mkdirSync(path.dirname(file), { recursive: true });
  }
  record({ port, engine, model = null, request, result, split = 'unspecified', meta = {} }) {
    const id = digest({ port, engine, model, request, at: process.hrtime.bigint().toString(), meta }).slice(0, 24);
    appendFileSync(this.file, JSON.stringify({ type: 'judgment', id, port, engine, model, split, requestHash: digest(request), options: request.options,
      probabilities: result.probabilities, chosen: result.chosen, confidence: result.confidence, latencyMs: result.latencyMs ?? null, meta }) + '\n');
    return id;
  }
  label(id, truth, { source = 'oracle' } = {}) {
    if (typeof truth !== 'string') throw new FoundryError('JUDGMENT_INPUT', 'A label is one of the offered options');
    appendFileSync(this.file, JSON.stringify({ type: 'label', id, truth, source }) + '\n');
  }
  rows() {
    if (!existsSync(this.file)) return [];
    const judgments = new Map(), labels = new Map();
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      if (row.type === 'judgment') judgments.set(row.id, row); else if (row.type === 'label') labels.set(row.id, row);
    }
    return [...judgments.values()].map(j => ({ ...j, truth: labels.get(j.id)?.truth ?? null, labelSource: labels.get(j.id)?.source ?? null }));
  }
}

// Per-port calibration numbers over labelled rows: accuracy, multi-class Brier score, expected
// calibration error (equal-width confidence bins), the reliability table, and the selective-risk
// curve. `errorBudget` picks the lowest confidence threshold whose accepted error rate stays within
// budget (chosen on the rows given, so pass calibration-split rows here and evaluate elsewhere).
export function calibrationReport(rows, { bins = 10, errorBudget = 0.05, thresholds } = {}) {
  const labelled = rows.filter(r => r.truth != null && r.options?.includes(r.truth));
  const n = labelled.length;
  if (!n) return { n: 0 };
  let correct = 0, brier = 0;
  const table = Array.from({ length: bins }, (_, i) => ({ lo: i / bins, hi: (i + 1) / bins, n: 0, confidence: 0, accuracy: 0 }));
  for (const r of labelled) {
    const hit = r.chosen === r.truth; correct += hit;
    brier += r.options.reduce((s, o) => s + ((r.probabilities[o] ?? 0) - (o === r.truth ? 1 : 0)) ** 2, 0);
    const b = table[Math.min(bins - 1, Math.floor(r.confidence * bins))];
    b.n++; b.confidence += r.confidence; b.accuracy += hit;
  }
  let ece = 0;
  for (const b of table) if (b.n) { b.confidence /= b.n; b.accuracy /= b.n; ece += (b.n / n) * Math.abs(b.accuracy - b.confidence); }
  const ts = thresholds ?? [...new Set(labelled.map(r => r.confidence))].sort((a, b) => a - b);
  const curve = ts.map(t => {
    const acc = labelled.filter(r => r.confidence >= t), wrong = acc.filter(r => r.chosen !== r.truth).length;
    const abstained = labelled.filter(r => r.confidence < t), wouldBeRight = abstained.filter(r => r.chosen === r.truth).length;
    return { threshold: t, coverage: acc.length / n, risk: acc.length ? wrong / acc.length : 0,
      falseAcceptRate: acc.length ? wrong / acc.length : 0, falseAbstainRate: abstained.length ? wouldBeRight / abstained.length : 0 };
  });
  const feasible = curve.filter(c => c.coverage > 0 && c.risk <= errorBudget);
  const pick = feasible.length ? feasible.reduce((a, b) => b.coverage > a.coverage ? b : a) : null;
  return { n, accuracy: correct / n, brier: brier / n, ece, reliability: table.filter(b => b.n), curve,
    errorBudget, threshold: pick?.threshold ?? null, coverageAtBudget: pick?.coverage ?? 0 };
}
