#!/usr/bin/env bash
# Verify that a real Pi runtime loads this package and registers its command.
# Unit tests mock the extension API, so this is the end-to-end counterpart.
#
# Binary resolution: $PI_BIN, then the pi CLI bundled with the SDK dev
# dependency (so CI runs this for real after `npm ci`), then `pi` on PATH.
# Only when no binary exists anywhere does this report SKIP and exit 0.
set -euo pipefail

REPO_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
EXPECTED_COMMAND=go-on-mode

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

agent_dir=$(mktemp -d)
out=$(mktemp)
err=$(mktemp)
cleanup() { rm -rf "$agent_dir" "$out" "$err"; }
trap cleanup EXIT

# No model turn is used, so no credentials are needed: keep the agent dir and
# network isolated from the developer's real configuration.
if ! {
  printf '%s\n' '{"id":"verify-load","type":"get_commands"}'
  sleep 6
} | PI_CODING_AGENT_DIR="$agent_dir" PI_OFFLINE=1 timeout 60 "$PI_BIN" --mode rpc \
  --no-session --no-mcp --no-extensions -e "$REPO_DIR" >"$out" 2>"$err"; then
  echo "FAIL: $PI_BIN exited non-zero while loading $REPO_DIR" >&2
  grep -viE '^Warning: No models match' "$err" | head -20 >&2 || true
  exit 1
fi

if grep -viE '^Warning: No models match' "$err" | grep -qi 'extension'; then
  echo "FAIL: pi reported an extension problem:" >&2
  grep -viE '^Warning: No models match' "$err" | head -20 >&2
  exit 1
fi

if ! grep -q "\"name\":\"$EXPECTED_COMMAND\"" "$out"; then
  echo "FAIL: command /$EXPECTED_COMMAND was not registered by the loaded package" >&2
  head -20 "$out" >&2 || true
  exit 1
fi

echo "OK: $PI_BIN loaded the package and registered /$EXPECTED_COMMAND"
