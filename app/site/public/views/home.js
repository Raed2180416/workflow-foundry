// Home (#/): show what Foundry can make before asking for words (SPEC §1 fix 1, §9.1). Cards first; the box only suggests a card.
import { el, t, rich, api, templates, memory, navigate } from '../site.js';
import { statusChip, errorPanel } from '../components/ui.js';

export function cardFor(tpl) {
  const sheets = tpl.sheets.map(s => s.plain).join(t('common.and'));
  const headId = `card-${tpl.id}`;
  return el('article', { class: 'card', 'aria-labelledby': headId, dataset: { template: tpl.id } },
    el('h3', { id: headId }, tpl.card),
    el('p', {}, tpl.summary),
    el('ul', { class: 'chips', 'aria-label': t('home.factsLabel') }, el('li', { class: 'chip' }, t('home.usesAiNo')), el('li', { class: 'chip' }, t('home.needs', { sheets }))),
    el('div', { class: 'actions' }, el('a', { class: 'button primary', href: `#/make/${tpl.id}`, 'aria-describedby': headId }, t('home.start'))));
}

export function suggestBox({ value = '' } = {}) {
  const input = el('input', { type: 'text', id: 'describe-box', name: 'describe', autocomplete: 'off', placeholder: t('home.boxPlaceholder'), value, 'aria-describedby': 'describe-help' });
  const form = el('form', { class: 'card', role: 'search', 'aria-label': t('home.boxLabel'), on: { submit: e => {
    e.preventDefault();
    const words = input.value.trim();
    if (!words) { input.focus(); return; }
    memory.describe = words;
    navigate('/describe');
  } } },
  el('label', { for: 'describe-box' }, t('home.boxLabel')),
  el('div', { class: 'actions' }, input, el('button', { type: 'submit' }, t('home.boxButton'))),
  el('p', { id: 'describe-help', class: 'field-help' }, t('home.boxHelp')));
  return form;
}

export async function render() {
  const [list, doctor, overview, batches] = await Promise.all([templates(), api('/api/doctor').catch(() => null), api('/api/overview').catch(() => null), api('/api/batches').catch(() => null)]);
  const waiting = (overview?.inbox?.count ?? 0) + (batches?.open?.length ?? 0);
  const flows = overview?.flows?.length ?? 0;
  const managed = doctor?.managed?.present;
  const practiceOnly = doctor?.settings?.mode === 'practice-only';
  // Would the organisation's policy let Foundry's exact command start? Asked only on a click (it reads the managed policy's server keys).
  const admission = el('p', { role: 'status' });
  const check = el('button', { type: 'button', class: 'link', dataset: { action: 'check-policy' }, on: { click: async () => {
    try { const d = await api('/api/doctor?consent=1'); const a = d.managed?.admission; admission.textContent = !a ? '' : a.admitted === 'yes' ? t('home.managedYes', { why: a.why }) : a.admitted === 'no' ? t('home.managedNo', { why: a.why }) : t('home.managedUnknown', { why: a.why }); }
    catch (error) { admission.replaceChildren(errorPanel(error)); }
  } } }, t('home.managedCheck'));
  const managedCard = managed ? el('section', { class: 'banner wait', 'aria-labelledby': 'managed-h', dataset: { managed: '' } },
    el('h2', { id: 'managed-h' }, t('home.managedTitle')), el('p', {}, t('home.managedBody')),
    el('p', {}, check, ' ', el('span', { class: 'muted small' }, t('home.managedCheckNote'))), admission,
    el('div', { class: 'actions' }, el('a', { class: 'button', href: '#/it-brief' }, t('home.managedBrief')),
      practiceOnly ? el('span', { role: 'status' }, statusChip('works'), ' ', t('home.practiceOnlyOn'))
        : el('button', { type: 'button', dataset: { action: 'practice-only' }, on: { click: async e => { const b = e.currentTarget; b.disabled = true; try { await api('/api/settings', { mode: 'practice-only' }); navigate('/settings'); } catch (error) { b.disabled = false; b.after(errorPanel(error)); } } } }, t('home.managedPractice')))) : null;
  return el('div', {},
    managedCard,
    waiting ? el('p', { class: 'banner wait', role: 'status' }, t('home.waiting', { n: waiting }), ' ', el('a', { href: '#/waiting' }, t('home.waitingOpen'))) : null,
    el('h1', {}, t('home.h1')),
    el('p', { class: 'lead' }, t('home.lead')),
    flows ? el('p', {}, el('a', { href: '#/automations' }, t('home.yourAutomations', { n: flows }))) : null,
    el('h2', { id: 'cards-h' }, t('home.cardsTitle')),
    el('p', { class: 'muted' }, t('home.aiLine')),
    el('div', { class: 'grid', role: 'list', 'aria-labelledby': 'cards-h' }, list.map(tpl => { const c = cardFor(tpl); c.setAttribute('role', 'listitem'); return c; })),
    suggestBox(),
    el('div', { class: 'strip' }, el('p', {}, rich('home.trust'))),
    el('div', { class: 'strip', dataset: { notReady: '' } }, el('p', {}, el('b', {}, t('home.notReadyTitle')), ' ', t('home.notReady'), ' ', el('a', { href: '#/docs' }, t('home.notReadyLink')))),
    el('div', { class: 'strip' }, el('p', {}, el('b', {}, t('home.teamTitle')), ' ', el('a', { href: '#/org' }, t('home.teamLink')))),
    el('div', { class: 'strip' }, el('p', {}, el('b', {}, t('home.devTitle')), ' ', el('a', { href: '#/connect-agent' }, t('home.devLink')))),
    el('div', { class: 'strip' }, el('p', {}, el('b', {}, t('home.n8nTitle')), ' ', t('home.n8nBody')), statusChip('preview'), el('a', { href: '#/import' }, t('home.n8nLink'))));
}
