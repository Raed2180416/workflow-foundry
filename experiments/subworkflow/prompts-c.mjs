// SW-1c prompts (research/subworkflow-20261021/PREREG-SW-1c.md): the arms added after the review of RESULT-SW-1. Added in a
// new file so prompts.mjs, which PREREG-SW-1.md pins by sha256, stays byte-identical; the frozen arms' calls are checked
// by test/frozen-arms.test.mjs. Every text a SW-1c model sees beyond prompts.mjs is here.
//   A1H  the A1 decision with the self-build offer reworded (defect 1): in eval-1, 13 of A1's 26 direct backlog answers
//        said the node had no code-execution tool, misreading "build a sub-workflow for yourself ... code steps". The
//        reworded offer says the harness checks and runs the program; it adds no catalogue, so A1H vs A1 isolates wording.
//   A0G  the node alone plus the code-owned contract gate every sub-workflow answer passes, with up to 3 retries (defect 5).
//   A0C  the node with a sandboxed code tool and no sub-workflow machinery (no DSL, registry, practice run or judge step):
//        it may run JavaScript on its inputs and see the result, then answer with a program whose value is its answer.
//   A2C / A2FC  the governing route with a request-completeness check (defect 4): a request that leaves out an input the
//        node's answer contract depends on goes back to the node once, before the builder starts.
import { nodeContext, NODE_SYSTEM } from './prompts.mjs';
import { LIMITS } from './dsl.mjs';

// ---- A1H: the reworded self-build offer (the decide prompt otherwise equals A1's; P.decidePrompt's other lines) ----
export const OPTION_B_SELF_HARNESS = maxUsd => `(b) have the harness run a sub-workflow that you write: a small typed program of steps (parse the data, code steps that compute exactly, a model step that judges many rows in small batches, verify steps that check your own invariants). You only write it; the harness checks it, runs its code and model steps for you and returns its answer as yours, so you need no code tool of your own. It runs under your authority and may spend at most $${maxUsd}. If you choose (b), you write it in the next step; leave "answer" out.`;
export const decidePromptHarness = (input, maxUsd) => [nodeContext(input),
  `You have two ways to do this job:\n(a) answer directly now: fill "answer";\n${OPTION_B_SELF_HARNESS(maxUsd)}`,
  'Choose (b) when the job needs a multi-step procedure that is error-prone in one pass (for example many rows to parse, de-duplicate, convert and total exactly). Choose (a) when you can answer reliably in one pass; it is cheaper.',
  'Set "decision" to "answer" or "subworkflow" and give a one-sentence reason.'].join('\n\n');

// ---- A0G: the contract gate's feedback on a direct answer ----
export const gateRetryPrompt = (input, previous, problems) => [nodeContext(input),
  `Your previous intake answer failed the harness's answer checks:\n${problems.map(p => `- ${p}`).join('\n')}`,
  `Your previous answer: ${JSON.stringify(previous).slice(0, 60000)}`,
  'Give your channel\'s intake answer again, with these problems fixed.'].join('\n\n');

// ---- A0C: a code tool, no sub-workflow ----
export const CODE_TOOL_TURNS = 5;
export const CODE_TOOL_SYSTEM = `${NODE_SYSTEM}

You have a code tool. Each turn you write one JavaScript program: an ES module whose default export is a function of one object { channel, spec, notes, data } (your channel name, the go-live rules, the channel notes and the channel data, all as text) that returns JSON data. Pure code only: no imports, no network, no files, no clock; ${LIMITS.codeTimeoutMs / 1000} s limit. Code cannot call a model: any judgment of free text is yours to make, and you can write your judgments into the program as data.
- action "run": the harness runs the program on your inputs and shows you what it returned (the first 12,000 characters) in your next turn.
- action "answer": the harness runs the program and what it returns is your intake answer; it must match the intake answer exactly in shape. Code checks that the totals equal the imports and that every reference is in your data; if a check fails you see why and can try again.`;
export const CODE_TOOL_SCHEMA = { type: 'object', additionalProperties: false, required: ['action', 'program', 'why'], properties: {
  action: { type: 'string', enum: ['run', 'answer'] },
  program: { type: 'string', description: 'an ES module: export default ({ channel, spec, notes, data }) => value' },
  why: { type: 'string', description: 'one sentence: what this program does' } } };
export const codeToolPrompt = (input, { turn, maxTurns, history }) => [nodeContext(input),
  ...history.map((h, i) => `Turn ${i + 1}: you ran (action "${h.action}"):\n${h.program.slice(0, 6000)}\n${h.outcome}`),
  `This is turn ${turn + 1} of at most ${maxTurns}. ${turn + 1 === maxTurns ? 'This is your last turn: use action "answer".' : 'Write the next program.'}`].join('\n\n');

// ---- A2C / A2FC: an incomplete request goes back to the node once ----
export const returnedRequestPrompt = (input, maxUsd, missing, previous) => [nodeContext(input),
  `You asked the governing builder of the harness for a sub-workflow. The harness returned your request before the builder started: it does not pass ${missing.join(', ')}, and your answer contract depends on ${missing.length > 1 ? 'them' : 'it'}. The builder sees only the inputs you pass, your request and your answer contract.`,
  `Your request: ${JSON.stringify(previous).slice(0, 4000)}`,
  `Write your typed request again: the goal, which of your inputs it reads, what it must return, and the budget it may spend (at most $${maxUsd}).`].join('\n\n');
