#!/usr/bin/env node
// $0 replays of Δ* v1 (ATTACK §6 Move 1, steps A and B) over STORED dev60 data. DEVELOPER TOOL: development /
// diagnostic evidence, devTrain dev60 only (in-sample for the A1-C arms). It reads grades for scoring, so it is never
// imported by a harness, a verifier or anything that builds a model context; Δ* itself is built from the request, the
// stored inventory or world, and stored reader outputs only (the grade is read after the build, by dstar-score.mjs).
//
//   node experiments/autobench/replay/dstar-replay.mjs closure --vlab <lab dir> --rl2 <rl2 extract.jsonl> --out <file>
//   node experiments/autobench/replay/dstar-replay.mjs pointers --vlab <lab dir> --out <file>
//
// Sources of Δ* (fixed before scoring):
//   a1c    the A1-C Haiku readers (a1c-dev60-dn pipeline/ledgers.json, 3 readers) over that run's inventory (PRIMARY: the
//          arm whose 14 broken-guardrail tasks define step A's denominator);
//   m3     the A1-C Mercury readers (m3-a1c ledgers, 3 readers) over the m3 inventory;
//   rl2    the requirement-ledger-v2 Haiku readers (rl2-extract-v3, 3 readers) over the a1c inventory (pointers bridged
//          through the lab's canonical initial world);
//   union  a1c + rl2 readers pooled (6 readers: a hard disposition needs 2 verified votes).
// Scoring (fixed before scoring; ATTACK's preregistered thresholds are applied verbatim in summarize()):
//   closure recall   a broken guardrail of a haiku-a1c failing world is REACHED when a hard Δ* assertion FAILS on that
//                    world and aligns with it (dstar-score.mjs aligns); a task is reached when one of its guardrails is;
//   false exclusion  among (target, member) pairs that a positive assertion requires, the share Δ* hard-excludes;
//   passing flags    passing worlds (all six arms; the five-arm set reported apart) on which a hard closure negative fails.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { universesFromInventory } from '../verifier/requirement-ledger-v3/universe.mjs';
import { buildDstar } from '../verifier/requirement-ledger-v3/dstar.mjs';
import { adaptA1cLedger, adaptRl2Extraction, worldBridge } from '../verifier/requirement-ledger-v3/adapters.mjs';
import { evaluateDstar } from '../verifier/requirement-ledger-v3/evaluate.mjs';
import { pointerIndex, normalizePointer } from '../verifier/requirement-ledger-v3/pointers.mjs';
import { aligns, brokenGuardrails, memberNamed, readGrade, scaffoldNegatives, scaffoldTerms, MENTION_TYPES_PREREG } from './dstar-score.mjs';
import { effectsOf, evaluateCheck } from '../verifier/requirement-ledger-v3/check.mjs';
import { worldMapper } from '../verifier/requirement-ledger-v3/evaluate.mjs';
import { norm } from '../verifier/requirement-ledger-v3/lib.mjs';

export const ARMS = Object.freeze(['haiku-a0', 'haiku-a1', 'sonnet-a0', 'sonnet-a1', 'haiku-a1c', 'm3-a1c']);
export const FIVE_ARMS = Object.freeze(['haiku-a0', 'haiku-a1', 'sonnet-a0', 'sonnet-a1', 'haiku-a1c']);
export const SOURCES = Object.freeze(['a1c', 'm3', 'rl2', 'union']);
export const PRIMARY = 'a1c';
// ATTACK §6 Move 1, verbatim thresholds (replay step A)
export const MOVE1_A = Object.freeze({ successTasks: 6, ofTasks: 14, maxTaskShare: 0.30, maxFalseExclusion: 0.05, maxPassingFlagged: 1, killTasksBelow: 4, killFalseExclusionAbove: 0.10, killPassingFlaggedAbove: 3 });

const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
export function hostNowOf(hostDir) {
  const f = `${hostDir}/calls.jsonl`;
  if (!existsSync(f)) return null;
  const first = readFileSync(f, 'utf8').split('\n').find(Boolean);
  const t = first ? JSON.parse(first).t : null;
  return Number.isFinite(t) ? t * 1000 : null;
}

