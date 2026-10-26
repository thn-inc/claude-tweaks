---
files:
  - plugin/bin/hooks.js
---

# Recover from a Mistyped hooks.js Verb

**Persona:** An agent session following skill prose that calls a `hooks.js` subcommand (`record-worktree`, `close-run`, `resolve-console`, …) and gets the verb name wrong, plus the maintainer who later reads that session's transcript to see what went wrong.
**Goal:** Tell from one failed call's stderr that the verb is wrong, what the real verbs are, and what arguments the intended verb takes, without opening `hooks.js` or re-running anything to discover the CLI's shape.
**Entry point:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" <verb> [args...]`, run from any checkout or worktree, where `<verb>` is a typo, a near miss, empty, or not a hooks.js verb at all.
**Success state:** The call exits 1 and writes nothing. Its stderr names the problem on the first line and then lists every verb's usage line, taken from the same `VERBS` table that dispatches the call. Re-running with the corrected verb from that listing works first time.

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
- **Should understand:** That usage string is the same table entry the step-1 listing printed, so the two can never disagree. On the flag-strict verbs (`close-run`, `record-worktree`, `record-pr`, `spec-status`, …) any undeclared `--flag` also prints the usage line instead of running.
- **Red flags:** `--help` on a `--run`-accepting verb changing `run-state.json`. That is the #1143 hazard this guard exists to close.

## Origin
- Created during build of #4181 (hooks.js table-driven verb dispatch so USAGE keys double as dispatch keys).
- Steps 1–3's usage listing and step 2's prototype-name rejection were built in this session. Step 2's `log-decision` redirect and the near-miss suggestion predate it (#1586), as does step 4's `--help` guard (#1143, #1012).
- Related records: #1143 (the `--help` intercept), #1586 (non-zero exit and suggestion for unknown verbs), #1012 (flag-strict verbs).
