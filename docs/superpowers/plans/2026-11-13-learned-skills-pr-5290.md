# Learned-skills PR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take wrap-up's auto-applied Skills-row edits off the run's branch, so `merge-check` judges only the record's own change. They land on a separate, never-armed learned-skills PR, or as a staged Review Console proposal when no PR can be opened.

**Architecture:** A new CLI, `plugin/bin/learned-skills-pr.js` (library `plugin/bin/lib/learned-skills/learned-skills.js`), has three verbs. `capture` turns one judge's working-tree edit into a patch in the run dir and reverts it in the run worktree. `land` builds one commit per patch with git plumbing (a temporary index over the integration-branch tip; `commit-tree`; push to `refs/heads/learned-skills/{run-id}`) and opens a ready, unarmed PR. `stage` writes each patch as a `staged/wrap-up-skill-{N}.md` proposal. The CLI logs every `decisions.md` line itself. Wrap-up's serial-commit pass (`curation-engine.md` section 4) calls these in place of committing a Skills-row finding on the run branch. The new sub-file `plugin/skills/wrap-up/learned-skills-pr.md` holds that procedure.

**Tech Stack:** Node 18+ CommonJS, `node --test`, git and gh through the injectable-runner seam.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T005701-spec-5290/work/5290-spec.md`

**Deviation from the spec's Technical Approach (logged at Common Step 4.5):** the spec says to provision a scratch worktree via `_shared/scratch-worktree.md`. That file's §2 uses `EnterWorktree`, which refuses inside an existing worktree session, and wrap-up's curation runs inside the run's own worktree (or a cwd-pinned dispatch agent). Git plumbing against a temporary index needs no checkout, and the carve-out in `curation-engine.md` section 4 already sanctions that write shape (direct object writes pushed to a ref that is neither the worktree's branch nor the integration branch). `scratch-worktree.md` is therefore not modified.

## Global Constraints

- PR body marker, exact: `<!-- wrap-up-skills-pr -->`. Branch: `learned-skills/{run-id}`, where `{run-id}` = `basename(run-dir)`.
- The learned-skills PR is opened ready (never `--draft`) and is never armed: no `gh pr merge` call of any form exists in the module. `housekeeping-auto-merge` is never read.
- The PR body names the source record only as `refs #{n}`. It never carries `<!-- claude-tweaks-run:` or a closing keyword. Route every summary string written into the body through `plugin/bin/lib/flow/closing-links.js`'s `neutralizeClosingPhrases`.
- Applied log line (status AUTO, written by the CLI), exact shape: `AUTO {time} — Skills row: applied additive update to {skill}/SKILL.md ({section}) on learned-skills PR #{pr}. Reversibility: high; commit: {hash}.` — `{skill}/SKILL.md` is the target with its leading `.claude/skills/` stripped (the whole target path when it has no such prefix), and `{section}` is the finding's `summary` (the CLI's `--summary-file` text). `skill-curation.md`'s prose template states the same mapping.
- Downgrade log line (status STAGED), exact shape: `STAGED {time} — Skills row: skill update for {skill}/SKILL.md ({section}) could not ride a learned-skills PR ({reason}); staged instead. Reversibility: high (stage path: staged/wrap-up-skill-{N}.md).` — same mapping.
- Multi-spec consolidated wrap-up: `--run` is the **parent** run dir (manifest, `staged/`, branch `learned-skills/{basename(parent)}`), `--merge-base` is the batch merge-base from `flow/multispec-batch-curation.md` step 1, and `land --record` repeats once per member record (`--record 5290 --record 5291`); the body and commit message name every member (`refs #5290, refs #5291`; `from #5290, #5291's wrap-up`).
- A staged file follows `plugin/skills/_shared/staged-patch.md`'s Artifact format: `Target:` / `Invariant:` / `Finding:` / `Staged-at:` preamble lines, a blank line, then the real `git diff` bytes. Never a hand-typed diff.
- `merge-check.md`, `blast-radius.js`, and `scratch-worktree.md` are not changed.
- Commit subjects: `{Verb} {what} — {detail}`, imperative, no conventional prefix. End every commit message with `Claude-Session: https://claude.ai/code/session_016yg3zrBQnDhYHfSCMdVv9V`.
- Governing skill `.claude/skills/gh-api-module-pattern/SKILL.md` applies to Tasks 1-2. Read its "The injectable runner" section and `cli-wrapper-contract.md` before writing code. Rules quoted verbatim from it:
  - "**Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see.**"
  - "**Every `gh` spawn wraps its options in `plugin/bin/lib/repo-resolve.js`'s `ghOptions(args, …)`.**"
  - "**A read-only `git status` passes `--no-optional-locks` before `status`, after any `-C <path>`**"
  - "**An argv array stops shell injection, not flag injection.** … For `git` the separator is **`--end-of-options`, not `--`**"
  - "**A `git` path-list read also needs `-z`.**"
  - "**Bound every remote-contacting call on the seam; a local-only call owes no bound.** … **`GH_TIMEOUT_MS` is a resolved value, not a literal — import it, never retype its default at a new call site.**"
  - "**A seam that pipes a child whose output the module does not control sets `maxBuffer: LARGE_MAX_BUFFER_BYTES`, and a push that runs the consumer's hooks takes `GIT_PUSH_TIMEOUT_MS`, not `GIT_TIMEOUT_MS`.**"
  - "**A module that parses git's output pins that output's format against the user's and the repo's git config.** … For patch text, pass every flag explicitly … `-c core.quotePath=false diff --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/`."
  - "**A seam that writes a body widens to `runner(args, input)` and pipes it on stdin, instead of staging a temp file.**"
  - "**Text a module writes into a PR body names no record it does not mean to close.**"
  - "**A `gh` write's exit 0 proves only that gh saw no error; when later steps act on the new state, re-read it first.**"
  - "Tests never touch real `gh`: fake runners branch on the `args` shape … and `throw new Error('unexpected ' + args.join(' '))` on anything unhandled"
