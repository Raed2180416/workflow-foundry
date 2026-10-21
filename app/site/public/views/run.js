// One run (#/runs/:runId): headline, the failed step and what to do, "Done means" ticks, the record check, the timeline, cost, the
// honesty line, and the evidence download an auditor can use (SPEC §7.4 P5, §9.8).
import { el, t, api, download, toast } from '../site.js';
import { checkList, errorPanel, statusChip } from '../components/ui.js';
import { when } from '../components/dom.js';

export async function render({ params }) {
  const runId = params[0];
  const d = await api(`/api/runs/${encodeURIComponent(runId)}`);
  const status = el('div', {});
  const ev = el('button', { type: 'button', class: 'primary', dataset: { action: 'evidence' } }, t('run.evidence'));
  ev.addEventListener('click', async () => { ev.setAttribute('aria-busy', 'true'); try { await download(`/api/evidence/${runId}.json`, `foundry-evidence-${runId.slice(0, 8)}.json`); toast(t('run.evidenceDone')); } catch (error) { status.replaceChildren(errorPanel(error)); } ev.removeAttribute('aria-busy'); });
  return el('div', {},
    el('p', { class: 'muted' }, el('a', { href: '#/runs' }, t('run.back'))),
    el('h1', {}, d.headline),
    el('p', {}, t('run.of', { flow: d.flowId }), ' · ', d.progress, ' · ', t('run.cost', { usd: (d.costUsd ?? 0).toFixed(4), calls: d.modelCalls?.count ?? 0 })),
    d.problem ? el('div', { class: 'banner bad' }, el('p', {}, el('b', {}, d.problem.what)), el('p', {}, d.problem.next), d.failedStep ? el('p', {}, t('run.failedStep', { step: d.failedStep })) : null) : null,
    d.pendingApprovals?.length ? el('p', { class: 'banner wait' }, t('run.waiting'), ' ', el('a', { href: '#/waiting' }, t('nav.waiting'))) : null,
    el('h2', {}, t('turnon.done_means')), checkList(d.checks),
    el('section', { class: d.chain.verified ? 'banner ok' : 'banner bad', dataset: { record: d.chain.verified ? 'verified' : 'broken' } },
      el('p', {}, d.chain.verified ? statusChip('works') : statusChip('limit'), ' ', d.chain.verified ? t('run.recordOk', { n: d.chain.events }) : t('run.recordBad', { reason: d.chain.reason ?? '' })),
      el('details', {}, el('summary', {}, t('common.showDetails')), el('p', { class: 'small' }, t('run.chainHead', { hash: d.chain.head ?? '' })))),
    el('div', { class: 'actions' }, ev), status,
    el('section', {}, el('h2', {}, t('run.gapsTitle')), el('ul', {}, ['decisions', 'transcripts', 'anchor', 'secondPerson'].map(k => el('li', {}, t(`run.gaps.${k}`))))),
    el('details', {}, el('summary', {}, t('run.timeline', { n: d.timeline.length })),
      el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, [t('run.seq'), t('runs.when'), t('run.event'), t('run.step')].map(h => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, d.timeline.map(e => el('tr', {}, el('td', {}, String(e.seq)), el('td', {}, when(e.at)), el('td', {}, e.type), el('td', {}, e.step ?? '')))))))
    ,
    el('p', { class: 'muted' }, t('run.honesty')));
}
