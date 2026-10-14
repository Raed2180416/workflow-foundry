// The E-bed host (G20; E-BED §2.1–§2.2, §2.7, §8.1 step 2; BED-CONTRACT-v1.1 §3–§4, §12). One host runs one arm over
// one world: a next-event simulated clock from t0 (with the go-live backlog delivered as migrations) to horizonEnd,
// per-instance case-ticks and host-scheduled sweep ticks in three rounds per instant, typed mock systems with keyed
// idempotency, an obligation scheduler, a human-task router with scripted actors and noise, a tagged fault injector,
// declared platform profiles, a persistent per-arm workspace and a hash-chained journal from which the run replays
// byte for byte. The host imports the world and the item's actors, schemas and spec; never the oracle.
//
// What the host never does, under any profile (E-BED §0 item 4, §2.2; contract §4.2): correlate events to cases by
// business meaning, deduplicate inbound events, compute deadlines or business time, enforce separation of duties beyond
// routing a task as the arm declared it, compensate, or fill a default for a renamed field. It uses world truth only to
// key the fault schedule and the actor policies (identical for every arm) and to label the journal for the analyst.
import { canonical, hashOf, sha256 } from '../../lib/canonical.mjs';
import { Agenda, MINUTE, SECOND, toMs, fmt, offsetMinutes, isIsoTime, eventOrder } from './time.mjs';
import { Journal, ReplayDivergence } from './journal.mjs';
import { MockSystem, MockError, effectSchemas, sorSchemas } from './mocks.mjs';
import { faultSchedule } from './faults.mjs';
import { profileOf, backoffSeconds, isRetryable, mayRetry } from './profiles.mjs';
import { planTask, checkNoise } from './actors.mjs';
import { validateCaseOutput, validateSweepOutput } from './output.mjs';
import { schemaProblems, plainCopy } from './schema.mjs';
import { Workspace } from './workspace.mjs';

export const HOST_VERSION = '1.0.0';

/** Thrown by an arm adapter when a real usage limit stops the stream: the clock freezes at the last committed wake-up. */
export class QuotaStop extends Error {
  constructor(message = 'quota stop') { super(message); this.name = 'QuotaStop'; this.quota = true; }
}
/** Thrown by an arm adapter for a real (untagged) environment fault; retried, then the case-tick is impaired. */
export class EnvFault extends Error {
  constructor(code = 'ENV_FAULT', message) { super(message ?? code); this.name = 'EnvFault'; this.env = true; this.code = code; }
}
export class HostError extends Error {
  constructor(message) { super(message); this.name = 'HostError'; this.code = 'HOST'; }
}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const pad = (n, w) => String(n).padStart(w, '0');

/** Normalise an item binding: { id, family, systems, schemas: { decisions?, humanTasks }, actors, specE, product? }. */
export function bindItem(item) {
  if (!item?.id) throw new HostError('item binding needs an id');
  const systems = item.systems ?? [];
  const ids = new Set();
  for (const s of systems) { if (ids.has(s.id)) throw new HostError(`two systems named ${s.id}`); ids.add(s.id); }
  const humanTasks = item.schemas?.humanTasks ?? {};
  if (!isObj(humanTasks)) throw new HostError('schemas.humanTasks must map kind -> description');
  if (item.schemas?.decisions && schemaProblems(item.schemas.decisions).length) throw new HostError('schemas.decisions is not portable');
  const specText = typeof item.specE === 'string' ? item.specE : item.specE?.text ?? '';
  return Object.freeze({
    id: item.id,
    family: item.family ?? {},
    systems,
    schemas: Object.freeze({ decisions: item.schemas?.decisions ?? null, humanTasks, effects: effectSchemas(systems), sor: sorSchemas(systems) }),
    actors: item.actors ?? {},
    specText,
    product: item.product ?? null,
  });
}

/** Structural checks on a world before any run (a malformed world is a bed bug, never an arm outcome). */
function checkWorld(world, systems) {
  for (const k of ['id', 't0', 'horizonEnd']) if (!world?.[k]) throw new HostError(`world.${k} missing`);
  if (!isIsoTime(world.t0) || !isIsoTime(world.horizonEnd)) throw new HostError('world.t0 / horizonEnd must be ISO times with offset');
  if (toMs(world.horizonEnd) <= toMs(world.t0)) throw new HostError('world.horizonEnd must be after t0');
  const ids = new Set();
  for (const [i, ev] of (world.arrivals ?? []).entries()) {
    if (!ev?.id || ids.has(ev.id)) throw new HostError(`world.arrivals[${i}]: missing or duplicate id`);
    ids.add(ev.id);
    if (!isIsoTime(ev.at)) throw new HostError(`world.arrivals[${i}].at: ISO time with offset`);
    if (!['inbound', 'world'].includes(ev.channel?.kind)) throw new HostError(`world.arrivals[${i}].channel: inbound or world (instances are arm-side)`);
    if (typeof ev.type !== 'string' || typeof ev.source !== 'string') throw new HostError(`world.arrivals[${i}]: type and source required`);
    if (ev.channel.kind === 'world' && typeof ev.sweep !== 'string') throw new HostError(`world.arrivals[${i}]: a world event names its sweep`);
  }
  const sysIds = new Set(systems.map(s => s.id));
  const tableOk = (qual, where) => {
    const [s, t] = String(qual).split('.');
    if (!sysIds.has(s) || !systems.find(x => x.id === s).def.tables[t]) throw new HostError(`${where}: unknown table ${qual}`);
  };
  for (const qual of Object.keys(world.sor ?? {})) tableOk(qual, 'world.sor');
  for (const [i, b] of (world.backlog ?? []).entries()) for (const qual of Object.keys(b.export?.records ?? {})) tableOk(qual, `world.backlog[${i}]`);
  for (const [i, w] of (world.writes ?? []).entries()) {
    if (!w?.id || !isIsoTime(w.at)) throw new HostError(`world.writes[${i}]: id and at required`);
    tableOk(`${w.system}.${w.table}`, `world.writes[${i}]`);
  }
  for (const [sweep, times] of Object.entries(world.sweepTimes ?? {})) for (const t of times) if (!isIsoTime(t)) throw new HostError(`world.sweepTimes.${sweep}: bad time`);
  checkNoise(world.noise ?? {});
}

/**
 * createHost({ item, world, arm, profile?, journalFile?, blobDir?, recorded?, mode?, concurrency?, callTimeoutMs?,
 *              envRetries?, maxWakeups?, productConfig?, workspaceDir? })
 *
 * `arm` = { id, tick(input, ctx) -> TickOutput, sweep?(input, ctx) -> SweepOutput, workspace?: { dir } }; ctx gives
 * `files` ({ path: text }), `query(table, filter)`, `status(system, key)`, `workspace` (a directory or null) and
 * `recordCost(row)` (rows taken from the model journal, never from the solver). `mode: 'replay'` answers every call from
 * `recorded` and fails if one is missing; with `recorded` in live mode (resume) recorded calls are replayed and the rest
 * go to the arm.
 */