- Path reads/writes in `plugin/bin/` go through `plugin/bin/lib/path-guard` (`lstatType`, `resolveWithin`). A bare `fs.existsSync`/`fs.realpathSync` fails `tests/path-guard-conformance.test.js`.
- Governing skill `.claude/skills/skill-prose-conformance-tests/SKILL.md` applies to Task 5's prose tests: every new assertion must be proven red by reverting the prose it pins.

## Review Focus

1. A second Skills-row finding on the same target as an earlier one: `capture` returns the earlier patch (`shared: true`), and both findings get the same commit. The edit is never captured twice or lost. (Task 1 test.)
2. A resumed run that calls `land` twice: patches already landed are skipped, the existing remote branch is the base, the open PR is reused, and no duplicate commit or PR appears. (Task 2 test.)
3. The integration branch changed the target file after the merge base: `git apply --cached --check` fails, and the patch is staged, never dropped. (Task 2 test.)
4. A brand-new skill file (untracked) is captured: after the revert the file is gone and `status --porcelain` is clean, so Phase 4's later catch-all commit cannot sweep it back onto the run branch. (Task 1 test.)
5. A target path with a non-ASCII character or a leading `-`: the patch still applies (`core.quotePath=false`), and the argv carries `--end-of-options`. (Task 1 test.)

---

### Task 1: `capture` verb — record-owned test, patch capture, revert

