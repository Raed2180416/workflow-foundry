// State-only solver helpers for the records ports R1-R4 (JUDGE-PROGRAM.md §2.7 step 1: "solve/<port>.mjs reads
// only the exported state and question; for template ports a template match on the state string with the
// exported pools, in the manner of beds/records/solve-text.mjs, restricted to the state").
//
// A solver sees { state, question } and a SolverContext: the exported pools of the bed (ORDER_NOTE, FLAG_NOTE,
// PERSP_NOTE, MIRROR_NOTE, RELIABLE_NOTE, FLAG_FORM, UPDATE_FIELD, the team-city lists), loaded by the caller
// from the frozen copy, and the pool lines (train pools, built-ins, the slice's authored lines) a build uses.
// It returns { label, via } or { label: null, reason } (undecidable: no deciding sentence, a conflict, or a
// sentence that needs knowledge the context does not hold). It never reads a world, a seed, a template id or
// any meta.
//
// How a label is read (independent of how the generator wrote the sentence):
//   example sentences   semantically: "written 05/10/1998 is 10 May 1998" is day first because the first number
//                       is the day (beds/records solve-text.mjs dateOrderOfExample)
//   fixed sentences     by exact text of the pool template, with its slots (system, marker, field, dates) matched
//   team-city sentences by the city's country (TEAM_CITIES): world knowledge the port declares for R1
//   reference sentences by the order stated in the referenced system's paragraph (one hop, in the state)
//   pool lines          by the label the line was written to, with its placeholders matched
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_NO = Object.fromEntries(MONTHS.map((m, i) => [m.toLowerCase(), i + 1]));
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DATE_RE = '\\d{1,2} [A-Z][a-z]+ \\d{4}';

// cities: held-out team cities [{city, order}] (gazetteer knowledge the port allows, like TEAM_CITIES)
export function makeSolverContext(bed, lines = [], { cities = [] } = {}) {
  const { render, pools } = bed;
  const cityOrder = new Map();
  for (const [order, list] of Object.entries(pools.TEAM_CITIES)) for (const c of list) cityOrder.set(c, order);
  for (const c of cities) cityOrder.set(c.city, c.order);
  return { render, pools, lines, cityOrder, cache: new Map() };
}

export function paragraphOf(text, system) {
  const blocks = String(text).split(/\n\s*\n/).map(b => b.trim());
  return blocks.find(b => b.startsWith(`${system}. `)) ?? null;
}
const systemsIn = text => [...new Set(String(text).split(/\n\s*\n/).map(b => /^([A-Z][A-Z0-9]{2,})\. /.exec(b.trim())?.[1]).filter(Boolean))];

// A pool line as a regex over a sentence of the asked system: placeholders become the state's own values or
// wildcards for dates, years, example numbers and names.
function lineRegex(line, vals) {
  let out = '', last = 0;
  const text = String(line.text);
  for (const m of text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    out += esc(text.slice(last, m.index)); last = m.index + m[0].length;
    const n = m[1];
    if (n === 'S') out += esc(vals.S);
    else if (n === 'token') out += vals.token ? esc(vals.token) : '[^\\n]+?';
    else if (n === 'field') out += vals.field ? esc(vals.field) : '[^\\s]+';
    else if (n === 'w0' || n === 'w1') out += DATE_RE;
    else if (n === 'year') out += '\\d{4}';
    else if (n === 'ex') out += '[\\d/]+';
    else if (n === 'ex_long') out += DATE_RE;
    else if (n === 'month') out += '[A-Z][a-z]+';
    else if (n === 'day') out += '\\d{1,2}';
    else out += '[^\\n]+?';
  }
  return new RegExp(out + esc(text.slice(last)));
}
function matchLines(sc, paragraph, port, vals, labelOf = l => l.label) {
  const hits = [];
  for (const line of sc.lines) {
    if (line.port !== port || (line.system && line.system !== vals.S) || !line.label) continue;
    if (['carrier', 'nondeciding', 'assumption', 'positive', 'benign', 'decoy', 'hard-negative'].includes(line.kind) || line.group === 'carrier') continue;
    const key = `${line.id ?? line.text}|${vals.S}|${vals.token ?? ''}|${vals.field ?? ''}`;
    let re = sc.cache.get(key);
    if (!re) sc.cache.set(key, re = lineRegex(line, vals));
    const m = re.exec(paragraph);
    if (m) hits.push({ label: labelOf(line), via: `line:${line.id}`, len: m[0].length });
  }
  return hits;
}
// Resolve a set of hits: the longest match wins; hits of different labels that are not nested are a conflict.
function resolve(hits) {
  if (!hits.length) return { label: null, reason: 'no-deciding-sentence' };
  const labels = [...new Set(hits.map(h => h.label))];
  if (labels.length === 1) return { label: labels[0], via: hits[0].via };
  hits.sort((a, b) => b.len - a.len);
  if (hits[0].len > hits[1].len) return { label: hits[0].label, via: hits[0].via };
  return { label: null, reason: `conflict:${labels.join('/')}` };
}

