// The agent baseline (research/reuse-20261021/PREREG-C2-1.md §2, arm A): for each of program B's items, one Haiku 5.5
// session works the dangerous-goods procedure with the procedure's tools, exactly as SOP-Bench's A-H arm does
// (experiments/sopbench/run.mjs: the same system and user prompts, the tool client tool.mjs over the file mailbox, Bash
// only, 10 tool steps, a $0.25 session reservation, 10 minutes), with B's supplier world answering the tools. The agent
// sees the procedure text and the item's inputs; like the reused workflow, it sees no example of B's labels.
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { nestedModelUses, runClaudeCode } from '../../src/executors/claude-code.mjs';
import { materializeWorkdir } from '../sopbench/lib.mjs';
import { auditTranscript, systemPrompt, userPrompt } from '../sopbench/run.mjs';
import { readStream } from '../autobench/accounting.mjs';
import { lastFinalOutput, pyStr, strictVerdict } from '../sopbench/scorer.mjs';
import { serveMailbox } from './world-b.mjs';
import { normaliseClass } from './program-b.mjs';

export const AGENT_DEFAULTS = Object.freeze({ model: 'claude-haiku-5-5', budgetUsd: 0.25, maxSteps: 10, timeoutMin: 10, tools: ['Bash'] });

/** The class an agent's final message names (the last <final_output> JSON's hazard_class), normalised; null if none. */
export function agentClassOf(text) {
  const fo = lastFinalOutput(text);
  if (!fo.found || !fo.ok) return null;
  const hit = fo.entries.find(([k]) => String(k).toLowerCase() === 'hazard_class');
  return hit ? normaliseClass(pyStr(hit[1])) : null;
}

/** runAgentItem(o) -> { answerText, cls, strict, costUsd, costUnknown, durationMs, turns, steps, toolCalls, sessionError, nestedModelUses, harnessError } */
export async function runAgentItem(o) {
  const opt = { ...AGENT_DEFAULTS, ...o };
  const workdir = path.join(opt.live, 'agent-w', opt.tag);
  rmSync(workdir, { recursive: true, force: true });
  materializeWorkdir(workdir, opt.catalog);
  const box = serveMailbox({ box: path.join(workdir, '.tools'), world: opt.world, maxSteps: opt.maxSteps });
  let r = null, harnessError = null;
  const t0 = Date.now();
  try {
    r = await (opt.runner ?? runClaudeCode)({ model: opt.model, prompt: userPrompt(opt.sopText, opt.task.task_text, opt.task.output_columns), systemPrompt: systemPrompt(opt.catalog, opt.maxSteps),
      workdir, files: {}, budgetUsd: opt.budgetUsd, timeoutMs: opt.timeoutMin * 60_000, effort: null, tools: opt.tools, task: { name: opt.tag } });
  } catch (e) { harnessError = String(e?.message ?? e).slice(0, 500); }
  const served = await box.stop();
  const text = String(r?.result ?? '');
  const out = {
    answerText: text.slice(-2000), cls: agentClassOf(text),
    strict: strictVerdict(text, { hazard_class: { str: opt.truth.hazard_class, isna: false } }, ['hazard_class']).pass,
    costUsd: r ? (r.costUsd ?? r.costUpperUsd ?? opt.budgetUsd) : 0, costUnknown: Boolean(r?.costUnknown), durationMs: Date.now() - t0, turns: r?.turns ?? null,
    steps: served.steps, toolCalls: served.calls.filter(c => c.name).length, toolErrors: served.calls.filter(c => c.error).length,
    sessionError: r?.error?.code ?? null, nestedModelUses: nestedModelUses(r?.toolUses ?? []), harnessError,
  };
  // Host-side audit (SOP-Bench run.mjs auditTranscript): models reported, L5 flags; the transcript is kept for failure analysis.
  const tr = path.join(workdir, '.executor-transcript.jsonl');
  if (existsSync(tr)) {
    const hostDir = path.join(opt.live, 'agent-host');
    mkdirSync(hostDir, { recursive: true });
    copyFileSync(tr, path.join(hostDir, `${opt.tag}.jsonl`));
    out.audit = auditTranscript(readStream(tr), opt.model);
  } else out.audit = null;
  if (!opt.keep) rmSync(workdir, { recursive: true, force: true });
  return out;
}
