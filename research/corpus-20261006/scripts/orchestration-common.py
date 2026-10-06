"""Shared helpers for the orchestration cluster converters (foundry-corpus-item/1).

Loaded by the per-platform converters with importlib (the file name follows the
scripts/<cluster>-*.py convention). Pure functions over already-parsed data; nothing here
executes or imports corpus content.

Feature definitions used for every platform in this cluster (also stated in the ledger):
  nodeCount/edgeCount  size of graph.nodes / graph.edges after normalisation
  maxFanOut            maximum out-degree over all edge kinds
  branching            condition-category nodes + nodes carrying a guard (when/if/rules/trigger
                       rule that depends on outcome); each is one runtime decision point
  loops                runtime iteration constructs: dynamic maps (expand, withItems/withParam,
                       matrix, ParallelFor, .map), sequential loops in flow code, recursion,
                       retry-until loops; loop back-edges are also emitted with kind "loop"
  async                distinct asynchronous mechanisms: schedule (cron/interval), webhook
                       (push/PR/HTTP), event (asset/dataset/signal/workflow_run), poll (sensor
                       polling), wait (timer, suspend, approval wait)
  humanSteps           nodes whose completion needs a person (approval, manual gate, HITL)
  effects              count of nodes per effects class (none is not counted)
  connectors           distinct external systems/services/actions named by node types
  hasCode              any node runs user code (script, shell, python callable, container)
  hasModelCalls        any node calls an ML/LLM model API
  subworkflows         nodes that call another workflow/pipeline/template-by-reference
"""
import json, re

SCHEMA = "foundry-corpus-item/1"
CATEGORIES = {"trigger", "action", "transform", "condition", "loop", "merge", "wait", "human",
              "model", "code", "subworkflow", "error-handler", "other"}
EFFECTS = {"none", "read", "write", "external"}
EDGE_KINDS = {"data", "control", "error", "loop"}
ASYNC = {"schedule", "webhook", "wait", "poll", "event"}

READ_VERBS = {"get", "list", "describe", "download", "read", "fetch", "search", "lookup", "check",
              "wait", "watch", "poll", "sense", "sensor", "head", "exists", "query", "scan", "show",
              "inspect", "retrieve", "find", "browse", "status", "monitor", "verify", "validate"}
WRITE_VERBS = {"create", "delete", "update", "put", "upload", "insert", "copy", "transfer", "load",
               "import", "export", "patch", "set", "add", "remove", "modify", "write", "sync",
               "truncate", "drop", "merge", "move", "rename", "save", "store", "append", "attach",
               "detach", "tag", "untag", "archive", "backup", "restore", "purge", "clear", "empty",
               "commit", "persist", "register", "unregister", "replace", "upsert", "ingest",
               "batch", "mutate", "grant", "revoke", "enable", "disable"}
EXTERNAL_VERBS = {"start", "stop", "run", "submit", "trigger", "execute", "deploy", "undeploy",
                  "publish", "send", "notify", "invoke", "call", "launch", "cancel", "pause",
                  "resume", "restart", "reboot", "train", "predict", "scale", "apply", "release",
                  "build", "push", "post", "email", "message", "page", "alert", "dispatch",
                  "provision", "terminate", "destroy", "promote", "rollout", "rollback", "tune"}


def split_words(name):
    """CamelCase / snake / kebab -> lower-case words."""
    name = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", name)
    name = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", name)
    return [w.lower() for w in re.split(r"[^A-Za-z0-9]+", name) if w]


def effects_from_name(name, default="external"):
    words = split_words(name)
    # first matching verb wins (operator names put the verb after the service prefix)
    for w in words:
        if w in EXTERNAL_VERBS:
            return "external"
        if w in WRITE_VERBS:
            return "write"
        if w in READ_VERBS:
            return "read"
    if "to" in words[1:-1]:  # transfer operators: XToYOperator
        return "write"
    return default


