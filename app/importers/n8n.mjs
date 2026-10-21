// n8n workflow JSON -> Foundry IR, or "unsupported" with named reasons (research/surface-20261021/DESIGN.md §5).
//
// Two layers, kept apart on purpose (THESIS §2 "Coverage": declared vs compiled vs executed):
//   1. normalise(): the corpus normaliser's node classification and verdict, ported line for line from
//      research/corpus-20261006/scripts/automation-normalize.py (n8n_connector L326-L345, n8n_node L348-L431, the n8n branch of
//      n8n_items L441-L479, op_effect L52-L62, mark_back_edges L102-L140, finalize's verdict L158-L268). Its output is the DECLARED
//      verdict (`native | via-extension:<tokens> | unsupported:<reason>`), a heuristic from node categories that compiles nothing.
//   2. lower(): a COMPILE attempt. Each n8n node becomes an IR node, a host-binding note, or a blocking reason. The result is validated
//      by the real validator (src/validate.mjs) against the core registry plus stub contracts for each connector the flow needs. A flow
//      with any blocking reason is refused as a whole: an adapter must reject what it cannot preserve, never flatten it (AGENTS.md).
// Plus wrap(): the "wrap, don't replace" option, a capability contract that calls the EXISTING n8n workflow (webhook or n8n's own MCP
// execute_workflow) as one typed, approval-gated tool.
//
// Nothing here executes n8n, its expressions or its Code nodes. Workflow JSON is untrusted data. 0 imported flows have been executed.
import { createDefaultRegistry } from '../../src/capabilities.mjs';
import { validateWorkflow } from '../../src/validate.mjs';
import { loadPolicy } from '../../src/models/policy.mjs';
import { FoundryError, checkData, digest } from '../../src/data.mjs';

// ---------------------------------------------------------------------------------------------------- 1. the corpus normaliser, ported
const words = s => s.split(/\s+/).filter(Boolean);
const N8N_CORE = new Set(words(`set if switch filter merge code function functionItem splitInBatches wait noOp splitOut aggregate
sort limit removeDuplicates dateTime crypto html markdown xml renameKeys summarize extractFromFile convertToFile
itemLists executeWorkflow executeWorkflowTrigger manualTrigger scheduleTrigger cron interval start stickyNote
respondToWebhook webhook form formTrigger stopAndError errorTrigger compareDatasets editImage compression
moveBinaryData spreadsheetFile readWriteFile readBinaryFile readBinaryFiles writeBinaryFile executeCommand jwt
evaluation evaluationTrigger debugHelper httpRequest httpRequestTool totp aiTransform executionData simulate
simulateTrigger sseTrigger localFileTrigger workflowTrigger n8nTrigger respondWith dataTable dataTableTool
emailSend emailReadImap rssFeedRead rssFeedReadTrigger ftp ssh graphql`));
const N8N_LC_NONCONN = new Set(words(`agent agentTool chainLlm chainRetrievalQa chainSummarization outputParserStructured
outputParserAutofixing outputParserItemList memoryBufferWindow memoryManager vectorStoreInMemory
vectorStoreInMemoryInsert vectorStoreInMemoryLoad toolCode toolThink toolCalculator toolWorkflow toolVectorStore
toolHttpRequest chatTrigger chat manualChatTrigger documentDefaultDataLoader documentBinaryInputLoader
documentJsonInputLoader textClassifier informationExtractor sentimentAnalysis retrieverVectorStore
retrieverWorkflow retrieverMultiQuery retrieverContextualCompression textSplitterRecursiveCharacterTextSplitter
textSplitterTokenSplitter textSplitterCharacterTextSplitter mcpTrigger mcpClientTool code modelSelector
guardrails toolExecutor`));
const LC_PREFIX = /^(lmChat|lm|embeddings|vectorStore|memory|tool|reranker|retriever|document)/;
const N8N_MODEL = /^(agent|agentTool|chainLlm|chainRetrievalQa|chainSummarization|lmChat.*|lm[A-Z].*|openAi|googleGemini|anthropic|ollama|mistralAi|embeddings.*|textClassifier|informationExtractor|sentimentAnalysis|outputParserAutofixing|reranker.*|modelSelector|guardrails|aiTransform|perplexity|xAiGrok|deepSeek|groq)$/;
const READ_OP = /^(get|getall|list|search|read|lookup|find|download|query|fetch|retrieve|select|count|exists|check|scrape|crawl|load|watch|poll|extract|parse|search_or|inspect|export|transcribe)/i;
const WRITE_OP = /(create|update|delete|remove|send|post|append|upsert|insert|upload|add|^set|move|copy|publish|reply|archive|share|cancel|clear|patch|put|mark|label|tweet|like|invite|complete|close|write|edit|save|submit|respond|notify|assign|pause|subscribe|unsubscribe|book|charge|refund|invoice|forward|approve|reject)/i;
const EXT_ORDER = ['schedule-trigger', 'webhook-trigger', 'event-trigger', 'chat-session', 'stream', 'error-branch', 'retry-policy', 'subworkflow-call',
  'agent-tool-loop', 'conversation-state', 'unstructured-cycle', 'dynamic-fan-out', 'external-state-store', 'signal-resume'];
