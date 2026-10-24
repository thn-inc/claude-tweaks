# PR-Check Gate — the run PR's CI state at a test/review gate

Under `integration-model: pr-first` (`_shared/integration-model.md`) a run's draft PR exists from
run start and every phase exit pushes to it (`_shared/pr-early-run-lifecycle.md`), so CI on that
PR can already be red at the commit a local verification pass just blessed — a race that shows
only on the CI runner (#3013's incident: a hydration-timing e2e failure that never reproduced
locally). This procedure is the one read both `/claude-tweaks:test`'s pipeline gate and
`/claude-tweaks:review` Step 1.5 run so that red check stops the run before review, polish, and
wrap-up are spent on top of it. Callers cite this file; neither restates it.

**Classification authority.** The red/pending/empty/green rules are
`_shared/pr-first-merge.md`'s Step 2.5, applied in that order by `bin/lib/pr-checks/classify.js`
(any failing check is red — the rollup does not mark which checks are required, and the merge gate
already treats every failing check as red). This read adds one thing the merge gate does not need:
`stale`, meaning the PR's `headRefOid` is not local HEAD, so nothing is concluded. StatusContext
normalization (a failed StatusContext entry reads `red`, a passing one green) is shared with the merge
gate, which normalizes the same way before its rules apply. The merge gate keeps its own read and stays the final
authority; this gate never replaces it. The reader also lists the workflow runs for the PR head
(`gh run list --commit {headRefOid}`) and classifies them by the head-run cross-check in
`_shared/pr-first-merge.md`'s Step 2.5 (a run not yet completed is pending, a failing one red), and a
failed runs read is `read-failed` unless the verdict is still `red` after the base comparison below
(#3405) — a partial read never concludes `inherited-red`.

On a `red` read the reader also reads the tip of the branch the PR merges into (its own
`baseRefName`; the integration branch from `_shared/integration-branch.md`'s shared resolver only
when the PR view carries none — the branch compared is printed as `baseBranch`) — its check runs,
commit statuses and workflow runs — and flags each
`failing[]` entry `inherited: true` when a check of the same name is failing there, `false`
(attributable) otherwise. When every failing entry is inherited the state is `inherited-red`; when
the base cannot be read in full (a failed read, or a listing cut short by paging) the state stays `red` with `baseReason` and no `inherited` flags — never
green (#3258).

## When it runs

Only when `$PIPELINE_RUN_DIR` is set (a standalone run has no run PR to read — skip, nothing to
log), and only after the caller's own local verification has passed:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/pr-checks.js" --run "$PIPELINE_RUN_DIR"
```

One plain command; it prints `{state, failing, pending, headRefOid, localHead, pr, reason?, baseBranch?, baseSha?, baseReason?}` and
exits 0 in every state. Exit 2 or 3 is a tooling problem with the read itself — treat it exactly
like `read-failed` below.

## Routing by `state`

- **`red`** — resolve the lever first: `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --run
  "$PIPELINE_RUN_DIR" --values merge-verification`. When it prints `off`, route `red` like
  `pending` — pass with a caveat naming the failing checks, same `--status AUTO` line as the
  `pending`/`stale` bullet below — matching `_shared/pr-first-merge.md` Step 2.5's `off` behaviour
  (a red PR check is "logged and shown, not acted on" there too). Otherwise (`merge-when-green`,
  `wait`, unresolved, or any other value): a gate failure, the same class as a local test failure —
  do not set `TEST_PASSED` (`/test`), and **STOP** (`/review` Step 1.5). Render each `failing[]`
  entry not flagged `inherited` (the attributable checks) — its name and url — "PR #{pr} check
  `{name}` is failing at {headRefOid short} ({url})" — as the failure card's finding; those alone
  are the cause. List any `inherited: true` entries after them as "also failing on
  {baseBranch} at {baseSha short} — inherited, catch up rather than debug the diff". With
  `baseReason` present, every failing check is treated as attributable and the card says the base
  comparison could not run (`{baseReason}`). A green local run is not evidence against it: fix
  forward, push, and re-run the gate.
- **`inherited-red`** — pass, with a caveat: `TEST_PASSED` is set and carries the caveat; `/review`
  Step 1.5 proceeds. Log one entry:
  `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO --section "{/test|/review}" --step "PR-check gate" --reversibility high --text-file "{text-file}"`, `{text-file}` holding `PR #{pr} checks red at {headRefOid short}, but every failing check ({names}) is also failing on {baseBranch} at {baseSha short} — inherited, passed with caveat` per `_shared/auto-decision-log.md`'s Text from git or a user paragraph (check names and the base branch are forge-supplied).
  The merge gate (`_shared/pr-first-merge.md` Step 2.5) keeps its own read and still sees these
  checks red — this pass never authorizes a merge. This read does not report still-pending checks
  on an `inherited-red` result; the merge gate's own bounded watch settles them.
- **`pending`** or **`stale`** — pass, with a caveat: `TEST_PASSED` is set and carries the caveat
  naming the pending checks (or the unpushed HEAD), and one entry is logged:
  `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO --section "{/test|/review}" --step "PR-check gate" --reversibility high --text-file "{text-file}"`, `{text-file}` holding `PR #{pr} checks {state} at {headRefOid short} ({pending names, or 'HEAD not yet pushed'}) — passed with caveat` per `_shared/auto-decision-log.md`'s Text from git or a user paragraph (check names are forge-supplied).
  The merge gate's bounded watch settles them later.
- **`green`** — pass; nothing to log.
- **`no-pr`**, **`gh-absent`**, **`no-ci`**, or **`read-failed`** (and exit 2/3) — fail open
  exactly as before this gate existed: the caller's local result stands. Write one `SKIP` entry
  per `_shared/auto-decision-log.md`'s degrade-trace rule:
  `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP --section "{/test|/review}" --step "PR-check gate" --reversibility n/a --text-file "{text-file}"`, `{text-file}` holding `condition: pr-checks.js {state}{: reason} → fallback: local verification only` per `_shared/auto-decision-log.md`'s Text from git or a user paragraph (the reason is tool-supplied).
  `no-pr` is the `local-merge` (and pre-PR) case; `read-failed` is never read as green — it only
  means this gate could not tell, and the merge gate's own read will.
