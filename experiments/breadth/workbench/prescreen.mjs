#!/usr/bin/env node
// $0 published-result pre-screen (PLAN §4.3 T1-1, §8.4 "Screen before build"): WorkBench Revisited commits per-task
// verdicts for 24 models (data/results/item_level_results.csv.gz, scored by the current evaluator; README.md:19, :64).
// On DEV templates only (SPLIT.json) this gives each model's success, the frontier premium over Haiku 4.5 and the
// headroom, before any paid call. It also fixes the 40 shipped dev instances of the Haiku 4.5 harness-parity anchor
// (rule below, from the split salt) and the published Haiku 4.5 verdicts on them.
//   node experiments/breadth/workbench/prescreen.mjs [--out research/breadth-20261021/workbench/PRESCREEN.json]
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { CLONE, RESEARCH, readJson, writeJson } from './lib.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

/** RFC 4180 CSV -> array of objects (header row). */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', i = 0, quoted = false;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, j) => [h, r[j]])));
}

/** The anchor's 40 dev instances: dev templates in ascending sha256(salt + ':h45:' + template id); one instance per template
 * (its lowest sha256(salt + ':h45:' + instance id)), then a second one from the first 11 templates of that order. */
export function anchorInstances(devTasks, salt, n = 40) {
  const byT = new Map();
  for (const t of devTasks) { if (!byT.has(t.template_id)) byT.set(t.template_id, []); byT.get(t.template_id).push(t.id); }
  const order = [...byT.keys()].sort((a, b) => (sha(`${salt}:h45:${a}`) < sha(`${salt}:h45:${b}`) ? -1 : 1));
  const ranked = new Map(order.map(t => [t, byT.get(t).sort((a, b) => (sha(`${salt}:h45:${a}`) < sha(`${salt}:h45:${b}`) ? -1 : 1))]));
  const out = [];
  for (let round = 0; out.length < n && round < 10; round++) for (const t of order) { if (out.length >= n) break; const id = ranked.get(t)[round]; if (id) out.push(id); }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : path.join(RESEARCH, 'PRESCREEN.json');
  const split = readJson(path.join(RESEARCH, 'SPLIT.json'));
  const file = path.join(CLONE, 'data/results/item_level_results.csv.gz');
  const raw = readFileSync(file);
  const rows = parseCsv(gunzipSync(raw).toString('utf8')).filter(r => r.run_group === 'revisited_2026' && r.tool_selection === 'all');
  const devSet = new Set(split.devTemplates);
  // template id of a published row: same rule as bed.py template_id (domain + first 10 hex of sha256(base_template))
  const tid = r => `${r.domain}/${sha(r.base_template).slice(0, 10)}`;
  const models = [...new Set(rows.map(r => r.model))].sort();
  const per = {};
  for (const m of models) {
    const rs = rows.filter(r => r.model === m);
    const dev = rs.filter(r => devSet.has(tid(r)));
    const devState = dev.filter(r => r.ground_truth_actions !== '[]');
    per[m] = { n: rs.length, correct: rs.filter(r => r.correct === 'True').length, rate: pct(rs.filter(r => r.correct === 'True').length, rs.length),
      sideEffects: pct(rs.filter(r => r.unwanted_side_effects === 'True').length, rs.length),
      dev: { n: dev.length, correct: dev.filter(r => r.correct === 'True').length, rate: pct(dev.filter(r => r.correct === 'True').length, dev.length),
        sideEffects: pct(dev.filter(r => r.unwanted_side_effects === 'True').length, dev.length),
        nonEmptyGold: { n: devState.length, rate: pct(devState.filter(r => r.correct === 'True').length, devState.length) } },
      timestamps: [...new Set(rs.map(r => r.run_timestamp))].length };
  }
  const devTemplatesSeen = new Set(rows.filter(r => devSet.has(tid(r))).map(tid));
  const h = per['claude-haiku-4.5'], s = per['claude-sonnet-4.6'], o = per['claude-opus-4.8'], f = per['claude-fable-5'];
  const premium = (a, b) => (a && b ? Math.round((a.dev.rate - b.dev.rate) * 10) / 10 : null);
  // anchor
  const devTasks = [];
  const seen = new Set();
  for (const r of rows.filter(r => r.model === 'claude-haiku-4.5' && devSet.has(tid(r)))) if (!seen.has(r.task_id)) { seen.add(r.task_id); devTasks.push({ id: r.task_id, template_id: tid(r) }); }
  const anchor = anchorInstances(devTasks, split.salt.sha);
  const hRows = new Map(rows.filter(r => r.model === 'claude-haiku-4.5').map(r => [r.task_id, r]));
  const anchorCorrect = anchor.filter(id => hRows.get(id)?.correct === 'True').length;
  const res = {
    source: { file: 'data/results/item_level_results.csv.gz @49c7dfd0', sha256: sha(raw), bytes: raw.length, rows: 'run_group revisited_2026, tool_selection all', read: new Date().toISOString().slice(0, 10) },
    scope: 'dev templates only (SPLIT.json); the overall columns are the published 690-task numbers (README, retro/main.pdf), shown for reference',
    devTemplatesMatched: devTemplatesSeen.size, models: per,
    screen: {
      haiku45Dev: h?.dev.rate ?? null, sonnet46Dev: s?.dev.rate ?? null, opus48Dev: o?.dev.rate ?? null, fable5Dev: f?.dev.rate ?? null,
      premiumSonnet46OverHaiku45: premium(s, h), premiumOpus48OverHaiku45: premium(o, h), premiumFable5OverHaiku45: premium(f, h),
      headroomRule: 'skip if both >= 0.90 or the larger model < 0.10 (PLAN §8.4); assay: enter if the premium is informative',
      note: 'Published runs are other model versions (Haiku 4.5, Sonnet 4.6, Opus 4.8) under the official OpenAI-style harness at temperature 0. Our arms are Haiku 5.5, Sonnet 5.5 and Opus 5.5 through Claude Code. This screen prices the premium; it does not predict our arms.',
    },
    anchor: { rule: "40 dev instances: dev templates in ascending sha256(salt + ':h45:' + template id); per template its instances in ascending sha256(salt + ':h45:' + id); round 1 takes one per template (29), round 2 one more from the first 11 templates", salt: split.salt.sha,
      ids: anchor, idsSha256: sha(anchor.join('\n')), publishedHaiku45Correct: anchorCorrect, publishedHaiku45Rate: pct(anchorCorrect, anchor.length),
      publishedHaiku45ById: Object.fromEntries(anchor.map(id => [id, hRows.get(id)?.correct === 'True'])),
      comparison: 'H45 arm (claude-haiku-4-5-20251001 through the A-H harness) on these 40 vs the published verdicts; a gap above 10 points is reported as a harness difference' },
  };
  writeJson(out, res);
  console.log(JSON.stringify({ devTemplatesMatched: res.devTemplatesMatched, models: models.length, screen: res.screen, anchor: { n: anchor.length, published: `${anchorCorrect}/${anchor.length}` } }, null, 1));
}
