#!/usr/bin/env node
// VL-1 step 4: choose one world per task from a LABEL-FREE live lab, with the frozen verifiers' stored outputs
// (VERIFIER-LAB.md §3.1, §4.2, §5 step 4). $0: no model call, no grade, no file under a run's host/ directory.
//
//   node select.mjs --vlab <live lab> --rl2 <RL2 out dir> --rl2-tag look2 [--rl2-judge-tag look2] --dj <judge out dir>
//       --pools 'P2=v1m,sonnet-a1;P2h=v1m,haiku-a0;P3=v1m,sonnet-a1,haiku-a0;P2v2=v2m,sonnet-a1' --rules R0,R1,R2,R3
//       --out <selection.json>
//
// Signals per candidate (one canonical outcome row = one fork's final world on one task):
//   a = 1 when requirement-ledger-v2 (RL2, frozen v1) accepts it: combine() from its verify.mjs, support-weighted by the
//       number of readers, with its judged verdicts (no hard check fails and the world changed); 0 when rejected or when
//       RL2 produced no checks for the row
//   s = the RL2 score (0 when absent)
//   p = the Haiku world-reading judge's p_done (dj-v3; 0.5 when the judge gave no verdict)
// Rules (fixed before any look-2 result; the dev60 lab pre-declared them in this form):
//   R0  the pool's default fork (its first arm) alone
//   R1  RL2 alone: highest [a, s]
//   R2  the Haiku judge alone: highest [p]
//   R3  RL2 accept gate, then the judge ranks, then the RL2 score: highest [a, p, s]   (the VL-1 primary rule)
// Ties (|difference| <= 1e-12 at every key) go to fork order: the pool's arms as listed, default first. A task with no
// candidate in the pool gets no pick (null; it scores as a fail). A task missing the default fork's row is decided among
// the candidates present.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { combine, VERIFY_VERSION } from '../requirement-ledger-v2/verify.mjs';

export const SELECT_VERSION = 'vl1-select-v1';
export const RULES = Object.freeze({
  R0: 'the pool default fork (first arm) alone',
  R1: 'RL2 frozen v1 alone: key [accept, score]',
  R2: 'Haiku world-reading judge (dj-v3) alone: key [p_done]',
  R3: 'RL2 accept gate, then Haiku p_done, then RL2 score: key [accept, p_done, score]',
});
export const DJ_FILE = 'judgments-haiku-world.jsonl';
export const DJ_VERSION = 'dj-v3';
const EPS = 1e-12;
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Every file this module reads goes through here: it refuses a path inside a run's host/ directory (grades live there). */
export function guardedRead(p, read = readFileSync) {
  const parts = path.resolve(p).split(path.sep);
  if (parts.includes('host')) throw new Error(`select: refused to read under a host/ directory: ${p}`);
  return read(p, 'utf8');
}
const sha256 = s => createHash('sha256').update(s).digest('hex');
const jsonl = text => text.split('\n').filter(Boolean).map(l => JSON.parse(l));