export function createHost(options) { return new Host(options); }

class Host {
  constructor({ item, world, arm, profile, journalFile = null, blobDir = null, recorded = null, mode = 'live', concurrency = 1,
    callTimeoutMs = null, envRetries = 2, maxWakeups = 1_000_000, productConfig = null, workspaceDir = null, workspaceMaxBytes = undefined }) {
    this.item = bindItem(item);
    this.world = world;
    this.arm = arm ?? null;
    if (mode !== 'replay' && (!arm?.id || typeof arm.tick !== 'function')) throw new HostError('arm needs an id and a tick function');
    this.profile = profileOf(profile ?? this.item.family.profile ?? 'bare');
    if (this.profile.product && !this.item.product) throw new HostError('profile product needs an item product engine');
    this.mode = mode;
    this.concurrency = Math.max(1, concurrency | 0);
    this.callTimeoutMs = callTimeoutMs;
    this.envRetries = envRetries;
    this.maxWakeups = maxWakeups;
    this.productConfig = productConfig;
    this.journal = new Journal({ file: journalFile, recorded, blobDir });
    this.recordedCalls = new Map();
    for (const r of this.journal.recordedContent) if (r.type === 'call') this.recordedCalls.set(r.callId, r);
    if (mode === 'replay' && !recorded) throw new HostError('replay needs recorded rows');
    const recordedStart = this.journal.recordedContent.find(r => r.type === 'run.start');
    this.armId = arm?.id ?? recordedStart?.arm ?? null;
    if (recorded && recordedStart && arm?.id && recordedStart.arm !== arm.id) throw new HostError(`journal is for arm ${recordedStart.arm}, not ${arm.id}`);
    this.recordedComplete = this.journal.recordedContent.some(r => r.type === 'run.end');
    this.resuming = !!recorded && mode !== 'replay';

    this.systems = new Map(this.item.systems.map(def => [def.id, new MockSystem(def)]));
    checkWorld(world, [...this.systems.values()]);
    this.offset = offsetMinutes(world.t0);
    this.t0Ms = toMs(world.t0);
    this.horizonMs = toMs(world.horizonEnd);
    this.faults = faultSchedule(world, this.systems, toMs);
    for (const r of this.faults.renames) this.systems.get(r.system).addRename(r);

    // Truth is used only to key faults and actors and to label the journal (never to route or correct anything).
    this.objectCase = new Map();
    for (const [c, info] of Object.entries(world.truth?.cases ?? {})) if (typeof info?.subject === 'string') this.objectCase.set(info.subject, c);
    for (const [obj, c] of Object.entries(world.truth?.objectCase ?? {})) this.objectCase.set(obj, c);

    const wsDir = workspaceDir ?? arm?.workspace?.dir ?? null;
    this.workspace = wsDir ? new Workspace({ dir: wsDir, ...(workspaceMaxBytes ? { maxBytes: workspaceMaxBytes } : {}) }) : null;
    this.wsRestored = false;

    this.agenda = new Agenda();
    this.instances = new Map();
    this.sweeps = new Map();
    for (const s of this.item.family.sweeps ?? []) this.sweeps.set(s.id, { id: s.id, carry: null, tickIndex: 0, queue: [] });
    for (const id of Object.keys(world.sweepTimes ?? {})) if (!this.sweeps.has(id)) this.sweeps.set(id, { id, carry: null, tickIndex: 0, queue: [] });
    this.refIndex = new Map();
    this.pendingKeys = new Set();
    this.attempts = new Map();
    this.taskOrdinals = new Map();
    this.counters = { instance: 0, event: 0, emission: 0, wakeups: 0 };
    this.ledger = { provisional: [], committed: [] };
    this.lastCommittedMs = null;
    this.started = false;
    this.dead = false;
    this.staticCache = null;
  }

  // ---------------------------------------------------------------------------------------------------------------
  iso(ms) { return fmt(ms, this.offset); }
  hid() { return `h-${pad(++this.counters.event, 7)}`; }
  stage(type, content) { return this.journal.stage(type, content); }
  bindingOf(inst) {
    if (!inst) return null;
    if (inst.startedBy.kind === 'backlog') return this.world.backlog[inst.startedBy.index]?.case ?? null;
    return this.world.truth?.eventCase?.[inst.startedBy.eventId] ?? inst.startedBy.case ?? null;
  }
  caseOfArgs(opDef, args, item = null) {
    for (const a of opDef.subjectArgs) {
      const v = item && own(item, a) ? item[a] : args?.[a];
      if (typeof v === 'string' && this.objectCase.has(v)) return this.objectCase.get(v);
    }
    return null;
  }
  caseOfSubject(subject) { return typeof subject === 'string' && this.objectCase.has(subject) ? this.objectCase.get(subject) : null; }

  // ---------------------------------------------------------------------------------------------------------------
  /** Run to the horizon (or to a quota stop). Returns { status: 'complete' | 'frozen', digests, stats }. */
  async run() {
    if (this.dead) throw new HostError('this host was frozen; resume a new host from the journal');
    if (!this.started) this.#start();
    while (this.agenda.peek() && this.agenda.peek().atMs <= this.horizonMs) {
      if (++this.counters.wakeups > this.maxWakeups) throw new HostError(`more than ${this.maxWakeups} wake-ups`);
      const entries = this.agenda.popInstant();
      try {
        await this.#wakeup(entries);
      } catch (e) {
        if (e?.quota) return this.#freeze(e, entries[0].atMs);
        throw e;
      }
      this.#commit(entries[0].atMs);
      if (this.mode === 'replay' && !this.recordedComplete && this.journal.unverified === 0) {
        return { status: 'prefix-verified', digests: this.digests(), stats: this.stats() };
      }
    }
    this.#end();
    return { status: 'complete', digests: this.digests(), stats: this.stats() };
  }

