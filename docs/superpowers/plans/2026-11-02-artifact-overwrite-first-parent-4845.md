# Artifact-overwrite run-commit attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the multi-spec artifact-overwrite check from counting commits a catch-up merge brought in from the integration branch as the run's own A/M events, and clear a deleted line blamed to such a commit as pre-run content, while `parallel` wave members merged back through `--no-ff` stay run events.

**Architecture:** `checkArtifactOverwrite` gains an optional `integrationRef`. When it is set, the A/M walk appends `^{integrationRef}` to its `{base}..{head}` range (after `--end-of-options`), and a lazily computed run-commit map (`git rev-list --parents {base}..{head} ^{integrationRef}`, merges included) lets the blame test clear a line blamed outside the run's own commits. Independently of the ref, a line blamed to a merge commit inside the run fails closed before attribution, so a manifest window can never attribute a merge's conflict resolution. `bin/check-artifact-overwrite.js` gains `--integration-ref <ref>`; the procedure doc passes `origin/{integration-branch}`.

**Tech Stack:** Node 18+, `node --test`, git.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T033256-record-4845/work/4845-spec.md`

**Scope keywords:** checkArtifactOverwrite, check-artifact-overwrite, artifact-overwrite-check, multispec-artifact-namespacing

## Spec reconciliation (Plan Review Decisions win)

The record's `## Plan Review Decisions` section says "where a decision conflicts with the text above, the decision wins". Applied:

- **Q1 Reading B, first variant** ("Wave-member commits stay run events. Exclude only what is reachable from the integration branch (`git log {base}..{head} --not {integration-ref}`)"). A `--first-parent` walk drops every commit behind a `--no-ff` wave merge, so the walk takes **no** `--first-parent`; it excludes `^{integrationRef}` instead. Deliverable 1's and Deliverable 3's `--first-parent --no-merges`, Deliverable 2's `git rev-list --first-parent` set, and Gotchas' "`bin/check-artifact-overwrite.js` needs no change" are superseded by it. Without `--first-parent`, `git log --name-status` prints no diff for a merge commit (default `--diff-merges=off`), so `--no-merges` would change nothing and could not be reverted to red; it is left out. Probed 2026-11-03 in a scratch repo: `log --diff-filter=AM --name-status --end-of-options {base}..HEAD ^up` listed spec A's `A a.md` and spec B's `M up.md` only (the upstream add and the merge commit absent), and on a two-member wave both members' `A w.md` / `M w.md` while `--first-parent --no-merges` printed nothing.
- **Q2 Reading B.** AC4's revert-red runs use the variant fixture (spec A edits `up.md` after the merge, spec B deletes spec A's line); the revert site is the walk call's `^{integrationRef}` token. A second revert site, the membership `continue`, is proved red on the AC2.1 `fakeGit` fixture.
- **Q3 Reading A, as it lands under Q1's design.** `{EXPECTED_BASE}` keeps its meaning. A fast-forward catch-up's commits are reachable from the integration ref, so `^{integrationRef}` excludes them too (fixture below); what remains a fail-closed false positive is a local-only ride-along commit (`worktree.baseRef: head`, local integration branch ahead of origin), which is not on `origin/{integration-branch}` and stays a run event. The procedure doc states this.
- **Plan fixes, accepted:** a blamed merge fails closed before attribution (manifest-bearing fixture, Task 1); the prose names the membership check as a way to clear a line in `multispec-artifact-namespacing.md`, `docs/journeys/catch-a-silent-journey-overwrite.md`, `docs/plugin-structure.md`'s CLI row and the module header (Tasks 1-3); Task 3's test bodies are written out.
- **Original-request AC "A run with no catch-up merge produces the same verdicts as before"** holds: with no `integrationRef` the walk argv is byte-identical to today's, and with one, a range holding no integration-branch commit excludes nothing. The only verdict change outside a catch-up is the merge fail-closed fix, which can only turn `clean` into an overwrite.

## Global Constraints

