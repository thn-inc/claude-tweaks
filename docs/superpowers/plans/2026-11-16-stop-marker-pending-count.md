# Stop-Marker Pending Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The SubagentStop stop marker gets its own pending-dispatch count that ignores `<task-notification>` in text the agent was given or wrote, while the #3015 contract-gate count stays byte-for-byte unchanged.

**Architecture:** The loop in `countPendingDispatches` moves into one internal scan, `scanPendingDispatches(lines, replyIndex)`, that returns `{ gate, marker }` from a single pass. `countPendingDispatches` keeps its export, signature and every result by returning `.gate`. `grade()` stores both counts in the memo; `recordStop` writes the marker count.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T104725-record-5706/work/5706-spec.md` (record #5706)

Scope keywords: countPendingDispatches, memo.pending, scanPendingDispatches

Scope-keyword hits outside the task list (Check B), classified no-change: `tests/hooks-subagent-stop.test.js` (the #3015 gate suite — must stay byte-identical, AC4.1; run in Task 1 Step 4), `docs/journeys/narrate-right-after-the-last-child-reports-3589.md` (a historical account of #3589's build; still true), `docs/superpowers/plans/2026-11-16-wait-for-d3-6.md` (#5602's executed plan; history).

## Spec coverage map

| AC clause | Where |
|---|---|
| AC1.1 | Task 1 tests `AC1.1` (both) |
| AC2.1, AC2.2 | Task 1 test `AC2.1/AC2.2` |
| AC3.1 | Task 1 test `AC3.1` |
| AC4.1 | Task 1 Step 4 (both suites pass; gate suite diff empty) |
| AC5.1 | Controller step "AC5 go-red proof" |
| AC6.1 | Task 1 Step 3, `docs/hooks.md:17` |
| AC7.1, AC7.2 | Controller step "Deliverable 1 / AC7 tally" |
| AC8.1 | Task 2 Steps 1-2 |
| AC8.2 | Controller step "Deliverable 5 / AC8" |

## Global Constraints

- The gate count is today's `countPendingDispatches`: same export name, same signature `(lines, replyIndex)`, same result for every input.
- The marker count differs from the gate count in one branch only: the one that today returns `null` for a `<task-notification>` outside a recognized carrier (`if (line.includes('<task-notification>')) return null;`). There the marker count skips the line and keeps counting when the line is one of exactly three shapes:
  - the agent's own prompt: the first user message of the transcript (the first parseable entry with `type === 'user'`, by position — never by content);
  - a tool result: an entry carrying a non-null `toolUseResult` (an object or a string — tool errors carry a string);
  - an assistant line: an entry with `type === 'assistant'`.
  Any other shape holding the token outside a recognized carrier returns `null` in both counts. Plan review may narrow this list; it must not widen it.
- Launch detection, recognized carriers, the fork-boundary reset, the `<fork-boilerplate>`-in-unrecognized-carrier `null`, the missing-id and missing-timestamp `null` returns and the `PENDING_DISPATCH_MAX_AGE_MS` rule are identical for both counts.
- A stop reads and parses its transcript once: the memo carries both counts.
- The marker is fail-safe by contract: `recordStop` swallows every fault. The marker-only logic runs inside `grade()` too (outside that `try`), so it must add no throw path — only property reads on an entry already checked to be a non-null object.
- `plugin/bin/lib/hooks/subagent-stop.js` is a protected path; the hook runs in every session.
- No existing assertion in `tests/hooks-subagent-stop.test.js` or `tests/hooks-subagent-stop-marker.test.js` is edited or removed (AC4). `AC8.1` in the marker suite stays as is; add fixtures, never "fix" it.
- Commit subjects: `{Verb} {what} — {detail}`, ending `refs #5706` (never `closes`/`fixes`).
- Governing project skill `.claude/skills/transcript-payload-verification/SKILL.md`, quoted: "Fail closed on a carrier you did not recognize: `subagent-stop.js` returns an indeterminate result when `<task-notification>` or `<fork-boilerplate>` shows up in any other entry shape, and its tests pin both the recognized carriers and that fallback. A test that asserts only the fail-closed outcome (`block`) passes whether the carrier is recognized or not, so also assert the parsed value (a count of `0`, not `null`)." The gate keeps that rule; the marker's new tests assert the parsed value (`0`, `1`) as well as `null`.
- Governing project skill `.claude/skills/windows-checkout-test-parity/SKILL.md`, quoted: "Skip a test pinning POSIX kernel paths (trailing `/`, `..` after a symlink) up front on win32, which resolves both as text; never on a setup throw: CI allows symlinks (#5380)." The `AC10.3` symlink test pins no POSIX kernel path, so its win32 skip is removed and settled by a windows-latest run.
- Scratch checks stay scratch: the Deliverable 1 tally script is never committed; its output goes to the run dir's `evidence/` and the PR body.

