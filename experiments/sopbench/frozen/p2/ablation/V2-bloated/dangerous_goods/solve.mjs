import { createFlow } from './tools/flow.mjs';
import { createSop } from './tools/sop.mjs';
import { COMPONENTS, PRODUCT_ID_FORMAT, UNABLE, usableScore, hazardScore, hazardClass } from './lib/rules.mjs';

const flow = createFlow({ budgetUsd: 0.05 });
const sop = createSop(flow);
const task = flow.input();

const inputs = task.inputs ?? {};
const text = v => (typeof v === 'string' ? v : '');
const productId = text(inputs.product_id);

// 5.1 Initial Data Validation: the product ID format. A bad format means no further action.
const validation = await sop.section('5.1 Initial Data Validation', {
  input: { type: 'object', required: ['product_id'], properties: { product_id: { type: 'string' } } },
  output: { type: 'object', required: ['format_valid'], properties: { format_valid: { type: 'boolean' } } },
  tools: [],
}, { product_id: productId }, async input => ({ format_valid: PRODUCT_ID_FORMAT.test(input.product_id) }));

// 5.2-5.5: one score per SOP step, each from its calculate_* tool. Blank text is missing and not sent.
// A "No product found" answer means the reference does not resolve, so no further scoring runs.
const SCORE_STEPS = [
  { id: 'sds', name: '5.2 Safety Data Sheet Analysis', tool: 'calculate_sds_label_score', field: 'sds_label_text', result: 'sds_label_score' },
  { id: 'handling', name: '5.3 Handling and Storage Evaluation', tool: 'calculate_handling_score', field: 'handling_and_storage_guidelines', result: 'handling_score' },
  { id: 'transportation', name: '5.4 Transportation Requirements Assessment', tool: 'calculate_transportation_score', field: 'transportation_requirements', result: 'transportation_score' },
  { id: 'disposal', name: '5.5 Disposal Guidelines Evaluation', tool: 'calculate_disposal_score', field: 'disposal_guidelines', result: 'disposal_score' },
];
const scoreInput = {
  type: 'object',
  required: ['product_id', 'document_text'],
  properties: { product_id: { type: 'string' }, document_text: { type: 'string' } },
};
const scoreOutput = {
  type: 'object',
  required: ['status', 'score'],
  properties: {
    status: { enum: ['scored', 'missing', 'unresolved'] },
    score: { type: ['number', 'null'], minimum: 1, maximum: 5 },
  },
};

const scores = {}, statuses = {};
let stop = !validation.format_valid;
for (const step of SCORE_STEPS) {
  if (stop) { scores[step.id] = null; statuses[step.id] = 'skipped'; continue; }
  const out = await sop.section(step.name, { input: scoreInput, output: scoreOutput, tools: [step.tool] },
    { product_id: productId, document_text: text(inputs[step.field]) }, async (input, port) => {
      if (input.document_text.trim() === '') return { status: 'missing', score: null };
      const r = await port.tryCall(step.tool, { product_id: input.product_id, [step.field]: input.document_text });
      if (!r.ok) return /no product|not found|does not exist|unknown product|invalid product/i.test(r.error) ? { status: 'unresolved', score: null } : { status: 'missing', score: null };
      const score = usableScore(r.value?.[step.result]);
      return score == null ? { status: 'missing', score: null } : { status: 'scored', score };
    });
  scores[step.id] = out.score;
  statuses[step.id] = out.status;
  if (out.status === 'unresolved') stop = true;
}
const resolved = !Object.values(statuses).includes('unresolved');

// 5.6 Hazard Score Computation: impute, sum, and mark the score 0 when no decision is possible.
const hazard = await sop.section('5.6 Hazard Score Computation', {
  input: {
    type: 'object',
    required: ['format_valid', 'resolved', 'scores'],
    properties: {
      format_valid: { type: 'boolean' },
      resolved: { type: 'boolean' },
      scores: {
        type: 'object',
        required: COMPONENTS,
        properties: Object.fromEntries(COMPONENTS.map(c => [c, { type: ['number', 'null'] }])),
      },
    },
  },
  output: {
    type: 'object',
    required: ['decidable', 'hazard_score', 'reason'],
    properties: {
      decidable: { type: 'boolean' },
      hazard_score: { type: 'number', minimum: 0, maximum: 20 },
      reason: { type: 'string' },
    },
  },
  tools: [],
}, { format_valid: validation.format_valid, resolved, scores: Object.fromEntries(COMPONENTS.map(c => [c, scores[c]])) },
  async input => {
    if (!input.format_valid) return { decidable: false, hazard_score: 0, reason: 'product ID format invalid' };
    if (!input.resolved) return { decidable: false, hazard_score: 0, reason: 'product ID not resolvable' };
    return hazardScore(input.scores);
  });

// 5.7 Hazard Class Determination: the band of the hazard score, or Unable to Decide.
const classified = await sop.section('5.7 Hazard Class Determination', {
  input: {
    type: 'object',
    required: ['decidable', 'hazard_score'],
    properties: { decidable: { type: 'boolean' }, hazard_score: { type: 'number' } },
  },
  output: { type: 'object', required: ['hazard_class'], properties: { hazard_class: { type: 'string' } } },
  tools: [],
}, { decidable: hazard.decidable, hazard_score: hazard.hazard_score },
  async input => ({ hazard_class: input.decidable ? hazardClass(input.hazard_score) : UNABLE }));

sop.done({ hazard_class: classified.hazard_class });
