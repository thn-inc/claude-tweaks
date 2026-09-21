# CLAUDE.md — claude-tweaks plugin

## What this is

A Claude Code plugin containing markdown skill files that guide Claude through a structured development lifecycle, with browser automation, QA pipeline support, a statusline, and a subagent contract for parallel dispatch.

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Claude Code plugin system + Node 18+ (for the statusline) |
| Content | Markdown (SKILL.md files with YAML frontmatter); Node modules under `plugin/bin/` |
| Dependencies | Superpowers plugin (`/superpowers:brainstorming`, `/superpowers:writing-plans`, `/superpowers:subagent-driven-development`, `/superpowers:executing-plans`, `/superpowers:using-git-worktrees`, `/superpowers:finishing-a-development-branch`, `/superpowers:dispatching-parallel-agents`, `/superpowers:systematic-debugging`), code-simplifier plugin (`code-simplifier:code-simplifier` subagent), git CLI (optional — statusline git segment only), gh CLI (optional — default transport for `work-backend: github-issues`: work-record system, the four health-sweep skills' issue filing, /tidy and /help's PR/issue scans. Not required — a `gh`-absent env (typically cloud Routine sandbox) routes the same CRUD via `_shared/github-write-transport.md`'s MCP path, with `_shared/issue-claims.md`'s file-blob lock standing in for the ref-level one) |
| Test runner | `node --test` (built-in, no external deps; invoked via `npm test`) |
| Distribution | Plugin marketplace via `thomasholknielsen/claude-tweaks-marketplace` |

## Structure

**The plugin payload is the `plugin/` subtree — nothing else in this repo ships** (`docs/decisions/0015-*`): `tests/`, `docs/`, `evals/`, `perf/`, `tools/`, `scripts/`, and `work/` are maintainer-side, so where a new file goes decides whether users install it. Full directory tree, the per-skill sub-file table, and the command reference live in `docs/plugin-structure.md`. Orientation:

- `plugin/skills/{name}/SKILL.md` — skill definition; `plugin/skills/{name}/*.md` — sub-files lazy-loaded by that skill
- `plugin/skills/_shared/*.md` — cross-skill contracts, criteria, and canonical procedures cited by skills rather than restated
- `plugin/bin/` — Node executables; `plugin/bin/lib/{name}/` — multi-file modules as flat sibling directories, NOT a nested `_shared/` wrapper (that convention is specific to `plugin/skills/_shared/`)
- `plugin/hooks/hooks.json` + `plugin/bin/hooks.js` — one dispatcher for every hook event
- `tests/` — `node --test` suites; `evals/` — a separate Node project (own `package.json`/`node_modules`), not part of the plugin runtime

## Conventions

### Skill authoring — moved

SKILL.md structure, Interaction patterns (incl. the canonical CSC template), Frontmatter conventions, the Interaction style directive, and Parallel execution directives now live in `docs/skill-authoring.md`. Read it before creating or editing any `plugin/skills/**/*.md`.

### Versioning

