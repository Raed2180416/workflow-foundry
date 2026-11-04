#!/bin/bash
# Move 4: run replay_batch.py inside AutomationBench's venv with the bridge's environment (lib.mjs bridgeEnv: no host
# credentials, no network configuration, HF offline), from a neutral working directory, at low priority. -B: no bytecode
# is written next to the imported frozen modules (bridge.py, verifier/live; review finding 19).
#   bash replay.sh <jobs.jsonl> <out.jsonl> <worlds dir> <work dir>   [extra replay_batch.py flags, e.g. --skip-done]
set -euo pipefail
JOBS=${1:?jobs.jsonl}; OUT=${2:?out.jsonl}; WORLDS=${3:?worlds dir}; WORK=${4:?neutral work dir}
shift 4
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../../.." && pwd)
PY=${AB_VENV_PY:-$REPO/corpus/AutomationBench/.venv/bin/python}
[ -x "$PY" ] || { echo "AutomationBench venv python missing: $PY (symlink corpus/ read-only from the main tree)"; exit 2; }
mkdir -p "$WORK/home" "$WORK/hf" "$WORLDS"
cd "$WORK"
exec env -i PATH=/usr/bin:/bin LANG="${LANG:-C.UTF-8}" HOME="$WORK/home" HF_HOME="$WORK/hf" HF_DATASETS_OFFLINE=1 HF_HUB_OFFLINE=1 \
  TQDM_DISABLE=1 PYTHONDONTWRITEBYTECODE=1 nice -n 15 "$PY" -I -B "$HERE/replay_batch.py" --jobs "$JOBS" --out "$OUT" --worlds "$WORLDS" "$@"
