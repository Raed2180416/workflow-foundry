// A page that does not exist: say so, and offer the way home (a declared terminal view).
import { el, t } from '../site.js';

export async function render() {
  return el('div', { dataset: { layout: 'narrow', terminal: '', notFound: '' } }, el('h1', {}, t('notFound.h1')), el('p', {}, t('notFound.body')),
    el('div', { class: 'actions' }, el('a', { class: 'button primary', href: '#/' }, t('common.backHome')), el('a', { class: 'button', href: '#/help' }, t('nav.help'))));
}
