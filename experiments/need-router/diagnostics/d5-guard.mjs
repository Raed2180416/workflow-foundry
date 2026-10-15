// D5: RX6-lite, guard recall (DESIGN §3 Stage 0, §7 M0 item 10; research/review-20261007/05-router-constructor.md RX6).
// The hard guard forces the workflow class when a TYPED hard requirement is declared (durable wait, schedule, human approval, effects
// with authority). Word cues in the task text (REQUIREMENT_LIBRARY and shapeOf) only raise "ask the user" and never force a mode.
// RX6-lite asks how well those word cues find the requirements that are really there; under 0.9 recall the guard asks instead of inferring.
//   Part A  the 449 corpus items whose description is the platform's own (provenance "original"; the "written" descriptions (1,046 in the corpus
//           of 2026-10-06) leak graph-derived phrasing and the 64 "recovered-by-model" ones are model-written: RX6 excludes both; the output's
//           provenanceCounts carries the live counts). Declared truth comes from the item's graph, never from the text:
//             human     features.humanSteps > 0 or a node of category human
//             wait      a wait node, or features.async has wait (a durable wait)
//             schedule  features.async has schedule
//             effects   features.effects.write + external > 0 (effects with authority)
//             any       one of those four. (Triggers by webhook, event or poll are reported as `trigger`, outside "any": they are a declared N,
//                       not a hard requirement.) No graph marker exists for compensation or audit, so those cues cannot be scored here.
//   Part B  E8 and runbook: (1) the typed fields in each bed's machine-readable declarations that evidence each candidate requirement
//           (PREREG-NEED-V1 §3.2: runbook = effects with authority, human approval; e8 = durable wait, schedule, effects with authority);
//           (2) whether the word cues fire on the text a user would hand over (E8: SPEC-E; runbook: the generated prompt, and prompt with ticket
//           and runbook), per declared requirement. Tiny n by construction.
// Cue map (code-defined words only, none added here): human = human-gate cue or shape humanWords (approve, ask, confirm, review);
// wait = durable-wait cue or timeWords after/until/when; schedule = timeWords every/daily/cron; effects = shape effectVerbs (send, post,
// write, delete, pay, notify) or the high-risk or compensation cue. Evidence grade: dev.
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REQUIREMENT_LIBRARY } from '../../../src/construction-objective.mjs';
import { shapeOf } from '../../library/index.mjs';
import { REPO, wilson, round, sourceOf } from './common.mjs';
import { bedStamp } from './anchors.mjs';

export const CORPUS_DIR = path.join(REPO, 'research/corpus-20261006');
const lib = id => REQUIREMENT_LIBRARY.find(x => x.id === id).cue;
export const CLASSES = Object.freeze(['human', 'wait', 'schedule', 'effects']);

/** The word-cue guard: which requirement classes the text's cues point to. Code-defined cues only. */
export function guardCues(text) {
  const shape = shapeOf({ prompt: String(text ?? '') });
  const tw = new Set(shape.timeWords);
  const flags = {
    human: lib('human-gate').test(text) || shape.humanWords.length > 0,
    wait: lib('durable-wait').test(text) || ['after', 'until', 'when'].some(w => tw.has(w)),
    schedule: ['every', 'daily', 'cron'].some(w => tw.has(w)),
    effects: shape.effectVerbs.length > 0 || lib('high-risk-not-model-owned').test(text) || lib('compensation-named-limit').test(text),
  };
  return { ...flags, any: CLASSES.some(c => flags[c]) };
}

/** Declared truth of a corpus item, from its graph. */
export function graphTruth(item) {
  const f = item.features ?? {}, asyncKinds = f.async ?? [], nodes = item.graph?.nodes ?? [];
  const truth = {
    human: (f.humanSteps ?? 0) > 0 || nodes.some(n => n.category === 'human'),
    wait: asyncKinds.includes('wait') || nodes.some(n => n.category === 'wait'),
    schedule: asyncKinds.includes('schedule'),
    effects: ((f.effects?.write ?? 0) + (f.effects?.external ?? 0)) > 0,
    trigger: asyncKinds.some(k => ['webhook', 'event', 'poll'].includes(k)),
  };
  return { ...truth, any: CLASSES.some(c => truth[c]) };
}

