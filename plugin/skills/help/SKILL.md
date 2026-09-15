---
name: help
description: Use when you need a quick reference for available commands, want to see workflow status, or need a recommendation for what to do next.
argument-hint: "[status|commands|policy|<topic>] [--budget <n>]"
---

# Help — Quick Reference + Workflow Dashboard

One-stop reference and status dashboard for the workflow system. Combines command help, pipeline scanning, and next-step recommendations.

```
/claude-tweaks:init → /claude-tweaks:intake → /claude-tweaks:capture → /superpowers:brainstorming → /claude-tweaks:specify → /claude-tweaks:build → /claude-tweaks:stories → /claude-tweaks:test → /claude-tweaks:review → /claude-tweaks:wrap-up
    ↑                                                                                                                                                                                                                   |
    └──────────────────────────────────── [ /claude-tweaks:help ] (dashboard + reference) ←─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                            ^^^^ YOU ARE HERE ^^^^
```

## When to Use

- You need a quick reference for available commands and their syntax
- You want to see what's in the pipeline and what needs attention
- You're unsure what to do next in the workflow
- You want a recommendation based on current pipeline state
- After completing a batch of work, to check what's unblocked

## Input

`$ARGUMENTS` controls what to show:

| Argument | Behavior |
|----------|----------|
| *(none)* | Cheat sheet + status scan + recommendation |
| `status` | Pipeline status scan + recommendation (skips Section 1's cheat sheet) |
| `commands` | Quick reference cheat sheet only — read `reference-card.md` in this skill's directory and present its contents |
| `policy` | Policy configuration review — skips Section 1's cheat sheet and Section 2's status scan; read `policy.md` in this skill's directory and follow it (gather, render contract, apply path) — `policy.md` owns this run's `## Next Actions`; SKILL.md's own Next Actions block does not fire for `policy` |
| *spec number or topic* | Same as *(none)* — full cheat sheet + status scan + recommendation. No per-spec/topic filtering is implemented; none of the three sections' skip conditions below match a bare spec number or topic string. |
| `--budget <n>` | Caps rows rendered in the Ready-to-Build and Needs-Attention dashboard tables (default: 10). Combine with any other argument, e.g. `status --budget 5`. See `status-scan.md`'s Present Dashboard section for truncation and overflow-note behavior. |

> Default (no arg) is the cheat-sheet-first dashboard. The status scan (Section 2) is moderately expensive — when the user just wants command syntax, the `commands` arg avoids it.

---

## Section 1: Quick Reference Cheat Sheet

*(Skip if `$ARGUMENTS` = `status` or `policy`)*

For the canonical cheat sheet — lifecycle, component, and utility commands; common workflows; artifact lifecycle; bookend architecture summary — read `reference-card.md` in this skill's directory. **Rendering rule:** present the Lifecycle / Component / Utility command tables verbatim. Collapse the Common Workflows section to a list of workflow headings (e.g., "Feature from scratch", "Fast pipeline (spec ready)", "Brownfield onboarding" — see `reference-card.md`'s own Common Workflows section for the current, authoritative list) unless the user explicitly asked for "examples" or "workflows" in `$ARGUMENTS` — in that case, render the workflows verbatim too. Always keep the Artifact Lifecycle and Bookend Architecture summary verbatim. The reference card is the single source of truth for the command catalog; do not maintain a separate copy here.

---

## Section 2: Pipeline Status Scan

*(Skip if `$ARGUMENTS` = `commands` or `policy`)*

> **Parallel execution:** When both Section 1 and Section 2 run (default, no-argument invocation), issue Section 1's `reference-card.md` Read alongside dispatching Section 2's Stage Task agents below — a static Read and a live Task-agent dispatch are fully independent and should run concurrently rather than sequentially.

Read `status-scan.md` in this skill's directory for the full parallel-dispatch procedure (Stages 0-7 including sub-stages 4.5, 4.6, 4.7, and 4.8; execution model, dispatch contract, agent template, and dashboard rendering). Stages 1, 4.5, 4.6, 4.7, and 4.8 dispatch as Task agents; Stages 0, 2, 5, and 6 run as parallel tool calls in the main thread alongside them; Stage 7 runs last, after the others, because it reads their output. The orchestrator assembles the dashboard once everything has returned. Stage 0 renders the installed plugin version, read from `plugin.json` — the sole source of truth. Stage 4.8 is read-only reporting only (a per-class trust table) — it never feeds a recommendation.

---

## Section 3: Recommendation

*(Always included unless `$ARGUMENTS` = `commands` or `policy`)*

### Priority Order

