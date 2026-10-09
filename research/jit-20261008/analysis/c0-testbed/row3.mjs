// Row 3 Stage 1: score the $0 date-order data check (datecheck.mjs) against generator labels, in sample (201-224) and out of
// sample (249-272), then apply it as a gate to the C0 solver's own date-order reads (its config, logged to solve.stderr).
// Usage: node row3.mjs [SCRATCH]   -> outputs/row3.json and a markdown summary on stdout.
import path from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { parseExport } from './lib-parse.mjs';
import { evidence, decide, SYSTEMS } from './datecheck.mjs';
import { loadC0Configs, applyOverride } from './c0config.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SCRATCH = process.argv[2] ?? '/var/tmp/foundry-work/c0-testbed';
const manifest = JSON.parse(readFileSync(path.join(SCRATCH, 'manifest.json'), 'utf8'));
const GATE_MARGIN = 2;

// Leaves per task. d3: one leaf per system. d4 ATLAS is two-regime (order swaps for rows changed on/after the cutoff), so it is
// scored two ways: 'ATLAS' as one leaf against the base (pre-cutoff) order, as a single config value would be, and as two
// segment leaves 'ATLAS<cut' / 'ATLAS>=cut', partitioned by the generator's own per-row regime (analyst side).
function leavesOf(task, labels, variant) {
  const rows = parseExport(task.inputs.export);
  const out = [];
  for (const sys of SYSTEMS) {
    const items = evidence(rows, sys, { variant });
    out.push({ leaf: sys, label: labels.dateOrder[sys], ...decide(items), twoRegime: sys === 'ATLAS' && labels.atlasCutoff !== null });
  }
  if (labels.atlasCutoff !== null) {
    const mf = new Map(labels.atlasRows.map(r => [r.row, r.monthFirst]));
    const base = labels.dateOrder.ATLAS;
    const swapped = base === 'MDY' ? 'DMY' : 'MDY';
    for (const [leaf, after] of [['ATLAS<cut', false], ['ATLAS>=cut', true]]) {
      const items = evidence(rows, 'ATLAS', { variant, rowFilter: r => (mf.get(r.row) === (after ? swapped === 'MDY' : base === 'MDY')) });
      out.push({ leaf, label: after ? swapped : base, ...decide(items), segment: true });
    }
  }
  return out;
}

function summarise(leaves) {
  const n = leaves.length, decided = leaves.filter(l => l.margin >= 1), strong = leaves.filter(l => l.margin >= GATE_MARGIN);
  return {
    leaves: n, decided: decided.length, agree: decided.filter(l => l.pred === l.label).length,
    strong: strong.length, strongAgree: strong.filter(l => l.pred === l.label).length,
    undecidedRate: n ? +(1 - decided.length / n).toFixed(3) : null, belowGateRate: n ? +(1 - strong.length / n).toFixed(3) : null,
    numericPerLeaf: n ? +(leaves.reduce((s, l) => s + l.numeric, 0) / n).toFixed(1) : null,
    margins: leaves.map(l => `${l.seed}:${l.leaf}=${l.label === 'DMY' ? `${l.dmy}:${l.mdy}` : `${l.mdy}:${l.dmy}`}`),   // correct:wrong
  };
}

// C0's date-order reads: its config call from the journal, with its own data override re-applied (c0config.mjs).
const C0CFG = existsSync(path.join(SCRATCH, 'journal.sqlite')) ? loadC0Configs(path.join(SCRATCH, 'journal.sqlite')) : new Map();
function c0Config(seed) {
  const c = C0CFG.get(seed);
  if (!c) return null;
  const task = JSON.parse(readFileSync(path.join(SCRATCH, 'tasks', `s${seed}.json`), 'utf8'));
  return applyOverride(c.systems, task.inputs.export);
}

const result = { gateMargin: GATE_MARGIN, variants: {} };
for (const variant of ['n3', 'plus']) {
  const all = [];
  for (const t of manifest.tasks) {
    const task = JSON.parse(readFileSync(path.join(SCRATCH, 'tasks', `s${t.seed}.json`), 'utf8'));
    const labels = JSON.parse(readFileSync(path.join(SCRATCH, 'labels', `s${t.seed}.json`), 'utf8'));
    for (const l of leavesOf(task, labels, variant)) all.push({ seed: t.seed, set: t.set, difficulty: t.difficulty, ...l });
  }
  const table = {};
  for (const set of ['in', 'out']) for (const d of [3, 4]) for (const leaf of ['BRIGHTDESK', 'ATLAS', 'VENDEX', 'ATLAS<cut', 'ATLAS>=cut']) {
    const ls = all.filter(l => l.set === set && l.difficulty === d && l.leaf === leaf);
    if (ls.length) table[`${set}/d${d}/${leaf}`] = summarise(ls);
  }
  // N3's scope: BRIGHTDESK + ATLAS, d3 (one leaf each) and d4 (single ATLAS leaf)
  for (const set of ['in', 'out']) for (const d of [3, 4]) {
    table[`${set}/d${d}/N3-scope(BD+ATLAS)`] = summarise(all.filter(l => l.set === set && l.difficulty === d && ['BRIGHTDESK', 'ATLAS'].includes(l.leaf)));
  }
  result.variants[variant] = { table, leaves: all };
}

