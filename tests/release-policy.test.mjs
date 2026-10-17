import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const workflow = await readFile(`${root}.github/workflows/publish.yml`, "utf8");
const wizard = await readFile(`${root}scripts/npm-release-setup.sh`, "utf8");

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
  assert.ok(!/gh workflow run|gh api .*workflow_dispatch/.test(wizard));
});
