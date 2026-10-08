#!/usr/bin/env node
// Export one recorded Foundry run as "run-view" JSON for tools/run-view/index.html (a read-only run inspector).
//
//   node tools/run-view/export-run.mjs --workspace DIR [--run RUN_ID|latest] [--journal FILE] [--results FILE.jsonl]
//        [--out run.json] [--bundle run.html] [--hints view-hints.json] [--label TEXT] [--max-string 3000] [--max-prompt 40000] [--no-redact]
//   node tools/run-view/export-run.mjs --from-json run.json --bundle run.html     (re-bundle an export into one self-contained file)
//   node tools/run-view/export-run.mjs --db FILE.sqlite ...      (instead of --workspace DIR; DIR/.foundry/foundry.sqlite)
//
// Read-only: SQLite files are opened with { readOnly: true } and nothing is written but --out / --bundle (mode 0600).
// It reads the three durable records of a run and folds them into one document:
//   events    the hash-chained run events (src/store.mjs events table), chain re-verified here exactly as Store.events does
//   calls     the model-call journal rows (src/journal.mjs model_calls), joined by the journalId on model.called events:
//             the prompt, system prompt, schema, raw reply, typed value, usage, latency and cost of every call
//   workflow  the immutable workflow version the run was bound to (definition, descriptions, checks, model classes)
// plus optional external evidence (--results: an experiment results JSONL line whose meta.runId is this run).
//
// The page applies one reducer to these events, so replay and a live stream go through the same code.
// Honesty rules: strings are clipped (never silently: the clip count and a sha256 marker are recorded); a clip or a
// redaction is reported in `truncation` / `redaction`; derived events (model.dispatched, reconstructed from the
// journal latency) carry derived:true. The file contains prompts and corpus text: treat it like the workspace.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { canonical, digest } from '../../src/data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA = 'foundry-run-view/1';
const sha = text => createHash('sha256').update(text).digest('hex');

// ---------------------------------------------------------------------------------------------- redaction and clipping
const SECRET_PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/g, 'anthropic-key'], [/\bsk-[A-Za-z0-9]{32,}\b/g, 'api-key'], [/\bghp_[A-Za-z0-9]{30,}\b/g, 'github-token'],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}\b/g, 'github-token'], [/\bAKIA[0-9A-Z]{16}\b/g, 'aws-key-id'], [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, 'slack-token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, 'private-key'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g, 'bearer-token'], [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, 'jwt']
];
// Values of secret-looking environment variables are scrubbed by value; only the variable NAME is ever written.
function envSecrets() {
  const found = [];
  for (const [name, value] of Object.entries(process.env)) if (/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name) && typeof value === 'string' && value.length >= 12) found.push([name, value]);
  return found;
}
export function makeScrubber({ redact = true, maxString = 3000 } = {}) {
  const env = redact ? envSecrets() : [];
  const stats = { clippedStrings: 0, clippedChars: 0, redactions: 0, redactionKinds: {} };
  const scrub = (text, max = maxString) => {
    let out = text;
    if (redact) {
      for (const [pattern, kind] of SECRET_PATTERNS) out = out.replace(pattern, () => { stats.redactions++; stats.redactionKinds[kind] = (stats.redactionKinds[kind] ?? 0) + 1; return `[REDACTED:${kind}]`; });
      for (const [name, value] of env) if (out.includes(value)) { out = out.split(value).join(`[REDACTED:env:${name}]`); stats.redactions++; stats.redactionKinds.env = (stats.redactionKinds.env ?? 0) + 1; }
    }
    if (out.length > max) {
      stats.clippedStrings++; stats.clippedChars += out.length - max;
      out = `${out.slice(0, max)}\n…[clipped ${out.length - max} more characters; sha256 of the full text ${sha(text).slice(0, 16)}]`;
    }
    return out;
  };
  const walk = (value, max = maxString) => {
    if (typeof value === 'string') return scrub(value, max);
    if (Array.isArray(value)) return value.map(v => walk(v, max));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, max)]));
    return value;
  };
  return { scrub, walk, stats, redact };
}

