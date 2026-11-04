// The test result (#/checked/:proposalId): what the test of this exact version found, what a test can't prove, an optional test on
// the person's own list (A4), and the turn-on card (SPEC §9.4, §9.5). Turning on doesn't send anything.
import { el, t, api, templates, memory, navigate, say, decide, refreshBadge } from '../site.js';
import { checkList, errorPanel, showError, stepper, whoDecides, dropZone, columnMapper, dataQuestions, statusChip, howNote, rowsTable, busy } from '../components/ui.js';
import { focusOn } from '../site.js';
import { plural, replace } from '../components/dom.js';

/** "4 e-mails would have gone out: 3 to customers and 1 to me@example.com" (counts from the test, words from the card). */
export function wouldDoSummary(wouldDo, slots, noun) {
  const mails = wouldDo.filter(w => w.action === 'send'), posts = wouldDo.filter(w => w.action === 'post'), appends = wouldDo.filter(w => w.action === 'append');
  const own = new Set(Object.values(slots ?? {}).filter(v => typeof v === 'string' && v.includes('@')).map(v => v.toLowerCase()));
  const toOwn = mails.filter(m => own.has(String(m.to).toLowerCase())), toOthers = mails.filter(m => !own.has(String(m.to).toLowerCase()));
  const parts = [];
  if (toOthers.length) parts.push(t('checked.mailsToOthers', { count: plural(toOthers.length, t('checked.email'), t('checked.emails')), noun }));
  for (const addr of [...new Set(toOwn.map(m => m.to))]) parts.push(t('checked.mailsTo', { count: plural(toOwn.filter(m => m.to === addr).length, t('checked.email'), t('checked.emails')), to: addr }));
  for (const ch of [...new Set(posts.map(p => p.to))]) parts.push(t('checked.postsTo', { count: plural(posts.filter(p => p.to === ch).length, t('checked.post'), t('checked.posts')), to: ch }));
  for (const a of appends) parts.push(t('checked.appends', { what: Number.isFinite(a.count) ? plural(a.count, t('checked.row'), t('checked.rows')) : a.subject, sheet: a.to }));
  return parts.length ? parts : [t('checked.nothingToDo')];
}

function ownListBranch(view, tpl, onTested) {
  const box = el('div', { hidden: true, dataset: { ownData: '' } });
  const sheets = tpl.sheets;
  const state = { practiceDataId: null };
  const drawSheet = (i) => {
    const s = sheets[i];
    const area = el('div', {});
    box.append(el('h3', {}, t('checked.ownTitle', { plain: s.plain })), dropZone({ label: t('golive.dropLabel', { plain: s.plain }), help: t('golive.dropHelp'), onText: async text => {
      area.replaceChildren(el('p', { role: 'status' }, t('golive.reading')));
      try {
        const pv = await api('/api/data/preview', { template: tpl.id, sheet: s.sheet, csv: text });
        const mapper = columnMapper(pv), qs = dataQuestions(pv.questions, { onColumn: (name, header) => mapper.set(name, header) });
        const go = el('button', { type: 'button', class: 'primary', dataset: { action: 'test-own' } }, i + 1 < sheets.length ? t('checked.ownNext') : t('checked.ownTest'));
        const err = el('div', {});
        go.addEventListener('click', async () => {
          if (go.getAttribute('aria-disabled') === 'true') return;
          err.replaceChildren();
          if (!qs.check()) return; // a question is still open: say so here, send nothing
          busy(go, true);
          try {
            const c = await api('/api/data/commit', { template: tpl.id, sheet: s.sheet, csv: text, mapping: mapper.mapping(), answers: qs.answers(), target: 'practice', practiceDataId: state.practiceDataId });
            state.practiceDataId = c.practiceDataId;
            if (i + 1 < sheets.length) { drawSheet(i + 1); return; }
            say(t('make.testing', { noun: tpl.noun }));
            const d = await api('/api/practice', { proposalId: view.proposalId, practiceDataId: state.practiceDataId });
            memory[`tested:${view.proposalId}`] = d; say(t('make.tested')); onTested();
          } catch (error) { showError(err, error, { notDone: t('golive.notImported') }); }
          finally { busy(go, false); }
        });
        replace(area, el('p', {}, t('golive.found', { rows: pv.rowCount, noun: s.rowNoun })), mapper.node,
          pv.unused.length ? el('p', { class: 'muted' }, t('golive.keepsOnly', { columns: pv.unused.join(', ') })) : null, qs.node, el('div', { class: 'actions' }, go), err);
      } catch (error) { showError(area, error, { notDone: t('golive.notImported') }); }
    } }), area);
  };
  drawSheet(0);
  return box;
}

