// Host capabilities of the surface spike (research/surface-20261021/DESIGN.md §8). Capabilities are trusted host code outside any
// generated workflow (docs/ARCHITECTURE.md "Capability and execution boundary"): the workflow can name them, never redefine them.
//
// Two registries share one set of names and schemas:
//   live      outbox.send is a NON-IDEMPOTENT effect that requires a human approval on every dispatch (src/runtime.mjs approval gate).
//   practice  outbox.send writes to a practice outbox and needs no approval; the practice registry therefore has another hash, and
//             every dry run records which registry it ran against. A practice pass is evidence about the workflow, not about delivery.
// "Delivery" is a local outbox file in both modes. Real e-mail or chat delivery needs a connector the spike does not have.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { createDefaultRegistry } from '../../src/capabilities.mjs';
import { FoundryError } from '../../src/data.mjs';

const sha256 = text => createHash('sha256').update(text).digest('hex');
const ITEM = { type: 'object', additionalProperties: false, required: ['title', 'status'],
  properties: { title: { type: 'string', minLength: 1, maxLength: 300 }, status: { enum: ['done', 'open', 'blocked'] }, owner: { type: 'string', maxLength: 120 } } };
const SEND_OUT = { type: 'object', additionalProperties: false, required: ['delivered', 'messageId', 'sha256', 'mode', 'to'],
  properties: { delivered: { type: 'boolean' }, messageId: { type: 'string' }, sha256: { type: 'string' }, mode: { enum: ['live', 'practice'] }, to: { type: 'string' } } };

function outboxFile(dir, messageId) {
  if (!/^[a-f0-9]{16,64}$/.test(messageId)) throw new FoundryError('OUTBOX_ID', 'A message id is 16-64 lowercase hex characters');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (lstatSync(dir).isSymbolicLink()) throw new FoundryError('OUTBOX_PATH', 'The outbox must not be a symlink');
  return path.join(dir, `${messageId}.json`);
}

/** The live or practice registry: the core tools plus report.tally, outbox.send and outbox.check. */
export function appRegistry({ mode, outboxDir }) {
  if (!['live', 'practice'].includes(mode)) throw new FoundryError('APP_REGISTRY', 'mode is live or practice');
  if (typeof outboxDir !== 'string' || !path.isAbsolute(outboxDir)) throw new FoundryError('APP_REGISTRY', 'outboxDir must be an absolute path');
  const registry = createDefaultRegistry();
  const base = { version: '1', risk: 'low', maxTimeoutMs: 10000, cost: 0, cancellation: 'cooperative', requiresApproval: false };
  registry.register({ ...base, name: 'report.tally', implementation: 'foundry-surface-spike/report.tally', effects: 'none',
    description: 'Count finished, open and blocked items and list the finished ones, one per line. Deterministic code; no model.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', maxItems: 500, items: ITEM } } },
    outputSchema: { type: 'object', additionalProperties: false, required: ['total', 'done', 'open', 'blocked', 'doneLines'],
      properties: { total: { type: 'integer' }, done: { type: 'integer' }, open: { type: 'integer' }, blocked: { type: 'integer' }, doneLines: { type: 'string' } } },
    execute: async ({ items }) => {
      const count = status => items.filter(item => item.status === status).length;
      const finished = items.filter(item => item.status === 'done').map(item => `- ${item.title}${item.owner ? ` (${item.owner})` : ''}`);
      return { total: items.length, done: count('done'), open: count('open'), blocked: count('blocked'), doneLines: finished.length ? finished.join('\n') : '- nothing marked done' };
    } });
  registry.register({ ...base, name: 'outbox.send', implementation: `foundry-surface-spike/outbox.send/${mode}`,
    // Live: an effect that cannot be safely repeated, so the runtime asks a person before each dispatch (approval bound to the exact
    // tool, arguments and workflow hash). Practice: writes only the practice outbox.
    effects: mode === 'live' ? 'non-idempotent' : 'idempotent', requiresApproval: mode === 'live',
    description: mode === 'live' ? 'Deliver one message to the local outbox (stand-in for e-mail). Asks a person before every send.' : 'PRACTICE: record the message that would be sent, in the practice outbox only.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['to', 'subject', 'body'],
      properties: { to: { type: 'string', minLength: 3, maxLength: 254 }, subject: { type: 'string', minLength: 1, maxLength: 200 }, body: { type: 'string', minLength: 1, maxLength: 100000 } } },
    outputSchema: SEND_OUT,
    execute: async ({ to, subject, body }, ctx) => {
      // The address shape is checked here, in code: the engine's schema profile refuses regex patterns (untrusted-regex rule).
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new FoundryError('OUTBOX_ADDRESS', 'The recipient is not one e-mail address');
      const messageId = String(ctx.idempotencyKey).slice(0, 32);
      const file = outboxFile(outboxDir, messageId), record = { to, subject, body, sha256: sha256(body), mode, runId: ctx.runId, nodeKey: ctx.nodeKey };
      if (existsSync(file)) {
        const prior = JSON.parse(readFileSync(file, 'utf8'));
        if (prior.sha256 !== record.sha256 || prior.to !== to) throw new FoundryError('OUTBOX_CONFLICT', 'A different message already holds this id');
      } else writeFileSync(file, JSON.stringify(record, null, 2), { mode: 0o600, flag: 'wx' });
      return { delivered: true, messageId, sha256: record.sha256, mode, to };
    } });
  registry.register({ ...base, name: 'outbox.check', implementation: `foundry-surface-spike/outbox.check/${mode}`, effects: 'none',
    description: 'Independent check: re-read the delivered message from the outbox and compare its hash with the saved report.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['messageId', 'sha256'], properties: { messageId: { type: 'string' }, sha256: { type: 'string', minLength: 64, maxLength: 64 } } },
    outputSchema: { type: 'object', additionalProperties: false, required: ['pass', 'score', 'reasons'], properties: { pass: { type: 'boolean' }, score: { type: 'number' }, reasons: { type: 'array', items: { type: 'string' } } } },
    execute: async ({ messageId, sha256: expected }) => {
      const file = outboxFile(outboxDir, messageId);
      if (!existsSync(file)) return { pass: false, score: 0, reasons: ['No message with this id is in the outbox'] };
      const stored = JSON.parse(readFileSync(file, 'utf8'));
      const actual = sha256(stored.body ?? '');
      return actual === expected ? { pass: true, score: 1, reasons: ['The delivered text is byte-for-byte the saved report'] }
        : { pass: false, score: 0, reasons: ['The delivered text differs from the saved report'] };
    } });
  return registry;
}
