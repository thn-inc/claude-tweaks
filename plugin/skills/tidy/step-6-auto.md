# Tidy — Step 6 Auto Mode

Step 6's auto branch; `step-6-interactive.md` is its twin. `SKILL.md` resolves `--dry-run` before
reading either — under it, everything Stages and the routing table below is bypassed.

When a pipeline run directory exists (see `_shared/run-dir-resolution.md` for resolution order and bash snippet), resolve `tidy-aggressiveness` — `TIDY_AGGRESSIVENESS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values --run "$PIPELINE_RUN_DIR" tidy-aggressiveness)` — the same variable the standalone-auto path below resolves without `--run`; `conservative` is the documented opt-down.

**A recurring staged item is a missing routing rule.** The Approve bucket should stay empty in steady state: a finding class that keeps staging needs a routing row — or a reconcile check — that disposes of it mechanically, not a faster approval habit; Stage-tier record rows also write the tracker-visible `needs:decision` marker — procedure in `decision-markers.md` in this skill's directory. The one exception is outward-facing GitHub writes, forbidden at every tier (`_shared/auto-mode-contract.md`); their disposition rides on reconcile's background convergence (the reconcile-converged rows below), never a tidy tier.

**An Auto-apply row must be safe for every finding its class can produce.** A row disposes of a
whole class mechanically — the tier applies as written, never re-judged per item — so a class
whose classification rests on parsing or inference, not a flat field read, must resolve its
unclassifiable-input case *upstream*, in the scan procedure emitting the finding, not here:
exclude the item, or emit it as a separate Stage-tier recommendation. This matters most on
`local-files`, where no staging review downstream catches a misclassification before the edit
lands. The `Expiry summary` (`local-files`) row is the worked example: its unparseable-
`{provenance}` exclusion lives in `digest-sweep.md`'s Expiry procedure, so the row itself can
stay a one-line tier assignment.

**`local-merge` caveat (stated once, referenced by the reconcile-converged rows):** reconcile's checks run only under `integration-model: pr-first` (`_shared/integration-model.md`; `bin/lib/reconcile/index.js`'s guard). Under `local-merge`, nothing below converges — except `reap`, which falls back to `worktree-reap.js`'s ancestry check — every other such finding keeps its current staging behavior.

For each finding, route by recommendation type:

