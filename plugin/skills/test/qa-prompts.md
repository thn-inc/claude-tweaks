QA parallel dispatch + agent prompt templates — Phase 3. Read `qa-procedures.md` for pre-flight and `qa-reporting.md` for output handling.

# QA Phase 3: Spawn

This phase dispatches qa-agent subagents in parallel — one per story, bounded by `MAX_PARALLEL` and tier dependencies from Phase 2. Each agent owns a single `agent-browser` session named after the story id (kebab-case). One session per agent — never share a session across parallel stories.

> **Parallel execution:** Dispatch each tier's stories as parallel Task agents — each runs independently against its own `agent-browser` session and returns a `RESULT:` summary line (plus optional `TRACE:` line and `REPORT_JSON` comment). Assemble results after all agents in the tier complete. Follow the subagent contract in `skills/_shared/subagent-output-contract.md`: inline the prompt template below verbatim per agent (no references to sibling files), pick `[Use: Standard]` (qa-agent work is browser-driven step execution, not deep analysis — resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" standard`, `skills/_shared/subagent-dispatch-core.md` § Model Selection), and treat the agent's trailing `STATUS: {WORD}` line (`DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED`) as its status — the last non-empty line of the reply, after `RESULT`/`TRACE`/`REPORT_JSON`, per `bin/lib/hooks/subagent-stop.js`'s canonical format (#2265). Dispatch shape: single-assistant-message rule (`_shared/subagent-dispatch-core.md`'s fan-out section) applies.
>
> **Working directory discipline:** Resolve `{SCREENSHOT_PATH}` and `{TRACES_BASE}` to absolute paths *before* substituting them into each agent's prompt — relative paths cannot reach the agent's working directory reliably. The dispatch also anchors the working directory by inlining a "Working directory" line at the top of each agent's prompt body (see templates below).
>
> **Custom output schema note:** This dispatch uses a custom output schema (`RESULT` / `TRACE` / `REPORT_JSON`) — not Templates A/B/C from the subagent contract — because QA agents return structured execution results, not findings/locators. Templates A/B/C are for analysis dispatches; QA execution is a different shape.

17. For each tier (starting from Tier 0):

    **Streaming slot-fill:** Use a queue-based model to maximize concurrency. Instead of dispatching sub-batches and waiting for all to complete before starting the next sub-batch, fill slots as they open:

    ```
    Queue = [all stories in this tier]
    Active = {}          # map of agent_id -> {story, dispatched_at}
    Results = []

    # Initial fill — dispatch up to MAX_PARALLEL agents
    While Active.size < MAX_PARALLEL and Queue is not empty:
      story = Queue.shift()
      agent = Task(story_prompt, run_in_background=true)
      Active[agent.id] = {story: story, dispatched_at: now()}

    # Streaming loop — poll and refill
    While Active is not empty:
      For each agent_id in Active:
        result = TaskOutput(agent_id, block=false)
        If result is complete:
          Active.remove(agent_id)
          Results.push(result)
          # Immediately fill the open slot
          If Queue is not empty:
            next_story = Queue.shift()
            next_agent = Task(next_story_prompt, run_in_background=true)
            Active[next_agent.id] = {story: next_story, dispatched_at: now()}
        Else if now() - Active[agent_id].dispatched_at > AGENT_TIMEOUT:
          # AGENT_TIMEOUT exceeded with no result — force-complete as a timeout failure so the tier isn't blocked indefinitely.
          Active.remove(agent_id)
          Results.push({story: Active[agent_id].story, status: FAIL, error: "Agent timeout after {AGENT_TIMEOUT}ms"})
          If Queue is not empty:
            next_story = Queue.shift()
            next_agent = Task(next_story_prompt, run_in_background=true)
            Active[next_agent.id] = {story: next_story, dispatched_at: now()}
      # Brief pause before next poll cycle to avoid busy-waiting
    ```

    **Implementation with the Task tool:** Dispatch agents with `run_in_background=true`. Poll active agents using `TaskOutput` with `block=false`. When any agent completes, collect its result and immediately dispatch the next queued story into the open slot. On each poll cycle, also check each still-active agent's elapsed time against `AGENT_TIMEOUT` (qa-procedures.md's Variables table, default 300000ms) — an agent that exceeds it with no result is force-completed as a FAIL (`"Agent timeout"`) so a hung session cannot block the rest of the tier. Continue until both the queue and the active set are empty.

    **Progress updates:** After each completion, emit a progress line:
    ```
    Story {completed_count}/{total_count} completed ({active_count} active, {queue_count} queued)
    ```

    Each story agent owns a single `agent-browser` session named after the story id (kebab-case). One session per agent — never share a session across parallel stories.

