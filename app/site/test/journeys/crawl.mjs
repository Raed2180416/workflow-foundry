// CRAWL (SPEC §16, §17.2): every route in every state, at 1280 and 390 (and 320 for horizontal scroll). For each page: one <h1>,
// the header nav and Help (the harness's fallback accessibility checks), at least one enabled way forward, every internal link
// matching a registered route (read from the page's own router) and leading to a page that is not "not found", every Planned item
// with a working "instead" link, every error panel with a "what to do" action, and no horizontal scroll at 390 or 320 px.
// Screenshots: viewport only, JPEG quality 50: every page of the "on" state at 390, and a few state-specific pages (to keep the set small).
// nice node --test --test-concurrency=1 app/site/test/journeys/crawl.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { journey, closeBrowser, NOW, a11y } from './harness.mjs';
import { invoiceFlowOn, liveInvoices } from '../../../onboarding/test/helpers.mjs';
import { Batches } from '../../../onboarding/batch.mjs';
import { saveSettings } from '../../../onboarding/settings.mjs';

after(closeBrowser);

const IN = { now: new Date(NOW).toISOString() };
const ROUTES = ['/', '/describe', '/make/invoice-chase', '/drafts', '/waiting', '/automations', '/runs', '/connections', '/keys', '/settings', '/connect-agent',
  '/pricing', '/trust', '/docs', '/glossary', '/help', '/claims', '/it-brief', '/import', '/org'];

/** Each state: how to make it, and which pages to screenshot in it. */
const STATES = {
  empty: { make: async () => ({}), shots: ['/', '/automations', '/drafts', '/waiting', '/runs'] },
  draft: { make: async app => { const p = await app.propose({ template: 'invoice-chase', settings: { sendSummary: true, summaryTo: 'me@example.com' }, origin: 'site-form' }); return { proposalId: p.proposalId }; }, shots: [] },
  tested: { make: async app => { const p = await app.propose({ template: 'invoice-chase', settings: { sendSummary: true, summaryTo: 'me@example.com' }, origin: 'site-form' }); await app.dryRun({ proposalId: p.proposalId }); return { proposalId: p.proposalId }; }, shots: [] },
  on: { make: async app => { const p = await invoiceFlowOn(app); liveInvoices(app); return { proposalId: p.proposalId, flowId: p.flowId }; }, shots: 'all' },
  'waiting-action': { make: async app => { const p = await invoiceFlowOn(app); liveInvoices(app); const r = await app.run({ flowId: p.flowId, input: IN }); return { proposalId: p.proposalId, flowId: p.flowId, runId: r.runId }; }, shots: ['/waiting'] },
  'waiting-batch': { make: async app => { const p = await invoiceFlowOn(app); liveInvoices(app); await new Batches(app, { now: () => NOW }).preview(p.flowId); return { proposalId: p.proposalId, flowId: p.flowId }; }, shots: ['/waiting'] },
  'failed-run': { make: async app => { const p = await invoiceFlowOn(app); const r = await app.run({ flowId: p.flowId, input: IN }); return { proposalId: p.proposalId, flowId: p.flowId, runId: r.runId }; }, shots: ['/runs/:runId'] },
  'no-keychain': { env: { FOUNDRY_KEYCHAIN: 'none' }, make: async app => { const p = await invoiceFlowOn(app); return { proposalId: p.proposalId, flowId: p.flowId }; }, shots: ['/keys'] },
  'practice-only': { make: async app => { const p = await invoiceFlowOn(app); liveInvoices(app); saveSettings(app.root, { mode: 'practice-only' }); return { proposalId: p.proposalId, flowId: p.flowId }; }, shots: ['/settings', '/go-live/:flowId'] },
  'org-v1': { make: async () => ({}), org: true, shots: ['/org', '/make/expense-approval'] }
};

function routesFor(ids) {
  const r = [...ROUTES];
  if (ids.proposalId) r.push(`/checked/${ids.proposalId}`);
  if (ids.flowId) r.push(`/go-live/${ids.flowId}`, `/automations/${ids.flowId}`, `/it-brief/${ids.flowId}`, `/make/invoice-chase?flow=${ids.flowId}`);
  if (ids.runId) r.push(`/runs/${ids.runId}`);
  return r;
}
// The "on" state: every listed page, at phone width only (the set stays small); other states: their own pages at both widths.
const shotWanted = (state, route, ids, width) => STATES[state].shots === 'all' ? width < 600 && routesFor(ids).includes(route)
  : STATES[state].shots.some(s => s.replace(':runId', ids.runId ?? '').replace(':flowId', ids.flowId ?? '') === route);

