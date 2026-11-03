# `gh issue` write inventory

Record #4824 found that the Parent-Gate Procedure read a parent through `parent-gate.js`, whose repo resolves from `origin`, then wrote to it with bare `gh issue` commands that land on `gh`'s default repository. In a checkout where those two differ, the reads and the writes split across remotes. #4824 added `--repo "{parent-repo}"` to that procedure only. This inventory classifies every other `gh issue` write under `plugin/skills/`, in fenced lines and in runnable inline spans, so the remaining hazard has a list. It is a snapshot, not a guard: it is re-scanned when a `--repo` sweep runs, and nothing tests it.

Scanned at commit `1ace04e2a0581aa0d23a780cc851a4b99541a3ef`.

## How the scan works

It walks `plugin/skills/**/*.md` and emits one row per fenced line or inline span that holds a write:

- **Write regex:** `/\bgh issue (comment|close|edit|create|reopen|delete|lock|unlock|pin|unpin|transfer|develop)\b/`.
- **Fence rule:** fence state toggles on a line matching `` /^\s*(```|~~~)/ ``. A matching line inside a fence is a `fence` row.
- **Span rule:** outside fences, a backtick span is matched, including one wrapped across one line break, whose line breaks are joined to spaces before matching. A candidate span that crosses two line breaks or a blank line is not a span. A matching span is a `span` row, at the line where the span opens.

A multi-line fenced command shows its first line here; no continuation line of a fenced write carries `--repo`. A command longer than 160 characters shows an excerpt around its write.

**Reconciliation.** `git grep -c -E "gh issue (comment|close|edit|create|reopen|delete|lock|unlock|pin|unpin|transfer|develop)" -- plugin/skills` counts 243 matching lines in 85 files. The scan has 273 rows in 86 files: 243 + 29 rows that share a line with another span (several spans on one line) + 1 span whose write is itself split across a line break (`wrap-up/ledger-narrowing-auto-file.md:9`, `gh issue` / `create`), which line-based `git grep` cannot match. No matching line falls outside both a fence and a span.

## Classes

| Class | Meaning |
|---|---|
| `repo` | Carries `--repo`. |
| `cwd-scoped` | Runs, and the procedure's reads for that record also resolve against `gh`'s default repository: bare `gh issue`/`gh pr` calls and `gh api repos/{owner}/{repo}/…` placeholders, which `gh` fills from that same default. Reads and writes cannot split across remotes. |
| `needs-fix` | Runs bare, and the procedure reads that record through an origin-resolved slug or a CLI verdict sourced from `origin`. The parent gate's hazard has recurred. |
| `descriptive` | Names the command without running it: a transport mapping table, a `#`/`//` comment, an `echo`ed string, a quoted hint, a numbered example such as `gh issue edit 123`, or a command a human runs. |

`descriptive` wins: a row that only names a command is `descriptive` even when its text carries `--repo`. `repo` is for a row that runs.

Three readings apply the table to this corpus:

- A span that uses the command as a noun ("before any `gh issue create`"), or that points at a write whose runnable form is another row here (the health skills' "call `gh issue create`" sentences, whose fences are inventoried), is `descriptive`. A bare-verb span that is the only form of its write is runnable.
- A create of a new record that nothing has read is `cwd-scoped`: the record is born on `gh`'s default repository, and later writes use the number the create returned.
- `needs-fix` is judged on the read the write's own step rests on. A CLI is origin-sourced when, given no `--repo`, it resolves the repo from `git remote get-url origin` (`gateOriginRepo`: `materialize.js`, `release-claim.js`, `resolved-refusal.js`, `backlog-grant-gate.js`, `fetch-sub-issues.js` and others), or when it works on the `origin` remote directly (`claim-targets.js`'s git compare-and-swap on `claims-registry`). An artifact such a CLI wrote this run, such as the materialized `work/{n}-spec.md`, counts as its read. A CLI that reaches `gh` only through `ghOptions` (`digest-rollover.js`, `closing-links.js`) inherits `gh`'s default and is not origin-sourced. A record number that entered the run through `materialize.js` at run start does not by itself make a later write `needs-fix` when that write's step re-reads the record bare.

## Counts

| Class | Rows | Fence | Span |
|---|---|---|---|
| `repo` | 7 | 7 | 0 |
| `cwd-scoped` | 99 | 43 | 56 |
| `needs-fix` | 19 | 12 | 7 |
| `descriptive` | 148 | 17 | 131 |
| Total | 273 | 79 | 194 |

## Needs a fix

Each write runs bare against `gh`'s default repository while its step reads the record through `origin`. This list is the scope of the follow-up record.

- `plugin/skills/_shared/issue-claims.md:365` (fence) — mirrors the claim `claim-targets.js` took on the `origin` remote's `claims-registry` (git compare-and-swap; `claims-git-cas.js` defaults `remote = 'origin'`), but posts to `gh`'s default repository.
- `plugin/skills/backlog/grant-lane-decision.md:113` (fence) — runs only when `resolved-refusal.js` (repo resolved from `origin`) returns `suppress: false` for this record.
- `plugin/skills/backlog/grant-lane-decision.md:114` (fence) — same gate as line 113: the comment follows `resolved-refusal.js`'s origin-resolved verdict.
- `plugin/skills/backlog/refine-headless.md:400` (fence) — grants a candidate `backlog-grant-gate.js` (repo resolved from `origin`) fetched and cleared; the bare `gh issue view` before it only picks the label pair.
- `plugin/skills/backlog/refine-headless.md:402` (fence) — same grant as line 400, on `backlog-grant-gate.js`'s origin-resolved verdict.
- `plugin/skills/backlog/refine-headless.md:404` (fence) — same grant as line 400, on `backlog-grant-gate.js`'s origin-resolved verdict.
- `plugin/skills/build/plan-review.md:103` (span) — the step reads #n only through the spec `materialize.js` fetched from `origin` (`work/{n}-spec.md`); it makes no other read of the record.
- `plugin/skills/build/plan-review.md:129` (span) — same read as line 103: the question set is posted to #n, known only through the spec `materialize.js` fetched from `origin`.
- `plugin/skills/dispatch/settle-and-merge.md:124` (fence) — Settle steps 3-5 run only when `release-claim.js` (repo resolved from `origin`) found and released this run's claim on the record.
- `plugin/skills/dispatch/settle-and-merge.md:127` (fence) — same gate as line 124: `release-claim.js`'s origin-resolved ownership read.
- `plugin/skills/dispatch/settle-and-merge.md:212` (fence) — same gate as line 124: `release-claim.js`'s origin-resolved ownership read.
- `plugin/skills/flow/failure-cards.md:24` (fence) — posts to each issue this run claimed through `claim-targets.js`, whose lock is read and written on the `origin` remote's `claims-registry`.
- `plugin/skills/flow/failure-cards.md:36` (span) — removes the label after the claim release, whose ownership read is `release-claim.js`'s (repo resolved from `origin`).
- `plugin/skills/flow/multispec-review-console.md:221` (span) — gated on the materialized header's `parked-at-shaping` (written by `materialize.js` from `origin`), after `release-claim.js` (repo resolved from `origin`) released the claim.
- `plugin/skills/review/cross-spec-promise-check.md:25` (span) — `$PARENT_NUM` comes from this record's own body, which `/review` holds as the spec `materialize.js` fetched from `origin` (`code-mode-steps.md` Step 1: "no separate fetch").
- `plugin/skills/review/cross-spec-promise-check.md:26` (span) — same parent resolution as line 25, through the `origin`-fetched spec.
- `plugin/skills/tidy/decision-markers.md:54` (fence) — a `[parent-gate]` finding's verdict comes from `_shared/github-pr-scan-acceptance.md`'s parent-gate scope, whose sub-issue state `fetch-sub-issues.js` reads with a repo resolved from `origin`.
- `plugin/skills/tidy/decision-markers.md:55` (fence) — same finding as line 54: the label follows the `fetch-sub-issues.js` (origin) verdict.
- `plugin/skills/wrap-up/cleanup-procedures-execution.md:461` (span) — gated on `wrap-up-pack.json`'s `inputs.parkedAtShaping` (the header `materialize.js` wrote from `origin`), after `release-claim.js` (repo resolved from `origin`) released the claim.

## Descriptive rows that stage a bare write

These rows are `descriptive` by the precedence rule and are not counted above, but the command they name runs later, bare, at `/claude-tweaks:tidy --approve`:

- `plugin/skills/dispatch/queue-pull-script.md:608` — the staged Close (GitHub) proposal for a shipped candidate rests on the `mentions` that `resolve-linked-prs.js` (repo resolved from `origin`) returned.

## By file

### `plugin/skills/_shared/auto-mode-contract.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 149 | span | `gh issue reopen {parent}` | `descriptive` |
| 149 | span | `gh issue reopen {record}` | `descriptive` |
| 154 | span | `gh issue edit --body-file` | `descriptive` |

Each row is a restore the contract says "a human runs"; the pipeline never runs it.

### `plugin/skills/_shared/autonomy-ceiling.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 395 | span | `gh issue create` | `descriptive` |

### `plugin/skills/_shared/dependency-narration-check.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 41 | span | `gh issue edit` | `cwd-scoped` |

The follow-up edit is the `body-text` fallback when `link-records.js` reports no `gh`; the record and `#N` are read with bare `gh issue view`.

### `plugin/skills/_shared/github-write-transport.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 23 | span | `gh issue create --title ... --body ...` | `descriptive` |
| 24 | span | `gh issue edit {n} --add-label/--remove-label/--body-file` | `descriptive` |
| 25 | span | `gh issue comment {n} --body-file` | `descriptive` |
| 26 | span | `gh issue close {n} --reason ...` | `descriptive` |
| 62 | span | `gh issue edit --add-label` | `descriptive` |

### `plugin/skills/_shared/headless-self-report.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 65 | fence | `gh issue create \` | `cwd-scoped` |
| 72 | fence | `gh issue create \` | `cwd-scoped` |
| 88 | span | `gh issue close {n} --reason "not planned"` | `cwd-scoped` |
| 96 | span | `gh issue create` | `descriptive` |
| 96 | span | `gh issue close` | `descriptive` |

The dedup read is a bare `gh issue list --label by:{caller}`; line 96 is the MCP mapping.

### `plugin/skills/_shared/health-filing-digest.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 40 | span | `gh issue create --title "{PREFIX} digest" --body "$(initialDigestBody('{PREFIX}'))" --label by:{PREFIX} --label {PREFIX}:digest` | `cwd-scoped` |
| 41 | span | `gh issue edit <digest-issue-number> --body-file <newbody>` | `cwd-scoped` |
| 42 | span | `gh issue create` | `descriptive` |
| 44 | span | `gh issue create` | `descriptive` |

### `plugin/skills/_shared/health-filing-gate.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 24 | span | `gh issue create` | `descriptive` |
| 26 | span | `gh issue create` | `descriptive` |
| 26 | span | `gh issue create` | `descriptive` |
| 61 | span | `gh issue create` | `descriptive` |

### `plugin/skills/_shared/health-filing-mechanics.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 15 | span | `gh issue create` | `descriptive` |
| 28 | fence | `gh issue reopen <issue_number>` | `cwd-scoped` |
| 29 | fence | `gh issue comment <issue_number> --body "Regressed: this finding reappeared. Run: ${RUN_ID}"` | `cwd-scoped` |
| 36 | span | `gh issue create` | `descriptive` |
| 36 | span | `gh issue reopen` | `descriptive` |
| 36 | span | `gh issue comment` | `descriptive` |

Line 15 points at each consumer's Type expression branch, whose fences are inventoried in the four health skills; the dedup and regression reads are each consumer's bare `gh issue list`.

### `plugin/skills/_shared/health-finding-shapes.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 20 | span | `gh issue create` | `descriptive` |

### `plugin/skills/_shared/health-recent-commit-check.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 9 | span | `gh issue create` | `descriptive` |
| 9 | span | `gh issue create` | `descriptive` |
| 9 | span | `gh issue create` | `descriptive` |
| 22 | fence | `gh issue comment <new_issue_number> --body "Possible overlap with a recently-merged commit — a human should confirm this finding is still live before build:` | `cwd-scoped` |

### `plugin/skills/_shared/health-state.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 65 | span | `gh issue create` | `descriptive` |
| 65 | span | `gh issue create` | `descriptive` |
| 119 | span | `gh issue create` | `descriptive` |
| 120 | span | `gh issue create` | `descriptive` |
| 127 | span | `gh issue create` | `descriptive` |

### `plugin/skills/_shared/issue-claims.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 365 | fence | `gh issue comment "$ISSUE" --body-file /tmp/claim-${ISSUE}.md` | `needs-fix` |
| 548 | span | `gh issue close` | `descriptive` |
| 575 | span | `gh issue close` | `descriptive` |

The lock's primary path is git compare-and-swap on `origin` (`claims-git-cas.js`); only its contents-API fallback uses `gh`'s `{owner}/{repo}` placeholders, so the claim read is not wholly `gh`-default.

### `plugin/skills/_shared/ledger-format.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 165 | span | `gh issue create` | `cwd-scoped` |

Creates a new record directly; nothing reads it first, so the create and any later write share `gh`'s default repository.

### `plugin/skills/_shared/pr-first-merge-post-merge.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 140 | fence | `…"pr-first-merge Step 4.0b" --reversibility "high (gh issue reopen)" --text "closed parent #{parent} below the oversight floor (risk:{maxTier}, risk-floor {riskF…` | `descriptive` |

The command is quoted inside a `--reversibility` string, not run.

### `plugin/skills/_shared/pr-first-merge.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 269 | fence | `gh issue comment "$ISSUE" --repo {owner}/{repo} --body-file "{park-comment-path}"` | `repo` |

Carries `--repo {owner}/{repo}`; the procedure fills the placeholder.

### `plugin/skills/_shared/record-queue-fetch.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 51 | span | `gh issue create` | `descriptive` |

### `plugin/skills/backlog/grant-lane-decision.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 113 | fence | `if gh issue edit "$ISSUE" --add-label needs:decision; then` | `needs-fix` |
| 114 | fence | `gh issue comment "$ISSUE" --body-file "$BACKLOG_NEEDS_DECISION" \|\| echo "label applied but comment post failed for #$ISSUE — retry the comment write"` | `needs-fix` |

### `plugin/skills/backlog/mcp-transport.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 71 | span | `gh issue edit --remove-label bot:blocked --add-label auto:build` | `descriptive` |
| 72 | span | `gh issue edit --add-label auto:build[ --add-label auto:merge-pending]` | `descriptive` |

### `plugin/skills/backlog/refine-closing-summary.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 90 | span | `gh issue edit --add-label` | `descriptive` |
| 94 | fence | `gh issue edit 123 --add-label priority:high` | `descriptive` |

### `plugin/skills/backlog/refine-headless.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 400 | fence | `gh issue edit "$ISSUE" --remove-label bot:blocked --add-label auto:build` | `needs-fix` |
| 402 | fence | `gh issue edit "$ISSUE" --add-label auto:build` | `needs-fix` |
| 404 | fence | `gh issue edit "$ISSUE" --add-label auto:merge-pending` | `needs-fix` |

### `plugin/skills/backlog/refine-lanes.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 83 | span | `gh issue edit` | `descriptive` |
| 83 | span | `gh issue comment` | `descriptive` |
| 185 | span | `gh issue comment` | `descriptive` |
| 256 | span | `gh issue edit … --add-label priority:{tier}` | `descriptive` |
| 306 | span | `gh issue edit` | `descriptive` |
| 314 | fence | `gh issue edit 420 --body-file "$BACKLOG_REFINE_BODY"  # this run's session-scoped backlog-refine-body-420.md, per _shared/session-tmp-root.md` | `descriptive` |

Lanes apply through `apply-refine-labels.js`, which passes its own origin-resolved `--repo`; line 314 is a numbered paste-ready example (`#420`).

### `plugin/skills/backlog/refine-mode.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 354 | span | `gh issue edit "$ISSUE" --body-file` | `descriptive` |
| 369 | fence | `gh issue edit "$ISSUE" --remove-label "$CURRENT_PRIORITY" --add-label "priority:$TIER"` | `cwd-scoped` |
| 371 | fence | `gh issue edit "$ISSUE" --add-label "priority:$TIER"` | `cwd-scoped` |
| 388 | span | `gh issue edit "$ISSUE" --body-file` | `cwd-scoped` |
| 390 | span | `gh issue edit "$ISSUE" --add-label auto:merge` | `descriptive` |
| 402 | fence | `gh issue edit "$ISSUE" --remove-label bot:blocked --add-label auto:build` | `cwd-scoped` |
| 404 | fence | `gh issue edit "$ISSUE" --add-label auto:build` | `cwd-scoped` |
| 407 | fence | `gh issue edit "$ISSUE" --add-label auto:merge` | `cwd-scoped` |
| 413 | fence | `gh issue edit "$ISSUE" --add-label "risk:$RISK_TIER" --add-label "size:$SIZE_TIER"` | `cwd-scoped` |
| 422 | span | `gh issue edit --body-file` | `cwd-scoped` |
| 429 | fence | `gh issue edit "$ISSUE" --remove-label ready` | `cwd-scoped` |
| 430 | fence | `gh issue comment "$ISSUE" --body-file "$BACKLOG_REFINE_FLAGBACK"` | `cwd-scoped` |

Step 1 fetches through `_shared/record-queue-fetch.md` (bare `gh issue list`) and each write re-reads the record with bare `gh issue view`; lines 354 and 390 point at the fenced writes below them.

### `plugin/skills/backlog/refine-record.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 93 | span | `gh issue close` | `descriptive` |
| 180 | span | `gh issue edit {n} --add-label auto:build` | `cwd-scoped` |
| 182 | span | `gh issue edit {n} --body-file <temp file>` | `cwd-scoped` |
| 182 | span | `gh issue edit {n} --remove-label ready --add-label parked` | `cwd-scoped` |
| 183 | span | `gh issue close {n}` | `cwd-scoped` |
| 184 | span | `gh issue edit {n} --remove-label bot:blocked --add-label auto:build` | `cwd-scoped` |

### `plugin/skills/build/plan-audit.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 24 | span | `gh issue close` | `descriptive` |

### `plugin/skills/build/plan-review.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 103 | span | `gh issue comment {n} --body-file "{path}"` | `needs-fix` |
| 106 | span | `gh issue edit` | `descriptive` |
| 129 | span | `gh issue comment --body-file` | `needs-fix` |

Line 106 says the edit never runs.

### `plugin/skills/capture/SKILL.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 202 | span | `gh issue create` | `descriptive` |
| 236 | fence | `gh issue create --title "$TITLE" --body-file "/tmp/capture-${CLAUDE_CODE_SESSION_ID}-body.md" --type "$TYPE" -…` | `cwd-scoped` |
| 244 | fence | `gh issue create --title "$TITLE" --body-file "/tmp/capture-${CLAUDE_CODE_SESSION_ID}-body.md" --label by:capture` | `cwd-scoped` |
| 274 | fence | `gh issue create \` | `cwd-scoped` |
| 281 | span | `gh issue create` | `descriptive` |
| 284 | span | `gh issue create` | `descriptive` |
| 286 | span | `gh issue comment N --body-file "/tmp/capture-${CLAUDE_CODE_SESSION_ID}-open-pr-comment.md"` | `cwd-scoped` |
| 288 | span | `gh issue create` | `descriptive` |
| 291 | span | `gh issue create` | `descriptive` |

The issue is born from the bare create; `N` is the number it returned.

### `plugin/skills/capture/batch-mode.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 24 | span | `gh issue create` | `descriptive` |

### `plugin/skills/capture/routing.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 58 | span | `gh issue close {n} --reason "not planned"` | `cwd-scoped` |
| 62 | span | `gh issue edit {N} --body-file` | `cwd-scoped` |

### `plugin/skills/challenge/SKILL.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 97 | span | `gh issue edit {n} --body-file "{tmp}" --remove-label "solution:unjustified"` | `cwd-scoped` |
| 99 | span | `gh issue comment {n} --body-file "{tmp}"` | `cwd-scoped` |
| 99 | span | `gh issue edit {n} --remove-label "solution:unjustified"` | `cwd-scoped` |

### `plugin/skills/code-health/SKILL.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 349 | span | `gh issue create` | `descriptive` |
| 351 | span | `gh issue create` | `descriptive` |

### `plugin/skills/code-health/filing.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 17 | span | `gh issue create` | `descriptive` |
| 24 | span | `gh issue create` | `descriptive` |
| 34 | span | `gh issue create` | `descriptive` |
| 47 | fence | `#  ["code-health:filing-failed", "Escalation: gh issue create failed repeatedly for this fingerprint — needs human attention", "D93F0B"]]` | `descriptive` |
| 57 | fence | `gh issue reopen <issue_number>` | `cwd-scoped` |
| 58 | fence | `gh issue comment <issue_number> --body "Regressed: this finding reappeared. Run: ${RUN_ID}"` | `cwd-scoped` |
| 65 | span | `gh issue create` | `descriptive` |
| 67 | span | `gh issue create` | `descriptive` |
| 73 | fence | `gh issue create \` | `cwd-scoped` |
| 83 | fence | `gh issue create \` | `cwd-scoped` |
| 95 | span | `gh issue create --title/--body` | `descriptive` |
| 97 | span | `gh issue create` | `descriptive` |

Line 67 is the conditioning sentence; the create it runs is the fence at 73/83.

### `plugin/skills/demo/SKILL.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 276 | span | `gh issue edit --remove-label` | `descriptive` |
| 295 | span | `gh issue edit {n} --add-label demo:approved` | `cwd-scoped` |
| 295 | span | `gh issue close {n} --reason completed` | `cwd-scoped` |
| 297 | span | `gh issue edit {n} --add-label demo:changes-requested` | `cwd-scoped` |

`#N` is read with bare `gh issue view` (`entry-paths.md`).

### `plugin/skills/dispatch/grant-maturation-gate.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 77 | fence | `gh issue edit {n} --remove-label auto:merge-pending --add-label auto:merge` | `cwd-scoped` |

### `plugin/skills/dispatch/queue-pull-script.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 492 | fence | `echo "gh issue comment ${NUM} --body \"Closing: the named target ${TPATH} no longer exists at ${INTEGRATION_REF} — t…` | `descriptive` |
| 493 | fence | `echo "gh issue close ${NUM} --reason \"not planned\""` | `descriptive` |
| 608 | fence | `` 'Comment then close: \`gh issue close ' + entry.number + ' --comment "Deliverables already shipped by #' + entry.pr + '"\`', `` | `descriptive` |

Lines 492-493 are `echo`ed into a staged Close proposal; line 608 is a string a Node script writes into one. `tidy --approve` runs those commands later — see "Descriptive rows that stage a bare write" for 608.

### `plugin/skills/dispatch/settle-and-merge.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 20 | span | `gh issue edit --remove-label` | `descriptive` |
| 29 | span | `gh issue comment` | `descriptive` |
| 29 | span | `gh issue close` | `descriptive` |
| 29 | span | `gh issue edit --add-label` | `descriptive` |
| 124 | fence | `gh issue edit "$ISSUE" --remove-label auto:merge` | `needs-fix` |
| 127 | fence | `gh issue edit "$ISSUE" --remove-label auto:merge-pending` | `needs-fix` |
| 212 | fence | `gh issue comment "$ISSUE" --body-file "$ATTEMPT_COMMENT_BODY"` | `needs-fix` |

Lines 20 and 29 are the MCP mapping. The revocation and comment re-read labels and comments bare (`{owner}/{repo}`), but step 2's `release-claim.js` exit `4` skips them, so they rest on its origin-resolved read.

### `plugin/skills/docs-health/SKILL.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 155 | span | `gh issue create` | `descriptive` |
| 162 | span | `gh issue create` | `descriptive` |
| 177 | fence | `gh issue reopen <issue_number>` | `cwd-scoped` |
| 178 | fence | `gh issue comment <issue_number> --body "Regressed: this finding reappeared. Run: ${RUN_ID}"` | `cwd-scoped` |
| 183 | span | `gh issue create` | `descriptive` |
| 196 | fence | `#  ["docs-health:filing-failed", "Escalation: gh issue create failed repeatedly for this fingerprint — needs human attention", "D93F0B"]]` | `descriptive` |
| 205 | span | `gh issue create` | `descriptive` |
| 211 | fence | `gh issue create --title "<payload.title>" --body "<payload.body>" --type task \` | `cwd-scoped` |
| 215 | fence | `gh issue create --title "<payload.title>" --body "<payload.body>" \` | `cwd-scoped` |
| 223 | span | `gh issue create` | `descriptive` |
| 277 | span | `gh issue create` | `descriptive` |

The dedup read is a bare `gh issue list --label by:docs-health`.

### `plugin/skills/feedback/SKILL.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 41 | span | `gh issue create` | `descriptive` |
| 406 | span | `gh issue create` | `descriptive` |

### `plugin/skills/feedback/pre-confirmed.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 40 | span | `gh issue create` | `descriptive` |

### `plugin/skills/feedback/session-evaluation.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 90 | fence | `` // `gh issue create` this run — filedRecords.length, carried `` | `descriptive` |
| 93 | fence | `` issueUrls,               // the URLs Step 8's `gh issue create` calls produced for this run's `` | `descriptive` |

### `plugin/skills/feedback/upstream-draft.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 229 | fence | `gh issue create --repo <owner/name> --title '<title>' --body-file <absolute path>` | `descriptive` |

A hand-off command for a human; it carries `--repo`, but `descriptive` wins.

### `plugin/skills/flow/failure-cards.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 24 | fence | `gh issue comment "$ISSUE" --body "Blocked at {gate}: {one-line reason}. Run {runId}; claim active until {expiry} unless released."` | `needs-fix` |
| 36 | span | `gh issue edit "$ISSUE" --remove-label bot:in-progress` | `needs-fix` |

### `plugin/skills/flow/multispec-console-template.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 133 | fence | `` Issues resolved without a merge (wontfix/duplicate) list a manual `gh issue close` command `` | `descriptive` |
| 147 | fence | `` …Queue writes section. The exact write mechanism (`gh issue create` / `local-store.js`, or — for a skill not yet migrated onto the unified record system — its ow… `` | `descriptive` |

### `plugin/skills/flow/multispec-dependency-ordering.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 74 | fence | `gh issue view {n} --json body -q .body \| grep -vE "^Blocked by #{blocker}([^0-9]\|$)" \| gh issue edit {n} --body-file -` | `descriptive` |

The line sits in the `unlanded` stop card, an escape a human runs.

### `plugin/skills/flow/multispec-review-console.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 150 | span | `gh issue create` | `cwd-scoped` |
| 221 | span | `gh issue edit "$ISSUE" --add-label parked` | `needs-fix` |

Line 150 creates a new record from a staged file; nothing reads it first.

### `plugin/skills/harness-health/SKILL.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 70 | span | `gh issue create` | `descriptive` |
| 269 | span | `gh issue create` | `descriptive` |

### `plugin/skills/harness-health/filing.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 35 | span | `gh issue create` | `descriptive` |
| 42 | span | `gh issue create` | `descriptive` |
| 52 | span | `gh issue create` | `descriptive` |
| 66 | fence | `#  ["harness-health:filing-failed", "Escalation: gh issue create failed repeatedly for this fingerprint — needs human attention", "D93F0B"]]` | `descriptive` |
| 74 | fence | `gh issue reopen <issue_number>` | `cwd-scoped` |
| 75 | fence | `gh issue comment <issue_number> --body "Regressed: this finding reappeared. Run: ${RUN_ID}"` | `cwd-scoped` |
| 84 | span | `gh issue create` | `descriptive` |
| 90 | fence | `gh issue create --title "<payload.title>" --body "<payload.body>" --type task \` | `cwd-scoped` |
| 94 | fence | `gh issue create --title "<payload.title>" --body "<payload.body>" \` | `cwd-scoped` |
| 100 | span | `gh issue create --title/--body` | `descriptive` |
| 102 | span | `gh issue create` | `descriptive` |

The dedup read is a bare `gh issue list --label by:harness-health`.

### `plugin/skills/harness-health/routine-relevance-analysis.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 55 | span | `gh issue create` | `descriptive` |

### `plugin/skills/help/context-flow.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 55 | span | `gh issue create` | `descriptive` |

### `plugin/skills/init/bootstrap/step-16-non-default-branch-issue-tracking.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 42 | span | `gh issue close` | `descriptive` |

### `plugin/skills/journey-health/SKILL.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 157 | span | `gh issue create` | `descriptive` |
| 164 | span | `gh issue create` | `descriptive` |
| 174 | span | `gh issue create` | `descriptive` |
| 183 | fence | `gh issue reopen <issue_number>` | `cwd-scoped` |
| 184 | fence | `gh issue comment <issue_number> --body "Regressed: this finding reappeared. Run: ${RUN_ID}"` | `cwd-scoped` |
| 193 | span | `gh issue create` | `descriptive` |
| 199 | fence | `gh issue create --title "<payload.title>" --body "<payload.body>" --type task \` | `cwd-scoped` |
| 203 | fence | `gh issue create --title "<payload.title>" --body "<payload.body>" \` | `cwd-scoped` |
| 207 | fence | `gh issue create --title "<payload.title>" --body "<payload.body>" --type bug \` | `cwd-scoped` |
| 211 | fence | `gh issue create --title "<payload.title>" --body "<payload.body>" \` | `cwd-scoped` |
| 217 | span | `gh issue create --title/--body` | `descriptive` |
| 219 | span | `gh issue create` | `descriptive` |
| 266 | span | `gh issue create` | `descriptive` |

The dedup read is a bare `gh issue list --label by:journey-health`.

### `plugin/skills/pipeline-smoke-test/SKILL.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 76 | span | `gh issue close {n} --comment "pipeline-smoke-test cleanup — {RUN_ID}"` | `cwd-scoped` |

The close runs "regardless" of the sibling `release-claim.js` call, and the record is read with bare `gh issue view`.

### `plugin/skills/reflect/full-mode.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 397 | span | `gh issue create` | `cwd-scoped` |
| 397 | span | `gh issue create` | `descriptive` |

### `plugin/skills/release/SKILL.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 300 | span | `gh issue comment {N} …` | `descriptive` |
| 300 | span | `gh issue close {N} --reason completed` | `descriptive` |

Paste-ready recovery lines for a human.

### `plugin/skills/release/bookkeeping.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 33 | span | `gh issue comment N --body-file {file}` | `cwd-scoped` |
| 38 | span | `gh issue close N --reason completed` | `cwd-scoped` |
| 94 | span | `gh issue close` | `descriptive` |

Step 1 reads state with bare `gh issue view` and `gh api repos/{owner}/{repo}/…`.

### `plugin/skills/review/cross-spec-promise-check.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 25 | span | `gh issue edit $PARENT_NUM --body-file` | `needs-fix` |
| 26 | span | `gh issue comment $PARENT_NUM --body "F{n} satisfied by #{this-record}: {one-line why}."` | `needs-fix` |

The `native` branch names no transport for its parent read; the `body-text` branch reads `Parent: #N` from the materialized record body.

### `plugin/skills/review/step3-routing.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 110 | span | `gh issue create` | `cwd-scoped` |
| 110 | span | `gh issue create` | `descriptive` |

### `plugin/skills/specify/SKILL.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 79 | span | `gh issue edit --remove-label …` | `cwd-scoped` |
| 81 | span | `gh issue edit --remove-label …` | `cwd-scoped` |

### `plugin/skills/specify/decomposition-mode-closeout.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 133 | fence | `…solution-file "$RA_RESOLUTION" --out "$RA_OUT" && gh issue edit {n} --body-file "$RA_OUT"` | `cwd-scoped` |
| 136 | span | `gh issue edit {n} --add-label ready` | `cwd-scoped` |
| 142 | span | `gh issue comment "$ORIGIN_RECORD_NUM" --body "..."` | `cwd-scoped` |
| 142 | span | `gh issue close "$ORIGIN_RECORD_NUM"` | `cwd-scoped` |

### `plugin/skills/specify/design-pre-steps.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 164 | span | `gh issue edit` | `descriptive` |

### `plugin/skills/specify/next-mode-shape.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 78 | span | `gh issue edit {n} --add-label "needs:definition"` | `cwd-scoped` |
| 80 | span | `gh issue edit` | `descriptive` |
| 95 | fence | `gh issue comment {n} --body-file "{tmp}"` | `cwd-scoped` |

### `plugin/skills/specify/record-creation-linking.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 19 | span | `gh issue edit --body-file` | `cwd-scoped` |
| 60 | span | `gh issue edit $PARENT_NUM --body-file` | `cwd-scoped` |
| 61 | span | `gh issue edit $SUB_ISSUE_NUM --body-file` | `cwd-scoped` |
| 79 | span | `gh issue edit` | `descriptive` |
| 79 | span | `gh issue comment` | `descriptive` |
| 87 | span | `gh issue comment $PARENT_NUM --body "Cross-Spec Promises seeded: {count} forward reference(s) at decomposition time."` | `cwd-scoped` |

### `plugin/skills/specify/record-creation-subissues.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 25 | span | `gh issue edit "$ORIGIN_RECORD_NUM" --body-file` | `cwd-scoped` |
| 39 | span | `gh issue create` | `descriptive` |
| 41 | span | `gh issue create` | `descriptive` |
| 115 | fence | `SUB_ISSUE_URL=$(gh issue create --title "$SUB_ISSUE_TITLE" --body-file "$SPECIFY_SUB_ISSUE_BODY" \` | `cwd-scoped` |
| 120 | fence | `SUB_ISSUE_URL=$(gh issue create --title "$SUB_ISSUE_TITLE" --body-file "$SPECIFY_SUB_ISSUE_BODY" \` | `cwd-scoped` |
| 209 | span | `gh issue edit {num} --body-file` | `cwd-scoped` |
| 211 | span | `gh issue create` | `descriptive` |

### `plugin/skills/specify/record-creation.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 91 | span | `gh issue create --label` | `descriptive` |
| 109 | span | `gh issue create` | `descriptive` |
| 109 | span | `gh issue edit` | `descriptive` |
| 132 | fence | `PARENT_URL=$(gh issue create --title "$PARENT_TITLE" --body-file "$SPECIFY_PARENT_BODY" --type feature --label parent-issue)` | `cwd-scoped` |
| 134 | fence | `PARENT_URL=$(gh issue create --title "$PARENT_TITLE" --body-file "$SPECIFY_PARENT_BODY" --label type:feature --label parent-issue)` | `cwd-scoped` |

### `plugin/skills/specify/red-team.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 121 | span | `gh issue edit {ref} --remove-label ready` | `cwd-scoped` |
| 124 | span | `gh issue edit {subIssueNum} --body-file` | `cwd-scoped` |

### `plugin/skills/specify/shaping-mode-readback.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 64 | span | `gh issue edit` | `descriptive` |

### `plugin/skills/specify/shaping-mode-stamping.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 185 | fence | `gh issue edit {n} \` | `cwd-scoped` |

### `plugin/skills/specify/shaping-mode.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 184 | fence | `` **Command:** `gh issue close {n} --comment "Absorbed into #{candidate}"` `` | `descriptive` |

The `**Command:**` line of a decision comment, for a human.

### `plugin/skills/tidy/SKILL.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 137 | span | `gh issue close {n}` | `cwd-scoped` |
| 268 | span | `gh issue create` | `descriptive` |

### `plugin/skills/tidy/actions-github-issues.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 11 | span | `gh issue close {n} --reason "not planned"` | `cwd-scoped` |
| 15 | span | `gh issue edit {n} --body-file <temp file>` | `cwd-scoped` |
| 15 | span | `gh issue edit {n} --add-label parked` | `cwd-scoped` |
| 15 | span | `gh issue edit {n} --milestone "{name}"` | `cwd-scoped` |
| 21 | span | `gh issue close {n} --reason "not planned"` | `cwd-scoped` |
| 158 | span | `gh issue create --title ... --body-file ... --label ...` | `cwd-scoped` |
| 158 | span | `gh issue create` | `descriptive` |

### `plugin/skills/tidy/console-backfill.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 84 | span | `gh issue comment {n} --body-file "{path}"` | `cwd-scoped` |

### `plugin/skills/tidy/decision-markers.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 54 | fence | `gh issue comment "$ISSUE" --body-file "$COMMENT_FILE" \` | `needs-fix` |
| 55 | fence | `&& gh issue edit "$ISSUE" --add-label needs:decision \` | `needs-fix` |

For a finding from Step 1's bare snapshot the write would be `cwd-scoped`; the `[parent-gate]` finding shape puts the procedure in `needs-fix`.

### `plugin/skills/tidy/digest-sweep.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 31 | span | `gh issue edit {replacement} --add-label digest` | `descriptive` |
| 133 | span | `gh issue comment {replacement} --body "This issue was created by an identity whose marker the sweep does not trust, so the rollover did not proceed."` | `cwd-scoped` |
| 133 | span | `gh issue close {replacement} --reason "not planned"` | `cwd-scoped` |
| 146 | span | `gh issue comment {replacement} --body-file "{path}"` | `cwd-scoped` |
| 148 | span | `gh issue edit --remove-label` | `descriptive` |

Line 31 is named in the sweep report for a human; lines 133 and 146 follow `digest-rollover.js`, which reaches `gh` through `ghOptions` only (no origin slug), and `{owner}/{repo}` reads.

### `plugin/skills/tidy/issue-claims-backstops.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 120 | span | `gh issue edit {n} --add-label parked` | `descriptive` |
| 133 | span | `gh issue edit {n} --remove-label bot:in-progress` | `descriptive` |

Each row is a command recommended in a `[claim]` finding; this procedure does not run it.

### `plugin/skills/tidy/release-note-repair.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 123 | span | `gh issue edit {n} --body-file "{repaired-body}"` | `cwd-scoped` |
| 133 | span | `gh issue edit --body-file` | `descriptive` |
| 139 | span | `gh issue edit` | `descriptive` |
| 144 | span | `gh issue edit {n} --body-file "{snapshot}"` | `descriptive` |

Lines 139 and 144 are an offered undo for a human.

### `plugin/skills/tidy/scan-procedures.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 85 | span | `gh issue comment` | `descriptive` |
| 85 | span | `gh issue close` | `descriptive` |

Names the commands a staged Delete proposal carries; `tidy --approve` runs them later, against records from Step 1's bare snapshot.

### `plugin/skills/tidy/step-1-records.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 83 | span | `gh issue close --reason "not planned"` | `descriptive` |

### `plugin/skills/wrap-up/auto-merge-short-circuit.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 54 | fence | `gh issue edit {n} --remove-label auto:merge-pending --add-label auto:merge` | `cwd-scoped` |

The promotion rests on the live bare `gh issue view --json labels,comments`, never the pack snapshot.

### `plugin/skills/wrap-up/cleanup-procedures-execution.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 461 | span | `gh issue edit "$ISSUE" --add-label parked` | `needs-fix` |

### `plugin/skills/wrap-up/console-template.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 159 | fence | `` write mechanism (`gh issue create` / `local-store.js`, or — for a skill not yet migrated onto `` | `descriptive` |

### `plugin/skills/wrap-up/docs-health-integration.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 65 | span | `gh issue create` | `descriptive` |

### `plugin/skills/wrap-up/execution-and-verification.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 17 | span | `gh issue create` | `descriptive` |

### `plugin/skills/wrap-up/flags.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 5 | span | `gh issue create` | `descriptive` |
| 5 | span | `gh issue edit` | `descriptive` |
| 5 | span | `gh issue comment` | `descriptive` |

### `plugin/skills/wrap-up/ledger-narrowing-auto-file.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 9 | span | `gh issue create` | `cwd-scoped` |

The span wraps between `gh issue` and `create`; `git grep` cannot see it.

### `plugin/skills/wrap-up/leftover-routing.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 78 | span | `gh issue create` | `cwd-scoped` |

### `plugin/skills/wrap-up/review-console.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 19 | span | `gh issue create` | `descriptive` |
| 118 | span | `gh issue create` | `cwd-scoped` |
| 118 | span | `gh issue create` | `descriptive` |

Line 118's first span creates a new record from a staged file; nothing reads it first.

### `plugin/skills/wrap-up/verification-brief-parent-gate.md`

| Line | Kind | Command | Class |
|---|---|---|---|
| 70 | span | `gh issue comment --repo` | `descriptive` |
| 70 | span | `gh issue close --repo` | `descriptive` |
| 71 | span | `gh issue edit --repo --add-label` | `descriptive` |
| 461 | fence | `gh issue comment $PARENT_NUM --repo "{parent-repo}" --body-file "{parent-close-comment}"` | `repo` |
| 469 | fence | `gh issue close $PARENT_NUM --repo "{parent-repo}" --reason completed` | `repo` |
| 477 | fence | `gh issue close $PARENT_NUM --repo "{parent-repo}" --reason "not planned"` | `repo` |
| 649 | fence | `gh issue edit $PARENT_NUM --repo "{parent-repo}" --add-label demo:pending` | `repo` |
| 660 | fence | `gh issue comment $PARENT_NUM --repo "{parent-repo}" --body-file "$PARENT_VERIFICATION_BRIEF"` | `repo` |
| 661 | fence | `gh issue edit $PARENT_NUM --repo "{parent-repo}" --add-label demo:pending` | `repo` |

Lines 70-71 are the Transport paragraph, which only names commands, so `descriptive` wins over their `--repo`.
