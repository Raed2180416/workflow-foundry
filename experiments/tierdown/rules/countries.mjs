// Rule tier for the records country judges (records/countries, records/country-names): a closed alias lexicon of the
// bed's 18 countries plus a guarded edit-distance match for misspellings. Written by the frontier author (Claude Opus
// 5.5) from general knowledge and the calibration slice C only (PREREG-TIERDOWN.json). It never answers null and never
// guesses: a text it cannot place uniquely makes the whole call abstain, so the judge falls back to its reference tier.
const ALIASES = {
  US: ['United States', 'United States of America', 'USA', 'U.S.A.', 'US', 'U.S.', 'America', 'Vereinigte Staaten', 'Vereinigte Staaten von Amerika', 'Estados Unidos', 'Etats-Unis', 'États-Unis'],
  CA: ['Canada', 'Kanada', 'CAN'],
  GB: ['United Kingdom', 'UK', 'U.K.', 'GB', 'Great Britain', 'Britain', 'England', 'Scotland', 'Wales', 'Vereinigtes Königreich', 'Grossbritannien', 'Großbritannien', 'GBR', 'United Kingdom of Great Britain and Northern Ireland', 'Royaume-Uni'],
  IE: ['Ireland', 'Republic of Ireland', 'Eire', 'Éire', 'Irland', 'IRL'],
  AU: ['Australia', 'Australien', 'AUS', 'Commonwealth of Australia'],
  DE: ['Germany', 'Deutschland', 'DEU', 'GER', 'BRD', 'Federal Republic of Germany', 'Bundesrepublik Deutschland', 'Allemagne', 'Alemania'],
  AT: ['Austria', 'Österreich', 'Oesterreich', 'Osterreich', 'AUT', 'Republic of Austria', 'Republik Österreich', 'Autriche'],
  CH: ['Switzerland', 'Schweiz', 'Suisse', 'Svizzera', 'Swiss Confederation', 'CHE', 'Helvetia', 'Confoederatio Helvetica', 'Schweizerische Eidgenossenschaft'],
  FR: ['France', 'Frankreich', 'FRA', 'French Republic', 'République française', 'Republique francaise', 'Francia'],
  BE: ['Belgium', 'Belgien', 'Belgique', 'België', 'Belgie', 'BEL', 'Kingdom of Belgium', 'Belgica', 'Belgio'],
  ES: ['Spain', 'Spanien', 'España', 'Espana', 'ESP', 'Kingdom of Spain', 'Espagne', 'Spagna'],
  MX: ['Mexico', 'México', 'Mexiko', 'MEX', 'United Mexican States', 'Estados Unidos Mexicanos', 'Mexique'],
  IT: ['Italy', 'Italien', 'Italia', 'ITA', 'Italian Republic', 'Repubblica Italiana', 'Italie'],
  NL: ['Netherlands', 'The Netherlands', 'Nederland', 'Niederlande', 'Holland', 'NLD', 'Kingdom of the Netherlands', 'Pays-Bas'],
  JP: ['Japan', 'Nippon', 'Nihon', 'JPN', 'Japon', 'Giappone'],
  SE: ['Sweden', 'Schweden', 'Sverige', 'SWE', 'Kingdom of Sweden', 'Suede', 'Suède', 'Svezia'],
  DK: ['Denmark', 'Dänemark', 'Daenemark', 'Danmark', 'DNK', 'Kingdom of Denmark', 'Danemark'],
  NO: ['Norway', 'Norwegen', 'Norge', 'Noreg', 'NOR', 'Kingdom of Norway', 'Norvège', 'Norvege'],
};
// Two-letter texts are read as ISO codes only when they are one of these 18 (they are aliases above or here).
for (const iso of Object.keys(ALIASES)) ALIASES[iso].push(iso);

export const norm = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
const EXACT = new Map();
for (const [iso, list] of Object.entries(ALIASES)) for (const a of list) {
  const k = norm(a);
  if (EXACT.has(k) && EXACT.get(k) !== iso) throw new Error(`countries rule: alias ${a} maps to two codes`);
  EXACT.set(k, iso);
}

