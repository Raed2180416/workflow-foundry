#!/usr/bin/env node
// $0 outlier screen for BG-9 (ABC T.10 "inspect outliers in pilot experiments"; T.7 "verify ground truth"): from the 24
// published WorkBench Revisited runs (data/results/item_level_results.csv.gz, all tools, scored by the current evaluator),
// the instances that no model solves and the templates where the strongest models all fail. A task every strong model
// fails is a candidate gold or task-text defect, to be read before any paid run.
// Held-out templates are counted only: their ids and texts stay host-only (HOST_ONLY/outliers-heldout.json), so no dev
// work reads them; the dev outliers are listed with the reason found on reading (DEV_READINGS below, filled by hand).
//   node experiments/breadth/workbench/outliers.mjs [--out research/breadth-20261021/workbench/OUTLIERS.json]
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { CLONE, HOST_ONLY, RESEARCH, readJson, writeJson } from './lib.mjs';
import { parseCsv } from './prescreen.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
/** The strongest published models: the top four by all-690 success in these runs (PRESCREEN.json: Fable 5 97.7%, Opus 4.8 96.2%, Gemini 3.1 Pro 95.5%, GPT-5.5 94.9%). */
export const STRONG = Object.freeze(['claude-fable-5', 'claude-opus-4.8', 'gemini-3.1-pro', 'gpt-5.5']);

/** Hand readings of the dev outliers (2026-10-28; task text, gold, the strong models' predicted actions in the published
 * CSV and the shipped project_tasks.csv). [run] = checked in the data, [inf] = reading of the task text. */
export const DEV_READINGS = Object.freeze({
  'project_management-056': { verdict: 'ambiguous task text', note: '"move everything they are actively working on to the backlog": gold [] because Leila has no "In Progress" task; her task 00000113 is "In Review" [run: project_tasks.csv], and the strong models move it. "Actively working on" admits In Review [inf]' },
  'project_management-058': { verdict: 'ambiguous task text', note: 'same template as project_management-056: Santiago\'s 00000116 is "In Review" [run], gold [] counts only "In Progress"' },
  'multi_domain-173': { verdict: 'ambiguous task text', note: '"... if [growth] was more than engaged users make a backlog task ... Also schedule a half-hour meeting": gold [] treats the meeting as conditional; the strong models read "Also" as unconditional and book it [inf]' },
  'multi_domain-179': { verdict: 'ambiguous task text', note: 'same template as multi_domain-173 ("Also schedule ...")' },
  'multi_domain-171': { verdict: 'unresolved (growth window)', note: 'gold creates the task and the meeting; the strong models compute "percent growth since Friday" over windows ending 2023-11-29 or 2023-11-30 and mostly decide otherwise; which window the generator used is not checked here [inf]' },
  'analytics-090': { verdict: 'unresolved (growth window)', note: '"if total visits grew by more than engaged users since Saturday": gold plots both; the strong models query through 2023-11-30 and decide not to plot; the growth definition (absolute or relative, end date) is not stated in the task [inf]' },
});

/** rows (published, one per model × task) -> per task { solvedBy, strongSolvedBy, n } */
export function perTask(rows, strong = STRONG) {
  const out = new Map();
  for (const r of rows) {
    const k = r.task_id;
    const o = out.get(k) ?? { taskId: k, domain: r.domain, base: r.base_template, models: 0, solvedBy: 0, strongModels: 0, strongSolvedBy: 0 };
    o.models += 1;
    if (r.correct === 'True') o.solvedBy += 1;
    if (strong.includes(r.model)) { o.strongModels += 1; if (r.correct === 'True') o.strongSolvedBy += 1; }
    out.set(k, o);
  }
  return [...out.values()];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const outFile = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : path.join(RESEARCH, 'OUTLIERS.json');
  const split = readJson(path.join(RESEARCH, 'SPLIT.json'));
  const devSet = new Set(split.devTemplates), heldSet = new Set(split.heldOutTemplates);
  const raw = readFileSync(path.join(CLONE, 'data/results/item_level_results.csv.gz'));
  const rows = parseCsv(gunzipSync(raw).toString('utf8')).filter(r => r.run_group === 'revisited_2026' && r.tool_selection === 'all');
  const models = [...new Set(rows.map(r => r.model))].sort();
  const strong = STRONG.filter(m => models.includes(m));
  const tid = r => `${r.domain}/${sha(r.base).slice(0, 10)}`;
  const tasks = perTask(rows, strong).map(t => ({ ...t, template: tid(t) }));
  const unsolved = tasks.filter(t => t.solvedBy === 0), strongFail = tasks.filter(t => t.strongModels && t.strongSolvedBy === 0);
  const byTemplate = list => { const m = {}; for (const t of list) m[t.template] = (m[t.template] ?? 0) + 1; return m; };
  const side = (list, set) => list.filter(t => set.has(t.template));
  const res = {
    screen: 'BG-9 T.10/T.7 outlier screen ($0): published per-task verdicts, run group revisited_2026, all tools',
    source: { file: 'data/results/item_level_results.csv.gz', sha256: sha(raw), models: models.length, strongModels: strong },
    tasks: tasks.length,
    unsolvedByAll: { dev: side(unsolved, devSet).length, heldOut: side(unsolved, heldSet).length },
    failedByAllStrong: { dev: side(strongFail, devSet).length, heldOut: side(strongFail, heldSet).length },
    dev: {
      unsolvedByAll: side(unsolved, devSet).map(t => ({ taskId: t.taskId, template: t.template, solvedBy: t.solvedBy })),
      failedByAllStrong: side(strongFail, devSet).map(t => ({ taskId: t.taskId, template: t.template, solvedBy: t.solvedBy, strongSolvedBy: t.strongSolvedBy, reading: DEV_READINGS[t.taskId] ?? null })),
      failedByAllStrongPerTemplate: byTemplate(side(strongFail, devSet)),
    },
    heldOut: { note: 'counts only; ids, templates and texts host-only (outliers-heldout.json)', failedByAllStrongTemplates: Object.keys(byTemplate(side(strongFail, heldSet))).length },
  };
  writeJson(path.join(HOST_ONLY, 'outliers-heldout.json'), { unsolvedByAll: side(unsolved, heldSet), failedByAllStrong: side(strongFail, heldSet) });
  writeJson(outFile, res);
  console.log(JSON.stringify({ models: models.length, strong, unsolvedByAll: res.unsolvedByAll, failedByAllStrong: res.failedByAllStrong, devTemplates: res.dev.failedByAllStrongPerTemplate }, null, 1));
}
