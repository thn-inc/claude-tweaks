# Test-impact on Windows (#4134) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make test-impact tracing work on win32, and keep a large `--files-from` subset from overflowing the Windows command line.

**Architecture:** A new helper, `requireOption(p, pathImpl = path)` in `tools/test-impact/node-options.js`, builds the NODE_OPTIONS `--require "<path>"` entry from a forward-slashed path. Every site that currently writes `--require "${nativePath}"` uses it. `tools/run-tests.js` gets a pure `subsetFallbackReason(execPath, args, { platform })`. On win32, when an explicit subset's command line would reach the 32,767-character limit, the main block logs the named reason and runs the full suite (root globs) instead.

**Tech Stack:** Node (CommonJS), `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T154041-record-4134/work/4134-spec.md`

Scope keywords: --require "${

A first audit pass with the broader keywords `NODE_OPTIONS` and `--require "` matched these files too. Each was reviewed and left unchanged, because none composes a quoted native `--require` path; the keyword was narrowed to the composing shape:
- `tools/test-impact/tracer.js`: reads the token from `CT_TRACE_REQUIRE` and never builds a path.
- `tests/fixtures/test-impact/b.fixture.js`, `tests/bin-lib/verify/baseline.test.js`, `tests/bin-lib/verify/file-template.test.js`: unrelated `NODE_OPTIONS` mentions.
- Two earlier plans: historical.

## Global Constraints

