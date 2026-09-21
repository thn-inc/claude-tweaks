# Pipeline Run Directory Resolution — Order and Bash Snippet

Extracted from `_shared/pipeline-run-dir.md` (#2019) — the ordered algorithm a call site actually
needs to locate the active run directory, without also paying for that file's remaining content
(the `resolve-run-dir` CLI's own flag reference, the Anchoring section's write-pinning/guard
detail, and the Worktree-local `--run` fallback), which none of this file's call sites cite.
`pipeline-run-dir.md` remains the canonical owner of everything around this algorithm —
`resolve-run-dir`'s flags, Anchoring, and the guard/fallback detail — cited from there, never
restated independently. This file owns the Resolution order below and the Bash snippet that
implements it; `pipeline-run-dir.md`'s own intro states this split.

## Resolution order

1. **`PIPELINE_RUN_DIR` env var** — set explicitly by `/flow` when orchestrating. Use this when present (preferred path) **only after verifying it resolves under `$RUN_ROOT`** (`_shared/pipeline-run-dir.md`'s Anchoring section — `git rev-parse --git-common-dir`, then its parent directory). An inherited value naming a directory that exists but resolves *inside* a linked worktree instead of the main checkout is stale/wrong the same way a missing directory is: treat it as unset and fall through to step 2, noting the discrepancy rather than silently adopting it. This is the adoption-time counterpart to the Anchoring section's creation-time rule — a caller can set the env var from inside a worktree just as easily as a creation site can build a path from cwd, and the failure mode (a worktree-trapped run directory a later `git worktree remove` silently destroys) is identical either way (`[IL-127]`).
2. **Most-recent matching directory** — when the env var is unset, find the most recent directory under `.claude-tweaks/pipelines/` whose `spec-slug` segment matches the current spec or topic.
3. **Record-mode materialization exception** — when neither step 1 nor step 2 resolves AND the invocation is `/claude-tweaks:build #{n}` running standalone (no `/flow` parent), create a standalone run dir at `$RUN_ROOT/.claude-tweaks/pipelines/{ISO-timestamp}-record-{n}-standalone/` via `skills/flow/materialize.md`'s own fallback, purely as artifact storage for the materialized file. `$RUN_ROOT` is the **main checkout** root resolved by `_shared/pipeline-run-dir.md`'s Anchoring section, not the current directory — a bare relative path builds the run dir inside whatever worktree happens to be cwd, which is exactly what anchoring exists to prevent. This is a mode-independent branch keyed on the invocation itself, distinct from step 4's auto-mode allowlist below: it fires regardless of mode — materialization needs somewhere to write the file whether or not `auto` is active — and `/build` is not itself on the step 4 allowlist.
4. **Standalone auto fallback** — when steps 1-3 don't resolve AND the skill is running in `auto` mode AND the skill is on the standalone-auto allowlist (`/tidy`, `/init`, `/capture`, `/claude-tweaks:dispatch`, `/claude-tweaks:backlog`, `/claude-tweaks:specify`, `/claude-tweaks:sweep`), create a standalone run dir at `$RUN_ROOT/.claude-tweaks/pipelines/{ISO-timestamp}-{skill-name}-standalone/` (same `$RUN_ROOT` as step 3, as the Bash snippet below already builds it) with `decisions.md` and `staged/`. The audit log stays on; the skill auto-resolves per project policy in `.claude-tweaks/policy.yml`. The dir is presented in a Pending Review section at the end of the skill's report (no separate Review Console — this is the bookend-end for a standalone run).

   `/claude-tweaks:wrap-up` is on this allowlist with **its own clause, not this one's**: it creates a standalone run dir in *every* mode, not only `auto`, at Phase 1, because its Review Console runs in every mode and needs somewhere to read `decisions.md` and `staged/` from. Two further differences from the clause above: it stamps `createdBy: "wrap-up-standalone"` into `run-state.json` at creation, which is what its Component-Skill Contract reads to tell a created run from an inherited one; and it renders the real Review Console rather than a Pending Review section. That stamp is **one of the two direct `run-state.json` writes at creation time in the whole plugin — the other is `/claude-tweaks:release`'s, below**: `resolve-run-dir --create` (`_shared/pipeline-run-dir.md`) may mint the directory itself — mkdir, plus `decisions.md`/`staged/` when `--standalone` names it — but it never touches `run-state.json`; `record-worktree` and `close-run` still own every later write to that file, and wrap-up applies its own stamp as a separate follow-up write after calling the command, omitting `--mode` so the command creates unconditionally rather than gating on `auto`. Wrap-up's own snippet lives in `wrap-up/SKILL.md`'s "Establish the run directory (unconditional)".

   `/claude-tweaks:release` has **its own clause too, the same shape as wrap-up's and not the `auto`-gated one above** — which is why it is absent from that allowlist parenthetical: it creates a standalone run dir in *every* mode, not only `auto`, at its Step 0, because its Step 4 console and `release-held.md` staging run in every mode and its `## /release` decisions log needs a home before the first line is written. Its Step 0 snippet therefore omits `--mode` (the `resolve-run-dir` command refuses to create outside `auto` only when `--mode` is given) and stamps `run-state.json` with `createdBy: "release-standalone"` — the second of the two direct `run-state.json` writes at creation time in the plugin, beside wrap-up's. Like wrap-up, it records inherited-vs-created once at Step 0 and never re-reads it.

   `/reflect`, `/journeys`, `/visual-review`, and `/simplify` are NOT on this allowlist — they are component skills whose own Component-Skill Contract gates auto-mode behavior on `$PIPELINE_RUN_DIR` already being set by a parent (`/build`, `/review`, `/wrap-up`, or `/flow`). None of them implement a standalone-run-dir fallback; invoked directly with no active pipeline run, they fall through to step 5 (interactive mode) like any other non-allowlisted skill.

   `/claude-tweaks:dispatch`'s `next` form is a special case: it's the headless-safe selection form a scheduled Routine fires unattended (no human present), so step 5's interactive fallback below is never a real option for it — `next` always needs a standalone run dir to resolve, which is why dispatch is on this allowlist despite not being one of the original "auto-mode skills." (Dispatch's bare and `#N` forms can run with a human present and answering prompts, but resolve their own claim/release audit trail through this same allowlisted path regardless of form — dispatch never inherits `$PIPELINE_RUN_DIR`, since it is never invoked as a pipeline component.)

   `/claude-tweaks:specify`'s `next` form is the identical special case: the headless-safe selection form a scheduled Routine fires unattended, so step 5's interactive fallback below is never a real option for it — `next` always needs a standalone run dir to resolve, to claim the record it selects, which is why specify is on this allowlist despite not being one of the original "auto-mode skills" (`specify/next-mode.md`'s Claim step). Specify's other input forms are always human-invoked and never reach this allowlisted fallback.

   `/claude-tweaks:sweep` is the orchestrator case: it is always hands-off, so step 5's interactive fallback is never a real option for it either. It mints `{ISO}-sweep-standalone/` at its own Step 0 and its three component steps (`/tidy`, `/specify`, `/backlog refine`, each passing `--source sweep`) adopt that directory via the normal resolution ladder above (step 1, the inherited `PIPELINE_RUN_DIR`) instead of minting their own — sweep is the allowlisted mint site, not each child independently.
5. **Fall back to interactive mode** — when none of steps 1-4 resolve, no policy lookup is possible and no auto-decisions are allowed. The skill MUST behave as if invoked in interactive mode for this run.

The resolved directory contains `config.yml` (Manifesto answers / policy — absent for every standalone run, `wrap-up-standalone` ones included: only the `/flow` Manifesto writes it, and a standalone run never runs one), `decisions.md` (auto-decision log), `staged/` (proposals awaiting the Review Console / Pending Review section), `run-state.json` (hook-maintained status/worktree assignment; terminal = status `clean`), and `events.jsonl` (hook-appended typed events). Full layout and lifecycle in `auto-mode-contract.md`.

`resolve-run-dir` above mirrors the snippet below; a citing skill step calls the command, not
this snippet directly. Kept here as the canonical, executable reference implementation (and
pinned verbatim by `tests/pipeline-run-dir-adoption-anchoring.test.js`) — a change to the
resolution order lands here first, then in the command (`bin/lib/hooks/run-dir-resolve.js`,
documented in `_shared/pipeline-run-dir.md`'s "Resolving it" section).

## Bash snippet (resolution)

```bash
RUN_ROOT=$(git rev-parse --git-common-dir); RUN_ROOT=$(cd "$(dirname "$RUN_ROOT")" && pwd)
RUN_DIR="${PIPELINE_RUN_DIR:-}"
if [ -n "$RUN_DIR" ]; then
  # Adoption-time anchoring check (step 1): an inherited value must resolve under $RUN_ROOT,
  # not inside whatever worktree happens to be cwd — same failure shape as an unanchored
  # creation, just caught at adopt time instead. Mismatch = treat as unset, fall through.
  REAL_RUN_DIR=$(cd "$RUN_DIR" 2>/dev/null && pwd)
  case "$REAL_RUN_DIR" in
    "$RUN_ROOT"/*) : ;;      # anchored to the main checkout — keep it
    *) RUN_DIR="" ;;         # missing, or resolves outside $RUN_ROOT (e.g. inside a worktree)
  esac
fi
if [ -z "$RUN_DIR" ]; then
  RUN_DIR=$(find "$RUN_ROOT/.claude-tweaks/pipelines/" -maxdepth 1 -type d -name "*${SPEC_SLUG}*" 2>/dev/null | sort | tail -n 1)
fi
if [ -z "$RUN_DIR" ] && [ "$MODE" = "auto" ] && [ -n "$STANDALONE_SKILL" ]; then
  # Standalone auto fallback — see resolution order step 4 (step 3, the record-mode
  # materialization exception, is /build-specific and handled separately in materialize.md)
  TS=$(date -u +%Y-%m-%dT%H%M%S)
  RUN_DIR="$RUN_ROOT/.claude-tweaks/pipelines/${TS}-${STANDALONE_SKILL}-standalone"
  mkdir -p "$RUN_DIR/staged"
  touch "$RUN_DIR/decisions.md"
fi
[ -d "$RUN_DIR" ] || RUN_DIR=""  # empty = fall back to interactive mode
```

**ISO-timestamp rule** (load-bearing — mixed timezones flip newest-first ordering): every run-directory `{ISO-timestamp}` is `YYYY-MM-DDTHHMMSS` in **UTC** — always `date -u +%Y-%m-%dT%H%M%S`, never a local-time `date`. Two concurrent sessions minting in different zones otherwise produce stamps that sort in the wrong order, and the hook fallback resolver attributes events to whichever sorts newest. Mint sites (`flow/claim-targets.md` Step 2.8, `flow/manifesto.md` Path conventions, `dispatch/SKILL.md` Step 4) cite this rule rather than restating the format.

**SPEC_SLUG conventions** (load-bearing — short numeric slugs would collide with timestamps without a prefix):
- Spec runs: pass `SPEC_SLUG="spec-42"` (with `spec-` prefix) — matches dirs like `2026-05-15T143207-spec-42` without colliding with timestamp digits.
- Multi-spec runs: pass `SPEC_SLUG="spec-42-45-48"` (single prefix, dash-joined IDs).
- Topic runs: pass `SPEC_SLUG="meal-planning"` (no prefix — non-numeric slugs don't collide).
- Last-resort: `git branch --show-current` after a worktree exists. `/flow` and `/build` create the worktree before any path-sensitive command, so this fallback is safe at the time the resolution runs.

## See also

- `_shared/pipeline-run-dir.md` — `resolve-run-dir` CLI reference, Anchoring (write-pinning, guards), the Worktree-local `--run` fallback
- `_shared/auto-mode-contract.md` — full spec (directory layout, lifecycle, archive rules)
- `_shared/auto-decision-log.md` — log entry format for `decisions.md`
