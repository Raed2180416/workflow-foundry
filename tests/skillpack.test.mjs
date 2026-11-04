// The foundry-construct skill pack: size budgets, currency against the schema, working exemplars, no forbidden sources.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pack = `${root}skills/foundry-construct/`;
const words = text => text.split(/\s+/).filter(Boolean).length;
const read = rel => readFileSync(pack + rel, 'utf8');
const refs = readdirSync(`${pack}references`).filter(f => f.endsWith('.md'));

test('SKILL.md has a front-loaded description and stays within the always-loaded budget', () => {
  const skill = read('SKILL.md');
  const front = skill.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(front, 'front matter');
  assert.match(front[1], /^name: foundry-construct$/m);
  const description = front[1].match(/^description: (.*)$/m)?.[1] ?? '';
  assert.ok(description.length > 0 && description.length <= 1024, `description is ${description.length} characters`);
  assert.ok(words(skill) <= 1100, `SKILL.md is ${words(skill)} words; the core must stay small`);
});

test('every reference stays small and the whole pack stays under its budget', () => {
  let total = words(read('SKILL.md'));
  for (const f of refs) {
    const n = words(read(`references/${f}`));
    assert.ok(n <= 1500, `references/${f} is ${n} words`);
    total += n;
  }
  assert.ok(total <= 6000, `the pack is ${total} words`);
});

test('every file the core skill points to exists', () => {
  const skill = read('SKILL.md');
  for (const [, rel] of skill.matchAll(/`((?:references|exemplars)\/[^`]+)`/g)) assert.ok(existsSync(pack + rel), `${rel} missing`);
  assert.ok(existsSync(`${root}app/core/templates`), 'templates directory');
});

test('the IR reference is generated from the current schema', () => {
  execFileSync(process.execPath, [`${root}tools/skillpack/gen-ir.mjs`, '--check'], { stdio: 'pipe' });
});

test('every exemplar validates and passes the strict construction lint', () => {
  for (const f of readdirSync(`${pack}exemplars`).filter(f => f.endsWith('.json'))) {
    const out = JSON.parse(execFileSync(process.execPath, [`${root}bin/foundry.mjs`, 'lint', `${pack}exemplars/${f}`, '--fail-on', 'error'], { encoding: 'utf8' }));
    assert.equal(out.valid, true, `${f}: ${JSON.stringify(out.errors)}`);
    assert.equal(out.lint.ok, true, `${f}: ${JSON.stringify(out.lint.findings)}`);
    assert.equal(out.lint.acceptance.grade, 'gating', `${f} acceptance grade`);
  }
});

test('the pack never draws on sources that must stay out of model contexts', () => {
  const files = ['SKILL.md', ...refs.map(f => `references/${f}`)];
  for (const f of files) assert.doesNotMatch(read(f), /VERIFIER-LAB|ATTACK\.md|ATTACK-FABLE|ceiling-and-frontier|ceiling notes/i, `${f} cites a forbidden source`);
});