// ---- R1 ----------------------------------------------------------------------------------------------------------------------
const num = s => Number(s);
// Example sentences: order from the relation of the written numbers to the stated meaning.
function exampleOrder(a, b, meaningDay, meaningMonth) {
  if (num(a) === meaningDay && num(b) === meaningMonth && num(a) !== num(b)) return 'dmy';
  if (num(a) === meaningMonth && num(b) === meaningDay && num(a) !== num(b)) return 'mdy';
  return null;
}
const monthOf = name => MONTH_NO[String(name).toLowerCase()] ?? null;
export function solveOrderIn(sc, text, S, depth = 0) {
  const P = paragraphOf(text, S);
  if (!P) return { label: null, reason: 'no-paragraph' };
  const hits = [], add = (label, via, len = 1) => { if (label) hits.push({ label, via, len }); };
  let m;
  if (S === 'ATLAS') {
    if ((m = /an ATLAS birth date written (\d\d)\/(\d\d)\/\d{4} is (\d{1,2}) ([A-Za-z]+) \d{4}\./.exec(P))) add(exampleOrder(m[1], m[2], num(m[3]), monthOf(m[4])), 'example');
    if ((m = /An ATLAS row "born (\d\d)\/(\d\d)\/\d{4}" belongs to someone born in ([A-Za-z]+)\./.exec(P))) add(num(m[1]) === monthOf(m[3]) ? 'mdy' : num(m[2]) === monthOf(m[3]) ? 'dmy' : null, 'row-example');
  }
  if (S === 'BRIGHTDESK') {
    if ((m = /For example, dob=(\d\d)\/(\d\d)\/\d{4} is (\d{1,2}) ([A-Za-z]+) \d{4}\./.exec(P))) add(exampleOrder(m[1], m[2], num(m[3]), monthOf(m[4])), 'example');
    if ((m = /A customer with dob=(\d\d)\/(\d\d)\/\d{4} was born in ([A-Za-z]+)\./.exec(P))) add(num(m[1]) === monthOf(m[3]) ? 'mdy' : num(m[2]) === monthOf(m[3]) ? 'dmy' : null, 'row-example');
  }
  if (S === 'VENDEX') {
    if ((m = /A numeric date such as (\d\d)\/(\d\d)\/\d{4} means (?:([A-Za-z]+) (\d{1,2}), \d{4}|(\d{1,2}) ([A-Za-z]+) \d{4})\./.exec(P))) {
      const mon = m[3] ? monthOf(m[3]) : monthOf(m[6]), day = m[4] ? num(m[4]) : num(m[5]);
      add(exampleOrder(m[1], m[2], day, mon), 'example');
    }
    if ((m = /In a numeric date the first number is the (month|day) \(so (\d\d)\/(\d\d)\/\d{4} falls in ([A-Za-z]+)\)\./.exec(P))) add(m[1] === 'month' ? 'mdy' : 'dmy', 'first-number');
    const c1 = /The team works from (.+?) and writes numeric dates the way people there do/.exec(P)?.[1];
    const c2 = /The team moved from (.+?) to (.+?) in 2015 and has written numeric dates the local way ever since/.exec(P);
    if (c1 || c2) {
      // the team's city (the new one, for a move) decides: month first in US cities, day first in the others
      const city = c1 ?? c2[2];
      if (sc.cityOrder.has(city)) add(sc.cityOrder.get(city), c1 ? 'team-city' : 'team-city-moved');
      else return { label: null, reason: 'world-knowledge:city-not-in-gazetteer' };
    }
  }
  // fixed sentences of the pool (exact text with the slots matched); example, city and reference templates are handled above or below
  const { ORDER_NOTE } = sc.render;
  for (const order of ['dmy', 'mdy']) {
    ORDER_NOTE[S]?.[order]?.forEach((tpl, i) => {
      if (tpl.ref) {
        const r = new RegExp(`${esc(tpl.t({ ref: { [S]: '\u0001' } }).split('\u0001')[0])}(BRIGHTDESK|LEDGR|ATLAS|VENDEX)${esc(tpl.t({ ref: { [S]: '\u0001' } }).split('\u0001')[1])}`).exec(P);
        if (r && depth === 0) {
          const t = r[1] === 'LEDGR' ? { label: 'dmy' } : solveOrderIn(sc, text, r[1], depth + 1);
          if (t.label) add(t.label, `ref:${r[1]}`);
        }
        return;
      }
      const marker = ['\u0001A', '\u0001B', '\u0001C'];
      const rendered = (() => { try { return tpl.t({ atlasEx: { y: 1, m: 2, d: 3 }, bdEx: { y: 1, m: 2, d: 3 }, vxEx: { y: 1, m: 2, d: 3 }, serverDmy: marker[0], cityUS: marker[1], cityEU: marker[2], ref: {} }); } catch { return null; } })();
      if (rendered === null || /\d\d\/\d\d\/\d{4}|falls in|belongs to someone born|was born in/.test(rendered) || rendered.includes(marker[1]) || rendered.includes(marker[2])) return;
      const re = new RegExp(esc(rendered).replace(esc(marker[0]), '[^.]+?'));
      if (re.test(P)) add(order, `tpl:${S}.${order}[${i}]`, rendered.length);
    });
  }
  hits.push(...matchLines(sc, P, 'R1', { S }));
  return resolve(hits);
}
export function stateText(state) { return String(state.source_note ?? state.source_text ?? ''); }

