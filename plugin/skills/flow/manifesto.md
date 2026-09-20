# Pipeline Config Manifesto — Step 3

The Manifesto is the **first bookend** of the pipeline (see `_shared/auto-mode-contract.md`). One structured table collects every policy lever the pipeline needs.

## When to run

In every mode except `interactive`, the Manifesto **computes the levers and writes `config.yml`**. What changes by mode is whether it stops for approval:

<!-- when: mode=auto -->
- **`auto` mode (flow's default)** — **read-only FYI.** Compute the levers, render them as a `### Pipeline Config (auto)` table (value + source), print `→ proceeding (no approval needed)`, and continue. No approval stop. This is the everyday path, and the only content it ever needs is in this file — never open `manifesto-confirm.md` for an `auto` run.
<!-- /when -->
- **`confirm` mode** — **approval gate.** Present the full Manifesto with the `Approve all / Override / Cancel` block and wait. After approval the rest of the pipeline runs as `auto`. Use when the user wants to inspect/tweak levers first. Additionally read `manifesto-confirm.md` in this skill's directory — the `AskUserQuestion` call, the Rendering rules for the preview, and the On-override/On-cancel branches live there, split out so an `auto` run's own read of this file never has to load them (#657).
<!-- when: mode=hybrid -->
- **`hybrid` mode** — approval gate (same as `confirm`, including `manifesto-confirm.md`); policies set here are honored, but skills still prompt for non-floor decisions.
<!-- /when -->
<!-- when: mode=interactive -->
- **`interactive` mode** — no Manifesto, and this step creates no run directory; skills present each decision in-flow (they prompt rather than read `config.yml`). The run does still acquire a run directory before it ends: `/claude-tweaks:wrap-up`'s Phase 1 creates one unconditionally, in every mode, because its Review Console runs in every mode. That one carries no `config.yml` — nothing ran a Manifesto to write one — so the in-flow prompting above is unaffected.
<!-- /when -->

## Compute recommendations

Walk the precedence chain (see `_shared/auto-mode-contract.md`):

1. Explicit CLI args from `$ARGUMENTS` (e.g., `no-polish` sets `polish: skip`)
2. Pipeline-config file from a previous run that's still active in this session (rare; usually skipped)
3. Project policy — the resolved `auto-mode` value: `AUTO_MODE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values auto-mode)` (empty when `.claude-tweaks/policy.yml` leaves it unset — the key has no schema default)
4. Hardcoded sensible defaults (last resort)

For each lever, record both the recommended value AND its source.

**Git lever override.** When `.claude-tweaks/policy.yml` sets `worktree-always: true`, the Git lever is forced to `worktree` regardless of CLI args or defaults above — `current-branch` is never offered. This is enforced mechanically by a `PreToolUse` gate (`_shared/git-discipline.md`); the Manifesto short-circuits to `worktree`.

**Ceremony profile computation.** Unlike the other levers (policy preferences resolved via the precedence chain above), `ceremony-profile`'s value is computed by folding every record's materialized `ceremony:` header field (`materialize.md`) with a logical AND: `fast-lane` only when every record in this run has `ceremony: fast-lane`; any record missing the field (defaults to `standard`) or carrying an explicit `standard` sends the whole run's `ceremony-profile` to `standard` — mirrors the auto-merge gate's existing "every member of the group must carry `auto:merge`" rule (`dispatch/SKILL.md`'s Auto-merge gate). Source is always `header`. The computed value still becomes this lever's Recommended value, overridable via the normal `9=value` mechanism below — unlike Design intent (locked in from `/specify`), `ceremony-check`'s verdict is a fresh automated judgment call, and this Manifesto is the first point a human sees it.

## Compute per-spec preview

Before rendering the Manifesto, derive a per-spec preview by reading each record's materialized header when one exists — pre-materialization, fall back to the record body's `Surface:`/`Design-intent:` metadata lines — and inferring what will run:

| Field | Source | How to derive |
|---|---|---|
| Surface | Materialized header `surface:` (`materialize.md`) — or the record body's `Surface:` line when no run-dir header exists yet (or detect from Key Files extensions, using the same trigger-extension/trigger-path rules as `/claude-tweaks:design-wrapper`'s Layer 3 sniff — for the canonical list, read `frontend-detection.md` in that skill's directory) | `frontend` if trigger files present; else `backend` / `infra` per header or content |
| Ceremony | Materialized header `ceremony:` (`materialize.md`) — always present | Read directly (`fast-lane` or `standard`) |
| Polish | `surface` × materialized header `design-intent:` (or the body's `Design-intent:` line) × `no-polish` arg | `run` if frontend + design-intent != none + no-polish not set; `skip ({reason})` otherwise |
| Stories | UI files in plan + `no-stories` arg | `auto-detect` if UI files in plan + no-stories not set; `skip` otherwise |
| QA | `stories/*.yaml` exists for this record's surface | `run` if matching stories; `skip` if none |
| Friction note | Lever recommendations × record content | One-line warning when an approved lever still introduces prompts for this record (e.g., review-auto-apply-ceiling `low` + a frontend record with prior HIGH findings) |

Suppress the preview table entirely when only one spec is run and Polish, Stories, and QA all read `skip` or `none` — present a single-line summary instead.

## Determine lever suppressions

A lever is **suppressed** (hidden from the Manifesto) when no skill in the resolved step list consumes it. Suppression rules:

| Lever | Suppressed when |
|---|---|
| **Overlap** (3) | `/specify` not in the pipeline (always suppressed for `/flow` — specs already exist) |
| **Design intent** (4) | All records have `design-intent:` locked in their materialized header (or body metadata), OR all records are non-frontend (polish auto-skips regardless) |
| **Tidy aggressiveness** (8) | Always suppressed by `/flow` — `/tidy` is not an allowed flow step (`steps-and-gates.md`'s Allowed Steps table lists it unconditionally under "Not allowed in flow") and can never be added to a step list. Still written to `config.yml` (per the "suppression is a UI affordance" rule below) since a standalone `/tidy` run can independently resolve this run directory. Kept in the canonical lever count for stable numbering. |
| **Auto-fix threshold** (6) | `/test` not in the step list |
| **Review auto-apply ceiling** (7) | `/review` not in the step list |
| **Leftover routing** (5) | `/wrap-up` not in the step list |
| **Merge verification** (11) | `/wrap-up` not in the step list (the merge step never runs, so nothing reads it this run) |
| **Merge authorization** (13) | `/wrap-up` not in the step list (nothing left to authorize a merge for — same condition as lever 11) |
| **Design critique** (12) | Every record in the run is non-frontend (materialized `surface:` header is `backend`/`infra` on all — the same input Design intent (4) reads; critics never dispatch on a non-frontend diff). Still written to `config.yml` (suppression is a UI affordance) |

Always visible: **Mode** (1), **Scope-creep** (2), **Ceremony profile** (9), **Model stance** (10) — they affect every pipeline.

When suppressed, mention it once in the Suppressed footer so the user knows it was considered and dropped.

## Present the Manifesto

The template below is the **`confirm` / `hybrid` (approval-gate)** rendering — it ends with the `Approve all / Override / Cancel` `AskUserQuestion` call and waits.

<!-- when: mode=auto -->
**In default `auto` mode, render the FYI variant instead:** show the same preview + policy-levers tables, but change the heading to `### Pipeline Config (auto)`, drop the approval call entirely, and close with a single line — `→ proceeding (no approval needed) · run with \`confirm\` to review/override`. Then continue to Step 4. Do not wait for input.
<!-- /when -->

**Lever values come from the pack (#1931).** When `{run-dir}/preflight.json` reports `preflight.adoption.value.case === 1` (an adopted run directory that already carried `config.yml` — `steps-and-gates.md`'s adoption section ran `flow-preflight.js`), fill the policy-levers table's Recommended column from `preflight.levers` (`value`) and the log line's source from its `source` (`run-config` | `policy` | `default`; `ceremony-profile`'s source is `header`), and lever 1 from the pack's `mode`; do not re-resolve any lever with `resolve-policy.js`. A lever entry carrying `error` renders its Recommended cell as `unresolved` and is logged, never guessed. Adoption cases 2, 3, and 5 have no `config.yml` to read yet: they compute the levers fresh from the precedence chain and write `config.yml`, exactly as this file already describes.

```markdown
### Pipeline Config Manifesto

{Pipeline-shape preamble — one of:
  - Multi-spec: "Sequential run: 157 → 159 → 160 ({worktree | current-branch})"
  - Single-spec: "Single spec: 42 ({worktree | current-branch})"}

#### Pipeline preview

| Spec | Surface | Polish | Stories | QA | Friction note |
|---|---|---|---|---|---|
| 157 | infra | skip (design-intent:none) | skip (no UI) | skip (no stories) | — |
| 159 | infra | skip | skip | skip | — |
| 160 | web | run (design-intent:quiet) | auto-detect | skip (no stories) | — |

**Expected friction under these defaults:** {one of:
  - "none — auto runs end-to-end."
  - "occasional prompts: {synthesize from per-spec friction notes — e.g., 'review may surface HIGH findings on spec 42'}"}

#### Policy levers

I've pre-filled recommendations from project policy + sensible defaults. The Recommendation is **bold** inside the Options column so override is "spot the not-bold one."

**Canonical lever numbering** (stable across all `/flow` runs): 1=Mode, 2=Scope-creep, 3=Overlap, 4=Design intent, 5=Leftover routing, 6=Auto-fix threshold, 7=Review auto-apply ceiling, 8=Tidy aggressiveness, 9=Ceremony profile, 10=Model stance, 11=Merge verification, 12=Design critique, 13=Merge authorization. The table below shows only the levers active for this run; the **Suppressed** line below names which numbers are unselectable.

| # | Lever | Recommended | Options | Effect if approved |
|---|---|---|---|---|
| 1 | Mode | **auto** | **auto** / hybrid / interactive | Pipeline runs hands-off; failures surface via ledger / failure card |
| 2 | Scope-creep | **add-to-plan** | **add-to-plan** / stop-and-ask / drop | Files outside plan auto-added; nothing dropped silently |
| 5 | Leftover routing | **defer** | **defer** / backlog / drop | Unfinished sections → a new work record (parked), reversible at Review Console |
| 6 | Auto-fix threshold | **lint+type** | lint-only / **lint+type** / lint+type+test | Lint + type errors auto-fixed; test failures still surface |
| 7 | Review auto-apply ceiling | **{computed}** | none / low / medium | Ceiling-conditional (see Recommendation defaults below): `low` — LOW auto-applied, MED staged, HIGH prompts; `medium` — MED also auto-applies |
| 9 | Ceremony profile | **{computed}** | **fast-lane** / standard | Fast-lane trims wrap-up ceremony depth (reflect light mode, narrower skill-curation scan, doc-scan pre-check); standard runs full depth |
| 10 | Model stance | **default** | economy / **default** / max-rigor | Shifts every dispatch's resolved effort one notch (`economy` also degrades Frontier to Capable); never changes which profile a dispatch requests |
| 11 | Merge verification | **{derived}** | **merge-when-green** / wait / off | How much CI verification the run's merge waits for — derived per `_shared/policy-schema-coverage.md`'s `merge-verification` coverage block; explicit `policy.yml` value wins |
| 12 | Design critique | **{resolved}** | off / **auto** / full | Governs whether project-local craft critics run at review time (`skills/design-wrapper/critics.md`, dispatched by `review` mode Step 3.8). Read via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --run "$PIPELINE_RUN_DIR" design-critique` (JSON envelope; `source` available for the log line) when no pack exists (a fresh run); on an adopted case-1 run the `value` and `source` come from `preflight.levers`'s `design-critique` entry instead. Recommended = resolved `value`; log to `decisions.md` as `AUTO {time} — Manifesto: design-critique resolved to {value} (source: {source}). Reversibility: n/a (a policy read, not a code mutation).` |
| 13 | Merge authorization | **ask** | **ask** / pre-authorized | Pre-authorizes this run to merge itself once every HARD-GATE is green and the suite is proven — zero further clicks at the terminal Review Console. |

**Suppressed (not applicable to this run):** 3 (overlap — `/specify` not in pipeline), 4 (design intent — locked by the materialized header on all 3 records: none/none/quiet), 8 (tidy — not in default `/flow`). **Valid overrides for this run:** 1, 2, 5, 6, 7, 9, 10, 11, 12, 13.

#### Override semantics

{Override semantics: see manifesto-overrides.md — loaded on Override in confirm/hybrid}
```

**`confirm`/`hybrid` only, from here to the end of "Present the Manifesto":** immediately after presenting the Manifesto table above, read `manifesto-confirm.md` in this skill's directory for the `AskUserQuestion` call (the exact question, its three options, and the override-reply convention) and the Rendering rules for the preview. An `auto`-mode run never reaches this point — its own FYI variant above already rendered and is continuing straight to Step 4.

## Source values

| Source | Meaning |
|---|---|
| `arg` | Set by an explicit CLI argument in `$ARGUMENTS` |
| `policy` | From `.claude-tweaks/policy.yml`'s `auto-mode:` key (resolver envelope `source: "policy"`) |
| `default` | Hardcoded sensible default |
| `header` | Locked by the materialized header (`materialize.md`) — e.g. `surface:`/`design-intent:`/`ceremony:` — or the record body's `Surface:`/`Design-intent:` metadata lines (e.g., `design-intent:` set on every record in the run) |
| `preflight.json` | The pack, when adopted (#1931) |

## Recommendation defaults (when no arg and no policy)

| Lever | Default | Why |
|---|---|---|
| Mode | `auto` | User invoked `/flow auto`; only here if they did |
| Scope-creep | `add-to-plan` | Never silently drops mentioned work |
| Overlap | `companion` | Safest: never overwrite or silently extend; create a new spec |
| Design intent | `none` | No creative direction unless user opts in |
| Leftover routing | `defer` | Reversible at the Review Console |
| Auto-fix threshold | `lint+type` | Mechanical fixes only; semantic failures need judgment |
| Review auto-apply ceiling | ceiling-conditional: `medium` when the resolved `autonomy` ceiling is `unattended`, `low` otherwise (`_shared/autonomy-ceiling.md`) | Auto LOW, stage MED, prompt HIGH; an unattended run has nobody to answer staged MED, so the default raises there. Computed here, not only in `step3-routing.md` — writing it to `config.yml` resolves as `source: run-config` downstream, and a flat `low` here would make step3's ceiling branch (fires only on `source: default`) unreachable for the runs it targets |
| Tidy aggressiveness | `moderate` | Reversible git-tracked cleanups auto-apply; outward GitHub writes stage (`conservative` opts down) |
| Model stance | `default` | No effort shift or Frontier degrade; the resolver's table applies unmodified |
| Merge verification | derived (`resolve-policy.js --run "$PIPELINE_RUN_DIR" --values merge-verification`) | `_shared/policy-schema-coverage.md`'s coverage-block ladder already encodes the safe answer per repo shape — no hardcoded literal |
| Merge authorization | `ask` | Never a `policy.yml` default — only a live `confirm`/`hybrid` override sets it (`wrap-up/manifesto-authorized-merge.md`'s "Why policy.yml is excluded" section) |
| Design critique | `auto` | Critics run when the project shows design investment (`DESIGN.md`) or the record asks (`Design-intent:`); `full`/`off` opt in/out explicitly |

`ceremony-profile` (lever 9) has no row here — its source is always `header` (bundle-folded from each
record's materialized `ceremony:` field), never `arg`/`policy`/`default`: `/claude-tweaks:specify`
stamps `ceremony:*` on every record, so the header always has a value and there's nothing for a
default to fill. From `docs/superpowers/specs/2026-07-20-lifecycle-ceremony-tiering-design.md`'s
"Promoting `ceremony:` to an explicit, always-present label" — deleted `70849915`.

## Approval flow

**In default `auto` mode (FYI, no gate):** write the computed values straight to `config.yml` (same schema as below), initialize `decisions.md` with the config snapshot header, create `staged/`, then proceed to Step 4 without waiting. The `Approve all / Override / Cancel` handling below applies only to `confirm` and `hybrid` modes.

**Write mechanism (all modes, #1580):** compose all 13 lever values, then write them in **one call** — `node "${CLAUDE_PLUGIN_ROOT}/bin/set-config.js" --run "$PIPELINE_RUN_DIR" --set "mode={v},scope-creep={v},overlap={v},design-intent={v},leftover-default={v},auto-fix-threshold={v},review-auto-apply-ceiling={v},tidy-aggressiveness={v},ceremony-profile={v},model-stance={v},merge-verification={v},design-critique={v},merge-authorization={v}"` (all 13 `key=value` pairs, comma-joined, in the canonical lever order above) — never one `--key`/`--value` call per lever. The batch form validates the complete set before writing any of it, the same fail-closed posture the single-key form already has (`bin/lib/set-config/write.js`). The single-key form (`--key <lever> --value <value>`) stays available for its only remaining caller — the ceremony escape hatch's downgrade-in-place write (`wrap-up/SKILL.md` Phase 1, `review/code-mode-steps.md`); `steps-and-gates.md` case 3 also takes the batch form (its recovery writes the whole lever set, same as case 5), never 13 single-key calls. `spec:`/`created:` (the two bookkeeping keys below) are not levers — `--set`/`--key` both refuse them by design — so this step writes them itself, appending both lines to `config.yml` after the batch call. Known gap: a worktree-pinned session has no writer for these two keys and ends the run with both absent — bounded (nothing reads them today), but do not add a reader without closing it first.

**On approval (option 1):** write the chosen values to `$RUN_ROOT/.claude-tweaks/pipelines/{ISO-timestamp}-{spec-slug}/config.yml` (see Path conventions below for `$RUN_ROOT`):

```yaml
mode: auto
scope-creep: add-to-plan
overlap: companion
design-intent: none
leftover-default: defer
auto-fix-threshold: lint+type
review-auto-apply-ceiling: low   # ceiling-conditional — medium when the run's resolved autonomy ceiling is unattended (Recommendation defaults)
tidy-aggressiveness: moderate
ceremony-profile: fast-lane
model-stance: default
merge-verification: merge-when-green
design-critique: auto
merge-authorization: ask
spec: 42
created: 2026-05-15T143207
```

Suppressed levers are still written to `config.yml` with default values — suppression is a UI affordance, not a semantic skip; downstream skills always have a value to read.

Initialize `decisions.md` in the same directory with the config snapshot header (see `_shared/auto-decision-log.md`). Create the `staged/` subdirectory.

**On override (option 2) / On cancel (option 3):** `confirm`/`hybrid` only — read `manifesto-confirm.md` in this skill's directory for both branches (override parsing/validation and the `config.yml` write, cancel handling).

## Path conventions

- Run directory: `$RUN_ROOT/.claude-tweaks/pipelines/{ISO-timestamp}-{spec-slug}/` — created via
  `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --spec-slug "{spec-slug}" --create`
  (`_shared/pipeline-run-dir.md`'s Anchoring section), **never** by composing `$RUN_ROOT` from the
  current directory: `/claude-tweaks:dispatch` Step 5 enters a group's worktree *before*
  dispatching this Manifesto step, so a bare relative path here would create the run directory
  inside that worktree, destroying `config.yml`/`decisions.md`/`staged/` on a later worktree
  removal with no git history to recover (`[IL-46]`'s shape). Call the command once, before
  creating anything else, and build every later path in this section from its printed output —
  `cd`-ing into the run directory afterward for convenience is fine, resolving the *path* relative
  to cwd is not.
- `ISO-timestamp` is `YYYY-MM-DDTHHMMSS` in UTC (no colons; portable across filesystems) — per `_shared/run-dir-resolution.md`'s ISO-timestamp rule (`date -u`), cited rather than restated by mint sites
- `spec-slug` uses a single `spec-` prefix on numeric IDs to disambiguate from timestamp digits: `spec-42` (single spec), `spec-42-45-48` (multi-spec, dash-joined), or a non-numeric topic slug like `meal-planning` (no prefix needed). See `_shared/run-dir-resolution.md` for the canonical SPEC_SLUG conventions.
- Collisions never happen — each parallel agent in the same checkout gets its own run directory
- The run directory is exposed to downstream skills via `PIPELINE_RUN_DIR`
- After successful pipeline closure, `/wrap-up` moves the directory to `.claude-tweaks/pipelines/archive/`

**Manifesto is the only mid-pipeline policy stop.** After this, no skill re-asks about scope-creep, overlap, design-intent, etc. — they read `config.yml` and apply.
