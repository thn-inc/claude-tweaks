# verify --baseline nested-worktree + space-path regression (#3156) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin, with a CLI-level regression test, that `verify.js --baseline` run from a linked worktree nested inside a checkout whose path contains a space classifies an unchanged failing file as `baseline` — never a silent `attributable`.

**Architecture:** No production change. The root cause #3156 observed was #3155's space-in-path truncation (fixed upstream, released v6.141.0); the fail-closed requirement is supplied by #3153's `git.inCheckout` + `absent-from-checkout:` reason on this same branch (a truncated `Workspaces/…` path is absent from the checkout, so it can no longer reach `attributable`). This plan adds the regression test the record's Deliverable 3 / AC2 require.

**Tech Stack:** Node 18+, `node --test`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T172700-spec-3153-3156/spec-3156/work/3156-spec.md` (record #3156)

## Global Constraints

- Tests run from fresh temp dirs only — never from this repo (`tests/bin-lib/verify/cli.test.js`'s own header rule).
- A nested `node --test` child needs `NODE_TEST_CONTEXT` stripped (`nestedRunEnv()`), or it runs the file bare and exits 0.

## Review Focus

1. A repo path containing a space (`Code Workspaces/repo`) — the exact shape #3155 truncated; the test must put the space in a path segment above the repo root.
2. A linked worktree under the main checkout's own tree (`.claude/worktrees/dispatch-record-1`) — the `/flow`/`/dispatch` session shape #3156 suspected; the CLI must run with that worktree as cwd.
3. The worktree's git dir is not `{cwd}/.git` — `report.json` must be read from `git rev-parse --absolute-git-dir` of the worktree, not a hard-coded `.git` path.
4. An unchanged failing file (byte-identical at base) must land in `baselineFailing`, with `attributable` empty and `verdict: pass` — the three fields #3156's symptom (`attributable` = all files, `baselineFailing: []`) inverted.
5. Discrimination: the test must fail on pre-#3155 code (validated during this run's build against a pre-#3155 checkout: the truncated path makes the file `attributable`).

Each line is pinned by Task 1's single test.

---

### Task 1: Nested-worktree + space-path `--baseline` regression test

**Files:**
- Modify: `tests/bin-lib/verify/cli.test.js` (insert after the `--baseline: failures that also fail at base exit 0 … (#3043 AC1)` test)

**Interfaces:**
- Consumes: `tmpDir()`, `runCli(args, opts)`, `SUITE`, `PER_FILE`, `nestedRunEnv()` — all already defined in `tests/bin-lib/verify/cli.test.js`.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Write the test**

Insert immediately after the `#3043 AC1` test's closing `});`:

```js
// #3156: the /flow and /dispatch session shape — a linked worktree under the
// main checkout's own tree, on a checkout path containing a space (#3155's
// truncation). An unchanged failing file must classify baseline, never fall
// through to attributable.
test('--baseline: run from a linked worktree nested in a space-containing checkout path, an unchanged failing file classifies baseline (#3156)', async () => {
  const repo = path.join(tmpDir(), 'Code Workspaces', 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'verify-test@example.invalid');
  git(repo, 'config', 'user.name', 'verify test');
  fs.mkdirSync(path.join(repo, 'tests'));
  fs.writeFileSync(path.join(repo, 'tests', 'env.test.js'), "require('node:test')('env', () => { throw new Error('env-specific'); });\n");
  fs.writeFileSync(path.join(repo, 'tests', 'ok.test.js'), "require('node:test')('ok', () => {});\n");
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  const baseSha = git(repo, 'rev-parse', 'HEAD').trim();
  const wt = path.join(repo, '.claude', 'worktrees', 'dispatch-record-1');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature', wt);
  fs.writeFileSync(path.join(wt, 'README.md'), 'change\n');
  git(wt, 'add', '.');
  git(wt, 'commit', '-q', '-m', 'head');
  const { code, stdout } = await runCli(['--cmd', SUITE, '--baseline', baseSha, '--baseline-cmd', PER_FILE], { cwd: wt, env: nestedRunEnv() });
  assert.strictEqual(code, 0, stdout);
  const gitDir = git(wt, 'rev-parse', '--absolute-git-dir').trim();
  const report = JSON.parse(fs.readFileSync(path.join(gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.baselineAdjudicated.verdict, 'pass', JSON.stringify(report.baselineAdjudicated));
  assert.deepStrictEqual(report.baselineAdjudicated.baselineFailing, ['tests/env.test.js']);
  assert.deepStrictEqual(report.baselineAdjudicated.attributable, []);
});
```

- [ ] **Step 2: Run the test**

Run: `node --test --test-name-pattern="#3156" tests/bin-lib/verify/cli.test.js`
Expected: PASS (`# pass 1`, `# fail 0`). This is a regression pin for a fix already on the branch base (#3155) plus this branch's #3153 fail-closed guard, so it passes on arrival; its discrimination was shown during this run's build by running the same body against a pre-#3155 checkout (FAIL: `tests/env.test.js` attributable).

- [ ] **Step 3: Run the whole file**

Run: `node --test tests/bin-lib/verify/cli.test.js`
Expected: PASS, no regression in the file's other tests.

- [ ] **Step 4: Commit**

```bash
git -C "$WORKTREE" add tests/bin-lib/verify/cli.test.js
git -C "$WORKTREE" commit -m "Pin verify --baseline from a nested worktree on a space-containing path — refs #3156"
```
