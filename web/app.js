// The browser is a view of the canonical API records. It never evaluates a
// workflow expression, invents a run result, or generates an agent proposal.
const SVG_NS = 'http://www.w3.org/2000/svg';
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const STATUS_LABELS = {
  ready: 'Ready', pending: 'Pending', running: 'Running', completed: 'Completed',
  succeeded: 'Succeeded', failed: 'Failed', cancelled: 'Cancelled', skipped: 'Skipped',
  handled_error: 'Error handled', waiting: 'Waiting', waiting_child: 'Waiting for child',
  awaiting_human: 'Needs an answer', awaiting_approval: 'Needs approval', uncertain: 'Uncertain',
  proposed: 'Proposed', applied: 'Applied', approved: 'Approved', rejected: 'Rejected',
  unexecuted: 'Not executed', definition: 'Definition only', conflict: 'Version conflict',
  processing: 'Processing', generating: 'Generating', interrupted: 'Interrupted',
  'accepted-candidate': 'Candidate accepted', 'rejected-candidate': 'Candidate rejected',
  'failed-attempt': 'Attempt failed', diagnostic: 'Diagnostic', finished: 'Finished',
  'input-rejected': 'Input rejected'
};
export const statusLabel = status => STATUS_LABELS[status] ?? String(status ?? 'Unknown');
export function statusTone(status) {
  if (['completed', 'succeeded', 'applied', 'approved'].includes(status)) return 'good';
  if (['failed', 'cancelled', 'rejected', 'conflict', 'interrupted', 'failed-attempt', 'rejected-candidate', 'input-rejected'].includes(status)) return 'bad';
  if (['awaiting_human', 'awaiting_approval', 'uncertain', 'waiting', 'waiting_child', 'handled_error'].includes(status)) return 'waiting';
  if (['running', 'proposed', 'processing', 'generating', 'accepted-candidate'].includes(status)) return 'active';
  return 'neutral';
}

export function providerLabel(identity) {
  if (typeof identity === 'string') return identity;
  if (!identity || typeof identity !== 'object') return 'Provider identity unavailable';
  const name = [identity.name, identity.provider, identity.kind, identity.id].find(value => typeof value === 'string' && value.trim());
  return [...new Set([name, identity.model].filter(value => typeof value === 'string' && value.trim()))].join(' · ') || 'Provider identity available in receipt';
}

/** Configuration describes future handling; it cannot qualify a job or task. */
export function agentPresentation(agent = {}) {
  if (agent?.providerSuspension?.code === 'MODEL_RATE_LIMIT') return {
    automatic: false, autoApply: false, suspended: true, label: 'Provider paused',
    summary: 'The provider returned a rate limit. Pending requests are retained without dispatch. No automatic retry or paid fallback runs; restart deliberately after provider availability returns.'
  };
  const automatic = agent?.automaticBackgroundGeneration === true;
  const autoApply = automatic && agent?.appliesCandidates === true;
  return {
    automatic, autoApply, label: automatic ? (autoApply ? 'Automatic apply' : 'Automatic proposals') : 'Host agent',
    summary: automatic
      ? `Model responds automatically. ${autoApply ? 'Accepted candidates are applied automatically.' : 'Candidates are proposed for review before applying.'} Independent task qualification is not implied.`
      : 'Pending requests need a real host agent to submit a proposal. No AI rewrite runs in this page.'
  };
}

/** Historical application behavior comes from that job, never current settings. */
export function generationLabel(job, cancellationRequested = false, proposal = null) {
  if (job.status === 'running' && cancellationRequested) return 'Cancellation requested';
  if (job.status === 'applied' && job.limits?.autoApply === true) return 'Applied automatically';
  if (job.status === 'proposed') return proposal?.status === 'applied' ? 'Proposed · subsequently applied' : 'Proposed · review required';
  return statusLabel(job.status);
}

/** Loaded identities are candidates for host verification, never task evidence. */
export function appliedRunLinks(state, run) {
  if (!run) return [];
  return (state?.proposals ?? []).flatMap(proposal => {
    if (proposal.status !== 'applied' || proposal.workflowHash !== run.workflowHash || proposal.workflow?.id !== run.workflowId) return [];
    const request = state.requests?.find(item => item.id === proposal.requestId && item.status === 'applied');
    return request ? [{ request, proposal }] : [];
  });
}

const isDiagnostic = request => ['agent-request', 'agent-diagnostic'].includes(request.source) || request.status === 'diagnostic';

/** Stable longest-path DAG columns; malformed graphs remain inspectable. */
export function layoutGraph(nodes = []) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const degree = new Map(), next = new Map(), ranks = new Map(), edges = [];
  let missingDependencies = 0;
  for (const node of nodes) { degree.set(node.id, 0); next.set(node.id, []); ranks.set(node.id, 0); }
  for (const node of nodes) for (const id of node.needs ?? []) {
    if (!byId.has(id)) { missingDependencies++; continue; }
    degree.set(node.id, degree.get(node.id) + 1);
    next.get(id).push(node.id); edges.push({ from: id, to: node.id });
  }
  const queue = nodes.filter(node => degree.get(node.id) === 0).map(node => node.id);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor];
    for (const child of next.get(id)) {
      ranks.set(child, Math.max(ranks.get(child), ranks.get(id) + 1));
      degree.set(child, degree.get(child) - 1);
      if (degree.get(child) === 0) queue.push(child);
    }
  }
  const cyclic = nodes.filter(node => degree.get(node.id) > 0);
  const fallbackRank = Math.max(0, ...ranks.values()) + 1;
  for (const node of cyclic) ranks.set(node.id, fallbackRank);
  const columns = new Map();
  for (const node of nodes) {
    const rank = ranks.get(node.id);
    if (!columns.has(rank)) columns.set(rank, []);
    columns.get(rank).push(node);
  }
  const nodeWidth = 246, nodeHeight = 126, gapX = 76, gapY = 36, padding = 30;
  const rows = Math.max(1, ...[...columns.values()].map(column => column.length));
  const height = Math.max(390, padding * 2 + rows * (nodeHeight + gapY) - gapY);
  const positions = new Map();
  for (const [rank, column] of columns) {
    const columnHeight = column.length * (nodeHeight + gapY) - gapY;
    column.forEach((node, index) => positions.set(node.id, {
      x: padding + rank * (nodeWidth + gapX), y: (height - columnHeight) / 2 + index * (nodeHeight + gapY),
      width: nodeWidth, height: nodeHeight, rank, index
    }));
  }
  return { positions, edges, width: Math.max(380, padding * 2 + (Math.max(0, ...ranks.values()) + 1) * (nodeWidth + gapX) - gapX), height, cyclic: cyclic.map(node => node.id), missingDependencies };
}

/** A definition-only view deliberately has no run state from another iteration. */
export function flowContext(workflow, scope = [], run = null) {
  let flow = workflow, frameKey = 'root';
  for (const step of scope) {
    const node = flow?.nodes?.find(candidate => candidate.id === step.nodeId);
    if (!node?.body) return { flow: null, frame: null, frameKey: null };
    flow = node.body;
    frameKey = frameKey && Number.isSafeInteger(step.index) && step.index >= 0 ? `${frameKey}/${step.nodeId}:${step.index}` : null;
  }
  return { flow, frameKey, frame: run && frameKey ? (frameKey === 'root' ? run : run.frames?.[frameKey] ?? null) : null };
}

export function scopeForNodeKey(workflow, nodeKey) {
  const parts = String(nodeKey).split('/');
  if (parts.shift() !== 'root') return null;
  const nodeId = parts.pop(), scope = [];
  let flow = workflow;
  for (const part of parts) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(\d+)$/.exec(part);
    if (!match) return null;
    const node = flow?.nodes?.find(candidate => candidate.id === match[1]);
    if (!node?.body) return null;
    const index = Number(match[2]);
    if (!Number.isSafeInteger(index)) return null;
    scope.push({ nodeId: node.id, index }); flow = node.body;
  }
  return flow?.nodes?.some(node => node.id === nodeId) ? { scope, nodeId } : null;
}

export function childIterations(run, parentKey, nodeId) {
  if (!run || !parentKey) return [];
  const prefix = `${parentKey}/${nodeId}:`;
  return Object.keys(run.frames ?? {}).flatMap(key => {
    if (!key.startsWith(prefix)) return [];
    const suffix = key.slice(prefix.length);
    return /^\d+$/.test(suffix) && Number.isSafeInteger(Number(suffix)) ? [Number(suffix)] : [];
  }).sort((a, b) => a - b);
}

