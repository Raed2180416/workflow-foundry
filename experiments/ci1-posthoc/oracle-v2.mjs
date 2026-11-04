// CI-1 oracle v2: POST HOC corrections of defects found by root-causing the test-split failures after the freeze
// (research/ci1-20261021/RESULT-CI1.md §4). Kept outside experiments/ci1 so the frozen oracle (canon.mjs `equivalent`, v1) is untouched
// and the preregistered numbers stay the primary result. v2 differs from v1 in exactly five declared ways:
//   1. Leak exemption for the addressee: a message may mention the world row that holds its own recipient's address (greeting the
//      subscriber by name is not leaking another row). v1 flagged it, e.g. item 16364, where the reference does not greet by name.
//   2. Categorical cells do not identify a row: a column with few distinct values across the item's frozen worlds (a status, a
//      currency, a type) is not used for row identity, so a message saying "if you have already paid" does not leak the one row whose
//      Status is "Paid" (v1 flagged it in item 17878).
//   3. Per-item optional spans (POSTHOC_DECL): text spans of the REFERENCE message whose facts the description never asked for are
//      removed before the required facts are extracted (e.g. 14177's section counts "Overdue Invoices (1)").
//   4. A date the reference writes as an ISO date may be written by the built workflow as a numeric day/month/year date
//      ("15/06/2026", "06.15.2026"): the candidate's numeric dates also count as date facts, under every valid reading (DD/MM and
//      MM/DD when both are valid). Only the candidate side is widened, so a reference that writes DD/MM/YYYY (because the description
//      asks for that format) still requires those numbers. Found in 17811 (A0 k0 wrote every shift date as DD/MM/YYYY).
//   5. A number directly followed by a prose comma is a number: v1's tokenizer swallowed "2026," / "5," / "1,234," whole and dropped
//      them (normNumber rejects the trailing comma), so "expires 28/07/2026, 0 days left" carried no 2026. Found in 17807 (A1c k1,
//      2026-11-04 session). Applied to both sides (fixCommas before tokenizing); on the 24 frozen wave-1 oracles the reference side gains
//      no fact (measured: 0 facts over every hidden reference message), so for wave 1 it only widens the candidate side.
// Everything else (counts per recipient, facts, sheets, responses) is v1. Items whose description leaves a scored value undecided are
// listed in AMBIGUOUS: they are kept in v2 and dropped only in the v2x sensitivity analysis (RESULT-CI1.md §4).
import { tokens, factsOf, normCell, jsonDiff } from '../ci1/canon.mjs';

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const tryJson = s => { try { return JSON.parse(s); } catch { return s; } };

/** Post hoc per-item declarations, each justified from the description alone (RESULT-CI1.md §4.2). */
export const POSTHOC_DECL = Object.freeze({
  '14177': { optional: { mail: ['Overdue Invoices \\(\\d+\\)', 'All Unpaid Invoices \\(\\d+\\)'] },
    why: 'The e-mail section headers carry counts ("Overdue Invoices (1)", "All Unpaid Invoices (2)") the description never asks for (it asks for three totals and two lists; counts only for the Slack alert).' },
  '17545': { optional: { mail: ['Quiet for \\d+-\\d+ days\\.'] },
    why: 'Each group\'s explanatory line ("Quiet for 7-20 days.") carries the range bounds the description gives as definitions, not as text to show.' },
});
/** Items whose description leaves a value the oracle scores undecided (found by the description-entailment audit of all 19 test
 *  items, RESULT-CI1.md §4.3). v2 keeps them; the v2x sensitivity analysis drops them. Never used to change a verdict. */
export const AMBIGUOUS = Object.freeze({
  '17545': '"At the top say how many open quotes there are" (and open_count in the log) may or may not include the open quotes left out for a missing, unreadable or future sent_date; the reference excludes them.',
  '16312': '"Overdue items should also be posted to #deadlines" does not say one post per item or one post listing them; the reference posts one per item and the oracle counts posts per channel.',
});

