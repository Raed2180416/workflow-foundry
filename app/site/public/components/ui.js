// Shared parts of the site (SPEC §13.4): status chips, the paid badge, ask fields, check lists, the error panel, snippets,
// the step marker, drop zone, column mapper, the list of things a run would make, and the turn-on and action cards.
import { el, frag, id, plural, clear, day } from './dom.js';
import { t, rich, api, decide, say, toast, download, navigate, refreshBadge, focusOn } from '../site.js';

// ------------------------------------------------------------------------------------------------ busy controls
// UX review 2026-10-21 (M1, m9): a button that is working stays focusable (aria-disabled, never `disabled`, which drops keyboard focus to
// the page in Chromium), shows that it is working (aria-busy and a visible mark, site.css), and ignores a second press until it is done.
/** Mark a control busy (or not). A busy control refuses presses (see once()). */
export function busy(control, on) {
  if (!control) return;
  if (on) { control.setAttribute('aria-busy', 'true'); control.setAttribute('aria-disabled', 'true'); }
  else { control.removeAttribute('aria-busy'); control.removeAttribute('aria-disabled'); }
}
/** A click handler that runs once at a time: a press while the control is busy does nothing. fn(event, control) may be async. */
export function once(fn) {
  return async e => {
    const control = e.currentTarget;
    if (control?.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
    busy(control, true);
    try { await fn(e, control); } finally { if (control?.isConnected) busy(control, false); }
  };
}
/** Put an error panel in a container and move focus to it, so a keyboard or screen-reader user lands on what went wrong (M1). */
export function showError(container, error, options = {}) {
  const panel = errorPanel(error, options);
  container.replaceChildren(panel);
  focusOn(panel.querySelector('h2'));
  return panel;
}

// ------------------------------------------------------------------------------------------------ status
const MARK = { works: '✓', preview: '•', planned: '○', undecided: '?', decided: '✓', limit: '!', notRetested: '!', research: '◇', literature: '◇' };
/** Works now / Preview / Not re-tested / Planned / Not decided / Decided / Limit / Research result / Literature, always a word and a mark. */
export function statusChip(kind) { return el('span', { class: 'status', dataset: { chip: kind } }, el('span', { 'aria-hidden': 'true' }, MARK[kind] ?? '•'), t(`status.${kind}`)); }
// Honesty review M5: a research result and the literature have their own words, so neither reads as "Works now".
export const statusOf = word => ({ 'Works now': 'works', Preview: 'preview', 'Not re-tested': 'notRetested', Planned: 'planned', 'Not decided': 'undecided', Decided: 'decided', Limit: 'limit',
  'Research result': 'research', Literature: 'literature' })[word] ?? 'planned';
/** A Planned thing always comes with what the person can do today instead (SPEC R7). */
export function plannedLine(label, insteadHref, insteadText) {
  return el('p', { dataset: { status: 'planned' } }, statusChip('planned'), ' ', label, ' ', el('a', { href: insteadHref, dataset: { instead: '' } }, insteadText ?? t('common.insteadToday')));
}

// ------------------------------------------------------------------------------------------------ the paid line
/** "Team plan" as a disclosure next to the field it applies to: never a wall, never a modal. */
export function paidBadge(explanation) {
  const noteId = id('paid');
  const note = el('div', { id: noteId, class: 'paid-note', hidden: true }, explanation ?? t('paid.explain'), ' ', el('a', { href: '#/pricing' }, t('paid.what')));
  const button = el('button', { type: 'button', class: 'paid', 'aria-expanded': 'false', 'aria-controls': noteId, dataset: { paid: '' },
    on: { click: () => { const open = button.getAttribute('aria-expanded') !== 'true'; button.setAttribute('aria-expanded', String(open)); note.hidden = !open; } } }, t('paid.badge'));
  return { button, note };
}

// ------------------------------------------------------------------------------------------------ asks
/** A question whose wrong guess is harmful: label = question, why and if-you-skip described, data-ask = the harm class (SPEC R2). */
export function askField({ name, label, why, skip, harm, input }) {
  const whyId = id('why'), errId = id('err');
  input.setAttribute('aria-describedby', `${whyId} ${errId}`);
  input.dataset.ask = harm ?? 'ask';
  if (!input.id) input.id = id(`ask-${name}`);
  const error = el('p', { id: errId, class: 'field-error', hidden: true });
  const node = el('div', { class: 'field', dataset: { field: name } },
    el('label', { for: input.id }, label), input,
    el('p', { id: whyId, class: 'field-help' }, why ? frag(el('b', {}, t('ask.why')), ' ', why) : null, why && skip ? el('br') : null, skip ? frag(el('b', {}, t('ask.skip')), ' ', skip) : null),
    error);
  node.showError = message => { error.hidden = !message; error.textContent = message ?? ''; input.setAttribute('aria-invalid', message ? 'true' : 'false'); };
  return node;
}

// ------------------------------------------------------------------------------------------------ checks
// Each check in its plain sentence (a check with no plain sentence shows its exact form). "How" lines are for developers and IT, so they
// are off by default; howNote() explains both kinds once, under a disclosure (P2 walkthrough M6, P3 M14). "Not checked yet" is visible
// text, not only a mark (P5 walkthrough minor 8).
export function checkList(checks, { how = false } = {}) {
  return el('ul', { class: 'checks' }, checks.map(c => {
    const mark = c.passed === true ? ['✓', 'mark-ok', t('checks.passed')] : c.passed === false ? ['✗', 'mark-bad', t('checks.failed')] : ['…', 'mark-wait', t('checks.notRun')];
    const isVerify = String(c.id ?? '').startsWith('verify.');
    return el('li', {}, el('span', { class: mark[1], 'aria-hidden': 'true' }, mark[0]),
      el('span', {}, c.passed === null || c.passed === undefined ? null : el('span', { class: 'sr-only' }, `${mark[2]}: `), c.plain ?? c.exact,
        c.passed === null || c.passed === undefined ? el('span', { class: 'muted' }, ` (${t('checks.notRun').toLowerCase()})`) : null),
      how ? el('span', { class: 'how' }, isVerify ? t('checks.howVerify') : t('checks.howRule')) : null);
  }));
}
export const howNote = () => el('details', {}, el('summary', {}, t('checks.howTitle')), el('p', { class: 'small' }, t('checks.howBody')));
/** Rows a run would add to a list, as a small table (P2 walkthrough M14: raw JSON cut off mid-word). */
export function rowsTable(rows) {
  const cols = [...new Set(rows.flatMap(r => Object.keys(r ?? {})))].filter(k => k !== 'at').slice(0, 6);
  return el('div', { class: 'table-wrap' }, el('table', { class: 'rows-table' }, el('thead', {}, el('tr', {}, cols.map(c => el('th', { scope: 'col' }, c)))),
    el('tbody', {}, rows.map(r => el('tr', {}, cols.map(c => el('td', {}, r?.[c] === null || r?.[c] === undefined ? '' : String(r[c]))))))));
}

// ------------------------------------------------------------------------------------------------ errors
/** Four parts, always: what happened, what was not done, what to do (an action), details (collapsed). */
// UX review m7: "what was not done" is said by each caller for its own action (nothing could be sent by saving a setting); the default,
// for a caller that forgets, claims nothing (app/site/test/review-ux.test.mjs checks that every caller passes its own).
export function errorPanel(error, { action = null, notDone = null } = {}) {
  const problem = error?.problem ?? error?.data?.problem ?? null;
  const what = problem?.what ?? error?.message ?? t('errors.unknown');
  const next = problem?.next ?? null;
  const code = error?.code ?? problem?.code ?? error?.data?.error?.code ?? null;
  const act = action ? (action.href ? el('a', { class: 'button', href: action.href }, action.label) : el('button', { type: 'button', on: { click: action.onClick } }, action.label))
    : el('a', { class: 'button', href: '#/' }, t('common.backHome'));
  return el('div', { class: 'error-panel', role: 'alert', dataset: { errorPanel: '' } },
    el('h2', { tabindex: '-1' }, t('errors.title')),
    el('dl', {}, el('dt', {}, t('errors.what')), el('dd', {}, what), el('dt', {}, t('errors.notDone')), el('dd', {}, notDone ?? t('errors.notFinished')),
      el('dt', {}, t('errors.todo')), el('dd', {}, next ? el('p', {}, next) : null, el('div', { class: 'actions', dataset: { errorAction: '' } }, act))),
    code ? el('details', {}, el('summary', {}, t('errors.details')), el('pre', {}, `${code}${error?.data?.error?.message && error.data.error.message !== what ? `\n${error.data.error.message}` : ''}`)) : null);
}

// ------------------------------------------------------------------------------------------------ snippet, step marker
export function snippet(textValue, { label, copyLabel } = {}) {
  const pre = el('pre', { tabindex: '0', 'aria-label': label ?? t('snippet.label') }, textValue);
  const button = el('button', { type: 'button', class: 'small', on: { click: async () => {
    try { await navigator.clipboard.writeText(textValue); toast(t('snippet.copied')); }
    catch { selectText(pre); toast(t('snippet.selected')); }
  } } }, copyLabel ?? t('snippet.copy'));
  return el('div', { class: 'snippet' }, pre, el('div', { class: 'actions' }, button));
}
/** Select a node's text, so "press Ctrl+C" is true when the page says it (UX review m2). */
export function selectText(node) { const r = document.createRange(); r.selectNodeContents(node); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
/** Copy a value; where the browser refuses, select it in `node` (a visible element holding exactly that text) and say so. */
export async function copyOrSelect(value, node, copiedText = t('snippet.copied')) {
  try { await navigator.clipboard.writeText(value); toast(copiedText); }
  catch { if (node) { selectText(node); toast(t('snippet.selected')); } else toast(t('snippet.notCopied')); }
}
const STEPS = ['settings', 'test', 'turnOn', 'goLive'];
export function stepper(current) {
  const i = STEPS.indexOf(current);
  return el('ol', { class: 'stepper', 'aria-label': t('steps.label') }, STEPS.map((s, j) => el('li', { ...(j === i ? { 'aria-current': 'step' } : {}), class: j < i ? 'done' : null },
    el('span', { 'aria-hidden': 'true' }, j < i ? '✓' : j === i ? '●' : '○'), t('steps.item', { n: j + 1, total: STEPS.length, name: t(`steps.${s}`) }),
    j < i ? el('span', { class: 'sr-only' }, ` ${t('steps.done')}`) : null)));
}

// ------------------------------------------------------------------------------------------------ drop zone and column mapper
/** A real file button (drag is optional, WCAG 2.5.7). onText(text, file) gets the file's text. */
// Excel, Numbers and OpenDocument files can be picked (so the picker doesn't hide them), and are answered with how to save a CSV, never
// read as text (P2 walkthrough M3: an .xlsx dropped here gave binary garbage as column names).
const SPREADSHEET = /\.(xlsx|xlsm|xls|numbers|ods)$/i;
// UX review m8: a file dropped just outside a drop zone must not make the browser open it and leave Foundry. Installed once.
let windowDropGuard = false;
function guardWindowDrops() {
  if (windowDropGuard) return;
  windowDropGuard = true;
  const stray = e => { if (!e.target?.closest?.('.drop') && [...(e.dataTransfer?.types ?? [])].includes('Files')) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'; } };
  window.addEventListener('dragover', stray); window.addEventListener('drop', stray);
}
export function dropZone({ label, help, onText, harm = 'wrong-file' }) {
  guardWindowDrops();
  const input = el('input', { type: 'file', accept: '.csv,.tsv,.txt,.json,.xlsx,.xls,.numbers,.ods,text/csv,application/json', dataset: { ask: harm } });
  input.id = id('file');
  const note = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const zone = el('div', { class: 'drop' }, el('label', { for: input.id }, label), help ? el('p', { class: 'field-help' }, help) : null, input, note);
  // Problems with the file are said here, next to the button, and stay until the next file (m2: "too big" was a toast that vanished).
  const read = async file => {
    if (!file) return;
    note.hidden = true;
    if (file.size > 5 * 1024 * 1024) { note.textContent = t('drop.tooBig'); note.hidden = false; return; }
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const zipOrOle = (head[0] === 0x50 && head[1] === 0x4b) || (head[0] === 0xd0 && head[1] === 0xcf);
    if (SPREADSHEET.test(file.name) || zipOrOle) { note.textContent = t('drop.excel'); note.hidden = false; return; }
    onText(await file.text(), file);
  };
  // The input is emptied after each pick, so picking the same file again (after fixing it, or after an error) is read again (m8).
  input.addEventListener('change', async () => { const file = input.files[0]; try { await read(file); } finally { input.value = ''; } });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); read(e.dataTransfer.files[0]); });
  return zone;
}
/** One select per needed column, with three sample values; returns { node, mapping() }. */
export function columnMapper(preview) {
  const selects = {};
  const node = el('div', { class: 'mapper' }, preview.needed.map(n => {
    const sel = el('select', { id: id(`col-${n.name}`), dataset: { column: n.name } },
      n.optional || !n.header ? el('option', { value: '' }, n.optional ? t('drop.notInFile') : t('drop.choose')) : null,
      preview.columns.map(h => el('option', { value: h, selected: h === n.header }, h)));
    selects[n.name] = sel;
    const samples = el('p', { class: 'samples' });
    const showSamples = () => { const s = preview.columnSamples?.[sel.value] ?? []; samples.textContent = sel.value ? t('drop.samples', { values: s.join(', ') || t('drop.empty') }) : ''; };
    sel.addEventListener('change', showSamples); showSamples();
    return el('div', { class: 'field' }, el('label', { for: sel.id }, t('drop.whichColumn', { plain: n.plain })), sel, samples);
  }));
  return { node, mapping: () => Object.fromEntries(Object.entries(selects).map(([k, s]) => [k, s.value || null])),
    set: (name, header) => { const s = selects[name]; if (s && [...s.options].some(o => o.value === header)) { s.value = header; s.dispatchEvent(new Event('change')); } } };
}
/** The ambiguity questions (date order, decimal separator, which values mean "still open"): radios or checkboxes, data-ask set. */
export function dataQuestions(questions, { onColumn = null } = {}) {
  const read = {};
  const node = el('div', {}, questions.map(q => {
    const name = id('q');
    // An answer from the last file of the same kind is already chosen, and says so (UX review m4; WCAG 3.3.7): change it if this file differs.
    const memo = q.remembered ? el('p', { class: 'field-help', dataset: { remembered: q.id } }, t('drop.remembered', { date: day(q.remembered.at) })) : null;
    if (q.kind === 'choice') {
      const radios = q.choices.map(c => el('input', { type: 'radio', name, value: c.value, checked: q.remembered?.value === c.value, dataset: { ask: q.harm } }));
      // "Which of these columns is it?" keeps the column chooser above in step with the answer.
      if (q.syncColumn && onColumn) radios.forEach(r => r.addEventListener('change', () => { if (r.checked) onColumn(q.syncColumn, r.value); }));
      read[q.id] = () => radios.find(r => r.checked)?.value ?? null;
      return el('fieldset', { dataset: { question: q.id } }, el('legend', {}, q.question), el('p', { class: 'field-help' }, el('b', {}, t('ask.why')), ' ', q.why, el('br'), el('b', {}, t('ask.skip')), ' ', q.skip),
        memo, q.choices.map((c, i) => el('label', { class: 'check-row' }, radios[i], el('span', {}, c.label))));
    }
    const was = Array.isArray(q.remembered?.value) ? q.remembered.value : null;
    const boxes = q.choices.map(c => el('input', { type: 'checkbox', value: c.value, checked: !!was?.includes(c.value), dataset: { ask: q.harm } }));
    let touched = !!was; boxes.forEach(b => b.addEventListener('change', () => { touched = true; }));
    const none = el('input', { type: 'checkbox', value: '', checked: !!was && !was.length, dataset: { ask: q.harm, none: '' } });
    none.addEventListener('change', () => { touched = true; if (none.checked) boxes.forEach(b => { b.checked = false; }); });
    boxes.forEach(b => b.addEventListener('change', () => { if (b.checked) none.checked = false; }));
    read[q.id] = () => (touched || boxes.some(b => b.checked) || none.checked ? boxes.filter(b => b.checked).map(b => b.value) : null);
    return el('fieldset', { dataset: { question: q.id } }, el('legend', {}, q.question), el('p', { class: 'field-help' }, el('b', {}, t('ask.why')), ' ', q.why, el('br'), el('b', {}, t('ask.skip')), ' ', q.skip),
      memo, q.choices.map((c, i) => el('label', { class: 'check-row' }, boxes[i], el('span', {}, c.label))), el('label', { class: 'check-row' }, none, el('span', {}, t('drop.noneOfThem'))));
  }));
  const answers = () => Object.fromEntries(Object.entries(read).map(([k, f]) => [k, f()]));
  /** Before anything is sent: the first question still unanswered gets the message and the focus. Returns true when all are answered. */
  const check = () => {
    node.querySelectorAll('[data-unanswered]').forEach(n => n.remove());
    const missing = Object.entries(answers()).filter(([, v]) => v === null).map(([k]) => k);
    if (!missing.length) return true;
    const box = node.querySelector(`fieldset[data-question="${CSS.escape(missing[0])}"]`);
    box?.append(el('p', { class: 'field-error', role: 'alert', dataset: { unanswered: '' } }, t('make.answerFirst')));
    box?.querySelector('input')?.focus();
    return false;
  };
  return { node, answers, check };
}

