#!/usr/bin/env node
// JSON-lines driver for CLI agents: exposes the gameqa environment of one task over stdin/stdout
// without exposing the build internals. Usage:
//   node beds/gameqa/driver.mjs --seed 3 --split dev --difficulty 3
// Each input line is a JSON command; each output line is a JSON reply:
//   {"op":"create"}                               -> {"env":"e1","observation":{...}}
//   {"op":"reset","env":"e1"}                     -> {"observation":{...},"done":false,...}
//   {"op":"step","env":"e1","action":"N"}         -> {"observation":{...},"done":false,"reward":0,"info":{...}}
//   {"op":"observe","env":"e1"}                   -> {"observation":{...}}
//   {"op":"snapshot","env":"e1"}                  -> {"snapshot":"snap-1"}
//   {"op":"restore","env":"e1","snapshot":"snap-1"} -> {"observation":{...},...}
//   {"op":"actions","env":"e1"}                   -> {"actions":[...]}
// The harness, not the solver, launches this process; solvers only see its replies.
import { createInterface } from 'node:readline';
import { createEnv } from './index.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const task = { seed: Number(args.seed ?? 1), split: args.split ?? 'dev', difficulty: Number(args.difficulty ?? 3) };
const envs = new Map();
let n = 0;
const out = obj => process.stdout.write(JSON.stringify(obj) + '\n');

createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return;
  let cmd;
  try { cmd = JSON.parse(line); } catch { return out({ error: 'invalid JSON' }); }
  try {
    if (cmd.op === 'create') { const id = `e${++n}`; const env = createEnv(task); envs.set(id, env); return out({ env: id, ...env.reset() }); }
    const env = envs.get(cmd.env);
    if (!env) return out({ error: `unknown env ${JSON.stringify(cmd.env)}` });
    if (cmd.op === 'reset') return out(env.reset());
    if (cmd.op === 'step') return out(env.step(cmd.action));
    if (cmd.op === 'observe') return out({ observation: env.observe() });
    if (cmd.op === 'snapshot') return out({ snapshot: env.snapshot() });
    if (cmd.op === 'restore') return out(env.restore(cmd.snapshot));
    if (cmd.op === 'actions') return out({ actions: env.actions() });
    return out({ error: `unknown op ${JSON.stringify(cmd.op)}` });
  } catch (error) { return out({ error: String(error.message ?? error) }); }
});
