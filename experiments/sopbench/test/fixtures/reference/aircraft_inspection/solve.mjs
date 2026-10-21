// Hand-written REFERENCE workflow for aircraft_inspection: a $0 test fixture for the W-H execution path (exec.mjs,
// tools/sop.mjs sections, bridge, graders). Not an arm and not capability evidence: it was written by the harness author,
// and this SOP's tools return its answer columns directly (NOTES.md §7.4), so it only proves the plumbing.
import { createFlow } from './tools/flow.mjs';
import { createSop } from './tools/sop.mjs';

const flow = createFlow({ budgetUsd: 0 });
const sop = createSop(flow);
const task = flow.input();
const I = task.inputs;
const py = v => (v === null || v === undefined ? null : typeof v === 'boolean' ? (v ? 'True' : 'False') : String(v));
const S = { type: 'object' }, STR = { type: ['string', 'null'] };
const pick = (...ks) => Object.fromEntries(ks.map(k => [k, I[k]]));

const clearance = await sop.section('clearance', { input: S, output: { type: 'object', required: ['aircraft_ready'], properties: { aircraft_ready: STR } }, tools: ['VerifyAircraftClearance'] },
  pick('aircraft_id', 'tail_number', 'maintenance_record_id', 'expected_departure_time'),
  async (input, port) => ({ aircraft_ready: py((await port.call('VerifyAircraftClearance', input)).aircraft_ready) }));

const inspect = await sop.section('inspections', { input: S, output: { type: 'object', required: ['mechanical', 'electrical'], properties: { mechanical: STR, electrical: STR } }, tools: ['VerifyMechanicalComponents', 'VerifyElectricalSystems'] },
  I, async (input, port) => {
    const [m, e] = await port.batch([
      { name: 'VerifyMechanicalComponents', arguments: pick('aircraft_id', 'component_serial_number', 'inspection_location_id', 'component_weight', 'physical_condition_observation', 'installation_time') },
      { name: 'VerifyElectricalSystems', arguments: pick('aircraft_id', 'battery_status', 'circuit_continuity_check', 'avionics_diagnostics_response') },
    ]);
    return { mechanical: m.ok ? py(m.value.mechanical_inspection_result) : null, electrical: e.ok ? py(e.value.electrical_inspection_result) : null };
  });

const reports = await sop.section('reports', { input: S, output: { type: 'object', required: ['incident', 'mismatch', 'cross_check', 'cross_check_reporting'], properties: { incident: STR, mismatch: STR, cross_check: STR, cross_check_reporting: STR } },
  tools: ['ReportComponentIncident', 'ReportComponentMismatch', 'CrossCheckSpecifications', 'ReportCrossCheck'] }, inspect, async (ins, port) => {
  const [inc, mis, cc] = await port.batch([
    { name: 'ReportComponentIncident', arguments: { aircraft_id: I.aircraft_id, mechanical_inspection_result: ins.mechanical, electrical_inspection_result: ins.electrical } },
    { name: 'ReportComponentMismatch', arguments: pick('aircraft_id', 'component_serial_number', 'installed_component_serial_number', 'inspection_location_id') },
    { name: 'CrossCheckSpecifications', arguments: pick('aircraft_id', 'component_weight', 'expected_component_weight', 'installation_time', 'actual_inspection_time') },
  ]);
  const incident = inc.ok ? py(inc.value.component_incident_response) : null, mismatch = mis.ok ? py(mis.value.component_mismatch_response) : null;
  const rep = await port.tryCall('ReportCrossCheck', { maintenance_record_id: I.maintenance_record_id, aircraft_id: I.aircraft_id, component_incident_response: incident, component_mismatch_response: mismatch });
  return { incident, mismatch, cross_check: cc.ok ? py(cc.value.cross_check_response) : null, cross_check_reporting: rep.ok ? py(rep.value.cross_check_reporting_response) : null };
});

sop.done({ aircraft_ready: clearance.aircraft_ready, mechanical_inspection_result: inspect.mechanical, electrical_inspection_result: inspect.electrical,
  component_incident_response: reports.incident, component_mismatch_response: reports.mismatch, cross_check_response: reports.cross_check,
  cross_check_reporting_response: reports.cross_check_reporting });
