// The 20 padding document kinds of need-r0pad. Each kind is { id, cap, build(r, ctx, targetBytes) -> text }: it writes a header,
// then keeps adding units (a paragraph, a table row, an e-mail, a week of the rota ...) while that moves the document closer
// to targetBytes, so a table scales to any size and a prose kind stops where it would start to repeat itself (`cap`).
// All content is generated, fictional and answer-neutral (lexicon.mjs; guard.mjs lists what must never appear).
import {
  fill, FRAMES, QA, POLICY_SECTIONS, POLICY_CLAUSES, NEWS_SECTIONS, MONTHS, WEEKDAYS, ITEMS, BINS, cap as capitalise,
  person, supplierName, address, emailOf, phone, isoDate, longDate, isoOf, longOf, weekdayOf, nextWorkday, clock, subject, course, expenseCategory, toolName, asset, room, canteenDish,
} from './lexicon.mjs';

const bytes = s => Buffer.byteLength(s);
const p2 = n => String(n).padStart(2, '0');
const banner = title => `HOLLIN GROUP — ${title}`;
const grp = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Grow `head` with units while that brings the byte length closer to `target` (at least `minUnits`, at most `maxUnits`). */
function assemble({ head, unit, target, joiner = '\n', tail = '', minUnits = 2, maxUnits = 500 }) {
  let body = head;
  for (let n = 0; n < maxUnits; n++) {
    const next = `${body}${joiner}${unit(n)}`;
    if (n >= minUnits && Math.abs(bytes(next + tail) - target) >= Math.abs(bytes(body + tail) - target)) break;
    body = next;
  }
  return body + tail;
}

// Draw items from a list without replacement until it is used up, then reshuffle.
function deck(r, list) {
  let pile = [];
  return () => { if (!pile.length) pile = r.shuffle(list); return pile.pop(); };
}
const sentences = (r, c, frames, k) => { const next = deck(r, frames); return Array.from({ length: k }, () => fill(r, c, next())).join(' '); };

const AGENDA = ['Site walk findings', 'Dock scheduling', 'Equipment and maintenance', 'Rota and cover', 'Training and licences', 'Safety observations', 'Canteen and facilities',
  'Supplier visits', 'Parking and access', 'Communications to staff', 'Spare parts and consumables', 'Storage layout'];
const PURPOSES = ['rota planning', 'supplier call', 'safety briefing', 'interviews', 'dock layout review', 'team stand-up', 'induction session', 'quarterly count briefing'];
const CHANGES = ['Fixes a crash when the scanner at the {gate} gate is unplugged during a sync.', 'Adds a printable floor plan for {site}.',
  'Shortens the start-up time of the {tool} screen by about {mins} seconds.', 'Corrects the order in which aisles are listed on the pick sheet.',
  'Adds a daily summary e-mail for {team}.', 'Improves the contrast of the bay map for night shifts.', 'Remembers the last aisle you searched.',
  'Removes the old "pallet lane" tab that nobody used.', 'Lets {team} export the bay list to a spreadsheet.', 'Fixes a typo in the label template for {site2}.',
  'Prints the aisle number in larger type on the bin labels.', 'Warns when two benches are booked for the same hour.'];
const TIMELINE = ['{person} reports that the {asset} has stopped responding.', '{team} restarts the unit; the fault returns after {mins} minutes.',
  '{person} moves the affected work to the spare {asset}.', 'The supplier\'s helpline is rung and a case number is noted.', '{other} checks the cabling at the {gate} gate.',
  'A temporary paper sheet is used at the {gate} gate.', '{person} confirms that the {asset} is back, but slow.', '{team} swaps the power supply.',
  '{other} informs the shift leads by radio.', 'Work resumes on the {floor}; {person} keeps a log of the delay.'];
const STEPS = ['Collect badge and locker key at reception', 'Safety induction with {person}', 'Walk the site with {person}', 'Set up the handheld scanner and test a label print',
  'Read the visitor and parking rules', 'Meet the {team} lead', 'Complete the "{course}" e-learning', 'Agree the first-month goals', 'Book a first review for {iso}'];
