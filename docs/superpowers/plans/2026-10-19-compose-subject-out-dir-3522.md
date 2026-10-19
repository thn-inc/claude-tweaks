# Guard-Safe Merge Snippet (compose-subject `--out-dir`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every merge fence that calls `bin/compose-subject.js` runnable without `eval` or a `$(…)` command substitution. The worktree Bash guard refuses both, so the pr-first merge snippet becomes runnable verbatim from a worktree session.

**Architecture:** `compose-subject.js` gains an `--out-dir <dir>` output mode. It writes `title.txt`, `body.md`, and `message.txt` (title, blank line, body) and prints the title on stdout as one POSIX single-quoted line. The two pr-first `gh pr merge` fences become plain one-command-per-fence calls: compose to files, then `gh pr merge … -t {title-arg} --body-file "{subject-dir}/body.md"`. The four local-merge fences take `git merge --no-ff {branch} -F "{subject-dir}/message.txt"`. `tests/merge-subject-composer-conformance.test.js` is rewritten to pin the new shapes and forbid `eval "$SUBJECT_EXPORTS"` / `--shell` at every merge site.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T035144-record-3522/work/3522-spec.md` (record #3522)

**Scope keywords:** SUBJECT_EXPORTS, SUBJECT_TITLE, SUBJECT_BODY, compose-subject

## Global Constraints

- The existing `--shell` and default JSON output modes stay unchanged. Other callers and tests rely on them, and this record is additive at the CLI.
- `--out-dir` file contents equal the `--shell` form's `SUBJECT_TITLE` / `SUBJECT_BODY` values exactly: no trailing newline is added, and the text is not re-quoted.
- Merge fences carry no `eval`, no `$(…)` wrapping `gh`, and no `SUBJECT_EXPORTS=` variable.
- Commit messages: `{Verb} {what} — {detail}`, reference the record as `refs #3522`, never `closes`/`fixes`. End each with `Claude-Session: https://claude.ai/code/session_01DzAvmzwATt78LXjCUoV6Go`.
- Skill-prose files stay under their byte ceilings. `plugin/skills/dispatch/settle-and-merge.md` is 46,316 bytes against the 51,200 shared ceiling, so keep its edit net-neutral.

## Review Focus