/** Δ* of one task from one source. Inputs are the request, the inventory (or world) and stored reader outputs only. */
export function buildFor(source, { rows, canon, L, rl2ByTask }) {
  const byArm = Object.fromEntries(rows.map(r => [r.arm, r]));
  const a1c = byArm['haiku-a1c'], m3 = byArm['m3-a1c'];
  const inv = r => JSON.parse(readFileSync(`${r.source.host}/pipeline/inventory.json`, 'utf8'));
  const ledgers = r => JSON.parse(readFileSync(`${r.source.host}/pipeline/ledgers.json`, 'utf8')).ledgers.filter(l => l.ok !== false);
  const rl2Readers = () => {
    const ext = (rl2ByTask.get(a1c.task) ?? []);
    if (!ext.length) return [];
    const bridge = worldBridge(L.loadWorlds(canon).initial);
    return ext.map(x => adaptRl2Extraction(x.value, { tag: 'rl2', reader: x.reader, bridge }));
  };
  if (source === 'a1c') return buildDstar({ request: a1c.prompt, universes: universesFromInventory(inv(a1c)), readers: ledgers(a1c).map(l => adaptA1cLedger(l, { tag: 'a1c' })), hostNow: hostNowOf(a1c.source.host) });
  if (source === 'm3') return buildDstar({ request: m3.prompt, universes: universesFromInventory(inv(m3)), readers: ledgers(m3).map(l => adaptA1cLedger(l, { tag: 'm3' })), hostNow: hostNowOf(m3.source.host) });
  if (source === 'rl2') return buildDstar({ request: a1c.prompt, universes: universesFromInventory(inv(a1c)), readers: rl2Readers(), hostNow: hostNowOf(a1c.source.host) });
  if (source === 'union') return buildDstar({ request: a1c.prompt, universes: universesFromInventory(inv(a1c)), readers: [...ledgers(a1c).map(l => adaptA1cLedger(l, { tag: 'a1c' })), ...rl2Readers()], hostNow: hostNowOf(a1c.source.host) });
  throw new Error(`unknown source ${source}`);
}

const enrich = (D, results) => results.map(r => { const a = D.assertions.find(x => x.id === r.id); return { ...r, basis: a?.basis?.kind ?? null, induced: a?.basis?.induced ?? null, lits: a?.check?.params?.lits ?? (a?.check?.params?.lit ? [a.check.params.lit] : []), target: a?.check?.params?.target?.email ?? null }; });

/** Score one task's Δ* against every arm's stored world. */
export function scoreTask(D, { rows, L, universes }) {
  const out = { arms: {} };
  for (const r of rows) {
    if (!ARMS.includes(r.arm)) continue;
    const W = L.loadWorlds(r);
    const res = enrich(D, evaluateDstar(D, { diff: r.diff, world0: W.initial, final: W.final }));
    const grade = readGrade(r.source.host);
    const passed = r.label.task_completed_correctly === 1;
    const hardFail = res.filter(x => x.hard && x.pass === false);
    const closureNegFail = hardFail.filter(x => x.origin === 'closure' && x.polarity === 'must_not');
    const anyNegFail = hardFail.filter(x => x.polarity === 'must_not');
    const broken = brokenGuardrails(grade);
    const reached = broken.map(g => ({ g, closure: closureNegFail.some(x => aligns(x, g)), any: anyNegFail.some(x => aligns(x, g)), bases: [...new Set(anyNegFail.filter(x => aligns(x, g)).map(x => `${x.origin}:${x.basis}`))] }));
    out.arms[r.arm] = { passed, hardFail: hardFail.length, closureNegFail: closureNegFail.length, anyNegFail: anyNegFail.length,
      flaggedClosure: closureNegFail.length > 0, flaggedAnyNeg: anyNegFail.length > 0, flaggedAnyHard: hardFail.length > 0,
      broken: broken.length, reachedClosure: reached.filter(x => x.closure).length, reachedAny: reached.filter(x => x.any).length,
      reachedRows: reached.map(x => ({ type: x.g.type, mention: MENTION_TYPES_PREREG.has(x.g.type), closure: x.closure, any: x.any, bases: x.bases })),
      flagBases: passed ? [...new Set(closureNegFail.map(x => `${x.basis}${x.induced ? `/${x.induced}` : ''}`))] : [],
      falseFlags: passed ? hardFail.filter(x => x.polarity === 'must_not').map(x => ({ type: x.type, origin: x.origin, basis: x.basis, evidence: String(x.evidence).slice(0, 160) })) : [] };
  }
  // false exclusion: (target, member) pairs a positive assertion requires (scaffold; any arm's grade carries the same assertions)
  const grade = readGrade(rows.find(r => r.arm === 'haiku-a1c').source.host);
  const terms = scaffoldTerms(grade).filter(t => t.polarity === 'must');
  let required = 0, hardExcluded = 0, unknown = 0;
  const examples = [];
  for (const d of D.dispositions) {
    const g = D.groups.find(x => x.key === d.group);
    const u = universes.find(x => x.uid === d.uid);
    const m = u?.members.find(x => x.mid === d.mid);
    if (!g || !m) continue;
    const tkey = g.perItem ? null : g.target.emails.length ? g.target.emails.map(e => `@${norm(e)}`) : g.target.channel ? [`#${norm(g.target.channel.name ?? g.target.channel.id)}`] : null;
    const req = terms.some(t => (g.perItem ? (t.target !== '*' && m.emails.some(e => t.target === `@${norm(e)}`)) || (t.id && memberNamed(m, t)) : (tkey && tkey.includes(t.target) && memberNamed(m, t))));
    if (!req) continue;
    required++;
    if (d.disposition === 'exclude' && d.hard) { hardExcluded++; if (examples.length < 6) examples.push({ group: g.key.split('|')[0], label: d.label, basis: d.basis.kind }); }
    if (d.disposition === 'unknown') unknown++;
  }
  out.falseExclusion = { required, hardExcluded, unknown, examples };
  out.today = D.today;
  out.stats = D.stats;
  out.unknownKinds = D.unknowns.reduce((a, u) => ((a[u.kind] = (a[u.kind] ?? 0) + 1), a), {});
  out.assertionsByOrigin = D.assertions.reduce((a, x) => { const k = `${x.origin}|${x.status}|${x.polarity}`; a[k] = (a[k] ?? 0) + 1; return a; }, {});
  return out;
}

