import { createFlow } from './tools/flow.mjs';
import { createSop } from './tools/sop.mjs';
const flow = createFlow({ budgetUsd: 0.05 });
const sop = createSop(flow);
const task = flow.input();

import { QVT_DEFAULT, classifyQuantity, classifyLocation, chargebackAmount, resolutionStatus } from './lib/rules.mjs';

const i = task.inputs;
const shipment = {
  po_number: String(i.po_number),
  vendor_id: String(i.vendor_id),
  vendor_name: String(i.vendor_name),
  confirmed_product_id: String(i.confirmed_product_id),
  received_product_bar_code: String(i.received_product_bar_code),
  ordered_quantity: Number(i.ordered_quantity),
  confirmed_quantity: Number(i.confirmed_quantity),
  received_quantity: Number(i.received_quantity),
  intended_warehouse_id: String(i.intended_warehouse_id),
  actual_warehouse_id: String(i.actual_warehouse_id),
  package_image_path: String(i.package_image_path),
  unit_cost: i.unit_cost == null ? null : Number(i.unit_cost),
  // The task's chargeable flag (true when the vendor is liable for a chargeback); absent means chargeable.
  chargeable: i.chargeable == null ? true : String(i.chargeable).trim().toLowerCase() === 'true',
  qvt: Number(i.QVT ?? QVT_DEFAULT),
};

const problemList = { type: 'array', items: { type: 'string' } };

// 5.1.1 Barcode Validation: the received product must match the confirmed product (image processing).
const barcode = await sop.section('5.1.1 Barcode Validation', {
  input: { type: 'object', required: ['po_number', 'confirmed_product_id', 'received_product_bar_code'], properties: {
    po_number: { type: 'string' }, confirmed_product_id: { type: 'string' }, received_product_bar_code: { type: 'string' } } },
  output: { type: 'object', required: ['barcode_match', 'problem_type'], properties: {
    barcode_match: { type: 'boolean' }, problem_type: problemList } },
  tools: ['validateBarcode'],
}, { po_number: shipment.po_number, confirmed_product_id: shipment.confirmed_product_id, received_product_bar_code: shipment.received_product_bar_code },
  async (input, port) => {
    const r = await port.call('validateBarcode', { po_number: input.po_number, confirmed_product_id: input.confirmed_product_id,
      received_product_bar_code: input.received_product_bar_code });
    const match = r.barcode_match === true;
    return { barcode_match: match, problem_type: match ? [] : ['Wrong Item'] };
  });

let problems = barcode.problem_type;

// Sections 5.2.x run only when the barcode matches: a wrong item skips the rest of the procedure.
if (barcode.barcode_match) {
  // 5.2.1 Quantity Discrepancy Assessment (rules in lib/rules.mjs).
  const quantity = await sop.section('5.2.1 Quantity Discrepancy Assessment', {
    input: { type: 'object', required: ['ordered_quantity', 'confirmed_quantity', 'received_quantity', 'qvt'], properties: {
      ordered_quantity: { type: 'integer' }, confirmed_quantity: { type: 'integer' }, received_quantity: { type: 'integer' }, qvt: { type: 'number' } } },
    output: { type: 'object', required: ['variance_pct', 'problem_type'], properties: {
      variance_pct: { type: ['number', 'null'] }, problem_type: problemList } },
    tools: [],
  }, { ordered_quantity: shipment.ordered_quantity, confirmed_quantity: shipment.confirmed_quantity, received_quantity: shipment.received_quantity, qvt: shipment.qvt },
    async input => classifyQuantity({ ordered: input.ordered_quantity, confirmed: input.confirmed_quantity, received: input.received_quantity, qvt: input.qvt }));

  // 5.2.2 Location Verification: actual against intended warehouse.
  const location = await sop.section('5.2.2 Location Verification', {
    input: { type: 'object', required: ['intended_warehouse_id', 'actual_warehouse_id'], properties: {
      intended_warehouse_id: { type: 'string' }, actual_warehouse_id: { type: 'string' } } },
    output: { type: 'object', required: ['location_match', 'problem_type'], properties: {
      location_match: { type: 'boolean' }, problem_type: problemList } },
    tools: [],
  }, { intended_warehouse_id: shipment.intended_warehouse_id, actual_warehouse_id: shipment.actual_warehouse_id },
    async input => classifyLocation({ intended: input.intended_warehouse_id, actual: input.actual_warehouse_id }));

  // 5.2.3 Condition Assessment: damage detection on the package image.
  const condition = await sop.section('5.2.3 Condition Assessment', {
    input: { type: 'object', required: ['po_number', 'package_image_path'], properties: {
      po_number: { type: 'string' }, package_image_path: { type: 'string' } } },
    output: { type: 'object', required: ['damaged', 'problem_type'], properties: {
      damaged: { type: 'boolean' }, problem_type: problemList } },
    tools: ['assessPackageCondition'],
  }, { po_number: shipment.po_number, package_image_path: shipment.package_image_path }, async (input, port) => {
    const r = await port.call('assessPackageCondition', { po_number: input.po_number, package_image_path: input.package_image_path });
    const damaged = r.package_condition === 'damaged' || (Array.isArray(r.problem_type) && r.problem_type.includes('Vendor Damaged'));
    return { damaged, problem_type: damaged ? ['Vendor Damaged'] : [] };
  });

  problems = [...quantity.problem_type, ...location.problem_type, ...condition.problem_type];
}

