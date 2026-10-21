// Drafts (#/drafts): what a live run made, as e-mails the person opens in their own mail app or downloads, and sends themselves.
// Foundry sends nothing and cannot see the person's mail; "I sent it" is the person's own note, kept in this browser only.
import { el, t, api, download, toast } from '../site.js';
import { errorPanel } from '../components/ui.js';
import { when } from '../components/dom.js';

const sentKey = 'foundry-sent';
const readSent = () => { try { return new Set(JSON.parse(localStorage.getItem(sentKey) ?? '[]')); } catch { return new Set(); } };
const writeSent = set => { try { localStorage.setItem(sentKey, JSON.stringify([...set].slice(-500))); } catch { /* storage off: the tick lasts for this view */ } };

export async function render({ query }) {
  const { drafts } = await api('/api/drafts');
  const runId = query.get('run');
  const sent = readSent();
  const fromRun = runId ? drafts.filter(d => d.runId === runId) : [];
  const shown = fromRun.length ? fromRun : drafts;
  if (!drafts.length) return el('div', { dataset: { layout: 'narrow' } }, el('h1', {}, t('drafts.emptyTitle')), el('p', {}, t('drafts.emptyBody')),
    el('div', { class: 'actions' }, el('a', { class: 'button primary', href: '#/automations' }, t('nav.automations')), el('a', { class: 'button', href: '#/' }, t('common.backHome'))));
  const status = el('div', {});
  return el('div', { dataset: { layout: 'narrow' } },
    el('h1', {}, t('drafts.title', { n: shown.length })),
    el('p', { class: 'lead' }, t('drafts.lead')),
    fromRun.length && drafts.length > fromRun.length ? el('p', {}, el('a', { href: '#/drafts' }, t('drafts.showAll', { n: drafts.length }))) : null,
    el('ol', { class: 'items' }, shown.map(d => {
      const box = el('input', { type: 'checkbox', checked: sent.has(d.id), on: { change: e => { const s = readSent(); if (e.target.checked) s.add(d.id); else s.delete(d.id); writeSent(s); } } });
      const dl = el('button', { type: 'button', class: 'small', dataset: { action: 'eml' }, on: { click: async () => { try { await download(`/api/drafts/${d.id}.eml`, `draft-${d.id.slice(0, 8)}.eml`); toast(t('drafts.downloaded')); } catch (error) { status.replaceChildren(errorPanel(error)); } } } }, t('drafts.download'));
      return el('li', { dataset: { draft: d.id } },
        el('div', { class: 'head' }, el('span', {}, el('b', {}, t('items.to')), ' ', d.to), el('span', {}, el('b', {}, t('items.subject')), ' ', d.subject), el('span', { class: 'muted' }, when(d.at))),
        el('pre', {}, d.body),
        el('div', { class: 'actions' },
          d.mailto ? el('a', { class: 'button', href: d.mailto, dataset: { action: 'mailto' } }, t('drafts.open')) : el('span', { class: 'muted' }, t('drafts.tooLong')),
          dl, el('label', { class: 'check-row' }, box, el('span', {}, t('drafts.sentIt')))));
    })),
    el('p', { class: 'muted small' }, t('drafts.sentNote')),
    status,
    el('div', { class: 'actions' }, el('a', { class: 'button', href: '#/automations' }, t('nav.automations')), el('a', { class: 'button', href: '#/runs' }, t('nav.runs'))));
}
