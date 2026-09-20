# Step 4 — .gitignore suggestions (detailed content)

*Core Bootstrap step — order-dependent, so later steps may assume earlier ones completed; runs unconditionally and idempotently, acting only on missing state. Gated by `version-check.md` in this directory.*

Check whether `.gitignore` exists and already covers workflow artifacts. Suggest entries for transient files that shouldn't be committed:

```gitignore
# claude-tweaks: transient artifacts
.claude-tweaks/artifacts/
.worktrees/
.claude-tweaks/pipelines/*
!.claude-tweaks/pipelines/*/
.claude-tweaks/pipelines/*/*
!.claude-tweaks/pipelines/*/work/
!.claude-tweaks/pipelines/*/work/**
!.claude-tweaks/pipelines/*/spec-*/
.claude-tweaks/pipelines/*/spec-*/*
!.claude-tweaks/pipelines/*/spec-*/work/
!.claude-tweaks/pipelines/*/spec-*/work/**
!.claude-tweaks/pipelines/archive/*/
.claude-tweaks/pipelines/archive/*/*
!.claude-tweaks/pipelines/archive/*/work/
!.claude-tweaks/pipelines/archive/*/work/**
!.claude-tweaks/pipelines/archive/*/spec-*/
.claude-tweaks/pipelines/archive/*/spec-*/*
!.claude-tweaks/pipelines/archive/*/spec-*/work/
!.claude-tweaks/pipelines/archive/*/spec-*/work/**
.claude-tweaks/research/
.claude-tweaks/code-health/
.claude-tweaks/harness-health/
.claude-tweaks/journey-health/
.claude-tweaks/docs-health/
.claude-tweaks/*/watermarks/*.json
.claude-tweaks/routine-environment-cache.yml
.claude-tweaks/init-state.yml
.claude-tweaks/wrap-up-outcomes.tsv
.impeccable/config.local.json
.impeccable/hook.cache.json
.impeccable/hook.pending.json
.env.local
.env
```

