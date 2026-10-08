// The judge for the n8n:12679 job. It never looks at how a solution is built: it replays the episode record (the API
// calls a solution made while handling each event) in a fresh environment and judges (a) the state of both systems after every
// scripted step against the intent model, and (b) the call trace for echo loops and duplicate creates.
//
// Violation codes (each scenario lists the ones it hit):
//   MISSING_ZOHO / MISSING_KT      an expected record is absent          EXTRA_ZOHO / EXTRA_KT   a record nobody should have
//   DUP_ZOHO / DUP_KT              two records share an email            DUP_CREATE              a create call for an email that already existed
//   LINK_BROKEN                    the two ids are not cross-linked      UNEXPECTED_LINK         an unsynced record carries a link
//   FIELD_MISMATCH:<side>.<field>  a mapped field differs                CONVERGENCE:<field>     systems disagree after concurrent edits
//   OPTOUT_MISMATCH                Zoho Email_Opt_Out != (KlickTipp status is not Subscribed)
//   STATUS_WRONG / LIST_WRONG / TAG_MISSING:<key>   KlickTipp status, opt-in list, creation tag
//   SEGMENT_MISMATCH:<side>        segment tags differ from the expectation          ID_UNSTABLE   a record was replaced instead of updated
//   ECHO_LOOP                      events were still being generated after the run cap   ECHO_WRITE   a write made while handling an API-origin event
import { replay, scenarioList, driveSync, LIMITS } from './env.mjs';
import { CONFIG } from './scenarios.mjs';
import { zohoNeutral, ktNeutral, NEUTRAL } from './spec.mjs';
import { normEmail } from './mocks/common.mjs';
import { makeFaithful } from './controls/reference.mjs';

export const T3_COST_RATIO = 1.0;       // an improved solution may use at most this share of the faithful reference's external calls (dev-frozen 2026-10-08)
const MAX_ACTIONS = 10000, MAX_TEXT = 3_000_000;       // an honest episode is ~500 actions (difficulty 5)

export function normalizeOutput(output) {
  let text;
  try { text = JSON.stringify(output); } catch { return { error: 'output is not JSON-serialisable' }; }
  if (typeof text !== 'string') return { error: 'output is not JSON' };
  if (text.length > MAX_TEXT) return { error: 'output is too large' };
  const v = JSON.parse(text);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'output must be an object' };
  if (Object.keys(v).some(k => !['actions', 'meta'].includes(k))) return { error: 'unexpected property' };
  if (!Array.isArray(v.actions)) return { error: 'actions must be an array' };
  if (v.actions.length > MAX_ACTIONS) return { error: 'too many actions' };
  for (const a of v.actions) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return { error: 'every action must be an object' };
    if (typeof a.call !== 'string' || a.call.length > 64) return { error: 'action.call must be a string of at most 64 characters' };
    if (Object.keys(a).some(k => !['call', 'args'].includes(k))) return { error: 'unexpected action property' };
    if ('args' in a && (a.args === null || typeof a.args !== 'object' || Array.isArray(a.args))) return { error: 'action.args must be an object' };
  }
  return { value: v };
}

const norm = (k, v) => (v === null || v === undefined ? '' : k === 'email' ? normEmail(v) : String(v));
const setEq = (a, b) => a.length === b.length && a.every(x => b.includes(x));

