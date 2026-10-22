#!/usr/bin/env node
// $0 reproduction check for VL-1 (development evidence): does the live pipeline (build-live.py -> frozen RL2 check and
// judge phases -> stored Haiku-judge verdicts -> select.mjs -> score.mjs), run on the STORED dev60 worlds, give the
// verifier lab's numbers? It compares, row by row and number by number:
//   1. the live lab's rows with the development lab's rows (every verifier-visible field);
//   2. the RL2 checks the live pipeline recomputed with the lab's stored checks;
//   3. that every RL2 judged-check input of the live lab has a stored judgment (same prompt key);
//   4. that every Haiku-judge prompt of the live lab hashes to a stored call in the judge's journal, and that the stored
//      verdict the selector used is that call's verdict;
//   5. the scored selections with the lab's pre-declared rule table (all tasks, and the held-out fold slice).
// Every path comes in as an argument. Labels of the development lab are read only in check 5's reference file.
//   node repro-check.mjs --live-lab D --dev-dataset F --live-rl2 D --live-tag T --dev-checks F --dj-journal F --dj D
//       --result F --result-heldout F --judge-eval F [--pool-map P2=P2,...] --out F
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { promptHashOf } from '../../../../src/models/port.mjs';
import { judgeContext } from '../diverse-judges/view.mjs';
import { judgeMessages, parseVerdict, OUTPUT_SCHEMA } from '../diverse-judges/judge.mjs';
import { judgeInput, JUDGE_VERSION as RL2_JUDGE_VERSION } from '../requirement-ledger-v2/judge.mjs';
import { bootstrap } from './score.mjs';

const jsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
function args(argv) { const a = {}; for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1]; return a; }
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

const o = args(process.argv.slice(2));
const out = { checks: {} };
const lab = await import(pathToFileURL(path.join(path.resolve(o['live-lab']), 'load.mjs')).href);
const liveAll = lab.loadRows({ outcomeOnly: false });
const live = lab.loadRows({ canonicalOnly: true });

