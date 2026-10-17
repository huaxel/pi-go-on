// Behavioral tests for go-on.ts. Run: node pi/agent/extensions/go-on.test.mjs
// (from the repo root). Mocks the pi extension API; no pi install needed.
import goOn from "../index.ts";

const harnesses = [];
// Ensure watchdog timers are cleared even when the suite fails: harness
// shutdown handlers are synchronous, so they still run on process exit.
process.on("exit", () => {
  for (const h of harnesses) h.events.get("session_shutdown")({}, h.ctx);
});

function makeHarness({ model = {}, auth = { ok: true }, getAuth = async () => auth } = {}) {
  const events = new Map();
  const shortcuts = new Map();
  const commands = new Map();
  const sent = [];
  const statuses = [];
  const notifications = [];
  let branch = [];
  let idle = true;
  const pi = {
    sendUserMessage: (...args) => sent.push(args),
    on: (name, handler) => events.set(name, handler),
    registerShortcut: (name, options) => shortcuts.set(name, options.handler),
    registerCommand: (name, options) => commands.set(name, options.handler),
  };
  const ctx = {
    isIdle: () => idle,
    model,
    modelRegistry: { getApiKeyAndHeaders: getAuth },
    sessionManager: { getBranch: () => branch },
    ui: {
      setStatus: (key, value) => statuses.push([key, value]),
      notify: (message, type) => notifications.push([message, type]),
    },
  };
  goOn(pi);
  const harness = { events, shortcuts, commands, sent, statuses, notifications, ctx, setBranch: (value) => { branch = value; }, setIdle: (value) => { idle = value; } };
  harnesses.push(harness);
  return harness;
}

const BURST = "ctrl+alt+g"; // the one burst key on every platform
const NUDGE = "ctrl+alt+n"; // the one nudge key on every platform
const BURST_ALT = "alt+g"; // fallback for SSH clients that drop the Ctrl bit
const NUDGE_ALT = "alt+n";
const CONTINUATION_PROMPT = "Continue autonomously toward the outcome I originally asked for.";
const assistant = (text, stopReason = "stop") => ({ type: "message", message: { role: "assistant", content: [{ type: "text", text }], stopReason } });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const assertContinuationPrompt = (prompt, message) => {
  assert(prompt.startsWith(CONTINUATION_PROMPT), `${message}: missing goal anchor`);
  for (const requirement of [
    "do not repeat completed work",
    "carry it through verification",
    "Treat the outcome and explicit deliverables as requirements",
    "choose a better route within scope",
    "Preserve creative intent",
    "Deepen, don't enlarge",
    "challenge consequential assumptions against primary evidence",
    "use concrete domain-appropriate methods",
    "seek an independent or reproducible check where useful",
    "Borrow another field's technique only when it addresses a specific weakness",
    "don't role-play experts",
    "do not broaden the task",
    "materially change scope, cost, risk, or commitments without approval",
    "without explicit authorization",
    "If blocked or a decision/approval is genuinely needed, stop",
  ]) {
    assert(prompt.includes(requirement), `${message}: missing ${requirement}`);
  }
};

// Four keys are registered: nudge + burst, each with a plain-alt fallback.
{
  const h = makeHarness();
  const keys = [...h.shortcuts.keys()].sort();
  assert(
    keys.length === 4 &&
      keys.includes(NUDGE) &&
      keys.includes(BURST) &&
      keys.includes(NUDGE_ALT) &&
      keys.includes(BURST_ALT),
    `unexpected key set: ${keys.join(", ")}`,
  );
  // Fallbacks must behave identically to their primary chord.
  const hBurst = makeHarness();
  await hBurst.shortcuts.get(BURST_ALT)(hBurst.ctx);
  assert(hBurst.sent.length === 1, "alt+g fallback did not send its burst nudge");
  const hNudge = makeHarness();
  await hNudge.shortcuts.get(NUDGE_ALT)(hNudge.ctx);
  assert(hNudge.sent.length === 1, "alt+n fallback did not send its nudge");
}

