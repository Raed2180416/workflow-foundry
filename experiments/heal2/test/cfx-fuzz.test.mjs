// H-cfx differential fuzz (cfx-fuzz.mjs): the generator and the class oracle, and the gate's teeth on the stored
// candidates plus deliberately broken check scripts. $0, no model; the scripts run in the executor sandbox (skipped
// without user namespaces).
//   nice -n 15 node --test --test-concurrency=1 experiments/heal2/test/cfx-fuzz.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import { generate, changeClass, render, loadScripts, runScript, rng, genModule } from '../cfx-fuzz.mjs';
import { differentialGate } from '../../lib/difffuzz.mjs';

const skip = sandboxAvailable() ? false : 'sandbox (user namespaces) unavailable';
const f = (name, pos, extra = {}) => ({ kind: 'func', name, pos: pos.map(([n, d = null]) => ({ name: n, def: d })), star: null, kwonly: [], kw: null, ...extra });
const mod = (...defs) => ({ imports: [], defs, syntax: false });

test('class oracle: default values only, identical, or other, from the structured models', () => {
  const a = mod(f('score', [['x'], ['n', '2']]), f('_h', [['y']]));
  assert.equal(changeClass(a, mod(f('score', [['x'], ['n', '3']]), f('_h', [['y']]))), 'default-values-only');
  assert.equal(changeClass(a, mod(f('score', [['x'], ['n', '2']]), f('_h', [['y'], ['z', '0']]))), 'identical');      // private change
  assert.equal(changeClass(a, mod(f('score', [['x'], ['m', '2']]), f('_h', [['y']]))), 'other');                      // renamed parameter
  assert.equal(changeClass(a, mod(f('score', [['x', '1'], ['n', '2']]), f('_h', [['y']]))), 'other');                // a default added
  assert.equal(changeClass(a, mod({ kind: 'class', name: 'score', methods: [] }, f('_h', [['y']]))), 'other');       // kind change
  assert.equal(changeClass(a, { ...mod(f('score', [['x'], ['n', '2']])), imports: ['import re'] }), 'other');        // new import
  const k = mod(f('score', [['x']], { kwonly: [{ name: 'k', def: '1' }] }));
  assert.equal(changeClass(k, mod(f('score', [['x']], { kwonly: [{ name: 'k', def: '2' }] }))), 'identical');         // the base ignores keyword-only defaults
  assert.equal(render(mod(f('g', [['a'], ['b', '1']], { star: 'args', kwonly: [{ name: 'c', def: null }], kw: 'kwargs' }))).includes('def g(a, b=1, *args, c, **kwargs):'), true);
});

test('generator: deterministic per seed, every class represented', () => {
  const a = generate(400, 7), b = generate(400, 7);
  assert.deepEqual(a.map(x => x.input), b.map(x => x.input));
  const classes = new Set(a.map(x => x.cls));
  for (const c of ['identical', 'default-values-only', 'other']) assert.ok(classes.has(c), c);
  assert.ok(genModule(rng(1)).defs.length >= 2);
});

test('the base agrees with the class oracle wherever the oracle is unambiguous (generator and renderer sanity)', { skip }, async () => {
  const { scripts } = loadScripts();
  const xs = generate(400, 11);
  const out = await runScript(scripts.base, xs);
  for (const x of xs) {
    assert.ok(!out[x.id].crash, `${x.id} base crash ${out[x.id].crash}`);
    if (x.cls === 'identical') assert.equal(out[x.id].verdict, true, `${x.id}: ${x.edits}`);
    if (x.cls === 'default-values-only' || x.cls === 'syntax') assert.equal(out[x.id].verdict, false, `${x.id}: ${x.edits}`);
  }
});

test('teeth: the gate rejects the Sonnet candidate (kind-change crash), a too-lenient script and a field-blind script; accepts Opus', { skip }, async () => {
  const { scripts } = loadScripts();
  const xs = generate(1500, 20261028);
  const ids = xs.map(x => x.id), byId = Object.fromEntries(xs.map(x => [x.id, x]));
  const base = await runScript(scripts.base, xs);
  const gate = async src => differentialGate({ ids, inClass: id => byId[id].cls === 'default-values-only', intended: () => true, base, candidate: await runScript(src, xs) });
  const sonnet = await gate(scripts.sonnet);
  assert.equal(sonnet.verdict, 'reject');
  assert.ok(sonnet.crashes > 0 && sonnet.examples.crashes.every(id => byId[id].edits.includes('func-to-class')));
  const opus = await gate(scripts.opus);
  assert.equal(opus.verdict, 'accept');
  assert.equal(opus.spurious, 0);
  // always "ok": fixes the class and breaks everything else
  const lenient = await gate(`def main(input):\n    return {"ok": True, "problems": []}\n`);
  assert.equal(lenient.verdict, 'reject'); assert.ok(lenient.spurious > 100);
  // Opus's relaxation made blind to **kwargs changes: only the fuzz's toggle-kw edits can expose it
  const blind = scripts.opus.replace('for f in ("args", "kwonly", "star", "kw"):', 'for f in ("args", "kwonly", "star"):');
  assert.notEqual(blind, scripts.opus);
  const b = await gate(blind);
  assert.equal(b.verdict, 'reject'); assert.ok(b.spurious > 0);
  assert.ok(b.examples.spurious.every(id => byId[id].edits.includes('toggle-kw')));
  // the unrepaired base misses the whole class: the incident itself
  const self = await gate(scripts.base);
  assert.equal(self.verdict, 'reject'); assert.equal(self.missed, self.inClass);
});

test('the runner caps a stored script: no 2.5 GiB allocation, no fork, no 2 MiB file (review D13)', { skip }, async () => {
  const xs = [{ id: 'a', input: {} }];
  const mem = await runScript('def main(inp):\n    b = bytearray(5 << 29)\n    return {"ok": True}\n', xs);
  assert.match(mem.a.crash ?? '', /^MemoryError/);
  const fork = await runScript('import os\ndef main(inp):\n    pid = os.fork()\n    if pid == 0:\n        os._exit(0)\n    return {"ok": True}\n', xs);
  assert.match(fork.a.crash ?? '', /^(BlockingIOError|OSError|PermissionError)/);
  const big = await runScript('def main(inp):\n    open("big.bin", "wb").write(b"x" * (2 << 20))\n    return {"ok": True}\n', xs);
  assert.match(big.a.crash ?? '', /^OSError/);
  const fine = await runScript('def main(inp):\n    return {"ok": True}\n', xs);
  assert.equal(fine.a.verdict, true);
});
