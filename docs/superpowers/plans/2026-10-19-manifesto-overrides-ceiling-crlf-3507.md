# Windows regression: 1 test file(s) newly failing after a62e27344 (#3507) Implementation Plan

**Goal:** Make `tests/manifesto-overrides-ceiling-conformance.test.js` pass on a CRLF (`core.autocrlf=true`) Windows checkout, where its exact whole-line header lookup currently throws at module load.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T100244-record-3507/spec-3507/work/3507-spec.md` (materialized from GitHub issue #3507)

---

### Task 1: Route the three markdown reads through `readText()`, split on `/\r?\n/`, and pin CRLF extractor parity

**Files:**
- Modify: `tests/manifesto-overrides-ceiling-conformance.test.js`
- Test: `tests/manifesto-overrides-ceiling-conformance.test.js`

- [ ] **Step 1: Failing test** — add one `test()` that builds the CRLF variant of the routing and overrides text from the LF text with `.replace(/\n/g, '\r\n')`, and asserts `routingColumns(crlfRouting)` deep-equals `routingColumns(routing)` and `ceilingRow(crlfOverrides, v) === ceilingRow(overrides, v)` for each of `none`, `low`, `medium`. Against the current `split('\n')` extractors it fails (the CRLF header lookup throws).
- [ ] **Step 2: Implement** — replace the three raw `fs.readFileSync(..., 'utf8')` reads (lines 13, 14, 95) with `readText(path.join(...))` from `./helpers/read-skill`; drop the now-unused `fs` require; change the three `split('\n')` sites (`routingColumns`, `ceilingRow`, the lever-7 filter) to `split(/\r?\n/)`. Keep the backtick-quoted header literal byte-exact — do not loosen it to a regex.
- [ ] **Step 3: Run** `node --test tests/manifesto-overrides-ceiling-conformance.test.js` — PASS, 12 tests (11 existing + the CRLF case). Go-red check (AC 3): temporarily revert `routingColumns`'s split to `split('\n')` and confirm the CRLF case fails, then restore. AC 4: attempt a `git clone --config core.autocrlf=true` scratch clone and check `git ls-files --eol plugin/skills/review/step3-routing.md` for `w/crlf`; if a POSIX host cannot produce `w/crlf`, record that and rely on AC 3. AC 1: `grep -n "fs.readFileSync" tests/manifesto-overrides-ceiling-conformance.test.js` returns nothing.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #3507`.

---

## Self-review

- **Spec coverage:** Deliverables 1 (readText reads), 2 (`/\r?\n/` splits at all three sites), 3 (CRLF parity case) and Acceptance Criteria 1-4 are covered by Task 1's Steps; AC 5 (`npm test` no new failures vs `origin/main`) is `/build` Common Step 5's full verification.
- **Placeholders:** none.
