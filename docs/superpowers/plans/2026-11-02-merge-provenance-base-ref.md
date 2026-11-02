# Merge-Provenance Base-Ref Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `base:{ref}` review keeps every path in its diff, and the Merge-Provenance Check excludes a file only on positive evidence that it arrived from the integration line.

**Architecture:** Two skill-prose changes plus one fixture-driven conformance suite. `code-mode-steps.md`'s Step 2 gate stops `base:{ref}` from reaching the check at all. `merge-provenance-check.md` replaces the first-parent "absent means from base" rule with a fork-point computation: excluded = in the full diff AND touched on the integration line since `{base}` AND not touched on any branch-side commit. The suite extracts the shipped fences and runs them against real merge topologies.

**Tech Stack:** Markdown skill prose; `node --test`; git.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T111211-record-4639/work/4639-spec.md`

## Global Constraints

- `plugin/skills/review/code-mode-steps.md` stands at 51,501 B against `RAIL_BYTES` 52,500 B. This plan adds about 300 B, leaving about 700 B of headroom. Do not grow it further; never pin a skill's size against a byte literal.
- Never run `git stash`, `git reset`, or a mutating go-red against the tree; prove go-red by mutating text in memory.
- Commit style: `{Verb} {what} — {detail}`; write "refs #4639", never "closes" or "fixes". End each commit message with the line `Claude-Session: https://claude.ai/code/session_017vXcAcBQg1Wk6xJwTFGwNm`.
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.

Governing skill `skill-prose-conformance-tests`, quoted verbatim:

- "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`."
- "Build throwaway git repos from `tests/helpers/git-fixtures.js` (`gitRepo`, `FIXTURE_TIMEOUT_MS`), never a hand-rolled `git init` ladder"
- "the test pulls the fence out of the doc with an anchored regex and executes exactly that string, so the doc is the only source of the executed text and the two cannot drift"
- "Anchoring a fence or line extraction regex on a bare `\n` ... Write `\r?\n`"
- "Run a snippet the Bash tool executes under both `bash --noprofile --norc` and `zsh -f`." "Skip the zsh case with a visible reason when zsh is not on PATH (ubuntu CI), never silently"
- "Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** ... preceded by `assert.notEqual(mutated, original)`"

Other governing skills: `prose-code-twin-pin` does not apply (no executable twin of this rule exists); `merge-shape-landed-proof` does not apply (this decides review scope, not whether work landed before a destructive act).

## Review Focus

1. A release range whose first-parent line carries `--no-ff` PR merges: every PR's files stay in the review (fixture A).
2. A branch that merged another unlanded branch: that branch's files ship with this one, so they stay in scope and are never reported as from the base (fixture D).
3. A file changed only by a merge commit's own edit: it stays in scope (fixture E).
4. A fresh `origin/{base}`, where the catch-up merge's content is already outside the three-dot diff: nothing is excluded, and no report section appears (fixture C).
5. A branch with no common ancestor with the integration branch: `git merge-base` exits 1 printing nothing, and the rule excludes nothing rather than guessing (prose pin plus fixture F).

---

