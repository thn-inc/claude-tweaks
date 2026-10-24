# Multi-Spec Wrap-Up Review Console — Template

Referenced by `skills/flow/multispec-review-console.md`'s "Present the consolidated console"
section — the bundle analog of `wrap-up/console-template.md`. This is the literal shape to
render: every section's column layout and worked example rows, with fictional data standing in
for a real run's per-spec `decisions.md`/`staged/` content. Read `multispec-review-console.md`
itself for the numbering rules, the engine-vs-prose-fallback distinction, and the operative
`AskUserQuestion` call that follows this template.

```markdown
### Multi-Spec Wrap-Up Review Console

Pipeline complete for specs 157, 159, 160. The pipeline auto-resolved {N} decisions and staged {M} items across all 3 specs. One batch decision below resolves everything.

#### Auto-applied (already in commits — override = revert)

| # | Spec | Skill | What | Where | Status |
|---|---|---|---|---|---|
| 1 | 157 | /review | Applied 3 severity:low formatting fixes | commit `def5678` | Applied |
| 2 | 157 | /test | Auto-fixed 4 lint failures | commit `ghi9012` | Applied |
| 3 | 159 | /build | Scope-creep: added src/utils/cache.ts to plan | commit `abc1234` | Applied |
| 4 | 159 | /review | Applied 2 severity:low naming consistency fixes | commit `jkl4567` | Applied |
| 5 | 160 | /stories | Applied 2 journey link suggestions | stories/login.yml, stories/logout.yml | Applied |

A `SCANNED` entry (skill-curation's scan-summary log line — see `_shared/auto-decision-log.md`) also renders in this section, tagged with its originating spec, but with `Status` = `Informational` and `Where` = the step/location it ran at (no commit ref, since nothing was applied) — there is nothing to revert for these rows.

#### Pending review (staged — apply, skip, or modify per item; `ratify`/`reverse` an `sdd-ruling-*` row)

| # | Spec | Skill | What | Detail | Patch |
|---|---|---|---|---|---|
| 6 | 157 | /review | 2 severity:medium findings | Unhandled rejection in src/api.ts:180; missing null check in src/auth/session.ts:42 | `spec-157/staged/review-2.patch`, `spec-157/staged/review-3.patch` |
| 7 | 159 | /wrap-up | Skill restructure proposed | Split `auth/SKILL.md` into `auth/` + `session-management/` | `spec-159/staged/wrap-up-skill-restructure.md` |

#### Dismissed duplicates (byte-identical to their anchor — informational; Approve all and Override leave them as they are)

| # | Spec | Copy | Anchor |
|---|---|---|---|
| {n} | 157 | `spec-157/staged/build-deviation-1.md.shadow-dup` | `spec-157/staged/build-deviation-1.md` |

Renders only when non-empty; aggregated across every spec in the run, `Spec`-tagged, and the rows take the next numbers of the global sequence. Which copies belong here: `wrap-up/console-template.md`'s Dismissed duplicates `cmp -s` rule, run against the `staged/` the copy came from.

#### Low-confidence findings (not reproduced — Approve all files or drops each per its tiebreak recommendation)

Rendered and built per `wrap-up/console-template.md`'s Low-confidence findings section, from each `spec-{N}` dir's `--list` call. Aggregated across every spec in the run, `Spec`-tagged. Omit the section entirely when empty for every spec.

| # | Spec | Item | Path:Line | Finding | Severity | Lens | Recommendation |
|---|---|---|---|---|---|---|---|
| 8 | 157 | tiebreak:3f2a9c1b7d04 | src/auth.ts:42 | Possible null check missing | medium | error-handling | file |
| 9 | 157 | review-unconfirmed-2.md | src/api.ts:180 | Race condition on token refresh | high | security | drop |

> These findings were surfaced by exactly one reviewer agent (or downgraded by a debate that converged negative), and the tiebreak could not settle them. The columns and the Approve-all default — each row's recommendation; a legacy no-verdict row stays undecided — are `wrap-up/console-template.md`'s Low-confidence findings section, per spec.

#### Contested findings (debate inconclusive — Approve all files or drops each per its tiebreak recommendation)

Rendered and built per `wrap-up/console-template.md`'s Contested findings section, from each `spec-{N}` dir's `--list` call. Aggregated across every spec in the run, `Spec`-tagged. Omit the section entirely when empty for every spec.

| # | Spec | Item | Path:Line | Lens A verdict | Lens B verdict | Severity | Recommendation |
|---|---|---|---|---|---|---|---|
| 10 | 159 | review-contested-1.md | src/auth.ts:42 | agree (security) | partial (architecture) | high | file |

> Two reviewer lenses disagreed on this region and one debate round did not converge. Both verdicts are staged at `spec-{N}/staged/review-contested-{M}.md` with reasoning side-by-side. The columns and the Approve-all default are Low-confidence findings' above.

#### Dropped by tiebreak (read-only — no decision)

| Spec | Path:Line | Lens | Severity | Evidence |
|---|---|---|---|---|
| 157 | src/cache.ts:88 | performance | high | src/cache.ts:90 "if (!entry) return fetchFresh(key);" |

`wrap-up/console-template.md`'s Dropped by tiebreak block, aggregated across every spec in the run and `Spec`-tagged — unnumbered, no decision.

Generate the next five sections — Skill updates, Documentation updates, Journey updates, Configuration updates, and Reference repairs, in that order, matching `engine-render.js`'s `SECTION_SPECS` emission order — via the `--spec-state` engine call in "When to run the consolidated console" step 3 above. `renderConsoleSectionsMulti` emits a bare `#### {title}` heading per section plus one uniform `| # | Spec | Target | Change | Disposition |` table (integer `#`, the contributing spec's id, `finding.targetPath`, `finding.summary`, and `applied ({commit})` / `staged ({stagePath})`) — the same five columns for all five sections. The richer per-section shapes below illustrate what those rows mean; they are not a second render shape. On an engine run, insert `render`'s output verbatim into the response; do not hand-expand it into a different table shape.

