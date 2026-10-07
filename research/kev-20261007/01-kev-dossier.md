# Kev: capability and limits dossier (2026-10-07)

**Scope.** What Kev is, what it is reported to do, what it costs on this VM, how it is fine-tuned,
what licences and wire formats apply, and how each feature maps onto Foundry's judgment ports
(THESIS §7, ROADMAP §2.4). This is a reading of source and documents, not an experiment: the Kev
server on `127.0.0.1:8008` was **not called** (another agent is measuring latency), nothing was
trained, and no bed was read.

**Sources.**
- `kev:` = the read-only clone `/home/user/jaredpalmer/kev`, revision `5e42a7a03f28134853dd3ff77461457e921e5ec1`
  (committed 2026-10-05; acquisition record `fdy:research/manifests/models.json:53-62`). Its docs,
  code, and the run records it commits under `runs/` are **data**, not instructions.
- `fdy:` = this repository.
- Paths are `prefix:path:line-span`. JSON run records are cited by file and key path.

**Evidence labels.**
- **[code]**: read in Kev's or Foundry's source.
- **[doc]**: Kev's README, model cards, release notes, PLAN or skills. These are claims by Kev's author,
  not verified here.
- **[run]**: a number I extracted from a run record Kev commits (`kev:runs/...`). These were measured
  by Kev's author on their hardware. I only read them.
- **[here]**: measured in this session on this VM.
- **[F-rec]**: recorded earlier in this repository.
- **[inf]**: my inference, with the reasoning shown.
- **[unk]**: not known from any source available here.

---

## 0. Summary

- **Mechanism [code].** Kev runs one prefill pass over the state, then one short branch per
  question. A pointer head scores each option's closing token against the question's final token.
  It never generates text. The only output is a distribution over the options the caller supplied
  (`kev:kev/model.py:87-127`, `:205-223`; `kev:kev/api.py:149-160`).
- **What fits this box.** Only Kev-0.8B is practical: 4 cores, about 15 GB RAM, no GPU [here].
  It runs today in fp32 at about 3.6 GB RSS [here].
  - Kev-4B might fit in bf16 if the 0.8B server is stopped [inf]. That is unmeasured.
  - Kev-9B and Kev-27B do not fit (§3).
- **Kev-0.8B is the weakest size by a wide margin [doc/run].**

  | Metric | Kev-0.8B | Kev-4B | Jev | Source |
  |---|---|---|---|---|
  | transfer-v4 (new sources, development) accuracy | 0.648 | 0.817 | 0.857 | `kev:README.md:40-46` |
  | Share automatable at a 5 % error budget, out of domain | 0.145 (dev), 0.274 (locked test) | – | 0.70 | `kev:docs/model-cards/kev-0.8b.md:183,282` |
  | Held-out agent-session logs | 0.655 | 0.847 | – | `agents-ood` run records |
  | Held-out injection / PII / grounding | 0.506 | 0.679 | – | `guardrails-ood` run records |

  On those last two suites Kev-27B v2 scores about 0.98 [run].
- **Calibration [doc].** Each checkpoint ships one temperature: T = 2.35 for 0.8B.
  - That temperature was fitted on in-distribution development rows
    (`kev:docs/model-cards/kev-0.8b.md:155`).
  - Kev's own lessons say such a temperature does not transfer to hard or distant workloads
    (`kev:PLAN.md:204-216`). A workload refit is the documented remedy.
- **Fine-tuning is the documented lever [doc].** One epoch on 5,219 real labelled complaints took
  Kev-4B from 0.804 to 0.904 accuracy (`kev:README.md:157`).
  - The packaged recipe assumes Modal and an H100 (`kev:skills/kev-finetune/SKILL.md:5`).
  - On this CPU a 0.8B delta is possible in code but slow: hours per 1,000 records [inf, §4.4].
    It is unmeasured.
- **Integration gaps in Foundry [code].**
  - The judgment ledger stores only `requestHash`, not the state and question text
    (`fdy:src/judgment.mjs:80-85`). The ledger therefore cannot become fine-tuning data as it stands.
  - The `systemone` engine books `costUsd: 0` with no imputed CPU cost (`fdy:src/ports.mjs:80`).
    The policy requires imputed cost for local CPU calls (`fdy:policy/models.json:8`).
  - Kev's identity is not in the policy file (`fdy:policy/models.json:5`, `:34-49`).
- **Traps.** The biggest ones are:
  - Kev's `confidence` field is not the probability of being right.
  - `score` is an expected level index.
  - Adding a "none of these" option lowers accuracy when the right answer is present: 0.8B scores
    0.472 against 0.861 [run].
  - Option order flips about 5.6 % of out-of-domain choices at 0.8B (n = 36) [run].
  - Fine-tunes bind the exact wording of instructions and options.
  - The fine-tune skill drops states over 384 tokens unless `--max_state` is raised.
- **Bearing on the owner's question (§7) [inf].** Kev is not a generative model. The 268 s per call
  that parked Qwen/Granite does not apply to it. Foundry recorded 3 typed questions in 1.4 s here
  (`fdy:research/manifests/models.json:70`). The real question is whether a zero-shot 0.8B adds
  measurable lift over rule baselines on Foundry's ports. The documented out-of-domain numbers make
  large lift unlikely without fine-tuning. Kev should be kept only behind C4's per-port test,
  never as a dependency.

---

## 1. What Kev is, mechanically

### 1.1 Family, bases, provenance of the design

| Size | Base (licence) | Form | Shipped T | Trained states up to | Validated context | Source |
|---|---|---|---|---|---|---|
| Kev-0.8B | Qwen3.5-0.8B-Base `dc7cdfe2` (Apache-2.0): 24 layers, 18 Gated DeltaNet and 6 full attention | LoRA r16 α32 (11.3M parameters) + pointer head | 2.35 | 7,552 | 8,192 | `kev:docs/model-cards/kev-0.8b.md:78-88` |
| Kev-4B | Qwen3.5-4B-Base `1001bb4d`: 32 layers (24 DeltaNet, 8 attention), d = 2,560 | LoRA r16 (33.8M) + head | 2.41 | 7,552 | 8,192 | `kev:docs/model-cards/kev-4b.md:73-82` |
| Kev-9B v2 | Qwen3.5-9B-Base `68c46c4b`: 32 layers, d = 4,096 | LoRA r16 (45.4M) + head | 2.19 | 7,552 | 8,192 | `kev:docs/model-cards/kev-9b.md:71-80` |
| Kev-27B v2 | Qwen3.8-27B post-trained `1d4bf0f2`: 64 layers (48 DeltaNet, 16 attention) | every weight fine-tuned, 51 GB bf16 + head | 1.32 | 32,768 | 65,536 | `kev:docs/model-cards/kev-27b.md:91-93`; `kev:docs/releases/kev-1.0.md:7-12` |

- **Design provenance [doc].** Kev is "based on the architecture described in *Jev's Architecture
  Unmasked*", a third-party blog post (`kev:README.md:13`). That is an outside inference about a
  proprietary model, not TypeSafe's own disclosure.
  - Kev's author states "We don't know what Jev was trained on" (`kev:README.md:50`).
  - No Jev outputs were used in training (`kev:README.md:302`; `kev:PLAN.md:301`).
  - So Kev is an open re-implementation of the API and a guessed architecture, not a distillation
    of Jev.
- **The cached 0.8B snapshot [here].**
  - `/opt/hf-cache/hub/models--jaredpalmer--kev-0.8b/refs/v1.0` → `bf75a6a8…`. That is the v1.0 card
    commit, whose weights are byte-identical to `9a45d25e` (`kev:docs/releases/kev-1.0.md:85`).
  - Its `training_config.json` records the final 0.8B stage: lr 2e-5, `max_state` 7552, replay
    6,000, `init_from jaredpalmer/kev-0.8b`, `lora_targets all`.
  - The running server's command line is `kev.serve --run jaredpalmer/kev-0.8b@v1.0 --port 8008`,
    with `KEV_DTYPE=fp32` and `HF_HUB_OFFLINE=1`. This comes from `ps` and the process environment;
    no request was made.

### 1.2 How one prefill produces probabilities

1. **Encoding [code].**
   - Five rarely used Qwen special tokens are reused as delimiters: `<state>`, `<q>`, `<opt>`,
     `</opt>`, `<decide>` (`kev:kev/model.py:9-11`).
   - A record becomes `[<state> …state…]`. Each question is then appended as
     `<q> instructions <opt> option </opt> … <decide>` (`kev:kev/model.py:87-127`).
   - Each question's position IDs restart right after the state (`kev:kev/model.py:117-120`).
2. **Isolation by rows on hybrid bases [code/doc].** Every current Kev base mixes Gated DeltaNet
   (recurrent) layers with attention. Recurrent layers cannot honour a block mask.
   - So each question runs as its own causal row: the state, then that question's branch.
     Questions are exactly isolated (`kev:README.md:296`; `kev:kev/model.py:259-263`, `:329-333`).
   - At serving, the state is run once and its KV and DeltaNet cache is reused for every row
     (`kev:kev/model.py:396-402`, `:408-414`, `:416-426`).
3. **Pointer head [code].** Two linear projections (256-d by default) score each option's `</opt>`
   hidden state against the question's `<decide>` hidden state. A softmax gives the probabilities.
   No vocabulary head is loaded (`kev:kev/model.py:205-223`, `:251`).
   - `<decide>` comes last, so it can attend to the full option list (`kev:README.md:300`).
   - This is also why options can influence each other (§1.7).