| Recommendation | `conservative` | `moderate` (default) | `aggressive` |
|---|---|---|---|
| **Keep** | Auto (no-op) | Auto (no-op) | Auto (no-op) |
| **Needs scoring** (Shape 4 — `ready` record missing risk/size; no mutation, recommends `/claude-tweaks:specify`) | Auto (no-op, always surfaced) | Auto (no-op, always surfaced) | Auto (no-op, always surfaced) |
| **Re-triage** (Shape 5 — `bot:blocked`; no mutation, recommends `/claude-tweaks:backlog refine`) | Auto (no-op, always surfaced) | Auto (no-op, always surfaced) | Auto (no-op, always surfaced) |
| **Legacy taxonomy** (Shape 5.5 — record carries a retired label; no mutation, recommends a `gh label edit` rename) | Auto (no-op, always surfaced) | Auto (no-op, always surfaced) | Auto (no-op, always surfaced) — never applied at any tier: a repo-wide label rename re-labels every issue carrying it in one outward-facing API write, and the read-side compatibility path means nothing breaks while it waits (`step-1-records.md`'s Shape 5.5) |
| **Awaiting review** (a fresh/clean, non-stale open PR surfaced by `github-pr-scan.md`'s `repo-wide` scope; no mutation, informational only) | Auto (no-op, always surfaced) | Auto (no-op, always surfaced) | Auto (no-op, always surfaced) |
| **Acceptance-gap** (closed record with no acceptance disposition — surfaced by `github-pr-scan-acceptance.md`'s `acceptance-gap` scope under `work-backend: github-issues`, or by `step-1-records.md`'s Shape 8 under `work-backend: local-files`; no mutation on either driver, recommends `/claude-tweaks:demo #{n}` / `{id}`) | Auto (no-op, always surfaced) | Auto (no-op, always surfaced) | Auto (no-op, always surfaced) — never auto-applied at any tier: disposing a closed record is a judgment call the auto-mode contract keeps off the silenced list (`_shared/auto-mode-contract.md`). Unlike the Open parent gate row below, no write is deferred here — the finding just recommends a command, so the two drivers need no separate reasoning |
| **Open parent gate** (every sub-issue closed with no acceptance disposition on the parent — surfaced by `github-pr-scan-acceptance.md`'s `parent-gate` scope under `work-backend: github-issues`, or by `step-1-records.md`'s Shape 7 under `work-backend: local-files`; composes the parent's Verification Brief and applies `demo:pending` / `acceptance: pending` via the resolved `tidy/actions-{github-issues,local-files}.md`'s `## Open parent gate`, reusing `wrap-up/verification-brief.md`'s Parent-Gate Procedure) | Stage | Stage | Stage — on both drivers, for two different reasons. `github-issues`: posting a comment and adding a label is an outward-facing GitHub API write, forbidden at every tier by `_shared/auto-mode-contract.md`'s never-reversible list, and it also fails that contract's `high`-reversibility bar. `local-files`: the record-file edit does clear reversibility, but fails the **confidence** floor — the write composes a Verification Brief (an authored sign-off artifact) asserting every sub-issue is complete, not a mechanical flag flip. Either driver also **latches**: `parentGateState` reads the parent's own disposition first, so once on it stays `gated` forever — a wrong brief becomes the human's sign-off input with its cause erased (`[IL-96]`'s shape), and reverting the bytes doesn't revert the verdict. Both drivers share this tier so `[parent-gate]` stays one behavior. Opening the gate never applies `demo:approved`/`demo:changes-requested` — exclusively `/claude-tweaks:demo`'s job. Once approved, this re-verifies the gate is still `due` with freshly read state before writing, per `_shared/reverify-before-write.md` — never trusting the scan's own snapshot, which may go stale before Step 7 runs. |
| **Arm ready PR** (a green, gate-passed, `[pr-unarmed]` PR granted via `housekeeping-auto-merge` — the marker-stamped tidy Step-7 flavor of item 9; a backstop to Step 7.5's own arm attempt, not the primary path) | Stage | Auto-apply — only under the grant; an ungranted marker-stamped PR still Stages regardless of tier | Auto-apply — same grant gate as `moderate` |
| **Arm ready PR** (item 9's other granted flavor — a non-housekeeping PR already `auto:merge`-granted on every linked record, discovered unarmed by this backstop) | Stage | Stage | Stage — discovering an already-granted, already-green PR that never armed is itself an anomaly the dispatch pipeline should have caught; re-arming it blind rather than surfacing it first would hide what went wrong. Once approved, execution is identical to the housekeeping row above (`_shared/pr-first-merge.md`) — only the tier gate differs |
| **Unarmed ready PR, ungranted** (item 9 — no `auto:merge` on a linked record and no `housekeeping-auto-merge`; no mutation, recommends granting first) | Auto (no-op, always surfaced) | Auto (no-op, always surfaced) | Auto (no-op, always surfaced) — never auto-applied at any tier: granting `auto:merge` is `/claude-tweaks:backlog refine`'s job, never this sweep's (Non-Goals: no auto-merge for ungranted anything) |
| **Unsettled run** (item 10 — a claimed or `bot:in-progress` issue whose pipeline shows no progress past the threshold; no mutation, recommends resuming via the reported command or releasing the claim) | Auto (no-op, always surfaced) | Auto (no-op, always surfaced) | Auto (no-op, always surfaced) — resuming re-enters a pipeline mid-flight, always a judgment call this sweep only surfaces. Releasing a claim on a still-open issue drops a claim another session may still hold, so that stays surface-only too; the issue-closed case is disposed mechanically by reconcile's release check wherever its evidence conditions are met (see the Issue-closed claim release row below) — a closed-issue claim the check skips (e.g. its PR is still open) still surfaces here |
| **Issue-closed claim release** (claims on already-closed issues that reconcile's `release` check released — `bin/lib/reconcile/release-merged.js`; the module header owns the evidence conditions) | Reconcile-converged — reported in **Applied automatically**, never staged | Reconcile-converged (same) | Reconcile-converged (same) — see the preamble's `local-merge` caveat. Releasing a claim IS an outward GitHub write (a claims-blob conditional overwrite plus `bot:in-progress` removal), permitted as reconcile's own background-convergence write, outside the skill-side auto-mode contract. This row only reports the result; evidence conditions live in the module header. Claims on still-open issues are untouched here — see the Unsettled-run row above. |
| **Abandoned-branch archival + locked-worktree resolution** (unmerged/aged plugin-owned branches and merged-but-stuck worktrees — reconcile's `archive-branches` and `reap` checks, `bin/lib/reconcile/archive-branches.js` + `reap-merged.js`, liveness via `worktree-reap.js`'s predicates) | Reconcile-converged — reported in **Applied automatically**, never staged | Reconcile-converged (same) | Reconcile-converged (same) — see the preamble's `local-merge` caveat. Evidence conditions and thresholds live in the module headers, never here. A skipped candidate (open PR, too young, transport failure) surfaces as a non-actionable skip sub-line under **Applied automatically** — no command; paste-ready binds *actionable* lines only. A branch on a live worktree is silently out of scope for `archive-branches`; a locked worktree is `reap`'s skip, reported with its reason. The cleanly-merged Delete row above predates these checks and stays tier-routed for `local-merge` parity. |
| **Merged remote-branch deletion** (remote plugin-owned branches proven merged into the integration branch — reconcile's `remote-prune` check, `bin/lib/reconcile/prune-remote.js`) | Reconcile-converged — reported in **Applied automatically**, never staged | Reconcile-converged (same) | Reconcile-converged (same) — see the preamble's `local-merge` caveat. The pushed deletion is permitted as reconcile's own background-convergence write, outside the skill-side auto-mode contract, same exemption as the Issue-closed claim release row above. Evidence (MERGED PR + a merged-in-substance proof — cherry-equivalence, or squash provenance for a squash-merged multi-commit branch (#2252) — both required) lives in the module header. A skipped candidate surfaces as a non-actionable skip sub-line under **Applied automatically**; a branch on a live worktree is out of scope (same `inScope` guard). A merged remote branch this check does NOT dispose never falls through to the Delete rows below: it Stages at every tier — deleting it is a pushed, outward-facing write, forbidden on any tidy tier. |
| **Mark as specified** (Step 3's design-doc classification — no status line, matches existing specs; stamps a `Status: specified — decomposed to {record refs}` line directly below the title heading, per `scan-procedures.md` Step 3) | Stage | Auto-apply | Auto-apply — a tracked-file edit, the same reversibility class as the `local-files` Defer row; the stamp is also what makes the doc eligible for the Delete row above it on a later sweep once its derived specs complete |
| **Delete** (stale temp files, broken symlinks, aged `artifact` residue findings — `remedy: auto`, gitignored declared-transient QA screenshots/traces past the 30-day window) | Auto-apply | Auto-apply | Auto-apply — no `_shared/reverify-before-write.md` re-check needed: a broken symlink can't become un-broken between scan and execution, and every other member is an age/expiry-gated finding that only advances further past its threshold, never back under it — there is no durable work state for a concurrent session to revive |
| **Delete** (marked-as-specified design docs, merged or net-empty worktrees/branches — `scan-procedures.md`'s Net-empty override, #613 — orphaned plans whose related spec is complete, orphaned ledger files with no matching pipeline run directory) | Auto-apply | Auto-apply | Auto-apply — a concurrent sibling session could revive any of these between Step 4/4.5's scan and Step 7's execution (`SKILL.md`'s Cross-action housekeeping). Before Step 7 deletes any of these, re-verify the classifying condition still holds with freshly read state, per `_shared/reverify-before-write.md`: the design doc's derived specs are still complete; the plan's related spec is still complete; the worktree isn't locked and its branch isn't checked out elsewhere; a net-empty branch's diff against its fork point (`scan-procedures.md`'s `git diff --quiet` check) is still empty; and no directory under `.claude-tweaks/pipelines/` (live or `archive/`) has since appeared matching the ledger's record/spec number(s). Skip and log the mismatch rather than deleting on a stale premise, same as every other consumer of that contract |
| **Delete** (any case requiring judgment, excluding backlog records — old plans whose spec status is unclear, design docs with no specs; see the dedicated backlog-record Delete rows below for `local-files`- and `github-issues`-backend findings) | Stage | Auto-apply | Auto-apply |
| **Delete** (legacy-root `artifact` finding — a pre-relocation screenshots/ or traces/ tree; always `remedy: record`, regardless of age or untracked proof) | Stage | Stage | Stage — deleting possibly-owned content is never auto-applied at any tier; the probe emits `remedy: record` for every legacy root because neither the shape heuristic nor an untracked proof establishes plugin ownership (`bin/lib/residue/probes/artifacts.js`) |
| **Delete** (stale backlog record, `local-files` backend — Shape 1's "Stale" recommendation; deletes a git-tracked file, same reversibility tier as the row above) | Stage | Auto-apply | Auto-apply |
| **Absorb** (backlog record overlaps an existing record, `local-files` backend — see the dedicated backlog-record Absorb row below for `github-issues`) | Stage | Auto-apply | Auto-apply |
| **Promote** (ready for brainstorm/`/specify` pipeline) | Stage | Stage | Auto-apply |
| **Defer** (`local-files` — pure file update) | Stage | Auto-apply | Auto-apply |
| **Defer** (`github-issues` — label + possible milestone creation, outward-facing) | Stage | Stage | Stage — visible to collaborators; never auto-applied per the auto-mode contract's reversibility floor |
| **Sync to GitHub** (local record exists under `work-backend: github-issues`) | Stage | Stage | Stage — creates GitHub-visible state; never auto-applied per the auto-mode contract's reversibility floor |
| **Delete** (backlog record, `github-issues` backend — closes a GitHub issue) | Stage | Stage | Stage — visible to collaborators; never auto-applied per the auto-mode contract's reversibility floor |
| **Absorb** (backlog record, `github-issues` backend — closes a GitHub issue) | Stage | Stage | Stage — visible to collaborators; never auto-applied per the auto-mode contract's reversibility floor — capture's absorb differs (delimited append) and rates `high`; see `capture/routing.md` |
| **Fix now** (registry entries pointing to non-existent files) | Stage | Stage | Stage — fixing requires judgment about which side to keep |
| **Add rule to CLAUDE.md** (cross-spec patterns) | Stage | Stage | Stage — CLAUDE.md never edited autonomously |
| **Design record drift** (Step 4.9's `[doctor]` findings; no mutation, informational) | Auto (no-op, always surfaced) | Auto (no-op, always surfaced) | Auto (no-op, always surfaced) — no tier makes this an action: the scan step never edits a project file, and applying an `auto` finding means `doctor.mjs --fix`, which rewrites `PRODUCT.md` — `_shared/auto-mode-contract.md` reserves that for explicit human approval. A skipped scan surfaces nothing at all. |
| **Close (GitHub) / Resolve thread** (outward-facing GitHub mutations) | Stage | Stage | Stage — visible to collaborators and may trigger notifications; never auto-applied per the auto-mode contract's reversibility floor |
| **Capture** (PR/issue → backlog record) | Stage | Stage | Stage — new backlog-record writes are on the auto-mode contract's never-silenced list (`_shared/auto-mode-card.md`: "Work-record creation") |
| **Merge-close duplicate digest** (Step 5.6 bootstrap-race repair, `github-issues` only) | Stage | Stage | Stage — merges comments into the surviving issue and closes the other: an outward-facing GitHub write, never auto-applied per the reversibility floor |
| **Propose digest cluster** (Step 5.6 cluster promotion; on approval, files a new backlog record) | Stage | Stage | Stage — new backlog-record writes are on the auto-mode contract's never-silenced list, same as the Capture row above |
| **Expiry summary** (Step 5.6, `github-issues` — posts a closing summary comment) | Stage | Stage | Stage — outward-facing GitHub write, never auto-applied per the reversibility floor |
| **Expiry summary** (Step 5.6, `local-files` — moves entry lines to `## Archived {date}` in `specs/digest.md`) | Stage | Auto-apply | Auto-apply — a tracked-file edit, same reversibility class as the `local-files` Defer row above |
| **Rollover digest container** (Step 5.6, `github-issues` only — 100-comment threshold) | Stage | Stage | Stage — closes one issue, opens another, and moves a label: outward-facing, never auto-applied per the reversibility floor |

**Net-empty branches (#613).** `scan-procedures.md`'s Step 4.5 worktree/branch audit — the Build-branches table and every shared-probe worktree/branch candidate alike — checks each unmerged `{branch}` against its own fork point before falling back to "Unmerged changes"/manual review: resolve `{base}` per `_shared/integration-branch.md` (same resolution the `-d`/`-D` procedure there already uses), then `git -C "{REPO_ROOT}" diff --quiet "$(git -C "{REPO_ROOT}" merge-base {base} {branch})" {branch}`. Exit 0 (no diff) means `{branch}`'s tree is byte-identical to where it forked — the canonical `/specify` residue shape (a design doc committed, then deleted after decomposition, netting zero across two commits) is exactly this, and it is invisible both to the shared probe's `--merged`-only `kind: branch` finding and to a plain "unmerged" read, since the branch is neither merged nor genuinely holding unmerged work. A `merge-base` failure (no common ancestor) or a malformed-ref error from `git diff --quiet` is a non-zero exit that is not "no diff" — it falls through to the existing "unmerged"/manual-review path exactly like any other refusal, never to auto-delete. Collect as `[git] {branch} — net-empty — delete via -D` — the same Recommendation-column string `scan-procedures.md`'s own collect rule (`[git] {worktree/branch} — {recommendation}`) already produces for this outcome, so the scan-phase and auto-execution reports never diverge — which routes through the Delete row above like any other merged-worktree finding. `-d` will typically refuse this case (content-identical, not history-contained) — use `-D`; safe because the empty diff is itself the proof nothing is lost. This override never applies over a PR-state `OPEN` row, a dirty-worktree override (`dirty: true`/`unknown`), or a locked worktree — those still win. This is intentionally stricter than `scan-procedures.md`'s general Dirty-worktree override (#1424), which treats `dirty: unknown` alone as non-blocking for ordinary worktree removal — because `-D` here is an irreversible force-delete, the ambiguity of an unknown dirty status is itself reason enough to defer to manual review rather than proceed.

**Log entries:** Write each auto-resolution to `{run-dir}/decisions.md` per `_shared/auto-decision-log.md`. Example entries:
```
AUTO 11:14:32 — Step 6: deleted stale backlog record "{title}" (5 weeks old). Reversibility: med (commit {hash}).
STAGED 11:14:35 — Step 6: absorb proposal for backlog record "{title}" into #42. Stage path: staged/tidy-absorb-1.md.
```

Auto-applied items are committed. Staged items surface at the Wrap-Up Review Console for batch approval (`/wrap-up`'s Phase 4) when `/tidy` runs as part of a pipeline.

**Standalone auto:** When `/tidy` runs standalone in `auto` mode (no parent pipeline run dir), follow the Standalone auto fallback in `_shared/run-dir-resolution.md` — create `.claude-tweaks/pipelines/{ISO-timestamp}-tidy-standalone/` with `decisions.md` and `staged/`; the audit log stays on. Apply the resolved `tidy-aggressiveness` value — `TIDY_AGGRESSIVENESS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values tidy-aggressiveness)` (see `_shared/policy-schema.md`) — as the routing key, and render the report per the template below (this run's bookend-end; no separate Review Console).

#### Archival compaction (every Standalone-auto firing, any scope)

Runs on every Standalone-auto firing regardless of scope — aging out prior standalone runs, not this run's own findings.

Before writing this run's own report, scan `.claude-tweaks/pipelines/` for two kinds of aged-out run directories:

- **Standalone runs** (name matches `*-standalone`) whose ISO-timestamp prefix is more than 30 days old — compacted on age alone, same as always.
- **Abandoned non-standalone runs** — a `/flow`-orchestrated run directory (no `-standalone` suffix) more than 30 days old AND whose `run-state.json` status is not `active` (`interrupted`, or the file missing/unreadable). Covers a run stopped at an interactive HARD-GATE and never resumed — it never reaches `/wrap-up`'s successful-closure archival, so without this rule it would sit indefinitely with no cleanup path. The `status` check (absent from the standalone rule, which compacts on age alone) exists so a still-`active`, long-running pipeline is never swept purely for being old.

These two rules cover `interrupted`/unreadable runs on a 30-day clock — not the only place a stale run dir gets caught. A run whose `run-state.json` reached `status: clean` without being archived surfaces immediately, no age wait, via `bin/residue.js`'s `pipeline-run` finding (`bin/lib/residue/probes/pipeline-runs.js`) — but post-#1118, `/wrap-up`'s own `--scope blast-radius` residue sweep reads only the invoking run's own dir; every `/tidy` Step 4.5 `--scope repo` pass still reads them all.

For each matched directory:

1. Read its `decisions.md`.
2. Append its content to `.claude-tweaks/pipelines/archive/index-{YYYY-MM}.md` (the month derived from the run's own timestamp, not today's date — a run compacted late still files under the month it actually ran), creating the file if absent. Prefix the appended block with the run's own directory name as a header so entries stay attributable.
3. Move the run directory to `.claude-tweaks/pipelines/archive/{run-id}/` (same target `/wrap-up` uses for completed pipeline runs — see `wrap-up/cleanup-procedures-execution.md` Section B).
4. Log one `AUTO` line to *this* firing's own `decisions.md`: `AUTO {time} — Archival: compacted {run-id} (age: {N} days) into index-{YYYY-MM}.md. Reversibility: high (archive is additive, nothing deleted).`

Skipped staged items inside a compacted run are preserved verbatim in the archive (not silently dropped) — same rule `/wrap-up`'s own archival already follows.

#### The report template (standalone auto)

Four verb-grouped sections, these exact literal headers, in this order — what tidy **did**, what it **will do on a click**, what **only the human can do**, and what came back clean. Every section's rows render inside a fenced ```` ```text ```` block as whitespace-aligned columns — `_shared/terminal-ux.md`'s Output formatting ("align columns so the eye can scan one"; one record per line) applied to a chat-rendered report. The fence is what makes the alignment survive Claude Code's terminal renderer; the accepted cost is that `#N` and path text inside it stops being clickable:

````markdown
## Tidy Report — {date}

**Applied automatically**
```text
{verb}       #{N}  {title ≤50, …-truncated}                        {commit abc1234 | reconcile-converged}
{verb}       #{M}  {title}                                         {commit def5678 | reconcile-converged}
```

**Approve ({N})**
```text
1  [{tag}]  #{N}  {title ≤50}
   {staged action, one line}
   {the exact command or mutation}
2  …
```

**Yours ({N})**
```text
{command} ({k})
   #{N}  {title ≤50}                                                {why it needs the human}
   #{M}  {title ≤50}                                                {why it needs the human}
   {batch command covering every row above}
{command} ({k})
   #{N}  {title ≤50}                                                {why it needs the human}
   #{M}  {title ≤50}                                                {why it needs the human}
   {single command for #{N}}
   {single command for #{M}}
```

**Clean:**
```text
{scan}             {count} checked
{scan}             {count} checked
```

Full decision log: {run-dir}/decisions.md
````

Column shape, stated once: rows indent three spaces under a group head or numbered item; the record column is `#{N}` padded to six characters; the title column is padded to one shared width per section (at least 50, titles truncated to 50 + `…` when longer), so the trailing column starts at one shared offset and fills to the 100-character line cap (Report rules below). A record-less finding (`[health]`, `[doctor]`, `[pattern]` — see `scan-procedures.md`'s routing table) puts `—` in the record column and its `[tag] {summary}` in the title column, same width rules. Applied rows lead with a verb column padded to 13 (`deleted`, `released`, `archived`, `reaped`, …) — the verb *is* the outcome, so the only trailing column is the reversibility token. Approve items take three lines: number + tag + record + title, then the staged action, then the command or mutation. Yours groups follow the Yours grouping rule below — a group head `{command} ({k})`, its rows, then a batch line or paste block. Clean is one `{scan}  {count} checked` line per scan (`—` when a scan reports no count).

How **Approve ({N})** resolves here: staged files persist under `{run-dir}/staged/`; when non-empty, `SKILL.md`'s Next Actions prepends an "Approve ({N})" option — named for this section — that runs Step 7 over exactly those items. Nothing applies without that click.

#### Bucket mapping (which section a finding lands in)

A finding's section is a function of its routing outcome above — never per-run judgment:

| Routing outcome | Section |
|---|---|
| Auto-applied (executed this run) or reconcile-converged | **Applied automatically** |
| Staged with an executable action (awaiting approval) | **Approve ({N})** |
| Auto (no-op, always surfaced) — a finding recommending a command the human runs (every `Auto (no-op, always surfaced)` row in the routing table) | **Yours ({N})** |
| Keep / nothing-to-report scans | **Clean:** (one `{scan}  {count} checked` line per scan in the Clean fence — counts only, never per-record rows) |

No finding may be presented information-only: anything actionable carries its paste-ready command in **Yours** or lands in **Approve**.

#### Yours grouping (by the command the human runs)

**Yours ({N})** groups its rows by the command the human will run — never by scan step, Shape number, or finding tag. The group key is the leading command of the row's paste-ready command: the skill for a `/claude-tweaks:{skill}` invocation, plus its mode word when it has one (`backlog refine` is one key), or the bare executable otherwise (`gh`, `git`, `node`); an env-var prefix (`PIPELINE_RUN_DIR="…" /claude-tweaks:flow …`) is stripped before keying. Group order is fixed — `specify`, `demo`, `git`, `capture`, `backlog refine`, then every remaining key alphabetically — so two renders of the same findings always read the same. Each group renders as a head line `{command} ({k})`, its record rows beneath, then the command line(s):

- **Batchable target** — the skill's `argument-hint` (its `SKILL.md` frontmatter) accepts multiple record refs: one batch line closes the group, `{command} #{N},#{M},…` (a one-record group's batch line is simply `{command} #{N}`), and covers every row above it. Rows whose commands differ in their env-var prefix (two unsettled runs resuming different `PIPELINE_RUN_DIR`s) are never folded into one batch line — that group closes with a paste block, one full command per row, prefix included. Today that is `/claude-tweaks:flow` (`#N[,#M...]`), `/claude-tweaks:dispatch` (`#N[,#M...]`), `/claude-tweaks:specify` (`<#N[,#M...]|…>`, record refs only), and `/claude-tweaks:demo` (`[#N[,#M...]]`). Read the hint at render time, not this list — when a skill gains a batch form, this rule needs no edit and the render just gets shorter.
- **Single-ref target** (`gh …`, `git …`): a consecutive paste block closes the group — one command line per row, in row order — so one paste runs them all.
- **Ref-less command** (`/claude-tweaks:backlog refine` covers the whole queue; the line is identical for every row): rendered once, as the group's single closing command line.
- **No runnable command** — a finding whose follow-up is prose or a path rather than a command (a `[pattern]` observation, a `[health]` row that names a file to review, a `[doctor]` row whose `fix` is a proposal the user applies with their own `doctor.mjs --fix`): keys under a fixed final group, `review ({k})`, after the alphabetical keys. Its rows carry the follow-up (the path, or the fix text truncated to the column) in the trailing column, and the group closes with no command line — the conformance scan's "Every Yours row covered" row exempts `review`. A `[health]` or `[doctor]` row whose follow-up *is* a command (a `/claude-tweaks:*-health` skill, an Impeccable command a `route` fix names) keys on that command like any other row.

`(likewise #41 #113 …)`, `(and N more)`, `et al.` and every other multi-record shorthand are never acceptable, in any section — one row per record, and one command line per row (or one batch / ref-less line per group). The conformance scan below rejects a render that carries any of them.

#### Why-not-auto sourcing

Every Yours row's trailing column states, in one clause, why this finding needs the human — sourced from this file's own routing table above, never re-derived per render: use that row's own text from the `Stage` / `Auto (no-op, always surfaced)` cell, trimmed to fit. Two reasons cover most rows, the default when the table's cell carries nothing more specific:

- **`outward GitHub write, never auto per reversibility floor`** — a GitHub-visible mutation the auto-mode contract's reversibility floor keeps off every tier (`[pr-unarmed]`, `[unsettled]`, `awaiting review`, `[legacy]`'s label rename).
- **`judgment call, no mechanical fix`** — the recommendation exists but resolving it needs reading intent, not a rule (`[scoring]`, `[blocked]`, `[sizing]`, `[pattern]`, `[health]`, `[doctor]`, `[calibration]`, `[acceptance-gap]`, design-record drift).

Never leave the column blank or the placeholder unfilled — a reader must tell "needs judgment" from "policy forbids auto" from "no mechanical fix exists."

A **Yours group** in a condensed report states this once, at the group level, not per row — rows in one group usually share a reason (a `specify (3)` group is a judgment call; a `git (2)` group of stale-PR closes is an outward-write case). When rows differ, state the more specific one — the full report's per-row column still carries each exact reason.

### Report rules

Binding rules for every rendering of this template, on both surfaces (`step-6-interactive.md` cross-references this heading rather than restating):

- No box-drawing art anywhere — no `┌ ─ ┐ │ ├ ┤ └ ┘` characters. This bans drawn table borders, not alignment: whitespace-aligned columns inside the ```text fences are required, and are what "no box-drawing tables" always meant.
- Width: no rendered line exceeds **100 characters**. Titles truncate to **50 characters** with a trailing `…`; every row states one fact (record, title, one short trailing column) and never wraps onto a second line.
- Every actionable line carries a paste-ready command (fully-qualified `/claude-tweaks:{skill}` form for skill invocations) or lands in **Approve ({N})**. In **Yours ({N})** that command is the group's batch line or its paste block (Yours grouping above) — one command line per row, or one batch / ref-less line per group; multi-record shorthand (`(likewise …)`, `(and N more)`) never substitutes for it.
- Commands render on their own line: no annotation, no rationale, no leading `—`/`→`, nothing trailing — those live on the row line(s) above it.
- Records render as `#{N}` then the title column — titles come from the scan agents' Template-A findings (the dispatch prompts require item titles in the Finding column); never a fresh per-row `gh issue view`. A record-less finding renders `—` instead (column shape above).
- `{run-dir}/decisions.md` is referenced by path exactly once, in the report footer, and never replayed into chat.
- Empty-state: **Applied automatically**, **Approve ({N})**, and **Yours ({N})** are each omitted entirely when empty; **Clean:** always renders — as its fence, or as the single line **Clean:** nothing — every scan surfaced findings.
- Condense: when the rendered report exceeds **40 lines** (fences, headers, footer all counted), don't send it whole. Write the full report to `{run-dir}/report.md` (Bash append — same write path as `decisions.md`; the run dir lives under the main checkout) and send a condensed report of about 20 lines instead — the budget yields to Approve, so a large Approve section runs longer, never truncated: the `## Tidy Report` line; **Applied automatically** collapsed to one line with its count; **Approve ({N})** in full — the click surface, nothing approved unseen; **Yours ({N})** as group heads with counts, each followed by one shared why-not-auto clause for the group (Why-not-auto sourcing above) and then its batch or ref-less line when the group has one (paste blocks stay in `report.md`); **Clean:** collapsed to `{n} scans clean`; and a footer `Full report: {run-dir}/report.md` in place of the decisions.md line. At 40 lines or fewer nothing extra is written and the report is sent whole. (Named "Condense" to avoid colliding with the unrelated `digest`-labeled materiality-floor container in `digest-sweep.md`.)
- **`--source sweep` persistence:** tidy's Component-Skill Contract (`SKILL.md`) suppresses only the chat send and `## Next Actions` under this flag — report composition itself is unaffected, and this render always persists to disk regardless of the Condense rule's 40-line threshold. Write `{run-dir}/report.md` unconditionally under `--source sweep` (the Condense bullet above already writes it whenever the 40-line threshold is crossed; write it here too when it wasn't, so the footer below always resolves to a real file), and write `{run-dir}/report-condensed.md`: the condensed rendering (identical to what the Condense rule would have sent to chat) when the Condense rule fired, or the full report verbatim when it did not. Either way, `report-condensed.md` closes with the `Full report: {run-dir}/report.md` footer (path relative to the repo root) and must pass `node "${CLAUDE_PLUGIN_ROOT}/bin/tidy-report-lint.js" --surface=condensed` before this step is done — run it and fix findings the same as the Conformance scan below requires for the chat surface. `/claude-tweaks:sweep`'s Step 4 reads `report-condensed.md` back to inline the Approve section into its own close-out (`sweep/SKILL.md`); attention's Tidy row stays the cross-run one-line count regardless, so staged items render once per close-out, not twice.

#### Conformance scan (before the hard gate)

Run this scan over the literal markdown about to be sent — the whole report, or the condensed report plus `report.md` when the condense rule fired — before the hard gate below. Every row is a check and a remedy; a failing row is fixed and the scan re-run. A non-conformant render is never shipped as-is, and a clean pass logs nothing (mirrors `flow/multi-spec.md`'s pre-flight verify sweep, which stays silent on a clean sweep). Against a condensed report, the surface-tagged rows below apply — and so does **Every Yours row covered**: a condensed report that drops the Yours section into a one-line prose summary (or a file attachment with no literal group heads+commands) fails this row exactly the way an omitted Approve section already fails the Hard gate below, even though it satisfies the 40-line budget. The remaining section-shape rows are checked against the full report in `report.md` instead.

`bin/tidy-report-lint.js` is the mechanical half of this scan (#731) — feed it the rendered markdown (stdin or a path) and it emits one line per failing row, following the prose-rule-to-check pattern `bin/residue.js` and `bin/lib/skill-audit/` already establish. Every rule has a matching check function in `bin/lib/tidy-report-lint/rules.js` — run it before this self-check. When the condense rule fired, invoke it twice with `--surface` (#1625) rather than once over either text alone: `--surface=condensed` against the chat render, `--surface=full <report.md>` against the full file — each runs only the subset that applies to that surface, so neither false-positives on a check meant for the other. Omit `--surface` when the report was never split, and it runs all 13 rules together. Two rows are only partially mechanical: **Command alone** only catches the leading `—`/`→` half; **Batch only where allowed** hardcodes today's batchable-skill list (`flow`, `dispatch`, `specify`, `demo`) rather than reading a live `argument-hint` — keep the two in lockstep. **Condense why** and **Why stated** have no mechanical counterpart yet — checked by the rendering model's own self-check.

| Rule | Check | Remedy on failure |
|---|---|---|
| Width | no line longer than 100 characters | truncate the title to 50 + `…`; shorten the trailing column; never wrap a row |
| Titles | every title column ≤ 50 characters, `…` when truncated | truncate |
| Aligned | every row in a section starts its trailing column at one shared offset | re-pad the section's rows |
| One record per row | every row naming records carries exactly one `#{N}`; a record-less finding (`[health]`, `[doctor]`, `[pattern]`) renders `—` in the record column and its tag where the title goes | split into one row per record |
| No shorthand | none of `(likewise`, `(also`, `(and {n} more`, `(+{n}`, `et al` appear anywhere | expand into one row per record and one command line per row |
| Command alone | a command line holds only the command — no leading `—`/`→`, no trailing prose | move the annotation to the row line above |
| Every Yours row covered | each Yours group except `review` closes with one batch or ref-less line, or a paste block with exactly one line per row | add the missing command line(s) |
| Why stated | every Yours row's trailing column states a one-clause reason (never blank, never the unfilled placeholder) — sourced per Why-not-auto sourcing above | add the sourced reason |
| Batch only where allowed | a batch line's target skill accepts multiple refs per its `argument-hint` (`flow`, `dispatch`, `specify`, `demo` today) | expand into a paste block |
| Fenced, no box art | every non-empty section's rows sit inside a ```text fence; no `┌ ─ ┐ │ ├ ┤ └ ┘` characters anywhere | re-render inside the fence |
| Group order | Yours groups run `specify`, `demo`, `git`, `capture`, `backlog refine`, then alphabetical | reorder |
| Clean shape | `**Clean:**` followed by a fence of `{scan}  {count} checked` lines, or the literal `**Clean:** nothing — every scan surfaced findings` | re-render |
| Footer once | `{run-dir}/decisions.md` appears exactly once, in the footer | dedupe |
| Condense | a report over 40 lines was written to `{run-dir}/report.md` and the chat carries the condensed report, not the whole | apply the condense rule |
| Condense why | each Yours group head in the condensed report is followed by one shared why-not-auto clause before its command line | add the group's shared reason (Why-not-auto sourcing above) |

#### Hard gate (report before question)

Check the response you are about to send: does it already contain the report above — or, when the condense rule fired, the condensed report — as literal rendered markdown — every non-empty section of **Applied automatically**, **Approve ({N})**, **Yours ({N})**, and the **Clean:** line? If not, render it now, in this response, before any `AskUserQuestion` call. `AskUserQuestion` cannot carry the report itself (`docs/skill-authoring.md`'s Multi-item decisions convention), so a response with a question but no report above it has asked for a decision with nothing to decide on.

