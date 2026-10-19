# dispatch: queue-pull-script.md redirects to undeclared $DISPATCH_OPEN_PR_EXCLUDED (#3024) Implementation Plan

**Goal:** Remove the dead `echo '[]' > "$DISPATCH_OPEN_PR_EXCLUDED"` redirect from `queue-pull-script.md` (a #1752 migration leftover that prints `: No such file or directory` on every queue pull) and guard against the same leftover recurring.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T072140-record-3024/work/3024-spec.md` (materialized from GitHub issue #3024)

---

### Task 1: Delete the dead redirect and add a referenced-vs-declared `$DISPATCH_*` conformance test

**Files:**
- Modify: `plugin/skills/dispatch/queue-pull-script.md` (the dead redirect is now at line 363, not the `:294` the record cites)
- Test: `tests/bin-lib/dispatch/exclusions.test.js`

- [ ] **Step 1: Failing test** — append a test to `tests/bin-lib/dispatch/exclusions.test.js` asserting every `$DISPATCH_*` variable `queue-pull-script.md` references (both `$VAR` and `${VAR}` forms) is either declared in the script's session-tmp `files` map (`KEY: 'file'` lines) or assigned in the script (`KEY=`). The assertion message must name each undeclared variable. Make sure the scan does not flag a variable only referenced via `process.env` inside a heredoc-fed `node-eval-file.js` body as undeclared.
- [ ] **Step 2: Run** `node --test tests/bin-lib/dispatch/exclusions.test.js` — Expected: FAIL, naming `DISPATCH_OPEN_PR_EXCLUDED`.
- [ ] **Step 3: Implement** — delete the line `echo '[]' > "$DISPATCH_OPEN_PR_EXCLUDED"` from `plugin/skills/dispatch/queue-pull-script.md`. Nothing else in the file changes.
- [ ] **Step 4: Run** `node --test tests/bin-lib/dispatch/exclusions.test.js` and every test file that reads `queue-pull-script.md` (`grep -rl queue-pull-script tests`) — PASS. Update a byte pin only if one pins this exact fence, and name it.
- [ ] **Step 5: Commit** — one commit, message drawn from the spec title, `refs #3024`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (delete the redirect) → Step 3; Deliverable 2 (conformance test) → Step 1. AC "no reference to `DISPATCH_OPEN_PR_EXCLUDED`" → Step 3; AC "new test fails on the current file naming the variable, passes after" → Steps 2 and 4; AC "existing dispatch suites and any byte-pin/snippet test over the file pass" → Step 4; AC "`npm test` passes in full" → `/build` Common Step 5.
- **Placeholders:** none.
