// Connect a coding agent (#/connect-agent): the exact line to paste, per agent (A12). Foundry writes no agent's config: the person
// pastes it. What the agent can and cannot do is stated before the line. Since the P1 and P4 walkthroughs: every agent is Preview
// (tested with a scripted client, not a released one: M1, M9); where to paste, which folder and how to check the connection are said
// (M3); the trust wording follows Claude Code's documentation (M2); an optional allow list stops a prompt for every read-only tool (M4);
// the examples an agent can start from are listed (M10; since the front door, 2026-11-05, as examples, not the limit of what it can
// build); and the command that opens Foundry's page is here (B2).
import { el, t, api, templates } from '../site.js';
import { snippet, statusChip } from '../components/ui.js';

const READ_AND_TEST = ['construction_guide', 'propose_flow', 'dry_run', 'explain_flow', 'flow_status', 'list_flows'];

export async function render() {
  const [c, list] = await Promise.all([api('/api/connect'), templates()]);
  const section = (key, status, body) => el('section', { class: 'card', dataset: { agent: key } }, el('h2', {}, t(`connect.${key}.name`), ' ', statusChip(status)), body);
  const allow = JSON.stringify({ permissions: { allow: READ_AND_TEST.map(n => `mcp__foundry__${n}`) } }, null, 2);
  return el('div', { dataset: { layout: 'narrow' } },
    el('h1', {}, t('connect.title')),
    el('p', { class: 'lead' }, t('connect.lead')),
    el('div', { class: 'inset' }, el('h2', {}, t('connect.canTitle')), el('ul', {}, ['draft', 'test', 'notTurnOn', 'notApprove'].map(k => el('li', {}, t(`connect.can.${k}`))))),
    section('claudeCode', 'preview', el('div', {}, el('p', {}, t('connect.claudeCode.how')), snippet(c.claudeCode, { label: t('connect.claudeCode.name') }),
      el('p', {}, t('connect.claudeCode.everyLead')), snippet(c.claudeCodeEveryProject, { label: t('connect.claudeCode.name') }),
      el('p', { class: 'muted small' }, t('connect.claudeCode.note')),
      el('details', {}, el('summary', {}, t('connect.claudeCode.allowLead')), snippet(allow, { label: t('connect.claudeCode.allowLead') })))),
    section('cursor', 'preview', el('div', {}, el('p', {}, t('connect.cursor.how')), snippet(JSON.stringify(c.cursorJson, null, 2), { label: t('connect.cursor.name') }),
      el('p', {}, t('connect.cursor.linkLead'), ' ', statusChip('preview')), snippet(c.cursorLink, { label: t('connect.cursor.linkLabel') }), el('p', { class: 'muted small' }, t('connect.cursor.note')))),
    section('codex', 'preview', el('div', {}, el('p', {}, t('connect.codex.how')), snippet(c.codex, { label: t('connect.codex.name') }), el('p', { class: 'muted small' }, t('connect.codex.note')))),
    el('section', { class: 'card', dataset: { status: 'planned' } }, el('h2', {}, t('connect.plugin.name'), ' ', statusChip('planned')), el('p', {}, t('connect.plugin.body')),
      el('a', { href: '#/connect-agent', dataset: { instead: '' } }, t('connect.plugin.instead'))),
    el('p', {}, t('connect.thenSay')), el('pre', {}, t('connect.example')),
    el('p', {}, t('connect.cardsLead')), el('ul', {}, list.map(x => el('li', {}, x.card))),
    el('p', {}, t('connect.openLead')), snippet(c.openCommand, { label: t('connect.openLead') }),
    el('p', { class: 'muted' }, c.note),
    el('details', {}, el('summary', {}, t('common.showDetails')), el('p', {}, t('connect.allowlistLead')), snippet(JSON.stringify(c.allowlist.serverCommand, null, 2), { label: t('connect.allowlistLabel') }),
      el('p', { class: 'small' }, t('connect.allowlistNote'))));
}
