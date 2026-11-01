---
files:
  - plugin/bin/hooks.js
---

# Recover from a Mistyped hooks.js Verb

**Persona:** An agent session following skill prose that calls a `hooks.js` subcommand (`record-worktree`, `close-run`, `resolve-console`, …) and gets the verb name wrong, plus the maintainer who later reads that session's transcript to see what went wrong.
**Goal:** Tell from one failed call's stderr that the verb is wrong, what the real verbs are, and what arguments the intended verb takes, without opening `hooks.js` or re-running anything to discover the CLI's shape.
**Entry point:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" <verb> [args...]`, run from any checkout or worktree, where `<verb>` is a typo, a near miss, empty, or not a hooks.js verb at all.
**Success state:** The call exits 1 and writes nothing. Its stderr names the problem on the first line and then lists every verb's usage line, taken from the same `VERBS` table that dispatches the call. Re-running with the corrected verb from that listing works first time. A mistyped *flag* on a real verb is refused the same way: exit 1, nothing written, stderr naming the flag and then that verb's usage line. Only `--help`/`-h` answers on stdout with exit 0.

## Steps

### 1. Mistype a verb
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-ru`
- **Action:** Run a near miss of a real verb.
- **Should feel:** Like an instant, precise correction. The first line reads `claude-tweaks: unrecognized hooks.js subcommand 'close-ru' — did you mean 'close-run'?`, and the exit code is 1.
- **Should understand:**
  - The second line is `claude-tweaks: hooks.js usage:`, followed by one indented usage line per verb (e.g. `  close-run [--run <dir>]`) and a final `<event>` line naming the harness hook events.
  - The listing is printed once, not after a separate `known subcommands` name list.
- **Red flags:**
  - Exit 0 with no output. That was the pre-#1586 silent no-op, which makes a skipped step look successful.
  - A verb in the listing with no usage line, or a usage line whose first word is not its verb.

### 2. Call something that is not a hooks.js verb at all
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" log-decision --run <dir> --text "..."`, or a word unrelated to any verb.
- **Action:** Run a name that belongs to a different tool, or no close match.
- **Should feel:** Like a redirect, not a dead end.
- **Should understand:**
  - `log-decision` gets its own message pointing at the separate `bin/log-decision.js` CLI.
  - Any other unknown word gets the `unrecognized hooks.js subcommand '{word}'` line with no suggestion, then the same usage listing.
  - Prototype-chain names such as `constructor`, `toString` and `__proto__` are ordinary unknown verbs here. They exit 1 with the listing.
- **Red flags:** `constructor` or `toString --help` exiting 0 silently. Before #4181 an inherited object property was read as a verb and its throw was swallowed.

### 3. Forget the verb entirely
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js"`
- **Action:** Run the dispatcher with no subcommand.
- **Should feel:** Self-documenting: the same listing, introduced by `claude-tweaks: no hooks.js subcommand given`.
- **Should understand:** The exit code is 1. Bare `hooks.js` is a skill-invoked CLI call, not a harness hook event, so the never-break-a-session exit-0 rule does not apply.
- **Red flags:** Any stdout output. The listing belongs on stderr, so a caller parsing stdout never mistakes it for a result.

### 4. Check the intended verb's arguments before re-running
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-pr --help` (or `-h`)
- **Action:** Ask the corrected verb for its usage before running it for real.
- **Should feel:** Safe. Nothing runs and nothing is written; the reply is exactly `claude-tweaks: usage: record-pr [--run <dir>] <number> <url>` with exit 0.
- **Should understand:**
  - That usage string is the same table entry the step-1 listing printed, so the two can never disagree.
  - Every verb is flag-strict, so any undeclared `--flag` is refused on stderr with exit 1 instead of running.
  - `--help` and `-h` are caught anywhere in the argument list, even where a flag's value would go: `resolve-run-dir --spec-slug --help --create` prints usage and mints nothing.
- **Red flags:**
  - `--help` on a `--run`-accepting verb changing `run-state.json`. That is the #1143 hazard this guard exists to close.
  - `--help` in a value position being taken as the value: a run dir named `…---help`, or `no sibling-session conflict found for record --help`.

### 5. Pass a flag the verb does not have
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" archive-run --run <dir> --dry-run`
- **Action:** Ask a mutating verb for a preview it does not support, expecting nothing to happen.
- **Should feel:** Like a refusal, not a gamble. Stdout is empty, stderr is exactly `claude-tweaks: archive-run: unknown flag '--dry-run'` then `claude-tweaks: usage: archive-run [--run <dir>]`, the exit code is 1, and the run directory is still where it was.
- **Should understand:**
  - `archive-run` has no dry-run mode. The usage line on stderr is the whole answer; to see what would block archival, read the run's `console.json` and `decisions.md` instead.
  - The refusal does not depend on where the flag sits: `--dry-run --run <dir>` is refused the same way.
  - Every verb refuses this way. A typo of a real flag, such as `reconcile --dryrun`, writes `claude-tweaks: reconcile: unknown flag '--dryrun'` then `claude-tweaks: usage: reconcile [--dry-run] [--json] [--mcp-reachable] [--checks <c1,c2,...>]` on stderr, exits 1, and runs no reconcile check.
- **Red flags:**
  - Any `moved:` line, a run directory missing from `.claude-tweaks/pipelines/`, or a new `[reconcile] archive run …` commit. Before #4773, `archive-run` ignored every flag it did not know, so `--dry-run` archived and committed for real.
  - `reconcile --dryrun` moving a branch ref or reaping a worktree. Before #4777, only some verbs refused unknown flags, and `reconcile` was not one of them.
  - Usage on stdout and a success status on a mistyped flag. That was the #4777 shape, which a caller capturing stdout read as a result.

## Origin
- Created during build of #4181 (hooks.js table-driven verb dispatch so USAGE keys double as dispatch keys).
- Steps 1–3's usage listing and step 2's prototype-name rejection were built in this session. Step 2's `log-decision` redirect and the near-miss suggestion predate it (#1586), as does step 4's `--help` guard (#1143, #1012).
- Step 5 added during build of #4773, which made `archive-run` flag-strict.
- Steps 4 and 5 updated during build of #4777, which made every verb flag-strict and catches `--help` in a value position.
- Steps 4–5's stderr/exit-1 flag refusal changed during build of #4834.
- Related records: #1143 (the `--help` intercept), #1586 (non-zero exit and suggestion for unknown verbs), #1012 (flag-strict verbs), #4773 (`archive-run` joins them), #4777 (every verb is flag-strict), #4834 (the unknown-flag refusal moved to stderr with exit 1).
