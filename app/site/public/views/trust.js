// Trust and security (#/trust): what runs where, what leaves, keys, who can approve, the honest same-user limit (it must stay on
// this page: a test checks it), records and their gaps, what's tested, the pilot for IT, what must exist before live use in an
// organisation, and the exact allowlist entry (SPEC §9.10).
import { el, t, raw, rich, api } from '../site.js';
import { snippet, statusChip } from '../components/ui.js';

export async function render() {
  const [c, doctor] = await Promise.all([api('/api/connect'), api('/api/doctor').catch(() => null)]);
  const sec = (key, ...body) => el('section', { 'aria-labelledby': `trust-${key}`, dataset: { trust: key } }, el('h2', { id: `trust-${key}` }, t(`trust.${key}.title`)), ...body);
  const p = key => el('p', { class: 'prose' }, rich(key));
  const managedExample = { mcpServers: { foundry: { command: c.allowlist.serverCommand[0], args: c.allowlist.serverCommand.slice(1) } } };
  return el('div', { dataset: { layout: 'narrow' } },
    el('h1', {}, t('trust.h1')),
    el('p', { class: 'lead' }, t('trust.lead')),
    sec('where', p('trust.where.body'), el('pre', {}, doctor?.workspace ?? '')),
    sec('leaves', p('trust.leaves.body')),
    sec('keys', p('trust.keys.body')),
    sec('approve', p('trust.approve.body')),
    sec('limit', el('div', { class: 'banner bad', dataset: { sameUserLimit: '' } }, p('trust.limit.body'), p('trust.limit.closes'))),
    sec('records', p('trust.records.body')),
    sec('tested', p('trust.tested.body'), p('trust.tested.users')),
    sec('pilot', el('ul', {}, (raw('trust.pilot.items') ?? []).map(x => el('li', {}, x))), el('div', { class: 'actions' }, el('a', { class: 'button', href: '#/settings' }, t('trust.pilot.settings')), el('a', { class: 'button', href: '#/it-brief' }, t('trust.pilot.brief')))),
    sec('before', el('ul', {}, (raw('trust.before.items') ?? []).map(x => el('li', {}, x, ' ', statusChip('planned')))), el('p', {}, el('b', {}, t('trust.before.none')))),
    sec('allowlist', p('trust.allowlist.body'), snippet(JSON.stringify({ allowedMcpServers: [{ serverCommand: c.allowlist.serverCommand }] }, null, 2), { label: t('trust.allowlist.settingsLabel') }),
      el('p', {}, t('trust.allowlist.mcpLead')), snippet(JSON.stringify(managedExample, null, 2), { label: t('trust.allowlist.mcpLabel') }), el('p', { class: 'small muted' }, t('trust.allowlist.note'))));
}
