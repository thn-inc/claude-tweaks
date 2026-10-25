# reflect's integration-branch probe reads a failed fetch or git grep error as "content absent" (#4069) Implementation Plan

**Goal:** Make `/claude-tweaks:reflect`'s integration-branch probe report "probe could not run" — never "absent" — on a failed fetch or a `git grep`/`git log` error exit, and pass `{phrase}`/the branch safely quoted.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T162642-record-4069/work/4069-spec.md` (materialized from GitHub issue #4069)

---

### Task 1: Classify probe failures as could-not-run and harden the probe's quoting

**Files:**
- Modify: `plugin/skills/reflect/SKILL.md` (the `**Integration-branch probe before an absence claim (#3987).**` paragraph, line 185)
- Test: `tests/reflect-integration-branch-probe.test.js`

- [ ] **Step 1: Failing test** — in `tests/reflect-integration-branch-probe.test.js`:
  - Update the second test's three command assertions to the new forms: `` `git fetch origin '{integration-branch}'` ``, `` `git grep -n -F -e '{phrase}' 'origin/{integration-branch}' -- '{path}'` ``, `` `git log -S '{phrase}' --oneline 'origin/{integration-branch}' -- '{path}'` ``.
  - Add a test that the paragraph names the could-not-run cases: it must include `` `git fetch` exits non-zero `` , `exits other than 0 or 1`, and `never that the content is absent`.
  - Add a test pinning the `-e` form and quoting rule: it must include `-e '{phrase}'` and the sentence about escaping `'` as `'\''`.
  - Run: `node --test tests/reflect-integration-branch-probe.test.js` — Expected: FAIL (new strings absent).
- [ ] **Step 2: Implement** — in `plugin/skills/reflect/SKILL.md` line 185, replace
  `` run `git fetch origin {integration-branch}`, then probe for the named content, one command per Bash call: `git grep -n -F '{phrase}' origin/{integration-branch} -- {path}` for content the finding says is missing, and `git log -S '{phrase}' --oneline origin/{integration-branch} -- {path}` for a commit that added or deliberately removed it. ``
  with
  `` run `git fetch origin '{integration-branch}'`, then probe for the named content, one command per Bash call: `git grep -n -F -e '{phrase}' 'origin/{integration-branch}' -- '{path}'` for content the finding says is missing, and `git log -S '{phrase}' --oneline 'origin/{integration-branch}' -- '{path}'` for a commit that added or deliberately removed it. Single-quote `{phrase}`, writing each `'` inside it as `'\''`; `-e` keeps a phrase that starts with `-` from being read as an option. ``
  and replace the paragraph's last sentence
  `` A probe that cannot run (no `origin`, or the named file is outside this repository) does not block staging; the record's Current State says the probe could not run. ``
  with
  `` A probe that cannot run does not block staging; the record's Current State says the probe could not run — never that the content is absent. It could not run when there is no `origin`, the named file is outside this repository, `git fetch` exits non-zero (`origin/{integration-branch}` may then be stale, so do not probe it), or `git grep` or `git log` exits other than 0 or 1 (128 is a bad ref or pattern). Only `git grep` exit 1 means no match. ``
- [ ] **Step 3: Run** `node --test tests/reflect-integration-branch-probe.test.js` — PASS. Prove each new assertion discriminates: temporarily remove the could-not-run sentence, then the `-e`, in a scratch copy (or revert-and-restore within the same command) and confirm the test goes red, then restore.
- [ ] **Step 4: Commit** — one commit: `Classify reflect probe failures as could-not-run — failed fetch and grep exit 128 no longer read as absent; -e and quoting` with `refs #4069`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (failed fetch / exit other than 0/1 → could not run) and Deliverable 2 (`-e`, safe quoting, quoted branch) are Step 2; AC 1 (SKILL.md names fetch failure and exit 128) is Step 2's last-sentence rewrite; AC 2 (conformance test pins could-not-run clause and `-e` form, red when removed) is Steps 1 and 3; AC 3 (`npm test` passes) is /build Common Step 5.
- **Placeholders:** none.
