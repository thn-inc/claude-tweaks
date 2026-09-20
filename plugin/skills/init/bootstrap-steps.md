# Init Phase 0 Bootstrap — Index

Loaded by `/init` Phase 0 when the corresponding tool/feature is being set up. Each step is independent — read only the section(s) needed for the step currently executing. In Update Mode most of these are no-ops (already configured); the SKILL.md decides whether to load this file at all.

Each step now lives in its own file under `bootstrap/` so a run that triggers only a few steps
loads only those steps. `SKILL.md`'s stubs point straight at the per-step files — this index is
for the group-level conventions below and for navigation; nothing needs to read it to execute a
step.

| Step | File (under `bootstrap/`) | Covers |
|---|---|---|
| Version Check | `version-check.md` | Runs before Step 1 on every invocation — marker read, version compare, changelog notice. |
| 1 | `step-01-check-plugin-dependencies.md` | Superpowers + code-simplifier detection and install hint. |
| 2 | `step-02-create-directory-structure.md` | Directory taxonomy and per-directory rationale. |
| 3 | `step-03-starter-files.md` | Where work records live per backend; why no starter file is written. |
| 4 | `step-04-gitignore-suggestions.md` | Suggested `.gitignore` block and the stories-commit prompt. |
| 5 | `step-05-verify-git.md` | Git-repo verification and the non-git warning. |
| 6 | `step-06-worktree-configuration.md` | `.worktrees/` setup and the `worktree-always` policy opt-in. |
| 7 | `step-07-browser-integration.md` | `agent-browser` detection and install surfacing. |
| 8 | `step-08-statusline-and-dependencies.md` | Node/git detection, statusline wrapper, `settings.json` migration matrix. |
| 8.5 | `step-08-5-dependency-read-permissions.md` | Read-only `node_modules`/`node_modules/.pnpm/**` allowlist entry; idempotent, self-repairs on re-run when the plugin-version marker has advanced (or via `bootstrap` scope when it hasn't). |
| 9 | `step-09-establish-github-remote.md` | `gh` install/auth, repo creation, `origin` linking. Interactive-only. |
| 10 | `step-10-github-issue-form.md` | `agent-task.yml` issue form template offer. |
| 11 | `step-11-impeccable-design-integration.md` | Impeccable setup prompt and the `design-integration` flag. |
| 12 | `step-12-diagram-suggestions.md` | Diagram-suggestions prompt and the `diagram-suggestions` flag. |
| 13 | `step-13-shadcn-bootstrap.md` | shadcn/ui setup prompt and the `shadcn-integration` flag. |
| 14 | `step-14-cloud-routine-parity.md` | `enabledPlugins` declaration, `claude-cloud-setup.sh`, `## Cloud parity` section. |
| 15 | `step-15-routine-installation.md` | Routine-template detection and `/claude-tweaks:routine create` invocation. |
| 16 | `step-16-non-default-branch-issue-tracking.md` | `track-issue-fixes.yml` workflow offer. |
| 17 | `step-17-work-record-backend.md` | `work-backend` decision, capability probes, label bootstrap. |
| 18 | `step-18-autonomy-level.md` | Degree-of-autonomy question and the `autonomy` policy.yml value. |
| 19 | `step-19-emil-skills.md` | Emil design-engineering skills install offer (frontend-gated; presence-based, no flag). |
| 20 | `step-20-integration-model.md` | `integration-model: pr-first` policy.yml pin offer (`_shared/integration-model.md`; remote-gated). |
| 21 | `step-21-release.md` | Release-process detection (`fresh`/`already-bootstrapped`/`conflict`), the release-please config/manifest/workflow writes, and the two commented `release-*` policy rows (depends on Step 20's `integration-model`). |

## Core Bootstrap Steps (1-8.5)

Order-dependent — later steps may assume earlier ones completed. Steps 1-8.5 run unconditionally and idempotently (only act on missing state).

## Optional Enhancement Steps (9 onward)

Order-agnostic and append-only by default — most steps in this group are independent "detect condition → offer → write artifact → idempotent" companion integrations with no dependency on each other's order, so a new one is normally added at the end with no renumbering. Two steps are deliberate exceptions to that default, both inserted via a full renumbering rather than appended: Step 9 (Establish GitHub Remote) must run before Steps 10/14/16/17/20 — it establishes the remote those steps each independently check for, so appending it at the end would run too late to help them within the same bootstrap pass — and was inserted with a full renumbering of the then-Steps 9-16 → 10-17. Step 14 (Cloud/Routine Parity Setup, itself renumbered from 13 by this same pass) must run before Step 15 (Routine Installation) — a Routine created before cloud/plugin parity is set up would silently fail its first cloud firing — originally inserted with a renumbering of Steps 13-15 → 14-16. Future additions default back to append-only unless they have the same kind of genuine ordering dependency on an earlier step. One further narrow exception: Step 10's native-Type mention reads a config key (`work-types`) that only Step 17 writes — see Step 10's own note for how it handles running before Step 17 on a fresh bootstrap.
