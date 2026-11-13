# Driver Test-Step Containment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The driver's `test` step runs `verify.js` without the driver's credential environment and never reads a worker-edited `.claude-tweaks/verify-scope.json`.

**Architecture:** In `testStep`, (1) refuse a scope file that differs from `origin/{ref}`'s before any test command runs, and (2) hand the `verify.js` child `buildEnv(deps.env, deps.platform)` (the worker's own allow-list) instead of `deps.env`. The `steps.js` header records the chosen option and its residual risk.

**Tech Stack:** Node 18+, `node --test`, the fake-runner harness in `tests/bin-lib/driver/run.test.js`.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T035137-spec-5267/work/5267-spec.md` (record #5267).

## Global Constraints

- Key files only: `plugin/bin/lib/driver/steps.js`, `tests/bin-lib/driver/run.test.js`.
- Chosen option (spec Deliverables, option 2 plus a scope guard): allow-listed env for the test child; no sandbox profile is added.
- `buildEnv`/`ENV_ALLOW` come from `plugin/bin/lib/driver/worker.js` (exports already exist; `worker.js` requires neither `steps.js` nor `run.js`, so no require cycle).
- ENV_ALLOW is `PATH HOME USER TMPDIR LANG CLAUDE_CONFIG_DIR` (win32 adds its own list inside `buildEnv`).
- Match the neighbouring test style; no scratch tests committed. Commit style `{Verb} {what} — {detail}`.

## Acceptance coverage

- A fake-runner test shows the test step's child process receives no `GH_TOKEN`/`GITHUB_TOKEN` (or none of the credential variables `worker.js`'s `ENV_ALLOW` excludes) — Task 2's env test.
- A test pins that an edited `.claude-tweaks/verify-scope.json` is either refused before any test command runs, or never read from the worker's tree — Task 1's differs-from-`origin/{ref}` test (refused before any test command runs).
- The `steps.js` header names the residual risk the chosen option leaves — Task 2, Step 3's header paragraph.

## Review Focus

- A scope file deleted by the worker (present on `origin/{ref}`, absent in the tree) must refuse too; `git diff` against the ref sees it.
- A scope file the worker creates where `origin/{ref}` has none must refuse.
- `git diff` failing for a reason other than exit 1 (git missing, bad ref) must fail the step, never read as "unchanged".
- `GH_TOKEN`, `GITHUB_TOKEN`, `GH_HOST`, `NODE_OPTIONS`-style variables present in `deps.env` must not reach the `verify.js` child; only allow-listed names do.
- The other steps' `deps.env` calls (claim, push, pr) are unchanged — they need credentials.

---

### Task 1: Refuse a worker-edited scope file before verify.js runs

**Files:**
- Modify: `plugin/bin/lib/driver/steps.js` (`testStep`, around lines 553-580)
- Test: `tests/bin-lib/driver/run.test.js` (the `// --- test, check and push` section, near `AC12.3, AC12.4`; the default script in `defaultScript` also needs one entry)

**Interfaces:**
- Consumes: `gitIn(deps, dir, args)` (steps.js), `ctx.shared.ref`, `ctx.wt`, `errorText(err)`, `neutralize`.
- Produces: `testStep` returns `{ status: 'stop', detail }` when the scope file differs from `origin/${ref}`; no later task depends on it.

- [ ] **Step 1: Add the default and write the failing tests**

In `defaultScript`, add next to the `onGit('merge')` entry: `[onGit('diff', '--quiet'), '']` (an unchanged scope file is the happy path for every existing test). In the test section add:

```js
const scopeDiff = (reply) => [onGit('diff', '--quiet'), reply];

test('#5267: a scope file that differs from origin/{ref} stops before verify.js runs', async () => {
  const h = harness({ script: [scopeIs('file'), scopeDiff(exitOne)] });
  await run(['#7'], h.deps);
  const final = lastLine(h);
  assert.deepEqual([final.stop.step, final.status, final.stop.class], ['test', 'stop', 'pre-push']);
  assert.match(final.stop.detail, /verify-scope\.json.*differs from origin\/main/);
  assert.equal(verifyCalls(h).length, 0, 'no verify call');
  const diff = gitCalls(h).find((c) => gitSub(c)[0] === 'diff');
  assert.deepEqual(gitSub(diff).slice(0, 5), ['diff', '--quiet', 'origin/main', '--', '.claude-tweaks/verify-scope.json']);
});

test('#5267: an unchanged scope file, and an absent one, proceed to verify.js', async () => {
  for (const script of [[scopeIs('file')], []]) {
    const h = harness({ script });
    await run(['#7'], h.deps);
    assert.equal(verifyCalls(h).length, 1);
  }
});

test('#5267: a git diff failure other than exit 1 fails the step, no verify call', async () => {
  const h = harness({ script: [scopeDiff(() => { throw Object.assign(new Error('bad revision'), { status: 128 }); })] });
  await run(['#7'], h.deps);
  const final = lastLine(h);
  assert.deepEqual([final.stop.step, final.status], ['test', 'fail']);
  assert.equal(verifyCalls(h).length, 0);
});
```

