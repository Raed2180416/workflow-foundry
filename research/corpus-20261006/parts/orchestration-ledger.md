# Orchestration cluster: acquisition ledger (corpus-20261006)

Cluster scope: data/ML/CI orchestration (Airflow, Argo Workflows, Kubeflow Pipelines, Tekton, GitHub Actions, GitLab CI, Dagster, Prefect, Temporal). Items: `parts/orchestration.jsonl` (`foundry-corpus-item/1`). Raw downloads only under `/opt/corpus/<platform>/` (outside git). Converters and fetchers: `scripts/orchestration-*.{py,sh}` plus `scripts/orchestration-gitlab-projects.txt`. All corpus content was treated as data: Python DAG/flow code was parsed with `ast` and never imported or executed; YAML was parsed with PyYAML `safe_load` (GitLab custom tags such as `!reference` are kept as inert markers); Go was scanned with regexes; no install hooks were run.

Retrieved 2026-10-06. Status: **development/diagnostic corpus**, not sealed evaluation data. Total selected: **400** items (377 redistributable as normalised graphs).

## Reproduction

```sh
S=research/corpus-20261006/scripts; V=/opt/corpus/.venv-orch/bin/python   # uv venv, pyyaml==6.0.3
python3 -I $S/orchestration-fetch-pypi.py airflow apache-airflow-core apache-airflow==2.10.5 <101 provider names from apache-airflow extras>
#   then: tar x --wildcards '*example_dags/*.py' '*tests/system/*.py' LICENSE NOTICE PKG-INFO into /opt/corpus/airflow/extracted/<sdist>/
$S/orchestration-fetch-goproxy.sh argo github.com/argoproj/argo-workflows/v3 v3.7.18      # + kubeflow, tekton, temporal (see table)
python3 -I $S/orchestration-fetch-github.py dagster dagster-io/dagster examples '\.py$' HEAD 3000
python3 -I $S/orchestration-fetch-github.py prefect PrefectHQ/prefect examples '\.py$' ; ... PrefectHQ/prefect docs/v3 '\.mdx$'
LISTER=swh python3 -I $S/orchestration-fetch-github.py prefect PrefectHQ/prefect-recipes '' '\.py$'
python3 -I $S/orchestration-fetch-github.py temporal temporalio/samples-python '' '\.py$'
python3 -I $S/orchestration-gha-sample.py index && ... sample && ... fetch                   # Zenodo GHA histories
$V -I $S/orchestration-fetch-gitlab.py projects $S/orchestration-gitlab-projects.txt && $V -I $S/orchestration-fetch-gitlab.py templates
python3 -I $S/orchestration-airflow.py $W/airflow-candidates.json; $V -I $S/orchestration-argo.py ...; $V -I $S/orchestration-kfp-tekton.py kfp|tekton ...
$V -I $S/orchestration-gha.py ...; $V -I $S/orchestration-gitlab.py ...; python3 -I $S/orchestration-pycode.py dagster|prefect|temporal ...
python3 -I $S/orchestration-assemble.py && python3 -I $S/orchestration-ledger.py      # W=/opt/corpus/orchestration-work
```

Selection (seeded 20261006, `orchestration-assemble.py`): per platform a head ranked by complexity plus bonuses for human steps, model calls, error paths, loops, sub-workflows, event/wait async and the presence of an oracle (heads exclude graphs with <3 nodes; Airflow packages, Temporal sample families and GitLab templates-vs-projects are capped at 35% of a head), plus a uniformly random tail from the remainder for representativeness (GitHub Actions tail only from the uniform pool R). Non-selected converted candidates stay in `/opt/corpus/orchestration-work/*-candidates.json`.

## Per-platform outcome

| platform | units scanned | converted | conversion failures | selected (head+tail) | redistributable | licences (selected) | oracle kinds (selected) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| airflow | 669 | 760 | 3 | 90 (62+28) | 90 | Apache-2.0 90 | test-profile 70, none 20 |
| argo | 213 | 219 | 5 | 55 (38+17) | 55 | Apache-2.0 55 | none 49, test-profile 6 |
| kubeflow | 159 | 157 | 2 | 30 (22+8) | 30 | Apache-2.0 30 | output-equivalence 27, none 3 |
| tekton | 152 | 76 | 0 | 20 (14+6) | 20 | Apache-2.0 20 | test-profile 20 |
| github-actions | 550 | 623 | 3 | 85 (55+30) | 74 | MIT 37, Apache-2.0 33, AGPL-3.0 5, BSD-3-Clause 3, GPL-3.0 2, GPL-2.0 2, CC0-1.0 1, LGPL-3.0 1, LGPL-2.1 1 | none 85 |
| gitlab-ci | 216 | 208 | 8 | 43 (34+9) | 31 | MIT 26, GPL-2.0-or-later 5, unknown 2, Apache-2.0 2, GPL-3.0-or-later 2, BSD-3-Clause 1, MPL-2.0 1, EPL-2.0 1, BSD-3-Clause-Clear 1, LicenseRef-gitlab-detected-other 1, GPL-3.0-only 1 | none 43 |
| dagster | 52 | 50 | 2 | 25 (18+7) | 25 | Apache-2.0 25 | test-profile 24, none 1 |
| prefect | 826 | 58 | 42 | 18 (12+6) | 18 | Apache-2.0 18 | none 18 |
| temporal | 215 | 140 | 0 | 34 (24+10) | 34 | MIT 18, Apache-2.0 16 | test-profile 21, none 13 |

Conversion failures (raw failures preserved in the candidate files):

