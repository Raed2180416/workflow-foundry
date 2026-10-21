// Import (#/import): drop an n8n export, read an honest verdict and a risk card. Foundry runs nothing (SPEC §9.14; Preview).
import { el, t, api, rich, say } from '../site.js';
import { dropZone, errorPanel, statusChip } from '../components/ui.js';

export async function render() {
  const out = el('div', {});
  const drop = dropZone({ label: t('import.dropLabel'), help: t('import.dropHelp'), harm: 'none', onText: async text => {
    out.replaceChildren(el('p', { role: 'status' }, t('import.reading')));
    try {
      const r = await api('/api/import/n8n', { json: text });
      say(t('import.done'));
      out.replaceChildren(el('section', { class: 'card', dataset: { importReport: '' } },
        el('h2', {}, r.name),
        el('ul', { class: 'checks' }, r.lines.map(l => el('li', {}, el('span', { class: l.yes ? 'mark-ok' : 'mark-bad', 'aria-hidden': 'true' }, l.yes ? '✓' : '✗'), el('span', {}, l.text)))),
        r.reasons.length ? el('ul', {}, r.reasons.map(x => el('li', {}, x.text, x.steps.length ? el('span', { class: 'muted' }, ` (${x.steps.join(', ')})`) : ''))) : null,
        el('h3', {}, t('import.riskTitle')),
        el('dl', { class: 'facts' }, r.risk.flatMap(x => [el('dt', {}, x.what), el('dd', {}, x.answer, ' ', el('span', { class: 'chip' }, x.source === 'read' ? t('import.read') : t('import.inferred')))])),
        el('p', { class: 'banner ok' }, rich('import.footer'))));
    } catch (error) { out.replaceChildren(errorPanel(error, { notDone: t('import.ranNothing'), action: { label: t('import.another'), onClick: () => drop.querySelector('input').focus() } })); }
  } });
  return el('div', { dataset: { layout: 'narrow' } },
    el('h1', {}, t('import.h1'), ' ', statusChip('preview')),
    el('p', { class: 'lead' }, t('import.lead')),
    drop, out,
    el('p', { dataset: { status: 'planned' } }, statusChip('planned'), ' ', t('import.others'), ' ', el('a', { href: '#/', dataset: { instead: '' } }, t('import.othersInstead'))));
}
