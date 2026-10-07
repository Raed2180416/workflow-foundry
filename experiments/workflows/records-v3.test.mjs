// Unit tests of the pure helpers of experiments/workflows/records-v3.mjs on literal fixtures (no model calls, no bed
// generator). Run: node --test experiments/workflows/records-v3.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as W from './records-v3.mjs';

const SPEC = `7. Balances. amount_usd = ...
     EUR/USD  1.1344
     GBP/USD  1.2775
     USD/JPY  145.4407
     USD/CHF  0.8741
6. Phone normalisation.
     United States   US  +1    trunk prefix: none (a leading 1 is the country code)
     Canada          CA  +1    trunk prefix: none (a leading 1 is the country code)
     United Kingdom  GB  +44   trunk prefix: 0
     Austria         AT  +43   trunk prefix: 0
     Italy           IT  +39   trunk prefix: none (the 0 is kept)
     Japan           JP  +81   trunk prefix: 0
     Denmark         DK  +45   trunk prefix: none
     Mexico          MX  +52   trunk prefix: none
Appendix A — nicknames and the formal given name they stand for:
   Bob/Rob/Bobby = Robert; Gisi = Gisela; Pepe = José`;

test('parseDate reads every written form and refuses to guess an unknown numeric order', () => {
  assert.equal(W.parseDate('03/02/1958', { order: 'dmy' }), '1958-02-03');
  assert.equal(W.parseDate('03/02/1958', { order: 'mdy' }), '1958-03-02');
  assert.equal(W.parseDate('03/02/1958'), null);
  assert.equal(W.parseDate('6.10.1972', { order: 'dmy' }), '1972-10-06');
  assert.equal(W.parseDate('21-Dec-58'), '1958-12-21');
  assert.equal(W.parseDate('11-Jul-68'), '1968-07-11');
  assert.equal(W.parseDate('25 Mar 1985'), '1985-03-25');
  assert.equal(W.parseDate('the 27th of April 1996'), '1996-04-27');
  assert.equal(W.parseDate('June 12th, 1957'), '1957-06-12');
  assert.equal(W.parseDate('November 23, 2022', { century: 2000 }), '2022-11-23');
  assert.equal(W.parseDate('5/1/52', { order: 'mdy' }), '1952-05-01');
  assert.equal(W.parseDate('S31.07.24'), '1956-07-24');
  assert.equal(W.parseDate('H3.11.20'), '1991-11-20');
  assert.equal(W.parseDate('1966/12/11'), '1966-12-11');
  assert.equal(W.parseDate('2020-07-04T11:02:34Z'), '2020-07-04');
  for (const p of ['', 'n/a', 'n/k', '?', 'TBD', '—', '00/00/0000', '00.00.0000', '----/--/--']) assert.equal(W.parseDate(p, { order: 'dmy' }), null, p);
  assert.equal(W.parseDate('31/02/1990', { order: 'dmy' }), null);
});

test('orderFromExample derives the order from an example and its meaning', () => {
  assert.equal(W.orderFromExample('03/02/1958', '3 February 1958'), 'dmy');
  assert.equal(W.orderFromExample('dob=10/09/1991', 'September'), 'dmy');
  assert.equal(W.orderFromExample('10/05/2021', 'October 5, 2021'), 'mdy');
  assert.equal(W.orderFromExample('11/03/2021', 'November'), 'mdy');
  assert.equal(W.orderFromExample('05/05/2021', 'May'), null);
  assert.equal(W.orderFromExample(null, 'May'), null);
});