/** Categorical columns ("sheet|column"): at most 6 distinct non-empty values over all the given worlds, each seen at least twice on average. */
export function categoricalColumns(worlds) {
  const vals = new Map();
  for (const w of worlds) for (const [name, s] of Object.entries(w.sheets ?? {})) for (const r of (s.rows ?? s)) for (const [k, v] of Object.entries(r)) {
    const t = String(v ?? '').trim().toLowerCase(); if (!t) continue;
    const key = `${name}|${k}`; if (!vals.has(key)) vals.set(key, []); vals.get(key).push(t);
  }
  return new Set([...vals].filter(([, xs]) => { const d = new Set(xs).size; return d <= 6 && xs.length >= 2 * d; }).map(([k]) => k));
}
/** Identity tokens of each world row plus, per row, the addresses it holds (for the addressee exemption); categorical cells are skipped. */
export function rowIdentitiesWithAddresses(world, vocab, categorical = new Set()) {
  const rows = [];
  const add = (obj, sheet = null) => { if (isObj(obj)) { const toks = Object.entries(obj).filter(([k, v]) => (typeof v === 'string' || typeof v === 'number') && !(sheet && categorical.has(`${sheet}|${k}`))).flatMap(([, v]) => tokens(String(v))); rows.push({ toks, addrs: toks.filter(t => t.includes('@')) }); } };
  for (const [name, s] of Object.entries(world.sheets ?? {})) for (const r of (s.rows ?? s)) add(r, name);
  const ev = world.event; const evRows = Array.isArray(ev) ? ev : Array.isArray(ev?.body) ? ev.body : null;
  if (evRows) evRows.forEach(add);
  for (const v of Object.values(ev?.body ?? {})) if (Array.isArray(v)) v.forEach(add);
  const count = new Map(); for (const r of rows) for (const t of new Set(r.toks)) count.set(t, (count.get(t) ?? 0) + 1);
  return rows.map(r => ({ ids: [...new Set(r.toks)].filter(t => count.get(t) === 1 && !vocab.has(t) && !/^D:|^-?\d+(\.\d+)?$/.test(t) && t.length >= 3), addrs: r.addrs })).filter(r => r.ids.length);
}
/** Change 5: separate a number from a prose comma that follows it ("2026, 0 days" -> "2026 , 0 days"); thousands separators and
 *  decimal commas (a comma followed by a digit) are untouched. */
export const fixCommas = text => String(text ?? '').replace(/(\d),(?!\d)/g, '$1 ,');
/** v1's facts of a text with change 5 (a superset of v1's facts). */
export const factsV2 = (text, vocab) => [...new Set([...factsOf(text, vocab), ...factsOf(fixCommas(text), vocab)])];
/** Candidate tokens: v1 tokens with change 5, plus, for every numeric d/m/y date, its D: date token under each valid reading (change 4). */
export function candTokens(text) {
  const out = [...tokens(text), ...tokens(fixCommas(text))];
  const valid = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = n => String(n).padStart(2, '0');
  for (const [, a, , b, y] of String(text ?? '').matchAll(/(?<![\d.\/])(\d{1,2})([\/.])(\d{1,2})\2(\d{4})(?![\d])/g)) {
    const [A, B, Y] = [Number(a), Number(b), Number(y)];
    if (valid(Y, B, A)) out.push(`D:${Y}-${pad(B)}-${pad(A)}`);
    if (valid(Y, A, B)) out.push(`D:${Y}-${pad(A)}-${pad(B)}`);
  }
  return out;
}
const strip = (text, patterns) => (patterns ?? []).reduce((t, p) => t.replace(new RegExp(p, 'g'), ' '), String(text));

