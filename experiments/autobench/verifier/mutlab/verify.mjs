#!/usr/bin/env node
// Move 4 step 3: run every $0 verifier on every replayed mutant, twin and control, and on the stored rows.
//
//   node verify.mjs --vlab <stored dev60 lab> --rl2 <RL2 output dir> --cc-facts <facts.json> --work <mutlab work dir>
//       --out <verdicts.jsonl>
//
// Verifiers (all code, no model call): RL2 frozen code checks (accept = no hard code failure and something changed;
// score = combine() without judged verdicts), each RL2 reader alone, code-checks v1.1 (with the stored Haiku facts),
// the three-valued verdict over RL2 + code-checks (policies T1 and T3), and a non-empty-diff baseline. A model judge would
// cost money: the judge arms on mutants are a paid step (ATTACK: <= $1) that needs its own preregistration.
// The verifiers see what they saw in the lab (request, clock, services, the candidate's initial world, diff and final
// world). The replay outputs' grade fields are not read here; score.mjs joins them.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { combine } from '../requirement-ledger-v2/verify.mjs';
import { verify as ccVerify } from '../code-checks/verify.mjs';
import { factsKey } from '../code-checks/facts.mjs';
import { REPORTED_ARMS, loadLab, readGz, readJsonl, viewOf, worldsOf } from './labio.mjs';
import { canonicalRowsOf, ccObligations, readerVerdicts, rl2Check, rl2Ledgers, rl2Obligations } from '../tristate/adapters.mjs';
import { POLICIES, verdictOf } from '../tristate/verdict.mjs';

export const VERIFY_VERSION = 'mutlab-verify-v1';

/** All verifier outputs for one candidate (view of the seed row + this candidate's worlds and diff). */
export function verifyCandidate({ ledger, view, world0, final, diff, hf, verdicts = null, stored = false }) {
  const rl2 = rl2Check(ledger, { diff, world0, final });
  const rl2c = combine({ code: rl2.results, judged: rl2.judged, verdicts: null, readers: ledger.merged.readers });
  // stored rows only: RL2 with its stored judged-check verdicts (rule R1's input; a row the judge phase skipped, because a
  // hard code check already failed, has none); mutants have none ($0 means no judge)
  const rl2full = stored ? combine({ code: rl2.results, judged: rl2.judged, verdicts, readers: ledger.merged.readers }) : null;
  const readers = readerVerdicts(rl2.results, ledger.merged);
  const cc = ccVerify({ view: { ...view, diff }, world0, hf });
  const obs = [...rl2Obligations(rl2.results, { judged: rl2.judged }), ...ccObligations(cc.checks)];
  const tri = {};
  for (const p of ['T1', 'T3']) { const v = verdictOf(obs, rl2.effects, POLICIES[p]); tri[p] = { S: v.S, F: v.F, U: v.U, release: v.release, row: v.row, unknownShare: v.unknownShare }; }
  return {
    rl2: { accept: rl2c.accept, score: rl2c.score, hardFails: rl2c.hardFails, softFails: rl2c.softFails },
    ...(rl2full ? { rl2full: { accept: rl2full.accept, score: rl2full.score } } : {}),
    readers, cc: { accept: cc.accept, score: cc.score, nFailed: cc.failed.length }, tri,
    nonEmpty: rl2.effects.length > 0, effects: rl2.effects.length, unexplained: rl2.effects.filter(e => !e.explained).length,
  };
}

async function main() {
  const { values: a } = parseArgs({ options: { vlab: { type: 'string' }, rl2: { type: 'string' }, 'cc-facts': { type: 'string' }, work: { type: 'string' }, out: { type: 'string' } } });
  for (const k of ['vlab', 'rl2', 'cc-facts', 'work', 'out']) if (!a[k]) { console.error(`missing --${k}`); process.exit(2); }
  const vlab = path.resolve(a.vlab), work = path.resolve(a.work);
  const lab = await import(pathToFileURL(path.join(vlab, 'load.mjs')).href);
  const allRows = loadLab(vlab);
  const canonical = new Map([...canonicalRowsOf(allRows, lab.ARM_ORDER)].map(([t, cr]) => [t, { view: viewOf(cr), world0: worldsOf(vlab, cr).initial }]));
  const ledgers = rl2Ledgers(readJsonl(path.join(a.rl2, 'extract.jsonl')), canonical);
  const facts = JSON.parse(readFileSync(a['cc-facts'], 'utf8'));
  const factsOf = view => { const f = facts[factsKey(view.prompt.user, view.services)]; return f?.ok ? f.facts : null; };
  const manifest = JSON.parse(readFileSync(path.join(work, 'manifest.json'), 'utf8'));
  const byRow = new Map(allRows.map(r => [r.rowId, r]));
  const lines = [];
  // stored rows of the reported arms (the real distribution the lab must predict)
  const judgedByRow = new Map(readJsonl(path.join(a.rl2, 'judge-all.jsonl')).filter(j => j.ok).map(j => [j.rowId, j.verdicts]));
  for (const r of allRows.filter(x => REPORTED_ARMS.includes(x.arm))) {
    const w = worldsOf(vlab, r), view = viewOf(r);
    lines.push({ id: `row:${r.rowId}`, kind: 'stored', ...verifyCandidate({ ledger: ledgers.get(r.task), view, world0: w.initial, final: w.final, diff: r.diff, hf: factsOf(view), verdicts: judgedByRow.get(r.rowId) ?? null, stored: true }) });
  }
  // replayed jobs
  const done = new Set();
  for (const f of ['out0.jsonl', 'out1.jsonl', 'out.jsonl']) for (const o of readJsonl(path.join(work, f))) {
    if (done.has(o.id)) continue;
    done.add(o.id);
    const m = manifest.jobs[o.id];
    if (!m || !o.finalSha) { lines.push({ id: o.id, kind: m?.kind ?? 'unknown', replayError: true }); continue; }
    const seed = byRow.get(m.seedRow), view = viewOf(seed);
    const wd = path.join(work, 'worlds');
    const world0 = readGz(path.join(wd, `${o.id}.world0.json.gz`)), final = readGz(path.join(wd, `${o.id}.final.json.gz`)), diff = readGz(path.join(wd, `${o.id}.diff.json.gz`));
    lines.push({ id: o.id, kind: m.kind, ...verifyCandidate({ ledger: ledgers.get(m.task), view, world0, final, diff, hf: factsOf(view) }) });
  }
  writeFileSync(a.out, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  console.log(JSON.stringify({ version: VERIFY_VERSION, stored: lines.filter(l => l.kind === 'stored').length, jobs: done.size, replayErrors: lines.filter(l => l.replayError).length }));
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
