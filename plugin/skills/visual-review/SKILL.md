---
name: visual-review
description: Use when you want to visually review a running application in the browser — inspect UI quality, walk user journeys, discover undocumented journeys, or generate creative improvement ideas. Works standalone or as a step within /claude-tweaks:review.
argument-hint: "[<url>|journey:<name>|discover [--budget <n>]|--mode=recommendation] [--source <parent-skill>]"
---

# Visual Review — Browser-Based UI Inspection

Review a running application through the browser: first impressions, persona-based interaction, structured analysis, performance vitals, and creative reimagination. Part of the workflow lifecycle:

```
/claude-tweaks:build → /claude-tweaks:test → /claude-tweaks:review → /claude-tweaks:wrap-up
                                                     │
                                             [ /claude-tweaks:visual-review ]
                                              (page, journey, or discover mode)
```

This SKILL.md is the **orientation + mode resolution** layer. The mechanical browser procedures (warm-up, batch walks, vitals capture, trace on failure, the review flow itself) live in `browser-review.md` in this skill's directory — that file is canonical. Step 3 below lists exactly what it holds.

## When to Use

- After a build — visually inspect what was built
- To walk a documented user journey and test its "should feel" expectations
- To discover and document journeys in a brownfield project
- During `/claude-tweaks:review` Step 6 — invoked in **full** mode
- After QA test runs — leverage screenshots and page inventories for enriched review
- Standalone visual inspection of any running web application

## Input

`$ARGUMENTS` is parsed as `[<url>|journey:<name>|discover [--budget <n>]|--mode=recommendation] [--source <parent-skill>]` — see Modes and Mode Resolution below for what each token resolves to.

## Modes

| Mode | Input | What happens |
|------|-------|-------------|
| **page** | URL or description | Review a single page or flow. Full creative framework + vitals. |
| **journey** | `journey:{name}` | Walk a documented journey step by step using a single batch invocation. Each step reviewed against its "should feel" / "red flags." Vitals captured per page. |
| **discover** | `discover [--budget <n>]` | Explore the running app to identify and document undocumented user journeys. Vitals captured per discovered page. `--budget <n>` caps the walkthrough to the top `n` scored candidates instead of walking every candidate found — see `discover-mode.md` Phase 2. |
| **recommendation** | `--mode=recommendation` (typically passed by `/review` Step 6 code-only) | Detect UI changes via `git diff` and identify affected journeys. Returns a structured recommendation (which journeys to walk, severity) without opening the browser. No agent-browser dependency. |

### When to use each mode

- **Journey mode** is the richer review — defined persona, goal, and experiential expectations at every step. Use when a documented journey exists for the affected flow.
- **Page mode** is for quick checks, single-page changes, or pages that aren't part of a defined journey yet.
- **Discover mode** is for brownfield projects that need journey coverage bootstrapped — codebase scan + browser walkthrough produces new journey files.
- **Recommendation mode** is for callers that need a "should we walk anything?" signal without committing to a full browser review — used by `/review` Step 6 in code-only mode to surface journey suggestions in the review summary.

## Mode Resolution

`$ARGUMENTS` controls mode and target.

### Standalone (invoked directly):

```
/claude-tweaks:visual-review http://localhost:3000           → page mode
/claude-tweaks:visual-review journey:checkout                → journey mode
/claude-tweaks:visual-review discover                        → discover mode
/claude-tweaks:visual-review discover --budget 5              → discover mode, capped to the top 5 scored candidates (see discover-mode.md Phase 2)
/claude-tweaks:visual-review --mode=recommendation             → recommendation mode (no browser; typically passed by /review Step 6 code-only)
/claude-tweaks:visual-review                                 → page mode, auto-detect dev URL
```

### Pipeline context (invoked by `/review`):

The parent skill passes:
- **Mode** — `full` (code + visual), `visual`, `journey:{name}`, or `discover`
- **QA data** — when available from a recent `/claude-tweaks:test` run
- **Spec context** — spec number or changed files for scoping

When invoked by `/review` in **full** mode, the visual review runs after code review steps complete. In standalone visual/journey/discover modes, the code review is skipped.

### Fallback signal (`--source`)

When a parent skill invokes this one but has no `$PIPELINE_RUN_DIR` of its own to signal pipeline context (e.g. a standalone `/claude-tweaks:wrap-up` running its verification-brief safety-net gate, or `/claude-tweaks:journey-health` running standalone or on a schedule), it passes `--source <parent-skill>` instead — see the Component-Skill Contract below for the full signal precedence and the list of recognized callers.

Example: `/claude-tweaks:visual-review journey:checkout --source wrap-up`

## Step 0.5: Mode — `recommendation` (short-circuit)

When the resolved mode is `recommendation` (typically invoked as `--mode=recommendation` from `/claude-tweaks:review` Step 6 code-only), skip the browser entirely and produce a structured recommendation instead. This mode has no `agent-browser` dependency and no dev URL requirement.

