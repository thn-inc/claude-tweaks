---
name: research
description: Use for in-depth web research — multi-source, citation-audited reports across 4 runtime modes (quick to ultradeep), via /deep-research or an inline fallback. Keywords - research, deep research, web research, sources, citations, literature review.
argument-hint: "verify [brief-path|#N] | <topic> [--mode=quick|standard|deep|ultradeep] [--engine=auto|inline] [--output=<path>]"
---

# Research — Deep Web Research with Citation-Audited Reports

Multi-source web research that produces a citation-audited markdown report. When Claude Code's
built-in `/deep-research` **Dynamic Workflow** is available, this skill delegates to it;
otherwise it runs a lean inline method (`reference/methodology.md`). Either path writes the
report under `.claude-tweaks/research/`.

```
   [ /claude-tweaks:research verify ] → /superpowers:brainstorming → /claude-tweaks:specify
                    ↑
   Human-invoked, before a design is written — see `verify-mode.md`'s Lifecycle position.

                             [ /claude-tweaks:research <topic> ] ← utility (no fixed lifecycle position)
                                        ↑
   Referenced by (advisory cross-reference, recorded in `docs/skill-graph.md` — bare-topic
   /research is never invoked from a numbered Workflow step of any of these; a human
   or the caller's own judgment decides to run it): /claude-tweaks:capture,
   /claude-tweaks:specify, ad-hoc research tasks
```

## When to Use

- Research a topic in depth before committing to a design direction.
- Audit prior art / state-of-the-art before authoring a spec.
- Debias a backlog work record with evidence from multiple sources.
- Gather citations for a user journey, RFC, or technical decision.
- Generate a citation-audited markdown report.

## Input

- `$ARGUMENTS` takes one of two forms, distinguished by its **first token**:
  - **`verify [brief-path|#N]`** — verification mode. Grounds a design before it is written by
    answering the claims the design would rest on. Read `verify-mode.md` in this skill's directory for
    the full procedure: input resolution, the consequence filter, question-shape routing, and
    auto-mode behavior. Of the flags below, only `--mode=` applies, and it bounds
    survey breadth only — see that file.
  - **`<topic>`** — the default web-survey mode, unchanged. If empty, ask the user for the topic
    before proceeding.
- Mode is selected via a single numbered-options prompt (see Mode Picker). **`standard` is the recommended default** — it balances depth and runtime.
- Flags parsed from `$ARGUMENTS`:
  - `--mode=<quick|standard|deep|ultradeep>` — skip the mode prompt. A value outside this set (e.g. a typo) is treated the same as absent: fall back to the Mode Picker.
  - `--engine=<auto|inline>` — `auto` (implicit default) runs the availability pre-check (Workflow Step 3) and prefers the built-in `/deep-research` Dynamic Workflow when usable. `inline` skips that pre-check and always runs the inline fallback method (`reference/methodology.md`), even when the built-in is available — for a well-scoped topic where the built-in's higher ceiling isn't needed, or to deliberately exercise the fallback path.
  - `--output=<path>` — overrides the output root (default `.claude-tweaks/research/`); the dated `[YYYY-MM-DD]-[topic-slug]/` subdirectory is still appended beneath the override, same as under the default root.

## Mode Picker

If `--mode=` is absent, first check whether this run should skip the interactive prompt entirely: when `auto` mode is active or `$PIPELINE_RUN_DIR` is set, resolve the mode via `_shared/auto-mode-card.md`'s decision precedence — the pipeline config's research-mode value if set, else project policy's default, else `standard` — and log the choice to the run's auto-decision log instead of prompting. This keeps `/claude-tweaks:research` from introducing an unplanned mid-flow stop under `auto`, consistent with the Component-Skill Contract's existing pipeline-awareness for Next Actions.

Otherwise, call `AskUserQuestion` with `question`: `'Mode for "<topic>":'`, `header`: `"Research mode"`, `multiSelect`: `false`, and:

- Option 1 — `label`: `"Quick"`, `description`: `"~2-5 min, 5+ sources"`
- Option 2 — `label`: `"Standard (Recommended)"`, `description`: `"~5-10 min, 10+ sources"`
- Option 3 — `label`: `"Deep"`, `description`: `"~10-20 min, 15+ sources"`
- Option 4 — `label`: `"Ultradeep"`, `description`: `"~20-45 min, adversarial multi-verifier refutation pass"`

Then proceed with the selected mode.

## Workflow

1. **Resolve the input.** When the first token of `$ARGUMENTS` is `verify`, read `verify-mode.md`
   in this skill's directory and follow it instead of Steps 2-7 below — it defines its own output,
   which is not this skill's dated report directory. Otherwise resolve topic + depth tier from
   `$ARGUMENTS` (or the Mode Picker) and continue at Step 2 with today's behavior.
