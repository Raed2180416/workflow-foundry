// Batch approval of an exact, displayed list (research/onboarding-20261021/SPEC.md §7.5; owner decision O-J pending).
//
// Live sends pause one at a time (the engine asks before each outside action, bound to tool, arguments and workflow hash). Asking a
// person N times for N reminders invites rubber-stamping, so the site shows the whole list once, in full, and binds the person's one
// click to exactly that list:
//   preview  runs the CURRENT, turned-on version on the person's live sheets with practice stand-ins (nothing leaves), and records every
//            planned outside action in full with digest = sha256(canonical({tool, args})), bound to the workflow hash and the run input,
//            in <workspace>/batches.json (atomic write). It expires after 60 minutes.
//   approve  (a person's click) starts the live run with the same input; while it waits for approval, each paused action is approved
//            only if the digest of its FULL arguments equals an unused item of the batch and the run's workflow hash equals the batch's.
//            Anything else stops the batch and stays waiting as a normal single card ("This wasn't on the list you approved").
//   decline  makes nothing.
// Never: a match on a truncated preview, an item used twice, an expired batch, another version, or an item the person was not shown.
//
// Since the persona walkthroughs (research/onboarding-20261021/WALKTHROUGH.md):
//   - the preview starts from the live store's cross-run state (./preview-run.mjs), so a second weekly run lists only what is new and its
//     summary matches the real run (P2 B3);
//   - a new list for an automation replaces the open lists before it, and a yes closes the others (no stale card left in Waiting);
//   - the decision names the person ("Ravi Patel (ravi@laptop)"), and every decision goes to the chained decision log (P5 B1-B3);
//   - each card can add notes the person should read first (./cards.mjs: a firmer reminder as first contact; claims already sent).
//
// Since the security review of 2026-10-21 (M7): the yes is bound to the list the person saw. The page sends the fingerprint of the list
// exactly as its card shows it (listDigest: sha256 over the batch id, the version's hash and each item's to, subject and full text), and
// approve refuses a list whose stored items no longer give that fingerprint. Every change to batches.json is a read-modify-write under
// one file lock (./file-lock.mjs), shared by the site and the MCP server, and the yes claims the list (open -> approving) inside that
// lock, so a list cannot be used twice or reopened by another process's stale write.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FoundryError, digest } from '../../src/data.mjs';
import { effectDigest } from '../core/service.mjs';
import { templateOf, slotsOf } from '../core/library.mjs';
import { readWorld } from '../core/stand-ins.mjs';
import { inputSheets } from './csv.mjs';
import { previewRun } from './preview-run.mjs';
import { listNotes } from './cards.mjs';
import { whoIsHere, whoLabel } from './decisions.mjs';
import { withFileLock } from './file-lock.mjs';

export const BATCH_TTL_MS = 60 * 60 * 1000;
const KEEP = 200;
const DIGEST = /^[a-f0-9]{64}$/;

/** One item's fingerprint from what the card shows of it: the same digest the run's paused action must match. */
export const itemDigest = i => i.action === 'post' ? effectDigest('chat.post', { channel: i.to, text: i.body }) : effectDigest('outbox.send', { to: i.to, subject: i.subject, body: i.body });
/** The fingerprint of a whole list as shown (the page computes the same in app/site/public/components/ui.js shownListDigest). */
export const listDigest = batch => digest({ batchId: batch.batchId, workflowHash: batch.workflowHash, items: batch.items.map(itemDigest) });

