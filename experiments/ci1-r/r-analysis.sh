#!/bin/bash
# CI-1 review-arm analysis (PREREG-CI1-R §7), $0: v2 rescoring of the wave-1 review runs, w2x rescoring of the wave-2 review runs, the
# preregistered contrasts (corrected oracle, 26 items) and the secondary ones (v2, 28 items), wall time and cost per verified build.
# Writes research/ci1-20261021/r/analysis-*.txt (and .json).
#   bash experiments/ci1-r/r-analysis.sh
set -eu
cd "$(dirname "$0")/../.."
OUT=research/ci1-20261021/r
W1=/var/tmp/foundry-work/ci1-20261021/bed; W2=/var/tmp/foundry-work/ci1-20261021/bed-w2
ARMS="A2b A1cH A0p A2"
CI1_BED=$W1 nice -n 15 node experiments/ci1-posthoc/rescore.mjs $(for a in $ARMS; do echo test-R-$a; done) 2>&1 | tail -n 4
CI1_BED=$W2 nice -n 15 node experiments/ci1-posthoc/rescore-w2x.mjs $(for a in $ARMS; do echo w2-R-$a; done) 2>&1 | grep -v "^  " | tail -n 4
SPECS="A0=test-A0+w2-A0 A1c=test-A1c+w2-A1c A2=test-A2+w2-A2 A2i=test-R-A2+w2-R-A2 A2b=test-R-A2b+w2-R-A2b A1cH=test-R-A1cH+w2-R-A1cH A0p=test-R-A0p+w2-R-A0p"
PAIRS="A2b:A2i,A1cH:A2b,A0p:A0,A1c:A0p,A2i:A2,A2b:A0,A1cH:A1c,A2b:A1c"
{ echo "## primary: corrected oracle (v2 wave 1 without 16312, 17545; w2x wave 2), 26 items"; node experiments/ci1-w2/pooled.mjs $SPECS --w2x --exclude 16312,17545 --pairs $PAIRS
  echo; echo "## secondary: oracle v2 (post hoc on wave 1, frozen on wave 2), 28 items"; node experiments/ci1-w2/pooled.mjs $SPECS --pairs $PAIRS
  echo; echo "## wave 2 alone, v2 (frozen)"; node experiments/ci1-w2/pooled.mjs $(echo $SPECS | tr ' ' '\n' | sed -E 's/=test-[^+]*\+/=/' | tr '\n' ' ') --pairs $PAIRS
  echo; echo "## time and cost per verified build, corrected (26 items)"; node experiments/ci1-r/walltime.mjs $SPECS --w2x --exclude 16312,17545 --json $OUT/analysis-walltime-corrected.json
  echo; echo "## time and cost per verified build, v2 (28 items)"; node experiments/ci1-r/walltime.mjs $SPECS --json $OUT/analysis-walltime-v2.json
} > $OUT/analysis-R.txt
cat $OUT/analysis-R.txt
