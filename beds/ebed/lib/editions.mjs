// Effective-dated rule editions (gap G18; BAR-SET §5: "edition chosen by anchor date, not run date"). Shared by rule
// tables, calendars and any other dated rulebook data.
//
// An edition is { id, effectiveFrom: 'YYYY-MM-DD', effectiveTo?: 'YYYY-MM-DD' | null, published?: ISO | null, ... }.
// It is in force for an anchor date d when effectiveFrom <= d < effectiveTo (effectiveTo exclusive; null or absent =
// open-ended). `published` is when the edition became known; resolving `asOf` an instant considers only editions with
// published <= asOf (a null `published` means known from the start). That is the whole convention: the item's spec-E
// states which business date is the anchor (invoice date, date of service, processing date, ...); this module never
// looks at the run date.
//
// Exactly one edition must be in force; none or several is EDITION_UNRESOLVED (never "the latest one").
import { fail } from './errors.mjs';
import { toDay, toMs, dateOf } from './time.mjs';

const span = e => {
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !e.id) fail('EDITION_INVALID', `edition needs a string id: ${JSON.stringify(e)}`);
  const from = toDay(e.effectiveFrom);
  const to = e.effectiveTo === undefined || e.effectiveTo === null ? Infinity : toDay(e.effectiveTo);
  if (!(from < to)) fail('EDITION_INVALID', `edition ${e.id}: effectiveFrom must be before effectiveTo`);
  return { from, to };
};

/** Static issues of an edition list: duplicate ids, overlaps (EDITION_UNRESOLVED) and gaps between editions (warning). */
export function checkEditions(editions) {
  const issues = [];
  const seen = new Set();
  const spans = editions.map(e => ({ e, ...span(e) }));
  for (const { e } of spans) {
    if (seen.has(e.id)) issues.push({ code: 'EDITION_INVALID', severity: 'error', detail: `duplicate edition id ${e.id}` });
    seen.add(e.id);
  }
  const sorted = [...spans].sort((a, b) => a.from - b.from || (a.e.id < b.e.id ? -1 : 1));
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (b.from < a.to) {
      issues.push({ code: 'EDITION_UNRESOLVED', severity: 'error', detail: `editions ${a.e.id} and ${b.e.id} overlap from ${dateOf(b.from)}`, editions: [a.e.id, b.e.id] });
    } else if (b.from > a.to) {
      issues.push({ code: 'EDITION_UNRESOLVED', severity: 'warning', detail: `no edition in force from ${dateOf(a.to)} to ${dateOf(b.from)}`, gap: { from: dateOf(a.to), to: dateOf(b.from) } });
    }
  }
  return issues;
}

/**
 * The edition in force on `anchor` (a date or day number), considering only editions published by `asOf` (ISO or ms)
 * when given. Throws EDITION_UNRESOLVED when none or more than one is in force.
 */
export function selectEdition(editions, anchor, { asOf } = {}) {
  if (!Array.isArray(editions)) fail('EDITION_INVALID', 'editions must be an array');
  const d = toDay(anchor);
  const known = asOf === undefined ? editions : editions.filter(e => e.published === undefined || e.published === null || toMs(e.published) <= toMs(asOf));
  const hits = known.filter(e => { const s = span(e); return s.from <= d && d < s.to; });
  if (hits.length !== 1) {
    fail('EDITION_UNRESOLVED', `${hits.length} editions in force on ${dateOf(d)}${asOf === undefined ? '' : ` as of ${asOf}`}`, { anchor: dateOf(d), editions: hits.map(e => e.id) });
  }
  return hits[0];
}