export class Batches {
  // now: the clock for records (when a list was made, decided, expires); asOf: the date a run is "as of" (the invoices' ages). The site
  // uses the real clock for both; the journeys fix asOf only, so their records keep real times (P5 walkthrough M6).
  constructor(app, { now = () => Date.now(), asOf = now } = {}) { this.app = app; this.now = now; this.asOf = asOf; this.file = path.join(app.root, 'batches.json'); }
  #load() { if (!existsSync(this.file)) return []; try { const v = JSON.parse(readFileSync(this.file, 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } }
  #save(list) { const tmp = `${this.file}.tmp-${process.pid}`; writeFileSync(tmp, JSON.stringify(list.slice(-KEEP), null, 2), { mode: 0o600 }); renameSync(tmp, this.file); }
  /** Read, change and write the whole file under the lock (M7): fn(list) returns the new list. */
  #mutate(fn) { return withFileLock(this.file, () => { const next = fn(this.#load()); this.#save(next); return next; }); }
  #update(id, fn) {
    let out = null;
    this.#mutate(list => { const i = list.findIndex(b => b.batchId === id); if (i < 0) throw new FoundryError('NOT_FOUND', 'No such list to approve'); list[i] = out = fn(list[i]); return list; });
    return out;
  }
  get(batchId) { const b = this.#load().find(x => x.batchId === batchId); if (!b) throw new FoundryError('NOT_FOUND', 'No such list to approve'); return this.#view(b); }
  #view(b) { return { ...b, expired: b.status === 'open' && this.now() > Date.parse(b.expiresAt), count: b.items.length }; }
  /** Open batches (not used, declined or expired), newest first: the batch cards on "Waiting for you". */
  open() { return this.#load().filter(b => b.status === 'open' && this.now() <= Date.parse(b.expiresAt)).reverse().map(b => this.#view(b)); }
  all() { return this.#load().reverse().map(b => this.#view(b)); }

  async preview(flowId, { input = null } = {}) {
    const app = this.app;
    let head; try { head = app.foundry.store.workflow(flowId); } catch (error) { if (error.code === 'NOT_FOUND') throw new FoundryError('NOT_FOUND', `No automation named ${flowId}`); throw error; }
    if (!app.ledger.approvedFor(flowId, head.hash)) throw new FoundryError('NOT_APPROVED', 'Turn this version on first');
    if (app.practiceOnly()) throw new FoundryError('PRACTICE_ONLY', 'Practice-only mode is on');
    const template = templateOf(head.workflow);
    if (!template) throw new FoundryError('BATCH_TEMPLATE', 'Only automations made from a card can make a list in advance');
    const sheets = readWorld(app.worldDir).sheets;
    const missing = inputSheets(template.id).filter(s => !sheets[s]);
    if (missing.length) throw Object.assign(new FoundryError('SHEET_NOT_FOUND', `Foundry needs your ${missing.join(' and ')} first`), { sheets: missing });
    const runInput = input ?? { now: new Date(this.asOf()).toISOString() };
    const res = await previewRun(app, head.workflow, { sheets, input: runInput });
    if (!res.passed) return { ok: false, passed: false, status: res.status, headline: res.explained?.headline ?? res.status, checks: res.explained?.checks ?? [],
      problem: res.explained?.problem ?? null, error: res.error ?? null };
    const items = [
      ...res.effects.outbox.map(m => ({ tool: 'outbox.send', action: 'send', to: m.to, subject: m.subject, body: m.body, digest: effectDigest('outbox.send', { to: m.to, subject: m.subject, body: m.body }) })),
      ...Object.entries(res.effects.chat).flatMap(([channel, posts]) => posts.map(text => ({ tool: 'chat.post', action: 'post', to: channel, subject: null, body: text, digest: effectDigest('chat.post', { channel, text }) })))];
    // A stable order the person can read: messages to the people in the data first, then the ones to the person's own addresses
    // (a summary, a digest), each group by subject. Matching on approve does not depend on the order.
    const own = new Set(Object.values(slotsOf(head.workflow) ?? {}).filter(v => typeof v === 'string' && v.includes('@')).map(v => v.toLowerCase()));
    items.sort((a, b) => (own.has(String(a.to).toLowerCase()) - own.has(String(b.to).toLowerCase())) || String(a.subject ?? '').localeCompare(String(b.subject ?? '')) || String(a.to).localeCompare(String(b.to)));
    const alsoDoes = Object.entries(res.effects.appended).map(([sheet, rows]) => ({ action: 'append', sheet, rows: rows.length }));
    const created = this.now();
    const alreadyMade = (res.state ?? []).length;
    const batch = { batchId: randomUUID(), flowId, title: head.workflow.title, version: head.workflow.version, workflowHash: head.hash, input: runInput, template: template.id,
      items: items.map((it, i) => ({ n: i + 1, ...it })), alsoDoes, checks: res.explained.checks, notes: listNotes(template.id, { preview: res, root: app.root, flowId, slots: slotsOf(head.workflow) ?? {} }),
      remembered: alreadyMade, createdAt: new Date(created).toISOString(), expiresAt: new Date(created + BATCH_TTL_MS).toISOString(), status: 'open', usedBy: {}, decision: null, result: null };
    // One open list per automation: the newest replaces the ones before it.
    this.#mutate(list => [...list.map(b => b.flowId === flowId && b.status === 'open' ? { ...b, status: 'replaced' } : b), batch]);
    return { ok: true, passed: true, ...this.#view(batch) };
  }

  /**
   * A person's yes to the whole displayed list. channel: the human channel the click came through; shown: the list's fingerprint as the
   * page computed it from the card the person saw (listDigest). A missing or different fingerprint is refused and nothing is made (M7).
   */
  async approve(batchId, { channel = 'dashboard', listDigest: shown } = {}) {
    const app = this.app;
    if (typeof shown !== 'string' || !DIGEST.test(shown)) throw new FoundryError('BAD_REQUEST', 'Approve the list you were shown: its fingerprint is missing. Reload the page and look at the list again.');
    this.get(batchId);
    const who = whoIsHere(app.root);
    // Check and claim in one locked step, so two windows (or two processes) cannot both start a run from one list.
    let refusal = null;
    const b = this.#update(batchId, x => {
      if (x.status !== 'open') { refusal = new FoundryError('BATCH_CLOSED', `This list was already ${x.status}`); return x; }
      if (this.#view(x).expired) { refusal = new FoundryError('BATCH_EXPIRED', 'This list is more than an hour old. Make a new one so you approve what would happen now.'); return { ...x, status: 'expired' }; }
      if (x.items.some(i => itemDigest(i) !== i.digest) || listDigest(x) !== shown) { refusal = new FoundryError('BATCH_CHANGED', 'This list is not the one you were shown: it changed after the page showed it. Nothing was made. Look at the list again.'); return x; }
      let head = null; try { head = app.foundry.store.workflow(x.flowId); } catch { head = null; }
      if (!head) { refusal = new FoundryError('NOT_FOUND', 'The automation is gone'); return x; }
      if (head.hash !== x.workflowHash) { refusal = new FoundryError('STALE_APPROVAL', 'The automation changed after this list was made. Make a new list.'); return { ...x, status: 'stale' }; }
      return { ...x, status: 'approving', decision: { approved: true, by: whoLabel(who), who, channel, at: new Date(this.now()).toISOString(), listDigest: shown } };
    });
    if (refusal) throw refusal;
    try { app.onDecision?.({ kind: 'list', decision: 'approved', channel, principal: whoLabel(who), flowId: b.flowId, version: b.version, workflowHash: b.workflowHash, batchId,
      items: b.items.map(i => ({ n: i.n, to: i.to, subject: i.subject, digest: i.digest })) }); } catch { /* a record, never a gate */ }
    let run = await app.run({ flowId: b.flowId, input: b.input });
    if (run.ok === false) { this.#update(batchId, x => ({ ...x, status: 'failed', result: { problem: run.problem } })); return { ok: false, problem: run.problem, made: [] }; }
    const used = new Set(), made = [];
    let stoppedAt = null;
    for (let guard = 0; run.status === 'awaiting_approval' && guard < 10000; guard++) {
      const pending = run.pendingApprovals ?? [];
      if (!pending.length) break;
      const p = pending[0];
      const wants = effectDigest(p.tool, p.args);
      const item = run.workflowHash === b.workflowHash ? b.items.find(it => it.digest === wants && !used.has(it.n)) : null;
      if (!item) { stoppedAt = { runId: run.runId, approvalId: p.approvalId, step: p.step, tool: p.tool, to: p.args?.to ?? p.args?.channel ?? null, subject: p.args?.subject ?? null }; break; }
      used.add(item.n);
      this.#update(batchId, x => ({ ...x, usedBy: { ...x.usedBy, [item.n]: { runId: run.runId, approvalId: p.approvalId, at: new Date(this.now()).toISOString() } } }));
      run = await app.decideAction(run.runId, p.approvalId, true, { channel, fromList: { batchId, n: item.n, digest: item.digest } });
      made.push({ n: item.n, to: item.to, subject: item.subject, action: item.action });
    }
    const result = { runId: run.runId, runStatus: run.status, made: made.length, notMade: b.items.length - made.length, stoppedAt, startedBy: whoLabel(who), startedThrough: channel };
    this.#update(batchId, x => ({ ...x, status: stoppedAt ? 'stopped' : 'used', result }));
    // A yes closes every other open list of this automation: they were made before this run and no longer say what a run would make.
    this.#mutate(list => list.map(x => x.flowId === b.flowId && x.status === 'open' ? { ...x, status: 'replaced' } : x));
    return { ok: true, runId: run.runId, status: run.status, headline: run.headline, checks: run.checks, made, stoppedAt,
      say: stoppedAt ? 'The real run wanted to make something that was not on your list, so it stopped and is asking you about that one.' : null };
  }

  decline(batchId, { channel = 'dashboard' } = {}) {
    this.get(batchId);
    const who = whoIsHere(this.app.root);
    let refusal = null;
    const b = this.#update(batchId, x => {
      if (x.status !== 'open') { refusal = new FoundryError('BATCH_CLOSED', `This list was already ${x.status}`); return x; }
      return { ...x, status: 'declined', decision: { approved: false, by: whoLabel(who), who, channel, at: new Date(this.now()).toISOString() } };
    });
    if (refusal) throw refusal;
    try { this.app.onDecision?.({ kind: 'list', decision: 'declined', channel, principal: whoLabel(who), flowId: b.flowId, version: b.version, workflowHash: b.workflowHash, batchId,
      items: b.items.map(i => ({ n: i.n, to: i.to, subject: i.subject, digest: i.digest })) }); } catch { /* a record, never a gate */ }
    return this.#view(b);
  }
  /** Every list of one automation that a person decided (approved or declined), newest first: the automation page's "Decisions". */
  decided(flowId) { return this.all().filter(b => b.flowId === flowId && b.decision); }
}
