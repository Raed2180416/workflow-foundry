# R-bench item: Garage Garbage Day Reminders (Home Assistant, CCOSTAN)

`home-assistant:CCOSTAN/Home-AssistantConfig/config/automation/Speech/garbage_day_garage.yaml#0`, pilot P4 in
`research/replicate-20261008/SELECTION.md`. Harness built 2026-10-08. **Status: development/diagnostic harness. Nothing here is a sealed
evaluation, and no solver arm has been run on it.** The scenarios, expected traces and the oracle were all written by the same agent
(the freeze in `fixtures/frozen.json` only stops accidental drift); a sealed run needs a battery written by someone else.

Evidence status, up front: **the original was executed on an interpreter for the YAML subset it uses (`controls/original-engine.mjs`), not on
Home Assistant.** Home Assistant core is not installed in this container (`ModuleNotFoundError: No module named 'homeassistant'`) and installing
it is a dependency decision left to the owner (COVERAGE/SELECTION estimate the real-HA control at about 6 h with
`pytest-homeassistant-custom-component`). Every Home Assistant behaviour below is "as documented / as recalled", never "observed".

## The job, in the author's terms

Carlo Costanzo's reminder for taking the cans out. Garbage goes out on Wednesday (recycling and regular) and Sunday. When a garage door (two covers,
summarised by `group.garage_doors`) is opened on one of those days and **stays open for 20 seconds** (a debounce against a noisy sensor), the house:

1. pushes a notification to Carlo's phone with two buttons, *Snooze 30m* and *Snooze 2h* (`script.notify_engine_two_button`, group `Garbage_Reminders`,
   stable tag `garbage_day_reminder`) and speaks once inside (`script.speech_engine`), both at the same instant, the **reminder start**;
2. announces the same message on the garage Alexa (`notify.alexa_media_garage`, `announce`) at **+30 s, +90 s and +180 s**; before each one it checks again
   that the door group is still open, it is still Wednesday or Sunday and the shared snooze timer is idle, and if any check fails **the whole sequence ends**;
3. on a snooze button (a `mobile_app_notification_action` event) starts `timer.garbage_reminder_snooze` for 30 minutes or 2 hours, writes a logbook entry
   and, because the automation is `mode: restart`, kills any announcements still waiting. A running snooze timer also stops new reminders from starting.

The message is "Reminder: it's garbage day." + (Wednesday only) "Both recycling and regular garbage go out today." + "Please take the cans to the curb before you leave."

It is a deterministic job: a ~100-line script solves it (`controls/reference.mjs` is that script). It measures replication fidelity (timing, restart/stop
semantics, debounce, human-step events), **not model judgement**; per SELECTION section 6.3 report it separately from judgement-bearing items.
The original has no model calls.

## What the solver gets

| variant | gets | does not get |
| --- | --- | --- |
| **T1 translate** | `original/garbage_day_garage.yaml` (MIT, `LICENSE` beside it), the Home Assistant semantics it relies on (`inputs.haSemantics`), the environment config and the call API | the description, the examples |
| **T2 rebuild from intent** | `inputs.description` (the job as above, with the exact texts), the environment config and API, 4 worked examples from a **different data set** (events received, calls made, local times) | the original definition, the semantics note |
| **T3 improve** | the original, the semantics, config, API and a target: same effects within +-1 s, **a failed service call must not end the sequence** (the original stops at the first failed action), and `budget.selfInflictedWork` (the original's cost x 1.25) | the description, the examples |

A solution is a factory `export default function createHandler() { return async (event, api) => {...} }` (skeleton in `task.files['handler.mjs']`), called again for each scenario.
Foundry has no triggers: as in SELECTION 6.5 each trigger event is one run, waits are scheduled wake-ups (`sched.set`), the clock is virtual and the human step (a button press)
comes from the scenario script. A Foundry arm needs an adapter from its runtime to this protocol (events to runs, durable waits to `sched.set`); none is provided here
(`src/` is frozen). The call names (`ha.get_state`, `ha.call_service`, `sched.set/cancel`, `kv.get/put`) are the port surface such an adapter would implement.

### Protocol (full text in `prompts.mjs`)

Events, one at a time, in time order: `state_changed` (only `group.garage_doors`), `event` (`mobile_app_notification_action`, any app's), `wake` (the solver's own). Every event carries
`at: {iso, weekday, epoch}`; the first of a scenario has `fresh: true`. Calls take no virtual time and return `{status, body}`; at an instant the world acts before the solver's wake-ups.
Limits: 40 calls per event, 5000 events per scenario. The environment never says which scenario it is, who caused a change, or what is expected.

## What the oracle judges (`oracle.mjs`, `trace.mjs`)

It replays the episode record `{actions}` in a fresh environment and compares the **successful service calls the mock recorded** with the trace each scenario expects:
same service, same effect-relevant data, **every call within +-1 s** of its nominal instant, nothing missing, nothing extra. Not judged: how the solution is built, the order of calls at the
same instant, icons and other cosmetics, the solver's own action ids (the mock phone resolves a button *title* to whatever action id the solver's push declared), failed calls (status >= 400).
Text is compared with whitespace collapsed; `level` defaults to `active`; a missing `timer.start` duration is the timer's configured 30 minutes; durations compare in seconds
(`0:30:00`, `00:30:00`, `1800`, `{minutes: 30}` are one thing). Seeds move the day and time of day, opening times and margins; `difficulty` d adds d-1 notification actions from other apps at random
instants (they must change nothing). Expected traces are written next to each scenario in `scenarios.mjs`, as functions of that scenario's own timings.

