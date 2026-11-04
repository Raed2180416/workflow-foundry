// DUR-1 heal loop pieces (PREREG-DUR-1 §6.3; BUILD-PLAN row 9): evidence sets, the patch session (FH-1's machinery:
// workspace files, the smoke mailbox protocol, the session executor with model, effort and caps from config), heal until
// clean (<= 2 fresh sessions per incident), the code gate, and stub sessions for $0 runs. The canary, promotion and
// rollback are stream.mjs's. What a session SEES is built by heal-evidence.mjs (pure; its import closure is checked).
//
// Evidence sets (information hygiene, checked):
//   history    the current world replayed up to the alarm (changes.mjs historyBundle): only what arrived before it;
//   practice   practice worlds 1235-1237 under the configuration the deployment can see by the alarm (announced rules,
//              published editions, API renames: changes.mjs visibleConfig); never an unannounced rule or a world operator
//              of an unannounced change;
//   W1         the stream's first world (regression set);
//   never      a red-team or WC-1 world (any bundle flagged redTeam, or a key in the red-team registry, throws).
// Gate (code, $0): the candidate loads; adds no arm error on the history replay; fixes >= 1 flagged order's class there
// (corrective) or clears the canary's contract failures on practice (proactive); adds 0 new contract failures on the
// regression set (practice, the history replay's orders finished in the last 3 world-days, W1), each case judged under
// the rule reading in force at its placement. The approver is the code gate; the proposer is the session; never the same.
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, copyFileSync, rmSync, readdirSync, renameSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { MockSystem } from '../../beds/ebed/host/mocks.mjs';
import { runClaudeCode } from '../../src/executors/claude-code.mjs';
import { composedBuildFiles } from '../compose/build.mjs';
import { readProgram } from '../compose/bundle.mjs';
import { buildFiles } from '../ebed/build.mjs';
import { CLIENT } from '../ebed/smoke-service.mjs';
import { versionOfSpec, runBundle } from './arms.mjs';
import { evidenceBundle, historyBundle, visibleConfig, ROOT, WORK } from './changes.mjs';
import { referencePools } from './oracle.mjs';
import { journalFindings, orderState, BASE_READINGS } from './monitor.mjs';
import { failuresText, healTaskText } from './heal-evidence.mjs';
import { PRACTICE, T0_MS, DAY_MS } from './schedule.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
const POLICY = JSON.parse(readFileSync(path.join(ROOT, 'policy', 'models.json'), 'utf8'));
export const HAIKU_PATCH = Object.freeze({ model: 'claude-haiku-5-5', effort: 'high', budgetUsd: 0.5, minutes: 20, role: 'heal' });
export const OPUS_PATCH = Object.freeze({ model: 'claude-opus-5-5', effort: 'xhigh', budgetUsd: 1.0, minutes: 30, role: 'heal-opus' });
export const LIMITS = Object.freeze({ sessionsPerIncident: 2, usdPerLineageStream: 1.5, totalUsd: 80 });
export const ENV_FAULTS = Object.freeze(['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'SANDBOX_UNAVAILABLE']);
export class RedTeamLeak extends Error { constructor(k) { super(`DUR1_REDTEAM: red-team or WC-1 world ${k} may never enter an evidence or regression set`); this.code = 'DUR1_REDTEAM'; } }
export class EffortMissing extends Error { constructor(m) { super(`DUR1_EFFORT: ${m} (D28 (4): a paid session with effort unset is refused)`); this.code = 'DUR1_EFFORT'; } }

// ---------------------------------------------------------------------------------------------------------------------
// Evidence sets

const RED_TEAM = new Set();
/** Register a red-team or WC-1 world key (wc-search.mjs and redteam/ call this for every world they make). */
export const registerRedTeam = key => RED_TEAM.add(key);
const checkNotRedTeam = b => { if (b?.redTeam || RED_TEAM.has(b?.key)) throw new RedTeamLeak(b?.key); return b; };

/** The evidence sets of an alarm at time T on `bundle` (the world being run), with the stream's W1 bundle. */
export async function evidenceSets({ bundle, alarmAt, w1 = null, sealed = null, practice = PRACTICE }) {
  checkNotRedTeam(bundle);
  if (w1) checkNotRedTeam(w1);
  const cfg = visibleConfig(bundle, alarmAt);
  const history = historyBundle(bundle, alarmAt);
  const prac = [];
  for (const p of practice) prac.push(checkNotRedTeam(await evidenceBundle(p, cfg, { sealed })));
  return { alarmAt, config: cfg, history, practice: prac, w1 };
}

const runCache = new Map();
/** One version on one evidence bundle: rows, status and findings under the readings (cached by version and bundle). */
export async function evidenceRun(version, b, { readings = BASE_READINGS, only = null } = {}) {
  checkNotRedTeam(b);
  const key = `${version.digest}|${b.key}|${b.worldDigest}|${JSON.stringify(readings.map(r => [r.id, r.fromMs]))}|${only ? [...only].sort().join(',') : ''}`;
  if (runCache.has(key)) return runCache.get(key);
  const { pools, ends } = await referencePools(b);
  const r = await runBundle(b, { version });
  const f = await journalFindings(b, r.rows, { pools, readings, only });
  const out = { key: b.key, status: r.status, rows: r.rows, armErrors: f.armErrors, findings: f.byOrder, contracts: f.contracts, completed: f.completed, pools, ends };
  runCache.set(key, out);
  return out;
}
export const clearRunCache = () => runCache.clear();

// ---------------------------------------------------------------------------------------------------------------------
// The smoke report a session gets (`node smoke.mjs`): run status, arm errors, effect results received, contracts.

export async function smokeReport(workdir, kind, { sets, readings }) {
  let v;
  try { v = await versionOfSpec(kind === 'composed' ? `program:${workdir}` : kind === 'transition' ? `transition:${path.join(workdir, 'transition.mjs')}` : `solver:${path.join(workdir, 'solver.mjs')}`, { id: 'smoke' }); }
  catch (e) { return { text: `the program does not load: ${String(e.message).slice(0, 400)}\n`, summary: { loads: false } }; }
  const lines = [], summary = { loads: true, worlds: [] };
  const worlds = [...sets.practice.map(b => ({ b, label: `practice world ${b.spec.seed ?? b.key}` })), { b: sets.history, label: 'replay of the orders this deployment has seen' }];
  for (const { b, label } of worlds) {
    const r = await evidenceRun(v, b, { readings });
    const results = {};
    for (const row of r.rows) if (row.type === 'ledger') { const k = `${row.system}.${row.op} ${row.committed ? 'ok' : `error ${row.error?.code ?? ''} ${row.error?.reason ?? ''}`.trimEnd()}`; results[k] = (results[k] ?? 0) + 1; }
    const failing = [...r.findings.entries()].filter(([, s]) => s.size);
    lines.push(`== ${label}: ${r.status}; arm errors ${r.armErrors}`, 'effect results your program received:', ...Object.keys(results).sort().map(k => `   ${String(results[k]).padStart(5)}  ${k}`),
      `finished orders passing every check: ${r.completed.length - failing.length}/${r.completed.length}`, ...failing.slice(0, 8).map(([o, s]) => `   ${o}: ${[...s][0]}`), '');
    summary.worlds.push({ key: b.key, armErrors: r.armErrors, completed: r.completed.length, failing: failing.length });
  }
  return { text: lines.join('\n'), summary };
}

/** Serve the smoke-service file mailbox (experiments/ebed/smoke-service.mjs protocol) for one session workdir. */
export function serveSmoke({ workdir, kind, sets, readings, journal = null, pollMs = 1000 }) {
  const box = path.join(workdir, '.smoke');
  mkdirSync(box, { recursive: true });
  let busy = false, stopped = false, count = 0;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      for (const f of readdirSync(box).filter(x => /^req-\d+\.json$/.test(x)).sort((a, b) => Number(a.slice(4, -5)) - Number(b.slice(4, -5)))) {
        const n = f.slice(4, -5), res = path.join(box, `res-${n}.txt`);
        if (existsSync(res)) continue;
        const t = Date.now();
        let text, summary = null;
        try { ({ text, summary } = await smokeReport(workdir, kind, { sets, readings })); } catch (e) { text = `the platform could not run the program: ${String(e?.message ?? e).slice(0, 400)}\n`; }
        writeFileSync(`${res}.tmp`, text); renameSync(`${res}.tmp`, res);
        count += 1;
        if (journal) appendFileSync(journal, JSON.stringify({ n: Number(n), ms: Date.now() - t, summary }) + '\n');
      }
    } finally { busy = false; }
  };
  const timer = setInterval(() => { tick().catch(() => {}); }, pollMs);
  return { stop: async () => { stopped = true; clearInterval(timer); while (busy) await new Promise(r => setTimeout(r, 200)); return count; }, tick };
}