2. **Construct the output directory:** `{root}/[YYYY-MM-DD]-[topic-slug]/`, where `{root}` is `{cwd}/.claude-tweaks/research/` unless `--output=<path>` overrides it (the dated subdirectory is still appended beneath the override). Derive `topic-slug` by lowercasing the topic, collapsing runs of non-alphanumeric characters to a single hyphen, trimming leading/trailing hyphens, and truncating to 60 characters. If the resulting directory already exists (an identical topic re-run the same day), append a numeric suffix (`-2`, `-3`, ...) instead of overwriting the earlier report. Create the directory before researching.
3. **Availability pre-check (built-in path).** Skip this step entirely when `--engine=inline` was passed — go straight to Step 5. Otherwise decide whether the built-in `/deep-research` Dynamic Workflow is usable:

   ```bash
   # Built-in /deep-research needs Claude Code >= 2.1.154 and Dynamic Workflows enabled.
   test "${CLAUDE_CODE_DISABLE_WORKFLOWS:-0}" = "1" && echo "workflows: OFF (env)" || echo "workflows: env-ok"
   grep -sq '"disableWorkflows"[[:space:]]*:[[:space:]]*true' \
     ~/.claude/settings.json .claude/settings.json .claude/settings.local.json \
     && echo "workflows: OFF (settings)" || echo "workflows: settings-ok"
   ```

   Treat the built-in as **available** only when neither check reports OFF. (The pre-check catches explicit disables; plan-gating and "never enabled on Pro" are caught by the fallback in Step 5.)
4. **Delegate to the built-in (when available and `--engine=inline` was not passed).** Invoke `/deep-research` with the topic, passing depth guidance derived from the tier (for `deep`/`ultradeep`, ask it to dig broadly and cross-check more sources). Capture the cited report it returns. If the command is absent or returns nothing, fall through to Step 5.
5. **Inline fallback (when unavailable, empty, or `--engine=inline` was passed).** Read `reference/methodology.md` in this skill's directory and run the lean inline method (decompose → parallel `WebSearch` → `WebFetch` extract → adversarial-verify subagents → synthesize), scaled to the depth tier.
6. **Write the report** to `report.md` (plus a `sources.json` provenance list) in the output directory — identical location for both paths.
7. **Surface progress** with a single status line per phase, then present **Next Actions** with the produced report path.

## Enabling the built-in path

The built-in `/deep-research` produces the highest-quality result. It ships as a **Dynamic
Workflows** feature (research preview) — nothing to install, but it is gated:

| Requirement | Detail |
|-------------|--------|
| Claude Code | ≥ 2.1.154 |
| Plan | Pro / Max / Team / Enterprise (not Free) |
| Default | On for Max & Team · **Pro: enable in `/config` → Dynamic workflows** · Enterprise: admin-enabled |
| Disabled by | `/config` toggle · `"disableWorkflows": true` in settings · `CLAUDE_CODE_DISABLE_WORKFLOWS=1` |

When unavailable, the inline fallback runs automatically — no setup required, lower ceiling.
It's the zero-config baseline: `WebSearch`/`WebFetch` only, no external install or built-in
workflow needed. When Dynamic Workflows are enabled, the skill delegates to `/deep-research`
instead for cross-checked, vote-validated synthesis. If `WebSearch` or `WebFetch` itself is
denied, unconfigured, or errors out mid-run, stop and report the blocking condition to the
user rather than attempting a degraded result — it's the one dependency the inline fallback
can't substitute for.

## Next Actions

After the report completes, render as plain markdown (docs/skill-authoring.md's Skill handoffs convention). Capturing findings is the default recommended follow-up — capturing findings is the safe general follow-up regardless of topic — so that line renders first, bolded, suffixed `(recommended)`; if the run was invoked to feed a specific downstream skill instead (e.g. from `/claude-tweaks:specify` to cite in a spec already underway), move the bold and `(recommended)` to that line instead — exactly one line carries it, per the Interaction style directive:

**`/claude-tweaks:capture <findings-summary>`** — promote findings into a backlog work record (recommended)
`/claude-tweaks:specify <spec-name>` — cite findings in a new spec
`/claude-tweaks:research --mode=deep <topic>` — re-run in deeper mode (only when current mode left obvious gaps — otherwise omit this line rather than including it caveated)

## Component-Skill Contract

When `$PIPELINE_RUN_DIR` is set, `/claude-tweaks:research` is running inside a pipeline (invoked by `/claude-tweaks:capture`, `/claude-tweaks:specify`, or another pipeline orchestrator). In that case omit the `## Next Actions` block — the parent owns the handoff.

Direct invocation may pass `--source <parent-skill>` as an explicit fallback when ambiguity exists (rare; `$PIPELINE_RUN_DIR` is the primary signal).

## Anti-Patterns

| Pattern | Why It Fails |
|---------|--------------|
| Invoking `deep`/`ultradeep` on a fuzzy one-word topic | Burns time on under-scoped queries — add a clarifying sentence, or refine scope with `quick`/`standard` first |
| Skipping the mode prompt by guessing | Modes differ in runtime by ~10× — always ask unless `--mode=` is passed |
| Treating the inline fallback as failure | A first-class path, not an error state — most users without Dynamic Workflows rely on it |
| Editing reports in place after generation | Dated immutable artifacts — re-run instead; you get a fresh dated directory (numeric suffix if the topic already ran today — see Workflow Step 2) |
| Hard-depending on the built-in | `/deep-research` is a gated preview absent for many users — never remove the fallback or assume it exists |