**Covers:** AC1.1 (the edit leaves the run branch), AC6.1 (record-owned stays), AC5.1 (revert half).

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/learned-skills/learned-skills.js`
- Create: `plugin/bin/learned-skills-pr.js`
- Test: `tests/bin-lib/learned-skills/capture.test.js`

**Interfaces:**
- Produces: `capture({ runDir, worktree, mergeBase, target, summary }, deps) -> { route: 'run-branch', reason: 'record-owned' } | { route: 'captured', id: string, patch: string /*abs*/, shared: boolean } | { route: 'clean' }`. `clean` means the target has no change and was never captured in this run (exit 0; the caller treats it as the audit's clean-path case). A target already captured in this run returns `captured` with `shared: true` whether or not it is still dirty. A later uncommitted edit to it (another row's) is re-diffed into the same patch file, so that patch always holds the file's whole working-tree change.
- Failure contract: any failure **after** the diff was read (patch write, revert, residue check) restores the working-tree edit from the diff if the revert ran half-way, then stages it via Task 2's staging writer and returns `{ route: 'staged', stagePath, reason }` (exit 0). A failure **before** the diff was read (git unavailable, no HEAD) exits 1 with nothing changed — the one case the caller commits on the run branch, logged `FAILED` (merge-check's floor still holds that run, so this fails safe, never unreviewed).
- Produces: `stageEntry({ runDir, worktree, entry, reason }, deps) -> { stagePath /*absolute, anchored under runDir/staged/*/, gate: 'ok'|'description-only'|'unvalidated' }` — the staging writer Task 2 also uses. N = 1 + the max existing `wrap-up-skill-(\d+)\.md` in `{runDir}/staged/`. Preamble: `Target: {target}`, `Invariant: {summary}`, `Finding: Skills row — {summary}`, `Staged-at: {short HEAD of worktree}`, a blank line, then the patch bytes. Then `staged-patch.md`'s **Staging-time gate** with the patch's own outcome table: `git -C {worktree} apply --check {stagePath}`, where the edit is already reverted, so the patch must apply. Exit 0 → `gate:'ok'`. An unreadable file → `gate:'unvalidated'`, kept. Otherwise recompose once from the patch file, and on a second failure write the description-only form → `gate:'description-only'`. After an `ok`, run the **Stacked check** by spawning `plugin/bin/check-staged-stack.js --worktree {worktree} --patch {stagePath} --rederive-out {runDir}/learned-skills/rederive-{N}.patch` and follow that section's outcome rules. It writes the STAGED line itself (Global Constraints shape; a description-only stage uses `staged-patch.md`'s description-only line).
- Produces: the manifest `{runDir}/learned-skills/manifest.json`, an array of `{ id, target, summary, patch, status: 'captured'|'landed'|'staged', commit?, pr?, stagePath?, reason? }`. `id` is a decimal string sequence starting at `"1"`. Helpers: `readManifest(runDir)` and `writeManifest(runDir, entries)` (atomic, via `plugin/bin/lib/atomic-write.js`).
- Produces: `realDeps` with `git(args, opts)` (throwing runner, `windowsHide: true`, `maxBuffer: LARGE_MAX_BUFFER_BYTES`) and `gh(args, input)` (via `ghOptions`, `timeout: GH_TIMEOUT_MS`), plus `run(argv, deps) -> exitCode` in the CLI, per `cli-wrapper-contract.md`. Exit 0 = ok, 1 = git or gh failure (stderr names it, nothing reverted), 2 = usage error or refused `--run`.
- CLI: `learned-skills-pr.js capture --run <run-dir> --worktree <abs> --merge-base <sha> --target <repo-rel> --summary-file <path>` prints one JSON line.

- [ ] **Step 1: Write the failing tests.** Each test builds a temp git repo (`git init`, pinned identity via env as `tests/` already does, one commit holding `.claude/skills/x/SKILL.md`) and a run dir under its `.claude-tweaks/pipelines/{id}`. Tests:
  - `record-owned target stays on the run branch`: commit an edit to `x/SKILL.md` after the merge base, then make a further working-tree edit → `{route:'run-branch', reason:'record-owned'}`, working tree still dirty, no manifest written.
  - `captures a tracked edit and reverts it`: a working-tree edit to `x/SKILL.md` → `route:'captured'`, `id:'1'`. The patch file begins `diff --git a/.claude/skills/x/SKILL.md b/.claude/skills/x/SKILL.md`, and `git apply --check` of it against HEAD succeeds. `git --no-optional-locks status --porcelain -- <target>` prints nothing.
  - `captures a new untracked skill file and deletes it`: a new `.claude/skills/y/SKILL.md` → the patch contains `new file mode`, the file no longer exists, and status is clean.
  - `second finding on the same target reuses the patch`: capture `x` twice → the second call returns `{ route:'captured', id:'1', shared:true }`, and the manifest has one entry.
  - `clean target`: an unedited, never-captured target → `{ route:'clean' }`, exit 0, no manifest entry.
  - `a later row's edit to a captured target joins the same patch`: capture `x`, then edit `x` again in the working tree, then capture `x` → `shared:true`, and the patch file now re-applies both edits against HEAD. The tree is clean afterward.
  - `failure after the diff stages instead of committing`: an injected `deps.git` whose `checkout` call throws → `route:'staged'`. `staged/wrap-up-skill-1.md` exists at an absolute path under `runDir`, and its diff block is byte-identical to the captured diff. The working tree is clean, no commit was made on the branch, and `decisions.md` has a `STAGED` line.
  - `stageEntry gate`: a valid patch → `gate:'ok'`. A truncated patch (garbage) → `gate:'description-only'` and the file has no `diff --git` line. `stagePath` is always absolute and starts with `runDir`.
  - `non-ASCII and dash-leading paths`: targets `.claude/skills/café/SKILL.md` and `-evil/SKILL.md` (both created) capture and re-apply. The recorded `git` argv for the diff contains `-c`, `core.quotePath=false`, `--no-color`, `--no-ext-diff`, `--src-prefix=a/`, `--dst-prefix=b/`, and `--` before the path (pathspec). The `merge-base..HEAD` name-only read contains `-z` and `--end-of-options`.
  - CLI `run([...])` with a missing `--target` → exit 2.

