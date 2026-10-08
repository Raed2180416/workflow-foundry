// Task text for the three R-bench variants. The job description restates the author's header and rules in the author's terms
// (the YAML is MIT, so the original is attached verbatim for T1/T3; T2 gets only this description and worked examples).
import { CONFIG, SPEC, TEXT, LIMITS, T3_COST } from './spec.mjs';

export const DESCRIPTION = `Garage Garbage Day Reminders (from Carlo Costanzo's Home Assistant setup).
Carlo's house has two garage doors, cover.large_garage_door and cover.small_garage_door, summarised by the group ${SPEC.ids.group} ('open' when
any door is open, 'closed' when all are closed). Garbage goes out on Wednesday (recycling and regular garbage) and on Sunday. When a garage door
is opened on a garbage day and stays open, the house reminds Carlo to take the cans to the curb, nags him a few times while the door stays open,
and lets him snooze the nagging from his phone.

START. The group changes from 'closed' to 'open' and then STAYS 'open' for ${SPEC.debounceSeconds} seconds without a break. A door that flaps
open for less than ${SPEC.debounceSeconds} s (a noisy sensor, a reflection) starts nothing; every new opening gets its own ${SPEC.debounceSeconds} s.
The instant those ${SPEC.debounceSeconds} s run out is the REMINDER START, and only then two things are looked at: it has to be a garbage day
(Wednesday or Sunday, by the local weekday at the reminder start, not at the moment the door opened), and the shared snooze timer
${SPEC.ids.timer} must be 'idle' (not running). If either is not so, nothing happens.

REMINDER. At the reminder start, at the same instant, the house does two things:
  - a push to Carlo's phone through the helper script.notify_engine_two_button: title "${SPEC.push.title}", the message below, who "${SPEC.push.who}",
    group "${SPEC.push.group}", tag "${SPEC.push.tag}" (a new push with the same tag replaces the old one), level "${SPEC.push.level}", and two action
    buttons titled "${SPEC.buttons['30m']}" and "${SPEC.buttons['2h']}";
  - one spoken reminder inside the house through script.speech_engine (value1 = the message).
The message is: "Reminder: it's garbage day." then, on Wednesday only, "Both recycling and regular garbage go out today." then
"Please take the cans to the curb before you leave." (Sunday's message has no recycling sentence.)

NAGGING. Alexa in the garage (notify.alexa_media_garage, data.type "announce", the same message) announces ${SPEC.announceOffsets.join(' s, ')} s after the
reminder start. Right before each announcement three things are checked again: the group is still 'open', it is still Wednesday or Sunday, and
the snooze timer is still idle. If any check fails, that announcement and all the later ones of this reminder are cancelled for good (the
sequence ends there and does not resume if the door opens again; only a new ${SPEC.debounceSeconds} s opening starts a new reminder).
A new reminder that starts while an older one is still waiting for its next announcement REPLACES it: the older one's remaining announcements
never happen (the push and the inside speech go out again for the new one).

SNOOZE. Carlo can press "${SPEC.buttons['30m']}" or "${SPEC.buttons['2h']}" on the push. The phone then sends a ${SPEC.ids.snoozeEvent} event carrying the action id the push
declared for that button. The house starts ${SPEC.ids.timer} (timer.start) for 30 minutes (00:30:00) or 2 hours (02:00:00), writes a logbook entry
(script.send_to_logbook, topic "${SPEC.logbookTopic}", message "${TEXT.snoozeLog('30 minutes')}" or "${TEXT.snoozeLog('2 hours')}"), and any reminder sequence in
progress stops. This works even when no sequence is in progress (the push may be old). Notification actions that are not these two buttons
(other apps, other automations) must do nothing. While the timer runs no new reminder starts and waiting announcements are cancelled by the checks above;
when it runs out it is idle again and the next opening reminds again.`;

export const HA_SEMANTICS = `Home Assistant semantics the original definition relies on (as documented for Home Assistant; this harness implements exactly these):
- A state trigger with from/to/for fires when the entity has been in the new state for the whole 'for' period after a matching transition. Any state change of the entity disposes of a pending 'for'; a new matching transition starts a fresh one.
- An event trigger fires when the event type matches and every key in event_data is equal.
- mode: restart: when a trigger fires while an earlier run of the same automation is still going (for instance waiting in a delay), the earlier run is stopped at once, before the new run evaluates anything. mode: single would ignore the new trigger instead.
- Actions run in order. A delay waits. A condition used as an action ends the WHOLE run, quietly, when it is false, also when it sits inside choose or repeat. A stop action ends the run. parallel runs its branches and fails afterwards if any branch failed. repeat/for_each runs its sequence for each list item.
- A service call that fails ends the run with an error (unless continue_on_error is set on it); later actions do not run.
- The weekday and now() are the local time at the moment the action runs (a run that waits sees the time move).
- Called scripts (script.notify_engine_two_button, script.speech_engine, script.send_to_logbook) and notify.alexa_media_garage are services of the owner's setup; here they are mocks that record the call.`;