// ----------------------------------------------------------------------------------------------- state judge
function judgeState(exp, state, refs, prev, cfg, add) {
  const zf = cfg.klicktipp.fields.zohoContactId, K = cfg.klicktipp.tags;
  const group = (rows, em) => { const m = new Map(); for (const r of rows) { const e = normEmail(em(r)); if (e) m.set(e, [...(m.get(e) ?? []), r]); } return m; };
  const zBy = group(state.zoho, r => r.Email), kBy = group(state.kt, s => s.email);
  const zClaim = new Set(), kClaim = new Set();
  const segsOfZoho = zr => cfg.segments.filter(s => zr.Tag.some(t => String(t.name).toLowerCase() === s.zohoTag.toLowerCase())).map(s => s.key).sort();
  const segsOfKt = kr => cfg.segments.filter(s => kr.tags.includes(K[s.klicktippTag].id)).map(s => s.key).sort();

  for (const [ref, p] of Object.entries(exp.people)) {
    let zr = null, kr = null;
    if (p.z) {
      const em = normEmail(p.z.f.email);
      const c = em ? zBy.get(em) ?? [] : state.zoho.filter(r => r.id === refs[ref]?.zohoId);
      c.forEach(r => zClaim.add(r.id));
      if (!c.length) add('MISSING_ZOHO', `${ref}: no Zoho contact${em ? ` with email ${em}` : ''}`);
      else { if (c.length > 1) add('DUP_ZOHO', `${ref}: ${c.length} Zoho contacts share ${em}`); zr = c[0]; }
    }
    if (p.k) {
      const em = normEmail(p.k.f.email);
      const c = kBy.get(em) ?? [];
      c.forEach(r => kClaim.add(r.id));
      if (!c.length) add('MISSING_KT', `${ref}: no KlickTipp subscriber with email ${em}`);
      else { if (c.length > 1) add('DUP_KT', `${ref}: ${c.length} subscribers share ${em}`); kr = c[0]; }
    }
    const zn = zr && zohoNeutral(zr), kn = kr && ktNeutral(kr);
    for (const k of NEUTRAL) {
      if (p.converge) {
        const ok = side => side && p.converge[k].some(x => norm(k, x) === norm(k, side[k]));
        if (zn && !ok(zn)) add(`FIELD_MISMATCH:zoho.${k}`, `${ref}: zoho.${k}=${JSON.stringify(zn[k])} is neither the old value nor an edit`);
        if (kn && !ok(kn)) add(`FIELD_MISMATCH:klicktipp.${k}`, `${ref}: klicktipp.${k}=${JSON.stringify(kn[k])} is neither the old value nor an edit`);
        if (zn && kn && norm(k, zn[k]) !== norm(k, kn[k])) add(`CONVERGENCE:${k}`, `${ref}: ${k} differs between systems (${JSON.stringify(zn[k])} vs ${JSON.stringify(kn[k])})`);
        continue;
      }
      if (zn && norm(k, zn[k]) !== norm(k, p.z.f[k])) add(`FIELD_MISMATCH:zoho.${k}`, `${ref}: zoho.${k}=${JSON.stringify(zn[k])}, expected ${JSON.stringify(p.z.f[k])}`);
      if (kn && norm(k, kn[k]) !== norm(k, p.k.f[k])) add(`FIELD_MISMATCH:klicktipp.${k}`, `${ref}: klicktipp.${k}=${JSON.stringify(kn[k])}, expected ${JSON.stringify(p.k.f[k])}`);
    }
    if (kr) {
      if (kr.status !== p.k.status) add('STATUS_WRONG', `${ref}: status ${kr.status}, expected ${p.k.status}`);
      if (kr.listId !== cfg.klicktipp.lists[p.k.list].id) add('LIST_WRONG', `${ref}: list ${kr.listId}, expected ${p.k.list} (${cfg.klicktipp.lists[p.k.list].id})`);
      for (const t of p.k.tags) if (!kr.tags.includes(K[t].id)) add(`TAG_MISSING:${t}`, `${ref}: subscriber lacks the ${t} tag`);
      if (!setEq(segsOfKt(kr), p.k.segs)) add('SEGMENT_MISMATCH:klicktipp', `${ref}: segments ${JSON.stringify(segsOfKt(kr))}, expected ${JSON.stringify(p.k.segs)}`);
    }
    if (zr && !setEq(segsOfZoho(zr), p.z.segs)) add('SEGMENT_MISMATCH:zoho', `${ref}: segments ${JSON.stringify(segsOfZoho(zr))}, expected ${JSON.stringify(p.z.segs)}`);
    if (p.linked && zr && kr) {
      if (String(zr.KlickTipp_ID ?? '') !== kr.id) add('LINK_BROKEN', `${ref}: Zoho KlickTipp_ID=${zr.KlickTipp_ID} but the subscriber id is ${kr.id}`);
      if (String(kr[zf] ?? '') !== zr.id) add('LINK_BROKEN', `${ref}: subscriber ${zf}=${kr[zf]} but the Zoho id is ${zr.id}`);
      if (zr.Email_Opt_Out !== (kr.status !== 'Subscribed')) add('OPTOUT_MISMATCH', `${ref}: Email_Opt_Out=${zr.Email_Opt_Out} with status ${kr.status}`);
    }
    if (!p.linked) {
      if (zr && zr.KlickTipp_ID) add('UNEXPECTED_LINK', `${ref}: Zoho contact carries KlickTipp_ID ${zr.KlickTipp_ID}`);
      if (kr && kr[zf]) add('UNEXPECTED_LINK', `${ref}: subscriber carries ${zf} ${kr[zf]}`);
    }
    const was = prev[ref] ?? {};
    if (zr && was.z && was.z !== zr.id) add('ID_UNSTABLE', `${ref}: Zoho contact replaced (${was.z} -> ${zr.id})`);
    if (kr && was.k && was.k !== kr.id) add('ID_UNSTABLE', `${ref}: subscriber replaced (${was.k} -> ${kr.id})`);
    prev[ref] = { z: zr?.id, k: kr?.id };
  }
  for (const r of state.zoho) if (!zClaim.has(r.id)) add('EXTRA_ZOHO', `Zoho contact ${r.id} (${normEmail(r.Email) || 'no email'}) should not exist`);
  for (const s of state.kt) if (!kClaim.has(s.id)) add('EXTRA_KT', `subscriber ${s.id} (${normEmail(s.email)}) should not exist`);
}

