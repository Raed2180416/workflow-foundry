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

// Honesty review 2026-10-21 (M11): text the site shows also comes from modules (the n8n import report, the IT brief, the evidence file,
// the coding agent's replies, card wording, check results), which bypassed this lint; that is how a ✓ for something Foundry cannot do
// shipped (M1). So every string literal in every module and page script under app/ (tests aside), every string in its data files, and
// the wording of every card as the person reads it (the frozen template after app/onboarding/card-text.json) is linted too, for the
// banned phrases and for each overclaim the review found.
const APP = path.join(here, '..', '..');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? (['test', 'templates'].includes(d.name) ? [] : walk(path.join(dir, d.name))) : [path.join(dir, d.name)]);
const rel = f => path.relative(APP, f).split(path.sep).join('/');
const MODULES = walk(APP).filter(f => /\.m?js$/.test(f)).map(rel);
// en.json is linted as the copy (above); card-text.json's replace pairs are [frozen template wording, what the person reads]: only the
// second is shown.
const JSONS = walk(APP).filter(f => f.endsWith('.json') && !f.endsWith(path.join('copy', 'en.json'))).map(rel);
/**
 * String literals in a source file, comments and regular expressions left out: a small lexer for quotes, template literals (each ${...}
 * lexed as code, its own strings collected, and left as {} in the template's text), // and block comments, and a regular expression
 * where an operand can start, so a quote inside a pattern does not open a string.
 */
