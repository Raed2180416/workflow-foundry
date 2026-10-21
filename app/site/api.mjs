// The site's API routes (SPEC §11): thin adapters over FoundryApp and app/onboarding. Each route returns { status?, body } or
// { download: { name, type, body } }; the server (./server.mjs) has already checked the Host header, the token and the body size.
// Nothing here decides on the person's behalf: decisions go through the dashboard's /api/decide (channel 'dashboard') or the batch
// approval below, which the page sends only from a click on a visible card.
import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { FoundryError } from '../../src/data.mjs';
import { loadLibrary, templateById, templateOf, practiceOf, slotsOf, promises } from '../core/library.mjs';
import { describeWorkflow } from '../core/explain.mjs';
import { doctorFull, connectInstructions } from '../cli.mjs';
import { restate } from '../onboarding/form-builder.mjs';
import { suggest, FORMS } from '../onboarding/suggest.mjs';
import { COLUMNS, preview as csvPreview, inputSheets } from '../onboarding/csv.mjs';
import { commit as dataCommit, liveSheets } from '../onboarding/data.mjs';
import { Batches } from '../onboarding/batch.mjs';
import { listDrafts, draft as oneDraft } from '../onboarding/drafts.mjs';
import { loadSettings, saveSettings } from '../onboarding/settings.mjs';
import { Keychain, detectBackend } from '../onboarding/keychain.mjs';
import { Keys } from '../onboarding/keys.mjs';
import { briefData, briefMarkdown, briefHtml } from '../onboarding/brief.mjs';
import { evidenceBundle } from '../onboarding/evidence.mjs';

import { importReport } from '../onboarding/importers.mjs';
import { AuthorityMaps, starter, ruleFromApproval, mapProblems, toConstitutionV0, NOT_ENFORCED } from '../onboarding/authority-map.mjs';
import { generateExamples, flips, exampleProblems } from '../onboarding/rule-examples.mjs';
import { orgPolicy } from '../onboarding/proposal-check.mjs';

