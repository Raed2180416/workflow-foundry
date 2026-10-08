// Run view: a read-only inspector for one Foundry run (simplified node graph, state dots, live lines, transcripts).
// One classic script, no dependencies, no network except same-origin fetch of a run JSON. Two parts:
//   CORE  pure functions and the event reducer (RunModel). No DOM. Importable by node tests: globalThis.RunViewCore.
//   UI    rendering, replay controls, the transcript drawer. Starts only when a document exists.
// Replay and a live stream use the same reducer: replay applies recorded events in order, a stream would apply them as
// they arrive. All run data is rendered as text (textContent); this file never uses innerHTML, inline styles or eval.
(function (root) {
'use strict';

// ======================================================================================================== CORE: helpers
const shortModel = id => String(id ?? '').replace(/^claude-/, '');
const clip = (text, max) => { const s = String(text ?? ''); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };
const fmtCost = n => n == null || !Number.isFinite(n) ? '–' : n === 0 ? '$0' : n < 0.001 ? `$${n.toFixed(5)}` : n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
function fmtDur(ms) {
  if (!Number.isFinite(ms)) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} m ${String(s % 60).padStart(2, '0')} s`;
}
const fmtClock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const humanize = id => { const s = String(id).replace(/[_-]+/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : String(id); };
const genericId = id => /^(n|t|s|step|node|task|item)?[-_]?\d+$/i.test(id) || id.length < 3;

// Text that came from a run is data. Control, bidi and zero-width characters are made visible so they cannot spoof the page.
// (Code points are listed as numbers so this source file holds no invisible characters.)
const INVISIBLE_RANGES = [[0, 8], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x61c, 0x61c], [0x180e, 0x180e], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff], [0xfff9, 0xfffb]];
const hex4 = n => n.toString(16).toUpperCase().padStart(4, '0');
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.map(([a, b]) => `\\u${hex4(a)}${a === b ? '' : `-\\u${hex4(b)}`}`).join('')}]`, 'g');
const LONE_SURROGATE = new RegExp('[\\ud800-\\udbff](?![\\udc00-\\udfff])|(?<![\\ud800-\\udbff])[\\udc00-\\udfff]', 'g');
function sanitizeDisplay(text) {
  let replaced = 0;
  const out = String(text ?? '').replace(INVISIBLE, ch => { replaced++; return `⟦U+${hex4(ch.charCodeAt(0))}⟧`; })
    .replace(LONE_SURROGATE, () => { replaced++; return String.fromCharCode(0xfffd); });
  return { text: out, replaced };
}

// ======================================================================================================== CORE: states
// family drives colour, glyph drives shape (colour is never the only signal), label drives text.
const STATES = {
  idle:        { family: 'neutral', glyph: 'none',    label: 'Not started',                       anim: 'none' },
  queued:      { family: 'blue',    glyph: 'ring',    label: 'Queued',                            anim: 'slow' },
  calling:     { family: 'blue',    glyph: 'dots',    label: 'Waiting for the model',             anim: 'breathe' },
  running:     { family: 'blue',    glyph: 'solid',   label: 'Running',                           anim: 'breathe' },
  retrying:    { family: 'amber',   glyph: 'retry',   label: 'Retrying',                          anim: 'fast' },
  checkfailed: { family: 'amber',   glyph: 'bang',    label: 'Check failed',                      anim: 'fast' },
  escalated:   { family: 'violet',  glyph: 'up',      label: 'Escalated to a larger model',       anim: 'breathe' },
  waiting:     { family: 'slate',   glyph: 'clock',   label: 'Waiting',                           anim: 'slow' },
  needsyou:    { family: 'pink',    glyph: 'ask',     label: 'Needs you',                         anim: 'attention' },
  done:        { family: 'green',   glyph: 'check',   label: 'Done',                              anim: 'none' },
  handled:     { family: 'amber',   glyph: 'check',   label: 'Done, with handled errors',         anim: 'none' },
  failed:      { family: 'red',     glyph: 'cross',   label: 'Failed',                            anim: 'none' },
  envfault:    { family: 'red',     glyph: 'plug',    label: 'Environment fault (not the model)', anim: 'none' },
  uncertain:   { family: 'red',     glyph: 'tilde',   label: 'Effect uncertain',                  anim: 'none' },
  skipped:     { family: 'neutral', glyph: 'dash',    label: 'Skipped',                           anim: 'none' },
  cancelled:   { family: 'neutral', glyph: 'slash',   label: 'Cancelled',                         anim: 'none' }
};
// Highest first. Used to choose the one state a group shows; "attention" states win over calm ones.
const PRIORITY = ['needsyou', 'uncertain', 'failed', 'envfault', 'escalated', 'checkfailed', 'retrying', 'calling', 'queued', 'running', 'waiting', 'handled', 'done', 'skipped', 'cancelled', 'idle'];
const ACTIVE = new Set(['needsyou', 'escalated', 'checkfailed', 'retrying', 'calling', 'queued', 'running', 'waiting']);
const ACTIVE_ORDER = ['needsyou', 'uncertain', 'failed', 'envfault', 'escalated', 'checkfailed', 'retrying', 'calling', 'queued', 'running', 'waiting'];

// Mirrors the runtime's own sets (src/runtime.mjs environmentFaults, providerFaults, unhandled).
const ENV_CODES = new Set(['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT', 'SANDBOX_UNAVAILABLE', 'MODEL_PROTOCOL', 'MODEL_BUDGET']);
const BUDGET_CODES = new Set(['COST_BUDGET', 'STEP_BUDGET', 'DEADLINE', 'STATE_BUDGET']);
const INTEGRITY_CODES = new Set(['STALE_RUNNER', 'REPLAY_MISS', 'FRAME_DRIFT', 'CORRUPT_EVENTS', 'MODEL_POLICY_DRIFT', 'ENGINE_DRIFT', 'CAPABILITY_DRIFT']);
function classifyError(code) {
  if (ENV_CODES.has(code)) return 'environment';
  if (code === 'CANCELLED' || code === 'ABORT_ERR') return 'cancelled';
  if (BUDGET_CODES.has(code)) return 'budget';
  if (INTEGRITY_CODES.has(code)) return 'integrity';
  if (['LABEL_POLICY', 'CAPABILITY_DENIED', 'ASSIGNMENT_INVALID', 'VERIFY_INDEPENDENCE', 'MODEL_PORT_REQUIRED'].includes(code)) return 'policy';
  if (['NODE_CHECK_FAILED', 'VERIFY_FAILED', 'ASSERTION_FAILED', 'ACCEPTANCE_FAILED'].includes(code)) return 'check';
  if (code === 'MODEL_ESCALATION_EXHAUSTED') return 'exhausted';
  return 'other';
}
function failState(error) {
  const kind = classifyError(error?.code);
  return kind === 'environment' ? 'envfault' : kind === 'cancelled' ? 'cancelled' : 'failed';
}
function combineStates(states) {
  if (!states.length) return 'idle';
  const present = new Set(states);
  for (const s of ACTIVE_ORDER) if (present.has(s)) return s;
  const open = states.some(s => s === 'idle'), closed = states.some(s => s === 'done' || s === 'handled' || s === 'skipped' || s === 'cancelled');
  if (open && closed) return 'running';               // between steps of a group: some parts finished, the rest not yet started
  if (present.has('handled')) return 'handled';
  if (present.has('done')) return 'done';
  if (present.has('skipped')) return 'skipped';
  if (present.has('cancelled')) return 'cancelled';
  return 'idle';
}

// ======================================================================================================== CORE: node keys
// root/dates:2/judge -> [{id:'dates', idx:2}, {id:'judge', idx:null}]
function parseKey(nodeKey) {
  return String(nodeKey).split('/').slice(1).map(part => { const m = /^(.*?)(?::(\d+))?$/.exec(part); return { id: m[1], idx: m[2] === undefined ? null : Number(m[2]) }; });
}
const segText = s => s.id + (s.idx === null ? '' : `:${s.idx}`);
// Container node keys above a node, outermost first: the map/loop nodes whose frames hold it.
function containerKeys(segs) {
  const out = [];
  segs.forEach((s, i) => { if (s.idx !== null) out.push(['root', ...segs.slice(0, i).map(segText), s.id].join('/')); });
  return out;
}
function defOf(workflow, nodeKey) {
  let nodes = workflow?.nodes, def = null;
  for (const seg of parseKey(nodeKey)) { def = (nodes ?? []).find(n => n.id === seg.id) ?? null; if (!def) return null; nodes = def.body?.nodes; }
  return def;
}

// ======================================================================================================== CORE: the reducer
const newAgg = () => ({ calls: 0, costUsd: 0, escalations: 0, checkFails: 0, retries: 0, failedItems: 0, envFaults: 0, models: {} });
class RunModel {
  constructor(data) { this.data = data; this.workflow = data.workflow; this.reset(); }
  reset() {
    this.insts = new Map();
    this.items = new Map();
    this.run = { status: 'ready', cost: 0, steps: 0, calls: 0, escalations: 0, checkFails: 0, retries: 0, events: 0, verdict: null, firstAt: null, now: null, error: null };
    this.dirty = new Set();          // top-level node ids whose card must be redrawn
    this.dirtyKeys = new Set();      // node keys touched since the last render (for the open drawer)
  }
  inst(nodeKey) {
    let it = this.insts.get(nodeKey);
    if (it) return it;
    const segs = parseKey(nodeKey);
    it = { key: nodeKey, segs, top: segs[0]?.id ?? nodeKey, kind: null, status: 'pending', phase: null, state: 'idle', startedAt: null, endedAt: null, attempts: 0,
      modelId: null, modelClass: null, escalations: 0, escalatedFrom: null, retries: 0, checkFails: 0, costUsd: 0, calls: [], turns: [], error: null,
      note: null, noteAt: 0, compiledAt: null, callStartAt: null, receipt: null, outputHash: null, output: undefined, outputSeq: null, verifyFalse: false,
      tool: null, wakeAt: null, question: null, cont: null, itemKey: null, ancestors: [], agg: newAgg() };
    this.insts.set(nodeKey, it);
    const parent = nodeKey.slice(0, nodeKey.lastIndexOf('/'));
    if (segs.length > 1 && segs[segs.length - 1].idx === null) { it.itemKey = parent; this.items.get(parent)?.leaves.push(nodeKey); }
    it.ancestors = containerKeys(segs).filter(k => k !== nodeKey).map(k => this.inst(k));
    return it;
  }
  bump(inst, field, n = 1) { inst.agg[field] += n; for (const a of inst.ancestors) a.agg[field] += n; }
  bumpModel(inst, id) { if (!id) return; inst.agg.models[id] = (inst.agg.models[id] ?? 0) + 1; for (const a of inst.ancestors) a.agg.models[id] = (a.agg.models[id] ?? 0) + 1; }
  note(inst, text, at) { inst.note = text; inst.noteAt = at; for (const a of inst.ancestors) { a.note = `${humanize(inst.segs[inst.segs.length - 1].id)}: ${text}`; a.noteAt = at; } }
  touch(inst) { this.dirty.add(inst.top); this.dirtyKeys.add(inst.key); for (const a of inst.ancestors) this.dirtyKeys.add(a.key); }

  stateOfInst(inst) {
    switch (inst.status) {
      case 'completed': return inst.cont ? (inst.cont.failedItems > 0 ? 'handled' : 'done') : inst.verifyFalse ? 'checkfailed' : 'done';
      case 'handled_error': return 'handled';
      case 'failed': return failState(inst.error);
      case 'skipped': return 'skipped';
      case 'cancelled': return 'cancelled';
      case 'awaiting_human': case 'awaiting_approval': return 'needsyou';
      case 'uncertain': return 'uncertain';
      case 'waiting': return 'waiting';
      case 'waiting_child': case 'running': {
        if (inst.cont) { for (const s of ACTIVE_ORDER) if (inst.cont.itemCounts[s] > 0) return s; return inst.status === 'waiting_child' ? 'waiting' : 'running'; }
        if (inst.phase === 'retrying') return 'retrying';
        if (inst.phase === 'checkfailed') return 'checkfailed';
        if (inst.phase === 'escalated' || (inst.escalations > 0 && (inst.phase === 'queued' || inst.phase === 'calling'))) return 'escalated';
        if (inst.phase === 'queued') return 'queued';
        if (inst.phase === 'calling') return 'calling';
        return 'running';
      }
      default: return 'idle';
    }
  }
  stateOfItem(item) {
    if (item.result === 'failed') return 'failed';
    if (item.result === 'completed') return item.counts.handled > 0 ? 'handled' : 'done';
    for (const s of ACTIVE_ORDER) if (item.counts[s] > 0) return s;
    return item.counts.done > 0 || item.counts.handled > 0 ? 'running' : 'queued';
  }
  refresh(inst) {
    this.touch(inst);
    const next = this.stateOfInst(inst), old = inst.state;
    if (next === old) return;
    inst.state = next;
    const item = inst.itemKey ? this.items.get(inst.itemKey) : null;
    if (item) { if (old !== 'idle') item.counts[old]--; item.counts[next] = (item.counts[next] ?? 0) + 1; this.refreshItem(item); }
  }
  refreshItem(item) {
    const next = this.stateOfItem(item), old = item.state;
    this.dirtyKeys.add(item.key);
    if (next === old) return;
    item.state = next;
    const cont = item.cont;
    cont.itemCounts[old] = (cont.itemCounts[old] ?? 1) - 1; cont.itemCounts[next] = (cont.itemCounts[next] ?? 0) + 1;
    this.refresh(cont.inst);
  }

  apply(ev) {
    const run = this.run;
    run.events++; run.now = ev.at; run.firstAt ??= ev.at;
    const t = ev.type;
    if (t.startsWith('run.')) { this.applyRun(ev); return; }
    if (t === 'runner.acquired') return;
    if (t === 'frame.created') return this.frameCreated(ev);
    if (!ev.nodeKey) return;
    const inst = this.inst(ev.nodeKey);
    if (!ev.derived) inst.turns.push(ev); else inst.turns.push(ev);
    switch (t) {
      case 'node.started': case 'tool.intent': {
        inst.kind = ev.kind ?? inst.kind; inst.status = 'running'; inst.attempts++; inst.startedAt ??= ev.at; inst.phase = null;
        if (t === 'tool.intent') inst.tool = ev.tool ?? null;
        if (ev.wakeAt) inst.wakeAt = ev.wakeAt;
        if ((inst.kind === 'map' || inst.kind === 'loop') && !inst.cont) inst.cont = { inst, items: new Map(), itemCounts: {}, failedItems: 0, total: Number.isFinite(ev.count) ? ev.count : null };
        run.steps++; run.cost += ev.reservedCost ?? 0;
        break;
      }
      case 'context.compiled':
        inst.status = 'running'; inst.phase = 'queued'; inst.compiledAt = ev.at; inst.callStartAt = null; inst.modelId = ev.modelId; inst.modelClass = ev.modelClass;
        inst.receipt = ev.receipt; inst.escalations = Math.max(inst.escalations, ev.escalations ?? 0); break;
      case 'model.dispatched': inst.phase = 'calling'; inst.callStartAt = ev.at; break;
      case 'model.called': case 'node.recovered_from_journal': {
        const cost = ev.costUsd ?? 0;
        if (ev.journalId != null) inst.calls.push(ev.journalId);
        inst.costUsd += cost; run.cost += cost; run.calls++; this.bump(inst, 'calls'); this.bump(inst, 'costUsd', cost); this.bumpModel(inst, ev.modelId);
        inst.callStartAt ??= ev.at - (ev.latencyMs ?? 0);
        inst.phase = ev.ok ? 'checking' : 'errored';
        if (!ev.ok) this.note(inst, `Call failed: ${ev.errorCode}`, ev.at);
        break;
      }
      case 'model.cancelled': inst.costUsd += ev.costUsd ?? 0; run.cost += ev.costUsd ?? 0; this.bump(inst, 'costUsd', ev.costUsd ?? 0); break;
      case 'model.retry':
        inst.retries++; run.retries++; this.bump(inst, 'retries'); inst.phase = 'retrying';
        this.note(inst, `Retry ${ev.retry}: ${ev.errorCode}`, ev.at); break;
      case 'model.resampled':
        inst.checkFails++; run.checkFails++; this.bump(inst, 'checkFails'); inst.phase = 'checkfailed';
        this.note(inst, `Check failed, resampling (sample ${ev.sampleIndex})`, ev.at); break;
      case 'model.escalated':
        inst.escalations = ev.escalation ?? inst.escalations + 1; run.escalations++; this.bump(inst, 'escalations');
        if (ev.rule === 'E2') { inst.checkFails++; run.checkFails++; this.bump(inst, 'checkFails'); }
        inst.escalatedFrom ??= ev.fromModel; inst.modelId = ev.toModel; inst.modelClass = ev.toClass; inst.phase = 'escalated';
        this.note(inst, `${ev.rule === 'E2' ? 'Check failed' : ev.errorCode}, escalated ${shortModel(ev.fromModel)} to ${shortModel(ev.toModel)}`, ev.at); break;
      case 'node.completed':
        inst.status = 'completed'; inst.phase = null; inst.endedAt = ev.at; inst.outputHash = ev.outputHash ?? null; inst.outputSeq = ev.seq;
        if (ev.output !== undefined) inst.output = ev.output;
        if (ev.modelId) inst.modelId = ev.modelId;
        if (inst.kind === 'verify' && ev.output && ev.output.pass === false) inst.verifyFalse = true;
        if (inst.cont && Number.isFinite(ev.failedItems)) inst.cont.failedItems = Math.max(inst.cont.failedItems, ev.failedItems);
        break;
      case 'node.handled_error': inst.status = 'handled_error'; inst.phase = null; inst.endedAt = ev.at; inst.outputSeq = ev.seq; if (ev.output !== undefined) inst.output = ev.output; break;
      case 'node.failed':
        inst.status = 'failed'; inst.phase = null; inst.endedAt = ev.at; inst.error = ev.error ?? { code: 'ERROR', message: '' };
        if (classifyError(inst.error.code) === 'environment') this.bump(inst, 'envFaults');
        break;
      case 'node.skipped': inst.kind ??= ev.kind ?? null; inst.status = 'skipped'; inst.endedAt = ev.at; break;
      case 'node.waiting': inst.status = 'waiting'; inst.wakeAt = ev.wakeAt ?? inst.wakeAt; break;
      case 'node.waiting_child': inst.status = 'waiting_child'; break;
      case 'node.resumed': case 'node.recovered': inst.phase = null; break;
      case 'human.requested': inst.status = 'awaiting_human'; inst.question = ev.question ?? null; break;
      case 'human.answered': inst.status = 'completed'; inst.endedAt = ev.at; break;
      case 'approval.requested': inst.status = 'awaiting_approval'; inst.tool = ev.tool ?? inst.tool; break;
      case 'approval.decided':
        if (ev.approved) { inst.status = 'running'; inst.phase = null; } else { inst.status = 'failed'; inst.error = { code: 'APPROVAL_REJECTED', message: 'The user rejected the operation' }; inst.endedAt = ev.at; }
        break;
      case 'effect.uncertain': inst.status = 'uncertain'; inst.error = ev.error ?? null; break;
      case 'tool.failed': inst.phase = 'retrying'; this.note(inst, `Tool attempt failed: ${ev.error?.code ?? 'error'}`, ev.at); this.bump(inst, 'retries'); break;
      case 'oracle.dispatched': inst.phase = 'oracle'; inst.costUsd += ev.reservedCost ?? 0; run.cost += ev.reservedCost ?? 0; this.bump(inst, 'costUsd', ev.reservedCost ?? 0); inst.tool = ev.tool ?? inst.tool; break;
      case 'verify.failed': inst.verifyFalse = true; break;
      case 'map.item.completed': case 'map.item.failed': this.itemResult(ev, inst); return;
      default: break;
    }
    this.refresh(inst);
  }
  applyRun(ev) {
    const run = this.run, t = ev.type;
    if (t === 'run.created') { run.createdAt = ev.at; return; }
    if (t === 'run.verdict') { run.verdict = ev; return; }
    run.status = t === 'run.stopped' ? (ev.error?.code === 'CANCELLED' ? 'cancelled' : 'failed') : t.slice(4);
    run.error = ev.error ?? run.error;
    if (['succeeded', 'failed', 'cancelled'].includes(run.status)) {
      // A node still "running" when its run ended was stopped with it; it must not keep breathing.
      for (const inst of this.insts.values()) if (inst.status === 'running' || inst.status === 'waiting_child') { inst.status = 'cancelled'; inst.phase = null; this.refresh(inst); }
    }
  }
  frameCreated(ev) {
    const segs = parseKey(ev.frameKey), last = segs[segs.length - 1];
    if (!last || last.idx === null) return;
    const contKey = ['root', ...segs.slice(0, -1).map(segText), last.id].join('/');
    const cinst = this.inst(contKey);
    if (!cinst.cont) cinst.cont = { inst: cinst, items: new Map(), itemCounts: {}, failedItems: 0, total: null };
    const item = { key: ev.frameKey, idx: last.idx, cont: cinst.cont, counts: {}, state: 'queued', result: null, startedAt: ev.at, endedAt: null, error: null, leaves: [] };
    this.items.set(ev.frameKey, item); cinst.cont.items.set(ev.frameKey, item);
    cinst.cont.itemCounts.queued = (cinst.cont.itemCounts.queued ?? 0) + 1;
    this.refresh(cinst);
  }
  itemResult(ev, contInst) {
    const item = this.items.get(`${ev.nodeKey}:${ev.index}`);
    if (!item) return;
    item.result = ev.type === 'map.item.failed' ? 'failed' : 'completed'; item.endedAt = ev.at; item.error = ev.error ?? null;
    if (item.result === 'failed') { item.cont.failedItems++; this.bump(contInst, 'failedItems'); if (classifyError(ev.error?.code) === 'environment') this.bump(contInst, 'envFaults'); }
    this.refreshItem(item);
    this.touch(contInst);
  }
}

// ======================================================================================================== CORE: lines
// Live lines are templates over typed event fields (codes, ids, numbers, durations). Model-written text is never put here.
function instLine(inst, now) {
  const age = since => fmtDur(Math.max(0, now - (since ?? now)));
  const m = shortModel(inst.modelId);
  if (inst.note && now - inst.noteAt < 7000 && ['escalated', 'checkfailed', 'retrying'].includes(inst.state)) return inst.note;
  switch (inst.state) {
    case 'idle': return 'Not started';
    case 'queued': return inst.compiledAt ? `Context ready, waiting for a model slot (${age(inst.compiledAt)})` : 'Queued';
    case 'calling': return `Asking ${m} (${age(inst.callStartAt ?? inst.compiledAt)})`;
    case 'escalated': return inst.phase === 'queued' || inst.phase === 'calling' || inst.phase === 'escalated' ? `Escalated: asking ${m} (${age(inst.callStartAt ?? inst.compiledAt)})` : `Escalated to ${m}`;
    case 'running':
      if (inst.kind === 'code') return `Running code in the sandbox (${age(inst.startedAt)})`;
      if (inst.kind === 'task') return `Running tool ${inst.tool ?? ''} (${age(inst.startedAt)})`;
      if (inst.kind === 'verify') return inst.phase === 'oracle' ? `Running oracle ${inst.tool ?? ''} (${age(inst.startedAt)})` : `Verifying (${age(inst.startedAt)})`;
      if (inst.phase === 'checking') return 'Checking the reply against the node checks';
      return `Working (${age(inst.startedAt)})`;
    case 'retrying': return inst.note ?? 'Retrying';
    case 'checkfailed': return inst.kind === 'verify' ? 'Verifier reported problems (see details)' : (inst.note ?? 'Check failed');
    case 'waiting': return inst.status === 'waiting' && inst.wakeAt ? `Waiting until ${new Date(inst.wakeAt).toISOString().slice(11, 19)} UTC` : 'Waiting for child steps';
    case 'needsyou': return inst.status === 'awaiting_approval' ? `Needs your approval: ${inst.tool ?? 'an operation'}` : `Waiting for your answer: ${clip(inst.question, 70)}`;
    case 'done': case 'handled': {
      const dur = (inst.endedAt ?? now) - (inst.startedAt ?? inst.endedAt ?? now);
      if (inst.cont) return `Done: ${inst.cont.items.size} item${inst.cont.items.size === 1 ? '' : 's'}${inst.cont.failedItems ? `, ${inst.cont.failedItems} failed (collected)` : ''}`;
      return `Done in ${fmtDur(dur)}${inst.costUsd ? ` for ${fmtCost(inst.costUsd)}` : ''}${inst.escalations ? `, escalated ${inst.escalations}x` : ''}`;
    }
    case 'failed': return `Failed: ${inst.error?.code ?? 'error'}${classifyError(inst.error?.code) === 'budget' ? ' (budget stop)' : ''}`;
    case 'envfault': return `Environment fault: ${inst.error?.code ?? ''}. Not escalated`;
    case 'uncertain': return 'An effect may have happened; needs reconciliation';
    case 'skipped': return 'Skipped';
    case 'cancelled': return 'Stopped with the run';
    default: return '';
  }
}

// ======================================================================================================== CORE: semantic graph
const isDet = n => n.kind === 'code' || n.kind === 'assert';
const isContainer = n => n.kind === 'map' || n.kind === 'loop';
const isModelish = n => n.kind === 'agent' || (n.kind === 'verify' && n.method === 'agent') || isContainer(n);
const ROLE_ORDER = ['judge', 'check', 'map', 'loop', 'tool', 'human', 'wait', 'code', 'assert'];
const roleOf = n => n.kind === 'agent' ? 'judge' : n.kind === 'verify' ? 'check' : n.kind === 'task' ? 'tool' : n.kind;

// needs minus the edges implied by other paths (transitive reduction): what a reader needs to see.
function reduceNeeds(nodes) {
  const byId = new Map(nodes.map(n => [n.id, n])), anc = new Map();
  const visit = id => {
    if (anc.has(id)) return anc.get(id);
    anc.set(id, new Set());
    const s = new Set();
    for (const d of byId.get(id)?.needs ?? []) { if (!byId.has(d)) continue; s.add(d); for (const x of visit(d)) s.add(x); }
    anc.set(id, s); return s;
  };
  nodes.forEach(n => visit(n.id));
  const reduced = new Map();
  for (const n of nodes) { const deps = (n.needs ?? []).filter(d => byId.has(d)); reduced.set(n.id, deps.filter(d => !deps.some(e => e !== d && anc.get(e).has(d)))); }
  return reduced;
}

// level 0 simple (fold chains, prep steps and wide fans), 1 normal (chains and prep steps), 2 raw (one node each).
// hints: optional authored view { labels: {nodeId: label}, groups: [{id, label, members: [nodeId...]}] } (a sidecar, not part of the workflow hash).
function buildSemantic(workflow, { level = 1, hints = null } = {}) {
  const nodes = workflow.nodes ?? [], order = new Map(nodes.map((n, i) => [n.id, i])), byId = new Map(nodes.map(n => [n.id, n]));
  const reduced = reduceNeeds(nodes);
  const group = new Map(nodes.map(n => [n.id, n.id]));            // node id -> group id
  const reasons = new Map();                                      // group id -> how it was formed
  const merge = (into, from, why) => { if (into === from) return; for (const [k, v] of group) if (v === from) group.set(k, into); reasons.set(into, why); };
  const membersOf = gid => nodes.filter(n => group.get(n.id) === gid);
  const groupEdges = () => {
    const pred = new Map(), succ = new Map();
    for (const n of nodes) { const g = group.get(n.id); if (!pred.has(g)) pred.set(g, new Set()); if (!succ.has(g)) succ.set(g, new Set()); }
    for (const n of nodes) for (const d of reduced.get(n.id)) { const a = group.get(d), b = group.get(n.id); if (a !== b) { pred.get(b).add(a); succ.get(a).add(b); } }
    return { pred, succ };
  };
  for (const g of hints?.groups ?? []) {
    const ms = (g.members ?? []).filter(id => byId.has(id));
    if (ms.length) { for (const id of ms.slice(1)) merge(group.get(ms[0]), group.get(id), 'authored'); reasons.set(group.get(ms[0]), 'authored'); }
  }
  if (level <= 1) {
    // R1: a chain of deterministic steps (code/assert) with one way in and one way out is one step.
    for (const n of nodes) {
      if (!isDet(n) || reduced.get(n.id).length !== 1) continue;
      const a = reduced.get(n.id)[0], an = byId.get(a);
      const succA = nodes.filter(x => reduced.get(x.id).includes(a));
      if (isDet(an) && succA.length === 1 && group.get(a) !== group.get(n.id) && reasons.get(group.get(a)) !== 'authored' && reasons.get(group.get(n.id)) !== 'authored') merge(group.get(a), group.get(n.id), 'chain');
    }
    // R2: a deterministic group that feeds exactly one model/container group is that group's preparation step.
    const { succ } = groupEdges();
    for (const [gid, outs] of succ) {
      const ms = membersOf(gid);
      if (!ms.length || !ms.every(isDet) || outs.size !== 1 || reasons.get(gid) === 'authored') continue;
      const target = [...outs][0], tms = membersOf(target);
      if (tms.some(isModelish) && !tms.every(isDet) && reasons.get(target) !== 'authored') merge(target, gid, 'prep');
    }
  }
  if (level === 0) {
    // R4: three or more parallel model/container steps with the same inputs and the same consumers are one wide fan.
    const { pred, succ } = groupEdges(), buckets = new Map();
    for (const gid of new Set(group.values())) {
      const ms = membersOf(gid);
      if (ms.length !== 1 || !isModelish(ms[0]) || reasons.has(gid)) continue;
      const key = `${[...pred.get(gid)].sort().join(',')}>${[...succ.get(gid)].sort().join(',')}`;
      if (!pred.get(gid).size || !succ.get(gid).size) continue;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(gid);
    }
    for (const gids of buckets.values()) if (gids.length >= 3) for (const g of gids.slice(1)) merge(gids[0], g, 'fan');
  }
  const { pred } = groupEdges();
  const out = [];
  for (const gid of [...new Set(group.values())].sort((a, b) => order.get(a) - order.get(b))) {
    const ms = membersOf(gid).sort((a, b) => order.get(a.id) - order.get(b.id)), why = reasons.get(gid) ?? 'single';
    const hint = (hints?.groups ?? []).find(g => (g.members ?? []).includes(ms[0].id));
    const authored = hints?.labels?.[ms[0].id];
    const labelOf = n => hints?.labels?.[n.id] ?? (genericId(n.id) ? clip(n.description, 28) : humanize(n.id));
    let label, sub;
    if (hint?.label) { label = hint.label; sub = ms.map(labelOf).join(' · '); }
    else if (ms.length === 1) { label = authored ?? labelOf(ms[0]); sub = ms[0].description ?? ''; }
    else if (why === 'chain') { label = ms.length > 2 ? `${labelOf(ms[0])} → … → ${labelOf(ms[ms.length - 1])}` : `${labelOf(ms[0])} → ${labelOf(ms[1])}`; sub = ms.map(m => m.description).filter(Boolean).join('. '); }
    else if (why === 'prep') { const main = ms.find(m => !isDet(m)) ?? ms[0]; label = labelOf(main); sub = `Includes: ${ms.filter(m => m !== main).map(labelOf).join(', ')}`; }
    else { label = `${ms.length} parallel ${ms.every(m => m.kind === 'map') ? 'reads' : 'judgements'}`; sub = ms.map(labelOf).join(' · '); }
    const roles = ms.map(roleOf), role = ROLE_ORDER.find(r => roles.includes(r)) ?? roles[0];
    out.push({ id: ms.length === 1 ? ms[0].id : `g:${ms[0].id}`, label, sub: clip(sub, 140), role, why, members: ms.map(m => m.id), kinds: ms.map(m => m.kind),
      container: ms.some(isContainer), hasModel: ms.some(isModelish), needs: [...pred.get(gid)].map(g => (membersOf(g).length === 1 ? membersOf(g)[0].id : `g:${membersOf(g).sort((a, b) => order.get(a.id) - order.get(b.id))[0].id}`)) });
  }
  const rawTo = new Map();
  for (const s of out) for (const m of s.members) rawTo.set(m, s.id);
  return { nodes: out, rawTo, rawCount: nodes.length, edges: out.flatMap(s => s.needs.map(from => ({ from, to: s.id }))) };
}
// Longest-path ranks, ordered inside a rank by the average position of their inputs.
function layoutRanks(sem) {
  const byId = new Map(sem.nodes.map(s => [s.id, s])), rank = new Map();
  const visit = id => { if (rank.has(id)) return rank.get(id); rank.set(id, 0); const r = Math.max(-1, ...byId.get(id).needs.filter(n => byId.has(n)).map(visit)) + 1; rank.set(id, r); return r; };
  sem.nodes.forEach(s => visit(s.id));
  const cols = [];
  for (const s of sem.nodes) (cols[rank.get(s.id)] ??= []).push(s.id);
  const pos = new Map();
  cols.forEach((col, c) => {
    if (c > 0) col.sort((a, b) => avg(byId.get(a).needs) - avg(byId.get(b).needs));
    col.forEach((id, i) => pos.set(id, i));
    function avg(ns) { const ps = ns.map(n => pos.get(n)).filter(p => p !== undefined); return ps.length ? ps.reduce((x, y) => x + y, 0) / ps.length : 0; }
  });
  return cols.filter(Boolean);
}
const semAgg = (model, sem) => {
  const agg = newAgg();
  for (const m of sem.members) { const i = model.insts.get(`root/${m}`); if (!i) continue; for (const k of Object.keys(agg)) { if (k === 'models') { for (const [id, n] of Object.entries(i.agg.models)) agg.models[id] = (agg.models[id] ?? 0) + n; } else agg[k] += i.agg[k]; } }
  return agg;
};
function semState(model, sem) { return combineStates(sem.members.map(m => model.insts.get(`root/${m}`)?.state ?? 'idle')); }
function semLine(model, sem, now) {
  const members = sem.members.map(m => ({ id: m, inst: model.insts.get(`root/${m}`) })).filter(m => m.inst);
  if (!members.length) return 'Not started';
  const state = semState(model, sem);
  const active = members.find(m => ACTIVE.has(m.inst.state) || m.inst.state === 'failed' || m.inst.state === 'envfault');
  const focus = active ?? members[members.length - 1];
  const i = focus.inst;
  if (i.cont) {
    const c = i.cont, total = c.total ?? c.items.size;
    if ((i.state === 'done' || i.state === 'handled') && total === 0) return 'Nothing to do: 0 items';
    const done = [...c.items.values()].filter(it => it.result).length;
    if (i.state === 'done' || i.state === 'handled') return `${done} of ${total} done${c.failedItems ? `, ${c.failedItems} failed (collected)` : ''}`;
    const recent = i.note && now - i.noteAt < 7000 ? `. ${i.note}` : '';
    const live = [...c.items.values()].filter(it => !it.result && it.state !== 'queued').length;
    return `${done} of ${c.total ?? `${c.items.size}+`} done${live ? `, ${live} active` : ''}${c.failedItems ? `, ${c.failedItems} failed` : ''}${recent}`;
  }
  const text = instLine(i, now);
  return sem.members.length > 1 && active ? `${humanize(focus.id)}: ${text}` : (sem.members.length > 1 && state === 'done' ? `${members.length} of ${sem.members.length} parts done` : text);
}
function semProgress(model, sem) {
  const cont = sem.members.map(m => model.insts.get(`root/${m}`)?.cont).filter(Boolean);
  if (!cont.length) return null;
  const p = { total: 0, done: 0, active: 0, failed: 0, queued: 0 };
  for (const c of cont) for (const it of c.items.values()) {
    p.total++;
    if (it.result === 'failed') p.failed++; else if (it.result === 'completed') p.done++; else if (it.state === 'queued') p.queued++; else p.active++;
  }
  const declared = cont.reduce((a, c) => a + (c.total ?? 0), 0);
  if (declared > p.total) { p.queued += declared - p.total; p.total = declared; }
  return p;
}

// ======================================================================================================== CORE: timeline
const NOTABLE = new Set(['model.escalated', 'model.resampled', 'model.retry', 'node.failed', 'map.item.failed', 'verify.failed', 'effect.uncertain', 'human.requested', 'approval.requested', 'node.handled_error', 'tool.failed', 'model.cancelled']);
// Virtual time for replay: idle gaps are shortened and notable moments are held, so a 50 s run is watchable and a one-event escalation is visible.
function buildTimeline(events, { compress = true, maxGap = 2000, dwell = 1200 } = {}) {
  const times = new Float64Array(events.length), notable = [];
  let v = 0;
  for (let i = 0; i < events.length; i++) {
    if (i > 0) {
      const gap = events[i].at - events[i - 1].at;
      let step = compress ? Math.min(gap, maxGap) : gap;
      if (NOTABLE.has(events[i - 1].type)) step = Math.max(step, dwell);
      v += step;
    }
    times[i] = v;
    if (NOTABLE.has(events[i].type) || (events[i].type.startsWith('run.') && events[i].type !== 'run.created' && events[i].type !== 'run.verdict')) notable.push(i);
  }
  return { times, dur: v, notable, count: events.length };
}
// Real (recorded) time at a virtual position, for elapsed counters.
function realAt(events, tl, idx, pos) {
  if (idx < 0) return events[0]?.at ?? 0;
  const e = events[idx], next = events[idx + 1];
  if (!next) return e.at;
  const span = tl.times[idx + 1] - tl.times[idx];
  return e.at + (span > 0 ? Math.min(1, Math.max(0, (pos - tl.times[idx]) / span)) : 0) * (next.at - e.at);
}

root.RunViewCore = { RunModel, buildSemantic, layoutRanks, buildTimeline, realAt, parseKey, containerKeys, defOf, reduceNeeds, classifyError, combineStates, sanitizeDisplay, instLine, semLine, semState, semAgg, semProgress,
  STATES, PRIORITY, ACTIVE, NOTABLE, shortModel, fmtCost, fmtDur, fmtClock, humanize, clip };

// ============================================================================================================= UI
if (typeof document !== 'undefined') startUI();

function startUI() {
const C = root.RunViewCore, { STATES, fmtCost, fmtDur, fmtClock, shortModel, humanize, clip, sanitizeDisplay } = C;
const $ = id => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const app = { data: null, model: null, tl: null, sem: null, cols: [], level: 1, cards: new Map(), idx: -1, pos: 0, playing: false, speed: 1, last: 0, compress: true,
  trail: null, semId: null, raf: 0, renderQueued: false, lastStates: new Map(), announceAt: 0, pending: [], filter: 'all', waffle: null, perf: { applies: 0, applyMs: 0, renders: 0, renderMs: 0, maxRenderMs: 0 } };

// Element builders. Values from a run only ever become text nodes or a fixed set of attribute values chosen here.
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) if (kid !== undefined && kid !== null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) el.setAttribute(k, String(v));
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
}

