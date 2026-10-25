# Multi-Spec Batch Reflect + Registry Curation

`MULTISPEC_REVIEW_DEFER=1` already batches `/wrap-up`'s Phase 4 (Review Console) across a multi-spec run — see `multispec-review-console.md`. This file covers the equivalent batching for `/wrap-up`'s Phase 1 (Reflect) and Phase 2 (registry curation, the 8-row engine), gated by a separate flag: `MULTISPEC_CURATION_DEFER=1`. Both flags are set under the identical condition (multi-spec run, `auto`/`hybrid` mode — see `multi-spec.md`'s per-spec env-var table) and typically travel together, but they gate independent steps, so a run could in principle set one without the other; this file assumes the common case where both are set.

Without this batching, a multi-spec run on a shared worktree re-runs full-mode reflect and the full 8-row registry independently for every spec — redundant when specs share files and conventions, since the same skill file and the same conventions get re-examined once per spec instead of once for the whole batch.

## When the per-spec gates fire

- `wrap-up/SKILL.md`'s Phase 1 Reflect subsection: when `MULTISPEC_CURATION_DEFER=1`, skip `/claude-tweaks:reflect` for this spec entirely — no per-spec insight set, no per-spec ledger write for this step.
- `wrap-up/SKILL.md`'s Phase 2 Run the engine subsection: when `MULTISPEC_CURATION_DEFER=1`, skip the per-spec `plan`/`record`/`render` sequence entirely — no `spec-{N}/engine-state.json` is created.

Each spec's wrap-up proceeds straight through Phases 3-4 as normal (leftover routing, the nothing-left-behind gate, cleanup planning) — only Phases 1-2 are deferred.

## When to run the batch pass

Identical trigger to `multispec-review-console.md`'s "When to run the consolidated console": after every spec's pipeline reaches `/wrap-up`'s Phase 4 execution step (or the run aborts at a HARD-GATE failure) AND the multi-spec run is in `auto` or `hybrid` mode. Re-entry via `review-console` runs this pass first when the parent holds no `engine-state.json`. Run this batch pass **before** the consolidated console (below) — its findings need to be in `decisions.md`/`staged/` before the console reads them.

If the run aborted early (one spec hit a HARD-GATE, no `keep-going`), still run the batch pass against whatever specs completed — mirroring how the consolidated console already renders on partial completion with a Not-run footer.

The shared open-items ledger is still on disk when this pass runs: `wrap-up/cleanup-procedures.md` item 2 defers its multi-spec deletion to `multispec-review-console.md`'s Shared teardown step 0, after this pass and the consolidated console (#3420).

**Batch ceremony (#3595).** A spec's Ceremony escape hatch (`wrap-up/SKILL.md`) downgrades its own spec-level `config.yml` only, so the run-level value stops being uniform once one spec downgraded. The batch pass covers every spec's diff, the downgraded one included: it runs at `standard` when any `spec-{N}/config.yml` reads `ceremony-profile: standard`, and at the parent `config.yml`'s value only when no spec downgraded.

## Batch-scope reflect pass

Run once, against the union of every completed spec's changed files:

1. **Scope** — `git diff --name-only` from `$(git merge-base --end-of-options HEAD "origin/{integration-branch}")` to the current worktree `HEAD`, `{integration-branch}` per `skills/_shared/integration-branch.md`'s ladder (covers every completed spec's commits on the shared branch — see `multi-spec.md`'s "Shared worktree" section for why one branch accumulates every spec). The merge-base equals `manifest.yml`'s `baseSha` when no boundary freshness merge (`multispec-freshness.md`) landed, and correctly excludes merged-in upstream commits when one did.
2. **Ledger phase** — `wrap-up` (same phase tag the per-spec call would have used).
3. **Seed context** — the aggregated Key Learnings sections from every completed spec's `/claude-tweaks:review` summary, concatenated in spec execution order.
4. **`--source wrap-up`** — same as the per-spec call.
5. **Mode** — the batch ceremony above: `light` under `fast-lane`, `full` otherwise.

If any insight is "Implement now", the reflect skill handles it before returning control here, same as the per-spec path. The surviving insight set feeds the batch registry pass's `--signals` below — the same six-signal classification `wrap-up/SKILL.md`'s Phase 2 documents, applied once over this batch-scope insight set instead of once per spec.

## Batch-scope registry pass

Run once, against the **parent** run directory — never any `spec-{N}/` — so its `engine-state.json` and row records can't collide with (or be silently skipped by) any per-spec engine state:

Resolve its two values first, each as its own plain call (the worktree guard refuses `git` inside `$(...)`, `_shared/scratch-worktree.md` §7), and paste each literally into the next. `{integration-branch}` is what the first call prints or, when it prints nothing, what the second prints minus its `origin/` prefix — deliberately no `@{upstream}` fallback: inside the shared worktree it names the run's own pushed branch, so a merge-base against it is ≈ `HEAD` and the batch diff comes out empty:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values integration-branch
```

```bash
git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null
```

`{merge-base}` is what this prints:

```bash
git merge-base --end-of-options HEAD "origin/{integration-branch}"
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-engine.js" plan --run-dir "$MULTISPEC_PARENT_DIR" \
  --base "{merge-base}" \
  --ceremony "{batch ceremony}" --signals '{...}'
```

Then the same `record` (once per open row) / `render --section trace` sequence `curation-engine.md` documents for the single-spec path — this file doesn't restate that mechanics, only the scope difference (parent dir, batch `--base`, batch `--signals`). Ordering is load-bearing exactly as it is per-spec: Memory and Upstream feedback rows are judged last, since their input is "learnings no earlier row claimed" — this holds across the aggregated batch signal set, not per-spec.

**Shadow sweep after the batch fan-out.** The batch judges run inside the shared worktree, so `curation-engine.md` §4's post-fan-out shadow sweep runs here too — once against the parent run dir and once per `spec-{N}/` subdirectory a judge may have been handed (the registry pass itself stays parent-only — the per-spec sweeps clean up the *earlier* per-spec fan-outs) — before this file's `record` calls and before `multispec-review-console.md`'s step 2 reads any `staged/`. A judge that wrote its proposal to the worktree's relative shadow of `.claude-tweaks/pipelines/…/staged/` (observed in run 2026-08-16T164927's Skills judge, which then misreported sibling specs' staged files as dangling) is caught and relocated by that sweep as routine, not by chance inspection; its payload's `stagePath` is required to be the absolute anchored path per `curation-engine.md` §3, verified by the judge with `test -f`. `curation-engine.md` §4's serial-commit pass runs next, after the shadow sweep and still before this file's `record` calls, so every `"action": "applied"` finding from this batch fan-out is committed before the registry pass records it.

The result is a single `$MULTISPEC_PARENT_DIR/engine-state.json`, alongside the parent's own `decisions.md`/`staged/` (already created by the Manifesto at run start).

## Feeding the consolidated console

`multispec-review-console.md`'s step 3 engine call already aggregates every `spec-{N}/engine-state.json` via one `--spec-state {id}={path}` flag per spec. When this batch pass ran, add one more flag for the parent's own state:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-engine.js" render --section console \
  --spec-state {id1}={path1} --spec-state {id2}={path2} [...] \
  --spec-state batch="$MULTISPEC_PARENT_DIR/engine-state.json" \
  --start-at {n} [--strict]
```

`id` `batch` is reserved for this row — no per-spec id ever collides with it, since spec ids are numeric record ids. The engine treats every `--spec-state` id as an opaque aggregation label, so the batch findings render inside the same five engine-fed sections (Skill updates, Documentation updates, Journey updates, Configuration updates, Reference repairs) as any per-spec finding would — no new section, no new heading, no second `AskUserQuestion` approval gate. `multispec-review-console.md`'s "Numbering rules" global sequence is unaffected: the batch row's findings are numbered into the same single sequence, in whatever position the engine's own render naturally places them (it has no per-spec/per-batch distinction in its output ordering).

The batch-scope reflect pass's own insights (the ones that aren't "Implement now" and don't feed a registry signal — e.g. Surprises, Approach narrative) render in the console's prose-aggregated sections exactly as a per-spec reflect pass's insights would, sourced from the parent's `decisions.md`/`staged/` alongside every spec's own.

## Single-spec and interactive-mode runs are unaffected

`MULTISPEC_CURATION_DEFER` is only ever set under the same condition `MULTISPEC_REVIEW_DEFER` is (multi-spec run, `auto`/`hybrid` mode — `multi-spec.md`'s env-var table). A single-spec `/flow` run never sets it, so Phase 1's reflect step and Phase 2's registry engine both run per-run exactly as documented in `wrap-up/SKILL.md`. A multi-spec run in `interactive` mode never sets it either — per-spec reflect and registry curation run inline, matching how `interactive` mode already opts out of `MULTISPEC_REVIEW_DEFER`'s per-spec console skip.