- [ ] **Step 2: Run them to verify they fail.**
  Run: `node --test tests/bin-lib/learned-skills/capture.test.js`
  Expected: FAIL (`Cannot find module '../../../plugin/bin/lib/learned-skills/learned-skills.js'`)

- [ ] **Step 3: Implement `capture` and the CLI's `capture` verb.**
  - Record-owned: `git -C wt -c core.quotePath=false diff --name-only -z --end-of-options {mergeBase} HEAD --`, split with `plugin/bin/lib/git-z.js`. A target in the set takes `route: 'run-branch'`.
  - An untracked target first gets `git add -N -- target`.
  - Diff: `git -C wt -c core.quotePath=false diff --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ --binary HEAD -- target`. Write it to `{runDir}/learned-skills/{id}.patch`.
  - Revert: a path in HEAD (`git cat-file -e HEAD:target` succeeds) → `git checkout HEAD -- target`. Otherwise `git rm --cached --quiet -- target`, then unlink through path-guard.
  - Assert the status read is empty, else throw `revert left residue`.
  - `target` must resolve within `worktree` (`resolveWithin`). Reject an absolute or `..` path with a usage error.

- [ ] **Step 4: Run them to verify they pass.**
  Run: `node --test tests/bin-lib/learned-skills/capture.test.js tests/windows-hide-spawn-conformance.test.js tests/gh-host-seam-conformance.test.js tests/git-status-optional-locks.test.js tests/path-guard-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
  Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/learned-skills/learned-skills.js plugin/bin/learned-skills-pr.js tests/bin-lib/learned-skills/capture.test.js
git commit -m "Add learned-skills-pr capture — move a Skills-row edit off the run branch as a patch"
```

### Task 2: `land` and `stage` verbs — plumbing commits, unarmed PR, staged fallback, logging

