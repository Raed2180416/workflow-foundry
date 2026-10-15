// Arm "A0+SR" of the AutomationBench dev work ("second reader", harness version sr-v1): A0 unchanged, then one
// clean-context reader call and at most one repair session. Run with `node experiments/autobench/run.mjs --harness
// secondreader ...`. Source: research/architecture-20261015/FABLE-WHAT-WE-MISS.md I-1(c), the cheapest test of
// "independence is the mechanism": the session that acted never judges its own work; a context that did not act does.
//
// Per task, in order:
//   0. PRE-READ   code, no model: the A1-C enumeration (inventory.mjs buildInventory) through the bridge mailbox the session
//                 later uses, <= preSteps world steps. Its mailbox files are removed before the session starts, so the
//                 session's working directory holds what A0's holds (only empty request-claim markers remain in .tools/).
//   1. ACT        the A0 session: the official system prompt + A0's tool section (with the AM-9 note when on), the official
//                 user message, A0's budget and tools, no step guard. Identical to A0's runner call except the wall
//                 timeout (it keeps a reserve for the steps after it) and the task label (the executor ignores it).
//   2. POST-READ  code: the same enumeration over the connected apps (no look-ups), <= postSteps world steps. Code builds
//                 the diff between the two reads (new, changed, removed records), masks clock values written during the
//                 run (shown as <now>: the host clock is not the task's), lists the session's own write calls with the
//                 world's answers (read from the mailbox, links refused) and the connected apps holding records that the
//                 session never called.
//   3. READ       one clean-context model call (no tools, --max-turns 1). It sees the official request, the pre-read
//                 records, the diff, the write log and the never-called apps; never the transcript, the final reply, a
//                 grade, an assertion or anything host-side. It returns typed JSON: apps_checked and unmet items, each with
//                 a quote. Code keeps an item only if the quote is found in the request or in a record that existed before
//                 the work (a requirement must come from a source the worker did not write). An empty list that does not
//                 name every connected app holding records is recorded as uncovered.
//   4. REPAIR     at most one session, only when an item survives and a session still fits the responses (the sum over
//                 every model call stays <= max-steps), world steps, money and time: A0's system prompt + a review section
//                 (the items with their quotes, what already changed, do not redo), the official user message, REVIEW.md
//                 and RECORDS.md in the working directory, a CLI step guard at the remaining responses.
// Every model call counts toward the 50 responses and every world step (code or session) toward the bridge's 49; the
// per-task audit is A1-C's (codeowned.mjs auditPipeline). An environment fault in any node stops the pipeline and is the
// task's session error (the runner treats the task as not run). Nothing here reads the task's name, the prepared task
// files, the initial-world dump, assertions, grades or host directories.
import { closeSync, constants as fsc, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_KEEP_RO } from '../../../src/executors/claude-code.mjs';
import { CHILD_ENV_ALLOWED } from '../../../src/models/policy.mjs';
import { DATE_NOTE, REPO, adapterText, sha256 } from '../lib.mjs';
import { MUTATING, auditSession, readStream } from '../accounting.mjs';
import { ENV_FAULTS } from '../../lib/runner.mjs';
import { corpusPin, localImports, writeCliGuard } from './foundry.mjs';
import { auditPipeline } from './codeowned.mjs';
import { bridgeClient } from './bridge-client.mjs';
import { ENUM_PLAN, buildInventory, compactRecord, renderInventory } from './inventory.mjs';
import { copyLiteral, parseJsonReply, sourceMap } from './ledger.mjs';
import { rereadWorld, worldDiff } from './postconditions.mjs';

export const HARNESS_ID = 'secondreader';
export const HARNESS_VERSION = 'sr-v1';
export const ARM = 'A0+SR (A0 + second reader)';
export const ROLES = Object.freeze(['act', 'reader', 'repair']);
export const PIPELINE_DEFAULTS = Object.freeze({ preSteps: 6, postSteps: 4, repairMinSteps: 2, minRepairResponses: 3, maxItems: 8, readerBudgetShare: 0.1,
  readerInventoryChars: 60_000, changesChars: 15_000, writesChars: 10_000, repairChangesChars: 8_000, systemMaxBytes: 90_000, actReserveMs: 5 * 60_000,
  nodeTimeoutMs: 240_000, minRepairMs: 90_000, minRepairUsd: 0.01 });
export const REVIEW_BEGIN = '## Review (begin)';
export const REVIEW_END = '## Review (end)';
export const FILES = Object.freeze({ review: 'REVIEW.md', records: 'RECORDS.md' });

/** H8: every knowledge source compiled into A0+SR. Update with every harness version. */
export const KNOWLEDGE = Object.freeze([
  'architect-written pipeline (claude-opus-5-5, build time) from research/architecture-20261015/FABLE-WHAT-WE-MISS.md I-1(c) (the second reader): a clean-context reader that sees the request, the records and the world diff, never the acting transcript; no task content',
  'the A1-C enumeration plan (inventory.mjs ENUM_PLAN), reused for the pre-read and the post-read: list endpoints and child relations derived from the API schemas shipped with the environment (the index api_search searches)',
  'the official system prompt and the api tool catalog, as every A0 session receives them (no task-specific content)',
]);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.resolve(HERE, '../run.mjs');

