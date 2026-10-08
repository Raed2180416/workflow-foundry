// C1 `objective_requirements` objective composer (JUDGE-PROGRAM.md §1.2 C1; plan group "construction-crossfamily").
//
// An objective is built from requirement phrases. Each phrase belongs to one requirement of REQUIREMENT_LIBRARY
// (src/construction-objective.mjs) in one of three roles:
//   pos    the objective asks for the requirement (with the library's cue words, or in a paraphrase without any)
//   neg    the objective says the requirement is NOT needed ("no approval step is needed"): the cue words appear, the label is no
//   decoy  the objective uses a cue word in another sense ("the approval rate of last quarter", "the Elm Street branch", "if
//          found, please return" in a quotation): the cue words appear, the label is no
// The label of a requirement is "yes" exactly when a pos phrase of it was composed, or when a pos phrase of another
// requirement implies it (IMPLIES: a high-risk decision handed to a person is a hand-off; a guard around a model reply
// is a check of its output). A requirement that no phrase mentions is "no". The label is the composed requirement set;
// the regex baseline (extractRequirements) is never consulted for labels, only compared against them.
//
// Every phrase is text a development agent wrote; none has been through the two-model filter (it carries its brief in
// its role: the label is what the phrase was written to mean). The base sentences (intro, fillers) contain no cue word of
// any requirement (the group's test asserts it), so any regex hit comes from a designed phrase.
import { createHash } from 'node:crypto';

const sha = s => createHash('sha256').update(s).digest('hex');
const hnum = s => parseInt(sha(s).slice(0, 8), 16);
const pick = (list, key) => list[hnum(key) % list.length];
const ranked = (list, key) => list.map(x => ({ x, h: sha(`${key}|${typeof x === 'string' ? x : JSON.stringify(x)}`) })).sort((a, b) => (a.h < b.h ? -1 : 1)).map(o => o.x);

export const REQUIREMENT_IDS = Object.freeze(['human-gate', 'high-risk-not-model-owned', 'durable-wait', 'compensation-named-limit', 'branching', 'recovery', 'isolation', 'pre-post-llm-gate', 'map-fanout', 'loop-until', 'research-grounding', 'verification']);
// a requirement that a positive phrase of another one also asks for
export const IMPLIES = Object.freeze({ 'high-risk-not-model-owned': ['human-gate'], 'pre-post-llm-gate': ['verification'] });
// (requirement, role) combinations that contradict each other in one objective
const CONFLICTS = Object.freeze([
  [['human-gate', 'neg'], ['high-risk-not-model-owned', 'pos']], [['loop-until', 'neg'], ['recovery', 'pos']], [['recovery', 'neg'], ['loop-until', 'pos']],
  [['verification', 'neg'], ['pre-post-llm-gate', 'pos']], [['verification', 'neg'], ['research-grounding', 'pos']], [['human-gate', 'neg'], ['pre-post-llm-gate', 'pos']],
]);

