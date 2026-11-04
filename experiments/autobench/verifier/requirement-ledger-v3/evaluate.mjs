// requirement-ledger-v3 (Δ* v1): evaluate Δ*'s assertions on one candidate (its initial world, diff and final world).
//
// Member keys are stable across prepares of the same task (sheet rows by spreadsheet, worksheet and row number; other
// records by app, collection and id), so one Δ* serves every arm's world. Each check runs through check.mjs (v2's
// grammar plus the Δ* types); a check whose record cannot be found in this candidate's world is undecided (null), never a
// pass. Generic by construction (PREREG-AB-v1 H7/H8).
import { effectsOf, evaluateCheck } from './check.mjs';
import { isObj } from './lib.mjs';

export const EVALUATE_VERSION = 'rl3-evaluate-v1';
const singular = s => String(s ?? '').toLowerCase().replace(/ies$/, 'y').replace(/s$/, '');

/** A pointer mapper for one world: stable member key -> {app, coll, id} of that world's record, or null. */
export function worldMapper(world) {
  const cache = new Map();
  return key => {
    if (cache.has(key)) return cache.get(key);
    let out = null;
    const s = String(key ?? '');
    const row = /^google_sheets:row:([^/]+)\/([^#]+)#(\d+)$/.exec(s);
    if (row) {
      const r = (world?.google_sheets?.rows ?? []).find(x => isObj(x) && String(x.spreadsheet_id) === row[1] && String(x.worksheet_id) === row[2] && Number(x.row_id) === Number(row[3]));
      if (r) out = { app: 'google_sheets', coll: 'rows', id: String(r.id ?? r.row_id) };
    } else {
      const m = /^([a-z0-9_]+)[.:]([A-Za-z0-9_]+)[:/](.+)$/.exec(s);
      if (m) {
        const app = m[1], kind = m[2], id = m[3];
        const colls = Object.entries(world?.[app] ?? {}).filter(([, v]) => Array.isArray(v));
        const pick = colls.filter(([c]) => singular(c) === singular(kind) || singular(c).startsWith(singular(kind)) || singular(kind).startsWith(singular(c)));
        for (const [c, list] of [...pick, ...colls.filter(x => !pick.includes(x))]) {
          const r = list.find(x => isObj(x) && String(x.id ?? x.row_id ?? x.ts ?? x.uuid) === id);
          if (r) { out = { app, coll: c, id }; break; }
        }
      }
    }
    cache.set(key, out);
    return out;
  };
}

/** Evaluate every assertion of Δ* (or a subset) on one candidate. -> [{id, key, type, polarity, hard, origin, pass, evidence}] */
export function evaluateDstar(dstar, { diff, world0, final, assertions = dstar.assertions }) {
  const eff = effectsOf(diff, world0);
  const ctx = { mapPtr: worldMapper(world0), final };
  return assertions.map(a => {
    let r;
    try { r = evaluateCheck(a.check, eff, ctx); } catch (e) { r = { pass: null, evidence: `error: ${String(e?.message ?? e).slice(0, 120)}` }; }
    return { id: a.id, key: a.check.key, type: a.check.type, polarity: a.polarity, hard: a.status === 'hard', origin: a.origin ?? null, group: a.group, member: a.member, label: a.label, pass: r.pass, evidence: r.evidence };
  });
}
