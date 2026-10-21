// SPEC-0 truth-first renderer (FIRST-CLASS-PROGRAMS §4.4; MRR §3.3 rules 1-3). $0, deterministic, no model.
//
// renderPack({ seed }) → a content-addressed pack:
//   files      what a builder sees (the messy business): REQUEST.md, PLATFORM.md, wiki/*, inbox/*, records/*
//   fileCarrier the carrier of each file (sop | email | records | unauthorised | distractor | platform | request)
//   fragments  every placement of a unit's text: { file, unit, role: current | stale | precedent }
//   owner      the owner simulator's intent records, each with a pre-rendered answer (owner-sim.mjs)
//   assignment carriers.mjs's assignment; precedents: the rows of each records export
//   digest     sha256 over files and owner records: world = f(seed, pack digest)
// The builder never sees anything but `files` (and asks the owner through owner-sim.mjs).
import { rng } from '../../beds/lib/rng.mjs';
import { hashOf, sha256 } from '../../beds/lib/canonical.mjs';
import { loadSpec, specUnits, platformDoc } from './spec-units.mjs';
import { assignCarriers } from './carriers.mjs';
import { CAST, AUTHORITY, REQUEST, SECTIONS, UNITS, UNAUTHORISED, DISTRACTORS, OWNER_EXTRAS, OWNER_OPENERS, OWNER_CLOSERS } from './content.mjs';
import { PRECEDENTS, precedentCsv } from './precedent.mjs';

export const RENDER_VERSION = 'specbiz-render/1';
const SOP_V3 = 'wiki/SOP-order-handling-v3.md';
const SOP_V2 = 'wiki/SOP-order-handling-v2.md';
const ASIDES = ['', '', '', ' (Joost: this one bites us every December.)', ' (see also the edge cases at the bottom)', ' (Mara wants this one done right.)', ' (checked with the dev, 2025)'];
const INTROS = ['Quick one, please read.', 'Small change, please keep this in mind from go-live.', 'Following up on Thursday\'s call:', 'Just so it\'s written down somewhere:'];
const order = Object.keys(UNITS);

