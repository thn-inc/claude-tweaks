# Windows regression: 1 test file(s) newly failing after a865b2ffa (#3894) Implementation Plan

**Goal:** Route `tests/materiality-floor-conformance.test.js`'s `read` helper through the shared EOL-normalizing `readText`, so its #3766 newline-spanning assertion passes on a Windows `core.autocrlf=true` checkout.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T230359-record-3890/spec-3894/work/3894-spec.md` (materialized from GitHub issue #3894)

---

### Task 1: Route the read helper through readText

**Files:**
- Modify: `tests/materiality-floor-conformance.test.js`
- Test: `tests/materiality-floor-conformance.test.js`

- [ ] **Step 1: Failing test** — run the scratch CRLF-read simulation (a `--require` shim that returns every utf8 `.md` read with `\n` turned into `\r\n`, kept in the session scratchpad, not committed): `node --require {scratchpad}/crlf-shim.js tests/materiality-floor-conformance.test.js`. Expected: FAIL — 1 of 55 fails (the #3766 "digest-sweep.md reads trusted comment objects…" test).
- [ ] **Step 2: Implement** — add `const { readText } = require('./helpers/read-skill');` and change the `read` helper (line 16) to `const read = (rel) => readText(path.join(REPO_ROOT, rel));`. The helper is the file's only `fs` use, so remove the now-unused `const fs = require('fs');` (line 9). No assertion changes — in particular, do not rewrite the `'never reduce\nthem to bare bodies first'` literal (spec Gotcha: the line-break span is deliberate).
- [ ] **Step 3: Run** the simulation from Step 1 — all 55 PASS; and `node --test tests/materiality-floor-conformance.test.js` — PASS; `grep -n "readFileSync" tests/materiality-floor-conformance.test.js` — no match.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #3894`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 2. AC1 → Step 3's grep. AC2 → Steps 1 and 3's simulation. AC3 → Step 3's `node --test`. AC4 is post-merge only (`windows-regression.yml`), not verifiable in-run. Gotcha 1 (keep the `\n` literal) → Step 2.
- **Placeholders:** none (`{scratchpad}` is the session scratchpad path, passed in the dispatch).