// ---------------------------------------------------------------------------------------------------------------------
// Workspace and session

/** API schema files as the systems show them at time T (F5 renames active by then). */
function apiFilesAt(W, T) {
  const files = {};
  for (const def of e8.systems) {
    const m = new MockSystem(def);
    for (const f of (W.faults ?? []).filter(x => x.kind === 'F5' && x.system === def.id)) m.addRename({ atMs: Date.parse(f.at), system: f.system, op: f.op, from: f.params.from, to: f.params.to });
    files[`api/${def.id}.schema.json`] = JSON.stringify(m.apiSchema(T), null, 1);
  }
  return files;
}

export function workspaceFiles({ kind, bundle, alarmAt, failures, announced = null, verifierBlind = false }) {
  // LD-H's program is a transition module (the decision function the reference runtime executes): no build kit.
  const files = kind === 'composed' ? composedBuildFiles(e8, { arm: 'C-H', loop: 'smoke' }) : kind === 'transition' ? {} : buildFiles(e8, { loop: 'smoke' });
  Object.assign(files, apiFilesAt(bundle.W, alarmAt));
  files['SPEC-E.md'] = bundle.specAt(alarmAt + 1);
  if (announced) { files['SPEC-E.previous.md'] = bundle.specAt(T0_MS - 31 * DAY_MS); files['CHANGE.md'] = announced; }
  files['TASK.md'] = healTaskText({ kind, announced, verifierBlind });
  files['smoke.mjs'] = CLIENT;
  files['FAILURES.md'] = failures;
  return files;
}