1. **Current PR blocked** — the current branch's open PR has failing CI, `CHANGES_REQUESTED`, or unresolved review threads (Stage 4.5). PR feedback is the most perishable work in the system — reviewer context decays fastest and it blocks in-flight work from merging. Recommend fixing CI, addressing threads, or resuming `/claude-tweaks:build` before anything below.
2. **Specs awaiting review** — review completed work before it goes stale
3. **Specs awaiting wrap-up** — wrap up reviewed work (captures learnings while fresh)
4. **Records building** (`bot:in-progress`, Stage 1) — finish what's started before starting new work
5. **Unverified code changes** — the working tree is dirty or the branch is ahead of the default branch, and nothing above fired (no record in review or wrap-up state). Recommend `/claude-tweaks:test`. `/claude-tweaks:review` gates on `TEST_PASSED=true` and never runs verification itself, so unverified changes cannot progress; this is the one state where the next step is the mechanical gate rather than a lifecycle skill
6. **Design docs unspecified** — specify before building (don't let designs go stale)
7. **Parked records with met triggers** — promote via `/claude-tweaks:specify` before starting new work
8. **Records pending authorization** (`ready`, not yet granted, Stage 1) — recommend `/claude-tweaks:backlog refine` to review and grant `auto:build`
9. **Authorized records** (Stage 1) — recommend `/claude-tweaks:dispatch` (headless) or `/claude-tweaks:build #{n}` (direct) for the highest-priority one with met prerequisites
10. **Backlog review** — if the backlog is stale or has 10+ records, suggest `/claude-tweaks:tidy` before new brainstorming
11. **Brainstorming** — if the pipeline is empty, suggest `/superpowers:brainstorming` from a backlog record. Offer `/claude-tweaks:research verify` alongside when the record's own approach rests on assumptions worth grounding first (an external library, protocol, vendor, or standard) — `verify` mode's own documented lifecycle position is exactly here, before brainstorming, and this branch is the only point where `/help` already knows the pipeline is empty
12. **Nothing to do** — if everything is clean, say so

### Tie-Breaking

Row order in the Ready-to-Build table comes from the shared `bin/lib/issues/ranking.js`'s `rankNextToBuild` — the same module `/claude-tweaks:backlog overview`'s bare-mode recommendation uses, so both consumers compute the identical order (see `status-scan.md` Stage 1 for the actual call). Its tie-break sequence: unblocks-count (most other candidates in the pool it unblocks, first) → file-overlap-free (no shared key files with another candidate, first) → size (low first) → hasPlan (existing plan, first).

### Present Recommendation

Render the recommendation as the `## Next Actions` block below as plain markdown — `{recommended command}` renders first, bolded, with `(recommended)`, with 1-3 alternatives drawn from the priority order.

## Next Actions

Render as plain markdown (docs/skill-authoring.md's Skill handoffs convention), options dynamically drawn from the priority order above:

**`{the recommended command, fully qualified, with parameters}`** — {rationale} (recommended)
`{alternative command, fully qualified, with parameters}` — {rationale}
`{optional second alternative command, fully qualified, with parameters}` — {rationale}

## Component-Skill Contract

`/claude-tweaks:help` is a **standalone-only** dashboard skill — it is not invoked by any parent skill in the workflow. There is no `PIPELINE_RUN_DIR` signal, no parent context to defer to, and the `## Next Actions` block always renders. If a future parent skill ever invokes `/help` (e.g., a "show me the pipeline" dispatch), the parent must update this contract before that lands; until then, treat parent invocation as not applicable.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Running a full scan when user just needs command syntax | Wastes time — respect the `commands` argument |
| Recommending new work when specs await review | Finish in-progress work first — stale reviews lose context |
| Recommending new work while the current PR has unresolved feedback or failing checks | In-flight work rots fastest — reviewer context decays, merge conflicts accumulate; the pipeline picture needs PR state |
| Skipping the backlog scan | Stale backlog records create noise and slow the pipeline |
| Not checking for baked-in assumptions | Solution-oriented backlog records bypass the debiasing step |
| Triaging backlog records from /help instead of handing off to /tidy | /help is a read-only dashboard — deleting, promoting, absorbing, or deferring records means handing off to `/claude-tweaks:tidy`, never an ad-hoc walkthrough |
| Deriving a recommendation, grant, or "next step" from the Trust Table's verdicts | Stage 4.8 reports what evidence exists. The `autonomy` ceiling does have consumers now (`/claude-tweaks:capture`, `/claude-tweaks:backlog refine`), and this skill is deliberately not one of them — a dashboard reports, so nothing here may act on a `clean`/`mixed`/`insufficient-evidence` verdict |

For a detailed explanation of how context flows between skills via artifacts, read `context-flow.md` in this skill's directory.
