// Contract test against the REAL Kev argument parsers (no model is loaded, nothing is trained).
// Skipped unless a Kev checkout and its venv are given:
//   FOUNDRY_BRIDGE_KEV_PYTHON=~/kev-venv/bin/python FOUNDRY_BRIDGE_KEV_DIR=~/kev node --test bridge/test/kev-contract.test.mjs
// It proves that every command line the daemon builds is accepted by kev.train / kev.benchmark /
// kev.serve at that checkout, with the values the daemon intended.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { KINDS, SELFTEST_PY, buildCommand, jobEnv, validateParams } from '../laptop/jobs.mjs';
import { normalizeConfig } from '../laptop/config.mjs';
import { JobManager } from '../laptop/jobs.mjs';
import { plantTrainedRun, scratch } from './helpers.mjs';

const PY = process.env.FOUNDRY_BRIDGE_KEV_PYTHON;
const KEV = process.env.FOUNDRY_BRIDGE_KEV_DIR;
const skip = !(PY && KEV && fs.existsSync(PY) && fs.existsSync(path.join(KEV, 'kev', 'train.py'))) && 'set FOUNDRY_BRIDGE_KEV_PYTHON and FOUNDRY_BRIDGE_KEV_DIR to a Kev venv python and checkout';

// Parses argv with the module's own argparse and prints the namespace, then stops before any work.
const CAPTURE = String.raw`
import argparse, json, runpy, sys
mod, argv = sys.argv[1], sys.argv[2:]
if mod == "kev.train":
    sys.argv = ["kev.train", *argv]
    from kev.train import parse_args
    print("FOUNDRY_ARGS " + json.dumps(vars(parse_args()), default=str)); sys.exit(0)
orig = argparse.ArgumentParser.parse_args
def capture(self, *a, **k):
    ns = orig(self, *a, **k)
    print("FOUNDRY_ARGS " + json.dumps(vars(ns), default=str)); sys.stdout.flush(); sys.exit(0)
argparse.ArgumentParser.parse_args = capture
sys.argv = [mod, *argv]
runpy.run_module(mod, run_name="__main__")
`;

function parseWithKev(cfg, built) {
  const env = { ...jobEnv(cfg), PYTHONDONTWRITEBYTECODE: '1', HF_HUB_OFFLINE: '1' };
  const r = spawnSync(built.cmd, ['-c', CAPTURE, built.args[1], ...built.args.slice(2)], { cwd: built.cwd, env, encoding: 'utf8', timeout: 120_000 });
  const line = r.stdout.split('\n').find(l => l.startsWith('FOUNDRY_ARGS '));
  assert.ok(line, `kev rejected the command line:\n${r.stderr.slice(-2000)}`);
  return JSON.parse(line.slice('FOUNDRY_ARGS '.length));
}

test('kev.train, kev.benchmark and kev.serve accept the daemon-built command lines', { skip }, async t => {
  const root = scratch(t, 'contract');
  const cfg = normalizeConfig({ workdir: path.join(root, 'work'), python: PY, kevDir: KEV, device: 'cuda', mailbox: { enabled: false } });
  // a checkpoint is referenced as runs/<jobId> of a kev.train job this daemon finished (F1): plant its record
  const prev = plantTrainedRun(cfg.workdir);
  const jm = new JobManager({ config: cfg, workdir: cfg.workdir });
  await jm.init();
  fs.writeFileSync(path.join(cfg.workdir, 'data', 'toy.jsonl'), fs.readFileSync(new URL('../laptop/smoke/toy-train.jsonl', import.meta.url)));
  const out = path.join(cfg.workdir, 'runs', 'j-new');

  const cases = [
    { dataset: 'data/toy.jsonl', extra: { perm_kl: 0.1, perm_frac: 0.3, brier_w: 0.1, head_lr: 1e-4, weight_decay: 0.01, seed: 3, max_steps: 5, lora_targets: 'all', weights_dtype: 'fp32', p_none_pair: 0.25, length_sort: 0, shared_prefix: 0, ord_w: 0.5 } },
    { dataset: 'data/toy.jsonl', initFrom: prev, epochs: 2, lr: 1e-4, batch: 4, accum: 2, dtype: 'fp32', maxState: 1024, checkpointing: 0, lora: 16, extra: { suite: 'evals/v7/decision-v7', replay: 100, label_smoothing: 0.05, base_revision: 'dc7cdfe2ee4154fa7e30f5b51ca41bfa40174e68', row_budget: 4096 } },
    { dataset: 'data/toy.jsonl', initFrom: '', extra: { focal_gamma: 1 } }
  ];
  for (const params of cases) {
    const { value, resolved } = await validateParams(KINDS['kev.train'].params, params, jm);
    const a = parseWithKev(cfg, buildCommand('kev.train', { params: value }, resolved, cfg, out));
    assert.equal(a.data, resolved.dataset); assert.equal(a.out, out); assert.equal(a.base, value.base); assert.equal(a.device, 'cuda');
    assert.equal(a.epochs, value.epochs); assert.equal(a.lr, value.lr); assert.equal(a.batch, value.batch); assert.equal(a.accum, value.accum);
    assert.equal(a.dtype, value.dtype); assert.equal(a.max_state, value.maxState); assert.equal(a.checkpointing, value.checkpointing); assert.equal(a.lora, value.lora);
    assert.equal(a.init_from, resolved.initFrom ?? '');
    for (const [k, v] of Object.entries(value.extra)) assert.equal(String(a[k]), k === 'suite' ? path.join(KEV, v) : String(v), `extra.${k}`);
  }
  const bench = await validateParams(KINDS['kev.benchmark'].params, { run: 'jaredpalmer/kev-0.8b@v1.0', data: 'data/toy.jsonl', rotations: 2 }, jm);
  const b = parseWithKev(cfg, buildCommand('kev.benchmark', { params: bench.value }, bench.resolved, cfg, out));
  assert.equal(b.run, 'jaredpalmer/kev-0.8b@v1.0'); assert.equal(b.data, bench.resolved.data); assert.equal(b.rotations, 2); assert.equal(b.device, 'cuda');
  const serve = await validateParams(KINDS['kev.serve'].params, { run: prev, port: 8010 }, jm);
  const s = parseWithKev(cfg, buildCommand('kev.serve', { params: serve.value }, serve.resolved, cfg, null));
  assert.equal(s.run, serve.resolved.run); assert.equal(s.port, 8010); assert.equal(s.host, '127.0.0.1');
});

