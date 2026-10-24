---
files:
  - plugin/bin/log-decision.js
  - plugin/skills/_shared/auto-decision-log.md
  - plugin/skills/flow/steps-and-gates.md
  - plugin/skills/wrap-up/execution-and-verification.md
  - plugin/skills/flow/multispec-parallel-waves.md
  - plugin/skills/_shared/pr-check-gate.md
  - plugin/skills/_shared/git-discipline.md
  - plugin/skills/_shared/local-merge-auto-finish.md
  - plugin/skills/dispatch/two-call-gate.md
  - tests/log-decision-text-file-sites-conformance.test.js
---

# Log a Decision That Names a Git-Supplied File

**Persona:** A pipeline agent partway through `/claude-tweaks:flow`. It just aborted a catch-up merge, or re-read a parked PR's merge state, and must record the outcome in the run's `decisions.md`. The outcome names conflicting file paths or a git error message, and git allows `"`, `$`, backticks and `\` in those.
**Goal:** Write one `decisions.md` entry that quotes the git-supplied text exactly, without any of it running as shell syntax.
**Entry point:** A skill step that says to log git- or user-supplied text via `log-decision.js`. Examples: `flow/steps-and-gates.md`'s #3014 CONFLICTING-PR note and abort, `wrap-up/execution-and-verification.md`'s leave-open mergeability re-check, `flow/multispec-parallel-waves.md`'s merge-back conflict, `_shared/pr-check-gate.md`'s check-name caveats, `_shared/local-merge-auto-finish.md`'s merged/park outcomes. Any step citing `_shared/auto-decision-log.md`'s Text from git or a user paragraph qualifies (since #3792, every such site in `plugin/skills/**`).
**Success state:** `decisions.md` holds the entry with the file names exactly as git printed them. Nothing in the text was expanded or executed, and the agent never had to work out which characters to escape.

## Steps

### 1. Recognise the text as git-supplied — the skill step
- **URL:** the citing step in whichever skill file the agent is following
- **Action:** The agent reads a logging instruction whose text interpolates `{paths}`, `{files}` or `{reason}`. The step names `--text-file "{text-file}"` and cites `_shared/auto-decision-log.md`'s Text from git or a user paragraph, not a double-quoted `--text`.
- **Should feel:** Unambiguous. There is one form for this case, and the step says which.
- **Should understand:** Text that came from git or a user never goes inside a double-quoted shell argument. The file form exists so no escaping is needed at all.
- **Red flags:** The step still shows `--text "... {paths} ..."`, or tells the agent to escape characters by hand. Those are the shapes that let `$(...)` in a file name run, and that silently truncate an entry at a stray `"`.

### 2. Resolve a per-purpose temp path — `session-tmp-resolve.js`
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" DECISION_TEXT=decision-text-{run-id}-{step-slug}.md`
- **Action:** The agent runs the resolver once and reads the printed `DECISION_TEXT="{path}"` line. The path sits under the session temp root, never the run directory.
- **Should feel:** Mechanical. One plain command, and its output is the path to use.
- **Should understand:** The run directory refuses Write from a worktree session, so the text file lives in the session temp root. The `{step-slug}` suffix keeps two log sites in one session from sharing, and clobbering, the same file.
- **Red flags:** The path points inside `.claude-tweaks/pipelines/{run-id}/`, where the Write is refused. Or a bare `decision-text-{run-id}.md` with no step suffix, which a second caller in the same session overwrites.

### 3. Write the one-line text — the Write tool
- **URL:** the printed path
- **Action:** The agent writes the entry text, for example `catch-up of PR #12's branch with origin/main conflicted on a"b.md, $(x).md; merge aborted — HARD-GATE stop before review`, to that path with the Write tool, as one line.
- **Should feel:** Like pasting. The file names go in exactly as git printed them.
- **Should understand:** The file must hold exactly one line. A trailing newline is fine, but an interior line break (for example, `git diff --name-only` output pasted as-is) is rejected rather than written as a broken entry.
- **Red flags:** The text is written through `echo`, `printf` or a heredoc, which re-introduces shell interpretation. Or the paths are left one per line.

### 4. Append the entry — `log-decision.js --text-file`
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "{run-dir}" --status AUTO --section "/flow" --step "Adoption: PR merge state" --reversibility high --text-file "{text-file}"`
- **Action:** The agent passes the file path in place of `--text`. The CLI reads the file, strips trailing whitespace, and appends the entry, which it also echoes to stdout.
- **Should feel:** Identical to `--text`. The entry looks exactly as it would had the text been passed inline, special characters included.
- **Should understand:** Exit 2 means a malformed invocation, and stderr names the cause:
  - `--text` and `--text-file` were both given (they are mutually exclusive);
  - the file is missing or unreadable (stderr names the path);
  - the file is blank;
  - the file contains an interior line break.

  Nothing is written on exit 2. Exit 3 still means the run dir is missing or not anchored under the main checkout.
- **Red flags:** The entry differs from what `--text` would write, or an `$(...)` in the content ran. A failed `--text-file` read still appends a partial or empty entry. The two flags are given together and one of them is silently ignored.

## Origin
- Created during build of #3671 (`log-decision.js --text-file`)
- Steps 1-4 built in this session; step 1's two call sites were migrated off hand-escaping in the same build
- Related: #3014 (CONFLICTING-PR adoption abort), #3483 (leave-open mergeability re-check)
- Updated during build of #3792: the remaining git- and user-text `--text` call sites across `plugin/skills/**` were migrated to `--text-file`. `tests/log-decision-text-file-sites-conformance.test.js` pins each site with a go-red and sweeps the corpus, so step 1's red flag ("the step still shows `--text "... {paths} ..."`") now fails CI rather than relying on a reader to notice it.
