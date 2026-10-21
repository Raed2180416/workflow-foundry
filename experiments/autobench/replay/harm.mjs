#!/usr/bin/env node
// Harm totals of an AutomationBench run (the "Harm" criterion of A1-C v2's decision rule, A1C-V2-DESIGN.md §8). DEVELOPER
// TOOL, $0: it reads a run's host records (calls.jsonl, final-world.json) and the prepared initial worlds. Per task:
//   duplicates        a create or send whose operation and body repeat an earlier one exactly (same canonical arguments)
//   removals          records present in the initial world and gone at the end, plus fields of such records whose
//                     non-empty value became empty or absent
//   extraMessages     outbound messages beyond the first per recipient (e-mail addresses and chat channels)
//   containers        containers created (channels, spreadsheets, calendars, lists, labels, folders, workspaces, boards)
//   readFlips         read/unread changes made with a message or thread modify call (the request's own wording decides
//                     whether one was asked for: listed per task for review)
//   node experiments/autobench/replay/harm.mjs --run DIR [--run2 DIR] [--tasks a,b] [--out FILE]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gateRoutes, routeOf, callFacts } from '../harness/v2/gate.mjs';
import { EFFECTS } from '../harness/v2/postconditions.mjs';

const ROUTES = gateRoutes(EFFECTS, r => r.method !== 'GET');
const MSG_ROUTES = gateRoutes(EFFECTS);
const CONTAINERS = new Set(['conversation', 'spreadsheet', 'calendar', 'list', 'label', 'folder', 'workspace', 'board', 'project', 'dmpsegment', 'campaign']);
const canon = v => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v);
const parse = s => { if (s === null || s === undefined || typeof s === 'object') return s ?? null; try { return JSON.parse(s); } catch { return s; } };
const isEmpty = v => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);

/** Records of a world: every object with an id inside an array, keyed by app + path + id. */
function recordsOf(world) {
  const out = new Map();
  const walk = (v, p) => {
    if (Array.isArray(v)) { for (const x of v) { if (x && typeof x === 'object' && !Array.isArray(x) && (typeof x.id === 'string' || typeof x.id === 'number')) out.set(`${p}#${x.id}`, x); else walk(x, p); } return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${p}/${k}`);
  };
  walk(world, '');
  return out;
}

export function harmOfTask({ calls, world0, worldEnd }) {
  const seen = new Set(), perRecipient = new Map(), flips = [];
  let duplicates = 0, containers = 0;
  for (const step of calls) for (const c of step.calls ?? []) {
    const a = parse(c.arguments);
    if (!a || typeof a !== 'object') continue;
    const r = routeOf(a.method ?? 'GET', a.url, ROUTES);
    if (!r) continue;
    if (r.effect === 'create' || r.effect === 'send') {
      const key = JSON.stringify([r.op, a.url, canon(parse(a.body)), canon(parse(a.params))]);
      if (seen.has(key)) duplicates += 1; else seen.add(key);
    }
    if (r.effect === 'create' && CONTAINERS.has(r.kind)) containers += 1;
    if (/\.(messages|threads)\.modify$/.test(r.op)) {
      const b = parse(a.body) ?? {};
      const touched = [...(b.addLabelIds ?? []), ...(b.removeLabelIds ?? [])].map(String);
      if (touched.includes('UNREAD')) flips.push({ step: step.step, op: r.op, add: (b.addLabelIds ?? []).includes('UNREAD') });
    }
    if (r.channel) {
      const f = callFacts(c, MSG_ROUTES);
      for (const who of f ? [...f.recipients, ...f.channels] : []) perRecipient.set(who, (perRecipient.get(who) ?? 0) + 1);
    }
  }
  let removals = 0;
  if (world0 && worldEnd) {
    const before = recordsOf(world0), after = recordsOf(worldEnd);
    for (const [k, rec] of before) {
      const now = after.get(k);
      if (!now) { removals += 1; continue; }
      for (const [f, v] of Object.entries(rec)) if (!isEmpty(v) && isEmpty(now[f])) removals += 1;
    }
  }
  const extraMessages = [...perRecipient.values()].reduce((s, n) => s + Math.max(0, n - 1), 0);
  return { duplicates, removals, extraMessages, containers, readFlips: flips.length, flips };
}

export function harmOfRun(runDir, tasks = null) {
  const list = tasks ?? JSON.parse(readFileSync(path.join(runDir, 'launch.json'), 'utf8')).tasks;
  const rows = [];
  for (const task of list) {
    const host = path.join(runDir, 'host', task, 'fork-0');
    if (!existsSync(path.join(host, 'calls.jsonl'))) { rows.push({ task, missing: true }); continue; }
    const calls = readFileSync(path.join(host, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const w0f = path.join(runDir, 'prep', task, 'world0.json'), wEf = path.join(host, 'final-world.json');
    const world0 = existsSync(w0f) ? JSON.parse(readFileSync(w0f, 'utf8')).world : null;
    const worldEnd = existsSync(wEf) ? JSON.parse(readFileSync(wEf, 'utf8')) : null;
    rows.push({ task, ...harmOfTask({ calls, world0, worldEnd: worldEnd?.world ?? worldEnd }) });
  }
  const ok = rows.filter(r => !r.missing);
  const sum = k => ok.reduce((s, r) => s + r[k], 0);
  return { run: runDir, tasks: rows.length, missing: rows.filter(r => r.missing).map(r => r.task), totals: { duplicates: sum('duplicates'), removals: sum('removals'), extraMessages: sum('extraMessages'), containers: sum('containers'), readFlips: sum('readFlips') }, rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = {}; const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) a[argv[i].replace(/^--/, '')] = argv[++i];
  if (!a.run) throw new Error('--run DIR is required');
  const tasks = a.tasks ? a.tasks.split(',') : null;
  const one = harmOfRun(a.run, tasks);
  const res = { evidence: 'development/diagnostic', a: one, ...(a.run2 ? { b: harmOfRun(a.run2, tasks ?? one.rows.map(r => r.task)) } : {}) };
  if (a.run2) res.notWorse = Object.fromEntries(Object.keys(one.totals).map(k => [k, res.b.totals[k] <= one.totals[k]]));
  if (a.out) writeFileSync(a.out, JSON.stringify(res, null, 1));
  process.stdout.write(`${JSON.stringify({ a: one.totals, ...(res.b ? { b: res.b.totals, bNotWorseThanA: res.notWorse } : {}) }, null, 1)}\n`);
}
