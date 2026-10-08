// train-pools: the records bed's label-bearing note templates as paraphrase input (JUDGE-PROGRAM.md
// §1.2 R1-R4, §2.4, §3.3). Templates are read from the FROZEN bed copy (lib/pin.mjs frozenBeds) only.
//
//   extractTemplates(beds)   every template of ORDER_NOTE, FLAG_NOTE, PERSP_NOTE, MIRROR_NOTE and
//                            RELIABLE_NOTE with its dynamic parts turned back into placeholders, verified
//                            by a round trip (filling the placeholders with the sentinel values must
//                            reproduce the bed's own rendering exactly)
//   heldOutRule(template)    the §3.3 held-out bed templates (a diagnostic sub-axis; never paraphrase input)
//   paraphraseInput(...)     the templates a paraphraser may see: held-out ones removed, asserted by id and
//                            by skeleton (assertInputClean)
//   fillLine(line, values)   fills a pool line's placeholders (the factory's and the two-model filter's way
//                            of turning a pool line into a sentence)
//
// Slot vocabulary. The program lists {S}, {token}, {w0}, {w1} and {field} (§2.4); the ORDER_NOTE and
// FLAG_NOTE templates also carry example dates, a referenced system, a server country, team cities, an
// audit year and the comparison descriptors of FLAG_FORM, so the vocabulary below extends the program's
// five slots. "Preserved exactly" means: the multiset of placeholders of a paraphrase equals its source
// template's (specGap in the manifest).
import { createHash } from 'node:crypto';
import { sentences, skeleton } from '../lib/hash.mjs';
import { defaultMasks } from '../lib/leakage.mjs';

export const SLOT_VOCABULARY = Object.freeze({
  S: 'the system the sentence is about (BRIGHTDESK, ATLAS, VENDEX, LEDGR, KOBO, VERITAS)',
  token: 'the extra status value as displayed in that system\'s rows (FLAG_FORM[S].show(token))',
  w0: 'first date of the mirror rebuild window, as the bed writes it ("3 March 2024")',
  w1: 'last date of the mirror rebuild window',
  field: 'the update-date field of the system (UPDATE_FIELD[S])',
  year: 'a calendar year (the vendor audit year, RELIABLE_NOTE)',
  live_ref: 'FLAG_FORM[S].live: the fixed live marker the sentence compares the status value to',
  void_ref: 'FLAG_FORM[S].void: the fixed void marker the sentence compares the status value to',
  ref: 'another system whose numeric date order this system shares (c.ref)',
  ex: 'the numeric example date written in the line\'s order ("03/11/1987" day first, "11/03/1987" month first, "1987/11/03" year first)',
  ex_long: 'the same example date in words, "3 November 1987"',
  month: 'the example date\'s month name',
  day: 'the example date\'s day number',
  server: 'the country where the system\'s servers stand (SERVER_DMY)',
  city_us: 'a US team city (TEAM_CITIES.mdy)',
  city_eu: 'a day-first-country team city (TEAM_CITIES.dmy)',
});
export const SLOT_NAMES = Object.freeze(Object.keys(SLOT_VOCABULARY));
export const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
export const slotsOf = text => [...String(text).matchAll(PLACEHOLDER_RE)].map(m => m[1]).sort();
export const sameSlots = (a, b) => { const x = slotsOf(a), y = slotsOf(b); return x.length === y.length && x.every((s, i) => s === y[i]); };

const sha = text => createHash('sha256').update(text).digest('hex');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const p2 = n => String(n).padStart(2, '0');
export const exampleText = ({ y, m, d }, order) => order === 'ymd' ? `${y}/${p2(m)}/${p2(d)}` : `${p2(order === 'mdy' ? m : d)}/${p2(order === 'mdy' ? d : m)}/${y}`;

export const SYSTEMS = Object.freeze(['BRIGHTDESK', 'ATLAS', 'VENDEX', 'LEDGR', 'KOBO', 'VERITAS']);
export const R1_SYSTEMS = Object.freeze(['ATLAS', 'BRIGHTDESK', 'VENDEX']);   // the systems with ORDER_NOTE pools
export const R3_SYSTEMS = Object.freeze(['BRIGHTDESK', 'ATLAS', 'LEDGR', 'KOBO']);