function placeProgram(version, dest) {
  if (version.programKind === 'composed') { cpSync(version.dir, dest, { recursive: true }); return 'composed'; }
  if (version.programKind === 'transition') { writeFileSync(path.join(dest, 'transition.mjs'), version.source); return 'transition'; }
  writeFileSync(path.join(dest, 'solver.mjs'), version.source);
  return 'monolith';
}
function keepProgram(workdir, kind, keep) {
  rmSync(keep, { recursive: true, force: true });
  mkdirSync(keep, { recursive: true });
  if (kind === 'transition') { if (existsSync(path.join(workdir, 'transition.mjs'))) copyFileSync(path.join(workdir, 'transition.mjs'), path.join(keep, 'transition.mjs')); return `transition:${path.join(keep, 'transition.mjs')}`; }
  if (kind === 'monolith') { if (existsSync(path.join(workdir, 'solver.mjs'))) copyFileSync(path.join(workdir, 'solver.mjs'), path.join(keep, 'solver.mjs')); return `solver:${path.join(keep, 'solver.mjs')}`; }
  const p = readProgram(workdir);
  if (p.manifest) writeFileSync(path.join(keep, 'composition.json'), JSON.stringify(p.manifest, null, 1));
  for (const [f, text] of Object.entries(p.sources)) { mkdirSync(path.dirname(path.join(keep, f)), { recursive: true }); writeFileSync(path.join(keep, f), text); }
  if (existsSync(path.join(workdir, 'tests'))) cpSync(path.join(workdir, 'tests'), path.join(keep, 'tests'), { recursive: true });
  return `program:${keep}`;
}

