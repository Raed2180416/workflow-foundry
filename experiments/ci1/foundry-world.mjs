// The Foundry side of a CI-1 world: the capability registry built workflows may use, and a runner that executes a built workflow in a
// seeded world and reads back its effects (research/ci1-20261021). The world is the SAME object n8n-sim runs the reference in:
//   { id, now, event, sheets: { name: { columns, rows } } }
// Run input is { now, event } (only the properties the workflow's inputSchema declares are passed, so template workflows that take
// { now } alone still run). Every outside action is approved by a counting stand-in, as in BUILDER-1's hidden-world runs.
//
// Capabilities = BUILDER-1's app registry (sheet.read/append, rows.*, chat.post, outbox.send, audits, core.*) plus three stand-ins the
// corpus needs: sheet.update, sheet.upsert (n8n's update / appendOrUpdate by a key column) and reply.send (respond to the caller of a
// webhook). Code nodes (kind "code", lang js) run in the engine's sandbox like any Foundry code node.
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Foundry } from '../../src/foundry.mjs';
import { validateWorkflow, requireWorkflow } from '../../src/validate.mjs';
import { errorData, FoundryError, canonical } from '../../src/data.mjs';
import { appRegistry } from '../../app/core/capabilities.mjs';
import { seedWorld, readWorld, readOutbox } from '../../app/core/stand-ins.mjs';

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'uncertain']);
const SHEET = /^[a-z][a-z0-9-]{0,40}$/;
const ROWS = { type: 'array', maxItems: 2000, items: { type: 'object' } };
const sha256 = t => createHash('sha256').update(t).digest('hex');
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const writeJson = (file, value) => { const tmp = `${file}.tmp-${process.pid}`; writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 }); renameSync(tmp, file); };

export function ci1Registry({ mode = 'live', outboxDir, worldDir }) {
  const registry = appRegistry({ mode, outboxDir, worldDir });
  const base = { version: '1', risk: 'low', maxTimeoutMs: 10000, cost: 0, cancellation: 'cooperative', requiresApproval: false };
  const sheetFile = sheet => { if (!SHEET.test(sheet ?? '')) throw new FoundryError('SHEET_NAME', 'A sheet name is lowercase letters, digits and dashes'); return path.join(worldDir, 'sheets', `${sheet}.json`); };
  const keyed = (name, upsert) => registry.register({ ...base, name, implementation: `foundry-ci1/${name}/${mode}`, effects: 'idempotent',
    description: upsert ? 'For each given row: if the sheet has a row whose `key` column equals the row\'s key value (text compared ignoring case and spaces), set the given columns on the FIRST such row; otherwise append the row. Safe to repeat.'
      : 'For each given row: find the FIRST row of the sheet whose `key` column equals the row\'s key value (text compared ignoring case and spaces) and set the given columns on it. Rows with no match change nothing. Safe to repeat.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['sheet', 'key', 'rows'], properties: { sheet: { type: 'string', minLength: 1, maxLength: 41 }, key: { type: 'string', minLength: 1, maxLength: 200 }, rows: ROWS } },
    outputSchema: { type: 'object', additionalProperties: false, required: ['sheet', 'updated', 'appended', 'unmatched'], properties: { sheet: { type: 'string' }, updated: { type: 'integer' }, appended: { type: 'integer' }, unmatched: { type: 'integer' } } },
    execute: async ({ sheet, key, rows }, ctx) => {
      const file = sheetFile(sheet);
      if (!existsSync(file)) throw new FoundryError('SHEET_NOT_FOUND', `There is no sheet named ${sheet}`);
      const current = JSON.parse(readFileSync(file, 'utf8'));
      let updated = 0, appended = 0, unmatched = 0;
      for (const r of rows) {
        const i = current.findIndex(x => same(x[key], r[key]));
        if (i >= 0) { Object.assign(current[i], r); updated++; } else if (upsert) { current.push({ ...r }); appended++; } else unmatched++;
      }
      writeJson(file, current);
      appendFileSync(path.join(worldDir, 'effects.jsonl'), `${JSON.stringify({ kind: name, runId: ctx.runId, nodeKey: ctx.nodeKey, sheet, key, count: rows.length, sha256: sha256(canonical(rows)) })}\n`);
      return { sheet, updated, appended, unmatched };
    } });
  keyed('sheet.update', false);
  keyed('sheet.upsert', true);
  registry.register({ ...base, name: 'reply.send', implementation: `foundry-ci1/reply.send/${mode}`, effects: 'idempotent',
    description: 'Answer the caller of the webhook that started this run: an HTTP status (default 200) and a body (a JSON value or text). A run answers at most once.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['body'], properties: { status: { type: 'integer', minimum: 100, maximum: 599 }, body: {} } },
    outputSchema: { type: 'object', additionalProperties: false, required: ['sent'], properties: { sent: { type: 'boolean' } } },
    execute: async ({ status = 200, body }, ctx) => {
      const file = path.join(worldDir, 'replies.json');
      const prior = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
      const id = String(ctx.idempotencyKey);
      if (!prior.some(r => r.id === id)) writeJson(file, [...prior, { id, runId: ctx.runId, status, body }]);
      return { sent: true };
    } });
  return registry;
}