export function judgeScenario(sc, rec, cfg = CONFIG) {
  const violations = [], seen = new Set();
  let at = '';
  const add = (code, msg) => { const key = `${code}|${msg}`; if (!seen.has(key) && violations.length < 40) { seen.add(key); violations.push({ code, msg: at ? `[${at}] ${msg}` : msg }); } };
  const prev = {};
  sc.steps.forEach((s, i) => {
    const st = rec.steps[i];
    at = s.label;
    if (!st) { add('NOT_REACHED', `step ${i} never completed`); return; }
    if (st.capped) add('ECHO_LOOP', `still producing events after ${LIMITS.runsPerQuiescence} runs per originating change`);
    judgeState(s.expect, st.state, st.refs, prev, cfg, add);
  });
  at = '';
  for (const c of rec.calls) {
    if (c.write && c.status < 300 && c.origin === 'api') add('ECHO_WRITE', `${c.name} while handling an event caused by the integration's own write (${c.trigger})`);
    if (c.dupOf) add('DUP_CREATE', `zoho.createContact for an email that already existed (${c.dupOf})`);
  }
  const codes = [...new Set(violations.map(v => v.code))];
  return { id: sc.id, kind: sc.kind, title: sc.title, pass: violations.length === 0, codes, violations };
}

// ----------------------------------------------------------------------------------------------- cost
export function costOf(recs, kinds = ['core']) {
  const byCall = {};
  let calls = 0, writes = 0, failed = 0, redundant = 0, runs = 0, latency = 0;
  for (const r of recs) {
    if (!kinds.includes(r.kind)) continue;
    runs += r.runs;
    for (const c of r.calls) {
      if (c.name.startsWith('state.')) continue;
      calls++; byCall[c.name] = (byCall[c.name] ?? 0) + 1;
      latency += CONFIG.latencyMs[c.name.split('.')[0]] ?? 0;
      if (c.status >= 400) failed++;
      if (c.write && c.status < 300) { writes++; if (!c.effective) redundant++; }
    }
  }
  return { externalCalls: calls, writes, failedCalls: failed, redundantWrites: redundant, runs, simulatedSequentialLatencyMs: latency, byCall };
}
// External calls of the faithful reference on this task's core scenarios: the yardstick for the T3 cost target.
export function baselineCalls(task) {
  const t = { ...task, variant: 'T2' };
  const { env } = replay(t, driveSync(t, makeFaithful(CONFIG)).actions);
  return costOf(env._records()).externalCalls;
}

// ----------------------------------------------------------------------------------------------- oracle
export function oracle(task, rawOutput) {
  const n = normalizeOutput(rawOutput);
  if (n.error) return { pass: false, score: 0, details: { reason: `schema: ${n.error}` } };
  const { env, replayed, unansweredRuns } = replay(task, n.value.actions);
  const recs = env._records(), list = env._scenarios();
  const results = list.map((sc, i) => judgeScenario(sc, recs[i]));
  const core = results.filter(r => r.kind === 'core'), probes = results.filter(r => r.kind === 'probe');
  const cost = costOf(recs);
  let target = null, costOk = true;
  if (task.variant === 'T3') { target = Math.ceil(T3_COST_RATIO * baselineCalls(task)); costOk = cost.externalCalls <= target; }
  const coreOk = core.every(r => r.pass), probesOk = probes.every(r => r.pass);
  const all = task.variant === 'T3' ? results : core;
  const score = all.filter(r => r.pass).length / all.length;
  return {
    pass: coreOk && probesOk && costOk,
    score,
    details: {
      variant: task.variant, coreFailed: core.filter(r => !r.pass).map(r => r.id), probesFailed: probes.filter(r => !r.pass).map(r => r.id),
      corePassed: core.filter(r => r.pass).length, coreTotal: core.length, probesPassed: probes.filter(r => r.pass).length, probesTotal: probes.length,
      cost: { ...cost, target, withinTarget: task.variant === 'T3' ? costOk : null, ratioToReference: task.variant === 'T3' ? Number((cost.externalCalls / baselineCalls(task)).toFixed(3)) : null }, replayedActions: replayed, unansweredRuns,
      scenarios: results.map(({ id, kind, pass, codes, violations }) => ({ id, kind, pass, codes, violations: violations.slice(0, 6) })),
    },
  };
}
