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
already treats every failing check as red). This read adds only `stale` — the PR's `headRefOid` is
not local HEAD, so nothing is concluded. The merge gate keeps its own read and stays the final
authority; this gate never replaces it.

## When it runs

Only when `$PIPELINE_RUN_DIR` is set (a standalone run has no run PR to read — skip, nothing to
log), and only after the caller's own local verification has passed:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/pr-checks.js" --run "$PIPELINE_RUN_DIR"
```

One plain command; it prints `{state, failing, pending, headRefOid, localHead, pr, reason?}` and
exits 0 in every state. Exit 2 or 3 is a tooling problem with the read itself — treat it exactly
like `read-failed` below.

## Routing by `state`

- **`red`** — a gate failure, the same class as a local test failure: do not set `TEST_PASSED`
  (`/test`), and **STOP** (`/review` Step 1.5). Render each `failing[]` entry's name and url —
  "PR #{pr} check `{name}` is failing at {headRefOid short} ({url})" — as the failure card's
  finding. A green local run is not evidence against it: fix forward, push, and re-run the gate.
- **`pending`** or **`stale`** — pass, with a caveat: `TEST_PASSED` is set and carries the caveat
  naming the pending checks (or the unpushed HEAD), and one entry is logged:
  `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO --section "{/test|/review}" --step "PR-check gate" --reversibility high --text "PR #{pr} checks {state} at {headRefOid short} ({pending names, or 'HEAD not yet pushed'}) — passed with caveat"`.
  The merge gate's bounded watch settles them later.
- **`green`** — pass; nothing to log.
- **`no-pr`**, **`gh-absent`**, **`no-ci`**, or **`read-failed`** (and exit 2/3) — fail open
  exactly as before this gate existed: the caller's local result stands. Write one `SKIP` entry
  per `_shared/auto-decision-log.md`'s degrade-trace rule:
  `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP --section "{/test|/review}" --step "PR-check gate" --reversibility n/a --text "condition: pr-checks.js {state}{: reason} → fallback: local verification only"`.
  `no-pr` is the `local-merge` (and pre-PR) case; `read-failed` is never read as green — it only
  means this gate could not tell, and the merge gate's own read will.
