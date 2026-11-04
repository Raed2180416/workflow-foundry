#!/usr/bin/env node
// MEM-0c: what one peer read costs under transcript sharing vs typed board views, measured at $0 on the gameqa bed (dev split
// only; research/memory-20261021/MEMORY-MODEL.md §6.3). For each task, each planted bug stands for one explorer that found it.
// Its MINIMAL transcript is the driver replies (beds/gameqa/driver.mjs prints exactly these JSON lines) to the planner-minimal
// reproduction from a fresh start, plus its action lines; a real explorer reads far more (search, dead ends, retries), so the
// transcript figures are LOWER BOUNDS and the ratio is a lower bound on the saving. Its board contribution is the typed finding
// {bug_class, repro_actions, description} that the oracle grades. A peer that wants to know what the others found reads either
// every other transcript (a shared message pool) or the setUnion view of the other findings (a board topic).
// The reference repros come from the bed's referenceSolve (host-side truth, never shown to a model; this script calls no model).
//   node experiments/memory/context-bytes.mjs [--seeds 30] [--out result.json]
import { writeFileSync } from 'node:fs';
import { canonical } from '../../src/data.mjs';
import { estimateTokens } from '../../src/context.mjs';
import { createEnv, generate, referenceSolve } from '../../beds/gameqa/index.mjs';

export const HAIKU_INPUT_USD_PER_MTOK = 0.1;   // policy/models.json claude-haiku-5-5 price.inputPerMTok (prompts up to 100K tokens)
const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
const stats = xs => ({ n: xs.length, mean: xs.reduce((a, b) => a + b, 0) / xs.length, p10: quantile(xs, 0.1), median: quantile(xs, 0.5), p90: quantile(xs, 0.9) });

/** Tokens of the driver transcript of one reproduction from a fresh start (commands and replies, as the CLI agent sees them). */
export function transcriptTokens(task, actions) {
  const env = createEnv(task), lines = [JSON.stringify({ op: 'create' }), JSON.stringify(env.reset())];
  for (const action of actions) { lines.push(JSON.stringify({ op: 'step', action })); lines.push(JSON.stringify(env.step(action))); }
  return estimateTokens(lines.join('\n'));
}

export function measure({ seeds = 30, difficulties = [3, 4, 5] } = {}) {
  const rows = [];
  for (const difficulty of difficulties) for (let seed = 1; seed <= seeds; seed++) {
    const task = generate({ seed, split: 'dev', difficulty });
    const findings = referenceSolve(task).bugs;
    const transcripts = findings.map(f => transcriptTokens(task, f.repro_actions));
    const K = findings.length;
    // One read per explorer of everything the OTHER explorers produced.
    const poolPerRead = transcripts.map((_, i) => transcripts.reduce((s, t, j) => s + (j === i ? 0 : t), 0));
    const boardPerRead = findings.map((_, i) => estimateTokens(canonical(findings.filter((__, j) => j !== i).map(f => canonical(f)).sort())));
    const evidenceTokens = estimateTokens(canonical({ reports: task.inputs.reports, qa_sessions: task.inputs.qa_sessions ?? [], community_wiki: task.inputs.community_wiki ?? null }));
    rows.push({ id: task.id, difficulty, K, transcriptTokens: transcripts, poolPerRead: poolPerRead.reduce((a, b) => a + b, 0) / K, boardPerRead: boardPerRead.reduce((a, b) => a + b, 0) / K, evidenceTokens });
  }
  const byDifficulty = Object.fromEntries(difficulties.map(d => {
    const r = rows.filter(x => x.difficulty === d);
    const pool = stats(r.map(x => x.poolPerRead)), board = stats(r.map(x => x.boardPerRead));
    return [`d${d}`, { tasks: r.length, explorersK: r[0].K, poolTokensPerRead: pool, boardTokensPerRead: board,
      ratioOfMeans: pool.mean / board.mean, ratioPerTask: stats(r.map(x => x.poolPerRead / x.boardPerRead)),
      untrustedEvidenceTokens: stats(r.map(x => x.evidenceTokens)),
      usdPer1000Reads: { pool: pool.mean * 1000 * HAIKU_INPUT_USD_PER_MTOK / 1e6, board: board.mean * 1000 * HAIKU_INPUT_USD_PER_MTOK / 1e6 } }];
  }));
  return { measurement: 'mem-0c/1', bed: 'gameqa (dev split)', seeds, cost: { usd: 0, modelCalls: 0 }, lowerBound: 'transcripts are planner-minimal reproductions; real exploration is longer', byDifficulty };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
  const result = measure({ seeds: Number(args.seeds ?? 30) });
  for (const [d, v] of Object.entries(result.byDifficulty)) console.log(`${d} K=${v.explorersK} pool/read mean ${v.poolTokensPerRead.mean.toFixed(0)} tok, board/read mean ${v.boardTokensPerRead.mean.toFixed(0)} tok, ratio ${v.ratioOfMeans.toFixed(1)}x (per-task median ${v.ratioPerTask.median.toFixed(1)}x), evidence ${v.untrustedEvidenceTokens.mean.toFixed(0)} tok`);
  if (args.out) writeFileSync(args.out, JSON.stringify(result, null, 2) + '\n');
}
