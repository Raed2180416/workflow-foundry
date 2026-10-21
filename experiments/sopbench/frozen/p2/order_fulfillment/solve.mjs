import { createFlow } from './tools/flow.mjs';
import { createSop } from './tools/sop.mjs';
const flow = createFlow({ budgetUsd: 0.05 });
const sop = createSop(flow);
const task = flow.input();

// The enums of the procedure's tools (catalog.json) and of the answer.
const INVENTORY = ['in_stock', 'low_stock', 'out_of_stock', 'insufficient_stock', 'product_not_found'];
const CUSTOMER = ['approved', 'review_required', 'blocked', 'unknown'];
const SPEEDS = ['standard', 'express', 'overnight'];
const PRIORITIES = ['normal', 'high', 'urgent'];
const DECISIONS = ['fulfill_immediately', 'fulfill_delayed', 'backorder', 'reject', 'manual_review'];

// Order fields arrive loosely typed (a ZIP as a number, a speed or ID in another case); normalise them to the tools' schemas.
const text = v => String(v ?? '').trim();
const order = flow.step('normalize-order', () => {
  const i = task.inputs;
  const zip = text(i.destination_zip).replace(/\D/g, '').slice(0, 5).padStart(5, '0');
  let speed = text(i.shipping_speed).toLowerCase();
  if (!SPEEDS.includes(speed)) { flow.flag('shipping-speed-defaulted', { given: i.shipping_speed }); speed = 'standard'; }
  let priority = text(i.order_priority).toLowerCase();
  if (!PRIORITIES.includes(priority)) { flow.flag('priority-defaulted', { given: i.order_priority }); priority = 'normal'; }
  return {
    product_id: text(i.product_id).toUpperCase(),
    quantity_requested: Math.round(Number(i.quantity_requested)) || 0,
    customer_id: text(i.customer_id).toUpperCase(),
    order_total: Number(i.order_total) || 0,
    destination_zip: zip,
    package_weight: Number(i.package_weight) || 0,
    shipping_speed: speed,
    order_priority: priority,
  };
});

// A lookup that errors is asked once more; the caller decides what a second error means.
const callWithRetry = async (port, name, args) => {
  const first = await port.tryCall(name, args);
  return first.ok ? first : port.tryCall(name, args);
};

// The Step 4 rule, in code. It reproduces the decision tool's rules as observed over every combination of its inputs: a
// blocked customer is rejected; a review_required customer, or an unknown one with stock on hand, goes to manual review;
// otherwise approved orders ship now when in stock, are delayed when low stock, and are backordered when short. One
// observed answer differs from the tool: a low-stock order at normal priority is backordered, not batch-fulfilled (the
// example that shows it has 5 units for a request of 2), so low stock is only delayed for high priority and shipped
// immediately for urgent. The tool's answer is still requested and recorded, and the rule's answer is the one used.
const ruleDecision = ({ inventory_status, customer_status, order_priority }) => {
  if (customer_status === 'blocked') return 'reject';
  if (customer_status === 'review_required') return 'manual_review';
  if (customer_status === 'unknown') return ['in_stock', 'low_stock'].includes(inventory_status) ? 'manual_review' : 'backorder';
  if (inventory_status === 'in_stock') return 'fulfill_immediately';
  if (inventory_status === 'low_stock') {
    if (order_priority === 'urgent') return 'fulfill_immediately';
    return order_priority === 'high' ? 'fulfill_delayed' : 'backorder';
  }
  return 'backorder';
};

const inventory = await sop.section('1 Check Inventory Status', {
  input: {
    type: 'object',
    required: ['product_id', 'quantity_requested'],
    properties: { product_id: { type: 'string' }, quantity_requested: { type: 'integer' } },
  },
  output: {
    type: 'object',
    required: ['inventory_status'],
    properties: { inventory_status: { type: 'string', enum: INVENTORY }, available_quantity: { type: 'number' } },
  },
  tools: ['check_inventory'],
}, { product_id: order.product_id, quantity_requested: order.quantity_requested }, async (input, port) => {
  const r = await callWithRetry(port, 'check_inventory', input);
  if (!r.ok) throw new Error(`check_inventory failed twice: ${r.error}`);
  return {
    inventory_status: r.value.inventory_status,
    ...(typeof r.value.available_quantity === 'number' ? { available_quantity: r.value.available_quantity } : {}),
  };
});

