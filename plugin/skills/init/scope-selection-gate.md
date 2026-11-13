# Init Scope Selection Gate — prompt, option semantics, phase dependencies

Loaded by `/claude-tweaks:init` once Phase 0 completes and the gate is actually going to render —
i.e. `$ARGUMENTS` named no goal-based Phase scope and no Enhancement filter token. The skip
conditions and the `auto`-exemption note stay in `SKILL.md`; everything needed to render the gate
and act on the answer is here. Section names referenced below (Phases at a Glance, Input,
Finalizing the worktree-always Decision) are sections of `SKILL.md`.

## The prompt and its four options

Call `AskUserQuestion` (see "Phases at a Glance" above for the full table):

- `question`: `"Bootstrap complete. How much setup do you want?"`, `header`: `"Setup scope"`, `multiSelect`: `false`
- Option 1 — `label`: `"Auto (Recommended)"`, `description`: `"Run all included phases without stopping"`
- Option 2 — `label`: `"Interactive"`, `description`: `"Pause for confirmation between phases"`
- Option 3 — `label`: `"Essentials"`, `description`: `"Reconnaissance + CLAUDE.md only (phases 2, 3, 5)"`
- Option 4 — `label`: `"Done"`, `description`: `"Just needed the bootstrap structure"`

**Option 1 (Auto):** Run all included phases end-to-end. Phase 3 auto-confirms classification when detection confidence is `high` and signals are consistent (otherwise presents the confirmation gate as a KEPT-PROMPT). Phase 4 still presents the skill selection (governance decision — never silenceable). Phase 9 still presents the final summary for confirmation (governance decision). All other phases run without pausing.

**Option 2 (Interactive):** After each phase completes, present its output, then call `AskUserQuestion`. This is a template — re-issue it once per phase (not a single static site), substituting `{phase}`, `{next phase}`, `{description}`, and `{phase after next}` each time. Resolve "next phase" and "phase after next" by walking the actual sequence in "Phases at a Glance" (0, 1, 2, 3, 4, 5, 6, 7, 8, 8.5, 9) — not `{N+1}`/`{N+2}` integer arithmetic, which breaks at the 8 → 8.5 → 9 step. For example, after Phase 7 the next phase is 8; skipping Phase 8 moves to Phase 8.5, never Phase 9:

- `question`: `"Phase {phase} complete. Continue to Phase {next phase} ({description})?"`, `header`: `"Phase gate"`, `multiSelect`: `false`
- Option 1 — `label`: `"Continue (Recommended)"`, `description`: `"Proceed to Phase {next phase} ({description})"`
- Option 2 — `label`: `"Skip Phase {next phase}"`, `description`: `"Move to Phase {phase after next}"`
- Option 3 — `label`: `"Done"`, `description`: `"Stop here"`

If the user selects this template's "Done" and Step 6 queued a `worktree-always` decision, write it now — see "Finalizing the worktree-always Decision" above. If Step 22 held its CI workflow review (`bootstrap/step-22-ci-workflow-review.md`'s re-run gate) and Phase 1 has not run yet, run it now too, before this exit.

**Option 3 (Essentials):** Runs phases 2, 3, 5 only — the same phase set as the `config` goal-based Phase scope (see "Input" above; Phase 0 always runs first regardless of scope, so the two are equivalent). Produces CLAUDE.md with proper philosophy and Don'ts. Defers skills, rules, journeys, and doc registry for later (suggest running `/init config` directly next time to skip this gate).

**Option 4 (Done):** Stop after Phase 0. The user has the directory structure, starter files, and dependencies — they'll configure manually or run `/init` again later. If Step 6 queued a `worktree-always` decision, write it now — see "Finalizing the worktree-always Decision" above. If Step 22 held its CI workflow review (`bootstrap/step-22-ci-workflow-review.md`'s re-run gate), run it now too, before this exit.

## Phase dependencies

When a phase is excluded (by interactive skip, essentials mode, or goal-based argument), handle its dependents:

| If skipped | Impact | Handling |
|------------|--------|----------|
| Phase 2 (recon) | Phases 3-8.5 lose their input | Skip all dependent phases — cannot generate config without reconnaissance |
| Phase 3 (profile) | Phases 4, 5, 8.5 lose maturity/tier classification | Skip dependent phases — philosophy and doc tier need classification |
| Phase 4 (manifest) | Phase 6 has no skill list | Skip Phase 6 |
| Phase 5 (CLAUDE.md) | No downstream dependency | Safe to skip |
| Phase 6 (skills) | No downstream dependency | Safe to skip |
| Phase 7 (rules) | No downstream dependency | Safe to skip |
| Phase 8 (journeys) | No downstream dependency | Safe to skip |
| Phase 8.5 (doc registry) | No downstream dependency | Safe to skip |

When skipping a phase due to a missing dependency, note it: "Skipping Phase {N} ({name}) — requires Phase {dep} which was excluded."
