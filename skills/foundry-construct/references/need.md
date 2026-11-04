# Does this task need a workflow?

Modes: **none** (answer directly or one agent), **checklist** (a short plan the agent follows), **workflow** (typed,
verified, run once), **recurring** (a workflow that runs on a schedule or trigger).

Signals for a workflow: it recurs; it waits on time, events or people; it makes irreversible or external effects; it
spans several systems or actors; it is too large for one context; it must be exact, auditable or repeatable; another
program will reuse it. Signals against: a one-off question, exploratory coding, a single small edit, anything where
the best workflow is one call.

How to decide: ask a cheap model with this rubric and the request; use keyword features only to skip obvious
"none" cases for free. Evidence (dev, our own labels): keyword rules 9/132 false triggers and 0.67 recall on held-out
requests; a cheap model asked directly 5/132 and 0.97, all of its errors on requests already marked ambiguous
(branch `worktree-wf_0f86d12b-ab5-1`). When the answer is "none", say so: an unnecessary workflow is a cost, not
a safety margin.
