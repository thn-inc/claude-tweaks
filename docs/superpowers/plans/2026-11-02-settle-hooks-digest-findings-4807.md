# Settle 4 Hooks Digest Findings (#4807) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle the four below-floor `hooks` findings promoted from digest #1426 into record #4807.

**Architecture:** One behavior fix in `resolve()`'s standalone mint branch (no double `-standalone` suffix), one safety-gate comment in `checkResumeFreshness`, and test-only work on `closedPrMatch`'s supersede rule plus a reworded #208 twin test. No new modules, no interface changes.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `node:assert`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T073800-record-4807/work/4807-spec.md`

## Global Constraints

- Commit message style: `{Verb} {what} — {detail}` (imperative, no conventional-commit prefix); body carries `refs #4807` — never `closes`/`fixes`.
- "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Governing project skill `prose-code-twin-pin` (names `bin/lib/hooks/run-dir-resolve.js`): "When either side changes, also grep the flag or function name across `plugin/skills/` and `docs/` for sentences that restate the old rule". The reference snippet in `plugin/skills/_shared/run-dir-resolution.md` builds `${TS}-${STANDALONE_SKILL}-standalone` from a bare skill name only (`STANDALONE_SKILL` is never `-standalone`-suffixed), so it needs no change; `plugin/skills/_shared/pipeline-run-dir.md:39-40` describes the `--standalone <name>` shape and does.
- AC2 ("Each promoted entry line in #1426 carries this record's ref") is already satisfied — verified: all four #1426 entry lines end `→ #4807`. Waived AC2.1: already satisfied before build, nothing to change.

## Review Focus

1. `--standalone` given a name that already ends in `-standalone` (e.g. `backlog-standalone`) → mints `{ts}-backlog-standalone`, not `{ts}-backlog-standalone-standalone` (Task 1 test).
2. `--standalone` given a plain name (`tidy`) → still mints `{ts}-tidy-standalone` (existing test at line 438 keeps pinning it).
3. A name merely containing `standalone` mid-string (`standalone-x`) → still suffixed: `{ts}-standalone-x-standalone` (Task 1 test).
4. A newer live run `active` with its recorded worktree gone (step 2 refuses it) must still supersede an older closed match under `--archived` (Task 2 test).
5. Two newer non-closed live runs → the refusal names the newest, not the first seen (Task 2 test).

---

### Task 1: Do not double the `-standalone` suffix

**Files:**
- Modify: `plugin/bin/lib/hooks/run-dir-resolve.js:336-340` (comment + dir name)
- Modify: `plugin/skills/_shared/pipeline-run-dir.md:39-40` (shape description)
- Test: `tests/hooks-run-dir-resolve.test.js` (new test after the one at line 438)

**Interfaces:**
- Consumes: `resolve(opts)` — unchanged signature.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing test** (insert after the test ending at line 450)

```js
// #4807: a caller passing a name already ending in `-standalone` (seen 3 times in ~1000 runs,
// e.g. `--standalone backlog-standalone`) minted `{ts}-backlog-standalone-standalone`.
test('AC1.1 #4807: --standalone with a name already ending in -standalone is not suffixed twice', () => {
  const main = gitRepo();
  const now = new Date('2026-03-04T05:06:07Z');
  const out = resolve({ cwd: main, env: {}, standalone: 'backlog-standalone', create: true, now });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.created, true);
  assert.strictEqual(path.basename(out.path), '2026-03-04T050607-backlog-standalone');
  assert.ok(fs.statSync(path.join(out.path, 'staged')).isDirectory());
  // Only a trailing `-standalone` segment counts: a mid-name occurrence is still suffixed.
  const mid = resolve({ cwd: gitRepo(), env: {}, standalone: 'standalone-x', create: true, now });
  assert.strictEqual(path.basename(mid.path), '2026-03-04T050607-standalone-x-standalone');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="4807" tests/hooks-run-dir-resolve.test.js`
Expected: FAIL — actual `2026-03-04T050607-backlog-standalone-standalone`.

- [ ] **Step 3: Implement in `run-dir-resolve.js`'s `if (opts.standalone)` branch**

