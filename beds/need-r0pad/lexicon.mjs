// Lexicon and sentence frames for the need-r0pad padding documents. Everything is fictional and generated from syllable
// pools; a coincidental resemblance to a real name is possible and meaningless. The vocabulary is deliberately free of
// anything that could change the answer to an R0 invoice task: no status words of the billing systems, no tax, discount,
// rounding, number-format or date-order statements, no "instructions to the reader" (see guard.mjs for the denylist the
// tests enforce). Pure functions of a seeded stream from beds/lib/rng.mjs.

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
export const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const p2 = n => String(n).padStart(2, '0');

const FIRST = ['Amara', 'Bastian', 'Celia', 'Dmitri', 'Elin', 'Farid', 'Greta', 'Hamza', 'Ilse', 'Jonas', 'Kavya', 'Lorenzo', 'Mina', 'Nikhil',
  'Oksana', 'Pavel', 'Quentin', 'Rosa', 'Sven', 'Talia', 'Umar', 'Vera', 'Wilhelm', 'Xenia', 'Yusuf', 'Zofia', 'Aiden', 'Beatrix', 'Callum',
  'Dahlia', 'Emeka', 'Freya', 'Gideon', 'Hana', 'Idris', 'Jocelyn', 'Kofi', 'Leila', 'Marek', 'Noor', 'Orla', 'Priya', 'Rafael', 'Saskia',
  'Tomas', 'Ulrika', 'Viktor', 'Wren', 'Yara', 'Zane'];
const SA = ['Ash', 'Bram', 'Cor', 'Dun', 'Elm', 'Fair', 'Gran', 'Hale', 'Ivor', 'Kest', 'Lang', 'Mor', 'Nor', 'Oak', 'Pell', 'Quar', 'Rook', 'Stan',
  'Thorn', 'Ulm', 'Vance', 'Wex', 'Yard', 'Zell'];
const SB = ['ley', 'ton', 'wick', 'ford', 'man', 'berg', 'dale', 'mere', 'stead', 'well', 'worth', 'by', 'holm', 'den', 'field', 'wood'];

export const TEAMS = ['Facilities', 'Logistics', 'IT Services', 'People Team', 'Procurement', 'Quality', 'Fleet', 'Customer Care', 'Warehouse Operations',
  'Health and Safety', 'Finance Operations', 'Site Security', 'Inbound Goods', 'Dispatch'];
const SITE_KIND = ['Quay', 'Yard', 'Works', 'Park', 'Depot', 'Hub', 'Wharf'];
const SUPPLIER_KIND = ['Supplies', 'Logistics', 'Packaging', 'Freight', 'Print', 'Industrial', 'Stationers', 'Cleaning', 'Catering', 'Tools', 'Pallets', 'Maintenance'];
const COMPANY_FORM = ['Ltd', 'GmbH', 'AB', 'BV', 'Inc', 'AS'];
const STREET_KIND = ['Row', 'Lane', 'Street', 'Road', 'Close', 'Way', 'Terrace'];
const STREET_NAME = ['Lantern', 'Cooper', 'Mill', 'Heron', 'Saltings', 'Tannery', 'Orchard', 'Beacon', 'Foundry', 'Harbour', 'Willow', 'Granary', 'Kiln', 'Rope Walk'];
const TOWN = ['Ashmere', 'Corley', 'Dunwick', 'Elmstead', 'Fairholm', 'Granford', 'Halebury', 'Kestwell', 'Langdale', 'Morden Cross', 'Norwood Green', 'Pellham', 'Rookby', 'Thornfield'];

// Assets and items. NONE of the ITEMS equals a line description of an R0 invoice (the tests check this against R0's own
// documents), so a stock sheet or manifest can never read as a price list for the invoice's goods.
export const ASSETS = ['label printer', 'pallet truck', 'handheld scanner', 'dock door {#}', 'mezzanine lift', 'coffee machine', 'meeting-room display',
  'badge reader', 'shrink-wrap station', 'forklift charger', 'air-handling unit', 'goods lift', 'parcel scale', 'paper shredder', 'visitor kiosk',
  'compressor', 'sorting table {#}', 'dock leveller', 'packing bench {#}', 'first-aid station', 'charging bay {#}', 'conveyor spur {#}'];
