// CI-1 bed construction: per corpus item, sample candidate worlds from the item's generator, run the ORIGINAL graph on them in the
// sandbox (reference 1), distil the hidden worlds that kill the most mutants, and admit the item only if an independent Foundry
// transliteration (reference 2) is equivalent to reference 1 on every candidate world (research/ci1-20261021/DOSSIER.md §4, §6).
//
// The bed lives OUTSIDE git (BED below): corpus-derived transliterations, the item descriptions and the hidden worlds are held out
// from builder development; git gets their sha256 digests (research/ci1-20261021/MANIFEST.json).
//   node experiments/ci1/bed.mjs check <id> [--n 40]   reference vs transliteration on candidates, mutation score, sample facts
//   node experiments/ci1/bed.mjs freeze <id...>         write bed/oracle/<id>.json (hidden + public worlds, reference canon, decl)
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadRaw } from './pool.mjs';
import { workflowOf } from '../../app/importers/n8n.mjs';
import { runSandboxed, bundle } from './sim/run.mjs';
import { runBuilt, validateCi1 } from './foundry-world.mjs';
import { canonFromSim, canonFromFoundry, equivalent, staticVocabulary, rowIdentities } from './canon.mjs';
import { mutants } from './mutants.mjs';
import * as genLib from './gen-lib.mjs';
const { rng } = genLib;

export const BED = process.env.CI1_BED ?? '/var/tmp/foundry-work/ci1-20261021/bed';
const sha = t => createHash('sha256').update(t).digest('hex');
export const itemDir = id => path.join(BED, 'items', String(id));

/** Documented minimal repairs of a corpus definition (placeholders the author left for the user, or an obvious data-loss defect):
 *  [{ node, set: { "parameters.a.b": value }, why }]. Every patch is listed in the result doc; the reference is "corpus graph + patches". */
export function applyPatches(workflow, patches) {
  const w = JSON.parse(JSON.stringify(workflow));
  for (const p of patches) {
    const n = w.nodes.find(x => x.name === p.node);
    if (!n) throw new Error(`patch: no node ${p.node}`);
    if (p.swapOutputs) { const m = (w.connections[p.node] ??= { main: [] }).main; while (m.length < 2) m.push([]); [m[0], m[1]] = [m[1], m[0]]; }
    for (const [dotted, value] of Object.entries(p.set ?? {})) {
      const parts = dotted.split('.'); let t = n;
      for (const k of parts.slice(0, -1)) { t[k] ??= {}; t = t[k]; }
      t[parts.at(-1)] = value;
    }
  }
  return w;
}

export async function loadItem(id) {
  const dir = itemDir(id);
  const spec = JSON.parse(readFileSync(path.join(dir, 'spec.json'), 'utf8'));
  const raw = loadRaw(id);
  if (spec.sha256 && spec.sha256 !== raw.sha256) throw new Error(`${id}: corpus file changed (${raw.sha256})`);
  const workflow = applyPatches(workflowOf(raw.doc), spec.patches ?? []);
  const gen =(await import(pathToFileURL(path.join(dir, 'gen.mjs')).href)).default;
  const tl = path.join(dir, 'ref.foundry.json');
  return { id: String(id), dir, spec, workflow, rawSha256: raw.sha256, gen, transliteration: existsSync(tl) ? JSON.parse(readFileSync(tl, 'utf8')) : null,
    description: existsSync(path.join(dir, 'description.md')) ? readFileSync(path.join(dir, 'description.md'), 'utf8') : null };
}
export function candidates(item, n = 40, seed = 1) {
  const out = [];
  for (let i = 0; i < n; i++) { const w = item.gen(rng(seed * 100003 + i * 7919 + Number(item.id)), i, genLib); out.push({ id: `c${String(i).padStart(2, '0')}`, event: null, ...w }); }
  return out;
}
export const sheetNames = world => Object.keys(world.sheets ?? {});
export function declFor(item, world, vocab = staticVocabulary(item.workflow)) {
  return { vocab, rows: rowIdentities(world, vocab), mask: item.spec.decl?.mask ?? {}, freeText: item.spec.decl?.freeText ?? {}, respondCode: !!item.spec.decl?.respondCode };
}
const binding = item => ({ trigger: item.spec.trigger, sheets: item.spec.binding?.sheets ?? {}, sheetKeys: item.spec.binding?.sheetKeys ?? {}, channels: item.spec.binding?.channels ?? {}, channelValues: item.spec.binding?.channelValues ?? {}, zone: item.spec.binding?.zone ?? 'UTC' });