test('money: printed sign markers, German numbers, currencies', () => {
  assert.deepEqual(W.parseMoney('-$7,667.41', { currency: 'USD' }), { value: -7667.41, currency: 'USD' });
  assert.deepEqual(W.parseMoney('($3,103.87)', { currency: 'USD' }), { value: -3103.87, currency: 'USD' });
  assert.deepEqual(W.parseMoney('717.05 USD', { currency: 'USD' }), { value: 717.05, currency: 'USD' });
  assert.deepEqual(W.parseMoney('537,11- EUR', { german: true, currency: 'EUR' }), { value: -537.11, currency: 'EUR' });
  assert.deepEqual(W.parseMoney('-1.365,81 €', { german: true, currency: 'EUR' }), { value: -1365.81, currency: 'EUR' });
  assert.deepEqual(W.parseMoney('51.455,00- €', { german: true }), { value: -51455, currency: 'EUR' });
  assert.deepEqual(W.parseMoney('362,03- CHF', { german: true, currency: 'EUR' }), { value: -362.03, currency: 'CHF' });
  assert.deepEqual(W.parseMoney('£586.00 CR', { currency: 'GBP' }), { value: -586, currency: 'GBP' });
  assert.deepEqual(W.parseMoney('GBP 1,408.00', { currency: 'GBP' }), { value: 1408, currency: 'GBP' });
  assert.deepEqual(W.parseMoney('▲2,101,323円', { currency: 'JPY' }), { value: -2101323, currency: 'JPY' });
  assert.deepEqual(W.parseMoney('JPY 2090332', { currency: 'JPY' }), { value: 2090332, currency: 'JPY' });
  assert.deepEqual(W.parseMoney('-¥145,000', { currency: 'JPY' }), { value: -145000, currency: 'JPY' });
  for (const p of ['', 'n/a', 'TBD', '—']) assert.equal(W.parseMoney(p, { currency: 'USD' }), null);
});

test('VENDEX balances: number words, currency words, direction keywords', () => {
  assert.deepEqual(W.parseVendexMoney('in credit by two hundred thirty-five euros and sixteen cents'), { value: 235.16, currency: 'EUR' });
  assert.deepEqual(W.parseVendexMoney('balance due fifty-three thousand dollars'), { value: 53000, currency: 'USD' });
  assert.deepEqual(W.parseVendexMoney('owes us fifty-four hundred euros'), { value: 5400, currency: 'EUR' });
  assert.deepEqual(W.parseVendexMoney('open balance twenty-three pounds sterling and two pence'), { value: 23.02, currency: 'GBP' });
  assert.deepEqual(W.parseVendexMoney('Owes us fifty-eight US dollars and forty-three cents'), { value: 58.43, currency: 'USD' });
  assert.deepEqual(W.parseVendexMoney('Balance due USD 50,042.72'), { value: 50042.72, currency: 'USD' });
  assert.deepEqual(W.parseVendexMoney('Outstanding eleven thousand nine hundred ten dollars and forty-eight cents'), { value: 11910.48, currency: 'USD' });
  assert.equal(W.parseVendexMoney('Balance not recorded'), null);
  assert.equal(W.vendexDirection('in credit by USD 1,000.00'), 'credit');
  assert.equal(W.vendexDirection('We owe them USD 238.00'), 'credit');
  assert.equal(W.vendexDirection('holding a credit of thirty-four pounds'), 'credit');
  assert.equal(W.vendexDirection('Open balance EUR 677.03'), 'owed_to_us');
  assert.equal(W.vendexDirection('outstanding GBP 443.06'), 'owed_to_us');
  assert.equal(W.vendexDirection('EUR 5.00'), null);
  assert.equal(W.wordsToNumber('sixteen hundred'), 1600);
  assert.equal(W.wordsToNumber('three thousand two hundred thirty-three'), 3233);
  assert.equal(W.wordsToNumber('banana'), null);
});

test('alignSpan keeps verbatim spans and re-anchors a miscopied word to the entry text', () => {
  const line = 'Vendex 9109 — Entry revised 27 October 2024: Gisi Jäger (Kelowna), born 11/03/1947, phone 1-514-555-0135, open balance one thousand eight hundred eighty-six dollars and thirty-three cents.';
  assert.equal(W.alignSpan('11/03/1947', line), '11/03/1947');
  assert.equal(W.alignSpan('open balance one thousand eight hundred eighty-three dollars and thirty-three cents', line),
    'open balance one thousand eight hundred eighty-six dollars and thirty-three cents');
  assert.equal(W.alignSpan('completely invented text that is not there at all', line), null);
  assert.equal(W.alignSpan(null, line), null);
});