- Version lives in `plugin/.claude-plugin/plugin.json`
- Bump minor version for feature additions, patch for fixes
- Commit message style: `{Verb} {what} — {detail}` (imperative, no conventional commit prefixes) — for hand-written commits; merge commits the plugin composes at merge time are Conventional-Commits shaped (`plugin/bin/compose-subject.js`, #2251)

### Releasing (two repos)

Invocation: `node plugin/bin/release.js <minor|patch> "<summary>"` from clean `main` — this repo's own path, never the consumer-facing `/claude-tweaks:release` + `bin/release-local.js` the plugin now ships (#2254/#2256), which tags and closes records on a repo whose versions are keyed off `docs/shipped-versions.tsv`; migrating this repo onto it is #2259. The whole-branch review gates the bump — run it before the version bump, not as a later task in the same plan. Full procedure, judgment calls, and the shipped-vs-never-shipped renumber split: `docs/releasing.md`.

### Cross-references

- Every relationship between skills is stated **once**, in `docs/skill-graph.md`. Adding or changing a skill means adding or updating its edges there. Do not restate an edge inside a `SKILL.md`: the bidirectional convention this replaces required each edge in two places, and the two copies drifted
- `/help`'s workflow diagrams must list all skills, and its artifact lifecycle diagram must stay in sync with `README.md`'s
- A skill reference inside actionable instruction text (a `## Step N` body, a `## Next Actions` block) MUST use the fully-qualified `/claude-tweaks:{skill}` form — the `Skill` tool requires it, and a bare `/{skill}` there fails with "Unknown skill" at invocation time. Bare short-form references (`/{skill}`) are reserved for descriptive prose and Relationship-to-Other-Skills tables, where they're never passed to a tool call.

### Hooks

All hook registrations route through `plugin/bin/hooks.js <event>` — one dispatcher, one module per event in `plugin/bin/lib/hooks/`. The full contract — tiered posture, run-dir resolution and ownership, the never-break-a-session invariant, and its consumers — is in `docs/hooks.md`. Read it before touching `plugin/bin/hooks.js`, `plugin/bin/lib/hooks/`, or `plugin/hooks/hooks.json`.

### Reconcile

Adding a new `plugin/bin/lib/reconcile/` convergence check touches multiple registration sites — the full procedure is in `docs/reconcile-checks.md`. Read it before touching `plugin/bin/lib/reconcile/` or `plugin/bin/hooks.js`'s `reconcile` command.

## Philosophy

- **Do it properly.** No display-only workarounds for data model issues, no "good enough" shortcuts that leave technical debt. If a value needs renaming, rename it everywhere including the database. If a type needs changing, change it at the source.
- **Assume zero cost.** Decide as if implementation is free. Never choose an inferior design because the better one "isn't worth the effort."
- **Assume zero time.** Decide as if implementation is instant. Never choose a shortcut because the proper approach "takes too long."
- **No implicit deferrals.** When something needs doing, either do it now, explicitly file a backlog work record via `/claude-tweaks:capture` — with a spec-shaped body (Current State / Deliverables / Acceptance Criteria) and a `Defer-reason:` from `_shared/deferral-gate.md` when an agent holds the context; a stub is for a human typing an idea — or, below the materiality floor, log it to the digest per `_shared/materiality-floor.md`. Never silently skip work or leave TODO comments without a corresponding backlog record or digest entry.

Established codebase distributed to real users via a versioned plugin marketplace. Contract changes (skill frontmatter shape, hook payloads, work-record schema, `_shared/*.md` conventions consumed by multiple skills) follow the same expand-contract discipline as a public API: add the new, migrate every consumer (including the installed build, which reads this repo's own committed config with older code), remove the old — never a silent breaking rename. A deprecated behavior gets a recorded removal condition (see the Don'ts rule on this), not an indefinite compatibility shim. Prefer stability over novelty in shipped skill contracts — adopt new conventions in new skills first, then migrate existing ones deliberately, with the incident log recording what each migration cost.

## Objectives

The plugin optimizes for the maintainer objectives `/feedback`'s session judge scores a session against — automation efficiency, context overhead, avoidable interactions, friction, developer joy, trust calibration, instruction efficacy, report fidelity, recovery quality; definitions, evidence, and class (`judgment`/`countable`) live in `plugin/skills/_shared/feedback-objectives.md`, the canonical rubric. **Decision:** `/reflect`'s lenses (Surprises, Approach, Near-misses, Fresh start, Friction) judge one build's approach and code, not session quality — a different purpose and a mostly-different vocabulary (only "Friction" overlaps). They keep their own names; revisit only if the two rubrics are deliberately merged.

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

## Commands

```bash
npm test                            # Full suite — tests/ (includes every tests/bin-lib/{module} suite) and tools/upstream-drift/tests/ — a recursive glob, not a fixed list; new tests/bin-lib/{x} directories are picked up automatically
npm run test:perf                   # Timing budgets (perf/) — deliberately excluded from npm test, see docs/plugin-structure.md
claude --plugin-dir ./plugin        # Local development — load the payload subtree from this checkout
```

Per-suite test invocations, the `plugin/bin/*.js` CLIs (the four health sweeps plus the standalone CLIs listed there), and the evals harness commands are in `docs/plugin-structure.md`.

A `npm test` failure count that varies run-to-run on byte-identical code tracks machine load (sibling agents/sessions running concurrently), not a regression — re-run only the affected file(s) in isolation (`node --test path/to/file.test.js`) before concluding anything is actually broken. That tolerance applies only to counts **you ran yourself**: never accept a subagent's self-reported pass/fail numbers as a run, and never reconcile a mismatch against them as flake — a fabricated report is indistinguishable from load here, so re-run centrally and require dispatched agents to quote raw command output rather than summarize it.

### Subagent Contract (v4.2+)

The contract is **dispatch correctness** discipline, not a token-saving measure: the clean room is what makes N agents independent evidence rather than N echoes, the status line stops a failed dispatch from aggregating as a clean result, and the templates keep aggregation mechanical rather than paraphrased. Costing less to run is a side effect, never the rationale.

Skills that dispatch parallel Task agents must reference `plugin/skills/_shared/subagent-output-contract.md` and follow its full contract: minimal **input** (scope + paths + literal output template — no conversation history), a **status line** (`DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED`) as the agent's first reply line, an **output template** (Template A/B/C) inlined verbatim in the dispatch prompt, and **model profile selection** (`Fast | Standard | Capable`; `Frontier` only at contract-enumerated singleton slots, never in a fan-out — resolved per the contract's Model Selection section) appropriate to the work. Agents only see what's in their prompt — references to sibling files don't reach them. Used by `/browse`, `/design-wrapper` (`review` mode Step 3.8 — craft critics), `/dispatch` (`build,test` then `review,polish,wrap-up`, two Task calls per file-overlap group, own GROUP/OUTCOME/MANIFEST template — none of A/B/C fit; status line + input discipline still apply, `plugin/skills/dispatch/SKILL.md` Step 5), `/docs-health` and `/harness-health` (parallel per-target READ+JUDGE dispatch under `--budget > 1`), `/help`, `/init`, `/research` (question×source pair fan-out, a define-in-prompt format inlined verbatim per the contract's "Not every consumer uses A/B/C" allowance — `plugin/skills/research/source-registry.md`'s Dispatch section), `/review`, `/simplify` (single-subagent dispatch to `code-simplifier:code-simplifier`), `/specify`, `/test` (qa-prompts), `/tidy`, `/visual-review`, and `/wrap-up` (Phase 2 ROUTE fan-out for 3+ open worklist rows). When adding a new dispatch site, follow the full pattern, not just the output template. **Third-party agents are exempt**, structurally: the agent's definition lives outside our own `plugin/agents/`, so it ships with someone else's plugin — anything under `plugin/agents/` is never exempt. The exemption covers the agent only; the caller still normalizes the foreign output at the boundary, checks availability at the *agent* level (plugin presence does not imply agent presence), and never reports unavailable / failed / empty / unparseable as a clean result. Full carve-out, and today's one such dispatch (`impeccable-finish-reviewer`, `plugin/skills/design-wrapper/modes/review.md` Step 3.7): the Exemption section of that `_shared` file.