export function literals(src) {
  const out = []; let i = 0;
  const regexCanStart = last => last === '' || /[(,=:[!&|?{};+\-*%<>~^]$/.test(last) || /^(return|typeof|case|in|of|delete|void|throw|new|else|do)$/.test(last);
  function code(inExpression) {
    let last = '', depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') { const n = src.indexOf('\n', i); i = n < 0 ? src.length : n; continue; }
      if (c === '/' && src[i + 1] === '*') { const n = src.indexOf('*/', i + 2); i = n < 0 ? src.length : n + 2; continue; }
      if (c === '/' && regexCanStart(last)) {
        let cls = false; i += 1;
        while (i < src.length && src[i] !== '\n' && (cls || src[i] !== '/')) { if (src[i] === '\\') i += 1; else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; i += 1; }
        i += 1; while (/[a-z]/.test(src[i] ?? '')) i += 1; last = 'x'; continue;
      }
      if (c === "'" || c === '"') {
        let text = ''; i += 1;
        while (i < src.length && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') { text += src[i + 1] ?? ''; i += 2; } else { text += src[i]; i += 1; } }
        out.push(text); i += 1; last = 'x'; continue;
      }
      if (c === '`') { i += 1; template(); last = 'x'; continue; }
      if (inExpression && c === '{') depth += 1;
      if (inExpression && c === '}') { if (depth === 0) { i += 1; return; } depth -= 1; }
      if (!/\s/.test(c)) last = /[A-Za-z0-9_$]/.test(c) ? (/^[A-Za-z0-9_$]+$/.test(last) ? last + c : c) : c;
      i += 1;
    }
  }
  function template() {
    let text = '';
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { text += src[i + 1] ?? ''; i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; text += '{}'; code(true); continue; }
      text += src[i]; i += 1;
    }
    i += 1; out.push(text);
  }
  code(false);
  return out;
}
// Every card as the person reads it: the frozen template's workflow after the card wording revisions, and its "It will / It won't".
const { loadLibrary, instantiate } = await import('../../core/library.mjs');
const { applyCardText, cardPromises } = await import('../../onboarding/card-text.mjs');
const cards = loadLibrary().flatMap(tpl => {
  const wf = instantiate(tpl, tpl.example); applyCardText(tpl, wf, tpl.example);
  const { metadata: _m, ...shown } = wf;
  return strings({ shown, promises: cardPromises(tpl, tpl.example) }).map(([k, v]) => [`card ${tpl.id} ${k}`, v]);
});
const generated = [...MODULES.flatMap(f => literals(readFileSync(path.join(APP, f), 'utf8')).map(v => [f, v])),
  ...JSONS.flatMap(f => strings(JSON.parse(readFileSync(path.join(APP, f), 'utf8'))).filter(([k]) => !(f.endsWith('card-text.json') && /\.replace\[\d+\]\[0\]$/.test(k))).map(([k, v]) => [`${f} ${k}`, v])),
  ...cards];
// Each overclaim the honesty review found, as a phrase that must not come back anywhere the person or their agent reads.
const DELIVERED = /message\(s\)[^.]*\bdelivered|\b(were|was) delivered, each intact|delivered (message|e-?mail|text)|(e-?mails?|messages?|drafts?|reminders?|report) (was|were|is|are) delivered|this run delivered/i;
const OVERCLAIMS = [/comes? over exactly/i, /can run this as its own/i, /can be called as it is/i, /no documented dialog/i, /asks you before each/i, /free, always/i,
  /never charge/i, /(?<!no )daily (token )?(limit|cap)/i, /\(all planned\)/i, /so no hook (on the machine )?can answer/i, /always asks you, never your agent/i,
  /doesn't keep anything anywhere else/i, /disk encryption does/i, /when (it|foundry) is published/i, DELIVERED, /doesn't affect you/i,
  /yes, from someone who didn't enter/i, /\bwe think\b/i, /folders 0700, files 0600/i, /foundry (itself )?sends nothing/i, /team plan will do/i, /the approve tool/i];
// Files the BUILDER-1 manifest freezes (experiments/surface/manifest.mjs), and the stub builder the walkthrough fixes kept unchanged
// (WALKTHROUGH.md P1 M10): their run-time words say "delivered" for a draft written to the outbox. They are not changed; the known
// gaps say what the word means wherever a record is shown (GAPS, below). Only that one phrase is excused there.
const { FROZEN } = await import('../../../experiments/surface/manifest.mjs');
const FROZEN_WORDS = new Set([...FROZEN.filter(f => f.startsWith('app/')).map(f => f.slice(4)), 'core/builder.mjs']);

test('no overclaim the honesty review found, in the copy, in any module, data file or page script, or on any card (M11)', async () => {
  const banned = ['works with gmail', 'set it and forget it', 'runs automatically', 'soc 2', 'enterprise-grade', 'guarantee', 'fully secure', 'seamless', 'effortless'];
  assert.ok(MODULES.length >= 70 && MODULES.includes('mcp/server.mjs') && MODULES.includes('site/public/views/import.js'), `modules: ${MODULES.length}`);
  assert.ok(JSONS.includes('onboarding/card-text.json') && JSONS.includes('site/claims.json'), JSONS.join(', '));
  assert.ok(cards.length > 100 && generated.length > 5000, `strings: ${generated.length}, card strings: ${cards.length}`);
  const excused = [];
  for (const [where, v] of [...all, ...generated]) {
    for (const b of banned) assert.equal(v.toLowerCase().includes(b), false, `${where}: "${b}"`);
    for (const re of OVERCLAIMS) {
      if (!re.test(v)) continue;
      if (re === DELIVERED && FROZEN_WORDS.has(where)) { excused.push(where); continue; }
      assert.fail(`${where}: ${re} in "${v.slice(0, 160)}"`);
    }
  }
  // The excuse holds only while the known gaps explain the word, in the brief, the evidence file and the run page.
  if (excused.length) {
    const { GAPS } = await import('../../onboarding/brief.mjs');
    assert.ok(GAPS.some(g => /"delivered"/.test(g) && /outbox on this computer/.test(g)), 'GAPS explains "delivered"');
    assert.match(copy.run.gaps.delivered, /"delivered"/);
  }
});

test('the lint has teeth: the strings the review quoted are caught', () => {
  const quoted = ['Comes over exactly: Foundry can run this as its own automation (after a test and your yes).', 'Codex has no documented dialog for your decisions',
    'Claude Code asks you before each Foundry tool that is not read-only runs.', 'Free, always', 'We never charge by size.', 'Foundry stops using the key for the day once your daily limit is reached.',
    'Exactly the 3 expected message(s) were delivered, each intact', 'Signed, pinned builds: planned for when Foundry is published', 'The approve tool always asks you, never your agent.',
    'Foundry itself sends nothing: e-mails are drafts you send', 'The Team plan will do that; it isn\'t available yet.', 'We think the first two should be.', 'or the hosted Team plan (all planned).',
    'Files are readable by this OS user only (folders 0700, files 0600).', 'Foundry doesn\'t keep anything anywhere else.', 'If you don\'t use one, this doesn\'t affect you.',
    'refunds above a limit need finance\'s yes, from someone who didn\'t enter the case.', 'This run delivered exactly the planned reminders, each intact', 'so no hook on the machine can answer Foundry\'s dialog'];
  for (const q of quoted) assert.ok(OVERCLAIMS.some(re => re.test(q)), q);
  assert.equal(OVERCLAIMS.some(re => re.test('There is no daily limit.')), false);
  assert.deepEqual(literals("const a = 'x\\'y'; // 'not this'\n/* 'nor this' */ const b = `z`;"), ["x'y", 'z']);
  // A quote inside a regular expression does not open a string; a division is not a regular expression.
  assert.deepEqual(literals("const r = /\"(a|b)\"/g; const s = 'x'; const d = n / 2; const e = (m) / 3 + 'y'; if (/[/']/.test(q)) z('w');"), ['x', 'y', 'w']);
  // A template's ${...} is code: its strings are collected on their own, and a quote or backtick inside it does not end the template.
  assert.deepEqual(literals("const t = `a ${f(`b`, 'c')} d ${x.replace(/[\"`]/g, '')} e`; const u = 'f';"), ['b', 'c', '', 'a {} d {} e', 'f']);
  // The goods sense of the word is not a claim about mail; the mail sense is.
  assert.equal(OVERCLAIMS.some(re => re.test('what the customer owes for what was delivered')), false);
  assert.ok(OVERCLAIMS.some(re => re.test('The report is delivered to the one recipient you named')));
});

// Honesty review minor 14: copy no page uses still promised features that no longer exist. Every copy key is used by a page: by name,
// or under a prefix a page builds a key from (`org.layers.${x}`), or as part of an object a page reads whole.
test('every copy key is used by a page (no stale promises left in the copy)', () => {
  const src = sources.map(([, s]) => s).join('\n') + readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const leaves = (v, at = '') => typeof v === 'string' || Array.isArray(v) || (v && typeof v === 'object' && typeof v.plain === 'string' && Object.keys(v).every(k => ['plain', 'precise'].includes(k))) ? [at]
    : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => leaves(x, at ? `${at}.${k}` : k)) : [];
  const named = new Set([...src.matchAll(/['"`]([a-zA-Z][a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9_-]+)+)['"`]/g)].map(m => m[1]));
  const prefixes = [...new Set([...src.matchAll(/`([a-zA-Z][a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9_-]+)*\.)\$\{/g)].map(m => m[1]))];
  const unused = leaves(copy).filter(k => k !== '_note' && !named.has(k) && !prefixes.some(p => k.startsWith(p)) && ![...named].some(n => k.startsWith(`${n}.`)));
  assert.deepEqual(unused, []);
});

test('numbers come from claims or data; only a short chrome allowlist is written into the copy', () => {
  const ALLOW = ['127.0.0.1', 'Node 24', '30 days', 'n8n', 'Mercury 3', 'Haiku 5.5', '2026-10-21']; // addresses, product names, the pilot length, a source's read date
  for (const [k, v] of all) {
    let rest = v.replace(/\{claim:C\d{2}\}/g, '').replace(/\{[a-zA-Z0-9_]+\}/g, '');
    for (const a of ALLOW) rest = rest.split(a).join('');
    assert.equal(/\d/.test(rest), false, `${k} has a number written into the copy: ${v}`);
  }
});

test('operator pages stay in plain words; precise words only in developer and IT sections (R8)', () => {
  const PRECISE = /\bMCP\b|webhook|token cap|\bIR\b|\bhash\b|Control Plane|\bflow\b|\bproposal\b|activation|stand-in/i;
  const DEV = /^(connect|trust\.allowlist|trust\.remove|glossary|docs\.dev|docs\.data|run\.chainHead|automation\.fingerprint|connections\.items\.(claudeCode|cursor|codex|plugin))/;
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
