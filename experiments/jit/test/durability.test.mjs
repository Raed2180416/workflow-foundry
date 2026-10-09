// durability.mjs at $0 on synthetic rows/events shaped like stream.mjs's: version churn, windowed deopt/guard,
// silent-miss and disagreement rates, cost windows, time-to-durable in the oracle and system views (episodes, relapses,
// never durable), unbilled spend, duplicate/unordered rows, and the CLI on a temporary run directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeDurability, durabilityOfRun, renderTable, DEFAULTS } from '../durability.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-4, `${msg}: ${a} != ${b}`);

// One row per letter: W warmup (interpreter), P compiled pass, M compiled silent miss, D deopt (guard), I deopt
// (invariant), A adjudicated (shadow disagreed, interpreter majority), S compiled pass with an agreeing shadow.
// versions[i] is the version that ran at row i (null for warmup).
function rowsOf(code, versions, { kind = 'jit', cost = 0.01 } = {}) {
  return [...code].map((c, idx) => {
    const v = versions[idx] ?? null, ev = [];
    if (c === 'D') ev.push({ kind: 'deopt', deoptKind: 'guard' });
    if (c === 'I') ev.push({ kind: 'deopt', deoptKind: 'invariant' });
    if (c === 'A') ev.push({ kind: 'shadow', agree: false }, { kind: 'disagree' }, { kind: 'adjudicate', outcome: 'interpreter' }, { kind: 'regression' });
    if (c === 'S') ev.push({ kind: 'shadow', agree: true });
    if (idx > 0 && versions[idx] != null && versions[idx] !== versions[idx - 1]) ev.unshift({ kind: versions[idx - 1] == null ? 'compile' : 'recompile', version: v });
    return {
      arm: 'jit:x/y', kind, idx, version: v, costUsd: c === 'W' || c === 'D' || c === 'I' || c === 'A' ? 0.5 : cost, spendIds: [`s${idx}`],
      delivered: c === 'W' || c === 'D' || c === 'I' ? 'interpreter' : c === 'A' ? 'adjudicated' : 'compiled',
      compiledStatus: c === 'W' ? null : c === 'D' || c === 'I' ? 'deopt' : 'ok', deoptKind: c === 'D' ? 'guard' : c === 'I' ? 'invariant' : null,
      pass: c !== 'M', events: ev,
    };
  });
}

test('versions, deopts, silent misses, disagreement and cost', () => {
  //            0123456789012345
  const code = 'WWWPMDDPAPPSPPPP', vers = [null, null, null, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3];
  const d = computeDurability(rowsOf(code, vers), [], { window: 4, minSuccess: 0.75 });
  assert.equal(d.tasks, 16);
  assert.equal(d.versions.firstAdoptedIdx, 3);
  assert.equal(d.versions.count, 3);
  assert.equal(d.versions.changes, 2);
  assert.deepEqual(d.versions.changeList, [{ idx: 7, from: 1, to: 2 }, { idx: 13, from: 2, to: 3 }]);
  assert.deepEqual(d.versions.tasksBetweenChanges, [4, 6, 3]);
  close(d.versions.meanTasksBetweenChanges, 13 / 3, 'mean rows per version');
  assert.equal(d.versions.compiles, 1);
  assert.equal(d.versions.recompiles, 2);
  const t = d.totals;
  assert.equal(t.compiledAttempts, 13);
  assert.equal(t.deopts, 2);
  assert.deepEqual(t.deoptsByKind, { guard: 2 });
  close(t.deoptRate, 2 / 13, 'deopt rate');
  close(t.guardRate, 2 / 13, 'guard rate');
  assert.equal(t.compiledDeliveries, 10);
  assert.equal(t.silentMisses, 1);
  close(t.silentMissRate, 0.1, 'silent-miss rate');
  assert.equal(t.overruled, 1);
  assert.equal(t.shadowsAnswered, 2);
  assert.equal(t.disagreements, 1);
  close(t.disagreeRate, 0.5, 'disagree rate');
  // windows: the one ending at idx 6 holds rows 3..6 = P M D D
  const w6 = d.windows.find(w => w.idx === 6);
  assert.equal(w6.n, 4);
  close(w6.deoptRate, 0.5, 'window deopt');
  close(w6.guardRate, 0.5, 'window guard');
  close(w6.silentMissRate, 0.5, 'window silent miss');
  close(w6.usdPerTask, (0.01 + 0.01 + 0.5 + 0.5) / 4, 'window $/task');
  assert.equal(d.windows[0].n, 1, 'short windows at the start');
  assert.equal(d.windows[0].deoptRate, null, 'no compiled attempt -> null');
  close(t.usdPerTask, rowsOf(code, vers).reduce((s, r) => s + r.costUsd, 0) / 16, 'mean $/task');
});

