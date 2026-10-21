// CI-1 oracle: behavioural equivalence of a built workflow's effects with the reference's effects in the same seeded world
// (research/ci1-20261021/DOSSIER.md §4 item 3). Not text similarity. Pure functions, no imports.
//
// Canonical effects: { ok, mail: [{to, subject, body}] (one per recipient), chat: [{channel, text}], respond: [{code, body}],
//                     sheets: {name: rows} (final state of every sheet either side wrote) }.
// Equivalence rules (frozen with the bed; per-item declarations may only mask generated values or mark free-text columns):
//   - the same number of messages to each recipient / channel, and of responses; no extra effects of any kind (over-reach fails);
//   - a message matches when it carries every FACT of the reference message: a token of the reference text that is not in the
//     item's static vocabulary (every word or number written in the workflow definition itself). Wording, layout and greetings are
//     free; values that came from the world (names, amounts, dates, counts) are not;
//   - LEAK: a candidate message that mentions a world row the reference message does not mention fails (no dumping all data);
//   - sheet rows match as multisets on the reference's columns, after cell normalisation; masked columns only need a value;
//   - JSON responses match by normalised deep equality; text responses by facts.
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const pad = n => String(n).padStart(2, '0');

/** Normalise a numeric token: "1,200.50" -> "1200.5", "$45.00" -> "45", "-3" -> "-3". */
export function normNumber(t) {
  const s = String(t).replace(/[$€£¥₹]/g, '').replace(/,(?=\d{3}\b)/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? String(Math.round(n * 1e6) / 1e6) : null;
}
/** Fact tokens of a text: dates become D:yyyy-mm-dd, numbers are normalised, words lowercased (>= 2 chars), e-mails kept whole. */
export function tokens(text) {
  let s = String(text ?? '');
  const out = [];
  // ISO date-times and dates
  s = s.replace(/\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g, (_, y, m, d) => { out.push(`D:${y}-${m}-${d}`); return ' '; });
  // "March 5, 2026" / "5 March 2026" / "Mar 5 2026"
  const mon = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const mi = m => MONTHS.findIndex(x => x.startsWith(m.toLowerCase().slice(0, 3))) + 1;
  s = s.replace(new RegExp(`\\b${mon}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'), (_, m, d, y) => { out.push(`D:${y}-${pad(mi(m))}-${pad(d)}`); return ' '; });
  s = s.replace(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${mon}\\.?,?\\s+(\\d{4})\\b`, 'gi'), (_, d, m, y) => { out.push(`D:${y}-${pad(mi(m))}-${pad(d)}`); return ' '; });
  // e-mail addresses and URLs whole
  s = s.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, m => { out.push(m.toLowerCase()); return ' '; });
  s = s.replace(/https?:\/\/[^\s"'<>)]+/g, m => { out.push(m.toLowerCase().replace(/[.,;]$/, '')); return ' '; });
  // codes that mix letters and digits stay whole ("T-1", "INV-1002", "SKU_42a", "3B")
  s = s.replace(/(?<![\p{L}\p{N}])(?=[\p{L}\p{N}_-]*\p{L})(?=[\p{L}\p{N}_-]*\p{N})[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*(?![\p{L}\p{N}])/gu, m => { out.push(m.toLowerCase()); return ' '; });
  // numbers (with thousands separators, decimals, currency); a minus sign only when it does not follow a letter or digit
  s = s.replace(/[$€£¥₹]?(?:(?<![\p{L}\p{N}])-)?\d[\d,]*(\.\d+)?%?/gu, m => { const n = normNumber(m.replace(/%$/, '')); if (n !== null) out.push(n); return ' '; });
  for (const w of s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}\p{N}]+/u)) if (w.length >= 2) out.push(w);
  return out;
}
/** The item's static vocabulary: every token written anywhere in the reference workflow definition (parameters and code). */
export function staticVocabulary(workflow) {
  const vocab = new Set();
  // Escapes inside code and expression strings ("\n\nBest regards") would glue words to the escape letter: unescape first.
  const unescape = s => s.replace(/\\[nrtbfv0]/g, ' ').replace(/\\u[0-9a-fA-F]{4}/g, ' ').replace(/\\(["'`\\])/g, ' $1 ');
  const walk = v => { if (typeof v === 'string') for (const t of [...tokens(v), ...tokens(unescape(v))]) vocab.add(t); else if (Array.isArray(v)) v.forEach(walk); else if (isObj(v)) for (const [k, x] of Object.entries(v)) { for (const t of tokens(k)) vocab.add(t); walk(x); } };
  for (const n of workflow.nodes ?? []) { if (String(n.type).endsWith('stickyNote')) continue; walk(n.parameters ?? {}); for (const t of tokens(n.name)) vocab.add(t); }
  return vocab;
}
/** Facts: tokens not written in the definition, plus every e-mail address and URL (a literal address in a message still matters). */
export function factsOf(text, vocab) { return [...new Set(tokens(text).filter(t => !vocab.has(t) || /@|^https?:/.test(t)))]; }

// ---------------------------------------------------------------------------------------------------- canonical forms
/** From n8n-sim's raw effects (+ final sheets of the sheets either side may write). */
export function canonFromSim(result, { sheets = [] } = {}) {
  const c = { ok: !!result.ok, error: result.ok ? null : String(result.error?.message ?? 'error').slice(0, 300), mail: [], chat: [], respond: [], sheets: {} };
  for (const e of result.effects ?? []) {
    if (e.kind === 'mail') for (const to of [...(e.to ?? []), ...(e.cc ?? []), ...(e.bcc ?? [])]) c.mail.push({ to: String(to).toLowerCase(), subject: String(e.subject ?? ''), body: String(e.body ?? '') });
    else if (e.kind === 'chat') c.chat.push({ channel: String(e.channel).toLowerCase(), text: String(e.text ?? '') });
    else if (e.kind === 'respond') c.respond.push({ code: Number(e.code ?? 200), body: e.body ?? null });
  }
  for (const name of sheets) if (result.sheets?.[name]) c.sheets[name] = result.sheets[name].rows ?? result.sheets[name];
  return c;
}
/** From a Foundry run in a CI-1 world (experiments/ci1/foundry-world.mjs). */
export function canonFromFoundry(r, { sheets = [] } = {}) {
  const c = { ok: r.status === 'succeeded', error: r.status === 'succeeded' ? null : `${r.status}${r.error ? `: ${r.error.code ?? ''} ${String(r.error.message ?? '').slice(0, 200)}` : ''}`, mail: [], chat: [], respond: [], sheets: {} };
  for (const m of r.effects?.outbox ?? []) c.mail.push({ to: String(m.to).toLowerCase(), subject: String(m.subject ?? ''), body: String(m.body ?? '') });
  for (const [channel, texts] of Object.entries(r.effects?.chat ?? {})) for (const t of texts) c.chat.push({ channel: channel.toLowerCase(), text: String(t) });
  for (const x of r.effects?.replies ?? []) c.respond.push({ code: Number(x.status ?? 200), body: x.body ?? null });
  for (const name of sheets) if (r.world?.sheets?.[name]) c.sheets[name] = r.world.sheets[name];
  return c;
}

// ---------------------------------------------------------------------------------------------------- cell and JSON normalisation
export function normCell(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6);
  if (isObj(v) || Array.isArray(v)) return JSON.stringify(v);
  const s = String(v).trim();
  if (/^(true|false)$/i.test(s)) return s.toLowerCase();
  const n = normNumber(s); if (n !== null) return n;
  const d = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (d) { if (!d[2]) return d[1]; const t = Date.parse(s.replace(' ', 'T') + (d[5] ? '' : 'Z')); return Number.isFinite(t) ? new Date(Math.floor(t / 60000) * 60000).toISOString().slice(0, 16) : s; }
  return s.replace(/\s+/g, ' ');
}
export function normJson(v) {
  if (Array.isArray(v)) return v.map(normJson);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, normJson(v[k])]));
  return normCell(v);
}

