#!/usr/bin/env node
// BUILDER-1 tables from run records (reporting only; the metric formulas are the frozen metrics.mjs).
//   node experiments/surface/report.mjs b-h-1 b0-h-1 b-m-1      -> markdown on stdout
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize } from './metrics.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runs = path.join(root, 'research/surface-20261021/runs');
const doc = JSON.parse(readFileSync(path.join(root, 'research/surface-20261021/eval/cases.json'), 'utf8'));
const labels = process.argv.slice(2);
const load = label => readdirSync(path.join(runs, label, 'records')).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(path.join(runs, label, 'records', f), 'utf8')));
const data = labels.map(label => { const recs = load(label); const sumFile = path.join(runs, label, 'summary.json'); return { label, recs, s: summarize(recs, doc.cases), file: existsSync(sumFile) ? JSON.parse(readFileSync(sumFile, 'utf8')) : null }; });
const out = [];
const row = cells => out.push(`| ${cells.join(' | ')} |`);
row(['Measure', ...data.map(d => `${d.recs[0]?.arm ?? '?'} (${d.label})`)]); row(['---', ...data.map(() => '---')]);
const m = (name, f) => row([name, ...data.map(d => f(d.s, d))]);
m('Hidden-world verified (of 21)', s => `**${s.verified}/${s.fitCases}**`);
m('Oracle pass ignoring the run verdict', s => `${s.oraclePassIgnoringVerdict}/${s.fitCases}`);
m('Built and strictly valid (fit cases)', s => `${s.builtAndValid}/${s.fitCases}`);
m('Correct "none fits" refusals', s => `${s.correctRefusals}/${s.noneCases}`);
m('False refusals (fit cases)', s => s.falseRefusals);
m('Template choice correct (of 24)', s => s.templateCorrect === null ? 'n/a' : `${s.templateCorrect}/${s.cases}`);
m('Slot checks met', s => s.slotChecks.total ? `${s.slotChecks.ok}/${s.slotChecks.total}` : 'n/a');
m('Required questions asked', s => `${s.requiredQuestions.asked}/${s.requiredQuestions.total}`);
m('Unnecessary questions (repeats)', s => `${s.unnecessaryQuestions} (${s.repeatQuestions})`);
m('Questions the model proposed (before the code filter)', s => s.modelProposedQuestions ?? 'n/a');
m('Over-reach traps avoided', s => `${s.traps.avoided}/${s.traps.total}${s.traps.violated.length ? ` (violated: ${s.traps.violated.join(', ')})` : ''}`);
m('Person actions to first verified run: mean / median (answers + turn-on only)', s => `${s.personActionsToFirstVerifiedRun.mean} / ${s.personActionsToFirstVerifiedRun.median} (${s.personActionsToFirstVerifiedRun.beforeRunMean})`);
m('Model cost per request (USD)', s => `$${(s.cost.usdPerRequest ?? 0).toFixed(4)}`);
m('Model cost, arm total (USD)', (s, d) => `$${s.cost.usdTotal.toFixed(4)}${d.file?.spentUsdIncludingFaults !== undefined && d.file.spentUsdIncludingFaults !== s.cost.usdTotal ? ` ($${d.file.spentUsdIncludingFaults.toFixed(4)} incl. faults)` : ''}`);
m('Tokens per request (in + out + cache)', s => s.cost.tokensPerRequest);
m('Model calls, arm total', s => s.cost.calls);
m('Builder wall time per request: mean / median (s)', s => `${s.wallSeconds.mean} / ${s.wallSeconds.median}`);
m('Repair rounds (cases with a repair)', s => `${s.repairs.rounds} (${s.repairs.casesWithRepair})`);
m('Outcomes', s => Object.entries(s.outcomes).map(([k, v]) => `${k} ${v}`).join(', '));
m('Environment faults (not scored)', (s, d) => d.file ? `${d.file.environmentFaults?.length ?? 0}` : '?');
out.push('');
// Per-template table
const families = [...new Set(doc.cases.map(c => c.template))];
row(['Template', ...data.map(d => d.label)]); row(['---', ...data.map(() => '---')]);
for (const fam of families) {
  const ids = doc.cases.filter(c => c.template === fam).map(c => c.id);
  row([fam, ...data.map(d => ids.map(id => { const r = d.recs.find(x => x.case === id); if (!r) return `${id} -`; const j = r.judgement;
    return `${id} ${fam === 'none' ? (j.correctRefusal ? 'refused' : `NOT refused (${r.outcome}${r.template ? ` ${r.template}` : ''})`) : j.verified ? 'verified' : `FAIL (${r.outcome}${r.template && r.template !== fam ? ` ${r.template}` : ''})`}`; }).join('; '))]);
}
out.push('');
// Failures with raw evidence
for (const d of data) {
  for (const r of d.recs.filter(x => (x.judgement.kind === 'fit' && !x.judgement.verified) || (x.judgement.kind === 'none' && !x.judgement.correctRefusal) || x.judgement.trap?.violated)) {
    out.push(`- **${d.label} ${r.case}** (${r.outcome}${r.template ? `, ${r.template}` : ''}): ${r.judgement.reasons.slice(0, 4).join('; ')}${r.judgement.trap?.violated ? `; TRAP: ${r.judgement.trap.hits.join(', ')}` : ''}. Evidence: \`research/surface-20261021/runs/${d.label}/records/${r.case}.json\``);
  }
}
process.stdout.write(`${out.join('\n')}\n`);
