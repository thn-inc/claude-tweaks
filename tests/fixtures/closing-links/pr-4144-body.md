<!-- claude-tweaks-run: 2026-10-24T153132-spec-3997-2724 -->
claude-tweaks-run: 2026-10-24T153132-spec-3997-2724

### Spec summary

Revised during build: #2724 was shaped at 2026-10-24T12:11Z → the body was erased by this run's own pre-worktree reconcile pass at 15:32Z (escalateStructurallyStuck, escalate-residue.js:286, rewrites the whole body via structurallyStuckBody), so materialize's shape gate refused it. Restored the shaped body from GitHub edit history with the current 25-path stuck-paths block, and added one Current State bullet, one Deliverable (in-place stuck-paths block edit on escalate and resolve, plus line-anchored STUCK_PATHS_RE) and one AC. Rationale: the defect is in a named Key File, the spec already said to fix stuck-paths merge defects here, and the record cannot stay shaped until it ships. Materialized 2f4a007e6; Deliverable 1 says the exempted ad-hoc entry resolves through resolveResidue → nothing would: trackStuckSkip returns early for a non-stuck dir and resolveResidue fires only from pruneResidueFailures once a path is gone, so the plan adds clearResidue (cache.js) called from trackStuckSkip. Second reversal: the exemption is limited to ad-hoc dirs stamped with a linked worktree — 2 of the 5 stuck ad-hoc dirs (093357, 150551) record the main checkout, which adhoc-superseded can never claim (docs/donts.md:185, #1604). Spec deviation: a non-empty body with no stuck-paths block gets the block appended instead of the full structurallyStuckBody render. Deliverable 4 explained, no code: the 19 escalated-but-unlisted cache entries (firstFailedAt ≤ 2026-09-12) escalated as per-path issues #1718–#2359 before the consolidated record existed (2026-09-21), escalated:true is sticky. Plan: docs/superpowers/plans/2026-10-24-reconcile-stuck-adhoc-exemption-2724.md (2 tasks)

Two records run in sequence on one branch. #3997: `gitEnv` in `plugin/bin/lib/staged-patch/stack-check.js` turned off git's config files but still passed environment-carried config to every engine git call (`GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n`, plus `GIT_COMMON_DIR` and `GIT_DIFF_OPTS`). It now drops them, and every staged-patch test fixture builds its env from `gitEnv()`. The record's CRLF-checkout premise did not reproduce on a real Windows runner. #2724: reconcile's escalator rewrote the whole consolidated structurally-stuck body on every pass, and it erased #2724's own shaped body (restored from edit history before materializing). Each pass now edits only the line-anchored stuck-paths block; a reopened closed record is still re-rendered in full, and a body with no block gets one appended. Linked-worktree ad-hoc dirs no longer escalate at `no-branch`/`no-worktree`/`no-pr`. Their escalated entries resolve off the record through a new `trackStuckSkip` → `clearResidue` path, because the record's `resolveResidue` route never fires for a dir that still exists. Main-checkout ad-hoc dirs stay excluded, because `adhoc-superseded` can never sweep them (#4179). The 19 unlisted escalated entries predate the 2026-09-21 consolidation (#1718–#2359, all closed). The stuck-set triage applied 1 item, filed 12 records (#4178–#4191) and dropped 56. Closing the 6 dead dirs and the reconcile pass that closes #2724 still need the main checkout (#4192), so this PR only `Refs #2724`.

### Phases

<!-- phases-start -->
[claude-tweaks-phases-start]
- [x] build
- [x] test
- [x] review
- [x] wrap-up
[claude-tweaks-phases-end]
<!-- phases-end -->

### Resume

`PIPELINE_RUN_DIR="/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-24T153132-spec-3997-2724" /claude-tweaks:flow "#3997,#2724" build`

<!-- fixes-start -->
[claude-tweaks-fixes-start]
Fixes #3997
Refs #2724 — deferred: Part B close/archive and the reconcile pass that closes #2724 via resolveResidue are pending in #4192
[claude-tweaks-fixes-end]
<!-- fixes-end -->

https://claude.ai/code/session_01K8JunuuUfG8EwkbhUSun6n


