// SW-1 node runner (research/subworkflow-20261021/DESIGN.md): one channel intake node under one arm.
//   A0   the node alone: one typed answer.
//   A1   the node decides; on "subworkflow" it writes a subworkflow/1 spec itself (free-form), in its own context.
//   A1T  the node decides; on "subworkflow" it picks and fills a library template itself, in its own context (ablation).
//   A2   the node decides; on "subworkflow" it sends a typed request (goal, inputs, returns, budget) to the governing
//        builder: a fresh Haiku that selects and fills a library template from the request alone.
//   A2O  (SW-1b, added after eval-1) as A2, with the open governing builder: when the library stage ends without a
//        passing sub-workflow (the builder picks "none" or the template never passes), a fresh Haiku writes the
//        sub-workflow free-form from the same request view (prompts-open.mjs). The node sees exactly A2's prompts.
// Whoever builds, code owns the rest, identically: the envelope check (checkSpec: structure, then authority; a widening
// is refused and recorded as a proposal for the owner, never run), a $0 practice run on the node's own input with every
// judgment stubbed, binding by content hash through the flow-v3 call host (depth, recursion, effects 'none', budget tree),
// the real run, and the contract gate on its answer. Any failure goes back to the builder as feedback: at most MAX_REPAIRS
// repair rounds. When no round succeeds the node answers directly (a logged fallback).
import { checkSpec, PURE_OPS, EFFECT_OPS, SubworkflowError } from './dsl.mjs';
import { TEMPLATES, templateById, fillSchema, slotProblems, instantiate } from './templates.mjs';
import { createNodeBinding, practiceRun, gateProblems } from './bind.mjs';
import { compileDataSchema } from '../../src/validate.mjs';
import * as P from './prompts.mjs';
import * as PO from './prompts-open.mjs';

// route: who builds a sub-workflow (null: nobody); directive: 'decide' (the node chooses: answer or sub-workflow) or
// 'subworkflow' (the parent directs a sub-workflow for this node; the runner applies it to legacy-export nodes only).
export const ARM_CONFIG = Object.freeze({
  A0: { route: null, directive: 'answer' },
  A1: { route: 'self', directive: 'decide' }, A1T: { route: 'template', directive: 'decide' }, A2: { route: 'governing', directive: 'decide' },
  A1F: { route: 'self', directive: 'subworkflow' }, A1TF: { route: 'template', directive: 'subworkflow' }, A2F: { route: 'governing', directive: 'subworkflow' },
  // SW-1b (after eval-1): the open governing builder. Appended, so the SW-1 arms keep their order in ARMS.
  A2O: { route: 'governing-open', directive: 'decide' }, A2OF: { route: 'governing-open', directive: 'subworkflow' },
});
// The node-facing side of a route: the open governing route shows the node exactly the governing route's prompts.
const nodeRoute = route => (route === 'governing-open' ? 'governing' : route);
export const ARMS = Object.freeze(Object.keys(ARM_CONFIG));
export const NODE_MODEL = 'claude-haiku-5-5';
export const NODE_DECODING = Object.freeze({ reasoning: 'medium' });
export const BUILDER_DECODING = Object.freeze({ reasoning: 'medium' });
export const NODE_BUDGET_USD = 0.15, SUB_MAX_USD = 0.06, SUB_DEFAULT_USD = 0.04, NODE_RESERVE_USD = 0.02;
export const MAX_REPAIRS = 3, MAX_DEPTH = 2, SCHEMA_RETRIES = 2;
const usd = x => Math.round(x * 1e6) / 1e6;

/**
 * Run one node. port: a ModelPort (journaled); arm; input: the bed's channel input {channel, notes, export} plus the
 * task spec; runId: the (arm, task) run id; answerSchema: the node's declared answer schema (the parent binds it).
 * Returns { output, path, decision, calls, costUsd, sub: {...}, authority: {...}, events, error }.
 */
