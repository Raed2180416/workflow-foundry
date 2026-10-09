// Decidability audit (JUDGE-PROGRAM.md §2.7 steps 1, 2, 3, 8) and leakage re-checks over the BUILT wave-A Kev files.
// Development evidence. Prints and writes counts, rates and hashes only (never state or question text), for every slice:
//   step 1  state-only solver agreement on up to 500 hard-label rows per (port, family, slice), where a solver exists
//   step 2  masked-state collisions: rows grouped by skeleton(renderState(state), masks) + question; share of groups with
//           more than one label (gate < 1%); exact-state collisions (gate 0)
//   step 3  time of decision: every top-level state key is declared by the port contract
//   step 8  class support: rows and distinct forms per label
//   leakage forbidden keys, cross-build stateHash overlap, the final span registry (every group's held-out spans) against
//           every train-like state of every build, held-out wordings outside their slice
//   node experiments/kev-data/out/assembly/audit-wave-a.mjs <summaries dir> <out.json>
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { readKevFile } from '../../export-kev.mjs';
import { loadSpec, REPO_ROOT } from '../../lib/contracts.mjs';
import { skeleton, canonical, sha256 } from '../../lib/hash.mjs';
import { renderState } from '../../lib/render.mjs';
import { findForbiddenKeys, SpanRegistry, WordingGuard, TRAIN_LIKE } from '../../lib/leakage.mjs';
import { loadHeldout } from '../../build.mjs';
import { freezeBeds, frozenBeds } from '../../lib/pin.mjs';
import * as R1 from '../../solve/R1.mjs';
import * as R2 from '../../solve/R2.mjs';
import * as R3 from '../../solve/R3.mjs';
import * as R4 from '../../solve/R4.mjs';
import { makeSolverContext } from '../../solve/records-lib.mjs';
import * as SK from '../../solve/kinetics.mjs';
import * as SR from '../../solve/runbook.mjs';
import * as SQ from '../../solve/Q4.mjs';
import * as SF from '../../solve/failures.mjs';
import * as SB from '../../solve/bedtype.mjs';
import { loadBed, builtinLines } from '../../ports/records-notes.mjs';
import { loadBedFacts, ALL_BEDS } from '../../ports/crossfamily-bedtype.mjs';
import { recordsLines, citiesFor } from './assembly.mjs';

const [sumDir, outFile] = process.argv.slice(2);
const HELDOUT = path.join(REPO_ROOT, '.foundry', 'kev-data', 'heldout'), POOLS = path.join(REPO_ROOT, '.foundry', 'kev-data', 'pools', 'train');
const { contracts } = loadSpec();
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const portOf = qid => qid.split('~')[0].replace(/_present$/, '');
const maskNames = (text, { names = [], markers = [] } = {}) => [...names, ...markers].filter(Boolean).sort((a, b) => b.length - a.length).reduce((acc, n) => acc.split(n).join('<n>'), text).toLowerCase();
const firstQ = r => Object.values(r.questions)[0];
const isSoft = q => q.target !== undefined && q.target !== null;

const summaries = readdirSync(sumDir).filter(f => f.endsWith('.json') && !f.includes('.registry')).map(f => JSON.parse(readFileSync(path.join(sumDir, f), 'utf8'))).filter(s => s.dir && !s.error);
const builds = summaries.map(s => ({ group: s.group, dir: s.dir, manifest: JSON.parse(readFileSync(path.join(s.dir, 'manifest.json'), 'utf8')) }));

