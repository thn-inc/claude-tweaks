# claude-tweaks

A structured workflow system for Claude Code — from idea capture through build, review, and wrap-up.

## What this does

Claude Code is powerful but unstructured. claude-tweaks adds a complete development lifecycle: capture ideas, challenge assumptions, decompose into specs, build with quality gates, and learn from what was built. Every finding is explicitly resolved — nothing silently drops.

See [CHANGELOG.md](CHANGELOG.md) for release history.

## Installation

```
/plugin marketplace add thomasholknielsen/claude-tweaks-marketplace
/plugin install claude-tweaks@claude-tweaks-marketplace
/plugin install superpowers@claude-plugins-official
/claude-tweaks:init
```

## How it works

```
  SKILL                      ARTIFACT                 SUPERPOWERS USED
  ─────                      ────────                 ────────────────

  intake ─────────────►  Sorted fragments
     │
  capture ──────────────►  Backlog record
     │
     │                     Design Doc          ◄───  brainstorm
     │                     (specify can invoke brainstorm directly on topic input)
     │
  specify ──────────────►  Ready record(s)    (writes surface: + design-intent: + ui-stack: body metadata)
     │  calls: design shape (frontend only — appends Impeccable shape output to design doc)
     │  calls: visualize (diagram suggestion, all surfaces)
     │                     (deletes Design Doc)
     │
  ┈┈ /claude-tweaks:backlog refine grants, /claude-tweaks:dispatch selects+mints, /claude-tweaks:flow claims (utility skills, no fixed position) ┈┈
     │
  ┈┈ /claude-tweaks:flow automates below (worktree mode default) ┈┈
     │
  build ────────────────►  Code + Journeys    ◄───  subagent-driven-development
     │  calls: design pre-build (lazy-load Impeccable references)
     │         simplify,                             executing-plans
     │         journeys                              using-git-worktrees ⚙
     │           calls: visualize (diagram suggestion)
     ┊  (if UI changed)
  stories ──────────────►  Story YAML
     │
  test ─────────────────►  TEST_PASSED
     │  calls: design test (Impeccable detect — deterministic CLI gate)
     │
  review ───────────────►  Review Summary     ◄───  dispatching-parallel-agents
     │  calls: design review (Impeccable critique + audit — advisory)
     │         visualize (diagram gap finding — Lens 3i-diagram),
     │         reflect,
     │         simplify,
     │         visual-review (calls: design survey — Creative Opportunities)
     │
  polish ───────────────►  Polished Code      (frontend specs only)
     │  calls: design polish (refinement set + suggestion-driven + intent-driven)
     │         test skip-qa  (re-verify gate, 1-cycle cap)
     │
  flow summary ─────────►  Pipeline report    (Creative Opportunities block)
     │  calls: design survey (full diff; decline tracking)
     │
  wrap-up ──────────────►  Done               ◄───  finishing-a-dev-branch ⚙
     │  calls: reflect
     │         (full)
                           (deletes plans, ledger, design caches; legacy spec file
                            deleted too — a record-mode build's materialized file
                            stays on the branch as committed audit trail instead;
                            applies demo:pending + posts a Verification Brief on
                            the record — or, for a sub-issue of a /specify
                            decomposition, on the parent once the last
                            sub-issue closes; record mode only)
     │
  ┈┈ /claude-tweaks:demo resolves demo:pending → approved/changes-requested (utility skill, no fixed position — run anytime, resolves one item per ref: a specific #N, a #N,#M list one at a time, or this session's own unrecorded work via session-recall) ┈┈
     │
  ┈┈ /claude-tweaks:release cuts the release — recommended by wrap-up/flow's Next Actions when the preflight pack shows unreleased work (#680); on demand, suggested, or the release train (utility skill, no fixed position — run anytime) ┈┈
     │
  ┈┈ /claude-tweaks:routine fleet status aggregates routine health + weekly counters, fleet off pauses (utility skill, no fixed position — run anytime) ┈┈
```