// ------------------------------------------------------------------------------------------------------- database reads
const openReadOnly = file => new DatabaseSync(file, { readOnly: true });
const hasTable = (db, name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

// Same verification as Store.events(), without opening the store (which would create tables and chmod).
export function verifyChain(db, run) {
  let previous = null, count = 0;
  const events = [];
  for (const row of db.prepare('SELECT body,hash FROM events WHERE run_id=? ORDER BY seq').all(run.id)) {
    const event = JSON.parse(row.body);
    if (event.seq !== count + 1 || event.previousHash !== previous || digest(event) !== row.hash) return { ok: false, events, reason: `chain breaks at seq ${count + 1}` };
    previous = row.hash; count++; events.push({ ...event, hash: row.hash });
  }
  const head = run.eventHead;
  if (!head || head.seq !== count || head.hash !== previous) return { ok: false, events, reason: 'checkpoint head does not match the event chain' };
  return { ok: true, events, head: previous, count };
}

function journalRows(db, runId) {
  if (!db || !hasTable(db, 'model_calls')) return [];
  return db.prepare('SELECT * FROM model_calls WHERE run_id=? ORDER BY id').all(runId);
}
const parseJson = text => { try { return text == null ? null : JSON.parse(text); } catch { return null; } };

// The prompt is bound to the chain: the context.compiled event (chain-hashed) carries receipt.promptHash, and a journal row names its receipt. The reply is not
// bound (the model.called event carries no response hash), so only the prompt can be checked. `expectedPromptHash` is null when no compiled event matches.
export function promptCheck(request, expectedPromptHash) {
  if (!expectedPromptHash || typeof request?.prompt !== 'string') return null;
  return digest({ system: request.system, prompt: request.prompt, schema: request.schema }) === expectedPromptHash;
}
export function callOf(row, scrubber, maxPrompt = 40000, expectedPromptHash = null) {
  const request = parseJson(row.request) ?? {}, response = parseJson(row.response) ?? {};
  const { scrub, walk } = scrubber;
  return {
    id: row.id, promptVerified: promptCheck(request, expectedPromptHash), nodeKey: row.node_key, attempt: row.attempt, sampleIndex: row.sample_index, modelId: row.model_id, provider: row.provider,
    engineVersion: row.engine_version, decoding: parseJson(row.decoding), receiptHash: row.receipt_hash, promptHash: row.prompt_hash, ok: row.ok === 1, errorCode: row.error_code,
    inputTokens: row.input_tokens, outputTokens: row.output_tokens, cacheReadTokens: row.cache_read_tokens ?? null, cacheWriteTokens: row.cache_write_tokens ?? null,
    costUsd: row.cost_usd, imputedUsd: row.imputed_usd, latencyMs: row.latency_ms, createdAt: row.created_at, mode: request.mode ?? null,
    // providerRequest (CLI flags, paths) and salt are not needed to read the conversation and are left out on purpose.
    system: typeof request.system === 'string' ? scrub(request.system, maxPrompt) : null,
    prompt: typeof request.prompt === 'string' ? scrub(request.prompt, maxPrompt) : null,
    schema: request.schema === undefined ? null : walk(request.schema, 2000),
    reply: typeof response.text === 'string' ? scrub(response.text, maxPrompt) : null,
    value: response.value === undefined ? null : walk(response.value, 2000),
    finishReason: response.finishReason ?? null, usage: response.usage ?? null,
    served: response.meta?.servedModels ?? null, costBasis: response.meta?.costBasis ?? null, costUnknown: response.costUnknown === true,
    error: response.error ? walk(response.error, 1000) : null
  };
}

// ------------------------------------------------------------------------------------------------------------- the fold
const OUTPUT_INLINE_BYTES = 2000;
// One chain event in the form the page receives: the chain hashes dropped (a 16-hex marker kept), a large output left out (fetched on demand).
export function slimEvent(event, scrubber) {
  const { previousHash, hash, output, ...rest } = event;
  const slim = { ...rest, h: hash.slice(0, 16) };
  let full;
  if (output !== undefined) {
    const bytes = Buffer.byteLength(canonical(output));
    slim.outputBytes = bytes;
    if (bytes <= OUTPUT_INLINE_BYTES) slim.output = scrubber.walk(output, 600); else full = scrubber.walk(output, 3000);
  }
  return { slim: scrubber.walk(slim, 1500), full };
}
export function runHeader(run, workflow, { executionActive } = {}) {
  const { policy, owner } = run;
  return {
    id: run.id, status: run.status, workflowId: run.workflowId, workflowHash: run.workflowHash, createdAt: run.createdAt, updatedAt: run.updatedAt, deadline: run.deadline,
    steps: run.steps, cost: run.cost, modelMode: run.modelMode ?? null, assignment: run.assignment ?? {}, resumeCount: run.resumeCount ?? 0, error: run.error ?? null,
    verdict: run.verdict ?? null, engineHash: run.engineHash?.slice(0, 16) ?? null, eventHead: run.eventHead ? { seq: run.eventHead.seq, hash: run.eventHead.hash.slice(0, 16) } : null,
    budget: { maxCost: Math.min(policy?.maxCost ?? Infinity, workflow.budget?.maxCost ?? Infinity), maxSteps: Math.min(policy?.maxSteps ?? Infinity, workflow.budget?.maxSteps ?? Infinity), maxConcurrency: Math.min(policy?.maxConcurrency ?? Infinity, workflow.budget?.maxConcurrency ?? Infinity) },
    independentTaskVerified: false, executionActive: executionActive ?? !!owner
  };
}
export function decisionsOf(db, runId, scrubber) {
  return db.prepare('SELECT body FROM decisions WHERE run_id=? ORDER BY rowid').all(runId).map(r => scrubber.walk(parseJson(r.body), 800))
    .map(d => ({ id: d.id, kind: d.kind, at: d.at, rationale: d.rationale, action: d.action, costUsd: d.costUsd, features: d.features }));
}
export function foldRun({ db, journalDb = null, run, workflow, results = [], source = {}, scrubber, maxPrompt = 40000 }) {
  const chain = verifyChain(db, run);
  if (!chain.ok) throw new Error(`Refusing to export: ${chain.reason}`);
  const rows = [...journalRows(journalDb ?? db, run.id)];
  const promptHashOfReceipt = new Map(chain.events.filter(e => e.type === 'context.compiled' && e.receiptHash).map(e => [e.receiptHash, e.receipt?.promptHash]));
  const calls = {};
  for (const row of rows) calls[row.id] = callOf(row, scrubber, maxPrompt, promptHashOfReceipt.get(row.receipt_hash) ?? null);

  const outputs = {}, events = [];
  const compiledAt = new Map();                           // nodeKey -> last context.compiled {at, seq}
  const derived = [];
  for (const event of chain.events) {
    const { slim, full } = slimEvent(event, scrubber);
    if (full !== undefined) outputs[event.seq] = full;
    events.push(slim);
    if (event.type === 'context.compiled') compiledAt.set(event.nodeKey, { at: event.at, seq: event.seq });
    if (event.type === 'model.called' && event.journalId != null && Number.isFinite(event.latencyMs)) {
      const start = compiledAt.get(event.nodeKey);
      const at = Math.max(start?.at ?? event.at - event.latencyMs, event.at - event.latencyMs);
      // Reconstructed from the journal latency: the runtime emits no event when a model call leaves the concurrency queue.
      derived.push({ seq: event.seq - 0.5, at, type: 'model.dispatched', nodeKey: event.nodeKey, modelId: event.modelId, derived: true, derivedFrom: 'model.called.latencyMs', journalId: event.journalId, latencyMs: event.latencyMs });
    }
  }
  const timeline = [...events, ...derived].sort((a, b) => a.at - b.at || a.seq - b.seq);

  const decisions = decisionsOf(db, run.id, scrubber);

  const referenced = new Set(events.filter(e => e.journalId != null).map(e => e.journalId));
  const orphans = Object.keys(calls).filter(id => !referenced.has(Number(id))).length;
  const clipWorkflow = scrubber.walk(workflow, 2500);
  return {
    schema: SCHEMA, exportedAt: new Date().toISOString(), source,
    run: runHeader(run, workflow),
    workflow: clipWorkflow, events: timeline, outputs, calls, decisions, external: results,
    integrity: { chainVerified: true, verifiedAt: 'export', events: chain.count, head: chain.head.slice(0, 16), journalRows: rows.length, journalOrphans: orphans, derivedEvents: derived.length,
      promptsVerified: Object.values(calls).filter(c => c.promptVerified === true).length, promptsMismatched: Object.values(calls).filter(c => c.promptVerified === false).length, promptsUnchecked: Object.values(calls).filter(c => c.promptVerified === null).length },
    truncation: { maxPrompt, clippedStrings: scrubber.stats.clippedStrings, clippedChars: scrubber.stats.clippedChars },
    redaction: { enabled: scrubber.redact, redactions: scrubber.stats.redactions, kinds: scrubber.stats.redactionKinds },
    notice: 'Contains prompts, model replies and corpus text. Treat like the workspace it came from.'
  };
}

// External evidence (not part of the run): experiment result lines whose meta.runId names this run.
export function readResults(file, runId) {
  if (!file || !existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes(runId)) continue;
    let record; try { record = JSON.parse(line); } catch { continue; }
    if (record?.meta?.runId !== runId) continue;
    let oracle = parseJson(record.oracleDetails) ?? {};
    const pick = ['entities', 'predicted', 'matched', 'extra', 'missing', 'slack', 'pairF1', 'precision', 'recall', 'fieldAccuracy', 'thresholds'];
    out.push({
      kind: 'task-oracle', source: path.basename(file), experiment: record.experiment ?? null, arm: record.arm ?? null, taskKey: record.taskKey ?? record.task ?? null, trial: record.trial ?? null,
      pass: record.pass === true, score: record.score ?? null, costUsd: record.costUsd ?? null, at: record.at ?? null,
      split: /:dev:/.test(record.taskKey ?? '') ? 'development' : /:sealed:|:test:/.test(record.taskKey ?? '') ? 'sealed' : 'unknown',
      details: Object.fromEntries(pick.filter(k => oracle[k] !== undefined).map(k => [k, oracle[k]]))
    });
  }
  return out;
}

