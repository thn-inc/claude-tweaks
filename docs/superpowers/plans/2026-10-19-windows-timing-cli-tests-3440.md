# Windows regression: 1 test file(s) newly failing after ffe20b982 (#3440) Implementation Plan

**Goal:** Make `tests/bin-lib/timing/cli.test.js` pass on a Windows checkout without changing production code.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T082347-record-3440/spec-3440/work/3440-spec.md` (materialized from GitHub issue #3440)

---

### Task 1: Make the phase-timing CLI tests platform-neutral

**Files:**
- Modify: `tests/bin-lib/timing/cli.test.js`
- Test: `tests/bin-lib/timing/cli.test.js`
- Reference (no change): `tests/helpers/read-skill.js` (`readText`), `tests/helpers/root.js` (`skipUnderRoot`, `IS_ROOT`), `tests/fixtures/timing/subagents-golden-auto.md`, `tests/fixtures/timing/subagents-golden-plain.md`

- [ ] **Step 1: Failing test** — this is a test-only change; the "failing" proof is the CRLF reversion proof from the spec's Acceptance Criteria. In a scratch check (not committed), build a CRLF copy of `subagents-golden-plain.md` from its LF text with `.replace(/\n/g, '\r\n')`, then show that `#3375 AC3.2`'s equality (`assert.equal(r.stdout, golden)`) fails when the copy is read raw with `fs.readFileSync` and passes when it is read through `readText`. Record the raw output for the PR.
- [ ] **Step 2: Implement** — in `tests/bin-lib/timing/cli.test.js`:
  1. Fixture home on both platforms: in the `#1929 AC4` test's two `spawnSync` env objects (currently `env: { ...process.env, HOME: home }`, lines ~121 and ~126) and in `subagentRun()`'s returned `env` (line ~203), build the env from a copy of `process.env` with `CLAUDE_CONFIG_DIR` removed (e.g. `const { CLAUDE_CONFIG_DIR, ...base } = process.env;` or a small local helper `fixtureHomeEnv(home)` returning `{ ...base, HOME: home, USERPROFILE: home }`), and set `USERPROFILE: home` beside `HOME: home`. Every `HOME: home` hit must sit beside `USERPROFILE: home`, and none of those env objects may carry `CLAUDE_CONFIG_DIR`.
  2. Golden reads: `require('../../helpers/read-skill')`'s `readText` replaces the bare `fs.readFileSync(..., 'utf8')` for `subagents-golden-auto.md` (`#3375 AC3.1`, line ~214) and `subagents-golden-plain.md` (`#3375 AC3.2`, line ~238).
  3. Native path: in `#3375: with several transcripts…` (lines ~322 and ~324), replace both `sess-2\/subagents` regexes with exact comparisons against an expected path built with `path.join(s.slugDir, 'sess-2', 'subagents')` — `assert.equal(d.notFoundDirs[0], `no subagents/ directory at ${expected}`)` and an exact stdout-line check (e.g. `assert.ok(r.stdout.split('\n').includes(`dispatches: subagent transcripts not found (no subagents/ directory at ${expected})`))`). Do not use `/` as the separator in the expectation.
  4. Mode-000 test (`#1929 whole-branch review fix 2`, line ~170): replace `skipUnderRoot('root ignores file permissions')` with an options object combining both reasons, e.g. `{ skip: (IS_ROOT && 'root ignores file permissions') || (process.platform === 'win32' && 'win32: chmod 0o000 only sets the read-only attribute') }` (import `IS_ROOT` from `../../helpers/root`). No silent early `return`.
  Do not touch `plugin/bin/phase-timing.js` or `plugin/bin/lib/timing/transcript.js`.
- [ ] **Step 3: Run** `node --test tests/bin-lib/timing/cli.test.js` — PASS with zero failures; quote the raw `# tests` / `# pass` / `# fail` / `# skipped` summary lines.
- [ ] **Step 4: Commit** — one commit, `Fix phase-timing CLI tests for Windows checkouts — refs #3440`.

---

## Self-review

- **Spec coverage:** Deliverables 1-4 map to Step 2 items 1-4. AC1 (HOME/USERPROFILE pairing, no CLAUDE_CONFIG_DIR) → item 1; AC2 (`readText`) → item 2; AC3 (no `sess-2\/subagents` regex, `path.join` comparison) → item 3; AC4 (CRLF reversion proof; USERPROFILE/native-path fixes only provable on Windows — say so in the PR) → Step 1; AC5 (POSIX pass, raw summary) → Step 3; AC6 (next windows-regression run) is post-merge and out of build scope.
- **Placeholders:** none.
