#!/usr/bin/env bash
# Verify the extension's shortcuts in a real interactive TUI: press the keys in
# a PTY and check that pi actually receives the continuation prompt.
#
# This is the keystroke-to-action hop that RPC mode cannot reach — RPC has no
# terminal chords, so registration and key matching alone do not prove the
# shortcuts fire. It is intentionally local-only: go-on refuses to nudge without
# a selected model and working credentials, which CI does not have. Skips
# (exit 0) when a PTY cannot be allocated.
set -euo pipefail

REPO_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
EXPECTED_PROMPT=${EXPECTED_PROMPT:-Continue autonomously toward the outcome}
NUDGE_CHORD=$(printf '\033\016')   # ctrl+alt+n on legacy terminals: ESC + ctrl-N
BURST_CHORD=$(printf '\033\007')   # ctrl+alt+g on legacy terminals: ESC + BEL

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
if ! command -v script >/dev/null 2>&1; then
  echo "SKIP: no script(1) available to allocate a PTY"
  exit 0
fi

sess=$(mktemp -d)
cwd=$(mktemp -d)
out=$(mktemp)
cleanup() { rm -rf "$sess" "$cwd" "$out"; }
trap cleanup EXIT

cd "$cwd"
# No tools, and the working directory is empty: if a continuation turn starts,
# it cannot touch anything, and the run is interrupted within seconds.
{
  sleep 10
  printf '%s' "$NUDGE_CHORD"
  sleep 6
  printf '%s' "$BURST_CHORD"
  sleep 6
  printf '\003'
  sleep 3
} | TERM=xterm-256color script -qec \
  "$PI_BIN --no-tools --no-extensions -e $REPO_DIR --session-dir $sess --name shortcut-check" \
  /dev/null >"$out" 2>&1 || true

session_file=$(find "$sess" -name '*.jsonl' 2>/dev/null | head -1)
if [ -z "$session_file" ]; then
  echo "FAIL: the TUI session recorded no transcript" >&2
  tail -c 400 "$out" >&2 || true
  exit 1
fi

delivered=$(grep -c "$EXPECTED_PROMPT" "$session_file" 2>/dev/null || true)
if [ "${delivered:-0}" -lt 1 ]; then
  echo "FAIL: no continuation prompt reached pi from the shortcut keystrokes" >&2
  tail -c 400 "$out" >&2 || true
  exit 1
fi
echo "  Ctrl+Alt+N delivered a continuation prompt ($delivered prompt(s) in the session)"

if ! tr -d '\000' <"$out" | grep -q 'go-on: armed'; then
  echo "FAIL: Ctrl+Alt+G did not arm auto mode (no 'go-on: armed' status rendered)" >&2
  exit 1
fi
echo "  Ctrl+Alt+G armed auto mode (status rendered)"

echo "OK: both shortcuts fire in a real TUI session"
