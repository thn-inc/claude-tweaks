# _shared/pr-run-comments.md Find step writes the comments payload to a fixed shared /tmp path (#4065) Implementation Plan

**Goal:** The worktree-safe Find step in `plugin/skills/_shared/pr-run-comments.md` writes `gh pr view ... --json comments` to a fixed shared `/tmp/{kind}-comments-{n}.json` path. Resolve that payload path through `bin/session-tmp-resolve.js` per `_shared/session-tmp-root.md` instead.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T163305-record-4065/work/4065-spec.md` (materialized from GitHub issue #4065)

---

### Task 1: Session-scope the Find step's comments payload path and pin it

**Files:**
- Modify: `plugin/skills/_shared/pr-run-comments.md`
- Test: `tests/pr-run-comments.test.js`

- [ ] **Step 1: Failing test.** In `tests/pr-run-comments.test.js`, update the `AC1.1` test (the one that asserts the `> /tmp/{kind}-comments-{n}.json` fetch line). It must now assert:
  - the Find step contains no literal `/tmp/{kind}-comments-` path;
  - the Find step resolves the payload path through `bin/session-tmp-resolve.js` with the `{kind}-comments-{n}.json` basename;
  - both the fetch line (`--json comments > ...`) and the `find-run-comment.js --comments-file ...` line use the session-resolved placeholder, not a `/tmp/` literal;
  - the existing "fetch line must not contain `--jq`, `github.com`, `$?`, `;`, `&&`" loop still runs against the new fetch line.

  Add a frozen pre-change const holding the exact current two-fence text (lines 145-151 of the file at HEAD, from `git show HEAD:plugin/skills/_shared/pr-run-comments.md`). The go-red assertions must show the new session-scoped assertions FAIL against that const. Follow the file's existing `PRE_CHANGE_*` convention. Run `node --test tests/pr-run-comments.test.js`: the updated assertions FAIL.
- [ ] **Step 2: Implement.** In `plugin/skills/_shared/pr-run-comments.md`, step 1 (**Find**), worktree-safe form:
  - Add one plain-command fence before the fetch: `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" COMMENTS={kind}-comments-{n}.json`. Say that it prints `COMMENTS="{path}"`, and that its literal path is substituted for `{comments-path}` in the next two fences (a worktree session refuses a runtime variable path, `_shared/scratch-worktree.md` §7). Cite `_shared/session-tmp-root.md`. This is the same print-then-substitute shape `_shared/auto-decision-log.md`'s `--text-file` paragraph uses.
  - Replace `/tmp/{kind}-comments-{n}.json` in the fetch (line 146) and in the `--comments-file` read (line 150) with `"{comments-path}"`.
  - **Same file, same hazard (deferral gate, fix-now: in this diff, localized):** the update (step 2, line 192, `-F body=@/tmp/{kind}-comment-{n}.md`) and create (step 3, line 198, `--body-file /tmp/{kind}-comment-{n}.md`) body file is the same fixed shared `/tmp` name class. Session-scope it the same way, with basename `{kind}-comment-{n}.md` and placeholder `{body-path}`, resolved once. Fold it into the same resolver call (`COMMENTS=... BODY=...`), and state that the caller writes the body to `{body-path}`.
  - Keep edits minimal: do not reword adjacent prose and do not touch the jq shortcut fences.
- [ ] **Step 3: Run** `node --test tests/pr-run-comments.test.js`: PASS. Also run every other suite that reads `pr-run-comments.md`: `tests/claim-mcp-projection-conformance.test.js`, `tests/comment-trust-conformance.test.js`, `tests/fetch-sub-issues-cli.test.js`, `tests/github-rate-limit-conformance.test.js`, `tests/pr-first-merge.test.js`, `tests/timing-prose-conformance.test.js`, `tests/try-it-contract-conformance.test.js`, `tests/wrap-up-multispec-defer-still-live.test.js`: PASS.
- [ ] **Step 4: Commit.** One commit: `Session-scope pr-run-comments.md Find payload path — no fixed shared /tmp name`, body `refs #4065`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (resolve through `bin/session-tmp-resolve.js` at both write and read) is Step 2. Deliverable 2 (update the pin test) is Step 1. AC "no literal `/tmp/{kind}-comments-` path" is Steps 1 and 2. AC "pin asserts session-scoped form and goes red against the old fixed path" is Step 1's frozen const. AC "`npm test` passes" is Common Step 5.
- **Placeholders:** none.