// 5.3 Resolution Pathway Determination: chargeback (5.3.1) and resolution status (5.3.2, initialised as Pending).
const resolution = await sop.section('5.3 Resolution Pathway Determination', {
  input: { type: 'object', required: ['problem_type', 'ordered_quantity', 'received_quantity', 'unit_cost', 'chargeable'], properties: {
    problem_type: problemList, ordered_quantity: { type: 'integer' }, received_quantity: { type: 'integer' }, unit_cost: { type: ['number', 'null'] },
    chargeable: { type: 'boolean' } } },
  output: { type: 'object', required: ['resolution_status', 'chargeback_amount'], properties: {
    resolution_status: { type: 'string' }, chargeback_amount: { type: ['number', 'null'] } } },
  tools: [],
}, { problem_type: problems, ordered_quantity: shipment.ordered_quantity, received_quantity: shipment.received_quantity, unit_cost: shipment.unit_cost, chargeable: shipment.chargeable },
  async input => ({
    resolution_status: resolutionStatus({ problem_type: input.problem_type, chargeable: input.chargeable }),
    chargeback_amount: chargebackAmount({ problem_type: input.problem_type, ordered: input.ordered_quantity, received: input.received_quantity,
      unit_cost: input.unit_cost, chargeable: input.chargeable }),
  }));

// 5.3.2 Resolution Status Update: record the status in the system; the recorded value is a cross-check only.
const recorded = await sop.section('5.3.2 Resolution Status Update', {
  input: { type: 'object', required: ['po_number', 'problem_type', 'current_status'], properties: {
    po_number: { type: 'string' }, problem_type: problemList, current_status: { type: 'string' } } },
  output: { type: 'object', required: ['system_status'], properties: { system_status: { type: ['string', 'null'] } } },
  tools: ['updateResolutionStatus'],
}, { po_number: shipment.po_number, problem_type: problems, current_status: 'Pending' }, async (input, port) => {
  const r = await port.tryCall('updateResolutionStatus', { po_number: input.po_number, problem_type: input.problem_type, current_status: input.current_status });
  return { system_status: r.ok && typeof r.value?.resolution_status === 'string' ? r.value.resolution_status : null };
});
if (recorded.system_status !== null && recorded.system_status !== resolution.resolution_status) {
  flow.flag('status-disagrees', { computed: resolution.resolution_status, system: recorded.system_status });
}

// 6 Output: the Problem Classification Report (a record; it does not change the answer).
await sop.section('6 Output', {
  input: { type: 'object', required: ['po_number', 'vendor_id', 'vendor_name', 'problem_type', 'resolution_status', 'chargeback_amount'], properties: {
    po_number: { type: 'string' }, vendor_id: { type: 'string' }, vendor_name: { type: 'string' }, problem_type: problemList,
    resolution_status: { type: 'string' }, chargeback_amount: { type: ['number', 'null'] } } },
  output: { type: 'object', required: ['report_id'], properties: { report_id: { type: ['string', 'null'] } } },
  tools: ['generateProblemReport'],
}, { po_number: shipment.po_number, vendor_id: shipment.vendor_id, vendor_name: shipment.vendor_name, problem_type: problems,
  resolution_status: resolution.resolution_status, chargeback_amount: resolution.chargeback_amount },
  async (input, port) => {
    const args = { po_number: input.po_number, vendor_id: input.vendor_id, vendor_name: input.vendor_name, problem_type: input.problem_type,
      resolution_status: input.resolution_status };
    if (input.chargeback_amount !== null) args.charge_amount = input.chargeback_amount;
    const r = await port.tryCall('generateProblemReport', args);
    return { report_id: r.ok && typeof r.value?.report_id === 'string' ? r.value.report_id : null };
  });

sop.done({ resolution_status: resolution.resolution_status });
