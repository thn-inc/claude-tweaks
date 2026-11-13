# drive.js CI Settle Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `drive.js`'s CI step stops recording a check state taken before the pushed commit's tests have started.

**Architecture:** `ciStep` in `plugin/bin/lib/driver/steps.js` keeps polling `pr-checks.js --pr` until a read other than `pending`/`stale` arrives after a named settle window (measured from the push, stamped by `pushStep`), and the pushed sha has at least one workflow run (`gh run list --commit {sha}`). A commit with no workflow run once the window has passed is recorded as `no-ci`. The single `--run` read that logs the gate line is kept.

**Tech Stack:** Node 18+ CommonJS, `node --test`, the fake runner + fake clock harness in `tests/bin-lib/driver/run.test.js`.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T000412-spec-5277/work/5277-spec.md`

## Global Constraints

- No new dependencies; every external call goes through `deps` (steps.js header: "Every external call goes through `deps`; nothing here reads process state").
- The commit-run read uses the pushed sha — `ctx.check.head`, the `head` that `express-lane.js check` verified — never a branch name.
- Every record still gets exactly one `pr-checks.js --run … --section /express-lane` read (it writes the gate's decisions.md line).
- Existing CI-step tests change only where they relied on the early read ending the loop (spec AC5).
- CI runs Node 20; local is 22. Use only APIs both have.
- Commit subjects: `{Verb} {what} — {detail}`, ending with the line `Claude-Session: https://claude.ai/code/session_01CcCLFr7PPJeRooG4HcfWGJ`.

## Review Focus

1. A commit-run read that fails (gh error, unparseable output, non-array JSON) is never recorded as `no-ci`: it counts as "runs unknown", not "no runs" — Task 2 test `ci: an unreadable commit-run read is never no-ci`.
2. A commit with no workflow run whose rollup reads `pending` forever ends at the window as `no-ci`, not after the 30-minute bound as `timeout` — Task 2 test `ci: no workflow run on the pushed sha after the window records no-ci`.
3. The settle window runs from the push, not from the CI step's own start: a slow PR step must not add a second window — Task 1 test `ci: the settle window is measured from the push`.
4. `stale` still at the bound is `timeout`, like `pending` — Task 1 test `ci: stale keeps polling like pending and times out at the bound`.
5. Once a run has been seen on the commit, it is not re-read every poll (runs do not disappear) — Task 2 test `ci: the commit-run read stops once a run is seen`.

---

### Task 1: Settle window — a non-pending read inside the window keeps polling; stale polls like pending

**Files:**
- Modify: `plugin/bin/lib/driver/steps.js` — header comment (lines 1–21), CI constants (lines 44–46), `pushStep` (≈ lines 668–702), `ciStep` (≈ lines 843–875), `module.exports`
- Test: `tests/bin-lib/driver/run.test.js` — import line 18, new tests after the `ci polls --pr while pending…` test (≈ line 2360), adjustments listed in Step 5

**Interfaces:**
- Produces: `CI_SETTLE_WINDOW_MS` (number, `2 * 60 * 1000`) exported from `steps.js`; `ctx.pushedAt` (number from `deps.now()`), set by `pushStep` only on a successful push; a `settled(now)` notion inside `ciStep`: `now - (ctx.pushedAt ?? started) >= CI_SETTLE_WINDOW_MS`.

- [ ] **Step 1: Write the failing tests**

Add `CI_SETTLE_WINDOW_MS` to the destructured import on line 18. Add a helper `const WINDOW_POLLS = CI_SETTLE_WINDOW_MS / CI_POLL_INTERVAL_MS + 1;` (polls taken before the first one at or past the window; the harness clock moves 1 per `now()` and `ms` per `sleep`). Then:

```js
test('ci: a non-pending read inside the settle window does not end the step', async () => {
  for (const early of ['green', 'no-ci', 'stale']) {
    const seq = [early, 'pending'];
    const h = harness({ script: [[on('node', /pr-checks\.js$/), (c) => ({ code: 0, stderr: '',
      stdout: JSON.stringify({ state: c.args.includes('--run') ? 'green' : (seq.shift() ?? 'green') }) })]] });
    await run(['#7'], h.deps);
    assert.equal(lastLine(h).ci, 'green', early);
    assert.equal(checkPolls(h).length, WINDOW_POLLS, early);
    assert.equal(checkRuns(h).length, 1, early);
  }
});

test('ci: stale keeps polling like pending and times out at the bound', async () => {
  const h = harness({ script: [prChecksReply('stale')] });
  await run(['#7'], h.deps);
  assert.equal(lastLine(h).ci, 'timeout');
  assert.equal(checkPolls(h).length, CI_WAIT_BOUND_MS / CI_POLL_INTERVAL_MS + 1);
  assert.equal(checkRuns(h).length, 1);
});

test('ci: the settle window is measured from the push', async () => {
  let h = null;
  // The PR step takes the whole window: the first CI poll is already past it, so it is final.
  h = harness({ script: [[on('ghCreate', 'pr', 'create'), () => { h.deps.sleep(CI_SETTLE_WINDOW_MS); return `${PR_URL}\n`; }]] });
  await run(['#7'], h.deps);
  assert.equal(lastLine(h).ci, 'green');
  assert.equal(checkPolls(h).length, 1);
});

test('ci: the settle window constant', () => {
  assert.equal(CI_SETTLE_WINDOW_MS, 2 * 60 * 1000);
});
```

