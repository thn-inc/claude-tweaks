---
name: plugin-workflow-script
description: Use when adding or changing a Workflow tool script under `plugin/workflows/`, or the skill step that starts one — the pure-literal meta, validating every arg before the first agent, wrapping each agent call on its own, testing through the stub-globals loader with a banned-token scan, the measured tool facts the calling step must handle, and every site a new script is named in. Keywords - plugin/workflows, Workflow tool, workflow script, meta, agent(), parallel(), loadWorkflowScript, workflow-script.js, stub globals, banned tokens, run file, async_launched, workflow-tool-probe, review-lens-fanout.
---

# Plugin workflow script

## Overview

A plugin workflow script is `plugin/workflows/{name}.js`: `export const meta = { … }`, then a body the `Workflow` tool runs as an async function with the globals `agent`, `parallel`, `phase`, `log` and `args`. A skill step starts it as `claude-tweaks:{meta.name}`. `plugin/workflows/review-lens-fanout.js` (#5599) is the first one, and the patterns below are what its build and review settled. The built-in `workflow-authoring` skill covers the generic script API. This skill covers what this repo adds: how a script is tested without the real tool, and which measured tool facts the calling step owes.

## Key Patterns

### The script routes, the session composes

The script carries no prompt text, model choice or domain rule of its own. The session composes each brief, resolves each model through `resolve-profile.js`, and passes both in `args`; the script refuses an entry with no model, so no agent inherits the session model by omission. `tests/review-lens-fanout-workflow.test.js`'s AC6 scan holds the line: the raw text, comments included, must match none of a severity literal, `CALIBRATION`, a model name, `require(`, `import`, `Date.now`, `Math.random` or a `schema:` option. Its go-red test plants each token once and checks four near misses (`'highlight'`, `{ schemas: [] }`) stay clean. A new script copies the scan, with its own domain words in place of the review ones.

### `meta` is a pure literal

The real tool refuses a `meta` that is not a plain object literal (#5599's real-tool runs, PR #5819). The test loader does not check this: `tests/helpers/workflow-script.js` evaluates whatever sits between the braces. A `meta` edit is proven only by a real run. The loader finds the literal's end by counting braces, so no string inside `meta` may hold an unbalanced `{` or `}`.

### Every check runs before the first agent

Validate the whole `args` before any `agent()` call, and refuse with `return { started: false, reason }`, which starts nothing. A refusal table whose broken entry is always the first or only one cannot tell validate-everything-first from validate-as-you-start: #5599's review found all of its first refusal rows had that shape, and a first-entry-only mutant passed them. Put a valid entry first and the broken one second (`VALID_FIRST_LENS` in the test file, PR #5819).

### Each agent call is wrapped on its own

Wrap every `agent()` in its own `try`/`catch` inside the `parallel()` thunk, and map a throw, a non-string reply and a blank reply to `{ text: null, failed: true }`. Also map a slot `parallel()` leaves `null`. Test the wrap with a `parallel()` stub that does not catch (`Promise.all(thunks.map((t) => t()))`): with the default catching stub, a missing wrap stays green.

### A constant the script needs from `plugin/bin` is restated and pinned

A script cannot `require`, so it restates any `plugin/bin` constant it needs. Pin the restated literal against the exported constant by interpolating the constant into the expected source text: `readText(SCRIPT).includes(\`const LENS_TOKEN = /^[${FINDING_LENS_CLASS}]+$/\`)`. This compares source text on purpose; the script has no export to compare against.

### Stubbed tests prove the script's contract only

`loadWorkflowScript(absPath)` returns `{ meta, run }`; `run({ agent, parallel, phase, log, args })` runs the body with your stubs, and the script's own `return` is its value. Record each stub `agent` call to assert the prompt, `model` and `label` it got. Round-trip the returned value through its real consumer (`review-coordination.js settle-lens-replies`, bare and wrapped as a run file's `result`), and add a CRLF-checkout case for `meta`. None of this says how the real tool behaves. Make one real run per changed script before merge, headless from the worktree: `claude -p --plugin-dir <worktree>/plugin` in `dontAsk` mode with `--allowedTools "Workflow(claude-tweaks:{name})"`, and quote its run id, status and agent count in the PR.

## Decision Framework

| Question | Answer |
|---|---|
| Where does a tool fact the calling step depends on come from? | A row of `docs/reference/workflow-tool-probe.md`, cited by row name. A fact no row holds is probed and added as a row first. |
| The installed CLI's minor version differs from a cited row's? | Re-run that row from the probe file's "Scope and how to re-run" section before relying on it. |
| Does the step need the returned value in the session's own thread? | No. The completion notification's copy is cut short. Read the run file, at three directories above the launch result's `transcriptDir`, then `workflows/{runId}.json`, with a bin/ CLI. |
| May the step wait without a bound? | No. Start one background timer beside the launch, stop the run with `TaskStop` on its `taskId` when the timer wins, and fall back. |
| Is a Task dispatch fallback needed? | Yes, whenever the step can run where no `Workflow` tool exists or the call is denied. Name each fallback condition by what the session observes. |

## Project Conventions

The calling step handles these measured facts (probe rows in brackets):

- A Task agent, a continuation agent and a pipeline-driver worker have no `Workflow` tool [`init-task-agent`, `init-driver-worker`].
- A `dontAsk` or headless session denies the call unless permissions allow `Workflow(claude-tweaks:{name})`. The plugin adds no such rule [`start-name`, `init-headless`].
- The launch result is `async_launched`, with `taskId`, `runId` and `transcriptDir` and no value [`delivery`, `size-return`].
- A headless session kills a run still going 10 minutes after its last turn, unless `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` is set [`long-run`, `long-run-nowait`].
- An agent's working directory is the launching session's cwd [`agent-cwd`]. #5599's first replay run, started from the build session, had 2 of 8 reviewers BLOCKED on their briefs' `pwd` check.
- The harness wraps each prompt in a `[Workflow harness — computed task]` frame and indents every line, so a brief must not rely on column-zero lines [`agent-prompt-frame`].
- With no schema, an agent's reply is its text, byte for byte [`agent-verbatim`]. Inside a claude-tweaks pipeline run, the plugin's own `SubagentStop` hook re-prompts an agent whose reply has no status line; outside one it lets the reply through [`agent-stop-hook`, `init-interactive`].
- The PreToolUse dispatch-prompt gate does not see a workflow agent's prompt, but the plugin's PreToolUse hook does fire for the agent's own tool calls (`_shared/subagent-output-contract.md`'s "Workflow-dispatched agents" section).

