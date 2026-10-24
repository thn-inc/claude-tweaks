# Ceremony Diff-Facts CLI Implementation Plan (#3955)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `wrap-up/ceremony-derivation.md` step 1's hand-composed two-call shell pipeline with one `node` CLI that prints `computeDiffFacts`'s JSON.

**Architecture:** Extract the merge-base + `git diff --numstat -z` + `parseNumstatZ` gather that `computeBlastRadius` already runs into an exported `gatherDiffFiles` in `plugin/bin/lib/blast-radius-cli.js`, so the two CLIs share one gather. A new `plugin/bin/diff-facts.js` (`run(argv, deps)` seam) calls `gatherDiffFiles` and prints `computeDiffFacts(files)` from `plugin/bin/lib/dispatch/ceremony-derive.js` (which stays pure). The skill prose then names that one command, and the conformance test pins it and runs it for real.

**Tech Stack:** Node 18+, `node --test`, git CLI. Zero npm deps.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T082946-record-3955/work/3955-spec.md`

## Global Constraints

- CLI path: `plugin/bin/diff-facts.js`. Skill prose invokes it only as `node "${CLAUDE_PLUGIN_ROOT}/bin/diff-facts.js" --integration-branch {integration-branch}` (never a repo-relative `node plugin/bin/…` — `tests/skill-prose-plugin-root-invocations.test.js`).
- Output on success: exactly `computeDiffFacts`'s object (`fileCount`, `testFiles`, `docsFiles`, `implFiles`, `totalLines`, `testOnly`, `docsOnly`, `lowSurface`), one JSON line on stdout, exit 0. No extra keys, so the same JSON stays valid input for `resolve-profile.js --diff-facts`.
- Exit codes mirror its sibling `blast-radius.js`: any failure (unknown flag, missing value, neither `--base` nor `--integration-branch`, unresolvable base, git error) exits 1 with one `diff-facts: …` stderr line and **no stdout**. A resolution failure must never read as a zero-file diff.
- `require.main === module` guard sets `process.exitCode = run(...)`, never `process.exit` (`tests/bin-lib/exit-code-conformance.test.js`).
- Diff range is `mergeBase..HEAD` (committed work), the same range `computeBlastRadius` diffs, with `--no-renames`. This deliberately replaces the old prose's `git diff --numstat -z {merge-base}` (merge-base vs working tree): the ceremony decision is about the work the branch ships, and sharing one gather keeps the ceremony facts and merge-check's blast radius on the same diff.
- `wrap-up/ceremony-derivation.md` must contain no `git merge-base` (AC2.1) and name `diff-facts.js` exactly once — on its command line.
- Commit messages: `{Verb} {what} — {detail}`, ending with `refs #3955` and the `Claude-Session:` trailer. Never `closes`/`fixes`.

## Review Focus

1. **A bare integration-branch name with a stale local ref** — `--integration-branch main` must resolve against `origin/main` when it exists, exactly as `blast-radius.js` does (`preferOriginRef`). Covered by reusing `gatherDiffFiles`; Task 1's e2e "stale local main" test pins it for this CLI.
2. **Unresolvable branch** — exit 1, stderr names the failure, stdout empty. Task 1 e2e test.
3. **Trailing bare flag** (`--integration-branch` with no value) — exit 1, no stdout, never an uncaught throw. Task 1 e2e test.
4. **Uncommitted edits in the working tree** — not counted (range is `mergeBase..HEAD`). Task 1 e2e test.
5. **Docs-only/test-only diff** — `lowSurface: true`, the case step 2 downgrades on. Task 1 e2e test.

---

### Task 1: `gatherDiffFiles` + `plugin/bin/diff-facts.js`

