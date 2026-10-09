// Row 4: double-entry entity count (dossier 2 E3). Two independent $0 entity-count estimators over the raw export, compared with
// the C0 solver's entity count per task; AUROC of the reconciliation gap for oracle failure, with a bootstrap CI over tasks.
//
// Frozen before scoring (written while the C0 run was still in progress, before any gap or AUROC was computed):
// - Row set: the rows C0 delivered (union of its source_rows), so the gap isolates merging, not void handling.
// - Fields come from lib-parse.mjs (raw-line regexes); no model calls; nothing shared with solve.mjs.
// - E1 "DOB+phone blocking": numeric dates of BRIGHTDESK/ATLAS/VENDEX read in the order the row-3 data check picks (both
//   readings kept when it is undecided). Link two rows when their names share a fuzzy token (OSA <= 1, tokens >= 4 chars,
//   exact for 3-char tokens) and either both have a DOB and the DOBs are equal, or at least one has no DOB and the last 8 phone
//   digits are equal. Count connected components.
// - E2 "looser union-find": DOB key ignores day/month order (year + sorted {a, b}); link when names share a fuzzy token and
//   (DOB keys equal OR last-8 phone digits equal), regardless of the other field. Count connected components.
// - Primary score: gap = max(|n_C0 - n_E1|, |n_C0 - n_E2|). Positive class: oracle fail. Kill rule: AUROC < 0.7.
// - Secondary (exploratory): |gap| per estimator and the signed gaps (C0 under-merging makes n_C0 > n_E).
// - CI: 10,000 bootstrap resamples of tasks (seeded), percentile 95%; resamples with one class only are dropped and counted.
import path from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseExport } from './lib-parse.mjs';
import { evidence, decide } from './datecheck.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SCRATCH = process.argv[2] ?? '/var/tmp/foundry-work/c0-testbed';
const p2 = n => String(n).padStart(2, '0');

function osa(a, b) {
  const n = a.length, m = b.length, d = Array.from({ length: n + 1 }, (_, i) => [i, ...new Array(m).fill(0)]);
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[n][m];
}
const tokSim = (x, y) => x === y || (x.length >= 4 && y.length >= 4 && Math.abs(x.length - y.length) <= 1 && osa(x, y) <= 1);
const namesShare = (A, B) => A.some(x => B.some(y => tokSim(x, y)));
const phoneKey = raw => { const d = String(raw ?? '').replace(/\D/g, ''); return d.length >= 7 && !/^0+$/.test(d) ? d.slice(-8) : null; };

function components(n, link) {
  const p = Array.from({ length: n }, (_, i) => i);
  const find = x => (p[x] === x ? x : (p[x] = find(p[x])));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (find(i) !== find(j) && link(i, j)) p[find(i)] = find(j);
  return new Set(p.map((_, i) => find(i))).size;
}

export function estimate(task, keepRows) {
  const rows = parseExport(task.inputs.export).filter(r => keepRows.has(r.row));
  const order = {};
  for (const sys of ['BRIGHTDESK', 'ATLAS', 'VENDEX']) order[sys] = decide(evidence(parseExport(task.inputs.export), sys)).pred;   // null = undecided
  const strictDobs = r => {
    if (!r.dob) return [];
    if (r.dob.kind === 'iso') return [r.dob.iso];
    const { a, b, y } = r.dob, dmy = `${y}-${p2(b)}-${p2(a)}`, mdy = `${y}-${p2(a)}-${p2(b)}`;
    return order[r.sys] === 'DMY' ? [dmy] : order[r.sys] === 'MDY' ? [mdy] : [dmy, mdy];
  };
  const looseKey = r => {
    if (!r.dob) return null;
    if (r.dob.kind === 'num') return `${r.dob.y}|${Math.min(r.dob.a, r.dob.b)}|${Math.max(r.dob.a, r.dob.b)}`;
    const [y, m, d] = r.dob.iso.split('-').map(Number);
    return `${y}|${Math.min(m, d)}|${Math.max(m, d)}`;
  };
  const R = rows.map(r => ({ toks: r.tokens, dobs: strictDobs(r), loose: looseKey(r), phone: phoneKey(r.phone) }));
  const e1 = components(R.length, (i, j) => {
    const a = R[i], b = R[j];
    if (!namesShare(a.toks, b.toks)) return false;
    if (a.dobs.length && b.dobs.length) return a.dobs.some(x => b.dobs.includes(x));
    return !!a.phone && a.phone === b.phone;
  });
  const e2 = components(R.length, (i, j) => {
    const a = R[i], b = R[j];
    if (!namesShare(a.toks, b.toks)) return false;
    return (!!a.loose && a.loose === b.loose) || (!!a.phone && a.phone === b.phone);
  });
  return { rows: rows.length, e1, e2, order };
}

