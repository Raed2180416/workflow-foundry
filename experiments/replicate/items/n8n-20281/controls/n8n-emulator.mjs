// Runs the ORIGINAL n8n definition (the nodes, parameters, expressions and code of template 20281) for one trigger item against the mock services.
// This is a small purpose-built interpreter of the n8n node types the definition uses; it is NOT n8n. What is executed from the definition itself: every Code node
// (in a vm context with no I/O globals and a virtual clock), every expression ({{ ... }}), the Set / IF / Switch rules, the wiring, the Execute Workflow self-calls, the
// per-node retry and continue-on-error settings, the chat-model prompt and the output-parser schema. What is replaced: the vendor nodes (Jira, Slack, Gmail, Outlook,
// Google Sheets, HTTP requests, the OpenAI chat model) call the mock services of this item. What is assumed (not verified against a real n8n):
//   - Execute Workflow "each" with the workflow's own id re-enters the graph at "Route by Workflow Step" and returns the output of the last node that ran. The published
//     definition has NO Execute Workflow Trigger node, so on a real n8n the sub-workflow calls would be refused; the emulator follows the author's evident intent.
//   - the error-alert branch (Create Error Alert Message -> Slack) has no Error Trigger in the published definition and is never reachable; it is not run.
//   - a node with onError "continueRegularOutput" that throws outputs one item {error: message}; alwaysOutputData emits one empty item for an empty result.
//   - OpenAI "gpt-4.1-mini" maps to the mock model's "standard" tier.
// The definition is read from the corpus file at run time (sha256-checked) and never copied into the repository (n8n ToS).
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const ORIGINAL = Object.freeze({ rawPath: '/opt/corpus/n8n/workflows/20281.json.gz', sha256: '001466dc8eb800e2439004a1683d57b4bd99e8ed71a1d1c74276b9a6f25a651e' });
export const originalAvailable = (p = ORIGINAL.rawPath) => existsSync(p);
export function loadOriginal({ rawPath = ORIGINAL.rawPath, sha256 = ORIGINAL.sha256 } = {}) {
  const gz = readFileSync(rawPath);
  const got = createHash('sha256').update(gz).digest('hex');
  if (got !== sha256) throw new Error(`original definition at ${rawPath} has sha256 ${got}, expected ${sha256}`);
  return JSON.parse(gunzipSync(gz).toString('utf8')).workflow.workflow;
}

const DENY = /\b(require|process|import|eval|Function|globalThis|constructor|__proto__|child_process|fetch|XMLHttpRequest|WebSocket|setTimeout|setInterval|Buffer)\b/;
const SELF = 'self-workflow-id';

// Replaces the author's placeholders in "Set Workflow Configuration" by this deployment's values (the keys of cfg). Returns a clone and the list of what changed.
export function rebind(def, cfg) {
  const wf = structuredClone(def);
  const node = wf.nodes.find(n => n.name === 'Set Workflow Configuration');
  const changed = [], kept = [];
  for (const a of node.parameters.assignments.assignments) {
    if (a.name in cfg) { if (a.value !== cfg[a.name]) changed.push({ name: a.name, from: a.value, to: cfg[a.name] }); a.value = cfg[a.name]; }
    else kept.push(a.name);
  }
  wf.__binding = { changed: changed.length, changedNames: changed.map(c => c.name), keptAuthorValues: kept };
  return wf;
}

