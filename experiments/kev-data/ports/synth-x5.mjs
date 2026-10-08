// X5:synth precondition_holds (JUDGE-PROGRAM.md §1.2 X5: "synth: ranking policy P1-P4 (world.policy) and standard conditions").
// The assumption is trusted text of a kept workflow (it travels in the question); the source text is the task prompt's own
// windows chosen by code (judges/synth.mjs stateX5): the first paragraph, the requested cells and the section(s) the assumption
// concerns. Two kinds:
//   policy     "journal articles first, then larger n, then newer date" against the Resolution policy section: the bed's
//              world.policy decides (holds: the same policy; violated: another of P1-P4)
//   condition  "{property} values count only when measured {condition}" against the Standard conditions section: a phrase the
//              bed writes for a condition equivalent to the property's standard one (holds) or a different one (violated)
// Each kind comes as a group: a polarity pair on one state (holds and violated with the same lead and index, one cluster) and one
// not_stated row (§2.5 presence-matched: the section the assumption concerns is not in the window, another convention of the same
// system is; or an absent subject, at most 10% of the not_stated rows; or an unrelated section). Labels are balanced within the
// assumption kind (balanced-within-entity, §1.0). The authored statements are in ports/synth-lines.mjs.
import { uniformTarget } from '../lib/render.mjs';
import { spanHash } from '../lib/hash.mjs';
import { PROPERTIES, CONDITIONS } from '../taps/synth-frames.mjs';
import { stateX5, parseTask } from '../judges/synth.mjs';
import { X5_POLICY, X5_POLICY_LEADS, X5_COND_FRAMES } from './synth-lines.mjs';
import { makeRecord, paraphraseOf, hnum, sha, byHash, unit01, bump, bucketAllows, formOf } from './synth-core.mjs';

export const X5_KINDS = Object.freeze(['policy', 'condition']);
export const POLICIES = Object.freeze(['P1', 'P2', 'P3', 'P4']);
const NS_WEIGHTS = Object.freeze({ matched: 0.72, absent: 0.07, unrelated: 0.21 });

// Does a condition phrase need a temperature conversion to compare with the standard description? (the description's
// temperatures in the phrase's unit, or a range holding the phrase's number, settle it without)
const TEMP = /(−|-)?(\d+(?:\.\d+)?) ?(°C|°F|K)\b/g;
export function needsConversion(phrase, desc) {
  const toks = [...String(phrase).matchAll(TEMP)];
  if (!toks.length) return false;
  const d = String(desc);
  return toks.some(m => {
    const unit = m[3];
    const inDesc = [...d.matchAll(new RegExp(`(?:(\\d+(?:\\.\\d+)?)\\s?[–-]\\s?)?(\\d+(?:\\.\\d+)?) ?${unit === '°C' ? '°C' : unit === '°F' ? '°F' : 'K'}\\b`, 'g'))];
    return inDesc.length === 0;
  });
}
const lc = s => (s ? s[0].toLowerCase() + s.slice(1) : s);