### Task 1: Gate `base:{ref}` out of the check and re-derive its exclusion rule

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/review/merge-provenance-check.md`
- Modify: `plugin/skills/review/code-mode-steps.md` (the Merge-Provenance Check bullet list, currently lines 141-142)
- Modify: `docs/plugin-structure.md:109` (the phrase `Step 2 own-work scope computation — lazy-loaded only when the base branch was merged into this branch mid-history`)
- Test: `tests/review-merge-provenance-check.test.js` (new)
- Waived `plugin/skills/_shared/fast-lane-digest.md`: names the check and its file only; no rule text to change.

**Interfaces:**
- Consumes: `readText` from `tests/helpers/read-skill.js`; `gitRepo`, `fixtureGit` from `tests/helpers/git-fixtures.js`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing test** at `tests/review-merge-provenance-check.test.js`.

Header comment cites #4639 and why reading live prose is the carve-out here (the fences are the shipped procedure; extract-and-run means the doc is the only source of the executed text).

Helpers the suite owns:

- `fences(text)`: returns every ` ```bash ` fence body via `/```bash\r?\n([\s\S]*?)```/g`; asserts exactly 2 with the message `extraction pattern is out of sync`.
- `run(shell, dir, line)`: `spawnSync(shell, shellArgs, { cwd: dir, encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS })`, with `bash` args `['--noprofile', '--norc', '-c', line]` and `zsh` args `['-f', '-c', line]`; returns `{ status, stdout }`.
- `excludedBy(shell, dir, base, branch)`: fills `{base}`, `{branch}`, `{integration-branch}` (`main`) in the live fences. Runs fence 1 (its stdout, trimmed, is `{fork}`). When `{fork}` is empty it returns `{ full: <from the third fence's diff line>, excluded: [] }`. Otherwise it runs fence 2's three lines in order as `line`, `branchSide`, `full`, and returns `{ full, excluded }` with `excluded = full.filter(f => line.includes(f) && !branchSide.includes(f))`, both sorted.
- `firstParentDropped(dir, base, branch)`: the frozen pre-change rule, from these two literal command strings kept as test constants: `git log --first-parent --no-merges {base}..{branch} --name-only --pretty=format:` and `git diff {base}...{branch} --name-only`; returns full diff files absent from the first list.
- `fixture()`: `gitRepo({ branch: 'main' })`, sets `user.name`/`user.email`, with a `commitFile(name)` helper and an `origin()` helper that runs `update-ref refs/remotes/origin/main main`.
- `assertGates(stepsText, checkText)`: one `assert.match` per claim, each with its own message:
  - in `stepsText`'s slice from `### Merge-Provenance Check` to `### Cherry-Pick Provenance Check` (assert both anchors resolve): `/\*\*A `base:\{ref\}` scope\*\*[^\n]*count it as no merge commits detected/`, message `steps gate: no-merges ruling`.
  - same slice: `/\*\*A `base:\{ref\}` scope\*\*[^\n]*Every path in the diff stays in scope/`, message `steps gate: every path stays`.
  - in `checkText`: `/A `base:\{ref\}` scope never reads this file/`, message `check file: base scope exit`.

Tests, each run over `SHELLS` (`bash`, plus `zsh` when `spawnSync('zsh', ['-f', '-c', 'exit 0'])` succeeds; otherwise `t.skip('zsh not on PATH')` on a zsh sub-case):

