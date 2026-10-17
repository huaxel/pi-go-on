#!/usr/bin/env bash
# Verify that a real Pi runtime loads this package and registers its command.
# Unit tests mock the extension API, so this is the end-to-end counterpart.
# Skips (exit 0) when Pi is not installed, which keeps it CI-safe.
set -euo pipefail

REPO_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
EXPECTED_COMMAND=go-on-mode

if ! command -v pi >/dev/null 2>&1; then
  echo "SKIP: pi is not installed; cannot verify extension loading"
  exit 0
fi

out=$(mktemp)
err=$(mktemp)
cleanup() { rm -f "$out" "$err"; }
trap cleanup EXIT

run_pi() {
  {
    printf '%s\n' '{"id":"verify-load","type":"get_commands"}'
    sleep 6
  } | timeout 60 pi --mode rpc --no-session --no-mcp --no-extensions \
    -e "$REPO_DIR" >"$out" 2>"$err"
}

if ! run_pi; then
  echo "FAIL: pi exited non-zero while loading $REPO_DIR" >&2
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

echo "OK: pi loaded the package and registered /$EXPECTED_COMMAND"
