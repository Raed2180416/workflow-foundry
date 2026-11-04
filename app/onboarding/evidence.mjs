// The evidence bundle for one run (SPEC §7.4 P5): what an auditor needs from this computer alone. It is assembled from the records,
// never from memory: the run's hash-chained events re-verified on read (chain head included), the exact workflow version (by hash),
// the turn-on decision with who made it and through which channel, the practice run it rests on, each action decision from the chain
// (and, for an approved list, which item of the list it applied), the list itself in full (every item's digest), who started the run,
// the person's decisions from their own chained log, lists they declined, drafts they marked as sent, the "Who decides what" version
// in force, which Foundry build made it, and the known gaps, stated. Times are ISO 8601 UTC, except inside `events`, which are kept
// exactly as recorded (milliseconds since 1970) so their hashes can be checked.
//
// Since the security review of 2026-10-21 (schema foundry-evidence/3):
//   M4   who started a run is said as Foundry knows it: the yes came through the page (a tab with this start's key), under the name in
//        Settings; nothing in it is a verified identity (identityVerified: false, and howKnown per channel).
//   L9   the file carries every line of the decision log as a link ({ seq, prev, hash }; the full text only for this automation's lines),
//        and checkEvidence() checks what its message says: each event and each decision line hashes as recorded and names the one
//        before, the last event is the stated chain head, the workflow body hashes to the version's hash, and a file with no events,
//        no head or no body is not "consistent".
//   L10  the file says what it holds: every run event in full, which includes the person's customer list and the full text of every
//        e-mail the run wrote (the events must stay whole for their hashes to check).
//
// Since the honesty review of 2026-10-21 (B1, schema foundry-evidence/4): the "who decided" sections are no longer taken on trust.
//   - Every decision-log line written now commits to its automation and content in its link (decisions.mjs, v2), so the file carries
//     every line as a checkable link, this automation's lines in full, and checkEvidence() finds a line of this automation left out.
//   - turnedOn, ledger, batch (the list, its decision and its fingerprint), run.startedBy, actionDecisions, declinedLists,
//     draftsMarkedSent and which practice run are each checked against the hashed lines and events they come from. The list carries each
//     item's text, so its fingerprint, the person's yes and the run's paused action can be tied together.
//   - checked.sections and checked.notChecked name exactly what was and was not checked; the CLI prints both.
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { readStore } from '../dashboard/server.mjs';
import { explainRun } from '../core/explain.mjs';
import { canonical } from '../../src/data.mjs';
import { GAPS, CHANNEL_WORDS } from './brief.mjs';
import { buildInfo } from './build-info.mjs';
import { DecisionLog, HOW_KNOWN, LINK_V, linkHash, lineHashes } from './decisions.mjs';
import { sentMarks, listDrafts } from './drafts.mjs';
import { AuthorityMaps } from './authority-map.mjs';

const iso = t => (t === null || t === undefined ? null : new Date(t).toISOString());
const sha = s => createHash('sha256').update(s).digest('hex');