export const API = {
  note: 'Every call is synchronous, takes no virtual time, and returns {status, body}. Status >= 400 means nothing changed. The services are mocks of the owner\'s Home Assistant; a call to a service that is not listed is answered 404.',
  events: {
    common: 'Every event carries at: {iso (local time, YYYY-MM-DDTHH:MM:SS), weekday ("mon".."sun"), epoch (seconds, local time read as UTC)} and a seq number. The first event of a scenario also carries fresh: true (a new Home Assistant; kv is empty).',
    state_changed: `{type:"state_changed", entity_id:"${SPEC.ids.group}", old_state, new_state}  (only for the garage group)`,
    event: `{type:"event", event_type:"${SPEC.ids.snoozeEvent}", data:{action}}  (a button pressed on a phone notification; ANY app's notification, not only yours)`,
    wake: '{type:"wake", id}  (a wake-up you scheduled with sched.set)',
  },
  calls: {
    'ha.get_state': { args: '{entity_id}', ok: '200 {entity_id, state, attributes, last_changed}; 404 unknown entity. Readable: the two covers, the group, the snooze timer ("idle" | "active"), group.family.' },
    'ha.call_service': { args: '{service, target?, data?}', ok: '200 {}; 404 SERVICE_NOT_FOUND; 400 INVALID_DATA; 500 SERVICE_FAILED (the service raised an error). The services are listed in config.services.' },
    'sched.set': { args: '{id, afterSeconds}', ok: '200 {id, at}. You get a wake event with that id afterSeconds of virtual time later (fractions allowed). Setting an id that is pending replaces it.' },
    'sched.cancel': { args: '{id}', ok: '200 {cancelled: boolean}' },
    'kv.get': { args: '{key}', ok: '200 {value, version}; 404' },
    'kv.put': { args: '{key, value, ifVersion?}', ok: '200 {version}; 409 if ifVersion does not match (compare-and-swap). Durable between the events of one scenario.' },
    done: { args: '(none)', ok: 'ends the current event; the next one is delivered' },
  },
};

export const PROTOCOL = `How your solution is run.
The environment plays a series of scenarios, each against a fresh mock Home Assistant on a virtual clock. In each, people open and close the garage
doors and press buttons on Carlo's phone, and the clock moves on; you hear about it ONE EVENT AT A TIME, in time order, until the scenario ends.
You never see which scenario it is, who caused a change, or what is expected. Your solution is the same for every scenario: you decide from the
events, the clock in event.at, what you read with ha.get_state, and what you remembered.
- A run is one event. Calls take no virtual time. There is no sleeping: to do something later, call sched.set and handle the wake event.
  In-memory state in your handler is fine (the factory is called again for each scenario); kv is there if your design wants durable state.
- Things that happen in the world at an instant are delivered before your own wake-ups scheduled for that same instant.
- What is judged: the successful service calls, in the world's mock Home Assistant, against what the job requires: which service, which data
  (text compared with whitespace collapsed; icons and other cosmetics ignored), and WHEN: every call within +-${SPEC.toleranceSeconds} s of its nominal time. Calls at the same
  instant may come in any order. A missing call, an extra call or a call outside the window fails that scenario. Failed calls (status >= 400) have no effect and are not judged.
- Limits: at most ${LIMITS.callsPerRun} calls per event, ${LIMITS.runsPerScenario} events per scenario (polling every second through a two hour wait is not an option).
- Write handler.mjs exporting: export default function createHandler() { return async (event, api) => { ... } }
  api.ha.get_state({entity_id}), api.ha.call_service({service, target, data}), api.sched.set({id, afterSeconds}), api.sched.cancel({id}),
  api.kv.get({key}), api.kv.put({key, value, ifVersion}); each returns {status, body}.`;

export const SKELETON = `// Solution skeleton. createHandler() is called again at the start of every scenario (the first event has event.fresh === true).
export default function createHandler() {
  return async function handler(event, api) {
    // event.type: 'state_changed' | 'event' | 'wake'
    // api.ha.call_service({ service: 'timer.start', target: { entity_id: 'timer.garbage_reminder_snooze' }, data: { duration: '00:30:00' } })
  };
}
`;

export const TASK_TEXT = {
  T1: `TRANSLATE. original/garbage_day_garage.yaml is a Home Assistant automation that its author built and used (MIT licence, LICENSE next to it).
Produce a solution that does what it does: the same service calls with the same data at the same moments, in every situation the automation
handles, including the situations its conditions, its restart mode and its snooze buttons exist for. You are not asked to run YAML; you are asked to
reproduce its behaviour on the protocol below. The Home Assistant semantics it relies on are written down in inputs.haSemantics. The services it
calls are described in inputs.config.services. A hidden battery of scripted situations judges the result.`,
  T2: `REBUILD FROM INTENT. Build the garbage-day reminder described in inputs.description. You get no existing implementation, only the description,
the owner's environment (inputs.config, inputs.api) and worked examples (inputs.examples) from a different, smaller data set that show what happens
for a few situations: the events the integration received and the service calls the owner's setup made. A hidden battery of scripted situations
judges the result.`,
  T3: `IMPROVE. original/garbage_day_garage.yaml is the author's working automation. Build a solution that does the same job in the same situations
(same calls, same data, same moments within +-${SPEC.toleranceSeconds} s) and is also MORE RELIABLE and NO MORE EXPENSIVE:
- Reliability: a service call can fail (status >= 400: the phone push, the inside speech or an Alexa announcement). A failed call is neither retried
  nor allowed to end the sequence: everything else the reminder was going to do still happens on schedule. (The original stops at the first failed action.)
- Cost: the load you put on the scheduler and on Home Assistant (sched.set, sched.cancel, ha.get_state and your own wake-ups, summed over the ordinary scenarios; kv is not counted)
  must stay within budget.selfInflictedWork. Polling is far over it.
- Latency: every call within +-${SPEC.toleranceSeconds} s of its nominal time, as in the original.
The Home Assistant semantics the original relies on are in inputs.haSemantics. A hidden battery judges ordinary situations and failure situations.`,
};

export function costBudget() { return T3_COST.cap; }
export const CONFIG_VIEW = () => ({ entities: CONFIG.entities, timer: CONFIG.timer, subscribe: CONFIG.subscribe, services: CONFIG.services, note: CONFIG.note });
