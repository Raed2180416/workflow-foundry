// DUR-1 LD-H: runs expose flaws in a hand-crafted workflow (PREREG-DUR-1 §5 LD-H, §8.4, D-8; BUILD-PLAN row 13).
// The six admitted latent defects of E8 (beds/ebed/e8/ledger/latent-defects/ld-*.json: E0-silent reference mutants that
// fail later) run as programs: the analyst-side reference policy driven by the mutated copy of transition.mjs (the file a
// patcher edits; arms.mjs transitionVersion). Each defect's manifest worlds (seeds 1101-1102 at its band difficulties) are
// one stream, run by stream.mjs's §6 loop unchanged (identical for MH-H, REF-M and LD-H): contracts and errors are
// m1-m3; the manifests' planted complaints (16 true, 16 false in all) are m5 (fixed, whatever the version does: the
// `complaintsFor` hook); a single complaint never opens an incident (rule 4 needs >= 2 on a topic within 3 world-days).
//
// Analysis ($0): HEALED = the final version passes the manifest's `after` set on a replay of every manifest world, with
// 0 regressions against the mutant; where every `after` set of a defect is empty, its `before` sets are used instead (a
// vacuous `after` would let an unchanged mutant count as healed; a stricter reading than the prereg's words, disclosed in
// BUILD-NOTES). DURABLE = healed and no rollback after the last promotion. FALSE-COMPLAINT HARM = a promotion whose
// incidents include a false complaint and whose promoted version fails a case its incumbent passed. The K5 sweep's
// precision and recall are scored against the manifests' `before` sets.
// Disclosed (threat 10): LD-H's programs are mutated references (the oracle core with one edit), unusually well
// structured for "hand-crafted" code, and they read world truth as the reference does.
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildBundle, ROOT, once } from './changes.mjs';
import { referencePools, gradeRun } from './oracle.mjs';
import { runBundle, transitionVersion } from './arms.mjs';
import { runStream } from './stream.mjs';
import { sweepStream } from './sweep.mjs';

