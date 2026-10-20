# Windows regression: pipeline-run-dir-adoption-anchoring CRLF + MSYS path (#3562) Implementation Plan

**Goal:** Make `tests/pipeline-run-dir-adoption-anchoring.test.js` pass on a Windows (CRLF, Git Bash) checkout by reading both skill docs through `readText()`, comparing test 5's step-2 pick by basename, and adding a CRLF control test.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T212245-record-3562/work/3562-spec.md` (materialized from GitHub issue #3562)

---

### Task 1: Normalize the suite's skill reads, basename-compare test 5, add a CRLF control

**Files:**
- Modify: `tests/pipeline-run-dir-adoption-anchoring.test.js`
- Test: `tests/pipeline-run-dir-adoption-anchoring.test.js`
- Read-only reference: `tests/helpers/read-skill.js`, `plugin/skills/_shared/run-dir-resolution.md`, `plugin/skills/wrap-up/SKILL.md`, `tests/hooks-run-dir-resolve.test.js`

- [ ] **Step 1: Failing test** — add the CRLF control test: for each doc, build a CRLF string from the LF `readText()` result with `.replace(/\n/g, '\r\n')`, assert it contains `\r\n` and no `\r\r\n`, write it to a temp file, read it back through `readText()`, and assert the extractor (now taking a `text` parameter) returns the same snippet as for the LF text. Remove the temp dir at test end.
- [ ] **Step 2: Implement** — (a) read both docs via `readText()` instead of raw `fs.readFileSync`; leave both extraction regexes unchanged; (b) give `extractSnippet` / `extractWrapUpSnippet` a `text` parameter defaulting to the module-level read; (c) test 5: replace `assert.strictEqual(resolved, canonical)` with `assert.strictEqual(path.basename(resolved), path.basename(canonical))` plus a one-line comment that the step-2 path comes from `pwd` and is MSYS-form under Git Bash.
- [ ] **Step 3: Run** `node --test tests/pipeline-run-dir-adoption-anchoring.test.js` — PASS (6 tests). Then the CRLF simulation (scratch copy, both docs converted to CRLF: pre-fix test fails 5, fixed passes 6) and the three doctoring discrimination checks (each doctor + restore in the same command).
- [ ] **Step 4: Commit** — one commit, `refs #3562`.

Deliverable 4 (sibling follow-up record via `/claude-tweaks:capture`, after re-running the sibling grep) and the `windows-regression.yml` dispatch are operational steps run by the build after Task 1, not implementer edits.

---

## Self-review

- **Spec coverage:** Deliverables 1-3 → Task 1 Steps 1-2; AC (pass, CRLF sim, discrimination, no `plugin/` change) → Step 3; Deliverable 4 + Windows dispatch AC → operational follow-on noted above; `npm test` AC → Common Step 5.
- **Placeholders:** none.
