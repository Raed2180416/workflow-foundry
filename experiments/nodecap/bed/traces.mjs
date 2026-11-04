#!/usr/bin/env node
// Print the record of NC-1 episodes for root-causing (PREREG-NODECAP-1-AMEND-1 §4.3): per turn the model's decision (action, tool,
// arguments, need), the dispatcher's answer (ok, code, member) and every broker decision of that turn (kind, result, member, level, code,
// options, top scores), then the approvals the person was asked, the proposals, the run's end and the answer. With --journal it also prints
// each call's raw response text from the episode's archived journal. Reads a saved report only ($0).
// Usage: node experiments/nodecap/bed/traces.mjs <report.json> [--failed] [--task T02] [--arm A] [--rep 1] [--journal]
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const short = (v, n = 160) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s === undefined ? '' : s.length > n ? `${s.slice(0, n)}…` : s; };
const needText = n => n ? `${n.verb ?? '?'}/${n.object ?? '?'}${n.system ? `@${n.system}` : ''}${n.effect ? `[${n.effect}]` : ''}${n.kind ? `{${n.kind}}` : ''}${n.why ? ` "${short(n.why, 80)}"` : ''}` : '';

// Scores go with the options when the answer listed them (find, unmet, options); otherwise they are the top candidates' scores.
const decisionText = d => `${d.kind}${d.via ? `/${d.via}` : ''}: ${d.result}${d.member ? ` ${d.member}` : ''}${d.level ? ` ${d.level}` : ''}${d.code ? ` ${d.code}` : ''}`
  + (d.options ? ` options: ${d.options.map((o, i) => `${o.split('.').slice(-1)[0]}${d.scores?.[i] !== undefined ? `=${d.scores[i]}` : ''}`).join(' ')}` : d.scores ? ` top scores: ${d.scores.join(' ')}` : '');

export function episodeText(r, { journalDir = null } = {}) {
  const out = [`== ${r.task} ${r.arm} r${r.rep ?? 1}${r.attempt > 1 ? ` (attempt ${r.attempt})` : ''}: ${r.notRun ? `NOT RUN ${r.notRun}` : `${r.success ? 'PASS' : 'FAIL'} status=${r.status} error=${r.error} runs=${r.runs} turns=${r.turns} $${(r.cost?.usd ?? 0).toFixed(5)}`}`];
  if (r.notRun) return out.join('\n');
  const decisions = r.decisions ?? [];
  for (const t of r.trace ?? []) {
    out.push(`  [run ${t.run} turn ${t.turn}] ${t.action} ${t.tool ?? ''} ${t.args && Object.keys(t.args).length ? short(t.args, 120) : ''}${t.need ? ` need=${needText(t.need)}` : ''} -> ${t.ok === null ? '-' : t.ok ? 'ok' : 'refused'}${t.code ? ` ${t.code}` : ''}${t.member ? ` (${t.member})` : ''}${t.repeat ? ` repeat=${t.repeat}` : ''}`);
    if (t.result !== undefined && t.result !== null) out.push(`      result: ${short(t.result, 220)}`);
    // A decision's `turn` is the loop iteration (0-based); the transcript's turn is 1-based.
    for (const d of decisions.filter(d => d.run === t.run && d.turn + 1 === t.turn)) out.push(`      decision ${decisionText(d)}`);
  }
  // Decisions with no logged turn (a turn that ended the run before it was logged).
  const logged = new Set((r.trace ?? []).map(t => `${t.run}:${t.turn}`));
  for (const d of decisions.filter(d => !logged.has(`${d.run}:${d.turn + 1}`))) out.push(`  [run ${d.run} turn ${d.turn + 1}, not logged] decision ${decisionText(d)}${d.need ? ` need=${needText(d.need)}` : ''}`);
  for (const a of r.approvals?.log ?? []) out.push(`  approval asked: ${a.action} ${a.tool} ${short(a.args, 140)} -> ${a.approved ? 'approved' : 'REJECTED'}`);
  if (r.proposals?.length) out.push(`  proposals: ${r.proposals.map((s, i) => `${r.proposalKinds?.[i] ?? '?'}:${s}`).join(', ')}${r.riskFlagged ? ' (deny-listed flagged)' : ''}`);
  if (r.grants?.length) out.push(`  grants: ${r.grants.join(', ')}`);
  out.push(`  answer: ${short(r.output, 200)}`);
  if (journalDir) {
    const f = path.join(journalDir, `${r.task}-${r.arm}-r${r.rep ?? 1}${r.attempt > 1 ? `-a${r.attempt}` : ''}.journal.jsonl.gz`);
    if (existsSync(f)) gunzipSync(readFileSync(f)).toString('utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).forEach((j, i) =>
      out.push(`  call ${i} (run ${j.run}) ${j.ok ? 'ok' : j.errorCode} out=${j.outputTokens} in=${j.inputTokens}+r${j.cacheReadTokens}+w${j.cacheWriteTokens} $${j.costUsd}: ${short(j.response?.text ?? j.response?.value, 300)}`));
  }
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2], report = JSON.parse(readFileSync(file, 'utf8'));
  const rows = report.rows.filter(r => (!process.argv.includes('--failed') || (!r.success && !r.superseded)) && (!arg('task') || r.task === arg('task'))
    && (!arg('arm') || r.arm === arg('arm')) && (!arg('rep') || String(r.rep ?? 1) === arg('rep')));
  const journalDir = process.argv.includes('--journal') ? path.join(path.dirname(file), 'journal') : null;
  console.log(rows.map(r => episodeText(r, { journalDir })).join('\n'));
}
