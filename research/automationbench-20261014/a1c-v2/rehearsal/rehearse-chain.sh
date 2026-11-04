#!/bin/bash
# $0 rehearsal of look2-chain.sh (no model, no run): the real checks (pin and branch commits, shas, CLI, the look-2
# exposure scan) against a temporary live root, with fake-sequential.mjs in place of sequential.mjs. Needs a clean,
# committed branch. Scenarios: a clean pass (order, roles, arm names, first looks, no --no-copy, caps, the Mercury token
# cap), D22 lowering a cap, an interrupted chain resumed (finished arms skipped, a started arm resumed at its launch
# cap), an environment fault resumed, a cap stop (exit 4), D22 exhausted (exit 5).
#   bash research/automationbench-20261014/a1c-v2/rehearsal/rehearse-chain.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
WT=/home/user/workflow-foundry/.claude/worktrees/wf_3674d3bc-0a7-12
CHAIN=$HERE/../look2-chain.sh
base() { export V1HASH=h1 V1MHASH=h1m V2HASH=h2 V2MHASH=h2m V2COMMIT=$(git -C "$WT" rev-parse HEAD) CLI="$(claude --version 2>/dev/null | head -1)" MERCURY_OTHER=0 M_ARMS=1 \
  A1CV2_SEQ_JS=$HERE/fake-sequential.mjs A1CV2_FAULT_WAIT=0; export A1CV2_LIVE=$(mktemp -d /tmp/a1cv2-rehearse-XXXX)/autobench; mkdir -p "$A1CV2_LIVE"; }
inv() { node -e 'const L=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).map(JSON.parse);process.stdout.write(JSON.stringify(eval(process.argv[2])))' "$A1CV2_LIVE/invocations.jsonl" "$1"; }
ok=0; bad=0
check() { if [ "$2" = "$3" ]; then ok=$((ok+1)); else bad=$((bad+1)); echo "FAIL $1: got $2, want $3"; fi; }

# 1. a clean pass with T3
base; export D22_LEFT=40 T3=1 FAKE_RC='{}' FAKE_SPEND='{}'
bash "$CHAIN" > "$A1CV2_LIVE/../chain.log" 2>&1; check "1 exit" $? 0
check "1 order" "$(inv 'L.map(x=>x.id).join()')" '"a1c-v1-look2,a1c-v2-look2,a0-look2,a0-look2-aa,a1c-v1m-look2,a1c-v2m-look2"'
check "1 roles" "$(inv 'L.map(x=>x.role).join()')" '"treatment,treatment,control,treatment,treatment,treatment"'
check "1 arms" "$(inv 'L.map(x=>x.arm).join("|")')" '"A1-C|A1-C v2|A0|A0 (T3 A/A)|A1-C (Mercury ledger and checker)|A1-C v2 (Mercury ledger and checker)"'
check "1 first looks" "$(inv 'L.map(x=>x.firstLook).join()')" '"2,2,,2,2,2"'
check "1 exec, no --no-copy" "$(inv 'L.every(x=>x.exec&&!x.pass.includes("--no-copy"))')" true
check "1 checkouts" "$(inv 'L.map(x=>x.cwd.endsWith("a1c-v1-pin")?"pin":"wt").join()')" '"pin,wt,pin,pin,pin,wt"'
check "1 caps" "$(inv 'L.map(x=>x.cap).join()')" '"6,6,4,4,4,4"'
check "1 token caps" "$(inv 'L.map(x=>x.tokenCap).join()')" '",,,,5500000,5500000"'
check "1 hashes" "$(inv 'L.map(x=>{const i=x.pass.indexOf("--harness-hash");return i<0?"-":x.pass[i+1]}).join()')" '"h1,h2,-,-,h1m,h2m"'
check "1 Mercury session tokens" "$(inv 'L.map(x=>x.pass.includes("--session-tokens")).join()')" '"false,false,false,false,true,true"'
# 2. D22 lowers a cap: $8 left, $1 spent per arm
base; export D22_LEFT=8 T3=0 FAKE_RC='{}' FAKE_SPEND='{}'
bash "$CHAIN" > "$A1CV2_LIVE/../chain.log" 2>&1; check "2 exit" $? 0
check "2 caps" "$(inv 'L.map(x=>x.cap).join()')" '"6,6,4,4,4"'
base; export D22_LEFT=12 FAKE_SPEND='{"a1c-v1-look2":[5],"a1c-v2-look2":[2.5]}'
bash "$CHAIN" > "$A1CV2_LIVE/../chain.log" 2>&1; rc=$?
check "2b caps lowered to what is left" "$(inv 'L.map(x=>x.cap).join()')" '"6,6,4,3.5"'
check "2b D22 stop" "$rc" 5
# 3. interrupted: v2 stops at an environment fault twice, then finishes; then the whole chain is relaunched
base; export D22_LEFT=40 FAKE_RC='{"a1c-v2-look2":[3,3,0]}' FAKE_SPEND='{}'
bash "$CHAIN" > "$A1CV2_LIVE/../chain.log" 2>&1; check "3 exit" $? 0
check "3 v2 resumed" "$(inv 'L.filter(x=>x.id==="a1c-v2-look2").map(x=>x.resume).join()')" '"false,true,true"'
bash "$CHAIN" > "$A1CV2_LIVE/../chain2.log" 2>&1; check "3 relaunch exit" $? 0
check "3 relaunch launches nothing" "$(inv 'L.length')" 7
# 4. a cap stop, then a relaunch resumes that arm at its launch cap
base; export D22_LEFT=40 FAKE_RC='{"a0-look2":[4,0]}' FAKE_SPEND='{}'
bash "$CHAIN" > "$A1CV2_LIVE/../chain.log" 2>&1; check "4 cap stop" $? 4
check "4 stopped at A0" "$(inv 'L.map(x=>x.id).join()')" '"a1c-v1-look2,a1c-v2-look2,a0-look2"'
bash "$CHAIN" > "$A1CV2_LIVE/../chain2.log" 2>&1; check "4 relaunch exit" $? 0
check "4 A0 resumed at its cap" "$(inv 'L.filter(x=>x.id==="a0-look2").map(x=>`${x.resume}:${x.cap}`).join()')" '"false:4,true:4"'
# 5. the D18 ceiling: other use leaves too little for a Mercury arm
base; export D22_LEFT=40 FAKE_RC='{}' MERCURY_OTHER=15000000
bash "$CHAIN" > "$A1CV2_LIVE/../chain.log" 2>&1; check "5 D18 stop" $? 6
# 6. the Mercury arms need a stated M_ARMS (D28 (7)): 0 skips v1-M and v2-M; unset refuses before any arm
base; export D22_LEFT=40 T3=0 FAKE_RC='{}' FAKE_SPEND='{}' MERCURY_OTHER=0 M_ARMS=0
bash "$CHAIN" > "$A1CV2_LIVE/../chain.log" 2>&1; check "6 M_ARMS=0 exit" $? 0
check "6 M_ARMS=0 arms" "$(inv 'L.map(x=>x.id).join()')" '"a1c-v1-look2,a1c-v2-look2,a0-look2"'
base; unset M_ARMS; export D22_LEFT=40 T3=0 FAKE_RC='{}' FAKE_SPEND='{}'
bash "$CHAIN" > "$A1CV2_LIVE/../chain.log" 2>&1; check "6 M_ARMS unset refused" $? 7
check "6 M_ARMS unset launches nothing" "$([ -f "$A1CV2_LIVE/invocations.jsonl" ] && echo some || echo none)" none
echo "rehearsal: $ok passed, $bad failed"
[ $bad -eq 0 ]