// ------------------------------------------------------------------------------------------------ the exact list (batch)
const isMail = item => item.action === 'send';
// The fingerprint of the list exactly as this card shows it (security review 2026-10-21, M7). It is the same sha256 the server computes
// in app/onboarding/batch.mjs (listDigest): canonical JSON (keys sorted, no spaces) of each item's tool and the to, subject and full text
// shown, then of the batch id, the version's hash and those item fingerprints. The yes carries it; a list that changed is refused.
const canon = v => Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v);
const sha256hex = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
export async function shownListDigest(batch) {
  const items = await Promise.all(batch.items.map(i => sha256hex(canon(i.action === 'post' ? { tool: 'chat.post', args: { channel: i.to, text: i.body } } : { tool: 'outbox.send', args: { to: i.to, subject: i.subject, body: i.body } }))));
  return sha256hex(canon({ batchId: batch.batchId, workflowHash: batch.workflowHash, items }));
}
/** Every item in full: who, subject, the exact text. */
export function itemsList(items) {
  return el('ol', { class: 'items' }, items.map(i => el('li', { dataset: { item: String(i.n ?? '') } },
    el('div', { class: 'head' }, el('span', {}, el('b', {}, isMail(i) ? t('items.to') : t('items.postTo')), ' ', i.to), i.subject ? el('span', {}, el('b', {}, t('items.subject')), ' ', i.subject) : null),
    el('pre', {}, i.body ?? i.preview ?? ''))));
}
/** "Make these N drafts?" for one batch: Make / Don't make any. onDone(result) after the person decides. */
// The notes a card adds before the yes (app/onboarding/cards.mjs). A firmer reminder as a customer's first contact turns the yes into
// "I've reminded them before" and the no into "I haven't" (P2 walkthrough B4): the same one click, with the condition in its label.
function batchNotes(batch) {
  const notes = batch.notes ?? [];
  const firm = notes.find(x => x.kind === 'firm-first');
  const sent = notes.find(x => x.kind === 'already-sent'), answered = notes.find(x => x.kind === 'answered');
  return { firm, node: notes.length ? el('div', { class: 'banner wait', dataset: { notes: notes.map(x => x.kind).join(' ') } },
    firm ? el('p', {}, el('b', {}, t('batch.firmFirstTitle')), ' ', t('batch.firmFirst', { who: firm.invoices.map(x => `${x.invoice} (${x.to})`).join(', ') })) : null,
    sent ? el('p', {}, t('batch.alreadySent', { n: sent.count, who: sent.approver ?? t('who.thatPerson'), date: day(sent.at) })) : null,
    answered ? el('p', {}, t('batch.answered', { n: answered.count })) : null) : null };
}
/** "Make these N drafts?" for one batch: Make / Don't make any. onDone(result) after the person decides. */
export function batchCard(batch, { onDone } = {}) {
  const n = batch.items.length, mails = batch.items.every(isMail);
  const headId = id('batch');
  const status = el('div', { role: 'status' });
  const notes = batchNotes(batch);
  const yesLabel = notes.firm ? (n === 1 ? t('batch.firmFirstYesOne') : t('batch.firmFirstYesMany', { n })) : mails ? (n === 1 ? t('batch.makeOne') : t('batch.makeMany', { n })) : t('batch.do', { n });
  const yes = el('button', { type: 'button', class: 'primary', dataset: { ask: 'irreversible', action: 'batch-approve' } }, yesLabel);
  const no = el('button', { type: 'button', dataset: { action: 'batch-decline' } }, notes.firm ? t('batch.firmFirstNo') : mails ? t('batch.makeNone') : t('batch.doNone'));
  // One decision at a time: while either button works, both refuse a press (m9); both stay focusable (M1); an error gets the focus.
  const deciding = () => yes.getAttribute('aria-disabled') === 'true' || no.getAttribute('aria-disabled') === 'true';
  yes.addEventListener('click', async e => {
    if (!e.isTrusted || deciding()) return;
    busy(yes, true); no.setAttribute('aria-disabled', 'true'); say(t('batch.making'));
    try {
      const r = await api('/api/batch/approve', { batchId: batch.batchId, listDigest: await shownListDigest(batch) });
      say(r.stoppedAt ? t('batch.stopped') : r.made.length === 1 ? t('batch.madeOne') : t('batch.madeMany', { n: r.made.length }));
      refreshBadge(); onDone?.(r);
    } catch (error) { showError(status, error, { notDone: t('batch.notMade') }); }
    finally { busy(yes, false); no.removeAttribute('aria-disabled'); }
  });
  no.addEventListener('click', async e => {
    if (!e.isTrusted || deciding()) return;
    busy(no, true); yes.setAttribute('aria-disabled', 'true');
    try { await api('/api/batch/decline', { batchId: batch.batchId }); say(t('batch.declined')); refreshBadge(); onDone?.({ declined: true, firmFirst: !!notes.firm }); }
    catch (error) { showError(status, error, { notDone: t('batch.notDeclined') }); }
    finally { busy(no, false); yes.removeAttribute('aria-disabled'); }
  });
  return el('article', { class: 'card emph waiting', 'aria-labelledby': headId, dataset: { decisionCard: '', batch: batch.batchId } },
    el('h2', { id: headId }, mails ? (n === 1 ? t('batch.titleDraftsOne') : t('batch.titleDraftsMany', { n })) : t('batch.title', { n, title: batch.title })),
    el('p', {}, t('batch.lead', { version: batch.version, date: day(batch.input?.now) })),
    batch.remembered ? el('p', { class: 'muted' }, t('batch.remembered')) : null,
    notes.node,
    itemsList(batch.items),
    batch.alsoDoes?.length ? el('p', {}, batch.alsoDoes.map(a => t('batch.alsoAppends', { rows: a.rows, sheet: a.sheet })).join(' ')) : null,
    el('p', { class: 'muted' }, t('batch.guard')),
    mails ? el('p', { class: 'muted' }, t('batch.countsNote')) : null,
    el('div', { class: 'actions stack decision' }, yes, no), status);
}

