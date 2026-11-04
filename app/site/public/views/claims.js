// What we can show (#/claims): every claim the site makes, with its status, what kind of evidence it is, its date, and the file in
// the repository it comes from (SPEC §17.3). A claim link elsewhere on the site lands here.
import { el, t, claims, api } from '../site.js';
import { statusChip, statusOf } from '../components/ui.js';

// The cited lines (honesty review M11: app/site/test/claims.test.mjs checks that each claim's numbers and quote are in them).
const lines = s => s.lines?.length ? `; lines ${s.lines.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ')}` : '';

export async function render({ query }) {
  // ?claim=, not ?c=: the shell takes ?c= out of the address as a one-time code (security review H1), so a claim link named that way lost
  // its claim before this page saw it (UX review m15).
  const all = claims(), focus = query.get('claim');
  // Which copy of Foundry these claims are about (P5 walkthrough M16: a repository path without a commit can't be checked).
  const build = await api('/api/build').catch(() => null);
  const node = el('div', { dataset: { layout: 'narrow' } }, el('h1', {}, t('claims.h1')), el('p', { class: 'lead' }, t('claims.lead')),
    el('p', { class: 'muted small' }, build?.commit ? t('claims.commit', { commit: build.commit }) : t('claims.noCommit')),
    Object.entries(all).map(([id, c]) => el('section', { class: `card ${id === focus ? 'emph' : ''}`, id: `claim-${id}`, dataset: { claimCard: id } },
      el('h2', { class: 'h3' }, c.short, ' ', statusChip(statusOf(c.status))),
      el('p', {}, c.text), c.qualifier ? el('p', { class: 'muted' }, c.qualifier) : null,
      el('dl', { class: 'facts' }, el('dt', {}, t('claims.evidence')), el('dd', {}, t(`claims.kinds.${c.evidence}`)), el('dt', {}, t('claims.date')), el('dd', {}, c.date),
        el('dt', {}, t('claims.sourceFile')), [c.source, ...(c.source.also ?? [])].map(s => el('dd', { dataset: { claimSource: s.path } }, el('code', {}, s.path), ` (${s.anchor}${lines(s)})`))))),
    el('div', { class: 'actions' }, el('a', { class: 'button primary', href: '#/' }, t('common.backHome')), el('a', { class: 'button', href: '#/trust' }, t('footer.it'))));
  // UX review m15: the shell scrolls to and focuses this part once the page is in the document (a microtask here ran before that, and the
  // shell's scroll to the top ran after it).
  if (focus && all[focus]) node.dataset.focus = `#claim-${focus}`;
  return node;
}
