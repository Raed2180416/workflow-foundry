// Rule tier for records/date-order (the numeric birth-date convention of BRIGHTDESK, ATLAS and VENDEX in the source
// notes). Written by the frontier author (Claude Opus 5.5) from the calibration slice C only (PREREG-TIERDOWN.json).
// The notes state the convention in many forms (the dossier counts 36 forms in 61 sentences), so the rule reads cues in
// four levels and decides on the strongest level that has any, only when that level is unanimous:
//   1 worked example   a numeric date and the month it names ("dob=07/08/1986 is 8 July 1986", "falls in January")
//   2 format token     MM/DD/YYYY, DD/MM/YYYY, month/day/year, day/month/year, "the first number is the day"
//   3 order phrase     "month comes first", "day comes before the month", "day-first", "American order/defaults",
//                      "European convention"
//   4 place            "the way people do in <country>", "works from <city>", "moved from <A> to <B>" (B counts)
// A cue in a clause with not / never / n't / unlike before it counts for the other order. No cue, conflicting cues at
// the deciding level, a place it does not know, or a system the schema asks for that the notes do not cover: abstain
// (the judge falls back to its reference tier). It never answers "none".
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_RE = new RegExp(`\\b(${MONTHS.join('|')})\\b`, 'i');
const US_PLACES = ['united states', 'the us', 'the u.s.', 'usa', 'america', 'boston', 'indianapolis', 'charlotte', 'chicago', 'new york', 'houston', 'dallas', 'denver', 'seattle',
  'atlanta', 'phoenix', 'philadelphia', 'san francisco', 'los angeles', 'miami', 'detroit', 'columbus', 'austin', 'nashville', 'portland', 'minneapolis', 'baltimore', 'pittsburgh',
  'cleveland', 'st. louis', 'kansas city', 'san diego', 'san jose', 'raleigh', 'salt lake city', 'cincinnati', 'milwaukee', 'tampa', 'orlando', 'sacramento', 'las vegas', 'memphis'];
const DMY_PLACES = ['united kingdom', 'the uk', 'britain', 'england', 'ireland', 'germany', 'france', 'italy', 'spain', 'netherlands', 'belgium', 'austria', 'switzerland', 'denmark',
  'sweden', 'norway', 'australia', 'europe', 'london', 'manchester', 'dublin', 'berlin', 'munich', 'hamburg', 'frankfurt', 'paris', 'lyon', 'milan', 'rome', 'turin', 'madrid',
  'barcelona', 'lisbon', 'amsterdam', 'rotterdam', 'brussels', 'vienna', 'zurich', 'geneva', 'copenhagen', 'stockholm', 'oslo', 'prague', 'warsaw', 'budapest', 'athens',
  'helsinki', 'edinburgh', 'glasgow', 'sydney', 'melbourne', 'lyon', 'krakow', 'bucharest'];
const NEG = /\b(not|never|no longer|unlike|rather than|instead of)\b|n't\b/i;

const flip = o => (o === 'MDY' ? 'DMY' : 'MDY');
// The clause of a sentence that contains index i (split on , ; : and the words but / so / while).
function clauseBefore(sentence, i) {
  const head = sentence.slice(0, i);
  const cut = Math.max(...[',', ';', ':', ' but ', ' so ', ' while ', ' whereas '].map(s => head.lastIndexOf(s)));
  return head.slice(cut >= 0 ? cut : 0);
}
// The rest of the clause after a cue (up to , ; : or 'but'): "the day-first setup was never applied".
function clauseAfter(sentence, i) {
  const tail = sentence.slice(i), cuts = [',', ';', ':', ' but '].map(s => tail.indexOf(s)).filter(k => k >= 0);
  return cuts.length ? tail.slice(0, Math.min(...cuts)) : tail;
}
const POST_NEG = /\b(was|were|is|are|has been|had been)\s+(never|not)\b|\bnever (applied|used|adopted)\b/i;
const orient = (sentence, i, order) => (NEG.test(clauseBefore(sentence, i)) || POST_NEG.test(clauseAfter(sentence, i)) ? flip(order) : order);

