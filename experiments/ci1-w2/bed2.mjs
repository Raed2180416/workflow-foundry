// CI-1 wave 2 bed construction (research/ci1-20261021/PREREG-CI1-W2.md). Same protocol as wave 1 (experiments/ci1/bed.mjs: reference =
// corpus graph + documented patches in n8n-sim; 32 candidate worlds from the item's generator; two-reference admission gate; mutants;
// greedy cover of hidden worlds; one public world) with the oracle that wave 1's root-causing produced: oracle v2
// (experiments/ci1-posthoc/oracle-v2.mjs: addressee exemption, categorical cells, numeric dates, declared optional spans), now the
// PRIMARY oracle, frozen before any wave-2 builder call. The categorical columns are computed once over all candidate worlds and frozen
// in the oracle file, so scoring never depends on which worlds were chosen. v1 verdicts are recorded beside v2 for comparison.
// Wave-1 code (experiments/ci1) is frozen and only imported; the wave-2 bed lives in its own directory (CI1_BED, default below).
//   CI1_BED=/var/tmp/foundry-work/ci1-20261021/bed-w2 node experiments/ci1-w2/bed2.mjs check <id> [--n 32]
//   CI1_BED=/var/tmp/foundry-work/ci1-20261021/bed-w2 node experiments/ci1-w2/bed2.mjs freeze <id...> [--n 32]
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BED, loadItem, candidates, referenceCanon, foundryCanon } from '../ci1/bed.mjs';
import { staticVocabulary, rowIdentities, equivalent } from '../ci1/canon.mjs';
import { mutants } from '../ci1/mutants.mjs';
import { validateCi1 } from '../ci1/foundry-world.mjs';
import { bundle } from '../ci1/sim/run.mjs';
import { equivalentV2, rowIdentitiesWithAddresses, categoricalColumns } from '../ci1-posthoc/oracle-v2.mjs';

export { BED };
export const N_CANDIDATES = 32;
const sha = t => createHash('sha256').update(t).digest('hex');

/** The v2 declaration for one world: v1's fields plus the addressee-aware row identities and the item's optional spans. */
export function declV2(decl, world) {
  const vocab = decl.vocab instanceof Set ? decl.vocab : new Set(decl.vocab);
  const categorical = new Set(decl.categorical ?? []);
  return { vocab, rows: rowIdentities(world, vocab), rowsWithAddresses: rowIdentitiesWithAddresses(world, vocab, categorical), mask: decl.mask ?? {},
    freeText: decl.freeText ?? {}, respondCode: !!decl.respondCode, optional: decl.optional ?? {} };
}
/** v2 verdict (primary) and v1 verdict (recorded) of a candidate's canonical effects against the reference's in one world. */
export function judge(ref, cand, decl, world) {
  const d = declV2(decl, world);
  return { v2: equivalentV2(ref, cand, d), v1: equivalent(ref, cand, d) };
}
export function itemDecl(item, worlds) {
  const vocab = staticVocabulary(item.workflow);
  return { vocab: [...vocab].sort(), mask: item.spec.decl?.mask ?? {}, freeText: item.spec.decl?.freeText ?? {}, respondCode: !!item.spec.decl?.respondCode,
    optional: item.spec.decl?.optional ?? {}, categorical: [...categoricalColumns(worlds)].sort() };
}

