---
files:
  - plugin/bin/lib/wrap-up/ledger-ownership.js
  - plugin/bin/lib/wrap-up/ledger-write.js
  - plugin/bin/lib/wrap-up/pack.js
  - plugin/bin/hooks.js
  - plugin/bin/wrap-up-engine.js
  - plugin/skills/wrap-up/SKILL.md
  - plugin/skills/wrap-up/residue-sweep.md
---

# Close Out Only This Run's Ledger

**Persona:** a maintainer closing a `/claude-tweaks:flow` run with `/claude-tweaks:wrap-up` in a worktree branched from a `main` whose `docs/plans/` still holds finished runs' committed `*-ledger.md` files, expecting the Review Console's ledger flips and cleanup's ledger deletion to touch this run's ledger and nothing else.
**Goal:** every ledger read, flip, and delete at close-out resolves to the one `docs/plans` ledger this branch owns (added or changed against the merge base, or untracked), never one inherited from `main`, and is refused rather than guessed when ownership can't be computed.
**Entry point:** `/claude-tweaks:wrap-up` Phase 3's nothing-left-behind gate, then the Review Console's `wrap-up-engine.js finish-console --approve-all` and cleanup item 2's `hooks.js delete-ledger --run "$PIPELINE_RUN_DIR"`.
**Success state:** this run's ledger rows are flipped and the file is deleted. Every inherited ledger under `docs/plans/` is byte-identical to `main`. `decisions.md` names this run's ledger path only.

## Steps

### 1. The gate re-counts this run's ledger after the residue sweep
- **URL:** `plugin/skills/wrap-up/SKILL.md` Phase 3 "Gate the read"; `node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-pack.js" --run "$PIPELINE_RUN_DIR" --print ledger --json "$PIPELINE_RUN_DIR/wrap-up-pack-ledger.json"`
- **Action:** When the pre-sweep `pack.ledger` read 0 or `ok: false`, re-run the ledger probe into its own file and read `value.files` and `value.total`. A `docs/plans/*-ledger.md` glob is not a substitute.
- **Should feel:** Like asking "what does this branch owe?" rather than "what is in the folder?". Inherited ledgers show up by name under `unattributedFiles` and are never summed.
- **Should understand:** The `--json` path keeps `wrap-up-pack.json`'s other seven probes intact for the sub-steps that still read them. An `ok: false` re-run never counts as zero items: it falls back to `_shared/ledger-format.md`'s resolution rule, so a probe failure cannot silently skip the Resolve Gate.
- **Red flags:** `wrap-up-pack.json` reduced to a ledger-only pack after the re-count. A gate skipped with "No ledger items to resolve" while this run's ledger holds rows. Another run's open items being drilled at this run's gate.

### 2. The residue sweep writes into this run's ledger, or creates one
- **URL:** `plugin/skills/wrap-up/residue-sweep.md` "Writing findings to the ledger"
- **Action:** Decide whether a ledger exists for this run from `pack.ledger`'s `value.files`. If it is empty, create this run's ledger before adding the first finding.
- **Should feel:** Routine. Findings land in a file the branch already owns.
- **Should understand:** A non-empty `unattributedFiles` alongside an empty `files` means "no ledger yet", not "a ledger exists".
- **Red flags:** Residue findings appended to a ledger committed on `main` by an earlier run.

### 3. The Review Console flips rows in this run's ledger
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-engine.js" finish-console --run-dir "$PIPELINE_RUN_DIR" --approve-all`
- **Action:** Approve the console. Step 3 of the verb resolves the ledger via `resolveLedgerPath`: `{run-dir}/ledger.md` first, otherwise the single owned `docs/plans` ledger. It then rewrites the named rows' Status and Resolution cells.
- **Should feel:** Like a single write to a known file. No `--ledger` flag is needed in the common case, even when `docs/plans/` holds a dozen older ledgers.
- **Should understand:** `ambiguous` now means the branch itself owns two or more ledgers. `unattributable` means no merge base resolved or git failed. In both cases the verb exits 1 naming the reason and steps 1-2 already landed. Pass `--ledger <path>` to proceed.
- **Red flags:** "candidate ledgers found" listing ledgers this branch never touched. A row flipped in a ledger whose `git log` shows only another run's commits.

### 4. Cleanup deletes this run's ledger and nothing else
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" delete-ledger --run "$PIPELINE_RUN_DIR"` (`plugin/skills/wrap-up/cleanup-procedures.md` item 2)
- **Action:** Run the verb after the Phase 3 gate shows zero open items. It reports `deleted ledger {path}` for the owned ledger. If the branch owns none, it reports `no ledger found … — not found`.
- **Should feel:** Safe to run unattended. In a worktree whose only ledger is inherited, it deletes nothing.
- **Should understand:** It prints `cannot attribute docs/plans ledgers to {run} (…) — pass --ledger <path> explicitly; ledger not deleted` when ownership can't be computed. An explicit `--ledger` is never ownership-filtered, only confined to the run dir or worktree.
- **Red flags:** `git status` after cleanup showing a deleted `docs/plans/*-ledger.md` that this branch never added. "not found" on a run whose own ledger is still on disk and was added on this branch.

## Origin
- Created during the build of #3566 (`resolveLedgerPath` scoped to branch-owned `docs/plans` ledgers through the ownership helper shared with the wrap-up ledger probe; wrap-up's post-sweep re-count re-runs the probe instead of globbing), run `2026-10-20T001914-record-3566`.
