# Pipeline End-of-Run Surveys

Loaded by /flow Step 5 (Present Pipeline Summary). Two read-only surveys run here, both producing recommendation blocks rendered before Next Actions, and **neither one ever performs the action it recommends** — they hand the user a vetted, ranked list to act on deliberately:

1. **Creative Opportunities** — creative Impeccable commands (this file, below).
2. **Depth Opportunities** — architectural depth candidates from `/claude-tweaks:deepen` (this file, "Pipeline Depth Survey" section).

This is the responsible way `/flow` captures the value of low-reversibility work in a hands-off run: it runs the *analysis* automatically and surfaces the findings, but the *action* (running a creative command, or doing a two-stage depth refactor) stays a manual, deliberate follow-up.

## Pipeline Creative Opportunities Survey

Enabled by default in `auto` and `interactive` (the wrapper handles `{skipped}` returns silently). Opt out with the `no-creative` flag (or `creative-survey: off` in `.claude-tweaks/policy.yml`), mirroring the Depth Opportunities survey's `no-deepen` / `depth-survey: off` mechanics below.

The survey produces the **Creative Opportunities** block rendered before Next Actions — ranked recommendations for creative Impeccable commands the user might want to run manually. Flow never invokes these commands automatically.

## When to run

Run the survey before rendering the Pipeline Summary, after the resolve gate completes (nothing-left-behind), and only when `no-creative` was not set and `creative-survey` does not resolve to `off` — `CREATIVE_SURVEY=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values creative-survey)` — when skipped, omit decline detection, the wrapper call, and the block entirely. Decline detection runs **after** the skill-load gate (a gate `skip` omits it — it only feeds the wrapper) and **before** the survey call so the wrapper can suppress repeatedly-declined recommendations.

## Survey procedure

**Creative Opportunities survey (v4.5.0).** Before rendering the summary and before decline detection, run the gate per `_shared/skill-load-gate.md` with `--skill design-wrapper --mode survey`, `--files` the `<changed-files>` of the full diff produced by the pipeline, `--surface` where that file finds one, and `--run "$PIPELINE_RUN_DIR" --section "/flow" --step "Creative Opportunities survey"`. On `skip`, do not invoke the wrapper; skip decline detection and omit the block, as for a `{skipped: ...}` return below. On `proceed`, run decline detection, then invoke `/claude-tweaks:design-wrapper survey <changed-files>`. The wrapper analyzes the diff heuristically (no screenshots are passed — `/flow` does not maintain its own browser session) and returns ranked recommendations for creative commands the user might want to run manually. Render the recommendations as a Creative Opportunities block (template in SKILL.md Step 5) before the Next Actions block.

Handle the wrapper return:

| Return shape | Action |
|--------------|--------|
| `{result: "ok", recommendations: [...]}` non-empty | Render the Creative Opportunities block from the template. Write the wrapper's `recommendations` cache (the wrapper does this itself — `docs/plans/...-recommendations.json`). |
| `{result: "ok", recommendations: []}` | Omit the block. Survey ran but matched nothing — not a failure. |
| `{skipped: ...}` | Omit the block. Skip reasons are non-frontend, no Impeccable, integration disabled — none of these warrant surfacing in the summary. |

## Decline detection

**`/flow` owns the decline-detection algorithm.** The `/claude-tweaks:design-wrapper survey` wrapper is a read-only consumer: it reads the declined cache that `/flow` writes (and the `suppressed_count` the wrapper surfaces back is just the count of entries `survey` chose to drop based on that cache). `/flow` is the only writer of `docs/plans/...-declined.json` because it is the only caller that has both the prior recommendations cache AND the new pipeline diff to compare against.

**Decline detection (Phase 3).** Before invoking survey, read the prior `docs/plans/...-recommendations.json` cache (if it exists) for this spec. After the new pipeline diff is final (post-polish, post-re-verify), compare the prior recommendations against the diff:

