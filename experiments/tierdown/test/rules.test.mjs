// Rule tier tests (A10): the country lexicon and the date-order cue reader must answer the forms they were written for,
// and must ABSTAIN (never guess) on anything else. Synthetic inputs only; no archive, no model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoOf, osa, countriesRule, countryNamesRule } from '../rules/countries.mjs';
import { orderOf, dateOrderRule, cuesOf } from '../rules/date-order.mjs';
import { RULES } from '../rules/index.mjs';

test('country lexicon: aliases, ISO-3, German names, misspellings; ambiguity and unknowns abstain', () => {
  assert.equal(isoOf('Vereinigtes Königreich'), 'GB');
  assert.equal(isoOf('U.S.A.'), 'US'); assert.equal(isoOf('uk'), 'GB'); assert.equal(isoOf('BRD'), 'DE'); assert.equal(isoOf('Eire'), 'IE');
  assert.equal(isoOf('Spian'), 'ES'); assert.equal(isoOf('Untied States'), 'US'); assert.equal(isoOf('Netherlnads'), 'NL'); assert.equal(isoOf('Austrailia'), 'AU');
  assert.equal(isoOf('Australa'), 'AU', 'one edit from Australia, three from Austria');
  assert.equal(isoOf('Austrlia'), null, 'one edit from both Austria and Australia: no unique best code');
  assert.equal(isoOf('Austrai'), 'AT', 'one transposition from Austria, two edits from Australia');
  assert.equal(isoOf('Brazil'), null, 'outside the 18 countries');
  assert.equal(isoOf('Atlantis'), null);
  assert.equal(isoOf(''), null);
  assert.equal(isoOf('Germ'), null, 'short fragments are never fuzzy-matched');
  assert.equal(osa('spian', 'spain'), 1); assert.equal(osa('abc', 'abc'), 0); assert.equal(osa('', 'ab'), 2);
});

test('countries rule: full mapping or abstain; refuses an unknown country table', () => {
  const schema = { properties: { mapping: {} } };
  const prompt = 'Map each text below to its ISO code. Known table (ISO name): US United States; DE Germany; ES Spain.\nTEXTS (JSON): ["BRD","Spian","USA"]';
  assert.deepEqual(countriesRule({ prompt, schema }).value.mapping, [{ text: 'BRD', iso: 'DE' }, { text: 'Spian', iso: 'ES' }, { text: 'USA', iso: 'US' }]);
  assert.match(countriesRule({ prompt: prompt.replace('"USA"', '"Brasil"'), schema }).abstain, /cannot place/);
  assert.match(countriesRule({ prompt: prompt.replace('"USA"', '"Mexiko"'), schema }).abstain, /cannot place "Mexiko"/, 'a code outside the given table abstains');
  assert.match(countriesRule({ prompt: prompt.replace('US United States', 'BR Brazil'), schema }).abstain, /unknown country table/);
  assert.match(countriesRule({ prompt, schema: { properties: { items: {} } } }).abstain, /schema/);
});

test('country-names rule: the three archived prompt shapes, enum respected, other shapes abstain', () => {
  const a = countryNamesRule({ prompt: 'Map each text to its country code, or null:\n- Schweiz\n- Frnace', schema: { properties: { items: { items: { properties: { text: {}, iso: {} } } } } } });
  assert.deepEqual(a.value, { items: [{ text: 'Schweiz', iso: 'CH' }, { text: 'Frnace', iso: 'FR' }] });
  const enumSchema = { properties: { mappings: { items: { properties: { raw: {}, iso: { enum: ['DE', 'JP'] } } } } } };
  const b = countryNamesRule({ prompt: 'Map each item to the country it names. Return one mapping per item.\nITEMS:\n"Nippon"\n"Gemany"', schema: enumSchema });
  assert.deepEqual(b.value, { mappings: [{ raw: 'Nippon', iso: 'JP' }, { raw: 'Gemany', iso: 'DE' }] });
  assert.match(countryNamesRule({ prompt: 'Map each item to the country it names.\nITEMS:\n"Spain"', schema: enumSchema }).abstain, /not allowed/);
  const c = countryNamesRule({ prompt: 'Map each country string to its ISO alpha-2 code (United Kingdom = GB). Use "XX" if it is not a country.\n0. BRD\n1. Holland',
    schema: { properties: { items: { items: { properties: { index: {}, text: {}, iso: { enum: ['DE', 'NL', 'XX'] } } } } } } });
  assert.deepEqual(c.value.items, [{ index: 0, text: 'BRD', iso: 'DE' }, { index: 1, text: 'Holland', iso: 'NL' }]);
  assert.match(countryNamesRule({ prompt: 'Please map these:\n- Spain', schema: { properties: { items: {} } } }).abstain, /shape/);
  assert.match(countryNamesRule({ prompt: 'Map each text to its country code, or null:\n- Spain\nextra line', schema: { properties: { items: { items: { properties: {} } } } } }).abstain, /unexpected list/);
});

