// tools/sop.mjs: a SOP workflow's port to the procedure's tools and its section contracts (experiments/sopbench/kit/sop.mjs,
// copied byte-identical into every builder workdir and run directory; research/sopbench-20261021/DESIGN.md §2).
// Tool calls go through the same file mailbox and host bridge as the per-row agent's tool.mjs (same request protocol), so
// both arms reach the same tools, on the same world, with the same results. Node built-ins only, plus ./flow.mjs.
//
//   import { createFlow } from './tools/flow.mjs';
//   import { createSop } from './tools/sop.mjs';
//   const flow = createFlow({ budgetUsd: 0.05 });
//   const sop = createSop(flow);                       // tools/catalog.json and tools/output-schema.json are beside this file
//   const task = flow.input();                          // task.json: { sop, row, inputs, task_text, output_columns }
//   const s1 = await sop.section('5.1 verify-account', {
//     input:  { type: 'object', required: ['account_id'], properties: { account_id: { type: 'string' } } },
//     output: { type: 'object', required: ['valid'], properties: { valid: { type: 'boolean' } } },
//     tools:  ['validateAccount'],                      // the only tools this section may call
//   }, { account_id: task.inputs.account_id }, async (input, port) => {
//     const r = await port.call('validateAccount', { account_id: input.account_id });   // parsed JSON result
//     return { valid: r['is account id valid'] === true };
//   });
//   sop.done({ final_resolution_status: '...' });       // every output column, each a string (or null), then flow.done
//
// port.call(name, args) returns the tool's parsed JSON result and throws a ToolError (err.message = the tool's error text)
// when the tool answered "Error: ..."; port.tryCall(name, args) returns { ok, value } or { ok: false, error } instead;
// port.batch([{ name, arguments }]) runs several calls in ONE request (one step) and returns [{ ok, value | error }].
// The same three exist on `sop` itself for calls outside any section. Contracts are enforced, each failure is a deopt
// (exit 75, a failed row): a section's input or output that does not match its schema (invariant section-input:<name>,
// section-output:<name>), a tool a section did not declare (invariant section-tool:<name>), a tool that does not exist
// (invariant unknown-tool), an answer without every output column (invariant answer-shape), or the environment refusing a
// request (guard tool-environment: for example the step limit). Every section runs inside flow.phase(name), so the trace
// has a span per section, and every tool request names its section in the host's call log.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaErrors } from './flow.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOX = process.env.SOP_MAILBOX || path.join(HERE, '..', '.tools');
const WAIT_MS = Number(process.env.SOP_TOOL_WAIT_MS ?? 180_000);

export class ToolError extends Error {
  constructor(tool, message) { super(message); this.name = 'ToolError'; this.tool = tool; }
}

/** Claim the next request number with an exclusive create (as tool.mjs), so concurrent requests never share one. */
function claim() {
  mkdirSync(BOX, { recursive: true });
  for (let tries = 0; tries < 10_000; tries++) {
    const used = readdirSync(BOX).map(f => /^req-(\d+)\.(?:json|claim)$/.exec(f)).filter(Boolean).map(m => Number(m[1]));
    const n = (used.length ? Math.max(...used) : 0) + 1;
    try { closeSync(openSync(path.join(BOX, `req-${n}.claim`), 'wx')); return n; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw new Error('could not claim a request slot');
}

async function send(calls) {
  const n = claim();
  const tmp = path.join(BOX, `req-${n}.json.tmp`);
  writeFileSync(tmp, JSON.stringify({ v: 1, calls }));
  renameSync(tmp, path.join(BOX, `req-${n}.json`));
  const res = path.join(BOX, `res-${n}.json`);
  const t0 = Date.now();
  while (Date.now() - t0 < WAIT_MS) {
    if (existsSync(res)) { try { return JSON.parse(readFileSync(res, 'utf8')); } catch { /* being written */ } }
    await new Promise(r => setTimeout(r, 20));
  }
  return { error: `the environment did not answer within ${Math.round(WAIT_MS / 1000)} s` };
}

const parseResult = content => {
  const text = String(content ?? '');
  if (text.startsWith('Error: ')) return { ok: false, error: text.slice(7) };
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: true, value: text }; }
};

export function createSop(flow, { catalogFile = path.join(HERE, 'catalog.json'), schemaFile = path.join(HERE, 'output-schema.json') } = {}) {
  const catalog = JSON.parse(readFileSync(catalogFile, 'utf8'));
  const names = new Set(catalog.map(t => t.name));
  const answerSchema = existsSync(schemaFile) ? JSON.parse(readFileSync(schemaFile, 'utf8')) : null;
  const als = new AsyncLocalStorage();

  async function request(calls) {
    const sec = als.getStore();
    for (const c of calls) {
      flow.invariant('unknown-tool', names.has(c?.name), () => ({ tool: c?.name, known: [...names] }));
      if (sec) flow.invariant(`section-tool:${sec.name}`, sec.tools.includes(c.name), () => ({ tool: c.name, declared: sec.tools }));
    }
    const r = await send(calls.map(c => ({ name: c.name, arguments: JSON.stringify(c.arguments ?? {}), ...(sec ? { section: sec.name } : {}) })));
    flow.guard('tool-environment', !r.error && Array.isArray(r.results), () => ({ error: r.error ?? 'malformed answer' }));
    return r.results.map(x => parseResult(x.content));
  }
  const tryCall = async (name, args = {}) => (await request([{ name, arguments: args }]))[0];
  const call = async (name, args = {}) => {
    const r = await tryCall(name, args);
    if (!r.ok) throw new ToolError(name, r.error);
    return r.value;
  };
  const batch = async list => request(list);
  const port = { call, tryCall, batch };

  return {
    ...port,
    catalog,
    /** One SOP section: a typed sub-workflow with declared input, output and tools (DESIGN.md §2). */
    async section(name, spec, input, fn) {
      if (typeof name !== 'string' || !name) throw new Error('sop.section: a name is required');
      if (!spec || typeof spec !== 'object' || !spec.input || !spec.output || !Array.isArray(spec.tools)) throw new Error(`sop.section(${name}): spec is { input: schema, output: schema, tools: [names] }`);
      for (const t of spec.tools) if (!names.has(t)) throw new Error(`sop.section(${name}): unknown tool ${t}`);
      if (typeof fn !== 'function') throw new Error(`sop.section(${name}): fn must be a function`);
      const inErr = schemaErrors(spec.input, input);
      flow.invariant(`section-input:${name}`, !inErr.length, () => ({ errors: inErr }));
      return flow.phase(name, async () => als.run({ name, tools: spec.tools }, async () => {
        const out = await fn(input, port);
        const outErr = schemaErrors(spec.output, out);
        flow.invariant(`section-output:${name}`, !outErr.length, () => ({ errors: outErr }));
        return out;
      }));
    },
    /** The final answer: every output column present, each a string or null; then flow.done (prints it). */
    done(answer) {
      const errs = answerSchema ? schemaErrors(answerSchema, answer) : [];
      flow.invariant('answer-shape', answer && typeof answer === 'object' && !errs.length, () => ({ errors: errs }));
      return flow.done(answer);
    },
  };
}
