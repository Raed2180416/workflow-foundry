// The one-page brief for IT (#/it-brief and #/it-brief/:flowId): generated on this computer from the automation's own record,
// shown here and downloadable as Markdown or HTML (SPEC §9.11). Nothing is sent anywhere.
import { el, t, api, download, toast } from '../site.js';
import { errorPanel } from '../components/ui.js';

export async function render({ params }) {
  let flowId = params[0] ?? null;
  if (!flowId) { const a = await api('/api/automations').catch(() => null); flowId = a?.flows?.[0]?.flowId ?? a?.drafts?.[0]?.flowId ?? null; }
  const b = await api(`/api/brief${flowId ? `/${flowId}` : ''}.json`);
  const status = el('div', {});
  const dl = (ext, label) => el('button', { type: 'button', class: ext === 'md' ? 'primary' : '', dataset: { action: `brief-${ext}` }, on: { click: async e => {
    e.currentTarget.setAttribute('aria-busy', 'true');
    try { await download(`/api/brief${flowId ? `/${flowId}` : ''}.${ext}`, `foundry-it-brief${flowId ? `-${flowId}` : ''}.${ext}`); toast(t('brief.downloaded')); } catch (error) { status.replaceChildren(errorPanel(error)); }
    e.currentTarget?.removeAttribute?.('aria-busy');
  } } }, label);
  return el('div', { dataset: { layout: 'narrow' } },
    el('h1', {}, b.title),
    el('p', { class: 'muted' }, b.header),
    el('div', { class: 'actions' }, dl('md', t('brief.downloadMd')), dl('html', t('brief.downloadHtml'))), status,
    !flowId ? el('p', { class: 'banner' }, t('brief.general'), ' ', el('a', { href: '#/' }, t('brief.makeOne'))) : null,
    b.sections.map(s => el('section', { dataset: { briefSection: s.title } }, el('h2', {}, s.title),
      s.table ? el('div', { class: 'table-wrap' }, el('table', {}, (() => { const [head, ...rows] = s.header ? s.table : [[t('brief.item'), t('brief.value')], ...s.table];
        return [el('thead', {}, el('tr', {}, head.map(h => el('th', { scope: 'col' }, h)))), el('tbody', {}, rows.map(r => el('tr', {}, r.map(c => el('td', {}, c)))))]; })())) : null,
      s.code ? el('pre', {}, s.code) : null,
      s.lines?.length ? el('ul', {}, s.lines.map(l => el('li', {}, l))) : null,
      s.note ? el('p', {}, s.note) : null)));
}
