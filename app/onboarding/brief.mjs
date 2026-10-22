// The one-page brief for IT and security (SPEC §9.11), generated on this computer from the automation's own typed record: which build
// this is, the workflow version and hash, every step (inside each "for each" too) and what it does outside a computation, the card's
// promises, the practice record, who decided, what data is kept and where, what leaves the computer, the honest same-user limit, pilot
// terms with checks and exit criteria, how to remove Foundry, and the exact allowlist entry. Markdown and HTML (every value escaped).
// Nothing is sent anywhere; the person downloads it and hands it over.
//
// Since the P4 and P5 walkthroughs: "Uses AI" comes from the builder record, not from matching words in its name (B1); steps inside a
// map are listed (B2: the customer e-mails were missing); what leaves the computer through a coding agent is stated (B3); the build,
// data kept, removal, pilot checks and the agent's tools are in the brief rather than left as questions (M4, M5, M10, M12-M14).
import { describeWorkflow } from '../core/explain.mjs';
import { templateOf, slotsOf, builderOf, loadLibrary } from '../core/library.mjs';
import { loadSettings } from './settings.mjs';
import { cardPromises } from './card-text.mjs';
import { buildInfo } from './build-info.mjs';
import { FORMS } from './suggest.mjs';

export const SAME_USER_LIMIT = 'A coding agent that can run commands as you on this computer could do what you can do, including approve. Foundry\'s link key and checks keep out other web pages and other users, not that agent. What closes this gap: Foundry running as a separate user, approvals on a second device, or the hosted Team plan (all planned).';
export const PILOT_TERMS = [
  'Practice-only mode for every Foundry folder on the pilot machines: put {"mode": "practice-only", "allowedAI": "none"} in /etc/foundry/policy.json (owned by root, not writable by others). The page then shows it as set by your organisation, with no off switch',
  'No AI builder (Allowed AI: none), or only the provider you approve',
  'Linux developer machines (macOS and Windows are untested)',
  '30 days',
  'Allowlist the exact command below, not the name, with Foundry installed in a folder only root can change',
  'In Claude Code\'s managed settings, set allowManagedHooksOnly to true, so no hook on the machine can answer Foundry\'s dialog for the person'];
export const PILOT_CHECKS = ['Check a machine at any time: node <install>/app/cli.mjs doctor --json prints the mode, allowed AI, build and workspace (no secrets)',
  'At day 30: live runs 0 (practice-only held), automations made and tested, AI used none. Each run and each decision is in the workspace records'];
export const GAPS = ['Your decisions (turn-on and the list you approved) are kept in their own chained log beside the run record, not inside the run\'s chain; anyone using this account could rewrite both',
  'AI transcripts, when an AI builder is used, are not part of the chain', 'The chain\'s latest link is not stored outside this computer unless you copy it somewhere else',
  'Approvals come from the person at this computer; a second person\'s own sign-in is planned (Team plan)',
  // Security review 2026-10-21, M4: the record names who decided as Foundry knows them, which is not a verified identity.
  'A decision names the person by the name in Settings and this computer\'s account. A yes through the page shows that a browser tab this Foundry start let in sent it, not which person clicked; approving with a passkey on each yes is planned'];
// M4: the channel as it is, not as a person.
export const CHANNEL_WORDS = { dashboard: 'the Foundry page (a browser tab this start of Foundry let in; not tied to a particular person)', cli: 'a typed yes in a terminal of this account',
  'mcp-elicitation': 'the coding agent\'s dialog (weaker: Foundry looked for hooks that could answer it, but a hook it cannot see could still answer)' };
/** Did a model build this? From the builder record: the form builder and the stub call none. */
export const usesModel = builderId => !!builderId && !/^template-form\/|^stub-template-matcher\//.test(builderId);