// Plain toggle (command) arms AND sends an initial nudge, like the burst key;
// the burst key pressed while armed is the toggle-off.
{
  const h = makeHarness();
  await h.commands.get("go-on-mode")("on", h.ctx);
  assert(h.sent.length === 1, "toggle did not send its continuation prompt");
  assertContinuationPrompt(h.sent[0][0], "toggle prompt");
  assert(h.statuses.at(-1)?.[1] === "go-on: armed (1)", "toggle did not arm");
  await h.shortcuts.get(BURST)(h.ctx);
  assert(h.statuses.at(-1)?.[1] === undefined, "burst key did not disarm when armed");
}

// Bare toggle with no argument turns mode on with a nudge, and again to turn off.
{
  const h = makeHarness();
  await h.commands.get("go-on-mode")("", h.ctx);
  assert(h.sent.length === 1, "bare toggle did not send its initial nudge");
  await h.commands.get("go-on-mode")("", h.ctx);
  assert(h.statuses.at(-1)?.[1] === undefined, "second bare toggle did not disarm");
  assert(h.sent.length === 1, "toggle-off sent a nudge");
}

// /go-on mode: nudge + arm, without registering a bare /go-on command.
{
  const h = makeHarness();
  assert(!h.commands.has("go-on"), "bare /go-on command was registered");
  const input = h.events.get("input");
  const result = await input({ text: "/go-on mode" }, h.ctx);
  assert(result?.action === "handled", "/go-on mode input was not handled");
  assert(h.sent.length === 1, "/go-on mode did not send its continuation prompt");
  assertContinuationPrompt(h.sent[0][0], "/go-on mode prompt");
  assert(h.statuses.at(-1)?.[1] === "go-on: armed (1)", "/go-on mode did not arm");
  h.events.get("agent_start")({}, h.ctx);
  await input({ text: "/go-on mode" }, h.ctx);
  assert(h.sent.length === 2, "repeating /go-on mode did not send another nudge");
  assert(h.statuses.at(-1)?.[1] === "go-on: armed (2)", "repeating /go-on mode toggled mode off");
}

// Plain /go-on is not intercepted and has no action.
{
  const h = makeHarness();
  const result = await h.events.get("input")({ text: "/go-on" }, h.ctx);
  assert(result === undefined, "plain /go-on was intercepted");
  assert(h.sent.length === 0 && h.statuses.length === 0 && h.notifications.length === 0, "plain /go-on acted");
}

// Burst from idle: nudge + arm; second press disarms.
{
  const h = makeHarness();
  await h.shortcuts.get(BURST)(h.ctx);
  assert(h.sent.length === 1, "burst did not send an initial nudge");
  assert(h.statuses.at(-1)?.[1] === "go-on: armed (1)", "burst did not arm");
  await h.shortcuts.get(BURST)(h.ctx);
  assert(h.statuses.at(-1)?.[1] === undefined, "second burst press did not disarm");
}

// Completion is honored even after tool work.
{
  const h = makeHarness();
  await h.shortcuts.get(BURST)(h.ctx);
  h.events.get("tool_execution_end")({}, h.ctx);
  h.setBranch([assistant("All done.")]);
  await h.events.get("agent_settled")({}, h.ctx);
  assert(h.sent.length === 1, "tool-free completion should not receive another nudge");
}

// Completion suffixes are not mistaken for completion declarations.
{
  const h = makeHarness();
  await h.shortcuts.get(BURST)(h.ctx);
  h.setBranch([assistant("The task is incomplete.")]);
  await h.events.get("agent_settled")({}, h.ctx);
  assert(h.sent.length === 2, "incomplete was incorrectly treated as complete");
}

// Generic phase completion and natural negation do not stop the burst.
for (const text of ["The first phase is complete.", "The work is not yet complete.", "Not everything is complete."]) {
  const h = makeHarness();
  await h.shortcuts.get(BURST)(h.ctx);
  h.setBranch([assistant(text)]);
  await h.events.get("agent_settled")({}, h.ctx);
  assert(h.sent.length === 2, `${text} was incorrectly treated as overall completion`);
}

