#!/usr/bin/env node
// Score the diverse-judges verifier on the verifier lab (development evidence; devTrain dev60 only).
//
//   node eval.mjs --vlab <lab dir> --dj <judgments dir> [--strata <task->class json>] [--m3-results a.jsonl,b.jsonl] [--json out.json]
//
// Labels are read here, after judging, and never reach a judge. Fitted parts (Platt calibration per judge, the stacked
// combination) are fitted on 4 leave-task-out folds and applied to the 5th, rotating through all 5. Folds 3 and 4 were
// not looked at while the judge prompt was designed (the pilot read rows of fold 0 only); they are reported separately.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { auroc, bootstrap, brier, confusion, ece, fitLogistic, logit } from './metrics.mjs';
import { JUDGE_VERSION } from './judge.mjs';

const a = {};
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].slice(2)] = process.argv[i + 1];
const lab = await import(pathToFileURL(path.join(path.resolve(a.vlab), 'load.mjs')).href);
const rows = lab.loadRows({ canonicalOnly: true });
const byId = new Map(rows.map(r => [r.rowId, r]));
const y = r => (lab.passed(r) ? 1 : 0);
const strata = a.strata ? JSON.parse(readFileSync(a.strata, 'utf8')) : {};
const FORK3 = ['m3-a1c', 'haiku-a1c', 'haiku-a1'];
const REPORTED6 = ['m3-a1c', 'sonnet-a1', 'haiku-a1c', 'sonnet-a0', 'haiku-a1', 'haiku-a0'];
const HELDOUT = [3, 4];

// ---- judgments: J[name] = Map(rowId -> {pass, strictPass, p, reqScore, costUsd, tokens})
const J = {};
for (const f of readdirSync(a.dj).filter(f => /^judgments-.*\.jsonl$/.test(f))) {
  for (const l of readFileSync(path.join(a.dj, f), 'utf8').split('\n').filter(Boolean)) {
    const j = JSON.parse(l);
    if (j.version !== JUDGE_VERSION || !j.ok || !j.verdict || !byId.has(j.rowId)) continue;
    const name = j.variant === 'world' ? j.judge : `${j.judge}-${j.variant}`;
    J[name] ??= new Map();
    const u = j.usage ?? {};
    J[name].set(j.rowId, { pass: j.verdict.pass, strictPass: j.verdict.strictPass, p: j.verdict.confidence, reqScore: j.verdict.reqScore, nReq: j.verdict.nReq,
      costUsd: j.costUsd ?? 0, tokens: (u.inputTokens ?? 0) + (u.outputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0) });
  }
}
const judges = Object.keys(J).sort();

// ---- leave-fold-out Platt calibration per judge: cal[name] = Map(rowId -> calibrated p)
const cal = {};
for (const name of judges) {
  cal[name] = new Map();
  const items = [...J[name].entries()].map(([id, v]) => ({ id, r: byId.get(id), x: [logit(v.p)] }));
  for (let k = 0; k < 5; k++) {
    const train = items.filter(i => i.r.fold !== k), test = items.filter(i => i.r.fold === k);
    if (!test.length) continue;
    const m = fitLogistic(train.map(i => i.x), train.map(i => y(i.r)), { l2: 0.1 });
    for (const i of test) cal[name].set(i.id, m.predict(i.x));
  }
}

// ---- combinations over a set of judges (only rows every member judged)
function combo(members) {
  const ids = [...J[members[0]].keys()].filter(id => members.every(m => J[m].has(id)));
  const out = new Map();
  // stacked logistic regression on the members' logit(p), fitted leave-fold-out
  const items = ids.map(id => ({ id, r: byId.get(id), x: members.map(m => logit(J[m].get(id).p)) }));
  const stack = new Map();
  for (let k = 0; k < 5; k++) {
    const train = items.filter(i => i.r.fold !== k), test = items.filter(i => i.r.fold === k);
    if (!test.length || !train.length) continue;
    const m = fitLogistic(train.map(i => i.x), train.map(i => y(i.r)), { l2: 0.5 });
    for (const i of test) stack.set(i.id, m.predict(i.x));
  }
  for (const id of ids) {
    const vs = members.map(m => J[m].get(id));
    const votes = vs.filter(v => v.pass).length;
    out.set(id, {
      votes, n: members.length,
      majority: votes * 2 > members.length, all: votes === members.length, any: votes > 0,
      meanP: vs.reduce((s, v) => s + v.p, 0) / vs.length,
      meanCal: members.reduce((s, m) => s + cal[m].get(id), 0) / members.length,
      stack: stack.get(id),
      minP: Math.min(...vs.map(v => v.p)),
    });
  }
  return out;
}

