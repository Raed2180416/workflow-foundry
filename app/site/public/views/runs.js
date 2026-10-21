// Runs (#/runs): every run with its result and whether its record checks out (re-verified on every read).
import { el, t, api } from '../site.js';
import { when } from '../components/dom.js';

export async function render() {
  const o = await api('/api/overview');
  const root = el('div', {}, el('h1', {}, t('runs.title')));
  if (!o.runs.length) { root.append(el('p', { class: 'lead' }, t('runs.empty')), el('div', { class: 'actions' }, el('a', { class: 'button primary', href: '#/automations' }, t('nav.automations')))); return root; }
  root.append(el('p', { class: 'muted' }, t('runs.lead')));
  root.append(el('div', { class: 'table-wrap' }, el('table', {}, el('caption', { class: 'sr-only' }, t('runs.title')),
    el('thead', {}, el('tr', {}, [t('runs.automation'), t('runs.result'), t('runs.when'), t('runs.record'), ''].map(h => el('th', { scope: 'col' }, h)))),
    el('tbody', {}, o.runs.map(r => el('tr', { dataset: { run: r.runId } },
      el('td', {}, r.flowId ?? '?'),
      el('td', { class: r.status === 'succeeded' ? 'ok-text' : ['failed', 'uncertain'].includes(r.status) ? 'bad-text' : 'wait-text' }, t(`run.status.${r.status}`), r.problem ? ` (${r.problem.what})` : ''),
      el('td', {}, when(r.updatedAt)),
      el('td', {}, r.chainVerified ? t('runs.checked', { n: r.events }) : t('runs.notChecked')),
      el('td', {}, el('a', { class: 'button small', href: `#/runs/${r.runId}`, 'aria-label': t('runs.openLabel', { flow: r.flowId, when: when(r.updatedAt) }) }, t('common.open')))))))));
  return root;
}
