import { createFlow } from './tools/flow.mjs';
import { createSop } from './tools/sop.mjs';
const flow = createFlow({ budgetUsd: 0.05 });
const sop = createSop(flow);
const task = flow.input();
import { UNABLE, isProductId, scoreFromTool, computeHazardScore, hazardClassOf } from './lib/hazard.mjs';

const inputs = task.inputs ?? {};
const text = v => String(v ?? '');
const SCORE = { type: ['integer', 'null'] };
const TEXT_INPUT = { type: 'object', required: ['product_id', 'text'], properties: { product_id: { type: 'string' }, text: { type: 'string' } } };
const SCORE_OUTPUT = { type: 'object', required: ['score'], properties: { score: SCORE } };

// 5.2-5.5: one tool per section. Blank text is not sent (the tool requires minLength 1); a tool error leaves the score missing.
const componentSection = (name, { tool, field, scoreKey, maxLength = Infinity }) => (productId, value) => sop.section(name, {
  input: TEXT_INPUT,
  output: SCORE_OUTPUT,
  tools: [tool],
}, { product_id: productId, text: text(value) }, async (input, port) => {
  const body = input.text.trim().slice(0, maxLength);
  if (!body) return { score: null };
  const r = await port.tryCall(tool, { product_id: input.product_id, [field]: body });
  return { score: r.ok ? scoreFromTool(r.value, scoreKey) : null };
});

const scoreSds = componentSection('5.2 Safety Data Sheet Analysis', { tool: 'calculate_sds_label_score', field: 'sds_label_text', scoreKey: 'sds_label_score', maxLength: 1000 });
const scoreHandling = componentSection('5.3 Handling and Storage Evaluation', { tool: 'calculate_handling_score', field: 'handling_and_storage_guidelines', scoreKey: 'handling_score', maxLength: 2000 });
const scoreTransport = componentSection('5.4 Transportation Requirements Assessment', { tool: 'calculate_transportation_score', field: 'transportation_requirements', scoreKey: 'transportation_score' });
const scoreDisposal = componentSection('5.5 Disposal Guidelines Evaluation', { tool: 'calculate_disposal_score', field: 'disposal_guidelines', scoreKey: 'disposal_score' });

// 5.1: format check on the product ID; no tools.
const validation = await sop.section('5.1 Initial Data Validation', {
  input: { type: 'object', required: ['product_id'], properties: { product_id: { type: 'string' } } },
  output: { type: 'object', required: ['valid', 'product_id'], properties: { valid: { type: 'boolean' }, product_id: { type: 'string' } } },
  tools: [],
}, { product_id: text(inputs.product_id) }, async input => {
  const productId = input.product_id.trim();
  return { valid: isProductId(productId), product_id: productId };
});

// Invalid ID: no further action, so no component is scored.
const components = { safety: null, handling: null, transportation: null, disposal: null };
if (validation.valid) {
  components.safety = (await scoreSds(validation.product_id, inputs.sds_label_text)).score;
  components.handling = (await scoreHandling(validation.product_id, inputs.handling_and_storage_guidelines)).score;
  components.transportation = (await scoreTransport(validation.product_id, inputs.transportation_requirements)).score;
  components.disposal = (await scoreDisposal(validation.product_id, inputs.disposal_guidelines)).score;
}

// 5.6: cumulative hazard score with imputation and the more-than-two-missing rule.
const total = await sop.section('5.6 Hazard Score Computation', {
  input: {
    type: 'object',
    required: ['product_id_valid', 'components'],
    properties: {
      product_id_valid: { type: 'boolean' },
      components: { type: 'object', required: ['safety', 'handling', 'transportation', 'disposal'], properties: { safety: SCORE, handling: SCORE, transportation: SCORE, disposal: SCORE } },
    },
  },
  output: {
    type: 'object',
    required: ['unable', 'hazard_score', 'missing', 'imputed', 'reason'],
    properties: {
      unable: { type: 'boolean' },
      hazard_score: { type: 'integer' },
      missing: { type: 'array', items: { type: 'string' } },
      imputed: { type: 'array', items: { type: 'string' } },
      reason: { type: ['string', 'null'] },
    },
  },
  tools: [],
}, { product_id_valid: validation.valid, components }, async input => computeHazardScore(input.components, input.product_id_valid));
if (total.imputed.length) flow.flag('components-imputed', { imputed: total.imputed, hazard_score: total.hazard_score });

// 5.7: hazard class from the score band, or Unable to Decide.
const classification = await sop.section('5.7 Hazard Class Determination', {
  input: { type: 'object', required: ['unable', 'hazard_score'], properties: { unable: { type: 'boolean' }, hazard_score: { type: 'integer' } } },
  output: { type: 'object', required: ['hazard_class'], properties: { hazard_class: { type: 'string' } } },
  tools: [],
}, { unable: total.unable, hazard_score: total.hazard_score }, async input => ({
  hazard_class: input.unable ? UNABLE : hazardClassOf(input.hazard_score),
}));

sop.done({ hazard_class: classification.hazard_class });