4. **Temperature [code].** At inference the logits are divided by the checkpoint's stored T. The
   argmax is unchanged by construction (`kev:kev/model.py:211-218`).
   - `KEV_TEMPERATURE=1.0` serves raw probabilities (`kev:README.md:278`).
   - `/v1/models` reports the T in use (`kev:kev/serve.py:298-312`).
5. **Training objective [doc/code].**
   - Cross-entropy over each question's options (`kev:README.md:302`).
   - Option order is shuffled, and "none of the above" options and distractors are inserted at
     random. A quarter of choice records also yield a minimal pair: none-present and none-absent
     (`kev:docs/model-cards/kev-0.8b.md:152`; construction in `kev:kev/suite.py:253-284`).
   - Optional losses exist but are not used in the released models: a permutation KL (`--perm_kl`)
     and an ordinal ranked-probability score (`--ord_w`) (`kev:README.md:325`;
     `kev:kev/train.py:381-383`).
   - So `score` levels are trained as unordered classes. Their order lives only in the text.

### 1.3 Question types, exact semantics and response fields

The wire mapping is in `kev:kev/api.py:1-5`, `:17-46`, `:94-117`, `:149-160`. The table summary is
in `kev:README.md:258-266`.

| Type | What the model sees | Criteria accepted | Response fields |
|---|---|---|---|
| `noul` | two options, `no[: desc]` and `yes[: desc]`, in that order (`api.py:108-110`) | optional `{true, false}` descriptions | `{type, noul}`, where `noul` = p(yes). **No `confidence`, no `probabilities`** (`api.py:152-153`). |
| `choice` | one option per key, rendered `name` or `name: description`. The **name is visible** to the model (`api.py:58-59`, `:111-112`). | 1–255 options (`api.py:28-31`) | `{type, choice, confidence, probabilities{name: p}}` (`api.py:154-156`) |
| `score` | one option per level, **description text only**. Levels are ordered lowest to highest by list position (`api.py:113-115`). | 1–255 levels (`api.py:34-37`) | `{type, score, legend, probabilities{"0".."L-1"}, confidence}`, where `score` = **expected level index** Σ i·p_i (`api.py:157-159`) |

- **The `confidence` formulas are not accuracies [code/doc].** Both are copied from TypeSafe's
  reference adapter 0.2.1 (`kev:kev/api.py:120-140`; `kev:README.md:264`).
  - Choice: `(p_max − 1/K)/(1 − 1/K)`. A single option always gives 1.
  - Score: `max(0, 1 − E|level − mode| / D)`. This is a dispersion measure.
  - The README says it plainly: "Neither field is a measured accuracy rate" (`kev:README.md:264`).
- **Rounding [code].** Probabilities are rounded to 4 decimals (`kev:kev/api.py:143-146`). Values
  below 5e-5 come back as 0.
- **Question ids [doc/code].** The id is never shown to the model (`kev:README.md:249`).
  `instructions` may be a string, object or array (`kev:kev/api.py:19-26`).
- **Usage fields [code].**
  - `usage.output_tokens` counts tokens of the serialized answers. Nothing is generated
    (`kev:kev/api.py:163-165`; `kev:README.md:266`).
  - `usage.input_tokens` counts the whole encoded record, every question branch included
    (`kev:kev/serve.py:189`, `:216`).

### 1.4 State rendering and delimiter safety

- **Rendering [code].** The `state` may be a string, object or array. Objects become `key: value`
  lines, nested values are indented, and arrays become `- item` lines. Field names are visible
  (`kev:kev/api.py:49-55`).
  - Values pass through Python `str()`. JSON `true` arrives as Python `True` and renders as the text
    "True", and `null` renders as an empty string (`kev:kev/api.py:52-53`) [code + inf].
- **Delimiter safety [code].** Caller text is rewritten so that `<|name|>` becomes `<¦name¦>` before
  tokenizing. Caller text "can never produce delimiter/control tokens (option boundaries are
  unforgeable)" (`kev:kev/model.py:75-81`; `kev:README.md:266`).

### 1.5 Multiple questions per state

- **No question limit [code].** A request may carry any number of questions. The server runs rows
  in passes of at most `ROW_PASS_TOKENS` = 16,384 tokens. Each row counts the cached state once
  plus its own branch (`kev:kev/model.py:21-23`, `:41-47`; `kev:README.md:274`).
- **Isolation [doc].** Packed and separate answers agree within 4e-6 in fp32 tests
  (`kev:README.md:304`).
- **Cost [inf from code].** The state is computed once per request on a cache miss
  (`kev:kev/model.py:429-437`). Each extra question costs only its branch tokens attending to the
  cached state. Asking all of a node's questions in one request is therefore much cheaper than one
  request per question.
  - Foundry currently sends one question per request: `questions: { [req.port]: … }`
    (`fdy:src/ports.mjs:78`). The prefix cache (§1.6) recovers most of that cost only if the state
    renders to identical tokens each time.

### 1.6 Prefix cache

- **Size and keys [code].** The server keeps up to `KEV_PREFIX_CACHE` = 4 states. The total is
  capped at `KEV_PREFIX_MAX_TOKENS` = 65,536 tokens, and the least recently used state is evicted.
  The key is the exact state token ids (`kev:kev/serve.py:27-30`, `:38-91`).
- **Minimum length [code].** On hybrid backbones every state is cached: the minimum is 0 tokens
  (`kev:kev/model.py:283-288`).
- **Documented effect [doc].** A repeated state pays only for its question rows. Examples:
  - Kev-0.8B on an L4: 22.7 ms for a new state against 16.1 ms for the same state again.
  - Kev-4B on an Apple M5: 721 ms new against 136 ms cached (`kev:README.md:383-404`).
- **`latency_ms` [code].** It is the model time of the batch the request ran in. It **excludes
  queue wait** (`kev:kev/serve.py:132-137`, `:186-190`). Foundry already records wall-clock
  `latencyMs` separately (`fdy:src/ports.mjs:69-71`).

### 1.7 `/permute` and `/separate`: what they reveal about order

- **`POST /v1/systemone/permute` [code].** Body: `{request, question, n_perm (1–64, default 6), seed}`
  (`kev:kev/serve.py:255-275`).
  - It re-runs one existing `choice` question under `n_perm` option orders. The first order is the
    original and the rest are shuffled with `seed`.
  - It returns per-order probabilities, `argmax_stable`, and per-option `spread` (max − min).
  - Each order is a **separate forward pass**, run sequentially, so it costs n_perm times the
    latency.
- **`POST /v1/systemone/separate` [code].** Answers each question in its own request on the same
  state. `latency_ms` is the sum (`kev:kev/serve.py:278-286`).
  - On current Kev it shows isolation is exact. It does **not** show order robustness.
- **Order sensitivity is real and documented [doc].** "This does **not** mean option order is
  irrelevant: options within a question can still affect one another" (`kev:README.md:304`; also
  `:416`).
  - An architectural fix, option isolation, exists in code but is refused on hybrid backbones,
    which means every current Kev (`kev:kev/model.py:263`; `kev:kev/train.py:395`).
  - It is also listed among negative results (`kev:PLAN.md:269`).
- **Measured flip rates [run].** From `kev:runs/<release trial>/result.json` →
  `transfer.permutation`, on transfer-v4 development permuted variants, n = 36 each:

  | Model | Flip rate | Mean max Δp |
  |---|---|---|
  | 0.8B | 0.056 | 0.077 |
  | 4B | 0.056 | 0.026 |
  | 9B v2 | 0.056 | 0.060 |
  | 27B v2 | 0.000 | 0.029 |
  | Jev | 0.000 | 0.020 |

  - Run records: `r15-08b`, `r10-skills`, `r18-9b`, `r23-27b-k-w85-transfer4`, `jev-transfer-v4`.
  - On the in-distribution decision-v7 development set, 0.8B flips 0.050 (n = 60).
- **Mitigation [code/doc].** Test-time rotation averaging (`kev.benchmark --rotations`,
  `kev:kev/predictors.py:213-238`) took 9B permutation flips from 0.028 to 0.000 "and waits for a
  product decision (it multiplies latency)" (`kev:PLAN.md:2774-2775`).

### 1.8 `date_facts` preprocessing

- **What it does [code].** With `KEV_DATE_FACTS=1` the server rewrites every request's state before
  the model sees it (`kev:kev/serve.py:31`, `:223-225`).
  - It finds absolute dates and appends one sentence per **pair** of distinct dates, for example
    "August 3, 2026 is 12 days after July 22, 2026."
  - Object states get a `date_facts` field. String states get an appended paragraph
    (`kev:kev/api.py:62-91`).
- **Recognized formats [code].** Only `Month D, YYYY` with the full month name, and `YYYY-MM-DD`
  bounded by word boundaries (`kev:kev/api.py:62-63`).
- **Pattern test [here].** I ran a verbatim copy of that regex with `python3 -I`:
  - `2026-10-07T12:00:00Z` is **not** matched, because the "T" breaks the word boundary.
  - `Oct 7, 2026`, `07/10/2026` and `October 7 2026` are not matched.
  - `2026-10-07 12:00` and `due 2026-10-07.` are matched.
- **Growth [inf from code].** The number of sentences grows as n(n−1)/2 in the number of dates.
  - Kev's authors rejected `KEV_DATE_FACTS` as a default because it "pushes TypeSafe documents past
    the context" (`kev:PLAN.md:263-264`).
- **Effect [doc].** On deadline policy questions it took Kev-9B from 0.80 to 0.90, against Jev's
  0.93. It helps the larger models more than 0.8B (`kev:README.md:369`;
  `kev:docs/model-cards/kev-0.8b.md:280`).

### 1.9 Limits, truncation, validated context

