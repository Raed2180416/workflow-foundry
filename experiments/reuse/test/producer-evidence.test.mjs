// The producer held to the consumer's rule (review finding 7): M3 on the reused entry's training evidence and on its
// sealed SOP-Bench evidence, with the hash chain from the registry entry to the sealed summary checked. $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { ENTRY_FILE, P2_FREEZE, P2_SEALED_SUMMARY, m3OnRows, producerEvidence } from '../producer-evidence.mjs';
import { readJson } from '../lib.mjs';

test('M3 on independent rows: 20 clean training rows cannot serve (minimum 60); 248 of 254 serves; 14 wrong of 254 does not', () => {
  const t = m3OnRows(20, 0);
  assert.equal(t.decision, 'no-decision');
  assert.ok(t.upper > 0.13 && t.upper < 0.14, `upper ${t.upper}`);
  const s = m3OnRows(254, 6);
  assert.equal(s.decision, 'serve');
  assert.ok(s.upper < 0.05 && s.upper > 0.045, `upper ${s.upper}`);
  assert.notEqual(m3OnRows(254, 14).decision, 'serve');
  assert.throws(() => m3OnRows(10, 11), /bad counts/);
});

const HAVE = [ENTRY_FILE, P2_FREEZE, P2_SEALED_SUMMARY].every(existsSync);
test('the reused entry: training evidence no-decision, sealed evidence serve, and a broken hash chain refuses', { skip: !HAVE && 'missing entry, FREEZE-p2 or the sealed summary' }, () => {
  const entry = readJson(ENTRY_FILE), freezeText = readFileSync(P2_FREEZE, 'utf8'), summary = readJson(P2_SEALED_SUMMARY);
  const ev = producerEvidence({ entry, freezeText, summary });
  assert.equal(ev.chain.ok, true);
  assert.equal(ev.training.heldOut, false);
  assert.equal(ev.training.decision, 'no-decision');
  assert.deepEqual([ev.sealed.rows, ev.sealed.wrong, ev.sealed.k, ev.sealed.decision], [254, 6, 3, 'serve']);
  // Teeth: a different artifact in the entry, or a freeze file that is not the one the summary names, breaks the chain.
  assert.throws(() => producerEvidence({ entry: { ...entry, artifact: { ...entry.artifact, sha256: '0'.repeat(64) } }, freezeText, summary }), /hash chain broken/);
  assert.throws(() => producerEvidence({ entry, freezeText: freezeText.replace('"dangerous_goods"', '"dangerous_goods" '), summary }), /hash chain broken/);
});
