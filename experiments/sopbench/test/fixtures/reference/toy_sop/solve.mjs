// Test fixture: a workflow for the toy SOP (experiments/sopbench/test/fixtures/data/toy_sop), two typed sections.
import { createFlow } from './tools/flow.mjs';
import { createSop } from './tools/sop.mjs';

const flow = createFlow({ budgetUsd: 0 });
const sop = createSop(flow);
const task = flow.input();
const item = await sop.section('1 look up', {
  input: { type: 'object', required: ['item_id'], properties: { item_id: { type: 'string' } } },
  output: { type: 'object', required: ['qty', 'price'], properties: { qty: { type: 'integer' }, price: { type: 'number' } } },
  tools: ['get_item'],
}, { item_id: task.inputs.item_id }, async (input, port) => {
  const r = await port.call('get_item', { item_id: input.item_id });
  return { qty: r.qty, price: r.price };
});
const d = await sop.section('2 decide', {
  input: { type: 'object', required: ['qty', 'price'], properties: { qty: { type: 'integer' }, price: { type: 'number' } } },
  output: { type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['ship', 'review', 'backorder'] } } },
  tools: [],
}, item, async x => ({ decision: x.qty === 0 ? 'backorder' : x.price > 100 ? 'review' : 'ship' }));
sop.done({ decision: d.decision });
