# Windows regression: 2 test file(s) newly failing after 4b3e6fa7f (#3871) Implementation Plan

**Goal:** `measureComposed` in `plugin/bin/lib/skill-audit/context-cost.js` normalizes each compose source's `\r\n` to `\n` at read time, matching the module's own `measuredTextBytes`, so composed-byte counts are EOL-independent and a Windows `core.autocrlf=true` checkout no longer pushes the `merge` bundle falsely past `RAIL_BYTES`.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T220207-record-3857/spec-3871/work/3871-spec.md` (materialized from GitHub issue #3871)

---

### Task 1: Normalize CRLF at `measureComposed`'s source read and pin it with an LF-vs-CRLF regression test

**Files:**
- Modify: `plugin/bin/lib/skill-audit/context-cost.js`
- Test: `tests/bin-lib/skill-audit/context-cost.test.js`
- Read-only: `tests/helpers/read-skill.js` (`crlfCheckoutRead` may be reused), `tests/wrap-up-merge-mode-conformance.test.js` (no change — passes once the measurement is EOL-independent)

- [ ] **Step 1: Failing test** — in `tests/bin-lib/skill-audit/context-cost.test.js`, next to the existing `measureComposed` tests (~line 345-450, which build temp-dir fixtures via `tmpRoot`), add a test that builds two temp roots holding the same compose sources — one written with LF, one with every `\n` turned into `\r\n` (use real sources containing at least one `<!-- when: ... -->` fence so the conditional path is exercised; copying real `plugin/skills/**` files, or a hand-built fixture shaped like the existing ones, are both fine) — runs `measureComposed` on an equivalent call site in each, and asserts every combination's byte count is identical between the two. It fails before Step 2 (CRLF counts one extra byte per line).
- [ ] **Step 2: Implement** — at `measureComposed`'s source read (~line 153, `content: fs.readFileSync(p, 'utf8')`), normalize `\r\n` → `\n` the same way `measuredTextBytes` (~line 56) does. Do not touch `plugin/bin/lib/compose-context/` (out of scope per spec) and do not change `RAIL_BYTES` (spec Gotchas).
- [ ] **Step 3: Run** `node --test tests/bin-lib/skill-audit/context-cost.test.js tests/wrap-up-merge-mode-conformance.test.js` — PASS. Confirm the reported LF bytes for the `merge` step are unchanged by the fix (`composedBytesReport` on `plugin/`, the `merge` rows — record before and after; the spec measured 52129 B at shaping time, give or take content changes on main). Prove the new test discriminates: temporarily revert the normalization and confirm the new test fails, then restore. Also prove AC2 under a CRLF-read simulation: in a scratch copy (a `git worktree add` under the session scratchpad, or a temp copy of `plugin/`), convert the merge bundle's source files to CRLF and confirm `composedBytesReport`'s `merge` rows match the LF count after the fix (and exceed it, ~52799 B, before).
- [ ] **Step 4: Commit** — one commit, `Normalize CRLF in measureComposed's source read — composed-byte counts are EOL-independent, refs #3871`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (normalize at read) → Step 2; Deliverable 2 (CRLF-vs-LF regression test) → Step 1. AC1 (identical LF/CRLF counts, test fails on revert) → Steps 1 and 3; AC2 (CRLF simulation passes both files) → Step 3; AC3 (green on Linux/macOS, LF merge bytes unchanged) → Step 3; AC4 (next post-merge Windows check) is post-merge evidence, not buildable here.
- **Placeholders:** none.