export function parsePools(spec) {
  const pools = {};
  for (const part of String(spec).split(';').map(s => s.trim()).filter(Boolean)) {
    const [name, arms] = part.split('=');
    const list = (arms ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (!/^[A-Za-z0-9_-]+$/.test(name ?? '') || !list.length || new Set(list).size !== list.length) throw new Error(`bad pool ${part}`);
    pools[name] = list;
  }
  if (!Object.keys(pools).length) throw new Error('no pool');
  return pools;
}

const cmp = (ka, kb) => { for (let i = 0; i < ka.length; i++) { if (ka[i] > kb[i] + EPS) return 1; if (ka[i] < kb[i] - EPS) return -1; } return 0; };

/** Pick one candidate. rows: candidates of one task; order: the pool's arms (default first); sig: rowId -> {a, s, p}. */
export function pick(rule, rows, order, sig) {
  const rs = rows.filter(r => order.includes(r.arm));
  if (!rs.length) return null;
  const byOrder = (x, z) => order.indexOf(x.arm) - order.indexOf(z.arm);
  const keyOf = { R1: r => [sig(r).a, sig(r).s], R2: r => [sig(r).p], R3: r => [sig(r).a, sig(r).p, sig(r).s] }[rule];
  if (rule === 'R0') return rs.find(r => r.arm === order[0]) ?? [...rs].sort(byOrder)[0];
  if (!keyOf) throw new Error(`unknown rule ${rule}`);
  return [...rs].sort((x, z) => cmp(keyOf(z), keyOf(x)) || byOrder(x, z))[0];
}

/** The verifier signals of every row: RL2 (checks + judged verdicts, combined as frozen) and the Haiku judge's p_done. */
export function signals(rows, { checks, rl2Judge, dj }) {
  const out = new Map();
  for (const r of rows) {
    const c = checks.get(r.rowId);
    const j = rl2Judge.get(r.rowId);
    const v = c ? combine({ code: c.code, judged: c.judged, verdicts: j?.verdicts ?? null, useJudged: true, readers: c.readers }) : null;
    const h = dj.get(r.rowId);
    out.set(r.rowId, { a: v?.accept ? 1 : 0, s: v?.score ?? 0, p: h ? Number(h.confidence) : 0.5, rl2: Boolean(c), rl2Judged: Boolean(j), dj: Boolean(h),
      hardFails: v?.hardFails ?? null, accept: v ? v.accept : null });
  }
  return out;
}

export function selectAll({ labDir, rl2Dir, rl2Tag, rl2JudgeTag = rl2Tag, djDir, pools, rules = ['R0', 'R1', 'R2', 'R3'], read = readFileSync }) {
  for (const r of rules) if (!RULES[r]) throw new Error(`unknown rule ${r}`);
  const inputs = {};
  const take = p => { const t = guardedRead(p, read); inputs[p] = sha256(t); return t; };
  const manifestFile = path.join(labDir, 'manifest.json');
  const manifest = JSON.parse(take(manifestFile));
  const rowsAll = jsonl(take(path.join(labDir, 'dataset.jsonl')));
  const labelled = rowsAll.filter(r => r.label !== null);
  if (labelled.length) throw new Error(`select: ${labelled.length} row(s) carry a label; a selection reads label-free rows only`);
  const rows = rowsAll.filter(r => r.outcome && r.canonical);
  const order = manifest.armOrder;
  for (const [name, arms] of Object.entries(pools)) for (const a of arms) if (!order.includes(a)) throw new Error(`pool ${name}: arm ${a} is not in the lab (${order.join(', ')})`);
  const tag = t => (t ? `-${t}` : '');
  const checksFile = path.join(rl2Dir, `checks${tag(rl2Tag)}.jsonl`), judgeFile = path.join(rl2Dir, `judge${tag(rl2JudgeTag)}.jsonl`), djFile = path.join(djDir, DJ_FILE);
  const checks = new Map(jsonl(take(checksFile)).map(c => [c.rowId, c]));
  const rl2Judge = new Map(existsSync(judgeFile) ? jsonl(take(judgeFile)).filter(j => j.ok).map(j => [j.rowId, j]) : []);
  const dj = new Map(jsonl(take(djFile)).filter(j => j.ok && j.variant === 'world' && j.version === DJ_VERSION).map(j => [j.rowId, j.verdict]));
  const sig = signals(rows, { checks, rl2Judge, dj });
  const tasks = [...new Set(rowsAll.map(r => r.task))].sort();
  const byTask = new Map(tasks.map(t => [t, rows.filter(r => r.task === t)]));
  const selections = [];
  for (const [pool, arms] of Object.entries(pools)) {
    for (const rule of rules) {
      const picks = {}, rowIds = {};
      let switched = 0, none = 0;
      for (const t of tasks) {
        const p = pick(rule, byTask.get(t), arms, r => sig.get(r.rowId));
        picks[t] = p ? p.run : null; rowIds[t] = p ? p.rowId : null;
        if (!p) none++; else if (p.arm !== arms[0]) switched++;
      }
      selections.push({ pool, rule, arms, default: arms[0], picks, rows: rowIds, switchedFromDefault: switched, noCandidate: none });
    }
  }
  const coverage = {};
  for (const [pool, arms] of Object.entries(pools)) {
    const cand = rows.filter(r => arms.includes(r.arm));
    coverage[pool] = { tasks: tasks.length, tasksWithAllArms: tasks.filter(t => arms.every(a => byTask.get(t).some(r => r.arm === a))).length,
      tasksWithNoCandidate: tasks.filter(t => !byTask.get(t).some(r => arms.includes(r.arm))).length, candidates: cand.length,
      withRl2Checks: cand.filter(r => sig.get(r.rowId).rl2).length, withRl2Judged: cand.filter(r => sig.get(r.rowId).rl2Judged).length,
      withJudgeVerdict: cand.filter(r => sig.get(r.rowId).dj).length };
  }
  const own = p => { inputs[p] = sha256(readFileSync(p)); };
  own(fileURLToPath(import.meta.url));
  own(path.join(HERE, '../requirement-ledger-v2/verify.mjs'));
  return {
    schema: 'foundry.vl1.selection/v1', version: SELECT_VERSION, verifyVersion: VERIFY_VERSION, judgeVersion: DJ_VERSION,
    evidence: 'blind: built from a label-free lab and stored verifier outputs; no grade or results record read',
    lab: { dir: labDir, listSha256: manifest.listSha256, tasks: tasks.length, armOrder: order, arms: manifest.arms, datasetSha256: manifest.datasetSha256, manifestSha256: inputs[manifestFile] },
    verifiers: { rl2: { checksFile, judgeFile, versions: [...new Set([...checks.values()].map(c => c.version))] }, dj: { file: djFile } },
    rules: Object.fromEntries(rules.map(r => [r, RULES[r]])), pools, coverage, selections,
    signals: Object.fromEntries([...sig].map(([id, v]) => [id, { a: v.a, s: v.s, p: v.p, rl2: v.rl2, rl2Judged: v.rl2Judged, dj: v.dj, hardFails: v.hardFails }])),
    inputs,
  };
}

function args(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument ${argv[i]}`);
    a[argv[i].slice(2)] = argv[++i];
  }
  return a;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const o = args(process.argv.slice(2));
    for (const k of ['vlab', 'rl2', 'dj', 'pools', 'out']) if (!o[k]) throw new Error(`--${k} is required`);
    const res = selectAll({ labDir: path.resolve(o.vlab), rl2Dir: path.resolve(o.rl2), rl2Tag: o['rl2-tag'] ?? '', rl2JudgeTag: o['rl2-judge-tag'] ?? o['rl2-tag'] ?? '',
      djDir: path.resolve(o.dj), pools: parsePools(o.pools), rules: (o.rules ?? 'R0,R1,R2,R3').split(',').map(s => s.trim()).filter(Boolean) });
    res.createdAt = new Date().toISOString();
    mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
    writeFileSync(o.out, JSON.stringify(res, null, 1) + '\n');
    console.log(JSON.stringify({ out: o.out, coverage: res.coverage, selections: res.selections.map(s => `${s.pool}/${s.rule}: switched ${s.switchedFromDefault}, none ${s.noCandidate}`) }, null, 1));
  } catch (e) { console.error(e.stack ?? String(e)); process.exit(1); }
}
