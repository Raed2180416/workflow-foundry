// Task text for the three R-bench variants of n8n:12679. The job description is a paraphrase of the author's
// description (the original text is not redistributable); it states the job in the author's terms.
import { CONFIG } from './scenarios.mjs';

export const DESCRIPTION = `A marketing team keeps its CRM (Zoho CRM) and its e-mail marketing tool (KlickTipp) aligned automatically.
Whenever a contact is created, changed or deleted on one side, the other side follows, so customer profiles, subscription state
and segments stay in step without manual updates or CSV imports.

Zoho CRM -> KlickTipp. Zoho workflow rules call the integration in three situations:
 - a contact was registered through a web form: create the subscriber through the DOUBLE opt-in list (it stays Pending until the person
   confirms), store the new KlickTipp id in the Zoho contact and mark the Zoho contact as opted out until the subscription is confirmed;
 - a contact was created or edited: if it is not linked to a subscriber yet, create the subscriber through the SINGLE opt-in list and
   store the KlickTipp id and the opt-out state in Zoho; if it is linked, update the subscriber and copy the subscriber's subscription
   state back into the Zoho opt-out flag. Afterwards carry the contact's segment tags over to the subscriber;
 - a contact was deleted: delete the linked subscriber.

KlickTipp -> Zoho CRM. KlickTipp calls the integration when an automation tags a subscriber for sync, and when a subscriber is deleted:
 - tagged for sync: if the subscriber has no Zoho id yet, create the Zoho contact (only possible with a last name), store the Zoho id in
   the subscriber and the KlickTipp id in the contact; otherwise update the linked contact. In both cases mirror the subscription state
   into the Zoho opt-out flag (opted out unless the subscriber is Subscribed) and carry the subscriber's segment tags over to the contact;
 - deleted: delete the linked Zoho contact.

Both systems must end up cross-linked (each record holds the other's id), with the same name, email, phone numbers, birthday and mailing
address, with no duplicates, and the integration must not keep reacting to the changes it makes itself (the author's setup note: Zoho
workflow rules also fire for changes made through the API, so changes by the integration's own Zoho user must not be processed).`;

export const FIELD_MAP = {
  note: 'Fields kept in step. Zoho webhook body key = Zoho API field = KlickTipp field. The Zoho webhook body is built by the author\'s Zoho workflow rules; KlickTipp posts the subscriber as the API returns it.',
  rows: [
    ['email', 'Email', 'email'], ['firstName', 'First_Name', 'fieldFirstName'], ['lastName', 'Last_Name', 'fieldLastName'], ['phone', 'Phone', 'fieldPhone'], ['mobile', 'Mobile', 'fieldMobilePhone'],
    ['homePhone', 'Home_Phone', 'fieldPrivatePhone'], ['fax', 'Fax', 'fieldFax'], ['dateOfBirth', 'Date_of_Birth (YYYY-MM-DD)', 'fieldBirthday (unix seconds; the API also accepts YYYY-MM-DD when writing)'],
    ['mailingStreet', 'Mailing_Street', 'fieldStreet1'], ['mailingCity', 'Mailing_City', 'fieldCity'], ['mailingState', 'Mailing_State', 'fieldState'], ['mailingZip', 'Mailing_Zip', 'fieldZip'], ['mailingCountry', 'Mailing_Country', 'fieldCountry'],
    ['klicktippId', 'KlickTipp_ID (the subscriber id)', `${CONFIG.klicktipp.fields.zohoContactId} (the Zoho contact id)`],
    ['(not in the webhook)', 'Email_Opt_Out (boolean)', 'status: Subscribed | Pending | Unsubscribed'],
  ],
};

