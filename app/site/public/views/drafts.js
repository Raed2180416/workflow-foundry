// Drafts (#/drafts): what a live run made, as e-mails the person opens in their own mail app (or copies into webmail, or downloads),
// and chat messages they paste into the channel; they send everything themselves. Foundry sends nothing and cannot see the person's
// mail. "I sent it" is the person's own note, kept in their Foundry folder (P1 walkthrough M9: it was kept in one browser tab's
// storage, so a new session lost it). Webmail users get copy buttons (P2 walkthrough M8: mailto opens a desktop client by default).
import { el, t, api, download, toast, say } from '../site.js';
import { errorPanel } from '../components/ui.js';
import { when } from '../components/dom.js';

const copier = (label, value) => el('button', { type: 'button', class: 'small', on: { click: async () => {
  try { await navigator.clipboard.writeText(value); toast(t('drafts.copied')); } catch { toast(t('snippet.selected')); }
} } }, label);

export async function render({ query }) {
  const { drafts } = await api('/api/drafts');
  const runId = query.get('run');
  const fromRun = runId ? drafts.filter(d => d.runId === runId) : [];
  const shown = fromRun.length ? fromRun : drafts;
  if (!drafts.length) return el('div', { dataset: { layout: 'narrow' } }, el('h1', {}, t('drafts.emptyTitle')), el('p', {}, t('drafts.emptyBody')),
    el('div', { class: 'actions' }, el('a', { class: 'button primary', href: '#/automations' }, t('nav.automations')), el('a', { class: 'button', href: '#/' }, t('common.backHome'))));
  const status = el('div', {});
  const saved = el('p', { class: 'muted small', role: 'status' });
  return el('div', { dataset: { layout: 'narrow' } },
    el('h1', {}, shown.length === 1 ? t('drafts.titleOne') : t('drafts.title', { n: shown.length })),
    el('p', { class: 'lead' }, t('drafts.lead')),
    el('p', {}, t('drafts.webmail')),
    fromRun.length && drafts.length > fromRun.length ? el('p', {}, el('a', { href: '#/drafts' }, t('drafts.showAll', { n: drafts.length }))) : null,
    el('ol', { class: 'items' }, shown.map(d => {
      const box = el('input', { type: 'checkbox', checked: !!d.sent, on: { change: async e => {
        try { await api(`/api/drafts/${encodeURIComponent(d.id)}/sent`, { sent: e.target.checked }); say(e.target.checked ? t('drafts.sentIt') : ''); }
        catch (error) { e.target.checked = !e.target.checked; status.replaceChildren(errorPanel(error)); }
      } } });
      const mark = el('label', { class: 'check-row' }, box, el('span', {}, t('drafts.sentIt')));
      if (d.kind === 'post') return el('li', { dataset: { draft: d.id, kind: 'post' } },
        el('div', { class: 'head' }, el('b', {}, t('drafts.postTitle', { channel: d.to })), el('span', { class: 'muted' }, when(d.at))),
        el('pre', {}, d.body), el('p', { class: 'muted small' }, t('drafts.postNote')),
        el('div', { class: 'actions' }, copier(t('drafts.copyPost'), d.body), mark));
      const dl = el('button', { type: 'button', class: 'small', dataset: { action: 'eml' }, on: { click: async () => {
        try { await download(`/api/drafts/${d.id}.eml`, `draft-${d.id.slice(0, 8)}.eml`); saved.textContent = t('drafts.downloaded'); toast(t('drafts.downloaded')); } catch (error) { status.replaceChildren(errorPanel(error)); }
      } } }, t('drafts.download'));
      return el('li', { dataset: { draft: d.id } },
        el('div', { class: 'head' }, el('span', {}, el('b', {}, t('items.to')), ' ', d.to), el('span', {}, el('b', {}, t('items.subject')), ' ', d.subject), el('span', { class: 'muted' }, when(d.at))),
        el('pre', {}, d.body),
        el('div', { class: 'actions' },
          d.mailto ? el('a', { class: 'button', href: d.mailto, dataset: { action: 'mailto' } }, t('drafts.open')) : el('span', { class: 'muted' }, t('drafts.tooLong')),
          dl, mark),
        el('div', { class: 'copy-row' }, copier(t('drafts.copyTo'), d.to), copier(t('drafts.copySubject'), d.subject ?? ''), copier(t('drafts.copyText'), d.body)));
    })),
    saved,
    el('p', { class: 'muted small' }, t('drafts.sentNote')),
    el('p', { class: 'muted small' }, t('drafts.countsNote')),
    status,
    el('div', { class: 'actions' }, el('a', { class: 'button', href: '#/automations' }, t('nav.automations')), el('a', { class: 'button', href: '#/runs' }, t('nav.runs'))));
}
