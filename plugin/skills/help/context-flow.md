# Context Flow Between Skills

How data and context pass between skills in the workflow lifecycle.

## The Mechanism: Durable Artifacts

Skills communicate through **files on disk** — not through session state, environment variables, or in-memory data. Each skill reads artifacts produced by upstream skills and writes artifacts consumed by downstream skills.

This design means:
- **Context survives across sessions** — you can run `/capture` today and `/specify` tomorrow
- **Context is inspectable** — artifacts are markdown files you can read and edit
- **Context is explicit** — if a skill needs input, it reads a specific file

## Artifact Flow

```
Codebase                     ──→ Findings cache               ──→ Work record (durable)             ──→ Backlog grants       ──→ Dispatch claims + builds
.claude-tweaks/code-health/      .claude-tweaks/code-health/      Confident: GitHub issue/local record   /claude-tweaks:backlog   /claude-tweaks:dispatch
  /code-health                   cache.json (local) +               (label: by:code-health, born ready)  (auto:build/            → /claude-tweaks:flow #{n}
                                  health-state branch              Low-confidence: backlog record          auto:merge)
                                  cursors/runs.json (durable)        via /capture instead
      ▲
      └────────────── /claude-tweaks:routine fleet status ──── read-only aggregation across this whole row: routine schedule/health,
                                                               tracker labels/comments, weekly counters (firings, findings, grants, merges)
```

```
Backlog record         ──→ Design Doc          ──→ Ready record(s)    ──→ Code + Journey
GitHub issue/local file    docs/superpowers/specs/*-design.md  GitHub issue/local file   src/ + docs/journeys/
  intake ──► sorted fragments
  /capture               /superpowers:brainstorming            /specify              /build
                                                 ↓                     ↓
                                           (deletes design doc)     Blocked items → new
                                                                    backlog record (/capture)
```

