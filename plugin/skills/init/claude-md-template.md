# Phase 5: CLAUDE.md Template and Guidelines

## Frontier singleton dispatch (record #221)

The synthesis step below — composing (Initial Mode) or patching (Update Mode) CLAUDE.md from Phase 2's reconnaissance — is dispatched as **one** `[Use: Frontier]` Task agent, never run inline and never fanned out: the main thread assembles the artifact bundle (Phase 2's reconnaissance findings, Phase 2f's pain-point list, and — Update Mode only — the existing CLAUDE.md's current text) and dispatches a singleton with that bundle.

**Output template.** Initial Mode returns the full composed CLAUDE.md body (per this file's section structure below); Update Mode returns one or more patches, each a `{section, before-excerpt, after-text, rationale}` block — the main thread applies each patch via Edit and commits, exactly as it already does for every other generated/patched file in this skill.

**Resolution.** `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" frontier --unattended` in every headless context (a scheduled Routine's `/init` run); a plain interactive run omits `--unattended` and lets the resolver's own interactive-context precondition apply. No init-specific interactivity check is added — the resolver's existing gate is the single mechanism, here as everywhere else. Degrades to Capable per the resolver's own preconditions (cap exhausted, stance below `default`), logged in its `source`; this file never re-enumerates those preconditions. The dispatch structure — bundle assembly, singleton call, main-thread apply — never branches on which model the resolver returns; only the model differs.

CLAUDE.md is a self-improvement surface in the same sense as `/wrap-up`'s curation — its output compounds across every future session in the project, which is what justifies Frontier's premium here.

## Core Principle

CLAUDE.md describes **how to work in this codebase** — the patterns to follow, the commands to run, the conventions to respect, and the mistakes to avoid. It is an operator's manual for an existing system, not a wishlist of improvements.

Every section should answer: "If I'm about to make a change here, what do I need to know?" Things that don't exist yet (missing CI, missing tests, missing linting) are backlog work items, not entries in CLAUDE.md. The moment something is set up, _then_ it earns a place here.

This principle applies equally during initial generation and updates. When updating CLAUDE.md, evaluate every proposed change against: "Does this describe how to work in the codebase _as it is right now_?"

## Initial Mode Template

Produce CLAUDE.md from scratch following this template:

```markdown
# {project name}

{One-line description of what the project does.}

## Stack

| Layer | Tech |
|-------|------|
| ... | ... |

## Structure

{Directory tree showing key directories and their purpose — max 15 lines}

## Commands

{Key package scripts — what developers actually run daily.
Verify every command exists in package.json / Makefile / scripts before listing.}

When `.claude-tweaks/verify-scope.json` exists, pipeline re-verifies run scoped against the last full pass (`test/verification.md`'s scoping table); `init --update` reports drift between its suites and the workspace. On a `port-services` checkout, `.env.local`'s managed region also exports `CLAUDE_TWEAKS_LEASE` (the leased block's base) — key a per-checkout test database on it the way ports are keyed: `DATABASE_URL=postgres://localhost:5432/app_test_${CLAUDE_TWEAKS_LEASE}`.

## Conventions

{Observed naming, patterns, and rules — max 10 bullets}

## Philosophy

{Adaptive principles that calibrate how Claude approaches changes in this project.
Generated from the maturity classification detected in Phase 2h. See "Generating Philosophy" below.}

## Working Approach

How to execute any task here. These apply project-wide unless a more specific rule or instruction overrides them; use judgment on trivial tasks.

- **Think before coding.** State assumptions; ask rather than guess when uncertain. Push back when a simpler approach exists. Stop when confused.
- **Honest, not agreeable.** When the user proposes a direction, pressure-test it before agreeing — name the weakest assumption first, not the strengths. State disagreement plainly: no flattery openers, no hedging, no reflexive reassurance. If you genuinely can't find a flaw, say so rather than manufacturing one.
- **Simplicity first.** Write the minimum correct code for what was asked — nothing speculative, no abstractions for single-use code. ("Do it properly" above means correct, not more.) Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch.
- **Surgical changes.** Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same. Match the surrounding style.
- **Goal-driven.** Define success criteria up front and loop until they're verified, rather than following steps blindly.
- **Read before you write.** Before adding code, read the file's exports, immediate callers, and shared utilities — duplicate logic usually already exists nearby.
- **Checkpoint multi-step work.** After each significant step, state what's done, what's verified, and what's left. Don't build on a state you can't describe back.
- **Fail loud.** "Done" is wrong if anything was skipped; "tests pass" is wrong if any were skipped. Surface uncertainty and partial results — never hide them.

## Testing

{Framework, run commands, file location, naming convention}

## Environment

{How to set up locally, where secrets live, required services}

## Git

{Commit convention, branch strategy, PR process}

## Releasing

{Engine in use — release-please via `.github/workflows/release-please.yml` under `pr-first`, or the local engine under `local-merge`; where the publish/deploy hook lives — the `release: published` workflow (PAT required), or the `release-hook` policy command. The local engine (`bin/release-local.js`) and the `/claude-tweaks:release` skill land with later units of the release family (#2250); until they ship, this section names the files the bootstrap wrote.}

Cut a release: `/claude-tweaks:release`

## claude-tweaks Pipeline

**Artifacts:** design doc (one file, phases = `## Phase N` sections) → spec (one per work unit, via `/claude-tweaks:specify`) → `/claude-tweaks:flow`. No multi-phase plan files (`*-P1.md`, `*-P2.md`, …); a single plan per spec via `/superpowers:writing-plans`, stopped before its execution-choice offer, is expected and normal.

**Spec close-out:** `specs/` is a working directory, not a permanent historical index — once a spec ships and is verified, promote any durable reference content to `docs/reference/*.md` or a skill, repoint by-number citations elsewhere in the repo to the closing commit or PR, then delete the spec file. A permanent tracker file (e.g. `specs/INDEX.md`) is an anti-pattern here, not a convention to preserve.

**Entry point:** `/claude-tweaks:specify` — accepts a topic (calls `/superpowers:brainstorming`), design-doc path, or a backlog work-record ref.

**`/claude-tweaks:flow`:** specs only — it rejects design docs. Defaults to `auto` (hands-off); pass `confirm`, `interactive`, or `hybrid` to change that.

**Auto mode:** in default `auto`, the Pipeline Config Manifesto renders as a read-only FYI — it computes and displays the policy levers, then proceeds without stopping — so the only user-facing stop is the Wrap-Up Review Console at the end. Pass `confirm` (or `hybrid`) to turn the Manifesto into a real approval gate; the rest of the pipeline still runs as `auto` once approved.

**Superpowers overrides:** `/superpowers:brainstorming` stops after the design doc — route to `/claude-tweaks:specify`, never `/superpowers:writing-plans`. `/superpowers:subagent-driven-development` and `/superpowers:executing-plans` don't auto-invoke `/superpowers:finishing-a-development-branch`. Before any merge decision — `/superpowers:finishing-a-development-branch`'s prompt, or `_shared/pr-first-merge.md`'s `gh pr merge` path — for work whose acceptance depends on rendered UI behavior (`Surface:`/`surface:` web/mobile/desktop, or acceptance criteria naming visual/interactive behavior — the signal `frontend-detection.md`'s Layer 2/3, in the `/claude-tweaks:design-wrapper` skill's directory, defines and `/claude-tweaks:specify`'s/`/claude-tweaks:build`'s Next Actions table both reuse), run a real browser-based visual check first — `/claude-tweaks:review {N} full` or `/claude-tweaks:demo`'s Validate step — or have the user explicitly decline it; raw HTML inspection does not satisfy this, and a check that silently self-skipped (no browser backend, no dev server) is not a satisfied precondition — surface it as an explicit decline instead. Backend/infra work with no UI surface is not blocked; a non-web frontend surface (mobile/desktop) with no automated rendered-check channel is satisfied by an explicit decline too (#808).

## Don'ts

{Anti-patterns observed or inferred — things that would break the project's conventions.
This section is the highest-ROI output. See "Mining Don'ts" below.}
```

## Update Mode

Produce a **patch** — not a full rewrite. For each stale/drifted item the user approved:

```markdown
## CLAUDE.md Patches

### Patch 1: {description}
**Location:** Line {N}, section "{section}"
**Current:** `{current text}`
**Proposed:** `{new text}`
**Reason:** {why — e.g., "script renamed", "convention changed", "new stack added"}

### Patch 2: ...
```

Apply patches using Edit tool calls with precise `old_string` → `new_string` replacements. Never rewrite the entire file in Update Mode unless the user explicitly asks for it.

## Mining Don'ts

The Don'ts section prevents more mistakes than any amount of positive guidance. Don'ts are **guardrails for patterns that exist** — they describe what _not_ to do when working in this codebase. They are never aspirational.

**The filter:** A Don't must describe a pattern that exists in the codebase and should not be violated. If something doesn't exist yet (no CI, no tests, no linting, stale dependencies), that's a backlog item for improvement work — not a Don't.

**The shape:** one sentence of rule, one clause of why — around 150 bytes. CLAUDE.md is inherited by every dispatched subagent, not just loaded once per session, so a padded Don'ts section is billed per agent across every fan-out. When a Don't comes from a real incident, write the account of it somewhere it is allowed to be long — an incident log, the work record, the commit message — and only then compress it to the rule. Do it in that order: write the rule first and you pad it, because the incident is vivid and every detail feels load-bearing. A Don't needing three sentences of background to be believed is a compressed rule plus an account that belongs elsewhere, not a long rule.

Source Don'ts from:

1. **Inconsistencies found in 2f** — if the codebase uses both patterns, codify which is correct
2. **Common mistakes for this stack** — e.g., "don't use `getServerSideProps` in App Router" for Next.js 13+
3. **Observed anti-patterns in 2f** — if there are 50 `eslint-disable` for the same rule, that's a "don't disable rule X" candidate
4. **Convention violations** — if 95% of files use named exports, "don't use default exports" is a Don't
5. **Security footguns** — any auth, input validation, or data handling patterns that must not be violated

**Not Don'ts** (these belong in the backlog instead):

| Finding | Why not a Don't | Backlog example |
|---------|----------------|---------------|
| No CI pipeline | Nothing to violate — it doesn't exist | "Set up CI — project uses {framework}, deploy to {target}" |
| No tests in `src/utils/` | Aspirational, not a guardrail | "Add test coverage for utils — {functions} are complex" |
| Dependencies 3 major versions behind | Work to do, not a constraint | "Upgrade {dep} — current: {v}, latest: {v}, breaking: {list}" |
| No linting configured | Can't enforce what isn't set up | "Set up linting — codebase uses {patterns}, {N} files" |
| Commented-out code blocks | Cleanup task, not a convention | "Clean up dead code in {files}" |

## Generating Philosophy

The Philosophy section adapts to the project's maturity classification (from Phase 2h). It contains two types of entries:

### Universal principles (include in all projects)

These apply regardless of project maturity:

- **Do it properly.** No display-only workarounds for data model issues, no "good enough" shortcuts that leave technical debt. If a value needs renaming, rename it everywhere including the database. If a type needs changing, change it at the source.
- **Assume zero cost.** Decide as if implementation is free. Never choose an inferior design because the better one "isn't worth the effort."
- **Assume zero time.** Decide as if implementation is instant. Never choose a shortcut because the proper approach "takes too long."
- **No implicit deferrals.** When something needs doing, either do it now, explicitly file a backlog work record via `/claude-tweaks:capture` — with a spec-shaped body (Current State / Deliverables / Acceptance Criteria) and a `Defer-reason:` from `_shared/deferral-gate.md` when an agent holds the context; a stub is for a human typing an idea — or, below the materiality floor, log it to the digest per `_shared/materiality-floor.md`. Never silently skip work or leave TODO comments without a corresponding backlog record or digest entry.

### Maturity-dependent principles (adapt to classification)

Select the appropriate entries based on the detected maturity:

#### Greenfield / Pre-launch

```markdown
Greenfield, pre-launch. There are no users on the platform yet. Always prefer the correct solution over the safe-migration path: rename columns, change types, restructure schemas, break APIs, delete and rebuild. Use db:push not migrations. Don't add backward-compatibility shims, expand-contract phases, or feature-migration code — just make the change. Prefer latest stable versions, modern APIs, and clean implementations. When in doubt, choose the newest production-ready approach and build it right the first time.
```

#### Early Production

```markdown
Early production. The platform has users but the codebase is still young. Prefer correct solutions but use migrations (not db:push) for schema changes. Breaking API changes are acceptable with coordination — document them, version if needed. Backward-compatibility shims are acceptable for short periods (< 1 sprint) to ease transitions, then remove them. Prefer modern approaches for new code; refactor existing code toward modern patterns when touched.
```

#### Established

```markdown
Established codebase with active users. Schema changes require migrations with rollback plans. API changes follow expand-contract: add the new, migrate consumers, remove the old. Backward compatibility is required for published interfaces. Feature flags for risky changes. Prefer stability over novelty — adopt new patterns in new code, migrate existing code incrementally. Test coverage gates before refactoring shared code.
```

### Additional maturity-dependent entries

| Signal | Greenfield | Established |
|--------|-----------|-------------|
| Developer tooling | "Developer-first. Prefer powerful developer tools over simplified abstractions. Code-based config with type safety over UI-driven config without guardrails." | Omit (team may have different preferences) |
| Automation | "Automation over manual actions. Everything reproducible: Terraform first, CLI scripts second, documented manual steps only as last resort." | Same, but emphasize change management and approval processes |
| Dependencies | "Use latest stable versions. Upgrade aggressively." | "Pin versions. Upgrade deliberately with testing." |

**Important:** Only include entries that match the project. A greenfield project with no infrastructure doesn't need the automation entry. An established project with no published APIs doesn't need the expand-contract entry. Adapt, don't copy blindly.

## Working Approach (universal behavior block)

`## Working Approach` is the one **standard, non-adaptive** section in the template — include it verbatim in every generated CLAUDE.md (like the `## claude-tweaks Pipeline` section). It encodes universal task-execution behavior (think-before-coding, honest-not-agreeable, simplicity, surgical changes, goal-driven, read-before-write, checkpointing, fail-loud) so that **ad-hoc work outside the pipeline** — where no skill gate fires — still gets the same guardrails the lifecycle skills enforce. Update Mode's conformance check byte-compares this section against the template, so a project that edits or trims it reports drifted on every pass — verbatim is enforced, not just advised.

Two rules of thumb:

- **Complements Philosophy, doesn't repeat it.** Philosophy calibrates *how aggressive changes should be in this codebase* (maturity-dependent). Working Approach is *how to execute any task* (project-independent).
- **No hard token-budget rule (deliberate).** The popular 8-rule CLAUDE.md template adds a "hard per-task / per-session token budget, summarize-and-restart on breach" rule. claude-tweaks **omits it on purpose**: context management is the harness's job, and `_shared/auto-mode-contract.md` explicitly forbids the model from inserting context-window/budget stop prompts. Do not add a token-budget bullet here.

## Principles

- **How to work here, not what's missing** — every entry should help someone working in the codebase right now. Improvements belong in the backlog.
- **Observed, not aspirational** — document what the codebase actually does, not what it should do
- **Under 150 lines (default; override via `harness-health-always-loaded-budget` in `.claude-tweaks/policy.yml`)** — if it doesn't fit, it belongs in a skill or rule
- **Commands must work** — verify scripts exist before listing them
- **Don'ts are guardrails, not wishes** — they describe existing patterns that should not be violated, never infrastructure that doesn't exist yet
- **Philosophy adapts to maturity** — the same principle stated differently for greenfield vs established projects prevents both reckless breaking changes and unnecessary conservatism
- **Working Approach is standard, not adaptive** — include the universal behavior block verbatim; it covers ad-hoc work that never triggers a skill gate. No token-budget rule (the harness owns context)