// ---- static facts about the definition (used by the report) -------------------------------------------------------------------------------
export function analyse(def) {
  const real = def.nodes.filter(n => !n.type.endsWith('stickyNote'));
  const byName = new Map(real.map(n => [n.name, n]));
  const inbound = new Map(real.map(n => [n.name, 0]));
  for (const [from, outs] of Object.entries(def.connections)) for (const group of Object.values(outs)) for (const arr of group) for (const c of arr) inbound.set(c.node, (inbound.get(c.node) ?? 0) + 1);
  const isTrigger = n => /Trigger$/.test(n.type);
  const noInbound = real.filter(n => !inbound.get(n.name) && !isTrigger(n)).map(n => n.name);
  const exprs = [];
  const scan = (v, node) => { if (typeof v === 'string') { if (v.startsWith('=')) exprs.push({ node, expr: v }); } else if (v && typeof v === 'object') for (const x of Object.values(v)) scan(x, node); };
  for (const n of real) scan(n.parameters, n.name);
  const codeNodes = real.filter(n => n.parameters.jsCode);
  const selfCalls = real.filter(n => n.type === 'n8n-nodes-base.executeWorkflow').map(n => n.name);
  return {
    nodes: real.length, stickyNotes: def.nodes.length - real.length, types: Object.fromEntries([...new Set(real.map(n => n.type))].map(t => [t, real.filter(n => n.type === t).length])),
    triggers: real.filter(isTrigger).map(n => n.name), nodesWithoutInboundEdge: noInbound, hasExecuteWorkflowTrigger: real.some(n => /executeWorkflowTrigger/i.test(n.type)), hasErrorTrigger: real.some(n => /errorTrigger/i.test(n.type)),
    executeWorkflowNodes: selfCalls, expressions: exprs.length, expressionsUnique: new Set(exprs.map(e => e.expr)).size, codeNodes: codeNodes.length, codeScanClean: codeNodes.every(n => !DENY.test(n.parameters.jsCode)), expressionScanClean: exprs.every(e => !DENY.test(e.expr)),
    retryOnFail: real.filter(n => n.retryOnFail).map(n => ({ node: n.name, maxTries: n.maxTries ?? 3 })),
    continueOnError: real.filter(n => n.onError === 'continueRegularOutput').map(n => n.name), alwaysOutputData: real.filter(n => n.alwaysOutputData).map(n => n.name),
    byName,
  };
}

// ---- expression / code evaluation ---------------------------------------------------------------------------------------------------------
function makeSandbox() {
  const ctx = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(`(() => { let NOW = 0; const D = Date;
    class VDate extends D { constructor(...a) { if (a.length === 0) super(NOW); else super(...a); } static now() { return NOW; } }
    globalThis.Date = VDate; globalThis.__setNow = n => { NOW = n; }; })()`, ctx);
  return ctx;
}
const scriptCache = new Map();
function runIn(ctx, src, timeout = 2000) {
  let s = scriptCache.get(src);
  if (!s) { s = new vm.Script(src, { filename: 'n8n-expression' }); scriptCache.set(src, s); }
  return s.runInContext(ctx, { timeout });
}
const jsonClone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

class Exec {                                                       // one (sub-)execution: the run data of its nodes
  constructor() { this.runData = new Map(); this.last = null; this.executed = []; }
}