- **Serving limits [code].** A state may hold up to 65,536 tokens, the `<state>` token included.
  The state plus one question row may reach 73,728 (`kev:kev/model.py:15-20`).
- **Training defaults [code].** `MAX_STATE`/`MAX_BRANCH`/`MAX_PACKED` = 384/1,024/2,048
  (`kev:kev/model.py:12-14`).
- **Over-length states [code/doc].** A longer state gets HTTP **422** with its token count. This
  became the default in Kev 1.0 ("No silent truncation", `kev:docs/releases/kev-1.0.md:34`;
  `kev:kev/model.py:130-142`; `kev:kev/serve.py:132-142`).
  - `KEV_TRUNCATE_STATES=1` keeps the **first** 65,536 tokens (`kev:kev/model.py:104`). Every
    response then carries `truncated` and `usage.state_tokens` / `state_tokens_used`
    (`kev:kev/serve.py:211-220`).
  - An over-long question row is a 422 either way.
- **Validated context [doc].** This is the longest CUAD contract length whose paired accuracy stays
  within −3 pp (95 % lower bound) of the 8k bucket. It is 8,192 tokens for 0.8B, 4B and 9B, and
  65,536 for 27B (`kev:README.md:38`, `:220`; `kev:docs/releases/kev-1.0.md:41`).
- **0.8B by length [doc].** CUAD accuracy is 0.711 at 8k, 0.659 at 16k (−5.2 pp [−8.5, −2.1]),
  and 0.637 at 64k (`kev:docs/model-cards/kev-0.8b.md:212-227`).
- **The fine-tune skill's own limit [doc/code].** Its data format still says states under about
  384 tokens, with whole records at most 2,048 tokens (`kev:skills/kev-finetune/references/data-format.md:25`,
  `:33`).
  - Its trainer call passes no `--max_state` (`kev:skills/kev-finetune/scripts/kev_modal.py:277-283`),
    so longer records are dropped (`:274`).
  - The local trainer accepts `--max_state` up to 65,536 (`kev:kev/train.py:413`;
    `kev:kev/model.py:24-26`).
  - The released small models used 7,552 (snapshot `training_config.json`).

### 1.10 Server process facts that matter on this box

- **One model thread [code].** It takes whatever is queued and runs it as one batch.
  - Real cross-request batching happens only with CUDA graphs. "Otherwise one request at a time"
    (`kev:kev/serve.py:93-100`, `:150-170`; `kev:kev/model.py:464-477`).
  - On CPU, concurrent Foundry calls therefore **serialize** [inf from code].
- **CPU defaults [code].**
  - dtype stays **fp32** on CPU. bf16 is the default only off-CPU (`kev:kev/serve.py:326-327`).
  - Attention is **eager** on CPU (`kev:kev/model.py:253`).
  - No fused DeltaNet or CUDA-graph path exists on CPU (`kev:kev/serve.py:328-331`).
  - flash-linear-attention is not installed in `/opt/kev-venv` [here].
- **Auth and network [code].**
  - The server binds `127.0.0.1` by default (`kev:kev/serve.py:319`).
  - It is open unless `KEV_API_KEY` is set. Then it requires `Authorization: Bearer <key>` on
    `/v1/*` (`kev:kev/serve.py:33`, `:232-242`).
  - CORS allows every origin (`kev:kev/serve.py:229`).
  - Every response carries `x-typesafe-request-id` (`kev:kev/serve.py:240`).
- **Model names [code].**
  - `/v1/models` lists `kev-latest` and `jev-latest`, both served by the one checkpoint
    (`kev:kev/serve.py:35`, `:298-312`).
  - The request's `model` field is **not validated**. It is only echoed back
    (`kev:kev/api.py:45`; `kev:kev/serve.py:216`).
  - `/v1/models` also reports `run`, `base`, `lora`, `device`, `backend`, `dtype`, `temperature`,
    `max_state_tokens`, and prefix-cache and batch statistics.

---

## 2. Reported quality

### 2.1 Headline accuracy against Jev [doc]

All Kev numbers use the fp32 evaluation path at the shipped T. Cells are development / test.
Jev was read on development partitions only (`kev:README.md:40-48`;
`kev:docs/releases/kev-1.0.md:16-24`).

| | 0.8B | 4B | 9B v2 | 27B v2 | Jev |
|---|---|---|---|---|---|
| New sources, transfer-v4 accuracy | 0.648 / 0.697 | 0.817 / 0.838 | 0.820 / 0.852 | 0.851 / 0.889 | 0.857 / – |
| Trained sources, decision-v7 accuracy | 0.827 / 0.838 | 0.873 / 0.865 | 0.874 / 0.873 | 0.865 / 0.866 | 0.845 / – |
| Brier, new sources | 0.481 / 0.416 | 0.269 / 0.242 | 0.289 / 0.217 | 0.225 / 0.156 | 0.211 / – |
| breadth-v1 test chance-corrected index (14 held-out datasets) | 23.3 | 38.0 | 41.0 | 52.3 | 54.0 |
| hard-v1 test (trained skill families) | 0.665 | 0.803 | 0.834 | 0.918 | dev 0.777 |
| devtools-v1 test | 0.637 | 0.756 | 0.791 | 0.790 | dev 0.713 |
| documents-v1 test (CFPB complaints, trained) | 0.851 | 0.903 | 0.900 | 0.908 | dev 0.868 |
| MMLU-Pro (transfer-v9 dev) | 0.230 | 0.565 | 0.590 | 0.675 | 0.840 |

- Kev's author warns that hard-v1, devtools-v1 and documents-v1 have training splits every Kev
  trained on. Those rows "measure held-out items of trained families, not transfer"
  (`kev:docs/releases/kev-1.0.md:26`).
- **Per source on transfer-v4 development [doc/run].** From `kev:docs/kev-family-summary.json`,
  which feeds the README chart (`kev:README.md:214`). Columns are 0.8B / 4B / 9B / 27B / Jev:

  | Source | 0.8B | 4B | 9B | 27B | Jev |
  |---|---|---|---|---|---|
  | sciq | 0.90 | 0.975 | 0.95 | 0.96 | 0.99 |
  | qnli | 0.81 | 0.91 | 0.93 | 0.94 | 0.93 |
  | tweet_offensive | 0.675 | 0.75 | 0.85 | 0.775 | 0.81 |
  | paws (paraphrase) | 0.60 | 0.79 | 0.76 | 0.76 | 0.79 |
  | emotion | 0.50 | 0.55 | 0.575 | 0.59 | 0.59 |
  | mmlu | 0.425 | 0.725 | 0.725 | 0.90 | 0.90 |
  | contrastive_deadline (date arithmetic) | 0.35 | 0.65 | 0.725 | 0.925 | 0.925 |
  | contrastive_authorization | 0.95 | 1.0 | 1.0 | 1.0 | 1.0 |
  | composition held_or_not (rule with "not") | 0.5625 | 0.9375 | 0.969 | 0.906 | 0.969 |
  | composition held_and_or | 0.656 | 1.0 | 0.8125 | 0.906 | 0.906 |
  | composition held_conditional | 0.656 | 1.0 | 0.906 | 0.906 | 0.781 |

### 2.2 Calibration and automation at an error budget

- **Temperatures [doc].** 0.8B 2.35, 4B 2.41, 9B 2.19, 27B 1.32 (`kev:README.md:58-63`).
  - 0.8B and 4B fitted theirs on in-distribution development rows. 9B and 27B fitted on a pool of
    648 questions from held-out datasets (`kev:README.md:367`).
  - A refit on that held-out pool was rejected for 0.8B. It improved held-out ECE from 0.048 to
    0.037 but worsened the trained families by more than the registered tolerance. Users whose
    workload resembles held-out datasets "can serve it at the refit value with
    `KEV_TEMPERATURE=2.52`" (`kev:docs/model-cards/kev-0.8b.md:243`).
- **0.8B ECE at shipped T [doc].** 0.042 on breadth-v1 test, 0.045 on transfer-v4 locked, 0.125 on
  hard-v1 test, 0.071 on documents-v1 test (`kev:docs/model-cards/kev-0.8b.md:229-241`).
- **High-confidence errors** (p ≥ 0.9 and wrong, share of all questions):
  - [doc] 9B is served at 2.4 % on new sources against Jev's 3.7 %. Temperature took 9B from 8.2 %
    to 2.4 % (`kev:README.md:216`, `:367`).
  - [doc] 4B locked: 1.5 %. 9B locked: 1.4 % (`kev:docs/model-cards/kev-4b.md:181`;
    `kev:docs/model-cards/kev-9b.md:184`).
  - [run] 0.8B: 0.15 % on transfer-v4 dev and 0.0 % on transfer-v4 locked, from
    `kev:runs/release/kev-08b-r15.json` → `candidate.transfer_dev`, `candidate.locked_transfer`.
  - Read together with the low coverage below: out of domain, 0.8B is rarely confident at all.
- **Coverage at ≤ 5 % error** (the share that can be automated):
  - [doc] Out of domain: 0.8B 0.145 (dev) and 0.274 (locked). 4B 0.620 (dev) and 0.701 (locked).
    9B 0.742 (locked). Jev 0.70 (`kev:docs/model-cards/kev-0.8b.md:183`, `:282`;
    `kev:docs/model-cards/kev-4b.md:181`, `:281`; `kev:docs/model-cards/kev-9b.md:184`;
    `kev:README.md:216`).
  - [run] 0.8B in distribution: documents-v1 test 0.616, hard-v1 test 0.192, devtools-v1 test 0.282
    (`kev:runs/release/kev-08b-r15.json` → `candidate.docs1_test` / `hard_test` / `devtools_test`).
  - These are in-sample maxima over thresholds, "not a deployed error guarantee"
    (`kev:kev/benchmark.py:94-96`).