const kebab = s => String(s).replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

export function opEffect(op, fallback = 'external') {
  if (!op) return fallback;
  op = String(op);
  if (READ_OP.test(op) && !WRITE_OP.test(op.includes('_') ? op.split('_')[0] : op)) return 'read';
  if (WRITE_OP.test(op)) return 'write';
  if (READ_OP.test(op)) return 'read';
  return fallback;
}
export function n8nConnector(type) {
  const cut = type.lastIndexOf('.'), pkg = cut < 0 ? '' : type.slice(0, cut), base = type.slice(cut + 1);
  if (pkg === 'n8n-nodes-base') {
    if (N8N_CORE.has(base) || N8N_CORE.has(base.replace(/(Trigger|Tool)$/, ''))) return null;
    return kebab(base.replace(/(Trigger|Tool)$/, ''));
  }
  if (pkg === '@n8n/n8n-nodes-langchain') {
    if (N8N_LC_NONCONN.has(base)) return null;
    const b = base.replace(LC_PREFIX, '').replace(/(Tool|Trigger|Insert|Load)$/, '');
    if (!b || b === 'Chat' || b === 'Window') return null;
    return kebab(b);
  }
  const m = pkg.match(/^(?:@[^/]+\/)?(?:n8n-nodes-)?([^.]+)/);
  return `community:${kebab(m ? m[1] : base)}`;
}
/** [category, effects, async[], ext Set, opdesc] or null for a sticky note. Mirrors n8n_node() exactly, including its branch order. */
export function classifyNode(type, parameters) {
  const cut = type.lastIndexOf('.'), pkg = cut < 0 ? '' : type.slice(0, cut), base = type.slice(cut + 1), p = parameters ?? {};
  const rawOp = p.operation || p.mode, op = typeof rawOp === 'string' ? rawOp : null;
  const res = typeof p.resource === 'string' ? p.resource : null;
  const opdesc = [res, op].filter(Boolean).join('.');
  const ext = new Set();
  if (base === 'stickyNote') return null;
  if (base === 'errorTrigger') return ['error-handler', 'none', ['event'], ext, opdesc];
  if (['manualTrigger', 'start', 'executeWorkflowTrigger', 'evaluationTrigger', 'manualChatTrigger', 'workflowTrigger'].includes(base)) return ['trigger', 'none', [], ext, opdesc];
  if (['scheduleTrigger', 'cron', 'interval'].includes(base)) return ['trigger', 'none', ['schedule'], ext, opdesc];
  if (['webhook', 'formTrigger', 'mcpTrigger', 'sseTrigger'].includes(base)) return ['trigger', 'none', ['webhook'], ext, opdesc];
  if (base === 'chatTrigger') { ext.add('chat-session'); return ['trigger', 'none', ['webhook'], ext, opdesc]; }
  if (base.endsWith('Trigger') || base === 'emailReadImap') return ['trigger', 'read', [('pollTimes' in p || ['emailReadImap', 'rssFeedReadTrigger'].includes(base)) ? 'poll' : 'event'], ext, opdesc];
  if (['if', 'switch', 'filter', 'compareDatasets'].includes(base)) return ['condition', 'none', [], ext, opdesc];
  if (base === 'splitInBatches') return ['loop', 'none', [], ext, opdesc];
  if (base === 'merge') return ['merge', 'none', [], ext, opdesc];
  if (base === 'wait') {
    if (p.resume === 'form') return ['human', 'none', ['wait'], ext, 'resume=form'];
    if (p.resume === 'webhook') { ext.add('signal-resume'); return ['wait', 'none', ['wait', 'webhook'], ext, 'resume=webhook']; }
    return ['wait', 'none', ['wait'], ext, `resume=${p.resume || 'timeInterval'}`];
  }
  if (base === 'form') return ['human', 'none', ['wait'], ext, opdesc];
  if (op === 'sendAndWait' || p.operation === 'sendAndWait') return ['human', 'write', ['wait'], ext, opdesc];
  if ((['code', 'function', 'functionItem', 'toolCode', 'aiTransform'].includes(base) && pkg !== '@n8n/n8n-nodes-langchain') || base === 'toolCode')
    return ['code', 'none', [], ext, opdesc + (p.language ? ` lang=${p.language}` : '')];
  if (pkg === '@n8n/n8n-nodes-langchain' && base === 'code') return ['code', 'none', [], ext, opdesc];
  if (base === 'executeCommand') return ['code', 'external', [], ext, 'host shell command'];
  if (['executeWorkflow', 'toolWorkflow', 'retrieverWorkflow'].includes(base)) return ['subworkflow', 'external', [], ext, opdesc];
  if (base === 'stopAndError') return ['error-handler', 'none', [], ext, opdesc];
  if (pkg === '@n8n/n8n-nodes-langchain' && base.startsWith('memory')) { ext.add('conversation-state'); return ['other', ['memoryBufferWindow', 'memoryManager'].includes(base) ? 'none' : 'write', [], ext, opdesc]; }
  if (pkg === '@n8n/n8n-nodes-langchain' && base.startsWith('vectorStore')) { const m = String(p.mode || 'retrieve'); return ['action', /insert|update/i.test(m) ? 'write' : 'read', [], ext, `mode=${m}`]; }
  if (N8N_MODEL.test(base) || (pkg === 'n8n-nodes-base' && ['openAi', 'mistralAi', 'perplexity'].includes(base))) { if (['agent', 'agentTool'].includes(base)) ext.add('agent-tool-loop?'); return ['model', 'none', [], ext, opdesc]; }
  if (['set', 'splitOut', 'aggregate', 'sort', 'limit', 'removeDuplicates', 'dateTime', 'crypto', 'html', 'markdown', 'xml', 'renameKeys', 'summarize', 'extractFromFile', 'convertToFile', 'itemLists',
    'spreadsheetFile', 'moveBinaryData', 'compression', 'editImage', 'jwt', 'outputParserStructured', 'outputParserItemList', 'documentDefaultDataLoader', 'documentBinaryInputLoader',
    'documentJsonInputLoader', 'toolCalculator', 'totp', 'globalConstants'].includes(base) || base.startsWith('textSplitter')) return ['transform', 'none', [], ext, opdesc];
  if (['noOp', 'toolThink', 'stickyNote', 'debugHelper', 'evaluation', 'executionData'].includes(base)) return ['other', 'none', [], ext, opdesc];
  if (base === 'respondToWebhook') return ['action', 'write', [], ext, `respond ${p.respondWith || ''}`];
  if (['httpRequest', 'httpRequestTool', 'toolHttpRequest'].includes(base)) { const m = String(p.method || p.requestMethod || 'GET').toUpperCase(); return ['action', m === 'GET' ? 'read' : 'external', [], ext, m]; }
  if (['dataTable', 'dataTableTool'].includes(base)) { ext.add('external-state-store'); return ['action', opEffect(op, 'read'), [], ext, opdesc]; }
  if (base === 'readWriteFile' || base.startsWith('readBinary') || base === 'writeBinaryFile') return ['action', /write/i.test(op || base) ? 'write' : 'read', [], ext, opdesc];
  if (base.endsWith('Tool') || base.startsWith('tool') || base === 'mcpClientTool') return ['action', opEffect(op, 'external'), [], ext, opdesc];
  return ['action', opEffect(op, 'external'), [], ext, opdesc];
}

