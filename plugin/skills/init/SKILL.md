---
name: init
description: Use when initializing the workflow system for a project — bootstraps structure, analyzes the codebase, generates CLAUDE.md with adaptive philosophy, skills, and rules. Re-run to find drift, gaps, and stale configuration.
argument-hint: "[<path>|<github-url>|<description>|--update|update|--full|--core-only|bootstrap|config|skills|journeys|docs|github-remote|issue-form|design-integration|diagram-suggestions|shadcn-integration|cloud-parity|routines|branch-tracking|work-backend|autonomy|emil-skills|integration-model]"
---

# Init — Project Bootstrap + Intelligent Configuration

Bootstrap the workflow system for a project AND generate intelligent configuration from codebase analysis. Handles everything from directory creation to CLAUDE.md generation, skills, rules, and journey discovery — in one command.

Lifecycle: **`/claude-tweaks:init`** → `/claude-tweaks:capture` — first step of the chain; the full chain is in `/claude-tweaks:help`.

This skill works for both greenfield and brownfield projects, operating in two modes:

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Initial** | No `.claude/` directory or CLAUDE.md | Full bootstrap + reconnaissance → generate everything from scratch |
| **Update** | Existing `.claude/` config found | Skip bootstrap (idempotent) + diff-based audit → propose targeted patches |

## When to Use

- First time using the workflow system on a project
- After cloning a repo that uses this workflow (to verify dependencies + audit config)
- You've been handed a project you've never worked on before
- You want to audit/refresh an existing Claude Code setup after the codebase has evolved
- When `/claude-tweaks:help` or `/claude-tweaks:build` fails because something is missing
- The user says "set up the workflow," "get me started," "set up Claude Code for this repo," or "update my Claude config"

## Input

If `$ARGUMENTS` resolves to a path to a repository (e.g., `~/projects/their-app`) or a GitHub URL, `cd`/clone there first, then analyze — evaluated before any token classification below.

Otherwise, `$ARGUMENTS` splits on whitespace into tokens. Each token classifies as one of:

**Modifier flags** — compose with anything else present:
- `--update` or `update` — force Update mode even if the config looks minimal
- `--full` — force the complete reconnaissance pass (Phases 2-8.5) even when Update Mode's Phase 1u.6 early-exit gate would otherwise skip straight to Phase 9; composes with `--update`/`update` (e.g. `update --full`)
- `--core-only` — within Phase 0, skip the Optional Enhancements (Steps 9 onward) entirely, equivalent to auto-declining every optional-enhancement offer, then continue into whatever scope this invocation would otherwise run. Contradicts any Enhancement filter token below present in the same invocation — see "Unrecognized and conflicting tokens."

**Phase scopes** — determine which of Phases 2-8.5 run after Phase 0. The union of every Phase scope present runs (e.g. `skills journeys` runs the phases for both).
- `bootstrap` — run Phase 0 only (structure + deps), then stop
- `config` — run Phases 0 + 2 + 3 + 5 (bootstrap + recon + CLAUDE.md)
- `skills` — run Phases 0 + 2 + 3 + 4 + 6 (bootstrap + recon + skills)
- `journeys` — run Phases 0 + 8 (bootstrap + journey discovery)
- `docs` — run Phases 0 + 2 + 3 + 8.5 (bootstrap + doc registry)

**Enhancement filter tokens** — one per Optional Enhancement step: `github-remote`, `issue-form`, `design-integration`, `diagram-suggestions`, `shadcn-integration`, `cloud-parity`, `routines`, `branch-tracking`, `work-backend`, `autonomy`, `emil-skills`, `integration-model`, `release`. Each narrows Phase 0's Optional Enhancements (Steps 9 onward) to *only* the named step(s), whether or not a Phase scope is also present; with none given, Phase 0 offers every one of them (or none, under `--core-only`). Several silently run Step 9 (or Step 14) first. For the token → step table with dependency notes and worked examples, read `input-grammar.md` in this skill's directory.

A description of the project context (e.g., "Ruby on Rails monolith, team of 5") is still accepted as free text — see "Unrecognized and conflicting tokens" for how this is distinguished from an attempted-but-unmatched keyword.

Every Phase scope above still runs Phase 9 as its terminal summary/confirm/write step, except `bootstrap`; an invocation carrying only Enhancement filter tokens also stops after Phase 0. For the full terminality rules — including the goal-based scopes that don't list Phase 9 in their own subset, and the Scope Selection Gate choices that stop early — read `input-grammar.md` in this skill's directory. Which paths stop before Phase 9 matters for the deferred policy write; see "Finalizing the worktree-always Decision" below.

