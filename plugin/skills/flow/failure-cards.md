# Flow — Failure Cards

Loaded by `/claude-tweaks:flow` Step 4 (or Step 3's Manifesto ceremony-check) **only when a gate fails**. These templates are never rendered on the success path; `summary-template.md` handles successful completion.

Two templates live here. Pick by failure shape:

| Failure | Template |
|---|---|
| Re-verify gate failed after polish modified code | "Polish broke verification" below |
| Any other gate (build / stories / test / review / wrap-up) | "Generic gate failure" below |
| Step 3 Manifesto ceremony-check returned no `CEREMONY:` verdict | "Generic gate failure" below, `Failed at: Manifesto ceremony-check`; resume by re-running `/claude-tweaks:flow #{n}` with the same step list (`ceremony-check` is not a step name) |

**Claims held by a record-mode run:** when the stopped run holds issue claims
(`claims/issue-{issue}.json` on `claims-registry`, claimed at Step 2.8 by this run
(`flow/claim-targets.md`), whether dispatched or run directly, per `_shared/issue-claims.md`),
the card must OFFER release — never auto-release. Resuming is the
recommended next action, and a resumed run needs its claims intact; an unreleased claim ages
out via TTL anyway.

When the stop occurs, post a *blocked* checkpoint comment to each claimed issue so a stalled
issue carries a resumable breadcrumb (plain text, no marker — the claim classifier ignores it):

```bash
gh issue comment "$ISSUE" --body "Blocked at {gate}: {one-line reason}. Run {runId}; claim active until {expiry} unless released."
```

Compute `{expiry}` from this run's claim comment (`claimedAt` + `ttlHours`).

Posting is automatic (a reversible network write) and each post logs to `decisions.md`.
Release remains offered-only — see below. When claims are held, the release decision
renders as a separate `AskUserQuestion` call in whichever template's Next Actions
section applies (see below) — never folded into the navigation command block. Releasing
means: read claims/issue-{issue}.json on claims-registry for its current sha, then
overwrite it with the release tombstone (per _shared/issue-claims.md, 'The lock' →
Release), after the ownership check (_shared/issue-claims.md, 'Release triggers') +
release comment, then best-effort `gh issue edit "$ISSUE" --remove-label bot:in-progress`
(every release removes the cosmetic claim mirror, regardless of outcome) — otherwise
they expire after the TTL (72h default). Grants (auto:build/auto:merge) are untouched by
a failed-gate release — see issue-claims.md's Release triggers table; grant removal is
scoped to a merged:/pr-opened: outcome only, so the record stays eligible for a future
dispatch retry.

## Generic gate failure

```markdown
## Flow: Pipeline Stopped

### Completed
- {step}: {outcome}

### Failed at: {step}
{failure details from the step's output}

### Open Items (at time of failure)
{current ledger contents — so the user sees what's been tracked}

### Manual Steps Required (collected so far)
| # | What | Where |
|---|------|-------|
| 1 | {description} | {source} |
(or: No manual steps collected yet.)

> These were detected before the pipeline stopped. Address them alongside the fix.

### Actions Performed

{Include rows from completed phases before the failure. Omit when pipeline failed at the first step.}

| Action | Detail | Ref |
|--------|--------|-----|
| {rows from completed phases} | ... | ... |
```

### Next Actions

Close the template's fence above, then render the applicable lines as plain markdown (docs/skill-authoring.md's Skill handoffs convention), unfenced prose:

**`/claude-tweaks:flow {spec} {failed-step}`** — resume from {failed step} (recommended)
`/claude-tweaks:{step} {spec}` — run {failed step} manually for more control
`/claude-tweaks:test` — re-verify after fixes — when test failed

When issue claims are held, additionally call `AskUserQuestion` (single decision — release the claim(s) or keep them held; the skill executes the release itself; kept-vs-released changes what other dispatchers may do, which is why this is a decision that blocks the skill from finishing (docs/skill-authoring.md's Skill handoffs convention), not navigation).

A re-verify failure after polish (the "polish broke verification" shape) never reaches this template — per the routing table above, it always routes to the "Polish broke verification" template below, which owns the dedicated `git diff` / `git revert` conversion for that shape. That branch is dropped here rather than duplicated.

## Polish broke verification

Use this specific shape (instead of the generic template above) when the re-verify gate fails after polish modified code. The polish-modifications section is the critical differentiator — the user needs `git diff` context for the polish commit to triage.

```markdown
## Flow: Pipeline Stopped — Polish broke verification

### Completed
- build: passed
- stories: {outcome}
- test: passed
- review: PASS
- polish: invoked {N} commands ({list}), modified {M} files

### Failed at: re-verify (post-polish)
{verification failures from /test skip-qa output — types/lint/test errors}

### Polish modifications
{git diff --stat output for the polish commit(s)}

### Open Items (at time of failure)
{current ledger contents}
```

### Next Actions

Close the template's fence above, then render the lines in the same order below as plain markdown (docs/skill-authoring.md's Skill handoffs convention), unfenced prose:

**`git diff {polish-commit-range}`** — inspect the polish modifications that broke verification (recommended)
`git revert {polish-commit}` then `/claude-tweaks:flow {spec} no-polish wrap-up` — revert the polish commit and resume without polish
Fix the verification failure manually, then resume: `/claude-tweaks:flow {spec} polish`

When issue claims are held, additionally call `AskUserQuestion` (single decision — release the claim(s) or keep them held; the skill executes the release itself; kept-vs-released changes what other dispatchers may do, which is why this is a decision that blocks the skill from finishing (docs/skill-authoring.md's Skill handoffs convention), not navigation).

> The re-verify cycle cap is 1 per flow run. Resuming with `/claude-tweaks:flow {spec} polish` starts a fresh cycle.
