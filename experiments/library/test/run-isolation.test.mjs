// MEM-0 M2 (research/architecture-20261014/MEMORY-ROUTING-RECURSION.md §3.2, rule R9): run.mjs opened the library (its
// registry, evidence rows with oracle verdicts and judgment labels) at <workdir>/library, and runParts beside the run
// directory, while the solver runs with cwd and HOME = its workdir and no sandbox. The library now lives outside every
// workdir; a library inside the workdir (or containing it) is refused. $0: plain solver processes, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runSolver, runParts, assertLibraryOutside } from '../run.mjs';
import { openLibrary } from '../store.mjs';
import { loadCard } from '../cards.mjs';

const tmp = (t, p) => { const d = mkdtempSync(path.join(tmpdir(), p)); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
// A solver that looks for library files in its workdir (= cwd = HOME) and beside it.
const PROBE = `import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
const NAMES = new Set(['registry.jsonl', 'evidence.jsonl', 'judgments.jsonl', 'revocations.jsonl']);
const found = [];
const walk = d => { let es = []; try { es = readdirSync(d, { withFileTypes: true }); } catch {} for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (NAMES.has(e.name)) found.push(path.relative(process.cwd(), p)); } };
walk(process.cwd()); if (process.env.HOME !== process.cwd()) walk(process.env.HOME);
console.log(JSON.stringify({ libraryHere: existsSync('library'), found }));`;
const TASK = { prompt: 'probe', inputs: {} };
const PROVENANCE = { source: 'maintainer', ref: 'fixture', licence: 'internal', redistributable: false };

test('M2: without a library the solver finds none in its workdir; a library holding truth rows, passed by the caller, stays outside it', async t => {
  const own = await runSolver({ source: PROBE, task: TASK });
  assert.equal(own.status, 'ok', own.stderr);
  assert.deepEqual(own.output, { libraryHere: false, found: [] });
  // Truth-domain rows: an oracle verdict (evidence) and a judgment label.
  const lib = openLibrary(tmp(t, 'lib-m2-store-'));
  const e = lib.register({ layer: 'L2', name: 'x', contract: { output: { type: 'object' }, taskTemplate: 't' }, stub: async () => ({ output: {} }), tags: ['compose'], provenance: PROVENANCE });
  lib.addEvidence(e.hash, { kind: 'run', ok: true, oracle: 'pass' });
  assert.ok(existsSync(lib.files.evidence));
  const r = await runSolver({ source: PROBE, task: TASK, library: lib, workdir: tmp(t, 'lib-m2-work-') });
  assert.equal(r.status, 'ok', r.stderr);
  assert.deepEqual(r.output, { libraryHere: false, found: [] });
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
