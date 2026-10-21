# Share Transcript and Plugin-Root Reader Helpers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the two duplicated helper sets across the skill-audit CLIs (#3461) so each rule has one definition site.

**Architecture:** `timing/transcript.js` exports its tool_result byte rule (`resultBytes`) and a new `statTranscriptOrThrow(fsImpl, filePath)` that owns the `transcript not readable (...)` stat errors; `readUsage` and `skill-audit/transcript-load.js` both call them. A new `plugin/bin/lib/skill-audit/plugin-root-reader.js` holds `load-delta.js`'s `headSide` reader as `pluginRootReader(baseAbs, root = '.')`; `load-delta.js` and `skill-load-report.js` both import it.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T191949-record-3461/work/3461-spec.md`

**Scope keywords:** resultBytes, statOrReject, headSide, closureIndex, transcript not readable

## Global Constraints

- `readUsage`'s exported contract and behavior stay unchanged (same rejection codes, same messages, same rows).
- `tests/bin-lib/timing/transcript.test.js` and `tests/bin-lib/skill-audit/transcript-load.test.js` are NOT edited.
- `pluginRootReader` keeps `headSide`'s exact semantics: a read resolves the realpath, requires containment in the realpath of the base (`isPathContained`, strict), requires `statSync(real).isFile()`, returns `null` on `ENOENT`/`EISDIR`/`ENOTDIR`/`ELOOP` and rethrows anything else; `listSkillMds` returns `[]` on `ENOENT`/`ENOTDIR` from `readdirSync` and rethrows anything else.
- `tests/path-guard-conformance.test.js`'s ALLOWLIST counts `realpathSync` tokens per file — every move of a `realpathSync` token updates its entries in the same task.

## Review Focus

1. Plugin root deleted entirely (not just `skills/`) between `skill-load-report.js`'s `skills/` check and `closureIndex` — must not throw (eager `realpathSync(base)` would). Pinned in Task 3 Step 1.
2. `readUsage` on a directory path still rejects with `code: 'EISDIR'` and message `transcript not readable (EISDIR): {path}` — already pinned by the unchanged `transcript.test.js`.
3. A symlinked citation escaping the root reads as absent through the shared reader — pinned in Task 2 Step 1.
4. `load-delta.js` output on this repo is byte-identical before and after — real-input probe, Task 2 Step 6.
5. `skill-load-report.js` output on this repo's transcripts is identical before and after — real-input probe, Task 3 Step 5.

---

### Task 1: Export the transcript byte rule and stat helper

**Files:**
- Modify: `plugin/bin/lib/timing/transcript.js` (`resultBytes` ~101-107, `readUsage` stat block ~118-136, `module.exports` line 357)
- Modify: `plugin/bin/lib/skill-audit/transcript-load.js` (delete local `resultBytes` ~75-84 and `statOrReject` ~92-107; import both from `../timing/transcript`)
- Test: `tests/bin-lib/timing/transcript.test.js`, `tests/bin-lib/skill-audit/transcript-load.test.js` (run only, never edited)

**Interfaces:**
- Produces: `resultBytes(content) -> number` (unchanged body) and `statTranscriptOrThrow(fsImpl, filePath) -> undefined`, both added to `timing/transcript.js`'s `module.exports`. `statTranscriptOrThrow` throws an `Error` whose `code` is the stat failure's code (`'EUNKNOWN'` when absent) with message `transcript not readable (${code}): ${filePath}`, or `code: 'EISDIR'` with the same message shape when the path stats as non-file. Build the message from ONE template literal so `transcript not readable (` appears once in the helper (stat in a try that captures the code; `!st.isFile()` sets `'EISDIR'` outside the try).

- [ ] **Step 1: Baseline — run both unchanged suites**

Run: `node --test tests/bin-lib/timing/transcript.test.js tests/bin-lib/skill-audit/transcript-load.test.js`
Expected: PASS (all tests).

- [ ] **Step 2: Add and export `statTranscriptOrThrow`; export `resultBytes`; make `readUsage` call `statTranscriptOrThrow(fsImpl, filePath)` in place of its `await new Promise(...)` stat block** (a throw inside the async function is a rejection with the same error, so the contract holds).

- [ ] **Step 3: In `transcript-load.js`, delete the local `resultBytes` (and its "Same rule as…" comment) and `statOrReject`; import `{ isProcedurePath, resultBytes, statTranscriptOrThrow }` from `../timing/transcript`; call `statTranscriptOrThrow(fsImpl, filePath)` where `statOrReject` was called.**

