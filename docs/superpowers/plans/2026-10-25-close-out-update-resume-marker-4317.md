# Close-out update: durable resume marker (#4317) — Implementation Plan

**Goal:** Make close-out's in-place PR update (`plugin/skills/dispatch/close-out-update.md`, shipped by #4273) safe across checkouts. Add a GitHub-side `close-out-update` run comment that marks an update pushed but not yet verified. Read the resume values from it, stop on any failed worktree add, checkout or fetch, check that the base fetch moved the ref, and stop explicitly when `gh` is absent. Pin each new clause with a go-red mutation.

**Architecture:** prose-only contract change across four skill files, plus one row and one sentence in `_shared/pr-run-comments.md` and one sentence in `docs/skill-graph.md`, all pinned by `tests/close-out-pr-state-contract-conformance.test.js`. No `plugin/bin/` code: the marker is read and written through the existing `_shared/pr-run-comments.md` Post-or-update procedure and `bin/find-run-comment.js`, whose `KIND_RE` (`/^[a-z][a-z-]*(:\d+)?$/`) already accepts `close-out-update`.

**Execution:** batched
**Batch:** send every task to one implementer as a single brief; review the combined diff once.

**Scope keywords:** close-out-update, close-out-{number}, update-clause

## Design (decided — implementer transcribes)

