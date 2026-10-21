// The one-page brief for IT and security (SPEC §9.11), generated on this computer from the automation's own typed record: the
// workflow version and hash, every step and its effect class, the template's promises, the practice record, who decides, the record
// and how to check it, the honest same-user limit, suggested pilot terms and the exact allowlist entry. Markdown and HTML (every
// value escaped). Nothing is sent anywhere; the person downloads it and hands it over.
import { describeWorkflow } from '../core/explain.mjs';
import { templateOf, slotsOf, builderOf, promises } from '../core/library.mjs';
import { loadSettings } from './settings.mjs';

export const SAME_USER_LIMIT = 'A coding agent that can run commands as you on this computer could do what you can do, including approve. Foundry\'s link key and checks keep out other web pages and other users, not that agent. What closes this gap: Foundry running as a separate user, approvals on a second device, or the hosted Team plan (all planned).';
export const PILOT_TERMS = ['Practice-only mode on (nothing can run for real on the pilot machines)', 'No AI builder, or only the provider you approve; Mercury off',
  'Linux or macOS developer machines', '30 days', 'Allowlist the exact command below, not the name'];
export const GAPS = ['Your decisions (turn-on and each send) are recorded beside the run record, not yet inside its hash chain',
  'AI transcripts, when an AI builder is used, are not part of the chain', 'The chain\'s latest link is not stored outside this computer unless you export it',
  'Approvals come from the person at this computer; a second person\'s own sign-in is planned (Team plan)'];

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
    willNotDo: template && values ? promises(template, values).willNotDo : summary.notSupported };
}

/** The brief as structured sections (rendered to Markdown and HTML below). flowId may be null: a general brief. */
export function briefData(app, { flowId = null, connect, date = new Date() }) {
  const facts = flowId ? flowFacts(app, flowId) : null;
  const settings = loadSettings(app.root);
  const argv = [connect.cursorJson.mcpServers.foundry.command, ...connect.cursorJson.mcpServers.foundry.args];
  const sections = [];
  sections.push({ title: 'What Foundry is', lines: ['A local program that builds small automations from fixed, reviewed templates, tests each version on pretend data, and runs a version only after a person turns it on. Each outside action (an e-mail, a chat post) asks the person first.',
    'It runs on this computer only. The page listens on 127.0.0.1. There is no account, no hosted service and no telemetry.'] });
  if (facts) {
    sections.push({ title: 'This automation', table: [['Title', facts.workflow.title], ['Version', String(facts.workflow.version)], ['Workflow hash (sha256)', facts.hash],
      ['Made from template', facts.template?.id ?? 'none'], ['Built by', facts.builder ?? 'unknown'], ['Uses AI', /model|mercury|haiku/i.test(facts.builder ?? '') ? 'yes (building only)' : 'no'],
      ['Turned on', facts.active ? 'yes' : 'no']] });
    sections.push({ title: 'Every action', table: [['Step', 'Effect', 'Asks a person first'], ...facts.summary.steps.map(s => [s.text, s.effect, s.asksFirst ? 'yes' : 'no'])], header: true });
    sections.push({ title: 'What it never does', lines: facts.willNotDo });
    const data = facts.template?.data ?? {};
    sections.push({ title: 'Data', lines: [...Object.entries(data).map(([k, v]) => `Reads or writes the "${k}" sheet on this computer: ${v}`),
      'Writes drafts (e-mail files) to the workspace outbox after the person approves each one; nothing is sent by Foundry.', 'Leaves this computer: nothing.'] });
    const decided = facts.approvals.find(a => a.status === 'approved');
    sections.push({ title: 'Who decides', lines: [decided ? `Turned on by the person at this computer through ${decided.channel} on ${new Date(decided.decidedAt).toISOString()}${decided.note ? ` (note: ${decided.note})` : ''}.` : 'Not turned on yet.',
      'Every outside action asks the person again before it happens. A second person\'s own sign-in is planned (Team plan), not available.'] });
    sections.push({ title: 'Test evidence', lines: facts.dry ? [`Practice run ${facts.dry.passed ? 'passed' : 'did not pass'} on ${facts.dry.body.dataSource === 'your-data' ? 'the person\'s own list' : 'the template\'s pretend data'} (${new Date(facts.dry.at).toISOString()}), bound to this hash.`,
      ...facts.dry.body.checks.map(c => `${c.passed ? 'PASS' : c.passed === false ? 'FAIL' : 'not run'}: ${c.plain ?? c.exact}`)] : ['No practice run of this version yet.'] });
  }
  sections.push({ title: 'Records and how to check them', lines: ['Each run keeps a hash-chained event record in the workspace store; Foundry re-verifies every link when the run is opened, and the evidence download includes the chain head.',
    ...GAPS.map(g => `Known gap: ${g}.`)] });
  sections.push({ title: 'The honest limit', lines: [SAME_USER_LIMIT] });
  sections.push({ title: 'Suggested pilot terms', lines: PILOT_TERMS, note: `Practice-only mode on this computer right now: ${settings.mode === 'practice-only' ? 'yes' : 'no'}.` });
  sections.push({ title: 'Allowlist entry (exact)', code: JSON.stringify({ allowedMcpServers: [{ serverCommand: argv }] }, null, 2),
    lines: ['Claude Code matches every argument in order; a server name is not a security control (code.claude.com/docs/en/managed-mcp, read 2026-10-21).',
      'The command contains this computer\'s paths, so generate the brief on the machine you allowlist.'] });
  sections.push({ title: 'Questions to ask Foundry\'s owner', lines: ['Which build is this (commit), and how will you sign and pin builds?', 'When will approvals by an identity the agent cannot hold be available?',
    'Can the record\'s latest link be anchored outside the user\'s control?', 'Is there a stop-everything switch and automatic removal of leavers?', 'Which AI providers can the builder use, and what do they receive?'] });
  return { title: facts ? `IT brief: ${facts.workflow.title}` : 'IT brief: Foundry', generated: date.toISOString(), header: `Generated on this computer on ${date.toISOString().slice(0, 10)}. Not sent anywhere.`,
    flowId: facts ? flowId : null, workflowHash: facts?.hash ?? null, serverCommand: argv, sections };
}

const mdCell = s => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
export function briefMarkdown(b) {
  const out = [`# ${b.title}`, '', `_${b.header}_`, ''];
  for (const s of b.sections) {
    out.push(`## ${s.title}`, '');
    if (s.table) { const [head, ...rows] = s.header ? s.table : [['Item', 'Value'], ...s.table]; out.push(`| ${head.map(mdCell).join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.map(mdCell).join(' | ')} |`), ''); }
    if (s.code) out.push('```json', s.code, '```', '');
    for (const l of s.lines ?? []) out.push(`- ${l}`);
    if (s.note) out.push('', s.note);
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
