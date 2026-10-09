// store.mjs: the per-project library directory (LIBRARY.md §3, §7; BUILD-ORDER step 1). Append-only JSONL files:
//
//   registry.jsonl     L2 / L4 entries ({op:'register', entry}) and lifecycle transitions ({op:'status', hash, from, to, ...})
//   revocations.jsonl  {hash, reason, at}: blocks a hash everywhere (the call host refuses it: get(hash).revoked)
//   evidence.jsonl     {hash, version, at, kind, ...}: run / shadow / reuse / admission / suspect rows, aggregated by code
//   judgments.jsonl    JudgmentLedger rows (src/judgment.mjs; JEV-PORTS §8): written, NEVER consulted for authority
//   index.jsonl        written by index.mjs buildIndex (one row per item of every layer, incl. L1 cards)
//
// The registry generalises experiments/jit/call-host.mjs createRegistry (read-only there): the same hash
// (libraryHashOf), the same get(hash) shape, so createCallHost({ registry: lib.registry }) works unchanged, plus layer,
// status, tags, provenance, untrusted fields, patterns, name and timestamps. Statuses and transitions are LIBRARY §7.1;
// keep thresholds §7.3; circuit breaker and retirement §7.7; re-qualification on a policy / engine / model change §7.6.
import path from 'node:path';
import { readFileSync, appendFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { libraryHashOf } from '../jit/call-host.mjs';
import { canonicalJson } from '../jit/run-compiled.mjs';
import { PROFILE_SCHEMA } from '../jit/profile.mjs';
import { JudgmentLedger } from '../../src/judgment.mjs';

export const FILES = Object.freeze({ registry: 'registry.jsonl', revocations: 'revocations.jsonl', evidence: 'evidence.jsonl', judgments: 'judgments.jsonl', index: 'index.jsonl' });
export const LAYERS = Object.freeze(['L2', 'L4']);
export const STATUSES = Object.freeze(['candidate', 'shadow', 'kept', 'suspect', 'demoted', 'revoked', 'retired']);
// LIBRARY §7.1. 'revoked' is reached only through revoke() (it also writes revocations.jsonl).
export const TRANSITIONS = Object.freeze({
  candidate: ['shadow', 'revoked'],
  shadow: ['kept', 'demoted', 'revoked'],
  kept: ['suspect', 'demoted', 'retired', 'shadow', 'revoked'],
  suspect: ['kept', 'demoted', 'revoked'],
  demoted: ['candidate', 'retired', 'revoked'],
  revoked: [],
  retired: [],
});
export const SOURCES = Object.freeze(['own-trace', 'skill', 'corpus', 'maintainer']);
export const FAMILIES = Object.freeze(['spine', 'branch', 'fan', 'loop', 'compose', 'failure', 'trigger', 'state', 'human', 'agentic', 'async']);
export const DOMAINS = Object.freeze(['finance', 'records', 'inbox', 'documents', 'operations', 'science', 'general']);
export const EFFECT_CLASSES = Object.freeze(['none', 'read', 'write', 'send', 'delete', 'pay']);
// The closed tag list (LIBRARY §3.1): pattern families, domains, effect classes, and L1 pattern ids.
export const isTag = t => typeof t === 'string'
  && (FAMILIES.includes(t) || DOMAINS.includes(t) || (t.startsWith('effect:') && EFFECT_CLASSES.includes(t.slice(7))) || /^P\d\d$/.test(t));
// LIBRARY §7.3 starting values (ROADMAP §2.7), §7.7 circuit breaker and retirement.
export const KEEP_RULE = Object.freeze({ minRuns: 10, minShadowed: 4, minShadowAgree: 0.9, maxSilentMisses: 0, minStableShape: 0.9 });
export const BREAKER = Object.freeze({ consecutiveFailures: 3, minUses: 5, maxSuccessRate: 0.5 });
export const RETIRE_UNUSED_DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;
// Free-text fields that are untrusted whenever the item comes from outside (skill, corpus): LIBRARY §3.6, §8.2.
const OUTSIDE_TEXT = ['name', 'description', 'taskTemplate'];
// JEV-PORTS §8 meta fields and label sources.
export const JUDGMENT_META = Object.freeze(['portVersion', 'questionId', 'item', 'task', 'jevVersion', 'read', 'optionOrder', 'baseline', 'decision', 'untrustedFields']);
export const LABEL_SOURCES = Object.freeze(['oracle', 'stage-oracle', 'shadow', 'replay', 'retro-sweep', 'planted', 'human']);

const readRows = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const fail = msg => { throw new Error(`library: ${msg}`); };

export function openLibrary(dir, { now = () => new Date(), env = null } = {}) {
  if (typeof dir !== 'string' || !dir) fail('openLibrary needs a directory');
  mkdirSync(dir, { recursive: true });
  const file = name => path.join(dir, FILES[name]);
  const registryRows = readRows(file('registry')), revocationRows = readRows(file('revocations')), evidenceRows = readRows(file('evidence'));
  const stubs = new Map();
  const iso = () => now().toISOString();
  const append = (name, rows, row) => { rows.push(row); appendFileSync(file(name), JSON.stringify(row) + '\n'); return row; };
  const resolveSolve = p => (p && !path.isAbsolute(p) ? path.join(dir, p) : p);

  // ---- evidence (LIBRARY §3.7), aggregated from evidence.jsonl ----
  function evidenceOf(hash, version = null) {
    const rows = evidenceRows.filter(r => r.hash === hash && (version == null || r.version === version));
    const ev = { runs: 0, ok: 0, oraclePass: 0, oracleFail: 0, shadowed: 0, shadowAgree: 0, silentMisses: 0, silentMissesPer100: 0, deopts: {},
      reuse: { correct: 0, wrong: 0, missed: 0, refusedCorrectly: 0, refusedOther: 0, deopted: 0 }, suspect: { runs: 0, sweepIds: [] },
      consecutiveFailures: 0, uses: 0, successes: 0, stableShape: null, costPerRunUsd: null, p50Ms: null, admission: null, lastUsedAt: null };
    const costs = [], ms = [], shapes = [];
    for (const r of rows) {
      if (r.kind === 'run') {
        ev.runs++; ev.uses++;
        const ok = r.ok === true && r.oracle !== 'fail';
        if (ok) { ev.ok++; ev.successes++; ev.consecutiveFailures = 0; } else ev.consecutiveFailures++;
        if (r.oracle === 'pass') ev.oraclePass++;
        if (r.oracle === 'fail') ev.oracleFail++;
        if (r.silentMiss) ev.silentMisses++;
        if (r.deopt) ev.deopts[r.deopt] = (ev.deopts[r.deopt] ?? 0) + 1;
        if (typeof r.costUsd === 'number') costs.push(r.costUsd);
        if (typeof r.ms === 'number') ms.push(r.ms);
        if (typeof r.shape === 'string') shapes.push(r.shape);
        ev.lastUsedAt = r.at;
      } else if (r.kind === 'shadow') { ev.shadowed++; if (r.agree) ev.shadowAgree++; }
      else if (r.kind === 'reuse') {
        const k = { correct: 'correct', wrong: 'wrong', missed: 'missed', 'refused-correctly': 'refusedCorrectly', 'refused-other': 'refusedOther', deopted: 'deopted' }[r.class];
        if (k) ev.reuse[k]++;
        ev.lastUsedAt = r.at;
      } else if (r.kind === 'admission') ev.admission = r.checks ?? null;
      else if (r.kind === 'suspect') { ev.suspect.runs += r.runs ?? 0; if (r.sweepId) ev.suspect.sweepIds.push(r.sweepId); }
    }
    ev.silentMissesPer100 = ev.runs ? Math.round((ev.silentMisses / ev.runs) * 1e4) / 100 : 0;
    if (costs.length) ev.costPerRunUsd = Math.round((costs.reduce((a, b) => a + b, 0) / costs.length) * 1e6) / 1e6;
    if (ms.length) ev.p50Ms = [...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)];
    if (shapes.length) { const counts = {}; for (const s of shapes) counts[s] = (counts[s] ?? 0) + 1; ev.stableShape = Math.max(...Object.values(counts)) / shapes.length; }
    return ev;
  }

  // ---- registry ----
  function statusOf(hash) {
    let status = null, at = null, reason = null;
    for (const r of registryRows) if (r.hash === hash || r.entry?.hash === hash) {
      if (r.op === 'register' && status == null) { status = r.entry.status ?? 'candidate'; at = r.entry.createdAt; }
      else if (r.op === 'status') { status = r.to; at = r.at; reason = r.reason ?? null; }
    }
    if (revocationRows.some(r => r.hash === hash)) status = 'revoked';
    return { status, at, reason };
  }
  function get(hash) {
    let entry = null, version = 0;
    for (const r of registryRows) if (r.op === 'register' && r.entry?.hash === hash) { entry = r.entry; version++; }
    if (!entry) return null;
    const rev = [...revocationRows].reverse().find(r => r.hash === hash) ?? null, st = statusOf(hash), ev = evidenceOf(hash);
    return { ...entry, solvePath: resolveSolve(entry.solvePath), version, status: st.status, statusReason: st.reason, revoked: !!rev, ...(rev ? { revokedReason: rev.reason ?? null } : {}),
      evidence: { ...(entry.evidence ?? {}), ...ev }, lastUsedAt: ev.lastUsedAt ?? entry.createdAt, stub: stubs.get(hash) ?? null };
  }
  const hashes = () => [...new Set(registryRows.filter(r => r.op === 'register').map(r => r.entry.hash))];

  function register(e) {
    if (!e || typeof e !== 'object') fail('register: an entry object is required');
    const layer = e.layer ?? 'L2';
    if (!LAYERS.includes(layer)) fail(`register: layer must be one of ${LAYERS.join(', ')}`);
    const provenance = e.provenance ?? null;
    if (!provenance || !SOURCES.includes(provenance.source)) fail(`register: provenance.source must be one of ${SOURCES.join(', ')}`);
    for (const k of ['ref', 'licence', 'author']) if (provenance[k] != null && typeof provenance[k] !== 'string') fail(`register: provenance.${k} must be a string`);
    if (typeof provenance.redistributable !== 'boolean') fail('register: provenance.redistributable (bool) is required');
    const tags = e.tags ?? [];
    if (!Array.isArray(tags) || tags.some(t => !isTag(t))) fail(`register: tags must come from the closed tag list (bad: ${tags.filter(t => !isTag(t)).join(', ')})`);
    if (e.name != null && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(e.name)) fail('register: name must match [a-z0-9-]{1,40}');
    const outside = ['skill', 'corpus'].includes(provenance.source);
    const untrusted = [...new Set([...(e.untrusted ?? []), ...(outside ? OUTSIDE_TEXT.filter(k => e[k] != null || e.contract?.[k] != null) : [])])];
    const patterns = e.patterns ?? [];
    if (!Array.isArray(patterns) || patterns.some(p => !/^P\d\d$/.test(p))) fail('register: patterns must be L1 ids (Pxx)');
    let hash, body;
    if (layer === 'L2') {
      const contract = e.contract ?? null;
      if (!contract?.output || typeof contract.output !== 'object') fail('register: contract.output (the typed return) is required');
      if (typeof e.stub !== 'function' && !e.solvePath) fail('register: solvePath (or a stub function, stub mode) is required');
      const flowVersion = e.flowVersion ?? 3;
      if (![2, 3].includes(flowVersion)) fail('register: flowVersion must be 2 or 3');
      if (e.profile != null && e.profile.schema !== PROFILE_SCHEMA) fail(`register: profile must be a ${PROFILE_SCHEMA} profile (profile.mjs learnProfile)`);
      if ((e.effects ?? 'none') !== 'none') fail("register: an L2 component is pure (effects: 'none'); effects live in L4 envelopes through L3 bindings");
      const source = typeof e.stub === 'function' ? `stub:${e.stub}` : readFileSync(resolveSolve(e.solvePath));
      hash = libraryHashOf(source, contract);
      body = { solvePath: e.solvePath ?? null, flowVersion, contract: { input: contract.input ?? null, output: contract.output, taskTemplate: contract.taskTemplate ?? '' },
        profile: e.profile ?? null, effects: 'none', ...(e.minBudgetUsd != null ? { minBudgetUsd: e.minBudgetUsd } : {}), preconditions: e.preconditions ?? [], models: e.models ?? {} };
      if (typeof e.stub === 'function') stubs.set(hash, e.stub);
    } else {
      if (!e.envelope || typeof e.envelope !== 'object') fail('register: an L4 instance needs its envelope (engine IR)');
      if (typeof e.solver !== 'string' || !e.solver.startsWith('sha256:')) fail('register: an L4 instance needs its solver (an L2 hash)');
      const calls = e.calls ?? [];
      hash = libraryHashOf(canonicalJson(e.envelope), { solver: e.solver, calls });
      body = { envelope: e.envelope, solver: e.solver, calls, trigger: e.trigger ?? null, scope: e.scope ?? null, effectPlan: e.effectPlan ?? true, bindingsUsed: e.bindingsUsed ?? [] };
    }
    if (e.hash && e.hash !== hash) fail(`register: hash ${e.hash} does not match the bytes and contract (${hash})`);
    const prior = get(hash);
    const entry = { hash, id: hash, layer, name: e.name ?? null, description: e.description ?? null, ...body, tags, provenance, untrusted, patterns,
      supersedes: e.supersedes ?? null, parent: e.parent ?? null, evidence: e.evidence ?? {}, env: e.env ?? null,
      status: prior?.status ?? 'candidate', createdAt: prior?.createdAt ?? iso(), registeredAt: iso() };
    append('registry', registryRows, { op: 'register', entry });
    return get(hash);
  }

  // A lifecycle transition, checked against TRANSITIONS and (for shadow / kept) against the evidence rules.
  function transition(hash, to, { reason = null, force = false } = {}) {
    const e = get(hash);
    if (!e) fail(`transition: unknown hash ${hash}`);
    if (!STATUSES.includes(to)) fail(`transition: unknown status ${to}`);
    if (to === 'revoked') return revoke(hash, reason);
    if (!TRANSITIONS[e.status].includes(to)) fail(`transition: ${e.status} -> ${to} is not allowed (LIBRARY §7.1)`);
    if (!force && to === 'shadow' && e.status === 'candidate') { const a = admissionCheck(e.evidence); if (!a.ok) fail(`transition: verify-before-store failed (${a.missing.join(', ')})`); }
    if (!force && to === 'kept') { const k = keepCheck(e.evidence); if (!k.ok) fail(`transition: keep thresholds not met (${k.missing.join(', ')})`); }
    append('registry', registryRows, { op: 'status', hash, from: e.status, to, reason, at: iso() });
    return get(hash);
  }
  function revoke(hash, reason = null) {
    const e = get(hash);
    if (!e) fail(`revoke: unknown hash ${hash}`);
    append('revocations', revocationRows, { hash, reason, at: iso() });
    if (e.status !== 'revoked') append('registry', registryRows, { op: 'status', hash, from: e.status, to: 'revoked', reason, at: iso() });
    return get(hash);
  }
  function addEvidence(hash, row) {
    const e = get(hash);
    if (!e) fail(`evidence: unknown hash ${hash}`);
    if (!['run', 'shadow', 'reuse', 'admission', 'suspect'].includes(row?.kind)) fail('evidence: kind must be run | shadow | reuse | admission | suspect');
    append('evidence', evidenceRows, { hash, version: e.version, at: iso(), ...row });
    // The circuit breaker runs on every run row of a kept item (LIBRARY §7.7).
    const after = get(hash);
    if (row.kind === 'run' && after.status === 'kept') {
      const b = breakerCheck(after.evidence);
      if (b.trip) return transition(hash, 'demoted', { reason: `circuit-breaker: ${b.why}` });
    }
    return after;
  }
  // Re-qualify on any change of model ids, engine tree or policy hash (LIBRARY §7.6): a kept item whose env differs
  // drops to shadow until re-verified.
  function requalify(currentEnv) {
    const moved = [];
    for (const h of hashes()) {
      const e = get(h);
      if (e.status !== 'kept') continue;
      const diff = ['policyHash', 'engineTree', 'models'].filter(k => currentEnv?.[k] !== undefined && canonicalJson(e.env?.[k] ?? null) !== canonicalJson(currentEnv[k]));
      if (diff.length) { transition(h, 'shadow', { reason: `requalify: ${diff.join(', ')} changed` }); moved.push(h); }
    }
    return moved;
  }
  // Retire kept / demoted items unused for RETIRE_UNUSED_DAYS (LIBRARY §7.7). Evidence is kept; the index drops them.
  function retireUnused({ days = RETIRE_UNUSED_DAYS } = {}) {
    const cutoff = now().getTime() - days * DAY_MS, moved = [];
    for (const h of hashes()) {
      const e = get(h);
      if (!['kept', 'demoted'].includes(e.status)) continue;
      if (new Date(e.lastUsedAt).getTime() < cutoff) { transition(h, 'retired', { reason: `unused ${days} days` }); moved.push(h); }
    }
    return moved;
  }

  // ---- the judgment ledger (JEV-PORTS §8): written here, never read by any decision above ----
  const ledger = new JudgmentLedger(file('judgments'));
  function recordJudgment({ port, engine, model = null, request, result, split = 'unspecified', meta = {} }) {
    if (typeof port !== 'string' || !port) fail('judgment: port is required');
    if (!request || !Array.isArray(request.options) || !request.options.length) fail('judgment: request.options is required');
    if (!result || typeof result.probabilities !== 'object' || !request.options.includes(result.chosen)) fail('judgment: result {probabilities, chosen, confidence} over the offered options is required');
    const unknown = Object.keys(meta).filter(k => !JUDGMENT_META.includes(k));
    if (unknown.length) fail(`judgment: unknown meta fields ${unknown.join(', ')} (JEV-PORTS §8)`);
    if (meta.read != null && ![1, 2].includes(meta.read)) fail('judgment: meta.read is 1 or 2');
    if (meta.decision != null && !['code', 'jev', 'both', 'explore'].includes(meta.decision.by)) fail('judgment: meta.decision.by is code | jev | both | explore');
    if (meta.baseline != null && request.state != null && JSON.stringify(request.state).includes(JSON.stringify(meta.baseline))) fail('judgment: the baseline verdict is logged beside the state, never inside it');
    return ledger.record({ port, engine, model, request, result, split, meta });
  }
  function labelJudgment(id, truth, { source = 'oracle' } = {}) {
    if (!LABEL_SOURCES.includes(source)) fail(`judgment label: source must be one of ${LABEL_SOURCES.join(', ')}`);
    ledger.label(id, truth, { source });
  }

  return {
    dir, files: Object.fromEntries(Object.keys(FILES).map(k => [k, file(k)])),
    registry: { dir, rows: registryRows, register, get, revoke, list: () => hashes().map(get) },
    register, get, list: () => hashes().map(get), transition, revoke, addEvidence, evidenceOf, requalify, retireUnused,
    revocations: () => revocationRows.slice(), recordJudgment, labelJudgment,
    // For calibration analysis only (LIBRARY-TESTS L8). No lifecycle or retrieval function reads it.
    judgmentRows: () => ledger.rows(),
    writeIndex(rows) { writeFileSync(file('index'), rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); return rows.length; },
    readIndex: () => readRows(file('index')),
  };
}