export function renderPack({ seed, root } = {}) {
  const spec = loadSpec(root);
  const units = specUnits(spec.text);
  const assignment = assignCarriers(seed);
  const r = rng('specbiz/render', seed);
  const files = {}, fileCarrier = {}, fragments = [];
  const put = (file, carrier, text) => { files[file] = text; fileCarrier[file] = carrier; };
  const carrierOf = id => assignment.units[id].carrier;
  const place = (file, unit, role) => fragments.push({ file, unit, role });

  put('REQUEST.md', 'request', REQUEST);
  put('PLATFORM.md', 'platform', platformDoc(units));

  // SOP v3: the current page; override units appear in their stale form.
  const sop = ['# Order handling SOP (v3)', '', '*Last edited 2026-02-20 by Joost Bakker. Replaces v2 (October 2025). Questions: Joost or Mara.*', '', `> ${AUTHORITY}`, '', '## General', '', UNITS.U12.core, ''];
  place(SOP_V3, 'U12', 'current');
  for (const section of SECTIONS) {
    const ids = r.shuffle(order.filter(id => UNITS[id].section === section && ['sop', 'override'].includes(carrierOf(id))));
    if (!ids.length) continue;
    sop.push(`## ${section}`, '');
    for (const id of ids) {
      const stale = carrierOf(id) === 'override';
      const text = stale ? UNITS[id].stale.text : UNITS[id].core;
      sop.push(section === 'Customer e-mails' ? text : `- ${text}${r.pick(ASIDES)}`, '');
      place(SOP_V3, id, stale ? 'stale' : 'current');
    }
  }
  put(SOP_V3, 'sop', sop.join('\n'));

  // SOP v2: the old edition, a near-duplicate. All stale variants, plus some current rules that the SOP still carries.
  const v2 = ['# Order handling SOP (v2)', '', '*October 2025, Joost.*', ''];
  for (const section of SECTIONS) {
    const ids = order.filter(id => UNITS[id].section === section && (UNITS[id].stale || (carrierOf(id) === 'sop' && r.chance(0.6))));
    if (!ids.length) continue;
    v2.push(`## ${section}`, '');
    for (const id of ids) {
      const stale = !!UNITS[id].stale;
      v2.push(`- ${stale ? UNITS[id].stale.text : UNITS[id].core}`, '');
      place(SOP_V2, id, stale ? 'stale' : 'current');
    }
  }
  put(SOP_V2, 'sop', v2.join('\n'));

  // E-mails from authorised senders: overrides (each with a reply that promises a wiki fix that never happened),
  // e-mail-only rules (threads of one or two), and the edge-case notes forwarded by Joost.
  const days = r.shuffle(Array.from({ length: 9 }, (_, i) => 21 + i)).map(d => (d <= 28 ? `2026-02-${d}` : `2026-03-0${d - 28}`)).filter(d => d < '2026-03-02');
  let mailN = 0;
  const mail = ({ from, to = CAST.team, date, subject, body, carrier = 'email', units: us = [], role = 'current' }) => {
    const slug = subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    const file = `inbox/${date.slice(0, 10)}-${String(++mailN).padStart(2, '0')}-${slug}.txt`;
    put(file, carrier, `From: ${from.name ? `${from.name} <${from.email}>` : from}\nTo: ${to.email ?? to}\nDate: ${date}\nSubject: ${subject}\n\n${body}\n`);
    for (const u of us) place(file, u, role);
    return file;
  };
  const time = () => `${String(r.int(7, 22)).padStart(2, '0')}:${String(r.int(0, 59)).padStart(2, '0')} +01:00`;
  const authorised = () => r.pick([CAST.owner, CAST.ops]);
  const sign = p => p.name.split(' ')[0];
  let di = 0;
  const nextDay = () => days[di++ % days.length];
  for (const id of order.filter(x => carrierOf(x) === 'override')) {
    const who = authorised(), other = who === CAST.owner ? CAST.ops : CAST.owner, day = nextDay();
    const subject = `Correction: ${UNITS[id].title}`;
    mail({ from: who, date: `${day} ${time()}`, subject, units: [id],
      body: `Hi all,\n\nThe SOP still says: "${UNITS[id].stale.text}"\nThat is out of date. From go-live it is like this:\n\n${UNITS[id].core}\n\n${sign(who)}` });
    mail({ from: other, date: `${day} ${time()}`, subject: `Re: ${subject}`,
      body: `+1. I'll fix the wiki page after go-live.\n\n${sign(other)}` });
  }
  const emailOnly = r.shuffle(order.filter(x => carrierOf(x) === 'email' && !/^S1[0-5]$/.test(x)));
  for (let i = 0; i < emailOnly.length;) {
    const k = Math.min(emailOnly.length - i, r.int(1, 2)), batch = emailOnly.slice(i, i + k); i += k;
    const who = authorised();
    mail({ from: who, date: `${nextDay()} ${time()}`, subject: batch.length === 1 ? `Re: ${UNITS[batch[0]].title}` : `two things for go-live`, units: batch,
      body: `Hi all,\n\n${r.pick(INTROS)}\n\n${batch.map(u => UNITS[u].core).join('\n\n')}\n\nThanks,\n${sign(who)}` });
  }
  const edge = order.filter(x => /^S1[0-5]$/.test(x) && carrierOf(x) === 'email');
  if (edge.length) {
    mail({ from: CAST.ops, date: `${nextDay()} ${time()}`, subject: 'Fwd: edge cases from Ruben (agreed, this is how we work)', units: edge,
      body: `Hi all,\n\nRuben wrote these down when he built the 2025 version. I went through them with him; they are how we work, so treat them as policy:\n\n${edge.map(u => `* ${UNITS[u].core}`).join('\n\n')}\n\nJoost\n\n---------- Forwarded message ----------\nFrom: ${CAST.dev.name} <${CAST.dev.email}>\nSubject: edge cases\n\n(see above)` });
  }

  // The unauthorised sender (one per pack).
  const ua = r.pick(UNAUTHORISED);
  mail({ from: ua.from, date: ua.date, subject: ua.subject, body: ua.body, carrier: 'unauthorised' });

  // Records: one export per records-carried unit.
  const precedents = {};
  for (const id of order.filter(x => carrierOf(x) === 'records')) {
    const rows = PRECEDENTS[id].rows(r.fork(`precedent/${id}`));
    precedents[id] = rows;
    put(PRECEDENTS[id].file, 'records', precedentCsv(id, rows));
    place(PRECEDENTS[id].file, id, 'precedent');
  }

  // Distractors (fixed texts).
  for (const d of DISTRACTORS) put(d.file, 'distractor', d.text);

  // Owner intent records: every unit (the owner knows the business), plus the non-unit questions. Pre-rendered.
  const ownerRecords = [];
  for (const id of order) {
    const u = UNITS[id], open = r.pick(OWNER_OPENERS), close = r.pick(OWNER_CLOSERS);
    ownerRecords.push({ id, units: [id], title: u.title, terms: u.terms, answer: [open, u.core, close].filter(Boolean).join(' ') });
  }
  for (const [id, x] of Object.entries(OWNER_EXTRAS)) ownerRecords.push({ id, units: [], title: x.title, terms: x.terms, answer: x.answer });
  const uaName = ua.from.split(' <')[0];
  ownerRecords.push({ id: 'UA', units: [], title: `the e-mail from ${uaName}`, terms: [uaName.toLowerCase(), uaName.split(' ')[0].toLowerCase(), ua.subject.toLowerCase()],
    answer: `No, don't do that. ${uaName.split(' ')[0]} doesn't decide how we handle orders. ${AUTHORITY}` });
  const reticence = rng('specbiz/owner-reticence', seed);
  for (const rec of ownerRecords) rec.reticent = reticence.chance(0.5);   // MRR §3.3: seeded withholding unless the subject is named

  const meta = { version: RENDER_VERSION, seed, spec: { file: 'beds/ebed/e8/spec/SPEC-E.md', sha256: spec.sha256 }, assignment: assignment.digest, unauthorised: ua.id,
    files: Object.keys(files).length, bytes: Object.values(files).reduce((s, t) => s + Buffer.byteLength(t), 0) };
  const owner = { records: ownerRecords.map(x => ({ ...x, answerDigest: sha256(x.answer) })) };
  const pack = { meta, files, fileCarrier, fragments, assignment, precedents, owner, unauthorised: ua };
  return { ...pack, digest: hashOf({ files, owner }) };
}
