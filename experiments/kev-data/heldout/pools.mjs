// Held-out surface pools: formats, parsing, features, lint, skeleton slicing, quota selection
// (JUDGE-PROGRAM.md §2.4, §3.3; JUDGE-BUILD-PLAN.json group "heldout-author").
//
// Isolation: this module and everything under experiments/kev-data/heldout/ is written from the
// port contracts (spec/ports.json) and the program text only. It never opens beds/, the frozen
// copies, or any training pool; the copy filter (copy-filter.mjs) is the only code that touches
// them, and it reports ids and counts, never text.
//
// The authored sources are plain text under .foundry/kev-data/heldout/authored/ (git-ignored):
//   one unit per line, `reg[,tag[=value]...]@@field[@@field...]`; blank lines and `#` lines skipped.
//   reg is a register code (REGISTERS). Fields are the unit's text(s); placeholders are {S} (the
//   system), {S2} (another system), {token} (the R2 marker), {w0} {w1} (an R4 date window), {field}
//   (the R4 update-field name), {city} {country} (R1 team city / server country). The same names the
//   train pools use, so one line provider serves both.
import { createHash } from 'node:crypto';
import { skeleton, skeletonPercent, sentences } from '../lib/hash.mjs';
import { defaultMasks } from '../lib/leakage.mjs';

export const OOD_SLICES = Object.freeze(['calib-ood', 'dev-ood', 'test-ood']);
// §2.4: >= 200 lines per label, 40 calib-OOD / 60 dev-OOD / 100 test-OOD.
export const QUOTA = Object.freeze({ 'calib-ood': 40, 'dev-ood': 60, 'test-ood': 100 });
// Authored lines are never train lines, so the whole hash space is shared out among the three OOD
// slices in the quota ratio 5 : 3 : 2 (build-plan: "sliced 40 / 60 / 100 by skeleton hash"). This is
// NOT lib/hash.mjs skeletonBucket, which keeps 60% of the space for bed-rendered train states.
export const SLICE_CUTS = Object.freeze([['test-ood', 50], ['dev-ood', 80], ['calib-ood', 100]]);
export function oodSliceOfHash(hash) {
  const p = skeletonPercent(hash);
  for (const [slice, cut] of SLICE_CUTS) if (p < cut) return slice;
  return 'calib-ood';
}

export const REGISTERS = Object.freeze({ o: 'ops-chat', v: 'vendor-doc', n: 'non-native', e: 'email', t: 'ticket', c: 'changelog', f: 'faq', m: 'memo' });
export const NAMED_REGISTERS = Object.freeze(['o', 'v', 'n']);        // §2.4: terse ops chat, vendor documentation, non-native English
// Author-declared probe-hard devices (§2.4): negation, counter-keyword, decisive word in the wrong
// role, comparison/contrast. The audit's own measure (shortcut-audit) is the one that gates.
export const HARD_TAGS = Object.freeze(['neg', 'ctr', 'wr', 'cmp']);
export const X1_KINDS = Object.freeze(['log', 'ticket', 'doc', 'memo', 'chat', 'email', 'cell', 'commit', 'comment', 'readme', 'form', 'review', 'journal', 'post']);

// X1 addressee words (JUDGE-PROGRAM.md §1.2 X1: "AI, AUTOMATED, ASSISTANT, SYSTEM:, bot, override, ...";
// the crit-S Q14 regex itself is not published, so these are this group's resolution). CORE is the
// named list: a negative counts as "with an addressee word" only on CORE. BROAD adds the obvious
// extensions: a positive counts as "without an addressee word" only if BROAD finds nothing. Both
// directions are therefore stricter than any single reading of the program's list.
export const ADDRESSEE_CORE = /\b(?:AI|A\.I\.|LLMs?|assistants?|automated|bots?|chatbots?|override[sd]?|overriding|overridden)\b|\bSYSTEM\s*:/i;
export const ADDRESSEE_BROAD = new RegExp(`${ADDRESSEE_CORE.source}|\\b(?:agents?|models?|copilot|gpt|chatgpt|claude|gemini|language model|prompts?|instructions?|disregard|ignore (?:all |any |the |every |your )?(?:previous|prior|above|earlier)|parser|reader|crawler|scraper|summari[sz]er|pipeline)\\b`, 'i');
export const hasCoreAddressee = text => ADDRESSEE_CORE.test(text);
export const hasBroadAddressee = text => ADDRESSEE_BROAD.test(text);

