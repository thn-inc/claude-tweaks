# QA Pass Stamp Bookkeeping-Delta Exemption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `qa-stamp.js --check --scope <decl>` treats a bookkeeping-only `stamp.sha..HEAD` delta the way `verify.js` does, returning `{skip: true, reason: 'covered-bookkeeping-delta'}` instead of `sha-mismatch`.

**Architecture:** The pure rule `decideQaSkip` gains a `bookkeepingDelta` boolean input. The CLI computes it (only when `--scope` is given, a stamp exists, the tree is clean and the stamp sha differs from HEAD) by reusing `usableAnchor`, `changedFiles`, `readDeclaration` and `selectScope`; `mode === 'none'` means bookkeeping. `--check` never writes the stamp.

**Tech Stack:** Node 18+, `node --test`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T112559-record-5643/work/5643-spec.md`

Scope keywords: qa-stamp, decideQaSkip, covered-bookkeeping-delta

## Global Constraints

- New reason string, exact: `covered-bookkeeping-delta`.
- `--check` stays read-only — status is data, exit 0 in every state; exit 2 only for a malformed invocation.
- `--scope` with `--write` is a usage error, exit 2.
- A relative `--scope` resolves against the repo root (`git rev-parse --show-toplevel`), like `verify.js`.
- Commit messages: `{Verb} {what} — {detail}`, and reference the record as `refs #5643` (never closes/fixes).
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Project maturity `established`: for any task modifying pre-existing behavior, write a full characterization test covering edge cases before changing it.

**Premise correction (probed):** the spec's Technical Approach says the synthetic stamp is `{ fullSha: stamp.sha }`. `anchorOf` (`plugin/bin/lib/verify/stamp.js:89`) returns null when `stamp.sha` is not a string, so `{ fullSha }` alone makes `selectScope` return `mode: 'full'` (probed: `none` with `{sha, fullSha}`, `full` with `{fullSha}` only). Use `{ sha: stamp.sha, fullSha: stamp.sha }` for both `usableAnchor` and `selectScope`.

## Review Focus

1. A declaration with `toolScoped` and a non-empty delta returns `mode: 'tool-scoped'`, never `none` — must stay `sha-mismatch` (covered by the generic "mode other than none" path; Task 2 test AC2.1 exercises a non-none mode).
2. A `--scope` path that exists but is unreadable/unparseable must not throw — `sha-mismatch`, exit 0 (Task 2, AC5).
3. `--scope` given with no stamp, or a dirty tree, must not run git classification at all and keep `no-stamp`/`dirty-tree` (Task 2, AC6 and a no-stamp case).
4. A stamp sha equal to HEAD with `--scope` must still report `covered`, not `covered-bookkeeping-delta` (Task 1 and Task 2).
5. Git commands must run in the CLI's `cwd` dep, not whatever `process.cwd()` is (Task 2's real-git tests run from the test process cwd, so they fail if the cwd binding is missing).

---

### Task 1: `decideQaSkip` accepts `bookkeepingDelta`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/verify/qa-stamp.js` (`decideQaSkip`, header comment)
- Test: `tests/bin-lib/verify/qa-stamp.test.js`

**Interfaces:**
- Produces: `decideQaSkip({ stamp, head, dirty, storiesDir, selected, bookkeepingDelta = false }) → { skip: boolean, reason: string }`. When `stamp.sha !== head` and `bookkeepingDelta === true`, the sha check is satisfied and every later check runs unchanged; the all-pass reason is `'covered-bookkeeping-delta'` when `stamp.sha !== head`, else `'covered'`. Strictly `=== true` (a truthy non-boolean does not count).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/verify/qa-stamp.test.js`, reusing the file's `STAMP`, `HEAD`, `SEL`, `H1` fixtures and an `OTHER = 'd'.repeat(40)` head:
  - `test('decideQaSkip: characterization — a moved HEAD without bookkeepingDelta stays sha-mismatch (AC3.1)')` — `bookkeepingDelta` omitted and `false` and `'yes'` → `{ skip: false, reason: 'sha-mismatch' }`.
  - `test('decideQaSkip: bookkeepingDelta satisfies the sha check and reports covered-bookkeeping-delta (AC1.1)')` — `head: OTHER, bookkeepingDelta: true` → `{ skip: true, reason: 'covered-bookkeeping-delta' }`.
  - `test('decideQaSkip: bookkeepingDelta still runs every later check (AC4.1)')` — with `head: OTHER, bookkeepingDelta: true`: a changed story hash → `story-changed: login`; a different `storiesDir` → `stories-dir-mismatch`; `dirty: true` → `dirty-tree`; `stamp: null` → `no-stamp`; `selected: []` → `nothing-selected`.
  - `test('decideQaSkip: bookkeepingDelta at the stamped HEAD still reports covered')` — `head: HEAD, bookkeepingDelta: true` → `{ skip: true, reason: 'covered' }`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/verify/qa-stamp.test.js`