// What a tool does outside a computation, in words IT can check against the code (app/core/stand-ins.mjs, capabilities.mjs).
const EFFECT = {
  'outbox.send': 'writes an e-mail draft on this computer; the person sends it from their own mail app',
  'chat.post': 'writes a chat message on this computer; the person pastes it into the channel',
  'sheet.append': 'adds rows to a list on this computer',
  'core.artifact': 'saves a file on this computer',
  'sheet.read': 'reads a list on this computer'
};
function steps(workflow, registry) {
  const rows = [];
  const walk = (nodes, prefix) => {
    for (const n of nodes) {
      const cap = n.tool ? registry?.get(n.tool) : null;
      const asks = !!cap && (cap.requiresApproval || cap.risk === 'high');
      const effect = EFFECT[n.tool] ?? (n.kind === 'verify' ? 'checks only (re-reads what was written)' : n.kind === 'map' ? 'repeats the steps below for each one' : n.kind === 'state' ? 'remembers what earlier runs did (on this computer)' : 'computes only');
      rows.push([`${prefix}${n.description}`, effect, asks ? 'yes: the person sees the full list of what a run would make and approves it once (or each one, in the terminal)' : 'no']);
      if (n.body?.nodes) walk(n.body.nodes, `${prefix}For each one: `);
    }
  };
  walk(workflow.nodes, '');
  return rows;
}

function flowFacts(app, flowId) {
  let head; try { head = app.foundry.store.workflow(flowId); } catch { head = null; }
  const proposals = app.foundry.store.proposals().filter(p => p.workflow.id === flowId);
  const draft = !head ? proposals.find(p => p.status === 'proposed') : null;
  const workflow = head?.workflow ?? draft?.workflow ?? null;
  if (!workflow) return null;
  const hash = head?.hash ?? draft.workflowHash;
  const summary = describeWorkflow(workflow, app.registry), template = templateOf(workflow);
  const proposal = proposals.find(p => p.workflowHash === hash) ?? null;
  const dry = proposal ? app.ledger.latestDryRun(proposal.id) : null;
  const approvals = app.ledger.forFlow(flowId).filter(a => a.workflowHash === hash);
  const values = slotsOf(workflow);
  return { workflow, hash, summary, template, values, builder: builderOf(workflow), dry, approvals, active: !!app.ledger.approvedFor(flowId, hash),
    willNotDo: template && values ? cardPromises(template, values).willNotDo : summary.notSupported };
}

const MCP_TOOLS = [['list_templates', 'yes', 'no'], ['propose_flow', 'no (writes a draft version; nothing runs)', 'no'], ['explain_flow', 'yes', 'no'], ['dry_run', 'no (a test on pretend data, in a separate practice folder)', 'no'],
  ['ask_person_to_turn_on', 'no', 'always: it asks the person (dialog or page); the agent cannot answer it through Foundry'], ['run_flow', 'no', 'yes: the person approves the exact list in the page first'],
  ['flow_status', 'yes', 'no'], ['list_flows', 'yes', 'no']];