## Review Focus

1. A transcript with a non-user line (a `summary` or `system` entry) before the prompt — the first user message is still found by position, so a prompt quoting the token yields a number. Test: Task 1 `RF1`.
2. A tool error result: `toolUseResult` is a string, not an object, and its content quotes the token — still a tool result, skipped. Test: Task 1 `RF2`.
3. A `tool_result` user line with no `toolUseResult` field quoting the token — not one of the three shapes, so `null` in both counts (the existing gate test's `quoted()` shape). Test: Task 1 `RF3`.
4. `<fork-boilerplate>` quoted in the first user message — the Decision covers only `<task-notification>`, so `null` in both counts. Test: Task 1 `RF4`.
5. A worker fork whose inherited parent prompt quotes the token and whose own directive (inside the `<fork-boilerplate>` boundary entry) quotes it too — the boundary entry is already skipped by the reset; the parent's first user message is skipped by the marker only, and the fork's own uncompleted launch is pending. Marker `1`, gate `null`. Test: Task 1 `RF5`.

---

### Task 1: Marker count beside the gate count, from one scan

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/subagent-stop.js` (header comment source 6 + "Stop marker (#5602)" paragraph; `countPendingDispatches` at :353-400; `grade()` at :526-531; `recordStop` at :568-583; `module.exports` at :592)
- Modify: `docs/hooks.md:17` (the "SubagentStop stop marker (#5602)" bullet)
- Test: `tests/hooks-subagent-stop-marker.test.js` (new fixtures and tests only)
- Waived `tests/hooks-subagent-stop.test.js`: read-only; Step 4 runs it unchanged to prove AC4.

**Interfaces:**
- Produces: `scanPendingDispatches(lines: string[], replyIndex: number) -> { gate: number|null, marker: number|null }`, exported from `subagent-stop.js`. `countPendingDispatches(lines, replyIndex)` returns `scanPendingDispatches(lines, replyIndex).gate`. Memo keys: `memo.pending` (gate, unchanged name) and `memo.markerPending` (marker).

- [ ] **Step 1: Write the failing tests** in `tests/hooks-subagent-stop-marker.test.js`

Add fixture helpers beside the existing ones (reuse `at`, `agentCall`, `launchAck`, `notification`, `reply`, `toLines`, `writeTranscript`, `setup`, `runHook`):
- `prompt(text, min)` → `{ type: 'user', timestamp: at(min), message: { role: 'user', content: text } }` (a first user message; no `origin`, no `toolUseResult`).
- `agentCallWithPrompt(id, promptText, min)` → like `agentCall` but `input: { description: ..., prompt: promptText }`.
- `toolResult(toolUseId, text, min, toolUseResult)` → a user `tool_result` entry; when `toolUseResult` is passed, the entry carries it (an object such as `{ stdout: text }`, or a string).
- `forkBoundary(directive, min)` → `{ type: 'user', timestamp: at(min), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_fork', content: [{ type: 'text', text: 'Fork started — processing in background' }] }, { type: 'text', text: '<fork-boilerplate>\nYou are a worker fork.\n</fork-boilerplate>\n\nYour directive: ' + directive }] } }`.
- `QUOTE` = `'Wait until every child\'s <task-notification> has arrived.'`.

Tests (each asserts the hook's marker line through `marker.readStops(sid)` and the gate count through `substop.countPendingDispatches(toLines(entries), entries.length - 1)`):

```js
test('AC1.1: a first user message quoting <task-notification>, no launches, writes pending 0; the gate count is null', ...)
// entries: prompt(QUOTE, 0), Read tool_use (id toolu_r, min 1), toolResult('toolu_r', 'ok', 1, { stdout: 'ok' }), reply('Done.\nSTATUS: DONE', 2)
// runHook(entries, { session_id: sid, agent_id: 'agent-ac1' }, {})  -> stops[0].pending === 0
// countPendingDispatches(...) === null
// substop.scanPendingDispatches(lines, last) deepStrictEqual { gate: null, marker: 0 }

test('AC1.1: the same prompt with an owned run and a non-compliant reply — grade computes both counts once — still writes pending 0', ...)
// entries as above but last = reply('Finished, no status line.', 2); runHook with the default owned run
// out.json.decision === 'block' (the gate's null grades as before); stops[0].blocked === true; stops[0].pending === 0

test('AC2.1/AC2.2: the token in a tool-result line and in an assistant Agent call, two launches, one completion, writes pending 1; the gate count is null', ...)
// entries: prompt('Do the task.', 0),
//   agentCallWithPrompt('toolu_1', QUOTE, 0), launchAck('a1', 'toolu_1', 0),
//   agentCall('toolu_2', 1), launchAck('a2', 'toolu_2', 1),
//   notification('a1', 'toolu_1', 2),
//   Read tool_use toolu_r (min 3), toolResult('toolu_r', 'skill text: ' + QUOTE, 3, { stdout: QUOTE }),
//   reply('One lens back.\nSTATUS: DONE', 4)
// stops[0].pending === 1; countPendingDispatches(...) === null

test('AC3.1: the token in a later user message that is not the first, has no toolUseResult and is no carrier, writes pending null; the gate count is null', ...)
// entries: prompt('Do the task.', 0), agentCall('toolu_1', 0), launchAck('a1', 'toolu_1', 0),
//   prompt('relayed: ' + QUOTE, 1)  (a second user message), reply('x\nSTATUS: DONE', 2)
// stops[0].pending === null; countPendingDispatches(...) === null; scanPendingDispatches deepStrictEqual { gate: null, marker: null }

test('RF1: a non-user line before the prompt does not move the first user message', ...)
// entries: { type: 'summary', summary: 's', leafUuid: 'u' }, prompt(QUOTE, 0), reply('ok\nSTATUS: DONE', 1)
// scanPendingDispatches deepStrictEqual { gate: null, marker: 0 }

test('RF2: a tool error result (string toolUseResult) quoting the token is skipped', ...)
// entries: prompt('Do it.', 0), Read tool_use toolu_r, toolResult('toolu_r', QUOTE, 1, 'Error: ' + QUOTE), reply('ok\nSTATUS: DONE', 2)
// scanPendingDispatches deepStrictEqual { gate: null, marker: 0 }

test('RF3: a tool_result line without toolUseResult quoting the token is null in both counts', ...)
// entries: prompt('Do it.', 0), Read tool_use toolu_r, toolResult('toolu_r', QUOTE, 1) (no toolUseResult), reply('ok\nSTATUS: DONE', 2)
// scanPendingDispatches deepStrictEqual { gate: null, marker: null }

test('RF4: <fork-boilerplate> quoted in the first user message is null in both counts', ...)
// entries: prompt('Never write <fork-boilerplate> yourself.', 0), reply('ok\nSTATUS: DONE', 1)
// scanPendingDispatches deepStrictEqual { gate: null, marker: null }

test('RF5: a fork whose inherited parent prompt and own directive quote the token counts only its own launches', ...)
// entries: prompt(QUOTE, 0), agentCall('toolu_p', 0), launchAck('ap', 'toolu_p', 0),   // parent history
//   forkBoundary(QUOTE, 1), agentCall('toolu_f', 2), launchAck('af', 'toolu_f', 2), reply('ok\nSTATUS: DONE', 3)
// scanPendingDispatches deepStrictEqual { gate: null, marker: 1 }
```

- [ ] **Step 2: Run the suite to verify the new tests fail**

Run: `node --test tests/hooks-subagent-stop-marker.test.js`
Expected: FAIL — `substop.scanPendingDispatches is not a function`, and the AC1/AC2 marker lines read `pending: null`.

- [ ] **Step 3: Implement `scanPendingDispatches(lines, replyIndex) -> { gate, marker }` in `plugin/bin/lib/hooks/subagent-stop.js`**

Move the body of `countPendingDispatches` into `scanPendingDispatches`. Every `return null` becomes `return { gate: null, marker: null }` except the unrecognized-`<task-notification>` branch. Track `firstUserIndex` (the index of the first parseable non-null-object entry with `type === 'user'`, set once, before the fork-boundary check so a boundary that is the first user entry also sets it). In the unrecognized-`<task-notification>` branch: when `i === firstUserIndex || entry.toolUseResult != null || entry.type === 'assistant'`, set a `gateIndeterminate = true` flag and `continue`; otherwise return both null. At the end compute `pending` as today (the missing-timestamp `null` applies to both) and return `{ gate: gateIndeterminate ? null : pending, marker: pending }`. `countPendingDispatches(lines, replyIndex)` becomes `return scanPendingDispatches(lines, replyIndex).gate;` — the gate result is unchanged because today's first unrecognized line returns `null` and the flag forces `null` whatever follows.

`grade()`: replace the `memo.pending = countPendingDispatches(...)` line with one `scanPendingDispatches` call storing `memo.pending = counts.gate` and `memo.markerPending = counts.marker`; `if (memo.pending > 0) return {};` is unchanged.

`recordStop`: when `!('markerPending' in memo)`, compute once — if `memo.last.text` is a string, one `scanPendingDispatches` call sets both `memo.pending` and `memo.markerPending`; otherwise both are `null`. Pass `pending: memo.markerPending` to `appendStop`. Keep everything inside the existing `try`.

Export `scanPendingDispatches` beside `countPendingDispatches`.

Header comment: in source 6, after the sentence that lists the indeterminate shapes, add that the stop marker uses a second count from the same scan which skips the token in the three given-or-written shapes (first user message, `toolUseResult` line, assistant line), why (the gate's `null` decides whether a reply is blocked and nothing measured says it is wrong; the marker only decides when a wait returns, and a skipped line is never a completion, so the marker can only move from `null` to a number never below the true pending count), and that any other shape still yields `null` in both (#5706). In the "Stop marker (#5602)" paragraph, say the marker writes that marker count. Update the `recordStop` comment to name `memo.markerPending`.

`docs/hooks.md:17`: in the stop-marker bullet, replace "`countPendingDispatches` for every such stop" with the marker's own count (`scanPendingDispatches`'s `marker`, one scan shared with the #3015 gate count), and add, after the `pending` is `null` list: the marker count skips a `<task-notification>` outside a recognized carrier when the line is the agent's first user message, a tool-result line (`toolUseResult`), or an assistant line; any other such line still makes it `null`; the #3015 gate count (`countPendingDispatches`) is unchanged; reason, in one or two sentences — the gate's fail-closed rule decides whether a reply is blocked and nothing measured says it is wrong, while the marker only decides when a wait returns and its failure mode is a wait that never sees a finished child (#5706).

- [ ] **Step 4: Run both suites to verify they pass**

Run: `node --test tests/hooks-subagent-stop-marker.test.js tests/hooks-subagent-stop.test.js`
Expected: PASS, 0 failures, `tests/hooks-subagent-stop.test.js` byte-identical to the base (`git diff --stat origin/main -- tests/hooks-subagent-stop.test.js` prints nothing).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/subagent-stop.js tests/hooks-subagent-stop-marker.test.js docs/hooks.md
git commit -m "Give the stop marker its own pending count — skips <task-notification> in given or written text; gate count unchanged, refs #5706"
```

### Task 2: Drop the unmeasured win32 skip from the AC10.3 symlink test

**Role:** transcription

**Files:**
- Modify: `tests/bin-lib/wait-for/marker.test.js:72`

**Interfaces:**
- Consumes: nothing. Produces: nothing.

- [ ] **Step 1: Edit the test declaration**

`test('AC10.3: a symlink, a dangling one included, is refused unread', { skip: process.platform === 'win32' && 'creating a symlink needs a privilege on win32' }, (t) => {` becomes `test('AC10.3: a symlink, a dangling one included, is refused unread', (t) => {`.

- [ ] **Step 2: Verify**

Run: `node --test tests/bin-lib/wait-for/marker.test.js`
Expected: PASS. Then `grep -n "creating a symlink needs a privilege" tests/bin-lib/wait-for/marker.test.js` prints nothing (control: the same grep against `git show origin/main:tests/bin-lib/wait-for/marker.test.js` piped to `grep -n -F "creating a symlink needs a privilege"` prints line 72 — run by the plan author, matched).

- [ ] **Step 3: Commit**

```bash
git add tests/bin-lib/wait-for/marker.test.js
git commit -m "Drop the unmeasured win32 skip from the AC10.3 symlink test — settled by a windows-latest run, refs #5706"
```

## Controller steps (not dispatched; run by `/claude-tweaks:build`)

- **Before tally (ran before Task 1, on the unchanged `countPendingDispatches`):** done at plan review time — `{run-dir}/evidence/tally-5706-before.txt`. It splits each final stop's `null` by scan branch (`unparseable-line`, `fork-marker-unrecognized`, `launch-no-id`, `notification-unrecognized-carrier`, `carrier-body-not-string`, `carrier-no-ids:{entry type}` — the id-less `api-request-blob` class included —, `missing-timestamp`, and the hook's own `no-text`), and the `notification-unrecognized-carrier` and `fork-marker-unrecognized` branches by line shape (`first-user-message`, `tool-result (toolUseResult)`, `assistant`, and anything else by entry type). Its labelled gate scan matched `countPendingDispatches` on every stop (`gateMismatchesVsCountPendingDispatches: 0`).
- **AC5 go-red proof (after Task 2):** in the worktree, change `recordStop`'s `pending: memo.markerPending` to `pending: memo.pending`, run `node --test tests/hooks-subagent-stop-marker.test.js`, quote the failing AC1.1/AC2.1 lines in the PR body, restore the line (`git diff` empty for that file afterwards).
- **Deliverable 1 / AC7 after tally (after Task 1):** the same scratch tally (uncommitted) over `$CLAUDE_CONFIG_DIR/projects/*/*/subagents/*.jsonl`, now also checking `scanPendingDispatches(...).marker` against its labelled marker scan (`markerMismatchesVsScanPendingDispatches` must be 0, as must the gate mismatch count), output to `{run-dir}/evidence/tally-5706-after.txt`. The PR body carries the before/after table; AC7.1 holds when the marker column shows no `notification-unrecognized-carrier` row for the three skipped shapes; every remaining `null` class is listed with its share (AC7.2). One `AC evidence` decision entry cites both files. The residual id-less `api-request-blob` class is staged per the spec's Plan Review Clarifications (a ledger row for the Review Console), never changed here.
- **Deliverable 5 / AC8 (after Common Step 3, the build's last code change):** push, then `gh workflow run windows-regression.yml --ref worktree-dispatch-record-5706`, wait for it, and judge `tests/bin-lib/wait-for/marker.test.js` from the run's `verify-report.json` artifact (the file absent from `failingFiles`) and its `verify-logs/tests.log` (the `AC10.3` symlink test reported `ok`, not `# SKIP`) — never from the job's colour, which is green by design (`continue-on-error`). A red run caused only by other files, an unreadable report, or a timeout is re-run once and never counts as either outcome. Green keeps the skip removed; a marker.test.js failure restores the skip with the measured reason (or adjusts the accepted error codes) in a commit that says which. Any later commit touching code or tests (a review fix wave in the second call) voids that run: the second call re-dispatches it on its final head. Cite the run in the PR body, comment once on #5707 with the run link and outcome, and put `Closes #5707` in the PR body (spec: "#5707 ... is closed with this pull request"); commit subjects keep `refs #5706`.