// ------------------------------------------------------------------------------------------------ dot and icons
const GLYPHS = {
  none: [], ring: [], solid: [['circle', { cx: 10, cy: 10, r: 2.6, class: 'd' }]],
  dots: [['circle', { cx: 6.4, cy: 10, r: 1.4, class: 'd' }], ['circle', { cx: 10, cy: 10, r: 1.4, class: 'd' }], ['circle', { cx: 13.6, cy: 10, r: 1.4, class: 'd' }]],
  retry: [['path', { d: 'M13.2 8.2A4 4 0 1 0 14 11.2' }], ['path', { d: 'M13.6 5.4v3h-3' }]],
  bang: [['path', { d: 'M10 5.8v5.2' }], ['circle', { cx: 10, cy: 14, r: 1, class: 'd' }]],
  up: [['path', { d: 'M10 14V7' }], ['path', { d: 'M6.8 9.8L10 6.6l3.2 3.2' }]],
  clock: [['path', { d: 'M10 6v4.2l2.6 1.5' }]],
  ask: [['path', { d: 'M7.8 8.1a2.3 2.3 0 1 1 3.7 1.8c-.9.7-1.5 1.1-1.5 2.1' }], ['circle', { cx: 10, cy: 14.3, r: 1, class: 'd' }]],
  check: [['path', { d: 'M6.2 10.4l2.5 2.5 5-5.4' }]],
  cross: [['path', { d: 'M7.2 7.2l5.6 5.6M12.8 7.2l-5.6 5.6' }]],
  plug: [['path', { d: 'M7.5 5.6v3M12.5 5.6v3M6.3 8.6h7.4v1.4a3.7 3.7 0 0 1-7.4 0z' }], ['path', { d: 'M10 13.7v1.7' }]],
  tilde: [['path', { d: 'M6 8.6q1.5-1.6 3 0t3 0M6 12q1.5-1.6 3 0t3 0' }]],
  dash: [['path', { d: 'M6.8 10h6.4' }]], slash: [['path', { d: 'M7.4 12.6l5.2-5.2' }]]
};
const HOLLOW = new Set(['idle', 'queued']);
function dotSvg(state, size) {
  const el = s('svg', { viewBox: '0 0 20 20', 'aria-hidden': 'true', focusable: 'false' }, s('circle', { class: 'ring', cx: 10, cy: 10, r: 8.6 }), s('circle', { class: 'core', cx: 10, cy: 10, r: 8 }), s('g', { class: 'glyph' }));
  setDot(el, state); if (size) el.classList.add(size);
  return el;
}
function setDot(el, state) {
  const def = STATES[state] ?? STATES.idle, keep = [...el.classList].filter(c => c === 'mini');
  el.setAttribute('class', ['dot', `f-${def.family}`, `s-${state}`, HOLLOW.has(state) ? 'hollow' : '', state === 'envfault' ? 'hatch' : '', def.anim !== 'none' ? `a-${def.anim}` : '', ...keep].filter(Boolean).join(' '));
  const g = el.querySelector('.glyph'); g.replaceChildren();
  for (const [tag, attrs] of GLYPHS[def.glyph] ?? []) g.append(s(tag, attrs));
}
const ROLE_PATHS = {
  code: 'M5.5 5L2.5 8l3 3M10.5 5l3 3-3 3', judge: 'M8 2l1.5 4 4 1.5-4 1.5L8 13l-1.5-4L2.5 7.5l4-1.5z', check: 'M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4zM5.8 8.2l1.7 1.7 3-3.2',
  map: 'M3 3.5h10v2.6H3zM3 6.7h10v2.6H3zM3 9.9h10v2.6H3z', loop: 'M12.5 6.5A4.6 4.6 0 1 0 12.8 10M12.6 3.6v3h-3', tool: 'M2.5 8h7M7 4.8L10.2 8 7 11.2M12.5 3v10',
  human: 'M8 7.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4zM3.6 13c.4-2.5 2.2-3.8 4.4-3.8s4 1.3 4.4 3.8', wait: 'M8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3zM8 5.6V8l1.8 1.1', assert: 'M3.5 6h9M3.5 10h9'
};
const ROLE_NAMES = { judge: 'model judgement', check: 'check', map: 'parallel items', loop: 'loop', tool: 'tool call', human: 'asks a person', wait: 'wait', code: 'code', assert: 'assertion' };
const roleIcon = role => s('svg', { class: 'icon-role', viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' }, s('path', { d: ROLE_PATHS[role] ?? ROLE_PATHS.code }));

// ------------------------------------------------------------------------------------------------ loading
const SCHEMA = 'foundry-run-view/1';
function load(data) {
  if (!data || data.schema !== SCHEMA || !Array.isArray(data.events) || !data.workflow?.nodes) throw new Error(`Not a ${SCHEMA} file`);
  pause();
  app.data = data; app.model = new C.RunModel(data); app.idx = -1; app.pos = 0; app.trail = null; app.semId = null; app.lastStates.clear();
  app.tl = C.buildTimeline(data.events, { compress: app.compress });
  $('empty').hidden = true; $('graph').hidden = false; $('legend').hidden = false; $('player').hidden = false; $('summary').hidden = false;
  const wf = data.workflow;
  $('title').textContent = wf.title ?? wf.id;
  $('subtitle').textContent = `${wf.id} v${wf.version} · run ${data.run.id.slice(0, 8)} · ${data.source?.workspace ?? ''} · exported ${data.exportedAt?.slice(0, 19).replace('T', ' ') ?? ''} UTC`;
  document.title = `${wf.title ?? wf.id} · Foundry run view`;
  drawTicks(); buildGraph(); buildLegend(); closeDrawer(true); updatePlayer();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, params = new URLSearchParams(location.search);
  if (params.get('autoplay') === '0' || reduce) seek(params.get('autoplay') === '0' ? 0 : app.tl.dur); else play();
}
async function loadFromPage() {
  const embedded = document.getElementById('run-data');
  if (embedded) return load(JSON.parse(embedded.textContent));
  const param = new URLSearchParams(location.search).get('data');
  const http = /^https?:$/.test(location.protocol);
  // Only a relative path on this origin can be fetched; an absolute URL is refused.
  if (param && http && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(param)) {
    const res = await fetch(param, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not load ${param}: HTTP ${res.status}`);
    return load(await res.json());
  }
}
function readFile(file) {
  const reader = new FileReader();
  reader.onload = () => { try { load(JSON.parse(String(reader.result))); } catch (error) { showError(error.message); } };
  reader.onerror = () => showError('Could not read that file');
  reader.readAsText(file);
}
function showError(message) { $('empty').hidden = false; $('empty').replaceChildren(h('h2', null, 'Could not open that run'), h('p', { role: 'alert' }, message)); }

// ------------------------------------------------------------------------------------------------ graph
function buildGraph() {
  app.sem = C.buildSemantic(app.data.workflow, { level: app.level, hints: app.data.viewHints ?? null });
  app.cols = C.layoutRanks(app.sem);
  app.cards.clear();
  const byId = new Map(app.sem.nodes.map(n => [n.id, n])), host = $('cols');
  host.replaceChildren();
  for (const col of app.cols) {
    const colEl = h('div', { class: 'col' });
    for (const id of col) { const card = makeCard(byId.get(id)); app.cards.set(id, card); colEl.append(card.el); }
    host.append(colEl);
  }
  $('graph').setAttribute('aria-label', `Workflow nodes, left to right in dependency order: ${app.sem.nodes.length} nodes shown from ${app.sem.rawCount} workflow nodes`);
  renderAll(); requestAnimationFrame(drawEdges);
}
function makeCard(sem) {
  const dot = dotSvg('idle'), count = h('span', { class: 'count' }), line = h('span', { class: 'line' }), chips = h('span', { class: 'chips' });
  const bar = s('svg', { class: 'bar-seg', viewBox: '0 0 100 5', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
  const el = h('button', { class: 'card', type: 'button', 'data-id': sem.id, 'aria-pressed': 'false', onclick: () => selectSem(sem.id) },
    dot, h('span', { class: 'body' }, h('span', { class: 'head' }, roleIcon(sem.role), h('span', { class: 'label' }, sem.label), count), line, chips, bar));
  bar.hidden = true;
  return { sem, el, dot, count, line, chips, bar, cache: {} };
}
function updateCard(card, now) {
  const m = app.model, sem = card.sem, c = card.cache;
  const state = C.semState(m, sem), line = C.semLine(m, sem, now), agg = C.semAgg(m, sem), prog = C.semProgress(m, sem);
  const def = STATES[state];
  if (c.state !== state) {
    setDot(card.dot, state); c.state = state;
    card.el.className = `card f-${def.family} s-${state}${sem.container || sem.members.length > 1 ? ' group' : ''}`;
  }
  const count = prog && prog.total ? `×${prog.total}` : sem.members.length > 1 ? `${sem.members.length} steps` : '';
  if (c.count !== count) { card.count.textContent = count; card.count.hidden = !count; c.count = count; }
  if (c.line !== line) { card.line.textContent = line; c.line = line; }
  const chips = [];
  const models = Object.entries(agg.models).sort((a, b) => b[1] - a[1]);
  if (models.length) chips.push(['', models.slice(0, 2).map(([id, n]) => `${shortModel(id)} ×${n}`).join(' · ')]);
  if (agg.costUsd) chips.push(['', fmtCost(agg.costUsd)]);
  if (agg.escalations) chips.push(['violet', `${agg.escalations} escalated`]);
  if (agg.checkFails) chips.push(['amber', `${agg.checkFails} check failed`]);
  if (agg.retries) chips.push(['amber', `${agg.retries} retried`]);
  if (agg.failedItems) chips.push(['red', `${agg.failedItems} item failed`]);
  if (agg.envFaults) chips.push(['red', `${agg.envFaults} env fault`]);
  const key = chips.map(x => x.join(':')).join('|');
  if (c.chips !== key) { card.chips.replaceChildren(...chips.map(([cls, text]) => h('span', { class: `chip ${cls}` }, text))); c.chips = key; }
  const pkey = prog ? `${prog.total}/${prog.done}/${prog.failed}/${prog.active}/${prog.queued}` : '';
  if (c.prog !== pkey) {
    card.bar.replaceChildren(); card.bar.hidden = !prog || !prog.total;
    if (prog && prog.total) { let x = 0; for (const [cls, n] of [['done', prog.done], ['failed', prog.failed], ['active', prog.active], ['queued', prog.queued]]) { if (!n) continue; const w = n / prog.total * 100; card.bar.append(s('rect', { class: `seg-${cls}`, x, y: 0, width: w, height: 5 })); x += w; } }
    c.prog = pkey;
  }
  const label = `${sem.label}. ${def.label}. ${line}.${count ? ` ${count}.` : ''} ${ROLE_NAMES[sem.role] ?? sem.role}.`;
  if (c.aria !== label) { card.el.setAttribute('aria-label', label); c.aria = label; }
  card.el.setAttribute('aria-pressed', app.semId === sem.id ? 'true' : 'false');
  return state;
}
function drawEdges() {
  const svgEl = $('edges'), graph = $('graph');
  if (graph.hidden) return;
  const box = graph.getBoundingClientRect();
  svgEl.setAttribute('width', box.width); svgEl.setAttribute('height', box.height); svgEl.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  svgEl.replaceChildren();
  for (const e of app.sem.edges) {
    const a = app.cards.get(e.from)?.el, b = app.cards.get(e.to)?.el;
    if (!a || !b) continue;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const x1 = ra.right - box.left, y1 = ra.top + ra.height / 2 - box.top, x2 = rb.left - box.left, y2 = rb.top + rb.height / 2 - box.top, dx = Math.max(20, (x2 - x1) / 2);
    svgEl.append(s('path', { class: 'edge', 'data-from': e.from, 'data-to': e.to, d: `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}` }));
  }
  styleEdges();
}
function styleEdges() {
  for (const p of $('edges').children) {
    const from = app.cards.get(p.dataset.from)?.cache.state, to = app.cards.get(p.dataset.to)?.cache.state;
    const live = C.ACTIVE.has(to) && (from === 'done' || from === 'handled'), done = (from === 'done' || from === 'handled') && !C.ACTIVE.has(to) && to !== 'idle';
    p.setAttribute('class', `edge${live ? ' live' : ''}${done ? ' done' : ''}`);
  }
}
function buildLegend() {
  const host = $('legend'); host.replaceChildren();
  const main = ['calling', 'escalated', 'checkfailed', 'waiting', 'needsyou', 'done', 'failed', 'envfault'];
  const item = k => h('span', { class: 'item' }, dotSvg(k), STATES[k].label);
  for (const k of main) host.append(item(k));
  host.append(h('details', null, h('summary', null, 'All states'), h('div', { class: 'all' }, Object.keys(STATES).map(item))));
  host.append(h('span', { class: 'note' }, 'Each state has its own colour, shape and words. A dot breathes while that part is active. Done-with-problems states keep a chip on the node.'));
}

// ------------------------------------------------------------------------------------------------ rendering
const nowReal = () => C.realAt(app.data.events, app.tl, app.idx, app.pos);
function renderAll() {
  if (!app.model) return;
  const t0 = performance.now(), now = nowReal();
  for (const card of app.cards.values()) noteState(card.sem, updateCard(card, now));
  styleEdges(); renderSummary(now); refreshDrawer(true);
  app.model.dirty.clear(); app.model.dirtyKeys.clear();
  perfRender(t0);
}
function renderDirty() {
  app.renderQueued = false;
  const t0 = performance.now(), now = nowReal(), m = app.model;
  const ids = new Set();
  for (const top of m.dirty) { const id = app.sem.rawTo.get(top); if (id) ids.add(id); }
  for (const id of ids) { const card = app.cards.get(id); if (card) noteState(card.sem, updateCard(card, now)); }
  styleEdges(); renderSummary(now); refreshDrawer(false);
  m.dirty.clear(); m.dirtyKeys.clear();
  perfRender(t0); flushAnnouncements();
}
function perfRender(t0) { const d = performance.now() - t0; app.perf.renders++; app.perf.renderMs += d; app.perf.maxRenderMs = Math.max(app.perf.maxRenderMs, d); }
function scheduleRender() { if (!app.renderQueued) { app.renderQueued = true; requestAnimationFrame(renderDirty); } }
const SPEAK = new Set(['needsyou', 'failed', 'envfault', 'escalated', 'checkfailed', 'uncertain']);
function noteState(sem, state) {
  const prev = app.lastStates.get(sem.id);
  if (prev !== undefined && prev !== state && (SPEAK.has(state) || (state === 'done' && prev !== 'idle'))) app.pending.push(`${sem.label}: ${STATES[state].label}`);
  app.lastStates.set(sem.id, state);
}
function flushAnnouncements() {
  if (!app.pending.length || performance.now() - app.announceAt < 1500) return;
  const [first, ...rest] = app.pending; app.pending = [];
  $('live').textContent = rest.length ? `${first}. ${rest.length} more updates.` : first; app.announceAt = performance.now();
}
function renderSummary(now) {
  const m = app.model, run = m.run, d = app.data, box = $('summary');
  const status = run.status === 'ready' ? 'ready' : run.status;
  const stateName = { ready: 'Starting', running: 'Running', succeeded: 'Succeeded locally', failed: 'Failed', cancelled: 'Cancelled', waiting: 'Waiting', awaiting_human: 'Needs an answer', awaiting_approval: 'Needs approval', uncertain: 'Uncertain effect' }[status] ?? status;
  const dotState = { succeeded: 'done', failed: 'failed', cancelled: 'cancelled', waiting: 'waiting', awaiting_human: 'needsyou', awaiting_approval: 'needsyou', uncertain: 'uncertain' }[status] ?? 'running';
  const elapsed = Math.max(0, now - (run.firstAt ?? now)), total = d.events[d.events.length - 1].at - d.events[0].at;
  const key = [status, fmtCost(run.cost), run.calls, run.escalations, run.checkFails, run.verdict ? 1 : 0, Math.floor(elapsed / 100)].join('|');
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const pills = [];
  const sd = dotSvg(dotState); sd.classList.add('mini');
  pills.push(h('span', { class: 'pill', title: 'Run status from the runtime. Succeeded means the workflow\'s own acceptance checks held. It is not task verification.' }, sd, h('strong', null, stateName)));
  if (run.verdict) pills.push(h('span', { class: 'pill' }, `Verdict: ${run.verdict.verdict}`, h('span', { class: 'muted' }, `(${run.verdict.authority}; does not establish completion)`)));
  const ext = d.external ?? [];
  if (status === 'succeeded' || status === 'failed' || status === 'cancelled') {
    if (ext.length) for (const e of ext) pills.push(h('span', { class: `pill ${e.pass ? 'good' : 'bad'}`, title: `${e.source}, ${e.taskKey}. ${e.split} split: development evidence, not held-out.` }, h('strong', null, e.pass ? 'Independent oracle passed' : 'Independent oracle FAILED'), `score ${e.score?.toFixed?.(4) ?? e.score} (${e.split} split)`));
    else pills.push(h('span', { class: 'pill warn' }, h('strong', null, 'No independent verification attached')));
  }
  pills.push(h('span', { class: 'pill' }, 'Recorded time ', h('strong', null, `${fmtClock(elapsed)} / ${fmtClock(total)}`)));
  const cap = d.run.budget?.maxCost;
  pills.push(h('span', { class: 'pill meter' }, 'Spend ', h('strong', null, fmtCost(run.cost)), Number.isFinite(cap) ? [h('progress', { max: cap, value: Math.min(cap, run.cost), 'aria-label': 'Spend against the run cost cap' }), h('span', { class: 'muted' }, `cap ${fmtCost(cap)}`)] : null));
  pills.push(h('span', { class: 'pill' }, h('strong', null, run.calls), ' model calls'));
  if (run.escalations) pills.push(h('span', { class: 'pill warn' }, h('strong', null, run.escalations), ' escalations'));
  if (run.checkFails) pills.push(h('span', { class: 'pill warn' }, h('strong', null, run.checkFails), ' check failures'));
  const i = d.integrity;
  pills.push(h('span', { class: 'pill', title: `Hash chain of ${i.events} events verified when exported; head ${i.head}. ${i.derivedEvents} dispatch events were reconstructed from journal latency.` }, 'Chain verified at export'));
  box.replaceChildren(...pills);
}

// ------------------------------------------------------------------------------------------------ player
function applyUpTo(pos) {
  const ev = app.data.events, times = app.tl.times, t0 = performance.now(); let n = 0;
  while (app.idx + 1 < ev.length && times[app.idx + 1] <= pos) { app.model.apply(ev[++app.idx]); n++; }
  app.perf.applies += n; app.perf.applyMs += performance.now() - t0;
  return n;
}
function seek(pos, { silent = false } = {}) {
  if (!app.data) return;
  pos = Math.max(0, Math.min(app.tl.dur, pos));
  const times = app.tl.times;
  if (app.idx >= 0 && times[app.idx] > pos) { app.model.reset(); app.idx = -1; app.lastStates.clear(); }
  applyUpTo(pos); app.pos = pos;
  if (!silent) { renderAll(); app.pending = []; } else scheduleRender();
  updatePlayer();
}
// Exact navigation by event index (several events can share one virtual time, so a time seek cannot step by one).
function gotoIndex(i) {
  if (!app.data) return;
  const last = app.data.events.length - 1; i = Math.max(-1, Math.min(last, i));
  if (i < app.idx) { app.model.reset(); app.idx = -1; app.lastStates.clear(); }
  const t0 = performance.now(); let n = 0;
  while (app.idx < i) { app.model.apply(app.data.events[++app.idx]); n++; }
  app.perf.applies += n; app.perf.applyMs += performance.now() - t0;
  app.pos = i < 0 ? 0 : app.tl.times[i]; app.pending = [];
  renderAll(); updatePlayer();
}
const seekIndex = gotoIndex;
function frame(t) {
  if (!app.playing) return;
  const dt = Math.min(250, t - app.last); app.last = t;
  app.pos = Math.min(app.tl.dur, app.pos + dt * app.speed);
  if (applyUpTo(app.pos)) scheduleRender();
  updatePlayer();
  if (app.pos >= app.tl.dur) { pause(); renderAll(); return; }
  app.raf = requestAnimationFrame(frame);
}
function play() {
  if (!app.data) return;
  if (app.pos >= app.tl.dur) { app.model.reset(); app.idx = -1; app.pos = 0; app.lastStates.clear(); renderAll(); }
  app.playing = true; app.last = performance.now(); app.raf = requestAnimationFrame(frame); setPlayLabel();
}
function pause() { app.playing = false; cancelAnimationFrame(app.raf); setPlayLabel(); }
function setPlayLabel() { const b = $('play'); b.textContent = app.playing ? 'Pause' : (app.data && app.pos >= app.tl.dur ? 'Replay' : 'Play'); b.setAttribute('aria-label', app.playing ? 'Pause' : 'Play'); }
function updatePlayer() {
  if (!app.data) return;
  const sc = $('scrub'), dur = app.tl.dur || 1;
  sc.max = 1000; sc.value = Math.round(app.pos / dur * 1000);
  const real = nowReal() - app.data.events[0].at, total = app.data.events[app.data.events.length - 1].at - app.data.events[0].at;
  sc.setAttribute('aria-valuetext', `${fmtClock(real)} of ${fmtClock(total)} recorded time`);
  $('clock').textContent = `${fmtClock(real)} / ${fmtClock(total)}`;
  $('evcount').textContent = `${app.idx + 1} / ${app.data.events.length} events`;
  setPlayLabel();
}
function drawTicks() {
  const t = $('ticks'); t.replaceChildren();
  const ev = app.data.events, dur = app.tl.dur || 1;
  for (const i of app.tl.notable) {
    const type = ev[i].type, cls = type === 'model.escalated' ? 't-esc' : /failed|uncertain/.test(type) ? 't-fail' : type.startsWith('run.') ? 't-end' : '';
    t.append(s('rect', { class: `tick ${cls}`, x: app.tl.times[i] / dur * 1000, y: 0, width: 4, height: 10 }));
  }
}
function jumpNotable(dir) {
  const n = app.tl.notable; if (!n.length) return;
  const cur = app.idx;
  const target = dir > 0 ? n.find(i => i > cur) : [...n].reverse().find(i => i < cur);
  if (target !== undefined) { pause(); seekIndex(target); }
}

// ------------------------------------------------------------------------------------------------ drawer
function selectSem(id) {
  app.semId = id; const sem = app.sem.nodes.find(n => n.id === id);
  app.trail = sem.members.length === 1 ? [`root/${sem.members[0]}`] : [];
  for (const c of app.cards.values()) c.el.setAttribute('aria-pressed', c.sem.id === id ? 'true' : 'false');
  autoDescend(); refreshDrawer(true);
  $('drawer').scrollTop = 0;
}
function closeDrawer(silent) {
  const had = app.semId; app.semId = null; app.trail = null; $('drawer').hidden = true; $('drawer').replaceChildren();
  for (const c of app.cards.values()) c.el.setAttribute('aria-pressed', 'false');
  if (!silent && had) app.cards.get(had)?.el.focus();
  requestAnimationFrame(drawEdges);
}
// A frame with a single node, or a single-node chain, opens straight to that node's transcript.
function autoDescend() {
  const m = app.model;
  for (let guard = 0; guard < 6; guard++) {
    const last = app.trail[app.trail.length - 1], item = m.items.get(last);
    if (item && item.leaves.length === 1) { app.trail.push(item.leaves[0]); continue; }
    break;
  }
}
const stateOfKey = key => { const m = app.model; return m.insts.get(key)?.state ?? m.items.get(key)?.state ?? 'idle'; };
function crumbLabel(key) {
  const m = app.model, it = m.items.get(key);
  if (it) return `item ${it.idx}`;
  const seg = C.parseKey(key).pop();
  return humanize(seg.id) + (seg.idx !== null ? ` ${seg.idx}` : '');
}
function refreshDrawer(force) {
  const dr = $('drawer');
  if (app.semId === null || !app.trail) { return; }
  const sem = app.sem?.nodes.find(n => n.id === app.semId);
  if (!sem) { closeDrawer(true); return; }
  if (!force) {
    const touched = [...app.model.dirtyKeys];
    const watch = new Set([...app.trail, ...sem.members.map(m => `root/${m}`)]);
    if (!touched.some(k => watch.has(k) || app.trail.some(t => k.startsWith(`${t}/`) || k.startsWith(`${t}:`)))) { updateWaffle(); return; }
  }
  const keepScroll = dr.scrollTop, open = new Set([...dr.querySelectorAll('details[open]')].map(d => d.dataset.k).filter(Boolean));
  dr.hidden = false; dr.replaceChildren(drawerContent(sem, open));
  dr.scrollTop = force ? dr.scrollTop : keepScroll;
  requestAnimationFrame(drawEdges);
}
function drawerContent(sem, open) {
  const m = app.model, now = nowReal(), state = C.semState(m, sem), def = STATES[state];
  const frag = document.createDocumentFragment();
  frag.append(h('header', { class: 'dh' }, dotSvg(state), h('div', { class: 't' }, h('h2', null, sem.label), h('p', { class: 'muted' }, `${def.label} · ${ROLE_NAMES[sem.role] ?? sem.role}${sem.members.length > 1 ? ` · ${sem.members.length} workflow nodes` : ''}`)),
    h('button', { class: 'btn small', type: 'button', onclick: () => closeDrawer(false) }, 'Close')));
  // breadcrumbs
  const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Where you are in this node' });
  crumbs.append(h('button', { type: 'button', onclick: () => { app.trail = sem.members.length === 1 ? [`root/${sem.members[0]}`] : []; refreshDrawer(true); } }, sem.label));
  app.trail.forEach((key, i) => {
    crumbs.append('›');
    if (i === app.trail.length - 1) crumbs.append(h('span', { class: 'cur', 'aria-current': 'location' }, crumbLabel(key)));
    else crumbs.append(h('button', { type: 'button', onclick: () => { app.trail = app.trail.slice(0, i + 1); refreshDrawer(true); } }, crumbLabel(key)));
  });
  frag.append(crumbs);
  const sec = h('div', { class: 'sec' });
  frag.append(sec);
  if (sem.sub && !app.trail.length) sec.append(h('p', { class: 'muted' }, sem.sub));
  const focus = app.trail[app.trail.length - 1];
  if (!focus) { sec.append(h('h3', null, 'Parts'), partsList(sem)); return frag; }
  const inst = m.insts.get(focus), item = m.items.get(focus);
  if (item) { sec.append(itemLeaves(item)); return frag; }
  if (!inst) { sec.append(h('p', { class: 'muted' }, 'This part has not started yet.')); definitionBlock(sec, focus, open); return frag; }
  if (inst.cont) { sec.append(itemsPanel(inst)); definitionBlock(sec, focus, open); return frag; }
  sec.append(factsFor(inst, now), h('h3', null, 'Transcript'), transcript(inst, open), h('h3', null, 'Receipts'), receipts(inst));
  definitionBlock(sec, focus, open);
  return frag;
}
function partsList(sem) {
  const m = app.model, list = h('div', { class: 'rows' });
  for (const id of sem.members) {
    const inst = m.insts.get(`root/${id}`), st = inst?.state ?? 'idle';
    list.append(h('button', { class: 'row', type: 'button', onclick: () => { app.trail = [`root/${id}`]; autoDescend(); refreshDrawer(true); } }, dotSvg(st), h('span', { class: 'r1' }, humanize(id)), h('span', { class: 'r2' }, inst ? C.instLine(inst, nowReal()) : 'Not started')));
  }
  return list;
}
function itemLeaves(item) {
  const m = app.model, list = h('div', { class: 'rows' });
  for (const key of item.leaves) {
    const inst = m.insts.get(key);
    list.append(h('button', { class: 'row', type: 'button', onclick: () => { app.trail = [...app.trail, key]; refreshDrawer(true); } }, dotSvg(inst.state), h('span', { class: 'r1' }, humanize(C.parseKey(key).pop().id)), h('span', { class: 'r2' }, C.instLine(inst, nowReal()))));
  }
  return h('div', null, h('h3', null, `Item ${item.idx}: ${STATES[item.state].label}`), list.children.length ? list : h('p', { class: 'muted' }, 'No node of this item has started yet.'));
}
function itemSummary(item) {
  const m = app.model; let cost = 0, esc = 0, models = new Set(), start = Infinity, end = 0, fail = null;
  for (const k of item.leaves) { const i = m.insts.get(k); if (!i) continue; cost += i.costUsd; esc += i.escalations; if (i.modelId) models.add(shortModel(i.modelId)); if (i.startedAt) start = Math.min(start, i.startedAt); if (i.endedAt) end = Math.max(end, i.endedAt); if (i.error) fail = i.error.code; }
  const dur = end && Number.isFinite(start) ? fmtDur(end - start) : '';
  return [STATES[item.state].label, [...models].join(', '), cost ? fmtCost(cost) : '', esc ? `escalated ${esc}x` : '', dur, item.result === 'failed' ? (fail ?? item.error?.code ?? '') : ''].filter(Boolean).join(' · ');
}
const FILTERS = [['all', 'All', () => true], ['active', 'Active', it => ['calling', 'queued', 'running', 'escalated', 'checkfailed', 'retrying', 'waiting', 'needsyou'].includes(it.state)],
  ['failed', 'Failed', it => it.state === 'failed' || it.state === 'envfault'], ['escalated', 'Escalated', it => it.leaves.some(k => (app.model.insts.get(k)?.escalations ?? 0) > 0)], ['done', 'Done', it => it.state === 'done' || it.state === 'handled']];
function itemsPanel(inst) {
  const m = app.model, c = inst.cont, items = [...c.items.values()].sort((a, b) => a.idx - b.idx);
  const wrap = h('div', null, factsFor(inst, nowReal()));
  wrap.append(h('h3', null, `Items (${items.length}${c.total && c.total > items.length ? ` of ${c.total}` : ''})`));
  const filters = h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter items' });
  for (const [id, label, test] of FILTERS) {
    const n = items.filter(test).length;
    filters.append(h('button', { type: 'button', 'aria-pressed': app.filter === id ? 'true' : 'false', onclick: () => { app.filter = id; refreshDrawer(true); } }, `${label} ${n}`));
  }
  wrap.append(filters);
  if (items.length > 40) {
    const cell = 12, cols = 40, rows = Math.ceil(items.length / cols), tip = h('p', { class: 'note', 'aria-hidden': 'true' }, 'Each square is one item. Click one to open it.');
    const svgEl = s('svg', { class: 'waffle', viewBox: `0 0 ${cols * cell} ${rows * cell}`, width: '100%', role: 'img', 'aria-label': `Overview of ${items.length} items by state. The list below has the same items.` });
    const rects = new Map();
    items.forEach((it, i) => {
      const r = s('rect', { class: `cell s-${it.state}`, x: (i % cols) * cell, y: Math.floor(i / cols) * cell, width: cell, height: cell, 'data-k': it.key });
      r.addEventListener('mouseenter', () => { tip.textContent = `Item ${it.idx}: ${itemSummary(it)}`; });
      r.addEventListener('click', () => { app.trail = [...app.trail, it.key]; autoDescend(); refreshDrawer(true); });
      rects.set(it.key, r); svgEl.append(r);
    });
    app.waffle = { inst: inst.key, rects };
    wrap.append(h('div', { class: 'waffle' }, svgEl), tip);
  } else app.waffle = null;
  const test = FILTERS.find(f => f[0] === app.filter)[2], shown = items.filter(test), cap = 60;
  const list = h('div', { class: 'rows' });
  for (const it of shown.slice(0, cap)) list.append(h('button', { class: 'row', type: 'button', onclick: () => { app.trail = [...app.trail, it.key]; autoDescend(); refreshDrawer(true); } }, dotSvg(it.state), h('span', { class: 'r1' }, `Item ${it.idx}`), h('span', { class: 'r2' }, itemSummary(it))));
  wrap.append(shown.length ? list : h('p', { class: 'muted' }, 'No items match this filter.'));
  if (shown.length > cap) wrap.append(h('p', { class: 'note' }, `Showing the first ${cap} of ${shown.length}. Use the overview or a narrower filter.`));
  return wrap;
}
function updateWaffle() {
  const w = app.waffle; if (!w) return;
  for (const key of app.model.dirtyKeys) { const r = w.rects.get(key); if (r) r.setAttribute('class', `cell s-${app.model.items.get(key).state}`); }
}
function factsFor(inst, now) {
  const m = app.model, def = C.defOf(app.data.workflow, inst.key), dl = h('dl', { class: 'facts' });
  const add = (k, v) => { if (v !== undefined && v !== null && v !== '') dl.append(h('dt', null, k), h('dd', null, v)); };
  add('State', `${STATES[inst.state].label}${inst.status === 'completed' && inst.verifyFalse ? ' (completed; the verifier returned pass = false)' : ''}`);
  add('What it does', def?.description);
  add('Kind', inst.kind ? `${inst.kind}${def?.method ? ` (${def.method})` : ''}` : '');
  add('Now', C.instLine(inst, now));
  if (inst.startedAt) add('Duration', fmtDur((inst.endedAt ?? now) - inst.startedAt));
  if (inst.modelId) add('Model', `${inst.modelId}${inst.modelClass ? ` (class ${inst.modelClass})` : ''}${inst.escalations ? `, escalated ${inst.escalations}x from ${shortModel(inst.escalatedFrom)}` : ''}`);
  if (def?.model) add('Allowed models', `class ${def.model.class ?? '?'}${def.model.maxClass ? `, up to class ${def.model.maxClass}` : ''}${def.model.id ? `, pinned ${def.model.id}` : ''}`);
  if (inst.calls.length || inst.costUsd) add('Model calls', `${inst.calls.length}, ${fmtCost(inst.costUsd)}`);
  if (inst.error) add('Error', `${inst.error.code}: ${clip(inst.error.message, 300)}`);
  return dl;
}
function definitionBlock(sec, key, open) {
  const def = C.defOf(app.data.workflow, key);
  if (!def) return;
  const body = [];
  if (def.kind === 'code' || def.method === 'code') body.push(h('p', { class: 'muted' }, `${def.lang ?? 'code'} source (clipped in the export):`), codeBlock(def.source));
  if (def.instructions) body.push(h('p', { class: 'muted' }, 'Instructions given to the model:'), codeBlock(def.instructions));
  if (def.returns) body.push(h('p', { class: 'muted' }, 'Required output shape:'), codeBlock(JSON.stringify(def.returns, null, 2)));
  if (def.checks?.length) body.push(h('p', { class: 'muted' }, `${def.checks.length} output checks (all must hold; checked by the runtime):`), codeBlock(JSON.stringify(def.checks, null, 2)));
  if (def.escalation) body.push(h('p', { class: 'muted' }, 'Escalation rules:'), codeBlock(JSON.stringify(def.escalation, null, 2)));
  sec.append(h('h3', null, 'Definition'), details(`def:${key}`, `Definition of ${def.id} (${def.kind})`, open, body.length ? body : [h('p', { class: 'muted' }, def.description ?? '')]));
}
function details(k, summary, open, children) {
  return h('details', { 'data-k': k, open: open?.has(k) }, h('summary', null, summary), ...children);
}
function codeBlock(value, max = 3500) {
  const { text, replaced } = sanitizeDisplay(typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '');
  const wrap = h('div'), pre = h('pre', { class: 'code' }, text.length > max ? text.slice(0, max) : text);
  wrap.append(pre);
  if (replaced) wrap.append(h('p', { class: 'note' }, `${replaced} control or invisible character${replaced === 1 ? '' : 's'} shown as ⟦U+XXXX⟧.`));
  if (text.length > max) {
    const more = h('button', { class: 'btn small', type: 'button', onclick: () => { pre.textContent = text; more.remove(); } }, `Show all (${text.length} characters)`);
    wrap.append(more);
  }
  return wrap;
}

// ------------------------------------------------------------------------------------------------ transcript
const rel = ev => `+${fmtDur(ev.at - (app.model.run.firstAt ?? ev.at))}`;
function turn(kind, who, ev, ...body) {
  return h('section', { class: `turn t-${kind}` }, h('div', { class: 'th' }, h('span', { class: 'who' }, who), ev ? h('time', null, rel(ev)) : null), h('div', { class: 'tb' }, ...body));
}
function chipRow(items) { return h('div', { class: 'chips' }, items.filter(Boolean).map(([cls, t]) => h('span', { class: `chip ${cls ?? ''}` }, t))); }
function outputOf(ev) { return ev.output !== undefined ? ev.output : app.data.outputs?.[ev.seq]; }
function transcript(inst, open) {
  const d = app.data, wrap = h('div'), def = C.defOf(d.workflow, inst.key);
  const decisions = (d.decisions ?? []).filter(x => x.features?.nodeKey === inst.key);
  const turns = inst.turns;
  let shownPromptFor = null;
  for (let i = 0; i < turns.length; i++) {
    const ev = turns[i], t = ev.type;
    if (t === 'node.started' || t === 'tool.intent') wrap.append(turn('info', t === 'tool.intent' ? `Started tool ${ev.tool ?? ''}` : `Started (${ev.kind})`, ev, chipRow([['', `reserved ${fmtCost(ev.reservedCost ?? 0)}`], ev.argsHash ? ['', `args ${ev.argsHash.slice(0, 12)}`] : null, ev.effects ? ['', `effects: ${ev.effects}`] : null])));
    else if (t === 'context.compiled') wrap.append(contextTurn(ev));
    else if (t === 'model.dispatched') {
      wrap.append(turn('info', 'Left the queue; call in flight', ev, h('p', { class: 'note' }, `Reconstructed from the journal: dispatched about ${fmtDur(ev.latencyMs)} before the reply (the runtime records no event when a call leaves the concurrency queue).`)));
      wrap.append(promptTurn(ev, ev.journalId, open)); shownPromptFor = ev.journalId;
    } else if (t === 'model.called' || t === 'node.recovered_from_journal') {
      if (shownPromptFor !== ev.journalId) wrap.append(promptTurn(ev, ev.journalId, open));
      wrap.append(replyTurn(ev, open));
    } else if (t === 'model.retry') wrap.append(turn('check', `Reply rejected, retry ${ev.retry} on the same model`, ev, h('p', null, `Rule ${ev.rule}: ${ev.errorCode}. The runtime asked ${shortModel(ev.modelId)} again with a note about what was wrong.`)));
    else if (t === 'model.resampled') wrap.append(turn('check', `Check failed, resampling (sample ${ev.sampleIndex})`, ev, h('p', null, `Rule ${ev.rule}: ${ev.reason}. The same model is asked again.`)));
    else if (t === 'model.escalated') wrap.append(escalationTurn(ev, def, decisions));
    else if (t === 'model.cancelled') wrap.append(turn('error', 'Model call cancelled', ev, chipRow([['', fmtCost(ev.costUsd)]])));
    else if (t === 'node.completed') wrap.append(outputTurn(ev, inst, def, open));
    else if (t === 'node.handled_error') wrap.append(turn('check', 'Error handled (onError: continue)', ev, codeBlock(outputOf(ev) ?? {})));
    else if (t === 'node.failed') wrap.append(errorTurn(ev));
    else if (t === 'node.skipped') wrap.append(turn('info', 'Skipped', ev, h('p', null, ev.reason ?? 'A condition or a predecessor result excluded this node.')));
    else if (t === 'verify.failed') wrap.append(turn('check', 'Verifier said the subject fails', ev, codeBlock(ev.output ?? {})));
    else if (t === 'human.requested') wrap.append(turn('ask', 'Asked a person', ev, h('p', null, sanitizeDisplay(ev.question).text)));
    else if (t === 'human.answered') wrap.append(turn('info', 'A person answered', ev, h('p', { class: 'note' }, `Answer hash ${String(ev.answerHash).slice(0, 12)}`)));
    else if (t === 'approval.requested') wrap.append(turn('ask', `Approval requested for ${ev.tool}`, ev, h('p', { class: 'note' }, `Args hash ${String(ev.argsHash).slice(0, 12)}`)));
    else if (t === 'approval.decided') wrap.append(turn('info', ev.approved ? 'Approved by the user' : 'Rejected by the user', ev));
    else if (t === 'effect.uncertain') wrap.append(turn('error', 'Effect uncertain', ev, h('p', null, 'The operation may or may not have happened. It is not retried; a person must reconcile it.'), codeBlock(ev.error ?? {})));
    else if (t === 'tool.failed') wrap.append(turn('check', 'Tool attempt failed', ev, codeBlock(ev.error ?? {})));
    else if (t === 'oracle.dispatched') wrap.append(turn('info', `Oracle ${ev.tool} dispatched`, ev, chipRow([['', `reserved ${fmtCost(ev.reservedCost ?? 0)}`]])));
    else if (t === 'node.waiting') wrap.append(turn('info', 'Waiting on a timer', ev, h('p', null, `Wakes at ${new Date(ev.wakeAt).toISOString()}`)));
    else if (t === 'node.waiting_child') wrap.append(turn('info', 'Waiting for child steps', ev));
    else wrap.append(turn('info', t, ev));
  }
  if (!turns.length) wrap.append(h('p', { class: 'muted' }, 'No events yet.'));
  return wrap;
}
function contextTurn(ev) {
  const r = ev.receipt ?? {}, rows = (r.inputs ?? []).map(i => h('tr', null, h('td', null, i.name), h('td', null, h('span', { class: `chip ${/^untrusted/.test(i.label) ? 'untrusted' : ''}` }, i.label)), h('td', null, i.tokens), h('td', null, i.sourceRef ?? ''), h('td', null, i.truncated ? 'truncated' : '')));
  return turn('context', `Context compiled for ${shortModel(ev.modelId)} (class ${ev.modelClass})`, ev,
    chipRow([['', `${r.totalTokens ?? '?'} tokens`], ['', `budget ${r.budget?.maxInputTokens ?? '?'}`], ev.retry ? ['amber', `retry ${ev.retry}`] : null, ev.escalations ? ['violet', `after ${ev.escalations} escalation${ev.escalations > 1 ? 's' : ''}`] : null, ['', `receipt ${String(ev.receiptHash).slice(0, 12)}`]]),
    rows.length ? h('table', { class: 't' }, h('thead', null, h('tr', null, ['Input', 'Trust label', 'Tokens', 'From', ''].map(x => h('th', null, x)))), h('tbody', null, rows)) : null,
    h('p', { class: 'note' }, 'Labels starting with "untrusted" mean the text derives from task data. It is fenced as data in the prompt and cannot grant authority.'));
}
function promptTurn(ev, journalId, open) {
  const call = app.data.calls?.[journalId];
  if (!call) return turn('prompt', 'Prompt (not in this export)', ev, h('p', { class: 'muted' }, 'The journal row for this call is not included.'));
  return turn('prompt', `Prompt sent to ${shortModel(call.modelId)}`, ev,
    chipRow([['', `attempt ${call.attempt}`], ['', `sample ${call.sampleIndex}`], ['', `mode ${call.mode ?? '?'}`], call.decoding ? ['', `reasoning ${call.decoding.reasoning ?? 'default'}`] : null, ['', `prompt ${String(call.promptHash).slice(0, 12)}`]]),
    details(`sys:${journalId}`, `System prompt (${call.system?.length ?? 0} characters)`, open, [codeBlock(call.system ?? '')]),
    h('p', { class: 'muted' }, 'User prompt (data blocks are fenced; the context receipt above is the authoritative list of inputs):'), codeBlock(call.prompt ?? '', 2500),
    call.schema ? details(`schema:${journalId}`, 'Required output schema', open, [codeBlock(call.schema)]) : null);
}
function replyTurn(ev, open) {
  const call = app.data.calls?.[ev.journalId], u = ev.usage ?? call?.usage ?? {};
  const who = ev.ok === false ? `Model call failed: ${ev.errorCode}` : `Reply from ${shortModel(ev.modelId)}`;
  return turn(ev.ok === false ? 'error' : 'reply', who, ev,
    chipRow([['', `${fmtDur(ev.latencyMs)}`], ['', `in ${u.inputTokens ?? '?'} / out ${u.outputTokens ?? '?'}`], u.cacheReadTokens ? ['', `cache read ${u.cacheReadTokens}`] : null, u.cacheWriteTokens ? ['', `cache write ${u.cacheWriteTokens}`] : null, ['', fmtCost(ev.costUsd)],
      ev.replayed ? ['amber', 'replayed from journal'] : ['', 'live call'], call?.costBasis ? ['', `cost basis ${call.costBasis}`] : null, ev.finishReason ? ['', `finish ${ev.finishReason}`] : null, call?.costUnknown ? ['amber', 'cost unknown'] : null]),
    call?.value !== undefined && call?.value !== null ? [h('p', { class: 'muted' }, 'Typed value (parsed against the required schema). Model output is untrusted data:'), codeBlock(call.value)] : null,
    call?.reply ? details(`raw:${ev.journalId}`, 'Raw reply text', open, [codeBlock(call.reply)]) : null);
}
function escalationTurn(ev, def, decisions) {
  const dec = decisions.find(x => x.features?.escalation === ev.escalation);
  return turn('escalate', `Escalated ${shortModel(ev.fromModel)} (${ev.fromClass}) to ${shortModel(ev.toModel)} (${ev.toClass})`, ev,
    h('p', null, ev.rule === 'E2' ? `Check failed. The reply was well-formed but did not satisfy this node's checks${def?.checks?.length ? ` (it has ${def.checks.length})` : ''}. The export cannot say which one: the runtime does not put the failing check in this event.` : `Rule ${ev.rule}: ${ev.errorCode}. The model could not produce a valid reply.`),
    chipRow([['violet', `rule ${ev.rule}`], ['', ev.errorCode], ['', `spent so far ${fmtCost(ev.costSoFar)}`], ['', `escalation ${ev.escalation}`]]), dec ? h('p', { class: 'note' }, `Decision record: ${dec.rationale}`) : null);
}
function outputTurn(ev, inst, def, open) {
  const out = outputOf(ev), failedChecks = inst.kind === 'verify' && out?.pass === false;
  const label = ev.outputLabel ?? 'trusted';
  const note = def?.checks?.length && inst.kind === 'agent' ? `All ${def.checks.length} output checks held.` : null;
  return turn(failedChecks ? 'check' : 'output', failedChecks ? 'Completed, but the verifier returned pass = false' : (inst.cont ? 'Completed' : 'Final output'), ev,
    chipRow([['', `output ${String(ev.outputHash).slice(0, 12)}`], ['', `${ev.outputBytes ?? '?'} bytes`], [/^untrusted/.test(label) ? 'untrusted' : '', `label ${label}`], ev.escalations ? ['violet', `escalated ${ev.escalations}x`] : null]), note ? h('p', null, note) : null,
    out === undefined ? h('p', { class: 'muted' }, 'Output not included in this export.') : codeBlock(out));
}
function errorTurn(ev) {
  const code = ev.error?.code, kind = C.classifyError(code);
  const why = { environment: 'Environment or provider fault. This is not model behaviour, so the runtime does not escalate or retry on a larger model.', budget: 'A budget stopped the run. Nothing was wrong with the node itself.', integrity: 'An integrity guard stopped the run. Do not resume it without reading the cause.',
    policy: 'A policy rule refused this operation.', cancelled: 'The run or its scope was cancelled.', check: 'A check or assertion failed.', exhausted: 'The model failed its checks and no larger permitted model was left to try.' }[kind];
  return turn('error', `Failed: ${code}`, ev, h('p', null, sanitizeDisplay(ev.error?.message ?? '').text), why ? h('p', { class: 'note' }, why) : null);
}
function receipts(inst) {
  const calls = inst.calls.map(id => app.data.calls?.[id]).filter(Boolean);
  const wrap = h('div');
  if (calls.length) wrap.append(h('table', { class: 't' }, h('thead', null, h('tr', null, ['Journal', 'Model', 'Provider / engine', 'Receipt', 'Cost'].map(x => h('th', null, x)))),
    h('tbody', null, calls.map(c => h('tr', null, h('td', null, c.id), h('td', null, shortModel(c.modelId)), h('td', null, `${c.provider ?? ''} ${c.engineVersion ?? ''}`), h('td', null, String(c.receiptHash).slice(0, 12)), h('td', null, fmtCost(c.costUsd)))))));
  wrap.append(h('p', { class: 'note' }, `Events for this node: ${inst.turns.filter(t => !t.derived).map(t => `#${t.seq}`).join(' ')}. Each event's hash is chained to the one before it; the chain was verified when the run was exported.`));
  return wrap;
}

// ------------------------------------------------------------------------------------------------ wiring
function setTheme(t) { document.documentElement.setAttribute('data-theme', t); $('theme').textContent = t === 'dark' ? 'Light theme' : 'Dark theme'; }
setTheme(matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
$('theme').addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
$('motion').addEventListener('click', e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); e.currentTarget.textContent = on ? 'Motion on' : 'Motion off'; document.documentElement.setAttribute('data-motion', on ? 'on' : 'off'); });
$('open').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ''; });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer?.files?.[0]) readFile(e.dataTransfer.files[0]); });
$('play').addEventListener('click', () => { app.playing ? pause() : play(); });
$('to-start').addEventListener('click', () => { pause(); seekIndex(-1); });
$('to-end').addEventListener('click', () => { pause(); seek(app.tl.dur); });
$('step').addEventListener('click', () => { pause(); seekIndex(app.idx + 1); });
$('step-back').addEventListener('click', () => { pause(); seekIndex(app.idx - 1); });
$('prev-note').addEventListener('click', () => jumpNotable(-1));
$('next-note').addEventListener('click', () => jumpNotable(1));
$('scrub').addEventListener('input', e => { pause(); seek(Number(e.target.value) / 1000 * app.tl.dur); });
$('speed').addEventListener('change', e => { app.speed = Number(e.target.value); });
$('compress').addEventListener('change', e => {
  if (!app.data) return;
  app.compress = e.target.checked; app.tl = C.buildTimeline(app.data.events, { compress: app.compress });
  drawTicks(); gotoIndex(app.idx);
});
$('detail').addEventListener('input', e => {
  app.level = 2 - Number(e.target.value); // slider right = simpler: 0 raw -> level 2, 1 normal -> level 1, 2 simple -> level 0
  $('detail-label').textContent = ['Raw', 'Normal', 'Simple'][Number(e.target.value)];
  e.target.setAttribute('aria-valuetext', $('detail-label').textContent);
  if (app.data) { const keep = app.trail?.[0]?.replace('root/', '').split(/[:/]/)[0]; buildGraph(); const id = keep && app.sem.rawTo.get(keep); if (id) { selectSem(id); } else closeDrawer(true); }
});
$('detail').value = 1; $('detail-label').textContent = 'Normal'; $('detail').setAttribute('aria-valuetext', 'Normal');
addEventListener('keydown', e => {
  if (e.target.closest?.('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey || !app.data) return;
  if (e.key === 'Escape' && app.semId) { closeDrawer(false); return; }
  if (e.key === 'p') { e.preventDefault(); $('play').click(); }
  else if (e.key === ',') $('step-back').click(); else if (e.key === '.') $('step').click(); else if (e.key === '[') $('prev-note').click(); else if (e.key === ']') $('next-note').click();
  else if (e.target.classList?.contains('card') && ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) moveFocus(e);
});
function moveFocus(e) {
  const id = e.target.dataset.id; let ci = app.cols.findIndex(c => c.includes(id)); if (ci < 0) return;
  let ri = app.cols[ci].indexOf(id);
  if (e.key === 'ArrowDown') ri++; else if (e.key === 'ArrowUp') ri--; else if (e.key === 'ArrowRight') ci++; else if (e.key === 'ArrowLeft') ci--; else if (e.key === 'Home') { ci = 0; ri = 0; } else { ci = app.cols.length - 1; ri = 0; }
  ci = Math.max(0, Math.min(app.cols.length - 1, ci)); ri = Math.max(0, Math.min(app.cols[ci].length - 1, ri));
  e.preventDefault(); app.cards.get(app.cols[ci][ri])?.el.focus();
}
new ResizeObserver(() => requestAnimationFrame(drawEdges)).observe($('graph'));
setInterval(() => { if (app.data && app.playing && !document.hidden) { const now = nowReal(); for (const card of app.cards.values()) if (C.ACTIVE.has(card.cache.state)) { const line = C.semLine(app.model, card.sem, now); if (line !== card.cache.line) { card.line.textContent = line; card.cache.line = line; } } } }, 250);

// A hatch pattern for the environment-fault dot (the one fill that is not a flat colour).
const defs = s('svg', { width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false', class: 'sr-only' }, s('defs', null, s('pattern', { id: 'hatch', width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, s('rect', { class: 'hatch-bg', width: 5, height: 5 }), s('line', { class: 'hatch-line', x1: 0, y1: 0, x2: 0, y2: 5 }))));
document.body.append(defs);

// A narrow test hook; it reads and drives the same state the controls do.
root.RunView = { app, load, seek, seekIndex, play, pause, selectSem, closeDrawer, setSpeed: v => { app.speed = v; $('speed').value = String(v); }, renderAll,
  state: () => ({ idx: app.idx, pos: app.pos, dur: app.tl?.dur, playing: app.playing, perf: { ...app.perf }, cards: [...app.cards.values()].map(c => ({ id: c.sem.id, label: c.sem.label, state: c.cache.state, line: c.cache.line })), run: { ...app.model?.run } }) };
loadFromPage().catch(error => showError(error.message));
}

})(globalThis);