- **Why one T is not enough [doc].**
  - "A single temperature cannot reorder confidences" (`kev:README.md:413`).
  - "A temperature fitted on easy in-distribution rows does not transfer to hard or distant
    workloads". A workload refit took 9B's ECE on WANLI from 0.131 to 0.037 (`kev:PLAN.md:204-216`).
  - Per-type and per-K temperatures, and a logistic reliability head, made things *worse*
    (`kev:PLAN.md:209-210`).

### 2.3 Abstention, "none of these", minimal pairs [run]

All rows are on transfer-v4 development, from the same `result.json` / `report.json` files as §1.7.

| | 0.8B | 4B | 9B v2 | 27B v2 | Jev |
|---|---|---|---|---|---|
| "None of these" **added**, right answer still present (`none_present`, n = 36) | **0.472** | 0.556 | 0.694 | 0.667 | 0.75 |
| Right answer **removed**, "None of these" is correct (`none_absent`, n = 36) | 0.861 | 0.889 | 0.861 | 1.0 | 0.806 |
| Held-out policy minimal pairs, both siblings right (64 pairs) | **0.422** | 0.812 | 0.797 | 0.906 | 0.859 |

- The variants are defined in `kev:kev/suite.py:253-284`. The "None of these" option text is "None
  of these options describes the answer".
- **Unanswerable items [doc/run].**
  - Items whose deciding evidence was removed are answered with p ≥ 0.9 at rate 0.00 by every Kev,
    against Jev's 0.09 (`kev:README.md:365`).
  - 0.8B's mean max p on those items is 0.45, against 0.91 on intact controls. 98 % are less
    confident than their control (`kev:runs/r15-08b-a-v9/report.json` → `unknowable`, raw T = 1).

### 2.4 Known weaknesses and failure modes

- **Date arithmetic [doc/run].**
  - `deadline` accuracy is 0.35 / 0.65 / 0.725 for 0.8B / 4B / 9B, against Jev's 0.95
    (`kev:docs/releases/kev-1.0.md:50`).
  - The cause is LoRA training eroding the base's skill. Stating the day count fixes the readout
    (`kev:PLAN.md:235-239`; `kev:README.md:369`, `:415`).
  - hard-v1 `temporal_numeric` on development: 0.8B 0.474, 4B 0.595 (`kev:runs/r15-08b-a-hard/report.json`,
    `kev:runs/r10-4b-skills-hard/report.json` → `tasks`).
- **Numbers and probability [run].** hard-v1 `probability` (expected value) on development: 0.8B
  0.548, 4B 0.742. Even Kev-27B's weakest JevBench family is `temporal_numeric`, at 0.07
  (`kev:PLAN.md:239`).
- **Rule composition and negation [doc/run].**
  - 0.8B gets both minimal-pair siblings right 0.422 of the time ("Rule composition is weak",
    `kev:docs/model-cards/kev-0.8b.md:281`).
  - The held-out structure containing `not` scores 0.5625 at 0.8B and ≥ 0.9 at 4B and above (§2.1).
  - No metric isolates negation alone [unk]. The rule generator's shapes and splits are in
    `kev:kev/composition.py:8-26`.
- **Knowledge [doc].** It is set by the base. MMLU-Pro is 0.230 at 0.8B, and 0.8B's paraphrase
  ability is "near the untrained base" (`kev:docs/model-cards/kev-0.8b.md:276`;
  `kev:PLAN.md:232-234`).
- **Long contexts [doc].** 0.8B, 4B and 9B are validated only to 8,192 tokens (§1.9). Burying a
  short state in 1–4k tokens of unrelated text cost 22–43 pp before targeted training
  (`kev:PLAN.md:244-247`).
- **Tool-call routing [doc].** 0.8B's When2Call accuracy fell to 0.167 dev and 0.133 test, which is
  below chance. The card says: "Do not use it for tool-call routing"
  (`kev:docs/model-cards/kev-0.8b.md:109`, `:252`, `:278`). 4B scores 0.660
  (`kev:docs/model-cards/kev-4b.md:247`).
- **Prompt-injection detection [doc/run].**
  - devtools-v1 development, an evaluation-only source: 0.8B 0.547, 4B 0.753, Jev 0.893
    (`kev:docs/model-cards/kev-0.8b.md:253`; `kev:docs/model-cards/kev-4b.md:247`).
  - guardrails-ood-v1, with held-out carriers and wordings (`kev:evals/guardrails-ood-v1/manifest.json`
    → `description`):
    - Injection by carrier: 0.8B 0.41–0.46, 4B 0.63–0.73, 27B v2 ≈ 1.0.
    - Grounding: 0.8B 0.578, 4B 0.704, 27B v2 0.960.
    - PII: 0.8B 0.492, 4B 0.652, 27B v2 0.998.
    - Sources: `kev:runs/r28-08b-r15-guardood/report.json`, `kev:runs/r28-4b-r10-guardood/report.json`,
      `kev:runs/r23-27b-k-w85-guardood/report.json` → `tasks`. The records report `temperature: 1.0`,
      but accuracy does not depend on T.
    - 27B v2 trained on these components' in-family data (`kev:docs/model-cards/kev-27b.md:157-170`).
      0.8B and 4B did not.
- **Agent-session logs [run].** agents-ood-v1 holds 373 code-generated sessions, 2,084 questions,
  over a held-out world and trace format.
  - Accuracy: 0.8B 0.655 (coverage at 5 % error 0.091), 4B 0.847, Kev-27B v1 0.967, Kev-27B v2 0.988
    (`kev:runs/r28-08b-r15-agentsood/report.json`, `r28-4b-r10-agentsood`, `r21-P27-agentsood`,
    `r23-27b-k-w85-agentsood`).
  - Its states have a median of 12,666 tokens and a p90 of 27,435 (`kev:evals/agents-ood-v1/manifest.json`
    → `files.development.jsonl.state_tokens`). That is well past 0.8B's validated 8k.
- **Flaky tests [doc/run].** FlakeFlagger labels are "not determined by the state" and were
  excluded from audited panels (`kev:docs/model-cards/kev-0.8b.md:270`). 0.8B's test jump
  (0.507 → 0.813) is "unexplained, not a skill" (`:279`). No evidence supports classifying flakes
  from text.
- **Generalisation of gains [doc].** Kev's own gains are in distribution. JevBench's hard tier moved
  only +2.7 pp [−1.8, +7.2] for the 0.8B documents-and-skills stage
  (`kev:docs/model-cards/kev-0.8b.md:277`).
- **Numerics on CPU [doc].**
  - CPU reads run no Triton or causal-conv1d kernels. They "differ from CUDA reads" by up to about
    0.003 in p from TF32 DeltaNet, and 6e-4 to 0.06 from the convolution kernel depending on size
    (`kev:AGENTS.md:430-437`).
  - Published fp32 numbers should transfer to CPU fp32 up to small probability drift [inf].

### 2.5 Evaluation suites we could rerun (development splits only)

| Suite | In this clone? | Size (dev) | Relevance to Foundry | Notes |
|---|---|---|---|---|
| `evals/v4/transfer-v4` | yes | 764 records | general out-of-domain baseline. Reproduces the 0.648 | `kev:README.md:355`, `:359-362` |
| `evals/v9/transfer-v9` | yes | 1,264 records | adds unknowable and buried records, MMLU-Pro | `kev:README.md:356` |
| `evals/v7/decision-v7` (dev, calibration) | yes; **train is not** (Hub mirror) | 1,204 / 968 records | in-distribution baseline; replay source | train partition 12,576 records via `SUITES_REVISION` (`kev:kev/suite.py:39`) |
| `evals/hard-v1` dev | yes | 700 records / 1,083 questions | judging a proposed answer, long policies, abstention | `kev:evals/hard-v1/manifest.json` |
| `evals/devtools-v1` dev | yes (train too) | 900 / 1,074 | code review, commit type, injection, When2Call | licences in `kev:scripts/devtools_v1_licences.json` |
| `evals/documents-v1` dev | yes | – | real long-ish documents | – |
| `evals/diagnostics/binding-v1` | yes | 560 records | role binding and elapsed-days strata, code labels | `kev:scripts/build_binding_diagnostic.py:1-12` |
| `evals/external/semif-v1` | yes | 144 authored decisions | near saturation; sanity only | `kev:README.md:375-377` |
| breadth-v1, tasksource-heldout-v1, longdoc-v1, agents-ood-v1, guardrails-ood-v1, documents-v2 | **no**: private mirror `jaredpalmer/kev-private-evals` | – | the most Foundry-like suites (agents, guardrails) | breadth-v1 is private because "licences forbid public redistribution" (`kev:.gitignore:191-192`) |

- **Command [doc/code].**
  `python -m kev.benchmark --remote http://127.0.0.1:8008 --suite <dir> --out <dir>` scores any
  System One endpoint (`kev:kev/benchmark.py:1-8`, `:173-185`).
- **Cost on CPU [inf].** At about 0.5–1.4 s per short record (§3.2), transfer-v4 development takes
  roughly 10–20 minutes.
- **Calibration refits [code].** `kev.calibrate` refuses remote rows, because it needs recorded
  logits (`kev:kev/calibrate.py:32-34`). A temperature refit therefore needs a local
  `kev.benchmark --run` read, or Foundry's own fit (§6.3).

---

## 3. Speed and resources

### 3.1 Documented, per size and device [doc]

Model time per request, median of 20, for a new state / the same state again
(`kev:README.md:383-409`; cards).