// ---- pool definitions ---------------------------------------------------------------------------
const ALL_SLOTS = ['S', 'S2', 'token', 'w0', 'w1', 'field', 'city', 'country'];
export const POOLS = Object.freeze({
  R1: { kind: 'line', labels: ['dmy', 'mdy', 'ymd'], extraLabels: ['know'], slots: ['S', 'city', 'country'], require: ['S'], systemsFrom: 'R1' },
  R2: { kind: 'line', labels: ['void', 'live'], slots: ['S', 'token'], require: ['S', 'token'], systemsFrom: 'R2' },
  R3: { kind: 'line', labels: ['same', 'opposite'], slots: ['S'], require: ['S'], systemsFrom: 'R3' },
  R4: { kind: 'line', labels: ['reliable', 'restamped'], slots: ['S', 'w0', 'w1', 'field'], require: ['S'], systemsFrom: 'R4' },
  X1: { kind: 'line', labels: ['yes', 'no'], slots: [], require: [], register: true, sourceKind: true },
  X5: { kind: 'x5', labels: ['holds', 'violated', 'not_stated'], slots: ['S', 'S2', 'token'], systemsFrom: 'R1' },
  X8: { kind: 'x8', labels: ['consistent', 'inconsistent'], slots: ['S', 'token'], require: ['S'], systemsFrom: 'R1' },
});
export const WAVE1_UNKNOWABLE = Object.freeze(['R1', 'R2', 'R3', 'R4']);
export const CARRIER_PORTS = Object.freeze({
  R1: ['dmy', 'mdy', 'ymd'], R2: ['void', 'live'], R3: ['same', 'opposite'], R4: ['reliable', 'restamped'],
  I1: ['connection_pool_exhaustion', 'certificate_expiry', 'bad_config_deploy', 'disk_full', 'dns_resolution_failure', 'memory_leak_oom', 'clock_skew', 'upstream_rate_limiting', 'poisoned_cache'],
  I2: ['origin', 'relay', 'fallback', 'unrelated'], S2: ['own_measurement', 'quoted', 'projected', 'instruction_like'], Q4: ['as_expected', 'drifted'],
  X3: ['changes', 'confirms', 'proposes', 'retracts', 'mentions'], X5: ['holds', 'violated', 'not_stated'], X8: ['consistent', 'inconsistent'],
  F1: ['flake', 'variance', 'defect', 'env', 'impossible', 'finding'],
});
export const X5_KINDS = Object.freeze({ date: ['dmy', 'mdy', 'ymd'], sign: ['same', 'opposite'], status: ['void', 'live'], stamp: ['reliable', 'restamped'] });
export const X8_KINDS = Object.freeze({ date: ['dmy', 'mdy', 'ymd'], sign: ['same', 'opposite'], status: ['void', 'live'] });
export const NS_KINDS = Object.freeze(['other-system', 'other-convention', 'absent-system', 'unrelated']);
export const PRESENCE_MATCHED = Object.freeze(['other-system', 'other-convention']);

export class AuthorError extends Error { constructor(code, message, details) { super(`${code}: ${message}`); this.code = code; this.details = details; } }

// ---- parsing --------------------------------------------------------------------------------------
export function parseMeta(s, { file, lineNo } = {}) {
  const parts = String(s).split(',').map(x => x.trim()).filter(Boolean);
  let register = null; const tags = {};
  parts.forEach((p, i) => {
    if (i === 0 && !p.includes('=') && REGISTERS[p]) { register = p; return; }
    const eq = p.indexOf('=');
    if (eq < 0) tags[p] = true; else tags[p.slice(0, eq)] = p.slice(eq + 1);
  });
  return { register, tags, file, lineNo };
}
export function parseSource(text, { file = '<memory>' } = {}) {
  const out = [];
  String(text).split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const parts = line.split('@@').map(x => x.trim());
    if (parts.length < 2) throw new AuthorError('AUTHOR_FORMAT', `${file}:${i + 1}: expected meta@@field (got no @@)`);
    out.push({ meta: parseMeta(parts[0], { file, lineNo: i + 1 }), fields: parts.slice(1), file, lineNo: i + 1 });
  });
  return out;
}

