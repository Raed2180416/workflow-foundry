// Auto-heal feasibility probe (research/heal-20261008/DESIGN.md §2). Development/diagnostic evidence only.
//
//   node experiments/heal/probe/feasibility.mjs [--scratch DIR] [--out FILE]
//
// Spends $0: every model node is served from a COPY of the recorded journal in strict 'replay' mode, and no provider is
// wired, so a call that is not in the journal fails with REPLAY_MISS instead of reaching a model. The recorded journals
// (experiments/runs/{c0-dev,p1}/journal.sqlite) are opened read-only and copied with VACUUM INTO into DIR (default
// /var/tmp/foundry-work/heal-probe, outside the repository). The runtime is imported from the FROZEN construction kit the
// C0 runs used, never from the live src/ (which is changing). The kit is checked first: its src/schemas/policy/skills/bin
// files must have the git blob ids of commit 880c6b9 (the P1 freeze).
// Reads only INSPECTED test seeds (C0 records/codefix s6001-6004 d3; P1 records s5002 d3). Prints ids, enum values, scores,
// counts and costs; never task text, prompts or replies.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const KIT = '/opt/foundry-kit/7e8f0f83153c5efb', KIT_COMMIT = '880c6b9';
const arg = (name, dflt) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : dflt);
const SCRATCH = path.resolve(arg('scratch', '/var/tmp/foundry-work/heal-probe'));
const OUT = arg('out', null);
if (SCRATCH.startsWith(REPO + path.sep)) throw new Error('--scratch must be outside the repository');
mkdirSync(SCRATCH, { recursive: true });

