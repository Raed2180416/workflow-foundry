// sweep.mjs: the retroactive sweep after a confirmed latent defect (LIBRARY.md §7.5; BUILD-ORDER step 8; LIBRARY-TESTS T5),
// over flow-v3 journals (trace judge events) and call-host events. $0 by default: unchanged judge calls are answered
// from the journal; a changed judge site goes to a fallback (a $0 stub in tests; a live re-ask in production, capped by
// liveUsdCap, default $0 here, $1 by the design, then owner approval) or is counted unresolved — never silently passed.
//
//   const runs = loadRuns(lib.dir);                                  // the library run log (recordRun) — or any run records
//   const s = await sweep({ library: lib, runs, defect: { hash: h1, version: 1, class: 'pattern-slot', pattern: 'P16', slot: 'BAND', text },
//                           reexec: solverReexec(v2Source, { fallback }) });
//
// A run record: {runId, root: {hash, version}, task: {prompt, inputs}, status, outDigest, trace: [flow-v3 events],
// calls: [call-host events], effects?: [{binding, target, before?}]}. Call events are read in their slice-1 shape (kind
// call-end | call-deopt | call-refused, callee, calleeVersion, path, parent, input | inputFile, outDigest); every other
// kind (profile-warn, interpret-child, phase-start, wide-*, ...) is ignored and counted, so flow-v3 slice 2 events and
// later ones do not break the sweep. Unknown fields are ignored.
//
// Steps (§7.5): 1 scope (every invocation of h@v: a root run of h, or a call event naming it as callee); 2 re-execute each
// past input through the fixed version; 3 diff output digests (outDigestOf) — a changed output, or a fixed version that now
// deopts where the defective one answered, makes the invocation suspect; 4 propagate to every ancestor span and the root
// run, and emit a remediation item per applied effect (compensate when the binding declares a compensating tool, else a
// human queue with the before / after digests); 5 relabel: judgment rows that admitted h@v for a suspect run are labelled
// 'false' (source retro-sweep) and a suspect evidence row moves those runs out of oraclePass / shadowAgree (store.mjs);
// 6 generalise a pattern-slot defect into a proposed checklist line and the list of other components built from that
// pattern; 7 append the sweep record to sweeps.jsonl. Nothing is deleted.
import path from 'node:path';
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { outDigestOf, inputDigestOf } from '../jit/call-host.mjs';
import { runSolver, journalOfTrace } from './run.mjs';
import { failureClassBaseline } from './jev.mjs';
import { checkProfile } from '../jit/profile.mjs';

export const RUNS_FILE = 'runs.jsonl', CHILD_JOURNAL_FILE = 'child-journal.jsonl', SWEEPS_FILE = 'sweeps.jsonl';
export const CALL_KINDS = Object.freeze(['call-end', 'call-deopt', 'call-refused']);
export const DEFAULT_LIVE_USD_CAP = 0;   // the design's default is $1 per sweep; at $0 nothing is re-asked live
const readJsonl = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const judgeEvents = trace => (trace ?? []).filter(e => e?.kind === 'judge');

// ---- the library run log ----
// One row per run of a library item (what the sweep scopes over): the task, the outcome digests, the call-host events
// and the root trace's judge events (its journal). Child journals: one row per child run, keyed by the input digest.
export function recordRun(lib, { runId = `run-${randomUUID().slice(0, 8)}`, hash, version = 1, task, result, effects = [] }) {
  const row = { runId, root: { hash, version }, task: { prompt: task.prompt ?? '', inputs: task.inputs ?? {} }, status: result.status, outDigest: result.status === 'ok' ? outDigestOf(result.output) : null,
    calls: result.events ?? [], trace: judgeEvents(result.trace), ...(effects.length ? { effects } : {}), at: new Date().toISOString() };
  appendFileSync(path.join(lib.dir, RUNS_FILE), JSON.stringify(row) + '\n');
  return row;
}
export function recordChildRun(lib, { callee, version = 1, input, result }) {
  const row = { callee, version, inputDigest: inputDigestOf(input), status: result.status, outDigest: result.status === 'ok' ? outDigestOf(result.output) : null, trace: judgeEvents(result.trace) };
  appendFileSync(path.join(lib.dir, CHILD_JOURNAL_FILE), JSON.stringify(row) + '\n');
  return row;
}
export const loadRuns = dir => readJsonl(path.join(dir, RUNS_FILE));
export const loadChildJournal = dir => readJsonl(path.join(dir, CHILD_JOURNAL_FILE));
// Call-host events as stream.mjs writes them (<armDir>/calls.jsonl: {experiment, idx, version, attempt, childId, ...event})
// grouped into run records (one per experiment / idx / attempt); the root task is not in that file (null).
export function runsFromCallLog(file) {
  const by = new Map();
  for (const e of readJsonl(file)) {
    const id = `${e.experiment ?? 'exp'}:${e.idx ?? e.taskKey ?? '?'}:${e.attempt ?? 0}`;
    if (!by.has(id)) by.set(id, { runId: id, root: { hash: e.rootHash ?? null, version: e.version ?? null }, task: null, status: null, outDigest: null, calls: [], trace: [] });
    by.get(id).calls.push(e);
  }
  return [...by.values()];
}

