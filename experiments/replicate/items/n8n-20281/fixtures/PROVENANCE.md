# Provenance of the fixtures (R-bench item n8n:20281)

Every mail, person, company, domain, product detail, ticket and recorded model answer in this directory is **synthetic**: authored for this harness on 2026-10-08
(fictional company "Brightlane Systems", product "Ledgerline", customers such as "Corvane Logistics"; all domains end in `.example`). Nothing is copied from the original
template, from any real mailbox, or from any public data set.

| file | what it is | how it was made |
| --- | --- | --- |
| `../source/cases.mjs` | the authored source: 80 scored mails, 10 worked-example mails, 10 probe mails, the seeded Jira tickets, and for every mail its hidden label | written by hand (one author), labels together with the text |
| `emails.json` | the mails in the providers' native shapes (Gmail trigger item with `simple=false`, Microsoft Graph message); scored and probe mails; no labels | generated from the source by `../build-fixtures.mjs` |
| `labels.json` | **hidden** truth per mail (customer request, category, priority, expected route, ambiguity flag, follow-up link, model-failure flag) | generated from the source; never reaches a task, an event or a solver |
| `jira-seed.json` | the 15 tickets that exist before the stream (10 open ones that 10 follow-ups belong to, 2 Done ones, 3 unrelated) | generated from the source |
| `model-recordings.json` | the mock classifier's answers per mail and tier (`standard`, `small`), and which mails make the model call fail | generated from the source with explicit, hand-picked mistakes (`build-fixtures.mjs`: STD_CAT, STD_PRI, SMALL_*); a stand-in, not a measurement of any model |
| `example-mails.json` | the 10 worked-example mails shown to T2 solvers (a different mailbox) | generated from the source |
| `config.json` | the deployment presets (the author's "Workflow Configuration" values bound to the mock deployment) per difficulty | written by hand |
| `FREEZE.json` | sha256 of the source, config, mails, labels, seeds and recordings, the thresholds, and the hashes of the canonical tasks | `../freeze.mjs` |

The author's workflow is not redistributable (n8n self-serve terms; template 20281, sha256 `001466dc...a651e` of the gzip file at `/opt/corpus/n8n/workflows/20281.json.gz`).
It is read from the corpus at run time and verified against that hash; this repository holds no copy of its text. The task description given to solvers, the system prompt of the
faithful reference and the reply texts are our own paraphrases of the behaviour. The shape of the author's configuration keys (`internalDomains`, `minConfidence`, ...) and of the audit
sheet columns is functional interface and is kept so that the original definition runs against this deployment.

Licence of these fixtures: they are original works of this project (no third-party licence applies).

## Code derived from the original (not fixtures)

`controls/reference.mjs` is a transcription of the original's Code-node logic and shares about 30% of its 8-word text shingles with the original definition (measured on 2026-10-08 against the sha-pinned file; regexes, field
names, message layouts and rules are reproduced); `controls/improved.mjs` about 7%; `prompts.mjs`, the README and the oracle, emulator, environment, mocks and fixtures share almost none (<= 9 shingles, mostly the configuration key names).
The original is under the n8n self-serve terms and marked not redistributable in the corpus. The transcription is research code kept inside this project; publishing it needs clearance or a clean-room rewrite.