test('time-to-durable: oracle and system views, episodes, relapses, never', () => {
  //            0123456789012345678
  const code = 'WWWPPPPPPDDPPPPPPPP', vers = [null, null, null, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2];
  const d = computeDurability(rowsOf(code, vers), [], { window: 4, minSuccess: 0.75 });
  const o = d.durable.oracle;
  assert.equal(o.timeToDurable, 3);
  assert.equal(o.confirmedIdx, 6);
  assert.equal(o.tasksToConfirm, 7);
  close(o.usdToConfirm, 1.5 + 4 * 0.01, 'usd to confirm');
  assert.equal(o.version, 1);
  // v1 windows starting 3..6 hold (6 = PPP D has 3/4 = 0.75); 7 = PPDD fails; v2 from 11
  assert.deepEqual(o.episodes.map(e => [e.version, e.fromIdx, e.untilIdx]), [[1, 3, 9], [2, 11, 18]]);
  assert.equal(o.relapses, 1);
  assert.equal(o.holdsToEnd, true);
  // never durable: no version long enough
  const never = computeDurability(rowsOf('WWWPPDPP', [null, null, null, 1, 1, 1, 2, 2]), [], { window: 4 });
  assert.equal(never.durable.oracle.timeToDurable, null);
  assert.equal(never.durable.oracle.note, 'never durable');
  assert.equal(never.durable.oracle.holdsToEnd, false);
  // agent arm: no version at all
  const agent = computeDurability(rowsOf('WWWW', [], { kind: 'agent' }), []);
  assert.equal(agent.durable.system.timeToDurable, null);
  assert.equal(agent.versions.count, 0);
});

test('a static solver is durable to itself while the oracle sees it fail (D5)', () => {
  // static arm: version null on rows, compiled ok throughout, drift from idx 8 makes every answer wrong
  const rows = rowsOf('PPPPPPPPMMMMMM', [], { kind: 'static' });
  const d = computeDurability(rows, [], { window: 4, minSuccess: 0.75 });
  assert.equal(d.kind, 'static');
  assert.equal(d.versions.count, 1, "static rows run the constant version 'static'");
  assert.equal(d.durable.systemUnchecked.timeToDurable, 0);
  assert.equal(d.durable.systemUnchecked.holdsToEnd, true, 'no deopt, no shadow: the unchecked system view never notices');
  // the system view needs an answered shadow in every window, so an unchecked solver is never durable to it
  assert.equal(d.durable.system.timeToDurable, null);
  assert.match(d.durable.system.note, /never durable with >= 1 answered shadow/);
  assert.equal(d.durable.oracle.timeToDurable, 0);
  assert.equal(d.durable.oracle.holdsToEnd, false, 'the oracle sees the drift');
  assert.equal(d.durable.oracle.episodes[0].untilIdx, 8, 'the last window with >= 3/4 compiled passes ends at idx 8');
  close(d.totals.silentMissRate, 6 / 14, 'silent misses');
});

