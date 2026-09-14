# Auto-Mode Contract

Single source of truth for what `auto` means across the claude-tweaks pipeline. Every skill that has at least one interactive stop MUST reference this file rather than redefining the semantics inline.

## Why this exists

Without a contract, "auto" was whatever each skill author thought it meant. Some skills checked it, some ignored it, some let the model insert its own caution prompts ("this plan is large, should I split it?"). Users invoking `auto` precisely to avoid those interruptions still got friction.

This contract defines:
1. **Mode states** — what each mode in the "Mode states" table below actually means
2. **Bookend architecture** — where stops are allowed to live (begin + end, never middle)
3. **Decision precedence** — which override wins when sources disagree
4. **Auto-decision log** — the audit trail that makes silent automation safe
5. **Reversibility / confidence floors; severity ceiling** — what `auto` is allowed to decide
6. **HARD-GATE exemption** — what `auto` never silences

## Bookend Architecture

The pipeline has at most two stops in `auto` mode, regardless of how many decisions it makes:

```
┌─────────────────────────────┐                                  ┌─────────────────────────┐
│  [BEGIN]                    │                                  │  [END]                  │
│  Pipeline Config Manifesto  │  ─── pure automation against ───►│  Wrap-Up Review Console │
│  (front-loaded policy)      │      policy, log every decision  │  (back-loaded review)   │
└─────────────────────────────┘                                  └─────────────────────────┘
```

- **Begin stop** — the Pipeline Config Manifesto computes all policy levers (mode, scope-creep, overlap, design-intent, leftover-default, auto-fix-threshold, review-auto-apply-ceiling, tidy-aggressiveness, ceremony-profile, model-stance, merge-verification, design-critique, merge-authorization — `flow/manifesto.md`'s canonical lever numbering) and saves them to `config.yml` inside the run directory at `$RUN_ROOT/.claude-tweaks/pipelines/{ISO-timestamp}-{spec-slug}/` (`$RUN_ROOT` per `_shared/pipeline-run-dir.md`'s Anchoring section — the run directory is never relative to the current directory).
- **Begin stop is opt-in under `auto`.** `/flow` defaults to `auto`, and in `auto` the Manifesto renders as a **read-only FYI** (display levers + sources, then proceed) — so the everyday auto pipeline has effectively **one** user-facing stop: the end-of-run Review Console. Pass `confirm` (or use `hybrid`) to turn the begin stop into a real approval gate. The "at most two stops" promise is a ceiling, not a floor.
- **One message, not many.** When the begin stop *is* a gate (`confirm` / `hybrid`), it is a single message with every lever pre-filled and an Approve all / Override / Cancel choice. Never a chain of per-lever questions — if you need to ask twice, you've already broken the bookend.
- **Mid-flow** — skills look up policy and execute. Every auto-decision lands in the auto-decision log.
- **End stop** — `/wrap-up` Review Console presents one consolidated batch table covering everything that was auto-decided or staged.

**Strict rule:** skills MUST NOT invent new mid-flow stops in `auto` mode. If a skill discovers something that warrants a decision, it stages the decision for the Review Console. The only mid-flow stops permitted are HARD-GATEs and the items listed under "What `auto` does NOT silence" below.

## Mode states

| Mode | When set | Behavior |
|---|---|---|
| `auto` | **`/flow`'s default**; also explicit `auto` arg or `auto-mode: default-on` in `.claude-tweaks/policy.yml` | Bookend architecture with the begin stop as a **read-only FYI** (Manifesto displays, does not gate) — so the only user-facing stop is the end Review Console. Pure automation in the middle. HARD-GATEs and mandatory user-input items still fire. |
| `confirm` | Explicit `confirm` arg | Same as `auto`, but the begin stop is a real **approval gate** (Approve all / Override / Cancel). After approval, the rest of the pipeline runs as `auto`. |
| `hybrid` | Explicit `hybrid` arg | Begin stop is an approval gate; downstream skills also auto-resolve only when reversibility:high AND confidence:high AND severity ≤ low — everything else asks. Review Console still runs at end. |
| `interactive` | Explicit `interactive` arg, or `auto-mode: default-off` in `.claude-tweaks/policy.yml` | No Manifesto presented; skills present each decision in-flow as the standalone skills do. |

**Default note:** `/flow` defaults to `auto` (its purpose is hands-off automation). Standalone skills invoked outside `/flow` with no mode signal fall back to `interactive`. The `auto-mode:` key in `.claude-tweaks/policy.yml` lowers (`default-off` → interactive) or confirms (`default-on` → auto) the default; an explicit mode arg always wins.

## Decision precedence