- **airflow**: no tasks extracted x3
- **argo**: no workflow kind: WorkflowEventBinding x2; no workflow kind: ConfigMap x1; no workflow kind: PersistentVolumeClaim x1; no workflow kind: ResourceQuota x1
- **kubeflow**: not a PipelineSpec x2
- **github-actions**: fetch 404 x3
- **gitlab-ci**: no jobs (include-only template) x5; no jobs after merging local includes (config lives in remote/project i x3
- **dagster**: no assets/ops found x2
- **prefect**: flow without recognised task calls x42

## Feature totals over the selected items

- nodes 9474, edges 13314; items with human steps 49, model calls 36, loops/maps 137, branching 209, sub-workflows 40, error paths 73
- async mechanisms (items): webhook 115, schedule 91, wait 57, poll 39, event 34
- IR verdicts: via-extension 279, native 121; extensions needed: triggers 201, error-branches 55, subworkflow-call 41, signals 26, finally(error-branches) 10, subworkflow-call(inlined at compile time) 8, setup-teardown(as all_resolved join; teardown scoping is an extension) 6

## Sources tried

### A. PyPI sdists (Apache Airflow core + providers)

Host `files.pythonhosted.org` via `pypi.org/pypi/<pkg>/json`; sha256 verified against PyPI digests; licence from PyPI `license_expression` (Apache-2.0 for every package; apache-airflow 2.10.5 via classifier) and the LICENSE/NOTICE in each sdist. Redistributable: yes (Apache-2.0; NOTICE preserved in the raw download). Example DAGs are `example_dags/*.py` and provider system tests `tests/system/**/example_*.py`.

| package==version | sdist sha256 (12) | DAGs converted | outcome |
| --- | --- | --- | --- |
| apache-airflow-core==3.3.2 | 53f38e7749a2 | 83 | acquired |
| apache-airflow-providers-airbyte==6.1.0 | dbcace859b11 | 1 | acquired |
| apache-airflow-providers-akeyless==0.3.1 | c8a8c522c741 | 1 | acquired |
| apache-airflow-providers-alibaba==3.5.0 | 164c370dc0fb | 5 | acquired |
| apache-airflow-providers-amazon==9.37.0 | 9972c5f4bab9 | 86 | acquired |
| apache-airflow-providers-apache-cassandra==3.10.0 | f1e3372490b7 | 1 | acquired |
| apache-airflow-providers-apache-drill==3.3.3 | 7d03a97d22c2 | 1 | acquired |
| apache-airflow-providers-apache-druid==4.6.0 | e595e2ea851d | 2 | acquired |
| apache-airflow-providers-apache-flink==1.9.0 | fbef220546a0 | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-apache-hdfs==4.14.0 | f033ef47500e | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-apache-hive==9.7.0 | 79804e04558b | 2 | acquired |
| apache-airflow-providers-apache-iceberg==2.1.1 | 633f191b1b5f | 2 | acquired |
| apache-airflow-providers-apache-impala==1.9.3 | 0aa4a6a10952 | 1 | acquired |
| apache-airflow-providers-apache-kafka==2.0.0 | b205731acb8d | 5 | acquired |
| apache-airflow-providers-apache-kylin==3.11.0 | 256a2aff5b2a | 2 | acquired |
| apache-airflow-providers-apache-livy==4.6.2 | d8a347a1d2ea | 1 | acquired |
| apache-airflow-providers-apache-pig==4.9.0 | 65d8ea23841f | 1 | acquired |
| apache-airflow-providers-apache-pinot==4.10.3 | e4b5b341e059 | 2 | acquired |
| apache-airflow-providers-apache-spark==6.3.2 | 0eb2207c0960 | 2 | acquired |
| apache-airflow-providers-apache-tinkerpop==1.2.0 | 69c9dbee9f81 | 1 | acquired |
| apache-airflow-providers-apprise==2.4.0 | 16d27befea13 | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-arangodb==2.10.0 | 46222a99fcfb | 1 | acquired |
| apache-airflow-providers-asana==2.12.0 | 63bfa748452a | 1 | acquired |
| apache-airflow-providers-atlassian-jira==3.4.0 | e3c1c4b50390 | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-celery==3.24.1 | a6f0b87297eb | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-clickhousedb==1.0.0 | b382a58141c3 | 2 | acquired |
| apache-airflow-providers-cloudant==4.3.6 | 0357bbe63cb4 | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-cncf-kubernetes==10.23.0 | 602ff0b0ca48 | 9 | acquired |
| apache-airflow-providers-cohere==1.8.0 | 4fcb5ab19f1b | 2 | acquired |
| apache-airflow-providers-common-ai==0.10.0 | 0af765fee64d | 105 | acquired |
| apache-airflow-providers-common-compat==1.20.0 | 2b94a1e75142 | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-common-io==1.10.0 | e0c2c4e348e5 | 1 | acquired |
| apache-airflow-providers-common-messaging==2.1.1 | 57224acd9ed9 | 1 | acquired |
| apache-airflow-providers-common-sql==2.2.0 | 67fa96b7e27c | 8 | acquired |
| apache-airflow-providers-databricks==7.21.0 | 4c850449cf65 | 6 | acquired |
| apache-airflow-providers-datadog==3.11.0 | 892c36c03b57 | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-dbt-cloud==4.10.0 | a7fc91ba3f47 | 1 | acquired |
| apache-airflow-providers-dingding==3.10.0 | c0d632ac6e0e | 1 | acquired |
| apache-airflow-providers-discord==3.12.3 | ff61a6e3b11f | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-docker==4.6.0 | 9cfe6f549f08 | 3 | acquired |
| apache-airflow-providers-edge3==4.3.2 | e59134dadc24 | 3 | acquired |
| apache-airflow-providers-elasticsearch==6.9.1 | 23a7899a8d31 | 1 | acquired |
| apache-airflow-providers-exasol==4.11.0 | 09cc22829ca5 | 1 | acquired |
| apache-airflow-providers-fab==3.10.0 | 9ef6158e9f1a | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-facebook==3.9.5 | 55d69648fe7f | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-ftp==3.16.0 | 470c9f006ecf | 1 | acquired |
| apache-airflow-providers-git==1.0.0 | 9677a829a298 | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-github==2.12.0 | 5c998a913bb0 | 1 | acquired |
| apache-airflow-providers-google==22.6.0 | 662a82b691a8 | 195 | acquired |
| apache-airflow-providers-grpc==3.10.0 | 7f241381afbb | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-hashicorp==4.8.2 | 14197f40bca1 | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-http==6.2.0 | 45e8ee017691 | 1 | acquired |
| apache-airflow-providers-imap==3.13.0 | ece649e20c1a | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-influxdb==2.12.0 | 34fa6c552395 | 3 | acquired |
| apache-airflow-providers-informatica==0.2.1 | 7fcae95e1594 | 1 | acquired |
| apache-airflow-providers-jdbc==5.6.0 | 918d979c76fd | 1 | acquired |
| apache-airflow-providers-jenkins==4.2.6 | a2ff67dde694 | 1 | acquired |
| apache-airflow-providers-keycloak==0.11.0 | 1b6d921cd831 | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-microsoft-azure==15.2.0 | 798ed9b4b28d | 26 | acquired |
| apache-airflow-providers-microsoft-mssql==4.7.1 | 87fbf762efe8 | 1 | acquired |
| apache-airflow-providers-microsoft-psrp==4.0.0 | 07404ad8cf42 | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-microsoft-winrm==3.15.0 | 5ddb909bd934 | 1 | acquired |
| apache-airflow-providers-mongo==5.5.0 | 0047ada2a068 | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-mysql==6.7.0 | f4b0aee8a17d | 1 | acquired |
| apache-airflow-providers-neo4j==3.13.0 | 8c08c9136ce6 | 2 | acquired |
| apache-airflow-providers-odbc==4.13.0 | ff97d9697362 | 1 | acquired |
| apache-airflow-providers-openai==2.0.0 | 035f8f095504 | 4 | acquired |
| apache-airflow-providers-openfaas==3.9.5 | 70cb31d847b8 | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-openlineage==2.20.2 | ff3bc80f4693 | 45 | acquired |
| apache-airflow-providers-opensearch==1.13.0 | e2d5a3017bad | 1 | acquired |
| apache-airflow-providers-opsgenie==5.11.0 | 268fdbe898fc | 2 | acquired |
| apache-airflow-providers-oracle==4.7.0 | 30adcec38bfe | 3 | acquired |
| apache-airflow-providers-pagerduty==5.3.0 | 856177d58bc9 | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-papermill==3.13.2 | 259252f5cca1 | 3 | acquired |
| apache-airflow-providers-pgvector==1.7.3 | fc1736130728 | 2 | acquired |
| apache-airflow-providers-pinecone==2.5.0 | d15c1a9e71fd | 5 | acquired |
| apache-airflow-providers-postgres==7.1.0 | 775b8f0c1261 | 1 | acquired |
| apache-airflow-providers-presto==5.13.0 | eef14b57bca6 | 2 | acquired |
| apache-airflow-providers-qdrant==1.6.0 | d42e2a042811 | 1 | acquired |
| apache-airflow-providers-redis==4.7.0 | 6fb918f6d35e | 2 | acquired |
| apache-airflow-providers-salesforce==5.15.0 | 3e89ef0ef4ef | 2 | acquired |
| apache-airflow-providers-samba==4.14.0 | f1be4ed3f8e7 | 1 | acquired |
| apache-airflow-providers-segment==3.10.0 | 63aedf51c6ac | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-sendgrid==4.2.4 | b015cf056c0c | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-sftp==6.1.0 | 7592b6c80cbf | 1 | acquired |
| apache-airflow-providers-singularity==3.9.4 | e98c9d38fb4c | 1 | acquired |
| apache-airflow-providers-slack==9.11.0 | 866ca2b69ea7 | 4 | acquired |
| apache-airflow-providers-smtp==3.1.0 | a0f1b0587d05 | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-snowflake==6.18.0 | 2d6e4b23bc4c | 7 | acquired |
| apache-airflow-providers-sqlite==4.3.3 | 4a4cae6dd9b2 | 1 | acquired |
| apache-airflow-providers-ssh==6.1.0 | dea6d26f5a4a | 0 | acquired (no example DAGs shipped) |
| apache-airflow-providers-standard==1.20.0 | ca51783ee221 | 21 | acquired |
| apache-airflow-providers-tableau==5.7.0 | 4fde56b914da | 1 | acquired |
| apache-airflow-providers-telegram==4.10.0 | b05eb9c9f643 | 1 | acquired |
| apache-airflow-providers-teradata==3.7.0 | c30b779e4113 | 11 | acquired |
| apache-airflow-providers-trino==6.7.0 | 1691e7d10549 | 2 | acquired |
| apache-airflow-providers-vertica==4.4.0 | 530d24fe3a5d | 1 | acquired |
| apache-airflow-providers-vespa==0.1.1 | 17b283794314 | 1 | acquired |
| apache-airflow-providers-weaviate==3.5.0 | 7d4de31c82b8 | 7 | acquired |
| apache-airflow-providers-yandex==4.6.0 | 660e3506bf8d | 4 | acquired |
| apache-airflow-providers-ydb==2.6.0 | ff813c941115 | 1 | acquired |
| apache-airflow-providers-zendesk==4.12.0 | 3b9d83cd517e | 1 | acquired |
| apache-airflow==2.10.5 | 1a2b1f1082d5 | 70 | acquired |

### B. Go module proxy (proxy.golang.org) as a mirror of GitHub repositories

GitHub web/API/codeload are blocked by the egress proxy (403), so module source zips were fetched from `https://proxy.golang.org/<module>/@v/<version>.zip` (redirects to storage.googleapis.com). Origin commit from `.info`.

| platform | module@version | origin commit | zip sha256 (12) | licence + evidence | used for | redistributable |
| --- | --- | --- | --- | --- | --- | --- |
| argo | github.com/argoproj/argo-workflows/v3@v3.7.18 | 66e32e5cc367f223e2ecf4fbe852b95eaed83034 | b64302b77743 | Apache-2.0 (LICENSE at module root) | examples/**/*.yaml (213 files) + .github/workflows | yes |
| kubeflow | github.com/kubeflow/pipelines@v0.0.0-20261006150226-96b3906a83bf | 96b3906a83bf58a440e5e2e5307c51769a185ffb | ee5fb5ec5361 | Apache-2.0 (LICENSE at module root) | test_data/sdk_compiled_pipelines/**/*.yaml (159) + .github/workflows | yes |
| tekton | github.com/tektoncd/pipeline@v1.17.0 | 61e02215132ce7bef054ff7e1fb074f217716c1a | 258a882d85bb | Apache-2.0 (LICENSE at module root) | examples/**/*.yaml (152) + .github/workflows | yes |
| temporal | github.com/temporalio/samples-go@v1.3.1-0.20261002171058-aaf79b672b32 | aaf79b672b32d9b7427a476a7488850cc11454b6 | 9c17c6bcaa06 | MIT (LICENSE at module root) | Go samples (one item per sample dir) + .github/workflows | yes |

### C. GitHub repositories via Sourcegraph listing / Software Heritage listing + raw.githubusercontent.com content

| repo | lister | commit | files listed / fetched | licence + evidence | redistributable |
| --- | --- | --- | --- | --- | --- |
| dagster-io/dagster (examples) | sourcegraph graphql | 8ed0d4d398c8bb2ed82049d272abab6747aeb391 | 2924 / 1743 | Apache-2.0 (raw LICENSE at commit) | yes |
| PrefectHQ/prefect-recipes | software heritage api | ebc974b22430f8fceda609dd0d17663ab2008c01 | 315 / 34 | Apache-2.0 (raw LICENSE at commit) | yes |
| PrefectHQ/prefect (docs/v3) | sourcegraph graphql | b73b09dc3699489c799dbb40ac5ed2da459e391c | 941 / 783 | Apache-2.0 (raw LICENSE at commit) | yes |
| PrefectHQ/prefect (examples) | sourcegraph graphql | b73b09dc3699489c799dbb40ac5ed2da459e391c | 9 / 9 | Apache-2.0 (raw LICENSE at commit) | yes |
| temporalio/samples-python | sourcegraph graphql | a8f66ddd98496916776819770e8e2da0b46f8a80 | 1019 / 840 | MIT (raw LICENSE at commit) | yes |

### D. Zenodo: 'A dataset of GitHub Actions workflow histories' (MSR 2024)

- Record: concept DOI 10.5281/zenodo.10259013, version 10.5281/zenodo.20340547 (published 2026-05-22), licence **CC-BY-4.0** (compilation; each workflow file keeps its repository's licence). Files used: `repositories.csv.gz` (md5 a345384e924083ae4da327e4fdf3af74, verified) and `workflows.csv.gz` (311 MB, md5 b557752520849d50a99d3750a8f62b68, verified). `workflows.tar.gz` (1.44 GB) and the auxiliaries were **not** downloaded: file contents were fetched individually instead. Author names/e-mails in the CSV were never copied.
- Index: 358,935 (repo, path) files; 321,171 live and valid at their latest version. Sample (seed 20261006): pool R = 220 uniform (one per repo), pool C = 330 random among files with >=25 versions (one per repo).
- Content: `raw.githubusercontent.com/<repo>/<commit>/<path>` pinned to the dataset's latest commit: {'acquired': 547, '404': 3}; licence file found at the same commit for 528/550, classified by text heuristics (`classify_license_text`), else `unknown`.
- Redistributability policy (applies to GitHub Actions and GitLab CI): normalised graph with short summaries committed only for permissive licences (MIT, Apache-2.0, BSD-*, ISC, MPL-2.0, Unlicense, CC0, CC-BY-4.0, ...). Copyleft (GPL/LGPL/AGPL/EPL/EUPL), source-available (BUSL, Elastic) and unknown licences: `redistributable:false`, title replaced by the URL-derived id, description empty, node summaries reduced to node types (graph features only).
- Converted licences (all 623 GHA candidates incl. mirrors): Apache-2.0 244, MIT 204, GPL-3.0 41, unknown 38, BSD-3-Clause 33, AGPL-3.0 24, LGPL-2.1 18, BSD-2-Clause 3, ISC 3, LGPL-3.0 3, GPL-2.0 3, MPL-2.0 2, CC0-1.0 2, Unlicense 1, BUSL-1.1 1, MIT-0 1, Elastic-2.0 1, CC-BY-4.0 1

### E. GitLab REST API v4 (gitlab.com, gitlab.freedesktop.org, gitlab.gnome.org, invent.kde.org, salsa.debian.org)

Per project: `projects/:id?license=true` (licensee detection), default-branch commit, `.gitlab-ci.yml` (or `ci_config_path`) and recursive `include: local` files (globs resolved with the tree API). `include: template` resolved against GitLab's own templates fetched in the same run; `include: project|component|remote` recorded as connectors, not expanded. GitLab CI templates: `gitlab-org/gitlab` `lib/gitlab/ci/templates/**/*.yml` (MIT; the repository is MIT except `ee/`).

| instance/project | commit | CI files | API licence -> recorded | outcome | redistributable |
| --- | --- | --- | --- | --- | --- |
| gitlab.com/AOMediaCodec/SVT-AV1 | 1394731134e0ca891e11db3cd98144d1aa9a7b72 | 7 | bsd-3-clause-clear -> BSD-3-Clause-Clear | acquired; selected | yes |
| gitlab.com/BuildStream/buildstream | 47b3c37c1f772925a546d1582077010490c85cea | 1 | lgpl-2.1 -> LGPL-2.1 | acquired; converted | no (features only) |
| gitlab.com/OpenMW/openmw | 71fc0a4a2904ed9c315050194f51857ed598a8d1 | 1 | gpl-3.0+ -> GPL-3.0-or-later | acquired; selected | no (features only) |
| gitlab.com/Remmina/Remmina | 173df4f25c1c43c0a60808d8dfbe0085e82273b9 | 1 | gpl-2.0+ -> GPL-2.0-or-later | acquired; converted | no (features only) |
| gitlab.com/antora/antora | 87797da7a7f337301ec9b1ad26aa291a28342d56 | 1 | mpl-2.0 -> MPL-2.0 | acquired; converted | yes |
| gitlab.com/apparmor/apparmor | e2652b585c4b0d8e8da4f8b5df0ea670ed77530c | 1 | gpl-2.0+ -> GPL-2.0-or-later | acquired; converted | no (features only) |
| gitlab.com/ase/ase | a70333dbc221fcf84f2a0a3b10419e011057f7db | 1 | gpl-2.0+ -> GPL-2.0-or-later | acquired; converted | no (features only) |
| gitlab.com/baserow/baserow | 68aec3cbee2f0373f7d98426fd87fbb0045bf93c | 2 | mit -> MIT | acquired; selected | yes |
| gitlab.com/crafty-controller/crafty-4 | fe65b372a4388552e9f4a1fe54251b2321f042fa | 6 | gpl-3.0+ -> GPL-3.0-or-later | acquired; selected | no (features only) |
| gitlab.com/cryptsetup/cryptsetup | ca4cc7a44e5794d8ad412f6d4f8463a81fe16d4a | 16 | gpl-2.0+ -> GPL-2.0-or-later | acquired; converted | no (features only) |
| gitlab.com/dalibo/postgresql_anonymizer | 25fdc690ce8f92037a95a3698063534037a7d02f | 6 | other -> LicenseRef-gitlab-detected-other | acquired; converted | no (features only) |
| gitlab.com/dependabot-gitlab/dependabot | e1b6bd11e143ebe5bcf9f2f3c426568e96ea4588 | 3 | mit -> MIT | acquired; selected | yes |
| gitlab.com/duplicity/duplicity | 2c0e77492112cb4d3a8cb913171e43c62e335050 | 1 | gpl-2.0+ -> GPL-2.0-or-later | acquired; selected | no (features only) |
| gitlab.com/famedly/conduit | 0aa81a4729b16949cccb0a76e502a4259f1a3d35 | 1 | apache-2.0 -> Apache-2.0 | acquired; converted | yes |
| gitlab.com/fdroid/fdroidclient | 9a57ddbb62d1321e67bd8b829168ee918227c33d | 1 | gpl-3.0 -> GPL-3.0-only | acquired; converted | no (features only) |
| gitlab.com/fdroid/fdroiddata | 2797d14c6d770d783c0b75d4771496bd69fc615f | 1 | agpl-3.0 -> AGPL-3.0 | acquired; converted | no (features only) |
| gitlab.com/fdroid/fdroidserver | c21c177ff6d813697aaf9c988ca9fbb2b571b468 | 1 | agpl-3.0 -> AGPL-3.0 | acquired; converted | no (features only) |
| gitlab.com/free-astro/siril | 41d5eabf9bdb0f20f908c0b72abb359ce819745a | 1 | gpl-3.0 -> GPL-3.0-only | acquired; converted | no (features only) |
| gitlab.com/freedesktop-sdk/freedesktop-sdk | 675305b60a976089d79d7e816161f8c7de51dd45 | 1 | mit -> MIT | acquired; converted | yes |
| gitlab.com/game-ci/unity3d-gitlab-ci-example | 4a7f0cb741452dc5072b56e05242c3b59ae352d4 | 1 | mit -> MIT | acquired; converted | yes |
| gitlab.com/gitlab-com/runbooks | 6f7f29a5ed7557a2f2523787b17575cc77c38a01 | 3 | mit -> MIT | acquired; selected | yes |
| gitlab.com/gitlab-org/charts/gitlab | 79ad585a08a1ddf560b63b3b5f1e85e3b0b366da | 11 | mit -> MIT | acquired; selected | yes |
| gitlab.com/gitlab-org/cli | 4d447cc6c19858928884626d802c8f7b7c5f799e | 1 | mit -> MIT | acquired; selected | yes |
| gitlab.com/gitlab-org/gitaly | 5379ceec30992954223861980389778af444651f | 1 | mit -> MIT | acquired; selected | yes |
| gitlab.com/gitlab-org/gitlab-development-kit | bf97fb3327781ab7dc474f6c3459029f4cdf1328 | 16 | mit -> MIT | acquired; selected | yes |
| gitlab.com/gitlab-org/gitlab-environment-toolkit | 28a9290c64892b0e7293d58b67eba2ff36d97cc9 | 4 | other -> LicenseRef-gitlab-detected-other | acquired; selected | no (features only) |
| gitlab.com/gitlab-org/gitlab-runner | 29703ea18f7a7c39ae7aaa66939e8338c966d3b6 | 18 | mit -> MIT | acquired; selected | yes |
| gitlab.com/gitlab-org/gitlab-shell | 971baee78a75cdd45bcf8e397fb4f6da87c88d99 | 1 | mit -> MIT | acquired; converted | yes |
| gitlab.com/gitlab-org/gitlab-ui | 8660f9fec8cb516908ea705c6a91d21c74895564 | 1 | mit -> MIT | acquired; selected | yes |
| gitlab.com/gitlab-org/gitlab-vscode-extension | e1c258bf8717dcf88075d26538c384cdd5cc9443 | 1 | mit -> MIT | acquired; converted | yes |
| gitlab.com/gitlab-org/gitlab | a6c8ade79f3c34758c98df62fa93fd6bf7b4b1cb | 58 | mit -> MIT | acquired; selected | yes |
| gitlab.com/gitlab-org/omnibus-gitlab | 30cace23dc197fd06250c324fe95892b5bcb55c1 | 9 | apache-2.0 -> Apache-2.0 | acquired; selected | yes |
| gitlab.com/glitchtip/glitchtip-backend | 0784bee5c3bddb7b99647b7fee0ce136800c051d | 1 | mit -> MIT | acquired; converted | yes |
| gitlab.com/gnutls/gnutls | 1e5be97c0e87cb18fca8bd33565d2c2191635ada | 1 | gpl-3.0+ -> GPL-3.0-or-later | acquired; converted | no (features only) |
| gitlab.com/gnuwget/wget2 | a26c1bf09f307e7471eb98c3fe014f81f4e5d862 | 1 | gpl-3.0+ -> GPL-3.0-or-later | acquired; converted | no (features only) |
| gitlab.com/graphviz/graphviz | 2954e36da96d21884a643b54a2fd7d9eb76e9e6a | 1 | epl-2.0 -> EPL-2.0 | acquired; selected | no (features only) |
| gitlab.com/inkscape/inkscape | 26a74ffabc59c2d0615ef0088cdbc4e592a9f771 | 1 | other -> LicenseRef-gitlab-detected-other | acquired; converted | no (features only) |
| gitlab.com/kicad/code/kicad | 46c51d95e33955f9a257e6158b45e2629297e8e8 | 10 | gpl-3.0+ -> GPL-3.0-or-later | acquired; converted | no (features only) |
| gitlab.com/libeigen/eigen | 9338bfc900e2fba9be506738cda23ee0d03b488c | 10 | mpl-2.0 -> MPL-2.0 | acquired; selected | yes |
| gitlab.com/libvirt/libvirt | 1bb978470e912e58b9e3ae89c4dbd14f143cfcd7 | 9 | gpl-2.0+ -> GPL-2.0-or-later | acquired; selected | no (features only) |
| gitlab.com/mailman/mailman | 04462d9e3fe943f646afa884af3b699b25c77daf | 1 | gpl-3.0+ -> GPL-3.0-or-later | acquired; converted | no (features only) |
| gitlab.com/mayan-edms/mayan-edms | 834ffec1b539171390358e60a0406870108514f5 | 0 | other -> - | acquired; not converted: no jobs after merging local includes (config lives in remote/project includes) | - |
| gitlab.com/nsnam/ns-3-dev | 994b1b373188617976df39b383b87525f4d508f1 | 0 | gpl-2.0+ -> - | acquired; not converted: no jobs after merging local includes (config lives in remote/project includes) | - |
| gitlab.com/nvidia/container-images/cuda | 209a790aaaa17c05137379c34a533e18d27e3cd9 | 1 | bsd-3-clause -> BSD-3-Clause | acquired; selected | yes |
| gitlab.com/openconnect/openconnect | 70d1e79d1e55849dfc71dcc199b1edb535b547e4 | 1 | lgpl-2.1 -> LGPL-2.1 | acquired; converted | no (features only) |
| gitlab.com/postgres-ai/database-lab | d279a1d6d7c0b48e06a968b5603b686dbc28f140 | 6 | apache-2.0 -> Apache-2.0 | acquired; selected | yes |
| gitlab.com/postmarketOS/pmaports | 817ed870e92a64963d926354fb74c75090811fcc | 1 | gpl-3.0 -> GPL-3.0-only | acquired; converted | no (features only) |
| gitlab.com/postmarketOS/pmbootstrap | 7954019f0ca6106a0fc20deb472ce56392615b11 | 1 | gpl-3.0 -> GPL-3.0-only | acquired; converted | no (features only) |
| gitlab.com/procps-ng/procps | 6e0855b87a0f392216118bfb202807644700489f | 1 | gpl-2.0+ -> GPL-2.0-or-later | acquired; converted | no (features only) |
| gitlab.com/qemu-project/qemu | 3377670ee96b5a68361016680a95b9013709d4b7 | 19 | gpl-2.0+ -> GPL-2.0-or-later | acquired; selected | no (features only) |
| gitlab.com/r2devops/hub | 7ace420a6dce498bb53a451e87cec2b6ee23e51e | 1 | mpl-2.0 -> MPL-2.0 | acquired; converted | yes |
| gitlab.com/renovate-bot/renovate-runner | 9313ba3cd8f096674870daf8075fd3a1afbc9a60 | 3 | mit -> MIT | acquired; converted | yes |
| gitlab.com/sequoia-pgp/sequoia | f1cc3012406e68c678e53d108960c8d1ae99dbd2 | 1 | lgpl-2.0 -> LGPL-2.0 | acquired; converted | no (features only) |
| gitlab.com/surfer-project/surfer | c9db19e7ebba3a7c25c6bb0466cfacd8cf7180e2 | 1 | eupl-1.2 -> EUPL-1.2 | acquired; converted | no (features only) |
| gitlab.com/tezos/tezos | 7788ce534d8243bb9761b013d65ebb36b3f463f8 | 49 | None -> unknown | acquired; selected | no (features only) |
| gitlab.com/veilid/veilid | dd8e2cdd72b5bf817172ac31c20872b168c5c8fc | 2 | mpl-2.0 -> MPL-2.0 | acquired; converted | yes |
| gitlab.com/veloren/veloren | 860720628d6c73a7bd4351ff2240cdbad51a866d | 5 | gpl-3.0+ -> GPL-3.0-or-later | acquired; converted | no (features only) |
| gitlab.com/wireshark/wireshark | 4cf03d0ab38e108c9de7f2a3bda858dbec04ee07 | 1 | gpl-2.0+ -> GPL-2.0-or-later | acquired; selected | no (features only) |
| gitlab.freedesktop.org/NetworkManager/NetworkManager | ed1f38cd449b32e935d994eed61600230cf4004b | 1 | gpl-2.0+ -> GPL-2.0-or-later | acquired; selected | no (features only) |
| gitlab.freedesktop.org/dbus/dbus | 1d58afcb1fafee5e461fe11aae228210a5fdde9e | 1 | other -> LicenseRef-gitlab-detected-other | acquired; converted | no (features only) |
| gitlab.freedesktop.org/drm/igt-gpu-tools | 5e43e9df3a1581074f0de2bbeddd939ebd950b93 | 1 | mit -> MIT | acquired; converted | yes |
| gitlab.freedesktop.org/freedesktop/ci-templates | e6415f6cc602d8afe4731d4f21b47f3eda03f879 | 2 | mit -> MIT | acquired; converted | yes |
| gitlab.freedesktop.org/gstreamer/gstreamer | 392361d4ab75fc343230f71e92c488661983094c | 2 | lgpl-2.1 -> LGPL-2.1 | acquired; converted | no (features only) |
| gitlab.freedesktop.org/libinput/libinput | 6af1d57c2c8e19b294bd0a16c212c234af976bb9 | 1 | other -> LicenseRef-gitlab-detected-other | acquired; converted | no (features only) |
| gitlab.freedesktop.org/mesa/mesa | c2188da5409b8dcf574480365202f25562856a8d | 51 | None -> unknown | acquired; selected | no (features only) |
| gitlab.freedesktop.org/pipewire/pipewire | 7f8ea8986c42d69a61f24f019426e13f01277048 | 1 | mit -> MIT | acquired; converted | yes |
| gitlab.freedesktop.org/poppler/poppler | 8dfee73a22188d647fcad7e25444f4178c0f5b4a | 1 | gpl-2.0+ -> GPL-2.0-or-later | acquired; converted | no (features only) |
| gitlab.freedesktop.org/wayland/wayland | 1bd29e0709db70b6463c947f150ea20dcfce9cac | 1 | mit -> MIT | acquired; converted | yes |
| gitlab.freedesktop.org/xorg/xserver | effe0ba3cd8d17be151de0d15b6c34a1db5e177f | 1 | sgi-b-1.1 -> SGI-B-1.1 | acquired; converted | no (features only) |
| gitlab.gnome.org/GNOME/gimp | 1b80b358d72924569e649e84563a6914f46dd6b5 | 1 | gpl-3.0+ -> GPL-3.0-or-later | acquired; converted | no (features only) |
| gitlab.gnome.org/GNOME/glib | e05063ccc6c8f222465a1080927f4c14349f3de6 | 1 | lgpl-2.1 -> LGPL-2.1 | acquired; converted | no (features only) |
| gitlab.gnome.org/GNOME/gnome-build-meta | 6cec2d131e86a8a1c7453919488a4274f2582d7c | 2 | mit -> MIT | acquired; selected | yes |
| gitlab.gnome.org/GNOME/gnome-builder | abb3cac58e0a670303ff6a02be6d93cda55134f9 | 1 | gpl-3.0 -> GPL-3.0-only | acquired; converted | no (features only) |
| gitlab.gnome.org/GNOME/gnome-shell | 29380c2662daaed660cd6d0115cdfe370510d8f6 | 1 | gpl-2.0+ -> GPL-2.0-or-later | acquired; converted | no (features only) |
| gitlab.gnome.org/GNOME/gtk | d2f98cd1faf7cee2dc20881d7a29bfe4349aca97 | 1 | lgpl-2.0 -> LGPL-2.0 | acquired; converted | no (features only) |
| gitlab.gnome.org/GNOME/libadwaita | 19098711c1218eea561077889d8fa23457ba0f24 | 1 | lgpl-2.1 -> LGPL-2.1 | acquired; converted | no (features only) |
| gitlab.gnome.org/GNOME/librsvg | 9dd24204cc92fbdf1e7566968807e8812a27f292 | 2 | lgpl-2.1 -> LGPL-2.1 | acquired; converted | no (features only) |
| gitlab.gnome.org/GNOME/mutter | 00b29c2fee0d90f6baff41a51326d486091b90ce | 1 | gpl-2.0+ -> GPL-2.0-or-later | acquired; converted | no (features only) |
| invent.kde.org/graphics/krita | c7b05604b38f4cc038a89d4569ddbc5b5564397a | 5 | gpl-3.0 -> GPL-3.0-only | acquired; selected | no (features only) |
| invent.kde.org/network/neochat | 18b9d11410379acb9f32f8df86552e60c2fd37c2 | 1 | None -> - | acquired; not converted: no jobs after merging local includes (config lives in remote/project includes) | - |
| invent.kde.org/plasma/kwin | ac91972e4649f54464cc5e0e6ba73a7e67a9a2e3 | 1 | None -> unknown | acquired; converted | no (features only) |
| invent.kde.org/sysadmin/ci-utilities | 3b29395af5bcf3f5ff26288a13d1614b2b5ba691 | 4 | None -> unknown | acquired; converted | no (features only) |
| salsa.debian.org/salsa-ci-team/pipeline | bf70ae25cba2f41fe483c8e8238b01b5f0e746d3 | 1 | other -> LicenseRef-gitlab-detected-other | acquired; converted | no (features only) |
| gitlab.com/gitlab-org/gitlab lib/gitlab/ci/templates | a1ef5ed1e7fd72e58911cf4338742d42c8e0ed9b | 133 | mit -> MIT | acquired; 128 converted, 15 selected | yes |

### F. Blocked, unavailable or rejected sources

| source | date | outcome | note |
| --- | --- | --- | --- |
| github.com, api.github.com, codeload.github.com | 2026-10-06 | blocked (egress proxy 403) | replaced by proxy.golang.org zips, Sourcegraph/SWH listings + raw.githubusercontent.com |
| sourcegraph.com code search (GraphQL `search`) | 2026-10-06 | blocked (HTTP 403 for anonymous search) | could not discover Prefect/Dagster/Temporal flows across arbitrary public repos; repository tree listing still works |
| Sourcegraph listing: PrefectHQ/prefect-recipes, gitlab-org/gitlab (as github.com/...) | 2026-10-06 | not found (not indexed) | prefect-recipes via Software Heritage instead; gitlab-org/gitlab via GitLab API |
| Software Heritage: temporalio/samples-python | 2026-10-06 | not found (origin not archived) | Sourcegraph listing used |
| data.jsdelivr.com gh listings (dagster, prefect) | 2026-10-06 | blocked (403: package > 50 MB limit) | Sourcegraph listing used |
| Zenodo GHA histories workflows.tar.gz (1.44 GB) + auxiliaries | 2026-10-06 | not downloaded (by choice) | index CSV + per-file raw fetch keeps raw storage < 400 MB |
| Hugging Face datasets search (github-actions, airflow dags, ci workflows) | 2026-10-06 | not found / unsuitable | HajerMH/github_actions (action centrality metadata, no licence), pranavjrat/top-github-actions (GPL-3.0 CSV of action names): no workflow files |
| gitee.com | 2026-10-06 | blocked (connection reset) | not needed |
| data.softwareheritage.org | 2026-10-06 | blocked (CONNECT 502) | archive.softwareheritage.org API works |
| raw.githubusercontent.com (3 sampled GHA files) | 2026-10-06 | not found (404 at recorded commit) | listed as fetch failures |
| gitlab.com mayan-edms/mayan-edms, nsnam/ns-3-dev; invent.kde.org network/neochat | 2026-10-06 | acquired, not convertible | pipeline defined in project/remote includes that were not expanded |
| Kubeflow samples/ (Python DSL) and Argo Events / WorkflowEventBinding manifests | 2026-10-06 | acquired, not converted | compiled IR used for KFP; event bindings are not workflows |
| Temporal samples-java/-typescript/-dotnet, Prefect community flows, Dagster docs_snippets | 2026-10-06 | not attempted / out of budget | Python+Go Temporal samples and official Prefect/Dagster sources only |

## Graph modelling and feature definitions

- **Airflow**: operators/TaskFlow calls -> nodes; `>>`/`<<`/`chain`/`chain_linear`/`cross_downstream`/`set_*stream` -> control edges; XComArg/`.output`/TaskFlow arguments/`xcom_pull` in templates -> data edges; TaskGroups expanded to member roots/leaves; `.expand`/`.partial().expand()` -> loops (map); sensors -> wait (poll, or event when deferrable); HITL operators -> human; Branch*/ShortCircuit/LatestOnly -> condition; one_failed/all_failed trigger rules -> error edges; teardown -> error-handler; schedule/asset schedules -> one trigger node. Parse-time Python loops are counted once per creation site (noted per item).
- **Argo**: templates inlined from the entrypoint; steps groups = parallel fan-out/fan-in; DAG `dependencies`/`depends` (Failed/Errored -> error edges); withItems/withParam/withSequence -> map; recursion -> loop node + loop edge; suspend -> human (no duration) or wait; templateRef/workflowTemplateRef -> subworkflow; onExit/lifecycle hooks -> error-handler; CronWorkflow -> trigger.
- **Kubeflow** (compiled PipelineSpec): condition/for-loop/exit-handler/nested-pipeline groups inlined; triggerPolicy.condition -> guard; parameterIterator/artifactIterator -> map; ALL_UPSTREAM_TASKS_COMPLETED -> error-handler; taskOutput producers -> data edges.
- **Tekton**: pipeline tasks; runAfter -> control, `$(tasks.X.results...)` -> data; when -> guard; matrix -> map; finally -> error-handler with error edges from the leaves; custom tasks/resolvers -> connectors; pipelines-in-pipelines -> subworkflow.
- **GitHub Actions**: one node per `on:` event (schedule -> schedule; repository_dispatch/workflow_run/workflow_call -> event; others -> webhook); one node per step, chained within a job; job `needs` -> edges (data if `needs.X.outputs` read); `if:` guards; `failure()/always()/cancelled()` guards -> error-handler + error edges; matrix -> map; job-level `uses:` -> subworkflow.
- **GitLab CI**: jobs -> nodes; stage order as `stage:a->b` merge (barrier) nodes unless `needs` is declared; `when: manual` -> human; `when: delayed` -> wait; `when: on_failure` -> error-handler; `trigger:` -> subworkflow; `parallel` -> map; rules/only/except -> guard; pipeline sources referenced in rules -> trigger node (default push).
- **Dagster** (one item per example project): assets (params, `deps`, `ins`) -> data/control edges; multi/graph assets; integration asset factories (dbt, dlt, sling, airbyte...) -> connectors; asset checks -> read nodes; op jobs with `.map/.collect`; schedules/sensors -> triggers; run-failure sensors -> error-handler.
- **Prefect** (one item per file or docs page): the richest top-level `@flow`; direct task calls chained in order; `.submit/.map` concurrent (map counted as loop); if/for/while/try -> guard/loop+loop edge/error-handler; subflows and `run_deployment` -> subworkflow; `pause_flow_run`/`suspend_flow_run`/`wait_for_input`/`receive_input` -> human; `.serve/.deploy(cron|interval|triggers)` -> trigger.
- **Temporal** (one item per sample, or per file for multi-workflow dirs such as `hello/`): Python `@workflow.run` bodies walked (activities, child workflows, timers, `wait_condition`, continue-as-new, gather fan-out, except-path compensation); signals/updates -> events; approval-like waits -> human. Go samples: brace-aware regex scan (approximate; `if err != nil` not counted as a guard).
- Feature definitions are in the docstring of `scripts/orchestration-common.py`. `effects` comes from verb heuristics on node type names (get/list -> read, create/delete/upload -> write, run/submit/send/deploy -> external) and from script text for shell/code nodes; it is an estimate.
- IR verdicts compare against the Phase 1 IR (task, assert, human, map, loop, wait, agent, code, verify; `when` guards; retry; onError stop|continue; all_success/all_resolved joins). Triggers, signals/events, error branches/finally, sub-workflow calls and setup/teardown scoping are reported as `via-extension:*`. No item was judged `unsupported`; that is a limitation of a static check, not a claim of executability.

## Most complex / interesting selected items

| id | nodes | edges | why it is interesting |
| --- | --- | --- | --- |
| gitlab-ci:gitlab.com/nvidia/container-images/cuda | 901 | 2431 | 894 guards/branches, async webhook |
| gitlab-ci:gitlab.com/gitlab-org/gitlab | 436 | 793 | 14 human steps, model calls, 126 loops/maps, 428 guards/branches, 18 sub-workflows, error paths, async wait/webhook, 17 connectors |
| gitlab-ci:gitlab.freedesktop.org/mesa/mesa | 227 | 461 | 77 human steps, 46 loops/maps, 222 guards/branches, async wait/webhook, 3 connectors |
| gitlab-ci:gitlab.com/gitlab-org/omnibus-gitlab | 187 | 332 | 55 human steps, 2 loops/maps, 181 guards/branches, 4 sub-workflows, async wait/webhook, 7 connectors |
| gitlab-ci:gitlab.com/tezos/tezos | 192 | 271 | 38 human steps, 33 loops/maps, 135 guards/branches, async wait/webhook, 1 connectors |
| gitlab-ci:gitlab.com/qemu-project/qemu | 116 | 136 | 94 human steps, 1 loops/maps, 115 guards/branches, async wait/webhook, 2 connectors |
| gitlab-ci:gitlab.com/libeigen/eigen | 172 | 275 | 8 human steps, 1 loops/maps, 171 guards/branches, async wait/webhook, 2 connectors |
| gitlab-ci:gitlab.com/libvirt/libvirt | 83 | 86 | 41 human steps, 82 guards/branches, async wait/webhook, 3 connectors |
| gitlab-ci:gitlab.com/gitlab-org/gitlab-runner | 87 | 205 | 9 human steps, 15 loops/maps, 80 guards/branches, 4 sub-workflows, async wait/webhook, 10 connectors |
| github-actions:opsmill/infrahub/.github/workflows/ci.yml | 198 | 276 | 3 loops/maps, 55 guards/branches, 4 sub-workflows, error paths, async webhook, 10 connectors |
| github-actions:bytecodealliance/wasmtime/.github/workflows/main.yml | 186 | 230 | 8 loops/maps, 52 guards/branches, error paths, async webhook, 8 connectors |
| gitlab-ci:gitlab.com/postgres-ai/database-lab | 91 | 163 | 4 loops/maps, 87 guards/branches, async webhook, 4 connectors |
| airflow:apache-airflow-providers-standard/src/airflow/providers/standard/example_dags/example_hitl_operator#example_hitl_operator | 9 | 8 | 6 human steps, 1 guards/branches, async wait |
| airflow:apache-airflow-providers-common-ai/src/airflow/providers/common/ai/example_dags/example_llm_survey_agentic#example_llm_survey_agentic | 7 | 6 | 1 human steps, model calls, 3 loops/maps, async wait, 3 connectors |
| airflow:apache-airflow-providers-common-ai/src/airflow/providers/common/ai/example_dags/example_langchain_tool_agent#example_langchain_tool_agent | 5 | 4 | 2 human steps, model calls, async wait, 2 connectors |
| airflow:apache-airflow-providers-common-ai/src/airflow/providers/common/ai/example_dags/example_aip_progress_tracker#example_aip_progress_tracker | 12 | 13 | 1 human steps, model calls, 3 loops/maps, async wait, 1 connectors |
| airflow:apache-airflow-providers-amazon/tests/system/amazon/aws/example_sagemaker#example_sagemaker | 26 | 48 | model calls, 1 guards/branches, async poll/schedule, 2 connectors |
| gitlab-ci:gitlab-org/gitlab/lib/gitlab/ci/templates/Auto-DevOps.gitlab-ci.yml | 77 | 108 | 15 human steps, 65 guards/branches, async wait/webhook, 17 connectors |
| argo:dag-coinflip | 12 | 20 | 4 loops/maps, 8 guards/branches |
| argo:exit-handlers | 4 | 3 | 2 guards/branches, error paths |
| argo:intermediate-parameters | 3 | 2 | 1 human steps, 1 guards/branches, async wait |
| kubeflow:valid/if_elif_else_complex | 13 | 17 | 2 loops/maps, 10 guards/branches |
| tekton:v1/pipelineruns/pipelinerun-with-when-expressions | 14 | 34 | 13 guards/branches, error paths |
| github-actions:kubeflow/pipelines/.github/workflows/ai-analyzer.lock.yml | 104 | 116 | model calls, 52 guards/branches, error paths, async webhook, 6 connectors |
| temporal:samples-go/nexus-messaging | 23 | 26 | 3 human steps, 7 loops/maps, 21 guards/branches, async event/wait |
| temporal:samples-python/langfuse_tracing/ticket_triage | 4 | 5 | 1 human steps, model calls, async event, 2 connectors |
| dagster:docs_projects/project_ml | 18 | 19 | async event/schedule, 1 connectors |

## Honest limits

- All graphs are **static extractions**; none was executed. Dynamic structure decided at run time (Airflow parse-time loops, GitLab `rules:changes`, GHA dynamic matrices, Dagster factories, Prefect/Temporal control flow through helper functions) is approximated.
- Prefect coverage is thin: official sources hold few flows (9 examples, 34 recipe files, docs snippets), 42 files had flows whose tasks live in other modules or that call plain functions, and cross-repository discovery needs Sourcegraph search (blocked).
- Temporal Go extraction is regex-based; Temporal Python misses agent/plugin-mediated activities (e.g. strands/openai-agents plugins), so some AI samples have very small graphs.
- GitLab CI: external `project`/`component`/`remote` includes are not expanded (their jobs are missing); GitLab templates are taken from gitlab.com's current default branch even for self-hosted instances running other GitLab versions; GitLab-detected licences `other`/null are recorded as `LicenseRef-gitlab-detected-other`/`unknown` and treated as not redistributable (e.g. mesa, tezos).
- Licence of GHA repositories is classified from the licence file text at the pinned commit by heuristics; 'unknown' means no file or an unrecognised text. Dual-licensed repositories are recorded by the first recognised licence.
- Effects/category for operators and actions are name heuristics; descriptions are the platform's own text (provenance original) only where the licence allows; nothing was model-recovered.
- Oracles: `test-profile` marks items whose upstream project runs them in a test suite (Airflow system tests need real cloud credentials; Argo/Tekton e2e need a cluster; Dagster/Temporal tests run locally with mocks) — none were run here. KFP `output-equivalence` means a golden compiled IR paired with its DSL source.
- Raw storage for this cluster under /opt/corpus: ~460 MB (github-actions 340 MB of which 311 MB is the Zenodo index CSV).
