# Windows console-residue test parity (#3505) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three console-residue suites pass on a Windows checkout by building expected native paths the way the code under test builds them.

**Architecture:** Test-side only. The producers (`plugin/bin/console-resolve.js`'s `needsAHumanBlock`, `plugin/bin/console-residue.js`'s pre-archive stderr note, `plugin/bin/lib/console/residue.js`'s `itemLines`/`formatResidueLines`) already print native paths, which is the correct contract for paste-ready commands. Each assertion is rewritten to compute the same native path with `path.join`/`path.resolve`, or, where a prefix is unpredictable, to use `[\\/]` separator classes.

**Tech Stack:** Node `node:test`, `node:assert`, `path`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T082347-record-3440/spec-3505/work/3505-spec.md` (GitHub record #3505)

## Global Constraints

- No production file under `plugin/` changes. The producers already emit native paths.
- No test is skipped or removed. Exact matching (`lines.includes` / `deepStrictEqual` / `strictEqual`) stays exact.
- The `"/p/bin/console-residue.js"` pins in `residue.test.js` (pluginRoot `/p` concatenated with `/bin/...`) stay literal — `formatResidueLines` never joins them.
- Never stub `process.platform`. Never hard-code a drive letter or root; every expected prefix comes from the fixture's own paths.
- Commit messages use `refs #3505`, never `closes`/`fixes`.

## Review Focus

- A Windows path (`D:\a\...`) on every expected value: each rewritten assertion must hold whatever `path.sep` is — check the expectation is built from `path.join`/`path.resolve` or a `[\\/]` class, never a literal `/` between path segments.
- macOS `/var` → `/private/var`: `residue-cli.test.js`'s second `MOVED` test derives `mainRoot` from cwd (realpath'd), so an exact string there would break; `MOVED` stays a separator-agnostic regex.
- The mixed `D:\...\plugin/bin/console-residue.js` shape: `${pluginRoot}/bin/...` is concatenated with a literal `/` in the producer, so the `cli.test.js` expectation must reproduce that literal `/bin/console-residue.js` tail, not `path.join` it.
- Discrimination: each rewritten assertion must still go red when the producer is broken (Task steps "Discrimination check").
- Sibling suites: a new separator-shape hit in the four sibling files listed in Task 3.

---

### Task 1: `residue.test.js` — native expected paths

**Files:**
- Modify: `tests/bin-lib/console/residue.test.js` (expected-path lines currently ~108, ~119, ~127, ~168, ~178)
- Reference (no change): `plugin/bin/lib/console/residue.js` (`itemLines` lines ~60-65, `formatResidueLines` line ~88)

**Interfaces:** none shared with other tasks.

- [ ] **Step 1: Rewrite each `${dir}/...` expectation with `path.join`.** Exact replacements:
  - `` `    cat "${dir}/staged/review-13-record.md"` `` → `` `    cat "${path.join(dir, 'staged', 'review-13-record.md')}"` ``
  - `` `    cat "${dir}/spec-12/staged/polish-suggestion-1.md"` `` → `` `    cat "${path.join(dir, 'spec-12', 'staged', 'polish-suggestion-1.md')}"` ``
  - `` `  … and 2 more — see "${dir}/console.json"` `` → `` `  … and 2 more — see "${path.join(dir, 'console.json')}"` ``
  - `` [`    cat "${dir}/staged/polish-suggestion-1.md"`] `` → `` [`    cat "${path.join(dir, 'staged', 'polish-suggestion-1.md')}"`] ``
  - `` `    see "${dir}/decisions.md"` `` → `` `    see "${path.join(dir, 'decisions.md')}"` ``
  Leave every `"/p/bin/console-residue.js"` literal and every bare `"${dir}"` untouched.
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/residue.test.js` — Expected: PASS, `# fail 0`, `# skipped 0`.
- [ ] **Step 3: Discrimination check (scratch worktree, never the shared tree):** in a `git worktree add` copy under the OS tmpdir, change `'staged'` to `'stage'` in `residue.js`'s `itemLines` `path.join(consoleDir, 'staged', item.id)` and run the file — Expected: FAIL on the `cat` assertions. Remove the scratch worktree. Record the command and raw output in the report.
- [ ] **Step 4: Commit** — `git add tests/bin-lib/console/residue.test.js`; message `Build console-residue expected paths natively — refs #3505`.

### Task 2: `residue-cli.test.js` — separator-agnostic `MOVED`

**Files:**
- Modify: `tests/bin-lib/console/residue-cli.test.js` (`MOVED` at line ~160; asserted at ~169 and ~179)
- Reference (no change): `plugin/bin/console-residue.js` (lines ~115-120)

