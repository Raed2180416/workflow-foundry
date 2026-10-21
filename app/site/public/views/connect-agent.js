// Connect a coding agent (#/connect-agent): the exact line to paste, per agent (A12). Foundry writes no agent's config: the person
// pastes it, so their agent shows its own trust prompt. What the agent can and cannot do is stated before the line.
import { el, t, api } from '../site.js';
import { snippet, statusChip } from '../components/ui.js';

export async function render() {
  const c = await api('/api/connect');
  const section = (key, status, body) => el('section', { class: 'card', dataset: { agent: key } }, el('h2', {}, t(`connect.${key}.name`), ' ', statusChip(status)), body);
  return el('div', { dataset: { layout: 'narrow' } },
    el('h1', {}, t('connect.title')),
    el('p', { class: 'lead' }, t('connect.lead')),
    el('div', { class: 'inset' }, el('h2', {}, t('connect.canTitle')), el('ul', {}, ['draft', 'test', 'notTurnOn', 'notApprove'].map(k => el('li', {}, t(`connect.can.${k}`))))),
    section('claudeCode', 'works', el('div', {}, el('p', {}, t('connect.claudeCode.how')), snippet(c.claudeCode, { label: t('connect.claudeCode.name') }), el('p', { class: 'muted small' }, t('connect.claudeCode.note')))),
    section('cursor', 'works', el('div', {}, el('p', {}, t('connect.cursor.how')), snippet(JSON.stringify(c.cursorJson, null, 2), { label: t('connect.cursor.name') }),
      el('p', {}, t('connect.cursor.linkLead'), ' ', statusChip('preview')), snippet(c.cursorLink, { label: t('connect.cursor.linkLabel') }), el('p', { class: 'muted small' }, t('connect.cursor.note')))),
    section('codex', 'works', el('div', {}, el('p', {}, t('connect.codex.how')), snippet(c.codex, { label: t('connect.codex.name') }), el('p', { class: 'muted small' }, t('connect.codex.note')))),
    el('section', { class: 'card', dataset: { status: 'planned' } }, el('h2', {}, t('connect.plugin.name'), ' ', statusChip('planned')), el('p', {}, t('connect.plugin.body')),
      el('a', { href: '#/connect-agent', dataset: { instead: '' } }, t('connect.plugin.instead'))),
    el('p', {}, t('connect.thenSay')), el('pre', {}, t('connect.example')),
    el('p', { class: 'muted' }, c.note),
    el('details', {}, el('summary', {}, t('common.showDetails')), el('p', {}, t('connect.allowlistLead')), snippet(JSON.stringify(c.allowlist.serverCommand, null, 2), { label: t('connect.allowlistLabel') }),
      el('p', { class: 'small' }, t('connect.allowlistNote'))));
}