DOMAIN_RULES = [
    ("genai", r"openai|cohere|bedrock|anthropic|llm|gen_?ai|generative|gemini|embedding|vector|pinecone|weaviate|qdrant|pgvector|langchain|rag\b|chat|prompt"),
    ("ml", r"sagemaker|vertex|automl|mlengine|ml_?engine|kfp|kubeflow|training|train\b|model|tensorflow|pytorch|torch|sklearn|xgboost|mlflow|hyperparam|katib|inference|feature.?store"),
    ("data-engineering", r"bigquery|redshift|snowflake|spark|dataproc|dataflow|hive|athena|glue|emr|databricks|dbt|sql|postgres|mysql|mssql|oracle|trino|presto|teradata|druid|pinot|etl|warehouse|lake|parquet|csv|s3|gcs|blob|bucket|adls|hdfs|iceberg|delta"),
    ("streaming", r"kafka|pubsub|kinesis|eventhub|event.?bridge|sqs|sns|stream"),
    ("cloud-infra", r"kubernetes|k8s|\beks\b|\bgke\b|\baks\b|ec2|compute|cloud.?run|terraform|helm|instance|cluster|vm\b|container|docker|ecs|lambda|functions?\b"),
    ("ci-cd", r"\bci\b|\bcd\b|\bbuild\b|unit.?tests?\b|\blint|release|deploy|publish|docker|coverage|pipelinerun|tekton|github|gitlab"),
    ("notifications", r"slack|email|smtp|teams|discord|telegram|pagerduty|opsgenie|sendgrid|webhook"),
    ("data-quality", r"data.?quality|great.?expectations|asset.?check|sql.?check|column.?check|table.?check|soda\b|deequ|data.?validat"),
    ("security", r"codeql|scan|sast|dast|security|vulnerab|sbom|sign|cosign|trivy|snyk"),
]


def domains_for(text, base=()):
    # drop corpus-layout tokens that would otherwise look like domain words
    t = re.sub(r"tests?/system|test_data|sdk_compiled_pipelines|actions/checkout", " ", text.lower())
    out = list(base)
    for dom, rx in DOMAIN_RULES:
        if dom not in out and re.search(rx, t):
            out.append(dom)
    return out


def trim(s, n=200):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return s if len(s) <= n else s[: n - 1] + "…"


SECRETISH = re.compile(r"(?i)(password|passwd|secret|token|api[_-]?key|private[_-]?key|credential)s?\s*[:=]\s*\S+")


EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")


def scrub(s, n=200):
    """Short summary text with inline secret assignments and e-mail addresses masked."""
    s = EMAIL.sub("<email>", str(s or ""))
    return trim(SECRETISH.sub(lambda m: m.group(1) + "=<redacted>", s), n)


def dedupe_edges(edges):
    rank = {"error": 3, "loop": 2, "data": 1, "control": 0}
    best = {}
    order = []
    for e in edges:
        k = (e["from"], e["to"])
        if e["from"] == e["to"] and e["kind"] != "loop":
            continue
        if k not in best:
            order.append(k)
            best[k] = e
        elif rank[e["kind"]] > rank[best[k]["kind"]]:
            best[k] = e
    return [best[k] for k in order]


def compute_features(nodes, edges, *, guards=0, loops=0, async_kinds=(), connectors=(),
                     domains=(), extra_subworkflows=0):
    out = {}
    for e in edges:
        out[e["from"]] = out.get(e["from"], 0) + 1
    eff = {"read": 0, "write": 0, "external": 0}
    for n in nodes:
        if n["effects"] in eff:
            eff[n["effects"]] += 1
    cats = [n["category"] for n in nodes]
    asy = sorted(set(a for a in async_kinds if a in ASYNC))
    return {
        "nodeCount": len(nodes),
        "edgeCount": len(edges),
        "maxFanOut": max(out.values()) if out else 0,
        "branching": cats.count("condition") + guards,
        "loops": loops,
        "async": asy,
        "humanSteps": cats.count("human"),
        "effects": eff,
        "connectors": sorted(set(c for c in connectors if c)),
        "hasCode": "code" in cats,
        "hasModelCalls": "model" in cats,
        "subworkflows": cats.count("subworkflow") + extra_subworkflows,
        "domains": list(dict.fromkeys(domains)),
    }


def ir_verdict(features, *, needs=(), unsupported=None, notes=""):
    """needs: extension names this item requires beyond the Phase 1 IR.
    Phase 1 IR natively has task, assert, human, map, loop, wait (timer), agent, code, verify,
    per-node `when` guards, retry, onError stop|continue and all_success/all_resolved joins."""
    if unsupported:
        return {"verdict": f"unsupported:{unsupported}", "notes": trim(notes, 600)}
    ext = list(dict.fromkeys(needs))
    if not ext:
        return {"verdict": "native", "notes": trim(notes, 600)}
    return {"verdict": "via-extension:" + ",".join(ext), "notes": trim(notes, 600)}


