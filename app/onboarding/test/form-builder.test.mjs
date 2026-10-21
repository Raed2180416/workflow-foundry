// The template form builder and the site builder ($0, no model). nice -n 15 node --test app/onboarding/test/form-builder.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { TemplateFormBuilder, restate, FORM_BUILDER_ID } from '../form-builder.mjs';
import { SiteBuilder } from '../site-builder.mjs';
import { suggest } from '../suggest.mjs';
import { loadLibrary } from '../../core/library.mjs';
import { withApp } from './helpers.mjs';

const MINIMAL = { 'invoice-chase': { sendSummary: true, summaryTo: 'me@example.com' }, 'expense-approval': { autoApproveUpTo: 100, approver: 'maria@example.com' },
  'weekly-report': { recipient: 'lead@example.com' }, 'lead-triage': { defaultAssignee: 'sales@example.com' }, 'support-deflection': { escalateTo: 'help@example.com' },
  'oncall-digest': { channel: '#ops' }, 'contact-sync': { reportTo: 'me@example.com' } };

test('all seven cards build from a form at $0, pass their practice run, and are made by the form builder', async () => withApp(async app => {
  assert.equal(loadLibrary().length, 7);
  for (const [template, settings] of Object.entries(MINIMAL)) {
    const p = await app.propose({ template, settings, origin: 'site-form' });
    assert.equal(p.status, 'proposed', `${template}: ${JSON.stringify(p)}`);
    assert.equal(p.builder, FORM_BUILDER_ID);
    const d = await app.dryRun({ proposalId: p.proposalId });
    assert.equal(d.passed, true, template);
    assert.ok(d.wouldDo.every(w => /^[a-f0-9]{64}$/.test(w.digest)), `${template}: every would-do item carries a digest`);
  }
}));

test('each card asks only its harmful questions; a visible default fills the rest', () => {
  const b = new TemplateFormBuilder();
  const asked = Object.fromEntries(loadLibrary().map(t => [t.id, b.build({ template: t.id, settings: t.id === 'invoice-chase' ? { sendSummary: true } : t.id === 'oncall-digest' ? { page: true } : {} })]));
  assert.deepEqual(Object.fromEntries(Object.entries(asked).map(([k, r]) => [k, r.questions?.map(q => q.slot) ?? []])), {
    'contact-sync': ['reportTo'], 'expense-approval': ['autoApproveUpTo', 'approver'], 'invoice-chase': ['summaryTo'], 'lead-triage': ['defaultAssignee'],
    'oncall-digest': ['channel', 'pageTo'], 'support-deflection': ['escalateTo'], 'weekly-report': ['recipient'] });
  const r = b.build({ template: 'invoice-chase', settings: { sendSummary: false } });
  assert.equal(r.status, 'ready');
  assert.deepEqual(r.understood.defaults.map(d => d.slot), ['firstAfterDays', 'secondAfterDays', 'finalAfterDays', 'signature', 'summaryTo']);
});

test('agent path: an address the person never wrote is not used; the template asks instead (R3)', () => {
  const b = new TemplateFormBuilder();
  const r = b.build({ template: 'invoice-chase', settings: { sendSummary: true, summaryTo: 'boss@example.com' }, origin: 'agent', request: 'chase my unpaid invoices and send me a summary' });
  assert.equal(r.status, 'needs_answers');
  assert.equal(r.questions[0].slot, 'summaryTo');
  assert.deepEqual(r.notWritten.map(n => n.value), ['boss@example.com']);
  const ok = b.build({ template: 'invoice-chase', settings: { sendSummary: true, summaryTo: 'me@example.com' }, origin: 'agent', request: 'use Foundry to chase my unpaid invoices, summary to me@example.com' });
  assert.equal(ok.status, 'ready');
  const answered = b.build({ template: 'invoice-chase', settings: { sendSummary: true, summaryTo: 'boss@example.com' }, answers: { summaryTo: 'me@example.com' }, origin: 'agent', request: 'chase my invoices' });
  assert.equal(answered.status, 'ready'); assert.equal(answered.understood.slots.summaryTo, 'me@example.com');
});