export async function render({ params }) {
  const proposalId = params[0];
  let view = await api(`/api/proposals/${proposalId}`);
  const list = await templates();
  const tpl = list.find(x => x.id === view.template) ?? null;
  const noun = tpl?.noun ?? t('checked.items');
  const status = el('div', {});
  const root = el('div', { dataset: { layout: 'narrow' } });

  if (!view.dryRun) {
    // m9: busy while it tests, and not busy again after an error (the error gets the focus).
    const run = el('button', { type: 'button', class: 'primary', dataset: { action: 'run-test' } }, t('checked.runTest'));
    run.addEventListener('click', async () => {
      if (run.getAttribute('aria-disabled') === 'true') return;
      busy(run, true); say(t('make.testing', { noun }));
      try { await api('/api/practice', { proposalId }); navigate(`/checked/${proposalId}`); }
      catch (error) { showError(status, error, { notDone: t('checked.notTestedNow') }); }
      finally { busy(run, false); }
    });
    return el('div', { dataset: { layout: 'narrow' } }, el('h1', {}, t('checked.notTested')), stepper('test'), el('div', { class: 'actions' }, run), status);
  }
  const d = view.dryRun;
  const passed = d.passed;
  const ownData = d.dataSource === 'your-data';
  const checksPassed = d.checks.filter(c => c.passed === true).length;
  if (passed) {
    root.append(el('h1', {}, t('checked.passedTitle')), stepper(view.active ? 'goLive' : 'test'));
    const summary = wouldDoSummary(d.wouldDo, view.slots, noun);
    root.append(el('p', { class: 'lead' }, t(ownData ? 'checked.wouldHaveYours' : 'checked.wouldHave'), ' ', summary.join(t('common.and')), '. ', t('checked.nothingSent')));
    if (ownData && !d.wouldDo.some(w => w.action === 'send' && !Object.values(view.slots ?? {}).includes(w.to))) root.append(el('p', { class: 'banner', role: 'status' }, t('checked.nothingToChase')));
    // UX review M3: the next step is right under the result, not a few screens down. The yes itself stays on its card below, with what it
    // will and won't do (SPEC R5: a decision only from its card); this strip takes the person there, or back to the settings.
    if (!view.active) root.append(el('div', { class: 'strip', dataset: { nextStep: '' } }, el('p', {}, el('b', {}, t('checked.nextTitle')), ' ', t('checked.nextBody')),
      el('div', { class: 'actions' }, el('a', { class: 'button primary', href: '#turn-on-h', dataset: { action: 'to-turn-on' }, on: { click: e => { e.preventDefault(); const h = document.getElementById('turn-on-h'); focusOn(h, { scroll: false }); h?.closest('[data-turn-on]')?.scrollIntoView({ block: 'start' }); } } }, t('checked.toTurnOn')),
        el('a', { class: 'button', href: `#/make/${view.template}${view.basedOn ? `?flow=${view.flowId}` : ''}` }, t('turnon.changeSettings')))));
  } else {
    root.append(el('h1', {}, t('checked.failedTitle')), stepper('test'));
    root.append(errorPanel({ problem: d.problem ?? { what: d.headline } }, { notDone: t('checked.cantTurnOn'), action: { label: t('checked.changeSetting'), href: `#/make/${view.template}${view.basedOn ? `?flow=${view.flowId}` : ''}` } }));
  }
  root.append(el('p', { class: 'pretend' }, ownData ? t('checked.testedOnYours') : t('checked.testedOnPretend', { noun })));

  // The checks are shown once (UX review M3): on the turn-on card when there is one ("How you'll know it worked", the same ticks), here
  // otherwise. The card used to repeat this whole list under it, between the result and the yes.
  const cardShown = passed && !view.active;
  if (!cardShown) root.append(el('section', { 'aria-labelledby': 'checks-h' }, el('h2', { id: 'checks-h' }, t('checked.checksTitle')), checkList(d.checks), howNote()));
  // Every message in full, folded (M3): the summary above says how many and to whom; nothing is sent by turning on, and the exact list
  // is shown again, in full, before anything is made.
  const wouldCount = d.wouldDo.length;
  if (wouldCount) root.append(el('section', { 'aria-labelledby': 'would-h' }, el('h2', { id: 'would-h' }, t('checked.wouldTitle')),
    el('details', { dataset: { wouldDo: '' } }, el('summary', {}, wouldCount === 1 ? t('checked.wouldShowOne') : t('checked.wouldShowMany', { n: wouldCount })),
    el('ol', { class: 'items' }, d.wouldDo.map(w => w.action === 'append'
      ? el('li', {}, el('div', { class: 'head' }, el('b', {}, t('checked.rowsTitle', { n: w.count ?? w.rows?.length ?? '', sheet: w.to }))), w.rows ? rowsTable(w.rows) : el('pre', {}, w.preview))
      : el('li', {}, el('div', { class: 'head' }, el('span', {}, el('b', {}, w.action === 'post' ? t('items.postTo') : t('items.to')), ' ', w.to),
        w.subject ? el('span', {}, el('b', {}, t('items.subject')), ' ', w.subject) : null), el('pre', {}, w.preview)))))));

  // The optional test on the person's own list (A4), before turning on (P3 walkthrough M15: it was tucked inside "what a test can't prove").
  const own = tpl ? ownListBranch({ proposalId }, tpl, () => navigate(`/checked/${proposalId}`)) : null;
  const ownButton = el('button', { type: 'button', 'aria-expanded': 'false', dataset: { action: 'own-list' } }, t('checked.ownButton'));
  ownButton.addEventListener('click', () => { const open = own.hidden; own.hidden = !open; ownButton.setAttribute('aria-expanded', String(open)); if (open) own.querySelector('input[type=file]')?.focus(); });
  if (tpl && passed) root.append(el('section', { 'aria-labelledby': 'own-h', dataset: { ownSection: '' } }, el('h2', { id: 'own-h' }, t(view.active ? 'checked.ownSectionTitleOn' : 'checked.ownSectionTitle')), el('p', {}, t('checked.ownSectionBody')),
    el('div', { class: 'actions' }, ownButton), own));
  root.append(el('section', { class: 'box-limit', 'aria-labelledby': 'limit-h' }, el('h2', { id: 'limit-h' }, t('checked.limitTitle')), el('p', {}, t('checked.limitBody')),
    tpl && !passed ? el('div', { class: 'actions' }, ownButton) : null, tpl && !passed ? own : null));

  // The turn-on card.
  if (cardShown) root.append(turnOnCard(view, tpl, { checksPassed, ownData }));
  if (view.active) root.append(el('div', { class: 'banner ok', role: 'status' }, el('p', {}, statusChip('works'), ' ', t('checked.alreadyOn')), el('a', { class: 'button primary', href: `#/go-live/${view.flowId}` }, t('checked.useOwnList'))));
  // Removing a draft the person won't use (M7): drafts left by "Not now" no longer pile up.
  if (!view.active && view.status === 'proposed') root.append(removeDraft(view));
  root.append(status);
  return root;
}

