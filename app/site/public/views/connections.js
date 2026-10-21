// Connections (#/connections): every way to connect, each with its status, what it can and can't do, what Foundry stores, free or
// paid, what happens until it's connected, and what to do today instead of anything Planned (SPEC §6). Live facts from /api/doctor.
import { el, t, api } from '../site.js';
import { statusChip, paidBadge } from '../components/ui.js';

const ROWS = [
  ['agents', [['claudeCode', 'works', '#/connect-agent'], ['cursor', 'works', '#/connect-agent'], ['codex', 'works', '#/connect-agent'], ['plugin', 'planned', '#/connect-agent']]],
  ['data', [['csv', 'works', null], ['json', 'works', null], ['apps', 'planned', '#/']]],
  ['sending', [['drafts', 'works', null], ['webhook', 'planned', '#/drafts'], ['gmail', 'planned', '#/drafts']]],
  ['ai', [['none', 'works', null], ['mercury', 'preview', '#/keys'], ['anthropic', 'planned', '#/keys']]],
  ['existing', [['n8n', 'preview', '#/import'], ['zapier', 'planned', '#/']]],
  ['people', [['you', 'works', null], ['someoneElse', 'planned', '#/pricing'], ['sso', 'planned', '#/pricing']]],
  ['attention', [['badge', 'works', null], ['popup', 'planned', '#/waiting'], ['phone', 'planned', '#/waiting']]]
];

export async function render() {
  const d = await api('/api/doctor').catch(() => null);
  const found = d ? { claudeCode: d.agents.claudeCode.onPath || d.agents.claudeCode.folder, cursor: d.agents.cursor.onPath || d.agents.cursor.folder, codex: d.agents.codex.onPath || d.agents.codex.folder } : {};
  const root = el('div', {}, el('h1', {}, t('connections.title')), el('p', { class: 'lead' }, t('connections.lead')));
  for (const [group, rows] of ROWS) {
    root.append(el('h2', {}, t(`connections.groups.${group}`)));
    root.append(el('div', { class: 'grid' }, rows.map(([key, status, instead]) => {
      const k = `connections.items.${key}`;
      const paid = key === 'someoneElse' ? paidBadge() : null;
      return el('article', { class: 'card', dataset: { connection: key, status } },
        el('h3', {}, t(`${k}.name`), ' ', statusChip(status)),
        found[key] ? el('p', { class: 'ok-text small' }, t('connections.foundHere')) : null,
        key === 'mercury' && d?.keychain === 'none' ? el('p', { class: 'wait-text small' }, t('connections.noKeychain')) : null,
        el('dl', { class: 'facts' }, el('dt', {}, t('connections.can')), el('dd', {}, t(`${k}.can`)), el('dt', {}, t('connections.stores')), el('dd', {}, t(`${k}.stores`)),
          el('dt', {}, t('connections.price')), el('dd', {}, paid ? paid.button : t(`${k}.price`)), el('dt', {}, t('connections.until')), el('dd', {}, t(`${k}.until`))),
        paid ? paid.note : null,
        status === 'planned' || status === 'preview' ? (instead ? el('p', { dataset: { status } }, el('a', { href: instead, dataset: { instead: '' } }, t(`${k}.instead`))) : null)
          : instead ? el('div', { class: 'actions' }, el('a', { class: 'button', href: instead }, t('common.open'))) : null);
    })));
  }
  root.append(el('section', { 'aria-labelledby': 'plumbing-h' }, el('h2', { id: 'plumbing-h' }, t('connections.plumbingTitle')),
    el('ul', { class: 'prose' }, ['storage', 'ports', 'keys', 'agentConfig', 'spreadsheet', 'versions', 'standIns', 'checking', 'evidence', 'brief'].map(x => el('li', {}, t(`connections.plumbing.${x}`))))));
  return root;
}
