# Driver Worker HEAD Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pipeline driver stops a record with status `fail` when HEAD moved (or could not be read) across a worker launch, and the review fix round no longer carries on when its commit step finds nothing to commit.

**Architecture:** `runImplementer` (`plugin/bin/lib/driver/steps.js`) reads HEAD immediately before and immediately after the worker launch and compares the two, before it judges the envelope. The implementer step and the review fix round both go through `runImplementer`, so both inherit the check. The fix round (`plugin/bin/lib/driver/review.js`, `fixRound`) loses its nothing-to-commit exception, so any non-`ok` commit result ends the round.

**Tech Stack:** Node 20 CommonJS, `node --test`, the fake-runner harness in `tests/bin-lib/driver/run.test.js`.

**Spec:** `.claude-tweaks/pipelines/2026-11-14T153732-spec-5414-5415/spec-5414/work/5414-spec.md` (record #5414)

Scope keywords: committed everything itself, nothingToCommit, runImplementer

Check B, classified as no-change: `plugin/bin/lib/driver/launch.js` (its header comment names `runImplementer` as a `launchTracked` caller, which stays true) and `docs/superpowers/plans/2026-11-13-driver-reviewer-step.md` (#5222's historical plan, which describes `runImplementer`'s extraction and is not this build's to edit).

## Global Constraints

- HEAD is read with `gitIn(deps, wt, ['rev-parse', '--verify', '--end-of-options', 'HEAD'])`, the form `pushStep` already uses (`steps.js:751`). The value is trimmed and must match the existing `FULL_SHA_RE` (`/^[0-9a-f]{40}$/`, `steps.js:737`). Anything else counts as unreadable. Move `FULL_SHA_RE` above `runImplementer` so it is defined before its first use; there is still one declaration.
- A stop detail never carries text from the worker's result or from git's error output. It names only the two shas, or a fixed phrase.
- No new stop class, outcome, event field or STEP name. The worker stop is the `worker` step's existing pre-push stop, and the fix-round stop is the `review` step's existing pre-push stop.
- Never reset HEAD, and never otherwise recover from a moved one: the decision is to stop.
- Fixtures gain the new HEAD reads. Call assertions are never loosened to make room for them.
- The exact detail strings, used by code and tests alike:
  - `HEAD_BEFORE_UNREADABLE = 'HEAD of the worktree is unreadable before the worker launch'`
  - after unreadable: `` `HEAD of the worktree is unreadable after the worker launch (it was ${before})` ``
  - moved: `` `the worker moved HEAD from ${before} to ${after}` ``
- Governing skill `driver-step-addition`, quoted verbatim: "The worker can shape strings such as its summary, a path it named, or CLI stderr that may echo either. Each such string goes through `events.js`'s `neutralize` before it reaches an event `detail`, a commit message, a PR body or a log line (AC14.3)." Its anti-pattern row, also verbatim: "| Raw worker text in a `detail` | A `closes #N` or `@user` inside it reaches the forge (AC14.3) |". Here the HEAD details carry only `FULL_SHA_RE`-validated shas and fixed text, with no stderr at all, so they have nothing to neutralize. `headless-worker-launch`'s "What the consumer owes" changes nothing: `launchTracked` stays the launch path, and the envelope handling stays as it is.
- Prose sweep (Behavior-change prose sweep): `git grep -n -i -e "committed everything itself" -e "committed itself" -e "nothing to commit" -e "self-commit" -- plugin docs .claude/skills` finds the driver hits `docs/driver.md:79`, `review.js:188`, `review.js:192` and `review.js:1072`, all in Task 2's Files. Every other hit, in `specify/`, `tidy/`, `wrap-up/` and one journey, describes an unrelated git commit and needs no change.

## Review Focus

1. A HEAD read that succeeds but prints something other than a full sha (short sha, trailing text, uppercase) must count as unreadable, and must never be compared as a sha. Task 1 Step 1 test `a HEAD read that is not a full sha is unreadable` covers this.
2. A failing `rev-parse` after the launch whose stderr carries worker-controlled text (`@evil fixes #3`) must not leak into the detail. Task 1 Step 1 test `an unreadable HEAD after the launch names only the earlier sha` covers this.
3. A launch that returns no envelope at all (`null`) and also moved HEAD must report the move, not "returned no envelope". Task 1 Step 1 test `AC5.1 (#5414)` covers this.
4. The push guard's invariant "no HEAD read for a head that cannot match" (existing AC2.4 test) must keep holding for the push step itself. Only the worker's two reads are added before it. Task 1 Step 5 covers this.
5. A fix-round launch whose HEAD moved must stop before evidence rewrite, commit, scoped test or the second `check`. The worker step's `fail` must reach `fixRound`'s `launched.status !== 'ok'` branch and must not be read as `stop`. Task 2 Step 1 test `AC3.1 (#5414)` covers this.

---

### Task 1: HEAD read around every worker launch

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/steps.js:446-511` (`runImplementer` and its header comment; move `FULL_SHA_RE` from `:737` to above `runImplementer`)
- Modify: `docs/driver.md` (`## Worker rights`, one new bullet)
- Test: `tests/bin-lib/driver/run.test.js` (new tests after the `AC6.1` worker-stop tests near `:1553`; adjust `AC2.4` and `AC2.5` near `:2427-2445`)

**Interfaces:**
- Consumes: `gitIn(deps, dir, args)` (`steps.js:332`), `FULL_SHA_RE`, `launchTracked`.
- Produces: `runImplementer(ctx, deps, { extraPrompt })` keeps its signature and return shape `{ status, detail?, extra? }`. Two new `fail` results, named in Global Constraints. Task 2 relies on a moved HEAD returning `status: 'fail'`.

- [ ] **Step 1: Write the failing tests** in `run.test.js`, after the `a worker that cannot complete stops at worker` test.

Add the helpers next to `headRead`, or move `headRead` up and reuse it:
```js
const isHeadRead = onGit('rev-parse', '--verify', '--end-of-options', 'HEAD');
const OTHER_SHA = 'e'.repeat(40);
```
The harness answers every HEAD read with `HEAD_SHA` by default. `nthCall(isHeadRead, 2, `${OTHER_SHA}\n`)` makes the read just after the first launch differ. `nthCall` is defined near `:2893`; move it above these tests.

Tests and their assertions:
- `AC1.1, AC1.2 (#5414): a worker launch after which HEAD moved stops at worker`. The script is `[nthCall(isHeadRead, 2, `${OTHER_SHA}\n`)]`. Final line `[stop.step, status, stop.class]` is `['worker', 'fail', 'pre-push']`. `stop.detail === `the worker moved HEAD from ${HEAD_SHA} to ${OTHER_SHA}``. `commitGit(h).length === 0`. No `verify.js` node call. `pushCalls(h).length === 0`.
- `AC2.1 (#5414): a reset to an earlier commit stops the same way`. The first read returns `OTHER_SHA` (`nthCall(isHeadRead, 1, …)`) and the second returns `HEAD_SHA`. The assertions match AC1, with `from ${OTHER_SHA} to ${HEAD_SHA}`.
- `AC4.1, AC4.2 (#5414): HEAD unreadable before the launch stops with no worker launched`. The first read throws `Object.assign(new Error('Command failed'), { stderr: 'fatal: @evil fixes #3\n' })`. Final line: `worker`, `fail`, detail `=== HEAD_BEFORE_UNREADABLE`. `calls(h, 'worker').length === 0`.
- `AC4.1 (#5414): an unreadable HEAD after the launch names only the earlier sha`. The second read throws the same error. Detail is `` `HEAD of the worktree is unreadable after the worker launch (it was ${HEAD_SHA})` ``. The detail does not include `@evil` or `#3`. One worker call.
- `(#5414) a HEAD read that is not a full sha is unreadable`. For each of `'abc123\n'`, `` `${HEAD_SHA.toUpperCase()}\n` ``, `` `${HEAD_SHA} extra\n` ``, used as the first read, the detail is `HEAD_BEFORE_UNREADABLE` and no worker is launched.
- `AC5.1 (#5414): a failed, timed-out or empty launch that moved HEAD reports the move`. For each of the `worker` overrides `{ status: 'fail', reason: 'launch-error', result: null, detail: 'boom' }` and `{ status: 'timeout', reason: 'wall-clock-ceiling', result: null, detail: null }`, plus a launch that returns `null` (script `[on('worker'), null]` placed ahead of the default), each with the second read `OTHER_SHA`: detail `=== `the worker moved HEAD from ${HEAD_SHA} to ${OTHER_SHA}``, status `fail`. For the two envelope cases the final line's `costUsd` still equals `0.25` (cost is kept). Then the user-decided launcher-throw case (spec Plan Review Clarifications, Reading B): script `[on('worker'), new Error('launch blew up')]` (ahead of the default) with the second read `OTHER_SHA`. Final line `worker`, `fail`, with detail `=== `the worker moved HEAD from ${HEAD_SHA} to ${OTHER_SHA}``. The same throw with HEAD unchanged still reaches `defineStep`'s throw handling as today: assert its detail differs from the moved-HEAD detail and that no HEAD-read failure text appears.
- `AC8.1 (#5414): the stop detail carries no worker text`. The worker result is `{ status: 'done', title: 'Fix\nfixes #12 @someone', summary: 'fixes #12 @someone' }` and the second read is `OTHER_SHA`. The detail contains none of `'\n'`, `'fixes'`, `'#12'`, `'@someone'`.
- `AC7.1 (#5414): the happy path adds exactly one HEAD read on each side of the implementer launch`. On a default `harness()`, take the git calls with `isHeadRead` and `c.cwd === WT`: there are exactly 3 (worker before, worker after, push guard). The call just before the implementer `worker` call in `h.calls` is a HEAD read, and so is the one just after it. On a default `fixRig()`, the `isHeadRead` count in `WT` is exactly 6: 2 per implementer launch, plus `preFixHead`, plus the push guard. Each of the 2 implementer calls has a HEAD read immediately before and immediately after it. **Literal base pins (recorded before Step 3, on the unmodified code):** write a scratch script, never committed, that runs a default `harness()` and a default `fixRig()` through `run(['#7'], h.deps)` and prints, for each, `JSON.stringify(h.calls.map(sig))` and `JSON.stringify(h.lines().map((l) => [l.step, l.status]))`. Here `sig = (c) => c.kind === 'git' ? `git ${gitSub(c)[0]}` : c.kind`. Paste the four printed arrays into the test as literals (`BASE_CALLS_PLAIN`, `BASE_CALLS_FIX`, `BASE_LINES_PLAIN`, `BASE_LINES_FIX`). The test then asserts that `h.calls.filter((c) => !(isHeadRead(c) && c.cwd === WT && <the call is one of the new reads>)).map(sig)` deep-equals the base literal. Identify the new reads as the HEAD reads adjacent to an implementer `worker` call, so `preFixHead` and the push guard's read stay in the compared list. It also asserts that the line pairs deep-equal the base literal. This is what makes "differ from before only by" and "event lines unchanged" falsifiable.

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `node --test --test-name-pattern="#5414" tests/bin-lib/driver/run.test.js`
Expected: FAIL after Step 1. With no HEAD check, AC1/AC2/AC5/AC8 reach later steps, and AC7 counts 1 HEAD read, not 3.

- [ ] **Step 3: Implement the check in `runImplementer`** (`plugin/bin/lib/driver/steps.js`)

Read HEAD after the ceiling and diff-bound guards and after `deps.mkdirSync`, immediately before `launchTracked` (so the HEAD read is the call recorded just before the worker call, which AC7.1's adjacency assertion and Task 2's read index rely on). Unreadable (throws, or not `FULL_SHA_RE`) → return `{ status: 'fail', detail: HEAD_BEFORE_UNREADABLE }` without launching. Read it again right after `await launchTracked(...)` settles, whether it resolves or throws (user decision, Reading B). Wrap the await in `try`/`catch`: on a throw, read HEAD. If it moved or is unreadable, return the matching `fail` (no `extra`). Otherwise rethrow the original error unchanged, so `defineStep` and the fix round's `catch` handle it as today. Build `ctx.worker` and `extra` exactly as today whenever the envelope is an object; they are still needed for cost reporting and the fix round's merge. Then compare, before any envelope judgment, the null-envelope check included: an unreadable after-read, or `after !== before`, returns `{ status: 'fail', detail, extra }`, with `extra` omitted when there was no envelope object. Add one sentence to the header comment: HEAD is read on both sides of the launch, a launcher throw included, and a moved or unreadable HEAD is a `fail` that names only the shas. An interrupt keeps precedence: `run.js` returns the signal handler's line, and `fixRound` checks `shared.interrupted` before `launched`, so neither changes here. Declare `HEAD_BEFORE_UNREADABLE` as a module constant and export nothing new.

- [ ] **Step 4: Run the new tests and confirm they pass**

Run: `node --test --test-name-pattern="#5414" tests/bin-lib/driver/run.test.js`
Expected: PASS.

- [ ] **Step 5: Adjust the two push-guard tests the new reads touch**

- `AC2.4: missing, short or non-sha head never passes the guard`: the assertion `… filter(HEAD read).length, 0, 'no HEAD read for a head that cannot match'` becomes a count of HEAD reads after the `check` node call (index > the check call's index), `=== 0`. The push step still reads nothing.
- `AC2.5: a failing rev-parse never passes the guard`: script the throw with `nthCall(isHeadRead, 3, err)` (the push guard's read), so the worker's two reads succeed. The assertions are unchanged.

Run: `node --test tests/bin-lib/driver/run.test.js`
Expected: PASS, whole file.

**Inserted-guard re-proof:** the HEAD check now runs ahead of the existing envelope checks (no envelope, `status !== ok`, `cannot-complete`, result status). Their tests (`AC6.1: worker timeout and fail stop the record at worker`, `a worker that cannot complete stops at worker`) still reach those checks only because the default HEAD reads are equal. Re-prove them: delete the `envelope.status !== 'ok'` branch and confirm `AC6.1: worker timeout and fail` goes red. Delete the `cannot-complete` branch and confirm the cannot-complete test goes red. Restore both, and quote the red output in the task report. Any other red test is a fixture that scripted every HEAD read: give it the reads with `nthCall`. Never loosen an assertion.

- [ ] **Step 6: Document it in `docs/driver.md` `## Worker rights`** (AC9.1, its Worker rights clause), with a new bullet after the Sandbox bullet:

`- HEAD: the driver reads HEAD before and after every implementer launch (the implementer step and the review fix round alike). A worker launch after which HEAD has moved, by a commit, a reset or a branch switch, or after which HEAD cannot be read, stops the record with status \`fail\`, naming only the two shas. An interrupt during the launch is reported as the interrupt. The driver never resets HEAD to recover.`

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/driver/steps.js tests/bin-lib/driver/run.test.js docs/driver.md
git commit -m "Stop a record when a worker launch moves HEAD — runImplementer reads HEAD on both sides (#5414)"
```

### Task 2: The fix round stops when its commit finds nothing

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/review.js:1072-1075` (`fixRound`), the header comment's commit paragraph near `:188-192`, and the two `whoever committed it` comments at `:1076` and `:1128`
- Modify: `docs/driver.md:79` (One fix round)
- Test: `tests/bin-lib/driver/run.test.js:3373` (rewrite) and a new AC3 test next to it

**Interfaces:**
- Consumes: Task 1's `runImplementer` moved-HEAD `fail`, which reaches `fixRound` as `launched`. `fixRig`, `FINDING_0`, `afterFixLaunch`, `commitGit`, `verifyCalls`, `pushCalls`, `nthCall`, `isHeadRead`, `OTHER_SHA`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing and rewritten tests**

- Rewrite `fix round: an evidence file the worker committed itself, unchanged, passes`. Rename it to `AC6.1 (#5414): a fix-round commit that finds nothing to commit stops the round`. Drop its `partly` case: it models a worker self-commit while HEAD stays put, a state Task 1 makes unreachable, so keeping it would pin the acceptance the spec rejects. AC3.1 below covers the real self-commit path. Change the `wholly` case to assert `lastLine(wholly).stop.detail === `fix round commit: no changed files: ${FINDING_0}``, `reviewLines(wholly)[0].status === 'stop'`, `pushCalls(wholly).length === 0`, and exactly one `commit` git call. Keep the `untitled` case unchanged.
- `(#5414) an interrupt during a fix launch that also moved HEAD is reported as the interrupt`. Use `fixRig({ effect: () => { h.signals[0]('SIGTERM'); }, script: [nthCall(isHeadRead, 5, `${OTHER_SHA}\n`)] })`, built with the same `let h = null; h = fixRig(...)` pattern as the existing interrupt test. `h.lines().at(-2).detail === 'interrupted by SIGTERM'`, and no line detail includes `moved HEAD`.
- `AC9.1 (#5414): docs/driver.md drops the self-commit carry-on and names the moved-HEAD stop`. Read `docs/driver.md` (repo root resolved as the file's existing tests resolve paths, `path.join(__dirname, '..', '..', '..', 'docs', 'driver.md')`). Assert that `!text.includes('committed everything itself')`. Assert that the `## Worker rights` section, sliced from that heading to the next `\n## `, includes `'HEAD has moved'` and `'fail'`. This fails until Task 1 Step 6 and this task's Step 5 have both landed, and Task 1's bullet is already in place by then.
- `AC3.1 (#5414): a fix-round worker that moves HEAD stops at review`. Run `fixRig` with `script: [nthCall(isHeadRead, 5, `${OTHER_SHA}\n`)]`. HEAD reads in order: 1 and 2 around the first implementer launch, 3 is `preFixHead`, 4 and 5 around the fix launch, 6 is the push guard (the reviewer's launch does not go through `runImplementer` and reads no HEAD). So the index is 5: the read immediately after the fix launch, which Task 1's AC7 adjacency assertion pins. Assert: `lastLine(h).stop.step === 'review'`; `reviewLines(h)[0].status === 'fail'`; `lastLine(h).stop.detail === `fix round launch: the worker moved HEAD from ${HEAD_SHA} to ${OTHER_SHA}: ${FINDING_0}``; `afterFixLaunch(h)` holds no `writeFileExclusive` and no `commit` git call; exactly 1 `verify.js` node call (the first, pre-review one); exactly 1 `express-lane.js check` call; and `pushCalls(h).length === 0`.

- [ ] **Step 2: Run them and confirm the failure**

Run: `node --test --test-name-pattern="AC(3|6)\.1 \(#5414\)" tests/bin-lib/driver/run.test.js`
Expected: FAIL after Step 1. AC6.1 fails (the round still carries on and pushes). AC3 should already pass on top of Task 1. If so, it is the pin for Review Focus 5, not a red-first test; say so in the commit body.

- [ ] **Step 3: Remove the carry-on in `fixRound`** (`review.js:1072-1075`)

Delete the `nothingToCommit` line and its two-line comment. The guard becomes `if (committed.status !== 'ok') return end(committed.status, `fix round commit: ${committed.detail}`);`. In the header comment, replace "The commit step's 'nothing to commit' stop (a stop that names no path) does not end the round: what the round changed is then already at HEAD. Either way every evidence file…" with "Any commit-step result other than `ok` ends the round, a nothing-to-commit stop included: a worker that moved HEAD has already stopped at the launch (runImplementer's HEAD check). Every evidence file…". Also drop ", and passes one it committed itself unchanged" from the end of that sentence. In the comment at `:1076`, `Every evidence file must be at HEAD with its recorded bytes, whoever committed it:` becomes `Every evidence file must be at HEAD with its recorded bytes:`. At `:1128`, `the round's are what differs from preFixHead, whoever committed it.` becomes `the round's are what differs from preFixHead.`

- [ ] **Step 4: Run and confirm the pass**

Run: `node --test tests/bin-lib/driver/run.test.js tests/bin-lib/driver/review.test.js`
Expected: PASS.

- [ ] **Step 5: Update `docs/driver.md:79`**

Replace the clause `; if the worker committed everything itself and there is nothing left to commit, the round carries on.` with `. A fix commit that finds nothing to commit stops the round, and a fix worker that moved HEAD has already stopped at its launch (Worker rights).`

Check (AC9.1): `grep -F "committed everything itself" docs/driver.md` prints nothing (exit 1). Absence-grep control, run while authoring on base `f04cfdbdc`: the same command matched `docs/driver.md:79` ("…if the worker committed everything itself and there is nothing left to commit, the round carries on."), so the search can see its target.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/driver/review.js tests/bin-lib/driver/run.test.js docs/driver.md
git commit -m "Stop the fix round when its commit finds nothing — drop the self-commit carry-on (#5414)"
```
