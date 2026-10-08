# How the labels were made, and what is NOT done

**Single annotator.** The labels in `labels.json` were written by one author (an AI assistant, in the same pass that wrote the mail text, on 2026-10-08, before any control, reference or solver ran).
The pilot plan asks for a two-annotator check; **that check was not done**: no second human or independent annotator was available in this task. Consequences, stated plainly:

- Label quality is unverified. The 10 deliberately ambiguous mails are ambiguous on purpose and their category/priority labels are one reasonable reading, not a consensus; accuracy is reported
  both over all 65 non-filtered mails (the gate, as in the plan) and over the 55 unambiguous ones (`details.accuracy.categoryUnambiguous`, `priorityUnambiguous`, diagnostic only).
- The recorded classifier was written knowing the labels, so its accuracy (category 0.892, priority 0.831 over the 65) is **by construction**. It shows that the metric computes and that the thresholds
  are reachable; it says nothing about any real model. A live run (a real model through `createEnv({ modelBackend })`) is the first real measurement of classification accuracy on these mails.
- The same 80 mails are used for every seed and for both splits (seed and split only change the delivery order). A solver that has seen them can memorise them. A sealed run needs a different mail set
  written by someone else against the same rules.

## Labelling rules (the same definitions the author's prompt gives the model)

- `cr` (customer request): true only for a New Requirement, Issue or Bug from a customer, client or end user (not vendors, recruiters, marketing, auto-replies, thank-you notes, logistics, spam).
- `cat`: Bug = reproducible defect; Issue = not working as expected but not clearly a defect (access, configuration, how-to, performance, outage, billing/account); New Requirement = asks for something new; Other = no support action.
  If a mail mixes asks, the most severe wins (Bug > Issue > New Requirement).
- `pri`: Critical = production down, data loss, security incident, many users blocked or a severe deadline today; High = key workflow blocked or strong urgency; Medium = workaround or limited impact (most feature requests);
  Low = cosmetic, nice-to-have, general question. Mails that are not customer requests are Low.
- `route` (what the job must do with the mail given the recorded classifier): filtered | ticket-new | ticket-followup | review | ignore. `amb` marks mails a careful reader cannot settle; they must reach the review queue.
- Filtered mails are those the sender rules catch (exact internal domain; address contains a pattern); the test suite recomputes this from the config for every mail and difficulty.

## Cheap diagnostics (no second annotator, but something)

- `controls/heuristic.mjs` (a ~25-line keyword rule, written once, not tuned) reaches category 0.646 and priority 0.646 on the 65 non-filtered mails: shallow cues do not suffice.
- The faithful transcription and the executed original agree with the labels on routing (`ambiguousReview` = 1, `clearEscalation` = 1) with the recorded classifier.