Procedure:

1. **Resolve scope** — accept the changed-files list from the parent (preferred) or fall back to `git diff --name-only` against the base branch.
2. **Cross-reference with journeys** — read `docs/journeys/*.md` and match the changed files against each journey's `files:` frontmatter. A journey is **affected** when at least one of its `files:` entries appears in the changed-file set.
3. **Score severity** — for each affected journey:
   - `high` — primary flow step files (page entry, primary action component) changed
   - `medium` — supporting components or non-primary steps changed
   - `low` — peripheral files (helpers, styles only) changed
4. **Return structured recommendation:**

```markdown
### Visual Review Recommendation (no browser)

| Journey | Severity | Changed files in journey |
|---------|----------|--------------------------|
| {journey-name} | {high\|medium\|low} | {file1}, {file2} |

> Recommended follow-up: `/claude-tweaks:visual-review journey:{top-severity-journey-name}`
```

If no journeys are affected, return: `No documented journeys affected by the diff. Visual review not recommended.`

5. **Return control** — skip the remaining Steps (1-4). Do not open the browser, do not run a survey, do not append a Creative Opportunities block.

Recommendation mode is **read-only and browser-free** — it produces a routing signal, nothing else.

## Step 1: Browser Prerequisites

See `_shared/browser-detection.md` for the detect / install / verify procedure (daemon auto-starts on port 4848; recovery via `agent-browser doctor`).

Visual-review-specific behavior when `agent-browser` is unavailable:

**Auto mode:** in addition to the standard `STAGED` log line from the shared procedure, write `staged/visual-review-skipped.md` describing the skip and the install command. Append to the auto-decision log under `## /visual-review` in `{run-dir}/decisions.md` (per `_shared/auto-decision-log.md`). Surface at Review Console. The review proceeds in code-only mode without further interruption.

**Interactive mode:** the shared procedure prompts with install / skip options. Frame the skip choice as "skip visual review — proceed with code-only review" so the user understands the impact in this skill's context. Never silently skip — always report and offer options.

Session naming, screenshot paths, and the full operation vocabulary follow the `/claude-tweaks:browse` skill's conventions. See `browser-review.md` (Prerequisites + Session naming sections) for the canonical naming and path rules used by this skill.

## Step 2: Dev URL Resolution

