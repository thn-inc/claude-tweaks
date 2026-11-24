# Rebuild a conflicting learned-skills PR during the drain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the learned-skills drain meets a conflicting marker PR, rebuild its branch on the integration tip (pure double-append conflicts only) and force-push it under a lease, instead of leaving it for a human.

**Architecture:** A new module `plugin/bin/lib/learned-skills/rebuild.js` holds a pure diff3 post-processor (`resolveDiff3`) and a git-plumbing `rebuild()` that fetches into scratch refs, runs `git merge-tree --write-tree -z`, resolves each content conflict with `git merge-file --diff3 --object-id`, builds one commit on a temp index with `commit-tree`, and pushes it with `--force-with-lease`. `drain.js` calls it (through an injectable `deps.rebuild`) wherever a PR classifies `conflicting`, then sends a rebuilt PR down its existing pending path.

**Tech Stack:** Node 18+ CommonJS, git >= 2.43 (`merge-file --object-id`), `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-24T085708-record-6113/work/6113-spec.md`

Scope keywords: LEFT_OPEN_REASONS, leftOpen

## Global Constraints

- The rebuild never touches any worktree's own branch, index or files: every commit is built on a temp index (`GIT_INDEX_FILE` on that call's env only), layered on `gitEnv()` from `plugin/bin/lib/learned-skills/learned-skills.js` (spec Deliverable 1).
- The push is exactly `git push --no-verify --force-with-lease=refs/heads/{headRef}:{oldHead} origin {commit}:refs/heads/{headRef}`, and only for a `headRef` starting `learned-skills/` that is not the integration branch (spec Deliverable 4). A rejected lease is `leftOpen` reason `lease-rejected`, never retried.
- A refusal for an unresolvable hunk is `leftOpen: {pr, reason: "conflict needs a human: {files}"}`, every conflicted file comma-joined (`, `), in merge-tree's path order (spec Deliverable 3).
- An item line is one matching `^\s*\d+[.)]\s` (spec Deliverable 2).
- Each rebuild or refusal writes one `decisions.md` line tagged `[lever: learned-skills-auto-merge=true]` — `AUTO` for a rebuild, `SKIP` for a refusal (spec Deliverable 5; the existing `LEVER` constant in drain.js already renders the tag).
- git older than 2.43 refuses with `leftOpen` reason `git-too-old` (spec Gotcha names 2.38 for `merge-tree`; this plan's `merge-file --object-id` needs 2.43, so the floor is 2.43 — deliberate departure, logged as a premise line at build).
- Governing skill `gh-api-module-pattern` (git-seam.md), quoted: "**An argv array stops shell injection, not flag injection.** … For `git` the separator is **`--end-of-options`, not `--`** … **`--end-of-options` alone never resolves a revision — it needs `--verify` alongside it.**"
- Governing skill `gh-api-module-pattern` (git-seam.md), quoted: "A module that builds commits on a scratch `GIT_INDEX_FILE` (`read-tree`, `apply --cached`, `write-tree`, `commit-tree`) layers the index onto `repoPinnedEnv()`, never onto `process.env` … Its `gitEnv(extra)` is the shape to copy, `{ ...repoPinnedEnv(), GIT_LITERAL_PATHSPECS: '1', ...extra }`".
- Governing skill `gh-api-module-pattern` (git-seam.md), quoted: "Fetch into a per-call scratch ref with `--no-tags` … and `--no-write-fetch-head` … and name the source in full, `refs/heads/{branch}:{scratch}` … Push the branch with `--no-verify`". Scratch refs: `refs/claude-tweaks/rebuild/{pr}/base` and `refs/claude-tweaks/rebuild/{pr}/head`, deleted with `update-ref -d` in a `finally`.
- Governing skill `gh-api-module-pattern` (git-seam.md), quoted: "**A `git` path-list read also needs `-z`.**" — `merge-tree` runs with `-z` and its output is split on NUL.
- Governing skill `git-ground-truth-test-env`, quoted: "A fixture that needs a commit identity does not run `git config user.name` and `git config user.email` … An inline `-c user.name=... -c user.email=...` or `GIT_AUTHOR_*`/`GIT_COMMITTER_*` is also free." Tests use `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env as `tests/bin-lib/learned-skills/land.test.js` does.
- Governing skill `windows-checkout-test-parity`: the rebuild reads blobs, never a checkout, so `core.autocrlf` does not reach it; `resolveDiff3` must accept CRLF lines (marker lines matched after stripping a trailing `\r`), pinned by a test built from the LF text.
- Source-scan suites over `plugin/bin/`: spawn only through `realDeps.git` from learned-skills.js (already `windowsHide: true`); no `fs.existsSync`/`fs.realpathSync` (`tests/path-guard-conformance.test.js`); temp dir via `fs.mkdtempSync(path.join(os.tmpdir(), 'ct-rebuild-'))` removed with `fs.rmSync(..., { recursive: true, force: true })` in `finally`.

## Review Focus

1. Lines in the file that look like conflict markers — `merge-file` runs with `--marker-size=32` so ordinary content cannot collide; test `resolveDiff3` with a body line `<<<<<<< x` that must pass through untouched (Task 1).
2. A PR whose head moved between GitHub's read and the fetch — the fetched head differs from `oldHead`: reason `head-changed`, nothing pushed (Task 2).
3. A rebuilt own PR whose first poll still shows the old head (GitHub lag) must keep polling, not report `head-changed` (Task 3).
4. A conflict in two files where one is resolvable and one is not: the whole PR refuses (nothing pushed) and, per "naming every conflicted file", the reason names both files in merge-tree's order (Task 2).
5. A previously rebuilt PR (one commit carrying several trailer pairs) rebuilt again keeps every pair once, in order (Task 2).

---

### Task 1: Pure diff3 resolution (`resolveDiff3`)

**Files:**
- Create: `plugin/bin/lib/learned-skills/rebuild.js`
- Test: `tests/bin-lib/learned-skills/rebuild.test.js`

**Interfaces:**
- Produces: `MARKER_SIZE = 32`; `resolveDiff3(text: string) -> { ok: true, text: string } | { ok: false }` — `text` is `git merge-file -p --diff3 --marker-size=32 -L ours -L base -L theirs` output (ours = integration side, theirs = the PR).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/learned-skills/rebuild.test.js` (build the input with a helper `block(ours, base, theirs)` that emits the 32-char markers `<`×32 ` ours`, `|`×32 ` base`, `=`×32, `>`×32 ` theirs`):
  - `double append keeps both, integration first`: `'- one\n' + block(['- a'], [], ['- b']) + '\nend\n'` → `{ ok: true, text: '- one\n- a\n- b\n\nend\n' }`.
  - `a PR line already among the integration lines is dropped`: `block(['- a', '- b'], [], ['- b', '- c'])` → text `'- a\n- b\n- c\n'`.
  - `AC2.1: both append 7. to a list ends 7. and 8.`: `'6. f\n' + block(['7. x'], [], ['7. y'])` → `'6. f\n7. x\n8. y\n'`.
  - `numbering that stops increasing by one is renumbered`: `'1. a\n' + block(['2. b'], [], ['5. c']) + '\ntext\n'` → `'1. a\n2. b\n3. c\n\ntext\n'`.
  - `a mid-list collision refuses`: `'1. a\n' + block(['2. b'], [], ['2. c']) + '3. d\n'` → `{ ok: false }`.
  - `a consecutive list is left as it is`: `'1. a\n' + block(['2. b'], [], ['- c'])` → `'1. a\n2. b\n- c\n'`.
  - `a non-empty base refuses (a changed line)`: `block(['x2'], ['x'], ['x3'])` → `{ ok: false }`.
  - `an empty side refuses`: `block([], [], ['y'])` and `block(['y'], [], [])` → `{ ok: false }`.
  - `CRLF lines resolve like LF`: the double-append input with every `\n` replaced by `\r\n` → the expected LF text with `\n` → `\r\n`.
  - `a body line shaped like a short marker passes through`: `'<<<<<<< x\n' + block(['a'], [], ['b'])` → `'<<<<<<< x\na\nb\n'`.
  - `no conflict block returns the text unchanged`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/learned-skills/rebuild.test.js`
Expected: FAIL (`Cannot find module .../rebuild.js`)

- [ ] **Step 3: Implement `resolveDiff3` in `rebuild.js`**

Split on `\n` keeping each line's trailing `\r`; a marker line is matched on the line with one trailing `\r` removed, and must be exactly the 32-char run followed by end or a space. Walk lines into an output array; at a `<` marker collect ours until `|`, base until `=`, theirs until `>`. A block with a non-empty base, an empty ours or an empty theirs (or an unterminated block) → `{ ok: false }`. Otherwise emit ours, then each theirs line whose `\r`-stripped text is not among ours' `\r`-stripped texts; remember the block's `[start, end)` range in the output. After the walk, renumber each resolved range:

```
indent = leading whitespace of the range's first item line (an item: /^(\s*)(\d+)([.)])(\s)/ on the \r-stripped line)
items  = item lines in the range with exactly that indent
if none: skip
prev   = walk back from range start: skip blank lines; a line with indent > indent is a continuation, skip;
         an item at that indent -> its number, stop; anything else -> none, stop
start  = prev != null ? prev + 1 : number of items[0]
collision = some items[i].number != start + i
if !collision: skip
next   = first non-blank line after the range; if it is an item at that indent -> return { ok: false }
rewrite items[i]'s number to start + i (keep indent, delimiter and the rest of the line)
```

Return `{ ok: true, text: output.join('\n') }` (the split/join preserves a trailing newline as the final empty element).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/learned-skills/rebuild.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — `git add plugin/bin/lib/learned-skills/rebuild.js tests/bin-lib/learned-skills/rebuild.test.js`, message `Add the learned-skills diff3 resolver — pure double-append union and list renumbering (refs #6113)`.

### Task 2: `rebuild()` — plumbing commit and leased push

**Files:**
- Modify: `plugin/bin/lib/learned-skills/rebuild.js`
- Test: `tests/bin-lib/learned-skills/rebuild.test.js`

**Interfaces:**
- Consumes: `resolveDiff3` (Task 1); `realDeps`, `gitEnv`, `firstStderrLine` from `./learned-skills`; `GIT_TIMEOUT_MS`, `GIT_PUSH_TIMEOUT_MS` from `../shared-primitives`.
- Produces: `MIN_GIT = [2, 43]`; `rebuild({ pr: number, headRef: string, oldHead: string, integrationBranch: string, cwd: string }, deps = { git: realDeps.git, mkdtemp, rm }) -> { ok: true, commit: string, tip: string } | { ok: false, reason: 'not-learned-skills-branch' | 'git-too-old' | 'head-changed' | 'lease-rejected' | 'rebuild-failed' | string /* 'conflict needs a human: a, b' */, detail?: string }`. Never throws: any unexpected git failure is `rebuild-failed` with `detail` = `firstStderrLine(err)`.

Proof(irreversible-side-effect): the only remote write is one `git push --force-with-lease=refs/heads/{headRef}:{oldHead}` to a `learned-skills/*` ref (pinned by the push-argv test below), so it can replace only the exact head GitHub reported and fetched back; any concurrent push makes it fail as `lease-rejected`; the old head sha is named in the AUTO decision line (Task 3) for recovery.

- [ ] **Step 1: Write the failing tests** — real git against a bare origin, a fixture builder in the test file (pattern: `tests/helpers/learned-skills-land.js`'s `sh`/`write`, identity via `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env): origin (bare, `main`), a clone, `.claude/skills/x/SKILL.md` = `'# x\n\n- one\n- two\n\nend\n'`. Branch helper `lsBranch(name, edit, trailers)` commits on `main`'s base and pushes `learned-skills/{name}`, commit message `Add …\n\nLearned-Skills-Run: {name}\nLearned-Skills-Entry: 1\n`. `deps.git` wraps `realDeps.git` and records `args`.
  - `rebuilds a double append onto the tip`: branches A (`- a` after `- two`) and B (`- b` after `- two`); fast-forward `main` to A and push. `rebuild({pr: 2, headRef: 'learned-skills/B', oldHead: B, integrationBranch: 'main', cwd: clone})` → `ok`; origin's `learned-skills/B` = `commit`; its parent is origin `main`; file at the new head = `'# x\n\n- one\n- two\n- a\n- b\n\nend\n'`; `git diff main {commit}` adds exactly `+- b`; message carries `Learned-Skills-Run: B` and `Learned-Skills-Entry: 1`.
  - `AC2.1 end to end: both append 7. ends 7. and 8.` — file with `6. f` last item, both branches append a `7.` item → new head ends `7. {A}\n8. {B}\n`.
  - `AC3.1: a changed line refuses, pushes nothing, names the file`: A and B both rewrite `- two` differently → `{ ok: false, reason: 'conflict needs a human: .claude/skills/x/SKILL.md' }`; origin `learned-skills/B` still = B; no recorded `push` argv.
  - `one resolvable and one unresolvable file refuses naming both`: reason `conflict needs a human: {fileA}, {fileB}` in merge-tree order; nothing pushed.
  - `modify/delete refuses`: B deletes a file A modified → reason starts `conflict needs a human: ` and names it; nothing pushed.
  - `AC4.1: the push leases the old head and targets only the PR branch`: the recorded push argv deep-equals `['push', '--no-verify', '--force-with-lease=refs/heads/learned-skills/B:' + B, '--end-of-options', 'origin', commit + ':refs/heads/learned-skills/B']`.
  - `a head ref outside learned-skills/* is never touched`: `headRef: 'main'` and `headRef: 'feature/x'` → `reason: 'not-learned-skills-branch'`, zero git calls.
  - `a rejected lease is lease-rejected, no retry`: `deps.git` pushes a new commit to origin `learned-skills/B` just before forwarding the `push` call → `reason: 'lease-rejected'`, exactly one push recorded.
  - `a head that moved before the fetch is head-changed`: `oldHead` = a sha that is not origin's tip → `reason: 'head-changed'`, no push.
  - `git older than 2.43 refuses`: `deps.git` answers `version` with `git version 2.42.9` → `reason: 'git-too-old'`, only the version call recorded; `git version 2.47.1.windows.1` passes the check.
  - `a rebuilt PR rebuilt again keeps every trailer pair once, in order`: B's history has a commit with pairs (B,1),(B,2) and a later commit (B,2) → message lists `Learned-Skills-Run: B / Learned-Skills-Entry: 1` then `… 2`, each once.
  - `scratch refs and the temp dir are removed`: after any outcome, `git for-each-ref refs/claude-tweaks/rebuild` prints nothing and the temp dir is gone.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/learned-skills/rebuild.test.js`
Expected: FAIL (`rebuild is not a function`)

- [ ] **Step 3: Implement `rebuild` in `rebuild.js`.** Order (every call `{ cwd }`; rev arguments after `--end-of-options`; remote calls with the timeouts above):
  1. `headRef` must start `learned-skills/` and differ from `integrationBranch`, else `not-learned-skills-branch` before any git call.
  2. `git version`: parse `/(\d+)\.(\d+)/`; below `MIN_GIT` → `git-too-old`.
  3. `fetch --no-tags --no-write-fetch-head origin +refs/heads/{integrationBranch}:{base} +refs/heads/{headRef}:{head}` (scratch refs from Global Constraints); `rev-parse --verify --end-of-options {head}^{commit}` ≠ `oldHead` → `head-changed`.
  4. `tip` = `rev-parse --verify` of the base scratch ref; `mb` = `merge-base --end-of-options {tip} {oldHead}`.
  5. Trailers: `log --reverse --format=%B%x00 --end-of-options {mb}..{oldHead}`; collect `Learned-Skills-Run:`/`Learned-Skills-Entry:` lines in order, pairing each Run with the next Entry, dropping a repeated pair.
  6. `merge-tree --write-tree -z --end-of-options {tip} {oldHead}` (exit 1 = conflicts: read stdout from the thrown error). Parse: first NUL field = tree; then `mode sha stage\tpath` fields until an empty field; then messages as `count, path×count, type, message`. A path conflicts when it has stage entries; it is a content conflict only when it has stages 1, 2 and 3 and every message naming it has type `Auto-merging` or `CONFLICT (contents)`. Any other conflicted path is unresolvable.
  7. Per content conflict: `merge-file -p --diff3 --marker-size=32 -L ours -L base -L theirs --object-id {stage2} {stage1} {stage3}` (non-zero exit with stdout = conflicts, read from the error) → `resolveDiff3`; `ok: false` → unresolvable.
  8. Any unresolvable path → `{ ok: false, reason: 'conflict needs a human: ' + allConflictedPaths.join(', ') }` (every conflicted path, merge-tree order).
  9. Temp index in `mkdtemp`: `read-tree --end-of-options {tree}`; per resolved path `hash-object -w --stdin` (input = text) then `update-index --cacheinfo {stage2 mode},{oid},{path}`; `write-tree`; `commit-tree {tree} -p {tip} -F -` with message `Rebuild learned-skills PR #{pr} on {integrationBranch}\n\n` + trailer lines + `\n`. All on `gitEnv({ GIT_INDEX_FILE })`.
  10. Push (Global Constraints form); stderr matching `/stale info|\[rejected\]/` → `lease-rejected`; any other failure → `rebuild-failed`.
  11. `finally`: `update-ref -d` both scratch refs (errors ignored), remove the temp dir.

- [ ] **Step 4: Run to verify they pass**

Run: `node tools/run-tests.js tests/bin-lib/learned-skills/rebuild.test.js` (the runner's git env is part of the input — `git-ground-truth-test-env` rule 3)
Expected: PASS

- [ ] **Step 5: Go-red check (AC5.1)** — replace `rebuild`'s body with `return { ok: false, reason: 'rebuild-failed' }` and `resolveDiff3`'s with `return { ok: false }`, run the file, confirm every new test fails except the refusal-only ones (`AC3.1`, head-ref, git-too-old, lease, head-changed), whose refusal reasons must then mismatch; restore the real bodies by editing them back (never `git checkout`/`git stash`), re-run to green, and record the red and green counts in the task report.

- [ ] **Step 6: Commit** — `Add the learned-skills PR rebuild — plumbing merge on the tip and a leased push (refs #6113)`.

### Task 3: Drain integration, CLI contract and prose

**Files:**
- Modify: `plugin/bin/lib/learned-skills/drain.js`
- Modify: `plugin/bin/learned-skills-pr.js` (header contract line `drain: {…}` and USAGE line gain `rebuilt`; `runDrain` passes `cwd: deps.cwd()`)
- Modify: `tests/bin-lib/learned-skills/drain.test.js`
- Modify: `tests/bin-lib/learned-skills/drain-cli.test.js` (line 40's expected lib args gain `cwd`; lines 100/118 expected outputs gain `rebuilt: []`)
- Modify: `plugin/skills/wrap-up/learned-skills-pr.md` (the `It prints one JSON line` paragraph: add `rebuilt`, the rebuild behavior and the new reasons)
- Modify: `docs/journeys/review-a-runs-learned-skill-edits-on-their-own-pr-5290.md` (lines 66 and 70: output shape and the closed reason set)
- Modify: `docs/plugin-structure.md` (line 319: drain output shape)
- Test: `tests/wrap-up-learned-skills-pr.test.js` (pins the drain paragraph's `no-gh` sentence at line 200 — keep that sentence verbatim; add one assertion that the paragraph names `rebuilt` and `conflict needs a human`)
- No change `docs/superpowers/plans/2026-11-23-learned-skills-drain.md`: a shipped plan, history, not prose a reader acts on.
- No change (Check B `leftOpen` hits that are reconcile's own post-merge `leftOpen`, unrelated to the drain): `docs/journeys/session-start-fast-background-reconcile.md`, `docs/reconcile-checks.md`, `plugin/bin/hooks.js`, `plugin/bin/lib/hooks/session-start.js`, `plugin/bin/lib/reconcile/format-summary.js`, `plugin/bin/lib/reconcile/post-merge.js`, `tests/bin-lib/hooks/reconcile-background.test.js`, `tests/bin-lib/reconcile/post-merge.test.js`, `tests/hooks-session-start.test.js`, `tests/post-merge-parent-left-open-e2e.test.js`.

**Interfaces:**
- Consumes: `rebuild` (Task 2).
- Produces: `drain(opts)` with `opts.cwd` (default `process.cwd()`) and output `{ merged, armed, leftOpen, conflicting, rebuilt: number[] [, disabled] }`; `LEFT_OPEN_REASONS` = the nine existing values + `'lease-rejected', 'git-too-old', 'rebuild-failed', 'conflict needs a human'` (the last as the prefix of `conflict needs a human: {files}`); deps gain `rebuild(args) -> result` (default: `rebuild({ ...args, cwd }, rebuildDeps)`).

- [ ] **Step 1: Write the failing tests** in `drain.test.js`. The harness gains a `rebuild` option, default a function that throws `unexpected rebuild` (so no test can reach real git), and records its calls.
  - Replace `AC1.5: a DIRTY PR is reported conflicting` with `a DIRTY PR is rebuilt and left pending`: rebuild returns `{ ok: true, commit: SHA('c'), tip: SHA('d') }` → `rebuilt: [6204]`, `leftOpen: [{ pr: 6204, reason: 'pending' }]`, `conflicting: []`, rebuild called with `{ pr: 6204, headRef: 'learned-skills/run-6204', oldHead: SHA('a'), integrationBranch: 'main' }`, no merge; with `runDir`, logged lines include one `AUTO` matching `/PR #6204 rebuilt on main \(old head a{40}\)/` ending `[lever: learned-skills-auto-merge=true]`.
  - `a refused rebuild is left open naming the files`: rebuild → `{ ok: false, reason: 'conflict needs a human: .claude/skills/x/SKILL.md' }` → `leftOpen: [{ pr, reason: 'conflict needs a human: .claude/skills/x/SKILL.md' }]`, `rebuilt: []`, one `SKIP` line with the lever tag.
  - `a rebuild that throws is rebuild-failed with the error as detail`.
  - Update `a sibling turned DIRTY by an earlier merge…` to expect the rebuild (rebuilt `[6206]`).
  - `a rebuilt own PR follows the pending path to a merge on the new head`: own PR views `[dirty(a), pending(a) /* GitHub lag */, green(c), green(c)]`, rebuild → commit `SHA('c')` → `merged: [n]`, the merge argv carries `--match-head-commit` `SHA('c')`.
  - `an own PR that turns conflicting mid-watch is rebuilt` (replaces the poll-conflicting expectation wherever a test expects `conflicting` from a poll).
  - The whole-shape asserts (`{ merged: [], armed: [], leftOpen: [], conflicting: [] }`) gain `rebuilt: []`; `LEFT_OPEN_REASONS is exactly the closed set` lists the thirteen values.
  - `a gh pr merge conflict is conflicting` stays as is: a conflict reported by the merge call itself is still `conflicting` (no rebuild; a later drain sees DIRTY and rebuilds).
  - `AC1.1 AC1.2: drain rebuilds the second of two double-append PRs (real git)`: Task 2's fixture (origin + clone, A merged to `main`), fake gh listing PR B as DIRTY with head B, `rebuild` left at its real default with `cwd: clone` → `rebuilt: [B's number]`; origin `learned-skills/B`'s file holds `- a` then `- b`; `git diff origin/main origin/learned-skills/B` adds only `+- b`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/learned-skills/drain.test.js tests/bin-lib/learned-skills/drain-cli.test.js`
Expected: FAIL after Step 1 (rebuild never called; `rebuilt` undefined)

- [ ] **Step 3: Implement in `drain.js`**: `out.rebuilt = []`; a `rebuildOrSettle(n, headRef, oldHead)` used at the three classified-conflicting sites (state verdict, `mergeGreen`'s recheck, the poll) — calls `deps.rebuild` (a throw → `rebuild-failed`, `detail` = `firstStderrLine(err)`), on `ok` pushes `n` to `rebuilt`, logs `AUTO` `PR #${n} rebuilt on ${integrationBranch} (old head ${oldHead})` with reversibility `med`, then: not own → `open(n, 'pending')`; own → the existing watch with `sha = commit`, where a poll whose head still equals `oldHead` keeps polling; on refusal `open(n, reason, detail)`. The `conflict` branch of `land`'s merge-call error stays `settle(n, 'conflicting')`. Update the header comment (the `integrationBranch … reserved` paragraph and the leftOpen reasons line). `learned-skills-pr.js`: contract line, USAGE line, `cwd: deps.cwd()` in `common`. Prose: say a conflicting PR is rebuilt on the integration tip when every conflict is a pure double append (listed in `rebuilt`, then pending) and otherwise left open as `conflict needs a human: {files}`, `lease-rejected`, `git-too-old` or `rebuild-failed`; `conflicting` now means only a conflict the merge call itself reported.

- [ ] **Step 4: Byte check** — `wc -c plugin/skills/wrap-up/learned-skills-pr.md` stays under 52,500 (RAIL_BYTES).

- [ ] **Step 5: Run to verify they pass**

Run: `node tools/run-tests.js tests/bin-lib/learned-skills/drain.test.js tests/bin-lib/learned-skills/drain-cli.test.js tests/bin-lib/learned-skills/rebuild.test.js`
Expected: PASS

- [ ] **Step 6: Go-red check (AC5.1)** — stub `deps.rebuild`'s default and the `rebuildOrSettle` call back to `settle(n, 'conflicting')`, confirm the new drain tests fail, restore.

- [ ] **Step 7: Commit** — `Rebuild conflicting learned-skills PRs in the drain — rebuilt list, refusal reasons, prose (refs #6113)`.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (plumbing rebuild, trailer union) | 2 |
| Deliverable 2 (double-append union, dedupe, renumber) | 1, 2 |
| Deliverable 3 (refuse, `conflict needs a human`) | 1, 2, 3 |
| Deliverable 4 (leased push, pending path) | 2, 3 |
| Deliverable 5 (`rebuilt`, decision lines) | 3 |
| Deliverable 6 (post-ship migration drain) | Blocked: runs only after release and `claude plugin update`; recorded in the open-items ledger and as the record's Blocked / Future Work |
| AC1.1, AC1.2 | 3 (drain, real git), 2 |
| AC2.1 | 1, 2 |
| AC3.1 | 2 |
| AC4.1 | 2 |
| AC5.1 | 2 Step 5, 3 Step 6 |
| AC6.1 | `/build` Common Step 5 / `/test` (full suite) |

Waived AC7.1: the post-ship drain needs the released plugin installed; it runs after merge and release (Deliverable 6), outside this build.
Waived AC7.2: same — the quoted `gh pr list` output exists only after that drain.

Gotcha (confirm CI and Windows runner git versions): Task 2 Step 4's runner pass on this host (git 2.56) plus PR CI on ubuntu and windows runners, whose rebuild tests fail as `git-too-old` if a runner's git is below 2.43; Waived `.github/workflows/`: read-only, confirmed by that CI run.