test('date-order cues: worked examples, tokens, phrases, negation before and after, places', () => {
  assert.equal(orderOf('BRIGHTDESK. For example, dob=07/08/1986 is 8 July 1986.').order, 'MDY');
  assert.equal(orderOf('BRIGHTDESK. For example, dob=01/02/1996 is 2 January 1996.').order, 'MDY');
  assert.equal(orderOf('VENDEX. In a numeric date the first number is the day (so 11/01/2021 falls in January).').order, 'DMY');
  assert.equal(orderOf('ATLAS. Read numeric ATLAS birth dates as MM/DD/YYYY, never as DD/MM/YYYY.').order, 'MDY');
  assert.equal(orderOf('VENDEX. Numeric dates follow the European convention, day/month/year, not the American month/day/year.').order, 'DMY');
  assert.equal(orderOf('ATLAS. ATLAS is a UK ledger, but its birth dates are not day-first: the month comes first.').order, 'MDY');
  assert.equal(orderOf("BRIGHTDESK. The instance kept its vendor's American defaults, so the month comes before the day in numeric birth dates; the London office's day-first setup was never applied.").order, 'MDY');
  assert.equal(orderOf("BRIGHTDESK. The instance does not keep its vendor's American defaults: the day comes before the month in numeric birth dates.").order, 'DMY');
  assert.equal(orderOf('BRIGHTDESK. BRIGHTDESK does not use the American order for numeric birth dates.').order, 'DMY');
  assert.equal(orderOf('VENDEX. The team never adopted the day-first habit of its European suppliers.').order, 'MDY');
  assert.equal(orderOf('VENDEX. The team works from Boston and writes numeric dates the way people there do.').order, 'MDY');
  assert.equal(orderOf('VENDEX. The team moved from Prague to Indianapolis in 2015 and has written numeric dates the local way ever since.').order, 'MDY', 'the destination counts');
  assert.equal(orderOf('VENDEX. The team moved from Charlotte to Milan in 2015 and has written numeric dates the local way ever since.').order, 'DMY');
  assert.equal(orderOf('ATLAS. ATLAS formats numeric dates the way people do in the country where its servers stand, the United States.').order, 'MDY');
  // worked example beats a weaker contrary cue
  assert.equal(orderOf('ATLAS. Unlike the UK office, the day comes first. For example, an ATLAS birth date written 11/05/1996 is 5 November 1996.').order, 'MDY');
});

test('date-order abstains: no cue, unknown places, conflicts at the deciding level, schema it does not know', () => {
  assert.match(orderOf('VENDEX. Dates are written out in words.').abstain, /no date-order cue/);
  assert.match(orderOf('VENDEX. The team works from Toronto and writes numeric dates the way people there do.').abstain, /no date-order cue/);
  assert.match(orderOf('ATLAS. The day comes first. The month comes first.').abstain, /conflicting level-3/);
  assert.match(orderOf('ATLAS. dob=03/04/1990 is 3 April 1990. dob=03/04/1990 is 4 March 1990.').abstain, /conflicting level-1/);
  assert.match(dateOrderRule({ prompt: 'x', schema: { required: ['KOBO'] } }).abstain, /schema/);
  const notes = 'NOTES:\n<<<\nBRIGHTDESK. Numeric dates are MM/DD/YYYY.\n\nVENDEX. Dates are words.\n>>>';
  assert.match(dateOrderRule({ prompt: notes, schema: { required: ['BRIGHTDESK', 'VENDEX'] } }).abstain, /VENDEX/, 'one undecided system abstains the whole call');
  assert.match(dateOrderRule({ prompt: notes, schema: { required: ['BRIGHTDESK', 'ATLAS'] } }).abstain, /no ATLAS paragraph/);
  assert.deepEqual(dateOrderRule({ prompt: notes, schema: { required: ['BRIGHTDESK'] } }).value, { BRIGHTDESK: 'MDY' });
  // update/revision sentences never count
  assert.deepEqual(cuesOf('BRIGHTDESK. The restore re-stamped every row, so updated dates written 01/02/2024 (2 January) are unreliable.'), []);
});

test('rule registry: only the preregistered rule sites', () => {
  assert.deepEqual(Object.keys(RULES).sort(), ['records/countries', 'records/country-names', 'records/date-order']);
});