**Files:**
- Modify: `plugin/bin/lib/blast-radius-cli.js` (extract `gatherDiffFiles` out of `computeBlastRadius`)
- Create: `plugin/bin/diff-facts.js`
- Test: `tests/bin-lib/blast-radius-cli.test.js` (one new unit test)
- Test: `tests/diff-facts-cli-e2e.test.js` (new, sized like `tests/blast-radius-cli-e2e.test.js`)
- Modify: `docs/plugin-structure.md` (add the CLI's command line right after the `node plugin/bin/blast-radius.js …` line, ~line 205)

**Interfaces:**
- Produces: `gatherDiffFiles(opts: {base?: string, integrationBranch?: string}, deps?: {git?: (args: string[]) => string}) -> {mergeBase: string, files: {path, additions, deletions}[]}` exported from `plugin/bin/lib/blast-radius-cli.js`; throws `BlastRadiusError` on missing opts, unresolvable base, empty merge-base or a failed diff — the same messages `computeBlastRadius` throws today. `computeBlastRadius` becomes `gatherDiffFiles` + config + classification, behavior unchanged.
- Produces: `plugin/bin/diff-facts.js` exporting `run(argv: string[], deps?: {git?, stdout?: (s) => void, stderr?: (s) => void}) -> number` (0 or 1). Usage string: `usage: diff-facts.js (--base <ref> | --integration-branch <branch>)`.

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/blast-radius-cli.test.js` — add, reusing the file's own `fakeGit`/`SHA`:

```js
test('gatherDiffFiles: returns the merge base and parsed numstat files without reading policy config', () => {
  const git = fakeGit({
    'merge-base': () => `${SHA}\n`,
    diff: () => '10\t2\tplugin/bin/foo.js\u00005\t0\ttests/foo.test.js\u0000',
  });
  const out = gatherDiffFiles({ integrationBranch: 'main' }, { git });
  assert.strictEqual(out.mergeBase, SHA);
  assert.deepStrictEqual(out.files, [
    { path: 'plugin/bin/foo.js', additions: 10, deletions: 2 },
    { path: 'tests/foo.test.js', additions: 5, deletions: 0 },
  ]);
});
```

(No `rev-parse` handler: `preferOriginRef`'s `rev-parse --verify` probe throws on the fake and is caught, keeping the bare name. No `readFile` dep is passed and the fake throws on any unexpected subcommand, so a policy-config read would fail the test.)

`tests/diff-facts-cli-e2e.test.js` — spawn `node plugin/bin/diff-facts.js` in a temp git fixture built like `blast-radius-cli-e2e.test.js`'s `makeFixtureRepo` (`main` with `base.txt`, then `feature` adding `impl.js` = 3 lines, `tests/impl.test.js` = 1 line, `docs/notes.md` = 2 lines, all committed). Tests:

- `AC1.1: --integration-branch main prints the diff-facts JSON` — exit 0, `JSON.parse(stdout)` deep-equals `{fileCount: 3, testFiles: 1, docsFiles: 1, implFiles: 1, totalLines: 6, testOnly: false, docsOnly: false, lowSurface: false}`, stderr empty.
- `a test-plus-docs diff is lowSurface` — fixture variant without `impl.js`: `lowSurface: true`, `implFiles: 0`, `fileCount: 2`.
- `uncommitted working-tree edits are not counted` — after the commit, append a line to `impl.js` without committing: `fileCount` stays 3 and `totalLines` stays 6.
- `--base <sha> uses the given commit` — `--base $(rev-parse main)` yields the same object as `--integration-branch main`.
- `unresolvable integration branch exits 1 with stderr and NO stdout` — `--integration-branch no-such-branch`: status 1, stderr matches `/^diff-facts: could not resolve merge base/`, stdout `''`.
- `missing flags exits 1 with usage` — no args: status 1, stderr matches `/usage: diff-facts\.js/`, stdout `''`.
- `a trailing bare flag exits 1, never throws` — `--integration-branch` alone: status 1, stderr matches `/^diff-facts: --integration-branch requires a value/`, stdout `''`.
- `unknown flag exits 1` — `--bogus x`: status 1, stdout `''`.
- `a stale local main resolves against origin/main` — reuse the stale-local-main fixture shape from `blast-radius-cli-e2e.test.js` (`update-ref refs/remotes/origin/main` at the advanced commit, `branch -f main` back to root): `fileCount` is 1 (only `impl.js`), not 2.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/blast-radius-cli.test.js tests/diff-facts-cli-e2e.test.js`
Expected: FAIL — `gatherDiffFiles is not a function`, and every e2e case fails on the missing `plugin/bin/diff-facts.js` (MODULE_NOT_FOUND, exit 1 with empty stdout on the success cases).

- [ ] **Step 3: Implement**

`blast-radius-cli.js`: move the base check, `resolveMergeBase`, the empty-merge-base check, the `git diff --no-renames --numstat -z --end-of-options ${mergeBase}..HEAD` call and `parseNumstatZ` into `gatherDiffFiles(opts, deps)`; `computeBlastRadius` calls it, then `resolveConfig` + `blastRadiusSummary(classifyDiffFiles(...))` exactly as now. Export `gatherDiffFiles`. Update the file's header comment to name both consumers.

`diff-facts.js`: header comment in `blast-radius.js`'s style (what it is: wrap-up `ceremony-derivation.md` step 1's diff-facts gather as one process, #3955; usage; exit codes per Global Constraints; why a failure prints no stdout). Argv parse in a loop like `blast-radius.js`'s `main` (value-taking flags only: `--base`, `--integration-branch`; a missing value or a value starting with `--` → usage error). Call `gatherDiffFiles`, catch `BlastRadiusError` → `stderr('diff-facts: ' + firstLine)` and return 1; any other error rethrows. On success `stdout(JSON.stringify(computeDiffFacts(files)) + '\n')`, return 0. Defaults: `deps.stdout`/`deps.stderr` write to `process.stdout`/`process.stderr`. Guard: `if (require.main === module) process.exitCode = run(process.argv.slice(2));`.

`docs/plugin-structure.md`: after the `node plugin/bin/blast-radius.js …` line add `node plugin/bin/diff-facts.js (--base <ref> | --integration-branch <branch>)   # Diff-facts CLI — wrap-up ceremony-derivation.md step 1's gather as one process (refs #3955): merge base + numstat (shared with blast-radius.js via plugin/bin/lib/blast-radius-cli.js's gatherDiffFiles) + computeDiffFacts; prints one JSON object {fileCount, testFiles, docsFiles, implFiles, totalLines, testOnly, docsOnly, lowSurface}; ANY failure exits 1 with stderr and NO stdout (tests in tests/diff-facts-cli-e2e.test.js)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/blast-radius-cli.test.js tests/blast-radius-cli-e2e.test.js tests/diff-facts-cli-e2e.test.js tests/bin-lib/exit-code-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS, 0 failures (the blast-radius suites prove the extraction changed nothing).

Then, as one plain Bash call from this worktree (AC1.1's worktree-isolated form):
Run: `node plugin/bin/diff-facts.js --integration-branch main`
Expected: exit 0, one JSON line carrying `fileCount`, `testFiles`, `docsFiles`, `implFiles`, `totalLines`, `lowSurface`.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/blast-radius-cli.js plugin/bin/diff-facts.js tests/bin-lib/blast-radius-cli.test.js tests/diff-facts-cli-e2e.test.js docs/plugin-structure.md
git commit -m "Add diff-facts.js — wrap-up's ceremony diff facts in one process, gather shared with blast-radius.js (refs #3955)"
```

### Task 2: Point `ceremony-derivation.md` step 1 at the CLI and re-pin the conformance test

**Files:**
- Modify: `plugin/skills/wrap-up/ceremony-derivation.md:29-47` (step 1 only)
- Modify: `tests/diff-facts-parse-numstat-conformance.test.js` (replace the `compositionFor` / win32-splice / `#3829` pre-split tests; keep both `AC1.1` `assertNamesParser` tests and the negative control unchanged)
- Modify: `docs/journeys/work-around-a-refused-worktree-bash-command-2776.md` (line 32's "`wrap-up/ceremony-derivation.md`'s diff-facts call is the documented case" clause becomes false — drop that clause, keep the generic workaround; drop `plugin/skills/wrap-up/ceremony-derivation.md` from its `files:` frontmatter, line 7)
- Modify: `docs/plugin-structure.md` (the `ceremony-derive.js (#1545 — …) Consumed by plugin/skills/wrap-up/ceremony-derivation.md` clause, line 64 → `Consumed by plugin/bin/diff-facts.js, which plugin/skills/wrap-up/ceremony-derivation.md invokes`)

Moved-prose pin check: the replaced sentences ("Two separate Bash calls", "paste the printed sha", "reuse `classifyDiffFiles`") are pinned nowhere but `tests/diff-facts-parse-numstat-conformance.test.js` (grep of `tests/ plugin/ docs/ .claude/skills/` returned only the skill file itself). Other pins on this file that must stay green: `tests/bin-lib/dispatch/ceremony-derive.test.js`'s PROMPT_PROSE_DIRS twin (step 2's `skills/`, `agents/`, or `commands/` sentence — untouched), `tests/ceremony-derivation-mode-gate.test.js`, `tests/fast-lane-digest.test.js`. `build/dispatch.md`'s "the runnable composition is in `skills/wrap-up/ceremony-derivation.md` step 1" stays true (step 1 still holds the runnable command) — not edited.

**Interfaces:**
- Consumes: Task 1's `plugin/bin/diff-facts.js` and its exit-1-no-stdout contract.

- [ ] **Step 1: Write the failing tests** in `tests/diff-facts-parse-numstat-conformance.test.js`

Factor one checker both the positive test and the go-red controls call:

```js
const ONE_COMMAND = 'exactly one diff-facts.js line, the documented command';
const NO_MERGE_BASE = 'no git merge-base anywhere in the file';
const COMMAND = 'node "${CLAUDE_PLUGIN_ROOT}/bin/diff-facts.js" --integration-branch {integration-branch}';
function commandFactsMissing(text) { /* returns the facts the text fails, in [ONE_COMMAND, NO_MERGE_BASE] order */ }
```

- `ONE_COMMAND`: exactly one line contains `diff-facts.js`, and its trimmed text equals `COMMAND` (exact equality already excludes a pipe, `node -e` or a `$(` on it).
- `NO_MERGE_BASE`: `!text.includes('git merge-base')`.

Tests:
- `AC2.1: ceremony-derivation.md names the diff-facts command once and carries no git merge-base` — `assert.deepStrictEqual(commandFactsMissing(CEREMONY), [])`.
- `AC2.1 go-red: each fact fails alone on a doctored copy of the live text` — doctor the live `CEREMONY` (assert each doctoring changed the text) and assert the checker's exact output: append `\ngit merge-base HEAD origin/main\n` → `[NO_MERGE_BASE]`; replace `{integration-branch}` on the command line with `"$(git branch --show-current)"` → `[ONE_COMMAND]`; append a second line `` `bin/diff-facts.js` `` → `[ONE_COMMAND]`.
- `AC3.1: the documented command runs and yields a diff-facts object` — build a temp repo (`main` base commit, `feature` committing `src/a.js` with 3 lines), take the `COMMAND` line from the live text, replace `${CLAUDE_PLUGIN_ROOT}` with `PLUGIN` and `{integration-branch}` with `main`, run `spawnSync('sh', ['-c', cmd], { cwd: repo, encoding: 'utf8' })`: status 0, `facts.fileCount === 1`, `facts.implFiles === 1`, `facts.lowSurface === false`.

Delete `compositionFor`, the `node -e` run test, the win32 splice test, `preSplitFactsMissing` and its two `#3829` tests (the composition they pin is gone). `pluginRootFor`/`toPosix` stay only if still used; otherwise remove them and the now-unused imports. Update the header comment: #2869's parser-naming pin plus #3955's single-command pin.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/diff-facts-parse-numstat-conformance.test.js`
Expected: FAIL — `AC2.1` reports `[ONE_COMMAND, NO_MERGE_BASE]` against today's text, and the go-red test fails its "changed the text" assertion on the `{integration-branch}` doctoring (no `diff-facts.js` line; `git merge-base HEAD origin/main` present); `AC3.1` fails finding no command line. The two `AC1.1` tests and the negative control still pass.

- [ ] **Step 3: Rewrite step 1 of `ceremony-derivation.md`**

Replace step 1 (from `1. Compute this run's diff facts:` through the closing ``` of the `git diff … | node -e` block) with, in the file's voice:

1. A prose paragraph: compute this run's diff facts with one command, from the worktree — it resolves the merge-base of `HEAD` against the integration branch (preferring `origin/{branch}`), parses `git diff --numstat -z` with `parseNumstatZ` (`bin/lib/git-z.js`) and prints `computeDiffFacts`'s JSON (`bin/lib/dispatch/ceremony-derive.js`) — the same gather `blast-radius.js` runs for merge-check, so the two read one diff. Resolve `{integration-branch}` per `_shared/integration-branch.md` and substitute it and the literal plugin root (the skill's `Base directory` minus `skills/{name}`) as literals. This paragraph must keep `parseNumstatZ`, `git-z.js` and `computeDiffFacts` in that order within 400 characters (the `AC1.1` pin) and must **not** name `diff-facts.js` (it is named once, on the command line).
2. A fenced `bash` block holding exactly `COMMAND`.
3. One sentence: a non-zero exit prints nothing on stdout — derive nothing, leave `config.yml` untouched (the header-fold `standard` stands), and log `SKIP {time} — Ceremony profile derivation (skipped): diff-facts.js exited {n} ({stderr line}) → fallback: header-fold default kept. Reversibility: n/a.` via `log-decision.js --status SKIP`, per `_shared/auto-decision-log.md`'s Degrade-trace rule.

Steps 2-3 and everything after stay byte-identical.

Then the two doc edits named in Files.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/diff-facts-parse-numstat-conformance.test.js tests/bin-lib/dispatch/ceremony-derive.test.js tests/ceremony-derivation-mode-gate.test.js tests/fast-lane-digest.test.js tests/skill-prose-plugin-root-invocations.test.js tests/integration-branch-conformance.test.js`
Expected: PASS, 0 failures.

Run: `grep -F "git merge-base" plugin/skills/wrap-up/ceremony-derivation.md`
Expected: no output, exit 1 (AC2.1).

Run: `grep -c "diff-facts.js" plugin/skills/wrap-up/ceremony-derivation.md`
Expected: `1`.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/ceremony-derivation.md tests/diff-facts-parse-numstat-conformance.test.js docs/journeys/work-around-a-refused-worktree-bash-command-2776.md docs/plugin-structure.md
git commit -m "Point ceremony-derivation step 1 at diff-facts.js — one command replaces the pre-split git pipeline (refs #3955)"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 — single-process entry point | Task 1 |
| Deliverable 2 — step 1 names the one command | Task 2 |
| Deliverable 3 — conformance test pins the new command | Task 2 |
| AC1.1 | Task 1 Step 1 (`AC1.1` e2e test) + Step 4 plain Bash run |
| AC2.1 | Task 2 Step 1 (`AC2.1` tests) + Step 4 greps |
| AC3.1 | Task 2 Step 1 (`AC3.1`) + Step 4 |
