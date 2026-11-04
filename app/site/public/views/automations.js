// Your automations (#/automations): each one with On or Off, its version, runs and last result; drafts with their test state.
import { el, t, api } from '../site.js';
import { statusChip } from '../components/ui.js';
import { when } from '../components/dom.js';
import { removeButton } from './automation.js';

const RESULT = s => t(`run.status.${s}`) === `run.status.${s}` ? s : t(`run.status.${s}`);

export async function render() {
  const a = await api('/api/automations');
  const root = el('div', {}, el('h1', {}, t('automations.title')));
  if (!a.flows.length && !a.drafts.length) {
    root.append(el('p', { class: 'lead' }, t('automations.empty')), el('div', { class: 'actions' }, el('a', { class: 'button primary', href: '#/' }, t('automations.pick'))));
    return root;
  }
  if (a.flows.length) root.append(el('div', { class: 'grid' }, a.flows.map(f => {
    const headId = `flow-${f.flowId}`;
    const dataLine = f.data ? Object.entries(f.data).map(([sheet, d]) => d ? t('automations.dataHave', { sheet, rows: d.rows }) : t('automations.dataMissing', { sheet })).join(' · ') : '';
    return el('article', { class: `card ${f.active ? 'done' : ''}`, 'aria-labelledby': headId, dataset: { flow: f.flowId } },
      el('h2', { id: headId, class: 'h3' }, f.card),
      el('p', {}, f.active ? statusChip('works') : null, ' ', f.active ? t('automations.on') : t('automations.off'), ' · ', t('automations.version', { version: f.version })),
      el('p', { class: 'muted' }, t('automations.runs', { n: f.runs }), f.lastRun ? ` · ${t('automations.last', { result: RESULT(f.lastRun.status), when: when(f.lastRun.at) })}` : ''),
      dataLine ? el('p', { class: 'muted small' }, dataLine) : null,
      el('div', { class: 'actions' }, el('a', { class: 'button primary', href: `#/automations/${f.flowId}` }, t('common.open')),
        f.active ? el('a', { class: 'button', href: `#/go-live/${f.flowId}` }, t('automations.runNow')) : null));
  })));
  if (a.drafts.length) {
    root.append(el('h2', { id: 'drafts-h' }, t('automations.draftsTitle')), el('p', { class: 'muted' }, t('automations.draftsLead')));
    root.append(el('div', { class: 'grid' }, a.drafts.map(d => el('article', { class: 'card practice', 'aria-labelledby': `draft-${d.proposalId}`, dataset: { draft: d.proposalId } },
      el('h3', { id: `draft-${d.proposalId}` }, d.card, ' ', t('automations.version', { version: d.version })),
      el('p', {}, d.dryRun === true ? t('automations.draftPassed') : d.dryRun === false ? t('automations.draftFailed') : t('automations.draftUntested')),
      el('div', { class: 'actions' }, el('a', { class: 'button', href: `#/checked/${d.proposalId}`, 'aria-describedby': `draft-${d.proposalId}` }, t('common.open')), removeButton(d.proposalId))))));
  }
  return root;
}
