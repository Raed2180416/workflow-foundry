// The app adapter of the tracker: practice data, condition-targeted scenarios, and the RunView of a practice run (./checks.mjs).
//
// Practice workspace. The person's practice data is every template's practice sheets in one workspace, with every date moved so that
// each sheet keeps its age relative to one common "now" (a flow reads only the sheets it names; the others are inert). This is the
// same data a builder practises on (app/core/templates/*.json "practice"); it is never a hidden or live world.
//
// Runs per build (all $0, all practice):
//   base      the workflow once on the practice workspace
//   targeted  once more on the workspace plus condition-targeted rows (./scenarios.mjs): rows at the edges of each check's own filter
//   repeat    a second run on the world the base run left behind, one day later: "only once" and "nothing after that" are about the
//             next run, which one run cannot show
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Foundry } from '../../../src/foundry.mjs';
import { requireWorkflow } from '../../../src/validate.mjs';
import { errorData } from '../../../src/data.mjs';
import { appRegistry } from '../capabilities.mjs';
import { seedWorld, readWorld, readOutbox } from '../stand-ins.mjs';
import { runInWorld } from '../practice.mjs';
import { loadLibrary, practiceOf } from '../library.mjs';
import { normText } from './checks.mjs';

export const PRACTICE_NOW = '2026-10-20T09:00:00Z';
const DAY = 86_400_000;
const clone = v => structuredClone(v);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/, DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
function shiftValue(v, deltaMs) {
  if (typeof v !== 'string') return v;
  if (DATE_ONLY.test(v)) return new Date(Date.parse(`${v}T00:00:00Z`) + Math.round(deltaMs / DAY) * DAY).toISOString().slice(0, 10);
  if (DATE_TIME.test(v)) return new Date(Date.parse(v) + deltaMs).toISOString().replace('.000Z', 'Z');
  return v;
}

/** { now, sheets }: every template's practice sheets, dates aligned to `now`. Later templates never overwrite an earlier sheet name. */
export function practiceWorkspace({ library = loadLibrary(), now = PRACTICE_NOW } = {}) {
  const sheets = {};
  for (const t of library) {
    const p = practiceOf(t), delta = Date.parse(now) - Date.parse(p.input.now);
    for (const [name, rows] of Object.entries(p.sheets)) if (!sheets[name]) sheets[name] = rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, shiftValue(v, delta)])));
  }
  return { now, sheets };
}

/** Columns whose values tell rows apart (distinct text of 3+ characters, not dates, over 2+ rows): the names effects use for a row. */
export function namingColumns(rows) {
  if (rows.length < 2) return [];
  const cols = new Set(rows.flatMap(r => Object.keys(r)));
  return [...cols].filter(c => {
    const vals = rows.map(r => r[c]).filter(v => typeof v === 'string' && normText(v).length >= 3 && !/^\d{4}-\d{2}-\d{2}/.test(v));
    return vals.length === rows.length && new Set(vals.map(normText)).size === vals.length;
  });
}

/** RunView of one app run: sources from the sheets the run started with, effects from what it left (outbox, chat, appended rows). */
export function viewOf(result, { id, sheets, now }) {
  const sources = {};
  for (const [name, rows] of Object.entries(sheets ?? {})) {
    const naming = namingColumns(rows);
    sources[name] = rows.map((r, i) => ({ id: `${name}#${i}`, at: null, names: naming.map(c => r[c]), fields: r }));
  }
  const effects = [];
  let seq = 0;
  const add = (channel, fields, text) => effects.push({ id: `${id}:e${++seq}`, seq, at: now, channel, status: 'applied', fields, text });
  for (const m of result?.effects?.outbox ?? []) add('email', { to: m.to, subject: m.subject, body: m.body }, `${m.to}\n${m.subject}\n${m.body}`);
  for (const [channel, posts] of Object.entries(result?.effects?.chat ?? {})) for (const text of posts) add('chat', { channel, text }, `${channel}\n${text}`);
  for (const [sheet, rows] of Object.entries(result?.effects?.appended ?? {})) for (const row of rows) add('row', { sheet, row }, `${sheet}\n${Object.values(row).map(v => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join('\n')}`);
  return { id, now, horizon: null, ordered: false, sources, effects, run: { status: result?.status ?? null, verdict: result?.verdict ?? null, passed: !!result?.passed, error: result?.error?.code ?? null } };
}

/** Join two consecutive runs into one view (the repeat view): the first run's sources, both runs' effects in order. Each effect keeps the
 *  index of the run it came from (`run`: 0 or 1); only v4's per-run count reads it (./checks.mjs evalCount, ./semantics.mjs R-per-run). */