test('system view needs shadow evidence in the window; missing rows break windows (review 2026-10-09)', () => {
  //            0123456789012
  const vers = [null, null, null, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  // agreeing shadows at 6 and 10: every window of 4 starting at 3..9 holds one of them, so the system view is durable
  // from 3; the same arm with no shadow at all is never durable to the system
  const checked = computeDurability(rowsOf('WWWPPPSPPPSPP', vers), [], { window: 4, minSuccess: 0.75 });
  assert.equal(checked.durable.system.timeToDurable, 3);
  assert.deepEqual(checked.durable.system.episodes.map(e => [e.fromIdx, e.untilIdx]), [[3, 12]]);
  const unchecked = computeDurability(rowsOf('WWWPPPPPPPPPP', vers), [], { window: 4, minSuccess: 0.75 });
  assert.equal(unchecked.durable.system.timeToDurable, null, 'no shadow ever: not durable to the system');
  assert.equal(unchecked.durable.systemUnchecked.timeToDurable, 3);
  assert.equal(unchecked.durable.oracle.timeToDurable, 3, 'the oracle view does not need shadows');
  const loose = computeDurability(rowsOf('WWWPPPPPPPPPP', vers), [], { window: 4, minSuccess: 0.75, minShadows: 0 });
  assert.equal(loose.durable.system.timeToDurable, 3, 'minShadows 0 restores the unchecked view');
  // a missing idx (task never finished) is a position with no version: it breaks every window over it
  const rows = rowsOf('WWWPPPPPPPPPP', vers).filter(r => r.idx !== 7);
  const gap = computeDurability(rows, [], { window: 4, minSuccess: 0.75 });
  assert.equal(gap.tasks, 12);
  assert.equal(gap.totals.missingRows, 1);
  assert.deepEqual(gap.durable.oracle.episodes.map(e => [e.fromIdx, e.untilIdx]), [[3, 6], [8, 12]]);
  assert.equal(gap.durable.oracle.relapses, 1);
  assert.deepEqual(gap.windows.map(w => w.idx), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test('rows are deduplicated by idx (last wins) and sorted; unbilled spend counts toward $/task', () => {
  const rows = rowsOf('WWWPP', [null, null, null, 1, 1]);
  const dup = { ...rows[4], pass: false };
  const d = computeDurability([rows[3], rows[4], rows[0], rows[2], rows[1], dup], [{ kind: 'spend', id: 'orphan', costUsd: 0.25 }, { kind: 'spend', id: 's1', costUsd: 0.5 }]);
  assert.deepEqual(d.windows.map(w => w.idx), [0, 1, 2, 3, 4]);
  assert.equal(d.totals.silentMisses, 1, 'the later duplicate row wins');
  close(d.totals.unbilledUsd, 0.25, 'only spend not in a row');
  close(d.totals.usdPerTask, (1.5 + 0.02 + 0.25) / 5, '$/task includes unbilled spend');
  assert.deepEqual(d.params, { window: DEFAULTS.window, minSuccess: DEFAULTS.minSuccess, minShadows: DEFAULTS.minShadows });
});

test('run directory loader, table and CLI', t => {
  const runDir = mkdtempSync(path.join(tmpdir(), 'jit-durability-')); t.after(() => rmSync(runDir, { recursive: true, force: true }));
  const write = (slug, spec, kind, rows) => {
    const dir = path.join(runDir, slug); mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'arm.json'), JSON.stringify({ spec, slug, kind }));
    writeFileSync(path.join(dir, 'results.jsonl'), rows.map(r => JSON.stringify({ ...r, arm: spec })).join('\n') + '\n');
    writeFileSync(path.join(dir, 'events.jsonl'), '');
  };
  write('jit-a', 'jit:claude-haiku-5-5/claude-haiku-5-5', 'jit', rowsOf('WWWPPPPPPPP', [null, null, null, 1, 1, 1, 1, 1, 1, 1, 1]));
  write('agent-a', 'agent:claude-haiku-5-5', 'agent', rowsOf('WWWWW', [], { kind: 'agent' }));
  mkdirSync(path.join(runDir, 'not-an-arm'));
  const res = durabilityOfRun(runDir, { window: 4 });
  assert.deepEqual(res.map(r => r.spec), ['agent:claude-haiku-5-5', 'jit:claude-haiku-5-5/claude-haiku-5-5']);
  assert.equal(res[1].durable.oracle.timeToDurable, 3);
  const md = renderTable(res, { series: true });
  assert.match(md, /\| jit:claude-haiku-5-5\/claude-haiku-5-5 \| 11 \| 1 \(0\) \| 8 \|/);
  assert.match(md, /### agent:claude-haiku-5-5/);
  const cli = spawnSync(process.execPath, [path.join(here, '..', 'durability.mjs'), runDir, '--window', '4'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /window W=4/);
  assert.match(cli.stdout, /3 \/ 6 \(\$1\.540\) \/ yes/);
  const json = spawnSync(process.execPath, [path.join(here, '..', 'durability.mjs'), runDir, '--json'], { encoding: 'utf8' });
  assert.equal(JSON.parse(json.stdout).length, 2);
  const bad = spawnSync(process.execPath, [path.join(here, '..', 'durability.mjs'), path.join(runDir, 'missing')], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
});