A new script is named in these places:

- `docs/plugin-structure.md`: a `plugin/workflows/{name}.js` row under the directory row.
- CLAUDE.md's Subagent Contract dispatch-site list (`tests/subagent-contract-clauses.test.js` pins the review entry).
- `_shared/subagent-output-contract.md`'s "Workflow-dispatched agents" section, when the script's agents are a contract dispatch site.
- `docs/reference/workflow-tool-probe.md`'s "Depended on by" list, naming every row the record reads.
- `docs/skill-graph.md`, for the edge from the starting skill.

## Common Operations

```bash
node --test tests/review-lens-fanout-workflow.test.js
node -e "const {loadWorkflowScript}=require('./tests/helpers/workflow-script'); console.log(loadWorkflowScript(require('path').resolve('plugin/workflows/review-lens-fanout.js')).meta)"
```

## Anti-Patterns

| Pattern | Why it fails here |
|---|---|
| Treating a green stubbed suite as proof that the tool accepts the script | The loader accepts a non-literal `meta` and any API the real tool refuses. Only a real run proves those. |
| Every refusal case breaks the first entry | A validate-as-you-start script passes the table. #5599's review found this (PR #5819). |
| Testing the per-call wrap only under a catching `parallel()` stub | The stub swallows the throw, so a script with no wrap stays green. |
| Reading the returned value from the completion notification | Its copy is cut short. Read the run file. |
| A brief that names a per-agent path while two agents get one string | Both agents get byte-identical text. Have each agent make its own directory (`mktemp -d`), as `step3-workflow-dispatch.md`'s `SCRATCH:` line does. |

## Reference

- Script: `plugin/workflows/review-lens-fanout.js`. Loader: `tests/helpers/workflow-script.js`. Tests: `tests/review-lens-fanout-workflow.test.js`.
- Calling step: `plugin/skills/review/step3-workflow-dispatch.md`. Tool facts: `docs/reference/workflow-tool-probe.md` (#5596).
- Related skills: `skill-prose-conformance-tests` (pinning the calling step's prose), `policy-key-addition` (an opt-in key in front of the workflow path).
- Origin: #5599.