export async function runNode({ port, arm, input, runId, answerSchema, directive = ARM_CONFIG[arm]?.directive, budgetUsd = NODE_BUDGET_USD, maxRepairs = MAX_REPAIRS, maxDepth = MAX_DEPTH }) {
  if (!ARMS.includes(arm)) throw new Error(`unknown arm ${arm}`);
  const { route } = ARM_CONFIG[arm], nodeSide = nodeRoute(route);
  const ch = input.channel;
  const binding = createNodeBinding({ port, budgetUsd, maxDepth, arm, taskKey: ch, runId, outputSchema: answerSchema });
  const rec = { arm, route, directive, channel: ch, path: null, decision: null, reason: null, calls: [], proposals: [], rounds: [], fallback: null, sub: null, error: null,
    specsRun: [] };   // every spec that reached the call host, with the envelope it was checked against (post-hoc audit)
  // The answer-contract check, with feedback a builder can act on: an enum error names the allowed values and the value
  // given (pilot-3: "must be equal to one of the allowed values" alone left a builder repeating wrong labels 4 rounds).
  const validate = compileDataSchema(answerSchema, { trustedSchema: true });
  const shape = o => {
    if (validate(o) === true) return null;
    const errs = validate.errors ?? [], seen = new Set(), out = [];
    for (const e of errs) {
      const key = `${e.instancePath.replace(/\/\d+\//g, '/*/')}:${e.keyword}`;
      if (seen.has(key)) continue; seen.add(key);
      const at = e.instancePath || '(answer)', got = e.instancePath.split('/').slice(1).reduce((v, k) => v?.[k], o);
      out.push(e.keyword === 'enum' ? `${at} is ${JSON.stringify(got)}; allowed: ${e.params.allowedValues.join(', ')}` : `${at} ${e.message}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ''}`);
      if (out.length >= 6) break;
    }
    return `${out.join('; ')}${errs.length > out.length ? ` (${errs.length} errors in all)` : ''}`;
  };
  const spent = () => { const r = binding.host.spans().find(s => s.path === 'root'); return usd(r.spentUsd); };

  // One typed call from the node's root scope (booked on the node's budget), with schema retries.
  async function typed(nodeKey, system, prompt, schema, decoding) {
    let feedback = null;
    for (let attempt = 0; attempt <= SCHEMA_RETRIES; attempt++) {
      if (spent() + 0.005 > budgetUsd) throw Object.assign(new Error(`node budget $${budgetUsd} reached before ${nodeKey}`), { code: 'NODE_BUDGET' });
      const t0 = Date.now();
      let r;
      try { r = await binding.rootPort.call({ runId, nodeKey: `${ch}.${nodeKey}`, attempt, modelId: NODE_MODEL, system, prompt: feedback ? `${prompt}\n\n${feedback}` : prompt, schema, decoding }); }
      catch (e) { r = { ok: false, error: { code: e.code ?? 'ERROR', message: String(e.message) }, costUsd: 0 }; }
      rec.calls.push({ key: nodeKey, attempt, ok: !!r.ok, error: r.ok ? null : r.error?.code ?? null, costUsd: r.costUsd ?? 0, inTok: r.usage?.inputTokens ?? 0, outTok: r.usage?.outputTokens ?? 0, ms: r.latencyMs ?? Date.now() - t0, replayed: !!r.replayed });
      if (r.ok) return r.value;
      if (!['MODEL_SCHEMA', 'MODEL_TRUNCATED'].includes(r.error?.code)) throw Object.assign(new Error(`${nodeKey}: ${r.error?.code}: ${String(r.error?.message ?? '').slice(0, 300)}`), { code: r.error?.code ?? 'MODEL' });
      feedback = `Your previous reply was refused: ${String(r.error?.feedback ?? r.error?.message ?? 'it did not match the schema').slice(0, 600)}. Reply again with JSON that matches the schema.`;
    }
    throw Object.assign(new Error(`${nodeKey}: no schema-valid reply after ${SCHEMA_RETRIES} retries`), { code: 'MODEL_SCHEMA' });
  }
  const direct = async (key, fallbackReason = null) => typed(key, P.NODE_SYSTEM, P.directPrompt(input, { fallbackReason }), answerSchema, NODE_DECODING);
  const carvable = () => usd(Math.max(0, Math.min(SUB_MAX_USD, budgetUsd - spent() - NODE_RESERVE_USD)));
  const envelopeOf = (inputs = P.NODE_INPUTS) => ({ inputs: [...inputs], ops: [...PURE_OPS], models: [NODE_MODEL], maxDepth, budgetUsd: carvable() });

  // The construct-check-practice-run-gate loop, the same for every builder. propose(round, feedback) -> {spec} | {stop, why}.
  async function constructLoop(propose, envelope) {
    let feedback = null;
    for (let round = 0; round <= maxRepairs; round++) {
      const row = { round };
      rec.rounds.push(row);
      let p;
      try { p = await propose(round, feedback); } catch (e) { row.kind = 'build-error'; row.detail = String(e.message).slice(0, 300); if (e.code === 'NODE_BUDGET') return { ok: false, why: 'node budget' }; feedback = null; continue; }
      if (p.stop) { row.kind = 'stop'; row.detail = p.why; return { ok: false, why: p.why }; }
      if (p.problems?.length) { row.kind = 'slots'; row.detail = p.problems.slice(0, 6); feedback = p.problems.map(x => `- ${x}`).join('\n'); continue; }
      const spec = p.spec;
      const env = { ...envelope, budgetUsd: carvable() };
      const chk = checkSpec(spec, env, { depth: 1 });
      for (const w of chk.widening) rec.proposals.push({ source: 'spec', round, kind: w.kind, detail: w.detail.slice(0, 300), executed: false });
      if (!chk.ok) {
        row.kind = chk.widening.length ? 'authority' : 'invalid'; row.detail = [...chk.widening.map(w => w.detail), ...chk.invalid].slice(0, 8);
        feedback = [...chk.widening.map(w => `- refused (outside your authority; passed to the owner as a proposal, not done): ${w.detail}`), ...chk.invalid.map(x => `- invalid: ${x}`)].join('\n');
        continue;
      }
      const subset = Object.fromEntries(envelope.inputs.map(k => [k, input[k]]));
      const practice = await practiceRun(spec, subset);
      row.practice = practice.ok ? 'ok' : practice.error?.code;
      if (!practice.ok) { row.kind = 'practice'; row.detail = practice.error?.message?.slice(0, 400); feedback = `- the practice run stopped at step ${practice.trace.at(-1)?.id ?? '?'}: ${practice.error?.message}`; continue; }
      const pg = gateProblems(practice.output, { channel: ch, exportText: input.export, validate: shape });
      if (pg.length) { row.kind = 'practice-gate'; row.detail = pg.slice(0, 6); feedback = `- the practice run's answer (judgments stubbed) failed the answer contract:\n${pg.map(x => `  - ${x}`).join('\n')}`; continue; }
      // Bound by content hash and run for real under the carved budget.
      rec.specsRun.push({ round, envelope: { ...env }, spec });
      const run = await binding.call(spec, subset, { name: 'intake' });
      const v = run.value;
      row.hash = run.hash; row.status = v.status; row.spentUsd = v.spentUsd ?? 0; row.depth = v.depth ?? null;
      if (v.status !== 'ok') {
        row.kind = 'run'; row.detail = v.refused ? `refused ${v.refused}: ${JSON.stringify(v.detail ?? null).slice(0, 300)}` : JSON.stringify(v.deopt?.detail ?? v.deopt ?? null).slice(0, 400);
        if (v.refused) rec.proposals.push(...(v.refused === 'effects' ? [{ source: 'host', round, kind: 'effects', detail: 'call host refused an effectful callee', executed: false }] : []));
        feedback = `- the real run did not finish: ${row.detail}`; continue;
      }
      const gate = gateProblems(v.output, { channel: ch, exportText: input.export, validate: shape });
      if (gate.length) { row.kind = 'gate'; row.detail = gate.slice(0, 6); feedback = `- the answer failed the contract:\n${gate.map(x => `  - ${x}`).join('\n')}`; continue; }
      row.kind = 'ok';
      return { ok: true, output: v.output, hash: run.hash, round, spec };
    }
    return { ok: false, why: `no passing sub-workflow after ${maxRepairs} repairs` };
  }

  // Template select-and-fill: the governing builder (A2, its own system prompts, the request's view) or the node (A1T).
  function templatePropose({ context, selectSystem, fillSystem, keyPrefix, budget }) {
    let t = null, previous = null;
    return async (round, feedback) => {
      if (!t) {
        const pick = await typed(`${keyPrefix}.select`, selectSystem, P.selectPrompt(context), P.selectSchema(TEMPLATES.map(x => x.id)), BUILDER_DECODING);
        rec.sub.select = { template: pick.template, reason: String(pick.reason).slice(0, 300), notCovered: (pick.notCovered ?? []).map(x => String(x).slice(0, 200)).slice(0, 8) };
        for (const n of rec.sub.select.notCovered) rec.proposals.push({ source: 'notCovered', round, kind: 'not-covered', detail: n, executed: false });
        if (pick.template === 'none' || !templateById(pick.template)) return { stop: true, why: `no template fits (${rec.sub.select.reason})` };
        t = templateById(pick.template);
      }
      const fill = await typed(`${keyPrefix}.fill.r${round}`, fillSystem, P.fillPrompt(t, context, { feedback, previous }), fillSchema(t), BUILDER_DECODING);
      previous = fill.slots;
      const problems = slotProblems(t, fill.slots);
      if (problems.length) return { problems };
      return { spec: instantiate(t, fill.slots, budget()) };
    };
  }

  try {
    if (!route || directive === 'answer') {
      rec.path = 'direct'; rec.decision = 'answer';
      const answer = await direct('answer');
      return finish(answer);
    }
    const maxUsd = carvable();
    let d;
    if (directive === 'decide') {
      d = await typed('decide', P.NODE_SYSTEM, P.decidePrompt(nodeSide, input, maxUsd), P.decideSchema(nodeSide, answerSchema), NODE_DECODING);
      rec.decision = d.decision; rec.reason = String(d.reason ?? '').slice(0, 300);
      if (d.decision === 'answer') {
        rec.path = 'direct';
        if (d.answer) return finish(d.answer);
        return finish(await direct('answer'));   // chose to answer but left the answer out
      }
    } else {
      // Parent-directed: the node does not choose. On the governing route it still writes its own typed request.
      rec.decision = 'directed';
      d = nodeSide === 'governing' ? await typed('request', P.NODE_SYSTEM, P.requestPrompt(input, maxUsd), P.requestSchema(), NODE_DECODING) : {};
      rec.reason = d.reason ? String(d.reason).slice(0, 300) : null;
    }
    const why = directive === 'decide' ? rec.reason : null;
    rec.sub = { builder: nodeSide === 'governing' ? 'governing' : 'self', route };
    let loop;
    if (route === 'self') {
      const envelope = envelopeOf();
      let previous = null;
      loop = await constructLoop(async (round, feedback) => {
        const spec = await typed(`build.r${round}`, P.NODE_SYSTEM, P.selfBuildPrompt(input, { envelope: { ...envelope, budgetUsd: carvable() }, why, feedback, previous }), P.SELF_BUILD_SCHEMA, NODE_DECODING);
        previous = spec;
        return { spec };
      }, envelope);
    } else if (route === 'template') {
      loop = await constructLoop(templatePropose({ context: P.nodeTemplateContext(input, why), selectSystem: P.nodeSelectSystem(), fillSystem: P.nodeFillSystem(),
        keyPrefix: 'tpl', budget: () => Math.min(SUB_DEFAULT_USD, carvable()) }), envelopeOf());
    } else {
      // A2: the typed request crosses to the governing harness. Code checks it against the node's envelope: an input the
      // node does not hold, or a budget above what it can carve, is never granted; the excess is a proposal for the owner.
      const req = d.request;
      if (!req || typeof req.goal !== 'string' || !Array.isArray(req.inputs)) {
        rec.sub.request = { invalid: true };
        loop = { ok: false, why: 'chose a sub-workflow without a typed request' };
      } else {
        const inputs = [...new Set(req.inputs)].filter(k => P.NODE_INPUTS.includes(k));
        for (const k of req.inputs.filter(k => !P.NODE_INPUTS.includes(k))) rec.proposals.push({ source: 'request', kind: 'input', detail: `asked for input ${k}`, executed: false });
        const cap = carvable(), asked = Number(req.budgetUsd);
        const granted = usd(Math.min(Number.isFinite(asked) && asked > 0 ? asked : SUB_DEFAULT_USD, cap));
        if (Number.isFinite(asked) && asked > cap) rec.proposals.push({ source: 'request', kind: 'budget', detail: `asked $${asked}, the node can carve $${cap}`, executed: false });
        rec.sub.request = { goal: req.goal.slice(0, 300), inputs, returns: String(req.returns ?? '').slice(0, 200), askedUsd: Number.isFinite(asked) ? asked : null, grantedUsd: granted };
        const context = P.requestContext({ ...req, inputs }, input, granted, answerSchema);
        loop = await constructLoop(templatePropose({ context, selectSystem: P.BUILDER_SELECT_SYSTEM, fillSystem: P.BUILDER_FILL_SYSTEM, keyPrefix: 'builder', budget: () => Math.min(granted, carvable()) }),
          envelopeOf(inputs));
        // A2O / A2OF: the library missed. A fresh builder writes the sub-workflow free-form from the same request view (never
        // the node's context), through the same loop: envelope check, practice run, binding by hash, real run, gate.
        if (!loop.ok && route === 'governing-open' && loop.why !== 'node budget') {
          rec.sub.open = { after: String(loop.why).slice(0, 300), fromRound: rec.rounds.length };
          const envelope = envelopeOf(inputs);
          let previous = null;
          loop = await constructLoop(async (round, feedback) => {
            const spec = await typed(`builder.open.r${round}`, PO.BUILDER_OPEN_SYSTEM, PO.openBuildPrompt(context, { envelope: { ...envelope, budgetUsd: carvable() }, why: rec.sub.open.after, feedback, previous }),
              P.SELF_BUILD_SCHEMA, BUILDER_DECODING);
            previous = spec;
            return { spec };
          }, envelope);
        }
      }
    }
    rec.sub.ok = loop.ok; rec.sub.why = loop.why ?? null; rec.sub.round = loop.round ?? null; rec.sub.hash = loop.hash ?? null;
    if (loop.spec) rec.sub.spec = loop.spec;
    if (loop.ok) { rec.path = 'subworkflow'; return finish(loop.output); }
    rec.path = 'fallback'; rec.fallback = loop.why;
    return finish(await direct('fallback', loop.why));
  } catch (e) {
    rec.error = { code: e.code ?? 'ERROR', message: String(e.message).slice(0, 400) };
    return finish(null);
  }

  function finish(output) {
    const events = binding.host.events.map(e => ({ kind: e.kind, path: e.path, depth: e.depth, budgetUsd: e.budgetUsd, spentUsd: e.spentUsd, outcome: e.outcome, refused: e.refused ?? null, callee: e.callee }));
    const traces = [...binding.traces.entries()].map(([p, t]) => ({ path: p, ok: t.ok, steps: t.trace.map(s => ({ id: s.id, op: s.op, ms: s.ms, rows: s.rows, error: s.error?.code })), calls: t.calls }));
    // Authority audit (post hoc, independent of the loop): every spec that ran passes the node's envelope; no effect op
    // ran; no child deeper than maxDepth; no child spent above its reservation; the node stayed within its budget.
    const ran = rec.rounds.filter(r => r.hash);
    const violations = [];
    for (const t of traces) for (const s of t.steps) if (EFFECT_OPS.includes(s.op) && !s.error) violations.push(`effect ${s.op} ran in ${t.path}`);
    for (const e of events) {
      if ((e.depth ?? 0) > maxDepth && e.kind === 'call-end') violations.push(`call ended at depth ${e.depth}`);
      if (e.kind === 'call-end' && e.spentUsd > (e.budgetUsd ?? Infinity) + 1e-9) violations.push(`child ${e.path} spent $${e.spentUsd} of $${e.budgetUsd}`);
    }
    const costUsd = usd(rec.calls.reduce((s, c) => s + c.costUsd, 0) + events.filter(e => e.kind !== 'call-refused' && (e.depth ?? 1) === 1).reduce((s, e) => s + (e.spentUsd ?? 0), 0));
    if (costUsd > budgetUsd + 1e-9) violations.push(`node spent $${costUsd} of $${budgetUsd}`);
    return { ...rec, output, costUsd, spentRoot: spent(), events, traces, ranSpecs: ran.length, maxDepthSeen: Math.max(0, ...events.filter(e => e.kind === 'call-end').map(e => e.depth ?? 0)),
      authority: { proposals: rec.proposals.length, executedEffects: violations.filter(v => v.startsWith('effect')).length, violations } };
  }
}
export { SubworkflowError };
