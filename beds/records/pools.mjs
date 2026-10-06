// Static, fictional pools for the `records` bed: names, nicknames, countries, phone plans,
// currencies, transliteration and English number words. Name combinations are drawn at
// random by the generator, so no record describes a real person.

// ---------------------------------------------------------------------------------------
// Names. given: [formal spelling, gender]; nicknames map nickname -> formal (one-to-one).
export const CULTURES = {
  en: {
    countries: ['US', 'GB', 'IE', 'AU', 'CA'],
    given: [['Robert', 'm'], ['William', 'm'], ['Elizabeth', 'f'], ['Margaret', 'f'], ['James', 'm'], ['Richard', 'm'],
      ['Katherine', 'f'], ['Jennifer', 'f'], ['Michael', 'm'], ['Thomas', 'm'], ['Patricia', 'f'], ['Christopher', 'm'],
      ['Daniel', 'm'], ['Susan', 'f'], ['Edward', 'm'], ['Anthony', 'm'], ['Rebecca', 'f'], ['Victoria', 'f'],
      ['Nathaniel', 'm'], ['Abigail', 'f'], ['Theodore', 'm'], ['Gwendolyn', 'f'], ['Harriet', 'f'], ['Malcolm', 'm'],
      ['Rupert', 'm'], ['Ophelia', 'f']],
    family: ['Hartwell', 'Whitcombe', 'Calloway', 'Brennan', 'Ashby', 'Delaney', 'Pruitt', 'Holloway', 'Marsh',
      'Kendrick', 'Sutton', 'Fairbanks', 'Lowell', 'Prescott', 'Rowntree', "O'Malley", 'McAllister', 'Thornbury',
      'Pemberton', 'Garrick', 'Ellsworth', 'Haverford', 'Quimby', 'Radcliffe', 'Stanhope', 'Winslow'],
  },
  de: {
    countries: ['DE', 'AT', 'CH'],
    given: [['Jürgen', 'm'], ['Jörg', 'm'], ['Günter', 'm'], ['Klaus', 'm'], ['Ute', 'f'], ['Dieter', 'm'], ['Heike', 'f'],
      ['Matthias', 'm'], ['Sabine', 'f'], ['Wolfgang', 'm'], ['Johannes', 'm'], ['Katharina', 'f'], ['Friedrich', 'm'],
      ['Josef', 'm'], ['Stefanie', 'f'], ['Bärbel', 'f'], ['Käthe', 'f'], ['Sönke', 'm'], ['Gisela', 'f'], ['Rüdiger', 'm']],
    family: ['Müller', 'Schröder', 'Weiß', 'Köhler', 'Böhm', 'Krüger', 'Fuchs', 'Becker', 'Hoffmann', 'Lehmann',
      'Strauß', 'Wörner', 'Gärtner', 'Jäger', 'Brandt', 'Vogt', 'Kühn', 'Dreßler', 'Löffler', 'Großmann', 'Bäumer',
      'Hüttner'],
  },
  fr: {
    countries: ['FR', 'BE', 'CH'],
    given: [['Hélène', 'f'], ['Émile', 'm'], ['François', 'm'], ['Gaëlle', 'f'], ['Jérôme', 'm'], ['Céline', 'f'],
      ['Benoît', 'm'], ['Léa', 'f'], ['Noël', 'm'], ['Stéphane', 'm'], ['Thérèse', 'f'], ['Amélie', 'f'], ['Rémi', 'm'],
      ['Agnès', 'f']],
    family: ['Lefèvre', 'Bérard', 'Garnier', 'Rousseau', 'Dubois', 'Chevrier', 'Fournier', 'Mercier', 'Lemaître',
      'Boucher', 'Gauthier', 'Lagacé', 'Béliveau', 'Ménard'],
  },
  es: {
    countries: ['ES', 'MX'],
    given: [['José', 'm'], ['Francisco', 'm'], ['Ignacio', 'm'], ['Dolores', 'f'], ['Concepción', 'f'], ['Andrés', 'm'],
      ['Begoña', 'f'], ['Rocío', 'f'], ['Iñaki', 'm'], ['Ramón', 'm'], ['Inés', 'f'], ['Óscar', 'm']],
    family: ['Muñoz', 'Peña', 'Ibáñez', 'Núñez', 'Ortega', 'Serrano', 'Castaño', 'Fernández', 'Delgado', 'Cortés',
      'Valdés', 'Echeverría'],
  },
  it: {
    countries: ['IT'],
    given: [['Giuseppe', 'm'], ['Niccolò', 'm'], ['Lucrezia', 'f'], ['Giovanni', 'm'], ['Domenico', 'm'], ['Caterina', 'f'],
      ['Raffaele', 'm'], ['Ilaria', 'f'], ['Beatrice', 'f'], ['Leonardo', 'm']],
    family: ['Ferraro', 'Galli', 'Pellegrini', 'Benedetti', 'Mancuso', 'Lombardi', 'Esposito', "D'Angelo", 'Santoro',
      'Caruso', 'Fabbri', 'Barbieri'],
  },
  nl: {
    countries: ['NL', 'BE'],
    given: [['Pieter', 'm'], ['Maarten', 'm'], ['Sanne', 'f'], ['Joost', 'm'], ['Femke', 'f'], ['Wouter', 'm'],
      ['Anouk', 'f'], ['Geert', 'm'], ['Lieke', 'f'], ['Abraham', 'm']],
    family: ['van Dijk', 'de Vries', 'van den Berg', 'Bakker', 'Visser', 'Smit', 'de Jong', 'Mulder', 'Jansen',
      'van Leeuwen', 'Hoekstra', 'Kuipers', 'van der Meer'],
  },
  ja: {
    countries: ['JP'],
    given: [['Hiroshi', 'm'], ['Yūki', 'f'], ['Kenji', 'm'], ['Akiko', 'f'], ['Haruto', 'm'], ['Sakura', 'f'],
      ['Takeshi', 'm'], ['Yōko', 'f'], ['Shōta', 'm'], ['Kōji', 'm'], ['Megumi', 'f'], ['Daisuke', 'm'], ['Ryōta', 'm']],
    family: ['Tanaka', 'Satō', 'Itō', 'Katō', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Ōta', 'Inoue', 'Shimizu', 'Kōno',
      'Saitō', 'Mori'],
  },
  nordic: {
    countries: ['SE', 'DK', 'NO'],
    given: [['Björn', 'm'], ['Åsa', 'f'], ['Søren', 'm'], ['Jørgen', 'm'], ['Märta', 'f'], ['Ingrid', 'f'], ['Lars', 'm'],
      ['Øystein', 'm'], ['Kristoffer', 'm'], ['Astrid', 'f'], ['Sigrún', 'f']],
    family: ['Lindqvist', 'Sjöberg', 'Ødegaard', 'Åberg', 'Bergström', 'Nyström', 'Halvorsen', 'Kjær', 'Sørensen',
      'Ekström', 'Dahlgren'],
  },
};
export const CULTURE_WEIGHTS = [['en', 5], ['de', 3], ['fr', 2], ['es', 2], ['it', 1.5], ['nl', 1.5], ['ja', 2], ['nordic', 1.5]];

