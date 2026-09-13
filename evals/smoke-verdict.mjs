#!/usr/bin/env node
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inspectSmoke, hashBytes } from './evidence.mjs';
import { runDirectory } from './opencode-harness.mjs';

const id = process.argv[2], run = runDirectory(id);
const read = file => readFileSync(path.join(run, file), 'utf8');
const outputPath = path.join(run, 'workspace/output.json');
if (existsSync(path.join(run, 'verdict.json'))) throw Error('Preserve the existing smoke verdict.');
const result = { id, evaluatedAt: new Date().toISOString(), ...inspectSmoke({
  manifest: JSON.parse(read('manifest.json')), session: JSON.parse(read('session-export-local.stdout.txt')),
  prompt: read('prompt.txt'), transcript: read('transcript.ansi'), output: existsSync(outputPath) ? read('workspace/output.json') : undefined,
}) };
writeFileSync(path.join(run, 'verdict.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
if (existsSync(outputPath)) chmodSync(outputPath, 0o600);
const names = ['manifest.json', 'prompt.txt', 'transcript.ansi', 'session-export-local.stdout.txt', 'verdict.json'];
if (existsSync(outputPath)) names.push('workspace/output.json');
writeFileSync(path.join(run, 'artifact-freeze.json'), JSON.stringify({ frozenAt: new Date().toISOString(), files: Object.fromEntries(names.map(file => [file, hashBytes(readFileSync(path.join(run, file)))])) }, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ id, passed: result.passed, model: result.model, cost: result.cost, outputSHA256: result.outputSHA256, errors: result.errors }, null, 2));