export const ITEMS = ['Whiteboard markers (12)', 'Lanyards, navy (25)', 'Hi-vis vest, size L', 'Pallet corner boards (50)', 'Foam inserts, 300 mm', 'Stapler, heavy duty',
  'Sticky notes, yellow (12)', 'Mop heads (6)', 'Spill kit, 20 l', 'Fire door signs (10)', 'Ear defenders', 'Pallet labels, A5 (1000)', 'Forklift lamp bulb', 'Dock bumper, rubber',
  'Hand soap refill (5 l)', 'Paper towels (case)', 'Waste sacks, 120 l (100)', 'Ring binders, A4 (10)', 'Laminating pouches (100)', 'Extension lead, 4-way', 'Batteries AA (24)',
  'Torch, rechargeable', 'Wheel chocks (pair)', 'Floor marking tape, yellow', 'Tote bins, 40 l', 'Roller shutter spring', 'Scanner dock cradle', 'Wrist lanyard, scanner',
  'Cable tray, 2 m', 'Door closer, hydraulic', 'Chalk spray, marking', 'Rubber matting (m)', 'Strapping, PET (reel)', 'Edge protectors (200)', 'Ladder, 3-step', 'Safety cones (10)',
  'Visitor badges (100)', 'Key cabinet tags (50)', 'Hole punch, 4-hole', 'Desk divider, acrylic', 'Monitor arm, single', 'Footrest, adjustable', 'Headset, wired', 'Webcam, 1080p',
  'Label rolls, 100 x 150 (4)', 'Cleaning wipes (tub)', 'Gloves, nitrile (box)', 'Kettle, 1.7 l', 'Tea bags (box)', 'Coffee beans (kg)'];
export const BINS = ['A', 'B', 'C', 'D', 'E', 'F'];
const CANTEEN = ['leek and potato soup', 'chicken and rice bake', 'vegetable chilli', 'baked cod with lentils', 'mushroom stroganoff', 'roast squash salad', 'bean and barley stew',
  'herbed meatballs', 'spinach and ricotta pasta', 'smoked haddock chowder', 'lamb hotpot', 'tomato and basil tart', 'fish pie', 'chickpea curry', 'sausage and mash', 'pumpkin risotto'];
const COURSES = ['Manual handling refresher', 'Forklift licence renewal', 'First aid at work', 'Fire marshal basics', 'Scanner and label tools', 'Working at height', 'Dangerous goods awareness',
  'New supervisor workshop', 'Spreadsheet skills', 'Customer calls: tone and tact', 'Data protection basics', 'Lone working'];
const EXPENSE_CAT = ['Train fare', 'Taxi', 'Parking', 'Lunch with visitor', 'Hotel (one night)', 'Courier fee', 'Stationery', 'Printing', 'Toll', 'Fuel', 'Team event', 'Conference pass'];
const TOOLS = ['DockSlot', 'PickPath', 'LabelForge', 'RotaBoard', 'YardView', 'GateLog', 'BinFinder', 'TrayTrack'];
const SUBJECTS = ['Dock bay resurfacing next week', 'New visitor badge printers on the first floor', 'Change of courier collection time', 'Winter parking arrangements',
  'Mezzanine lift: planned service', 'Reminder: fire drill this month', 'Shared calendar for the packing benches', 'Canteen opening hours during the refit',
  'Handheld scanner swap programme', 'Quiet hours in the planning office', 'Pallet racking inspection results', 'Locker clear-out', 'Bike shelter extension',
  'New starter desk allocation', 'Recycling stream changes', 'Gate barrier maintenance'];

