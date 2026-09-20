# Init Input Grammar — enhancement filter tokens, phase-scope terminality, unrecognized tokens

Loaded by `/claude-tweaks:init`'s `## Input` section when `$ARGUMENTS` is non-empty and needs full
classification. One lazy-load unit: everything needed to resolve a token string at invocation start.
The path/URL rule, the modifier flags, and the Phase scope list stay in `SKILL.md` — they are the
common case and always apply. Section names referenced below are sections of `SKILL.md`.

## Enhancement filter tokens

**Enhancement filter tokens** — narrow which of Phase 0's Optional Enhancements (Steps 9 onward) get offered. With none present, Phase 0 offers every step in the table below (or none, under `--core-only`). With one or more present, Phase 0 offers *only* the named step(s), regardless of which (if any) Phase scope is also present:

| Token | Runs |
|---|---|
| `github-remote` | Step 9 — Establish GitHub remote, alone |
| `issue-form` | Step 10 — GitHub issue form template. Hard-depends on Step 9 having run — if `github-remote` wasn't also given (and no remote exists yet), `issue-form` runs Step 9 first anyway (interactive mode only — Step 9 never runs under `auto`, and it prompts before doing anything) |
| `design-integration` | Step 11 — Impeccable design integration |
| `diagram-suggestions` | Step 12 — Diagram suggestions |
| `shadcn-integration` | Step 13 — shadcn bootstrap |
| `cloud-parity` | Step 14 — Cloud/Routine parity setup, alone. Hard-depends on Step 9 having run — if `github-remote` wasn't also given (and no remote exists yet), `cloud-parity` runs Step 9 first anyway (interactive mode only — Step 9 never runs under `auto`, and it prompts before doing anything) |
| `routines` | Step 15 — Routine installation. Hard-depends on Step 14 having run — if `cloud-parity` wasn't also given (or already configured from an earlier run), `routines` silently runs Step 14 first anyway, matching the unfiltered flow's existing 14-before-15 ordering |
| `branch-tracking` | Step 16 — Non-default-branch issue tracking. Hard-depends on Step 9 having run — if `github-remote` wasn't also given (and no remote exists yet), `branch-tracking` runs Step 9 first anyway (interactive mode only — Step 9 never runs under `auto`, and it prompts before doing anything) |
| `work-backend` | Step 17 — Work-record backend. Hard-depends on Step 9 having run — if `github-remote` wasn't also given (and no remote exists yet), `work-backend` runs Step 9 first anyway (interactive mode only — Step 9 never runs under `auto`, and it prompts before doing anything) |
| `autonomy` | Step 18 — Autonomy level |
| `emil-skills` | Step 19 — Emil design-engineering skills. The step's own frontend gate still applies — with no frontend signals detected, it skips itself, same as in the unfiltered flow |
| `integration-model` | Step 20 — Integration-model pin (`_shared/integration-model.md`). Hard-depends on Step 9 having run — if `github-remote` wasn't also given (and no remote exists yet), `integration-model` runs Step 9 first anyway (interactive mode only — Step 9 never runs under `auto`, and it prompts before doing anything) |
| `release` | Step 21 — Release bootstrap (`bootstrap/step-21-release.md`). Hard-depends on Step 20 having resolved `integration-model` — with the value unresolved, the step skips itself and reports `release: skipped — integration-model unresolved`, same as in the unfiltered flow |

Examples (assuming Steps 1-8.5 actually run this time — see "Core Bootstrap Version Check" below for when they're skipped instead): `routines` alone runs Steps 1-8.5, then only Steps 14+15, then stops (same "stop after Phase 0" behavior as `bootstrap`). `config routines` runs Steps 1-8.5, then only Steps 14+15, then Phases 2, 3, 5. `shadcn-integration branch-tracking` runs Steps 1-8.5, then only Steps 13 and 16, then stops.

## Phase-scope terminality

Every Phase scope above still runs Phase 9 as its terminal summary/confirm/write step, except `bootstrap` (which stops the invocation after Phase 0) — this includes the goal-based Phase scopes (`config`, `skills`, `journeys`, `docs`) even though none of them list Phase 9 explicitly in their phase subset above. An invocation with one or more Enhancement filter tokens and no Phase scope also stops after Phase 0, same as `bootstrap` — Enhancement filter tokens narrow *what Phase 0 does*, they don't add phases after it. The interactive Scope Selection Gate's own early-stop choices (Option 4 "Done," and Option 2 Interactive's per-phase "Done") are the other paths that stop before Phase 9; see "Finalizing the worktree-always Decision" for why this distinction matters.

## Unrecognized and conflicting tokens

If every token classifies into one of the categories above (or the whole string is a path/URL), proceed as described. If a token matches none of them:

- If the overall string reads as prose (contains a comma, or multiple natural-language words forming a sentence, e.g. "Ruby on Rails monolith, team of 5") — treat the whole string as a project-context description, no interruption. Unchanged from before.
- Otherwise (a single unmatched token, or a short sequence of tokens that looks like an attempted scope rather than prose) — stop before running anything. Call `AskUserQuestion`: name the unrecognized token(s), list the valid tokens grouped by category (modifier flags / Phase scopes / Enhancement filter tokens), and include an explicit "No — treat this literally as a project-context description" option, so a genuine single-word description (e.g. "monorepo") still works, at the cost of one confirmation. Do not silently guess either interpretation — this matches `/claude-tweaks:tidy`'s "Unknown scope name" handling and `/claude-tweaks:capture`'s "Unknown or invalid `N`" handling.

An explicit Enhancement filter token given together with `--core-only` is a contradiction (one asks for exactly that step, the other asks for none) — report it the same way: state plainly that the two conflict and ask which was meant, rather than silently letting one win.