- [ ] **Step 4: Verify AC2.1 — both suites pass unchanged**

Run: `node --test tests/bin-lib/timing/transcript.test.js tests/bin-lib/skill-audit/transcript-load.test.js tests/bin-lib/path-guard/callers-characterization.test.js tests/bin-lib/timing/derive.test.js`
Expected: PASS, same test count as Step 1 for the first two files. `git diff --stat -- tests/bin-lib/timing/transcript.test.js tests/bin-lib/skill-audit/transcript-load.test.js` prints nothing.

- [ ] **Step 5: Verify AC1.1 and AC1.2**

Run: `git grep -n -e "function resultBytes" -e "transcript not readable (\${code}): " -e "transcript not readable (EISDIR)" -- plugin/bin`
Expected: exactly two lines, both in `plugin/bin/lib/timing/transcript.js` (the `resultBytes` definition and the one message template). `git grep -n "transcript not readable" -- plugin/bin/lib/skill-audit` prints nothing. The remaining `transcript not readable` hits in `plugin/bin` are `readDispatches`' `notFound` reasons and `phase-timing.js`'s parser of them — consumers of the stat code, not stat-error definitions.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/timing/transcript.js plugin/bin/lib/skill-audit/transcript-load.js
git commit -m "Share transcript byte rule and stat helper — transcript-load.js imports them from timing/transcript.js, refs #3461"
```

### Task 2: Extract `pluginRootReader` and move `load-delta.js` onto it

**Files:**
- Create: `plugin/bin/lib/skill-audit/plugin-root-reader.js`
- Create: `tests/bin-lib/skill-audit/plugin-root-reader.test.js`
- Modify: `plugin/bin/load-delta.js` (delete `headSide` ~154-192 and the local `skillsPrefix` line 132; import `{ pluginRootReader, skillsPrefix }`; call site line 360 becomes `pluginRootReader(repoRoot, root)`)
- Modify: `tests/path-guard-conformance.test.js` ALLOWLIST (`load-delta.js` realpathSync 4 → 2; add `lib/skill-audit/plugin-root-reader.js` realpathSync 2 with a reason specific to that file)

**Interfaces:**
- Produces: `pluginRootReader(baseAbs: string, root = '.') -> { readFile(p) -> string|null, listSkillMds() -> string[] }` and `skillsPrefix(root) -> string` (`'skills/'` for `'.'`, else `` `${root}/skills/` ``). `readFile(p)` reads `path.join(baseAbs, p)` under the Global Constraints rule; `listSkillMds()` lists directories of `path.join(baseAbs, root, 'skills')` as `` `${skillsPrefix(root)}${name}/SKILL.md` ``, kept only when `readFile` returns non-null. The base realpath is resolved lazily on first `readFile`, inside its try, so a vanished base reads as absent (`ENOENT` → `null`) instead of throwing at construction — the one deliberate widening, needed by Task 3's AC3.2; for `load-delta.js` (base = repo root, which always exists) behavior is identical.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/skill-audit/plugin-root-reader.test.js` against a temp dir:
  - `reads a regular file inside the base` — `readFile('skills/a/SKILL.md')` equals the written text.
  - `a symlink escaping the base reads as absent` — `skills/a/x.md` symlinked to a file outside the base → `null` (skip on win32 if symlink creation throws `EPERM`).
  - `a missing file, a directory, and a looping symlink read as absent` — each `null`.
  - `listSkillMds lists only skill dirs whose SKILL.md is readable, under the root prefix` — base with `plug/skills/a/SKILL.md` and `plug/skills/b/` (no SKILL.md) → `pluginRootReader(base, 'plug').listSkillMds()` deep-equals `['plug/skills/a/SKILL.md']`.
  - `AC3.2: a base deleted after construction degrades to no entries` — construct, `fs.rmSync(base, { recursive: true })`, then `listSkillMds()` deep-equals `[]` and `readFile('skills/a/SKILL.md')` is `null`.
  - `skillsPrefix` — `'.'` → `'skills/'`, `'plugin'` → `'plugin/skills/'`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/skill-audit/plugin-root-reader.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/lib/skill-audit/plugin-root-reader'`.

- [ ] **Step 3: Implement `plugin-root-reader.js`** — `headSide`'s body moved verbatim except: the base parameter rename, the lazy memoized base realpath inside `readFile`'s try, and `skillsPrefix` defined here. Header comment names its two callers and why the base realpath is lazy.

