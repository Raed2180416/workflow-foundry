// AI keys (#/keys): you don't need one. A key goes into the computer's keychain or nowhere; the page never sees it again
// (SPEC §9.13, §15.4-5). The field is a password field that allows paste; its value is cleared as soon as the answer comes back.
import { el, t, api, say } from '../site.js';
// Since the honesty review of 2026-10-21: a saved key is Preview, like the Mercury path it serves (minor 11); the key check is offered only
// when Allowed AI includes the provider, since it sends the key (M7); the limit is the per-build cap Foundry was started with, not a daily
// limit (M8).
import { statusChip, errorPanel } from '../components/ui.js';
import { when } from '../components/dom.js';

export async function render() {
  const k = await api('/api/keys');
  const root = el('div', { dataset: { layout: 'narrow' } }, el('h1', {}, t('keys.title')), el('p', { class: 'lead' }, t('keys.lead')));
  if (!k.keychainAvailable) root.append(el('div', { class: 'banner wait', role: 'status', dataset: { noKeychain: '' } }, el('p', {}, el('b', {}, t('keys.noKeychainTitle'))), el('p', {}, t('keys.noKeychainBody'))));
  for (const p of k.providers) {
    const status = el('div', { role: 'status' });
    const card = el('section', { class: 'card', dataset: { provider: p.provider } }, el('h2', {}, p.label, ' ', statusChip(p.status === 'Preview' ? 'preview' : 'planned')));
    if (p.status === 'Planned') {
      card.append(el('p', {}, t('keys.planned')), el('p', { dataset: { status: 'planned' } }, el('a', { href: '#/', dataset: { instead: '' } }, t('keys.instead'))));
      root.append(card); continue;
    }
    if (p.saved) {
      const remove = el('button', { type: 'button', on: { click: async () => { try { await api(`/api/keys/${p.provider}`, null, { method: 'DELETE' }); say(t('keys.removed')); location.hash = '#/keys'; } catch (error) { status.replaceChildren(errorPanel(error)); } } } }, t('keys.remove'));
      card.append(el('p', {}, statusChip('preview'), ' ', t('keys.saved', { last4: p.last4, backend: k.backend })), el('p', { class: 'muted' }, t('keys.checkedAt', { when: when(p.checkedAt) })),
        el('p', {}, t('keys.wordsGo')), el('div', { class: 'actions' }, remove), status);
      root.append(card); continue;
    }
    const input = el('input', { type: 'password', id: `key-${p.provider}`, autocomplete: 'off', spellcheck: 'false', 'aria-describedby': `key-help-${p.provider}`, dataset: { ask: 'words-leave' } });
    const save = el('button', { type: 'button', class: 'primary', disabled: !k.keychainAvailable || p.allowed === false }, t('keys.checkAndSave'));
    save.addEventListener('click', async () => {
      const value = input.value;
      input.value = '';
      save.setAttribute('aria-busy', 'true'); status.replaceChildren(el('p', {}, t('keys.checking')));
      try { const r = await api('/api/keys', { provider: p.provider, key: value }); status.replaceChildren(el('p', { class: 'ok-text' }, statusChip('preview'), ' ', t('keys.saved', { last4: r.last4, backend: r.backend }))); say(t('keys.savedSay')); }
      catch (error) { status.replaceChildren(errorPanel(error, { notDone: t('keys.notSaved'), action: { label: t('common.tryAgain'), onClick: () => input.focus() } })); }
      save.removeAttribute('aria-busy');
    });
    card.append(p.allowed === false ? el('div', { class: 'banner wait', dataset: { keyNotAllowed: '' } }, el('p', {}, t('keys.notAllowed')), el('p', {}, el('a', { href: '#/settings' }, t('keys.notAllowedLink')))) : null,
      el('label', { for: input.id }, t('keys.paste', { label: p.label })), input,
      el('p', { id: `key-help-${p.provider}`, class: 'field-help' }, t('keys.help')), el('div', { class: 'actions' }, save), el('p', { class: 'muted small', dataset: { keyLimit: '' } }, t('keys.limit', { cap: Number(k.tokenCap ?? 0).toLocaleString('en-GB') })), status);
    root.append(card);
  }
  return root;
}
