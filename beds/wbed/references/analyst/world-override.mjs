// Analyst-side judge answers for the R1 reference from the generator world (world-readings.mjs r1Readings), served
// through flow-v3's override hook (tools/flow-override.mjs, harness only) by validate.mjs --policies world. Runs in the
// sandbox and reads only ./flow-override.json. Like author/author-override.mjs it measures the code given correct
// readings, not any model: each judge gets the world's answer at $0, with its quote taken from the first sentence of the
// request's first fenced block. A judge it cannot answer fails (visible as a judge failure, never answered silently).
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('./flow-override.json', import.meta.url), 'utf8')).world ?? {};
const WS = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const firstSentence = block => WS(block).split(/(?<=[.!?])\s+(?=[A-Z"“(　-鿿])/).find(s => s.length >= 8) ?? '';
const blockOf = request => /<<<\n([\s\S]*?)\n>>>/.exec(String(request.prompt ?? ''))?.[1] ?? '';
const withQuote = (request, value) => (request.schema?.properties?.quote ? { ...value, quote: firstSentence(blockOf(request)) } : value);

// Place text -> ISO code. Exact alias first (case-folded, a leading "the" dropped); else, for a longer line (a whole
// entry), a demonym, then a city or country name, found as a whole word; one country or UNKNOWN.
const fold = s => WS(s).normalize('NFC').toLowerCase().replace(/^the\s+/, '').replace(/[.,;:]+$/, '').trim();
const exact = new Map();
for (const [alias, iso] of data.places ?? []) { const k = fold(alias); if (!exact.has(k)) exact.set(k, new Set()); exact.get(k).add(iso); }
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordIn = (alias, line) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(fold(alias))}(?![\\p{L}\\p{N}])`, 'u').test(fold(line));
function countryOfPlace(line) {
  const hit = exact.get(fold(line));
  if (hit && hit.size === 1) return [...hit][0];
  const long = (data.places ?? []).filter(([a, , kind]) => kind !== 'code' && a.length >= 3);
  for (const pass of [([, , kind]) => kind === 'demonym', () => true]) {
    const isos = new Set(long.filter(pass).filter(([a]) => wordIn(a, line)).map(([, iso]) => iso));
    if (isos.size === 1) return [...isos][0];
    if (isos.size > 1) return 'UNKNOWN';
  }
  return 'UNKNOWN';
}

export default function override(callSite, request) {
  const name = callSite.name;
  let m;
  if ((m = /^dob-order(?:-second)?:(.+)$/.exec(name))) {
    const v = data.dob?.[m[1]];
    return v ? { value: withQuote(request, v) } : { error: `world readings have no birth-date order for ${m[1]}` };
  }
  if ((m = /^date-order:(.+)$/.exec(name))) {
    const v = data.dateOrder?.[m[1]];
    return v ? { value: withQuote(request, v) } : { error: `world readings have no invoice-date order for ${m[1]}` };
  }
  if ((m = /^marker(?:-tiebreak)?:([A-Z]+):(.+)$/.exec(name))) {
    const [, system, value] = m;
    const options = request.schema?.properties?.meaning?.enum ?? [];
    if (options.includes('VOID')) {
      const hits = (data.rowMarkers ?? []).filter(f => f.system === system && value.toLowerCase().includes(f.token.toLowerCase()));
      return hits.length === 1 ? { value: withQuote(request, { meaning: hits[0].meaning }) } : { error: `world readings: ${hits.length} row markers of ${system} match "${value}"` };
    }
    if (options.includes('COUNTS')) {
      const v = value.replace(/\.$/, '').trim().toLowerCase();
      const hits = (data.invoiceStatuses ?? []).filter(f => f.system === system && f.word.toLowerCase() === v);
      return hits.length === 1 ? { value: withQuote(request, { meaning: hits[0].meaning }) } : { error: `world readings: ${hits.length} invoice statuses of ${system} match "${value}"` };
    }
    return { error: `world readings: unknown marker question ${name}` };
  }
  if (name === 'place-country') {
    const lines = blockOf(request).split('\n').map(WS).filter(Boolean);
    return { value: { countries: lines.map(countryOfPlace) } };
  }
  return { error: `world readings do not answer ${name}` };
}
