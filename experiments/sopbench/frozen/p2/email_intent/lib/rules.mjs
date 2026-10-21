// Plain-code rules of the email_intent SOP: product id extraction (5.1) and the seller price read for the pricing branch
// (5.2(b)). No flow or tool calls here.

export const PRODUCT_ID = /^P[A-Z0-9]{5}$/;
const CANDIDATE = /(?<![A-Za-z0-9_])P[A-Za-z0-9]{5}(?![A-Za-z0-9_])/gi;

// Every product_id-shaped token in the text, upper-cased, in order of appearance, without repeats.
export function extractProductIds(text) {
  const ids = new Set();
  for (const m of String(text ?? '').matchAll(CANDIDATE)) {
    const id = m[0].toUpperCase();
    if (PRODUCT_ID.test(id)) ids.add(id);
  }
  return [...ids];
}

// Dollar amounts: "$299.99", "$1,299", "299.99 USD", "299 dollars".
const AMOUNT = /\$\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)|\b((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s?(?:usd|dollars?)\b/gi;
// Words that, just before an amount, mark it as the price the listing shows now (not the one the seller asks for).
const CURRENT_CUE = new Set(['was', 'currently', 'current', 'now', 'is', 'are', 'listed', 'listing', 'shows', 'showing',
  'shown', 'displayed', 'displays', 'instead', 'rather', 'not', 'from', 'previously', 'old', 'present']);
// Words that, just before an amount, mark it as the price the seller wants.
const TARGET_CUE = new Set(['should', 'must', 'needs', 'need', 'supposed', 'to', 'be', 'change', 'changed', 'update',
  'updated', 'correct', 'corrected', 'set', 'lower', 'lowered', 'reduce', 'reduced', 'raise', 'raised', 'increase', 'increased']);

// A bare number (no $ or USD): kept only with a decimal part or right after a target cue, so counts and ids are not read as prices.
const BARE = /(?<![\w$.,])(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?(?!\w)/g;
const PRICE_WORD = /\b(price|prices|pricing|priced|cost|costs|usd|dollars?)\b/i;

// The amounts of the text that keep(match, wordsBefore) accepts, each with the last three words before it (since the previous amount).
function priceCandidates(body, re, keep) {
  const out = [];
  let prev = 0;
  for (const m of body.matchAll(re)) {
    const before = (body.slice(prev, m.index).toLowerCase().match(/[a-z]+/g) ?? []).slice(-3);
    prev = m.index + m[0].length;
    if (keep(m, before)) out.push({ value: Number(m[0].replace(/[^\d.]/g, '')), before });
  }
  return out;
}

// The price the seller specifies, or null when the email names none (or only the price the listing shows now).
// Each amount is read against the words between the previous amount and itself, so "from $319.99 to $299.99" keeps both apart.
export function extractSellerPrice(text) {
  const body = String(text ?? '');
  let amounts = priceCandidates(body, AMOUNT, () => true);
  if (amounts.length === 0 && PRICE_WORD.test(body)) amounts = priceCandidates(body, BARE, (m, before) => m[2] || before.some(w => TARGET_CUE.has(w)));
  if (amounts.length === 0) return null;
  if (amounts.length === 1) return amounts[0].value;
  const target = amounts.filter(a => a.before.some(w => TARGET_CUE.has(w)) && !a.before.some(w => CURRENT_CUE.has(w)));
  if (target.length) return target.at(-1).value;
  const open = amounts.filter(a => !a.before.some(w => CURRENT_CUE.has(w)));
  return open.length ? open.at(-1).value : null;
}

// Price comparison in cents, so 299.99 and 299.990 compare equal and floats do not leak in.
export function priceDeltaCents(sellerPrice, listedPrice) {
  return Math.round(sellerPrice * 100) - Math.round(listedPrice * 100);
}