18. **Detect story format** for each story:
    - If the story has a `steps` array -> structured format
    - If the story has a `workflow` string -> legacy format

19. For each Task call, use the appropriate prompt template. If the story has `auth: { vault: "<name>" }`, include the `**Auth (vault):**` field.

**Canonical schema.** Both templates below inline the `REPORT_JSON` envelope's nested `page_inventories` shape (`interactive_elements`/`forms`/`navigation`/`accessibility`/`layout`) verbatim rather than referencing it — required by this file's own no-sibling-file-references contract (line 7), since each template is copied wholesale into a dispatched Task agent's prompt and that agent never sees another file. `agents/qa-agent.md`'s `## Report` section declares this same shape canonical for the agent's structured output. Any future change to the schema must be mirrored byte-for-byte across all four locations: `agents/qa-agent.md`, both templates below, and `skills/test/qa-reporting.md`'s aggregated `report.json` schema.

**Structured format prompt:**
```
Execute this user story and report results using the agent-browser CLI.

**Working directory:** {ABSOLUTE_WORKTREE_PATH}. Start every shell command with `cd "{ABSOLUTE_WORKTREE_PATH}" && ...` so screenshots, traces, and git operations land in the correct checkout.

**ID:** {story.id}
**Story:** {story.name}
**URL:** {story.url}
**Session:** {story.id}
**Headed:** {HEADED}

**Auth (vault):** {vault name from story.auth.vault — omit if not present}

**Viewport:** {story.viewport or setup.viewport or omit}

**Setup:**
{serialize setup block as YAML, if present}

**Teardown:**
{serialize teardown block as YAML, if present}

**Steps:**
{serialize story.steps as YAML}

Instructions:
- Open the session: `agent-browser --session {story.id} open {story.url}`
- Start trace recording immediately after `open`: `agent-browser --session {story.id} trace start` (a trace can only be saved for the interval after recording started — there is no retroactive capture).
- If `Auth (vault)` is present, run `agent-browser --session {story.id} auth login <vault-name>` immediately after `trace start` and before the first interactive step.
- If a `Viewport` is set, run `agent-browser --session {story.id} set viewport <w> <h>`.
- If `Setup` is present, execute its steps first, using the same step semantics as the Steps loop below (locator-first, snapshot-fallback, annotated screenshot). Setup failures are treated like any other step failure (save trace, stop, report).
- For each step in the steps array sequentially:
  - Use semantic locators (role/name, testid, text, label, placeholder) — never CSS or `@eN` refs from prior snapshots.
  - For action steps: execute locator and action in one command — `find <locator> <value> <action> [text]` (e.g. `find role button click --name "Submit"`, `find label "Email" fill "user@example.com"`). The action argument is mandatory: a bare `find` with no action defaults to CLICKING the element, so never run `find` as an existence probe. If the command errors with element-not-found, take a snapshot (`snapshot -i -c`) and resolve the target from the fresh tree.
  - For verify-only and `assert_visible` steps: snapshot (`snapshot -i -c`) and evaluate the assertion against the tree — never an action-less `find`.
  - Take an annotated screenshot after each step: `screenshot --annotate {SCREENSHOT_PATH}/<NN>_<step>.png` (path is positional — there is no `--filename` flag).
- On any step failure (assertion mismatch, locator unrecoverable, navigation timeout, console error blocking the flow):
  - Save the trace BEFORE closing the session:
    `agent-browser --session {story.id} trace stop {TRACES_BASE}/{story.id}/{ISO-timestamp}.zip`
  - Include the trace path in the failure report.
  - If `Teardown` is present, execute its steps now, before closing the session.
  - Then close the session: `agent-browser --session {story.id} close`.
  - Stop executing remaining steps.
- On success, if `Teardown` is present, execute its steps now, before closing the session.
- On success, close the session at the end: `agent-browser --session {story.id} close`.
- Report each step as PASS or FAIL with a brief explanation.
- **Decide your status word:** exactly one of `DONE` | `DONE_WITH_CONCERNS` | `NEEDS_CONTEXT` | `BLOCKED`. Mapping:
  - `PASS` → `DONE`
  - `PASS_WITH_CAVEATS` → `DONE_WITH_CONCERNS`
  - `FAIL` → `DONE_WITH_CONCERNS` (your execution completed normally — `FAIL` is a real finding the dispatcher must act on, and the status line carries that signal)
  - Cannot open the browser, server unreachable, or other infrastructure failure that prevents step execution → `BLOCKED`
  - Required input missing (auth vault not configured, env var not set, locator references something that doesn't exist in the prompt) → `NEEDS_CONTEXT`
- Use this exact format for your summary line:
  RESULT: {PASS|PASS_WITH_CAVEATS|FAIL} | ID: {story.id} | Steps: {passed}/{total}
- If a trace was captured, append a second line:
  TRACE: {trace path}
- After the summary line(s), emit a single-line HTML comment containing structured JSON named `REPORT_JSON`. The reporting pipeline parses this comment in Phase 4 (`qa-reporting.md`). Use exactly this shape:
  ```
  <!-- REPORT_JSON: {"caveats": ["{observation 1}", "{observation 2}"], "recovered_locators": [{"step_index": {N}, "original_locator": "{old}", "recovered_locator": "{new}", "reason": "{description}"}], "page_inventories": [{"url": "{absolute URL}", "interactive_elements": {"buttons": {N}, "links": {N}, "inputs": {N}, "selects": {N}, "checkboxes": {N}}, "forms": {"count": {N}, "fields_per_form": [{N}, {N}]}, "navigation": {"nav_elements": {N}, "breadcrumbs": {bool}, "tabs": {N}}, "accessibility": {"aria_landmarks": {N}, "heading_levels": [1, 2, 3], "missing_labels": {N}}, "layout": {"viewport_overflow": {bool}, "scroll_height": {N}}}]} -->
  ```
  All three arrays are required keys (use `[]` when empty — never omit). `caveats` is non-empty only when RESULT is `PASS_WITH_CAVEATS`. `recovered_locators` lists any locators the agent auto-recovered during step execution. `page_inventories` is one entry per unique URL visited; use snapshot/snapshot-i data to populate interactive element counts, form structure, navigation, accessibility, and layout details. Keep the entire comment on a single line so downstream parsing can use a simple regex.
- **Status line (required, the true last line of your reply, after the `REPORT_JSON` comment):** `STATUS: {word}` — the same word you decided above (`bin/lib/hooks/subagent-stop.js`'s canonical format, #2265).
```