- **Marker = a run comment, not a label.** It has to carry `{update-method}`, `{conflicted-files}`, `{pre-update-head}` and `{resolution-commit}` so a resume from any checkout can report them (Deliverable 2), and a label cannot hold values. One comment per PR, edited in place by `_shared/pr-run-comments.md`'s Post-or-update procedure, kind `close-out-update`.
- **Written before every landing call:** step 2 before `gh pr update-branch` (`resolution-commit: pending`, rewritten to the post-update sha after the re-read), step 5 before the push. **Cleared** (`close-out-update: cleared ({reason})` on line 2) only after `close-out.md` step 5's `merged`, after a decline at the step 4 confirmation gate (reached only once this run has verified that head and read its CI), or after a landing call that landed nothing. A marker that is still `pending` routes `close-out.md` step 2 to the resume, from any checkout, whatever `mergeStateStatus` says.
- **`{wt}` is no longer the resume marker.** Step 7 keeps `{wt}` only after a failed step 4, or when it is mid-merge or holds tracked changes; the ancestor check covers unpushed commits. This replaces the ambiguous keep rule (NB1) and the post-push teardown that lost the update clause (finding 3c-A).
- **Base moved again (NB1's strand):** if a resume skipped the update while the PR is `DIRTY`/`CONFLICTING`/`BEHIND` again, every re-run would stop at step 6 on that same status. Such a resume (with `{wt}` holding nothing the PR lacks) goes back to the step 1 offer. Declining `BEHIND` verifies the current head and never goes straight to the merge gate.
- **Resume values (NB2):** they come from the pending marker. `resolution-commit: pending` is recovered from the PR history with `rev-list --merges --ancestry-path --reverse {pre-update-head}..origin/{head}`. When there is no marker, nothing was pushed, so the existing `origin/{head}..HEAD` recovery is still correct.
- **`{update-clause}` (NB4)** is keyed on a handed-off `{verified-sha}`, the same key `close-out.md` step 5 uses.
- **NB3 / AC3:** every `git worktree add`, `checkout` and `fetch` in steps 2-3 that exits non-zero stops the candidate (`command failed`). Step 3 compares `origin/{base}` with `ls-remote` (`base not fetched`).
- **gh-absent (Deliverable 4):** an explicit stop (`gh absent`) before step 1, citing `_shared/github-write-transport.md`'s "Pull requests are not covered by this mapping" (degrade-clause convention check) and `_shared/pr-run-comments.md`'s **MCP transport** (no comment edit).
- `baseRefOid` from `gh pr view` was probed and rejected for the base check: it read `3d473da6` while `git ls-remote origin refs/heads/main` read `629a5467`, because it is the PR's last-computed base, not the live tip. So `ls-remote` is the comparison.

## Spec coverage map

| AC | Clause | Covered by |
|---|---|---|
| AC1.1 | re-run from a different checkout never reaches the merge confirmation without a full-suite stamp on the current head | Task 1 pins `marker-kind`, `marker-before-landing`, `marker-read`, `marker-clear-only`, `resume-from-marker`, `base-moved-again`, `base-moved-skip-verifies`, `nothing-new-pending-verifies`, `teardown-marker-not-wt`; Task 2 routing + `close-out.md` step 7 + confirmation decline pins; Task 3 kind-registration pin; test `#4317 AC1.1 …` |
| AC2.1 | a resumed update reports the same values as the run that made it | Task 1 pins `resume-values-marker`, `resume-pending-resolution`, `marker-post-update-sha`, `marker-before-push`, `handoff-marker-values`; Task 2 `{update-clause}` handed-off pin; test `#4317 AC2.1 …` |
| AC3.1 | no path continues past a failed `git worktree add`, checkout or fetch | Task 1 pins `fail-stops-git`, `base-fetch-checked`; test `#4317 AC3.1 …` |
| AC4.1 | gh-absent completes via MCP or stops with a named reason before touching the PR | Task 1 pin `gh-only`; test `#4317 AC4.1 …` |
| AC5.1 | every new clause has a pin and a go-red mutation, and `npm test` passes | the existing one-to-one `every close-out-update.md pin has exactly one go-red mutation` test + new per-file go-red tests; test `#4317 AC5.1 …`; full suite at Common Step 5 |

---

### Task 1: Rewrite `close-out-update.md` and its pin tables

**Files:**
- Modify: `plugin/skills/dispatch/close-out-update.md`
- Modify: `tests/close-out-pr-state-contract-conformance.test.js`

- [ ] **Step 1: Update the test pin tables (red first).** In `tests/close-out-pr-state-contract-conformance.test.js`:

  In `UPDATE_PINS`, replace these entries:

  ~~~js
  ['offer-skipped-on-resume', 1, (s) => s.includes('Skipped on a resume (step 2) unless step 2 sends it here')],
  ['resume', 2, (s) => s.includes('is a prior run\'s update: add nothing yet, pin, then compare')
    && /`git -C \{wt\} merge-base --is-ancestor origin\/\{head\} HEAD` exits 0[^\n]*: resume at step 4/.test(s)],
  ['merge-base-in', 3, (s) => s.includes('`git -C {wt} fetch origin {base}`') && s.includes('Then `git -C {wt} merge --no-edit origin/{base}`')],
  ['teardown-on-stop', 7, (s) => /first on every stop after step 2, except a failed step 4 and a stop on a `\{wt\}` step 2 found mid-merge or holding tracked changes —\s+each keeps `\{wt\}`/.test(s)],
  ['handoff-resolution-merge', 8, (s) => s.includes('else short `{merge}` when step 2 found one, since a later fix commit is not the resolution')],
  ['handoff-resume-values', 8, (s) => s.includes('`merge` when step 2 found a `{merge}`, else `gh pr update-branch`')
    && s.includes('on a resume, as step 2 recovered them') && !s.includes('unrecorded')],
  ~~~

  Delete the `rejected-tears-down` pin. Then add these pins, each inserted at the position in its step's group shown by its step number (the table is ordered by step; keep that order: a new step-0 pin goes after `command-failed-stops`, a step-2 pin after `behind-post-update-checkout`, a step-3 pin after `nothing-new-stops`, a step-5 pin after `plain-push`, a step-7 pin after `teardown-on-stop`, a step-8 pin after `handoff-resume-values`):

  ~~~js
  // #4317 — step 0
  ['gh-only', 0, (s) => s.includes('When `command -v gh` exits non-zero, stop before step 1 offers anything')
    && s.includes('(`stopped: update failed — gh absent`) — the PR is never touched')
    && s.includes('`_shared/github-write-transport.md`\'s "Pull requests are not covered by this mapping"')],
  ['marker-kind', 0, (s) => s.includes('a `close-out-update` run comment (`_shared/pr-run-comments.md`\'s Comment kinds)')
    && s.includes('<!-- run-comment: close-out-update -->')],
  ['marker-before-landing', 0, (s) => s.includes('Write it pending before each call that lands an update — `gh pr update-branch` in step 2, the push in step 5 — never after.')],
  ['marker-read', 0, (s) => s.includes('a second line `close-out-update: pending` is a pending marker')
    && s.includes('still routes to the resume, with that value `unknown`')],
  ['marker-clear-only', 0, (s) => /only after `close-out\.md` step 5's `merged`, a decline at its step 4 gate,\s+or a landing call that landed nothing \(below\); every other stop leaves it pending/.test(s)],
  ['marker-failures-stop', 0, (s) => s.includes('(`stopped: update failed — marker unreadable`)')
    && s.includes('(`stopped: update failed — marker not written`), nothing pushed')
    && s.includes('never that procedure\'s issue fallback, since only the PR is ever read')],
  ['marker-failed-clear', 0, (s) => s.includes('A failed clear is reported and blocks nothing: a marker left pending costs one re-verify.')],
  ['marker-nothing-landed', 0, (s) => /When a landing call fails and step 2 found no pending marker, re-read `gh pr view \{number\} --json headRefOid`[\s\S]{0,160}\(`cleared \(nothing landed\)`\); any other head keeps it pending/.test(s)],
  // #4317 — step 2
  ['fail-stops-git', 2, (s) => s.includes('A `git worktree add`, `checkout` or `fetch` in steps 2-3 that exits non-zero stops the candidate (`stopped: update failed — command failed`) before anything else runs')],
  ['resume-from-marker', 2, (s) => s.includes('No `{wt}` (a pending marker left by another checkout, or a `{wt}` since removed): add it as Fresh below does, detached at `origin/{head}`, then step 4')],
  ['base-moved-again', 2, (s) => /goes to step 1's offer instead of step 4 when `close-out\.md` step 2's read is `DIRTY`, `mergeable: CONFLICTING` or `BEHIND`/.test(s)],
  ['base-moved-skip-verifies', 2, (s) => s.includes('`BEHIND`\'s `"Skip update"` goes to step 4 on the current head, never straight to `close-out.md` step 3')],
  ['resume-values-marker', 2, (s) => s.includes('A pending marker supplies `{update-method}`, `{conflicted-files}` and `{resolution-commit}`')],
  ['resume-pending-resolution', 2, (s) => s.includes('is the first line of `git -C {wt} rev-list --merges --ancestry-path --reverse {pre-update-head}..origin/{head}`, GitHub\'s update merge')],
  ['resume-no-marker-local', 2, (s) => s.includes('With no pending marker nothing was pushed, since the marker precedes every landing call, so recover')],
  ['marker-before-update-branch', 2, (s) => before(s, '`BEHIND` then writes the pending marker', '`gh pr update-branch {number}`')],
  ['marker-post-update-sha', 2, (s) => s.includes('Then rewrite the marker\'s `resolution-commit` to that sha.')],
  // #4317 — step 3
  ['base-fetch-checked', 3, (s) => /require `git -C \{wt\} rev-parse origin\/\{base\}` to equal the first field of `git -C \{wt\} ls-remote origin refs\/heads\/\{base\}`[\s\S]{0,260}\(`stopped: update failed — base not fetched`\), nothing merged/.test(s)
    && before(s, 'ls-remote origin refs/heads/{base}', 'Then `git -C {wt} merge --no-edit origin/{base}`')],
  ['nothing-new-pending-verifies', 3, (s) => s.includes('or at step 4 when step 2 found a pending marker, since the head it marks is still unverified')],
  // #4317 — step 5
  ['marker-before-push', 5, (s) => before(s, 'First write the pending marker', '`git -C {wt} push origin HEAD:{head}`')],
  ['marker-resume-fix-keeps', 5, (s) => s.includes('a resume that went straight to step 4 and found one pending keeps it as it is, since a fix commit is not the update')],
  // #4317 — step 7
  ['teardown-marker-not-wt', 7, (s) => s.includes('`{wt}` is never the resume marker: the pending marker on the PR is, so every other stop tears down')],
  // #4317 — step 8
  ['handoff-marker-values', 8, (s) => s.includes('on a resume, the pending marker\'s, else') && s.includes('on a resume, the short pending marker\'s')],
  ['handoff-pending-kept', 8, (s) => s.includes('The marker stays pending until `close-out.md` clears it after the merge or a decline.')],
  ~~~

  In `UPDATE_MUTATIONS`, replace the `offer-skipped-on-resume`, `merge-base-in`, `teardown-on-stop`, `handoff-resolution-merge` rows, delete the `rejected-tears-down` row, and add the new rows (any position — the pairing test sorts ids):

  ~~~js
  ['offer-skipped-on-resume', 'Skipped on a resume (step 2) unless step 2 sends it here. ', ''],
  ['merge-base-in', 'Then `git -C {wt} merge --no-edit origin/{base}`.', 'Then merge.'],
  ['teardown-on-stop', ' and a stop on a `{wt}` step 2 found mid-merge or holding tracked changes —\n   each keeps', ', which keeps'],
  ['handoff-resolution-merge', ', else short `{merge}` when step 2 found one, since a later fix commit is not the resolution', ''],
  ['gh-only', '(`stopped: update failed — gh absent`) — the PR is never touched', '(`stopped: update failed — gh absent`) after the update'],
  ['marker-kind', 'a `close-out-update` run comment (`_shared/pr-run-comments.md`\'s Comment kinds)', 'a local note'],
  ['marker-before-landing', 'Write it pending before each call that lands an update', 'Write it pending after each call that lands an update'],
  ['marker-read', 'still routes to the resume, with that value `unknown`', 'is ignored'],
  ['marker-clear-only', '; every other stop leaves it pending', ', or on any stop'],
  ['marker-failures-stop', ' — never that procedure\'s issue fallback, since only the PR is ever read', ', or post it to the issue instead'],
  ['marker-failed-clear', 'A failed clear is reported and blocks nothing: a marker left pending costs one re-verify.', 'A failed clear stops the candidate.'],
  ['marker-nothing-landed', '; any other head keeps it pending', ''],
  ['fail-stops-git', 'before anything else runs', 'unless the next step can continue'],
  ['resume-from-marker', 'No `{wt}` (a pending marker left by another checkout, or a `{wt}` since removed): add it as Fresh below does, detached at `origin/{head}`, then step 4', 'No `{wt}`: continue at step 3'],
  ['base-moved-again', 'goes to step 1\'s offer instead of step 4', 'goes to step 4'],
  ['base-moved-skip-verifies', 'goes to step 4 on the current head, never straight to `close-out.md` step 3', 'continues to `close-out.md` step 3'],
  ['resume-values-marker', 'A pending marker supplies `{update-method}`, `{conflicted-files}` and `{resolution-commit}`', '`{wt}` supplies the values'],
  ['resume-pending-resolution', 'is the first line of `git -C {wt} rev-list --merges --ancestry-path --reverse {pre-update-head}..origin/{head}`, GitHub\'s update merge', 'stays `pending`'],
  ['resume-no-marker-local', 'With no pending marker nothing was pushed, since the marker precedes every landing call, so recover', 'Otherwise recover'],
  ['marker-before-update-branch', '`BEHIND` then writes the pending marker (`update-method: gh pr update-branch`, `conflicted-files: none`, `resolution-commit: pending`)\n   and runs `gh pr update-branch {number}`', '`BEHIND` then runs `gh pr update-branch {number}`'],
  ['marker-post-update-sha', '\n   Then rewrite the marker\'s `resolution-commit` to that sha.', ''],
  ['base-fetch-checked', 'then require `git -C {wt} rev-parse origin/{base}` to equal the first field of `git -C {wt} ls-remote origin refs/heads/{base}`', 'then trust it'],
  ['nothing-new-pending-verifies', ' —\n   or at step 4 when step 2 found a pending marker, since the head it marks is still unverified', ''],
  ['marker-before-push', 'First write the pending marker', 'After the push, write the pending marker'],
  ['marker-resume-fix-keeps', 'a resume that went straight to step 4 and found one pending keeps it as it is, since a fix commit is not the update', 'a resume rewrites it'],
  ['teardown-marker-not-wt', '`{wt}` is never the resume marker: the pending marker on the PR is, so every other stop tears down', '`{wt}` is the resume marker, so a stop after an update keeps it'],
  ['handoff-marker-values', 'on a resume, the pending marker\'s, else `merge`', 'on a resume, `merge`'],
  ['handoff-pending-kept', ' The marker stays pending until `close-out.md` clears it after the merge or a decline.', ''],
  ~~~

  The `resume` mutation row stays as is (`'exits 0 (the PR head plus any unpushed resolution or fix): resume at step 4.'`).

  Add after the `Review Focus` test:

  ~~~js
  const PINS_4317 = {
    'AC1.1': ['marker-kind', 'marker-before-landing', 'marker-read', 'marker-clear-only', 'marker-failures-stop', 'marker-failed-clear', 'marker-nothing-landed', 'resume-from-marker', 'base-moved-again', 'base-moved-skip-verifies', 'nothing-new-pending-verifies', 'teardown-on-stop', 'teardown-marker-not-wt', 'handoff-pending-kept'],
    'AC2.1': ['resume-values-marker', 'resume-pending-resolution', 'resume-no-marker-local', 'marker-before-update-branch', 'marker-post-update-sha', 'marker-before-push', 'marker-resume-fix-keeps', 'handoff-marker-values', 'handoff-resolution-merge', 'handoff-resume-values'],
    'AC3.1': ['fail-stops-git', 'base-fetch-checked'],
    'AC4.1': ['gh-only'],
  };

  for (const [ac, ids] of Object.entries(PINS_4317)) {
    test(`#4317 ${ac}: close-out-update.md carries its pinned clauses`, () => {
      for (const id of ids) {
        const entry = UPDATE_PINS.find(([pin]) => pin === id);
        assert.ok(entry, `pin ${id} exists`);
        const [, n, check] = entry;
        assert.ok(check(stepSpan(UPDATE, n)), `pin ${id} (step ${n})`);
      }
    });
  }

  test('#4317 AC5.1: every #4317 pin has its own go-red mutation', () => {
    const mutated = new Set(UPDATE_MUTATIONS.map(([id]) => id));
    for (const id of Object.values(PINS_4317).flat()) assert.ok(mutated.has(id), `pin ${id} has a mutation`);
  });
  ~~~

- [ ] **Step 2: Run the suite and confirm red.**

  Run: `node --test tests/close-out-pr-state-contract-conformance.test.js`
  Expected: FAIL — the new pins (`gh-only`, `marker-kind`, …) do not match the current prose.

- [ ] **Step 3: Replace `plugin/skills/dispatch/close-out-update.md` with exactly this content** (line wraps are load-bearing: several mutations span a `\n   ` break):

~~~~markdown
# Dispatch — Close-out Update

Canonical procedure for `close-out.md`'s step 2 when a candidate PR is `DIRTY` (or `mergeable: CONFLICTING`) or `BEHIND`,
or a prior run's `{wt}` or pending update marker exists for it — read only then.
`_shared/github-pr-scan.md` item 11 flags a conflicting PR and never touches it because nobody is present to review a resolution;
close-out is human-present by construction (step 4's gate has no carve-out), so it can offer the update instead of only stopping.
The branch is already public behind its PR, so the update is a **merge** of `origin/{base}` — never a rebase, never a force-push
(`_shared/git-discipline.md`'s Rules and its "Catch-up (`auto`)" paragraph) — and the new HEAD is re-verified before anything is merged on it.

Values come from `gh pr view {number} --json headRefName,headRefOid,baseRefName` (`{head}`, `{base}`, the pre-update head).
`{main-checkout}` is the repository's main checkout root, where close-out runs; `{wt}` is the absolute `{main-checkout}/.worktrees/close-out-{number}` —
the git-fallback domain (`_shared/scratch-worktree.md` §2), never under `.claude/worktrees/`. Resolve both once and paste them as literals (§7), and double-quote every pasted path and ref (`{wt}`, `{main-checkout}`, `{head}`, `{base}`) in the commands below —
a checkout path may contain a space and a branch name may contain shell metacharacters.
One plain command per Bash call. Stops after step 2 tear down first (step 7). A command that fails outside the cases named below
stops the candidate (`stopped: update failed — command failed`) the same way.

**`gh` only.** `gh pr update-branch`, `gh run list` and `gh pr checks --watch` have no MCP mapping (`_shared/github-write-transport.md`'s "Pull requests are not covered by this mapping"),
and the update marker below is edited in place, which the MCP transport cannot do (`_shared/pr-run-comments.md`'s **MCP transport**).
When `command -v gh` exits non-zero, stop before step 1 offers anything (`stopped: update failed — gh absent`) — the PR is never touched.

**Update marker.** An update on GitHub is unverified until step 4's stamp and step 6's CI read pass on its head, and `{wt}` lives in one checkout,
so the pending state is kept on the PR: a `close-out-update` run comment (`_shared/pr-run-comments.md`'s Comment kinds), found, written and rewritten
by that file's Post-or-update procedure with `{kind}` = `close-out-update` and `{pr-number}` = `{number}`. Its body, marker first:

```text
<!-- run-comment: close-out-update -->
close-out-update: pending
update-method: {merge | gh pr update-branch}
conflicted-files: {comma-joined paths | none | unknown}
pre-update-head: {the values line's headRefOid}
resolution-commit: {full sha | pending}

Close-out pushed an update to this PR that has not yet passed a full-suite verify and CI on its head; a close-out run from any checkout re-verifies it before the merge question.
```

Write it pending before each call that lands an update — `gh pr update-branch` in step 2, the push in step 5 — never after.
**Read** it with that procedure's Find, then the found comment's `body` in the same payload: a second line `close-out-update: pending` is a pending marker;
any other second line, or no trusted comment, is none. A pending marker missing a field still routes to the resume, with that value `unknown`.
**Clear** it — the second line rewritten to `close-out-update: cleared ({reason})`, the rest kept — only after `close-out.md` step 5's `merged`, a decline at its step 4 gate,
or a landing call that landed nothing (below); every other stop leaves it pending, so the next run, from any checkout, re-verifies first.
A failed Find or read stops the candidate (`stopped: update failed — marker unreadable`), and a failed pending write stops it before the landing call
(`stopped: update failed — marker not written`), nothing pushed — never that procedure's issue fallback, since only the PR is ever read.
A failed clear is reported and blocks nothing: a marker left pending costs one re-verify.
When a landing call fails and step 2 found no pending marker, re-read `gh pr view {number} --json headRefOid`: the pre-update head still there means nothing landed,
so clear it (`cleared (nothing landed)`); any other head keeps it pending.

1. **Offer.** Skipped on a resume (step 2) unless step 2 sends it here. `AskUserQuestion`, `header`: `"Update PR"`, `multiSelect`: `false`.
   `DIRTY`: options `"Update from {base} (Recommended)"` / `"Stop"`. `BEHIND`: options `"Update from {base} (Recommended)"` / `"Skip update"`.
   The question states what an update does: merges `origin/{base}` in, runs the full suite, pushes, and re-reads CI before the merge question —
   and that the new head may dismiss existing approvals on a repo that dismisses stale reviews, so the merge may end `armed`, not `merged`.
   Each option's `description` states its consequence in one clause: the update option merges the base into the PR branch, re-verifies, and pushes;
   `"Stop"` and `"Skip update"` leave the PR untouched, `"Stop"` ending this candidate and `"Skip update"` continuing to the merge question.
   Declining touches nothing — the PR stays exactly as it was.
   `DIRTY` then stops the candidate (`stopped: mergeStateStatus DIRTY — update declined`);
   `BEHIND` was never a stop, so a declined update continues to `close-out.md` step 3 unchanged.
2. **Worktree.** To pin, `git fetch origin {head}` and require `git rev-parse origin/{head}` to equal the expected head — the values line's current `headRefOid`
   on a resume and before any update, the post-update sha after `BEHIND`'s update below; a ref missing or stale locally is fetched once more,
   and a mismatch after that stops (`stopped: update failed — head moved`).
   A `git worktree add`, `checkout` or `fetch` in steps 2-3 that exits non-zero stops the candidate (`stopped: update failed — command failed`) before anything else runs —
   never carry on elsewhere, since step 4 stamps whichever checkout it runs in.
   **Resume.** An existing `{wt}` or a pending marker (`close-out.md` step 2 routes both here) is a prior run's update: add nothing yet, pin, then compare.
   A `{wt}` mid-merge (`git -C {wt} rev-parse --verify --quiet MERGE_HEAD` exits 0) or holding tracked changes
   (`git -C {wt} status --porcelain --untracked-files=no` prints anything) is not resumable as it is: stop (`stopped: update failed — conflict not resolved`),
   keep `{wt}`, and tell the human to finish the merge in it or remove it.
   `git -C {wt} merge-base --is-ancestor origin/{head} HEAD` exits 0 (the PR head plus any unpushed resolution or fix): resume at step 4.
   Else `git -C {wt} merge-base --is-ancestor HEAD origin/{head}` exits 0 (the PR moved ahead, e.g. a late-landing update): `git -C {wt} checkout --detach origin/{head}`, then step 4.
   Neither (diverged): stop (`stopped: update failed — head moved`), keep `{wt}`, and tell the human to merge `origin/{head}` into it or remove it.
   No `{wt}` (a pending marker left by another checkout, or a `{wt}` since removed): add it as Fresh below does, detached at `origin/{head}`, then step 4 — that head is the unverified update.
   **Base moved again.** A resume whose `{wt}` holds nothing the PR lacks goes to step 1's offer instead of step 4 when `close-out.md` step 2's read is `DIRTY`, `mergeable: CONFLICTING` or `BEHIND`:
   a resume that skipped the update would re-verify, then stop on that same status at step 6, run after run. Accepting runs Fresh on the existing `{wt}`
   (`git -C {wt} checkout --detach origin/{head}` in place of the add), with Fresh's own values. `DIRTY` declined stops as step 1 says;
   `BEHIND`'s `"Skip update"` goes to step 4 on the current head, never straight to `close-out.md` step 3, since that head is unverified.
   **Resume values**, before step 4. A pending marker supplies `{update-method}`, `{conflicted-files}` and `{resolution-commit}`: a pushed update is no longer in `origin/{head}..HEAD`, so `{wt}` cannot recover them.
   Its `resolution-commit: pending` (a `BEHIND` run that stopped before its re-read) is the first line of `git -C {wt} rev-list --merges --ancestry-path --reverse {pre-update-head}..origin/{head}`, GitHub's update merge — none printed: `unknown`.
   With no pending marker nothing was pushed, since the marker precedes every landing call, so recover `{conflicted-files}`: `git -C {wt} log --merges -1 --format=%H origin/{head}..HEAD` names the resolution `{merge}` —
   `git -C {wt} merge-tree --write-tree --name-only --no-messages {merge}^1 {merge}^2` lists its conflicted paths after the tree line (exit 1: it conflicted; exit 0: `none`; any other exit — git older than 2.38, an unresolvable ref — `unknown`);
   no merge commit is a `BEHIND` update: `none`.
   **Fresh.** Otherwise pin, then `git worktree add --detach {wt} origin/{head}` before anything touches the PR — detached because the run's own worktree
   may still hold `{head}` checked out, and never the main checkout. `BEHIND` then writes the pending marker (`update-method: gh pr update-branch`, `conflicted-files: none`, `resolution-commit: pending`)
   and runs `gh pr update-branch {number}` (a merge — never the rebase variant); a failure stops the candidate (`stopped: update failed — update-branch rejected`).
   The call can return before GitHub's merge has landed, so re-read `gh pr view {number} --json headRefOid` — up to 3 reads, a few seconds apart, each its own plain command — for a sha that differs from the pre-update one
   (none appearing: `stopped: update failed — head moved`); pin again to that post-update sha, then `git -C {wt} checkout --detach origin/{head}`.
   Then rewrite the marker's `resolution-commit` to that sha.
3. **Merge (`DIRTY` only).** `git -C {wt} fetch origin {base}`, then require `git -C {wt} rev-parse origin/{base}` to equal the first field of `git -C {wt} ls-remote origin refs/heads/{base}` —
   a fetch can exit 0 and still leave the ref behind under a concurrent session; on a mismatch fetch and compare once more, and stop on one after that (`stopped: update failed — base not fetched`), nothing merged.
   Then `git -C {wt} merge --no-edit origin/{base}`.
   On a conflict, record `{conflicted-files}` with `git -C {wt} diff --name-only --diff-filter=U` and resolve per
   `_shared/git-discipline.md`'s Merge conflict resolution — both sides read, both intents kept. The human is present, so that section's
   ask-the-user fallback applies here (unlike the `auto` catch-up). Then `git -C {wt} add {paths}` and `git -C {wt} commit --no-edit`.
   An unresolvable conflict: `git -C {wt} merge --abort`, stop the candidate (`stopped: update failed — conflict not resolved`), nothing pushed.
   A merge that brings in nothing (HEAD still `origin/{head}`) means the forge's state was stale: re-run step 6's mergeability read —
   a stop-set status stops the candidate (`stopped: mergeStateStatus {status} after update`); otherwise hand off nothing and continue at `close-out.md` step 3 —
   or at step 4 when step 2 found a pending marker, since the head it marks is still unverified.
4. **Verify.** `verify.js` checks only the checkout it runs from (`test/verification.md`'s cwd note), so a standalone `cd {wt}` (never chained) comes first.
   When the project has a lockfile, run its install command there (the mapping is `_shared/worktree-adopt-freshness.md` step 4) — after the merge, which may change it.
   Then `node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js"` with the project's full command set per `/claude-tweaks:test`'s `verification.md`, then `node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --stamp-status`,
   then a standalone `cd {main-checkout}` whatever the result, before any later step.
   Continue only when `verifiedHead` is true, `scope` is `full`, and the stamp's `sha` equals `git -C {wt} rev-parse HEAD` — that sha is `{verified-sha}`.
   Otherwise stop (`stopped: update failed — verification`), push nothing, keep `{wt}`, and report it with the paste-ready re-run
   `/claude-tweaks:dispatch close-out #{record}` (`{record}` = a `Fixes` record of the PR), which resumes here (step 2). On `BEHIND` the update is
   already on GitHub, so that resume — never a later merge on CI alone — is what clears it.
5. **Push.** Only when `{wt}` holds commits the PR lacks (`git -C {wt} merge-base --is-ancestor HEAD origin/{head}` exits non-zero — a `DIRTY` resolution or a resumed fix).
   First write the pending marker (its `update-method`, `conflicted-files` and `resolution-commit` the values step 8 hands off, the commit in full);
   a resume that went straight to step 4 and found one pending keeps it as it is, since a fix commit is not the update. Then
   `git -C {wt} push origin HEAD:{head}` — plain. A rejection is reported and stops the candidate
   (`stopped: update failed — push rejected`); it is never retried as a force-push.
6. **Re-read CI on the new HEAD.** Confirm `gh pr view {number} --json headRefOid` equals `{verified-sha}` — one re-read if it lags; a sha that still differs stops the candidate
   (`stopped: update failed — head moved`), since one sha is never verified and another merged.
   A watch started straight after a push can find no checks and exit at once, so first repeat `_shared/pr-first-merge.md` Step 2.5's head-run read
   (`gh run list --commit {verified-sha}`) until it lists a run — up to 3 reads; still empty adds nothing (Step 2.5's empty-runs rule, e.g. no or path-filtered workflows),
   so continue to the watch and step 1's read, which decide.
   Then wait with `gh pr checks {number} --watch` as its own Bash call with an explicit long timeout (the tool's maximum) — the one place close-out waits,
   since the update itself created the pending state; a timeout is `stopped: CI pending after update`.
   Then re-run `close-out.md` step 1's read: only `passing` continues (otherwise `stopped: CI {status} after update`),
   and re-check `headRefOid` against `{verified-sha}` as above, since a push may have landed during the wait.
   Last, re-run step 2's mergeability read. The post-update stop set is `DIRTY`, `mergeable: CONFLICTING`, `BEHIND` (the base moved during the wait), a string result, or `null` —
   each stops the candidate (`stopped: mergeStateStatus {status} after update`). `UNKNOWN` is GitHub's lazily computed mergeability:
   re-read it — up to 3 reads, a few seconds apart, each its own plain command — and stop only if still `UNKNOWN` (`stopped: mergeStateStatus UNKNOWN after update`).
   Any other status continues. There is no second offer in the same run; the human re-runs close-out.
7. **Tear down.** Runs after step 6, after step 3's brings-in-nothing read, and first on every stop after step 2, except a failed step 4 and a stop on a `{wt}` step 2 found mid-merge or holding tracked changes —
   each keeps `{wt}` for the fix or the merge the human finishes in it. `{wt}` is never the resume marker: the pending marker on the PR is, so every other stop tears down,
   an update already on GitHub included, and the next run's step 2 adds `{wt}` again.
   From `{main-checkout}` (a standalone `cd {main-checkout}` first if the shell is elsewhere), `git fetch origin {head}`, then `git -C {wt} merge-base --is-ancestor HEAD origin/{head}`;
   on exit 0, `git worktree remove {wt}` (`ExitWorktree` does not operate on `.worktrees/`, `_shared/scratch-worktree.md` §6).
   Non-zero: list `git -C {wt} log origin/{head}..HEAD --oneline` and remove nothing — the next run's step 2 resumes `{wt}`, or stops on it once the PR head has diverged.
8. **Hand off.** Pass the confirmation gate (`close-out-confirmation.md`) `{update-method}` (`merge` on `DIRTY`, `gh pr update-branch` on `BEHIND`; on a resume, the pending marker's, else `merge` when step 2 found a `{merge}`, else `gh pr update-branch`),
   `{conflicted-files}` (comma-joined paths or `none`; on a resume, as step 2 recovered them), `{resolution-commit}` (short `{verified-sha}`, the PR's new HEAD —
   the conflict-resolution merge on `DIRTY`, GitHub's update merge on `BEHIND`; on a resume, the short pending marker's, else short `{merge}` when step 2 found one, since a later fix commit is not the resolution), `{verified-sha}` itself (`close-out.md` step 5 merges only that head),
   and step 6's latest CI and mergeability reads. The marker stays pending until `close-out.md` clears it after the merge or a decline. Continue at `close-out.md` step 3.
~~~~

- [ ] **Step 4: Run the suite.** `node --test tests/close-out-pr-state-contract-conformance.test.js` — Expected: the `close-out-update.md` pins and their go-red controls PASS. The `close-out.md` Reporting test still FAILS (four new reasons are not listed yet); Task 2 fixes that.

### Task 2: `close-out.md` and `close-out-confirmation.md`

**Files:**
- Modify: `plugin/skills/dispatch/close-out.md`
- Modify: `plugin/skills/dispatch/close-out-confirmation.md`
- Modify: `tests/close-out-pr-state-contract-conformance.test.js`

- [ ] **Step 1: Tests first.** In `assertUpdateRouting`, right after the existing `wtSpan` assertion (`'an existing update worktree routes to the resume'`), add:

  ~~~js
  assert.match(wtSpan, /or a pending update marker \(`close-out-update\.md`'s \*\*Update marker\*\*/, '#4317 AC1.1: a pending update marker routes to the resume too');
  assert.match(wtSpan, /from whichever checkout this run is in/, '#4317 AC1.1: the marker routes a run from any checkout');
  ~~~

  Append to `STEP_2_MUTATIONS`:

  ~~~js
  ['pending marker resumes', ' or a pending update marker (`close-out-update.md`\'s **Update marker**, read here — a failed read stops this candidate, `stopped: update failed — marker unreadable`)', '', /pending update marker routes/],
  ['any checkout', ', from whichever checkout this run is in', '', /routes a run from any checkout/],
  ~~~

  In `assertUpdateClause`, after the `Updated from {base} by close-out via` assertion, add:

  ~~~js
  // #4317 NB4: keyed on a handed-off sha, like close-out.md step 5 — a merge that brought in nothing ran but hands off none.
  assert.match(def, /when `close-out-update\.md` handed off a `\{verified-sha\}` for this candidate/, 'clause keyed on a handed-off sha');
  assert.doesNotMatch(def, /ran for this candidate/, 'clause never keyed on the update having run');
  ~~~

  Add after the `{update-clause}` go-red loop:

  ~~~js
  test('#4317 AC2.1 go-red control: an update clause keyed on the update having run fails', () => {
    const from = 'when `close-out-update.md` handed off a `{verified-sha}` for this candidate';
    assertOccursOnce(CONFIRM, from, 'the trigger clause occurs exactly once');
    assert.throws(() => assertUpdateClause(CONFIRM.replace(from, 'when `close-out-update.md` ran for this candidate')), /handed-off sha/);
  });

  // #4317 AC1.1: the marker is cleared only after the verified merge or a decline at the gate.
  function assertDeclineClearsMarker(confirm) {
    const start = confirm.indexOf('Declining (Option 2) stops here');
    assert.ok(start >= 0, 'decline paragraph found');
    const para = confirm.slice(start, confirm.indexOf('\n\n', start) < 0 ? undefined : confirm.indexOf('\n\n', start));
    assert.match(para, /When `close-out-update\.md` handed off a `\{verified-sha\}`, first clear its marker\s+\(`cleared \(declined at confirmation gate\)`/, 'a decline clears the update marker');
  }

  function assertMergedClearsMarker(closeOut) {
    const start = closeOut.indexOf('7. **On `merged`');
    assert.ok(start >= 0, 'close-out step 7 found');
    const step7 = closeOut.slice(start, closeOut.indexOf('\n## ', start));
    assert.match(step7, /When `close-out-update\.md` handed off a `\{verified-sha\}`, clear its marker on `merged` \(`cleared \(merged\)`/, 'merged clears the update marker');
    assert.match(step7, /on `armed` it stays pending/, 'armed leaves the marker pending');
  }

  test('#4317 AC1.1: the update marker is cleared on merged and on a gate decline, and only there', () => {
    assertDeclineClearsMarker(CONFIRM);
    assertMergedClearsMarker(CLOSE_OUT);
  });

  test('#4317 AC1.1 go-red control: a decline that keeps the marker fails', () => {
    const from = 'first clear its marker';
    assertOccursOnce(CONFIRM, from, 'the clear occurs exactly once');
    assert.throws(() => assertDeclineClearsMarker(CONFIRM.replace(from, 'keep its marker')), /decline clears/);
  });

  test('#4317 AC1.1 go-red control: a merged outcome that keeps the marker fails', () => {
    const from = 'clear its marker on `merged`';
    assertOccursOnce(CLOSE_OUT, from, 'the clear occurs exactly once');
    assert.throws(() => assertMergedClearsMarker(CLOSE_OUT.replace(from, 'leave its marker on `merged`')), /merged clears/);
  });

  test('#4317 AC1.1 go-red control: an armed outcome that clears the marker fails', () => {
    const from = 'on `armed` it stays pending';
    assertOccursOnce(CLOSE_OUT, from, 'the armed clause occurs exactly once');
    assert.throws(() => assertMergedClearsMarker(CLOSE_OUT.replace(from, 'on `armed` it is cleared')), /armed leaves/);
  });
  ~~~

  Note: `CONFIRM` is declared after the routing tests in the file; place these new tests after the `const CONFIRM = …` line.

- [ ] **Step 2: Run, confirm red.** `node --test tests/close-out-pr-state-contract-conformance.test.js` — Expected: FAIL on the new `close-out.md`/`close-out-confirmation.md` assertions and on the Reporting list.

- [ ] **Step 3: Edit `plugin/skills/dispatch/close-out.md`.**

  Step 2, replace:
  ~~~
     An existing `.worktrees/close-out-{number}` for this candidate is a prior run's failed update: it
     routes to `close-out-update.md`'s resume (its step 2) regardless of `mergeStateStatus`.
  ~~~
  with:
  ~~~
     An existing `.worktrees/close-out-{number}` or a pending update marker (`close-out-update.md`'s **Update marker**, read here — a failed read stops this candidate, `stopped: update failed — marker unreadable`)
     for this candidate is a prior run's update: it
     routes to `close-out-update.md`'s resume (its step 2) regardless of `mergeStateStatus`, from whichever checkout this run is in.
  ~~~

  Step 7, replace:
  ~~~
     removes it. On `armed`, none of Sections B/C/E run yet — same as every other
     `armed` outcome in this skill, they wait for `merged` evidence.
  ~~~
  with:
  ~~~
     removes it. On `armed`, none of Sections B/C/E run yet — same as every other
     `armed` outcome in this skill, they wait for `merged` evidence.
     When `close-out-update.md` handed off a `{verified-sha}`, clear its marker on `merged` (`cleared (merged)`, that file's **Update marker**);
     on `armed` it stays pending, so a re-run before the merge lands re-verifies first.
  ~~~
  (Keep `First run\n   ` … `Then reuse` intact — `tests/closing-links-prose-conformance.test.js` slices that block.)

  Reporting, replace:
  ~~~
  `stopped: update failed — {conflict not resolved | verification | push rejected | update-branch rejected | head moved | command failed}`,
  ~~~
  with:
  ~~~
  `stopped: update failed — {conflict not resolved | verification | push rejected | update-branch rejected | head moved | base not fetched | marker unreadable | marker not written | gh absent | command failed}`,
  ~~~

- [ ] **Step 4: Edit `plugin/skills/dispatch/close-out-confirmation.md`.**

  Replace:
  ~~~
  `{update-clause}`: when `close-out-update.md` ran for this candidate, `" Updated from {base} by close-out via
  {update-method}: conflicted files {conflicted-files}, resolution commit {resolution-commit} — review it before
  merging; any approval above predates it."`; empty (omitted) when no update ran, so the question reads as before.
  ~~~
  with:
  ~~~
  `{update-clause}`: when `close-out-update.md` handed off a `{verified-sha}` for this candidate, `" Updated from {base} by close-out via
  {update-method}: conflicted files {conflicted-files}, resolution commit {resolution-commit} — review it before
  merging; any approval above predates it."`; empty (omitted) when none was handed off — a merge that brought in nothing hands off none — so the question reads as before.
  ~~~

  Replace:
  ~~~
  Declining (Option 2) stops here — the PR stays `pending-review` as it was (an update that already ran stays pushed), and
  `close-out.md`'s steps 5-7 never run for this candidate. On the bare form, move to the next
  candidate; on the `#N` form, this is the whole invocation's result.
  ~~~
  with:
  ~~~
  Declining (Option 2) stops here — the PR stays `pending-review` as it was (an update that already ran stays pushed), and
  `close-out.md`'s steps 5-7 never run for this candidate. When `close-out-update.md` handed off a `{verified-sha}`, first clear its marker
  (`cleared (declined at confirmation gate)`, that file's **Update marker**) — this run verified that head and read its CI, so a re-run has nothing left to re-verify.
  On the bare form, move to the next candidate; on the `#N` form, this is the whole invocation's result.
  ~~~

- [ ] **Step 5: Run.** `node --test tests/close-out-pr-state-contract-conformance.test.js` — Expected: PASS except the Task 3 test, which is not written yet.

### Task 3: Register the `close-out-update` kind

**Files:**
- Modify: `plugin/skills/_shared/pr-run-comments.md`
- Modify: `docs/skill-graph.md`
- Modify: `tests/close-out-pr-state-contract-conformance.test.js`

- [ ] **Step 1: Test first.** Append to the test file:

  ~~~js
  const COMMENTS = readSkillFile('_shared', 'pr-run-comments.md');

  // #4317 AC1.1: the marker is a registered run-comment kind, with its gate exception stated where the gate is.
  function assertCloseOutKindRegistered(comments) {
    assert.match(comments, /^\| `close-out-update` \|[^\n]*`<!-- run-comment: close-out-update -->`[^\n]*\|$/m, 'Comment kinds lists close-out-update with its marker');
    assert.match(comments, /^\| `\/claude-tweaks:dispatch close-out` \(`close-out-update\.md`'s Update marker\) \| `close-out-update` \|[^\n]*\|$/m, 'Consumer table lists close-out-update');
    const gate = comments.slice(comments.indexOf('## The gate'), comments.indexOf('## Comment kinds'));
    assert.match(gate, /\*\*`close-out-update` is the one exception:\*\*/, 'the gate section names the close-out-update exception');
  }

  test('#4317 AC1.1: pr-run-comments.md registers the close-out-update kind and its gate exception', () => {
    assertCloseOutKindRegistered(COMMENTS);
  });

  test('#4317 AC1.1 go-red control: dropping the close-out-update kind row fails', () => {
    const row = COMMENTS.split('\n').find((l) => l.startsWith('| `close-out-update` |'));
    assert.ok(row, 'the kind row exists to drop');
    assert.throws(() => assertCloseOutKindRegistered(COMMENTS.replace(`${row}\n`, '')), /Comment kinds lists close-out-update/);
  });

  test('#4317 AC1.1 go-red control: dropping the gate exception fails', () => {
    const from = '**`close-out-update` is the one exception:**';
    assertOccursOnce(COMMENTS, from, 'the exception occurs exactly once');
    assert.throws(() => assertCloseOutKindRegistered(COMMENTS.replace(from, '')), /gate section names/);
  });
  ~~~

- [ ] **Step 2: Run, confirm red.** `node --test tests/close-out-pr-state-contract-conformance.test.js` — Expected: FAIL on the three new tests.

- [ ] **Step 3: Edit `plugin/skills/_shared/pr-run-comments.md`.**

  At the end of `## The gate — one condition, everywhere` (after the "Present, but the `gh` call itself fails" bullet, before `## Comment kinds`), add a paragraph:
  ~~~
  **`close-out-update` is the one exception:** `/claude-tweaks:dispatch close-out` posts it on a PR it already holds by number, outside any run,
  so it skips this gate, and a failed find or write stops the update instead of falling back to the issue (`dispatch/close-out-update.md`'s Update marker).
  ~~~

  In the Comment kinds table, after the `release-status` row, add:
  ~~~
  | `close-out-update` | `/claude-tweaks:dispatch close-out`, before the call that lands an update (`dispatch/close-out-update.md`'s Update marker) | `<!-- run-comment: close-out-update -->` — one per PR, rewritten `cleared (…)` after the verified merge or a decline |
  ~~~

  In the Consumer table, after the `_shared/pr-first-merge-post-merge.md` row, add:
  ~~~
  | `/claude-tweaks:dispatch close-out` (`close-out-update.md`'s Update marker) | `close-out-update` | A resume marker, not a report: written pending before an update lands, read by `close-out.md` step 2 so a re-run from any checkout re-verifies, cleared only after the verified merge or a decline. No `run-state.json` gate and no issue fallback — the gate exception above |
  ~~~

- [ ] **Step 4: Edit `docs/skill-graph.md`.** In the `| \`_shared/pr-run-comments.md\` |` row under `/dispatch` (line ~240, starting "`settle-and-merge.md` Step 6 step 5 posts the failure tombstone"), insert before the row's closing ` |`: ` \`close-out-update.md\` writes, reads and clears the \`close-out-update\` resume marker on a close-out candidate's PR — the kind's one consumer outside a run (#4317).`

- [ ] **Step 5: Run.** `node --test tests/close-out-pr-state-contract-conformance.test.js tests/closing-links-prose-conformance.test.js tests/pr-first-merge.test.js` — Expected: PASS.

- [ ] **Step 6: Commit** (stage the five files by explicit path) — message `Persist close-out's update state on the PR — resume marker, resume values, fetch and gh-absent stops (refs #4317)`.

## Deviations from the spec (Common Step 4.5)

Classified Beneficial and kept as built:

1. **Marker clears on a landing that landed nothing** (`cleared (nothing landed)`), and a failed landing on an already-pending marker restores its pre-write body. Deliverable 1 names only "the verified merge or an explicit human decline". Its intent is that an unverified update on GitHub is never forgotten, and a landing that landed nothing put no update there. (0589c36f2, 7c9566ab2)
2. **The marker accumulates across updates.** `update-method`/`resolution-commit` become oldest-first lists and `conflicted-files` is a union. The spec names single values. Without this, a second update overwrites an earlier unreviewed resolution, and the gate's update clause stops naming it (AC2). (0589c36f2)
3. **A `BEHIND` resume offers Update/Stop only.** The spec is silent. Skipping on a resume would bring an unverified head to the merge question, or stop at step 6, every time (AC1). (7c9566ab2)
4. **The gh-absent path is the explicit stop, not an MCP branch.** Deliverable 4 allows either. `gh pr update-branch`, `gh run list` and `gh pr checks --watch` have no MCP mapping, and neither does comment editing.
