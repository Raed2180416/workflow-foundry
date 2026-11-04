// Glossary (#/glossary): the plain words the site uses and the precise words developers and IT will see (SPEC §9).
import { el, t, raw } from '../site.js';

export async function render() {
  const rows = raw('glossary.rows') ?? [];
  return el('div', { dataset: { layout: 'narrow' } },
    el('h1', {}, t('glossary.h1')), el('p', { class: 'lead' }, t('glossary.lead')),
    el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, t('glossary.plain')), el('th', { scope: 'col' }, t('glossary.precise')), el('th', { scope: 'col' }, t('glossary.means')))),
      el('tbody', {}, rows.map(([plain, precise, means]) => el('tr', {}, el('td', {}, plain), el('td', {}, el('code', {}, precise)), el('td', {}, means)))))),
    el('p', {}, el('a', { href: '#/help' }, t('nav.help'))));
}