const fmt = (x, d = 3) => (x === null || x === undefined || Number.isNaN(x) ? '–' : typeof x === 'number' ? x.toFixed(d) : String(x));

// ---- classification report for a scorer over a row filter
function classify(name, get, filter) {
  const ids = [...get.keys()].filter(id => filter(byId.get(id)));
  const items = ids.map(id => ({ r: byId.get(id), v: get.get(id) }));
  return { name, items };
}
function clsRow({ name, items }, decide, score, calP) {
  const c = confusion(items.map(({ r, v }) => ({ y: y(r), d: decide(v) })));
  const au = auroc(items.map(({ r, v }) => ({ y: y(r), s: score(v) })));
  const ci = bootstrap(groupByTask(items), s => auroc(s.flat().map(({ r, v }) => ({ y: y(r), s: score(v) }))), { reps: 1000 });
  const pr = calP ? items.map(({ r, v }) => ({ y: y(r), p: calP(v, r) })).filter(x => Number.isFinite(x.p)) : null;
  return { name, n: c.n, pos: c.tp + c.fn, accepted: c.accepted, tp: c.tp, fp: c.fp, fn: c.fn, tn: c.tn, precision: c.precision, recall: c.recall, f1: c.f1, accuracy: c.accuracy, failRecall: c.failRecall,
    auroc: au, aurocCI: ci ? [ci.lo, ci.hi] : null, brier: pr ? brier(pr) : null, ece: pr ? ece(pr) : null };
}
function groupByTask(items) {
  const g = new Map();
  for (const it of items) { if (!g.has(it.r.task)) g.set(it.r.task, []); g.get(it.r.task).push(it); }
  return [...g.values()];
}

// ---- selection: per task pick the candidate with the highest score (ties -> arm order: the best single arm first)
function select(groups, score) {
  let pass = 0;
  const picks = new Map();
  for (const [task, rs] of groups) {
    const best = [...rs].sort((p, q) => (score(q) - score(p)) || (lab.ARM_ORDER.indexOf(p.arm) - lab.ARM_ORDER.indexOf(q.arm)))[0];
    picks.set(task, best);
    if (lab.passed(best)) pass++;
  }
  return { pass, picks };
}
function selectionGroups(arms, needJudges, taskFilter = () => true) {
  const g = new Map();
  for (const r of rows) {
    if (!arms.includes(r.arm) || !taskFilter(r.task)) continue;
    if (!g.has(r.task)) g.set(r.task, []);
    g.get(r.task).push(r);
  }
  for (const [t, rs] of g) {
    if (rs.length < 2 || new Set(rs.map(r => r.arm)).size !== arms.length || !rs.every(r => needJudges.every(m => J[m]?.has(r.rowId)))) g.delete(t);
  }
  return g;
}
function selectionTable(arms, scorers, { taskFilter = () => true, label = '' } = {}) {
  const need = [...new Set(scorers.flatMap(s => s.needs))];
  const g = selectionGroups(arms, need, taskFilter);
  const tasks = [...g.keys()];
  const perArm = Object.fromEntries(arms.map(arm => [arm, tasks.filter(t => g.get(t).some(r => r.arm === arm && lab.passed(r))).length]));
  const bestArm = Object.entries(perArm).sort((p, q) => q[1] - p[1] || lab.ARM_ORDER.indexOf(p[0]) - lab.ARM_ORDER.indexOf(q[0]))[0];
  const oracle = tasks.filter(t => g.get(t).some(lab.passed)).length;
  const mixed = tasks.filter(t => g.get(t).some(lab.passed) && !g.get(t).every(lab.passed)).length;
  const randomExp = tasks.reduce((s, t) => s + g.get(t).filter(lab.passed).length / g.get(t).length, 0);
  const res = [];
  for (const s of scorers) {
    const { pass, picks } = select(g, s.score);
    // paired task-bootstrap CI of (selected - best single arm)
    const per = tasks.map(t => ({ sel: lab.passed(picks.get(t)) ? 1 : 0, base: g.get(t).some(r => r.arm === bestArm[0] && lab.passed(r)) ? 1 : 0 }));
    const ci = bootstrap(per.map(x => [x]), smp => smp.flat().reduce((acc, x) => acc + x.sel - x.base, 0), { reps: 2000 });
    const switched = tasks.filter(t => picks.get(t).arm !== bestArm[0]);
    res.push({ scorer: s.name, pass, gainVsBest: pass - bestArm[1], gainCI: ci ? [ci.lo, ci.hi] : null, switched: switched.length,
      switchedWins: switched.filter(t => lab.passed(picks.get(t)) && !g.get(t).some(r => r.arm === bestArm[0] && lab.passed(r))).length,
      switchedLosses: switched.filter(t => !lab.passed(picks.get(t)) && g.get(t).some(r => r.arm === bestArm[0] && lab.passed(r))).length });
  }
  return { label, arms, tasks: tasks.length, perArm, bestArm: { arm: bestArm[0], pass: bestArm[1] }, oracle, mixed, randomExpected: randomExp, results: res };
}

