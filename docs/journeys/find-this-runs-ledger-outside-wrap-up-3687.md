---
files:
  - plugin/skills/_shared/ledger-format.md
  - plugin/skills/ledger/SKILL.md
  - plugin/skills/review/code-mode-steps.md
  - plugin/skills/wrap-up/auto-merge-short-circuit.md
  - plugin/bin/wrap-up-pack.js
  - plugin/bin/lib/wrap-up/pack.js
  - plugin/bin/lib/wrap-up/ledger-write.js
---

# Find This Run's Ledger Outside Wrap-Up

**Persona:** a maintainer driving a `/claude-tweaks:flow` run in a worktree cut from a `main` whose `docs/plans/` still carries three finished runs' committed `*-ledger.md` files. They check the run's open items with `/claude-tweaks:ledger`, watch `/claude-tweaks:review` merge QA findings, and let an `auto:merge` record take the fast-lane short-circuit, expecting each step to see this run's ledger and nobody else's.
**Goal:** every lookup of "this run's ledger" outside `/claude-tweaks:wrap-up` resolves through the ownership-aware ledger probe, never a bare `docs/plans/*-ledger.md` glob. The glob survives only as a reader's fallback, and a step that flips or deletes rows fails closed rather than guessing.
**Entry point:** `_shared/ledger-format.md`'s Location section resolution rule: `node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-pack.js" --run "{run-dir}" --print ledger --json "{run-dir}/wrap-up-pack-ledger.json"`, then `value.files`.
**Success state:** `/ledger`, review's QA Ledger Check and the short-circuit deletion all name the same single ledger this branch created. The three inherited ledgers are listed as other runs' ledgers at most, and are byte-identical to `main` after the run merges.

## Steps

### 1. Resolve this run's ledger through the probe
- **URL:** `plugin/skills/_shared/ledger-format.md`, Location section, "Resolution rule for a caller reading 'the active ledger for this run' (#3687)"
- **Action:** Run the probe against the resolved run dir and read `value.files`. A `ledger.md` entry is relative to the run dir. A `docs/plans/{file}` entry is relative to the run's worktree.
- **Should feel:** Like one question with one answer. The inherited ledgers show up by name under `value.unattributedFiles` and are never read as this run's. When the probe returns the run-dir `ledger.md`, that key is absent, and an absent key reads as an empty list.
- **Should understand:** `{run-dir}` is the run dir just resolved, not a bare `$PIPELINE_RUN_DIR` that an inferred run leaves unset. An empty `value.files` means "no ledger yet", not "look further". The `docs/plans/*-ledger.md` glob is a reader-only fallback, used when the probe is `ok: false` or no run dir resolves. On that fallback an existing `{run-dir}/ledger.md` wins, and the glob is not consulted.
- **Red flags:** A probe called with `--run ""` (exit 2) silently dropping into the glob. A reader picking the newest `docs/plans` ledger while `value.files` names a different one, or while `{run-dir}/ledger.md` exists.

### 2. Review merges this run's QA findings, not a stranger's
- **URL:** `plugin/skills/review/code-mode-steps.md`, "QA Ledger Check"
- **Action:** After `TEST_PASSED`, read this run's open items ledger per the resolution rule and filter for `test/qa` rows.
- **Should feel:** Quiet. The findings table shows this run's QA observations only.
- **Should understand:** When no ledger exists for the spec, the check looks for the logged creation or skip line before writing its own `SKIP`. That branch is unchanged.
- **Red flags:** QA rows from a `2026-10-20-*` ledger appearing in this run's review findings.

### 3. `/claude-tweaks:ledger` labels whose ledger is whose
- **URL:** `plugin/skills/ledger/SKILL.md`, "Standalone Usage"
- **Action:** Run `/claude-tweaks:ledger` with no arguments. This run's ledger is listed first and marked as this run's; every other ledger file is listed as another run's.
- **Should feel:** Orienting. The listing answers "what does my run owe?" first.
- **Should understand:** `/claude-tweaks:ledger {feature-name}` still matches by name across every ledger, because the user is choosing. Inherited ledgers can match there, but they are labeled as other runs'.
- **Red flags:** An inherited ledger listed unlabeled, or listed as this run's.

### 4. `/claude-tweaks:ledger resolve` never resolves another run's ledger
- **URL:** `plugin/skills/ledger/SKILL.md`, "`/claude-tweaks:ledger resolve`"
- **Action:** Without a `{feature-name}` and with a run dir resolved, the gate runs against this run's ledger. If the rule finds none, it reports `No ledger found for this run`. If the probe fails, it reports the error and stops, because the gate flips rows and a writer never takes the fallback.
- **Should feel:** Safe to type in any worktree. The worst outcome is a clear "nothing here", never another run's items drilled.
- **Should understand:** With no run dir at all, it defaults to the most recent `docs/plans/*-ledger.md`. That is the rule's no-run-dir fallback, because there is no run to attribute ownership to. An explicit `{feature-name}` always wins.
- **Red flags:** The Resolve Gate drilling items from a ledger whose `git log` shows only another run's commits.

### 5. The fast-lane short-circuit deletes this run's ledger through `delete-ledger`
- **URL:** `plugin/skills/wrap-up/auto-merge-short-circuit.md`, "Ledger deletion (`cleanup-procedures.md` item 2) — before the merge (#939)"; `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" delete-ledger --run "$RUN_DIR"`
- **Action:** Before the merge, run the verb and handle its report the way `cleanup-procedures.md`'s Item 2 does. On `deleted ledger {path}`, test the path with `git -C "$WORKTREE_PATH" ls-files --error-unmatch`. Only a tracked `docs/plans/` path is `git rm`'d and committed. A gitignored run-dir `ledger.md` or an untracked `docs/plans/` file commits nothing. Under `pr-first`, push before `gh pr merge`.
- **Should feel:** The same as the attended Review Console path: one deletion mechanism, ownership-aware through `ledger-write.js`'s `resolveLedgerPath`.
- **Should understand:** Every report except `not found` leaves the ledger on disk, commits nothing and logs a `SKIP`. That includes `ambiguous`, `unattributable` and `failed to delete`. The `AUTO` deletion line goes to `decisions.md` only on a `deleted ledger` report; `not found` logs nothing. The old `ls-files "docs/plans/*-record-{n}-ledger.md"` locate step never matched a topic-slug ledger, so before this change the short-circuit silently left the run's ledger behind.
- **Red flags:** A merged short-circuit run whose squash commit still adds its own `*-ledger.md`. A deleted inherited ledger in the PR diff. A failing `git rm` on a run-dir or untracked ledger path.

## Origin
- Created during the build of #3687 (ledger readers outside wrap-up resolve this run's ledger through the ownership-aware ledger probe; writers fail closed; the auto-merge short-circuit deletes through `delete-ledger`), run `2026-10-21T181728-record-3687`. Companion to `close-out-only-this-runs-ledger-3566.md`, which covers wrap-up's own close-out path.
