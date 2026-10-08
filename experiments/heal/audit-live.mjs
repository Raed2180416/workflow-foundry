// Independent re-computation of the 2026-10-08 live heal results from raw data ($0: strict replay only; nothing can spend).
//
//   node experiments/heal/audit-live.mjs [--out experiments/heal/runs/live-20261008/audit.json] [--only spend,cfx,fresh,lineage]
//
// What it recomputes, and from what (no heal-run record field is trusted as input except the proposal ops and the V7 seed list):
//   spend    every charge in spend-global.jsonl, per scope, against each incident's own spend.jsonl, each heal-run budget summary,
//            each proposer round journal (sum of cost_usd) and each archived fresh-task journal (sum of cost_usd).
//   cfx      the three relaxed-check candidates are re-compiled from their ops on the frozen kit (hash must equal the verified
//            candidate hash); base and candidate are strictly replayed on the recorded C0 journal for the 3 failing and 8 passing
//            runs and scored by the bed oracle (V3/V4), with 0 live calls required; the V6 cost ratio is recomputed.
//   fresh    every V7 row of every archived verification is replayed strictly from the archived fresh-task journal (base and
//            candidate, the gate's own salt) and scored by the bed oracle; the stratum is recomputed from the bed.
//   lineage  each promotion line names a code decision; decide() is re-run on each archived verification record.
// Output: ids, scores, counts, hashes and dollars only (never task text or model output).
import path from 'node:path';
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { REPO, loadKit } from './kit.mjs';
import { loadGate } from './pin-gate.mjs';
import { allTrials, findTrial, loadWorkflow, p1Workflow, openCtx, replayRun, taskOf, pmap, bedsLib } from './replay.mjs';
import { compileOps } from './ops.mjs';
import { digest } from './ir.mjs';
import { decide } from './promote.mjs';
import { STRATA } from './verify.mjs';

const arg = (name, dflt) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : dflt);
const LIVE = path.join(REPO, 'experiments/heal/runs');
const RUN_DIRS = ['live-20261008', 'live-20261008-r2', 'live-20261008-r3', 'live-20261008-r4'];
const ARCHIVE = path.join(LIVE, 'live-20261008/archive');
const only = new Set((arg('only', 'spend,cfx,fresh,lineage')).split(','));
const out = { schema: 'heal-live-audit/1', at: new Date().toISOString() };
const jsonl = f => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const r6 = x => +(+x).toFixed(6);
const dbSum = file => { const db = new DatabaseSync(file, { readOnly: true }); try { return db.prepare('SELECT COUNT(*) n, COALESCE(SUM(cost_usd),0) usd, SUM(CASE WHEN ok=1 THEN 0 ELSE 1 END) failed FROM model_calls').get(); } finally { db.close(); } };