// ---------------------------------------------------------------------------------------------------------------
// Manifest and configuration (the same shape as A1-C's, so run.mjs pins and records it the same way)

export function manifestFiles() {
  const extra = ['experiments/autobench/bridge.py', 'experiments/autobench/tool.mjs'].map(p => path.join(REPO, p));
  return [...new Set([...localImports(RUNNER), ...localImports(fileURLToPath(import.meta.url)), ...extra])].map(f => path.relative(REPO, f)).sort();
}
/** The model per node role: --model for every role unless --node-models role=id,... overrides one. */
export function nodeModels(model, overrides = {}) {
  const out = Object.fromEntries(ROLES.map(r => [r, model ?? null]));
  for (const [k, v] of Object.entries(overrides ?? {})) { if (!ROLES.includes(k)) throw new Error(`unknown node role ${k} (one of ${ROLES.join(', ')})`); out[k] = v; }
  return out;
}
function policyFor(models, file = path.join(REPO, 'policy/models.json')) {
  const p = JSON.parse(readFileSync(file, 'utf8'));
  return { provider: p.providers?.['claude-cli'] ?? null, models: Object.fromEntries([...new Set(Object.values(models).filter(Boolean))].sort().map(id => [id, (p.models ?? []).find(m => m.id === id) ?? null])) };
}
export function pipelineConfig(o) {
  const models = nodeModels(o.model, o.nodeModels);
  return { harness: HARNESS_ID, version: HARNESS_VERSION, model: o.model ?? null, nodeModels: models, effort: o.effort ?? null, budgetUsd: o.budgetUsd, timeoutMin: o.timeoutMin,
    maxSteps: o.maxSteps, tools: o.tools, det: o.det, k: o.k, concurrency: o.concurrency, dateNote: Boolean(o.dateNote), pipeline: { ...PIPELINE_DEFAULTS, ...(o.pipeline ?? {}) },
    executor: 'src/executors/claude-code.mjs runClaudeCode, DEFAULT_HIDDEN, DEFAULT_KEEP_RO; the act session as A0 (no guard); reader with no tools and --max-turns 1; repair with a step guard', cli: o.cli ?? null,
    childEnv: o.childEnv ?? Object.fromEntries(CHILD_ENV_ALLOWED.map(k => [k, typeof process.env[k] === 'string' ? process.env[k] : null])),
    policy: o.policy ?? policyFor(models), corpus: o.corpus ?? corpusPin(), knowledge: o.knowledge ?? [...KNOWLEDGE] };
}
const canon = v => JSON.stringify(sortKeys(v));
function sortKeys(v) { if (Array.isArray(v)) return v.map(sortKeys); if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])); return v; }
export function pipelineManifest(config) {
  const files = manifestFiles().map(p => ({ path: p, sha256: sha256(readFileSync(path.join(REPO, p))) }));
  return { files, config, sha256: sha256(canon({ files, config })) };
}

/** A0's system prompt, byte for byte (the act session's): official system prompt + A0's tool section. `brief` is ignored
 * (run.mjs's dry run passes one to every pipeline harness). */