export async function referenceCanon(item, worlds, workflows = [item.workflow], keep = 'first') {
  const rows = await runSandboxed({ workflows, worlds, binding: binding(item), keep, sheetsOut: worlds.flatMap(sheetNames) });
  return rows.map(r => ({ ...r, canon: canonFromSim(r, { sheets: sheetNames(worlds.find(w => w.id === r.world)) }) }));
}
export async function foundryCanon(workflow, world) { const r = await runBuilt(workflow, world); return { run: r, canon: canonFromFoundry(r, { sheets: sheetNames(world) }) }; }

export async function check(id, { n = 40, quiet = false } = {}) {
  const item = await loadItem(id);
  const vocab = staticVocabulary(item.workflow);
  const cands = candidates(item, n);
  const ref = await referenceCanon(item, cands);
  const again = await referenceCanon(item, cands);
  const deterministic = ref.every((r, i) => JSON.stringify(r.canon) === JSON.stringify(again[i].canon));
  const errors = ref.filter(r => !r.ok);
  const usable = cands.filter(w => item.spec.allowErrors || ref.find(r => r.world === w.id).ok);
  const refBy = new Map(ref.map(r => [r.world, r.canon]));
  // reference 2: the Foundry transliteration must agree on every usable candidate
  const agreement = [];
  if (item.transliteration) {
    const v = validateCi1(item.transliteration);
    if (!v.valid) agreement.push({ world: '-', pass: false, reasons: v.errors.slice(0, 5).map(e => `${e.code}: ${e.message}`) });
    else for (const w of usable) { const f = await foundryCanon(item.transliteration, w); const e = equivalent(refBy.get(w.id), f.canon, declFor(item, w, vocab)); agreement.push({ world: w.id, ...e }); }
  }
  // mutants
  const ms = mutants(item.workflow);
  const mres = ms.length ? await referenceCanon(item, usable, ms.map(m => m.workflow), 'effects') : [];
  const kill = ms.map((m, mi) => usable.map(w => { const r = mres.find(x => x.workflow === mi && x.world === w.id); return !equivalent(refBy.get(w.id), r.canon, declFor(item, w, vocab)).pass; }));
  // greedy cover: up to 8 hidden worlds; then the public world
  const killable = kill.map((row, mi) => row.some(Boolean) ? mi : -1).filter(x => x >= 0);
  const chosen = [], covered = new Set();
  const hasEffects = w => { const c = refBy.get(w.id); return c.mail.length + c.chat.length + c.respond.length > 0 || item.spec.sheetEffects; };
  while (chosen.length < (item.spec.hiddenMax ?? 8)) {
    let best = -1, gain = 0;
    usable.forEach((w, wi) => { if (chosen.includes(wi)) return; const g = killable.filter(mi => !covered.has(mi) && kill[mi][wi]).length; if (g > gain) { gain = g; best = wi; } });
    if (best < 0) break;
    chosen.push(best); killable.filter(mi => kill[mi][best]).forEach(mi => covered.add(mi));
  }
  // at least one hidden world must carry outside effects, and at least 3 worlds overall (variety beyond the cover)
  if (!chosen.some(wi => hasEffects(usable[wi]))) { const wi = usable.findIndex(w => hasEffects(w)); if (wi >= 0) chosen.push(wi); }
  for (let wi = 0; chosen.length < Math.min(item.spec.hiddenMin ?? 6, usable.length - 1) && wi < usable.length; wi++) if (!chosen.includes(wi)) chosen.push(wi);
  const rest = usable.map((w, wi) => wi).filter(wi => !chosen.includes(wi));
  const publicIdx = rest.sort((a, b) => Number(hasEffects(usable[b])) - Number(hasEffects(usable[a])))[0];
  const report = {
    id: item.id, candidates: cands.length, refErrors: errors.length, deterministic, usable: usable.length,
    agreement: item.transliteration ? { pass: agreement.filter(a => a.pass).length, of: agreement.length, fails: agreement.filter(a => !a.pass).slice(0, 4) } : 'no transliteration',
    mutation: { total: ms.length, killable: kill.filter(r => r.some(Boolean)).length, killedByHidden: covered.size, score: kill.length ? covered.size / ms.length : null, scoreOfKillable: killable.length ? covered.size / killable.length : null,
      survivors: ms.filter((m, mi) => !kill[mi].some(Boolean)).map(m => m.id) },
    hidden: chosen.map(wi => usable[wi].id), public: publicIdx === undefined ? null : usable[publicIdx].id,
    effectsPerWorld: usable.slice(0, 8).map(w => { const c = refBy.get(w.id); return `${w.id}: mail ${c.mail.length} chat ${c.chat.length} resp ${c.respond.length}`; }),
    errorSamples: errors.slice(0, 3).map(r => `${r.world}: ${r.error?.message}`),
  };
  if (!quiet) console.log(JSON.stringify(report, null, 1));
  return { item, report, cands, refBy, usable, chosen, publicIdx, vocab };
}