// LIBRARY §7.2 verify before store: S9 fixtures, live probes from a reset environment, an independent oracle or an
// agreeing shadow, a manifest no wider than the probes, a profile learned only from accepted tasks.
export function admissionCheck(ev) {
  const a = ev?.admission ?? {}, missing = [];
  if (a.fixturesPass !== true) missing.push('fixturesPass');
  if (a.probesPass !== true) missing.push('probesPass');
  if (a.resetEnv !== true) missing.push('resetEnv');
  if (!['independent-oracle', 'agreeing-shadow'].includes(a.verifiedBy)) missing.push('verifiedBy');
  if (a.manifestWithinProbes !== true) missing.push('manifestWithinProbes');
  if (a.profileFromAccepted !== true) missing.push('profileFromAccepted');
  return { ok: !missing.length, missing };
}
// LIBRARY §7.3: >= 10 runs; >= 90% stable action shape (when recorded); shadow agreement >= 0.9 on >= 4 shadowed runs;
// zero silent misses where an oracle exists. (The wrong-reuse bound of §9 needs reuse decisions; it is checked by the
// kill switch, not here.)
export function keepCheck(ev, rule = KEEP_RULE) {
  const missing = [];
  if ((ev?.runs ?? 0) < rule.minRuns) missing.push(`runs ${ev?.runs ?? 0} < ${rule.minRuns}`);
  if ((ev?.shadowed ?? 0) < rule.minShadowed) missing.push(`shadowed ${ev?.shadowed ?? 0} < ${rule.minShadowed}`);
  else if (ev.shadowAgree / ev.shadowed < rule.minShadowAgree) missing.push(`shadow agreement ${(ev.shadowAgree / ev.shadowed).toFixed(2)} < ${rule.minShadowAgree}`);
  if ((ev?.oraclePass ?? 0) + (ev?.oracleFail ?? 0) > 0 && (ev?.silentMisses ?? 0) > rule.maxSilentMisses) missing.push(`silent misses ${ev.silentMisses}`);
  if (ev?.stableShape != null && ev.stableShape < rule.minStableShape) missing.push(`stable shape ${ev.stableShape.toFixed(2)} < ${rule.minStableShape}`);
  return { ok: !missing.length, missing };
}
// LIBRARY §7.7 (ROADMAP §2.7): 3 consecutive failures, or success <= 0.5 after >= 5 uses.
export function breakerCheck(ev, rule = BREAKER) {
  if ((ev?.consecutiveFailures ?? 0) >= rule.consecutiveFailures) return { trip: true, why: `${ev.consecutiveFailures} consecutive failures` };
  if ((ev?.uses ?? 0) >= rule.minUses && ev.successes / ev.uses <= rule.maxSuccessRate) return { trip: true, why: `success ${ev.successes}/${ev.uses}` };
  return { trip: false };
}
