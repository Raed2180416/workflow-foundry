// Drafts (#/drafts): what a live run made, as e-mails the person opens in their own mail app (or copies into webmail, or downloads),
// and chat messages they paste into the channel; they send everything themselves. Foundry sends nothing and cannot see the person's
// mail. "I sent it" is the person's own note, kept in their Foundry folder (P1 walkthrough M9: it was kept in one browser tab's
// storage, so a new session lost it). Webmail users get copy buttons (P2 walkthrough M8: mailto opens a desktop client by default).
import { el, t, api, download, toast, say } from '../site.js';
import { showError, copyOrSelect, once } from '../components/ui.js';
import { when, id as uid } from '../components/dom.js';

// A copy button for one part of a draft. Where the browser won't copy, that part is selected first, so "press Ctrl+C" is true (UX review
// m2). Each button is described by its draft's heading, so "Copy text" says which draft (m13).
const copier = (label, value, node, describedBy) => el('button', { type: 'button', class: 'small', 'aria-describedby': describedBy, on: { click: () => copyOrSelect(value, node, t('drafts.copied')) } }, label);

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
      const headId = uid('draft');
      const box = el('input', { type: 'checkbox', checked: !!d.sent, 'aria-describedby': headId, on: { change: async e => {
        try { await api(`/api/drafts/${encodeURIComponent(d.id)}/sent`, { sent: e.target.checked }); say(e.target.checked ? t('drafts.sentSay') : t('drafts.notSentSay')); }
        catch (error) { e.target.checked = !e.target.checked; showError(status, error, { notDone: t('drafts.markNotSaved') }); }
      } } });
      const mark = el('label', { class: 'check-row' }, box, el('span', {}, t('drafts.sentIt')));
      const body = el('pre', {}, d.body);
      if (d.kind === 'post') return el('li', { dataset: { draft: d.id, kind: 'post' } },
        el('div', { class: 'head', id: headId }, el('b', {}, t('drafts.postTitle', { channel: d.to })), el('span', { class: 'muted' }, when(d.at))),
        body, el('p', { class: 'muted small' }, t('drafts.postNote')),
        el('div', { class: 'actions' }, copier(t('drafts.copyPost'), d.body, body, headId), mark));
      const dl = el('button', { type: 'button', class: 'small', 'aria-describedby': headId, dataset: { action: 'eml' }, on: { click: once(async () => {
        try { await download(`/api/drafts/${d.id}.eml`, `draft-${d.id.slice(0, 8)}.eml`); saved.textContent = t('drafts.downloaded'); toast(t('drafts.downloaded')); } catch (error) { showError(status, error, { notDone: t('errors.noFile') }); }
      }) } }, t('drafts.download'));
      const toText = el('span', {}, d.to), subjectText = el('span', {}, d.subject ?? '');
      return el('li', { dataset: { draft: d.id } },
        el('div', { class: 'head', id: headId }, el('span', {}, el('b', {}, t('items.to')), ' ', toText), el('span', {}, el('b', {}, t('items.subject')), ' ', subjectText), el('span', { class: 'muted' }, when(d.at))),
        body,
        el('div', { class: 'actions' },
          d.mailto ? el('a', { class: 'button', href: d.mailto, 'aria-describedby': headId, dataset: { action: 'mailto' } }, t('drafts.open')) : el('span', { class: 'muted' }, t('drafts.tooLong')),
          dl, mark),
        el('div', { class: 'copy-row' }, copier(t('drafts.copyTo'), d.to, toText, headId), copier(t('drafts.copySubject'), d.subject ?? '', subjectText, headId), copier(t('drafts.copyText'), d.body, body, headId)));
    })),
    saved,
    el('p', { class: 'muted small' }, t('drafts.sentNote')),
    el('p', { class: 'muted small' }, t('drafts.countsNote')),
    status,
    el('div', { class: 'actions' }, el('a', { class: 'button', href: '#/automations' }, t('nav.automations')), el('a', { class: 'button', href: '#/runs' }, t('nav.runs'))));
}