export const NICKNAMES = {
  Bob: 'Robert', Rob: 'Robert', Bobby: 'Robert', Bill: 'William', Will: 'William', Liz: 'Elizabeth', Beth: 'Elizabeth',
  Peggy: 'Margaret', Maggie: 'Margaret', Jim: 'James', Jimmy: 'James', Rick: 'Richard', Dick: 'Richard',
  Kate: 'Katherine', Kathy: 'Katherine', Jen: 'Jennifer', Jenny: 'Jennifer', Mike: 'Michael', Tom: 'Thomas',
  Trish: 'Patricia', Patty: 'Patricia', Chris: 'Christopher', Dan: 'Daniel', Danny: 'Daniel', Sue: 'Susan',
  Suzy: 'Susan', Ted: 'Edward', Ned: 'Edward', Tony: 'Anthony', Becky: 'Rebecca', Vicky: 'Victoria', Nate: 'Nathaniel',
  Abby: 'Abigail', Theo: 'Theodore', Gwen: 'Gwendolyn', Hattie: 'Harriet',
  Hannes: 'Johannes', Fritz: 'Friedrich', Sepp: 'Josef', Steffi: 'Stefanie', Kathi: 'Katharina', Matze: 'Matthias',
  Wolfi: 'Wolfgang', Gisi: 'Gisela',
  Pepe: 'José', Paco: 'Francisco', Nacho: 'Ignacio', Lola: 'Dolores', Concha: 'Concepción',
  Beppe: 'Giuseppe', Gianni: 'Giovanni', Mimmo: 'Domenico', Lello: 'Raffaele',
  Piet: 'Pieter', Bram: 'Abraham',
  Kris: 'Kristoffer',
};
export const NICKS_OF = Object.entries(NICKNAMES).reduce((acc, [nick, formal]) => {
  (acc[formal] ||= []).push(nick); return acc;
}, {});