export function actSystemPrompt(officialSystem, catalog, maxSteps, { dateNote = false } = {}) {
  if (typeof officialSystem !== 'string' || !officialSystem) throw new Error('the official system prompt is required');
  return `${officialSystem}\n\n${adapterText(catalog, maxSteps, { dateNote })}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The mailbox, read host-side after a session (agent-writable: links and odd files are refused, as bridge.py does)

const MAX_MAILBOX_FILE = 4 * 1024 * 1024;
/** Read one regular, single-link file of the mailbox without following links; null otherwise. */
export function readMailboxFile(file) {
  let fd;
  try { fd = openSync(file, fsc.O_RDONLY | fsc.O_NOFOLLOW | fsc.O_NONBLOCK); } catch { return null; }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size > MAX_MAILBOX_FILE) return null;
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) { const n = readSync(fd, buf, off, st.size - off, off); if (!n) break; off += n; }
    return buf.subarray(0, off).toString('utf8');
  } catch { return null; } finally { closeSync(fd); }
}
const jsonOrNull = s => { try { return JSON.parse(s); } catch { return null; } };

/** Remove the request and answer files of code-issued steps (their claim markers stay, so the next client claims the next
 * number and the bridge, which remembers what it served, never re-serves them). Returns the answers removed with results. */
export function hideCodeSteps(mailbox, reqs) {
  let served = 0;
  for (const n of reqs) {
    const res = path.join(mailbox, `res-${n}.json`);
    const j = jsonOrNull(readMailboxFile(res) ?? '');
    if (j?.results) served += 1;
    for (const f of [`req-${n}.json`, `res-${n}.json`]) { try { if (lstatSync(path.join(mailbox, f)).isFile()) rmSync(path.join(mailbox, f)); } catch { /* absent */ } }
  }
  return served;
}

/** URL -> app key (as the world names apps), from the enumeration plan's own URLs: googleapis.com by its first path segment,
 * other hosts by their last two labels. Ambiguous keys (graph.facebook.com) map to every app that uses them. */
const appKey = url => {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (host.endsWith('googleapis.com')) {
    if (host === 'www.googleapis.com') return `googleapis/${u.pathname.split('/').filter(Boolean)[0] ?? ''}`;
    return host;
  }
  return host.split('.').slice(-2).join('.');
};
const APP_KEYS = (() => {
  const m = new Map();
  const add = (k, app) => { if (!k) return; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(app); };
  for (const p of ENUM_PLAN) for (const c of p.l0) { try { add(appKey(JSON.parse(c.call.arguments).url), p.app); } catch { /* none */ } }
  add('sheets.googleapis.com', 'google_sheets');
  return m;
})();
export const appsOfUrl = url => [...(APP_KEYS.get(appKey(url)) ?? [])];

/**
 * The session's own calls, from the mailbox (requests not issued by code): every api_fetch with its method, URL, a short
 * body and the world's answer; the apps it called. -> { calls, writes: [{n, method, url, body, status, answer}], apps: [..] }
 */
export function sessionCalls(mailbox, { skip = new Set() } = {}) {
  const out = { steps: 0, calls: 0, writes: [], apps: new Set(), refused: 0 };
  let names = [];
  try { names = readdirSync(mailbox); } catch { return { ...out, apps: [] }; }
  const reqs = names.map(f => /^req-(\d+)\.json$/.exec(f)).filter(Boolean).map(m => Number(m[1])).filter(n => !skip.has(n)).sort((a, b) => a - b);
  for (const n of reqs) {
    const req = jsonOrNull(readMailboxFile(path.join(mailbox, `req-${n}.json`)) ?? '');
    const res = jsonOrNull(readMailboxFile(path.join(mailbox, `res-${n}.json`)) ?? '');
    if (!req || !Array.isArray(req.calls)) continue;
    if (!res?.results) { out.refused += 1; continue; }
    out.steps += 1;
    req.calls.forEach((c, i) => {
      out.calls += 1;
      if (c?.name !== 'api_fetch') return;
      const a = jsonOrNull(typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments ?? {}));
      if (!a || typeof a !== 'object') return;
      for (const app of appsOfUrl(a.url)) out.apps.add(app);
      const method = String(a.method ?? 'GET').toUpperCase();
      const body = typeof a.body === 'string' ? a.body : a.body ? JSON.stringify(a.body) : '';
      // GraphQL reads use POST: a body that is a query and no mutation is a read.
      if (!MUTATING.includes(method) || (/"query"\s*:/.test(body) && !/\bmutation\b/.test(body))) return;
      const answer = String(res.results[i]?.content ?? '');
      const j = jsonOrNull(answer);
      const status = j && typeof j === 'object' && !Array.isArray(j) && j.error ? (Number(j.error?.code) || 'error') : 'ok';
      out.writes.push({ n, method, url: String(a.url ?? ''), body: decodeBody(body).slice(0, 700), status, answer: answer.replace(/\s+/g, ' ').slice(0, 300) });
    });
  }
  return { ...out, apps: [...out.apps].sort() };
}
/** Gmail's base64url "raw" bodies decoded for reading (the reader sees the message text, not its encoding). */
function decodeBody(body) {
  const j = jsonOrNull(body);
  if (j && typeof j === 'object' && typeof j.raw === 'string') {
    try { return JSON.stringify({ ...j, raw: Buffer.from(j.raw, 'base64url').toString('utf8') }); } catch { return body; }
  }
  return body;
}

// ---------------------------------------------------------------------------------------------------------------
// The diff between the two reads, masked

const ISO = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
/** Replace clock values written during the run (ISO strings, epoch s/ms/us as numbers or digit strings within [lo, hi]
 * epoch seconds) by '<now>'. Dates alone are masked only when they equal a day of the window. */
export function maskClock(v, lo, hi) {
  const days = new Set([new Date(lo * 1000).toISOString().slice(0, 10), new Date(hi * 1000).toISOString().slice(0, 10)]);
  const inWin = x => [1, 1e3, 1e6].some(s => x / s >= lo && x / s <= hi);
  const walk = x => {
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)]));
    if (typeof x === 'number' && Number.isFinite(x)) return inWin(x) ? '<now>' : x;
    if (typeof x === 'string') {
      const s = x.trim();
      if (/^\d{9,17}(\.\d+)?$/.test(s)) return inWin(Number(s)) ? '<now>' : x;
      if (ISO.test(s)) {
        if (s.length === 10) return days.has(s) ? '<now>' : x;
        const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
        return Number.isFinite(t) && t / 1000 >= lo && t / 1000 <= hi ? '<now>' : x;
      }
    }
    return x;
  };
  return walk(v);
}
/** Leaf paths that differ between two records: [[path, before, after]]. */
function leafChanges(a, b, p = '', out = []) {
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])]) leafChanges(a[k], b[k], p ? `${p}.${k}` : k, out);
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push([p || '(value)', a, b]);
  return out;
}
const short = (v, n = 300) => { const s = typeof v === 'string' ? v : JSON.stringify(v ?? null); return s.length > n ? `${s.slice(0, n)}…` : s; };

/**
 * The world diff between the pre-read and the post-read, as text and counts. Removals are reported only for apps whose
 * listings were complete in both reads (a record beyond a cap, or found by a look-up, is not "removed").
 */
export function diffReads(before, after, { lo, hi, maxChars = 15_000 } = {}) {
  const apps = [...new Set(after.records.map(r => r.app).concat(Object.keys(after.apps ?? {}).filter(a => after.apps[a].status === 'connected')))];
  const d = worldDiff(before, after, apps);
  const truncated = new Set([...(before.truncated ?? []), ...(after.truncated ?? [])].map(t => t.split(':')[0]));
  const sheetsAfter = new Set(after.records.filter(r => r.app === 'google_sheets').map(r => r.data?.spreadsheetId).filter(Boolean));
  const removed = d.removed.filter(r => !truncated.has(r.app) && (r.app !== 'google_sheets' || sheetsAfter.has(r.data?.spreadsheetId)));
  const lines = [
    ...d.added.map(r => `+ [${r.ptr}] ${compactRecord(maskClock(r.data, lo, hi), 2500)}`),
    ...d.changed.map(c => `~ [${c.after.ptr}] ${leafChanges(c.before.data, maskClock(c.after.data, lo, hi)).filter(([, x, y]) => JSON.stringify(x) !== JSON.stringify(y)).slice(0, 20).map(([k, x, y]) => `${k}: ${short(x, 200)} -> ${short(y, 400)}`).join('; ')}`),
    ...removed.map(r => `- [${r.ptr}] removed (was ${compactRecord(r.data, 300)})`),
  ];
  let text = lines.join('\n');
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n…(more changes cut for size)`;
  return { text, added: d.added.length, changed: d.changed.length, removed: removed.length, apps };
}

