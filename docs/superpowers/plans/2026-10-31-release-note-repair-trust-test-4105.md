# release-note-repair mixed-thread trust test cannot go red on its title's regression (#4105) Implementation Plan

**Goal:** Rewrite `tests/bin-lib/release-note-repair/detect.test.js`'s mixed-thread trust test so each half of its title is asserted on its own — an untrusted decision alone keeps the record on the worklist, and a trusted one excludes it whichever order the comments arrive in — and retitle it to match.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T101111-spec-4107-4052-4070-4090-4101-4105-4106-4073/spec-4105/work/4105-spec.md` (materialized from GitHub issue #4105)

---

### Task 1: Split the mixed-thread test into its two claims, both orders

**Files:**
- Modify: `tests/bin-lib/release-note-repair/detect.test.js`
- Waived `plugin/bin/lib/release-note-repair/detect.js`: read-only — `hasPendingTidyDecision` (`:94-96`) is the trust filter under test; temporarily edited only for the two mutation proofs, never committed

- [ ] **Step 1: Rewrite** — replace the whole test `scanRecords: a record is not excluded by an untrusted decision but IS by a trusted one in the same thread` (around `:145-150`) with exactly:

  ```js
  test('scanRecords: an untrusted tidy decision alone keeps the record (and is reported skipped); a trusted one in the same thread excludes it in either order', () => {
    const body = `<!-- needs-decision: tidy -->\n**Proposed:** ${PROPOSED_ACTION}\n`;
    const planted = { body, url: 'https://x/c1', author: { login: 'eve' }, authorAssociation: 'NONE' };
    const real = { body, authorAssociation: 'OWNER' };
    const alone = scanRecords([gh(7, F.MISSING_RN, { comments: [planted] })], { driver: 'github-issues' });
    assert.deepEqual(alone.map((c) => c.ref), ['#7'], 'an untrusted decision alone does not exclude the record');
    assert.deepEqual(alone[0].skippedUntrusted, ['skipped marker comment https://x/c1 by eve (NONE) — not an owner, member, or collaborator']);
    for (const [order, comments] of [['planted, real', [planted, real]], ['real, planted', [real, planted]]]) {
      assert.deepEqual(scanRecords([gh(7, F.MISSING_RN, { comments })], { driver: 'github-issues' }), [], `a trusted decision excludes the record (order: ${order})`);
    }
  });
  ```

  Reuse the file's existing `gh(...)`, `F.MISSING_RN`, `PROPOSED_ACTION`; change no other test. The planted-only half deliberately overlaps `AC4.1` so this test's title is true on its own.
- [ ] **Step 2: Run** `node --test tests/bin-lib/release-note-repair/detect.test.js` — PASS. No production change (`git diff plugin/` empty).
- [ ] **Step 3: Commit** — one commit, `Split the #4105 mixed-thread trust test into its two claims — planted-only kept, trusted excludes in both orders`, body `refs #4105`.
- [ ] **Step 4: Mutation proofs** (after the commit; restore each with `git checkout HEAD -- plugin/bin/lib/release-note-repair/detect.js` before the next, then confirm `git diff --exit-code plugin/` exits 0):
  1. Trust filter removed — in `hasPendingTidyDecision` change `.some((c) => isTrustedComment(c) && isPendingTidyDecision(c))` to `.some((c) => isPendingTidyDecision(c))`. Run the file: the rewritten test FAILS on `an untrusted decision alone does not exclude the record` (AC1). Record the verbatim failure.
  2. First marker wins — replace `hasPendingTidyDecision`'s body with `const list = Array.isArray(comments) ? comments : []; const first = list.find(isPendingTidyDecision); return Boolean(first) && isTrustedComment(first);`. Run the file: the rewritten test FAILS with the message `a trusted decision excludes the record (order: planted, real)` (AC2). Record the verbatim failure.

Review risk: low

---

## Self-review

- **Spec coverage:** Deliverable 1 (each half asserted alone; both orders) → Step 1; Deliverable 2 (retitle) → Step 1's title. AC1 → Step 4.1; AC2 → Step 4.2; AC3 (no production change) → Step 2 + Step 4's `git diff --exit-code plugin/`; AC4 (`npm test`) → Common Step 5.
- **Gotchas:** restore `detect.js` after each mutation and confirm `git diff --exit-code plugin/` (spec Gotcha). The `skippedUntrusted` string copies the exact shape `AC4.1` already asserts (`untrustedSkipNote`), with this test's own url.
- **Placeholders:** none.