- For each prior recommendation, check whether its expected file changes appear in the new diff. The expected change is "the suggested command was invoked and modified the recommended page" — heuristic: a file path counts as evidence when it matches the recommendation's `page` substring AND was touched by a commit landing between the previous and current pipeline run. This touched-file check is the entire heuristic — there is no separate content-based "diff signature" beyond it, so an unrelated commit that happens to touch the same file (e.g. an incidental bug fix) also counts; the heuristic is deliberately coarse, not proof the recommended command specifically ran.
- For prior recommendations whose expected changes did NOT appear, increment `decline_count` for that `(command, page)` in `docs/plans/...-declined.json`. Initialize the entry if absent.
- The wrapper's survey call (next step) reads this declined cache and suppresses observations whose `decline_count >= 2`.

Decline detection runs only when a prior recommendations cache exists for the same spec. First-run flows have no prior recommendations to compare against — skip detection silently. Reset path for the user: `/claude-tweaks:design-wrapper reset-recommendations <spec>` deletes the declined cache.

---

## Pipeline Depth Survey

Enabled by default; opt out with the `no-deepen` flag (or `depth-survey: off` in `.claude-tweaks/policy.yml`). This is how a hands-off `/flow` run captures the value of `/claude-tweaks:deepen` **responsibly** — it runs the depth *analysis* automatically and surfaces ranked candidates, but never performs an architecture refactor unattended.

### The responsibility boundary (read this first)

Depth refactors are low-reversibility and their core loop is interactive (the two-stage interface conversation). `/flow` is hands-off. So in a pipeline run, `/flow` invokes **only the analysis half** of `/deepen`:

- **What runs automatically:** module mapping, the deletion test, leverage ranking — all read-only (Steps 1-3 of `/deepen`, the auto path from its Component-Skill Contract).
- **What never runs in flow:** the interface-design conversation (Step 4) and any code change (Step 5). `/flow` never applies or auto-approves a depth refactor. Staging is the one nuance: `/deepen`'s own auto path may stage a validated `deepen-collapse-{n}.patch` for a narrow collapse candidate (its Step 3 Auto mode, per `_shared/staged-patch.md`) — a proposal for the Review Console, never applied in-run, and excluded from unattended zero-click apply by that contract's Unattended floor.

The output is a recommendation, identical in spirit to Creative Opportunities: "here is what's shallow and worth deepening — run `/claude-tweaks:deepen` yourself when you want to act on it."

### Pre-check (cost gate)

Depth analysis reads call sites, so don't run it on diffs where it can't find anything. Skip the survey entirely (omit the block, no `/deepen` invocation) when **any** of:

- `no-deepen` was passed, or `depth-survey` resolves to `off` — `DEPTH_SURVEY=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values depth-survey)`.
- The pipeline diff added/changed **no source modules** (e.g., config-only, docs-only, or pure test changes). Use `git diff --name-only` against the run's base — if no non-test source files with module structure changed, skip.
- The diff is trivial (single-file, no new exports/modules introduced).

### Survey procedure

Run after the resolve gate, alongside the Creative Opportunities survey. Invoke `/claude-tweaks:deepen <changed-source-files>` with `$PIPELINE_RUN_DIR` set (this triggers `/deepen`'s analysis-only pipeline path). The skill returns its ranked candidate list **without applying anything**. Render the top candidates as a Depth Opportunities block (template in SKILL.md Step 5) before Next Actions.

Handle the return:

| Return shape | Action |
|--------------|--------|
| Ranked candidates non-empty | Render the Depth Opportunities block — cap at the top 3 by leverage; if more exist, append a `> N more lower-leverage candidates — run /claude-tweaks:deepen for the full list.` line. |
| No candidates (`"No shallow modules found in scope"`) | Omit the block. The analysis ran and the abstractions are earning their keep — not a failure. |
| `/deepen` reports nothing in scope (no source files) | Omit the block. |

The recommendation in the block is a one-shot manual command: `/claude-tweaks:deepen <changed-paths>` (paths, not the record id — paths work uniformly across single- and multi-record runs, and the merged/committed code is what `/deepen` actually needs to diff). Acting re-runs the analysis fresh against the current tree, so nothing needs to be cached between the survey and the user's later run.