When multiple sources can dictate a choice, highest wins. Conceptually, four levels:

1. **Explicit CLI arg** — `/flow 42 auto no-polish` always wins for that invocation
2. **Pipeline config** — answers from the Config Manifesto (`config.yml` in the run directory at `$RUN_ROOT/.claude-tweaks/pipelines/{ISO-timestamp}-{spec-slug}/`)
3. **Project policy** — defaults in `.claude-tweaks/policy.yml` (e.g., `scope-creep: add-to-plan`)
4. **Skill default** — the skill's fallback behavior when nothing above is set

Only level 1 is checked in prose — the skill inspects its own invocation arguments. Levels 2–4 are executed mechanically by ONE resolver call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --run "$PIPELINE_RUN_DIR" <key>
```

The resolver walks run `config.yml` → `policy.yml` → schema default in one step; the `source` field in its JSON envelope (`run-config | policy | default`) reports which level decided. (`${CLAUDE_PLUGIN_ROOT}` is a model-resolved placeholder — substitution contract in `docs/skill-authoring.md`'s "Plugin-root references (`CLAUDE_PLUGIN_ROOT`)" section.) Manifesto-lever read sites cite this section and call the resolver; they do not re-execute the chain in prose.

When in doubt: ask once at the Config Manifesto, then never again for the rest of the pipeline.

## Pipeline run directory: location and collision-safety

Each `/flow` **run** gets a unique, per-run directory at (one per run, not per invocation — an invocation handed an existing `PIPELINE_RUN_DIR` adopts that run instead of creating a second, per `flow/steps-and-gates.md`'s **Adopting an inherited run directory**):

```
$RUN_ROOT/.claude-tweaks/pipelines/{ISO-timestamp}-{spec-slug}/
├── config.yml         ← Pipeline Config Manifesto answers
├── decisions.md       ← Auto-decision log (see auto-decision-log.md)
└── staged/            ← Patches and proposals awaiting Review Console
    ├── review-{n}.patch
    ├── tidy-{n}.md
    └── ...
```

`$RUN_ROOT` is the main checkout root, resolved per `_shared/pipeline-run-dir.md`'s Anchoring
section via `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --root-only` — **never the current directory**.
This matters whenever the creating invocation runs from inside a linked worktree (e.g.
`/claude-tweaks:dispatch` Step 5 enters a group's worktree before dispatching `/flow`): a
relative path there would create the run directory inside that worktree, which a later worktree
removal could then destroy with no git history to recover from. See `flow/manifesto.md`'s Path
conventions for the operative creation-time instruction.

Where `ISO-timestamp` is `YYYY-MM-DDTHHMMSS` (no colons; portable across filesystems) and `spec-slug` is the spec number(s) or topic slug — e.g.:

```
$RUN_ROOT/.claude-tweaks/pipelines/2026-05-15T143207-spec-42/
$RUN_ROOT/.claude-tweaks/pipelines/2026-05-15T143207-spec-42-45-48/
$RUN_ROOT/.claude-tweaks/pipelines/2026-05-15T143207-meal-planning/
```

**Why unique:** multiple parallel agents (different worktrees, different terminals, even just same-second invocations on the same checkout) never collide. Each run's artifacts live together and clean up atomically.

**How downstream skills find the active run:** the entrypoint skill (`/flow`, or first standalone skill in a chain) creates the directory and a marker file. The ordered resolution algorithm itself is **owned by `_shared/run-dir-resolution.md`'s "Resolution order" section** — read it there.

It is deliberately not restated here. That file's list is the complete one: it includes the record-mode materialization exception for standalone `/claude-tweaks:build #{n}`, which a summary in this section previously omitted, so a skill following the summary got the wrong answer for that invocation. Every consumer that cites a resolution step by number — `/capture`, `/tidy`'s `scan-procedures.md`, `flow/materialize.md`, `_shared/auto-decision-log.md` — cites that file's numbering.

This section stays canonical for everything *around* the ordering: the directory layout above, the collision-safety rationale, and the cleanup and gitignore rules below.

**Cleanup:** the Wrap-Up Review Console moves completed runs to `.claude-tweaks/pipelines/archive/{run-id}/` on successful pipeline closure (preserving the audit trail). `/tidy`'s Standalone-auto path additionally compacts standalone run directories older than 30 days into a monthly rollup, and — since a `/flow`-orchestrated run that stops at an interactive HARD-GATE and is never resumed reaches neither path above — abandoned non-standalone run directories older than 30 days with a non-`active` `run-state.json` status too. See `_shared/auto-decision-log.md`'s Archival section for the exact behavior.