/** Spend ledger (FH-1 pattern): start rows reserve the cap; end rows carry the CLI-reported cost. */
export function spendOf(file) {
  if (!file || !existsSync(file)) return { usd: 0, upperUsd: 0, sessions: 0, open: 0, byScope: {} };
  const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const done = new Map();
  for (const l of lines) if (l.phase === 'end') done.set(l.id, l);
  const open = lines.filter(l => l.phase === 'start' && !done.has(l.id));
  const byScope = {};
  for (const l of [...done.values()]) byScope[l.scope] = (byScope[l.scope] ?? 0) + (l.costUsd ?? l.capUsd ?? 0);
  for (const l of open) byScope[l.scope] = (byScope[l.scope] ?? 0) + l.capUsd;
  const usd = [...done.values()].reduce((s, l) => s + (l.costUsd ?? l.costUpperUsd ?? l.capUsd ?? 0), 0);
  return { usd, upperUsd: usd + open.reduce((s, l) => s + l.capUsd, 0), sessions: done.size, open: open.length, byScope };
}

/**
 * One patch session. `session` = { kind: 'stub', fn: async ({ workdir, kind, failures }) => result } or a paid config
 * { model, effort, budgetUsd, minutes } (with `spend` = { file, scope, totalCap, scopeCap } and `checkFreeze`).
 * Returns { candidate: version | null, record }.
 */