export function evidenceBundle(app, runId, { batches = null, date = new Date() } = {}) {
  const raw = readStore(app.storeFile, r => {
    const h = r.header(runId), chain = r.events(runId, { header: h }), wf = r.workflow(h.workflowHash);
    return { header: h, chain, workflow: wf.workflow, workflowNote: wf.reason ?? null };
  });
  const view = raw.workflow ? explainRun(app.foundry.publicRun(app.foundry.store.run(runId)), raw.workflow, raw.chain.events) : null;
  const activations = app.ledger.forFlow(raw.header.workflowId).filter(a => a.workflowHash === raw.header.workflowHash);
  // The yes in force when the run was made (UX review M7: a version can be turned off and on again, so there can be more than one yes).
  const yeses = activations.filter(a => a.status === 'approved');
  const approved = yeses.filter(a => Number.isFinite(a.decidedAt) && a.decidedAt <= raw.header.createdAt).sort((x, y) => y.decidedAt - x.decidedAt)[0] ?? yeses[0] ?? null;
  const proposal = approved ? app.foundry.store.proposal(approved.proposalId) : null;
  const dry = approved ? app.ledger.latestDryRun(approved.proposalId) : null;
  const batch = batches ? batches.all().find(b => b.result?.runId === runId) ?? null : null;
  const byApproval = Object.fromEntries(Object.entries(batch?.usedBy ?? {}).map(([n, u]) => [u.approvalId, { batchId: batch.batchId, item: Number(n), digest: batch.items.find(i => i.n === Number(n))?.digest ?? null }]));
  const decisions = raw.chain.events.filter(e => /approval/i.test(e.type)).map(e => ({ seq: e.seq, at: iso(e.at), type: e.type, node: e.nodeKey ?? null,
    approvalId: e.approvalId ?? null, actor: e.actor ?? null, approved: e.approved ?? null,
    ...(e.type === 'approval.decided' && byApproval[e.approvalId] ? { fromList: { ...byApproval[e.approvalId], appliedBy: 'Foundry, from the person\'s one approval of the list' } } : {}) }));
  const log = new DecisionLog(app.root);
  const logCheck = log.verify();
  const marks = sentMarks(app), runDrafts = listDrafts(app).filter(d => d.runId === runId);
  let org = null; try { const cur = new AuthorityMaps(app.root).current(); org = cur ? { version: cur.version, hash: cur.hash, enforcedAtRunTime: false } : null; } catch { org = null; }
  const build = buildInfo();
  const bundle = {
    schema: 'foundry-evidence/4', generatedAt: date.toISOString(), generatedOn: { host: hostname(), note: 'this computer; not sent anywhere' },
    contains: CONTAINS,
    foundry: { name: build.name, version: build.version, commit: build.commit, changedSinceCommit: build.changedSinceCommit, files: build.tree },
    run: { runId, flowId: raw.header.workflowId, status: raw.header.status, verdict: raw.header.verdict?.verdict ?? null, createdAt: iso(raw.header.createdAt), updatedAt: iso(raw.header.updatedAt),
      headline: view?.headline ?? null, checks: view?.checks ?? [],
      startedBy: batch?.result?.startedBy ?? batch?.decision?.by ?? null, startedThrough: batch ? CHANNEL_WORDS[batch.decision?.channel] ?? batch.decision?.channel : null,
      identityVerified: false, howKnown: batch ? HOW_KNOWN[batch.decision?.channel] ?? null : null,
      startedNote: batch ? `The run started when a yes to its list came through ${CHANNEL_WORDS[batch.decision?.channel] ?? batch.decision?.channel}. "Started by" is the name in Settings and this computer's account; it is not a verified identity, and it does not show which person clicked.`
        : 'Who started this run was not recorded (it was not started from an approved list).' },
    chain: { verified: raw.chain.ok, events: raw.chain.count, head: raw.chain.head, reason: raw.chain.reason ?? null },
    workflow: { hash: raw.header.workflowHash, version: raw.workflow?.version ?? null, title: raw.workflow?.title ?? null, note: raw.workflowNote, body: raw.workflow },
    turnedOn: approved ? { approvalId: approved.id, by: approved.principal, identityVerified: false, howKnown: HOW_KNOWN[approved.channel] ?? null, channel: approved.channel, channelWords: CHANNEL_WORDS[approved.channel] ?? approved.channel,
      requestedAt: iso(approved.requestedAt), decidedAt: iso(approved.decidedAt), note: approved.note, proposalId: approved.proposalId, proposalStatus: proposal?.status ?? null } : null,
    ledger: activations.map(a => ({ approvalId: a.id, status: a.status, by: a.principal, channel: a.channel, decidedAt: iso(a.decidedAt), workflowHash: a.workflowHash,
      ...(a.turnedOff ? { turnedOff: { at: iso(a.turnedOff.at), by: a.turnedOff.principal, channel: a.turnedOff.channel } } : {}) })),
    practice: dry ? { dryRunId: dry.id, passed: dry.passed, at: iso(dry.at), workflowHash: dry.workflowHash, dataSource: dry.body.dataSource ?? 'template', checks: dry.body.checks } : null,
    actionDecisions: decisions,
    batch: batch ? { batchId: batch.batchId, decision: batch.decision, asOf: batch.input?.now ?? null, createdAt: batch.createdAt, items: batch.items.length, made: batch.result?.made ?? null,
      stoppedAt: batch.result?.stoppedAt ?? null, workflowHash: batch.workflowHash ?? null,
      list: batch.items.map(i => ({ n: i.n, action: i.action, to: i.to, subject: i.subject, body: String(i.body ?? ''), bodySha256: sha(String(i.body ?? '')), digest: i.digest })) } : null,
    declinedLists: batches ? batches.all().filter(b => b.flowId === raw.header.workflowId && b.status === 'declined').map(b => ({ batchId: b.batchId, decision: b.decision, items: b.items.length,
      list: b.items.map(i => ({ n: i.n, to: i.to, subject: i.subject, digest: i.digest })) })) : [],
    draftsMarkedSent: runDrafts.map(d => ({ draft: d.id, to: d.to, subject: d.subject, markedSent: marks[d.id] ?? null })),
    personDecisions: { log: 'site/decisions.jsonl', check: logCheck, lines: log.lines().filter(l => l.flowId === raw.header.workflowId || l.runId === runId || (l.kind === 'draft-marked' && runDrafts.some(d => d.id === l.draft))),
      links: log.links(),
      note: 'lines: every line of this automation and of this run, in full. links: every line of the log in order, without its details: { v, seq, prev, flowId, body, hash } for a line written by this version of Foundry (its hash covers its place, its automation and its content, so the link can be checked on its own), { seq, prev, hash } for an older line (its place cannot be proved without its content).' },
    whoDecidesWhat: org,
    events: raw.chain.events,
    gaps: GAPS,
    howToCheck: 'Run: node app/cli.mjs check-evidence FILE; it names every section it checked and every one it could not. By hand: for each event in order, drop its hash field and take sha256 of its canonical JSON (keys sorted, no spaces): it must equal the hash shown, and the next event must name it as previousHash. The last hash must equal chain.head. The workflow body must hash the same way to workflow.hash. For each link in personDecisions.links with v 2, sha256 of the canonical JSON of { link: 2, seq, prev, flowId, body } must equal its hash; each link names the one before as prev, and the last is personDecisions.check.head. Each line in personDecisions.lines, without its hash, hashes to the body of the link at its seq. Every link whose flowId is this automation has its line in the file. turnedOn, ledger, batch, run.startedBy, actionDecisions, declinedLists and draftsMarkedSent must match those lines and the events. None of this shows that nothing changed unless chain.head and personDecisions.check.head match copies kept somewhere else.'
  };
  return bundle;
}
/** What an evidence file holds, said in the file itself and next to the download (L10). */
export const CONTAINS = 'Every run event in full, so each fingerprint can be re-checked. That includes what each step read and wrote: the list you gave (for example every customer, address and amount) and the full text of every e-mail the run wrote. Share this file only with someone who may see that list.';