```js
test('AC1.1: base:{ref} is gated out, and the reason it must be holds on a real range', () => {
  // fixture A: tag v1; branch pr commits pr-file; main merges it --no-ff; main commits squash-file; origin()
  assertGates(STEPS, CHECK);
  assert.deepEqual(firstParentDropped(dir, 'v1', 'origin/main'), ['pr-file']);
  // the same rule unguarded would exclude all of it, so the gate is load-bearing
  assert.deepEqual(excludedBy('bash', dir, 'v1', 'origin/main').excluded, ['pr-file', 'squash-file']);
});

test('AC1.1: a gate clause removed from the prose goes red with its own message', () => {
  // one mutated copy per assertGates claim; assert.notEqual(mutated, original), then
  // assert.throws(() => assertGates(...), { message: /steps gate: no-merges ruling/ }) and so on for the other two
});

test('AC1.1: fixed-base catch-up excludes only what arrived from the integration line', () => {
  // fixture B: start = HEAD; branch feat commits feat-file and shared; main commits main-file; origin();
  // feat merges origin/main
  assert.deepEqual(excludedBy(shell, dir, start, 'feat'),
    { full: ['feat-file', 'main-file', 'shared'], excluded: ['main-file'] });
});

test('AC1.1: fresh base excludes nothing', () => {
  // fixture C: feat-file on feat; main-file on main; origin(); feat merges origin/main; main-later on main; origin()
  assert.deepEqual(excludedBy(shell, dir, 'origin/main', 'feat'), { full: ['feat-file'], excluded: [] });
});

test('AC1.1: another unlanded branch merged in stays in scope', () => {
  // fixture D: origin(); other commits other-file; feat (from main) commits feat-file and merges other
  assert.deepEqual(excludedBy(shell, dir, 'origin/main', 'feat'),
    { full: ['feat-file', 'other-file'], excluded: [] });
  assert.deepEqual(firstParentDropped(dir, 'origin/main', 'feat'), ['other-file']); // the defect, frozen
});

test('AC1.1: a file changed only by the merge commit stays in scope', () => {
  // fixture E: start = HEAD; feat-file on feat; main-file on main; origin();
  // feat: merge --no-commit --no-ff origin/main, add evil-file, commit
  assert.deepEqual(excludedBy(shell, dir, start, 'feat'),
    { full: ['evil-file', 'feat-file', 'main-file'], excluded: ['main-file'] });
  assert.deepEqual(firstParentDropped(dir, start, 'feat'), ['evil-file', 'main-file']); // the defect, frozen
});

test('AC1.1: no common ancestor excludes nothing', () => {
  // fixture F: origin(); checkout --orphan lone; commit lone-file
  assert.deepEqual(excludedBy('bash', dir, 'origin/main', 'lone').excluded, []);
  assert.match(CHECK, /prints nothing[^\n]*nothing is excluded/);
});

test('AC1.1: the check states the rule the helper applies and no longer states the first-parent one', () => {
  const flat = CHECK.replace(/\s+/g, ' ');
  assert.ok(flat.includes('in the full diff and the integration-line list and absent from the branch-side list'));
  assert.ok(flat.includes("arrived via merge from {integration-branch}, not this branch's own work"));
  assert.ok(!flat.includes('--first-parent'));
  assert.ok(!flat.includes('arrived via merge from {base}'));
});
```

Close the file by removing every fixture directory with `fs.rmSync(dir, { recursive: true, force: true })`.

- [ ] **Step 2: Run the test to verify it fails.**

Run: `node --test tests/review-merge-provenance-check.test.js`
Expected: FAIL. The `extraction pattern is out of sync` assertion fires (the pre-change file carries one fence), and the steps-gate assertion fires too.

- [ ] **Step 3: Edit `plugin/skills/review/merge-provenance-check.md`.** Keep line 1 and the `#45` anecdote sentence. Replace the rest of the file so it reads exactly:

````markdown
# Merge-Provenance Check — /claude-tweaks:review Step 2

Read from `code-mode-steps.md`'s Step 2 only when the detect command there reported at least one merge commit on a branch scope. With no merge commits the check is a no-op and this file is never read. A `base:{ref}` scope never reads this file: its range is the integration branch's own line, where a merge is how a PR shipped, and the rule below would exclude all of it.

Before analyzing the diff, check whether the integration branch was merged into this branch mid-history — content that arrived via such a merge should not be misattributed as work this branch introduced. This was caught concretely during the #45 native-review prototype: a CHANGELOG entry that actually rode into the branch via a merge from `main` was flagged as if it were part of this branch's own work, and was only correctly attributed by manually tracing merge-commit parentage.

Resolve `{integration-branch}` per `_shared/integration-branch.md`, then run this as its own call. What it prints is `{fork}`, pasted literally into the next block:

```bash
git merge-base {branch} origin/{integration-branch}
```

```bash
git log --no-merges {base}..{fork} --name-only --pretty=format:                 # integration-line files
git log --no-merges {branch} --not {base} {fork} --name-only --pretty=format:   # branch-side files
git diff {base}...{branch} --name-only                                          # full diff files
```

`{base}`/`{branch}` reuse whatever base-branch resolution the rest of this step already uses (the base branch, or the fallback ladder from Input resolution rule 7 — `_shared/scope-resolution.md`) — no new base-resolution logic needed.

