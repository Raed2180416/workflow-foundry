// Quickstart (#/docs): three tracks, each a short numbered list (SPEC §9.12).
import { el, t, raw, api } from '../site.js';
import { snippet } from '../components/ui.js';

export async function render() {
  const c = await api('/api/connect').catch(() => null);
  const steps = key => el('ol', {}, (raw(key) ?? []).map(x => el('li', {}, x)));
  return el('div', { dataset: { layout: 'narrow' } },
    el('h1', {}, t('docs.h1')),
    el('p', { class: 'lead' }, t('docs.lead')),
    el('section', { class: 'card', dataset: { track: 'developer' } }, el('h2', {}, t('docs.devTitle')), steps('docs.devSteps'), c ? snippet(c.claudeCode, { label: t('connect.claudeCode.name') }) : null,
      el('p', {}, t('docs.devOthers'), ' ', el('a', { href: '#/connect-agent' }, t('docs.devLink')))),
    el('section', { class: 'card', dataset: { track: 'operator' } }, el('h2', {}, t('docs.opTitle')), el('p', {}, t('docs.opBody')), el('pre', {}, 'node app/cli.mjs site'), el('p', {}, t('docs.opThen')),
      el('a', { class: 'button primary', href: '#/' }, t('docs.opLink'))),
    el('section', { class: 'card', dataset: { track: 'team' } }, el('h2', {}, t('docs.teamTitle')), steps('docs.teamSteps'),
      el('div', { class: 'actions' }, el('a', { class: 'button', href: '#/settings' }, t('nav.settings')), el('a', { class: 'button', href: '#/it-brief' }, t('trust.pilot.brief')), el('a', { class: 'button', href: '#/org' }, t('settings.orgLink')))),
    el('section', {}, el('h2', {}, t('docs.dataTitle')), el('p', {}, t('docs.dataBody')), c ? el('pre', {}, `${c.workspace}/world/sheets/<name>.json`) : null),
    el('p', {}, el('a', { href: '#/glossary' }, t('docs.glossaryLink'))));
}