- "Blame still runs on `{commit}~1` over full history" — only the run-commit membership test changes.
- "A deleted line with no blame attribution still fails closed, as today." — the no-blame branch stays ahead of the membership test.
- "Conflict-resolution edits inside a catch-up merge are no longer walked. A merge commit's own resolution is not a spec's edit, so this is intended. Don't add `-m` or `--cc` to bring it back."
- `bin/check-artifact-overwrite.js` keeps its exit codes and its `--base`/`--head`/`--path`/`--run` flags unchanged; `--integration-ref` is the one addition (Q1's override "for that input alone").
- Governing skill `gh-api-module-pattern` (SKILL.md), verbatim: "An argv array stops shell injection, not flag injection. A caller-supplied value that begins with `-` is still read as an *option* by the command itself, so any such value needs an end-of-options separator ahead of it. For `git` the separator is **`--end-of-options`, not `--`**". Both new git argvs put the range and `^{integrationRef}` after `--end-of-options`; every git call goes through the injected `git(argv, cwd)` runner.
- Governing skill `gh-api-module-pattern` (`cli-wrapper-contract.md`), verbatim: "Validate the value inside `parseArgs` … `typeof v !== 'string' || !v.trim() || v.startsWith('--')` returns a usage error — and pin both the trailing bare flag and the empty-string value with their own test cases. … A value the CLI forwards into a child's argv as a positional (a remote, a ref) rejects any leading `-`, because the child reads `-x` as an option too". `--integration-ref` rejects an empty, whitespace-only, or `-`-leading value with exit 2.
- Consumer portability: no `main`/`origin` literal in `plugin/bin/`; the ref is an input. Fixtures name the integration branch `up`, never `main`. The procedure doc resolves `{integration-branch}` per `_shared/integration-branch.md`.
- `node-test-output-evidence`, `parse-signal-discipline`: no rule applies — the only new output parsed is `rev-list --parents`' newline-split sha lines.

Waived AC5.1: the existing fixtures and live replays already pin it and stay unchanged; Task 1 Step 4 runs them.
Waived AC4.2: superseded by Q1 — the design has no `--no-merges` flag (it would be a no-op without `--first-parent`), so there is no second walk flag to remove; Task 1 Step 5 proves the membership `continue` red instead.
Waived AC4.3: a PR-comment requirement, met at Task 1 Step 5.
Waived AC7.1: Common Step 5's verification runs the full suite.

## Review Focus

- A catch-up merge whose own (evil) resolution writes a line a later spec deletes, with a manifest whose window would attribute the untrailered merge: fails closed, reason names the merge (Task 1, `AC2.1 (manifest)` test).
- A `parallel` wave whose member 2 overwrites member 1, both merged back `--no-ff`: still an overwrite with `integrationRef` set (Task 1, wave tests).
- `integrationRef` omitted: walk argv carries no `^` token and the blame test never clears by membership (Task 1, argv test + the existing fixtures).
- An empty walk with `integrationRef` set: still exactly one git call, no `rev-list` (Task 1, argv test).
- A deleted line with no blame: still fails closed ahead of membership (Task 1, `fakeGit` no-blame test).

---

### Task 1: Integration-ref exclusion, run-commit membership, merge fail-closed

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/flow/artifact-overwrite-check.js` — header comment (test 1 paragraph `:17-35`, fail-closed paragraph `:77-80`), JSDoc `:427-436`, opts destructure `:438-445`, walk argv `:462-465`, blame loop `:525-546`, reason composition `:550-567`
- Test: `tests/bin-lib/flow/artifact-overwrite-check.test.js`

**Interfaces:**
- Consumes: the module's injectable `git(argv, cwd)` runner; the test file's `repo()`, `write()`, `commit()`, `commitAt()`, `manifestRun()`, `T0`, `SPEC_10_DONE`.
- Produces: `checkArtifactOverwrite({ base, head, paths, cwd, git, manifest, integrationRef })` — `integrationRef?: string`, a commit-ish whose history is not the run's own. No new export. Inside it, a lazy cached `getRunCommits(): Map<string, boolean>` (sha → is-merge) from `git(['rev-list', '--parents', '--end-of-options', `${base}..${head}`, ...exclude], cwd)`, where `exclude` is `[`^${integrationRef}`]` or `[]`; a line's parent count > 1 marks a merge.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/flow/artifact-overwrite-check.test.js`, add these helpers and tests (real repos unless noted). Helpers: `upstreamRepo()` = `repo()` then `fx.git('branch', 'up')`, `fx.git('checkout', '-q', '-b', 'run')`; `onUp(fx, fn)` checks out `up`, runs `fn`, checks out `run`, returns `fn`'s value; `mergeIn(fx, branch)` runs `git merge -q --no-ff --no-edit {branch}` and returns HEAD. `check(fx, extra)` = `checkArtifactOverwrite({ base: fx.base, paths: ['docs/journeys/'], cwd: fx.dir, ...extra })`.

- `AC1.1: an upstream journey a catch-up merge brought in, edited by a run spec, is clean with integrationRef` — run: spec A adds `docs/journeys/a.md` (`refs #1`); up: adds `docs/journeys/up.md` `'# Up\nline 1\nline 2\n'` (`refs #999`); `mergeIn(fx,'up')`; spec B (`refs #2`) changes `line 1`. Assert `check(fx, { integrationRef: 'up' })` deep-equals `{ clean: true, overwrites: [] }` and `check(fx).clean === false` (today's false positive, the discrimination).
- `AC4.1: variant — spec B deleting spec A's post-merge line in an upstream-added journey is clean with integrationRef` — up adds `up.md` `'# Up\nline 1\n'` (`refs #999`); merge; spec A (`refs #1`) appends `spec A line`; spec B (`refs #2`) deletes it. Assert `check(fx, { integrationRef: 'up' }).clean === true`, `check(fx).clean === false`. (This is the revert-red fixture: with the walk's `^{ref}` removed, the upstream `A` returns and spec B's deletion blames spec A, inside the set.)
- `AC3.1: a genuine cross-spec overwrite after a catch-up merge is still reported, naming the overwriting commit` — spec A adds `a.md` `'# A\n\n## Step 1\nFirst content.\n'` (`refs #1`); up adds unrelated `docs/journeys/other.md` (`refs #999`); merge; spec B (`refs #2`) replaces `First content.`. Assert with `integrationRef: 'up'`: `clean === false`, `overwrites.length === 1`, `overwrites[0].commit === specB`, `overwrites[0].path === 'docs/journeys/a.md'`.
- `Q1: a wave member overwriting another member, both merged back --no-ff, is still an overwrite` — from `run`: `checkout -q -b m1`, member 1 adds `w.md` `'# W\nmember one line\n'` (`refs #1`); `checkout run`, `mergeIn(fx,'m1')`; `checkout -q -b m2`, member 2 (`refs #2`) replaces the line; `checkout run`, `mergeIn(fx,'m2')`. Assert `check(fx, { integrationRef: 'up' }).clean === false`, `overwrites[0].commit` is member 2's sha.
- `Q1: a first-parent spec deleting a merged-back wave member's line is still an overwrite` — member 1 (`refs #1`, branch `m1`) adds `w.md` with two lines, merged back `--no-ff`; spec 2 (`refs #2`) on `run` deletes member 1's second line. Assert `clean === false` with `integrationRef: 'up'` (the member's sha is in the `rev-list` set, so membership does not clear it).
- `Q3: a fast-forward catch-up's commits are excluded by integrationRef` — up adds `up.md` (`refs #999`); on `run` `git merge -q --ff-only up`; spec B (`refs #2`) edits `up.md`'s line. Assert `check(fx, { integrationRef: 'up' }).clean === true`, `check(fx).clean === false`.
- `AC2.1 (manifest): a line a catch-up merge's own resolution wrote fails closed even when a manifest window would attribute the merge` — every commit authored inside spec 10's window via `commitAt` (`T0` + minutes): run: spec 10 adds `docs/journeys/a.md` `'# A\nkeep\n'` (no trailer); up: adds `docs/journeys/other.md` (no trailer); `git merge -q --no-ff --no-commit up`, write `a.md` `'# A\nkeep\nresolution line\n'`, `git add -A`, then commit the merge with `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` pinned; spec 10 (no trailer) deletes `resolution line`. `const { manifest } = manifestRun(SPEC_10_DONE, [10])`. Assert `check(fx, { integrationRef: 'up', manifest }).clean === false` and its reason matches `/merge commit/`; with the merge check deleted the window attributes the merge to spec 10 and the verdict is clean (Step 5 proves this).
- `fakeGit` tests (no repo). Shas: `C1='1'.repeat(40)`, `C2='2'.repeat(40)`, `MERGE='3'.repeat(40)`, `OUTSIDE='4'.repeat(40)`, `UPSHA='5'.repeat(40)`. A `fakeGit(blamedSha)` factory recording `calls` and routing on argv: `log` + `--name-status` → `` `${C1}\0\nA\0docs/journeys/x.md\0${C2}\0\nM\0docs/journeys/x.md\0` ``; `log` + `--numstat` → `'0\t1\tdocs/journeys/x.md\n'`; `diff` → `'@@ -2 +1,0 @@\n-deleted line\n'`; `blame` → `` `${C1} 1 1 1\n\tline one\n${blamedSha} 2 2 1\n\tdeleted line\n` `` (or only the first entry when `blamedSha` is null); `rev-list` → `` `${C2} ${C1}\n${MERGE} ${C1} ${UPSHA}\n${C1} ${'0'.repeat(40)}\n` ``; `log` + `-1` → `'2026-01-01T10:00:00Z\nmsg (refs #2)\n'` for `C2`, `'2026-01-01T10:00:00Z\nupstream (refs #999)\n'` otherwise.
  - `AC2.1: a deleted line blamed to a SHA outside the run's commits is clean` — `checkArtifactOverwrite({ base: 'b', head: 'h', integrationRef: 'up', git: fakeGit(OUTSIDE), cwd: '/f' }).clean === true`; the `rev-list` call's argv deep-equals `['rev-list', '--parents', '--end-of-options', 'b..h', '^up']`.
  - `AC2.1: the same deletion blamed to a run merge commit is an overwrite` — `fakeGit(MERGE)` → `clean === false`, reason matches `/merge commit/`.
  - `a deleted line with no blame attribution still fails closed ahead of the membership test` — `fakeGit(null)` with `integrationRef: 'up'` → `clean === false`, reason matches `/no blame attribution/`.
  - `without integrationRef a line blamed outside the range is not cleared` — `fakeGit(OUTSIDE)`, no `integrationRef` → `clean === false`; the `rev-list` argv deep-equals `['rev-list', '--parents', '--end-of-options', 'b..h']`.
- Extend the existing `the top-level walk guards the interpolated {base}..{head} range with --end-of-options` neighbourhood with `integrationRef appends ^{ref} right after the range, and an empty walk makes no rev-list call` — empty-output `fakeGit`, `integrationRef: 'up'`: `calls.length === 1`, and in `calls[0]` the token after `'main..HEAD'` is `'^up'`, followed by `'--'`. The existing test (no `integrationRef`) stays unchanged and still pins no `^` token by its exact neighbour assertion.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/flow/artifact-overwrite-check.test.js`
Expected: FAIL for AC1.1, AC4.1, Q3, AC2.1 (all four), and the `^{ref}` argv test. AC3.1, both Q1 wave tests, and the no-blame test pass before and after: regression pins, not red-first tests.

- [ ] **Step 3: Implement in `plugin/bin/lib/flow/artifact-overwrite-check.js`**

Destructure `integrationRef` from `opts`; `exclude = integrationRef ? [`^${integrationRef}`] : []`; walk argv becomes `[..., '--end-of-options', `${base}..${head}`, ...exclude, '--', ...paths]`. Add `getRunCommits()` per Interfaces (cached, first called only from the blame loop). In the blame loop, after the `!blamedSha` branch and before `getAttribution(blamedSha)`: when `integrationRef` is set and `!runCommits.has(blamedSha)` → `continue` (pre-run content); when `runCommits.get(blamedSha) === true` → overwrite with a `culprit` flagged `merge: true`. Reason for that culprit: `deleted line {n} (as of parent {commit}~1) traces to merge commit {sha} — a merge's own lines (a conflict resolution) are never a spec's edit, so a same-spec self-edit cannot be confirmed, {tail}`. Header: test 1's paragraph names the walk scope (`{base}..{head}`, minus `^{integrationRef}` when given, no `--first-parent` so `parallel` wave members stay run events) and that a deleted line blamed outside the run's own commits is pre-run content and clears that line; the fail-closed paragraph adds "a line blamed to a merge commit inside the run". JSDoc gains `opts.integrationRef`.

- [ ] **Step 4: Run the module's suites and the live replays**

Run: `node --test tests/bin-lib/flow/artifact-overwrite-check.test.js tests/bin-lib/flow/check-artifact-overwrite-cli.test.js`
Expected: PASS, including the #1988–#1997, `d81250829..80e3dad2d`, `729a5ae5e..4706f21db` and `cdf6627d9~1..c31b0e07c` replays (AC5.1 — none passes `integrationRef`, so their walk argv is unchanged).

- [ ] **Step 5: Revert-red probes and AC evidence**

Scratch edits only, each restored before the next (`git diff --stat` empty after the last). (a) Delete `...exclude` from the walk argv; run `node --test --test-name-pattern "AC4.1" tests/bin-lib/flow/artifact-overwrite-check.test.js` → FAIL. (b) Delete the membership `continue`; run with `--test-name-pattern "outside the run's commits is clean"` → FAIL. (c) Delete the merge fail-closed branch; run with `--test-name-pattern "manifest window would attribute"` → FAIL. Write each run's output to `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-03T033256-record-4845/evidence/revert-red-{a,b,c}.txt` (`mkdir -p` first, plain Bash redirect), log one `decisions.md` `AUTO` entry per run (`log-decision.js --section "/build" --step "AC evidence" --text-file {file}`: the AC id, the command, the fail count, the evidence path), and post the three red results as one PR #4963 comment (`gh pr comment 4963 --body-file {file}`) — AC4.1, AC4.3.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/flow/artifact-overwrite-check.js tests/bin-lib/flow/artifact-overwrite-check.test.js
git commit -m "Exclude integration-branch commits from the overwrite check's run events — refs #4845"
```

### Task 2: `--integration-ref` on the CLI

**Role:** integration

**Files:**
- Modify: `plugin/bin/check-artifact-overwrite.js` — header usage/flag block `:11-31`, `USAGE` `:45`, arg loop `:65-79`
- Modify: `docs/plugin-structure.md:245` — the CLI's command line: add `[--integration-ref <ref>]` to the synopsis and one clause naming the exclusion, the membership clearing and the merge fail-closed
- Test: `tests/bin-lib/flow/check-artifact-overwrite-cli.test.js`

**Interfaces:**
- Consumes: Task 1's `checkArtifactOverwrite({ ..., integrationRef })`.
- Produces: `check-artifact-overwrite.js --base <ref> [--head <ref>] [--path <pathspec>]... [--run <dir>] [--integration-ref <ref>]`; stderr `check-artifact-overwrite: --integration-ref requires a ref not starting with -` + USAGE, exit 2. Exit 3 also covers an unresolvable `--integration-ref` (a git failure, already mapped).

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/flow/check-artifact-overwrite-cli.test.js`, add:

- `--integration-ref is forwarded to the check as integrationRef` — `run([... '--base','a','--integration-ref','origin/main'], { ...io, check: (o) => { seen = o; return { clean: true, overwrites: [] }; } })` → 0 and `seen.integrationRef === 'origin/main'`.
- `--integration-ref rejects an empty, a whitespace-only and a dash-leading value (exit 2)` — for each of `''`, `'  '`, `'-x'`, `'--upload-pack=evil'`: exit 2, stderr matches `/--integration-ref requires a ref/`, `check` never called.
- `a trailing bare --integration-ref is a malformed invocation (exit 2)` — `['--base','a','--integration-ref']` → 2, `/requires a value/`.
- `end-to-end: a catch-up merge of upstream's journey exits 0 with --integration-ref and 1 without` — real repo built like Task 1's AC1.1 fixture (local helpers in this file, branch `up`), `spawnSync(process.execPath, [CLI, '--base', base, '--path', 'docs/journeys/', '--integration-ref', 'up'], { cwd })` → status 0, stdout `{"clean":true,"overwrites":[]}`; without the flag → status 1.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/flow/check-artifact-overwrite-cli.test.js`
Expected: FAIL on the four new tests (`unknown argument: --integration-ref`).

- [ ] **Step 3: Implement**

`case '--integration-ref':` refuses `!value.trim() || value.startsWith('-')`, else `opts.integrationRef = value`. Header: one flag line ("`--integration-ref` a ref whose history is not the run's own — `origin/{integration-branch}`; commits reachable from it leave the walk, and a deleted line blamed to one is pre-run content (refs #4845). Omitted, every commit in the range is a run event, as before.") and exit 3's list gains "an unresolvable `--integration-ref`". `USAGE` gains `[--integration-ref <ref>]`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/flow/check-artifact-overwrite-cli.test.js tests/bin-lib/flow/artifact-overwrite-check.test.js`
Expected: PASS.

- [ ] **Step 5: Real-input probe (this branch's own catch-up)**

This worktree's catch-up merge `ff178b820` brought in `58642ee43` (#4940) and `1b43e28d0` (#4847), the record's 2026-11-02 comment's pair. Run, from the worktree, `node plugin/bin/check-artifact-overwrite.js --base 1d190761f --path docs/journeys/ --path stories/` — recorded at authoring: exit 1, one overwrite on `docs/journeys/opt-out-of-project-scope-claude-tweaks-declaration.md`, commit `58642ee43…`, blamed `1b43e28d0…`. Then the same with `--integration-ref origin/main` → expected exit 0, `{"clean":true,"overwrites":[]}`. Independent count: `git rev-list --count 1d190761f..HEAD ^origin/main` equals the number of this branch's own commits (`git log --oneline 1d190761f..HEAD --first-parent` minus the merge), and `git merge-base --is-ancestor 58642ee43 origin/main` exits 0. Log both CLI outputs as an `AC evidence` entry for AC1.1 with the output at `{run-dir}/evidence/real-input-probe.txt`.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/check-artifact-overwrite.js tests/bin-lib/flow/check-artifact-overwrite-cli.test.js docs/plugin-structure.md
git commit -m "Add --integration-ref to check-artifact-overwrite — refs #4845"
```

### Task 3: Procedure, journey and integration-branch consumer prose

**Role:** integration

**Files:**
- Modify: `plugin/skills/flow/multispec-artifact-namespacing.md` — raw walk `:13`, its paragraph `:16-22`, tool command `:44`, the `--run` paragraph `:47-53`, test 1 `:59-70`, the "Only a commit…" paragraph `:96-110` (8,548 B now; this task adds about 1.5 KB against the 52,500 B rail — headroom stays above 40 KB)
- Modify: `plugin/skills/_shared/integration-branch.md` — one Per-consumer fallback table row
- Modify: `docs/journeys/catch-a-silent-journey-overwrite.md` — step 1 URL/Action, a new step 7 (the #4845 catch-up case), step 8 (renumbered from 7) membership sentence, `## Origin` bullet
- Modify: `tests/skill-fence-guard-shapes.test.js:136` — the ratchet anchor (the raw walk's first 90 characters change)
- Test: `tests/multispec-artifact-namespacing-conformance.test.js`

Grep proof of the pin set, run at authoring: `git grep -n -e "catch-a-silent-journey-overwrite" -e "multispec-artifact-namespacing" -- tests` → only `tests/multispec-artifact-namespacing-conformance.test.js` and `tests/skill-fence-guard-shapes.test.js:136`. The existing pins kept intact: `git -C "$WORKTREE" log --name-status --diff-filter=AM`, `HARD-GATE: stop before rendering the console`, `check-artifact-overwrite.js" --base "{EXPECTED_BASE}" --run "{parent}"` (so `--integration-ref` goes after `--run "{parent}"`), and "Omit `--run` only when this run's `parallel` waves actually ran with two or more members". `plugin/skills/flow/multi-spec.md:154-160` cites "a `git log --name-status`" walk without flags and stays accurate (no edit).

**Interfaces:**
- Consumes: Task 2's flag spelling `--integration-ref`.
- Produces: the two command lines below, verbatim.

- [ ] **Step 1: Write the failing tests**

In `tests/multispec-artifact-namespacing-conformance.test.js`, factored so each go-red control runs the same assertion function:

```js
function assertRawWalkExcludesIntegrationRef(text) {
  assert.match(text, /log --name-status --diff-filter=AM "\{EXPECTED_BASE\}\.\.HEAD" "\^origin\/\{integration-branch\}" -- docs\/journeys\/ stories\//);
}
test('AC6.1: the raw walk excludes the integration branch\'s history (Q1 decision)', () => {
  assertRawWalkExcludesIntegrationRef(read(NAMESPACING_FILE));
});
test('go-red proof: the pre-#4845 raw walk fails the AC6.1 assertion', () => {
  assert.throws(() => assertRawWalkExcludesIntegrationRef(flatten('git -C "$WORKTREE" log --name-status --diff-filter=AM "{EXPECTED_BASE}..HEAD" -- docs/journeys/ stories/')));
});
function assertIntegrationRefInCommand(text) {
  assert.match(text, /check-artifact-overwrite\.js" --base "\{EXPECTED_BASE\}" --run "\{parent\}" --integration-ref "origin\/\{integration-branch\}"/);
}
test('AC1.1: the procedure passes --integration-ref "origin/{integration-branch}" to the check', () => {
  assertIntegrationRefInCommand(read(NAMESPACING_FILE));
});
test('go-red proof: a command without --integration-ref fails the same assertion', () => {
  assert.throws(() => assertIntegrationRefInCommand(flatten('node "${CLAUDE_PLUGIN_ROOT}/bin/check-artifact-overwrite.js" --base "{EXPECTED_BASE}" --run "{parent}" --path docs/journeys/')));
});
function assertMembershipClearing(text) {
  assert.match(text, /blamed commit is not one of the run's own commits/);
  assert.match(text, /merge commit inside the run is never cleared/);
}
test('AC2.1: the procedure names the membership check and the merge fail-closed', () => {
  assertMembershipClearing(read(NAMESPACING_FILE));
});
test('go-red proof: a procedure naming only the five tests fails the membership assertion', () => {
  assert.throws(() => assertMembershipClearing(flatten('Only a commit that deletes lines failing all five tests is a real overwrite.')));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/multispec-artifact-namespacing-conformance.test.js`
Expected: FAIL on the three positive tests (AC6.1, AC1.1, AC2.1); the go-red controls pass.

- [ ] **Step 3: Edit the prose**

`multispec-artifact-namespacing.md`:
- Line 13 becomes `git -C "$WORKTREE" log --name-status --diff-filter=AM "{EXPECTED_BASE}..HEAD" "^origin/{integration-branch}" -- docs/journeys/ stories/`.
- After "the run's own commit range, never the whole repo history", add: "`{integration-branch}` resolves per `_shared/integration-branch.md`. `^origin/{integration-branch}` drops every commit that branch already carries — what a catch-up merge (or a fast-forward catch-up) brought in from upstream, and the catch-up merge commit's own lines — so neither reads as one of the run's events; `parallel` wave members merged back with `--no-ff` are not on that branch and stay run events. A local-only commit riding along from a local integration branch ahead of origin is not excluded and can still fail closed. With no `origin/{integration-branch}` ref (no remote), drop that token: every commit in the range is then a run event."
- Line 44 becomes `node "${CLAUDE_PLUGIN_ROOT}/bin/check-artifact-overwrite.js" --base "{EXPECTED_BASE}" --run "{parent}" --integration-ref "origin/{integration-branch}" --path docs/journeys/ --path stories/`, and the `--run` paragraph gains: "Pass `--integration-ref` whenever `origin/{integration-branch}` resolves; omit it only when it does not (the same no-remote case as the raw walk) — the check then keeps upstream commits as run events and fails closed on them."
- Before the five tests ("It re-runs the same walk…" paragraph), add: "First, a deleted line whose blamed commit is not one of the run's own commits (`{EXPECTED_BASE}..HEAD` minus `^origin/{integration-branch}`, merges included) is pre-run content, from the base or from upstream, and is cleared without a test; a line blamed to a merge commit inside the run is never cleared by attribution — a merge's own lines are a conflict resolution, not a spec's edit — and fails closed."
- The "Only a commit that deletes lines failing *all five* tests" sentence gains "(after the run-commit check above)"; exit 3's list gains "an unresolvable `--integration-ref`".

`_shared/integration-branch.md` table row, after the Merge-Provenance Check row: `| \`bin/check-artifact-overwrite.js\` (\`flow/multispec-artifact-namespacing.md\`, #4845) | \`origin/{integration-branch}\`, whose history is excluded from a multi-spec run's overwrite walk | **Omit \`--integration-ref\`:** every commit in the range is a run event, the pre-#4845 behavior, failing closed on upstream commits |`.

Journey: step 1's URL appends `--integration-ref "origin/$INTEGRATION_BRANCH"` after `--run "$MULTISPEC_PARENT_DIR"`; new step 7 "Read a run that caught up with upstream — the #4845 case" (URL: this repo's `--base 1d190761f` probe from Task 2 Step 5 with and without `--integration-ref origin/main`; Should understand: without the flag the upstream pair `58642ee43`/`1b43e28d0` reads as an overwrite, with it the run's own commits are the only events and the verdict is clean; a merge's own resolution line still fails closed; Red flags: `clean: true` on a wave member overwriting another member); step 8 (old 7) gains "Before any of the five, a line blamed outside the run's own commits (`--integration-ref` given) is pre-run content and cleared, and one blamed to a merge commit inside the run fails closed."; `## Origin` gains "- Step 7 added, and step 1 given `--integration-ref`, during build of #4845 (exclude integration-branch commits from the run's events)." Renumber check, three forms: `git grep -n -e "### 7\." -e "step 7" -e "seven" -- docs/journeys/catch-a-silent-journey-overwrite.md` after the edit shows only the new step 7 heading and the Origin bullet.

`tests/skill-fence-guard-shapes.test.js:136` anchor becomes `'git -C "$WORKTREE" log --name-status --diff-filter=AM "{EXPECTED_BASE}..HEAD" "^origin/{in'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/multispec-artifact-namespacing-conformance.test.js tests/skill-fence-guard-shapes.test.js tests/integration-branch-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Behavior-change prose sweep**

Run: `git grep -n -i -e "A-then-M" -e "five independent tests" -e "failing \*all five\*" -e "same-spec self-edit" -- plugin docs .claude/skills ":!docs/superpowers/plans" ":!.claude-tweaks/pipelines" ":!docs/plans/*-ledger.md"`. Each hit either already reads correctly with the run-commit check placed ahead of the five tests or gets the clause; record the classification in the commit body. Control: the same grep with `-c` at authoring matched `plugin/skills/flow/multispec-artifact-namespacing.md` (4 lines), `plugin/bin/lib/flow/artifact-overwrite-check.js` (3, Task 1's header), `docs/journeys/catch-a-silent-journey-overwrite.md` (1) and `docs/plugin-structure.md` (1, Task 2's row).

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/flow/multispec-artifact-namespacing.md plugin/skills/_shared/integration-branch.md docs/journeys/catch-a-silent-journey-overwrite.md tests/multispec-artifact-namespacing-conformance.test.js tests/skill-fence-guard-shapes.test.js
git commit -m "Pass the integration ref to the artifact-overwrite procedure — refs #4845"
```