**Covers:** AC2.1, AC2.2, AC3.1, AC5.1, AC5.2.

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/learned-skills/learned-skills.js`
- Modify: `plugin/bin/learned-skills-pr.js`
- Test: `tests/bin-lib/learned-skills/land.test.js`

**Interfaces:**
- Consumes: Task 1's manifest, `readManifest`, `writeManifest`, and `realDeps`.
- Produces: `land({ runDir, worktree, record, integrationBranch }, deps) -> { branch, pr: { number, url } | null, landed: [{ id, target, commit }], staged: [{ id, target, stagePath, reason }] }` and `stage({ runDir, worktree, reason }, deps) -> { staged: [...] }`. Both only process entries with `status: 'captured'`. Both update the manifest (`landed` + `commit` + `pr`, or `staged` + `stagePath` + `reason`) and append their `decisions.md` lines via `plugin/bin/lib/log-decision/append.js`'s `appendEntries` with section `/wrap-up` and step `Skills row`.
- CLI: `learned-skills-pr.js land --run <run-dir> --worktree <abs> --record <n> --integration-branch <name>` and `learned-skills-pr.js stage --run <run-dir> --worktree <abs> --reason <text>`. Each prints one JSON line. Exit 0 when every captured entry ended `landed` or `staged`, exit 1 when a staged write itself failed, exit 2 on usage.

- [ ] **Step 1: Write the failing tests.** Fixture: a bare repo as `origin`, a clone as the worktree with `main` pushed, a captured patch from Task 1's `capture`, and a fake `gh` that records argv and stdin and throws on anything unhandled. Tests:
  - `lands one commit per patch on learned-skills/{run-id}`: two captured patches → `git ls-remote origin refs/heads/learned-skills/{run-id}` lists a sha. Its first parent chain is two commits whose base is `origin/main`'s tip. `git diff origin/main {sha}` touches exactly the two targets. The result has `landed.length === 2` and `pr.number === 77`.
  - `opens a ready unarmed PR with the marker and refs-only link`: the recorded `gh pr create` argv contains `--base main --head learned-skills/{run-id}` and no `--draft`. The stdin body contains `<!-- wrap-up-skills-pr -->` and `refs #5290`, and matches neither `/<!-- claude-tweaks-run:/` nor `/\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+#\d/i`. No recorded gh argv starts with `['pr','merge']`. A confirming `gh pr list --head … --state open` read follows the create.
  - `logs the AUTO line per landed patch`: `decisions.md` holds `AUTO` lines matching the Global Constraints shape, with the PR number and each commit's short hash.
  - `resumed land is idempotent`: call `land` twice → the second call lands nothing new, creates no PR (the fake's `pr list` returns the open PR), and pushes nothing.
  - `apply-check failure stages that patch only`: commit a conflicting change to the same target on `origin/main` after capture → that patch is `staged` with `reason` naming `git apply --check`. The other lands. The staged file `staged/wrap-up-skill-1.md` opens with `Target: `, `Invariant: `, `Finding: `, `Staged-at: ` lines, followed by the patch bytes byte-identical. A `STAGED` line matches the Global Constraints shape.
  - `push failure stages every patch`: an `origin` URL pointing at a missing path → all entries `staged`, `pr: null`, no gh call.
  - `PR create failure stages every patch`: the fake `gh pr create` throws → all entries `staged` with the reason naming the create failure.
  - `stage numbering skips taken slots`: a pre-existing `staged/wrap-up-skill-1.md` → the new file is `wrap-up-skill-2.md`.
  - `stage verb (local-merge)`: `stage({reason:'integration-model is local-merge'})` stages every captured entry and makes no git push and no gh call.

- [ ] **Step 2: Run them to verify they fail.**
  Run: `node --test tests/bin-lib/learned-skills/land.test.js`
  Expected: FAIL (`land is not a function`)

- [ ] **Step 3: Implement `land`, `stage`, and the two CLI verbs.**
  - `git fetch origin {integrationBranch}` and `git ls-remote --heads origin refs/heads/{branch}`, bounded by `GIT_TIMEOUT_MS`. When the branch exists, fetch it and use its tip as the base. Otherwise use `origin/{integrationBranch}`.
  - Temp index `{runDir}/learned-skills/index.tmp`, passed as `env: { ...process.env, GIT_INDEX_FILE }` on the plumbing calls only: `read-tree --end-of-options {base}`, then per patch `apply --cached --check`, `apply --cached`, `write-tree`, and `commit-tree {tree} -p {parent} -F -`. The commit message is on stdin: `Add learned skill update to {target} — from #{record}'s wrap-up`, a blank line, then `Learned-Skills-Run: {run-id}`.
  - Push `{sha}:refs/heads/{branch}` with `GIT_PUSH_TIMEOUT_MS`.
  - Reuse an open PR from `gh pr list --head {branch} --state open --json number,url`. Otherwise run `gh pr create … --body-file -`, then re-list and require the PR to read OPEN.
  - Delete the temp index in a `finally`.
  - Every downgrade goes through Task 1's `stageEntry`. `--record` repeats (multi-spec, Global Constraints). Add a test `multi-record land refs every member` with `--record 5290 --record 5291`: the body carries `refs #5290` and `refs #5291`, and no closing keyword.

- [ ] **Step 4: Run them to verify they pass.**
  Run: `node --test tests/bin-lib/learned-skills/ tests/windows-hide-spawn-conformance.test.js tests/gh-host-seam-conformance.test.js tests/path-guard-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
  Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/learned-skills/learned-skills.js plugin/bin/learned-skills-pr.js tests/bin-lib/learned-skills/land.test.js
git commit -m "Add learned-skills-pr land and stage — plumbing commits on an unarmed PR, staged fallback"
```

### Task 3: Console disposition names the learned-skills PR

**Covers:** AC8.2.

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/wrap-up/engine-render.js` (`dispositionFor`, ~line 127)
- Test: `tests/bin-lib/wrap-up/` — add the cases to the existing engine-render test file (find it with `grep -l dispositionFor\|renderConsoleSections tests/bin-lib/wrap-up/*.js`)

**Interfaces:**
- Produces: finding field `pr` (a PR URL string, optional). `dispositionFor` returns `applied ({commit}, learned-skills PR {pr})` when `action === 'applied'` and `pr` is a non-empty string. It is unchanged otherwise. `formatDetailCell` appends ` · learned-skills PR {url}` (each distinct `pr` once) to the row's `detail` when any finding carries one. This is how the PR URL reaches wrap-up's final summary: `summary-template.md`'s Phase 2 section renders `render --section trace`, so no template edit is needed. Task 5's test asserts the trace output.

- [ ] **Step 1: Write the failing tests.** `renderConsoleSections` on a `skills` row whose finding carries `pr: 'https://github.com/o/r/pull/77'` contains `applied (abc1234, learned-skills PR https://github.com/o/r/pull/77)`. A finding without `pr` still renders `applied (abc1234)`. `renderTrace` on that row's entry with `detail: 'Read 2'` renders a Detail cell `Read 2 · learned-skills PR https://github.com/o/r/pull/77`. Two findings sharing one `pr` print it once. Also run the return-shape-widening grep: `grep -rn "applied (" tests/` — update no existing assertion unless it breaks.
- [ ] **Step 2: Run it to verify it fails.** Run: `node --test {that file}` — Expected: FAIL on the `learned-skills PR` assertion.
- [ ] **Step 3: Implement the branch in `dispositionFor`.**
- [ ] **Step 4: Run it to verify it passes.** Run: `node --test tests/bin-lib/wrap-up/` — Expected: PASS
- [ ] **Step 5: Commit** — `git add` the two files, then `git commit -m "Name the learned-skills PR in the console's Skill updates disposition"`.

### Task 4: Item 9 never arms a learned-skills PR

**Covers:** AC4.1, AC4.2, AC4.3. **Byte budget:** `github-pr-scan.md` has 1249 bytes of rail headroom and its composed `pr-scan` bundle 1102; keep this task's total addition under 400 bytes (the one filter line plus one sentence) and re-run `plan-audit.js {plan} --bytes` after the edit.

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/github-pr-scan.md` (item 9 prose and its first `node -e` filter)
- Test: `tests/sweep-backstop.test.js`

**Interfaces:**
- Consumes: the marker `<!-- wrap-up-skills-pr -->`.

- [ ] **Step 1: Write the failing test** `item 9's filter never offers a wrap-up-skills-pr PR, even with a run marker and a granted record`. Copy the existing `wrap-up-residue-pr` filter test's harness (`extractNodeScripts(ITEM9)[0]`, `isolateItem9`). Use two fixture PRs, both green and old enough: #3001 with body `<!-- wrap-up-skills-pr -->`, and #3002 with body `<!-- wrap-up-skills-pr -->\n<!-- claude-tweaks-run: 2026-11-13T005701-spec-5290 -->` and `closingIssuesReferences: [{number: 5290}]`. Assert neither number is in the candidates file. Add a prose pin: `ITEM9` matches `/<!-- wrap-up-skills-pr -->[^\n]*never/`.
- [ ] **Step 2: Run it to verify it fails.** Run: `node --test tests/sweep-backstop.test.js` — Expected: FAIL (3002 is a candidate through its run marker).
- [ ] **Step 3: Edit item 9.** First statement in the filter callback: `if (/<!-- wrap-up-skills-pr -->/.test(pr.body || '')) return false;`. Add one sentence to item 9's opening paragraph: a `<!-- wrap-up-skills-pr -->` PR (`wrap-up/learned-skills-pr.md`) is never a candidate, by marker or linked-record grant, because it carries instruction edits a human must review.
- [ ] **Step 4: Run it to verify it passes.** Run: `node --test tests/sweep-backstop.test.js` — Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "Keep item 9 from arming a learned-skills PR — instruction edits wait for a human"`.

### Task 5: Wrap-up procedure prose, docs, and conformance pins

**Covers:** AC8.1 (FYI and final summary name the PR URL — the FYI via the engine-rendered Skill updates section and the final summary via the Phase 2 trace Detail cell, both from Task 3; Step 1 asserts both outputs), AC7.1/AC7.2 (merge-check.md untouched: assert `git diff --name-only {base}..HEAD` omits it at Common Step 5), AC9.1 (full suite at Common Step 5).

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/skills/wrap-up/learned-skills-pr.md`
- Modify: `plugin/skills/wrap-up/curation-engine.md` (section 3's payload table gains `findings[].pr`; section 4's serial-commit pass)
- Modify: `plugin/skills/wrap-up/skill-curation.md` (7.6 step 2 log line, plus the downgrade line)
- Modify: `plugin/skills/wrap-up/auto-merge-short-circuit.md` (FYI notification paragraph near line 250)
- Modify: `docs/plugin-structure.md` (wrap-up sub-file row; bin CLI listing, wherever `pr-early-open.js` is listed)
- Modify: `docs/skill-graph.md` (wrap-up's edges: `wrap-up/learned-skills-pr.md` → `_shared/github-pr-scan.md` item 9 exclusion; → `bin/learned-skills-pr.js`)
- Test: `tests/wrap-up-learned-skills-pr.test.js`
- Check, update only if a pin breaks: `tests/curation-git-mutation-carveout.test.js`, `tests/curation-judge-stagepath.test.js`

**Interfaces:**
- Consumes: the Task 1/2 CLI verbs and JSON, and Task 3's `pr` field.

- [ ] **Step 1: Write the failing prose tests** in `tests/wrap-up-learned-skills-pr.test.js`, reading live files via `tests/helpers/read-skill`:
  - `learned-skills-pr.md` names `learned-skills-pr.js capture`, `land` and `stage`, the marker `<!-- wrap-up-skills-pr -->`, and the record-owned rule. It states the PR is never armed. It contains no `gh pr merge` and no `--auto`.
  - `curation-engine.md` section 4's serial-commit pass cites `learned-skills-pr.md` for a `skills`-row applied finding, places `land`/`stage` after the pass and before any `record` call, and its section 3 table has a `findings[].pr` row.
  - `skill-curation.md` contains the exact AUTO shape `on learned-skills PR #{pr}. Reversibility: high; commit: {hash}.` and the STAGED downgrade shape from Global Constraints.
  - `auto-merge-short-circuit.md` says the FYI names the learned-skills PR URL.
  - Ordering (Reachability check): in `curation-engine.md`, the index of the `learned-skills-pr.md` citation is less than the index of the text `**before any \`record\` call**` that ends the pass's description, or sits inside that same paragraph. Assert on paragraph membership, not mere presence.
- [ ] **Step 2: Run them to verify they fail.** Run: `node --test tests/wrap-up-learned-skills-pr.test.js` — Expected: FAIL (`ENOENT … learned-skills-pr.md`)
- [ ] **Step 3: Write the prose.**
  - `learned-skills-pr.md`, which has three parts:
    - When it applies: every applied `skills`-row finding. It also applies to any other row's applied finding whose `targetPath` was already captured earlier in the same pass, which then rides the same patch.
    - The call sequence. `capture` per finding, with `--merge-base` from `{run-dir}/wrap-up-pack.json`'s `blastRadius.mergeBase` (multi-spec: the batch merge-base, Global Constraints), or else `git merge-base HEAD origin/{integration-branch}`. Outcomes:
      - `run-branch` → commit as today.
      - `captured` (including `shared: true`) → do not commit.
      - `staged` → the finding is staged (payload rewrite below).
      - `clean` → the audit's clean-path case, unchanged.
      - Exit 1 → nothing was touched: commit on the run branch as today and log `FAILED` naming the stderr. That is the one fail-safe exception, and merge-check's floor still holds that run.
    - After the pass, before any `record`: `integration-model` `pr-first` → `land`; `local-merge` → `stage --reason "integration-model is local-merge"`.
    - Payload rewrite. A landed finding sets `commit` = its hash and `pr` = the PR URL. A staged finding becomes `action: "staged"` with `stagePath` = the absolute path and no `commit`.
    - Also cover the FYI/summary line (Task 3's renderers carry the URL), the rule that it is never armed, and the item 9 exclusion.
  - Keep `curation-engine.md` edits surgical:
    - Step (1) "audit": an earlier same-pass `capture` of the same `targetPath` counts like an earlier same-pass commit, so call `capture`, which returns `shared: true`. Never treat that as a payload violation.
    - Step (2) "commit": one clause routing to `learned-skills-pr.md`.
    - One sentence after the pass.
    - One table row.
  - Add to Step 1's tests: `curation-engine.md` step (1)'s text names an earlier same-pass capture beside an earlier same-pass commit. Also assert on the real renderer output: `renderTrace` and `renderConsoleSections` fed a `skills` payload carrying `pr` both contain the URL (AC8.1 and AC8.2 end to end through `plugin/bin/wrap-up-engine.js render`, or the library functions when the CLI needs a full state file).
- [ ] **Step 4: Run them to verify they pass.** Run: `node --test tests/wrap-up-learned-skills-pr.test.js tests/curation-git-mutation-carveout.test.js tests/curation-judge-stagepath.test.js tests/sweep-backstop.test.js` — Expected: PASS. Then prove each new assertion red by reverting its pinned prose line once (skill-prose-conformance-tests rule).
- [ ] **Step 5: Commit** — `git add` the listed files, then `git commit -m "Route wrap-up's applied skill edits through learned-skills-pr — procedure, contract row, docs"`.
