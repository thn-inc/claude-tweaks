# guard-rewrite.test.js: print the shell stubs' argv from sh instead of starting node per call (#5767) Implementation Plan

**Goal:** Make the `ls` stub, the `git` stub and the `node` stub's fallback branch in `tests/bin-lib/hooks/guard-rewrite.test.js` print their argv as byte-identical JSON with shell builtins only, so a run of the file stops starting a node process per stub call.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T160241-record-5767/work/5767-spec.md` (materialized from GitHub issue #5767)

---

### Task 1: Replace the node-backed argv-print stubs with builtin-only ones

**Files:**
Modify: tests/bin-lib/hooks/guard-rewrite.test.js
Test: tests/bin-lib/hooks/guard-rewrite.test.js

- [ ] **Step 1: Failing test** — write the test(s) the spec's `## Acceptance Criteria` describe, and run them before Step 2. A test already green at base proves nothing about this fix: add an assertion that goes red, or say in the report why none can.
- [ ] **Step 2: Implement** — satisfy every `## Deliverables` checkbox against the files above.
- [ ] **Step 3: Run** the test(s) from Step 1 — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #5767`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item and every `## Acceptance Criteria` item is covered by Task 1's Files/Steps above.
- **Placeholders:** none.
