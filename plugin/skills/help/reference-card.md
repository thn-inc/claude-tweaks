# Skill Reference Card

Quick reference for all claude-tweaks skills. For full details, run `/claude-tweaks:help commands`.

## Lifecycle (run in order)

| Command | What it does | Takes |
|---------|-------------|-------|
| `/claude-tweaks:init` | Bootstrap structure, generate CLAUDE.md, skills, rules | `[<path>\|<github-url>\|<description>\|--update\|update\|--full\|--core-only\|bootstrap\|config\|skills\|journeys\|docs\|github-remote\|issue-form\|design-integration\|diagram-suggestions\|shadcn-integration\|cloud-parity\|routines\|branch-tracking\|work-backend\|autonomy\|emil-skills\|integration-model]` |
| `/claude-tweaks:intake` | Sort a mixed braindump onto this repo's shelves — file / absorb / upstream / remember / drop, one table | `[<dump text>] [--file <path>]` |
| `/claude-tweaks:capture` | Brain-dump idea into the backlog | `<idea text> [--route=brainstorm\|keep\|absorb:N] [--title="..."] [--type=bug\|feature\|task] [--needs-definition\|--no-needs-definition] [--batch <path>]` |
| `/superpowers:brainstorming` | Brainstorm solutions (Superpowers plugin) | topic |
| `/claude-tweaks:specify` | Shape a work record to spec-shape, or decompose a design doc into ready sub-issue records | `[#N[,#M...]\|#A-#B\|record-id[,id...]\|design-doc-path\|topic\|backlog-title] [--budget <n\|all>] [--priority high\|medium\|low] [phase-N] [--surface <web\|mobile\|desktop\|backend\|infra\|terminal>] [--granularity <fine\|standard\|coarse>] [--chained] [--source sweep]` |
| `/claude-tweaks:build` | Implement a work record, spec, or design doc | `[#<n>\|<design-doc-path>\|<topic>] [subagent\|batched] [auto] [worktree\|current-branch] [profile=<fast\|standard\|capable\|frontier>] [ops=confirm]` |
| `/claude-tweaks:stories` | Generate or update QA story YAML files (journey-aware) | `[<url>] [persona=<name>] [dir=<path>] [focus=<area>] [pages=<n>] [refine=false] [negative=false] [journey=<name>]` |
| `/claude-tweaks:test` | Verification gate — types, lint, tests, QA stories | `[types\|lint\|unit\|integration\|e2e\|affected\|qa\|all\|skip-qa\|<path>] [tag=<tag>] [story=<name>] [retry=<path>] [journey=<name>] [dir=<path>] [priority=<level>] [max_parallel=N] [timeout=<ms>] [headless]` |
| `/claude-tweaks:review` | Analytical quality gate: code review, UX analysis (when QA data available), visual + creative ideas (default in `/claude-tweaks:flow`). Gates on `/claude-tweaks:test`. | `[<spec-number>\|<file-path>...\|base:<ref>\|visual <url-or-description>\|journey:<name>\|discover] [full] [low\|medium\|high\|xhigh\|max]` |
| `/claude-tweaks:wrap-up` | Reflect, capture learnings, clean up | `[#N\|<spec>\|<context>\|resume] [--dry-run] [--skill-budget <n>] [--doc-budget <n>] [cleanup-only]` |
| `/claude-tweaks:release` | Drive a release — preflight pack, pre-bump whole-branch review, one console, release-please merge or the local engine, verify, bookkeeping; `--train` for the unattended tier | `[--dry-run] [--train] [--as <version>] [--allow-blocking]` |

## Component (standalone or called by lifecycle skills)

