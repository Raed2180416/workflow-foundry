// report.mjs on synthetic per-arm files: success with Wilson CI, totals including unfinished attempts, curves,
// steady state, JIT counts, delivered-by, break-even (observed and projected), the K=1 noise rule, report.md/json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { wilson } from '../../lib/stats.mjs';
import { buildReport, renderMarkdown, breakEven, summarizeArm } from '../report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const close = (a, b, msg, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} != ${b}`);   // the report rounds to 1e-4

function writeArm(runDir, { spec, slug, kind, costs, passes, events = {}, delivered = {}, unbilled = [], faults = 0 }) {
  const dir = path.join(runDir, slug); mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'arm.json'), JSON.stringify({ experiment: 'exp', spec, slug, kind }));
  const rows = costs.map((c, idx) => ({ experiment: 'exp', arm: spec, armSlug: slug, kind, idx, taskKey: `fam:dev:d3:s${idx + 1}`, delivered: delivered[idx] ?? (kind === 'agent' ? 'interpreter' : 'compiled'),
    pass: !!passes[idx], score: passes[idx] ? 1 : 0, costUsd: c, costBreakdown: { interpreter: c }, events: events[idx] ?? [], version: kind === 'jit' && idx >= 2 ? 1 : null, spendIds: [`s${idx}`] }));
  writeFileSync(path.join(dir, 'results.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const ev = [...rows.map(r => ({ kind: 'spend', id: `s${r.idx}`, idx: r.idx, component: 'interpreter', costUsd: r.costUsd })), ...unbilled.map((u, i) => ({ kind: 'spend', id: `u${i}`, idx: costs.length, component: 'interpreter', costUsd: u }))];
  writeFileSync(path.join(dir, 'events.jsonl'), ev.map(e => JSON.stringify(e)).join('\n') + '\n');
  if (faults) writeFileSync(path.join(dir, 'faults.jsonl'), Array.from({ length: faults }, (_, i) => JSON.stringify({ idx: i })).join('\n') + '\n');
}

function fixture(t) {
  const runDir = mkdtempSync(path.join(tmpdir(), 'jit-report-')); t.after(() => rmSync(runDir, { recursive: true, force: true }));
  writeArm(runDir, { spec: 'agent:claude-haiku-5-5', slug: 'agent-claude-haiku-5-5', kind: 'agent', costs: Array(8).fill(0.5), passes: [1, 1, 0, 1, 1, 0, 0, 1] });
  writeArm(runDir, { spec: 'agent:claude-opus-5-5', slug: 'agent-claude-opus-5-5', kind: 'agent', costs: Array(8).fill(1), passes: Array(8).fill(1) });
  writeArm(runDir, { spec: 'jit:claude-haiku-5-5/claude-haiku-5-5', slug: 'jit-claude-haiku-5-5--claude-haiku-5-5', kind: 'jit', costs: [0.5, 0.5, 2.5, 0.05, 0.05, 0.05, 0.05, 0.05],
    passes: [1, 1, 1, 1, 1, 1, 1, 0], unbilled: [0.3], faults: 1,
    delivered: { 0: 'interpreter', 1: 'interpreter', 4: 'interpreter', 5: 'adjudicated' },
    events: {
      2: [{ kind: 'compile-attempt' }, { kind: 'fallback-compile' }, { kind: 'compile-attempt' }, { kind: 'compile', version: 1 }],
      3: [{ kind: 'shadow', agree: true }],
      4: [{ kind: 'deopt', deoptKind: 'guard' }, { kind: 'interpret', role: 'interpreter', nestedModelAttempts: 1 }],
      5: [{ kind: 'shadow', agree: false }, { kind: 'disagree' }, { kind: 'adjudicate', outcome: 'interpreter' }, { kind: 'regression' }],
      6: [{ kind: 'compile-attempt' }, { kind: 'recompile', version: 2 }, { kind: 'crash' }],
      7: [{ kind: 'compile-attempt' }, { kind: 'rejected' }, { kind: 'shadow', agree: false }, { kind: 'disagree' }, { kind: 'adjudicate', outcome: 'none' }, { kind: 'unresolved' }],
    } });
  writeArm(runDir, { spec: 'static:research/x/B1-haiku-records-k1/solve.mjs', slug: 'static-B1-haiku-records-k1-solve', kind: 'static', costs: [4, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1], passes: Array(8).fill(1) });
  return runDir;
}

test('per-arm summary: success with Wilson CI, totals with unfinished attempts, steady state, counts, delivered-by', t => {
  const rep = buildReport(fixture(t));
  assert.equal(rep.arms.length, 4); assert.match(rep.evidence, /development/);
  const jit = rep.arms.find(a => a.kind === 'jit'), haiku = rep.arms.find(a => a.spec === 'agent:claude-haiku-5-5');
  assert.equal(haiku.successes, 5); assert.equal(haiku.tasks, 8);
  const ci = wilson(5, 8); close(haiku.ci.lo, Math.round(ci.lo * 1e4) / 1e4, 'ci lo'); close(haiku.ci.hi, Math.round(ci.hi * 1e4) / 1e4, 'ci hi');
  close(haiku.totalUsd, 4, 'haiku total'); close(haiku.usdPerSuccess, 4 / 5, 'haiku $/success');
  close(jit.rowsUsd, 3.75, 'jit rows'); close(jit.unbilledUsd, 0.3, 'jit unfinished'); close(jit.totalUsd, 4.05, 'jit total'); close(jit.usdPerSuccess, 4.05 / 7, 'jit $/success');
  assert.deepEqual(jit.steadyState, { fromIdx: 4, tasks: 4, successes: 3, successRate: 0.75, usdPerTask: 0.05 });
  assert.deepEqual(jit.deliveredBy, { interpreter: 3, compiled: 4, adjudicated: 1 });
  const c = jit.counts;
  assert.equal(c.compiles, 2); assert.equal(c.recompiles, 1); assert.equal(c.compileAttempts, 4); assert.equal(c.fallbackCompiles, 1); assert.equal(c.rejected, 1);
  assert.deepEqual(c.deoptsByKind, { guard: 1 }); assert.equal(c.crashes, 1); assert.equal(c.shadows, 3); assert.equal(c.disagreements, 2);
  assert.deepEqual(c.adjudications, { interpreter: 1, none: 1 }); assert.equal(c.regressions, 1); assert.equal(c.unresolved, 1); assert.equal(c.faults, 1);
  assert.equal(c.nestedModelAttempts, 1);
  assert.deepEqual(jit.curve.slice(0, 3).map(p => [p.cumSuccesses, p.cumUsd]), [[1, 0.5], [2, 1], [3, 3.5]]);
});

test('break-even against each agent arm (observed and projected) and the K=1 noise rule', t => {
  const rep = buildReport(fixture(t));
  const jit = rep.arms.find(a => a.kind === 'jit'), stat = rep.arms.find(a => a.kind === 'static');
  // JIT vs Haiku agent: cumulative gap 0,0,2,1.55,1.1,0.65,0.2,-0.25 -> at or below from idx 7 on
  assert.equal(jit.breakEven['agent:claude-haiku-5-5'].observedIdx, 7);
  assert.equal(jit.breakEven['agent:claude-opus-5-5'].observedIdx, 3);
  // static vs Haiku: never below in 8 tasks, last-half $/task 0.1 < 0.5: projected ceil(7 + 0.7 / 0.4) = 9
  const sh = stat.breakEven['agent:claude-haiku-5-5'];
  assert.equal(sh.observedIdx, null); assert.equal(sh.projectedIdx, 9); assert.match(sh.note, /projected/); close(sh.cumGapUsd, 0.7, 'gap');
  // the agent arms are compared with each other, not with themselves
  assert.deepEqual(Object.keys(rep.arms.find(a => a.spec === 'agent:claude-haiku-5-5').breakEven), ['agent:claude-opus-5-5']);
  assert.deepEqual(jit.vsAgents['agent:claude-haiku-5-5'], { successGap: 2, successRateGap: 0.25, noise: true }, 'a gap under 3 is noise');
  assert.deepEqual(stat.vsAgents['agent:claude-haiku-5-5'], { successGap: 3, successRateGap: 0.375, noise: false });
  assert.equal(jit.vsAgents['agent:claude-opus-5-5'].successGap, -1);
  assert.match(rep.noiseRule, /under 3 points/);
});

test('break-even helper: unreached with a higher steady-state cost, no shared tasks', () => {
  const arm = (costs, done = costs.map(() => true)) => {
    let cum = 0; const curve = costs.map((c, idx) => { cum += c; return { idx, done: done[idx], costUsd: c, cumUsd: cum }; });
    const last = costs.slice(Math.ceil(costs.length / 2)); return { curve, steadyState: { usdPerTask: last.reduce((s, x) => s + x, 0) / last.length } };
  };
  assert.equal(breakEven(arm([2, 2, 2, 2]), arm([1, 1, 1, 1])).note, 'not reached; last-half $/task is not lower');
  assert.equal(breakEven(arm([1, 1], [false, false]), arm([1, 1])).note, 'no shared tasks');
  const s = summarizeArm({ meta: { spec: 'agent:x', slug: 'agent-x', kind: 'agent' }, rows: [], events: [], faults: [] });
  assert.equal(s.tasks, 0); assert.equal(s.successRate, null); assert.equal(s.usdPerSuccess, null);
});

test('report.md and report.json from the CLI; the noise rule and evidence label are stated', t => {
  const runDir = fixture(t);
  const r = spawnSync(process.execPath, [path.join(here, '../report.mjs'), runDir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(path.join(runDir, 'report.json')));
  const md = readFileSync(path.join(runDir, 'report.md'), 'utf8');
  for (const h of ['## Arms', '## Compiled-path events', '## Against each agent arm', '## Cumulative curves', '## Integrity flags']) assert.ok(md.includes(h), h);
  assert.match(md, /K=1 stream per arm: any success gap under 3 points/);
  assert.match(md, /development \/ diagnostic/);
  assert.match(md, /static:B1-haiku-records-k1/);
  assert.match(md, /\| jit:claude-haiku-5-5\/claude-haiku-5-5 \| 8 \| 7\/8 \(87\.5%\)/);
  assert.equal(renderMarkdown(buildReport(runDir)).split('\n').filter(l => l.startsWith('| 7 |')).length, 1);
});