| Size | Device | 6 questions, short state | 5 questions, 2,200-token state | Memory |
|---|---|---|---|---|
| 0.8B | L4, bf16 | 22.7 / 16.1 ms | 108.6 / 32.3 ms | 3.8 GB resident (`kev-0.8b.md:257`) |
| 0.8B | M5 MLX, 5 questions, ~270 tokens | 149 / 28 ms | 8k state: 1.4 s / 74 ms; 65k state: 21.2 s / 202 ms | 2.7–3.8 GB peak (`kev-0.8b.md:259-266`) |
| 4B | L40S / H100, bf16 | 41.5 / 27.7 ms; 18.1 / 12.9 ms | 145.2 / 43.0 ms; 89.4 / 22.5 ms | 14.3 GB GPU resident (`kev-4b.md:258`) |
| 4B | M5 MLX | 721 / 136 ms | 65k state: 84.5 s / 716 ms | 10.2–13.0 GB peak (`kev-4b.md:260-267`) |
| 4B | M5, **torch bf16** (no DeltaNet kernels on MPS) | 3,302 / 847 ms, 5 questions | – | – (`kev:AGENTS.md:269`) |
| 9B | L40S / H100 | 66.4 / 42.7 ms; 24.0 / 16.6 ms | 235.6 / 57.5 ms; 88.5 / 26.4 ms | 21.9 GB GPU; 19.3 GB bf16 backbone (`kev-9b.md:248`; `kev:AGENTS.md:269`) |
| 27B | B200 / H200 / H100 | 46.5–75.0 ms new | 178–277 ms new | 51 GB weights, ~66 GB resident (`kev:README.md:396`) |

- **No x86 CPU numbers [unk].** Kev documents **no latency for an x86 CPU**. The only CPU statements
  are about numerical parity (`kev:docs/model-cards/kev-0.8b.md:268`) and memory behaviour
  (`kev:AGENTS.md:426`).

### 3.2 This VM

- **Hardware [here].** 4 cores (Intel Xeon @ 2.10 GHz, one thread per core). CPU flags include
  `avx512f`, `avx512_bf16`, `amx_bf16` and `amx_tile`. RAM is 15 GB total with about 11 GB
  available, no swap, no GPU.
- **Kev process [here].** PID 22454 holds 3.63 GB RSS for 0.8B in fp32. The base safetensors on
  disk are 1.7 GB in bf16. torch reports 4 intra-op threads.
- **Prior Foundry records [F-rec].**
  - "smoke: 3 typed questions in 1.4 s" (`fdy:research/manifests/models.json:70`).
  - `fdy:research/distill-20261007/DESIGN.md:21` and `fdy:docs/RESEARCH.md:114` instead say
    "≈ 1.4 s **per question**".
  - The two phrasings disagree by about 3×. Both rest on one smoke. The latency study running now
    should supersede both.

### 3.3 What fits [inf, arithmetic shown]

| Size | fp32 on this box | bf16 on this box | Verdict |
|---|---|---|---|
| 0.8B | works today (3.6 GB) | about 1.7 GB weights; AMX may speed it [unk] | **Usable.** bf16 trades ≤ 0.03–0.05 in p and about 1 flip in 300 on GPU/Mac (`kev:README.md:409`); CPU unmeasured. |
| 4B | ~17–18.6 GB weights alone. The fp32 reference "did not fit" a 32 GB Mac with other load (`kev:AGENTS.md:269`). | 8.4 GB weights (`kev:README.md:407`), plus the LM head staged by `AutoModelForCausalLM` during load (`kev:kev/model.py:257`), plus activations | **Borderline.** Only with the 0.8B server stopped. Load memory and speed unmeasured. Likely several seconds per request [inf: about 5× the 0.8B compute]. |
| 9B | no | 19.3 GB backbone | **Does not fit.** |
| 27B | no | 51 GB | **Does not fit.** |

- **Other levers.** Kev has no quantization path: no int8, GGUF or ONNX code or docs [code: grep
  found none]. `LoadOptions.lora_scale` exists for WiSE-FT-style interpolation, but that is not a
  memory lever (`kev:kev/checkpoint.py:104`).

### 3.4 CPU-specific limits [inf from code]

- **Eager attention materializes L × L scores.** On CPU attention stays eager
  (`kev:kev/model.py:253`; `kev:AGENTS.md:426`: "on CPU / MPS attention stays eager and exact and
  still materialises L x L"). Qwen3.5-0.8B has 8 heads in each of its 6 full-attention layers
  (base `config.json`, read [here]). The score tensor for one layer is 8·L²·4 bytes:
  - about 2.1 GB at L = 8,192, plus a softmax copy;
  - about 8.6 GB at L = 16,384, which, with a softmax copy and 3.4 GB of weights, exceeds this box.

  So on this VM a 0.8B state is practically limited to roughly 8–12k tokens. That happens to match
  its validated context. Verify by measurement.
- **No batching.** Foundry's parallel nodes queue behind one another (§1.10). Throughput ≈ 1/latency.
- **Shared cores.** Kev uses all 4 cores per pass, so it competes with tests, node runners and the
  latency agent.

---

## 4. Fine-tuning

### 4.1 Data format [doc/code]

One JSON object per line, in the request shape with a `label` on every question
(`kev:README.md:169-180`; `kev:kev/data.py:362-386`; `kev:skills/kev-finetune/references/data-format.md:1-33`).

```jsonl
{"state": {"subject": "...", "body": "..."},
 "questions": {
   "team":     {"type": "choice", "instructions": "...", "criteria": {"billing": "Payments and refunds", "access": null}, "label": "billing"},
   "angry":    {"type": "noul",   "instructions": "...", "label": false},
   "priority": {"type": "score",  "instructions": "...", "criteria": ["low", "normal", "high"], "label": 1},
   "unclear":  {"type": "noul",   "instructions": "...", "label": false, "target": {"true": 0.5, "false": 0.5}}}}
```

- **Labels.**
  - `choice`: the option name.
  - `noul`: `true` or `false`.
  - `score`: the 0-based level index.
- **Soft labels.** An optional `target` is keyed by option name, `"true"`/`"false"`, or level index
  as a string. It is normalized, with mass only on named options. It is meant for "no evidence, no
  confidence" records (`kev:kev/data.py:404-409`; `data-format.md:31`).
- **Validation.** Missing labels and empty `questions` are rejected (`kev:kev/data.py:376-379`).
  Identical states with different labels are dropped as conflicts (`data-format.md:44`).
- **Bound strings.** "The fine-tune binds those exact strings to the behaviour; paraphrases at
  serving time still work but gain less" (`data-format.md:39`;
  `kev:skills/kev-finetune/SKILL.md:61-62`).

### 4.2 Recipe

- **Released small models [doc].**
  - Stage 1: two epochs on decision-v7 (12,576 records). LoRA r16 α32. lr 1e-4 for 0.8B, 5e-5 for
    4B and 9B. One-cycle schedule.
  - Then one-epoch deltas from the released checkpoint (lr 2e-5 to 4e-5), each replaying 2,000 to
    10,000 decision-v7 records.
  - Then one temperature (`kev:README.md:306-310`; `kev:docs/model-cards/kev-0.8b.md:150-155`).
- **User delta, by hand [doc/code].**
  `kev.train --data train.jsonl --init_from jaredpalmer/kev-<size> --epochs 2 --lr 2e-5 …`
  (`kev:README.md:185-194`).
  - `--init_from` warm-starts the LoRA and the pointer head, and checks base, revision, rank and
    head size. Example: starting from the base scored 0.33 on Kev's evaluation, starting from the
    released model kept 0.83 and reached 0.88 on the new domain (`kev:README.md:192`).
  - `--replay N` with `--suite` mixes in N suite training records (`kev:kev/train.py:414`).
- **Skill defaults on Modal [code/doc].**
  - One epoch with replay 2,000 (`kev:skills/kev-finetune/scripts/kev_modal.py:511`; `SKILL.md:94-98`).
  - lr = the init checkpoint's own lr, capped at 5e-5 (`kev_modal.py:42`, `:264-267`). The doc says
    "4e-5 for kev-0.8b" (`kev:skills/kev-finetune/references/hill-climbing.md:52`), but the cached
    v1.0 snapshot's args record lr 2e-5 [here]. The doc is stale.
  - **Temperature refit** by minimum NLL on `calibration.jsonl`, written into the checkpoint
    (`kev_modal.py:294-297`). The baseline gets the same refit for a fair comparison
    (`SKILL.md:152-154`).
  - "Never fit the temperature on `development.jsonl`" (`SKILL.md:150`).
  - The default split is 70/15/15, with at least 40 records each in calibration and development
    (`data-format.md:58`). At least about 100 questions are needed for a stable T
    (`kev:skills/kev-finetune/references/data-generation.md:80`;
    `kev:skills/kev-finetune/scripts/plan_size.py:40`).
- **Recorded negative results [doc].** These levers were tried and failed: calibration losses
  (smoothing, Brier, focal), anchoring, option isolation, `perm_kl`, `ord_w`, checkpoint averaging,
  a reliability head, and 9B → 0.8B distillation (`kev:PLAN.md:255-273`).
  - What worked: soft targets beat hard labels (`kev:PLAN.md:240-243`), and joint rather than
    stacked deltas at 0.8B (`kev:PLAN.md:194-197`).

### 4.3 Documented gains and data sizes [doc]

- **Example workload.** 3 questions, 1,050 LLM-generated records, Kev-4B, 15 min on an H100.
  - Accuracy 67.7 % → 73.6 % (gain CI +2.3 to +9.7).
  - Brier 0.402 → 0.330.
  - Coverage at 5 % error 34 % → 48 %.
  - With **400 records the gain was inside the noise** (`kev:skills/kev-finetune/README.md:46-50`;
    `kev:README.md:157`).