// A policy statement and its flip twin: the same lead and index, another policy.
function policyPair(G, W, key) {
  const truth = W.world.policy.id, others = POLICIES.filter(p => p !== truth);
  const order = [];
  for (let l = 0; l < X5_POLICY_LEADS.length; l++) for (let i = 0; i < X5_POLICY[truth].length; i++) order.push([l, i]);
  order.sort((a, b) => byHash(sha(`${key}|${a}`), sha(`${key}|${b}`)));
  const wrong = others[hnum(`${key}|wrong`) % others.length];
  for (const [l, i] of order) {
    const holds = X5_POLICY_LEADS[l] + X5_POLICY[truth][i], violated = X5_POLICY_LEADS[l] + X5_POLICY[wrong][i];
    if (bucketAllows(G.slice, formOf(holds, W.masks)) && bucketAllows(G.slice, formOf(violated, W.masks))) return { holds, violated, lead: l, index: i, truth, wrong };
  }
  return null;
}
function policyOne(G, W, key, claim) {
  const truth = W.world.policy.id, p = claim === 'true' ? truth : POLICIES.filter(x => x !== truth)[hnum(`${key}|w`) % 3];
  const order = [];
  for (let l = 0; l < X5_POLICY_LEADS.length; l++) for (let i = 0; i < X5_POLICY[p].length; i++) order.push([l, i]);
  order.sort((a, b) => byHash(sha(`${key}|${a}`), sha(`${key}|${b}`)));
  for (const [l, i] of order) { const text = X5_POLICY_LEADS[l] + X5_POLICY[p][i]; if (bucketAllows(G.slice, formOf(text, W.masks))) return { text, policy: p, lead: l, index: i }; }
  return null;
}
const conditionText = (frame, prop, cond) => X5_COND_FRAMES[frame].replace('{prop}', prop).replace('{cond}', cond);
function conditionPair(G, W, key, prop) {
  const C = CONDITIONS[prop], order = [];
  for (let f = 0; f < X5_COND_FRAMES.length; f++) for (let i = 0; i < C.std.length; i++) for (let j = 0; j < C.nonstd.length; j++) order.push([f, i, j]);
  order.sort((a, b) => byHash(sha(`${key}|${a}`), sha(`${key}|${b}`)));
  for (const [f, i, j] of order) {
    const holds = conditionText(f, prop, C.std[i]), violated = conditionText(f, prop, C.nonstd[j]);
    if (bucketAllows(G.slice, formOf(holds, W.masks)) && bucketAllows(G.slice, formOf(violated, W.masks))) return { holds, violated, frame: f, std: C.std[i], non: C.nonstd[j] };
  }
  return null;
}
function conditionOne(G, W, key, prop) {
  const C = CONDITIONS[prop], order = [];
  for (let f = 0; f < X5_COND_FRAMES.length; f++) for (const [k, list] of [['std', C.std], ['non', C.nonstd]]) for (let i = 0; i < list.length; i++) order.push([f, k, i]);
  order.sort((a, b) => byHash(sha(`${key}|${a}`), sha(`${key}|${b}`)));
  for (const [f, k, i] of order) { const phrase = (k === 'std' ? C.std : C.nonstd)[i], text = conditionText(f, prop, phrase); if (bucketAllows(G.slice, formOf(text, W.masks))) return { text, frame: f, phrase, std: k === 'std' }; }
  return null;
}
const pickNs = key => { const u = unit01(`${key}|ns`); return u < NS_WEIGHTS.matched ? 'matched' : u < NS_WEIGHTS.matched + NS_WEIGHTS.absent ? 'absent' : 'unrelated'; };
// topics: the window a pair is asked on is the section it concerns (or both, 10%)
const pairTopic = (kind, key) => (unit01(`${key}|both`) < 0.1 ? 'both' : kind === 'policy' ? 'policy' : 'conditions');

// The groups of a world: [{ id, kind, rows: [{ label, assumption, topic, ... }] }]
export function x5Candidates(G, W) {
  const out = [];
  const reqProps = W.parsed.properties;
  for (const kind of X5_KINDS) {
    const key = `${G.slice}|X5|${W.seed}|${kind}`, topic = pairTopic(kind, key), ns = pickNs(key);
    const rows = [], pairId = `sx5:${G.slice}:${W.seed}:${kind}`;
    if (kind === 'policy') {
      const pr = policyPair(G, W, key);
      if (!pr) { bump(G, 'x5:policy-no-statement'); continue; }
      rows.push({ label: 'holds', assumption: pr.holds, topic, pairId, meta: { policy: pr.truth, claimed: pr.truth, lead: pr.lead, index: pr.index } },
        { label: 'violated', assumption: pr.violated, topic, pairId, meta: { policy: pr.truth, claimed: pr.wrong, lead: pr.lead, index: pr.index } });
      const one = policyOne(G, W, `${key}|nsstmt`, unit01(`${key}|nstrue`) < 0.5 ? 'true' : 'wrong');
      if (!one) { bump(G, 'x5:policy-no-ns-statement'); continue; }
      const nsTopic = ns === 'unrelated' ? 'units' : 'conditions';
      rows.push({ label: 'not_stated', assumption: one.text, topic: nsTopic, meta: { policy: W.world.policy.id, claimed: one.policy, notStated: ns === 'absent' ? 'matched' : ns === 'unrelated' ? 'unrelated' : 'matched' } });
    } else {
      const prop = reqProps[hnum(`${key}|prop`) % reqProps.length], pr = conditionPair(G, W, key, prop);
      if (!pr) { bump(G, 'x5:condition-no-statement'); continue; }
      const desc = CONDITIONS[prop].stdDesc;
      rows.push({ label: 'holds', assumption: pr.holds, topic, pairId, meta: { property: prop, phrase: pr.std, std: true, frame: pr.frame, needsConversion: needsConversion(pr.std, desc) } },
        { label: 'violated', assumption: pr.violated, topic, pairId, meta: { property: prop, phrase: pr.non, std: false, frame: pr.frame, needsConversion: needsConversion(pr.non, desc) } });
      if (ns === 'absent') {
        const absent = PROPERTIES.filter(p => !reqProps.includes(p));
        if (!absent.length) { bump(G, 'x5:no-absent-property'); continue; }
        const q = absent[hnum(`${key}|absent`) % absent.length], one = conditionOne(G, W, `${key}|nsstmt`, q);
        if (!one) { bump(G, 'x5:condition-no-ns-statement'); continue; }
        rows.push({ label: 'not_stated', assumption: one.text, topic: unit01(`${key}|abtopic`) < 0.5 ? 'conditions' : 'both', meta: { property: q, phrase: one.phrase, std: one.std, frame: one.frame, notStated: 'absent-subject', needsConversion: needsConversion(one.phrase, CONDITIONS[q].stdDesc) } });
      } else {
        const one = conditionOne(G, W, `${key}|nsstmt`, prop);
        if (!one) { bump(G, 'x5:condition-no-ns-statement'); continue; }
        rows.push({ label: 'not_stated', assumption: one.text, topic: ns === 'unrelated' ? 'units' : 'policy', meta: { property: prop, phrase: one.phrase, std: one.std, frame: one.frame, notStated: ns === 'unrelated' ? 'unrelated' : 'matched', needsConversion: needsConversion(one.phrase, desc) } });
      }
    }
    out.push({ id: `${W.seed}:${kind}`, seed: W.seed, kind, rows });
  }
  return out;
}

