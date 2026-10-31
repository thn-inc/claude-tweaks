# review-context per-file cap has no multi-byte test pinning Buffer.byteLength (#4090) Implementation Plan

**Goal:** Pin both `Buffer.byteLength` sites of `plugin/bin/lib/review-context/build.js`'s per-file cap with a fixture whose content is under the cap in characters but over it in bytes.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T101111-spec-4107-4052-4070-4090-4101-4105-4106-4073/spec-4090/work/4090-spec.md` (materialized from GitHub issue #4090)

---

### Task 1: Multi-byte over-cap added-file test

**Files:**
- Modify: `tests/bin-lib/review-context/build.test.js`
- Waived `plugin/bin/lib/review-context/build.js`: read-only — the two cap sites under test, `:153` (`Buffer.byteLength(text) > PER_FILE_CAP_BYTES`, diff-chunk elision of an added/deleted file) and `:287` (`const bytes = Buffer.byteLength(content);`, feeding the `kind: 'cap'` return at `:290`). Temporarily edited only for the revert proofs, never committed.

- [ ] **Step 1: Failing-by-construction test** — add one test after the `F2: a non-ASCII added over-cap name …` test (around :479). Build its own small fixture repo (do NOT change the shared `makeOversizeFixtureRepo` or `makeAddedOversizeRepo` helpers — other tests read them): `initRepo('review-ctx-multibyte-')`, write `seed.txt`, `startFeatureBranch(repo)`, write `big-multibyte.txt` with content `` `${'é'.repeat(PER_FILE_CAP_BYTES / 2 + 1)}\n` `` (precomposed U+00E9, 2 bytes in UTF-8 — write it as the `é` escape so the source is unambiguous), `commitAll(repo, 'feature work')`, then `const { result, bundle, diffPart } = buildFrom(repo);`.
  - Guard assertions on the fixture itself: the content's `.length` is `< PER_FILE_CAP_BYTES` and its `Buffer.byteLength` is `> PER_FILE_CAP_BYTES` (so the test cannot pass on a character-count implementation).
  - `:153` site: `assert.match(diffPart, /^\[\d+ bytes of diff elided for big-multibyte\.txt — see oversizeSections\]$/m);` and `assert.ok(!diffPart.includes('é'.repeat(1000)))`.
  - `:287` site: `assert.match(sectionOf(bundle, 'big-multibyte.txt'), /^\[section omitted: big-multibyte\.txt is \d+ bytes, over the \d+-byte per-file cap/);`.
  - `assert.strictEqual(result.oversizeSections.filter((p) => p === 'big-multibyte.txt').length, 1);`.
  - Use `PER_FILE_CAP_BYTES` from the existing import; never retype `64 * 1024`.
- [ ] **Step 2: Implement** — test only; no production change (`git diff plugin/` stays empty).
- [ ] **Step 3: Run** `node --test tests/bin-lib/review-context/build.test.js` — PASS. Revert proofs, each run separately and restored before the next:
  1. At `build.js:153` replace `Buffer.byteLength(text)` with `text.length` → the new test fails on the diff-elision assertion. Record the command and failing output; restore.
  2. At `build.js:287` replace `Buffer.byteLength(content)` with `content.length` → the new test fails on the section-cap assertion. Record the command and failing output; restore.
  Then confirm `git diff --exit-code plugin/` exits 0.
- [ ] **Step 4: Commit** — one commit, `Pin review-context per-file cap to bytes — multi-byte over-cap fixture`, `refs #4090`.

Review risk: low

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 1. AC1 → Step 3 PASS; AC2 (both revert proofs) → Step 3 items 1-2; AC3 (no production change) → Step 2 + `git diff --exit-code plugin/`; AC4 (`npm test`) → Common Step 5.
- **Gotchas:** non-markdown `.txt` extension (markdown is stubbed at any size, `build.js:288`); `PER_FILE_CAP_BYTES / 2 + 1` 2-byte chars = cap + 2 bytes, cap/2 + 2 chars with the newline — guarded by Step 1's fixture assertions; precomposed U+00E9 via the `é` escape.
- **Budget:** the bundle (~66 KB either revert) stays under `TOTAL_CAP_BYTES` (256 KB), so the total-budget pass cannot elide or stub the piece and mask a revert.
- **Placeholders:** none.