// ---- spend ---------------------------------------------------------------------------------------------------------------------
if (only.has('spend')) {
  const global = jsonl(path.join(LIVE, 'live-20261008/spend-global.jsonl'));
  const byScope = {}; for (const l of global) byScope[l.scope] = r6((byScope[l.scope] ?? 0) + (l.usd ?? 0));
  const runs = [];
  for (const d of RUN_DIRS) for (const inc of ['rec', 'cfx', 'p1']) {
    const rec = path.join(LIVE, d, `${inc}.json`); if (!existsSync(rec)) continue;
    const o = JSON.parse(readFileSync(rec, 'utf8')), lines = jsonl(path.join(LIVE, d, inc, 'spend.jsonl'));
    const file = r6(lines.reduce((s, l) => s + l.usd, 0));
    const proposerDir = path.join(LIVE, d, inc, 'proposer');
    const rounds = existsSync(proposerDir) ? readdirSync(proposerDir).sort().map(r => ({ round: r, ...dbSum(path.join(proposerDir, r, 'journal.sqlite')) })) : [];
    const proposerJournalUsd = r6(rounds.reduce((s, r) => s + r.usd, 0)), proposerRecordUsd = r6((o.proposerRounds ?? []).reduce((s, r) => s + (r.costUsd ?? 0), 0));
    const proposerLedgerUsd = r6(lines.filter(l => /^proposer/.test(l.label)).reduce((s, l) => s + l.usd, 0));
    const boundLines = lines.filter(l => l.usd >= 0.9);
    runs.push({ run: `${d}/${inc}`, recordSpent: o.budget?.spentUsd, cap: o.budget?.capUsd, fileSpent: file, fileMatchesRecord: Math.abs(file - (o.budget?.spentUsd ?? 0)) < 1e-5, overCap: file > (o.budget?.capUsd ?? Infinity) + 1e-9,
      proposer: { rounds: rounds.length, journalUsd: proposerJournalUsd, recordUsd: proposerRecordUsd, ledgerUsd: proposerLedgerUsd, failedCalls: rounds.reduce((s, r) => s + (r.failed ?? 0), 0) },
      boundCharges: boundLines.map(l => ({ label: l.label, usd: l.usd })) });
  }
  const freshDir = path.join(ARCHIVE, 'fresh-journals');
  const fresh = existsSync(freshDir) ? readdirSync(freshDir).filter(f => f.endsWith('.sqlite')).map(f => ({ file: f, ...dbSum(path.join(freshDir, f)) })) : [];
  out.spend = { total: r6(global.reduce((s, l) => s + (l.usd ?? 0), 0)), lines: global.length, byScope, incidentSumsMatchScopes: Object.fromEntries(['H-rec', 'H-cfx', 'H-p1'].map(s => [s, r6(runs.filter(r => r.run.endsWith({ 'H-rec': '/rec', 'H-cfx': '/cfx', 'H-p1': '/p1' }[s])).reduce((a, r) => a + r.fileSpent, 0))])), runs, fresh };
  console.error(`[audit] spend: total $${out.spend.total} in ${global.length} lines`);
}

const kit = await loadKit(), gate = await loadGate(), trials = allTrials();
const strictRun = async (wf, trial, { journalFile = null, salt = null, task = null, source = trial.source } = {}) => {
  const ctx = await openCtx(source, { kit, name: 'audit', journalFile });
  try {
    const r = await replayRun(ctx, wf, trial, { mode: 'replay', salt, task });
    return { pass: r.pass, score: +(+r.score).toFixed(6), status: r.status, err: r.error?.code ?? null, verdict: r.verdict, calls: r.calls, liveCalls: r.liveCalls, fullUsd: r6(r.fullUsd) };
  } finally { ctx.close(); }
};