test('bad settings are refused in words before anything is built', () => {
  const b = new TemplateFormBuilder();
  assert.equal(b.build({ template: 'nope' }).status, 'unsupported');
  assert.match(b.build({ template: 'nope' }).reply, /list_templates/);
  assert.equal(b.build({ template: 'invoice-chase', settings: { colour: 'red' } }).status, 'build_failed');
  assert.equal(b.build({ template: 'invoice-chase', settings: { firstAfterDays: { $ref: 'x' } } }).status, 'build_failed');
  const order = b.build({ template: 'invoice-chase', settings: { firstAfterDays: 20, secondAfterDays: 10 } });
  assert.equal(order.status, 'build_failed'); assert.match(order.reply, /later than firstAfterDays/);
  assert.throws(() => b.build({ template: 'invoice-chase', origin: 'model' }), { code: 'BUILDER_ORIGIN' });
});

test('a policy hook prefills a bound setting and refuses a widening', () => {
  const policy = (template, settings) => template !== 'expense-approval' ? { prefill: {}, refusals: [], answered: [] }
    : Number(settings.autoApproveUpTo) > 250 ? { prefill: {}, refusals: [{ slot: 'autoApproveUpTo', message: 'Not allowed here. Dana set the limit at €250 (Org policy).' }], answered: [] }
      : settings.autoApproveUpTo === undefined ? { prefill: { autoApproveUpTo: 250 }, refusals: [], answered: [{ slot: 'autoApproveUpTo', text: '€250 · Set by Dana (Org policy)' }] } : { prefill: {}, refusals: [], answered: [] };
  const b = new TemplateFormBuilder({ policy });
  const filled = b.build({ template: 'expense-approval', settings: { approver: 'dana@example.com' } });
  assert.equal(filled.status, 'ready'); assert.equal(filled.understood.slots.autoApproveUpTo, 250);
  const wide = b.build({ template: 'expense-approval', settings: { approver: 'dana@example.com', autoApproveUpTo: 2000 } });
  assert.equal(wide.status, 'build_failed'); assert.match(wide.reply, /Not allowed here/);
  assert.equal(restate({ template: 'expense-approval', settings: {}, policy }).setBy[0].text, '€250 · Set by Dana (Org policy)');
});

test('site builder: a card goes to the form builder; words go to the stub; an existing card automation stays on its card', async () => {
  const sb = new SiteBuilder();
  assert.equal((await sb.build({ template: 'weekly-report', settings: { recipient: 'a@example.com' } })).builder, FORM_BUILDER_ID);
  assert.match((await sb.build({ request: 'what is the weather' })).builder, /^stub-template-matcher/);
  const base = { id: 'invoice-chase', version: 1, template: 'invoice-chase', slots: { sendSummary: true, summaryTo: 'me@example.com', firstAfterDays: 7, secondAfterDays: 14, finalAfterDays: 30, signature: 'Accounts team' } };
  const r = await sb.build({ request: 'change it', base, origin: 'agent' });
  assert.equal(r.status, 'ready'); assert.equal(r.workflow.version, 2); assert.equal(r.understood.slots.summaryTo, 'me@example.com', 'an address given once is not asked again (WCAG 3.3.7)');
  assert.equal(sb.usesAI(FORM_BUILDER_ID), false);
});

test('the box suggests a card by keywords and never builds (R1)', () => {
  assert.deepEqual(suggest('book me a flight to Lisbon').candidates, []);
  assert.equal(suggest("remind customers who haven't paid").best, 'invoice-chase');
  assert.deepEqual(suggest('pay my suppliers on friday').candidates, [], 'a card whose notFor matches is never suggested');
  assert.equal(suggest('send new leads to the right salesperson').best, 'lead-triage');
  assert.equal(suggest('approve expense claims under 50').best, 'expense-approval');
  assert.equal(suggest('').candidates.length, 0);
});