// Subject-qualified "all set"/"wrapped up" are NOT overall completion.
for (const text of ["The environment is all set.", "Phase one is wrapped up.", "The first phase is wrapped up"]) {
  const h = makeHarness();
  await h.shortcuts.get(BURST)(h.ctx);
  h.setBranch([assistant(text)]);
  await h.events.get("agent_settled")({}, h.ctx);
  assert(h.sent.length === 2, `${text} was incorrectly treated as overall completion`);
}

// Overall-task subject or standalone "all set"/"wrapped up" DO complete.
for (const text of ["The task is all set.", "All set.", "Wrapped up."]) {
  const h = makeHarness();
  await h.shortcuts.get(BURST)(h.ctx);
  h.setBranch([assistant(text)]);
  await h.events.get("agent_settled")({}, h.ctx);
  assert(h.sent.length === 1, `${text} was not treated as completion`);
}

const positive = makeHarness();
await positive.shortcuts.get(BURST)(positive.ctx);
positive.setBranch([assistant("The work is done.")]);
await positive.events.get("agent_settled")({}, positive.ctx);
assert(positive.sent.length === 1, "subject-based completion was missed");

// Concurrent idle nudges collapse to one request.
{
  const h = makeHarness();
  await Promise.all([h.shortcuts.get(NUDGE)(h.ctx), h.shortcuts.get(NUDGE)(h.ctx)]);
  assert(h.sent.length === 1, "concurrent idle nudges overlapped");
}

// The nudge key sends a single "go on" and can nudge again after agent_start.
{
  const h = makeHarness();
  await h.shortcuts.get(NUDGE)(h.ctx);
  assert(h.sent.length === 1, "nudge did not send its continuation prompt");
  assertContinuationPrompt(h.sent[0][0], "single nudge prompt");
  // The real pi fires agent_start when the prompt starts, clearing the
  // idle-pending guard; simulate it so the second press can nudge again.
  h.events.get("agent_start")({}, h.ctx);
  await h.shortcuts.get(NUDGE)(h.ctx);
  assert(h.sent.length === 2, "nudge did not send a second nudge after agent_start");
}

// Invalid mode arguments are rejected.
{
  const h = makeHarness();
  await h.commands.get("go-on-mode")("typo", h.ctx);
  assert(h.sent.length === 0, "invalid mode argument sent a nudge");
  assert(h.notifications.at(-1)?.[1] === "warning", "invalid mode argument lacked warning");
}

// Missing model disarms the burst rather than leaving mode armed.
{
  const h = makeHarness({ model: null });
  await h.shortcuts.get(BURST)(h.ctx);
  assert(h.sent.length === 0, "missing model sent a nudge");
  assert(h.statuses.at(-1)?.[1] === undefined, "missing model left mode armed");
}

// Keys that must stay unregistered: alt+enter is reserved by pi,
// alt+shift chords cannot be encoded on legacy terminals, ctrl+alt+o is
// unused, and alt+g / alt+n are deliberate Termius fallbacks (SSH clients
// drop the Ctrl bit on Ctrl+Alt chords), so they are NOT banned.
{
  const h = makeHarness();
  for (const banned of ["alt+enter", "alt+shift+enter", "alt+shift+g", "ctrl+alt+o"]) {
    assert(!h.shortcuts.has(banned), `go-on still registers banned key ${banned}`);
  }
}

// User abort and model errors disarm immediately — never undo an Esc or burn calls.
for (const reason of ["aborted", "error"]) {
  const h = makeHarness();
  await h.shortcuts.get(BURST)(h.ctx);
  h.events.get("tool_execution_end")({}, h.ctx);
  h.setBranch([assistant("Working on it.", reason)]);
  await h.events.get("agent_settled")({}, h.ctx);
  assert(h.sent.length === 1, `${reason} did not disarm the burst`);
  assert(h.statuses.at(-1)?.[1] === undefined, `${reason} left mode armed`);
}

