# gh-api-module-pattern skill: real-subprocess test runners must forward the caller's options (#4189) Implementation Plan

**Goal:** Warn in `.claude/skills/gh-api-module-pattern/SKILL.md`'s injectable-runner section that a real-subprocess test runner can rebuild a narrowed options object and drop the caller's options, citing #2852.

**Spec:** `.claude-tweaks/pipelines/archive/2026-10-25T112311-record-4189/work/4189-spec.md` (materialized from GitHub issue #4189)

---

### Task 1: Add the forward-the-caller's-options bullet to the injectable-runner section

**Files:**
- Modify: `.claude/skills/gh-api-module-pattern/SKILL.md`
- Test: `tests/github-rate-limit-conformance.test.js` (existing — reads this skill; must still pass, no new test)

- [ ] **Step 1: Failing test** — none to write: the Acceptance Criteria name only an existing conformance suite that must keep passing; a prose bullet has no behavior to drive red.
- [ ] **Step 2: Implement** — add one bullet to `## The injectable runner`, directly after the fake-runner bullet: a real-subprocess runner a test wraps around `execFileSync` forwards the caller's options object (spread `opts`, override only what the fixture owns such as `cwd`/`stdio`) instead of rebuilding a narrowed one; cite #2852 — `tests/bin-lib/issues/claims-git-cas.test.js`'s `realRunner` hardcodes `encoding: 'utf8'`, dropping `readClaimBlobsGitBatch`'s `encoding: 'buffer'`, so the `ERR_UNKNOWN_ENCODING` crash on its string `input` never reproduced, and the module's catch-all mapped the crash onto `transport-failure`, a normal failure value. PR #2885 added a test through the exported `defaultRunner`.
- [ ] **Step 3: Run** `node --test tests/github-rate-limit-conformance.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4189`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (the bullet, citing #2852) is Step 2; AC 1 (bullet exists and cites #2852) is Step 2; AC 2 (conformance test still passes) is Step 3.
- **Placeholders:** none.