**Legacy format prompt:**
```
Execute this user story and report results using the agent-browser CLI.

**Working directory:** {ABSOLUTE_WORKTREE_PATH}. Start every shell command with `cd "{ABSOLUTE_WORKTREE_PATH}" && ...` so screenshots, traces, and git operations land in the correct checkout.

**ID:** {story.id or "legacy-" + slugified-name}
**Story:** {story.name}
**URL:** {story.url}
**Session:** {story.id or "legacy-" + slugified-name}
**Headed:** {HEADED}

**Auth (vault):** {vault name from story.auth.vault — omit if not present}

**Workflow:**
{story.workflow}

Instructions:
- Open the session, run `agent-browser --session <session> trace start` immediately after `open` (traces are record-then-stop — no retroactive capture), apply auth (vault preferred via `auth login <vault-name>`, legacy fallback), follow the workflow steps sequentially.
- Act on elements via `find <locator> <value> <action> [text]` — the action argument is mandatory (a bare `find` defaults to clicking); assertions go through `snapshot -i -c`, never an action-less `find`.
- Take an annotated screenshot after each significant step: `screenshot --annotate {SCREENSHOT_PATH}/<NN>_<step>.png` (path is positional — no `--filename` flag).
- On any failure: `agent-browser --session <session> trace stop {TRACES_BASE}/<session>/<timestamp>.zip`, then `close`. Include the trace path in the report.
- On success: `agent-browser --session <session> close` at the end.
- **Decide your status word:** exactly one of `DONE` | `DONE_WITH_CONCERNS` | `NEEDS_CONTEXT` | `BLOCKED`. Mapping:
  - `PASS` → `DONE`
  - `PASS_WITH_CAVEATS` → `DONE_WITH_CONCERNS`
  - `FAIL` → `DONE_WITH_CONCERNS` (execution completed normally — `FAIL` is a real finding the dispatcher must act on, and the status line carries that signal)
  - Browser cannot open, server unreachable, or other infrastructure failure → `BLOCKED`
  - Missing auth vault, missing required env var, or workflow refers to undefined state → `NEEDS_CONTEXT`
- Use this exact format for your summary line:
  RESULT: {PASS|PASS_WITH_CAVEATS|FAIL} | ID: {story.id or "legacy-" + slugified-name} | Steps: {passed}/{total}
- If a trace was captured, append a second line:
  TRACE: {trace path}
- After the summary line(s), emit a single-line HTML comment containing structured JSON named `REPORT_JSON`. The reporting pipeline parses this comment in Phase 4 (`qa-reporting.md`). Use exactly this shape:
  ```
  <!-- REPORT_JSON: {"caveats": ["{observation 1}", "{observation 2}"], "recovered_locators": [{"step_index": {N}, "original_locator": "{old}", "recovered_locator": "{new}", "reason": "{description}"}], "page_inventories": [{"url": "{absolute URL}", "interactive_elements": {"buttons": {N}, "links": {N}, "inputs": {N}, "selects": {N}, "checkboxes": {N}}, "forms": {"count": {N}, "fields_per_form": [{N}, {N}]}, "navigation": {"nav_elements": {N}, "breadcrumbs": {bool}, "tabs": {N}}, "accessibility": {"aria_landmarks": {N}, "heading_levels": [1, 2, 3], "missing_labels": {N}}, "layout": {"viewport_overflow": {bool}, "scroll_height": {N}}}]} -->
  ```
  All three arrays are required keys (use `[]` when empty — never omit). `caveats` is non-empty only when RESULT is `PASS_WITH_CAVEATS`. Legacy stories typically have no `recovered_locators` — use `[]`. `page_inventories` is one entry per unique URL visited; populate it from snapshot data at each URL transition (interactive element counts, form structure, navigation, accessibility, layout details). Keep the entire comment on a single line so downstream parsing can use a simple regex.
- **Status line (required, the true last line of your reply, after the `REPORT_JSON` comment):** `STATUS: {word}` — the same word you decided above (`bin/lib/hooks/subagent-stop.js`'s canonical format, #2265).
```

20. **Record start time** for each story when it is dispatched and elapsed time when it completes (wall-clock seconds). Store timing data alongside the result for use in Phase 5.

21. After each tier completes, check results before spawning the next tier. If any story failed, mark its dependents as SKIPPED.