// ---------------------------------------------------------------------------------------------------- equivalence
/**
 * decl: { vocab: string[] (static vocabulary), rows: [[identity tokens of one world row]...] (for leak checks),
 *         mask: { sheet: { column: 'any' | 'nonempty' } }, freeText: { sheet: [column] }, respondCode: boolean }
 * Returns { pass, reasons }.
 */
export function equivalent(ref, cand, decl = {}) {
  const vocab = decl.vocab instanceof Set ? decl.vocab : new Set(decl.vocab ?? []);
  const reasons = [];
  if (!cand) return { pass: false, reasons: ['no candidate run'] };
  if (ref.ok && !cand.ok) reasons.push(`the built workflow did not finish: ${cand.error ?? 'failed'}`);
  if (!ref.ok && cand.ok) reasons.push('the reference stopped with an error here and the built workflow did not');
  const rowsMentioned = text => { const tk = new Set(tokens(text)); return (decl.rows ?? []).map((ids, i) => ids.some(t => tk.has(t)) ? i : -1).filter(i => i >= 0); };
  const matchGroup = (kind, keyOf, textOf, refList, candList) => {
    const groups = new Map();
    for (const m of refList) { const k = keyOf(m); if (!groups.has(k)) groups.set(k, { ref: [], cand: [] }); groups.get(k).ref.push(m); }
    for (const m of candList) { const k = keyOf(m); if (!groups.has(k)) groups.set(k, { ref: [], cand: [] }); groups.get(k).cand.push(m); }
    for (const [k, g] of groups) {
      if (g.ref.length !== g.cand.length) { reasons.push(`${kind} to ${k}: ${g.cand.length} sent, expected ${g.ref.length}`); continue; }
      // greedy matching, most-constrained reference message first
      const refs = g.ref.map(m => ({ m, facts: factsOf(textOf(m), vocab), rows: new Set(rowsMentioned(textOf(m))) })).sort((a, b) => b.facts.length - a.facts.length);
      const free = g.cand.map(m => ({ m, tk: new Set(tokens(textOf(m))), rows: rowsMentioned(textOf(m)) }));
      for (const r of refs) {
        const i = free.findIndex(c => r.facts.every(f => c.tk.has(f)) && c.rows.every(x => r.rows.has(x)));
        if (i >= 0) { free.splice(i, 1); continue; }
        const best = free.map(c => ({ c, miss: r.facts.filter(f => !c.tk.has(f)), leak: c.rows.filter(x => !r.rows.has(x)) })).sort((a, b) => a.miss.length + a.leak.length - b.miss.length - b.leak.length)[0];
        reasons.push(`${kind} to ${k}: no message carries ${best?.miss.length ? `the facts [${best.miss.slice(0, 6).join(', ')}]` : ''}${best?.miss.length && best?.leak.length ? ' and ' : ''}${best?.leak.length ? `only the right rows (it mentions ${best.leak.length} row(s) the reference leaves out)` : ''}`);
        if (best) free.splice(free.indexOf(best.c), 1);
      }
    }
  };
  matchGroup('e-mail', m => m.to, m => `${m.subject}\n${m.body}`, ref.mail ?? [], cand.mail ?? []);
  matchGroup('chat', m => m.channel, m => m.text, ref.chat ?? [], cand.chat ?? []);
  // responses
  const rr = ref.respond ?? [], cr = cand.respond ?? [];
  if (rr.length !== cr.length) reasons.push(`responses: ${cr.length}, expected ${rr.length}`);
  else rr.forEach((r, i) => {
    const c = cr[i];
    if (decl.respondCode && Number(r.code) !== Number(c.code)) reasons.push(`response ${i + 1}: status ${c.code}, expected ${r.code}`);
    if (isObj(r.body) || Array.isArray(r.body)) { const why = jsonDiff(r.body, typeof c.body === 'string' ? tryJson(c.body) : c.body, vocab); if (why) reasons.push(`response ${i + 1}: ${why}`); }
    else { const tk = new Set(tokens(typeof c.body === 'string' ? c.body : JSON.stringify(c.body))); const miss = factsOf(String(r.body ?? ''), vocab).filter(f => !tk.has(f)); if (miss.length) reasons.push(`response ${i + 1}: missing facts [${miss.slice(0, 6).join(', ')}]`); }
  });
  // sheets
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
      if (free.has(col)) { const tk = new Set(tokens(cv)); return factsOf(String(rv ?? ''), vocab).every(f => tk.has(f)); }
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
const tryJson = s => { try { return JSON.parse(s); } catch { return s; } };
/** JSON body comparison: same keys and array lengths; prose leaves (text with spaces, > 20 chars) by facts; other leaves exactly. */
export function jsonDiff(r, c, vocab, at = 'body') {
  if (Array.isArray(r)) { if (!Array.isArray(c)) return `${at} is not a list`; if (r.length !== c.length) return `${at} has ${c.length} entries, expected ${r.length}`; for (let i = 0; i < r.length; i++) { const d = jsonDiff(r[i], c[i], vocab, `${at}[${i}]`); if (d) return d; } return null; }
  if (isObj(r)) {
    if (!isObj(c)) return `${at} is not an object`;
    const rk = Object.keys(r).filter(k => r[k] !== undefined).sort(), ck = Object.keys(c).filter(k => c[k] !== undefined).sort();
    if (JSON.stringify(rk) !== JSON.stringify(ck)) return `${at} keys [${ck.join(', ')}], expected [${rk.join(', ')}]`;
    for (const k of rk) { const d = jsonDiff(r[k], c[k], vocab, `${at}.${k}`); if (d) return d; }
    return null;
  }
  if (typeof r === 'string' && /\s/.test(r.trim()) && r.length > 20) { const tk = new Set(tokens(typeof c === 'string' ? c : JSON.stringify(c))); const miss = factsOf(r, vocab).filter(f => !tk.has(f)); return miss.length ? `${at} misses [${miss.slice(0, 5).join(', ')}]` : null; }
  return normCell(r) === normCell(c) ? null : `${at} is ${JSON.stringify(c)?.slice(0, 60)}, expected ${JSON.stringify(r)?.slice(0, 60)}`;
}

/** Identity tokens per world row: tokens of the row's text cells that occur in no other row and are not static (leak detection). */
export function rowIdentities(world, vocab) {
  const rows = [];
  const add = obj => { if (isObj(obj)) rows.push(Object.values(obj).filter(v => typeof v === 'string' || typeof v === 'number').flatMap(v => tokens(String(v)))); };
  for (const s of Object.values(world.sheets ?? {})) for (const r of (s.rows ?? s)) add(r);
  const ev = world.event; const evRows = Array.isArray(ev) ? ev : Array.isArray(ev?.body) ? ev.body : null;
  if (evRows) evRows.forEach(add);
  for (const [k, v] of Object.entries(ev?.body ?? {})) if (Array.isArray(v)) v.forEach(add); void 0;
  const count = new Map(); for (const r of rows) for (const t of new Set(r)) count.set(t, (count.get(t) ?? 0) + 1);
  return rows.map(r => [...new Set(r)].filter(t => count.get(t) === 1 && !vocab.has(t) && !/^D:|^-?\d+(\.\d+)?$/.test(t) && t.length >= 3)).filter(ids => ids.length);
}
