#!/usr/bin/env node
// $0 gates for the frozen WorkBench extras (EXTRAS.json; rule wb-extras-v1), through the full facade, aggregates only:
//   streams  gold replay of every stream instance (BG-1 for regenerated instances), the do-nothing floor, and two
//            naive-reuse floors: replay the stream's FIRST instance's gold on instances 2..10 (copy the first solution)
//            and replay the PREVIOUS instance's gold (copy the last solution). F-reuse has to beat these, not zero.
//   faults   each unit's gold through its declared fault or drift, by three scripted reaction policies: naive (ignores
//            errors), blind_retry (repeats any failed call once) and robust (retries a 503, renames a refused parameter
//            to the schema's, switches from a retired twin to the live tool, never repeats a write whose outcome is
//            unknown); distractor units also run a "distracted" agent that calls the retired twin first. A fault has teeth
//            when some policy fails on it, and is fair when the robust policy passes every unit.
// Per-row records stay host-only (HOST_ONLY/extras/parity/); EXTRAS-PARITY.json holds counts only.
//   node experiments/breadth/workbench/extras-parity.mjs [--sets streams,faults] [--concurrency 2]
import { existsSync } from 'node:fs';
import path from 'node:path';
import { goldItems, nothingItems } from './baselines.mjs';
import { toolOfAction } from './extras.mjs';
import { EXTRAS_JSON, FAULTS_MANIFEST, STREAMS_MANIFEST } from './freeze-extras.mjs';
import { HOST_ONLY, RESEARCH, readJson, sha256, writeJson, writeJsonl } from './lib.mjs';
import { cleanup, runDigest, runScriptedBatch } from './scripted.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const SETS = opt('sets', 'streams,faults').split(',');
const CONC = Number(opt('concurrency', 2));
const OUT = opt('out', path.join(RESEARCH, 'EXTRAS-PARITY.json'));
const DIR = path.join(HOST_ONLY, 'extras', 'parity');
const log = m => console.error(`[extras-parity ${new Date().toISOString().slice(11, 19)}] ${m}`);
const pct = (a, b) => (b ? Math.round((a / b) * 10000) / 100 : null);
const textOf = r => r?.content?.[0]?.text ?? '';

/** Scripted reaction policies (runScripted's policy hook). */
export const POLICIES = Object.freeze({
  naive: null,
  blind_retry: ({ step, result, attempt }) => (result.isError && attempt < 2 ? step : null),
  robust: ({ step, result, attempt, tools }) => {
    if (!result.isError || attempt >= 3) return null;
    const text = textOf(result);
    const m = /unknown parameter '([^']+)'/.exec(text);
    if (m) {
      // the error's hint if it names the expected parameter, else the schema's first parameter the call does not use
      const props = Object.keys(tools.find(t => t.name === step.name)?.inputSchema?.properties ?? {});
      const hint = /Expected parameters include '([^']+)'/.exec(text)?.[1];
      const to = hint && props.includes(hint) ? hint : props.find(p => !(p in (step.arguments ?? {})));
      if (!to) return null;
      return { ...step, arguments: Object.fromEntries(Object.entries(step.arguments).map(([k, v]) => [k === m[1] ? to : k, v])) };
    }
    if (/retired/.test(text) && step.name.endsWith('_v2')) return { ...step, name: step.name.slice(0, -3) };
    if (/503|temporarily unavailable/i.test(text)) return step;
    return null; // an unknown outcome (timeout): never repeat a write blindly
  },
});