> **Left column:** `/claude-tweaks:{name}` — **Right column:** `/superpowers:{name}` ([Superpowers plugin](https://github.com/obra/superpowers))
> **⚙** = worktree mode only — **┊** = conditional step
> `/claude-tweaks:init` runs once per project, before entering the pipeline.
> Under `integration-model: pr-first` (GitHub-backed projects), a worktree run is born public: `build`'s first phase opens a draft PR immediately, every later phase pushes and flips its own PR checklist row, and `wrap-up`'s Review Console renders as PR checkboxes instead of a blocking chat prompt. A background reconciler converges local state (fast-forward, worktree reap, claim release, run-dir archive, branch archival) at every shared-state read point, so no step depends on the session that started it still being alive. `local-merge` (no GitHub remote) keeps the diagram above unchanged.

## Work Records

Every unit of work — a captured idea, a health-skill finding, or a human-filed issue — is the same thing underneath: a **work record**, tracked through one spine regardless of who filed it:

```
BACKLOG ──/specify shapes──► READY ──human grants──► AUTHORIZED ──/flow claims──► BUILDING ──user merges──► CLOSED
```

- **backlog** — the default state: no stage label. `/claude-tweaks:capture` files here; health-skill records skip straight to `ready` instead (the born-ready rule — their output is spec-shaped by construction). Under `autonomy: trusted` or higher, once the `producer:capture` class has earned a `clean` trust verdict, a capture reaches `ready` at filing time too — by chaining into `/claude-tweaks:specify --chained` shaping, which stamps `ready` under its own authority — see `plugin/skills/_shared/autonomy-ceiling.md`.
- **ready** — spec-shaped and agent-sized. `/claude-tweaks:specify` gets a record here, either by shaping it in place or by decomposing a design doc into ready sub-issues (plus a parent record, when the decomposition's collapse decision keeps one).
- **authorized** — carries a human-granted `auto:build` (optionally `+ auto:merge`). `/claude-tweaks:backlog refine` is the interactive gate that grants this — machinery can only strip or downgrade a grant, never originate one. The `autonomy` ceiling defines one machine-origination exception at its `unattended` tier, gated behind a second, explicit opt-in (`grant-origination-enabled` in `policy.yml`, off by default): `/claude-tweaks:backlog refine`'s headless posture (a Routine or `/claude-tweaks:sweep` firing, or the deprecated `grant` alias), is the one path that reads both keys and acts on them, itself narrowed by a per-record gate chain (clean trust verdict, agent-filed origin, content-aware review, no floor trip).
- **building** — an agent holds the claim. `/claude-tweaks:dispatch` selects an authorized record's whole file-overlap group and mints its run directory; `/claude-tweaks:flow` claims the group at its own Step 2.8, whether dispatched or run directly.
- **closed** — completed via your own merge (close-via-merge — the pipeline never runs `gh issue close`), or not-planned (wontfix, duplicate, absorbed into another record).

A record can also **park** at any pre-authorized stage (on hold, with a wake trigger — a date or a watched file path) via `/claude-tweaks:tidy`'s Defer action, and can close as not-planned at any point.

Two storage drivers back the same taxonomy, set once by `/claude-tweaks:init` and read identically by every consumer skill:

| Driver | Where a record lives | Notes |
|---|---|---|
| `work-backend: github-issues` | A GitHub issue | Labels express stage/scoring/grants/bot-state; native GitHub Issue Types or `type:*` labels express Type. Headless dispatch (`/claude-tweaks:dispatch`) requires this driver — GitHub's RBAC is the mechanism the authorization model depends on. |
| `work-backend: local-files` | `specs/{id}-{slug}.md`, one file per record | Frontmatter expresses the same facets for isomorphism. `/claude-tweaks:backlog refine`'s grants are recorded but have no headless consumer — run `/claude-tweaks:flow`/`/claude-tweaks:build` manually against a chosen record instead. |

See `plugin/skills/_shared/work-record.md` for the full axis contract (Type, Origin, Scoring, Stage, Authorization, Bot state, Acceptance), the complete label taxonomy, and the permission matrix governing which skill may add or remove which label.

## Skills

claude-tweaks ships a full set of skills spanning the plan phase (capture, specify), the automated pipeline (build, test, review, wrap-up), standalone component skills (challenge, reflect, simplify, deepen, journeys, visual-review, visualize, assess-agent-autonomy, feedback), and utility skills (flow, help, tidy, demo, code-health, backlog, dispatch, sweep, and more). Each is invoked as `/claude-tweaks:{name}` and most work both standalone and as part of the automated `/claude-tweaks:flow` pipeline.

See [docs/getting-started.md](docs/getting-started.md) for the full skill reference,
[docs/plugin-structure.md](docs/plugin-structure.md) for the directory layout, per-skill sub-file
table, and command reference, and [docs/incident-log.md](docs/incident-log.md) for the post-mortems
behind CLAUDE.md's `## Don'ts` rules.

## Common workflows

```
# New repo — bootstrap and start capturing ideas
/claude-tweaks:init
/claude-tweaks:help                    # verify setup, see what's next
/claude-tweaks:capture "first feature idea"

# Full pipeline — idea to clean slate
/claude-tweaks:capture "users need meal planning"
/claude-tweaks:challenge --lens=1 meal planning  # optional: human debiasing lens before brainstorming
/superpowers:brainstorming
/claude-tweaks:specify meal planning
/claude-tweaks:flow 73

# Fast — spec already exists
/claude-tweaks:flow 42

# Resume from a specific step
/claude-tweaks:flow 42 review

# Parallel specs in separate terminals (worktree mode)
/claude-tweaks:flow 42 worktree       # Terminal 1
/claude-tweaks:flow 45 worktree       # Terminal 2
/claude-tweaks:flow 48 worktree       # Terminal 3

# Check pipeline status (navigation hub)
/claude-tweaks:help                    # what's ready, what's blocked, what's next

# Visual QA
/claude-tweaks:review 42 full
/claude-tweaks:visual-review journey:checkout-flow
/claude-tweaks:visual-review discover
```

## Dependencies

| Plugin / Tool | Source | Required |
|---------------|--------|----------|
| [Superpowers](https://github.com/obra/superpowers) | `/plugin install superpowers@claude-plugins-official` | Yes — brainstorming, planning, subagent execution, worktree management, systematic debugging |
| agent-browser | `npm install -g agent-browser` | Optional — browser automation for /stories, /visual-review, /review qa |
| Node 18+ | brew/winget/scoop install nodejs | Yes — statusline. `/claude-tweaks:init` Step 8 offers to install via your package manager. |
| git CLI | brew/winget/apt install git | Optional — required only for the git segment in the statusline; everything else degrades gracefully. |
| `gh` CLI | `brew/winget/apt install gh`, then `gh auth login` | Yes, for most `work-backend: github-issues` write paths — required, unauthenticated is a hard gate. `/dispatch`'s whole queue/claim/settle/merge path is dual-transport, falling back to GitHub MCP tools automatically when `gh` isn't on PATH — see `_shared/github-write-transport.md` — but `gh` is still required for every other GitHub-write path in the plugin. |

## Configuration

### Worktree base ref (important for worktree mode)

claude-tweaks branches each worktree from your **current local HEAD** — the branch you ran `/build` or `/flow` on, including any merged specs or in-progress integration commits. The native `EnterWorktree` tool has no base-ref parameter, so the base is decided by the harness setting `worktree.baseRef`:

```json
// settings.json
{ "worktree": { "baseRef": "head" } }
```

The harness **default is `fresh`**, which branches from `origin/<default-branch>`. On a project whose integration branch is local and ahead of the remote default (e.g. a long-lived `dev`), `fresh` silently branches from a **stale** commit, and your work lands on the wrong base. Set `baseRef: "head"`. As a safety net, `/build` Common Step 1 verifies the worktree's actual base immediately after creation and stops if it doesn't match your HEAD.

### Worktree sessions and `claude --resume`

Because `worktree-always` forces nearly every session to enter a worktree on its first edit, this is worth knowing up front: entering a worktree mid-session (via `EnterWorktree`, or `Agent` with `isolation: "worktree"`) pivots that session's own storage into a project bucket keyed by the worktree's path, not the parent project's. `claude --resume` run from the parent project directory no longer lists it.

This is a known, accepted limitation in Claude Code itself — not something claude-tweaks controls or can work around. Anthropic has closed it as duplicate/not-planned: [#30906](https://github.com/anthropics/claude-code/issues/30906) ("Worktree cwd is not restored on session resume"), [#42596](https://github.com/anthropics/claude-code/issues/42596) ("Worktree sessions are transient and cannot be resumed"), [#48835](https://github.com/anthropics/claude-code/issues/48835) (silent `--resume` failure). Related open feature requests: #28019, #58591, #61366.

If you need to resume a session after it entered a worktree, `cd` into the worktree directory first and resume from there, or look for it under that worktree's own encoded project bucket. If resumability matters more than in-session automation for a given task, create the worktree manually (`git worktree add`, then `cd` in and launch `claude`) instead of letting a skill enter one for you mid-session.

## Local development

```bash
claude --plugin-dir ./
```

## License

MIT