/** The brief as structured sections (rendered to Markdown and HTML below). flowId may be null: a general brief. */
export function briefData(app, { flowId = null, connect, date = new Date() }) {
  const facts = flowId ? flowFacts(app, flowId) : null;
  const settings = loadSettings(app.root);
  const build = buildInfo();
  const argv = [connect.cursorJson.mcpServers.foundry.command, ...connect.cursorJson.mcpServers.foundry.args];
  const sections = [];
  sections.push({ title: 'What Foundry is', lines: ['A local program that builds small automations from fixed, reviewed templates, tests each version on pretend data, and runs a version only after a person turns it on. Before a run makes anything, the person sees every item in full (e-mails as drafts they send themselves) and approves that exact list.',
    'It runs on this computer only. The page listens on 127.0.0.1. There is no account, no hosted service and no telemetry.'] });
  sections.push({ title: 'Build', table: [['Package', `${build.name} ${build.version ?? ''}`.trim()], ['Commit', build.commit ? `${build.commit}${build.changedSinceCommit ? ' (app/ or src/ changed since this commit)' : ''}` : 'not a git checkout'],
    ['Files (sha256 over app/ and src/)', `${build.tree.sha256} (${build.tree.files} files)`], ['Node', build.node], ['Runtime dependencies (exact)', Object.entries(build.dependencies).map(([n, v]) => `${n} ${v}`).join(', ') || 'none'],
    ['Licence', build.licenceNote], ['Installed at', build.installedAt], ['Contact', 'the person who gave you this copy']] });
  if (facts) {
    const ai = usesModel(facts.builder);
    sections.push({ title: 'This automation', table: [['Title', facts.workflow.title], ['Version', String(facts.workflow.version)], ['Workflow hash (sha256)', facts.hash],
      ['Made from template', facts.template?.id ?? 'none'], ['Built by', facts.builder ?? 'unknown'], ['Uses AI', ai ? `yes, to build it (${facts.builder})` : 'no (settings filled from a fixed form; no model was called)'],
      ['Turned on', facts.active ? 'yes' : 'no']] });
    sections.push({ title: 'Every action', table: [['Step', 'What it does', 'Asks a person first'], ...steps(facts.workflow, app.registry)], header: true });
    sections.push({ title: 'What it never does', lines: facts.willNotDo });
    const data = facts.template?.data ?? {};
    sections.push({ title: 'Data', lines: [...Object.entries(data).map(([k, v]) => `Reads or writes the "${k}" list on this computer: ${v}`),
      'Writes e-mail drafts to the workspace outbox after the person approves the exact list; the person sends them. Foundry sends nothing over the network.'] });
    const decided = facts.approvals.find(a => a.status === 'approved');
    sections.push({ title: 'Who decides', lines: [decided ? `Turned on by ${decided.principal} (the name in Settings and this computer's account; not a verified identity) through ${CHANNEL_WORDS[decided.channel] ?? decided.channel} on ${new Date(decided.decidedAt).toISOString()}${decided.note ? ` (note: ${decided.note})` : ''}.` : 'Not turned on yet.',
      'Before each run makes anything, the person sees the full list and approves it once; anything not on that list stops and asks. A second person\'s own sign-in is planned (Team plan), not available.'] });
    sections.push({ title: 'Test evidence', lines: facts.dry ? [`Practice run ${facts.dry.passed ? 'passed' : 'did not pass'} on ${facts.dry.body.dataSource === 'your-data' ? 'the person\'s own list' : 'the template\'s pretend data'} (${new Date(facts.dry.at).toISOString()}), bound to this hash.`,
      ...facts.dry.body.checks.map(c => `${c.passed ? 'PASS' : c.passed === false ? 'FAIL' : 'not run'}: ${c.plain ?? c.exact}`)] : ['No practice run of this version yet.'] });
  } else {
    sections.push({ title: 'What a coding agent can call', table: [['Tool', 'Read-only', 'Needs the person'], ...MCP_TOOLS], header: true,
      note: 'These are all of Foundry\'s tools. None of them approves on the person\'s behalf.' });
    const library = loadLibrary();
    sections.push({ title: 'What each card can do', table: [['Card', 'Reads (on this computer)', 'Makes'], ...FORMS.order.map(id => library.find(t => t.id === id)).filter(Boolean).map(t => {
      const tools = new Set(); const walk = ns => { for (const n of ns) { if (n.tool) tools.add(n.tool); if (n.body?.nodes) walk(n.body.nodes); } }; walk(t.workflow.nodes);
      return [FORMS.templates[t.id].card, Object.keys(t.data ?? {}).join(', '), [...tools].filter(x => EFFECT[x] && x !== 'sheet.read').map(x => EFFECT[x].split(';')[0]).join('; ') || 'nothing outside a computation'];
    })], header: true });
  }
  sections.push({ title: 'What leaves this computer', lines: [
    'Foundry itself sends nothing over the network: e-mails are drafts the person sends, chat messages are drafts they paste.',
    'Through a coding agent: what Foundry\'s tools return goes to that agent\'s AI provider under the person\'s agreement with them. Foundry returns counts, step names and practice results; a live list is shown in the browser, and the agent sees only how many items it has.',
    `AI builders: Mercury (Inception) only if Allowed AI says so and a key is saved; Claude Haiku (Anthropic) only if Foundry is started with --builder haiku and Allowed AI says so. Allowed AI here: ${settings.allowedAI}${settings.managed?.allowedAI ? ' (set by your organisation)' : ''}.`] });
  sections.push({ title: 'Data kept, and how to delete it', lines: [
    'Lists the person gives (only the columns a card needs): <workspace>/world/sheets, with every replaced list kept in .history until deleted. Settings has "Delete my lists".',
    'Drafts: <workspace>/outbox, until deleted. Run records and decisions: <workspace>/live and <workspace>/site, kept until the folder is deleted.',
    'Not encrypted by Foundry; it relies on the computer\'s disk encryption. Files are readable by this OS user only (folders 0700, files 0600).'] });
  sections.push({ title: 'Records and how to check them', lines: ['Each run keeps a hash-chained event record in the workspace store; Foundry re-checks every link when the run is opened, and the evidence download includes the chain head and a way to check it (node app/cli.mjs check-evidence FILE).',
    ...GAPS.map(g => `Known gap: ${g}.`)] });
  sections.push({ title: 'The honest limit', lines: [SAME_USER_LIMIT] });
  sections.push({ title: 'Suggested pilot terms', lines: [...PILOT_TERMS, ...PILOT_CHECKS],
    note: `Practice-only mode for this Foundry folder right now: ${settings.mode === 'practice-only' ? `yes${settings.managed?.mode ? ' (set by your organisation)' : ' (set in this folder only; it can be switched off in Settings)'}` : 'no'}.` });
  sections.push({ title: 'Allowlist entry (exact)', code: JSON.stringify({ allowedMcpServers: [{ serverCommand: argv }] }, null, 2),
    lines: ['Claude Code matches every argument in order; a server name is not a security control (code.claude.com/docs/en/managed-mcp, read 2026-10-21).',
      'This entry decides which command may start. It does not check Foundry\'s files, which the user can edit, or variables such as NODE_OPTIONS that change what node loads. Install Foundry in a folder only root can change (for example /opt/foundry/<commit>) and allowlist that path; to set the environment as well, use a managed-mcp entry instead.',
      argv.includes('--workspace') ? 'The command names this person\'s Foundry folder. With the default folder (~/.foundry) it leaves --workspace out, so one entry fits every machine with the same install path.' : 'The command uses each person\'s default Foundry folder, so one entry fits every machine with the same install path.'] });
  sections.push({ title: 'Removing Foundry', lines: ['claude mcp remove foundry (for Cursor or Codex, delete the foundry entry from the agent\'s MCP settings)',
    'An AI key, if one was saved: Settings, AI keys, Remove the key (it lives in the keychain only)', 'Everything Foundry kept: delete the Foundry folder (<workspace>)',
    'There is no background service, auto-update or schedule: stopping the process stops Foundry.'] });
  sections.push({ title: 'Still open', lines: ['Approvals by an identity the agent cannot hold: planned (Team plan), no date set.', 'Anchoring the record\'s latest link outside the user\'s control: planned, no date set.',
    'A stop-everything switch and automatic removal of leavers: not decided.', 'Signed, pinned builds: planned for when Foundry is published; nothing is published now.'] });
  return { title: facts ? `IT brief: ${facts.workflow.title}` : 'IT brief: Foundry', generated: date.toISOString(), header: `Generated on this computer on ${date.toISOString().slice(0, 10)}. Not sent anywhere.`,
    flowId: facts ? flowId : null, workflowHash: facts?.hash ?? null, serverCommand: argv, build, sections };
}

