// The box's answer (#/describe): a keyword match against the cards, $0 and local. It never builds anything (SPEC R1, §9.2).
import { el, t, api, templates, memory } from '../site.js';
import { cardFor, suggestBox } from './home.js';

export async function render() {
  const words = memory.describe ?? '';
  const list = await templates();
  if (!words) return el('div', { dataset: { layout: 'narrow' } }, el('h1', {}, t('describe.emptyTitle')), suggestBox(), el('p', {}, el('a', { href: '#/' }, t('describe.showAll'))));
  const r = await api('/api/suggest', { text: words });
  const byId = Object.fromEntries(list.map(x => [x.id, x]));
  const said = el('p', { class: 'muted' }, t('describe.youWrote'), ' ', el('q', {}, words));
  if (r.best) {
    const best = byId[r.best];
    return el('div', {},
      el('h1', {}, t('describe.match', { card: best.card })), said, el('p', {}, t('describe.method')),
      el('div', { class: 'grid' }, cardFor(best)),
      el('div', { class: 'actions' }, el('a', { class: 'button primary', href: `#/make/${best.id}` }, t('describe.useThis')), el('a', { class: 'button', href: '#/' }, t('describe.notThis'))),
      suggestBox({ value: words }));
  }
  // A match on common words only ("approval", "remind") is never "this sounds like" (P3 walkthrough B1): it says so.
  if (r.candidates.length) return el('div', {},
    el('h1', {}, r.weakOnly ? t('describe.notAMatch') : t('describe.close')), said, el('p', {}, t('describe.method')),
    r.weakOnly ? el('p', { class: 'banner wait' }, t('describe.weakBody')) : null,
    el('div', { class: 'grid' }, r.candidates.map(c => cardFor(byId[c.id]))),
    el('div', { class: 'actions' }, el('a', { class: 'button', href: '#/' }, t('describe.showAll'))), suggestBox({ value: words }));
  return el('div', {},
    el('h1', {}, t('describe.none')), said, el('p', { class: 'lead' }, t('describe.noneLead')),
    el('div', { class: 'grid' }, list.map(cardFor)),
    el('div', { class: 'strip' }, el('p', {}, t('describe.aiOffer'), ' ', el('a', { href: '#/keys' }, t('describe.aiLink')), ' ', t('describe.aiNote'))),
    suggestBox({ value: words }));
}