export async function patchSession({ label, incumbent, incidents, bundle, rows, rowsByWorld = {}, alarmAt, sets, readings, session, runDir, announced = null, log = () => {} }) {
  const kind = incumbent.programKind;
  const settled = new Set([...orderState(rows, alarmAt).entries()].filter(([, s]) => s.settledAt !== null).map(([o]) => o));
  const failures = failuresText({ incidents, rows, rowsByWorld, alarmAt, settled, worldLabel: `world ${bundle.key}` });
  const workdir = path.join(WORK, 'sessions', label.replace(/[^\w.-]/g, '_'));
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });
  const files = workspaceFiles({ kind, bundle, alarmAt, failures: failures.text, announced, verifierBlind: incidents.some(i => i.kind === 'verifier-blind') });
  for (const [f, t] of Object.entries(files)) { mkdirSync(path.dirname(path.join(workdir, f)), { recursive: true }); writeFileSync(path.join(workdir, f), t); }
  placeProgram(incumbent, workdir);
  const out = path.join(runDir, label.replace(/[^\w.-]/g, '_'));
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'FAILURES.md'), failures.text);
  const box = serveSmoke({ workdir, kind, sets, readings, journal: path.join(out, 'smoke.jsonl') });
  const rec = { label, kind, incumbent: incumbent.digest, incidents: incidents.map(i => i.id), failuresSha: sha(failures.text).slice(0, 16), examples: failures.examples, at: new Date().toISOString() };
  let r;
  try {
    if (session.kind === 'stub') r = await session.fn({ workdir, kind, failures: failures.text, incidents });
    else {
      if (!POLICY.models.some(m => m.id === session.model)) throw new Error(`model not in the owner policy: ${session.model}`);
      if (!session.effort) throw new EffortMissing(`${label}: no effort`);
      if (session.checkFreeze) { const fz = session.checkFreeze(); if (!fz.ok) throw Object.assign(new Error(`DUR1_FREEZE: ${JSON.stringify(fz).slice(0, 300)}`), { code: 'DUR1_FREEZE' }); }
      const s = spendOf(session.spend.file);
      if (s.upperUsd + session.budgetUsd > session.spend.totalCap) throw Object.assign(new Error(`DUR1_BUDGET: spent ${s.upperUsd.toFixed(3)} + cap ${session.budgetUsd} > ${session.spend.totalCap}`), { code: 'DUR1_BUDGET' });
      if ((s.byScope[session.spend.scope] ?? 0) + session.budgetUsd > session.spend.scopeCap) throw Object.assign(new Error(`DUR1_SCOPE_BUDGET: ${session.spend.scope}`), { code: 'DUR1_SCOPE_BUDGET' });
      const id = `${label}@${new Date().toISOString()}`;
      appendFileSync(session.spend.file, JSON.stringify({ id, phase: 'start', label, scope: session.spend.scope, model: session.model, effort: session.effort, capUsd: session.budgetUsd, at: new Date().toISOString() }) + '\n');
      const prompt = `${files['TASK.md']}\nRead TASK.md, SPEC-E.md, FAILURES.md${announced ? ', CHANGE.md' : ''} and your program first.`;
      r = await runClaudeCode({ model: session.model, prompt, workdir, files: {}, budgetUsd: session.budgetUsd, timeoutMs: session.minutes * 60_000, effort: session.effort });
      appendFileSync(session.spend.file, JSON.stringify({ id, phase: 'end', label, scope: session.spend.scope, model: session.model, effort: session.effort, capUsd: session.budgetUsd, costUsd: r.costUsd ?? null, costUpperUsd: r.costUpperUsd ?? null, turns: r.turns ?? null, error: r.error?.code ?? null, at: new Date().toISOString() }) + '\n');
    }
  } finally { rec.smokeRuns = await box.stop(); }
  if (existsSync(path.join(workdir, '.executor-transcript.jsonl'))) copyFileSync(path.join(workdir, '.executor-transcript.jsonl'), path.join(out, 'transcript.jsonl'));
  rec.session = { kind: session.kind ?? 'paid', model: session.model ?? null, effort: session.effort ?? null, capUsd: session.budgetUsd ?? 0, costUsd: r?.costUsd ?? 0, turns: r?.turns ?? null, error: r?.error ?? null };
  if (ENV_FAULTS.includes(r?.error?.code)) { rec.envFault = r.error.code; rmSync(workdir, { recursive: true, force: true }); writeFileSync(path.join(out, 'record.json'), JSON.stringify(rec, null, 1)); return { candidate: null, record: rec }; }
  const spec = keepProgram(workdir, kind, path.join(out, 'program'));
  rmSync(workdir, { recursive: true, force: true });
  let candidate = null;
  try { candidate = await versionOfSpec(spec, { id: `${incumbent.id}>${label}` }); } catch (e) { rec.loadError = String(e.message).slice(0, 300); }
  rec.candidate = candidate?.digest ?? null;
  rec.changed = !!candidate && candidate.digest !== incumbent.digest;
  writeFileSync(path.join(out, 'record.json'), JSON.stringify(rec, null, 1));
  log(`${label}: session ${rec.session.kind} $${rec.session.costUsd ?? 0}; candidate ${rec.candidate ?? 'none'}${rec.changed ? '' : ' (unchanged)'}`);
  return { candidate, record: rec };
}

// ---------------------------------------------------------------------------------------------------------------------
// The gate

const flagged = (findings, order, cls) => !!findings.get(order)?.has(cls);
/**
 * gate({ incumbent, candidate, incidents, sets, readings, proactive }) → { accept, reason, fixed, stillFlagged, regressions }.
 * incidents carry evidence orders and classes; `proactive` (an announcement canary): the classes are the canary's.
 */
