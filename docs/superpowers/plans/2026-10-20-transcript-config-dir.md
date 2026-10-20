# locateTranscripts honors CLAUDE_CONFIG_DIR (#3458) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `locateTranscripts` resolves the Claude Code projects root from `CLAUDE_CONFIG_DIR` (falling back to `~/.claude`), so `phase-timing.js --auto-transcript` finds session transcripts under a non-default config dir.

**Architecture:** Add one injectable `configDir` parameter to `locateTranscripts` whose default is `process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude')` — the same resolution `plugin/bin/dream-scan.js:66` and `plugin/bin/skill-load-report.js:72` already use. The projects root becomes `path.join(configDir, 'projects')`; all containment logic below it is unchanged. The caller (`plugin/bin/phase-timing.js:247`) needs no change — it calls `locateTranscripts({ cwd: worktree, sessionId })` and picks up the default.

**Tech Stack:** Node 18+, `node:test`, no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T151915-record-3458/work/3458-spec.md` (materialized from GitHub issue #3458)

## Global Constraints

- Keep the existing `homeDir` seam working for tests (spec Deliverable 1).
- With `CLAUDE_CONFIG_DIR` unset, behavior is unchanged (spec AC2).
- Do not add a `realpathSync` token to `transcript.js` — `tests/path-guard-conformance.test.js:146` pins exactly 2.
- Empty-string `CLAUDE_CONFIG_DIR` falls back to `~/.claude` (the `||` semantics dream-scan.js/skill-load-report.js use — no trim, matching them exactly).

## Review Focus

1. **Symlinked projects root under the config dir** — the real shape on the maintainer's machine: `~/.claude-accounts/<slug>/projects` is a symlink to `~/.claude/projects`. Containment is decided on real paths, so a symlinked *root* must still admit its own transcripts. Pinned by test `AC1.1 (symlinked root)` in Task 1.
2. **Ambient `CLAUDE_CONFIG_DIR` in the test process** — this repo's dev sessions run with it set, so every existing `homeDir`-only test call would silently resolve against the developer's real config dir. Pinned by stripping it at the top of both affected test files (Task 1 Step 1) — the same posture `tests/bin-lib/timing/cli.test.js:19-25`'s `fixtureHomeEnv` already takes for the spawned CLI.
3. **Empty `CLAUDE_CONFIG_DIR`** — must fall back to `homeDir/.claude`, not resolve `projects` relative to cwd. Pinned by test `empty CLAUDE_CONFIG_DIR falls back`.
4. **Explicit `configDir` beats the env var** — the injectable seam must win so a caller can pin the root. Pinned by test `explicit configDir wins`.
5. **Traversal containment under the new root** — a `../` session id must still return `[]` when the root came from `CLAUDE_CONFIG_DIR`. Covered by the existing traversal tests (the containment code is unchanged); no new test.

## Real-input probe (Plan-authoring check)

Before the whole-branch review, run against a scratch copy of this run's own `run-state.json` + `events.jsonl` (real worktree + sessionId):

```
node plugin/bin/phase-timing.js --run {scratch-run-dir} --json --auto-transcript
```

Pre-fix output (recorded at authoring time): `transcripts: [{ path: "/Users/thomasholknielsen/.claude/projects/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks--claude-worktrees-dispatch-record-3458/319e854a-e304-4d0b-9042-27078e51dbae.jsonl", rows: 167 }]` — found only because this machine's `$CLAUDE_CONFIG_DIR/projects` is a symlink to `~/.claude/projects`. Post-fix expectation: the same file is still found (now through `$CLAUDE_CONFIG_DIR/projects`, real path reported), and with `CLAUDE_CONFIG_DIR` pointed at a scratch dir holding a copy of the transcript at the same slug and `HOME` pointed elsewhere, it is found there. Independent count: `wc -l` on the transcript file vs. nothing (rows is readUsage's count of usage rows, not lines — only existence is the claim here).

---

### Task 1: Resolve the projects root from CLAUDE_CONFIG_DIR

**Files:**
- Modify: `plugin/bin/lib/timing/transcript.js:4-11` (header note), `:35-46` (signature + projects root)
- Modify: `plugin/bin/phase-timing.js:24-26` (header comment names `{home}/.claude/projects` — change to `{config-dir}/projects ({config-dir} = $CLAUDE_CONFIG_DIR, default ~/.claude)`)
- Modify: `docs/journeys/see-which-phase-spent-the-tokens-1929.md:19` (entry point says transcript lives under `~/.claude/projects/` — name `$CLAUDE_CONFIG_DIR/projects/`, default `~/.claude/projects/`)
- Test: `tests/bin-lib/timing/transcript.test.js`
- Test: `tests/bin-lib/path-guard/callers-characterization.test.js` (hermeticity only — strip the env var; no assertion changes)

**Consumer / dependency-caller enumeration:** `locateTranscripts` callers — `plugin/bin/phase-timing.js:247` (pick-one: uses `found[0]`, unchanged); tests `tests/bin-lib/timing/transcript.test.js` and `tests/bin-lib/path-guard/callers-characterization.test.js` (both pass `homeDir` only → need the env strip); `tests/bin-lib/timing/cli.test.js` spawns the CLI with `fixtureHomeEnv`, which already drops `CLAUDE_CONFIG_DIR` (no change). `tests/skill-load-report-cli.test.js` imports only `slugForCwd` (no change).

**Interfaces:**
- Produces: `locateTranscripts({ cwd?, sessionId?, homeDir = os.homedir(), configDir = process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude'), fsImpl = fs } = {}) -> [{ path, mtimeMs }]` — unchanged return shape.

- [ ] **Step 1: Make both test files hermetic and write the failing tests**

At the top of both test files (after the requires), add:

```js
// The developer's own CLAUDE_CONFIG_DIR would redirect every homeDir-only
// lookup below away from its fixture (#3458) — same posture as cli.test.js's
// fixtureHomeEnv.
delete process.env.CLAUDE_CONFIG_DIR;
```

In `tests/bin-lib/timing/transcript.test.js`, add a helper `fakeConfigDir()` that creates a temp dir with `projects/{slugForCwd(CWD)}/sess-c.jsonl` (CWD = `/Users/x/Code/repo/.claude/worktrees/wt`), and a `withEnv(value, fn)` helper that sets/deletes `process.env.CLAUDE_CONFIG_DIR` and restores the prior state in `finally`. Tests:

- `AC1.1: with CLAUDE_CONFIG_DIR set, locateTranscripts({ cwd, sessionId }) returns the file under $CLAUDE_CONFIG_DIR/projects` — `withEnv(cfg, () => locateTranscripts({ cwd: CWD, sessionId: 'sess-c' }))`; assert one result whose `path` equals `fs.realpathSync(path.join(cfg, 'projects', slugForCwd(CWD), 'sess-c.jsonl'))`. Called with exactly `{ cwd, sessionId }` — no `homeDir`, no `configDir` — as the AC states.
- `AC1.1 (symlinked root): a $CLAUDE_CONFIG_DIR/projects that is a symlink still yields its transcripts` — real dir `R` holding `{slug}/sess-s.jsonl`; `cfg/projects` symlinked to `R`; assert one result with path `fs.realpathSync(path.join(R, slug, 'sess-s.jsonl'))`.
- `AC1.1: CLAUDE_CONFIG_DIR wins over homeDir` — env = cfg, also pass `homeDir: fakeHome().home` (whose `sess-1` exists only under home); `sessionId: 'sess-1'` → `[]`; `sessionId: 'sess-c'` → the cfg file.
- `explicit configDir wins over CLAUDE_CONFIG_DIR` — env set to an empty temp dir, `configDir: cfg` → finds `sess-c`.
- `empty CLAUDE_CONFIG_DIR falls back to homeDir/.claude` — `withEnv('', …)`, `homeDir: fakeHome().home`, `sessionId: 'sess-1'` → one result under `home/.claude/projects`.
- `AC2.1: with CLAUDE_CONFIG_DIR unset, lookup is unchanged (homeDir/.claude/projects)` — `withEnv(undefined, …)`, same assertion as the existing `#1929 AC1` test's `both` case (`sess-2` found under `home/.claude/projects`).

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `node --test tests/bin-lib/timing/transcript.test.js`
Expected: FAIL — the `AC1.1` tests, `CLAUDE_CONFIG_DIR wins`, and `explicit configDir wins` fail (lookup still under `homeDir/.claude`); `empty … falls back` and `AC2.1` pass (they pin unchanged behavior).

- [ ] **Step 3: Implement the `configDir` parameter in `plugin/bin/lib/timing/transcript.js`**

Signature as in Interfaces; replace `path.join(homeDir, '.claude', 'projects')` with `path.join(configDir, 'projects')`. Update the function's doc comment (`// { cwd?, sessionId?, homeDir?, configDir?, fsImpl? } …`) to say the root is `{configDir}/projects`, `configDir` defaulting to `$CLAUDE_CONFIG_DIR || {homeDir}/.claude`. Update the `TRANSCRIPT_SLUG_RULE` header note (lines 4-11) so the observed pair reads `→ {config-dir}/projects/` and add one sentence: `{config-dir} is $CLAUDE_CONFIG_DIR when set (Claude Code writes transcripts there), else ~/.claude — the resolution dream-scan.js and skill-load-report.js use (#3458).` Update the two `~/.claude/projects` mentions in comments at lines 57 and 260 to `the projects root`. Then the `phase-timing.js` header and journey line per Files.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/timing/transcript.test.js tests/bin-lib/path-guard/callers-characterization.test.js tests/bin-lib/timing/cli.test.js tests/path-guard-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/timing/transcript.js plugin/bin/phase-timing.js docs/journeys/see-which-phase-spent-the-tokens-1929.md tests/bin-lib/timing/transcript.test.js tests/bin-lib/path-guard/callers-characterization.test.js
git commit -m "Resolve transcript projects root from CLAUDE_CONFIG_DIR — locateTranscripts falls back to ~/.claude (refs #3458)"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (config-dir resolution, homeDir seam kept) → Step 3 + Step 1's hermeticity strip. Deliverable 2 (`TRANSCRIPT_SLUG_RULE` header note) → Step 3. AC1 → `AC1.1` tests. AC2 → `AC2.1` test + Step 4's full existing-suite run.
- **Placeholders:** none. `{scratch-run-dir}` in the real-input probe is chosen at verification time (a scratchpad copy).
