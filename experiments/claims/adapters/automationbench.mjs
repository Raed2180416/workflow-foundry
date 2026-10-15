// Back-fill adapter: AutomationBench runs (research/automationbench-20261014/runs/). $0; reads run outputs only.
// The committed results.jsonl and summary.json give verdicts, dollars and session wall time. The runner's live directory
// (summary.live, outside the repository, local to the machine that ran it) adds the bridge's call log and the session
// transcript; when it survives, time to first effect (first mutating world call) and the model/non-model split are
// computed from it, and the files' sha256 are recorded. When it does not, those fields are missing.
// No AB-v1 test task is opened: only dev-train runs and runs made before the split are read (their result rows, not tasks).
import { existsSync, readdirSync } from 'node:fs';
import { loadSplit } from '../../autobench/split.mjs';   // read-only import (AB-v1 file; never edited here)
import { originOf } from '../origin.mjs';
import { chargeOf } from '../meter.mjs';
import { P, baseRow, readJson, readJsonl, observedMax, iso, abs } from './util.mjs';

export const ADAPTER = 'automationbench@0';
const RUNS = 'research/automationbench-20261014/runs';
// mutating methods, as experiments/autobench/accounting.mjs MUTATING (checked equal by test; that file is read-only here)
export const MUTATING = Object.freeze(['POST', 'PUT', 'PATCH', 'DELETE']);
/**
 * Whether every task a run names (summary.json `tasks`, read before results.jsonl) is a dev-train task: in SPLIT-v1's dev
 * list and not in its devCheck list (devCheck is sealed until the go/no-go), or one of the unscored `simple.*` sanity tasks.
 * Runs made before the split carry no testSplitTasks field, so the split itself is the guard, not that field.
 */
export function devTrainOnly(tasks, split = loadSplit()) {
  if (!Array.isArray(tasks) || !tasks.length) return false;
  const dev = new Set(split.dev), devCheck = new Set(split.devCheck);
  return tasks.every(t => typeof t === 'string' && (t.startsWith('simple.') || (dev.has(t) && !devCheck.has(t))));
}
/**
 * Finished runs under runs/ (depth <= 2): a summary.json with finishedAt and a results.jsonl. A run is skipped and
 * reported, never read, when it is sealed, holds AB-v1 test tasks, or names any task outside dev-train (PREREG-AB-v1 §1.3,
 * AM-4: F programs use dev-train only). A run with k > 1 is skipped too: its per-task verdict is the fork vote
 * (results.jsonl final), which this adapter does not map onto per-fork rows (unsupported, so rejected, not flattened).
 */
