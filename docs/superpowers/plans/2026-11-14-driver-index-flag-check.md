# Driver Index Flag Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pipeline driver stops a record with status `fail` when code it ran set a skip-worktree or assume-unchanged flag that was not in the index when the worktree was created, so its test and evidence verdicts always judge what gets committed. A worktree whose git config sets `core.ignoreStat` true is refused up front, where that check could not work.

**Architecture:** `worktreeStep` (`plugin/bin/lib/driver/steps.js`) first refuses a worktree whose git config sets `core.ignoreStat` true (the maintainer's plan-review Decision in the spec), then reads the index's flagged set once, into `ctx.indexFlags`. One helper in `steps.js` re-reads it and compares with that baseline. `runImplementer` calls it after its HEAD check, and `testStep` calls it right after its `verify.js` run. `review.js` cannot require `steps.js`, so it gets the helper through the review wiring as `indexFlagCheck`, and calls it after each `runEvidence` in `reviewPass` and in `fixRound`. The fix round's launch and test step already go through `runImplementer` and `testStep`.

**Tech Stack:** Node 20 CommonJS, `node --test`, the fake-runner harness in `tests/bin-lib/driver/run.test.js` and the `passRig` rig in `tests/bin-lib/driver/review.test.js`.

**Spec:** `.claude-tweaks/pipelines/2026-11-14T153732-spec-5414-5415/spec-5415/work/5415-spec.md` (record #5415)

Scope keywords: runImplementer, runEvidence, worktreeStep, testStep, indexFlagCheck, ignoreStat

Check B, classified as no-change:
- `plugin/bin/lib/driver/launch.js`: its header names `runImplementer` as a `launchTracked` caller, which stays true.
- `docs/plugin-structure.md`: line 77 describes `runEvidence` and the wiring object, both still true.
- `.claude/skills/headless-worker-launch/SKILL.md`: line 51 names `runImplementer` as a launch site, still true.
- `plugin/bin/lib/plan-audit/checks.js`, `plugin/bin/lib/plan-audit/parser.js`, `tests/bin-lib/plan-audit/checks.test.js` and `tests/bin-lib/plan-audit/parser.test.js`: their `testSteps` hits are plan-audit's own variable, not the driver step.
- Historical plans, not this build's to edit: `docs/superpowers/plans/2026-11-13-driver-reviewer-step.md`, `docs/superpowers/plans/2026-11-13-driver-test-step-env-containment.md`, `docs/superpowers/plans/2026-11-13-pipelines-push-first-local-runs-5370.md`, `docs/superpowers/plans/2026-11-13-verify-local-runs-on-request-5369.md` and `docs/superpowers/plans/2026-11-14-driver-worker-head-check.md`.

## Global Constraints

- **The read**, one line, so `-z` sits on the same line as `ls-files` as `tests/git-path-read-conformance.test.js` (`PATH_LIST_TOKEN`) requires: `gitIn(deps, wt, ['--no-optional-locks', 'ls-files', '-v', '-z'])`. Never trim its output. Probed while authoring (read-only), on this worktree: 5,718 entries, all tagged `H`, 376,868 bytes, ending in NUL. That is far inside `realDeps.git`'s 64 MiB `maxBuffer` (`LARGE_MAX_BUFFER_BYTES`). An index listing past that bound makes the read throw, so it stops the record fail-closed. That is a stated residual, not a gap to engineer around. Probed with real flags on a scratch repo: `"h assume.js\0h both.js\0S new\nline.js\0H plain.js\0S skip.js\0"`. Assume-unchanged reads as `h`, skip-worktree as `S`, and a path flagged both ways as `h`. A path holding a newline comes back raw.
- **Parse:** the output is `''` or ends in `\0`. Every NUL-separated entry is `{tag} {path}`: at least 3 characters, the tag at index 0, a space at index 1, and the path from index 2 to the end (spaces kept). Anything else counts as unreadable and is never compared.
- **Flagged:** tag `'S'`, or a tag in `a`–`z`. `H`, `M`, `R`, `C` and `K` are never flagged.
- **`core.ignoreStat` refusal (spec Decision, plan review 2026-11-14):** in a repo with `core.ignoreStat` true, git marks every path it updates in the index assume-unchanged, so the driver's own `git add` would tag the worker's files `h` and the post-test check would stop every record. Probed while authoring on a scratch repo: after `git add` under `core.ignoreStat=true`, `ls-files -v -z` printed `"h w.js\0"`. `worktreeStep` therefore reads `gitIn(deps, wt, ['config', '--bool', 'core.ignoreStat'])` after the `record-worktree` check and before the baseline read, through a helper `ignoreStatStop(deps, wt) -> null | { status: 'fail', detail }`. Probed `git config --bool` replies: unset exits 1 with empty output; `yes`/`true`/`1`/`on` print `true\n`; `false`/`no` print `false\n`; a bad value (`bogus`) exits 128 with `fatal: bad boolean config value …`. The rule: trimmed stdout `'true'` → `{ status: 'fail', detail: IGNORE_STAT_REFUSED }`; trimmed stdout `'false'` → `null`; a throw with `err.status === 1` (git's "not set" exit) → `null`; any other throw, or any other stdout → `{ status: 'fail', detail: IGNORE_STAT_UNREADABLE }`. Neither detail carries git's stderr. The single baseline and AC4 stay as written: no exclusion of paths the driver staged itself.
- **Baseline:** `worktreeStep` reads it once, after `record-worktree` has succeeded and after `ignoreStatStop` returned `null`, and before its `return { status: 'ok' }`, into `ctx.indexFlags` (a `Set` of paths). `newCtx` in `run.js` initializes `indexFlags: null` next to `wt`. Every check compares with this one baseline by set difference on paths, never with the previous check point. A path whose flag was cleared since the baseline is not a stop, and neither is a baseline path whose tag changed (`S` to `s`).
- **Check points, and no others:** after each `runImplementer` launch, after `testStep`'s `verify.js` call (scoped or full: both run worker code), and after each `runEvidence` call in `reviewPass` and in `fixRound`. A test step that refuses its scope file and never runs `verify.js` reads nothing. Never clear a flag, and never run `update-index`.
- **Order:** in `runImplementer`, the HEAD check (#5414) runs first and the flag check runs only when HEAD did not move. This holds on both the resolved path and the launcher-throw path. A moved HEAD returns its own detail, and no flag read follows. After an evidence run the order is: `survived`, then `interrupted`, then the flag check, then the tree check, then the verdict. In `testStep` the flag check runs before `r.code` is judged. An interrupt keeps precedence through `run.js`'s signal handler, as for #5414.
- **Exact strings**, used by code and tests alike (declare the constants in `steps.js`, and export only `INDEX_FLAG_PATHS_SHOWN`, `readIndexFlags` and `ignoreStatStop`):
  - `IGNORE_STAT_REFUSED = 'core.ignoreStat is true for the new worktree, so git would mark every path the driver stages assume-unchanged; the driver refuses such a worktree'`
  - `IGNORE_STAT_UNREADABLE = 'core.ignoreStat of the new worktree is unreadable'`
  - `INDEX_FLAG_PATHS_SHOWN = 5`
  - `INDEX_FLAGS_BASELINE_UNREADABLE = 'the index flags of the new worktree are unreadable'`
  - `INDEX_FLAGS_UNREADABLE = 'the index flags of the worktree are unreadable'`
  - new flags: `` `skip-worktree or assume-unchanged newly set on ${n} path(s) since the worktree was created: ${shown}${more}` ``. `shown` is the first `INDEX_FLAG_PATHS_SHOWN` new paths in ls-files order, each through `neutralize`, joined with `', '`. `more` is `` `, and ${n - INDEX_FLAG_PATHS_SHOWN} more` `` when `n > INDEX_FLAG_PATHS_SHOWN`, else `''`.
  - The review step's evidence-run stops prefix that detail. `reviewPass` uses `` `evidence run: ${detail}` ``. `fixRound` uses `` `fix round evidence run: ${detail}` `` through `end(..., { c })`. Launch and test stops inside the fix round arrive through the existing `fix round launch:` / `fix round test:` wrapping.
- **No new stop class, outcome, event field or STEP name.** Each stop is its step's existing pre-push stop: `worktree`, `worker`, `test` or `review`. No `SCENARIOS` row is added. These stops keep existing classes, each AC test asserts the class and outcome itself, and the `nthCall` counter would make a module-level scenario single-use.
- **Fixtures gain the new reads.** `defaultScript` answers `isFlagRead` with `UNFLAGGED_INDEX` and `isIgnoreStatRead` with `exitOne` (unset, as in a real repo). The `AC2.1: happy path calls run in the deliverable order` literal gains its `'git config'` entry and its three `'git ls-files'` entries. Call assertions are never loosened. There is one assertion edit: `AC7.1 (#5414)` compares with literals captured before both records, so it drops #5415's reads (the `core.ignoreStat` read and the flag reads, through `withoutFlagReads`) before its own filter, and `AC8.1 (#5415)` pins each of those reads by count and position.
- Governing skill `driver-step-addition`, quoted verbatim: "The worker can shape strings such as its summary, a path it named, or CLI stderr that may echo either. Each such string goes through `events.js`'s `neutralize` before it reaches an event `detail`, a commit message, a PR body or a log line (AC14.3)." Its anti-pattern row: "| Raw worker text in a `detail` | A `closes #N` or `@user` inside it reaches the forge (AC14.3) |". Its re-run rules: "Reach the re-run steps through a wiring object that `steps.js` builds and passes in. The new module never requires `steps.js`." and "Propagate a re-run step's own status and class unchanged, and list each re-run step's stops in the new module's header." Its site row: "`tests/bin-lib/driver/run.test.js` | A happy-path reply in `defaultScript` for every call the step makes, because the harness throws `unexpected {kind} …` on anything else." For `newCtx`: "Needed only for a new durable side effect." and "A timestamp is not a side effect, so it gets no `interruptClass` rung." A baseline read is not a side effect either, so it gets no rung. Here, every path in a detail goes through `neutralize`, and an unreadable read names fixed text only, never git's stderr.
- Governing skill `headless-worker-launch`, quoted verbatim: "Any step that executes worker-authored content (its tests, a `verify-scope.json` command, a build or lint script it can edit) runs outside the worker's sandbox." and "Treat the worker's index flags and git config as untrusted (#5267)." Its "What the consumer owes" sentence: "The run loop that consumes the envelope must treat every string in `result`, `detail` when it carries the worker's own text, and `denials[].tool_input` as untrusted, and neutralize it before it reaches a command, a commit message, a comment or a log line." Index paths are worker-shaped, so they are neutralized. `launchTracked` stays the launch path.
- Prose sweep (Behavior-change prose sweep): `git grep -n -i -e "skip-worktree" -e "assume-unchanged" -e "index flag" -e "update-index" -- plugin docs .claude/skills ':!docs/superpowers/plans'` finds `docs/driver.md:79`, `review.js:198`, `review.js:1013-1014`, `review.js:1085`, `steps.js:603-604` and `steps.js:672`. Each describes a byte check that stays, so it needs no change. The remaining hits (`claims-git-cas.js`, `ledger-residue.js`, `donts.md`, `incident-log.md`, `reconcile-checks.md`, `pipeline-run-dir.md`) describe the driver's own plumbing writes. None states that the driver ignores worker-set flags.

## Review Focus

1. A reply that succeeds but is not tag-space-path entries must count as unreadable and must never be compared: no trailing NUL, a missing space, an empty entry, or an entry with an empty path. Task 1 test `(#5415) an ls-files reply that is not tag-space-path entries is unreadable`.
2. A launch that both moved HEAD and set a flag must report the moved HEAD and read no flags after it, which pins the order. Task 1 test `(#5415) a launch that moved HEAD and set a flag reports the moved HEAD`.
3. A launcher throw after which a flag is newly set must report the flag rather than rethrow, and an interrupt during such a launch must still report the interrupt. Task 1 tests `(#5415) a launcher throw after which a flag is set reports the flag` and `(#5415) an interrupt during a launch that also set a flag is reported as the interrupt`.
4. A flag set between check points, by a worker-authored commit hook, must be caught at the next check point. A baseline flag cleared and later set again must never stop the record, which proves the comparison is with the baseline, not the previous point. Task 1 tests `(#5415) a flag set between check points is caught at the next one` and the cleared-then-reset case in `AC5.1 (#5415)`.
5. Uppercase tags other than `S` (`M`, `R`, `C`, `K`) must never count as flagged. Task 1 test `(#5415) only S and lowercase tags count as flagged`.
6. Only git's "not set" exit (status 1) may pass a failed `core.ignoreStat` read; exit 128 (a bad boolean) and any stdout other than `true`/`false` must stop with the fixed unreadable detail, and the refusal must come before the baseline read. Task 1 tests `(#5415) a worktree with core.ignoreStat true is refused at worktree` and `(#5415) a core.ignoreStat read that fails other than not-set stops at worktree`.

---

### Task 1: Baseline, and the check after each implementer launch and after the test step

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/steps.js`. That covers: a header paragraph after the test-step containment paragraph (`:23-39`); the constants, `ignoreStatStop`, `readIndexFlags` and `newIndexFlagStop` after `headFail` (`:460-465`); `worktreeStep` (`:407-415`); `runImplementer` (`:503-535`, with one header-comment sentence at `:475-476`); `testStep` (`:704-712`); and `module.exports` (`:1089-1092`).
- Modify: `plugin/bin/lib/driver/run.js:130` (`newCtx`)
- Test: `tests/bin-lib/driver/run.test.js`. That covers: the helpers after `scopeSame` (`:363`); a `defaultScript` reply next to the `status` reply (`:411`); new tests after `AC8.1 (#5414)` (`:1724`); and edits to `AC7.1 (#5414)` (`:1812`, `:1824`) and to `AC2.1: happy path calls run in the deliverable order` (`:2803-2807`).

**Interfaces:**
- Consumes: `gitIn(deps, dir, args)` (`steps.js:332`), `neutralize` (already imported), `headOf`/`headFail` (#5414).
- Produces: `ignoreStatStop(deps, wt) -> null | { status: 'fail', detail: IGNORE_STAT_REFUSED | IGNORE_STAT_UNREADABLE }` (Global Constraints' refusal rule). `readIndexFlags(deps, wt) -> Set<string> | null` (null: the read threw or was malformed). `newIndexFlagStop(ctx, deps) -> null | { status: 'fail', detail: string }` reads `ctx.wt` and `ctx.indexFlags`. A `null` baseline throws, and every caller already turns a throw into a `fail`. Task 2 passes `newIndexFlagStop` to `review.js` as `wiring.indexFlagCheck`. `ctx.indexFlags` is a `Set` once `worktreeStep` returns `ok`.

- [ ] **Step 1: Write the failing tests** in `run.test.js`

Helpers (after `scopeSame`):
```js
const isFlagRead = onGit('--no-optional-locks', 'ls-files', '-v', '-z');
const isFlagReadInWt = (c) => !!c && isFlagRead(c) && c.cwd === WT;
const isIgnoreStatRead = onGit('config', '--bool', 'core.ignoreStat');
const isIgnoreStatReadInWt = (c) => !!c && isIgnoreStatRead(c) && c.cwd === WT;
const IGNORE_STAT_REFUSED = 'core.ignoreStat is true for the new worktree, so git would mark every path the driver stages assume-unchanged; the driver refuses such a worktree';
const IGNORE_STAT_UNREADABLE = 'core.ignoreStat of the new worktree is unreadable';
const UNFLAGGED_INDEX = 'H a.js\0';
const NEW_FLAG_INDEX = 'H a.js\0S src/hidden.js\0';
const ONE_NEW = 'skip-worktree or assume-unchanged newly set on 1 path(s) since the worktree was created: src/hidden.js';
```
Put `[isFlagRead, UNFLAGGED_INDEX]` and `[isIgnoreStatRead, exitOne]` in `defaultScript`. Import `INDEX_FLAG_PATHS_SHOWN`, `readIndexFlags` and `ignoreStatStop` from `steps`. In the default harness, read 1 is the baseline, read 2 follows the implementer launch and read 3 follows `verify.js`. Every test below asserts `[stop.step, status, stop.class, outcome]` on `lastLine(h)` unless it says otherwise.

- `AC1.1 (#5415): a skip-worktree flag set during the implementer launch stops at worker`: `nthCall(isFlagRead, 2, NEW_FLAG_INDEX)`. The stop is `['worker', 'fail', 'pre-push', 'express-escalated']`, `stop.detail === ONE_NEW`, `commitGit(h).length === 0` with no `status` read, and `pushCalls(h).length === 0`.
- `AC2.1 (#5415): a flag set during the test step stops at test, ahead of its verdict`: `nthCall(isFlagRead, 3, NEW_FLAG_INDEX)`. The stop is `['test', 'fail', 'pre-push', …]` with detail `ONE_NEW`. There is no `express-lane.js check` node call and no push. A second case adds `[on('node', /verify\.js$/), { code: 1, stdout: '', stderr: '' }]` and still gets detail `ONE_NEW` with status `fail`, not `red tests`.
- `AC4.1 (#5415): an assume-unchanged flag stops the same way`: for each of `'H a.js\0h src/hidden.js\0'` and `'H a.js\0s src/hidden.js\0'` as read 2, the result matches AC1.1.
- `AC5.1 (#5415): flags already in the baseline never stop the record`: `SPARSE = 'H a.js\0S sparse/x.js\0S sparse/y.js\0'` answers every read. The run exits 0, its line pairs deep-equal `BASE_LINES_PLAIN` and `pushCalls(h).length === 1`. A second case uses a local counter: read 1 is `SPARSE`, read 2 is `'H a.js\0H sparse/x.js\0s sparse/y.js\0'` (one flag cleared, one tag changed), and read 3 is `SPARSE` again (the cleared flag set again). It also reaches the push with no stop.
- `AC6.1 (#5415): an unreadable baseline stops at worktree`: `nthCall(isFlagRead, 1, Object.assign(new Error('Command failed'), { stderr: 'fatal: @evil fixes #3\n' }))`. The stop is `['worktree', 'fail', 'pre-push', …]` and the detail `=== 'the index flags of the new worktree are unreadable'`. `calls(h, 'worker').length === 0`.
- `AC6.1 (#5415): an unreadable read after the launch stops at worker`: the same error as read 2. The detail is `'the index flags of the worktree are unreadable'`, without `@evil` or `#3`. There is one worker call and no commit.
- `AC7.1 (#5415): the detail lists at most INDEX_FLAG_PATHS_SHOWN paths plus the count, neutralized`: `INDEX_FLAG_PATHS_SHOWN === 5`. Read 2 adds 7 `S` paths `src/n0.js`…`src/n6.js`, and the detail ends `: src/n0.js, src/n1.js, src/n2.js, src/n3.js, src/n4.js, and 2 more` with `on 7 path(s)`. With exactly 5 new paths there is no `and`. Read 2 then adds `S src/evil\nfixes #12 @someone.js`. The detail ends `` `: ${neutralize('src/evil\nfixes #12 @someone.js')}` `` (probed: `src/evil @​someone.js`) and includes none of `'\n'`, `'fixes'`, `'#12'`, `'@someone'`.
- `(#5415) an ls-files reply that is not tag-space-path entries is unreadable`: for each of `'S a.js'`, `'Sa.js\0'`, `'\0'` and `'S \0'` as read 2, the detail is `'the index flags of the worktree are unreadable'`. `'H a.js\0S a b.js\0'` gives the detail `…on 1 path(s) since the worktree was created: a b.js`.
- `(#5415) only S and lowercase tags count as flagged`: `'H a.js\0M m.js\0R r.js\0C c.js\0K k.js\0'` as read 2 reaches the push with no stop.
- `(#5415) a launch that moved HEAD and set a flag reports the moved HEAD`: `nthCall(isHeadRead, 2, `${OTHER_SHA}\n`)` plus `nthCall(isFlagRead, 2, NEW_FLAG_INDEX)`. The detail is `movedDetail(HEAD_SHA, OTHER_SHA)`, and `h.calls.filter(isFlagReadInWt).length === 1` (the baseline only).
- `(#5415) a launcher throw after which a flag is set reports the flag`: `[on('worker'), new Error('launch blew up')]` plus `nthCall(isFlagRead, 2, NEW_FLAG_INDEX)`. The stop is `worker`, `fail`, detail `ONE_NEW`.
- `(#5415) an interrupt during a launch that also set a flag is reported as the interrupt`: the #5414 interrupt test's shape (`let h = null; h = harness(...)`, `h.signals[0]('SIGTERM')` inside the implementer reply) with `nthCall(isFlagRead, 2, NEW_FLAG_INDEX)`. `h.lines().at(-2).detail === 'interrupted by SIGTERM'`, and no line detail includes `'newly set'`.
- `(#5415) a flag set between check points is caught at the next one`: `let h = null; h = harness({ script: [[isFlagRead, () => (h.fx.committed ? NEW_FLAG_INDEX : UNFLAGGED_INDEX)]] })`. The flag appears once the commit step's hook has run. The stop is at `test` with detail `ONE_NEW`, and there is one `verify.js` call.
- `(#5415) a worktree with core.ignoreStat true is refused at worktree`: `[isIgnoreStatRead, 'true\n']`. The stop is `['worktree', 'fail', 'pre-push', …]` and the detail `=== IGNORE_STAT_REFUSED`. `h.calls.filter(isIgnoreStatReadInWt).length === 1`, `h.calls.filter(isFlagReadInWt).length === 0` (refused before the baseline read) and `calls(h, 'worker').length === 0`.
- `(#5415) core.ignoreStat false or unset passes`: with `[isIgnoreStatRead, 'false\n']` the run exits 0 and `pushCalls(h).length === 1`. The default harness (unset: `exitOne`) also exits 0, with exactly one `isIgnoreStatReadInWt` call.
- `(#5415) a core.ignoreStat read that fails other than not-set stops at worktree`: for each reply of `Object.assign(new Error('Command failed'), { status: 128, stderr: "fatal: bad boolean config value '@evil fixes #3' for 'core.ignorestat'\n" })`, `''` and `'maybe\n'`, the stop is `['worktree', 'fail', 'pre-push', …]` with detail `=== IGNORE_STAT_UNREADABLE` (no `@evil`, no `#3`), with no flag read and no worker call.
- `(#5415) readIndexFlags reads real git's tags`: run real git in a temp dir (`fs.mkdtempSync`, removed in `finally`), with `env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: {an empty file in the temp dir} }` on every spawn, so the developer's own git config cannot reach it. Use `git init -q`, write `plain.js`, `skip.js`, `assume.js` and `both.js`, plus `new\nline.js` when `process.platform !== 'win32'`. Run `git add --`, then `git update-index --skip-worktree -- skip.js`, `--assume-unchanged -- assume.js` and `--skip-worktree --assume-unchanged -- both.js`, plus `--skip-worktree` on the newline path. No commit is needed. Read with `readIndexFlags({ git: (args, o) => spawnSync('git', args, { cwd: o.cwd, encoding: 'utf8', windowsHide: true }).stdout }, dir)`. Assert `[...set].sort()` deep-equals `['assume.js', 'both.js', 'new\nline.js', 'skip.js']` (no newline entry on win32). This is the real-writer fixture: git writes the flags.
- `(#5415) ignoreStatStop reads real git's core.ignoreStat`: the same temp-dir and env isolation. Use `deps = { git: (args, o) => execFileSync('git', args, { cwd: o.cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env }) }`, which throws with git's exit status as `realDeps.git` does. With `core.ignoreStat` unset, `ignoreStatStop(deps, dir) === null` (git's exit 1). After `git config core.ignoreStat false` it is `null`. After `git config core.ignoreStat yes` it deep-equals `{ status: 'fail', detail: IGNORE_STAT_REFUSED }`. After `git config core.ignoreStat bogus` it deep-equals `{ status: 'fail', detail: IGNORE_STAT_UNREADABLE }` (exit 128). This is the real-writer fixture for the refusal.

Fixture edits, in the same step:
- `AC2.1: happy path calls run in the deliverable order`: insert `'git config', 'git ls-files'` after `'node hooks.js record-worktree'`, and `'git ls-files'` after the `'git rev-parse'` that follows `'worker'` and after `'node verify.js'`.
- `AC7.1 (#5414)`: define `const withoutFlagReads = (cs) => cs.filter((c) => !isFlagReadInWt(c) && !isIgnoreStatReadInWt(c));` (it drops all of #5415's reads, the `core.ignoreStat` read included), and compare `withoutFlagReads(plain.calls).filter((c, i, a) => !isLaunchSideRead(a, i)).map(sig)` (and the same for `fix`). Comment: #5415's reads are dropped first, and `AC8.1 (#5415)` pins their count and position. Its HEAD counts and adjacency assertions stay as they are.

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `node --test --test-name-pattern="#5415" tests/bin-lib/driver/run.test.js`
Expected: FAIL after Step 1. `readIndexFlags` and `ignoreStatStop` are not exported and nothing reads the flags or `core.ignoreStat` yet, so AC1/AC2/AC4/AC6/AC7 and the refusal tests reach later steps.

- [ ] **Step 3: Implement** in `steps.js` and `run.js`

`ignoreStatStop`, `readIndexFlags` and `newIndexFlagStop` implement the refusal rule, the read, parse, flagged rule and detail strings from Global Constraints. `worktreeStep`: after the `record-worktree` check, `const refused = ignoreStatStop(deps, wt); if (refused) return refused;`, then `const flags = readIndexFlags(deps, wt); if (flags === null) return { status: 'fail', detail: INDEX_FLAGS_BASELINE_UNREADABLE }; ctx.indexFlags = flags;`. `runImplementer`: in the `catch`, after `headStop`, `const flagStop = newIndexFlagStop(ctx, deps); if (flagStop) return flagStop;` before `throw err`. After the envelope, after `headStop`, return the flag stop with `extra` attached when there is one (as `headFail` does), before `!hasEnvelope`. `testStep`: right after the `deps.node(binScript('verify.js'), …)` call, return the flag stop before any `r.code` test. `run.js` `newCtx`: `indexFlags: null` after `wt: null`. Add the header paragraph: the `core.ignoreStat` refusal and why, the baseline, the check points, never clearing a flag, and the residuals the check does not cover (a `.gitattributes` filter, `core.fsmonitor`, an index past the read's buffer, and a path already flagged when the worktree is created: code the driver runs can rewrite such a path, git status does not report it, so the commit never stages it — the spec's Plan Review Clarifications, Reading A), with CI on push as the backstop. Extend `runImplementer`'s HEAD sentence: after an unmoved HEAD, the index flags are checked, on the throw path too.

- [ ] **Step 4: Run the new tests and confirm they pass**

Run: `node --test --test-name-pattern="#5415" tests/bin-lib/driver/run.test.js`
Expected: PASS.

- [ ] **Step 5: Whole file, and the inserted-guard re-proof**

Run: `node --test tests/bin-lib/driver/run.test.js tests/bin-lib/driver/review.test.js`
Expected: PASS. Any other red test is a fixture that scripts git calls in order. Give it the read, and never loosen an assertion.

The flag check now runs ahead of the envelope checks and ahead of `testStep`'s verdict. Those checks' tests reach them only because the default reply holds no new flag. Re-prove each one. Delete the `envelope.status !== 'ok'` branch and confirm `AC6.1: worker timeout and fail stop the record at worker` goes red. Delete the `cannot-complete` branch and confirm `a worker that cannot complete stops at worker; a bad ceiling fails before any launch` goes red. Delete `if (r.code === 1) …` and confirm `AC6.2: red tests stop at test` goes red. Then guard discrimination for the helper's own branches. Make the flagged rule `tag === 'S'` only, and AC4.1 goes red. Make it `tag !== 'H'`, and `only S and lowercase tags` goes red. Drop the parse's space check, and the malformed-reply test goes red. Make `ignoreStatStop` pass on any throw (drop the `err.status === 1` test), and the not-set-only test goes red. Move the `ignoreStatStop` call after the baseline read, and the refusal test's zero-flag-read assertion goes red. Restore everything and quote the red output in the task report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/driver/steps.js plugin/bin/lib/driver/run.js tests/bin-lib/driver/run.test.js
git commit -m "Stop a record when worker code sets an index flag — baseline at worktree creation, checks after the implementer launch and the test step (#5415)"
```

### Task 2: The check after each evidence run, and the documented rule

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/steps.js:1040-1047` (`reviewStep` wiring gains `indexFlagCheck: newIndexFlagStop`)
- Modify: `plugin/bin/lib/driver/review.js`. `reviewPass` (`:784-786`) gets its signature and a guard, and the check goes after `:907`. `fixRound` destructures the helper (`:1029`), and its check goes after `:1098`. `reviewRecord` passes it to `reviewPass` (`:1150`). The header's pass stops (`:153-157`) and fix-round `fail` stops (`:200-207`) each gain the new stop, and its wiring sentence (`:1140-1142`) gains `indexFlagCheck`.
- Modify: `docs/driver.md` (`## Worker rights`, a new bullet after the HEAD bullet at `:175`)
- Test: `tests/bin-lib/driver/review.test.js`. `passRig` (`:913-1004`) gets a `flags` option and a `flagChecks` array, and `run` passes a default `indexFlagCheck`. `fixOnDisk`'s wiring (`:1792-1799`) gains `indexFlagCheck: () => null`. New tests go after `AC7: a tree changed outside the evidence files stops` (`:1264`).
- Test: `tests/bin-lib/driver/run.test.js` (new tests after `AC9.1 (#5414)` near `:3644`)

**Interfaces:**
- Consumes: Task 1's `newIndexFlagStop(ctx, deps) -> null | { status: 'fail', detail }`, plus `isFlagRead`, `isFlagReadInWt`, `NEW_FLAG_INDEX`, `ONE_NEW`, `withoutFlagReads`, `fixRig`, `FINDING_0`, `afterFixLaunch`, `implementerCalls`, `evidenceAbs`, `BASE_CALLS_*`, `BASE_LINES_*`, `BASE_KEYS_*` and `isLaunchSideRead`.
- Produces: `reviewPass(ctx, deps, { testCommand, isRunArtifact, indexFlagCheck })`, which throws `new TypeError('reviewPass needs indexFlagCheck')` when the helper is not a function. It throws next to the existing `isRunArtifact` guard, so a review step without it fails before it starts.

- [ ] **Step 1: Write the failing tests**

In `review.test.js`, `passRig` takes `flags = () => null`. Its `indexFlagCheck` pushes `calls.length` onto `flagChecks` and returns `flags(k)` for the k-th call. `run` passes it ahead of `...o`, and the rig returns `flagChecks`.
- `AC3.1 (#5415): reviewPass checks the index flags after each evidence run, before its tree check`: two findings, `runs: ['reproduced', 'passed']`. `flagChecks.length === 2`. For each index, the call at that index is a status read, and there is no git call between the last evidence spawn before it and it.
- `AC3.1 (#5415): a newly set flag after an evidence run stops the pass before its tree check`: `flags: (k) => (k === 0 ? { status: 'fail', detail: 'FLAGGED' } : null)`, two findings, `runs: ['reproduced']`. The result is `{ status: 'fail', stopClass: 'pre-push', detail: 'evidence run: FLAGGED' }`. `out.confirmed` is `[]`. There is one `rmFile` of `at('tests/new/r0.test.js')`. `statusReads(rig.calls).length === 1` (the clean check only). There is one evidence spawn.
- `(#5415) reviewPass needs indexFlagCheck`: `rig.run({ indexFlagCheck: undefined })` rejects `{ name: 'TypeError', message: 'reviewPass needs indexFlagCheck' }`, with no `launchWorker` call.

In `run.test.js`, `fixRig`'s flag reads are numbered in order: 1 baseline, 2 after the first launch, 3 after `verify.js`, 4 after the reviewer's evidence run, 5 after the fix launch, 6 after the fix round's `verify.js` and 7 after the direct run.
- `AC3.1 (#5415): a flag set during a reviewer evidence run stops at review`: `nthCall(isFlagRead, 4, NEW_FLAG_INDEX)`. The stop is `['review', 'fail', 'pre-push', 'express-escalated']` with detail `` `evidence run: ${ONE_NEW}` ``. `implementerCalls(h).length === 1`, there is an `rmFile` of `evidenceAbs(0)`, and there are no push calls.
- `AC3.1 (#5415): a flag set during a fix-round direct run stops at review`: read 7. The detail is `` `fix round evidence run: ${ONE_NEW}: ${FINDING_0}` ``. There is exactly 1 `express-lane.js check` call, 2 `verify.js` calls and no push.
- `(#5415) a flag set during the fix-round launch stops at review`: read 5. The detail is `` `fix round launch: ${ONE_NEW}: ${FINDING_0}` ``, and `afterFixLaunch(h)` holds no `writeFileExclusive` and no `commit`.
- `(#5415) a flag set during the fix-round test step stops at review`: read 6. The detail is `` `fix round test: ${ONE_NEW}: ${FINDING_0}` ``, with 1 `check` call and no push.
- `AC5.1 (#5415): a sparse baseline passes the review step's checks too`: `fixRig({ script: [[isFlagRead, 'H a.js\0S sparse/x.js\0']] })` exits 0, `reviewLines(h)[0].status === 'ok'` and `pushCalls(h).length === 1`.
- `AC8.1 (#5415): the happy path adds the baseline read and one read after each check point, and no event line changes`. Plain `harness()`: exactly 1 `isIgnoreStatReadInWt` call, right after the `record-worktree` node call, and exactly 3 `isFlagReadInWt` calls. The first comes right after that `core.ignoreStat` read. The second comes right after the HEAD read that follows the implementer launch. The third comes right after the `verify.js` call. `fixRig()`: exactly 1 `core.ignoreStat` read, placed as in the plain run, and exactly 7 flag reads. Reads 1–3, 5 and 6 sit as in the plain run (5 after the fix launch's HEAD read, 6 after the second `verify.js`). For reads 4 and 7, the previous `runner` call has no git call between it and the read, and the next call is a `status` read. For both runs, `withoutFlagReads(calls).filter((c, i, a) => !isLaunchSideRead(a, i)).map(sig)` deep-equals `BASE_CALLS_PLAIN` / `BASE_CALLS_FIX`. The line pairs equal `BASE_LINES_*`, and the sorted line keys equal `BASE_KEYS_*`.
- `AC9.1 (#5415): docs/driver.md names the newly-set-flag stop`: read `docs/driver.md` with the path form of `AC9.1 (#5414)`, and slice `## Worker rights` to the next `\n## `. The line starting `- Index flags:` exists. Its sentence holding `stops the record` includes `skip-worktree` and `` `fail` ``. The bullet includes `when the worktree is created` and `CI on push`. Its sentence holding `core.ignoreStat` includes `refuses` and `` `fail` `` (the spec Decision's "`docs/driver.md` names the refusal beside the flag rule").

- [ ] **Step 2: Run them and confirm the failure**

Run: `node --test --test-name-pattern="#5415" tests/bin-lib/driver/review.test.js tests/bin-lib/driver/run.test.js`
Expected: FAIL after Step 1. `reviewPass` never calls the helper (no `flagChecks`, no TypeError), the evidence-run reads are missing (AC3, and AC8's count of 5 instead of 7), and the docs bullet is absent. The fix-launch and fix-test tests fail too. On Task 1 alone, read 4 follows the fix launch and read 5 follows the fix round's `verify.js`, so read 5 lands on the test step, and read 6 does not exist.

- [ ] **Step 3: Implement** in `steps.js` and `review.js`

In the wiring, add `indexFlagCheck: newIndexFlagStop`. In `reviewPass`, destructure the helper and add the guard beside the `isRunArtifact` guard. After `if (run.interrupted) return interrupted();`, add `const flagged = indexFlagCheck(ctx, deps); if (flagged) return stop(`evidence run: ${flagged.detail}`);`. It runs before `delta(...)`, and the stop's take-back is unchanged. `reviewRecord` passes `indexFlagCheck: wiring.indexFlagCheck`. In `fixRound`, destructure it. After `if (run.interrupted) return interrupted();`, add `return end('fail', `fix round evidence run: ${flagged.detail}`, { c })` when it is set, before `treeDelta`. Header: add "a flag newly set in the index after an evidence run (indexFlagCheck, read before the tree check)" to the pass's stop list. Add "an index flag newly set after a kept run" to the fix round's `fail` list, noting that the launch and test-step flag stops arrive as the propagated launch and test results. Name `indexFlagCheck` among the wiring members.

- [ ] **Step 4: Run and confirm the pass**

Run: `node --test tests/bin-lib/driver/run.test.js tests/bin-lib/driver/review.test.js`
Expected: PASS, both whole files.

**Inserted-guard re-proof:** the check now runs ahead of each evidence run's tree check. Delete `reviewPass`'s `if (changed.length) return stop(...)` after the evidence run and confirm `AC7: a tree changed outside the evidence files stops (Review Focus 3: a modified lockfile)` goes red. Delete `fixRound`'s `if (changed.length) return end(...)` and confirm `AC10: each escalation names the finding and runs no second round` goes red (its `kept evidence changes the tree` row). Restore both and quote the red output.

- [ ] **Step 5: Document it in `docs/driver.md` `## Worker rights`**, with a new bullet after the HEAD bullet:

`- Index flags: once the worktree is created, the driver reads which paths the index flags (\`git ls-files -v\`), and it reads them again after each point where worker-written code has run: every implementer launch (the implementer step and the review fix round alike), the test step and every evidence run. A path flagged skip-worktree or assume-unchanged that was not flagged when the worktree was created stops the record with status \`fail\`, naming at most five of the new paths and their count. A read that fails stops it the same way. Flags present when the worktree is created, such as a sparse checkout's skip-worktree flags, never count, and a flag cleared since then is no stop. Every check compares with that first read, so a flag set between two check points, by a commit hook for example, is caught at the next one. The driver never clears a flag to recover. Before that first read, the driver refuses a worktree whose git config sets \`core.ignoreStat\` true, stopping the record with status \`fail\`: git would then mark every path the driver stages assume-unchanged, so the check would stop every record. A \`core.ignoreStat\` read that fails other than as not set stops it the same way. CI on push runs HEAD and remains the backstop for what this check cannot see, such as a \`.gitattributes\` filter, \`core.fsmonitor\`, or a path already flagged when the worktree is created, whose bytes code the driver runs can rewrite without the commit ever staging them.`

Run: `node --test --test-name-pattern="AC9\.1 \(#5415\)" tests/bin-lib/driver/run.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/driver/steps.js plugin/bin/lib/driver/review.js docs/driver.md tests/bin-lib/driver/run.test.js tests/bin-lib/driver/review.test.js
git commit -m "Check index flags after every evidence run — review wiring and the driver.md rule (#5415)"
```