If no arguments, analyze the current working directory. Phase 0 runs first, then a scope selection gate determines which remaining phases to run (see "Scope Selection Gate" below).

### Unrecognized and conflicting tokens

A token matching none of the categories above stops the invocation before anything runs, for one `AskUserQuestion` naming it — **unless** the whole string reads as prose (a comma, or a natural-language sentence), which is treated as a project-context description with no interruption. An Enhancement filter token given together with `--core-only` is a contradiction and is reported the same way. Never silently guess either interpretation. Full rules, including the option set that keeps a genuine single-word description working, are in `input-grammar.md` (the same file as the token table above — one read covers both).

## Phases at a Glance

| Phase | What Happens | Output |
|-------|-------------|--------|
| **0** | Bootstrap structure (dirs, files, deps, git, browser) | Workflow infrastructure ready |
| **1** | Determine mode (Initial vs Update) | Mode decision + existing config inventory |
| **2** | Codebase reconnaissance (8 detection steps) | Raw findings: stack, architecture, conventions, pain points, maturity |
| **3** | Build profile (Initial) or drift report (Update) | Stack Profile or Configuration Health Report |
| **4** | Generate skill manifest | Scored + prioritized skill candidates. Priority 2-3 → backlog |
| **5** | Generate / update CLAUDE.md | CLAUDE.md (how to work here). Improvement pain points → backlog |
| **6** | Generate / update skills | SKILL.md files for approved skills. Aspirational skills → backlog |
| **7** | Generate / update rules (optional) | Path-scoped `.claude/rules/` files |
| **8** | Discover user journeys (optional) | Journey files or skeleton backlog work records |
| **8.5** | Create doc registry | `docs/REGISTRY.md`. Doc work → backlog |
| **9** | Present summary and confirm | Final confirmation before writing files |

---

## Phase 0: Bootstrap Structure

Fast, idempotent structural setup. Creates directories, starter files, and verifies dependencies. Skips anything that already exists.

### Core Bootstrap Version Check (runs before Step 1)

Before running Steps 1-8.5, read `.claude-tweaks/init-state.yml` (treat as absent if missing or malformed) and compare its `core-bootstrap.plugin-version` against `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`'s `version` field (the same field `/claude-tweaks:help` treats as the sole source of truth) via `bin/lib/changelog.js`'s `compareVersions`. Read `bootstrap/version-check.md` for the exact commands.

Marker missing or unreadable → run Steps 1-8.5 fully, no changelog notice. Marker version equal to (or newer than) the installed version → skip Steps 1-8.5 entirely and print a one-line confirmation. Marker older → run Steps 1-8.5 fully, then surface a filtered changelog notice for the version range. The marker-state table, the changelog-notice procedure, and the rule for when the marker itself is written all live in `bootstrap/version-check.md` alongside the commands above — one read covers the whole check.

**Exception:** an explicitly-named `bootstrap` Phase scope (see `## Input`) always runs Steps 1-8.5 fully, regardless of the marker — `bootstrap` documents itself as "run Phase 0 only (structure + deps)," and a version-match skip would silently turn an explicit request for exactly that into a near no-op.

**Core Bootstrap (Steps 1–8.5):**

### Step 1: Check Plugin Dependencies

Verify Superpowers plugin and the built-in code-simplifier subagent are available. Read `bootstrap/step-01-check-plugin-dependencies.md` for the dependency list, detection commands, and install hint.

### Step 2: Create Directory Structure

Create the required workflow directories — idempotent, only creates what's missing. Read `bootstrap/step-02-create-directory-structure.md` for the directory taxonomy and per-directory rationale.

### Step 3: Work-Record Storage

No starter files are written — work records live on the tracker (`github-issues`) or as flat `specs/{n}-{slug}.md` files (`local-files`), neither of which needs scaffolding. Read `bootstrap/step-03-starter-files.md` for the rationale.

### Step 4: Suggest .gitignore Entries

Suggest entries for transient workflow artifacts; never modify `.gitignore` without asking. Read `bootstrap/step-04-gitignore-suggestions.md` for the full suggested block and the stories-commit prompt.

### Step 5: Verify Git

Confirm the directory is a git repo; warn if not (review and wrap-up will be degraded). Read `bootstrap/step-05-verify-git.md` for the full procedure.

### Step 6: Worktree Configuration