#### Skill updates (from each spec's Skills curation row)

| # | Spec | Skill | Section | Change |
|---|---|---|---|---|
| 11 | 157 | auth | Anti-Patterns | Add: "Don't share session tokens via querystring" |
| 12 | 159 | NEW | session-management | Create new skill for session lifecycle patterns |

#### Documentation updates (from each spec's Docs curation row)

| # | Spec | Type | Target | Change |
|---|---|---|---|---|
| 13 | 157 | doc | docs/api.md | Document new /auth/refresh endpoint |

#### Journey updates (from each spec's Journeys curation row)

| # | Spec | Type | Target | Change |
|---|---|---|---|---|
| — | — | — | — | (none in this example) |

#### Configuration updates (from each spec's CLAUDE.md & rules and Decision records curation rows)

| # | Spec | Type | Target | Change |
|---|---|---|---|---|
| 14 | 159 | claude.md | Commands | Add `npm run lint:fix` to test workflow |

A `[{genre}-convention]` row renders inside its hosting section (Configuration updates for `[adr-convention]`, Documentation updates for a D2 Diátaxis-genre instance) but carries its own three-way prompt, following the same not-covered-by-"Approve all" rule as Queue writes below — the row's mechanics are unchanged from the single-spec console (`wrap-up/console-template.md`), only its aggregation is per-spec here, the same way Queue writes already aggregates.

#### Reference repairs (from each spec's Broken references curation row)

Render this section whenever any spec's broken-reference sweep found a surviving reference, in either of two states — **applied** (already happened, committed by the controller's serial-commit pass, `curation-engine.md` section 4, with the `Initiative-Fix:` trailer) or **staged** (an ordinary approval row). Omit the section entirely when every spec's sweep found nothing.

| # | Spec | State | Target | Repair | Broken by | Why |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | (none in this example) |

#### Cleanup actions (executed after approval, per row — branch-finish gates the per-spec rows below it)

Render 2 run-level rows (no `Spec` value, rendered as `—`) plus 3 rows per spec with a populated `Spec` column, drawn from `wrap-up/cleanup-procedures-execution.md`'s Section D (ephemeral dev server) and Section E (issue claim release, grant removal, per-issue label cleanup) — the same steps "Shared teardown" below performs, made visible and individually overridable before they execute.

**Branch-finish is a hard prerequisite for every per-spec row below it.** Claim release needs branch-finish's outcome ($LINK — merge commit sha or PR URL) to release each issue correctly; grant removal and label cleanup key off the same outcome. Dev-server teardown has no such dependency and may be skipped independently of every other row.

