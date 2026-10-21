// ROUTER-1: assemble the labelled evaluation set, split it dev/test by a fixed hash rule, and freeze both with sha256.
// Runs before any router code exists (git history). Re-running it must reproduce the frozen hashes byte for byte
// (tests/need-router-set.test.mjs checks the committed SET.jsonl against FREEZE.json).
//
//   node experiments/need-router/router1/build-set.mjs            # write SET.jsonl + FREEZE.json
//   node experiments/need-router/router1/build-set.mjs --check    # rebuild in memory and compare with the frozen files
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { renderAnchors } from './render-anchors.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DIR = path.join(ROOT, 'research/need-router-20261014/router1');
const sha = s => createHash('sha256').update(s).digest('hex');
const json = f => JSON.parse(readFileSync(path.join(DIR, f), 'utf8'));
export const DEV_SHARE = 0.4;
export const SPLIT_SALT = 'router1-split-v1:';
const MAX_CHARS = 6000;

// Long documents are shown the way a router sees a task before execution (experiments/need-router/jev-need.mjs stateOf):
// the first 6,000 characters of the text and its size. The header is neutral (no label word).
function view(text) {
  const t = String(text);
  return `TASK PROMPT (first ${Math.min(MAX_CHARS, t.length)} of ${t.length} characters):\n${t.slice(0, MAX_CHARS)}\n\nSIZE: about ${Math.ceil(t.length / 4)} tokens of prompt, inputs and files in total; 0 attached files.`;
}
const gold = (mode, confidence, why = null) => {
  if (!['none', 'checklist', 'workflow', 'recurring'].includes(mode)) throw new Error(`bad mode ${mode}`);
  if (!['high', 'medium'].includes(confidence)) throw new Error(`bad confidence ${confidence}`);
  return { mode, needsWorkflow: mode === 'workflow' || mode === 'recurring', confidence, why };
};

export async function buildItems() {
  const items = [];
  for (const a of json('items-authored.json'))
    items.push({ id: `au-${a.id}`, source: 'authored', category: a.cat, text: a.text, gold: gold(a.mode, a.conf, a.why ?? null), jevEligible: true, cluster: `au-${a.id}`,
      provenance: { author: 'ROUTER-1 author (Claude Opus 5.5)', file: 'items-authored.json' } });
  for (const [file, pass] of [['mercury-raw.json', 1], ['mercury-raw-2.json', 2]]) {
    const raw = json(file), labels = json('items-mercury-labels.json');
    for (const c of raw.categories) c.requests.forEach((text, i) => {
      const key = `${c.id}-${i + 1}`, l = labels[key];
      if (!l) throw new Error(`no gold label for ${key}`);
      items.push({ id: `me-${key}`, source: 'mercury', category: c.id, text, gold: gold(l[0], l[1], l[2]), jevEligible: true, cluster: `me-${key}`,
        provenance: { author: `${raw.model} (independent author, pass ${pass})`, file, journalId: c.journalId } });
    });
  }
  const abText = json('items-ab-text.json'), abLabels = json('items-ab-labels.json');
  for (const t of abText) {
    const l = abLabels[t.task];
    if (!l) throw new Error(`no gold label for ${t.task}`);
    const simple = t.task.startsWith('simple.');
    items.push({ id: `ab-${t.task}`, source: simple ? 'ab-simple' : 'ab-devtrain', category: t.task.split('.')[0], text: t.user, gold: gold(l[0], l[1], l[2]),
      jevEligible: false, cluster: `ab-${t.task}`,
      provenance: { author: 'AutomationBench (Zapier, Inc., MIT)', corpusCommit: '4a8e1061254004d9dac807054eed33fad7d1ff14', task: t.task, contract_sha256: t.contract_sha256,
        split: simple ? 'outside SPLIT-v1 (unscored simple domain)' : 'SPLIT-v1 devTrain', services: t.services } });
  }
  for (const r of await renderAnchors())
    items.push({ id: `an-${r.family}-s${r.seed}`, source: 'anchor', category: r.family, text: r.text, gold: gold('none', 'high', r.why), jevEligible: true, cluster: `an-${r.family}`,
      provenance: { author: `beds/${r.family} generator (dev seed ${r.seed}, difficulty 3)`, taskKey: r.taskKey, taskHash: r.taskHash } });
  const famDir = path.join(ROOT, 'experiments/autobench/families');
  for (const fam of readdirSync(famDir).filter(d => d.startsWith('abr-')).sort()) {
    const text = readFileSync(path.join(famDir, fam, 'POLICY.md'), 'utf8');
    items.push({ id: `abr-${fam}`, source: 'abr-policy', category: fam, text: view(text), gold: gold('recurring', 'high', 'standing automation: runs on every listed event (POLICY.md section 1)'),
      jevEligible: true, cluster: `abr-${fam}`, provenance: { author: 'AutomationBench-R family author (Claude)', file: `experiments/autobench/families/${fam}/POLICY.md`, sha256: sha(text) } });
  }
  for (const e of ['e7', 'e8']) {
    const file = `beds/ebed/${e}/spec/SPEC-E.md`, text = readFileSync(path.join(ROOT, file), 'utf8');
    items.push({ id: `eb-${e}`, source: 'ebed-spec', category: e, text: view(text), gold: gold('recurring', 'high', 'one process instance per case, case-ticks over days, waits, effects (SPEC-E section 1)'),
      jevEligible: true, cluster: `eb-${e}`, provenance: { author: `E-bed ${e} spec author (Claude)`, file, sha256: sha(text) } });
  }
  const ids = new Set();
  for (const it of items) { if (ids.has(it.id)) throw new Error(`duplicate id ${it.id}`); ids.add(it.id); }
  return items;
}

