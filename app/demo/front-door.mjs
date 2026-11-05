#!/usr/bin/env node
// The free-form front door in one command, $0 (app/FRONT-DOOR.md):  node app/demo/front-door.mjs   (npm run demo)
//
// It starts the app's MCP server (app/mcp/server.mjs, the same tools a coding agent gets) over an in-process transport, in a fresh
// temporary workspace, and drives it with a SCRIPTED agent: no model is called. The agent reads construction_guide, builds four
// workflows for requests none of the seven examples could do (app/demo/workflows.mjs), proposes each with the person's words, and
// practises each. Then the person turns one on and runs it, and the demo prints the audit. Last, two honest refusals.
//
// The person is a stand-in too, and only ever acts where a person acts: in the client's own dialog (MCP elicitation), which the server
// uses because this demo vouches for its client (the `dialog: true` path the MCP tests use; the CLI asks app/onboarding/detect.mjs
// instead). Every gate is the real one: the turn-on needs a passing practice run of the same hash, the yes goes through
// FoundryApp.decideActivation on the human channel, the send pauses until the person allows it, and the audit re-reads the outbox.
//
//   --keep    keep the workspace and print where it is (default: removed at the end)
//   --json    print one JSON summary line at the end too (the test reads it)
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { FoundryApp } from '../core/service.mjs';
import { serveAppMcp } from '../mcp/server.mjs';
import { runDetail } from '../dashboard/server.mjs';
import { settleResumes } from '../core/human-tasks.mjs';
import { BUILDS, REFUSALS, reconciliation } from './workflows.mjs';

const args = new Set(process.argv.slice(2));
const out = [];
const print = (line = '') => { out.push(line); process.stdout.write(`${line}\n`); };
const indent = (text, pad = '      ') => String(text).split('\n').map(l => `${pad}${l}`).join('\n');
const rule = title => { print(''); print(`== ${title} ${'='.repeat(Math.max(3, 74 - title.length))}`); };
const kinds = w => { const n = {}; const walk = f => { for (const x of f.nodes) { n[x.kind] = (n[x.kind] ?? 0) + 1; if (x.body) walk(x.body); } }; walk(w); return Object.entries(n).map(([k, v]) => `${v} ${k}`).join(', '); };