export const person = r => `${r.pick(FIRST)} ${r.pick(SA)}${r.pick(SB)}`;
export const supplierName = r => `${r.pick(SA)}${r.pick(SB)} ${r.pick(SUPPLIER_KIND)} ${r.pick(COMPANY_FORM)}`;
export const siteName = r => `${r.pick(SA)}${r.pick(SB)} ${r.pick(SITE_KIND)}`;
export const address = r => `${r.int(1, 98)} ${r.pick(STREET_NAME)} ${r.pick(STREET_KIND)}, ${r.pick(TOWN)}`;
export const emailOf = (name, domain = 'hollin-group.example') => `${name.toLowerCase().replace(/ /g, '.')}@${domain}`;
export const phone = r => `555-01${p2(r.int(0, 99))}`;
export const isoDate = r => `2025-${p2(r.int(1, 12))}-${p2(r.int(1, 28))}`;
export const longDate = r => `${r.int(1, 28)} ${r.pick(MONTHS)} 2025`;
export const clock = r => `${p2(r.int(6, 17))}:${r.pick(['00', '15', '30', '45'])}`;
export const subject = r => r.pick(SUBJECTS);
export const canteenDish = r => r.pick(CANTEEN);
export const course = r => r.pick(COURSES);
export const expenseCategory = r => r.pick(EXPENSE_CAT);
export const toolName = r => r.pick(TOOLS);
export const asset = r => r.pick(ASSETS).replace('{#}', () => String(r.int(1, 9)));
export const item = r => r.pick(ITEMS);
export const room = r => `${r.pick(['A', 'B', 'C'])}${r.int(1, 9)}`;

// Per-document context: a small cast and places, so one document reads as one coherent piece.
export function makeCtx(r) {
  const people = [];
  for (let i = 0, n = r.int(5, 8); i < n; i++) { const p = person(r); if (!people.includes(p)) people.push(p); }
  return { people, site: siteName(r), site2: siteName(r), teams: r.sample(TEAMS, 4), last: null };
}

const TASKS = ['confirm the new bay numbers with the courier', 'update the shared floor plan', 'order spare label rolls', 'book the safety inspection',
  'circulate the revised rota', 'check the charger cables', 'collect quotes from two suppliers', 'walk the route with the driver',
  'send the training dates to all shift leads', 'repaint the floor markings in aisle {aisle}', 'test the new scanner firmware on one handset',
  'clear the overflow pallets from lane {aisle}', 'photograph the damaged corner boards', 'update the key cabinet list', 'reserve the large meeting room for the review',
  'draft a short note for the noticeboard', 'check the spare parts shelf', 'agree a date with the landlord', 'label the new storage bins', 'measure the gap at dock door {n}'];
const ACTIONS = ['serviced', 'inspected', 'relocated', 'recalibrated', 'upgraded', 'tested', 're-labelled', 'repainted', 'moved', 'cleaned', 'restarted', 'checked'];
const REASONS = ['because the current arrangement slowed the morning shift', 'after two near misses were reported last month', 'to free up space for the new racking',
  'following a request from the night team', 'because the supplier changed its delivery window', 'to match the layout on the other site', 'as agreed at the last review',
  'since the old unit is out of warranty', 'to cut the walking distance between the benches and the dock'];
const PERIODS = ['this quarter', 'next month', 'by the end of the week', 'before the autumn peak', 'in the first half of the year', 'after the refit'];
const GATES = ['north', 'south', 'east', 'main', 'service'];
const FLOORS = ['ground floor', 'first floor', 'second floor', 'mezzanine'];