// ------------------------------------------------------------------------------------------------ one paused action
export function actionCard(action, full, { onDone } = {}) {
  const mail = action.tool === 'outbox.send';
  const headId = id('act');
  const args = full?.args ?? {};
  const status = el('div', { role: 'status' });
  // A second press, or a press on the other button while one works, does nothing (m9); busy ends on an error too.
  let working = false;
  const press = approved => async e => {
    const source = e.currentTarget;
    if (working) return;
    working = true; busy(source, true);
    try { await decide(e, { kind: 'action', runId: action.runId, approvalId: action.approvalId, decision: approved ? 'approve' : 'reject' }, source); say(approved ? t('action.done') : t('action.refused')); refreshBadge(); onDone?.(); }
    catch (error) { showError(status, error, { notDone: t('action.notDecided') }); }
    finally { working = false; busy(source, false); }
  };
  return el('article', { class: 'card emph waiting', 'aria-labelledby': headId, dataset: { decisionCard: '', action: action.approvalId } },
    el('h2', { id: headId }, mail ? t('action.titleDraft') : t('action.titlePost')),
    el('p', { class: 'muted' }, action.step),
    itemsList([{ action: mail ? 'send' : 'post', to: args.to ?? args.channel ?? action.to, subject: args.subject ?? action.subject, body: args.body ?? args.text ?? action.preview ?? '' }]),
    el('div', { class: 'actions stack decision' }, el('button', { type: 'button', class: 'primary', dataset: { ask: 'irreversible' }, on: { click: press(true) } }, t('action.yes')),
      el('button', { type: 'button', on: { click: press(false) } }, t('action.no'))), status);
}