// Authored view hints: a sidecar of labels and groups. They only change how nodes are named and folded on screen; they are not part of the
// workflow hash and carry no authority. Shape is checked here and again by the page (which treats them as untrusted text).
export function readHints(file) {
  const raw = JSON.parse(readFileSync(file, 'utf8')), hints = {};
  if (raw.labels !== undefined) {
    if (!raw.labels || typeof raw.labels !== 'object' || Array.isArray(raw.labels) || !Object.values(raw.labels).every(v => typeof v === 'string' && v.length <= 60)) throw new Error('hints.labels must map node ids to strings of at most 60 characters');
    hints.labels = raw.labels;
  }
  if (raw.groups !== undefined) {
    if (!Array.isArray(raw.groups) || !raw.groups.every(g => g && typeof g.label === 'string' && g.label.length <= 60 && Array.isArray(g.members) && g.members.every(m => typeof m === 'string'))) throw new Error('hints.groups must be [{label, members: [nodeId]}]');
    hints.groups = raw.groups.map(g => ({ label: g.label, members: g.members }));
  }
  return hints;
}

// ------------------------------------------------------------------------------------------------------ bundle (one file)
export function bundleHtml(data, dir = here) {
  const html = readFileSync(path.join(dir, 'index.html'), 'utf8'), css = readFileSync(path.join(dir, 'run-view.css'), 'utf8'), js = readFileSync(path.join(dir, 'run-view.js'), 'utf8');
  // JSON in a data block: `<` is escaped so the data can never close the block or open a comment; U+2028/9 for old parsers.
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const csp = `default-src 'none'; script-src 'sha256-${createHash('sha256').update(js).digest('base64')}'; style-src 'sha256-${createHash('sha256').update(css).digest('base64')}'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'`;
  // Replacer functions, not replacement strings: the script text contains `$&`-style sequences that String.replace would expand.
  return html
    .replace('<!--CSP-->', () => `<meta http-equiv="Content-Security-Policy" content="${csp}">`)
    .replace('<link rel="stylesheet" href="run-view.css">', () => `<style>${css}</style>`)
    .replace('<script src="run-view.js"></script>', () => `<script id="run-data" type="application/json">${json}</script>\n<script>${js}</script>`);
}

