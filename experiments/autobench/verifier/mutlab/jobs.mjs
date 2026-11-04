#!/usr/bin/env node
// Move 4 step 1: build the replay jobs of the free-label lab from the officially passing stored dev60 worlds.
//
//   node jobs.mjs --vlab <stored dev60 lab dir> --out <work dir> [--arms m3-a1c,sonnet-a1,...] [--limit-seeds N]
//
// Seeds: the canonical, officially passing rows of the reported dev60 arms (labio.REPORTED_ARMS by default). Per seed:
// one control (the stored call log as is, on the stored initial world), the trajectory mutants of mutate.mjs and the world
// twins of twins.mjs; per task one noop. Writes <out>/jobs.jsonl (replay_batch.py input), <out>/twins/<id>.json.gz (twin
// initial worlds) and <out>/manifest.json ({jobs: {id: {seed, task, arm, kind, op, cls, intended|expect, note}}, seeds,
// inputs: sha256 of every file read}). Labels are read only to choose the seeds (official pass) and are not written.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { REPORTED_ARMS, fileSha, labelPass, loadLab, stepsOf, underRun, worldEmails } from './labio.mjs';
import { MUTATE_VERSION, isWrite, mutantsOf, noop } from './mutate.mjs';
import { TWINS_VERSION, collectionsOf, twinsOf } from './twins.mjs';
import { readGz } from './labio.mjs';

const NAME_KEYS = ['name', 'title', 'Name', 'company', 'full_name', 'display_name', 'subject', 'summary'];
/** Id-records of a world for the operators: [{app, coll, id, name}] (name: the first display-name field, or null). */
export function recordsOf(world0) {
  return collectionsOf(world0).flatMap(c => c.records.map(x => ({ app: c.app, coll: c.coll, id: x.id, name: NAME_KEYS.map(k => x[k]).find(v => typeof v === 'string' && v.trim()) ?? null })));
}

export function buildJobs({ vlab, arms = REPORTED_ARMS, limitSeeds = null }) {
  const rows = loadLab(vlab, { arms });
  const seeds = rows.filter(labelPass).sort((a, b) => (a.rowId < b.rowId ? -1 : 1)).slice(0, limitSeeds ?? undefined);
  const jobs = [], meta = {}, twinWorlds = [], inputs = { 'dataset.jsonl': fileSha(path.join(vlab, 'dataset.jsonl')) };
  const tasksDone = new Set();
  seeds.forEach((r, si) => {
    const sid = `s${String(si).padStart(3, '0')}`;
    // A read's stored result is not needed for id carry-forward (the stored initial world keeps setup ids; ids a session
    // creates come back on the write that creates them), so only writes keep `orig`: the job file stays small.
    const steps = stepsOf(r).map(st => ({ calls: st.calls.map(c => (isWrite(c) ? c : { ...c, orig: null })) }));
    const w0path = path.join(vlab, r.worlds.initial);
    const world0 = readGz(w0path);
    inputs[r.worlds.initial] = fileSha(w0path);
    inputs[`${r.rowId}/calls.jsonl`] = fileSha(path.join(r.source.host, 'calls.jsonl'));
    if (!underRun(r.source?.prep, r.run, 'prep')) throw new Error(`jobs: no allowed prep directory for ${r.rowId}`);
    const input = path.join(path.resolve(r.source.prep), 'input.json');
    const base = { seed: sid, seedRow: r.rowId, task: r.task, arm: r.arm };
    const add = (id, j, m) => { jobs.push({ id, input, world0: w0path, ...j }); meta[id] = { ...base, ...m }; };
    add(`${sid}__control`, { steps }, { kind: 'control', op: 'control', cls: 'control', intended: 'equivalent', note: 'stored call log' });
    const ctx = { seed: r.rowId, worldEmails: worldEmails(world0), records: recordsOf(world0) };
    const ms = mutantsOf(steps, ctx);
    const k = {};
    for (const m of ms) {
      k[m.op] = (k[m.op] ?? 0) + 1;
      add(`${sid}__${m.op}${k[m.op] > 1 ? k[m.op] : ''}`, { steps: m.steps }, { kind: 'mutant', op: m.op, cls: m.cls, intended: m.intended, note: m.note, ...(m.sub ? { sub: m.sub } : {}) });
    }
    for (const t of twinsOf(world0, steps, { seed: r.rowId })) {
      const id = `${sid}__twin_${t.twin}`;
      twinWorlds.push({ id, world0: t.world0 });
      jobs.push({ id, input, world0: `twins/${id}.json.gz`, steps });
      meta[id] = { ...base, kind: 'twin', op: t.twin, cls: t.cls, expect: t.expect, note: t.note };
    }
    if (!tasksDone.has(r.task)) {
      tasksDone.add(r.task);
      for (const m of noop()) add(`${sid}__noop`, { steps: m.steps }, { kind: 'mutant', op: m.op, cls: m.cls, intended: m.intended, note: m.note });
    }
  });
  return { jobs, meta, twinWorlds, seeds: seeds.map(r => ({ rowId: r.rowId, task: r.task, arm: r.arm })), inputs };
}

async function main() {
  const { values: a } = parseArgs({ options: { vlab: { type: 'string' }, out: { type: 'string' }, arms: { type: 'string' }, 'limit-seeds': { type: 'string' } } });
  if (!a.vlab || !a.out) { console.error('usage: node jobs.mjs --vlab <dir> --out <dir> [--arms a,b] [--limit-seeds N]'); process.exit(2); }
  const out = path.resolve(a.out);
  mkdirSync(path.join(out, 'twins'), { recursive: true });
  const r = buildJobs({ vlab: path.resolve(a.vlab), arms: a.arms ? a.arms.split(',') : REPORTED_ARMS, limitSeeds: a['limit-seeds'] ? Number(a['limit-seeds']) : null });
  for (const t of r.twinWorlds) writeFileSync(path.join(out, 'twins', `${t.id}.json.gz`), gzipSync(JSON.stringify(t.world0)));
  writeFileSync(path.join(out, 'jobs.jsonl'), r.jobs.map(j => JSON.stringify({ ...j, world0: j.world0.startsWith('twins/') ? path.join(out, j.world0) : j.world0 })).join('\n') + '\n');
  const counts = {};
  for (const m of Object.values(r.meta)) counts[m.op] = (counts[m.op] ?? 0) + 1;
  writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ versions: { mutate: MUTATE_VERSION, twins: TWINS_VERSION }, arms: a.arms ?? REPORTED_ARMS.join(','), seeds: r.seeds, counts, jobs: r.meta, inputs: r.inputs }, null, 1));
  console.log(JSON.stringify({ seeds: r.seeds.length, tasks: new Set(r.seeds.map(s => s.task)).size, jobs: r.jobs.length, counts }));
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
