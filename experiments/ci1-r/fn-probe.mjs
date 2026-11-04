#!/usr/bin/env node
// Oracle false-negative probe (CI-1 review finding 2): a $0 gate to run at bed freeze time. For every hidden world of every item, the
// REFERENCE's own effects are rewritten in ways a correct builder may legitimately differ (greeting the addressee by name, a legend of
// a category's values, day/month/year dates, a comma after a number, a list written as prose, an e-mail address in a sheet cell in
// another letter case, a courtesy line) and the rewrite is judged against the unmodified reference by the oracle under test. A valid
// effect oracle passes every rewrite; each failure is either an oracle defect or a place where the description makes the format
// binding (the item is then read against its description). One more rewrite (mention a value of a one-row settings sheet) is reported
// separately: it can be legitimately strict. The probe is two-sided: MUST_FAIL mutations of the same reference effects (a dropped
// message, a wrong recipient, a changed number fact, every row dumped into each message, a changed sheet cell) must still fail, so an
// oracle cannot pass the probe by accepting everything.
//
// Retrospective use here: would this probe, run before each freeze, have flagged the oracle defect classes that root-causing found
// after the runs (wave 1 under v1: greeting, category word, d/m/y, number + comma; wave 2 under v2: address case, settings row)?
//   node experiments/ci1-r/fn-probe.mjs [--out research/ci1-20261021/r/fn-probe.json]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { equivalent, rowIdentities, normNumber } from '../ci1/canon.mjs';
import { equivalentV2, rowIdentitiesWithAddresses, categoricalColumns, POSTHOC_DECL, factsV2 } from '../ci1-posthoc/oracle-v2.mjs';
import { equivalentV3, rowsV3 } from './oracle-v3.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const WORK = '/var/tmp/foundry-work/ci1-20261021';
const clone = x => JSON.parse(JSON.stringify(x));
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const ADDRESS = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/;
const rowsOf = world => Object.entries(world.sheets ?? {}).flatMap(([name, s]) => (s.rows ?? s).map(r => ({ sheet: name, row: r })));

/** The first name of the world row that holds this address (a column whose name says "name"), or null. */
export function nameFor(world, address) {
  const hit = rowsOf(world).find(({ row }) => Object.values(row).some(v => String(v ?? '').trim().toLowerCase() === address));
  if (!hit) return null;
  const cols = Object.keys(hit.row).filter(k => /name/i.test(k) && !/sheet|file|product|item|company|business/i.test(k) && String(hit.row[k] ?? '').trim());
  const col = cols.find(k => /first/i.test(k)) ?? cols[0];
  return col ? String(hit.row[col]).trim().split(/\s+/)[0] : null;
}
const mapTexts = (c, f) => { for (const m of c.mail ?? []) m.body = f(m.body, m); for (const m of c.chat ?? []) m.text = f(m.text, m); return c; };

/** Rewrites of a reference canon (each returns a new canon, or null when it does not apply to this world). */
export const REWRITES = Object.freeze({
  'greet-by-name': (ref, world) => { const c = clone(ref); let n = 0; for (const m of c.mail ?? []) { const name = nameFor(world, m.to); if (name) { m.body = `Hi ${name},\n${m.body}`; n++; } } return n ? c : null; },
  'category-legend': (ref, world, decl) => {
    const cat = [...(decl.categorical ?? [])]; if (!cat.length || !(ref.mail?.length || ref.chat?.length)) return null;
    const values = [...new Set(cat.flatMap(k => { const [sheet, col] = k.split('|'); return ((world.sheets?.[sheet]?.rows ?? world.sheets?.[sheet]) ?? []).map(r => String(r[col] ?? '').trim()).filter(v => v && !/^-?\d/.test(v)); }))];
    if (!values.length) return null;
    return mapTexts(clone(ref), t => `${t}\n(Possible states: ${values.slice(0, 8).join(', ')}.)`);
  },
  'dmy-dates': ref => { const c = clone(ref); let n = 0; mapTexts(c, t => String(t).replace(/\b(\d{4})-(\d{2})-(\d{2})\b(?![T:\d])/g, (_, y, m, d) => { n++; return `${d}/${m}/${y}`; })); return n ? c : null; },
  'number-comma': ref => { const c = clone(ref); let n = 0; mapTexts(c, t => String(t).replace(/(\d)( +)(?=[A-Za-z(])(?!(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b)/gi, (_, d, s) => { n++; return `${d},${s}`; })); return n ? c : null; },
  'list-to-prose': ref => { const c = clone(ref); let n = 0; mapTexts(c, t => { const lines = String(t).split('\n'); if (lines.filter(l => /^\s*([-*•]|\d+[.)])\s+/.test(l)).length < 2) return t; n++; return lines.map(l => l.replace(/^\s*([-*•]|\d+[.)])\s+/, '')).filter(Boolean).join('; '); }); return n ? c : null; },
  'address-case-cells': ref => {
    const c = clone(ref); let n = 0;
    const up = v => { if (typeof v === 'string' && ADDRESS.test(v.trim())) { n++; return v.toUpperCase(); } return v; };
    for (const rows of Object.values(c.sheets ?? {})) for (const r of rows) for (const k of Object.keys(r)) r[k] = up(r[k]);
    const deep = v => (Array.isArray(v) ? v.map(deep) : isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : up(v));
    c.respond = (c.respond ?? []).map(x => ({ ...x, body: deep(x.body) }));
    return n ? c : null;
  },
  'courtesy-line': ref => ((ref.mail?.length || ref.chat?.length) ? mapTexts(clone(ref), t => `${t}\nThank you, and have a good day.`) : null),
});
export const STRICT_MAYBE = Object.freeze({
  'settings-mention': (ref, world) => {
    const single = Object.entries(world.sheets ?? {}).filter(([, s]) => (s.rows ?? s).length === 1);
    if (!single.length || !ref.mail?.length) return null;
    const vals = single.flatMap(([, s]) => Object.values((s.rows ?? s)[0]).map(v => String(v ?? '').trim()).filter(v => v && v.length >= 3));
    return vals.length ? mapTexts(clone(ref), t => `${t}\n(Contact: ${vals.slice(0, 4).join(', ')})`) : null;
  },
});

