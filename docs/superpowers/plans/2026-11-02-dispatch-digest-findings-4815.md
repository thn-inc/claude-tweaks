# Dispatch Digest Findings (#4815) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle the 12 below-floor `dispatch` findings #4815 promoted from digest #1426. Each one is either fixed in code or closed out with its reason recorded on #4815.

**Architecture:** The 12 lines reduce to 8 distinct findings: D2=D10, D5=D12, and D9 is a subset of D11. The three local 30 s batched-call literals become one lazily resolved export, `GH_BATCH_TIMEOUT_MS` = `max(30000, GH_TIMEOUT_MS)`, in `lib/shared-primitives.js`. This is the record's Deliverable 1 decision, Reading B. Since #4849 (merged into this branch by the run's catch-up), the stalled worktree comes from the PR head through `worktreeNameForHead`, so no `dispatch-record-${n}` builder is left. What is left of D2/D10/D3 is the worktree path join, which appears twice and hardcodes `.claude/worktrees`. It becomes one `worktreePathForHead` in `lib/dispatch/resume-eligibility.js` built on `HARNESS_WORKTREE_DIR`, and that module also becomes the one home for `isObject`/`nonEmptyString`. `parseStatus` delegates to `git-z.js`'s `parseStatusPorcelainZ` through a new opt-in `strict` mode, so it still fails loud. The other findings are comment fixes. The serial blocker read (D5/D12) is closed out with a reason.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T073931-record-4815/work/4815-spec.md`

## Global Constraints

- From the spec's Acceptance Criteria: "Each deliverable is fixed, or closed out with its reason recorded on this record." (AC1.1)
- From the spec's Acceptance Criteria: "Each promoted entry line in #1426 carries this record's ref." (AC2.1)
- From the spec, Deliverable 1's decision (verbatim): "Decision: Reading B. The batched-call bound is `max(30000, gh-timeout-ms)`, defined once and shared by all three call sites, so raising the `gh-timeout-ms` policy key also widens batched calls. Update the `gh-timeout-ms` summary in `plugin/bin/lib/policy-schema.js` (and any policy docs generated from it) to say the key also sets the floor for batched `gh` calls." No docs are generated from the summary (`git grep -n -F 'Bounds how long a single' -- .` hits only `policy-schema.js:154`). The prose index row is `plugin/skills/_shared/policy-schema.md:263`, updated in Task 1.
- Governing skill `gh-api-module-pattern` (quoted verbatim): "**`GH_TIMEOUT_MS` is a resolved value, not a literal — import it, never retype its default at a new call site.**" and "A batched call earns a wider bound than the 5s single-call convention — `plugin/bin/fetch-sub-issues.js`'s runner passes `timeout: 30000` for a 50-alias GraphQL batch and states the reason in a comment beside it, rather than carrying 5000 over by copy."
- Governing skill `gh-api-module-pattern` (quoted verbatim): "**Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see.**" and "Wrap the site's own options object and keep its `timeout`, `stdio`, `maxBuffer` and `windowsHide` literal inside it". The `timeout:` value changes, but no spawn's options literal loses its `windowsHide` key or its `ghOptions` wrap.
- Governing skill `policy-key-addition` (quoted verbatim): "its summary must not be copied verbatim from the row's `summary` (`tests/policy-schema-metadata.test.js`). State the value the resolver returns for unset, set and malformed input, from the code, not from intent."
- Governing skill `windows-checkout-test-parity`: `worktreePathForHead` returns a native fs path (it is opened and compared as a path, never shown as an ID), so it uses `path.join` and the tests build their expected value with `path.join` too. No `toPosix`.
- Size: `plugin/skills/_shared/policy-schema.md` is 52,198 B against `RAIL_BYTES` 52,500. Task 1's row replacement is +155 B, leaving 147 B. It was measured on the exact row text below. Do not add more text to that file. `plugin/skills/_shared/git-path-read.md` is 3,618 B, with ample headroom.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Out of scope, reported rather than edited (the record names only the dispatch sites): other batched-call 30 s `gh` literals (`plugin/bin/fetch-sub-issues.js:79`, `plugin/bin/lib/issues/link.js:28`, `plugin/bin/lib/preflight-records/preflight-records.js:29` `GH_CALL_TIMEOUT_MS`), the `isObject` copies in `plugin/bin/lib/dispatch/stuck-open-pr.js:15` (a require-free leaf) and `plugin/bin/lib/qa-report/compose.js:51`, and the `Review Focus N` test names in `tests/bin-lib/dispatch/in-flight-neighbours.test.js`/`queue-order.test.js`, which cite other records' specs. Task 6 records them as an ops ledger row.
- Commit messages reference the record as `refs #4815`, never `closes`/`fixes`. Every commit message ends with the line `Claude-Session: https://claude.ai/code/session_01X7gPFDahTL6p9rLWhJMaoN`.

