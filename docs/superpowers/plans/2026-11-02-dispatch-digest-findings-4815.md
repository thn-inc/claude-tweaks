# Dispatch Digest Findings (#4815) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle the 12 below-floor `dispatch` findings #4815 promoted from digest #1426. Each one is either fixed in code or closed out with its reason recorded on #4815.

**Architecture:** The 12 findings reduce to 8 distinct ones; four lines are duplicates (D2=D10, D5=D12, D9≈D11). The three local 30 s literals move to one lazily resolved shared export, `GH_BATCH_TIMEOUT_MS`. The dispatch worktree/branch names, `nonEmptyString` and `isObject` get one home, `lib/dispatch/resume-eligibility.js`, which `bin/dispatch-resume.js` imports. `parseStatus` delegates to `git-z.js`'s `parseStatusPorcelainZ` through a new opt-in `strict` mode, so it still fails loud. The remaining findings are comment fixes. The N+1 blocker read (D5/D12) is closed out with a reason rather than batched.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T023336-record-4815/work/4815-spec.md`

## Global Constraints

- From the spec's Acceptance Criteria: "Each deliverable is fixed, or closed out with its reason recorded on this record." (AC1.1)
- From the spec's Acceptance Criteria: "Each promoted entry line in #1426 carries this record's ref." (AC2.1). Already satisfied: all 12 lines in #1426's comments 6545503195 and 6545562270 end in `→ #4815` (`gh api repos/thn-inc/claude-tweaks/issues/1426/comments`, read at plan time). The executor re-reads them once in Task 5. No write is needed.
- Governing skill `gh-api-module-pattern` (quoted verbatim): "**`GH_TIMEOUT_MS` is a resolved value, not a literal — import it, never retype its default at a new call site.**" and "A batched call earns a wider bound than the 5s single-call convention — `plugin/bin/fetch-sub-issues.js`'s runner passes `timeout: 30000` for a 50-alias GraphQL batch and states the reason in a comment beside it, rather than carrying 5000 over by copy."
- Governing skill `gh-api-module-pattern` (quoted verbatim): "**Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see.**" and "Wrap the site's own options object and keep its `timeout`, `stdio`, `maxBuffer` and `windowsHide` literal inside it". The `timeout:` value changes, but no spawn's options literal loses its `windowsHide`/`ghOptions` wrap.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Out of scope, reported rather than edited: the other batched-call 30 s literals (`plugin/bin/fetch-sub-issues.js:79`, `plugin/bin/lib/preflight-records/preflight-records.js:29` `GH_CALL_TIMEOUT_MS`, `plugin/bin/lib/issues/link.js:28`), and the repo-wide `isObject`/`nonEmptyString` re-declarations outside the dispatch feature (14 files). The record names only the dispatch sites.
- Commit messages reference the record as `refs #4815`, never `closes`/`fixes`.

## Review Focus

1. `gh-timeout-ms` raised above 30 s (e.g. 45000). The batched calls must then use 45000, not 30000. Pinned in Task 1's `GH_BATCH_TIMEOUT_MS` tests.
2. `GH_BATCH_TIMEOUT_MS` is read at require time of `resolve-blockers.js`/`resolve-linked-prs.js`/`dispatch-resume.js`. A require-time read would pay the policy read in every test that requires them. The getter is read inside the runner call only. Pinned by Task 1's "no read at factory time" assertion.
3. A `git status -z` stream with a 3-char record after a valid header must still exit 4 with `shorter than "XY path"` and not be silently skipped. Pinned by the existing `dispatch-resume-cli.test.js` test at line 914, kept green in Task 3, plus the new `strict` git-z test.
4. Non-strict `parseStatusPorcelainZ` callers must not change behavior (it still skips short records). Pinned by the existing git-z test at line 150, which stays unmodified.
5. Rename/copy records after the `## ` header still skip their original-path record. Pinned by the existing CLI tests at lines 860-874, kept green in Task 3.

---

