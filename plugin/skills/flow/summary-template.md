# Flow — Pipeline Summary Template

Loaded by `/claude-tweaks:flow` Step 5 **only on successful completion of all steps** (`wrap-up` in the step list). Never rendered on the failure path — see `failure-cards.md` for that template.

**Reconcile residue line (#644).** Immediately before rendering the template below, run `node "{pluginRoot}/bin/hooks.js" reconcile-summary` and capture its one stdout line verbatim for the **Reconcile:** field — never hand-compose this line or re-derive its counts, and never skip the call: this is the only place in the pipeline that surfaces reconcile's stuck/declined residue (`bin/lib/reconcile`'s own convergence checks run silently off the SessionStart hot path and a detached background process; nothing else in `/flow` reads their output). The command always succeeds and always prints exactly one line — a background pass that hasn't completed yet reads as `0 archived`, an unreachable mirror reads as `mirror ff n/a` — so there is no failure mode here to branch on.

On successful completion of all steps (`wrap-up` in the step list):

```markdown
## Flow: Pipeline Complete

### Spec {number}: {title}

| Step | Outcome |
|------|---------|
| build | Verification passed |
| stories | {Generated N stories | Skipped — no UI changes | Skipped — no-stories} |
| test | {Passed (types + lint + tests) | Passed (QA: N stories) | Passed (verification skipped — passed in build, QA: N stories)} |
| review | Verdict: PASS {(code + visual) | (code only — no browser)} |
| polish | {Invoked N commands ({list}); re-verify passed | Skipped — non-frontend | Skipped — no-polish | Skipped — fast-lane | Skipped — Impeccable not installed | No changes to apply | re-verify failed (see failure card)} |
| wrap-up | Learnings captured, artifacts cleaned, ledger resolved |

**Release status:** {the one-line human form from `_shared/pr-first-merge-post-merge.md` Step 4.1, verbatim — `not yet in a release — bump pending` | `already carried by vX.Y.Z — CHANGELOG backfill needed: #A, #B` | `already carried by vX.Y.Z — CHANGELOG has no vX.Y.Z entry; backfill needed: #A, #B` | `already carried by vX.Y.Z — every record named in CHANGELOG` | `n/a — no plugin manifest at {ref}` | `release status unavailable — {reason}` | `n/a — not merged in this run (outcome: {armed | pending-review})`}
{On either backfill form, one more line: **Backfill:** staged at `staged/release-backfill-vX.Y.Z.md` (archived with the run); posted as PR #{n}'s `release-status` comment — drop the PR clause under local-merge.}

**Reconcile:** {one line from `node "{pluginRoot}/bin/hooks.js" reconcile-summary`, run once here and printed verbatim — `reconcile: {archived} archived, {stuck} stuck (oldest {age}), mirror ff {ok | declined — {reason} | anomaly — {state} | skipped — {reason} | failed — {reason} | n/a}`}

### Timing

Rendered verbatim from `node "${CLAUDE_PLUGIN_ROOT}/bin/phase-timing.js" --run "$PIPELINE_RUN_DIR" --markdown --auto-transcript` (#1928) — never composed by hand; a phase with no event reads `unattributed`. `{Minutes}` is the phase's span, with `(own N)` when nested phases are excluded. An `unattributed` table row (below `total`'s neighbor rows, above `total` itself) appears only when transcript usage rows fall outside every phase's span (#1929). When wrap-up's cleanup item 8 has already archived the run directory (`cleanup-procedures.md`), pass `$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/` as `--run` instead — the events and manifest travel with the archive. When the CLI prints a `tokens: transcript not found (...)` line, render it verbatim above the table — blank token columns are a fact about the run, not a formatting error (#1929). `Tokens (in/out)` sums the transcript's raw `input_tokens`/`output_tokens` only — cache reads and cache creation are separate fields in `timing.json`'s `tokens`, and on a cache-heavy session dwarf `in`.

| Phase | Minutes | Verify | Tokens (in/out) | Proc. KB | Tool RTs |
|---|---|---|---|---|---|
| {phase} | {minutes} | {mode ×n | — | unattributed} | {in/out | —} | {kb | —} | {n | —} |
| unattributed | — | — | {in/out} | {kb} | {n} |
| total | {totals.minutes} | {verifyRuns} run(s) ({modes}) | {in/out} | {kb} | {n} |

Guard denials: {n} gate · {n} wd-ambiguous · {n} wd-deny

### Key Outputs
- {summary of what was built}
- {summary of review findings, if any}
- {summary of wrap-up actions taken}

### Manual Steps Required
| # | What | Where |
|---|------|-------|
| 1 | {description} | {source} |
(or: No manual steps — nothing to do outside the codebase.)

> Complete these after merging. The pipeline detected them but cannot execute them.

### Actions Performed

{Rolled-up table from all phases. When >15 rows, collapse to per-phase summaries.}

| Action | Detail | Ref |
|--------|--------|-----|
| {rows from build, stories, review, polish, wrap-up phases} | ... | ... |

### Creative Opportunities

The polish phase ran the refinement set + suggestion-driven + intent-driven commands. These could enhance the result further:

| Command | Why it might help |
|---------|------------------|
| `/impeccable:impeccable colorize dashboard` | Heavy monochrome — strategic accent color recommended |
| `/impeccable:impeccable animate settings` | Toggle interactions are static |

Each is a one-shot manual command; flow does not run these automatically.

> Render this block only when `survey` returned `recommendations` non-empty. When the wrapper reports `suppressed > 0`, append: `> N suggestion(s) hidden — previously declined for this spec. Reset with /claude-tweaks:design-wrapper reset-recommendations <spec>.` Omit the entire section when the wrapper returned `recommendations: []` or `{skipped}`, or when `no-creative` was set (the survey never ran).

### Depth Opportunities

The depth survey analyzed the changed modules. These are shallow abstractions worth restructuring — `/flow` did **not** refactor them (architecture is low-reversibility; the depth refactor is a deliberate, interactive pass):

| Module | Kind | Why it's shallow | Leverage |
|--------|------|------------------|----------|
| `src/services/user.ts` | collapse | Pass-through wrapper — every method forwards one call to the DB | 4 callers simpler |
| `src/jobs/runner.ts` | deepen | Callers must call `init()`→`configure()`→`run()` in order; the module could own the sequence | smaller surface, 3 callers |

Run `/claude-tweaks:deepen <changed-paths>` to act on these — it presents candidates, then walks the interface design for the ones you pick. Flow never runs this automatically.

> Render this block only when the depth survey returned candidates. Cap at the top 3 by leverage; if more exist append `> N more lower-leverage candidates — run /claude-tweaks:deepen for the full list.` Omit the entire section when the survey found no shallow modules, the pre-check skipped it (no source modules changed), or `no-deepen` was set.
```

### Next Actions

Close the template's fence above, then assemble the applicable lines (the base 2 always; the four conditional lines only when their trigger condition holds) and render them as plain markdown (docs/skill-authoring.md's Skill handoffs convention), unfenced prose:

**`/claude-tweaks:flow {next spec}`** — full pipeline on spec {N}: "{title}" (recommended)
`/claude-tweaks:help` — full pipeline status
`/claude-tweaks:build {N}` — spec {N} "{title}" now unblocked — when unblocked specs exist
`/claude-tweaks:deepen {changed-paths}` — act on the {N} depth opportunit{y/ies} surfaced above — when the depth survey surfaced candidates
`node plugin/bin/release.js {minor|patch} "{summary}"` — cut the release, this merge is not yet in a shipped version | `{backfill command}` — already shipped in vX.Y.Z, the CHANGELOG is missing this record — when this project has a documented release procedure
`PIPELINE_RUN_DIR="{run-dir}" /claude-tweaks:flow "{target}" wrap-up` — resume to re-offer the merge decision, PR #{n} is ready — when this run's own outcome is armed/pending-review under pr-first

**Release row.** Render only when the project has a documented release procedure (here: `docs/releasing.md` and `plugin/bin/release.js`) and the ancestry check that decides between the two forms actually ran and produced a result — never render a release row from an unverified premise, and never render one at all when the check couldn't run. This project already ran that check in `wrap-up` (`_shared/pr-first-merge-post-merge.md` Step 4.1) and printed its one-line result as the fenced template's **Release status:** field above — reuse that value verbatim rather than re-running the check:

- `not yet in a release — bump pending` → render **`node plugin/bin/release.js {minor|patch} "{summary}"`** — cut the release.
- `already carried by vX.Y.Z — CHANGELOG backfill needed: …` or `…has no vX.Y.Z entry; backfill needed: …` → render `{apply the staged staged/release-backfill-vX.Y.Z.md content}` — already shipped in vX.Y.Z, backfill the CHANGELOG.
- `already carried by vX.Y.Z — every record named in CHANGELOG` → nothing to do; omit the release row entirely.
- `n/a — …` or `release status unavailable — …` → the check didn't resolve; omit the release row entirely.

A project with a release procedure but no `plugin/bin/release.js status`-shaped subcommand has no Release status field to reuse — render the row from the two inline git commands the check itself is: `git fetch origin && git merge-base --is-ancestor <merge> <newest-bump-commit>` (exit 0 = already shipped, use the "already shipped" form; non-zero = the "cut the release" form). Still omit the row if that check cannot be run (no merge commit resolvable, no prior release to compare against).

**Recommended slot.** The release row is never marked `(recommended)` while `/claude-tweaks:flow {next spec}` is present — the next spec's pipeline is the standing default. When this run has no next spec (the last spec of a batch, or a standalone run), the "cut the release" form takes the `(recommended)` slot instead of `/claude-tweaks:help`; the "backfill the CHANGELOG" form is never marked `(recommended)` — it's housekeeping, not the primary next step, in either position.

**Resume-to-merge row.** Render only under `integration-model: pr-first` (`_shared/integration-model.md`), only when this run's own merge outcome is `armed` or `pending-review` (the run ended without a confirmed `merged` result — whether because the Auto-merge short-circuit never triggered, its content judgment declined, or the terminal Review Console's own merge option was answered "leave PR open" / the console was stopped). Never render this row when the outcome is `merged` (nothing left to resume) or under `local-merge` (no PR, no resume-to-merge shape — the branch-finish handoff already ran inline). The row:

`PIPELINE_RUN_DIR="{run-dir}" /claude-tweaks:flow "{target}" wrap-up` — resume to re-offer the merge decision, PR #{n} is ready

This is the recommended slot only when no next spec exists in this run (same precedence rule the release row's own "Recommended slot" note above already states — resume-to-merge and the release row never both claim `(recommended)`; resume-to-merge wins when both would otherwise apply, since a run that hasn't merged yet has nothing to release into a version bump).
