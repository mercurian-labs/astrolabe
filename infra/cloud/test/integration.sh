#!/usr/bin/env bash
# Deploys the stack into a throwaway local stage, runs the integration suite
# against it, and removes the stage whatever happened. Needs Docker. Run from
# infra/cloud: `vp run test:integration`. KEEP_STAGE=1 leaves it up afterwards.
set -uo pipefail
stage="it"
export CLOUD_POSTGRES_PORT="${CLOUD_POSTGRES_PORT:-54391}"

teardown() {
  # Only resources whose definition mentions this stage; the emulator is
  # shared with every other local stage on the machine.
  npx alchemy unsafe nuke --local --include 'AWS.*' \
    --filter "!JSON.stringify(resource).includes('-${stage}-')" --yes >/dev/null
  docker ps -aq --filter "name=mercuriancloud-postgres-${stage}-" | xargs -r docker rm -f >/dev/null
  rm -rf ".alchemy/state/MercurianCloud/${stage}"
}

vp run build && vp run --filter @mercurian/auth build || exit 1
[[ -d ".alchemy/state/MercurianCloud/${stage}" ]] && teardown # a stage left by a crashed run
ALCHEMY_DEV=true NO_DESTROY=1 vp test run test/stack.integ.test.ts
status=$?
[[ -n "${KEEP_STAGE:-}" ]] || teardown
exit $status
