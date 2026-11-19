# Driver Worker Targeted Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pipeline driver's implementer worker stops running the whole test suite: its prompt and allow list name only the project's declared targeted test command (or none), and the driver's own test step stays the gate.

**Architecture:** One resolver in `steps.js` reads `impact.command` from `origin/{ref}`'s committed `verify-scope.json` (never the worker-editable worktree copy), cuts its trailing ` {files}`, validates it, and caches the result on `ctx` once per record. `runImplementer` uses it for both the prompt line and the launch's `testCommand`; with no usable declaration the launch omits `testCommand`, which `roles.js`/`worker.js` must now accept.

**Tech Stack:** Node 18+, CommonJS, `node:test` via `node tools/run-tests.js <file.test.js>` (never bare `node --test`).

**Spec:** `.claude-tweaks/pipelines/2026-11-19T062113-spec-5915-5917/spec-5915/work/5915-spec.md`

Scope keywords: TEST_COMMAND, testCommand, workerPrompt, implementerSettings

## Global Constraints

- The driver's test step is unchanged: `TEST_COMMAND = 'npm test'` keeps its use in `testStep` (`steps.js` ~line 937) and in `reviewStep`'s wiring (`steps.js` ~line 1306, evidence runs — a non-goal).
- The targeted form is read from the project's declaration only: `.claude-tweaks/verify-scope.json` → `impact.command`, which must end with the literal ` {files}`; the cut command must match `[A-Za-z0-9 ._/:=-]` (`roles.js` `TEST_COMMAND_PATTERN`) and pass `assertTestCommand`.
- This repository: `impact.command` = `node tools/run-tests.js --files-from {files}` → cut command `node tools/run-tests.js --files-from` → allow rule `Bash(node tools/run-tests.js --files-from *)`.
- No result-schema change: `RESULT_SCHEMA` gains no test field.
- Commit style: `{Verb} {what} — {detail}`, body `Refs #5915`, last line `Claude-Session: https://claude.ai/code/session_01QXpjcSK8T1WgopvtEj1iwJ`. Stage files by explicit path.
- Governing skill `.claude/skills/headless-worker-launch` (names `roles.js`, `worker.js`), quoted verbatim:
  - "For every command an allow rule admits, list its flags that write a file, read outside the working directory (`git diff --no-index`), run a program (a pager, a configured hook, `-c` config) or reach the network, and probe each one through this module's own launcher. Add a step for the worst one to the opt-in live smoke test in `tests/bin-lib/driver/worker.test.js` (`AC7`, run with `DRIVER_LIVE_SMOKE=1`)"
  - "Record each result in the module header with the CLI version, platform, date, login kind and whether a TTY was attached, and keep rights that rest on an unprobed cell off."
  - "No code path composes wider rights after a permission denial"
  - "A worker-editable file the child reads (a `verify-scope.json`, say) must be compared with its base by raw bytes, tolerating CRLF-only differences: not `git diff` or `cat-file`, which the worker defeats with `git update-index --assume-unchanged`/`--skip-worktree`" — here the resolver never reads the worktree copy at all; it reads `origin/{ref}`'s blob by object id (`cat-file blob <sha>` of the `rev-parse origin/{ref}:<path>` result), which no worktree flag affects.
  - Why no new AC7 step: the new rule `Bash(node tools/run-tests.js --files-from *)` admits a strict subset of what `Bash(npm test *)` admitted on this repository (`npm test -- <args>` reaches `tools/run-tests.js` with the same arguments), so no flag becomes reachable that was not already; the header records that, plus the AC5 live run as the probe of the new form, and the no-`testCommand` launch as unprobed live.
- Governing skill `driver-step-addition` does not apply: no step is added, no stop class or event field changes.

## Scope-keyword hits classified no-change

- `plugin/bin/lib/driver/review.js`, `tests/bin-lib/driver/review.test.js` — `testCommand` there is the reviewer's evidence-run rule keyed on `'npm test'`, fed by `reviewStep`'s wiring (`steps.js` line 1306); evidence runs are a spec Non-Goal.
- `plugin/bin/lib/hooks/guard-rewrite.js`, `tests/direct-test-run-guard.test.js`, `tools/direct-test-run-guard.js` — an unrelated `TEST_COMMAND_WORDS` shell-guard set; untouched.
- `tools/run-tests.js` — read-only reference for the `--files-from` contract; untouched.
- `docs/journeys/launch-a-rights-limited-headless-worker-5217.md` — names `testCommand` as a `launchWorker` parameter only; still true.