| Command | What it does | Takes |
|---------|-------------|-------|
| `/claude-tweaks:challenge` | Framing verdict for `/specify` (component mode), or a named debiasing lens on demand (human-invoked); bare `#N` = evidence-or-accept-risk call on a `solution:unjustified` record | `framing-check [#<n>] \| #<n> \| --lens=<n[,n...]> <#n\|topic\|problem statement>` |
| `/claude-tweaks:reflect` | Structured evaluation: hindsight, surprises, near-misses | `[hindsight\|full\|light] [<spec-number>\|<file-path>...]` |
| `/claude-tweaks:simplify` | Code simplification via code-simplifier subagent | `[<file-or-dir>...\|#N\|<spec-number>]` |
| `/claude-tweaks:deepen` | Architectural depth pass — finds shallow modules, proposes deepening/collapsing ranked by leverage | `[<file-or-dir>...\|<spec-number>] [--kind deepen\|collapse]` |
| `/claude-tweaks:journeys` | Create/update user journey documentation | `[<spec-number>\|<file-path>...\|--journey <name>]` |
| `/claude-tweaks:visual-review` | Browser-based UI inspection, journey walks, discovery | `[<url>\|journey:<name>\|discover [--budget <n>]\|--mode=recommendation] [--source <parent-skill>]` |
| `/claude-tweaks:design-wrapper` | Wrapper that lets lifecycle skills invoke Impeccable design-quality commands. Modes: `pre-build`, `test`, `review`, `shape`, `polish`, `survey`, `doctor`, `reset-recommendations`, `live`, `explore`. `review` mode's project-local craft-critic dispatch (Step 3.8) is governed by the `design-critique` policy key (`off\|auto\|full`). | `<shape\|pre-build\|test\|review\|polish\|survey\|doctor\|reset-recommendations\|live\|explore> [target] [<surface-topic>] [--screenshots <paths>] [--source <parent-skill>] [--description <text>] [--dry-run] [--limit <n>] [--scope <identity\|layout>]` |
| `/claude-tweaks:visualize` | Themed diagram generation — architecture, flowchart, sequence, state, ER, timeline, swimlane, quadrant, nested, tree, org chart, layers, venn, pyramid, or a live diagram of this project's own open work-record queue | `<architecture\|flowchart\|sequence\|state\|er\|timeline\|swimlane\|quadrant\|nested\|tree\|org-chart\|layers\|venn\|pyramid\|record-graph> [topic] [--source <caller>] [--ephemeral]` |
| `/claude-tweaks:assess-agent-autonomy` | Inline judgment helper — grant-check informs `/claude-tweaks:backlog refine`'s recommendation, merge-check replaces dispatch's blast-radius gate, failure-check replaces dispatch's blanket failure-revocation rule, ceremony-check informs specify's per-record ceremony depth (flow falls back to it only for records that never went through specify). Never invoked directly by a human. | `<grant-check\|merge-check\|failure-check\|ceremony-check> [#{n}] [--base <ref>]` |
| `/claude-tweaks:feedback` | Route a learning upstream to the claude-tweaks plugin — defect or gap. | `[<learning text>] [--kind=defect\|gap] [--dry-run] [--queue] [--full] [--pre-confirmed]` |

## Utility

