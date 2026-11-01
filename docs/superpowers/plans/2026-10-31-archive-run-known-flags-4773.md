# archive-run Flag-Strict Guard (#4773) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `hooks.js archive-run` refuses any undeclared `--*` flag (e.g. `--dry-run`) with its usage line instead of archiving for real.

**Architecture:** `main()` in `plugin/bin/hooks.js` already runs #1012's unknown-flag guard for every verb that is a key of `KNOWN_FLAGS`; adding `archive-run` as a key is the whole behavior change. `KNOWN_FLAGS` feeds only that guard — `resolveRunArg`'s `unambiguousOnly` path is chosen per call site through `resolveOpts`, and `runArchiveRun` keeps passing `{ allowUninitialized: true }`, so implicit run resolution is unchanged.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T211139-spec-4773/work/4773-spec.md`

## Global Constraints

- Usage line is the existing `VERBS` entry, unchanged: `archive-run [--run <dir>]`.
- `archive-run --run <dir>` with no other flag behaves byte-for-byte as before.
- No change to `runArchiveRun`'s `resolveRunArg` options.
- Commit messages: `{Verb} {what} — {detail}`, `refs #4773`, ending with `Claude-Session: https://claude.ai/code/session_016yg3zrQKAz6hRNqmKyivqj`.

## Review Focus

- `--dry-run` placed **before** `--run` (`archive-run --dry-run --run <dir>`) must also refuse — `firstUnknownFlag` scans the full list; pinned by a second assertion in the Task 1 test.
- A value-looking token after `--run` that starts with `--` is never misread: `--run` is already in `VALUE_FLAGS`, so its value is skipped — no new test (existing guard behavior, unchanged).
- `--help`/`-h` still print usage — already pinned by `tests/hooks-help-guard.test.js`'s `runAccepting` loop; must stay green.
- Bare `archive-run --run <dir>` still archives — pinned by the existing `archives a clean fixture` test; must stay green.
- None further found.

---

### Task 1: Make archive-run flag-strict

**Files:**
- Modify: `plugin/bin/hooks.js:162-171` (comment above `KNOWN_FLAGS`) and the `KNOWN_FLAGS` object (add one entry)
- Test: `tests/archive-run-verb.test.js` (append one test)

**Interfaces:**
- Consumes: `runHook(args, { cwd })` → `{ code, stdout }` and `runDirFixture(status)` → `{ root, runDir, runId }`, both already in `tests/archive-run-verb.test.js`; `git(args, cwd)` helper in the same file.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing test** — append to `tests/archive-run-verb.test.js`:

```js
test('#4773: archive-run refuses an undeclared flag (--dry-run) with its usage line, before any move or commit', () => {
  for (const args of [['--run', null, '--dry-run'], ['--dry-run', '--run', null]]) {
    const { root, runDir, runId } = runDirFixture('clean');
    const headBefore = git(['rev-parse', 'HEAD'], root);
    const result = runHook(['archive-run', ...args.map((a) => (a === null ? runDir : a))], { cwd: root });
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, 'claude-tweaks: usage: archive-run [--run <dir>]\n');
    assert.ok(fs.existsSync(path.join(runDir, 'config.yml')), 'run dir must stay in place');
    assert.ok(!fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId)), 'nothing archived');
    assert.strictEqual(git(['rev-parse', 'HEAD'], root), headBefore, 'no commit');
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="#4773" tests/archive-run-verb.test.js`
Expected: FAIL — stdout contains `moved: config.yml` (the run archives).

- [ ] **Step 3: Implement** — in `plugin/bin/hooks.js` add `'archive-run': ['--run'],` to `KNOWN_FLAGS` (beside `'close-run'`), and rewrite the comment block above it: the table's membership is the mutating run-state verbs (now including `archive-run`, which moves files and commits — #4773) plus the read-only `check-pass-reentry` (#3553) and `resolve-ledger` (#3897); drop `archive-run` from the "Every other resolveRunArg caller … HELP_FLAGS-only guard" sentence; state that `archive-run` keeps its `ctxLib.resolveRunDir` fallback (the table gates flags only — `unambiguousOnly` is a per-call-site `resolveOpts` choice). Leave `main()`'s guard code untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/archive-run-verb.test.js tests/hooks-help-guard.test.js tests/hooks-dispatcher.test.js tests/hooks-archive-run-1452.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Discrimination check** — revert only the `KNOWN_FLAGS` entry, rerun Step 2's command, see it FAIL, restore the entry, rerun, see PASS.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/hooks.js tests/archive-run-verb.test.js
git commit -m "Make archive-run flag-strict — an undeclared flag such as --dry-run prints usage instead of archiving, refs #4773"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (entry) → Step 3; Deliverable 2 (header comment) → Step 3; Deliverable 3 (`unambiguousOnly` side effect) → resolved in Architecture: none, runArchiveRun's options unchanged; Deliverable 4 (test) → Step 1. AC1 → Steps 1/5; AC2 → Step 4; AC3 → verified at filing (grep), no change.
- **Placeholders:** none.
