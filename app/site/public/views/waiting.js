// Waiting for you (#/waiting): every decision the person owes, in full: lists to approve in one click, versions to turn on, and
// single paused actions. Only a click on one of these cards decides (SPEC R5).
import { el, t, api, navigate, say, decide, refreshBadge } from '../site.js';
import { batchCard, actionCard, checkList, errorPanel } from '../components/ui.js';

function activationCard(a, rerender) {
  const headId = `act-${a.approvalId}`;
  const status = el('div', {});
  const press = approved => async e => {
    const b = e.currentTarget; b.setAttribute('aria-busy', 'true');
    try {
      const r = await decide(e, { kind: 'activation', approvalId: a.approvalId, decision: approved ? 'approve' : 'reject', note: 'who decides: the person at this computer (single-person mode)' }, b);
      say(approved ? t('turnon.done') : t('waiting.notTurnedOn')); refreshBadge();
      if (approved && r.status === 'approved') navigate(`/go-live/${a.flowId}?on=1`); else rerender();
    } catch (error) { status.replaceChildren(errorPanel(error)); b.removeAttribute('aria-busy'); }
  };
  return el('article', { class: 'card emph waiting', 'aria-labelledby': headId, dataset: { decisionCard: '', activation: a.approvalId } },
    el('h2', { id: headId }, t('turnon.title', { title: a.title, version: a.version })),
    el('p', {}, a.summary.goal),
    el('h3', {}, t('waiting.steps')), el('ol', {}, a.summary.steps.map(s => el('li', {}, s.text, s.asksFirst ? el('span', { class: 'muted' }, ` ${t('waiting.asksFirst')}`) : ''))),
    el('h3', {}, t('turnon.done_means')), checkList(a.summary.checks.map(c => ({ ...c, passed: a.practice.find(p => p.id === c.id)?.passed ?? null })), { how: false }),
    el('p', { class: 'muted' }, t('waiting.ticksFromTest')),
    el('div', { class: 'actions stack decision' }, el('button', { type: 'button', class: 'primary', on: { click: press(true) } }, t('turnon.yes')), el('button', { type: 'button', on: { click: press(false) } }, t('waiting.no'))),
    status);
}

export async function render() {
  const [o, b] = await Promise.all([api('/api/overview'), api('/api/batches')]);
  const root = el('div', { dataset: { layout: 'narrow' } });
  const rerender = () => navigate('/waiting');
  const count = (o.inbox?.count ?? 0) + b.open.length;
  root.append(el('h1', {}, count ? t('waiting.title', { n: count }) : t('waiting.emptyTitle')));
  if (!count) {
    root.append(el('p', { class: 'lead' }, t('waiting.emptyBody')), el('div', { class: 'actions' }, el('a', { class: 'button primary', href: '#/automations' }, t('nav.automations')), el('a', { class: 'button', href: '#/' }, t('common.backHome'))));
    return root;
  }
  root.append(el('p', { class: 'lead' }, t('waiting.lead')));
  for (const batch of b.open) root.append(batchCard(batch, { onDone: r => { if (r.declined) rerender(); else navigate(`/drafts?run=${r.runId ?? ''}`); } }));
  for (const a of o.inbox.activations) root.append(activationCard(a, rerender));
  // A paused action shows its full arguments (the approval is bound to them), read from the run itself.
  const runs = {};
  for (const a of o.inbox.actions) {
    runs[a.runId] ??= await api(`/api/runs/${a.runId}`).catch(() => null);
    const full = runs[a.runId]?.pendingApprovals?.find(p => p.approvalId === a.approvalId) ?? null;
    root.append(actionCard(a, full, { onDone: rerender }));
  }
  return root;
}
