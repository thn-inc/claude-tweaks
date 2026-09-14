---
name: dispatch
description: "Use to select and dispatch authorized GitHub records to /flow — the gate-to-executor queue consumer. Drain (--budget) or #N direct. Keywords - dispatch, queue, claim, auto:build, auto:merge, bot:in-progress, bot:blocked, bot:parked, autonomous build, routine."
argument-hint: "[#N[,#M...]] [--budget <n|all>] [--priority high|medium|low]"
---

# Dispatch — the Queue Consumer

The thin protocol wrapper between the authorization gate and the executor: select → mint run dir → invoke /flow (claims + executes) → settle. Sits outside the main brainstorm-to-build chain, downstream of the gate:

```
capture / code-health / harness-health / journey-health / docs-health   (file records)
                              │
                              v
                /claude-tweaks:specify   (shapes to ready)
                              │
                              v
                  /claude-tweaks:backlog refine   (grants auto:build / auto:merge)
                              │
                              v
              [ /claude-tweaks:dispatch ]   <- utility (no fixed lifecycle position)
                              │
                              v
          /claude-tweaks:flow #{n}[,#{m}...]   (claims whole group, executes)
                              │
                              v
                    close-via-merge   (record closes)
```

## When to Use

- Something is already authorized (`auto:build`, optionally `+ auto:merge`) and you want to build it now — run bare `/dispatch` to drain up to `--budget` authorized groups headlessly, or `/dispatch #N` for a specific record.
- A scheduled Routine fires bare `/claude-tweaks:dispatch --budget 1` for a single, deterministic unit of headless work on a cadence.
- A prior dispatched build failed and you want the retry/ceiling bookkeeping to run — this happens automatically inside the Settle step (Step 6), not as a separate invocation.

