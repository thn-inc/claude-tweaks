# review: Step 2.5 record-label read writes {ctx-dir}/record-{n}.json by hand, failing in worktree-isolated sessions (#3744) Implementation Plan

**Goal:** Stop `review-effort-derivation.md` (review Step 2.5's `github-issues` record-label read) from telling the reviewer to hand-write `{ctx-dir}/record-{n}.json`, which a worktree-isolated session is refused under `worktree-always`.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T071436-record-3744/work/3744-spec.md` (materialized from GitHub issue #3744)

---

### Task 1: Pipe the record-label JSON straight into the parseRecordFacets one-liner

**Files:**
- Modify: `plugin/skills/review/review-effort-derivation.md`
- Test: `tests/bin-lib/review-context/prose.test.js`

- [ ] **Step 1: Failing test** — in `tests/bin-lib/review-context/prose.test.js`, add a `3744 AC:` test asserting `review-effort-derivation.md` has no `> "{ctx-dir}/…"` / `> {ctx-dir}/…` redirect and no `record-{n}.json` file, and that its `github-issues` read pipes `gh issue view {n} --json labels |` into a `node -e` that reads stdin (`readFileSync(0)`) and calls `parseRecordFacets`.
- [ ] **Step 2: Implement** — in `review-effort-derivation.md` step 2's `github-issues` block, replace the two fences (`gh issue view {n} --json labels > "{ctx-dir}/record-{n}.json"` and the `node -e … readFileSync(process.argv[1]) … "{ctx-dir}/record-{n}.json"` one-liner) with one fence: `gh issue view {n} --json labels | node -e "…readFileSync(0)…parseRecordFacets(d.labels)…"`. Say in one clause why no file is written (under `--run`, `{ctx-dir}` sits in the main checkout, which refuses a worktree-isolated session's redirect and `Write`). Keep the `mint --print-dir` call and its `.dir` fallback unchanged: Step 3 still reuses that dir via `--dir {ctx-dir}` (`step3-lens-dispatch.md`), and `prose.test.js` pins both.
- [ ] **Step 3: Run** `node --test tests/bin-lib/review-context/prose.test.js tests/session-tmp-placeholder-quoting-conformance.test.js`. Expect PASS. If the quoting sweep's `QUOTED_FLOOR` drops because the two quoted `"{ctx-dir}/record-{n}.json"` sites are gone, re-measure it and lower the constant, with a comment naming #3744.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #3744`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (remove the hand-written file, pipe on stdin) is Step 2. Deliverable 2 (update any test pinning the old form) is Step 3's floor adjustment; the frozen `PRE_CHANGE_CTX_REDIRECT` go-red fixture is a frozen copy, not a live pin, so it stays. AC1 (no hand-written `{ctx-dir}` file) is Step 1's assertion. AC2 (the risk/size read still works from a worktree-isolated session) holds because nothing is written: a `gh | node` pipe passes the worktree shell guard (`_shared/scratch-worktree.md` §7). AC3 (`npm test` passes) is checked in Common Step 5.
- **Placeholders:** none.
