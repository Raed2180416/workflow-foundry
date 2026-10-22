// Per failing case of an agent arm: the oracle's first divergence, the arm errors on the case's instances up to it, and
// the agent's own carry note at the last call before it. $0; reads the live host journal.
//   node <this> <label> [...]
import { readFileSync } from 'node:fs';
import path from 'node:path';
const ROOT = process.cwd(); const imp = p => import(path.join(ROOT, p));
const e8 = await imp('beds/ebed/e8/index.mjs');
const { baseWorld, overlayWorld, overlayOracle } = await imp('experiments/constitution/overlay.mjs');
const { buildRegistry } = await imp('experiments/constitution/registry.mjs');
const { CONTROL_TYPES } = await imp('beds/ebed/host/journal.mjs');
const { SIZED, LIVE_ROOT } = await imp('experiments/constitution/run-agents.mjs');
const registry = buildRegistry();
const W = overlayWorld(baseWorld(SIZED), { registry });
const { pools } = await e8.referenceRuns(W);
for (const label of process.argv.slice(2)) {
  const full = readFileSync(path.join(LIVE_ROOT, label, 'journal.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const rows = full.filter(r => !CONTROL_TYPES.has(r.type)).map(({ seq, prev, hash, ...c }) => c);
  const v = overlayOracle(W, rows, { pools });
  const bind = new Map(rows.filter(r => r.type === 'instance.open').map(r => [r.instance, r.binding]));
  const toMs = s => Date.parse(s);
  console.log(`\n## ${label}`);
  const tally = {};
  for (const c of v.cases.filter(x => x.pool === 'completed' && !x.pass)) {
    const fd = c.firstDivergence, at = fd ? Date.parse(fd.at) : Infinity;
    const insts = new Set([...bind].filter(([, b]) => b === c.case).map(([i]) => i));
    const calls = rows.filter(r => r.type === 'call' && insts.has(r.target) && toMs(r.at) <= at + 60_000);
    // Host refusals (invalid-output) come as arm.error rows after a call whose outcome is ok; crashes as a failed call.
    const errs = [];
    full.forEach((r, i) => { if (r.type === 'arm.error' && insts.has(r.instance)) { const call = full.slice(0, i).reverse().find(x => x.type === 'call' && x.target === r.instance); if (call && toMs(call.at) <= at + 60_000) errs.push({ at: call.at, error: { code: r.code, detail: r.detail } }); } });
    const last = [...calls].reverse().find(r => r.outcome === 'ok');
    const note = last?.output?.carry?.note ?? last?.output?.decisions?.note ?? null;
    const errText = errs.map(e => `${e.at.slice(5, 16)} ${e.error.code}${e.error.detail ? ': ' + (Array.isArray(e.error.detail) ? e.error.detail.join('; ') : e.error.detail).slice(0, 90) : ''}`);
    const cls = errs.some(e => /batch op keys its items/.test(JSON.stringify(e.error))) ? 'batch-key refusal' : errs.some(e => e.error.code === 'crash') ? 'malformed output' : errs.length ? `arm error ${errs[0].error.code}` : 'decision (no arm error)';
    tally[cls] = (tally[cls] ?? 0) + 1;
    console.log(`- ${c.case} (${W.truth.cases[c.case].class}): first divergence L${fd?.layer}:${fd?.code} ${fd?.lid ?? fd?.kind ?? ''} ${fd?.rule ?? ''} at ${fd?.at}; class: ${cls}`);
    if (errText.length) console.log(`    arm errors before it: ${errText.join(' | ')}`);
    if (!errs.length && note) console.log(`    agent's note at its last tick before: ${String(note).slice(0, 300)}`);
  }
  console.log('  tally:', JSON.stringify(tally));
}
