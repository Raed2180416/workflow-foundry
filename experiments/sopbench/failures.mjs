#!/usr/bin/env node
// SOP-Bench phase 2: failure anatomy of a sealed run, as aggregate counts only (per-row records stay under ROWS_ROOT).
// Every graded run gets one primary category (the first that applies):
//   W (workflow): pass | status:<deopt|crash|timeout|no-workflow|env> (deopt also by kind and name) | no-final-output |
//     invalid-json | missing-column | wrong-value
//   A (agent):    pass | violation (L5 audit) | no-final-output | invalid-json | missing-column | wrong-value
// plus tags: the agent's session errors (e.g. max turns), upstream-only passes (lenient grader passes, strict fails),
// wrong columns per SOP (column names only), and flaky rows (some but not all of the k runs pass).
//   node experiments/sopbench/failures.mjs --run p2-sealed [--out <file>]   (default: research/.../runs/<run>/failures.json)
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { WORK_ROOT } from '../../src/executors/claude-code.mjs';
import { RESEARCH, readJson, writeJson } from './lib.mjs';
import { ROWS_ROOT } from './run.mjs';
import { lastFinalOutput, strictVerdict } from './scorer.mjs';

const readRecords = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const inc = (m, k, n = 1) => { m[k] = (m[k] ?? 0) + n; return m; };

export function categorise(r, exp) {
  if (r.strict) return { cat: 'pass', cols: [] };
  if (r.arm === 'W' && r.status !== 'done') return { cat: `status:${r.status}`, sub: r.deopt ? `${r.deopt.kind}:${r.deopt.name}` : null, cols: [] };
  if (r.arm === 'A' && r.violations?.length) return { cat: 'violation', sub: r.violations.map(v => v.replace(/model \S+ reported.*/, 'model reported').slice(0, 60)).join('; '), cols: [] };
  const fo = lastFinalOutput(r.answerText ?? '');
  if (!fo.found) return { cat: 'no-final-output', cols: [] };
  if (!fo.ok) return { cat: 'invalid-json', cols: [] };
  const v = strictVerdict(r.answerText, exp.expected, exp.output_columns);
  const keys = new Set(fo.entries.map(([k]) => k.toLowerCase()));
  const wrong = Object.entries(v.fields).filter(([, ok]) => !ok).map(([c]) => c);
  const missing = wrong.filter(c => !keys.has(c.toLowerCase()));
  return { cat: missing.length ? 'missing-column' : 'wrong-value', cols: wrong };
}

export function anatomy(runId, { rowsRoot = ROWS_ROOT, workRoot = WORK_ROOT } = {}) {
  const recs = readRecords(path.join(rowsRoot, runId, 'runs.sealed.jsonl'));
  const faults = readRecords(path.join(rowsRoot, runId, 'faults.jsonl'));
  const live = path.join(workRoot, 'sopbench', runId);
  const expCache = new Map();
  const expOf = (sop, row) => {
    const k = `${sop}:${row}`;
    if (!expCache.has(k)) expCache.set(k, readJson(path.join(live, 'prep', sop, 'rows', String(row), 'expected.json')));
    return expCache.get(k);
  };
  const out = { runId, evidence: 'SEALED rows; aggregate counts only', runs: recs.length, environmentFaults: faults.length, arms: {} };
  for (const arm of [...new Set(recs.map(r => r.arm))].sort()) {
    const mine = recs.filter(r => r.arm === arm);
    const a = { runs: mine.length, categories: {}, deopts: {}, violations: {}, sessionErrors: {}, upstreamOnlyPasses: 0, bySop: {} };
    for (const r of mine) {
      const c = categorise(r, expOf(r.sop, r.row));
      inc(a.categories, c.cat);
      if (c.cat === 'status:deopt' && c.sub) inc(a.deopts, c.sub);
      if (c.cat === 'violation' && c.sub) inc(a.violations, c.sub);
      if (r.sessionError) inc(a.sessionErrors, r.sessionError);
      if (r.harnessError) inc(a.sessionErrors, 'harness-error');
      if (!r.strict && r.upstream) a.upstreamOnlyPasses++;
      const s = (a.bySop[r.sop] ??= { runs: 0, categories: {}, wrongColumns: {}, rows: {}, flakyRows: 0 });
      s.runs++;
      inc(s.categories, c.cat);
      for (const col of c.cols) inc(s.wrongColumns, col);
      (s.rows[r.row] ??= []).push(Boolean(r.strict));
    }
    for (const s of Object.values(a.bySop)) {
      const rows = Object.values(s.rows);
      s.flakyRows = rows.filter(x => x.some(Boolean) && !x.every(Boolean)).length;
      s.rowsAllFail = rows.filter(x => !x.some(Boolean)).length;
      s.rowsCount = rows.length;
      delete s.rows;
    }
    out.arms[arm] = a;
  }
  return out;
}

export function anatomyMarkdown(an) {
  const lines = [];
  for (const [arm, a] of Object.entries(an.arms)) {
    lines.push(`**${arm}** (${a.runs} runs): ${Object.entries(a.categories).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join(', ')}` +
      `; upstream-only passes ${a.upstreamOnlyPasses}` +
      (Object.keys(a.deopts).length ? `; deopts: ${Object.entries(a.deopts).map(([k, n]) => `${k} ${n}`).join(', ')}` : '') +
      (Object.keys(a.violations).length ? `; violations: ${Object.entries(a.violations).map(([k, n]) => `${k} ${n}`).join(', ')}` : '') +
      (Object.keys(a.sessionErrors).length ? `; session errors: ${Object.entries(a.sessionErrors).map(([k, n]) => `${k} ${n}`).join(', ')}` : ''));
    lines.push('', `| SOP (${arm}) | runs | failing runs by category | rows: flaky / all fail / total | most-missed columns |`, '|---|---|---|---|---|');
    for (const [sop, s] of Object.entries(a.bySop)) {
      const fails = Object.entries(s.categories).filter(([k]) => k !== 'pass').sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join(', ') || '-';
      const cols = Object.entries(s.wrongColumns).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, n]) => `${k} ${n}`).join(', ') || '-';
      lines.push(`| ${sop} | ${s.runs} | ${fails} | ${s.flakyRows} / ${s.rowsAllFail} / ${s.rowsCount} | ${cols} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2), a = {};
  for (let i = 0; i < argv.length; i++) a[argv[i].slice(2)] = argv[++i];
  const an = anatomy(a.run);
  writeJson(a.out ?? path.join(RESEARCH, 'runs', a.run, 'failures.json'), an);
  console.log(anatomyMarkdown(an));
}
