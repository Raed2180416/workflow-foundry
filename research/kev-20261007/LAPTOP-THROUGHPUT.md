# Kev-0.8B fine-tuning throughput on the owner's laptop (measured 2026-10-07/08)

Measured through the signed laptop bridge (`bridge/`), job kind `kev.train`, delta fine-tune
from `jaredpalmer/kev-0.8b@v1.0` on `Qwen/Qwen3.5-0.8B-Base`, LoRA rank 16, bf16 autocast, 48
throughput-only records per job (records-bed DEV seeds 101–148 cut to a fixed token length with the
pinned tokenizer; placeholder labels; not training data). Laptop: NVIDIA RTX 4060 Laptop GPU
(8 GB, 7.7 GiB usable), driver 615.71.09, torch 2.8.0+cu126, transformers 5.17.0, peft 0.21.0,
CachyOS (native Linux), 16 CPUs, 15 GB RAM. Per-record time is the median optimizer-step time
(steps 2..n) divided by the records per step; the first step includes warm-up and is excluded.

| job | state tokens | batch × accum | checkpointing | fast kernels | s/record | peak GPU GB | wall s | outcome |
|---|---|---|---|---|---|---|---|---|
| j-20261007-222331-2933c2 | 300 | 1 × 8 | on | (see note) | 0.388 | 3.26 | 28.5 | ok |
| j-20261007-222333-b9fa98 | 2,000 | 1 × 8 | on | (see note) | 1.942 | 4.05 | 109.5 | ok |
| j-20261007-222334-3f67ab | 8,000 | 1 × 8 | on | (see note) | 10.507 | 7.14 | 523.8 | ok |
| j-20261008-111041-cd3b9b | 300 | 1 × 8 | on | fla 0.5.2 + causal-conv1d 1.7.0 | 0.281 | 3.21 | 35.2 | ok |
| j-20261008-111042-3563d4 | 2,000 | 1 × 8 | on | same | 1.918 | 4.05 | 115.8 | ok |
| j-20261008-111044-e2112b | 8,000 | 1 × 8 | on | same | 10.531 | 7.14 | 512.1 | ok |
| j-20261008-112600-5b3a8b | 300 | 8 × 1 | off | same | – | > 7.6 | – | CUDA OOM |
| j-20261008-112602-470ebc | 300 | 4 × 2, length-sorted | on | same | 0.281 | 3.73 | 17.8 | ok |
| j-20261008-112603-bbbc11 | 2,000 | 2 × 4 | off | same | – | > 7.6 | – | CUDA OOM |

Notes and conclusions:
- **Fast kernels.** The laptop worker reports flash-linear-attention 0.5.2, fla-core 0.5.2 and
  causal-conv1d 1.7.0 installed from hash-checked wheels with the slow-path warnings gone; its own toy
  run went from 0.285 to 0.241 s/example. When exactly they were installed relative to the 2026-10-07
  jobs is not recorded, so the before/after rows may both include them. Measured: 2K and 8K are
  unchanged within 1.3 %; the 300-token row is 28 % faster, which may be warm-up/noise as much as
  kernels (one job each).
- **Throughput is compute-bound at roughly 1,000–1,300 tokens/s** (forward tokens 17,451 / 99,051 /
  387,051 for 48 records at 300 / 2K / 8K). Batching (4 × 2) does not change the per-record cost;
  it only shortens wall time through less warm-up per record.
- **Gradient checkpointing is required** on this 8 GB card: without it, 8 × 300-token or 2 × 2K-token
  micro-batches run out of memory.
- **8K-token states are the limit**: 7.14 GB peak at batch 1 with checkpointing; nothing longer fits.
- **Planning numbers for JUDGE-PROGRAM §4.1/§7.4**: about 0.28 s per ~300-token record (≈ 1.6 h per
  20K records per epoch), about 1.9 s per 2K-token record, about 10.5 s per 8K-token record. Every
  job sets `maxState` explicitly; no record was truncated or rejected in these runs.
- GPU temperature reached 86–88 °C under sustained load on 2026-10-07; the owner was told.
