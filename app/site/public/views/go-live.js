// Go live (#/go-live/:flowId): the person's own list in, then the exact list of what the run would make, approved in one click
// (SPEC §9.6, §7.5). The default first live effect needs no connection: drafts the person sends themselves.
//
// Since the persona walkthroughs: a list older than today makes "replace it" the first thing to do (P2 B3); practice-only mode turns
// the page into a test on the person's list, with a neutral note instead of a red error (P4 M8); a receipt column the file does not
// have is said plainly (P3 B2); "which of these columns" answers keep the column chooser in step (P2 M2).
import { el, t, api, templates, navigate, say } from '../site.js';
import { errorPanel, stepper, dropZone, columnMapper, dataQuestions, batchCard, statusChip, checkList } from '../components/ui.js';
import { when, day, replace } from '../components/dom.js';

const sameDay = (a, b) => new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);

export async function render({ params, query }) {
  const flowId = params[0];
  const [a, list, settings] = await Promise.all([api(`/api/automations/${encodeURIComponent(flowId)}`), templates(), api('/api/settings')]);
  const tpl = list.find(x => x.id === a.template);
  const practiceOnly = settings.mode === 'practice-only';
  const root = el('div', { dataset: { layout: 'narrow' } }, stepper('goLive'));
  if (query.get('on') === '1') root.append(el('div', { class: 'banner ok', role: 'status' }, el('p', {}, el('b', {}, t('golive.onTitle')), ' ', query.get('agent') === '1' ? t('golive.onBodyAgent') : t('golive.onBody'))));
  if (!tpl) { root.append(el('h1', {}, a.title), el('p', {}, t('golive.notCard')), el('a', { class: 'button', href: `#/automations/${flowId}` }, t('common.open'))); return root; }
  if (!a.active) {
    const draft = a.drafts.find(d => d.dryRun);
    root.append(el('h1', {}, t('golive.notOnTitle', { card: tpl.card })), el('p', {}, t('golive.notOnBody')),
      el('div', { class: 'actions' }, draft ? el('a', { class: 'button primary', href: `#/checked/${draft.proposalId}` }, t('golive.toTurnOn')) : el('a', { class: 'button primary', href: `#/make/${tpl.id}` }, t('golive.toMake'))));
    return root;
  }
  const sheets = tpl.sheets;
  const plain = sheets.map(s => s.plain).join(t('common.and'));
  root.append(el('h1', {}, t('golive.title', { plain })), el('p', { class: 'lead' }, t('golive.lead')));
  if (practiceOnly) root.append(el('div', { class: 'banner', role: 'note', dataset: { practiceOnly: '' } }, el('p', {}, statusChip('works'), ' ', t('golive.practiceOnly'))));

  const batchArea = el('div', {});
  const have = { ...Object.fromEntries(sheets.map(s => [s.sheet, !!a.data?.[s.sheet]])) };
  let practiceDataId = null;
  // Practice-only: the person's list is tested against the version that is on, and nothing is made (P4 walkthrough M8).
  const testOnList = async button => {
    batchArea.replaceChildren(el('p', { role: 'status' }, t('golive.preparing')));
    try {
      if (!a.activeProposalId) throw new Error(t('errors.unknown'));
      await api('/api/practice', { proposalId: a.activeProposalId, ...(practiceDataId ? { practiceDataId } : { useLive: true }) });
      navigate(`/checked/${a.activeProposalId}`);
    } catch (error) { batchArea.replaceChildren(errorPanel(error, { notDone: t('golive.nothingMade'), action: { label: t('common.tryAgain'), onClick: () => testOnList(button) } })); }
    finally { button?.removeAttribute('aria-busy'); }
  };
  const makeList = async (button) => {
    if (practiceOnly) return testOnList(button);
    batchArea.replaceChildren(el('p', { role: 'status' }, t('golive.preparing')));
    say(t('golive.preparing'));
    try {
      const b = await api('/api/batch/preview', { flowId });
      if (!b.passed) { batchArea.replaceChildren(errorPanel({ problem: { what: t('golive.testFailed', { headline: b.headline }), next: b.problem?.next ?? null } }, { notDone: t('golive.nothingMade'), action: { label: t('checked.changeSetting'), href: `#/make/${tpl.id}?flow=${flowId}` } }), checkList(b.checks)); return; }
      say(t('golive.ready', { n: b.items.length }));
      if (!b.items.length) {
        batchArea.replaceChildren(el('section', { class: 'card done' }, el('h2', {}, t('golive.nothingTitle')), el('p', {}, t('golive.nothingBody', { noun: tpl.noun })),
          checkList(b.checks), el('a', { class: 'button', href: `#/automations/${flowId}` }, t('golive.toAutomation'))));
        return;
      }
      const card = batchCard(b, { onDone: r => {
        if (r.declined && r.firmFirst) { batchArea.replaceChildren(el('div', { class: 'banner', role: 'status' }, el('p', {}, t('batch.firmFirstNoAfter')), el('a', { class: 'button', href: `#/make/${tpl.id}?flow=${flowId}` }, t('turnon.changeSettings')))); return; }
        if (r.declined) navigate(`/automations/${flowId}`); else navigate(`/drafts?run=${r.runId ?? ''}`);
      } });
      batchArea.replaceChildren(card);
      card.querySelector('h2')?.setAttribute('tabindex', '-1'); card.querySelector('h2')?.focus();
    } catch (error) {
      batchArea.replaceChildren(errorPanel(error, { notDone: t('golive.nothingMade'), action: { label: t('common.tryAgain'), onClick: () => makeList(button) } }));
    } finally { button?.removeAttribute('aria-busy'); }
  };

  const sheetSections = sheets.map(s => {
    const section = el('section', { dataset: { sheet: s.sheet } });
    const area = el('div', {});
    const drop = dropZone({ label: t('golive.dropLabel', { plain: s.plain }), help: t('golive.dropHelp'), onText: async text => {
      area.replaceChildren(el('p', { role: 'status' }, t('golive.reading')));
      try {
        const pv = await api('/api/data/preview', { template: tpl.id, sheet: s.sheet, csv: text });
        const mapper = columnMapper(pv), qs = dataQuestions(pv.questions, { onColumn: (name, header) => mapper.set(name, header) });
        const last = sheets.filter(x => !have[x.sheet] && x.sheet !== s.sheet).length === 0;
        const go = el('button', { type: 'button', class: 'primary', dataset: { action: 'use-columns' } }, practiceOnly && last ? t('golive.practiceOnlyTest') : last ? t('golive.useAndTest') : t('golive.useColumns'));
        const err = el('div', {});
        go.addEventListener('click', async () => {
          err.replaceChildren();
          if (!qs.check()) return; // a question is still open: say so here, send nothing
          go.setAttribute('aria-busy', 'true');
          try {
            const target = practiceOnly ? 'practice' : 'live';
            const c = await api('/api/data/commit', { template: tpl.id, sheet: s.sheet, csv: text, mapping: mapper.mapping(), answers: qs.answers(), target, practiceDataId });
            if (practiceOnly) practiceDataId = c.practiceDataId;
            have[s.sheet] = true;
            const noReceipt = tpl.id === 'expense-approval' && s.sheet === 'expenses' && !mapper.mapping().receipt && a.slots?.requireReceipt !== false;
            // The list just given replaces the old one: the "your list is from ..." lines no longer apply (P2 walkthrough B3).
            root.querySelectorAll('[data-stale], [data-have]').forEach(x => x.remove());
            replace(area, el('p', { class: 'banner ok', role: 'status' }, t('golive.saved', { rows: c.rows, noun: s.rowNoun }), c.skipped?.unreadable ? ` ${t('golive.skipped', { n: c.skipped.unreadable })}` : '',
              c.skipped?.noEmail ? ` ${t('golive.noEmail', { n: c.skipped.noEmail })}` : ''), noReceipt ? el('p', { class: 'banner wait' }, t('golive.receiptMissing')) : null);
            if (Object.values(have).every(Boolean)) await makeList(go);
            else go.removeAttribute('aria-busy');
          } catch (error) {
            go.removeAttribute('aria-busy');
            err.replaceChildren(errorPanel(error, { notDone: t('golive.notImported'), action: { label: t('golive.fixAbove'), onClick: () => area.querySelector('select, input')?.focus() } }));
          }
        });
        replace(area, el('p', {}, t('golive.found', { rows: pv.rowCount, noun: s.rowNoun })),
          el('h3', {}, t('golive.mappingTitle')), mapper.node,
          pv.unused.length ? el('p', { class: 'muted' }, t('golive.keepsOnly', { columns: pv.unused.join(', ') })) : null,
          pv.questions.length ? el('h3', {}, t('golive.questionsTitle')) : null, qs.node,
          el('div', { class: 'actions' }, go), err);
        area.querySelector('h3')?.setAttribute('tabindex', '-1');
      } catch (error) { area.replaceChildren(errorPanel(error, { notDone: t('golive.notImported'), action: { label: t('golive.chooseAnother'), onClick: () => drop.querySelector('input')?.focus() } })); }
    } });
    const existing = a.data?.[s.sheet];
    if (existing) {
      drop.hidden = true;
      const replaceButton = el('button', { type: 'button', class: 'small', dataset: { action: 'replace-list' }, on: { click: () => { drop.hidden = false; drop.querySelector('input').focus(); } } }, t('golive.replace'));
      section.append(el('p', { dataset: { have: '' } }, t('golive.have', { plain: s.plain, rows: existing.rows, noun: s.rowNoun, when: when(existing.updatedAt) }), ' ', replaceButton));
    }
    if (sheets.length > 1) section.prepend(el('h2', {}, s.plain));
    section.append(drop, area);
    return section;
  });
  root.append(...sheetSections);
  const lists = sheets.map(s => a.data?.[s.sheet]).filter(Boolean);
  if (practiceOnly && sheets.every(s => a.data?.[s.sheet])) {
    const test = el('button', { type: 'button', class: 'primary', dataset: { action: 'test-on-list' } }, t('golive.practiceOnlyTest'));
    test.addEventListener('click', () => { test.setAttribute('aria-busy', 'true'); testOnList(test); });
    root.append(el('div', { class: 'actions' }, test));
  } else if (sheets.every(s => a.data?.[s.sheet])) {
    // A list from an earlier day: replacing it comes first, because it no longer says who paid (P2 walkthrough B3).
    const oldest = lists.map(d => d.updatedAt).sort()[0];
    const stale = oldest && !sameDay(oldest, a.today ?? Date.now()); // the server's day: the one the list's ages are counted from
    const show = el('button', { type: 'button', class: stale ? '' : 'primary', dataset: { action: 'make-list' } }, stale ? t('golive.staleAnyway', { date: day(oldest) }) : t('golive.showList'));
    show.addEventListener('click', () => { show.setAttribute('aria-busy', 'true'); makeList(show); });
    if (stale) {
      const fresh = el('button', { type: 'button', class: 'primary', dataset: { action: 'replace-stale' }, on: { click: () => { const d = root.querySelector('.drop'); d.hidden = false; d.querySelector('input').focus(); } } }, t('golive.replace'));
      root.append(el('div', { class: 'banner wait', dataset: { stale: '' } }, el('p', {}, el('b', {}, t('golive.staleTitle', { date: day(oldest) })), ' ', t('golive.staleBody')), el('div', { class: 'actions' }, fresh, show)));
    } else root.append(el('div', { class: 'actions' }, show));
  }
  root.append(batchArea);
  root.append(el('section', { 'aria-labelledby': 'send-h' }, el('h2', { id: 'send-h' }, t('golive.howSend')),
    el('fieldset', {}, el('legend', { class: 'sr-only' }, t('golive.howSendLegend')),
      el('label', { class: 'check-row' }, el('input', { type: 'radio', name: 'send-how', checked: true, value: 'drafts' }), el('span', {}, t('golive.drafts'), ' ', statusChip('works'))),
      el('label', { class: 'check-row' }, el('input', { type: 'radio', name: 'send-how', disabled: true, value: 'connected' }), el('span', {}, t('golive.connected'), ' ', statusChip('planned'))),
      el('p', { dataset: { status: 'planned' } }, el('a', { href: '#/connections', dataset: { instead: '' } }, t('golive.insteadDrafts'))))));
  return root;
}
