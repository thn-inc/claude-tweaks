# Count only no-work fail/exit launches toward the two-in-a-row worker-stop rule (#6321) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `countsTowardLaunchStreak` counts a `fail`/`exit` implementer envelope only when the worker made no successful API request (`duration_api_ms === 0`), so two records that each fail on their own work no longer end a `drive.js --budget` run `worker-stop` or lose their escalation comment.

**Architecture:** `worker.js`'s `classify` copies the result object's `duration_api_ms` onto the envelope as a new last field `apiDurationMs`; `countsTowardLaunchStreak` keys on it. `steps.js`, `run.js` and `budget.js` are unchanged: the narrowed boolean already flows through `ctx.implementerLaunch.counts` → `facts.implementerLaunch.counts` → `budget.js`.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T090936-record-6321/work/6321-spec.md` (materialized from GitHub issue #6321)

Scope keywords: countsTowardLaunchStreak, ENVELOPE_FIELDS, apiDurationMs, duration_api_ms

## Global Constraints

- `apiDurationMs` is added **last** to `ENVELOPE_FIELDS`; no existing field is renamed or reordered ("Fields may be added, never renamed", `worker.js` header).
- `apiDurationMs` = `obj.duration_api_ms` when `typeof v === 'number' && Number.isFinite(v) && v >= 0`, else `null` (also `null` when no result object exists).
- `countsTowardLaunchStreak(env)` = `env.reason === 'launch-error' || (env.status === 'fail' && env.reason === 'exit' && env.apiDurationMs === 0)`; non-object → false. `sharedCauseOf`, `SHARED_CAUSE_API_TYPES`, `SHARED_CAUSE_API_STATUSES` unchanged.
- The free-text `result` string is never read.
- `ENVELOPE_FIELDS` stays a split string literal, never an array literal starting with `'status'` (headless-worker-launch skill, Anti-Patterns: "Writing a schema `required` list or a field list as an array literal that starts with `'status'` | `tests/git-status-optional-locks.test.js` reads it as a git argument list; derive the list instead").
- Governing skill `.claude/skills/headless-worker-launch` (names `worker.js`), quoted verbatim:
  - "Drive `launchWorker` from `worker.js` with the real `defaultRunner`, wrapped through the `runner` dependency so that it changes only what the probe tests (for a tool, its name in `--tools`). Every other flag, the environment and the generated settings stay the module's own; anything else measures a launch the driver never makes."
  - "Record each result in the module header with the CLI version, platform, date, login kind and whether a TTY was attached, and keep rights that rest on an unprobed cell off."
  - "| Copying the probed facts into this skill or another document | They drift from the headers they came from; point at `roles.js` and `worker.js` instead |" — so `docs/driver.md` states the rule, not the probe numbers.
  - The remaining rules (allow lists, sandbox, `--restricted`, deny list, untrusted text, termination forwarding) do not apply: this change adds no right, flag, tool or consumer of worker text.
- `bin-source-scan-conformance` / source-scan suites: the change adds no `fs`, spawn or git call to `plugin/bin/`, so no sanctioned-form rewrite is needed.
- Commit messages: `{Verb} {what} — {detail}`, ending with `refs #6321` (never `fixes`/`closes`).

## Review Focus