Ensure `.worktrees/` exists in the project root for the git-fallback path; leave any `.claude/worktrees/` directory alone as a separate, harness-owned convention that needs no migration. Also offers the `worktree-always` policy opt-in (recommended default: on) — the decision is queued here but the file write is deferred to avoid this same run denying its own later writes; see "Finalizing the worktree-always Decision" and "Worktree Policy Finalization" below. Read `bootstrap/step-06-worktree-configuration.md` for the full procedure.

### Step 6.5: Port Isolation

Detects literal dev-server ports and offers a reviewable rewrite to env reads (never applied without the gate, even in `auto`); queues the `port-services` policy decision through the same deferred write as `worktree-always` (see "Finalizing the worktree-always Decision"). Read `bootstrap/step-06-5-port-isolation.md`.

### Step 6.6: Verify-Scope Starter

Proposes a starter `.claude-tweaks/verify-scope.json` from the detected workspace (suites per tested package, shared packages → every suite, pipeline bookkeeping → none) and offers to write it — create-if-absent only. Read `bootstrap/step-06-6-verify-scope.md`.

### Step 7: Browser Integration

Detect `agent-browser`; surface the install command if missing. Never block init, never auto-install, never prompt for backend choice. Read `bootstrap/step-07-browser-integration.md` for the full procedure.

### Step 8: Statusline & Dependencies

Detect Node (and optionally git), install the statusline wrapper at `~/.claude-tweaks/bin/statusline.js`, and prompt before wiring `statusLine.command` in `~/.claude/settings.json` — never overwrite a non-claude-tweaks command. Read `bootstrap/step-08-statusline-and-dependencies.md` for the full procedure.

### Step 8.5: Dependency Read-Only Permissions

Seeds a read-only `Read`/`Grep` allowlist for the project's `node_modules` (plus `.pnpm/**` on pnpm workspaces) in `.claude/settings.json`, idempotently — also repairs a missing entry on re-run. Read `bootstrap/step-08-5-dependency-read-permissions.md` for the full procedure.

**Optional Enhancements (Steps 9 onward):** Skipped when `--core-only` is set — every offer below is treated as declined, no prompt shown, and the invocation proceeds straight to whatever runs after Phase 0 (Scope Selection Gate, or a composed goal-based Phase scope). Narrowed to a subset by Enhancement filter tokens — see `## Input`'s token list for the full set and each token's ordering/hard-depends notes.

### Step 9: Establish GitHub Remote (Optional)

Interactive-only — never runs in `auto`/non-interactive mode. When no git remote is configured at all (any existing remote, GitHub or not, skips this step), offers to get the `gh` CLI installed and authenticated, then offers to create a GitHub repository and link it as `origin`. Establishes the remote that Steps 10/14/16/17/20 below each independently check for — declining falls through to existing behavior. Read `bootstrap/step-09-establish-github-remote.md` for the full procedure.

### Step 10: GitHub Issue Form Template (Optional)

GitHub issue form template offer (agent-task.yml). Read `bootstrap/step-10-github-issue-form.md` for the full procedure.

### Step 11: Impeccable Design Integration (Optional)

When Phase 2 detects frontend signals, present the three-option Impeccable setup prompt (Full / Plugin-only / Skip) and write the `design-integration` flag to CLAUDE.md — the `/claude-tweaks:design-wrapper` wrapper reads this as Layer 1 of its detection logic. Read `bootstrap/step-11-impeccable-design-integration.md` for the full procedure (frontend-detection list, install sequence, flag-value table, re-run behavior, failure handling).

### Step 12: Diagram Suggestions

Always offered (not frontend-gated). Present the two-option diagram-suggestions prompt (Enable / Skip) and write the `diagram-suggestions` flag to CLAUDE.md under the existing `## Design integration` section. Soft-hook nudges in `/journeys`, `/specify`, and `/review` read this flag to decide whether to suggest invoking `/claude-tweaks:visualize`. No install step — `/claude-tweaks:visualize` is a native skill. Read `bootstrap/step-12-diagram-suggestions.md` for the full procedure.

### Step 13: shadcn Bootstrap (Optional)

When frontend signals are detected and `components.json` doesn't exist (or exists without full AI-agent wiring), present the shadcn/ui setup prompt (Full / CLI-only / Skip, or the narrower "wire remaining layers" offer when the CLI is already initialized) and write the `shadcn-integration` flag to CLAUDE.md. Currently write-only — no other skill reads the flag yet. Read `bootstrap/step-13-shadcn-bootstrap.md` for the full procedure.