/**
 * Check an evidence file on its own (what `node app/cli.mjs check-evidence FILE` runs). Returns { ok, problems: [], checked }, where
 * checked counts what was checked and names it: checked.sections (each section checked, in words) and checked.notChecked (each section
 * nothing in the file can vouch for, with why).
 */
// Since L9: nothing missing passes as consistent (no events, no head, no workflow body, no decision-log links), and decision lines are
// checked for order as well as content. Since B1 (honesty review): the "who decided" sections are checked against the hashed lines and
// events they come from, and a line of this automation left out of the file is found.
export function checkEvidence(bundle) {
  const problems = [], sections = [], notChecked = [];
  const checked = { events: 0, decisions: 0, links: 0, olderLinks: 0, sections, notChecked };
  const hashOf = v => { try { return sha(canonical(v)); } catch { return null; } };
  const said = (ok, section) => { if (ok) sections.push(section); return ok; };
  const fresh = start => problems.length === start;

  // ---- the run's events: each hashes as recorded and names the one before; the last is the stated head
  const events = Array.isArray(bundle?.events) ? bundle.events : [];
  let start = problems.length;
  if (!events.length) problems.push('the file holds no run events, so there is nothing to check');
  let prev = null;
  for (const e of events) {
    const { hash, ...rest } = e ?? {};
    if (!hash || hashOf(rest) !== hash) problems.push(`event ${e?.seq}: its hash does not match its content`);
    if ((e?.previousHash ?? null) !== prev) problems.push(`event ${e?.seq}: it does not name the event before it`);
    prev = hash ?? null; checked.events += 1;
  }
  if (typeof bundle?.chain?.head !== 'string' || !bundle.chain.head) problems.push('the file states no chain head');
  else if (prev !== bundle.chain.head) problems.push('the last event is not the chain head the file states');
  said(fresh(start), `run events (${checked.events}): each hashes as recorded and names the one before; the last is the chain head`);

  // ---- the workflow version: its body hashes to its hash, the run was made from it, and it is this automation
  start = problems.length;
  const wf = bundle?.workflow, run = bundle?.run ?? {};
  if (!wf?.body || typeof wf.hash !== 'string') problems.push('the file holds no workflow body to check against its hash');
  else {
    if (hashOf(wf.body) !== wf.hash) problems.push('the workflow body does not hash to the workflow hash');
    const created = events.find(e => e?.type === 'run.created');
    if (created && created.workflowHash !== wf.hash) problems.push('the run was not made from the workflow version the file holds');
    if (run.flowId !== wf.body.id) problems.push('the run\'s automation is not the workflow the file holds');
  }
  said(fresh(start), 'workflow version: its body hashes to its hash, and the run was made from it');

  // ---- the decision log: every link checks from its parts and names the one before; the last is the stated head
  start = problems.length;
  const pd = bundle?.personDecisions, links = Array.isArray(pd?.links) ? pd.links : null;
  const flowId = typeof run.flowId === 'string' ? run.flowId : null;
  const lines = Array.isArray(pd?.lines) ? pd.lines : [];
  if (!links) problems.push('the file holds no decision-log links, so the order of the decisions cannot be checked (a file made before Foundry evidence version 3)');
  else {
    if (pd?.check?.ok === false) problems.push(`Foundry found the decision log broken when it made this file: ${pd.check.reason ?? 'no reason given'}`);
    let last = null;
    for (const [i, l] of links.entries()) {
      if (l?.seq !== i + 1) problems.push(`decision log link ${i + 1}: it is numbered ${l?.seq}`);
      if (!l?.hash || (l.prev ?? null) !== last) problems.push(`decision log line ${i + 1}: it does not name the line before it`);
      if (l?.v === LINK_V) {
        if (typeof l.body !== 'string' || linkHash(l) !== l.hash) problems.push(`decision log line ${i + 1}: its hash does not cover its place, automation and content as stated`);
        else if (flowId && l.flowId === flowId && !lines.some(x => x?.seq === l.seq)) problems.push(`decision log line ${l.seq} belongs to this automation but is not in the file`);
      } else checked.olderLinks += 1;
      last = l?.hash ?? null; checked.links += 1;
    }
    if ((pd?.check?.head ?? null) !== last) problems.push('the decision log\'s last link is not the head the file states');
  }
  // Each line in full: it hashes to its link's content and sits at its place.
  for (const l of lines) {
    const { hash } = l ?? {};
    const mine = lineHashes(l), link = links?.[l?.seq - 1];
    if (!hash || mine.hash !== hash) problems.push(`decision ${l?.seq}: its hash does not match its content`);
    else if (links && (link?.hash !== hash || (link.v === LINK_V && (link.body !== mine.body || (link.flowId ?? null) !== (l.flowId ?? null))))) problems.push(`decision ${l.seq}: it is not at its place in the decision log`);
    checked.decisions += 1;
  }
  said(fresh(start) && !!links, `decision log (${checked.links} lines): each link names the one before and ends at the stated head; this automation's ${checked.decisions} lines are in the file in full and hash as recorded` +
    (checked.olderLinks ? `; ${checked.olderLinks} lines were written by an older Foundry, so their place is shown but cannot be proved` : ''));

  // ---- the sections built from Foundry's other records, each against the hashed lines and events it comes from
  const sameLine = (l, x, keys) => keys.every(([a, b]) => (l?.[a] ?? null) === (x?.[b] ?? null));
  const turnOn = id => lines.find(l => l?.kind === 'turn-on' && l.approvalId === id);
  start = problems.length;
  const t = bundle?.turnedOn;
  if (t) {
    const l = turnOn(t.approvalId);
    if (!l) problems.push(`turned on: no line in the decision log in this file backs it, so who turned it on (${t.by}) cannot be checked`);
    else if (l.decision !== 'approved' || !sameLine(l, t, [['principal', 'by'], ['channel', 'channel']]) || l.workflowHash !== wf?.hash || (flowId && l.flowId !== flowId))
      problems.push('turned on: who, how or which version does not match its line in the decision log');
  }
  if (t) said(fresh(start), 'turned on: who, through which channel and which version match the logged decision');
  else notChecked.push('turned on: the file says this version was not turned on');

  start = problems.length;
  const ledger = Array.isArray(bundle?.ledger) ? bundle.ledger : [];
  for (const a of ledger) {
    if (a?.status === 'pending' && !a.by) continue;
    const l = turnOn(a?.approvalId);
    const want = a?.status === 'rejected' ? 'rejected' : 'approved';
    if (!l) problems.push(`turn-on history: the decision ${a?.approvalId} (${a?.status}) has no line in the decision log in this file`);
    else if (l.decision !== want || !sameLine(l, a, [['principal', 'by'], ['channel', 'channel'], ['workflowHash', 'workflowHash']])) problems.push(`turn-on history: the decision ${a.approvalId} does not match its line in the decision log`);
  }
  for (const l of lines.filter(x => x?.kind === 'turn-on' && x.workflowHash === wf?.hash)) if (!ledger.some(a => a?.approvalId === l.approvalId)) problems.push(`turn-on history: it leaves out the decision in log line ${l.seq}`);
  said(fresh(start), `turn-on history (${ledger.length}): every decision in it matches a logged decision, and none is left out`);

  // Turning off (UX review M7): each turn-off in the history matches its logged line, and no logged turn-off of this version is left out.
  start = problems.length;
  const offs = ledger.filter(a => a?.turnedOff);
  for (const a of offs) {
    const l = lines.find(x => x?.kind === 'turn-off' && x.approvalId === a.approvalId);
    if (!l) problems.push(`turn-off history: turning off ${a.approvalId} has no line in the decision log in this file`);
    else if (!sameLine(l, a.turnedOff, [['principal', 'by'], ['channel', 'channel']]) || l.workflowHash !== a.workflowHash) problems.push(`turn-off history: turning off ${a.approvalId} does not match its line in the decision log`);
  }
  for (const l of lines.filter(x => x?.kind === 'turn-off' && x.workflowHash === wf?.hash)) if (!offs.some(a => a?.approvalId === l.approvalId)) problems.push(`turn-off history: it leaves out the turn-off in log line ${l.seq}`);
  said(fresh(start), `turn-off history (${offs.length}): every turn-off matches a logged one, and none is left out`);

  // The list: the person's decision, every item's fingerprint from its text, the fingerprint the page showed, and who started the run.
  start = problems.length;
  const b = bundle?.batch;
  const itemArgs = i => i?.action === 'post' ? { tool: 'chat.post', args: { channel: i.to, text: i.body } } : { tool: 'outbox.send', args: { to: i?.to, subject: i?.subject, body: i?.body } };
  const sameItems = (logged, shown) => Array.isArray(logged) && Array.isArray(shown) && logged.length === shown.length
    && shown.every(i => { const x = logged.find(y => y?.n === i?.n); return x && x.to === i.to && (x.subject ?? null) === (i.subject ?? null) && x.digest === i.digest; });
  if (b) {
    const l = lines.find(x => x?.kind === 'list' && x.batchId === b.batchId);
    const want = b.decision?.approved ? 'approved' : 'declined';
    if (!l) problems.push('the list: no line in the decision log in this file backs the decision on it');
    else {
      if (l.decision !== want || !sameLine(l, b.decision, [['principal', 'by'], ['channel', 'channel']])) problems.push('the list: who decided, or how, does not match its line in the decision log');
      if (!sameItems(l.items, b.list)) problems.push('the list: its items (to, subject, fingerprint) are not the ones the person decided on');
    }
    for (const i of Array.isArray(b.list) ? b.list : []) {
      if (typeof i?.body !== 'string') { problems.push(`the list: item ${i?.n} carries no text, so its fingerprint cannot be checked`); continue; }
      if (hashOf(itemArgs(i)) !== i.digest) problems.push(`the list: item ${i.n}'s fingerprint is not that of its address, subject and text`);
      if (sha(i.body) !== i.bodySha256) problems.push(`the list: item ${i.n}'s text does not match its sha256`);
    }
    if (b.decision?.listDigest && hashOf({ batchId: b.batchId, workflowHash: b.workflowHash ?? wf?.hash, items: (b.list ?? []).map(i => i?.digest) }) !== b.decision.listDigest)
      problems.push('the list: its items are not the list whose fingerprint the page showed');
    if (b.workflowHash && b.workflowHash !== wf?.hash) problems.push('the list was made for another version than the one that ran');
    if (l && b.decision?.approved && ((run.startedBy ?? null) !== (l.principal ?? null) || (run.startedThrough ?? null) !== (CHANNEL_WORDS[l.channel] ?? l.channel ?? null))) problems.push('started by: it does not match who approved the list in the decision log');
  } else if (run.startedBy) problems.push('started by: the file names who started the run, but holds no list decision to back it');
  if (b) said(fresh(start), `the list (${(b.list ?? []).length} items) and who started the run: the logged decision, each item's fingerprint from its text, and the fingerprint the page showed all match`);
  else notChecked.push('the list and who started the run: this run was not started from an approved list');

  // Decisions on paused actions: as the events record them; a yes applied from the list matches its logged line and the paused action.
  start = problems.length;
  const iso = v => (v === null || v === undefined ? null : new Date(v).toISOString());
  const fromEvents = events.filter(e => /approval/i.test(e?.type ?? '')).map(e => ({ seq: e.seq, at: iso(e.at), type: e.type, node: e.nodeKey ?? null, approvalId: e.approvalId ?? null, actor: e.actor ?? null, approved: e.approved ?? null }));
  const stated = Array.isArray(bundle?.actionDecisions) ? bundle.actionDecisions : [];
  if (stated.length !== fromEvents.length || stated.some((d, i) => Object.keys(fromEvents[i]).some(k => (d?.[k] ?? null) !== fromEvents[i][k]))) problems.push('decisions on paused actions: they are not the ones the run\'s events record');
  for (const d of stated.filter(x => x?.type === 'approval.decided')) {
    const l = lines.find(x => (x?.kind === 'list-item' || x?.kind === 'action') && x.approvalId === d.approvalId);
    if (!l) { problems.push(`decisions on paused actions: the yes or no in event ${d.seq} has no line in the decision log in this file`); continue; }
    if (l.decision !== (d.approved ? 'approved' : 'rejected')) problems.push(`decisions on paused actions: event ${d.seq} does not match its logged line`);
    if (d.fromList || l.kind === 'list-item') {
      const f = d.fromList ?? {};
      if (l.kind !== 'list-item' || l.batchId !== f.batchId || l.item !== f.item || l.digest !== f.digest) problems.push(`decisions on paused actions: event ${d.seq} does not say which list item it applied as its logged line does`);
      const item = b?.batchId === l.batchId ? (b.list ?? []).find(i => i?.n === l.item) : null;
      const asked = events.find(e => e?.type === 'approval.requested' && e.approvalId === d.approvalId);
      if (!item || item.digest !== l.digest) problems.push(`decisions on paused actions: event ${d.seq} applied list item ${l.item}, which is not on the list in this file`);
      else if (!asked || asked.tool !== itemArgs(item).tool || asked.argsHash !== hashOf(itemArgs(item).args)) problems.push(`decisions on paused actions: what the run paused for at event ${d.seq} is not list item ${l.item}`);
    }
  }
  for (const l of lines.filter(x => (x?.kind === 'list-item' || x?.kind === 'action') && x.runId === run.runId)) if (!stated.some(d => d?.type === 'approval.decided' && d.approvalId === l.approvalId)) problems.push(`decisions on paused actions: the file leaves out the decision in log line ${l.seq}`);
  said(fresh(start), `decisions on paused actions (${stated.filter(x => x?.type === 'approval.decided').length}): as the events record them; each yes matches its logged line, and each yes from the list is for exactly the action the run paused for`);

  start = problems.length;
  const declined = Array.isArray(bundle?.declinedLists) ? bundle.declinedLists : [];
  for (const d of declined) {
    const l = lines.find(x => x?.kind === 'list' && x.batchId === d?.batchId);
    if (!l || l.decision !== 'declined' || !sameLine(l, d.decision, [['principal', 'by'], ['channel', 'channel']]) || !sameItems(l.items, d.list)) problems.push(`declined lists: ${d?.batchId} does not match a declined list in the decision log`);
  }
  for (const l of lines.filter(x => x?.kind === 'list' && x.decision === 'declined')) if (!declined.some(d => d?.batchId === l.batchId)) problems.push(`declined lists: the file leaves out the list declined in log line ${l.seq}`);
  said(fresh(start), `declined lists (${declined.length}): each matches the logged decision, and none is left out`);

  start = problems.length;
  const marked = Array.isArray(bundle?.draftsMarkedSent) ? bundle.draftsMarkedSent : [];
  for (const d of marked) {
    const lastMark = lines.filter(x => x?.kind === 'draft-marked' && x.draft === d?.draft).at(-1);
    if (d?.markedSent && lastMark?.decision !== 'sent') problems.push(`drafts marked as sent: ${d.draft} has no logged "I sent it"`);
    if (!d?.markedSent && lastMark?.decision === 'sent') problems.push(`drafts marked as sent: ${d.draft} was marked as sent in the log, and the file says it was not`);
  }
  said(fresh(start), `drafts marked as sent (${marked.length}): each matches the person's last logged mark`);

  start = problems.length;
  const practice = bundle?.practice, tl = t ? turnOn(t.approvalId) : null;
  if (practice && practice.workflowHash !== wf?.hash) problems.push('practice run: it was for another version');
  if (practice && tl?.dryRunId && tl.dryRunId !== practice.dryRunId) problems.push('practice run: it is not the practice run the logged turn-on rests on');
  if (practice && tl?.dryRunId) said(fresh(start), 'practice run: it is the one the logged turn-on rests on, for this version');
  else if (practice) { said(fresh(start), 'practice run: for this version'); notChecked.push('which practice run the turn-on rests on: its logged line is older and does not name it'); }
  notChecked.push('the practice run\'s result and checks (passed, each check): they come from Foundry\'s ledger, which no logged line or event holds');
  notChecked.push('the run summary (status, verdict, headline, checks) and every time outside the events: Foundry derives them; compare them with the events by hand');
  notChecked.push('Who decides what (version and fingerprint), the Foundry build, where and when the file was made, and the notes: nothing in the file can vouch for them');
  return { ok: problems.length === 0, problems, checked };
}