1. A `fail`/`exit` with `duration_api_ms` absent, a string, negative, `NaN`/`Infinity` (JSON cannot carry NaN — a string `"0"` is the realistic bad value) must read `null` and not count — Task 1 AC1.3 tests.
2. A `fail`/`exit` 529-overload envelope that already did work (`duration_api_ms > 0`) must not count — Task 1 updates the existing `#6118 a 529 overloaded…` test.
3. `spend-ceiling` with `duration_api_ms: 0` (the budget fixture carries 0) must still not count — Task 1 table row.
4. Existing `run.test.js` fixtures that expect `counts: true` for `fail`/`exit` must get `apiDurationMs: 0`, or they silently stop counting — Task 1 Step 3 grep.
5. Prose that states the old counting set (`worker.js` header line 57, `docs/driver.md:83,286`, `docs/plugin-structure.md:135`'s field list, journey line 31/33) — Task 2.

---

### Task 1: `apiDurationMs` envelope field and narrowed `countsTowardLaunchStreak`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/driver/worker.js` (header lines 8-10 field list, 57-58 counting sentence, new probe bullet after line 166; `ENVELOPE_FIELDS` line 233; `countsTowardLaunchStreak` 361-364; `classify`'s `envelope` helper 374-386)
- Test: `tests/bin-lib/driver/worker.test.js`
- Test: `tests/bin-lib/driver/run.test.js`
- Test: `tests/bin-lib/driver/budget.test.js`
- Waived `plugin/bin/lib/driver/budget.js`: read only — Decision "the narrowing lives only in `worker.js`"; it consumes `facts.implementerLaunch.counts` (`budget.js:350-356`).
- Waived `plugin/bin/lib/driver/steps.js`: read only — `steps.js:888` calls `countsTowardLaunchStreak(envelope)`; no change.
- Waived `plugin/bin/lib/driver/run.js`: read only — copies `counts` into facts (`run.js:525`); no change.

**Interfaces:**
- Produces: envelope field `apiDurationMs: number|null` (last in `ENVELOPE_FIELDS`); `countsTowardLaunchStreak(env): boolean` with the Global Constraints rule.

- [ ] **Step 1: Write the failing tests**

`worker.test.js`:
- Extend `AC5: the envelope field names are pinned` and AC3.1: expected list ends `'sessionId', 'apiError', 'apiDurationMs'`; `AC5: an ok result…` additionally asserts `env.apiDurationMs === OK.duration_api_ms` (7571). Name: `'AC3.1 (#6321): …'` on a new assertion or rename keeps the old AC5 id plus `AC3.1 (#6321)`.
- `test('AC1.1 (#6321): a ran-and-failed error_max_turns result does not count', …)`: fake runner `{ code: 1, stdout: JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 2, duration_api_ms: 958 }) }` → `status 'fail'`, `reason 'exit'`, `apiDurationMs 958`, `countsTowardLaunchStreak false`, `sharedCauseOf false`.
- `test('AC1.2 (#6321): the probed no-work shapes count', …)`: for each of `{api_error_status: 404, api_error_type: 'not_found_error'}`, `{400, 'invalid_request_error'}`, and both absent, over `{ type:'result', subtype:'success', is_error:true, terminal_reason:'api_error', num_turns:1, duration_api_ms:0 }` with exit 1 → `apiDurationMs 0`, `countsTowardLaunchStreak true`.
- `test('AC1.3 (#6321): a missing or invalid duration_api_ms reads null and does not count', …)`: result objects with no `duration_api_ms`, `"0"`, `-1`; plus no result object after exit 1 with non-empty stdout `'not json'` → each `apiDurationMs null`, `reason 'exit'`, `countsTowardLaunchStreak false`.
- Update `#6118 a 529 overloaded api_error is not shared-cause`: without `duration_api_ms` it now asserts `countsTowardLaunchStreak(env) === false`; add `duration_api_ms: 0` variant → true.
- Update `#6118 streak counting by reason` table: `{status:'fail', reason:'exit'}` → false; add `{status:'fail', reason:'exit', apiDurationMs: 0}` → true, `{…, apiDurationMs: 958}` → false, `{…, apiDurationMs: null}` → false, `{status:'fail', reason:'spend-ceiling', apiDurationMs: 0}` → false, `{status:'fail', reason:'launch-error', apiDurationMs: null}` → true.
- `test('AC1.x (#6321): the worker.js header records the no-work probe', …)` in the style of `#6118 AC5.3`: bullet starting `// - No-work launches (#6321)` contains `2026-11-26`, `2.1.325`, `darwin`, `duration_api_ms`, `num_turns`.
- `test('AC4.1 (#6321): live probe — a worker that ran reports apiDurationMs above 0 and does not count; a not-logged-in one reports 0 and counts', { skip: !process.env.DRIVER_LIVE_SMOKE && 'set DRIVER_LIVE_SMOKE=1 to launch real workers (spends tokens)' }, …)`: two `launchWorker({ role: 'implementer', cwd: tmp(t), settingsDir: tmp(t), prompt, model: 'haiku', testCommand: 'node --test', ceilings: { wallClockMs: 180000, spendCeiling: 1 } }, { runner })` calls, `runner` wrapping `worker.defaultRunner`: case 1 appends `'--max-turns', '1'` to `call.args`; case 2 sets `call.options.env.CLAUDE_CONFIG_DIR` to a fresh empty `tmp(t)`. `t.diagnostic` each envelope's `status reason turns apiDurationMs costUsd`. Assert case 1 `apiDurationMs > 0` and `countsTowardLaunchStreak false`; case 2 `apiDurationMs === 0` and `countsTowardLaunchStreak true`.

`run.test.js`:
- `EXIT_FAIL` (line 7371) gains `apiDurationMs: 0` so `#6118 AC8.1` at 7404 keeps `counts: true`.
- `test('AC2.1 (#6321): driveRecord records a ran-and-failed launch as not counting and a no-work 404 as counting', …)`: `harness({ worker: { ...ENVELOPE, status:'fail', reason:'exit', result:null, detail:'x', turns: 2, apiDurationMs: 958, apiError: null } })` → `facts.implementerLaunch` deepEqual `{ status:'fail', reason:'exit', counts:false }`; with `{ …, turns:1, apiDurationMs: 0, apiError: { status: 404, type: 'not_found_error' } }` → `counts: true`, `facts.sharedCause === false`. (The harness's `launchWorker` dep returns envelopes, not result objects; result-object → envelope is AC1.x's job.)
- Add `apiDurationMs: null` to the `ENVELOPE` fixture (line 404-407) so it keeps mirroring `ENVELOPE_FIELDS`.

`budget.test.js`:
- `test('AC2.2 (#6321): two ran-and-failed exit launches in a row end neither run nor streak and keep the escalation comment', …)`: `workerRun([LAUNCH_FAIL('exit', { implementerLaunch: { status:'fail', reason:'exit', counts:false }, escalationCommentId: 991 }), { ...LAUNCH_FAIL('exit'), implementerLaunch: { status:'fail', reason:'exit', counts:false } }], { count: 3 })` → `summary.ended === 'exhausted'`, `ghCalls.length === 0` (no comment DELETE), `streaks` deepEqual `[0, 0, 0]`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/driver/worker.test.js tests/bin-lib/driver/run.test.js tests/bin-lib/driver/budget.test.js`
Expected: FAIL — AC1.1/AC1.3/AC3.1/AC2.1/header test and the updated `#6118` table fail (`apiDurationMs` undefined, `fail`/`exit` still counts). AC2.2 passes at base (it pins downstream behavior on facts; stated in the spec's Decisions) — not a stop.

- [ ] **Step 3: Implement in `plugin/bin/lib/driver/worker.js`**

- `ENVELOPE_FIELDS`: append ` apiDurationMs` to the split string.
- `classify`'s `envelope` helper: add `apiDurationMs` last, per Global Constraints guard.
- `countsTowardLaunchStreak`: the Global Constraints rule.
- Header: line 9-10 field list gains `apiDurationMs`; add a classification sentence after the `apiError` paragraph: "`apiDurationMs` is the result object's `duration_api_ms` when that is a finite number at least 0, else null (and null with no result object)." Replace lines 57-58 with: "`countsTowardLaunchStreak(envelope)` is true for `launch-error`, and for `fail`/`exit` only when `apiDurationMs` is 0 (the worker made no successful API request, #6321); a `fail`/`exit` with `apiDurationMs` above 0 or null, and `ok`, `timeout`, `spend-ceiling` and `schema`, are false."
- Header: after the `Shared cause (#6118)` bullet (ends line 166) insert `//` then a `// - No-work launches (#6321).` bullet: probed 2026-11-26 with Claude Code CLI 2.1.325 on macOS (darwin), subscription login, no TTY, model alias `haiku`, implementer through `launchWorker` with the real `defaultRunner` wrapped for one change per case; the four cases and values from the spec's Decisions (`--max-turns 1`: exit 1, `error_max_turns`, `num_turns` 2, `duration_api_ms` 958; empty `CLAUDE_CONFIG_DIR`: `num_turns` 1, `duration_api_ms` 0; model `claude-nonexistent-0-0`: 404 `not_found_error`, 1, 0; `ANTHROPIC_BASE_URL` to a local HTTP 400 server: 400 `invalid_request_error`, 1, 0); `num_turns` was 1 on every no-work launch, so it does not tell the two kinds apart; Linux and Windows not probed. Re-run: the opt-in `AC4.1 (#6321)` live probe.
- Risk proof, checked before committing:
Proof(auth): the change reads one numeric result field (`duration_api_ms`) and touches no credential, login or permission path — `ENV_ALLOW`, `buildEnv`, `roles.js` and the generated settings are unchanged (`git diff origin/main -- plugin/bin/lib/driver/roles.js` empty, and `git diff origin/main -- plugin/bin/lib/driver/worker.js` shows no edit to `ENV_ALLOW`/`buildEnv`); the AC4.1 probe's not-logged-in case only points the already allow-listed `CLAUDE_CONFIG_DIR` at an empty temp dir.
- Then grep for remaining fixtures: `git grep -n -e "reason: 'exit'" -e "EXIT_FAIL" -- tests/bin-lib/driver` and for each one asserting `counts: true` or a `worker-stop`, give it `apiDurationMs: 0` (known: `run.test.js` `EXIT_FAIL`). Fixtures asserting `counts: false` (run.test.js 9521-9538, budget.test.js 845) stay as they are.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/driver/worker.test.js tests/bin-lib/driver/run.test.js tests/bin-lib/driver/budget.test.js tests/git-status-optional-locks.test.js`
Expected: PASS (live probes skipped).

- [ ] **Step 5: AC3.2 revert check**

Temporarily restore the old `countsTowardLaunchStreak` body (field kept), run `node --test tests/bin-lib/driver/worker.test.js tests/bin-lib/driver/run.test.js`, quote the failing test names in the report (expected: AC1.1, AC1.3, AC2.1 ran-and-failed half, the updated `#6118` 529 and table tests), restore the change, re-run green.

- [ ] **Step 6: AC4.1 live probe**

Run: `DRIVER_LIVE_SMOKE=1 node --test --test-name-pattern "6321" tests/bin-lib/driver/worker.test.js`
Expected: PASS on darwin; quote the `# ` diagnostic lines in the report (they go in the PR). Write full output with a Bash redirect to `"/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-26T090936-record-6321/evidence/ac4.1-live-probe.txt"` (after `mkdir -p` of that `evidence` dir).

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/driver/worker.js tests/bin-lib/driver/worker.test.js tests/bin-lib/driver/run.test.js tests/bin-lib/driver/budget.test.js
git commit -m "Count only no-work fail/exit launches toward the launch streak — apiDurationMs envelope field, refs #6321"
```

### Task 2: Docs name the narrowed counting set

**Role:** transcription

**Files:**
- Modify: `docs/driver.md` (line 83 two-in-a-row bullet, line 286 Cost paragraph)
- Modify: `docs/journeys/launch-a-rights-limited-headless-worker-5217.md` (lines 31, 33)
- Modify: `docs/plugin-structure.md` (line 135, worker.js row's `ENVELOPE_FIELDS` list)
- No-change: `docs/journeys/let-the-driver-pick-records-under-a-budget-5229.md:62` ("after two counting launch failures in a row" — defers to the counting rule, still true); `plugin/bin/lib/driver/run.js:211-271`, `budget.js:254` comments (speak of "counted"/`counts`, still true).

**Interfaces:**
- Consumes: Task 1's `apiDurationMs` name and rule.

- [ ] **Step 1: Edit `docs/driver.md:83`**: replace "A launch counts when it is a `launch-error` or a `fail` with reason `exit`; a timeout, a HEAD move or a worker that ran resets the streak" with "A launch counts when it is a `launch-error`, or a `fail` with reason `exit` whose `apiDurationMs` is 0, where the worker made no successful API request (#6321); a `fail`/`exit` whose `apiDurationMs` is above 0 or unreadable (a worker that ran and failed its own record), a timeout, a HEAD move or a worker that ran resets the streak". Rule only — no probe numbers (governing skill).
- [ ] **Step 2: Edit `docs/driver.md:286`**: after "reaches `worker-stop` only through the two-in-a-row rule," add the narrowed-set consequence: such a launch counts only when its result object reports `duration_api_ms` 0; one with no readable result object no longer counts, and is escalated per record like any other failure, bounded by `--budget`.
- [ ] **Step 3: Edit journey**: line 31 field list gains `sessionId`, `apiError`, `apiDurationMs` only if absent (it lists through `detail`; add `apiError`, `apiDurationMs` — sessionId too for accuracy); line 33 after the `apiError` sentence add: "`apiDurationMs` is the result object's `duration_api_ms` (null when absent or invalid); a `fail`/`exit` counts toward the two-in-a-row rule only when it is 0."
- [ ] **Step 4: Edit `docs/plugin-structure.md:135`**: "detail, sessionId, apiError — …, #6118)" gains ", apiDurationMs — the result object's `duration_api_ms`, #6321" and the `countsTowardLaunchStreak` clause gains "(a `fail`/`exit` counts only at `apiDurationMs` 0, #6321)".
- [ ] **Step 5: Verify**: `git grep -n -e "or a \`fail\` with reason \`exit\`;" -- docs` returns nothing (control: `git show origin/main:docs/driver.md | grep -F 'or a \`fail\` with reason \`exit\`;'` matches line 83 at base). Run `node --test tests/bin-lib/driver/ tests/docs-*.test.js` → PASS (journey/docs conformance).
- [ ] **Step 6: Commit**

```bash
git add docs/driver.md docs/journeys/launch-a-rights-limited-headless-worker-5217.md docs/plugin-structure.md
git commit -m "Document the narrowed two-in-a-row counting set — apiDurationMs 0 only, refs #6321"
```

---

## Self-review

- **Spec coverage:** Deliverables 1-2 → Task 1 Step 3; Deliverable 3 (header) → Task 1 Step 3 + header test; Deliverable 4 (AC4.1 probe) → Task 1 Steps 1/6; Deliverable 5 (docs) → Task 2. AC1.1, AC1.2, AC1.3, AC3.1 → Task 1 worker tests; AC2.1 → run.test; AC2.2 → budget.test; AC3.2 → Task 1 Step 5; AC4.1 → Task 1 Step 6.
- **Premise note:** spec AC2.1 says the run.test fake "returns the AC1.1 result object"; the harness's `launchWorker` dep returns envelopes, so AC2.1 feeds the envelope `classify` produces for that object (AC1.1 pins that mapping). Gotchas: `subtype: success` + `is_error: true` shapes covered in AC1.2; darwin-only noted in the header bullet.
- **Placeholders:** none.