export async function freeze(id, { n = 40 } = {}) {
  const { item, report, usable, chosen, publicIdx, refBy, vocab } = await check(id, { quiet: true, n });
  const refuse = why => ({ id: String(id), admitted: false, why, report });
  if (!report.deterministic) return refuse('reference is not deterministic');
  if (report.agreement === 'no transliteration' || report.agreement.pass !== report.agreement.of) return refuse(`transliteration does not agree (${JSON.stringify(report.agreement).slice(0, 600)})`);
  if (publicIdx === undefined) return refuse('no world left for the public world');
  const hidden = chosen.map(wi => usable[wi]), pub = usable[publicIdx];
  const oracle = { id: item.id, corpusSha256: item.rawSha256, simBundleSha256: bundle().sha256, trigger: item.spec.trigger,
    workspace: item.spec.workspace, decl: { vocab: [...vocab].sort(), mask: item.spec.decl?.mask ?? {}, freeText: item.spec.decl?.freeText ?? {}, respondCode: !!item.spec.decl?.respondCode },
    hidden: hidden.map(w => ({ world: w, reference: refBy.get(w.id) })), public: { world: pub, reference: refBy.get(pub.id) }, mutation: report.mutation, agreement: report.agreement };
  mkdirSync(path.join(BED, 'oracle'), { recursive: true });
  const text = JSON.stringify(oracle, null, 1);
  writeFileSync(path.join(BED, 'oracle', `${item.id}.json`), text);
  return { id: item.id, admitted: true, sha256: sha(text), hidden: hidden.length, mutation: report.mutation, report };
}

/** Score one built workflow against a frozen oracle: { pass (every hidden world), worlds: [{id, pass, reasons}] }. */
export async function scoreBuilt(oracle, workflow) {
  const worlds = [];
  const vocab = new Set(oracle.decl.vocab);
  for (const h of oracle.hidden) {
    const f = await foundryCanon(workflow, h.world);
    const e = equivalent(h.reference, f.canon, { vocab, rows: rowIdentities(h.world, vocab), mask: oracle.decl.mask, freeText: oracle.decl.freeText, respondCode: oracle.decl.respondCode });
    worlds.push({ id: h.world.id, pass: e.pass, reasons: e.reasons.slice(0, 6), status: f.run.status, error: f.run.error ? `${f.run.error.code ?? ''} ${String(f.run.error.message ?? '').slice(0, 200)}` : null });
  }
  return { pass: worlds.every(w => w.pass), worlds };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  const ids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--n');
  const n = args.includes('--n') ? Number(args[args.indexOf('--n') + 1]) : 40;
  if (cmd === 'check') for (const id of ids) await check(id, { n });
  else if (cmd === 'freeze') for (const id of ids) {
    const r = await freeze(id, { n });
    console.log(JSON.stringify({ id: r.id, admitted: r.admitted, why: r.why ?? null, sha256: r.sha256 ?? null, hidden: r.hidden ?? null, report: r.report }));
  }
  else console.log('usage: bed.mjs check|freeze <id...>');
}
