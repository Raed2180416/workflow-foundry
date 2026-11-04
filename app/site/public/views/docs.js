// Quickstart (#/docs): four tracks, each a short numbered list (SPEC §9.12). Since the walkthroughs: getting a copy and installing its
// libraries are real commands (P1 B4); the non-coder track says plainly that someone technical installs and restarts it, and how to
// come back (P2 B1, B2); an auditor's way in is here (P5 minor 7).
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
      c ? snippet(c.openCommand, { label: t('docs.opThen') }) : el('pre', {}, 'node app/cli.mjs open'),
      el('a', { class: 'button primary', href: '#/' }, t('docs.opLink'))),
    el('section', { class: 'card', dataset: { track: 'team' } }, el('h2', {}, t('docs.teamTitle')), steps('docs.teamSteps'),
      el('div', { class: 'actions' }, el('a', { class: 'button', href: '#/settings' }, t('nav.settings')), el('a', { class: 'button', href: '#/it-brief' }, t('trust.pilot.brief')), el('a', { class: 'button', href: '#/org' }, t('settings.orgLink')))),
    el('section', { class: 'card', dataset: { track: 'audit' } }, el('h2', {}, t('docs.auditTitle')), el('p', {}, t('docs.auditBody')), el('a', { class: 'button', href: '#/runs' }, t('docs.auditLink'))),
    el('section', {}, el('h2', {}, t('docs.dataTitle')), el('p', {}, t('docs.dataBody')), c ? el('pre', {}, `${c.workspace}/world/sheets/<name>.json`) : null),
    el('p', {}, el('a', { href: '#/glossary' }, t('docs.glossaryLink'))));
}
