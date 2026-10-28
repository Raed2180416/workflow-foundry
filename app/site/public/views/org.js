// Who decides what (#/org): the authority map in four panels plus a change strip (SPEC §8). It is a real, versioned, hash-chained
// document on this computer, checked when an automation is made. It is NOT enforced while automations run; every view says so.
// Since the P3 and P5 walkthroughs: no control claims more than Foundry does (the "mode" and "if it would break it" choices, reminders
// and the requester rule are gone or marked Planned: M2-M4, M6); attribution says the person at this computer wrote it down (M5); a
// version is "saved by you (not signed)" (P5 M11); amounts carry the currency the person picks (M7); an approver can carry an e-mail
// the cards must use (M1); the less used panels fold away (M21).
import { el, t, api, say, memory } from '../site.js';
import { errorPanel, statusChip, paidBadge, plannedLine } from '../components/ui.js';
import { id as uid, whenUtc } from '../components/dom.js';

const ROLE_SETS = { 'approver,rule-owner': ['approver', 'rule-owner'], approver: ['approver'], 'rule-owner': ['rule-owner'], auditor: ['auditor'], builder: ['builder'] };
const ACTIONS = ['money-out', 'message-outside', 'change-records', 'delete'];
const SIGN = { EUR: '€', USD: '$', GBP: '£' };
const money = (v, unit = 'EUR') => `${SIGN[unit] ?? ''}${Number(v).toLocaleString('en-GB', { maximumFractionDigits: 2 })}${SIGN[unit] ? '' : ` ${unit}`}`;
const defaultCurrency = () => { const l = (navigator.language ?? '').toLowerCase(); return /-us$|-ca$|-au$/.test(l) || l === 'en' ? 'USD' : /-gb$/.test(l) ? 'GBP' : 'EUR'; };