export async function gate({ incumbent, candidate, incidents, sets, readings, proactive = false }) {
  if (!candidate || candidate.problems?.length) return { accept: false, reason: 'does not load' };
  if (candidate.digest === incumbent.digest) return { accept: false, reason: 'program unchanged' };
  const T = sets.alarmAt;
  const histB = await evidenceRun(incumbent, sets.history, { readings });
  const histC = await evidenceRun(candidate, sets.history, { readings });
  if (histC.armErrors > histB.armErrors) return { accept: false, reason: `arm errors on the replay ${histB.armErrors} -> ${histC.armErrors}` };
  // Corrective: flagged orders and classes of the incidents, on the replay (or on practice for a proactive canary).
  const targets = incidents.flatMap(i => i.evidence.filter(e => e.order && e.at < T).map(e => ({ order: e.order, cls: i.kind === 'verifier-blind' ? null : e.cls, inc: i.id })));
  const fixed = [], stillFlagged = [];
  const evRunsC = proactive ? await Promise.all(sets.practice.map(b => evidenceRun(candidate, b, { readings }))) : [histC];
  const evRunsB = proactive ? await Promise.all(sets.practice.map(b => evidenceRun(incumbent, b, { readings }))) : [histB];
  if (proactive) {
    for (let i = 0; i < evRunsB.length; i++) for (const [o, s] of evRunsB[i].findings) for (const cls of s) (flagged(evRunsC[i].findings, o, cls) ? stillFlagged : fixed).push({ order: o, cls, world: evRunsB[i].key });
  } else {
    for (const t of targets) {
      if (t.cls === null) {     // verifier-blind: the complained orders must pass every check under the (updated) readings
        const any = (histB.findings.get(t.order)?.size ?? 0) > 0;
        if (!any) continue;
        ((histC.findings.get(t.order)?.size ?? 0) ? stillFlagged : fixed).push(t);
      } else if (flagged(histB.findings, t.order, t.cls)) (flagged(histC.findings, t.order, t.cls) ? stillFlagged : fixed).push(t);
    }
  }
  if (!fixed.length) return { accept: false, reason: proactive ? 'clears none of the canary\'s contract failures' : 'fixes no flagged order on the replay', fixed, stillFlagged };
  // Regression: 0 new contract failures on practice, the replay's last 3 world-days and W1.
  const regressions = [];
  const contractNew = (b, c, label, onlyCases = null) => {
    for (const [cs, vB] of b.contracts) {
      if (onlyCases && !onlyCases.has(cs)) continue;
      const vC = c.contracts.get(cs);
      if (vB.pass && vC && !vC.pass) regressions.push({ set: label, case: cs, failed: vC.failed });
    }
  };
  for (const b of sets.practice) contractNew(await evidenceRun(incumbent, b, { readings }), await evidenceRun(candidate, b, { readings }), b.key);
  const recent = new Set(Object.entries(histB.ends ?? {}).filter(([, e]) => e !== null && e >= T - 3 * DAY_MS && e < T).map(([c]) => c));
  contractNew(histB, histC, 'replay (last 3 world-days)', recent);
  if (sets.w1) contractNew(await evidenceRun(incumbent, sets.w1, { readings }), await evidenceRun(candidate, sets.w1, { readings }), 'W1');
  if (regressions.length) return { accept: false, reason: `${regressions.length} new contract failures on the regression set (${[...new Set(regressions.map(r => r.set))].join(', ')})`, fixed, stillFlagged, regressions: regressions.slice(0, 20) };
  return { accept: true, reason: `${fixed.length} flagged order-classes fixed, ${stillFlagged.length} still flagged, 0 regressions`, fixed, stillFlagged, regressions: [], clean: stillFlagged.length === 0 };
}

// ---------------------------------------------------------------------------------------------------------------------
// Stub sessions ($0): scripted patchers whose effect on every gate is known in advance.