### Scenarios (15 core, judged for T1/T2/T3; 4 probes, T3 only)

| # | id | what happens | expected calls |
| --- | --- | --- | --- |
| 1 | `mon-open` | Monday: the door opens and stays open; it is not a garbage day. | 0 |
| 2 | `wed-flap` | Wednesday: the door flaps open for 10-15 s three times; it never stays open for 20 s. | 0 |
| 3 | `wed-full` | Wednesday: the door opens and stays open. Push and speech, then three announcements. | 5 |
| 4 | `sun-full` | Sunday: the same, and the message does not mention recycling. | 5 |
| 5 | `wed-stop-then-reopen` | Wednesday: closed at the second check so the run ends; it reopens before the third check would have been due and a new reminder starts 20 s later. | 8 |
| 6 | `wed-close-before-first` | Wednesday: the door closes 8-20 s after the reminder started. | 2 |
| 7 | `wed-snooze30-then-expiry` | Wednesday: Snooze 30m between the 1st and 2nd announcement; a reopening inside the half hour is ignored; one after the snooze ran out starts a new reminder. | 10 |
| 8 | `sun-snooze2h` | Sunday: Snooze 2h between the 2nd and 3rd announcement; a reopening about an hour later is ignored; one after two hours reminds again. | 11 |
| 9 | `wed-snooze-after-run-ended` | Wednesday: the run is over when Snooze 30m is tapped on the old notification; the snooze must still be recorded and a reopening is ignored. | 4 |
| 10 | `wed-external-snooze` | Wednesday: another automation starts the shared timer mid-sequence; the next check sees it and the run ends. | 3 |
| 11 | `wed-midnight-ends-sequence` | Wednesday evening: midnight falls between the 1st and 2nd announcement. | 3 |
| 12 | `tue-midnight-starts-wed` | Tuesday night: the door opens before midnight, the debounce ends after it; the day is judged at the reminder start (Wednesday message). | 5 |
| 13 | `wed-reopen-restarts-run` | Wednesday: closed for 1-2 s and reopened while the first run waits; the new reminder replaces it (restart mode). | 7 |
| 14 | `wed-foreign-phone-action` | Wednesday: other apps' notification actions (one named `SNOOZE_GARBAGE_REMINDERS_1H`) change nothing. | 5 |
| 15 | `wed-two-doors` | Wednesday: the second door opens and the first closes; the group stays open at every check. | 5 |
| P1 | `p1-speech-outage` | the inside speech call fails; push and all announcements still happen. | 4 |
| P2 | `p2-first-announcement-outage` | the first Alexa announcement fails; the other two still happen. | 4 |
| P3 | `p3-push-outage` | the phone push fails; speech and announcements still happen. | 4 |
| P4 | `p4-alexa-down-then-up` | Alexa is down for the first two announcements, back for the third. | 3 |

Deviation from the SELECTION plan (14 scenarios): 15. Scenario 10 was added because no phone-snooze scenario can show whether a solution re-checks the *timer* inside the loop (a tap also kills the run);
only a timer started by something else can. The plan's "new open within 30 minutes suppressed" is in 7, "Sunday 2-hour snooze" in 8, "Wednesday message mentions recycling, Sunday does not" in 3/4.

T3 cost: self-inflicted work = `sched.set` + `sched.cancel` + `ha.get_state` + wake-ups delivered, over the 15 core scenarios; kv operations are not counted (so a stateless design is not penalised).
Cap 278 = ceil(1.25 x 222), where 222 is the original's maximum over seeds 0..19, difficulties 1..5, both splits. `improved` costs 184; a once-a-second poller 4384-4532.