// ---- codefix V3/V4/V6 ------------------------------------------------------------------------------------------------------------
if (only.has('cfx')) {
  const base = await loadWorkflow(path.join(REPO, 'research/construction-20261006/artifacts/F-haiku-codefix-k1/workflow.json'));
  const policy = kit.sessionPolicy(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);
  const env = { classOrder: policy.classOrder, classOf: id => kit.policy.modelById(policy, id).class, isStrong: gate.isStrong };
  const pool = trials.filter(t => t.source === 'c0-dev' && t.armId === 'F-haiku' && t.family === 'codefix').sort((a, b) => a.key.localeCompare(b.key));
  const tasks = Object.fromEntries(await Promise.all(pool.map(async t => [t.key, await taskOf(t)])));
  const baseRows = Object.fromEntries(await pmap(pool, 3, async t => [t.key, await strictRun(base, t, { task: tasks[t.key] })]));
  const cands = [];
  for (const d of ['live-20261008-r2', 'live-20261008-r3', 'live-20261008-r4']) {
    const o = JSON.parse(readFileSync(path.join(LIVE, d, 'cfx.json'), 'utf8')), p = o.proposals.find(x => x.kind === 'defect');
    const c = compileOps(base, p.ops, { ...env, allowed: new Set(o.proposer.allowed), locus: new Set(o.proposer.locus) });
    const archived = readdirSync(path.join(ARCHIVE, 'state')).flatMap(s => readdirSync(path.join(ARCHIVE, 'state', s)).map(f => path.join(ARCHIVE, 'state', s, f))).find(f => f.endsWith(`${p.id}.json`));
    const verified = archived ? JSON.parse(readFileSync(archived, 'utf8')).verification.candidateHash : null;
    const rows = Object.fromEntries(await pmap(pool, 3, async t => [t.key, await strictRun(c.workflow, t, { task: tasks[t.key] })]));
    const failing = pool.filter(t => !t.pass), passing = pool.filter(t => t.pass);
    const ratio = [...failing, ...passing].reduce((s, t) => s + rows[t.key].fullUsd, 0) / [...failing, ...passing].reduce((s, t) => s + t.costUsd, 0);
    cands.push({ run: d, proposal: p.id, errors: c.errors.map(e => e.code), candidateHash: c.candidateHash?.slice(0, 16), verifiedHash: verified?.slice(0, 16), hashMatches: c.candidateHash === verified,
      v3: failing.map(t => ({ trial: t.key, base: baseRows[t.key].pass, cand: rows[t.key].pass, candScore: rows[t.key].score, candCalls: rows[t.key].calls, live: rows[t.key].liveCalls, err: rows[t.key].err })),
      v4: { n: passing.length, candPass: passing.filter(t => rows[t.key].pass).length, regressions: passing.filter(t => !rows[t.key].pass).map(t => t.key), live: passing.reduce((s, t) => s + rows[t.key].liveCalls, 0) },
      costRatio: +ratio.toFixed(4), anyLive: Object.values(rows).some(r => r.liveCalls > 0) });
  }
  out.cfx = { baseFidelity: pool.map(t => ({ trial: t.key, recordedPass: t.pass, replayPass: baseRows[t.key].pass, recordedScore: t.score, replayScore: baseRows[t.key].score })), candidates: cands };
  console.error(`[audit] cfx: ${cands.map(c => `${c.run} V3 ${c.v3.filter(x => x.cand).length}/${c.v3.length} V4 ${c.v4.candPass}/${c.v4.n} ratio ${c.costRatio} hash ${c.hashMatches}`).join('; ')}`);
}

