// AGENTV-E8 arm "agent-H + validator" (FIRST-CLASS-PROGRAMS §1.5; F1 build item "deployable verifier for agent arms", the
// E8 variant). It is agent-H exactly (experiments/ebed/agent-arm.mjs agentArm, imported and used unchanged: one fresh
// sandboxed Haiku session per case-tick, the same prompt, files, CONTRACT.md, ctx.mjs mailbox, carry and cost rows) plus
// two things, both built on the host's own pre-commit validation (./validator.mjs) and nothing else:
//   1. In the session: `node validate.mjs draft.json` (a .val/ file mailbox, the ctx.mjs pattern) returns the problems the
//      host would refuse, in the host's words, before the agent writes output.json. One paragraph is appended to the
//      agent-H prompt telling the agent to use it.
//   2. After the session (pre-commit gate): the wrapper checks output.json the same way. On a refusal (or no output.json,
//      or one that is not JSON) it runs at most `retries` more fresh sessions in the same workdir, each told the refusal
//      text, with the refused output kept as rejected-output.json. An environment fault (rate limit, model unavailable,
//      no sandbox) is never retried; with stopOnEnvFault (run.mjs sets it) it stops the run at its last commit
//      (EnvFaultStop, a host QuotaStop: the fault's round is discarded, a re-run resumes). The wrapper never edits an
//      output: whatever the last session wrote goes to the host, which still validates it (an output the retry did not
//      fix is still an arm error). Files the session wrote are read without following symbolic links (validator.mjs).
// The validator never sees the oracle, the reference transition, grades or truth (validator.mjs header; a test walks the
// import closure of this file). How it is wired: agentArm calls its `runner` once per tick; this module passes a runner
// that wraps the real one, and an AsyncLocalStorage carries the tick's input and ctx to it (concurrent ticks stay apart).
//
// Metering (FIRST-CLASS-PROGRAMS §0.3; PREREG-NEED-V1 §12 K5): an optional `meter` with before(info) → token (reserves the
// session's bound before launch; throws a host QuotaStop when it does not fit) and after(token, result) → charge. The
// runner (run.mjs) supplies the §12 meter; tests supply their own.
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, writeFileSync, renameSync, rmSync, appendFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { agentArm } from '../ebed/agent-arm.mjs';
import { runClaudeCode } from '../../src/executors/claude-code.mjs';
import { validateDraft, VALIDATE_CLIENT, serveValidator, readSessionFile } from './validator.mjs';

export const VALIDATOR_PROMPT = `
Before you write output.json (step 4), check it: write the JSON to draft.json and run
     node validate.mjs draft.json
   It applies the platform's own output checks (the tick contract's TickOutput rules, as the platform enforces them) and
   lists every problem the platform would refuse, in the platform's words. Fix every problem and run it again until it
   says VALID; then write that same JSON to output.json. It checks the form of the output only, never whether your
   decisions are right.`;

/** The retry paragraph: the refusal text, verbatim. */
export const retryPrompt = problems => `
A previous session on this same tick ended without an output the platform would accept. Its output, if it wrote one, is
in rejected-output.json. The platform's checks refused it for these reasons:
${problems.map(p => `- ${p}`).join('\n')}
Fix these problems (keep its business decisions unless a problem forces a change), check with node validate.mjs, and
write output.json.`;

