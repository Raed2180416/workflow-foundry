// The two-model filter (JUDGE-PROGRAM.md §2.3 rule 1; JUDGE-BUILD-PLAN.json heldout-author): an
// authored line is admitted only if BOTH Sonnet 5.5 and Opus 5.5, asked the port question zero-shot
// (Q0, the frozen contract, no hints), recover the brief's label; any disagreement or miss rejects it.
// It is a filter on text, not a labeller: the label stays the brief's. Rejects are logged with both
// answers.
//
// This module makes no model call. The hosted-arms group supplies the providers:
//   provider({ model, port, request, mode }) -> Promise<{ answer } | string>
//     request  the JudgmentPort request {port, question, criteria, state, options, optionDescriptions}
//     mode     'label' (answer one of request.options) or 'nondeciding' (answer one of request.options,
//              or ABSTAIN when the text does not settle the question; the harness never changes the
//              port's options, the provider adds the abstain choice)
// Model ids come only from policy/models.json (resolveFilterModels): the claude model of class L is
// Sonnet 5.5, the one of class F is Opus 5.5.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../lib/contracts.mjs';
import { filterRequests } from './fill.mjs';
import { AuthorError } from './pools.mjs';

export const ABSTAIN = 'cannot_tell';
export const FILTER_MODEL_IDS = Object.freeze({ sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' });

export function resolveFilterModels(policy = JSON.parse(readFileSync(path.join(REPO_ROOT, 'policy', 'models.json'), 'utf8'))) {
  const ids = new Set(policy.models.map(m => m.id));
  for (const [k, id] of Object.entries(FILTER_MODEL_IDS)) if (!ids.has(id)) throw new AuthorError('FILTER_MODEL', `${k} model ${id} is not in policy/models.json`);
  return { ...FILTER_MODEL_IDS };
}

const answerOf = r => (typeof r === 'string' ? r : r?.answer ?? null);

// Ask both models one request. Returns {sonnet, opus, ok}.
export async function askBoth(providers, models, req) {
  const [sonnet, opus] = await Promise.all(['sonnet', 'opus'].map(async k => answerOf(await providers[k]({ model: models[k], port: req.request.port, request: req.request, mode: req.mode }))));
  const want = req.mode === 'nondeciding' ? ABSTAIN : req.expect;
  return { sonnet, opus, expect: want, ok: sonnet === want && opus === want };
}

// Filter units: each unit passes only if every request it implies passes with both models.
// Returns {units (with .filter set), rejects}. Units already admitted or rejected are skipped.
export async function runTwoModelFilter(units, { contracts, providers, cities = [], models = resolveFilterModels(), only = u => u.status === 'pending-filter' } = {}) {
  if (typeof providers?.sonnet !== 'function' || typeof providers?.opus !== 'function') throw new AuthorError('FILTER_PROVIDERS', 'both a sonnet and an opus provider are required (the hosted-arms group supplies them)');
  const rejects = [];
  for (const u of units) {
    if (!only(u)) continue;
    const checked = [];
    for (const req of filterRequests(u, contracts, { cities })) checked.push({ id: req.id, ...(await askBoth(providers, models, req)) });
    const ok = checked.every(c => c.ok);
    u.filter = { sonnet: checked.map(c => c.sonnet), opus: checked.map(c => c.opus), expect: checked.map(c => c.expect), models };
    u.status = ok ? 'admitted' : 'rejected';
    if (!ok) rejects.push({ id: u.id, port: u.port, label: u.label ?? null, role: u.role ?? 'decisive', text: u.text, checked, models });
  }
  return { units, rejects };
}

// The reject log (one JSON line per rejected unit, both answers per request) — appended by the caller.
export const rejectLogLines = rejects => rejects.map(r => JSON.stringify(r)).join('\n') + (rejects.length ? '\n' : '');

// Invariant the acceptance test checks on any surface file: a unit is `admitted` only with both
// recorded answers equal to what the brief expects; a `rejected` unit carries both answers too.
export function checkFilterInvariant(unit) {
  const f = unit.filter;
  if (unit.status === 'admitted') {
    if (!f || !f.sonnet?.length || !f.opus?.length) return `${unit.id}: admitted without both model answers`;
    if (!f.expect.every((e, i) => f.sonnet[i] === e && f.opus[i] === e)) return `${unit.id}: admitted although a model answer differs from the brief`;
  } else if (unit.status === 'rejected') {
    if (!f || !f.sonnet?.length || !f.opus?.length) return `${unit.id}: rejected without both model answers`;
  } else if (f) return `${unit.id}: status ${unit.status} but filter answers present`;
  return null;
}