// AUROC with midranks (ties count 0.5): P(score_pos > score_neg).
export function auroc(scores, labels) {
  const pos = scores.filter((_, i) => labels[i]), neg = scores.filter((_, i) => !labels[i]);
  if (!pos.length || !neg.length) return null;
  let s = 0;
  for (const p of pos) for (const q of neg) s += p > q ? 1 : p === q ? 0.5 : 0;
  return s / (pos.length * neg.length);
}
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function bootstrapCI(scores, labels, B = 10000, seed = 20261009) {
  const rnd = mulberry32(seed), n = scores.length, vals = [];
  let dropped = 0;
  for (let b = 0; b < B; b++) {
    const idx = Array.from({ length: n }, () => Math.floor(rnd() * n));
    const v = auroc(idx.map(i => scores[i]), idx.map(i => labels[i]));
    if (v === null) dropped++; else vals.push(v);
  }
  vals.sort((x, y) => x - y);
  return { lo: vals[Math.floor(0.025 * vals.length)], hi: vals[Math.ceil(0.975 * vals.length) - 1], kept: vals.length, dropped };
}

function main() {
  const resultsFile = path.join(HERE, 'outputs', 'c0-runs', 'results.jsonl');
  const results = readFileSync(resultsFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const rows = [];
  for (const r of results) {
    const task = JSON.parse(readFileSync(path.join(SCRATCH, 'tasks', `s${r.seed}.json`), 'utf8'));
    const labels = JSON.parse(readFileSync(path.join(SCRATCH, 'labels', `s${r.seed}.json`), 'utf8'));
    const out = JSON.parse(readFileSync(path.join(HERE, 'outputs', 'c0-runs', `s${r.seed}`, 'output.json'), 'utf8'));
    const keep = new Set((out?.records ?? []).flatMap(x => x.source_rows));
    const est = estimate(task, keep);
    const nC0 = out?.records?.length ?? 0;
    // Analyst side: the truth count over the same row set (people with at least one kept row).
    const truthOnKept = new Set([...keep].map(row => labels.personOf[row]).filter(x => x != null)).size;
    rows.push({ seed: r.seed, difficulty: r.difficulty, pass: r.pass, nC0, e1: est.e1, e2: est.e2, truthE: labels.entities, truthOnKept,
      g1: nC0 - est.e1, g2: nC0 - est.e2, gap: Math.max(Math.abs(nC0 - est.e1), Math.abs(nC0 - est.e2)), keptRows: est.rows });
  }
  const fail = rows.map(r => !r.pass);
  const score = (name, f) => { const s = rows.map(f); return { name, auroc: auroc(s, fail), ci: bootstrapCI(s, fail) }; };
  const metrics = [
    score('primary: max(|C0-E1|, |C0-E2|)', r => r.gap),
    score('|C0-E1|', r => Math.abs(r.g1)), score('|C0-E2|', r => Math.abs(r.g2)),
    score('signed C0-E1', r => r.g1), score('signed C0-E2', r => r.g2),
    score('oracle-side reference: C0 - truthOnKept (not computable without the oracle)', r => r.nC0 - r.truthOnKept),
  ];
  // Exploratory (added after the primary was computed): difficulty confounds the gap (d4 has more rows and most failures), so
  // report a difficulty-only baseline and the AUROC over within-difficulty pairs only.
  metrics.push(score('exploratory baseline: difficulty alone', r => r.difficulty));
  const within = f => {
    let s = 0, n = 0;
    for (const p of rows) for (const q of rows) if (!p.pass && q.pass && p.difficulty === q.difficulty) { n++; s += f(p) > f(q) ? 1 : f(p) === f(q) ? 0.5 : 0; }
    return n ? +(s / n).toFixed(3) : null;
  };
  const withinDifficulty = { 'primary gap': within(r => r.gap), '|C0-E1|': within(r => Math.abs(r.g1)), d3: null, d4: null };
  for (const d of [3, 4]) { const rs = rows.filter(r => r.difficulty === d); withinDifficulty[`d${d}`] = auroc(rs.map(r => r.gap), rs.map(r => !r.pass)); }
  const mae = f => +(rows.reduce((s, r) => s + Math.abs(f(r)), 0) / rows.length).toFixed(2);
  const out = { n: rows.length, failures: fail.filter(Boolean).length, metrics, withinDifficulty,
    estimatorError: { 'E1-truthOnKept MAE': mae(r => r.e1 - r.truthOnKept), 'E2-truthOnKept MAE': mae(r => r.e2 - r.truthOnKept), 'C0-truthOnKept MAE': mae(r => r.nC0 - r.truthOnKept) },
    verdict: metrics[0].auroc === null ? 'undefined (one class)' : metrics[0].auroc < 0.7 ? 'KILL (AUROC < 0.7)' : 'survives (AUROC >= 0.7)', rows };
  writeFileSync(path.join(HERE, 'outputs', 'row4.json'), JSON.stringify(out, null, 1));
  console.log('| seed | d | pass | n_C0 | E1 | E2 | truth (kept rows) | truth E | gap |\n|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.seed} | ${r.difficulty} | ${r.pass ? 'pass' : 'FAIL'} | ${r.nC0} | ${r.e1} | ${r.e2} | ${r.truthOnKept} | ${r.truthE} | ${r.gap} |`);
  for (const m of metrics) console.log(`${m.name}: AUROC ${m.auroc?.toFixed(3)} [${m.ci.lo?.toFixed(3)}, ${m.ci.hi?.toFixed(3)}] (dropped ${m.ci.dropped})`);
  console.log(out.estimatorError, out.withinDifficulty, out.verdict);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