const rate = (x, n) => (n ? { x, n, rate: round(x / n, 4), wilson: [round(wilson(x, n).lo, 4), round(wilson(x, n).hi, 4)] } : { x, n, rate: null, wilson: null });

/** Recall and precision of the cue guard against graph truth. items: [{id, platform, text, truth}] (cues are computed here). */
export function scoreCorpus(items) {
  const rows = items.map(i => ({ ...i, cues: guardCues(i.text) }));
  const out = {};
  for (const c of [...CLASSES, 'any']) {
    const P = rows.filter(r => r.truth[c]), G = rows.filter(r => r.cues[c]), TP = rows.filter(r => r.truth[c] && r.cues[c]);
    const recall = rate(TP.length, P.length), precision = rate(TP.length, G.length);
    out[c] = {
      items: rows.length, truthPositives: P.length, baseRate: round(P.length / rows.length, 4), cueFires: G.length, truePositives: TP.length, recall, precision,
      missed: P.length - TP.length, verdict090: recall.rate === null ? 'undefined' : recall.rate >= 0.9 ? (recall.wilson[0] >= 0.9 ? 'infer (lower bound >= 0.9)' : 'infer (point >= 0.9, lower bound below)') : 'ask (recall < 0.9)',
      meets095: recall.rate !== null && recall.rate >= 0.95,
    };
  }
  const trig = rows.filter(r => r.truth.trigger);
  out.trigger = { truthPositives: trig.length, baseRate: round(trig.length / rows.length, 4), note: 'declared N, not a hard requirement: outside "any"' };
  const byPlatform = {};
  for (const r of rows) { const p = (byPlatform[r.platform] ??= { items: 0, any: 0, cueAny: 0, hit: 0 }); p.items += 1; p.any += r.truth.any ? 1 : 0; p.cueAny += r.cues.any ? 1 : 0; p.hit += r.truth.any && r.cues.any ? 1 : 0; }
  return { classes: out, byPlatform: Object.fromEntries(Object.entries(byPlatform).sort((a, b) => b[1].items - a[1].items).map(([k, v]) => [k, { ...v, recallAny: v.any ? round(v.hit / v.any, 3) : null }])), askRate: round(rows.filter(r => r.cues.any).length / rows.length, 4) };
}

/** Load the corpus overlay: the original-provenance items. Prefers items.jsonl, falls back to the committed gzip. */
export function loadOverlay(dir = CORPUS_DIR) {
  const plain = path.join(dir, 'items.jsonl'), gz = path.join(dir, 'items.jsonl.gz');
  let text, file;
  if (existsSync(plain)) { file = plain; text = readFileSync(plain, 'utf8'); }
  else if (existsSync(gz)) { file = gz; text = gunzipSync(readFileSync(gz)).toString('utf8'); }
  else return null;
  const counts = {}, items = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const o = JSON.parse(line), prov = o.description?.provenance ?? 'none';
    counts[prov] = (counts[prov] ?? 0) + 1;
    if (prov === 'original') items.push({ id: o.id, platform: o.source?.platform ?? 'unknown', text: o.description.text, truth: graphTruth(o) });
  }
  return { items, counts, source: sourceOf(file) };
}

// ------------------------------------------------------------------------------------------------ Part B: E8 and runbook
const PREREG_CANDIDATES = Object.freeze({
  runbook: ['effects', 'human'],        // PREREG-NEED-V1 §3.2: effects with authority, human approval (bed README)
  e8: ['wait', 'schedule', 'effects'],  // durable wait, schedule, effects with authority (E-BED)
});