test('splitName handles every structured name form', () => {
  assert.deepEqual(W.splitName('Dr Anthony ROWNTREE', 'caps'), { given: 'Anthony', family: 'ROWNTREE' });
  assert.deepEqual(W.splitName('Piet VAN DER MEER', 'caps'), { given: 'Piet', family: 'VAN DER MEER' });
  assert.deepEqual(W.splitName('Óscar IBÁÑEZ', 'caps'), { given: 'Óscar', family: 'IBÁÑEZ' });
  assert.deepEqual(W.splitName('Lowell, Theodore H.', 'comma'), { given: 'Theodore', family: 'Lowell' });
  assert.deepEqual(W.splitName('van der Meer, Piet', 'comma'), { given: 'Piet', family: 'van der Meer' });
  assert.deepEqual(W.splitName('IBÁÑEZ, Andrés (Dr.)'), { given: 'Andrés', family: 'IBÁÑEZ' });
  assert.deepEqual(W.splitName('Gaëlle D. Boucher'), { given: 'Gaëlle', family: 'Boucher' });
  assert.deepEqual(W.splitName('Prof. Óscar Ibáñez'), { given: 'Óscar', family: 'Ibáñez' });
  assert.deepEqual(W.splitName('Pieter van der Meer', 'givenFirst'), { given: 'Pieter', family: 'van der Meer' });
  assert.deepEqual(W.splitName('KOUNO Shouta', 'familyFirst'), { given: 'Shouta', family: 'KOUNO' });
  assert.deepEqual(W.splitName('Ms. Femke Visser', 'givenFirst'), { given: 'Femke', family: 'Visser' });
});

test('parseLine reads the five structured dialects and keeps VENDEX text without remarks', () => {
  const bd = W.parseLine('BRIGHTDESK row=1321 | name=Dr Anthony ROWNTREE | dob=4/8/1989 | country= | phone=+44 (0)7700 900196 | balance=-$7,667.41 | updated=2016-10-22 | stage=legacy');
  assert.equal(bd.row, 1321); assert.equal(bd.status, 'legacy'); assert.equal(bd.country, ''); assert.equal(bd.balance, '-$7,667.41');
  const le = W.parseLine('LEDGR;1890;Dreßler, Klaus;Herr Dr.;6.10.1972;Irland;+41 44 589 17 34;537,11- EUR;aktiv;07.01.2025');
  assert.equal(le.name, 'Dreßler, Klaus'); assert.equal(le.status, 'aktiv'); assert.equal(le.updated, '07.01.2025');
  const at = W.parseLine('ATLAS #2574 :: KÖHLER, Heike :: born 01/07/1969 :: Switzerland :: tel 044 590 78 47 :: owed £33,000.00 CR :: last change 22 Feb 2017 :: note: checked by AP team: not a DO NOT MIGRATE case');
  assert.equal(at.country, 'Switzerland'); assert.equal(at.status, null); assert.equal(at.memo, 'checked by AP team: not a DO NOT MIGRATE case');
  const at2 = W.parseLine('ATLAS #9057 :: NÚÑEZ, Andrés (Prof.) :: born n/k ::  :: tel +39 349 764 2333 :: owed £395.83 :: last change 19 May 2020 :: ARCHIVE');
  assert.equal(at2.country, ''); assert.equal(at2.status, 'ARCHIVE'); assert.equal(at2.dob, 'n/k');
  const ko = W.parseLine('KOBO/5753 member: SHIMIZU Daisuke | birth: H8.10.01 | tel: 090-3149-8706 | balance: 304,565円 | upd: 2017/02/26 | flag: SAMPLE');
  assert.equal(ko.name, 'SHIMIZU Daisuke'); assert.equal(ko.status, 'SAMPLE'); assert.equal(ko.updated, '2017/02/26');
  const ve = W.parseLine('VERITAS {"row":1960,"family":"Valdés","given":"Francisco","dob":"1969-08-03","country":"MX","msisdn":"525543757595","amount":"67833.59","ccy":"MXN","ts":"2022-06-14T19:49:43Z","env":"sandbox"}');
  assert.equal(ve.family, 'Valdés'); assert.equal(ve.status, 'sandbox'); assert.equal(ve.currency, 'MXN');
  const vx = W.parseLine('Vendex 9262 — Kathy Garrick (DOB 4/2/1999), based in the UK; open balance GBP 23.02. Entry revised 25 September 2023. Remark: Same person as row 8367 - please merge the two accounts.');
  assert.ok(!vx.text.includes('Remark')); assert.equal(vx.withdrawn, false);
  assert.equal(W.parseLine('Vendex 3587 — Jen Winslow (born June 2nd, 1998); outstanding two hundred six US dollars. Entry revised November 23, 2022. (Application withdrawn — never onboarded.)').withdrawn, true);
  assert.equal(W.parseLine('Vendex 8099 — Ms. Youko Outa, DOB May 15th, 1977. Revised on May 31, 2020. Remark: an earlier application was withdrawn in 2019; this one was onboarded').withdrawn, false);
});

