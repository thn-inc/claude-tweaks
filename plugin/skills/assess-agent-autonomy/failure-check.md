# Mode: failure-check

**Called from:** `/claude-tweaks:dispatch`'s Settle step, replacing "any failed run
unconditionally revokes `auto:merge`."

## Step 1: Gather

```bash
gh api "repos/{owner}/{repo}/issues/${N}/comments?per_page=100" > /tmp/assess-failure-comments-${N}.json
node -e "
  const { countFailedAttempts } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/retry.js');
  const comments = require('/tmp/assess-failure-comments-${N}.json');
  console.log(JSON.stringify({ priorAttempts: countFailedAttempts(comments) }));
"
```

Follows `_gather-resilience.md`'s three-part shape: the MCP path uses `issue_read`'s
**get_comments mode** (the same mapping `dispatch/settle-and-merge.md` step 4 already cites for
its own comment fetch) in place of the `gh api` call above — the rest of this step consumes the
same comment-body-string shape regardless of transport. The could-not-gather short-circuits
(neither transport available, or the fetch itself fails) render Step 3 directly with
`CLASSIFICATION: correctness` / `NOTIFY_NOW: false` and the specific gather/fetch failure named
verbatim in `RATIONALE`.

Read the actual failure output from the gate that failed (test output, review findings, error
logs) — already in the calling agent's context from the run that just failed.

## Step 2: Judge

- **Transient signatures**: a `gh api` rate-limit response classified per
  `_shared/github-rate-limit.md` as secondary/abuse or primary exhaustion (a plain 403 under
  that file's taxonomy is NOT transient), network timeouts,
  `ECONNREFUSED`, or a test failure the calling agent can independently confirm is pre-existing and
  unrelated to this run's diff (e.g., rerunning the same test against unchanged code on the default
  branch also fails intermittently). Do not classify a test as flaky from memory of a specific test
  name — a test once known to be flaky may since have been fixed, and a genuine regression that
  happens to fail the same assertion must not inherit an old flakiness verdict. Classify
  `transient`.
- **Correctness signatures**: a test failure showing an assertion mismatch directly tied to code
  the record's own diff changed (expected/actual values diverging in logic the change touched).
  Classify `correctness`.
- **Ambiguous**: anything that doesn't clearly match either pattern. Classify `ambiguous` and
  handle it exactly like `correctness` downstream (see Output) — when genuinely unsure, err toward
  the existing conservative behavior, never toward the new permissive one.
- **`NOTIFY_NOW`**: set `true` when this is the *same* `correctness`-class failure recurring
  verbatim across two or more consecutive attempts — compare this failure's content against the
  prior `Attempt N failed: {reason}` comment bodies in `/tmp/assess-failure-comments-${N}.json`
  (the raw comments fetched in Step 1; `priorAttempts` itself is only the count from
  `countFailedAttempts`, not the reason text) — a signal the agent may be stuck rather than making
  incremental progress. Otherwise `false`.

## Step 3: Render

```
CLASSIFICATION: correctness | transient | ambiguous
NOTIFY_NOW: true | false
RATIONALE: {one paragraph}
```

**Return to caller:** this output is consumed by the calling skill — control returns to the caller, whose next step runs in this same turn; never end the turn on this render.

The caller (dispatch's Settle step) is responsible for acting on `CLASSIFICATION` — revoking
`auto:merge` for `correctness`/`ambiguous`, preserving it for `transient` — and for the
retry-ceiling bookkeeping, which runs unconditionally regardless of this mode's output (see
`skills/dispatch/SKILL.md`'s Settle step).

## Anti-Patterns

| Pattern | Why It Fails |
|---------|--------------|
| Classifying an unclear failure as `transient` "to be less conservative" | Ambiguity always resolves to `correctness`'s conservative handling — accuracy, not blanket permissiveness. |
