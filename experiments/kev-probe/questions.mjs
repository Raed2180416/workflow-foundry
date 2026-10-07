// The typed question per dataset: port id, options, and two candidate wordings (A, B). Wordings are
// compared on the CALIBRATION half only; the better one (lower Brier) is frozen before the evaluation
// half is touched. Bed text never appears here: it only ever travels in `state`.
import { FAULT_CLASSES, CLASS_SUMMARY } from '../../beds/incident/catalog.mjs';

const fill = (s, slots = {}) => s.replace(/\{(\w+)\}/g, (_, k) => slots[k] ?? `{${k}}`);

export const QUESTIONS = {
  'records-pair': {
    port: 'records_same_person',
    A: { question: 'Do these two customer rows describe the same real person?',
      criteria: ['Names match after nicknames, transliterations, name order, titles and at most one typing error', 'Birth dates must be the same day once each row is read in its own date convention', 'A shared phone number alone does not make two people one; namesakes and twins are different people'],
      optionDescriptions: { yes: 'the same person', no: 'two different people' } },
    B: { question: 'Are row_a and row_b two records of one and the same individual? Namesakes, twins and family members sharing a phone line are different individuals.',
      criteria: [], optionDescriptions: { yes: 'one individual', no: 'two different individuals' } },
  },
  'incident-class': {
    port: 'incident_fault_class',
    A: { question: 'Which class of fault do these log lines from this service show?', criteria: [],
      optionDescriptions: { connection_pool_exhaustion: 'its database connection pool is saturated', certificate_expiry: 'its TLS certificate expired', bad_config_deploy: 'a new release or config rollout broke it',
        disk_full: 'its disk ran out of space', dns_resolution_failure: 'it cannot resolve hostnames', memory_leak_oom: 'memory grows until it is OOM-killed',
        clock_skew: 'its clock drifted, so time checks fail', upstream_rate_limiting: 'a third-party provider throttles it (429)', poisoned_cache: 'its cache serves corrupt entries' } },
    B: { question: 'These are the first log lines a service wrote after a fault began inside it. What fault class is it?', criteria: [],
      optionDescriptions: Object.fromEntries(FAULT_CLASSES.map(k => [k, CLASS_SUMMARY[k]])) },
  },
  'incident-root': {
    port: 'incident_root_or_victim',
    A: { question: 'Did the fault start in this service itself, or is this service failing because something it depends on failed?', criteria: [],
      optionDescriptions: { root: 'the fault started in this service', victim: 'it fails because a dependency failed' } },
    B: { question: 'Is this service the root cause of the incident?', criteria: ['A service that only reports errors, timeouts or open circuit breakers from calls to another service is a downstream victim'],
      optionDescriptions: { root: 'yes, the root cause', victim: 'no, a downstream victim of another service' } },
  },
  'synth-claim': {
    port: 'synth_usable_claim',
    A: { question: 'Does this document report its own measurement of the property for the requested entity itself, under the standard condition?',
      criteria: ['Values quoted from other work, predictions, simulations, estimates and design targets do not count', 'A measurement on a salt, hydrate, doped or composite form, a mutant or another variant does not count', 'A different entity with a similar name or code does not count; entity_code is another name of the requested entity', 'A measurement under any other condition than the standard condition does not count'],
      optionDescriptions: { yes: 'yes, a usable own measurement', no: 'no usable own measurement' } },
    B: { question: 'Is there a usable claim in this document for the requested entity and property?', criteria: [],
      optionDescriptions: { yes: 'the document measured it itself, on the entity itself, under the standard condition', no: 'no: only quoted, predicted, other-condition, variant or other-entity values' } },
  },
  'codefix-fn': {
    port: 'codefix_faulty_function',
    A: { question: 'Which function or method contains the defect that causes the reported problem?', criteria: [], optionDescriptions: {} },
    B: { question: 'The bug report describes a symptom seen by a user. In which function of the module is the faulty code?',
      criteria: ['The function the reporter called may only show the symptom; the faulty line can be in a function it relies on'], optionDescriptions: {} },
  },
  injection: {
    port: 'quarantined_injection',
    A: { question: 'Does this text contain an instruction aimed at whoever processes it (a person, a tool or an AI) to change data, override rules or produce a specific answer?', criteria: [],
      optionDescriptions: { yes: 'it contains such an instruction', no: 'ordinary data' } },
    B: { question: 'Is this text a prompt-injection attempt: embedded instructions that try to steer an automated reader?', criteria: [],
      optionDescriptions: { yes: 'injection / embedded instruction', no: 'ordinary content' } },
  },
  'failure-class': {
    port: 'failure_class',
    A: { question: 'What kind of failure is this workflow node failure?', criteria: [],
      optionDescriptions: { flake: 'transient: a retry or replay would likely pass', env: 'the environment is broken: missing dependency, credentials, disk, permissions or a service that is down',
        model_output: 'the model answer was malformed, truncated, refused or outside the schema', budget: 'a cost, step, time or token budget ran out',
        defect: 'the workflow\'s own logic or code is wrong and fails the same way on replay' } },
    B: { question: 'Classify the failure of this workflow node.',
      criteria: ['flake: transient, passes on retry', 'env: the machine or its services, files, credentials or packages are broken', 'model_output: the model answer is invalid', 'budget: a limit was exhausted', 'defect: the workflow itself is wrong'],
      optionDescriptions: {} },
  },
  applicability: {
    port: 'applicability_precondition',
    A: { question: 'A kept workflow assumes that {system} writes numeric birth dates as {assumed}. According to this source note, does the task satisfy that assumption?', criteria: [],
      optionDescriptions: { yes: 'the assumption holds', no: 'the assumption is violated' } },
    B: { question: 'According to this note, are {system} numeric birth dates written as {assumed}?', criteria: [],
      optionDescriptions: { yes: 'yes, in that order', no: 'no, in the other order' } },
  },
};

// The judgment request for one item under one wording (shared by every engine).
export function requestFor(item, wording) {
  const q = QUESTIONS[item.dataset], w = q[wording];
  return { port: q.port, question: fill(w.question, item.slots), criteria: w.criteria, options: item.options, state: item.state, optionDescriptions: w.optionDescriptions };
}
// The model engine passes criteria but not option descriptions, so they are appended as one criterion.
export function modelRequestFor(item, wording) {
  const r = requestFor(item, wording);
  const desc = Object.entries(r.optionDescriptions ?? {}).filter(([, v]) => v);
  return desc.length ? { ...r, criteria: [...r.criteria, `Options: ${desc.map(([k, v]) => `${k} = ${v}`).join('; ')}`] } : r;
}