## Review Focus

1. `gh-timeout-ms` raised above 30 s (e.g. 45000): the batched calls must then use 45000, not 30000. Pinned in Task 1's `GH_BATCH_TIMEOUT_MS` tests and Task 2's runner test.
2. A require-time read of `GH_BATCH_TIMEOUT_MS` in `number-list-cli.js` would pin the bound before a caller's env or cwd is set, and would pay the policy read in every test that requires `resolve-blockers.js`. The getter is read inside the runner arrow only. Pinned by Task 2's "read at call time" test: the env is set after the factory call.
3. A `git status -z` stream with a 3-character record after a valid header must still exit 4 with `shorter than "XY path"` and must not be skipped. Pinned by the existing `dispatch-resume-cli.test.js` test `a status record shorter than "XY path" -> exit 4 …` (line 1190), kept green in Task 4, plus the new strict git-z test.
4. Non-strict `parseStatusPorcelainZ` callers must not change behavior: a short record is still skipped. Pinned by the existing git-z test at line 150, which stays unmodified.
5. The moved worktree path must be byte-identical, including a `/`-segmented head (`fix/thing` → `.claude/worktrees/fix/thing`). Pinned by Task 3's `worktreePathForHead` test and by the existing `closeRedispatchRemedy` / CLI `worktreePath` assertions, which stay unmodified.

---