1. **A title containing `$(…)`, backticks, or `'`** (this record's own title has `$(…)`). Pasting it into a double-quoted `-t "…"` would execute it. The stdout line must be `shellQuote(title)` so a verbatim paste is inert. This is pinned in Task 1 (`AC2.2` test with record 2262 `It's quoted`).
2. **Composer failure must write nothing.** A stale `body.md` from an earlier merge in the same `{subject-dir}` would otherwise be merged. Each run should write fresh files only after composition succeeds, and on exit 1 the directory is left untouched. Task 1 pins this (`no files on uncomposable record`).
3. **An unwritable `--out-dir`** (a permission error or a path that is a file) must exit non-zero, never 0 with missing files. Task 1 pins this (`write failure exits 3`).
4. **`--out-dir` together with `--shell`** has an ambiguous output contract, so it is rejected as a usage error, exit 1. Task 1 pins this.
5. **The pr-first degrade fence** (immediate merge under `merge-verification: off`) runs in a separate Bash call from the `--auto` fence. It must compose its own files, not rely on the first fence's directory surviving. The current conformance test already asserts two composer calls in Step 3; Task 2 keeps that count assertion.

---

### Task 1: `--out-dir` output mode in compose-subject.js

**Files:**
- Modify: `plugin/bin/lib/compose-subject.js` (header usage/output/exit-code comments at lines 17-33, `USAGE` line 64, `parseArgs` lines 87-113, `realDeps` lines 215-230, output branch lines 355-359)
- Test: `tests/bin-lib/compose-subject.test.js`
- Modify: `docs/plugin-structure.md:185` (the CLI usage line: add `[--out-dir <dir>]` and describe the file-emitting form)

**Interfaces:**
- Produces: CLI flag `--out-dir <dir>`. On exit 0 it writes `<dir>/title.txt` (= composed title), `<dir>/body.md` (= composed body), and `<dir>/message.txt` (= `${title}\n\n${body}`), creating `<dir>` recursively, and prints `shellQuote(title) + '\n'` on stdout. New deps: `mkdirp(dir: string): void`, `writeFile(path: string, text: string): void`. `parseArgs` returns `outDir: string|null`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/compose-subject.test.js`. Extend `fakeDeps` with `mkdirp`/`writeFile` that record into `out.files` (a `{path: text}` map) and `out.dirs`. Accept an optional `writeError` that makes `writeFile` throw. Tests:
  - `AC2.1: --out-dir writes title.txt/body.md/message.txt equal to the --shell values`. Run `['2251', '--tag', 'human-approved']` (JSON mode) to get `{title, body}`. Run again with `--out-dir`, `'/x/subj'`, and assert `out.files['/x/subj/title.txt'] === title`, `body.md === body`, `message.txt === title + '\n\n' + body`. Also run `--shell` and assert its stdout `=== 'SUBJECT_TITLE=' + shellQuote(title) + '\nSUBJECT_BODY=' + shellQuote(body) + '\n'`, which ties the file values to the shell form. Assert `out.dirs` includes `'/x/subj'`. Use `path.join` for the expected keys so the test is OS-neutral.
  - `AC2.2: --out-dir stdout is the single-quoted title on one line` for record 2262 (`It's quoted`): stdout `=== shellQuote(title) + '\n'`, and it contains exactly one `\n`.
  - `--out-dir and --shell together is a usage error, exit 1`, with nothing written.
  - `--out-dir with no value is a usage error`: `parseArgs(['2251','--out-dir']).error` is truthy, and `parseArgs(['2251','--out-dir','d']).outDir === 'd'`.
  - `no files on an uncomposable record`: record 2290 (no Release Note) with `--out-dir` gives exit 1 and `Object.keys(out.files).length === 0`.
  - `write failure exits 3 naming the path`: `writeError` gives exit 3, with stderr matching `/compose-subject\.js: could not write .*title\.txt/`.
  - `USAGE advertises --out-dir`: `assert.match(USAGE, /\[--out-dir <dir>\]/)`.
  - `real fs: --out-dir creates the directory and writes the files`. Spread `realDeps.mkdirp`/`realDeps.writeFile` into the fake deps, with an `fs.mkdtempSync` root plus a nested `a/b` that does not exist yet. Assert the three files read back equal to the JSON values, and remove the tmp dir in `t.after`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/compose-subject.test.js`
Expected: FAIL. The new tests fail (`unknown argument: --out-dir`, or `realDeps.mkdirp is not a function`); existing tests still pass.

- [ ] **Step 3: Implement.** In `parseArgs`, add `outDir: null` to the defaults and handle `--out-dir` as a value flag with the same missing-value check as `--repo` (store it to `opts.outDir`, not `opts['out-dir']`). After the existing `--range`/`--pr` exclusivity check, add the error `'--out-dir and --shell are mutually exclusive'`. Add `mkdirp: (d) => fs.mkdirSync(d, { recursive: true })` and `writeFile: (p, s) => fs.writeFileSync(p, s, 'utf8')` to `realDeps` (require `fs` and `path`). In the output branch, when `opts.outDir` is set, call `deps.mkdirp(opts.outDir)` and then write the three files with `path.join`. Wrap these in try/catch: on throw, `deps.stderr(`compose-subject.js: could not write ${file}: ${errMessage(err)}\n`)` and return 3. On success, `deps.stdout(shellQuote(composed.title) + '\n')`. Update `USAGE` to `… [--shell] [--out-dir <dir>] [--help]`. Update the header comment: add the `--out-dir` output description, explain why it exists (the worktree Bash guard refuses `eval` and `$(…)` around `gh`, #3522), and add exit 3's "or an `--out-dir` write failed" clause. In the `Decision (#2319)` comment, replace "(`|| exit 1`)" with "(the composer exiting non-zero stops the fence before any merge)", since pr-first fences no longer carry `|| exit 1`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/compose-subject.test.js`
Expected: PASS, all tests, 0 fail.

- [ ] **Step 5: Live check (AC2).** Run `node plugin/bin/compose-subject.js 3417 --tag human-approved --out-dir {scratch}/x`, then `node plugin/bin/compose-subject.js 3417 --tag human-approved` (JSON). Compare `{scratch}/x/title.txt` and `{scratch}/x/body.md` against the JSON `title` and `body` with a `node -e` that `JSON.parse`s the second output and `readFileSync`s the files. Expected: `true true`. `{scratch}` is a scratch directory outside the repo.

- [ ] **Step 6: Update `docs/plugin-structure.md:185`.** Add `[--out-dir <dir>]` to the usage. Then replace "JSON or eval-able --shell output" with "JSON, eval-able --shell output, or --out-dir files (title.txt / body.md / message.txt, title single-quoted on stdout — the guard-safe form every merge fence uses)". Add "or an --out-dir write failed" to exit 3.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/compose-subject.js tests/bin-lib/compose-subject.test.js docs/plugin-structure.md
git commit -m "Add compose-subject --out-dir — file-emitting form for guard-safe merge fences, refs #3522"
```

### Task 2: Rewrite pr-first-merge.md Step 3's two merge fences

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md:291-296` (the `--auto` fence) and `:329-334` (the `merge-verification: off` immediate-merge degrade fence), plus a short placeholder-definition paragraph directly after the first fence
- Test: `tests/merge-subject-composer-conformance.test.js` (pr-first test, lines 45 and 50-66)
- Modify: `docs/journeys/pre-authorize-a-flow-runs-merge.md:31`

**Interfaces:**
- Consumes: Task 1's `--out-dir` (files `body.md`; stdout = single-quoted title).
- Produces: the canonical definitions of the placeholders `{subject-dir}` and `{title-arg}`. Task 3's local-merge fences cite them by path (`_shared/pr-first-merge.md` Step 3).

- [ ] **Step 1: Write the failing test.** In `tests/merge-subject-composer-conformance.test.js`, replace `PR_FIRST_COMPOSER_CALL` with `/node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/compose-subject\.js" [^\n]*--pr \{pr-number\} --out-dir \{subject-dir\}\n/` (the composer line ends there: no `|| exit 1` and no `--shell`). Change the squash-site matcher to `/gh pr merge \{pr-number\} --repo \{owner\}\/\{repo\} (--auto )?--squash -t \{title-arg\} --body-file \{subject-dir\}\/body\.md/g`, keeping `length === 2` and the composer-call count `=== 2`. Add:
  - `AC1.1: pr-first-merge.md carries no eval "$SUBJECT_EXPORTS"`. Use `text.split('eval "$SUBJECT_EXPORTS"').length - 1 === 0`, a fixed-string count that is portable where BSD `grep` reads the `$` as an anchor. Also assert no `SUBJECT_EXPORTS=`, no `--shell`, and no line matching `/^\s*gh [^\n]*\$\(/m`.
  - `AC3.1: each pr-first fence is one plain command`. For every ```` ```bash ```` fence in Step 3 that contains `compose-subject.js` or `gh pr merge`, assert the fence body is a single line with no `eval`, `$(`, `&&`, `||`, `;`, or backslash continuation.
  - Go-red: add `PRE_EVAL_PR_FIRST_SITE`, a frozen byte-for-byte copy of today's lines 292-295 (the `SUBJECT_EXPORTS=$(…) || exit 1` / `eval` / `gh pr merge … --auto --squash \` / `-t "$SUBJECT_TITLE" -b "$SUBJECT_BODY"` block). Assert it does not match the new `PR_FIRST_COMPOSER_CALL` and that it does contain `eval "$SUBJECT_EXPORTS"`, so the AC1.1 check can go red.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/merge-subject-composer-conformance.test.js`
Expected: FAIL. The pr-first test and AC1.1 fail against the live `eval` form.

- [ ] **Step 3: Rewrite both fences.** Each fence becomes two separate fences, one command each:

````markdown
```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue-list} --tag {tag} --pr {pr-number} --out-dir "{subject-dir}"
```

```bash
gh pr merge {pr-number} --repo {owner}/{repo} --auto --squash -t {title-arg} --body-file "{subject-dir}/body.md"
```
````

The degrade fence is identical without `--auto`, and it re-runs its own composer call, keeping the existing F1 property. After the first pair, add one paragraph covering:
- Run each fence as its own Bash call, never chained. If the composer exits non-zero, stop before any merge (the composer's stderr names the reason). This replaces the old `|| exit 1`.
- `{subject-dir}` is a literal path. Resolve it once with the plain call `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" SUBJECT_DIR=merge-subject-{pr-number}` and paste the printed path in place of the placeholder. It is session-scoped per `_shared/session-tmp-root.md`.
- `{title-arg}` is the composer's one stdout line, pasted verbatim. It is already POSIX single-quoted, so a title carrying `$(…)`, backticks, or `'` stays inert.
- Why: the worktree Bash guard refuses `eval` and a `gh` argument computed at runtime, and every pr-first merge runs from a worktree session (#3522).

Keep the paragraph tight, under 900 bytes. The file is at 33,853 bytes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/merge-subject-composer-conformance.test.js`
Expected: the pr-first, AC1.1 and AC3.1 tests PASS. The local-site tests still pass, since they are unchanged until Task 3.

- [ ] **Step 5: AC1 shell check.** Run `grep -cF 'eval "$SUBJECT_EXPORTS"' plugin/skills/_shared/pr-first-merge.md`. Expected: `0`. Use `-F`: plain `grep -c` on macOS reads the mid-pattern `$` as an anchor and prints 0 even before the change.

- [ ] **Step 6: AC3 live guard probe.** From the worktree, run the rewritten fences verbatim with real values, one Bash call each:
  1. `node plugin/bin/session-tmp-resolve.js SUBJECT_DIR=merge-subject-probe-3522`
  2. `node plugin/bin/compose-subject.js 3417 --tag human-approved --pr 999999 --out-dir {printed path}`
  3. `gh pr merge 999999 --repo thn-inc/claude-tweaks --auto --squash -t {stdout line from 2} --body-file {printed path}/body.md`

  PR 999999 does not exist, so nothing can merge. No `commit-scope-paths` is set in this repo, so `--pr` is never diffed. Expected: none of the three is refused by the worktree guard ("too complex to verify" / "value computed at runtime"). Call 3 reaches gh and fails with `Could not resolve to a PullRequest with the number of 999999`. Record the three outputs in the task report.

- [ ] **Step 7: Update `docs/journeys/pre-authorize-a-flow-runs-merge.md:31`.** Replace `… --pr {pr-number} --shell`, then `gh pr merge --squash -t "$SUBJECT_TITLE" -b "$SUBJECT_BODY"` with `… --pr {pr-number} --out-dir "{subject-dir}"`, then `gh pr merge --squash -t {title-arg} --body-file "{subject-dir}/body.md"`.

- [ ] **Step 8: Commit**

```bash
git add plugin/skills/_shared/pr-first-merge.md tests/merge-subject-composer-conformance.test.js docs/journeys/pre-authorize-a-flow-runs-merge.md
git commit -m "Rewrite pr-first-merge Step 3 fences — compose to files, no eval or \$(…) around gh, refs #3522"
```

### Task 3: Migrate the four local-merge fences off `--shell`/`eval`

**Files:**
- Modify: `plugin/skills/_shared/local-merge-auto-finish.md:118-122`
- Modify: `plugin/skills/wrap-up/auto-merge-short-circuit.md:268-272`
- Modify: `plugin/skills/dispatch/settle-and-merge.md:400-404`
- Modify: `plugin/skills/flow/worktree-merge.md:63-67`
- Test: `tests/merge-subject-composer-conformance.test.js` (`LOCAL_COMPOSER_CALL`, `LOCAL_MERGE_FORM`, local-sites loop)
- Test: `tests/auto-merge-short-circuit-verdict-backstop.test.js:121` (an anchor `FLAT.indexOf('git merge --no-ff {branch} -m "$SUBJECT_TITLE')`; leave the frozen `PRE_CHANGE` excerpt at line 42 untouched)
- Modify: `docs/journeys/merge-a-record-with-a-conventional-subject-2251.md` (lines 30, 33, 37, 44)
- Modify: `docs/journeys/finish-a-local-merge-run-without-a-human.md:30`

**Interfaces:**
- Consumes: Task 1's `--out-dir` (`message.txt`), and Task 2's `{subject-dir}` definition (cite `_shared/pr-first-merge.md` Step 3, do not restate it).

- [ ] **Step 1: Write the failing tests.** In the conformance test, set `LOCAL_COMPOSER_CALL = /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/compose-subject\.js" [^\n]*--range \{[a-z-]+\}\.\.\.\{[a-z-]+\} --out-dir \{subject-dir\} \|\| exit 1\n/` and `LOCAL_MERGE_FORM = /git merge --no-ff \{[a-z-]+\} -F \{subject-dir\}\/message\.txt/`. In the local-sites loop, add assertions that each site has no `eval "$SUBJECT_EXPORTS"` (fixed-string count 0), no `SUBJECT_EXPORTS=`, no `--shell`, and no `$SUBJECT_TITLE`. Add a go-red frozen excerpt `PRE_EVAL_LOCAL_SITE` (today's `local-merge-auto-finish.md` lines 118-122 byte-for-byte) and assert it fails both new patterns. Keep the existing `PRE_RANGELESS_CALL` go-red assertions. They still hold: the rangeless calls lack `--range … --out-dir`. In the backstop test, change the line-121 anchor to `'git merge --no-ff {branch} -F "{subject-dir}/message.txt"'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/merge-subject-composer-conformance.test.js tests/auto-merge-short-circuit-verdict-backstop.test.js`
Expected: FAIL after Step 1. All four local-site tests fail, and the backstop ordering test fails (`merge` index is -1).

- [ ] **Step 3: Rewrite each fence.** Replace the three-line `SUBJECT_EXPORTS=$(…) || exit 1` / `eval` / `git merge … -m "$SUBJECT_TITLE⏎⏎$SUBJECT_BODY"` block with two lines, keeping each site's own args and indentation:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue} --tag auto-finish --range {base-branch}...{feature-branch} --out-dir "{subject-dir}" || exit 1
git merge --no-ff {feature-branch} -F "{subject-dir}/message.txt"
```

`|| exit 1` stays at these four sites. Their fences are multi-line scripts run in one call from the main checkout (two of them inside an existing `if [ "$CURRENT" … ]` guard), where it is what stops the merge. The existing "composer failure" prose that cites `|| exit 1` stays accurate. At each site's first mention, add one short clause: `{subject-dir}` resolves per `_shared/pr-first-merge.md` Step 3. In `settle-and-merge.md`, keep the edit net-neutral in bytes (`wc -c` before and after; it must stay ≤ 46,400).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/merge-subject-composer-conformance.test.js tests/auto-merge-short-circuit-verdict-backstop.test.js`
Expected: PASS, 0 fail.

- [ ] **Step 5: Sweep for stragglers.** Run `git grep -n -F -e 'SUBJECT_EXPORTS' -e '$SUBJECT_TITLE' -e '$SUBJECT_BODY' -- plugin docs/journeys docs/plugin-structure.md`. Expected: no hits. Then update the two journeys files. In `merge-a-record-…-2251.md`, line 30 becomes the `--out-dir "{subject-dir}"` composer call. Line 33 drops the "A bare `eval "$(…)"` would have swallowed that" sentence: the exit status now stops the fence because the merge call runs only after a zero exit. Line 37 becomes `gh pr merge {pr} --squash -t {title-arg} --body-file "{subject-dir}/body.md"` (pr-first) or `git merge --no-ff {branch} -F "{subject-dir}/message.txt"` (local-merge). Line 44 changes `--shell` to `--out-dir "{subject-dir}"`. In `finish-a-local-merge-run-without-a-human.md:30`, `-m "$SUBJECT_TITLE\n\n$SUBJECT_BODY"` becomes `-F "{subject-dir}/message.txt"`. Add a `- Updated during build of #3522 (guard-safe --out-dir merge fences)` line to each journey's update log if it has one.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/_shared/local-merge-auto-finish.md plugin/skills/wrap-up/auto-merge-short-circuit.md plugin/skills/dispatch/settle-and-merge.md plugin/skills/flow/worktree-merge.md tests/merge-subject-composer-conformance.test.js tests/auto-merge-short-circuit-verdict-backstop.test.js docs/journeys/merge-a-record-with-a-conventional-subject-2251.md docs/journeys/finish-a-local-merge-run-without-a-human.md
git commit -m "Migrate local-merge fences to compose-subject --out-dir — git merge -F, no eval, refs #3522"
```

## AC coverage

- AC1 (`eval` count 0 in pr-first-merge.md): Task 2's `AC1.1` test and Step 5.
- AC2 (files equal `--shell` values): Task 1's `AC2.1`/`AC2.2` tests and Step 5's live check.
- AC3 (snippet not refused by the guard): Task 2's `AC3.1` test (shape) and Step 6 (live probe).
- AC4 (`npm test` passes): the full suite runs once centrally after Task 3 (`/build` Common Step 5).

Waived AC4.1: a whole-suite gate, not a unit-testable clause. It is verified by the central `npm test` run at `/build` Common Step 5 and `/test`, never by a per-task test.

**Composed-bytes note:** the `merge` bundle is `_shared/pr-first-merge.md` + `_shared/pr-checklist-refresh.md`, composed at `wrap-up/auto-merge-short-circuit.md:205` and `wrap-up/review-console.md:115`. It sits at 47,658 / 51,200. Task 2's growth of `pr-first-merge.md` must stay ≤ 900 bytes net, so that the bundle stays ≤ 48,600. Verify with `node --test tests/bin-lib/skill-audit/context-cost.test.js` in Task 2 Step 4.
