// C2 `objective_ungrounded` composer (JUDGE-PROGRAM.md §1.2 C2; plan group "construction-crossfamily").
//
// An objective is composed from clauses; each clause asks for a capability of the catalog below (a tool a registry may list),
// for something the model can do by itself (no tool), or for something no registry can list (an impossible capability).
// The state is {objective, capabilities}: the capabilities listed at request time, one "name: description" line each.
//   yes  the objective needs a capability that no listed tool provides: a requested tool is missing from the listing (often
//        with a look-alike that does something else listed in its place), or a clause asks for the impossible
//   no   every requested tool is listed (and model-only clauses need none)
// The label is the composition's truth. The baseline (extractRequirements in src/construction-objective.mjs) only knows two cue
// families (telepathy, magic) and never reads the listing; a flip twin keeps the objective and adds the missing tool.
//
// Every clause and description is text a development agent wrote (no two-model filter: the clause carries its capability by
// construction, and the listing line says what each tool does in plain words).
import { createHash } from 'node:crypto';

const sha = s => createHash('sha256').update(s).digest('hex');
const hnum = s => parseInt(sha(s).slice(0, 8), 16);
const pick = (list, key) => list[hnum(key) % list.length];
const ranked = (list, key) => list.map(x => ({ x, h: sha(`${key}|${typeof x === 'string' ? x : JSON.stringify(x)}`) })).sort((a, b) => (a.h < b.h ? -1 : 1)).map(o => o.x);

// name, what the listing says, clauses (imperative sentences asking for it), a look-alike that does something else
export const CAPABILITIES = Object.freeze([
  { name: 'web.fetch', desc: 'download the text of a web page from its address', alike: 'web.search', clauses: ['Download the page at the address in the request.', 'Read the contents of the web page that was linked.', 'Fetch the article from its link.'] },
  { name: 'web.search', desc: 'search the web and return a list of result links', alike: 'web.fetch', clauses: ['Search the web for recent coverage of the topic.', 'Look the company up on a search engine.', 'Find pages online that mention the product name.'] },
  { name: 'email.send', desc: 'send an email message to an address', alike: 'email.read', clauses: ['Email the summary to the team.', 'Send the report by email to the account manager.', 'Mail the customer a short confirmation.'] },
  { name: 'email.read', desc: 'read messages from a mailbox', alike: 'email.send', clauses: ['Read the latest messages in the support mailbox.', 'Go through the incoming mail from the supplier.', 'Look at the unread emails from this morning.'] },
  { name: 'sms.send', desc: 'send a text message to a phone number', alike: 'chat.post', clauses: ['Text the on-call engineer.', 'Send an SMS alert to the duty manager.', 'Message the courier by text when the parcel is ready.'] },
  { name: 'chat.post', desc: 'post a message to a team chat channel', alike: 'sms.send', clauses: ['Post an update in the team channel.', 'Announce the result in the operations chat.', 'Write a note to the project channel.'] },
  { name: 'calendar.create', desc: 'create an event on a shared calendar', alike: 'email.send', clauses: ['Book a meeting on the shared calendar.', 'Put the deadline into the team calendar.', 'Add the review session to the calendar.'] },
  { name: 'file.read', desc: 'read a file from the workspace', alike: 'file.write', clauses: ['Open the spreadsheet in the workspace.', 'Read the notes file from the workspace.', 'Load the exported report from the workspace.'] },
  { name: 'file.write', desc: 'write a file to the workspace', alike: 'file.read', clauses: ['Save the result as a file in the workspace.', 'Write the table to a file.', 'Store the final text in a workspace file.'] },
  { name: 'db.query', desc: 'run a read-only query against the company database', alike: 'db.update', clauses: ['Look the customer up in the company database.', 'Query the company database for last month\'s orders.', 'Pull the stock levels from the company database.'] },
  { name: 'db.update', desc: 'update rows in the company database', alike: 'db.query', clauses: ['Record the outcome in the company database.', 'Update the order status in the company database.', 'Write the new address back to the company database.'] },
  { name: 'pdf.extract', desc: 'extract the text from a PDF document', alike: 'file.read', clauses: ['Pull the text out of the attached PDF.', 'Extract the wording of the contract PDF.', 'Get the text from the PDF invoice.'] },
  { name: 'image.describe', desc: 'describe the content of an image', alike: 'image.generate', clauses: ['Describe what is in the attached photo.', 'Say what the screenshot shows.', 'Tell me what the uploaded picture contains.'] },
  { name: 'image.generate', desc: 'generate an image from a text prompt', alike: 'image.describe', clauses: ['Create an illustration for the post.', 'Generate a banner image for the campaign.', 'Draw a simple diagram for the slide.'] },
  { name: 'speech.transcribe', desc: 'transcribe an audio recording to text', alike: 'translate.text', clauses: ['Transcribe the recording of the call.', 'Turn the voice memo into text.', 'Write down what is said in the audio file.'] },
  { name: 'translate.text', desc: 'translate text from one language to another', alike: 'speech.transcribe', clauses: ['Translate the notice into Spanish.', 'Put the announcement into German.', 'Render the product description in French.'] },
  { name: 'ticket.create', desc: 'open a ticket in the issue tracker', alike: 'chat.post', clauses: ['Open a ticket for the broken export.', 'File an issue in the tracker for the outage.', 'Create a tracker ticket for each defect found.'] },
  { name: 'payment.charge', desc: 'charge a saved payment method', alike: 'db.update', clauses: ['Charge the customer\'s saved card.', 'Take the payment from the stored payment method.', 'Bill the saved card for the renewal.'] },
  { name: 'shell.run', desc: 'run a shell command in a sandbox', alike: 'code.test', clauses: ['Run the build script.', 'Execute the conversion command in a shell.', 'Run the data clean-up script.'] },
  { name: 'code.test', desc: 'run a test suite and return the results', alike: 'shell.run', clauses: ['Run the unit tests and report the results.', 'Execute the test suite for the module.', 'Run the regression tests on the new build.'] },
  { name: 'spreadsheet.edit', desc: 'edit cells in a spreadsheet', alike: 'file.write', clauses: ['Update the totals in the spreadsheet.', 'Fill in the missing cells of the sheet.', 'Correct the figures in the budget spreadsheet.'] },
  { name: 'map.route', desc: 'compute a driving route between two places', alike: 'web.search', clauses: ['Work out the driving route for the delivery.', 'Find the best road route between the two depots.', 'Plan the drive from the warehouse to the client.'] },
  { name: 'phone.call', desc: 'place a voice call to a phone number', alike: 'sms.send', clauses: ['Phone the supplier and confirm the order.', 'Call the client to ask about the delay.', 'Ring the shop to check their opening hours.'] },
]);
export const CAPABILITY_BY_NAME = Object.freeze(Object.fromEntries(CAPABILITIES.map(c => [c.name, c])));
export const listingLine = c => `${c.name}: ${c.desc}`;