/** Strict validation against the live CI-1 registry. */
export function validateCi1(workflow) {
  const dir = path.join(tmpdir(), 'foundry-ci1-validate');
  const registry = ci1Registry({ mode: 'live', outboxDir: path.join(dir, 'outbox'), worldDir: path.join(dir, 'world') });
  try { return validateWorkflow(workflow, { registry, strict: true }); }
  catch (error) { return { valid: false, errors: [errorData(error)], warnings: [] }; }
}

/** Seed a world's sheets as stand-in sheet files (rows only; the columns travel in the workspace description). */
export const sheetsOf = world => Object.fromEntries(Object.entries(world.sheets ?? {}).map(([k, s]) => [k, structuredClone(s.rows ?? s)]));

/**
 * Run a built workflow once in `world` (live registry, every outside action approved and counted).
 * Returns { status, verdict, error, effects: {outbox, chat, replies}, world: {sheets}, approvals, steps }.
 */
export async function runBuilt(workflow, world, { root = null, maxResumes = 400, mode = 'live' } = {}) {
  const dir = mkdtempSync(path.join(root ?? tmpdir(), 'ci1-run-'));
  const worldDir = path.join(dir, 'world'), outboxDir = path.join(dir, 'outbox');
  mkdirSync(worldDir, { recursive: true, mode: 0o700 });
  seedWorld(worldDir, { sheets: sheetsOf(world) });
  const registry = ci1Registry({ mode, outboxDir, worldDir });
  const foundry = new Foundry(path.join(dir, 'store'), { registry });
  const out = { status: 'not-started', verdict: null, error: null, approvals: { asked: 0, approved: 0 }, effects: { outbox: [], chat: {}, replies: [] }, world: { sheets: {} } };
  try {
    let staged;
    try { requireWorkflow(workflow, { registry, modelPolicy: foundry.modelPolicy }); staged = foundry.store.stageEvaluationWorkflow(workflow); }
    catch (error) { out.status = 'invalid'; out.error = errorData(error); return out; }
    const declared = workflow.inputSchema?.properties ?? {};
    const input = Object.fromEntries(Object.entries({ now: world.now, event: world.event ?? {} }).filter(([k]) => k in declared));
    let run;
    try { run = foundry.createRun(staged.hash, input); } catch (error) { out.status = 'input-refused'; out.error = errorData(error); return out; }
    await foundry.startRun(run.id).catch(() => {});
    let current = foundry.publicRun(foundry.store.run(run.id));
    for (let i = 0; i < maxResumes && current.status === 'awaiting_approval'; i++) {
      for (const a of Object.values(current.approvals ?? {}).filter(a => a.status === 'pending')) { out.approvals.asked++; out.approvals.approved++; foundry.runtime.approve(run.id, a.id, true, 'user'); }
      await foundry.startRun(run.id).catch(() => {});
      current = foundry.publicRun(foundry.store.run(run.id));
      if (TERMINAL.has(current.status)) break;
    }
    out.status = current.status; out.verdict = current.verdict?.verdict ?? null; out.error = current.error ?? null;
    out.steps = Object.keys(current.nodes ?? {}).length;
    const w = readWorld(worldDir);
    out.effects.outbox = readOutbox(outboxDir).filter(m => m.runId === run.id).map(m => ({ to: m.to, subject: m.subject, body: m.body }));
    out.effects.chat = Object.fromEntries(Object.entries(w.chat).map(([c, posts]) => [c, posts.filter(p => p.runId === run.id).map(p => p.text)]).filter(([, p]) => p.length));
    const rf = path.join(worldDir, 'replies.json');
    out.effects.replies = existsSync(rf) ? JSON.parse(readFileSync(rf, 'utf8')).filter(r => r.runId === run.id).map(r => ({ status: r.status, body: r.body })) : [];
    out.world.sheets = w.sheets;
    return out;
  } finally {
    await foundry.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