// solver contexts
const outRoot = path.dirname(builds[0].dir);
const frozen = freezeBeds(REPO_ROOT, { outRoot }), beds = frozenBeds(frozen);
const bed = await loadBed(beds);
const poolLines = ['R1', 'R2', 'R3', 'R4', 'X1', 'X5'].flatMap(p => readJsonl(path.join(POOLS, `${p}.jsonl`)));
const scCache = new Map();
const recordsSc = slice => {
  if (!scCache.has(slice)) {
    const ood = ['calib-ood', 'dev-ood', 'test-ood'].includes(slice);
    const lines = [...builtinLines(bed, true), ...poolLines, ...(ood ? recordsLines(HELDOUT, slice, contracts) : [])];
    scCache.set(slice, makeSolverContext(bed, lines, { cities: ood ? citiesFor(HELDOUT, slice) : [] }));
  }
  return scCache.get(slice);
};
const facts = await loadBedFacts(beds, { names: ALL_BEDS });
const corpus = ALL_BEDS.flatMap(b => facts[b].texts.map(t => ({ bed: b, text: t.text })));
// Second path for slot-carried train-pool lines (pools/README.md: the two labels of 18 templates share their words and the label
// sits in the filling). The records solver's line regex wildcards {ex}, {city_*}, {live_ref}/{void_ref}, so both twins match and it
// reports a conflict. Here a slot-carried line matches only if its filling is consistent with its label: the example date read in the
// line's order means the stated day and month, the team city's country uses that order, the referenced flag form is the system's own.
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const escRe = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function slotAwareLabels(sc, P, port, S, token) {
  const labels = new Set(), F = sc.render.FLAG_FORM?.[S];
  for (const line of sc.lines) {
    if (!line.slotCarried || line.port !== port || (line.system && line.system !== S) || !line.label) continue;
    let out = '', last = 0; const groups = [];
    for (const m of String(line.text).matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
      out += escRe(line.text.slice(last, m.index)); last = m.index + m[0].length;
      const n = m[1];
      if (n === 'S') out += escRe(S);
      else if (n === 'token') out += token ? escRe(token) : '[^\\n]+?';
      else if (n === 'ex') { out += '(\\d{1,4})/(\\d{1,2})/(\\d{1,4})'; groups.push('a', 'b', 'c'); }
      else if (n === 'ex_long') { out += '(\\d{1,2}) ([A-Z][a-z]+) \\d{4}'; groups.push('ld', 'lm'); }
      else if (n === 'month') { out += '([A-Z][a-z]+)'; groups.push('lm'); }
      else if (n === 'day') { out += '(\\d{1,2})'; groups.push('ld'); }
      else if (n === 'city_us' || n === 'city_eu' || n === 'server') { out += '([A-Z][A-Za-z .\'-]*?)'; groups.push('city'); }
      else if (n === 'live_ref' || n === 'void_ref') { out += '([^\\n]+?)'; groups.push(n); }
      else if (n === 'year') out += '\\d{4}';
      else if (n === 'w0' || n === 'w1' || n === 'field') out += '[^\\n]+?';
      else out += '[^\\n]+?';
    }
    const m = new RegExp(out + escRe(line.text.slice(last))).exec(P);
    if (!m) continue;
    const g = {}; groups.forEach((k, i) => { g[k] = m[i + 1]; });
    let ok = true;
    if (g.a !== undefined) {
      const L = line.order ?? line.label, a = Number(g.a), b = Number(g.b), c = Number(g.c);
      const [day, month] = L === 'ymd' ? [c, b] : L === 'dmy' ? [a, b] : [b, a];
      if (L === 'ymd' && String(g.a).length !== 4) ok = false;
      if (L !== 'ymd' && a === b) ok = false;
      if (g.lm !== undefined && MONTHS.indexOf(String(g.lm).toLowerCase()) + 1 !== month) ok = false;
      if (g.ld !== undefined && Number(g.ld) !== day) ok = false;
      if (g.lm === undefined && g.ld === undefined) ok = false;
    }
    if (g.city !== undefined && sc.cityOrder.get(g.city.trim()) !== line.label) ok = false;
    if (g.live_ref !== undefined && (!F || g.live_ref !== F.live)) ok = false;
    if (g.void_ref !== undefined && (!F || g.void_ref !== F.void)) ok = false;
    if (ok) labels.add(line.label);
  }
  return labels;
}
const withSecondPath = (solve, port) => (r, s) => {
  const o = solve({ state: r.state, question: firstQ(r) }, recordsSc(s));
  if (o.label !== null || !String(o.reason ?? '').startsWith('conflict')) return o;
  const sc = recordsSc(s), noSlot = { ...sc, lines: sc.lines.filter(l => !l.slotCarried), cache: new Map() };
  const base = solve({ state: r.state, question: firstQ(r) }, noSlot);
  const P = String(r.state.source_note ?? '').split(/\n\s*\n/).map(b => b.trim()).find(b => b.startsWith(`${r.state.system}. `)) ?? '';
  const sl = slotAwareLabels(sc, P, port, r.state.system, r.state.marker);
  const all = new Set([...sl, ...(base.label ? [base.label] : [])]);
  return all.size === 1 ? { label: [...all][0], reason: 'second-path:slot-carried' } : { label: null, reason: `${o.reason}+second-path:${[...all].join('/') || 'none'}` };
};
const SOLVERS = {
  R1: withSecondPath(R1.solve, 'R1'), R2: withSecondPath(R2.solve, 'R2'), R3: withSecondPath(R3.solve, 'R3'), R4: withSecondPath(R4.solve, 'R4'),
  'X3:kinetics': r => SK.solveX3(r.state), 'X8:kinetics': r => SK.solveX8(r.state), 'K2:kinetics': r => SK.solveK2(r.state), 'K3:kinetics': r => SK.solveK3(r.state), 'X4:kinetics': r => SK.solveX4(r.state),
  'X1:kinetics': r => SK.solveX1(r.state),
  'Q4:runbook': r => SR.solveQ4(r.state),
  // authored pool / held-out lines carry the label of their brief (two-model filter pending); the bed-frame solver reads bed rows only
  'X1:runbook': r => (r.meta.surface?.source === 'bed' ? SR.solveX1(r.state) : { label: null, reason: `authored-line:${r.meta.surface?.source}` }),
  'Q4:gridquest': r => SQ.solveQ4(r.state), 'Q4:gameqa': r => SQ.solveQ4(r.state),
  F1: r => SF.solveF1(r.state), 'X1:codefix': r => SF.solveX1Codefix(r.state, { pool: poolLines.filter(l => l.port === 'X1' && l.family === 'codefix') }),
  'X5:bedtype:records': null,
};
const solverFor = (port, fam) => SOLVERS[`${port}:${fam}`] ?? SOLVERS[port] ?? (port === 'X5' && String(fam).startsWith('bedtype:') ? (r => SB.solveX5(r.state, firstQ(r), { corpus })) : null);