Not for: granting authorization (`/claude-tweaks:backlog refine`'s job), deriving a spec, or building anything yourself. Dispatch only ever mints, hands off to `/claude-tweaks:flow` (which claims), and settles the result.

**Drain, without a console (refs #1492).** Bare `/dispatch` is the drain: it repeats single-group dispatch up to `--budget` times instead of a human picking a batch. Each group still dispatches and reports on its own (Step 5, Reporting) — no console aggregates outcomes across a firing, the retired design's reason for existing. See `design-notes.md` in this skill's directory for that history.

## Input

`$ARGUMENTS`:

| Argument | Behavior |
|---|---|
| *(none)* | Bare — headless drain: repeat the select-and-dispatch procedure (Step 3's ranking + Steps 4-6) over ranked authorized groups until `--budget <n\|all>` groups have been attempted or the ranked set is empty. Each iteration re-fetches the authorized queue fresh (Step 2) — dispatched groups leave it by claim, and a Settle-failed group's records carry `bot:blocked`/claim markers so it is never re-selected, while still counting as one attempted budget unit. No `AskUserQuestion` fires — an interactive (human-present) bare invocation drains immediately, identically to a headless firing, **with no exception for a detected repo-wide infra outage** (#2365) — see the Repo-wide infra outage stop paragraph below instead. |
| `next` (deprecated alias) | Deprecated alias for `--budget 1` — identical effect (one group selected by priority-then-age ranking), one warn-tier notice. Removal condition: `deprecated-aliases.md`. |
| `#N` | Direct — select + dispatch record `#N`'s whole file-overlap group |
| `#N,#M,...` | Explicit list — select + dispatch each named record's whole file-overlap group, deduplicated; skips ranking/selection entirely since the set is already named |
| `--budget <n\|all>` (modifier) | Suffix bare drain only — per-firing override of `dispatch-batch-size` (canonical `n`/`all` semantics: `_shared/record-batch-input.md`'s `--budget` section). Combined with `next`/`#N,#M,...`: **rejected** (bare-drain-only; `next` already means `--budget 1`). Highest-precedence per `_shared/auto-mode-card.md`. |
| `--batch-size <n>` (deprecated alias) | Deprecated alias for `--budget <n>` — same effect, one warn-tier notice. Removal condition: `deprecated-aliases.md`. The old suffix `#N,#M,...` use is no longer accepted — rejected like `--budget` on an explicit list; explicit-list firings are capped by `dispatch-batch-size` alone. |
| `--concurrent <n>` (deprecated alias) | Two-hop deprecated alias for `--batch-size <n>` — same effect, one warn-tier notice. Removal condition: `deprecated-aliases.md`. |
| `--priority <high\|medium\|low>` (modifier) | Suffix bare drain (or its deprecated `next` alias) — restrict the candidate pool's representative-member band before ranking/selection runs (Step 3's ranking definition). Lets multiple differently-scheduled Routines each own a distinct slice of the queue. No effect on `#N`/`#N,#M,...`, which select by explicit name, not ranking. |

**Repo-wide infra outage stop (#2365).** Bare drain's no-`AskUserQuestion` rule (Input table above) has no carve-out — not for a detected infra-wide emergency, not for anything else, human present or not. It is not defenseless either: `settle-and-merge.md` Step 6 point 3 already classifies each Settle failure as `correctness`/`ambiguous`/`transient` via `assess-agent-autonomy`'s `failure-check` mode, where `transient` means "infrastructure failure, not this record's fault." When **two or more groups in the same drain firing** land a `transient` classification, that repetition — not any single transient failure, which is ordinary and already handled by preserving `auto:merge`/`auto:merge-pending` per that step — is the repo-wide-outage signal: stop the remaining drain immediately (do not attempt further groups against `--budget`), and report the halt in this firing's own end-of-run output naming which groups hit it and each one's `assess-agent-autonomy` rationale. This reuses Settle's existing classification rather than inventing a new detection heuristic, and follows the same "report and stop, never ask" shape the Detection Ladder already uses for a real Preflight failure (`stop for any real failure`, above) — a repo-wide outage is a real failure, just one only visible after two groups have independently hit it.

## Preflight

> The local-files stop paragraph below follows the canonical pattern in `_shared/local-files-preflight-stop.md` — do not weaken its enumeration, no-exception clause, or auto-mode disclaimer when editing.

Read the project's `work-backend` config key (per `_shared/work-record-config.md`, the key table's canonical home). **`work-backend: local-files`** — report that headless dispatch is github-issues only (GitHub's RBAC + atomic content writes are the mechanism this protocol depends on, not a policy choice) and **stop this turn completely**: do not invoke `/claude-tweaks:flow`, `/claude-tweaks:build`, or any other skill; do not claim, write, edit, or create any file; do not run any build, test, or git-committing command. Tell the user they can run `/claude-tweaks:flow` or `/claude-tweaks:build` manually against a chosen record if they want that work done — this is information for the user to act on, never an instruction for you to act on yourself. This holds with no exception when no interactive human is present to receive it, including a Routine-fired bare drain (or its deprecated `next` alias) (see Input table above): the absence of a human to hand this off to is not license to do the work in their place — it means the claim mechanism this protocol depends on is unavailable, so the correct behavior is to stop, not proceed. **This stop is also not superseded by this project's own documented auto-mode or hands-off-pipeline conventions elsewhere in CLAUDE.md** (e.g. `/claude-tweaks:flow` defaulting to `auto`, "skills MUST NOT invent new mid-flow stops"): those conventions govern behavior within a pipeline run that has already been authorized to proceed — they say nothing about whether this Preflight may authorize new work in the first place, which under `local-files` it explicitly cannot. A record that looks low-risk, well-scoped, or "ready" is not an exception. Only `work-backend: github-issues` proceeds past this point.

**Headless self-report (bare drain, incl. `next`).** Bare drain fires unattended — the unit a scheduled Routine fires with nobody present to read a stop message (see the Input table above). Before stopping on any Preflight failure (the `work-backend` checks above, or the Detection Ladder below), such a firing files a durable GitHub trace instead: read `_shared/headless-self-report.md` and follow it (caller = `dispatch`), then stop. It never softens the stop — it only leaves a record of it, deduplicated against any existing open report so repeated firings don't re-file.

Skip this entirely for the explicit `#N` / `#N,#M,...` forms — those always run with a human present (per the Input table above), so they just report the failing check and stop; self-filing is bare-drain/`next`-only.

Before any `gh`/MCP command, run the Detection Ladder from `_shared/forge-detection.md` (checks 1-3:
GitHub remote exists, `gh` CLI installed, `gh` authenticated + repo reachable). Check 1 (GitHub
remote exists) and check 3 (authenticated + reachable, evaluated against whichever transport
check 2 selects) stay hard gates — there is no meaningful degraded mode for a skill whose entire
purpose is writing GitHub state. Check 2 (`gh` CLI installed) no longer gates on its own: `gh`
present → proceed exactly as always; `gh` absent → proceed via the GitHub MCP path documented in
`mcp-transport.md` in this skill's directory (and, for Settle and the Auto-merge gate, in
`settle-and-merge.md`) — verified end-to-end against a live cloud Routine run (was
`docs/superpowers/plans/2026-08-02-dispatch-mcp-bridge.md`, deleted `d83f0720`). Report the specific failing check and
stop for any real failure (headless self-report above still applies for bare drain, incl. its `next` alias).

**MCP transport details.** When `gh` is absent, read `mcp-transport.md` in this skill's directory
before any GitHub call: it carries check 3's own MCP equivalent (a bounded `list_issues` probe, since
check 3 stays a hard gate on either transport) and the MCP form of every `gh` call site in this
file. It also records why check 2 no longer gates on its own, including the reverted first attempt
at this bridge that shipped the gate change before the read path was finished.

## Workflow

### Step 1: Resolve this firing's run id

Resolve this firing's `$RUN_ID` once, before Step 2, via the standalone-auto run-dir resolution in `_shared/run-dir-resolution.md` (dispatch is on the allowlist) — `$RUN_ID` is that run directory's basename (e.g. `2026-07-14T140322-dispatch-standalone`). This value scopes only this firing's own `decisions.md` (queue pull, selection, per-group minting log) — it is never a claim's `runId` and never passed to a Task call. Each *group's* claim identity is a separate value, minted per group in Step 4 (`$GROUP_RUN_ID`) and passed to both of that group's Task calls as `PIPELINE_RUN_DIR` (Task agents don't inherit shell variables — per `_shared/subagent-output-contract.md`'s Input Discipline, a dispatched agent is a clean room). Step 6's ownership check (`claim.runId === basename($PIPELINE_RUN_DIR)`) — performed inside whichever of that group's two Task calls handles its terminal outcome (the first call on a `build,test` failure, the second on every path that reaches wrap-up), never in this thread — compares against that group's own minted directory, not this firing's `$RUN_ID`.

### Step 2: Pull the authorized queue and group by file overlap

First action, before the pool is read: `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" reconcile --json` — converges the main checkout toward origin (`bin/lib/reconcile`, #407) so the queue pull below reads already-current state instead of racing a stale mirror. `--json` is required here, not the plain `reconcile` default (#638's compact summary) — this call site parses the result's `console.ready` array below, which the compact default doesn't expose in a machine-readable shape. Dispatch runs from a worktree under `worktree-always`; the verb still converges the *main checkout's* mirror regardless (`mainCheckoutRoot` resolution), the same as `session-start.js`'s own in-process call. Use an explicit, generous timeout (150000ms+) — an unscoped sweep took ~2 min, backgrounding and once stranding a firing (#1543). Stays unscoped (no `--checks`): narrowing risks skipping a check queue-pull needs. Log the JSON result to `decisions.md`. When the result's `console.ready` array is non-empty, follow `_shared/console-execution.md` for each entry before continuing to the queue pull — an answered console is real, actionable work this firing is well-positioned to pick up.

Common to every selection form — group membership must be computed over the full current pool *before* anything is claimed (per `_shared/issue-claims.md`'s group-claim rule: group membership is computed over **unclaimed** records only, so two racing firings converge on the same winner instead of splitting a group between them).

The queue: **open + `auto:build` + no `bot:*` + no open `Blocked by #N` dependency + no open linked PR (#1224) + not already shipped by a `strong`-tier merged-PR mention (#1984) + unclaimed**. Dispatch never adds `auto:build`, `auto:merge`, or `ready` (the Auto-merge gate's promotion of an already-existing `auto:merge-pending` to `auto:merge` is maturation of a grant already present, not origination — see `settle-and-merge.md`) — see Anti-Patterns.

**False-positive posture (#1984).** A record whose full deliverable set is already shipped, but
whose resolving PR never carried a closing keyword, can only be excluded here when a **merged**
PR both mentions it AND either matches its title (Jaccard token similarity) or touches every path
in its own `### Key Files` — two independent signals, never one alone. That exclusion costs one
human approval (the staged Close proposal `queue-pull-script.md` stages, never an autonomous
close) — it is never silent and it never removes a candidate from `dispatch-groups.json` without
also naming the reason in this run's session-scoped `dispatch-exclusions.json` (`reason:
'shipped'`, `bin/lib/dispatch/exclusions.js`). A `weak`-tier mention (the base signal
alone — merged, no second signal) never blocks: the record stays fully eligible, with the mention
carried forward as build-time context. The residual false negative — a resolving PR that never
mentions the record at all, by number or otherwise — is accepted: there is no signal left to
detect it from, and the status quo (dispatch discovers it at build time) is the existing, already-
safe fallback this record improves on rather than replaces.

Read `queue-pull-script.md` in this skill's directory and run its script verbatim — it produces this run's session-scoped `dispatch-groups.json` (`_shared/session-tmp-root.md`), which every selection form below reads. That file also carries the MCP-path substitution and the queue-pull-notes pointer.

The `bot:*` filter here is the cheap label-based pre-filter — labels are projection, not truth (`_shared/work-record.md`). The authoritative unclaimed check is `/claude-tweaks:flow`'s Step 2.8 atomic 201/422 claim attempt (`flow/claim-targets.md`) — a record can pass this pre-filter and still turn out contested by the time the first Task call actually claims it. A group of size 1 is a **singleton**; size 2+ is a **bundle** — both dispatch the same way in Step 5, with a different `/claude-tweaks:flow` invocation shape only.

### Step 3: Select

**Zero eligible groups (all forms).** Step 2's `groups` array can legitimately be empty — the common steady state right after a dispatch drain, or after an `auto:build` queue with nothing new authorized since the last firing. This is not an error: report "nothing eligible this firing" and stop before Step 4 — do not proceed with a `null` pick (the drain's current iteration finding nothing left to rank, or `next`'s ranking script below writing `null` to this run's session-scoped `dispatch-next-pick.json` — `_shared/session-tmp-root.md` — for this case). A headless drain (or `next`) firing with no eligible groups is a cheap no-op, per `routine-template.yml`'s own notes — report nothing and exit cleanly, no self-report, no `PushNotification`.

**Blocked-exclusion report (refs #1101).** See `blocked-exclusion-report.md`, this skill's directory (same convention as the Open-PR exclusion report below; not a gate — the exclusion itself already happened inside `queue-pull-script.md`).

**Open-PR exclusion report (refs #1224).** See `open-pr-exclusion-report.md`, this skill's directory (same convention as the Blocked-exclusion report above; not a gate — the exclusion itself already happened inside `queue-pull-script.md`).

**Shipped-candidate exclusion report (refs #1984).** Read this run's session-scoped
`dispatch-exclusions.json` (`queue-pull-script.md`'s output, `bin/lib/dispatch/exclusions.js`'s
`readExclusions`), filtered to `reason: 'shipped'` entries (`records: [number], detail: {pr,
signals}` each). Non-empty: render one line per entry — `#{number} excluded — already shipped by
merged PR #{pr} ({signals}); a Close proposal is staged in this firing's run dir for approval.` —
same non-gating, already-happened-in-`queue-pull-script.md` convention as the two reports above. A
`weak`-tier mention never appears here — see the False-positive posture paragraph above.

**Oversized-group report (refs #1228).** See `oversized-group-report.md`, this skill's directory (groups over the size guard stay selectable via `#N`/`#N,#M,...`; not a gate).

**Cross-PR root-cause overlap report (refs #1579).** See `cross-pr-overlap-report.md`, this skill's directory (warning only, never a gate).

**Near-duplicate candidate warning (refs #1944).** `queue-pull-script.md`'s final step runs
`bin/lib/issues/near-duplicate.js`'s `findNearDuplicates` pairwise across every pair of records
landing in *different* file-overlap groups, logging one `AUTO — dispatch: near-duplicate
candidates across groups: #A / #B ({signals})` line per firing pair to stderr. Same-group pairs
are already co-built together by Step 2's grouping and have nothing new to warn about. Warning
only, never a gate — no selection change; a same-group pair (already covered by
`groupByFileOverlap`) never re-fires here.

**Bare (drain)** `/dispatch` — headless, no `AskUserQuestion` (skip this and the rest of Step 3 if the zero-groups case above applies). Resolve `{budget}`: `--budget <n|all>` if present (or its deprecated `--batch-size <n>`/`--concurrent <n>` aliases, each with its own notice), else `dispatch-batch-size` (or its deprecated `dispatch-pick-max-concurrent` key, same notice) — CLI arg beats project policy per `_shared/auto-mode-card.md`. `n` = attempt count; `all` drains to empty. `--budget` + `next`/`#N,#M,...`: **rejected with one notice** (bare-drain-only; `next` already means `--budget 1`).

Loop: run the `next` ranking below (`next-ranking.md` verbatim, oversized and this-firing-excluded groups excluded via the unified `dispatch-exclusions.json` — maintain per `firing-exclusion.md`, this skill's dir) → dispatch the pick through Steps 4-6 → re-run Step 2's queue pull → repeat until `{budget}` attempts or the ranking returns `null`. Report each iteration as it completes, plus a final line naming groups still eligible but undispatched at budget exhaustion.

**`next` (deprecated alias for `--budget 1`)** — one warn-tier notice (removal condition: `deprecated-aliases.md`); no human decision. Pick exactly ONE group by this ordering: `priority:high` > `priority:medium` > `priority:low` > unprioritized, oldest-first within each band — **a group's rank is its highest-priority (then oldest) member**, taken as its representative. `--priority <band>` (Input table above), when present, filters to matching-band representatives before ranking, letting differently-scheduled Routines each own a queue slice. Also excludes oversized groups (#1228) outright — a headless firing can't see that report, so this ranking must never auto-select one. Read `next-ranking.md` and run it verbatim; it writes the pick (or `null`) to `dispatch-next-pick.json`. The drain loop reuses this ranking each iteration; a Routine now fires bare `--budget 1` (Routine Configuration below), not `next`.

**`#N`** — direct. Fetch issue `#N`, confirm it currently carries `auto:build` and no `bot:*` label (re-verify against Step 2's live queue, not a cached table); if it doesn't qualify, report why (no grant, already claimed, or blocked) and stop. A record that clears those label checks but is absent from Step 2's `dispatch-groups.json` was dropped by the open-linked-PR exclusion (#1224), which removes candidates from that file before any selection form reads it: read this run's session-scoped `dispatch-exclusions.json`, filtered to `reason: 'open-pr'`, report that reason by name — `#{N} already has an open PR (#{pr}) — not re-dispatch-eligible until that PR merges or closes` — and stop. Otherwise pull its **whole file-overlap group** from Step 2's output — claiming a single member of a group alone is forbidden; every one of that record's overlap partners comes along, whether or not the user named them.

**`#N[,#M,#O...]`** — explicit list (grammar: `_shared/record-batch-input.md`). Parse via `parseExplicitIssueList` (`bin/lib/issues/grouping.js`) → `{ numbers, invalid }` (report `invalid` in one message; proceed with `numbers`, never aborting over one bad element). Call `selectGroupsForExplicitList(numbers, groups)` (same file) against Step 2's already-computed `groups` array. Report every entry in the returned `notFound` list with why it's excluded — no `auto:build` grant, already claimed, `bot:blocked`, or already covered by an open linked PR (#1224 — name the PR from this run's session-scoped `dispatch-exclusions.json`, filtered to `reason: 'open-pr'`, the same file the Open-PR exclusion report reads) — but do not abort the rest of the named set over one excluded entry. Every group in the returned `selectedGroups` proceeds to Step 4, still bound by `dispatch-batch-size` (extra groups remain unclaimed in the queue for a later firing to select). The selection is already explicit — Step 3's ranking never runs for this form.

### Step 4: Mint the selected group's run directory

**Sibling-session check, before any write** — run `check-sibling-sessions --record` per group
member and branch on its output; read `sibling-session-check.md` in this skill's directory and
follow it.

**Cross-PR overlap re-check against this drain's own in-flight PRs (refs #1985), for every group
after the first.** Read `drain-pr-overlap.md`'s "Step 4" section, this skill's directory, and
follow it before minting below — a warning only, never a gate.

**Mint this group's run directory.** This group's **representative record** is its
lowest-numbered member (the same rule `_shared/pr-early-run-lifecycle.md` already uses for a
bundle's PR title). Run `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --spec-slug
"record-{representative}" --create` (`_shared/pipeline-run-dir.md`'s Anchoring section — mkdir
only: no `config.yml`, no `decisions.md`, and no claim written here either). The directory's
`{ISO-timestamp}` prefix is UTC, per `_shared/run-dir-resolution.md`'s ISO-timestamp rule
(`date -u`) — `resolve-run-dir` mints it, this step never composes it by hand. Call the result
`$GROUP_RUN_DIR`; `$GROUP_RUN_ID` is its basename. Log one line to this firing's own
`decisions.md` (Step 1's standalone dir, not this new one): `AUTO {time} — Step 4: minted {$GROUP_RUN_DIR} for group [{issue list}]{, naming it a fast-lane bundle when this group's member set
matches an entry in dispatch-fastlane-bundles.json — see reporting.md for the full wording}.`
A minted-but-never-claimed directory is reclaimed by
the reconciler's archive sweep (`bin/lib/reconcile/archive-merged.js`'s `isOrphanedMint`
criterion) once its TTL elapses.

Nothing else happens in this step. Claiming, the `bot:in-progress` bootstrap, and the claim
comment all live in `/claude-tweaks:flow`'s Step 2.8 (`flow/claim-targets.md`), which the group's first Task
call reaches under the identity this mint establishes — handing both Task calls the same
directory to claim under is this step's whole purpose. Proceed to Step 5.

This group's own file-overlap membership was already fixed by Step 2's `groupByFileOverlap` queue
pull (`queue-pull-script.md`) — the same primitive `bin/preflight-records.js`'s `overlapGroups`
field derives, for a caller needing that grouping outside dispatch's own queue-pull path (e.g.
`/claude-tweaks:flow`'s own multi-spec pre-flight, `multi-spec.md`'s Validation step 3). This step re-derives
nothing; it only mints a directory for the group Step 2 already computed.

### Concurrency note (Preflight reads, not claim correctness)

Two firings running close together each do their own unsynchronized Preflight read, so one can see different `work-backend` content than another purely from wall-clock timing. Accepted, not engineered around: it's self-correcting, and `/claude-tweaks:flow`'s Step 2.8 atomic claim write (inside the first Task call) — not the Preflight read, and not dispatch's own Step 4 mint — is the actual correctness boundary, so no concurrent Preflight check can cause a double-build. Read `design-notes.md` in this skill's directory.

### Step 5: Dispatch — one group at a time, sequentially

> **Sequential execution, not parallel.** A Task-tool subagent is always launched cwd-pinned to the dispatching session's own worktree, so two groups can never safely run concurrently (see #155) — the dispatching session itself switches worktrees between groups, one at a time. Read `sequential-execution.md` in this skill's directory for the full mechanism and the module a regression here should be checked against.

**When the dispatching session itself is a cwd-pinned subagent (#447).** When `/claude-tweaks:dispatch` is itself a Task/Agent-tool subagent, its own cwd is pinned too, and its worktree-entry attempt is refused for the same reason a dispatched call's `EnterWorktree` is — one level higher up the chain. Detect this before Step 5's loop starts by checking this session's own context for the cwd-pinned signal, not by waiting for a failed entry. On detection: still create the group's worktree with a plain `git worktree add` (a filesystem operation, not a cwd repin), but since this session's cwd cannot move there, neither Task call can inherit a worktree cwd from it — instead prefix every command in both calls' prompts with an explicit `cd {worktree-path} &&`, so nothing in the chain depends on a shell cwd nobody can set. A top-level dispatching session is unaffected.

Work through the selected group(s) in the order Step 3's selection already established — bare (and its deprecated `next` alias, itself `--budget 1`): Step 5 processes exactly one group per drain iteration; Step 3's own loop is the driver — re-fetch, rank, dispatch, repeat — and owns the `{budget}`/remainder accounting, not this step. `#N,#M,...`: up to `dispatch-batch-size` groups, unaffected by this migration; `#N`: exactly one. For each group in turn, **this dispatching session** creates and enters that group's worktree (via `/superpowers:using-git-worktrees`, exactly as a normal `/claude-tweaks:flow` invocation would) *before* dispatching that group's first Task call — every Task call dispatched for this group inherits that one cwd and must never create a worktree of its own. This session enters the next group's worktree only once this group's own dispatch sequence has reached its terminal point. Under `local-merge`, that also requires the worktree to have been torn down — always through wrap-up's own cleanup, never a raw removal (`[IL-116]`), which on a first-call failure means one further explicit `/claude-tweaks:flow {target} wrap-up` call, or (on `OUTCOME: ready-to-merge`) Step 6's own merge-and-cleanup via `settle-and-merge.md`'s Dispatching-session merge execution (local-merge fallback) section. Under `pr-first` (`_shared/integration-model.md`), the group's worktree deliberately outlives the firing on every outcome (`settle-and-merge.md`'s outcome-independent worktree constraint): the reconciler reaps it on merged-PR evidence once no live session holds it (`reap-merged.js` skips own-cwd and locked worktrees), so this session enters the next group's worktree without waiting for teardown — per-group worktrees are distinct by construction, so nothing collides. Never share a worktree path across groups. There is no per-group timeout, same posture as existing parallel-Task dispatch sites (e.g. `/help`'s Stage 1-7). See `sequential-execution.md` for the wall-clock trade-off this implies.

Pass `PIPELINE_RUN_DIR="{minted-run-dir}"` (this group's run directory, minted by Step 4 before
either call — `$GROUP_RUN_DIR`) inline on the `/claude-tweaks:flow` command line, as the
templates already show: a dispatched Task agent inherits no shell environment from this
session, so an export here would never reach it. Both of this group's Task calls receive the
identical value — there is no second, later run directory to bridge to. `/claude-tweaks:flow` Step 3 adopts
it (empty on the first call, initialized by the time the second call reads it), and
`/claude-tweaks:wrap-up`'s release step (`cleanup-procedures-execution.md` Section E) resolves the ownership check as
`basename($PIPELINE_RUN_DIR)` directly — the same directory the claim was written under, since
Step 4 minted this directory and `/claude-tweaks:flow`'s Step 2.8 (inside the first Task call) wrote the
claim's `runId` as this directory's own basename. See `_shared/issue-claims.md`'s
Identity section.

**Two Task() calls per group, not one.** The agent's job is now split: a first call runs `/claude-tweaks:flow {target} build,test` and stops; only on a clean `build-test-ok` outcome does a second, entirely fresh Task() call run `/claude-tweaks:flow {target} review,polish,wrap-up`. This gives the reviewing agent genuine conversational isolation from the build — a live dispatch test found build/test/review running in one continuous context, defeating `/claude-tweaks:review`'s own adversarial multi-lens contract.

**Singleton group** `[123]` — first call: `PIPELINE_RUN_DIR="{minted-run-dir}" /claude-tweaks:flow #123 build,test`. Second call (gated): `PIPELINE_RUN_DIR="{minted-run-dir}" /claude-tweaks:flow #123 review,polish,wrap-up`.

**Bundle group** `[123, 456]` — a granted record is already spec-shaped (`ready` + spec-shaped body per `_shared/work-record.md`); there is no per-member `/claude-tweaks:specify` pre-step to run first. First call: `PIPELINE_RUN_DIR="{minted-run-dir}" /claude-tweaks:flow "#123,#456" build,test`. Second call (gated): `PIPELINE_RUN_DIR="{minted-run-dir}" /claude-tweaks:flow "#123,#456" review,polish,wrap-up`.

**The gate between calls — read `two-call-gate.md` in this skill's directory and follow it.** Simpler than before: since both calls already carry the same minted `PIPELINE_RUN_DIR`, there is nothing to capture or derive from the first call's report between calls. The gate reduces to reading the first call's status line and `OUTCOME`: dispatch the second call only on `DONE`/`DONE_WITH_CONCERNS` **and** `OUTCOME: build-test-ok`. Anything else means the second call is never dispatched: leave Settle to the first call's own agent (it runs there, not in this thread — `settle-and-merge.md`), and tear down via `two-call-gate.md`'s terminal-path section.

Each group's two `Task()` prompts are defined in `task-prompt.md` in this skill's directory — read it and inline each call's content verbatim into its own `Task()` tool call (per `_shared/subagent-output-contract.md`'s input discipline: minimal input, literal output template inlined, no conversation history). Do not paraphrase or summarize either template; the exact wording is load-bearing for the four-value status line and output format contracts downstream skills parse.

**Before either call, resolve `task-prompt.md`'s own "Context pack" section (#1542)** once per group, and substitute it into both templates' `{context-pack}` placeholder — read that section for what it resolves and why.

**Record this group's own PR into the firing's drain-PR list (refs #1985).** Read
`drain-pr-overlap.md`'s "Step 5" section, this skill's directory, and follow it once either Task
call returns — this is the list Step 4's own re-check (above) reads for every group dispatched
after this one.

### Step 6: Settle — on pipeline failure, and the Auto-merge gate

Two conditional branches that don't run on the common clean pending-review path — a `/flow` HARD-GATE failure (Settle), or a group whose every member carries `auto:merge` or a matured `auto:merge-pending` reaching `/wrap-up`'s Review Console (Auto-merge gate). Read `settle-and-merge.md` in this skill's directory for the full procedure: Settle's ownership check, `assess-agent-autonomy` failure classification, retry-ceiling counting and `bot:blocked` escalation; the Auto-merge gate's two-layer check and acceptance labeling (both run inside the second Task call). Under `integration-model: pr-first` (`_shared/integration-model.md`), the second Task call also performs the merge itself, right there via `_shared/pr-first-merge.md` — `gh pr merge` needs no checkout, so there is no structural reason to split it out. Under `local-merge`, that split still applies: a Task-tool subagent cannot reach the main checkout (Step 5's sequential-execution note: cwd-pinned to its own worktree), so on `OUTCOME: ready-to-merge` this dispatching session runs the Dispatching-session merge execution (local-merge fallback) section itself, right here in Step 6, before entering the next group's worktree.

## Reporting

Read `reporting.md` in this skill's directory for the per-firing output shape, the per-group timing line, headless self-report behavior, `pending-review` parking, resuming a parked run, and `PushNotification` firing rules.

## Configuration

Read `configuration.md` in this skill's directory for the policy-key table (`dispatch-retry-ceiling`, `auto-merge-max-lines`, `auto-merge-max-files`, `dispatch-batch-size`, `dispatch-group-size-guard`, and the deprecated `dispatch-pick-max-concurrent` alias — mirroring `_shared/work-record-config.md`'s canonical table), how to read them (`resolve-policy.js`), and per-firing CLI override precedence.

## Routine Configuration

`/dispatch` ships a routine template (`skills/dispatch/routine-template.yml`) whose prompt is `/claude-tweaks:dispatch --budget 1` — kept at one group per firing to preserve the fleet's existing cadence; Step 3's ranking is what resolves that single group headlessly. Instantiate it for the current project with:

```
/claude-tweaks:routine create dispatch
```

**Migration note.** A cloud Routine created from `/claude-tweaks:triage`'s old template still fires `triage dispatch` — that skill no longer exists; grants now live at `/claude-tweaks:backlog refine` (see Relationship below). This cannot be detected or fixed from inside a `/dispatch` run — a live routine referencing a retired prompt isn't visible here. If you have a routine scheduled before this skill existed, re-create it now via the command above; the old one keeps firing a prompt that no longer does anything until you replace or delete it.

## Next Actions

Render only when a human is present to answer — bare / `next` / `#N` / `#N,#M,...` all render this block when a human typed the command directly or a prior skill (e.g. `/claude-tweaks:backlog refine`'s Next Actions) invoked it on a human's behalf, never when this firing came from a scheduled Routine (nobody is present to answer, and an unanswered question at the very end of a headless run is just noise). When rendering, render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`/claude-tweaks:dispatch`** — drain more from the authorized queue (recommended)
`/claude-tweaks:routine create dispatch` — schedule a `--budget 1` dispatch drain as a recurring headless routine
`/claude-tweaks:help` — see the authorized-queue size and bot:blocked records

## Component-Skill Contract

`/claude-tweaks:dispatch` is never invoked as a pipeline component by another skill — a human runs one of its forms directly, or a scheduled Routine fires `/claude-tweaks:dispatch --budget 1` headlessly (see Routine Configuration above). See Next Actions above for the render/suppress rule.

`$PIPELINE_RUN_DIR` is not this skill's own state. Dispatch resolves its own standalone-auto run dir (per `_shared/run-dir-resolution.md`'s allowlist) purely to write its own `decisions.md` — the queue-pull/selection/minting audit trail for this firing, scoped to the firing as a whole (which may dispatch multiple groups in bare mode). That directory is distinct from the per-group run directory Step 4 mints, before `/flow`'s Step 2.8 claims it — the one that *becomes* the dispatched group's own `PIPELINE_RUN_DIR` once its first Task call invokes `/flow` and adopts it (`flow/steps-and-gates.md`'s Adopting-an-inherited-run-directory case 2). Unlike before, there is no separate identity to bridge between the two: the minted directory's basename is the claim's `runId` directly, passed on the Task call's command line, nothing parsed out of a report.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|--------------|
| Originating a fresh `auto:build`, `auto:merge`, or `ready` grant from inside dispatch | Machinery may only remove or downgrade grants, never originate them — the permission matrix's hard line (`_shared/work-record.md`). The Auto-merge gate's promotion of an already-`auto:merge-pending` record to `auto:merge` is the one exception, and it is maturation of an existing grant, not origination — nothing is added that wasn't already there |
| Claiming a single member of a file-overlap group without its partners | The branch and its overlap partners would race — `_shared/issue-claims.md`'s group-claim rule requires the whole group before starting any |
| Letting a group auto-merge on a retry after a prior `correctness`-classified failure | A `correctness` or `ambiguous` classification unconditionally revokes `auto:merge` before the next retry; only `transient` preserves it |
| Treating a clean review as sufficient for auto-merge on its own | `merge-check` weighs diff content, review findings, and blast radius as one judgment — a large or structurally sensitive diff can verdict `needs-human` with zero findings, never `auto-merge` |
| Retrying a failed record indefinitely with no ceiling | Burns routine cycles on something stuck and never surfaces it — the retry ceiling forces a checkpoint |
| Building a session that shepherds every authorized group to completion in one run | Context rot — throughput comes from routine cadence × single-group firings, not session breadth |
| Filing, closing, or granting authorization on records from inside dispatch | Dispatch only *consumes* grants — filing belongs to the health skills/`/claude-tweaks:capture`, granting to `/claude-tweaks:backlog refine` |
| Deriving a spec per bundle member before invoking `/flow` | A granted record is already spec-shaped (`ready` + spec-shaped body), so `/flow #A,#B` materializes directly — don't reintroduce the deleted per-member `/specify` pre-step |
| Re-selecting a Settle-failed group within the same drain firing | The per-iteration re-fetch excludes it (`bot:blocked`/claim markers); it counted as one attempted budget unit — move on |
