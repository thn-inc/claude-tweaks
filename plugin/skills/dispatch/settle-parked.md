# Dispatch — Settle Parked (`--settle-parked`)

Canonical procedure for `/claude-tweaks:dispatch --settle-parked` (`SKILL.md`'s Input
table): a batch review of every open `bot:parked` PR, so a human settles a whole
backlog of parked runs in one pass instead of looping `resume-confirmation.md`'s
per-PR confirm one PR at a time.

**Standalone form, human-present only.** Same posture as `backlog refine
--reset-breaker` — never invoked by a scheduled Routine, and rejected in
combination with a ref (`#N`/`#N,#M,...`) or `--budget` (mutually exclusive;
report the conflict and perform no fetch, mirroring `backlog/SKILL.md`'s
`--source` conflict rule).

This does not change `merge-check`'s `needs-human` classification, and does not
touch `_shared/policy-schema.md` or the `autonomy` ceiling — it only collapses
the per-PR "do you want to look?" click `resume-confirmation.md` already asks
into a single batch decision.

## Step 1: Fetch every open `bot:parked` PR

```bash
gh pr list --repo {owner}/{repo} --label bot:parked --state open \
  --json number,title,headRefName,url,isDraft
```

For each result, resolve its run-dir from the PR body's `claude-tweaks-run:`
marker (dual-marker scheme — `_shared/pr-early-run-lifecycle.md`: read the
HTML-comment form on a `gh`-present read, the plain-text companion form on a
`gh`-absent MCP read) rather than re-deriving it from the branch name.

## Step 2: Freshness probe + fresh CI read, per PR

For each PR resolved in Step 1, run two checks — reusing
`resume-confirmation.md`'s existing mechanics rather than reimplementing them:

1. **Freshness probe:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" check-resume-freshness --run "{run-dir}"` — same call `resume-confirmation.md` makes before its own per-PR resume.
2. **Fresh CI/mergeability read:** `gh pr view {n} --json state,mergeStateStatus,statusCheckRollup` — the same shape `_shared/pr-first-merge.md`'s Step 2.5 state read already uses.

**A `BLOCKED` freshness result (worktree live, or recently committed) is
excluded from the batch table** — it is not silently dropped: report it on a
separate `excluded — still live` line naming the PR, so the human sees it was
considered and why it isn't offered. Every other PR (an `OK` freshness result)
proceeds to Step 3.

## Step 3: Render the batch table and multi-select confirm

One table, one row per eligible PR from Step 2:

```markdown
| Target | PR # | Park reason | CI status | Files changed |
|---|---|---|---|---|
| #123 | #456 | check-failed:test | passing | 3 |
| #789 | #790 | checks-pending-timeout | pending | 1 |
```

- **Park reason** — parsed from the original park comment `_shared/pr-first-merge.md`'s Red path posted (the `reason: check-failed:{names} | checks-pending-timeout` text `_shared/pr-first-merge.md`'s Step 2.5 log line already uses).
- **CI status** — summarized from Step 2's `statusCheckRollup` as `passing`/`failing`/`pending`, same vocabulary `resume-confirmation.md` uses.
- **Files changed** — from `gh pr diff {n} --name-only | wc -l`.

Then one `AskUserQuestion` call, **multi-select** — distinct from
`resume-confirmation.md`'s own per-PR single-select question:

```
question: "Which parked PRs should resume toward merge? Unselected rows stay parked, untouched."
header: "Settle parked PRs"
multiSelect: true
options: one per eligible row — label: "#{n} (PR #{pr})", description: "{park reason} · CI: {status} · {files} files"
```

Unpicked rows are left exactly as they are — `bot:parked` label and worktree
untouched, nothing written.

## Step 4: Sequential resume, selected PRs only

For each PR the human selected in Step 3, **in order, never in parallel** (see
`SKILL.md`'s Anti-Patterns and the spec's Non-Goals — two concurrent
`/claude-tweaks:flow ... wrap-up` invocations against one session have no
supported way to render two Review Consoles at once):

1. **Skip `resume-confirmation.md`'s own per-PR `AskUserQuestion`** — the batch
   step above already made that decision for this PR.
2. **Re-run the freshness probe** (`check-resume-freshness`) immediately before
   resuming — state can drift between batch-confirm and this PR's turn in the
   sequence, especially for the last PR in a long batch. A `BLOCKED` result
   here is a second, closer-to-the-write freshness re-probe: report it (naming
   the PR and the blocking reason), leave it parked, and the batch continues to the next selected PR
   — never abort the rest of the batch over one PR's drift.
3. **Resume**, from inside this PR's own already-assigned worktree:
   `PIPELINE_RUN_DIR="{run-dir}" /claude-tweaks:flow "{target}" wrap-up` — the
   PR's own resolved run-dir from Step 1, never a newly-minted one. Let that
   run's own Review Console render fully before moving to the next selected
   PR.

## Anti-Patterns

| Pattern | Why It Fails |
|---|---|
| Resuming two selected PRs in parallel | Each resume re-adopts a worktree and its own `/claude-tweaks:flow ... wrap-up` invocation renders its own Review Console — no supported way to run two concurrently against one session |
| Aborting the whole batch when one selected PR's pre-resume freshness check returns `BLOCKED` | That PR alone stays parked and reports why; every other selected PR still resumes |
| Reusing `resume-confirmation.md`'s single-select question for the batch step | Defeats the point of batching — one PR at a time is exactly what this entry point exists to collapse |
| Silently dropping a `BLOCKED` PR from the batch table with no trace | Report it on its own `excluded — still live` line so the human knows it was considered |
