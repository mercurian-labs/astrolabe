#!/usr/bin/env bash
# Stops the dev server start-dev.sh launched in <run-dir>: the recorded PID and
# every descendant, children first. Stopping only the runner leaves Vite and the
# server holding their ports.
# Usage: stop-dev.sh <run-dir>
set -uo pipefail
run_dir="${1:?usage: stop-dev.sh <run-dir>}"
root="$(cat "$run_dir/pid" 2>/dev/null)" || { echo "no pid in $run_dir" >&2; exit 1; }
tree() { local p; for p in $(pgrep -P "$1"); do tree "$p"; done; echo "$1"; }
pids="$(tree "$root")"
kill -TERM $pids 2>/dev/null
for _ in $(seq 1 10); do
  alive=""; for p in $pids; do kill -0 "$p" 2>/dev/null && alive="$alive $p"; done
  [ -z "$alive" ] && { echo "stopped:" $pids; exit 0; }
  sleep 1
done
kill -KILL $alive 2>/dev/null
echo "killed after timeout:$alive"