// ---- 0. The frozen kit is the P1/C0 runtime --------------------------------------------------------------------------
const blobOf = file => { const b = readFileSync(file); return createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'); };
const walk = dir => readdirSync(dir).flatMap(n => { const p = path.join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
function kitCheck() {
  const tree = new Map(execFileSync('git', ['-C', REPO, 'ls-tree', '-r', KIT_COMMIT, '--format=%(objectname) %(path)', '--', 'src', 'schemas', 'policy', 'skills', 'bin'], { encoding: 'utf8' })
    .trim().split('\n').map(line => { const i = line.indexOf(' '); return [line.slice(i + 1), line.slice(0, i)]; }));
  const files = ['src', 'schemas', 'policy', 'skills', 'bin'].flatMap(d => walk(path.join(KIT, d))).map(f => path.relative(KIT, f)).sort();
  const mismatched = files.filter(f => tree.get(f) !== blobOf(path.join(KIT, f)));
  const liveDiffers = files.filter(f => !existsSync(path.join(REPO, f)) || blobOf(path.join(REPO, f)) !== blobOf(path.join(KIT, f)));
  const liveOnly = walk(path.join(REPO, 'src')).map(f => path.relative(REPO, f)).filter(f => !files.includes(f)).sort();
  const kitJson = JSON.parse(readFileSync(path.join(KIT, 'KIT.json'), 'utf8'));
  return { kit: KIT, kitHash: kitJson.hash, commit: KIT_COMMIT, files: files.length, mismatchedWithCommit: mismatched, liveDiffers, liveOnly,
    policyIdentical: blobOf(path.join(KIT, 'policy/models.json')) === blobOf(path.join(REPO, 'policy/models.json')) };
}
const kit = kitCheck();
if (kit.mismatchedWithCommit.length) throw new Error(`kit differs from ${KIT_COMMIT}: ${kit.mismatchedWithCommit.join(', ')}`);

const { Foundry } = await import(`${KIT}/src/foundry.mjs`);
const { ModelPort } = await import(`${KIT}/src/models/port.mjs`);
const { Journal } = await import(`${KIT}/src/journal.mjs`);
const { loadPolicy, validatePolicy, policyHash } = await import(`${KIT}/src/models/policy.mjs`);
const { makeTasks, score } = await import(`${REPO}/experiments/lib/beds.mjs`);
const { canonical } = await import(`${REPO}/beds/lib/canonical.mjs`);
const { buildRecordsV3Workflow } = await import(`${REPO}/experiments/workflows/records-v3.mjs`);

// The session policy each experiment ran with (experiments/lib/models.mjs subsetPolicy, same construction).
const freeze = v => { if (v && typeof v === 'object') { for (const c of Object.values(v)) freeze(c); Object.freeze(v); } return v; };
function sessionPolicy(ids) {
  const owner = loadPolicy().policy, models = owner.models.filter(m => ids.includes(m.id)), used = new Set(models.map(m => m.provider));
  return freeze(validatePolicy(structuredClone({ ...owner, policyVersion: `${owner.policyVersion}+only:${[...ids].sort().join(',')}`, models,
    providers: Object.fromEntries(Object.entries(owner.providers).filter(([n]) => used.has(n))) })));
}
function replayPort(source, name, ids) {
  const copy = path.join(SCRATCH, `${name}-journal-copy.sqlite`);
  rmSync(copy, { force: true });
  new DatabaseSync(source, { readOnly: true }).exec(`VACUUM INTO '${copy.replaceAll("'", "''")}'`);
  const db = new DatabaseSync(copy), policy = sessionPolicy(ids), journal = new Journal(db);
  return { db, journal, policy, port: new ModelPort({ policy, providers: {}, journal, mode: 'replay' }) };
}
const readJsonl = f => readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l));

// One recorded trial, re-executed on the frozen runtime: same workflow, same task (regenerated from its seed; the task hash
// must equal the recorded one), same sampleSalt as experiments/lib/arms/foundry-workflow.mjs (`${armId}:t${trial}`).
async function replayTrial(ctx, workflow, family, split, difficulty, seed, trial, armId) {
  const [t] = await makeTasks(family, { split, seeds: [seed], difficulty });
  const ws = mkdtempSync(path.join(SCRATCH, 'ws-'));
  const foundry = new Foundry(ws, { models: ctx.port, modelPolicy: ctx.policy, policy: { maxCost: 2, maxConcurrency: 8, maxDurationMs: 20 * 60 * 1000 } });
  try {
    const saved = foundry.save(workflow);
    const input = { prompt: t.task.prompt, inputs: t.task.inputs ?? {}, ...(t.task.files ? { files: t.task.files } : {}) };
    const run = foundry.createRun(saved.hash, input, { sampleSalt: `${armId}:t${trial}`, modelMode: 'replay' });
    const started = Date.now();
    const done = await foundry.runtime.execute(run.id);
    const raw = done.outputs?.answer, answer = raw == null ? null : (raw.answer ?? raw);
    const v = answer == null ? { pass: false, score: 0 } : await score(family, t.task, answer);
    return { taskHash: t.taskHash, status: done.status, error: done.error?.code ?? null, verdict: done.verdict?.verdict ?? null, pass: !!v.pass, score: v.score,
      calls: ctx.journal.forRun(run.id).length, ms: Date.now() - started, outputs: done.outputs, answer };
  } finally { await foundry.close(); rmSync(ws, { recursive: true, force: true }); }
}
const slim = ({ outputs, answer, ...rest }) => rest;

// Pin-node substitution: the node becomes a JS code node that returns a constant. It keeps the same id, `needs` and every
// ref the original read (code args, or agent context inputs), so the run-time taint label of its output is unchanged.
const readsOf = n => n.kind === 'code' ? (n.args ?? {}) : Object.fromEntries((n.context?.inputs ?? []).filter(i => i.ref).map((i, k) => [`r${k}`, { $ref: i.ref }]));
const pin = (workflow, id, value, { keepReads = true } = {}) => ({ ...workflow, nodes: workflow.nodes.map(n => n.id !== id ? n : { id, kind: 'code', lang: 'js',
  needs: n.needs ?? [], description: `heal counterfactual pin of ${id}`, args: keepReads ? readsOf(n) : {},
  source: `export default function main() { return ${JSON.stringify(value)}; }`, timeoutMs: 20000 }) });
// Journal injection: a newer row with the same replay key wins Journal.lookup (ORDER BY id DESC). Only ever on the copy.
function inject(db, id, value) {
  const r = db.prepare('SELECT * FROM model_calls WHERE id=?').get(id), cols = Object.keys(r).filter(c => c !== 'id');
  db.prepare(`INSERT INTO model_calls(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...cols.map(c =>
    c === 'response' ? JSON.stringify({ ...JSON.parse(r.response), value, heal: { counterfactualOf: id } })
      : c === 'request' ? JSON.stringify({ ...JSON.parse(r.request ?? '{}'), heal: 'counterfactual' }) : c === 'cost_usd' ? 0 : r[c]));
}
const uninject = (db, id) => db.prepare("DELETE FROM model_calls WHERE json_extract(response,'$.heal.counterfactualOf')=?").run(id);

const out = { generated: new Date().toISOString(), kit, c0: {}, p1: {} };

// ---- 1. C0 dev: replay fidelity, counterfactuals, fragility, cost profile -----------------------------------------------
{
  const ctx = replayPort(path.join(REPO, 'experiments/runs/c0-dev/journal.sqlite'), 'c0-dev', ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);
  out.c0.policyHash = policyHash(ctx.policy);
  const results = readJsonl(path.join(REPO, 'experiments/runs/c0-dev/results.jsonl'));
  const art = name => JSON.parse(readFileSync(path.join(REPO, 'research/construction-20261006/artifacts', name, 'workflow.json'), 'utf8'));
  const wf = { records: art('F-haiku-records-k1'), codefix: art('F-haiku-codefix-k1') };
  const fh = results.filter(r => r.arm === 'F-haiku');
  out.c0.fidelity = [];
  const base = {};
  for (const r of fh) {
    const seed = Number(r.task.split(':s').pop());
    const x = await replayTrial(ctx, wf[r.family], r.family, 'test', 3, seed, r.trial, 'F-haiku');
    base[`${r.family}:${seed}:${r.trial}`] = x;
    out.c0.fidelity.push({ family: r.family, seed, trial: r.trial, taskHashMatch: x.taskHash === r.taskHash, recorded: { pass: r.pass, score: r.score, verdict: r.meta?.verdict, calls: r.meta?.calls },
      replay: slim(x), identical: x.taskHash === r.taskHash && x.pass === r.pass && x.score === r.score && x.verdict === r.meta?.verdict && x.calls === r.meta?.calls });
  }
  // records s6001 t0: identity control, then every single-field flip of the global read `conf` (enum domains from its returns schema).
  const enums = wf.records.nodes.find(n => n.id === 'conf').returns.properties.orders.items.properties;
  const f0 = base['records:6001:0'], conf = f0.outputs.conf;
  const cf = [];
  const idc = await replayTrial(ctx, pin(wf.records, 'conf', conf), 'records', 'test', 3, 6001, 0, 'F-haiku');
  cf.push({ node: 'conf', change: 'identity', score: idc.score, pass: idc.pass, error: idc.error });
  for (let i = 0; i < conf.orders.length; i++) for (const field of ['numeric_order', 'sign_flip']) for (const v of enums[field].enum) {
    if (v === conf.orders[i][field]) continue;
    const changed = structuredClone(conf); changed.orders[i][field] = v;
    const x = await replayTrial(ctx, pin(wf.records, 'conf', changed), 'records', 'test', 3, 6001, 0, 'F-haiku');
    cf.push({ node: 'conf', system: conf.orders[i].system, field, from: conf.orders[i][field], to: v, score: x.score, pass: x.pass, error: x.error });
  }
  out.c0.recordsConfFlips = { trial: 'records:test:d3:s6001 t0', candidates: cf.length - 1, passing: cf.filter(c => c.pass).map(c => `${c.system}.${c.field}=${c.to}`), rows: cf };
  // codefix: identity control with and without the original reads (taint label), then flip check1.ok.
  out.c0.codefixCheckFlips = [];
  for (const key of ['codefix:6001:0', 'codefix:6004:0', 'codefix:6004:1', 'codefix:6001:1']) {
    const [, seed, trial] = key.split(':').map(Number), c1 = base[key].outputs.check1;
    const row = { trial: `codefix:test:d3:s${seed} t${trial}`, check1Ok: c1.ok, problems: c1.problems?.length ?? null, recordedPass: base[key].pass };
    for (const [label, w] of [['identity, reads dropped', pin(wf.codefix, 'check1', c1, { keepReads: false })], ['identity, reads kept', pin(wf.codefix, 'check1', c1)],
      [`ok ${c1.ok} -> ${!c1.ok}`, pin(wf.codefix, 'check1', { ...c1, ok: !c1.ok })]]) {
      const x = await replayTrial(ctx, w, 'codefix', 'test', 3, seed, trial, 'F-haiku');
      row[label] = { score: x.score, pass: x.pass, error: x.error, calls: x.calls };
    }
    out.c0.codefixCheckFlips.push(row);
  }
  // Oracle-free fragility: on every records trial, flip one numeric order (MDY<->DMY) or one sign and measure the share of
  // answer records that change. No oracle is needed for the share; the oracle column is shown only for comparison.
  const keyset = a => new Set((a?.records ?? []).map(r => canonical(r)));
  out.c0.fragility = [];
  for (const [key, b] of Object.entries(base).filter(([k]) => k.startsWith('records:'))) {
    const [, seed, trial] = key.split(':').map(Number), B = keyset(b.answer), c = b.outputs.conf;
    for (let i = 0; i < c.orders.length; i++) for (const [field, to] of [['numeric_order', { MDY: 'DMY', DMY: 'MDY' }[c.orders[i].numeric_order]], ['sign_flip', -c.orders[i].sign_flip]]) {
      if (to === undefined) continue;
      const changed = structuredClone(c); changed.orders[i][field] = to;
      const x = await replayTrial(ctx, pin(wf.records, 'conf', changed), 'records', 'test', 3, seed, trial, 'F-haiku');
      const C = keyset(x.answer); let same = 0; for (const k of C) if (B.has(k)) same++;
      out.c0.fragility.push({ seed, trial, basePass: b.pass, system: c.orders[i].system, field, to, baseRecords: B.size, flippedRecords: C.size,
        changedShare: +(1 - same / Math.max(B.size, C.size, 1)).toFixed(3), flippedPass: x.pass, error: x.error });
    }
  }
  out.c0.costProfile = fh.map(r => ({ family: r.family, seed: Number(r.task.split(':s').pop()), trial: r.trial, pass: r.pass, costUsd: r.costUsd, latencyMs: r.latencyMs, calls: r.meta?.calls, escalations: r.meta?.escalations }));
  ctx.db.close();
}

// ---- 2. P1 fhand-haiku d3/s5002 t1: replay, then journal injection at one map item ---------------------------------------
{
  const ctx = replayPort(path.join(REPO, 'experiments/runs/p1/journal.sqlite'), 'p1', ['claude-haiku-5-5', 'claude-haiku-4-5-20251001', 'claude-sonnet-5-5']);
  out.p1.policyHash = policyHash(ctx.policy);
  const results = readJsonl(path.join(REPO, 'experiments/runs/p1/results.jsonl'));
  const wf = buildRecordsV3Workflow({ extractModelClass: 'M', conventionsModelClass: 'M', maxClass: 'L', concurrency: 4, maxCost: 2, reasoning: 'none' });
  const rec = results.find(r => r.arm === 'fhand-haiku' && r.task === 'records:test:d3:s5002' && r.trial === 1);
  const CALL = 220;   // root/statuses:1/judge of run rec.meta.runId (research/core-20261006/diagnosis-workflow-agent.md)
  const call = ctx.db.prepare('SELECT run_id, node_key, response FROM model_calls WHERE id=?').get(CALL);
  if (call.run_id !== rec.meta.runId || call.node_key !== 'root/statuses:1/judge') throw new Error('journal row 220 is not the diagnosed call');
  const original = JSON.parse(call.response).value;
  const run = async () => slim(await replayTrial(ctx, wf, 'records', 'test', 3, 5002, 1, 'fhand-haiku'));
  const base = await run();
  out.p1.fidelity = { recorded: { pass: rec.pass, score: rec.score, verdict: rec.meta?.verdict, calls: rec.meta?.calls }, replay: base,
    identical: base.taskHash === rec.taskHash && base.score === rec.score && base.verdict === rec.meta?.verdict && base.calls === rec.meta?.calls };
  inject(ctx.db, CALL, original); out.p1.identity = await run(); uninject(ctx.db, CALL);
  out.p1.original = { meaning: original.meaning, relation: original.relation, compared_with: original.compared_with };
  out.p1.flips = [];
  const variants = [{ meaning: original.meaning === 'live' ? 'void' : 'live' }, { relation: 'same_as' }, { relation: 'different_from' },
    { meaning: 'void', relation: 'different_from', compared_with: 'ordinary_live_rows' }];
  for (const v of variants) {
    inject(ctx.db, CALL, { ...original, ...v });
    const x = await run();
    uninject(ctx.db, CALL);
    out.p1.flips.push({ change: v, score: x.score, pass: x.pass, verdict: x.verdict, error: x.error, calls: x.calls });
  }
  // How often did the status judgment take the relation:"none" branch, where STATUS_CHECKS leave `meaning` unchecked?
  out.p1.escapeHatch = {};
  for (const arm of ['fhand-haiku', 'fhand-sonnet']) {
    const counts = { judgments: 0, relationNone: 0, relationNoneLive: 0, relationNoneVoid: 0 };
    for (const r of results.filter(x => x.arm === arm)) for (const row of ctx.db.prepare("SELECT response FROM model_calls WHERE run_id=? AND node_key LIKE 'root/statuses:%/judge' AND ok=1 AND json_extract(response,'$.heal') IS NULL").all(r.meta.runId)) {
      const v = JSON.parse(row.response).value; counts.judgments++;
      if (v.relation === 'none') { counts.relationNone++; counts[v.meaning === 'live' ? 'relationNoneLive' : 'relationNoneVoid']++; }
    }
    out.p1.escapeHatch[arm] = counts;
  }
  ctx.db.close();
}

const text = JSON.stringify(out, null, 1) + '\n';
if (OUT) writeFileSync(path.resolve(OUT), text); else process.stdout.write(text);