// ---------------------------------------------------------------------------------------------------------------
// The reader (clean context) and its validation

export const READER_SYSTEM = `You review finished work on a company's software systems for a requester, independently of the worker who did it. You see the request, the records as they were before the work, and what changed. You cannot call tools. Reply with one JSON object only.`;
export function readerPrompt({ request, recordsText, changesText, writes, neverCalled, postRead, dateNote = null }) {
  return `A worker carried out the request below on the company's systems and stopped. Decide what the request still needs.

<request>
${request}
</request>

<records_before_the_work>
${recordsText}
</records_before_the_work>

<changes>
${postRead ? 'Every record that is new, changed or gone after the work (a second read of the systems by code). Values marked <now> are clock readings taken while the work ran; they are not the task\'s dates.' : 'The systems could not be re-read after the work (no steps left): use the write calls below.'}
${changesText || '(no new, changed or removed record)'}
</changes>

<write_calls>
The worker's write calls, in order, with the system's answer.
${writes || '(none)'}
</write_calls>

<connected_apps_never_called>
${neverCalled.length ? neverCalled.join(', ') : '(none)'}
</connected_apps_never_called>
${dateNote ? `\n${dateNote}\n` : ''}
List every requirement of the request that the changes do not show as done, or show done wrongly. A requirement is something the request asks for, including what the request makes part of it by pointing to a record (a policy, a rule, a list, a sheet, a thread): read those records. Only effects the systems can show count (messages, posts, records, rows, field values); the worker's final reply does not.
- For each item, copy the exact words (at most 200 characters) of the request or of one record that make it a requirement, and give that record's pointer as source (or "request").
- Do not list anything the request does not ask for. Something not requested is not a requirement, and nothing here is forbidden unless a record says so.
- Do not list work that the changes or write calls show as done.
- If nothing is missing, return an empty list and name in apps_checked every connected app that holds records.

Reply with JSON only: {"apps_checked": ["<app>", ...], "unmet": [{"requirement": "<what is still needed, one sentence>", "quote": "<exact words from the request or a record>", "source": "request" | "<record pointer>", "status": "missing" | "wrong", "evidence": "<what the changes show or lack, with pointers>", "fix": "<the effect still needed: system, target, exact values copied from the records>"}]}`;
}

const str = v => (v === null || v === undefined ? '' : String(v));
const appMatch = (checked, app) => {
  const a = app.toLowerCase(), alt = a.replace(/^google_/, '').replace(/_/g, ' ');
  return checked.some(c => { const x = c.toLowerCase().trim(); return x === a || x === alt || x.replace(/[\s-]/g, '_') === a || x.includes(alt); });
};
/**
 * Validate the reader's reply: keep an item only if its quote is found (copyLiteral: case, whitespace and typographic quotes
 * folded) in the request or a record read BEFORE the work; cap the list. -> { parsed, items, dropped, appsChecked, uncovered,
 * emptyWithoutCoverage }
 */