const DIR = path.join(ROOT, 'beds/ebed/e8/ledger/latent-defects');
const TRANSITION = path.join(ROOT, 'beds/ebed/e8/transition.mjs');
export const LATENT = Object.freeze(['ld-k0', 'ld-k8', 'ld-k9', 'ld-k11', 'ld-k118', 'ld-k149']);
export const manifestOf = id => {
  if (!LATENT.includes(id)) throw new Error(`DUR1_LD: ${id} is not an admitted latent defect`);
  return JSON.parse(readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
};

/** The mutated transition source of a latent defect (its one edit, anchored exactly once). */
export function mutantSource(m) {
  if (m.mutant.kind !== 'transition') throw new Error(`${m.id}: only transition mutants are LD-H programs`);
  return once(readFileSync(TRANSITION, 'utf8'), m.mutant.from, m.mutant.to, `${m.id} mutant`);
}
export const mutantVersion = m => transitionVersion(mutantSource(m), { id: `${m.id}.mutant` });

/** The manifest worlds of a defect as stream specs (k in manifest order; no DUR changes). */
export const ldWorlds = m => m.worlds.map((w, i) => Object.freeze({ stream: `ld-${m.id}`, k: i + 1, seed: w.seed, size: null, difficulty: w.difficulty, mix: w.mix ?? 'tail', changes: [], world: w }));

/** Complaint topic of a manifest claim (the five DUR-1 topics; record and status claims are 'status'). */
export function topicOfClaim(p) {
  const s = `${p?.subject ?? ''} ${(p?.fields ?? []).join(' ')}`;
  if (/refund/i.test(s)) return 'refund';
  if (/charge|payment/i.test(s)) return 'charge';
  if (/notification|template/i.test(s)) return 'notice';
  if (/shipment|delivery|collection|carrier/i.test(s)) return 'delivery';
  return 'status';
}

/** The manifest's planted complaints of one world: true (reveal.event) and false (falseReveal.event). */
export function manifestComplaints(w, bundle) {
  if (bundle.W.id !== w.world) throw new Error(`DUR1_LD: bundle ${bundle.W.id} is not manifest world ${w.world}`);
  const out = [];
  for (const [kind, x] of [['true', w.reveal], ['false', w.falseReveal]]) {
    const ev = x?.event;
    if (!ev) continue;
    out.push({ id: ev.id, kind, world: bundle.key, case: x.case, order: ev.payload?.orderRef ?? bundle.W.truth.cases[x.case]?.subject ?? null, topic: topicOfClaim(ev.payload), at: Date.parse(ev.at), carried: false, text: String(ev.payload?.text ?? '') });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** A $0 stub LD patcher: 'revert' applies the inverse of the defect's edit (the true fix); 'noop' changes nothing. */
export const stubLD = (mode, m) => ({ kind: 'stub', mode: `ld-${mode}`, fn: async ({ workdir }) => {
  if (mode === 'revert') {
    const f = path.join(workdir, 'transition.mjs');
    const s = readFileSync(f, 'utf8');
    if (s.includes(m.mutant.to)) writeFileSync(f, s.replace(m.mutant.to, () => m.mutant.from));
  }
  return { costUsd: 0, turns: 0 };
} });

/**
 * runLD({ id, heal, co, runDir, maxWorlds, log, spendFile }) → { record (stream), analysis }. `heal` is stream.mjs's
 * heal config ({ session(kind, { scope }) }); `co` the contract owner (rule 4).
 */
export async function runLD({ id, heal, co = null, runDir, maxWorlds = Infinity, log = () => {}, spendFile = null }) {
  const m = manifestOf(id);
  const specs = ldWorlds(m).slice(0, maxWorlds);
  mkdirSync(runDir, { recursive: true });
  const start = await mutantVersion(m);
  const record = await runStream({ arm: 'heal', label: `LD-H.${id}`, start, worlds: specs, heal, co, runDir, log, spendFile,
    complaintsFor: ({ spec, bundle }) => manifestComplaints(spec.world, bundle) });
  const analysis = await analyzeLD({ m, specs, record, start });
  writeFileSync(path.join(runDir, `LD-H.${id}.analysis.json`), JSON.stringify(analysis, null, 1));
  log(`LD-H ${id}: healed ${analysis.healed}, durable ${analysis.durable}, regressions ${analysis.regressions}, false-complaint harm ${analysis.falseComplaintHarm}`);
  return { record, analysis };
}

/** The $0 LD-H analysis of one defect's stream record (see the header). */
export async function analyzeLD({ m, specs, record, start }) {
  const versions = record.versionMap;
  const final = versions.get(record.final.digest) ?? start;
  const cache = new Map();
  const gradeOf = async (v, spec) => {
    const key = `${v.digest}|${spec.k}`;
    if (!cache.has(key)) {
      const b = await buildBundle(spec);
      const ref = await referencePools(b);
      const g = gradeRun(b, (await runBundle(b, { version: v })).rows, ref.pools);
      cache.set(key, new Map(g.cases.filter(c => c.graded).map(c => [c.case, c.pass])));
    }
    return cache.get(key);
  };
  const vacuous = specs.every(s => !(s.world.sweep?.after ?? []).length);
  const worlds = [];
  let regressions = 0, target = 0, targetPass = 0;
  for (const spec of specs) {
    const p0 = await gradeOf(start, spec), p1 = await gradeOf(final, spec);
    const set = vacuous ? (spec.world.sweep?.before ?? []) : (spec.world.sweep?.after ?? []);
    const reg = [...p0].filter(([c, ok]) => ok && p1.get(c) === false).map(([c]) => c);
    const pass = set.filter(c => p1.get(c) === true);
    regressions += reg.length; target += set.length; targetPass += pass.length;
    const streamed = record.worlds.find(w => w.k === spec.k)?.grade ?? {};
    worlds.push({ key: spec.world.world, set: vacuous ? 'before' : 'after', n: set.length, passFinal: pass.length, regressions: reg.slice(0, 20),
      streamedAfterPass: (spec.world.sweep?.after ?? []).filter(c => streamed[c]?.[0] === 1).length, streamedAfterN: (spec.world.sweep?.after ?? []).length });
  }
  const changed = final.digest !== start.digest;
  const healed = changed && target > 0 && targetPass === target && regressions === 0;
  const lastP = record.promotions.at(-1);
  const durable = healed && !record.rollbacks.some(r => lastP && (r.k > lastP.k || (r.k === lastP.k && r.day > lastP.day)));
  // False-complaint harm: a promotion led (in part) by a false complaint whose version fails a case its incumbent passed.
  const incidents = new Map(record.incidents.map(i => [i.id, i]));
  const promotions = [];
  for (const p of record.promotions) {
    const falseIds = p.incidents.flatMap(id => (incidents.get(id)?.complaints ?? []).filter(c => c.kind === 'false').map(c => c.id));
    let harm = false;
    if (falseIds.length) {
      const from = versions.get(p.from), to = versions.get(p.to);
      for (const spec of specs) {
        const a = await gradeOf(from, spec), b = await gradeOf(to, spec);
        if ([...a].some(([c, ok]) => ok && b.get(c) === false)) { harm = true; break; }
      }
    }
    promotions.push({ at: `${p.k}.${p.day}`, from: p.from, to: p.to, falseComplaints: falseIds, harm });
  }
  const before = new Map(specs.map(s => [s.world.world, s.world.sweep?.before ?? []]));
  const keyToWorld = new Map();
  for (const s of specs) keyToWorld.set((await buildBundle(s)).key, s.world.world);
  const sweep = record.promotions.length ? await sweepStream({ rec: record, specs, truthOf: key => before.get(keyToWorld.get(key)) ?? [] }) : { rows: [], pooled: null };
  const falseTotal = specs.filter(s => s.world.falseReveal?.event).length, trueTotal = specs.filter(s => s.world.reveal?.event).length;
  return {
    id: m.id, worlds, vacuousAfter: vacuous, changed, healed, durable, regressions, target, targetPass,
    promotions, falseComplaintHarm: promotions.filter(p => p.harm).length, complaints: { true: trueTotal, false: falseTotal },
    incidents: record.incidents.map(i => ({ id: i.id, kind: i.kind, cls: i.cls, status: i.status, sessions: i.sessions, complaints: i.complaints.map(c => c.kind) })),
    sweep: { pooled: sweep.pooled, rows: sweep.rows.slice(0, 40) },
    sessions: record.sessions.length, costUsd: record.sessions.reduce((s, x) => s + (x.session?.costUsd ?? 0), 0),
  };
}

/** D-8 over the six defects' analyses: pass iff >= 5 of 6 healed durably with 0 regressions and no false-complaint harm. */
export function d8(analyses) {
  const durable = analyses.filter(a => a.durable && a.regressions === 0).length;
  const harm = analyses.reduce((s, a) => s + a.falseComplaintHarm, 0);
  const falseN = analyses.reduce((s, a) => s + a.complaints.false, 0);
  const verdict = harm > 0 ? 'falsified' : analyses.length === LATENT.length && durable >= 5 ? 'pass' : 'fail';
  return { verdict, durable, of: analyses.length, falseComplaintHarm: harm, falseComplaints: falseN, partial: analyses.length !== LATENT.length };
}
