#!/usr/bin/env node
// $0 scripted smoke of arm A1 (no model): run.mjs --harness foundry with a scripted stand-in session that follows the
// procedure's shape on dev tasks (1 per domain from devTrain, seeded): discovery searches and reads, REQUIREMENTS.md
// written from the trigger message, a re-read, a verification note. It uses ONLY what the session itself sees (the
// user message and the tool catalog): no prepared task files, no assertions, no world dump. It makes no writes, so its
// scores are expected to be 0: this checks plumbing (prompt, bridge, step accounting, ledger collection, records),
// not capability.
//
//   node experiments/autobench/harness/smoke.mjs [--per-domain 1] [--seed a1-smoke-1] [--out DIR|none] [--concurrency 2]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_DOMAINS, REPO } from '../lib.mjs';
import { poolTasks, runTasks } from '../run.mjs';
import { scriptedHarnessRunner } from './scripted-session.mjs';

const call = (name, args) => ({ name, arguments: JSON.stringify(args) });
const RULE = /\b(must|should|only|never|always|do not|don't|ensure|make sure|include|send|post|update|create|notify|assign|flag|log|add|set|use)\b/i;

/** A procedure-shaped script from the session-visible user message only. */
export function procedureScript({ prompt }) {
  const text = String(prompt ?? '');
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 12);
  const rules = sentences.filter(s => RULE.test(s)).slice(0, 15);
  const words = text.replace(/\s+/g, ' ').trim().split(' ').slice(0, 8).join(' ');
  const listMail = call('api_fetch', { method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages', params: JSON.stringify({ maxResults: 5 }) });
  const ledger = ['# Requirements', ...rules.map((r, i) => `- [ ] R${i + 1}: ${r.replace(/\s+/g, ' ')} (source: trigger message; date: undated)`),
    '', '## Plan', '- (scripted smoke: no writes planned)'].join('\n');
  return [
    { calls: [call('api_search', { query: words || 'list records', top_k: 3 }), call('api_search', { query: 'list messages', top_k: 3 }), call('api_search', { query: 'read values', top_k: 3 })] },
    { calls: [listMail] },
    { write: { content: ledger } },
    { calls: [listMail] },
    { write: { append: true, content: ['', '## Verification', ...rules.map((_, i) => `- R${i + 1}: blocked (scripted smoke makes no writes)`)].join('\n') } },
  ];
}

export async function smoke({ perDomain = 1, seed = 'a1-smoke-1', out, concurrency = 2, log } = {}) {
  const tasks = poolTasks('devTrain', { subset: perDomain * PUBLIC_DOMAINS.length, seed });
  return runTasks({ tasks, harness: 'foundry', runner: scriptedHarnessRunner(procedureScript), det: 'record', k: 1, concurrency, runId: `a1-smoke-scripted-${seed}`,
    outDir: out === 'none' ? null : (out ?? path.join(REPO, 'research/automationbench-20261014/runs/a1-smoke-scripted')), log });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const a = Object.fromEntries(argv.map((x, i) => (x.startsWith('--') ? [x.slice(2), argv[i + 1]] : null)).filter(Boolean));
  const { summary, results } = await smoke({ perDomain: Number(a['per-domain'] ?? 1), seed: a.seed ?? 'a1-smoke-1', out: a.out, concurrency: Number(a.concurrency ?? 2) });
  const rows = results.map(r => {
    const f = r.forks[0];
    return { task: r.task, steps: f.steps, responses: f.session?.modelResponses, toolResponses: f.session?.toolResponses, numTurnsCli: f.session?.numTurns, worldCalls: f.usage?.worldCalls,
      reads: f.usage?.reads, searches: f.usage?.searches, writes: f.usage?.writes, ledgerItems: f.ledger?.items ?? null, ledgerPresent: f.ledger?.present ?? false,
      costUsd: r.costUsd, pass: r.final?.task_completed_correctly ?? null, partialCredit: r.final?.partial_credit ?? null, violations: f.session?.violations ?? null, errors: f.sessionError ?? f.harnessError ?? null };
  });
  process.stdout.write(JSON.stringify({ runId: summary.runId, arm: summary.arm, harness: summary.harness, n: summary.n, pass_rate: summary.pass_rate, mean_partial_credit: summary.mean_partial_credit,
    cost: summary.cost.spentUsd, accounting: summary.accounting, errors: summary.errors, copiedTo: summary.copiedTo ?? null, rows }, null, 1) + '\n');
}