/** v1's equivalence with the five post hoc corrections. decl: v1 decl + { optional: {mail, chat}, rowsWithAddresses } */
export function equivalentV2(ref, cand, decl = {}) {
  const vocab = decl.vocab instanceof Set ? decl.vocab : new Set(decl.vocab ?? []);
  const rows = decl.rowsWithAddresses ?? [];
  const reasons = [];
  if (!cand) return { pass: false, reasons: ['no candidate run'] };
  if (ref.ok && !cand.ok) reasons.push(`the built workflow did not finish: ${cand.error ?? 'failed'}`);
  if (!ref.ok && cand.ok) reasons.push('the reference stopped with an error here and the built workflow did not');
  const rowsMentioned = (text, recipient) => { const tk = new Set(candTokens(text)); return rows.map((r, i) => (r.ids.some(t => tk.has(t)) && !(recipient && r.addrs.includes(recipient)) ? i : -1)).filter(i => i >= 0); };
  const matchGroup = (kind, keyOf, textOf, refList, candList, optional) => {
    const groups = new Map();
    for (const m of refList) { const k = keyOf(m); if (!groups.has(k)) groups.set(k, { ref: [], cand: [] }); groups.get(k).ref.push(m); }
    for (const m of candList) { const k = keyOf(m); if (!groups.has(k)) groups.set(k, { ref: [], cand: [] }); groups.get(k).cand.push(m); }
    for (const [k, g] of groups) {
      if (g.ref.length !== g.cand.length) { reasons.push(`${kind} to ${k}: ${g.cand.length} sent, expected ${g.ref.length}`); continue; }
      const recipient = kind === 'e-mail' ? k : null;
      const refs = g.ref.map(m => ({ m, facts: factsV2(strip(textOf(m), optional), vocab), rows: new Set(rowsMentioned(textOf(m), recipient)) })).sort((a, b) => b.facts.length - a.facts.length);
      const free = g.cand.map(m => ({ m, tk: new Set(candTokens(textOf(m))), rows: rowsMentioned(textOf(m), recipient) }));
      for (const r of refs) {
        const i = free.findIndex(c => r.facts.every(f => c.tk.has(f)) && c.rows.every(x => r.rows.has(x)));
        if (i >= 0) { free.splice(i, 1); continue; }
        const best = free.map(c => ({ c, miss: r.facts.filter(f => !c.tk.has(f)), leak: c.rows.filter(x => !r.rows.has(x)) })).sort((a, b) => a.miss.length + a.leak.length - b.miss.length - b.leak.length)[0];
        reasons.push(`${kind} to ${k}: no message carries ${best?.miss.length ? `the facts [${best.miss.slice(0, 6).join(', ')}]` : ''}${best?.miss.length && best?.leak.length ? ' and ' : ''}${best?.leak.length ? `only the right rows (it mentions ${best.leak.length} row(s) the reference leaves out)` : ''}`);
        if (best) free.splice(free.indexOf(best.c), 1);
      }
    }
  };
  matchGroup('e-mail', m => m.to, m => `${m.subject}\n${m.body}`, ref.mail ?? [], cand.mail ?? [], decl.optional?.mail);
  matchGroup('chat', m => m.channel, m => m.text, ref.chat ?? [], cand.chat ?? [], decl.optional?.chat);
  const rr = ref.respond ?? [], cr = cand.respond ?? [];
  if (rr.length !== cr.length) reasons.push(`responses: ${cr.length}, expected ${rr.length}`);
  else rr.forEach((r, i) => {
    const c = cr[i];
    if (decl.respondCode && Number(r.code) !== Number(c.code)) reasons.push(`response ${i + 1}: status ${c.code}, expected ${r.code}`);
    if (isObj(r.body) || Array.isArray(r.body)) { const why = jsonDiff(r.body, typeof c.body === 'string' ? tryJson(c.body) : c.body, vocab); if (why) reasons.push(`response ${i + 1}: ${why}`); }
    else { const tk = new Set(candTokens(typeof c.body === 'string' ? c.body : JSON.stringify(c.body))); const miss = factsV2(String(r.body ?? ''), vocab).filter(f => !tk.has(f)); if (miss.length) reasons.push(`response ${i + 1}: missing facts [${miss.slice(0, 6).join(', ')}]`); }
  });
  const names = new Set([...Object.keys(ref.sheets ?? {}), ...Object.keys(cand.sheets ?? {})]);
  for (const name of names) {
    const R = ref.sheets?.[name] ?? [], Cn = cand.sheets?.[name] ?? [];
    const cols = [...new Set(R.flatMap(r => Object.keys(r)).filter(k => k !== 'row_number'))];
    const mask = decl.mask?.[name] ?? {}, free = new Set(decl.freeText?.[name] ?? []);
    const extraCols = [...new Set(Cn.flatMap(r => Object.keys(r)))].filter(k => !cols.includes(k) && k !== 'row_number' && Cn.some(r => normCell(r[k]) !== ''));
    if (R.length !== Cn.length) { reasons.push(`sheet ${name}: ${Cn.length} rows, expected ${R.length}`); continue; }
    if (extraCols.length && R.length) { reasons.push(`sheet ${name}: writes columns the reference never fills [${extraCols.slice(0, 5).join(', ')}]`); continue; }
    const cellOk = (col, rv, cv) => {
      if (mask[col] === 'any') return true;
      if (mask[col] === 'nonempty') return normCell(cv) !== '';
      if (free.has(col)) { const tk = new Set(candTokens(cv)); return factsV2(String(rv ?? ''), vocab).every(f => tk.has(f)); }
      return normCell(rv) === normCell(cv);
    };
    const pool = [...Cn];
    for (const r of R) {
      const i = pool.findIndex(c => cols.every(col => cellOk(col, r[col], c[col])));
      if (i >= 0) pool.splice(i, 1);
      else { const bad = pool.length ? cols.filter(col => !cellOk(col, r[col], pool[0][col])) : cols; reasons.push(`sheet ${name}: no row matches reference row ${JSON.stringify(Object.fromEntries(cols.slice(0, 6).map(k => [k, r[k]])))} (first differing columns: ${bad.slice(0, 4).join(', ')})`); break; }
    }
  }
  return { pass: reasons.length === 0, reasons };
}