Build the name as `opts.standalone` when it already ends in `-standalone`, else `` `${opts.standalone}-standalone` ``; the `path.join(pipelinesRoot, `${formatTimestamp(now)}-${name}`)` line uses it. Extend the comment above it (line 337) with one clause: a `{name}` already ending in `-standalone` is used as-is (#4807). In `pipeline-run-dir.md` line 40, after `` `{ISO-timestamp}-{name}-standalone/` `` add: `` (a `{name}` already ending in `-standalone` is not suffixed twice) ``.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/hooks-run-dir-resolve.test.js`
Expected: PASS, 0 failures (includes the line-438 `tidy` case and the #2838/#4151 `-standalone` mint cases).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/run-dir-resolve.js plugin/skills/_shared/pipeline-run-dir.md tests/hooks-run-dir-resolve.test.js
git commit -m "Stop doubling the -standalone run-dir suffix — a name already ending in it is used as-is" -m "refs #4807"
```

### Task 2: Pin `closedPrMatch`'s supersede rule and reword the #208 twin test

**Role:** integration

**Files:**
- Test: `tests/hooks-run-dir-resolve.test.js:640-650` (reword), new tests after the one ending at line 747
- Read only: `plugin/bin/lib/hooks/run-dir-resolve.js:155-200` — mutants are applied as scratch edits and reverted; the file is not committed by this task.

**Interfaces:**
- Consumes: `resolve(opts)`, the file's `mkRunDir`/`mkArchived`/`writeRunState` helpers.
- Produces: nothing.

- [ ] **Step 1: Add the two supersede tests** (after the test ending at line 747)

```js
// #4807: the supersede rule was pinned only by a newer `interrupted` run. An `active` run step 2
// refuses (its recorded worktree is gone) is just as open, and with two open runs the newest is named.
test('AC1.1 #4807: --archived refuses an older closed match when a newer live run is active with its worktree gone', () => {
  const main = gitRepo();
  writeRunState(mkArchived(main, '2026-01-01T000000-spec-64'), { status: 'clean', pr: { number: 20, url: 'u' } });
  writeRunState(mkRunDir(main, '2026-02-01T000000-spec-64'), {
    status: 'active', worktree: path.join(main, '.claude', 'worktrees', 'gone-spec-64'), pr: { number: 21, url: 'u' },
  });
  const out = resolve({ cwd: main, env: {}, specSlug: 'spec-64', archived: true });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'archived-superseded');
  assert.match(out.message, /2026-02-01T000000-spec-64/);
  assert.match(out.message, /status active/);
});

test('AC1.1 #4807: with two newer open live runs, --archived names the newest as the superseder', () => {
  const main = gitRepo();
  writeRunState(mkArchived(main, '2026-01-01T000000-spec-65'), { status: 'clean', pr: { number: 22, url: 'u' } });
  writeRunState(mkRunDir(main, '2026-02-01T000000-spec-65'), { status: 'interrupted', worktree: null });
  writeRunState(mkRunDir(main, '2026-03-01T000000-spec-65'), { status: 'interrupted', worktree: null });
  const out = resolve({ cwd: main, env: {}, specSlug: 'spec-65', archived: true });
  assert.strictEqual(out.reason, 'archived-superseded');
  assert.match(out.message, /2026-03-01T000000-spec-65/);
  assert.doesNotMatch(out.message, /2026-02-01T000000-spec-65/);
});
```

- [ ] **Step 2: Run them — they pin existing behavior, so they pass**

Run: `node --test --test-name-pattern="4807" tests/hooks-run-dir-resolve.test.js`
Expected: PASS for both new tests.

- [ ] **Step 3: Prove each test discriminates against its own mutant (scratch, reverted)**

Mutant A — in `closedPrMatch`, change line 187's `else newestOpen = ...` to `else if (state.status === 'interrupted') newestOpen = ...`. Run the Step 2 command: the active-superseder test FAILS, the two-open test passes. Revert.
Mutant B — change it to `else newestOpen = newestOpen || { name, status: state.status };`. Run: the two-open test FAILS, the active test passes. Revert.
Confirm with `git diff --stat plugin/bin/lib/hooks/run-dir-resolve.js` that the source carries no mutant (only Task 1's change vs base).

- [ ] **Step 4: Reword the #208 twin test (lines 640-641)**

Replace the comment and name so they state what it pins: the outcome (both twins record a `pr` → the archived copy is returned), reached because `archiveStatus` drops the live twin before the candidate sort; the archived-first name-tie comparator is reachable only when `archiveStatus` reads `unknown`, which no fixture here produces; the spec-56 case below discriminates the filter alone. New name: `'#4677 #208: a live clean dir with an archived twin (both recording a pr) resolves to the archived copy'`. Body unchanged.

- [ ] **Step 5: Run the suite**

Run: `node --test tests/hooks-run-dir-resolve.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add tests/hooks-run-dir-resolve.test.js
git commit -m "Pin closedPrMatch's supersede rule — active-superseder and two-open-runs cases, reworded #208 twin test" -m "refs #4807"
```

### Task 3: Cross-reference the `lstatType` safety gate to #4435

**Role:** transcription

**Files:**
- Modify: `plugin/bin/lib/hooks/resume-freshness.js:73` (comment only)

**Interfaces:** none.

- [ ] **Step 1: Add a comment directly above line 73**

Two to three lines: `missing` here is path-guard's ENOENT/ENOTDIR only — do not simplify back to `fs.existsSync`, which also returns false on EACCES/ELOOP/EIO and would read an unreadable worktree path as `worktree-gone`, resuming an interrupted run over a possibly live one (#4435). An unreadable path falls through to `runLiveness`, whose `error` entry blocks as `indeterminate`.

- [ ] **Step 2: Run the suite**

Run: `node --test tests/hooks-resume-freshness.test.js tests/path-guard-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 3: Commit**

```bash
git add plugin/bin/lib/hooks/resume-freshness.js
git commit -m "Cross-reference resume-freshness's lstatType gate to #4435 — keep a simplification from reopening it" -m "refs #4807"
```
