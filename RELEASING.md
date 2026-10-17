# Releasing

Publishing is a deliberate manual action. CI does not publish on pushes or tags.

## One-time setup

1. Push the reviewed `main` branch to the existing public GitHub repository `huaxel/pi-go-on`.
2. Create the npm package `@juanbenjumea/pi-go-on` through npm's trusted-publisher setup, pointing to repository `huaxel/pi-go-on` and workflow `.github/workflows/publish.yml`.
3. Configure the GitHub `npm-release` environment with required reviewers if approval should be required before a publish run.

## Each release

1. Review the changes and update `version` in `package.json` and the matching lockfile metadata.
2. Confirm CI passes on `main` and the npm package version is unused.
3. From GitHub Actions, manually run **Publish to npm** on the reviewed `main` branch. The workflow repeats tests, typecheck, audit, and pack checks before publishing with provenance.
4. Verify the resulting npm version and provenance page. Do not rerun a failed publish without checking whether that version was already published.

No publish workflow was run during package preparation.