- [ ] **Step 4: Move `load-delta.js` onto it** (delete `headSide` and local `skillsPrefix`; `require('./lib/skill-audit/plugin-root-reader')`), and update the two ALLOWLIST entries.

- [ ] **Step 5: Run tests**

Run: `node --test tests/bin-lib/skill-audit/plugin-root-reader.test.js tests/load-delta-cli.test.js tests/bin-lib/skill-audit/load.test.js tests/path-guard-conformance.test.js`
Expected: PASS.

- [ ] **Step 6: Real-input probe** — before Step 4, run `node plugin/bin/load-delta.js --json --base 44b59b5e` on this repo and save stdout to a scratch `before.json`; after Step 4, run the same command into `after.json`; `cmp before.json after.json` prints nothing. Record the byte count in the task report.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/skill-audit/plugin-root-reader.js tests/bin-lib/skill-audit/plugin-root-reader.test.js plugin/bin/load-delta.js tests/path-guard-conformance.test.js
git commit -m "Extract pluginRootReader from load-delta.js's headSide — one plugin-root reader for the skill-audit CLIs, refs #3461"
```

### Task 3: Move `skill-load-report.js`'s `closureIndex` onto `pluginRootReader`

**Files:**
- Modify: `plugin/bin/skill-load-report.js` (`closureIndex` ~121-148: replace the inline `realRoot`/`readFile`/`listSkillMds` with `pluginRootReader(rootAbs)`; drop the now-unused `isPathContained` import; the comment at ~122-123 names the shared helper)
- Modify: `tests/path-guard-conformance.test.js` ALLOWLIST (remove the `skill-load-report.js` entry — its count drops to 0)
- Test: `tests/skill-load-report-cli.test.js`

**Interfaces:**
- Consumes: `pluginRootReader(baseAbs, root = '.')` from Task 2 (called with one argument here).

- [ ] **Step 1: Write the failing tests** in `tests/skill-load-report-cli.test.js`, reusing its `setup()`/`pluginRoot()` helpers and an invocation transcript for `demo:alpha`:
  - `AC3.2: a plugin root's skills/ deleted between the skills/ check and the index build degrades instead of throwing` — `deps.configDir` (called after the check, before `closureIndex`) does `fs.rmSync(path.join(root, 'skills'), { recursive: true })` then returns the config dir; `run` resolves `0`, stdout JSON has `status: 'ok'` and the `demo:alpha` row's `closure` is `null`.
  - `AC3.2: a plugin root deleted entirely at the same point degrades the same way` — same, removing `root` itself.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-name-pattern "AC3.2" tests/skill-load-report-cli.test.js`
Expected: FAIL — `run` rejects with an `ENOENT` error from `readdirSync`/`realpathSync`.

- [ ] **Step 3: Replace `closureIndex`'s inline reader with `pluginRootReader(rootAbs)`; remove the `skill-load-report.js` ALLOWLIST entry.**

- [ ] **Step 4: Run tests and verify AC3.1**

Run: `node --test tests/skill-load-report-cli.test.js tests/path-guard-conformance.test.js`
Expected: PASS. `git grep -n -e "realpathSync" -e "readdirSync(path.join(rootAbs" -- plugin/bin/skill-load-report.js` prints nothing (AC3.1: no copy of the plugin-root reader remains).

- [ ] **Step 5: Real-input probe** — `node plugin/bin/skill-load-report.js --sessions 5` from the main checkout path (`--cwd "/Users/thomasholknielsen/Code Workspaces/claude-tweaks"`) before Step 3 and after; the `rows` arrays (ignoring `unreadable` if a live transcript was mid-write) are identical. Record `sessions` and row count.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/skill-load-report.js tests/skill-load-report-cli.test.js tests/path-guard-conformance.test.js
git commit -m "Move skill-load-report.js onto pluginRootReader — a plugin root deleted mid-run degrades instead of throwing, refs #3461"
```

## Spec coverage

| AC clause | Covered by |
|---|---|
| AC1.1 transcript-load.js holds no copy of `resultBytes` / stat strings | Task 1 Step 5 |
| AC1.2 one definition site for the stat string | Task 1 Step 5 |
| AC2.1 both transcript suites pass unchanged | Task 1 Step 4 |
| AC3.1 skill-load-report.js holds no copy of the reader | Task 3 Step 4 |
| AC3.2 deleted root degrades like load-delta.js | Task 2 Step 1, Task 3 Step 1 |
