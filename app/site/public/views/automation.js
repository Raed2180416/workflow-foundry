// One automation (#/automations/:flowId): what it does, who decides, its data, the decisions made on it (approved and declined lists,
// with who, how and when: P5 walkthrough M7), its versions ("what changes from the version that's on now"), its runs, and the IT brief.
// The checks show what the latest finished run of this version left (P3 walkthrough M16: "Not checked yet" after a passed run).
import { el, t, api, download, toast, say, navigate, decide, refreshBadge } from '../site.js';
import { statusChip, checkList, showError, once, busy } from '../components/ui.js';
import { when } from '../components/dom.js';

// On or off (UX review M7; SPEC §5 A5 "undo: turn off"). Turning off stops it making lists and running; anything of it still waiting for a
// yes is cancelled; what it made stays. Turning on again is a new yes on this card (SPEC R5: a decision only from a click on its card).
function onOffCard(a, flowId) {
  const status = el('div', {});
  const headId = `onoff-${flowId}`;
  if (a.active) {
    const off = el('button', { type: 'button', dataset: { action: 'turn-off' }, on: { click: once(async () => {
      try {
        const r = await api(`/api/automations/${encodeURIComponent(flowId)}/off`, {});
        say(t('automation.turnedOffSay', { n: r.cancelled?.length ?? 0 })); refreshBadge(); navigate(`/automations/${flowId}`);
      } catch (error) { showError(status, error, { notDone: t('automation.notTurnedOff') }); }
    }) } }, t('automation.turnOff'));
    return el('section', { class: 'card', 'aria-labelledby': headId, dataset: { onOff: 'on' } }, el('h2', { id: headId, class: 'h3' }, t('automation.onOffTitle')),
      el('p', {}, statusChip('works'), ' ', t('automation.onNow')), el('p', { class: 'muted' }, t('automation.offExplain')), el('div', { class: 'actions' }, off), status);
  }
  if (!a.turnedOff) return null;
  const on = el('button', { type: 'button', class: 'primary', dataset: { action: 'turn-on-again' } }, t('automation.turnOnAgain'));
  on.addEventListener('click', async e => {
    if (on.getAttribute('aria-disabled') === 'true') return;
    busy(on, true);
    try {
      const req = await api(`/api/automations/${encodeURIComponent(flowId)}/on-again`, {});
      if (req.status !== 'approved') await decide(e, { kind: 'activation', approvalId: req.approvalId, decision: 'approve', note: null }, on);
      say(t('turnon.done')); refreshBadge(); navigate(`/automations/${flowId}`);
    } catch (error) { showError(status, error, { notDone: t('turnon.notOn') }); }
    finally { busy(on, false); }
  });
  return el('section', { class: 'card emph', 'aria-labelledby': headId, dataset: { onOff: 'off', decisionCard: '' } }, el('h2', { id: headId, class: 'h3' }, t('automation.onOffTitle')),
    el('p', {}, t('automation.offNow', { who: a.turnedOff.principal ?? '', channel: t(`channel.${a.turnedOff.channel}`), when: when(a.turnedOff.at) })),
    el('p', { class: 'muted' }, t('automation.onAgainExplain')), el('div', { class: 'actions stack decision' }, on), status);
}

/** "Remove this draft" (M7): a draft that will not be turned on stops waiting; the record of it stays. */
export function removeButton(proposalId, flowId = null) {
  const status = el('span', {});
  const b = el('button', { type: 'button', class: 'small', dataset: { action: 'remove-draft', proposal: proposalId }, on: { click: once(async () => {
    try { await api(`/api/proposals/${encodeURIComponent(proposalId)}/remove`, {}); say(t('automations.removed')); refreshBadge(); navigate(flowId ? `/automations/${flowId}` : '/automations'); }
    catch (error) { showError(status, error, { notDone: t('automations.notRemoved') }); }
  }) } }, t('automations.removeDraft'));
  return [b, status];
}