(The default `h.deps.sleep` advances the clock synchronously before returning its promise, so calling it without `await` inside the reply moves time.)

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test --test-name-pattern "settle window|stale keeps polling" tests/bin-lib/driver/run.test.js`
Expected: FAIL — `CI_SETTLE_WINDOW_MS` is `undefined` (the constant test fails, and the polls counts are 1, not `WINDOW_POLLS`)

- [ ] **Step 3: Implement the settle window in `steps.js`**

- Constants block: `const CI_SETTLE_WINDOW_MS = 2 * 60 * 1000;` beside `CI_WAIT_BOUND_MS`, with a one-line comment pointing at the header paragraph. Export it.
- Header comment: add one paragraph stating the settle window — its name, its value (2 minutes), and why it exists: the CI step runs seconds after `gh pr create`, before GitHub has created the test workflow for the pushed commit; in the #5215 Phase 1 proof every CI step ended within ~5 seconds, recording `green` (#4198, #4351) or `pending` (#3931) while test shards had not started, because the only checks on the PR were fast workflows already finished or skipped. "At least one run on the commit" alone does not close that gap (#4198's commit had a finished skipped `label-fix-branch` run before the test workflow existed), so the window does; the window is measured from the push.
- `pushStep`: on the success path (where `ctx.pushed = true` is set after a clean push) also set `ctx.pushedAt = deps.now()`. Not on the failed-push path.
- `ciStep`: the loop's exit test becomes "the polled state is neither `pending` nor `stale`, and the read is settled" (window measured from `ctx.pushedAt`, falling back to the step's own `started` when absent); otherwise it keeps polling under the existing bound, sleep and interrupt checks. The timeout mapping after the `--run` read becomes `timedOut && (state === 'pending' || state === 'stale')`.
- Update `ciStep`'s comment block to say it polls while pending or stale, or until the settle window has passed.

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `node --test --test-name-pattern "settle window|stale keeps polling" tests/bin-lib/driver/run.test.js`
Expected: PASS

- [ ] **Step 5: Adjust the existing tests that relied on the early read ending the loop**

Only these, and only the parts named:
- `AC7.6: ci word is the pr-checks state…` (≈ line 2308): in the per-state loop, `checkPolls(h).length` is `WINDOW_POLLS`, not `1`. Everything else stays.
- `ci polls --pr while pending, then makes one --run read…` (≈ line 2345): its `deps.sleep` override does not advance the clock, so the window would never pass. Build the harness without the override, then wrap: `const tick = h.deps.sleep; h.deps.sleep = (ms) => { sleeps.push(ms); return tick(ms); };`. Polls become `polls.shift() ?? 'green'`; expected `sleeps` is `WINDOW_POLLS - 1` entries of `CI_POLL_INTERVAL_MS`, and the call list is `WINDOW_POLLS` `['--pr', '9']` entries then the `--run` entry. The `stale` final-read assertion stays.
- `AC6.4: transient pr create retries once after finding no open PR` (≈ line 2180): same non-advancing `sleep` override — switch to the wrap pattern above so the CI step's window can pass; its assertions stay.
- `Gotcha: a run with CLAUDE_CODE_SESSION_ID unset…` (≈ line 1009): the CLI count is `10 + WINDOW_POLLS`, and the message names `pr-checks --pr ×WINDOW_POLLS`.

Then run the whole file: `node --test tests/bin-lib/driver/run.test.js` — Expected: PASS. Any other failure is a test that relied on the early read: fix it the same way (count derived from `WINDOW_POLLS`, or a clock-advancing sleep), and name it in the commit body.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/driver/steps.js tests/bin-lib/driver/run.test.js
git commit -m "Hold drive.js CI reads to a settle window — a non-pending read before it keeps polling, stale polls like pending

Claude-Session: https://claude.ai/code/session_01CcCLFr7PPJeRooG4HcfWGJ"
```

---

### Task 2: Commit-run read — a settled read also needs a workflow run on the pushed sha; none after the window is `no-ci`

**Files:**
- Modify: `plugin/bin/lib/driver/steps.js` — new `readCommitRuns` beside `readCiState` (≈ line 832), `ciStep`, the header paragraph from Task 1
- Test: `tests/bin-lib/driver/run.test.js` — `defaultScript` (≈ line 233, beside the `pr-checks` reply), new tests after Task 1's

**Interfaces:**
- Consumes: `CI_SETTLE_WINDOW_MS`, `ctx.pushedAt`, the settled test, `WINDOW_POLLS` (Task 1).
- Produces: `readCommitRuns(ctx, deps) -> 'some' | 'none' | 'unreadable'` (module-private).

