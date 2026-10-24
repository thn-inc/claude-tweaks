# Windows regression: auto-merge short-circuit test raw markdown read (#3776) Implementation Plan

**Goal:** Route the last raw markdown read in `tests/auto-merge-short-circuit-dispatch-call.test.js` through `readText`, so no `.md` file in that test is read without EOL normalization.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T082713-record-3686/spec-3776/work/3776-spec.md` (materialized from GitHub issue #3776)

**State at base (premise partially pre-satisfied):** #3922 (f65b7eab3) already routed the spec's line-21 `RAW` read and the line-127 `flow/SKILL.md` read through `readText`. One raw read remains: the AC4.1 walk at line ~126, `files.filter((f) => /dispatch-claim/i.test(fs.readFileSync(f, 'utf8')))`, which reads every `.md` and `.js` file under `plugin/` plus `docs/skill-graph.md`.

---

### Task 1: Route the remaining raw read through readText

**Files:**
- Modify: `tests/auto-merge-short-circuit-dispatch-call.test.js` (AC4.1 test, line ~126)
- Reference only (no change): `tests/helpers/read-skill.js`

- [ ] **Step 1: Failing check** — `grep -n "fs.readFileSync" tests/auto-merge-short-circuit-dispatch-call.test.js` shows the line-126 raw read (AC1 unmet).
- [ ] **Step 2: Implement** — replace `fs.readFileSync(f, 'utf8')` on that line with `readText(f)` (already imported from `./helpers/read-skill`). `readText` only normalizes `\r\n` → `\n`, so the `.js` files the same walk reads are matched identically. No assertion or regex text changes.
- [ ] **Step 3: Run** `node --test tests/auto-merge-short-circuit-dispatch-call.test.js` — PASS; then the AC2 CRLF simulation: a scratch `--require` preload (outside the repo) that makes `fs.readFileSync` return `\r\n`-converted text for repo `.md` files — all tests PASS. Also `node --test tests/raw-markdown-read-conformance.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, `Route the AC4.1 walk's markdown read through readText — refs #3776`.

---

## Self-review

- **Spec coverage:** AC1 → Step 2 (no raw `.md` read remains); AC2/AC3 → Step 3; AC4 (post-merge Windows run) observable only after merge. Deliverable lines 21/127 already satisfied at base (#3922).
- **Placeholders:** none.
