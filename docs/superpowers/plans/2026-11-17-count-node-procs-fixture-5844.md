# Give the count-node-procs real-run test its own small fixture test file (#5844) Implementation Plan

**Goal:** `tests/count-node-procs.test.js` stops running `tests/helpers-git-template.test.js` as the fixture of its real-run test, so a full suite run no longer pays for that file twice.

**Spec:** `.claude-tweaks/pipelines/2026-11-17T080323-spec-5844/work/5844-spec.md` (materialized from GitHub issue #5844)

---

### Task 1: Give the real-run test a purpose-built fixture test file

**Files:**
- Create: `tools/count-node-procs-fixture/sample.test.js`
- Test: `tests/count-node-procs.test.js`

- [ ] **Step 1: Failing test** — in `tests/count-node-procs.test.js`, change `AC10.1: one real run prints a row for the listed test file` to list the fixture and assert the exact row the spec's `## Acceptance Criteria` describe (one row, the fixture's repo-relative `file`, the exact `nodeProcs`, the exact `cliProcs` map, a numeric `wallMs`), and run it before Step 2. It is red while the fixture does not exist.
- [ ] **Step 2: Implement** — satisfy every `## Deliverables` checkbox against the files above. The fixture starts exactly one git process and exactly one child node process running a side-effect-free `plugin/bin/` CLI, and nothing else. Read `tools/count-node-procs.js` (`analyze`, the `isTestFile` rule at line 95 and the CLI-name rule) to derive the exact expected `nodeProcs` and `cliProcs`, and `tools/run-tests.js` for what `--files-from` accepts. If a repository check requires test files to sit under `tests/` or `tools/upstream-drift/tests/`, follow Deliverable 2's fallback and report it.
- [ ] **Step 3: Run** the test(s) from Step 1 — PASS. Then show the revert check of the Acceptance Criteria: with the fixture's node child removed (one node process fewer), the real-run test is red; restore the fixture and quote that red output in the report.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #5844`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item and every `## Acceptance Criteria` item is covered by Task 1's Files/Steps above. The before/after git and node process counts of Deliverable 4 and the Windows regression proof are gathered by the build's verification steps after Task 1, from the committed tree.
- **Placeholders:** none.