export const TITLES_EN = { m: ['Mr', 'Mr.', 'Dr.', 'Dr', 'Prof.'], f: ['Ms', 'Mrs', 'Ms.', 'Dr.', 'Prof.'] };
export const TITLES_DE = { m: ['Herr', 'Herr Dr.', 'Herr Prof.'], f: ['Frau', 'Frau Dr.', 'Frau Prof.'] };

// ---------------------------------------------------------------------------------------
// Transliteration. 'strip' drops accents; 'expand' uses the long ASCII forms (ü->ue, ø->oe, ō->ou).
const STRIP = {
  'ä': 'a', 'ö': 'o', 'ü': 'u', 'ß': 'ss', 'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e', 'á': 'a', 'à': 'a', 'â': 'a',
  'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i', 'ó': 'o', 'ò': 'o', 'ô': 'o', 'ú': 'u', 'ù': 'u', 'û': 'u', 'ñ': 'n',
  'ç': 'c', 'ø': 'o', 'å': 'a', 'æ': 'ae', 'ō': 'o', 'ū': 'u',
};
const EXPAND = { ...STRIP, 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ø': 'oe', 'å': 'aa', 'ō': 'ou', 'ū': 'uu' };
export const isAscii = s => /^[\x00-\x7f]*$/.test(s);
export function translit(s, style) {
  const table = style === 'expand' ? EXPAND : STRIP;
  let out = '';
  for (const ch of s.normalize('NFC')) {
    const lower = ch.toLowerCase();
    const rep = table[lower];
    if (rep === undefined) { out += ch; continue; }
    out += ch !== lower ? rep[0].toUpperCase() + rep.slice(1) : rep;
  }
  return out;
}
export const asciiRenderings = s => new Set([translit(s, 'strip').toLowerCase(), translit(s, 'expand').toLowerCase()]);
const foldBase = s => s.normalize('NFC').toLowerCase().replace(/[’'`\-\s.]/g, '');
export const foldStrip = s => translit(foldBase(s), 'strip');
export const foldExpand = s => translit(foldBase(s), 'expand');

// Optimal string alignment distance (Damerau-Levenshtein restricted to adjacent swaps).
export function osa(a, b) {
  const n = a.length, m = b.length;
  if (Math.abs(n - m) > 2) return 3;
  const d = Array.from({ length: n + 1 }, (_, i) => { const row = new Array(m + 1).fill(0); row[0] = i; return row; });
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[n][m];
}
// Distance between two spellings of one name part, treating transliterations as equal.
export function partDistance(a, b) {
  return Math.min(osa(foldStrip(a), foldStrip(b)), osa(foldExpand(a), foldExpand(b)));
}
export const formalOf = given => NICKNAMES[given.normalize('NFC')] ?? NICKNAMES[titleCase(given)] ?? given;
// Names match: given (after nickname expansion) and family, transliteration-equal, at most one
// typing error in total across the two parts.
export function namesMatch(a, b) {
  const g = partDistance(formalOf(a.given), formalOf(b.given));
  if (g > 1) return false;
  return g + partDistance(a.family, b.family) <= 1;
}
export function titleCase(s) {
  return s.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

// ---------------------------------------------------------------------------------------
// Countries: ISO alpha-2 -> aliases, phone plan and currency.
// trunk: '0' national trunk prefix that E.164 drops; '' none; 'keep0' Italy (0 is part of the number).
const digits = (r, n) => Array.from({ length: n }, () => r.int(0, 9)).join('');
export const COUNTRIES = {
  US: { en: ['United States', 'USA', 'U.S.A.', 'United States of America', 'US'], de: ['Vereinigte Staaten', 'USA'],
    typo: ['Untied States', 'Unites States'], prose: ['the United States', 'the U.S.', 'the USA'], demonym: 'American',
    cc: '1', trunk: 'nanp', currency: 'USD' },
  CA: { en: ['Canada', 'CAN'], de: ['Kanada'], typo: ['Cananda', 'Canda'], prose: ['Canada'], demonym: 'Canadian',
    cc: '1', trunk: 'nanp', currency: 'CAD' },
  GB: { en: ['United Kingdom', 'UK', 'U.K.', 'Great Britain', 'England', 'Britain'],
    de: ['Vereinigtes Königreich', 'Großbritannien'], typo: ['Untied Kingdom', 'Unted Kingdom'],
    prose: ['the United Kingdom', 'the UK', 'England', 'Great Britain'], demonym: 'British', cc: '44', trunk: '0', currency: 'GBP' },
  IE: { en: ['Ireland', 'Republic of Ireland', 'Eire'], de: ['Irland'], typo: ['Irleand'], prose: ['Ireland'],
    demonym: 'Irish', cc: '353', trunk: '0', currency: 'EUR' },
  AU: { en: ['Australia', 'Commonwealth of Australia', 'AUS'], de: ['Australien'], typo: ['Austrailia', 'Australa'],
    prose: ['Australia'], demonym: 'Australian', cc: '61', trunk: '0', currency: 'AUD' },
  DE: { en: ['Germany', 'Federal Republic of Germany', 'GER', 'Deutschland'], de: ['Deutschland', 'BRD', 'DE'],
    typo: ['Germnay', 'Gemany'], prose: ['Germany'], demonym: 'German', cc: '49', trunk: '0', currency: 'EUR' },
  AT: { en: ['Austria', 'Republic of Austria', 'AUT', 'Österreich'], de: ['Österreich', 'Oesterreich', 'AT'], typo: [],
    prose: ['Austria'], demonym: 'Austrian', cc: '43', trunk: '0', currency: 'EUR' },
  CH: { en: ['Switzerland', 'Swiss Confederation', 'Schweiz', 'Suisse'], de: ['Schweiz', 'CH'],
    typo: ['Switzerlnd', 'Swizerland'], prose: ['Switzerland'], demonym: 'Swiss', cc: '41', trunk: '0', currency: 'CHF' },
  FR: { en: ['France', 'French Republic', 'FRA'], de: ['Frankreich'], typo: ['Frnace', 'Farnce'], prose: ['France'],
    demonym: 'French', cc: '33', trunk: '0', currency: 'EUR' },
  BE: { en: ['Belgium', 'Belgique', 'België', 'BEL'], de: ['Belgien'], typo: ['Belguim'], prose: ['Belgium'],
    demonym: 'Belgian', cc: '32', trunk: '0', currency: 'EUR' },
  ES: { en: ['Spain', 'España', 'Espana', 'ESP'], de: ['Spanien'], typo: ['Spian'], prose: ['Spain'],
    demonym: 'Spanish', cc: '34', trunk: '', currency: 'EUR' },
  MX: { en: ['Mexico', 'México', 'United Mexican States', 'MEX'], de: ['Mexiko'], typo: ['Mexcio'], prose: ['Mexico'],
    demonym: 'Mexican', cc: '52', trunk: '', currency: 'MXN' },
  IT: { en: ['Italy', 'Italia', 'ITA'], de: ['Italien'], typo: ['Itlay', 'Italiy'], prose: ['Italy'],
    demonym: 'Italian', cc: '39', trunk: 'keep0', currency: 'EUR' },
  NL: { en: ['Netherlands', 'The Netherlands', 'Holland', 'Nederland', 'NLD'], de: ['Niederlande', 'Holland'],
    typo: ['Netherlnads', 'Nehterlands'], prose: ['the Netherlands', 'Holland'], demonym: 'Dutch', cc: '31', trunk: '0', currency: 'EUR' },
  JP: { en: ['Japan', 'Nippon', 'JPN'], de: ['Japan'], typo: ['Japna', 'Jpaan'], prose: ['Japan'], demonym: 'Japanese',
    cc: '81', trunk: '0', currency: 'JPY' },
  SE: { en: ['Sweden', 'Sverige', 'SWE'], de: ['Schweden'], typo: ['Swedn', 'Sweeden'], prose: ['Sweden'],
    demonym: 'Swedish', cc: '46', trunk: '0', currency: 'SEK' },
  DK: { en: ['Denmark', 'Danmark', 'DNK'], de: ['Dänemark'], typo: ['Denamrk'], prose: ['Denmark'], demonym: 'Danish',
    cc: '45', trunk: '', currency: 'DKK' },
  NO: { en: ['Norway', 'Norge', 'NOR'], de: ['Norwegen'], typo: ['Norwya'], prose: ['Norway'], demonym: 'Norwegian',
    cc: '47', trunk: '', currency: 'NOK' },
};
export const COUNTRY_NAME = {
  US: 'United States', CA: 'Canada', GB: 'United Kingdom', IE: 'Ireland', AU: 'Australia', DE: 'Germany', AT: 'Austria',
  CH: 'Switzerland', FR: 'France', BE: 'Belgium', ES: 'Spain', MX: 'Mexico', IT: 'Italy', NL: 'Netherlands', JP: 'Japan',
  SE: 'Sweden', DK: 'Denmark', NO: 'Norway',
};

// National significant numbers (what follows the calling code in E.164) and their layouts.
// Each plan returns { nsn, groups } where groups are the digit groups of the NSN used for display.
// Numbers use reserved/fictional-looking ranges where a convention exists (NANP 555-01xx,
// UK 020 7946 0xxx and 07700 900xxx); everything is generated.
export const PHONE_PLANS = {
  US: r => { const a = `${r.int(2, 9)}${digits(r, 2)}`; const l = `01${digits(r, 2)}`; return { nsn: `${a}555${l}`, groups: [a, '555', l] }; },
  CA: r => { const a = r.pick(['416', '604', '514', '613', '403', '902']); const l = `01${digits(r, 2)}`; return { nsn: `${a}555${l}`, groups: [a, '555', l] }; },
  GB: r => r.chance(0.6)
    ? (() => { const l = `0${digits(r, 3)}`; return { nsn: `207946${l}`, groups: ['20', '7946', l] }; })()
    : (() => { const l = digits(r, 3); return { nsn: `7700900${l}`, groups: ['7700', `900${l}`] }; })(),
  IE: r => { const a = digits(r, 3), b = digits(r, 4); return { nsn: `1${a}${b}`, groups: ['1', a, b] }; },
  AU: r => { const a = `${r.int(2, 9)}${digits(r, 3)}`, b = digits(r, 4); return { nsn: `2${a}${b}`, groups: ['2', a, b] }; },
  DE: r => r.chance(0.7)
    ? (() => { const ac = r.pick(['30', '40', '89', '69', '221']); const s = `${r.int(2, 9)}${digits(r, 6)}`; return { nsn: ac + s, groups: [ac, s] }; })()
    : (() => { const ac = r.pick(['151', '160', '171', '176']); const s = `${r.int(1, 9)}${digits(r, 7)}`; return { nsn: ac + s, groups: [ac, s] }; })(),
  AT: r => { const s = `${r.int(2, 9)}${digits(r, 6)}`; return { nsn: `1${s}`, groups: ['1', s] }; },
  CH: r => { const ac = r.pick(['44', '31', '61', '22']); const a = `${r.int(2, 9)}${digits(r, 2)}`, b = digits(r, 2), c = digits(r, 2); return { nsn: ac + a + b + c, groups: [ac, a, b, c] }; },
  FR: r => { const ac = r.pick(['1', '4', '6']); const g = [digits(r, 2), digits(r, 2), digits(r, 2), digits(r, 2)]; return { nsn: ac + g.join(''), groups: [ac, ...g] }; },
  BE: r => { const a = `${r.int(2, 9)}${digits(r, 2)}`, b = digits(r, 2), c = digits(r, 2); return { nsn: `2${a}${b}${c}`, groups: ['2', a, b, c] }; },
  ES: r => r.chance(0.6)
    ? (() => { const a = `91${r.int(2, 9)}`, b = digits(r, 3), c = digits(r, 3); return { nsn: a + b + c, groups: [a, b, c] }; })()
    : (() => { const a = `6${digits(r, 2)}`, b = digits(r, 3), c = digits(r, 3); return { nsn: a + b + c, groups: [a, b, c] }; })(),
  MX: r => { const a = digits(r, 4), b = digits(r, 4); return { nsn: `55${a}${b}`, groups: ['55', a, b] }; },
  IT: r => r.chance(0.65)
    ? (() => { const ac = r.pick(['06', '02']); const a = digits(r, 4), b = digits(r, 4); return { nsn: ac + a + b, groups: [ac, a, b] }; })()
    : (() => { const a = `3${r.int(2, 4)}${r.int(0, 9)}`, b = digits(r, 3), c = digits(r, 4); return { nsn: a + b + c, groups: [a, b, c] }; })(),
  NL: r => { const a = `${r.int(2, 9)}${digits(r, 2)}`, b = digits(r, 4); return { nsn: `20${a}${b}`, groups: ['20', a, b] }; },
  JP: r => r.chance(0.6)
    ? (() => { const a = digits(r, 4), b = digits(r, 4); return { nsn: `3${a}${b}`, groups: ['3', a, b] }; })()
    : (() => { const ac = r.pick(['90', '80']); const a = digits(r, 4), b = digits(r, 4); return { nsn: ac + a + b, groups: [ac, a, b] }; })(),
  SE: r => { const a = digits(r, 3), b = digits(r, 3), c = digits(r, 2); return { nsn: `8${a}${b}${c}`, groups: ['8', a, b, c] }; },
  DK: r => { const g = [`${r.int(2, 9)}${digits(r, 1)}`, digits(r, 2), digits(r, 2), digits(r, 2)]; return { nsn: g.join(''), groups: g }; },
  NO: r => { const g = [`${r.int(2, 9)}${digits(r, 1)}`, digits(r, 2), digits(r, 2), digits(r, 2)]; return { nsn: g.join(''), groups: g }; },
};
export const e164 = (iso, nsn) => `+${COUNTRIES[iso].cc}${nsn}`;

// ---------------------------------------------------------------------------------------
// Currencies: minor-unit digits and baseline USD rates (USD per 1 unit). The generator jitters
// rates per task so they must be read from the spec, not remembered.
export const CURRENCIES = {
  USD: { minor: 2, rate: 1 }, EUR: { minor: 2, rate: 1.085 }, GBP: { minor: 2, rate: 1.271 }, JPY: { minor: 0, rate: 0.00672 },
  CHF: { minor: 2, rate: 1.124 }, CAD: { minor: 2, rate: 0.736 }, AUD: { minor: 2, rate: 0.659 }, SEK: { minor: 2, rate: 0.0952 },
  DKK: { minor: 2, rate: 0.1455 }, NOK: { minor: 2, rate: 0.0931 }, MXN: { minor: 2, rate: 0.0584 },
};
// Earlier-period multipliers used when the FX table is dated (difficulty 5).
export const OLD_RATE_FACTOR = { EUR: 1.09, GBP: 1.083, JPY: 1.354, CHF: 0.972, CAD: 1.084, AUD: 1.14, SEK: 1.223, DKK: 1.093, NOK: 1.22, MXN: 0.844 };

// ---------------------------------------------------------------------------------------
// English number words.
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function below100(n) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ''); }
function below1000(n) {
  const h = Math.floor(n / 100), rest = n % 100;
  if (!h) return below100(rest);
  return `${ONES[h]} hundred${rest ? ` ${below100(rest)}` : ''}`;
}
// style 'hundreds' renders 1100..9999 multiples of 100 (not of 1000) as "twelve hundred".
export function numberWords(n, style = 'plain') {
  if (n === 0) return 'zero';
  if (style === 'hundreds' && n >= 1100 && n < 10000 && n % 100 === 0 && n % 1000 !== 0) {
    return `${below100(n / 100)} hundred`;
  }
  const th = Math.floor(n / 1000), rest = n % 1000;
  if (!th) return below1000(rest);
  return `${below1000(th)} thousand${rest ? ` ${below1000(rest)}` : ''}`;
}
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = MONTHS.map(m => m.slice(0, 3));
export function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
  return `${n}${s}`;
}