export async function runDemo() {
  const workspace = mkdtempSync(path.join(tmpdir(), 'foundry-front-door-'));
  const app = new FoundryApp({ workspace });
  const summary = { workspace, built: [], refused: [], live: null };
  // The person, at the client's dialog: reads what Foundry shows them and says yes. Every dialog is printed in full.
  const dialogs = [];
  const person = async request => {
    dialogs.push(request.params.message);
    print('    ┌ The client shows the PERSON this dialog (the agent sees only the outcome):');
    print(indent(request.params.message, '    │ '));
    const first = Object.keys(request.params.requestedSchema?.properties ?? {})[0];
    print('    └ The person chooses: approve');
    return { action: 'accept', content: first === 'decision' ? { decision: 'approve' } : { answer: true } };
  };
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await serveAppMcp(app, { transport: serverSide, dialog: true });
  const client = new Client({ name: 'front-door-demo-agent (scripted, no model)', version: '1' }, { capabilities: { elicitation: { form: {} } } });
  client.setRequestHandler(ElicitRequestSchema, person);
  await client.connect(clientSide);
  const call = async (name, a = {}) => { const r = await client.callTool({ name, arguments: a }); return JSON.parse(r.content[0].text); };
  try {
    print('Workflow Foundry: the free-form front door (a $0 demo: scripted agent, stand-in person, no model, nothing leaves this computer)');
    print(`Workspace: ${args.has('--keep') ? workspace : 'a temporary folder (removed at the end; --keep keeps it)'}`);

    rule('1. The agent reads the construction guide');
    const guide = await call('construction_guide');
    print(`  ${guide.say}`);
    print(`  Capabilities: ${guide.capabilities.map(c => c.name).join(', ')}`);
    print(`  Outside effects (each needs a target in the person's words or data, and an independent check): ${guide.capabilities.filter(c => c.outsideEffect).map(c => `${c.name}${c.asksThePersonFirst ? ' (asks the person first)' : ''}`).join(', ')}`);
    print(`  Worked examples it can learn from (not a menu): ${guide.exemplars.map(e => e.name.replace(/^exemplars\//, '')).join(', ')}`);

    rule('2. Four requests none of the seven examples could do');
    const proposals = [];
    for (const [i, b] of BUILDS.entries()) {
      print('');
      print(`  [${i + 1}] ${b.name}`);
      print(`      The person: "${b.request}"`);
      print(`      Why no example fits: ${b.whyNotACard}`);
      print(`      The agent builds a typed workflow: ${b.workflow.id}, ${kinds(b.workflow)}; ${b.practiceInput.length} practice case(s)`);
      const p = await call('propose_flow', { request: b.request, workflow: b.workflow, practiceInput: b.practiceInput });
      print(`      propose_flow -> ${p.status}: ${p.say}`);
      if (p.status !== 'proposed') { summary.built.push({ flowId: b.workflow.id, status: p.status }); continue; }
      for (const a of p.outsideActions) print(`        outside action: ${a.does} -> ${a.to} (${a.source}${a.asksFirst ? '; asks the person first' : ''})`);
      const d = await call('dry_run', { proposalId: p.proposalId });
      print(`      dry_run -> ${d.passed ? 'PASSED' : 'did not pass'}: ${d.headline}`);
      for (const c of d.cases ?? []) print(`        practice case "${c.name}": ${c.passed ? 'passed' : `did not pass (${c.status})`}${c.inputGenerated ? ' (input made by Foundry from the schema)' : ''}`);
      for (const s of d.standInAnswers ?? []) print(`        stand-in answer at "${s.step}" (${s.case}): ${JSON.stringify(s.answer)}`);
      for (const w of d.wouldDo ?? []) print(`        would ${w.action} -> ${w.to}${w.case ? ` [${w.case}]` : ''}: ${w.preview.split('\n').filter(Boolean).slice(0, 2).join(' / ').slice(0, 110)}`);
      summary.built.push({ flowId: p.flowId, status: p.status, passed: d.passed, wouldDo: d.wouldDo.length, digest: d.wouldDoDigest });
      proposals.push({ b, p, d });
    }

    rule('3. The person turns one on, it runs on their data, and the send waits for them');
    const { p } = proposals.find(x => x.b === reconciliation);
    print(`  The agent asks the person to turn on "${p.summary.title}" (version ${p.version}, ${p.workflowHash.slice(0, 12)}).`);
    const on = await call('ask_person_to_turn_on', { proposalId: p.proposalId });
    print(`  ask_person_to_turn_on -> ${on.status}: ${on.say}`);
    // The person's own bank and ledger exports, in the workspace (what the site's drop zone would write).
    mkdirSync(path.join(app.worldDir, 'sheets'), { recursive: true });
    for (const [name, rows] of Object.entries(reconciliation.liveSheets)) writeFileSync(path.join(app.worldDir, 'sheets', `${name}.json`), JSON.stringify(rows, null, 2));
    print(`  The person's data: bank (${reconciliation.liveSheets.bank.length} rows), ledger (${reconciliation.liveSheets.ledger.length} rows).`);
    const run = await call('run_flow', { flowId: p.flowId, input: {} });
    print(`  run_flow -> ${run.status}: ${run.say}`);
    const waiting = await call('list_waiting');
    print(`  list_waiting -> ${waiting.say}`);
    let finalRun = run;
    for (const t of waiting.tasks) {
      const a = await call('answer_waiting', { taskId: t.taskId });
      print(`  answer_waiting -> ${a.status}: ${a.say}`);
    }
    await settleResumes(app);
    finalRun = await call('flow_status', { runId: run.runId });
    print(`  flow_status -> ${finalRun.status}: ${finalRun.say}`);

    rule('4. The audit');
    const detail = runDetail(app, app.storeFile, run.runId);
    print(`  Run ${run.runId}: ${detail.status}; ${detail.chain.events} events, hash chain ${detail.chain.verified ? 'verified' : `NOT verified (${detail.chain.reason})`}.`);
    for (const c of detail.checks) print(`    ${c.passed ? '✓' : '✗'} ${c.plain ?? c.exact}`);
    const outbox = readdirSync(app.outboxDir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(path.join(app.outboxDir, f), 'utf8')));
    for (const m of outbox) { print(`  Outbox (the e-mail stand-in): to ${m.to}, "${m.subject}", sha256 ${m.sha256.slice(0, 16)}…`); print(indent(m.body.trim(), '    | ')); }
    for (const a of app.ledger.forFlow(p.flowId)) print(`  Turned on: version hash ${a.workflowHash.slice(0, 12)}, by ${a.channel}, after practice run record ${a.dryRunId.slice(0, 8)}; status ${a.status}.`);
    const decided = detail.timeline.filter(e => e.type === 'approval.decided');
    for (const e of decided) print(`  Outside action decided at event ${e.seq} of the chain: ${e.approved ? 'allowed' : 'refused'} by the person (approval ${String(e.approvalId).slice(0, 12)}…).`);
    summary.live = { runId: run.runId, status: detail.status, chainVerified: detail.chain.verified, checks: detail.checks.map(c => c.passed), outbox: outbox.map(m => m.to), approvals: decided.length };

    rule('5. Two honest refusals');
    for (const r of REFUSALS) {
      print(`  ${r.name}`);
      print(`      The person: "${r.request}"`);
      const x = await call('propose_flow', { request: r.request, workflow: r.workflow, ...(r.practiceInput ? { practiceInput: r.practiceInput } : {}) });
      print(`      propose_flow -> ${x.status}: ${x.say}`);
      for (const b of x.blockers ?? []) print(`        blocker ${b.code}`);
      summary.refused.push({ status: x.status, codes: (x.blockers ?? []).map(b => b.code) });
    }
    const listed = await call('list_flows');
    print(`  list_flows -> ${listed.say} (the refusals created nothing)`);
    summary.flows = listed.flows.length; summary.drafts = listed.proposals.length; summary.dialogs = dialogs.length;
    print('');
    print(`Done: ${summary.built.filter(x => x.passed).length} of ${BUILDS.length} free-form workflows passed practice, 1 turned on by the person and run (${summary.live.status}), ${summary.refused.length} refused by name. $0, no model.`);
    if (args.has('--json')) print(`DEMO_SUMMARY ${JSON.stringify(summary)}`);
    return summary;
  } finally {
    await client.close();
    await app.close();
    if (!args.has('--keep')) rmSync(workspace, { recursive: true, force: true });
  }
}

runDemo().catch(error => { process.stderr.write(`The demo failed: ${error.stack ?? error}\n`); process.exitCode = 1; });