/** The workflow object of an export, a template API response, or an n8n API body. */
export function workflowOf(json) {
  checkData(json, { maxBytes: 4 * 1024 * 1024 });
  // The first envelope level that holds BOTH a nodes list and a connections object. An n8n.io template document wraps the workflow as
  // doc.workflow.workflow, and its doc.workflow.nodes is a metadata list of node TYPES with no connections: taking the first level with a
  // nodes list made every raw template throw N8N_FORMAT (research/ci1-20261021, S0).
  const isGraph = c => Array.isArray(c?.nodes) && c.connections !== null && typeof c.connections === 'object' && !Array.isArray(c.connections);
  const w = [json, json?.workflow, json?.workflow?.workflow].find(isGraph) ?? null;
  if (!w) throw new FoundryError('N8N_FORMAT', 'Not an n8n workflow: expected "nodes" and "connections"');
  return w;
}

/** The declared (corpus) view: nodes, edges, features, verdict, exactly as automation-normalize.py computes them. */
export function normalise(json) {
  const wf = workflowOf(json), nodes = [], byName = new Map(), ext = new Set(), edges = [], seen = new Set();
  let retry = 0;
  for (const node of wf.nodes) {
    const type = String(node.type ?? ''), r = classifyNode(type, node.parameters);
    if (!r) continue;
    let [category, effects, async, x, opdesc] = r;
    if (node.retryOnFail) retry++;
    if (['continueRegularOutput', 'continueErrorOutput'].includes(node.onError)) x = new Set([...x, 'error-branch']);
    const connector = n8nConnector(type);
    const n = { name: String(node.name), type, category, effects, async, ext: x, connectors: connector ? [connector] : [], opdesc, parameters: node.parameters ?? {}, raw: node };
    nodes.push(n); byName.set(n.name, n);
  }
  for (const [src, conns] of Object.entries(wf.connections ?? {})) {
    const srcNode = byName.get(src);
    for (const [ctype, outputs] of Object.entries(conns ?? {})) {
      (outputs ?? []).forEach((targets, port) => {
        for (const t of targets ?? []) {
          let kind = 'data';
          if (ctype === 'ai_tool') kind = 'control';
          else if (ctype === 'error') kind = 'error';
          else if (ctype === 'main' && srcNode?.raw.onError === 'continueErrorOutput' && port === outputs.length - 1 && outputs.length >= 2) kind = 'error';
          if (!byName.has(src) || !byName.has(t?.node)) continue;
          const key = `${src}\u0000${t.node}\u0000${kind}`;
          if (seen.has(key)) continue;
          seen.add(key); edges.push({ from: src, to: t.node, kind, ctype, port, tool: ctype === 'ai_tool' });
        }
      });
    }
  }
  if (retry) ext.add('retry-policy');
  // mark_back_edges: control edges first, then error, then data; an edge closing a cycle becomes a loop edge.
  const rank = { control: 0, error: 1, data: 2 }, adj = new Map(), indeg = new Map();
  edges.map((e, i) => [e, i]).sort((a, b) => (rank[a[0].kind] ?? 3) - (rank[b[0].kind] ?? 3) || a[1] - b[1]).forEach(([e, i]) => {
    if (e.kind === 'loop') return;
    if (!adj.has(e.from)) adj.set(e.from, []); adj.get(e.from).push(i); indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  });
  const color = new Map(nodes.map(n => [n.name, 0])), back = [];
  for (const r of [...nodes.filter(n => !indeg.get(n.name)).map(n => n.name), ...nodes.map(n => n.name)]) {
    if (color.get(r)) continue;
    const stack = [[r, (adj.get(r) ?? [])[Symbol.iterator]()]]; color.set(r, 1);
    while (stack.length) {
      const [v, it] = stack.at(-1), next = it.next();
      if (next.done) { color.set(v, 2); stack.pop(); continue; }
      const w = edges[next.value].to, c = color.get(w) ?? 0;
      if (c === 1) back.push(next.value); else if (c === 0) { color.set(w, 1); stack.push([w, (adj.get(w) ?? [])[Symbol.iterator]()]); }
    }
  }
  for (const i of back) if (edges[i].kind !== 'error') edges[i].kind = 'loop';
  const loops = new Set(nodes.filter(n => n.category === 'loop').map(n => n.name));
  const cycles = back.filter(i => !loops.has(edges[i].to) && !loops.has(edges[i].from)).length;
  for (const n of nodes) if (n.ext.has('agent-tool-loop?')) { n.ext.delete('agent-tool-loop?'); if (edges.some(e => e.to === n.name && e.tool)) n.ext.add('agent-tool-loop'); }
  const asyncs = new Set(nodes.flatMap(n => n.async));
  for (const n of nodes) for (const x of n.ext) ext.add(x);
  if (cycles) ext.add('unstructured-cycle');
  if (edges.some(e => e.kind === 'error') || nodes.some(n => n.category === 'error-handler')) ext.add('error-branch');
  if (nodes.some(n => n.category === 'subworkflow')) ext.add('subworkflow-call');
  if (asyncs.has('schedule')) ext.add('schedule-trigger');
  if (asyncs.has('webhook')) ext.add('webhook-trigger');
  if (asyncs.has('event') || asyncs.has('poll')) ext.add('event-trigger');
  const unsupported = [...ext].filter(x => x.startsWith('unsupported:'));
  const exts = [...EXT_ORDER.filter(x => ext.has(x)), ...[...ext].filter(x => !EXT_ORDER.includes(x) && !x.startsWith('unsupported:')).sort()];
  const verdict = !nodes.length ? 'unsupported:empty-graph' : unsupported.length ? unsupported[0] : exts.length ? `via-extension:${exts.join('+')}` : 'native';
  const eff = { read: 0, write: 0, external: 0 }; for (const n of nodes) if (eff[n.effects] !== undefined) eff[n.effects]++;
  return { name: String(wf.name ?? ''), nodes, edges, verdict, extensions: exts,
    features: { nodeCount: nodes.length, edgeCount: edges.length, humanSteps: nodes.filter(n => n.category === 'human').length, effects: eff,
      connectors: [...new Set(nodes.flatMap(n => n.connectors))].sort(), hasCode: nodes.some(n => n.category === 'code'), hasModelCalls: nodes.some(n => n.category === 'model'), cycles } };
}