/** A weekly calendar reminder that says plainly it is a reminder, not automation (SPEC §1 fix 5, A11). */
export function reminderIcs(title, flowId, date, { day = 'MO', hour = 8 } = {}) {
  const start = new Date(date); start.setUTCDate(start.getUTCDate() + ((8 - start.getUTCDay()) % 7 || 7)); start.setUTCHours(hour, 0, 0, 0);
  const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const clean = s => String(s).replace(/[\\;,]/g, m => `\\${m}`).replace(/\r?\n/g, ' ');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Foundry (local)//Reminder//EN', 'BEGIN:VEVENT', `UID:${flowId}-${stamp(date)}@foundry.local`, `DTSTAMP:${stamp(date)}`,
    `DTSTART:${stamp(start)}`, 'DURATION:PT15M', `RRULE:FREQ=WEEKLY;BYDAY=${day}`, `SUMMARY:${clean(`Run "${title}" in Foundry`)}`,
    `DESCRIPTION:${clean('This is a reminder, not automation: nothing runs by itself. Open Foundry, look at the list it would make, and say yes or no.')}`,
    'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const CLAIMS = JSON.parse(readFileSync(path.join(here, 'claims.json'), 'utf8'));
const PRACTICE_DATA_TTL = 30 * 60 * 1000;
const ok = body => ({ body });
const bad = (code, message, extra = {}) => { throw Object.assign(new FoundryError(code, message), extra); };
const str = (v, name, max = 200) => { if (typeof v !== 'string' || !v || v.length > max) bad('BAD_REQUEST', `${name} is required`); return v; };

/** The cards the home page and the make page show: presentation (forms.json) over the template (the authority). */
export function siteTemplates(library = loadLibrary()) {
  return FORMS.order.map(id => {
    const t = templateById(id, library), f = FORMS.templates[id];
    if (!t) return null;
    const world = practiceOf(t);
    const defaults = Object.fromEntries(t.slots.map(s => [s.name, f.slots?.[s.name]?.siteDefault ?? s.default ?? null]));
    return {
      id, card: f.card, summary: f.summary, title: t.title, whenToUse: t.whenToUse, notFor: t.notFor, noun: f.noun, decider: f.decider ?? null, usesAI: false,
      sheets: inputSheets(id).map(sheet => ({ sheet, plain: COLUMNS.sheets[`${id}/${sheet}`].plain, rowNoun: COLUMNS.sheets[`${id}/${sheet}`].rowNoun,
        columns: COLUMNS.sheets[`${id}/${sheet}`].columns.map(c => ({ name: c.name, plain: c.plain, type: c.type, optional: !!c.optional })) })),
      slots: t.slots.map(s => {
        const p = f.slots?.[s.name] ?? {};
        return { name: s.name, type: s.type, values: s.values ?? null, default: s.default ?? null, siteDefault: p.siteDefault ?? null, kind: p.kind ?? (s.ask ? 'ask' : 'setting'),
          label: p.label ?? s.question ?? s.name, unit: p.unit ?? null, help: p.help ?? null, question: s.question ?? null, why: s.askWhy ?? null, harm: s.ask ?? null,
          skip: p.skip ?? null, askWhen: s.askWhen ?? null, inputType: p.inputType ?? null, placeholder: p.placeholder ?? null, offLabel: p.offLabel ?? null, emptyLabel: p.emptyLabel ?? null,
          addLabel: p.addLabel ?? null, min: s.min ?? null, max: s.max ?? null, maxItems: s.maxItems ?? null,
          fields: s.fields ? s.fields.map(x => ({ name: x.name, type: x.type, values: x.values ?? null, ...(p.fields?.[x.name] ?? {}) })) : null };
      }),
      defaults,
      pretend: Object.fromEntries(Object.entries(world.sheets).map(([k, rows]) => [k, rows.slice(0, 8)])),
      promises: promises(t, Object.fromEntries(t.slots.map(s => [s.name, defaults[s.name] ?? (s.type === 'email' ? 'the address you give' : null)])))
    };
  }).filter(Boolean);
}

export function createSiteApi(app, options = {}) {
  const now = options.now ?? (() => Date.now());
  const workspace = options.workspace ?? app.root;
  const batches = new Batches(app, { now });
  const keychain = options.keychain ?? new Keychain({ backend: detectBackend() });
  const keys = new Keys({ root: app.root, keychain, checkBaseUrl: options.keyCheckBaseUrl ?? null, fetchImpl: options.fetchImpl ?? globalThis.fetch, now });
  const practiceData = new Map();
  const siteDir = path.join(app.root, 'site');
  const milestonesFile = path.join(siteDir, 'milestones.json');
  const library = loadLibrary();
  const orgMaps = new AuthorityMaps(app.root, { now });
  // The authority map bounds card settings at proposal time (prefill, refuse a widening); the site's form builder asks it each time.
  const emailSlots = Object.fromEntries(library.map(t => [t.id, t.slots.filter(s => s.type === 'email').map(s => s.name)]));
  const policy = orgPolicy(app.root, { emailSlots });
  if (app.builder?.form && !app.builder.form.policy) app.builder.form.policy = policy;

  function milestone(name) {
    try {
      mkdirSync(siteDir, { recursive: true, mode: 0o700 });
      const m = existsSync(milestonesFile) ? JSON.parse(readFileSync(milestonesFile, 'utf8')) : {};
      if (!m[name]) { m[name] = new Date(now()).toISOString(); const tmp = `${milestonesFile}.tmp-${process.pid}`; writeFileSync(tmp, JSON.stringify(m, null, 2), { mode: 0o600 }); renameSync(tmp, milestonesFile); }
    } catch { /* a local timing note only; never blocks the person */ }
  }
  const head = flowId => { try { return app.foundry.store.workflow(flowId); } catch (error) { if (error.code === 'NOT_FOUND') return null; throw error; } };
  const usesAI = builderId => !!builderId && !/^template-form\/|^stub-template-matcher\//.test(builderId);

  function automations() {
    const listed = app.list();
    const flows = listed.flows.map(f => {
      const h = head(f.flowId), t = h ? templateOf(h.workflow) : null;
      return { ...f, template: t?.id ?? null, card: t ? FORMS.templates[t.id]?.card ?? t.title : f.title, data: t ? liveSheets(app, t.id) : null };
    });
    const drafts = listed.proposals.map(p => {
      const prop = app.foundry.store.proposal(p.proposalId), t = templateOf(prop.workflow);
      return { ...p, title: prop.workflow.title, template: t?.id ?? null, card: t ? FORMS.templates[t.id]?.card ?? t.title : prop.workflow.title };
    });
    return { flows, drafts, waitingForYou: listed.waitingForYou + batches.open().length };
  }

  function proposalView(proposalId) {
    const e = app.explain({ proposalId });
    const p = app.foundry.store.proposal(proposalId), t = templateOf(p.workflow);
    const dry = app.ledger.latestDryRun(proposalId);
    const h = head(p.workflow.id);
    return { ...e, flowId: p.workflow.id, version: p.workflow.version, title: p.workflow.title, template: t?.id ?? null, card: t ? FORMS.templates[t.id]?.card : null,
      builder: p.workflow.metadata?.tags?.find(x => x.startsWith('builder:'))?.slice(8) ?? null, usesAI: usesAI(p.workflow.metadata?.tags?.find(x => x.startsWith('builder:'))?.slice(8)),
      slots: slotsOf(p.workflow), promises: t ? promises(t, slotsOf(p.workflow)) : null, dryRun: dry ? { passed: dry.passed, at: new Date(dry.at).toISOString(), ...dry.body, practiceDir: undefined } : null,
      basedOn: h && h.hash !== p.workflowHash ? { version: h.workflow.version, active: !!app.ledger.approvedFor(h.workflow.id, h.hash) } : null,
      active: !!app.ledger.approvedFor(p.workflow.id, p.workflowHash), sheets: t ? inputSheets(t.id) : [] };
  }

  async function handle(method, url, body) {
    const p = url.pathname;
    let m;
    // ------------------------------------------------------------------ machine and agents
    if (method === 'GET' && p === '/api/doctor') {
      const d = await doctorFull({ workspace, consent: url.searchParams.get('consent') === '1' });
      return ok({ ...d, settings: loadSettings(app.root) });
    }
    if (method === 'GET' && p === '/api/connect') return ok({ ...connectInstructions(workspace), workspace });
    if (method === 'GET' && p === '/api/claims') return ok(CLAIMS);
    if (method === 'GET' && p === '/api/milestones') { milestone('firstOpened'); return ok(existsSync(milestonesFile) ? JSON.parse(readFileSync(milestonesFile, 'utf8')) : {}); }
    // ------------------------------------------------------------------ cards, words, settings -> a draft
    if (method === 'GET' && p === '/api/templates') return ok({ templates: siteTemplates(library) });
    if (method === 'POST' && p === '/api/suggest') return ok(suggest(String(body.text ?? '').slice(0, 2000)));
    if (method === 'POST' && p === '/api/restate') return ok(restate({ template: str(body.template, 'template', 64), settings: body.settings ?? {}, library, policy }));
    if (method === 'POST' && p === '/api/propose') {
      // Words alone go to an AI builder only when the person allowed one (Settings) and Foundry was started with it (Preview).
      const aiWords = !body.template && !body.flowId && typeof body.request === 'string' && loadSettings(app.root).allowedAI === 'mercury' && /^mercury-worker\//.test(app.builder?.text?.id ?? '');
      if (!body.template && !body.flowId && !aiWords) bad('BAD_REQUEST', 'Pick a card first: the site builds from a card and its settings');
      const r = await app.propose({ template: body.template ?? undefined, settings: body.settings ?? {}, answers: body.answers ?? {}, flowId: body.flowId ?? null,
        request: typeof body.request === 'string' ? body.request.slice(0, 30000) : undefined, origin: 'site-form' });
      return ok({ ...r, usesAI: usesAI(r.builder) });
    }
    if (method === 'GET' && (m = p.match(/^\/api\/proposals\/([A-Za-z0-9-]{8,64})$/))) return ok(proposalView(m[1]));
    if (method === 'POST' && p === '/api/practice') {
      const proposalId = str(body.proposalId, 'proposalId', 64);
      let sheets = null;
      if (body.practiceDataId) {
        const d = practiceData.get(body.practiceDataId);
        if (!d || d.expires < now()) bad('NOT_FOUND', 'That list has expired. Drop the file again.');
        sheets = d.sheets;
      }
      const r = await app.dryRun({ proposalId, sheets });
      if (r.passed) milestone('firstVerified');
      return ok(r);
    }
    if (method === 'POST' && p === '/api/request-approval') return ok(app.requestApproval({ proposalId: str(body.proposalId, 'proposalId', 64) }));
    if (method === 'POST' && p === '/api/run') {
      const flowId = str(body.flowId, 'flowId', 64), h = head(flowId);
      const input = body.input ?? (h && templateOf(h.workflow) ? { now: new Date(now()).toISOString() } : null);
      if (!input) bad('BAD_REQUEST', 'This automation needs an input');
      return ok(await app.run({ flowId, input }));
    }
    // ------------------------------------------------------------------ automations
    if (method === 'GET' && p === '/api/automations') return ok(automations());
    if (method === 'GET' && (m = p.match(/^\/api\/automations\/([A-Za-z][A-Za-z0-9_-]{0,63})$/))) {
      const flowId = m[1], h = head(flowId);
      const props = app.foundry.store.proposals().filter(x => x.workflow.id === flowId);
      if (!h && !props.length) bad('NOT_FOUND', `No automation named ${flowId}`);
      const wf = h?.workflow ?? props[0].workflow, t = templateOf(wf);
      const runs = app.foundry.store.runs().filter(r => r.workflowId === flowId).slice(0, 50).map(r => ({ runId: r.id, status: r.status, at: r.updatedAt, workflowHash: r.workflowHash }));
      return ok({ flowId, title: wf.title, card: t ? FORMS.templates[t.id]?.card : wf.title, template: t?.id ?? null, version: h?.workflow.version ?? null, workflowHash: h?.hash ?? null,
        active: h ? !!app.ledger.approvedFor(flowId, h.hash) : false, slots: slotsOf(wf), summary: describeWorkflow(wf, app.registry), promises: t ? promises(t, slotsOf(wf)) : null,
        drafts: props.filter(x => x.status === 'proposed').map(x => ({ proposalId: x.id, version: x.workflow.version, dryRun: app.ledger.latestDryRun(x.id)?.passed ?? null })),
        data: t ? liveSheets(app, t.id) : null, runs, approvals: app.ledger.forFlow(flowId) });
    }
    // ------------------------------------------------------------------ the person's own data
    if (method === 'POST' && p === '/api/data/preview') return ok(csvPreview({ template: str(body.template, 'template', 64), sheet: str(body.sheet, 'sheet', 41), text: String(body.csv ?? '') }));
    if (method === 'POST' && p === '/api/data/commit') {
      const target = body.target === 'live' ? 'live' : 'practice';
      const r = dataCommit(app, { template: str(body.template, 'template', 64), sheet: str(body.sheet, 'sheet', 41), text: String(body.csv ?? ''), mapping: body.mapping, answers: body.answers ?? {}, target });
      if (target === 'practice') {
        const id = randomUUID(), prior = body.practiceDataId ? practiceData.get(body.practiceDataId) : null;
        practiceData.set(id, { sheets: { ...(prior?.sheets ?? {}), [r.sheet]: r.data }, expires: now() + PRACTICE_DATA_TTL });
        const { data, ...rest } = r;
        return ok({ ...rest, practiceDataId: id });
      }
      return ok(r);
    }
    if (method === 'GET' && (m = p.match(/^\/api\/data\/([a-z][a-z0-9-]{0,63})$/))) { if (!templateById(m[1], library)) bad('NOT_FOUND', 'No such card'); return ok({ template: m[1], sheets: liveSheets(app, m[1]) }); }
    // ------------------------------------------------------------------ exact-list approval and drafts
    if (method === 'POST' && p === '/api/batch/preview') {
      const r = await batches.preview(str(body.flowId, 'flowId', 64));
      return ok(r);
    }
    if (method === 'POST' && p === '/api/batch/approve') {
      const r = await batches.approve(str(body.batchId, 'batchId', 64), { channel: 'dashboard' });
      if (r.ok && r.made.length) milestone('firstLive');
      return ok(r);
    }
    if (method === 'POST' && p === '/api/batch/decline') return ok(batches.decline(str(body.batchId, 'batchId', 64), { channel: 'dashboard' }));
    if (method === 'GET' && p === '/api/batches') return ok({ open: batches.open() });
    if (method === 'GET' && (m = p.match(/^\/api\/batches\/([A-Za-z0-9-]{8,64})$/))) return ok(batches.get(m[1]));
    if (method === 'GET' && p === '/api/drafts') return ok({ drafts: listDrafts(app) });
    if (method === 'GET' && (m = p.match(/^\/api\/drafts\/([a-f0-9]{16,64})\.eml$/))) { const d = oneDraft(app, m[1]); return { download: { name: `draft-${m[1].slice(0, 8)}.eml`, type: 'message/rfc822', body: d.eml } }; }
    // ------------------------------------------------------------------ settings and keys
    if (method === 'GET' && p === '/api/settings') return ok(loadSettings(app.root));
    if (method === 'POST' && p === '/api/settings') return ok(saveSettings(app.root, body));
    if (method === 'GET' && p === '/api/keys') return ok(keys.status());
    if (method === 'POST' && p === '/api/keys') { const r = await keys.save(str(body.provider, 'provider', 40), body.key); return ok(r); }
    if (method === 'DELETE' && (m = p.match(/^\/api\/keys\/([a-z]{2,40})$/))) return ok(keys.remove(m[1]));
    // ------------------------------------------------------------------ IT brief and evidence
    if (method === 'GET' && (m = p.match(/^\/api\/brief(?:\/([A-Za-z][A-Za-z0-9_-]{0,63}))?\.(md|html|json)$/))) {
      const b = briefData(app, { flowId: m[1] ?? null, connect: connectInstructions(workspace), date: new Date(now()) });
      if (m[2] === 'json') return ok(b);
      const name = `foundry-it-brief${m[1] ? `-${m[1]}` : ''}.${m[2]}`;
      return { download: { name, type: m[2] === 'md' ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8', body: m[2] === 'md' ? briefMarkdown(b) : briefHtml(b) } };
    }
    if (method === 'GET' && (m = p.match(/^\/api\/evidence\/([A-Za-z0-9-]{1,64})\.json$/))) {
      const e = evidenceBundle(app, m[1], { batches, date: new Date(now()) });
      return { download: { name: `foundry-evidence-${m[1].slice(0, 8)}.json`, type: 'application/json; charset=utf-8', body: JSON.stringify(e, null, 2) } };
    }
    if (method === 'GET' && (m = p.match(/^\/api\/evidence\/([A-Za-z0-9-]{1,64})$/))) return ok(evidenceBundle(app, m[1], { batches, date: new Date(now()) }));
    // ------------------------------------------------------------------ bring what you have; a calendar reminder (not automation)
    if (method === 'POST' && p === '/api/import/n8n') return ok(importReport(String(body.json ?? '')));
    if (method === 'GET' && (m = p.match(/^\/api\/ics\/([A-Za-z][A-Za-z0-9_-]{0,63})\.ics$/))) {
      const h = head(m[1]); if (!h) bad('NOT_FOUND', `No automation named ${m[1]}`);
      return { download: { name: `${m[1]}-reminder.ics`, type: 'text/calendar; charset=utf-8', body: reminderIcs(h.workflow.title, m[1], new Date(now())) } };
    }
    // ------------------------------------------------------------------ who decides what (authority map; checked at proposal time, not enforced at run time)
    if (method === 'GET' && p === '/api/org/map') {
      const cur = orgMaps.current();
      return ok({ current: cur, versions: orgMaps.versions(), chain: orgMaps.verify(), notEnforced: NOT_ENFORCED, ...(cur ? mapProblems(cur.map) : { problems: [], warnings: [] }) });
    }
    if (method === 'POST' && p === '/api/org/starter') return ok({ map: starter(String(body.start ?? ''), { now: new Date(now()) }) });
    if (method === 'POST' && p === '/api/org/rule') { const map = body.map; map.clauses = [...map.clauses, ruleFromApproval(map, str(body.approvalId, 'approvalId', 40))]; return ok({ map }); }
    if (method === 'POST' && p === '/api/org/examples') {
      const map = body.map, c = map.clauses.find(x => x.id === body.clauseId); if (!c) bad('NOT_FOUND', 'No such rule');
      return ok({ examples: generateExamples(c, map) });
    }
    if (method === 'POST' && p === '/api/org/validate') { const v = mapProblems(body.map); return ok({ ...v, flips: v.problems.length && v.problems[0].startsWith('The document') ? [] : flips(body.map), open: exampleProblems(body.map) }); }
    if (method === 'POST' && p === '/api/org/map') { const r = orgMaps.save(body.map, { signer: 'you' }); return ok(r); }
    if (method === 'GET' && p === '/api/org/v0.json') { const cur = orgMaps.current(); if (!cur) bad('NOT_FOUND', 'Save a version first'); return { download: { name: 'constitution-v0.json', type: 'application/json; charset=utf-8', body: JSON.stringify(toConstitutionV0(cur.map), null, 2) } }; }
    // ------------------------------------------------------------------ wave 2 modules register here
    for (const extra of options.extraRoutes ?? []) { const r = await extra(method, url, body, { app, now, workspace }); if (r) return r; }
    return null;
  }
  return { handle, batches, keys, milestone };
}