export function cuesOf(paragraph) {
  const cues = [];
  const sentences = String(paragraph).split(/(?<=[.!?])\s+(?=[A-Z"(])/);
  for (const s0 of sentences) {
    // Update / revision / change dates are not birth dates; their sentences are skipped unless they speak of numeric dates.
    if (/\b(updated|upd|ts|geändert|revised|revision|last change|re-?stamped|overwrote|restored|rebuild)\b/i.test(s0) && !/numeric|birth|dob|born/i.test(s0)) continue;
    const s = s0;
    // 1 worked example
    for (const m of s.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/g)) {
      const rest = s.slice(m.index + m[0].length), month = MONTH_RE.exec(rest);
      if (!month) continue;
      const mi = MONTHS.indexOf(month[1].toLowerCase()) + 1, a = Number(m[1]), b = Number(m[2]);
      if (a === mi && b !== mi) cues.push({ level: 1, order: 'MDY', at: m[0] });
      else if (b === mi && a !== mi) cues.push({ level: 1, order: 'DMY', at: m[0] });
    }
    // 2 format tokens
    for (const [re, order] of [[/\bMM[/.-]DD[/.-](YYYY|YY)\b/g, 'MDY'], [/\bDD[/.-]MM[/.-](YYYY|YY)\b/g, 'DMY'], [/\bmonth\/day\/year\b/gi, 'MDY'], [/\bday\/month\/year\b/gi, 'DMY'],
      [/\bfirst number is the day\b/gi, 'DMY'], [/\bfirst number is the month\b/gi, 'MDY']])
      for (const m of s.matchAll(re)) cues.push({ level: 2, order: orient(s, m.index, order), at: m[0] });
    // 3 order phrases
    for (const [re, order] of [[/\bmonth (comes |is written |goes )?(first|before the day)\b/gi, 'MDY'], [/\bmonth-first\b/gi, 'MDY'], [/\bwrites? the month first\b/gi, 'MDY'],
      [/\bday (comes |is written |goes )?(first|before the month)\b/gi, 'DMY'], [/\bday-first\b/gi, 'DMY'], [/\bwrites? the day first\b/gi, 'DMY'],
      [/\bAmerican (order|defaults?|convention|format|style|month\/day\/year)\b/g, 'MDY'], [/\bEuropean (order|convention|format|style|habit)\b/g, 'DMY']])
      for (const m of s.matchAll(re)) cues.push({ level: 3, order: orient(s, m.index, order), at: m[0] });
    // 4 places, only in a sentence about how dates are written
    if (/\b(dates?|write|writes|written|formats?)\b/i.test(s) && /\b(way|local|people|there|country|convention)\b/i.test(s)) {
      const lower = s.toLowerCase(), moved = /\bmoved from (.+?) to (.+?)(?: in \d{4}|,|\.| and )/i.exec(s);
      const scope = moved ? moved[2].toLowerCase() : lower;
      const us = US_PLACES.filter(p => new RegExp(`(^|[^a-z])${p.replace(/[.]/g, '\\.')}([^a-z]|$)`).test(scope));
      const eu = DMY_PLACES.filter(p => new RegExp(`(^|[^a-z])${p.replace(/[.]/g, '\\.')}([^a-z]|$)`).test(scope));
      if (us.length && !eu.length) cues.push({ level: 4, order: 'MDY', at: us[0] });
      else if (eu.length && !us.length) cues.push({ level: 4, order: 'DMY', at: eu[0] });
      else if (us.length && eu.length) cues.push({ level: 4, order: 'conflict', at: [...us, ...eu].join('|') });
    }
  }
  return cues;
}

// One system's order from its paragraph, or {abstain}.
export function orderOf(paragraph) {
  const cues = cuesOf(paragraph);
  for (const level of [1, 2, 3, 4]) {
    const at = cues.filter(c => c.level === level);
    if (!at.length) continue;
    const orders = new Set(at.map(c => c.order));
    if (orders.size === 1 && !orders.has('conflict')) return { order: at[0].order, level, cues: at.map(c => c.at) };
    return { abstain: `conflicting level-${level} cues: ${at.map(c => `${c.at}=${c.order}`).join(', ')}` };
  }
  return { abstain: 'no date-order cue' };
}

// The notes between <<< and >>> (or the whole prompt), and one system's paragraph ("SYSTEM." up to the blank line).
export function paragraphOf(notes, system) {
  return String(notes).split(/\n\s*\n/).find(p => p.trimStart().startsWith(`${system}.`)) ?? null;
}

export function dateOrderRule({ prompt, schema }) {
  const systems = schema?.required;
  if (!Array.isArray(systems) || !systems.length || !systems.every(s => ['BRIGHTDESK', 'ATLAS', 'VENDEX'].includes(s))) return { abstain: 'unexpected schema' };
  const notes = /<<<([\s\S]*?)>>>/.exec(String(prompt))?.[1] ?? String(prompt);
  const value = {};
  for (const sys of systems) {
    const p = paragraphOf(notes, sys);
    if (!p) return { abstain: `no ${sys} paragraph` };
    const r = orderOf(p);
    if (r.abstain) return { abstain: `${sys}: ${r.abstain}` };
    value[sys] = r.order;
  }
  return { value };
}