const SUMMARIES = ['Badge reader at the {gate} gate does not beep', 'Cannot print labels from packing bench {small}', 'Handheld scanner will not sync', 'Screen in Room {room} stays black',
  'Password reset for the shared locker app', 'Wi-Fi drops near aisle {aisle}', 'New starter needs a laptop', 'Headset has no sound on calls', 'Printer jam on the {floor}'];
const FIXES = ['Cable reseated', 'Firmware updated', 'Unit swapped', 'Account unlocked', 'Router channel changed', 'Driver reinstalled', 'Advised user to restart', 'Part ordered'];
const OBS = ['Pallet left in front of dock door {small}', 'Wet floor near the {gate} gate, no sign', 'Reversing alarm on a truck is very quiet', 'Box stack leaning in aisle {aisle}',
  'Cable across the walkway on the {floor}', 'Fire door propped on the {floor}', 'Mirror at aisle {aisle} is cracked', 'Eyewash station blocked by cartons'];
const FOLLOW = ['Moved at once', 'Sign placed', '{team} informed', 'Logged for the next site walk', 'Fixed the same day', 'Parts requested'];
const EXP_NOTES = ['to the {site2} depot', 'site visit', 'team lunch', 'courier to supplier', 'visitor parking', 'label stock', 'training venue', 'overnight stay'];
const TASKS_TS = ['Racking labels, aisle {aisle}', 'Cycle count, store {n}', 'Packing bench support', 'Dock marshalling', 'Floor markings, lane {aisle}', 'Returns sorting'];
const SUPPLIES = ['pallets', 'packaging', 'cleaning', 'safety wear', 'stationery', 'catering', 'tools', 'signage', 'electrical', 'uniforms'];
const SHIFT = ['E', 'L', 'N', 'D', 'R', '-'];
const GREETS = ['Hi', 'Hello', 'Dear'];
const SIGNOFF = ['Thanks', 'Kind regards', 'Best', 'Many thanks', 'Regards'];
const LOST = ['a grey scarf', 'a set of keys on a green fob', 'a steel flask', 'a pair of reading glasses', 'a blue notebook', 'one black glove', 'a car-park token', 'a canvas tote bag'];

const cell = (s, w) => String(s).padEnd(w);
const pickPerson = (r, c) => r.pick(c.people);
const code = (r, c) => `${r.pick(['KT', 'PL', 'WS', 'HV', 'FM', 'SB', 'EL', 'GL'])}-${r.int(101, 989)}`;