/** The closure-expressibility ceiling (oracle-implied dispositions; dstar-score.mjs scaffoldNegatives) for one task. */
export function scoreScaffold({ rows, L, universes }) {
  const a1c = rows.find(r => r.arm === 'haiku-a1c');
  const grade = readGrade(a1c.source.host);
  const S = scaffoldNegatives(grade, universes);
  const out = { negatives: S.length, expressible: S.filter(x => x.check).length, arms: {} };
  for (const r of rows) {
    if (!ARMS.includes(r.arm)) continue;
    const W = L.loadWorlds(r);
    const eff = effectsOf(r.diff, W.initial);
    const ctx = { mapPtr: worldMapper(W.initial), final: W.final };
    const res = S.map(x => ({ ...x, pass: x.check ? (() => { try { return evaluateCheck(x.check, eff, ctx).pass; } catch { return null; } })() : null }));
    const g = readGrade(r.source.host);
    const broken = (g.assertion_results ?? []).map((a, i) => ({ a, i })).filter(({ a }) => !a.excluded && !a.passed && /_not_|not_exists$|_not$/.test(a.type));
    const passed = r.label.task_completed_correctly === 1;
    out.arms[r.arm] = {
      passed, broken: broken.length,
      expressible: broken.filter(b => S.some(x => x.i === b.i && x.check)).length,
      caught: broken.filter(b => res.some(x => x.i === b.i && x.pass === false)).length,
      mention: broken.filter(b => MENTION_TYPES_PREREG.has(b.a.type)).length,
      mentionCaught: broken.filter(b => MENTION_TYPES_PREREG.has(b.a.type) && res.some(x => x.i === b.i && x.pass === false)).length,
      flagged: passed && res.some(x => x.pass === false),
      flags: passed ? res.filter(x => x.pass === false).map(x => ({ type: x.type, check: x.check.type, member: x.member?.label ?? null })) : [],
    };
  }
  return out;
}