/** JSON-pointer differences include workflow-level changes, not just node counts. */
export function diffValues(before, after, limit = 250) {
  const changes = []; let truncated = false;
  const walk = (left, right, path) => {
    if (Object.is(left, right)) return;
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    if (changes.length >= limit) { truncated = true; return; }
    if (left && right && typeof left === 'object' && typeof right === 'object' && Array.isArray(left) === Array.isArray(right)) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        walk(left[key], right[key], `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
      }
    } else changes.push({ path: path || '/', kind: left === undefined ? 'added' : right === undefined ? 'removed' : 'changed', before: left, after: right });
  };
  walk(before, after, '');
  return { changes, truncated };
}

const pretty = value => value === undefined ? '(absent)' : JSON.stringify(value, null, 2);
const shortHash = value => String(value ?? '').slice(0, 12);
const shorten = (value, max) => { const text = String(value ?? ''); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };
const dateText = value => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

function startFoundryUI() {
  const $ = id => document.getElementById(id);
  const ui = {
    state: null, record: null, run: null, scope: [], nodeId: null, tab: 'canvas', zoom: 1,
    proposalId: null, records: new Map(), drafts: new Map(), details: new Map(), contexts: new Map(),
    requestBase: null, runDraft: null, selection: 0, refreshing: false, mutating: false,
    initialized: false, timer: null, graphLayout: null, lastErrors: null,
    pendingErrors: new Map(), cancelRequested: new Set(), eventLimit: 100, eventQuery: '',
    trial: null, trialError: null, deliveries: new Map()
  };

  // Only internal attribute names are passed here; all API strings become text.
  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (['disabled', 'hidden', 'required', 'open', 'checked', 'selected'].includes(key)) node[key] = Boolean(value);
      else if (key === 'value') node.value = value;
      else node.setAttribute(key, String(value));
    }
    for (const child of children.flat(Infinity)) if (child !== undefined && child !== null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    return node;
  }
  function svg(tag, attrs = {}, text) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function badge(status, text = statusLabel(status)) { return h('span', { class: `badge ${statusTone(status)}` }, text); }
  function button(text, action, props = {}) {
    return h('button', { type: 'button', class: 'button quiet', ...props, onclick: event => perform(() => action(event), event.currentTarget) }, text);
  }
  function detail(title, value, key, open = false) {
    const expanded = ui.details.has(key) ? ui.details.get(key) : open;
    return h('details', { class: 'json-details', 'data-detail': key, open: expanded }, h('summary', { 'data-focus': `detail:${key}` }, title), h('pre', { tabindex: '0' }, pretty(value)));
  }
  function facts(entries) {
    const dl = h('dl', { class: 'facts' });
    for (const [name, value] of entries) dl.append(h('dt', {}, name), h('dd', {}, value ?? '—'));
    return dl;
  }
  function empty(title, text, action) {
    return h('div', { class: 'empty-state' }, h('h2', {}, title), h('p', {}, text), action);
  }
  function announce(text) { $('notice').textContent = text; $('notice').hidden = !text; }
  function showError(error, target = $('error-notice')) {
    target.hidden = false;
    target.textContent = `${error.code ? `${error.code}: ` : ''}${error.message ?? error}${error.details ? `\n${pretty(error.details)}` : ''}`;
    if (target.id !== 'error-notice') target.className = 'inline-message danger';
  }
  async function perform(action, target) {
    if (target?.disabled) return;
    if (target) target.disabled = true;
    try { await action(); }
    catch (error) { showError(error); }
    finally { if (target?.isConnected) target.disabled = false; }
  }
  async function api(path, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) {
        if (!window.__FOUNDRY_TOKEN__) throw new Error('The local session token is unavailable. Reload the page from the Foundry server.');
        headers['Content-Type'] = 'application/json'; headers['X-Foundry-Token'] = window.__FOUNDRY_TOKEN__;
      }
      const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: controller.signal, cache: 'no-store', credentials: 'same-origin' });
      let data;
      try { data = await response.json(); } catch { throw new Error(`The server returned an unreadable response (${response.status}).`); }
      if (!response.ok) {
        const error = new Error(data.error?.message ?? `Request failed (${response.status}).`);
        error.code = data.error?.code; error.details = data.details ?? data.error?.details; error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The local request timed out. Refresh to check the recorded outcome before retrying a mutation.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  async function post(path, body = {}) {
    if (ui.mutating) throw new Error('Another action is being recorded. Check its result before submitting again.');
    ui.mutating = true; $('error-notice').hidden = true;
    try { return await api(path, body); }
    finally { ui.mutating = false; }
  }
  async function recordByHash(hash) {
    if (!ui.records.has(hash)) {
      const record = await api(`/api/workflows/${encodeURIComponent(hash)}`);
      ui.records.set(record.hash, record);
    }
    return ui.records.get(hash);
  }
  function headFor(id) { return ui.state?.workflows?.find(record => record.id === id) ?? null; }
  function currentContext() { return flowContext(ui.record?.workflow, ui.scope, ui.run); }

  // Polling preserves answer drafts, expanded evidence and keyboard focus.
  function preservingFocus(render) {
    const active = document.activeElement;
    const key = active?.getAttribute('data-focus');
    let range;
    if (active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && ['text', 'search'].includes(active.type))) range = [active.selectionStart, active.selectionEnd];
    render();
    if (!key || active.isConnected) return;
    const replacement = [...document.querySelectorAll('[data-focus]')].find(node => node.getAttribute('data-focus') === key);
    if (replacement) {
      replacement.focus({ preventScroll: true });
      if (range && typeof replacement.setSelectionRange === 'function') replacement.setSelectionRange(...range);
    }
  }

  async function refresh({ manual = false } = {}) {
    if (ui.refreshing) return;
    ui.refreshing = true;
    const selection = ui.selection;
    try {
      const state = await api('/api/state');
      ui.state = state;
      for (const record of state.workflows ?? []) ui.records.set(record.hash, record);
      if (!ui.initialized) {
        ui.initialized = true;
        ui.record = state.workflows?.[0] ?? null;
        $('request-scope').value = ui.record ? 'selected' : 'new';
      }
      if (ui.trial && selection === ui.selection) {
        const latest = state.trials?.find(trial => trial.id === ui.trial.id);
        if (manual || ui.trial.status === 'running' || (latest && latest.finishedAt !== ui.trial.finishedAt)) {
          try {
            const trial = await api(`/api/trials/${encodeURIComponent(ui.trial.id)}`);
            if (selection === ui.selection) bindTrial(trial);
          } catch (error) {
            if (selection === ui.selection) { ui.trialError = error; showError(error); }
          }
        }
      } else if (ui.run && selection === ui.selection) {
        const latest = state.runs?.find(run => run.id === ui.run.id);
        if (manual || !latest || latest.updatedAt !== ui.run.updatedAt) {
          const run = await api(`/api/runs/${encodeURIComponent(ui.run.id)}`);
          if (selection === ui.selection) ui.run = run;
        }
      } else if (ui.record && !ui.run && !ui.trial) {
        const latest = headFor(ui.record.workflow.id);
        if (latest && latest.hash !== ui.record.hash) { ui.record = latest; ui.scope = []; ui.nodeId = null; }
      }
      $('connection').textContent = 'Local · connected'; $('connection').dataset.connected = 'true';
      ui.lastErrors = null;
      preservingFocus(render);
    } catch (error) {
      $('connection').textContent = 'Disconnected · retrying'; $('connection').dataset.connected = 'false';
      if (manual || ui.lastErrors !== error.message) showError(error);
      ui.lastErrors = error.message;
    } finally { ui.refreshing = false; }
  }

  async function selectWorkflow(record) {
    ui.selection++; ui.record = record; ui.run = null; ui.trial = null; ui.trialError = null; ui.nodeId = null; ui.scope = []; ui.zoom = 1;
    if (!$('request-text').value.trim()) ui.requestBase = null;
    $('request-scope').value = 'selected'; setTab('canvas');
    $('graph-viewport').scrollTo(0, 0); render();
  }
  async function selectRun(id) {
    const selection = ++ui.selection;
    const run = await api(`/api/runs/${encodeURIComponent(id)}`);
    const record = await recordByHash(run.workflowHash);
    if (selection !== ui.selection) return;
    ui.run = run; ui.record = record; ui.trial = null; ui.trialError = null; ui.nodeId = null; ui.scope = []; ui.zoom = 1;
    setTab('canvas'); $('graph-viewport').scrollTo(0, 0); render();
  }
  function bindTrial(trial) {
    if (trial.run && !trial.workflow) throw new Error('The trial run was returned without its exact workflow source.');
    if (trial.run && (trial.run.id !== trial.runId || trial.run.workflowHash !== trial.workflowHash || trial.run.workflowId !== trial.workflowId)) throw new Error('The trial run does not match its recorded draft identity.');
    if (trial.workflow && (trial.workflow.id !== trial.workflowId || trial.workflow.version !== trial.workflowVersion)) throw new Error('The trial source does not match its recorded identity and version.');
    ui.trial = trial; ui.trialError = null;
    // Trial source never enters the saved workflow cache or resolves by head/id.
    ui.record = trial.workflow ? { hash: trial.workflowHash, workflow: trial.workflow } : null;
    ui.run = trial.run ? { ...trial.run, events: trial.events ?? [] } : null;
  }
  async function selectTrial(id) {
    const selection = ++ui.selection;
    const trial = await api(`/api/trials/${encodeURIComponent(id)}`);
    if (selection !== ui.selection) return;
    if (trial.id !== id) throw new Error('The returned trial does not match the requested identifier.');
    bindTrial(trial); ui.nodeId = null; ui.scope = []; ui.zoom = 1;
    ui.runDraft = null; $('run-dialog').close(); $('error-notice').hidden = true;
    setTab('canvas'); $('graph-viewport').scrollTo(0, 0); render();
  }
  function setTab(tab, focus = false) {
    ui.tab = tab;
    for (const name of ['canvas', 'changes', 'evidence', 'catalog']) {
      $(`panel-${name}`).hidden = name !== tab;
      $(`tab-${name}`).setAttribute('aria-selected', String(name === tab));
      $(`tab-${name}`).tabIndex = name === tab ? 0 : -1;
    }
    if (focus) $(`tab-${tab}`).focus();
    if (tab === 'changes') renderChanges();
    if (tab === 'evidence') renderEvidence();
    if (tab === 'catalog') renderCatalog();
  }
  function render() {
    if (!ui.state) return;
    $('workspace-path').textContent = ui.state.workspace ?? 'Local workspace';
    $('app-version').textContent = ui.state.version ? `v${ui.state.version}` : '';
    const agent = agentPresentation(ui.state.agent);
    $('agent-mode').textContent = agent.summary;
    $('composer-agent-mode').textContent = agent.label;
    $('composer-agent-mode').className = `badge ${agent.automatic ? 'active' : 'neutral'}`;
    $('composer-provider').hidden = !agent.automatic;
    $('composer-provider').textContent = agent.automatic ? providerLabel(ui.state.agent.provider) : '';
    renderSidebar(); renderHeading(); renderTrial(); renderGraph(); renderInspector(); renderRunControls(); renderRequestHint();
    $('change-count').textContent = String((ui.state.requests ?? []).filter(request => request.status !== 'applied').length);
    if (ui.tab === 'changes') renderChanges();
    if (ui.tab === 'evidence') renderEvidence();
    if (ui.tab === 'catalog') renderCatalog();
  }
  function renderSidebar() {
    const workflows = ui.state.workflows ?? [], runs = ui.state.runs ?? [], trials = ui.state.trials ?? [];
    $('workflow-count').textContent = String(workflows.length); $('run-count').textContent = String(runs.length);
    const query = $('workflow-search').value.toLowerCase();
    const matches = workflows.filter(record => `${record.title} ${record.id} ${record.workflow.domain}`.toLowerCase().includes(query));
    $('workflow-list').replaceChildren(...matches.map(record => button([
      h('span', { class: 'item-title' }, record.title),
      h('span', { class: 'item-meta' }, h('span', {}, record.workflow.domain), h('span', {}, `v${record.version}`))
    ], () => selectWorkflow(record), { class: 'item-button', 'aria-current': String(!ui.trial && !ui.run && ui.record?.workflow.id === record.id), 'data-focus': `workflow:${record.id}` })));
    if (!matches.length) $('workflow-list').append(h('p', { class: 'muted' }, query ? 'No matching workflows.' : 'No workflows yet. Start with a request or import.'));
    $('run-list').replaceChildren(...runs.map(run => button([
      h('span', { class: 'item-title' }, headFor(run.workflowId)?.title ?? run.workflowId),
      h('span', { class: 'item-meta' }, badge(run.status), h('code', {}, shortHash(run.id).slice(0, 8))),
      h('span', { class: 'item-meta' }, dateText(run.createdAt))
    ], () => selectRun(run.id), { class: 'item-button', 'aria-current': String(!ui.trial && ui.run?.id === run.id), 'data-focus': `run:${run.id}` })));
    if (!runs.length) $('run-list').append(h('p', { class: 'muted' }, 'Execution history will appear here.'));
    $('trial-count').textContent = String(trials.length);
    $('trial-list').replaceChildren(...trials.map(trial => button([
      h('span', { class: 'item-title' }, `${trial.workflowId} · draft v${trial.workflowVersion}`),
      h('span', { class: 'item-meta' }, badge(trial.runStatus ?? trial.status), h('code', {}, trial.id.slice(0, 8))),
      h('span', { class: 'item-meta' }, `Source ${shortHash(trial.workflowHash)}`)
    ], () => selectTrial(trial.id), { class: 'item-button', 'aria-current': String(ui.trial?.id === trial.id), 'data-trial-id': trial.id, 'data-focus': `trial:${trial.id}` })));
    if (!trials.length) $('trial-list').append(h('p', { class: 'muted' }, 'Host-agent draft trials will appear here.'));
  }
  function renderHeading() {
    const workflow = ui.record?.workflow;
    $('open-run').hidden = Boolean(ui.trial);
    $('open-run').disabled = !workflow || Boolean(ui.trial) || ui.mutating;
    $('view-head').hidden = Boolean(ui.trial) || !workflow || !ui.run || headFor(workflow.id)?.hash === ui.record.hash;
    if (ui.trial) {
      $('workflow-eyebrow').textContent = 'ISOLATED DRAFT TRIAL';
      $('workflow-title').textContent = workflow?.title ?? ui.trial.workflowId;
      $('workflow-goal').textContent = workflow?.goal ?? 'The trial receipt is available. Exact workflow source was not returned by the host.';
      $('workflow-meta').replaceChildren(badge('neutral', `Draft version ${ui.trial.workflowVersion}`),
        h('code', { title: ui.trial.workflowHash, 'data-testid': 'selected-hash' }, `Trial source ${shortHash(ui.trial.workflowHash)}`),
        badge(ui.trial.runStatus ?? ui.trial.status), badge('neutral', 'Independent task unqualified'));
      return;
    }
    if (!workflow) {
      $('workflow-eyebrow').textContent = 'YOUR AUTOMATION WORKSPACE';
      $('workflow-title').textContent = 'Make every step inspectable.';
      $('workflow-goal').textContent = 'Describe a task for your host agent, or import a workflow. Explore every dependency, decision and execution receipt in one place.';
      $('workflow-meta').replaceChildren(); return;
    }
    $('workflow-eyebrow').textContent = `${workflow.domain} / ${ui.run ? 'PINNED RUN' : 'WORKFLOW'}`.toUpperCase();
    $('workflow-title').textContent = workflow.title; $('workflow-goal').textContent = workflow.goal;
    $('workflow-meta').replaceChildren(
      badge('neutral', `Version ${workflow.version}`),
      h('code', { title: ui.record.hash, 'data-testid': 'selected-hash' }, `${ui.run ? 'Pinned' : 'Source'} ${shortHash(ui.record.hash)}`),
      h('span', {}, `${workflow.nodes.length} root nodes`),
      ...(ui.run ? [badge(ui.run.status), h('code', { title: ui.run.id }, `Run ${ui.run.id.slice(0, 8)}`)] : [])
    );
    if (ui.run && headFor(workflow.id)?.hash !== ui.record.hash) $('workflow-meta').append(badge('waiting', `Current head is v${headFor(workflow.id)?.version ?? '?'}`));
  }

  function renderTrial() {
    const host = $('trial-inspection'), trial = ui.trial;
    host.hidden = !trial; host.replaceChildren();
    if (!trial) return;
    host.append(h('div', { class: 'section-heading' }, h('h2', {}, 'Draft trial inspection'),
      badge(trial.localAcceptancePassed === true ? 'succeeded' : 'neutral', trial.localAcceptancePassed === true ? 'Local acceptance passed' : 'Local acceptance not passed')),
    h('p', { class: 'muted' }, 'This isolated trial records a draft execution. It does not apply a proposal or create a reusable workflow head.'),
    facts([['Trial ID', h('code', { 'data-testid': 'inspected-trial-id' }, trial.id)], ['Request ID', h('code', {}, trial.requestId)],
      ['Exact draft hash', h('code', { 'data-testid': 'trial-source-hash' }, trial.workflowHash)], ['Base hash', h('code', {}, trial.baseHash ?? 'New workflow request')]]),
    h('p', { class: 'muted', 'data-testid': 'trial-qualification' }, 'Independent task unqualified. Local acceptance and artifact identities do not establish task success.'),
    h('div', { class: 'trial-actions' }, button('Inspect trial evidence', () => setTab('evidence'), { 'data-focus': 'trial-evidence' }),
      button('Load trial request context', () => showRequestContext(trial.requestId), { 'data-focus': 'trial-context' })));
    if (!trial.run) host.append(h('p', { class: 'inline-message' }, trial.runStatus === 'input-rejected' ? 'Input rejected before execution. No run or node outputs were created.' : 'No run is available in this trial receipt.'));
    if (!trial.workflow) host.append(h('p', { class: 'inline-message warning' }, 'Exact draft source is unavailable from this inspection. No saved workflow is substituted.'));
    if (ui.trialError) host.append(h('p', { class: 'inline-message danger', role: 'status' }, `Last inspected snapshot; refresh failed: ${ui.trialError.code ?? ''} ${ui.trialError.message}`));
    if (trial.error) host.append(detail('Trial error', trial.error, `trial-error:${trial.id}`, true));
  }

  function renderGraph() {
    const { flow, frame, frameKey } = currentContext();
    $('breadcrumbs').replaceChildren(button('Root graph', () => { ui.scope = []; ui.nodeId = null; render(); }, { class: 'text-button', 'data-focus': 'crumb:root' }));
    ui.scope.forEach((step, index) => {
      $('breadcrumbs').append(h('span', { 'aria-hidden': 'true' }, '/'), button(`${step.nodeId}${step.index === null ? '' : ` [${step.index}]`}`, () => { ui.scope = ui.scope.slice(0, index + 1); ui.nodeId = null; render(); }, { class: 'text-button', 'data-focus': `crumb:${index}` }));
    });
    renderFrameSelect();
    if (!flow) {
      if (ui.trial) {
        $('graph').replaceChildren(empty('Trial source unavailable', 'The host returned the trial receipt without its workflow source. Its graph cannot be displayed.'));
        $('graph-summary').textContent = 'No exact trial source returned'; ui.graphLayout = null; return;
      }
      $('graph').replaceChildren(h('div', { class: 'graph-empty' }, h('div', { class: 'graph-empty-symbol', 'aria-hidden': 'true' }, '⌘'), h('h2', {}, 'From intent to an inspectable workflow'), h('p', {}, 'Your graph will show the actual program: tasks, branches, checks and bounded iteration.'), button('Describe a workflow', () => beginRequest(true), { class: 'button primary' })));
      $('graph-summary').textContent = 'No workflow selected'; ui.graphLayout = null; return;
    }
    const layout = layoutGraph(flow.nodes); ui.graphLayout = layout;
    const root = svg('svg', { viewBox: `0 0 ${layout.width} ${layout.height}`, width: Math.round(layout.width * ui.zoom), height: Math.round(layout.height * ui.zoom), role: 'group', 'aria-label': `Workflow graph: ${flow.nodes.length} nodes, ${layout.edges.length} dependencies`, 'data-workflow-hash': ui.record.hash, ...(ui.trial ? { 'data-trial-id': ui.trial.id } : {}) });
    const defs = svg('defs');
    const marker = svg('marker', { id: 'edge-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse' });
    marker.append(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'edge-arrow' })); defs.append(marker); root.append(defs);
    for (const edge of layout.edges) {
      const a = layout.positions.get(edge.from), b = layout.positions.get(edge.to);
      const x1 = a.x + a.width, y1 = a.y + a.height / 2, x2 = b.x - 2, y2 = b.y + b.height / 2;
      const bend = Math.max(36, (x2 - x1) / 2);
      const path = svg('path', { d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`, class: 'edge', 'marker-end': 'url(#edge-arrow)', 'data-from': edge.from, 'data-to': edge.to, 'aria-hidden': 'true' });
      path.append(svg('title', {}, `${edge.from} → ${edge.to}`)); root.append(path);
    }
    flow.nodes.forEach((node, index) => {
      const pos = layout.positions.get(node.id), state = frame?.nodes?.[node.id];
      const status = state?.status ?? (ui.run && !frameKey ? 'definition' : 'unexecuted');
      const key = frameKey ? `${frameKey}/${node.id}` : `${ui.scope.map(step => step.nodeId).join('/')}/${node.id}`;
      const group = svg('g', { class: 'graph-node', transform: `translate(${pos.x} ${pos.y})`, role: 'button', tabindex: '0', 'aria-label': `${node.id}: ${node.description}. ${node.kind}. ${statusLabel(status)}. ${node.needs.length ? `Depends on ${node.needs.join(', ')}.` : 'No dependencies.'}`, 'aria-pressed': String(ui.nodeId === node.id), 'data-node-id': node.id, 'data-focus': `graph:${key}`, 'data-tone': statusTone(status) });
      group.append(svg('title', {}, `${node.id}\n${node.description}\n${node.tool ?? node.kind}\n${statusLabel(status)}`));
      group.append(svg('rect', { class: 'node-card', x: 0, y: 0, width: pos.width, height: pos.height, rx: 12 }));
      group.append(svg('rect', { class: 'node-accent', x: 0, y: 17, width: 3, height: pos.height - 34, rx: 1.5 }));
      group.append(svg('text', { class: 'node-kind', x: 17, y: 23 }, `${node.kind.toUpperCase()}${node.body ? '  ↳' : ''}`));
      group.append(svg('text', { class: 'node-name', x: 17, y: 47 }, shorten(node.id, 29)));
      group.append(svg('text', { class: 'node-description', x: 17, y: 67 }, shorten(node.description, 38)));
      const extra = node.tool ?? (node.kind === 'map' ? `Up to ${node.maxItems} items` : node.kind === 'loop' ? `Up to ${node.maxIterations} iterations` : node.kind === 'wait' ? `${node.delayMs} ms delay` : node.kind === 'human' ? 'Answer required' : `${node.checks?.length ?? 0} checks`);
      group.append(svg('text', { class: 'node-description', x: 17, y: 84 }, shorten(`${node.when ? 'Conditional · ' : ''}${extra}`, 37)));
      group.append(svg('rect', { class: 'node-chip', x: 16, y: 96, width: 180, height: 19, rx: 4 }));
      group.append(svg('text', { class: 'node-status', x: 23, y: 109 }, `${statusLabel(status)}${state?.attempts ? ` · ${state.attempts} attempt${state.attempts === 1 ? '' : 's'}` : ''}`));
      group.append(svg('text', { class: 'node-number', x: 217, y: 109 }, String(index + 1).padStart(2, '0')));
      group.addEventListener('click', () => { ui.nodeId = node.id; preservingFocus(() => { renderGraph(); renderInspector(); }); });
      group.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); group.dispatchEvent(new MouseEvent('click')); }
        if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const all = [...$('graph').querySelectorAll('.graph-node')];
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : Math.max(0, Math.min(all.length - 1, index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1)));
          all[next]?.focus();
        }
      });
      root.append(group);
    });
    $('graph').replaceChildren(root);
    $('zoom-label').value = `${Math.round(ui.zoom * 100)}%`;
    const completed = flow.nodes.filter(node => ['completed', 'skipped', 'handled_error'].includes(frame?.nodes?.[node.id]?.status)).length;
    $('graph-summary').textContent = `${flow.nodes.length} nodes · ${layout.edges.length} dependencies${ui.run && frameKey ? ` · ${completed} resolved` : ''}${layout.cyclic.length || layout.missingDependencies ? ' · Invalid dependencies detected' : ''}`;
  }
  function renderFrameSelect() {
    const container = $('frame-controls'); container.hidden = ui.scope.length === 0;
    if (!ui.scope.length) { container.replaceChildren(); return; }
    const parent = flowContext(ui.record?.workflow, ui.scope.slice(0, -1), ui.run);
    const step = ui.scope.at(-1), indices = childIterations(ui.run, parent.frameKey, step.nodeId);
    const select = h('select', { id: 'iteration-select', 'data-focus': 'iteration-select' }, h('option', { value: 'definition' }, 'Definition · no execution state'), indices.map(index => h('option', { value: String(index) }, `Iteration ${index} · recorded execution`)));
    select.value = step.index === null ? 'definition' : String(step.index);
    if (!select.value) select.value = 'definition';
    select.addEventListener('change', () => { ui.scope[ui.scope.length - 1] = { ...step, index: select.value === 'definition' ? null : Number(select.value) }; ui.nodeId = null; render(); });
    container.replaceChildren(h('label', { for: 'iteration-select' }, 'Nested view'), select);
    if (ui.run && !indices.length) container.append(h('span', { class: 'muted' }, 'No iteration has been recorded here yet.'));
  }
  function openNested(node) {
    const context = currentContext();
    const iterations = childIterations(ui.run, context.frameKey, node.id);
    ui.scope.push({ nodeId: node.id, index: iterations[0] ?? null }); ui.nodeId = null;
    $('graph-viewport').scrollTo(0, 0); render();
  }
  function inspectNodeKey(key) {
    const located = scopeForNodeKey(ui.record?.workflow, key);
    if (!located) throw new Error('This node cannot be located in the pinned workflow. Refresh its exact version.');
    ui.scope = located.scope; ui.nodeId = located.nodeId; setTab('canvas'); render();
    const node = [...$('graph').querySelectorAll('.graph-node')].find(element => element.getAttribute('data-node-id') === ui.nodeId);
    node?.focus();
  }

  function renderInspector() {
    const host = $('inspector-content'), workflow = ui.record?.workflow;
    host.replaceChildren();
    if (!workflow) { host.append(h('h2', {}, 'See what will happen'), h('p', { class: 'muted' }, 'Select a node to inspect its inputs, dependencies, conditions and execution results.')); return; }
    const { flow, frame, frameKey } = currentContext();
    const node = flow?.nodes.find(candidate => candidate.id === ui.nodeId);
    if (!node) {
      host.append(badge('neutral', ui.scope.length ? 'Nested workflow' : 'Workflow contract'), h('h2', {}, ui.scope.length ? ui.scope.at(-1).nodeId : workflow.title), h('p', { class: 'muted' }, 'Select any graph node to inspect its behavior and recorded results.'));
      host.append(facts([['Identity', workflow.id], ['Version', workflow.version], ['Source hash', h('code', { 'data-testid': 'full-source-hash' }, ui.record.hash)], ['View', ui.trial ? 'Isolated draft trial' : ui.run ? 'Pinned run version' : 'Current workflow head']]));
      host.append(detail('Success checks', flow?.acceptance ?? workflow.acceptance, `acceptance:${ui.record.hash}:${frameKey}`, true));
      host.append(detail('Input schema', workflow.inputSchema ?? {}, `workflow-input:${ui.record.hash}`));
      host.append(detail('Execution budget', workflow.budget, `budget:${ui.record.hash}`));
      host.append(detail('Assumptions, risks & success criteria', workflow.envelope, `envelope:${ui.record.hash}`));
      if (workflow.metadata) host.append(detail('Sources & rationale', workflow.metadata, `metadata:${ui.record.hash}`));
      host.append(detail('Complete workflow JSON', workflow, `source:${ui.record.hash}`));
      return;
    }
    const state = frame?.nodes?.[node.id], output = frame?.outputs?.[node.id];
    const key = `${ui.record.hash}:${frameKey}:${node.id}`;
    host.append(badge('neutral', node.kind), badge(state?.status ?? 'unexecuted'), h('h2', {}, node.id), h('p', { class: 'muted' }, node.description));
    if (node.body) host.append(button('Open nested flow ↳', () => openNested(node), { class: 'button primary', 'data-focus': `nested:${node.id}` }));
    host.append(facts([['Node path', h('code', {}, frameKey ? `${frameKey}/${node.id}` : 'Definition only')], ['Join', node.join ?? 'all_success'], ...(node.tool ? [['Capability', h('code', {}, node.tool)], ['Timeout', `${node.timeoutMs} ms`], ['Attempts', `${state?.attempts ?? 0} / ${node.retry?.maxAttempts ?? 1}`], ['Backoff', `${node.retry?.backoffMs ?? 0} ms`], ['On error', node.onError ?? 'stop']] : [])]));
    host.append(h('h3', { class: 'inspector-subhead' }, 'Dependencies'));
    host.append(node.needs.length ? h('div', { class: 'dependency-buttons' }, node.needs.map(id => button(id, () => { ui.nodeId = id; renderGraph(); renderInspector(); }, { 'data-focus': `dependency:${id}` }))) : h('p', { class: 'muted' }, 'Root node · no prerequisites'));
    if (node.when) host.append(detail('Run condition', node.when, `when:${key}`, true));
    if (Object.hasOwn(node, 'args')) host.append(detail('Arguments & references', node.args, `args:${key}`, true));
    if (node.checks) host.append(detail('Assertions', node.checks, `checks:${key}`, true));
    if (node.kind === 'human') host.append(h('h3', { class: 'inspector-subhead' }, 'Question'), h('p', { class: 'muted' }, node.question), detail('Answer schema', node.answerSchema, `answer-schema:${key}`, true));
    if (node.kind === 'map') host.append(detail('Map inputs & bound', { items: node.items, maxItems: node.maxItems, ...(node.input !== undefined ? { input: node.input } : {}) }, `map:${key}`, true));
    if (node.kind === 'loop') host.append(detail('Loop state & stop condition', { initial: node.initial, until: node.until, maxIterations: node.maxIterations, ...(node.input !== undefined ? { input: node.input } : {}) }, `loop:${key}`, true));
    if (node.kind === 'wait') host.append(facts([['Delay', `${node.delayMs} ms`], ['Wake time', dateText(state?.wakeAt)]]));
    const capability = ui.state.capabilities?.find(item => item.name === node.tool);
    if (capability) {
      host.append(detail('Capability input schema', capability.inputSchema, `cap-input:${key}`), detail('Capability output schema', capability.outputSchema, `cap-output:${key}`));
      host.append(detail('Authority & implementation', { effects: capability.effects, risk: capability.risk, requiresApproval: capability.requiresApproval, implementation: capability.implementation, handlerHash: capability.handlerHash }, `cap-authority:${key}`));
    }
    host.append(h('h3', { class: 'inspector-subhead' }, 'Recorded execution'));
    if (state?.error) host.append(detail('Error', state.error, `node-error:${key}`, true));
    if (frame && Object.hasOwn(frame.outputs ?? {}, node.id)) host.append(detail('Output', output, `output:${key}`, true));
    else host.append(h('p', { class: 'muted' }, ui.run ? 'No output recorded for this node in this iteration.' : ui.trial ? 'No execution output is recorded for this draft node.' : 'Start or select a run to see outputs.'));
    if (state) host.append(detail('State & evidence hashes', state, `state:${key}`));
    const events = (ui.run?.events ?? []).filter(event => frameKey && event.nodeKey === `${frameKey}/${node.id}`);
    if (events.length) host.append(detail(`Node events (${events.length})`, events, `node-events:${key}`));
  }

  function draftControl(key, schema) {
    const saved = ui.drafts.get(key) ?? '';
    let control;
    if (Array.isArray(schema?.enum) || schema?.type === 'boolean') {
      const values = schema.enum ?? [true, false];
      control = h('select', { required: true, 'data-draft': key, 'data-focus': `answer:${key}`, 'aria-label': 'Answer' }, h('option', { value: '' }, 'Choose an answer…'), values.map(value => h('option', { value: JSON.stringify(value) }, typeof value === 'string' ? value : JSON.stringify(value))));
      control.value = saved;
    } else if (['integer', 'number'].includes(schema?.type)) {
      control = h('input', { type: 'number', step: schema.type === 'integer' ? '1' : 'any', value: saved, required: true, 'data-draft': key, 'data-focus': `answer:${key}`, 'aria-label': 'Answer' });
    } else control = h('textarea', { rows: '3', value: saved, required: schema?.type !== 'string' || (schema.minLength ?? 0) > 0, 'data-draft': key, 'data-focus': `answer:${key}`, 'aria-label': schema?.type === 'string' ? 'Answer text' : 'Answer JSON', placeholder: schema?.type === 'string' ? 'Type your answer…' : 'Enter JSON matching the answer schema…' });
    return control;
  }
  function readAnswer(control, schema) {
    if (control instanceof HTMLSelectElement) {
      if (control.value === '') throw new Error('Choose an explicit answer.');
      return JSON.parse(control.value);
    }
    if (schema?.type === 'string') return control.value;
    if (['number', 'integer'].includes(schema?.type)) {
      if (control.value.trim() === '' || !Number.isFinite(Number(control.value))) throw new Error('Enter a finite number.');
      return Number(control.value);
    }
    try { return JSON.parse(control.value); } catch { throw new Error('The answer must be valid JSON matching its schema.'); }
  }
  function renderRunControls() {
    const host = $('run-controls'), run = ui.run;
    host.hidden = !run || Boolean(ui.trial); host.replaceChildren();
    if (!run || ui.trial) return;
    const actions = h('div', {}, button('View evidence', () => setTab('evidence'), { 'data-focus': 'view-evidence' }));
    if (!TERMINAL.has(run.status) && run.status !== 'uncertain' && !run.executionActive) actions.append(button('Resume run', async () => { await post(`/api/runs/${encodeURIComponent(run.id)}/resume`); announce('Resume requested. The recorded run status will update.'); await refresh({ manual: true }); }, { 'data-focus': 'resume-run', disabled: ui.mutating }));
    if (run.executionActive) actions.append(button('Cancel execution', async () => { await post(`/api/runs/${encodeURIComponent(run.id)}/cancel`); announce('Cancellation requested. Completed effects remain recorded; check the final run status.'); await refresh({ manual: true }); }, { class: 'button danger', 'data-focus': 'cancel-run', disabled: ui.mutating }));
    host.append(h('div', { class: 'run-summary' }, h('div', {}, h('h2', {}, 'Run controls'), badge(run.status)), actions));
    host.append(renderRunLinkage(run));
    if (run.error) host.append(detail('Run error', run.error, `run-error:${run.id}`, true));
    if (run.status === 'uncertain') host.append(h('p', { class: 'inline-message warning' }, 'An effect has an uncertain outcome. This interface cannot reconcile it or safely retry it. Inspect its evidence with the host operator.'));
    if (run.status === 'waiting') host.append(h('p', { class: 'inline-message' }, 'This run is waiting. Inspect wake times or child state, then resume when ready. This page does not auto-resume runs.'));
    const cards = h('div', { class: 'control-grid' });
    if (!TERMINAL.has(run.status)) for (const [frameKey, frame] of [['root', run], ...Object.entries(run.frames ?? {})]) {
      for (const [nodeId, state] of Object.entries(frame.nodes ?? {})) {
        if (state.status !== 'awaiting_human') continue;
        const key = `${frameKey}/${nodeId}`, draftKey = `${run.id}:${key}`;
        const control = draftControl(draftKey, state.answerSchema);
        const errorHost = h('div', { role: 'alert' });
        if (ui.pendingErrors.has(draftKey)) showError(ui.pendingErrors.get(draftKey), errorHost);
        const form = h('form', { class: 'control-card', 'data-question': key }, badge('awaiting_human'), h('h3', {}, state.question), h('code', { class: 'hash-line' }, key), button('Inspect this node', () => inspectNodeKey(key), { class: 'text-button', 'data-focus': `inspect-question:${key}` }), detail('Required answer schema', state.answerSchema, `pending-answer:${draftKey}`), h('label', {}, state.answerSchema?.type === 'string' ? 'Your answer' : 'Your answer (validated against the schema)', control), errorHost, h('button', { class: 'button primary', type: 'submit', disabled: ui.mutating, 'data-focus': `submit-answer:${key}` }, 'Submit answer & continue'));
        form.addEventListener('submit', event => {
          event.preventDefault();
          perform(async () => {
            try {
              const answer = readAnswer(control, state.answerSchema);
              await post(`/api/runs/${encodeURIComponent(run.id)}/answers`, { nodeId: key, answer });
              ui.drafts.delete(draftKey); ui.pendingErrors.delete(draftKey); announce(`Answer recorded for ${key}.`); await refresh({ manual: true });
            } catch (error) { ui.pendingErrors.set(draftKey, error); showError(error, errorHost); }
          }, form.querySelector('button[type="submit"]'));
        });
        cards.append(form);
      }
    }
    if (!TERMINAL.has(run.status)) for (const approval of Object.values(run.approvals ?? {})) {
      if (approval.status !== 'pending') continue;
      cards.append(h('section', { class: 'control-card', 'data-approval': approval.id }, badge('awaiting_approval'), h('h3', {}, approval.tool), h('p', {}, 'Allow this exact operation for this run?'), facts([['Node', h('code', {}, approval.nodeKey)], ['Risk', approval.risk], ['Workflow hash', h('code', {}, run.workflowHash)], ['Approval ID', h('code', {}, approval.id)]]), detail('Exact arguments', approval.args, `approval-args:${approval.id}`, true), detail('Idempotency key', approval.idempotencyKey, `approval-idempotency:${approval.id}`), h('div', { class: 'control-actions' },
        ...[true, false].map(approved => button(approved ? 'Approve operation' : 'Reject operation', async () => { await post(`/api/runs/${encodeURIComponent(run.id)}/approvals`, { approvalId: approval.id, approved }); announce(approved ? 'Approval recorded for this exact operation.' : 'Operation rejected.'); await refresh({ manual: true }); }, { class: `button ${approved ? 'primary' : 'danger'}`, disabled: ui.mutating, 'data-focus': `approval:${approval.id}:${approved}` }))
      )));
    }
    if (cards.childElementCount) host.append(cards);
  }

  function requestBinding() { return ui.trial ? null : ui.requestBase ?? ui.record; }
  function renderRequestHint() {
    const isNew = $('request-scope').value === 'new', base = requestBinding();
    const stale = !isNew && base && headFor(base.workflow.id)?.hash !== base.hash;
    $('request-scope').options[0].textContent = base ? `Revise: ${shorten(base.workflow.title, 48)} (v${base.workflow.version})` : 'Revise selected workflow';
    $('request-scope').options[0].disabled = !base;
    $('submit-request').disabled = ui.mutating || (!isNew && (!base || stale));
    $('rebind-request').hidden = Boolean(ui.trial) || isNew || !ui.record || (base?.hash === ui.record.hash && !stale);
    const waiting = agentPresentation(ui.state?.agent).summary;
    $('request-hint').textContent = isNew ? `New workflow request. ${waiting}` : ui.trial ? 'An isolated draft cannot be revised as a saved head. Load its trial request context to continue with the host agent, or select a saved workflow.' : !base ? 'Select a workflow or choose “Create a new workflow”.'
      : stale ? `This draft targets v${base.workflow.version} (${shortHash(base.hash)}), but that workflow has a newer head. Select the current version and explicitly rebind the draft before queuing it.`
      : `Bound to ${base.workflow.id} v${base.workflow.version} · ${shortHash(base.hash)}. ${waiting}`;
  }
  function beginRequest(isNew = false) {
    if (isNew) { $('request-scope').value = 'new'; ui.requestBase = null; }
    setTab('canvas'); renderRequestHint(); $('request-text').focus(); $('request-form').scrollIntoView({ block: 'center', behavior: 'instant' });
  }
  async function submitRequest(event) {
    event.preventDefault();
    await perform(async () => {
      const text = $('request-text').value.trim();
      if (!text) throw new Error('Describe the task or change before queuing a request.');
      const isNew = $('request-scope').value === 'new', base = requestBinding();
      if (!isNew && !base) throw new Error('Select a workflow to revise.');
      const request = await post('/api/requests', { text, ...(!isNew ? { workflowId: base.workflow.id, baseHash: base.hash } : {}) });
      $('request-text').value = ''; ui.requestBase = null; ui.proposalId = null;
      const processing = agentPresentation(ui.state?.agent);
      announce(`Request ${request.id.slice(0, 8)} queued. ${processing.suspended ? 'The provider is paused; this request is retained without dispatch.' : processing.automatic ? 'The configured provider will process it. Follow the recorded generation status below.' : 'It is pending until a real host agent submits a proposal.'}`);
      await refresh({ manual: true }); setTab('changes');
    }, $('submit-request'));
    renderRequestHint();
  }
  async function openProposal(id) {
    const proposal = ui.state.proposals.find(item => item.id === id);
    if (!proposal) throw new Error('The proposal is no longer in the current state. Refresh to check it.');
    ui.proposalId = id;
    if (proposal.baseHash) await recordByHash(proposal.baseHash);
    renderProposalReview();
    $('proposal-review').scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  function proposalConflict(proposal) {
    return proposal.status === 'proposed' && (headFor(proposal.workflow.id)?.hash ?? null) !== (proposal.baseHash ?? null);
  }
  async function showRequestContext(id) {
    const context = await api(`/api/context/${encodeURIComponent(id)}`);
    if (context.requestId !== id) throw new Error('The host context does not match the requested identifier.');
    ui.contexts.set(id, context); ui.details.set(`context:${id}`, true); ui.proposalId = null;
    setTab('changes'); preservingFocus(renderChanges);
    // A trial can refer to a request outside the recent state page.
    const card = [...$('request-list').querySelectorAll('[data-request-id]')].find(node => node.dataset.requestId === id);
    card?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  function renderRunLinkage(run) {
    const host = h('section', { class: 'run-linkage', 'aria-label': 'Request and run linkage' });
    const links = appliedRunLinks(ui.state, run);
    if (!links.length) {
      host.append(h('p', { class: 'muted' }, 'No applied request and proposal matching this exact run are present in the loaded history. Delivery and repair linkage are unavailable here.'));
      return host;
    }
    for (const { request, proposal } of links) {
      const key = `${request.id}:${proposal.id}:${run.id}`;
      const receipt = ui.deliveries.get(key);
      const entry = h('div', { 'data-link-request': request.id }, h('h3', {}, 'Request → applied proposal → run'),
        facts([['Request', h('code', {}, request.id)], ['Applied proposal', h('code', {}, proposal.id)], ['Run', h('code', {}, run.id)], ['Workflow hash', h('code', {}, run.workflowHash)]]));
      entry.append(button(receipt ? 'Refresh delivery linkage' : 'Inspect delivery linkage', async () => {
        ui.deliveries.delete(key);
        try {
          const checked = await post('/api/delivery', { requestId: request.id, proposalId: proposal.id, runId: run.id });
          if (checked.requestId !== request.id || checked.proposalId !== proposal.id || checked.runId !== run.id || checked.workflowHash !== run.workflowHash) throw new Error('The delivery receipt does not match the inspected request, proposal and run.');
          ui.deliveries.set(key, checked);
        } finally { preservingFocus(render); }
      }, { 'data-focus': `delivery:${key}`, disabled: ui.mutating }));
      if (receipt) entry.append(h('p', { class: 'inline-message', 'data-testid': 'delivery-qualification' }, 'Exact delivery linkage inspected. Independent task verification is not established for this run.'),
        detail('Inspected delivery receipt', receipt, `delivery:${key}`, true),
        detail('Separately scoped task-suite evidence', receipt.matchedTaskEvidence ?? [], `delivery-suite:${key}`));
      const repair = ui.state.requests?.find(item => item.source === 'agent-diagnostic' && item.parentRequestId === request.id && item.failedRunId === run.id);
      if (repair) entry.append(button('Inspect diagnostic repair', () => showRequestContext(repair.id), { 'data-focus': `existing-repair:${repair.id}` }));
      else if (run.status === 'failed' && !run.executionActive && run.error && run.events?.length && headFor(run.workflowId)?.hash === run.workflowHash) entry.append(button('Open diagnostic repair', async () => {
        try {
          const created = await post('/api/repair-requests', { requestId: request.id, failedRunId: run.id, expectedHash: run.workflowHash });
          ui.state.requests = [created, ...(ui.state.requests ?? []).filter(item => item.id !== created.id)];
          ui.proposalId = null; setTab('changes');
          announce(`Diagnostic repair ${created.id} recorded. Automatic generation is off; the host agent can inspect its preserved task and failure.`);
          await showRequestContext(created.id);
          await refresh({ manual: true });
        } catch (error) { await refresh({ manual: true }); throw error; }
      }, { 'data-focus': `repair:${key}`, disabled: ui.mutating }));
      else if (run.status === 'failed') entry.append(h('p', { class: 'muted' }, 'A new diagnostic repair requires verified terminal failure evidence at the current workflow head.'));
      host.append(entry);
    }
    return host;
  }
  function renderAgentStatus() {
    const host = $('agent-status'), state = ui.state, agent = state.agent ?? {}, mode = agentPresentation(agent);
    const jobs = state.generationJobs ?? [], active = jobs.filter(job => job.status === 'running').length;
    host.replaceChildren(h('div', { class: 'section-heading' },
      h('div', {}, h('span', { class: 'eyebrow' }, 'REQUEST PROCESSING'), h('h2', {}, mode.automatic || mode.suspended ? providerLabel(agent.provider) : 'Connected host agent')),
      badge(mode.suspended ? 'waiting' : mode.automatic ? 'active' : 'neutral', mode.label)
    ), h('p', { class: 'agent-summary', 'data-testid': 'agent-summary' }, mode.summary));
    if (agent.status) host.append(badge(agent.status));
    if (agent.error || agent.lastError) host.append(detail('Agent status error', agent.error ?? agent.lastError, 'agent-status-error', true));
    if (jobs.length) host.append(h('p', { class: 'muted' }, `${active} running · ${jobs.length} generation jobs in the loaded history. Attempts, checks and failures are shown with their requests.`));
    host.append(detail('Reported agent configuration', agent, 'agent-status-configuration'));
  }
  function renderGenerationJob(job) {
    const key = `generation:${job.id}`, cancelKey = `generation-cancel:${job.id}`;
    const proposal = ui.state.proposals?.find(item => item.id === job.proposalId);
    if (job.status !== 'running') ui.cancelRequested.delete(job.id);
    const cancellationRequested = ui.cancelRequested.has(job.id);
    const card = h('section', { class: 'generation-job', 'data-generation-id': job.id, 'data-generation-status': job.status, 'aria-label': `Generation ${job.id.slice(0, 8)}` },
      h('div', { class: 'meta-row' }, h('h3', {}, `Generation ${job.id.slice(0, 8)}`), badge(cancellationRequested && job.status === 'running' ? 'waiting' : job.status, generationLabel(job, cancellationRequested, proposal))),
      h('p', { class: 'generation-provider' }, providerLabel(job.provider)),
      facts([['Job ID', h('code', {}, job.id)], ['Attempts', `${job.attempts?.length ?? 0} / ${job.limits?.maxRounds ?? '—'}`], ['Time budget', job.limits?.maxDurationMs ? `${job.limits.maxDurationMs / 1000} seconds` : '—'], ['Application mode', job.limits?.autoApply === true ? 'Automatic apply' : job.limits?.autoApply === false ? 'Proposal review' : 'Not reported'], ['Updated', dateText(job.updatedAt)]]));
    if (job.error) card.append(h('p', { class: 'inline-message danger', role: 'status', 'data-testid': 'generation-error' }, `${job.error.code ?? 'GENERATION_ERROR'}: ${job.error.message ?? pretty(job.error)}`));
    if (ui.pendingErrors.has(cancelKey)) card.append(h('p', { class: 'inline-message danger', role: 'status' }, `Cancellation request failed: ${ui.pendingErrors.get(cancelKey).message}`));
    if (cancellationRequested) card.append(h('p', { class: 'inline-message warning' }, 'Cancellation requested. The provider has not yet recorded a final outcome.'));
    if (job.status === 'running') card.append(button(cancellationRequested ? 'Cancellation requested' : 'Cancel generation', async () => {
      try {
        await post(`/api/generation/${encodeURIComponent(job.id)}/cancel`);
        ui.cancelRequested.add(job.id); ui.pendingErrors.delete(cancelKey);
        announce(`Cancellation requested for generation ${job.id.slice(0, 8)}. Check its recorded final status.`);
      } catch (error) { ui.pendingErrors.set(cancelKey, error); showError(error); }
      await refresh({ manual: true });
    }, { class: 'button danger', 'data-focus': `cancel-generation:${job.id}`, disabled: ui.mutating || cancellationRequested || !ui.state.agent?.automaticBackgroundGeneration }));
    if (['failed', 'cancelled', 'interrupted'].includes(job.status)) card.append(h('p', { class: 'muted' }, 'This generation did not finish successfully. It will not silently retry. Inspect its receipts before submitting another request.'));
    if (job.qualification) card.append(h('p', { class: 'generation-qualification' }, job.qualification));
    if (job.deploymentQualified === true) card.append(h('p', { class: 'inline-message' }, 'The host evaluator reported a pass within its stated envelope. Inspect the assessment; broader task or deployment qualification is not implied.'));
    else card.append(h('p', { class: 'muted' }, 'Independent task qualification is not established by generating or applying this workflow.'));
    for (const attempt of job.attempts ?? []) card.append(detail(`Round ${attempt.round} · ${statusLabel(attempt.status)}`, attempt, `${key}:attempt:${attempt.round}`, Boolean(attempt.error) || attempt.status === 'rejected-candidate'));
    card.append(detail('Complete generation receipt', job, `${key}:receipt`));
    return card;
  }
  function renderChanges() {
    if (!ui.state) return;
    renderAgentStatus();
    const host = $('request-list'), requests = ui.state.requests ?? [];
    const automatic = agentPresentation(ui.state.agent).automatic, jobs = ui.state.generationJobs ?? [];
    host.replaceChildren();
    if (!requests.length) host.append(empty('No requests yet', `Describe a new workflow or a change to an existing one. ${automatic ? 'The configured provider' : 'The host agent'} will receive its task and version-bound context.`, button('Write a request', () => beginRequest(!ui.record), { class: 'button primary' })));
    for (const request of requests) {
      const diagnostic = isDiagnostic(request);
      const proposals = (ui.state.proposals ?? []).filter(proposal => proposal.requestId === request.id);
      const stale = request.baseHash && headFor(request.workflowId)?.hash !== request.baseHash && request.status !== 'applied';
      const card = h('article', { class: 'request-card', 'data-request-id': request.id },
        h('div', { class: 'meta-row' }, badge(request.status, diagnostic && request.status === 'diagnostic' ? (request.source === 'agent-diagnostic' ? 'Diagnostic repair' : 'Agent design request') : request.status === 'pending' && !diagnostic ? (automatic ? 'Queued · automatic provider' : 'Pending · host agent needed') : statusLabel(request.status)), h('time', { datetime: new Date(request.createdAt).toISOString() }, dateText(request.createdAt))),
        h('p', { class: 'request-text' }, request.text),
        h('p', { class: 'muted' }, request.workflowId ? `Revision of ${request.workflowId} · base ${shortHash(request.baseHash)}` : 'New workflow design'),
        h('code', { class: 'hash-line' }, request.id)
      );
      if (diagnostic) {
        card.append(h('p', { class: 'inline-message', 'data-testid': 'diagnostic-provenance' }, `${request.source === 'agent-diagnostic' ? 'Agent diagnostic repair; original requirements preserved.' : 'Task relayed or composed by the host agent.'} Automatic generation is off. This record does not grant user consent or execution authority.`),
          facts([['Source', request.source], ...(request.parentRequestId ? [['Parent request', h('code', {}, request.parentRequestId)], ['Root request', h('code', {}, request.rootRequestId)], ['Failed run', h('code', {}, request.failedRunId)], ['Applied proposal', h('code', {}, request.appliedProposalId)], ['Repair depth', request.repairDepth]] : [])]),
          detail('Diagnostic provenance and preserved requirements', { source: request.source, automaticGeneration: request.automaticGeneration, provenance: request.provenance, goal: request.goal, successCriteria: request.successCriteria, failure: request.failure, failureEventHead: request.failureEventHead, diagnostic: request.diagnostic, diagnosticAuthority: request.diagnosticAuthority }, `diagnostic:${request.id}`));
      }
      if (stale) card.append(h('p', { class: 'inline-message warning' }, 'The workflow head has changed since this request. A proposal against this base may conflict.'));
      if (request.error) card.append(detail('Agent request error', request.error, `request-error:${request.id}`, true));
      if (request.status === 'pending' && !diagnostic) card.append(h('p', { class: 'muted' }, automatic ? 'Queued for the configured provider. Generation has not started yet.' : 'Give this request ID to your host agent. It can read foundry_design_context and submit foundry_propose through MCP.'));
      const matchingJobs = jobs.filter(job => job.requestId === request.id);
      for (const job of matchingJobs) card.append(renderGenerationJob(job));
      if (request.generationJobId && !matchingJobs.length) card.append(h('p', { class: 'inline-message warning' }, 'This request has a generation job outside the loaded history.'), button('Load generation receipt', async () => {
        const job = await api(`/api/generation/${encodeURIComponent(request.generationJobId)}`);
        ui.state.generationJobs = [...(ui.state.generationJobs ?? []).filter(item => item.id !== job.id), job];
        preservingFocus(renderChanges);
      }, { 'data-focus': `load-generation:${request.generationJobId}` }));
      const context = ui.contexts.get(request.id);
      card.append(button(context ? 'Refresh host context' : 'Load host-agent context', () => showRequestContext(request.id), { 'data-focus': `context-load:${request.id}` }));
      if (context) card.append(detail('Context for the actual host agent', context, `context:${request.id}`, true));
      for (const trial of ui.state.trials ?? []) if (trial.requestId === request.id) card.append(button(`Inspect draft trial ${trial.id.slice(0, 8)} · ${statusLabel(trial.runStatus ?? trial.status)}`, () => selectTrial(trial.id), { 'data-focus': `request-trial:${trial.id}` }));
      for (const proposal of proposals) card.append(h('div', { class: 'proposal-option' },
        h('div', { class: 'meta-row' }, badge(proposalConflict(proposal) ? 'conflict' : proposal.status), h('code', {}, `v${proposal.workflow.version} · ${shortHash(proposal.workflowHash)}`)),
        h('p', {}, proposal.rationale),
        button('Review proposal', () => openProposal(proposal.id), { 'data-focus': `review:${proposal.id}`, 'aria-pressed': String(ui.proposalId === proposal.id) })
      ));
      host.append(card);
    }
    const orphanJobs = jobs.filter(job => !requests.some(request => request.id === job.requestId));
    if (orphanJobs.length) host.append(h('h3', {}, 'Generation jobs with older requests'), ...orphanJobs.map(renderGenerationJob));
    for (const [id, context] of ui.contexts) if (!requests.some(request => request.id === id)) host.append(h('article', { class: 'request-card', 'data-request-id': id },
      h('h3', {}, 'Inspected host context'), h('code', {}, id), h('p', { class: 'muted' }, 'This request is outside the loaded history. Its actual context is shown; no request status is inferred.'), detail('Context for the actual host agent', context, `context:${id}`, true)));
    renderProposalReview();
  }
  function renderProposalReview() {
    const host = $('proposal-review'), proposal = ui.state?.proposals?.find(item => item.id === ui.proposalId);
    host.replaceChildren();
    if (!proposal) { host.append(h('span', { class: 'eyebrow' }, 'INSPECT THE CHANGE'), h('h2', {}, 'A deliberate change, with a visible diff.'), h('p', { class: 'muted' }, 'Select a proposal to inspect its rationale, node changes, acceptance criteria and full source. A stale base is shown as a conflict. Automatically applied proposals remain inspectable.')); return; }
    const base = proposal.baseHash ? ui.records.get(proposal.baseHash)?.workflow : undefined;
    const conflict = proposalConflict(proposal);
    host.append(h('span', { class: 'eyebrow' }, 'PROPOSAL REVIEW'), h('h2', {}, proposal.workflow.title), badge(conflict ? 'conflict' : proposal.status));
    host.append(facts([['Version', `${base ? `v${base.version}` : 'New'} → v${proposal.workflow.version}`], ['Base hash', h('code', {}, proposal.baseHash ?? 'New workflow')], ['Candidate hash', h('code', {}, proposal.workflowHash)], ['Current head', h('code', {}, headFor(proposal.workflow.id)?.hash ?? 'No workflow saved yet')]]));
    host.append(h('h3', {}, 'Rationale'), h('p', { class: 'rationale' }, proposal.rationale));
    const impact = proposal.impact ?? {};
    host.append(h('div', { class: 'impact-list' }, badge('good', `${impact.added?.length ?? 0} added`), badge('active', `${impact.changed?.length ?? 0} changed`), badge('bad', `${impact.removed?.length ?? 0} removed`), ...(impact.acceptanceChanged ? [badge('waiting', 'Success checks changed')] : []), ...(impact.budgetChanged ? [badge('waiting', 'Budget changed')] : [])));
    if (conflict) host.append(h('p', { class: 'inline-message danger', role: 'status' }, 'Version conflict: this proposal no longer matches the current workflow head. It cannot be applied. Request a new proposal from the current version.'));
    else if (proposal.status === 'proposed') host.append(button('Apply this revision', async () => {
      try {
        const saved = await post(`/api/proposals/${encodeURIComponent(proposal.id)}/apply`);
        ui.records.set(saved.hash, saved);
        announce(`Applied ${saved.workflow.id} v${saved.workflow.version}. Existing runs remain pinned to their original workflow hashes.`);
        await refresh({ manual: true });
      } catch (error) { await refresh({ manual: true }); throw error; }
    }, { class: 'button primary', 'data-focus': `apply:${proposal.id}`, disabled: ui.mutating }));
    if (proposal.status === 'applied') host.append(h('p', { class: 'inline-message' }, `Applied ${dateText(proposal.appliedAt)}. Existing runs retain their original workflow version.`));
    host.append(detail('Validation receipt', proposal.validation, `validation:${proposal.id}`), detail('Node impact', impact, `impact:${proposal.id}`));
    if (proposal.baseHash && !base) {
      host.append(h('p', { class: 'inline-message warning' }, 'The base source has not been loaded. Load it before reviewing the diff.'), button('Load base source', () => openProposal(proposal.id)));
      return;
    }
    const diff = diffValues(base, proposal.workflow);
    host.append(h('h3', { class: 'inspector-subhead' }, 'Source changes'));
    const changes = h('div', { class: 'diff-list' });
    for (const change of diff.changes) changes.append(h('section', { class: 'diff-item' }, h('div', { class: 'diff-heading' }, badge(change.kind === 'removed' ? 'bad' : change.kind === 'added' ? 'good' : 'active', change.kind), h('code', {}, change.path)), ...(change.before !== undefined ? [h('pre', { class: 'diff-before', 'aria-label': `Before ${change.path}` }, pretty(change.before))] : []), ...(change.after !== undefined ? [h('pre', { class: 'diff-after', 'aria-label': `After ${change.path}` }, pretty(change.after))] : [])));
    host.append(changes);
    if (!diff.changes.length) host.append(h('p', { class: 'muted' }, 'No source differences.'));
    if (diff.truncated) host.append(h('p', { class: 'inline-message warning' }, 'Showing the first 250 differences. Complete before/after JSON is available below.'));
    if (base) host.append(detail('Complete source before', base, `proposal-before:${proposal.id}`));
    host.append(detail('Complete source after', proposal.workflow, `proposal-after:${proposal.id}`));
  }

  function renderEvidence() {
    const host = $('evidence-content'), run = ui.run;
    host.replaceChildren();
    if (ui.trial) {
      const trial = ui.trial;
      host.append(h('h2', {}, 'Isolated trial evidence'), facts([['Trial ID', h('code', {}, trial.id)], ['Exact draft hash', h('code', {}, trial.workflowHash)], ['Request ID', h('code', {}, trial.requestId)]]),
        h('p', { class: 'inline-message' }, 'Independent task unqualified. This receipt describes an isolated draft and its local acceptance.'),
        detail('Trial receipt', trial, `trial-receipt:${trial.id}`), detail('Artifact receipts returned by trial inspection', trial.artifactReceipts ?? [], `trial-artifacts:${trial.id}`, true));
      if (ui.trialError) host.append(h('p', { class: 'inline-message danger' }, `Last inspected snapshot; refresh failed: ${ui.trialError.message}`));
      if (!run) {
        host.append(h('p', { class: 'inline-message' }, trial.runStatus === 'input-rejected' ? 'Input rejected before execution. No run or node outputs were created.' : 'No run is available in this trial receipt.'), detail('Trial error', trial.error, `evidence-trial-error:${trial.id}`, Boolean(trial.error)));
        return;
      }
    }
    if (!run) { host.append(empty('Select a run to inspect its evidence', 'The run ledger records inputs, exact workflow and registry hashes, root and nested node states, outputs and events. Select a run from the sidebar.')); return; }
    host.append(h('div', { class: 'section-heading' }, h('div', {}, h('span', { class: 'eyebrow' }, 'RECORDED EXECUTION'), h('h2', {}, `Run ${run.id.slice(0, 8)}`), h('p', { class: 'muted' }, `Created ${dateText(run.createdAt)} · Updated ${dateText(run.updatedAt)}`)), badge(run.status)));
    host.append(facts([['Run ID', h('code', {}, run.id)], ['Workflow', `${run.workflowId} v${ui.record.workflow.version}`], ['Pinned workflow hash', h('code', {}, run.workflowHash)], ['Registry hash', h('code', {}, run.registryHash)]]));
    host.append(h('p', { class: 'inline-message' }, run.status === 'succeeded' ? 'Runtime acceptance passed for this pinned program. Independent task verification is not established by this run.' : 'This is the recorded runtime state. A paused, failed, cancelled or uncertain run is not a successful task result.'));
    if (!ui.trial) host.append(renderRunLinkage(run));
    host.append(h('div', { class: 'metrics' }, ...[['Steps charged', run.steps], ['Reserved cost', run.cost], ['Nested frames', Object.keys(run.frames ?? {}).length], ['Events', run.events?.length ?? 0]].map(([name, value]) => h('div', { class: 'metric' }, h('span', {}, name), h('strong', {}, String(value ?? 0))))));
    host.append(h('div', { class: 'evidence-grid' }, h('section', {}, detail('Run inputs', run.input, `evidence-input:${run.id}`, true), detail('Run error', run.error, `evidence-error:${run.id}`, Boolean(run.error))), h('section', {}, detail('Root outputs', run.outputs, `evidence-output:${run.id}`, true), detail('Nested frames & outputs', run.frames, `evidence-frames:${run.id}`))));
    const table = h('table', { class: 'state-table' }, h('caption', { class: 'sr-only' }, 'Recorded root and nested node states'), h('thead', {}, h('tr', {}, ...['Node path', 'Status', 'Attempts', 'Output'].map(label => h('th', { scope: 'col' }, label)))));
    const body = h('tbody');
    for (const [frameKey, frame] of [['root', run], ...Object.entries(run.frames ?? {})]) for (const [id, state] of Object.entries(frame.nodes ?? {})) body.append(h('tr', {}, h('td', {}, button(`${frameKey}/${id}`, () => inspectNodeKey(`${frameKey}/${id}`), { class: 'text-button', 'data-focus': `evidence-node:${frameKey}/${id}` })), h('td', {}, badge(state.status)), h('td', {}, state.attempts ?? 0), h('td', {}, Object.hasOwn(frame.outputs ?? {}, id) ? 'Recorded' : 'None')));
    table.append(body); host.append(h('h3', {}, 'Node states'), h('div', { class: 'table-scroll' }, table));
    const search = h('input', { id: 'event-search', type: 'search', value: ui.eventQuery, placeholder: 'Filter by event type, node path or sequence…', 'data-focus': 'event-search' });
    search.addEventListener('input', () => { ui.eventQuery = search.value; preservingFocus(renderEvidence); });
    host.append(h('h3', { class: 'inspector-subhead' }, 'Event ledger'), h('label', { for: 'event-search' }, 'Find an event'), search);
    const query = ui.eventQuery.toLowerCase();
    const all = (run.events ?? []).filter(event => `${event.seq} ${event.type} ${event.nodeKey ?? event.frameKey ?? ''}`.toLowerCase().includes(query)).toReversed();
    host.append(h('p', { class: 'hash-line' }, `Showing ${Math.min(all.length, ui.eventLimit)} of ${all.length} matching events · newest first`));
    const list = h('div', { class: 'event-list' });
    for (const event of all.slice(0, ui.eventLimit)) {
      const key = `event:${run.id}:${event.seq}`;
      list.append(h('details', { class: 'event', 'data-detail': key, open: ui.details.get(key) ?? false }, h('summary', { 'data-focus': key }, h('span', { class: 'event-seq' }, `#${event.seq}`), h('strong', {}, event.type), h('code', {}, event.nodeKey ?? event.frameKey ?? ''), h('time', { datetime: new Date(event.at).toISOString() }, dateText(event.at))), h('pre', { tabindex: '0' }, pretty(event))));
    }
    if (!all.length) list.append(h('p', { class: 'muted' }, 'No matching events.'));
    host.append(list);
    if (all.length > ui.eventLimit) host.append(button('Show 100 more events', () => { ui.eventLimit += 100; preservingFocus(renderEvidence); }, { 'data-focus': 'more-events' }));
  }
  function renderCatalog() {
    const host = $('catalog-content'); host.replaceChildren();
    if (!ui.state) return;
    host.append(h('div', { class: 'section-heading' }, h('div', {}, h('span', { class: 'eyebrow' }, 'AVAILABLE TO THE HOST AGENT'), h('h2', {}, 'Capabilities'), h('p', { class: 'muted' }, 'Registered tool contracts define schemas, effects and approval requirements. A generated workflow cannot change those permissions.'))));
    const catalog = h('div', { class: 'catalog-grid' });
    for (const capability of ui.state.capabilities ?? []) catalog.append(h('article', { class: 'catalog-card' }, h('h3', {}, capability.name), h('p', {}, capability.description), h('div', { class: 'meta-row' }, badge(capability.risk === 'high' ? 'waiting' : 'neutral', `${capability.risk} risk`), badge('neutral', `Effects: ${capability.effects}`), ...(capability.requiresApproval ? [badge('waiting', 'Approval required')] : [])), detail('Input schema', capability.inputSchema, `catalog-input:${capability.name}`), detail('Output schema', capability.outputSchema, `catalog-output:${capability.name}`), detail('Complete capability receipt', capability, `catalog-receipt:${capability.name}`)));
    host.append(catalog);
    host.append(h('div', { class: 'section-heading catalog-section' }, h('div', {}, h('span', { class: 'eyebrow' }, 'PORTABLE DESIGN EXPERTISE'), h('h2', {}, 'Installed skills'), h('p', { class: 'muted' }, 'The host agent loads these skills as needed. Their hashes identify the installed content.'))));
    const skills = h('div', { class: 'catalog-grid' });
    for (const skill of ui.state.skills ?? []) skills.append(h('article', { class: 'catalog-card' }, h('h3', {}, skill.name), h('p', {}, skill.description), h('code', { class: 'skill-hash' }, `SHA-256 ${skill.sha256}`), h('p', { class: 'muted' }, `${skill.bytes.toLocaleString()} bytes`)));
    if (!skills.childElementCount) skills.append(empty('No installed skills reported', 'The host has not reported any installed skill metadata.'));
    host.append(skills, detail('Host agent configuration', ui.state.agent, 'agent-configuration'));
  }

  function parseJSONInput(value, label) {
    try { return JSON.parse(value); } catch (error) { throw new Error(`${label} is not valid JSON: ${error.message}`); }
  }
  function openRunDialog() {
    if (!ui.record || ui.trial) return;
    ui.runDraft = ui.record; // Freeze what the user sees while the dialog is open.
    $('run-pin').textContent = `${ui.record.workflow.title} · v${ui.record.workflow.version}\nPinned workflow hash: ${ui.record.hash}`;
    $('run-input').value = pretty(ui.run?.input ?? {});
    $('run-form-error').replaceChildren();
    $('run-input-schema').replaceChildren(detail('Workflow input schema', ui.record.workflow.inputSchema ?? {}, `run-draft-schema:${ui.record.hash}`));
    $('run-dialog').showModal();
  }
  async function startRun(event) {
    event.preventDefault();
    const submit = $('run-form').querySelector('button[type="submit"]');
    await perform(async () => {
      try {
        const input = parseJSONInput($('run-input').value, 'Run input');
        if (!ui.runDraft || ui.trial) throw new Error('Choose a saved workflow version to run. Isolated trials are inspection only.');
        // Foundry.createRun resolves this field with Store.workflow(idOrHash).
        // Sending the immutable hash prevents a newer head racing the dialog.
        const run = await post('/api/runs', { workflowId: ui.runDraft.hash, input });
        $('run-dialog').close(); announce(`Run ${run.id.slice(0, 8)} started on ${shortHash(run.workflowHash)}.`);
        await selectRun(run.id); await refresh({ manual: true });
      } catch (error) { showError(error, $('run-form-error')); }
    }, submit);
  }
  async function importWorkflow(event) {
    event.preventDefault();
    await perform(async () => {
      try {
        const workflow = parseJSONInput($('import-json').value, 'Workflow');
        const saved = await post('/api/workflows', { workflow });
        ui.records.set(saved.hash, saved); $('import-dialog').close();
        announce(`Imported ${saved.workflow.title} v${saved.workflow.version}.`);
        await refresh({ manual: true }); await selectWorkflow(saved);
      } catch (error) { showError(error, $('import-result')); }
    }, $('import-form').querySelector('button[type="submit"]'));
  }
  function setZoom(value) {
    ui.zoom = Math.max(.4, Math.min(2, Math.round(value * 100) / 100));
    const graphic = $('graph').querySelector('svg');
    if (graphic && ui.graphLayout) {
      graphic.setAttribute('width', String(Math.round(ui.graphLayout.width * ui.zoom)));
      graphic.setAttribute('height', String(Math.round(ui.graphLayout.height * ui.zoom)));
    }
    $('zoom-label').value = `${Math.round(ui.zoom * 100)}%`;
  }
  function theme(name) {
    document.documentElement.dataset.theme = name;
    $('theme-toggle').textContent = name === 'dark' ? 'Light theme' : 'Dark theme';
    $('theme-toggle').setAttribute('aria-label', `Switch to ${name === 'dark' ? 'light' : 'dark'} theme`);
    try { localStorage.setItem('foundry-theme', name); } catch { /* Storage may be unavailable in private contexts. */ }
  }
  let savedTheme;
  try { savedTheme = localStorage.getItem('foundry-theme'); } catch { /* Theme is an optional preference. */ }
  theme(['dark', 'light'].includes(savedTheme) ? savedTheme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  $('theme-toggle').addEventListener('click', () => theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  $('refresh').addEventListener('click', () => refresh({ manual: true }));
  $('workflow-search').addEventListener('input', () => { if (ui.state) preservingFocus(renderSidebar); });
  $('trial-lookup').addEventListener('submit', event => {
    event.preventDefault();
    perform(async () => {
      const id = $('trial-id').value.trim();
      if (!id) throw new Error('Enter the opaque trial ID returned by the host.');
      await selectTrial(id);
    }, $('inspect-trial'));
  });
  $('new-workflow').addEventListener('click', () => beginRequest(true));
  $('compose-request').addEventListener('click', () => beginRequest(!ui.record));
  $('view-head').addEventListener('click', () => perform(() => selectWorkflow(headFor(ui.record.workflow.id))));
  $('open-run').addEventListener('click', openRunDialog);
  $('run-form').addEventListener('submit', startRun);
  $('inspect-workflow').addEventListener('click', () => { ui.nodeId = null; renderGraph(); renderInspector(); });
  $('request-form').addEventListener('submit', submitRequest);
  $('request-text').addEventListener('input', () => {
    if (!$('request-text').value.trim()) ui.requestBase = null;
    else if (!ui.requestBase && $('request-scope').value === 'selected') ui.requestBase = ui.record;
    renderRequestHint();
  });
  $('request-scope').addEventListener('change', () => { ui.requestBase = $('request-scope').value === 'selected' && $('request-text').value.trim() ? ui.record : null; renderRequestHint(); });
  $('rebind-request').addEventListener('click', () => { ui.requestBase = ui.record; renderRequestHint(); });
  $('open-import').addEventListener('click', () => { $('import-result').replaceChildren(); $('import-dialog').showModal(); });
  $('import-form').addEventListener('submit', importWorkflow);
  $('import-file').addEventListener('change', () => perform(async () => {
    const file = $('import-file').files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) throw new Error('The workflow file exceeds the 2 MiB request limit.');
    $('import-json').value = await file.text(); $('import-result').replaceChildren();
  }));
  $('validate-import').addEventListener('click', event => perform(async () => {
    try {
      const validation = await post('/api/validate', { workflow: parseJSONInput($('import-json').value, 'Workflow') });
      $('import-result').className = 'inline-message';
      $('import-result').replaceChildren(badge(validation.valid ? 'good' : 'bad', validation.valid ? 'Valid workflow contract' : 'Validation failed'), detail('Validation result', validation, 'import-validation', !validation.valid));
    } catch (error) { showError(error, $('import-result')); }
  }, event.currentTarget));
  document.querySelectorAll('[data-close-dialog]').forEach(control => control.addEventListener('click', () => $(control.dataset.closeDialog).close()));
  document.querySelectorAll('[data-tab]').forEach(control => {
    control.addEventListener('click', () => setTab(control.dataset.tab));
    control.addEventListener('keydown', event => {
      const tabs = ['canvas', 'changes', 'evidence', 'catalog'], index = tabs.indexOf(ui.tab);
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 4) % 4;
      setTab(tabs[next], true);
    });
  });
  document.addEventListener('input', event => { if (event.target.dataset?.draft) ui.drafts.set(event.target.dataset.draft, event.target.value); });
  document.addEventListener('change', event => { if (event.target.dataset?.draft) ui.drafts.set(event.target.dataset.draft, event.target.value); });
  document.addEventListener('toggle', event => { if (event.target.isConnected && event.target.dataset?.detail) ui.details.set(event.target.dataset.detail, event.target.open); }, true);
  $('zoom-in').addEventListener('click', () => setZoom(ui.zoom + .1));
  $('zoom-out').addEventListener('click', () => setZoom(ui.zoom - .1));
  $('zoom-fit').addEventListener('click', () => { if (ui.graphLayout) { setZoom(($('graph-viewport').clientWidth - 8) / ui.graphLayout.width); $('graph-viewport').scrollTo(0, 0); } });
  let drag;
  const viewport = $('graph-viewport');
  viewport.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.pointerType !== 'mouse' || event.target.closest('.graph-node')) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) < 4) return;
    viewport.classList.add('dragging');
    viewport.scrollLeft = drag.left - (event.clientX - drag.x); viewport.scrollTop = drag.top - (event.clientY - drag.y);
  });
  const stopDrag = () => { if (drag && viewport.hasPointerCapture(drag.id)) viewport.releasePointerCapture(drag.id); drag = null; viewport.classList.remove('dragging'); };
  viewport.addEventListener('pointerup', stopDrag); viewport.addEventListener('pointercancel', stopDrag);
  async function poll() {
    if (!document.hidden && !ui.mutating) await refresh();
    ui.timer = setTimeout(poll, 3000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('pagehide', () => clearTimeout(ui.timer));
  window.addEventListener('pageshow', event => { if (event.persisted) { clearTimeout(ui.timer); poll(); } });
  poll();
}

if (typeof document !== 'undefined') startFoundryUI();