// ---------------------------------------------------------------------------------------------------- 2. the compile attempt
// Constructs the IR does not have today, with the reason a person reads. Signal waits and keyed state DO exist now
// (docs/ARCHITECTURE.md, E3 steps 1-2), so n8n's wait-for-webhook lowers; its Data Table does not (an external store is not a slot).
export const BLOCKING = Object.freeze({
  'agent-tool-loop': 'An AI agent that picks its own tools in a loop. Foundry runs narrow model judgments with code in control; it has no open tool loop yet (or wraps the agent as one tool).',
  'chat-session': 'A chat trigger keeps a conversation open. Foundry flows take one input and finish; chat sessions are not in the IR.',
  'conversation-state': 'Chat memory carried across messages. Not in the IR (cross-run state slots exist, but not conversation memory).',
  'subworkflow-call': 'Calls another workflow. Calling a workflow by hash ("call", IR stage S1) is not built yet.',
  'error-branch': 'A separate error path (error trigger, error output or stop-and-error). The IR stops or continues on error; it has no error branches yet.',
  'unstructured-cycle': 'A loop made of plain connections. The IR only has bounded loop and map nodes; this needs a rewrite.',
  'external-state-store': 'n8n Data Tables: a store owned by n8n. Not a Foundry state slot.',
  'n8n-code': 'A Code node uses n8n\'s own runtime ($input, $json, items). Foundry code nodes run plain JS/Python in a sandbox without that API; it needs a rewrite.',
  'host-shell': 'Runs a shell command on the n8n host. Refused by design.',
  'n8n-expression': 'Uses an n8n expression beyond a plain field read ($json.field). Expressions are JavaScript; they are not translated.',
  'batch-loop': 'Split-in-batches loop. Detecting its body is not built in this prototype.',
  'community-node': 'A community node package: no published contract to type it.',
  'condition-expression': 'A condition the prototype cannot translate into the IR\'s condition language.',
  'unknown-structure': 'A node this prototype does not map yet.'
});
const SUBNODE_TYPES = new Set(['ai_languageModel', 'ai_memory', 'ai_tool', 'ai_outputParser', 'ai_embedding', 'ai_document', 'ai_textSplitter', 'ai_vectorStore', 'ai_retriever', 'ai_reranker']);
const JSON_PATH = /^=\s*\{\{\s*\$json((?:\.[A-Za-z_][A-Za-z0-9_]*)+)\s*\}\}\s*$/;
const idOf = (name, used) => { let id = (`n_${name}`).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60); let k = id, i = 2; while (used.has(k)) k = `${id}_${i++}`; used.add(k); return k; };

