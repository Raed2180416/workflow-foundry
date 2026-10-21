// Settings (#/settings): theme, practice-only mode (I1, enforced by the service for the site, the CLI and MCP alike), allowed AI (I2),
// and where things live. The theme choice is a per-browser convenience (localStorage, inside try/catch).
import { el, t, api, say } from '../site.js';
import { statusChip, errorPanel } from '../components/ui.js';

export async function render() {
  const [s, doctor] = await Promise.all([api('/api/settings'), api('/api/doctor').catch(() => null)]);
  const status = el('div', { role: 'status' });
  const save = async (changes, message) => { try { const r = await api('/api/settings', changes); say(message); status.replaceChildren(el('p', { class: 'ok-text' }, message)); return r; } catch (error) { status.replaceChildren(errorPanel(error)); return null; } };
  let theme = 'auto'; try { theme = localStorage.getItem('foundry-theme') ?? 'auto'; } catch { /* no storage */ }
  const themeRadios = ['auto', 'light', 'dark'].map(v => el('label', { class: 'check-row' }, el('input', { type: 'radio', name: 'theme', value: v, checked: v === theme, on: { change: () => {
    try { if (v === 'auto') localStorage.removeItem('foundry-theme'); else localStorage.setItem('foundry-theme', v); } catch { /* the choice lasts for this page */ }
    if (v === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v;
    say(t('settings.themeSaved'));
  } } }), el('span', {}, t(`settings.theme.${v}`))));
  const practice = el('input', { type: 'checkbox', checked: s.mode === 'practice-only', id: 'practice-only', dataset: { ask: 'live-effects' } });
  practice.addEventListener('change', () => save({ mode: practice.checked ? 'practice-only' : 'normal' }, practice.checked ? t('settings.practiceOn') : t('settings.practiceOff')));
  const ai = ['none', 'mercury'].map(v => el('label', { class: 'check-row' }, el('input', { type: 'radio', name: 'ai', value: v, checked: s.allowedAI === v, on: { change: () => save({ allowedAI: v }, t('settings.aiSaved')) } }),
    el('span', {}, t(`settings.ai.${v}`), ' ', v === 'mercury' ? statusChip('preview') : null)));
  return el('div', { dataset: { layout: 'narrow' } },
    el('h1', {}, t('settings.title')),
    s.unreadable ? el('div', { class: 'banner bad' }, t('settings.unreadable')) : null,
    el('section', {}, el('h2', {}, t('settings.practiceTitle')),
      el('label', { class: 'check-row', for: 'practice-only' }, practice, el('span', {}, el('b', {}, t('settings.practiceLabel')))),
      el('p', { class: 'field-help' }, t('settings.practiceHelp'))),
    el('section', {}, el('h2', {}, t('settings.aiTitle')), el('fieldset', {}, el('legend', {}, t('settings.aiLegend')), ai), el('p', { class: 'field-help' }, t('settings.aiHelp')),
      el('p', {}, el('a', { href: '#/keys' }, t('settings.keysLink')))),
    el('section', {}, el('h2', {}, t('settings.themeTitle')), el('fieldset', {}, el('legend', {}, t('settings.themeLegend')), themeRadios)),
    el('section', {}, el('h2', {}, t('settings.whereTitle')), el('p', {}, t('settings.where')), el('pre', {}, doctor?.workspace ?? ''), el('p', { class: 'muted' }, t('settings.whereNote'))),
    el('section', {}, el('h2', {}, t('settings.orgTitle')), el('p', {}, el('a', { href: '#/org' }, t('settings.orgLink')))),
    status);
}