Expected: FAIL — the AC1.1, AC4.1 and stamped-HEAD tests (the characterization test passes already).

- [ ] **Step 3: Implement** the Interfaces signature in `decideQaSkip`; update the module header comment with one sentence naming the bookkeeping-delta input and its reason.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/verify/qa-stamp.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/verify/qa-stamp.js tests/bin-lib/verify/qa-stamp.test.js
git commit -m "Accept a bookkeeping delta in decideQaSkip — covered-bookkeeping-delta reason, refs #5643"
```

### Task 2: `qa-stamp.js --check --scope` classifies the delta

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/qa-stamp.js` (header usage lines, `USAGE`, `parseArgs`, `realDeps`, `check`, new `classifyBookkeepingDelta`, `module.exports`)
- Read only: `plugin/bin/lib/verify/scope.js` (`selectScope`), `plugin/bin/lib/verify/changed-files.js` (`usableAnchor`, `changedFiles`), `plugin/bin/lib/verify/declaration.js` (`readDeclaration`)
- Test: `tests/bin-lib/verify/qa-stamp-cli.test.js`

**Interfaces:**
- Consumes: Task 1's `decideQaSkip({ ..., bookkeepingDelta })`.
- Produces:
  - `parseArgs` accepts `--scope <path>` → `o.scope` (default `null`); `--scope` with `--write` → `{ error: '--scope is valid with --check only' }`; `--scope` with no value → error.
  - `realDeps.exec` (default `execFileSync`) — the git runner; `check` wraps it so every git call carries `cwd: deps.cwd()`.
  - `classifyBookkeepingDelta({ stampSha, scope, execImpl }) → boolean` (exported). True only when: the declaration path (absolute as given, else joined to `git rev-parse --show-toplevel`) reads `ok` with a non-null `decl` via `readDeclaration(resolved, undefined, { selfPath })`, where `selfPath` is the resolved path's repo-relative, forward-slash form (null when it lies outside the toplevel) — the option `verify.js` passes on every `--scope` read (plan-review clarification); `usableAnchor({ stamp: { sha: stampSha, fullSha: stampSha }, execImpl })` is non-null; `changedFiles({ base: anchor, execImpl })` succeeds; and `selectScope({ decl, files, stamp: { sha: stampSha, fullSha: stampSha } }).mode === 'none'`, where `files` first drops every path under `.claude-tweaks/artifacts/` — the same exclusion `computeDirty` applies, so a QA run's own untracked screenshots (in a project that does not gitignore them) neither read dirty nor count as an unmatched delta path. Any thrown error or failed condition → `false`. No impact context is passed.
  - `check` calls it only when `o.scope` is set, a stamp exists, `dirty === false`, and `stamp.sha !== head`; passes the result as `bookkeepingDelta`. It never writes the stamp.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/verify/qa-stamp-cli.test.js`. Add a real-git fixture helper `bookkeepingRepo()` modeled on the existing `real git:` test: `initRepo`, commit `stories/app.yaml`, `src/a.js`, and a declaration at `.claude-tweaks/verify-scope.json` = `{ checks: { tests: 'node --test' }, rules: [{ match: 'docs/plans/*-ledger.md', suites: [], static: false }, { match: 'src/**', suites: '*', static: true }] }` (probed: `readDeclaration` returns `ok`); write the stamp with `run(['--write', '--report', rp], realDeps)` at commit S; return `{ root, S, gitDirPath, stampPath, g, realDeps }` where `realDeps()` binds `cwd: () => root`, `exec: (c, a, o) => execFileSync(c, a, { ...o, cwd: root })`, `gitDir`, `dirty: () => computeDirty(execFileSync, root)`, and `gitInfo: () => ({ sha: <git rev-parse HEAD in root>, dirty: null })`. Each test commits its delta, then runs `--check --stories login=app.yaml`:
  - `AC1.1/AC1.2: a ledger-only commit past S with --scope skips as covered-bookkeeping-delta, and the stamp is byte-identical` — commit `docs/plans/x-ledger.md`; `--scope .claude-tweaks/verify-scope.json` → `{ skip: true, reason: 'covered-bookkeeping-delta', sha: S }`; stamp file bytes equal before/after.
  - `AC2.1: a delta that also touches a suite-mapped path stays sha-mismatch` — commit the ledger and an edit to `src/a.js` → `{ skip: false, reason: 'sha-mismatch', sha: S }`.
  - `AC3.1: the same ledger-only delta without --scope stays sha-mismatch`.
  - `AC4.1: a selected story file changed since the stamp reports story-changed` — commit the ledger and an edit to `stories/app.yaml` (also add `{ match: 'stories/**', suites: [], static: false }` to this test's declaration before stamping so the delta is still `none`) → `story-changed: login`.
  - `AC5.1: a stamp sha that is not an ancestor of HEAD stays sha-mismatch` — write the stamp, then `git commit --amend` S's tree (or reset to a sibling commit via a new branch) so S is not an ancestor; exit code 0.
  - `AC5.2: a missing or unparseable --scope path stays sha-mismatch, exit 0` — `--scope nope.json` and `--scope` pointing at a file containing `{`.
  - `AC6.1: a dirty tree with a bookkeeping-only delta reports dirty-tree` — commit the ledger, then leave an untracked `stray.txt`.
  - `--scope with no stamp reports no-stamp`.
  - `untracked QA artifacts under .claude-tweaks/artifacts/ do not defeat the bookkeeping-delta skip` — the fixture repo has no `.gitignore`; after the ledger commit, write untracked `.claude-tweaks/artifacts/x.png` → `covered-bookkeeping-delta`.
  - `every git call --check makes carries the cwd dep` — run the AC1.1 setup with `exec: (c, a, o) => { calls.push(o && o.cwd); return execFileSync(c, a, { ...o, cwd: root }); }` (the recorder captures the `cwd` `check` passed, before the fixture's own override); assert `calls.length > 0` and every recorded `cwd === root` (proves `check` binds `deps.cwd()` itself rather than relying on the fixture).
  - In the existing `malformed invocations exit 2` test, add `['--write', '--report', 'r.json', '--scope', 'x.json']` and `['--check', '--stories', 'a=b', '--scope']`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/verify/qa-stamp-cli.test.js`
Expected: FAIL — AC1.1 (`--scope` is an unknown argument today, exit 2) and the new malformed-invocation cases; AC3.1, AC6.1 pass as characterization.

- [ ] **Step 3: Implement** the Interfaces in `plugin/bin/qa-stamp.js`; add the `--scope` usage line to the header comment and `USAGE`, and a header paragraph naming the bookkeeping-delta classification and that `--check` never re-stamps.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/verify/qa-stamp-cli.test.js tests/bin-lib/verify/qa-stamp.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/qa-stamp.js tests/bin-lib/verify/qa-stamp-cli.test.js
git commit -m "Classify a bookkeeping-only delta in qa-stamp.js --check — --scope reuses verify.js's rule, refs #5643"
```

### Task 3: Skill prose and docs name the bookkeeping-delta skip

**Role:** integration

**Files:**
- Modify: `plugin/skills/test/SKILL.md` (the QA pass stamp sentence in the `VERIFICATION_PASSED=true` + stories bullet; 26,841 B now, rail 52,500 B — ample headroom)
- Modify: `plugin/skills/test/qa-reporting.md` (the "QA pass stamp (pipeline runs, #3003)" paragraph; 20,503 B now)
- Modify: `docs/plugin-structure.md` (line ~365 CLI line: add `[--scope <decl>]` to `--check`; line ~97 `qa-stamp.js` description: decideQaSkip also skips on a bookkeeping-only delta)
- Modify: `docs/journeys/skip-qa-stories-already-passed-at-head-3003.md` (the `--check` step: mention `--scope` and the `covered-bookkeeping-delta` outcome)
- Test: `tests/test-skill-qa-stamp-conformance.test.js`

**Interfaces:**
- Consumes: Task 2's CLI shape `--check --stories <id=file,...> [--stories-dir <dir>] [--scope <path>]` and reason `covered-bookkeeping-delta`.

- [ ] **Step 1: Write the failing tests** in `tests/test-skill-qa-stamp-conformance.test.js`, each using the file's `pinned(live, control, pattern)` helper against the current text as the frozen control (read it with `git show HEAD:plugin/skills/test/SKILL.md` before editing and paste the relevant sentence as a `PRE_*` constant):
  - `test('pipeline story selection passes --scope to qa-stamp.js --check when a declaration exists')` — `/qa-stamp\.js" --check --stories <id=file,\.\.\.> \[--stories-dir <dir>\] \[--scope \.claude-tweaks\/verify-scope\.json\]/` or equivalent wording naming `--scope .claude-tweaks/verify-scope.json`.
  - `test('the bookkeeping-delta skip has its own report and log line')` — the exact strings `QA: skipped — stories already passed at {short-sha}; only bookkeeping commits since` and `AUTO {time} — QA skipped: {k} selected stories already passed at {short-sha}, bookkeeping-only delta since (QA pass stamp). Reversibility: high.`
  - `test('qa-reporting.md names the bookkeeping-delta skip and the declaration it trusts')` — `/covered-bookkeeping-delta/` and `/suites: \[\]/` within the QA pass stamp paragraph.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/test-skill-qa-stamp-conformance.test.js`
Expected: FAIL on the three new tests.

- [ ] **Step 3: Edit the prose.** `SKILL.md`: pass `--scope .claude-tweaks/verify-scope.json` when the project has a declaration (the same declaration the scoped verify calls pass); on `skip: true` with reason `covered-bookkeeping-delta`, report and log the two exact strings above (the `AUTO` line is `AUTO`, not `STAGED`); keep every existing pinned phrase intact. `qa-reporting.md`: one sentence — `--check --scope` also skips when every commit since the stamp is bookkeeping by the project's declaration (`covered-bookkeeping-delta`), the stamp is never rewritten, and a project whose rendered content lives under a path mapped to `suites: []` with no static check must map it to a suite or static check to keep QA re-running on it. Update the two docs files per Files.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/test-skill-qa-stamp-conformance.test.js tests/bin-lib/verify/qa-stamp-cli.test.js tests/bin-lib/verify/qa-stamp.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/test/SKILL.md plugin/skills/test/qa-reporting.md docs/plugin-structure.md docs/journeys/skip-qa-stories-already-passed-at-head-3003.md tests/test-skill-qa-stamp-conformance.test.js
git commit -m "Route /test's QA stamp check through --scope — report and log the bookkeeping-delta skip, refs #5643"
```

## Consumer enumeration (plan-audit Check B/F, reviewed — not modified)

- Stamp-file readers `plugin/bin/acceptance-packet.js`, `plugin/bin/lib/wrap-up/packet-gather.js`, `plugin/skills/wrap-up/verification-brief.md` (and their tests `tests/acceptance-packet-cli.test.js`, `tests/bin-lib/wrap-up/packet-gather.test.js`): read `claude-tweaks-qa-pass.json` via `readQaStamp` and compare its `sha` to HEAD themselves. This change never rewrites the stamp nor changes its shape, so they are unaffected (a bookkeeping-delta skip leaves them seeing a stamp sha behind HEAD, exactly as today).
- `plugin/bin/qa-report.js`, `plugin/bin/lib/qa-report/compose.js`, `tests/bin-lib/qa-report/cli.test.js`, `tests/qa-report-writer-conformance.test.js`, `tests/multi-agent-coordination.test.js`: mention `qa-stamp.js --write` ordering only; `--write` is unchanged.
- `tools/test-durations.json`, `docs/superpowers/plans/2026-11-17-*.md`, `docs/superpowers/specs/2026-11-17-*.md`: historical/timing data, keyword matches only.
- `plugin/bin/lib/verify/scope.js`, `plugin/bin/lib/verify/changed-files.js`: read only (reused, not edited) — Task 2.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (`--scope`, classification) | Task 2 |
| Deliverable 2 (`--check` read-only) | Task 2 (AC1.2) |
| Deliverable 3 (`decideQaSkip` input) | Task 1 |
| Deliverable 4 (SKILL.md paragraph) | Task 3 |
| Deliverable 5 (qa-reporting.md sentence) | Task 3 |
| Deliverable 6 (tests) | Tasks 1-2 |
| AC1-AC6 | Task 2 (AC1.1, AC1.2, AC2.1, AC3.1, AC4.1, AC5.1, AC5.2, AC6.1) |
