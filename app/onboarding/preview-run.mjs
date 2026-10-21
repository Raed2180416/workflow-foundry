// The run a list preview makes (app/onboarding/batch.mjs): the turned-on version on the person's live sheets, in a fresh practice world
// (practice stand-ins: nothing leaves, nobody is asked), as app/core/practice.mjs runInWorld does, with one addition: the workflow's
// cross-run state in the live store (what earlier live runs already did: "INV-2041|reminder" was made) is copied into the practice store
// before the run. Without it a preview could not see earlier runs: on the second weekly run it listed reminders already made last week
// and a summary whose count differed from the real run's, so the real run stopped and asked (P2 walkthrough B3; DESIGN §6 known limit).
//
// practice.mjs is frozen by the BUILDER-1 manifest, so this file repeats its loop (no approvals: the practice registry asks nobody).
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Foundry } from '../../src/foundry.mjs';
import { requireWorkflow } from '../../src/validate.mjs';
import { errorData } from '../../src/data.mjs';
import { appRegistry } from '../core/capabilities.mjs';
import { explainRun } from '../core/explain.mjs';
import { seedWorld, readWorld, readOutbox } from '../core/stand-ins.mjs';

/** Copy the live store's state rows of one workflow (every slot, every entry, as stored) into another store. Returns the entries copied. */
export function copyState(from, to, workflowId) {
  const slots = from.db.prepare('SELECT * FROM state_slots WHERE workflow_id=?').all(workflowId);
  const entries = from.db.prepare('SELECT * FROM state_entries WHERE workflow_id=?').all(workflowId);
  const insert = (table, row) => { const cols = Object.keys(row); to.db.prepare(`INSERT OR REPLACE INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...cols.map(c => row[c])); };
  for (const s of slots) insert('state_slots', s);
  for (const e of entries) insert('state_entries', e);
  return entries.map(e => ({ slot: e.slot, key: e.key, expiresAt: e.expires_at, writtenAt: e.written_at }));
}

/** Like runInWorld(workflow, { sheets, input, mode: 'practice' }), starting from the live store's state of this workflow. */
export async function previewRun(app, workflow, { sheets = {}, input = {} } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-preview-'));
  const worldDir = path.join(dir, 'world'), outboxDir = path.join(dir, 'outbox');
  mkdirSync(worldDir, { recursive: true, mode: 0o700 });
  seedWorld(worldDir, { sheets });
  const registry = appRegistry({ mode: 'practice', outboxDir, worldDir });
  const foundry = new Foundry(path.join(dir, 'store'), { registry });
  const out = { status: 'not-started', passed: false, error: null, state: [] };
  try {
    let staged;
    try { requireWorkflow(workflow, { registry, modelPolicy: foundry.modelPolicy }); staged = foundry.store.stageEvaluationWorkflow(workflow); }
    catch (error) { out.status = 'invalid'; out.error = { ...errorData(error), details: error.details ?? null }; return out; }
    out.state = copyState(app.foundry.store, foundry.store, workflow.id);
    let run;
    try { run = foundry.createRun(staged.hash, input); }
    catch (error) { out.status = 'input-refused'; out.error = { ...errorData(error), details: error.details ?? null }; return out; }
    await foundry.startRun(run.id).catch(() => {});
    const current = foundry.publicRun(foundry.store.run(run.id));
    out.run = current; out.status = current.status;
    out.passed = current.status === 'succeeded' && current.verdict?.verdict === 'pass';
    out.error = current.error ?? null;
    out.explained = explainRun(current, workflow, foundry.store.events(run.id));
    const world = readWorld(worldDir);
    out.effects = {
      outbox: readOutbox(outboxDir).filter(m => m.runId === run.id).map(m => ({ to: m.to, subject: m.subject, body: m.body })),
      chat: Object.fromEntries(Object.entries(world.chat).map(([c, posts]) => [c, posts.filter(p => p.runId === run.id).map(p => p.text)]).filter(([, p]) => p.length)),
      appended: Object.fromEntries(Object.entries(world.sheets).map(([name, rows]) => [name, rows.slice((sheets[name] ?? []).length)]).filter(([, r]) => r.length))
    };
    return out;
  } finally {
    await foundry.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
