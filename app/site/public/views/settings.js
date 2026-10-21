// Settings (#/settings): your name in records (P5 walkthrough B1), practice-only mode (I1, enforced by the service for the site, the CLI
// and MCP alike; for this folder only, unless the organisation's machine policy sets it for the whole computer: P4 M1), allowed AI
// (I2), the look, where things live, and deleting the lists you gave (P4 M10). The theme choice is a per-browser convenience
// (localStorage, inside try/catch).
import { el, t, api, say } from '../site.js';
import { statusChip, errorPanel } from '../components/ui.js';

export async function render() {
  const [s, doctor, me] = await Promise.all([api('/api/settings'), api('/api/doctor').catch(() => null), api('/api/whoami').catch(() => null)]);
  const status = el('div', { role: 'status' });
  const save = async (changes, message) => { try { const r = await api('/api/settings', changes); say(message); status.replaceChildren(el('p', { class: 'ok-text' }, message)); return r; } catch (error) { status.replaceChildren(errorPanel(error)); return null; } };
  let theme = 'auto'; try { theme = localStorage.getItem('foundry-theme') ?? 'auto'; } catch { /* no storage */ }
  const themeRadios = ['auto', 'light', 'dark'].map(v => el('label', { class: 'check-row' }, el('input', { type: 'radio', name: 'theme', value: v, checked: v === theme, on: { change: () => {
    try { if (v === 'auto') localStorage.removeItem('foundry-theme'); else localStorage.setItem('foundry-theme', v); } catch { /* the choice lasts for this page */ }
    if (v === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v;
    say(t('settings.themeSaved'));
  } } }), el('span', {}, t(`settings.theme.${v}`))));
  const managedMode = !!s.managed?.mode, managedAI = !!s.managed?.allowedAI;
  const practice = el('input', { type: 'checkbox', checked: s.mode === 'practice-only', id: 'practice-only', disabled: managedMode, dataset: { ask: 'live-effects' } });
  practice.addEventListener('change', () => save({ mode: practice.checked ? 'practice-only' : 'normal' }, practice.checked ? t('settings.practiceOn') : t('settings.practiceOff')));
  const ai = ['none', 'mercury', 'haiku'].map(v => el('label', { class: 'check-row' }, el('input', { type: 'radio', name: 'ai', value: v, checked: s.allowedAI === v, disabled: managedAI && v !== s.allowedAI, on: { change: () => save({ allowedAI: v }, t('settings.aiSaved')) } }),
    el('span', {}, t(`settings.ai.${v}`), ' ', v !== 'none' ? statusChip('preview') : null)));
  const nameInput = el('input', { type: 'text', id: 'your-name', autocomplete: 'name', maxlength: 80, value: s.yourName ?? '', 'aria-describedby': 'your-name-help' });
  const recordsAs = el('p', { class: 'muted small', role: 'status' }, me ? t('settings.recordsAs', { label: me.label }) : '');
  const saveName = el('button', { type: 'button', dataset: { action: 'save-name' }, on: { click: async () => {
    if (await save({ yourName: nameInput.value.trim() }, t('settings.aiSaved'))) { const w = await api('/api/whoami').catch(() => null); if (w) { recordsAs.textContent = t('settings.nameSaved', { label: w.label }); say(recordsAs.textContent); } }
  } } }, t('settings.nameSave'));
  const confirm = el('input', { type: 'text', id: 'forget-confirm', autocomplete: 'off' });
  const forgetStatus = el('div', { role: 'status' });
  const forget = el('button', { type: 'button', dataset: { ask: 'irreversible', action: 'forget-lists' }, on: { click: async () => {
    try { const r = await api('/api/data/forget', { confirm: confirm.value.trim().toLowerCase() }); forgetStatus.replaceChildren(el('p', { class: 'ok-text' }, t('settings.forgetDone', { n: r.deleted }))); say(t('settings.forgetDone', { n: r.deleted })); confirm.value = ''; }
    catch (error) { forgetStatus.replaceChildren(errorPanel(error, { notDone: t('settings.forgetBody'), action: { label: t('common.tryAgain'), onClick: () => confirm.focus() } })); }
  } } }, t('settings.forgetButton'));
  return el('div', { dataset: { layout: 'narrow' } },
    el('h1', {}, t('settings.title')),
    s.unreadable ? el('div', { class: 'banner bad' }, t('settings.unreadable')) : null,
    el('section', {}, el('h2', {}, t('settings.nameTitle')), el('div', { class: 'field' }, el('label', { for: 'your-name' }, t('settings.nameLabel')), nameInput,
      el('p', { id: 'your-name-help', class: 'field-help' }, t('settings.nameHelp'))), el('div', { class: 'actions' }, saveName), recordsAs),
    el('section', {}, el('h2', {}, t('settings.practiceTitle')),
      el('label', { class: 'check-row', for: 'practice-only' }, practice, el('span', {}, el('b', {}, t('settings.practiceLabel')))),
      managedMode ? el('p', { class: 'banner', dataset: { managedSetting: 'mode' } }, statusChip('decided'), ' ', t('settings.managed')) : null,
      el('p', { class: 'field-help' }, t('settings.practiceHelp'))),
    el('section', {}, el('h2', {}, t('settings.aiTitle')), el('fieldset', {}, el('legend', {}, t('settings.aiLegend')), ai),
      managedAI ? el('p', { class: 'banner', dataset: { managedSetting: 'allowedAI' } }, statusChip('decided'), ' ', t('settings.managed')) : null,
      el('p', { class: 'field-help' }, t('settings.aiHelp')), el('p', {}, el('a', { href: '#/keys' }, t('settings.keysLink')))),
    el('section', {}, el('h2', {}, t('settings.themeTitle')), el('fieldset', {}, el('legend', {}, t('settings.themeLegend')), themeRadios)),
    el('section', {}, el('h2', {}, t('settings.whereTitle')), el('p', {}, t('settings.where')), el('pre', {}, doctor?.workspace ?? ''), el('p', { class: 'muted' }, t('settings.whereNote'))),
    el('section', { dataset: { forget: '' } }, el('h2', {}, t('settings.forgetTitle')), el('p', {}, t('settings.forgetBody')),
      el('div', { class: 'field' }, el('label', { for: 'forget-confirm' }, t('settings.forgetLabel')), confirm), el('div', { class: 'actions' }, forget), forgetStatus),
    el('section', {}, el('h2', {}, t('settings.orgTitle')), el('p', {}, el('a', { href: '#/org' }, t('settings.orgLink')))),
    status);
}