// the final registry: the heldout-author registry + every group's registered spans (union of the per-group registries)
const { wordings } = loadHeldout(HELDOUT);
const regEntries = new Map();
let regMasks = null;
for (const f of readdirSync(sumDir).filter(x => x.endsWith('.registry.json'))) {
  const j = JSON.parse(readFileSync(path.join(sumDir, f), 'utf8'));
  regMasks ??= j.masks;
  for (const e of j.entries) regEntries.set(`${e.hash}|${e.slice}|${e.source ?? ''}|${e.port ?? ''}|${e.kind ?? ''}`, e);
}
const finalRegistry = SpanRegistry.fromJSON({ version: 1, masks: regMasks, entries: [...regEntries.values()] });

const out = { generatedBy: 'experiments/kev-data/out/assembly/audit-wave-a.mjs', builds: {}, crossBuild: {}, registry: { n: finalRegistry.size, digest: finalRegistry.digest } };
const stateOwner = new Map(), overlaps = {};
for (const b of builds) {
  const ob = out.builds[b.group] = { buildId: b.manifest.buildId, slices: {} };
  for (const [slice, info] of Object.entries(b.manifest.slices)) {
    const recs = readKevFile(path.join(b.dir, info.files.kev.path));
    const os = ob.slices[slice] = { records: recs.length, ports: {} };
    let forbidden = 0, regHits = 0, wordingHits = 0;
    const byPort = new Map();
    for (const r of recs) {
      if (findForbiddenKeys(r.state).length) forbidden++;
      const sh = r.meta.stateHash, o = stateOwner.get(sh);
      if (o && (o.group !== b.group || o.slice !== slice)) { const k = `${o.group}/${o.slice} x ${b.group}/${slice}`; overlaps[k] = (overlaps[k] ?? 0) + 1; } else if (!o) stateOwner.set(sh, { group: b.group, slice });
      if (TRAIN_LIKE.includes(slice)) { const m = r.meta.masks ?? {}; if (finalRegistry.scanState(r.state, { names: m.names ?? [], markers: m.markers ?? [], slice }).length) regHits++; }
      for (const q of Object.values(r.questions)) if (wordings.check(q.instructions, slice).length) wordingHits++;
      // one row per (record, port) at the record's first question of that port
      const seen = new Set();
      for (const [qid, q] of Object.entries(r.questions)) {
        const p = portOf(qid); if (seen.has(p)) continue; seen.add(p);
        const k = `${p}:${r.meta.family}`;
        (byPort.get(k) ?? byPort.set(k, []).get(k)).push({ r, q, qid, port: p });
      }
    }
    Object.assign(os, { forbiddenKeyRecords: forbidden, registryHitsTrainLike: TRAIN_LIKE.includes(slice) ? regHits : 'n/a (rule 7 checks train, calib-in, dev-select; OOD slices were checked at build time)', heldoutWordingOutsideSlice: wordingHits });
    for (const [k, rows] of [...byPort.entries()].sort()) {
      const [port, ...famParts] = k.split(':'), fam = famParts.join(':'), c = contracts[port];
      const hard = rows.filter(x => !isSoft(x.q));
      // step 1
      const solver = solverFor(port, fam);
      let s1 = null;
      if (solver) {
        const step = Math.max(1, Math.floor(hard.length / 500)), sample = hard.filter((_, i) => i % step === 0).slice(0, 500);
        let decided = 0, agree = 0; const reasons = {};
        for (const x of sample) {
          let o; try { o = solver({ state: x.r.state, questions: { [x.qid]: x.q }, meta: x.r.meta }, slice); } catch (e) { o = { label: null, reason: `throws:${e.code ?? 'error'}` }; }
          if (o?.label === null || o?.label === undefined) { const why = String(o?.reason ?? o?.rule ?? 'undecided').slice(0, 40); reasons[why] = (reasons[why] ?? 0) + 1; continue; }
          decided++; if (o.label === x.q.label) agree++; else reasons['disagree'] = (reasons['disagree'] ?? 0) + 1;
          if (o.reason === 'second-path:slot-carried') reasons['decided-by-second-path'] = (reasons['decided-by-second-path'] ?? 0) + 1;
        }
        s1 = { n: sample.length, decided, agree, coverage: sample.length ? decided / sample.length : null, accuracyDecided: decided ? agree / decided : null, agreementAll: sample.length ? agree / sample.length : null, reasons };
      }
      // step 2
      // gate key (as the group tests): the world's names and markers masked (entity identity removed); the full lib/hash skeleton
      // (digits, dates, quoted strings masked too) is diagnostic only: it merges rows whose label sits in a number (X8 values, Q4
      // thresholds, R1 example dates, K2 conditions), which the state does tell apart
      const groups = new Map(), named = new Map(), exact = new Map(), add = (m, key, l) => (m.get(key) ?? m.set(key, new Set()).get(key)).add(l);
      for (const x of hard) {
        const m = x.r.meta.masks ?? { names: [], markers: [] };
        add(groups, `${skeleton(renderState(x.r.state), m)}||${x.q.instructions}`, x.q.label);
        add(named, maskNames(`${renderState(x.r.state)}||${x.q.instructions}`, m), x.q.label);
        add(exact, `${canonical(x.r.state)}||${x.q.instructions}`, x.q.label);
      }
      const multi = mm => [...mm.values()].filter(v => v.size > 1).length;
      // step 3
      const declared = new Set(Object.keys(c?.state?.keys ?? {}).map(s => s.split('.')[0]));
      const undeclared = new Set(); for (const x of rows) for (const key of Object.keys(x.r.state)) if (!declared.has(key)) undeclared.add(key);
      // step 8 and labels
      const labels = {}, forms = {};
      for (const x of rows) { labels[x.q.label] = (labels[x.q.label] ?? 0) + 1; (forms[x.q.label] ??= new Set()).add(x.r.meta.formId ?? sha256(skeleton(renderState(x.r.state), x.r.meta.masks ?? {}))); }
      os.ports[k] = { rows: rows.length, soft: rows.length - hard.length, labels, formsPerLabel: Object.fromEntries(Object.entries(forms).map(([l, s]) => [l, s.size])),
        step1: s1, step2: { groups: named.size, nameMaskedMultiLabel: multi(named), nameMaskedShare: named.size ? multi(named) / named.size : 0, skeletonGroups: groups.size, skeletonMultiLabel: multi(groups), skeletonShare: groups.size ? multi(groups) / groups.size : 0, exactMultiLabel: multi(exact) },
        step3: { undeclaredKeys: [...undeclared] } };
    }
  }
}
out.crossBuild.stateOverlaps = overlaps;
writeFileSync(outFile, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${outFile}`);