// ---- extraction -------------------------------------------------------------------------------
const SENT = Object.freeze({ ex: Object.freeze({ y: 1987, m: 11, d: 3 }), ref: 'REFSYS', server: 'SERVERLAND', cityUs: 'CITYUS', cityEu: 'CITYEU' });
function sentinelCtx() {
  const e = { ...SENT.ex };
  return { ref: { ATLAS: SENT.ref, VENDEX: SENT.ref }, atlasEx: e, bdEx: e, vxEx: e, serverDmy: SENT.server, cityUS: SENT.cityUs, cityEU: SENT.cityEu };
}
const replaceAll = (text, from, to) => text.split(from).join(to);
// The bed rendering with sentinel values -> text with placeholders (see the round trip below).
function toPlaceholders(text, system, order) {
  let t = text;
  t = replaceAll(t, `${MONTHS[10]} 3, 2021`, '{month} {day}, 2021');       // VENDEX month-first meaning
  t = replaceAll(t, '3 November 2021', '{day} {month} 2021');              // VENDEX day-first meaning
  t = replaceAll(t, '3 November 1987', '{ex_long}');
  t = replaceAll(t, exampleText({ ...SENT.ex, y: 2021 }, order), '{ex}');
  t = replaceAll(t, exampleText(SENT.ex, order), '{ex}');
  t = replaceAll(t, 'November', '{month}');
  t = replaceAll(t, SENT.ref, '{ref}');
  t = replaceAll(t, SENT.server, '{server}');
  t = replaceAll(t, SENT.cityUs, '{city_us}');
  t = replaceAll(t, SENT.cityEu, '{city_eu}');
  t = t.replace(new RegExp(`\\b${system}\\b`, 'g'), '{S}');
  return t;
}

// Fill a pool line's placeholders. values: { S, token, w0, w1, field, year, live_ref, void_ref, ref,
// server, city_us, city_eu, ex: {y, m, d} }. The order of {ex} is the line's own (line.order); a line
// with exYear writes the example in that year (the bed's VENDEX templates fix 2021). A placeholder
// without a value throws.
export function fillLine(line, values = {}) {
  const need = name => { if (values[name] === undefined || values[name] === null) throw new Error(`fillLine: no value for {${name}} (${line.id ?? line.text})`); return values[name]; };
  const ex = () => { const e = need('ex'); return line.exYear ? { ...e, y: line.exYear } : e; };
  return String(line.text).replace(PLACEHOLDER_RE, (_, name) => {
    switch (name) {
      case 'ex': return exampleText(ex(), line.order ?? line.label);
      case 'ex_long': { const e = ex(); return `${e.d} ${MONTHS[e.m - 1]} ${e.y}`; }
      case 'month': return MONTHS[ex().m - 1];
      case 'day': return String(ex().d);
      default:
        if (!SLOT_NAMES.includes(name)) throw new Error(`fillLine: unknown placeholder {${name}}`);
        return String(need(name));
    }
  });
}

// Deterministic example values for a line: used by the two-model brief and the tests. The same line
// always fills the same way (a hash of its id), so a re-run asks the models the same question.
export function canonicalValues(line, bedConsts = {}) {
  const h = sha(`kev-data:train-pools:fill:${line.id ?? line.text}`);
  const n = (i, mod) => parseInt(h.slice(i * 4, i * 4 + 4), 16) % mod;
  let m = 1 + n(0, 12), d = 1 + n(1, 12); if (d === m) d = (d % 12) + 1;
  const S = line.system && SYSTEMS.includes(line.system) ? line.system : 'ATLAS';
  const FF = bedConsts.FLAG_FORM?.[S], toks = bedConsts.FLAG_TOKENS?.[S];
  return {
    S, ex: { y: 1950 + n(2, 50), m, d },
    token: FF && toks ? FF.show(toks[n(3, toks.length)]) : `status=hold`,
    live_ref: FF?.live ?? 'ordinary live rows', void_ref: FF?.void ?? 'the fixed test rows',
    field: bedConsts.UPDATE_FIELD?.[S] ?? 'updated',
    w0: `${1 + n(4, 9)} March 2024`, w1: `${10 + n(5, 18)} April 2024`, year: 2019 + n(6, 6),
    ref: S === 'ATLAS' ? 'LEDGR' : 'ATLAS', server: ['Ireland', 'Germany', 'the Netherlands', 'Australia'][n(7, 4)],
    city_us: ['Chicago', 'Denver', 'Seattle', 'Boston'][n(8, 4)], city_eu: ['Leeds', 'Lyon', 'Oslo', 'Cork'][n(9, 4)],
  };
}