- **Excluded files** are those in the full diff and the integration-line list and absent from the branch-side list. Report them separately ("arrived via merge from {integration-branch}, not this branch's own work"), stating the count of files/lines excluded and why, feeding Step 7's summary. Do not fold them silently into "what changed." With none, add no report section. When `git merge-base` prints nothing, there is no fork point and nothing is excluded.
- **Everything else stays in scope.** Absence from the branch's first-parent chain proves nothing: a commit on a merge's second parent that is not on the integration line (another branch this one merged) ships with this branch, and so does a file changed only by a merge commit's own edit.
- The **own-work scope** — the full diff minus the excluded files, not the raw `git diff` scope — is what feeds the change analysis below, and what Step 3's lens dispatch and Step 3.5's debate dispatch review.

"The change analysis below" is the diff-shape analysis in `code-mode-steps.md`'s Step 2, which resumes after this check; Step 5 (`/claude-tweaks:simplify`) takes the same own-work scope.
````

- [ ] **Step 4: Edit `plugin/skills/review/code-mode-steps.md`.** Insert this as the first bullet of the Merge-Provenance Check list, directly above `- **No merge commits detected**`, as one line:

```markdown
- **A `base:{ref}` scope** — skip the detect and count it as no merge commits detected, in every later step that asks: `{ref}` is a fixed point on the integration branch, so a merge in this range is how a PR shipped, never base content arriving. Every path in the diff stays in scope.
```

- [ ] **Step 5: Edit `docs/plugin-structure.md:109`.** Replace only the phrase `lazy-loaded only when the base branch was merged into this branch mid-history` with `lazy-loaded only when Step 2's detect finds merge commits on a branch scope, never on a `base:{ref}` scope`.

- [ ] **Step 6: Run the tests to verify they pass.**

Run: `node --test tests/review-merge-provenance-check.test.js tests/review-base-ref-scope.test.js tests/fast-lane-digest.test.js tests/review-skip-build-handled-work-conformance.test.js`
Expected: PASS, with zero failures.

- [ ] **Step 7: Prove the frozen first-parent controls and the live rule disagree, without touching the tree.**

Run: `git show HEAD:plugin/skills/review/merge-provenance-check.md`, then confirm the pre-change file holds `--first-parent` on its log line. That is the text `firstParentDropped` freezes. Quote the raw output line in your report.

- [ ] **Step 8: Commit.**

```bash
git add plugin/skills/review/merge-provenance-check.md plugin/skills/review/code-mode-steps.md docs/plugin-structure.md tests/review-merge-provenance-check.test.js
git commit -m "Stop the merge-provenance check dropping shipping work — refs #4639"
```

## Spec Coverage

| Clause | Covered by |
|---|---|
| AC1.1 (`base:{ref}` keeps every path; exclusion only for content that really arrived from the base) | Task 1's tests, fixtures A-F |
| Deliverable: fix at `merge-provenance-check.md:15` with a regression test | Task 1 Steps 1, 3 |

The AC's "outside run directories" sets a lower bound: nothing in `/review` excludes a run-directory path today, and this plan adds no such exclusion, so the record's figure of "32 non-run-dir paths" needs no new filter. Re-derived at this HEAD, the first-parent rule on `v6.156.3...3470ac15c` drops 80 of 294 paths, 77 of them outside run directories; the record's 32 understated it.

## Probe Evidence

Scratch probe over real git topologies, candidate commands run as written (the new rule, then the first-parent rule's drops):

| Fixture | Full diff | New rule excludes | First-parent rule drops |
|---|---|---|---|
| A tag base, `--no-ff` PR | `pr-file`, `squash-file` | both, if not gated | `pr-file` |
| B fixed base, catch-up | `feat-file`, `main-file`, `shared` | `main-file` | `main-file` |
| C fresh base, catch-up | `feat-file` | nothing | nothing |
| D other unlanded branch | `feat-file`, `other-file` | nothing | `other-file` |
| E merge-only edit | `evil-file`, `feat-file`, `main-file` | `main-file` | `evil-file`, `main-file` |
| F no common ancestor | n/a | `git merge-base` exits 1, stdout empty | n/a |
