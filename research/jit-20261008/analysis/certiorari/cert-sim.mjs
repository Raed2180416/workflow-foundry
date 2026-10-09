// Row 28 (B17-E1) pilot: a certiorari queue with precedent propagation, on the committed N-version disagreements
// (research/jit-20261008/nversion-records-dev.json: 4 compiled records solvers x 24 dev tasks). $0, no model calls.
//   node research/jit-20261008/analysis/certiorari/cert-sim.mjs [--resamples 10000] [--route-pass 1] [--out cert-sim]
//
// What the JSON holds per (task, solver): status (ok / deopt), pass, score; per task: ok count and the number of distinct
// answers. It holds NO answers. So:
// - Answer groups are inferred: two solvers with different (pass, score) gave different answers (the oracle is a function
//   of the answer); equal (pass, score) may or may not be the same answer. A partition into exactly `distinct` groups that
//   only joins equal-(pass, score) solvers is drawn uniformly per resample where more than one exists (s203 only).
// - "Same decision class / same field / same convention" cannot be read from the data. The match rules use the only
//   observable proxies: which solvers sided together (the split), the drift segment, and which lineage won.
// - The simulated human is the dev oracle (analyst-side only), with an injected error rate e.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, '../../nversion-records-dev.json');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const R = Number(arg('--resamples', 10000)), OUT = arg('--out', 'cert-sim');
const SOLVERS = ['haikuV1', 'opusV1', 'sonnetV1', 'opusV2'];
// Incumbent: the solver whose answer the stream delivers when there is no majority (stream.mjs:547 delivers the compiled
// answer on 'unresolved'). opusV2 is the only solver that answered all 24 (the O/H arm's live version); then the others.
const INCUMBENT = ['opusV2', 'sonnetV1', 'opusV1', 'haikuV1'];
// A 'route' ruling (no candidate is right) sends the case to the interpreter, which passes with probability ROUTE_PASS:
// 1 by default (the Opus agent went 24/24 on these dev seeds, DEV-NOTES D10); --route-pass 0.75 is the Haiku agent's d4
// rate (6/8). An assumption, not an observation: route outcomes are reported apart from side rulings.
const ROUTE_PASS = Number(arg('--route-pass', 1));

