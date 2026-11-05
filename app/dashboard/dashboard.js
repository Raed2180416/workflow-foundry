// The dashboard page. Every value from the workspace is rendered with textContent: workflow, run and user text is data, never markup.
// The page arrives with a one-time code (#/?c=...), trades it for this tab's key (POST /auth/open) and keeps the key in this tab only.
let token = null;
async function takeKey() {
  const code = (location.hash.match(/[?&]c=([A-Za-z0-9_-]{43})/) ?? [])[1];
  if (code) {
    history.replaceState(null, '', location.pathname);
    const res = await fetch('/auth/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.key) { try { sessionStorage.setItem('foundry-token', data.key); } catch { /* storage off: this page only */ } return data.key; }
    return null;
  }
  try { return sessionStorage.getItem('foundry-token'); } catch { return null; }
}
const $ = id => document.getElementById(id);
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v; else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}
async function api(pathname, body) {
  const res = await fetch(pathname, { method: body ? 'POST' : 'GET', headers: { 'x-foundry-token': token ?? '', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.problem?.what ?? data.error?.message ?? data.error ?? `HTTP ${res.status}`);
  return data;
}
const mark = passed => passed === true ? ['✓', 'ok'] : passed === false ? ['✗', 'bad'] : ['…', 'wait'];
const checksList = checks => el('ul', { class: 'checks' }, checks.map(c => { const [m, cls] = mark(c.passed); return el('li', { 'data-mark': m, class: cls }, c.plain ?? c.exact); }));
const when = t => t ? new Date(t).toLocaleString() : '';
const words = { succeeded: 'Done', failed: 'Problem', awaiting_approval: 'Needs your OK', awaiting_human: 'Needs your answer', cancelled: 'Stopped', uncertain: 'Check by hand', running: 'Running', waiting: 'Waiting' };

async function decide(body, button) {
  button.disabled = true;
  try { await api('/api/decide', body); await load(); } catch (error) { showError(error); button.disabled = false; }
}
function showError(error) { $('error').hidden = false; $('error').textContent = error.message; }

// A version-2+ approval leads with what is different: the step texts of added, removed and changed steps, and changed checks or limits.
function changeText(a) {
  const text = id => a.summary.steps.find(s => s.id === id)?.text ?? id, c = a.changes ?? {};
  const parts = [...(c.added ?? []).map(id => `new step “${text(id)}”`), ...(c.removed ?? []).map(id => `removed step ${id}`), ...(c.changed ?? []).map(id => `changed “${text(id)}”`),
    ...(c.acceptanceChanged ? ['the definition of done'] : []), ...(c.budgetChanged ? ['the limits'] : [])];
  return parts.length ? parts.join('; ') : 'nothing in the steps';
}
function renderInbox(inbox) {
  const box = $('inbox'); box.replaceChildren();
  if (!inbox.count) { box.append(el('p', { class: 'muted' }, 'Nothing is waiting for you.')); return; }
  for (const a of inbox.activations) {
    const yes = el('button', { class: 'primary', on: { click: e => decide({ kind: 'activation', approvalId: a.approvalId, decision: 'approve' }, e.target) } }, 'Turn it on');
    const no = el('button', { on: { click: e => decide({ kind: 'activation', approvalId: a.approvalId, decision: 'reject' }, e.target) } }, 'No');
    box.append(el('div', { class: 'card' }, el('h3', {}, `Turn on “${a.title}”? (version ${a.version})`),
      el('p', {}, a.summary.goal),
      a.version > 1 ? el('p', { class: 'wait' }, 'What changes from the version that is on now: ', changeText(a)) : null,
      el('p', { class: 'muted' }, 'Steps: ', a.summary.steps.map(s => s.text).join(' → ')),
      el('p', {}, 'Done means:'), checksList(a.summary.checks.map(c => ({ ...c, passed: a.practice.find(p => p.id === c.id)?.passed ?? null }))),
      el('p', { class: 'muted' }, 'Ticks show the practice run. Each send will still ask you first.'), el('div', { class: 'row' }, yes, no)));
  }
  for (const a of inbox.actions) {
    const yes = el('button', { class: 'primary', on: { click: e => decide({ kind: 'action', runId: a.runId, approvalId: a.approvalId, decision: 'approve' }, e.target) } }, 'Send it');
    const no = el('button', { on: { click: e => decide({ kind: 'action', runId: a.runId, approvalId: a.approvalId, decision: 'reject' }, e.target) } }, 'Don’t send');
    box.append(el('div', { class: 'card' }, el('h3', {}, a.step), a.to ? el('p', {}, `To: ${a.to} — Subject: ${a.subject}`) : null,
      a.preview ? el('pre', { class: 'preview' }, a.preview) : null, el('div', { class: 'row' }, yes, no)));
  }
}
function renderFlows(flows, proposals) {
  const box = $('flows'); box.replaceChildren();
  if (!flows.length && !proposals.length) box.append(el('p', { class: 'muted' }, 'No flows yet. Ask your coding agent, e.g. “use Foundry to send my team’s weekly report to me”.'));
  for (const f of flows) box.append(el('div', { class: 'card' }, el('h3', {}, f.title),
    el('p', {}, el('span', { class: f.active ? 'ok' : 'wait' }, f.active ? 'On' : 'Not turned on'), ` · version ${f.version} · ${f.runs} run(s)`,
      f.lastRun ? ` · last: ${words[f.lastRun.status] ?? f.lastRun.status}` : ''),
    el('button', { on: { click: () => showFlow(f.flowId) } }, 'Versions and changes')));
  for (const p of proposals) box.append(el('div', { class: 'card' }, el('h3', {}, `Draft: ${p.flowId} v${p.version}`),
    el('p', { class: 'muted' }, p.dryRun === true ? 'Practice run passed; waiting for your OK.' : p.dryRun === false ? 'Practice run failed.' : 'Not tried on practice data yet.')));
}
function renderRuns(runs) {
  const box = $('runs'); box.replaceChildren();
  if (!runs.length) { box.append(el('p', { class: 'muted' }, 'No runs yet.')); return; }
  box.append(el('table', {}, el('thead', {}, el('tr', {}, ['Flow', 'Result', 'When', 'Record', ''].map(h => el('th', {}, h)))),
    el('tbody', {}, runs.map(r => el('tr', {}, el('td', {}, r.flowId ?? '?'),
      el('td', { class: r.status === 'succeeded' ? 'ok' : ['failed', 'uncertain'].includes(r.status) ? 'bad' : 'wait' }, words[r.status] ?? r.status, r.problem ? ` — ${r.problem.what}` : ''),
      el('td', {}, when(r.updatedAt)), el('td', {}, r.chainVerified ? `verified (${r.events} events)` : 'NOT verified'),
      el('td', {}, el('button', { on: { click: () => showRun(r.runId) } }, 'Open')))))));
}
async function showRun(runId) {
  try {
    const d = await api(`/api/runs/${encodeURIComponent(runId)}`);
    $('detail').hidden = false;
    $('detail-body').replaceChildren(el('div', { class: 'card' }, el('h3', {}, d.headline), d.problem ? el('p', { class: 'bad' }, `${d.problem.what} ${d.problem.next}`) : null,
      d.failedStep ? el('p', {}, `Failed step: ${d.failedStep}`) : null, el('p', {}, d.progress, ` · cost $${(d.costUsd ?? 0).toFixed(4)}`, ` · model calls: ${d.modelCalls.count} (${d.modelCalls.inputTokens + d.modelCalls.outputTokens} tokens)`),
      el('p', {}, 'Done means:'), checksList(d.checks),
      el('p', { class: d.chain.verified ? 'ok' : 'bad' }, d.chain.verified ? `Record verified: ${d.chain.events} events, each linked to the one before.` : `Record could not be verified: ${d.chain.reason}`),
      el('details', {}, el('summary', {}, 'Timeline'), el('table', {}, el('tbody', {}, d.timeline.map(t => el('tr', {}, el('td', {}, String(t.seq)), el('td', {}, when(t.at)), el('td', {}, t.type), el('td', {}, t.step ?? '')))))),
      el('p', { class: 'muted' }, d.honesty)));
    $('detail').scrollIntoView({ behavior: 'smooth' });
  } catch (error) { showError(error); }
}
async function showFlow(flowId) {
  try {
    const d = await api(`/api/flows/${encodeURIComponent(flowId)}`);
    const asked = await api(`/api/conditions/${encodeURIComponent(flowId)}`).catch(() => null);
    $('detail').hidden = false;
    $('detail-body').replaceChildren(...(asked ? [askedPanel(flowId, asked)] : []), ...d.versions.map(v => el('div', { class: 'card' }, el('h3', {}, `${v.state === 'draft' ? 'Draft' : 'Version'} ${v.version}${v.active ? ' (on)' : ''}`),
      el('p', { class: 'muted' }, `fingerprint ${v.hash.slice(0, 12)}`),
      v.diffFromPrevious ? el('p', {}, `Added: ${v.diffFromPrevious.added.map(x => x.step).join('; ') || 'nothing'} · Removed: ${v.diffFromPrevious.removed.map(x => x.step).join('; ') || 'nothing'} · Changed: ${v.diffFromPrevious.changed.map(x => `${x.step} (${x.fields.join(', ')})`).join('; ') || 'nothing'}${v.diffFromPrevious.checksChanged ? ' · the definition of done changed' : ''}`) : null,
      v.summary ? checksList(v.summary.checks.map(c => ({ ...c, passed: null }))) : null)));
  } catch (error) { showError(error); }
}

// "What you asked for": the person's conditions, each quoting their own words, with its check and status. Only the person confirms,
// waives or accepts edits here; a coding agent can only propose them.
const STATUS_TEXT = { met: ['✓ done', 'ok'], unmet: ['✗ not done', 'bad'], waived: ['set aside', 'muted'], unknown: ['? not known', 'wait'] };
const REASON_TEXT = { 'not-exercised': 'practice data never reached this', 'no-check': 'no automatic check for this yet', 'check-suspect': 'the check itself looks wrong',
  unverifiable: 'a run cannot show this: you check it', 'needs-answer': 'a question for you', 'not-run': 'not checked yet' };
async function conditionAction(body, button) {
  if (button) button.disabled = true;
  try { await api('/api/conditions', body); await showFlow(body.flowId); } catch (error) { showError(error); if (button) button.disabled = false; }
}
function askedPanel(flowId, a) {
  const t = a.tally ?? {};
  const rows = a.conditions.map(c => {
    const [label, cls] = STATUS_TEXT[c.status] ?? ['?', 'wait'];
    const why = c.status === 'unknown' ? (c.question ? `${REASON_TEXT[c.reason] ?? c.reason}: ${c.question}` : c.why ? `${REASON_TEXT[c.reason] ?? c.reason} (${c.why})` : REASON_TEXT[c.reason] ?? c.reason)
      : c.status === 'unmet' ? `${c.evidence?.[0]?.why ?? ''}. Is the flow wrong, the check wrong, or your words wrong?` : c.status === 'waived' ? `you set it aside: ${c.waived?.why ?? ''}` : c.thin ? 'seen only a few times in practice' : '';
    const buttons = [
      !c.confirmed ? el('button', { on: { click: e => conditionAction({ action: 'confirm', flowId, conditionId: c.id }, e.target) } }, 'Yes, I meant this') : null,
      c.status !== 'waived' ? el('button', { on: { click: e => { const r = prompt('Why can this be set aside for this version?'); if (r) conditionAction({ action: 'waive', flowId, conditionId: c.id, why: r }, e.target); } } }, 'Set aside') : el('button', { on: { click: e => conditionAction({ action: 'unwaive', flowId, conditionId: c.id }, e.target) } }, 'Check it again'),
      el('button', { on: { click: e => conditionAction({ action: 'remove', flowId, conditionId: c.id }, e.target) } }, 'Not a condition')];
    return el('li', { class: 'cond' }, el('p', {}, el('span', { class: cls }, label), ' “', c.quote, '”', c.confirmed ? '' : el('span', { class: 'muted' }, ' (not confirmed yet)')),
      c.check ? el('p', { class: 'muted' }, 'Checked as: ', c.check) : null, why ? el('p', { class: c.status === 'unmet' ? 'bad' : 'muted' }, why) : null,
      c.lastLive ? el('p', { class: c.lastLive.status === 'unmet' ? 'bad' : 'muted' }, `Last real run: ${(STATUS_TEXT[c.lastLive.status] ?? [c.lastLive.status])[0]}`,
        c.lastLive.status === 'unmet' && c.lastLive.evidence?.[0]?.why ? ` (${c.lastLive.evidence[0].why})` : c.lastLive.status === 'unknown' && c.lastLive.reason ? ` (${REASON_TEXT[c.lastLive.reason] ?? c.lastLive.reason})` : '') : null,
      ...(c.status !== 'unknown' ? (c.questions ?? []) : []).map(q => el('p', { class: 'muted' }, 'A question for you: ', q)), el('div', { class: 'row' }, buttons));
  });
  const pending = (a.pending ?? []).map(p => el('div', { class: 'card' }, el('p', {}, `Your agent proposes: ${p.delta.map(d => d.op === 'ADDED' ? `add “${d.condition.quote}”` : d.op === 'REMOVED' ? `remove ${d.id}` : `change ${d.id}`).join('; ')}`),
    el('div', { class: 'row' }, el('button', { class: 'primary', on: { click: e => conditionAction({ action: 'accept', flowId, proposalId: p.id }, e.target) } }, 'Accept'),
      el('button', { on: { click: e => conditionAction({ action: 'reject', flowId, proposalId: p.id }, e.target) } }, 'Reject'))));
  const add = el('input', { type: 'text', 'aria-label': 'Add a condition in your own words', placeholder: 'Add something you want, in your own words' });
  return el('div', { class: 'card asked' }, el('h3', {}, 'What you asked for'),
    el('p', { class: 'muted' }, `${t.met ?? 0} done · ${t.unmet ?? 0} not done · ${t.unknown ?? 0} not known · ${t.waived ?? 0} set aside. Checked on practice data, not your live data.`),
    el('ul', { class: 'conds' }, rows), ...pending,
    el('div', { class: 'row' }, add, el('button', { on: { click: e => { if (add.value.trim()) conditionAction({ action: 'add', flowId, quote: add.value.trim() }, e.target); } } }, 'Add'),
      el('button', { class: 'primary', on: { click: e => conditionAction({ action: 'check', flowId }, e.target) } }, 'Check on practice data')));
}
async function load() {
  if (!token) { showError(new Error('This tab has no key. Run `node app/cli.mjs start` again in your own terminal: it opens a fresh link (each link works once).')); return; }
  try {
    const o = await api('/api/overview');
    $('error').hidden = true;
    $('waiting').textContent = o.inbox.count ? `${o.inbox.count} waiting for you` : 'Nothing waiting';
    renderInbox(o.inbox); renderFlows(o.flows, o.proposals); renderRuns(o.runs);
    $('mode').textContent = `Approver: ${o.mode.approvers}. ${o.mode.note} Workspace: ${o.workspace}`;
  } catch (error) { showError(error); }
}
takeKey().then(k => { token = k; load(); setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5000); });
