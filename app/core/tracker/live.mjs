// Conditions checked on a LIVE run, not only on practice data (research/tracker-20261021/DOSSIER.md risk 3; AgentSWE: practice worlds
// are not live worlds). A met condition on practice data says what the flow did there; after every live run the same checks read what
// THAT run did, so a condition can turn unmet the first time live data reaches it.
//
// The view is built only from what the run itself saw and did, as the person's platform records it:
//   sources  the rows each top-level sheet.read step of the run returned (the run's own journal: node.completed outputs), so the items
//            are exactly the ones the flow worked on, whatever the sheets hold now
//   effects  the run's outbox messages and chat posts (the stand-ins tag each with its run id) and the rows it appended (the world's
//            effects log names each appended row by hash; the rows are matched in the sheet by that hash)
// Nothing here runs the flow again or writes anything outside the condition ledger.
import { createHash } from 'node:crypto';
import { canonical } from '../../../src/data.mjs';
import { namingColumns } from './practice.mjs';

const sha256 = text => createHash('sha256').update(text).digest('hex');

/** Top-level sheet.read nodes of a workflow: [{ id, sheet }]. A sheet given by reference (not a literal) cannot be named, so it is left out. */
export function sheetReads(workflow) {
  return (workflow?.nodes ?? []).filter(n => n.tool === 'sheet.read' && typeof n.args?.sheet === 'string').map(n => ({ id: n.id, sheet: n.args.sheet }));
}

/**
 * liveView({ runId, workflow, events, outbox, world }) → RunView (./checks.mjs) of one live run.
 * events: the run's journal events (foundry.store.events(runId)); outbox: readOutbox(outboxDir); world: readWorld(worldDir).
 */
export function liveView({ runId, workflow, events = [], outbox = [], world = { sheets: {}, chat: {}, effects: [] }, now = null }) {
  const outputs = new Map(events.filter(e => e.type === 'node.completed').map(e => [e.nodeKey ?? e.data?.nodeKey, e.output ?? e.data?.output]));
  const sources = {};
  for (const { id, sheet } of sheetReads(workflow)) {
    const rows = outputs.get(`root/${id}`)?.rows;
    if (!Array.isArray(rows) || sources[sheet]) continue;
    const naming = namingColumns(rows);
    sources[sheet] = rows.map((r, i) => ({ id: `${sheet}#${i}`, at: null, names: naming.map(c => r[c]), fields: r }));
  }
  const effects = [];
  let seq = 0;
  const add = (channel, fields, text) => effects.push({ id: `live:${runId}:e${++seq}`, seq, at: now, channel, status: 'applied', fields, text });
  for (const m of outbox.filter(m => m.runId === runId)) add('email', { to: m.to, subject: m.subject, body: m.body }, `${m.to}\n${m.subject}\n${m.body}`);
  for (const [channel, posts] of Object.entries(world.chat ?? {})) for (const p of posts.filter(p => p.runId === runId)) add('chat', { channel, text: p.text }, `${channel}\n${p.text}`);
  for (const log of (world.effects ?? []).filter(e => e.kind === 'sheet.append' && e.runId === runId)) {
    const want = new Map(); for (const h of log.rowHashes ?? []) want.set(h, (want.get(h) ?? 0) + 1);
    for (const row of world.sheets?.[log.sheet] ?? []) {
      const h = sha256(canonical(row)), n = want.get(h) ?? 0;
      if (!n) continue;
      want.set(h, n - 1);
      add('row', { sheet: log.sheet, row }, `${log.sheet}\n${Object.values(row).map(v => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join('\n')}`);
    }
  }
  return { id: `live:${runId}`, now, horizon: null, ordered: false, sources, effects, live: true };
}
