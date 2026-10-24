# Windows regression: visual-decide CLI test mode-bit assertion (#3742) Implementation Plan

**Goal:** Stop `tests/bin-lib/visual-decide/cli.test.js`'s AC1 test asserting POSIX mode bits (`0o600`) on win32, where Node reports `0o666`, while keeping its platform-neutral assertions on every platform.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T082713-record-3686/spec-3742/work/3742-spec.md` (materialized from GitHub issue #3742)

---

### Task 1: Guard the AC1 mode-bit assertion on win32

**Files:**
- Modify: `tests/bin-lib/visual-decide/cli.test.js` (AC1 test, the two `mode` lines ~46-47)
- Reference only (no change): `plugin/bin/lib/visual-decide/server.js`

- [ ] **Step 1: Failing test** — not applicable as a red-then-green on Linux/macOS (the assertion passes here; the failure is win32-only). Instead, prove the guard: with `process.platform` stubbed to `'win32'` in a scratch run, the mode assertion must not execute while the `?key=` and second-start assertions still do.
- [ ] **Step 2: Implement** — wrap only the two mode-bit lines (`const mode = fs.statSync(infoPath).mode & 0o777;` / `assert.equal(mode, 0o600);`) in `if (process.platform !== 'win32') { … }` with a one-line comment that win32 ignores POSIX mode bits. Do not convert the test to `{ skip }`; leave the `fs.existsSync(infoPath)` assertion, the `?key=` assertion and the second-start refusal unconditional. No change to `server.js`.
- [ ] **Step 3: Run** `node --test tests/bin-lib/visual-decide/cli.test.js` — PASS on macOS.
- [ ] **Step 4: Commit** — one commit, `Guard visual-decide CLI test's POSIX mode assertion on win32 — refs #3742`.

---

## Self-review

- **Spec coverage:** Deliverable 1 and AC1–AC3 → Task 1 Steps 2–3; AC4 (post-merge Windows run) is observable only after merge.
- **Placeholders:** none.
