// MEM-0 M2 (research/architecture-20261014/MEMORY-ROUTING-RECURSION.md §3.2, rule R9): run.mjs opened the library (its
// registry, evidence rows with oracle verdicts and judgment labels) at <workdir>/library, and runParts beside the run
// directory, while the solver runs with cwd and HOME = its workdir and no sandbox. The library now lives outside every
// workdir; a library inside the workdir (or containing it) is refused; and (review fix) the solver runs in the executor
// sandbox with the library hidden, so neither the workdir's parents nor the library's absolute path reach it. $0: no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runSolver, runParts, assertLibraryOutside } from '../run.mjs';
import { openLibrary } from '../store.mjs';
import { loadCard } from '../cards.mjs';

const tmp = (t, p) => { const d = mkdtempSync(path.join(tmpdir(), p)); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
// A solver that looks for library files in its workdir (= cwd = HOME), beside it, and (review fix) in every parent
// directory of the workdir below / (a readdir('..') from /tmp/lib-run-* reached /tmp/lib-store-*/evidence.jsonl), and
// that tries the library's absolute path when the task hands it one (inputs.probe: a solver that knows where it is).
const PROBE = `import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
const NAMES = new Set(['registry.jsonl', 'evidence.jsonl', 'judgments.jsonl', 'revocations.jsonl']);
const found = [];
const walk = (d, depth = 0) => { if (depth > 4) return; let es = []; try { es = readdirSync(d, { withFileTypes: true }); } catch {} for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, depth + 1); else if (NAMES.has(e.name)) found.push(path.relative(process.cwd(), p)); } };
walk(process.cwd()); if (process.env.HOME !== process.cwd()) walk(process.env.HOME);
for (let a = path.dirname(process.cwd()); a !== path.dirname(a); a = path.dirname(a)) walk(a);
const task = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const direct = (task.inputs.probe ?? []).filter(f => { try { readFileSync(f); return true; } catch { return false; } });
console.log(JSON.stringify({ libraryHere: existsSync('library'), found, direct }));`;
const TASK = { prompt: 'probe', inputs: {} };
const PROVENANCE = { source: 'maintainer', ref: 'fixture', licence: 'internal', redistributable: false };

test('M2: without a library the solver finds none in its workdir; a library holding truth rows, passed by the caller, stays outside it', async t => {
  const own = await runSolver({ source: PROBE, task: TASK });
  assert.equal(own.status, 'ok', own.stderr);
  assert.deepEqual(own.output, { libraryHere: false, found: [], direct: [] });
  // Truth-domain rows: an oracle verdict (evidence) and a judgment label.
  const lib = openLibrary(tmp(t, 'lib-m2-store-'));
  const e = lib.register({ layer: 'L2', name: 'x', contract: { output: { type: 'object' }, taskTemplate: 't' }, stub: async () => ({ output: {} }), tags: ['compose'], provenance: PROVENANCE });
  lib.addEvidence(e.hash, { kind: 'run', ok: true, oracle: 'pass' });
  assert.ok(existsSync(lib.files.evidence));
  const r = await runSolver({ source: PROBE, task: TASK, library: lib, workdir: tmp(t, 'lib-m2-work-') });
  assert.equal(r.status, 'ok', r.stderr);
  assert.deepEqual(r.output, { libraryHere: false, found: [], direct: [] });
});

// Review fix: the store sat in os.tmpdir() beside the workdir and the solver ran unsandboxed, so walking the workdir's
// parents found it, and its absolute path was readable. The solver now runs in the executor sandbox with the library hidden.
test('M2: the solver cannot reach the library from its workdir\'s parent directories, nor by its absolute path', async t => {
  const lib = openLibrary(tmp(t, 'lib-m2-store-'));
  const e = lib.register({ layer: 'L2', name: 'x', contract: { output: { type: 'object' }, taskTemplate: 't' }, stub: async () => ({ output: {} }), tags: ['compose'], provenance: PROVENANCE });
  lib.addEvidence(e.hash, { kind: 'run', ok: true, oracle: 'pass' });
  const probe = [lib.files.evidence, lib.files.registry];
  const r = await runSolver({ source: PROBE, task: { prompt: 'probe', inputs: { probe } }, library: lib });
  assert.equal(r.status, 'ok', r.stderr);
  assert.deepEqual(r.output.found, [], 'no library file under any parent of the workdir');
  assert.deepEqual(r.output.direct, [], 'the library is not readable by its absolute path');
  // runParts' layout: the store in /tmp/lib-fx-store-*, the solver in /tmp/lib-fx-*/run (two levels below the store's parent).
  const fxLib = openLibrary(tmp(t, 'lib-fx-store-'));
  fxLib.addEvidence(fxLib.register({ layer: 'L2', name: 'y', contract: { output: { type: 'object' }, taskTemplate: 't' }, stub: async () => ({ output: {} }), tags: ['compose'], provenance: PROVENANCE }).hash, { kind: 'run', ok: true, oracle: 'pass' });
  const fxRun = path.join(tmp(t, 'lib-fx-'), 'run');
  const viaParts = await runSolver({ source: PROBE, task: { prompt: 'probe', inputs: { probe: [fxLib.files.evidence] } }, library: fxLib, workdir: fxRun });
  assert.equal(viaParts.status, 'ok', viaParts.stderr);
  assert.deepEqual([viaParts.output.found, viaParts.output.direct], [[], []], "runParts' store is out of reach as well");
});

test('M2: runParts keeps its library out of the run directory and out of the run directory\'s parent', async t => {
  const p08 = loadCard('P08'), fx = p08.fixtures.find(f => f.name === 'positive');
  const r = await runParts({ parts: [{ card: p08, slots: { ...p08.example.slots, ...(fx.slots ?? {}) } }], task: fx.task, answers: fx.answers, keep: true });
  t.after(() => { rmSync(path.dirname(r.dir), { recursive: true, force: true }); rmSync(r.libraryDir, { recursive: true, force: true }); });
  assert.equal(r.status, 'ok', r.stderr);
  assert.equal(existsSync(path.join(r.dir, 'library')), false);
  assert.equal(existsSync(path.join(path.dirname(r.dir), 'library')), false, 'no ../library beside the solver');
  assert.equal(path.relative(path.dirname(r.dir), r.libraryDir).startsWith('..'), true, 'the library is in its own directory');
});

test('M2: a library inside the solver\'s workdir, or one that contains it, is refused before the solver starts', async t => {
  const work = tmp(t, 'lib-m2-in-');
  await assert.rejects(runSolver({ source: PROBE, task: TASK, library: openLibrary(path.join(work, 'library')), workdir: work }), /must be outside the solver's workdir/);
  const outer = tmp(t, 'lib-m2-outer-'); mkdirSync(path.join(outer, 'run'));
  await assert.rejects(runSolver({ source: PROBE, task: TASK, library: openLibrary(outer), workdir: path.join(outer, 'run') }), /must be outside the solver's workdir/);
  assert.doesNotThrow(() => assertLibraryOutside(path.join(outer, 'lib'), path.join(outer, 'run')));
  assert.throws(() => assertLibraryOutside(outer, outer), /outside/);
});
