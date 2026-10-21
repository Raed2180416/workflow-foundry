// Copy lint (SPEC §3 R2/R7/R8, §17.3): one copy file; no promises the product can't keep; numbers only from claims, data or a short
// chrome allowlist; operator words stay plain; every key the pages use exists; every question control carries its harm class.
// nice -n 15 node --test app/site/test/copy-lint.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', 'public');
const copy = JSON.parse(readFileSync(path.join(PUBLIC, 'copy', 'en.json'), 'utf8'));
const strings = (v, at = '') => typeof v === 'string' ? [[at, v]] : Array.isArray(v) ? v.flatMap((x, i) => strings(x, `${at}[${i}]`)) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => strings(x, at ? `${at}.${k}` : k)) : [];
const all = strings(copy).filter(([k]) => k !== '_note');
const sources = ['site.js', ...readdirSync(path.join(PUBLIC, 'components')).map(f => `components/${f}`), ...readdirSync(path.join(PUBLIC, 'views')).map(f => `views/${f}`)]
  .map(f => [f, readFileSync(path.join(PUBLIC, f), 'utf8')]);

test('no phrase the product cannot back', () => {
  const banned = ['works with gmail', 'set it and forget it', 'runs automatically', 'soc 2', 'enterprise-grade', 'for anyone', 'beats', 'guarantee', 'fully secure', 'maria approved', 'approved by maria', 'seamless', 'effortless'];
  for (const [k, v] of all) for (const b of banned) assert.equal(v.toLowerCase().includes(b), false, `${k}: "${b}"`);
});

test('numbers come from claims or data; only a short chrome allowlist is written into the copy', () => {
  const ALLOW = ['127.0.0.1', 'Node 24', '30 days', 'n8n', 'Mercury 3', 'Haiku 5.5']; // addresses, product names and the pilot length
  for (const [k, v] of all) {
    let rest = v.replace(/\{claim:C\d{2}\}/g, '').replace(/\{[a-zA-Z0-9_]+\}/g, '');
    for (const a of ALLOW) rest = rest.split(a).join('');
    assert.equal(/\d/.test(rest), false, `${k} has a number written into the copy: ${v}`);
  }
});

test('operator pages stay in plain words; precise words only in developer and IT sections (R8)', () => {
  const PRECISE = /\bMCP\b|webhook|token cap|\bIR\b|\bhash\b|Control Plane|\bflow\b|\bproposal\b|activation|stand-in/i;
  const DEV = /^(connect|trust\.allowlist|glossary|docs\.dev|docs\.data|run\.chainHead|automation\.fingerprint|connections\.items\.(claudeCode|cursor|codex|plugin))/;
  for (const [k, v] of all) if (!DEV.test(k)) assert.equal(PRECISE.test(v.replace(/\{[a-zA-Z0-9_:]+\}/g, '')), false, `${k} uses a precise word on an operator surface: ${v}`);
});

test('every copy key a page uses exists', () => {
  const get = k => k.split('.').reduce((o, x) => (o && typeof o === 'object' ? o[x] : undefined), copy);
  for (const [f, src] of sources) for (const m of src.matchAll(/\b(?:t|rich|raw|precise)\(\s*'([a-zA-Z0-9_.-]+)'/g)) assert.notEqual(get(m[1]), undefined, `${f}: ${m[1]}`);
  for (const m of readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').matchAll(/data-copy="([^"]+)"/g)) assert.notEqual(get(m[1]), undefined, m[1]);
});

test('every question control carries its harm class (R2): ask fields, data questions, list addresses, the exact-list yes', () => {
  const ui = sources.find(([f]) => f === 'components/ui.js')[1];
  assert.match(ui, /input\.dataset\.ask = harm \?\? 'ask'/, 'askField always sets data-ask');
  assert.match(ui, /dataset: \{ ask: q\.harm \}/, 'data questions carry their harm class');
  assert.match(ui, /dataset: \{ ask: 'irreversible', action: 'batch-approve' \}/);
  for (const [f, src] of sources.filter(([f]) => f.startsWith('views/'))) for (const m of src.matchAll(/askField\(\{([^}]*)\}/g)) assert.match(m[1], /harm/, `${f}: askField without harm`);
  assert.match(sources.find(([f]) => f === 'views/make.js')[1], /input\.dataset\.ask = 'wrong-target'/);
});
