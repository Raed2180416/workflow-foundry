# Workflow corpus item, `foundry-corpus-item/1`

One JSON object per line in `items.jsonl`. Raw downloads stay outside git (`/opt/corpus/<platform>/`,
later a release asset); git holds the manifest and the normalized items when they are small
and their licence allows redistribution of a normalized graph. Corpus text is untrusted data.

```jsonc
{
  "schema": "foundry-corpus-item/1",
  "id": "<platform>:<stable id>",       // no whitespace; a path inside it is percent-encoded like source.url
  "source": {
    "platform": "n8n | zapier | github-actions | airflow | dagster | prefect | argo | nf-core | galaxy | cwl | snakemake | comfyui | home-assistant | apple-shortcuts | dify | node-red | langgraph | crewai | ... | claude-code-workflows",
    "url": "https://…",                 // canonical location of this item; first-party platforms only: "local:<relative path>"
    "revision": "git sha / version / template id+updatedAt",
    "retrievedAt": "2026-10-06",
    "license": "SPDX id or 'unknown' or 'ToS:<url>'",
    "licenseEvidence": "where the licence was read (URL or file path in the download)",
    "redistributable": true,              // may the normalized graph be committed? raw?
    "rawPath": "/opt/corpus/…",           // local raw copy, never committed
    "extraction": {                       // optional provenance of a model-read item (the agentic cluster has it on every item)
      "method": "model-read-source",      // lower-case slug
      "spans": ["<path>:L<a>-L<b>", "…"], // 1..200 distinct source spans that were read, each <path>:L<a>[-L<b>]
      "extractor": "<model or tool id>",
      "verifier": "<the independent verification pass and where it is recorded>"   // optional
    }
  },
  "title": "…",
  "description": { "text": "…", "provenance": "original | recovered-by-model | written" },
  "graph": {
    "nodes": [{ "id": "…", "type": "<platform node type>", "category": "trigger|action|transform|condition|loop|merge|wait|human|model|code|subworkflow|error-handler|other",
                "effects": "none|read|write|external", "summary": "≤200 chars, no secrets" }],
    "edges": [{ "from": "…", "to": "…", "kind": "data|control|error|loop" }]
  },
  "features": { "nodeCount": 0, "edgeCount": 0, "maxFanOut": 0, "branching": 0, "loops": 0,
                "async": ["schedule|webhook|wait|poll|event"], "humanSteps": 0,
                "effects": { "read": 0, "write": 0, "external": 0 }, "connectors": [], "hasCode": false,
                "hasModelCalls": false, "subworkflows": 0, "domains": [] },
  "ir": { "verdict": "native | via-extension:<feature> | unsupported:<reason>", "notes": "…" },
  "oracle": { "kind": "none | mocked-execution | test-profile | output-equivalence", "notes": "…" }
}
```

Conventions beyond the shape above (enforced by `scripts/check-items.mjs` unless noted):

- **Encoding.** `source.url` is percent-encoded (RFC 3986; a space is `%20`) and so is any path inside an `id`
  (e.g. `crewai:crewAI-examples/notebooks/Coding%20Assistant/…`); `rawPath` and the paths in `source.extraction.spans`
  are literal local paths (`notebooks/Coding Assistant/…:L129-L144`), never percent-encoded. The checker rejects
  whitespace in the URL and the id, a `%` in an id that does not start an encoded octet, and an encoded octet in a span path; `merge-items.mjs` encodes unsafe
  URL characters; `agentic-assemble.mjs` also checks that the percent-decoded path of a pinned GitHub URL is the tail of
  `rawPath`.
- **`source.extraction`** is optional; when present it has exactly the keys above (other keys are rejected).
- **No secrets.** Every string of an item, notes included, is scanned for credential-shaped strings (API keys and tokens,
  private keys, JWTs) and incoming-webhook URLs whose path is the secret (Slack, Discord, Teams, Telegram bot); a hit
  invalidates the item. `agentic-assemble.mjs` applies the same scan to the platform ledgers and the harmonisation log.
- **First-party items.** Platforms listed in `FIRST_PARTY_PLATFORMS` (today `claude-code-workflows`: workflow scripts
  written by this project's own agent) are the only ones that may use a `local:<relative path>` URL, since their
  sources have no public location. They are not independent evidence and reports keep them apart from third-party
  items.
- **Verdict vocabulary** (`--canonical`): `via-extension` tokens are ids of the construct registry `CONSTRUCTS` in
  registry order: the 19 original constructs, then 12 agentic ones (`AGENTIC-CONVENTIONS.md` §3). A verdict
  `unsupported:by-design-<refusal>[+<refusal>]` (refusals `group-chat`, `full-history-handoff`) marks an owner design
  refusal, which is representable but refused; its notes must hold `Needs: a, b.` (registry ids, registry order) or
  "No further construct would be needed". Any other `unsupported:<reason>` means not expressible.

IR verdict uses the Foundry IR as of Phase 1 (`schemas/workflow.schema.json` + DESIGN.md in
`research/core-20261006/`): task, assert, human, map (parallel), loop, wait, agent, code, verify.
Features that need extensions today: triggers/schedules, signals/webhooks, sagas/compensation,
streams, sub-workflow calls by hash, dynamic fan-out from runtime data beyond map, error branches.