// Split: clusters (an anchor family is one cluster; every other item is its own) are stratified by source x binary gold
// label; within a stratum clusters are ordered by sha256(SPLIT_SALT + cluster) and the first round(0.4 n) go to dev.
export function assignSplit(items) {
  const strata = new Map();
  for (const it of items) {
    const key = `${it.source}|${it.gold.needsWorkflow}`;
    if (!strata.has(key)) strata.set(key, new Set());
    strata.get(key).add(it.cluster);
  }
  const devClusters = new Set();
  for (const clusters of strata.values()) {
    const ordered = [...clusters].sort((a, b) => (sha(SPLIT_SALT + a) < sha(SPLIT_SALT + b) ? -1 : 1));
    ordered.slice(0, Math.round(DEV_SHARE * ordered.length)).forEach(c => devClusters.add(c));
  }
  return items.map(it => ({ ...it, split: devClusters.has(it.cluster) ? 'dev' : 'test' }));
}

export function freezeOf(lines, items) {
  const ids = s => items.filter(i => i.split === s).map(i => i.id).sort();
  const counts = {};
  for (const it of items) {
    const k = `${it.split}|${it.source}|${it.gold.mode}`;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return {
    schema: 'foundry.need-router.router1-set/v1',
    rule: `items from build-set.mjs; split: clusters stratified by source x needsWorkflow, ordered by sha256('${SPLIT_SALT}'+cluster), first round(${DEV_SHARE} n) per stratum to dev`,
    n: items.length, dev: ids('dev').length, test: ids('test').length,
    positives: { dev: items.filter(i => i.split === 'dev' && i.gold.needsWorkflow).length, test: items.filter(i => i.split === 'test' && i.gold.needsWorkflow).length },
    sha256: { set: sha(lines), devIds: sha(JSON.stringify(ids('dev'))), testIds: sha(JSON.stringify(ids('test'))), rubric: sha(readFileSync(path.join(DIR, 'RUBRIC.md'), 'utf8')) },
    counts: Object.fromEntries(Object.entries(counts).sort())
  };
}

async function main() {
  const items = assignSplit(await buildItems());
  const lines = items.map(i => JSON.stringify(i)).join('\n') + '\n';
  const freeze = freezeOf(lines, items);
  if (process.argv.includes('--check')) {
    const frozen = JSON.parse(readFileSync(path.join(DIR, 'FREEZE.json'), 'utf8'));
    const same = frozen.sha256.set === freeze.sha256.set && readFileSync(path.join(DIR, 'SET.jsonl'), 'utf8') === lines;
    console.log(same ? `OK: rebuilt set matches FREEZE.json (${freeze.sha256.set})` : `MISMATCH: rebuilt ${freeze.sha256.set} vs frozen ${frozen.sha256.set}`);
    process.exitCode = same ? 0 : 1;
    return;
  }
  writeFileSync(path.join(DIR, 'SET.jsonl'), lines);
  writeFileSync(path.join(DIR, 'FREEZE.json'), JSON.stringify({ ...freeze, frozenAt: new Date().toISOString() }, null, 1) + '\n');
  console.log(JSON.stringify(freeze, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