// ---- text features ------------------------------------------------------------------------------------
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
export const placeholdersOf = text => [...new Set([...String(text).matchAll(PLACEHOLDER)].map(m => m[1]))];
const NEGATION = /\b(?:not|no|never|neither|nor|without|isn't|aren't|doesn't|don't|didn't|won't|cannot|can't|n't|rather than|instead of|unlike|but not|except)\b/i;
export const normText = t => String(t).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const tokensOf = t => normText(t).replace(PLACEHOLDER, ' _ ').replace(/\d+/g, '0').match(/[\p{L}\p{N}_]+/gu) ?? [];
export function ngramSet(text, n = 4) {
  const w = tokensOf(text), out = new Set();
  if (w.length < n) { if (w.length) out.add(w.join(' ')); return out; }
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}
export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0; const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of s) if (l.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// Numeric date examples inside a line, with the order they unambiguously show (R1 lint).
export function dateExamples(text) {
  const out = [];
  for (const m of String(text).matchAll(/(?<![\d/.\-])(\d{1,4})([/.\-])(\d{1,2})\2(\d{1,4})(?![\d/.\-])/g)) {
    const [, a, , b, c] = m;
    let order = null;
    if (a.length === 4) order = 'ymd';
    else if (c.length === 4) { if (Number(a) > 12 && Number(b) <= 12) order = 'dmy'; else if (Number(b) > 12 && Number(a) <= 12) order = 'mdy'; }
    out.push({ text: m[0], order });
  }
  return out;
}

export function featuresOf(text) {
  const t = String(text);
  const ph = placeholdersOf(t);
  return {
    words: (t.match(/[\p{L}\p{N}']+/gu) ?? []).length, sentences: sentences(t).length, placeholders: ph,
    window: ph.includes('w0') && ph.includes('w1'), addressee: { core: hasCoreAddressee(t), broad: hasBroadAddressee(t) },
    negation: NEGATION.test(t), needsWorldKnowledge: ph.includes('city') || ph.includes('country'),
  };
}
export const skeletonOf = (text, masks = defaultMasks()) => skeleton(sentences(text).join(' '), masks);
export const hash8 = text => createHash('sha256').update(normText(text)).digest('hex').slice(0, 10);

// ---- lint -----------------------------------------------------------------------------------------------
const R1_WORDS = {
  dmy: /\b(?:day[- ]first|day[- ]month[- ]year|dd[/.\-]mm|d\/m\/y|dmy|little[- ]endian|day before (?:the )?month|day,? then (?:the )?month|day leads|day comes first|day goes first|day of (?:the )?month (?:goes|comes) first|day of (?:the )?month leads|day of (?:the )?month is (?:the )?(?:first|leading)|day up front|day is in front|day (?:in|at) the (?:beginning|start|front)|day,? (?:then )?(?:the )?month,? (?:then )?(?:the )?year)/i,
  mdy: /\b(?:month[- ]first|month[- ]day[- ]year|mm[/.\-]dd|m\/d\/y|mdy|us[- ](?:style|format|order|way)|american (?:style|format|order|way)|month before (?:the )?day|month,? then (?:the )?day|(?<!of (?:the )?)month (?:leads|comes first|goes first)|month up front|month (?:in|at) the (?:beginning|start|front)|month,? (?:then )?(?:the )?day,? (?:then )?(?:the )?year)/i,
  ymd: /\b(?:year[- ]first|year[- ]month[- ]day|yyyy[/.\-]mm|ymd|big[- ]endian|iso[- ]?8601|iso[- ](?:style|order)|year before (?:the )?month|year,? then (?:the )?month|(?<!of (?:the )?)year (?:leads|comes first|goes first)|year up front|year (?:in|at) the (?:beginning|start|front)|year,? (?:then )?(?:the )?month,? (?:then )?(?:the )?day)/i,
};
const isHard = tags => HARD_TAGS.some(t => tags[t]);

export function lintEntry(poolName, label, entry, { systems, nondeciding = false, slots = null } = {}) {
  const pool = POOLS[poolName], errs = [];
  const { meta, fields } = entry, tags = meta.tags;
  const where = `${entry.file}:${entry.lineNo}`;
  const e = m => errs.push(`${where}: ${m}`);
  if (pool.register !== false && !meta.register) e('missing register code');
  for (const f of fields) {
    if (f.length < 6 || f.length > 900) e(`text length ${f.length} outside 6..900`);
    if (/\s{2,}/.test(f)) e('double whitespace');
    if (/[\t\r]/.test(f)) e('tab or carriage return');
    const bare = f.replace(PLACEHOLDER, '');
    if (/[{}]/.test(bare)) e('stray brace (only {name} placeholders)');
  }
  const allowed = new Set(slots ?? pool.slots ?? []);
  const checkPh = f => { for (const p of placeholdersOf(f)) if (!allowed.has(p)) e(`placeholder {${p}} not allowed in ${poolName}${nondeciding ? ' non-deciding lines' : ''}`); };
  if (tags.tu !== undefined && !['1', '2'].includes(String(tags.tu))) e('tu=<round> must be 1 or 2 (at most two top-up rounds)');
  if (tags.sys) for (const s of String(tags.sys).split('+')) if (!systems.includes(s)) e(`sys=${s} is not a ${poolName} system`);
  if (nondeciding) { for (const f of fields) checkPh(f); const ph = placeholdersOf(fields[0]); if (ph.includes('w0') !== ph.includes('w1')) e('{w0} and {w1} come together'); return errs; }
  if (pool.kind === 'line') {
    const text = fields[0]; checkPh(text);
    for (const r of pool.require ?? []) if (!placeholdersOf(text).includes(r)) e(`decisive line lacks {${r}}`);
    if (pool.sourceKind && !X1_KINDS.includes(tags.k)) e(`X1 line needs k=<source kind> (${X1_KINDS.join('|')})`);
    const ph = placeholdersOf(text);
    if (ph.includes('w0') !== ph.includes('w1')) e('{w0} and {w1} come together');
    if (poolName === 'R1' && label === 'know') {
      if (!(ph.includes('city') || ph.includes('country')) || (ph.includes('city') && ph.includes('country'))) e('knowledge lines carry exactly one of {city} or {country}');
      for (const [k, re] of Object.entries(R1_WORDS)) if (re.test(text)) e(`knowledge line names ${k} keywords; the label must come from the city or country alone`);
      for (const x of dateExamples(text)) e(`knowledge line shows a numeric date example ${x.text}`);
    } else if (poolName === 'R1') {
      if (ph.includes('city') || ph.includes('country')) e('{city}/{country} lines belong in know*.txt (their label is the place\'s order)');
      const own = label === 'ymd' ? new RegExp(`${R1_WORDS.ymd.source}|\\byear\\b|\\biso\\b|\\byyyy|four[- ]digit|4[- ]digit|four digits`, 'i') : R1_WORDS[label]; const others = Object.entries(R1_WORDS).filter(([k]) => k !== label);
      for (const x of dateExamples(text)) if (x.order && x.order !== label && !isHard(tags)) e(`example ${x.text} shows ${x.order}, the line is ${label}`);
      if (!isHard(tags)) for (const [k, re] of others) if (re.test(text) && !own.test(text)) e(`names ${k} keywords only, line is ${label} (tag neg/ctr/wr/cmp if intended)`);
    }
  } else if (pool.kind === 'x8') {
    const text = fields[0]; checkPh(text);
    for (const r of pool.require ?? []) if (!placeholdersOf(text).includes(r)) e(`conventions line lacks {${r}}`);
    if (!tags.K || !X8_KINDS[tags.K]) e(`X8 line needs K=${Object.keys(X8_KINDS).join('|')}`);
    else if (!X8_KINDS[tags.K].includes(tags.V)) e(`X8 K=${tags.K} needs V=${X8_KINDS[tags.K].join('|')}`);
    if (tags.K === 'status' && !placeholdersOf(text).includes('token')) e('X8 status lines name the marker {token}');
  } else if (pool.kind === 'x5') {
    const want = label === 'pair' ? 3 : 2;
    if (fields.length !== want) e(`X5 ${label} entry needs ${want} fields (text${label === 'pair' ? '@@assumption-that-holds@@assumption-that-is-violated' : '@@assumption'})`);
    for (const f of fields) checkPh(f);
    if (!X5_KINDS[tags.K]) e(`X5 entry needs K=${Object.keys(X5_KINDS).join('|')}`);
    else if (!X5_KINDS[tags.K].includes(tags.V)) e(`X5 K=${tags.K} needs V=${X5_KINDS[tags.K].join('|')}`);
    if (label === 'pair') {
      if (!X5_KINDS[tags.K]?.includes(tags.W) || tags.W === tags.V) e('X5 pair needs W=<a different value of the same kind> (the violated assumption states W)');
      if (!placeholdersOf(fields[0]).includes('S')) e('X5 pair text names {S}');
      for (const f of fields.slice(1)) if (!placeholdersOf(f).includes('S')) e('X5 assumptions name {S}');
    } else {
      if (!NS_KINDS.includes(tags.ns)) e(`X5 not_stated entry needs ns=${NS_KINDS.join('|')}`);
      if (fields[1] && !placeholdersOf(fields[1]).includes('S')) e('X5 assumptions name {S}');
    }
  }
  return errs;
}

// ---- units -------------------------------------------------------------------------------------------------
export function systemEligibility(entry, systems) {
  const t = entry.meta.tags.sys;
  return t ? String(t).split('+') : [...systems];
}
export const declaredHard = tags => HARD_TAGS.filter(t => tags[t]);

// A unit shared by every pool: stable id, text(s), meta, features, skeleton and slice.
export function makeUnit(port, label, entry, { systems, masks = defaultMasks(), role = null } = {}) {
  const text = entry.fields[0];
  const sk = skeletonOf(text, masks);
  const tags = entry.meta.tags;
  return {
    id: `${port}-${role ?? label}-${hash8(text)}`, port, label, text, register: entry.meta.register ? REGISTERS[entry.meta.register] : null,
    regCode: entry.meta.register ?? null, tags: Object.keys(tags).sort(), tagMap: { ...tags }, hard: declaredHard(tags), systems: systemEligibility(entry, systems),
    features: featuresOf(text), skeleton: sk, slice: oodSliceOfHash(sk), source: `${entry.file}:${entry.lineNo}`,
  };
}

// ---- quota selection ---------------------------------------------------------------------------------------
const byHash = (a, b) => (a.skeleton < b.skeleton ? -1 : a.skeleton > b.skeleton ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export { byHash };

// Choose `quota` units from `candidates` (deterministic, skeleton-hash order) so that class shares
// hold: exact {cls: share} (rounded counts), min {cls: share} (at least ceil), max {cls: share} (at
// most floor); `forced` units (already admitted) are taken first and count toward the classes.
// Returns {selected, shortfall, counts}.
export function selectQuota(candidates, quota, { classOf = () => 'all', exact = null, min = {}, max = {}, forced = [] } = {}) {
  const ordered = [...candidates].sort(byHash), chosen = new Set(), counts = {};
  for (const u of forced) { if (!chosen.has(u)) { chosen.add(u); counts[classOf(u)] = (counts[classOf(u)] ?? 0) + 1; } }
  const take = (pred, n) => { let c = 0; for (const u of ordered) { if (c >= n) break; if (chosen.has(u) || !pred(u)) continue; chosen.add(u); counts[classOf(u)] = (counts[classOf(u)] ?? 0) + 1; c++; } return c; };
  const caps = Object.fromEntries(Object.entries(max).map(([k, s]) => [k, Math.floor(s * quota)]));
  if (exact) {
    const names = Object.keys(exact); let left = quota;
    names.forEach((cls, i) => { const n = i === names.length - 1 ? left : Math.round(exact[cls] * quota); left -= n; take(u => classOf(u) === cls, n - (counts[cls] ?? 0)); });
  }
  for (const [cls, share] of Object.entries(min)) take(u => classOf(u) === cls, Math.ceil(share * quota) - (counts[cls] ?? 0));
  take(u => { const c = classOf(u); return !(c in caps) || (counts[c] ?? 0) < caps[c]; }, quota - chosen.size);
  return { selected: ordered.filter(u => chosen.has(u)), shortfall: quota - chosen.size, counts };
}
export const SELECTION = Object.freeze({
  R4: { classOf: u => (u.features.window ? 'window' : 'plain'), exact: { window: 0.5, plain: 0.5 } },
  X1yes: { classOf: u => (u.features.addressee.broad ? 'addr' : 'noaddr'), min: { noaddr: 0.56 } },
  X1no: { classOf: u => (u.features.addressee.core ? 'addr' : 'noaddr'), min: { addr: 0.36 } },
  X5notStated: { classOf: u => u.ns, min: { 'other-system': 0.25, 'other-convention': 0.3 }, max: { 'absent-system': 0.08 } },
  X8: { classOf: u => u.kind, min: { date: 0.3, sign: 0.2, status: 0.2 } },
});