// Clauses the model does by itself: they need no tool.
export const MODEL_ONLY = Object.freeze(['Summarise it in two short paragraphs.', 'Rewrite the message in a friendlier tone.', 'Classify the sentiment as positive, neutral or negative.', 'Draft three subject lines.', 'Pick the most urgent item and explain why.', 'Turn the bullet points into a short paragraph.', 'Extract the names and dates mentioned in the text.', 'Suggest a clearer title.']);

// Clauses that no registry can list (software cannot do them). `regex`: the baseline's cue families (telepathy, magic) catch them.
export const IMPOSSIBLE = Object.freeze([
  { text: 'Use telepathy to find out what the customer is thinking.', regex: true },
  { text: 'Cast a magic spell to speed up the delivery.', regex: true },
  { text: 'Fly the parcel over with a warp drive.', regex: true },
  { text: 'Use time travel to send last week\'s report yesterday.', regex: true },
  { text: 'Read the customer\'s mind to learn what they really want.', regex: false },
  { text: 'Predict next week\'s winning lottery numbers.', regex: false },
  { text: 'Teleport the parcel to the buyer\'s door.', regex: false },
  { text: 'Taste the sample and describe its flavour.', regex: false },
  { text: 'Shake hands with the visitor at the front desk.', regex: false },
  { text: 'Smell the milk to see whether it has gone off.', regex: false },
  { text: 'Plant a tree in the customer\'s garden and send a photo of it.', regex: false },
  { text: 'Carry the boxes to the loading dock by hand.', regex: false },
]);
const INTROS = Object.freeze(['Automate this chore.', 'Here is what the team wants done.', 'Please take care of the following.', 'The workflow should do this.', 'We want these steps handled.']);

// One composition: { objective, needs: [tool names], impossible: bool, capabilities: [listing lines], yes, why, twin? }
//   kind 'missing'  a requested tool is not listed (the twin lists it)
//   kind 'impossible'  a clause asks for the impossible
//   kind 'grounded'  everything is listed
export function composeGrounding(key, kind) {
  const nTools = 1 + (hnum(`${key}|nt`) % 3), tools = ranked(CAPABILITIES, `${key}|tools`).slice(0, nTools);
  const clauses = tools.map(c => ({ cap: c.name, text: pick(c.clauses, `${key}|cl|${c.name}`) }));
  const modelOnly = hnum(`${key}|mo`) % 2 === 0 ? [{ cap: null, text: pick(MODEL_ONLY, `${key}|mo1`) }] : [];
  const imp = kind === 'impossible' ? [{ cap: null, impossible: true, text: pick(IMPOSSIBLE, `${key}|imp`).text }] : [];
  const parts = ranked([...clauses, ...modelOnly, ...imp], `${key}|order`);
  const missing = kind === 'missing' ? tools[hnum(`${key}|miss`) % tools.length] : null;
  const size = 9 + (hnum(`${key}|size`) % 5);
  const must = tools.filter(c => c !== missing).map(c => c.name);
  const lookalike = missing && hnum(`${key}|alike`) % 10 < 6 ? CAPABILITY_BY_NAME[missing.alike] : null;
  const pool = ranked(CAPABILITIES.filter(c => c !== missing && !must.includes(c.name) && c !== lookalike), `${key}|pool`);
  const listed = [...must.map(n => CAPABILITY_BY_NAME[n]), ...(lookalike && !must.includes(lookalike.name) ? [lookalike] : []), ...pool].slice(0, Math.max(size, must.length + 1));
  const lines = ranked(listed, `${key}|listing`).map(listingLine);
  const objective = [pick(INTROS, `${key}|intro`), ...parts.map(p => p.text)].join(' ');
  const out = { objective, needs: tools.map(c => c.name), impossible: kind === 'impossible', capabilities: lines, yes: kind !== 'grounded', missing: missing?.name ?? null, kind, lookalike: lookalike?.name ?? null };
  if (kind === 'missing') out.twin = { objective, capabilities: ranked([...listed, missing], `${key}|listing2`).map(listingLine), yes: false };
  return out;
}
// The truth recomputed from the composed parts (the state-only solver's second path): yes iff an impossible clause or a requested
// tool absent from the listing.
export function groundingTruth({ needs, impossible, capabilities }) {
  const listed = new Set(capabilities.map(l => l.split(':')[0]));
  return impossible || needs.some(n => !listed.has(n)) ? 'yes' : 'no';
}