export async function render() {
  const state = await api('/api/org/map');
  const root = el('div', { dataset: { layout: 'narrow' } });
  const status = el('div', {});
  let drawing = false; // a blur fired while the view is replaced must not start a second replace
  const draw = () => { if (drawing) return; drawing = true; try { root.replaceChildren(...view()); } finally { drawing = false; } };
  let draft = memory.orgDraft ?? null;

  function view() {
    const parts = [el('h1', {}, t('org.h1')), el('div', { class: 'banner wait', role: 'note', dataset: { notEnforced: '' } }, el('p', {}, statusChip('preview'), ' ', t('org.notEnforced')))];
    if (!draft && !state.current) parts.push(...startPanel());
    else if (!draft) parts.push(...savedView());
    else parts.push(...editor());
    parts.push(status);
    return parts;
  }

  // ---------------------------------------------------------------- start
  function startPanel() {
    return [el('p', { class: 'lead' }, t('org.lead')), el('h2', {}, t('org.startTitle')),
      el('div', { class: 'grid' }, ['just-me', 'small-team', 'refund', 'blank'].map(k => el('section', { class: 'card', dataset: { starter: k } }, el('h3', {}, t(`org.starters.${k}.name`)), el('p', {}, t(`org.starters.${k}.body`)),
        el('div', { class: 'actions' }, el('button', { type: 'button', class: k === 'small-team' ? 'primary' : '', dataset: { action: `start-${k}` }, on: { click: async () => {
          try { draft = (await api('/api/org/starter', { start: k })).map; memory.orgDraft = draft; draw(); root.querySelector('h2')?.focus(); } catch (error) { status.replaceChildren(errorPanel(error)); }
        } } }, t('org.startButton')))))),
      el('p', { class: 'muted' }, t('org.youAlone'))];
  }

  // ---------------------------------------------------------------- the saved version
  function savedView() {
    const { map, version, hash } = state.current;
    const people = map.principals.filter(p => p.kind === 'human');
    return [
      // No "Decided" chip (honesty review, minor 11): the version is saved by you, unsigned and self-approved, as the title says.
      el('p', { class: 'banner ok', role: 'status', dataset: { savedVersion: String(version) } }, t('org.savedTitle', { version })),
      ...state.warnings.map(w => el('div', { class: 'banner wait', dataset: { bootstrap: '' } }, el('p', {}, el('b', {}, t('org.bootstrapTitle')), ' ', w))),
      el('h2', {}, t('org.peopleTitle')), el('ul', {}, people.map(p => el('li', {}, p.name, p.email ? ` (${p.email})` : '', ': ', p.roles.map(r => map.roles.find(x => x.id === r)?.name ?? r).join(', ')))),
      el('h2', {}, t('org.approvalsTitle')), el('ul', {}, map.approvals.map(a => el('li', {}, t(`org.actions.${a.actionClass}`), ': ',
        a.aboveParameter ? t('org.aboveAmount', { amount: money(map.parameters[a.aboveParameter]?.value ?? 0, map.parameters[a.aboveParameter]?.unit) }) : t('org.always'), ' ', a.approverPrincipal === 'you' ? t('org.needsYou') : t('org.needs', { who: nameOf(map, a.approverPrincipal) })))),
      plannedLine(t('org.remindersPlanned'), '#/waiting', t('connections.items.popup.instead')),
      el('h2', {}, t('org.rulesTitle')), map.clauses.length ? el('ul', {}, map.clauses.map(c => el('li', {}, c.statement, ' ', el('span', { class: 'chip' }, t(`org.layers.${c.layer}`)), ' ',
        el('span', { class: 'muted small' }, c.owner.principal === 'you' ? t('org.ownedByYou') : t('org.ownedBy', { owner: nameOf(map, c.owner.principal) }))))) : el('p', { class: 'muted' }, t('org.noRules')),
      map.clauses.some(c => c.check?.excludeRequester) ? plannedLine(t('org.requesterPlanned'), '#/runs', t('org.requesterInstead')) : null,
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'primary', dataset: { action: 'change-map' }, on: { click: () => { draft = structuredClone(map); memory.orgDraft = draft; draw(); } } }, t('org.change')),
        el('a', { class: 'button', href: '#/make/expense-approval' }, t('org.tryCard'))),
      el('details', {}, el('summary', {}, t('common.showDetails')), el('p', { class: 'small' }, t('org.versionHash', { version, hash })),
        el('p', { class: 'small' }, state.chain.ok ? t('org.chainOk', { n: state.chain.versions }) : t('org.chainBad')),
        el('ol', {}, state.versions.map(v => el('li', { class: 'small' }, t('org.versionLine', { version: v.version, at: whenUtc(v.at), by: v.signedBy.join(', ') })))))];
  }

  // ---------------------------------------------------------------- the editor (four panels and a change strip)
  function editor() {
    const map = draft;
    const save = el('button', { type: 'button', class: 'primary', dataset: { action: 'save-map' } }, t('org.save', { version: (state.current?.version ?? 0) + 1 }));
    const saveStatus = el('div', {});
    save.addEventListener('click', async () => {
      save.setAttribute('aria-busy', 'true'); saveStatus.replaceChildren();
      try {
        const r = await api('/api/org/map', { map });
        draft = null; memory.orgDraft = null; say(t('org.savedTitle', { version: r.version }));
        Object.assign(state, await api('/api/org/map')); draw(); root.querySelector('[data-saved-version]')?.focus?.();
      } catch (error) {
        save.removeAttribute('aria-busy');
        const flips = error.data?.flips ?? [];
        if (flips.length) {
          saveStatus.replaceChildren(el('div', { class: 'error-panel', role: 'alert', dataset: { flips: String(flips.length) } }, el('h2', {}, t('org.flipTitle')),
            flips.map(f => el('div', {}, el('p', {}, f.message), el('div', { class: 'actions' }, el('button', { type: 'button', dataset: { action: `confirm-flip-${f.n}` }, on: { click: () => {
              const c = map.clauses.find(x => x.id === f.clause), e = c.examples.find(x => x.n === f.n); e.answer = f.now; e.confirmed = true;
              saveStatus.replaceChildren(el('p', { class: 'banner ok', role: 'status' }, t('org.flipConfirmed', { n: f.n, now: t(`org.answers.${f.now}`) })));
            } } }, t('org.confirmFlip', { n: f.n, now: t(`org.answers.${f.now}`) })), el('button', { type: 'button', on: { click: () => { draft = null; memory.orgDraft = null; draw(); } } }, t('org.undo')))))));
        } else saveStatus.replaceChildren(errorPanel(error, { notDone: t('org.notSaved') }));
      }
    });
    return [
      el('p', { class: 'lead' }, t('org.editingLead')),
      peoplePanel(map), approvalsPanel(map), rulesPanel(map),
      el('details', { dataset: { more: '' } }, el('summary', {}, t('org.moreTitle')), wherePanel(map), changeStrip(map)),
      el('div', { class: 'actions' }, save, el('button', { type: 'button', on: { click: () => { draft = null; memory.orgDraft = null; draw(); } } }, t('org.discard'))), saveStatus];
  }
  const rerender = focusSelector => { draw(); if (focusSelector) root.querySelector(focusSelector)?.focus(); };

  function peoplePanel(map) {
    const name = el('input', { type: 'text', id: 'person-name', autocomplete: 'off', placeholder: t('org.personPlaceholder') });
    const email = el('input', { type: 'email', id: 'person-email', autocomplete: 'off', 'aria-describedby': 'person-email-help' });
    const role = el('select', { id: 'person-role' }, Object.keys(ROLE_SETS).map(k => el('option', { value: k }, t(`org.roleSets.${k.replace(',', '_')}`))));
    const add = el('button', { type: 'button', dataset: { action: 'add-person' }, on: { click: () => {
      const n = name.value.trim(); if (!n) { name.focus(); return; }
      const e = email.value.trim().toLowerCase();
      map.principals.push({ id: `p-${Date.now().toString(36)}-${map.principals.length}`, name: n.slice(0, 120), kind: 'human', roles: ROLE_SETS[role.value], ...(e.includes('@') ? { email: e.slice(0, 254) } : {}) });
      say(t('org.personAdded', { name: n })); rerender('#person-name');
    } } }, t('org.addPerson'));
    return el('section', { class: 'card', dataset: { panel: 'people' } }, el('h2', {}, t('org.peopleTitle')), el('p', { class: 'muted' }, t('org.peopleLead')),
      el('ul', {}, map.principals.filter(p => p.kind === 'human').map(p => {
        const decides = !p.self && p.roles.some(r => ['approver', 'rule-owner', 'auditor'].includes(r));
        const badge = decides ? paidBadge(t('org.teamFor', { name: p.name })) : null;
        return el('li', { dataset: { person: p.id } }, el('b', {}, p.name), p.email ? ` (${p.email})` : '', ': ', p.roles.map(r => map.roles.find(x => x.id === r)?.name ?? r).join(', '), ' ', badge?.button ?? null, badge?.note ?? null);
      })),
      el('div', { class: 'field' }, el('label', { for: 'person-name' }, t('org.personName')), name),
      el('div', { class: 'field' }, el('label', { for: 'person-email' }, t('org.emailLabel')), email, el('p', { id: 'person-email-help', class: 'field-help' }, t('org.emailHelp'))),
      el('div', { class: 'field' }, el('label', { for: 'person-role' }, t('org.personRole')), role), el('div', { class: 'actions' }, add));
  }

  function approvalsPanel(map) {
    const people = map.principals.filter(p => p.kind === 'human' && p.roles.includes('approver'));
    return el('section', { class: 'card', dataset: { panel: 'approvals' } }, el('h2', {}, t('org.approvalsTitle')), el('p', { class: 'muted' }, t('org.approvalsLead')),
      ACTIONS.map(action => {
        let row = map.approvals.find(a => a.actionClass === action);
        const amountId = uid(`amt-${action}`), whoId = uid(`who-${action}`);
        const param = action === 'money-out' ? 'moneyOutApprovalAbove' : null;
        const amount = param ? el('input', { type: 'number', id: amountId, min: 0, step: 'any', inputmode: 'decimal', value: row?.aboveParameter ? map.parameters[row.aboveParameter]?.value : '', dataset: { ask: 'money', amount: action } }) : null;
        const curId = uid(`cur-${action}`);
        const currency = param ? el('select', { id: curId, dataset: { currency: action } }, ['EUR', 'USD', 'GBP'].map(c => el('option', { value: c, selected: c === ((map.parameters[param]?.unit) ?? defaultCurrency()) }, `${SIGN[c]} ${c}`))) : null;
        const who = el('select', { id: whoId, dataset: { approver: action } }, el('option', { value: '' }, t('org.nobody')), people.map(p => el('option', { value: p.id, selected: row?.approverPrincipal === p.id }, p.name)));
        const ensure = () => { if (!row) { row = { id: `A${map.approvals.length + 1}`, actionClass: action, approverRole: 'approver', approverPrincipal: 'you', remindAfterHours: 24, stopAfterHours: 72, excluded: ['requester'] }; map.approvals.push(row); } return row; };
        // Edits update this row in place: the field the person moves to next is never rebuilt under their pointer or focus.
        const badgeHolder = el('span', {}), facts = el('div', {}, plannedLine(t('org.remindersPlanned'), '#/waiting', t('connections.items.popup.instead')));
        const makeRule = el('div', { class: 'actions' }, el('button', { type: 'button', dataset: { action: 'make-rule' }, on: { click: async e => {
          const button = e.currentTarget; button.setAttribute('aria-busy', 'true');
          try { const r = await api('/api/org/rule', { map, approvalId: row.id }); draft = r.map; memory.orgDraft = draft; rerender('[data-panel="rules"] h3'); }
          catch (error) { button.removeAttribute('aria-busy'); status.replaceChildren(errorPanel(error)); }
        } } }, t('org.makeRule')));
        const sync = () => {
          const badge = row?.approverPrincipal && row.approverPrincipal !== 'you' ? paidBadge(t('org.teamFor', { name: nameOf(map, row.approverPrincipal) })) : null;
          badgeHolder.replaceChildren(...(badge ? [' ', badge.button, badge.note] : []));
          facts.hidden = !row;
          makeRule.hidden = !(row?.aboveParameter && !map.clauses.some(c => c.check.kind === 'approval-above-threshold' && c.check.parameter === row.aboveParameter));
        };
        amount?.addEventListener('change', () => {
          const r = ensure(), v = amount.value === '' ? null : Number(amount.value);
          if (v === null) { delete r.aboveParameter; } else { map.parameters[param] = { value: v, unit: currency.value, label: 'Money out above this needs a yes' }; r.aboveParameter = param; }
          for (const c of map.clauses.filter(c => c.check.kind === 'approval-above-threshold' && c.check.parameter === param)) {
            c.statement = c.statement.replace(/[€$£][\d.,]+|[\d.,]+ [A-Z]{3}/, money(v ?? 0, currency.value));
            root.querySelector(`[data-rule="${c.id}"] h3`)?.replaceChildren(c.statement);
          }
          sync();
        });
        currency?.addEventListener('change', () => { if (map.parameters[param]) { map.parameters[param].unit = currency.value; amount.dispatchEvent(new Event('change')); } });
        who.addEventListener('change', () => { const r = ensure(); if (who.value) r.approverPrincipal = who.value; else { map.approvals.splice(map.approvals.indexOf(r), 1); row = null; } sync(); });
        sync();
        return el('fieldset', { dataset: { action } }, el('legend', {}, t(`org.actions.${action}`)),
          amount ? el('div', { class: 'field' }, el('label', { for: amountId }, t('org.aboveLabel')), amount) : null,
          currency ? el('div', { class: 'field' }, el('label', { for: curId }, t('org.currencyLabel')), currency) : null,
          el('div', { class: 'field' }, el('label', { for: whoId }, t('org.whoApproves')), who, badgeHolder),
          facts, makeRule);
      }));
  }

  function rulesPanel(map) {
    return el('section', { class: 'card', dataset: { panel: 'rules' } }, el('h2', {}, t('org.rulesTitle')), el('p', { class: 'muted' }, t('org.rulesLead')),
      map.clauses.length ? map.clauses.map(c => {
        const allConfirmed = c.examples.every(e => e.confirmed);
        const coverId = uid('cover');
        const cover = el('textarea', { id: coverId, rows: 2, on: { input: e => { c.doesNotCover = e.target.value; } } }, c.doesNotCover);
        return el('div', { dataset: { rule: c.id } },
          el('h3', { tabindex: '-1' }, c.statement),
          el('p', {}, el('span', { class: 'chip' }, t(`org.layers.${c.layer}`)), ' ', c.owner.principal === 'you' ? t('org.ownedByYou') : t('org.ownedBy', { owner: nameOf(map, c.owner.principal) })),
          el('h4', {}, t('org.isThisYourRule')),
          el('ol', {}, c.examples.map(e => el('li', { dataset: { example: String(e.n) } }, e.label, ': ',
            el('select', { 'aria-label': t('org.caseAnswer', { n: e.n }), on: { change: ev => { e.answer = ev.target.value; e.confirmed = true; } } }, ['allowed', 'held', 'blocked'].map(a => el('option', { value: a, selected: e.answer === a }, t(`org.answers.${a}`)))),
            e.confirmed ? el('span', { class: 'mark-ok' }, ' ✓') : null))),
          allConfirmed ? el('p', { class: 'ok-text' }, t('org.confirmed')) : el('div', { class: 'actions' }, el('button', { type: 'button', class: 'primary', dataset: { action: 'confirm-examples' }, on: { click: () => { c.examples.forEach(e => { e.confirmed = true; }); say(t('org.confirmed')); rerender(`[data-rule="${c.id}"] h3`); } } }, t('org.theseAreRight'))),
          el('p', {}, t('org.whenBroken')),
          c.check?.excludeRequester ? plannedLine(t('org.requesterPlanned'), '#/runs', t('org.requesterInstead')) : null,
          el('div', { class: 'field' }, el('label', { for: coverId }, t('org.doesNotCover')), cover),
          el('p', { class: 'muted small' }, t('org.examplesBecomeTests')));
      }) : el('p', { class: 'muted' }, t('org.noRulesYet')));
  }

  function wherePanel(map) {
    return el('section', { class: 'card', dataset: { panel: 'where' } }, el('h2', {}, t('org.whereTitle')),
      el('fieldset', {}, el('legend', {}, t('org.aiLegend')), ['none', 'mercury'].map(v => el('label', { class: 'check-row' }, el('input', { type: 'radio', name: 'org-ai', checked: map.where.allowedAI === v, on: { change: () => { map.where.allowedAI = v; } } }), el('span', {}, t(`settings.ai.${v}`))))),
      el('label', { class: 'check-row' }, el('input', { type: 'checkbox', checked: map.where.practiceOnly, on: { change: e => { map.where.practiceOnly = e.target.checked; } } }), el('span', {}, t('settings.practiceLabel'))),
      el('p', { class: 'muted' }, t('org.recordsHere')));
  }

  function changeStrip() {
    return el('section', { class: 'strip', dataset: { panel: 'change' } }, el('p', {}, el('b', {}, t('org.changeTitle')), ' ', t('org.changeBody')));
  }

  draw();
  return root;
}
const nameOf = (map, id) => map.principals.find(p => p.id === id)?.name ?? (id === 'you' ? 'You' : id ?? '?');
