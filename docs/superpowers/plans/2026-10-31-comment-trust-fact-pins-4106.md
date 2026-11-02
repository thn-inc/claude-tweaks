# comment-trust fixed-facts pin uses generic tokens and has no go-red control (#4106) Implementation Plan

**Goal:** Make `tests/comment-trust-conformance.test.js`'s `AC5.3: the Trusted authors section states the fixed facts` pin the two fact phrases instead of the bare words `missing` / `viewer`, and pair it with a doctored-text negative control, as the file header's [IL-105] rule requires.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T101111-spec-4107-4052-4070-4090-4101-4105-4106-4073/spec-4106/work/4106-spec.md` (materialized from GitHub issue #4106)

---

### Task 1: Anchored fact phrases plus a delete-the-sentence negative control

**Files:**
- Modify: `tests/comment-trust-conformance.test.js`
- Waived `plugin/skills/_shared/pr-run-comments.md`: read-only — the `## Trusted authors` section being pinned (`:108-122`); temporarily edited only for the two live revert proofs, never committed

- [ ] **Step 1: Rewrite** — replace the whole test `AC5.3: the Trusted authors section states the fixed facts` (around `:126-137`) with exactly:

  ```js
  test('AC5.3: the Trusted authors section states the fixed facts', () => {
    const body = collapse(section(COMMENTS, '## Trusted authors') ?? '');
    const facts = [
      '`authorAssociation`',
      '`author_association`',
      'bin/lib/issues/comment-trust.js',
      'A missing field is untrusted',
      'There is no viewer lookup',
    ];
    const statesAll = (text) => facts.every((fact) => text.includes(fact));
    for (const fact of facts) {
      assert.ok(body.includes(fact), `Trusted authors section must mention: ${fact}`);
    }
    // Go-red control [IL-105]: deleting one fact sentence (never a global token replace — #4400)
    // must fail the pin.
    for (const sentence of [
      'A missing field is untrusted — a comment with neither field is skipped.',
      'There is no viewer lookup.',
    ]) {
      const doctored = body.replace(sentence, '');
      assert.notStrictEqual(doctored, body, `doctoring must change the section: ${sentence}`);
      assert.ok(!statesAll(doctored), `deleting "${sentence}" must fail the fixed-facts pin`);
    }
  });
  ```

  Keep the three specific tokens as they are; change no other test.
- [ ] **Step 2: Run** `node --test tests/comment-trust-conformance.test.js` — PASS. No production or skill change (`git diff plugin/` empty).
- [ ] **Step 3: Commit** — one commit, `Pin the comment-trust fixed facts by phrase — delete-the-sentence go-red control`, body `refs #4106`.
- [ ] **Step 4: Live revert proofs** (after the commit; restore each with `git checkout HEAD -- plugin/skills/_shared/pr-run-comments.md` before the next, then confirm `git diff --exit-code plugin/` exits 0):
  1. Delete `A missing field is untrusted — a comment with neither field is skipped.` from `plugin/skills/_shared/pr-run-comments.md` (line 114; leave the rest of the line). Run the file: `AC5.3: the Trusted authors section states the fixed facts` FAILS with `Trusted authors section must mention: A missing field is untrusted`. Record it.
  2. Delete `There is no viewer lookup.` (line 118; leave the rest of the line). Run the file: the same test FAILS with `Trusted authors section must mention: There is no viewer lookup`. Record it.
  3. Old-pin contrast (evidence for the record, no edit kept): on the doctored text from proof 2, show the old `'viewer'` token still matched — `grep -c viewer` on the doctored section ≥ 1 ("matching the viewer rejects …" remains) — so the generic token could not catch the deletion. Record the count.

Review risk: low

---

## Self-review

- **Spec coverage:** Deliverable 1 (fact phrases, collapsed body) → Step 1 `facts`; Deliverable 2 (doctored negative control per fact, with a did-it-change sanity assert) → Step 1's second loop. AC1 → Step 1; AC2 → Step 2 (the control runs inside the test); AC3 (live deletion fails AC5.3, observed, restored) → Step 4.1-4.2; AC4 (`npm test`) → Common Step 5.
- **Gotchas:** doctor by deleting the one fact sentence, never a global token replace (#4400); match on the collapsed body (the section is hard-wrapped); the three specific tokens are untouched.
- **Placeholders:** none.
