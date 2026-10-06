import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { skillCatalog, readSkill } from './foundry.mjs';
import { workflowSchema, validateData } from './validate.mjs';
import { errorData, checkData, FoundryError } from './data.mjs';

const string = { type: 'string', minLength: 1, maxLength: 30000 };
const identifier = { type: 'string', minLength: 1, maxLength: 128 };
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
// Unconstrained `input: {}` repeatedly reached the real OpenCode TUI as a
// JSON-looking string. Advertise the common object contract explicitly, and keep
// a separately named, explicitly serialized transport for other JSON root types.
// Neither transport coerces values or weakens the saved workflow's input schema.
const workflowInput = {
  type: 'object', additionalProperties: true,
  description: 'The actual workflow input OBJECT, for example {"values":[3,7,11]}. Do not serialize this object into a string. Read the saved workflow inputSchema first. Use {} for no input, or foundry_run_json for an intentionally serialized JSON value.'
};
export function parseRunInputJson(text) {
  if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 512 * 1024) throw new FoundryError('INPUT_JSON', 'inputJson must be one JSON document of at most 512 KiB');
  let input;
  try { input = JSON.parse(text); }
  catch { throw new FoundryError('INPUT_JSON', 'inputJson is not a valid JSON document; no run was created'); }
  return checkData(input, { maxBytes: 512 * 1024 });
}
export function toolDefinitions(foundry) {
  const run = async (workflowId, input, context) => {
    const created = foundry.createRun(workflowId, input);
    return foundry.publicRun(await foundry.startRun(created.id, { signal: context?.signal }));
  };
  const defs = [
    ['foundry_capabilities', 'List host-registered capability contracts. These are the only tool names valid in generated workflows.', object({}), () => ({ capabilities: foundry.registry.list(), registryHash: foundry.registry.hash() }), true],
    ['foundry_skills', 'List available workflow construction/domain skills for progressive disclosure.', object({}), () => skillCatalog(), true],
    ['foundry_read_skill', 'Read one installed skill or its Markdown reference. Cannot access arbitrary files.', object({ name: identifier, reference: identifier }, ['name']), args => readSkill(args.name, args.reference), true],
    ['foundry_design_context', 'Get the task, version-bound prior workflow, current schema, capabilities and selected skills. Use this to generate a workflow, not a canned template.', object({ requestId: identifier, task: string, domain: identifier, includeSkills: { type: 'boolean' } }), args => foundry.designContext(args), true],
    ['foundry_validate', 'Perform schema, dataflow and capability checks. Validity is not proof of task success.', object({ workflow: { type: 'object' } }, ['workflow']), args => foundry.validate(args.workflow), true],
    ['foundry_trial', 'Execute an exact candidate BEFORE proposing/applying it, in its own diagnostic store. Required requestId, workflow and actual object input. Preserves the candidate id/version without creating a reusable head or consuming the request. Only host-selected trial-safe capabilities are allowed. Local acceptance is not independent task qualification.', object({ requestId: identifier, workflow: { type: 'object' }, input: workflowInput }, ['requestId', 'workflow', 'input']), (args, context) => foundry.trial(args, { signal: context?.signal }), false],
    ['foundry_trial_json', 'Diagnostic draft execution with an explicitly serialized JSON input. Parses inputJson once; otherwise identical restricted behavior to foundry_trial. No caller-provided policy, paths, approvals or task oracle.', object({ requestId: identifier, workflow: { type: 'object' }, inputJson: { type: 'string', minLength: 1, maxLength: 524288 } }, ['requestId', 'workflow', 'inputJson']), (args, context) => foundry.trial({ requestId: args.requestId, workflow: args.workflow, input: parseRunInputJson(args.inputJson) }, { signal: context?.signal }), false],
    ['foundry_inspect_trial', 'Read an isolated trial by opaque id, verifying exact candidate/input/registry/event/artifact identities. Does not resume, approve or qualify task outcomes.', object({ trialId: identifier }, ['trialId']), args => foundry.inspectTrial(args.trialId), true],
    ['foundry_request_repair', 'Open an agent-diagnostic repair ONLY for a terminal failed run belonging to this request\'s applied proposal and the exact current workflow hash. Preserves the original task, goal and success criteria; commentary is not user authority. Idempotent per failure and depth-bounded. Paused, uncertain, cancelled, successful or unrelated runs are rejected. Does not auto-dispatch a model.', object({ requestId: identifier, failedRunId: identifier, expectedHash: identifier, diagnostic: { type: 'string', maxLength: 4000 } }, ['requestId', 'failedRunId', 'expectedHash']), args => foundry.requestRepair(args), false],
    ['foundry_save', 'Save a validated candidate as an immutable version; changes require exact expectedHash. Does not execute it.', object({ workflow: { type: 'object' }, expectedHash: { type: ['string', 'null'] } }, ['workflow']), args => foundry.save(args.workflow, args.expectedHash), false],
    ['foundry_workflows', 'List current reusable workflow heads and their complete programs.', object({}), () => foundry.store.workflows(), true],
    ['foundry_requests', 'List queued user change requests. Pending requests remain durable until a version-bound proposal is applied.', object({}), () => foundry.store.requests(), true],
    ['foundry_request_design', 'Create a draft design request from task text relayed by this agent. Its provenance is agent-request, never direct user consent. It stays diagnostic and does not trigger background model spending. Use the returned id for trial/propose. Existing-workflow revisions may include workflowId and exact expectedHash; no capability, approval or oracle policy changes.', object({ task: string, workflowId: identifier, expectedHash: identifier }, ['task']), args => foundry.store.createAgentDesignRequest(args), false],
    ['foundry_propose', 'Submit a validated replacement workflow and rationale for a queued request. Preserves old versions and running programs.', object({ requestId: identifier, workflow: { type: 'object' }, rationale: string }, ['requestId', 'workflow', 'rationale']), args => foundry.propose(args), false],
    ['foundry_apply_proposal', 'Apply a validated proposed workflow if its base is still current. This versions the program; it never grants effect authority or migrates a live run.', object({ proposalId: identifier }, ['proposalId']), args => foundry.apply(args.proposalId), false],
    ['foundry_run', 'Execute a saved workflow with an actual JSON OBJECT as input. Required arguments: workflowId and input. Example: {"workflowId":"NumericRollup","input":{"values":[3,7,11]}}. The workflow input schema remains enforced. This call may pause for a real human answer/approval; it cannot grant authority.', object({ workflowId: identifier, input: workflowInput }, ['workflowId', 'input']), (args, context) => run(args.workflowId, args.input, context), false],
    ['foundry_run_json', 'Execute a saved workflow using an EXPLICITLY SERIALIZED JSON document in inputJson. Prefer foundry_run for object inputs. This alternative supports scalar, null, array or object roots and clients that cannot emit nested objects. Example inputJson: "{\\"values\\":[3,7,11]}". Parse exactly once, then validate the exact value against the saved workflow schema; no automatic coercion or approval.', object({ workflowId: identifier, inputJson: { type: 'string', minLength: 1, maxLength: 524288, description: 'One JSON document as text. Encoding null, false, numbers and arrays preserves those root values. Do not double-encode the whole document.' } }, ['workflowId', 'inputJson']), (args, context) => run(args.workflowId, parseRunInputJson(args.inputJson), context), false],
    ['foundry_resume', 'Resume a persisted run, preserving its program and completed effects. Cannot synthesize human answers or approvals.', object({ runId: identifier }, ['runId']), async (args, context) => foundry.publicRun(await foundry.startRun(args.runId, { signal: context?.signal })), false],
    ['foundry_inspect', 'Read run state and verified event history. Local success is distinct from independent task qualification.', object({ runId: identifier }, ['runId']), args => foundry.inspectRun(args.runId), true],
    ['foundry_delivery', 'Check exact request→applied proposal→run identity before reporting an outcome. Rejects mixed versions or unrelated successful runs. Returns local execution state and separately scoped host task-evaluation evidence without claiming general readiness.', object({ requestId: identifier, proposalId: identifier, runId: identifier }, ['requestId', 'proposalId', 'runId']), args => foundry.delivery(args), true]
  ];
  // These are descriptive hints, never the authority mechanism. Execution tools
  // can invoke host-selected external adapters; do not advertise a universally
  // closed/additive world merely because the bundled examples are local.
  const dispatches = new Set(['foundry_run', 'foundry_run_json', 'foundry_resume', 'foundry_trial', 'foundry_trial_json']);
  return defs.map(([name, description, inputSchema, execute, readOnly]) => ({
    name, description, inputSchema, execute,
    annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: dispatches.has(name) }
  }));
}