export async function render({ params }) {
  const flowId = params[0];
  const [a, versions] = await Promise.all([api(`/api/automations/${encodeURIComponent(flowId)}`), api(`/api/flows/${encodeURIComponent(flowId)}`).catch(() => null)]);
  const decided = a.approvals.find(x => x.status === 'approved' && x.workflowHash === a.workflowHash);
  const status = el('div', {});
  const ics = el('button', { type: 'button', class: 'small', on: { click: once(async () => { try { await download(`/api/ics/${flowId}.ics`, `${flowId}-reminder.ics`); toast(t('automation.icsDone')); } catch (error) { showError(status, error, { notDone: t('errors.noFile') }); } }) } }, t('automation.ics'));
  const checks = a.lastRun?.checks ?? a.summary.checks.map(c => ({ ...c, passed: null }));
  const toRecord = a.answers?.waiting.filter(w => !w.answer).length ?? 0;
  const approver = a.slots?.approver ?? null;
  return el('div', {},
    el('h1', {}, a.card ?? a.title),
    el('p', {}, a.active ? statusChip('works') : null, ' ', a.active ? t('automations.on') : a.turnedOff ? t('automations.turnedOff') : t('automations.off'), a.version ? ` · ${t('automations.version', { version: a.version })}` : ''),
    el('div', { class: 'actions' },
      a.active ? el('a', { class: 'button primary', href: `#/go-live/${flowId}` }, t('automation.run')) : null,
      a.template ? el('a', { class: 'button', href: `#/make/${a.template}?flow=${flowId}` }, t('automation.change')) : null,
      toRecord ? el('a', { class: 'button', href: '#/waiting' }, t('automation.answersLink', { n: toRecord })) : null,
      el('a', { class: 'button', href: `#/it-brief/${flowId}` }, t('automation.brief'))),
    onOffCard(a, flowId),
    el('section', {}, el('h2', {}, t('turnon.will')), el('ul', {}, (a.promises?.willDo ?? a.summary.steps.map(s => s.text)).map(x => el('li', {}, x))),
      el('h2', {}, t('turnon.wont')), el('ul', {}, (a.promises?.willNotDo ?? []).map(x => el('li', {}, x))),
      el('h2', {}, t('turnon.done_means')),
      a.lastRun ? el('p', { class: 'muted' }, t('automation.lastRun', { when: when(a.lastRun.at), result: t(`run.status.${a.lastRun.status}`) }), ' ', el('a', { href: `#/runs/${a.lastRun.runId}` }, t('common.open'))) : null,
      checkList(checks)),
    el('section', {}, el('h2', {}, t('turnon.who')),
      el('p', {}, decided ? t('automation.decided', { who: decided.principal ?? '', channel: t(`channel.${decided.channel}`), when: when(decided.decidedAt) }) : t('automation.notDecided')),
      decided?.note ? el('p', { class: 'muted small' }, t('automation.note', { note: decided.note })) : null,
      el('p', { class: 'muted' }, approver ? t('automation.informed', { who: approver }) : t('automation.singlePerson'))),
    el('section', { dataset: { decisions: '' } }, el('h2', {}, t('automation.decisionsTitle')),
      a.lists?.length ? el('ul', {}, a.lists.map(l => el('li', {}, t('automation.decisionList', { n: l.items, decision: l.decision.approved ? t('automation.approvedWord') : t('automation.declinedWord'),
        who: l.decision.by ?? '', channel: t(`channel.${l.decision.channel}`), when: when(l.decision.at) }), l.runId ? [' ', el('a', { href: `#/runs/${l.runId}` }, t('common.open'))] : null)))
        : el('p', { class: 'muted' }, t('automation.noDecisions'))),
    a.data ? el('section', {}, el('h2', {}, t('automation.dataTitle')), el('ul', {}, Object.entries(a.data).map(([sheet, d]) => el('li', {}, d ? t('automation.dataHave', { sheet, rows: d.rows, when: when(d.updatedAt) }) : t('automations.dataMissing', { sheet })))),
      a.active ? el('a', { href: `#/go-live/${flowId}` }, t('automation.newList')) : null) : null,
    el('section', {}, el('h2', {}, t('automation.reminderTitle')), el('p', {}, t('automation.reminderBody')), el('div', { class: 'actions' }, ics), status),
    versions ? el('section', {}, el('h2', {}, t('automation.versionsTitle')), versions.versions.map(v => el('div', { class: 'card' },
      el('h3', {}, v.state === 'draft' ? t('automation.draftV', { version: v.version }) : t('automation.versionV', { version: v.version }), v.active ? ` · ${t('automations.on')}` : ''),
      v.diffFromPrevious && v.version > 1 ? el('p', {}, t('automation.changes'), ' ', [
        ...v.diffFromPrevious.added.map(x => t('automation.added', { step: x.step })), ...v.diffFromPrevious.removed.map(x => t('automation.removed', { step: x.step })),
        ...v.diffFromPrevious.changed.map(x => t('automation.changed', { step: x.step })), ...(v.diffFromPrevious.checksChanged ? [t('automation.checksChanged')] : [])].join('; ') || t('automation.nothingChanged')) : null,
      v.state === 'draft' && v.proposalId ? el('div', { class: 'actions' }, el('a', { class: 'button small', href: `#/checked/${v.proposalId}` }, t('common.open')), removeButton(v.proposalId, flowId)) : null,
      el('details', {}, el('summary', {}, t('common.showDetails')), el('p', { class: 'small' }, t('automation.fingerprint', { hash: v.hash })))))) : null,
    el('section', {}, el('h2', {}, t('nav.runs')), a.runs.length ? el('ul', {}, a.runs.slice(0, 20).map(r => el('li', {}, el('a', { href: `#/runs/${r.runId}` }, `${t(`run.status.${r.status}`)} · ${when(r.at)}`)))) : el('p', { class: 'muted' }, t('automation.noRuns'))));
}
