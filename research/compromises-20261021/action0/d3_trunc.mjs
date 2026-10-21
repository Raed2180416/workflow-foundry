// Compromise register D3 check (2026-10-21, FIXES.md Action 0): does readAnchors accept an anchor file whose last line
// was dropped? $0; writes and removes one temp directory under the directory given (default: the OS temp dir).
//   node research/compromises-20261021/action0/d3_trunc.mjs [tempParent]
import { appendAnchor, readAnchors, ANCHOR_SCHEMA } from '../../../src/audit.mjs';
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
const dir = mkdtempSync(path.join(process.argv[2] ?? tmpdir(), 'd3-'));
const file = path.join(dir, 'anchors.jsonl');
const a = (seq, h) => ({ schema: ANCHOR_SCHEMA, runId: 'r1', headSeq: seq, headHash: h, headAt: 0, journalRoot: null, journalCalls: 0, journalMaxId: 0, status: 'succeeded' });
appendAnchor(file, a(3, 'aaa')); appendAnchor(file, a(5, 'bbb')); appendAnchor(file, a(9, 'ccc'));
console.log('full file: anchors', readAnchors(file).length);
const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
writeFileSync(file, lines.slice(0, -1).join('\n') + '\n');
try { console.log('last line dropped: anchors', readAnchors(file).length, '(accepted)'); } catch (e) { console.log('last line dropped: refused', e.code); }
writeFileSync(file, [lines[0], lines[2]].join('\n') + '\n');
try { console.log('middle line dropped: anchors', readAnchors(file).length, '(accepted)'); } catch (e) { console.log('middle line dropped: refused', e.code); }
rmSync(dir, { recursive: true, force: true });
