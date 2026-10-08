#!/usr/bin/env node
// The reference implementation as a command candidate (JSON job on stdin, JSON result on stdout). Used to test the command plumbing.
import { runJob } from './reference.mjs';
let text = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) text += chunk;
process.stdout.write(JSON.stringify(runJob(JSON.parse(text))));