test('toE164 applies prefixes, trunk rules and the BRIGHTDESK-only 011', () => {
  const { phones } = W.parseSpec({ spec: SPEC });
  assert.equal(W.toE164('+44 (0)7700 900196', { phones }), '+447700900196');
  assert.equal(W.toE164('011 1 856 555 0126', { system: 'BRIGHTDESK', phones }), '+18565550126');
  assert.equal(W.toE164('1-856-555-0126', { country: 'US', phones }), '+18565550126');
  assert.equal(W.toE164('06 6270 7056', { country: 'IT', phones }), '+390662707056');
  assert.equal(W.toE164('01/2263446', { country: 'AT', phones }), '+4312263446');
  assert.equal(W.toE164('090-3149-8706', { country: 'JP', phones }), '+819031498706');
  assert.equal(W.toE164('58 29 81 36', { country: 'DK', phones }), '+4558298136');
  assert.equal(W.toE164('525543757595', { international: true, phones }), '+525543757595');
  assert.equal(W.toE164('0000000', { country: 'GB', phones }), null);
  assert.equal(W.toE164('02 1234 5678', { country: null, phones }), null);
});

test('parseSpec reads rates, calling codes and nicknames', () => {
  const spec = W.parseSpec({ spec: SPEC });
  assert.deepEqual(spec.tables[0].rates.EUR, { op: 'mul', x: '1.1344' });
  assert.deepEqual(spec.tables[0].rates.JPY, { op: 'div', x: '145.4407' });
  assert.equal(spec.phones.IT.keepZero, true);
  assert.equal(spec.nick.gisi, 'Gisela');
  assert.equal(spec.nick.rob, 'Robert');
  assert.ok(spec.iso2.includes('MX'));
});

test('splitParagraphs and statusMention locate a status token in its system paragraph', () => {
  const notes = 'SOURCE NOTES — legacy systems\n\nGeneral: blank fields are missing.\n\nBRIGHTDESK. Lines look like ... Rows marked stage=hold are customers we still serve; keep them.\n\nLEDGR. Rows marked Status "Altdaten" are void.';
  const p = W.splitParagraphs(notes);
  assert.ok(p.GENERAL.includes('General'));
  assert.ok(p.BRIGHTDESK.includes(W.statusMention('BRIGHTDESK', 'hold')));
  assert.ok(p.LEDGR.includes(W.statusMention('LEDGR', 'Altdaten')));
  assert.equal(W.statusMention('VERITAS', 'batch'), '"env":"batch"');
});

test('exactCountry maps exact codes only', () => {
  const iso2 = ['US', 'GB', 'AT', 'AU', 'ES'];
  assert.equal(W.exactCountry('us', iso2), 'US');
  assert.equal(W.exactCountry('UK', iso2), 'GB');
  assert.equal(W.exactCountry('AUT', iso2), 'AT');
  assert.equal(W.exactCountry('AUS', iso2), 'AU');
  assert.equal(W.exactCountry('U.S.A.', iso2), 'US');
  assert.equal(W.exactCountry('Austria', iso2), null);
  assert.equal(W.exactCountry('GER', iso2), null);
});

