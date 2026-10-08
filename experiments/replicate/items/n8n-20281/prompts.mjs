// Task text for the three R-bench variants of n8n:20281. The job description is OUR paraphrase of the author's description (the original text is not
// redistributable); it states the job in the author's terms. Everything a solver receives is data, not instructions.
import { SHEET_COLUMNS, MODEL_TIERS, CALL_CAP, MODEL_CALL_CAP, LATENCY_MS } from './spec.mjs';

export const DESCRIPTION = `A support team receives customer email in two shared mailboxes, one in Gmail and one in Microsoft Outlook. This automation watches both mailboxes
(each is polled about once a minute, one new message at a time), turns every new message into a ticket or a comment on an existing ticket when it is a real customer
request, alerts the right Slack channel, optionally thanks the customer, and keeps an audit row for every message it saw.

For every new message the automation:
1. Normalises it into one shape, whichever mailbox it came from: source (Gmail or Outlook), message id, thread id (Gmail thread id / Outlook conversation id), received time,
   sender name and address (address in lower case), recipients, subject, body as plain text (HTML is reduced to text), a link to the message and whether it has attachments.
   Quoted earlier messages ("On ... wrote:", "-----Original Message", lines starting with ">") are cut off, and very long bodies are trimmed (config.maxBodyChars).
2. Skips senders that are not customers BEFORE any model is used: senders whose domain is one of config.internalDomains, and automated senders (the address contains
   one of the comma separated config.ignoreSenderPatterns, compared in lower case). Skipped messages cause no model call, no ticket and no message; they are only logged.
3. Asks a language model to classify the rest. The answer is structured: isCustomerRequest (true only for a New Requirement, Issue or Bug that comes from a customer, never
   for vendors, recruiters, marketing, auto-replies, thank-you notes or meeting logistics), category (New Requirement | Issue | Bug | Other), priority (Critical | High |
   Medium | Low), confidence (0..1, how sure it is about the category), and a title, summary, product area, customer name and company, sentiment and steps to reproduce.
   Category rules: Bug = reproducible software defect; Issue = something does not work as expected but is not clearly a defect (access, configuration, how-to, performance,
   outages, billing/account); New Requirement = feature, enhancement, integration, report or customisation request; Other = anything needing no support action.
   Priority: Critical = production down, data loss, security incident, many users blocked or a severe business deadline today; High = key workflow blocked with no workaround
   or strong urgency; Medium = a workaround exists or limited impact (most feature requests); Low = cosmetic, nice-to-have, general questions.
4. Decides where the message goes. A customer request in category Bug, Issue or New Requirement with confidence at or above config.minConfidence is ESCALATED. A customer request
   below that confidence, or a message the model could not classify at all (the call kept failing), goes to the human REVIEW queue (a Slack channel) instead. Everything else
   (not a customer request, category Other) is just logged.
5. Escalation. Look for an OPEN ticket for the email thread. If one exists, add the new message as a comment on it (no new ticket). Otherwise create a ticket in Jira: project
   config.jiraProjectKey; issue type by category (Bug -> config.bugIssueType, Issue -> config.issueIssueType, New Requirement -> config.requirementIssueType); summary = the
   model's title; description with sender, category, priority, summary and the original text; priority Critical/High/Medium/Low -> Jira Highest/High/Medium/Low
   (config.setJiraPriority); labels "customer-email", the category tag (bug | issue | requirement) and the thread label described in the Jira notes of inputs.api.
   Then post a Slack message about the result to the category channel (Bug -> config.bugSlackChannel, Issue -> config.issueSlackChannel, New Requirement ->
   config.requirementSlackChannel) naming the ticket, and, only when config.teamsWebhookUrl is set, post an Adaptive Card that names the ticket to that Teams webhook.
6. Customer acknowledgement, set by config.ackMode: "off" does nothing; "send" replies to the customer (to the sender only, in the original conversation) with a short thank-you
   that names the ticket; "draft" only saves that reply as a draft (Gmail: a draft in the thread; Outlook: a draft reply). Acknowledge only a NEWLY opened ticket, never a
   follow-up comment, a review item or an ignored message. Use the service of the mailbox the message came from.
7. Review. For a message sent to the review queue post one Slack message to config.reviewSlackChannel with the sender, the subject and the model's guess, so a person can triage it.
   No ticket, no Teams card, no reply.
8. Audit. For EVERY message (skipped, ignored, reviewed or escalated) append exactly one row to the triage sheet with the columns listed in inputs.api.sheet, including the
   classification actually used (Customer Request Yes/No, Category, Priority, Confidence), the Jira Key and Follow-up flag, whether Slack was notified, the acknowledgement
   status and a status text. A skipped sender is logged as Customer Request "No", category Other, priority Low, confidence 1, classified by "rules".
The author also lists a Slack alert for failed workflow runs; it is not part of what is scored here.`;