| Command | What it does | Takes |
|---------|-------------|-------|
| `/claude-tweaks:help` | Dashboard: commands + status (incl. current PR, installed plugin version) + recommendations | `[status\|commands\|policy\|<topic>] [--budget <n>]` |
| `/claude-tweaks:help policy` | Grouped policy-config review with audit issues, notable defaults, and validated apply | `[status\|commands\|policy\|<topic>] [--budget <n>]` |
| `/claude-tweaks:tidy` | Batch backlog hygiene (incl. GitHub PRs + code-health/harness-health/journey-health/docs-health issues) | `[--scope=<name>[,<name>...]] [--dry-run] [--approve [run-dir]] [--source sweep]` |
| `/claude-tweaks:flow` | Automated pipeline: build → [stories →] test → review → polish → wrap-up (+ end-of-run depth survey); pure executor — never selects records itself | `#N[,#M...] [worktree\|current-branch] [no-stories] [no-polish] [no-deepen] [no-creative] [auto\|interactive\|hybrid\|confirm] [keep-going] [cleanup-only] [step1,step2,step3]` |
| `/claude-tweaks:backlog` | Three modes over the open backlog: `refine` ensures every record has the right priority/Related/grant labels (a write sweep) and, given `#N[,#M...]`, resolves exactly those records' own decision comments/`bot:blocked` state — human-present by default, or headless via `--source routine\|sweep`, which additionally runs the machine-grant chain behind the `unattended` autonomy ceiling (`github-issues` only, off by default; `grant` is a deprecated mode-word alias that forces this headless posture); `overview` renders a distribution picture and recommends what to build next (read-only); `attention` is a read-only, ranked list of every open `needs:*`/`solution:unjustified`/`bot:blocked` record plus every ungranted `shaped:headless` spec, with a merge-lane breaker banner and staged-tidy-proposals pointer (`github-issues` only). | `[refine\|overview\|attention] [#N[,#M...]] [critical\|risk-value\|cleanup\|trust] [--budget <n>] [--origin <origin>] [--source <human\|routine\|sweep>] [--reset-breaker]` |
| `/claude-tweaks:dispatch` | The queue consumer — selects an authorized record's whole file-overlap group, mints its run directory, and hands it to `/flow` (which claims it via an atomic blob lock at its Step 2.8); settles on success/failure | `[#N[,#M...]] [--budget <n\|all>] [--priority high\|medium\|low]` |
| `/claude-tweaks:browse` | Unified browser automation (utility) | `[<url>\|<task description>] [--session <name> ...] [set viewport <wxh>\|set device \"<name>\"] [backend=chrome ...] [--quick]` |
| `/claude-tweaks:ledger` | Open items tracking — query, resolve ledger entries | `[resolve [<feature-name>]\|<feature-name>]` |
| `/claude-tweaks:research` | Deep web research with citation-audited reports — 4 runtime modes from quick to ultradeep. `verify` mode grounds a design's assumptions before `/superpowers:brainstorming`; the bare-topic form stays a no-fixed-position utility. | `verify [brief-path\|#N] \| <topic> [--mode=quick\|standard\|deep\|ultradeep] [--engine=auto\|inline] [--output=<path>]` |
| `/claude-tweaks:code-health` | LLM-as-judge recurring sweep — applies criteria holistically to a directory slice, deduplicates against open GitHub issues, files pre-specs as GitHub issues. Scheduled Routine. Never edits code. | `[--area <path>] [focus=<vertical>] [--budget <n>] [--min-risk low\|medium\|high] [--dry-run] [--root <dir>]` |
| `/claude-tweaks:routine` | Instantiate a skill's routine template (e.g. code-health's) into a live cloud Routine via `RemoteTrigger` — template-driven, resolves project/account values with minimal prompts. `fleet on\|status\|off` provisions/aggregates/pauses the whole self-maintaining fleet in one action instead of one skill at a time | `<create\|update\|status\|pause\|resume\|webhook-trigger> <skill>\|--all\|<fleet on\|status\|off> [--dry-run] [--defaults] [--branch <name>] [--environment <id>] [--refresh-environment] [--events <e1,e2,...>] [--filter <field>=<op>:<value>[,...]]` |
| `/claude-tweaks:harness-health` | Recurring health check auditing `.claude/skills/*.md`, `.claude/rules/*.md`, and CLAUDE.md for drift, template-conformance, and best-practice gaps, sharing its judgment procedure with `/init`/`/wrap-up`. Scheduled Routine. Never edits anything — always files a GitHub issue. | `[--target <id>] [--kind skill\|rule\|claude-md\|design-artifact\|memory] [--memory-dir <path>] [--budget <n>] [--min-confidence low\|med\|high] [--force-gap-scan] [--dry-run] [--root <dir>]` |
| `/claude-tweaks:journey-health` | Recurring health check auditing `docs/journeys/*.md` for drift and journey-story coverage gaps (light tier); an interactive-only deep tier actually runs a journey's QA stories or walks it live. Scheduled Routine (light tier only). Never edits anything — always files a GitHub issue. | `[--target <journey-name>] [--budget <n>] [--deep] [--dry-run] [--root <dir>] [--min-confidence <low\|med\|high>]` |
| `/claude-tweaks:docs-health` | Recurring health check auditing `docs/**` for Diátaxis genre-drift, depth-mismatch, findability, and factual staleness, with dual-persona misleading-risk tagging. Scheduled Routine. Never edits anything — always files a GitHub issue. | `[--target <id>] [--dir <path>] [--budget <n>] [--min-confidence low\|med\|high] [--dry-run] [--root <dir>]` |
| `/claude-tweaks:demo` | Resolves one built thing per ref — this session's own unrecorded work (bare), a specific `#N` record, or a `#N,#M` list taken one item at a time — briefs you on it and captures a human verdict, approve or request changes; discovery of what's outstanding is `/claude-tweaks:help`'s job | `[#N[,#M...]]` |
| `/claude-tweaks:routine-kickoff` | Machine-invoked by routine kernels (firing-lifecycle wrapper); not for direct human use | `<skill> [args...]` |
| `/claude-tweaks:sweep` | One hands-off hygiene pass — tidy (auto) → specify drain → backlog refine headless under one run dir, closing with attention's render; never claims, builds, or merges | `[--budget <n\|all>] [--scope <name>[,<name>...]]` |
| `/claude-tweaks:pipeline-smoke-test` | Cross-session integration test of capture → specify → backlog → dispatch against live git/gh state via genuinely separate `claude` processes, including a deliberate claim-race exercise; never reaches `/build`, cleans up and verifies artifact absence. Human-invoked only — never part of an unattended run. | `[stop-before-build] [cleanup-only]` |