// ---- step 1: scope ----
// Every invocation of hash@version in the runs: [{runId, path, depth, input, outDigest, status, journal, key}], plus the
// counts of ignored event kinds. journalOf(callEvent) returns a child invocation's judge events (childTrace when the
// event names a readable one, else the child journal by input digest).
export function invocationsOf(runs, { hash, version = null }, { childJournal = [], workRoot = null } = {}) {
  const out = [], ignored = {};
  const byDigest = new Map();
  for (const c of childJournal) if (c.callee === hash && (version == null || c.version === version)) byDigest.set(c.inputDigest, c);
  for (const r of runs) {
    if (r.root?.hash === hash && (version == null || r.root.version === version) && r.task) {
      out.push({ runId: r.runId, path: 'root', depth: 0, input: r.task.inputs, prompt: r.task.prompt, outDigest: r.outDigest ?? null, status: r.status, journal: journalOfTrace(r.trace) });
    }
    for (const e of r.calls ?? []) {
      if (!CALL_KINDS.includes(e?.kind)) { ignored[e?.kind ?? 'unknown'] = (ignored[e?.kind ?? 'unknown'] ?? 0) + 1; continue; }
      if (e.callee !== hash || (version != null && e.calleeVersion != null && e.calleeVersion !== version)) continue;
      if (e.kind === 'call-refused') continue;   // the callee never ran: nothing was produced
      const input = e.input !== undefined ? e.input : e.inputFile && workRoot && existsSync(path.join(workRoot, e.inputFile)) ? JSON.parse(readFileSync(path.join(workRoot, e.inputFile), 'utf8')) : undefined;
      const traced = e.childTrace && workRoot && existsSync(path.join(workRoot, e.childTrace)) ? readJsonl(path.join(workRoot, e.childTrace)) : null;
      const journal = traced ? journalOfTrace(traced) : journalOfTrace(byDigest.get(e.inputDigest)?.trace ?? []);
      out.push({ runId: r.runId, path: e.path, depth: e.depth ?? null, input, prompt: null, outDigest: e.kind === 'call-end' ? e.outDigest ?? null : null,
        status: e.kind === 'call-end' ? 'ok' : 'deopt', journal, key: e.key ?? null, memo: e.memo ?? null });
    }
  }
  return { invocations: out, ignored };
}

// ---- step 2: re-execution through the fixed version ----
// A re-executor for an assembled fixed solver: replays the invocation's journal, then the fallback (a $0 stub), else the
// judge deopts and the invocation is unresolved. liveUsdCap > 0 is refused here: a live re-ask is a paid step.
export function solverReexec(source, { fallback = null, taskTemplate = '', budgetUsd = 0.5, liveUsdCap = DEFAULT_LIVE_USD_CAP, timeoutMs } = {}) {
  if (liveUsdCap > 0) throw new Error('sweep: live re-asks are a paid step; run with liveUsdCap 0 (a fallback table may stand in at $0)');
  return async inv => {
    const r = await runSolver({ source, task: { prompt: inv.prompt ?? taskTemplate, inputs: inv.input }, replay: { journal: inv.journal ?? {}, fallback }, budgetUsd, timeoutMs });
    const sources = r.overrides.map(o => o.source);
    const missed = sources.filter(s => s === 'miss').length;
    return { status: r.status, output: r.output, deopt: r.deopt, journalHits: sources.filter(s => s === 'journal').length, reasked: sources.filter(s => s === 'fallback').length, missed,
      unresolved: missed > 0 && r.status !== 'ok', liveModelCalls: r.liveModelCalls, spentUsd: r.spentUsd };
  };
}