export function summarize(perTask, { primary = PRIMARY } = {}) {
  const S = {};
  for (const source of SOURCES) {
    const rows = Object.entries(perTask).filter(([, v]) => v[source]).map(([task, v]) => ({ task, ...v[source] }));
    const a1cFail = rows.filter(r => r.arms['haiku-a1c'] && !r.arms['haiku-a1c'].passed && r.arms['haiku-a1c'].broken > 0);
    const tasksReached = k => a1cFail.filter(r => r.arms['haiku-a1c'][k] > 0);
    const guardsReached = k => a1cFail.reduce((s, r) => s + r.arms['haiku-a1c'][k], 0);
    const maxShare = k => { const tot = guardsReached(k); return tot ? Math.max(...a1cFail.map(r => r.arms['haiku-a1c'][k] / tot)) : 0; };
    const passing = (arms) => rows.flatMap(r => arms.filter(a => r.arms[a]?.passed).map(a => ({ task: r.task, arm: a, ...r.arms[a] })));
    const p6 = passing(ARMS), p5 = passing(FIVE_ARMS);
    const failing = rows.flatMap(r => ARMS.filter(a => r.arms[a] && !r.arms[a].passed).map(a => ({ task: r.task, arm: a, ...r.arms[a] })));
    const fe = rows.reduce((s, r) => ({ required: s.required + r.falseExclusion.required, hardExcluded: s.hardExcluded + r.falseExclusion.hardExcluded, unknown: s.unknown + r.falseExclusion.unknown }), { required: 0, hardExcluded: 0, unknown: 0 });
    const mention = a1cFail.reduce((s, r) => s + r.arms['haiku-a1c'].reachedRows.filter(x => x.mention && x.any).length, 0);
    const mentionAll = a1cFail.reduce((s, r) => s + r.arms['haiku-a1c'].reachedRows.filter(x => x.mention).length, 0);
    const T = MOVE1_A;
    const closureTasks = tasksReached('reachedClosure').length, feRate = fe.required ? fe.hardExcluded / fe.required : 0;
    const flagged6 = p6.filter(x => x.flaggedClosure).length;
    S[source] = {
      brokenGuardrailTasks: a1cFail.length, brokenGuardrails: a1cFail.reduce((s, r) => s + r.arms['haiku-a1c'].broken, 0),
      closure: { tasks: closureTasks, taskList: tasksReached('reachedClosure').map(r => r.task), guardrails: guardsReached('reachedClosure'), maxTaskShare: +maxShare('reachedClosure').toFixed(3) },
      closurePlusDirect: { tasks: tasksReached('reachedAny').length, taskList: tasksReached('reachedAny').map(r => r.task), guardrails: guardsReached('reachedAny'), maxTaskShare: +maxShare('reachedAny').toFixed(3) },
      mentionBreaksReachedAnyOrigin: `${mention}/${mentionAll}`,
      falseExclusion: { ...fe, rate: +feRate.toFixed(4) },
      passingFlagsByBasis: p6.filter(x => x.flaggedClosure).reduce((a, x) => { for (const b of x.flagBases) a[b] = (a[b] ?? 0) + 1; return a; }, {}),
      reachedByBasis: a1cFail.reduce((a, r) => { for (const row of r.arms['haiku-a1c'].reachedRows) for (const b of row.bases ?? []) a[b] = (a[b] ?? 0) + 1; return a; }, {}),
      passingWorlds: { six: p6.length, five: p5.length, flaggedClosureSix: flagged6, flaggedClosureFive: p5.filter(x => x.flaggedClosure).length, flaggedAnyNegSix: p6.filter(x => x.flaggedAnyNeg).length, flaggedAnyHardSix: p6.filter(x => x.flaggedAnyHard).length,
        flaggedList: p6.filter(x => x.flaggedClosure).map(x => `${x.task}/${x.arm}`) },
      failingWorlds: { six: failing.length, flaggedClosure: failing.filter(x => x.flaggedClosure).length, flaggedAnyNeg: failing.filter(x => x.flaggedAnyNeg).length, flaggedAnyHard: failing.filter(x => x.flaggedAnyHard).length },
      today: rows.reduce((a, r) => ((a[r.today.status] = (a[r.today.status] ?? 0) + 1), a), {}),
      unknowns: rows.reduce((a, r) => { for (const [k, n] of Object.entries(r.unknownKinds)) a[k] = (a[k] ?? 0) + n; return a; }, {}),
      dispositions: rows.reduce((a, r) => ({ members: a.members + r.stats.members, include: a.include + r.stats.include, exclude: a.exclude + r.stats.exclude, unknown: a.unknown + r.stats.unknown, hardExclude: a.hardExclude + r.stats.hardExclude }), { members: 0, include: 0, exclude: 0, unknown: 0, hardExclude: 0 }),
      prereg: {
        success: closureTasks >= T.successTasks && maxShare('reachedClosure') <= T.maxTaskShare && feRate <= T.maxFalseExclusion && flagged6 <= T.maxPassingFlagged,
        kill: closureTasks < T.killTasksBelow || feRate > T.killFalseExclusionAbove || flagged6 > T.killPassingFlaggedAbove,
        rule: 'success: closure recall >= 6 of 14 broken-guardrail tasks, no task over 30% of the numerator, false exclusion <= 5%, <= 1 passing world flagged; kill: < 4 of 14, or false exclusion > 10%, or > 3 passing worlds flagged (ATTACK §6 Move 1)',
      },
    };
  }
  const sc = Object.entries(perTask).filter(([, v]) => v.scaffold).map(([task, v]) => ({ task, ...v.scaffold }));
  const scFail = sc.filter(r => r.arms['haiku-a1c'] && !r.arms['haiku-a1c'].passed && r.arms['haiku-a1c'].broken > 0);
  const scPass = sc.flatMap(r => ARMS.filter(a => r.arms[a]?.passed).map(a => ({ task: r.task, arm: a, ...r.arms[a] })));
  S.scaffold = {
    note: 'oracle-implied dispositions (scoring scaffold): what closure could reach with perfect dispositions, and how often its compiled checks fire on passing worlds (grammar and mention-form breadth). An expressibility ceiling, not a capability.',
    brokenGuardrailTasks: scFail.length,
    expressibleTasks: scFail.filter(r => r.arms['haiku-a1c'].expressible > 0).length,
    caughtTasks: scFail.filter(r => r.arms['haiku-a1c'].caught > 0).length,
    caughtTaskList: scFail.filter(r => r.arms['haiku-a1c'].caught > 0).map(r => r.task),
    guardrails: scFail.reduce((s, r) => s + r.arms['haiku-a1c'].broken, 0),
    expressibleGuardrails: scFail.reduce((s, r) => s + r.arms['haiku-a1c'].expressible, 0),
    caughtGuardrails: scFail.reduce((s, r) => s + r.arms['haiku-a1c'].caught, 0),
    mentionCaught: `${scFail.reduce((s, r) => s + r.arms['haiku-a1c'].mentionCaught, 0)}/${scFail.reduce((s, r) => s + r.arms['haiku-a1c'].mention, 0)}`,
    passingWorlds: scPass.length, passingFlagged: scPass.filter(x => x.flagged).length, passingFlaggedFive: scPass.filter(x => x.flagged && FIVE_ARMS.includes(x.arm)).length,
    flaggedList: scPass.filter(x => x.flagged).map(x => `${x.task}/${x.arm}: ${x.flags.slice(0, 2).map(f => `${f.type}->${f.check}`).join(', ')}`),
  };
  S.primary = primary;
  return S;
}