// Held-out bed templates (JUDGE-PROGRAM.md §3.3, the "diagnostic sub-axis" column). They are re-rendered
// elsewhere and are never paraphrase input.
//   R1: choices.orderTpl[S], the highest index per (system, order)   -> 6 forms
//   R2: choices.flagTpl[i] 6 and 7 (both polarities)                  -> 4 forms
//   R3: choices.perspTpl[S] 3 (every system, both sides)              -> 8 forms
//   R4: choices.mirrorTpl 4 and choices.reliableTpl 4                 -> 2 templates (7 (system) forms)
export const HELD_OUT_RULES = Object.freeze({
  R1: 'highest index per (system, order) of ORDER_NOTE', R2: 'FLAG_NOTE index 6 and 7', R3: 'PERSP_NOTE index 3', R4: 'MIRROR_NOTE index 4 and RELIABLE_NOTE index 4',
});
export function heldOutRule(t, extent) {
  switch (t.port) {
    case 'R1': return t.index === extent.R1[`${t.system}:${t.order}`] - 1;
    case 'R2': return t.index === 6 || t.index === 7;
    case 'R3': return t.index === 3;
    case 'R4': return t.index === 4;
    default: return false;
  }
}

export function extractTemplates(beds) {
  return beds.import('beds/records/render.mjs').then(mod => buildTemplates(mod, beds.read('beds/records/render.mjs')));
}