function expressionsIn(value, out = []) {
  if (typeof value === 'string' && value.startsWith('=')) out.push(value);
  else if (Array.isArray(value)) value.forEach(v => expressionsIn(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => expressionsIn(v, out));
  return out;
}
/** Replace plain `={{ $json.a.b }}` values by a reference to the predecessor's output; anything else is a blocking expression. */
function translateArgs(value, root, problems) {
  if (typeof value === 'string' && value.startsWith('=')) {
    const m = value.match(JSON_PATH);
    if (m && root) return { $ref: `${root}${m[1]}` };
    problems.add('n8n-expression'); return null;
  }
  if (Array.isArray(value)) return value.map(v => translateArgs(v, root, problems));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => k !== '__rl' && k !== 'cachedResultName' && k !== 'cachedResultUrl').map(([k, v]) => [k, translateArgs(v, root, problems)]));
  return value;
}

/** Try to compile a normalised n8n flow to IR. Returns { verdict: 'lowered' | 'unsupported', reasons, workflow?, needsCapabilities, hostBindings }. */
export function lower(norm, { id = 'imported-n8n', modelPolicy } = {}) {
  const reasons = new Map(), add = (code, node) => { if (!reasons.has(code)) reasons.set(code, new Set()); reasons.get(code).add(node); };
  const parentOf = new Map(), main = norm.edges.filter(e => e.ctype === 'main' && e.kind === 'data');
  for (const e of norm.edges) if (SUBNODE_TYPES.has(e.ctype)) parentOf.set(e.from, e.to);
  for (const x of norm.extensions) if (BLOCKING[x]) for (const n of norm.nodes.filter(n => n.ext.has(x) || (x === 'subworkflow-call' && n.category === 'subworkflow') || (x === 'error-branch' && n.category === 'error-handler'))) add(x, n.name);
  if (norm.extensions.includes('error-branch') && !reasons.has('error-branch')) add('error-branch', '(error output)');
  if (norm.extensions.includes('unstructured-cycle')) add('unstructured-cycle', '(cycle)');
  const used = new Set(), ids = new Map(), irNodes = [], hostBindings = [], needs = new Map(), sourceModels = [];
  const triggers = norm.nodes.filter(n => n.category === 'trigger');
  let untrustedInput = false;
  for (const t of triggers) {
    const base = t.type.split('.').pop();
    if (t.async.includes('schedule')) hostBindings.push({ node: t.name, binding: 'schedule', note: 'A host scheduler starts each run (not part of the IR).' });
    else if (t.async.includes('webhook')) { untrustedInput = true; hostBindings.push({ node: t.name, binding: base === 'chatTrigger' ? 'chat' : 'webhook', note: 'The host receives the request and passes its body as the run input, labelled untrusted.' }); }
    else if (t.async.includes('event') || t.async.includes('poll')) { untrustedInput = true; hostBindings.push({ node: t.name, binding: 'event', note: `A host adapter for ${t.connectors[0] ?? t.type} delivers each event as the run input.` }); }
    else hostBindings.push({ node: t.name, binding: 'manual', note: 'Started by hand or by an agent with an input object.' });
  }
  // Ids first, so a reference to a predecessor names the id it will really have.
  for (const n of norm.nodes) if (n.category !== 'trigger' && !parentOf.has(n.name)) ids.set(n.name, idOf(n.name, used));
  // The single main-connection predecessor of a node, or 'input' when it is the trigger (n8n's $json is then the trigger's payload).
  const predOf = name => { const p = main.filter(e => e.to === name).map(e => e.from); return p.length !== 1 ? null : triggers.some(t => t.name === p[0]) ? '\u0000input' : p[0]; };
  for (const n of norm.nodes) {
    if (n.category === 'trigger' || parentOf.has(n.name)) continue;      // triggers become the input; sub-nodes configure their parent
    const base = n.type.split('.').pop(), pkg = n.type.slice(0, n.type.lastIndexOf('.'));
    if (base === 'stickyNote' || base === 'noOp') continue;
    if (n.connectors.some(c => c.startsWith('community:'))) { add('community-node', n.name); continue; }
    if (n.category === 'code') { add(base === 'executeCommand' ? 'host-shell' : 'n8n-code', n.name); continue; }
    if (n.category === 'loop') { add('batch-loop', n.name); continue; }
    if (n.category === 'condition') { add('condition-expression', n.name); continue; }
    const id = ids.get(n.name);
    const pred = predOf(n.name), fromInput = pred === '\u0000input', predId = pred && !fromInput ? ids.get(pred) ?? null : null;
    // What $json refers to: the trigger payload (run input), or the predecessor's output; after a wait-for-callback, the callback's payload.
    const predIsSignal = !!pred && !fromInput && !!norm.nodes.find(x => x.name === pred)?.ext.has('signal-resume');
    const root = fromInput ? 'input' : predId ? `nodes.${predId}${predIsSignal ? '.payload' : ''}` : null;
    const problems = new Set();
    if (n.category === 'model') {
      if (base === 'agent' || base === 'agentTool') { if (!reasons.has('agent-tool-loop')) add('agent-tool-loop', n.name); continue; }
      const prompt = n.parameters.text ?? n.parameters.prompt ?? n.parameters.messages ?? null;
      const inputs = [], instructions = typeof prompt === 'string' ? prompt.replace(/^=/, '').replace(/\{\{\s*\$json((?:\.[A-Za-z_][A-Za-z0-9_]*)+)\s*\}\}/g, (_, path) => {
        const name = `field_${inputs.length + 1}`; inputs.push({ name, ref: `${root}${path}`, render: 'text' }); return `<${name}>`; }) : null;
      if (!instructions || /\{\{/.test(instructions) || (inputs.length && !root)) { add('n8n-expression', n.name); continue; }
      // The n8n model (e.g. gpt-4o-mini) is not carried over: model ids come only from the owner policy; class M is the cheap default.
      const sub = norm.nodes.find(s => parentOf.get(s.name) === n.name && s.category === 'model');
      irNodes.push({ id, kind: 'agent', needs: predId ? [predId] : [], description: `${n.name} (imported model step)`, role: 'generate', instructions: instructions.slice(0, 50000),
        ...(inputs.length ? { context: { inputs } } : {}), returns: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', maxLength: 20000 } } },
        model: { class: 'M' } });
      sourceModels.push({ step: n.name, original: sub ? `${sub.type} ${JSON.stringify(sub.parameters?.model?.value ?? sub.parameters?.model ?? '')}` : n.type, mappedTo: 'class M (owner policy)' });
      continue;
    }
    if (n.category === 'human') {
      irNodes.push({ id, kind: 'human', needs: predId ? [predId] : [], description: `${n.name} (imported human step)`, question: `Imported from n8n step “${n.name}”: please review and answer.`,
        answerSchema: { type: 'object', properties: { approved: { type: 'boolean' }, comment: { type: 'string', maxLength: 2000 } }, required: ['approved'], additionalProperties: false } });
      continue;
    }
    if (n.category === 'wait') {
      const amount = Number(n.parameters.amount ?? 1), unit = String(n.parameters.unit ?? 'seconds');
      const ms = Math.round(amount * ({ seconds: 1000, minutes: 60000, hours: 3600000 }[unit] ?? 0));
      if (n.ext.has('signal-resume')) irNodes.push({ id, kind: 'wait', needs: predId ? [predId] : [], description: `${n.name} (waits for a callback)`, signal: `n8n.resume.${id}`.slice(0, 120), schema: { type: 'object' }, timeoutMs: 86400000 });
      else if (ms > 0 && ms <= 3600000) irNodes.push({ id, kind: 'wait', needs: predId ? [predId] : [], description: `${n.name} (pause)`, delayMs: ms });
      else { add('unknown-structure', n.name); }
      continue;
    }
    if (n.category === 'merge') { irNodes.push({ id, kind: 'task', needs: [], join: 'all_resolved', description: `${n.name} (merge)`, tool: 'core.collect', args: { items: [] }, timeoutMs: 10000, retry: { maxAttempts: 1 }, _mergeOf: true }); continue; }
    // A task: a core transformation if one fits exactly, otherwise a connector capability the host must provide (or wrap).
    const args = translateArgs(n.parameters, root, problems);
    if (problems.size) { for (const p of problems) add(p, n.name); continue; }
    const capName = ['n8n', ...(n.connectors[0] ? [n.connectors[0]] : [kebab(base)]), ...(n.opdesc ? [kebab(n.opdesc)] : [])].join('.').replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 120);
    const effects = n.effects === 'read' || n.effects === 'none' ? 'none' : 'non-idempotent';
    if (base === 'respondToWebhook') { irNodes.push({ id, kind: 'task', needs: predId ? [predId] : [], description: `${n.name} (the flow's answer)`, tool: 'core.identity', args: predId ? { result: { $ref: `nodes.${predId}` } } : {}, timeoutMs: 10000, retry: { maxAttempts: 1 } }); continue; }
    needs.set(capName, { name: capName, effects, from: n.type, operation: n.opdesc || null, connector: n.connectors[0] ?? null });
    irNodes.push({ id, kind: 'task', needs: predId ? [predId] : [], description: `${n.name} (${n.type.split('.').pop()}${n.opdesc ? ` ${n.opdesc}` : ''})`, tool: capName, args, timeoutMs: 60000, retry: { maxAttempts: effects === 'none' ? 2 : 1 } });
  }
  // Wire every node to its main-connection predecessors (multi-input nodes: all of them).
  for (const node of irNodes) {
    const name = [...ids].find(([, v]) => v === node.id)?.[0];
    const preds = main.filter(e => e.to === name).map(e => ids.get(e.from)).filter(Boolean);
    node.needs = [...new Set([...node.needs, ...preds])].filter(x => irNodes.some(n => n.id === x));
    if (node._mergeOf) { node.args = { items: node.needs.map(p => ({ $ref: `nodes.${p}` })) }; delete node._mergeOf; }
  }
  const reasonList = [...reasons].map(([code, nodes]) => ({ code, nodes: [...nodes], explanation: BLOCKING[code] }));
  const needsCapabilities = [...needs.values()];
  if (reasonList.length) return { verdict: 'unsupported', reasons: reasonList, needsCapabilities, hostBindings };
  if (!irNodes.length) return { verdict: 'unsupported', reasons: [{ code: 'unknown-structure', nodes: [], explanation: 'Nothing to run after removing triggers and notes.' }], needsCapabilities, hostBindings };
  const last = irNodes.filter(n => !irNodes.some(m => m.needs.includes(n.id)));
  const workflow = {
    schemaVersion: '1.0', id: String(id).replace(/[^A-Za-z0-9_-]/g, '-').replace(/^[^A-Za-z]+/, 'n').slice(0, 64), version: 1,
    title: `Imported from n8n: ${norm.name || 'workflow'}`.slice(0, 200), goal: `Same steps as the n8n workflow “${norm.name}”, re-expressed as a Foundry flow.`, domain: 'general',
    envelope: { assumptions: ['Each connector step needs a host capability with the same behaviour as the n8n node', 'n8n passes lists of items between nodes; each imported step here receives its predecessor\'s whole output'],
      risks: ['Connector behaviour differs from n8n\'s node', 'Item-by-item semantics of n8n are not reproduced'], successCriteria: ['Every imported step completes'],
      unsupported: ['Running the original n8n credentials', 'n8n expressions beyond plain field reads'] },
    // A callback wait may last a day; the budget must exceed it (WAIT_DEADLINE). Hosts still cap runs at their own policy (1 hour by default).
    budget: { maxSteps: Math.max(10, irNodes.length * 3), maxConcurrency: 2, maxDurationMs: irNodes.some(n => n.signal) ? 172800000 : 600000, maxCost: 0 },
    ...(untrustedInput ? { labels: { input: 'untrusted:n8n-trigger' } } : {}),
    nodes: irNodes, acceptance: last.map(n => ({ op: 'exists', value: { $ref: `nodes.${n.id}` } })),
    oracle: { mode: 'none', reason: 'Imported from n8n: the source workflow carries no executable check of success. A person must define the definition of done before this replaces the original.' },
    metadata: { sources: ['n8n workflow JSON'], tags: ['imported:n8n'] }
  };
  const registry = createDefaultRegistry();
  for (const c of needsCapabilities) registry.register({ name: c.name, version: 'stub', implementation: `n8n-import-stub/${c.from}`, description: `Stub contract for n8n ${c.from} ${c.operation ?? ''}: not connected`,
    inputSchema: {}, outputSchema: {}, effects: c.effects, risk: 'low', requiresApproval: c.effects !== 'none', maxTimeoutMs: 60000, cost: 0, cancellation: 'cooperative',
    execute: async () => { throw new FoundryError('NOT_CONNECTED', `${c.name} has no host adapter yet`); } });
  const validation = validateWorkflow(workflow, { registry, modelPolicy: modelPolicy ?? loadPolicy() });
  if (!validation.valid) return { verdict: 'unsupported', reasons: [{ code: 'ir-validation', nodes: validation.errors.map(e => e.path), explanation: `The lowered flow does not validate: ${validation.errors.slice(0, 3).map(e => e.code).join(', ')}` }], needsCapabilities, hostBindings, workflow, validation };
  return { verdict: 'lowered', reasons: [], workflow, workflowHash: digest(workflow), validation: { valid: true, warnings: validation.warnings.map(w => w.code) }, needsCapabilities, hostBindings, sourceModels };
}

// ---------------------------------------------------------------------------------------------------- 3. wrap, don't replace
/** A typed, approval-gated capability contract that calls the existing n8n workflow instead of re-implementing it. */
export function wrap(norm, { slug = 'workflow' } = {}) {
  const webhook = norm.nodes.find(n => n.type.endsWith('.webhook') || n.type.endsWith('.formTrigger'));
  const sub = norm.nodes.find(n => n.type.endsWith('.executeWorkflowTrigger'));
  const chat = norm.nodes.find(n => n.type.endsWith('.chatTrigger'));
  const via = webhook ? 'webhook' : sub ? 'n8n-mcp-execute_workflow' : chat ? 'n8n-chat-webhook' : 'n8n-mcp-execute_workflow';
  const acts = norm.nodes.some(n => n.effects === 'write' || n.effects === 'external') ;
  const fields = sub?.parameters?.workflowInputs?.values ?? [];
  const inputSchema = fields.length ? { type: 'object', additionalProperties: false, required: fields.map(f => f.name).filter(Boolean),
    properties: Object.fromEntries(fields.filter(f => f.name).map(f => [f.name, { type: ['string', 'number', 'boolean', 'array', 'object'].includes(f.type) ? f.type : 'string' }])) }
    : chat ? { type: 'object', additionalProperties: false, required: ['chatInput'], properties: { chatInput: { type: 'string', maxLength: 20000 } } }
    : { type: 'object', description: 'Unknown: n8n does not declare a webhook body schema. Confirm the fields with the flow owner before use.' };
  const descriptor = { name: `n8n.flow.${String(slug).replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 80)}`, version: '1', implementation: `n8n-wrap/${via}`,
    description: `Run the existing n8n workflow “${norm.name}” unchanged (${via}). ${acts ? 'It can act on outside systems, so each call asks a person first.' : 'It only reads or computes.'}`,
    inputSchema, outputSchema: {}, effects: acts ? 'non-idempotent' : 'none', risk: 'low', requiresApproval: acts, maxTimeoutMs: 120000, cost: 0, cancellation: 'cooperative' };
  const registry = createDefaultRegistry();
  registry.register({ ...descriptor, execute: async () => { throw new FoundryError('NOT_CONNECTED', 'Configure the n8n base URL and credential first'); } });
  return { via, descriptor, typedInput: !!fields.length || !!chat, registers: true,
    note: via === 'webhook' ? 'Call the production webhook URL with the input as the JSON body; the respond-to-webhook node is the result.'
      : 'Call it through n8n\'s instance-level MCP server (execute_workflow) after enabling it for MCP; n8n keeps its credentials.' };
}

/** The whole report for one n8n JSON document. */
export function importN8n(json, { id, modelPolicy } = {}) {
  const norm = normalise(json);
  const lowered = lower(norm, { id, modelPolicy });
  return { schema: 'foundry-import-report/1', source: 'n8n', name: norm.name, declaredVerdict: norm.verdict, extensions: norm.extensions, features: norm.features,
    compileVerdict: lowered.verdict, reasons: lowered.reasons, needsCapabilities: lowered.needsCapabilities, hostBindings: lowered.hostBindings, sourceModels: lowered.sourceModels ?? [],
    workflow: lowered.workflow ?? null, workflowHash: lowered.workflowHash ?? null, validation: lowered.validation ?? null, wrap: wrap(norm, { slug: id ?? norm.name }),
    executed: false, qualification: 'Compile-level only: a lowered flow validates as IR; nothing was executed and behaviour equivalence with n8n is not shown.' };
}