export const KINDS = [
  { id: 'memo', cap: 12000, build(r, c, target) {
    const next = deck(r, FRAMES.ops);
    return assemble({
      head: [banner('INTERNAL MEMO'), `Ref: MEMO-25-${String(r.int(1, 999)).padStart(3, '0')}`, `To: All staff, ${c.site}`, `From: ${pickPerson(r, c)}, ${c.teams[0]}`,
        `Date: ${isoDate(r)}`, `Subject: ${subject(r)}`].join('\n'),
      unit: () => Array.from({ length: r.int(2, 3) }, () => fill(r, c, next())).join(' '),
      joiner: '\n\n', target, tail: `\n\n${fill(r, c, r.pick(FRAMES.closing))}\n\n${pickPerson(r, c)}\n${c.teams[0]}`,
    });
  } },
  { id: 'minutes', cap: 14000, build(r, c, target) {
    const titles = deck(r, AGENDA), disc = deck(r, FRAMES.ops), dec = deck(r, FRAMES.ops);
    const t1 = r.pick(['09:00', '09:30', '10:00', '14:00']), m = nextWorkday(r.int(0, 330));
    return assemble({
      head: [banner(`${c.teams[0].toUpperCase()} WEEKLY MEETING MINUTES`), `Date: ${isoOf(m)}   Time: ${t1}-${p2(Number(t1.slice(0, 2)) + 1)}${t1.slice(2)}   Place: Room ${room(r)}`,
        `Present: ${c.people.slice(0, 5).join(', ')}`, `Apologies: ${c.people[c.people.length - 1]}`, `Chair: ${c.people[0]}   Minutes: ${c.people[1]}`].join('\n'),
      unit: i => `${i + 1}. ${titles()}\n   Discussion: ${fill(r, c, disc())} ${fill(r, c, disc())}\n   Decision: ${fill(r, c, dec())}\n   Action: ${pickPerson(r, c)} to ${fill(r, c, '{task}')} by ${isoOf(m + r.int(3, 28))}.`,
      joiner: '\n\n', target, tail: `\n\nNext meeting: ${isoOf(m + 7)}, same room.`,
    });
  } },
  { id: 'email-thread', cap: 14000, build(r, c, target) {
    const subj = subject(r), next = deck(r, FRAMES.email); let when = nextWorkday(r.int(0, 330));
    return assemble({
      head: banner(`MAILBOX EXPORT (${c.teams[0]} shared mailbox)`) + '\n',
      unit: i => {
        const from = pickPerson(r, c); let to; do { to = pickPerson(r, c); } while (to === from && c.people.length > 1);
        when = nextWorkday(when + r.int(0, 2));
        return [`From: ${from} <${emailOf(from)}>`, `To: ${to} <${emailOf(to)}>`, `Sent: ${weekdayOf(when)}, ${longOf(when)} ${clock(r)}`, `Subject: ${i ? 'RE: ' : ''}${subj}`, '',
          `${r.pick(GREETS)} ${to.split(' ')[0]},`, [fill(r, c, next()), fill(r, c, next())].join(' '), '', `${r.pick(SIGNOFF)},`, from.split(' ')[0], ''].join('\n');
      },
      joiner: '\n----\n', target,
    });
  } },
  { id: 'faq', cap: 4500, build(r, c, target) {
    const next = deck(r, QA);
    return assemble({
      head: banner(`STAFF FAQ (${c.site})`) + '\n',
      unit: i => { const [q, a] = next(); return `Q${i + 1}. ${fill(r, c, q)}\nA${i + 1}. ${fill(r, c, a)}`; },
      joiner: '\n\n', target, maxUnits: 40,
    });
  } },
  { id: 'policy', cap: 5600, build(r, c, target) {
    const next = deck(r, POLICY_CLAUSES);
    return assemble({
      head: [banner('SITE POLICY EXTRACT'), `Policy owner: ${c.teams[0]}   Version: 3.${r.int(0, 9)}   Effective: ${isoDate(r)}`, ''].join('\n'),
      unit: i => { const s = i % POLICY_SECTIONS.length + 1; return [`${s}. ${POLICY_SECTIONS[s - 1]}`, ...[1, 2, 3].map(k => `${s}.${k} ${fill(r, c, next())}`)].join('\n'); },
      joiner: '\n\n', target, maxUnits: 16,
    });
  } },
  { id: 'newsletter', cap: 10000, build(r, c, target) {
    const gens = {
      'New faces': () => `Welcome to ${person(r)}, who joins ${r.pick(c.teams)} on ${longDate(r)}. Say hello at the ${r.pick(['north', 'south', 'main', 'service'])} gate.`,
      'Anniversaries': () => `${pickPerson(r, c)} (${r.pick(c.teams)}) marks ${r.int(2, 25)} years with the group this month. Cake is in the break room on ${r.pick(WEEKDAYS)}.`,
      'Out and about': () => `A group from ${r.pick(c.teams)} visited ${c.site2} on ${longDate(r)} to compare dock layouts. ${pickPerson(r, c)} has pinned the photos in the break room.`,
      'Canteen corner': () => `Menu for the week starting ${isoDate(r)}: Monday ${canteenDish(r)}; Tuesday ${canteenDish(r)}; Wednesday ${canteenDish(r)}; Thursday ${canteenDish(r)}; Friday ${canteenDish(r)}.`,
      'Safety spot': () => fill(r, c, r.pick(FRAMES.ops)),
      'Lost and found': () => `Found near the ${r.pick(['north', 'south', 'main', 'service'])} gate: ${r.pick(LOST)}. Ask ${pickPerson(r, c)} to claim it.`,
      'Dates for the diary': () => `${longDate(r)}: ${r.pick(['family visit afternoon', 'first-aid refresher', 'quarterly count', 'fire drill', 'charity quiz night', 'racking inspection'])}.`,
    };
    const pick = deck(r, NEWS_SECTIONS);
    return assemble({
      head: banner(`STAFF NEWSLETTER, ${r.pick(MONTHS)} edition`) + '\n',
      unit: () => { const s = pick(); return `${s.toUpperCase()}\n${gens[s]()} ${gens[s]()}`; },
      joiner: '\n\n', target, maxUnits: 60,
    });
  } },
  { id: 'incident-review', cap: 8000, build(r, c, target) {
    const next = deck(r, TIMELINE); let t = r.int(5 * 60, 10 * 60);
    return assemble({
      head: [banner(`INCIDENT REVIEW: ${capitalise(asset(r))} outage at ${c.site}`), `Date: ${isoDate(r)}   Owner: ${pickPerson(r, c)}   Duration: about ${r.int(1, 5)} hours`, '', 'Timeline'].join('\n'),
      unit: () => { t += r.int(3, 14); return `${p2(Math.floor(t / 60) % 24)}:${p2(t % 60)}  ${fill(r, c, next())}`; },
      joiner: '\n', target, maxUnits: 140,
      tail: `\n\nFollow-ups\n1. ${pickPerson(r, c)} to ${fill(r, c, '{task}')}.\n2. ${pickPerson(r, c)} to ${fill(r, c, '{task}')}.\n3. ${c.teams[0]} to review the spare ${asset(r)} stock ${fill(r, c, '{period}')}.`,
    });
  } },
  { id: 'release-notes', cap: 7000, build(r, c, target) {
    const tool = toolName(r), next = deck(r, CHANGES); let minor = r.int(14, 30), patch = r.int(0, 3);
    return assemble({
      head: banner(`${tool.toUpperCase()} RELEASE NOTES`) + '\n',
      unit: () => { const v = `v2.${minor}.${patch}`; if (patch > 0) patch--; else { minor--; patch = r.int(0, 3); } return `${v}  (${isoDate(r)})\n${[1, 2, r.int(0, 1) ? 3 : 0].filter(Boolean).map(() => `  - ${fill(r, c, next())}`).join('\n')}`; },
      joiner: '\n\n', target, maxUnits: 40,
    });
  } },
  { id: 'onboarding', cap: 2200, build(r, c, target) {
    const next = deck(r, STEPS);
    return assemble({
      head: [banner(`NEW STARTER CHECKLIST (${c.teams[0]})`), `Starter: ${person(r)}   Start date: ${isoDate(r)}   Buddy: ${pickPerson(r, c)}`, ''].join('\n'),
      unit: i => `[ ] Day ${Math.floor(i / 2) + 1}: ${fill(r, c, next())}  (owner: ${r.pick(c.teams)})`, joiner: '\n', target, maxUnits: 22,
    });
  } },
  { id: 'training-record', cap: 14000, build(r, c, target) {
    return assemble({
      head: [banner(`TRAINING RECORD: ${course(r)}`), `Trainer: ${pickPerson(r, c)}   Date: ${isoDate(r)}   Place: Room ${room(r)}`, '', `${cell('Name', 24)} | ${cell('Team', 22)} | Result`].join('\n'),
      unit: () => `${cell(person(r), 24)} | ${cell(r.pick(c.teams), 22)} | ${r.pick(['attended', 'attended', 'attended', 'absent, rebooked', 'attended, certificate to follow'])}`, joiner: '\n', target,
    });
  } },
  { id: 'stock-sheet', cap: 24000, build(r, c, target) {
    const next = deck(r, ITEMS), bin = r.pick(BINS);
    return assemble({
      head: [banner(`STOCK COUNT SHEET (${c.site}, store ${bin})`), `Counted by: ${pickPerson(r, c)}   Date: ${isoDate(r)}`, '', `${cell('SKU', 8)} | ${cell('Description', 30)} | ${cell('Bin', 7)} | Expected | Counted | Diff`].join('\n'),
      unit: () => { const exp = r.int(5, 400), cnt = exp + r.pick([0, 0, 0, 0, -1, -2, 1, 3, -5]); return `${cell(code(r, c), 8)} | ${cell(next(), 30)} | ${cell(`${bin}${r.int(1, 24)}-${r.int(1, 5)}`, 7)} | ${String(exp).padStart(8)} | ${String(cnt).padStart(7)} | ${String(cnt - exp).padStart(4)}`; },
      joiner: '\n', target,
    });
  } },
  { id: 'run-sheet', cap: 24000, build(r, c, target) {
    return assemble({
      head: [banner('DELIVERY RUN SHEET'), `Vehicle: VAN-${r.int(11, 48)}   Driver: ${pickPerson(r, c)}   Date: ${isoDate(r)}`, '', `${cell('Stop', 4)} | ${cell('Consignee', 28)} | ${cell('Address', 36)} | Parcels | Window`].join('\n'),
      unit: i => { const h = r.int(8, 15); return `${cell(i + 1, 4)} | ${cell(supplierName(r), 28)} | ${cell(address(r), 36)} | ${String(r.int(1, 14)).padStart(7)} | ${p2(h)}:00-${p2(h + 2)}:00`; },
      joiner: '\n', target,
    });
  } },
  { id: 'rota', cap: 14000, build(r, c, target) {
    const crew = c.people.slice(0, 8);
    return assemble({
      head: [banner(`WEEKLY SHIFT ROTA (${c.teams[0]})`), 'Codes: E early, L late, N night, D day, R rest day, - not rostered', ''].join('\n'),
      unit: () => [`Week of ${isoDate(r)}`, `${cell('', 22)} ${WEEKDAYS.map(d => d.slice(0, 3)).join('  ')}`, ...crew.map(n => `${cell(n, 22)} ${WEEKDAYS.map(() => ` ${r.pick(SHIFT)} `).join(' ')}`)].join('\n'),
      joiner: '\n\n', target,
    });
  } },
  { id: 'expense-claims', cap: 20000, build(r, c, target) {
    const cur = r.pick(['GBP', 'EUR', 'USD', 'CHF']);
    return assemble({
      head: [banner('STAFF EXPENSE CLAIM SUMMARY'), `Period: ${r.pick(MONTHS)} 2025   Approver: ${pickPerson(r, c)}   Currency: ${cur}`, '', `${cell('Date', 10)} | ${cell('Claimant', 22)} | ${cell('Category', 18)} | ${cell('Note', 24)} | Amount`].join('\n'),
      unit: () => `${isoDate(r)} | ${cell(pickPerson(r, c), 22)} | ${cell(expenseCategory(r), 18)} | ${cell(fill(r, c, r.pick(EXP_NOTES)), 24)} | ${String(r.int(3, 180))}.${p2(r.int(0, 99))}`, joiner: '\n', target,
    });
  } },
  { id: 'helpdesk-export', cap: 20000, build(r, c, target) {
    return assemble({
      head: [banner('IT HELPDESK EXPORT'), `Queue: ${c.site}   Exported: ${isoDate(r)}`, '', `${cell('Ticket', 9)} | ${cell('Raised', 10)} | ${cell('Summary', 44)} | Resolution`].join('\n'),
      unit: () => `HD-0${r.int(1000, 9999)} | ${isoDate(r)} | ${cell(fill(r, c, r.pick(SUMMARIES)), 44)} | ${r.pick(FIXES)}`, joiner: '\n', target,
    });
  } },
  { id: 'room-bookings', cap: 14000, build(r, c, target) {
    return assemble({
      head: [banner(`MEETING ROOM BOOKINGS (${c.site})`), ''].join('\n'),
      unit: () => [`${r.pick(WEEKDAYS)} ${isoDate(r)}`, ...Array.from({ length: r.int(3, 5) }, (_, k) => { const h = 8 + k * 2 + r.int(0, 1); return `  ${p2(h)}:00-${p2(h + 1)}:30  Room ${room(r)}  ${pickPerson(r, c)} (${r.pick(c.teams)}), ${r.pick(PURPOSES)}`; })].join('\n'),
      joiner: '\n\n', target,
    });
  } },
  { id: 'supplier-contacts', cap: 20000, build(r, c, target) {
    return assemble({
      head: [banner('APPROVED SUPPLIER CONTACTS (non-food)'), `Maintained by ${c.teams[0]}; last review ${isoDate(r)}`, '', `${cell('Supplier', 30)} | ${cell('Contact', 22)} | ${cell('Phone', 9)} | ${cell('Email', 38)} | Supplies`].join('\n'),
      unit: () => { const p = person(r); return `${cell(supplierName(r), 30)} | ${cell(p, 22)} | ${cell(phone(r), 9)} | ${cell(emailOf(p, 'supplier.example'), 38)} | ${r.pick(SUPPLIES)}`; }, joiner: '\n', target,
    });
  } },
  { id: 'timesheet', cap: 10000, build(r, c, target) {
    return assemble({
      head: [banner('CONTRACTOR TIMESHEET'), `Contractor: ${person(r)}   Agency: ${supplierName(r)}   Week starting: ${isoDate(r)}`, '', `${cell('Date', 10)} | Start | End   | Hours | Task`].join('\n'),
      unit: () => { const s = r.int(6, 10) * 60 + r.pick([0, 30]), len = r.int(5, 9) * 60 + r.pick([0, 30]), e = s + len; return `${isoDate(r)} | ${p2(Math.floor(s / 60))}:${p2(s % 60)} | ${p2(Math.floor(e / 60))}:${p2(e % 60)} | ${(len / 60).toFixed(1).padStart(5)} | ${fill(r, c, r.pick(TASKS_TS))}`; },
      joiner: '\n', target,
    });
  } },
  { id: 'fleet-log', cap: 20000, build(r, c, target) {
    return assemble({
      head: [banner(`FLEET LOG (${c.site})`), '', `${cell('Date', 10)} | ${cell('Vehicle', 7)} | ${cell('Driver', 22)} | Start km | End km  | Litres`].join('\n'),
      unit: () => { const km = r.int(20000, 90000), d = r.int(18, 240); return `${isoDate(r)} | VAN-${r.int(11, 48)} | ${cell(pickPerson(r, c), 22)} | ${grp(km).padStart(8)} | ${grp(km + d).padStart(7)} | ${String(r.int(8, 60))}.${r.int(0, 9)}`; },
      joiner: '\n', target,
    });
  } },
  { id: 'near-miss-log', cap: 14000, build(r, c, target) {
    return assemble({
      head: [banner(`NEAR-MISS AND OBSERVATION LOG (${c.site})`), '', `${cell('Date', 10)} | ${cell('Location', 16)} | ${cell('Observation', 48)} | Follow-up`].join('\n'),
      unit: () => `${isoDate(r)} | ${cell(r.pick(['Dock', 'Aisle ' + r.int(1, 24), 'Mezzanine', 'Packing area', 'Yard', 'Break room']), 16)} | ${cell(fill(r, c, r.pick(OBS)), 48)} | ${fill(r, c, r.pick(FOLLOW))}`, joiner: '\n', target,
    });
  } },
];
export const KIND_IDS = KINDS.map(k => k.id);
