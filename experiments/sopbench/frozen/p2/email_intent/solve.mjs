import { createFlow } from './tools/flow.mjs';
import { createSop } from './tools/sop.mjs';
const flow = createFlow({ budgetUsd: 0.05 });
const sop = createSop(flow);
const task = flow.input();
import { extractProductIds, extractSellerPrice, priceDeltaCents } from './lib/rules.mjs';

// SOP 5.2 intent labels and 5.2 action labels, exactly as the procedure and the expected answers spell them.
const INTENTS = [
  'concern about their product not being listed',
  'concern about incorrect pricing',
  'concern about incorrect description',
  'generic question about a listing',
  'unable to decide',
];
const ACTIONS = ['no action', 'update price', 'update description', 'share listing status', 'further clarification required'];
const CLARIFY = 'further clarification required';
const MAX_CANDIDATES = 10;
const DESCRIPTION_VERDICTS = ['different', 'same'];

// Section contracts: JSON schemas for each section's input and output.
const obj = (properties, required) => ({ type: 'object', required, properties });
const str = { type: 'string' };
const nullableStr = { type: ['string', 'null'] };
const actionOut = obj({ action: { type: 'string', enum: ACTIONS } }, ['action']);

// Judges (free-text judgments only; everything else is code).
const INTENT_SYSTEM = `You classify one seller email sent to a marketplace's seller support team. Choose exactly one intent:
- "concern about their product not being listed": the seller says a product, or its listing, is missing, not showing, not live, removed, or not searchable.
- "concern about incorrect pricing": the seller says the price shown for a product is wrong, or asks for a price to be changed or corrected.
- "concern about incorrect description": the seller says a product's description, specs or details are wrong, missing, or should say something different.
- "generic question about a listing": a general question or request for help or information about listings, categories, setup or how-to, with no specific complaint about price, description or listing status.
- "unable to decide": the email fits none of the above, or it is too unclear to tell.
Classify by what the seller is complaining about or asking for. Give the label text exactly as written above.`;
const INTENT_SCHEMA = obj({ reason: str, intent: { type: 'string', enum: INTENTS } }, ['reason', 'intent']);

const DESCRIPTION_SYSTEM = `You compare what a seller's email says about a product description with the product's current catalog description. The email reports that the description is wrong or missing something; it may not say exactly what the correct content is. Decide:
- "different": the current description is significantly different from what the seller asks for. It lacks the content, specs or details the seller says are missing, or it says something else. If the email names a problem but not the correct content, the description is still "different" unless the current description already shows the thing the email says is missing or wrong.
- "same": the current description already covers what the seller says is missing or wrong, so the difference is not significant.
Give one of the two words exactly as written above.`;
const DESCRIPTION_SCHEMA = obj({ reason: str, verdict: { type: 'string', enum: DESCRIPTION_VERDICTS } }, ['reason', 'verdict']);

const asText = v => (v == null ? null : String(v));
const emailBody = String(task.inputs.email_body ?? '');
const marketplaceId = asText(task.inputs.marketplace_id);

// SOP 5.1 Email Classification and Validation: product_id from the body by regular expression, validated by the catalog.
const productId = await sop.section('5.1 Email Classification and Validation', {
  input: obj({ email_body: str, fallback_product_id: nullableStr }, ['email_body', 'fallback_product_id']),
  output: obj({ product_id: nullableStr }, ['product_id']),
  tools: ['get_product_description'],
}, { email_body: emailBody, fallback_product_id: asText(task.inputs.product_id) }, async (input, port) => {
  const fromInput = typeof input.fallback_product_id === 'string' ? extractProductIds(input.fallback_product_id) : [];
  const candidates = [...new Set([...extractProductIds(input.email_body), ...fromInput])].slice(0, MAX_CANDIDATES);
  if (!candidates.length) return { product_id: null };
  const results = await port.batch(candidates.map(id => ({ name: 'get_product_description', arguments: { product_id: id } })));
  const hit = results.findIndex(r => r.ok);
  return { product_id: hit === -1 ? null : candidates[hit] };
}).then(out => out.product_id);

// SOP 5.2 Intent-Based Processing: the intent of the email body (free-text judgment).
const intent = await sop.section('5.2 Intent-Based Processing', {
  input: obj({ email_body: str }, ['email_body']),
  output: obj({ seller_intent: { type: 'string', enum: INTENTS } }, ['seller_intent']),
  tools: [],
}, { email_body: emailBody }, async input => {
  const v = await flow.judge('5.2-intent', {
    tiers: ['claude-haiku-5-5'], system: INTENT_SYSTEM, schema: INTENT_SCHEMA, maxTokens: 400,
    prompt: `Seller email:\n"""\n${input.email_body}\n"""`,
    check: v => (INTENTS.includes(v?.intent) ? null : 'not an intent label'),
  });
  return { seller_intent: v.intent };
}).then(out => out.seller_intent);

