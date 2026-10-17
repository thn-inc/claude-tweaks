# Wrap-Up Cleanup Procedures — execution detail

Read this file only from Phase 4's **execution step** — the one call site (of the four listed in
`cleanup-procedures.md`) that actually runs these procedures. The cleanup-planning step and the
phase-trace report checklist need only the canonical list's table in `cleanup-procedures.md`
itself; `review-console.md`'s Cleanup actions section renders that same table's rows, never this
file's procedure detail. This holds Sections A through E — the detailed procedure for cleanup list
items 3, 4, 6, 7, and 8 (items 1, 2, and 5 are simple enough to execute inline at the execution
step without a dedicated sub-procedure, per `cleanup-procedures.md`).

---

## A. Design wrapper caches (v4.5.0)

Delete the per-spec caches written by `/claude-tweaks:design-wrapper` alongside the ledger:

- `docs/plans/YYYY-MM-DD-{feature}-audit.json` — written by `review` mode; consumed by `polish`. Stale after the spec ships.
- `docs/plans/YYYY-MM-DD-{feature}-recommendations.json` — written by `survey` mode (via `/flow` pipeline summary). Used to detect declines on re-runs; obsolete once the spec is wrapped up.
- `docs/plans/YYYY-MM-DD-{feature}-declined.json` — written by `/flow` decline detection. Obsolete once the spec is wrapped up.

Resolve each path using the same date+feature prefix as the ledger filename. Glob `docs/plans/*-audit.json`, `*-recommendations.json`, and `*-declined.json` matching the spec slug as a fallback when the ledger filename is unavailable. Missing files are not errors — they mean the spec did not exercise the corresponding mode (this cache-cleanup step applies only to a run whose ledger lives at the default `docs/plans/` location per `_shared/ledger-format.md`'s Location section; a run-dir-scoped ledger has no corresponding design-wrapper caches to clean up here, since design-wrapper review/survey modes never run in that no-worktree case).

Cleanup is silent — no user prompt. The caches are pipeline state, not user-authored content. Resolves the Phase 2 carry-over open item flagged in `skills/design-wrapper/SKILL.md` (audit cache cleanup); recommendations + declined caches use the same pattern.

**Not included in this cleanup:** `.claude-tweaks/design/score-history.jsonl` — the persistent, cross-run design-score history log written by `/claude-tweaks:design-wrapper review`'s score capture (`skills/design-wrapper/modes/review.md` Step 4.5). Unlike the per-spec caches above, it is committed to git and accumulates across every spec's review run by design. Never delete, truncate, or reset it as part of wrap-up cleanup or any other skill's cleanup procedure — doing so destroys the trend this log exists to provide.

---

## B. Pipeline run directory (v4.6.0)

If a pipeline run directory exists for this work (see `_shared/run-dir-resolution.md` for the resolution order and bash snippet):

1. **Multi-spec defer check:** if `MULTISPEC_REVIEW_DEFER=1` is set, **skip this section entirely**. The parent `/flow` orchestration owns archival of the multi-spec parent dir after its consolidated Review Console completes. The per-spec subdirectory stays in place under the parent.
2. Verify the Review Console ran and applied/dismissed all staged items. Since #1130 this precondition is also code-enforced at both archival call sites — the reconcile sweep skips a run whose console was never rendered or is unresolved (decideArchive), and the archive-run verb below refuses a rendered-but-unresolved console.
3. **Mark the run terminal, if not already closed by Section C's step 3.6** — before archiving, run `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run --run "$RUN_DIR"` so close-run lifts E1 enforcement (clears the worktree assignment and marks the run clean). Idempotent: re-running it on an already-clean run (the worktree-strategy case, where Section C's step 3.6 closed it first) is a harmless no-op. E2/E3 logging for that run stops at close-run too — a terminal (clean) run is no longer resolved by the hook dispatcher, so no further events get appended. Archival (step 4) is bookkeeping that moves the directory for the audit trail — it is not the logging cutoff.
4. **Archive the run directory** — `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" archive-run --run "$RUN_DIR"`. This archives the tracked `work/` directory and moves every other entry (`config.yml`, `decisions.md`, `events.jsonl`, `staged/`, and anything else the run directory holds — the verb enumerates rather than assuming a fixed list) in one call. The verb refuses a non-terminal run (`active`/`interrupted`) — step 3's `close-run` call above is what makes this refusal unreachable in practice here, not a redundant check.
5. Skipped staged items remain in the archive; they are NOT silently dropped.

