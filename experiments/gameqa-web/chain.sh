#!/usr/bin/env bash
# GQA-1 run chains (PREREG-GQA-1 §3 order and §6 spend stop). One lane per call, reps FROM..TO:
#   chain.sh workflow 1 5     workflow r then workflow-random r (it reuses workflow r's construction)
#   chain.sh agent 1 5        agent r
#   chain.sh monkey 1 5       monkey r and monkey-ref r ($0)
#   MODEL=mercury-3 chain.sh workflow 1 3    exploratory secondary (E1); the caller loads the Inception key into the env
# A paid run starts only while the recorded spend of all GQA-1 runs (meta.json cost.spent) is under $2.50.
set -u
cd "$(dirname "$0")/../.."
lane=$1; from=$2; to=$3; model=${MODEL:-claude-haiku-5-5}
log=research/gameqa-20261021/runs/chain-${lane}-${model}.log
mkdir -p research/gameqa-20261021/runs
spent() { node -e '
  const fs = require("node:fs"), p = "research/gameqa-20261021/runs"; let s = 0;
  for (const d of fs.readdirSync(p)) { try { s += JSON.parse(fs.readFileSync(`${p}/${d}/meta.json`, "utf8")).cost.spent ?? 0; } catch {} }
  console.log(s.toFixed(4));'; }
under_cap() { node -e "process.exit(Number('$(spent)') < 2.5 ? 0 : 1)"; }
run() {
  echo "$(date -u +%FT%TZ) start $*" >> "$log"
  nice -n 15 node experiments/gameqa-web/run.mjs "$@" >> "$log" 2>&1
  echo "$(date -u +%FT%TZ) end $* (exit $?; spent so far \$$(spent))" >> "$log"
}
for r in $(seq "$from" "$to"); do
  case $lane in
    workflow)
      under_cap || { echo "$(date -u +%FT%TZ) spend stop at \$$(spent)" >> "$log"; exit 0; }
      run --arm workflow --rep "$r" --live --model "$model"
      under_cap || { echo "$(date -u +%FT%TZ) spend stop at \$$(spent)" >> "$log"; exit 0; }
      run --arm workflow-random --rep "$r" --live --model "$model" ;;
    agent)
      under_cap || { echo "$(date -u +%FT%TZ) spend stop at \$$(spent)" >> "$log"; exit 0; }
      run --arm agent --rep "$r" --live --model "$model" ;;
    monkey)
      run --arm monkey --rep "$r"
      run --arm monkey-ref --rep "$r" ;;
    *) echo "unknown lane $lane" >&2; exit 2 ;;
  esac
done
echo "$(date -u +%FT%TZ) lane $lane $from..$to done" >> "$log"