if (import.meta.url === `file://${process.argv[1]}`) {
  const extras = readJson(EXTRAS_JSON);
  const res = existsSync(OUT) ? readJson(OUT) : {};
  Object.assign(res, { extrasSha256: extras.extrasSha256, at: new Date().toISOString(), concurrency: CONC });
  const run = async (items, tasksFile, tag) => {
    const r = await runScriptedBatch({ items, tasksFile, label: `extras-${tag}`, concurrency: CONC, log });
    const v = new Map(r.verdicts.map(x => [x.key, x]));
    const rows = r.rows.map(row => ({ key: row.key, id: row.id, kind: items.find(i => i.key === row.key)?.kind, correct: v.get(row.key).correct, correctSem: v.get(row.key).correct_sem ?? null,
      nativeAgree: v.get(row.key).agree, liveMatchesReplay: v.get(row.key).live_matches_replay, faultEvents: row.facade.faultEvents.map(e => e.fault), envFault: row.facade.envFault }));
    writeJsonl(path.join(DIR, `${tag}.jsonl`), rows);
    const digest = runDigest(r.rows, r.verdicts);
    cleanup(r.liveRoot);
    return { rows, digest };
  };

  if (SETS.includes('streams')) {
    const m = readJson(STREAMS_MANIFEST);
    if (sha256(JSON.stringify(m)) !== extras.streams.manifestSha256) throw new Error('streams manifest hash differs from EXTRAS.json');
    const inst = m.streams.flatMap(s => s.instances);
    const tasksFile = path.join(DIR, 'streams-tasks.jsonl');
    writeJsonl(tasksFile, inst);
    const items = [...goldItems(inst), ...nothingItems(inst)];
    for (const s of m.streams) {
      s.instances.forEach((t, k) => {
        if (k === 0) return;
        items.push({ key: `${t.id}:reuse_first`, kind: 'reuse_first', task: t, actions: s.instances[0].outcome });
        items.push({ key: `${t.id}:reuse_prev`, kind: 'reuse_prev', task: t, actions: s.instances[k - 1].outcome });
      });
    }
    const a = await run(items, tasksFile, 'streams-1'), b = await run(items, tasksFile, 'streams-2');
    const by = k => a.rows.filter(x => x.kind === k);
    const sum = rs => ({ n: rs.length, correct: rs.filter(x => x.correct).length, rate: pct(rs.filter(x => x.correct).length, rs.length), correctSem: rs.filter(x => x.correctSem).length });
    const nothingWrong = new Set(by('nothing').filter(x => !x.correct).map(x => x.id));
    res.streams = { gold: { ...sum(by('gold')), nativeAgree: by('gold').filter(x => x.nativeAgree).length, liveMatchesReplay: by('gold').filter(x => x.liveMatchesReplay).length },
      doNothing: sum(by('nothing')), stateChanging: nothingWrong.size,
      reuseFirst: { ...sum(by('reuse_first')), stateChanging: sum(by('reuse_first').filter(x => nothingWrong.has(x.id))) },
      reusePrev: { ...sum(by('reuse_prev')), stateChanging: sum(by('reuse_prev').filter(x => nothingWrong.has(x.id))) },
      perStream: Object.fromEntries(m.streams.map(s => { const ids = new Set(s.instances.map(i => i.id)); const rf = by('reuse_first').filter(x => ids.has(x.id)), rp = by('reuse_prev').filter(x => ids.has(x.id));
        return [s.template_id, { reuseFirst: rf.filter(x => x.correct).length, reusePrev: rp.filter(x => x.correct).length, of: rf.length }]; })),
      digestIdentical: a.digest === b.digest, digest: a.digest,
      pass: by('gold').every(x => x.correct && x.nativeAgree && x.liveMatchesReplay) && a.digest === b.digest };
    writeJson(OUT, res);
    log(`streams: gold ${res.streams.gold.correct}/${res.streams.gold.n}, reuse-first ${res.streams.reuseFirst.correct}/${res.streams.reuseFirst.n}, reuse-prev ${res.streams.reusePrev.correct}/${res.streams.reusePrev.n}`);
  }

  if (SETS.includes('faults')) {
    const m = readJson(FAULTS_MANIFEST);
    if (sha256(JSON.stringify(m)) !== extras.faults.manifestSha256) throw new Error('faults manifest hash differs from EXTRAS.json');
    const sealed = readJson(path.join(HOST_ONLY, 'sealed/MANIFEST.json'));
    const byId = new Map(sealed.instances.map(t => [t.id, t]));
    const tasksFile = path.join(DIR, 'faults-tasks.jsonl');
    writeJsonl(tasksFile, m.units.map(u => byId.get(u.id)));
    const items = [];
    for (const u of m.units) {
      const t = byId.get(u.id);
      for (const p of Object.keys(POLICIES)) items.push({ key: `${u.id}:${u.fault.kind}:${p}`, kind: `${u.fault.kind}|${p}`, task: t, actions: t.outcome, fault: u.fault, policy: POLICIES[p] });
      if (u.fault.kind === 'distractor') {
        // the distracted agent calls the retired twin in place of gold's first write (the action string names the twin;
        // the facade lists it, the bed never sees it)
        const i = t.outcome.findIndex(a => toolOfAction(a) === u.fault.like);
        const rewriteSteps = steps => steps.map((s, idx) => (idx === i ? { ...s, name: `${s.name}_v2` } : s));
        for (const p of ['naive', 'robust']) items.push({ key: `${u.id}:distracted:${p}`, kind: `distracted|${p}`, task: t, actions: t.outcome, rewriteSteps, fault: u.fault, policy: POLICIES[p] });
      }
    }
    const r = await run(items, tasksFile, 'faults');
    const table = {};
    for (const row of r.rows) { const [kind, p] = row.kind.split('|'); (table[kind] ??= {})[p] = (table[kind][p] ?? { n: 0, pass: 0 }); table[kind][p].n++; table[kind][p].pass += row.correct ? 1 : 0; }
    const teeth = Object.fromEntries(Object.entries(table).map(([k, v]) => [k, Object.values(v).some(x => x.pass < x.n)]));
    const fair = Object.fromEntries(Object.entries(table).map(([k, v]) => [k, v.robust ? v.robust.pass === v.robust.n : null]));
    res.faults = { n: m.units.length, table, teeth, fair, pass: Object.values(teeth).every(Boolean) && Object.values(fair).every(x => x !== false), envFaults: r.rows.filter(x => x.envFault).length, digest: r.digest };
    writeJson(OUT, res);
    log(`faults: ${JSON.stringify(table)}`);
  }
  writeJson(OUT, res);
  console.log(JSON.stringify({ streams: res.streams && { gold: `${res.streams.gold.correct}/${res.streams.gold.n}`, reuseFirst: res.streams.reuseFirst.rate, reusePrev: res.streams.reusePrev.rate, pass: res.streams.pass },
    faults: res.faults && { teeth: res.faults.teeth, fair: res.faults.fair, pass: res.faults.pass } }, null, 1));
}