This skill resolves the dev URL silently when possible. The canonical resolution procedure lives in `dev-url-detection.md` in `skills/_shared/` (probes `stories/servers.yml` first, then applies **worktree awareness** (Step 2.7 — a responding port in a worktree run may be the main checkout's server, serving the *wrong* code), then falls back to detection heuristics and, in auto mode, **starting an ephemeral worktree server** on a free port). The auto-mode behavior below extends that procedure with policy-driven skip semantics.

If `dev-url-detection.md` cannot yield a reachable `APP_URL` for *this* checkout:

**Auto mode:** Run the full `dev-url-detection.md` Step 3 first — in a worktree (the `/claude-tweaks:flow` default) it auto-starts an ephemeral server on a free port (reversible, tracked, torn down at wrap-up). Only when that yields no `APP_URL` (no dev command found, or the server failed to come up) do you auto-skip visual review (do not ask). Append to the auto-decision log under `## /visual-review` in `{run-dir}/decisions.md` (per `_shared/auto-decision-log.md`):
```
- STAGED {HH:MM:SS} — Step 2: no reachable dev URL for this checkout (start attempted: {yes/no}, reason: {no-dev-command | start-timeout}). Visual review skipped — code-only mode. Surface at Review Console.
```
Write `staged/visual-review-dev-url.md` capturing what was attempted. The review proceeds in code-only mode.

**Interactive mode:**

Call `AskUserQuestion` with `question`: `"The app doesn't seem to be running at {url}. Should I:"`, `header`: `"Dev server"`, `multiSelect`: `false` — no option is marked (Recommended); the current text has no explicit recommendation among the three:

- Option 1 — `label`: `"Start dev server"`, `description`: `"start it on a free port and continue"`
- Option 2 — `label`: `"Try different URL"`, `description`: `"provide a different URL to check"`
- Option 3 — `label`: `"Wait"`, `description`: `"wait while you start the dev server yourself"`

In interactive mode, only start the server with the user's consent (option 1). In auto mode, starting an ephemeral worktree server is pre-authorized (it is reversible and torn down at wrap-up) — see `dev-url-detection.md` "Ephemeral server start".

## Step 3: Run Visual Review

Read `browser-review.md` in this skill's directory first — it holds what every mode needs: session lifecycle, annotated screenshots, dev-URL resolution, QA enrichment, Step 0 reconnaissance, and the **Shared review contract** (vitals thresholds, the First Impressions test, and the Report & Route structure all three modes report against).

Then read the one file matching the resolved mode — each names a single file, so a run never loads another mode's procedure:

- **Page mode** — read `page-mode.md` (warm-up, then Steps 1-6: health check, first impressions, use it, analyze, reimagine, report).
- **Journey mode** — read `journey-mode.md` (loads the journey, assembles the batch, walks per-step, assesses the arc, then reports against the shared contract).
- **Discover mode** — read `discover-mode.md` (Phases 1-6: codebase scan → candidates → browser walkthrough → write journey files → coverage report → handoff).

Reconnaissance (Step 0) runs before the main steps in **page** and **journey** modes — read `reconnaissance.md` in this skill's directory for the procedure. Discover mode finds the pages itself (Phase 1 codebase scan, Phase 2 candidate selection), so per-page reconnaissance does not apply — see `discover-mode.md`.

## Step 4: Creative Opportunities Survey

After the visual review report is assembled (per `browser-review.md` Step 6: Report & Route), invoke the `/claude-tweaks:design-wrapper` wrapper's `survey` mode to surface ranked Creative Opportunities — recommendations for which Impeccable creative commands might enhance the reviewed pages, per the survey "would help" criteria → command mapping in `command-map.md` (the single source of truth for that set — see design-wrapper/SKILL.md's Reference sub-files).

```
/claude-tweaks:design-wrapper survey <changed-files> --screenshots <captured-paths> --source visual-review
```

Pass `--source visual-review` on every call this skill makes into `/claude-tweaks:design-wrapper` (this section and Step 5 below) — it is this wrapper's Component-Skill Contract fallback signal for a caller-invoked call arriving with no `$PIPELINE_RUN_DIR` (standalone `/claude-tweaks:visual-review` never has one of its own to forward), and without it the wrapper cannot tell this call apart from a direct human invocation.

Pass:
- The file list scoped to the review (from `git diff --name-only` or the spec's file list).
- The annotated screenshot paths captured during review (`.claude-tweaks/artifacts/screenshots/browse/<session>/*.png`) — the wrapper analyzes each per the criteria table in `command-map.md`.

Handle the wrapper's return:

| Return shape | Action |
|--------------|--------|
| `{result: "ok", recommendations: [...]}` with non-empty list, `$PIPELINE_RUN_DIR` set | Render the Creative Opportunities block (template below) appended to the review report — recommendations-only, unchanged from prior behavior. The parent pipeline owns any further decision. |
| `{result: "ok", recommendations: [...]}` with non-empty list, no `$PIPELINE_RUN_DIR` (standalone) | Render the Creative Opportunities block (template below), then the apply-gate (see "Applying a recommendation" below). |
| `{result: "ok", recommendations: []}` | Omit the block entirely — no opportunities surfaced is a valid outcome, not a failure. |
| `{skipped: ...}` | Omit the block. Note the skip reason inline only when it would surprise the user (e.g., "Creative survey skipped — Impeccable plugin not installed"). |

### Creative Opportunities block template

```markdown
### Creative Opportunities (from /claude-tweaks:visual-review)

| # | Page | Observation | Suggested command |
|---|------|------------|-------------------|
| 1 | /pricing | Hero feels generic — pure black on white, no personality | `/impeccable:impeccable bolder pricing` |
| 2 | /empty-cart | Empty state shows only "No items" text | `/impeccable:impeccable delight empty-cart` |
```

When the wrapper reports `suppressed > 0` in its return, append a small note below the table: `> N suggestion(s) hidden — previously declined for this spec. Reset with /claude-tweaks:design-wrapper reset-recommendations <spec>.`

### Applying a recommendation, and Boost (standalone only)

When running standalone (no `$PIPELINE_RUN_DIR`), read `standalone-followup.md` in this skill's directory and run its full procedure: the apply gate for the Creative Opportunities block above (Step 4 continued), followed by the Step 5 Boost offer (fix flagged issues via `/claude-tweaks:design-wrapper review`, and/or explore alternatives via `/claude-tweaks:design-wrapper live`). Both paths are consent-gated and re-verify via `/claude-tweaks:test skip-qa` after any code change.

When parent-invoked (`$PIPELINE_RUN_DIR` set, or an explicit `--source <parent-skill>` fallback), skip `standalone-followup.md` entirely — the Creative Opportunities block above is the final word; the parent pipeline takes any follow-up from there. This content is lazy-loaded (rather than kept inline) because it only applies to the standalone path, not the more common parent-invoked path — the same lazy-loading discipline this skill already applies to `qa-accelerated.md` and the mode-specific sub-files.

## Next Actions

When invoked directly (not by a parent skill), render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`/claude-tweaks:review {spec}`** — full code review (recommended)
`/claude-tweaks:visual-review journey:{name}` — walk a specific journey
`/claude-tweaks:stories` — generate QA stories from what was reviewed
`/claude-tweaks:capture {idea}` — save ideas surfaced during the review

This is the canonical handoff block for the skill. Mode-specific Next Actions exist in `discover-mode.md` (post-discover variant emphasising journey walks) and `browser-review.md` (post-page-review variant gated by review-source signals) for situations where the standalone block doesn't fit the mode's deliverable — they render their own independent markdown block instead of this one, never merged with it. When invoked by a parent (`/claude-tweaks:review` or `/claude-tweaks:init`), omit Next Actions — the parent handles flow control and summary.

## Component-Skill Contract

This skill is a **component skill** — invoked by `/claude-tweaks:review` (Step 6) in `full` mode, by `/claude-tweaks:init` (Phase 8) for brownfield journey discovery, by `/claude-tweaks:wrap-up` (`verification-brief.md` Step 2.5 safety-net gate) when an `app-route`/`rendered-page` plan reaches wrap-up without a full pass already having run — with one exclusion: a record with a resolvable decomposition parent runs that file's Parent-Gate Procedure *in place of* its Steps 1-4, and Step 2.5 is inside that range, so this skill is never invoked from the parent-gate path (see that procedure's "What this path deliberately does not run") — and by `/claude-tweaks:journey-health` (its deep-tier fallback, when a journey under audit has no story coverage yet). Parent invocation is signaled by `$PIPELINE_RUN_DIR` being set (the parent is running inside an active pipeline run) — or by an explicit `--source wrap-up` / `--source journey-health` flag the caller passes instead, the same fallback `/claude-tweaks:reflect`'s Component-Skill Contract documents. The two callers reach that fallback for different reasons: `/claude-tweaks:wrap-up` passes `--source wrap-up` on **every** run because its Phase 1 creates a run directory unconditionally, so `$PIPELINE_RUN_DIR` no longer distinguishes a pipeline wrap-up from a standalone one; `/claude-tweaks:journey-health` passes `--source journey-health` because, running standalone or on a scheduled Routine, it genuinely has no run directory of its own to signal with. When invoked by a parent (via either signal), omit the `## Next Actions` block — the parent owns the handoff. When invoked directly by a user (neither signal present), render Next Actions as shown above.

**Code-modifying exception.** `/visual-review` is otherwise read-only with respect to code. Two specific, standalone-only, always-consent-gated paths modify code: Step 4's Creative Opportunities apply-gate, and Step 5's Boost gate (Fix option) — both procedures live in `standalone-followup.md`, lazy-loaded only on the standalone path. Both re-verify afterward via `/claude-tweaks:test skip-qa`. Parent-invoked `/visual-review` (`$PIPELINE_RUN_DIR` set) never modifies code — Steps 4 and 5's apply/boost paths do not run in that context.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Silently skipping when `agent-browser` is unavailable | Report the missing dependency and offer options — never skip silently |
| Skipping First Impressions in visual review | Raw reaction must precede structured analysis — don't make it analytical |
| Starting the dev server without asking **in interactive mode** | Interactive mode offers, it doesn't force. (Auto mode pre-authorizes a tracked ephemeral worktree server on a free port — `dev-url-detection.md`) |
| Reusing a responding port without checking it serves *this* worktree | In a worktree run, :3000 is usually the main checkout — false confidence on the wrong code. Apply `dev-url-detection.md` Step 2.7 first |
| Generic visual ideas ("improve the UX") | Ideas must be concrete and implementable in the current tech stack |
| Running visual review without a running app | The browser can't inspect what isn't served — verify the URL responds first |
| Describing elements by position instead of annotated overlay number | "The button on the right" is brittle; "element [3]" is precise — always reference annotated screenshot overlays |
| Skipping `vitals` capture | Performance is a first-class finding — every reviewed page must produce LCP/CLS/INP/TTFB/FCP values |
| Closing the session before saving a trace on failure | Failure reports without a trace path aren't actionable — `trace stop <path>` first, then `close` (and recording must have been started via `trace start` at session open — there is no retroactive capture) |
| Per-step `agent-browser` invocations during journey walks | Use `batch` — one process, one session lifecycle, fewer tokens and less latency |
| Batching across sessions | One `agent-browser batch` invocation owns a single session — never mix session names |
| Silently auto-applying a Creative Opportunities suggestion without the apply-gate | Recommendations only — the user accepts via the apply-gate (standalone) or takes it away to run manually (parent-invoked); never execute an Impeccable creative command without that accept |
| Rendering the Creative Opportunities block when the wrapper returned `recommendations: []` or `{skipped}` | An empty result is valid — omit the block. Survey is heuristic, so "no opportunities found" misleads as positive signal |
| Duplicating browser procedures in SKILL.md | `browser-review.md` is canonical for browser procedures; SKILL.md is mode resolution, auto-mode policy, and orientation |