// ---- the latent-defect trigger (§7.5 signals) ----
// A signal is latent-defect evidence when the input was INSIDE the component's profile (outside it is drift) and, for a
// user / host report, only once a replay reproduces it. The failure class is the code baseline of JEV-PORTS §7.
export function latentDefectSignal({ kind, profile = null, input = null, prompt = '', replay = 'not-run', envCodes = [] }) {
  const kinds = ['oracle-disagreement', 'shadow-disagreement', 'checklist-static', 'sibling-defect', 'report'];
  if (!kinds.includes(kind)) throw new Error(`sweep: signal kind is one of ${kinds.join(', ')}`);
  const p = profile && input != null ? checkProfile(profile, { prompt, inputs: input }) : null;
  const novelPaths = p?.novel ? p.reasons.map(r => r.path).filter(Boolean) : [];
  const cls = failureClassBaseline({ replay, envCodes, novelPaths });
  if (kind === 'checklist-static' || kind === 'sibling-defect') return { latent: true, why: kind, failureClass: cls };
  if (envCodes.length) return { latent: false, why: 'an environment fault: retry, no recompile', failureClass: cls };
  if (novelPaths.length) return { latent: false, why: 'the input is outside the profile: drift, not a latent defect', failureClass: cls };
  if (kind === 'report' && replay !== 'same-failure') return { latent: false, why: 'a report is untrusted until a replay reproduces it', failureClass: cls };
  if (replay === 'passed') return { latent: false, why: 'the failure did not repeat on replay (flake)', failureClass: cls };
  return { latent: true, why: `${kind} on an input inside the profile`, failureClass: cls };
}

