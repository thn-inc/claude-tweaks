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

Resolve each path using the same date+feature prefix as the ledger filename. Glob `docs/plans/*-audit.json`, `*-recommendations.json`, and `*-declined.json` matching the spec slug as a fallback when the ledger filename is unavailable. Missing files are not errors — they mean the spec did not exercise the corresponding mode.

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
   Skip this step entirely when this run is part of a multi-terminal-parallel dispatch destined
   for `flow/worktree-merge.md`'s reconciliation merge (the run was launched via
   `/claude-tweaks:flow {spec} worktree` alongside sibling terminals, not a solo worktree run) —
   that merge stamps its own `Fixes #{issue}` lines directly (`--no-ff`, per "Close-via-merge" in
   `_shared/issue-claims.md`), and a carrier commit here would double-stamp the closing
   reference. Otherwise, check for a materialized header — glob `${RUN_DIR}/work/*-spec.md`
   (the file `skills/flow/materialize.md` writes and never deletes) and read each match's
   header `record:` field:

   ```bash
   ISSUES=()
   for f in "${RUN_DIR}"/work/*-spec.md; do
     [ -e "$f" ] || continue
     ISSUES+=("$(grep -m1 '^record:' "$f" | sed 's/^record: *//')")
   done
   if [ "${#ISSUES[@]}" -gt 0 ]; then
     git commit --allow-empty -m "$(printf 'Fixes #%s\n' "${ISSUES[@]}")"
   fi
   ```

   One `Fixes #{issue}` line per resolved issue on the branch — *before* handing off to
   `/superpowers:finishing-a-development-branch`, from inside the worktree. A legacy
   spec-file-mode run (no `#N` origin, no materialized header — "pure-local", per
   `materialize.md`'s alias) has no `work/` file: the loop above finds nothing, `$ISSUES` stays
   empty, and this step is a no-op — no carrier commit, no closing keyword, because there was
   never an issue to close. Skip the commit if one for these issues already exists on the
   branch (`git log {branch} --grep="Fixes #{issue}"` — avoids duplicate empty commits if this
   step re-runs after an interruption).

   **Why a dedicated commit, not the merge artifact:** `/superpowers:finishing-a-development-branch`'s
   own git mechanics give the closing keyword no reliable home otherwise. Its "Merge locally"
   option runs a bare `git merge <feature-branch>` with no `--no-ff` — git fast-forwards
   silently whenever possible, producing **no merge commit at all** to carry a message into.
   Its "Push and Create PR" option pushes, then creates the PR "with the forge's tooling — its
   CLI if one is available" — for a GitHub remote, that's `gh pr create` — but nothing guarantees
   the resulting PR body carries a closing keyword. Stamping the feature branch itself sidesteps both: the keyword
   travels with the branch regardless of which of the four options gets chosen (fast-forward
   merge, non-ff merge, push+PR — even one the user creates manually afterward — or
   keep-as-is), because GitHub scans every commit that reaches the default branch, not just a
   merge commit or PR body. See "Close-via-merge" in `_shared/issue-claims.md` for the full
   contract, including the multi-terminal parallel path (`flow/worktree-merge.md`), which
   performs its own merge directly with `--no-ff` and does not need this carrier commit.
3. **`integration-model: pr-first` (`_shared/integration-model.md`): skip this step entirely.** The
   Review Console's own terminal decision already routed the merge — `review-console.md`'s "On
   approval" step 6 ran `_shared/pr-first-merge.md` directly (or deliberately skipped it, "leave PR
   open") before this cleanup step is reached. Calling `/superpowers:finishing-a-development-branch`
   here too would re-ask a decision already made — the same improvised-third-stop pattern
   `_shared/auto-mode-contract.md` forbids, mirroring the split `flow/worktree-merge.md` and
   `flow/multispec-review-console.md`'s Shared teardown already state. Proceed to step 4 with
   whichever outcome the Review Console's merge step produced.

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
   Run directories created since run-dir anchoring shipped (2026-08-07, `_shared/pipeline-run-dir.md`'s
   Anchoring section) live under the **main checkout**, so Section B step 4 can rely on the copy
   being there and removing a worktree cannot destroy it. Runs created *before* that hold their
   only copy of `config.yml`, `decisions.md`, `events.jsonl` and `staged/` inside the worktree,
   where step 4 below deletes them permanently — there is no git history to recover from, the
   same shape as `[IL-46]`. Copy them out first, from inside the worktree:

   ```bash
   # pwd -P on the WT/RUN_REAL sides: on macOS the same directory reaches you as
   # both /var/... and /private/var/..., and an unresolved prefix test silently
   # never matches — the guard then looks like a clean no-op while the state it
   # exists to save is still inside the worktree. resolve-run-dir --root-only
   # already returns a realpath'd MAIN, so it needs no separate pwd -P here.
   WT=$(cd "$(git rev-parse --show-toplevel)" && pwd -P)
   MAIN=$(node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --root-only)
   RUN_REAL=$(cd "$RUN_DIR" 2>/dev/null && pwd -P)
   case "${RUN_REAL:+$RUN_REAL/}" in
     "$WT"/*)
       DEST="$MAIN/.claude-tweaks/pipelines/$(basename "$RUN_REAL")"
       mkdir -p "$DEST"
       # Everything except `work/` — never a filename allowlist. A multi-spec run
       # nests one `spec-{n}/` directory per record, each with its own
       # decisions.md and staged/, alongside files like manifest.yml that no
       # fixed list anticipates. An allowlist copies the top-level names and
       # leaves the rest for step 4 to destroy — this guard failing silently in
       # exactly the way it exists to prevent. -mindepth/-maxdepth rather than
       # BSD's `-depth 1`, which GNU find reads as a path argument.
       find "$RUN_REAL" -mindepth 1 -maxdepth 1 ! -name work -exec cp -R {} "$DEST/" \;
       RUN_DIR="$DEST"
       ;;
   esac
   ```

   Copy the gitignored half only — **not `work/`**. Materialized headers are git-tracked and
   reach the main checkout by merge (`_shared/pipeline-run-dir.md`, Anchoring); copying them
   would leave untracked duplicates that Section B step 4's `git mv` then fails on. Re-point
   `$RUN_DIR` at the copy, as above: Sections D and E and Section B's archival all read it
   after this point. A run whose `$RUN_DIR` is empty or already outside the worktree is a
   no-op, so this is inert on every run created after anchoring shipped.

   **Removal condition** (`[IL-85]` — a compatibility path with no stated end date is never
   collected): delete this step once no live worktree still holds an un-archived pre-anchoring
   run directory. Verify by running, from the main checkout,
   `find . -path "*/.claude/worktrees/*/.claude-tweaks/pipelines/*" -maxdepth 6 -type d` and
   confirming every hit is a run whose directory also exists under the main checkout's own
   `.claude-tweaks/pipelines/`. Delete unconditionally after **2026-11-07** regardless — three
   months is longer than any worktree in this repo's history has stayed live, and a
   pre-anchoring run still sitting in a worktree by then is abandoned state, not live state.
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

   **Prove it before passing `discard_changes: true` — the ancestry check, not a bare SHA
   match.** Run `_shared/scratch-worktree.md`'s "Tearing down" (§6) ancestry check —
   `git merge-base --is-ancestor HEAD origin/{integration-branch}` — against the branch this
   worktree's branch actually merged into, rather than a `git rev-parse HEAD` equality test
   (`[IL-45]`'s original mitigation): equality only holds after a fast-forward, and this file's
   own merge procedure (`review-console.md`'s "On approval," `pr-first-merge.md` Step 3) uses
   `--no-ff`, so the integration branch's tip is a *new* merge commit whose SHA never equals the
   worktree branch's — an ancestry check is what actually proves the `--no-ff` case safe, not
   just the fast-forward one. **Exit 0** authorizes `discard_changes: true` directly, with the
   same one-line stated reason that file's §6 uses — no separate confirmation once the check has
   actually run and passed; this is what "proven, not improvised" means for this call too. **Non-zero**
   — stop and surface via `git log origin/{integration-branch}..HEAD --oneline`, same as that
   file's own non-zero branch; never override on a non-zero result. `[IL-45]`'s content-diff
   fallback (`git diff <branch> <default-branch>` empty) still applies for a branch discarded
   without ever merging (no `origin/{integration-branch}` ancestry to prove) — the ancestry check
   above is the primary proof whenever a merge actually happened, since it is strictly stronger:
   it holds for `--no-ff`, fast-forward, and squash/rebase merges alike, all of which the SHA
   equality test alone would reject.

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
   commands per run. **Own-worktree carve-out:** never call `teardown-run` against the worktree
   the session is standing in — that removal path is `ExitWorktree` only, per step 4 above and
   `[IL-58]`; `teardown-run`'s own worktree-removal step is for a worktree this session does not
   occupy.

If no worktree exists for this spec, skip this section silently.

---

## D. Ephemeral dev server (v4.11.0)

If `/visual-review` or `/stories` auto-started a dev server during this run (`dev-url-detection.md` "Ephemeral server start"), it recorded the PID, port, worktree root, and detach state in `{run-dir}/ephemeral-server.txt` — read whatever it currently names, per that file's liveness-handle rule, since a dispatched second call may have restarted the server and rewritten this record since it was first written.

1. **Multi-spec defer check:** if `MULTISPEC_REVIEW_DEFER=1` is set, **skip this section** — the server is shared across all specs in the run. The parent `/flow` kills it once after the consolidated Review Console (otherwise each later spec's visual review would have to restart it).
2. Read `{run-dir}/ephemeral-server.txt` (`{pid} {port} {worktree-root} detached:{yes|no}`). Stop the process: `kill {pid}` — with a port-isolation lease (#1795), the recorded port is known and the PID kill alone is sufficient; the `lsof -ti tcp:{port} | xargs kill` fallback for a stale PID is a no-lease/POSIX-only path (see `dev-url-detection.md`'s Step 0.5). When the fourth field reads `detached:yes`, also kill the process group (`kill -- -{pid}`, the negative-pid form) so a detached dev command's own children don't outlive their leader — never do this when the field reads `detached:no`, since a non-detached server shares its process group with whatever spawned it and a group kill there could take down the caller's own shell.
3. **An already-gone pid is not an error.** `kill {pid}` failing with "no such process" means the server already stopped (a prior cleanup attempt, or the process died on its own) — log "already stopped: pid {pid}" and continue; never surface this as a cleanup failure.
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
Worktree, completes first — the execution order of the canonical list guarantees this):

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
   the MCP path stays the documented fallback rather than a second mode of the CLI.
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
   `merged:`/`pr-opened:`) AND the materialized header (`${RUN_DIR}/work/*-spec.md` — read
   directly; per the step above, the file is never deleted before this point) carries
   `parked-at-shaping: true` (`materialize.md`'s field for exactly this restore-on-abandon case):
   restore `parked` — bootstrap the label if missing (per _shared/label-bootstrap.md, LABELS_JSON =
   [['parked', 'Deferred backlog entry, waiting on a trigger condition']]), then
   `gh issue edit "$ISSUE" --add-label parked`. Skip restoration silently when no materialized
   header exists or `parked-at-shaping` is absent, or when the outcome was `merged:`/`pr-opened:`
   (the record shipped or is under review — it should stay unparked). Best-effort — on failure, log
   a warning and continue; `/tidy` Step 4.7's backstop check catches a restoration that silently
   failed.
8. The CLI logs the release (or ownership skip) and every label removal to `decisions.md` (status
   `AUTO`, reason string as detail). Log the `parked` restoration yourself:
   `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO
   --section "/wrap-up" --step "Section E" --text "restored parked on #{issue}" --reversibility
   high`.

This section does not apply to conversation-based work — cleanup planning's item 7 condition (record-based work) already excludes it before Section E is ever reached.