// ------------------------------------------------------------------------------------------------ "Who decides"
/** The three honest answers to "who else has to say yes" (SPEC §1 fix 6, §7.3). Returns { node, value() }. */
// "Just me, nobody else needs to know" is gone: the card always e-mails the approver, so that answer did nothing (P3 walkthrough B3).
export function whoDecides({ name, onChange } = {}) {
  const group = id('who');
  const who = name || t('who.thatPerson');
  const opts = [['inform', t('who.inform', { who }), t('who.free')], ['team', t('who.team', { who }), null]];
  const radios = opts.map(([v], i) => el('input', { type: 'radio', name: group, value: v, checked: i === 0, dataset: { ask: 'self-approval' } }));
  const paid = paidBadge(t('who.teamExplain', { who }));
  const node = el('fieldset', { dataset: { who: '' } }, el('legend', {}, t('who.legend')),
    opts.map(([v, label, chip], i) => el('div', {}, el('label', { class: 'check-row' }, radios[i], el('span', {}, label, ' ', chip ? el('span', { class: 'chip' }, chip) : null)),
      v === 'team' ? el('div', {}, paid.button, paid.note) : null)));
  radios.forEach(r => r.addEventListener('change', () => onChange?.(r.value)));
  return { node, value: () => radios.find(r => r.checked)?.value ?? 'inform', paid };
}

export { el, frag, plural, clear, navigate, download, say, toast, rich, t, focusOn };
