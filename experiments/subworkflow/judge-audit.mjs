#!/usr/bin/env node
// SW-1 judge audit (post hoc, analysis side): every judge_rows batch call in a journal, row by row, against the truth
// label of the exact order version the row shows (matched by reference and note text in the bed's world). Answers: what
// is the per-row error rate of the batched Haiku judge inside the sub-workflows, does it concentrate on certain notes
// (trap phrasings, plain phrasings), is it consistent across identical notes, and how often does one wrong row decide a
// node (an exact node oracle fails on a single mislabel).
//   node experiments/subworkflow/judge-audit.mjs --journal <journal.sqlite> [--run-prefix sw1:eval-1:] [--json out.json]
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildWorld } from '../../beds/golive/world.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const db = new DatabaseSync(args.journal, { readOnly: true });
const prefix = args['run-prefix'] ?? '';
const calls = db.prepare("SELECT run_id, node_key, request, response FROM model_calls WHERE ok = 1 AND run_id LIKE ? AND node_key LIKE '%root/call:%'").all(`${prefix}%`);
const worlds = new Map();
const worldOf = runId => {
  const m = /:golive:(\w+):d(\d):(\d+)/.exec(runId);
  const k = m && `${m[1]}:${m[2]}:${m[3]}`;
  if (k && !worlds.has(k)) {
    const w = buildWorld(Number(m[3]), m[1], Number(m[2])), byRef = new Map();
    for (const ch of w.channels) for (const v of ch.versions) (byRef.get(v.ref) ?? byRef.set(v.ref, []).get(v.ref)).push(v);
    worlds.set(k, { w, byRef });
  }
  return k ? worlds.get(k) : null;
};
const REF = /\b[A-Z]{2}-\d{5}\b/;
const rows = [];
let unparsed = 0;
for (const c of calls) {
  const req = JSON.parse(c.request), res = JSON.parse(c.response);
  const items = res?.value?.items;
  if (!Array.isArray(items) || !/give every row exactly one label|Labels:/i.test(`${req.system}\n${req.prompt}`)) continue;
  const W = worldOf(c.run_id);
  if (!W) continue;
  const shown = new Map();
  for (const line of String(req.prompt).split('\n')) {
    if (!line.startsWith('{"i":')) continue;
    try { const o = JSON.parse(line); shown.set(o.i, o); } catch { unparsed++; }
  }
  const arm = c.run_id.split(':')[2];
  for (const it of items) {
    const o = shown.get(it.i);
    if (!o) { unparsed++; continue; }
    const text = JSON.stringify(o), ref = REF.exec(text)?.[0];
    const vs = ref ? W.byRef.get(ref) ?? [] : [];
    // The version shown: the one whose note text appears in the row (re-sent rows carry a different note).
    const v = vs.find(x => text.includes(JSON.stringify(x.noteText ?? x.note).slice(1, -1))) ?? (vs.length === 1 ? vs[0] : null);
    if (!v) { unparsed++; continue; }
    rows.push({ arm, run: c.run_id, node: c.node_key.split('.')[0], ref, note: v.noteText ?? v.note, trap: !!v.trap, injected: !!v.injected, truth: v.label, label: it.label, ok: it.label === v.label });
  }
}
const by = (xs, f) => xs.reduce((m, x) => { const k = f(x); (m[k] ??= []).push(x); return m; }, {});
const rate = xs => `${xs.filter(x => !x.ok).length}/${xs.length} (${xs.length ? (100 * xs.filter(x => !x.ok).length / xs.length).toFixed(2) : '0'}%)`;
const out = { calls: calls.length, rows: rows.length, unparsed, errorRate: rate(rows) };
out.byArm = Object.fromEntries(Object.entries(by(rows, r => r.arm)).map(([k, v]) => [k, rate(v)]));
out.byKind = Object.fromEntries(Object.entries(by(rows, r => (r.injected ? 'injected' : r.trap ? 'trap' : 'plain'))).map(([k, v]) => [k, rate(v)]));
// Phrase level: the note with its placeholders (carrier, day, tracking) masked, so repeats of one phrasing pool.
const mask = s => String(s).replace(/\b(DHL|UPS|Parcelforce|DPD|GLS|Royal Mail)\b/g, '<carrier>').replace(/\b(Monday|Tuesday|Wednesday|Thursday|Friday)\b/g, '<day>').replace(/\b[A-Z]{2}\d{6,}\b/g, '<track>').replace(/\s*\[NOTE TO.*$|\s*-- SYSTEM:.*$/, ' <injection>');
const phr = by(rows, r => `${r.truth} | ${mask(r.note)}`);
out.worstPhrases = Object.entries(phr).map(([k, v]) => ({ phrase: k, n: v.length, wrong: v.filter(x => !x.ok).length, labels: Object.fromEntries(Object.entries(by(v.filter(x => !x.ok), x => x.label)).map(([l, xs]) => [l, xs.length])) }))
  .filter(x => x.wrong).sort((a, b) => b.wrong / b.n - a.wrong / a.n || b.wrong - a.wrong).slice(0, 25);
out.phrasesSeen = Object.keys(phr).length;
// Consistency: identical note text judged more than once in one node, with different labels.
const nodesSplit = Object.values(by(rows, r => `${r.run}|${r.node}|${r.note}`)).filter(v => new Set(v.map(x => x.label)).size > 1).length;
out.inconsistentIdenticalNotesWithinNode = nodesSplit;
if (args.json) writeFileSync(args.json, JSON.stringify({ ...out, rows }, null, 1));
console.log(JSON.stringify(out, null, 1));