export async function serveMcp(foundry, transport = new StdioServerTransport()) {
  const server = new Server({ name: 'workflow-foundry', version: '0.1.0' }, { capabilities: { tools: {}, resources: {} } });
  const defs = toolDefinitions(foundry);
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: defs.map(({ execute, ...spec }) => spec) }));
  server.setRequestHandler(CallToolRequestSchema, async (request, context) => {
    try {
      const tool = defs.find(t => t.name === request.params.name);
      if (!tool) throw Object.assign(new Error('Unknown Foundry tool'), { code: 'UNKNOWN_TOOL' });
      const args = request.params.arguments ?? {};
      validateData(tool.inputSchema, args, `${tool.name} arguments`);
      const result = await tool.execute(args, context);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: errorData(error), ...(error.details ? { details: error.details } : {}) }) }] };
    }
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [
    { uri: 'foundry://schema/workflow', name: 'Workflow IR schema', mimeType: 'application/json' },
    { uri: 'foundry://skills/catalog', name: 'Workflow skill catalog', mimeType: 'application/json' }
  ] }));
  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    const value = request.params.uri === 'foundry://schema/workflow' ? workflowSchema : request.params.uri === 'foundry://skills/catalog' ? skillCatalog() : null;
    if (!value) throw new Error('Unknown resource');
    return { contents: [{ uri: request.params.uri, mimeType: 'application/json', text: JSON.stringify(value) }] };
  });
  await server.connect(transport);
  return server;
}
