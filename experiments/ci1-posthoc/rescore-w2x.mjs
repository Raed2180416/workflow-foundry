#!/usr/bin/env node
// POST HOC wave-2 sensitivity ("w2x"): the frozen wave-2 verdicts (oracle v2, PREREG-CI1-W2) stay primary. Root-causing every wave-2
// failure (RESULT-CI1.md §9) found eight places where the frozen oracle or the description, not the builder, decided the verdict. Each
// is neutralised here by a declared transform applied to BOTH the reference's and the build's canonical effects (and, for one, to the
// world rows the leak check uses), with its reason. Every transform only removes a distinction, so a world that passed stays passed:
// only the failing hidden worlds of failing builds are rerun ($0). Writes research/ci1-20261021/runs/<label>/rescore-w2x.json.
//   CI1_BED=/var/tmp/foundry-work/ci1-20261021/bed-w2 node experiments/ci1-posthoc/rescore-w2x.mjs <w2 label...>
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BED, foundryCanon } from '../ci1/bed.mjs';
import { judge } from '../ci1-w2/bed2.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RUNS = process.env.CI1_RUNS ?? '/var/tmp/foundry-work/ci1-20261021/runs';
const SUMMARIES = path.join(here, '../../research/ci1-20261021/runs');
const clone = x => JSON.parse(JSON.stringify(x));
const mapCol = (c, sheet, col, f) => { for (const r of c.sheets?.[sheet] ?? []) if (col in r) r[col] = f(r[col], r); };
const mapRespond = (c, f) => { c.respond = (c.respond ?? []).map(r => ({ ...r, body: f(r.body) })); };
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Leak-check view of a world: words that occur in any categorical cell (decl.categorical, e.g. an Owner column) are removed from the
 *  other cells, so a name shared by a categorical value and another row's client name does not identify that row. */
