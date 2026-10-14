// Requirement tracker, trace API v1 (research/need-router-20261014/TRACKER-DESIGN.md §2.1). The trace is what the user's
// own platform would show them about one run: what came in, what the workflow emitted, what the systems answered, what
// the platform refused, the human tasks and timers the workflow declared, the user's reference files and the final
// records. It is an ALLOWLIST projection of the host journal (beds/ebed/host/journal.mjs contentRows()): a row type or
// field not named below never reaches a property. Never projected: `ledger` rows (subjectCase, faultTags, injected,
// committed), `counterparty.*`, `world.write`, `binding`, task plans (case, ordinal, user, noise, steps), world truth,
// the fault schedule, the oracle.
//
// makeHelpers(t) is the `h` every property receives. It is serialised into the property sandbox with toString(), so it
// must stay self-contained (no reference to anything outside its own body).

export const TRACE_VERSION = '1';
export const FILE_PREFIXES = Object.freeze(['master/', 'rulebook/', 'calendar/']);

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
export const normId = s => (typeof s === 'string' && s.trim() ? s.trim().replace(/^#/, '').toUpperCase() : null);

/** How a message payload or effect args name the subject. Generic: the item's subject key. */
export const subjectAdapter = key => Object.freeze({
  key,
  ofPayload: p => normId(p?.[key] ?? null),
  ofArgs: a => normId(a?.[key] ?? null),
});
/** E8 (SPEC-E §3): orderId, a customer's orderRef, a carrier's fulfilmentRef (`<orderId>-F<n>`), a migration's records. */
export const E8_SUBJECT = Object.freeze({
  key: 'orderId',
  ofPayload: p => normId(p?.orderId ?? p?.orderRef ?? null)
    ?? (typeof p?.fulfilmentRef === 'string' ? normId(p.fulfilmentRef.replace(/-F\d+\s*$/i, '')) : null)
    ?? normId(p?.records?.['orders.orders']?.[0]?.orderId ?? null),
  ofArgs: a => normId(a?.orderId ?? null) ?? (typeof a?.fulfilmentId === 'string' ? normId(a.fulfilmentId.replace(/-F\d+\s*$/i, '')) : null),
});

const pickFiles = files => Object.fromEntries(Object.entries(files ?? {}).filter(([p, v]) => typeof v === 'string' && FILE_PREFIXES.some(x => p.startsWith(x))).sort(([a], [b]) => (a < b ? -1 : 1)));
const pickRecords = records => Object.fromEntries(Object.entries(records ?? {}).filter(([, rows]) => Array.isArray(rows)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([q, rows]) => [q, clone(rows)]));
const resultOf = ev => {
  const p = ev.payload ?? {};
  return { at: ev.at, status: p.status ?? null, ...(p.error !== undefined ? { error: clone(p.error) } : {}), ...(Array.isArray(p.items) ? { items: clone(p.items) } : {}),
    ...(p.result !== undefined ? { result: clone(p.result) } : {}), ...(p.attempts !== undefined ? { attempts: p.attempts } : {}), ...(p.retryAfter !== undefined ? { retryAfter: p.retryAfter } : {}) };
};
const proposedOf = out => (Array.isArray(out?.effects) ? out.effects.filter(isObj).map(e => ({ system: e.system ?? null, op: e.op ?? null, args: clone(e.args ?? null), key: e.key ?? null, after: e.after ?? null })) : []);

/**
 * projectTrace(rows, { files, records, horizon, subject }) → trace v1.
 * rows: host journal content rows; files: the reference files the workflow had (only master/, rulebook/, calendar/ are
 * kept); records: { 'system.table': rows } at the horizon (arm-visible tables only); subject: a subject adapter.
 */
export function projectTrace(rows, { files = {}, records = {}, horizon = null, subject = E8_SUBJECT } = {}) {
  const t = { trace: TRACE_VERSION, horizon: null, files: pickFiles(files), inbound: [], effects: [], refused: [], tasks: [], timers: [], instances: [], records: pickRecords(records) };
  const inst = new Map(), em = new Map(), evToEm = new Map(), inboundById = new Map();
  let now = null, end = null, horizonEnd = null, pending = null;
  const declared = id => inst.get(id)?.subject ?? null;
  for (const r of rows) {
    // The row right after a `call` says whether the platform took its output: `arm.error` (refused) or anything else.
    if (pending && r.type !== 'call') {
      const p = pending; pending = null;
      const sameTarget = p.kind === 'case' ? r.instance === p.target : r.sweep === p.target;
      if (r.type === 'arm.error' && sameTarget) {
        t.refused.push({ at: now, instance: r.instance ?? null, ...(r.sweep ? { sweep: r.sweep } : {}), code: r.code ?? null, detail: clone(r.detail ?? null), proposed: p.outcome === 'ok' ? proposedOf(p.output) : [] });
        continue;
      }
      if (p.kind === 'case' && p.outcome === 'ok' && inst.has(p.target)) inst.get(p.target).subject = normId(p.output?.decisions?.subject ?? null);
    }
    switch (r.type) {
      case 'run.start': horizonEnd = r.horizonEnd ?? null; now = r.t0 ?? now; break;
      case 'run.ready': case 'wakeup': now = r.at; break;
      case 'run.end': end = r.at; break;
      case 'call': pending = r; break;
      case 'arm.error':   // an error with no output call before it (should not happen): still a refusal, nothing proposed
        t.refused.push({ at: now, instance: r.instance ?? null, ...(r.sweep ? { sweep: r.sweep } : {}), code: r.code ?? null, detail: clone(r.detail ?? null), proposed: [] });
        break;
      case 'instance.open': { const i = { instance: r.instance, openedAt: r.at, subject: null, closed: null }; inst.set(r.instance, i); t.instances.push(i); break; }
      case 'instance.close': { const i = inst.get(r.instance); if (i) i.closed = { at: now, reason: r.reason ?? null }; break; }
      case 'effect.emit': {
        const e = r.effect ?? {};
        const instance = r.origin?.kind === 'case' ? r.origin.instance : null;
        const row = { id: r.emission, at: now, instance, ...(r.origin?.kind === 'sweep' ? { sweep: r.origin.sweep } : {}), subject: subject.ofArgs(e.args) ?? declared(instance),
          system: e.system ?? null, op: e.op ?? null, args: clone(e.args ?? null), key: e.key ?? null, after: e.after ?? null, result: null, abandoned: false };
        em.set(r.emission, row); t.effects.push(row);
        break;
      }
      case 'effect.result': evToEm.set(r.event, r.emission); break;
      case 'effect.abandoned': { const e = em.get(r.emission); if (e) e.abandoned = true; break; }
      case 'deliver': case 'delivery.dropped': {
        const ev = r.event ?? {};
        const dropped = r.type === 'delivery.dropped' ? (r.reason ?? 'dropped') : null;
        if (ev.type === 'effect.result') {
          const e = em.get(evToEm.get(ev.id));
          if (e && !e.result) e.result = { ...resultOf(ev), ...(dropped ? { dropped } : {}) };
          break;
        }
        if (inboundById.has(ev.id)) { const row = inboundById.get(ev.id); if (r.instance && r.instance !== row.instance) row.mergedInto = r.instance; break; }
        // Projected as host.armEvent does (id, type, at, source, payload; the document as the workflow received it).
        const row = { id: ev.id, type: ev.type, at: ev.at, source: ev.source ?? null, payload: clone(ev.payload ?? {}), instance: r.instance ?? null,
          ...(r.sweep ? { sweep: r.sweep } : {}), subject: subject.ofPayload(ev.payload) ?? declared(r.instance), ...(typeof ev.doc === 'string' ? { doc: ev.doc } : {}), ...(dropped ? { dropped } : {}) };
        inboundById.set(ev.id, row); t.inbound.push(row);
        break;
      }
      case 'humanTask.created': t.tasks.push({ at: now, instance: r.instance, task: clone(r.task) }); break;
      case 'obligation.upsert': t.timers.push({ at: now, instance: r.instance, id: r.id, kind: r.kind ?? null, dueAt: r.dueAt }); break;
      default: break;     // every other row type is not part of the trace (allowlist)
    }
  }
  if (pending?.kind === 'case' && pending.outcome === 'ok' && inst.has(pending.target)) inst.get(pending.target).subject = normId(pending.output?.decisions?.subject ?? null);
  t.horizon = horizon ?? end ?? horizonEnd ?? now;
  return t;
}

/** The fields a trace must have (mini-traces in contrast pairs may omit any; missing ones are filled empty). */
export function completeTrace(x) {
  const t = isObj(x) ? x : {};
  const arr = k => (Array.isArray(t[k]) ? t[k] : []);
  return { trace: TRACE_VERSION, horizon: typeof t.horizon === 'string' ? t.horizon : '2100-01-01T00:00:00+00:00', files: isObj(t.files) ? t.files : {},
    inbound: arr('inbound'), effects: arr('effects'), refused: arr('refused'), tasks: arr('tasks'), timers: arr('timers'), instances: arr('instances'), records: isObj(t.records) ? t.records : {} };
}

/** h: the helpers every property receives. Self-contained: it is serialised into the sandbox with toString(). */
export function makeHelpers(t) {
  const ms = iso => {
    const v = typeof iso === 'number' ? iso : Date.parse(iso);
    if (!Number.isFinite(v)) throw new Error(`h.ms: not an ISO time: ${String(iso).slice(0, 60)}`);
    return v;
  };
  const norm = s => (typeof s === 'string' && s.trim() ? s.trim().replace(/^#/, '').toUpperCase() : null);
  const minutes = (a, b) => (ms(b) - ms(a)) / 60000;
  const within = (iso, anchorIso, loMin, hiMin, { lo = 'incl', hi = 'incl' } = {}) => {
    const d = ms(iso) - ms(anchorIso), l = loMin * 60000, u = hiMin * 60000;
    return (lo === 'excl' ? d > l : d >= l) && (hi === 'excl' ? d < u : d <= u);
  };
  const censored = deadlineIso => ms(deadlineIso) > ms(t.horizon);
  let index = null;
  const of = subject => {
    if (!index) {
      index = new Map();
      const add = (s, row, rank) => { if (s === null || s === undefined) return; if (!index.has(s)) index.set(s, []); index.get(s).push([ms(row.at), rank, row]); };
      (t.inbound ?? []).forEach((r, i) => add(norm(r.subject), r, i));
      (t.effects ?? []).forEach((r, i) => add(norm(r.subject), r, 1e9 + i));
      for (const [s, list] of index) index.set(s, Object.freeze(list.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2])));
    }
    return index.get(norm(subject)) ?? Object.freeze([]);
  };
  const cache = new Map();
  const json = p => {
    if (!cache.has(p)) { const text = t.files?.[p]; let v = null; if (typeof text === 'string') { try { v = JSON.parse(text); } catch { v = null; } } cache.set(p, v); }
    return cache.get(p);
  };
  return Object.freeze({ ms, minutes, norm, within, censored, of, json });
}

/** The writer's only reference (its prompt prefix): the trace API, the property contract and the writing rules. */
export const TRACE_API = `# Trace API v${TRACE_VERSION} (requirement tracker)

A property is a JavaScript arrow function \`(t, h) => Instance[]\`. It must be pure and deterministic: no I/O, no
Date.now(), no new Date() without an argument, no Math.random(), no async. It receives one run's trace \`t\` (frozen) and
helpers \`h\`, and returns one Instance per place in the run where its condition was triggered.

  Instance = { subject, at, ok, why, refs }
    subject  the business key (e.g. an order id) the instance is about, or null
    at       ISO time of the trigger
    ok       true (the condition held), false (it was violated), or null (cannot be decided: the window closes after
             t.horizon, or the instance falls inside an anchor's slack)
    why      a short reason (one line)
    refs     ids of the trace rows that show it (inbound ids, effect ids)
  Return [] when nothing in the run triggers the condition. Never return an instance for something that did not happen.

## t (all times are ISO 8601 strings with offset; compare them with h.ms, never as strings)
t.horizon     ISO time the run ended. A window that closes after it is censored (ok: null).
t.files       { 'master/<table>.json': text, 'rulebook/<edition>/<file>.json': text, 'calendar/<id>.json': text }: the user's
              reference files (JSON text; read them with h.json(path)). Business constants come from here.
t.inbound     [{ id, type, at, source, payload, instance, subject, doc?, dropped?, mergedInto? }] every message the
              workflow was delivered, in delivery order, except effect results. Types include the business messages
              (e.g. order.placed, customer.action, carrier.status), humanTask.answered | answerRejected | timeout |
              withdrawn | delegated, timer.fired (payload { obligationId, kind, dueAt }), migration (payload
              { records, events }: cases already in flight at go-live). at = the message time. subject = the business
              key the message names (normalised), or the subject its instance declared. doc = the attached document text.
t.effects     [{ id, at, instance, subject, system, op, args, key, after, result, abandoned }] every effect the workflow
              emitted and the platform accepted, in emission order. at = emission time. key = its idempotency key or
              null (a batch op has no top-level key: args.items[i].key). after = the key of an effect of the same
              output it waited for, or null. abandoned = the platform gave up on it because its instance closed.
              result = the outcome as delivered to the workflow, or null if none arrived by t.horizon:
                { at, status, error?, items?, result?, attempts? }
                status   'ok' | 'error' | 'unknown' (outcome unknown; it may have committed) | 'rate-limited' |
                         'partial' (batch: some items ok, some not)
                error    { code, reason, retryable? }: code is an HTTP-like number (400, 402, 404, 409, 422, 503 ...) or
                         a string ('permanent', 'timeout', 'predecessor-failed' ...); retryable: false = permanent
                items    batch results: [{ index, key, status, result?, error? }], index = position in args.items
                result   the system's answer for status 'ok' (read-only ops return their data here)
                attempts how many times the platform issued it (it re-issues retryable outcomes itself)
t.refused     [{ at, instance, code, detail, proposed: [{ system, op, args, key, after }] }] tick outputs the platform
              refused: NOTHING in them was applied. code 'invalid-output' (detail lists why), 'crash', 'timeout'
              (proposed is [] for those). A condition about what the workflow tried to do may need to look here too.
t.tasks       [{ at, instance, task }] human tasks as the workflow declared them (task: { id, kind, role, subject,
              question, answerSchema, dueAt, ... }); at = creation time.
t.timers      [{ at, instance, id, kind, dueAt }] wake-ups the workflow declared; at = when it declared them.
t.instances   [{ instance, openedAt, subject, closed: { at, reason } | null }]; subject = what the workflow declared.
t.records     { '<system>.<table>': [row, ...] } the business records at t.horizon.

## h
h.ms(iso) -> epoch ms        h.minutes(a, b) -> minutes from a to b (b - a)        h.norm(id) -> trimmed, '#' removed, upper-case
h.within(iso, anchorIso, loMin, hiMin, { lo: 'incl' | 'excl', hi: 'incl' | 'excl' }) -> true if anchor+lo <= iso <= anchor+hi
             (default both inclusive)
h.censored(deadlineIso) -> true if the deadline is after t.horizon (the run ended before the window closed)
h.of(subject) -> inbound rows and effect rows naming that subject, in time order (inbound rows have \`type\`, effect rows
             have \`system\` and \`op\`)
h.json(path) -> the parsed JSON of t.files[path], or null

## Writing rules
1. Write from the quoted condition and its context quotes only.
2. Anchor every window on a fact the user's world produced: a message time (at), a time inside a payload (placedAt,
   reportedAt ...) or a system result (result.at). Do not anchor on the workflow's own decisions, unless the condition is
   about the order of the workflow's own actions.
3. When an anchor depends on another rule (e.g. "when the order is ready"), take the lenient bound and return ok: null
   for instances inside the slack.
4. Read business constants (fees, hours, codes, editions) from t.files with h.json, never from the workflow's outputs.
5. A window whose end is after t.horizon and whose obligation has not been met yet is ok: null, not ok: false.
6. Keep it small. Guard every optional field (result may be null; args may lack a field). Never throw.
`;