/** Session errors that are environment faults: a retry cannot fix them (and must not be paid for). */
export const ENV_FAULT_CODES = Object.freeze(new Set(['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'SANDBOX_UNAVAILABLE']));

/** A problem's class: its text with indices folded ("effects[2].key: …" → "effects[i].key: …"). */
export const problemClass = p => String(p).replace(/\[\d+\]/g, '[i]');

const codeOf = r => (typeof r?.error === 'string' ? r.error : r?.error?.code ?? null);
const safeInstances = ctx => { try { const r = ctx.instances({}); return Array.isArray(r) ? r : null; } catch { return null; } };

/**
 * The pre-commit gate: what the host would say about the output.json a session left. Read without following a link
 * (validator.mjs readSessionFile): a planted `output.json -> /host/file` is refused as such, never read and quoted back.
 */
export function gateOf(workdir, check) {
  const f = path.join(workdir, 'output.json');
  let st;
  try { st = lstatSync(f); } catch { return { kind: 'missing', problems: ['no output.json was written'] }; }
  if (st.isSymbolicLink()) return { kind: 'link', problems: ['output.json is a symbolic link: write the JSON itself to output.json'] };
  if (!st.isFile()) return { kind: 'link', problems: ['output.json is not a regular file: write the JSON itself to output.json'] };
  const file = readSessionFile(f);
  if (file.refused) return { kind: 'not-json', problems: [`output.json ${file.refused}`] };
  let out;
  try { out = JSON.parse(file.text); } catch (e) { return { kind: 'not-json', problems: [`output.json is not JSON: ${String(e.message).slice(0, 160)}`] }; }
  const r = check(out);
  return { kind: r.valid ? 'valid' : 'invalid', problems: r.problems };
}

/** runClaudeCode throws only before the CLI starts for these codes (src/executors/claude-code.mjs): nothing was spent. */
export const PRELAUNCH_THROW_CODES = Object.freeze(new Set(['SANDBOX_UNAVAILABLE', 'EXECUTOR_MODEL', 'EXECUTOR_PATH']));

/** The stop raised on an environment fault when stopOnEnvFault is set: a host QuotaStop (the clock freezes at the last commit). */
export class EnvFaultStop extends Error {
  constructor(code, detail = '') { super(`environment fault ${code}${detail ? `: ${detail}` : ''} (the run stops at its last commit; re-run the same command to resume)`); this.name = 'EnvFaultStop'; this.quota = true; this.envFault = code; }
}

/**
 * agentVArm({ schemas, retries?, runner?, meter?, validatorJournal?, ...agentArm options })
 *   schemas           the host's item schemas (bindItem(binding).schemas); the validator's only knowledge of the item
 *   retries           extra sessions after a gate refusal (default 1, FIRST-CLASS-PROGRAMS §1.5 "retries once")
 *   validatorJournal  JSONL file: one row per tick (sessions, validator calls, gate verdicts, retries)
 * Every other option is agentArm's (id, model, workRoot, contract, effort, budgetUsdPerTick, minutesPerTick, journal, ...).
 */
export function agentVArm({ schemas, retries = 1, runner = runClaudeCode, meter = null, validatorJournal = null, keepWorkdirs = false, stopOnEnvFault = false, ...rest }) {
  if (!schemas?.effects) throw new Error('agentVArm needs the host item schemas');
  if (!(Number.isInteger(retries) && retries >= 0 && retries <= 3)) throw new Error('agentVArm: retries must be an integer 0..3');
  const als = new AsyncLocalStorage();
  const validating = async opts => {
    const st = als.getStore();
    if (!st) throw new Error('agentVArm: the session runner was called outside a tick');
    const { workdir } = opts, log = st.log;
    writeFileSync(path.join(workdir, 'validate.mjs'), VALIDATE_CLIENT);
    const check = draft => validateDraft(draft, { schemas, self: st.input.instance, openInstances: safeInstances(st.ctx) });
    const box = serveValidator(workdir, check, { onCall: out => {
      log.validateCalls += 1;
      if (out.error) log.validateErrors += 1;
      else if (!out.valid) { log.validateInvalid += 1; for (const p of out.problems) log.problemsSeen[problemClass(p)] = (log.problemsSeen[problemClass(p)] ?? 0) + 1; }
    } });
    try {
      let prompt = opts.prompt + VALIDATOR_PROMPT;
      for (let attempt = 1; ; attempt++) {
        const tok = meter ? meter.before({ model: opts.model, bound: opts.budgetUsd, instance: st.input.instance, now: st.input.now, attempt }) : null;
        const t0 = Date.now();
        let r;
        try { r = await runner({ ...opts, prompt }); }
        catch (e) {
          // runClaudeCode throws only before the CLI starts for the pre-launch codes: nothing was spent (the §12 convention,
          // label-run.mjs withSignals). Any other throw is charged its bound.
          const code = typeof e?.code === 'string' ? e.code : 'EXECUTOR_THROW', pre = PRELAUNCH_THROW_CODES.has(code);
          const charged = meter ? meter.after(tok, pre ? { costUsd: 0, error: { code } } : { costUsd: null, costUnknown: true, error: { code } }) : null;
          log.sessions.push({ attempt, costUsd: pre ? 0 : null, costUnknown: !pre, costUpperUsd: opts.budgetUsd, charged, turns: null, error: code, threw: true, tokens: null, wallMs: Date.now() - t0 });
          if (stopOnEnvFault && ENV_FAULT_CODES.has(code)) throw new EnvFaultStop(code, String(e?.message ?? '').slice(0, 160));
          throw e;
        }
        const charged = meter ? meter.after(tok, r) : null;
        const code = codeOf(r);
        log.sessions.push({ attempt, costUsd: r?.costUsd ?? null, costUnknown: r?.costUsd === null || r?.costUsd === undefined, costUpperUsd: opts.budgetUsd,
          charged, turns: r?.turns ?? null, error: code, tokens: r?.streamUsage ?? null, wallMs: Date.now() - t0 });
        if (stopOnEnvFault && ENV_FAULT_CODES.has(code)) {
          // The preregistration (§6) reads a run as contaminated from its first environment fault: stop at the last commit
          // (the fault's round is discarded by the host's freeze) instead of grading ticks that ran against a rate limit.
          // This session's cost reaches the freeze record (agentArm records costs only for a session that returns).
          try { st.ctx.recordCost({ source: 'executor:claude-code', model: opts.model, costUsd: r?.costUsd ?? null, costUnknown: r?.costUsd === null || r?.costUsd === undefined,
            costUpperUsd: opts.budgetUsd, turns: r?.turns ?? null, attempt, envFault: code }); } catch { /* a revoked ctx: the meter still has it */ }
          log.gates.push({ attempt, kind: 'env-fault', problems: [] });
          throw new EnvFaultStop(code);
        }
        const gate = gateOf(workdir, check);
        log.gates.push({ attempt, kind: gate.kind, problems: gate.problems });
        if (gate.kind === 'valid' || attempt > retries || ENV_FAULT_CODES.has(code)) {
          // A symbolic link (or a FIFO, a directory) is not an output: agentArm would read through it to a host file, or
          // block on it. Remove it so the host records "no output.json" (an arm error, as for any refused output); the
          // wrapper never edits an output's content.
          if (gate.kind === 'link') rmSync(path.join(workdir, 'output.json'), { force: true, recursive: true });
          return r;
        }
        // A retry follows. This attempt's cost is recorded now (agentArm records the last attempt's from the result).
        st.ctx.recordCost({ source: 'executor:claude-code', model: opts.model, costUsd: r?.costUsd ?? null, costUnknown: r?.costUsd === null || r?.costUsd === undefined,
          costUpperUsd: opts.budgetUsd, turns: r?.turns ?? null, attempt, refusedByGate: true });
        const out = path.join(workdir, 'output.json'), transcript = path.join(workdir, '.executor-transcript.jsonl');
        if (existsSync(out)) renameSync(out, path.join(workdir, 'rejected-output.json'));
        else rmSync(path.join(workdir, 'rejected-output.json'), { force: true });
        // The retry session gets the refusal text, not the previous session's transcript.
        if (existsSync(transcript)) { if (keepWorkdirs) renameSync(transcript, `${workdir}.attempt-${attempt}.transcript.jsonl`); else rmSync(transcript, { force: true }); }
        log.retries += 1;
        prompt = opts.prompt + VALIDATOR_PROMPT + retryPrompt(gate.problems);
      }
    } finally { box.stop(); }
  };
  const inner = agentArm({ ...rest, keepWorkdirs, runner: validating });
  let k = 0;
  return {
    id: inner.id,
    async tick(input, ctx) {
      const log = { k: ++k, world: input.world ?? null, instance: input.instance, now: input.now, events: input.events?.length ?? 0, sessions: [], gates: [], retries: 0,
        validateCalls: 0, validateInvalid: 0, validateErrors: 0, problemsSeen: {}, final: null };
      try {
        const out = await als.run({ ctx, input, log }, () => inner.tick(input, ctx));
        log.final = log.gates.at(-1)?.kind ?? 'unknown';
        return out;
      } catch (e) {
        log.final = e?.envFault ? 'env-stop' : e?.quota ? 'quota-stop' : (log.gates.at(-1)?.kind ?? 'threw');
        log.error = String(e?.message ?? e).slice(0, 200);
        throw e;
      } finally {
        if (validatorJournal) appendFileSync(validatorJournal, JSON.stringify(log) + '\n');
      }
    },
  };
}