// ---- the sweep ----
export async function sweep({ library = null, runs, defect, reexec, childJournal = [], workRoot = null, bindings = [], sweepId = `sweep-${randomUUID().slice(0, 8)}`, write = true }) {
  if (!defect?.hash) throw new Error('sweep: defect.hash is required');
  if (typeof reexec !== 'function') throw new Error('sweep: reexec (the fixed version) is required');
  // 1. scope
  const { invocations, ignored } = invocationsOf(runs, { hash: defect.hash, version: defect.version ?? null }, { childJournal, workRoot });
  // 2-3. re-execute and diff
  const results = [];
  let spentUsd = 0, live = 0;
  for (const inv of invocations) {
    if (inv.status !== 'ok' || inv.outDigest == null) { results.push({ ...inv, verdict: 'no-output' }); continue; }
    if (inv.input === undefined) { results.push({ ...inv, verdict: 'unresolved', why: 'input not recorded' }); continue; }
    const r = await reexec(inv);
    spentUsd += r.spentUsd ?? 0; live += r.liveModelCalls ?? 0;
    const after = r.status === 'ok' ? outDigestOf(r.output) : null;
    const verdict = r.unresolved ? 'unresolved' : r.status !== 'ok' ? 'suspect' : after !== inv.outDigest ? 'suspect' : 'stands';
    results.push({ ...inv, verdict, after, afterStatus: r.status, ...(r.deopt ? { afterDeopt: { kind: r.deopt.kind, name: r.deopt.name } } : {}), journalHits: r.journalHits ?? 0, reasked: r.reasked ?? 0, missed: r.missed ?? 0 });
  }
  const suspectInv = results.filter(x => x.verdict === 'suspect');
  // 4. propagate: every ancestor span of a suspect invocation and its root run; effects to remediate.
  const suspectRuns = new Set(suspectInv.map(x => x.runId)), spans = [];
  for (const x of suspectInv) {
    const run = runs.find(r => r.runId === x.runId);
    if (x.path !== 'root') for (const e of run.calls ?? []) if (CALL_KINDS.includes(e.kind) && e.path && x.path.startsWith(`${e.path}/`)) spans.push({ runId: x.runId, path: e.path, callee: e.callee });
    spans.push({ runId: x.runId, path: 'root', callee: run.root?.hash ?? null });
  }
  const ancestors = [...new Map(spans.map(s => [`${s.runId} ${s.path}`, s])).values()];
  const remediation = [];
  for (const id of suspectRuns) for (const eff of runs.find(r => r.runId === id).effects ?? []) {
    const b = bindings.find(x => x.tool === eff.binding || `B:${x.tool}` === eff.binding);
    const before = runs.find(r => r.runId === id).outDigest, after = results.find(x => x.runId === id && x.path === 'root')?.after ?? null;
    remediation.push(b?.effect?.compensate ? { runId: id, effect: eff, action: 'compensate', tool: b.effect.compensate } : { runId: id, effect: eff, action: 'human-queue', diff: { before, after } });
  }
  // 5. relabel judgments that admitted h@v for a suspect run; evidence rows.
  const relabelled = [];
  if (library) {
    for (const j of library.judgmentRows()) {
      const it = j.meta?.item, tk = j.meta?.task;
      if (it?.id !== defect.hash || (defect.version != null && it.version != null && it.version !== defect.version)) continue;
      const hit = suspectInv.some(x => tk?.key === x.runId && (tk.path == null || tk.path === x.path));
      if (hit && j.chosen === 'true' && j.truth !== 'false') { library.labelJudgment(j.id, 'false', { source: 'retro-sweep' }); relabelled.push(j.id); }
    }
    if (library.get(defect.hash) && suspectInv.length) {
      library.addEvidence(defect.hash, { kind: 'suspect', runs: suspectInv.length, sweepId, runIds: [...new Set(suspectInv.flatMap(x => [x.runId, `${x.runId}:${x.path}`]))] });
      if (library.get(defect.hash).status === 'kept') library.transition(defect.hash, 'suspect', { reason: `retro-sweep ${sweepId}` });
    }
  }
  // 6. generalise a pattern-slot defect.
  const generalise = defect.class === 'pattern-slot' && defect.pattern ? {
    proposal: { pattern: defect.pattern, slot: defect.slot ?? null, checklistLine: defect.text ?? null, code: defect.code ?? null, status: 'proposed (a versioned L1 change, LIBRARY §7.8)' },
    toSweep: library ? library.list().filter(e => e.hash !== defect.hash && e.hash !== defect.fixedBy && (e.patterns ?? []).includes(defect.pattern) && !['revoked', 'retired'].includes(e.status)).map(e => e.hash) : [],
  } : null;
  // 7. report.
  const record = { sweepId, at: new Date().toISOString(), defect: { hash: defect.hash, version: defect.version ?? null, class: defect.class ?? null, pattern: defect.pattern ?? null, slot: defect.slot ?? null, text: defect.text ?? null },
    runsScanned: new Set(invocations.map(x => x.runId)).size, invocations: invocations.length, suspect: suspectInv.map(x => ({ runId: x.runId, path: x.path, before: x.outDigest, after: x.after ?? null })),
    suspectRuns: [...suspectRuns].sort(), ancestors, stands: results.filter(x => x.verdict === 'stands').length, unresolved: results.filter(x => x.verdict === 'unresolved').map(x => ({ runId: x.runId, path: x.path, why: x.why ?? 'a changed judge site needs a live re-ask' })),
    noOutput: results.filter(x => x.verdict === 'no-output').length, journalHits: results.reduce((a, x) => a + (x.journalHits ?? 0), 0), reasked: results.reduce((a, x) => a + (x.reasked ?? 0), 0),
    liveModelCalls: live, costUsd: Math.round(spentUsd * 1e6) / 1e6, relabelled, effectsRemediated: remediation, generalise, ignoredEventKinds: ignored };
  if (write && library) appendFileSync(path.join(library.dir, SWEEPS_FILE), JSON.stringify(record) + '\n');
  return record;
}
export const loadSweeps = dir => readJsonl(path.join(dir, SWEEPS_FILE));
