// SPEC-0 coverage gate (FIRST-CLASS-PROGRAMS §4.4): every gold id is recoverable from at least one carrier, checked
// through an author-written mapping (as AB-R's reference proves its traps resolvable). $0.
//
// The mapping (per carrier kind; the unit-specific parts are the author-written anchors, stale variants, precedent
// alternatives and owner terms in content.mjs and precedent.mjs):
//   sop       SOP v3 holds the unit's anchor as a placed `current` fragment
//   override  SOP v3 holds the stale anchor; an e-mail from an authorised sender (Mara or Joost), dated after SOP v3
//             (2026-02-20), quotes the stale text and holds the current anchor
//   email     an e-mail from an authorised sender holds the anchor
//   records   the export exists and its rows fit the rule and contradict every listed alternative (precedent.mjs)
//   owner     asking the author's naming question ("How do we handle <title>? (<first term>)") through the stub matcher
//             returns the unit's record and the answer holds the anchor (withholding is waived because it names the
//             subject)
// The owner knows every unit, so the owner route is checked for every unit too; `withoutAsking` counts the documents only.
// The U statements of the platform zone (gold `u`, U01-U11) must appear verbatim in PLATFORM.md.
import { CAST, UNITS } from './content.mjs';
import { discriminates } from './precedent.mjs';
import { createOwnerSim, stubMatcher } from './owner-sim.mjs';
import { loadGold, GOLD_IDS } from './spec-units.mjs';

const AUTHORISED = [CAST.owner.email, CAST.ops.email];
const SOP_V3 = 'wiki/SOP-order-handling-v3.md';
const lower = s => s.toLowerCase();
const stripMd = s => s.replace(/[*`]/g, '').replace(/\s+/g, ' ');

export const namingQuestion = id => `How do we handle ${UNITS[id].title}? (${UNITS[id].terms[0]})`;

function mailMeta(text) {
  const from = /^From: .*<([^>]+)>/m.exec(text)?.[1] ?? null, date = /^Date: (\S+)/m.exec(text)?.[1] ?? null;
  return { from, date, authorised: AUTHORISED.includes(from) };
}

async function ownerRoute(pack, id) {
  const sim = createOwnerSim({ pack, matcher: stubMatcher(pack.owner.records), maxQuestions: 1 });
  const { answer } = await sim.ask(namingQuestion(id));
  const row = sim.journal()[0];
  return { ok: row.answered.includes(id) && lower(answer).includes(lower(UNITS[id].anchor)), question: row.question, matched: row.match };
}

function docRoute(pack, id) {
  const c = pack.assignment.units[id].carrier, a = lower(UNITS[id].anchor);
  const frags = pack.fragments.filter(f => f.unit === id);
  if (c === 'sop') return { ok: frags.some(f => f.file === SOP_V3 && f.role === 'current') && lower(pack.files[SOP_V3]).includes(a), via: SOP_V3 };
  if (c === 'email' || c === 'override') {
    const mails = frags.filter(f => f.role === 'current' && pack.fileCarrier[f.file] === 'email').map(f => ({ file: f.file, ...mailMeta(pack.files[f.file]) }))
      .filter(m => m.authorised && lower(pack.files[m.file]).includes(a));
    if (c === 'email') return { ok: mails.length > 0, via: mails.map(m => m.file) };
    const staleInSop = lower(pack.files[SOP_V3]).includes(lower(UNITS[id].stale.anchor));
    const corrects = mails.filter(m => m.date > '2026-02-20' && pack.files[m.file].includes(UNITS[id].stale.text));
    return { ok: staleInSop && corrects.length > 0, via: corrects.map(m => m.file), staleInSop };
  }
  if (c === 'records') { const d = discriminates(id, pack.precedents[id] ?? []); return { ok: !!pack.precedents[id] && d.ok, via: Object.keys(pack.files).filter(f => pack.fragments.some(x => x.file === f && x.unit === id)), discriminates: d }; }
  return { ok: false, via: null };
}

export async function coverageTest(pack, { root } = {}) {
  const rows = {};
  for (const id of Object.keys(UNITS)) {
    const carrier = pack.assignment.units[id].carrier;
    const doc = carrier === 'owner' ? { ok: false, via: null } : docRoute(pack, id);
    const own = await ownerRoute(pack, id);
    rows[id] = { carrier, gold: pack.assignment.units[id].gold, documents: doc.ok, owner: own.ok, recoverable: doc.ok || own.ok, primaryOk: carrier === 'owner' ? own.ok : doc.ok, via: doc.via ?? null, ownerQuestion: own.question };
  }
  const gold = loadGold(root);
  const platform = stripMd(pack.files['PLATFORM.md']);
  const uMissing = Object.entries(gold.u).filter(([k]) => Number(k.slice(1)) <= 11).filter(([, v]) => !platform.includes(stripMd(v.anchor))).map(([k]) => k);
  const g = GOLD_IDS.map(id => rows[id]);
  return {
    pass: g.every(r => r.recoverable && r.primaryOk) && uMissing.length === 0,
    gold: { n: g.length, recoverable: g.filter(r => r.recoverable).length, primaryOk: g.filter(r => r.primaryOk).length, withoutAsking: g.filter(r => r.documents).length, ownerOnly: g.filter(r => r.carrier === 'owner').length },
    extras: Object.fromEntries(Object.entries(rows).filter(([, r]) => !r.gold).map(([id, r]) => [id, r.recoverable])),
    platformU: { checked: 11, missing: uMissing },
    rows,
  };
}
