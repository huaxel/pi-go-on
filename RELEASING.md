# Releasing

## Current state

Trusted publishing is configured and validated; the release path is complete.

- `0.1.0` was the manual first publish. The registry also holds `0.0.0-stage`, npm's placeholder from the staged first publish: it has no dist-tag and nothing resolves to it. Leave it alone.
- `0.1.1` is `latest`, published by the **Publish to npm** workflow through OIDC with a signed SLSA provenance attestation. This validated the trusted publisher.
- The `npm-release` environment exists and is restricted to the `main` branch. No required reviewers are configured.
- The published tarball was checked against the repository: `0.1.1`'s `index.ts` is byte-identical to `main`, its shasum matches the CI build output, and `./scripts/verify-release.sh` reports it verified end to end.

Run `./scripts/npm-release-setup.sh` from a clean `main` checkout for the staged one-time npm bootstrap. It stops after the initial publish so the next version can be prepared and pushed before trusted-publisher setup. Publishing is a deliberate manual action. CI does not publish on pushes or tags.

## First publication and trusted-publisher setup

npm requires the package to exist before a trusted publisher can be configured. The initial publish is therefore a one-time manual action; no npm publish was performed during repository preparation.

1. Review `main`, confirm version `0.1.0` is unused, and run `npm ci`, tests, typecheck, audit, and pack checks.
2. With the maintainer's npm account, log in with `npm login` and run `npm publish --access public` from this repository. Complete npm's requested authentication/2FA. This is a human-only interactive step: npm does not support OIDC for a package's first publish, and the trusted-publisher settings page only exists once the package does. The action is irreversible for that version.
3. Prepare the next version (for example, `0.1.1`): update `package.json` and lockfile, run all checks, commit and push to `main`, and wait for CI to pass. Do this before configuring trusted publishing so the first OIDC publish can validate the publisher promptly.
4. Configure the package's trusted publisher at npmjs.com → package `@juanbenjumea/pi-go-on` → Settings → Trusted Publisher:
   - Provider: GitHub Actions
   - Organization/user: `huaxel`
   - Repository: `pi-go-on`
   - Workflow filename: `publish.yml` (filename only, not the `.github/workflows/` path)
   - Environment: `npm-release`
   - Allowed action: `npm publish`

   The CLI equivalent, after `npm login` with 2FA enabled on the account (requires npm CLI 11.15.0+ and an existing package), is:

   ```bash
   npm trust github @juanbenjumea/pi-go-on \
     --file publish.yml --repo huaxel/pi-go-on --env npm-release --allow-publish
   ```

5. Configure the GitHub `npm-release` environment to restrict deployments to the `main` branch. Optionally add required reviewers as an additional approval gate. The workflow also refuses runs not dispatched from `main`. The first trusted-publisher publish must succeed within npm's two-day validation window.

## Each later release

1. Review the changes and update `version` in `package.json` and the matching lockfile metadata.
2. Confirm CI passes on `main` and the npm package version is unused.
3. For the initial OIDC validation, within two days of configuring the trusted publisher, manually run **Publish to npm** on the reviewed `main` branch. For later releases, run it after CI passes for the intended version. The workflow repeats tests, typecheck, audit, and pack checks before publishing via npm's OIDC trusted-publishing support.
4. Verify the release with `./scripts/verify-release.sh`, which checks the registry metadata, the provenance attestation, the downloaded tarball bytes against the registry shasum, working-tree parity, and that the published extension loads and registers its command in a real Pi runtime. Do not rerun a failed publish without checking whether that version was already published.

## Diagnosing an OIDC publish failure

Attempting the workflow before the trusted publisher exists fails at the final step and publishes nothing (verified twice):

- `npm error code ENEEDAUTH ... need auth` — npm had no trusted-publisher match for this workflow identity. Check the configured organization/user, repository, workflow filename, and environment name against the values above; all four are case-sensitive and must match exactly.
- `npm error code E404 ... PUT ... could not be found or you do not have permission` — an npm token, not OIDC, was used. Keep `registry-url` out of `actions/setup-node`, because it writes an `_authToken` placeholder that preempts OIDC authentication.

Everything before the publish step (tests, typecheck, audit, pack, script syntax, runtime load check) runs and passes in the failing runs, so an auth failure means the release itself is fine and only the publisher configuration is missing or mismatched.

The publish workflow is manual-only. Trusted publishing automatically generates provenance for eligible public releases; it does not require a long-lived npm token or `--provenance` flag.

Consumers on an unpinned install (what the README's `pi install` produces) pick up a new version with `pi update --extensions`; a versioned install such as `npm:@juanbenjumea/pi-go-on@0.1.0` stays pinned by design until the settings entry changes.
