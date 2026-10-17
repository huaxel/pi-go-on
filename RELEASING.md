# Releasing

Run `./scripts/npm-release-setup.sh` from a clean `main` checkout for the staged one-time npm bootstrap. It stops after the initial publish so the next version can be prepared and pushed before trusted-publisher setup. Publishing is a deliberate manual action. CI does not publish on pushes or tags.

## First publication and trusted-publisher setup

npm requires the package to exist before a trusted publisher can be configured. The initial publish is therefore a one-time manual action; no npm publish was performed during repository preparation.

1. Review `main`, confirm version `0.1.0` is unused, and run `npm ci`, tests, typecheck, audit, and pack checks.
2. With the maintainer's npm account, run `npm publish --access public` from this repository. Complete npm's requested authentication/2FA. This action is irreversible for that version.
3. Prepare the next version (for example, `0.1.1`): update `package.json` and lockfile, run all checks, commit and push to `main`, and wait for CI to pass. Do this before configuring trusted publishing so the first OIDC publish can validate the publisher promptly.
4. Configure the package's trusted publisher at npmjs.com → package `@juanbenjumea/pi-go-on` → Settings → Trusted Publisher:
   - Provider: GitHub Actions
   - Organization/user: `huaxel`
   - Repository: `pi-go-on`
   - Workflow filename: `publish.yml` (filename only, not the `.github/workflows/` path)
   - Environment: `npm-release`
   - Allowed action: `npm publish`
5. Configure the GitHub `npm-release` environment with required reviewers if approval should be required before future publish runs. The first trusted-publisher publish must succeed within npm's two-day validation window.

## Each later release

1. Review the changes and update `version` in `package.json` and the matching lockfile metadata.
2. Confirm CI passes on `main` and the npm package version is unused.
3. For the initial OIDC validation, within two days of configuring the trusted publisher, manually run **Publish to npm** on the reviewed `main` branch. For later releases, run it after CI passes for the intended version. The workflow repeats tests, typecheck, audit, and pack checks before publishing via npm's OIDC trusted-publishing support.
4. Verify the resulting npm version and provenance page. Do not rerun a failed publish without checking whether that version was already published.

The publish workflow is manual-only. Trusted publishing automatically generates provenance for eligible public releases; it does not require a long-lived npm token or `--provenance` flag.