test('the bundled smoke dataset loads with kev.data.load_records', { skip }, () => {
  const code = 'import sys; from kev.data import load_records, materialize\nfor p in sys.argv[1:]:\n    r = load_records(p); [materialize(x) for x in r]; print(p.rsplit("/",1)[-1], len(r))';
  const files = ['toy-train.jsonl', 'toy-heldout.jsonl'].map(f => new URL(`../laptop/smoke/${f}`, import.meta.url).pathname);
  const r = spawnSync(PY, ['-c', code, ...files], { cwd: KEV, env: { ...process.env, PYTHONPATH: KEV, PYTHONDONTWRITEBYTECODE: '1', HF_HUB_OFFLINE: '1' }, encoding: 'utf8', timeout: 120_000 });
  assert.equal(r.status, 0, r.stderr.slice(-2000));
  assert.match(r.stdout, /toy-train\.jsonl 64/); assert.match(r.stdout, /toy-heldout\.jsonl 16/);
});

// F1 with the real torch: the daemon's job environment (TORCH_FORCE_WEIGHTS_ONLY_LOAD=1) refuses a pickle
// gadget even where weights_only=False is passed, and the selftest reports the guard; stock Kev
// checkpoints still load through kev.checkpoint.read_meta under that environment.
test('the pickle guard holds in the real Kev venv and stock checkpoints still load under it', { skip }, async t => {
  const root = scratch(t, 'guard');
  const cfg = normalizeConfig({ workdir: path.join(root, 'work'), python: PY, kevDir: KEV, device: 'cpu', mailbox: { enabled: false } });
  const env = { ...jobEnv(cfg), PYTHONDONTWRITEBYTECODE: '1', HF_HUB_OFFLINE: '1' };
  assert.equal(env.TORCH_FORCE_WEIGHTS_ONLY_LOAD, '1');
  const st = spawnSync(PY, ['-c', SELFTEST_PY], { cwd: KEV, env, encoding: 'utf8', timeout: 300_000 });
  const line = st.stdout.split('\n').find(l => l.startsWith('FOUNDRY_RESULT '));
  assert.ok(line, st.stderr.slice(-2000));
  const r = JSON.parse(line.slice('FOUNDRY_RESULT '.length));
  assert.equal(r.torch_weights_only_safe, true, `torch ${r.torch}`);
  assert.equal(r.pickle_guard, 'refused');
  assert.ok(!st.stdout.includes('FOUNDRY_PICKLE_GADGET_RAN'), 'the gadget did not run');
  const jm = new JobManager({ config: cfg, workdir: cfg.workdir });
  const tc = await jm.torchCheck();
  assert.equal(tc.safe, true, JSON.stringify(tc));
  // a stock head.pt from the local HF cache, if one is there (FOUNDRY_BRIDGE_KEV_HEAD overrides)
  const head = process.env.FOUNDRY_BRIDGE_KEV_HEAD ?? findStockHead();
  if (!head) { t.diagnostic('no cached jaredpalmer/kev-* head.pt; read_meta check skipped'); return; }
  const code = 'import sys; from kev.checkpoint import read_meta; m = read_meta(sys.argv[1]); print("FOUNDRY_META", m.base, m.lora)';
  const rm = spawnSync(PY, ['-c', code, path.dirname(head)], { cwd: KEV, env, encoding: 'utf8', timeout: 120_000 });
  assert.equal(rm.status, 0, rm.stderr.slice(-2000));
  assert.match(rm.stdout, /FOUNDRY_META Qwen\/Qwen3/);
});

function findStockHead() {
  for (const hub of [process.env.HF_HOME && path.join(process.env.HF_HOME, 'hub'), path.join(process.env.HOME ?? '', '.cache', 'huggingface', 'hub'), '/opt/hf-cache/hub'].filter(Boolean)) {
    let repos = []; try { repos = fs.readdirSync(hub).filter(n => /^models--jaredpalmer--kev-/.test(n)); } catch { continue; }
    for (const r of repos) {
      const snaps = path.join(hub, r, 'snapshots');
      let ids = []; try { ids = fs.readdirSync(snaps); } catch { continue; }
      for (const id of ids) { const f = path.join(snaps, id, 'head.pt'); if (fs.existsSync(f)) return f; }
    }
  }
  return null;
}
