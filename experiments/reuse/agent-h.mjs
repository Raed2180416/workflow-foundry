// The agent baseline WITH the supplier's labelled history (research/reuse-20261021/PREREG-C2-3.md). C2-1's agent arm
// (agent-b.mjs) saw the procedure and the item and no label, while rebuilding (SCRATCH) and the post-hoc history gate
// (G0) each used the supplier's 15 labelled history products: the review of C2-1 (finding 2) called that an information
// gap, not a capability gap. This arm closes it: the same Haiku 5.5 session, the same system prompt, tools, step limit
// and timeout (agent-b.mjs runAgentItem, unchanged), the same user prompt, and one block added to the system prompt:
// the 15 history products SCRATCH's builder learned from, each with its inputs, what each of the procedure's
// four tools returns for it in the supplier's world (callTool, the server the agent's own calls reach) and B's recorded
// class. The block's wording follows the builder's brief (experiments/sopbench/build.mjs BUILD_PROMPT: "Where the SOP is
// silent or ambiguous, infer the rule from the examples"). The block is appended to the SYSTEM prompt, after the tool
// catalog, so that it is a prompt-cache prefix shared by every item of a supplier (c23.mjs runs a supplier's items
// together); in the user prompt it was written to the cache anew in every session (dev smoke 2026-11-04: about 57% of
// a session's $0.0022). The user prompt (the SOP and the task) is unchanged.
//
// Pure helpers (historyBlock, withHistory) plus runAgentHItem; the driver is c23.mjs. Blocks hold SOP-Bench-derived
// text: they are written under LIVE_ROOT only, and the repo records their sha256.
import { runClaudeCode } from '../../src/executors/claude-code.mjs';
import { runAgentItem } from './agent-b.mjs';
import { subtaskOf } from './gen-b.mjs';
import { callTool, DG_TOOLS } from './world-b.mjs';

export const AGENT_H_VERSION = 'c2-agent-h/1';
/** Session limits: as agent-b.mjs AGENT_DEFAULTS except the budget (CLI cap and ledger reservation), $0.05 instead of
 * $0.25: C2-1's 470 agent sessions cost at most $0.0028, so $0.05 is 18× that and lets the spend ledger reserve
 * honestly at concurrency 2 inside the experiment's remaining cap. */
export const AGENT_H_LIMITS = Object.freeze({ budgetUsd: 0.05 });
export const HISTORY_HEADER = 'Labelled history: the past items below come from the same supplier as the task, each with its inputs, what each of the procedure\'s tools returned for it, and the hazard_class recorded for it. The recorded classes are correct. Where the SOP is silent or ambiguous, infer the rule from these records, and keep your answer consistent with them.';
const SYSTEM_HEAD = 'You execute a Standard Operating Procedure (SOP) for one task, using the procedure\'s tools.';

/**
 * The labelled-history block of one supplier. products: the history products in pool order (manifest build ids then
 * repair ids, as SCRATCH's builder saw them); world: the supplier's world (gen-b.mjs worldsOf); bankTexts: the proof
 * bank's texts (gen-b.mjs bankTextsOf); labelOf: product -> recorded class (C2-1: the product's truth).
 */
export function historyBlock({ products, world, bankTexts, labelOf = p => p.truth.hazard_class }) {
  if (!products.length) throw new Error('historyBlock: no history products');
  const recs = products.map((p, i) => {
    const t = subtaskOf(p, bankTexts);
    const results = Object.entries(DG_TOOLS).map(([name, d]) => `${name}: ${callTool(world, name, { product_id: t.inputs.product_id, [d.field]: t.inputs[d.field] }).content}`);
    const label = labelOf(p);
    if (typeof label !== 'string' || !label) throw new Error(`historyBlock: no label for ${p.id}`);
    return `### Record ${i + 1}\nInputs:\n${t.task_text}\nTool results:\n${results.join('\n')}\nRecorded hazard_class: ${label}`;
  });
  return `<labelled_history>\n${HISTORY_HEADER}\n\n${recs.join('\n\n')}\n</labelled_history>`;
}

/** The SOP-Bench system prompt (sopbench/run.mjs systemPrompt) with the block appended after the tool catalog. */
export function withHistory(systemPrompt, block) {
  if (typeof systemPrompt !== 'string' || !systemPrompt.startsWith(SYSTEM_HEAD)) throw new Error('withHistory: not the SOP-Bench system prompt');
  if (!block.startsWith('<labelled_history>\n') || !block.endsWith('\n</labelled_history>')) throw new Error('withHistory: not a history block');
  return `${systemPrompt}\n\n${block}`;
}

/** runAgentItem (agent-b.mjs, unchanged) with the history block in the system prompt and AGENT_H_LIMITS. */
export function runAgentHItem(o) {
  const inner = o.runner ?? runClaudeCode;
  return runAgentItem({ ...o, ...AGENT_H_LIMITS, runner: args => inner({ ...args, systemPrompt: withHistory(args.systemPrompt, o.block) }) });
}
