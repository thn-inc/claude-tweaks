# Flow — Pipeline Summary Template

Loaded by `/claude-tweaks:flow` Step 5 **only on successful completion of all steps** (`wrap-up` in the step list). Never rendered on the failure path — see `failure-cards.md` for that template.

**Reconcile residue line (#644).** Immediately before rendering the template below, run `node "{pluginRoot}/bin/hooks.js" reconcile-summary` and capture its one stdout line verbatim for the **Reconcile:** field — never hand-compose this line or re-derive its counts, and never skip the call: this is the only place in the pipeline that surfaces reconcile's stuck/declined residue (`bin/lib/reconcile`'s own convergence checks run silently off the SessionStart hot path and a detached background process; nothing else in `/flow` reads their output). The command always succeeds and always prints exactly one line — a background pass that hasn't completed yet reads as `0 archived`, an unreachable mirror reads as `mirror ff n/a` — so there is no failure mode here to branch on.

**Needs-a-human residue (#3370).** Immediately before rendering the template below, run `node "{pluginRoot}/bin/console-residue.js" --run "$PIPELINE_RUN_DIR"` — with `$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/` as `--run` when wrap-up's cleanup has already archived the run directory (`_shared/timing-render.md`'s archive-path rule) — and render its stdout verbatim under `### Needs a human`, never hand-composing it. Omit the section only when the command exits 0 with empty stdout; on any non-zero exit, render the CLI's stderr verbatim under the heading, so a failed scan never reads as "no residue". An unattended console's pending/contested items are never auto-applied, so this is the run's own final human stop for them.

**Try it is mandatory (#2821).** Render the `### Try it` section on every successful run, including a record below the oversight floor — the floor gates `demo:pending` and the sign-off ceremony, and never gates this section. Its body is the block `wrap-up/verification-brief.md` composed for this record, per `_shared/try-it.md`, read verbatim from the session-scoped file: `eval "$(node "{pluginRoot}/bin/session-tmp-resolve.js" TRY_IT=try-it-{number}.md)"`, which sets `$TRY_IT` to the file's path, not its content — then read the file at that path (Read tool, or `cat "$TRY_IT"`) and render its body verbatim, minus its own heading line. When the file cannot be used, compose it per `_shared/try-it.md`'s Rules — never omit the section.

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

**Release status:** {the one-line human form from `_shared/pr-first-merge-post-merge.md` Step 4.1, verbatim — `already carried by {tag}` | `not yet in a release — bump pending` | `release status unavailable — {reason}` | `n/a — not merged in this run (outcome: {armed | pending-review})`}

**Reconcile:** {one line from `node "{pluginRoot}/bin/hooks.js" reconcile-summary`, run once here and printed verbatim — `reconcile: {archived} archived, {stuck} stuck (oldest {age}), mirror ff {ok | declined — {reason} | anomaly — {state} | skipped — {reason} | failed — {reason} | n/a}`}

### Needs a human

{stdout of `node "{pluginRoot}/bin/console-residue.js" --run "$PIPELINE_RUN_DIR"`, verbatim — omit this whole section only on exit 0 with empty stdout; on any non-zero exit, the CLI's stderr verbatim instead}

### Try it

{spec {number}'s Try it block (`_shared/try-it.md`) — the body of the session-scoped `try-it-{number}.md`, verbatim, minus its own heading line. When this run opened the record's parent gate, the file also carries the parent's appended `### Try it — end to end` section (`wrap-up/verification-brief-parent-gate.md`): it renders after this block as its own section, heading kept}

### Timing

{stdout of `node "${CLAUDE_PLUGIN_ROOT}/bin/phase-timing.js" --run "$PIPELINE_RUN_DIR" --markdown --auto-transcript` (#1928), rendered verbatim per `_shared/timing-render.md` — the phase table, its notes, the archive-path `--run` rule, and the Dispatches section; never composed by hand}

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
`/claude-tweaks:release` — cut the release — per `_shared/release-recommendation-gate.md`
`PIPELINE_RUN_DIR="{run-dir}" /claude-tweaks:flow "{target}" wrap-up` — resume to re-offer the merge decision, PR #{n} is ready — when this run's own outcome is armed/pending-review under pr-first

**Release row.** Run `_shared/release-recommendation-gate.md`'s pack call and gate against its table — since `wrap-up` ran as an inherited step in this pipeline (it never renders its own Next Actions block in that case, `wrap-up/SKILL.md`'s Component-Skill Contract), this is this run's own call, not a re-read of one `wrap-up` already made.

**Recommended slot.** The release row is never marked `(recommended)` while `/claude-tweaks:flow {next spec}` is present — the next spec's pipeline is the standing default. When this run has no next spec (the last spec of a batch, or a standalone run), it takes the `(recommended)` slot instead of `/claude-tweaks:help`.

**Resume-to-merge row.** Render only under `integration-model: pr-first` (`_shared/integration-model.md`), only when this run's own merge outcome is `armed` or `pending-review` (the run ended without a confirmed `merged` result — whether because the Auto-merge short-circuit never triggered, its content judgment declined, or the terminal Review Console's own merge option was answered "leave PR open" / the console was stopped). Never render this row when the outcome is `merged` (nothing left to resume) or under `local-merge` (no PR, no resume-to-merge shape — the branch-finish handoff already ran inline). The row:

`PIPELINE_RUN_DIR="{run-dir}" /claude-tweaks:flow "{target}" wrap-up` — resume to re-offer the merge decision, PR #{n} is ready

This is the recommended slot only when no next spec exists in this run (same precedence rule the release row's own "Recommended slot" note above already states — resume-to-merge and the release row never both claim `(recommended)`; resume-to-merge wins when both would otherwise apply, since a run that hasn't merged yet has nothing to release into a version bump).
