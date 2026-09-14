# Common Step 1 — Worktree Setup

Runs only when the user specified `worktree` (or it's the default). Skipped entirely in `current-branch` mode.

**Skip creation when already inside an externally-created worktree.** If `MULTISPEC_SHARED_WORKTREE=1` is set, or `_shared/worktree-setup.md`'s "Adopt-or-create" gate detects the session is already isolated (its own "Already isolated" branch), a worktree for this run already exists and the pipeline is running inside it. This condition is not exclusive to multi-spec runs — `/claude-tweaks:dispatch` Step 5 creates and enters a group's worktree directly (`dispatch/sequential-execution.md`) before dispatching either Task call, for a singleton group exactly as for a bundle, so a dispatched `/flow`/`/build` invocation hits this same detection on its very first commit. **Skip steps 1-3 and 5** — do not create a nested worktree, and (multi-spec only) do not finish the branch between specs; `/flow` created the shared worktree once up front and finishes it once at the end of the multi-spec run (see `skills/flow/multi-spec.md`, "Shared worktree").

**Still run Step 4.5 (record the assignment) even on this skip path.** It is the one step in this procedure a worktree created outside it never receives on its own: `/flow`'s multi-spec up-front creation already runs this file's full procedure (including Step 4.5) when it creates the shared worktree, but `dispatch/sequential-execution.md`'s `EnterWorktree` call stamps nothing — a dispatched run arrives at this point with no `run-state.json` `worktree` field at all. Step 4.5 is documented there as "an idempotent restamp," so running it unconditionally here is always safe, never destructive to a prior stamp. Without this, the working-directory hook (E1) denies this run's very first commit — the gap #778 traced to this guard, and the retry-with-restamp workaround `dispatch/task-prompt.md` documents for a denied first commit exists only because this step was skipped instead of re-run. Step 6 (open the draft PR) is unaffected either way — it is invoked separately from `build/SKILL.md` Spec Step 1, never from within this numbered procedure (see Step 6 below).

## Base ref — branch from local HEAD, not stale origin

For why `worktree.baseRef` matters and what `fresh` vs `head` do, see
`_shared/worktree-base-ref.md` — the canonical explanation, shared with
`init/bootstrap/step-06-worktree-configuration.md`'s provisioning-time offer. Set
`worktree.baseRef: "head"` in `settings.json`. Because the plugin cannot pass
the base ref through the tool, Step 4 below **unconditionally catches the new
worktree up** with the integration branch instead of verifying the base and
stopping on a mismatch — see `_shared/worktree-setup.md`'s `## Post-creation
catch-up` for why the unconditional form is correct either way. That catch-up
protects the "worktree fell behind" direction on its own; the other direction
(local-only commits on the branch this worktree starts from, not yet on
`origin`) needs Step 0's capture below to also merge — `worktree.baseRef: fresh`
has been observed to resolve against a stale local branch ref rather than the
freshly fetched `origin/<default-branch>` its own name implies, so a caller
cannot assume which direction, if any, is stale.

## Worktree name derivation

Before Step 2 below invokes `/superpowers:using-git-worktrees` (or any caller invokes
`EnterWorktree` / `git worktree add` directly), derive the worktree name and sanitize it.
`EnterWorktree` accepts only letters, digits, dots, underscores, and dashes per `/`-segment,
≤64 chars total, and rejects anything outside that set outright — mirror it exactly, don't
approximate it (#689).

**Pattern:** `{skill}-spec-{N1}-{N2}…` for a multi-spec run (see `flow/multi-spec.md`'s "Shared
worktree" section for how `{N1}…` is assembled), or the record's own slug for a single-record
run. Either source can carry characters within a segment that `EnterWorktree` rejects — an ad
hoc `+` join, spaces, a `#` from an issue reference — so **sanitize whichever slug is derived,
every time, before it reaches `EnterWorktree`.** A `/`-separated branch-name convention (e.g.
`flow/spec-{N1}-{N2}`) is fine as-is: `/` is the valid segment delimiter, not a character to
strip (#814). Use `bin/lib/worktree/name.js`'s `sanitizeWorktreeName()`: within each
`/`-segment it maps every character outside `[A-Za-z0-9._-]` to `-`, collapses runs of `-` to
one, preserves `/` as the segment delimiter, and caps the result at 64 chars — the same rule
stated above, as one canonical, unit-tested implementation rather than three independently
re-derived regexes.

## Procedure

0. **Capture the expected base** — before creating anything, record the commit the worktree should start from:
   ```bash
   EXPECTED_BASE=$(git rev-parse HEAD)
   ```
   This is a cheap value capture only — no verification, no STOP. It exists solely to feed Step 4's `{EXPECTED_BASE}` merge; nothing here compares it against the worktree's actual base.
1. **Pre-flight branch-divergence check** — resolve the `branch-divergence-check` setting: `BRANCH_DIVERGENCE_CHECK=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values branch-divergence-check)`.

   **Skip when already stamped by `/flow` (re-read cut).** When this invocation received `MERGE_CHECK_PASSED=true UPSTREAM_SHA={sha}` from `/flow`'s Step 2.5 (per `flow/validation.md`'s "Memo stamp" note), resolve `$UPSTREAM` the same way `_shared/worktree-setup.md`'s `## Pre-flight divergence check` does and compare `git rev-parse "$UPSTREAM"` against the stamped `{sha}`. A match means `/flow` already ran this exact check moments ago in this same run — skip the fetch and the divergence prompt entirely, and proceed straight to Step 2. A mismatch (the ref moved since the stamp — rare, but possible under a slow Manifesto or materialize step) or a missing stamp (standalone `/claude-tweaks:build`, no `/flow` parent) runs the full check below — **fail-open, never fail-skip**: an absent or stale stamp is not a reason to skip the safety check, only a matching one is.

   Otherwise, run `_shared/worktree-setup.md`'s `## Pre-flight divergence check` in full — the same procedure `/flow`'s own Step 2.5 runs (`flow/validation.md`), consolidated into one canonical copy rather than two independently maintained ones.
1.5. **Stale same-name branch check** (#767) — the branch/worktree name derived in "## Worktree
   name derivation" above is deterministic per record/spec-slug, so a second consecutive attempt
   on the same record (its first attempt closed unmerged — a prior HARD-GATE stop, a closed PR, a
   manually abandoned run) reuses the *identical* name. Before invoking `EnterWorktree`, check
   whether that name is already taken locally:
   ```bash
   git worktree prune
   git branch --list "{name}"
   ```
   - **No match** — nothing to do, proceed to Step 2.
   - **Match, and `git worktree list` shows a worktree directory still attached to it** — this is
     unexpected: Step 2.8's claim (`flow/claim-targets.md`) already establishes no other live run
     holds this record, so an attached worktree here means either a claim/worktree desync or a
     worktree left behind outside the pipeline's own bookkeeping. Do not delete anything — fall
     through to Step 2 and let `EnterWorktree` surface its own "branch already exists" failure, so
     the existing **Branch already exists** row in "## If worktree creation fails" below handles it
     with a human-visible choice, rather than this check silently guessing.
   - **Match, no attached worktree** — a stale leftover from a prior closed-unmerged attempt, safe
     to remove (nothing references it, and the claim above already rules out a live sibling):
     `git branch -D "{name}"`. Log: `AUTO {time} — Stale same-name branch check: removed stale
     local branch {name} (no attached worktree) before creating a fresh one. Reversibility: high
     (the branch's commits, if any survive on a still-open remote PR for the same name, are not
     touched by this delete — only the local ref).`

   This closes the collision at its root — `EnterWorktree` never encounters the stale name — so
   neither `local-merge`'s non-force-push rejection nor `pr-first`'s branch-reuse ordering (see
   `_shared/pr-early-run-lifecycle.md`'s Step 1 note) is ever relied on as the actual protection;
   both were previously incidental side effects, not a designed safety net (#767's Current State).
1.6. **Remote-only stale branch check** (#1470) — Step 1.5's local check above only inspects this
   checkout's own git refs, so it cannot see a same-named branch that is absent here but very much
   alive on `origin` — left behind by a prior attempt on a *different* machine or sandbox, or by
   one on *this* machine whose remote ref outlived the local ref Step 1.5 just deleted.
   Runs after Step 1.5 on both of the branches that reach Step 2: its **No match** branch, and
   its **Match, no attached worktree** branch. `git branch -D` there removes only the local ref —
   Step 1.5's own log line says so — and under `integration-model: pr-first` an abandoned run has
   already pushed this name at Step 6, so a same-machine retry is a *more* common way a stale
   `origin/{name}` survives than the cross-machine case, not a rarer one. It does **not** run on
   Step 1.5's **Match, and a worktree directory still attached** branch, which that step
   deliberately routes into the "## If worktree creation fails" table instead. Probe the remote
   for the same deterministic name:
   ```bash
   git ls-remote --heads origin "{name}"
   ```
   - **Command fails** (non-zero exit — no network, no `origin` access) — fail open, the same
     convention `_shared/worktree-setup.md`'s Post-creation catch-up already applies to a
     fetch/merge failure on this same remote: log the degrade distinctly and proceed to Step 2
     rather than treating an unreachable remote as a confirmed no-match.
   - **No output, command succeeded** — nothing to do, proceed to Step 2.
   - **A ref comes back** — a remote-only collision: no local ref, no attached local worktree
     (guaranteed by the "no local match" precondition above). This is #1470's failure mode — an
     abandoned prior attempt pushed this deterministic name and was never cleaned up, and
     `EnterWorktree` would not itself catch it (no local branch conflicts, so creation succeeds;
     the collision would otherwise surface only later, as a rejected phase-exit push). Gather
     context, best-effort — a failed lookup surfaces as PR status unknown in the card below,
     distinct from a confirmed no-open-PR result:
     ```bash
     gh pr list --repo {owner}/{repo} --head "{name}" --state all --json number,url,state,isDraft
     ```
     then surface a stop card — reusing, deleting, or renaming a branch that might belong to
     someone else's still-running attempt is a shared-state change no agent is authorized to make
     unilaterally (the record's own Current State names exactly this):
     ```markdown
     ## Build: Remote-only branch collision

     `{name}` already exists on `origin` — no local ref, no attached worktree — {and has open PR
     #{number} ({url}), likely from an abandoned prior attempt | with no open PR found | PR status
     unknown (lookup failed)}.

     Options: (1) reuse the existing remote branch/PR and resume that prior attempt, (2) delete the
     stale remote branch (`git push origin --delete {name}`) and create fresh, (3) rename this
     run's branch to avoid the collision.
     ```
     **Interactive mode:** call `AskUserQuestion` with these three options, recommending (1) when
     an open PR was confirmed present (resuming existing work beats discarding it), (2) when it
     was confirmed absent, and no default recommendation when the lookup itself failed (PR status
     unknown) — deleting a branch on an unconfirmed absence risks discarding someone else's live
     work; let the human decide with that uncertainty stated plainly. **Auto
     mode:** this is not a lever `_shared/auto-mode-contract.md` lists as silenceable — Step 2.8's
     claim already rules out a *live* sibling on *this* record, but says nothing about a stale
     branch left by an unrelated record's abandoned attempt, so there is no safe default to
     auto-pick. Render the card above and **stop the build** before any worktree is created — the
     same HARD-GATE posture `flow/claim-targets.md` already uses for a claim contest.

   Together with Step 1.5 this closes both collision directions — local (#767) and remote (#1470)
   — before `EnterWorktree` ever runs, so neither depends on a failed push to surface it.
2. Invoke `/superpowers:using-git-worktrees` to create an isolated workspace — the name passed
   through it to `EnterWorktree` is the sanitized name from "## Worktree name derivation" above,
   never the raw branch/record slug
3. The skill handles: branch creation, dependency install, baseline test verification
4. **Catch up with the integration branch** — immediately after creation, before any commits, run `_shared/worktree-setup.md`'s `## Post-creation catch-up` unconditionally, passing Step 0's `{EXPECTED_BASE}` so both merges run (origin/{integration-branch} for the behind direction, `{EXPECTED_BASE}` for the ahead direction). This is the correctness net regardless of whether Step 1's divergence check ran or was skipped, and regardless of which direction (or neither, or both) `worktree.baseRef`'s actual behavior through `EnterWorktree` turned out stale. There is no separate base-ref verification-and-STOP step here anymore — the unconditional catch-up makes that moot rather than removing a safety net (the branch has no commits yet, so there is nothing either merge could destroy). Fetch/merge command failures (no network, no `origin` remote) fail open per that section's own note — don't block worktree setup on them. When either merge actually advances the branch, log it to `decisions.md` per that section's logging note.
4.5. **Record the assignment** — `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "$RUN_DIR" "$WORKTREE"` so the working-directory hook (E1) can enforce commits land in this worktree. Pass `--run "$RUN_DIR"` explicitly — resolve `$RUN_DIR` per `_shared/pipeline-run-dir.md` immediately before this command, do not rely on the command's own fallback resolver (`resolveRunDir`'s "newest non-terminal run" heuristic), which any stale never-closed run elsewhere in the project can win over this one; a Bash tool call does not inherit environment exports from an earlier, separate call, so `$RUN_DIR` must be re-resolved (or read back from wherever this run tracked it) in the same command that invokes `record-worktree`, not assumed to already be in the process environment. Either cwd works — the main checkout or the worktree. Run-dir resolution is anchored to the main checkout (`bin/lib/hooks/context.js`'s `iterRunDirsWithState`, per `_shared/pipeline-run-dir.md`'s Anchoring section), so a session inside a linked worktree resolves the same run set as one in the main checkout, and the `worktree-always` gate's one exemption permits the resulting write to `.claude-tweaks/pipelines/` from either. (Before anchoring shipped, the worktree held no `.claude-tweaks/` directory at all and resolution failed from inside it — hence the older instruction to run this from the main checkout, which is no longer needed.) On success the command prints `claude-tweaks: worktree recorded for <run-id>` to stdout (or, if `--run` is omitted or its value doesn't resolve, one of `claude-tweaks: record-worktree requires --run — worktree not recorded` / `claude-tweaks: --run path rejected: ... — worktree not recorded` — `record-worktree` never falls back to a guessed run dir, per #1124); verify that confirmation line before proceeding. The command also stamps the current session as the run's owner (from `CLAUDE_CODE_SESSION_ID`), which scopes E1 enforcement to this session — commits from other sessions in the main checkout get a warning instead of a deny. If a different session later continues this pipeline (e.g. after a session fork), re-run `record-worktree --run "$RUN_DIR"` to reclaim ownership — from either cwd, for the anchoring reason above; it is an idempotent restamp.
5. All subsequent work happens in the worktree
6. **Open the draft PR (`integration-model: pr-first` only)** — called from `build/SKILL.md`
   Spec Step 1, immediately after that step's materialize commit lands (not from within this
   numbered procedure, which ends at Step 5 — the materialize commit that must exist first is a
   Spec Step 1 concern, not a worktree-creation one). Route on `_shared/integration-model.md`;
   `local-merge` runs skip this step entirely, unchanged from today. Full procedure —
   push-then-create, the draft PR body template, idempotent resume, and degrade behavior for a
   failed push or a `gh`-absent environment — lives in `_shared/pr-early-run-lifecycle.md`; this
   step cites it rather than restating it.

## Cherry-pick source-branch PR check (#1957)

Runs later than Steps 1.5/1.6 — in Common Step 2's per-commit loop, **after each commit lands**,
since it needs a commit to inspect. Extends Step 1.6 (guards this record's own branch name) to a
second shape: a build reusing *another* record's code via `git cherry-pick` without checking
whether that record's branch backs an open PR. #1821: a build cherry-picked a commit believing
its source branch abandoned, but that branch backed a still-open, review-passed PR — two open PRs
with byte-identical implementation, caught only by an off-lens manual review.

**Trigger — narrow by design.** `git cherry-pick -x <sha>` appends a
`(cherry picked from commit <sha>)` trailer; `cherry-pick` without `-x` does not. Only that
trailer is scanned for — a git-native, zero-false-positive signal. A manual port of code (hand
copy-pasted, or cherry-picked without `-x`) leaves no such trailer and is not caught by this
check — the same accepted-gap class Step 1.6 carries for its own remote-lookup failure; don't
imply broader coverage than this mechanism gives.

**Procedure**, via `plugin/bin/lib/worktree/cherry-pick-provenance.js`'s
`checkCherryPickProvenance({ message, ownBranch, repo })` (unit-tested,
`tests/bin-lib/worktree/cherry-pick-provenance.test.js`):

1. No trailer — nothing to do (an ordinary commit is never scanned further; no overhead on the
   common case).
2. Trailer found — resolve remote branches containing `{sha}` (`git branch -r --contains {sha}`),
   excluding this record's own branch. Multiple branches can come back — check every one.
3. Lookup fails (no network/`origin`) — **fail open**, Step 1.6's own posture: log the degrade
   distinctly and proceed, never treat "unreachable" as "no other branch."
4. No other branch contains `{sha}` — nothing to do.
5. Per candidate branch, check for an open PR: `gh pr list --repo {owner}/{repo} --head "{branch}"
   --state open --json number,url,isDraft`. A per-branch failure degrades that branch distinctly
   from "confirmed no open PR."
6. No open PR anywhere — nothing to do.
7. An open PR is found — render the stop card (`formatStopCard`), naming the commit, source
   branch(es), and PR number/URL:

   ```markdown
   ## Build: Cherry-picked commit reused from another record's open-PR branch

   Commit `{sha}` carries a `(cherry picked from commit {sha})` trailer. Its source commit is
   also reachable from: `{branch}` (open PR #{number} — {url}).

   Options: (1) stop and route to the existing PR (reuse/resume that prior work instead of
   duplicating it), (2) proceed anyway, explicitly choosing to duplicate the implementation
   (record this choice in `decisions.md`).
   ```

   **Interactive mode:** `AskUserQuestion` with these two options, recommending (1).
   **Auto mode:** same posture as Step 1.6 — this is **not** a lever
   `_shared/auto-mode-contract.md` lists as silenceable (no safe default: the build can't know
   whether the other PR's author abandoned it or is still working it). Render the card and
   **stop the build** before this commit's next step — the same HARD-GATE posture
   `flow/claim-targets.md` uses for a claim contest.

**Out of scope:** a review-time Cherry-Pick Provenance Check (none exists in
`plugin/skills/review/` — this is the earliest of at most two catch points) and #1944's
specify-time near-duplicate *record* detection (duplicate issue content, not duplicate code).

## Consent prompt (v5.1.0+)

`/superpowers:using-git-worktrees` now asks the user before creating a worktree (fixes superpowers #991). In `auto` mode, the consent is **pre-authorized** — the user passed `worktree` (or it's the default for `/flow`) which is an explicit opt-in. Answer affirmatively without surfacing the prompt to the user. Log entry:

```
AUTO {time} — Common Step 1: worktree consent pre-authorized by auto mode. Worktree created at {path}.
```

In interactive mode, surface the consent prompt as the skill normally would.

## If worktree creation fails

| Failure | Recovery |
|---------|----------|
| **Superpowers not installed** | Stop. Tell the user: "Superpowers plugin required for worktree mode. Install: `/plugin install superpowers@claude-plugins-official`" — or fall back to current-branch with confirmation. |
| **Git state prevents worktree** (uncommitted changes, dirty index) | Stop. Present the git issue and suggest: `git stash` or commit first, then retry. |
| **Branch already exists** | Offer: (1) Use existing worktree, (2) Remove and recreate, (3) Fall back to current-branch. |
| **Anything else** (disk full, permissions error on the target path, corrupted `.git/worktrees` metadata, or any failure not matching a row above) | Stop. Present the actual error text verbatim — do not guess at a cause. Offer: (1) Retry, (2) Fall back to current-branch with confirmation, (3) Let the user resolve it manually and re-invoke. Never silently retry or improvise an unreviewed recovery. |
| **Step 4's catch-up fails** (`git fetch`/`git merge` error, not a merge conflict) | Fail open per `_shared/worktree-setup.md`'s Post-creation catch-up note — log distinctly and proceed. This is the one row here that does *not* stop: a connectivity failure at this step is not a reason to block worktree setup entirely, only to skip the staleness protection for this run. A genuine merge *conflict* (base and integration branch actually diverged) is not a creation failure — resolve it per `_shared/git-discipline.md`, same as any other conflict. |

## Impeccable hook consent (per-worktree)

If Impeccable's automatic design hook is enabled (`/impeccable:impeccable hooks on` — see `skills/init/bootstrap/step-11-impeccable-design-integration.md`), its consent lives in `.impeccable/config.local.json` in the **working tree**, not `.git/`. A freshly created worktree starts with the hook off even when the main checkout has it enabled — re-run `/impeccable:impeccable hooks on` inside the new worktree if you want it active there too.

This is informational only. claude-tweaks does not auto-propagate Impeccable's hook consent into new worktrees — doing so would create an ongoing dependency on Impeccable's internal config file shape for a one-time, low-cost manual step.