- **Real data.** One epoch on 5,219 CFPB complaints took Kev-4B from 0.804 to 0.904 on unseen
  complaints (`kev:README.md:157`). The 0.8B documents-and-skills stage gained +24.4 pp on
  documents-v1 test (`kev:docs/model-cards/kev-0.8b.md:201-210`).
- **Sizing.**
  - 100–200 records: smoke only.
  - 300–600: first real run.
  - 1,000–3,000: production (`data-format.md:52-56`).
  - `plan_size.py` uses the McNemar formula. It gives about 1,000 records for a +5 pp target with
    3 questions per record (`plan_size.py:25-28`; `SKILL.md:74-78`).
- **Diminishing returns.** More data from the same generator: +26 pp for the first 6,000 hard-v1
  records, +5 pp for the next 12,000 (`kev:PLAN.md:196-197`).
- **Forgetting.** Accept about −2 pp on public replay. More than that means lowering lr and keeping
  replay (`kev:skills/kev-finetune/references/hill-climbing.md:32`). At 0.8B a delta cost about
  1 pp of short-state accuracy (`kev:PLAN.md:189-193`).

### 4.4 Compute: Modal dependence against the local path

- **Packaged path [doc].** Modal plus one H100: "$1-3 per run" (`kev:skills/kev-finetune/SKILL.md:5`).
  - About $1 per Kev-4B run (`kev:README.md:165`).
  - 0.8B base recipe: about 20 min on an H100. The documents-and-skills stage took 52 min on an H200
    (`kev:docs/model-cards/kev-0.8b.md:295-296`).
  - Modal and Hugging Face are **external accounts**. AGENTS.md forbids account changes without the
    owner, so this route is an owner decision.
- **Local path [code].**
  - `kev.train --device cpu` is allowed (`kev:kev/train.py:389`).
  - `--dtype bf16` autocast is **CUDA-only** (`kev:kev/train.py:391`, `:443-444`), so CPU training
    runs in fp32.
  - `--weights_dtype bf16`, which halves backbone memory, is not CPU-gated in the argument checks
    (`kev:kev/train.py:392-393`). But the released small models trained with fp32 weights, so a bf16
    delta is untested [unk].
  - Replay needs the decision-v7 train partition from the Hub dataset mirror
    (`kev:kev/suite.py:39`). That is a download.
- **CPU estimate for a 0.8B delta [inf].** Assumptions:
  - The [F-rec] smoke implies roughly 0.1–0.2 TFLOP/s effective: about 0.55B non-embedding
    parameters × 2 FLOPs × ~150 tokens in 1.4 s.
  - Training costs about 3× inference.
  - The row form re-runs the state for each question, because `shared_prefix` defaults off for LoRA
    (`kev:kev/train.py:440`).

  Then a 300-token state with 2 questions costs about 2 × 10¹² FLOPs, which is **about 10–20 s per
  record**. 1,000 records ≈ 3–6 h per epoch. Adding the skill's default 2,000 replay records gives
  roughly 9–17 h.
  - This is an order-of-magnitude estimate from one uncertain smoke. A `--max_steps` probe would
    settle it; it was not run, per instruction.
  - A 4B delta on CPU is not feasible: fp32 weights alone exceed RAM.
- **Serving a fine-tuned run [doc/code].**
  - Locally: `kev.serve --run <checkpoint dir>` (`kev:README.md:189`;
    `kev:skills/kev-finetune/references/deploy.md:68-76`). The fitted T travels in `head.pt`.
  - On Modal: `KEV_SERVE_RUN=<run> modal deploy scripts/kev_modal.py`, on an L4 by default
    (`deploy.md:14-19`).
  - "Thresholds and temperature are per checkpoint: re-read them after every retrain"
    (`SKILL.md:153-154`).

### 4.5 What Foundry would need to fine-tune from its ledger [code + inf]

- **The ledger cannot be converted today [code].** Each `judgment` row stores `port, engine, model,
  split, requestHash, options, probabilities, chosen, confidence, latencyMs, meta`. It does **not**
  store the state, question or criteria text (`fdy:src/judgment.mjs:80-85`).
  - A content-addressed store of the request keyed by `requestHash` is the missing piece.
  - Labels are already option names (`fdy:src/judgment.mjs:86-89`), which is exactly Kev's `choice`
    label.
- **Instruction wording [code + inf].** Foundry builds the instructions as
  `question + "\nCriteria:\n- …"` (`fdy:src/judgment.mjs:56-58`). A fine-tune binds that exact
  text (§4.1). Any edit to a port's question or criteria wording invalidates the fine-tune's
  advantage and should trigger re-qualification (`fdy:docs/ROADMAP.md:501-502`).
- **Label provenance [inf].** Labels from executable oracles, replay and control builds are the
  cleanest Kev-style "programmatic" labels (`kev:skills/kev-finetune/references/data-generation.md:64-69`).
  If hosted-model outputs were used as training labels, the provider's terms would need checking;
  that is not checked here.

---

## 5. Licence, provenance, and TypeSafe/Jev compatibility

### 5.1 Licences

- **Code [code].** Apache-2.0 (`kev:LICENSE:1-4`; `kev:pyproject.toml:10-11`).
- **Weights [doc].** Every card says the adapter and head are "Apache-2.0 … the base model is
  Apache-2.0" (`kev:docs/model-cards/kev-0.8b.md:86`, `kev-4b.md:81`, `kev-9b.md:79`). The README
  says the same of the Qwen bases (`kev:README.md:464-466`).
- **Training data [doc + gap].** "Training datasets have their own licenses" (`kev:README.md:466`).
  - The decision-v7 manifest records dataset **revisions only**, not licences
    (`kev:evals/v7/decision-v7/manifest.json` → `dataset_revisions`).
  - Its sources include `Yelp/yelp_review_full` and `SetFit/amazon_reviews_multi_en`
    (`kev:docs/model-cards/kev-4b.md:21`, `:24`). Their upstream terms may restrict commercial use
    [unk: not verified here; check the dataset cards before any redistribution or commercial claim].
  - Whether such terms bind adapter weights trained on them is a legal question this dossier does
    not answer.
- **Kev-27B only [doc].** Training used four CC-BY-SA datasets, and GLM-5.3 generations whose
  licence carries "a condition on very large model-as-a-service operators"
  (`kev:docs/model-cards/kev-27b.md:172`). This does not affect our 0.8B use.
- **Use restrictions [inf].** The cards list out-of-scope uses: consequential automated decisions
  about people without review, and text generation (`kev:docs/model-cards/kev-0.8b.md:106-111`).
  These are guidance, not licence terms.
- **Foundry's record.** The acquisition record already lists Apache-2.0 for the repo and the weights
  (`fdy:research/manifests/models.json:53-71`).

### 5.2 Provenance pins

- **Kev 1.0 weight revisions [doc].** 0.8B `9a45d25e` (v1.0 tag at card commit `bf75a6a8`), 4B
  `139fdd94`, 9B `b5d8c18e`, 27B `28be62e9` (`kev:docs/releases/kev-1.0.md:7-12`, `:77-85`).
  - Adapter and head hashes: 0.8B `9b908623…` / `f400bd12…`, with T = 2.3511
    (`kev:docs/model-cards/kev-0.8b.md:303`).
- **Pin drift [code/doc].** The deploy and fine-tune skills pin `KEV_REF = 84847f0a…`
  (`kev:skills/kev-deploy/scripts/kev_serve.py:31`; `kev:skills/kev-finetune/scripts/kev_modal.py:32`).
  The release notes say the pin is `71d4829` (`kev:docs/releases/kev-1.0.md:34`, `:113`).
  - The shallow clone cannot resolve either commit [here].

### 5.3 TypeSafe / Jev API compatibility

- **Same wire format [doc/code].** `POST /v1/systemone {state, model, questions}` and
  `GET /v1/models`. "The TypeSafe Python SDK works against a Kev server unchanged"
  (`kev:README.md:19`, `:122-151`).
- **TypeSafe SDK 0.7.2, installed in `/opt/kev-venv` [code].**
  - Default base URL `https://api.typesafe.ai` and default model `jev-latest`.
  - Environment variables `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`, `TYPESAFE_DEFAULT_MODEL`.
  - **Default timeout 10 s** (`typesafe_sdk/constants.py:3-21`).
  - Auth header `Authorization: Bearer <key>` (`typesafe_sdk/_core/transport.py:121`).
  - Path `/v1/systemone` (`typesafe_sdk/_core/constants.py:5`).
  - Kev accepts any `model` string, and its `/v1/models` lists `kev-latest` and `jev-latest` (§1.10).
- **Through the Vercel AI SDK [code/doc].** Jev is model `typesafe-ai/jev`, and question type
  `noul` is sent as `"boolean"` (`kev:playground/scripts/jev-evaluate.mjs:10-14`;
  `kev:skills/kev-finetune/references/deploy.md:121-126`).
  - Through the gateway, a noul answer arrives as `probability` rather than `noul`
    (`kev:kev/predictors.py:329-330`).
- **Jev limits recorded by Kev's author [code/doc].**
  - Context of 32,768 tokens (`kev:kev/predictors.py:263`; `kev:kev/model.py:15`).
  - List price $0.042 per M input tokens (`kev:kev/predictors.py:210`).
  - Both are second-hand. They are not TypeSafe documents read here.