// ---------------------------------------------------------------------------------------------------------------
// Move 5 $0 step (serving Move 1): pointer normalisation over the stored A1-C reader candidates

export function pointerReplay({ L }) {
  const out = {};
  for (const arm of ['haiku-a1c', 'm3-a1c']) {
    const rows = L.loadRows({ canonicalOnly: true, arms: [arm] });
    const c = { replies: 0, candidates: 0, exactBefore: 0, resolvedAfter: 0, how: {}, ambiguous: 0, unresolved: 0, membersGainingVotes: 0, votePairs: 0, votePairsAfter: 0, examplesUnresolved: [] };
    for (const r of rows) {
      const inv = JSON.parse(readFileSync(`${r.source.host}/pipeline/inventory.json`, 'utf8'));
      const ptrs = new Set(inv.records.map(x => x.ptr));
      const idx = pointerIndex(universesFromInventory(inv));
      const LG = JSON.parse(readFileSync(`${r.source.host}/pipeline/ledgers.json`, 'utf8'));
      const votes = new Map(), votesAfter = new Map();
      for (const l of LG.ledgers) {
        c.replies++;
        for (const q of l.requirements ?? []) for (const cand of q.candidates ?? []) {
          c.candidates++;
          const raw = String(cand.record ?? '');
          const before = ptrs.has(raw);
          if (before) c.exactBefore++;
          const h = normalizePointer(raw, idx);
          if (h.m) { c.resolvedAfter++; c.how[h.how] = (c.how[h.how] ?? 0) + 1; }
          else { if (h.how === 'ambiguous') c.ambiguous++; else c.unresolved++; if (c.examplesUnresolved.length < 8) c.examplesUnresolved.push(raw.slice(0, 80)); }
          const k = `${q.action}|${String(q.target).slice(0, 60)}`;
          if (before) { const key = `${k}|${raw}`; votes.set(key, (votes.get(key) ?? new Set()).add(l.reader)); }
          if (h.m) { const key = `${k}|${h.m.key}`; votesAfter.set(key, (votesAfter.get(key) ?? new Set()).add(l.reader)); }
        }
      }
      c.votePairs += [...votes.values()].reduce((s, x) => s + x.size, 0);
      c.votePairsAfter += [...votesAfter.values()].reduce((s, x) => s + x.size, 0);
      for (const [k, v] of votesAfter) { const b = votes.get(k.replace(/\|[^|]+$/, '|') + k.split('|').pop()); if (v.size > (b?.size ?? 0)) c.membersGainingVotes++; }
    }
    out[arm] = c;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = {};
  for (let i = 0; i < rest.length; i++) { const k = rest[i].replace(/^--/, ''); a[k] = rest[i + 1]; i++; }
  if (!a.vlab) throw new Error('--vlab <lab dir> is required');
  const L = await import(pathToFileURL(path.join(path.resolve(a.vlab), 'load.mjs')).href);
  if (cmd === 'pointers') {
    const res = { evidence: 'development/diagnostic, $0, stored A1-C v1 ledgers (devTrain dev60)', ...pointerReplay({ L }) };
    if (a.out) writeFileSync(a.out, JSON.stringify(res, null, 1));
    process.stdout.write(`${JSON.stringify(res, null, 1)}\n`);
    return;
  }
  if (cmd !== 'closure') throw new Error('usage: dstar-replay.mjs closure|pointers --vlab <dir> [--rl2 <extract.jsonl>] [--out <file>] [--tasks a,b]');
  const rl2ByTask = new Map();
  for (const x of readJsonl(a.rl2 ?? '')) if (x.ok && x.version === 'rl2-extract-v3' && /^haiku:[012]$/.test(x.reader)) { if (!rl2ByTask.has(x.task)) rl2ByTask.set(x.task, []); rl2ByTask.get(x.task).push(x); }
  const all = L.loadRows({ canonicalOnly: true, arms: [...ARMS] });
  const tasks = (a.tasks ? a.tasks.split(',') : [...new Set(all.map(r => r.task))]).sort();
  const perTask = {}, timing = {};
  for (const task of tasks) {
    const rows = all.filter(r => r.task === task);
    const canon = [...L.loadRows({ canonicalOnly: true, tasks: [task] })].sort((x, y) => L.ARM_ORDER.indexOf(x.arm) - L.ARM_ORDER.indexOf(y.arm)).find(r => !r.worlds.initialRebuilt);
    perTask[task] = {};
    for (const source of SOURCES) {
      const t0 = Date.now();
      let D;
      try { D = buildFor(source, { rows, canon, L, rl2ByTask }); } catch (e) { perTask[task][source] = null; process.stderr.write(`[dstar-replay] ${task}/${source}: ${String(e?.message ?? e).slice(0, 200)}\n`); continue; }
      const srcRow = rows.find(r => r.arm === (source === 'm3' ? 'm3-a1c' : 'haiku-a1c'));
      const universes = universesFromInventory(JSON.parse(readFileSync(`${srcRow.source.host}/pipeline/inventory.json`, 'utf8')));
      perTask[task][source] = scoreTask(D, { rows, L, universes });
      timing[source] = (timing[source] ?? 0) + Date.now() - t0;
    }
    try {
      const a1cRow = rows.find(r => r.arm === 'haiku-a1c');
      perTask[task].scaffold = scoreScaffold({ rows, L, universes: universesFromInventory(JSON.parse(readFileSync(`${a1cRow.source.host}/pipeline/inventory.json`, 'utf8'))) });
    } catch (e) { process.stderr.write(`[dstar-replay] ${task}/scaffold: ${String(e?.message ?? e).slice(0, 200)}\n`); }
    process.stderr.write(`[dstar-replay] ${task}: ${SOURCES.map(s => `${s} ${perTask[task][s]?.stats?.hardChecks ?? '-'}h`).join(' ')}\n`);
  }
  const res = { evidence: 'development/diagnostic, $0, in-sample (devTrain dev60 stored runs; oracle-implied labels as scoring scaffold only)', version: 'dstar-replay-v1', tasks: tasks.length, timingMs: timing, summary: summarize(perTask), perTask };
  if (a.out) writeFileSync(a.out, JSON.stringify(res, null, 1));
  process.stdout.write(`${JSON.stringify(res.summary, null, 1)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
