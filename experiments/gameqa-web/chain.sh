#!/usr/bin/env bash
# GQA-1 run chains (PREREG-GQA-1 §3 order and §6 spend stop). One lane per call, reps FROM..TO:
#   chain.sh workflow 1 5     workflow r then workflow-random r (it reuses workflow r's construction)
#   chain.sh agent 1 5        agent r
#   chain.sh monkey 1 5       monkey r and monkey-ref r ($0)
#   MODEL=mercury-3 chain.sh workflow 1 3    exploratory secondary (E1); the caller loads the Inception key into the env
#   chain.sh workflow-random 2 2   workflow-random r only (amendment A1: re-run of a harness-faulted rep; workflow r must exist)
#   chain.sh agent-nb 1 5          agent r with --transport nb (amendment A1 secondary: no CLI "USD budget" line), tag gqa1nb
#   chain.sh agent-persist 1 5     agent-persist r (A1 secondary: no budget line, early finish refused), tag gqa1nb
#   TAG=gqa1v chain.sh workflow 1 5   amendment A2: the single-CLI-version replication of the primary arms (also agent)
#   chain.sh agent-matched 1 5     agent-matched r (A2: matched prompt, append-only reports, restarts to $0.067), tag gqa2
# A paid run starts only while the recorded spend of GQA-1 is under $2.50: every run's meta.json cost.spent, including the
# harness-faulted runs kept under runs/_harness-fault/ (A1), plus the diagnostics' summary.usd in diag/*.json (A1).
set -u
cd "$(dirname "$0")/../.."
lane=$1; from=$2; to=$3; model=${MODEL:-claude-haiku-5-5}; tag=${TAG:-}
log=research/gameqa-20261021/runs/chain-${tag:+$tag-}${lane}-${model}.log
tagarg=(); [ -n "$tag" ] && tagarg=(--tag "$tag")
mkdir -p research/gameqa-20261021/runs
spent() { node -e '
  const fs = require("node:fs"), r = "research/gameqa-20261021"; let s = 0;
  for (const p of [`${r}/runs`, `${r}/runs/_harness-fault`]) { if (!fs.existsSync(p)) continue;
    for (const d of fs.readdirSync(p)) { try { s += JSON.parse(fs.readFileSync(`${p}/${d}/meta.json`, "utf8")).cost.spent ?? 0; } catch {} } }
  if (fs.existsSync(`${r}/diag`)) for (const f of fs.readdirSync(`${r}/diag`)) { try { s += JSON.parse(fs.readFileSync(`${r}/diag/${f}`, "utf8")).summary.usd ?? 0; } catch {} }
  console.log(s.toFixed(4));'; }
under_cap() { node -e "process.exit(Number('$(spent)') < 2.5 ? 0 : 1)"; }
run() {
  echo "$(date -u +%FT%TZ) start $*" >> "$log"
  nice -n 15 node experiments/gameqa-web/run.mjs "$@" >> "$log" 2>&1
  local rc=$?   # A2: captured before the date substitution (it used to log the exit status of the substitution, always 0)
  echo "$(date -u +%FT%TZ) end $* (exit $rc; spent so far \$$(spent))" >> "$log"
}
for r in $(seq "$from" "$to"); do
  case $lane in
    workflow)
      under_cap || { echo "$(date -u +%FT%TZ) spend stop at \$$(spent)" >> "$log"; exit 0; }
      run --arm workflow --rep "$r" --live --model "$model" "${tagarg[@]}"
      under_cap || { echo "$(date -u +%FT%TZ) spend stop at \$$(spent)" >> "$log"; exit 0; }
      run --arm workflow-random --rep "$r" --live --model "$model" "${tagarg[@]}" ;;
    workflow-random)
      under_cap || { echo "$(date -u +%FT%TZ) spend stop at \$$(spent)" >> "$log"; exit 0; }
      run --arm workflow-random --rep "$r" --live --model "$model" "${tagarg[@]}" ;;
    agent)
      under_cap || { echo "$(date -u +%FT%TZ) spend stop at \$$(spent)" >> "$log"; exit 0; }
      run --arm agent --rep "$r" --live --model "$model" "${tagarg[@]}" ;;
    agent-matched)
      under_cap || { echo "$(date -u +%FT%TZ) spend stop at \$$(spent)" >> "$log"; exit 0; }
      run --arm agent-matched --rep "$r" --live --model "$model" --transport nb ;;
    agent-nb)
      under_cap || { echo "$(date -u +%FT%TZ) spend stop at \$$(spent)" >> "$log"; exit 0; }
      run --arm agent --rep "$r" --live --model "$model" --transport nb ;;
    agent-persist)
      under_cap || { echo "$(date -u +%FT%TZ) spend stop at \$$(spent)" >> "$log"; exit 0; }
      run --arm agent-persist --rep "$r" --live --model "$model" --transport nb ;;
    monkey)
      run --arm monkey --rep "$r"
      run --arm monkey-ref --rep "$r" ;;
    *) echo "unknown lane $lane" >&2; exit 2 ;;
  esac
done
echo "$(date -u +%FT%TZ) lane $lane $from..$to done" >> "$log"
