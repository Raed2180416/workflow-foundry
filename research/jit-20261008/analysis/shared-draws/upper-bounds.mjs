// Row 23 (B10-E1): replaceable interpreter-role spend, from the committed dev totals only (DEV-NOTES D10, D12; FG §0.1;
// dossier 9 §B10.1 for H/H and kinetics S/H, whose raw rows are lost). $0, no model calls.
//   node research/jit-20261008/analysis/shared-draws/upper-bounds.mjs
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const r2 = x => Math.round(x * 100) / 100, pct = x => Math.round(1000 * x) / 10;

// Records dev stream, seeds 201-224 (K = 1). Interpreter-role components = every interpret() call a JIT arm made
// (warmup + deopt fallbacks 'interpreter', 'shadow', 'adjudicator'); the rest is compiles and compiled runs.
const arms = {
  'records O/H': { total: 7.53, roles: { interpreter: 2.31, shadow: 2.20, adjudicator: 0.64 }, sameModelAgent: 'Opus agent', agentPerTask: 13.54 / 24,
    draws: { interpreter: 5, adjudicator: 1, shadow: null }, src: 'DEV-NOTES D12 cost line' },
  'records S/H': { total: 8.99, roles: { interpreter: 1.46, shadowAndAdjudicator: 1.81 }, sameModelAgent: 'Sonnet agent', agentPerTask: 7.05 / 24,
    draws: { interpreter: 5, shadow: 4, adjudicator: 2 }, src: 'DEV-NOTES D10 cost line and delivery line' },
  // Dossier 9 recomputed these from results.jsonl later than FG §0.1's 04:22 snapshot (H/H then $3.24 for 19 tasks; kinetics
  // S/H $15.59 for 8), so its denominators are larger; only its stated share and the implied total are usable now.
  'records H/H (dossier snapshot)': { total: 0.81 / 0.14, roles: { all: 0.81 }, sameModelAgent: 'Haiku agent', agentPerTask: 2.46 / 24, draws: null, src: 'dossier 9 §B10.1: $0.81 = 14% (total implied; raw rows lost)' },
  'kinetics S/H (dossier snapshot)': { total: 1.88 / 0.10, roles: { all: 1.88 }, sameModelAgent: 'Sonnet agent', agentPerTask: 7.40 / 24, draws: null, src: 'dossier 9 §B10.1: $1.88 = 10% (total implied; raw rows lost)' },
  'kinetics O/H (17 of 24 tasks)': { total: 17.82, roles: { all: 0 }, sameModelAgent: null, agentPerTask: null, draws: null, src: 'no Opus agent arm in kinetics' },
};
const rows = Object.entries(arms).map(([arm, a]) => {
  const shareable = Object.values(a.roles).reduce((s, x) => s + x, 0);
  const nDraws = a.draws && Object.values(a.draws).every(x => x != null) ? Object.values(a.draws).reduce((s, x) => s + x, 0) : null;
  return { arm, totalUsd: r2(a.total), shareableUsd: r2(shareable), share: pct(shareable / a.total), sameModelAgent: a.sameModelAgent,
    roleDraws: nDraws, usdPerRoleDraw: nDraws ? r2(shareable / nDraws) : null, agentUsdPerTask: a.agentPerTask ? r2(a.agentPerTask) : null, src: a.src };
});
// The whole records dev stream (every arm; H/H at the dossier's implied total): what share of its spend the JIT roles were.
const recordsTotal = 13.54 + 8.99 + 7.53 + 7.05 + 2.46 + 1.21 + 0.81 / 0.14;
const recordsShareable = rows.filter(r => r.arm.startsWith('records')).reduce((s, r) => s + r.shareableUsd, 0);
// Which arms would have a same-model agent arm to share with, per design on the table.
const designs = {
  'PREREG-stream §2 (draft)': { agents: ['haiku', 'sonnet', 'opus'], jit: ['H/H', 'S/H', 'O/H'] },
  'HANDOFF §5.2 held-out list': { agents: ['opus', 'haiku'], jit: ['S/H', 'O/H', 'H/H'] },
  'BLOCKER-SYNTHESIS row 8 (R0)': { agents: ['haiku'], jit: ['S/H', 'O/H', 'H/H'] },
};
const interp = { 'H/H': 'haiku', 'S/H': 'sonnet', 'O/H': 'opus' };
const coverage = Object.fromEntries(Object.entries(designs).map(([d, x]) => [d, Object.fromEntries(x.jit.map(j => [j, x.agents.includes(interp[j]) ? 'pool exists' : 'no same-model agent arm: nothing to share']))]));
const out = { about: 'Upper bounds on JIT interpreter-role spend that same-model agent draws could replace. They assume request equivalence (equivalence-check.json) and that enough replicate agent draws exist per (task, model).',
  rows, recordsStream: { totalUsd: r2(recordsTotal), shareableUsd: r2(recordsShareable), share: pct(recordsShareable / recordsTotal) }, coverage };
writeFileSync(path.join(HERE, 'upper-bounds.json'), JSON.stringify(out, null, 1) + '\n');
for (const r of rows) console.log(`${r.arm.padEnd(30)} $${r.shareableUsd} of $${r.totalUsd} = ${r.share}%  (${r.sameModelAgent ?? 'no agent arm'})${r.usdPerRoleDraw ? `  $${r.usdPerRoleDraw}/role draw vs agent $${r.agentUsdPerTask}/task` : ''}`);
console.log(`records stream: $${out.recordsStream.shareableUsd} of $${out.recordsStream.totalUsd} = ${out.recordsStream.share}%`);
console.log(JSON.stringify(coverage, null, 1));