// Runs that stopped mid-tool-use or were truncated get nudged even without a
// tool_execution_end in the window.
for (const reason of ["toolUse", "length"]) {
  const h = makeHarness();
  await h.shortcuts.get(BURST)(h.ctx);
  h.events.get("agent_start")({}, h.ctx);
  h.setBranch([assistant("Continuing.", reason)]);
  await h.events.get("agent_settled")({}, h.ctx);
  assert(h.sent.length === 2, `${reason} was not nudged`);
}

// Two consecutive purely verbal answers end the burst: the first is treated
// as a pause, the second as done.
{
  const h = makeHarness();
  await h.shortcuts.get(BURST)(h.ctx);
  h.events.get("agent_start")({}, h.ctx);
  h.setBranch([assistant("Done with step 1.")]);
  await h.events.get("agent_settled")({}, h.ctx);
  assert(h.sent.length === 2, "first verbal pause was not nudged");
  h.events.get("agent_start")({}, h.ctx);
  h.setBranch([assistant("Still just talking.")]);
  await h.events.get("agent_settled")({}, h.ctx);
  assert(h.sent.length === 2, "second verbal answer did not end the burst");
  assert(h.statuses.at(-1)?.[1] === undefined, "verbal streak left mode armed");
}

// The nudge cap disarms runaway bursts.
{
  const h = makeHarness();
  await h.shortcuts.get(BURST)(h.ctx);
  for (let i = 0; i < 20; i++) {
    h.events.get("agent_start")({}, h.ctx);
    h.events.get("tool_execution_end")({}, h.ctx);
    h.setBranch([assistant(`Still working ${i}.`)]);
    await h.events.get("agent_settled")({}, h.ctx);
  }
  assert(h.sent.length === 15, `cap did not hold at 15 nudges total (sent ${h.sent.length})`);
  assert(h.statuses.at(-1)?.[1] === undefined, "cap left mode armed");
  assert(h.notifications.some(([m]) => m.includes("nudge cap reached")), "cap gave no notice");
}

// Auth failure during an armed burst disarms instead of wedging mode on.
{
  const h = makeHarness({ auth: { ok: false } });
  await h.shortcuts.get(BURST)(h.ctx);
  assert(h.sent.length === 0, "failed auth sent a nudge");
  assert(h.statuses.at(-1)?.[1] === undefined, "failed auth left mode armed");
  assert(h.notifications.some(([m]) => m.includes("authentication unavailable")), "failed auth gave no notice");
}

// Shutdown clears the status pill so it cannot linger into the next session.
{
  const h = makeHarness();
  await h.commands.get("go-on-mode")("on", h.ctx);
  assert(h.statuses.at(-1)?.[1] === "go-on: armed (1)", "toggle did not arm");
  await h.events.get("session_shutdown")({}, h.ctx);
  assert(h.statuses.at(-1)?.[1] === undefined, "shutdown left a stale status");
  h.setBranch([assistant("Hello.")]);
  await h.events.get("agent_settled")({}, h.ctx);
  assert(h.sent.length === 1, "shutdown left mode armed");
}

// Off/on invalidates the old auth request, regardless of resolution order or
// auth outcome. A stale request must not send, disarm, or clear the new guard.
for (const oldFirst of [true, false]) {
  for (const oldOk of [true, false]) {
    const resolvers = [];
    const h = makeHarness({ getAuth: () => new Promise((resolve) => resolvers.push(resolve)) });
    try {
      const first = h.commands.get("go-on-mode")("on", h.ctx);
      await h.commands.get("go-on-mode")("off", h.ctx);
      const second = h.commands.get("go-on-mode")("on", h.ctx);
      if (oldFirst) {
        resolvers[0]({ ok: oldOk });
        await first;
        assert(h.sent.length === 0, "cancelled request sent before the new auth resolved");
        assert(h.statuses.at(-1)?.[1] === "go-on: armed", "stale auth disarmed the new burst");
        const duplicate = h.shortcuts.get(NUDGE)(h.ctx);
        assert(resolvers.length === 2, "stale auth cleared the new pending guard");
        await duplicate;
        resolvers[1]({ ok: true });
        await second;
      } else {
        resolvers[1]({ ok: true });
        await second;
        resolvers[0]({ ok: oldOk });
        await first;
      }
      assert(h.sent.length === 1, "off/on during auth sent more than one surviving nudge");
      assert(h.statuses.at(-1)?.[1] === "go-on: armed (1)", "stale auth changed the new burst state");
    } finally {
      await h.events.get("session_shutdown")({}, h.ctx);
    }
  }
}