// Markdown (security review 2026-10-21, L13): every value is text. Characters that start HTML, a link, an autolink or a code span are
// backslash-escaped (CommonMark renders `\<` as `<`), a line break inside a value becomes a space (no value starts a new block), and the
// code block's fence is longer than any run of backticks inside it.
const mdText = s => String(s).replace(/\r\n|\r|\n/g, ' ').replace(/[\\`<>[\]]/g, c => `\\${c}`);
const mdCell = s => mdText(s).replace(/\|/g, '\\|');
const fence = code => '`'.repeat(Math.max(3, ...[...String(code).matchAll(/`+/g)].map(m => m[0].length + 1)));
export function briefMarkdown(b) {
  const out = [`# ${mdText(b.title)}`, '', `_${mdText(b.header)}_`, ''];
  for (const s of b.sections) {
    out.push(`## ${mdText(s.title)}`, '');
    if (s.table) { const [head, ...rows] = s.header ? s.table : [['Item', 'Value'], ...s.table]; out.push(`| ${head.map(mdCell).join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.map(mdCell).join(' | ')} |`), ''); }
    if (s.code) { const f = fence(s.code); out.push(`${f}json`, s.code, f, ''); }
    for (const l of s.lines ?? []) out.push(`- ${mdText(l)}`);
    if (s.note) out.push('', mdText(s.note));
    out.push('');
  }
  return out.join('\n');
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function briefHtml(b) {
  const body = b.sections.map(s => {
    const table = s.table ? (() => { const [head, ...rows] = s.header ? s.table : [['Item', 'Value'], ...s.table];
      return `<table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`; })() : '';
    return `<section><h2>${esc(s.title)}</h2>${table}${s.code ? `<pre>${esc(s.code)}</pre>` : ''}${s.lines?.length ? `<ul>${s.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}${s.note ? `<p>${esc(s.note)}</p>` : ''}</section>`;
  }).join('\n');
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${esc(b.title)}</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>\n<body><h1>${esc(b.title)}</h1><p><em>${esc(b.header)}</em></p>\n${body}\n</body></html>\n`;
}