// ---------------------------------------------------------------------------------------------------------------- CLI
function main() {
  const { values: a } = parseArgs({ options: {
    workspace: { type: 'string' }, db: { type: 'string' }, run: { type: 'string', default: 'latest' }, journal: { type: 'string' }, results: { type: 'string' },
    out: { type: 'string' }, bundle: { type: 'string' }, hints: { type: 'string' }, label: { type: 'string' }, 'from-json': { type: 'string' }, 'max-string': { type: 'string', default: '3000' }, 'max-prompt': { type: 'string', default: '40000' }, 'no-redact': { type: 'boolean', default: false }
  } });
  if (a['from-json']) {                       // re-bundle an existing export into one self-contained html file (no database needed)
    if (!a.bundle) { console.error('--from-json needs --bundle OUT.html'); process.exit(2); }
    const data = JSON.parse(readFileSync(a['from-json'], 'utf8'));
    if (data.schema !== SCHEMA) { console.error(`Not a ${SCHEMA} file`); process.exit(2); }
    writeFileSync(a.bundle, bundleHtml(data), { mode: 0o600 }); chmodSync(a.bundle, 0o600);
    console.log(JSON.stringify({ bundle: a.bundle, bytes: readFileSync(a.bundle).length })); return;
  }
  const dbFile = a.db ?? (a.workspace ? path.join(a.workspace, '.foundry', 'foundry.sqlite') : null);
  if (!dbFile || !existsSync(dbFile)) { console.error('Need --workspace DIR (containing .foundry/foundry.sqlite) or --db FILE'); process.exit(2); }
  if (!a.out && !a.bundle) { console.error('Need --out FILE.json and/or --bundle FILE.html'); process.exit(2); }
  const db = openReadOnly(dbFile);
  const journalDb = a.journal ? openReadOnly(a.journal) : null;
  // One read transaction for the run header AND the event chain: a run that is still being written would otherwise show an event head newer than the header
  // and be refused with "checkpoint head does not match" (found by reading; tests/adapter.test.mjs reproduces the race at the adapter level).
  db.exec('BEGIN');
  const row = a.run === 'latest' ? db.prepare('SELECT body FROM runs ORDER BY rowid DESC LIMIT 1').get() : db.prepare('SELECT body FROM runs WHERE id=?').get(a.run);
  if (!row) { console.error(`No such run: ${a.run}`); process.exit(2); }
  const run = JSON.parse(row.body);
  const wfRow = db.prepare('SELECT body FROM workflows WHERE hash=?').get(run.workflowHash);
  if (!wfRow) { console.error('The immutable workflow version is missing from this store'); process.exit(2); }
  const workflow = JSON.parse(wfRow.body);
  if (digest(workflow) !== run.workflowHash) { console.error('Stored workflow does not match its hash; refusing to export'); process.exit(2); }
  const scrubber = makeScrubber({ redact: !a['no-redact'], maxString: Number(a['max-string']) });
  const results = readResults(a.results, run.id);
  const label = a.label ?? (results[0] ? [results[0].experiment, results[0].arm, results[0].taskKey].filter(Boolean).join(' · ') : null);
  const data = foldRun({ db, journalDb, run, workflow, scrubber, maxPrompt: Number(a['max-prompt']),
    results, source: { ...(label ? { label } : {}), workspace: path.basename(path.resolve(a.workspace ?? path.dirname(path.dirname(dbFile)))), journal: a.journal ? path.basename(a.journal) : 'workspace', exporter: 'tools/run-view/export-run.mjs' } });
  db.exec('COMMIT');
  if (a.hints) data.viewHints = readHints(a.hints);
  if (a.out) { writeFileSync(a.out, JSON.stringify(data), { mode: 0o600 }); chmodSync(a.out, 0o600); }
  if (a.bundle) { writeFileSync(a.bundle, bundleHtml(data), { mode: 0o600 }); chmodSync(a.bundle, 0o600); }
  const bytes = a.out ? readFileSync(a.out).length : readFileSync(a.bundle).length;
  console.log(JSON.stringify({ run: run.id, status: run.status, events: data.events.length, calls: Object.keys(data.calls).length, derivedEvents: data.integrity.derivedEvents, external: data.external.length,
    truncation: data.truncation, redaction: data.redaction, bytes, out: a.out ?? null, bundle: a.bundle ?? null }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
