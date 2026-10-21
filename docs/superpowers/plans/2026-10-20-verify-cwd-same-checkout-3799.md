# verify.js refuses a --cwd outside the invoking checkout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `verify.js` check run whose `--cwd` resolves to a different git dir than the invoking checkout's exits 2 before any check spawns, so the invoking checkout's pass stamp can never credit checks that ran in another repository or worktree.

**Architecture:** One guard in `plugin/bin/verify.js`'s check-run path, placed immediately after `const ownGitDir = resolveGitDir();` (line 237) and before any log dir, count stamp or check is touched. It resolves the `--cwd` side with the same `report.js` `gitDir(execImpl, cwd)` helper and compares realpaths. The usage text in `args.js` and the CLI line in `docs/plugin-structure.md` state the rule.

**Tech Stack:** Node 18+, `node --test`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T194242-record-3799/work/3799-spec.md`

## Global Constraints

- The guard applies only to a check run with `--cwd` set **and** a non-null `ownGitDir`. An invocation outside any checkout (`ownGitDir === null`) is unchanged: it writes to the tmpdir and never stamps.
- A `--cwd` that is a subdirectory of the invoking checkout (the #2376 monorepo use) must keep running and stamping exactly as today.
- Refusal is a usage error: message plus `\n${USAGE}\n` on stderr, `process.exitCode = 2`, `return`. This is the same shape as the unresolvable `--baseline` branch (~line 248).
- Commit subjects use `{Verb} {what} — {detail} (refs #3799)` and end with `Claude-Session: https://claude.ai/code/session_013rJJzbm6jekM4XiWw1Bs19`. Never `closes`/`fixes`.
- Run every git/node command as its own plain command from the worktree root. No `cd &&`, no compound shells.

## Review Focus

1. `--cwd` pointing at a **sibling worktree of the same repository**. It has its own per-worktree git dir (`.git/worktrees/<name>`), so it is refused. This is correct, because each worktree has its own stamp.
2. `--cwd` pointing at a directory that **does not exist** or is **not inside any git repo**. The `gitDir` helper returns `null`, so the run is refused with "none (not inside a git checkout)". It must not crash.
3. A **relative** `--cwd` (e.g. `packages/app`). It must resolve against the process cwd before comparison, so the subdirectory case passes.
4. A **symlinked** path to the same checkout (macOS `/var` → `/private/var` temp dirs). The realpath comparison must treat it as the same checkout.
5. `--cwd` combined with `--baseline`/`--scope`. The guard runs before both, so a refused run never resolves a baseline or reads a scope file.

---

### Task 1: Refuse a cross-checkout --cwd

**Files:**
- Modify: `plugin/bin/verify.js:237` (insert the guard directly after `const ownGitDir = resolveGitDir();`, before `const gitDir = parsed.gitDir || ownGitDir;`)
- Modify: `plugin/bin/lib/verify/args.js` (`USAGE`: one new `\nnote:` line)
- Modify: `docs/plugin-structure.md` (the line starting `node plugin/bin/verify.js --cmd`)
- Test: `tests/bin-lib/verify/cli.test.js`

**Interfaces:**
- Consumes: `resolveGitDir` (= `report.js`'s `gitDir(execImpl = execFileSync, cwd = process.cwd())`, which returns an absolute git dir or `null`), `USAGE` from `args.js`, `parsed.cwd`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/verify/cli.test.js`, next to the existing `#3757` cases, using the file's `tmpGitRepo()` and `runCli()` helpers.

```js
// #3799: --cwd moves only the check spawns; the stamp and report belong to
// the invoking checkout, so a --cwd in another checkout is refused up front.
test('#3799: a --cwd in another checkout exits 2 before any check runs and writes nothing under the invoking checkout', async () => {
  const a = tmpGitRepo();
  const b = tmpGitRepo();
  const mark = `node -e "require('fs').writeFileSync('ran.marker', 'x')"`;
  const { code, stderr } = await runCli(['--cmd', `tests=${mark}`, '--cwd', b.repo], { cwd: a.repo });
  assert.strictEqual(code, 2);
  assert.ok(stderr.includes(fs.realpathSync(b.gitDir)), 'names the --cwd checkout git dir');
  assert.ok(stderr.includes(fs.realpathSync(a.gitDir)), 'names the invoking checkout git dir');
  assert.ok(!fs.existsSync(path.join(b.repo, 'ran.marker')), 'no check spawned');
  assert.ok(!fs.existsSync(path.join(a.gitDir, 'claude-tweaks-verify-pass.json')), 'no stamp for the invoking checkout');
  assert.ok(!fs.existsSync(path.join(a.gitDir, 'claude-tweaks-verify', 'report.json')), 'no report for the invoking checkout');
});

test('#3799: a --cwd outside any git checkout exits 2 and says so', async () => {
  const a = tmpGitRepo();
  const { code, stderr } = await runCli(['--cmd', 'tests=node -e 0', '--cwd', tmpDir()], { cwd: a.repo });
  assert.strictEqual(code, 2);
  assert.match(stderr, /not inside a git checkout/);
});

test('#3799: a --cwd subdirectory of the invoking checkout still runs and stamps', async () => {
  const a = tmpGitRepo();
  fs.mkdirSync(path.join(a.repo, 'packages', 'app'), { recursive: true });
  const { code } = await runCli(['--cmd', 'tests=node -e 0', '--cwd', 'packages/app'], { cwd: a.repo });
  assert.strictEqual(code, 0);
  assert.ok(fs.existsSync(path.join(a.gitDir, 'claude-tweaks-verify-pass.json')));
});

test('#3799: the usage text says --cwd must stay inside the invoking checkout', async () => {
  const { code, stderr } = await runCli(['--help']);
  assert.strictEqual(code, 2);
  assert.match(stderr, /--cwd must stay inside the checkout verify\.js runs from/);
});
```

AC coverage:
- The cross-checkout test covers AC1.1 (exit 2), AC1.2 (no check spawned), AC1.3 (no stamp or report under A) and AC1.4 (fails on current code — Step 7).
- The subdirectory test covers AC2.1. Step 6's unchanged `args.test.js`/`baseline.test.js` runs cover AC2.2.
- The usage test covers AC3.1. Step 5 plus a check covers AC3.2: `git grep -n -F "must stay inside the invoking checkout" -- docs/plugin-structure.md` returns one hit.

`tmpDir`, `fs`, `path` and `assert` are already in scope in that file. The relative `'packages/app'` covers Review Focus 3, and macOS temp dirs cover Review Focus 4.

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test --test-name-pattern="#3799" tests/bin-lib/verify/cli.test.js`
Expected: FAIL. The two refusal tests fail with `code` 0 instead of 2 on current code, the usage test fails (no `--cwd must stay inside` note yet), and the subdirectory test passes.

- [ ] **Step 3: Add the guard in `plugin/bin/verify.js`**

Directly after `const ownGitDir = resolveGitDir();`, when `parsed.cwd && ownGitDir`:
- compute `cwdGitDir = resolveGitDir(execFileSync, path.resolve(parsed.cwd))`;
- treat the run as same-checkout only when `cwdGitDir !== null` and `fs.realpathSync(cwdGitDir) === fs.realpathSync(ownGitDir)`.

Otherwise:
- write `--cwd ${parsed.cwd} resolves to git dir ${cwdGitDir ? fs.realpathSync(cwdGitDir) : 'none (not inside a git checkout)'}, not this checkout's (${fs.realpathSync(ownGitDir)}) — run verify.js from inside the target checkout so its stamp and report land there (#3799)\n${USAGE}\n` to stderr;
- set `process.exitCode = 2` and `return`.

Add a one-line `// #3799:` comment in the file's style. `verify.js` imports only `spawn` from `child_process` today (line 18: `const { spawn } = require('child_process');`), so widen that line to `const { spawn, execFileSync } = require('child_process');`.

This adds one `git rev-parse --git-dir` spawn to every check run that passes `--cwd`. No skill passes `--cwd` today. The only in-repo callers are `args.test.js` (parse-only, never spawns) and `baseline.test.js`'s subdirectory case (same checkout, which passes the guard), so no caller changes behavior.

- [ ] **Step 4: Add the usage note in `plugin/bin/lib/verify/args.js`**

Append to `USAGE` (after the `#3511` note):
`'\nnote: --cwd must stay inside the checkout verify.js runs from (a subdirectory, e.g. a monorepo package); a --cwd in another repository or worktree is a usage error (exit 2), since the pass stamp and report always belong to the invoking checkout (#3799).'`

- [ ] **Step 5: State the rule in `docs/plugin-structure.md`**

On the `node plugin/bin/verify.js --cmd` line, extend the existing `--cwd` description with: `--cwd must stay inside the invoking checkout — a --cwd in another repository or worktree exits 2 before any check runs (#3799)`.

- [ ] **Step 6: Run the verify suites to verify they pass**

Run: `node --test tests/bin-lib/verify/*.test.js`
Expected: PASS, 0 fail. The new `#3799` cases pass, and the `args.test.js` `--cwd` cases (#2376) and `baseline.test.js`'s "a --cwd subdir offsets both the base cwd and the cat-file path" case pass unchanged.

- [ ] **Step 7: Prove the refusal tests discriminate**

Temporarily remove the Step 3 guard, run the Step 2 command and expect the two refusal tests to FAIL (`code` 0, stamp written under A). Restore the guard and run again: PASS.

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/verify.js plugin/bin/lib/verify/args.js docs/plugin-structure.md tests/bin-lib/verify/cli.test.js
git commit -F <message-file>
```
Message: `Refuse a verify.js --cwd outside the invoking checkout — exit 2 before any check runs (refs #3799)`, then a blank line, then `Claude-Session: https://claude.ai/code/session_013rJJzbm6jekM4XiWw1Bs19`.

The full suite (`node plugin/bin/verify.js --cmd "tests=npm test"`) runs in `/claude-tweaks:build` Common Step 5, not in this task.