const SLOT = {
  person: (r, c) => (c.last = r.pick(c.people)),
  other: (r, c) => { let p; do { p = r.pick(c.people); } while (p === c.last && c.people.length > 1); return p; },
  team: (r, c) => r.pick(c.teams), team2: (r, c) => r.pick(c.teams),
  site: (r, c) => c.site, site2: (r, c) => c.site2,
  asset: r => asset(r), action: r => r.pick(ACTIONS), task: r => r.pick(TASKS), reason: r => r.pick(REASONS), period: r => r.pick(PERIODS),
  weekday: r => r.pick(WEEKDAYS), date: r => longDate(r), iso: r => isoDate(r), time: r => clock(r), time2: r => clock(r),
  n: r => String(r.int(2, 40)), small: r => String(r.int(2, 9)), aisle: r => String(r.int(1, 24)), mins: r => String(r.pick([5, 10, 15, 20, 30, 45])),
  gate: r => r.pick(GATES), floor: r => r.pick(FLOORS), room: r => room(r), dish: r => canteenDish(r), item: r => item(r), tool: r => toolName(r),
  supplier: r => supplierName(r), course: r => course(r),
};

/** Expand {slots} in a template with draws from stream `r` and the document context `c`. */
export function fill(r, c, tpl) {
  let out = tpl;
  // tasks may carry their own slots ({aisle}, {n}); expand until stable (two passes are enough for the templates here)
  for (let pass = 0; pass < 3 && /\{\w+\}/.test(out); pass++) out = out.replace(/\{(\w+)\}/g, (m, k) => (SLOT[k] ? SLOT[k](r, c) : m));
  return out;
}

// Sentence frames. Informational, neutral; nothing here states a rule that bears on reading an invoice.
export const FRAMES = {
  ops: [
    'The {asset} at {site} will be {action} on {weekday} {date}, and {person} from {team} will coordinate access.',
    'Please allow an extra {mins} minutes at the {gate} gate while the barrier is tested.',
    '{team} has agreed to cover the late shift on {weekday} so that {person} can attend the {course} session.',
    'Pallet racking in aisle {aisle} was inspected by {person}; nothing further is needed beyond re-labelling the end frames.',
    'The courier collection moves from {time} to {time2} from {date}; parcels that are not labelled by then wait for the next day.',
    'A reminder that the {asset} is shared between {team} and {team2}; please book it through the shared calendar rather than by e-mail.',
    'We received {n} responses to the canteen survey, and the most common request was {dish} on Thursdays.',
    '{person} will walk the {floor} with the fire marshals on {weekday} and report anything that blocks an exit.',
    'The {asset} was {action} {reason}.',
    'If the {asset} shows a fault light, switch it off at the wall and tell {person} straight away.',
    'Deliveries for {site2} should be redirected to {site} until {date}, when the ramp reopens.',
    '{team} is looking at {n} spare lockers on the {floor} for the new starters and will confirm allocations on {weekday}.',
    'The overflow lane by dock door {small} is cleared every {weekday}; anything left there is moved to the cage and logged by {person}.',
    'The new waste sacks are in the store on the {floor}; {person} holds the key and keeps a short list of who has collected.',
    '{person} asked that forklift routes around aisle {aisle} stay one-way until the new mirrors are fitted {period}.',
    'The planning office will be quiet between {time} and {time2} so that {team} can finish the quarterly count.',
    'Cycle-to-work parking has been extended by {n} places next to the {gate} gate, with a covered rack on order.',
    'A short trial of the {tool} screen at the {gate} gate starts on {date}; {person} will gather comments from drivers.',
  ],
  closing: [
    'Questions to {person} in {team}.', 'Thank you for your patience while this is done.', 'Please pass this on to anyone on leave this week.',
    'We will confirm the final dates on the noticeboard.', 'No action is needed from most teams.', 'Details will follow once the quote is in.',
  ],
  email: [
    'Thanks for the update. I have moved the {asset} check to {weekday} so it does not clash with the delivery from {supplier}.',
    'Could you let me know whether {person} is still free on {date}? The room is booked until {time}.',
    'Just to confirm, the handsets go back to {team} on {weekday} and the spares stay with us until the end of the month.',
    'I walked past aisle {aisle} this morning and the markings look fine, so we can skip the repaint for now.',
    'The visitor from {supplier} arrives at {time}. Please make sure reception has the badge ready.',
    'I will bring the sample cartons to the meeting; if the lid still pops open we should ask for a thicker board.',
    'Happy with the plan. Let us review it again {period} and see whether the extra bench is still needed.',
    'Sorry for the late reply: I was at {site2} all day. The short answer is yes, the lift can be booked for {date}.',
    'Attached is the rota for next week. Nothing has changed except that {person} swaps with {other} on {weekday}.',
    'The engineer called to say the {asset} part is delayed by {small} days. I will chase again on {weekday}.',
  ],
};