/** The note a turn-on records about who decides (kept with the yes; worded in the copy file: UX review m21). */
export const decisionNote = (choice, who) => choice === 'inform' ? t('turnon.noteInform', { who: who ?? t('who.thatPerson') })
  : choice === 'team' ? t('turnon.noteTeam', { who: who ?? t('who.thatPerson') }) : null;

function removeDraft(view) {
  const status = el('div', {});
  const button = el('button', { type: 'button', dataset: { action: 'remove-draft' } }, t('automations.removeDraft'));
  button.addEventListener('click', async () => {
    if (button.getAttribute('aria-disabled') === 'true') return;
    busy(button, true);
    try { await api(`/api/proposals/${encodeURIComponent(view.proposalId)}/remove`, {}); say(t('automations.removed')); navigate('/automations'); }
    catch (error) { showError(status, error, { notDone: t('automations.notRemoved') }); }
    finally { busy(button, false); }
  });
  return el('section', { class: 'inset', dataset: { removeDraft: '' } }, el('p', {}, t('automations.removeLead')), el('div', { class: 'actions' }, button), status);
}

function turnOnCard(view, tpl, { checksPassed, ownData }) {
  const headId = 'turn-on-h';
  // Who decides: what the person chose on the make page, kept with the automation (P3 walkthrough B3: a reload fell back to "you").
  const remembered = view.decider ? { choice: view.decider.choice, who: view.decider.who } : memory[`decider:${view.proposalId}`];
  const status = el('div', {});
  let who = tpl?.decider ? remembered?.choice ?? 'inform' : 'me';
  const whoName = remembered?.who ?? (tpl?.decider ? view.slots?.[tpl.decider] ?? null : null);
  const whoLine = el('dd', {});
  const whoEditor = el('div', { hidden: true });
  const drawWho = () => replace(whoLine, who === 'inform' && whoName ? t('turnon.whoInform', { who: whoName }) : who === 'team' ? t('turnon.whoTeam', { who: whoName ?? t('who.thatPerson') }) : t('turnon.whoYou'), ' ',
    tpl?.decider ? el('button', { type: 'button', class: 'link', 'aria-expanded': String(!whoEditor.hidden), on: { click: e => { whoEditor.hidden = !whoEditor.hidden; e.currentTarget.setAttribute('aria-expanded', String(!whoEditor.hidden)); } } }, t('turnon.changeWho')) : null);
  const choice = whoDecides({ name: whoName ?? '', onChange: v => { who = v; drawWho(); drawButtons(); api('/api/deciders', { flowId: view.flowId, choice: v, who: whoName }).catch(() => null); } });
  if (tpl?.decider) choice.node.querySelector(`input[value="${who}"]`).checked = true;
  if (tpl?.decider) whoEditor.append(choice.node);
  drawWho();
  const buttons = el('div', { class: 'actions stack decision' });
  // The button stays focusable while it works (M1: a disabled button drops the focus to the page); a refusal puts the focus on the error.
  const turnOn = async (e, note) => {
    const b = e.currentTarget;
    if (b.getAttribute('aria-disabled') === 'true') return;
    busy(b, true);
    try {
      const req = await api('/api/request-approval', { proposalId: view.proposalId });
      if (req.status !== 'approved') await decide(e, { kind: 'activation', approvalId: req.approvalId, decision: 'approve', note }, b);
      say(t('turnon.done')); refreshBadge();
      navigate(`/go-live/${view.flowId}?on=1`);
    } catch (error) { showError(status, error, { notDone: t('turnon.notOn') }); }
    finally { busy(b, false); }
  };
  const noteFor = () => decisionNote(who, whoName);
  function drawButtons() {
    buttons.replaceChildren();
    if (who === 'team') {
      buttons.append(el('p', { class: 'banner wait' }, t('turnon.teamPractice', { who: whoName ?? t('who.thatPerson') })));
      buttons.append(el('button', { type: 'button', class: 'primary', dataset: { action: 'turn-on' }, on: { click: e => turnOn(e, noteFor()) } }, t('turnon.teamOnAnyway')),
        el('button', { type: 'button', on: { click: () => navigate('/automations') } }, t('turnon.keepPractice')));
    } else {
      buttons.append(el('button', { type: 'button', class: 'primary', dataset: { action: 'turn-on' }, on: { click: e => turnOn(e, noteFor()) } }, t('turnon.yes')),
        el('a', { class: 'button', href: `#/make/${view.template}${view.basedOn ? `?flow=${view.flowId}` : ''}` }, t('turnon.changeSettings')),
        el('a', { class: 'button', href: '#/automations' }, t('turnon.notNow')));
    }
  }
  drawButtons();
  const sheets = tpl?.sheets.map(s => s.plain).join(t('common.and')) ?? '';
  return el('article', { class: 'card emph', 'aria-labelledby': headId, dataset: { decisionCard: '', turnOn: view.proposalId } },
    el('h2', { id: headId }, t('turnon.title', { title: tpl?.card ?? view.title, version: view.version })),
    view.basedOn ? el('p', { class: 'wait-text' }, t('turnon.replaces', { version: view.basedOn.version })) : null,
    el('h3', {}, t('turnon.will')), el('ul', {}, (view.promises?.willDo ?? []).map(x => el('li', {}, x))),
    el('h3', {}, t('turnon.wont')), el('ul', {}, (view.promises?.willNotDo ?? []).map(x => el('li', {}, x))),
    el('h3', { id: 'checks-h' }, t('turnon.done_means')), checkList(view.dryRun.checks, { how: false }), howNote(),
    el('dl', { class: 'facts' }, el('dt', {}, t('make.usesAI')), el('dd', {}, view.usesAI ? t('turnon.aiYes') : t('turnon.aiNo')),
      el('dt', {}, t('turnon.testedOn')), el('dd', {}, t(ownData ? 'turnon.testedYours' : 'turnon.testedPretend', { passed: checksPassed, total: view.dryRun.checks.length })),
      el('dt', {}, t('turnon.who')), whoLine,
      el('dt', {}, t('turnon.needs')), el('dd', {}, t('turnon.needsSheets', { sheets }))),
    whoEditor,
    buttons,
    el('p', { class: 'muted small' }, t('turnon.fine')), status);
}