export const API = {
  note: 'Every call is synchronous and returns {status, body}. Statuses >= 400 are errors (nothing changed). The two systems are mocks of the vendors\' APIs: deterministic, stateful, shaped after what the author\'s workflow uses.',
  calls: {
    'zoho.getContact': { args: '{id}', ok: '200 {data:[record]} (record has the Zoho API field names, Tag:[{id,name}], Modified_By:{name}); 404 if absent' },
    'zoho.createContact': { args: '{fields}  (Zoho API field names; Last_Name is mandatory)', ok: '201 {data:[{code:"SUCCESS", details:{id}}]}; 400 MANDATORY_NOT_FOUND / INVALID_DATA' },
    'zoho.updateContact': { args: '{id, fields}', ok: '200 {data:[{code:"SUCCESS", details:{id}}]}; 404 if absent' },
    'zoho.bulkUpdate': { args: '{records:[{id, ...fields}]}  (PUT /Contacts)', ok: '200 {data:[one result per record]}; per-record errors do not change the HTTP status' },
    'zoho.deleteContact': { args: '{id}', ok: '200; 404 if absent' },
    'zoho.addTags': { args: '{ids:[...], tags:[{name}]}', ok: '200 {data:[one result per id]}' },
    'zoho.searchContacts': { args: '{email}', ok: '200 {data:[records]}; 204 when nothing matches' },
    'klicktipp.getSubscriber': { args: '{id} or {email}', ok: '200 subscriber {id,email,status,listId,tags:[tagId],fullname,fieldFirstName,...,<zohoIdField>}; 404' },
    'klicktipp.subscribe': { args: '{email, listId, tagId, fields:{fieldId:value}}', ok: '200 subscriber. Upsert by email: a new subscriber gets status Subscribed on a single opt-in list and Pending on a double opt-in list; an existing one keeps its status and list' },
    'klicktipp.updateSubscriber': { args: '{id | lookupEmail, email?, fields:{fieldId:value}}', ok: '200 subscriber; 404; 409 if the new email belongs to another subscriber. Never changes the status' },
    'klicktipp.deleteSubscriber': { args: '{id}', ok: '200; 404 if absent' },
    'klicktipp.tag': { args: '{email, tagIds:[...]}', ok: '200 subscriber. Applying an ACTIVATION tag makes KlickTipp post the subscriber to the integration (whoever applied it)' },
    'state.get': { args: '{key}', ok: '200 {value, version}; 404' },
    'state.put': { args: '{key, value, ifVersion?}', ok: '200 {version}; 409 if ifVersion does not match (compare-and-swap). Durable between events of one scenario; not an external effect' },
  },
};

export const PROTOCOL = `How your solution is run.
The environment plays a series of scenarios against fresh Zoho CRM and KlickTipp mocks. In each, people work in the two systems (create, edit,
unsubscribe, delete) and the systems send your integration ONE EVENT AT A TIME, in order, until both are quiet. You never see who caused an event
except through what the event contains. Events: {seq, trigger, data} with trigger one of
  zoho-created-or-updated, zoho-form, zoho-deleted   data = the webhook request {headers, params, query, body:{...}} (see fieldMap)
  kt-tagged, kt-deleted                              data = the subscriber as KlickTipp posts it
Your solution handles each event by calling the API (inputs.api) and then finishes that run. Provide it as an ES module with
\`export default function handle(event, api)\` (api.zoho.getContact({id}) etc., synchronous), or, if you can only express pure functions, as
\`policy({event, history}) -> {call, args} | {done: true}\` which the harness calls repeatedly with the growing history of {call, args, response}.
Limits: at most ${CONFIG.limits.runsPerQuiescence} events are handled per originating change (a step with several changes gets that many each) before the harness declares a loop; at most ${CONFIG.limits.callsPerRun} calls per event.
The result is judged by what both systems contain after every step and by the trace of your calls. Nothing else counts.`;

const T1 = `TASK T1 (translate). Below is the original n8n workflow "Sync contacts two-way between Zoho CRM and KlickTipp" (file original/workflow.json,
read from the corpus at task time). Produce an equivalent integration: for every event the same job gets done in the same way.
The definition contains the author's own account ids (list ids, tag ids, the KlickTipp custom field key, the integration user's name). In this
environment they correspond, by role, to inputs.config: the two lists (single and double opt-in), the "created" and "created via form" tags, the two segment tags,
the Zoho-id field, and apiUserName. Use the environment's values.`;
const T2 = `TASK T2 (rebuild from intent). You do not have the original workflow. Build an integration that does the job described in inputs.description,
using inputs.fieldMap, inputs.config, inputs.api and the worked examples in inputs.examples.`;
const T3 = `TASK T3 (improve). Below is the original n8n workflow (original/workflow.json) and the description of its job. Build an integration that does the same job
but cheaper and more reliable than the original: it must stay within the cost target (budget.externalCalls external calls over the scored scenarios, which is what the original
workflow uses on exactly these scenarios) and it is also judged on reliability properties of the sync that the original may not have. Reproducing the original's behaviour
exactly will not be enough. Work out what can go wrong with a two-way sync of this kind and fix it without changing what the job is.`;

export const TASK_TEXT = { T1, T2, T3 };
export const SKELETON = `// handler.mjs: your integration. Called once per event.
// event = { seq, trigger, data }.  api.zoho.* and api.klicktipp.* return { status, body } (synchronous).
export default function handle(event, api) {
}
`;