const sheetDoc = `One row per message, an object keyed by these column names (all of them are optional in a row; unknown names are rejected): ${SHEET_COLUMNS.join(' | ')}.
Conventions: Customer Request = "Yes" | "No"; Category = New Requirement | Issue | Bug | Other, or "Unclassified" when the model failed; Priority = Critical | High | Medium | Low;
Confidence = a number 0..1; Message ID = the provider's message id (Gmail "id", Outlook "id"), the key by which rows are matched; Jira Key = the ticket the message ended up on
(new or commented), empty otherwise; Follow-up = "Yes" when it was added as a comment; Customer Ack = text starting with "Sent", "Draft created", "Skipped" or "Failed".`;

export const API = {
  note: `Every call is synchronous and returns {status, body}; status >= 400 is an error and nothing changed (except a gateway timeout, which can hide a committed write). The services are deterministic mocks shaped after the vendors' APIs.
At most ${CALL_CAP} calls (${MODEL_CALL_CAP} of them model calls) per message; then the call is refused with 429. Virtual latency per call is fixed: gmail ${LATENCY_MS.gmail} ms, outlook ${LATENCY_MS.outlook}, jira search ${LATENCY_MS['jira.search']}, jira create ${LATENCY_MS['jira.createIssue']}, jira comment ${LATENCY_MS['jira.addComment']}, slack ${LATENCY_MS.slack}, teams ${LATENCY_MS.teams}, sheets ${LATENCY_MS.sheets}, model ${LATENCY_MS.modelBase} + ${LATENCY_MS.modelPerOutputToken} per output token.`,
  calls: {
    'model.complete': { args: '{system?, prompt, schema?, tier?: "standard" | "small"}', ok: `200 {content:{...}, usage:{inputTokens,outputTokens}, costUsd, tier}. The content is the model's structured answer for the mail whose text is in the prompt (the mock recognises the mail by the reference token "Msg-ref: MR-xxxxx" that every message carries; a prompt without a message gets 422 NO_RECORDING). With schema.properties only those properties are returned and paid for. A call can fail (500/503); a repeat may succeed. Tiers: standard $${MODEL_TIERS.standard.inputPerMTok}/$${MODEL_TIERS.standard.outputPerMTok} per million input/output tokens, small $${MODEL_TIERS.small.inputPerMTok}/$${MODEL_TIERS.small.outputPerMTok} (cheaper, less accurate, and less confident when wrong). Answer properties: isCustomerRequest, category, priority, confidence, productArea, title, summary, customerName, customerCompany, sentiment, stepsToReproduce, reasoning.` },
    'gmail.reply': { args: '{messageId, text, replyToSenderOnly?: boolean}', ok: '200 {id, threadId, labelIds, to, cc}. Without replyToSenderOnly: true the reply goes to everyone on the original message.' },
    'gmail.createDraft': { args: '{to, subject, text, threadId?}', ok: '200 {id, message:{id, threadId}}; saves a draft, sends nothing' },
    'outlook.reply': { args: '{messageId, comment (HTML), saveAsDraft?: boolean, replyToSenderOnly?: boolean}', ok: '202 {} when sent; 201 {id, isDraft:true} when saveAsDraft is true' },
    'jira.search': { args: '{jql, fields?, limit?}', ok: '200 {total, issues:[{id,key,fields}]}. JQL subset only: clauses joined by AND on labels (= != in), statusCategory / status / issuetype / project (= !=), key (= in), optional ORDER BY created ASC|DESC. Search is eventually consistent: a ticket created a moment ago may not be found yet.' },
    'jira.createIssue': { args: '{fields:{project:{key}, issuetype:{name}, summary, description, labels:[...], priority:{name}, assignee?:{accountId}}}', ok: '201 {id, key, self}; 400 {errors:{field:message}}; a 504 means the write may or may not have happened' },
    'jira.addComment': { args: '{issueKey, body}', ok: '201 {id}; 404 unknown key' },
    'jira.getIssue': { args: '{key}', ok: '200 issue; 404' },
    'slack.postMessage': { args: '{channel (name, with or without #), text}', ok: '200 {ok:true, ts} or 200 {ok:false, error} (for example channel_not_found). Slack renders <!channel>, <!here> and <!everyone> as notifications to the whole channel.' },
    'teams.post': { args: '{url, body}', ok: '202 {}; 404 if the url is not the configured webhook; 400 unless body is {type:"message", attachments:[{contentType:"application/vnd.microsoft.card.adaptive", content:{body:[...]}}]}' },
    'sheets.appendRow': { args: '{row}', ok: '200 {updates:{updatedRows, updatedRange}}; 400 unknown column; 503 transient, nothing written' },
    'sheets.appendRows': { args: '{rows:[...]}', ok: 'same, up to 100 rows in one call' },
    'state.get': { args: '{key}', ok: '200 {value, version}; 404' },
    'state.put': { args: '{key, value, ifVersion?}', ok: '200 {version}; 409 if ifVersion does not match (compare-and-swap). Kept between messages of one scenario; not an external effect.' },
  },
  sheet: sheetDoc,
  jiraNotes: `Thread label. Tickets opened by this automation carry the label "email-thread-" followed by the thread key hashed with djb2 in base 36: key = thread id (Gmail threadId, Outlook conversationId), h = 5381, for each character h = (h * 33 + code) mod 2^32 (unsigned 32 bit), label = "email-thread-" + h.toString(36). The tickets that already exist in Jira carry it too, so "the open ticket of this thread" is the one with that label whose status category is not Done (a Done ticket is finished business: a new problem on the same thread needs a new ticket).`,
};

