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

// The status words, and the chip each one gets on the claims page (app/site/public/components/ui.js statusOf). Honesty review M5: a
// result from a research test bed or the literature is not "Works now", and a claim whose qualifier says it was not re-run is not either.
const STATUSES = ['Works now', 'Preview', 'Not re-tested', 'Planned', 'Not decided', 'Decided', 'Limit', 'Research result', 'Literature'];
test('every claim has a status, an evidence label, a date and a source file under research/', () => {
  for (const [id, c] of Object.entries(claims)) {
    assert.ok(STATUSES.includes(c.status), `${id} status`);
    assert.ok(['development', 'design', 'decided', 'documentation', 'literature'].includes(c.evidence), `${id} evidence`);
    assert.match(c.date, /^\d{4}-\d{2}-\d{2}$/, `${id} date`);
    assert.ok(c.source.path.startsWith('research/'), `${id} source is under research/`);
    assert.ok(existsSync(path.join(ROOT, c.source.path)), `${id}: ${c.source.path} exists`);
  }
});

// Honesty review M11: a number must appear within the lines the claim cites, not anywhere in a long file, and the qualifier's numbers
// count too. Every claim cites lines (source.lines: [[from, to], ...], plus source.also for a second file) and a short verbatim quote
// (source.quote) that must be found in those lines, so a citation that drifts when its file is edited fails here instead of pointing at
// the wrong text (C03 pointed one table row off after DESIGN.md grew).
const numbersIn = text => (String(text ?? '').replace(/(\d),(\d{3})/g, '$1$2').replace(/\b(19|20)\d\d-\d\d-\d\d\b/g, '').match(/\d+(\.\d+)?/g) ?? []);
const flat = s => s.replace(/\s+/g, ' ');
export const sourcesOf = c => [c.source, ...(c.source.also ?? [])];
/** The text of one source's cited lines (thousands separators removed). */
export function linesOf(src) {
  const lines = readFileSync(path.join(ROOT, src.path), 'utf8').split('\n');
  return (src.lines ?? []).map(([from, to]) => lines.slice(from - 1, to).join('\n')).join('\n').replace(/(\d),(\d{3})/g, '$1$2');
}
/** Every cited line of a claim, across its sources. */
export const citedText = c => sourcesOf(c).map(linesOf).join('\n');
test('every claim cites lines in each source file, and its quote is found in them', () => {
  for (const [id, c] of Object.entries(claims)) {
    for (const src of sourcesOf(c)) {
      assert.ok(src.path?.startsWith('research/') && existsSync(path.join(ROOT, src.path)), `${id}: ${src.path} is a file under research/`);
      const length = readFileSync(path.join(ROOT, src.path), 'utf8').split('\n').length;
      assert.ok(Array.isArray(src.lines) && src.lines.length && src.lines.every(([a, b]) => Number.isInteger(a) && Number.isInteger(b) && a >= 1 && a <= b && b <= length), `${id}: ${src.path} cites lines within the file`);
      assert.ok(typeof src.quote === 'string' && src.quote.length >= 8, `${id}: ${src.path} gives a quote`);
      assert.ok(flat(linesOf(src)).includes(flat(src.quote.replace(/(\d),(\d{3})/g, '$1$2'))), `${id}: "${src.quote}" is not in ${src.path} lines ${JSON.stringify(src.lines)}`);
    }
  }
});
test('every number in a claim and its qualifier appears within the lines it cites (thousands separators removed)', () => {
  for (const [id, c] of Object.entries(claims)) {
    const cited = citedText(c);
    for (const n of [...numbersIn(c.text), ...numbersIn(c.qualifier)]) assert.match(cited, new RegExp(`(^|[^\\d.])${n.replace('.', '\\.')}(?![\\d])`), `${id}: ${n} is not in the lines it cites`);
  }
});

test('the line check has teeth: a number from elsewhere in the same file, or a changed number, is not accepted', () => {
  const c = structuredClone(claims.C04);
  assert.match(citedText(c), /7\.63/);
  const elsewhere = { ...c, source: { ...c.source, lines: [[80, 80]] } };
  assert.doesNotMatch(citedText(elsewhere), /7\.63/, 'line 80 of the source does not hold the Opus cost');
  assert.doesNotMatch(citedText(c), /(^|[^\d.])7\.36(?![\d])/, 'a changed number is not in the cited lines');
  // A citation that drifts by one row no longer holds its quote (the test above then fails for that claim).
  const drifted = { ...claims.C03.source, lines: [[claims.C03.source.lines[0][0] - 1, claims.C03.source.lines[0][1] - 1]] };
  assert.equal(flat(linesOf(drifted)).includes(claims.C03.source.quote), false);
});
