// Help (#/help): the same link in the same place on every page (WCAG 3.2.6). Short answers, each with a way forward.
import { el, t, raw } from '../site.js';

export async function render() {
  const qa = raw('help.qa') ?? [];
  return el('div', { dataset: { layout: 'narrow' } },
    el('h1', {}, t('help.h1')), el('p', { class: 'lead' }, t('help.lead')),
    qa.map(([q, a, href, label]) => el('section', { class: 'card' }, el('h2', { class: 'h3' }, q), el('p', {}, a), href ? el('a', { href }, label) : null)),
    el('div', { class: 'actions' }, el('a', { class: 'button', href: '#/docs' }, t('footer.docs')), el('a', { class: 'button', href: '#/glossary' }, t('glossary.h1')), el('a', { class: 'button', href: '#/trust' }, t('footer.it'))));
}
