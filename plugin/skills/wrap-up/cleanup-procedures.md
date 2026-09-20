# Wrap-Up Cleanup Procedures

Canonical home for the wrap-up cleanup enumeration. Loaded by `/claude-tweaks:wrap-up`'s Phase 4 — its cleanup-planning step, its phase-trace report checklist, and its execution step — and by `review-console.md` (the Cleanup actions section of the Review Console — the last of its named batch sections). All four call sites reference this list — do NOT duplicate the table inline elsewhere.

## Canonical cleanup list

Eight cleanup actions, executed in order (Phase 4's execution step) and surfaced together (cleanup planning, the phase-trace report, the Review Console). **Ordering rule, first half: pipeline run directory archival (item 8) is always last.** Items 4, 6, and 7 read or write files under `$RUN_DIR` — the worktree/carrier-commit check reads the materialized header from `${RUN_DIR}/work/`, the ephemeral-server teardown reads `${RUN_DIR}/ephemeral-server.txt`, and the issue claim release optionally reads the same materialized header again (for its `parked-at-shaping` restore sub-step only — its core release no longer requires it, see Section E) — and once the run directory is archived none of those paths resolve any more. State this as an unconditional rule, not a closed list: any future cleanup item that reads or writes `$RUN_DIR` belongs before item 8 too, not just the three named here.

| # | Cleanup | Procedure ref | Condition | Deferred under `MULTISPEC_REVIEW_DEFER=1`? |
|---|---------|---------------|-----------|--------------------------------------------|
| 1 | Execution plans | Delete ephemeral plan files in `~/.claude/plans/` related to this spec (Claude Code's own native plan-mode scratch output). `docs/superpowers/plans/*.md` retention is policy-driven — see "Item 1's plan-retention policy" below, not an unconditional rule. (Design docs `*-design.md` in `docs/superpowers/specs/` should already be gone — `/specify` deletes them. If any remain, delete now.) | record-based work | No (idempotent — leave to per-spec wrap-up) |
| 2 | Open items ledger | Delete via `/ledger`'s delete operation, only after Phase 3's ledger gate confirms zero open items | ledger exists **and** (not a multi-spec run, or this is the multi-spec run's final spec) | No (idempotent) — but see the multi-spec caveat below |
| 3 | Design wrapper caches | Section A below — delete `*-audit.json`, `*-recommendations.json`, `*-declined.json` in `docs/plans/` | design wrapper active | **Yes — defer to parent `/flow` console** |
| 4 | Git worktree | Section C below — complete feature branch (`pr-first`: already routed by the Review Console's own merge decision; `local-merge`: via `_shared/local-merge-auto-finish.md`'s no-prompt path in `auto`/`hybrid`/`confirm` mode, or `/superpowers:finishing-a-development-branch` in `interactive`/standalone), then remove worktree + delete merged branch | worktree strategy | **Yes — defer to parent `/flow` console** |
| 5 | Record lifecycle | `work-backend: github-issues`: no-op — closure is close-via-merge (items 4 and 7 stamp the carrier commit and release the claim). `work-backend: local-files`: on 100% completion (confirmed by `/claude-tweaks:review`), call `closeRecord(path)` (`bin/lib/issues/local-store.js`) on the record's file and commit — the record stays on disk as history, excluded from `queryRecords`' default results | record-based work | No (idempotent — does not interact with parent multi-spec archival either way) |
| 6 | Ephemeral dev server | Section D below — kill the auto-started dev server tracked in `{run-id}/ephemeral-server.txt` | `ephemeral-server.txt` exists | **Yes — server stays up across specs; parent `/flow` kills it once after the consolidated console** |
| 7 | Issue claim release | Section E below — release `claims/issue-{n}.json` on `claims-registry` for this spec's record. Claim facts (`state`, `reclaimable`, `via`) come from `pack.claim` in `{run-dir}/wrap-up-pack.json` (#1930); read the claim blob directly only when the pack file is absent, and treat an `ok: false` field as "claim state unknown" — release still runs its own read-before-write. | record-based work | **Yes — defer to parent `/flow` console** (release follows the merge decision; releasing before the consolidated console would let another agent grab the issue while the work sits unmerged) |
| 8 | Pipeline run directory | Section B below — archive (do not delete) to `.claude-tweaks/pipelines/archive/{run-id}/` | run dir exists | **Yes — parent `/flow` owns archival** |

The detailed procedures for items 3, 4, 6, 7, and 8 (Sections A, B, C, D, E — see each row's
Procedure ref column) live in `cleanup-procedures-execution.md` in this skill's directory, read
only by Phase 4's execution step, the one call site of the four that actually runs them —
cleanup-planning, the phase-trace report checklist, and `review-console.md`'s Cleanup actions
section all need only this table. Items 1, 2, and 5 are simple enough to execute inline at Phase 4's execution step without a dedicated sub-procedure.

**Fast path (#797).** When this run's filtered list (Condition-filtered, above) is a subset of
{2, 6, 8} — guaranteed whenever this run has no record identity, used no worktree strategy, and
is not part of a multi-spec run — read `standalone-fast-path.md` in this skill's directory
instead of `cleanup-procedures-execution.md`: items 1, 3, 4, 5, and 7 structurally can't apply
under that precondition, so the ~27 KB of Sections A/C/E covering them is never needed. Any other
filtered list reads `cleanup-procedures-execution.md` as before.

**Item 1's plan-retention policy, in one paragraph.** Resolve `superpowers-plans-retention` via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values superpowers-plans-retention` (default `keep-forever`). `keep-forever` — today's behavior, unchanged: never delete `docs/superpowers/plans/*.md`. This is this plugin's own default — consistent with, but not dependent on, ADR-0007 (`docs/decisions/0007-historical-design-doc-archive-is-periodically-pruned.md`)'s convention for *this* repo; a consuming project's own `policy.yml` is free to choose otherwise. `prune-after-wrapup` — delete *this spec's own* plan/spec file(s) under `docs/superpowers/plans/` as part of this cleanup step, scoped strictly to this build — never a bulk sweep of the whole archive, which stays a separate, deliberate maintenance action per ADR-0007. `ask` — do not delete, and do not prompt inline (the Auto-Mode Contract's "no new mid-flow stops in auto mode" rule): stage the decision as a `staged/plan-retention-{n}.md` proposal for the Wrap-Up Review Console instead.

**Item 5's two framings, in one line each.** A run under `github-issues` has no file to delete — the record's own lifecycle closes via the merge/PR/commit that carries `Fixes #{issue}` (items 4 and 7), a wrap-up-owned label/claim operation, not a file deletion. A run under `local-files` has a real file to close (there is no GitHub issue whose own closed state does this job) — `closeRecord` marks it `closed: true` in place, mirroring GitHub's closed-not-deleted semantics, then this step commits the change (a local-files record is a tracked file, unlike a GitHub issue edit).

## Multi-spec defer behavior

Under `MULTISPEC_REVIEW_DEFER=1`, Phase 4's execution step SKIPS state-changing cleanups marked "Yes" in the table above (items 3, 4, 6, 7, and 8). Those defer to `/flow`'s consolidated multi-spec Review Console at end-of-run. Items 1 and 5 still execute on every spec — they are idempotent and do not interfere with parent-orchestrated cleanup of design caches, run dirs, or worktrees.

**Item 2's multi-spec caveat.** A multi-spec run's ledger (`docs/plans/*-ledger.md` — see `_shared/ledger-format.md`'s Location section for the run-dir-scoped alternate location a no-worktree run uses instead — keyed by the shared spec-slug in its filename, e.g. `spec-888-889`) is shared across every spec in the run — later specs both read and append to it (`flow/multi-spec.md`'s pre-flight-sweep note: failures land in the *parent* ledger). Deleting it on an earlier spec's wrap-up would silently drop context a not-yet-built spec's own wrap-up still needs (its own future ledger items, and any earlier-spec item — e.g. a pre-existing test failure — whose actual owner is the run's final "finish once at the end" step, not any one spec). Check the parent run dir's `manifest.yml` the same way `residue-sweep.md` does: if any `multispec.specs[]` entry other than the current spec has `status` `pending` or `running`, this is not the final spec — skip item 2 entirely this run, leave the ledger in place, and let the final spec's wrap-up (whose own Phase 3 gate will by then see the run's complete, cross-spec item set) delete it once nothing remains.

The full list of execution's deferred-under-MULTISPEC actions:

- Item 3 (Design caches) — parent /flow owns design-cache archival across all specs
- Item 4 (Worktree removal) — parent /flow handles worktree teardown after consolidated console approves cross-spec changes
- Item 6 (Ephemeral dev server) — the auto-started server is shared across all specs in the run; parent /flow kills it once after the consolidated console (killing it per-spec would force every later spec's visual review to restart it)
- Item 7 (Issue claim release) — parent /flow releases all claims once, after the consolidated console and worktree merge decide each spec's outcome
- Item 8 (Pipeline run dir archival) — parent /flow archives the multi-spec parent dir after consolidated console

---

Sections A through E's detailed procedures live in `cleanup-procedures-execution.md` in this
skill's directory — read it only from Phase 4's execution step.
