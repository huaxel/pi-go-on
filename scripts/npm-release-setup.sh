#!/usr/bin/env bash
set -euo pipefail

# Set this to the number of stages in your wizard.
TOTAL_STAGES=6
ENV_FILE="${ENV_FILE:-.env}"
CURRENT_STAGE=0

stage() {
  local title=$1
  if [[ -t 1 ]]; then
    clear
  fi
  CURRENT_STAGE=$((CURRENT_STAGE + 1))
  printf '\n[%d/%d] %s\n' "$CURRENT_STAGE" "$TOTAL_STAGES" "$title"
  printf '%s\n' '────────────────────────────────────────'
}

say() {
  printf '%s\n' "$*"
}

step() {
  printf '  • %s\n' "$*"
}

pause() {
  local prompt=${1:-Press Enter when ready}
  read -r -p "$prompt " _
}

confirm() {
  local prompt=${1:-Continue?}
  local answer
  read -r -p "$prompt [y/N] " answer
  [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]
}

open_url() {
  local url=$1
  if command -v wslview >/dev/null 2>&1; then
    wslview "$url"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 &
  elif command -v explorer.exe >/dev/null 2>&1; then
    explorer.exe "$url" >/dev/null 2>&1 &
  else
    say "Open this URL in your browser: $url"
  fi
}

ask() {
  local __result=$1 prompt=$2 default=${3:-} answer
  if [[ -n "$default" ]]; then
    read -r -p "$prompt [$default] " answer
    answer=${answer:-$default}
  else
    read -r -p "$prompt " answer
  fi
  printf -v "$__result" '%s' "$answer"
}

ask_secret() {
  local __result=$1 prompt=$2 answer
  read -r -s -p "$prompt " answer
  printf '\n'
  printf -v "$__result" '%s' "$answer"
}

write_env() {
  local key=$1 value=$2 dir tmp
  [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || {
    printf 'Invalid environment variable name: %s\n' "$key" >&2
    return 1
  }
  dir=$(dirname "$ENV_FILE")
  mkdir -p "$dir"
  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  tmp=$(mktemp "${ENV_FILE}.tmp.XXXXXX")
  WIZARD_ENV_VALUE=$value awk -v key="$key" '
    BEGIN { value = ENVIRON["WIZARD_ENV_VALUE"]; replaced = 0 }
    $0 ~ ("^" key "=") {
      if (!replaced) print key "=" value
      replaced = 1
      next
    }
    { print }
    END { if (!replaced) print key "=" value }
  ' "$ENV_FILE" >"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}

set_secret() {
  local name=$1 value=$2
  command -v gh >/dev/null 2>&1 || {
    say "gh is not installed; skipped GitHub secret $name"
    return 0
  }
  printf '%s' "$value" | gh secret set "$name"
}

set_var() {
  local name=$1 value=$2
  command -v gh >/dev/null 2>&1 || {
    say "gh is not installed; skipped GitHub variable $name"
    return 0
  }
  printf '%s' "$value" | gh variable set "$name"
}

finish() {
  local status=$?
  if (( status == 0 )); then
    printf '\nWizard complete. %d/%d stages finished.\n' "$CURRENT_STAGE" "$TOTAL_STAGES"
  else
    printf '\nWizard stopped after stage %d/%d.\n' "$CURRENT_STAGE" "$TOTAL_STAGES" >&2
  fi
  exit "$status"
}
trap finish EXIT

# ── STAGES ──────────────────────────────────────────────────────────────────
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
PACKAGE=$(node -p "require('$REPO_DIR/package.json').name")
VERSION=$(node -p "require('$REPO_DIR/package.json').version")

cd "$REPO_DIR"

stage "Preflight"
say "Repository: $REPO_DIR"
say "Package: $PACKAGE@$VERSION"
step "This wizard will never store credentials or publish a later release."
step "First publication, if needed, is public and irreversible for this version."
[[ "$(git branch --show-current)" == "main" ]] || { say "Run from the main branch."; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { say "Worktree must be clean before release setup."; exit 1; }
command -v npm >/dev/null || { say "npm is required."; exit 1; }
npm whoami >/dev/null || { say "Log into npm first with npm login, then rerun this wizard."; exit 1; }

npm ci
npm test
npm run typecheck
npm audit
npm pack --dry-run

encoded_package=$(node -p "encodeURIComponent(require('./package.json').name)")
http_code=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "https://registry.npmjs.org/$encoded_package")
case "$http_code" in
  404)
    FIRST_PUBLISH_REQUIRED=1
    say "Package is not on npm yet; version $VERSION is the first publication candidate."
    ;;
  200)
    FIRST_PUBLISH_REQUIRED=0
    say "Package already exists on npm; skipping first-publication stage."
    ;;
  *)
    say "Registry lookup returned HTTP $http_code; refusing to assume the package is unpublished."
    exit 1
    ;;
