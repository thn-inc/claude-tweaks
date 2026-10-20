# Review Pre-Dispatch Baseline Capture (#3302) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `build-review-context.js build` writes `/review` Step 3's pre-dispatch baselines into `{ctx-dir}` itself, so a worktree-isolated reviewer never has to write a file under `{ctx-dir}` by hand.

**Architecture:** `buildContext` (`plugin/bin/lib/review-context/build.js`) gains two writes next to its existing `context.md` write: `pre-dispatch-status.txt` (from `git status --porcelain --untracked-files=all`, run with `cwd` = the repo toplevel it already resolves) and `pre-dispatch-listeners.txt` (from `lsof +c 0 -nP -iTCP -sTCP:LISTEN`, through a new injectable `lsof` seam). Their paths come back as `baselinePath` / `listenersPath` in the JSON line the CLI already prints. `step3-lens-dispatch.md` then reads those files instead of telling the reviewer to redirect into them.

**Tech Stack:** Node 18+ CommonJS, `node:child_process` `execFileSync`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T145117-record-3302/work/3302-spec.md` (GitHub issue #3302)

**Scope note (logged to decisions.md as scope-creep `add-to-plan`):** the AC "`step3-lens-dispatch.md` no longer tells the reviewer to write any file under `{ctx-dir}` by hand" also covers the `lsof … > {ctx-dir}/pre-dispatch-listeners.txt` redirect in the same paragraph, which the Deliverables do not name. It fails the same way in a worktree-isolated session, so the CLI captures it too.

Scope keywords: pre-dispatch-status, pre-dispatch-listeners, baselinePath, listenersPath

## Global Constraints

- Baseline file: `{ctx-dir}/pre-dispatch-status.txt`, content = the stdout of `git status --porcelain --untracked-files=all` run with cwd set to the branch's worktree (the `git rev-parse --show-toplevel` value `buildContext` already computes as `root`).
- Printed JSON gains `baselinePath` (the AC names it, e.g. a `baselinePath` field) and `listenersPath`.
- `plugin/skills/review/step3-lens-dispatch.md` is 48483 bytes against a 52500-byte `RAIL_BYTES` rail (92%). Task 2's edit must not grow it: `wc -c` after the edit ≤ 48483.
- Commit messages: `{Verb} {what} — {detail}` with a `refs #3302` line, never `closes`/`fixes`.
- Never write any file under `{ctx-dir}` by hand in the skill prose (AC).

## Review Focus

