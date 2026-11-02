---
files:
  - plugin/bin/hooks.js
  - plugin/skills/wrap-up/cleanup-procedures.md
  - plugin/skills/tidy/SKILL.md
---

# Notice a Crashed hooks.js Verb

**Persona:** An agent session partway through a pipeline step that runs a `hooks.js` subcommand (`archive-run`, `delete-ledger`, `resolve-run-dir`, …) and gates the next step on its result. Also the maintainer who later reads that session's transcript and `decisions.md` to see why a step did not happen.
**Goal:** See that the call failed when the verb hits an unexpected error mid-run. The failure must never look like success, and the error message must be visible without re-running anything or opening `hooks.js`.
**Entry point:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" <verb> --run <dir>`, called from a skill step, where something inside the verb's handler throws: an unreadable file, a permission-denied directory, a malformed state file.
**Success state:**
- The call exits 1 and prints no report on stdout.
- Its stderr carries one line, `claude-tweaks: {verb}: {message}`, naming the verb and the underlying error.
- The skill step treats the call as not done, and logs that stderr line as the reason.
- A harness hook event that hits the same kind of error still exits 0, so the session itself never breaks.

## Steps

### 1. A verb throws mid-run
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" archive-run --run <dir>`, where archival hits an unexpected error (for example, the archive target cannot be written)
- **Action:** Run the verb as the skill step says, and read its exit code and output.
- **Should feel:** Like an honest failure. Nothing is printed on stdout, the exit code is 1, and stderr has one line such as `claude-tweaks: archive-run: EACCES: permission denied, open '…/run-state.json'`.
- **Should understand:**
  - The verb did not finish. A report line such as `claude-tweaks: archived {run-id}` is the only success signal, and it is absent.
  - The `{message}` part is the underlying error. A thrown value that is not an `Error` is printed as text.
  - A caller that captures stdout as a value sees the failure too. `RUN_ROOT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --root-only) || exit 1` stops on the exit status instead of carrying on with an empty value.
- **Red flags:**
  - Exit 0 with empty stdout and empty stderr. That was the pre-#4932 shape, in which the dispatcher's entry catch swallowed the error and a skipped step looked like it succeeded.
  - The error appearing on stdout, where a caller parsing stdout as a result would misread it.

### 2. The skill step records the failure instead of moving on
- **URL:** The step that called the verb, for example tidy's Archive action or wrap-up cleanup item 2's `delete-ledger`.
- **Action:** Branch on the call's outcome.
- **Should feel:** Like a clean handoff to the human: the run carries on without pretending the work happened.
- **Should understand:**
  - The step handles the exception exit like any other "not done" report: not archived, the ledger left on disk, nothing committed for that item.
  - It writes the stderr line into its `FAILED` report or `SKIP` decision line. A reader of `decisions.md` then sees the actual error, not an empty `printed ""`.
- **Red flags:**
  - A `SKIP` or `FAILED` line whose reason is blank.
  - A commit or push for an item whose verb exited 1.

### 3. A harness hook event hits the same kind of error
- **URL:** Any hook event the harness fires (`session-end`, `pre-tool-use`, …) whose module throws.
- **Action:** Keep working in the session.
- **Should feel:** Like nothing happened. The tool call or session ending goes through as usual.
- **Should understand:** Hook events are not CLI verbs. Under the never-break-a-session rule they always exit 0, so this change leaves them alone, and a broken hook module can never block a session.
- **Red flags:** A hook event exiting non-zero, or printing a `claude-tweaks: {event}: …` exception line.

## Origin
- Created during the build of #4932, which split the dispatcher's exception handling. VERBS exceptions now exit 1 with a stderr line, and EVENTS keep exit 0.
- Related records: #4834 (the unknown-flag refusal moved to stderr with exit 1, and its SDD review ruled this follow-up), #1586 (unknown verbs exit 1), #4181 (the mistyped-verb journey, `recover-from-a-mistyped-hooks-js-verb-4181.md`).
