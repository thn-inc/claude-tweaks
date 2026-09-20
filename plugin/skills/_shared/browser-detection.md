# Browser Detection — Shared

Detection + install procedure for `playwright-cli`, used by /browse, /init, /visual-review. `playwright-cli` is the only backend this procedure detects, installs, or auto-selects; do not prompt the user for a backend choice. (The narrow, human-invoked `/browse backend=chrome` escape hatch is a separate, manual path — see CLAUDE.md's `Don'ts` — and out of scope for this file.)

## Detect

Run via the Bash tool:

```bash
npx --no-install playwright-cli --version
```

If the command succeeds, confirm the version and return OK. If it fails (not installed) or returns a version below a skill-declared minimum, treat `playwright-cli` as not available.

## Install (interactive mode)

Call `AskUserQuestion`:

- `question`: `"playwright-cli is not installed."`, `header`: `"Browser tool"`, `multiSelect`: `false`
- Option 1 — `label`: `"Install (Recommended)"`, `description`: `"Install playwright-cli globally — npm install -g @playwright/cli"`
- Option 2 — `label`: `"Skip"`, `description`: `"visual review, story generation, and QA validation will be unavailable"`

- **Choice 1:** run `npm install -g @playwright/cli`, then verify (see "Verify after install" below). Return OK.
- **Choice 2:** return SKIPPED — the caller surfaces a "browser unavailable" line in its report and degrades gracefully (never silently skip without telling the user).

Never block the calling skill on a missing browser. Browser features are optional — all other skills work without them.

## Install (auto mode)

Auto mode does NOT install `playwright-cli` autonomously (installation is a global side effect outside the worktree, and not always reversible). Instead, log to the auto-decision log:

```
STAGED {HH:MM:SS} — browser detection: playwright-cli not installed. Recommend install. Surface at Review Console.
```

The caller continues without browser-dependent features. The Wrap-Up Review Console surfaces the install hint for user approval.

## Verify after install

Run `playwright-cli list` — should return without error (an empty list is fine). If the command fails, surface the failure to the user with a hint to consult the bundled self-docs (see `playwright-cli-reference.md`'s Authority section).

## Session/process lifecycle

There is no persistent background daemon (unlike `agent-browser`, which auto-started one on port 4848) — each `open`/`attach` call starts or reuses a named browser process directly, and `list`/`close-all`/`kill-all` operate on that set of processes this CLI invocation tree manages, not on a daemon. Skills do not manage process lifecycle beyond issuing `close-all`/`kill-all` as needed.

## See also

- `/claude-tweaks:browse` — operation vocabulary and concrete command reference (`playwright-cli-reference.md`)
- `_shared/auto-mode-contract.md` — full auto-mode semantics and the "What `auto` does NOT silence" list
- `_shared/auto-decision-log.md` — log entry format and location