// Known cheap-tier errors from DEV-NOTES/N3 (in sample): s204 ATLAS (Haiku), s207 BRIGHTDESK (Sonnet), s208 BRIGHTDESK (Haiku + Sonnet).
result.knownErrors = ['204:ATLAS', '207:BRIGHTDESK', '208:BRIGHTDESK'].map(k => {
  const [seed, leaf] = k.split(':');
  const l = result.variants.n3.leaves.find(x => x.seed === +seed && x.leaf === leaf);
  return { seed: +seed, leaf, label: l.label, correct: l.label === 'DMY' ? l.dmy : l.mdy, wrong: l.label === 'DMY' ? l.mdy : l.dmy, pred: l.pred };
});

// Gate on C0 (in sample, the seeds C0 ran on). A C0 leaf is wrong when its read differs from the label; for a two-regime d4
// ATLAS leaf a single read is always wrong on one regime ('lossy'). The gate flags a leaf when the check is below the margin or
// disagrees with C0's read.
const gate = [];
for (const t of manifest.tasks.filter(x => x.set === 'in')) {
  const cfg = c0Config(t.seed);
  if (!cfg) continue;
  const res = existsSync(path.join(HERE, 'outputs', 'c0-runs', 'results.jsonl'))
    ? readFileSync(path.join(HERE, 'outputs', 'c0-runs', 'results.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).find(r => r.seed === t.seed) : null;
  for (const sys of SYSTEMS) {
    const l = result.variants.n3.leaves.find(x => x.seed === t.seed && x.leaf === sys);
    const read = cfg.find(c => String(c.name).toUpperCase() === sys)?.numeric_date_order ?? null;
    const lossy = !!l.twoRegime;
    const wrong = lossy || read !== l.label;
    const flagged = l.margin < GATE_MARGIN || l.pred !== read;
    gate.push({ seed: t.seed, difficulty: t.difficulty, leaf: sys, c0Read: read, label: l.label, lossy, wrong, flagged, data: `${l.dmy}DMY:${l.mdy}MDY`, taskPass: res?.pass ?? null });
  }
}
const g = (f) => gate.filter(f).length;
result.gate = {
  leaves: gate.length,
  wrong: g(x => x.wrong), wrongFlagged: g(x => x.wrong && x.flagged),
  wrongNotLossy: g(x => x.wrong && !x.lossy), wrongNotLossyFlagged: g(x => x.wrong && !x.lossy && x.flagged),
  lossy: g(x => x.lossy), lossyFlagged: g(x => x.lossy && x.flagged),
  correct: g(x => !x.wrong), correctFlagged: g(x => !x.wrong && x.flagged),
  failedTasks: [...new Set(gate.filter(x => x.taskPass === false).map(x => x.seed))].length,
  failedTasksAnyFlag: [...new Set(gate.filter(x => x.taskPass === false && x.flagged).map(x => x.seed))].length,
  passedTasks: [...new Set(gate.filter(x => x.taskPass === true).map(x => x.seed))].length,
  passedTasksAnyFlag: [...new Set(gate.filter(x => x.taskPass === true && x.flagged).map(x => x.seed))].length,
  rows: gate,
};

mkdirSync(path.join(HERE, 'outputs'), { recursive: true });
writeFileSync(path.join(HERE, 'outputs', 'row3.json'), JSON.stringify(result, null, 1));

// Markdown summary
const md = [];
for (const variant of ['n3', 'plus']) {
  md.push(`\n### variant ${variant}\n`, '| set/difficulty/leaf | leaves | decided (m≥1) | agree | m≥2 | agree at m≥2 | undecided | below gate | numeric dates/leaf |', '|---|---|---|---|---|---|---|---|---|');
  for (const [k, s] of Object.entries(result.variants[variant].table)) md.push(`| ${k} | ${s.leaves} | ${s.decided} | ${s.agree} | ${s.strong} | ${s.strongAgree} | ${s.undecidedRate} | ${s.belowGateRate} | ${s.numericPerLeaf} |`);
}
md.push('\nknown errors (n3, correct:wrong):', JSON.stringify(result.knownErrors));
const { rows, ...gs } = result.gate;
md.push('\ngate on C0:', JSON.stringify(gs));
console.log(md.join('\n'));