## Acceptance coverage

- AC1.1 → Task 2 test `#5915 AC1`. AC2.1 → Task 2 test `#5915 AC2`. AC3.1, AC3.2 → Task 2 test `#5915 AC3` (and Task 1's targeted-runner-form test). AC4.1 → Task 2 Step 1's rule that AC12.1/AC12.2 and every test-step test stay unmodified, checked by Step 5's run. AC5.1 → "After the tasks" below (live run quoted in the PR).

## Review Focus

1. A worker-edited `verify-scope.json` must never steer the worker's allow rule — the resolver reads `origin/{ref}`'s blob, so a worktree edit changes nothing (test in Task 2).
2. The review fix-round relaunch (`runImplementer` called a second time) must get the same command as the first launch — one resolution per record, cached on `ctx` (test in Task 2).
3. A declaration whose `impact.command` lacks the ` {files}` suffix, is empty, is not a string, or whose cut form holds a character outside the pattern (e.g. `;`, `$`, `|`) takes the no-declaration path, never a widened rule (tests in Task 2).
4. An unparseable `verify-scope.json` blob, or a git read that throws, takes the no-declaration path; the run continues (the test step still decides) (test in Task 2).
5. With no `testCommand`, the implementer keeps its read-only git rules and sandbox, and gets no `Bash(... *)` test rule and no derived toolchain read paths (tests in Task 1).

---

### Task 1: Make `testCommand` optional for the implementer launch

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/roles.js` (`implementerSettings` ~line 299, `toolchainReadPaths` ~line 409, module header)
- Modify: `plugin/bin/lib/driver/worker.js` (`launchWorker` ~line 512-518 only if needed)
- Modify: `docs/plugin-structure.md` line 128 (the `roles.js` entry: "the test-command rule" becomes "the test-command rule (only when a `testCommand` is given, #5915)", and `toolchainReadPaths` returns `[]` with none)
- Test: `tests/bin-lib/driver/roles.test.js`
- Test: `tests/bin-lib/driver/worker.test.js`
- Consumers enumerated (grep `implementerSettings`, `toolchainReadPaths`): only `worker.js` `launchWorker` and the two test files; the journey `docs/journeys/launch-a-rights-limited-headless-worker-5217.md` names `testCommand` as a parameter only — no change.

**Interfaces:**
- Produces: `implementerSettings({ testCommand, platform, readPaths })` accepts `testCommand === undefined` (absent). Any other value is still checked by `assertTestCommand`. `toolchainReadPaths(undefined, deps)` returns `[]`. `launchWorker({ role: 'implementer', ... })` with no `testCommand` launches.

- [ ] **Step 1: Write the failing tests** in `roles.test.js`:
  - `implementerSettings: an absent testCommand adds no test rule and keeps the git rules`: `implementerSettings({ platform: 'darwin' }).permissions.allow` deep-equals `['Read', 'Edit', 'Write', 'Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git show *)', 'Bash(git ls-files *)']`; the deny list and `sandbox` equal those of a call with `testCommand: 'node --test'`.
  - `implementerSettings: null, '' and a non-string testCommand are still refused`: each throws `/testCommand/`.
  - `toolchainReadPaths: an absent testCommand derives no read path`: `toolchainReadPaths(undefined, deps)` deep-equals `[]` with a `deps` whose `lookup` would resolve anything.
  - `implementerSettings: the targeted runner form composes its rule`: `implementerSettings({ testCommand: 'node tools/run-tests.js --files-from', platform: 'darwin' }).permissions.allow` includes `'Bash(node tools/run-tests.js --files-from *)'` and no entry starting `'Bash(npm'`.
  In `worker.test.js`, following that file's existing implementer-launch fixture: `launchWorker: an implementer launch with no testCommand writes settings with no test rule` — the settings file written for the launch parses to an allow list with no `Bash(` entry other than the five git rules, and the toolchain `lookup` is never called. Rewrite the existing `a bad testCommand is refused with the testCommand TypeError before any lookup` test (~line 147) to pass `testCommand: null` (still refused, still no lookup, no runner call, no settings dir) instead of `undefined`, which is now the absent case. In `roles.test.js`, remove `undefined` from the refused list at ~line 181-182 (keep `null` and `''`), and rewrite the ~line 389 `assert.throws(() => toolchainReadPaths(undefined, d), …)` to `assert.deepStrictEqual(toolchainReadPaths(undefined, d), [])`. No other existing test changes.

- [ ] **Step 2: Run to verify they fail**
  Run: `node tools/run-tests.js tests/bin-lib/driver/roles.test.js tests/bin-lib/driver/worker.test.js`
  Expected: FAIL — `testCommand must match …, got undefined`.

- [ ] **Step 3: Implement** — in `implementerSettings`, call `assertTestCommand` and push the `Bash(<testCommand> *)` rule only when `testCommand !== undefined`; in `toolchainReadPaths`, return `[]` when `testCommand === undefined` before asserting. Add a header paragraph to `roles.js` stating: the implementer's test rule is now the project's declared targeted runner (`impact.command` cut before ` {files}`), or none; on this repository `Bash(node tools/run-tests.js --files-from *)` admits a strict subset of what `Bash(npm test *)` admitted (`npm test -- <args>` passed the same arguments to `tools/run-tests.js`), so it widens no right; its write/exec flags (`--test-reporter`, `--test-reporter-destination`, listed test files) run inside the same sandbox as before; the new form and the no-`testCommand` launch are both unprobed live as of this commit (the #5915 AC5 driver run is the planned probe; "After the tasks" updates this paragraph with its result).

- [ ] **Step 4: Run to verify they pass** — same command; Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — `git add plugin/bin/lib/driver/roles.js plugin/bin/lib/driver/worker.js docs/plugin-structure.md tests/bin-lib/driver/roles.test.js tests/bin-lib/driver/worker.test.js` (only those changed), message `Make the implementer's testCommand optional — no test rule and no toolchain read path without one`.

### Task 2: Resolve the targeted command and use it in the worker prompt and launch

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/steps.js` (`workerPrompt` ~line 571, `runImplementer` ~line 687-715; new helper next to `scopeBaseBlob` ~line 848)
- Modify: `docs/driver.md` ("Worker rights" section, bullet ~line 294)
- Test: `tests/bin-lib/driver/run.test.js`
- Consumers enumerated (grep `workerPrompt`, `runImplementer`): `workerStep` (line 769) and `reviewStep`'s `launchImplementer` wiring (line 1305), both in `steps.js`; no other caller.

**Interfaces:**
- Consumes: Task 1's optional `testCommand`; existing `scopeBaseBlob(deps, wt, ref, scopeRel)` and `gitIn`.
- Produces: `workerTestCommand(ctx, deps) -> { declared: string, command: string } | null` (`declared` is the full `impact.command`, `command` the cut form), cached on `ctx.workerTestCommand` (`undefined` = not resolved yet). `workerPrompt(ctx, { minutes, dollars, maxLines, tests })` where `tests` is that value.

- [ ] **Step 1: Write the failing tests** in `run.test.js` (use `scopeSame()` / `blobCall` and script `[onGit('cat-file', 'blob', SCOPE_SHA), <json>]` for the blob's bytes; `DECL = JSON.stringify({ impact: { command: 'node tools/run-tests.js --files-from {files}' } })`):
  - `#5915 AC1: with a declared impact.command the prompt names it and no npm test line` — prompt includes `node tools/run-tests.js --files-from {files}`, includes `Never run the whole suite`, and has no line starting `Test command: npm test`; `workerCall(h).args[0].testCommand === 'node tools/run-tests.js --files-from'`.
  - `#5915 AC2: with no declaration the prompt says not to run tests and the launch has no testCommand` — default harness; prompt matches `/do not run tests/i`, contains neither `npm test` nor `run-tests.js`; `'testCommand' in workerCall(h).args[0] === false`.
  - `#5915 AC3: the composed settings never admit the whole suite` — for both cases, `implementerSettings({ testCommand: opts.testCommand, platform: 'darwin' }).permissions.allow` holds no rule matching `/^Bash\(npm test/` nor `'Bash(node tools/run-tests.js *)'`; with the declaration it includes `'Bash(node tools/run-tests.js --files-from *)'`.
  - `#5915: a declaration not ending in " {files}", an empty or non-string command, a cut command with ";" or "$", missing impact, or unparseable JSON takes the no-declaration path` — table-driven over those blob bodies; each gives no `testCommand` and the AC2 prompt.
  - `#5915: the worktree copy never steers the command` — base blob holds `DECL`, the worktree file (`h.files[SCOPE]`) holds a declaration with `npm test {files}`; launch gets `node tools/run-tests.js --files-from`; no `readFile` of `SCOPE` happens before the worker launch.
  - `#5915: one resolution per record — the review fix-round relaunch gets the same command` — reuse the existing fix-round fixture (`implementerCalls(h)`, ~line 3797); both launches carry the same `testCommand` and exactly one `cat-file blob` git call precedes the first launch.
  - `#5915: a git read that throws takes the no-declaration path and the run reaches the test step`.
  - `#5915: the list file the prompt names is never staged` — the AC1 prompt names the fixed path `.claude-tweaks/pipelines/worker-test-files.txt`; with a `status --porcelain -z --untracked-files=all` reply listing that path beside `a.js`, the commit step's `add` call names `a.js` and not the list file (`isRunArtifact` already exempts `.claude-tweaks/pipelines/`).
  Update the existing tests that pinned the old behavior, and only these: `the worker step launches the implementer…` (~line 1518: drop `testCommand` from the expected opts — default harness has no declaration); `the worker prompt states…` (~line 1546: replace the `'npm test'` part with the no-declaration sentence's text); and the two baseline call-sequence tests AC7.1 (#5414, ~line 2153) and AC8.1 (#5415, ~line 1972), whose `BASE_CALLS_PLAIN`/`BASE_CALLS_FIX` gain the resolver's reads (or `baselineCalls` filters them) — the `isHeadReadInWt(plain.calls[at - 1])` assertion must still hold unmodified, which the resolution's placement (Step 3) guarantees. AC12.1/AC12.2 and every other test-step test stay unmodified.

- [ ] **Step 2: Run to verify they fail**
  Run: `node tools/run-tests.js tests/bin-lib/driver/run.test.js`
  Expected: FAIL in the new `#5915` tests.

- [ ] **Step 3: Implement** — `workerTestCommand`: return the cached value if `ctx.workerTestCommand !== undefined`; else `scopeBaseBlob(deps, ctx.wt, ctx.shared.ref, '.claude-tweaks/verify-scope.json')`, then `gitIn(deps, ctx.wt, ['cat-file', 'blob', sha])`, `JSON.parse`, take `impact.command`; require a string ending in ` {files}`, cut it, require `TEST_COMMAND_PATTERN`-safe (call `roles.js`'s exported check, exporting `assertTestCommand` if not already); anything else, including any throw, caches and returns `null`. In `workerPrompt` replace the `Test command:` line with exactly one of:
  - `Tests: run only the test files that cover what you changed, by explicit path — write their repo-relative paths, one per line, to .claude-tweaks/pipelines/worker-test-files.txt and run \`${declared}\` with {files} as that path. Never run the whole suite; the driver runs the full check after you finish.`
  - `Tests: do not run tests — the driver runs the project's check after it commits your change.`
  In `runImplementer`, call `workerTestCommand` first — before the `ceilings`/`maxLines` work and before `headOf(deps, ctx.wt)` — so the HEAD read stays the call immediately before the launch; pass `tests` to `workerPrompt` and spread `testCommand: tests.command` into the launch options only when `tests !== null`.

- [ ] **Step 4: Document** — in `docs/driver.md` "Worker rights", rewrite the allow-list bullet's test-command clause: the implementer's test rule is the project's declared targeted runner, `impact.command` from `origin/{ref}`'s `.claude-tweaks/verify-scope.json` cut before its trailing ` {files}` (this repository: `node tools/run-tests.js --files-from`), read from the base, never the worker's copy, once per record; with no usable declaration there is no test rule and the prompt says not to run tests. Add one bullet: the worker runs only the test files covering its change, never the whole suite, and the driver's test step (`verify.js`, after the commit) is the gate — a red run there stops the record.

- [ ] **Step 5: Run to verify they pass** — `node tools/run-tests.js tests/bin-lib/driver/run.test.js tests/bin-lib/driver/review.test.js tests/bin-lib/driver/roles.test.js` (run.test.js pins named rules in `docs/driver.md`); Expected: PASS, 0 failures.

- [ ] **Step 6: Commit** — `git add plugin/bin/lib/driver/steps.js docs/driver.md tests/bin-lib/driver/run.test.js` (plus `plugin/bin/lib/driver/roles.js` only if an export was added), message `Point the driver worker at targeted tests only — the declared impact command from origin's verify-scope.json, or none`.

### After the tasks (not a dispatched task)

AC5 — a live `node plugin/bin/drive.js` run on one admitted record (`node plugin/bin/drive.js --check #N` first), quoting the worker transcript's largest `# tests` total (≤ 1,000) and the worker step's `ms` (≤ 300000) in the PR. It launches a real worker and opens a real PR, so the orchestrating session runs it or records it on the run's ledger. Once it has run, update the `roles.js` header paragraph Task 1 wrote with the observed CLI version, platform, date, login kind and TTY state, replacing "unprobed live".