// ---------------------------------------------------------------- deterministic PRNG (mulberry32), seeded per cell
const rng = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const hashSeed = s => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const shuffle = (r, xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------------------------------------------------------------- cases
// All set partitions of `items` into exactly k blocks, each block inside one equal-(pass,score) class.
function partitions(items, k, cls) {
  const out = [];
  const rec = (i, blocks) => {
    if (i === items.length) { if (blocks.length === k) out.push(blocks.map(b => [...b])); return; }
    const x = items[i];
    for (const b of blocks) if (cls(b[0]) === cls(x)) { b.push(x); rec(i + 1, blocks); b.pop(); }
    if (blocks.length < k) { blocks.push([x]); rec(i + 1, blocks); blocks.pop(); }
  };
  rec(0, []);
  return out;
}
const data = JSON.parse(readFileSync(DATA, 'utf8'));
const CASES = data.rows.map((row, idx) => {
  const answered = SOLVERS.filter(s => row.runs[s]?.status === 'ok'), refused = SOLVERS.filter(s => row.runs[s] && row.runs[s].status !== 'ok');
  const cls = s => `${row.runs[s].pass}|${row.runs[s].score}`;
  const parts = answered.length ? partitions(answered, row.distinct, cls) : [[]];
  if (!parts.length) throw new Error(`${row.taskKey}: no partition of ${answered.length} answers into ${row.distinct} groups fits the scores`);
  return { idx, taskKey: row.taskKey, seed: Number(row.taskKey.split(':s')[1]), segment: `d${row.difficulty}`, answered, refused,
    passOf: Object.fromEntries(answered.map(s => [s, !!row.runs[s].pass])), parts, ambiguous: parts.length > 1 };
});

// One realised case (partition fixed): groups with pass, kind, the baseline delivery.
function realise(c, part) {
  const groups = part.map(members => ({ members: [...members].sort(), pass: c.passOf[members[0]] }));
  const n = c.answered.length, top = Math.max(0, ...groups.map(g => g.members.length));
  const majority = n >= 2 && groups.length > 1 && top > n / 2 ? groups.find(g => g.members.length === top) : null;
  const kind = n === 0 ? 'none' : n === 1 ? 'single' : groups.length === 1 ? 'unanimous' : majority ? 'majority' : 'split';
  const incumbent = INCUMBENT.find(s => c.answered.includes(s));
  const baseGroup = kind === 'split' ? groups.find(g => g.members.includes(incumbent)) : majority ?? groups[0];
  // Split signature: the answer groups and the refusers (who sided with whom). A proxy for "the same question".
  const signature = `${groups.map(g => g.members.join('+')).sort().join(' | ')} || refused: ${c.refused.join('+') || '-'}`;
  return { ...c, groups, kind, baseGroup, basePass: baseGroup ? baseGroup.pass : false, signature };
}

// ---------------------------------------------------------------- the human
// Correct ruling: a passing group (uniform if several pass), else 'route'. With probability e the ruling is wrong:
// a failing group (uniform) if one exists, else 'route' (rejecting right answers); when no group passes, a wrong ruling
// endorses a (failing) group.
function rule(r, cs, e) {
  const passing = cs.groups.filter(g => g.pass), failing = cs.groups.filter(g => !g.pass);
  const right = passing.length ? { kind: 'side', group: pick(r, passing) } : { kind: 'route' };
  if (r() >= e) return { ...right, correct: true };
  if (passing.length) return failing.length ? { kind: 'side', group: pick(r, failing), correct: false } : { kind: 'route', correct: false };
  return { kind: 'side', group: pick(r, cs.groups), correct: false };
}

// ---------------------------------------------------------------- match rules (precedent scope)
// A precedent from ruled case p applies to case c (c != p, c has >= 1 answer) and says which group of c to deliver
// (or 'route'). null = no match.
const MATCH = {
  // M1 same split: identical signature (same solvers answered, sided together the same way, same refusers).
  M1: (p, ruling, c) => (c.signature === p.signature && c.kind !== 'unanimous' ? applySide(ruling, c) : null),
  // M3 same split and same drift segment (d3 vs d4: a proxy for "same convention regime").
  M3: (p, ruling, c) => (c.signature === p.signature && c.segment === p.segment && c.kind !== 'unanimous' ? applySide(ruling, c) : null),
  // M2 same winner (broad): "the lineage(s) the ruling sided with are right whenever they disagree with the others".
  // Applies to any case with >= 2 groups where the winners that answered all sit in one group. A 'route' ruling has no
  // winner and falls back to M1.
  M2: (p, ruling, c) => {
    if (ruling.kind === 'route') return MATCH.M1(p, ruling, c);
    if (c.groups.length < 2) return null;
    const winners = ruling.group.members.filter(s => c.answered.includes(s));
    if (!winners.length) return null;
    const g = c.groups.find(x => winners.every(w => x.members.includes(w)));
    return g ? { kind: 'side', group: g } : null;
  },
};
// The same-split case's group that holds the ruled group's members (same signature => it exists).
function applySide(ruling, c) {
  if (ruling.kind === 'route') return { kind: 'route' };
  const g = c.groups.find(x => x.members.join('+') === ruling.group.members.join('+'));
  return g ? { kind: 'side', group: g } : null;
}
let routeDraw = () => true;
const outcomePass = d => (d.kind === 'route' ? routeDraw() : d.group.pass);

// ---------------------------------------------------------------- one stream under one policy
// policy: { name, queue: 'Q1'|'Q2', order: 'fifo'|'cert', propagate: null|'M1'|'M2'|'M3', retro: bool }
function runOnce(r, policy, e, budget) {
  routeDraw = () => r() < ROUTE_PASS;
  const cs = CASES.map(c => realise(c, c.ambiguous ? pick(r, c.parts) : c.parts[0]));
  const inQueue = c => c.kind === 'split' || (policy.queue === 'Q2' && c.kind === 'single' && c.refused.length > 0);
  const delivered = new Map();   // idx -> { pass, by: 'ruling'|'precedent', route }
  const st = { rulings: 0, directFix: 0, directHarm: 0, routes: 0, apps: 0, appsCorrect: 0, sideApps: 0, sideAppsCorrect: 0, precFix: 0, precHarm: 0, routeApps: 0 };
  const precedents = [];
  const resolved = new Set();
  const match = policy.propagate ? MATCH[policy.propagate] : null;
  // Cert priority: the queued case whose question recurs most (pending queued cases with its signature), random ties.
  const recurrence = c => cs.filter(x => inQueue(x) && !resolved.has(x.idx) && x.signature === c.signature).length;
  const tie = new Map(cs.map(c => [c.idx, r()]));
  const nextCase = () => {
    const pending = cs.filter(c => inQueue(c) && !resolved.has(c.idx));
    if (!pending.length) return null;
    if (policy.order === 'fifo') return pending[0];
    return pending.sort((a, b) => recurrence(b) - recurrence(a) || tie.get(a.idx) - tie.get(b.idx))[0];
  };
  while (st.rulings < budget) {
    const c = nextCase();
    if (!c) break;
    const ruling = rule(r, c, e);
    st.rulings++; resolved.add(c.idx);
    const pass = ruling.kind === 'route' ? routeDraw() : ruling.group.pass;
    if (ruling.kind === 'route') st.routes++;
    if (pass && !c.basePass) st.directFix++;
    if (!pass && c.basePass) st.directHarm++;
    delivered.set(c.idx, { pass, by: 'ruling' });
    if (!match) continue;
    precedents.push({ from: c.idx, ruling });
    for (const x of cs) {
      if (x.idx === c.idx || delivered.has(x.idx)) continue;            // stare decisis: the first binding decision stands
      if (!policy.retro && x.idx < c.idx) continue;                     // online: a precedent binds later tasks only
      const d = match(c, ruling, x);
      if (!d) continue;
      const p = outcomePass(d);
      st.apps++; if (p) st.appsCorrect++;
      if (d.kind === 'route') st.routeApps++; else { st.sideApps++; if (p) st.sideAppsCorrect++; }
      if (p && !x.basePass) st.precFix++;
      if (!p && x.basePass) st.precHarm++;
      delivered.set(x.idx, { pass: p, by: 'precedent' });
      resolved.add(x.idx);
    }
  }
  const pass = cs.reduce((s, c) => s + (delivered.has(c.idx) ? delivered.get(c.idx).pass : c.basePass ? 1 : 0), 0);
  const basePass = cs.reduce((s, c) => s + (c.basePass ? 1 : 0), 0);
  return { pass, basePass, ...st };
}

const POLICIES = [
  { name: 'A  baseline (no human; stream.mjs:547)', none: true },
  { name: 'B  case-only, FIFO', order: 'fifo', propagate: null, retro: false },
  { name: 'C  case-only, cert priority', order: 'cert', propagate: null, retro: true },
  { name: 'D1 cert + precedent M1 (same split)', order: 'cert', propagate: 'M1', retro: true },
  { name: 'D3 cert + precedent M3 (same split, same segment)', order: 'cert', propagate: 'M3', retro: true },
  { name: 'D2 cert + precedent M2 (same winner; broad)', order: 'cert', propagate: 'M2', retro: true },
  { name: 'Do FIFO online + precedent M1, later tasks only', order: 'fifo', propagate: 'M1', retro: false },
];
const ERRORS = [0, 0.1, 0.2], BUDGETS = [1, 2, 4], QUEUES = ['Q1', 'Q2'];
const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
const r3 = x => Math.round(x * 1000) / 1000;

const results = [];
for (const queue of QUEUES) for (const pol of POLICIES) for (const e of (pol.none ? [0] : ERRORS)) for (const budget of (pol.none ? [0] : BUDGETS)) {
  const r = rng(hashSeed(`${queue}|${pol.name}|${e}|${budget}`));
  const runs = Array.from({ length: R }, () => runOnce(r, { ...pol, queue }, e, budget));
  const m = k => mean(runs.map(x => x[k]));
  const sum = k => runs.reduce((s, x) => s + x[k], 0);
  const rulings = m('rulings');
  results.push({ queue, policy: pol.name, e, budget, resamples: R,
    pass: r3(m('pass')), basePass: r3(m('basePass')), prevented: r3(m('pass') - m('basePass')), rulings: r3(rulings),
    fixedPerRuling: rulings ? r3((m('directFix') + m('precFix')) / rulings) : null, harmPerRuling: rulings ? r3((m('directHarm') + m('precHarm')) / rulings) : null,
    directFix: r3(m('directFix')), directHarm: r3(m('directHarm')), routes: r3(m('routes')),
    precApps: r3(m('apps')), precFix: r3(m('precFix')), precHarm: r3(m('precHarm')), routeApps: r3(m('routeApps')),
    precision: sum('apps') ? r3(sum('appsCorrect') / sum('apps')) : null, sidePrecision: sum('sideApps') ? r3(sum('sideAppsCorrect') / sum('sideApps')) : null,
    pHarmAtLeast1: r3(mean(runs.map(x => (x.precHarm + x.directHarm >= 1 ? 1 : 0)))) });
}

// The dossier's rule, written before reading (dossier 3 E-B17-1): D must beat B by >= 2 prevented misses per stream at
// budget 2, with harm <= 1, or precedent propagation is shelved. Checked per queue, error rate and match rule.
const verdicts = [];
for (const queue of QUEUES) for (const e of ERRORS) {
  const b = results.find(x => x.queue === queue && x.policy.startsWith('B ') && x.e === e && x.budget === 2);
  for (const d of results.filter(x => x.queue === queue && x.policy.startsWith('D') && x.e === e && x.budget === 2)) {
    const gain = r3(d.pass - b.pass), harm = r3(d.precHarm + d.directHarm);
    verdicts.push({ queue, e, policy: d.policy, gainOverB: gain, harm, pass: gain >= 2 && harm <= 1 });
  }
}
const cases = CASES.map(c => { const x = realise(c, c.parts[0]); return { taskKey: c.taskKey, kind: x.kind, signature: x.signature, groups: x.groups.map(g => `${g.members.join('+')}:${g.pass ? 'P' : 'F'}`).join(' '), basePass: x.basePass, partitions: c.parts.length }; });
const out = { about: 'Certiorari queue pilot on nversion-records-dev.json (B17-E1, synthesis row 28). Dev, K=1, 24 tasks, 4 solvers in 3 lineages; no answers in the data.',
  assumptions: { incumbent: INCUMBENT, routePass: ROUTE_PASS, humanErrorModel: 'correct ruling with prob 1-e; otherwise a wrong side (or a wrong route)', resamples: R },
  cases, results, verdicts };
writeFileSync(path.join(HERE, `${OUT}.json`), JSON.stringify(out, null, 1) + '\n');

// Markdown tables.
const md = [];
md.push('| queue | policy | e | budget | pass /24 | prevented vs A | rulings | fixed per ruling | harm per ruling | precedent apps | precedent fixes | precedent harm | precision (all / side-only) | P(harm ≥ 1) |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const x of results) md.push(`| ${x.queue} | ${x.policy} | ${x.e} | ${x.budget} | ${x.pass.toFixed(2)} | ${x.prevented.toFixed(2)} | ${x.rulings.toFixed(2)} | ${x.fixedPerRuling ?? '—'} | ${x.harmPerRuling ?? '—'} | ${x.precApps} | ${x.precFix} | ${x.precHarm} | ${x.precision ?? '—'} / ${x.sidePrecision ?? '—'} | ${x.pHarmAtLeast1} |`);
md.push('', '| queue | e | policy (budget 2) | gain over B | harm | dossier rule (gain ≥ 2, harm ≤ 1) |', '|---|---|---|---|---|---|');
for (const v of verdicts) md.push(`| ${v.queue} | ${v.e} | ${v.policy} | ${v.gainOverB} | ${v.harm} | ${v.pass ? 'pass' : 'fail'} |`);
md.push('', '| task | kind | groups (pass) | baseline delivers pass | partitions consistent with the data |', '|---|---|---|---|---|');
for (const c of cases) md.push(`| ${c.taskKey.replace('records:dev:', '')} | ${c.kind} | ${c.groups || '—'} | ${c.basePass ? 'yes' : 'no'} | ${c.partitions} |`);
writeFileSync(path.join(HERE, `${OUT}.md`), md.join('\n') + '\n');
console.log(md.join('\n'));
