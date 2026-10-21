#!/usr/bin/env bash
# Starts `vp run dev` against a clean home in <run-dir>, records its PID, and
# waits for the pairing URL. Run from the repository root.
# Usage: start-dev.sh <run-dir>
set -euo pipefail
run_dir="${1:?usage: start-dev.sh <run-dir>}"
mkdir -p "$run_dir/home"
nohup vp run dev --home-dir "$run_dir/home" >"$run_dir/dev.log" 2>&1 &
echo $! >"$run_dir/pid"
for _ in $(seq 1 120); do
  if grep -q 'pairingUrl:' "$run_dir/dev.log"; then
    grep -o '\[dev-runner\].*' "$run_dir/dev.log" | head -1
    grep -o 'pairingUrl: .*' "$run_dir/dev.log" | tail -1 | sed 's/^pairingUrl: //' >"$run_dir/pairing-url"
    echo "pid=$(cat "$run_dir/pid") pairing-url written to $run_dir/pairing-url"
    exit 0
  fi
  if ! kill -0 "$(cat "$run_dir/pid")" 2>/dev/null; then
    echo "dev server exited; see $run_dir/dev.log" >&2
    exit 1
  fi
  sleep 1
done
echo "no pairingUrl after 120s; see $run_dir/dev.log" >&2
exit 1