const firstMessage = c => (c.mail?.length ? { list: c.mail, key: 'body', i: 0 } : c.chat?.length ? { list: c.chat, key: 'text', i: 0 } : null);
/** Mutations of a reference canon that change what the recipient is told or what is written: a valid oracle must FAIL each one. */
export const MUST_FAIL = Object.freeze({
  'drop-message': ref => { if (!(ref.mail?.length || ref.chat?.length)) return null; const c = clone(ref); if (c.mail.length) c.mail.shift(); else c.chat.shift(); return c; },
  'wrong-recipient': ref => { if (!ref.mail?.length) return null; const c = clone(ref); c.mail[0].to = 'someone.else@elsewhere.example'; return c; },
  'wrong-number': (ref, world, ctx) => {
    const c = clone(ref), m = firstMessage(c); if (!m) return null;
    const msg = m.list[m.i], whole = `${msg.subject ? `${msg.subject}\n` : ''}${msg[m.key]}`;
    const facts = new Set(factsV2(whole, ctx.vocab).filter(f => /^-?\d+(\.\d+)?$/.test(f) && Math.abs(Number(f)) >= 2));
    // the first numeric fact, changed EVERYWHERE it is written in this message (subject and body), so no copy of it survives
    const lit0 = [...whole.matchAll(/\$?\d[\d,]*(\.\d+)?/g)].map(x => x[0]).find(lit => facts.has(normNumber(lit.replace(/,$/, ''))));
    if (!lit0) return null;
    const target = normNumber(lit0.replace(/,$/, ''));
    const change = t => String(t).replace(/\$?\d[\d,]*(\.\d+)?/g, lit => (normNumber(lit.replace(/,$/, '')) === target ? String(Number(target) + 7) : lit));
    msg[m.key] = change(msg[m.key]); if (msg.subject) msg.subject = change(msg.subject);
    return c;
  },
  'dump-rows': (ref, world, ctx) => {
    const data = Object.entries(world.sheets ?? {}).filter(([k]) => !ctx.settings.includes(k)).flatMap(([, s]) => s.rows ?? s);
    if (data.length < 2 || !(ref.mail?.length || ref.chat?.length)) return null;
    const dump = data.map(r => Object.values(r).filter(v => typeof v === 'string' && v.trim()).join(' ')).join(' | ');
    return mapTexts(clone(ref), t => `${t}\nAll records: ${dump}`);
  },
  'change-sheet-cell': (ref, world, ctx) => {
    for (const [name, rows] of Object.entries(ref.sheets ?? {})) for (const r of rows) for (const [k, v] of Object.entries(r)) {
      if (k === 'row_number' || ctx.mask?.[name]?.[k] || (ctx.freeText?.[name] ?? []).includes(k) || v === '' || v === null || v === undefined) continue;
      const c = clone(ref), row = c.sheets[name][rows.indexOf(r)];
      row[k] = typeof v === 'number' ? v + 7 : `${v}x`; return c;
    }
    return null;
  },
});

/** The three oracles under test, as (ref, cand, world) -> {pass, reasons}, for one item's frozen oracle. */
export function oraclesFor(o, id) {
  const vocab = new Set(o.decl.vocab);
  const categorical = new Set(o.decl.categorical ?? [...categoricalColumns([...o.hidden.map(h => h.world), o.public.world])]);
  const optional = o.decl.optional && Object.keys(o.decl.optional).length ? o.decl.optional : (POSTHOC_DECL[id]?.optional ?? {});
  const settings = o.decl.settings ?? []; // declared at freeze (none in the CI-1 oracles)
  const d1 = w => ({ vocab, rows: rowIdentities(w, vocab), mask: o.decl.mask, freeText: o.decl.freeText, respondCode: o.decl.respondCode });
  const d2 = w => ({ ...d1(w), rowsWithAddresses: rowIdentitiesWithAddresses(w, vocab, categorical), optional });
  const d3 = w => ({ ...d2(w), rowsWithAddresses: rowsV3(w, vocab, categorical, settings) });
  return { categorical, settings, vocab, mask: o.decl.mask, freeText: o.decl.freeText,
    v1: (r, c, w) => equivalent(r, c, d1(w)), v2: (r, c, w) => equivalentV2(r, c, d2(w)), v3: (r, c, w) => equivalentV3(r, c, d3(w)) };
}