export async function check2(id, { n = N_CANDIDATES, quiet = false } = {}) {
  const item = await loadItem(id);
  const cands = candidates(item, n);
  const decl = itemDecl(item, cands);
  const ref = await referenceCanon(item, cands);
  const again = await referenceCanon(item, cands);
  const deterministic = ref.every((r, i) => JSON.stringify(r.canon) === JSON.stringify(again[i].canon));
  const errors = ref.filter(r => !r.ok);
  const usable = cands.filter(w => item.spec.allowErrors || ref.find(r => r.world === w.id).ok);
  const refBy = new Map(ref.map(r => [r.world, r.canon]));
  const agreement = [];
  if (item.transliteration) {
    const v = validateCi1(item.transliteration);
    if (!v.valid) agreement.push({ world: '-', pass: false, reasons: v.errors.slice(0, 5).map(e => `${e.code}: ${e.message}`) });
    else for (const w of usable) { const f = await foundryCanon(item.transliteration, w); const j = judge(refBy.get(w.id), f.canon, decl, w); agreement.push({ world: w.id, pass: j.v2.pass, v1: j.v1.pass, reasons: j.v2.reasons }); }
  }
  const ms = mutants(item.workflow);
  const mres = ms.length ? await referenceCanon(item, usable, ms.map(m => m.workflow), 'effects') : [];
  const kill = ms.map((m, mi) => usable.map(w => { const r = mres.find(x => x.workflow === mi && x.world === w.id); return !judge(refBy.get(w.id), r.canon, decl, w).v2.pass; }));
  const killable = kill.map((row, mi) => (row.some(Boolean) ? mi : -1)).filter(x => x >= 0);
  const chosen = [], covered = new Set();
  const hasEffects = w => { const c = refBy.get(w.id); return c.mail.length + c.chat.length + c.respond.length > 0 || item.spec.sheetEffects; };
  while (chosen.length < (item.spec.hiddenMax ?? 8)) {
    let best = -1, gain = 0;
    usable.forEach((w, wi) => { if (chosen.includes(wi)) return; const g = killable.filter(mi => !covered.has(mi) && kill[mi][wi]).length; if (g > gain) { gain = g; best = wi; } });
    if (best < 0) break;
    chosen.push(best); killable.filter(mi => kill[mi][best]).forEach(mi => covered.add(mi));
  }
  if (!chosen.some(wi => hasEffects(usable[wi]))) { const wi = usable.findIndex(w => hasEffects(w)); if (wi >= 0) chosen.push(wi); }
  for (let wi = 0; chosen.length < Math.min(item.spec.hiddenMin ?? 6, usable.length - 1) && wi < usable.length; wi++) if (!chosen.includes(wi)) chosen.push(wi);
  const rest = usable.map((w, wi) => wi).filter(wi => !chosen.includes(wi));
  const publicIdx = rest.sort((a, b) => Number(hasEffects(usable[b])) - Number(hasEffects(usable[a])))[0];
  const report = {
    id: item.id, candidates: cands.length, refErrors: errors.length, deterministic, usable: usable.length,
    agreement: item.transliteration ? { pass: agreement.filter(a => a.pass).length, of: agreement.length, v1Pass: agreement.filter(a => a.v1).length, fails: agreement.filter(a => !a.pass).slice(0, 4) } : 'no transliteration',
    mutation: { total: ms.length, killable: killable.length, killedByHidden: covered.size, score: ms.length ? covered.size / ms.length : null, scoreOfKillable: killable.length ? covered.size / killable.length : null,
      survivors: ms.filter((m, mi) => !kill[mi].some(Boolean)).map(m => m.id) },
    hidden: chosen.map(wi => usable[wi].id), public: publicIdx === undefined ? null : usable[publicIdx].id,
    worldsWithEffects: usable.filter(hasEffects).length, categorical: decl.categorical,
    errorSamples: errors.slice(0, 3).map(r => `${r.world}: ${r.error?.message}`),
  };
  if (!quiet) console.log(JSON.stringify(report, null, 1));
  return { item, report, usable, chosen, publicIdx, refBy, decl };
}

export async function freeze2(id, { n = N_CANDIDATES } = {}) {
  const { item, report, usable, chosen, publicIdx, refBy, decl } = await check2(id, { quiet: true, n });
  const refuse = why => ({ id: String(id), admitted: false, why, report });
  if (!report.deterministic) return refuse('reference is not deterministic');
  if (report.agreement === 'no transliteration' || report.agreement.pass !== report.agreement.of) return refuse(`transliteration does not agree (${JSON.stringify(report.agreement).slice(0, 600)})`);
  if (publicIdx === undefined) return refuse('no world left for the public world');
  const hidden = chosen.map(wi => usable[wi]), pub = usable[publicIdx];
  const oracle = { schema: 'foundry.ci1.oracle/2', id: item.id, corpusSha256: item.rawSha256, simBundleSha256: bundle().sha256, trigger: item.spec.trigger, workspace: item.spec.workspace,
    decl, hidden: hidden.map(w => ({ world: w, reference: refBy.get(w.id) })), public: { world: pub, reference: refBy.get(pub.id) }, mutation: report.mutation, agreement: report.agreement };
  mkdirSync(path.join(BED, 'oracle'), { recursive: true });
  const text = JSON.stringify(oracle, null, 1);
  writeFileSync(path.join(BED, 'oracle', `${item.id}.json`), text);
  return { id: item.id, admitted: true, sha256: sha(text), hidden: hidden.length, mutation: report.mutation, report };
}

/** Score one built workflow against a frozen wave-2 oracle: pass (v2, primary) and passV1, per world. */
export async function scoreBuilt2(oracle, workflow) {
  const worlds = [];
  for (const h of oracle.hidden) {
    // a Code step's 10 s wall clock can expire under host load (wave 1: one false failure, RESULT-CI1.md §4.1): rerun up to twice
    let f = await foundryCanon(workflow, h.world), timeoutRetries = 0;
    while (f.run.error?.code === 'CODE_TIMEOUT' && timeoutRetries < 2) { timeoutRetries++; f = await foundryCanon(workflow, h.world); }
    const j = judge(h.reference, f.canon, oracle.decl, h.world);
    worlds.push({ id: h.world.id, pass: j.v2.pass, passV1: j.v1.pass, reasons: j.v2.reasons.slice(0, 6), reasonsV1: j.v1.pass ? [] : j.v1.reasons.slice(0, 3), status: f.run.status,
      error: f.run.error ? `${f.run.error.code ?? ''} ${String(f.run.error.message ?? '').slice(0, 200)}` : null, ...(timeoutRetries ? { timeoutRetries } : {}) });
  }
  return { pass: worlds.every(w => w.pass), passV1: worlds.every(w => w.passV1), worlds };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  const ids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--n');
  const n = args.includes('--n') ? Number(args[args.indexOf('--n') + 1]) : N_CANDIDATES;
  if (cmd === 'check') for (const id of ids) await check2(id, { n });
  else if (cmd === 'freeze') for (const id of ids) { const r = await freeze2(id, { n }); console.log(JSON.stringify({ id: r.id, admitted: r.admitted, why: r.why ?? null, sha256: r.sha256 ?? null, hidden: r.hidden ?? null, report: r.report })); }
  else console.log('usage: bed2.mjs check|freeze <id...> [--n 32]');
}