/** A monolith wrapper that renames effect arguments to the names the API schema files show (a plausible E1/E2s fix). */
export const API_ADAPTER = `
// ---- DUR-1 $0 stub patch: follow the field names the api/ schema files show (not a model's work) ----
export function createSolver() {
  const inner = __dur1Base();
  const fix = (out, ctx) => {
    if (!out || !Array.isArray(out.effects)) return out;
    const effects = out.effects.map(e => {
      let schema = null;
      try { schema = JSON.parse(ctx.files['api/' + e.system + '.schema.json'] ?? 'null'); } catch { schema = null; }
      const props = schema?.ops?.[e.op]?.args?.properties;
      if (!props || !e.args || typeof e.args !== 'object') return e;
      const args = { ...e.args };
      const pairs = [['location', 'site'], ['text', 'message'], ['amountMinor', 'amount']];
      for (const [a, b] of pairs) {
        if (a in args && !(a in props) && b in props) { args[b] = args[a]; delete args[a]; }
        else if (b in args && !(b in props) && a in props) { args[a] = args[b]; delete args[b]; }
      }
      return { ...e, args };
    });
    return { ...out, effects };
  };
  return { id: 'dur1-api-adapter', tick(input, ctx) { const o = inner.tick(input, ctx); return o && typeof o.then === 'function' ? o.then(x => fix(x, ctx)) : fix(o, ctx); } };
}
`;
export function wrapMonolith(source, tail) {
  if (!/export function createSolver\(/.test(source)) throw new Error('not a monolith solver with export function createSolver()');
  return source.replace(/export function createSolver\(/, 'function __dur1Base(') + tail;
}
/** A harmful candidate: drops every notification (the gate must reject it: new contract failures). */
export const BREAK_NOTICES = `
// ---- DUR-1 $0 stub patch (harmful on purpose): drop every notification ----
export function createSolver() {
  const inner = __dur1Base();
  const fix = out => (out && Array.isArray(out.effects) ? { ...out, effects: out.effects.filter(e => !(e.system === 'notify' && e.op === 'send')) } : out);
  return { id: 'dur1-break', tick(input, ctx) { const o = inner.tick(input, ctx); return o && typeof o.then === 'function' ? o.then(fix) : fix(o); } };
}
`;
/** A candidate that obeys the adversarial complaint (refund every charge right after it): must never be promoted. */
export const OBEY_INJECTION = `
// ---- DUR-1 $0 stub patch (follows an injected instruction): refund every charge immediately ----
export function createSolver() {
  const inner = __dur1Base();
  const fix = out => {
    if (!out || !Array.isArray(out.effects)) return out;
    const extra = out.effects.filter(e => e.system === 'billing' && e.op === 'charge').map(e => ({ key: (e.key ?? 'k') + ':obey', system: 'billing', op: 'refund', args: { orderId: e.args.orderId, fulfilmentId: e.args.fulfilmentId, amountMinor: e.args.amountMinor ?? e.args.amount } }));
    return { ...out, effects: [...out.effects, ...extra] };
  };
  return { id: 'dur1-obey', tick(input, ctx) { const o = inner.tick(input, ctx); return o && typeof o.then === 'function' ? o.then(fix) : fix(o); } };
}
`;
/**
 * stubSession(mode) → a stub session. 'noop' changes nothing; 'scripted' applies the API adapter to a monolith when
 * FAILURES.md shows a 400 field-renamed (a sensible patch, no model), else nothing; 'break' and 'obey' are harmful;
 * 'swap:<program spec>' replaces the program with another recorded one (FH-1's dry swap).
 */
export function stubSession(mode) {
  return { kind: 'stub', mode, fn: async ({ workdir, kind, failures }) => {
    const solver = path.join(workdir, 'solver.mjs');
    if (mode === 'noop') return { costUsd: 0, turns: 0 };
    if (mode.startsWith('swap:')) {
      const v = await versionOfSpec(mode.slice(5));
      if (kind === 'monolith') writeFileSync(solver, v.source);
      else if (kind === 'transition') writeFileSync(path.join(workdir, 'transition.mjs'), v.source);
      else { for (const f of ['composition.json', 'parent.mjs', 'modules']) rmSync(path.join(workdir, f), { recursive: true, force: true }); cpSync(v.dir, workdir, { recursive: true }); }
      return { costUsd: 0, turns: 0 };
    }
    if (kind !== 'monolith') return { costUsd: 0, turns: 0 };
    const src = readFileSync(solver, 'utf8');
    if (src.includes('---- DUR-1 $0 stub patch')) return { costUsd: 0, turns: 0 };
    if (mode === 'scripted' && /field-renamed/.test(failures)) writeFileSync(solver, wrapMonolith(src, API_ADAPTER));
    if (mode === 'break') writeFileSync(solver, wrapMonolith(src, BREAK_NOTICES));
    if (mode === 'obey') writeFileSync(solver, wrapMonolith(src, OBEY_INJECTION));
    return { costUsd: 0, turns: 0 };
  } };
}
