# Windows regression: 1 test file(s) newly failing after 259be0521 (#3890) Implementation Plan

**Goal:** Route `tests/routine-fleet-security-hardening.test.js`'s read helper through the shared EOL-normalizing `readText`, so its 3 CRLF-sensitive tests pass on a Windows `core.autocrlf=true` checkout.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T230359-record-3890/spec-3890/work/3890-spec.md` (materialized from GitHub issue #3890)

---

### Task 1: Route the read helper through readText

**Files:**
- Modify: `tests/routine-fleet-security-hardening.test.js`
- Test: `tests/routine-fleet-security-hardening.test.js`

- [ ] **Step 1: Failing test** — run the scratch CRLF-read simulation (a `--require` shim that returns every utf8 `.md` read with `\n` turned into `\r\n`, kept in the session scratchpad, not committed): `node --require {scratchpad}/crlf-shim.js tests/routine-fleet-security-hardening.test.js`. Expected: FAIL — 3 of 6 fail (AC1.1, AC1.2, existing-rows cron pin).
- [ ] **Step 2: Implement** — add `const { readText } = require('./helpers/read-skill');` and change the `read` helper (line 10) to `return readText(path.join(ROOT, rel));`. Keep `fs` (still used by `readdirSync`). No assertion changes.
- [ ] **Step 3: Run** the simulation from Step 1 — all 6 PASS; and `node --test tests/routine-fleet-security-hardening.test.js` — PASS; `grep -n "readFileSync" tests/routine-fleet-security-hardening.test.js` — no match.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #3890`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 2. AC1 → Step 3's grep. AC2 → Steps 1 and 3's simulation. AC3 → Step 3's `node --test`. AC4 is post-merge only (`windows-regression.yml`), not verifiable in-run.
- **Placeholders:** none (`{scratchpad}` is the session scratchpad path, passed in the dispatch).