### Step 14: Cloud/Routine Parity Setup (Optional)

Always offered when a GitHub-flavored remote is reachable (same GHE-safe two-tier check as Step 9). Warns on a current-vs-default branch mismatch, declares the plugin set in `.claude/settings.json#enabledPlugins` (what a cloud sandbox may load — not what installs it), generates the committed `scripts/claude-cloud-setup.sh` that actually materializes plugins in a fresh sandbox, and writes the `## Cloud parity` CLAUDE.md section. Idempotent ("already configured"; the branch check itself still runs every time). Read `bootstrap/step-14-cloud-routine-parity.md` for the full procedure.

### Step 15: Routine Installation (Optional Companion)

Always offered (not gated) — detect which claude-tweaks skills ship `routine-template.yml` without an instantiated record for this project, present via one multiSelect `AskUserQuestion` (≤4-option groups past 4 candidates) with default schedules, and invoke `/claude-tweaks:routine create <skill> --defaults --environment=<id> --source init` per selected candidate — no per-candidate walkthrough. Issues (or skips, when none selected) Step 14's deferred dedicated-environment offer. Idempotent: existing-record candidates aren't re-offered — Update Mode audits records for drift, relevance, environment dedication; see `update-mode.md`'s Routine Drift/Relevance/Environment Dedication entries. Read `bootstrap/step-15-routine-installation.md`.

### Step 16: Non-Default-Branch Issue Tracking (Optional Companion)

Offer only on projects with a GitHub remote — writes `.github/workflows/track-issue-fixes.yml`, which labels (`fix-on-<branch>`) and comments on issues fixed on non-default branches, then strips those labels once the fix reaches the default branch and GitHub closes the issue natively. Idempotent: skipped silently once the workflow file exists. Read `bootstrap/step-16-non-default-branch-issue-tracking.md` for the full procedure.

### Step 17: Work-Record Backend (Optional)