### Auto-Mode Contract + Bookend Architecture (v4.6+)

claude-tweaks pipelines have at most two stops in `auto` mode: a **Pipeline Config Manifesto** at the start (one structured numbered-options block collecting all policy levers in a single message) and a **Wrap-Up Review Console** at the end (one batch table consolidating everything auto-decided or staged). The two-stop ceiling isn't a floor: in default `auto`, the Manifesto renders as a **read-only FYI** (displays levers, doesn't gate), so the everyday run has effectively **one** user-facing stop — the end Review Console. Pass `confirm` (or `hybrid`) to turn the Manifesto into a real approval gate. Everything in between is policy-driven automation logged to the auto-decision log.

**Single source of truth:** `plugin/skills/_shared/auto-mode-contract.md` — defines mode states, decision precedence (CLI arg > pipeline config > project policy > skill default), reversibility/confidence floors and a severity ceiling, the HARD-GATE exemption list, and what `auto` never silences (ledger resolve Phase 2, work-record creation — new backlog or parked records, governance gates) — except the narrow, explicit `autonomy` ceiling's bookkeeping capabilities (see `_shared/autonomy-ceiling.md`), which let floor-clearing ledger residue, queue writes, and ops-ack resolve without a click at `trusted`/`unattended`, and — at `unattended` only — let the Review Console's memory, queue-write, and upstream-filing approvals resolve with zero clicks under `consoleAutoResolve`.

