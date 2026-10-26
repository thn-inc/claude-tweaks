# Windows Release Write Guards Refuse Symlinks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the release-bootstrap and release-local write guards refuse a symlink on win32 exactly as they do on POSIX.

**Architecture:** `assertSafeWriteTarget` gets its directory segments from a pure, exported `segmentsOf(rel, pathImpl)` that splits on both separators, so the per-segment `lstat` sees every intermediate directory on win32. `writeInsideRoot` takes its `fs.constants` as a parameter. When `O_NOFOLLOW` is not a number, it refuses a symlinked leaf with `lstat` before opening, opens without `O_TRUNC`, and checks the opened file against the path (`fstat` vs `lstat`, `dev` and `ino`) before it truncates and writes.

**Tech Stack:** Node 18+ built-ins (`fs`, `path`), `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T193512-spec-4282/work/4282-spec.md`

## Global Constraints

- Neither guard may degrade silently: a missing platform constant selects the lstat path.
- Error text stays as it is today: `refusing to write through a symlink: {rel}` (bootstrap) and `refusing to write {p}: it is a symlink` (release-local).
- Linux-runnable pins only (CI is ubuntu). The existing real-symlink tests stay unchanged as the Windows ground truth.
- AC5 (a `windows-regression.yml` dispatch on the branch) runs after the last code change, outside these tasks.
- Commit messages: `{Verb} {what} — {detail}`, then a `Refs #4282` line and the `Claude-Session: https://claude.ai/code/session_01VQ5xwJKNNfTkMXnRsmxndL` trailer. Never `Fixes`/`Closes`.

## Review Focus

1. A dangling symlinked leaf (a link to a file that does not exist yet) with `O_NOFOLLOW` absent: `O_CREAT` would create the outside file. Expect a refusal and no outside file. (Task 2.)
2. `segmentsOf` on a top-level file (`release-please-config.json`): expect `[]`, so the loop checks nothing and the leaf check still runs. (Task 1.)
3. `segmentsOf` on `./` prefixes and doubled separators (`./.github//workflows/x.yml`): expect `['.github', 'workflows']`. (Task 1.)
4. A plain file written through the no-`O_NOFOLLOW` path: it must still be created, and on a rewrite truncated to the new bytes, not left with a tail of the old content. (Task 2.)
5. Platforms that do define `O_NOFOLLOW` keep the kernel path unchanged. The existing `cli.test.js:18` test covers this. (Task 2, regression check only.)

---

### Task 1: `segmentsOf` in release-bootstrap

**Files:**
- Modify: `plugin/bin/lib/init/release-bootstrap.js:456-470` (and `module.exports` at :472)
- Test: `tests/bin-lib/init/release-bootstrap.test.js`

**Interfaces:**
- Produces: `segmentsOf(rel: string, pathImpl = path): string[]`. These are the directory segments of `rel`, with the leaf excluded: `pathImpl.dirname(rel)` split on `/[\\/]/`, with `.` and empty segments dropped. Exported from the module.

- [ ] **Step 1: Append the failing test to `tests/bin-lib/init/release-bootstrap.test.js`**

```js
test('#4282 AC2.1 AC2.2: segmentsOf splits a relative path on both separators, under path.win32 too', () => {
  for (const rel of ['.github/workflows/release-please.yml', '.github\\workflows\\release-please.yml']) {
    assert.deepEqual(rb.segmentsOf(rel, path.win32), ['.github', 'workflows'], rel);
  }
  assert.deepEqual(rb.segmentsOf('.github/workflows/release-please.yml', path.posix), ['.github', 'workflows']);
  assert.deepEqual(rb.segmentsOf('./.github//workflows/x.yml', path.posix), ['.github', 'workflows']);
  assert.deepEqual(rb.segmentsOf('release-please-config.json', path.win32), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="#4282" tests/bin-lib/init/release-bootstrap.test.js`
Expected: FAIL after Step 1, with `rb.segmentsOf is not a function`

- [ ] **Step 3: Implement `segmentsOf(rel, pathImpl = path)` in `plugin/bin/lib/init/release-bootstrap.js`**

Use it in `assertSafeWriteTarget` instead of the `dirRel.split(path.sep)` line, and export it. Leave the rest of the loop and the leaf check unchanged.

- [ ] **Step 4: Run test to verify it passes, and prove it goes red**