export function readReview(reply, { request, inv, maxItems = PIPELINE_DEFAULTS.maxItems }) {
  const sources = sourceMap(request, inv);
  const parsed = Boolean(reply && typeof reply === 'object' && Array.isArray(reply.unmet));
  const items = [], dropped = [];
  for (const x of (parsed ? reply.unmet : []).slice(0, 25)) {
    if (!x || typeof x !== 'object') continue;
    const quote = str(x.quote).trim(), requirement = str(x.requirement).trim().slice(0, 400);
    const hit = quote ? copyLiteral(quote.slice(0, 2000), str(x.source).trim() || 'request', sources) : null;
    if (!hit || hit.verified === false) { dropped.push({ requirement, why: quote ? 'quote found in neither the request nor a record read before the work' : 'no quote' }); continue; }
    if (items.length >= maxItems) { dropped.push({ requirement, why: `over the ${maxItems}-item cap` }); continue; }
    items.push({ id: `U${items.length + 1}`, requirement, quote: hit.value.slice(0, 400), source: hit.source, status: x.status === 'wrong' ? 'wrong' : 'missing',
      evidence: str(x.evidence).slice(0, 600), fix: str(x.fix).slice(0, 800) });
  }
  const appsChecked = Array.isArray(reply?.apps_checked) ? reply.apps_checked.map(str).filter(Boolean).slice(0, 60) : [];
  const holding = Object.entries(inv?.apps ?? {}).filter(([, s]) => s.status === 'connected' && s.records > 0).map(([a]) => a).sort();
  const uncovered = holding.filter(a => !appMatch(appsChecked, a) && !(a === 'google_drive' && appMatch(appsChecked, 'google_sheets')) && !(a === 'google_sheets' && appMatch(appsChecked, 'google_drive')));
  return { parsed, items, dropped, appsChecked, uncovered, emptyWithoutCoverage: parsed && !items.length && uncovered.length > 0 };
}

/** The repair session's section, appended after A0's system prompt: only the reader's surviving items and what already
 * changed (so nothing is done twice). */