export function joinViews(a, b, id = 'repeat') {
  const offset = a.effects.length;
  return { ...a, id, effects: [...a.effects.map(e => ({ ...e, run: 0 })), ...b.effects.map((e, i) => ({ ...e, id: `${id}:${e.id}`, seq: offset + i + 1, run: 1 }))], run: b.run, runs: [a.run, b.run] };
}

/**
 * practiceViews(workflow, { practice, scenarioRows, repeat }) → { views: [base, targeted?, repeat?], base: runResult }.
 * scenarioRows(baseView) → { <sheet>: [rows] } lets the caller build targeted rows from what the base run acted on.
 */
export async function practiceViews(workflow, { practice = practiceWorkspace(), scenarioRows = null, repeat = true, root = null } = {}) {
  // A library flow takes { now } and reads the sheets; another flow (the preview weekly report) takes its own practice input.
  const input = practice.input ?? { now: practice.now };
  const base = await runInWorld(workflow, { sheets: clone(practice.sheets), input, mode: 'practice', root });
  const views = [viewOf(base, { id: 'base', sheets: practice.sheets, now: practice.now })];
  const extra = scenarioRows ? scenarioRows(views[0]) : null;
  if (extra && Object.values(extra).some(r => r.length)) {
    const sheets = clone(practice.sheets);
    for (const [name, rows] of Object.entries(extra)) sheets[name] = [...(sheets[name] ?? []), ...rows];
    const t = await runInWorld(workflow, { sheets: clone(sheets), input, mode: 'practice', root });
    views.push(viewOf(t, { id: 'targeted', sheets, now: practice.now }));
  }
  if (repeat && ['succeeded', 'failed', 'uncertain'].includes(base.status)) {
    const later = practice.now ? new Date(Date.parse(practice.now) + DAY).toISOString().replace(".000Z", "Z") : null;
    const [r1, r2] = await runSequence(workflow, { sheets: practice.sheets, inputs: [input, later ? { ...input, now: later } : input], root });
    if (r1 && r2) views.push(joinViews(viewOf(r1, { id: 'repeat-1', sheets: practice.sheets, now: practice.now }), viewOf(r2, { id: 'repeat-2', sheets: r1.world.sheets, now: later })));
  }
  return { views, base };
}

/**
 * Run the same workflow version several times in ONE practice world and ONE store, as a person's workspace would: sheets the first run
 * appended and the flow's own remembered state (state nodes, kept by the store) are there for the next run. Same rules as
 * app/core/practice.mjs runInWorld in practice mode (that function makes a fresh world per call, so it cannot show the next run).
 */
export async function runSequence(workflow, { sheets = {}, inputs = [], root = null } = {}) {
  const dir = mkdtempSync(path.join(root ?? tmpdir(), 'foundry-tracker-seq-'));
  const worldDir = path.join(dir, 'world'), outboxDir = path.join(dir, 'outbox');
  mkdirSync(worldDir, { recursive: true, mode: 0o700 });
  seedWorld(worldDir, { sheets: clone(sheets) });
  const registry = appRegistry({ mode: 'practice', outboxDir, worldDir });
  const foundry = new Foundry(path.join(dir, 'store'), { registry });
  const out = [];
  try {
    let staged;
    try { requireWorkflow(workflow, { registry, modelPolicy: foundry.modelPolicy }); staged = foundry.store.stageEvaluationWorkflow(workflow); }
    catch (error) { return inputs.map(() => ({ status: 'invalid', error: errorData(error), effects: { outbox: [], chat: {}, appended: {} }, world: { sheets } })); }
    let before = clone(sheets);
    for (const input of inputs) {
      let run;
      try { run = foundry.createRun(staged.hash, input); }
      catch (error) { out.push({ status: 'input-refused', error: errorData(error), effects: { outbox: [], chat: {}, appended: {} }, world: { sheets: before } }); continue; }
      await foundry.startRun(run.id).catch(() => {});
      const current = foundry.publicRun(foundry.store.run(run.id));
      const world = readWorld(worldDir);
      const effects = {
        outbox: readOutbox(outboxDir).filter(m => m.runId === run.id).map(m => ({ to: m.to, subject: m.subject, body: m.body })),
        chat: Object.fromEntries(Object.entries(world.chat).map(([c, posts]) => [c, posts.filter(p => p.runId === run.id).map(p => p.text)]).filter(([, p]) => p.length)),
        appended: Object.fromEntries(Object.entries(world.sheets).map(([name, rows]) => [name, rows.slice((before[name] ?? []).length)]).filter(([, r]) => r.length)),
      };
      out.push({ status: current.status, verdict: current.verdict?.verdict ?? null, passed: current.status === 'succeeded' && current.verdict?.verdict === 'pass', error: current.error ?? null, effects, world });
      before = clone(world.sheets);
    }
    return out;
  } finally {
    await foundry.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