## Controls (`controls/report.json`, regenerate with `node controls/run-controls.mjs`; 65 instances: dev seeds 0..19 x d1,3,5 + test seeds 0..4 x d3)

| control | result |
| --- | --- |
| **original** (the author's YAML on `original-engine.mjs`) | T2/T1 battery **65/65 pass**, 0 interpreter errors. T3: core 15/15 pass, the four probes fail on 65/65 (the original is the T3 baseline, not a failure) |
| `makeFaithful` (hand transcription) | T1 65/65, T2 65/65 |
| `makeImproved` | T3 65/65 (core + probes + cost 184 <= 278) |
| `alternative.mjs` (kv-only state, own ids, own wake ids, message split over value1/value2, numeric duration, async) | passes T2 and T3 (ordinary + probes + cost) on seeds 0..5 at d1,3,5 (in `item.test.mjs`); it is the evidence that the oracle does not judge construction |
| 9 mutants of the original YAML (drop `for`, drop the weekday / door / timer conditions, `mode: single`, delays as absolute offsets, recycling always, 2h = 30m, no logbook) | all rejected 65/65, each on the scenarios that expose it |
| 25 broken controls (`controls/broken.mjs`: empty, **do-nothing**, shuffled, delays-as-absolute, no debounce, weekday at door-open, skip-instead-of-stop, no restart, any/prefix action snoozes, wrong message, ...) | all rejected 65/65, each on its expected scenarios |
| T3-only: `abort-on-first-failure` (= the original's behaviour), `polling` (correct effects, 1 s poller) | both pass the ordinary battery 65/65 and fail T3 65/65 (probes, cost cap) |
| oracle / generate time | max 98 ms / 10 ms (contract limit 2 s) |

**Do-nothing** passes exactly the two "nothing should happen" scenarios (1, 2) and fails the other 13. `item.test.mjs` (35 tests, ~30 s, `node --test`) asserts all of the above on >= 20 seeds per control, plus determinism,
schema rejection, no hidden-truth leak (scenario ids, start times and expected traces are not in the task), timing margins (no door/phone event within 2 s of a scheduled wake-up), snapshot/restore, the mock's semantics,
tolerance edges (+0.9 s passes, +1.1 s fails), freeze hashes, and that the committed original is byte-identical to the pinned sha256 (and to `/opt/corpus` when present).

## Unknowns and limits (read before using a number from this item)

- **Not run on Home Assistant.** The interpreter implements the semantics in `inputs.haSemantics`. The oracle's expectations were written from the YAML and the documented behaviour, independently of the interpreter,
  and the two agreed on the first run (15/15), but both came from the same reading by the same agent.
- **The one assumption that matters most**: a false `condition` inside a `repeat` ends the **whole** run (recalled from Home Assistant's `script.py`, where `_ConditionFail` is re-raised out of sub-scripts; SELECTION states the same; the author's
  comment "Stop if the door closed, the day changed, or Carlo snoozed the alert" reads the same way). Not executed. `report.json: semanticSensitivity` and a test show that exactly one scenario (5, `wed-stop-then-reopen`) depends on it:
  under the alternative reading (only that iteration ends) the original would fail it on 65/65 instances.
- T3 probes P2 and P4 (Alexa) rest on "an action that raises ends the run unless `continue_on_error`" (documented). P1 and P3 additionally assume that an error inside a *called script* reaches the caller; not verified.
  The failure responses in `fixtures/recorded-responses.json` are synthetic.
- The helper scripts and the phone are mocks at the service-call boundary: `script.notify_engine_two_button` is a recorder that shows a push; its internals (templates, icon presets, `input_boolean.text_notifications`) are out of scope. The companion app's event carries only `{action}` here.
- No latency is modelled (calls take no virtual time), so the real-world drift of a blocking `script.speech_engine` / Alexa announce in the original is not measured. Timezone and DST are not modelled (naive local clock).
- Script-solvable by construction (see above). Task size is small (T2 inputs about 15 KB, prompt about 2 KB), below the contract's 6-15K-token aim for level 3.
- The T3 cost cap is calibrated on the original running on this protocol (in-memory interpreter). Whether "no more expensive than the original" is the right bar for a Foundry design is the owner's call.
- `experiments/lib/beds.mjs` loads only `beds/<id>/index.mjs`; this item needs a loader shim (SELECTION 6.2). Interactive arms in `b0-agent.mjs` would step the env with `{call, args}` actions; `output` is `{actions: [...]}` as `outputSchema` says.

## Reusing the mock (the four other Home Assistant items)

`mocks/ha-core.mjs` (re-exported at `experiments/replicate/mocks/home-assistant.mjs`) is item-agnostic: virtual local clock (`at`, `strftime`), entity state machine with a state-change outbox, service registry with a call recorder
(accepted and refused calls), outage windows, a time-ordered queue with world / internal / solver priorities, the timer helper integration (start, restart, expiry, cancel) and `dump`/`load`. `mocks/garage-world.mjs` shows how an item builds its world on it
(covers + group, phone, helper services). `controls/minijinja.mjs`, `miniyaml.mjs` and `original-engine.mjs` are the reusable parts of the YAML interpreter: triggers `state` (from/to/for) and `event`; actions `choose`, `variables`, `service`, `stop`, `condition`, `parallel` (no waits inside),
`repeat.for_each`, `delay`; conditions `trigger`, `time` (weekday), `state`, `template`, `and/or/not`; modes `restart` and `single`. Everything else throws `UnsupportedSemantics` / `TemplateUnsupported` / `YamlUnsupported` rather than being guessed.

## Files

`index.mjs` (contract surface: `generate`, `oracle`, `referenceSolve`, `badControls`, `createEnv`, plus `t3Controls`, `materialize`, `driveSync/drive/replay`), `spec.mjs` (frozen constants), `scenarios.mjs`, `trace.mjs`, `oracle.mjs`, `env.mjs`,
`prompts.mjs`, `examples.mjs`, `freeze.mjs`, `item.json`, `item.test.mjs`; `mocks/` (`ha-core.mjs`, `garage-world.mjs`); `fixtures/` (`config.json`, `recorded-responses.json`, `frozen.json`, `original/` = pinned MIT copy + `LICENSE` + PyYAML parse);
`controls/` (`original*.mjs`, `mini*.mjs`, `reference.mjs`, `alternative.mjs`, `broken.mjs`, `run-controls.mjs`, `report.json`, `parse-with-pyyaml.py`).

Commands: `node --test experiments/replicate/items/home-assistant-ccostan-garbage-day-garage/item.test.mjs` · `node .../controls/run-controls.mjs [--quick]` · `node .../freeze.mjs [--check]` (re-run and bump `VERSION` after any change to scenarios, trace or oracle).

Provenance of the committed original: URL and pinned revision in `item.json` (git `71ffa6120b8b649508c3ffe312f6d09792c7b37b`, retrieved 2026-10-06 into `/opt/corpus`, MIT, Copyright (c) 2018 Carlo Costanzo); sha256 of the YAML
`c7cae208c73ad49d929e18a43bc09b70760a44ec85f81c93118a31b194f0f62b`, of the LICENSE `e97616c691141d9e7c5e284299cba4e9ac13d02ff2c6b6c96e8039fdcf75248d`. The YAML is treated as data; nothing from it was installed or run as code.

## Obstacles met while building (verbatim where they were messages)

- Home Assistant is not installed: `ModuleNotFoundError: No module named 'homeassistant'` (python3 3.13.16 with PyYAML 6.0.1 is present). Not installed, by decision (see above). `node_modules` has no YAML or Jinja library, hence `miniyaml.mjs` / `minijinja.mjs`.
- Defects found in the harness itself while building (by scripts and by the tests), all fixed: `timer` was read from the wrong key of `config.json` (every timer read returned a nonexistent entity; the faithful reference then never started a reminder); `broken control snooze-ignored-by-sequence` was undetected on part of the instances because the door closed before the checks it was meant to skip
  (`PROBLEM snooze-ignored-by-sequence 0 65 {"sun-snooze2h":46,"wed-external-snooze":65,"wed-snooze30-then-expiry":53}`; fixed by keeping the door open through those checks); a first T3 cost metric counted kv operations and rejected a correct stateless design (412 > cap 278), so kv is no longer counted;
  five of my own test expectations were wrong (`8 !== 9`, `true !== false`, a factory passed where a thunk was expected, `no error recorded` for a condition key the interpreter does not validate, a poller whose episode exceeds the schema size cap).
- The working tree is shared: `git status` lists many modified files from other workers under `beds/`, `experiments/kev-data/` and sibling `experiments/replicate/items/*`; none were touched. Git state was not changed.
- Corpus tools: the corpus Home Assistant forum dump has nothing on the condition/restart semantics (the one text match, `forum/559732.yaml`, is a Frigate notification thread), so the key assumption above stays unverified.
