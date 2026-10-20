# Git Path-List `-z` Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `plugin/bin` git path-list read uses `-z` + a NUL split and passes `--end-of-options` before any ref/range/sha, so a non-ASCII path (`docs/café.md`) is never seen C-quoted and a dash-leading ref is never parsed as an option. A `_shared` contract states the rule, and a conformance test pins it.

**Architecture:** One small helper module, `plugin/bin/lib/git-z.js`, holds the three NUL parsers (plain path list, `--name-status` records, `git log -z` header+paths). Each reader switches its argv to `-z`/`--end-of-options` and parses through the helper. `verify/changed-files.js` and `compose-subject.js` are the existing reference implementations and stay untouched. The rule is written in a new `plugin/skills/_shared/git-path-read.md`, cited from `_shared/git-discipline.md` and the repo-local `gh-api-module-pattern` skill. `tests/git-path-read-conformance.test.js` scans every `plugin/bin/**/*.js` line for a quoted `'--name-only'`/`'--name-status'` argv token without a quoted `'-z'` on the same line.

**Tech Stack:** Node 18+ CommonJS, `node --test`, git ≥ 2.24 (`--end-of-options`; this machine has 2.56).

**Spec:** `.claude-tweaks/pipelines/2026-10-19T185702-record-3470/work/3470-spec.md` (record #3470)

## Global Constraints

- `-z` + NUL split on every `--name-only`/`--name-status`/`ls-tree --name-only`/`diff-tree --name-only` git read in `plugin/bin`; `--end-of-options` before any ref, range, or sha argument (not needed when the argv carries no ref, e.g. `diff --cached`, or `log -- paths` with no rev).
- `'-z'` must sit on the **same source line** as the `'--name-only'`/`'--name-status'` token — the conformance test is line-based.
- The reference implementations named in the contract are `plugin/bin/lib/verify/changed-files.js` and `plugin/bin/lib/compose-subject.js`. Do not modify either.
- Never trim `-z` output before splitting (a leading-space first path would be cut); trimming a NUL stream does nothing useful anyway.
- Commit messages: `{Verb} {what} — {detail}`, `refs #3470` (never `closes`/`fixes`), ending with `Claude-Session: https://claude.ai/code/session_01FYYGc1wBx9SgQ68ZV7QVxh`.

## Premise corrections (verified at build)

- `plugin/bin/lib/merge-size-probe.js` no longer exists — #3310 removed it with its only consumer (`plugin/bin/lib/wrap-up/pack.js:606`). Its deliverable and AC1's merge-size clause are void (`Waived AC1.1 (merge-size-probe.js part): module deleted by #3310`).
- Line numbers drifted: `engine-verify.js`'s `diff-tree` is at `:633`, `pre-tool-use.js`'s read is at `:337`.
- The record names five sites; the record's own AC2 grep also flags six more `--name-only`/`--name-status` argv readers lacking `-z`. They are in scope (policy `scope-creep: add-to-plan`): `hooks/worktree-reap.js:210`, `review-context/build.js:162`, `flow/preflight.js:128`, `docs-health/freshness.js:37`, `flow/artifact-overwrite-check.js:225`, plus the string-command reader `issues/backlog.js:131`.
- Sole-site grep (run at authoring): `git grep -n -E "['\"]--name-(only|status)['\"]" -- plugin/bin | grep -v -E "['\"]-z['\"]"` printed exactly 11 lines: compose-subject.js:333 (`gh pr diff` — not git, exempt), docs-health/freshness.js:37, flow/artifact-overwrite-check.js:225, flow/preflight.js:128, hooks/pre-tool-use.js:337, hooks/worktree-reap.js:210, release-preflight/pack.js:233, review-context/build.js:162, wrap-up/engine-verify.js:633, wrap-up/facts.js:173, wrap-up/facts.js:176. Every other hit already carries `'-z'`. The one string-command reader, `issues/backlog.js:131`, is not an argv array and so is not in this grep; Task 5 fixes it anyway. Out of scope: `--numstat`/`ls-files`/`status --porcelain` readers (not `--name-*`, not named by the record — the contract names them as not yet covered).

## Verified `-z` output shapes (git 2.56, scratch repo with `docs/café.md`)

- `diff --name-only -z` / `diff-tree --name-only -r -z` / `ls-tree --name-only -z`: `"docs/a.md\0docs/café.md\0"`.
- `diff --name-status -z`: `"M\0docs/café.md\0"`; a rename is `"R100\0old\0new\0"` (per changed-files.js's own parser, line 89).
- `diff --cached --name-status` (no -z): `"M\t\"docs/caf\\303\\251.md\"\n"` (the bug).
- `log -z --format=%x01%ct --name-only`: `"\x01<ts>\0\ndocs/b.md\0\x01<ts>\0\ndocs/a.md\0docs/café.md\0..."` — the header is NUL-terminated, and the **first path after each header carries one leading `\n`**.
- `log -z --name-status --format=%H`: `"<sha>\0\nA\0docs/a.md\0<sha>\0\nM\0docs/a.md\0A\0docs/café.md\0"` — the leading `\n` sits on the first **status** token after the header.
- `--end-of-options` accepted by `diff`, `diff-tree`, `ls-tree`, `log` on git 2.56.

## Review Focus

1. A path starting with whitespace as the first entry — a `.trim()` before splitting would corrupt it. Task 2 pins it for facts.js (`' lead.md'`).
2. A rename in `--name-status -z` output — three tokens, not two. If the pairing is off by one, every later record shifts. Task 1 (`parseNameStatusZ`) and Task 3 (pre-tool-use rejects a staged rename into policy.yml) pin it.
3. A `git log -z` commit whose header has no paths after it (a commit filtered to nothing) — the next token is another header, so it must not be stripped or treated as a path. Task 1 pins it (`splitLogZ` with two adjacent headers).
4. A dash-leading ref value (`-x`) reaching a reader — `--end-of-options` makes git reject it as a bad revision instead of parsing it as a flag. Task 1's conformance-adjacent assertion pins argv order on the fakes in Tasks 2/4; not separately live-tested.
5. A git read that fails (non-zero exit) — every reader keeps its existing degrade (empty list / null / `false`), never a throw. Unchanged code paths, and the existing tests keep covering them.

---

### Task 1: `git-z.js` NUL-stream parsers

**Files:**
- Create: `plugin/bin/lib/git-z.js`
- Test: `tests/bin-lib/git-z.test.js`

**Interfaces:**
- Produces:
  - `splitNul(raw: string | null | undefined): string[]` — split on `'\0'`, drop empty tokens; `null`/`undefined`/`''` → `[]`.
  - `parseNameStatusZ(raw: string | null | undefined): Array<{ status: string, paths: string[] }>` — `status` verbatim (`'M'`, `'R100'`); status starting with `R` or `C` takes two paths (`[old, new]`), otherwise one.
  - `splitLogZ(raw: string | null | undefined, isHeader: (token: string) => boolean): Array<{ header: string, tokens: string[] }>` — walks NUL tokens; a token where `isHeader(token)` is true opens a new record; the first token after a header has exactly one leading `'\n'` removed (only if present) before the header test and before being appended; empty tokens are skipped; tokens before any header are dropped.

- [ ] **Step 1: Write the failing test** `tests/bin-lib/git-z.test.js` with:
  - `splitNul('docs/a.md\0docs/café.md\0')` deepEquals `['docs/a.md', 'docs/café.md']`; `splitNul(null)` and `splitNul('')` → `[]`; `splitNul(' lead.md\0')` → `[' lead.md']`.
  - `parseNameStatusZ('M\0docs/café.md\0R100\0old.md\0new.md\0D\0gone.md\0')` deepEquals `[{status:'M',paths:['docs/café.md']},{status:'R100',paths:['old.md','new.md']},{status:'D',paths:['gone.md']}]`.
  - `splitLogZ('\x01100\0\ndocs/b.md\0\x01200\0\x01300\0\ndocs/a.md\0docs/café.md\0', (t) => t.startsWith('\x01'))` deepEquals `[{header:'\x01100',tokens:['docs/b.md']},{header:'\x01200',tokens:[]},{header:'\x01300',tokens:['docs/a.md','docs/café.md']}]`.
  - `test('AC1.1: real git -z output reports docs/café.md unquoted', …)`: build a temp repo (`fs.mkdtempSync(os.tmpdir())`, `git init -q`, user config, commit `docs/a.md`, then add `docs/café.md`, stage it). Assert `splitNul(git diff --cached --name-only -z)` includes `'docs/café.md'`, and `parseNameStatusZ(git diff --cached --name-status -z)` deepEquals `[{status:'A',paths:['docs/café.md']}]`. Commit it, then `splitLogZ(git log -z --format=%x01%ct --name-only, isHeader)` — the newest record's tokens deepEqual `['docs/café.md']`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/git-z.test.js`
Expected: FAIL with "Cannot find module" for `git-z.js`

- [ ] **Step 3: Implement the three functions in `plugin/bin/lib/git-z.js`**, `'use strict'`, no dependencies. Header comment: what `-z` fixes (`core.quotepath` C-quoting, embedded newline/tab) and a pointer to `skills/_shared/git-path-read.md`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/git-z.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — `git add plugin/bin/lib/git-z.js tests/bin-lib/git-z.test.js`, message `Add git-z NUL-stream parsers — shared by the path-list reader sweep`.

---

### Task 2: wrap-up readers (`facts.js`, `engine-verify.js`)

**Files:**
- Modify: `plugin/bin/lib/wrap-up/facts.js:14-177`
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js:633-637`
- Test: `tests/bin-lib/wrap-up/facts.test.js`, `tests/bin-lib/wrap-up/engine-verify.test.js:1453,2462`

**Interfaces:**
- Consumes: `splitNul`, `parseNameStatusZ` from `../git-z` (Task 1).
- Produces: `gatherFacts` return shape unchanged (`changedFiles: string[]`, `renamedDeleted: Array<{status:'R'|'D', oldPath, newPath|null}>`).

- [ ] **Step 1: Write the failing tests**
  - facts.test.js: `test('AC1.1: gatherFacts reports a non-ASCII changed path unquoted', …)` — in the existing temp-repo setup style, commit `docs/café.md` and ` lead.md` (leading space) after `baseSha` on the repo (use a fresh repo in the test if mutating the shared one breaks sibling tests). Assert `changedFiles` includes `'docs/café.md'` and `' lead.md'`, and never includes the string `'"docs/caf\\303\\251.md"'`. Add a rename+delete of non-ASCII paths, and assert `renamedDeleted` contains `{status:'R', oldPath:'docs/ö.md', newPath:'docs/ø.md'}`.
  - engine-verify.test.js: change both `diff-tree` fakes (`:1453`, `:2462`) to return NUL-delimited output (`'docs/a.md\0docs/b.md\0'`, `'docs/a.md\0'`). Add an assertion on the recorded `diff-tree` call at `:2468` that its args deepEqual `['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '--end-of-options', <sha>]`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/wrap-up/facts.test.js tests/bin-lib/wrap-up/engine-verify.test.js`
Expected: FAIL after Step 1 (facts: the C-quoted path is not matched; engine-verify: the argv assertion)

- [ ] **Step 3: Implement**
  - facts.js: `makeGitRunner(cwd)` returns `(args, { trim = true } = {})`, trimming only when `trim`. `changedFiles = splitNul(git(['diff', '--name-only', '-z', '--end-of-options', `${base}...HEAD`], { trim: false }))`. The R/D read becomes `['diff', '--diff-filter=RD', '--name-status', '-z', '--end-of-options', `${base}...HEAD`]` (untrimmed). `parseRenamedDeleted(raw)` maps `parseNameStatusZ(raw)` records to the same `{status, oldPath, newPath}` objects (`status[0]`, R → `paths[0]`/`paths[1]`, else `paths[0]`/`null`).
  - engine-verify.js: `['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '--end-of-options', sha]`, and loop over `splitNul(diff)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/wrap-up/facts.test.js tests/bin-lib/wrap-up/engine-verify.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — message `Read wrap-up git path lists with -z — facts.js and engine-verify.js no longer split C-quoted output`.

---

### Task 3: hook readers (`pre-tool-use.js`, `worktree-reap.js`)

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js:337-345` (the comment block at `:320-332` too, where it describes the tab-separated row shape)
- Modify: `plugin/bin/lib/hooks/worktree-reap.js:210`
- Test: `tests/hooks-policy-exemption.test.js`, `tests/hooks-worktree-reap.test.js`

**Interfaces:**
- Consumes: `parseNameStatusZ` from `../git-z` (pre-tool-use only; worktree-reap only checks emptiness).
- Produces: `isPolicyOnlyCommit` behavior unchanged (exactly one staged record, `paths.length === 1`, status in `A`/`M`/`D`, path `=== toPosix(POLICY_FILE)`); `isContentIdentical` unchanged.

- [ ] **Step 1: Write the failing tests**
  - hooks-policy-exemption.test.js: `test('AC1.1: the staged-file read uses -z', …)` — read `plugin/bin/lib/hooks/pre-tool-use.js` and assert the line containing `'--cached'` and `'--name-status'` also contains `'-z'`. (AC1.1's "reports the path unquoted" for this read is proven by Task 1's real-repo `parseNameStatusZ` test over the same `diff --cached --name-status -z` output, since `isPolicyOnlyCommit` returns only a boolean.) Add a behavioral regression test as well: in a repo whose HEAD tracks `docs/café.md`, stage only a modification of `.claude-tweaks/policy.yml` and confirm the exemption still fires. The existing rename-into-policy.yml denial test (`:265`) must still pass unchanged.
  - hooks-worktree-reap.test.js: add `isContentIdentical` test where the branch differs only by a non-ASCII file `docs/café.md` → `false`. This passes today too (emptiness check), so it is a regression guard, not the red step; the red step for this file is the argv being visible to the Task 6 conformance test.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/hooks-policy-exemption.test.js`
Expected: FAIL after Step 1 on the new `'-z'` argv assertion

- [ ] **Step 3: Implement**
  - pre-tool-use.js: `runGit(['diff', '--cached', '--name-status', '-z'], cwd)`; `const rows = parseNameStatusZ(stdout)`; `rows.length !== 1` → false; `rows[0].paths.length !== 1` → false (a rename/copy carries two); return `POLICY_COMMIT_STATUSES.has(rows[0].status) && rows[0].paths[0] === toPosix(POLICY_FILE)`. Update the adjacent comments to describe the `-z` record shape. No ref here, so no `--end-of-options`. Keep the try/catch never-throw wrapper.
  - worktree-reap.js: `runGit(['diff', '--name-only', '-z', '--end-of-options', integration, branch], repoRoot)`; keep `stdout.trim() === ''`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/hooks-policy-exemption.test.js tests/hooks-worktree-reap.test.js tests/hooks-pre-tool-use.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — message `Read hook git path lists with -z — policy-only commit check parses NUL records`.

---

### Task 4: tree/diff listing readers (`release-preflight/pack.js`, `flow/preflight.js`, `review-context/build.js`)

**Files:**
- Modify: `plugin/bin/lib/release-preflight/pack.js:233`
- Modify: `plugin/bin/lib/flow/preflight.js:126-139`
- Modify: `plugin/bin/lib/review-context/build.js:160-166`
- Test: `tests/bin-lib/flow/preflight.test.js:28,96,302,333`, `tests/bin-lib/review-context/build.test.js:403`

**Interfaces:**
- Consumes: `splitNul` from `../git-z`.
- Produces: unchanged return shapes (`listRootAtTip(): string[]`, `specOnBranch(): true|false|null`, `buildContext`'s `files`).

- [ ] **Step 1: Write the failing tests**
  - flow/preflight.test.js: change the `ls-tree` fakes to NUL output (`'x/work/7-spec.md\0'`; `''` stays `''`). Add an assertion on the recorded `ls-tree` calls (the `seen` array at `:302-311`) that each starts `['ls-tree', …, '--name-only', '-z', '--end-of-options', branch, '--', …]` (with `'-r'` after `'ls-tree'` on the nested call).
  - review-context/build.test.js:403: expect `['-c', 'core.quotePath=false', 'diff', '--name-only', '-z', '--end-of-options', 'main...feature']`, with the fake returning NUL-delimited names. The `--files-from` path keeps newline splitting.
  - release-preflight: no existing ls-tree fake. Add one test in `tests/bin-lib/release-preflight/pack.test.js` with a `deps.git` fake that records calls and returns `'Foo.gemspec\0README.md\0'` for `ls-tree`. Assert the call deepEquals `['ls-tree', '--name-only', '-z', '--end-of-options', tipRef]`, and that a gemspec-glob target resolves to `Foo.gemspec`. Read the existing pack.test.js fixtures for how a ruby/java glob target is configured; if no existing fixture reaches `listRootAtTip`, build one from release-local.js's glob-target config shape.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/flow/preflight.test.js tests/bin-lib/review-context/build.test.js tests/bin-lib/release-preflight/pack.test.js`
Expected: FAIL after Step 1 on the argv assertions

- [ ] **Step 3: Implement**
  - pack.js: `splitNul(deps.git(['ls-tree', '--name-only', '-z', '--end-of-options', tipRef]))`.
  - flow/preflight.js: `args.push('--name-only', '-z', '--end-of-options', branch, '--', pathspec)` on one line; both `.split('\n')` → `splitNul(...)`.
  - review-context/build.js: `git([...GIT_UNQUOTED_PATHS, 'diff', '--name-only', '-z', '--end-of-options', range])`; split the git result with `splitNul`, keep the `filesFrom` branch's newline split + trim.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/flow/preflight.test.js tests/bin-lib/flow/preflight-cli.test.js tests/bin-lib/review-context/build.test.js tests/bin-lib/release-preflight/pack.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — message `Read tree and diff listings with -z — release-preflight, flow preflight, review-context`.

---

### Task 5: `git log` path readers (`docs-health/freshness.js`, `issues/backlog.js`, `flow/artifact-overwrite-check.js`)

**Files:**
- Modify: `plugin/bin/lib/docs-health/freshness.js:21-55`
- Modify: `plugin/bin/lib/issues/backlog.js:131-142`
- Modify: `plugin/bin/lib/flow/artifact-overwrite-check.js:92-225`
- Test: `tests/bin-lib/docs-health/freshness.test.js`, `tests/bin-lib/issues/backlog.test.js:97-130`, `tests/bin-lib/flow/artifact-overwrite-check.test.js`

**Interfaces:**
- Consumes: `splitLogZ` from `../git-z`.
- Produces: unchanged — `gitLastChangedMap(root, relPaths): {[path]: ms}`, `deriveCreatedAtFromGit(records, {execFn})`, `parseNameStatusLog(output): Array<{commit, entries:[{status, path}]}>` (exported; same shape, now over `-z` input).

- [ ] **Step 1: Write the failing tests**
  - freshness.test.js: `test('AC1.1: gitLastChangedMap resolves a non-ASCII tracked path', …)` — commit `src/café.ts` in a temp repo (existing `makeTmpGitRoot`/`commitFile` helpers); assert `gitLastChangedMap(root, ['src/café.ts'])['src/café.ts'] === commitTimestampMs(root, 'src/café.ts')`.
  - backlog.test.js: rewrite both fakes to `-z` shape (`'\x012026-01-05T12:00:00+00:00\0\nspecs/1-foo.md\0\x012026-01-01T00:00:00+00:00\0\nspecs/2-bar.md\0specs/1-foo.md\0'`); change the command assertion to `/^git log -z --name-only --format=/`. Add a fake carrying `specs/3-café.md` and assert its record resolves.
  - artifact-overwrite-check.test.js: a unit test on `parseNameStatusLog` over `'<sha40>\0\nA\0docs/journeys/café.md\0<sha40b>\0\nM\0docs/journeys/café.md\0A\0stories/x.yaml\0'`. Assert two commits, entries `[{status:'A',path:'docs/journeys/café.md'}]` and `[{status:'M',...},{status:'A',path:'stories/x.yaml'}]`. Import `parseNameStatusLog` (already exported).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/docs-health/freshness.test.js tests/bin-lib/issues/backlog.test.js tests/bin-lib/flow/artifact-overwrite-check.test.js`
Expected: FAIL after Step 1 (freshness: quoted path never matches; backlog: command regex; artifact-overwrite: parser over NUL input)

- [ ] **Step 3: Implement**
  - freshness.js: argv `['-C', root, 'log', '-z', '--format=%x01%ct', '--name-only', '--', ...relPaths]` — marker moves from `%x00` to `%x01` because `-z` makes NUL the separator. Parse with `splitLogZ(out, (t) => t.startsWith('\x01'))`, timestamp `parseInt(header.slice(1), 10) * 1000`, first-occurrence-wins kept. No rev argument, so no `--end-of-options`. Update the header comment.
  - backlog.js: command string `git log -z --name-only --format=${COMMIT_DATE_MARKER}%cI`; parse with `splitLogZ(out, (t) => t.startsWith(COMMIT_DATE_MARKER))`, first-occurrence-wins kept. Update the comment above `COMMIT_DATE_MARKER` (it currently describes newline-line parsing).
  - artifact-overwrite-check.js: insert `'-z'` after `'--name-status'` on the `:225` argv line (it already has `--end-of-options`). `parseNameStatusLog` rebuilt on `splitLogZ(output, (t) => /^[0-9a-f]{40}$/.test(t))`. Walk each record's tokens as status/path pairs (`A`/`M` only reach it under `--diff-filter=AM`; skip any other status along with its path — and its second path for `R`/`C`). Update its header comment to name `-z`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/docs-health/freshness.test.js tests/bin-lib/issues/backlog.test.js tests/bin-lib/flow/artifact-overwrite-check.test.js tests/bin-lib/flow/check-artifact-overwrite-cli.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — message `Read git log path lists with -z — freshness, backlog, artifact-overwrite check`.

---

### Task 6: contract + conformance test

**Files:**
- Create: `plugin/skills/_shared/git-path-read.md`
- Modify: `plugin/skills/_shared/git-discipline.md` (one pointer line; file is 20,414 B against the 52,500 B rail — ~32 KB headroom)
- Modify: `.claude/skills/gh-api-module-pattern/SKILL.md` (one pointer line where it covers `git` on the runner seam)
- Test: `tests/git-path-read-conformance.test.js`

**Interfaces:**
- Consumes: the argv lines Tasks 2-5 changed.

- [ ] **Step 1: Write the failing test** `tests/git-path-read-conformance.test.js`:
  - `function findViolations(files: Array<{path, text}>): Array<{path, line, text}>` — for each line matching `/(['"])--name-(?:only|status)\1/`, a violation unless the line also matches `/(['"])-z\1/` or matches the one non-git exemption: a `gh pr diff` argv (line matches `/(['"])pr\1,\s*(['"])diff\2/`) — `compose-subject.js:333`, where `gh pr diff --name-only` has no `-z` flag. Include a unit assertion that the exemption does not swallow a git line: `findViolations([{path:'x.js', text:"git(['diff', '--name-only', ref])"}])` has length 1.
  - `test('AC2.1: no plugin/bin git argv carries --name-only/--name-status without -z on the same line', …)` — walk `plugin/bin` recursively for `*.js`, assert `findViolations(...)` deepEquals `[]`.
  - `test('AC2.1 go-red: removing -z from a real reader line is a violation', …)` — take the live `pre-tool-use.js` text, replace its `'--name-status', '-z'` with `'--name-status'`, and run the **same** `findViolations` — assert exactly one violation (go-red control runs the positive assertion's function, per plan-authoring-checks' Go-red control check).
  - `test('AC3.1: the _shared contract states the rule and names the reference implementations', …)` — read `plugin/skills/_shared/git-path-read.md`; assert it contains `-z`, `--end-of-options`, `changed-files.js`, `compose-subject.js`, `git-z.js`; assert `_shared/git-discipline.md` contains `git-path-read.md`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/git-path-read-conformance.test.js`
Expected: FAIL (contract file missing)

- [ ] **Step 3: Write `plugin/skills/_shared/git-path-read.md`** — ~20 lines. Title `# Git Path-List Reads`. One rule paragraph: a `plugin/bin` read of git path output (`--name-only`, `--name-status`, `ls-tree --name-only`, `diff-tree --name-only`, `log --name-*`) passes `-z` and splits on NUL, and passes `--end-of-options` before any ref, range, or sha. Why, one line each: without `-z`, `core.quotepath` C-quotes non-ASCII (`"docs/caf\303\251.md"`) so the path matches nothing; without `--end-of-options`, a dash-leading ref is parsed as an option. Reference implementations: `plugin/bin/lib/verify/changed-files.js`, `plugin/bin/lib/compose-subject.js`. Parsers: `plugin/bin/lib/git-z.js` (`splitNul`, `parseNameStatusZ`, `splitLogZ`), plus the `git log -z` leading-`\n` quirk. Pinned by `tests/git-path-read-conformance.test.js` (same-line `-z` rule). Not covered yet: `--numstat`, `ls-files`, `status --porcelain` readers.
  - git-discipline.md: one line after the intro, e.g. `Code that reads git path lists (plugin/bin) follows _shared/git-path-read.md: -z + NUL split, --end-of-options before refs.`
  - gh-api-module-pattern SKILL.md: one line in the section on `git` runner/argv injection separators, citing `plugin/skills/_shared/git-path-read.md`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/git-path-read-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Revert check (AC2.1 manual)** — temporarily remove `'-z'` from `engine-verify.js`'s diff-tree line, run the conformance test, confirm FAIL naming that line, restore, rerun PASS. Use `git show HEAD:<path>` / a re-edit to restore — never `git stash`/`git checkout`.

- [ ] **Step 6: Commit** — message `Add _shared/git-path-read.md contract and conformance test — -z rule for plugin/bin git path reads`.
