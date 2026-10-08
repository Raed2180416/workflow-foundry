// Placeholder filling and typed-question instantiation for authored units (JUDGE-PROGRAM.md §2.3
// rule 1: "asked the port question zero-shot"). Deterministic: the same unit and salt give the same
// filling. Used by the two-model filter (filter.mjs), the local self-checks and any consumer that
// wants a concrete state from a pool unit. Written from the contracts only; fillings are neutral
// stand-ins (they carry no template or truth information).
import { createHash } from 'node:crypto';
import { COUNTRIES, COUNTRY_ORDER } from './gazetteer.mjs';
import { judgmentRequest } from '../judges/kit.mjs';
import { placeholdersOf } from './pools.mjs';

export const pickIndex = (key, n) => parseInt(createHash('sha256').update(String(key)).digest('hex').slice(0, 8), 16) % n;
export const pick = (list, key) => list[pickIndex(key, list.length)];

// Marker stand-ins: opaque, so the line (not the token's word) carries the meaning.
export const NEUTRAL_TOKENS = Object.freeze(['QX7', 'ZR-4', 'T9', 'k_22', '#K4', 'BRAVO3', 'mx11', 'L-77', 'Q-0', 'vv3', 'N4', 'R12', 'oz5', 'JJ-8']);
export const WINDOWS = Object.freeze([['2023-02-01', '2023-03-15'], ['14 March 2022', '2 May 2022'], ['2021-06-30', '2021-07-18'], ['11/2022', '12/2022'], ['1 Sept 2020', '19 Oct 2020'], ['2024-01-08', '2024-02-23']]);
export const UPDATE_FIELDS = Object.freeze(['updated', 'Geändert', 'last change', 'revision', 'upd', 'ts']);
export const SOURCE_KIND_NAMES = Object.freeze({ log: 'log line', ticket: 'ticket comment', doc: 'document', memo: 'memo', chat: 'chat message', email: 'email', cell: 'table cell',
  commit: 'commit message', comment: 'code comment', readme: 'README', form: 'form field', review: 'review comment', journal: 'lab journal entry', post: 'forum post' });

export function slotsFor(unit, { cities = [], salt = '', order: orderOverride = null } = {}) {
  const key = `${unit.id}:${salt}`, systems = unit.systems?.length ? unit.systems : ['ATLAS'];
  const S = pick(systems, `${key}:S`);
  const others = ['BRIGHTDESK', 'ATLAS', 'VENDEX', 'LEDGR', 'KOBO', 'VERITAS'].filter(s => s !== S);
  const [w0, w1] = pick(WINDOWS, `${key}:w`);
  const slots = { S, S2: pick(others, `${key}:S2`), token: pick(NEUTRAL_TOKENS, `${key}:t`), w0, w1, field: pick(UPDATE_FIELDS, `${key}:f`) };
  const order = orderOverride ?? (unit.label === 'dmy' || unit.label === 'mdy' ? unit.label : (unit.tagMap?.V === 'dmy' || unit.tagMap?.V === 'mdy' ? unit.tagMap.V : null));
  if (placeholdersOf(unit.text ?? '').some(p => p === 'city' || p === 'country')) {
    const pool = cities.filter(c => c.order === order);
    if (pool.length) { const c = pick(pool, `${key}:c`); slots.city = c.city; slots.country = COUNTRIES[c.cc]; }
  }
  return slots;
}
export const fillText = (text, slots) => String(text).replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, n) => (slots[n] ?? m));

// Typed requests for the two-model filter (one per question to ask): [{id, expect, mode, request}].
// `request` is the JudgmentPort request built from the frozen contract through the port-kit
// interface (Q0 wording), so a provider sees exactly what a served port would.
export function filterRequests(unit, contracts, { cities = [], salt = '' } = {}) {
  const port = unit.port, slots = slotsFor(unit, { cities, salt }), role = unit.role ?? 'decisive';
  const mk = (portId, state, extra = {}, wslots = {}) => judgmentRequest(contracts[portId], { state, slots: wslots, wording: 'Q0', ...extra });
  const out = [];
  if (role === 'nondeciding') {
    const text = fillText(unit.text, slots);
    const state = port === 'R2' ? { system: slots.S, marker: slots.token, source_note: text } : { system: slots.S, source_note: text };
    out.push({ id: unit.id, expect: null, mode: 'nondeciding', request: mk(port, state, {}, port === 'R2' ? { system: slots.S, value: slots.token } : { system: slots.S }) });
    return out;
  }
  if (role === 'knowledge') {
    for (const order of unit.labels) {
      const sl = slotsFor(unit, { cities, salt, order });
      out.push({ id: `${unit.id}:${order}`, expect: order, mode: 'label', request: mk(port, { system: sl.S, source_note: fillText(unit.text, sl) }, {}, { system: sl.S }) });
    }
  } else if (['R1', 'R3', 'R4'].includes(port)) {
    out.push({ id: unit.id, expect: unit.label, mode: 'label', request: mk(port, { system: slots.S, source_note: fillText(unit.text, slots) }, {}, { system: slots.S }) });
  } else if (port === 'R2') {
    out.push({ id: unit.id, expect: unit.label, mode: 'label', request: mk(port, { system: slots.S, marker: slots.token, source_note: fillText(unit.text, slots) }, {}, { system: slots.S, value: slots.token }) });
  } else if (port === 'X1') {
    out.push({ id: unit.id, expect: unit.label, mode: 'label', request: mk(port, { source_kind: SOURCE_KIND_NAMES[unit.tagMap?.k] ?? 'document', text: unit.text }) });
  } else if (port === 'X5') {
    const t = slotsFor({ ...unit, id: unit.pairId ?? unit.id }, { salt });
    out.push({ id: unit.id, expect: unit.label, mode: 'label', request: mk(port, { source_text: fillText(unit.text, t) }, {}, { assumption: fillText(unit.assumption, t) }) });
  } else if (port === 'X8') {
    for (const it of unit.items) {
      out.push({ id: `${unit.id}:${it.label}`, expect: it.label, mode: 'label', request: mk(port, { source_line: it.source_line, conventions: it.conventions, field: it.field, extracted_value: it.extracted_value }) });
    }
  } else if (port === 'S5') {
    out.push({ id: unit.id, expect: unit.label, mode: 'label', request: mk(port, { type_label: unit.type_label, venue: unit.venue, title: unit.title }) });
  } else if (port === 'Q2') {
    out.push({ id: unit.id, expect: unit.label, mode: 'label', request: mk(port, { container_text: unit.text }) });
  } else throw new Error(`filterRequests: no instantiation for ${port}`);
  return out;
}