export function withoutCategoricalWords(world, categorical) {
  const cat = new Set(categorical ?? []), words = new Set();
  for (const [sheet, s] of Object.entries(world.sheets ?? {})) for (const r of (s.rows ?? s)) for (const [k, v] of Object.entries(r)) if (cat.has(`${sheet}|${k}`)) for (const w of String(v ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (w.length >= 3) words.add(w);
  const strip = v => (typeof v === 'string' ? v.split(/(\s+)/).filter(t => !words.has(t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))).join('') : v);
  const sheets = Object.fromEntries(Object.entries(world.sheets ?? {}).map(([name, s]) => {
    const rows = (s.rows ?? s).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cat.has(`${name}|${k}`) ? v : strip(v)])));
    return [name, s.rows ? { ...s, rows } : rows];
  }));
  return { ...world, sheets };
}
/** Per item: { kind: 'oracle' | 'ambiguous', why, apply(canon) -> canon (both sides), world?(world, decl) -> world for row identities }. */
export const W2X = Object.freeze({
  '19187': [{ kind: 'ambiguous', why: 'Description: "Evaluation Date and Logged At (now)". Every build (6 of 6 before this audit) wrote a date for the column named Date; the reference writes the full date-time. Compared on the day.',
    apply: c => { mapCol(c, 'evaluation-log', 'Evaluation Date', v => String(v ?? '').slice(0, 10)); return c; } }],
  '17771': [
    { kind: 'oracle', why: 'An e-mail address logged in a sheet cell differs only in letter case (the reference logs the first line\'s raw casing, NOOR.FAIRHURST@...); addresses are case-insensitive and the oracle already lower-cases mail recipients.',
      apply: c => { mapCol(c, 'statement-log', 'customer_email', v => String(v ?? '').toLowerCase()); return c; } },
    { kind: 'ambiguous', why: 'The description says to greet a customer without a name by their e-mail and to log customer_name; whether the log takes the greeting fallback is not said. A blank logged name where the reference logs the e-mail is accepted.',
      apply: c => { mapCol(c, 'statement-log', 'customer_name', (v, r) => (String(v ?? '').trim() === '' || String(v).toLowerCase() === String(r.customer_email ?? '').toLowerCase() ? '<name-or-email>' : v)); return c; } }],
  '19014': [
    { kind: 'ambiguous', why: 'The duplicate answer\'s clientId: the description names "the existing client\'s Client ID" for the e-mail and only "clientId" for the answer; the reference answers with the newly computed ID, every build with the existing one.',
      apply: c => { mapRespond(c, b => (isObj(b) && b.duplicateFound === true ? { ...b, clientId: '<either>' } : b)); return c; } },
    { kind: 'oracle', why: 'Mentioning the project manager\'s address from the one-row settings sheet (onboarding-config) in the welcome e-mail counted as leaking a row the reference leaves out; a settings row is not a data row.',
      world: w => ({ ...w, sheets: Object.fromEntries(Object.entries(w.sheets ?? {}).filter(([k]) => k !== 'onboarding-config')) }) }],
  '17175': [{ kind: 'ambiguous', why: 'The description asks for the formula-injection apostrophe "in both sheets" and to answer "with the lead itself"; whether the answer carries the sheet-escaped values is not said. A leading apostrophe in answer fields is ignored.',
    apply: c => { mapRespond(c, b => (isObj(b) ? Object.fromEntries(Object.entries(b).map(([k, v]) => [k, typeof v === 'string' ? v.replace(/^'/, '') : v])) : b)); return c; } }],
  '18797': [{ kind: 'oracle', why: 'A build that names the invoice Owner (a categorical column, e.g. "Pavel Okonkwo") in the escalation e-mail was counted as mentioning another invoice whose client shares that first name ("Pavel Rothwell"). Words that occur in a categorical cell no longer identify other rows.',
    world: (w, decl) => withoutCategoricalWords(w, decl.categorical) }],
  '20090': [{ kind: 'oracle', why: 'The answer\'s message: for a reschedule the description leaves it unspecified, for a cancel it asks for the appointment\'s date and time; the reference message also carries the appointment ID (already its own field), which the oracle required as a fact. The reschedule message is free text; the ID is not required in the cancel message.',
    apply: c => { mapRespond(c, b => (!isObj(b) ? b : b.status === 'rescheduled' ? { ...b, message: '' }
      : b.status === 'cancelled' && typeof b.message === 'string' && b.appointment_id ? { ...b, message: b.message.split(String(b.appointment_id)).join(' ') } : b)); return c; } }],
});

export function transformed(item, ref, cand, world, decl = {}) {
  let r = clone(ref), c = clone(cand), w = world;
  for (const t of W2X[item] ?? []) { if (t.apply) { r = t.apply(r); c = t.apply(c); } if (t.world) w = t.world(w, decl); }
  return { r, c, w };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const label of process.argv.slice(2)) {
    const dir = path.join(RUNS, label, 'records'); if (!existsSync(dir)) { console.log(`${label}: no records`); continue; }
    const rows = [];
    for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
      const rec = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      if (rec.pass || rec.outcome !== 'ready' || !rec.workflow || !W2X[rec.item]) { rows.push({ item: rec.item, k: rec.k, v2: !!rec.pass, w2x: !!rec.pass, rerun: 0 }); continue; }
      const o = JSON.parse(readFileSync(path.join(BED, 'oracle', `${rec.item}.json`), 'utf8'));
      const worlds = [];
      for (const w of rec.worlds) {
        if (w.pass) { worlds.push({ id: w.id, w2x: true }); continue; }
        const h = o.hidden.find(x => x.world.id === w.id);
        let fc = await foundryCanon(rec.workflow, h.world), retries = 0;
        while (fc.run.error?.code === 'CODE_TIMEOUT' && retries < 2) { retries++; fc = await foundryCanon(rec.workflow, h.world); }
        const { r, c, w: world } = transformed(rec.item, h.reference, fc.canon, h.world, o.decl);
        const j = judge(r, c, o.decl, world);
        worlds.push({ id: w.id, w2x: j.v2.pass, reasons: j.v2.reasons.slice(0, 3).map(x => x.slice(0, 220)) });
      }
      rows.push({ item: rec.item, k: rec.k, v2: false, w2x: worlds.every(x => x.w2x), rerun: worlds.filter(x => x.reasons).length, worlds });
    }
    const out = { label, oracle: 'v2 + post hoc w2x transforms (experiments/ci1-posthoc/rescore-w2x.mjs)', decl: Object.fromEntries(Object.entries(W2X).map(([k, v]) => [k, v.map(t => ({ kind: t.kind, why: t.why }))])),
      builds: rows.length, v2Pass: rows.filter(r => r.v2).length, w2xPass: rows.filter(r => r.w2x).length, rows };
    writeFileSync(path.join(SUMMARIES, label, 'rescore-w2x.json'), `${JSON.stringify(out, null, 1)}\n`);
    console.log(`${label}: v2 ${out.v2Pass}/${rows.length}, w2x ${out.w2xPass}/${rows.length}`);
    for (const r of rows.filter(x => !x.w2x && x.worlds)) console.log(`  ${r.item} k${r.k} still fails: ${r.worlds.filter(w => !w.w2x).map(w => `${w.id}: ${w.reasons[0]}`).slice(0, 2).join(' | ').slice(0, 300)}`);
  }
}