### Task 1: The shared batched-call `gh` timeout and its policy text

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/shared-primitives.js`. Add `DEFAULT_GH_BATCH_TIMEOUT_MS = 30000` beside `DEFAULT_GH_TIMEOUT_MS` (line 94), add the getter after the `GH_TIMEOUT_MS` defineProperty (line 286), and add a header bullet after the `GH_TIMEOUT_MS` one.
- Modify: `plugin/bin/lib/policy-schema.js:154` (the `gh-timeout-ms` `summary`)
- Modify: `plugin/skills/_shared/policy-schema.md:263` (the `gh-timeout-ms` row)
- Modify: `docs/plugin-structure.md:19` (name `GH_BATCH_TIMEOUT_MS` in the shared-primitives export list, right after the `GH_TIMEOUT_MS`/`GIT_TIMEOUT_MS` getters' sentence)
- Test: `tests/bin-lib/shared-primitives.test.js`

**Interfaces:**
- Produces: `require('./lib/shared-primitives').GH_BATCH_TIMEOUT_MS`. It is an enumerable lazy getter (`Object.defineProperty`, like `GH_TIMEOUT_MS`) returning `Math.max(DEFAULT_GH_BATCH_TIMEOUT_MS, getGhTimeoutMs())` as a number in ms. It has no memo of its own, because it composes the memoized `GH_TIMEOUT_MS`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/shared-primitives.test.js`, after the last `GH_TIMEOUT_MS:` test (line 354's block). Reuse `withTempCwd`/`writePolicyFile`, and add `freshBatchTimeoutMs()`, a twin of `freshGhTimeoutMs()` that returns `.GH_BATCH_TIMEOUT_MS`. Each test saves and restores `CLAUDE_TWEAKS_GH_TIMEOUT_MS` the way the neighbours do:
  - `AC1.1: GH_BATCH_TIMEOUT_MS: no override -> the 30000 floor`: env unset, no policy → `assert.strictEqual(freshBatchTimeoutMs(), 30000)`.
  - `AC1.1: GH_BATCH_TIMEOUT_MS: gh-timeout-ms above the floor wins`: policy `gh-timeout-ms: 45000\n` → `45000`.
  - `AC1.1: GH_BATCH_TIMEOUT_MS: gh-timeout-ms below the floor keeps 30000`: policy `gh-timeout-ms: 8000\n` → `30000`.
  - `AC1.1: GH_BATCH_TIMEOUT_MS: CLAUDE_TWEAKS_GH_TIMEOUT_MS above the floor wins`: env `'50000'` → `50000`.
  - `GH_BATCH_TIMEOUT_MS is an enumerable export`: `assert.ok(Object.keys(require('../../plugin/bin/lib/shared-primitives')).includes('GH_BATCH_TIMEOUT_MS'))`.

- [ ] **Step 2: Run, verify they fail**

Run: `node --test tests/bin-lib/shared-primitives.test.js`
Expected: FAIL (`GH_BATCH_TIMEOUT_MS` is `undefined`).

- [ ] **Step 3: Implement the getter.** The comment beside `DEFAULT_GH_BATCH_TIMEOUT_MS` gives the reason. One aliased GraphQL call carries a whole batch (a comma-list can span the ~200-record queues `--limit 200` builds), so it gets fetch-sub-issues.js's 30 s batched precedent as a floor. `max` with `GH_TIMEOUT_MS` means a raised `gh-timeout-ms` (a GitHub Enterprise Server project) widens batched calls too (#4815). The header bullet says the same in one sentence.

- [ ] **Step 4: Update the policy text.**
  - `policy-schema.js:154` `summary` becomes exactly: ``"Bounds how long a single `gh` subprocess call may run before it is killed and retried once, and sets the floor for a batched `gh` call, which runs for max(30000, this value)."``
  - `_shared/policy-schema.md:263`: replace the whole row with exactly this line (measured at +155 B, file 52,353 B < 52,500):

    ```
    | `gh-timeout-ms` | `policy.yml` | `bin/lib/shared-primitives.js` (every `gh` subprocess call routed through its `GH_TIMEOUT_MS`/`GH_BATCH_TIMEOUT_MS` exports or its `runClassified`/`runClassifiedAsync` runner functions) | `5000` | Bounds (1000-60000) how long one `gh` subprocess call may run before it is killed. It also sets a batched call's floor: `GH_BATCH_TIMEOUT_MS`, max(30000, this value), bounds one aliased GraphQL call (`bin/lib/number-list-cli.js`'s runner, `bin/dispatch-resume.js`'s native-dependency read). A call routed through `runClassified`/`runClassifiedAsync` with `retryOnTimeout: true` (`bin/lib/reconcile/release-merged.js`, `preflight.js`, `pr-state.js`, `ledger-residue.js`, `bin/lib/claim-targets/claim-targets.js`) is retried once at the same bound before its caller sees a failure; other consumers use the bound directly. `CLAUDE_TWEAKS_GH_TIMEOUT_MS` (an env var, not a policy key) takes precedence when both are set. Resolved once per process and cached — a GitHub Enterprise Server project, where a cold `gh` call routinely exceeds the 5s default, raises this instead of every call failing until `gh` warms up |
    ```
  - `docs/plugin-structure.md:19`: after the parenthetical that ends `…import it, never retype its default at a new call site)`, insert `, `GH_BATCH_TIMEOUT_MS` (#4815, a lazy getter composing the former: `max(30000, GH_TIMEOUT_MS)`, the bound for one aliased GraphQL batch — `number-list-cli.js`'s runner and `dispatch-resume.js`'s native-dependency read)`.

- [ ] **Step 5: Run, verify they pass**

Run: `node --test tests/bin-lib/shared-primitives.test.js tests/policy-schema.test.js tests/policy-schema-metadata.test.js tests/policy-key-naming.test.js tests/resolve-policy-cli.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS. Then `wc -c plugin/skills/_shared/policy-schema.md` prints `52353` (any value < 52500 passes the rail).

- [ ] **Step 6: Commit.** `git add` the five files by path. Message: `Add GH_BATCH_TIMEOUT_MS — the batched gh bound is max(30000, gh-timeout-ms), refs #4815`.

### Task 2: The three batched call sites read `GH_BATCH_TIMEOUT_MS`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/number-list-cli.js`. Drop the `runnerTimeoutMs` option, its header lines 9 and 25-31, and the line-52 destructure. The line-78 runner reads `sharedPrimitives.GH_BATCH_TIMEOUT_MS` per call.
- Modify: `plugin/bin/resolve-blockers.js:49-54` (delete `runnerTimeoutMs: 30000` and the comment block above it)
- Modify: `plugin/bin/resolve-linked-prs.js:42-46` (the same deletion)
- Modify: `plugin/bin/dispatch-resume.js`. Delete line 88 `NATIVE_TIMEOUT_MS`. `nativeGh` (line 110-115) passes `timeout: GH_BATCH_TIMEOUT_MS`, which is added to the line-68 shared-primitives destructure.
- Modify: `.claude/skills/gh-api-module-pattern/SKILL.md:30`. After the sentence ending `rather than carrying 5000 over by copy.`, insert: ``The comma-list CLIs' runner (`plugin/bin/lib/number-list-cli.js`) and `plugin/bin/dispatch-resume.js`'s native-dependency runner import `shared-primitives.js`'s `GH_BATCH_TIMEOUT_MS` instead — `max(30000, GH_TIMEOUT_MS)`, so a raised `gh-timeout-ms` widens a batch too (#4815).``
- Test: `tests/bin-lib/number-list-cli.test.js`

**Interfaces:**
- Consumes: Task 1's `GH_BATCH_TIMEOUT_MS` getter.
- Produces: `makeNumberListCli({ name, usage, fetch, mapResult, ghRequiredNote })`, which drops `runnerTimeoutMs`. Its `realDeps.runner(args)` passes `timeout: GH_BATCH_TIMEOUT_MS`, read when the runner is called.

- [ ] **Step 1: Write the failing test** `AC1.1: realDeps.runner passes GH_BATCH_TIMEOUT_MS as its timeout, read at call time`, appended to `tests/bin-lib/number-list-cli.test.js`:
  - Save `const cp = require('node:child_process')` and `orig = cp.execFileSync`. Set `cp.execFileSync = (cmd, args, opts) => { seen = opts.timeout; return ''; }`.
  - `delete require.cache[...]` for `plugin/bin/lib/number-list-cli.js` and `plugin/bin/lib/shared-primitives.js`, then re-require `makeNumberListCli`. It destructures `execFileSync` at require time, so the stub must be in place first.
  - Build `makeNumberListCli({ name: 'x.js', usage: 'usage\n', fetch: () => new Map(), mapResult: () => null })`. **Only after the factory call**, set `process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS = '45000'`.
  - Call `cli.realDeps.runner(['api'])` and assert `seen === 45000`.
  - In `finally`, restore `cp.execFileSync`, the env var (delete it when it was unset), and evict both cache entries again.

- [ ] **Step 2: Run, verify it fails**

Run: `node --test tests/bin-lib/number-list-cli.test.js`
Expected: FAIL (`30000 !== 45000`).

- [ ] **Step 3: Implement as listed in Files.** In `number-list-cli.js`, import the module object (`const sharedPrimitives = require('./shared-primitives')`, keeping `LARGE_MAX_BUFFER_BYTES` reachable). Read `sharedPrimitives.GH_BATCH_TIMEOUT_MS` inside the runner arrow, keeping the `ghOptions(args, { encoding, timeout, maxBuffer, windowsHide: true })` literal. Replace the deleted header paragraph with one line: `realDeps.runner's timeout is shared-primitives' GH_BATCH_TIMEOUT_MS, read per call.` In `dispatch-resume.js`, the shared-primitives destructure already reads `GH_TIMEOUT_MS` at require time, so adding `GH_BATCH_TIMEOUT_MS` there matches the file's own style. Keep a one-line comment on `nativeGh` saying it is one aliased GraphQL call, so it gets the batched bound.

- [ ] **Step 4: Run, verify it passes**

Run: `node --test tests/bin-lib/number-list-cli.test.js tests/resolve-blockers-cli.test.js tests/resolve-linked-prs-cli.test.js tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/windows-hide-spawn-conformance.test.js tests/gh-host-seam-conformance.test.js`
Expected: PASS.

Then confirm no stray literal is left: `git grep -n -e 'NATIVE_TIMEOUT_MS' -e 'runnerTimeoutMs' -- plugin tests docs .claude/skills ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md'`. Expected: no output. Control: the same command run on this branch's tip at plan time matches 8 lines (`dispatch-resume.js:88,112`, `number-list-cli.js:9,25,52,78`, `resolve-blockers.js:54`, `resolve-linked-prs.js:46`). The ledger and plans exclusions were added per #4579.

- [ ] **Step 5: Commit.** `git add` the five source/skill files and the test by path. Message: `Route the batched gh calls through GH_BATCH_TIMEOUT_MS — three 30s literals retired, refs #4815`.

### Task 3: One home for the stalled-worktree path and the two primitives

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/dispatch/resume-eligibility.js`:
  - Add `const { HARNESS_WORKTREE_DIR } = require('../hooks/worktree-reap');`.
  - Add `worktreePathForHead` after `worktreeNameForHead` (line 75-80).
  - Make `nonEmptyString` (line 52) an export, and add `isObject` beside it.
  - `parseClaim` (line 240-247) returns `isObject(parsed) ? parsed : null`.
  - `closeRedispatchRemedy` (line 203) builds `worktree` with `worktreePathForHead(mainRoot, headRefName)`.
  - Export `worktreePathForHead`, `isObject`, `nonEmptyString`.
- Modify: `plugin/bin/dispatch-resume.js`:
  - Delete lines 200-201, the local `isObject`/`nonEmptyString`.
  - Import `worktreePathForHead`, `isObject` and `nonEmptyString` in the `./lib/dispatch/resume-eligibility` destructure (line 76). Drop `worktreeNameForHead` from it if nothing else in the file uses it.
  - Line 567 becomes `ctx.worktreePath = worktreePathForHead(ctx.mainRoot, pr.headRefName);`.
- Test: `tests/bin-lib/dispatch/resume-eligibility.test.js`

**Interfaces:**
- Produces:
  - `worktreePathForHead(mainRoot: string, head: string) -> string|null`: `path.join(mainRoot, HARNESS_WORKTREE_DIR, ...name.split('/'))` where `name = worktreeNameForHead(head)`, or `null` when that name is `null`.
  - `isObject(v) -> boolean`: non-null, `typeof 'object'`, not an array.
  - `nonEmptyString(v) -> string|null`: same body as today's.
- `selectResumePr` already refuses a head whose `worktreeNameForHead` is `null` (line 178) before `dispatch-resume.js:567` runs, so that call never receives `null`.

- [ ] **Step 1: Write the failing test** `AC1.1: worktreePathForHead and the shared primitives have one home`, appended to `tests/bin-lib/dispatch/resume-eligibility.test.js`, with `worktreePathForHead, isObject, nonEmptyString` added to its require (line 9-12):
  - `worktreePathForHead('/m', HEAD) === path.join('/m', '.claude', 'worktrees', 'dispatch-record-4589')`
  - `worktreePathForHead('/m', 'fix/thing') === path.join('/m', '.claude', 'worktrees', 'fix', 'thing')`
  - `worktreePathForHead('/m', 'a$(x)') === null`
  - `nonEmptyString('x') === 'x'`, `nonEmptyString('') === null`, `nonEmptyString(3) === null`
  - `isObject({}) === true`, `isObject([]) === false`, `isObject(null) === false`, `isObject('s') === false`

- [ ] **Step 2: Run, verify it fails**

Run: `node --test tests/bin-lib/dispatch/resume-eligibility.test.js`
Expected: FAIL (`worktreePathForHead is not a function`).

- [ ] **Step 3: Implement as listed in Files.**

- [ ] **Step 4: Run, verify it passes**

Run: `node --test tests/bin-lib/dispatch/resume-eligibility.test.js tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/bin-lib/dispatch/stuck-open-pr.test.js tests/dispatch-resume-prose.test.js`
Expected: PASS. The existing `closeRedispatchRemedy` and CLI `worktreePath` assertions are unchanged, which proves the moved path is byte-identical.

Then confirm one home:
- `git grep -n -F "'.claude', 'worktrees'" -- plugin/bin/dispatch-resume.js plugin/bin/lib/dispatch` prints nothing. Control: the same command on this branch's tip at plan time matches `dispatch-resume.js:567` and `resume-eligibility.js:203`.
- `git grep -n -e 'const nonEmptyString' -e 'function nonEmptyString' -e 'const isObject' -e 'function isObject' -- plugin/bin/dispatch-resume.js plugin/bin/lib/dispatch/resume-eligibility.js` lists only `resume-eligibility.js`. At plan time it matched `dispatch-resume.js:200,201` and `resume-eligibility.js:52`.

- [ ] **Step 5: Commit.** Commit the two source files and the test by path. Message: `Give the stalled-worktree path and the dispatch primitives one home — resume-eligibility exports them, refs #4815`.

### Task 4: `parseStatus` delegates to `parseStatusPorcelainZ` (strict)

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/git-z.js:106-128`. The signature becomes `parseStatusPorcelainZ(raw, { strict = false } = {})`. Under strict, a token shorter than 4 characters throws; otherwise behavior is unchanged. Extend the comment above it by one sentence.
- Modify: `plugin/bin/dispatch-resume.js:460-477` (`parseStatus`)
- Modify: `plugin/skills/_shared/git-path-read.md:15`. After `` `parseStatusPorcelainZ` (a rename lists the new path first`` add ``; `{ strict: true }` throws on a record shorter than `XY path` instead of skipping it``, inside the same parenthesis.
- Test: `tests/bin-lib/git-z.test.js`

**Interfaces:**
- Produces: `parseStatusPorcelainZ(raw: string, opts?: { strict?: boolean }) -> Array<{xy, path, origPath?}>`. Under `strict: true`, a short token throws an `Error` whose message is exactly `` `a status record was shorter than "XY path" (${JSON.stringify(token)})` ``.

- [ ] **Step 1: Write the failing test** `AC1.1: parseStatusPorcelainZ strict: a token shorter than 4 characters throws; well-formed input parses as non-strict`, appended to `tests/bin-lib/git-z.test.js`:
  - `assert.throws(() => parseStatusPorcelainZ('M a\u0000 M ok.md\u0000', { strict: true }), /shorter than "XY path" \("M a"\)/)`
  - `assert.deepEqual(parseStatusPorcelainZ('R  new.md\u0000old.md\u0000 M b.md\u0000', { strict: true }), [{ xy: 'R ', path: 'new.md', origPath: 'old.md' }, { xy: ' M', path: 'b.md' }])`
  - `assert.deepEqual(parseStatusPorcelainZ('', { strict: true }), [])`
  - Leave the existing line-150 test unmodified (non-strict still skips).

- [ ] **Step 2: Run, verify it fails**

Run: `node --test tests/bin-lib/git-z.test.js`
Expected: FAIL (`Missing expected exception`).

- [ ] **Step 3: Implement.**
  - `parseStatus` keeps its `typeof` check.
  - It splits the text at the first `\0`: the head is the `## ` header (the whole string when there is no NUL), the rest is the records.
  - It keeps the `## ` check and `parseBranchHeader` on the header.
  - It returns `{ branch, dirty: parseStatusPorcelainZ(rest, { strict: true }).map((r) => r.path) }`, wrapping the strict throw as `throw fail(e.message)`. The stderr line then still reads `git status (stalled worktree): a status record was shorter than "XY path" (...)`.
  - Import `parseStatusPorcelainZ` from `./lib/git-z`. The comment above `parseStatus` names the delegation.
  - `splitNul` drops empty tokens exactly as today's `if (rec === '') continue;` does, and the `/[RC]/` test on `xy` matches today's four-way column check.

- [ ] **Step 4: Run, verify it passes**

Run: `node --test tests/bin-lib/git-z.test.js tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/git-path-read-conformance.test.js`
Expected: PASS. The CLI suite's rename/copy, header-only, no-header and short-record tests (lines 1120-1200) hold unchanged.

- [ ] **Step 5: Commit.** Commit the two source files, the doc and the test by path. Message: `Delegate dispatch-resume's status parse to git-z — strict mode keeps it failing loud, refs #4815`.

### Task 5: Comments that name their rule

**Role:** transcription

**Files:**
- Modify: `plugin/bin/dispatch-resume.js:304`. `(a late-write \`work/\` stub, Review Focus 6)` → `(a late-write \`work/\` stub that recreated the root after archiving)`.
- Modify: `plugin/bin/dispatch-resume.js`, `readOpenBlockers` (line 258). Insert above its `for` loop: `// One gh issue view per body-declared blocker, serially: a record's Blocked-by list is a handful of entries and this runs once per manual resume, so batching them into one aliased query would add a second query shape and its partial-result handling for no measured cost (#4815 closed this out).`
- Modify: `plugin/bin/dispatch-resume.js`, `runBound` (line 632). Insert above `const pipelines = …`: `// resolveTarget returns the realpath'd dir while ctx.root keeps mainCheckoutRoot's spelling (a symlinked checkout, macOS /var -> /private/var), so either spelling names the main checkout's pipelines dir.`
- Modify: `plugin/bin/lib/dispatch/resume-eligibility.js:9`. `The Closed rule (spec D1):` → `The Closed rule:`.
- Modify: `plugin/bin/lib/dispatch/resume-eligibility.js:264`. Replace the one-line comment above `resumableTombstoneReason` with this comment:

  ```
  // `reason` is a claim tombstone's release reason, '' when it carries none. These three end a build
  // without finishing it while its PR stays open: `failed:` (a gate stopped the run), `abandoned:` (the
  // run was discarded unmerged) and `swept: stale claim` (/tidy cleared a dead run's claim). `merged:`
  // and `pr-opened:` finished the build, `shaped:`/`routed:` ran none, and `swept: issue closed` closed
  // the record, so none of those is a resumable stall (_shared/issue-claims.md's Release triggers).
  ```
- Modify: `plugin/bin/lib/dispatch/resume-eligibility.js:390`. `---- resume context (deliverable 4) ----` → `---- resume context ----`.
- Modify: `tests/bin-lib/dispatch/dispatch-resume-cli.test.js`, three test names:
  - Line 796: drop the trailing ` (Review Focus 6)`.
  - Line 966: drop the trailing ` (Review Focus 8)`.
  - Line 1334: `own kept lock (Review Focus 18): the archived …` → `own kept lock: the archived …`.

No test step: these are comment and test-name text only.

- [ ] **Step 1: Make the edits.**
- [ ] **Step 2: Verify**

Run: `git grep -n -e 'Review Focus' -e 'spec D1' -e 'deliverable 4' -- plugin/bin/dispatch-resume.js plugin/bin/lib/dispatch tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/bin-lib/dispatch/resume-eligibility.test.js`
Expected: no output. Control: on this branch's tip at plan time the same command matches 6 lines (`dispatch-resume.js:304`, `resume-eligibility.js:9,390`, `dispatch-resume-cli.test.js:796,966,1334`).
Run: `node --test tests/bin-lib/dispatch/dispatch-resume-cli.test.js tests/bin-lib/dispatch/resume-eligibility.test.js`. Expected: PASS.

- [ ] **Step 3: Commit** the three files by path. Message: `Name the rule in dispatch-resume comments — drop deleted #4588 spec numbering, refs #4815`.

### Task 6 (controller, not dispatched): record the close-outs

- [ ] AC2.1: re-read #1426's comments (`gh api repos/thn-inc/claude-tweaks/issues/1426/comments --paginate`). Confirm each of the 12 `[dispatch]` lines whose text matches a #4815 deliverable carries `#4815`. Log the count with `log-decision.js --step "AC evidence"`.
- [ ] AC1.1: post one comment on #4815 that maps each of the 12 deliverables to its outcome:
  - Fixed: D1 (Tasks 1-2).
  - D2/D10/D3 (Task 3). The inline `dispatch-record-${n}` builders were already gone after #4849, and the remaining duplicated worktree path join now has one home on `HARNESS_WORKTREE_DIR`.
  - D9/D11 (Task 3), D8 (Task 4), D4/D6/D7 (Task 5).
  - Closed out with reason: D5/D12, the serial body-blocker reads. They are bounded by the record's own Blocked-by list and run once per manual resume, and batching them would add a second aliased-query shape with partial-result handling for no measured cost.
- [ ] Add one `ops` ledger row naming the out-of-scope sites from Global Constraints, so the Review Console can route them.

## Spec coverage map

| Clause | Covered by |
|---|---|
| AC1.1 Each deliverable is fixed, or closed out with its reason recorded on this record. | Tasks 1-5 (fixed; tests `AC1.1: GH_BATCH_TIMEOUT_MS: …`, `AC1.1: realDeps.runner passes GH_BATCH_TIMEOUT_MS …`, `AC1.1: worktreePathForHead and the shared primitives have one home`, `AC1.1: parseStatusPorcelainZ strict: …`), Task 6 (the D5/D12 close-out comment) |
| AC2.1 Each promoted entry line in #1426 carries this record's ref. | Task 6 re-read. Waived AC2.1 as a test: it is forge state, not code. |