Do NOT delete the run directory outright — the auto-decision log is project history (for the user's calibration of project policy), not pipeline state.

A run directory always exists from Phase 1 onward, so this section always applies. The one residual exception is a pre-v4.6 pipeline whose run directory was never created — if none resolves, skip this section silently rather than failing the wrap-up.

---

## C. Git Worktree (worktree strategy only)

If the build used worktree git strategy, clean up the worktree directory:

### Teardown ordering invariant

Worktree removal is always the **last** action taken against a worktree — only after every
git-needing step still pending against it (branch finish/merge, push, branch delete, issue claim
release reading a materialized header from inside it) has completed, never interleaved before one.
For the worktree the session is standing in, removal is `ExitWorktree` **only**: never a raw `git
worktree remove`, and never a `cd`-then-remove compound — a `cd` out of the worktree denied by
`worktree-always` must never fall back to running `git worktree remove` from inside it, which
deletes the shell's own cwd and leaves the session with no git context. `bin/lib/hooks/pre-tool-use.js`'s
teardown gate denies that raw-command/own-cwd shape directly. Step 4 below is that removal; step
3.6 (`close-run`) MUST precede it, unchanged (`[IL-116]`). `flow/multispec-review-console.md`'s
Shared teardown and `flow/worktree-merge.md` cite this invariant rather than restating it.

1. Run `git worktree list` to find worktrees associated with this spec's feature branch.
2. **Stamp the closing-keyword carrier commit — worktree strategy, single-terminal path only.**
   **`integration-model: pr-first` (`_shared/integration-model.md`): skip this step entirely** —
   FYI: the run's PR body already carries the `Fixes #{issue}` lines
   (`_shared/pr-early-run-lifecycle.md`). Also skip it when this run is part of a
   multi-terminal-parallel dispatch destined for `flow/worktree-merge.md`'s reconciliation merge
   (the run was launched via `/claude-tweaks:flow {spec} worktree` alongside sibling terminals,
   not a solo worktree run) — that merge stamps its own `Fixes #{issue}` lines directly
   (`--no-ff`, per "Close-via-merge" in `_shared/issue-claims.md`), and a carrier commit here
   would double-stamp the closing reference. Otherwise, take the issue set from
   `{run-dir}/wrap-up-pack.json`'s `inputs.closingRecords` (Phase 3's fact pack). That field is the
   one place wrap-up decides which records a run may close (Ruling R1, `pack.js`'s
   `closingRecords`): it equals `inputs.records` when `inputs.sources.records` is `headers` or
   `worktree-headers` — a materialized header, read from the worktree's mirror of the run dir until
   the header reaches the main checkout by merge — and is empty on a `manifest`/`worktree-manifest`
   rung, whose ids include `not-run`/`failed` specs with no closing keyword to stamp. Every other
   closing-keyword reader cites this field rather than restating the rule. Only when the pack
   could not be produced (Section E's production step failed) or lacks that field, glob the
   worktree mirror instead —
   `{worktree}/.claude-tweaks/pipelines/{run-id}/work/*-spec.md`, where `{worktree}` is
   `run-state.json`'s `worktree` (else `worktreeAtClose`) and `{run-id}` is the run dir's path
   after its `.claude-tweaks/pipelines/` segment (for a per-spec dir, `{run-id}/spec-{N}`) — and
   read each match's header `record:` field:

   ```bash
   ISSUES=()
   PACK="${RUN_DIR}/wrap-up-pack.json"
   MIRROR="{worktree}/.claude-tweaks/pipelines/{run-id}"
   if [ -f "$PACK" ] && CLOSING=$(node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const c=p.inputs&&p.inputs.closingRecords;if(!Array.isArray(c))process.exit(1);console.log(c.join(" "))' "$PACK" 2>/dev/null); then
     ISSUES=($CLOSING)
   else
     for f in "${MIRROR}"/work/*-spec.md; do
       [ -e "$f" ] || continue
       ISSUES+=("$(grep -m1 '^record:' "$f" | sed 's/^record: *//')")
     done
   fi
   if [ "${#ISSUES[@]}" -gt 0 ]; then
     git commit --allow-empty -m "$(printf 'Fixes #%s\n' "${ISSUES[@]}")"
   fi
   ```

   One `Fixes #{issue}` line per resolved issue on the branch — *before* handing off to
   `/superpowers:finishing-a-development-branch`, from inside the worktree. A legacy
   spec-file-mode run (no `#N` origin, no materialized header — "pure-local", per
   `materialize.md`'s alias) has no `work/` file: the resolution above finds nothing, `$ISSUES`
   stays empty, and this step is a no-op — no carrier commit, no closing keyword, because there
   was never an issue to close. Skip the commit if one for these issues already exists on the
   branch (`git log {branch} --grep="Fixes #{issue}"` — avoids duplicate empty commits if this
   step re-runs after an interruption).

   **Why a dedicated commit, not the merge artifact** — see
   `cleanup-procedures-execution-appendix.md`'s "Step 2" section; read only if the rationale
   itself is in question, never needed to execute this step correctly.
3. **`integration-model: pr-first` (`_shared/integration-model.md`): skip this step entirely.** The
   Review Console's own terminal decision already routed the merge — `review-console.md`'s "On
   approval" step 6 ran `_shared/pr-first-merge.md` directly (or deliberately skipped it, "leave PR
   open") before this cleanup step is reached. Calling `/superpowers:finishing-a-development-branch`
   here too would re-ask a decision already made — the same improvised-third-stop pattern
   `_shared/auto-mode-contract.md` forbids, mirroring the split `flow/worktree-merge.md` and
   `flow/multispec-review-console.md`'s Shared teardown already state. Print a one-line FYI instead
   of a question — `Integration model: pr-first — merge already routed by the Review Console` (record
   #2701) — then proceed to step 4 with whichever outcome the Review Console's merge step produced.

   **`integration-model: local-merge`:** verify the feature branch reached an outcome (merged, PR
   created, discarded, or explicitly kept as-is) via `/superpowers:finishing-a-development-branch`:
   - **Already completed (merged, PR created, or discarded)** → proceed to step 4.
   - **Not yet decided** → check `_shared/local-merge-auto-finish.md`'s Precondition
     (`integration-model` resolves `local-merge` AND `{run-dir}/config.yml` exists — see
     `_shared/integration-model.md` for the resolution and `flow/manifesto.md` for why
     `config.yml`'s presence is the "not interactive" proxy). When it holds, read and follow that
     file's Procedure instead of invoking `/superpowers:finishing-a-development-branch` — it never
     presents that skill's interactive menu, and every outcome it produces is already logged per
     `_shared/auto-decision-log.md`'s canonical schema. Map its outcome onto this branch structure:
     - **`merged`** → proceed to step 4, same as "Merged, PR created, or discarded" below.
     - **`pending-review`** → a merge conflict or a failed merged-result verification — do NOT
       proceed to step 4. Skip steps 3.5, 3.6, 4, and 5 below entirely for this spec (do NOT close
       the run, do NOT remove the worktree, do NOT delete the branch) and skip Section E (issue
       claim release) — same posture as "Kept as-is" below, since the worktree and branch are
       exactly as `local-merge-auto-finish.md` left them: unmerged, unmodified, awaiting a human.
       Note in the wrap-up summary that this spec parked pending resolution of a merge conflict or
       failed post-merge verification, distinct from a deliberate keep-as-is.

     When the Precondition does not hold (an `interactive` or standalone run — no `config.yml` in
     this run's directory), run `/superpowers:finishing-a-development-branch` now (do not stop and
     ask the user to run it separately). Present the merge/PR/discard/keep-as-is options as the
     skill normally would, unmodified — step 2's carrier commit already guarantees closure
     regardless of which option is chosen, so this skill's own literal git commands need no
     adaptation. Then branch on the outcome:
     - **Merged, PR created, or discarded** → proceed to step 4.
     - **Kept as-is** → the user is deliberately continuing work in this worktree. Skip steps 3.5, 3.6, 4, and 5 below entirely for this spec (do NOT close the run, do NOT remove the worktree, do NOT delete the branch) and skip Section E (issue claim release) — the claim stays held since the work is still in progress; releasing it here would let another agent claim an issue that's still mid-work. Note in the wrap-up summary that this spec's worktree/branch/claim cleanup is deliberately incomplete, pending a future finish decision (a later re-run of `/superpowers:finishing-a-development-branch`, directly or via `/claude-tweaks:wrap-up`).
   In `current-branch` mode (no worktree, no branch finish) there is no feature branch to stamp
   — the carrier is the final wrap-up commit message instead: include the same
   `Fixes #{issue}` lines there; GitHub closes the issues when that commit reaches the default
   branch (the operative instruction lives in `execution-and-verification.md`'s commit procedure,
   since Section C is skipped when no worktree exists).
3.5. **Transitional guard — a run directory whose only copy is inside this worktree.**
   Applies only to a run directory created **before** 2026-08-07 (run-dir anchoring,
   `_shared/pipeline-run-dir.md`'s Anchoring section) — every run created after that date keeps its
   gitignored half in the main checkout already, where step 4 below cannot touch it, so this step
   is a no-op for it. For a pre-anchoring run, read
   `cleanup-procedures-execution-appendix.md`'s "Step 3.5" section and run its copy-out procedure
   now, before step 4 — skipping it there is unrecoverable data loss, `[IL-46]`'s shape. Scheduled
   for deletion 2026-11-07 regardless of remaining pre-anchoring runs (see that section's Removal
   condition); until then, check it on every run.
3.6. **Close the pipeline run — the sanctioned exit the teardown gate checks for.** If a pipeline
   run directory resolves for this work (see `_shared/run-dir-resolution.md`'s resolution order),
   run `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run --run "$RUN_DIR"` now, from inside the
   worktree, **before step 4 removes it.** This clears the run's recorded worktree assignment,
   which is exactly what `bin/lib/hooks/pre-tool-use.js`'s teardown gate (`checkTeardownGate`)
   checks before allowing an `ExitWorktree`/`git worktree remove` call — skipping this step is the
   pattern the gate exists to deny (`[IL-116]`), and its own deny message points back here as the
   fix. Skip silently if no run directory resolves (a pre-v4.6 pipeline that never created one).
4. **Before removing it**, best-effort release the worktree's port lease with the path captured
   explicitly (the CLI's own cwd-based `--path` default stops resolving once `ExitWorktree` has
   moved the session out, or the directory is gone) — release before `ExitWorktree`, not after,
   since either order is equally correct with an explicit `--path` but this is the one stated
   sequence: `node "${CLAUDE_PLUGIN_ROOT}/bin/ports.js" release --path {worktree-path}` — on
   failure, print to stderr only, never blocks teardown. Then remove the worktree. Use
   **`ExitWorktree`** (`action: "remove"`) for the worktree this
   session is standing in: the harness holds a live lock on it, so raw `git worktree remove`
   fails with exit 128 (`[IL-58]`), and `SessionStart`'s reaper never touches a live-pid lock
   either — it returns `in-use` and skips, correctly, because a session's own worktree at
   wrap-up time always has a live pid. `ExitWorktree` is the only remedy for that case.

   **A session standing in a worktree it did not create via `EnterWorktree(name=...)` this
   session** (resumed after compaction, or entered via `path=...`) has no `ExitWorktree` remedy at
   all — that tool's own scope excludes it (`#2687`). Once that worktree's branch is verifiably
   merged, run `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" reconcile` directly instead: **not**
   blocked by the worktree-isolation guard, since the guard only inspects the literal text of a
   Bash-tool call, never what a spawned subprocess does internally — `reap-merged.js`'s own `git
   worktree remove` runs via `execFileSync` inside the reconcile process (same exemption
   `scratch-worktree.md`'s `complete`-token workaround already relies on). `reap` only acts once
   the branch clears the merged-proof bar (`docs/reconcile-checks.md`) and may skip under budget
   constraints — both are "not yet," not a failed escape hatch. See
   `cleanup-procedures-execution-appendix.md`'s "Step 4" section for an unverified caveat on this
   remedy's one known edge case.

   **Prove it before passing `discard_changes: true` — a proof matching the merge shape, not a
   bare SHA match.** Under `integration-model: local-merge` (`_shared/integration-model.md`),
   merges land via `git merge --no-ff` (`_shared/local-merge-auto-finish.md`,
   `dispatch/settle-and-merge.md`, `_shared/issue-claims.md`'s "Close-via-merge") or a plain
   fast-forward — for both, run `_shared/scratch-worktree.md`'s "Tearing down" (§6) ancestry
   check, `git merge-base --is-ancestor HEAD origin/{integration-branch}`, against the branch
   this worktree's branch actually merged into, rather than a `git rev-parse HEAD` equality test
   (`[IL-45]`'s original mitigation): equality only holds after a fast-forward, while `--no-ff`
   produces a new merge commit whose SHA never equals the worktree branch's — an ancestry check
   is what proves the `--no-ff` case safe, not just the fast-forward one. **Exit 0** authorizes
   `discard_changes: true` directly, with the same one-line stated reason that file's §6 uses —
   no separate confirmation once the check has actually run and passed. **Non-zero** — stop and
   surface via `git log origin/{integration-branch}..HEAD --oneline`, same as that file's own
   non-zero branch; never override on a non-zero result.

   Under `integration-model: pr-first` (the GitHub default), every merge goes through
   `_shared/pr-first-merge.md` Step 3's `gh pr merge --squash`, so the ancestry check above can
   never pass here: a squash commit's parents never include this worktree branch's `HEAD`, by
   construction, regardless of how clean the merge was. The primary proof for this shape is a
   content-containment check against the squash commit, not a plain diff — a plain
   `git diff HEAD {merge-commit}` false-positives whenever any other PR landed on the integration
   branch between this branch's fork point and its own merge (a squash commit's tree is the
   integration branch's tree *at merge time* plus this PR's changes, not the tree at fork time),
   which is common under concurrent sessions.

   Read the PR's merge commit — `gh pr view {number} --repo {owner}/{repo} --json mergeCommit -q
   .mergeCommit.oid`, `{number}` from this run's `run-state.json` `pr.number` field. The same
   session that performed the merge already ran `pr-first-merge-post-merge.md` Step 4's
   unconditional `git fetch origin {integration-branch}` on this path, which is what makes
   `{merge-commit}`'s object locally available below — but teardown can also be reached from a
   resumed or cross-session context that never ran that fetch, so run
   `git fetch origin {integration-branch}` here too, same as `scratch-worktree.md` §6's own
   ancestry check does, before trusting `{merge-commit}` to resolve locally. **A `gh pr view`
   command failure (non-zero exit, a transient auth/network/rate-limit error) is not the same
   signal as a clean call returning no `mergeCommit`** — distinguish the two: a failed command
   means the check couldn't run at all (retry once, then stop and surface the error) and must
   never be folded into the "not merged yet" branch below. **No `mergeCommit` from a successful
   call (empty/null output — the PR isn't merged yet, e.g. `armed`/`pending-review`)** — stop
   here; do not proceed to `discard_changes: true` or step 4's removal at all. A PR that hasn't
   merged has nothing to prove containment against.

   With a merge commit in hand, run `git merge-tree --write-tree {merge-commit} HEAD` and compare
   its output to `git rev-parse {merge-commit}^{tree}`. **Equal** (and `git status --porcelain`
   also empty, confirming no uncommitted work) authorizes `discard_changes: true` the same way
   **Exit 0** does above (stated reason: "git merge-tree --write-tree {merge-commit} HEAD matches
   {merge-commit}'s own tree — HEAD's content is fully contained, nothing to lose"). **Different,
   or `git merge-tree` exits non-zero (a real conflict — containment can't be confirmed)** — stop
   and surface via `git diff HEAD {merge-commit}`, same as the ancestry check's non-zero branch;
   never override. When `gh` is unavailable (a `gh`-absent MCP sandbox) there is no `pr-first`
   proof to run at all — stop and surface that gap explicitly, the same posture
   `pr-first-merge-post-merge.md` Step 5 already takes for its own `gh`-absent case.

   `[IL-45]`'s content-diff fallback (`git diff <branch> <default-branch>` empty) still applies
   for a branch discarded without ever merging (no `run-state.json` `pr` field at all) — that
   remains the path for "never merged," never the normal `pr-first` case. Neither proof subsumes
   the other: the ancestry check only holds for `--no-ff`/fast-forward, and the merge-tree
   containment check is what `pr-first`'s squash shape actually needs.

   For a worktree this session does **not** occupy, use `teardown-run` (below) instead of a raw
   `git worktree remove` — it already checks `git worktree list --porcelain` for you and skips
   (never forces) a locked one.
5. **Steps 5-6, subsumed into one call.** For a worktree this session does not occupy, run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" teardown-run --run "$RUN_DIR" \
     --merged  # or --abandoned when the branch was discarded, not merged
   ```

   One command performs archival (idempotent if Section B already archived this run — a second
   pass is a harmless no-op), worktree removal (skip-and-report if locked, never forced), the
   local branch delete (only under `--merged`, and only when the branch isn't the integration
   branch itself), and the remote branch delete (`pr-first-merge-post-merge.md`'s `## Step 5:
   Delete the remote branch` mechanism, verbatim) — replacing what used to be 4-5 hand-assembled
   commands per run. A `worktree: registration pruned but directory still present at {path}` line
   is not a completed removal: surface the path in the report and leave the directory for manual
   removal — never retry-delete it. **Own-worktree carve-out:** never call `teardown-run` against the worktree
   the session is standing in **while it is still live** — that removal path is `ExitWorktree`
   only, per step 4 above and `[IL-58]`; `teardown-run`'s own worktree-removal step is for a
   worktree this session does not occupy. Once step 4 has already removed it, step 5.5 below
   calls a narrower form of `teardown-run` anyway, for a different reason.
5.5. **Own-worktree remote-branch delete (#3088).** Only when step 4 actually proceeded past its
   proof above and removed the worktree via `ExitWorktree` — never when step 4's proof stopped
   (no `mergeCommit`, a non-empty/differing containment check, or a non-zero ancestry check), and
   never when this spec's branch-finish outcome never reached `merged` at all. `ExitWorktree(remove)`
   in step 4 deletes the local branch along with the worktree — nothing in steps 1-4 deletes the
   remote ref. Run `teardown-run` again, narrowed to just that one step, now that nothing live
   remains for the rest of it to conflict with — but archival stays Section B's job alone (item 8
   always runs last, per `cleanup-procedures.md`'s Ordering rule, since Sections D/E and Section
   B's own archival all still need `$RUN_DIR` to resolve after this point):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" teardown-run --run "$RUN_DIR" --merged --remote-ref-only
   ```

   `--remote-ref-only` skips archival (Step 2) only — the run directory stays exactly where it
   was, for Sections D, E, and B's own archival (item 8) to still find. Its state-close step is a
   harmless idempotent re-run (step 3.6 already closed it), its worktree-removal step reports "no
   worktree recorded" (already gone), and its local-branch-delete step reports a harmless failure
   (already gone) — the step that actually matters is its remote-ref delete, which resolves the
   branch name from `run-state.json`'s `pr.branch` field even though the local branch no longer
   exists (`teardown-run.js`'s branch resolution, #3088). This narrows, not contradicts, step 5's
   own carve-out above: that carve-out is about never routing *worktree removal* through
   `teardown-run` while the worktree is still live — calling it afterward, purely for this
   leftover remote-ref cleanup, with archival suppressed, is the documented path.

If no worktree exists for this spec, skip this section silently.

---

## D. Ephemeral dev server (v4.11.0)

If `/visual-review` or `/stories` auto-started a dev server during this run (`dev-url-detection.md` "Ephemeral server start"), it recorded the PID, port, worktree root, and detach state in `{run-dir}/ephemeral-server.txt` — read whatever it currently names, per that file's liveness-handle rule, since a dispatched second call may have restarted the server and rewritten this record since it was first written.

1. **Multi-spec defer check:** if `MULTISPEC_REVIEW_DEFER=1` is set, **skip this section** — the server is shared across all specs in the run. The parent `/flow` kills it once after the consolidated Review Console (otherwise each later spec's visual review would have to restart it).
2. Read `{run-dir}/ephemeral-server.txt` (`{pid} {port} {worktree-root} detached:{yes|no}`). **Detect the platform first** (e.g. `node -p process.platform`, reading `win32`) and stop the process accordingly:
   - **win32:** stop the recorded PID with a tree kill — `taskkill /PID {pid} /T /F` — regardless of what the `detached:` field reads. On this platform the field is always `detached:no` (`dev-url-detection.md`'s Ownership rule: no detach primitive is available there), so a leader-only stop would leave a shell-spawned dev command's children running and still holding their ports; `/T` scopes the kill to the recorded PID's own descendants, never the caller's own shell, giving the same coverage the POSIX `detached:yes` group kill gives below.
   - **POSIX:** `kill {pid}` — with a port-isolation lease (#1795), the recorded port is known and the PID kill alone is sufficient; the `lsof -ti tcp:{port} | xargs kill` fallback for a stale PID is a no-lease/POSIX-only path (see `dev-url-detection.md`'s Step 0.5). When the fourth field reads `detached:yes`, also kill the process group (`kill -- -{pid}`, the negative-pid form) so a detached dev command's own children don't outlive their leader — never do this when the field reads `detached:no`, since a non-detached server shares its process group with whatever spawned it and a group kill there could take down the caller's own shell.
3. **An already-gone pid is not an error.** POSIX: `kill {pid}` failing with "no such process" means the server already stopped (a prior cleanup attempt, or the process died on its own) — log "already stopped: pid {pid}" and continue; never surface this as a cleanup failure. win32: `taskkill` reporting the PID was not found means the same thing — log "already stopped: pid {pid}" and continue. `taskkill /F` also exits non-zero on access-denied; only the not-found case is "already stopped" — any other non-zero exit (access-denied or otherwise) is a real cleanup failure and must be reported as one, never silently treated as already-stopped.
4. Confirm the port is free, then delete `ephemeral-server.txt`.

This only stops servers *this pipeline started*. A dev server the user was already running (or one on the main checkout) is never touched — it was never recorded in `ephemeral-server.txt`.

If no `ephemeral-server.txt` exists, skip this section silently (the run used an already-running server, or visual review degraded to code-only).

---

## E. Issue claim release (v5.3.0)

This spec's record is identified whenever this section runs (`SKILL.md` Phase 1 — an argument, a
branch/commit reference, or, when `skills/flow/materialize.md` wrote one, a materialized header's
`record:` field). Call that number `<n>`: the pipeline may hold `claims/issue-<n>.json` on
`claims-registry` per `_shared/issue-claims.md`. A header is not required to attempt this — a run that never went
through `/claude-tweaks:dispatch` never held a claim either: step 3's CLI exits `3` (already
released / never claimed) or `4` (held by another run) there without touching the blob. Release it
only after the branch outcome is known (item 4, Git
Worktree, completes first — the execution order of the canonical list guarantees this). Step 7's
`parked-at-shaping` value comes from `{run-dir}/wrap-up-pack.json`'s `inputs.parkedAtShaping`, which
Phase 3 read from the materialized header while the worktree still existed, so the read has no
ordering constraint of its own. A `cleanup-only` run skips Phase 3, and Phase 3's pack run can
fail: whenever `{run-dir}/wrap-up-pack.json` is absent at the start of this execution step,
produce it before item 4 removes the worktree — `node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-pack.js"
--run "$PIPELINE_RUN_DIR" --only claim` (`inputs` resolves in full whichever probe `--only` names;
`claim` is the one probe a `cleanup-only` reader consumes — `cleanup-procedures.md` item 7's
`pack.claim`).

Before any step below runs a `gh` command, run the Detection Ladder from
`_shared/forge-detection.md` (checks 1-3). Checks 1 (GitHub remote) and 3 (repo reachable) are
hard gates on either transport — there is no meaningful degraded mode when the repo itself is
unreachable; report the specific failing check and stop before attempting any release. Check 2
(`gh` installed) does **not** gate on its own: Section E is a transport-aware consumer with a
documented MCP fallback — step 4 below already routes a `gh`-absent release through the MCP
tools per `_shared/github-write-transport.md`'s conditional-write pattern (claim tombstone) and
CRUD mapping (label removal, release comment) — so per `_shared/forge-detection.md`'s own rule
("a consumer with a documented MCP fallback... proceeds via that path instead of stopping"),
`gh`-absence alone degrades to that path rather than stopping. **Decision:** this was ambiguous
before 6.69.0 widened item 7's Condition (`cleanup-procedures.md`'s table) from "materialized
header present" to "record-based work," which made a standalone `/wrap-up #N` run reach this
gate far more often — but every write this section performs already has a documented MCP
equivalent (see step 4), matching CLAUDE.md's Dependencies row (`gh`-absent env routes the same
CRUD via `_shared/github-write-transport.md`'s MCP path). A genuine hard stop occurs only when
checks 1 or 3 fail.

1. **Multi-spec defer check:** if `MULTISPEC_REVIEW_DEFER=1`, skip this section — the parent
   `/flow` releases all claims once after its consolidated Review Console and merge.
2. Map the outcome from `/superpowers:finishing-a-development-branch` to a release reason:
   merged → `merged: spec {spec}`; PR opened → `pr-opened: spec {spec}`; discarded →
   `abandoned: spec {spec}`. Set `$LINK` to the merge commit sha/URL (merged), the PR URL
   (pr-opened), or empty (abandoned). **Kept as-is has no release reason here** — per Section C
   step 3, this whole section is skipped for that outcome; the claim stays held while the work
   continues.
   In `current-branch` mode (no branch finish): the reason is `merged: spec {spec}` and
   `$LINK` is the final wrap-up commit sha — and that wrap-up commit's MESSAGE must carry the
   closing keywords (one `Fixes #{issue}` line per resolved issue; see Section C's carrier
   note). This applies per spec's own wrap-up commit in multi-spec current-branch runs.
3. **Ownership check (per `_shared/issue-claims.md`, "Release triggers") — performed by the CLI in
   step 4.** Resolve `$RUN_ID` as `basename($PIPELINE_RUN_DIR)`. Whether that value matches the
   run id `/claude-tweaks:dispatch` claimed under follows directly from dispatch minting the run
   directory itself: dispatch Step 4 mints `PIPELINE_RUN_DIR` and writes the claim's `runId` as that
   directory's own basename, then passes the same `PIPELINE_RUN_DIR` value inline on both of a
   group's Task calls — `/flow` Step 3 adopts it rather than creating a separate run directory of
   its own, so this pipeline's `$PIPELINE_RUN_DIR` **is** the directory the claim was written
   under, for a singleton. (A multi-spec bundle is the one exception this single-spec Section E does
   not itself resolve — see the callout below.) A spec reaching this point through any other path
   (a human running `/flow #{issue}` directly, or a spec merely *derived from* an issue with no
   live claim) resolves the same way. The CLI classifies the blob at `claims/issue-${ISSUE}.json`
   on `claims-registry` before touching it (`classifyClaimBlob`, per `_shared/issue-claims.md`'s
   "The lock" section), and the two outcomes that reach this step are not the same. **Absent**
   (never claimed) or a **tombstone** (already released) — nothing is held, so the CLI proceeds
   quietly to the release-and-comment path below and logs the ordinary `released claim on
   #{issue} (...) — already released or swept` line; it never writes the "held by run" line
   below. **Live or stale**, by contrast, is an actual outstanding lock — only then does a
   `runId` other than `$RUN_ID` mean a successor holds it: the CLI exits `4`, writes nothing,
   posts nothing, and appends `AUTO — skipped release of issue #{issue}: claim held by run
   {claim.runId}` to `decisions.md`; skip the remaining steps for this issue — a successor owns
   it now. **An unreadable/corrupt blob is a distinct third outcome, not folded into either of
   the two above:** the CLI exits `5` (never `4`), writes nothing, and appends `AUTO — skipped
   release of issue #{issue}: claim blob is corrupt/unreadable` to `decisions.md` — this is not a
   competing claim (there is no `holder` to report), so do not treat exit `5` the way exit `4`'s
   "a successor owns it now" is treated; a corrupt blob can never self-resolve the way a live
   holder's claim eventually expires via TTL. See `_shared/issue-claims.md`'s release
   exit-code line.

   **Multi-spec bundle callout.** This section is skipped entirely for a bundle spec under
   `MULTISPEC_REVIEW_DEFER=1` (see "Multi-spec defer behavior" in `cleanup-procedures.md`) —
   release happens once, at end-of-run, in `flow/multispec-review-console.md`'s "Shared
   teardown," which passes `--run "$MULTISPEC_PARENT_DIR"` instead: the claim dispatch wrote is
   keyed to the parent directory's basename (the identity minted for the whole group), while
   each spec's own `$PIPELINE_RUN_DIR` in that context is the `spec-{N}/` subdirectory, not the
   parent.
4. **Release in one command** — ownership check, tombstone `PUT` (sha = the
   blob's current sha from the CLI's own read), release comment, and the label removals of steps
   6-7, once per issue:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/release-claim.js" "$ISSUE" --run "$PIPELINE_RUN_DIR" \
     --reason "$REASON" ${LINK:+--link "$LINK"} --remove-in-progress ${REMOVE_GRANTS:+--remove-grants} --section "/wrap-up"
   ```

   (set `REMOVE_GRANTS=1` per step 6's rule.) The CLI wraps `gh` only — in a `gh`-absent environment
   run the same read-classify-write over the MCP tools per `_shared/github-write-transport.md`;
   the MCP path stays the documented fallback rather than a second mode of the CLI. **The grant
   removals (step 6) and `bot:in-progress`/`parked` label edits (step 7) this CLI performs are
   label writes** — on the MCP transport, `issue_write`'s labels field is a full replacement,
   not a merge (`_shared/github-write-transport.md`'s **Full-replace hazard** section): read
   current labels first (`issue_read`, `get_labels`), merge via `mergeLabelNames`
   (`bin/lib/issues/label-write.js`), and write that full array — never a single- or few-label
   array. The `gh`-CLI form (`--remove-label`/`--add-label`) needs no such merge.
5. Exit `0` = released. Exit `3` = already released or swept — a 404 from the blob write, or a
   409/422 whose fresh re-read confirms the claim is gone or now held by a successor; the CLI
   still posts the release comment so the trail records the outcome. A 409/422 is no longer
   read as "already released" on its own: under git-CAS the compare-and-swap lease is on the
   whole `claims-registry` branch tip, so an unrelated concurrent commit rejects the write too.
   Exit `1` = any other failure — including a 409/422 whose re-read shows the claim is **still
   held by this run** (nothing was released), or one whose re-read itself failed so the outcome
   could not be verified: retry the
   command once, then log and continue — TTL is the backstop, never block wrap-up. Exit `2` =
   malformed call or `gh` absent (see step 4's fallback).
6. **Remove grants** when the outcome was `merged:` or `pr-opened:`: pass `--remove-grants`, which
   strips `auto:build`, `auto:merge-pending`, and `auto:merge`, whichever are present, best-effort
   per label — reversible, each removal logged to `decisions.md` by the CLI. Omit it for issues
   released as `abandoned:` (the grant is the standing retry request); an issue carrying no
   `auto:*` label is a harmless no-op. See "Grant revocation" and the "Release triggers" table
   in `_shared/issue-claims.md`.
7. **Remove `bot:in-progress`; restore `parked` if applicable.** `--remove-in-progress` (always
   passed) removes `bot:in-progress` — best-effort, the CLI logs a warning and continues on
   failure. Then, only when the outcome reason is `abandoned: spec {spec}` (i.e. NOT
   `merged:`/`pr-opened:`) AND `{run-dir}/wrap-up-pack.json`'s `inputs.parkedAtShaping["{issue}"]`
   is `true` (the materialized header's `parked-at-shaping` field, `materialize.md`'s field for
   exactly this restore-on-abandon case — the pack resolved it from the run dir's own `work/` or the
   worktree's mirror, so this step reads no header file itself):
   restore `parked` — bootstrap the label if missing (per _shared/label-bootstrap.md, LABELS_JSON =
   [['parked', 'Deferred backlog entry, waiting on a trigger condition', '2EA44F']]), then
   `gh issue edit "$ISSUE" --add-label parked`. Skip restoration silently when the pack holds no
   `true` entry for this issue (no materialized header, or `parked-at-shaping` absent), or when the
   outcome was `merged:`/`pr-opened:` (the record shipped or is under review — it should stay
   unparked). When the pack is still absent after the preamble's production step, or lacks
   `inputs.parkedAtShaping`, do not skip silently — "could not determine" is not "not parked": log
   `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP
   --section "/wrap-up" --step "Section E" --text "condition: wrap-up-pack.json absent or lacks
   inputs.parkedAtShaping → fallback: parked restore unverified for #{issue}; /tidy Step 4.7's
   backstop re-checks" --reversibility n/a`. Best-effort — on failure, log a warning and continue;
   `/tidy` Step 4.7's backstop check catches a restoration that silently failed.
8. The CLI logs the release (or ownership skip) and every label removal to `decisions.md` (status
   `AUTO`, reason string as detail). Log the `parked` restoration yourself:
   `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO
   --section "/wrap-up" --step "Section E" --text "restored parked on #{issue}" --reversibility
   high`.

This section does not apply to conversation-based work — cleanup planning's item 7 condition (record-based work) already excludes it before Section E is ever reached.