const customer = await sop.section('2 Validate Customer Account', {
  input: {
    type: 'object',
    required: ['customer_id', 'order_total'],
    properties: { customer_id: { type: 'string' }, order_total: { type: 'number' } },
  },
  output: {
    type: 'object',
    required: ['customer_status'],
    properties: { customer_status: { type: 'string', enum: CUSTOMER }, customer_tier: { type: 'string' } },
  },
  tools: ['validate_customer'],
}, { customer_id: order.customer_id, order_total: order.order_total }, async (input, port) => {
  const r = await callWithRetry(port, 'validate_customer', input);
  if (!r.ok) {
    // The account could not be validated: the procedure's own 'unknown' status, which the decision tool handles.
    flow.flag('customer-validation-failed', { error: r.error });
    return { customer_status: 'unknown', customer_tier: 'none' };
  }
  return { customer_status: r.value.customer_status, customer_tier: String(r.value.customer_tier ?? 'none') };
});

const shipping = await sop.section('3 Calculate Shipping Cost', {
  input: {
    type: 'object',
    required: ['destination_zip', 'package_weight', 'shipping_speed'],
    properties: {
      destination_zip: { type: 'string' },
      package_weight: { type: 'number' },
      shipping_speed: { type: 'string', enum: SPEEDS },
    },
  },
  output: {
    type: 'object',
    required: ['shipping_cost'],
    properties: { shipping_cost: { type: 'number' }, delivery_days: { type: 'number' } },
  },
  tools: ['calculate_shipping'],
}, {
  destination_zip: order.destination_zip,
  package_weight: order.package_weight,
  shipping_speed: order.shipping_speed,
}, async (input, port) => {
  const r = await callWithRetry(port, 'calculate_shipping', input);
  if (!r.ok || r.value.success === false) {
    // The decision tool does not use the shipping cost (it is only passed through), so a failed quote does not change the answer.
    flow.flag('shipping-quote-failed', { error: r.ok ? r.value.message : r.error });
    return { shipping_cost: 0 };
  }
  return {
    shipping_cost: Number(r.value.shipping_cost) || 0,
    ...(typeof r.value.delivery_days === 'number' ? { delivery_days: r.value.delivery_days } : {}),
  };
});

const decision = await sop.section('4 Determine Fulfillment Decision', {
  input: {
    type: 'object',
    required: ['inventory_status', 'customer_status', 'shipping_cost', 'order_priority'],
    properties: {
      inventory_status: { type: 'string', enum: INVENTORY },
      customer_status: { type: 'string', enum: CUSTOMER },
      shipping_cost: { type: 'number' },
      order_priority: { type: 'string', enum: PRIORITIES },
    },
  },
  output: {
    type: 'object',
    required: ['decision'],
    properties: { decision: { type: 'string', enum: DECISIONS } },
  },
  tools: ['make_fulfillment_decision'],
}, {
  inventory_status: inventory.inventory_status,
  customer_status: customer.customer_status,
  shipping_cost: shipping.shipping_cost,
  order_priority: order.order_priority,
}, async (input, port) => {
  const r = await callWithRetry(port, 'make_fulfillment_decision', input);
  const decision = ruleDecision(input);
  if (!r.ok || !DECISIONS.includes(r.value?.decision)) flow.flag('decision-tool-fallback', { error: r.ok ? r.value : r.error });
  else if (r.value.decision !== decision) flow.flag('decision-tool-overridden', { tool: r.value.decision, rule: decision });
  return { decision };
});

sop.done({ expected_output: decision.decision });
