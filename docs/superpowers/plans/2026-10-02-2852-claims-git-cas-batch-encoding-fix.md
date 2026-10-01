# readClaimBlobsGitBatch encoding crash fix (#2852) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `readClaimBlobsGitBatch`'s `cat-file --batch` call so it no longer throws `ERR_UNKNOWN_ENCODING` under the real `defaultRunner`, and add a test that exercises the real runner (not the fixture) to catch this class of bug.

**Architecture:** One-line production fix (pass `Buffer.from(...)` as `input` instead of a plain string, so Node never needs a string encoding to produce the bytes) plus one new test that drives the real exported `defaultRunner` against a real git registry tree, since the existing fixture (`realRunner`) hardcodes `encoding: 'utf8'` and silently drops the caller's `encoding: 'buffer'` override.

**Tech Stack:** Node.js, `node:test`, `node:child_process` (`execFileSync`), git plumbing (`cat-file --batch`).

**Spec:** `.claude-tweaks/pipelines/2026-10-01T221644-record-2852/work/2852-spec.md` (materialized from GitHub issue #2852)

## Global Constraints

- No change to `readClaimBlobsGitBatch`'s public signature or return shape.
- The new test must drive the real, exported `defaultRunner` — not the file's `realRunner` fixture helper, which hardcodes `encoding: 'utf8'` and cannot reproduce the bug.

## Review Focus

- A real git runner (not a fake/fixture) rejecting `encoding: 'buffer'` paired with a string `input` — the exact bug this record reports. Pinned by Task 1's new test.
- Pretty-printed (multi-line) JSON claim content surviving the batch read intact — already covered by an existing test in this file (unaffected by this change, left as regression coverage).
- The fix must not change behavior for callers passing no `encoding` override, or for the existing fixture-driven tests — verified by running the full file's suite, not just the new test.

---

### Task 1: Fix the encoding crash and add a real-runner regression test

**Status: already implemented and verified in this worktree, prior to this plan being written** (commit `028008ce5`, "Fix readClaimBlobsGitBatch encoding crash under the real git runner — refs #2852"). This plan documents the change for the record; no further implementation work is needed. Steps below are checked off to reflect the verified state — re-run Step 2/Step 4's commands if you need to re-confirm rather than re-implementing.

**Files:**
- Modify: `plugin/bin/lib/issues/claims-git-cas.js:299`
- Test: `tests/bin-lib/issues/claims-git-cas.test.js`

**Interfaces:**
- Consumes: `defaultRunner(args, opts)` (already exported from `claims-git-cas.js`), `readClaimBlobsGitBatch({ issueNumbers, tip, runner })` (unchanged signature).
- Produces: nothing new for later tasks — this is the only task in this plan.

- [x] **Step 1: Write the failing test**

```javascript
// #2852: every prior readClaimBlobsGitBatch test above drives the batch call
// through this file's own `realRunner` fixture helper, which hardcodes
// `encoding: 'utf8'` on every execFileSync call and so silently drops the
// production `defaultRunner`'s `...opts` passthrough of the caller's
// `encoding: 'buffer'` override — the fixture can't reproduce the bug it's
// supposed to guard against. This test runs through the real, exported
// `defaultRunner` (cwd-bound the same way the fixtures above bind
// `realRunner`) against a real registry tree instead, so it actually
// exercises the `cat-file --batch` call's `input`/`encoding` combination
// production code hits.
test('readClaimBlobsGitBatch: real defaultRunner (not the fake/fixture runner) returns content, not transport-failure', () => {
  const { cloneDir } = makeBareOriginAndClone();
  const runner = (args, opts) => defaultRunner(args, { ...opts, cwd: cloneDir });
  const prettyContent = JSON.stringify({ runId: 'r50', claimedAt: '2026-01-01T00:00:00.000Z', ttlHours: 72 }, null, 2);
  const tip = writeBlob(cloneDir, runner, 50, prettyContent);

  const batch = readClaimBlobsGitBatch({ issueNumbers: [50], tip, runner });
  assert.equal(batch.failure, null);
  assert.equal(batch.results[50].failure, null, 'must not degrade to transport-failure against the real defaultRunner');
  assert.equal(batch.results[50].absent, false);
  assert.equal(batch.results[50].content, prettyContent);
});
```

Also add `defaultRunner` to the file's existing `require(...)` destructure at the top (it was not previously imported by the test file).

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/issues/claims-git-cas.test.js`
Expected: FAIL — the new test throws/returns `failure: 'transport-failure'` because `readClaimBlobsGitBatch`'s `cat-file --batch` call passes a plain string `input` alongside `encoding: 'buffer'`, which `execFileSync` rejects with `ERR_UNKNOWN_ENCODING` under the real runner (confirmed directly via `execFileSync('cat', [], { input: 'x\n', encoding: 'buffer' })`).

- [ ] **Step 3: Write minimal implementation**

```javascript
// plugin/bin/lib/issues/claims-git-cas.js:299 — before:
batchRaw = runner(['cat-file', '--batch'], { input: `${orderedShas.join('\n')}\n`, encoding: 'buffer' });

// after:
batchRaw = runner(['cat-file', '--batch'], { input: Buffer.from(`${orderedShas.join('\n')}\n`), encoding: 'buffer' });
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/issues/claims-git-cas.test.js`
Expected: PASS (18/18 — confirmed in this worktree: all existing tests plus the new real-runner test pass).

- [x] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/claims-git-cas.js tests/bin-lib/issues/claims-git-cas.test.js
git commit -m "Fix readClaimBlobsGitBatch encoding crash under the real git runner — refs #2852"
```

Already committed as `028008ce5`.

---

## Self-review

- **Spec coverage:** both `## Deliverables` bullets (Buffer input fix; real-runner test) and both `## Acceptance Criteria` items (real runner returns content, not `transport-failure`; new test fails pre-fix/passes post-fix) are covered by Task 1 — confirmed against the actual landed diff and a fresh test run (18/18 pass) during planning.
- **Placeholders:** none.
- **Type consistency:** n/a — single task, no cross-task interfaces.
- **Review Focus:** each line above traces to a test already in the file (the new real-runner test for the first two lines; the existing pretty-printed-JSON test, unaffected by this change, for the third).
