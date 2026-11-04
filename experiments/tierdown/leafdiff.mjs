#!/usr/bin/env node
// Root-cause helper ($0): for each injected unit whose outcome moved (a flip either way, a deopt or a crash), the decision
// leaves where the cheaper tier's answer differs from the archived reference answer (evidence keys stripped; tolerant
// numbers as in tier-replay.mjs). The reference is the value the solver was served in the $0 strict replay of the
// archived row (leverage.mjs decisionsOf), i.e. what tier-replay.mjs scored agreement against: an escalated judge shows
// its final answer and a k-sample judge its vote, never a first draft or another arm's answer to the same request.
//
//   node experiments/tierdown/leafdiff.mjs --inject inject-H.json --answers a.jsonl[,b.jsonl] [--runs DIR] [--max 12]
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listArms, readJsonl, rowId, DEFAULT_RUNS, DEFAULT_EXPERIMENTS } from './archive.mjs';
import { replayRow } from './replay.mjs';
import { decisionsOf } from './leverage.mjs';
import { decisionPoints } from './perturb.mjs';
import { canonical } from './override.mjs';
import { TOL } from './tier-replay.mjs';
import { stripEvidence } from '../jit/tierdown.mjs';

// Lists are compared as multisets: every array is sorted by the canonical form of its evidence-stripped items first,
// so a reordered but identical list shows no difference. Caveat: one changed item can sort to another position and
// misalign the items after it, so differences listed after the first changed item of a list may be alignment artefacts;
// decisionAgreement (the scored measure) matches items by content instead. Read a list's first difference, not its tail.
export const normalize = v => (Array.isArray(v) ? v.map(normalize).sort((a, b) => { const x = canonical(stripEvidence(a)), y = canonical(stripEvidence(b)); return x < y ? -1 : x > y ? 1 : 0; })
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x)])) : v);
const leafMap = v => new Map(decisionPoints(v ?? {}).filter(p => p.kind !== 'list' && (p.value === null || typeof p.value !== 'object')).map(p => [p.path.join('/'), p.value]));
const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= Math.max(TOL.absTol ?? 1e-9, (TOL.relTol ?? 0.01) * Math.max(Math.abs(a), Math.abs(b))) : canonical(a) === canonical(b));

// Leaves (path -> [reference, tier]) that differ; a list whose length differs is reported once at its own path.
export function leafDiff(ref0, cand0) {
  const ref = normalize(ref0), cand = normalize(cand0), out = [], R = leafMap(ref), C = leafMap(cand);
  for (const p of decisionPoints(ref ?? {}).filter(p => p.kind === 'list')) {
    const c = p.path.reduce((x, k) => (x == null ? x : x[k]), cand);
    if (!Array.isArray(c) || c.length !== p.value.length) out.push({ path: p.path.join('/') + '[]', ref: p.value.length, tier: Array.isArray(c) ? c.length : null });
  }
  for (const [k, v] of R) if (!C.has(k) ? true : !same(v, C.get(k))) out.push({ path: k, ref: v, tier: C.has(k) ? C.get(k) : '(absent)' });
  for (const [k, v] of C) if (!R.has(k)) out.push({ path: k, ref: '(absent)', tier: v });
  return out;
}

async function main() {
  const args = process.argv.slice(2), opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const inj = JSON.parse(readFileSync(opt('--inject'), 'utf8')), answers = opt('--answers').split(',').flatMap(f => readJsonl(f)), max = Number(opt('--max', 12));
  const arms = listArms({ runs: opt('--runs', DEFAULT_RUNS), experiments: DEFAULT_EXPERIMENTS }), bases = new Map();
  const work = mkdtempSync(path.join(os.tmpdir(), 'tierdown-diff-'));
  try {
    for (const r of inj.rows.filter(r => r.status === 'measured' && r.assignment.includes('@') && (r.outcome === 'flip' || r.outcome === 'deopt' || r.outcome === 'crash'))) {
      const at = r.assignment.lastIndexOf('@'), site = r.assignment.slice(0, at), tier = r.assignment.slice(at + 1);
      const arm = arms.find(a => r.row.startsWith(`${a.experiment}/${a.slug}#`)), row = arm.rows.find(x => rowId(arm, x) === r.row);
      if (!bases.has(r.row)) bases.set(r.row, await replayRow({ arm, row, flowPath: arm.flows.hooked, work }));
      const served = new Map(decisionsOf(bases.get(r.row), arm.family).map(d => [d.key, d.value]));
      console.log(`\n${r.assignment} ${r.row} (${r.taskKey}): ${r.outcome}${r.direction ? ` ${r.direction}` : ''}${r.deopt ? ` deopt=${r.deopt}` : ''} fellBack=${JSON.stringify(r.fellBack)}`);
      for (const a of answers.filter(a => a.row === r.row && a.site === site && a.tier === tier && a.ok)) {
        const d = leafDiff(served.get(a.key), a.value);
        console.log(`  ${a.name} ${a.key.slice(0, 12)} agreement ${a.agreement?.toFixed(3)}: ${d.length} leaf differences`);
        for (const x of d.slice(0, max)) console.log(`    ${x.path}: ref ${JSON.stringify(x.ref)?.slice(0, 80)} | tier ${JSON.stringify(x.tier)?.slice(0, 80)}`);
      }
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.stack ?? e); process.exit(1); });
