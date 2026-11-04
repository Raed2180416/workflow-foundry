// Shared test helpers for app/onboarding and app/site ($0, no model, loopback only).
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FoundryApp } from '../../core/service.mjs';
import { SiteBuilder } from '../site-builder.mjs';
import { commit } from '../data.mjs';
import { preview } from '../csv.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(here, '..', '..', 'site', 'test', 'fixtures');
export const fixture = name => readFileSync(path.join(FIXTURES, name), 'utf8');
export const NOW = Date.parse('2026-10-21T09:00:00Z');

export async function withApp(fn, { builder = new SiteBuilder() } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'onboard-'));
  const app = new FoundryApp({ workspace: dir, builder });
  try { return await fn(app, dir); } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
}

/** An invoice-chase automation, tested and turned on by a person through the dashboard channel. */
export async function invoiceFlowOn(app, { summaryTo = 'me@example.com' } = {}) {
  const p = await app.propose({ template: 'invoice-chase', settings: { sendSummary: true, summaryTo }, origin: 'site-form' });
  const d = await app.dryRun({ proposalId: p.proposalId });
  if (!d.passed) throw new Error('practice failed');
  const a = app.requestApproval({ proposalId: p.proposalId });
  app.decideActivation(a.approvalId, true, { channel: 'dashboard' });
  return p;
}

/** The accounting-export fixture written as the live invoices sheet (day-first dates). */
export function liveInvoices(app, file = 'invoices-accounting-export.csv') {
  const text = fixture(file);
  const pv = preview({ template: 'invoice-chase', sheet: 'invoices', text });
  const answers = Object.fromEntries(pv.questions.map(q => [q.id, q.id.startsWith('dateOrder') ? 'dmy' : q.kind === 'choice' ? q.choices[0].value : []]));
  return commit(app, { template: 'invoice-chase', sheet: 'invoices', text, mapping: pv.mapping, answers, target: 'live' });
}