These entries ignore claude-tweaks' transient, project-local state — pipeline run directories (`pipelines/{ISO-timestamp}-{spec-slug}/config.yml`, `decisions.md`, `staged/`), research report output, each health skill's own local cache (`code-health/cache.json`, `harness-health/cache.json`, `journey-health/cache.json`, `docs-health/cache.json` — the only files still written under these paths; cursor and run-history state now live on the durable `health-state` git branch, see `skills/_shared/health-state.md` and `bin/lib/{skill}/cache.js` for each), the routine-environment-resolution cache (see `skills/routine/SKILL.md`), the transcript-judge evaluation-watermark cache, per consumer (`.claude-tweaks/{consumer}/watermarks/*.json` — e.g. `.claude-tweaks/feedback/watermarks/*.json`, see `bin/lib/transcript-judge/watermark.js`), and the wrap-up outcome telemetry file (`.claude-tweaks/wrap-up-outcomes.tsv`, appended by `close-run` and the wrap-up engine, read by `calibration-report.js`) — this repo's own root `.gitignore` has carried this line since before this template's `wrap-up-outcomes.tsv` entry existed; a consumer project whose `.gitignore` predates this template line can end up with the tsv accidentally tracked (e.g. via a broad `git add`), which under `worktree-always` becomes a permanently uncommittable dirty file, since the write gate has no exempt path for it (#1561). `.claude-tweaks/artifacts/` (QA screenshots and traces — see the `/test` qa and `/browse` path conventions) is a single blanket line deliberately: nothing under it is ever committed, unlike `pipelines/*/work/`, so the per-level un-ignore treatment documented above is unnecessary there. Deliberately **not** blanket-ignored: `.claude-tweaks/routines/{name}.yml` (instantiated cloud-Routine records, written by `/claude-tweaks:routine`) — those are explicitly documented as safe, and meant, to commit. A blanket `.claude-tweaks/` line would make that directory permanently uncommittable regardless of user intent, since git cannot reliably re-include a subdirectory of an already-ignored parent via `!` negation. The statusline cache lives under the user's home directory (`~/.claude-tweaks/`), a separate global path — it never needs a project `.gitignore` entry. The same rule applies to Impeccable's own config directory: `.impeccable/config.json` is Impeccable's committed, shared team config (colors, typography, brand voice); only the three per-developer files above — `config.local.json`, `hook.cache.json`, and `hook.pending.json`, all written by its optional automatic-detection hook — are local state. A blanket `.impeccable/` line would make `config.json` permanently uncommittable for the identical structural reason.

`.env.local` and `.env` carry Step 6.5's managed port-isolation region (`# claude-tweaks:ports begin/end`, written by `bin/ports.js allocate`/`ensure`) — machine-specific leased-port values, never meant to be shared across checkouts, so both join the suggested block the same way `.impeccable/config.local.json` does.

The same structural rule applies one level deeper, inside `.claude-tweaks/pipelines/` itself: `flow/materialize.md` documents that a materialized spec file under `pipelines/{run-id}/work/` (and its multi-record `spec-{n}/work/` variant, plus both variants again under `pipelines/archive/{run-id}/` — the path `/claude-tweaks:wrap-up`'s cleanup step produces) is committed audit trail, never gitignored. A bare `.claude-tweaks/pipelines/` blanket line would stop git from ever traversing into the directory at all, so a nested `!work/` re-inclusion could never take effect (this project's own `.gitignore` Don't in CLAUDE.md names this exact class of bug). The template above instead un-ignores each directory level on the way down to `work/`, at both the single-record and multi-record depths, and repeats that same per-level shape under `pipelines/archive/`. This repo's own root `.gitignore` uses the identical 17-line pattern — mirror it verbatim rather than re-deriving it by hand.

**Re-run behavior (migration check):** don't just check whether `.gitignore` "already covers" `.claude-tweaks/` — a project that adopted claude-tweaks before this split existed may have the old blanket line, which silently reintroduces the routines-uncommittable bug even though something matching `.claude-tweaks` is technically present. Likewise, a project that adopted the split before the per-level `pipelines/` pattern existed may have a naive `.claude-tweaks/pipelines/` blanket sub-line — that silently reintroduces the identical class of bug one level down, permanently pruning the `work/` audit trail `flow/materialize.md` promises is tracked history. And a project that split before `.claude-tweaks/artifacts/` existed as a line (added by #1077) may have the split entries with no `screenshots/` line to trigger the legacy-migration row below either — that combination falls through to no-op unless checked explicitly, silently leaving QA screenshots/traces untracked or committed indefinitely.

| Current state | Action |
|---|---|
| No `.gitignore`, or one with no `.claude-tweaks` reference at all | Suggest adding the split entries above. |
| Standalone blanket `.claude-tweaks/` line (the old, pre-split form) | **Migrate.** Propose replacing the blanket line with the split entries above (the per-level `pipelines/` un-ignore block plus `.claude-tweaks/research/`, `.claude-tweaks/code-health/`, `.claude-tweaks/harness-health/`, `.claude-tweaks/journey-health/`, `.claude-tweaks/docs-health/`, `.claude-tweaks/routine-environment-cache.yml`) rather than silently treating it as already covered — the blanket form makes `.claude-tweaks/routines/{name}.yml` permanently uncommittable. Backup `.gitignore` before write. |
| Split entries present, but `.claude-tweaks/pipelines/` is a bare blanket sub-line (the old, pre-per-level form) | **Migrate.** Propose replacing that single line with the per-level un-ignore block above — the naive form makes `pipelines/{run-id}/work/` (and its `spec-*/work/` and `archive/*/work/` variants) permanently uncommittable, silently pruning the audit trail `flow/materialize.md` promises. Backup `.gitignore` before write. |
| Bare root-level `screenshots/` line (the pre-relocation artifact suggestion), with or without a `traces/` line | **Migrate.** Add `.claude-tweaks/artifacts/`; keep the legacy `screenshots/` line and add a legacy `traces/` line so pre-relocation artifact trees stay ignored while they still exist on disk. Both legacy lines become removable once the artifacts residue probe (#1078) has surfaced and cleaned the legacy trees. Backup `.gitignore` before write. |
| Split entries present with the per-level `pipelines/` pattern, but no `.claude-tweaks/artifacts/` line, and no bare `screenshots/` line to trigger the row above | **Migrate.** Add `.claude-tweaks/artifacts/` — this project split before that line existed. Backup `.gitignore` before write. |
| Split entries present, but no `.claude-tweaks/wrap-up-outcomes.tsv` line | **Migrate.** Add `.claude-tweaks/wrap-up-outcomes.tsv` — this project split before that line existed; without it, `close-run`/wrap-up telemetry can end up tracked and, under `worktree-always`, permanently uncommittable (#1561). Backup `.gitignore` before write. |
| Already has the split entries with the per-level `pipelines/` pattern AND `.claude-tweaks/artifacts/` AND `.claude-tweaks/wrap-up-outcomes.tsv` | No-op (already migrated). |
| A blanket `.claude-tweaks/` line the project keeps (declined the migration above), and Step 6.6 proposes or finds a `verify-scope.json` | A negation under a directory pattern does nothing — git cannot re-include a path whose parent directory is excluded. Suggest replacing the blanket line with `.claude-tweaks/*` followed by `!.claude-tweaks/verify-scope.json` (verified: the file then shows as untracked, ready to add); the declaration is project-owned and must be tracked (#1924). |

If `stories/` exists or will be created, call `AskUserQuestion`:

- `question`: `"Should story YAML files be committed to version control?"`, `header`: `"Stories in git"`, `multiSelect`: `false`
- Option 1 — `label`: `"Yes — commit stories/ (Recommended)"`, `description`: `"Stories are part of the project's test suite; track them in version control."`
- Option 2 — `label`: `"No — add to .gitignore"`, `description`: `"Add stories/ to .gitignore instead of committing it."`

Do not modify `.gitignore` without asking — the user may have opinions about what to track.