// ---- R2 ----------------------------------------------------------------------------------------------------------------------
export function solveFlag(sc, state) {
  const S = state.system, P = paragraphOf(state.source_note, S);
  if (!P) return { label: null, reason: 'no-paragraph' };
  const F = sc.render.FLAG_FORM[S], marker = state.marker, hits = [];
  if (F) for (const pol of ['live', 'void']) sc.render.FLAG_NOTE[pol].forEach((fn, i) => { const t = fn(marker, F); if (P.includes(t)) hits.push({ label: pol, via: `tpl:FLAG_NOTE.${pol}[${i}]`, len: t.length }); });
  hits.push(...matchLines(sc, P, 'R2', { S, token: marker }));
  return resolve(hits);
}

// ---- R3 ----------------------------------------------------------------------------------------------------------------------
export function solveSide(sc, state) {
  const S = state.system, P = paragraphOf(state.source_note, S);
  if (!P) return { label: null, reason: 'no-paragraph' };
  const hits = [];
  for (const [side, label] of [['recv', 'same'], ['pay', 'opposite']]) sc.render.PERSP_NOTE[S]?.[side]?.forEach((t, i) => { if (P.includes(t)) hits.push({ label, via: `tpl:PERSP_NOTE.${S}.${side}[${i}]`, len: t.length }); });
  hits.push(...matchLines(sc, P, 'R3', { S }));
  return resolve(hits);
}

// ---- R4 ----------------------------------------------------------------------------------------------------------------------
export function solveStamp(sc, state) {
  const S = state.system, P = paragraphOf(state.source_note, S);
  if (!P) return { label: null, reason: 'no-paragraph' };
  const f = sc.render.UPDATE_FIELD[S], hits = [];
  const W = ['\u0001W0', '\u0001W1'];
  sc.render.MIRROR_NOTE.forEach((fn, i) => {
    const re = new RegExp(esc(fn(S, f, W)).split(esc(W[0])).join(DATE_RE).split(esc(W[1])).join(DATE_RE));
    const m = re.exec(P); if (m) hits.push({ label: 'restamped', via: `tpl:MIRROR_NOTE[${i}]`, len: m[0].length });
  });
  sc.render.RELIABLE_NOTE.forEach((fn, i) => {
    const re = new RegExp(esc(fn(S, f, '\u0001Y')).split(esc('\u0001Y')).join('\\d{4}'));
    const m = re.exec(P); if (m) hits.push({ label: 'reliable', via: `tpl:RELIABLE_NOTE[${i}]`, len: m[0].length });
  });
  hits.push(...matchLines(sc, P, 'R4', { S, field: f }));
  return resolve(hits);
}