- [ ] **Step 1: Rewrite `MOVED`** so every literal `/` separator is a `[\\/]` class, keeping the `pipelines` → `pipelines/archive` distinction and the `\n$` anchor:
  `` new RegExp(`^console-residue\\.js: .*[\\\\/]pipelines[\\\\/]${RUN_2821} has moved to .*[\\\\/]pipelines[\\\\/]archive[\\\\/]${RUN_2821} — using the archived copy\\n$`) ``
  (`RUN_2821` is `2026-10-16T210949-spec-2821` — no regex metacharacters, so no escape helper is needed; if you add one, keep it local.) Both tests that assert `MOVED` use the new value; no other change.
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/residue-cli.test.js` — Expected: PASS, `# fail 0`, `# skipped 0`.
- [ ] **Step 3: Discrimination check (scratch worktree):** drop `'archive'` from `archiveDir`'s `path.join(main, '.claude-tweaks', 'pipelines', 'archive', path.basename(o.run))` and run the file — Expected: the two `MOVED` tests FAIL. Record command + raw output.
- [ ] **Step 4: Commit** — `git add tests/bin-lib/console/residue-cli.test.js`; message `Make the console-residue moved-note regex separator-agnostic — refs #3505`.

### Task 3: `cli.test.js` — exact native "paths move" line, plus sibling sweep

**Files:**
- Modify: `tests/bin-lib/console/cli.test.js` (the `#3370` "Needs a human" test, regex at line ~382)
- Reference (no change): `plugin/bin/console-resolve.js` (`needsAHumanBlock`, line ~39: `pluginRoot = path.resolve(__dirname, '..')`, line `  paths move when the run is archived; current paths: node "${pluginRoot}/bin/console-residue.js" --run "${runDir}"`)
- Sweep (read-only unless a hit): `tests/bin-lib/hooks/session-residue.test.js`, `tests/console-resolve-conformance.test.js`, `tests/hooks-session-start.test.js`, `tests/hooks-dispatcher.test.js`

- [ ] **Step 1: Replace the regex with an exact expected line** built from the fixture: with `const PLUGIN_ROOT = path.resolve(__dirname, '..', '..', '..', 'plugin');`, assert
  `assert.strictEqual(tail[tail.length - 1], `  paths move when the run is archived; current paths: node "${PLUGIN_ROOT}/bin/console-residue.js" --run "${fx.runDir}"`);`
  (`fx.runDir` is already `realpathSync`ed by `mainCheckoutWithRun`; the `/bin/console-residue.js` tail is a literal `/`, matching the producer's concatenation.) If the CLI resolves `runDir` to a different string than `fx.runDir`, fall back to a regex anchored at both ends with `[\\/]` classes for every separator and an escaped `path.basename(fx.runDir)` — say which in the report.
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/cli.test.js` — Expected: PASS, `# fail 0`, `# skipped 0`.
- [ ] **Step 3: Discrimination check (scratch worktree):** drop the `--run "${runDir}"` value from `console-resolve.js`'s paths line and run the file — Expected: the `#3370` "Needs a human" test FAILS. Record command + raw output.
- [ ] **Step 4: Sibling sweep:** `grep -nE '\$\{[A-Za-z_.]+\}/|"/\.\+/|\.\*/' tests/bin-lib/hooks/session-residue.test.js tests/console-resolve-conformance.test.js tests/hooks-session-start.test.js tests/hooks-dispatcher.test.js` — for each hit that expects a native path the code builds with `path.join`/`path.resolve`, apply the same move; a hit that is a display ID or a literal the producer concatenates stays. Record the raw grep output and each disposition in the report (it goes in the PR body).
- [ ] **Step 5: Run all three suites together:** `node --test tests/bin-lib/console/cli.test.js tests/bin-lib/console/residue-cli.test.js tests/bin-lib/console/residue.test.js` — Expected: PASS, no skips; quote the raw `# tests` / `# pass` / `# fail` / `# skipped` lines.
- [ ] **Step 6: Commit** — `git add tests/bin-lib/console/cli.test.js` (plus any sibling file a sweep hit changed); message `Pin the console paths-move line with a native expected path — refs #3505`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Task 3 Steps 1-3; Deliverable 2 → Task 2; Deliverable 3 → Task 1; Deliverable 4 → Task 3 Step 4. AC1 (three files pass, nothing skipped) → Task 3 Step 5; AC2 (windows-latest `gh workflow run`) is run by `/build`'s test phase after the push, not by an implementer; AC3 (discrimination) → each task's Step 3; AC4 (no `plugin/` change) → Global Constraints; AC5 (`npm test`) → `/build` Common Step 5.
- **Placeholders:** none. **Proportion:** three small test edits; plan carries only the exact expected values.
