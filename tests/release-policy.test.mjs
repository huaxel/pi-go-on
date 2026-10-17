import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const workflow = await readFile(`${root}.github/workflows/publish.yml`, "utf8");
const wizard = await readFile(`${root}scripts/npm-release-setup.sh`, "utf8");
const manifest = JSON.parse(await readFile(`${root}package.json`, "utf8"));
const releasing = await readFile(`${root}RELEASING.md`, "utf8");

test("every README link resolves for someone reading the published package", async () => {
  const readme = await readFile(`${root}README.md`, "utf8");
  const shipped = manifest.files ?? [];
  const targets = [...readme.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(targets.length > 0, "expected at least one README link");
  for (const target of targets) {
    if (/^https?:/.test(target)) continue;
    const relative = target.replace(/^[.][/]/, "");
    // A relative link is only readable on npm if the file ships in the tarball.
    assert.ok(
      shipped.includes(relative),
      `README links to ${target}, which is not in "files", so it 404s on npm; use a repository URL instead`,
    );
  }
});

test("the release guide keeps pointing at the published-release check", () => {
  assert.match(releasing, /verify-release\.sh/, "RELEASING.md must document the post-publish verification command");
});

test("a direct npm publish still runs the tests and typecheck", () => {
  assert.match(
    manifest.scripts?.prepublishOnly ?? "",
    /npm test/,
    "prepublishOnly must run the tests: the first release was published by hand outside every gate",
  );
  assert.match(manifest.scripts.prepublishOnly, /typecheck/);
});

test("npm publication is manual and restricted to main", () => {
  assert.match(workflow, /on:\n\s+workflow_dispatch:/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: npm-release/);
  assert.ok(workflow.indexOf("npm test") < workflow.indexOf("npm publish --access public"));
  assert.ok(
    workflow.indexOf("verify-load.sh") < workflow.indexOf("npm publish --access public"),
    "the load check must run before publishing",
  );
  const guard = workflow.indexOf("Refuse to republish an existing version");
  assert.ok(guard >= 0 && guard < workflow.indexOf("npm publish --access public"), "a republish guard must run before publishing");
  assert.match(workflow, /already exists on npm/);
  assert.match(workflow, /concurrency:\n\s+group: npm-publish-/, "release runs must be serialized");
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /VERIFY_FROM_TARBALL=1/, "the publish workflow must load-check the real tarball");
  assert.ok(workflow.indexOf("npm audit") < workflow.indexOf("npm publish --access public"));
  assert.ok(!workflow.includes("NODE_AUTH_TOKEN"));
});

test("bootstrap wizard gates the irreversible first publish and never dispatches later releases", () => {
  const confirmation = wizard.indexOf('confirm "Publish this first version now?"');
  const initialPublish = wizard.indexOf("npm publish --access public");
  assert.ok(confirmation >= 0 && initialPublish > confirmation);
  assert.match(wizard, /deployment branches\/tags to the selected branch main/);
  assert.ok(
    wizard.indexOf("./scripts/verify-load.sh") < wizard.indexOf("npm publish --access public"),
    "the bootstrap wizard must load-check before the first publish",
  );
  assert.ok(
    wizard.indexOf("VERIFY_FROM_TARBALL=1") < wizard.indexOf("npm publish --access public"),
    "the bootstrap wizard must load-check the packed tarball before publishing",
  );
  assert.ok(!/gh workflow run|gh api .*workflow_dispatch/.test(wizard));
});
