#!/usr/bin/env bash
# Verify that a real Pi runtime loads this package and registers its command.
# Unit tests mock the extension API, so this is the end-to-end counterpart.
#
# Binary resolution: $PI_BIN, then the pi CLI bundled with the SDK dev
# dependency (so CI runs this for real after `npm ci`), then `pi` on PATH.
# Only when no binary exists anywhere does this report SKIP and exit 0.
set -euo pipefail

REPO_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
EXPECTED_COMMAND=${EXPECTED_COMMAND:-go-on-mode}
DEADLINE_SECONDS=${DEADLINE_SECONDS:-30}

PI_BIN=${PI_BIN:-}
if [ -z "$PI_BIN" ] && [ -x "$REPO_DIR/node_modules/.bin/pi" ]; then
  PI_BIN="$REPO_DIR/node_modules/.bin/pi"
fi
if [ -z "$PI_BIN" ] && command -v pi >/dev/null 2>&1; then
  PI_BIN=$(command -v pi)
fi

if [ -z "$PI_BIN" ]; then
  echo "SKIP: no pi binary found (checked \$PI_BIN, node_modules/.bin/pi, PATH)"
  exit 0
fi

# `timeout` is coreutils; stock macOS only has it via GNU coreutils (as
# `gtimeout`), so fall back to running without a hard deadline there.
with_timeout() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 60 "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout 60 "$@"
  else
    "$@"
  fi
}

agent_dir=$(mktemp -d)
out=$(mktemp)
err=$(mktemp)
fifo="$agent_dir/stdin.fifo"
pi_pid=""

cleanup() {
  [ -n "$pi_pid" ] && kill "$pi_pid" 2>/dev/null || true
  exec 3>&- 2>/dev/null || true
  rm -rf "$agent_dir" "$out" "$err"
}
trap cleanup EXIT

# No model turn is used, so no credentials are needed: keep the agent dir and
# network isolated from the developer's real configuration.
mkfifo "$fifo"
with_timeout env PI_CODING_AGENT_DIR="$agent_dir" PI_OFFLINE=1 "$PI_BIN" --mode rpc \
  --no-session --no-mcp --no-extensions -e "$REPO_DIR" <"$fifo" >"$out" 2>"$err" &
pi_pid=$!

# Hold stdin open and close it only once the runtime has answered, so a slow
# runner cannot race the response against an end-of-input shutdown.
exec 3>"$fifo"
printf '%s\n' '{"id":"verify-load","type":"get_commands"}' >&3 || true

deadline=$((SECONDS + DEADLINE_SECONDS))
registered=0
while [ "$SECONDS" -lt "$deadline" ]; do
  if grep -q "\"name\":\"$EXPECTED_COMMAND\"" "$out" 2>/dev/null; then
    registered=1
    break
  fi
  if ! kill -0 "$pi_pid" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

exec 3>&-
pi_status=0
wait "$pi_pid" || pi_status=$?
pi_pid=""

if [ "$registered" -ne 1 ]; then
  echo "FAIL: /$EXPECTED_COMMAND was not registered by the loaded package (pi exit=$pi_status)" >&2
  grep -viE '^Warning: No models match' "$err" | head -20 >&2 || true
  cut -c1-800 "$out" >&2 || true
  exit 1
fi

if grep -viE '^Warning: No models match' "$err" | grep -qi 'extension'; then
  echo "FAIL: pi reported an extension problem:" >&2
  grep -viE '^Warning: No models match' "$err" | head -20 >&2
  exit 1
fi

if [ "$pi_status" -ne 0 ]; then
  echo "FAIL: $PI_BIN exited with status $pi_status while loading $REPO_DIR" >&2
  grep -viE '^Warning: No models match' "$err" | head -20 >&2 || true
  exit 1
fi

echo "OK: $PI_BIN loaded the package and registered /$EXPECTED_COMMAND"
