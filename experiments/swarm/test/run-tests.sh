#!/bin/sh
# Run the swarm ladder's tests one file at a time (shared 4-CPU machine): sh experiments/swarm/test/run-tests.sh
cd "$(dirname "$0")/../../.." || exit 2
status=0
for f in experiments/swarm/test/spawn-tree.test.mjs experiments/swarm/test/coord.test.mjs experiments/swarm/test/arms.test.mjs \
  experiments/swarm/test/rootcause.test.mjs experiments/swarm/test/analyze.test.mjs experiments/swarm/test/r1b.test.mjs experiments/swarm/test/void-audit.test.mjs \
  experiments/swarm/test/shell-scan.test.mjs experiments/swarm/test/delivery-gate.test.mjs experiments/swarm/test/trace-unexplained.test.mjs tests/executor-extra-args.test.mjs tests/executor-sandbox.test.mjs; do
  out=$(nice -n 15 node --test --test-concurrency=1 "$f" 2>&1)
  pass=$(printf '%s\n' "$out" | sed -n 's/^ℹ pass //p'); fail=$(printf '%s\n' "$out" | sed -n 's/^ℹ fail //p')
  echo "$f pass=$pass fail=$fail"
  [ "$fail" = "0" ] || { status=1; printf '%s\n' "$out" | grep -E '✖|Error' | head -20; }
done
exit $status