1. `lsof` absent (Windows, a minimal Linux CI container): `build` must not throw; `listenersPath` is `null` and no listener file is written. Covered by the `realLsof` ENOENT test in Task 1.
2. `lsof` exits 1 with empty output (no listeners): this is "no listeners", not a failure. An empty file is written and `listenersPath` is non-null. Covered by the `realLsof` status-1 test in Task 1.
3. CLI invoked from a subdirectory of the checkout (#3017's shape): the status capture still runs at the toplevel. Covered by the `cwd` assertion test in Task 1.
4. Untracked files that exist before review starts must appear in the baseline, so the sweep does not report them as leftovers. Covered by the fixture test in Task 1 (an untracked `scratch.txt` must appear as `?? scratch.txt`).
5. `--dir {ctx-dir}` reuse of a dir Step 2.5 minted: the baseline lands in that same dir. Covered by the CLI `--dir` test in Task 1.

---

### Task 1: Capture both baselines in `buildContext` and report their paths

**Files:**
- Modify: `plugin/bin/lib/review-context/build.js` (`buildContext`, new `realLsof`, exports)
- Modify: `plugin/bin/build-review-context.js` (header comment's JSON shape only, lines 6-7)
- Test: `tests/bin-lib/review-context/build.test.js`

**Interfaces:**
- Produces: `realLsof({ exec = execFileSync } = {}) -> string | null`. It runs `lsof +c 0 -nP -iTCP -sTCP:LISTEN` with `{ encoding: 'utf8', windowsHide: true }` and returns stdout. It catches errors this way: `err.code === 'ENOENT'` returns `null`; `err.status === 1` returns `err.stdout || ''` (exit 1 means no matches); anything else returns `null`.
- Produces: `buildContext({ ..., lsof = realLsof })` gains two return fields. `baselinePath` (string) is `path.join(dir, 'pre-dispatch-status.txt')`, always written. `listenersPath` (string or `null`) is `path.join(dir, 'pre-dispatch-listeners.txt')` when `lsof()` returned a string (which is written to that file), and `null` when it returned `null` (no file written).
- `module.exports` adds `realLsof`.

- [ ] **Step 1: Write the failing tests** in `build.test.js`. First add `lsof: () => ''` to the `repoDeps(repo)` helper so the existing fixture tests stay hermetic.
  - `test('3302: build writes the git status baseline into {ctx-dir} and reports baselinePath')`. Fixture via `makeFixtureRepo()`, then `fs.writeFileSync(path.join(repo, 'scratch.txt'), 'x\n')` (untracked). Call `buildContext({ base: 'main', branch: 'feature', dir, ...repoDeps(repo) })`. Assert `result.baselinePath === path.join(dir, 'pre-dispatch-status.txt')`. Assert `fs.readFileSync(result.baselinePath, 'utf8') === git(repo, ['status', '--porcelain', '--untracked-files=all'])`. Assert that content matches `/^\?\? scratch\.txt$/m`.
  - `test('3302: the status capture runs with cwd at the repo toplevel')`. Fake `git: (args, opts) => { calls.push({ args, opts }); if (args.includes('rev-parse')) return '/x\n'; return ''; }` plus `readFile: () => ''`, `lsof: () => ''`. Assert that the call whose `args` deep-equals `['status', '--porcelain', '--untracked-files=all']` has `opts.cwd === '/x'`.
  - `test('3302: listener snapshot is written when lsof returns a listing, null when unavailable')`. With `lsof: () => 'COMMAND PID\nnode 1 … TCP *:3000 (LISTEN)\n'`, assert `listenersPath === path.join(dir, 'pre-dispatch-listeners.txt')` and the file content equals that string. With `lsof: () => ''`, assert the file exists and is empty. With `lsof: () => null` (fresh dir), assert `listenersPath === null` and `!fs.existsSync(path.join(dir, 'pre-dispatch-listeners.txt'))`.
  - `test('3302: realLsof classifies lsof outcomes')`. With `exec` returning `'L\n'`, expect `'L\n'`. With `exec` throwing `Object.assign(new Error('x'), { code: 'ENOENT' })`, expect `null`. With `exec` throwing `{ status: 1, stdout: '' }`, expect `''`. With `exec` throwing `{ status: 2, stdout: '' }`, expect `null`. Also assert that the argv `exec` received is `['+c', '0', '-nP', '-iTCP', '-sTCP:LISTEN']` with file `'lsof'`.
  - Extend `CLI end-to-end: build from a fixture checkout…`. After building with `--dir dir`, assert `parsed.baselinePath === path.join(dir, 'pre-dispatch-status.txt')` and that the file exists.
  - `test('3302 AC: build --run writes <run>/review-ctx/pre-dispatch-status.txt matching git status')`. Fixture repo with an untracked `scratch.txt` and `run = fs.mkdtempSync(...)` outside the repo. Run `execFileSync('node', [CLI, 'build', '--base', 'main', '--branch', 'HEAD', '--run', run], { cwd: repo, encoding: 'utf8' })`. Assert `parsed.baselinePath === path.join(run, 'review-ctx', 'pre-dispatch-status.txt')` and that its content equals `git(repo, ['status', '--porcelain', '--untracked-files=all'])`, read after the call.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/review-context/build.test.js`
Expected: FAIL. The new `3302` tests fail on `result.baselinePath` being `undefined` and on `realLsof` not being a function.

- [ ] **Step 3: Implement** in `build.js`. Add `realLsof` as specified in Interfaces. In `buildContext`, after `root` is resolved and before the `context.md` write, run `git(['status', '--porcelain', '--untracked-files=all'], { cwd: root })` and write the result to `baselinePath`. Then call `lsof()` and write `listenersPath` when it returns a string. Use the existing `writeFile` seam for both. Add both fields to the returned object, after `oversizeSections`. Update the comment block above `buildContext` with one sentence naming the two baseline files. In `build-review-context.js`, update the header comment's build JSON shape to `{dir, contextPath, bytes, files, emptySections, oversizeSections, baselinePath, listenersPath}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/review-context/build.test.js tests/bin-lib/review-context/exit-code.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/review-context/build.js plugin/bin/build-review-context.js tests/bin-lib/review-context/build.test.js
git commit -m "Capture review pre-dispatch baselines in build-review-context — status and listener snapshots written by the CLI (refs #3302)"
```

### Task 2: Point the review prose at the CLI-written baselines

**Files:**
- Modify: `plugin/skills/review/step3-lens-dispatch.md` (line 70 JSON-shape sentence; line 74 "Pre-dispatch listing" paragraph; line 155/164 sweep paragraphs only if a phrase still implies a hand write)
- Modify: `docs/plugin-structure.md` (line 209's `build` JSON shape; line 47's `buildContext` description, adding one clause on the two baseline files)
- Modify: `docs/journeys/keep-review-lenses-from-running-suites-3001.md` (line 30: the snapshot is taken by `build-review-context.js build`, not by the reviewer)
- Test: `tests/bin-lib/review-context/prose.test.js`, `tests/review-lens-no-suites-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's JSON fields `baselinePath`, `listenersPath` (`null` means lsof unavailable).

- [ ] **Step 1: Update the pinning tests first**
  - `prose.test.js` test `AC7.1-AC7.2`: change the shape regex to `/\{dir, contextPath, bytes, files, emptySections, oversizeSections, baselinePath, listenersPath\}/`.
  - `prose.test.js`: add `test('3302 AC: step3-lens-dispatch.md never tells the reviewer to write a file under {ctx-dir} by hand')`. Assert `!/>\s*\{ctx-dir\}\//.test(LENS_DISPATCH)`. Within the `**Pre-dispatch listing (scratch-sweep baseline).**` paragraph, also assert it names `baselinePath` and `listenersPath`.
  - `review-lens-no-suites-conformance.test.js` test `the pre-dispatch listing also snapshots local TCP listeners…`: replace the `lsof … > \{ctx-dir\}\/pre-dispatch-listeners\.txt` assertion with `assert.match(para, /lsof \+c 0 -nP -iTCP -sTCP:LISTEN/)`, `assert.match(para, /pre-dispatch-listeners\.txt/)` and `assert.doesNotMatch(para, />\s*\{ctx-dir\}/)`. Keep the existing `pre-dispatch-status.txt` and `lsof.*unavailable[\s\S]*SKIP` assertions.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/review-context/prose.test.js tests/review-lens-no-suites-conformance.test.js`
Expected: FAIL on the new shape regex and on the `>\s*\{ctx-dir\}` negative assertions.

- [ ] **Step 3: Rewrite the prose**
  - Line 70: extend the printed-shape list to `{dir, contextPath, bytes, files, emptySections, oversizeSections, baselinePath, listenersPath}`.
  - Line 74: the `build` call above already wrote both baselines, before any lens dispatch and once per review regardless of tier. These are `{ctx-dir}/pre-dispatch-status.txt` (`git status --porcelain --untracked-files=all` in the branch's worktree, printed as `baselinePath`) and `{ctx-dir}/pre-dispatch-listeners.txt` (`lsof +c 0 -nP -iTCP -sTCP:LISTEN`, printed as `listenersPath`). Keep the `+c 0` rationale. Never write either file by hand: under `--run`, `{ctx-dir}` is in the main checkout, which a worktree-isolated session cannot write. An empty listener file means no listeners. `listenersPath: null` means `lsof` is unavailable: keep the existing `SKIP {HH:MM:SS} — Review listener snapshot (skipped): lsof unavailable → leftover-listener check not run. Reversibility: n/a.` line verbatim, plus "The skip never blocks the review."
  - Lines 155/164 keep reading `{ctx-dir}/pre-dispatch-status.txt` / `{ctx-dir}/pre-dispatch-listeners.txt`, which are unchanged paths. Touch them only if wording still implies the reviewer captured the file.
  - Trim wording elsewhere in the paragraph so the file does not grow.
  - Update `docs/plugin-structure.md` lines 47/209 and the journey line 30 to match.

- [ ] **Step 4: Run tests and the size check**

Run: `node --test tests/bin-lib/review-context/prose.test.js tests/review-lens-no-suites-conformance.test.js tests/multi-agent-coordination.test.js`
Expected: PASS, 0 failures.

Run: `wc -c plugin/skills/review/step3-lens-dispatch.md`
Expected: ≤ 48483.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/step3-lens-dispatch.md docs/plugin-structure.md docs/journeys/keep-review-lenses-from-running-suites-3001.md tests/bin-lib/review-context/prose.test.js tests/review-lens-no-suites-conformance.test.js
git commit -m "Read CLI-written review baselines — step3-lens-dispatch.md drops the hand-run redirects (refs #3302)"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (CLI writes the baseline with cwd at the worktree, reports `baselinePath`) is Task 1. Deliverable 2 (prose reads the CLI file, drops the redirect) is Task 2. AC1 (`--run` writes `<run>/review-ctx/pre-dispatch-status.txt` matching `git status`) is Task 1's `3302 AC` CLI test. AC2 (no hand writes under `{ctx-dir}`) is Task 2's negative assertion. AC3 (`npm test`) is /build Common Step 5.
- **Placeholders:** none.
- **Type consistency:** `baselinePath` / `listenersPath` / `realLsof` are named the same in both tasks.