// SOP 5.2(a) Listing status concern: current listing status and inventory, summarised for the seller.
const listingStatus = (product, marketplace) => sop.section('5.2(a) Listing status concern', {
  input: obj({ product_id: nullableStr, marketplace_id: nullableStr }, ['product_id', 'marketplace_id']),
  output: obj({ action: { type: 'string', enum: ACTIONS }, status_summary: str }, ['action', 'status_summary']),
  tools: ['get_product_listing_status', 'get_inventory_status'],
}, { product_id: product, marketplace_id: marketplace }, async (input, port) => {
  if (!input.product_id || !input.marketplace_id) return { action: CLARIFY, status_summary: 'no validated product' };
  const [status, stock] = await port.batch([
    { name: 'get_product_listing_status', arguments: { product_id: input.product_id, marketplace_id: input.marketplace_id, include_history: true } },
    { name: 'get_inventory_status', arguments: { product_id: input.product_id, marketplace_id: input.marketplace_id } },
  ]);
  if (!status.ok) return { action: CLARIFY, status_summary: `listing status unavailable: ${status.error}` };
  const current = status.value?.current_status || 'no current status';
  const units = stock.ok ? `stock ${stock.value?.current_stock}` : `stock unavailable: ${stock.error}`;
  return { action: 'share listing status', status_summary: `${current}; ${units}` };
});

// SOP 5.2(b) Pricing concern: seller price against the listed price; any delta means update price.
const pricing = (product, marketplace, body) => sop.section('5.2(b) Pricing concern', {
  input: obj({ email_body: str, product_id: nullableStr, marketplace_id: nullableStr }, ['email_body', 'product_id', 'marketplace_id']),
  output: actionOut,
  tools: ['get_product_price'],
}, { email_body: body, product_id: product, marketplace_id: marketplace }, async (input, port) => {
  const sellerPrice = extractSellerPrice(input.email_body);
  if (!input.product_id || !input.marketplace_id || sellerPrice == null) return { action: CLARIFY };
  const r = await port.tryCall('get_product_price', { product_id: input.product_id, marketplace_id: input.marketplace_id });
  const listed = r.ok ? Number(r.value?.listing_price) : NaN;
  if (!Number.isFinite(listed)) return { action: CLARIFY };
  return { action: priceDeltaCents(sellerPrice, listed) !== 0 ? 'update price' : 'no action' };
});

// SOP 5.2(c) Description concern: is the catalog description significantly different from the requested one?
const description = (product, body) => sop.section('5.2(c) Description concern', {
  input: obj({ email_body: str, product_id: nullableStr }, ['email_body', 'product_id']),
  output: actionOut,
  tools: ['get_product_description'],
}, { email_body: body, product_id: product }, async (input, port) => {
  if (!input.product_id) return { action: CLARIFY };
  const r = await port.tryCall('get_product_description', { product_id: input.product_id });
  const current = r.ok ? r.value?.product_description : null;
  if (typeof current !== 'string') return { action: CLARIFY };
  const v = await flow.judge('5.2(c)-description-match', {
    tiers: ['claude-haiku-5-5'], system: DESCRIPTION_SYSTEM, schema: DESCRIPTION_SCHEMA, maxTokens: 400,
    prompt: `Seller email:\n"""\n${input.email_body}\n"""\n\nCurrent catalog description:\n"""\n${current}\n"""`,
    check: v => (DESCRIPTION_VERDICTS.includes(v?.verdict) ? null : 'not a verdict'),
  });
  return { action: v.verdict === 'different' ? 'update description' : 'no action' };
});

// SOP 5.2(d) Generic inquiry: document the category and give the standard response; no action.
const generic = () => sop.section('5.2(d) Generic inquiry', {
  input: obj({}, []),
  output: actionOut,
  tools: [],
}, {}, async () => ({ action: 'no action' }));

// SOP 5.2(e) Unable to decide: further clarification.
const unable = () => sop.section('5.2(e) Unable to decide', {
  input: obj({}, []),
  output: actionOut,
  tools: [],
}, {}, async () => ({ action: CLARIFY }));

// SOP 5.2 branch by intent. Each branch yields the action.
let action;
if (intent === INTENTS[0]) action = (await listingStatus(productId, marketplaceId)).action;
else if (intent === INTENTS[1]) action = (await pricing(productId, marketplaceId, emailBody)).action;
else if (intent === INTENTS[2]) action = (await description(productId, emailBody)).action;
else if (intent === INTENTS[3]) action = (await generic()).action;
else action = (await unable()).action;

// SOP 6.1 Output: seller_intent and action.
sop.done({ seller_intent: intent, action });
