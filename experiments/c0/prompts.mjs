// Frozen builder prompts for the C0 construction experiment (research/construction-20261006/DESIGN.md).
// Both arms share the preamble; they differ only in the substrate paragraph, and each points to its own construction
// skill in a read-only kit (F: skills/micro-harness, B1: skills/script-harness; same lessons, same length ±15%).
// Any edit after the first pre-registered run is an amendment (the hash of this file is recorded in the pre-registration).

export const PREAMBLE = ({ probes, minutes, constructionModelUsd, perTaskUsd, scoreChecks, models }) => `You are building a reusable solver for a FAMILY of tasks.

Example tasks ("probes") from this family are in ./probes/probe-0 .. probe-${probes - 1}/. Each has prompt.md (exactly what a solver receives), inputs.json (its data), files/ (if any) and task.json (the same task as one JSON object {prompt, inputs, files?}). The final answer must be JSON matching ./output-schema.json.

Your solver will later run unattended on many NEW tasks of the same family that you will not see. An independent checker you cannot see scores each answer. Do not hard-code answers or literals from the probes: the solver must work on unseen tasks of the family, including harder ones.

Check a candidate answer for a probe with: node tools/score.mjs <probe-index> <answer.json>   → prints {"pass": true|false, "score": 0..1}. You have at most ${scoreChecks} score checks in total; use them deliberately.

Models your solver may call (owner policy ids, cheapest first): ${models.join(', ')}. Every model call made while you build and test is charged to a construction model budget of $${constructionModelUsd}; when the solver later runs, each task has a budget of $${perTaskUsd}. At equal accuracy, a lower cost per task is better, so prefer cheap models where they are reliable and use stronger ones where they are needed. node tools/budget.mjs prints the construction model spend so far.

You have about ${minutes} minutes. Deliver a working solver before you run out; an imperfect solver beats none. Finish by writing ./BUILD-NOTES.md (what the solver does, what you verified, known weaknesses; ≤ 300 words).`;

export const SUBSTRATE = {
  F: ({ kitDir, classes }) => `
Build the solver as a Foundry workflow: write ./workflow.json in the Foundry IR. First read the construction skill: ${kitDir}/skills/micro-harness/SKILL.md and its references (references/ir.md, references/operators.md).
Tools (run from this directory):
  ./tools/foundry validate workflow.json
  ./tools/foundry run workflow.json --input probes/probe-0/task.json --workspace ws --max-cost 1    (prints the run record; outputs.answer is the answer)
  ./tools/foundry calls --run <run-id> --workspace ws        (every model call with its cost)
A workspace keeps the first version of a workflow id: use a new --workspace after each edit of workflow.json.
Model classes in this session (./tools/policy.json): ${classes}; any other class has no model here.
The workflow receives {prompt, inputs, files?} as its input and must have a node with id "answer" whose output is exactly the final answer object. Model calls inside the workflow are routed and charged automatically.`,
  B1: ({ kitDir }) => `
Build the solver as a script: write ./solve.mjs (Node 24, ESM, no npm packages). First read the construction skill: ${kitDir}/skills/script-harness/SKILL.md and its reference (references/patterns.md).
It is run as  node solve.mjs <task.json>  and must print only the final answer JSON to stdout. To call a model:
  import { callModel } from './tools/model.mjs';
  const value = await callModel({ model, system, prompt, schema, reasoning });   // reasoning: 'none' | 'low' | 'medium' | 'high'
It returns the parsed JSON value matching \`schema\` (a JSON Schema object; use only type, properties, required, additionalProperties, items, enum, const, minimum, maximum, minItems, maxItems, minLength, maxLength). Structure the script however you like (decompose, fan out calls in parallel with Promise.all, verify, retry), as you would write a dynamic workflow. Model calls are routed and charged automatically; callModel prints each call's cost to stderr and appends it to ./tools/calls.jsonl. Call models only through callModel. At execution the script runs in a fresh copy of the task directory with PATH=/opt/node24/bin:/usr/local/bin:/usr/bin:/bin, HOME set to that directory, no user-installed tools (for example, no pytest) and no network other than callModel. ./tools/run-solver probes/probe-0 runs it the same way (with network).`,
};

export const builderPrompt = (arm, opts) => PREAMBLE(opts) + '\n' + SUBSTRATE[arm](opts);
