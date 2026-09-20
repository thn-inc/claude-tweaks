# Architecture Alignment Check — full procedure

Common Step 4.5 of `/claude-tweaks:build`. Compare what was actually built to what the spec or design doc said to build. Implementation often drifts from the plan — sometimes for good reasons, sometimes not. Catch it here before verification locks it in.

## Check

1. Read the spec (or design doc) and identify its stated architectural approach — the "how" decisions: patterns chosen, boundaries defined, data flow described
2. Compare against the actual implementation — scan the files created/modified for structural alignment
3. Note any deviations

## Classification

Classify every deviation, then present ONE batch decision table (per docs/skill-authoring.md's "Multi-item decisions" convention). Pre-fill a recommended classification per row and offer "apply all / override."

For each deviation, the three valid classifications are:

| Classification | Meaning | Effect on the spec | Effect on the implementation |
|---|---|---|---|
| **Beneficial** | The deviation is an improvement on the spec's intent | Update spec to match reality; document why in commit message so /wrap-up can reflect | Keep as-built |
| **Fix now** | The deviation contradicts the spec's intent | Spec unchanged | Revert/fix the implementation to match the spec |
| **Update the spec** | The spec was wrong or incomplete; reality is correct | Update spec to match reality | Keep as-built |

## Interactive mode — single batch table

```
Architecture deviations — {N} found. Recommended classifications pre-filled:

| # | Deviation | What the spec said | What was built | Recommended |
|---|-----------|--------------------|----------------|-------------|
| 1 | {short label} | {spec text} | {actual} | {Beneficial / Fix now / Update the spec} |
| 2 | ... | ... | ... | ... |
```

The table renders as markdown, as above. Immediately below it, call `AskUserQuestion` with:

- `question`: `"How do you want to handle these deviations?"`, `header`: `"Deviations"`, `multiSelect`: `false`
- Option 1 — `label`: `"Apply all (Recommended)"`, `description`: `"Apply all"`
- Option 2 — `label`: `"Override specific rows"`, `description`: `"Tell me which #s to reclassify and to what"`

**Hard gate.** Check the response you are about to send: does it already contain the deviations table above as literal rendered markdown, with a row for every deviation? If not, render it now, in this response, before the tool call — "Apply all" with no table above it leaves the user approving an unnamed set of spec/implementation reconciliations.

After resolution, apply each row's classification per the table above. "Beneficial" still requires action — never just "note it"; that loses the insight.

## In `auto` mode

Apply the `Architecture alignment (/build Common Step 4.5)` row from the silences table in `_shared/auto-mode-contract.md`. Stage non-AUTO rows to `staged/build-deviation-{N}.md` and surface them at the Wrap-Up Review Console. Log every auto-applied and staged row to the auto-decision log per the standard skill-integration pattern.

## Skip this step if

- Design mode with no formal spec (no stated architecture to compare against)
- The plan was trivial (< 3 tasks, single-file changes)
- `config.yml`'s `ceremony-profile` is `fast-lane` (read fresh from the run directory). Standalone `/build` (no `config.yml`) always falls back to the first two conditions alone.

The fast-lane bullet's rationale and safety net are stated once in `_shared/ceremony-profile.md` (roster tag `architecture-alignment`) — this section keeps only the three conditions.

## On skip (write the trace)

**Which branch counts as "skipped":** only when one of the three bullets above fires — this step never runs at all. A run where the step *does* execute and finds zero deviations is a normal partial run, not a skip — the no-op rule applies (`_shared/auto-decision-log.md`'s degrade-trace rule: a step that runs writes nothing when it finds nothing). Do not write a `SKIP` entry for "ran, found no deviations."

When one of the three bullets fires, write one `SKIP` entry:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP \
  --section "/build" --step "Common Step 4.5 (skipped)" \
  --text "condition: {design mode, no spec | trivial plan | ceremony-profile=fast-lane} → fallback: no alignment check run" --reversibility n/a
```

Standalone `/build` (no run dir): list the skip in the Step 7 handoff instead (`handoff-template.md`'s inline-skip listing).

## Skill Observation

**Classify, then tag — never withhold.** Run the observation through `skills/_shared/learning-routing.md`. Append the ledger entry below **in every case**; suppressing it would leave the observation with no reader at all, since nothing else in `/claude-tweaks:build` writes to a channel `/claude-tweaks:wrap-up` reads. When the outcome is D4 or D5, additionally tag the entry body `[route: D4]` or `[route: D5]`, which `/claude-tweaks:wrap-up`'s Skills curation row uses to hand it to the Memory or Upstream feedback row rather than seeding it as a project-skill update.

While checking architectural alignment, also compare against relevant project skills:

1. Identify 0-3 skill files in `.claude/skills/` covering patterns related to what was built (if the directory exists)
2. Quick-scan their Key Patterns and Project Conventions sections only
3. Append a one-sentence ledger entry (phase `build/skill`) when the implementation:
   - **diverges** from what a skill documents (the skill may be stale), or
   - **extends** a skill's pattern with a new wrinkle worth documenting (enrichment), or
   - **establishes a reusable pattern in a domain no skill covers** — tag the entry body `[skill: NEW - {suggested-name}]` (hyphen, not em-dash, for tooling friendliness) so `/claude-tweaks:wrap-up` evaluates it as a new-skill candidate
4. Keep it light — one sentence per entry; `/claude-tweaks:wrap-up` does the deep analysis (its independent scan also catches uncovered domains, so an emitted entry is a head start, not the only path)
5. Skip if the build is trivial