const P = (pos, nocue, neg, decoy) => ({ pos: [...pos, ...nocue], posCue: pos, posNoCue: nocue, neg, decoy });
export const PHRASES = Object.freeze({
  'human-gate': P(
    ['A person on the team has to approve the result before anything is released.', 'Get a sign-off from the project lead before the work is published.', 'The final version needs a supervisor\'s approval.', 'A reviewer must accept the draft before it is sent anywhere.', 'A human operator has to approve the output before anyone relies on it.'],
    ['Someone on the team has to look it over and say go before it leaves the building.', 'Nothing gets published until the project lead has given the green light.', 'The result goes to a colleague for a final yes or no.', 'A teammate takes the final decision on whether it goes out.'],
    ['No approval step is needed; it can go out directly.', 'There is no need for a human in the loop here.', 'Nobody has to sign off on this; the system may release it by itself.'],
    ['Quote last quarter\'s approval rate in the summary.', 'Report how many requests were escalated last week.', 'Mention that the human resources team has moved to the second floor.']),
  'high-risk-not-model-owned': P(
    ['Anything involving medical advice must be handled by a nurse, never answered by the model.', 'Legal questions are routed to counsel, and the model must not answer them.', 'Decisions about loans are made by a loan officer, not by the model.', 'Financial advice has to come from a licensed adviser, not from the assistant.'],
    ['Questions about dosage or symptoms go to a clinician; the model must not answer them.', 'Contract disputes are for our lawyers to decide, not the assistant.', 'Whether to write off a customer\'s debt is a decision for a senior officer, never for the model.', 'Tax advice is left to the accountants; the model only drafts neutral summaries.'],
    ['None of this involves medical, legal or financial matters, so the model can answer directly.', 'The topics here are low risk, so the model may reply on its own.'],
    ['We sell medical-grade gloves, and the catalogue text should say so.', 'Mention that the legal name of the company is Brightfen Ltd.', 'The finance team\'s room is on the second floor and should be on the map.']),
  'durable-wait': P(
    ['Wait three days after sending before following up.', 'Pause for a month before closing the case.', 'Set a timer for 48 hours and then continue.', 'Delay the second message until the customer has had time to read the first.', 'Sleep for a week and then send the reminder.'],
    ['Come back to the case after the weekend and carry on.', 'Hold the result for two days so the late reports can arrive.', 'Resume as soon as the supplier\'s confirmation arrives.', 'Give the other team a full working week to respond before continuing.'],
    ['No waiting is needed between the steps.', 'There is no delay between the two steps; run them back to back.'],
    ['Report the average delay of last month\'s deliveries.', 'The pause button on the kiosk is described in the manual, so mention it.', 'Print the words "please wait here" on the floor sign.']),
  'compensation-named-limit': P(
    ['Include a rollback of the earlier steps in case of cancellation.', 'Provide a way to undo the reservation after a cancellation.', 'Model this as a saga: when a later step fails, the earlier ones are reversed.', 'Add a compensating action that returns the money when the booking is dropped.'],
    ['After a cancellation the seat must be released again and the charge returned.', 'Cancelling the order means giving back the money and freeing the slot.', 'Reverse the booking when the trip is called off.', 'When the payment step fails, the booking has to be rolled back.'],
    ['Nothing needs to be rolled back; a failed step can simply stop.', 'No compensation or undo logic is needed here.'],
    ['Add a line about the compensation package to the annual report summary.', 'The undo key on the label printer is covered in the manual, so mention it.', 'Name the sagas displayed in the viking exhibit.']),
  branching: P(
    ['If the file is larger than the limit, send it to the archive; otherwise keep it in place.', 'Use a separate error path for records that cannot be read.', 'On error, skip the record and note it; on success, continue.', 'Branch on the customer\'s region.', 'Route by language: German goes to one queue, everything else to another.'],
    ['Records with a missing date follow a different path than complete ones.', 'Depending on the amount, small orders are handled automatically and large ones differently.', 'Short files go one way and long files another.', 'Failed lookups take a fallback route instead of stopping the run.'],
    ['There is only one path through the work; nothing depends on any condition.', 'No branching is required.'],
    ['Open the report for the Elm Street branch and summarise its sales.', 'The poster says "if found, please return", and that wording should be kept verbatim.', 'Keep the quote "what else can we do?" exactly as written in the speech.']),
  recovery: P(
    ['Retry the upload up to three times when it times out.', 'Recover gracefully from network failures.', 'Recover from a crash by resuming where the run stopped.', 'Messages that keep failing are moved to a dead-letter queue.', 'Retrying a failed step once is fine.'],
    ['A failed download should be attempted again up to three times.', 'Keep going when a single record cannot be processed and come back to it afterwards.', 'Make a second and third attempt before reporting the failure.', 'The run must survive temporary outages of the data service.'],
    ['Do not retry failed steps; report them immediately.', 'A single attempt is enough; nothing needs to be tried again.'],
    ['Add a section on how coral reefs recover after storms.', 'Summarise the plot of the novel Poison Pen for the newsletter.', 'Attach the parks department\'s schedule to the message.']),
  isolation: P(
    ['Run the submitted script in a sandbox.', 'Execute the contributor\'s code in isolation from our servers.', 'Treat the uploaded file as untrusted and open it only in a locked-down environment.', 'Apply the patch only inside a sandboxed copy of the repository.'],
    ['Run the submitted program inside a throwaway container with no network.', 'Open the attachments in a disposable virtual machine so nothing can reach our systems.', 'The downloaded macro may be hostile, so it must run somewhere it cannot touch anything else.', 'Anything a visitor uploads is opened in a cage that is destroyed afterwards.'],
    ['All content here is trusted internal data, so no special isolation is needed.', 'Run it directly on the normal server.'],
    ['Cover the history of the patch panel in the server room guide.', 'Isolation wards were common in old hospitals; mention one in the essay.', 'Link to the GitHub issue tracker page in the footer.']),
  'pre-post-llm-gate': P(
    ['In our customer support chat, filter what goes into the model and what comes out of it.', 'The help center bot must have a filter in front of it and a filter behind it.', 'For CX conversations, apply a pre-filter and a post-filter around the generated answer.', 'Refund conversations get a screen on the incoming message and another on the draft reply.'],
    ['Screen customer messages before the assistant sees them, and screen its reply before it reaches the customer.', 'Put a guard before the model and another after it for anything shown to customers.', 'The assistant\'s answers to shoppers need an inspection on the way in and on the way out.', 'Nothing the model writes for a client may go out unless the outgoing text has been inspected, and the incoming message must be inspected too.'],
    ['The assistant only works on internal documents; no customer ever sees its output.', 'No guard is needed around the model for this internal tool.'],
    ['Write the customer support team\'s opening hours in the footer.', 'Add the help center address to the contact page.', 'Summarise the conversation about parking from the meeting notes.']),
  'map-fanout': P(
    ['Do the same thing for each supplier on the list.', 'Process every row in the spreadsheet separately.', 'Run the analysis in batches over the whole list.', 'Fan out over all regions and merge the results.'],
    ['Go through the list of suppliers one by one and do the same steps on all of them.', 'Apply the procedure to all the entries in the spreadsheet.', 'The same procedure should run over the full set of regions.', 'Handle the whole list of applicants the same way.'],
    ['This is a single document; there is nothing to repeat over.', 'Only one request is handled at a time and there is no list to go through.'],
    ['Describe how the two teams relate to each other in the org chart.', 'Explain how the colour matches the brand guide.', 'Include a short paragraph about the games night on Friday.']),
  'loop-until': P(
    ['Keep refining the summary until it fits on one page.', 'Iterate on the draft until it is under two hundred words.', 'Loop over the tightening step until the text is short enough.', 'Repeat the cleanup pass until no duplicates remain.'],
    ['Repeat the cleaning pass over and over, stopping when no more duplicates turn up.', 'Keep going round and round with the rewrite and stop only when the tone is right.', 'Run the step again and again, ending as soon as nothing changes.'],
    ['One pass is enough; there is no need to repeat anything.', 'Do it once and stop.'],
    ['Add the words "open until 6 pm" to the shop\'s contact page.', 'Refer to the loops of the running track on the sports page.', 'Keep the glossary entry for the word iteration short.']),
  'research-grounding': P(
    ['Support the claims with citations to the underlying papers.', 'Summarise the research on the topic and name the sources used.', 'State the evidence for the conclusion and where it comes from.', 'Refuse to publish claims that are ungrounded.'],
    ['Point to the journal articles the statements are based on.', 'Statements must be traceable to published studies, with full references.', 'Any figure quoted has to come with a pointer to where it was published.', 'Say which published work supports the conclusion.'],
    ['The text is an opinion piece and needs no references.', 'No citations are required for this one.'],
    ['Visit the research park on Tuesday and describe the trip.', 'Mention that the sources of the river are in the northern hills.', 'Add the evidence locker to the building map.']),
  verification: P(
    ['Verify the final numbers against the original data before they are used.', 'Test the result on a few examples before using it.', 'Run a health check on the output and reject it when it fails.', 'Evaluate the draft against the acceptance criteria.', 'Assert that the totals match before continuing.'],
    ['Make sure the totals add up before the result is used.', 'Compare the output with the expected values and refuse to go on when they differ.', 'Do not trust the output until its correctness has been confirmed independently.', 'Re-derive the key figures a second way before relying on them.'],
    ['The output is a rough sketch and does not need any verification.', 'No testing is necessary.'],
    ['Add a note about the test kitchen\'s opening hours.', 'Her score in the chess club is mentioned in the biography.', 'Health and safety signs are to be photographed for the guide.', 'The shop is called Check and Balance Books; use the name in the header.']),
});