export function discoverRuns() {
  const found = [], skipped = [];
  const split = loadSplit();
  const walk = (dir, depth) => {
    for (const e of readdirSync(abs(dir), { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const d = `${dir}/${e.name}`;
      if (existsSync(abs(`${d}/summary.json`)) && existsSync(abs(`${d}/results.jsonl`))) {
        const s = readJson(`${d}/summary.json`);
        if (!s.finishedAt) skipped.push({ dir: d, why: 'not finished (no finishedAt)' });
        else if ((s.testSplitTasks ?? 0) > 0 || s.sealed === true) skipped.push({ dir: d, why: 'sealed or holds AB-v1 test tasks: never read' });
        else if (!devTrainOnly(s.tasks, split)) skipped.push({ dir: d, why: 'names a task outside dev-train (SPLIT-v1 dev minus devCheck): never read' });
        else if ((s.k ?? 1) > 1) skipped.push({ dir: d, why: `k = ${s.k}: per-fork rows from a voted final verdict are not supported by ${ADAPTER}` });
        else found.push(d.slice(RUNS.length + 1));
      } else if (depth < 2) walk(d, depth + 1);
    }
  };
  walk(RUNS, 1);
  return { runs: found.sort(), skipped };
}
const ENV = /RATE_LIMIT|OVERLOAD|AUTH|NETWORK|LAUNCH|QUOTA|ENV/;

export function armOf(s) {
  if (s.scripted) return 'AB-A1-scripted';
  const code = s.arm ? (s.arm.startsWith('A1') ? 'AB-A1' : 'AB-A0') : 'AB-raw';
  return `${code}:${s.model}`;
}

/** First mutating world call's time (s, bridge clock), or null when the session wrote nothing. */
export function firstWriteT(calls) {
  for (const step of calls) for (const c of step.calls ?? []) {
    if (c.name !== 'api_fetch') continue;
    let a = null;
    try { a = JSON.parse(c.arguments); } catch {}
    if (a && MUTATING.includes(String(a.method ?? 'GET').toUpperCase())) return step.t;
  }
  return null;
}

/** What the live fork directory gives: {start, end, firstWrite, apiMs, cliMs, files} (ms epoch), or null when absent. */
export function liveFork(dir) {
  if (!dir || !existsSync(`${dir}/transcript.jsonl`) || !existsSync(`${dir}/calls.jsonl`)) return null;
  const tr = readJsonl(`${dir}/transcript.jsonl`), calls = readJsonl(`${dir}/calls.jsonl`);
  const fin = tr.findLast(e => e.type === 'result');
  const ts = tr.map(e => Date.parse(e.timestamp)).filter(Number.isFinite);
  if (!fin || !ts.length || !Number.isFinite(fin.duration_ms)) return { incomplete: 'the live transcript has no result event with duration_ms (a scripted session writes none), so the session start cannot be placed' };
  const end = Math.max(...ts), start = end - fin.duration_ms;
  const fw = firstWriteT(calls);
  return { start, end, firstWrite: fw === null ? null : fw * 1000, apiMs: fin.duration_api_ms ?? null, cliMs: fin.duration_ms, files: [`${dir}/transcript.jsonl`, `${dir}/calls.jsonl`] };
}

export function rows({ live = true, runs = discoverRuns().runs } = {}) {
  const out = [];
  for (const d of runs) {
    const sFile = `${RUNS}/${d}/summary.json`, rFile = `${RUNS}/${d}/results.jsonl`;
    const s = readJson(sFile), rs = readJsonl(rFile);
    const named = new Set(s.tasks ?? []);
    if (rs.some(x => !named.has(x.task))) throw new Error(`${d}: results.jsonl holds a task its summary.json does not name; refusing to read it`);
    if ((s.k ?? 1) > 1) throw new Error(`${d}: k = ${s.k} is not supported by ${ADAPTER} (the task verdict is the fork vote)`);
    const arm = armOf(s), scripted = !!s.scripted;
    const prov = s.provenance ?? {};
    const hashes = Object.fromEntries(Object.entries({ automationbench: prov.automationbenchCommit, uvLock: prov.uvLockSha256, bridge: prov.bridgeSha256,
      toolClient: prov.toolClientSha256, runner: prov.runnerSha256, policy: prov.policyHash, policyFile: prov.policyFileSha256, accounting: prov.accountingSha256,
      harnessManifest: prov.harnessManifestSha256 }).filter(([, v]) => v));
    // A fork refused by the run's cap before launch (forks[].skipped) is not a start: no row, no charge.
    const forks = rs.flatMap(x => (x.forks ?? []).filter(f => !f.skipped).map(f => {
      const got = live && s.live ? liveFork(`${s.live}/host/${x.task}/fork-${f.fork}`) : null;
      return { x, f, lv: got?.incomplete ? null : got, why: got?.incomplete ?? null };
    }));
    const obsMax = observedMax(forks.filter(y => y.lv).map(y => [y.lv.start, y.lv.end]));
    const evidence = scripted || d.endsWith('simple-sanity') ? 'diagnostic' : 'development';
    const split = s.selection?.pool ?? (d.startsWith('raw-haiku') ? 'public (run before the AB-v1 split)' : null);
    for (const { x, f, lv, why: liveWhy } of forks) {
      const r = baseRow({ adapter: ADAPTER, files: [sFile, rFile, ...(lv ? lv.files : [])], experiment: `AB:${s.runId}`, arm, run: s.runId, trial: f.fork ?? 0, taskKey: `automationbench:${x.task}` });
      const o = originOf('automationbench');
      r.task.bed = 'automationbench'; r.task.family = x.domain; r.task.unit = 'task'; r.task.split = split; r.task.cases = 1;
      r.origin = o.origin; r.fidelity = o.fidelity;
      r.provenance['task.key'] = P.copied('results.jsonl task');
      r.provenance['origin.class'] = P.computed(`bed registry (origin.mjs BEDS.automationbench): ${o.why}`);
      r.provenance.fidelity = P.computed('AutomationBench apps are M1 relative to their vendors (FIRST-CLASS-PROGRAMS §5.4); no S5 manifest yet');
      r.evidence = { class: evidence, K: s.k ?? 1 };
      r.provenance['evidence.class'] = P.computed(`summary.json evidence ("${s.evidence}") read as development${evidence === 'diagnostic' ? ', except scripted or sanity runs, which are diagnostic' : ''}`);
      r.models = scripted ? [] : [{ role: 'executor', id: s.model }];
      r.provenance.models = P.copied(scripted ? 'summary.json scripted: true (no model)' : 'summary.json model');
      r.harness = { id: s.harness?.id ?? (s.arm ? 'none (A0)' : 'none (raw runner)'), version: s.harness?.version ?? null, hashes };
      r.provenance['harness.hashes'] = P.copied('summary.json provenance (AutomationBench commit, uv.lock, bridge, tool client, runner, policy, accounting, harness manifest)');
      // verdict: AutomationBench's own assertions
      const fin = x.final ?? f;
      if (fin.grade_error) {
        r.verdict = { ...r.verdict, kind: 'none', excluded: true };
        r.provenance.verdict = P.copied(`results.jsonl final.grade_error: ${String(fin.grade_error).slice(0, 80)}`);
        r.provenance['verdict.oracle.id'] = P.na('grade error: no verdict');
      } else {
        const pass = fin.task_completed_correctly === 1 || fin.task_completed_correctly === true;
        r.verdict = { kind: 'binary', pass, successes: pass ? 1 : 0, total: 1, score: fin.partial_credit ?? null, censored: false, excluded: false,
          oracle: { id: `automationbench@${String(prov.automationbenchCommit ?? 'unknown').slice(0, 7)}:${x.task}`, sha256: x.contract_sha256 ?? null } };
        r.provenance.verdict = P.copied('results.jsonl final.task_completed_correctly (strict) and partial_credit (score)');
        r.provenance['verdict.oracle.id'] = P.computed('AutomationBench assertions at the pinned commit; contract_sha256 identifies the task contract');
      }
      // dollars
      const bound = scripted ? 0 : (s.budgetUsdPerSession ?? null);
      const m = chargeOf({ reportedUsd: f.costUsd ?? 0, costUnknown: !!f.costUnknown, errorCode: f.sessionError ?? null }, bound ?? 0);
      Object.assign(r.usd, { run: f.costUsd ?? null, build: null, reported: f.costUsd ?? null, repriced: null, bound, starts: 1, charged: m.charged, observed: m.observed, imputed: m.imputed, world: null });
      r.provenance['usd.reported'] = P.copied('results.jsonl forks[].costUsd');
      r.provenance['usd.repriced'] = P.missing('session tokens are in the live transcript only; not re-priced in the back-fill');
      r.provenance['usd.bound'] = scripted ? P.computed('scripted: no model call, bound $0') : P.copied('summary.json budgetUsdPerSession');
      r.provenance['usd.charged'] = P.computed('§12 meter (meter.mjs chargeOf): observed cost at max(reported, re-priced); costUnknown or no cost at the session bound');
      r.provenance['usd.build'] = P.na(s.harness ? 'the A1 harness is hand-written, not built per task; its authoring cost is not a per-row cost' : 'no build in this arm');
      r.provenance['usd.world'] = P.missing('the third-party apps came as a $0 shallow clone (research/automationbench-20261014/ACQUISITION.md), but the world as run here is served by our bridge.py and its parity work, written by frontier sessions whose cost was never recorded (as E8\'s world)');
      // timing
      const wall = f.durationMs ?? null;
      r.timing.wallMs = wall; r.timing.timeToDoneMs = wall;
      r.provenance['timing.wallMs'] = P.copied('results.jsonl forks[].durationMs');
      r.provenance['timing.timeToDoneMs'] = P.computed('= durationMs (the session ends when the arm is done; grading is not timed)');
      r.timing.stages = [{ stage: 'session', ms: wall }];
      r.provenance['timing.stages'] = P.copied('results.jsonl forks[].durationMs; grading time is not recorded');
      if (lv) {
        r.timing.startedAt = iso(lv.start); r.timing.endedAt = iso(lv.end);
        if (lv.firstWrite !== null) {
          r.timing.timeToFirstEffectMs = Math.min(Math.max(0, lv.firstWrite - lv.start), wall ?? Infinity);
          r.provenance['timing.timeToFirstEffectMs'] = P.computed('live calls.jsonl: bridge time of the first api_fetch with a mutating method, minus the session start (last transcript timestamp - result.duration_ms; approximate to about 2 s)');
        } else {
          r.provenance['timing.timeToFirstEffectMs'] = P.na('the session made no mutating world call (no effect)');
        }
        if (scripted) { r.timing.components.modelMs = 0; r.provenance['timing.components.modelMs'] = P.computed('scripted: no model'); }
        else if (lv.apiMs !== null) { r.timing.components.modelMs = lv.apiMs; r.provenance['timing.components.modelMs'] = P.copied('live transcript.jsonl result.duration_api_ms'); }
        else r.provenance['timing.components.modelMs'] = P.missing('no duration_api_ms in the live transcript');
        if (r.timing.components.modelMs !== null && wall !== null) {
          r.timing.components.nonModelMs = Math.max(0, wall - r.timing.components.modelMs);
          r.provenance['timing.components.nonModelMs'] = P.computed('durationMs - duration_api_ms (bridge, world calls, harness and CLI together)');
        } else r.provenance['timing.components.nonModelMs'] = P.missing('no model time');
        r.timing.concurrency.observedMax = obsMax;
        r.provenance['timing.concurrency.observedMax'] = obsMax ? P.computed('max overlap of the run\'s reconstructed session intervals (live transcripts)') : P.missing('no intervals');
      } else {
        const why = liveWhy ?? (!live ? 'run without live directories (--no-live)' : s.live ? `live directory ${s.live} not on this machine (or the fork's files are missing)` : 'summary.json names no live directory');
        for (const k of ['timing.timeToFirstEffectMs', 'timing.components.modelMs', 'timing.components.nonModelMs', 'timing.concurrency.observedMax']) r.provenance[k] = P.missing(why);
      }
      r.provenance['timing.components.toolMs'] = P.missing('tool (Bash) time is not separated from bridge and CLI time');
      r.provenance['timing.components.mockMs'] = P.missing('the bridge does not time its world calls (calls.jsonl has one timestamp per step, no duration)');
      r.provenance['timing.components.waits'] = P.missing('rate-limit and queue waits are not timed (the transcript has rate_limit_info status events, not durations)');
      r.provenance['timing.concurrency.configured'] = P.missing('run.mjs --concurrency is not recorded in summary.json (default 4 at HEAD)');
      r.provenance['timing.businessTime.simulatedMs'] = P.na('AutomationBench has no simulated business clock');
      const faults = [f.sessionError, f.harnessError].filter(c => c && ENV.test(String(c))).map(c => ({ code: String(c), n: 1 }));
      r.envFaults = faults;
      r.provenance.envFaults = P.computed('forks[].sessionError / harnessError codes that name an environment fault (rate limit, overload, auth, network, launch, quota)');
      out.push(r);
    }
  }
  return out;
}