- The helper forward-slashes with `toPosix(p, pathImpl.sep)` (`plugin/bin/lib/shared-primitives.js`), with `pathImpl` defaulting to `path`. It always keeps the double quotes, since a path may contain a space.
- Pin: `requireOption('D:\\a\\x y\\tracer.js', path.win32)` returns exactly `--require "D:/a/x y/tracer.js"`.
- The win32 command-line limit is 32,767 characters (`WIN32_COMMAND_LINE_MAX = 32767`, #3316).
- Only these four sites compose a quoted native `--require` path: `tools/test-impact.js:145`, `tests/test-impact-tracer.test.js:39`, `:202` and `:250`. All four use the helper, plus the two test-side copies in `tests/test-impact-cli.test.js` (`:169` expectation, `:479` fail preload).

## Review Focus

- A POSIX path containing a literal backslash. `toPosix` with sep `/` returns it unchanged, so POSIX behavior is byte-identical to today. Task 1's pin covers `path.posix`.
- Tracer dedupe (`tools/test-impact/tracer.js:311`, `opts.includes(REQ)`) depends on `CT_TRACE_REQUIRE` and NODE_OPTIONS carrying the identical token. Task 2's unit test asserts both equal `requireOption(...)`.
- A subset exactly at the limit. `length >= 32767` falls back, because the NUL terminator counts. Task 3 pins both sides of the boundary.
- Falling back must move the run to the full-suite slot lane, not the subset lane. The fallback reassigns `roots` before the `slotLane(..., roots === null)` call. The Task 3 process test asserts root-glob args.
- A win32 fallback on Node < 22 still reaches `buildTestArgs`'s existing "Node >= 22" error. That is acceptable: the message is explicit. No new test.

---

### Task 1: `requireOption` helper + pin

**Files:**
- Create: `tools/test-impact/node-options.js`
- Test: `tests/test-impact-cli.test.js`

**Interfaces:**
- Produces: `requireOption(p: string, pathImpl = path): string` → `` `--require "${toPosix(p, pathImpl.sep)}"` ``; `module.exports = { requireOption }`.

- [ ] **Step 1: Write the failing test** (in `tests/test-impact-cli.test.js`, after the requires; require `path.join(ROOT, 'tools', 'test-impact', 'node-options.js')`):

```js
test('#4134 absorbed helper pin: requireOption forward-slashes a win32 path and keeps the quotes for its space', () => {
  assert.strictEqual(requireOption('D:\\a\\x y\\tracer.js', path.win32), '--require "D:/a/x y/tracer.js"');
  assert.strictEqual(requireOption('/a/x y/tracer.js', path.posix), '--require "/a/x y/tracer.js"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/test-impact-cli.test.js`
Expected: FAIL (Cannot find module `node-options.js`)

- [ ] **Step 3: Implement `requireOption` in `tools/test-impact/node-options.js`.** Require `toPosix` from `../../plugin/bin/lib/shared-primitives`. Add a header comment explaining why: Node's NODE_OPTIONS parser treats `\` inside double quotes as an escape, so a native win32 path loses its backslashes, while Node's `require` accepts `/` on win32.

- [ ] **Step 4: Run test to verify it passes.** Run the same command. Expected: PASS. Go-red: temporarily replace `toPosix(p, pathImpl.sep)` with `p`. The win32 assertion fails. Restore it.

- [ ] **Step 5: Commit** — `git add tools/test-impact/node-options.js tests/test-impact-cli.test.js`, message `Add requireOption NODE_OPTIONS helper — forward-slashed tracer path for win32 (refs #4134)`.

### Task 2: Use the helper everywhere and lift the win32 skips

**Files:**
- Modify: `tools/test-impact.js:145-150` (use `requireOption(path.join(root, 'tools', 'test-impact', 'tracer.js'))`; rewrite the comment so it no longer says tracing is POSIX-only)
- Modify: `tests/test-impact-tracer.test.js` (lines 39, 202, 250: `requireOption(TRACER)`, `requireOption(path.join(root, 'freeze-readdir.js'))`, `requireOption(path.join(root, 'fail-trace-append.js'))`)
- Modify: `tests/test-impact-cli.test.js:169` (expected `req` = `requireOption(path.join(dir, 'tools', 'test-impact', 'tracer.js'))`), `:479` (`NODE_OPTIONS: requireOption(fail)`), `:451-453` and `:473` (drop both `skip:` options and the POSIX-only comment)

**Interfaces:**
- Consumes: `requireOption` from Task 1.

- [ ] **Step 1: Make the edits above.** The file header of `tests/test-impact-tracer.test.js` names no POSIX limit, so leave it alone.
- [ ] **Step 2: Verify.** Run: `node --test tests/test-impact-cli.test.js tests/test-impact-tracer.test.js`. Expected: PASS, with 0 skipped among the two end-to-end trace tests (the TAP shows no `# SKIP tracing is POSIX-only`).
- [ ] **Step 3: Confirm no quoted native `--require` remains.** Run: `git grep -n -e '--require \\"\${' -- tools tests`. Expected: no output.
- [ ] **Step 4: Commit** — message `Route every NODE_OPTIONS --require through requireOption and lift the win32 trace skips (refs #4134)`.

AC1.1 (win32 trace produces a map, and the Windows job runs the end-to-end test) is proven by the `windows-regression.yml` dispatch at the test step, the same as absorbed AC1.1. No Linux test can show it. Waived AC1.1 here: verified by the workflow dispatch, not by a committed test.

### Task 3: Bound a win32 `--files-from` subset

**Files:**
- Modify: `tools/run-tests.js` (header comment, around lines 12-20; new pure helper after `buildTestArgs`; main block around lines 431-441; `module.exports`)
- Create: `tests/fixtures/run-tests/win32-node22-spawn-capture-preload.js`
- Test: `tests/run-tests-isolation.test.js`

**Interfaces:**
- Produces: `WIN32_COMMAND_LINE_MAX = 32767`. `subsetFallbackReason(execPath: string, args: string[], { platform }): string | null` returns null off win32, or when `[execPath, ...args].reduce((n, a) => n + a.length + 3, 0) - 1 < WIN32_COMMAND_LINE_MAX`. That sum counts two quotes and a separator per arg. Otherwise it returns `` `a ${args.length - 2}-file subset needs a ${len}-character command line, over the Windows limit of ${WIN32_COMMAND_LINE_MAX}` ``. Both are exported.
- Main block: after `testArgs` is built and `roots === null`, if a reason comes back, print `` `run-tests.js: --files-from ${argv[1]}: ${reason} — running the full suite instead.` `` to stderr. Then set `roots = DEFAULT_ROOTS`, set `files = listTestFiles(REPO_ROOT, roots).map(relative)`, and rebuild `testArgs` inside the same try/catch.

- [ ] **Step 1: Write the failing unit tests** in `tests/run-tests-isolation.test.js`:

```js
test('#4134 AC2.1: subsetFallbackReason is null for a subset that fits, and off win32 for any size', () => {
  const args = ['--test', '--test-concurrency=2', 'tests/a.test.js'];
  assert.strictEqual(subsetFallbackReason('C:\\node.exe', args, { platform: 'win32' }), null);
  const huge = ['--test', '--test-concurrency=2', ...Array.from({ length: 2000 }, (_, i) => `tests/${'a'.repeat(30)}${i}.test.js`)];
  assert.strictEqual(subsetFallbackReason('/usr/bin/node', huge, { platform: 'linux' }), null);
});

test('#4134 AC2.1: subsetFallbackReason names the length and the limit once the line reaches 32,767 characters', () => {
  // build args whose computed length is exactly 32766 (fits) and 32767 (falls back)
  // assert null vs. /2-file subset needs a 32767-character command line, over the Windows limit of 32767/
});
```

The boundary test builds `['--test', '--test-concurrency=2', 'x'.repeat(k)]` with `k` chosen so the formula gives 32766 and then 32767. The arg count in the message is `args.length - 2` = 1, so the expected text is `a 1-file subset`.

- [ ] **Step 2: Write the failing process test.** The preload fixture fakes `process.platform = 'win32'` and Node `22.0.0`, like `win32-node20-preload.js`. It replaces `child_process.spawn` with a stub that writes `` `SPAWN-ARGS: ${JSON.stringify(args)}\n` `` to stderr and calls `process.exit(0)`. Test: `'#4134 AC2.1: a win32 --files-from subset too long for the command line runs the full suite with a named reason'`. Reuse `withSandbox`. Build a temp repo root holding `tools/run-tests.js`, a copy of the runner, and 400 files `tests/${'a'.repeat(90)}${i}.test.js`. Point a list at all 400 and run `node -r <preload> <runner> --files-from <list>` with `CT_TEST_SUITE_SLOT_HELD=1`. Assert exit 0, that stderr matches `/--files-from .*: a 400-file subset needs a \d+-character command line, over the Windows limit of 32767 — running the full suite instead\./`, and that the `SPAWN-ARGS` JSON ends with `tests/**/*.test.js` and `tools/upstream-drift/tests/**/*.test.js` and contains no listed file.

- [ ] **Step 3: Run to verify failure.** Run: `node --test tests/run-tests-isolation.test.js`. Expected: FAIL (`subsetFallbackReason is not a function`; the process test sees the file-list args).
- [ ] **Step 4: Implement** the helper, the export and the main-block wiring above. Update the header comment: on Windows an explicit subset whose command line would overflow falls back to the full suite with a named reason.
- [ ] **Step 5: Verify.** Run: `node --test tests/run-tests-isolation.test.js tests/package-json-test-script.test.js`. Expected: PASS.
- [ ] **Step 6: Commit** — message `Fall back to the full suite when a win32 --files-from subset overflows the command line (refs #4134)`.

### Task 4: Docs

**Files:**
- Modify: `plugin/skills/test/impact-selection.md:88` (delete the `**POSIX only.**` Known-limits bullet)
- Modify: `docs/plugin-structure.md:76` (in the `tools/` row's run-tests.js clause, after "runs only the listed files — verify.js's impact subset, #4024", add "; on win32 a subset whose command line would overflow runs the full suite with a named reason, #4134")

- [ ] **Step 1: Edit both.** Pin check: `git grep -n -i "POSIX only" -- tests plugin` found no test reading this bullet. The only tests reading `impact-selection.md` are `tests/test-impact-cli.test.js` (comment only, removed in Task 2) and `tests/test-skill-affected-conformance.test.js` (pins `(impact-selection.md)` in another file).
- [ ] **Step 2: Verify.** `node --test tests/test-skill-affected-conformance.test.js` should PASS. `grep -c "POSIX only" plugin/skills/test/impact-selection.md` should print `0` (AC3.1).
- [ ] **Step 3: Commit** — message `Drop the POSIX-only tracing limit from impact-selection.md (refs #4134)`.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1, AC1.1 (win32 trace, lift skip) | 1, 2; AC1.1 proven by the windows-regression dispatch |
| Deliverable 2, AC2.1 (subset bound + named reason) | 3 |
| Deliverable 3, AC3.1 (doc limit removed) | 4 |
| Absorbed deliverables 1-2, absorbed AC1.1 (20 tracer tests on windows-regression) and AC2.1 (helper pin) | 1, 2; absorbed AC1.1 by the dispatch |