Decide whether the unified work record — used by `/claude-tweaks:capture`, `/claude-tweaks:specify`, `/claude-tweaks:backlog`, `/claude-tweaks:dispatch`, `/claude-tweaks:tidy`, and the health skills — is backed by GitHub issues or local record files, and write `work-backend` to CLAUDE.md under a `## Work records` section (gated on the same GHE-safe two-tier remote check Step 9 uses). Then probe GitHub-native capabilities once (`work-types`, `work-links`) and offer to provision the full core label set now (counts and the taxonomy these config keys govern: `_shared/work-record.md`'s Label taxonomy table, not restated here). Read `bootstrap/step-17-work-record-backend.md` for the full procedure.

### Step 18: Autonomy Level (Optional)

Ask how much claude-tweaks pipelines should decide on their own — ledger bookkeeping, queue-write filing, ops-item acknowledgment — versus asking every time, and write `autonomy` to `.claude-tweaks/policy.yml` when the answer isn't the schema default (`supervised`). `Trusted` is the recommended answer: every capability it unlocks is floor-gated to four narrow, reversible blocker-reason categories and every auto-resolution is logged — see `_shared/autonomy-ceiling.md` for the full contract. Read `bootstrap/step-18-autonomy-level.md` for the full procedure.

### Step 19: Emil Design-Engineering Skills (Optional)

When frontend signals are detected (same detection as Step 11), offer `npx skills@latest add emilkowalski/skills` — the principles half of the craft layer's UI-dispatch context (`skills/_shared/design-craft.md`). Optional, cleanly declinable, degrades gracefully when absent. Deliberately no CLAUDE.md flag — availability is presence-based; the kill-switch is Step 11's `design-integration`. Idempotent (skips when already installed). Read `bootstrap/step-19-emil-skills.md` for the full procedure.

### Step 20: Integration Model (Optional)

On a GitHub-reachable project, offers pinning `integration-model: pr-first` to policy.yml (`_shared/integration-model.md`) so it resolves the same across environments instead of via per-session forge detection. Read `bootstrap/step-20-integration-model.md` for the full procedure.

### Step 21: Release Bootstrap (Optional)

Detects existing release automation (`fresh` / `already-bootstrapped` / `conflict`) and, on a fresh repo, writes the release-please config, manifest, and — `pr-first` only, per Step 20's `integration-model` (`_shared/integration-model.md`) — the workflow, plus the two commented-out `release-*` policy rows; refuses on a conflicting tool. Read `bootstrap/step-21-release.md` for the full procedure.

---

### Finalizing the worktree-always Decision

If Step 6 (`bootstrap/step-06-worktree-configuration.md`) queued a `worktree-always` decision, it must be written to `.claude-tweaks/policy.yml` exactly once, as the very last filesystem action before this `/init` invocation ends — for whatever reason it ends. Phase 9's "Worktree Policy Finalization" (below) is the normal place this happens; the known early-exit paths (`bootstrap` scope, the Scope Selection Gate's Option 4, and Option 2's per-phase "Done") write it themselves instead, and are known cases rather than an exhaustive list.

For the full exit-path rule, the isolated-worktree write mechanism, and the confirmation message shown when the decision was "Yes," read `worktree-policy-finalization.md` in this skill's directory.

---

## Scope Selection Gate

After Phase 0 completes, present the scope selection — unless `$ARGUMENTS` already specified a goal-based Phase scope (e.g., `bootstrap`, `config`, `skills`, `journeys`, `docs`), in which case skip this gate and run the corresponding phases; or one or more Enhancement filter tokens with no Phase scope, in which case skip this gate and stop after Phase 0 (same as `bootstrap` alone) — see the `## Input` section.

**Not silenced by `auto`.** The scope-selection gate is on the "What `auto` does NOT silence" list in `_shared/auto-mode-card.md` — it is a project-shape governance decision that requires explicit user input regardless of `auto` state. The prompt below always renders unless `$ARGUMENTS` already specified a scope.

The gate is one `AskUserQuestion` with four options — Auto (run every included phase end-to-end), Interactive (a per-phase continue/skip/stop gate re-issued after each phase), Essentials (Phases 2, 3, 5 only — the `config` scope), and Done (stop after Phase 0). Auto and Essentials still reach Phase 9; Interactive's "Stop here" and Done end the invocation early, and when they do and Step 6 queued a `worktree-always` decision, write it first — see "Finalizing the worktree-always Decision" above.

For the literal prompt text, both option sets, and what each option runs (including which gates `auto` never silences), read `scope-selection-gate.md` in this skill's directory.

### Phase dependencies

Excluding a phase — by interactive skip, Essentials mode, or a goal-based argument — cascades to its dependents: Phases 3-8.5 need Phase 2, Phases 4/5/8.5 need Phase 3, Phase 6 needs Phase 4; Phases 5, 6, 7, 8, and 8.5 have no downstream dependents and are safe to skip alone. The full impact/handling table and the wording of the skip notice are in `scope-selection-gate.md` (same file as the gate above).

---

## Phase 1: Determine Mode

Before any deep analysis, check what already exists:

```
Check:
- CLAUDE.md exists? Read it.
- .claude/skills/ directory? List all skills, read each SKILL.md frontmatter.
- .claude/rules/ directory? List all rules, read each.
- .claude/settings.json? Read it.
```

### If `$ARGUMENTS` includes `--update` or `update` → **Update Mode** (proceed to Phase 1u), regardless of what the existence check above found — this is the explicit override from the `## Input` section, for a bare/near-empty `.claude/` the existence check alone would otherwise route to Initial Mode

### Else if nothing exists → **Initial Mode** (skip to Phase 2)

### Else (config exists) → **Update Mode** (proceed to Phase 1u)

Update Mode runs three sub-phases before deciding whether to continue with the full reconnaissance: Phase 1u (inventory + covered/stale/drifted/gap classification), Phase 1u.5 (claude-tweaks contract drift), then Phase 1u.6 (the early-exit gate that skips straight to Phase 9 on zero drift and few gaps).

Update Mode procedures live in `update-mode.md` — load only when Phase 1 detects existing config. That file contains the inventory template, the contract-drift conformance check, and the early-exit decision logic. It opens with the one-line description of each sub-phase named above.

---

## Phase 2: Codebase Reconnaissance

Work through these detection steps systematically.

> **Parallel execution:** Use parallel tool calls aggressively — all glob/grep operations within a substep are independent and should run concurrently.

### 2a: Project Identity

Establish what the project *is*: purpose and domain (README, CONTRIBUTING, `docs/`), open-source vs. proprietary licensing, CI/CD platform, monorepo vs. single app, and repo age plus recent commit/contributor activity. Its detect list now sits with 2b–2h in the file named below — one read covers every substep of this phase.

Steps 2b–2g cover stack detection, architecture detection, convention detection, workflow detection, pain point detection, and existing AI configuration detection. For the complete detection tables and checklists, read `detection-tables.md` in this skill's directory.

### 2h: Project Maturity Detection

Assess the project's maturity stage (greenfield / pre-launch / early-production / established) to inform the Philosophy section in CLAUDE.md. Gather signals in parallel and classify the project.

See **Phase 2h Maturity Detection** in `detection-tables.md` (this skill's directory) for the full signal table and classification criteria. Carry the classification forward to Phase 3, where it is presented alongside the doc tier for unified confirmation. Do NOT present the classification for confirmation here — Phase 3 is the single confirmation gate for all project classifications.

---

## Phase 3: Build the Profile / Drift Report + Project Classification

**Initial Mode** produces a Stack Profile (identity, stack table, architecture, conventions, workflows, health indicators, skill candidates) followed by a unified Project Classification confirmation. **Update Mode** produces a Drift Report (covered, stale, drifted, gap classifications). Both require user confirmation before proceeding.

For the complete profile and drift report templates, read `profile-templates.md` in this skill's directory.

### Project Classification (confirmation gate)

After presenting the Stack Profile (or Drift Report), present the unified Project Classification gate. This is the single gate where the user confirms or overrides all downstream decisions about philosophy and doc structure.

**Decision logic:**

- Compute detection confidence (`high` / `med` / `low`) for both maturity and doc-tier dimensions.
- **Auto-confirm** only when `auto` mode is set AND both dimensions are `high` confidence AND signals are internally consistent. Log to `decisions.md` and proceed.
- **Confirmation gate** in all other cases — interactive mode, or `auto` with `med`/`low` confidence, or contradictory signals (e.g., greenfield code + production-grade infra).

For the confidence rubric, auto-confirm log format, and full confirmation-gate template (table + philosophy + doc structure + numbered options), read `phase-3-classification.md` in this skill's directory.

Carry the confirmed maturity and doc tier forward to Phase 5 (CLAUDE.md Philosophy) and Phase 8.5 (Doc Registry).

---

## Phase 4: Generate Skill Manifest

**Initial Mode:** Score and prioritize all skill candidates.

**Update Mode:** Score only the **gaps**. Existing skills that need updating are handled as patches, not new skills.

> **Parallel execution:** Use parallel tool calls aggressively — scoring of independent skill candidates is read-only (re-checking grep/glob signals from Phase 2) and should run concurrently.
>
> **Parallel execution (conditional):** When the candidate list has ≥ 8 skills, dispatch scoring as parallel Task agents per the Subagent Contract (`_shared/subagent-output-contract.md`). Otherwise, run the scoring inline in the main thread. Fan-out: single-assistant-message rule applies.
>
> **Model profile:** [Use: Standard] — three-dimension judgment against Phase 2 evidence; not mechanical enough for Fast, not synthesis-heavy enough for Capable. Resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" standard` (contract § Model Selection).

Apply the **Frequency + Complexity + Danger** rubric (max 9). Generate skills scoring 6+ first. Skills not selected (Priority 2-3 or aspirational) become backlog work records with their scoring rationale and Phase 2 evidence — no reconnaissance is wasted.

For the full scoring rubric (with examples), the skill-category mapping reference, and the deferred-skill backlog work-record format, read `phase-4-scoring.md` in this skill's directory. For the Skill Manifest presentation template and the selection prompt, read `profile-templates.md` (Phase 4 section).

---

## Phase 5: Generate / Update CLAUDE.md

CLAUDE.md describes **how to work in this codebase** — the patterns to follow, the commands to run, the conventions to respect, and the mistakes to avoid. Every entry should help someone working in the codebase right now. Things that don't exist yet belong in the backlog, not here.

**Initial Mode** generates CLAUDE.md from scratch with sections for Stack, Structure, Commands, Conventions, Philosophy, Testing, Environment, Git, and Don'ts. **Update Mode** produces targeted patches, not rewrites. The Philosophy section adapts to detected project maturity. The Don'ts section is the highest-ROI output — mine it from convention conflicts and observed anti-patterns (not from missing infrastructure).

For the complete CLAUDE.md template, patch format, Philosophy generation guide, Don'ts mining guide, principles, and the Frontier dispatch, read `claude-md-template.md` in this skill's directory.

### Pain Point Routing

Phase 2f findings split into CLAUDE.md Don'ts (convention conflicts and anti-patterns) and backlog work records (missing infrastructure, practices, stale deps, dead code). For the backlog work-record templates and the "Pain Points Routed" summary template, read `pain-point-routing.md` in this skill's directory.

---

## Phase 6: Generate / Update Skills

> **Parallel execution (conditional):** Under Update Mode, when the drift-patch audit's read set (`_shared/harness-health-analysis.md`) covers ≥ 8 existing skills, dispatch the per-skill audit as parallel Task agents per the Subagent Contract (`_shared/subagent-output-contract.md`) — the same threshold and pattern Phase 4 already uses for scoring. Otherwise, run the audit inline in the main thread.
>
> **Model profile:** [Use: Standard] — format-sensitive conformance checking, not synthesis-heavy; defaulting to Capable across 8+ agents costs ~5x for no judgment gain. Resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" standard` (contract § Model Selection).

**Initial Mode** generates full SKILL.md files for each approved skill. **Update Mode** produces targeted patches for drifted skills and full SKILL.md for gap skills. Each generated skill must pass quality gates (codebase-grounded examples, working commands, project-specific anti-patterns). Skill depth scales with complexity score.

Only generate skills for patterns that **actually exist and are actively used** in the codebase. Aspirational skills (e.g., testing for a project with no tests) should have been captured as backlog work records in Phase 4 — do not generate SKILL.md files for them.

For the complete SKILL.md template and depth guide, read `skill-template.md` in this skill's directory. For the drift-patch procedure and quality gates applied to drifted/gap skills, read `_shared/harness-health-analysis.md` — the same procedure `/claude-tweaks:wrap-up`'s Skills curation row and the standalone `/claude-tweaks:harness-health` routine use.

---

## Phase 7: Generate / Update Rules (optional)

Generate `.claude/rules/` files for **path-specific** conventions (e.g., "all files in `src/api/` must use the error handler"). Project-wide conventions belong in CLAUDE.md, not rules. For the rule frontmatter template, common rule candidates, and Update-Mode hint, read `rules-template.md` in this skill's directory.

---

## Phase 8: Discover User Journeys (Optional)

For projects with user-facing surfaces (web app, CLI, API with docs), offer to discover and document user journeys — especially valuable for brownfield projects with features but no documented flows. Skip for pure libraries or when `docs/journeys/` already has comprehensive coverage.

### Present the option:

One `AskUserQuestion` with three answers: codebase-only discovery **(Recommended)** — infer routes and personas from Phase 2 and write skeleton journey files plus one enrichment work record each; hybrid — delegate to `/claude-tweaks:visual-review discover` for a browser walkthrough; or skip.

For the literal prompt, the skeleton-file and work-record templates, and the delegation/skip procedures, read `journey-discovery.md` in this skill's directory.

---

## Phase 8.5: Create Doc Registry

Create the documentation registry that maps project docs to the code areas they cover. This registry is consumed by `/build` (Step 6.5) to auto-update docs when relevant code changes, and by `/wrap-up` (its Docs curation row) for final sweep and registry maintenance.

**Use the confirmed doc tier** from Phase 3 — do not re-detect.

For the complete procedure (registry format, tier definitions, standard folder taxonomy, common Auto-detect patterns, inventory → assess → batch table → create → backlog-capture flow, and Update-Mode diff logic), read `docs-structure.md` in this skill's directory.

---

## Phase 9: Present Summary and Confirm

Present a consolidated summary of all work done across Phase 0 (bootstrap) and Phases 1-8 (configuration). Wait for user confirmation before writing generated files. This phase is the terminal step for every scope except `bootstrap` — see "Input" above — including the goal-based Phase scopes (`config`/`skills`/`journeys`/`docs`) and the Scope Selection Gate's Option 1 (Auto) and Option 3 (Essentials), even though none of the goal-based Phase scopes list Phase 9 explicitly in their own phase subset.

Both modes lead with a **Verified & Consistent** section — an affirmative report of what was checked and found healthy (dependencies present, template conformance verified, config items still accurate, detections confirmed), not just what changed or was created. This is required, not optional: Update Mode in particular often proposes few or no changes, and the user needs to see *what was audited and deliberately left alone*. The early-exit fast path (Phase 1u.6) carries its own shorter Verified & Consistent block.

For the complete summary templates for both modes, read `summary-templates.md` in this skill's directory.

### Isolated Write Step

Every write below happens inside an isolated worktree, **unconditionally**, regardless of the current `worktree-always` policy — reconnaissance (Phases 1-8.5) stays direct. Read `isolated-write-step.md` for the full mechanism: scope, dirty-file pre-check, provisioning, ff-only merge-back.

### Actions Performed

After the Isolated Write Step lands, surface what was created as a `| Action | Detail | Ref |` table generated from the actual artifacts produced this run — only rows for actions that actually occurred, and the Worktree policy row always last. The full row set (bootstrap, starter files, statusline, design and shadcn integration, work records, GitHub remote, cloud parity, routines, routine re-sync, worktree policy, classification, CLAUDE.md, skills, rules, journeys, doc registry, backlog) is in `summary-templates.md` — the same file this phase already reads for the mode summaries, so it costs no extra load.

Execute only after user confirmation.

### Worktree Policy Finalization

If Step 6 queued a `worktree-always` decision, write it now, bundled into "Isolated Write Step"'s worktree/commit/merge; early-exit paths that skip Phase 9 write it standalone the same way. Still the last filesystem action of the invocation. Read `worktree-policy-finalization.md` for merge-don't-overwrite mechanics and the "Yes" message.

---

## Important Notes

- **This skill is idempotent** — safe to re-run. Phase 0 only creates what's missing. Phases 1-8 detect whether to generate fresh or patch existing config.
- **One session is not enough** — the initial skill set will be ~70% right. Expect to refine skills after the first week of actual use. Tell the user this explicitly.
- **Re-run periodically** — run in Update Mode after major refactors, stack upgrades, or when skills start feeling stale. A quarterly cadence works for active projects.
- **Update Mode should be fast** — Phase 1u.6's early-exit gate skips Phases 2-8.5 when drift is zero and preliminary gaps are < 3. Re-run with `--full` to force the complete pass.
- **Don't over-generate** — 5 excellent skills beat 15 mediocre ones. The Anti-Patterns section below covers the specific failure modes (aspirational Don'ts, generic skills, improvements-in-CLAUDE.md). Read those before adding to either output.

---

## Next Actions

Read `next-actions.md` in this skill's directory for the signal-resolution table and render rules.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Modifying existing backlog work records | Phase 0 is additive — never overwrite user content |
| Skipping CLAUDE.md generation | /claude-tweaks:review can't find verification commands |
| Running init in a non-git directory without warning | /claude-tweaks:review and /claude-tweaks:wrap-up need git — surface the degradation |
| Installing browser tools without asking | Optional — surface the install command, never run `npm install` |
| Prompting for a browser backend choice | Only one backend exists (`agent-browser`) |
| Generating generic skills (e.g., `auth.md`, `api-routes.md`) | Feature names, not conventions — skills encode rules, anti-patterns, or "why this way" insights observed in the codebase. No WebSockets, no realtime skill; no tests, testing is a backlog item, not a SKILL.md file. |
| Generating generic skills not grounded in the codebase | Generic advice adds noise, not value |
| Rewriting CLAUDE.md in Update Mode | Update Mode patches — existing config embeds hard-won lessons |
| Over-generating skills (15 mediocre > 5 excellent) | Each skill must encode knowledge otherwise lost |
| Skipping team input | Code archaeology misses social conventions — PR process, deploy cadence, naming |
| Aspirational Don'ts for things that don't exist | Don'ts guard existing patterns — "No CI" is a backlog item |
| Putting improvement ideas in CLAUDE.md | It describes the codebase as it is — improvements go to the backlog with Phase 2 context |
| Generating skills for patterns that don't exist yet | Aspirational skills (testing with no tests) become backlog records with Phase 2 evidence, not SKILL.md files |
| Hardcoding greenfield philosophy for all projects | Philosophy adapts to detected maturity — greenfield advice is dangerous on an established project |
| Creating doc files with only TODO placeholders | Phase 2 recon has the data — generate real content; under 20 lines of it belongs in README |
| Skipping journey discovery for user-facing features | `/review` tests against journeys — without them visual QA has no anchor |
| Writing journey "should feel" without using the app | Codebase-only skeletons have a weaker "should feel" — mark them as skeletons |
| Auto-copying local MCP server configs (`~/.claude.json`) into the committed `.mcp.json` | They can carry credentials — committing leaks secrets. Step 14's MCP-parity check is report-only; the user adds any that matter, manually. |
| Hand-editing `scripts/claude-cloud-setup.sh` | Regenerated on every `/init` run from `.claude/settings.json` — edits are silently overwritten. Customize via `enabledPlugins`/`extraKnownMarketplaces`, then re-run. |
| Assuming `/init` can set the cloud environment's Setup-script field | No API or CLI sets it remotely (`RemoteTrigger`'s schema covers only `/v1/code/triggers`) — always a manual one-time paste per environment in the claude.ai/code settings UI |
| Assuming Step 9 can authenticate `gh` non-interactively | `gh auth login --web` is device-flow — it always requires the user's own browser; no headless path exists |