export function x5Record(G, W, grp, row, i, { variantOf = null } = {}) {
  const contract = G.contracts.X5, key = `${G.slice}|X5|${grp.id}|${i}`;
  const slots = { topic: row.topic }, state = stateX5(W.task, slots), form = formOf(row.assumption, W.masks);
  const x5 = { kind: grp.kind, topic: row.topic, window: row.topic, ...row.meta };
  const rec = makeRecord({ contract, slice: G.slice, opts: G.opts, key, state, label: row.label, slots: { assumption: row.assumption },
    meta: { seed: W.seed, difficulty: W.difficulty, worldHash: W.wh, variant: row.pairId ? 'flip' : row.meta.notStated ? 'unknowable' : 'clean', ...(row.pairId ? { pairId: row.pairId } : {}), formId: form,
      surface: { source: 'authored-builtin', slice: G.slice, lineHash: spanHash(row.assumption), filter: 'pending' }, masks: W.masks, kit: { port: 'X5', slots: { topic: row.topic, assumption: row.assumption } }, x5,
      needsWorldKnowledge: Boolean(row.meta.needsConversion), labelSource: 'generator' } });
  return rec;
}

// groups -> records: n rows (whole groups), the kinds alternating so each assumption kind holds half; each group is a polarity pair
// and one not_stated row. In a test slice a share of the pairs' holds rows becomes a paraphrase-consistency record (§3.2).
export function x5Records(G, groups, worlds) {
  const slice = G.slice, n = G.opts.rows?.['X5:synth'] ?? G.targets['X5:synth']?.[slice];
  if (!n) return { records: [], report: null };
  const records = [], by = { policy: [], condition: [] };
  for (const g of groups) by[g.kind].push(g);
  for (const k of X5_KINDS) by[k].sort((a, b) => byHash(sha(`${slice}|X5pick|${a.id}`), sha(`${slice}|X5pick|${b.id}`)));
  const per = Math.ceil(n / 6), taken = { policy: by.policy.slice(0, per), condition: by.condition.slice(0, per) };
  const picked = [...taken.policy, ...taken.condition].sort((a, b) => byHash(sha(`${slice}|X5o|${a.id}`), sha(`${slice}|X5o|${b.id}`)));
  const test = slice === 'test-ood' || slice === 'test-in';
  for (const g of picked) {
    const W = worlds.get(g.seed);
    g.rows.forEach((row, i) => {
      let rec = x5Record(G, W, g, row, i);
      if (test && row.label === 'holds' && unit01(`${slice}|X5para|${g.id}`) < 0.15) rec = paraphraseOf(rec, G.contracts.X5, slice, G.opts, `${slice}|X5|${g.id}|${i}`, { assumption: row.assumption }) ?? rec;
      records.push(rec);
    });
  }
  const labels = {}, notStated = {};
  for (const r of records) { const l = Object.values(r.questions)[0].label; labels[l] = (labels[l] ?? 0) + 1; if (l === 'not_stated') notStated[r.meta.x5.notStated] = (notStated[r.meta.x5.notStated] ?? 0) + 1; }
  return { records, report: { slice, n, groups: picked.length, rows: records.length, supply: { policy: by.policy.length, condition: by.condition.length }, kinds: { policy: taken.policy.length, condition: taken.condition.length }, labels, notStated } };
}
