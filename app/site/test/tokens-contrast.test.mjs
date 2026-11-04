// Colour tokens meet WCAG 2.2 contrast in both themes (SPEC §13.1): text and status colours >= 4.5:1 on every surface, control
// borders >= 3:1 (1.4.11), text on the accent >= 4.5:1. Computed from site.css itself. nice -n 15 node --test app/site/test/tokens-contrast.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'site.css'), 'utf8');
const block = selector => { const i = css.indexOf(selector), open = css.indexOf('{', i); let depth = 0, j = open; for (; j < css.length; j++) { if (css[j] === '{') depth++; if (css[j] === '}' && --depth === 0) break; } return css.slice(open + 1, j); };
const tokens = text => Object.fromEntries([...text.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map(m => [m[1], m[2]]));
const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const themes = { light: tokens(block(':root {')), dark: tokens(block(':root[data-theme="dark"]')), autoDark: tokens(block(':root:not([data-theme="light"])')) };

test('both themes define every token, and auto-dark equals dark', () => {
  for (const k of ['bg', 'surface', 'surface-2', 'fg', 'muted', 'line', 'line-strong', 'accent', 'on-accent', 'ok', 'bad', 'wait', 'paid', 'practice']) for (const t of ['light', 'dark']) assert.ok(themes[t][k], `${t} --${k}`);
  assert.deepEqual(themes.autoDark, themes.dark);
});

test('text and status colours >= 4.5:1, control borders >= 3:1, on-accent >= 4.5:1, on every surface', () => {
  for (const [name, t] of Object.entries({ light: themes.light, dark: themes.dark })) {
    for (const surface of ['bg', 'surface', 'surface-2']) {
      for (const fg of ['fg', 'muted', 'accent', 'ok', 'bad', 'wait', 'paid', 'practice']) assert.ok(ratio(t[fg], t[surface]) >= 4.5, `${name}: --${fg} on --${surface} is ${ratio(t[fg], t[surface]).toFixed(2)}`);
      assert.ok(ratio(t['line-strong'], t[surface]) >= 3, `${name}: --line-strong on --${surface} is ${ratio(t['line-strong'], t[surface]).toFixed(2)}`);
    }
    assert.ok(ratio(t['on-accent'], t.accent) >= 4.5, `${name}: text on accent`);
    assert.ok(ratio(t.bg, t.wait) >= 4.5, `${name}: the waiting count badge`);
  }
});
