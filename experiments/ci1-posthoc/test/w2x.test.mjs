// Wave-2 post hoc sensitivity transforms (rescore-w2x.mjs): each removes exactly the one distinction its root-cause names, on both
// sides, and keeps the oracle's teeth for everything else (a different day, a missing date in a cancel message, a real leak).
import test from 'node:test';
import assert from 'node:assert/strict';
import { W2X, transformed, withoutCategoricalWords } from '../rescore-w2x.mjs';
import { equivalentV2, rowIdentitiesWithAddresses } from '../oracle-v2.mjs';

const canon = (over = {}) => ({ ok: true, mail: [], chat: [], respond: [], sheets: {}, ...over });

test('every transform is declared with a kind and a reason', () => {
  for (const [id, ts] of Object.entries(W2X)) for (const t of ts) { assert.ok(['oracle', 'ambiguous'].includes(t.kind), id); assert.ok(t.why.length > 60, id); assert.ok(t.apply || t.world, id); }
  assert.equal(Object.values(W2X).flat().length, 8);
});

test('19187: an Evaluation Date written as the day matches the reference date-time of that day, not of another day', () => {
  const ref = canon({ sheets: { 'evaluation-log': [{ 'Evaluation Date': '2026-07-12T08:47:00.000Z', x: 1 }] } });
  const same = canon({ sheets: { 'evaluation-log': [{ 'Evaluation Date': '2026-07-12', x: 1 }] } });
  const other = canon({ sheets: { 'evaluation-log': [{ 'Evaluation Date': '2026-07-13', x: 1 }] } });
  const decl = { vocab: new Set() };
  assert.equal(equivalentV2(ref, same, decl).pass, false, 'the frozen verdict');
  let t = transformed('19187', ref, same, {}); assert.equal(equivalentV2(t.r, t.c, decl).pass, true);
  t = transformed('19187', ref, other, {}); assert.equal(equivalentV2(t.r, t.c, decl).pass, false);
});

test('20090: a cancel message need not repeat the appointment ID but must still give the date and time', () => {
  const vocab = new Set(['appointment', 'on', 'at', 'has', 'been', 'cancelled']);
  const body = m => ({ success: true, status: 'cancelled', appointment_id: 'APT-47950', message: m });
  const ref = canon({ respond: [{ code: 200, body: body('Appointment APT-47950 on 2026-08-31 at 10:30 has been cancelled.') }] });
  const noId = canon({ respond: [{ code: 200, body: body('Appointment on 2026-08-31 at 10:30 has been cancelled.') }] });
  const noDate = canon({ respond: [{ code: 200, body: body('Appointment APT-47950 has been cancelled, see you soon.') }] });
  let t = transformed('20090', ref, noId, {}); assert.equal(equivalentV2(t.r, t.c, { vocab }).pass, true);
  t = transformed('20090', ref, noDate, {}); assert.equal(equivalentV2(t.r, t.c, { vocab }).pass, false);
});

test('18797: a word shared by a categorical cell and another row no longer identifies that row; other identities stay', () => {
  const world = { sheets: { invoices: { rows: [
    { id: 'INV-1', client: 'Pavel Rothwell', email: 'pavel.rothwell@x.example', Owner: 'Ingrid Dunmore' },
    { id: 'INV-2', client: 'Mateo Lorrimer', email: 'mateo.lorrimer@x.example', Owner: 'Pavel Okonkwo' },
    { id: 'INV-3', client: 'Ingrid Yarrow', email: 'ingrid.yarrow@x.example', Owner: 'Pavel Okonkwo' } ] } } };
  const cat = ['invoices|Owner'];
  const before = rowIdentitiesWithAddresses(world, new Set(), new Set(cat));
  const after = rowIdentitiesWithAddresses(withoutCategoricalWords(world, cat), new Set(), new Set(cat));
  assert.ok(before.some(r => r.ids.includes('pavel')), 'the collision this transform removes');
  assert.ok(!after.some(r => r.ids.includes('pavel') || r.ids.includes('ingrid')));
  assert.ok(after.some(r => r.ids.includes('inv-1')) && after.some(r => r.ids.includes('rothwell')), 'ids and surnames still identify rows');
});

test('17175 and 19014: the apostrophe and the duplicate clientId are the only distinctions removed', () => {
  const r17175 = canon({ respond: [{ code: 200, body: { phone: "'+391234567", email: 'a@b.example' } }] });
  let t = transformed('17175', r17175, canon({ respond: [{ code: 200, body: { phone: '+391234567', email: 'a@b.example' } }] }), {});
  assert.equal(equivalentV2(t.r, t.c, {}).pass, true);
  t = transformed('17175', r17175, canon({ respond: [{ code: 200, body: { phone: '+391234568', email: 'a@b.example' } }] }), {});
  assert.equal(equivalentV2(t.r, t.c, {}).pass, false);
  const dup = id => canon({ respond: [{ code: 200, body: { accepted: false, duplicateFound: true, clientId: id, projectId: 'PR-X-1' } }] });
  t = transformed('19014', dup('CL-NEW-1'), dup('CL-OLD-9'), { sheets: {} }); assert.equal(equivalentV2(t.r, t.c, {}).pass, true);
  const acc = id => canon({ respond: [{ code: 200, body: { accepted: true, clientId: id, projectId: 'PR-X-1' } }] });
  t = transformed('19014', acc('CL-NEW-1'), acc('CL-OLD-9'), { sheets: {} }); assert.equal(equivalentV2(t.r, t.c, {}).pass, false, 'only the duplicate answer');
});