const judged = v => ({ judge: v });
test('resolveConventions derives orders from examples, references and places, and reads the other conventions', () => {
  const dateItems = [{ system: 'BRIGHTDESK' }, { system: 'ATLAS' }, { system: 'VENDEX' }];
  const conv = W.resolveConventions({
    dateItems,
    dates: [judged({ basis: 'example', order: 'mdy', example_numeric: '10/09/1991', example_meaning: 'September' }),
      judged({ basis: 'same_as_system', order: 'mdy', same_as_system: 'LEDGR' }),
      judged({ basis: 'same_as_system', order: 'dmy', same_as_system: 'ATLAS' })],
    atlasSwitch: { present: true, switch_date: '17 January 2021', after: 'swapped', boundary: 'on_or_after' },
    statusItems: [{ system: 'LEDGR', token: 'Altdaten' }, { system: 'ATLAS', token: 'ARCHIVE' }],
    statuses: [judged({ meaning: 'void' }), judged({ meaning: 'live' })],
    mirrorItems: [{ system: 'BRIGHTDESK' }, { system: 'LEDGR' }, { system: 'VERITAS' }],
    mirror: [judged({ update_dates: 'real' }), judged({ update_dates: 'restamped' }), judged({ update_dates: 'not_stated' })],
    perspectiveItems: [{ system: 'BRIGHTDESK' }, { system: 'LEDGR' }, { system: 'ATLAS' }, { system: 'KOBO' }],
    perspective: [judged({ positive_in_master: 'negative' }), judged({ positive_in_master: 'positive' }), { $error: { code: 'X' } }, judged({ positive_in_master: 'positive' })],
  });
  assert.deepEqual(conv.orders, { BRIGHTDESK: 'dmy', ATLAS: 'dmy', VENDEX: 'dmy' });
  assert.ok(conv.diagnostics.some(d => d.includes('example gives dmy')));
  assert.deepEqual(conv.atlasCutoff, { from: '2021-01-17', inclusive: true, order: 'mdy' });
  assert.equal(conv.statusMeaning.LEDGR.Altdaten, 'void');
  assert.equal(conv.statusMeaning.LEDGR.storniert, 'void');
  assert.equal(conv.statusMeaning.ATLAS.ARCHIVE, 'live');
  assert.deepEqual(conv.mirror, ['LEDGR']);
  assert.equal(conv.flip.BRIGHTDESK, true);
  assert.equal(conv.flip.LEDGR, false);
  assert.ok(conv.diagnostics.some(d => d.includes('perspective ATLAS')));
  const place = W.resolveConventions({ dateItems, dates: [judged({ basis: 'explicit', order: 'mdy' }), judged({ basis: 'place', order: 'dmy', place: 'Denver', place_in_united_states: true }),
    judged({ basis: 'same_as_system', order: 'dmy', same_as_system: 'BRIGHTDESK' })], atlasSwitch: { present: false } });
  assert.deepEqual(place.orders, { BRIGHTDESK: 'mdy', ATLAS: 'mdy', VENDEX: 'mdy' });
});

test('resolveIdentities links by name+dob or name+phone, keeps namesakes and households apart, orders mirror rows last', () => {
  const spec = W.parseSpec({ spec: SPEC });
  const row = (row, o) => ({ row, system: 'X', void: false, given: '', family: '', dob: null, country: null, e164: null, money: null, updated: '', mirror: false, ...o });
  const recs = W.resolveIdentities([
    row(10, { given: 'Gisela', family: 'Jäger', dob: '1947-03-11', country: 'DE', money: { value: 100, currency: 'EUR' }, updated: '2020-01-01' }),
    row(11, { given: 'Gisi', family: 'Jaeger', dob: '1947-03-11', country: 'CA', e164: '+15145550135', money: { value: -50, currency: 'USD' }, updated: '2024-10-27' }),
    row(12, { given: 'Gisela', family: 'Jager', e164: '+15145550135', updated: '2010-01-01' }),
    row(13, { given: 'Gisela', family: 'Jäger', dob: '1947-11-03', updated: '2021-01-01' }),
    row(14, { given: 'Hans', family: 'Jäger', e164: '+15145550135', updated: '2021-01-01' }),
    row(15, { given: 'Gisela', family: 'Jäger', dob: '1947-03-11', country: 'AT', money: { value: 7, currency: 'GBP' }, updated: '2025-01-01', mirror: true }),
    row(16, { given: 'Gisela', family: 'Jäger', dob: '1947-03-11', void: true, updated: '2026-01-01' }),
  ], spec);
  const g = recs.find(r => r.entity_id === 10);
  assert.deepEqual(g.source_rows, [10, 11, 12, 15]);
  assert.equal(g.given_name, 'Gisela'); assert.equal(g.family_name, 'Jäger');
  assert.equal(g.country, 'CA');
  assert.equal(g.amount_usd, -50);
  assert.equal(g.phone_e164, '+15145550135');
  assert.ok(recs.some(r => r.entity_id === 13 && r.source_rows.length === 1));
  assert.ok(recs.some(r => r.entity_id === 14 && r.source_rows.length === 1));
  assert.ok(!recs.some(r => r.source_rows.includes(16)));
});

