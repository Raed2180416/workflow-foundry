#!/bin/sh
# Stand-in for the Claude CLI (no model call, $0). runClaudeCode execs it inside the real sandbox, in the real workdir,
# with the real argv and the real prompt on stdin. It records what a real session would have received, then prints a
# minimal stream-json transcript. It never reads or records environment variables (credentials live there).
# The harness copies this file into each workdir as ./.stand-in-cli.sh (home and the repository are hidden in the
# sandbox); it is excluded from the capture. Capture: ./.capture/ in the workdir (argv, cwd, prompt, and a sha256 of every file present before it wrote anything).
set -e
mkdir -p .capture
find . \( -path ./.capture -o -path ./.stand-in-cli.sh \) -prune -o -type f -print | LC_ALL=C sort | while read -r f; do sha256sum "$f"; done > .capture/files.txt
pwd > .capture/cwd.txt
for a in "$@"; do printf '%s\n' "$a"; done > .capture/argv.txt
cat > .capture/prompt.txt
printf '%s' '{"records":[]}' > answer.json
echo '{"type":"system","subtype":"init","session_id":"stand-in"}'
echo '{"type":"result","subtype":"success","is_error":false,"result":"done","total_cost_usd":0,"num_turns":1,"session_id":"stand-in"}'
