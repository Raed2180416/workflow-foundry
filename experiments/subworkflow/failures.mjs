#!/usr/bin/env node
// SW-1 failure anatomy (post hoc, analysis side; not part of the frozen pipeline): for every failing node in a results
// file, each wrong, missing or extra order with the truth, the answer, the row's kind (trap note, re-sent, O typo, blank
// currency, bad date, injected) and the note text; then a tally of root-cause classes per arm.
//   node experiments/subworkflow/failures.mjs --results <results.jsonl> [--arm A2] [--json out.json] [--quiet]
import { readFileSync, writeFileSync } from 'node:fs';
import * as bed from '../../beds/golive/index.mjs';
import { buildWorld, truthOf, keywordLabel } from '../../beds/golive/world.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]] : a), []));
const last = new Map();
for (const l of readFileSync(args.results, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (r.status === 'complete' || !last.has(r.unit)) last.set(r.unit, r); }
const out = [], tally = {};
const bump = (arm, k) => { tally[arm] ??= {}; tally[arm][k] = (tally[arm][k] ?? 0) + 1; };
for (const r of last.values()) {
  if (r.status !== 'complete' || (args.arm && r.arm !== args.arm)) continue;
  const task = { seed: r.seed, split: r.split, difficulty: r.difficulty }, w = buildWorld(r.seed, r.split, r.difficulty), t = bed.generate(task);
  for (const n of r.nodes) {
    const o = n.answer ? bed.nodeOracle(t, n.channel, n.answer) : null;
    if (o?.pass) continue;
    const ch = w.channels.find(c => c.name === n.channel), truth = truthOf(w, ch);
    const newest = new Map(); for (const v of ch.versions) { const p = newest.get(v.ref); if (!p || (v.updatedMin ?? 0) > (p.updatedMin ?? 0)) newest.set(v.ref, v); }
    const resent = new Set(ch.versions.filter(v => v.version === 0).map(v => v.ref));
    const kindOf = v => [v.trap && 'trap-note', resent.has(v.ref) && 're-sent', v.oTypo && 'O-typo', v.blankCurrency && 'blank-currency', v.badDate && 'bad-date', v.injected && 'injected',
      ch.kind === 'simple' && 'simple'].filter(Boolean);
    const tImp = new Map(truth.import.map(x => [x.ref, x])), aImp = new Map((n.answer?.import ?? []).map(x => [x.ref, x]));
    const rows = [];
    for (const ref of new Set([...tImp.keys(), ...aImp.keys(), ...truth.quarantine, ...(n.answer?.quarantine ?? [])])) {
      const want = tImp.get(ref), got = aImp.get(ref), v = newest.get(ref);
      const qW = truth.quarantine.includes(ref), qG = (n.answer?.quarantine ?? []).includes(ref);
      const diff = [];
      if (want && !got) diff.push(qG ? 'imported->quarantined' : 'missing');
      if (!want && got) diff.push(qW ? 'quarantined->imported' : `extra (truth: ${v ? (v.label === 'cancelled' ? 'cancelled' : v.placed > w.cutover ? 'after cutover' : '?') : 'unknown ref'})`);
      if (want && got) for (const k of ['placed', 'status', 'usd_cents']) if (want[k] !== got[k]) diff.push(`${k} ${JSON.stringify(got[k])} want ${JSON.stringify(want[k])}`);
      if (!want && !got && qW !== qG) diff.push(qW ? 'quarantine missing' : 'quarantine extra');
      if (!diff.length) continue;
      const cls = diff.some(d => d.startsWith('status')) ? `status:${v?.trap ? 'trap' : 'plain'}${keywordLabel(v?.note ?? '') === got?.status ? ':keyword-like' : ''}`
        : diff.some(d => d.startsWith('usd_cents')) ? `cents:${kindOf(v ?? {}).filter(k => ['O-typo', 'blank-currency', 're-sent'].includes(k)).join('+') || 'plain'}`
        : diff.some(d => d.startsWith('extra')) ? `extra:${v?.label === 'cancelled' ? 'cancelled' : 'other'}` : diff[0].replace(/ .*/, '');
      bump(r.arm, cls);
      rows.push({ ref, diff, cls, kinds: kindOf(v ?? {}), truthLabel: v?.label ?? null, note: v ? (v.noteText ?? v.note) : null });
    }
    const item = { unit: r.unit, arm: r.arm, channel: n.channel, kind: n.kind, path: n.path, error: n.error ?? null, totalsOk: o?.details?.totalsOk ?? null, rows };
    if (!n.answer) bump(r.arm, `no-answer:${n.error?.code ?? '?'}`);
    out.push(item);
  }
}
if (!args.quiet) for (const it of out) {
  console.log(`## ${it.unit} ${it.channel} (${it.kind}, ${it.path}${it.error ? `, ${it.error.code}` : ''}) totalsOk=${it.totalsOk}`);
  for (const x of it.rows.slice(0, 12)) console.log(`  ${x.ref} [${x.kinds.join(',')}] ${x.diff.join('; ')}  truth=${x.truthLabel}  note=${JSON.stringify(x.note)}`);
  if (it.rows.length > 12) console.log(`  ... ${it.rows.length - 12} more`);
}
console.log('\nroot-cause classes per arm:');
for (const [arm, t] of Object.entries(tally).sort()) console.log(`  ${arm}: ${Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${c}`).join(', ')}`);
if (args.json) writeFileSync(args.json, JSON.stringify({ failures: out, tally }, null, 1));
