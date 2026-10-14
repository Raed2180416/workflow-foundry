// need-qa subtype (b) "lookup": questions across two generated tables joined by a key (parcels.port_code -> ports.code).
// size scales the row counts of both tables; steps scales the join work:
//   steps 1: attribute of the port of one named parcel
//   steps 2: same, but the parcel is found by (client, status) (exactly one match)
//   steps 3: one parcel's charge = crates x fee of its port
//   steps 4: total charge of one client's parcels whose status is not S
//   steps 5: same, also restricted to ports in one region (a filter on the joined table)
import { ROWS, uniqueNames, uniqueCodes, uniqueInts, sum, composePrompt, FORM } from './core.mjs';

const N_PORTS = [4, 5, 7, 9, 12];
const N_CLIENTS = [2, 3, 4, 5, 7];
const N_REGIONS = [3, 3, 4, 4, 5];
const LABEL = { port: 'port name', region: 'region', fee: 'fee per crate', dock_days: 'number of dock days' };
const CHARGE_RULE = "A parcel's charge is its number of crates multiplied by the fee of its port.";

const truthOf = (attr, port) => (attr === 'port' || attr === 'region' ? { kind: 'text', value: port[attr] } : { kind: 'int', value: String(port[attr]) });

export function buildLookup(r, { size, steps }) {
  const n = ROWS[size - 1];
  const used = new Set();
  const [company] = uniqueNames(r, 1, used);
  const regions = uniqueNames(r, N_REGIONS[size - 1], used);
  const clients = uniqueNames(r, N_CLIENTS[size - 1], used);
  const portNames = uniqueNames(r, N_PORTS[size - 1], used);
  const codes = uniqueCodes(r, N_PORTS[size - 1]);
  const ports = portNames.map((port, i) => ({ code: codes[i], port, region: r.pick(regions), fee: r.int(2, 40), dock_days: r.int(1, 9) })).sort((a, b) => (a.code < b.code ? -1 : 1));
  const statuses = size <= 2 ? ['held', 'sent', 'delivered'] : ['held', 'sent', 'delivered', 'returned'];
  const parcels = uniqueInts(r, n, 100, 9999).map(id => ({ id: `PC-${String(id).padStart(4, '0')}`, client: r.pick(clients), port_code: r.pick(ports).code, crates: r.int(1, 60), status: r.pick(statuses) }));
  const portOf = parcel => ports.find(p => p.code === parcel.port_code);
  const charge = parcel => parcel.crates * portOf(parcel).fee;
  const adjacentPort = parcel => ports[(ports.indexOf(portOf(parcel)) + 1) % ports.length];

  let question, truth, nearCandidates = [], alternatives = [];
  const attr = r.pick(['port', 'region', 'fee', 'dock_days']);

  if (steps === 1 || steps === 2 || steps === 3) {
    let parcel, group;
    if (steps === 2) {
      const unique = parcels.filter(p => parcels.filter(q => q.client === p.client && q.status === p.status).length === 1 && parcels.filter(q => q.client === p.client).length >= 2);
      if (!unique.length) return null;
      parcel = r.pick(unique);
      group = parcels.filter(q => q.client === parcel.client && q.id !== parcel.id);
      question = `What is the ${LABEL[attr]} of the port used by the parcel of client ${parcel.client} whose status is ${parcel.status}? Exactly one parcel matches.`;
    } else {
      parcel = r.pick(parcels);
      group = [];
      question = steps === 1
        ? `What is the ${LABEL[attr]} of the port that parcel ${parcel.id} is routed to?`
        : `What is the shipping charge for parcel ${parcel.id}? ${CHARGE_RULE}`;
    }
    const port = portOf(parcel);
    if (steps === 3) {
      truth = { kind: 'int', value: String(charge(parcel)) };
      nearCandidates = [
        { name: 'forgot-crates', truth: { kind: 'int', value: String(port.fee) } },
        { name: 'wrong-port-row', truth: { kind: 'int', value: String(parcel.crates * adjacentPort(parcel).fee) } },
        { name: 'forgot-fee', truth: { kind: 'int', value: String(parcel.crates) } },
      ];
    } else {
      truth = truthOf(attr, port);
      const neighbour = parcels[(parcels.indexOf(parcel) + 1) % parcels.length];
      nearCandidates = [
        ...group.map(g => ({ name: 'same-client-other-parcel', truth: truthOf(attr, portOf(g)) })),
        { name: 'adjacent-port-row', truth: truthOf(attr, adjacentPort(parcel)) },
        { name: 'neighbouring-parcel', truth: truthOf(attr, portOf(neighbour)) },
      ];
      if (truth.kind === 'text') alternatives = [...new Set(ports.map(p => p[attr]))].filter(v => v !== truth.value).map(v => ({ kind: 'text', value: v }));
    }
  } else {
    const client = r.pick(clients);
    const status = r.pick(statuses);
    const mine = parcels.filter(p => p.client === client);
    if (mine.length < 3) return null;
    const keep = mine.filter(p => p.status !== status);
    let selected = keep, region = null;
    if (steps === 5) {
      region = r.pick(keep.length ? keep.map(p => portOf(p).region) : regions);
      selected = keep.filter(p => portOf(p).region === region);
    }
    if (selected.length < 2 || keep.length === mine.length) return null;      // the excluded status must actually remove a parcel
    truth = { kind: 'int', value: String(sum(selected.map(charge))) };
    nearCandidates = [
      { name: 'kept-excluded-status', truth: { kind: 'int', value: String(sum((steps === 5 ? mine.filter(p => portOf(p).region === region) : mine).map(charge))) } },
      ...(steps === 5 ? [{ name: 'ignored-region', truth: { kind: 'int', value: String(sum(keep.map(charge))) } }] : []),
      { name: 'summed-fees-not-charges', truth: { kind: 'int', value: String(sum(selected.map(p => portOf(p).fee))) } },
    ];
    question = steps === 4
      ? `What is the total shipping charge of all parcels of client ${client} whose status is not ${status}? ${CHARGE_RULE}`
      : `What is the total shipping charge of all parcels of client ${client} whose status is not ${status} and whose port is in the region ${region}? ${CHARGE_RULE}`;
  }

  const near = [];
  for (const c of nearCandidates) if (c.truth.value !== truth.value && !near.some(x => x.truth.value === c.truth.value)) near.push(c);
  if (!near.length) return null;
  const intro = `Freight records of the ${company} shipping network. inputs.json has two tables joined on the port code: "parcels" (id, client, port_code, crates, status) and "ports" (code, port, region, fee, dock_days). The fee is in credits per crate.`;
  return {
    prompt: composePrompt(intro, question, truth.kind === 'text' ? FORM.text : FORM.number),
    inputs: { parcels, ports },
    truth, near, alternatives,
    derived: steps >= 3,
  };
}
