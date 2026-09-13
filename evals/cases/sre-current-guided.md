# Current SRE campaign construction task

Read `original-task.md` and implement that unchanged three-boolean routing and
recovery contract. Use this campaign's current IR and capability catalog.
Produce a fresh version-1 candidate in `/task/output.json`; it will run in a new
empty evaluation store. This also applies to later diagnostic repair rounds.

You may read the supplied current workflow construction and domain-sre skills.
Their production guidance must not invent telemetry, authorities or capabilities
that this synthetic task does not expose. Preserve unsupported or missing facts.
The catalog states whether this condition has extra host-owned evidence gates.
All original task requirements apply in either condition.

If `feedback.json` and `prior-candidate.json` are supplied, use the recorded
failures to repair your own candidate. A null prior means no previous candidate
was generated. Those observations are diagnostic assistance and not tests you
performed. Do not claim new execution, model quality or recovery before the
independent evaluator executes this candidate. Write the complete JSON using the
permitted file tool. No evaluator, shell or runtime tool is available in this turn.