**Gitignore:** most of `.claude-tweaks/` is runtime state, but `/init` deliberately does **not** blanket-ignore the directory — it adds split entries (`.claude-tweaks/pipelines/`, `.claude-tweaks/research/`, `.claude-tweaks/code-health/`, `.claude-tweaks/harness-health/`, `.claude-tweaks/journey-health/`, `.claude-tweaks/docs-health/`, `.claude-tweaks/routine-environment-cache.yml`) instead, because `.claude-tweaks/routines/{name}.yml` (instantiated cloud-Routine records) is meant to stay committable, and git's `!` negation can't reliably re-include a subdirectory of an already-ignored parent (see `init/bootstrap/step-04-gitignore-suggestions.md`). This covers each health skill's own local `cache.json` (`code-health/`, `harness-health/`, `journey-health/`, `docs-health/` — cursor/run-history live on the durable `health-state` git branch, see `_shared/health-state.md`). Pipeline runs are not committed history — carve-out: `*-tidy-standalone*` and `*-sweep-standalone*` (`auto-decision-log.md`, #1493/#1494) — logged for the user, not the repo.

## Auto-decision log

Every auto-resolution is logged. This is non-negotiable — silent automation without an audit trail is forbidden.

See `auto-decision-log.md` for the full schema. Summary:

- Path: `.claude-tweaks/pipelines/{run-id}/decisions.md` (per-run, append-only)
- Format: per-skill section with timestamped entries
- Read by: `/wrap-up` Review Console
- Each entry: action, rationale, reversibility, status (`AUTO` | `STAGED` | `KEPT-PROMPT`)

## Reversibility / confidence floors; severity ceiling

A skill MAY auto-resolve a decision only when ALL of these hold:

| Floor / Ceiling | Threshold | Why |
|---|---|---|
| **Reversibility** (floor) | `high` — undoable via file edit or `git revert` | Auto-decisions must be cheap to roll back at the Review Console |
| **Confidence** (floor) | `high` — skill states "this is clearly the right choice given inputs" | Low-confidence choices need user judgment |
| **Severity** (ceiling) | `low` (for findings) — nits, conventions, mechanical fixes | Higher severity is human-judgment territory |

When any floor fails, the skill MUST stage the decision (log it, don't act) and surface it at the Review Console.

The hook surface (`bin/hooks.js`, see CLAUDE.md Conventions → Hooks) mechanizes these tiers for working-directory discipline and run continuity — block/warn/inform/log map 1:1 to the reversibility floors defined here.

### Always-reversible (auto-OK)

- File edits in worktree (`git revert`)
- Patch files staged in `.claude-tweaks/pipelines/{run-id}/staged/` (apply later, never silently)
- Auto-decision log entries (delete to undo)
- Cache writes under `.claude-tweaks/pipelines/{run-id}/cache/*.json` (regeneration is cheap)
- Ledger appends with status `observation` or `open`
- **Ephemeral dev server** started on a free port, anchored to the worktree root, with PID/port tracked in `{run-id}/ephemeral-server.txt` and torn down at wrap-up (kill the process to undo). This is the worktree-correct way to make a running app reachable for `/visual-review` and `/stories` in auto mode — see `_shared/dev-url-detection.md`, "Ephemeral server start". (A *global install* like `agent-browser` is NOT in this class — see `browser-detection.md`.)

### Never-reversible (auto-FORBIDDEN, regardless of mode)

- Closing or deleting work records
- Closing ledger items as `fixed` / `accepted` / `dropped` (Phase 2 of the resolve gate)
- `git push` to shared branches
- Creating work records (filing new records on the user's tracker) — except scheduled health-skill born-ready records (see `_shared/work-record.md`'s born-ready rule) and queue-write proposals when the `autonomy` ceiling's `queueWriteAutoFile` bookkeeping capability is unlocked (`trusted`+ — see `_shared/autonomy-ceiling.md`)
- Originating a work-record grant (`auto:build` / `auto:merge`) — except via `/claude-tweaks:backlog refine`'s headless posture, under the `autonomy` ceiling's `unattended` tier plus its explicit `grant-origination-enabled` opt-in, for an agent-filed class carrying a `clean` trust verdict that also clears a content-aware `grant-check` and every floor (see `_shared/autonomy-ceiling.md`, `backlog/refine-headless.md`). Both keys default off; a human sets them deliberately in `policy.yml`
- Network calls beyond reads (no API writes, no message sends)
- Modifying project-policy values — `.claude-tweaks/policy.yml`'s keys, and the
  work-record keys still resident in CLAUDE.md (`work-backend`, `work-types`,
  `record-staleness-weeks`)
- Deleting specs
- Executing a live, side-effecting, hard-to-reverse action against shared state solely to verify an acceptance criterion — a real PR/merge/branch-delete cycle, an irreversible external API call, or anything similarly destructive taken just to prove the AC — defer it instead to the closing summary's Manual Steps table (an `ops` ledger entry, `reason-not-auto: live-verification` — `_shared/ledger-format.md`'s Required-for-ops table). Worked example: #683's AC4 asked for a live create-worktree/commit/PR/merge/teardown cycle against the actual repo; deferred rather than executed mid-pipeline.

