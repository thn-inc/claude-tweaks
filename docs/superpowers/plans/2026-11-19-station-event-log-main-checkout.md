# Keep the station-event log from dirtying a project's main checkout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Appending a station event leaves `git status --porcelain` empty in a project whose `.gitignore` has no station-events rows, with no `/claude-tweaks:init` re-run.

**Architecture:** Keep the log at `{main checkout}/.claude-tweaks/station-events.jsonl`: the dispatch scoreboard (`thn-inc/dispatch`, #5951) reads that fixed path, so moving it would break a cross-repo reader and is not done. Instead `appendStationEvent` makes sure the main checkout's own `.git/info/exclude` lists the log and its lock, inside the append's existing lock, with fs calls only. `info/exclude` sits in the git common dir, so the one entry also covers every linked worktree. The `/init` step-04 `.gitignore` rows stay as they are.

**Tech Stack:** Node 18+ CommonJS (CI runs Node 20), `node --test` through `tools/run-tests.js`, real `git` in test fixtures.

**Spec:** `.claude-tweaks/pipelines/2026-11-19T154019-spec-5957/work/5957-spec.md`

## Global Constraints

- `appendStationEvent` never throws and never changes its caller's outcome; a refused or failed append writes exactly one stderr line, a successful one writes none (`docs/reference/station-events.md`, "Failure posture"). The exclude step adds no stderr line of its own, on success or failure.
- No subprocess: emit runs on hook paths, which must not spawn git. The exclude step uses `fs` only, through the injected `d.fs`.
- The log path does not move. `stationEventPath(mainRoot)` keeps returning `path.join(mainRoot, '.claude-tweaks', 'station-events.jsonl')`.
- The exclude entries are exactly `/.claude-tweaks/station-events.jsonl` and `/.claude-tweaks/station-events.jsonl.lock` (git patterns, always `/`, on every platform).
- `plugin/bin` code uses no `fs.existsSync` or `fs.realpathSync` token: `tests/path-guard-conformance.test.js` counts both (comments excluded). Use `fsImpl.statSync(...).isDirectory()` and catch `ENOENT` on the read.
- From `.claude/skills/station-event-producer-addition/SKILL.md`, quoted: "**Optional seam, wrapped call.** An absent `deps.stationEvent` means no emission. Every call sits in its own try/catch, so a throwing emitter never changes stdout, the exit code or the CLI's envelope. `appendStationEvent` itself never throws and reports a drop as one stderr line; the wrap guards a fake or a later emitter." and "**No skill prose names the file.** `tests/bin-lib/station-events/no-prose-logging.test.js` allows only `plugin/skills/init/bootstrap/step-04-gitignore-suggestions.md` to mention `station-events` under `plugin/skills`." Its other rules (stations through `stations.js`, discriminator, emit-on-landed, lane) govern producers; this change adds no producer, so none apply.
- Callers of `appendStationEvent` outside its own test file: `tests/bin-lib/station-events/failure-isolation.test.js` (`realEmitterAt` over `unwritableRoot()`) and `tests/bin-lib/driver/run.test.js` (~line 7375, a read-only root). Both roots have no `.git` directory, so the new step is a no-op there; both suites run in Task 1 Step 4 to prove it.
- Tests that run real git follow the project skill `git-ground-truth-test-env` (`.claude/skills/git-ground-truth-test-env/SKILL.md`): fixtures via `tests/helpers/git-fixtures.js`, and proof under `node tools/run-tests.js`, never only a bare `node --test`.
- Every git child a new test runs (its `porcelain` helper and `classifyMirror`) gets a hermetic env, `{ ...cleanGitEnv(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull }`, so a developer's global `core.excludesFile` cannot hide the log and pass the clean-status tests with the fix absent.
- Scope (plan review, Reading A): only the untracked log is in scope. A log already tracked in a project's index would still dirty it, since `info/exclude` never hides a tracked file; none can exist, because #5902's emitters are unreleased and each append writes the exclude entry before its first line. Task 2 documents this limit.

## Review Focus

1. An existing `info/exclude` with no trailing newline: the first added entry must start on its own line, never glued onto the user's last pattern.
2. An `info/exclude` that already lists both entries, including with CRLF line endings: nothing is appended, so repeated sequential appends never grow the file. (Two appends racing past a lock timeout may each add the entries once; duplicate exclude lines are harmless to git and accepted.)
3. A `.git/info/` directory that does not exist (a repo created without a template): it is created, and the entries are written.
4. A `mainRoot` with no `.git` directory (every existing emit test injects one): the step is a silent no-op, no file is created under `.git`, no stderr line.
5. An `info/exclude` that cannot be written: the event is still appended and `{ written: true }` comes back with zero stderr lines.

Each line has its test in Task 1.

---

### Task 1: Exclude the log and its lock at append time

**Review risk:** high — every station-event producer appends through this function on hook paths; a throw or a stderr line here changes callers' outcomes.

**Files:**
- Modify: `plugin/bin/lib/station-events/emit.js` (new helper beside `stationEventPath`; one call inside `appendStationEvent`'s `withLock` callback, before `appendFileSync`; export it)
- Test: `tests/bin-lib/station-events/emit.test.js` (append the tests below)
- Read (no change): `plugin/bin/lib/reconcile/classify.js` (`classifyMirror`, called by the AC3.1 test); `plugin/bin/lib/station-events/driver-mirror.js` (writes through `appendStationEvent`, so it inherits the fix with no edit)

**Interfaces:**
- Produces: `EXCLUDE_ENTRIES` — `Object.freeze(['/.claude-tweaks/station-events.jsonl', '/.claude-tweaks/station-events.jsonl.lock'])`, exported.
- Produces: `ensureLocalExclude(mainRoot: string, fsImpl = fs) -> boolean`, exported. Returns `true` when both entries are present afterwards, `false` when `{mainRoot}/.git` is not a directory or any fs call threw. Never throws.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/station-events/emit.test.js`, importing `EXCLUDE_ENTRIES`, `ensureLocalExclude` from emit.js, `initRepo` and `cleanGitEnv` from `tests/helpers/git-fixtures.js`, `originWithTwoClones` too, `classifyMirror` from `plugin/bin/lib/reconcile/classify.js`. A local `hermeticEnv()` returns `{ ...cleanGitEnv(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull }`; a local `porcelain(dir)` helper runs `git -C dir status --porcelain` with `env: hermeticEnv()`.
  - `'AC1.1: an append in a repo with no station-events ignore rule leaves git status clean'`: `initRepo(root)` on a `scratchDir` root; `appendStationEvent(event(), d)` returns `{ written: true }`; `porcelain(root) === ''`; `stderr.calls.length === 0`; the log has 1 line.
  - `'AC3.1: reconcile mirror reads the checkout clean after an append'`: `const { work } = originWithTwoClones(<prefix>)` (a committed clone of a bare origin, `main` pushed); first write the log file under `work` by hand (no emit) and assert `classifyMirror(work, 'main', { env: hermeticEnv() })` deep-equals `{ state: 'dirty', failure: null }`; remove that file, then `appendStationEvent(event(), d)` with `mainRoot: work` and assert the same call deep-equals `{ state: 'current', failure: null }` (fetch included, no `skipFetch`).
  - `'the exclude entries are appended once, on their own lines'`: `initRepo(root)`; write `{root}/.git/info/exclude` as `'# mine\n*.swp'` (no trailing newline); call `appendStationEvent` twice; the file's lines (split on `/\r?\n/`, blanks dropped) are `['# mine', '*.swp', ...EXCLUDE_ENTRIES]` — each entry exactly once, `*.swp` intact.
  - `'existing CRLF entries are not appended again'`: `initRepo(root)`; write exclude as `EXCLUDE_ENTRIES.join('\r\n') + '\r\n'`; `ensureLocalExclude(root)` returns `true`; the file content is byte-identical afterwards.
  - `'a missing info directory is created'`: `initRepo(root)`; `fs.rmSync(path.join(root, '.git', 'info'), { recursive: true, force: true })`; `ensureLocalExclude(root) === true`; `porcelain` is `''` after an append.
  - `'no .git directory is a silent no-op'`: plain `scratchDir` root; `ensureLocalExclude(root) === false`; `fs.existsSync(path.join(root, '.git')) === false` after an `appendStationEvent` that returns `{ written: true }` with zero stderr lines.
  - `'an unwritable exclude never drops the event'`: `initRepo(root)`; inject `fs: { ...fs, appendFileSync: (p, ...a) => { if (p.endsWith(path.join('info', 'exclude'))) throw new Error('EACCES'); return fs.appendFileSync(p, ...a); } }`; result `{ written: true }`, `stderr.calls.length === 0`, the log has 1 line.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tools/run-tests.js tests/bin-lib/station-events/emit.test.js`
Expected: FAIL — `ensureLocalExclude` / `EXCLUDE_ENTRIES` undefined, and the clean-status tests report `?? .claude-tweaks/`.

- [ ] **Step 3: Implement `ensureLocalExclude(mainRoot, fsImpl = fs)` in `emit.js` and call it**

`{mainRoot}/.git` must be a directory (`fsImpl.statSync(...).isDirectory()`), else return `false` — a linked worktree's `.git` file never reaches here, because `mainCheckoutRoot` already resolved the main checkout. Read `{mainRoot}/.git/info/exclude` (`ENOENT` → `''`), compare against its lines with `\r` stripped and trimmed, and append only the missing entries in one `fsImpl.appendFileSync`, prefixed with `\n` when the existing content is non-empty and does not end in a newline, each entry followed by `\n`. `fsImpl.mkdirSync(infoDir, { recursive: true })` first. The lock makes sequential appends idempotent; two appends racing past a lock timeout may each append the entries once, which is accepted (duplicate exclude lines are harmless) and needs no extra guard. Wrap the whole body in `try { … } catch { return false; }`. In `appendStationEvent`, call `ensureLocalExclude(d.mainRoot, d.fs)` as the first statement inside the `withLock` callback, ignoring its return value. Add one header-comment line naming #5957 and why the path stays put.

- [ ] **Step 4: Run the tests to verify they pass, with the neighbours**

Run: `node tools/run-tests.js tests/bin-lib/station-events/emit.test.js tests/bin-lib/station-events/failure-isolation.test.js tests/bin-lib/station-events/blockers.test.js tests/bin-lib/station-events/driver-mirror.test.js tests/bin-lib/station-events/no-prose-logging.test.js tests/bin-lib/driver/run.test.js tests/path-guard-conformance.test.js`
Expected: PASS, 0 fail.

- [ ] **Step 5: Prove the clean-status test discriminates**

Comment out the `ensureLocalExclude(...)` call in `appendStationEvent` and re-run `node tools/run-tests.js tests/bin-lib/station-events/emit.test.js`. Expected: FAIL on the AC1.1 and AC3.1 tests. Restore the call; re-run; PASS.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/station-events/emit.js tests/bin-lib/station-events/emit.test.js
git commit -m "Exclude the station-event log at append time — main checkout info/exclude (#5957)"
```

### Task 2: Record the choice in the contract docs

**Files:**
- Modify: `docs/reference/station-events.md` (section `## File location`)
- Modify: `plugin/skills/init/bootstrap/step-04-gitignore-suggestions.md` (the sentence beginning "The station-event file (`.claude-tweaks/station-events.jsonl`) and its lock")

**Interfaces:**
- Consumes: `EXCLUDE_ENTRIES` and `ensureLocalExclude` from Task 1 (named in the doc, not called).

- [ ] **Step 1: Edit `## File location`** in `docs/reference/station-events.md`: replace "Both paths are gitignored." with a short paragraph stating that each append first makes sure `{main checkout}/.git/info/exclude` lists both paths (`ensureLocalExclude`, `EXCLUDE_ENTRIES`), so a project whose `.gitignore` lacks them still reads clean to `git status --porcelain` and reconcile's mirror (#5957); that `info/exclude` lives in the git common dir, so linked worktrees share it; and that the path deliberately stays put because the dispatch scoreboard reads it (#5951) — moving it would be a cross-repo contract change; and that `info/exclude` hides only an untracked file, so a log already tracked in a project's index would still dirty it — none can exist, because each append writes the exclude entry before its first line and the log never shipped without it. Keep the `/init` row mention.

- [ ] **Step 2: Edit the step-04 sentence** to add one clause: the code also lists both paths in the main checkout's `.git/info/exclude` at write time (#5957), so these two rows are belt-and-braces for a project that has not re-run `/init`. Keep the paragraph's single mention of `station-events` scoped to this file (the `no-prose-logging` test allows exactly this file under `plugin/skills`).

- [ ] **Step 3: Run the doc-pinning tests**

Run: `node tools/run-tests.js tests/bin-lib/station-events/no-prose-logging.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/reference/station-events.md plugin/skills/init/bootstrap/step-04-gitignore-suggestions.md
git commit -m "Document the station-event log's write-time exclude — keep the path for dispatch (#5957)"
```

## Not in this plan

Waived AC2.1: every reader keeps finding the log because its path does not change; no test is needed beyond Task 1's unchanged `stationEventPath` assertion in the existing `'appends whole lines under the real lock'` test.

- `driver-mirror.js` and every other reader: the spec migrates readers only if the path moves, and it does not, so no reader changes (spec Acceptance Criterion 2 holds unchanged).
- The same init-row-only gap for `reconcile-cache.json`, `reconcile-background-status.json` and `wrap-up-outcomes.tsv` is #5959's systemic record, not this one.