export function probeItem(o, id, rewrites = { ...REWRITES, ...STRICT_MAYBE }, mustFail = MUST_FAIL) {
  const or = oraclesFor(o, id), out = [];
  for (const h of o.hidden) {
    // sanity: every oracle passes the unmodified reference
    for (const v of ['v1', 'v2', 'v3']) if (!or[v](h.reference, clone(h.reference), h.world).pass) out.push({ world: h.world.id, rewrite: 'identity', oracle: v, pass: false, reasons: ['the reference fails itself'] });
    for (const [name, f] of Object.entries(rewrites)) {
      const cand = f(h.reference, h.world, { categorical: or.categorical });
      if (!cand) continue;
      for (const v of ['v1', 'v2', 'v3']) { const j = or[v](h.reference, cand, h.world); out.push({ world: h.world.id, rewrite: name, oracle: v, pass: j.pass, reasons: j.reasons.slice(0, 2).map(x => x.slice(0, 200)) }); }
    }
    for (const [name, f] of Object.entries(mustFail)) {
      const cand = f(h.reference, h.world, or);
      if (!cand) continue;
      for (const v of ['v1', 'v2', 'v3']) { const j = or[v](h.reference, cand, h.world); out.push({ world: h.world.id, mutation: name, oracle: v, caught: !j.pass }); }
    }
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values: a } = parseArgs({ options: { out: { type: 'string' } } });
  const waves = [
    { wave: 1, bed: path.join(WORK, 'bed'), ids: JSON.parse(readFileSync(path.join(root, 'research/ci1-20261021/SPLIT.json'), 'utf8')).test },
    { wave: 2, bed: path.join(WORK, 'bed-w2'), ids: JSON.parse(readFileSync(path.join(root, 'research/ci1-20261021/w2/SPLIT-W2.json'), 'utf8')).test }];
  const rows = [];
  for (const w of waves) for (const id of w.ids) {
    const f = path.join(w.bed, 'oracle', `${id}.json`); if (!existsSync(f)) throw new Error(`no oracle for ${id}: the bed is local (${f})`);
    for (const r of probeItem(JSON.parse(readFileSync(f, 'utf8')), id)) rows.push({ wave: w.wave, item: id, ...r });
  }
  const names = ['identity', ...Object.keys(REWRITES), ...Object.keys(STRICT_MAYBE)];
  const table = {}, teeth = {};
  for (const wave of [1, 2]) for (const v of ['v1', 'v2', 'v3']) for (const n of Object.keys(MUST_FAIL)) {
    const sel = rows.filter(r => r.wave === wave && r.oracle === v && r.mutation === n);
    teeth[`w${wave}|${v}|${n}`] = { appliesTo: new Set(sel.map(r => r.item)).size, worlds: sel.length, caught: sel.filter(r => r.caught).length, missedItems: [...new Set(sel.filter(r => !r.caught).map(r => r.item))].sort() };
  }
  for (const wave of [1, 2]) for (const v of ['v1', 'v2', 'v3']) for (const n of names) {
    const sel = rows.filter(r => r.wave === wave && r.oracle === v && r.rewrite === n && !r.mutation);
    if (!sel.length && n !== 'identity') continue;
    table[`w${wave}|${v}|${n}`] = { appliesTo: new Set(sel.map(r => r.item)).size, worlds: sel.length, failingWorlds: sel.filter(r => !r.pass).length, failingItems: [...new Set(sel.filter(r => !r.pass).map(r => r.item))].sort() };
  }
  const out = { probe: 'ci1-r oracle false-negative probe ($0; reference effects rewritten, judged against the unmodified reference)', at: new Date().toISOString(),
    rewrites: names, strictMaybe: Object.keys(STRICT_MAYBE), mustFail: Object.keys(MUST_FAIL), table, teeth, failures: rows.filter(r => r.rewrite && !r.pass),
    missedMutations: rows.filter(r => r.mutation && !r.caught) };
  if (a.out) writeFileSync(a.out, `${JSON.stringify(out, null, 1)}\n`);
  for (const [k, v] of Object.entries(table)) if (v.failingWorlds || k.endsWith('identity')) console.log(`${k.padEnd(34)} applies ${String(v.appliesTo).padStart(2)} items / ${String(v.worlds).padStart(3)} worlds; fails ${v.failingWorlds} worlds on [${v.failingItems.join(', ')}]`);
  console.log('must fail (caught / worlds):');
  for (const [k, v] of Object.entries(teeth)) console.log(`${k.padEnd(34)} applies ${String(v.appliesTo).padStart(2)} items; caught ${v.caught}/${v.worlds}${v.missedItems.length ? `; missed on [${v.missedItems.join(', ')}]` : ''}`);
}