- **Foundry's client [code].** `fdy:src/judgment.mjs` speaks this format directly.
  - Bearer token from `FOUNDRY_SYSTEMONE_API_KEY`. 120 s timeout. Status mapping:
    401/403 → `MODEL_AUTH`, 422 → `MODEL_CONTEXT`, 429 → `MODEL_QUOTA` (`fdy:src/judgment.mjs:11-51`).
  - Hosted Jev is unavailable: no `TYPESAFE_API_KEY` (decision D7, `fdy:README.md:123`).

---

## 6. Relevance to Foundry's judgment ports

**Ground rules [doc].** Judgments "rank and gate", never hold authority. Every judgment is logged
with its verified outcome. A port gates only after its engine beats code and embedding baselines
on held-out labels (`fdy:docs/THESIS.md:221-227`; `fdy:docs/ROADMAP.md:351-368`; C4 at
`fdy:docs/ROADMAP.md:643`).

### 6.1 Port by port

1. **Applicability** (`fdy:docs/THESIS.md:212`). Does task T satisfy workflow W's preconditions?
   - Closest Kev evidence [doc/run]:
     - Policy and eligibility checks over stated rules, which is the core training family
       (`kev:docs/model-cards/kev-4b.md:97`).
     - Missing-evidence abstention: p ≥ 0.9 on 0 % of unknowable items (§2.3).
     - `bfcl_irrelevance` (does any offered tool fit?) on breadth-v1 dev: 0.706 / 0.475 (live) for
       0.8B, against 0.941 / 0.80 for 4B (`kev:runs/fam-08b-breadth/report.json`,
       `kev:runs/fam-4b-breadth/report.json` → `tasks`).
   - Against it: rule composition is weak at 0.8B (0.422 for both siblings; §2.3).
   - Design implication [inf]: ask **one `noul` per precondition** in one request, sharing the
     state. Combine them **in code**. Do not ask one composite question. This keeps procedure in
     code (THESIS) and avoids Kev's composition weakness.
   - The 0/21 false-success history (`fdy:docs/THESIS.md:205-206`) is exactly the failure
     abstention training targets. It is unmeasured on Foundry states [unk].
2. **Drift / expectation** (`:213`). Is the observed state what step k expects?
   - Closest evidence [run]: guardrails grounding, "whether a claim is supported by a document": 0.8B
     0.578, 4B 0.704, 27B v2 0.96 (§2.4).
   - At 0.8B this is weak. Use `noul` per expectation and treat Kev as an ordering hint for the
     adaptation ladder, not a detector [inf].
3. **Choice / selection with propensities** (`:214`; `fdy:docs/ROADMAP.md:522-527`).
   - `choice` gives a full distribution over 1–255 candidates.
   - **Trap [inf].** "The distribution *is* the logged propensity" holds only if the action is
     **sampled** from Kev's distribution at its logged temperature. Under argmax plus ε-exploration
     the propensity is `(1−ε)·1[a = argmax] + ε/|A|`, not Kev's p.
   - Kev's p also moves with option order (5.6 % flips; §1.7) and with T. Log the option order, the
     T and the weights revision with each decision. Re-qualify on change
     (`fdy:docs/ROADMAP.md:501-502`).
   - `toolret` and `bright` retrieval-style choices are weak at 0.8B: 0.493 and 0.36 on breadth-v1
     dev [run].
4. **Failure class** (`:215`; classifier order `fdy:docs/ROADMAP.md:421-434`).
   - Kev never trained on a flake / variance / defect / env / impossible / finding taxonomy.
   - FlakeFlagger was excluded as label-indeterminate (§2.4).
   - Agent-session-log questions reach 0.655 at 0.8B, on states longer than 0.8B's validated length.
   - Use is low-risk, because the judgment only **orders** checks and replay decides. Zero-shot lift
     is likely small. This port is the best **fine-tune** candidate, since replay outcomes give free
     labels [inf].
5. **Verifier, ordered score** (`:216`).
   - Kev's hard-v1 `judge` family (judging a proposed answer): 0.8B 0.66, 4B 0.84 on development
     [run].
   - **Trap [code].** `score.score` is the expected level index and `score.confidence` is a
     dispersion measure (§1.3). For a gate, threshold the probabilities of passing levels, or use a
     `noul`/`choice`.
   - Levels were trained as unordered classes (`--ord_w` unused; §1.2).
   - Kev is a Qwen-family model, so it satisfies "different-model" against Claude executors. But 0.8B
     is far weaker than the executors it would check [inf].
6. **Quarantined read** (`:217`).
   - **Structural safety [code].** The output is a distribution over caller-supplied options only.
     Delimiters are unforgeable (§1.4). Injected text cannot come out of Kev as text.
   - **Steerability [run].** Injection *detection* is near chance at 0.8B: 0.41–0.46 on held-out
     carriers, 0.547 on devtools injection.
   - An injected "answer yes" can plausibly sway p. That is unmeasured [unk]. Use quarantined Kev
     reads only where a wrong enum is bounded in damage. Do not use 0.8B as an injection detector.
7. **Context selection** (`:218`). Which shared items does this node need?
   - Mechanically a good fit: many `noul` questions ("is item i needed?") or one `choice`, all sharing
     one state in one request. The state is computed once, with no question limit (§1.5).
   - Evidence of retrieval quality at 0.8B is weak: `bright` 0.36, `toolret` 0.49 [run].
   - States longer than about 8k tokens are both unvalidated and memory-risky on this CPU (§3.4).

### 6.2 Traps (consolidated)

- **`confidence` ≠ p_max.**
  - Kev's choice `confidence` is `(p_max − 1/K)/(1 − 1/K)` (`kev:kev/api.py:127-130`). Foundry
    ignores it and uses the renormalized p_max (`fdy:src/judgment.mjs:61-70`). That is consistent,
    but thresholds copied from Kev docs refer to Kev's field
    (`kev:skills/kev-finetune/references/deploy.md:63-66`).
  - A `noul` answer has no `confidence` at all.
- **Descriptions against bare labels.** The option **name is part of the input**
  (`kev:kev/api.py:58-59`). `{"a": "text"}` renders as "a: text", and `{"flake": null}` renders as
  "flake". Descriptions change the tokens the pointer reads, so they are not free documentation.
  - Kev's own examples and fine-tune data use descriptions.
  - No measurement compares bare and described options [unk].
- **Criteria wording sensitivity.** No paraphrase-robustness measurement exists in the repo [unk]. The
  only documented statements are "paraphrases at serving time still work but gain less" and "must be
  the exact instructions and option names production will send" (§4.1).
  - Foundry should measure this with paraphrased question variants on dev items before thresholds
    are frozen [inf].
- **"None of these" options.** Adding one lowers accuracy when the right answer is present: 0.8B
  0.472, Jev 0.75 (§2.3). Prefer a separate `noul` such as "does any option apply?"
- **Option order.** It changes answers (§1.7). Rotation averaging fixes it at K× cost, which on CPU
  multiplies latency.
- **Single-option `choice`.** It always returns p = 1 and confidence 1 (`kev:kev/api.py:128-130`).
  Foundry already requires at least 2 options (`fdy:src/ports.mjs:51`).
- **Yes/no as `choice`.** Foundry maps every port to `choice` (`fdy:src/judgment.mjs:53-58`). Kev's
  native yes/no is `noul` with options rendered "no", "yes". Whether calibration differs between the
  two forms at 0.8B is [unk].
- **Temperature provenance.** 0.8B's T was fitted in distribution (§2.2). Foundry should fit its
  own per-port T from the ledger. It can do so **without logits**:
  - Served probabilities at T₀ satisfy `log p = z/T₀ − c`. So `softmax(log p · T₀ / T)` reproduces
    temperature T exactly [inf, algebra].
  - The one caveat is that 4-decimal rounding (`kev:kev/api.py:143-146`) zeroes p < 5e-5, which
    needs a floor.
  - Kev's `kev.calibrate` refuses such rows only because it insists on raw logits
    (`kev:kev/calibrate.py:32-34`).
- **Model identity.** Sending `model: "kev-latest"` pins nothing (§1.10).
  - Foundry records `systemOneModel ?? body.model` (`fdy:src/ports.mjs:80`).
  - Record `/v1/models` `run`, `temperature`, `dtype` and `backend` with each ledger row
    (`fdy:src/judgment.mjs:20-27` already fetches them).
- **Dates in logs.** ISO timestamps with "T" are invisible to `date_facts` (§1.8). Compute day counts
  in code and put them in the state.
- **Context.** The validated length is 8k for 0.8B, and eager CPU attention memory runs out around
  that length. A 422 above 65,536 tokens maps to Foundry's `MODEL_CONTEXT` (`fdy:src/judgment.mjs:45`).

### 6.3 Gaps in Foundry's current integration [code]

1. **No request text in the ledger** (`fdy:src/judgment.mjs:80-85`). Fine-tuning and later
   re-scoring need it (§4.5).
2. **`costUsd: 0`** for `systemone` (`fdy:src/ports.mjs:80`), against the policy's imputed CPU cost
   (`fdy:policy/models.json:8`, `:30`; `fdy:research/distill-20261007/DESIGN.md:72-73`).
3. **Kev is not in the policy file**, which is "the ONLY source of model ids"
   (`fdy:policy/models.json:5`). `SystemOneClient` defaults to `kev-latest`
   (`fdy:src/judgment.mjs:15`). Either list System One engines in the policy or document the
   exemption.
4. **One question per request** (`fdy:src/ports.mjs:78`). There is no multi-port batching on a shared
   state.

---

## 7. Bearing on the owner's question: forgo local models entirely?

These are inferences, labelled as such. They are not a decision.

