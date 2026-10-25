# PR-First Merge — post-merge steps (outcome `merged` only)

Read this file only once `pr-first-merge.md`'s Step 3 has confirmed outcome `merged` (a `pending-review`
or `armed` outcome never reaches this file — the reconciler completes those later, convergently,
per Step 3's own account). This holds Step 4 (post-merge reconcile) and Step 5 (delete the remote
branch) — the two steps that exist only on the confirmed-merged path, never read on the far more
common `armed`/`pending-review` outcomes a merge attempt actually produces on this repo (Task 0's
own capture: an unprotected repo's `--auto` call usually merges immediately or arms, but every
parked/red/conflict/permission branch in Step 3 never reaches here at all).

## Step 4: Post-merge reconcile

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

`--checks mirror,release,archive` scopes the sweep to exactly what this step needs — the full
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
the top of `pr-first-merge.md` stands, and the worktree-always gate denies the push there anyway.
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