Run: `node --test tests/bin-lib/init/release-bootstrap.test.js`
Expected: PASS, every test.
Then change the split in a scratch copy back to `pathImpl.dirname(rel).split(pathImpl.sep)` and rerun. The `#4282` test must fail on the `/`-form win32 case (AC4.1, AC4.2 first half). Restore the copy afterwards.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/init/release-bootstrap.js tests/bin-lib/init/release-bootstrap.test.js
git commit -m "Split release-bootstrap's write-target path on both separators — on win32 a '/'-separated rel left one segment, so a symlinked .github was never lstat'd"
```

### Task 2: `writeInsideRoot` without `O_NOFOLLOW`

**Files:**
- Modify: `plugin/bin/release-local.js:278-305` (the comment above `writeInsideRoot` and the function)
- Test: `tests/bin-lib/release-local/cli.test.js`

**Interfaces:**
- Produces: `writeInsideRoot(root: string, p: string, text: string, { constants = fs.constants } = {}): void`. The existing caller in `defaultDeps` (`writeInsideRoot(root, p, text)`) stays unchanged.

- [ ] **Step 1: Append the failing test to `tests/bin-lib/release-local/cli.test.js`**

```js
test('#4282 AC3.1 AC3.2: writeInsideRoot refuses a symlinked leaf when O_NOFOLLOW is absent, and still writes a plain file', () => {
  const noFollow = { constants: { ...fs.constants, O_NOFOLLOW: undefined } };
  const root = mkTmpDir('release-local-root-');
  const outside = mkTmpDir('release-local-outside-');
  fs.writeFileSync(path.join(outside, 'victim.json'), '{"version": "1.2.0"}');
  fs.symlinkSync(path.join(outside, 'victim.json'), path.join(root, 'linked.json'));
  assert.throws(() => writeInsideRoot(root, 'linked.json', 'x', noFollow), /refusing to write linked\.json: it is a symlink/);
  assert.strictEqual(fs.readFileSync(path.join(outside, 'victim.json'), 'utf8'), '{"version": "1.2.0"}');
  fs.symlinkSync(path.join(outside, 'not-yet.json'), path.join(root, 'dangling.json'));
  assert.throws(() => writeInsideRoot(root, 'dangling.json', 'x', noFollow), /refusing to write dangling\.json: it is a symlink/);
  assert.ok(!fs.existsSync(path.join(outside, 'not-yet.json')));
  writeInsideRoot(root, 'plain.json', '{"version": "1.3.0"}', noFollow);
  writeInsideRoot(root, 'plain.json', 'short', noFollow);
  assert.strictEqual(fs.readFileSync(path.join(root, 'plain.json'), 'utf8'), 'short');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="#4282" tests/bin-lib/release-local/cli.test.js`
Expected: FAIL after Step 1, with `Missing expected exception`, because the symlinked leaf is followed and written

- [ ] **Step 3: Implement the fallback in `writeInsideRoot` in `plugin/bin/release-local.js`**

When `typeof constants.O_NOFOLLOW === 'number'`, keep today's open (`O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW`, with ELOOP/EMLINK mapped to the symlink error).

Otherwise:
1. `lstatSync` the leaf (`path.join(realDir, basename)`). If it exists and is a symlink, throw the symlink error.
2. Open with `O_WRONLY | O_CREAT` and no `O_TRUNC`.
3. Compare `fstatSync(fd)` against `lstatSync(leaf)`. On a mismatch, or if the lstat is now a symlink, close the fd and throw the symlink error.
4. `ftruncateSync(fd, 0)` and write.

Truncating only after the identity check means a file swapped in during the window is never cut short. Rewrite the comment above the function to state both paths.

- [ ] **Step 4: Run test to verify it passes, and prove it goes red**

Run: `node --test tests/bin-lib/release-local/cli.test.js`
Expected: PASS, every test, including the unchanged `writeInsideRoot: refuses a symlinked leaf …` test (the `O_NOFOLLOW` path).
Then remove the fallback's two checks (the pre-open `lstat` and the post-open `fstat`/`lstat` comparison) in a scratch copy and rerun. The `#4282` test must fail (AC4.2 second half). Restore the copy afterwards. Then run both files together, which is AC1.1: `node --test tests/bin-lib/init/release-bootstrap.test.js tests/bin-lib/release-local/cli.test.js`, with every test passing.

Waived AC5.1: the `windows-regression.yml` dispatch runs after the last code change, from `/claude-tweaks:flow`'s test/review phase, not inside a task.
Waived AC5.2: a scope note (`release-bootstrap.test.js:503` is class E, tracked separately), not a behavior to test.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/release-local.js tests/bin-lib/release-local/cli.test.js
git commit -m "Refuse a symlinked leaf in release-local's writeInsideRoot when the platform has no O_NOFOLLOW — lstat before the open, fstat/lstat identity after, truncate only once verified"
```
