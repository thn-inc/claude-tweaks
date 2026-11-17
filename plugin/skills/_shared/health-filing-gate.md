# Health Filing Gate — Canonical Ask-Before-File Rule

`code-health`, `harness-health`, `journey-health`, `docs-health`, and `ci-health` each end their SELECT (ci-health's: GATHER) → JUDGE → VALIDATE/DEDUP → FILE pipeline with an interactive decision over which surviving findings actually become GitHub issues. This file is the one place that decision's *applicability*, *scope*, *placement*, *menu shape*, and *per-consumer batch table* are defined.

**Consumers no longer inline this gate.** Each one's FILE step carries a short pointer here, conditioned on interactive mode. The reason is Applicability below: a headless Routine firing skips this gate outright, and scheduled firings are how these skills primarily run — so an inlined copy was a block every scheduled firing loaded and never executed. Reading this file is therefore the interactive path's cost, not every path's.

What a consumer still keeps inline is only what its **headless** path also needs: the one-line conditioning sentence that scopes its Type-expression branch (see Placement), and any hold-back rule that applies when filing automatically. Everything below is the interactive path's, and belongs here.

## Applicability

Interactive (standalone) mode only. A headless Routine firing has no human present to ask — it skips this gate entirely and files every surviving finding automatically, per each skill's own Routine Configuration section.

## Scope

The gate applies only to *this firing's own brand-new findings* — the payloads surviving the verify gate and dedup that are about to be created for the first time. It does **not** re-prompt for:

- **Retry-queue drains** — a prior firing's filing that failed and is now being retried. It was already approved in that earlier firing; retrying a transient `gh` failure isn't a new proposal.
- **Regressed reopens** — an existing issue whose finding has reappeared. Reopening isn't creating anything new.

Both categories file/reopen unconditionally, before this gate ever runs.

## Placement

The gate MUST execute **inside the calling skill's own FILE step** — after retry-queue-drain and regressed-reopen handling, and before the action that turns a surviving new finding into a `gh issue create` call. It must never live in a SUMMARIZE/reporting step: that step runs after filing, by definition, so a gate placed there can't gate anything.

**A subtler version of the same bug:** being inside the FILE step is necessary but not sufficient. Every consumer also documents a "Type expression branch" — reference syntax showing how to construct the `gh issue create` command for `work-types: native` vs. `work-types: labels`. That section's own connecting sentence ("Apply the same branch to every payload regardless of `{classification|kind|category}`...") reads as an unconditional execution instruction when an agent follows the file top-to-bottom, not as inert documentation — regardless of authorial intent. The gate must sit **before** that connecting sentence, with an explicit conditioning sentence between them ("For each survivor disposed as 'File issue' ... call `gh issue create`") that scopes "every payload" in the sentence that follows to mean "every surviving, gated payload," not "every payload in the full findings set." Positioning the gate merely somewhere inside the FILE step, without checking it precedes every such connecting sentence, reproduces the exact dead-gate bug this file exists to prevent — this happened once already: `code-health`, `harness-health`, and `docs-health` all needed this fix, and even `journey-health` — despite having its `AskUserQuestion` block correctly inside FILE rather than SUMMARIZE — still had its own Type-expression-branch's unconditional-sounding language (a line 211 that said outright "every finding files, unconditionally") sitting *before* the gate until this was caught and fixed. "Inside FILE, not SUMMARIZE" was necessary; "before the Type-expression-branch's own filing trigger" is the actual sufficient condition.

## Canonical menu shape

Every consumer renders its own batch table (columns matching its own Finding Shape, plus a `Recommended` column) and then calls `AskUserQuestion`:

- `question`: `"How do you want to handle these findings?"`, `header`: `"Findings"`, `multiSelect`: `false`
  - Option 1 — `label`: `"Apply all recommended (Recommended)"`, `description`: `"File / Capture each finding per the Recommended column above"`
  - Option 2 — `label`: `"Override specific items"`, `description`: `"Tell me which #s to change"`

If "Override specific items" is chosen, the follow-up is ordinary free-text chat in the next message, per docs/skill-authoring.md's Multi-item decisions convention — not the tool's `Other` field (a single answer to the batch question above, not a per-item list). The user names findings by number and states each one's disposition — `File issue` (file as a GitHub `by:{skill}` issue), `Capture` (via `/claude-tweaks:capture` for later triage), `/claude-tweaks:specify directly` (promote straight to a spec, skipping the issue), or `Dismiss` (run `mark <id> declined` so it doesn't reappear) — e.g. "file 2, capture 5, dismiss 7." Apply the stated disposition to those specific findings; every finding not named keeps its Recommended-column value from the batch table.

