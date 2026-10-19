# Windows regression: 1 test file(s) newly failing after c65b3fdbb (#3517) Implementation Plan

**Goal:** Make `tests/dispatch-neighbour-in-flight-mcp.test.js` pass on CRLF (Windows `core.autocrlf=true`) checkouts by reading its markdown inputs through `readText()` and making its heredoc extractor CRLF-tolerant, pinned by a new CRLF test case.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T045946-record-3517/work/3517-spec.md` (materialized from GitHub issue #3517)

---

### Task 1: Route the two markdown reads through readText, make section/snippet CRLF-tolerant, and add the CRLF pin case

**Files:**
- Modify: `tests/dispatch-neighbour-in-flight-mcp.test.js`
- Test: `tests/dispatch-neighbour-in-flight-mcp.test.js`

- [ ] **Step 1: Failing test** — add a `test()` that builds `crlf = MCP.replace(/\n/g, '\r\n')` and asserts, for heredocs 0 and 1, that `snippet(i, crlf).replace(/\r\n/g, '\n')` strictly equals `snippet(i)`. With the current bare `'\n' + END` terminator search (and `snippet` not yet taking a text argument) it fails.
- [ ] **Step 2: Implement** — replace both `fs.readFileSync(..., 'utf8')` reads with `readText(...)` required from `./helpers/read-skill.js` (keep the `fs` import; the fixture helper uses it). Give `section(text = MCP)` and `snippet(index, text = MCP)` a source-text parameter. Make the terminator search accept an optional `\r` before each newline around `NODE_EVAL_EOF` (regex), keeping the start-anchor and missing-terminator asserts. Never run CRLF text through `bash -c`.
- [ ] **Step 3: Run** `node --test tests/dispatch-neighbour-in-flight-mcp.test.js` — PASS, 7 tests, 0 failures, 0 skipped. Go-red check: revert the terminator search to the bare `'\n' + END` form and confirm the CRLF case fails, then restore, in one command.
- [ ] **Step 4: Commit** — one commit, `refs #3517`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (readText, keep `fs`) → Step 2; Deliverable 2 (parameterized, CRLF-tolerant extractor, asserts kept) → Step 2; Deliverable 3 (CRLF case) → Step 1. AC grep/no-`fs.readFileSync` → Step 2; AC 7 passing tests → Step 3; AC go-red → Step 3; AC no `plugin/` change → Files list; AC windows-latest run and `npm test` → build/test verification phases.
- **Placeholders:** none.