## Recommended Companion Tools

External tools claude-tweaks integrates with — Claude Code plugins and standalone CLIs alike. `/claude-tweaks:init`'s Optional Enhancement steps offer to install these, most of them also writing a flag to CLAUDE.md (Step 9's `gh` CLI install is the one exception — no flag, since a git remote's existence is already observable at runtime).

| Tool | What it adds | Set up by |
|--------|-------------|-----------|
| [`pbakaus/impeccable`](https://github.com/pbakaus/impeccable) | Frontend design-quality LLM commands + deterministic CLI. Wired into `/test`, `/review`, `/build`, `/specify`, `/flow`, `/visual-review` via `/claude-tweaks:design-wrapper`. Frontend projects only. | `/init` Step 11 (writes `design-integration:` flag, read downstream) |
| [`shadcn/ui`](https://ui.shadcn.com/) | CLI-driven component system + its own official MCP server and Skill for AI-agent context. Frontend projects only. | `/init` Step 13 (writes `shadcn-integration:` flag — currently write-only, not yet read downstream) |

## Common Workflows

### Feature from scratch
```
/claude-tweaks:capture "users need meal planning"
/claude-tweaks:challenge --lens=1 meal planning       → optional: human debiasing lens before brainstorming
/superpowers:brainstorming
/claude-tweaks:specify meal planning
/claude-tweaks:build 73
/claude-tweaks:review 73
/claude-tweaks:wrap-up 73
```

### Fast pipeline (spec ready)
```
/claude-tweaks:flow 42
/claude-tweaks:flow 42 review              → resume from review onward
```

### Visual QA after build
```
/claude-tweaks:review 42 full
```
or standalone:
```
/claude-tweaks:visual-review journey:checkout-flow
```

### Verify before commit
```
/claude-tweaks:test
```

### Parallel specs (separate terminals with worktree)
```
# Terminal 1                                # Terminal 2                                # Terminal 3
/claude-tweaks:flow 42 worktree             /claude-tweaks:flow 45 worktree             /claude-tweaks:flow 48 worktree
```

### Sequential multi-spec
```
/claude-tweaks:flow 42,45,48
```

### QA pipeline (automatic in /claude-tweaks:flow)
```
/claude-tweaks:flow 42                                → stories auto-generated if UI changed (journey-aware), validated in test step
/claude-tweaks:stories                                → auto-detects dev server, ingests journeys, generates stories
/claude-tweaks:stories journey=checkout               → generate/update stories scoped to the checkout journey
/claude-tweaks:test qa                                → validate stories standalone
/claude-tweaks:test qa journey=profile-settings       → validate only stories for the profile-settings journey
/claude-tweaks:test all                               → full suite + QA stories
```

### Brownfield onboarding
```
/claude-tweaks:init
/claude-tweaks:visual-review discover
/claude-tweaks:routine fleet status                   → what did my codebase do to itself this week
```

## Artifact Lifecycle

```
Backlog record → Design Doc → Ready record(s) → Code → Stories → TEST_PASSED → Review → Polish (frontend) → Done
```

| Skill | Creates | Deletes |
|-------|---------|---------|
| `/claude-tweaks:capture` | Backlog record | — |
| `/claude-tweaks:challenge` | — | — |
| `/superpowers:brainstorming` | Design Doc | — |
| `/claude-tweaks:specify` | Ready record(s) — shapes an existing record in place, or creates ready sub-issues (plus a parent when kept) | Design Doc |
| `/claude-tweaks:build` | Code (+ Journeys via /journeys) | — |
| `/claude-tweaks:journeys` | Journey files | — |
| `/claude-tweaks:stories` | Story YAML files | — |
| `/claude-tweaks:test` | TEST_PASSED flag | — |
| `/claude-tweaks:review` | Review summary | — |
| `/claude-tweaks:wrap-up` | Learnings (CLAUDE.md), Verification Brief | Spec, plans, ledger |
| `/claude-tweaks:demo` | Follow-up record (on changes-requested) | — |

Consumed artifacts are deleted — specs and code are the durable outputs.

Under `integration-model: pr-first` (`_shared/integration-model.md`, GitHub-backed projects), a worktree run is born public: `/build`'s first phase opens a draft PR immediately, every later phase pushes and flips its own PR checklist row, and `/wrap-up`'s Review Console renders as PR checkboxes instead of a blocking chat prompt. A background reconciler converges local state (fast-forward, worktree reap, claim release, run-dir archive, branch archival) at every shared-state read point, so no step depends on the session that started it still being alive. `local-merge` (no GitHub remote) keeps the artifact flow above unchanged.

## Bookend Architecture (v4.6+)

`/flow` defaults to `auto` mode (hands-off). In `auto` the pipeline has **one user-facing stop** — the end-of-run Review Console — and everything else is logged automation. The Config Manifesto runs as a read-only FYI at the start unless you pass `confirm` (which turns it back into an approval gate):

| Stop | Where | What |
|---|---|---|
| **Pipeline Config Manifesto** | `/flow` Step 3 | Computes every policy lever (Mode, scope-creep, overlap, design-intent, leftover-default, auto-fix-threshold, review-auto-apply-ceiling, tidy-aggressiveness, ceremony-profile, model-stance, merge-verification, design-critique, merge-authorization) and writes `config.yml`. **In default `auto` it displays as an FYI and proceeds — no stop.** Pass `/flow … confirm` to get the "Approve all / Override / Cancel" gate; `interactive` skips it for per-skill in-flow prompts. |
| **Wrap-Up Review Console** | `/wrap-up` Phase 4 | One consolidated batch: auto-applied items + pending-review items + skill updates + config changes. Hit "1. Approve all" or override. |

**Mid-flow:** skills look up policy from `.claude-tweaks/pipelines/{run-id}/config.yml` — read via `bin/resolve-policy.js`, `_shared/policy-schema.md`'s Canonical read path — and log every auto-decision to `decisions.md`. Skills MUST NOT invent new mid-flow stops in auto.

**Per-pipeline run directory** (collision-safe across parallel agents):
```
.claude-tweaks/pipelines/{ISO-timestamp}-{spec-slug}/
├── config.yml        ← Manifesto answers
├── decisions.md      ← Auto-decision log (AUTO / STAGED / KEPT-PROMPT)
└── staged/           ← Patches awaiting Review Console
```

**Project policy defaults** (set in `.claude-tweaks/policy.yml`, not CLAUDE.md) pre-fill the Manifesto so the user can hit "Approve all" with zero overrides on a properly-configured project.

**Doctrine preserved (see `_shared/auto-mode-contract.md` for exact handling):**
- Ledger resolve gate Phase 2 (open items) — still per-item user input, even in auto
- Work-record creation (new backlog or parked records) — tiered: folded into the Review Console's batch "Approve all" at `supervised`/`trusted`, auto-resolved with zero `AskUserQuestion` calls under `consoleAutoResolve` at `unattended`
- `/init` Phase 4 / 9 governance gates (per `init/SKILL.md`'s own auto-mode text: Phase 4 skill-manifest selection and Phase 9 final confirmation are never silenceable; all other phases run without pausing)
- All HARD-GATE / BLOCKED / STOP conditions

Reference: `skills/_shared/auto-mode-contract.md` + `skills/_shared/auto-decision-log.md`.