## Per-consumer batch table and pre-fill rule

Each consumer renders the columns its own Finding Shape computes. Render the header row plus one row per surviving finding, with the last column pre-filled per the rule beside it:

| Consumer | Columns | Recommended pre-fill |
|---|---|---|
| `code-health` | `\| # \| Title \| Criterion \| Severity \| Confidence \| Stale? \| Recommended \|` | high severity + high confidence → `"File issue"`; `confidence: low` → `"Capture"`; everything else (e.g. medium severity + high confidence) → `"File issue"` — filing is the safe default once a finding clears the confidence bar. **Exception:** a finding flagged `possiblyStale` always pre-fills `"Capture"`, overriding the rule above — its anchor changed after the judge read it, so it needs human re-confirmation against current content rather than being filed sight-unseen. |
| `harness-health` | `\| # \| Title \| Category \| Classification \| Confidence \| Reversibility \| Recommended \|` | `confidence: high` or `med` → `"File issue"`; `low` → `"Capture"`. |
| `journey-health` | `\| # \| Journey \| Category \| Section \| Severity \| Confidence \| Recommended \|` | `confidence: high` or `med` → `"File issue"`; `low` → `"Capture"`. |
| `docs-health` | `\| # \| Title \| Category \| Misleads \| Classification \| Confidence \| Recommended \|` | `confidence: high` or `med` → `"File issue"`; `low` → `"Capture"`. |
| `ci-health` | `\| # \| Title \| Check \| Workflow \| Subject \| Recommended \|` | Every row → `"File issue"`: a finding that survived `validate-findings` carries no confidence tier to grade. |

A finding filtered out by that consumer's confidence/risk floor (`--min-confidence`, or code-health's `--min-risk`) never reaches this table at all — the `validate-findings` step already diverted it into the `remembered` cache before the FILE step runs.

For "Dismiss," run the consumer's own `mark` command, so the same proposal doesn't reappear on a future firing (`<root>` is whatever root that skill's FILE step already resolved — `.` or `"${ROOT:-$PWD}"`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness-health.js" mark "<payload.id>" declined --root <root>
node "${CLAUDE_PLUGIN_ROOT}/bin/journey-health.js" mark "<payload.id>" declined --root <root>
node "${CLAUDE_PLUGIN_ROOT}/bin/docs-health.js"    mark "<payload.id>" declined --root <root>
```

`code-health` and `ci-health` are the exceptions: neither CLI has a `mark` subcommand or a persistent decline cache, so their "Dismiss" simply drops the finding.

Turning the resolved dispositions into `gh issue create` calls is **not** described here: that is the consumer's own conditioning sentence, which per Placement above must stay inline in its FILE step, immediately before its Type expression branch. Restating it here would put the sentence that scopes "every payload" in a file the headless path never reads.

"Dismiss" always runs the consumer's own `mark <id> declined` CLI command so the same proposal doesn't reappear on a future firing — except `code-health` and `ci-health`, whose CLIs have no `mark` subcommand; their "Dismiss" description stays `"Drop this finding"` since neither has a persistent decline cache to write to.
