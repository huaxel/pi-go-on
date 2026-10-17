# pi-go-on

Goal-aware autonomous continuation for [Pi](https://github.com/earendil-works/pi). A single nudge or bounded auto burst asks Pi to keep advancing the user's original outcome, rather than treating "go on" as an open-ended request to invent more work.

## Install

```bash
pi install npm:@juanbenjumea/pi-go-on
```

The extension does not start background work on its own. You explicitly start continuation with a shortcut or command.

## Controls

| Control | Action |
|---|---|
| `Ctrl+Alt+N` (`Alt+N` fallback) | Send one goal-aware continuation prompt |
| `Ctrl+Alt+G` (`Alt+G` fallback) | Start/stop auto mode; it nudges after each settled run |
| `/go-on mode` | Start or continue auto mode |
| `/go-on-mode [on|off]` | Explicitly control auto mode |

Press the burst shortcut again, run `/go-on-mode off`, or interrupt the active run to stop. Auto mode also disarms on completion, errors, aborts, repeated no-progress verbal turns, or after 15 nudges.

## Continuation policy

Each nudge asks Pi to inspect what is complete, select one high-value next step toward the original outcome, and verify it. It treats the outcome and explicit deliverables as requirements without assuming the proposed means are; a better in-scope route is welcome, while creative intent should be preserved. It encourages deeper—not broader—work: check consequential assumptions against primary evidence, use concrete domain-appropriate methods, and seek independent or reproducible validation where useful. Cross-field techniques should address a specific weakness, not become role-play or extra deliverables. The agent should preserve the original scope, avoid repeating work or manufacturing adjacent tasks, and stop when blocked or when a real decision or approval is needed. It must not take high-impact actions such as deleting data, publishing, deploying, committing, or pushing without explicit authorization.

Auto mode is intentionally bounded and heuristic. The extension's completion detection is phrase-based; the model still decides whether the task is actually complete or blocked. Keep the burst limit and user-visible stop control in mind for long runs.

## Development

```bash
npm ci
npm test
npm run typecheck
```

For the one-time npm bootstrap and trusted-publishing setup, see [RELEASING.md](RELEASING.md) and run `./scripts/npm-release-setup.sh` from a checkout. The wizard asks for confirmation before the initial irreversible npm publish and never stores credentials.

## License

MIT
