# Windows regression: 1 test file(s) newly failing after b3517f660 (#5689) Implementation Plan

**Goal:** Make the test `the real repoRoot default resolves the checkout top level` pass on a Windows checkout by comparing both paths through one canonical form, and make it fail for a default that returns its working directory.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T105745-spec-5689/work/5689-spec.md` (materialized from GitHub issue #5689)

---

### Task 1: Compare the repoRoot default through canonicalRealpath, from a subdirectory

**Files:**
- Modify: `tests/bin-lib/skill-gate/cli.test.js`
- Test: `tests/bin-lib/skill-gate/cli.test.js`

- [ ] **Step 1: Failing test** — write the test(s) the spec's `## Acceptance Criteria` describe, and run them before Step 2. A test already green at base proves nothing about this fix: add an assertion that goes red, or say in the report why none can. On a POSIX host the rewritten test is green at base, because the forward-slash/backslash difference exists only on win32. The red proof available here is AC3's mutation: with `realDeps.repoRoot` temporarily replaced by `(cwd) => cwd`, the rewritten test must fail. Run that mutation in a scratch copy or revert it before committing, and quote the failing assertion in the report.
- [ ] **Step 2: Implement** — satisfy every `## Deliverables` checkbox against the files above. Deliverable 4 (the `windows-regression` run on the PR head) is run by the orchestrating session after this task, not by the implementer.
- [ ] **Step 3: Run** the test(s) from Step 1 — PASS. Command: `node --test tests/bin-lib/skill-gate/cli.test.js`. Also run `node --test tests/git-config-null-device-conformance.test.js`, which scans this file.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #5689`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item and every `## Acceptance Criteria` item is covered by Task 1's Files/Steps above, except Deliverable 4 / AC1 (the Windows run) and AC4 (Linux CI), which the orchestrating session runs on the PR head.
- **Placeholders:** none.