| # | Spec | Action | Details |
|---|---|---|---|
| 15 | — | Tear down shared ephemeral dev server | `$MULTISPEC_PARENT_DIR/ephemeral-server.txt`, if one was started |
| 16 | — | Finish the shared branch | `pr-first`: `_shared/pr-first-merge.md` (bundle — no prompt). `local-merge`: `/superpowers:finishing-a-development-branch` — merge / PR / discard; every row below depends on this outcome |
| 17 | 157 | Release issue claim | `claims/issue-157.json` on `claims-registry` |
| 18 | 157 | Remove grants | `auto:build`/`auto:merge`, if present |
| 19 | 157 | Per-issue label cleanup | Remove `bot:in-progress`; restore `parked` if applicable |
| 20 | 159 | Release issue claim | `claims/issue-159.json` on `claims-registry` |
| 21 | 159 | Remove grants | `auto:build`/`auto:merge`, if present |
| 22 | 159 | Per-issue label cleanup | Remove `bot:in-progress`; restore `parked` if applicable |

#### Issue closures (issue-derived specs — closes on YOUR merge/push, not by the pipeline)

| # | Spec | Issue | Closes via |
|---|---|---|---|
| 23 | 157 | #84 | `Fixes #84` in the reconciliation merge commit (worktree) or the spec's wrap-up commit (current-branch) — fires on push to the default branch |

Issues resolved without a merge (wontfix/duplicate) list a manual `gh issue close` command
instead — a user action. Omit this section entirely when `manifest.yml`'s `specs[].id`
list is empty (every spec `/flow` runs is materialized from a record).

#### Translated briefs (freeform issues — what the model inferred)

| # | Issue | Translation |
|---|---|---|
| 24 | #85 | `staged/translation-85.md` — original prose → three-section brief |

Omit when the run had no freeform issues.

#### Queue writes (Approve all applies the default; Override drills each item)

Render this section only when leftover routing, the ledger resolve gate (`staged/ledger-record-*.md`), or another step (e.g. a spec's `/reflect` tangential-idea routing) proposed a new work record in any spec's `staged/` — or the parent run dir's own — as a file carrying a `Title:`/`Type:`/`Labels:` header. Aggregated across every spec in the run — each row gets its own prompt; bulk approval is forbidden per `_shared/auto-mode-contract.md`'s work-record-creation row, exactly as `wrap-up/review-console.md`'s Queue writes section. The exact write mechanism (`gh issue create` / `local-store.js`, or — for a skill not yet migrated onto the unified record system — its own destination) lives in the producing spec's own staged file; this table only needs enough to render the prompt.

| Q# | Spec | Destination | What | Source |
|---|---|---|---|---|
| Q1 | 157 | record (parked — trigger: /auth provider docs land) | "Add OAuth refresh edge case" — blocked on /auth provider docs | `spec-157/staged/leftover-add-oauth-refresh-edge-case.md` |
| Q2 | 159 | record (backlog) | "Investigate token rotation strategy" — surfaced during spec 159's build | `spec-159/staged/leftover-investigate-token-rotation.md` |

Below each row, show the full staged file content for the item so the user can see exactly what will be filed. Omit the section entirely when no spec (and no parent-level proposal) staged a record proposal.

#### Memory updates (Approve all applies the default; Override drills each item)

Render this section only when any spec's Memory curation row (or the parent run dir's own) staged a memory-file proposal (`staged/wrap-up-memory-*.md`). Aggregated across every spec in the run — each row gets its own prompt; bulk approval is forbidden per `_shared/auto-mode-contract.md`'s memory-write row, exactly as `wrap-up/review-console.md`'s Memory updates section. A memory file is cross-project and always-loaded — a wrong one degrades every future session in every project.

| M# | Spec | Name | Type | Fact | Index line | Patch |
|---|---|---|---|---|---|---|
| M1 | 157 | dispatch-prompt-conventions | feedback | Restate convention-governed actions in the dispatch prompt | `- [Dispatch prompt conventions](dispatch-prompt-conventions.md) — restate the convention` | `spec-157/staged/wrap-up-memory-1.md` |

Below each row, show the full staged file content for the item so the user can see exactly what would be written. Omit the section entirely when no spec (and no parent-level proposal) staged a memory proposal.