// Base sentences: no cue word of any requirement (asserted by the group's test).
export const ITEMS = Object.freeze(['weekly newsletter', 'supplier onboarding forms', 'shipping labels', 'meeting notes', 'product listings', 'survey responses', 'job applications', 'release notes', 'warehouse counts', 'calendar invites', 'training materials', 'price lists']);
export const INTROS = Object.freeze(['Build a workflow that prepares the {item}.', 'We need an automation for the {item}.', 'Set up a process for the {item}.', 'The goal is a repeatable flow for the {item}.', 'Please design a workflow around the {item}.', 'Our team wants a workflow for the {item}.']);
export const FILLERS = Object.freeze(['Keep the steps simple and the output tidy.', 'The team prefers short, plain messages.', 'Use the usual company templates.', 'Everything should run in the background without fuss.', 'The results go to the shared drive.', 'Names and dates follow the house style.']);

const conflicts = chosen => CONFLICTS.some(([a, b]) => chosen.some(m => m.req === a[0] && m.kind === a[1]) && chosen.some(m => m.req === b[0] && m.kind === b[1]));

// One objective: { objective, mentions: [{req, kind, phrase}], required: [ids] }
export function composeObjective(key) {
  const nPos = [3, 4, 3, 4, 5, 2][hnum(`${key}|np`) % 6], nNeg = hnum(`${key}|nn`) % 3 === 0 ? 1 : 0, nDec = 1 + (hnum(`${key}|nd`) % 2);
  let mentions = null;
  for (let attempt = 0; attempt < 60 && !mentions; attempt++) {
    const order = ranked(REQUIREMENT_IDS, `${key}|order|${attempt}`);
    const kinds = [...Array(nPos).fill('pos'), ...Array(nNeg).fill('neg'), ...Array(nDec).fill('decoy')];
    const cand = kinds.map((kind, i) => ({ req: order[i], kind }));
    if (!conflicts(cand)) mentions = cand;
  }
  if (!mentions) throw new Error(`C1: no conflict-free composition for ${key}`);
  mentions = mentions.map(m => ({ ...m, phrase: pick(PHRASES[m.req][m.kind], `${key}|phrase|${m.req}|${m.kind}`) }));
  const required = new Set();
  for (const m of mentions) if (m.kind === 'pos') { required.add(m.req); for (const r of IMPLIES[m.req] ?? []) required.add(r); }
  const intro = pick(INTROS, `${key}|intro`).replace('{item}', pick(ITEMS, `${key}|item`));
  const body = ranked(mentions, `${key}|shuffle`).map(m => m.phrase);
  const filler = hnum(`${key}|filler`) % 2 === 0 ? [pick(FILLERS, `${key}|f1`)] : [];
  const objective = [intro, ...body, ...filler].join(' ');
  return { objective, mentions, required: [...required].sort(), intro, filler };
}
