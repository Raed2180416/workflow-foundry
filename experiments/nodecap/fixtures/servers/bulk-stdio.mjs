#!/usr/bin/env node
// Fixture bulk server (stdio) for the NC-1 scale world (review-cost M8): `--count` plausible, read-only archive tools of one system, so
// that a raw configuration (arm B) carries 100+ tool definitions and a Foundry node's standby is filled to its cap of 20 by members that
// match the acquire clause but are not the task's tools. Every tool answers an empty archive page and records the call in the ledger.
// The tool table is the formula of experiments/nodecap/bed/episode.mjs bulkTools (the owner's attestation); qualification compares them.
import { argv, fixtureServer, ledgerPath, ok, record, serveStdio } from './lib.mjs';

const system = argv('system', 'crm'), count = Number(argv('count', '24'));
const NOUNS = { crm: ['contact', 'account', 'lead', 'company'], tickets: ['ticket', 'queue', 'macro', 'tag'], sheets: ['row', 'tab', 'range', 'chart'] }[system] ?? ['record'];
const VERBS = ['search', 'list', 'lookup', 'export', 'history', 'audit'];
const table = Array.from({ length: count }, (_, i) => ({ name: `archive_${NOUNS[i % NOUNS.length]}_${VERBS[Math.floor(i / NOUNS.length) % VERBS.length]}_${i}`,
  description: `Archived ${system} ${NOUNS[i % NOUNS.length]} ${VERBS[Math.floor(i / NOUNS.length) % VERBS.length]} (read-only history, partition ${i}).` }));
const tools = () => table.map(t => ({ name: t.name, description: t.description, inputSchema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', maxLength: 200 } } }, annotations: { readOnlyHint: true } }));
const handlers = Object.fromEntries(table.map(t => [t.name, ({ query = '' }) => { record(ledgerPath(), { tool: t.name }); return ok({ records: [], partition: t.name, query: String(query).slice(0, 40) }); }]));
await serveStdio(fixtureServer({ name: `fixture-bulk-${system}`, tools, handlers }));