async function crawl(state, { width }) {
  const ids = {};
  const result = { state, width, pages: 0, linksFollowed: 0, problems: [] };
  await journey({ name: `crawl-${state}`, persona: 'crawl', width, height: width < 600 ? 844 : 900, env: STATES[state].env,
    before: async (app, dir) => Object.assign(ids, await STATES[state].make(app, dir)) }, async ({ page, shot, log }) => {
    const origin = new URL(page.url()).origin;
    if (STATES[state].org) await page.evaluate(async () => {
      const h = { 'content-type': 'application/json', 'x-foundry-token': sessionStorage.getItem('foundry-token') };
      const post = async (p, b) => (await fetch(p, { method: 'POST', headers: h, body: JSON.stringify(b) })).json();
      let { map } = await post('/api/org/starter', { start: 'small-team' });
      map.principals.push({ id: 'p-dana', name: 'Dana', kind: 'human', roles: ['approver', 'rule-owner'] });
      const row = map.approvals.find(a => a.actionClass === 'money-out');
      map.parameters.moneyOutApprovalAbove = { value: 250, unit: 'EUR' }; row.aboveParameter = 'moneyOutApprovalAbove'; row.approverPrincipal = 'p-dana';
      map = (await post('/api/org/rule', { map, approvalId: row.id })).map; map.clauses[0].examples.forEach(e => { e.confirmed = true; });
      await post('/api/org/map', { map });
    });
    const queue = routesFor(ids), seen = new Set();
    while (queue.length && seen.size < 90) {
      const route = queue.shift();
      if (seen.has(route)) continue;
      seen.add(route);
      // Mark the current heading, so the wait below sees the new page, not the old one (unless the page is already this route).
      if (!(await page.evaluate(r => location.hash === `#${r}`, route))) {
        await page.evaluate(() => document.querySelectorAll('main h1').forEach(h => h.setAttribute('data-old', '')));
        await page.goto(`${origin}/#${route}`);
      }
      await page.waitForFunction(() => document.querySelector('main h1:not([data-old])') && !document.getElementById('view').hasAttribute('aria-busy'), null, { timeout: 15000 });
      await page.waitForTimeout(60);
      result.pages += 1;
      const r = await page.evaluate(async () => {
        const { ROUTE_PATTERNS } = await import('/site.js');
        const visible = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
        const hrefs = [...new Set([...document.querySelectorAll('a[href^="#/"]')].map(a => a.getAttribute('href')))];
        return {
          h1: document.querySelector('main h1')?.textContent.trim(),
          notFound: !!document.querySelector('main [data-not-found]'),
          hrefs,
          unregistered: hrefs.filter(h => !ROUTE_PATTERNS.some(re => re.test(h.slice(1).split('?')[0]))),
          forward: [...document.querySelectorAll('main a[href], main button:not([disabled])')].filter(visible).length,
          terminal: !!document.querySelector('main [data-terminal]'),
          plannedWithout: [...document.querySelectorAll('[data-status="planned"]')].filter(e => !e.querySelector('[data-instead]')).map(e => e.textContent.trim().slice(0, 60)),
          insteadBroken: [...document.querySelectorAll('[data-instead]')].map(a => a.getAttribute('href')).filter(h => !h?.startsWith('#/') || !ROUTE_PATTERNS.some(re => re.test(h.slice(1).split('?')[0]))),
          panelsWithout: [...document.querySelectorAll('[data-error-panel]')].filter(e => !e.querySelector('[data-error-action] a, [data-error-action] button')).length,
          scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      });
      const where = `${state} ${width} ${route}`;
      if (r.notFound && route !== '/nope') result.problems.push(`${where}: reached "not found"`);
      if (r.unregistered.length) result.problems.push(`${where}: links to unregistered routes ${r.unregistered.join(', ')}`);
      if (!r.forward && !r.terminal) result.problems.push(`${where}: no way forward`);
      if (r.plannedWithout.length) result.problems.push(`${where}: Planned without an "instead" link: ${r.plannedWithout.join(' | ')}`);
      if (r.insteadBroken.length) result.problems.push(`${where}: "instead" links that go nowhere: ${r.insteadBroken.join(', ')}`);
      if (r.panelsWithout) result.problems.push(`${where}: ${r.panelsWithout} error panel(s) without an action`);
      if (r.scroll > 1) result.problems.push(`${where}: scrolls sideways by ${r.scroll}px`);
      if (width < 600) {
        await page.setViewportSize({ width: 320, height: 700 });
        const s320 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (s320 > 1) result.problems.push(`${state} 320 ${route}: scrolls sideways by ${s320}px`);
        await page.setViewportSize({ width, height: 844 });
      }
      const slug = `${state}-${route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 40) || 'home'}`;
      const issues = await a11y(page);
      if (issues.length) result.problems.push(`${where}: accessibility: ${issues.join('; ')}`);
      if (shotWanted(state, route, ids, width)) await shot(slug, { fullPage: false, quality: 50 });
      // Follow every internal link found here (with this state's real ids), so "not found" can't hide behind a link.
      for (const h of r.hrefs) { const p = h.slice(1); if (!seen.has(p) && !queue.includes(p)) queue.push(p); }
      result.linksFollowed = seen.size;
    }
    log.checks = result;
  });
  return result;
}

for (const state of Object.keys(STATES)) {
  test(`CRAWL ${state}: every page has a way forward, real links, honest Planned items and actionable errors (1280 and 390/320)`, async () => {
    const problems = [];
    for (const width of [1280, 390]) problems.push(...(await crawl(state, { width })).problems);
    assert.deepEqual(problems, []);
  });
}