export function makeOriginalHandler(def, cfg, opts = {}) {
  const info = analyse(def);
  const nodes = info.byName;
  const conns = def.connections;
  const ctx = makeSandbox();
  const coverage = { nodes: new Set(), expressionsEvaluated: new Set(), subExecutions: 0, nodeErrors: [], executionErrors: [] };
  const handler = (event, api) => {
    ctx.__api = null;
    vm.runInContext(`__setNow(${Date.parse(event.at)})`, ctx);
    const state = { api, event };

    const nodeScope = (exec, item) => {
      const lookup = name => {
        const runs = exec.runData.get(name);
        if (!runs) throw new Error(`Node '${name}' hasn't been executed`);
        const first = runs.flat();
        return { item: first[0] ?? { json: {} }, first: () => first[0], last: () => first[first.length - 1], all: () => first, isExecuted: true };
      };
      return { $: lookup, $json: item?.json ?? {}, $workflow: { id: SELF, name: 'support triage', active: true },
        $input: { item, all: () => (item ? [item] : []), first: () => item, last: () => item }, $itemIndex: 0 };
    };
    const withScope = (scope, f) => { Object.assign(ctx, scope); return f(); };
    const evalExpr = (str, exec, item) => {
      if (typeof str !== 'string' || !str.startsWith('=')) return str;
      coverage.expressionsEvaluated.add(str);
      const body = str.slice(1);
      const parts = []; let last = 0;
      for (const m of body.matchAll(/\{\{([\s\S]*?)\}\}/g)) { parts.push({ lit: body.slice(last, m.index) }); parts.push({ expr: m[1].trim() }); last = m.index + m[0].length; }
      parts.push({ lit: body.slice(last) });
      const single = parts.filter(p => p.expr !== undefined);
      // v0.2.0: expressions get the same deny-list scan as Code nodes (the host objects put into the context make node:vm no security boundary)
      if (single.some(p => DENY.test(p.expr))) throw new Error('emulator refuses to run an expression that mentions an I/O or escape identifier');
      return withScope(nodeScope(exec, item), () => {
        if (single.length === 1 && parts.every(p => p.expr !== undefined || p.lit === '')) return jsonClone(runIn(ctx, `(${single[0].expr})`));
        return parts.map(p => (p.expr !== undefined ? (v => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')))(runIn(ctx, `(${p.expr})`)) : p.lit)).join('');
      });
    };
    const param = (v, exec, item) => {
      if (typeof v === 'string') return evalExpr(v, exec, item);
      if (Array.isArray(v)) return v.map(x => param(x, exec, item));
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, param(x, exec, item)]));
      return v;
    };
    const resourceLocator = (v, exec, item) => { const p = param(v, exec, item); return p && typeof p === 'object' && '__rl' in p ? p.value : p; };

    const truthy = v => v === true || v === 'true' || (typeof v === 'number' && v !== 0) || (typeof v === 'string' && v !== '' && v !== 'false' && v !== '0');
    const condition = (c, exec, item) => {
      const left = evalExpr(c.leftValue, exec, item), right = evalExpr(c.rightValue, exec, item), { type, operation } = c.operator;
      if (type === 'boolean' && operation === 'true') return truthy(left);
      if (type === 'boolean' && operation === 'false') return !truthy(left);
      if (type === 'string' && operation === 'equals') return String(left) === String(right);
      throw new Error(`emulator: unsupported condition ${type}/${operation}`);
    };
    const conditionSet = (set, exec, item) => {
      const rs = set.conditions.map(c => condition(c, exec, item));
      return set.combinator === 'or' ? rs.some(Boolean) : rs.every(Boolean);
    };

    const httpOk = r => r.status >= 200 && r.status < 300;
    const fail = (what, r) => { throw new Error(`${what}: ${r.status} ${r.body?.message ?? r.body?.error?.message ?? r.body?.error ?? ''}`.trim()); };

    // returns an array of outputs (arrays of items)
    const run = (node, items, exec) => {
      const t = node.type, p = node.parameters;
      switch (t) {
        case 'n8n-nodes-base.set': {
          return [items.map(it => {
            const out = p.includeOtherFields ? { ...it.json } : {};
            for (const a of p.assignments.assignments) out[a.name] = typeof a.value === 'string' ? evalExpr(a.value, exec, it) : a.value;
            return { json: out };
          })];
        }
        case 'n8n-nodes-base.code': {
          const src = p.jsCode;
          if (DENY.test(src)) throw new Error('emulator refuses to run code that mentions an I/O or escape identifier');
          if (p.mode === 'runOnceForEachItem') {
            return [items.map(it => {
              const r = withScope(nodeScope(exec, it), () => runIn(ctx, `(function () {\n${src}\n})()`));
              const v = jsonClone(r);
              if (!v || typeof v !== 'object' || !('json' in v)) throw new Error('Code node must return {json}');
              return v;
            })];
          }
          const r = withScope({ ...nodeScope(exec, items[0]), $input: { all: () => items, first: () => items[0], last: () => items.at(-1), item: items[0] } }, () => runIn(ctx, `(function () {\n${src}\n})()`));
          const v = jsonClone(r);
          return [(Array.isArray(v) ? v : [v]).map(x => (x && 'json' in x ? x : { json: x }))];
        }
        case 'n8n-nodes-base.if': {
          const yes = [], no = [];
          for (const it of items) (conditionSet(p.conditions, exec, it) ? yes : no).push(it);
          return [yes, no];
        }
        case 'n8n-nodes-base.switch': {
          const rules = p.rules.values, outs = Array.from({ length: rules.length + (p.options?.fallbackOutput === 'extra' ? 1 : 0) }, () => []);
          for (const it of items) {
            const i = rules.findIndex(r => conditionSet(r.conditions, exec, it));
            if (i >= 0) outs[i].push(it); else if (p.options?.fallbackOutput === 'extra') outs[rules.length].push(it);
          }
          return outs;
        }
        case 'n8n-nodes-base.executeWorkflow': {
          const id = resourceLocator(p.workflowId, exec, items[0]);
          if (id !== SELF) throw new Error(`emulator: executeWorkflow of ${id} is not supported`);
          return [items.map(it => {
            coverage.subExecutions++;
            const sub = execute('Route by Workflow Step', [it], new Exec());
            return sub.last?.flat() ?? [];
          }).flat()];
        }
        case '@n8n/n8n-nodes-langchain.chainLlm': {
          const lm = def.nodes.find(n => n.type === '@n8n/n8n-nodes-langchain.lmChatOpenAi'), parser = def.nodes.find(n => n.type === '@n8n/n8n-nodes-langchain.outputParserStructured');
          const schema = JSON.parse(parser.parameters.inputSchema);
          return [items.map(it => {
            const prompt = evalExpr(p.text, exec, it);
            const system = p.messages.messageValues.map(m => m.message).join('\n\n');
            const tries = node.retryOnFail ? (node.maxTries ?? 3) : 1;
            let lastErr = '';
            for (let i = 0; i < tries; i++) {
              const r = state.api.model.complete({ system, prompt, schema, tier: lm.parameters.model.value === 'gpt-4.1-mini' ? 'standard' : 'standard' });
              const c = r.body?.content;
              const bad = r.status !== 200 ? `model call failed: ${r.status}` : validateSchema(c, schema);
              if (!bad) return { json: { output: c } };
              lastErr = bad;
            }
            throw new Error(lastErr);
          })];
        }
        case 'n8n-nodes-base.jira': {
          const op = p.operation ?? 'get';
          if (p.resource === 'issueComment') {
            return [items.map(it => { const r = state.api.jira.addComment({ issueKey: evalExpr(p.issueKey, exec, it), body: evalExpr(p.comment, exec, it) }); if (!httpOk(r)) fail('Jira', r); return { json: r.body }; })];
          }
          if (op === 'getAll') {
            const out = [];
            for (const it of items) {
              const r = state.api.jira.search({ jql: evalExpr(p.options.jql, exec, it), fields: p.options.fields, limit: p.returnAll ? undefined : p.limit });
              if (!httpOk(r)) fail('Jira', r);
              out.push(...r.body.issues.map(i => ({ json: i })));
            }
            return [out.length || !node.alwaysOutputData ? out : [{ json: {} }]];
          }
          throw new Error(`emulator: jira operation ${op}`);
        }
        case 'n8n-nodes-base.httpRequest': {
          return [items.map(it => {
            const url = evalExpr(p.url, exec, it);
            const body = p.sendBody && p.specifyBody === 'json' ? JSON.parse(evalExpr(p.jsonBody, exec, it)) : undefined;
            const tries = node.retryOnFail ? (node.maxTries ?? 3) : 1;
            let r;
            for (let i = 0; i < tries; i++) {
              if (p.method === 'POST' && /\/rest\/api\/2\/issue$/.test(url)) r = state.api.jira.createIssue(body);
              else if (p.method === 'POST' && url === cfg.teamsWebhookUrl) r = state.api.teams.post({ url, body });
              else throw new Error(`emulator: no mock for ${p.method} ${url}`);
              if (httpOk(r)) break;
            }
            if (!httpOk(r)) fail('Request failed', r);
            return { json: r.body };
          })];
        }
        case 'n8n-nodes-base.slack': {
          return [items.map(it => {
            const r = state.api.slack.postMessage({ channel: resourceLocator(p.channelId, exec, it), text: evalExpr(p.text, exec, it) });
            if (!httpOk(r) || r.body?.ok !== true) fail('Slack', r);
            return { json: r.body };
          })];
        }
        case 'n8n-nodes-base.gmail': {
          return [items.map(it => {
            let r;
            if (p.resource === 'draft') r = state.api.gmail.createDraft({ to: evalExpr(p.options.sendTo, exec, it), subject: evalExpr(p.subject, exec, it), text: evalExpr(p.message, exec, it), threadId: evalExpr(p.options.threadId, exec, it) });
            else r = state.api.gmail.reply({ messageId: evalExpr(p.messageId, exec, it), text: evalExpr(p.message, exec, it), replyToSenderOnly: p.options?.replyToSenderOnly });
            if (!httpOk(r)) fail('Gmail', r);
            return { json: r.body };
          })];
        }
        case 'n8n-nodes-base.microsoftOutlook': {
          return [items.map(it => {
            const r = state.api.outlook.reply({ messageId: resourceLocator(p.messageId, exec, it), comment: evalExpr(p.message, exec, it), saveAsDraft: evalExpr(p.options?.saveAsDraft, exec, it) === true, replyToSenderOnly: p.replyToSenderOnly });
            if (!httpOk(r)) fail('Outlook', r);
            return { json: r.body ?? {} };
          })];
        }
        case 'n8n-nodes-base.googleSheets': {
          if (p.operation !== 'append') throw new Error('emulator: sheets operation');
          return [items.map(it => { const r = state.api.sheets.appendRow({ row: it.json }); if (!httpOk(r)) fail('Google Sheets', r); return { json: r.body }; })];
        }
        default: throw new Error(`emulator: node type ${t} is not implemented`);
      }
    };

    // schema check of the structured output parser (type / required / enum / range, which is all the definition's schema uses)
    function validateSchema(v, s) {
      if (!v || typeof v !== 'object') return 'output parser: not an object';
      for (const k of s.required ?? []) if (!(k in v)) return `output parser: missing ${k}`;
      for (const [k, d] of Object.entries(s.properties ?? {})) {
        if (!(k in v)) continue;
        if (d.type === 'string' && typeof v[k] !== 'string') return `output parser: ${k} not a string`;
        if (d.type === 'boolean' && typeof v[k] !== 'boolean') return `output parser: ${k} not a boolean`;
        if (d.type === 'number' && (typeof v[k] !== 'number' || (d.minimum !== undefined && v[k] < d.minimum) || (d.maximum !== undefined && v[k] > d.maximum))) return `output parser: ${k} not a number in range`;
        if (d.enum && !d.enum.includes(v[k])) return `output parser: ${k} not in enum`;
      }
      return '';
    }

    // Executes from `start` with the given input items until nothing is left to run. Returns the Exec (runData, last node output).
    function execute(start, inputItems, exec) {
      const queue = [{ name: start, items: inputItems }];
      while (queue.length) {
        const { name, items } = queue.shift();
        const node = nodes.get(name);
        if (!node) throw new Error(`emulator: no node ${name}`);
        coverage.nodes.add(name);
        let outputs;
        try { outputs = run(node, items, exec); }
        catch (e) {
          if (node.onError === 'continueRegularOutput') {
            coverage.nodeErrors.push({ node: name, message: String(e.message).slice(0, 120) });
            outputs = [items.map(() => ({ json: { error: String(e.message) } }))];
          } else { coverage.executionErrors.push({ node: name, message: String(e.message).slice(0, 160) }); throw Object.assign(new Error(`node "${name}": ${e.message}`), { node: name }); }
        }
        exec.runData.set(name, outputs); exec.last = outputs; exec.executed.push(name);
        outputs.forEach((out, i) => {
          if (!out.length) return;
          for (const c of conns[name]?.main?.[i] ?? []) queue.push({ name: c.node, items: out });
        });
      }
      return exec;
    }

    const trigger = event.trigger === 'gmail-new-email' ? 'When Email Received in Gmail' : 'When Email Received in Outlook';
    const exec = new Exec();
    const item = { json: structuredClone(event.data) };
    exec.runData.set(trigger, [[item]]); exec.executed.push(trigger); coverage.nodes.add(trigger);
    for (const c of conns[trigger].main[0]) {
      execute(c.node, [item], exec);
    }
  };
  handler.coverage = coverage; handler.info = info;
  return handler;
}
