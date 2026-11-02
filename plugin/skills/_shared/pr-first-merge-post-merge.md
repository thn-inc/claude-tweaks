# PR-First Merge — post-merge steps (outcome `merged` only)

Read this file only once `pr-first-merge.md`'s Step 3 has confirmed outcome `merged` (a `pending-review`
or `armed` outcome never reaches this file — the reconciler completes those later, convergently,
per Step 3's own account). This holds Step 4 (post-merge reconcile) and Step 5 (delete the remote
branch) — the two steps that exist only on the confirmed-merged path, never read on the far more
common `armed`/`pending-review` outcomes a merge attempt actually produces on this repo (Task 0's
own capture: an unprotected repo's `--auto` call usually merges immediately or arms, but every
parked/red/conflict/permission branch in Step 3 never reaches here at all).

## Step 4: Post-merge reconcile

### Step 4.0: Reopen what the merge closed by mistake (#4199)

Before Step 4.1, while `$PIPELINE_RUN_DIR` still exists (Step 4.2's reconcile may archive it):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/closing-links.js" --run "$PIPELINE_RUN_DIR" --mode post-merge
```

It reopens every record the PR's fixes block names on a `Refs` line, and every stray linked
record, that the merge closed after `mergedAt`. That covers a closing link that survived the
pre-merge check, and a squash message composed without `--keep-open` (Step 3). It polls a
will-close record up to 15 s, since GitHub closes it about 2 s after the merge, and logs `reopened
#{n}` per record to `decisions.md`. On a base other than the repo's default branch GitHub acts on
none of the PR's closing keywords, so the CLI also closes each still-open `Fixes` record itself
(`closed[]`, logged `closed #{n}`) and skips the polling. Whatever the `action`, report each
`failed[]` record (reopen it by hand), each `closeFailed[]` record (close it by hand) and each
`pendingClose[]` record (the merge may still close it — re-run the step once, then reopen it by
hand if it closed) in the closing summary, never as anything but `merged`. A `baseUnchecked: true`
envelope means the PR's base or the default branch could not be read, so nothing was closed and the
`Fixes` records were not checked: name the envelope's `unchecked[]` records in the closing summary. Exit
5 or `gh-absent`: the CLI logged its own `SKIP` line; exit 3: the run dir is untrusted and `log-decision.js` refuses it too, so name the gap in the closing summary. Then continue to Step 4.0b. An `armed` outcome never reaches
this step in-session: the reconciler's `post-merge` check (`gh` only) runs the CLI for that run once GitHub has merged the PR for 10 minutes (the merge grace),
with no settle poll and reopens bounded to 10 minutes after `mergedAt`; with `--keep-open` on the composer, only a
Development-sidebar link can still close a kept-open record there, a gap tracked in the run's ledger.
On a non-default base that late run closes an `armed` merge's still-open `Fixes` records the same
way, so they no longer wait for a human (#4599).

### Step 4.0b: Close below-floor parents (#4466)

Applies only under `work-backend: github-issues`. Under `local-files` the pre-merge entries
already closed the parent in-branch, so this step is a no-op there. It runs once the merge has
landed: after outcome `merged`, or after a no-PR local merge's successful push at the call sites
that cite it. A merge that never lands never reaches it, so its parent stays open. A merge no
session sees land (an `armed` PR that GitHub merges later) never reaches it either: the reconciler's
`post-merge` check runs Steps 4.0 and 4.0b for that run once, keyed on its recorded PR
(`docs/reconcile-checks.md`'s Post-merge closes), and `/claude-tweaks:tidy`'s `parent-gate` backstop
stays the last resort.

After a no-PR local merge it is a no-op unless the branch the merge landed on — the integration
branch (`_shared/integration-branch.md`) — is the repo's default branch
(`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`). With `gh` absent, that read is
`git remote show origin`'s `HEAD branch:` line (`_shared/github-write-transport.md`'s
default-branch row). GitHub closes `Fixes #N` records and a PR's other closing links only on the
default branch, so a local merge into any other branch leaves its sub-issues open: counting them
`CLOSED` would close the parent early. Left open, they keep both this close and the backstop from
firing early. After a PR merge there is no such gate: on a non-default base Step 4.0 closes the
`Fixes` records itself, and `closingSet[]` lists only the ones it confirmed `CLOSED`.

This step is the Parent-Gate Procedure's post-merge sub-issue-side entry
(`wrap-up/verification-brief-parent-gate.md`'s **Two entry shapes**). Set its two inputs:

- `$MERGING_PR` — the merged PR's number (`{pr-number}`) after a PR merge; empty after a no-PR
  local merge.
- `$CLOSING_SUB_ISSUES` — the merge's closing records, minus every record Step 4.0 handled: each
  number in its output's `reopened[]` and `pendingClose[]`, and each `failed[]` entry's `issue`.
  Step 4.0 handles a record because the merge should not have closed it, so it counts by its live
  state, never as `CLOSED` by this set. A `failed[]` or `pendingClose[]` record's live state may
  still read `CLOSED` — a failed reopen, an unknown state after a failed read, or a close that
  lands after Step 4.0's poll — so skip any parent whose enumerated sub-issues include one, and
  name that parent in the closing summary: it waits on the hand reopen. A `closeFailed[]` record
  holds its parent the same way — its live state is `OPEN`, or unknown after a failed read — so
  skip any parent whose enumerated sub-issues include one and name that parent in the closing
  summary: it waits on the hand close. After a PR merge, the set is Step 4.0's `closingSet[]`, which
  only an exit-0 `post-merge` action other than `base-unchecked` carries (`reopen-failed`,
  `close-failed`, `close-pending`, `reopened`, `closed` or `nothing-closed`): the PR's same-repo
  closing records (`sameRepoNumbers`, `bin/lib/flow/closing-links.js`, which drops a
  `Fixes other/repo#N` that would otherwise read as this repo's #N) minus those three lists, already
  subtracted; on a non-default base it is instead the `Fixes` records Step 4.0 confirmed `CLOSED`
  (closed by it, or already closed), never a `closeFailed[]` one. After a PR merge, when
  `closingSet[]` is absent — a non-zero exit, `not-merged`, `no-fixes-span`, `no-pr`, `gh-absent`,
  `base-unchecked`, a `reopen-failed` result that also carries `baseUnchecked: true`, or no parseable output — skip this step entirely, never subtracting nothing,
  and log it (after exit 3, name it in the closing summary instead); tidy's `parent-gate` backstop
  recovers those parents:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP --step "pr-first-merge Step 4.0b (skipped)" --reversibility n/a --text "condition: Step 4.0 returned {result}, no closingSet → fallback: no parent closed; the tidy parent-gate backstop recovers them"
  ```

  Otherwise, use `closingSet[]` as printed; never re-read the PR's links here.

  After a no-PR local merge, read the bare same-repo `Fixes #{n}` lines of the pushed merge commit's message —
  a `Fixes {owner}/{repo}#{n}` line names another repository's record and is not in the set
  (`bin/lib/compose-subject.js` writes only the bare form) —
  taking the union across every merge commit when a call site pushes several:

  ```bash
  git log -1 --format=%B {merge-sha}
  ```

  Never read the set from a run-dir fact pack: a multi-spec merge runs against the parent run dir,
  which holds no per-spec pack.

For each record in `$CLOSING_SUB_ISSUES`, run that procedure from **Resolve the parent** through
**Evaluate the gate**, which its **Run the gate CLI** section makes one call. `{closing-sub-issues}`
is `$CLOSING_SUB_ISSUES` comma-joined, and `{held}` lists every number in Step 4.0's `reopened[]`
and `pendingClose[]` and each `failed[]` and `closeFailed[]` entry's `issue`, comma-joined. Omit
`--merging-pr {pr-number}` after a no-PR local merge, and `--held {held}` when `{held}` is empty:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/parent-gate.js" --sub-issue {n} --closing {closing-sub-issues} --idempotence --merging-pr {pr-number} --held {held}
```

Route a `no-parent` verdict first: a record with no resolvable parent follows **Resolve the
parent**'s no-parent branch. Route every other verdict in the reconciler's order. A parent whose
labels lack `parent-issue` — the label tidy's `parent-gate` backstop selects on — is a no-op
too, named in the closing summary. The verdict reports it as `parentIssue: false`. Skip a parent whose verdict
lists `needs` (its `needs:*` labels) and name it in the closing summary, per
`_shared/work-record.md`'s Worklist rule. A non-empty `held` skips the parent, named in the
closing summary: a `reopened[]` sub-issue is open again, so the parent is not due, and a
`failed[]`, `pendingClose[]` or `closeFailed[]` one waits on the hand reopen or close the inputs
paragraph above names. On `due` with `exceeds: false`, run
**Close the parent below the floor**. With `gh` absent, every call the procedure makes runs
through `_shared/github-write-transport.md`'s MCP rows (the procedure's **Transport (#4602).**
paragraph), so a gh-absent run with the GitHub MCP server closes the parent the same way after a
no-PR local merge; after a PR merge, Step 4.0's `gh-absent` result skips this step, as above.
Every other outcome is a no-op; this step writes nothing for it. Evaluate each parent once:
skip a record whose parent this step already handled, so a parent with several sub-issues in the
set is closed once. The verdict's
`parent` names it. The procedure's **Return to the Try it post** and **Fail open on every `gh`
call** paragraphs state what this entry does not do (no Try it block, no fallback to the no-parent
path) and how it skips on a failing `gh` call — never a stop, and never a reason to report
anything other than `merged`. Any other non-zero CLI exit (after **Run the gate CLI**'s exit-2
`gh`-absent retry) is a failing `gh` call.

Log each parent closed:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO --step "pr-first-merge Step 4.0b" --reversibility "high (gh issue reopen)" --text "closed parent #{parent} below the oversight floor (risk:{maxTier}, risk-floor {riskFloor})"
```

Then write one summary line when this step evaluated the closing set: after a PR merge that had a `closingSet[]`,
or after a no-PR local merge (its non-default-branch no-op included), where `the pushed merge commit` replaces `PR #{pr-number}` in the text:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO --step "pr-first-merge Step 4.0b" --reversibility n/a --text "evaluated PR #{pr-number}'s closing records: {k} parent(s) closed"
```

The reconciler's `post-merge` check reads this line as the marker that the step already ran, so it
does not run Steps 4.0 and 4.0b a second time for this run. On the no-`closingSet[]` path above, the
`(skipped)` SKIP line is the marker and no summary line follows, so a run carries one marker and
"0 parent(s) closed" never follows a skipped step. Under `local-files`, or after exit 3, there is no line.

### Step 4.1: Which release carried this? (before reconcile)

A merge can land minutes before a sibling session's version bump and be swept into it with no
CHANGELOG line of its own — three records shipped that way under v6.87.1 (#603, the incident
behind #678). Reconcile says nothing about *where* the merge landed relative to the version
history, so ask, once, before it runs.

Resolved purely from **tag ancestry** (#2257 replaced `bin/release.js status`'s bump-commit-walk
with this) — no plugin-manifest or CHANGELOG dependency, so this step has no applicability
precondition: it runs for every merge, on any project, whether or not a plugin manifest exists.

```bash
git fetch origin {integration-branch}
git describe --tags --contains --first-parent --match 'v*' {merge-sha}
```

`{merge-sha}` is the merge commit `gh pr view --json mergeCommit` reported for the confirmed
merge (the same invocation applies under `local-merge` with the local merge commit). Read it
**after** the merge is confirmed and after the fetch above — a sibling session's tag can land
while this PR is being merged.

- **Exit 0** — a tag is reachable forward from `{merge-sha}` along first-parent ancestry. Strip a
  trailing `~N`/`^N` ancestry suffix if present (`v1.2.3~4` → `v1.2.3` — empirically, `git
  describe` emits this suffix for every ancestor of the tagged commit, not only the exact tagged
  commit itself; only a merge that IS the tagged commit comes back bare) to get `{tag}`. Log `AUTO
  {time} — pr-first-merge Step 4.1: release status — already carried by {tag}. Reversibility:
  n/a.` and carry `already carried by {tag}` into the closing report
  (`flow/summary-template.md`'s `**Release status:**` line).
- **Non-zero exit, stderr `fatal: cannot describe '...'`** — no tag is reachable forward from this
  commit yet (unreleased on the integration branch). Log `AUTO {time} — pr-first-merge Step 4.1:
  release status — not yet in a release — bump pending. Reversibility: n/a.` and carry `not yet in
  a release — bump pending` into the closing report. Never treated as an error.
- **Any other non-zero exit** (a different stderr, or the `git fetch` above failed) — a genuine
  failure, not "no containing tag": log `AUTO {time} — pr-first-merge Step 4.1: release status
  unavailable ({reason}). Reversibility: n/a.` and carry `release status unavailable — {reason}`
  into the closing report; it is never a reason to report anything other than `merged`.

Under pr-first, post-or-update the `release-status` PR comment per `_shared/pr-run-comments.md`'s
post-or-update procedure (kind `release-status`, marker `<!-- run-comment: release-status -->` as
the first line, body = the human line above, verbatim — `already carried by {tag}` or `not yet in
a release — bump pending`). Under `local-merge` (no PR), the closing report line is the only
surface. This step never writes `CHANGELOG.md` or any staged file — there is no backfill case
left to stage; `git describe` answers the whole question from ancestry alone, so there is nothing
for a human to apply after the merge.

### Step 4.2: Reconcile

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" reconcile --checks mirror,release,archive
```

Run with an explicit, generous timeout (150000ms+) so it stays foreground rather than
auto-backgrounding on the harness's default command timeout (#1543 — a full unscoped sweep here
was observed taking ~2 minutes, at or past that default, twice tripping it in one dispatch
firing and once stranding a firing whose one-shot turn ended waiting on the backgrounded call).

`--checks mirror,release,archive` scopes the sweep to what this step needs, plus `post-merge`, which `archive` requires and the check expansion adds. When Step 4.0b wrote its marker, `post-merge` skips this run; with no marker (exit 3) the run sits inside the 10-minute merge grace, so `post-merge` defers it and `archive` leaves it in place as `post-merge-pending`. The full
unscoped default also runs `red-tip`/`reap`/`console` inline (and hands `archive-branches`/
`remote-prune`/`ledger-residue` to the background pass), none of which this step's own next
paragraph describes needing, and `remote-prune`'s inclusion is what forces the full
`--prune all-refs` fetch (`shared-fetch.js`) instead of the single-ref fetch a `mirror`-only
request uses. Fast-forwards the mirror (the local integration branch — "mirror" and
"local main" name the same object; this file uses "mirror" throughout since that is
`bin/lib/reconcile`'s own term), releases the claim, and archives the run dir. This is convergent
cleanup, not owed — a failure
here (network, `gh` blip) is logged and left for the next trigger point, never retried inline and
never a reason to report anything other than `merged`. (#3249: `release` and `archive` both fall
back past a torn-down worktree or deleted branch — `fallbackBranch`, then the run's stamped PR
number — so a run whose worktree is already gone can converge in this same pass. One exception is
by design: a run that never rendered a console (the fast-lane auto-merge short-circuit writes no
`console.json`) archives only when its `staged/` holds nothing pending.)

Resolve where this run lives after the reconcile call. When `$PIPELINE_RUN_DIR` is gone and
`$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/` is present (`{run-id}` =
`basename($PIPELINE_RUN_DIR)`), reconcile archived this run: every `decisions.md` line this step
writes after the reconcile call passes that archive path as `--run`
(`$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/`, `_shared/timing-render.md`'s archive-path
rule) — never `$PIPELINE_RUN_DIR`. `log-decision.js` exits 3 on the moved path, and a hand append
would recreate an un-archived run dir holding one `decisions.md`. An archived run is by
construction not the stuck run (reconcile archives a never-rendered-console run only when its
`staged/` holds nothing pending), so its own check is clean; the "other run dir(s)" line below
targets that resolved path.

Decide whether **this run** is that stuck run by checking it directly — never from the reconcile
summary, which sweeps every run dir in the main checkout and carries counts, not paths. This run
needs human action when `$PIPELINE_RUN_DIR/console.json` is absent AND `$PIPELINE_RUN_DIR/staged/`
(or any `$PIPELINE_RUN_DIR/spec-*/staged/`) holds a non-dotfile entry — reconcile's
`console-never-rendered-staged-pending` skip: it merged with no rendered console and pending
`staged/` items, which a human must resolve or discard. An unreadable `staged/` (or `spec-*/staged/`)
counts as pending, matching reconcile's fail-closed read. Log, on one line — this holds whatever the
reconcile call itself returned, since a later pass skips this run the same way:
`AUTO {time} — pr-first-merge Step 4.2: this run is console-never-rendered-staged-pending — needs human action (pending staged/ items, no rendered console); not left for the next trigger point. Reversibility: n/a.`
and carry "needs human action" into the closing report. When the summary names the reason but this
run's own check is clean, the stuck dirs are other runs: log to the path resolved above (else
`$PIPELINE_RUN_DIR`) and report "{N} other run dir(s) need human action
(console-never-rendered-staged-pending)" without attributing it to this run. Either way the outcome
is reported as `merged`, with a needs-human-action note. Reconcile escalates such a dir
through the consolidated `structurally-stuck` record only after it sits untouched past the 7-day
TTL and repeated consecutive stuck passes, whether or not the run is closed: a closed auto-merge
short-circuit run escalates the same way, via reconcile's clean-status sweep (#3668).

**No `git merge`, `git commit`, or `git push` runs in the main checkout anywhere in this procedure**
— the reconciler's own `mirrorFastForward` is a strict `--ff-only`, never a merge that could
conflict, so it needs no worktree, no branch guard, and no close-run relief.

## Step 5: Delete the remote branch (after worktree teardown)

Applies only after outcome `merged` (never `armed`/`pending-review`), and only **after** the
worktree has actually been removed. This step's trigger point is downstream of `pr-first-merge.md`'s
own procedure — it is cited from `wrap-up/cleanup-procedures-execution.md` Section C, which is
where worktree removal actually happens; Step 4 above never tears down a worktree itself, so
nothing in this file calls this step inline.

```bash
gh api -X DELETE "repos/{owner}/{repo}/git/refs/heads/{branch}"
```

Never `git push origin --delete {branch}` — the no-`git push`-in-the-main-checkout rule stated at
the top of `pr-first-merge.md` stands, and `gh api` keeps this step off git entirely (the
worktree-always gate has exempted a branch-delete push since #658, `git -C` form included since #3900).
Never `gh pr merge --delete-branch` either: by the time this step runs the worktree is already
gone, but the dedicated ref-delete call keeps this step decoupled from whichever merge command
Step 3 actually ran — simpler to reason about than retrofitting `--delete-branch` onto Step 3's
several merge-command variants.

Guard: never delete `{integration-branch}` itself — assert the branch name differs before
calling; a match here is a caller bug, not a runtime condition to branch on. Tolerate "reference
does not exist" (already deleted — e.g. by GitHub's own branch-protection auto-delete setting,
or a re-run of this step) as success, not a failure to report.

`gh`-absent transport: no GitHub MCP tool for a ref/branch delete is confirmed to exist —
`github-write-transport.md`'s CRUD mapping covers issue operations only, and the GitHub MCP
server's own branch tools stop at `create_branch`/`list_branches`. Under `gh`-absent, skip the
delete: the branch accumulates as a stale head for a future `/claude-tweaks:tidy` sweep to
catch, rather than inventing a tool call that doesn't exist.
