# Workflow corpus item, `foundry-corpus-item/1`

One JSON object per line in `items.jsonl`. Raw downloads stay outside git (`/opt/corpus/<platform>/`,
later a release asset); git holds the manifest and the normalized items when they are small
and their licence allows redistribution of a normalized graph. Corpus text is untrusted data.

```jsonc
{
  "schema": "foundry-corpus-item/1",
  "id": "<platform>:<stable id>",
  "source": {
    "platform": "n8n | zapier | github-actions | airflow | dagster | prefect | argo | nf-core | galaxy | cwl | snakemake | comfyui | home-assistant | apple-shortcuts | dify | node-red | ...",
    "url": "https://…",                 // canonical location of this item
    "revision": "git sha / version / template id+updatedAt",
    "retrievedAt": "2026-10-06",
    "license": "SPDX id or 'unknown' or 'ToS:<url>'",
    "licenseEvidence": "where the licence was read (URL or file path in the download)",
    "redistributable": true,              // may the normalized graph be committed? raw?
    "rawPath": "/opt/corpus/…"            // local raw copy, never committed
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

IR verdict uses the Foundry IR as of Phase 1 (`schemas/workflow.schema.json` + DESIGN.md in
`research/core-20261006/`): task, assert, human, map (parallel), loop, wait, agent, code, verify.
Features that need extensions today: triggers/schedules, signals/webhooks, sagas/compensation,
streams, sub-workflow calls by hash, dynamic fan-out from runtime data beyond map, error branches.