def make_item(*, platform, sid, url, revision, retrieved, license, license_evidence,
              redistributable, raw_path, title, description, desc_provenance, nodes, edges,
              features, ir, oracle):
    for n in nodes:
        assert n["category"] in CATEGORIES, n
        assert n["effects"] in EFFECTS, n
        n["summary"] = scrub(n.get("summary", ""))
    ids = {n["id"] for n in nodes}
    for e in edges:
        assert e["kind"] in EDGE_KINDS, e
        assert e["from"] in ids and e["to"] in ids, (sid, e)
    item = {
        "schema": SCHEMA,
        "id": f"{platform}:{sid}",
        "source": {
            "platform": platform, "url": url, "revision": revision, "retrievedAt": retrieved,
            "license": license, "licenseEvidence": license_evidence,
            "redistributable": bool(redistributable), "rawPath": raw_path,
        },
        "title": scrub(title, 200),
        "description": {"text": scrub(description, 600) if redistributable else "",
                        "provenance": desc_provenance if (redistributable and description) else "written"},
        "graph": {"nodes": nodes, "edges": edges},
        "features": features,
        "ir": ir,
        "oracle": oracle,
    }
    if not redistributable:
        # licence unknown/ToS/copyleft: keep URL + normalised graph features only, no verbatim text
        item["title"] = trim(sid, 200)
        item["description"] = {"text": "", "provenance": "written"}
        for n in nodes:
            n["summary"] = trim(n["type"], 80)
    return item


def complexity(item):
    f = item["features"]
    return (f["nodeCount"] + f["edgeCount"] * 0.5 + f["branching"] * 3 + f["loops"] * 3
            + len(f["async"]) * 2 + f["humanSteps"] * 4 + len(f["connectors"]) * 1.5
            + f["subworkflows"] * 2 + (3 if f["hasModelCalls"] else 0)
            + f["effects"]["write"] * 0.5 + f["effects"]["external"] * 0.5)


def write_jsonl(path, items):
    with open(path, "w") as fh:
        for it in items:
            fh.write(json.dumps(it, sort_keys=False, ensure_ascii=False) + "\n")


# ------------------------------------------------------------------ licence text heuristics --
PERMISSIVE = {"MIT", "Apache-2.0", "BSD-3-Clause", "BSD-2-Clause", "ISC", "Unlicense", "CC0-1.0",
              "0BSD", "Zlib", "BSL-1.0", "MPL-2.0", "CC-BY-4.0", "BSD-3-Clause-Clear", "PSF-2.0",
              "MIT-0", "Artistic-2.0", "WTFPL", "UPL-1.0"}


def classify_license_text(txt):
    """Best-effort SPDX id from a licence file's text. Returns 'unknown' when unsure."""
    if not txt:
        return "unknown"
    t = re.sub(r"\s+", " ", txt[:6000]).lower()
    if "gnu affero general public license" in t:
        return "AGPL-3.0"
    if "gnu lesser general public license" in t or "gnu library general public license" in t:
        return "LGPL-3.0" if "version 3" in t else "LGPL-2.1"
    if "gnu general public license" in t:
        return "GPL-3.0" if "version 3" in t else ("GPL-2.0" if "version 2" in t else "GPL")
    if "mozilla public license" in t and "2.0" in t:
        return "MPL-2.0"
    if "apache license" in t and ("version 2.0" in t or "2.0" in t[:400]):
        return "Apache-2.0"
    if "eclipse public license" in t:
        return "EPL-2.0" if "2.0" in t else "EPL-1.0"
    if "permission is hereby granted, free of charge" in t:
        return "MIT-0" if "without restriction" in t and "the above copyright notice" not in t else "MIT"
    if "this is free and unencumbered software released into the public domain" in t:
        return "Unlicense"
    if "creative commons legal code" in t and "cc0" in t or "cc0 1.0 universal" in t:
        return "CC0-1.0"
    if "redistribution and use in source and binary forms" in t:
        if "neither the name" in t or "names of its contributors" in t or "name of the copyright holder" in t:
            return "BSD-3-Clause"
        return "BSD-2-Clause"
    if "permission to use, copy, modify, and/or distribute this software for any purpose" in t or \
       "permission to use, copy, modify, and distribute this software for any purpose" in t:
        return "ISC"
    if "boost software license" in t:
        return "BSL-1.0"
    if "this software is provided 'as-is'" in t and "altered source versions" in t:
        return "Zlib"
    if "do what the fuck you want" in t:
        return "WTFPL"
    if "attribution 4.0 international" in t:
        return "CC-BY-4.0"
    if "business source license" in t:
        return "BUSL-1.1"
    if "elastic license" in t:
        return "Elastic-2.0"
    if "server side public license" in t:
        return "SSPL-1.0"
    return "unknown"


def redistributable_license(spdx):
    """Policy for this corpus: commit normalised graphs (with short summaries/descriptions) only
    for permissive licences; copyleft, source-available and unknown licences keep URL + graph
    features only (no verbatim text)."""
    return spdx in PERMISSIVE
