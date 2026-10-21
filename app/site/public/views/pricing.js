// Pricing (#/pricing): the paid line as one rule (SPEC §9.9, decision D2). Decided and not decided are kept apart; no prices.
import { el, t, raw, rich } from '../site.js';
import { statusChip } from '../components/ui.js';

const list = key => el('ul', {}, (raw(key) ?? []).map(x => el('li', {}, x)));
export async function render() {
  return el('div', { dataset: { layout: 'narrow' } },
    el('h1', {}, t('pricing.h1')),
    el('p', { class: 'lead' }, rich('pricing.lead')),
    el('section', { class: 'card done' }, el('h2', {}, t('pricing.freeTitle'), ' ', statusChip('decided')), list('pricing.free'), el('p', { class: 'muted small' }, t('pricing.ssoNote'))),
    el('section', { class: 'card' }, el('h2', {}, t('pricing.teamTitle'), ' ', statusChip('planned')), el('p', {}, t('pricing.teamLead')), list('pricing.team'),
      el('p', { dataset: { status: 'planned' } }, el('a', { href: '#/automations', dataset: { instead: '' } }, t('pricing.teamInstead')))),
    el('section', { class: 'card' }, el('h2', {}, t('pricing.packsTitle'), ' ', statusChip('planned')), el('p', {}, t('pricing.packs')),
      el('p', { dataset: { status: 'planned' } }, el('a', { href: '#/', dataset: { instead: '' } }, t('pricing.packsInstead')))),
    el('section', { class: 'card' }, el('h2', {}, t('pricing.undecidedTitle'), ' ', statusChip('undecided')), el('p', {}, t('pricing.undecided'))),
    el('section', {}, el('h2', {}, t('pricing.whyTitle')), el('p', { class: 'prose' }, t('pricing.why'))),
    el('p', { class: 'muted' }, t('pricing.footer')));
}