  #commit(atMs) {
    this.stage('wakeup.commit', { at: this.iso(atMs), ledgerRows: this.ledger.committed.length + this.ledger.provisional.length });
    this.journal.commit();
    this.ledger.committed.push(...this.ledger.provisional);
    this.ledger.provisional = [];
    this.lastCommittedMs = atMs;
    this.#markResume();
  }

  /** On a resumed run, the first commit past the recorded prefix is preceded by a `run.resume` control row. */
  #markResume() {
    if (!this.resuming || this.journal.verifying) return;
    this.resuming = false;
    this.journal.control('run.resume', { at: this.lastCommittedMs === null ? null : this.iso(this.lastCommittedMs), host: HOST_VERSION });
  }

  #freeze(e, interruptedMs) {
    const discarded = this.journal.discard();
    const discardedCalls = discarded.filter(r => r.type === 'call').map(r => ({ callId: r.callId, costs: r.costs }));
    const extra = (e.discardedCalls ?? []).filter(c => !discardedCalls.some(d => d.callId === c.callId));
    this.journal.control('clock.freeze', {
      at: this.lastCommittedMs === null ? null : this.iso(this.lastCommittedMs), interruptedAt: this.iso(interruptedMs),
      reason: String(e.message ?? 'quota stop').slice(0, 300), discardedCalls: [...discardedCalls, ...extra],
    });
    this.dead = true;
    return { status: 'frozen', frozenAt: this.lastCommittedMs === null ? null : this.iso(this.lastCommittedMs), digests: null, stats: this.stats() };
  }

  #start() {
    this.started = true;
    const w = this.world;
    this.stage('run.start', { host: HOST_VERSION, item: this.item.id, world: { id: w.id, digest: hashOf(w) }, arm: this.armId,
      profile: this.profile.id, spec: sha256(this.item.specText), systems: this.item.systems.map(s => s.id), faults: this.faults.count, t0: w.t0, horizonEnd: w.horizonEnd });
    for (const [qual, rows] of Object.entries(w.sor ?? {})) for (const row of rows) this.#worldWrite(qual, row, 'initial');
    (w.backlog ?? []).forEach((b, i) => { for (const [qual, rows] of Object.entries(b.export?.records ?? {})) for (const row of rows) this.#worldWrite(qual, row, `backlog:${i}`); });
    for (const ev of w.arrivals ?? []) this.agenda.push({ kind: 'event', atMs: toMs(ev.at), phase: 1, source: ev.source, id: ev.id, event: ev });
    for (const wr of w.writes ?? []) this.agenda.push({ kind: 'write', atMs: toMs(wr.at), phase: 0, source: 'world', id: wr.id, write: wr });
    for (const [sweep, times] of Object.entries(w.sweepTimes ?? {})) for (const t of times) this.agenda.push({ kind: 'sweep', atMs: toMs(t), phase: 2, source: 'sweep', id: sweep, sweep });
    (w.backlog ?? []).forEach((b, i) => {
      const inst = this.#newInstance({ kind: 'backlog', index: i }, this.t0Ms, false);
      const ev = { id: `mig-${pad(i + 1, 5)}`, type: 'migration', at: w.t0, source: 'host', channel: { kind: 'instance', instance: inst.id },
        payload: { records: b.export?.records ?? {}, events: b.export?.events ?? [] } };
      this.agenda.push({ kind: 'event', atMs: this.t0Ms, phase: 1, source: ev.source, id: ev.id, event: ev });
    });
    this.journal.commit();
    this.#markResume();
  }

  #end() {
    const open = [...this.instances.values()].filter(i => !i.closed);
    this.stage('run.end', {
      at: this.world.horizonEnd,
      open: open.map(i => ({ instance: i.id, subject: i.subject, openedAt: this.iso(i.openedMs), lastTickAt: i.lastTickMs === null ? null : this.iso(i.lastTickMs), binding: this.bindingOf(i) })),
      obligations: open.flatMap(i => [...i.obligations.values()].map(o => ({ instance: i.id, id: o.id, kind: o.kind, dueAt: o.dueAt }))),
      tasks: open.flatMap(i => [...i.tasks.values()].filter(t => t.state === 'open' || t.state === 'timedOut').map(t => ({ instance: i.id, taskId: t.task.id, state: t.state }))),
      undeliveredWorldEvents: [...this.sweeps.values()].flatMap(s => s.queue.map(e => e.id)),
      pending: [...this.pendingKeys].sort(),
      digests: { sor: this.sorDigest(), ledger: hashOf(this.ledger.committed) },
    });
    this.journal.commit();
    if (this.mode === 'replay' && this.journal.unverified) throw new ReplayDivergence(this.journal.recordedContent.length - this.journal.unverified, this.journal.recordedContent.at(-this.journal.unverified), null);
  }

  #worldWrite(qual, row, source) {
    const [sys, table] = qual.split('.');
    const pk = this.systems.get(sys).write(table, row);
    this.stage('world.write', { system: sys, table, pk, source, row });
  }

  #newInstance(startedBy, atMs, inbound) {
    const inst = { id: `i-${pad(++this.counters.instance, 6)}`, startedBy, inbound, openedMs: atMs, lastTickMs: null, tickIndex: 0, carry: null,
      closed: false, subject: null, touched: new Map(), docs: new Map(), obligations: new Map(), tasks: new Map(), obVersion: 0 };
    this.instances.set(inst.id, inst);
    this.stage('instance.open', { instance: inst.id, startedBy, at: this.iso(atMs), binding: this.bindingOf(inst) });
    return inst;
  }

  // ---------------------------------------------------------------------------------------------------------------
  async #wakeup(entries) {
    const t = entries[0].atMs;
    this.nowMs = t;
    this.stage('wakeup', { at: this.iso(t), entries: entries.length });
    // Phase 0: host-internal work at this instant (world writes, platform retries, form rejections).
    for (const e of entries.filter(x => x.phase === 0)) {
      if (e.kind === 'write') this.#worldWrite(`${e.write.system}.${e.write.table}`, e.write.row, `write:${e.write.id}`);
      else if (e.kind === 'retry') this.#attempt(e.emission, 'platform-retry');
      else if (e.kind === 'form') this.stage('form.rejected', { instance: e.instance, ...e.payload });
    }
    // Phase 1: deliveries, materialised then ordered by (at, source, id).
    const deliveries = [];
    for (const e of entries.filter(x => x.phase === 1)) {
      if (e.kind === 'event') deliveries.push(e.event);
      else if (e.kind === 'obligation') {
        const inst = this.instances.get(e.instance);
        const ob = inst?.obligations.get(e.obligationId);
        if (!inst || inst.closed || !ob || ob.version !== e.version) continue;
        inst.obligations.delete(e.obligationId);
        deliveries.push({ id: this.hid(), type: 'timer.fired', at: this.iso(t), source: 'timer', channel: { kind: 'instance', instance: inst.id },
          payload: { obligationId: ob.id, kind: ob.kind, anchor: ob.anchor ?? null, onDue: ob.onDue ?? null, dueAt: ob.dueAt } });
      } else if (e.kind === 'task') {
        const inst = this.instances.get(e.instance);
        const st = inst?.tasks.get(e.taskId);
        if (!st || st.version !== e.version) continue;
        if (st.state === 'closed') continue;
        if (e.event.type === 'humanTask.timeout') { if (st.state !== 'open') continue; st.state = 'timedOut'; }
        else if (['humanTask.answered', 'humanTask.answerRejected', 'humanTask.withdrawn'].includes(e.event.type)) st.state = 'closed';
        deliveries.push(e.event);
      }
    }
    deliveries.sort(eventOrder);
    const round1 = new Map();
    const add = (map, inst, ev) => { if (!map.has(inst.id)) map.set(inst.id, []); map.get(inst.id).push(ev); };
    for (const ev of deliveries) {
      if (ev.channel.kind === 'instance') {
        const inst = this.instances.get(ev.channel.instance);
        if (!inst || inst.closed) { this.stage('delivery.dropped', { event: ev, reason: inst ? 'instance-closed' : 'no-instance' }); continue; }
        this.stage('deliver', { event: ev, instance: inst.id });
        add(round1, inst, ev);
      } else if (ev.channel.kind === 'inbound') {
        const ref = ev.payload?.ref;
        const target = typeof ref === 'string' && this.refIndex.has(ref) ? this.instances.get(this.refIndex.get(ref)) : null;
        if (target && !target.closed) { this.stage('deliver', { event: ev, instance: target.id, route: 'ref' }); add(round1, target, ev); continue; }
        const inst = this.#newInstance({ kind: 'event', eventId: ev.id, ...(ev.case ? { case: ev.case } : {}) }, t, true);
        this.stage('deliver', { event: ev, instance: inst.id, route: 'start' });
        add(round1, inst, ev);
      } else if (ev.channel.kind === 'world') {
        const sw = this.sweeps.get(ev.sweep);
        if (!sw) { this.stage('delivery.dropped', { event: ev, reason: 'no-sweep' }); continue; }
        this.stage('deliver', { event: ev, sweep: sw.id });
        sw.queue.push(ev);
      }
    }
    // Round 1: case-ticks, in order of first delivery.
    const merges = new Map();
    await this.#caseRound(1, round1, merges);
    // Round 2: sweep ticks due now, in sweep-id order.
    const due = [...new Set(entries.filter(x => x.phase === 2).map(x => x.sweep))].sort();
    const wakes = await this.#sweepRound(due);
    // Round 3: merge targets and sweep wakes, each at most once; they can neither merge nor wake.
    const round3 = new Map();
    for (const [target, evs] of merges) { const inst = this.instances.get(target); if (inst && !inst.closed) for (const ev of evs) add(round3, inst, ev); }
    for (const [instId, sweep] of wakes) {
      const inst = this.instances.get(instId);
      if (!inst || inst.closed) continue;
      add(round3, inst, { id: this.hid(), type: 'sweep.wake', at: this.iso(t), source: 'sweep', channel: { kind: 'instance', instance: inst.id }, payload: { sweep } });
    }
    for (const [instId, evs] of round3) for (const ev of evs) this.stage('deliver', { event: ev, instance: instId, round: 3 });
    await this.#caseRound(3, round3, null);
  }

  // ---------------------------------------------------------------------------------------------------------------
  armEvent(ev, inst) {
    const out = { id: ev.id, type: ev.type, at: ev.at, source: ev.source, channel: ev.channel, payload: ev.payload ?? {} };
    if (typeof ev.doc === 'string') { out.docFile = `docs/${ev.id}.txt`; inst?.docs.set(ev.id, ev.doc); }
    return out;
  }

  #staticFiles() {
    const now = this.nowMs;
    const editions = (this.world.rulebook?.editions ?? []).filter(e => e.published !== null && e.published !== undefined && toMs(e.published) <= now);
    const renames = [...this.systems.values()].map(s => s.renames.filter(r => r.atMs <= now).length).join(',');
    const key = `${editions.map(e => e.id).join('|')}#${renames}`;
    if (this.staticCache?.key === key) return this.staticCache;
    const files = {};
    if (this.item.specText) files['spec/SPEC-E.md'] = this.item.specText;
    for (const [t, rows] of Object.entries(this.world.master ?? {})) files[`master/${t}.json`] = JSON.stringify(rows, null, 1);
    for (const [id, cal] of Object.entries(this.world.calendars ?? {})) files[`calendar/${id}.json`] = JSON.stringify(cal, null, 1);
    for (const ed of editions) for (const [p, text] of Object.entries(ed.files ?? {})) files[`rulebook/${ed.id}/${p}`] = text;
    for (const s of this.systems.values()) files[`api/${s.id}.schema.json`] = JSON.stringify(s.apiSchema(now), null, 1);
    const digests = Object.fromEntries(Object.entries(files).map(([p, text]) => [p, sha256(text)]));
    this.staticCache = { key, files, digests };
    return this.staticCache;
  }

  #sorFile(inst) {
    const includeComputed = this.profile.product;
    const out = {};
    const put = (sys, table, pk) => {
      const row = this.systems.get(sys)?.get(table, pk, includeComputed);
      if (!row) return;
      const q = `${sys}.${table}`;
      (out[q] ??= {})[pk] = row;
    };
    for (const k of [...inst.touched.keys()].sort()) { const [sys, table, pk] = inst.touched.get(k); put(sys, table, pk); }
    const key = this.item.family.subject?.key;
    if (key && typeof inst.subject === 'string') for (const s of this.systems.values()) for (const [t, def] of Object.entries(s.def.tables)) if (def.pk === key && !def.hidden) put(s.id, t, inst.subject);
    return Object.fromEntries(Object.entries(out).sort().map(([q, rows]) => [q, Object.keys(rows).sort().map(k => rows[k])]));
  }

  #filesFor(inst, events) {
    const st = this.#staticFiles();
    const files = { ...st.files };
    const digests = { ...st.digests };
    const dyn = {};
    if (inst) dyn[`sor/${inst.id}.json`] = JSON.stringify(this.#sorFile(inst), null, 1);
    const docs = inst ? inst.docs : new Map(events.filter(e => typeof e.doc === 'string').map(e => [e.id, e.doc]));
    for (const [id, text] of docs) dyn[`docs/${id}.txt`] = text;
    for (const [p, text] of Object.entries(dyn)) { files[p] = text; digests[p] = sha256(text); }
    return { files, digest: hashOf(digests) };
  }

  /** The open-instance index (the sweep input's `index`): instance, the arm's own declared subject, times. */
  index(subject) {
    return [...this.instances.values()].filter(i => !i.closed && (subject === undefined || i.subject === subject))
      .map(i => ({ instance: i.id, subject: i.subject, openedAt: this.iso(i.openedMs), lastTickAt: i.lastTickMs === null ? null : this.iso(i.lastTickMs) }));
  }

  #ctxFor(files) {
    const includeComputed = this.profile.product;
    const systems = this.systems;
    const pending = this.pendingKeys;
    const index = this.index(undefined);
    return {
      files,
      // Read-only, as of the round start: open instances, matched only on the subject the arm itself declared.
      instances(filter = {}) { return index.filter(r => filter?.subject === undefined || r.subject === filter.subject).map(r => ({ ...r })); },
      query(table, filter = {}) {
        const [sys, t] = String(table).split('.');
        const s = systems.get(sys);
        if (!s) throw new MockError(404, 'no-such-table', { table });
        return s.query(t, plainCopy(filter) ?? {}, includeComputed);
      },
      status(system, key) {
        const s = systems.get(system);
        if (!s) throw new MockError(404, 'no-such-system', { system });
        return s.keyStatus(String(key), pending);
      },
    };
  }

  async #invoke(kind, target, round, input, files) {
    const callId = `${input.now}|r${round}|${kind}|${target}`;
    const inputDigest = hashOf({ input, files: files.digest });
    const recorded = this.recordedCalls.get(callId);
    if (recorded) {
      if (recorded.inputDigest !== inputDigest) throw new ReplayDivergence(-1, recorded, { type: 'call', callId, inputDigest });
      if (recorded.workspace && this.workspace && this.mode !== 'replay') this.lastWorkspace = recorded.workspace;
      return recorded;
    }
    if (this.mode === 'replay') throw new ReplayDivergence(-1, null, { type: 'call', callId, inputDigest });
    if (this.workspace && !this.wsRestored) { this.#restoreWorkspace(); }
    const costs = [], envFaults = [];
    const ctx = { ...this.#ctxFor(files.files), workspace: this.workspace?.dir ?? null, recordCost: row => { const c = plainCopy(row); if (c !== undefined) costs.push(c); } };
    const fn = kind === 'case' ? this.arm.tick : this.arm.sweep;
    let outcome = 'ok', output, error = null;
    if (typeof fn !== 'function') { outcome = 'error'; error = { code: 'no-sweep-solver' }; }
    else {
      for (let attempt = 0; ; attempt++) {
        try {
          output = await this.#withTimeout(Promise.resolve().then(() => fn.call(this.arm, structuredClone(input), ctx)));
          output = plainCopy(output);
          if (output === undefined) { outcome = 'error'; error = { code: 'not-json' }; }
          break;
        } catch (e) {
          if (e?.quota) { e.discardedCalls = [...(e.discardedCalls ?? []), { callId, costs }]; throw e; }
          if (e?.env) {
            envFaults.push({ attempt, code: String(e.code ?? 'ENV_FAULT') });
            if (attempt < this.envRetries) continue;
            outcome = 'error'; error = { code: 'impaired', detail: String(e.code ?? 'ENV_FAULT') };
            break;
          }
          outcome = 'error'; error = { code: e?.timeout ? 'timeout' : 'crash', detail: String(e?.message ?? e).slice(0, 500) };
          break;
        }
      }
    }
    const rec = { type: 'call', callId, kind, target, round, at: input.now, inputDigest, outcome, ...(outcome === 'ok' ? { output } : { error }), costs, envFaults };
    if (this.workspace) {
      const snap = this.workspace.snapshot(this.journal);
      if (snap.oversize || snap.problems.length) {
        if (this.lastWorkspace) this.workspace.restore(this.#manifest(this.lastWorkspace.digest), this.journal); else this.workspace.restore({}, this.journal);
        rec.outcome = 'error'; delete rec.output;
        rec.error = { code: snap.oversize ? 'workspace-oversize' : 'workspace-forbidden', detail: snap.oversize ? `${snap.bytes} bytes` : snap.problems.slice(0, 4).join('; ') };
        rec.workspace = this.lastWorkspace ?? { digest: hashOf({}), bytes: 0, files: 0 };
      } else {
        this.journal.putBlob(snap.digest, Buffer.from(canonical(snap.manifest)));
        rec.workspace = { digest: snap.digest, bytes: snap.bytes, files: snap.files };
      }
      this.lastWorkspace = rec.workspace;
    }
    return rec;
  }

  #manifest(digest) {
    const blob = this.journal.getBlob(digest);
    if (!blob) throw new HostError(`workspace manifest ${digest} not in the blob store`);
    return JSON.parse(blob.toString('utf8'));
  }

  /** Before the first live call: the workspace holds exactly the last committed snapshot (or nothing on a fresh run). */
  #restoreWorkspace() {
    this.wsRestored = true;
    this.workspace.restore(this.lastWorkspace ? this.#manifest(this.lastWorkspace.digest) : {}, this.journal);
  }

  #withTimeout(promise) {
    if (!this.callTimeoutMs) return promise;
    let timer;
    const t = new Promise((_, reject) => { timer = setTimeout(() => { const e = new Error('call timeout'); e.timeout = true; reject(e); }, this.callTimeoutMs); });
    return Promise.race([promise, t]).finally(() => clearTimeout(timer));
  }

  /** Run calls with a bounded pool; results come back in spec order whatever the completion order. */
  async #pool(specs) {
    const out = new Array(specs.length);
    let next = 0, quota = null;
    const discarded = [];
    const worker = async () => {
      while (next < specs.length && !quota) {
        const i = next++;
        try { out[i] = await specs[i](); }
        catch (e) { if (e?.quota) { quota ??= e; discarded.push(...(e.discardedCalls ?? [])); } else throw e; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, specs.length) }, worker));
    if (quota) {
      // Calls that completed in this round are discarded with the wake-up; their costs still reach the freeze record.
      quota.discardedCalls = [...out.filter(Boolean).map(r => ({ callId: r.callId, costs: r.costs })), ...discarded];
      throw quota;
    }
    return out;
  }

  async #caseRound(round, map, merges) {
    if (!map.size) return;
    const work = [...map.entries()].map(([instId, evs]) => {
      const inst = this.instances.get(instId);
      const events = evs.map(ev => this.armEvent(ev, inst));
      const input = { kind: 'case', item: this.item.id, world: this.world.publicId ?? this.world.id, instance: inst.id, now: this.iso(this.nowMs), events, carry: inst.carry };
      const files = this.#filesFor(inst, evs);
      return { inst, evs, tickIndex: inst.tickIndex, run: () => this.#invoke('case', inst.id, round, input, files) };
    });
    const recs = await this.#pool(work.map(w => w.run));
    work.forEach((w, i) => this.#applyCase(w, recs[i], round, merges));
    this.#product();
  }

  async #sweepRound(due) {
    const wakes = new Map();
    if (!due.length) return wakes;
    const work = due.map(id => {
      const sw = this.sweeps.get(id);
      const evs = sw.queue.splice(0);
      const index = this.index(undefined);
      const input = { kind: 'sweep', item: this.item.id, world: this.world.publicId ?? this.world.id, sweep: id, now: this.iso(this.nowMs), index, events: evs.map(ev => this.armEvent(ev, null)), carry: sw.carry };
      const files = this.#filesFor(null, evs);
      return { sw, evs, run: () => this.#invoke('sweep', id, 2, input, files) };
    });
    const recs = await this.#pool(work.map(w => w.run));
    work.forEach((w, i) => {
      const rec = recs[i];
      this.stage('call', rec);
      w.sw.tickIndex++;
      if (rec.outcome !== 'ok') { this.stage('arm.error', { sweep: w.sw.id, code: rec.error.code, detail: rec.error.detail ?? null }); return; }
      const { errors, output } = validateSweepOutput(rec.output, { schemas: this.item.schemas, instances: this.instances });
      if (errors.length) { this.stage('arm.error', { sweep: w.sw.id, code: 'invalid-output', detail: errors }); return; }
      this.#emit(output.effects ?? [], { kind: 'sweep', sweep: w.sw.id });
      for (const id of output.wake ?? []) if (!wakes.has(id)) wakes.set(id, w.sw.id);
      w.sw.carry = output.carry ?? null;
      this.stage('carry.commit', { sweep: w.sw.id, tickIndex: w.sw.tickIndex, digest: hashOf(w.sw.carry) });
    });
    this.#product();
    return wakes;
  }

  #applyCase({ inst, evs, tickIndex }, rec, round, merges) {
    this.stage('call', rec);
    if (inst.tickIndex !== tickIndex) throw new HostError(`carry CAS failed on ${inst.id}`);   // one writer per instance
    inst.tickIndex++;
    inst.lastTickMs = this.nowMs;
    const armError = (code, detail) => {
      this.stage('arm.error', { instance: inst.id, code, detail: detail ?? null, binding: this.bindingOf(inst) });
      this.stage('carry.lost', { instance: inst.id, tickIndex: inst.tickIndex });
    };
    if (rec.outcome !== 'ok') return armError(rec.error.code, rec.error.detail);
    const { errors, output: out } = validateCaseOutput(rec.output, { schemas: this.item.schemas, round, inbound: inst.inbound, instances: this.instances, self: inst.id });
    if (errors.length) return armError('invalid-output', errors);
    inst.subject = out.decisions.subject;
    this.#emit(out.effects ?? [], { kind: 'case', instance: inst.id });
    for (const id of out.obligations?.cancel ?? []) {
      if (inst.obligations.delete(id)) this.stage('obligation.cancel', { instance: inst.id, id });
      else this.stage('obligation.cancel', { instance: inst.id, id, unknown: true });
    }
    for (const ob of out.obligations?.upsert ?? []) this.#upsertObligation(inst, ob);
    for (const task of out.humanTasks ?? []) this.#createTask(inst, task);
    if (out.merge) {
      this.stage('instance.merge', { instance: inst.id, into: out.merge.into, events: evs.map(e => e.id) });
      merges.set(out.merge.into, [...(merges.get(out.merge.into) ?? []), ...evs]);
      this.#close(inst, 'merged');
    }
    if (out.close && !inst.closed) this.#close(inst, 'closed');
    inst.carry = out.carry ?? null;
    this.stage('carry.commit', { instance: inst.id, tickIndex: inst.tickIndex, digest: hashOf(inst.carry) });
  }

  #close(inst, reason) {
    inst.closed = true;
    const dropped = [...inst.obligations.keys()];
    inst.obligations.clear();
    for (const st of inst.tasks.values()) if (st.state !== 'closed') st.state = 'closed';
    this.stage('instance.close', { instance: inst.id, reason, droppedObligations: dropped });
  }

  #upsertObligation(inst, ob) {
    const dueMs = toMs(ob.dueAt);
    const clamped = dueMs <= this.nowMs;
    const fireMs = clamped ? this.nowMs + MINUTE : dueMs;
    const version = ++inst.obVersion;
    inst.obligations.set(ob.id, { ...ob, version });
    this.stage('obligation.upsert', { instance: inst.id, id: ob.id, kind: ob.kind, dueAt: ob.dueAt, firesAt: this.iso(fireMs), ...(clamped ? { clamped: true } : {}) });
    this.agenda.push({ kind: 'obligation', atMs: fireMs, phase: 1, source: 'timer', id: `${inst.id}/${ob.id}/${version}`, instance: inst.id, obligationId: ob.id, version });
  }

  #createTask(inst, task) {
    const cur = inst.tasks.get(task.id);
    if (cur && cur.state !== 'closed') { this.stage('humanTask.duplicate', { instance: inst.id, taskId: task.id }); return; }
    const c = this.caseOfSubject(task.subject);
    const ordKey = `${c}\u0000${task.role}\u0000${task.kind}`;
    const ordinal = c === null ? 0 : (this.taskOrdinals.get(ordKey) ?? 0) + 1;
    if (c !== null) this.taskOrdinals.set(ordKey, ordinal);
    const dueMsRaw = toMs(task.dueAt);
    const dueMs = dueMsRaw <= this.nowMs ? this.nowMs + MINUTE : dueMsRaw;
    const plan = planTask({ world: this.world, actors: this.item.actors, task, kinds: this.item.schemas.humanTasks, c, ordinal, createdMs: this.nowMs, dueMs, iso: ms => this.iso(ms) });
    const version = (cur?.version ?? 0) + 1;
    inst.tasks.set(task.id, { task, state: 'open', version, plan });
    this.stage('humanTask.created', { instance: inst.id, task, case: c, ordinal, user: plan.user, noAnswer: plan.noAnswer ?? null, noise: plan.noise, form: plan.form ?? null,
      ...(dueMsRaw <= this.nowMs ? { dueClamped: true } : {}), steps: plan.steps.map(s => ({ at: this.iso(s.atMs), type: s.type })) });
    for (const s of plan.steps) {
      if (s.type === 'form.rejected') { this.agenda.push({ kind: 'form', atMs: s.atMs, phase: 0, source: 'actor', id: `${inst.id}/${task.id}/${version}/form`, instance: inst.id, payload: s.payload }); continue; }
      const ev = { id: this.hid(), type: s.type, at: this.iso(s.atMs), source: 'actor', channel: { kind: 'instance', instance: inst.id }, payload: s.payload };
      this.agenda.push({ kind: 'task', atMs: s.atMs, phase: 1, source: ev.source, id: ev.id, instance: inst.id, taskId: task.id, version, event: ev });
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Effects: emission -> attempt(s) -> ledger rows -> one result event. `after` defers on the named effect of the same
  // output; under temporal-like a retryable outcome is re-issued by the platform and the result waits for the final one.
  #emit(effects, origin) {
    const byKey = new Map();
    for (const eff of effects) {
      const em = { id: `em-${pad(++this.counters.emission, 7)}`, eff, origin, attempts: 0, state: 'new', dependents: [], tags: [] };
      if (eff.key) byKey.set(eff.key, em);
      this.stage('effect.emit', { emission: em.id, origin, effect: eff });
      if (eff.after) {
        const pred = byKey.get(eff.after);
        if (pred.state === 'failed') { this.#skip(em, 'predecessor-failed'); continue; }
        if (pred.state === 'pending') {
          em.state = 'pending'; pred.dependents.push(em);
          if (eff.key) this.pendingKeys.add(`${eff.system}\u0000${eff.key}`);
          this.stage('effect.deferred', { emission: em.id, after: pred.id });
          continue;
        }
      }
      this.#attempt(em, 'arm');
    }
  }

  #originChannel(origin) {
    return origin.kind === 'case' ? { kind: 'instance', instance: origin.instance } : { kind: 'world' };
  }

  #scheduleResult(em, sys, payload, injected) {
    const atMs = this.nowMs + sys.def.latencyMinutes * MINUTE;
    const ev = { id: this.hid(), type: 'effect.result', at: this.iso(atMs), source: sys.id, channel: this.#originChannel(em.origin), payload, ...(injected ? { injected: true } : {}) };
    if (em.origin.kind === 'sweep') ev.sweep = em.origin.sweep;
    this.agenda.push({ kind: 'event', atMs, phase: 1, source: ev.source, id: ev.id, event: ev });
    this.stage('effect.result', { emission: em.id, event: ev.id, at: ev.at, status: payload.status, ...(injected ? { injected: true } : {}) });
  }

  #resolve(em, state) {
    em.state = state;
    if (em.eff.key) this.pendingKeys.delete(`${em.eff.system}\u0000${em.eff.key}`);
    const deps = em.dependents.splice(0);
    for (const d of deps) {
      if (d.eff.key) this.pendingKeys.delete(`${d.eff.system}\u0000${d.eff.key}`);
      if (state === 'committed') { d.state = 'new'; this.#attempt(d, 'arm-deferred'); }
      else this.#skip(d, 'predecessor-failed');
    }
  }

  #skip(em, reason) {
    const sys = this.systems.get(em.eff.system);
    this.stage('effect.skipped', { emission: em.id, reason });
    this.#scheduleResult(em, sys, { key: em.eff.key ?? null, system: em.eff.system, op: em.eff.op, status: 'error', error: { code: reason } }, false);
    this.#resolve(em, 'failed');
  }

  #ledgerRow(em, extra) {
    const inst = em.origin.kind === 'case' ? this.instances.get(em.origin.instance) : null;
    const row = { world: this.world.id, arm: this.armId, ...(em.origin.kind === 'case' ? { instance: em.origin.instance } : { sweep: em.origin.sweep }),
      at: this.iso(this.nowMs), system: em.eff.system, op: em.eff.op, emission: em.id, attempt: em.attempts, ...extra };
    if (row.subjectCase === undefined) row.subjectCase = this.bindingOf(inst);
    this.ledger.provisional.push(row);
    this.stage('ledger', row);
    return row;
  }

  #touch(em, sys, touched) {
    if (em.origin.kind !== 'case') return;
    const inst = this.instances.get(em.origin.instance);
    for (const [table, pk] of touched) inst.touched.set(`${sys.id}\u0000${table}\u0000${typeof pk}:${pk}`, [sys.id, table, pk]);
  }

  #counterparty(em, sys, c, ordinal, result, args) {
    if (em.origin.kind === 'case' && typeof args?.ref === 'string') { this.refIndex.set(args.ref, em.origin.instance); this.stage('ref.placed', { ref: args.ref, instance: em.origin.instance }); }
    const fn = this.item.actors?.counterparty;
    if (typeof fn !== 'function') return;
    let reaction = fn(this.world, { case: c, effect: { system: sys.id, op: em.eff.op, args, key: em.eff.key ?? null }, result, at: this.iso(this.nowMs), ordinal });
    if (!reaction) return;
    if (Array.isArray(reaction)) reaction = { events: reaction };
    for (const r of reaction.events ?? []) {
      const delay = Math.max(1, Math.floor(r.delayMinutes ?? 1));
      const atMs = this.nowMs + delay * MINUTE;
      const payload = { ...(r.payload ?? {}) };
      if (r.quoteRef && typeof args?.ref === 'string') payload.ref = args.ref;
      const ev = { id: this.hid(), type: String(r.type), at: this.iso(atMs), source: String(r.source ?? sys.id), channel: r.channel === 'world' ? { kind: 'world' } : { kind: 'inbound' }, payload,
        ...(typeof r.doc === 'string' ? { doc: r.doc } : {}), ...(r.channel === 'world' ? { sweep: String(r.sweep) } : {}) };
      this.stage('counterparty.event', { event: ev, case: c, cause: em.id });
      this.agenda.push({ kind: 'event', atMs, phase: 1, source: ev.source, id: ev.id, event: ev });
    }
    for (const w of reaction.writes ?? []) {
      const atMs = this.nowMs + Math.max(1, Math.floor(w.delayMinutes ?? 1)) * MINUTE;
      const wr = { id: this.hid(), at: this.iso(atMs), system: w.system, table: w.table, row: w.row };
      this.stage('counterparty.write', { write: wr, case: c, cause: em.id });
      this.agenda.push({ kind: 'write', atMs, phase: 0, source: 'world', id: wr.id, write: wr });
    }
  }

  #attempt(em, via) {
    const { eff } = em;
    const sys = this.systems.get(eff.system);
    const op = sys.def.ops[eff.op];
    em.attempts++;
    if (op.readOnly) {
      const r = sys.read(eff.op, eff.args, this.nowMs, this.pendingKeys);
      this.stage('read', { emission: em.id, system: eff.system, op: eff.op, status: r.status });
      this.#scheduleResult(em, sys, { key: eff.key ?? null, system: eff.system, op: eff.op, status: r.status, ...(r.result ? { result: r.result } : {}), ...(r.error ? { error: r.error } : {}) }, false);
      return this.#resolve(em, r.status === 'ok' ? 'committed' : 'failed');
    }
    if (op.batch) return this.#attemptBatch(em, sys, op, via);
    const inst = em.origin.kind === 'case' ? this.instances.get(em.origin.instance) : null;
    const c = this.caseOfArgs(op, eff.args) ?? this.bindingOf(inst);
    const ordKey = `${c}\u0000${eff.system}\u0000${eff.op}`;
    const ordinal = (this.attempts.get(ordKey) ?? 0) + 1;
    this.attempts.set(ordKey, ordinal);
    const fault = this.faults.lookup(c, eff.system, eff.op, ordinal);
    const r = sys.apply(eff.op, eff.args, eff.key ?? null, this.nowMs, { fault: fault?.kind ?? null, ctx: { now: this.iso(this.nowMs) } });
    const tags = [];
    if (fault && ['F1', 'F2', 'F3', 'F6'].includes(fault.kind)) tags.push(fault.kind);
    if (r.error?.reason === 'field-renamed') tags.push('F5');
    const injected = tags.length > 0;
    if (r.deduped && !injected) {
      this.stage('effect.deduped', { emission: em.id, system: eff.system, op: eff.op, key: eff.key, via, status: r.status });
    } else {
      this.#ledgerRow(em, { key: eff.key ?? null, argsDigest: hashOf(eff.args), subjectCase: c, ordinal, committed: r.committed, status: r.status,
        ...(r.error ? { error: { code: r.error.code, reason: r.error.reason } } : {}), faultTags: tags, ...(injected ? { injected: true } : {}), via,
        ...(op.money ? { money: true } : {}), ...(r.deduped ? { deduped: true } : {}) });
    }
    if (r.committed) { this.#touch(em, sys, r.touched); this.#counterparty(em, sys, c, ordinal, r.result, eff.args); }
    if (injected) em.tags.push(...tags);
    const retry = this.profile.retry;
    if (retry && isRetryable(r) && mayRetry(retry, em.attempts)) {
      const secs = backoffSeconds(retry, em.attempts);
      const atMs = this.nowMs + secs * SECOND;
      em.state = 'pending';
      if (eff.key) this.pendingKeys.add(`${eff.system}\u0000${eff.key}`);
      this.stage('platform.retry', { emission: em.id, attempt: em.attempts, afterSeconds: secs, at: this.iso(atMs), status: r.status });
      this.agenda.push({ kind: 'retry', atMs, phase: 0, source: 'platform', id: `${em.id}#${em.attempts + 1}`, emission: em });
      return;
    }
    const payload = { key: eff.key ?? null, system: eff.system, op: eff.op, status: r.status, ...(r.result && r.status === 'ok' ? { result: r.result } : {}),
      ...(r.error ? { error: r.error } : {}), ...(r.status === 'rate-limited' ? { retryAfter: fault?.params?.retryAfterSeconds ?? 60 } : {}),
      ...(em.attempts > 1 ? { attempts: em.attempts } : {}) };
    this.#scheduleResult(em, sys, payload, injected);
    this.#resolve(em, r.committed || r.deduped ? 'committed' : 'failed');
  }

  #attemptBatch(em, sys, op, via) {
    const { eff } = em;
    let args;
    try { args = sys.normaliseArgs(eff.op, eff.args, this.nowMs); }
    catch (e) {
      if (!(e instanceof MockError)) throw e;
      const tags = e.reason === 'field-renamed' ? ['F5'] : [];
      const inst = em.origin.kind === 'case' ? this.instances.get(em.origin.instance) : null;
      this.#ledgerRow(em, { key: null, argsDigest: hashOf(eff.args), subjectCase: this.bindingOf(inst), committed: false, status: 'error', error: { code: e.code, reason: e.reason }, faultTags: tags, ...(tags.length ? { injected: true } : {}), via, batchIndex: null });
      this.#scheduleResult(em, sys, { key: null, system: eff.system, op: eff.op, status: 'error', error: { code: e.code, reason: e.reason, ...e.detail } }, tags.length > 0);
      return this.#resolve(em, 'failed');
    }
    const items = [];
    let anyInjected = false;
    const outcomes = [];
    args.items.forEach((item, index) => {
      const inst = em.origin.kind === 'case' ? this.instances.get(em.origin.instance) : null;
      const c = this.caseOfArgs(op, args, item) ?? this.bindingOf(inst);
      const ordKey = `${c}\u0000${eff.system}\u0000${eff.op}`;
      const ordinal = (this.attempts.get(ordKey) ?? 0) + 1;
      this.attempts.set(ordKey, ordinal);
      const fault = this.faults.lookup(c, eff.system, eff.op, ordinal);
      const key = typeof item.key === 'string' ? item.key : null;
      const kind = fault?.kind ?? null;
      let r;
      if (kind === 'F1' || kind === 'F2' || kind === 'F6') r = sys.apply(eff.op, {}, null, this.nowMs, { fault: kind });   // transport outcome only
      else r = sys.applyItem(eff.op, item, args, key, this.nowMs, { fault: kind === 'F4' ? 'F4' : null, ctx: { now: this.iso(this.nowMs) } });
      if (kind === 'F3') r = { ...r, status: 'unknown', result: undefined, error: { code: 'timeout', reason: 'timeout-after-commit' } };
      const tags = kind ? [kind] : [];
      if (tags.length) anyInjected = true;
      if (r.deduped && !tags.length) this.stage('effect.deduped', { emission: em.id, system: eff.system, op: eff.op, key, via, batchIndex: index, status: r.status });
      else this.#ledgerRow(em, { key, argsDigest: hashOf({ ...args, items: undefined, item }), subjectCase: c, ordinal, committed: r.committed, status: r.status,
        ...(r.error ? { error: { code: r.error.code, reason: r.error.reason } } : {}), faultTags: tags, ...(tags.length ? { injected: true } : {}), via, batchIndex: index,
        ...(op.money ? { money: true } : {}) });
      if (r.committed) { this.#touch(em, sys, r.touched); this.#counterparty(em, sys, c, ordinal, r.result, { ...args, items: undefined, item }); }
      outcomes.push(r);
      items.push({ index, key, status: r.status, ...(r.result && r.status === 'ok' ? { result: r.result } : {}), ...(r.error ? { error: r.error } : {}) });
    });
    const ok = outcomes.filter(r => r.status === 'ok').length;
    const status = ok === outcomes.length ? 'ok' : outcomes.every(r => r.status === outcomes[0].status) ? outcomes[0].status : 'partial';
    const retry = this.profile.retry;
    // A batch is re-issued by the platform only when the call as a whole failed retryably (every item); a partial result
    // is a response, delivered to the arm (its items carry their own keys, so a resubmission dedupes the committed ones).
    if (retry && ok === 0 && outcomes.every(isRetryable) && mayRetry(retry, em.attempts)) {
      const secs = backoffSeconds(retry, em.attempts);
      const atMs = this.nowMs + secs * SECOND;
      em.state = 'pending';
      this.stage('platform.retry', { emission: em.id, attempt: em.attempts, afterSeconds: secs, at: this.iso(atMs), status });
      this.agenda.push({ kind: 'retry', atMs, phase: 0, source: 'platform', id: `${em.id}#${em.attempts + 1}`, emission: em });
      return;
    }
    this.#scheduleResult(em, sys, { key: null, system: eff.system, op: eff.op, status, items, ...(em.attempts > 1 ? { attempts: em.attempts } : {}) }, anyInjected);
    this.#resolve(em, outcomes.some(r => r.committed || r.deduped) ? 'committed' : 'failed');
  }

  // ---------------------------------------------------------------------------------------------------------------
  /** Track C: the product engine computes product-computed fields after every round (never under Track P profiles). */
  #product() {
    if (!this.profile.product) return;
    const systems = this.systems;
    const writes = this.item.product.compute({
      now: this.iso(this.nowMs), config: this.productConfig,
      rows: (sys, table) => systems.get(sys)?.query(table, {}, true) ?? [],
      query: (qual, filter) => { const [s, t] = qual.split('.'); return systems.get(s).query(t, filter ?? {}, true); },
    }) ?? [];
    for (const w of writes) {
      const sys = systems.get(w.system);
      const t = sys?.def.tables[w.table];
      if (!t) throw new HostError(`product wrote unknown table ${w.system}.${w.table}`);
      for (const f of Object.keys(w.fields)) if (!t.computed.includes(f)) throw new HostError(`product wrote non-computed field ${w.system}.${w.table}.${f}`);
      const cur = sys.db[w.table].get(w.pk);
      if (!cur) continue;
      const next = { ...cur, ...structuredClone(w.fields) };
      if (canonical(next) === canonical(cur)) continue;
      sys.db[w.table].set(w.pk, next);
      this.stage('product.write', { system: w.system, table: w.table, pk: w.pk, fields: w.fields });
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  sorDigest() { return hashOf([...this.systems.values()].map(s => [s.id, s.state()])); }
  digests() {
    return {
      journal: this.journal.head,
      ledger: hashOf(this.ledger.committed),
      sor: this.sorDigest(),
      outputs: hashOf(this.journal.contentRows().filter(r => r.type === 'call').map(r => [r.callId, r.outcome, r.output ?? r.error])),
      content: hashOf(this.journal.contentRows()),
    };
  }
  stats() {
    const rows = this.journal.contentRows();
    const count = t => rows.filter(r => r.type === t).length;
    return { wakeups: count('wakeup.commit'), calls: count('call'), caseTicks: rows.filter(r => r.type === 'call' && r.kind === 'case').length,
      sweepTicks: rows.filter(r => r.type === 'call' && r.kind === 'sweep').length, ledgerRows: this.ledger.committed.length,
      instances: this.instances.size, armErrors: count('arm.error'), injected: this.ledger.committed.filter(r => r.injected).length };
  }
}