- **"Local models are slow" holds for generation, not for Kev.**
  - The parked models generated text: Qwen3.5-2B took 268 s per extraction call
    (`fdy:docs/RESEARCH.md:114`).
  - Kev runs one prefill pass with no decoding. The only local record is about 1.4 s for one to
    three short questions [F-rec, §3.2]. That is two orders of magnitude cheaper, on a different
    task.
  - The latency study under way is the right source for the CPU figure.
- **What a zero-shot 0.8B can be trusted for.**
  - Classification-shaped questions close to its training: routing, entailment, policy checks over
    stated rules.
  - Abstaining when evidence is missing.
  - Being rarely confidently wrong out of domain. The flip side is that it is rarely confident at
    all: only 14–27 % coverage at a 5 % error budget.
- **What it cannot be trusted for:** date and numeric reasoning, rule composition, tool routing,
  injection detection, agent-log questions on long states, and anything knowledge-heavy (§2.4).
  That covers several of Foundry's ports.
- **Keeping it costs little; depending on it is unjustified.**
  - Cost: about 3.6 GB RAM and shared cores.
  - The C4 rule already says what decides it: per port, does Kev beat the rule and embedding
    baselines on held-out ledger labels?
  - With 14–27 % coverage at 5 % error out of domain, the expected zero-shot lift is small. The
    upside is a **fine-tuned** 0.8B on Foundry's own oracle labels, but that is hours per run on CPU
    (§4.4) and needs the ledger fix (§6.3).
- **Alternatives for the same ports.**
  - **(a)** The existing `model` engine on a hosted Claude model from the policy file
    (`fdy:src/ports.mjs:93-111`). It returns self-reported confidence, which is not calibrated, so
    it needs a ledger calibration fit. It costs money and seconds per call; that is unmeasured here.
  - **(b)** Kev-4B or 9B on a GPU endpoint. This needs an external account (Modal), which is an
    owner decision.
  - **(c)** Rule and code baselines, which C4 requires anyway.
- **A measurement that would settle it cheaply.**
  - Freeze a few hundred Foundry judgment items per port from dev seeds, labelled by oracles.
  - Run rule, Kev-0.8B (with and without a workload T) and one hosted-model arm on the same items.
  - Compare Brier, coverage at the port's error budget, and wall time.
  - If Kev-0.8B shows no lift on any port, retire it and document the negative result.

---

## 8. Unknowns worth measuring next

- Kev-0.8B CPU latency against state length and question count, fp32 against bf16 (AMX), and peak
  memory at 4k, 8k and 12k tokens. The latency agent is on part of this.
- Flip rate under option order and under paraphrase on Foundry's own port questions.
- Calibration of `choice{yes,no}` against `noul` at 0.8B.
- Whether injected instructions in a quarantined state move Kev's p.
- CPU fine-tune throughput, via a `kev.train --max_steps` probe on 20–50 records. Not run, per
  instruction.
- The licence status of decision-v7's Yelp and Amazon sources for any redistribution or commercial
  claim.

---

## Feature table

| Feature | What it does | Evidence (doc / code path) | Relevance to Foundry | Caveat |
|---|---|---|---|---|
| Single prefill + pointer head | Probabilities over supplied options; no text generated | `kev:kev/model.py:87-127,205-223`; `kev:README.md:286-302` | Cheap typed judgments; output cannot carry free text (quarantine) | Only scores the options it is given; quality bounded by a 0.8B base on this box |
| `noul` | p(yes) for one yes/no question | `kev:kev/api.py:108-110,152-153`; `kev:README.md:260` | Applicability per precondition, drift per expectation, context "needed?" | No `confidence` or `probabilities` fields; Foundry currently sends `choice` instead |
| `choice` | Distribution over 1–255 named options; argmax; confidence | `kev:kev/api.py:23-31,111-112,154-156`; `kev:README.md:261,264` | Selection with propensities, failure class, enums | Option names are input; order changes answers (0.8B flips 0.056); "None of these" hurts (0.472); confidence ≠ p_max |
| `score` | Distribution over ordered levels; expected index; legend | `kev:kev/api.py:34-37,113-115,157-159` | Verifier ordered score | `score` is a mean, `confidence` is dispersion; levels trained as unordered classes (`--ord_w` unused) |
| Multiple questions per state | Any number of questions; state once; exact isolation | `kev:kev/model.py:21-47,329-333`; `kev:README.md:274,296,304` | Batch every port about one state into one request | Foundry sends one question per request (`fdy:src/ports.mjs:78`) |
| Prefix cache | Reuses the state's KV/DeltaNet cache across requests (4 states, 65,536 tokens) | `kev:kev/serve.py:27-91` | Repeated questions about the same state pay only for branches | Exact-token key; render states deterministically |
| `/v1/systemone/permute` | One choice under n_perm orders: `argmax_stable`, `spread` | `kev:kev/serve.py:255-275` | Audit order sensitivity per port; propensity robustness | n_perm sequential passes (costly on CPU); choice only |
| `/v1/systemone/separate` | Each question in its own pass | `kev:kev/serve.py:278-286` | Confirms isolation | Says nothing about order or wording |
| Rotation averaging | Averages logits over cyclic option rotations | `kev:kev/predictors.py:213-238`; `kev:PLAN.md:2774-2775` | Order-robust selection | K× latency; benchmark-side, not a server option |
| Temperature (per checkpoint) | Divides logits; argmax unchanged | `kev:kev/model.py:211-218`; `kev:README.md:367`; 0.8B T = 2.35 (`kev-0.8b.md:84`) | Calibrated thresholds per port | 0.8B T fitted in distribution; refit on the ledger (possible from served p, §6.2) |
| `KEV_TEMPERATURE` | Override T (1.0 = raw) | `kev:README.md:278`; `kev-0.8b.md:243` (refit 2.52) | Serve raw p and calibrate in Foundry | Changes propensities; log it |
| `kev.calibrate` workload report | raw / shipped / workload / out-of-fold T on a rows file | `kev:kev/calibrate.py:1-44` | Per-port calibration audit | Needs local logits; refuses remote rows |
| `date_facts` | Appends day counts for every pair of absolute dates | `kev:kev/api.py:62-91`; `kev:kev/serve.py:31,223-225`; `kev:README.md:369` | Deadline and elapsed-time checks | Misses ISO timestamps with "T" [here]; O(n²) growth; better computed in code |
| 422 on over-long state / `KEV_TRUNCATE_STATES` | Refuses > 65,536 tokens, or reads the head and reports it | `kev:kev/model.py:104,130-142`; `kev:docs/releases/kev-1.0.md:34` | Maps to `MODEL_CONTEXT` (`fdy:src/judgment.mjs:45`) | 0.8B validated only to 8,192; CPU eager attention memory limits about 8–12k [inf] |
| Delimiter escaping | `<|x|>` in caller text cannot forge structure | `kev:kev/model.py:75-81`; `kev:README.md:266` | Quarantined reads of untrusted content | Does not stop semantic steering; 0.8B injection detection ≈ chance [run] |
| Unknowable/abstention training | Uniform targets on evidence-removed cases | `kev:docs/model-cards/kev-0.8b.md:145`; `kev:README.md:365` | Applicability abstention (THESIS's 0/21 failure) | Measured on Kev's synthetic policies only |
| Fine-tune (`--init_from`, `--data`, soft `target`) | LoRA delta from a released checkpoint; T refit | `kev:README.md:182-194`; `kev:kev/data.py:362-410`; `kev:kev/train.py:372-438` | Fine-tuned Foundry judge from oracle-labelled ledger rows | Ledger lacks request text; CPU fp32 only, hours per 1k records [inf]; binds exact wording; ≥ ~1,000 records for a +5 pp detectable gain |
| kev-finetune skill (Modal) | Interview → data → train → calibrate → compare → deploy → teardown | `kev:skills/kev-finetune/SKILL.md:1-158` | Fast path to a 4B/9B judge | External account (owner decision); drops states > 384 tokens unless edited |
| kev-deploy skill (Modal) | HTTPS System One endpoint; scales to zero | `kev:skills/kev-deploy/SKILL.md:30-61`; `kev:skills/kev-deploy/scripts/kev_serve.py:31-38` | 4B/9B/27B quality without a local GPU | External account; ~35–55 s cold start; data leaves the VM |
| `kev.benchmark --remote` | Scores any System One endpoint on a frozen suite or JSONL | `kev:kev/benchmark.py:1-8,173-185` | Rerun transfer-v4 / hard-v1 dev on the local server; score Foundry items | Private suites (breadth, agents-ood, guardrails-ood) unavailable |
| TypeSafe SDK compatibility | Same path, auth and response shapes; `jev-latest` accepted | `kev:README.md:122-151`; `kev:kev/serve.py:35`; `typesafe_sdk/constants.py:3-21` | Swap Kev and Jev behind `SystemOneClient` | SDK default timeout 10 s; `model` not validated by Kev |
| `/v1/models` details | run, base, device, backend, dtype, T, max_state, cache and batch stats | `kev:kev/serve.py:298-312` | Pin judgment provenance in the ledger | `name` is always kev-latest/jev-latest; use `run` |
| Single model thread | Serializes requests; batches only with CUDA graphs | `kev:kev/serve.py:93-170`; `kev:kev/model.py:464-477` | Parallel Foundry nodes queue on Kev | On CPU, throughput ≈ 1/latency |
| Size ladder (0.8B → 27B) | Accuracy and coverage rise sharply with size | `kev:README.md:30-48`; `kev:docs/releases/kev-1.0.md:16-24` | Only 0.8B fits locally; 4B bf16 borderline | Out of domain, 0.8B is 0.648 against Jev 0.857 and automates 14–27 % at 5 % error |