test('FX conversion is exact with half-away-from-zero rounding', () => {
  const spec = W.parseSpec({ spec: SPEC });
  const one = money => W.resolveIdentities([{ row: 1, system: 'X', void: false, given: 'A', family: 'B', dob: '2000-01-01', money, updated: '2020-01-01', mirror: false }], spec)[0].amount_usd;
  assert.equal(one({ value: 100, currency: 'EUR' }), 113.44);
  assert.equal(one({ value: -586, currency: 'GBP' }), -748.62);
  assert.equal(one({ value: 2090332, currency: 'JPY' }), 14372.4);
  assert.equal(one({ value: 362.03, currency: 'CHF' }), 414.17);
  assert.equal(one({ value: 0.005, currency: 'USD' }), 0.01);
});

test('verifyMain flags structural problems and non-verbatim VENDEX spans', () => {
  const ok = W.verifyMain({ subject: { answer: { records: [{ entity_id: 1, source_rows: [1, 2], given_name: 'A', family_name: 'B', birth_date: '2000-01-01', country: 'US', phone_e164: '+15550100', amount_usd: 1 }] },
    rowIds: [1, 2, 3], voided: [3], vendexRead: [], vendexLines: [] } });
  assert.equal(ok.pass, true);
  const bad = W.verifyMain({ subject: { answer: { records: [{ entity_id: 2, source_rows: [1, 2], given_name: 'A', family_name: 'B', birth_date: '2000-1-1', country: 'us', phone_e164: '+1', amount_usd: 1 },
    { entity_id: 3, source_rows: [3], given_name: 'C', family_name: 'D', birth_date: null, country: null, phone_e164: null, amount_usd: null }] },
    rowIds: [1, 2, 3, 4], voided: [3], vendexRead: [{ row: 4, name: 'Zed Qy' }], vendexLines: [{ row: 4, text: 'Vendex 4 — Zed Quux' }] } });
  assert.equal(bad.pass, false);
  for (const needle of ['not its smallest row', 'bad birth date', 'bad phone', 'bad country', 'row 4 neither void nor merged', 'void row 3 merged', 'vendex 4 name not verbatim'])
    assert.ok(bad.reasons.some(r => r.includes(needle)), needle);
});

test('the workflow builds with every per-task convention behind a model node and every code node self-contained', () => {
  const wf = W.buildRecordsV3Workflow({ extractModelClass: 'M', conventionsModelClass: 'L', maxClass: 'L' });
  const byId = new Map(wf.nodes.map(n => [n.id, n]));
  for (const id of ['dates', 'statuses', 'mirror', 'perspective', 'vendex', 'countries']) assert.equal(byId.get(id).body.nodes[0].kind, 'agent', id);
  assert.equal(byId.get('atlas_switch').kind, 'agent');
  assert.equal(byId.get('dates').body.nodes[0].model.class, 'L');
  assert.equal(byId.get('vendex').body.nodes[0].model.class, 'M');
  assert.equal(byId.get('dates').body.nodes[0].decoding.reasoning, 'none');
  for (const n of wf.nodes.filter(x => x.kind === 'code' || x.kind === 'verify')) {
    assert.match(n.source, /export default/);
    assert.ok(!/\bimport\b/.test(n.source.replace(/importance/g, '')), `${n.id} imports`);
  }
  assert.equal(byId.get('answer').needs.includes('check'), true);
  // No convention value is hard-coded in the code nodes: the per-task tokens never appear in node sources.
  const code = wf.nodes.filter(x => x.source).map(x => x.source).join('\n');
  for (const tok of ['Altdaten', 'ARCHIVE', 'backfill', 'legacy', 'Dublin']) assert.ok(!code.includes(tok), tok);
});