esac

stage "First public publication"
if (( FIRST_PUBLISH_REQUIRED )); then
  say "This publishes $PACKAGE@$VERSION publicly. A published version cannot be overwritten."
  confirm "Publish this first version now?" || { say "Stopped before publishing."; exit 0; }
  npm publish --access public
  say "First version published. The next stage will stop because this version is now taken."
  say "Prepare and push the next version with green CI, then rerun this wizard before configuring the trusted publisher."
else
  say "The package already exists; no initial publish will be attempted."
fi

stage "Prepare the first OIDC release candidate"
version_code=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "https://registry.npmjs.org/$encoded_package/$VERSION")
case "$version_code" in
  404) ;;
  200)
    say "Current version $VERSION is already published. Bump package.json and package-lock.json, run checks, commit and push main, then rerun this wizard."
    exit 1
    ;;
  *)
    say "Version lookup returned HTTP $version_code; refusing to assume this version is available."
    exit 1
    ;;
esac
[[ -z "$(git status --porcelain)" ]] || { say "Worktree must be clean."; exit 1; }
git fetch origin
HEAD_SHA=$(git rev-parse HEAD)
[[ "$HEAD_SHA" == "$(git rev-parse origin/main)" ]] || { say "Push the release candidate to origin/main before configuring trusted publishing."; exit 1; }
command -v gh >/dev/null || { say "GitHub CLI is required to verify CI."; exit 1; }
CI_SUCCESS=$(gh run list --repo huaxel/pi-go-on --workflow CI --branch main --limit 20 --json headSha,status,conclusion --jq ".[] | select(.headSha == \"$HEAD_SHA\" and .status == \"completed\" and .conclusion == \"success\")")
[[ -n "$CI_SUCCESS" ]] || { say "No successful CI run found for $HEAD_SHA; wait for CI or fix it before continuing."; exit 1; }
say "Release candidate $PACKAGE@$VERSION is pushed to main and CI is green."
pause "Press Enter to open the npm trusted-publisher settings"

stage "Configure npm trusted publishing"
open_url "https://www.npmjs.com/package/$PACKAGE/access"
say "In the package's Trusted Publisher settings, choose GitHub Actions and enter:"
step "Organization/user: huaxel"
step "Repository: pi-go-on"
step "Workflow filename: publish.yml (filename only)"
step "Environment: npm-release"
step "Allowed action: npm publish"
say "The first successful OIDC publish must complete within two days of creating this configuration."
pause "Complete the npm setup, then press Enter"

stage "Configure GitHub release protection"
open_url "https://github.com/huaxel/pi-go-on/settings/environments/new"
say "Create the GitHub environment named exactly: npm-release"
say "Restrict deployment branches/tags to the selected branch main; this is required to prevent non-main workflows from publishing."
say "Optionally require reviewers if you want an additional approval gate before publication."
pause "Complete the environment setup, then press Enter"

stage "Review and hand off"
say "The release workflow is manual-only and will publish the current version on main."
say "Review that version and commit once more before triggering it; npm will publish publicly and the version cannot be reused."
say "When ready, open https://github.com/huaxel/pi-go-on/actions/workflows/publish.yml and manually run Publish to npm on main."
say "This wizard did not dispatch the workflow or publish a second version."