Between shaping and build, two utility skills act on the record with no fixed lifecycle position of their own — `/claude-tweaks:backlog` (`refine` mode grants `auto:build`/`auto:merge`) and `/claude-tweaks:dispatch` (selects the authorized record's file-overlap group and hands it to `/claude-tweaks:flow`, which claims it at Step 2.8). See the Work Records section of `README.md` and `_shared/work-record.md` for the full grant/claim contract.

```
Code + Journey ──→ Story YAML     ──→ Test (mechanical gate)  ──→ Review (analytical)       ──→ Learnings Routed    ──→ Clean Slate
src/ + journeys    stories/*.yaml     types + lint + tests + QA     code + visual + coverage       CLAUDE.md updates       (spec + plans + ledger deleted)
  /build             /stories           /test                         /review                         /wrap-up
             (auto in /flow          Sets TEST_PASSED=true      Gates on TEST_PASSED            ↕                       ↑
              when UI changed;       (QA when stories exist)    Journey-story coverage       Open Items Ledger
              ingests journeys       journey={name} filter      (browser review)             (tracks findings across phases)
              for story design)
```

## What Each Skill Reads and Writes

Where a row below reads or writes `specs/NN-*.md`, that means a work record materialized into `{run-dir}/work/{n}-spec.md` (see `flow/materialize.md`).

| Skill | Reads | Writes | Deletes |
|-------|-------|--------|---------|
| `/code-health` | Codebase files (via LLM judge + optional tool assists), `.claude-tweaks/code-health/cache.json` (prior findings), `health-state` branch `code-health/cursors.json` (per-area sweep state, see `_shared/health-state.md`), `--issues <file>` (open issue index from `gh issue list`) | `.claude-tweaks/code-health/cache.json` (fingerprint + status, local-only), `health-state` branch `code-health/cursors.json` (per-area `lastHash` + `lastSweptMs`) and `code-health/runs.json` (run history for churn tracking, capped at 90 records) — both durable, see `_shared/health-state.md`, a work record (GitHub issue via `gh issue create`, or local `specs/{id}-{slug}.md`) born `ready` (durable sink) | — |
| `/harness-health` | `.claude/skills/*.md`, `.claude/rules/*.md`, CLAUDE.md, `health-state` branch `harness-health/cursors.json` | A work record (`by:harness-health` label, or local file), `health-state` branch rotation cursor | — |
| `/journey-health` | `docs/journeys/*.md`, journey-story coverage data, `health-state` branch `journey-health/cursors.json` | A work record (`by:journey-health` label, or local file), `health-state` branch rotation cursor | — |
| `/docs-health` | `docs/**`, `health-state` branch `docs-health/cursors.json` | A work record (`by:docs-health` label, or local file), `health-state` branch rotation cursor | — |
| `/init` | `~/.claude/plugins/`, entire codebase, CLAUDE.md, config files, git state | `specs/`, `docs/plans/`, `docs/journeys/`, CLAUDE.md (incl. `work-backend` under `## Work records`), `.claude/skills/*.md`, `.claude/rules/`, `docs/journeys/*.md` | — |
| `/intake` | A pasted dump or `--file` | Nothing of its own — delegates filings to `/capture`, upstream learnings to `/feedback`, memory writes to learning-routing D4; returns a report with a Carry-over block | — |
| `/capture` | — | A backlog work record — GitHub issue (`by:capture` label, no stage label) or local `specs/{id}-{slug}.md` file, per `work-backend` | — |
| `/superpowers:brainstorming` | A backlog work record (GitHub issue or local file, per `work-backend`) | `docs/superpowers/specs/*-design.md` | — |
| `/challenge` | `framing-check` mode: a work record reference, called inline by `/specify` (no separate fetch). Human-invoked `--lens=` mode: a topic or problem statement. Human-invoked bare `#N` mode: a `solution:unjustified` record reference | `framing-check` mode: `solution:unjustified` label + `## Gotchas` note, applied by `/specify`. `--lens=` mode: a rendered debiasing critique (not persisted). Bare `#N` mode: writes back to the record — evidence or acceptance bullets under `## Gotchas`, plus the label clear | — |
| `/specify` | Shaping mode: a work record reference (`/claude-tweaks:challenge`'s `framing-check` mode runs inline, no separate fetch; a `needs:definition`-labeled record redirects to `/superpowers:brainstorming` instead of shaping). Decomposition mode: `*-design.md`, plus every open record (queried live — there is no separate index to read) | Shaping mode: shapes the record in place (`ready` + scoring, plus `solution:unjustified` and `## Gotchas` on a `solution-baked` verdict); a `needs:definition` redirect writes no label itself, just hands off to brainstorming. Decomposition mode: `ready` sub-issue records, plus a parent record when Step 2.6's collapse decision keeps one — GitHub issues or local `specs/{id}-{slug}.md` files, per `work-backend` | `*-design.md` (decomposition mode, once every phase is fully decomposed) |
| `/assess-agent-autonomy` | A work record's already-fetched body/labels (`grant-check`/`merge-check`/`failure-check`/`ceremony-check` modes) — never a separate fetch | A verdict returned to the caller; never writes a label or file itself | — |
| `/claude-tweaks:backlog refine` | Open work records carrying `ready` with no `auto:*` grant yet (the authorization worklist) | `auto:build`/`auto:merge` labels (human-granted only); strips `bot:blocked` on re-authorization; removes `ready` and comments when flagging an unshaped record back | — |
| `/claude-tweaks:dispatch` | Open work records carrying `auto:build`, unclaimed and no `bot:*` label | `bot:in-progress` claim mirror + the atomic `claims/issue-{N}.json` blob on `claims-registry`; this firing's `decisions.md`; invokes `/claude-tweaks:flow #{n}[,#{m}...]` | Releases its own claim (`bot:in-progress`) on completion or failure; strips `auto:*` grants and adds `bot:blocked` at the retry ceiling |
| `/flow` | A work record reference, `.claude-tweaks/pipelines/{run-id}/config.yml` (Manifesto) | `{run-dir}/work/{n}-spec.md` (materialization), `decisions.md`, `staged/*`; orchestrates `/build` → `/test` → `/review` → `/design-wrapper polish` → `/wrap-up` in sequence | — |
| `/design-wrapper` | Changed files / spec surface metadata, Impeccable CLI/plugin output | Design findings, polish diffs, `design-seed:` on the record body (review mode) | — |
| `/build` | `specs/NN-*.md`, `docs/plans/*.md` | Code, plan files, ledger items. Invokes `/journeys` for journey files and `/simplify` for code cleanup. Worktree mode also produces transient worktree directories and feature branches. | — |
| `/journeys` | Changed files (from parent or git diff), `docs/journeys/*.md` | `docs/journeys/*.md` | — |
| `/simplify` | Changed files (from parent or git diff) | Simplified code (in-place) | — |
| `/deepen` | Changed files / spec scope, module call sites | Depth refactors (in-place) or staged candidates (`decisions.md` + `{run-dir}/staged/deepen-{n}.md`, plus `staged/deepen-collapse-{n}.patch` for narrow collapses per `_shared/staged-patch.md` — never the ledger) | — |
| `/reflect` | Changed files, review summary (in full mode), ledger | Ledger items (phase depends on invoker: `review/hindsight`, `wrap-up`, or `reflect`) | — |
| `/test` | CLAUDE.md (for commands), `stories/*.yaml` (in qa/all mode) | `TEST_PASSED=true`, QA report (when stories exist), `docs/plans/*-ledger.md` (QA findings and observations) | — |
| `/test` (qa mode) | `stories/*.yaml` | `.claude-tweaks/artifacts/screenshots/qa/[YYYYMMDD]_[HHMMSS]_[hex]/` (`report.json` + `report.md`, per-run — see `test/qa-procedures.md`'s `RUN_DIR`), `TEST_PASSED=true`, `docs/plans/*-ledger.md` (QA findings and observations) | — |
| `/browse` | — | `.claude-tweaks/artifacts/screenshots/browse/` | — |
| `/research` | Web sources (built-in `/deep-research` or `WebSearch`/`WebFetch`) | `.claude-tweaks/research/[YYYY-MM-DD]-[slug]/` (`report.md` + `sources.json`) | — |
| `/visualize` | `DESIGN.md` tokens (when present) | `docs/journeys/{name}-{type}.html`, `docs/plans/{spec}-{type}.html`, or `docs/diagrams/{slug}.html` (context-free fallback) | — |
| `/routine` | `skills/{skill}/routine-template.yml`, the existing instantiated record (if any), live state via `RemoteTrigger list`/`get` | `.claude-tweaks/routines/{routine_name}.yml` (the instantiated record); a live cloud Routine via `RemoteTrigger create`/`update` | — (this skill cannot delete; deletion is always via claude.ai/code/routines, never through this skill) |
| `/routine fleet status` | `.claude-tweaks/routines/*.yml`, `RemoteTrigger get`, tracker labels/comments, trust reads | — | — |
| `/stories` | Existing `stories/*.yaml`, `docs/journeys/*.md` (for journey-aware generation), site via `/browse`, component source files (for source analysis) | `stories/*.yaml` (with `source_files:` and `journey:` fields) | — |
| `/review` | Code (via git diff), `specs/NN-*.md`, `docs/journeys/*.md`, `stories/*.yaml` (for journey-story coverage), `TEST_PASSED` from /test, ledger (including QA entries with phase `test/qa`), QA screenshots + page inventories (for UX analysis lens) | Review summary, ledger items. Invokes `/reflect` (hindsight mode), `/simplify`, and `/visual-review`. | — |
| `/visual-review` | Running app (via browser), `docs/journeys/*.md` (journey mode), QA data (optional enrichment), source files (for reconnaissance) | Visual review report, journey file updates, `.claude-tweaks/artifacts/screenshots/` | — |
| `/wrap-up` | `specs/NN-*.md`, review output, plan files, ledger, `.claude/skills/*.md` (relevant skills from ledger entries) | CLAUDE.md updates, skill updates, a new backlog or `parked` work record (GitHub issue or local file, per `work-backend`) for leftover work, `docs/decisions/*.md` (ADRs, from the Decision records curation row). Invokes `/reflect` (full mode). | Plan files, ledger. The build's materialized spec file stays committed as audit trail. |
| `/release` | `release-preflight.json`, `decisions.md` (review verdict), the integration branch's first-parent history | A merged release PR or a `chore(release)` commit + tag, `Shipped in v{version}` comments/closes (`shipped:` lines for local records), `staged/release-held.md` under `--train` | — |
| `/demo` | This session's own unrecorded work, or a specific `#N` record | A human verdict (approve / request changes); a follow-up backlog record on changes-requested | — |
| `/ledger` | `docs/plans/YYYY-MM-DD-{feature}-ledger.md` | Ledger entries (create/append/resolve operations) | The ledger file itself, once every item is resolved |
| `/tidy` | All artifacts | Cleanup actions | Stale artifacts |
| `/help` | All pipeline artifacts (specs, ledger, PRs, backlog state), `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (installed version) — read-only status scan | — | — |
| `/feedback` | A described defect or gap in a claude-tweaks skill | A GitHub issue against `thomasholknielsen/claude-tweaks` (human-invoked, after explicit scrub + confirmation) | — |
| `/routine-kickoff` | Plugin cache listing, target SKILL.md (fallback path) | — (reconcile side effects belong to bin/lib/reconcile) | — |
| `/sweep` | Open work-record queue (via its component steps' own fetches — no separate fetch of its own) | One shared run dir's `decisions.md`/`staged/`, plus whatever `/tidy`, `/specify`, and `/claude-tweaks:backlog refine` each write to records under `--source sweep`. Invokes those three in sequence; hands off to `/claude-tweaks:dispatch` as a recommendation only, never a call | — |
| `/pipeline-smoke-test` | Live `git`/`gh` state (issue labels, claim comments, worktree list) via genuinely separate `claude` processes it spawns | One throwaway, `[pipeline-smoke-test]`-prefixed test issue and its claim state (both closed/released at cleanup); a pass/fail report | The test issue's claim, verified released; no worktree or branch is ever created (stops before `/build`) |

## Open Items Ledger

The open items ledger (`docs/plans/YYYY-MM-DD-{feature}-ledger.md`) is a transaction log that tracks findings and operational tasks across pipeline phases. Created by `/flow` at pipeline start (or by `/build` when running standalone), it persists across all phases until `/wrap-up` resolves every item and deletes the file.

Unlike conversation context, the ledger survives context window compression — it's a file, not a message. This prevents findings from one phase being lost before a later phase can act on them.

## Pipeline Run Directory (v4.6+, auto/hybrid mode)

In auto/hybrid mode, each `/flow` invocation creates a per-run directory at `$RUN_ROOT/.claude-tweaks/pipelines/{ISO-timestamp}-{spec-slug}/` — `$RUN_ROOT` the main checkout root, never wherever the invocation happens to run from (`_shared/pipeline-run-dir.md`'s Anchoring section):

| File | Written by | Read by |
|---|---|---|
| `config.yml` | `/flow` Step 3 (Pipeline Config Manifesto) | Every downstream skill — policy lookup for scope-creep, overlap, design-intent, leftover-default, auto-fix-threshold, review-auto-apply-ceiling, tidy-aggressiveness, ceremony-profile, model-stance, merge-verification, design-critique, merge-authorization |
| `decisions.md` | Every skill that auto-resolves a decision (per `_shared/auto-decision-log.md`) | `/wrap-up`'s Phase 4 (Wrap-Up Review Console) |
| `staged/*.patch` and `staged/*.md` | Skills that defer decision-worthy items | `/wrap-up`'s Phase 4 |

The directory is **collision-safe** across parallel agents (multiple `/flow` runs in the same checkout each get their own `{ISO-timestamp}-{spec-slug}` directory). Downstream skills locate the active run via the `PIPELINE_RUN_DIR` env var or by selecting the most recent matching directory.

After successful pipeline closure, `/wrap-up`'s Phase 4 execution step moves the directory to `.claude-tweaks/pipelines/archive/{run-id}/` — preserving the audit trail without polluting the active workspace.

## Within-Session Context

When skills run in sequence within the same session (via `/flow` or manual chaining), conversation context supplements the artifact flow:

- `/flow` explicitly passes build output to review and review output to wrap-up
- The open items ledger carries forward across phases as a file — independent of conversation context
- Manual chaining (running `/review` after `/build` in the same session) inherits conversation context naturally

## Cross-Session Context

When skills run in separate sessions, only the durable artifacts carry context:

- Start `/build 42` today — artifacts are written to disk
- Start `/review 42` tomorrow — reads spec and git diff, no session dependency

This is why every skill writes its output to files, not just to the conversation.

## The No-Drop Rule

Every artifact that a skill produces must be consumed by a downstream skill or explicitly resolved:

- A build's materialized spec file is kept by `/wrap-up` as committed audit trail
- Design docs are deleted by `/specify` after absorption into the surviving records
- Plans are deleted by `/wrap-up` after the work is done
- Ledger files are deleted by `/wrap-up` after all items are resolved
- Backlog work records are promoted, absorbed, or explicitly kept by `/tidy`
- Parked records have triggers that re-activate (wake) them when conditions are met

Nothing silently accumulates. If an artifact exists, a skill is responsible for it.
