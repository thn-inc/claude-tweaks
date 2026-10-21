# Staged-patch stack check: win32-safe GIT_CONFIG_GLOBAL (#3696) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `stack-check.js`'s git calls from failing on Windows, where `os.devNull` (`\\.\nul`) is rejected as `GIT_CONFIG_GLOBAL`.

**Architecture:** Move `defaultGit`'s env construction into an exported `gitEnv({ platform, devNull, env })` builder that takes its OS inputs as parameters (windows-checkout-test-parity skill), so the win32 branch is pinned on Linux CI.

**Tech Stack:** Node 18+, `node:test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T124821-spec-3599-3602-3695-3696-3698-3699-3595/spec-3696/work/3696-spec.md`

## Global Constraints

- Keep `GIT_CONFIG_NOSYSTEM: '1'` and the `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` deletions unchanged.
- win32 value is the literal `'/dev/null'` (proven on `windows-latest` by `tests/helpers/git-fixtures.js:111` and this test file's own `FIXTURE_ENV`); `'nul'` is unproven and not used.
- Never stub `process.platform`; pass `platform` explicitly in tests.

## Review Focus

- A caller-supplied env must not be mutated (the deletions run on a copy).
- On a POSIX host `os.devNull` is already `/dev/null`, so a win32 pin that does not inject `devNull` cannot fail on revert — the pin injects the real win32 value `'\\\\.\\nul'`.
- Real-git behavior on Windows (the ~21 tests in `cli.test.js`/`stack-check.test.js`) is confirmed only by the post-merge `windows-regression` run.

## Sole-site evidence

`grep -rnE "os\.devNull|GIT_CONFIG_GLOBAL" plugin/bin` at `3073308e9`:

```
plugin/bin/lib/staged-patch/stack-check.js:28:  const env = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' };
```

One hit: no other `plugin/bin` site passes `os.devNull` (or sets `GIT_CONFIG_GLOBAL`) for git.

Waived tests/helpers/git-fixtures.js: read only — line 111's `'/dev/null'` is the proven win32 value this task copies.
Waived plugin/bin/check-staged-stack.js: read only — the CLI exit path (`:153-156`) goes green once `walkStack` stops skipping every patch; no change.

---

### Task 1: Platform-aware `gitEnv` builder for `defaultGit`

**Files:**
- Modify: `plugin/bin/lib/staged-patch/stack-check.js:24-34` (`defaultGit`) and `:270` (exports)
- Test: `tests/bin-lib/staged-patch/stack-check.test.js`

**Interfaces:**
- Produces: `gitEnv({ platform = process.platform, devNull = os.devNull, env = process.env } = {}) -> object` — a new env object, exported from `stack-check.js` beside `stagedApplyOrder, checkStack, rederive, stackVerdicts`.

- [ ] **Step 1: Write the failing tests (AC1.1, AC1.2)**

Append to `tests/bin-lib/staged-patch/stack-check.test.js` (already passing, so Step 2's run fails only on the new tests). Add `gitEnv` to the file's existing `require('../../../plugin/bin/lib/staged-patch/stack-check')` destructure, then append:

```js
test('AC1.1: gitEnv on win32 uses /dev/null, never the \\\\.\\nul device path', () => {
  const env = gitEnv({ platform: 'win32', devNull: '\\\\.\\nul', env: {} });
  assert.strictEqual(env.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.ok(!String(env.GIT_CONFIG_GLOBAL).includes('\\\\.\\nul'));
});

test('AC1.2: gitEnv on linux uses the platform devNull', () => {
  const env = gitEnv({ platform: 'linux', devNull: '/dev/null', env: {} });
  assert.strictEqual(env.GIT_CONFIG_GLOBAL, '/dev/null');
});

test('gitEnv keeps NOSYSTEM, drops repo pointers, and never mutates the input env', () => {
  const input = { PATH: '/bin', GIT_DIR: '/x/.git', GIT_WORK_TREE: '/x', GIT_INDEX_FILE: '/x/i' };
  const env = gitEnv({ platform: 'linux', devNull: '/dev/null', env: input });
  assert.strictEqual(env.GIT_CONFIG_NOSYSTEM, '1');
  assert.strictEqual(env.PATH, '/bin');
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) assert.ok(!(k in env), k);
  assert.deepStrictEqual(input, { PATH: '/bin', GIT_DIR: '/x/.git', GIT_WORK_TREE: '/x', GIT_INDEX_FILE: '/x/i' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/staged-patch/stack-check.test.js`
Expected: FAIL — the three new tests throw `TypeError: gitEnv is not a function` (not exported yet); the existing tests still pass.

- [ ] **Step 3: Implement `gitEnv` in `plugin/bin/lib/staged-patch/stack-check.js`**

`gitEnv` copies `env`, sets `GIT_CONFIG_GLOBAL` to `platform === 'win32' ? '/dev/null' : devNull` and `GIT_CONFIG_NOSYSTEM` to `'1'`, deletes the three repo pointers from the copy, and returns it. `defaultGit` replaces its inline env and three `delete` lines with `const env = gitEnv();`. Extend the comment above `defaultGit` with one sentence: Git for Windows rejects `os.devNull` (`\\.\nul`) as a config path, so win32 uses `/dev/null`. Add `gitEnv` to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass (AC4.1)**

Run: `node --test tests/bin-lib/staged-patch/`
Expected: PASS, 0 failures.

- [ ] **Step 5: Verify the win32 test discriminates (AC2.1)**

In a scratch worktree (`git worktree add <scratch> HEAD` after the commit — never edit-and-restore in the shared worktree), change the win32 branch to `devNull` and run `node --test tests/bin-lib/staged-patch/stack-check.test.js` there.
Expected: FAIL on AC1.1 (`'\\\\.\\nul' !== '/dev/null'`). Remove the scratch worktree afterwards.

- [ ] **Step 6: Verify no git config-path use of os.devNull remains (AC3.1)**

Run: `grep -rn "os.devNull" plugin/bin`
Expected: exactly one hit — `gitEnv`'s `devNull = os.devNull` default parameter, which on win32 is never returned as a config path.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/staged-patch/stack-check.js tests/bin-lib/staged-patch/stack-check.test.js
git commit -m "Build the stack check's git env per platform — /dev/null on win32, where os.devNull is rejected

refs #3696

Claude-Session: https://claude.ai/code/session_01YVBrdUJUP7EjvTUw6e89s9"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 3; Deliverable 2 → Step 1; Deliverable 3 → Sole-site evidence + Step 6. AC1 → Steps 1/4, AC2 → Step 5, AC3 → Step 6, AC4 → Step 4 (targeted) plus the build's central `npm test`.
- **Placeholders:** none.
