// Waiting for you (#/waiting): every decision the person owes, in full: lists to approve in one click, versions to turn on, single
// paused actions, and the approver's answers to record (P3 walkthrough B4: "you record the decision here" had no screen behind it).
// Only a click on one of these cards decides (SPEC R5).
import { el, t, rich, api, navigate, say, decide, refreshBadge } from '../site.js';
import { batchCard, actionCard, checkList, errorPanel } from '../components/ui.js';
import { when } from '../components/dom.js';

function activationCard(a, decider, rerender) {
  const headId = `act-${a.approvalId}`;
  const status = el('div', {});
  // The same note the turn-on card records, from the choice kept with the automation (P3 walkthrough B3).
  const note = decider?.choice === 'team' ? `${decider.who ?? 'The person named'} decides once the Team plan exists; until then you record their answer`
    : decider?.choice === 'inform' ? `${decider.who ?? 'The person named'} gets an e-mail; you record their answer here` : null;
  const press = approved => async e => {
    const b = e.currentTarget; b.setAttribute('aria-busy', 'true');
    try {
      const r = await decide(e, { kind: 'activation', approvalId: a.approvalId, decision: approved ? 'approve' : 'reject', note }, b);
      say(approved ? t('turnon.done') : t('waiting.notTurnedOn')); refreshBadge();
      if (approved && r.status === 'approved') navigate(`/go-live/${a.flowId}?on=1&agent=1`); else rerender();
    } catch (error) { status.replaceChildren(errorPanel(error)); b.removeAttribute('aria-busy'); }
  };
  return el('article', { class: 'card emph waiting', 'aria-labelledby': headId, dataset: { decisionCard: '', activation: a.approvalId } },
    el('h2', { id: headId }, t('turnon.title', { title: a.title, version: a.version })),
    el('p', {}, a.summary.goal),
    el('h3', {}, t('waiting.steps')), el('ol', {}, a.summary.steps.map(s => el('li', {}, s.text, s.asksFirst ? el('span', { class: 'muted' }, ` ${t('waiting.asksFirst')}`) : ''))),
    el('h3', {}, t('turnon.done_means')), checkList(a.summary.checks.map(c => ({ ...c, passed: a.practice.find(p => p.id === c.id)?.passed ?? null }))),
    el('p', { class: 'muted' }, t('waiting.ticksFromTest')),
    el('div', { class: 'actions stack decision' }, el('button', { type: 'button', class: 'primary', on: { click: press(true) } }, t('turnon.yes')), el('button', { type: 'button', on: { click: press(false) } }, t('waiting.no'))),
    status);
}

/** The claims an approver was e-mailed about, each with Approved / Rejected for the person to record from the approver's reply. */
function answersCard(view, rerender) {
  const status = el('div', { role: 'status' });
  const headId = `answers-${view.flowId}`;
  const record = (id, answer) => async e => {
    const b = e.currentTarget; b.setAttribute('aria-busy', 'true');
    try { await api('/api/answers', { flowId: view.flowId, id, answer }); say(t('waiting.recorded', { answer: t(`waiting.${answer}`) })); refreshBadge(); rerender(); }
    catch (error) { status.replaceChildren(errorPanel(error)); b.removeAttribute('aria-busy'); }
  };
  return el('article', { class: 'card', 'aria-labelledby': headId, dataset: { answers: view.flowId } },
    el('h2', { id: headId }, view.card ? t('waiting.answersFor', { card: view.card }) : t('waiting.answersTitle')),
    el('p', {}, t('waiting.answersLead', { who: view.approver ?? t('who.thatPerson') })),
    el('ul', { class: 'items' }, view.waiting.map(w => el('li', { dataset: { claim: w.id } },
      el('p', {}, t('waiting.claimLine', { id: w.id, person: w.person ?? '', amount: w.amount ?? '', reason: w.reason ?? '' })),
      w.answer ? el('p', { class: 'ok-text' }, t('waiting.recorded', { answer: t(`waiting.${w.answer.answer}`) }), ' ', el('span', { class: 'muted small' }, when(w.answer.at)))
        : el('div', { class: 'actions' }, el('button', { type: 'button', dataset: { action: 'answer-approved' }, on: { click: record(w.id, 'approved') } }, t('waiting.approved')),
          el('button', { type: 'button', dataset: { action: 'answer-rejected' }, on: { click: record(w.id, 'rejected') } }, t('waiting.rejected')))))),
    status);
}

export async function render() {
  const [o, b, deciders, answers] = await Promise.all([api('/api/overview'), api('/api/batches'), api('/api/deciders').catch(() => ({})), api('/api/answers').catch(() => ({ automations: [] }))]);
  const root = el('div', { dataset: { layout: 'narrow' } });
  const rerender = () => navigate('/waiting');
  const toRecord = answers.automations.reduce((n, a) => n + a.waiting.filter(w => !w.answer).length, 0);
  const count = (o.inbox?.count ?? 0) + b.open.length;
  root.append(el('h1', {}, count ? t('waiting.title', { n: count }) : toRecord ? t('waiting.answersTitle') : t('waiting.emptyTitle')));
  if (!count && !toRecord) {
    root.append(el('p', { class: 'lead' }, t('waiting.emptyBody')), el('div', { class: 'actions' }, el('a', { class: 'button primary', href: '#/automations' }, t('nav.automations')), el('a', { class: 'button', href: '#/' }, t('common.backHome'))));
    return root;
  }
  if (count) root.append(el('p', { class: 'lead' }, rich('waiting.lead')));
  for (const batch of b.open) root.append(batchCard(batch, { onDone: r => { if (r.declined) rerender(); else navigate(`/drafts?run=${r.runId ?? ''}`); } }));
  for (const a of o.inbox.activations) root.append(activationCard(a, deciders[a.flowId] ?? null, rerender));
  // A paused action shows its full arguments (the approval is bound to them), read from the run itself.
  const runs = {};
  for (const a of o.inbox.actions) {
    runs[a.runId] ??= await api(`/api/runs/${a.runId}`).catch(() => null);
    const full = runs[a.runId]?.pendingApprovals?.find(p => p.approvalId === a.approvalId) ?? null;
    root.append(actionCard(a, full, { onDone: rerender }));
  }
  for (const view of answers.automations) root.append(answersCard(view, rerender));
  return root;
}