export function reviewSection({ items, changesText, stepsLeft, responseCap }) {
  return `${REVIEW_BEGIN}
A first session worked on this task and stopped. Code then re-read the systems, and a reviewer who did not do the work compared the request with what changed. The reviewer found the requirements below not done, or done wrongly. Do only what is missing. Everything already done must not be done again: no second copy of a message, post or record. If the records show that an item is in fact done, or not required, leave it. The user message is still the task.

- World steps left: about ${stepsLeft}; this session ends after at most ${responseCap} responses.
- Files in your working directory (reading them costs no world step): ${FILES.review} (this list), ${FILES.records} (every record read before the work, with pointers [app:kind:id]).

### Not done
${items.map((x, i) => `${i + 1}. ${x.requirement}${x.status === 'wrong' ? ' (done wrongly)' : ''}
   source ${x.source}: "${x.quote}"
   what the systems show: ${x.evidence || '(not stated)'}
   still needed: ${x.fix || '(see the source)'}`).join('\n')}

### Already changed (do not redo)
${changesText || '(nothing)'}
${REVIEW_END}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The pipeline

/** Copy a node transcript into the host directory only if it is a regular file (the workdir is agent-writable). */
function copyTranscript(src, dst) {
  try { if (!lstatSync(src).isFile()) return false; } catch { return false; }
  try { mkdirSync(path.dirname(dst), { recursive: true }); copyFileSync(src, dst, fsc.COPYFILE_EXCL); return true; } catch { return false; }
}
/** World steps the bridge has served so far (answers carrying results) still in the mailbox. */
export function servedSteps(mailbox) {
  let n = 0;
  try { for (const f of readdirSync(mailbox)) if (/^res-\d+\.json$/.test(f) && jsonOrNull(readMailboxFile(path.join(mailbox, f)) ?? '')?.results) n += 1; } catch { /* none */ }
  return n;
}
const lastText = events => events.filter(e => e?.type === 'assistant').flatMap(e => (e.message?.content ?? []).filter(c => c?.type === 'text').map(c => c.text)).at(-1) ?? null;

/**
 * runPipeline(o) -> a runner-shaped result plus { nodes, clientLog, pipeline }. The same inputs as A1-C's runPipeline:
 * { official: {system, user}, catalog, workdir, nodeRoot, hostDir, guardDir, maxSteps, budgetUsd, timeoutMs, dateNote, models,
 *   effort, tools, runner, nodeRunner, cliTarget, scripted, pipeline, log }
 */
export async function runPipeline(o) {
  const P = { ...PIPELINE_DEFAULTS, ...(o.pipeline ?? {}) };
  const log = o.log ?? (() => {});
  const t0 = Date.now();
  const B = o.budgetUsd, maxSteps = o.maxSteps, maxWorldSteps = maxSteps - 1;
  const models = o.models;
  const mailbox = path.join(o.workdir, '.tools');
  const pdir = path.join(o.hostDir, 'pipeline');
  if (existsSync(pdir)) { let n = 1; while (existsSync(`${pdir}.prev-${n}`)) n += 1; renameSync(pdir, `${pdir}.prev-${n}`); }
  mkdirSync(pdir, { recursive: true });
  const hostWrite = (name, obj) => writeFileSync(path.join(pdir, name), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1));
  const nodes = [];
  let responses = 0, spent = 0, upper = 0, unknown = false, envFault = null, hiddenSteps = 0;
  const HALT = Symbol('environment fault');
  const halt = () => { if (envFault) throw HALT; };
  const noteFault = code => { if (ENV_FAULTS.has(code)) envFault ??= code; };
  const toolUses = [];
  const client = bridgeClient({ mailbox, responsesSoFar: () => responses });
  const msLeft = () => o.timeoutMs - (Date.now() - t0);
  const usdLeft = () => B - upper;
  const stepsUsed = () => servedSteps(mailbox) + hiddenSteps;
  const settle = (r, budget) => {
    const known = typeof r?.costUsd === 'number' && Number.isFinite(r.costUsd);
    if (known) { spent += r.costUsd; upper += r.costUsd; } else { unknown = true; upper += r?.costUpperUsd ?? budget; }
    return known ? r.costUsd : null;
  };
  const slot = () => { nodes.push(null); return nodes.length - 1; };
  const tag = idx => String(idx).padStart(2, '0');
  const transcriptPath = (idx, name) => path.join(pdir, 'nodes', `${tag(idx)}-${name}.jsonl`);

  const codeNode = async (name, fn) => {
    const idx = slot(), started = Date.now() / 1000;
    nodes[idx] = { idx, name, kind: 'code', responses: 0, steps: 0, started, ended: null };
    const out = await fn();
    nodes[idx].steps = client.log.filter(e => e.node === name && !e.refused).length;
    nodes[idx].ended = Date.now() / 1000;
    return out;
  };
  async function modelNode(name, role, system, prompt) {
    const model = models[role];
    const budget = Math.max(0.005, Math.min(P.readerBudgetShare * B, usdLeft()));
    const idx = slot();
    const dir = path.join(o.nodeRoot, `${tag(idx)}-${name}`);
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    const guard = writeCliGuard(path.join(o.guardDir, name), { maxTurns: 1, target: o.cliTarget ?? 'claude' });
    const tfile = transcriptPath(idx, name), started = Date.now() / 1000;
    let r;
    try {
      r = await o.nodeRunner({ model, prompt, systemPrompt: system, workdir: dir, files: {}, budgetUsd: budget, timeoutMs: Math.max(30_000, Math.min(P.nodeTimeoutMs, msLeft() - 60_000)), effort: o.effort ?? null,
        tools: [], task: { name: role, fork: 0 }, maxTurns: 1, binary: guard.binary, keepRo: [...DEFAULT_KEEP_RO, guard.dir] });
    } catch (e) { r = { ok: false, error: { code: ENV_FAULTS.has(e?.code) ? e.code : 'NODE_ERROR', message: String(e?.message ?? e).slice(0, 300) }, costUsd: null, costUnknown: true, costUpperUsd: budget }; }
    noteFault(r?.error?.code);
    const copied = copyTranscript(path.join(dir, '.executor-transcript.jsonl'), tfile);
    const events = copied ? readStream(tfile) : [];
    const audit = auditSession({ events, calls: [], maxSteps, expectModel: o.scripted ? null : model });
    const resp = events.length ? audit.modelResponses : (r?.turns ?? 1);
    responses += resp;
    const cost = settle(r, budget);
    const text = typeof r?.result === 'string' ? r.result : lastText(events);
    const json = parseJsonReply(text);
    nodes[idx] = { idx, name, kind: 'model', role, model, responses: resp, costUsd: cost, costUpperUsd: r?.costUpperUsd ?? budget, started, ended: Date.now() / 1000,
      transcript: copied ? path.relative(o.hostDir, tfile) : null, parsed: Boolean(json), error: r?.error?.code ?? null };
    hostWrite(`${tag(idx)}-${name}.reply.txt`, String(text ?? ''));
    return json;
  }
  async function sessionNode(name, role, args, cap) {
    const model = models[role];
    const idx = slot();
    const tfile = transcriptPath(idx, name), live = path.join(o.workdir, '.executor-transcript.jsonl');
    rmSync(live, { force: true });
    const started = Date.now() / 1000;
    let r;
    try { r = await o.runner({ model, ...args }); }
    catch (e) { r = { ok: false, error: { code: ENV_FAULTS.has(e?.code) ? e.code : 'SESSION_ERROR', message: String(e?.message ?? e).slice(0, 300) }, costUsd: null, costUnknown: true, costUpperUsd: args.budgetUsd }; }
    noteFault(r?.error?.code);
    const copied = copyTranscript(live, tfile);
    rmSync(live, { force: true });
    const events = copied ? readStream(tfile) : [];
    const audit = auditSession({ events, calls: [], maxSteps, expectModel: o.scripted ? null : model });
    const resp = events.length ? audit.modelResponses : (r?.turns ?? 0);
    responses += resp;
    const cost = settle(r, args.budgetUsd);
    toolUses.push(...(r?.toolUses ?? []));
    hostWrite(`${tag(idx)}-${name}.system.txt`, args.systemPrompt);
    nodes[idx] = { idx, name, kind: 'session', role, model, cap: cap ?? null, responses: resp, costUsd: cost, costUpperUsd: r?.costUpperUsd ?? args.budgetUsd, started, ended: Date.now() / 1000,
      transcript: copied ? path.relative(o.hostDir, tfile) : null, stopReason: audit.stopReason, error: r?.error?.code ?? null };
    return r;
  }

  const a0System = actSystemPrompt(o.official.system, o.catalog, maxSteps, { dateNote: o.dateNote });
  const stats = { preRead: null, act: null, postRead: null, reader: null, repair: null, skipped: null };
  let actError = null;
  try {
    // 0. PRE-READ (code), then hide its mailbox files from the session.
    const inv = await codeNode('pre-read', () => buildInventory({ request: o.official.user, client, maxSteps: P.preSteps, node: 'pre-read' }));
    const codeReqs = new Set(client.log.map(e => e.req));
    hiddenSteps = hideCodeSteps(mailbox, codeReqs);
    hostWrite('inventory.json', inv);
    stats.preRead = { steps: inv.steps, calls: inv.calls, connected: inv.connected.length, outOfScope: inv.outOfScope.length, records: inv.records.length, truncated: inv.truncated.length, errors: inv.errors.length };
    log(`[secondreader] pre-read: ${inv.records.length} records in ${inv.steps} steps; connected ${inv.connected.join(',')}`);

    // 1. ACT: the A0 session.
    const act = await sessionNode('act', 'act', { prompt: o.official.user, systemPrompt: a0System, workdir: o.workdir, files: {}, budgetUsd: B,
      timeoutMs: Math.max(60_000, o.timeoutMs - P.actReserveMs), effort: o.effort ?? null, tools: o.tools ?? ['Bash'], task: { name: 'act', fork: 0 } }, null);
    actError = act?.error?.code ?? null;
    halt();
    const actWindow = { lo: t0 / 1000 - 120, hi: Date.now() / 1000 + 120 };
    stats.act = { responses: responses, steps: stepsUsed() - hiddenSteps, error: actError };

    // 2. POST-READ (code) and the diff; the session's own calls from the mailbox.
    const mine = sessionCalls(mailbox, { skip: codeReqs });
    const holding = Object.entries(inv.apps).filter(([, s]) => s.status === 'connected' && s.records > 0).map(([a]) => a).sort();
    const neverCalled = holding.filter(a => !mine.apps.includes(a) && !(a === 'google_drive' && mine.apps.includes('google_sheets')) && !(a === 'google_sheets' && mine.apps.includes('google_drive')));
    const readable = [...new Set(inv.connected.filter(a => ENUM_PLAN.some(e => e.app === a && !e.probe)).concat(inv.connected.includes('google_drive') ? ['google_drive'] : []))];
    const postBudget = Math.min(P.postSteps, maxWorldSteps - stepsUsed() - P.repairMinSteps);
    let after = null;
    if (postBudget >= 1 && readable.length) after = await codeNode('post-read', () => rereadWorld({ client, apps: readable, maxSteps: postBudget, node: 'post-read' }));
    const diff = after ? diffReads(inv, after, { ...actWindow, maxChars: P.changesChars }) : { text: '', added: 0, changed: 0, removed: 0, apps: [] };
    if (after) hostWrite('post-read.json', after);
    let writesText = mine.writes.map((w, i) => `${i + 1}. ${w.method} ${w.url}${w.body ? ` body ${w.body}` : ''} -> ${w.status === 'ok' ? 'ok' : `error ${w.status}`}: ${w.answer}`).join('\n');
    if (writesText.length > P.writesChars) writesText = `${writesText.slice(0, P.writesChars)}\n…(more write calls cut for size)`;
    stats.postRead = { done: Boolean(after), steps: after?.steps ?? 0, added: diff.added, changed: diff.changed, removed: diff.removed, sessionSteps: mine.steps, sessionWrites: mine.writes.length,
      sessionApps: mine.apps.length, neverCalled: neverCalled.length, holding: holding.length };
    hostWrite('diff.txt', diff.text);
    hostWrite('session-calls.json', mine);

    // 3. READ (clean context): only if the reader still fits the responses (a repair needs more; checked below).
    reading: {
      if (responses + 1 > maxSteps - 1) { stats.skipped = 'no response left for the reader'; break reading; }
      const recordsText = renderInventory(inv, { maxChars: P.readerInventoryChars });
      const prompt = readerPrompt({ request: o.official.user, recordsText, changesText: diff.text, writes: writesText, neverCalled, postRead: Boolean(after), dateNote: o.dateNote ? DATE_NOTE : null });
      const reply = await modelNode('reader', 'reader', READER_SYSTEM, prompt);
      halt();
      const review = readReview(reply, { request: o.official.user, inv, maxItems: P.maxItems });
      hostWrite('review.json', review);
      stats.reader = { parsed: review.parsed, items: review.items.length, dropped: review.dropped.length, appsChecked: review.appsChecked.length, uncovered: review.uncovered.length, emptyWithoutCoverage: review.emptyWithoutCoverage,
        missing: review.items.filter(i => i.status === 'missing').length, wrong: review.items.filter(i => i.status === 'wrong').length };
      log(`[secondreader] reader: ${review.items.length} unmet item(s) kept, ${review.dropped.length} dropped${review.emptyWithoutCoverage ? ', empty without coverage' : ''}`);

      // 4. REPAIR: one session, only on surviving items and only if it fits.
      const cap = maxSteps - responses - 1;
      const stepsLeft = maxWorldSteps - stepsUsed();
      const why = !review.items.length ? 'no unmet item' : cap < P.minRepairResponses ? 'response budget exhausted' : stepsLeft < P.repairMinSteps ? 'world-step budget exhausted'
        : usdLeft() < P.minRepairUsd ? 'money budget exhausted' : msLeft() < P.minRepairMs ? 'time budget exhausted' : null;
      if (why) { stats.repair = { ran: false, reason: why }; }
      else {
        writeFileSync(path.join(o.workdir, FILES.records), renderInventory(inv, { maxChars: 4_000_000 }));
        writeFileSync(path.join(o.workdir, FILES.review), `${review.items.map((x, i) => `${i + 1}. ${x.requirement}\n   source ${x.source}: "${x.quote}"\n   what the systems show: ${x.evidence}\n   still needed: ${x.fix}`).join('\n')}\n`);
        const changes = diff.text.length > P.repairChangesChars ? `${diff.text.slice(0, P.repairChangesChars)}\n…(more changes cut for size)` : diff.text;
        let section = reviewSection({ items: review.items, changesText: changes || writesText.slice(0, P.repairChangesChars), stepsLeft, responseCap: cap });
        const room = P.systemMaxBytes - Buffer.byteLength(a0System) - 2;
        if (Buffer.byteLength(section) > room) section = `${section.slice(0, Math.max(0, room - 200))}\n…(cut for size: ${FILES.review} holds the full list)\n${REVIEW_END}`;
        const guard = writeCliGuard(path.join(o.guardDir, 'repair'), { maxTurns: cap, target: o.cliTarget ?? 'claude' });
        await sessionNode('repair', 'repair', { prompt: o.official.user, systemPrompt: `${a0System}\n\n${section}`, workdir: o.workdir, files: {}, budgetUsd: Math.max(0.01, usdLeft()),
          timeoutMs: Math.max(60_000, msLeft() - 60_000), effort: o.effort ?? null, tools: o.tools ?? ['Bash'], task: { name: 'repair', fork: 0 }, maxTurns: cap, binary: guard.binary, keepRo: [...DEFAULT_KEEP_RO, guard.dir] }, cap);
        halt();
        stats.repair = { ran: true, cap, items: review.items.length };
      }
    }
  } catch (e) {
    if (e === HALT) {
      actError = envFault;
      stats.envFault = envFault;
      log(`[secondreader] environment fault ${envFault}: pipeline stopped after node ${nodes.filter(Boolean).at(-1)?.name ?? '?'}`);
    } else {
      actError = envFault ?? actError ?? 'PIPELINE_ERROR';
      stats.error = String(e?.stack ?? e).slice(0, 1500);
      log(`[secondreader] pipeline error: ${String(e?.message ?? e).slice(0, 300)}`);
    }
  }
  hostWrite('client-log.json', client.log);
  for (let i = 0; i < nodes.length; i++) if (!nodes[i]) nodes[i] = { idx: i, name: 'unfinished', kind: 'code', responses: 0, steps: 0, started: 0, ended: 0 };
  hostWrite('nodes.json', nodes);
  return { ok: !actError, error: actError ? { code: actError } : null, costUsd: unknown ? null : spent, costUnknown: unknown, costUpperUsd: upper, turns: responses, durationMs: Date.now() - t0, toolUses,
    nodes, clientLog: client.log, pipeline: { ...stats, responses, nodes: nodes.map(n => ({ name: n.name, kind: n.kind, model: n.model ?? null, responses: n.responses, steps: n.steps ?? null, cap: n.cap ?? null, costUsd: n.costUsd ?? null, error: n.error ?? null, parsed: n.parsed ?? null })) },
    label: `pipeline:${HARNESS_ID}` };
}
/** The per-task audit: A1-C's (H3 on the sum of model responses over every call, code steps included; L5 per node). */
export { auditPipeline };