// A timer, deadline or schedule declared in a typed field: a key named for one, or an enum or const value that is one (a `timedOut` status). Prose
// fields (descriptions, domains) are never searched: the point is what the bed TYPES, not what its text says.
export const SCHEDULE_RE = /timer|deadline|schedul|cron|dueAt|dueDate|due_at|timedOut|timed_out|timeout|expir/i;
const PROSE_KEYS = new Set(['description', 'about', 'text', 'domain', 'note', 'notes', 'question', 'title']);
/** Paths (under `label`) of typed declarations in `root` that name a timer, deadline or schedule. Deterministic order; at most `limit`. */
export function timeDeclarations(root, label, { limit = 8, re = SCHEDULE_RE } = {}) {
  const out = [];
  const walk = (v, p, inEnum, depth) => {
    if (out.length >= limit || depth > 16) return;
    if (typeof v === 'string') { if (inEnum && re.test(v)) out.push(`${p} = ${JSON.stringify(v)}`); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${p}[${i}]`, inEnum, depth + 1)); return; }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (PROSE_KEYS.has(k)) continue;
        if (re.test(k)) { out.push(`${p}.${k}`); if (out.length >= limit) return; }
        walk(x, `${p}.${k}`, inEnum || k === 'enum' || k === 'const', depth + 1);
      }
    }
  };
  walk(root, label, false, 0);
  return out;
}

/** Typed evidence per requirement class from E8's machine-readable declarations. */
export function typedFieldsE8(mod) {
  const eff = Object.entries(mod.schemas.effects ?? {});
  const horizon = mod.family.clock?.horizon;
  const searched = ['family', 'schemas', 'systems'];
  return {
    human: { evidence: Object.keys(mod.schemas.humanTasks ?? {}).map(k => `schemas.humanTasks.${k}`) },
    wait: { evidence: horizon && /day/.test(horizon.unit) && horizon.length >= 1 ? [`family.clock.horizon = ${horizon.length} ${horizon.unit}`, `family.profile = ${mod.family.profile}`] : [] },
    // The customer deadline race and the 14-day clock are typed as a `timedOut` order status (schemas.sor and systems); searched, not assumed.
    schedule: { evidence: [...timeDeclarations(mod.schemas, 'schemas'), ...timeDeclarations(mod.systems, 'systems'), ...timeDeclarations(mod.family, 'family')].slice(0, 8), searched,
      note: 'the host-side typed fields name the deadline race only as a timeout outcome (the timedOut order status); the deadline itself (dueAt, onTimeout) sits in the analyst-side oracleItem and in the spec text' },
    effects: { evidence: eff.filter(([, e]) => e.money && !e.readOnly).map(([k]) => `schemas.effects.${k}.money`) },
    compensation: { evidence: eff.filter(([, e]) => e.reverses).map(([k, e]) => `schemas.effects.${k}.reverses = ${e.reverses}`) },
  };
}
/** Typed evidence per class from the runbook's output schema (its action vocabulary). */
export function typedFieldsRunbook(mod) {
  const ops = mod.outputSchema?.properties?.actions?.items?.properties?.op?.enum ?? [];
  const mutating = ['drain', 'undrain', 'restart', 'set_flag', 'apply_config', 'rollback_config'].filter(o => ops.includes(o));
  return {
    human: { evidence: ops.includes('page_human') ? ['outputSchema op page_human (an escalation: approval semantics are not typed)'] : [] },
    wait: { evidence: ops.includes('wait') ? ['outputSchema op wait'] : [] },
    schedule: { evidence: timeDeclarations(mod.outputSchema, 'outputSchema').concat(timeDeclarations(mod.family, 'family')), searched: ['outputSchema', 'family'] },
    effects: { evidence: mutating.map(o => `outputSchema op ${o}`) },
    compensation: { evidence: ops.includes('rollback_config') ? ['outputSchema op rollback_config'] : [] },
  };
}

const stringsOf = v => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(stringsOf) : []);

/** Run Part B. Modules are imported lazily and failures are reported, never hidden. */
export async function runPartB({ root = REPO, seed = 601, difficulty = 3 } = {}) {
  const out = {};
  const load = async rel => { try { return { mod: await import(pathToFileURL(path.join(root, rel)).href) }; } catch (e) { return { error: String(e?.message ?? e).slice(0, 200) }; } };
  const e8 = await load('beds/ebed/e8/index.mjs');
  if (e8.mod) {
    const typed = typedFieldsE8(e8.mod), text = e8.mod.specE.text;
    // bed: the module graph that produced the typed fields (bedStamp), beside the SPEC-E.md hash that produced the cues (currency.mjs reads both as inputs).
    out.e8 = { text: { what: 'spec/SPEC-E.md (the arm-facing rulebook)', sha256: e8.mod.specE.sha256, chars: text.length }, bed: bedStamp('ebed/e8', { repo: root, version: e8.mod.family.version }), typed, cues: guardCues(text), declared: PREREG_CANDIDATES.e8 };
  } else out.e8 = { error: e8.error, declared: PREREG_CANDIDATES.e8 };
  const rb = await load('beds/runbook/index.mjs');
  if (rb.mod) {
    const task = rb.mod.generate({ seed, split: 'dev', difficulty });
    const inputsText = stringsOf(task.inputs ?? {}).join('\n');
    out.runbook = {
      text: { what: `generate({seed: ${seed}, split: 'dev', difficulty: ${difficulty}}): prompt, then prompt + ticket + runbook + inventory`, promptChars: task.prompt.length, inputChars: inputsText.length },
      bed: bedStamp('runbook', { repo: root, version: rb.mod.family?.version ?? null }),
      typed: typedFieldsRunbook(rb.mod), cuesPrompt: guardCues(task.prompt), cuesPromptAndInputs: guardCues(`${task.prompt}\n${inputsText}`), declared: PREREG_CANDIDATES.runbook,
    };
  } else out.runbook = { error: rb.error, declared: PREREG_CANDIDATES.runbook };
  // Recall per bed: declared requirement classes found by (a) a typed field, (b) a word cue.
  for (const [id, key] of [['e8', 'cues'], ['runbook', 'cuesPromptAndInputs']]) {
    const b = out[id];
    if (!b.declared || b.error) continue;
    b.perClass = Object.fromEntries(b.declared.map(c => [c, { typed: (b.typed?.[c]?.evidence ?? []).length > 0, cueOnPromptOrSpec: !!(b.cuesPrompt ?? b.cues)[c], cueOnFullText: !!b[key][c] }]));
    const n = b.declared.length;
    // Typed evidence the preregistered candidate list does not name (a candidate list that is too short is itself a finding).
    b.typedNotDeclared = Object.entries(b.typed ?? {}).filter(([c, v]) => v.evidence.length && !b.declared.includes(c)).map(([c, v]) => ({ class: c, evidence: v.evidence.slice(0, 3) }));
    b.recall = { typed: round(Object.values(b.perClass).filter(x => x.typed).length / n, 3), cuePromptOrSpec: round(Object.values(b.perClass).filter(x => x.cueOnPromptOrSpec).length / n, 3), cueFullText: round(Object.values(b.perClass).filter(x => x.cueOnFullText).length / n, 3), declared: n };
  }
  return out;
}

export async function runD5({ overlay = loadOverlay(), partB = null } = {}) {
  const b = partB ?? await runPartB();
  const corpus = overlay ? { ...scoreCorpus(overlay.items), items: overlay.items.length, provenanceCounts: overlay.counts, source: overlay.source } : null;
  const any = corpus?.classes.any;
  return {
    id: 'D5', grade: 'dev', question: 'Guard recall: do word cues find the hard requirements that are really there? (RX6-lite)',
    cueMap: { human: 'human-gate cue | shape humanWords', wait: 'durable-wait cue | timeWords after/until/when', schedule: 'timeWords every/daily/cron', effects: 'shape effectVerbs | high-risk cue | compensation cue' },
    corpus: corpus ?? { missing: 'research/corpus-20261006/items.jsonl and items.jsonl.gz not found: Part A skipped' },
    e8AndRunbook: b,
    summary: {
      corpusItems: corpus?.items ?? null, recallAny: any?.recall.rate ?? null, recallAnyLower: any?.recall.wilson?.[0] ?? null, precisionAny: any?.precision.rate ?? null, askRate: corpus?.askRate ?? null,
      recallByClass: corpus ? Object.fromEntries(CLASSES.map(c => [c, corpus.classes[c].recall.rate])) : null, guardAsksInsteadOfInferring: corpus ? CLASSES.filter(c => corpus.classes[c].recall.rate < 0.9) : null,
      e8TypedRecall: b.e8?.recall?.typed ?? null, e8CueRecall: b.e8?.recall?.cueFullText ?? null, runbookTypedRecall: b.runbook?.recall?.typed ?? null, runbookCueRecall: b.runbook?.recall?.cueFullText ?? null,
    },
  };
}