- [ ] **Step 1: Write the failing tests**

Add a default reply to `defaultScript`, beside the `pr-checks` one: `[on('gh', 'run', 'list'), JSON.stringify([{ databaseId: 1 }])]`, and helpers:

```js
const runListCalls = (h) => h.calls.filter((c) => c.kind === 'gh' && c.args[0] === 'run' && c.args[1] === 'list');
const runListReply = (reply) => [on('gh', 'run', 'list'), reply];
```

Tests:

```js
test('ci: no workflow run on the pushed sha after the window records no-ci', async () => {
  for (const polled of ['green', 'pending']) {
    const h = harness({ script: [runListReply('[]'), prChecksReply(polled)] });
    await run(['#7'], h.deps);
    assert.equal(lastLine(h).ci, 'no-ci', polled);
    assert.equal(h.lines().find((l) => l.step === 'ci').detail, 'no-ci', polled);
    assert.equal(checkPolls(h).length, WINDOW_POLLS, polled);
    assert.equal(checkRuns(h).length, 1, polled);
  }
});

test('ci: the commit-run read uses the pushed sha, never the branch', async () => {
  const h = harness();
  await run(['#7'], h.deps);
  assert.deepEqual(runListCalls(h).map((c) => c.args),
    [['run', 'list', '--repo', 'acme/widgets', '--commit', HEAD_SHA, '--limit', '1', '--json', 'databaseId']]);
});

test('ci: an unreadable commit-run read is never no-ci', async () => {
  for (const reply of [new Error('HTTP 502'), 'not json', '{"a":1}']) {
    const green = harness({ script: [runListReply(reply)] });
    await run(['#7'], green.deps);
    assert.equal(lastLine(green).ci, 'green', String(reply));
    const pending = harness({ script: [runListReply(reply), prChecksReply('pending')] });
    await run(['#7'], pending.deps);
    assert.equal(lastLine(pending).ci, 'timeout', String(reply));
  }
});

test('ci: the commit-run read stops once a run is seen', async () => {
  const seq = Array(WINDOW_POLLS + 3).fill('pending');
  const h = harness({ script: [[on('node', /pr-checks\.js$/), (c) => ({ code: 0, stderr: '',
    stdout: JSON.stringify({ state: c.args.includes('--run') ? 'green' : (seq.shift() ?? 'green') }) })]] });
  await run(['#7'], h.deps);
  assert.equal(lastLine(h).ci, 'green');
  assert.equal(runListCalls(h).length, 1);
});
```

(`HEAD_SHA` and `PR_URL` are the file's existing constants; confirm `checkProceed()`'s default `head` is `HEAD_SHA` before relying on it. AC1's "even when the commit already has a finished run" clause is Task 1's first test running under this task's default `run list` reply — one run on the commit from the start — so it needs no separate test here.)

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test --test-name-pattern "commit-run read|no workflow run" tests/bin-lib/driver/run.test.js`
Expected: FAIL — no `gh run list` call is made (`runListCalls` is empty; the no-run cases record `green`/`timeout`, not `no-ci`)

- [ ] **Step 3: Implement `readCommitRuns` and wire it into `ciStep`**

- `readCommitRuns(ctx, deps)`: `deps.gh(['run', 'list', '--repo', ctx.shared.ghRepo, '--commit', ctx.check.head, '--limit', '1', '--json', 'databaseId'])`, parsed as JSON; a non-empty array → `'some'`, an empty array → `'none'`, a throw, unparseable output or a non-array → `'unreadable'`. It never throws.
- `ciStep`: once a poll is settled (Task 1's window), and until a run has been seen (`'some'` is remembered for the rest of the step and not re-read), read the commit's runs after that poll:
  - `'none'` → stop polling, whatever the polled state; make the one `--run` read as usual, then record `no-ci` (the same override position as the `timeout` mapping).
  - `'some'` → a polled state other than `pending`/`stale` ends the loop; `pending`/`stale` keeps polling.
  - `'unreadable'` → treated as unknown, never as `'none'`: a polled state other than `pending`/`stale` ends the loop (the window has passed); `pending`/`stale` keeps polling, and the read is retried on the next poll.
- No commit-run read happens before the window has passed.
- Extend the header paragraph: a settled read also needs at least one workflow run on the pushed sha (`ctx.check.head`); a commit still without one once the window has passed is recorded as `no-ci`; an unreadable run read is never `no-ci`.

- [ ] **Step 4: Run the new tests, then the whole file**

Run: `node --test --test-name-pattern "commit-run read|no workflow run" tests/bin-lib/driver/run.test.js`
Expected: PASS
Run: `node --test tests/bin-lib/driver/run.test.js`
Expected: PASS (Task 1's adjusted tests included; the default `run list` reply makes every other record see one run)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/driver/steps.js tests/bin-lib/driver/run.test.js
git commit -m "Require a workflow run on the pushed sha before drive.js trusts a CI read — none after the settle window is no-ci

Claude-Session: https://claude.ai/code/session_01CcCLFr7PPJeRooG4HcfWGJ"
```