**Audit trail:** `plugin/skills/_shared/auto-decision-log.md` — every auto-resolution writes a one-line entry to `.claude-tweaks/pipelines/{run-id}/decisions.md` per that file's canonical entry schema. The Review Console reads this log. Staged code-fix proposals follow `plugin/skills/_shared/staged-patch.md` — validated with `git apply --check` at staging time and re-derived from their `Invariant:` preamble at the console when the diff has gone stale.

**Strict rule:** skills MUST NOT invent new mid-flow stops in `auto` mode. If a decision is decision-worthy, stage it (log it, don't act) and surface at the Review Console. Mid-flow stops are reserved for HARD-GATEs (test failures, spec compliance, structural coupling, plan validation) and the explicit "not silenced" list in the contract.

**Per-pipeline run directory** (collision-safe across parallel agents): `$RUN_ROOT/.claude-tweaks/pipelines/{ISO-timestamp}-{spec-slug}/` holds the run's config, audit log, staged proposals, and the hook- and CLI-written run artifacts alongside them — do not restate the layout here; it grows every release (`preflight.json`, `timing.json`, `console.json` all landed in one run) and a copy in an always-loaded file goes stale unwatched. Resolve it — and `PIPELINE_RUN_DIR`, adoptable only once it resolves under `$RUN_ROOT` — per `plugin/skills/_shared/pipeline-run-dir.md`: `$RUN_ROOT` is the main checkout, never the cwd worktree, and a bare relative path silently shadows it `[IL-127]`. **Project policy** lives in `.claude-tweaks/policy.yml` — the only config home since 6.48.0 — read as defaults by the Manifesto, overridable per-run.

## Design integration

diagram-suggestions: enabled

## Cloud parity

Cloud sessions (claude.ai/code) and scheduled Routines run in fresh sandboxes with no access to this machine's local `~/.claude` config. Two things are required, and the declaration alone is not enough: this project's `.claude/settings.json#enabledPlugins` (paired with `extraKnownMarketplaces`) says what a sandbox may load, and the Setup script below is what actually installs it. The field is confirmed effective for interactive cloud sessions; it was measured not reaching scheduled Routine sandboxes (scope of affected sandbox types unknown) — the routine kernel's self-heal fallback (#260), not this field, is what guarantees a scheduled firing ends in a real result or a diagnosable failure `[IL-117]`.

- **Setup script (required, not optional):** paste the canonical Setup-script line (see `scripts/claude-cloud-setup.sh`'s header) into this project's cloud environment's Setup script field (claude.ai/code environment settings, web UI only — no API/CLI can set this remotely). Installs every declared plugin/marketplace. Regenerated by `/claude-tweaks:init` Step 14; don't hand-edit it. Without it, a declared plugin is simply absent. Confirmed for interactive cloud sessions; measured not reaching scheduled Routine sandboxes — see the paragraph above. This paste requirement applies per *environment*, not per repo — an environment selected in the session composer that has never had this pasted fails this way even for a fully-declared repo `[IL-113]`.
- **Branch:** cloud sessions check out the environment's configured branch (typically `main` here) — declarations only take effect once merged there. Scheduled Routines are pinned independently: each audits the branch it was given at creation.
- **First exposure:** if a skill is uninvocable in a cloud session, run `ls ~/.claude/plugins/` before waiting. Missing directory means nothing installed — the Setup script is absent or failed, and waiting won't fix it. Present and populated but still uninvocable is the transient case, observed once to clear a session later; re-check rather than assuming.
- **MCP servers:** this project has no committed `.mcp.json` — a cloud or Routine session's MCP servers (e.g. `github`, `Claude_Code_Remote`) come from the hosting environment/account configuration, not a repo file. Servers configured only in `~/.claude.json` don't reach cloud, and are never auto-copied (they can carry credentials).

## Work records

work-backend: github-issues
work-types: labels

## claude-tweaks Pipeline

**Artifacts:** design doc (one file, phases = `## Phase N` sections) → spec (one per work unit, via `/claude-tweaks:specify`) → `/claude-tweaks:flow`. No multi-phase plan files (`*-P1.md`, `*-P2.md`, …); a single plan per spec via `/superpowers:writing-plans`, stopped before its execution-choice offer, is expected and normal.

**Spec close-out:** `specs/` is a working directory, not a permanent historical index — once a spec ships and is verified, promote any durable reference content to `docs/reference/*.md` or a skill, repoint by-number citations elsewhere in the repo to the closing commit or PR, then delete the spec file. A permanent tracker file (e.g. `specs/INDEX.md`) is an anti-pattern here, not a convention to preserve.

**Entry point:** `/claude-tweaks:specify` — accepts a topic (calls `/superpowers:brainstorming`), design-doc path, or a backlog work-record ref.

**`/claude-tweaks:flow`:** specs only — it rejects design docs. Defaults to `auto` (hands-off); pass `confirm`, `interactive`, or `hybrid` to change that.

**Auto mode:** in default `auto`, the Pipeline Config Manifesto renders as a read-only FYI — it computes and displays the policy levers, then proceeds without stopping — so the only user-facing stop is the Wrap-Up Review Console at the end. Pass `confirm` (or `hybrid`) to turn the Manifesto into a real approval gate; the rest of the pipeline still runs as `auto` once approved.

**Integration model** (`plugin/skills/_shared/integration-model.md`): GitHub-backed projects default to `pr-first` — a worktree run is born public (draft PR at run start, every phase pushes, merge happens via `gh pr merge`); no-forge projects use `local-merge`, the permanent fallback. Never re-derive which one applies ad hoc — read the resolution, once, per that file.

**Superpowers overrides:** `/superpowers:brainstorming` stops after the design doc — route to `/claude-tweaks:specify`, never `/superpowers:writing-plans`; when policy key `specify-auto-continue` resolves `true` (default `false`), invoke `/claude-tweaks:specify` on the approved doc immediately instead — see `specify/SKILL.md`'s Auto-continue section. `/superpowers:subagent-driven-development` and `/superpowers:executing-plans` don't auto-invoke `/superpowers:finishing-a-development-branch`. Before any merge decision — `/superpowers:finishing-a-development-branch`'s prompt, or `_shared/pr-first-merge.md`'s `gh pr merge` path — for work whose acceptance depends on rendered UI behavior (`Surface:`/`surface:` web/mobile/desktop, or acceptance criteria naming visual/interactive behavior — the signal `frontend-detection.md`'s Layer 2/3, in the `/claude-tweaks:design-wrapper` skill's directory, defines and `/claude-tweaks:specify`'s/`/claude-tweaks:build`'s Next Actions table both reuse), run a real browser-based visual check first — `/claude-tweaks:review {N} full` or `/claude-tweaks:demo`'s Validate step — or have the user explicitly decline it; raw HTML inspection does not satisfy this, and a check that silently self-skipped (no browser backend, no dev server) is not a satisfied precondition — surface it as an explicit decline instead. Backend/infra work with no UI surface is not blocked; a non-web frontend surface (mobile/desktop) with no automated rendered-check channel is satisfied by an explicit decline too (#808).

## Don'ts

Rules only — each is a rule plus one clause of why. Where a rule carries an `[IL-nn]` tag, the full post-mortem behind it — which build it bit, how it was caught, what it cost — is in `docs/incident-log.md`. The full rule list now lives in `docs/donts.md` (moved out of this always-loaded file to fit the 150-line budget); read it before touching code covered by any tagged rule.