(If `gitSub` already strips the leading `-C <dir>`, use it as the neighbours do; adjust the slice to match its output.)

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/driver/run.test.js`, with output redirected to a scratchpad `.txt` file and read from there, per the repo's test-run rule.
Expected: the three `#5267:` tests FAIL (no diff call is made yet); every other test still passes.

- [ ] **Step 3: Implement the guard in `testStep`**

After the `lstatType` checks and before building `args`, add a guard function `scopeDiffersFromBase(deps, wt, ref, scopeRel)` returning `true` on `git diff --quiet origin/${ref} -- ${scopeRel}` exit 1, `false` on exit 0, and throwing `could not compare ${scopeRel} with origin/${ref}: ${errorText(err)}` on any other error (mirror `findLeftovers`'s `err.status !== 1` pattern, steps.js:316). Run the guard for both the `file` and the `missing` state (a worker-created or deleted file must refuse); the `testStep` wrapper already turns a throw into `fail`. On `true` return `{ status: 'stop', detail: `${scopeRel} differs from origin/${ref}; the worker's copy is never read, verify.js was not run` }`. The existing symlink/directory refusals stay first.

- [ ] **Step 4: Run to verify they pass**

Run: the same command as Step 2, plus `node --test tests/bin-lib/driver/` as a whole.
Expected: all PASS, including AC12.1–AC12.4.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/driver/steps.js tests/bin-lib/driver/run.test.js
git commit -m "Refuse a worker-edited verify-scope.json in the driver test step — compared with origin/{ref} before verify.js runs"
```

### Task 2: Allow-listed environment for the verify.js child, and the header

**Files:**
- Modify: `plugin/bin/lib/driver/steps.js` (imports; the `verify.js` call; header comment lines 1-21)
- Test: `tests/bin-lib/driver/run.test.js`

**Interfaces:**
- Consumes: `buildEnv(parentEnv: object, platform: string): object` from `./worker` (`worker.js` export).
- Produces: nothing later tasks use.

- [ ] **Step 1: Write the failing test**

```js
test('#5267: the verify.js child gets only allow-listed variables, never the driver credentials', async () => {
  const h = harness();
  h.deps.env = { PATH: '/bin', HOME: '/home/u', GH_TOKEN: 'x', GITHUB_TOKEN: 'y', GH_HOST: 'h', AWS_SECRET_ACCESS_KEY: 'z' };
  await run(['#7'], h.deps);
  const [v] = verifyCalls(h);
  assert.deepEqual(v.env, { PATH: '/bin', HOME: '/home/u' });
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_HOST', 'AWS_SECRET_ACCESS_KEY']) assert.ok(!(name in v.env), name);
  // The other steps keep the driver env: a claim call still sees GH_TOKEN.
  assert.equal(calls(h, 'node', /claim-targets\.js$/)[0].env.GH_TOKEN, 'x');
});
```

(`harness` has `env: {}` by default, so set `h.deps.env` after construction as shown; if `claim-targets.js` is not reached with that script, assert on any other `deps.env` consumer instead.)

- [ ] **Step 2: Run to verify it fails**

Run `node --test` on `tests/bin-lib/driver/run.test.js`, with output redirected to a scratchpad `.txt` file (the file already passes, so this task appends to it).
Expected: the new `#5267:` test FAILS because `v.env` still holds `GH_TOKEN`.

- [ ] **Step 3: Implement**

Import `buildEnv` from `./worker` in `steps.js` and change the `verify.js` call's `env` to `buildEnv(deps.env, deps.platform)`. Then confirm `verify.js` still needs nothing else: read its use of `process.env` and the suite-slot code (`plugin/bin/lib/suite-slot.js`, `verify/slot.js`) for any variable outside the allow-list that the run depends on; if one is required (for example `CI` or `npm_config_*`), add it to the call explicitly in `testStep` rather than widening `ENV_ALLOW`, and name it in the header. Extend the header comment with a paragraph: the chosen option (allow-listed env for the test child, plus refusal of a scope file differing from `origin/{ref}`), what it contains (credential environment variables, a worker-edited scope file), and what it still lets through (worker-written test files run with `HOME` reachable, so `gh` keychain or config auth under `HOME` and any file the user can read stay reachable; there is no sandbox profile).

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/driver/` and `node --test tests/git-status-optional-locks.test.js` (the neighbouring source-scan suite that reads driver sources).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/driver/steps.js tests/bin-lib/driver/run.test.js
git commit -m "Run the driver test step with an allow-listed environment — worker-authored tests no longer see GH_TOKEN; header names the residual risk"
```