// ---- V7: replay every fresh-task row from the archived fresh journals -------------------------------------------------------------------
const archivedRecords = () => readdirSync(path.join(ARCHIVE, 'state')).flatMap(s => readdirSync(path.join(ARCHIVE, 'state', s)).map(f => ({ state: s, file: path.join(ARCHIVE, 'state', s, f) })));
if (only.has('fresh')) {
  const lib = await bedsLib(), freshFiles = readdirSync(path.join(ARCHIVE, 'fresh-journals')).filter(f => f.endsWith('.sqlite')).map(f => path.join(ARCHIVE, 'fresh-journals', f));
  const recWf = await loadWorkflow(path.join(REPO, 'research/construction-20261006/artifacts/F-haiku-records-k1/workflow.json'));
  const cfxWf = await loadWorkflow(path.join(REPO, 'research/construction-20261006/artifacts/F-haiku-codefix-k1/workflow.json'));
  const p1v1 = await p1Workflow('M');
  const recs = archivedRecords().map(a => ({ ...a, ...JSON.parse(readFileSync(a.file, 'utf8')) })).filter(a => a.verification?.data?.fresh?.length);
  // the base each verification ran against: by hash among the known versions
  const known = [recWf, cfxWf, p1v1, ...recs.map(a => a.proposal.workflow)];
  const byHash = new Map(known.map(w => [digest(w), w]));
  const results = [];
  for (const a of recs) {
    const v = a.verification, base = byHash.get(v.baseHash), cand = a.proposal.workflow;
    const ref = a.state.endsWith('-cfx') ? findTrial('F-haiku/codefix:test:d3:s6004/0', trials) : a.state.endsWith('-rec') ? findTrial('F-haiku/records:test:d3:s6001/0', trials) : findTrial('fhand-haiku/records:test:d3:s5002/1', trials);
    const sample = a.state.endsWith('-rec') ? { identity: { system: 'BRIGHTDESK' } } : null;
    const rows = [];
    for (const row of v.data.fresh) {
      const [task] = await lib.makeTasks(ref.family, { split: 'dev', seeds: [row.seed], difficulty: ref.difficulty });
      const salt = `heal-fresh:${row.seed}:${row.i}`;
      // which archived journal holds this verification's calls: the one where the base replays without a miss
      let got = null;
      for (const f of freshFiles) {
        const pseudo = arm => ({ source: ref.source, family: ref.family, split: 'dev', difficulty: ref.difficulty, seed: row.seed, armId: `heal-fresh-${arm}`, trial: 0, key: `fresh/${row.seed}` });
        const b = await strictRun(base, pseudo('base'), { journalFile: f, salt, task, source: ref.source });
        if (b.err === 'REPLAY_MISS') continue;
        const c = await strictRun(cand, pseudo('cand'), { journalFile: f, salt, task, source: ref.source });
        got = { journal: path.basename(f), base: b, cand: c }; break;
      }
      const stratum = STRATA[ref.family] && (sample?.identity || STRATA[ref.family].global) ? await STRATA[ref.family](task.task, sample?.identity) : null;
      rows.push({ seed: row.seed, recorded: { base: row.base, cand: row.cand, stratum: row.stratum }, replay: got ? { base: got.base.pass, cand: got.cand.pass, baseErr: got.base.err, candErr: got.cand.err, journal: got.journal, liveCalls: got.base.liveCalls + got.cand.liveCalls } : null, stratum,
        agrees: !!got && got.base.pass === row.base && got.cand.pass === row.cand && (row.stratum ?? null) === (stratum ?? null) });
    }
    results.push({ record: path.relative(ARCHIVE, a.file), proposal: a.proposal.id, base: v.baseHash.slice(0, 10), cand: v.candidateHash.slice(0, 10), rows, allAgree: rows.every(r => r.agrees),
      base_pass: rows.filter(r => r.replay?.base).length, cand_pass: rows.filter(r => r.replay?.cand).length });
    console.error(`[audit] fresh ${a.proposal.id}: base ${results.at(-1).base_pass}/${rows.length} cand ${results.at(-1).cand_pass}/${rows.length} agree=${results.at(-1).allAgree}`);
  }
  out.fresh = results;
}

// ---- lineage and decisions ---------------------------------------------------------------------------------------------------------
if (only.has('lineage')) {
  const lines = ['rec', 'p1', 'cfx'].flatMap(k => jsonl(path.join(LIVE, 'live-20261008', `${k}.lineage.jsonl`)).map(l => ({ incident: k, ...l })));
  const recs = archivedRecords().map(a => ({ ...a, ...JSON.parse(readFileSync(a.file, 'utf8')) }));
  out.lineage = {
    lines: lines.map(l => ({ incident: l.incident, type: l.type, proposal: l.proposalId, kind: l.kind, version: l.newVersion, decision: l.decision, proposer: l.proposer, waivers: (l.waivers ?? []).map(w => ({ code: w.code, node: w.node, codeWritten: /run only when the independent reads disagree/.test(w.justification ?? '') })) })),
    redecided: recs.map(a => ({ record: path.relative(ARCHIVE, a.file), recorded: a.decision.decision, now: decide(a.verification, { ...a.proposal, depth: a.proposal.depth ?? 0 }).decision, reasons: decide(a.verification, { ...a.proposal, depth: a.proposal.depth ?? 0 }).reasons })),
  };
}

const file = path.resolve(arg('out', path.join(LIVE, 'live-20261008/audit.json')));
mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ out: path.relative(REPO, file), spend: out.spend?.total, cfx: out.cfx?.candidates?.map(c => [c.run, c.hashMatches, c.v3.map(x => x.cand), c.v4.candPass, c.costRatio]), fresh: out.fresh?.map(f => [f.proposal, f.base_pass, f.cand_pass, f.allAgree]), redecided: out.lineage?.redecided?.map(r => [r.record, r.recorded, r.now]) }, null, 1));
process.exit(0);