function buildTemplates(mod, renderSource) {
  const { ORDER_NOTE, FLAG_NOTE, PERSP_NOTE, MIRROR_NOTE, RELIABLE_NOTE, FLAG_FORM, UPDATE_FIELD } = mod;
  const out = [], ctx = sentinelCtx(), extent = { R1: {} };
  // R1
  for (const system of Object.keys(ORDER_NOTE)) {
    for (const order of ['dmy', 'mdy']) {
      const list = ORDER_NOTE[system][order];
      extent.R1[`${system}:${order}`] = list.length;
      list.forEach((tpl, index) => {
        const rendered = tpl.t(ctx);
        const text = toPlaceholders(rendered, system, order);
        const exYear = system === 'VENDEX' && text.includes('{ex}') ? 2021 : null;
        out.push({ id: `R1:${system}:${order}:${index}`, port: 'R1', pool: 'ORDER_NOTE', system, label: order, order, index, source: `ORDER_NOTE.${system}.${order}[${index}]`,
          text, slots: slotsOf(text), refTemplate: !!tpl.ref, exYear, rendered });
      });
    }
  }
  // R2
  for (const polarity of ['live', 'void']) {
    FLAG_NOTE[polarity].forEach((fn, index) => {
      const text = fn('{token}', { live: '{live_ref}', void: '{void_ref}' });
      out.push({ id: `R2:${polarity}:${index}`, port: 'R2', pool: 'FLAG_NOTE', system: null, label: polarity, order: null, index, source: `FLAG_NOTE.${polarity}[${index}]`, text, slots: slotsOf(text), rendered: text });
    });
  }
  // R3 (recv -> same, pay -> opposite; the bed's PERSP_NOTE has no VENDEX pool)
  for (const system of Object.keys(PERSP_NOTE)) {
    for (const [side, label] of [['recv', 'same'], ['pay', 'opposite']]) {
      PERSP_NOTE[system][side].forEach((raw, index) => {
        const text = raw.replace(new RegExp(`\\b${system}\\b`, 'g'), '{S}');
        out.push({ id: `R3:${system}:${label}:${index}`, port: 'R3', pool: 'PERSP_NOTE', system, label, side, order: null, index, source: `PERSP_NOTE.${system}.${side}[${index}]`, text, slots: slotsOf(text), rendered: raw });
      });
    }
  }
  // R4
  MIRROR_NOTE.forEach((fn, index) => {
    const text = fn('{S}', '{field}', ['{w0}', '{w1}']);
    out.push({ id: `R4:restamped:${index}`, port: 'R4', pool: 'MIRROR_NOTE', system: null, label: 'restamped', order: null, index, source: `MIRROR_NOTE[${index}]`, text, slots: slotsOf(text), rendered: text });
  });
  RELIABLE_NOTE.forEach((fn, index) => {
    const text = fn('{S}', '{field}', '{year}');
    out.push({ id: `R4:reliable:${index}`, port: 'R4', pool: 'RELIABLE_NOTE', system: null, label: 'reliable', order: null, index, source: `RELIABLE_NOTE[${index}]`, text, slots: slotsOf(text), rendered: text });
  });

  // Round trip: filling the sentinel values back in must reproduce the bed's own rendering exactly.
  for (const t of out) {
    if (t.port !== 'R1') continue;
    const back = fillLine({ ...t, id: t.id }, { S: t.system, ref: SENT.ref, server: SENT.server, city_us: SENT.cityUs, city_eu: SENT.cityEu, ex: { ...SENT.ex } });
    if (back !== t.rendered) throw new Error(`TEMPLATE_ROUNDTRIP: ${t.id}: ${JSON.stringify(back)} != ${JSON.stringify(t.rendered)}`);
  }
  // Held-out marking and slot-carried siblings.
  const byId = new Map(out.map(t => [t.id, t]));
  for (const t of out) {
    t.heldOut = heldOutRule(t, extent);
    const sib = pairOf(t);
    t.pairKey = pairKeyOf(t);
    // Slot-carried: the masked skeleton equals the flip partner's (placeholders all mask alike), so the label is
    // carried by the slot values ({ex}/{month}, {ref}, {city_us} against {city_eu}, {live_ref} against {void_ref}).
    t.slotCarried = !!sib && !!byId.get(sib) && templateSkeleton(byId.get(sib)) === templateSkeleton(t);
  }
  return { templates: out, extent, source: { file: 'beds/records/render.mjs', sha256: sha(renderSource) }, consts: { FLAG_FORM, UPDATE_FIELD } };
}

// The flip partner of a template: same pool, same index, opposite label.
export function pairOf(t) {
  switch (t.port) {
    case 'R1': return `R1:${t.system}:${t.order === 'dmy' ? 'mdy' : 'dmy'}:${t.index}`;
    case 'R2': return `R2:${t.label === 'live' ? 'void' : 'live'}:${t.index}`;
    case 'R3': return `R3:${t.system}:${t.label === 'same' ? 'opposite' : 'same'}:${t.index}`;
    default: return null;   // R4: MIRROR_NOTE and RELIABLE_NOTE are different pools, not mirrored
  }
}
export function pairKeyOf(t) {
  switch (t.port) {
    case 'R1': return `R1:${t.system}:${t.index}`;
    case 'R2': return `R2:${t.index}`;
    case 'R3': return `R3:${t.system}:${t.index}`;
    default: return t.id;
  }
}

// ---- the paraphrase input ---------------------------------------------------------------------
export function templateSkeleton(t) { return skeleton(sentences(t.text).join(' '), defaultMasks()); }
export function paraphraseInput(templates) { return templates.filter(t => !t.heldOut); }

// The input must contain no held-out template, by id and by skeleton (acceptance 1). Returns the
// violations ([] = clean).
export function assertInputClean(input, templates) {
  const heldOut = templates.filter(t => t.heldOut), ids = new Set(heldOut.map(t => t.id)), skels = new Map(heldOut.map(t => [templateSkeleton(t), t.id]));
  const bad = [];
  for (const t of input) {
    if (ids.has(t.id) || t.heldOut) bad.push({ id: t.id, by: 'id' });
    else if (skels.has(templateSkeleton(t))) bad.push({ id: t.id, by: 'skeleton', collidesWith: skels.get(templateSkeleton(t)) });
  }
  return bad;
}
