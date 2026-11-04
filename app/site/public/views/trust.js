// Trust and security (#/trust): what runs where, what leaves, keys, who can approve, the honest same-user limit (it must stay on
// this page: a test checks it), records and their gaps, what's tested, the pilot for IT, what must exist before live use in an
// organisation, and the exact allowlist entry (SPEC §9.10).
import { el, t, raw, rich, api } from '../site.js';
import { snippet, statusChip } from '../components/ui.js';

export async function render() {
  const [c, doctor] = await Promise.all([api('/api/connect'), api('/api/doctor').catch(() => null)]);
  const sec = (key, ...body) => el('section', { 'aria-labelledby': `trust-${key}`, dataset: { trust: key } }, el('h2', { id: `trust-${key}` }, t(`trust.${key}.title`)), ...body);
  const p = key => el('p', { class: 'prose' }, rich(key));
  const privacy = doctor?.items?.find(i => i.check === 'Workspace privacy') ?? null;
  const managedExample = { mcpServers: { foundry: { command: c.allowlist.serverCommand[0], args: c.allowlist.serverCommand.slice(1) } } };
  return el('div', { dataset: { layout: 'narrow' } },
    el('h1', {}, t('trust.h1')),
    el('p', { class: 'lead' }, t('trust.lead')),
    // "Only your user" only when the doctor finds the folder private now (honesty review minor 6, not closed until the fix round of
    // 2026-10-21: this page said it unconditionally while Settings did not).
    sec('where', p('trust.where.body'), el('pre', {}, doctor?.workspace ?? ''), el('p', { class: 'prose', dataset: { workspacePrivate: String(doctor?.workspacePrivate ?? null) } },
      doctor?.workspacePrivate === true ? t('trust.where.private', { mode: privacy?.mode ?? '0700' }) : doctor?.workspacePrivate === null ? t('trust.where.unknown')
        : t('trust.where.open', { mode: privacy?.mode ? ` (mode ${privacy.mode})` : '' }))),
    sec('leaves', p('trust.leaves.body')),
    sec('data', p('trust.data.body')),
    sec('keys', p('trust.keys.body')),
    sec('approve', p('trust.approve.body'), p('trust.approve.whyOnce')),
    sec('limit', el('div', { class: 'banner bad', dataset: { sameUserLimit: '' } }, p('trust.limit.body'), p('trust.limit.closes'))),
    sec('hooks', p('trust.hooks.body')),
    sec('records', p('trust.records.body')),
    sec('tested', p('trust.tested.body'), p('trust.tested.users')),
    sec('pilot', el('ul', {}, (raw('trust.pilot.items') ?? []).map(x => el('li', {}, x))), el('div', { class: 'actions' }, el('a', { class: 'button', href: '#/settings' }, t('trust.pilot.settings')), el('a', { class: 'button', href: '#/it-brief' }, t('trust.pilot.brief')))),
    // Each with its own status (honesty review, minor 9): the IT brief says leaver removal and a stop switch are not decided.
    sec('before', el('ul', {}, (raw('trust.before.items') ?? []).map((x, i) => el('li', {}, x, ' ', statusChip(raw('trust.before.status')?.[i] ?? 'planned')))), el('p', {}, el('b', {}, t('trust.before.none')))),
    sec('allowlist', p('trust.allowlist.body'), snippet(JSON.stringify(c.allowlist.managedSettings, null, 2), { label: t('trust.allowlist.settingsLabel') }),
      el('p', {}, t('trust.allowlist.mcpLead')), snippet(JSON.stringify(managedExample, null, 2), { label: t('trust.allowlist.mcpLabel') }), el('p', { class: 'small muted' }, t('trust.allowlist.note'))),
    sec('remove', p('trust.remove.body')));
}
