#!/usr/bin/env node
// Adjudication of every unmet (build, condition) (PREREG-TRACKER §5), BUILDER-1. Unmet statuses are grouped by what decides them: the
// case, the check (canonical JSON) and the failing items with their reasons; one analyst label per group covers every build and
// sample it appears in. Labels: "true" (the build does not do what the person's words say), "oracle-gap" (true per the words, not what
// the hidden-world oracle checks), "false" with a cause (binding, evaluator, scenario, vacuous, over-literal, unstated-qualifier ...).
//
//   node experiments/tracker-v2/adjudicate.mjs groups [--dir D]     write/refresh adjudication.json (keeps labels already written)
//   node experiments/tracker-v2/adjudicate.mjs score  [--dir D]     condition-level alarm precision per judge file (and unlabelled count)
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { canonical } from '../../src/data.mjs';
import { renderCheck } from '../../app/core/tracker/checks.mjs';
// Works on BUILDER-1 (research/tracker-20261021/builder1) and on the held-out set (--dir research/tracker-20261021/heldout): views t2,
// t2NoG3 and, where the judge wrote it (v2/v3, D3), t2Solo (one build in hand).

const { values: a, positionals } = parseArgs({ allowPositionals: true, options: { dir: { type: 'string' } } });
const dir = path.resolve(a.dir ?? 'research/tracker-20261021/builder1');
const FILE = path.join(dir, 'adjudication.json');
const readJson = f => JSON.parse(readFileSync(f, 'utf8'));
const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 12);
const normWhy = w => String(w ?? '').replace(/\b(base|targeted|repeat(-\d)?):e\d+\b/g, 'e').replace(/repeat:/g, '').replace(/\s+/g, ' ').trim();

function unmetEntries() {
  const out = [];
  for (const f of readdirSync(dir).filter(f => /^judge-.*\.json$/.test(f)).sort()) {
    const j = readJson(path.join(dir, f));
    const bind = readJson(path.join(dir, j.bind));
    for (const [buildId, b] of Object.entries(j.builds)) for (const view of ['t2', 't2NoG3', 't2Solo'].filter(v => b[v])) for (const [cid, s] of Object.entries(b[view])) {
      if (s.status !== 'unmet') continue;
      const cond = (bind.cases[b.case] ?? []).find(c => c.id === cid);
      const why = (s.evidence ?? []).map(e => `${e.item ?? ''} ${normWhy(e.why)}`).sort().join(' | ');
      const key = `${b.case}:${sha(`${canonical(cond?.check ?? null)}\u0000${why}`)}`;
      out.push({ file: f, view, build: buildId, verified: b.verified, case: b.case, cid, key, quote: cond?.quote ?? '', check: cond?.check ? renderCheck(cond.check) : null, why });
    }
  }
  return out;
}

const step = positionals[0];
const entries = unmetEntries();
if (step === 'groups') {
  const old = existsSync(FILE) ? readJson(FILE).groups ?? {} : {};
  // The analyst's labels live in adjudication-labels.json (key -> [label, cause, note, byBuild?]); they win over labels kept in the old
  // file. byBuild ({ buildId: [label, cause, note] }) overrides the group label for one build, where the same evidence means different
  // things on different builds (held-out HS2: the overlap ticket is a question on a build that implements both rules, R-overlap, and a
  // real omission on a build that never answers shipping questions).
  const LABELS = path.join(dir, 'adjudication-labels.json');
  const given = existsSync(LABELS) ? readJson(LABELS).labels : {};
  for (const [k, [label, cause, note, byBuild]] of Object.entries(given)) old[k] = { label, cause, note, ...(byBuild ? { byBuild: Object.fromEntries(Object.entries(byBuild).map(([b, [l, c, n]]) => [b, { label: l, cause: c, note: n }])) } : {}) };
  const groups = {};
  for (const e of entries) {
    const g = groups[e.key] ??= { case: e.case, quote: e.quote, check: e.check, evidence: e.why.slice(0, 400), builds: [], files: [], label: old[e.key]?.label ?? null, cause: old[e.key]?.cause ?? null, note: old[e.key]?.note ?? null, ...(old[e.key]?.byBuild ? { byBuild: old[e.key].byBuild } : {}) };
    if (!g.builds.includes(e.build)) g.builds.push(e.build);
    if (!g.files.includes(e.file)) g.files.push(e.file);
  }
  for (const g of Object.values(groups)) { g.builds.sort(); g.verifiedShare = null; }
  writeFileSync(FILE, `${JSON.stringify({ note: 'One label per group (case, check, failing items and reasons). label: true | oracle-gap | false; cause when false.', groups }, null, 1)}\n`);
  console.log(`${Object.keys(groups).length} groups from ${entries.length} unmet (file, view, build, condition) entries; unlabelled: ${Object.values(groups).filter(g => !g.label).length}`);
} else if (step === 'score') {
  const groups = existsSync(FILE) ? readJson(FILE).groups : {};
  const by = new Map();
  for (const e of entries) {
    const k = `${e.file} ${e.view}`;
    if (!by.has(k)) by.set(k, { n: 0, true: 0, gap: 0, false: 0, unlabelled: 0, causes: {} });
    const s = by.get(k), g = groups[e.key]?.byBuild?.[e.build] ?? groups[e.key];
    s.n++;
    if (!g?.label) s.unlabelled++;
    else if (g.label === 'true') s.true++;
    else if (g.label === 'oracle-gap') s.gap++;
    else { s.false++; s.causes[g.cause] = (s.causes[g.cause] ?? 0) + 1; }
  }
  for (const [k, s] of [...by].sort()) console.log(`${k.padEnd(70)} unmet ${String(s.n).padStart(3)}  true ${String(s.true).padStart(3)}  gap ${String(s.gap).padStart(2)}  false ${String(s.false).padStart(3)}  precision ${s.n - s.unlabelled ? ((s.true + s.gap) / (s.n - s.unlabelled)).toFixed(3) : '-'}${s.unlabelled ? `  UNLABELLED ${s.unlabelled}` : ''}  ${JSON.stringify(s.causes)}`);
} else throw new Error('usage: adjudicate.mjs groups|score [--dir D]');