export const QA = [
  ['How do I book a visitor badge?', 'Ask reception at least a day ahead. Visitors sign in at the {gate} gate and hand the badge back on leaving.'],
  ['Where can I charge a handheld scanner?', 'Use any free charging bay on the {floor}. Leave the cradle tidy and report a broken cradle to {team}.'],
  ['Who looks after the shared meeting rooms?', '{team} manages the calendar. Rooms release automatically if nobody checks in within {mins} minutes.'],
  ['What should I do if the {asset} stops working?', 'Switch it off, put a note on it and tell {person}. Do not try to open the casing.'],
  ['Can I park at {site2}?', 'Only with a day pass from {team}. Regular parking is at {site}.'],
  ['When is the next fire drill?', 'Drills are announced on the noticeboard a week ahead. The fire marshals walk each floor before the all-clear.'],
  ['How do I request a new locker?', 'Send a short note to {team} with your name and shift. Lockers are allocated on {weekday}s.'],
  ['What is the quiet hour in the planning office?', 'Between {time} and {time2} phone calls move to the side rooms.'],
  ['Who do I tell about a spill?', 'Call the number on the spill kit cabinet. A trained colleague from {team} will attend.'],
  ['How do I report a near miss?', 'Fill in the one-page form at the {gate} gate or ask {person}. Reports are read every {weekday}.'],
  ['How are lost items handled?', 'Lost property is kept in the store on the {floor} for {n} days, then passed to a local charity.'],
  ['Can I borrow a pallet truck?', 'Yes, once you hold the current licence. Sign it out with {person} and return it to the same bay.'],
  ['Where do I find the canteen menu?', 'It is pinned at the {gate} gate and emailed on Mondays. Today\'s special is {dish}.'],
  ['How do I get a replacement badge?', 'Reception issues one the same day. A fee is not charged for the first replacement.'],
  ['What if the courier does not arrive?', 'Wait until {time2}, then ring the carrier\'s depot and tell {team} so the parcels can be rebooked.'],
];

export const POLICY_SECTIONS = ['Vehicle use on site', 'Visitor registration', 'Equipment loans', 'Working at height', 'Lone working', 'Storage of pallets', 'Noise and quiet hours', 'Shared spaces'];
export const POLICY_CLAUSES = [
  'Staff must sign for any {asset} borrowed from {team} and return it by the end of the shift.',
  'A visitor must be accompanied by a member of staff in all areas beyond the {gate} gate.',
  'Pallets are stacked no higher than {small} layers in lane {aisle} and never in front of a fire exit.',
  'Anyone working on the mezzanine edge must use the fixed barrier or a harness checked by {team}.',
  'A report is raised with {team} whenever a vehicle or {asset} is damaged, even if nobody is hurt.',
  'Quiet hours apply in the planning office between {time} and {time2}; calls move to the side rooms.',
  'Lone working in {site2} is limited to {mins} minutes without a check-in call to the gate.',
  'Shared lockers are emptied at the end of each {period} and unclaimed items are taken to the store.',
  'Forklift keys are kept in the key cabinet and signed out by name. Spare keys remain with {person}.',
  'Eating is not permitted in the packing area; use the break room on the {floor}.',
];

export const NEWS_SECTIONS = ['New faces', 'Anniversaries', 'Out and about', 'Canteen corner', 'Safety spot', 'Lost and found', 'Dates for the diary'];