// 1. rows
{
  const dev = new Map(jsonl(o['dev-dataset']).map(r => [r.rowId, r]));
  const fields = ['task', 'arm', 'run', 'outcome', 'canonical', 'prompt', 'today', 'services', 'world0Sha256', 'finalSha256', 'diff', 'writes'];
  const bad = {};
  let identical = 0;
  for (const r of liveAll) {
    const d = dev.get(r.rowId);
    if (!d) { (bad.missingInDev ??= []).push(r.rowId); continue; }
    let ok = true;
    for (const f of fields) if (!same(r[f], d[f])) { (bad[f] ??= []).push(r.rowId); ok = false; }
    if (!same(r.worlds.initialRebuilt, d.worlds.initialRebuilt)) { (bad.initialRebuilt ??= []).push(r.rowId); ok = false; }
    if (r.label !== null) { (bad.label ??= []).push(r.rowId); ok = false; }
    if (ok) identical++;
  }
  out.checks.rows = { liveRows: liveAll.length, identical, mismatches: Object.fromEntries(Object.entries(bad).map(([k, v]) => [k, v.length])), pass: identical === liveAll.length };
}
// 2. RL2 checks
const tag = o['live-tag'] ? `-${o['live-tag']}` : '';
const liveChecks = new Map(jsonl(path.join(o['live-rl2'], `checks${tag}.jsonl`)).map(c => [c.rowId, c]));
{
  const dev = new Map(jsonl(o['dev-checks']).map(c => [c.rowId, c]));
  let identical = 0, differ = 0, missing = 0;
  for (const [id, c] of liveChecks) {
    const d = dev.get(id);
    if (!d) { missing++; continue; }
    const k = x => JSON.stringify({ version: x.version, readers: x.readers, judged: x.judged, code: x.code });
    if (k(c) === k(d)) identical++; else differ++;
  }
  out.checks.rl2Checks = { rows: liveChecks.size, identical, differ, missingInDev: missing, pass: identical === liveChecks.size && liveChecks.size === live.length };
}
// 3. RL2 judged checks: every accepted candidate with judged requirements has a stored judgment of the same input
{
  const judged = new Map(jsonl(path.join(o['live-rl2'], `judge${tag}.jsonl`)).filter(j => j.ok).map(j => [j.key, j]));
  let need = 0, have = 0;
  for (const r of live) {
    const c = liveChecks.get(r.rowId);
    if (!c?.judged?.length || c.code.some(x => x.hard && x.pass === false)) continue;
    need++;
    const x = judgeInput(lab.verifierView(r), lab.loadWorlds(r).initial, c.judged);
    if (judged.has(`${RL2_JUDGE_VERSION}|${x.key}|claude-haiku-5-5`)) have++;
  }
  out.checks.rl2Judge = { needed: need, stored: have, pass: need === have };
}
// 4. Haiku judge: prompt hashes in the journal; the verdict the selector used is the journal call's verdict
{
  const calls = [];
  for (const f of String(o['dj-journal']).split(',').filter(Boolean)) {
    const db = new DatabaseSync(f, { readOnly: true });
    calls.push(...db.prepare("select prompt_hash, response from model_calls where model_id = 'claude-haiku-5-5' and ok = 1").all());
    db.close();
  }
  const byHash = new Map();
  for (const c of calls) { if (!byHash.has(c.prompt_hash)) byHash.set(c.prompt_hash, []); byHash.get(c.prompt_hash).push(c.response); }
  const used = new Map(jsonl(path.join(o.dj, 'judgments-haiku-world.jsonl')).filter(j => j.ok && j.variant === 'world').map(j => [j.rowId, j.verdict]));
  let rows = 0, hashed = 0, verdictMatch = 0;
  for (const r of live) {
    rows++;
    const m = judgeMessages(judgeContext(lab.verifierView(r), lab.loadWorlds(r).initial, { withRecords: true, recordsCap: 20000 }));
    const h = promptHashOf({ system: m.system, prompt: m.prompt, schema: OUTPUT_SCHEMA });
    const resp = byHash.get(h);
    if (!resp) continue;
    hashed++;
    const v = used.get(r.rowId);
    const verdicts = resp.map(s => { try { const j = JSON.parse(s); return parseVerdict(typeof j.value === 'object' && j.value ? j.value : JSON.parse(j.text)); } catch { return null; } });
    if (v && verdicts.some(x => x && same(x, v))) verdictMatch++;
  }
  out.checks.haikuJudge = { rows, promptInJournal: hashed, verdictIsJournalVerdict: verdictMatch, pass: hashed === rows && verdictMatch === rows };
}
// 5. numbers against the lab's pre-declared rule table
const devRows = jsonl(o['dev-dataset']);
/** The lab's task order for a pool: first appearance among its canonical outcome rows of the pool's arms. */
function labOrder(arms, tasks) {
  const seen = [];
  for (const r of devRows) if (r.canonical && r.outcome && arms.includes(r.arm) && tasks.has(r.task) && !seen.includes(r.task)) seen.push(r.task);
  return seen;
}
{
  const ref = JSON.parse(readFileSync(o['judge-eval'], 'utf8')).pools;
  const poolMap = Object.fromEntries((o['pool-map'] ?? 'P2=P2,P3=P3,P3s=P3s,P6=P6').split(',').map(s => s.split('=')));
  const cmp = [];
  for (const [file, slice] of [[o.result, 'all'], [o['result-heldout'], 'f34']]) {
    if (!file) continue;
    const res = JSON.parse(readFileSync(file, 'utf8'));
    for (const s of res.selections) {
      const refPool = poolMap[s.pool];
      const r = refPool && ref[`${refPool}/${slice}`]?.rules?.[s.rule];
      if (!r) continue;
      const mine = { pass: s.pass, gains: s.vsDefault.gains, losses: s.vsDefault.losses, ci95: s.vsDefault.bootstrap95 };
      const cell = { cell: `${s.pool}/${s.rule}/${slice}`, lab: r, live: mine, equal: same(mine, { pass: r.pass, gains: r.gains, losses: r.losses, ci95: r.ci95 }) };
      // The bootstrap resamples task indices with a fixed generator, so its interval depends on the order the tasks are
      // fed in: score.mjs sorts them; the lab fed them in its dataset's row order. Re-run it in the lab's order.
      if (!cell.equal && same([mine.pass, mine.gains, mine.losses], [r.pass, r.gains, r.losses]) && s.perTask) {
        const order = labOrder(s.arms, new Set(Object.keys(s.perTask.selected)));
        const ci = bootstrap(order.map(t => s.perTask.selected[t] - s.perTask.default[t]));
        cell.ciInLabOrder = ci;
        cell.equal = same(ci, r.ci95);
        cell.note = 'interval equal once the tasks are fed in the lab order';
      }
      cmp.push(cell);
    }
  }
  out.checks.numbers = { cells: cmp.length, equal: cmp.filter(c => c.equal).length, differing: cmp.filter(c => !c.equal), pass: cmp.length > 0 && cmp.every(c => c.equal) };
  out.table = cmp.map(c => `${c.cell}: ${c.live.pass} (+${c.live.gains}/-${c.live.losses}) [${c.live.ci95.join(', ')}]${c.equal ? '' : ` vs lab ${c.lab.pass} (+${c.lab.gains}/-${c.lab.losses}) [${c.lab.ci95.join(', ')}]`}`);
}
out.pass = Object.values(out.checks).every(c => c.pass);
writeFileSync(o.out, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ pass: out.pass, checks: Object.fromEntries(Object.entries(out.checks).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([kk]) => kk !== 'differing'))])) }, null, 1));
if (!out.pass) process.exit(1);