// ---------------------------------------------------------------- report
const report = { version: JUDGE_VERSION, judges: Object.fromEntries(judges.map(n => [n, J[n].size])), classification: {}, combos: {}, selection: {}, cost: {}, perArm: {} };
const L = [];
const setFilters = {
  'fork3/all folds': r => FORK3.includes(r.arm),
  'fork3/held-out folds 3-4': r => FORK3.includes(r.arm) && HELDOUT.includes(r.fold),
  'fork3/no hard-defect tasks': r => FORK3.includes(r.arm) && strata[r.task] !== 'hard',
  'reported6/all folds': r => REPORTED6.includes(r.arm),
};

const scorersFor = name => ({ decide: v => v.pass, score: v => v.p, calP: (v, r) => cal[name].get(r.rowId) });
L.push(`# diverse-judges evaluation (${JUDGE_VERSION})`, '', `judged rows: ${judges.map(n => `${n} ${J[n].size}`).join(', ')}`, '');

// single judges
for (const [setName, filter] of Object.entries(setFilters)) {
  L.push(`## Single judges: ${setName}`, '', '| judge | n | pass rows | accepted | TP | FP | FN | precision | recall | F1 | fail recall | AUROC p_done [95% CI] | AUROC reqScore | Brier (cal.) | ECE (cal.) |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  report.classification[setName] = {};
  for (const name of judges) {
    const c = classify(name, J[name], filter);
    if (!c.items.length) continue;
    const s = scorersFor(name);
    const row = clsRow(c, s.decide, s.score, s.calP);
    const auReq = auroc(c.items.map(({ r, v }) => ({ y: y(r), s: v.reqScore })));
    const strict = confusion(c.items.map(({ r, v }) => ({ y: y(r), d: v.strictPass })));
    report.classification[setName][name] = { ...row, aurocReqScore: auReq, strictPass: strict };
    L.push(`| ${name} | ${row.n} | ${row.pos} | ${row.accepted} | ${row.tp} | ${row.fp} | ${row.fn} | ${fmt(row.precision)} | ${fmt(row.recall)} | ${fmt(row.f1)} | ${fmt(row.failRecall)} | ${fmt(row.auroc)} [${fmt(row.aurocCI?.[0], 2)}, ${fmt(row.aurocCI?.[1], 2)}] | ${fmt(auReq)} | ${fmt(row.brier)} | ${fmt(row.ece)} |`);
  }
  // own-checks baseline (A1-C pipelines only)
  const own = rows.filter(r => filter(r) && r.selfCheck?.kind === 'a1c-checks');
  if (own.length) {
    const c = confusion(own.map(r => ({ y: y(r), d: r.selfCheck.termination === 'all checks pass' })));
    const au = auroc(own.map(r => ({ y: y(r), s: r.selfCheck.nChecks ? 1 - (r.selfCheck.nFail + 0.5 * (r.selfCheck.nUndecided ?? 0)) / r.selfCheck.nChecks : 0 })));
    report.classification[setName]['own-checks (A1-C rows)'] = { ...c, auroc: au };
    L.push(`| own checks (A1-C rows only) | ${c.n} | ${c.tp + c.fn} | ${c.accepted} | ${c.tp} | ${c.fp} | ${c.fn} | ${fmt(c.precision)} | ${fmt(c.recall)} | ${fmt(c.f1)} | ${fmt(c.failRecall)} | ${fmt(au)} | – | – | – |`);
  }
  L.push('');
}

// combinations
const COMBOS = [['haiku', 'mercury'], ['haiku', 'mercury', 'sonnet'], ['haiku', 'sonnet'], ['mercury', 'sonnet']].filter(c => c.every(m => J[m]));
const comboMaps = {};
for (const members of COMBOS) comboMaps[members.join('+')] = combo(members);
for (const [setName, filter] of Object.entries(setFilters).filter(([k]) => k.startsWith('fork3'))) {
  L.push(`## Combinations: ${setName}`, '', '| members | rule | n | pass rows | accepted | precision | recall | F1 | fail recall | AUROC | Brier |', '|---|---|---|---|---|---|---|---|---|---|---|');
  report.combos[setName] = {};
  for (const [cname, m] of Object.entries(comboMaps)) {
    const items = [...m.entries()].filter(([id]) => filter(byId.get(id))).map(([id, v]) => ({ r: byId.get(id), v }));
    if (!items.length) continue;
    const rules = [
      [`majority vote${m.values().next().value?.n === 2 ? ' (= both pass)' : ''}`, v => v.majority, v => v.votes + v.meanP / 10, null],
      ['all pass (unanimous)', v => v.all, v => v.minP, null],
      ['any pass', v => v.any, v => v.votes, null],
      ['mean raw p_done ≥ 0.5', v => v.meanP >= 0.5, v => v.meanP, v => v.meanP],
      ['mean calibrated p ≥ 0.5', v => v.meanCal >= 0.5, v => v.meanCal, v => v.meanCal],
      ['stacked logistic ≥ 0.5', v => v.stack >= 0.5, v => v.stack, v => v.stack],
    ];
    report.combos[setName][cname] = {};
    for (const [rname, decide, score, p] of rules) {
      const c = confusion(items.map(({ r, v }) => ({ y: y(r), d: decide(v) })));
      const au = auroc(items.map(({ r, v }) => ({ y: y(r), s: score(v) })));
      const br = p ? brier(items.map(({ r, v }) => ({ y: y(r), p: p(v) }))) : null;
      report.combos[setName][cname][rname] = { ...c, auroc: au, brier: br };
      L.push(`| ${cname} | ${rname} | ${c.n} | ${c.tp + c.fn} | ${c.accepted} | ${fmt(c.precision)} | ${fmt(c.recall)} | ${fmt(c.f1)} | ${fmt(c.failRecall)} | ${fmt(au)} | ${fmt(br)} |`);
    }
  }
  L.push('');
}

// acceptance by arm (does a judge just prefer one pipeline's style?)
L.push('## Acceptance by arm (fork3 rows, all folds)', '', '| arm | true pass | ' + judges.map(n => `${n} accepts`).join(' | ') + ' |', '|---|---|' + judges.map(() => '---').join('|') + '|');
for (const arm of REPORTED6) {
  const rs = rows.filter(r => r.arm === arm);
  report.perArm[arm] = { truePass: rs.filter(lab.passed).length, n: rs.length };
  const cells = judges.map(n => { const js = rs.filter(r => J[n].has(r.rowId)); report.perArm[arm][n] = { judged: js.length, accepted: js.filter(r => J[n].get(r.rowId).pass).length }; return js.length ? `${js.filter(r => J[n].get(r.rowId).pass).length}/${js.length}` : '–'; });
  L.push(`| ${arm} | ${rs.filter(lab.passed).length}/${rs.length} | ${cells.join(' | ')} |`);
}
L.push('');

// selection
const single = n => ({ name: `${n} p_done`, needs: [n], score: r => J[n].get(r.rowId).p });
const calScorer = n => ({ name: `${n} calibrated p`, needs: [n], score: r => cal[n].get(r.rowId) });
const comboScorer = (members, key, label) => ({ name: `${members.join('+')} ${label}`, needs: members, score: r => comboMaps[members.join('+')].get(r.rowId)[key] });
const voteScorer = members => ({ name: `${members.join('+')} votes (tie: mean p)`, needs: members, score: r => { const v = comboMaps[members.join('+')].get(r.rowId); return v.votes + v.meanP / 10; } });
const ownChecks = { name: 'own checks (A1-C all-pass=1, A1=0.5)', needs: [], score: r => (r.selfCheck?.kind === 'a1c-checks' ? (r.selfCheck.termination === 'all checks pass' ? 1 : 0) : 0.5) };
const keepBest = (n, arm) => ({ name: `${n}: keep ${arm} unless judged fail`, needs: [n], score: r => (r.arm === arm ? (J[n].get(r.rowId).pass ? 2 : 0) : J[n].get(r.rowId).p) });

const fork3Scorers = [ownChecks,
  ...judges.filter(n => !n.includes('-')).flatMap(n => [single(n), calScorer(n)]),
  ...(J['haiku-diffonly'] ? [single('haiku-diffonly')] : []),
  ...COMBOS.flatMap(m => [voteScorer(m), comboScorer(m, 'meanP', 'mean raw p'), comboScorer(m, 'meanCal', 'mean calibrated p'), comboScorer(m, 'stack', 'stacked')]),
  ...['haiku', 'mercury'].filter(n => J[n]).map(n => keepBest(n, 'm3-a1c'))];
const selSets = [
  ['k=3 forks (m3-a1c, haiku-a1c, haiku-a1): all tasks', FORK3, fork3Scorers.filter(s => !s.needs.includes('sonnet')), {}],
  ['k=3 forks: tasks Sonnet judged', FORK3, fork3Scorers, {}],
  ['k=3 forks: held-out folds 3-4', FORK3, fork3Scorers.filter(s => !s.needs.includes('sonnet')), { taskFilter: t => HELDOUT.includes(rows.find(r => r.task === t).fold) }],
  ['k=3 forks: no hard-defect tasks', FORK3, fork3Scorers.filter(s => !s.needs.includes('sonnet')), { taskFilter: t => strata[t] !== 'hard' }],
  ['6 reported arms (Haiku judge only)', REPORTED6, [single('haiku'), calScorer('haiku')].filter(s => J[s.needs[0]]), {}],
  ['2 forks (m3-a1c, sonnet-a1), Haiku judge', ['m3-a1c', 'sonnet-a1'], [single('haiku')].filter(s => J.haiku), {}],
  ['2 forks (m3-a1c, haiku-a1c)', ['m3-a1c', 'haiku-a1c'], fork3Scorers.filter(s => !s.needs.includes('sonnet') && s !== ownChecks && !s.name.includes('keep')), {}],
];
for (const [label, arms, scorers, opt] of selSets) {
  const t = selectionTable(arms, scorers, { ...opt, label });
  report.selection[label] = t;
  L.push(`## Selection: ${label}`, '', `tasks ${t.tasks}; per arm passes ${Object.entries(t.perArm).map(([k, v]) => `${k} ${v}`).join(', ')}; best single arm ${t.bestArm.arm} ${t.bestArm.pass}; oracle ${t.oracle}; mixed ${t.mixed}; uniform random pick (expected) ${t.randomExpected.toFixed(1)}`, '',
    '| scorer | passes | vs best single arm [95% CI] | switched away from best arm | switch wins | switch losses |', '|---|---|---|---|---|---|');
  for (const r of t.results) L.push(`| ${r.scorer} | ${r.pass} | ${r.gainVsBest >= 0 ? '+' : ''}${r.gainVsBest} [${fmt(r.gainCI?.[0], 0)}, ${fmt(r.gainCI?.[1], 0)}] | ${r.switched} | ${r.switchedWins} | ${r.switchedLosses} |`);
  L.push('');
}

// cost per task
L.push('## Cost', '', '| judge | rows judged | USD total | USD per candidate | tokens per candidate (all kinds) |', '|---|---|---|---|---|');
for (const n of judges) {
  const vs = [...J[n].values()], usd = vs.reduce((s, v) => s + v.costUsd, 0), tok = vs.reduce((s, v) => s + v.tokens, 0);
  report.cost[n] = { rows: vs.length, usd, usdPerCandidate: usd / vs.length, tokensPerCandidate: tok / vs.length };
  L.push(`| ${n} | ${vs.length} | ${usd.toFixed(4)} | ${(usd / vs.length).toFixed(5)} | ${Math.round(tok / vs.length)} |`);
}
const forkCost = arm => rows.filter(r => r.arm === arm).reduce((s, r) => s + (r.costUsd ?? 0), 0) / rows.filter(r => r.arm === arm).length;
report.cost.forksUsdPerTask = Object.fromEntries(FORK3.map(arm => [arm, forkCost(arm)]));
if (a['m3-results']) {
  let tok = 0, n = 0;
  const seen = new Set();
  for (const f of a['m3-results'].split(',')) for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const x = JSON.parse(l);
    const t = x.forks?.[0]?.tokens?.byModel?.['mercury-3']?.total;
    if (Number.isFinite(t) && rows.some(r => r.arm === 'm3-a1c' && r.task === x.task && r.run === path.basename(path.dirname(f)))) { tok += t; n++; seen.add(x.task); }
  }
  report.cost.m3ForkMercuryTokensPerTask = n ? tok / n : null;
  report.cost.m3ForkMercuryTasks = n;
}
L.push('', `Fork (acting) cost per task, Claude USD: ${FORK3.map(arm => `${arm} $${forkCost(arm).toFixed(4)}`).join(', ')}${report.cost.m3ForkMercuryTokensPerTask ? `; m3-a1c Mercury tokens per task ${Math.round(report.cost.m3ForkMercuryTokensPerTask)} (${report.cost.m3ForkMercuryTasks} tasks)` : ''}.`);

console.log(L.join('\n'));
if (a.json) writeFileSync(a.json, JSON.stringify(report, null, 1));