#### Upstream feedback (Approve all declines by default; Override files per item)

Render this section only when any spec's Upstream feedback curation row (or the parent run dir's own) staged one or more upstream defect/gap reports (`staged/wrap-up-upstream-*.md`). Approve all resolves every row here to declined, same as `Q#`/`M#` resolve to their own default (see the terminal-decision note above; the `unattended`-only Auto-resolution short-circuit below is the one exception, where every row resolves to filed instead). Filing requires choosing Override, which aggregates across every spec in the run and runs through `_shared/upstream-feedback-batch.md`'s shared batch contract — one or more chunked `multiSelect` `AskUserQuestion` calls (chunked per that file's own rule, unchecked by default — checking is the explicit approval) instead of one call per item; no per-item gate can be bulk-resolved by a shared toggle even here, per `_shared/auto-mode-contract.md`'s upstream-filing row, exactly as `wrap-up/review-console.md`'s Upstream feedback section. Filing publishes privately-derived content to a public repository; the body shown is already scrubbed.

| U# | Spec | Kind | Component | Summary | Patch |
|---|---|---|---|---|---|
| U1 | 157 | defect | /claude-tweaks:dispatch | Parallel dispatch leaves one agent without a worktree under worktree-always | `spec-157/staged/wrap-up-upstream-1.md` |

Below each row, show the full staged file content for the item so the user can see exactly what would be published. Filing happens after approval by invoking `/claude-tweaks:feedback --pre-confirmed` per checked row. Omit the section entirely when no spec (and no parent-level proposal) staged an upstream proposal.

#### Reflection insights (Approve all applies each row's recommended destination; Override drills each item)

Render this section only when any spec's reflect pass, or the batch-scope reflect pass in the parent run dir (`multispec-batch-curation.md`), staged `staged/wrap-up-reflect-insights.md`. Aggregated across every spec in the run plus the parent's own — `Spec` reads `batch` for a parent-level row — and each file's table rows are renumbered into one `R#` sequence. The Approve-all default and the D4/D5-informational rule are `wrap-up/console-template.md`'s Reflection insights section, per file.

| R# | Spec | Insight | Causal | Recommended Destination |
|---|---|---|---|---|
| R1 | batch | Retry helper swallowed the last error, hiding the real cause | systemic | Implement now -> Skill: error-handling |
| R2 | 159 | Token refresh and session expiry share no clock source | — | Defer — genuinely-larger |

Omit the section entirely when no spec (and no parent-level pass) staged an insights file.

#### Not run / Failed (if any spec didn't complete cleanly)

| Spec | Status | Reason | Worktree |
|---|---|---|---|
| 159 | failed | test gate (3 type errors) — see `spec-159/decisions.md` | shared `.worktrees/flow/spec-157-159-160` (commits up to 159) |
| 160 | not-run | previous spec failed (159); `keep-going` not set | — |

The run shares **one** worktree (see `multi-spec.md`, "Shared worktree"), so the Worktree column names the single shared path once on the first failed/blocked row — there is no per-spec worktree. Under `parallel`, an unmerged wave member's row puts `(branch {name})` in this column instead — its kept branch (`multispec-parallel-waves.md`).

Status values:
- **failed** — spec hit a HARD-GATE. In a sequential run this row exists only under `keep-going`, which continued the run; a failed `parallel` wave member gets it either way. Its worktree or kept branch is preserved for inspection.
- **not-run** — spec was skipped because an earlier spec failed and `keep-going` was not set. No worktree was created — except for a `parallel` wave sibling that built and tested in its own worktree but was not merged, whose row names its kept branch.
- **running** (stuck) — spec started but the run never reached `/wrap-up`'s Phase 4 execution step or a HARD-GATE for it (rare; e.g., subagent crash). `manifest.yml`'s status schema (`multi-spec.md`) has no dedicated `incomplete` value and no procedure ever writes one — a crash simply leaves the entry at whatever status it last had, almost always `running`. Treat any spec whose manifest status is still `running` when the console renders as this case.

Populate this footer from `manifest.yml` — any spec with `status: failed`, `not-run`, or still `running` gets a row.

Below each table, patch display follows `wrap-up/console-template.md`'s reversibility-tiered rule verbatim — see that file's tiering section for the low/med/high cases and the fail-open default.
```
