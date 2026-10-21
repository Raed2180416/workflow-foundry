// The make page (#/make/:template): the card's restatement, its visible defaults, and only the questions a wrong guess would make
// harmful (SPEC §9.3, R2). "Test it" makes a version-bound draft with the form builder ($0, no AI) and tests it on pretend data.
import { el, t, api, templates, memory, navigate, say } from '../site.js';
import { askField, errorPanel, stepper, whoDecides, paidBadge, statusChip } from '../components/ui.js';
import { id as uid } from '../components/dom.js';

const shown = (slot, v) => slot.type === 'boolean' ? (v ? t('make.yes') : t('make.no')) : v === '' || v === null || v === undefined ? (slot.emptyLabel ?? t('make.none')) : String(v);

export async function render({ params, query }) {
  const list = await templates();
  const tpl = list.find(x => x.id === params[0]);
  if (!tpl) return el('div', {}, el('h1', {}, t('make.unknownTitle')), el('p', {}, el('a', { href: '#/' }, t('common.seeAll'))));
  const flowId = query.get('flow');
  let base = {};
  if (flowId) { try { base = (await api(`/api/automations/${encodeURIComponent(flowId)}`)).slots ?? {}; } catch { base = {}; } }
  const slotByName = Object.fromEntries(tpl.slots.map(s => [s.name, s]));
  const changed = {};            // what the person typed or changed on this page
  const value = name => name in changed ? changed[name] : name in base ? base[name] : (slotByName[name].siteDefault ?? slotByName[name].default);
  const settings = () => {
    const out = {};
    for (const s of tpl.slots) {
      if (s.name in changed) out[s.name] = changed[s.name];
      else if (s.siteDefault !== null && s.siteDefault !== undefined && !(s.name in base)) out[s.name] = s.siteDefault;
    }
    for (const [k, v] of Object.entries(out)) if (v === '' && slotByName[k].type === 'email') delete out[k];
    return out;
  };

  // Values a rule owner set in "Who decides what" arrive answered ("€250 · Set by Dana (Org policy)"), not asked.
  const first = await api('/api/restate', { template: tpl.id, settings: { ...base, ...settings() } }).catch(() => null);
  const setBy = Object.fromEntries((first?.setBy ?? []).map(x => [x.slot, x]));

  // ---------------------------------------------------------------- the restatement ("I'll do this"), refreshed as the person edits
  const willList = el('ul', { id: 'will-do' }), wontList = el('ul', {}), problemsBox = el('div', { role: 'status' });
  let timer = null;
  const restate = () => { clearTimeout(timer); timer = setTimeout(async () => {
    try {
      const r = await api('/api/restate', { template: tpl.id, settings: { ...base, ...settings() } });
      willList.replaceChildren(...r.willDo.map(x => el('li', {}, x)));
      wontList.replaceChildren(...r.willNotDo.map(x => el('li', {}, x)));
      problemsBox.replaceChildren(...(r.problems.length ? [el('div', { class: 'banner bad' }, el('p', {}, el('b', {}, t('make.problemsTitle'))), el('ul', {}, r.problems.map(p => el('li', {}, p))))] : []));
    } catch { /* the restatement is a preview; the draft is checked again on Test */ }
  }, 200); };

  // ---------------------------------------------------------------- questions (asks)
  const askNodes = {};
  const questions = el('div', {});
  let decider = null;
  function askInput(s) {
    const type = s.inputType === 'number' ? 'number' : s.inputType === 'email' ? 'email' : 'text';
    const input = el('input', { type, name: s.name, placeholder: s.placeholder ?? '', autocomplete: s.name === 'summaryTo' || s.name === 'reportTo' ? 'email' : 'off',
      ...(type === 'number' ? { step: 'any', min: s.min ?? 0, inputmode: 'decimal' } : {}), value: changed[s.name] ?? base[s.name] ?? setBy[s.name]?.value ?? '' });
    input.addEventListener('input', () => { changed[s.name] = type === 'number' ? (input.value === '' ? '' : Number(input.value)) : input.value.trim(); askNodes[s.name]?.showError(null); restate(); if (s.name === tpl.decider) decider?.rename(input.value.trim()); });
    return input;
  }
  let askKey = null;
  function renderAsks() {
    const active = tpl.slots.filter(s => s.kind === 'ask' && (!s.askWhen || value(s.askWhen) === true || slotByName[s.askWhen]?.kind === 'toggle'));
    const key = active.map(s => s.name).join(',');
    if (key === askKey) return; // the same questions: keep what the person is typing, and their focus
    askKey = key;
    questions.replaceChildren();
    if (active.length) questions.append(el('h2', {}, active.length === 1 ? t('make.questionOne') : t('make.questionsMany')));
    for (const s of active) {
      const toggle = s.askWhen && slotByName[s.askWhen]?.kind === 'toggle' ? slotByName[s.askWhen] : null;
      if (s.askWhen && !toggle && value(s.askWhen) !== true) continue;
      const input = askInput(s);
      const node = askField({ name: s.name, label: s.label ?? s.question, why: s.why, skip: s.skip, harm: s.harm, input });
      askNodes[s.name] = node;
      if (setBy[s.name]) node.insertBefore(el('p', { class: 'chip', dataset: { setBy: s.name } }, setBy[s.name].text), node.querySelector('input'));
      if (setBy[s.name]) node.append(el('p', { class: 'field-help' }, t('make.setBy')));
      if (toggle) {
        const off = el('input', { type: 'checkbox', checked: value(toggle.name) === false });
        const sync = () => { input.disabled = off.checked; if (off.checked) node.showError(null); };
        off.addEventListener('change', () => { changed[toggle.name] = !off.checked; sync(); restate(); });
        sync();
        node.append(el('label', { class: 'check-row' }, off, el('span', {}, toggle.offLabel ?? t('make.none'))));
      }
      questions.append(node);
      if (s.name === tpl.decider) {
        decider = whoDecides({ name: input.value.trim() });
        const holder = el('div', {}, decider.node);
        decider.rename = who => { const fresh = whoDecides({ name: who }); const v = decider.value(); holder.replaceChildren(fresh.node); fresh.node.querySelector(`input[value="${v}"]`).checked = true; fresh.rename = decider.rename; decider = fresh; };
        questions.append(holder);
      }
    }
    // Rows the person types (routing rules, canned answers): addresses in them are questions too.
    for (const s of tpl.slots.filter(x => x.kind === 'list')) questions.append(listEditor(s));
    // Plain fields the person may fill (the e-mails' signature): shown, never a question (no data-ask: a default here harms nobody).
    for (const s of tpl.slots.filter(x => x.kind === 'field')) {
      const fid = uid(`field-${s.name}`), helpId = uid('help');
      const input = el('input', { type: 'text', id: fid, name: s.name, autocomplete: 'off', placeholder: s.placeholder ?? '', value: changed[s.name] ?? base[s.name] ?? '', 'aria-describedby': helpId,
        on: { input: e => { const v = e.target.value.trim(); if (v) changed[s.name] = v; else delete changed[s.name]; restate(); } } });
      questions.append(el('div', { class: 'field', dataset: { field: s.name } }, el('label', { for: fid }, s.label), input, s.help ? el('p', { id: helpId, class: 'field-help' }, s.help) : null));
    }
  }
  function listEditor(s) {
    const rows = Array.isArray(value(s.name)) ? value(s.name).map(r => ({ ...r })) : [];
    const box = el('div', {});
    const sync = () => { changed[s.name] = rows.filter(r => Object.values(r).some(v => v !== '' && v !== undefined)); restate(); };
    const draw = () => {
      box.replaceChildren(...rows.map((row, i) => el('fieldset', { dataset: { row: String(i) } }, el('legend', {}, t('make.rowN', { n: i + 1 })),
        s.fields.filter(f => !f.hidden).map(f => {
          const fid = uid(`${s.name}-${f.name}`);
          let input;
          if (f.choices) {
            input = el('select', { id: fid }, Object.entries(f.choices).map(([v, label]) => el('option', { value: v, selected: row[f.name] === v }, label)));
            if (!row[f.name]) row[f.name] = Object.keys(f.choices)[0];
          } else if (f.multiline) input = el('textarea', { id: fid, rows: 3 }, row[f.name] ?? '');
          else input = el('input', { id: fid, type: f.type === 'email' || f.ask ? 'email' : 'text', value: row[f.name] ?? '', autocomplete: 'off' });
          if (f.ask) input.dataset.ask = 'wrong-target';
          const update = () => { row[f.name] = input.value.trim(); if (s.name === 'rules') row.op = ['companySize', 'budget'].includes(row.field) ? 'atLeast' : 'is'; sync(); };
          input.addEventListener(f.choices ? 'change' : 'input', update);
          if (s.name === 'rules' && !row.op) row.op = ['companySize', 'budget'].includes(row.field) ? 'atLeast' : 'is';
          return el('div', { class: 'field' }, el('label', { for: fid }, f.label ?? f.name), input);
        }),
        el('button', { type: 'button', class: 'small', on: { click: () => { rows.splice(i, 1); sync(); draw(); } } }, t('make.removeRow')))),
        rows.length < (s.maxItems ?? 6) ? el('button', { type: 'button', on: { click: () => { rows.push({}); draw(); box.querySelector(`fieldset[data-row="${rows.length - 1}"] select, fieldset[data-row="${rows.length - 1}"] input, fieldset[data-row="${rows.length - 1}"] textarea`)?.focus(); } } }, s.addLabel ?? t('make.addRow')) : null);
    };
    draw();
    return el('section', { dataset: { list: s.name } }, el('h3', {}, s.label), s.help ? el('p', { class: 'field-help' }, s.help) : null, box);
  }

  // ---------------------------------------------------------------- visible defaults (editable chips)
  const defaultsList = el('ul', { class: 'prose' });
  function renderDefaults() {
    defaultsList.replaceChildren(...tpl.slots.filter(s => s.kind === 'setting').map(s => {
      const editorId = uid(`edit-${s.name}`);
      const valueSpan = el('span', { class: 'chip' }, shown(s, value(s.name)), s.unit && s.type !== 'boolean' ? ` ${s.unit}` : '');
      let editor;
      if (s.type === 'boolean') editor = el('label', { class: 'check-row' }, el('input', { type: 'checkbox', checked: !!value(s.name), on: { change: e => { changed[s.name] = e.target.checked; refresh(); } } }), el('span', {}, s.label));
      else if (s.type === 'enum') editor = el('select', { 'aria-label': s.label, on: { change: e => { changed[s.name] = e.target.value; refresh(); } } }, s.values.map(v => el('option', { value: v, selected: v === value(s.name) }, v)));
      else editor = el('input', { type: ['integer', 'number'].includes(s.type) ? 'number' : 'text', 'aria-label': s.label, value: value(s.name) ?? '', ...(['integer', 'number'].includes(s.type) ? { min: s.min ?? 0, max: s.max ?? undefined, step: s.type === 'integer' ? 1 : 'any' } : {}),
        on: { change: e => { changed[s.name] = ['integer', 'number'].includes(s.type) ? (e.target.value === '' ? s.default : Number(e.target.value)) : e.target.value; refresh(); } } });
      const holder = el('div', { id: editorId, hidden: true }, editor);
      const toggle = el('button', { type: 'button', class: 'link', 'aria-expanded': 'false', 'aria-controls': editorId, on: { click: () => { const open = holder.hidden; holder.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); if (open) (holder.querySelector('input,select'))?.focus(); } } }, t('make.change'));
      return el('li', { dataset: { setting: s.name } }, el('span', {}, s.label, ': '), valueSpan, ' ', toggle, holder);
    }));
  }
  function refresh() { const focusSetting = document.activeElement?.closest?.('[data-setting]')?.dataset.setting; renderDefaults(); renderAsks(); restate();
    if (focusSetting) defaultsList.querySelector(`[data-setting="${focusSetting}"] input, [data-setting="${focusSetting}"] select`)?.focus(); }

  // ---------------------------------------------------------------- test it
  const status = el('div', {});
  const testButton = el('button', { type: 'button', class: 'primary', dataset: { action: 'test' } }, t('make.test', { noun: tpl.noun }));
  testButton.addEventListener('click', async () => {
    status.replaceChildren();
    for (const n of Object.values(askNodes)) n.showError(null);
    testButton.setAttribute('aria-busy', 'true'); testButton.disabled = true;
    try {
      const p = await api('/api/propose', { template: tpl.id, settings: settings(), ...(flowId ? { flowId } : {}) });
      if (p.status === 'needs_answers') {
        for (const q of p.questions) askNodes[q.slot]?.showError(t('make.answerFirst'));
        const first = p.questions.map(q => askNodes[q.slot]).find(Boolean);
        first?.querySelector('input')?.focus();
        say(t('make.answerFirstSay', { n: p.questions.length }), { assertive: true });
        if (!first) status.replaceChildren(errorPanel({ message: p.questions.map(q => q.question).join(' ') }, { notDone: t('make.nothingMade'), action: { label: t('make.fix'), onClick: () => questions.querySelector('input')?.focus() } }));
        return;
      }
      if (p.status === 'no_change') { status.replaceChildren(el('div', { class: 'banner', role: 'status' }, el('p', {}, t('make.noChange')), el('a', { href: `#/automations/${p.flowId}` }, t('make.openAutomation')))); return; }
      if (p.status !== 'proposed') { status.replaceChildren(errorPanel({ message: p.reply ?? t('errors.unknown'), problem: { what: p.reply, next: p.refusals?.length ? t('make.refusedNext') : (p.problems ?? []).filter(x => x !== p.reply).join(' ') || null } }, { notDone: t('make.nothingMade'), action: { label: t('make.fix'), onClick: () => testButton.focus() } })); return; }
      // "Who decides the bigger ones" is kept with the automation, so a reload or the Waiting page records the same answer (P3 B3).
      if (decider) { memory[`decider:${p.proposalId}`] = { choice: decider.value(), who: value(tpl.decider) }; await api('/api/deciders', { flowId: p.flowId, choice: decider.value(), who: value(tpl.decider) }).catch(() => null); }
      say(t('make.testing', { noun: tpl.noun }));
      const d = await api('/api/practice', { proposalId: p.proposalId });
      say(t('make.tested'));
      memory[`tested:${p.proposalId}`] = d;
      navigate(`/checked/${p.proposalId}`);
    } catch (error) {
      status.replaceChildren(errorPanel(error, { notDone: t('make.nothingMade'), action: { label: t('make.tryAgain'), onClick: () => testButton.click() } }));
    } finally { testButton.removeAttribute('aria-busy'); testButton.disabled = false; }
  });

  renderDefaults(); renderAsks(); restate();
  return el('div', { dataset: { layout: 'narrow' } },
    stepper('settings'),
    el('h1', {}, tpl.card),
    flowId ? el('p', { class: 'banner', role: 'status' }, t('make.changing')) : null,
    el('section', { 'aria-labelledby': 'will-h' }, el('h2', { id: 'will-h' }, t('make.willTitle')), willList,
      el('h3', { id: 'wont-h' }, t('make.wontTitle')), wontList),
    questions,
    el('section', { 'aria-labelledby': 'defaults-h' }, el('h2', { id: 'defaults-h' }, t('make.defaultsTitle')), el('p', { class: 'muted' }, t('make.defaultsLead')), defaultsList),
    el('dl', { class: 'facts' }, el('dt', {}, t('make.usesAI')), el('dd', {}, t('make.usesAINo')), el('dt', {}, t('make.dataGoes')), el('dd', {}, t('make.dataGoesNowhere')),
      el('dt', {}, t('make.runs')), el('dd', {}, t('make.runsWhen'))),
    problemsBox,
    el('div', { class: 'actions stack' }, testButton, el('a', { class: 'button', href: '#/' }, t('make.back'))),
    el('p', { class: 'muted small' }, t('make.testNote')),
    status);
}