export const PROTOCOL = `How your solution is run.
The environment plays a series of scenarios against fresh mock services. In each, new messages arrive ONE AT A TIME, in order: {seq, trigger, at, data} with trigger
"gmail-new-email" (data = the Gmail trigger item with simple=false: id, threadId, from.value[0], to, cc, subject, text/html, date, attachments ...) or "outlook-new-email"
(data = the Microsoft Graph message: id, conversationId, from.emailAddress, toRecipients, ccRecipients, subject, body{contentType,content}, bodyPreview, receivedDateTime,
hasAttachments, webLink). The deployment settings are inputs.config. Your solution handles each message by calling the services in inputs.api, then finishes that run.
Provide it as an ES module with \`export default function handle(event, api)\` (api.jira.search({...}) etc., synchronous, returning {status, body}), or, if you can only express
pure functions, as \`policy({event, history}) -> {call, args} | {done: true}\` which the harness calls repeatedly with the growing history of {call, args, response}.
The result is judged only by what the services contain afterwards and by the trace of your calls: tickets and comments, Slack and Teams posts, replies and drafts, the audit
rows, and the model calls you paid for. Nothing else counts. The scored stream is 80 messages; some belong to threads that already have a ticket, some are not customers.`;

const T1 = `TASK T1 (translate). Below is the original n8n workflow "Create Jira tickets from Gmail and Outlook support emails with OpenAI and Slack" (file original/workflow.json,
read from the corpus at task time). Produce an equivalent integration: for every message the same job gets done in the same way.
The definition carries the author's placeholders (Jira base URL, internal domain, channels, company, sheet, credentials). Here they correspond to inputs.config. The OpenAI chat
node corresponds to model.complete (tier "standard"); the workflow's Google Sheets append to sheets.appendRow; the Jira nodes and the Jira HTTP request to the jira.* calls.
The definition dispatches work through a sub-workflow that calls itself; any equivalent structure is fine.`;
const T2 = `TASK T2 (rebuild from intent). You do not have the original workflow. Build an integration that does the job described in inputs.description, using inputs.config,
inputs.api and the worked examples in inputs.examples (messages with the classification the model gave and what the automation did with them).`;
const T3 = `TASK T3 (improve). Below is the original n8n workflow (original/workflow.json) and the description of its job. Build an integration that does the same job at a fraction of
the cost and that is more reliable than the original: it must stay within the targets in budget.target (model cost, external calls and virtual latency over the scored stream, as
measured on exactly these messages; the original's own numbers are in budget.baseline) and it is also judged on reliability properties of the whole pipeline that the original
may not have. The same routing, dedupe, review-queue and acknowledgement rules and the same accuracy thresholds (category >= 0.85, priority >= 0.80) apply.
Reproducing the original exactly will not be enough. Work out what can go wrong with a pipeline like this (services that time out after committing, stale search results,
transient failures, mail delivered twice, text from outside that ends up inside your messages) and handle it without changing what the job is.`;

export const TASK_TEXT = { T1, T2, T3 };
export const SKELETON = `// handler.mjs: your integration. Called once per new message.
// event = { seq, trigger, at, data }.  api.jira.*, api.slack.*, api.model.* ... return { status, body } (synchronous).
export default function handle(event, api) {
}
`;
