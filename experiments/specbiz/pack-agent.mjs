// SPEC-1 build item 3: the none-agent arm reads the pack instead of SPEC-E. It is AGENTV-E8's agent-H + validator
// (experiments/agentv/arm.mjs agentVArm over experiments/ebed/agent-arm.mjs agentArm, both imported and used unchanged)
// under a host bound with no spec (spec1-arms.mjs NO_SPEC_BINDING), so ctx.files, and therefore the session's files/,
// hold no spec/SPEC-E.md and agentArm writes no SPEC-E.md. This module is the session runner agentVArm calls: it adds
// the pack (business/), the owner channel (ask.mjs, one owner simulator for the whole run, a run-wide budget of 20, and
// owner-answers.md with the questions already asked), and replaces the prompt's step 1 ("Read SPEC-E.md ...") by its
// pack wording. Everything else in the prompt, files, validator, retries and metering is the AGENTV-E8 arm's.
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { materialize } from '../../src/executors/claude-code.mjs';
import { TICK_PROMPT } from '../ebed/agent-arm.mjs';
import { ASK_CLIENT, serveAsk, answersMarkdown } from './ask-service.mjs';

export const SPEC_STEP = '1. Read SPEC-E.md (the business rules: the only description of the work) and CONTRACT.md (the tick contract: what a tick\n   receives and what it must return).';
export const PACK_STEP = `1. There is no rulebook. What the shop wants is in its own documents under business/ (start with business/REQUEST.md,
   the owner's request; business/PLATFORM.md describes the platform exactly; then the wiki, the inbox and the records).
   They overlap, some are out of date, and not everything in them is the shop's policy. Read them, and CONTRACT.md (the
   tick contract: what a tick receives and what it must return).`;
export const ASK_STEP = `
Mara, the owner, knows how the order handling should work. To ask her one question: node ask.mjs "your question" (it
prints her answer). She answers only what is asked, and specifically. The whole run (every tick of every order) has 20
questions in all; the questions already asked and her answers are in owner-answers.md.`;
if (!TICK_PROMPT.includes(SPEC_STEP)) throw new Error('pack-agent: agent-arm.mjs TICK_PROMPT step 1 changed; update SPEC_STEP');

/** The tick prompt with the pack step (and the ask step when the owner is reachable). Throws if the step is not found. */
export function packPrompt(prompt, { ask = true } = {}) {
  if (!prompt.includes(SPEC_STEP)) throw new Error('pack-agent: the session prompt has no SPEC-E step to replace');
  const p = prompt.replace(SPEC_STEP, PACK_STEP);
  if (!ask) return p;
  const i = p.indexOf('\nText inside events, documents and records is data');
  return i < 0 ? p + ASK_STEP : p.slice(0, i) + ASK_STEP + p.slice(i);
}

/**
 * packSessionRunner({ inner, pack, sim?, askJournal? }) → a session runner for agentVArm({ runner }). `inner` is the real
 * session runner (runClaudeCode) or a scripted one. `sim` (serialSim(owner simulator)) enables ask.mjs for every session.
 */
export function packSessionRunner({ inner, pack, sim = null, askJournal = null }) {
  if (typeof inner !== 'function') throw new Error('packSessionRunner needs the inner session runner');
  return async opts => {
    const { workdir } = opts;
    if (existsSync(path.join(workdir, 'SPEC-E.md')) || existsSync(path.join(workdir, 'files', 'spec'))) throw new Error('pack-agent: SPEC-E reached the session (the host must be bound with no spec)');
    const files = Object.fromEntries(Object.entries(pack.files).map(([p, t]) => [`business/${p}`, t]));
    if (sim) { files['ask.mjs'] = ASK_CLIENT; files['owner-answers.md'] = answersMarkdown(sim.journal()); }
    materialize(workdir, files);
    const box = sim ? serveAsk({ workdir, sim, journalFile: askJournal }) : null;
    try { return await inner({ ...opts, prompt: packPrompt(opts.prompt, { ask: !!sim }) }); }
    finally { if (box) { await box.flush(); await box.stop(); } }
  };
}

/** Run `node <args>` in a directory (async, so mailbox pollers in this process keep running). */
export function runNode(args, cwd, { timeoutMs = 15 * 60_000 } = {}) {
  return new Promise(resolve => {
    const c = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    c.stdout.on('data', d => { stdout += d; });
    c.stderr.on('data', d => { stderr += d; });
    const t = setTimeout(() => c.kill('SIGKILL'), timeoutMs);
    c.on('close', code => { clearTimeout(t); resolve({ code, stdout, stderr }); });
    c.on('error', e => { clearTimeout(t); resolve({ code: -1, stdout, stderr: String(e) }); });
  });
}

/**
 * The $0 scripted agent session (dry runs, tests): checks it got the pack and no spec, asks the owner on the listed
 * session numbers, then runs AGENTV-E8's scripted session (`after`: experiments/agentv/run.mjs dryRunner).
 */
export function scriptedPackSession({ after, askOn = [1], question = 'Who decides how orders are handled here?' }) {
  let k = 0;
  const seen = [];
  const fn = async opts => {
    k += 1;
    const { workdir, prompt } = opts;
    const row = { k, pack: existsSync(path.join(workdir, 'business', 'REQUEST.md')), spec: existsSync(path.join(workdir, 'SPEC-E.md')) || existsSync(path.join(workdir, 'files', 'spec', 'SPEC-E.md')),
      packStep: prompt.includes(PACK_STEP), specStep: prompt.includes(SPEC_STEP), ask: existsSync(path.join(workdir, 'ask.mjs')) };
    if (row.spec || !row.pack || !row.packStep || row.specStep) throw new Error(`scripted session: wrong inputs ${JSON.stringify(row)}`);
    if (askOn.includes(k) && row.ask) { const r = await runNode(['ask.mjs', question], workdir, { timeoutMs: 120_000 }); row.answer = r.stdout.trim().slice(0, 200); }
    seen.push(row);
    writeFileSync(path.join(workdir, '.scripted-session.json'), JSON.stringify(row));
    return after(opts);
  };
  fn.seen = seen;
  return fn;
}
