// One run (#/runs/:runId): headline, the failed step and what to do, "Done means" ticks, who started it, the record check, the evidence
// download an auditor can use, and the timeline in plain words with a "decisions only" view (SPEC §7.4 P5, §9.8).
// Since the P5 walkthrough: the record is "consistent", with what that does and does not prove (M1), its latest link can be copied (to
// keep somewhere else), the evidence file's name and fingerprint stay on the page (minor 4), the run names its card and version
// (minor 1), cost has two decimals (minor 3), and who started it and who approved its list are shown (B1, M8).
import { el, t, api, download, toast, raw, rich } from '../site.js';
import { checkList, showError, copyOrSelect, once } from '../components/ui.js';
import { whenUtc } from '../components/dom.js';

const DECISION_EVENTS = new Set(['approval.requested', 'approval.decided']);
const sha256 = async blob => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('');

export async function render({ params }) {
  const runId = params[0];
  const [d, ev] = await Promise.all([api(`/api/runs/${encodeURIComponent(runId)}`), api(`/api/evidence/${encodeURIComponent(runId)}`).catch(() => null)]);
  const card = ev?.workflow?.title ? `${ev.workflow.title} · ${t('automations.version', { version: ev.workflow.version ?? '' })}` : d.flowId;
  const status = el('div', {});
  const fileNote = el('p', { class: 'small', role: 'status' });
  const ev1 = el('button', { type: 'button', class: 'primary', dataset: { action: 'evidence' } }, t('run.evidence'));
  ev1.addEventListener('click', once(async () => {
    try {
      const file = `foundry-evidence-${runId.slice(0, 8)}.json`;
      const blob = await download(`/api/evidence/${runId}.json`, file);
      fileNote.replaceChildren(el('span', {}, t('run.evidenceDone', { file })), el('br'), el('span', { class: 'muted' }, t('run.evidenceFingerprint', { hash: await sha256(blob) })));
      toast(t('run.evidenceDone', { file }));
    } catch (error) { showError(status, error, { notDone: t('errors.noFile') }); }
  }));
  // Where the browser won't copy, the link itself is selected, so "press Ctrl+C" is true when the page says it (UX review m2).
  const headText = el('code', { dataset: { chainHead: '' } }, d.chain.head ?? '');
  const copyHead = el('button', { type: 'button', class: 'small', dataset: { action: 'copy-head' }, on: { click: () => copyOrSelect(d.chain.head ?? '', headText) } }, t('run.copyHead'));
  // The decision log's latest link (honesty review B1): who decided is checked against that log, so it needs an outside copy too.
  const decisionsHead = ev?.personDecisions?.check?.head ?? null;
  const decisionsText = el('code', { dataset: { decisionsHead: '' } }, decisionsHead ?? '');
  const copyDecisions = el('button', { type: 'button', class: 'small', dataset: { action: 'copy-decisions-head' }, on: { click: () => copyOrSelect(decisionsHead ?? '', decisionsText) } }, t('run.copyDecisionsHead'));
  const names = raw('run.events') ?? {};
  // Each decision as what it was (UX review M4): a yes or a no, and whose. Only a yes Foundry applied from the approved list is credited to
  // the person who approved the list; a single paused action carries its own logged decision (who and through what), or says it is unknown.
  const byList = ev?.batch?.decision ? t('run.byList', { who: ev.batch.decision.by, channel: t(`channel.${ev.batch.decision.channel}`) }) : '';
  const fromEvidence = Object.fromEntries((ev?.actionDecisions ?? []).filter(x => x.type === 'approval.decided').map(x => [x.seq, x]));
  const logged = approvalId => (ev?.personDecisions?.lines ?? []).find(l => (l.kind === 'action' || l.kind === 'list-item') && l.approvalId === approvalId) ?? null;
  const whoOf = e => {
    if (e.type !== 'approval.decided') return '';
    const x = fromEvidence[e.seq];
    if (x?.fromList) return byList;
    const line = logged(e.approvalId ?? x?.approvalId);
    return line ? t('run.byOne', { who: line.principal ?? line.by ?? '', channel: t(`channel.${line.channel}`) }) : t('run.byUnknown');
  };
  const plainOf = e => {
    if (e.type !== 'approval.decided') return names[e.type] ?? e.type;
    const approved = e.approved ?? fromEvidence[e.seq]?.approved ?? null;
    return approved === true ? t('run.decidedYes') : approved === false ? t('run.decidedNo') : t('run.decidedUnknown');
  };
  const rows = d.timeline.map(e => ({ ...e, plain: plainOf(e), who: whoOf(e) }));
  const tbody = el('tbody', {});
  const draw = all => tbody.replaceChildren(...rows.filter(e => all || DECISION_EVENTS.has(e.type)).map(e => el('tr', { dataset: { event: e.type } }, el('td', {}, String(e.seq)), el('td', {}, whenUtc(e.at)), el('td', {}, e.plain), el('td', {}, e.step ?? ''), el('td', {}, e.who))));
  let all = false; draw(all);
  // One fixed label and a pressed state (m10): "Show every event", pressed or not. Changing both read the state backwards.
  const toggle = el('button', { type: 'button', class: 'small', 'aria-pressed': 'false', dataset: { action: 'every-event' }, on: { click: () => { all = !all; toggle.setAttribute('aria-pressed', String(all)); draw(all); } } }, t('run.everything'));
  return el('div', {},
    el('p', { class: 'muted' }, el('a', { href: '#/runs' }, t('run.back'))),
    el('h1', {}, d.headline),
    el('p', {}, t('run.of', { flow: card }), ' · ', d.progress, ' · ', t('run.cost', { usd: (d.costUsd ?? 0).toFixed(2), calls: d.modelCalls?.count ?? 0 })),
    el('p', { dataset: { startedBy: '' } }, ev?.run?.startedBy ? t('run.startedBy', { who: ev.run.startedBy, channel: ev.run.startedThrough ?? '' }) : t('run.startedUnknown')),
    d.problem ? el('div', { class: 'banner bad' }, el('p', {}, el('b', {}, d.problem.what)), el('p', {}, d.problem.next), d.failedStep ? el('p', {}, t('run.failedStep', { step: d.failedStep })) : null) : null,
    d.pendingApprovals?.length ? el('p', { class: 'banner wait' }, t('run.waiting'), ' ', el('a', { href: '#/waiting' }, t('nav.waiting'))) : null,
    el('h2', {}, t('turnon.done_means')), checkList(d.checks),
    el('section', { class: d.chain.verified ? 'banner ok' : 'banner bad', dataset: { record: d.chain.verified ? 'verified' : 'broken' } },
      // No status chip here (honesty review, minor 11): a check result is not a decision, and a broken record is not a known limit.
      el('p', {}, d.chain.verified ? t('run.recordOk', { n: d.chain.events }) : t('run.recordBad', { reason: d.chain.reason ?? '' })),
      d.chain.verified ? el('p', { class: 'small' }, t('run.recordMeaning')) : null,
      el('details', {}, el('summary', {}, t('common.showDetails')), el('p', { class: 'small' }, rich('run.chainHead', { hash: headText })), el('div', { class: 'actions' }, copyHead),
        decisionsHead ? [el('p', { class: 'small' }, rich('run.decisionsHead', { hash: decisionsText })), el('p', { class: 'small muted' }, t('run.decisionsHeadNote')), el('div', { class: 'actions' }, copyDecisions)] : null)),
    el('div', { class: 'actions' }, ev1), el('p', { class: 'small muted', dataset: { evidenceContains: '' } }, t('run.evidenceContains')), fileNote, status,
    el('section', {}, el('h2', {}, t('run.gapsTitle')), el('ul', {}, ['decisions', 'transcripts', 'anchor', 'delivered', 'secondPerson', 'identity'].map(k => el('li', {}, t(`run.gaps.${k}`))))),
    el('section', {}, el('h2', {}, t('run.timeline', { n: d.timeline.length })), el('div', { class: 'actions' }, toggle),
      el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, [t('run.seq'), t('runs.when'), t('run.event'), t('run.step'), t('run.who')].map(h => el('th', { scope: 'col' }, h)))), tbody))),
    el('p', { class: 'muted' }, t('run.honesty')));
}
