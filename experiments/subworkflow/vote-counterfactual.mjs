#!/usr/bin/env node
// $0 counterfactual (post hoc, development evidence on the evaluation's own data; a design lesson, not a result): had
// every sub-workflow ended its judge step with a code step that gives each order the majority label of all rows with
// the identical note text in that node (a free consistency vote: the bed's notes repeat verbatim, and judge slips are
// isolated), which failing backlog nodes would have passed? Each node's answer is re-labelled from the journal's judge
// rows (an import whose majority label differs gets it; one that becomes cancelled leaves the import), totals are
// recomputed, and the node is re-scored by the bed's oracle. A node whose fix would need an order added back (judged
// cancelled, majority not) is counted as not repaired.
//   node experiments/subworkflow/vote-counterfactual.mjs --results <results.jsonl> --journal <journal.sqlite>
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as bed from '../../beds/golive/index.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const db = new DatabaseSync(args.journal, { readOnly: true });
const last = new Map();
for (const l of readFileSync(args.results, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (r.status === 'complete' || !last.has(r.unit)) last.set(r.unit, r); }
const q = db.prepare("SELECT request, response FROM model_calls WHERE ok = 1 AND run_id = ? AND node_key LIKE ?");
const REF = /\b[A-Z]{2}-\d{5}\b/;
const out = { nodes: 0, failing: 0, repaired: [], notRepaired: [], broken: [] };
for (const r of last.values()) {
  if (r.status !== 'complete') continue;
  const t = bed.generate({ seed: r.seed, split: r.split, difficulty: r.difficulty });
  for (const n of r.nodes) {
    if (n.kind !== 'backlog' || n.path !== 'subworkflow' || !n.answer) continue;
    out.nodes++;
    const judged = [];
    for (const c of q.all(r.runId, `${n.channel}.root/call:%`)) {
      const req = JSON.parse(c.request), items = JSON.parse(c.response)?.value?.items;
      if (!Array.isArray(items)) continue;
      const shown = new Map(String(req.prompt).split('\n').filter(l => l.startsWith('{"i":')).map(l => { const o = JSON.parse(l); return [o.i, o]; }));
      for (const it of items) { const o = shown.get(it.i); if (!o) continue; const text = JSON.stringify(o); const note = o.note ?? o.text ?? Object.values(o).find(v => typeof v === 'string' && v.length > 12 && !REF.test(v)); judged.push({ ref: REF.exec(text)?.[0], note, label: it.label }); }
    }
    // A node may have run more than one spec (repairs): keep the last judgment per ref.
    const byRef = new Map(); for (const j of judged) if (j.ref) byRef.set(j.ref, j);
    const tally = new Map(); for (const j of byRef.values()) { const m = tally.get(j.note) ?? new Map(); m.set(j.label, (m.get(j.label) ?? 0) + 1); tally.set(j.note, m); }
    const majority = note => { const m = tally.get(note); if (!m) return null; const s = [...m.entries()].sort((a, b) => b[1] - a[1]); return s.length > 1 && s[0][1] === s[1][1] ? null : s[0][0]; };
    const before = bed.nodeOracle(t, n.channel, n.answer).pass;
    if (!before) out.failing++;
    let needsAdd = false;
    const imp = [];
    for (const o of n.answer.import) { const j = byRef.get(o.ref), m = j ? majority(j.note) : null; if (m === 'cancelled') continue; imp.push(m && m !== o.status ? { ...o, status: m } : o); }
    for (const j of byRef.values()) { const m = majority(j.note); if (j.label === 'cancelled' && m && m !== 'cancelled' && !n.answer.import.some(o => o.ref === j.ref) && !n.answer.quarantine.includes(j.ref)) needsAdd = true; }
    const ans = { ...n.answer, import: imp, totals: { orders: imp.length, usd_cents: imp.reduce((s, o) => s + o.usd_cents, 0) } };
    const after = bed.nodeOracle(t, n.channel, ans).pass;
    const rec = { unit: r.unit, channel: n.channel, judgedRows: byRef.size, distinctNotes: tally.size, needsAdd };
    if (!before && after) out.repaired.push(rec); else if (!before) out.notRepaired.push(rec); else if (before && !after) out.broken.push(rec);
  }
}
console.log(JSON.stringify({ ...out, summary: `sub-workflow backlog nodes ${out.nodes}; failing ${out.failing}; a majority vote per identical note repairs ${out.repaired.length}, leaves ${out.notRepaired.length}, breaks ${out.broken.length}` }, null, 1));