### Task 1: Shared batched-call `gh` timeout

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/shared-primitives.js` (add `DEFAULT_GH_BATCH_TIMEOUT_MS = 30000` and a `GH_BATCH_TIMEOUT_MS` getter beside `GH_TIMEOUT_MS`'s; header bullet)
- Modify: `plugin/bin/lib/number-list-cli.js` (drop the `runnerTimeoutMs` option and its header paragraph; the runner reads `GH_BATCH_TIMEOUT_MS` per call)
- Modify: `plugin/bin/resolve-blockers.js` (lines 49-54: delete `runnerTimeoutMs: 30000` and its comment block)
- Modify: `plugin/bin/resolve-linked-prs.js` (lines 42-46: the same deletion)
- Modify: `plugin/bin/dispatch-resume.js` (lines 72, 94-99: delete `NATIVE_TIMEOUT_MS`; `nativeGh` passes `timeout: GH_BATCH_TIMEOUT_MS`)
- Modify: `docs/plugin-structure.md:19` (name `GH_BATCH_TIMEOUT_MS` in the shared-primitives export list, next to `GIT_PUSH_TIMEOUT_MS`)
- Modify: `.claude/skills/gh-api-module-pattern/SKILL.md:29` (append one sentence after the fetch-sub-issues sentence: the shared `GH_BATCH_TIMEOUT_MS` export, `max(30000, GH_TIMEOUT_MS)`, is the bound `number-list-cli.js` and `dispatch-resume.js`'s native runner import)
- Test: `tests/bin-lib/shared-primitives.test.js`, `tests/bin-lib/number-list-cli.test.js`

**Interfaces:**
- Produces: `require('./lib/shared-primitives').GH_BATCH_TIMEOUT_MS`, a lazy getter returning `Math.max(30000, GH_TIMEOUT_MS)` (number, ms). It is enumerable, like `GH_TIMEOUT_MS`. It is not memoized separately: it composes the memoized `GH_TIMEOUT_MS`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/shared-primitives.test.js`, after the existing `GH_TIMEOUT_MS` block. Reuse its `withTempCwd`/`writePolicyFile` helpers and a `freshBatchTimeoutMs()` twin of `freshGhTimeoutMs()`:
  - `GH_BATCH_TIMEOUT_MS: no override -> 30000 floor`: env unset, no policy → `30000`.
  - `GH_BATCH_TIMEOUT_MS: gh-timeout-ms above the floor wins`: policy `gh-timeout-ms: 45000` → `45000`.
  - `GH_BATCH_TIMEOUT_MS: gh-timeout-ms below the floor keeps 30000`: policy `gh-timeout-ms: 8000` → `30000`.
  - `GH_BATCH_TIMEOUT_MS: CLAUDE_TWEAKS_GH_TIMEOUT_MS above the floor wins`: env `50000` → `50000`.

  In `tests/bin-lib/number-list-cli.test.js`, add `realDeps.runner passes GH_BATCH_TIMEOUT_MS as its timeout, read at call time`. Stub `child_process.execFileSync` via `require.cache` (or the file's existing seam, if it has one) to capture `opts.timeout`, then build the CLI and set `process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS = '45000'`. Do this only after the factory call, with shared-primitives freshly required. Then call `realDeps.runner(['api'])` and assert `timeout === 45000`. This proves the getter is not read at factory time.

- [ ] **Step 2: Run, verify they fail**

Run: `node --test tests/bin-lib/shared-primitives.test.js tests/bin-lib/number-list-cli.test.js`
Expected: FAIL. `GH_BATCH_TIMEOUT_MS` is `undefined`, and the runner timeout is `30000`.

- [ ] **Step 3: Implement.** Add the getter: `Object.defineProperty(module.exports, 'GH_BATCH_TIMEOUT_MS', { enumerable: true, get: () => Math.max(DEFAULT_GH_BATCH_TIMEOUT_MS, getGhTimeoutMs()) })`. The comment beside the constant states why it exists: one aliased GraphQL call carries a whole batch, so it gets the batched-call floor, and a raised `gh-timeout-ms` still reaches it. In `number-list-cli.js`, import the module object (`const sharedPrimitives = require('./shared-primitives')`) and read `sharedPrimitives.GH_BATCH_TIMEOUT_MS` inside the runner arrow, keeping `windowsHide: true` and the `ghOptions` wrap literal. Remove the `runnerTimeoutMs` destructure and header text. Delete the CLI-side options. In `dispatch-resume.js`, add `GH_BATCH_TIMEOUT_MS` to the existing shared-primitives destructure. That destructure reads every getter at require time, and `GH_TIMEOUT_MS` is already read the same way there, so this matches house style for this file. Delete line 72.

- [ ] **Step 4: Run, verify they pass**

Run: `node --test tests/bin-lib/shared-primitives.test.js tests/bin-lib/number-list-cli.test.js tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/windows-hide-spawn-conformance.test.js tests/gh-host-seam-conformance.test.js`
Expected: PASS.

Then confirm no stray literal is left: `git grep -n -e 'NATIVE_TIMEOUT_MS' -e 'runnerTimeoutMs' -- plugin tests docs ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md'`. Expected: no output. Control (per the absence-grep check): `git grep -n -e 'NATIVE_TIMEOUT_MS' -e 'runnerTimeoutMs' e41456f21 -- plugin` matches 8 lines on the base commit (`dispatch-resume.js:72,96`, `number-list-cli.js:9,25,52,78`, `resolve-blockers.js:54`, `resolve-linked-prs.js:46`) — run at plan time.

- [ ] **Step 5: Commit** — `git add` the seven files by path; message `Share the batched-call gh timeout — GH_BATCH_TIMEOUT_MS replaces three 30s literals, refs #4815`.

### Task 2: One home for dispatch record names and the two primitives

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/dispatch/resume-eligibility.js` (add and export `dispatchWorktreeName`, `dispatchBranchName`, `nonEmptyString`, `isObject`; `selectResumePr` uses `dispatchBranchName`; `parseClaim` uses `isObject`)
- Modify: `plugin/bin/dispatch-resume.js` (lines 179-180, 490, 606: delete its local `isObject`/`nonEmptyString`, import them; `ctx.head = dispatchBranchName(issue)`; `worktreePath: path.join(mainRoot, HARNESS_WORKTREE_DIR, dispatchWorktreeName(opts.issue))`, with `HARNESS_WORKTREE_DIR` added to the existing `./lib/hooks/worktree-reap` destructure)
- Test: `tests/bin-lib/dispatch/resume-eligibility.test.js`

**Interfaces:**
- Produces: `dispatchWorktreeName(n: number) -> string` (`` `dispatch-record-${n}` ``); `dispatchBranchName(n: number) -> string` (`` `worktree-${dispatchWorktreeName(n)}` ``, the harness's `worktree-{name}` branch for an `EnterWorktree` name); `nonEmptyString(v) -> string|null` (same body as today's); `isObject(v) -> boolean` (non-null, `typeof 'object'`, not an array).

- [ ] **Step 1: Write the failing test** `record names and primitives: one home for the dispatch build's worktree/branch names`, appended to `tests/bin-lib/dispatch/resume-eligibility.test.js` (an existing, passing file):
  - `dispatchWorktreeName(4589) === 'dispatch-record-4589'`
  - `dispatchBranchName(4589) === HEAD` (the file's existing `'worktree-dispatch-record-4589'`)
  - `nonEmptyString('x') === 'x'`, `nonEmptyString('') === null`, `nonEmptyString(3) === null`
  - `isObject({}) === true`, `isObject([]) === false`, `isObject(null) === false`

- [ ] **Step 2: Run, verify it fails**

Run: `node --test tests/bin-lib/dispatch/resume-eligibility.test.js`
Expected: FAIL (`dispatchWorktreeName is not a function`).

- [ ] **Step 3: Implement** as listed in Files. `parseClaim`'s inline check becomes `return isObject(parsed) ? parsed : null;`. Leave `resume-eligibility.js:212`'s `path.dirname` ×3 derivation as it is (not a finding).

- [ ] **Step 4: Run, verify it passes**

Run: `node --test tests/bin-lib/dispatch/resume-eligibility.test.js tests/bin-lib/dispatch/dispatch-resume-cli.test.js`
Expected: PASS. The CLI suite's `WT`/`HEAD` constants are unchanged, which proves the built names are byte-identical.

Then confirm one home: `git grep -n -F 'dispatch-record-$' -- plugin/bin` lists only `resume-eligibility.js`, and `git grep -n -e 'const nonEmptyString' -e 'const isObject' -e 'function nonEmptyString' -- plugin/bin/dispatch-resume.js plugin/bin/lib/dispatch/resume-eligibility.js` lists only `resume-eligibility.js`.

- [ ] **Step 5: Commit** — the two source files and the test, by path; message `Give dispatch record names and primitives one home — resume-eligibility exports them, refs #4815`.

### Task 3: `parseStatus` delegates to `parseStatusPorcelainZ` (strict)

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/git-z.js:107-129` (`parseStatusPorcelainZ(raw, { strict = false } = {})`; strict throws on a token shorter than 4 characters, otherwise behavior is unchanged)
- Modify: `plugin/bin/dispatch-resume.js:413-431` (`parseStatus` splits off the first NUL token as the `## ` header and passes the rest to `parseStatusPorcelainZ(rest, { strict: true })`; dirty = `records.map((r) => r.path)`)
- Modify: `plugin/skills/_shared/git-path-read.md:15` (after `parseStatusPorcelainZ` (a rename lists the new path first), add: `{ strict: true }` throws on a record shorter than `XY path` instead of skipping it)
- Test: `tests/bin-lib/git-z.test.js`

**Interfaces:**
- Produces: `parseStatusPorcelainZ(raw: string, opts?: { strict?: boolean }) -> Array<{xy, path, origPath?}>`. Under `strict: true`, a short token throws `Error` with the message `` `a status record was shorter than "XY path" (${JSON.stringify(token)})` ``.

- [ ] **Step 1: Write the failing test** `parseStatusPorcelainZ strict: a token shorter than 4 characters throws; well-formed input parses as non-strict`, appended to `tests/bin-lib/git-z.test.js` (an existing, passing file):
  - `assert.throws(() => parseStatusPorcelainZ('M a\u0000 M ok.md\u0000', { strict: true }), /shorter than "XY path" \("M a"\)/)`
  - `assert.deepEqual(parseStatusPorcelainZ('R  new.md\u0000old.md\u0000', { strict: true }), [{ xy: 'R ', path: 'new.md', origPath: 'old.md' }])`
  - Leave the existing line-150 test unmodified (non-strict still skips).

- [ ] **Step 2: Run, verify it fails**

Run: `node --test tests/bin-lib/git-z.test.js`
Expected: FAIL (`Missing expected exception`).

- [ ] **Step 3: Implement.** In `dispatch-resume.js`, `parseStatus` keeps its `typeof` check, the `## ` header check (on the text before the first `\0`; the whole string when there is none), and `parseBranchHeader`. It wraps the strict-parse throw as `fail(e.message)`, so the stderr line still reads `git status (stalled worktree): a status record was shorter than "XY path" (...)`. Import `parseStatusPorcelainZ` from `./lib/git-z`. Update the comment above `parseStatus` so it names the delegation.

- [ ] **Step 4: Run, verify it passes**

Run: `node --test tests/bin-lib/git-z.test.js tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/git-path-read-conformance.test.js`
Expected: PASS. The CLI suite's rename/copy/header-only/short-record tests (lines 860-920) hold unchanged.

- [ ] **Step 5: Commit** — three source/doc files and the test, by path; message `Delegate dispatch-resume's status parse to git-z — strict mode keeps it failing loud, refs #4815`.

### Task 4: Comments that name their rule

**Role:** transcription

**Files:**
- Modify: `plugin/bin/dispatch-resume.js:263` (`(a late-write \`work/\` stub, Review Focus 6)` → `(a late-write \`work/\` stub that recreated the root after archiving)`)
- Modify: `plugin/bin/dispatch-resume.js` `runBound` (above `const pipelines = …`): `// resolveTarget returns the realpath'd dir while ctx.root keeps mainCheckoutRoot's spelling (a symlinked checkout, macOS /var -> /private/var), so either spelling names the main checkout's pipelines dir.`
- Modify: `plugin/bin/dispatch-resume.js` `readOpenBlockers` (above the `for` loop): `// One gh issue view per body-declared blocker: a record's Blocked-by list is a handful of entries and this runs once per manual resume, so the serial reads stay (#4815 closed batching out).`
- Modify: `plugin/bin/lib/dispatch/resume-eligibility.js:9` (`The Closed rule (spec D1):` → `The Closed rule:`)
- Modify: `plugin/bin/lib/dispatch/resume-eligibility.js:114` (replace the one-line comment above `resumableTombstoneReason` with: the three release reasons end a build without finishing it while its PR stays open. `failed:` means a gate stopped the run, `abandoned:` means the run was discarded unmerged, and `swept: stale claim` means /tidy cleared a dead run's claim. `merged:` and `pr-opened:` mean finished, `shaped:`/`routed:` ran no build, and `swept: issue closed` closed the record, so none of those is a resumable stall. Source: `_shared/issue-claims.md`'s Release triggers table.)
- Modify: `plugin/bin/lib/dispatch/resume-eligibility.js:234` (`---- resume context (deliverable 4) ----` → `---- resume context ----`)
- Modify: `tests/bin-lib/dispatch/dispatch-resume-cli.test.js` (lines 520, 690, 1025): drop each `(Review Focus N)` / `(Review Focus 18)` citation from the test names. For 520 the name is `archive-first: archive/{runId} plus a work/-only root dir reads archived`; for 690 drop the trailing ` (Review Focus 8)`; for 1025 `own kept lock: the archived prior run …`.

No test step: comment and test-name text only.

- [ ] **Step 1: Make the edits.**
- [ ] **Step 2: Verify**

Run: `git grep -n -e 'Review Focus' -e 'spec D1' -e 'deliverable 4' -- plugin/bin/dispatch-resume.js plugin/bin/lib/dispatch tests/bin-lib/dispatch/dispatch-resume-cli.test.js`
Expected: no output. Control: `git grep -n -e 'Review Focus' -e 'spec D1' -e 'deliverable 4' e41456f21 -- plugin/bin/dispatch-resume.js plugin/bin/lib/dispatch tests/bin-lib/dispatch/dispatch-resume-cli.test.js` matches 6 lines on base (run at plan time).
Run: `node --test tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/bin-lib/dispatch/resume-eligibility.test.js`. Expected: PASS.

- [ ] **Step 3: Commit** — the three files by path; message `Name the rule in dispatch-resume comments — drop deleted #4588 spec numbering, refs #4815`.

### Task 5 (controller, not dispatched): record the close-outs on #4815

- [ ] Re-read #1426's two comments (ids 6545503195, 6545562270) and confirm all 12 `[dispatch]` lines end in `→ #4815` (AC2.1).
- [ ] Post one comment on #4815 mapping each of the 12 deliverables to its outcome. Fixed: D1 (Task 1), D2/D10/D3/D9/D11 (Task 2), D8 (Task 3), D4/D6/D7 (Task 4). Closed out with reason: D5/D12, the serial body-blocker reads (bounded by the record's own Blocked-by list, once per manual resume; batching would add a second aliased-query shape with partial-result handling for no measured cost). This satisfies AC1.1 for the closed-out pair.

## Spec coverage map

| Clause | Covered by |
|---|---|
| AC1.1 Each deliverable is fixed, or closed out with its reason recorded on this record. | Tasks 1-4 (fixed), Task 5 (D5/D12 closed out). Tests: Task 1 `GH_BATCH_TIMEOUT_MS: …`, Task 2 `record names and primitives: …`, Task 3 `parseStatusPorcelainZ strict: …` |
| AC2.1 Each promoted entry line in #1426 carries this record's ref. | Task 5 re-read. Waived AC2.1 as a test: it is a forge state already true at plan time, not code. |