// Cancellation without rearming also prevents a pending request from sending.
for (const cancel of ["off", "shutdown"]) {
  let resolveAuth;
  const h = makeHarness({ getAuth: () => new Promise((resolve) => { resolveAuth = resolve; }) });
  const pending = h.commands.get("go-on-mode")("on", h.ctx);
  if (cancel === "off") await h.commands.get("go-on-mode")("off", h.ctx);
  else await h.events.get("session_shutdown")({}, h.ctx);
  resolveAuth({ ok: true });
  await pending;
  assert(h.sent.length === 0, `${cancel} did not cancel pending auth`);
  assert(h.statuses.at(-1)?.[1] === undefined, `${cancel} restored a stale status`);
}

// Negation applies to the entire completion phrase, including its qualifiers.
for (const text of ["I'm not done with everything.", "I'm not done here.", "I am not yet done here.", "We aren't done here.", "They weren't done with everything."]) {
  const h = makeHarness();
  try {
    await h.shortcuts.get(BURST)(h.ctx);
    h.setBranch([assistant(text)]);
    await h.events.get("agent_settled")({}, h.ctx);
    assert(h.sent.length === 2, `${text} incorrectly disarmed unfinished work`);
  } finally {
    await h.events.get("session_shutdown")({}, h.ctx);
  }
}

// Qualified completion still stops; a preceding negative sentence does not
// negate the final declaration.
for (const text of ["I'm done here.", "I'm done with everything.", "It wasn't easy. I'm done here.", "It wasn't easy, but I'm done here."]) {
  const h = makeHarness();
  try {
    await h.shortcuts.get(BURST)(h.ctx);
    h.setBranch([assistant(text)]);
    await h.events.get("agent_settled")({}, h.ctx);
    assert(h.sent.length === 1, `${text} did not stop completed work`);
  } finally {
    await h.events.get("session_shutdown")({}, h.ctx);
  }
}

// Pi shuts down session resources; do the same for every mock so pending
// start-watchdog timers do not keep the test process alive for 60 seconds.
for (const h of harnesses) await h.events.get("session_shutdown")({}, h.ctx);

// A foreign agent_start while an auto nudge is still awaiting auth clears
// the pending guard; the stale request no-ops, and the burst resumes at that
// run's settle instead of wedging in the armed state.
{
  const resolvers = [];
  const h = makeHarness({ getAuth: () => new Promise((resolve) => resolvers.push(resolve)) });
  try {
    const pending = h.shortcuts.get(BURST)(h.ctx);
    while (resolvers.length === 0) await Promise.resolve(); // let the async chain reach auth
    h.events.get("agent_start")({}, h.ctx);
    resolvers[0]({ ok: true });
    await pending;
    assert(h.sent.length === 0, "superseded request sent its nudge");
    h.events.get("tool_execution_end")({}, h.ctx);
    h.setBranch([assistant("Still working.")]);
    const settled = h.events.get("agent_settled")({}, h.ctx);
    resolvers[1]({ ok: true });
    await settled;
    assert(h.sent.length === 1, "burst did not resume after the foreign run settled");
    assert(h.statuses.at(-1)?.[1] === "go-on: armed (1)", "burst state wrong after resume");
  } finally {
    await h.events.get("session_shutdown")({}, h.ctx);
  }
}

console.log("go-on behavioral checks passed");
