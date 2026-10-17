// Verify go-on's shortcut registrations against pi's real reserved-key logic.
// This is the check the extension header describes: a shortcut that collides
// with a pi built-in is silently swallowed, so the burst key would stop working.
//
// Resolves pi from the installed dev dependency, so it runs in CI and on a
// fresh checkout instead of depending on a developer's global install.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const piRoot = `${root}node_modules/@earendil-works/pi-coding-agent`;
const tuiRoot = `${root}node_modules/@earendil-works/pi-tui`;

const { KEYBINDINGS } = await import(pathToFileURL(`${piRoot}/dist/core/keybindings.js`).href);
const { TUI_KEYBINDINGS } = await import(pathToFileURL(`${tuiRoot}/dist/keybindings.js`).href);
const { matchesKey, setKittyProtocolActive } = await import(pathToFileURL(`${tuiRoot}/dist/keys.js`).href);

// Exact copy of the reserved list from pi's dist/core/extensions/runner.js.
const RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS = [
  "app.interrupt", "app.clear", "app.exit", "app.suspend", "app.thinking.cycle",
  "app.model.cycleForward", "app.model.cycleBackward", "app.model.select",
  "app.tools.expand", "app.thinking.toggle", "app.editor.external", "app.message.copy",
  "app.message.followUp", "tui.input.submit", "tui.select.confirm", "tui.select.cancel",
  "tui.input.copy", "tui.editor.deleteToLineEnd",
];

function buildBuiltinKeybindings(resolvedKeybindings) {
  const builtinKeybindings = {};
  for (const [keybinding, keys] of Object.entries(resolvedKeybindings)) {
    if (keys === undefined) continue;
    const keyList = Array.isArray(keys) ? keys : [keys];
    const restrictOverride = RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS.includes(keybinding);
    for (const key of keyList) {
      const normalizedKey = key.toLowerCase();
      const existing = builtinKeybindings[normalizedKey];
      if (existing?.restrictOverride && !restrictOverride) continue;
      builtinKeybindings[normalizedKey] = { keybinding, restrictOverride };
    }
  }
  return builtinKeybindings;
}

const resolved = { ...KEYBINDINGS, ...TUI_KEYBINDINGS };
const effectiveConfig = {};
for (const [id, def] of Object.entries(resolved)) effectiveConfig[id] = def.defaultKeys ?? [];
const builtin = buildBuiltinKeybindings(effectiveConfig);

// The keys the extension registers, including the plain-alt fallbacks for SSH
// clients that drop the Ctrl bit on Ctrl+Alt chords.
const GO_ON_KEYS = ["ctrl+alt+n", "ctrl+alt+g", "alt+n", "alt+g"];

test("go-on shortcuts are free of reserved pi built-ins", () => {
  for (const key of GO_ON_KEYS) {
    const claim = builtin[key.toLowerCase()];
    assert.notEqual(claim?.restrictOverride, true, `${key} is claimed by reserved built-in ${claim?.keybinding}`);
  }
});

test("each legacy terminal byte sequence matches exactly one go-on key", () => {
  // The no-double-fire property: ctrl+alt chords and plain-alt fallbacks must
  // not both fire for one byte sequence.
  setKittyProtocolActive(false);
  const cases = [
    ["\x1b\x07", "ctrl+alt+g", true],
    ["\x1b\x07", "alt+g", false],
    ["\x1b\x0e", "ctrl+alt+n", true],
    ["\x1b\x0e", "alt+n", false],
    ["\x1bg", "alt+g", true],
    ["\x1bg", "ctrl+alt+g", false],
    ["\x1bn", "alt+n", true],
    ["\x1bn", "ctrl+alt+n", false],
    ["\x1b\r", "ctrl+alt+g", false],
    ["\x1b\r", "ctrl+alt+n", false],
  ];
  for (const [bytes, key, expected] of cases) {
    assert.equal(matchesKey(bytes, key), expected, `${JSON.stringify(bytes)} vs ${key}`);
  }
});
