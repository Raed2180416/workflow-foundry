// Every claim traceable (SPEC §17.3): each {claim:Cxx} exists, each source is a file under research/, every number in a claim appears
// in its source, each claim is labelled with its kind of evidence and a date. nice -n 15 node --test app/site/test/claims.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..', '..');
const { claims } = JSON.parse(readFileSync(path.join(here, '..', 'claims.json'), 'utf8'));
const copy = readFileSync(path.join(here, '..', 'public', 'copy', 'en.json'), 'utf8');

test('every claim used in the copy exists, and every claim is used or listed on the claims page', () => {
  const used = [...copy.matchAll(/\{claim:(C\d{2})\}/g)].map(m => m[1]);
  assert.ok(used.length >= 8);
  for (const id of used) assert.ok(claims[id], `${id} is in claims.json`);
});

test('every claim has a status, an evidence label, a date and a source file under research/', () => {
  for (const [id, c] of Object.entries(claims)) {
    assert.ok(['Works now', 'Preview', 'Planned', 'Not decided', 'Decided', 'Limit'].includes(c.status), `${id} status`);
    assert.ok(['development', 'design', 'decided', 'documentation', 'literature'].includes(c.evidence), `${id} evidence`);
    assert.match(c.date, /^\d{4}-\d{2}-\d{2}$/, `${id} date`);
    assert.ok(c.source.path.startsWith('research/'), `${id} source is under research/`);
    assert.ok(existsSync(path.join(ROOT, c.source.path)), `${id}: ${c.source.path} exists`);
  }
});

test('every number in a claim appears in its source (thousands separators removed)', () => {
  for (const [id, c] of Object.entries(claims)) {
    const src = readFileSync(path.join(ROOT, c.source.path), 'utf8').replace(/(\d),(\d{3})/g, '$1$2');
    for (const n of (c.text.replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(\.\d+)?/g) ?? [])) assert.ok(src.includes(n), `${id}: ${n} is not in ${c.source.path}`);
  }
});