## What `auto` silences

| Prompt / decision | Default behavior | Behavior under `auto` |
|---|---|---|
| Pre-flight branch-divergence-check (`/flow` Step 2.5) | Offer rebase vs continue | Continue and add `ops` ledger entry |
| Shape-check warnings (`/flow` Step 2.6) | Offer decompose / proceed / cancel | Proceed with the documented default and add `ops` ledger entry naming the signal |
| Worktree consent (`/build` Common Step 1) | `/superpowers:using-git-worktrees` consent prompt | Pre-authorized by `auto` (user explicitly opted in) |
| Plan audit scope-creep (`/build` Common Step 1.5) | Add-to-plan / continue / stop | Apply policy from manifesto (default `add-to-plan`) |
| Overlap handling (`/specify` Step 1) | Skip / extend / companion / replace | Apply policy from manifesto (default `companion`) |
| Impeccable shape (`/specify` Step 2.5b) | Run / skip | Auto-run for frontend specs; skip for others |
| Design intent (`/specify` Step 2.5c) | 6-way creative direction | Apply manifesto value (default `none` — no intent applied) |
| Design polish-phase dispatch (`/flow` polish phase, via `/claude-tweaks:design-wrapper polish`) | N/A — the refinement set and suggestion-driven have no interactive equivalent (they're always-run and signal-triggered respectively); intent-driven was already pre-selected at `/specify` Step 2.5c | Refinement set: always dispatched when frontend. Suggestion-driven: dispatched per audit finding's own `suggestion` field, never by re-deriving a command from the finding's category. Intent-driven: dispatched per pre-declared `design-intent:`. All `AUTO` — logged by `/flow` using `/design-wrapper polish`'s `decision_summary` field. A finding whose `suggestion` names a manual-only command, or that carries no usable `suggestion` at all, is **not** dispatched: `/flow` writes it to `{run-dir}/staged/` and logs it `STAGED` for the Wrap-Up Review Console. |
| Code review findings (`/review` Step 3 Routing) | Apply all / override | Severity:low → `AUTO`; severity:medium → `STAGED`; severity:high → `STAGED`; severity:critical → `KEPT-PROMPT` (rare — security/correctness hard-fails the bookend) |
| Tidy cleanup (`/tidy`) | Per-item decision | Auto-apply Keep and unambiguous Delete; stage Merge/Promote/ambiguous |
| Test fix mode (`/test` Step 3) | Auto-fix / show / skip | `lint` tier: lint-only. `lint+type` tier (default): lint + type-only. `lint+type+test` tier (opt-in via Manifesto): also auto-fix straightforward test failures. Anything beyond the tier ceiling is staged. |
| Architecture alignment (`/build` Common Step 4.5) | Per-deviation decision | Deviations classified `Beneficial` → `AUTO` (apply silently to plan/spec, log entry includes commit ref of spec edit). `Update the spec` → `STAGED`. `Fix now` → `KEPT-PROMPT`. |
| Visual-review prereqs (`/visual-review` Step 1) | Install / skip | Auto-skip if not installed; surface in report |
| Visual-review dev URL (`/visual-review` Step 2) | Try other / wait | First **attempt to start an ephemeral worktree server** on a free port (reversible, tracked, torn down at wrap-up — see `dev-url-detection.md` Step 3 + "Always-reversible" above). Auto-skip to code-only mode with a "dev URL unreachable — no dev command / start failed" log entry **only if** no server can be started. Never reuse a foreign (main-checkout) server in a worktree run. |
| Stories v1 detection (`/stories` Step 1) | Regenerate all / diff / cancel | Auto-skip migration; stage as "legacy stories detected" |
| Story journey link suggestions (`/stories` Step 6) | Apply all / override | Auto-apply (mechanical mapping) |
| Init Phase 3 classification | Confirm / override | Auto-confirm when detection confidence ≥ 0.8 and signals are consistent |
| Capture next-action routing | Numbered options | Apply `--route` arg if set; else, on an **agent-driven filing** (`$PIPELINE_RUN_DIR` set, `--source`, or `--defer-reason=`), `capture/SKILL.md`'s headless absorb bar decides at filing time — absorb into the matched record when its structural bar (shared literal file path + identical `type:{t}`) is met, otherwise file fresh with `**Related:** #N`. Every other `auto` invocation defaults to `keep` (record stays in backlog state — most conservative) |
| Reflect insight routing | Per-item decision | Auto-route: defer (default), keep (tangential — stages a record proposal for the Review Console, stays in backlog state); a safety regression is KEPT-PROMPT — always surfaces inline, `auto` never silently auto-applies it |
| Wrap-up Phase 3 leftover routing | Per-item decision | Apply `leftover-default` policy from manifesto (default `defer`) |
| Wrap-up's Skills curation row | Apply all / override | Auto-apply purely additive changes (new examples, anti-patterns) — including those the independent domain scan surfaces, not only ledger-seeded ones; stage restructures and new-skill candidates |
| Wrap-up's per-spec Review Consoles under multi-spec `/flow` | One console per spec at each wrap-up (N consoles for N specs) | **Consolidated into one** end-of-run Review Console at `/flow`. Per-spec wrap-ups skip their own console when `MULTISPEC_REVIEW_DEFER=1` is set; the parent `/flow` runs a single console reading the parent run dir's `decisions.md` + `staged/` and every per-spec `decisions.md` + `staged/` (plus, for the five engine-rendered sections, each spec's own `engine-state.json` via a `--spec-state` CLI call to `wrap-up-engine.js`) after the last spec completes. Preserves the bookend promise (one start stop, one end stop) regardless of N. See `flow/multispec-review-console.md`. |
| Worktree reap (pr-first: `bin/hooks.js reconcile-background`, a detached process `bin/lib/hooks/session-start.js` spawns off its own `SessionStart` hot path, #820 D8; local-merge/no-forge: still inline via `bin/lib/hooks/worktree-reap.js`'s legacy `reapWorktrees`, `reconcile/index.js`'s model branch) | N/A — fires before any conversation exists (and, under pr-first, in a detached process outside any conversation at all), so there is no interactive equivalent to silence | Always resolves at the **log** tier (CLAUDE.md Hooks: block/warn/inform/log): appends an `events.jsonl` entry (`worktree-reaped` / `worktree-reap-skipped`) per worktree reaped or skipped to the OWNING run's own events.jsonl (joined via `findRunByWorktreePath`), and reports reaps plus the *notable* skips in a LATER SessionStart's banner (skips describing a healthy repo — a live session's own worktree, the `.worktrees/` domain the reaper does not own, a stale-pid lock still inside its grace period — are logged but not reprinted every session; see `QUIET_SKIP_REASONS`). Not user-facing decision-worthy — there is no `AUTO`/`STAGED`/`KEPT-PROMPT` routing, since the safety predicate in `bin/lib/hooks/worktree-reap.js`/`bin/lib/reconcile/reap-merged.js` is the only gate, not a reversibility/confidence floor or severity ceiling. |
| PR title/description refresh before merge (`integration-model: pr-first` — `_shared/integration-model.md`) | N/A — no interactive precedent; a stale title/body is refreshed automatically once a merge is imminent | Unconditional `AUTO` step, never a stop: `_shared/pr-checklist-refresh.md`'s "Pre-merge title/description refresh" section runs before `_shared/pr-first-merge.md` Step 2 undrafts the PR. Explicitly named here so a model never re-invents this as a confirmation question. |
| CI wait before merge (`integration-model: pr-first` — `_shared/integration-model.md`) | N/A | `_shared/pr-first-merge.md` Step 2.5 is the sole authority for how long a merge waits on checks — it resolves `merge-verification` mechanically and either merges, arms `--auto`, or parks with `bot:parked`. Never an `AskUserQuestion`; no other file may restate or duplicate this wait. |
| Merge authorization lever (`integration-model: pr-first` and `local-merge` — `wrap-up/review-console.md`'s Auto-merge short-circuit) | N/A — a Manifesto-time human decision, not a mid-flow prompt | When `merge-authorization` resolves `pre-authorized` (Manifesto lever 13 — always a live answer: an explicit Manifesto `confirm`/`hybrid` override, never a `policy.yml` default, per `flow/manifesto.md`'s Recommendation defaults note), the run's terminal merge auto-resolves the same way an `auto:merge`-labeled record's does — zero further `AskUserQuestion` calls, full merge machinery reused (`_shared/pr-first-merge.md` / the short-circuit's local-merge branch), logged distinctly (`tag: manifesto-authorized`). This is the second, independent trigger for the existing Auto-merge short-circuit; content judgment (`assess-agent-autonomy` `merge-check`) still applies regardless of which trigger fired. Both this path and the standing `auto:merge` label path satisfy the same invariant: an agent never originates its own merge authorization — a human always granted it, live, either per-record (the label, via `/backlog refine`) or per-run (this lever, via a live Manifesto override). |
| Local-merge finish decision (`wrap-up/cleanup-procedures-execution.md` Section C) | `finishing-a-development-branch`'s interactive merge/PR/discard/keep-as-is menu | Routes through `_shared/local-merge-auto-finish.md` when `config.yml` exists (every mode but `interactive`) — defaults to merge locally, logs the outcome, parks (never auto-resolves) on a conflict or failed post-merge verification |
| Mid-pipeline reality-checks inserted by the model | Free-form prompt | **NOT ALLOWED** — see Anti-Patterns |
| "Are you sure?" before authorized reversible operations | Confirmation prompt | Proceed silently |
| Cost / wall-clock estimates as stop questions | Free-form prompt | **NOT ALLOWED** — surface in summary, not as a blocking question |

## What `auto` does NOT silence

`auto` is not a global skip-everything flag. The following are policy gates, not UX preferences, and require explicit user input — or, for the rendering rows (failure cards, the terminal block), are always rendered — regardless of `auto` state — except where a row below states its own `autonomy`-ceiling carve-out:

| Item | Why mandatory |
|---|---|
| Ledger resolve gate Phase 2 (every open item, per-item) | Items represent unfinished work — silently dropping them is the bug `auto` is *not* allowed to introduce, unless the `autonomy` ceiling's bookkeeping capabilities are unlocked: `ledgerNarrowing` (`trusted`+) auto-routes an item whose blocker reason clears the four-category floor to `Route to a record → Keep (backlog)`; `ledgerRouteRemainder` (`unattended`) extends that same restricted disposition to the remainder — see `_shared/autonomy-ceiling.md` for the narrow, backlog-only carve-out |
| Work-record creation (new backlog records, `Q#` at the Review Console) | Each record filed on the user's tracker needs explicit approval — the record queue is the user's, not the model's. At `supervised`/`trusted`, covered by the Review Console's batch "Approve all" — `Q#` applies by default (the checked state), a reversal of the #288 family's per-item carve-out on explicit direction (refs #288, #347); `queueWriteAutoFile` (`trusted`+, `_shared/autonomy-ceiling.md`) additionally files directly without waiting for the console. At `unattended`, auto-resolved with zero `AskUserQuestion` calls under `consoleAutoResolve` (`_shared/autonomy-ceiling.md`). Scheduled health-skill filing is separately exempt at every tier — born-ready records are those skills' documented output (see `_shared/work-record.md`, born-ready rule). |
| Ops-acknowledgment (`/wrap-up` "Ops acknowledgment" step, when ops items exist) | Ops items represent infrastructure changes the user must action post-merge — bulk-acknowledging without the user reading each one risks a missed action, so every item requires explicit confirmation. Exempt only when `opsAckAutoAcknowledge` is unlocked (`unattended` only) — see `_shared/autonomy-ceiling.md` for the narrow, logged carve-out. |
| Memory file writes (`/wrap-up`'s Memory curation row, `_shared/learning-routing.md` D4, `M#` at the Review Console) | A memory file is cross-project and always-loaded — a wrong one silently degrades every future session in every project the user works in, which is the largest blast radius of any routing destination. Always staged, never written outside its own approval. At `supervised`/`trusted`, covered by the Review Console's batch "Approve all" — `M#` applies by default (the checked state), a reversal of the #288 family's per-item carve-out on explicit direction (refs #288, #347). At `unattended`, auto-resolved with zero `AskUserQuestion` calls under `consoleAutoResolve` (`_shared/autonomy-ceiling.md`). Per-item chunking (inspect each file before approving) survives only inside the Override drill. |
| Upstream feedback filing (`/wrap-up`'s Upstream feedback curation row, `/claude-tweaks:feedback`, `U#` at the Review Console) | Publishes privately-derived content to a public repository — outward-facing and effectively irreversible, the same category as work-record creation. The scrub gate runs in every mode. At `supervised`/`trusted`, covered by the Review Console's batch "Approve all" — `U#` now applies/files by default (the checked state), a reversal of both the #288 family's per-item carve-out and of [IL-114]'s unchecked-by-default posture at the batch level (refs #288, [IL-114], #347); the unchecked-by-default described in `_shared/upstream-feedback-batch.md` survives only inside the Override drill's own per-item chunking, never as the Approve-all default. At `unattended`, auto-resolved with zero `AskUserQuestion` calls under `consoleAutoResolve` (`_shared/autonomy-ceiling.md`). |
| Marking records `parked` | Same — putting work on hold is a user decision |
| `/init` Phase 4 (skill manifest), Phase 8 (Impeccable), Phase 9 (final confirmation), scope-selection gate | Project-shape governance decisions are user-only |
| `/init` Step 6.5's port-rewrite diff gate | Edits the user's own project config — outside the always-reversible floor. Runs in every mode including `auto` (`init/bootstrap/step-06-5-port-isolation.md`, #1794) |
| HARD-GATE / BLOCKED / STOP conditions | `/review` Step 1 spec compliance, `/review` Step 1.5 test gate, `/flow` Step 2.7 design-doc rejection, `/build` Design Step 3 plan validation, `/build` Common Step 1.5 plan audit hard-fails, and /flow's multi-spec boundary-freshness escalation (flow/multispec-freshness.md — a boundary merge conflict, or a clean merge whose incoming diff overlaps run-modified paths or the remaining specs' Key Files). These prevent degraded output. (`/flow` Step 2.6's shape-check hard-fail is NOT in this list — under `auto` it auto-resolves to "proceed anyway" with an `ops` ledger note per the row above; it only actually stops the pipeline in `interactive`/`hybrid` mode.) `/release` Step 4's two gates (review: blocking, a major bump — release/console.md) |
| Any skill's own local-files Preflight-stop (or equivalent explicit authorization gate) | Never superseded by this project's own documented auto-mode/hands-off-pipeline conventions (`/flow` defaulting to `auto`, "skills MUST NOT invent new mid-flow stops," or any similar description elsewhere in this file or CLAUDE.md) — those conventions govern behavior *within* a pipeline run already authorized to proceed, not whether a gate may authorize new work in the first place. A real run found a live model resolve exactly this conflict the wrong way once already — see `_shared/local-files-preflight-stop.md`'s "Why this exists" for the incident. |
| Hard validation failures (uncommitted changes, missing prereqs, malformed input) | Correctness gates. Bypassing them produces broken pipelines. |
| Final pipeline failure cards | A failure is information the user needs — don't suppress |
| Terminal `## Next Actions` block (every run's closing turn — `/flow`'s Pipeline Summary close-out and failure cards included) | A navigation affordance, not an approval gate — it sits outside `consoleAutoResolve`'s zero-click scope (`_shared/autonomy-ceiling.md`), which covers only the Review Console's approval decisions. The final turn always renders it, in every mode including `unattended`: plain markdown per docs/skill-authoring.md's Skill handoffs convention (paste-ready fully-qualified commands, one per line, recommended first and bold — never an `AskUserQuestion` for the block itself: the Interaction style directive reserves that for a documented machine-consumed terminal decision, and a genuinely blocking decision (`flow/failure-cards.md`'s claims-release prompt) renders as its own separate call alongside the block, never folded into it), and the recommended line is the actual next command (when this run ends without merging under `integration-model: pr-first` — the terminal Review Console's own `AskUserQuestion` already covers the live-session case; this row covers the case where the run parks anyway — the recommended line is the resume command `PIPELINE_RUN_DIR="{run-dir}" /claude-tweaks:flow "{target}" wrap-up`, per `flow/summary-template.md`'s resume-to-merge row, task-refs #715). Ending a run in bare prose with no such block is a rendering omission, not an authorized silencing. |
| Code modifications outside the skill's documented scope | If a skill is asked to do X and would modify Y to make X work, that's a scope expansion the user must authorize. Exempt only for a **pointer repair** — a reference broken *by this run's own change* — and only when `autonomy` is `trusted` or `unattended`; see `_shared/initiative-budget.md` for the narrow, capped, logged carve-out. The exemption is causal, not size-based: a small edit the run merely *noticed* it could make is still a scope expansion, at every ceiling |
| Resolution of merge conflicts in worktree finishing | Conflict resolution requires intent the model cannot infer |
| Design intent (when manifesto value is `none` AND skill detects creative work) | Creative direction is user-only when explicitly left open |
| Ui-stack (when the `ui-stack` policy value is unset AND skill detects frontend work) | Component-library/styling preference is user-only when unset. `policy.yml` only — `ui-stack` has no Manifesto lever, and the key carries no schema default, so unset is its only open state |

## Forbidden under auto

The model is explicitly forbidden from inserting model-side reality-checks beyond what skill steps prescribe. Specifically banned:

- Size-driven scope checks ("this spec is large — should I split it?") — the shape gate handles structural signals; size is not a signal
- Context-window concerns ("the context is getting large — should I summarize?") — context management is the harness's job
- "Just checking in" prompts mid-flow
- Re-asking decisions already answered by the Config Manifesto
- Inserting "are you sure?" prompts before reversible authorized actions
- Bulk-resolve fast paths for the ledger resolve gate (always per-item)
- Pre-emptively stopping the pipeline over speculative concerns

If the skill genuinely needs information not in the Config Manifesto, it logs `NEEDS_CONTEXT` to the auto-decision log and surfaces it at the Review Console — it does not stop mid-flow.

## Per-skill compliance

The canonical per-stop behavior table is the "What `auto` silences" / "What `auto` does NOT silence" pair above. Each pipeline-participating skill MUST:

1. Cite this file **at the point where the skill implements an auto branch** — in the step body that makes the decision, not in a list of files the skill relates to. A citation the running model reads on its way into the branch is the one that binds; a citation parked in a table it never consults is not.
2. When implementing an auto branch, follow the "Skill integration pattern" below (check CLI arg → one resolver call → log entry).
3. Resist the urge to redeclare semantics inline. If a skill needs a per-stop quick reference, link to the relevant row in the silences table rather than duplicating it.

Per-skill `## Auto-mode behavior` tables in SKILL.md are deprecated as of v4.7.0 — the silences table is the single source of truth. Drift between two copies (skill-local and contract-canonical) was the failure mode they were meant to prevent and instead enabled.

## Adding a new policy lever

Extending the Manifesto with a new lever touches more files than the lever's own logic — a past lever's addition initially missed several of these and caught the gaps only at whole-branch review. Checklist, grounded in that experience:

1. **This file** — add the lever name to the Bookend Architecture's computed-levers list (above); add its row(s) to "What `auto` silences" / "does NOT silence" if it changes either list; add a caveat anywhere an existing table row's guarantee narrows.
2. **`flow/SKILL.md`** Step 3 — add the lever name to the levers-computed sentence.
3. **`flow/manifesto.md`** — the lever needs an entry in *every* one of: the suppression-rules table, the canonical numbering line, the illustrative Policy Levers example table, the Suppressed/Valid-overrides footer, the Recommendation Defaults table, and the `config.yml` schema example. The Override Semantics table itself lives in **`flow/manifesto-overrides.md`** — update it there.
4. **`help/reference-card.md`** and **`help/context-flow.md`** — both files independently enumerate the full lever list ("every policy lever" / the `config.yml` consumer row) and sit outside the Manifesto's own file tree — easy to miss entirely, and the only two gaps a whole-branch review caught that no task-level review touching the Manifesto files themselves could have seen.
5. **The enforcement skill file(s)** the lever actually gates — where the new behavior lives.

Verify with a grep for the lever's kebab-case name across `plugin/skills/` and root `CLAUDE.md` before considering the addition complete — a zero-hit file that should have one is the failure mode this checklist exists to prevent.

## Skill integration pattern

When a skill has a historical mid-flow stop, rewrite it like this:

```markdown
### Step N: {decision name}

**Interactive mode:** call `AskUserQuestion` with the options below and wait.

**Auto mode:**
1. If an explicit CLI arg covers `{policy-key}`, apply it (precedence level 1 — the only level checked in prose).
2. Else resolve `{policy-key}` with ONE resolver call — `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --run "$PIPELINE_RUN_DIR" {policy-key}` (resolve the run dir via the `PIPELINE_RUN_DIR` env var or most-recent matching run under `.claude-tweaks/pipelines/`) — which executes run config → project policy → skill default mechanically; apply the envelope's `value`, and use its `source` as `{policy-source}` below.
3. Log to auto-decision log (append under `## /{skill}` heading in `{run-dir}/decisions.md`):
   `- AUTO {HH:MM:SS} — {step name}: applied {value}. Reason: {policy-source}. Reversibility: {high|med|low}.`
4. If reversibility != high OR confidence != high OR severity > low → stage instead:
   `- STAGED {HH:MM:SS} — {step name}: {what was found}. Stage path: staged/{slug}.{ext}.`
   Surface at the Wrap-Up Review Console.
```

## Failure-mode contract

`auto` shifts the failure mode from "ask the user" to "fail loud at the gate." Skills under `auto`:

- Must reach a gate or successful completion without prompting (except for "What auto does NOT silence")
- Must surface failures via the ledger and the failure card, not mid-pipeline questions
- Must NOT swallow failures to "keep things automatic" — silent failure is worse than loud failure

The user's contract under `auto` is: "I trust the pipeline; if it can't proceed, stop and tell me why — don't ask me to make decisions you should be making."

## Anti-Patterns

Read `auto-mode-anti-patterns.md` in this directory for the full table of failure modes this contract prevents.