// Optimal string alignment distance (adjacent transpositions count 1).
export function osa(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

// The ISO code of one text, or null when it cannot be placed uniquely. Misspellings: distance 1 for 5-7 letters, 2 for
// 8+, against aliases of at least 5 letters, and the best code must beat every other code by at least 1.
export function isoOf(text) {
  const k = norm(text);
  if (!k) return null;
  if (EXACT.has(k)) return EXACT.get(k);
  if (k.length < 5) return null;
  const maxD = k.length >= 8 ? 2 : 1, best = new Map();
  for (const [alias, iso] of EXACT) {
    if (alias.length < 5) continue;
    const d = osa(k, alias);
    if (d < (best.get(iso) ?? Infinity)) best.set(iso, d);
  }
  const ranked = [...best].sort((a, b) => a[1] - b[1]);
  if (!ranked.length || ranked[0][1] > maxD) return null;
  if (ranked[1] && ranked[1][1] <= ranked[0][1]) return null;
  return ranked[0][0];
}

// records/countries: prompt "... TEXTS (JSON): [...]", schema {mapping: [{text, iso}]}.
export function countriesRule({ prompt, schema }) {
  if (!schema?.properties?.mapping) return { abstain: 'unexpected schema' };
  const m = /TEXTS \(JSON\):\s*(\[[\s\S]*\])\s*$/.exec(String(prompt));
  if (!m) return { abstain: 'no TEXTS list' };
  let texts;
  try { texts = JSON.parse(m[1]); } catch { return { abstain: 'TEXTS is not JSON' }; }
  // The known table must be the 18 countries this rule knows; another table is another task.
  const table = /Known table \(ISO name\):([^\n]*)/.exec(String(prompt))?.[1] ?? '';
  const isos = [...table.matchAll(/\b([A-Z]{2}) [A-Z]/g)].map(x => x[1]);
  if (!isos.length || isos.some(i => !ALIASES[i])) return { abstain: 'unknown country table' };
  const mapping = [];
  for (const t of texts) { const iso = isoOf(t); if (!iso || !isos.includes(iso)) return { abstain: `cannot place ${JSON.stringify(t)}` }; mapping.push({ text: t, iso }); }
  return { value: { mapping } };
}

// records/country-names, in the three prompt shapes the archived solvers use (C slice):
//   "Map each text to its country code, or null:\n- text"            -> {items: [{text, iso}]}
//   "Map each item to the country it names. ...\nITEMS:\n\"text\""  -> {mappings: [{raw, iso}]}
//   "Map each country string to its ISO alpha-2 code ...\n0. text"    -> {items: [{index, text, iso}]}
// Any other shape abstains; so does any text the lexicon cannot place, and any code outside the schema's enum.
export function countryNamesRule({ prompt, schema }) {
  const lines = String(prompt).split('\n'), head = lines[0] ?? '';
  const place = (texts, enumList) => {
    const out = [];
    for (const t of texts) {
      const iso = isoOf(t);
      if (!iso) return { abstain: `cannot place ${JSON.stringify(t)}` };
      if (enumList && !enumList.includes(iso)) return { abstain: `${iso} is not allowed by the schema` };
      out.push(iso);
    }
    return { isos: out };
  };
  if (/^Map each text to its country code/.test(head) && schema?.properties?.items && !schema.properties.items.items?.properties?.index) {
    const body = lines.slice(1).filter(l => l.trim());
    if (!body.length || !body.every(l => l.startsWith('- '))) return { abstain: 'unexpected list' };
    const texts = body.map(l => l.slice(2)), r = place(texts, null);
    return r.abstain ? r : { value: { items: texts.map((text, i) => ({ text, iso: r.isos[i] })) } };
  }
  if (/^Map each item to the country it names/.test(head) && schema?.properties?.mappings) {
    const at = lines.findIndex(l => l.trim() === 'ITEMS:');
    const body = at >= 0 ? lines.slice(at + 1).filter(l => l.trim()) : [];
    if (!body.length || !body.every(l => /^".*"$/.test(l.trim()))) return { abstain: 'unexpected ITEMS list' };
    let texts;
    try { texts = body.map(l => JSON.parse(l.trim())); } catch { return { abstain: 'ITEMS line is not a JSON string' }; }
    const r = place(texts, schema.properties.mappings.items?.properties?.iso?.enum ?? null);
    return r.abstain ? r : { value: { mappings: texts.map((raw, i) => ({ raw, iso: r.isos[i] })) } };
  }
  if (/^Map each country string to its ISO alpha-2 code/.test(head) && schema?.properties?.items?.items?.properties?.index) {
    const body = lines.slice(1).filter(l => l.trim());
    const rows = body.map(l => /^(\d+)\. (.*)$/.exec(l));
    if (!rows.length || rows.some(m => !m)) return { abstain: 'unexpected numbered list' };
    const r = place(rows.map(m => m[2]), schema.properties.items.items.properties.iso?.enum ?? null);
    return r.abstain ? r : { value: { items: rows.map((m, i) => ({ index: Number(m[1]), text: m[2], iso: r.isos[i] })) } };
  }
  return { abstain: 'unexpected prompt shape' };
}
