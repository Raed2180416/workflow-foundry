// The home page's box without an AI key: match a person's words to the card list by keywords, locally, at $0. It returns candidates
// only; it never builds anything (research/onboarding-20261021/SPEC.md §3 R1). The words never leave this computer and are not stored.
//
// Scoring: a keyword or phrase from the card's list (app/onboarding/forms.json) that appears in the words scores 1 (a phrase of two or
// more words scores 2); a `weak` keyword (too common to name a card: "approval", "remind") scores a half. A card whose "not" phrase
// appears (for example "pay my suppliers" for invoice reminders, "refund" for expense claims) is dropped: the template's own notFor says
// it cannot do that. "This sounds like" needs a card clearly ahead AND at least one of its strong keywords: a match on weak words only
// is "these might be close", never a confident answer (P3 walkthrough B1).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FORMS = JSON.parse(readFileSync(path.join(here, 'forms.json'), 'utf8'));
const MAX_WORDS = 2000;

/** Lower case, straight apostrophes, letters/digits/apostrophes only, single spaces, padded so phrase matches respect word edges. */
export function normalise(text) {
  return ` ${String(text).slice(0, 4 * MAX_WORDS).toLowerCase().replace(/[‘’`´]/g, "'").replace(/[^a-z0-9'@#.-]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}
const stem = w => w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w;
function has(norm, phrase) {
  const p = normalise(phrase).trim();
  if (!p) return false;
  if (p.includes(' ')) return norm.includes(` ${p} `) || norm.includes(` ${p}s `);
  const tokens = norm.trim().split(' ');
  return tokens.some(t => t === p || stem(t) === stem(p));
}

/** Candidates for `text`, best first: [{ id, title, score, matched[] }]. Empty when nothing matches (the honest answer). */
export function suggest(text, { forms = FORMS } = {}) {
  if (typeof text !== 'string' || !text.trim()) return { candidates: [] };
  const norm = normalise(text);
  const candidates = [];
  for (const id of forms.order) {
    const f = forms.templates[id];
    if ((f.notKeywords ?? []).some(k => has(norm, k))) continue;
    const matched = [...new Set(f.keywords.filter(k => has(norm, k)))];
    // A longer phrase that matched makes its own words redundant ("late payment" and "payment").
    const kept = matched.filter(k => !matched.some(o => o !== k && o.includes(' ') && normalise(o).includes(` ${normalise(k).trim()} `)));
    const weak = new Set(f.weak ?? []);
    const score = kept.reduce((s, k) => s + (weak.has(k) ? 0.5 : k.trim().includes(' ') ? 2 : 1), 0);
    if (score > 0) candidates.push({ id, title: f.card, summary: f.summary, score, matched: kept, weakOnly: kept.every(k => weak.has(k)) });
  }
  candidates.sort((a, b) => b.score - a.score || forms.order.indexOf(a.id) - forms.order.indexOf(b.id));
  // "This sounds like" only when one card is clearly ahead on at least one strong word; otherwise the close ones and the full list.
  const top = candidates[0] ?? null, clear = !!top && !top.weakOnly && (!candidates[1] || top.score > candidates[1].score);
  return { candidates: candidates.slice(0, 3), best: clear ? top.id : null, weakOnly: !!top && top.weakOnly, method: 'keywords (no AI, on this computer)' };
}
