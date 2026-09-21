# Reconcile checks

`plugin/bin/lib/reconcile/index.js` exports `reconcile()`, the one entry point for the
`integration-model: pr-first` background convergence family — see `docs/plugin-structure.md`'s
`plugin/bin/lib/reconcile/` inventory line for what each existing check module does. This file is
the procedural counterpart: what `index.js` does with those checks, and the full "adding a new
check" registration procedure, in the same spirit as `docs/hooks.md` for `plugin/bin/hooks.js` +
`plugin/bin/lib/hooks/`.

- **Dispatch order is significant, not incidental.** `index.js` runs `mirror → red-tip → console →
  release → archive → archive-branches → remote-prune → reap`, reap deliberately last because it
  physically removes worktrees — running it earlier would make every later check's live
  `git worktree list`-derived branch lookup fail for exactly the runs `reap` just finished with.
  `red-tip` runs immediately after `mirror` so it reads the ref the shared fetch just refreshed
  instead of fetching a second time. See the ordering comment directly above the dispatch block in
  `index.js` before reordering anything.
- **`ALL_CHECKS` is the requested-subset default, not the iteration order.** `index.js`'s own
  `DISPATCH_ORDER` constant is what's actually walked; `ALL_CHECKS` only lists membership.
- **The fast/background split (#820 D8).** `bin/lib/hooks/session-start.js`'s `FAST_CHECKS`
  (`mirror`, `red-tip`, `console` — cheap read/detect, run inline on every SessionStart) and
  `bin/hooks.js`'s `BACKGROUND_CHECKS` (`release`, `archive`, `archive-branches`, `remote-prune`,
  `reap` — write-only/janitorial, run in a detached `reconcile-background` child process) must
  **partition `ALL_CHECKS` exactly** — no overlap, nothing silently dropped. A new check has to
  join one list or the other.

## Adding a new check

Concrete precedent: `archive-branches.js` was the 7th check added (#517). Grepping its own
registration footprint — `git grep -l archive-branches` — is a faster way to verify this list
against reality than trusting it in the abstract; do that for whichever check you're adding too.

1. **`bin/lib/reconcile/{check}.js`** — the check itself. Follow `release-merged.js`'s /
   `archive-branches.js`'s pattern: pure decision functions, I/O at the edges.
2. **`bin/lib/reconcile/index.js`** — add the name to `ALL_CHECKS`, insert the dispatch call at
   the correct position in `DISPATCH_ORDER` (see the ordering bullet above), and decide which side
   of the fast/background split it belongs on.
3. **`bin/lib/hooks/session-start.js`'s `FAST_CHECKS`** (cheap read/detect) **or
   `bin/hooks.js`'s `BACKGROUND_CHECKS`** (write-only/janitorial) — add the name to whichever list
   matches the decision from step 2. These two lists are asserted to partition `ALL_CHECKS`
   exactly (`tests/hooks-session-start.test.js`, `tests/bin-lib/hooks/reconcile-background.test.js`)
   — missing this step fails that assertion, not silently.
4. **`bin/hooks.js`'s `reconcile-threw` fallback** — a **hand-maintained duplicate** of
   `reconcile()`'s result shape (`{ mirror, redTip, worktrees, claims, runs, branches,
   remoteBranches, console, skipped }`), substituted only when `reconcile()` itself throws. If the
   new check populates a new top-level result key, this literal needs that key added too — an
   omission here doesn't throw or fail a lint; it just silently under-reports on the one code path
   (a genuine throw inside `reconcile()`) that almost never runs in normal testing, which is
   exactly what makes it easy to miss. This hazard has a precedent, not just a hypothetical: the
   fallback silently drifted out of sync by omitting `redTip`, and stayed that way until #1009
   (`407f6207e`) added it back. The literal is in sync with `reconcile()`'s result shape today —
   re-check it against `index.js` rather than trusting this line.
5. **`bin/lib/reconcile/format-summary.js`'s `CATEGORIES` table** — only if the check's result is
   array-shaped (like `worktrees`/`claims`/`runs`/`branches`/`remoteBranches`). Add a row so
   `bin/hooks.js reconcile`'s compact human-readable default output covers the new check's taken
   and skipped entries; the `--json` output needs no change, since it echoes the raw result object.
6. **Three shape-asserting test files:**
   - `tests/reconcile.test.js` — dispatch order, `ALL_CHECKS` membership, the `local-merge-model`
     skip list (a check with no local-merge fallback belongs in that skip line's check list).
   - `tests/console-execute.test.js` / `tests/console-execution.test.js` — only if the new check
     interacts with console execution.
   - The check's own `tests/bin-lib/reconcile/{check}.test.js`.

## Merged-proof for the two branch checks

`archive-branches.js` (local `-D`) and `prune-remote.js` (the family's one pushed `push --delete`)
both need proof that a plugin-owned branch's content already sits on the integration branch. Two
proofs exist, evaluated in order, and a branch proven by either is eligible:

1. **Cherry-equivalence** — `isCherryEquivalent` (`archive-branches.js`): every branch commit is
   patch-equivalent to one on the integration branch (`git cherry`). Covers merge commits,
   rebases, cherry-picks, and a single-commit squash.
2. **Squash provenance** — `isSquashMerged` (`squash-provenance.js`, #2252), consulted only when
   cherry says no: three conditions, all required. (a) The **confirmed** per-branch PR state is
   `MERGED` — a screen-shaped prState can never satisfy this. (b) That PR's own `mergeCommit.oid`
   appears in `git rev-list --first-parent {merge-base}..{integration}`, where `{merge-base}` is
   the branch's fork point from the integration branch — **bounded to the fork point**, never a
   full-history walk, so a rewritten/force-pushed tip that no longer carries the oid resolves to
   `false`: not-yet-proven, never falsely proven. This is what `gh pr merge --squash` (#2251)
   leaves for a multi-commit branch, whose single squash commit matches none of the branch's
   patch-ids. (c) The branch's **current tip** reproduces the squash commit's tree: recreating the
   merge via `git merge-tree --write-tree {mergeCommit^} {branch}` must yield the same tree as
   `{mergeCommit}^{tree}`. A commit pushed to the branch after the merge fails this condition even
   though (a) and (b) still hold — so the proof covers the branch as it stands today, not merely
   that a merge once happened. `merge-tree --write-tree` needs git >= 2.38; on an older git the
   call fails and the proof resolves to `false` — fail-safe, at the cost of recall on old git.
   `mergeCommit` rides only on the per-branch confirm (`resolvePrState`), not the bulk screen, so a
   squash candidate is always confirmed before its verdict is final.

**Confirm-routing symmetry (#2322).** `archive-branches.js`'s per-branch confirm — the only place
`mergeCommit` becomes available for the squash-provenance check above — is reached by any
non-cherry-equivalent branch whose bulk screen read `MERGED` *or* `null`. The `null` case is the
bulk screen's documented deleted-ref blind spot (`pr-state.js`'s header): a branch whose remote ref
`gh pr merge --delete-branch` already removed. Routing both shapes into the same confirm means a
young squash-merged branch in that blind spot converges on the first pass after its PR merges, at
the cost of one extra `gh pr list --head` call per screen-null, non-cherry-equivalent branch per
pass — the same per-branch cost the MERGED-screened routing already pays, now paid symmetrically
rather than only after the branch ages past `BRANCH_AGE_DAYS` (14 days). That recurring cost is not
confined to the deleted-ref shape: `ref()` returns `null` for a **never-pushed** branch too
(`pr-state.js`'s header lists both), so an abandoned run's purely-local `build/*` branch — the
commoner screen-null shape in a working checkout — now pays one confirm call per pass as well,
every pass until it ages out. Nothing follows from those calls: the confirm resolves `null`,
`isSquashMerged` returns `false` on a null `prState` before spawning any git, and the age rules
skip the branch `too-young` exactly as before.

Both proofs judge the **local** integration ref (`{integration}`, never `origin/{integration}`) —
the same staleness direction as `isCherryEquivalent`: fail-safe when the local ref is behind, never
a false positive from a ref this checkout hasn't fetched yet.

Reason vocabulary after #2252 — a deliberate, documented exception to #1082's "no new per-branch
reasons" pin: `prune-remote`'s skip reason `not-cherry-equivalent` is renamed `not-proven-merged`
(emitted only when **neither** proof holds), its delete reason on the squash path is
`merged-pr-squash-merged` (beside `merged-pr-cherry-equivalent`), and `archive-branches` deletes
with reason `squash-merged` (beside `cherry-equivalent`). `merged-pr-without-cherry-equivalence`
keeps its name — still literally true when neither proof holds.

## Archive skip reasons and residue pruning (#1892)

`archive-merged.js`'s `archiveRunDir` normally moves a run dir's git-tracked `work/` (or
`spec-{n}/work/`) subtree via a whole-dir `git mv` — idempotent only when the archive twin doesn't
already exist. Two additional reasons cover the split-state case (a prior pass, or a merged
worktree PR, already archived the gitignored half while the tracked headers stayed live):

- **`work-twin-conflict`** — the archive twin already holds a `work/` (or `spec-{n}/work/`) whose
  content genuinely differs from the live copy (compared file-by-file via `git hash-object`).
  Refuses the whole archival rather than guessing which copy is canonical; `result.conflict` names
  both paths and the differing relative files. An *identical* twin is not a conflict — it resolves
  automatically (`git rm` when the twin's own copy is already tracked, `git mv -f` when it isn't)
  and the archival proceeds.
- **`archived-pending-tracked-move`** — the split state itself: the archive twin exists AND the
  live run dir holds nothing but tracked `work/` headers (no gitignored entries remain).  Under
  `worktree-always: true` this sweep never commits the tracked-header move itself — it skips with
  this reason and a paste-ready `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" archive-run --run
  "<dir>"` command in `skipped[].command` instead of counting toward `move-failed` escalation.
  Without `worktree-always`, the sweep completes the move itself via `archiveRunDir`'s normal
  twin-resolution path above.

**Residue pruning.** After every `archive` pass, `cache.js`'s `pruneResidueFailures` drops any
`residueFailures` entry (reason-agnostic — `move-failed`, `structurally-stuck`, any future reason)
whose tracked path no longer exists on disk: a path can never fail or succeed there again, so it
must stop counting toward a fresh escalation streak. An entry that was already `escalated` also
gets its filed backlog record resolved — `escalate-residue.js`'s `resolveResidue` comments ("no
longer exists on disk — resolved by other means") and closes it, best-effort (a resolution failure
still drops the cache entry; the record is left for a human to close manually). Escalation itself
(`escalateResidue`) now dedups against **closed** records too, not just open ones: a marker match
that is already closed gets a comment + reopened rather than a duplicate filing — one record per
path across its whole open/closed/reopened lifetime.

**Shared per-pass `gh issue list` cache (#2505).** `findResidueDuplicate`'s `gh issue list --state
all --limit 10000` fetch is identical for every escalate/resolve call in one reconcile pass
regardless of which marker it's filtering for — `reconcile/index.js`'s `reconcile()` creates one
`issue-list-cache.js`'s `createIssueListCache()` instance per pass and threads its `runner` into
both `archiveMerged` and `reapMerged` (and, transitively, `cache.js`'s `trackResidue`/
`pruneResidueFailures`), so a pass touching N stuck dirs/paths makes at most one such call per
repo, not N. The cache is write-aware, not a naive read-through: `escalateResidue`/
`resolveResidue` write through the same runner (`issue create`/`edit`/`close`/`reopen`) and then
read back within the same pass — most visibly for the path-less `structurally-stuck` marker, where
every stuck dir in a pass converges on one consolidated record — so the cache applies each write's
effect to its own memoized array directly rather than serving a stale read. Scoped to one
`createIssueListCache()` instance's lifetime; nothing persists across passes or processes.

## `archive-merged.js`'s lifecycle classifier (#1732)

`archiveMerged()`'s main loop no longer carries five independent, interleaved detection
mechanisms as separate early-return branches. `classifyRunDir(ctx, now)` is the single function
that owns every mtime-TTL comparison (via `isStaleDir`) and the events-log recency comparison
(via `ownEventRecency`), returning `{ kind, ttlMs, evidence }` with
`kind ∈ { 'orphaned-mint', 'abandoned-interrupted', 'adhoc-superseded', 'merged',
'structurally-stuck', 'none' }` — a first-match list evaluated in that exact precedence order.
The five pre-consolidation predicates (`isOrphanedMint`, `isAbandonedInterrupted`,
`isAdHocStandaloneSuperseded`, `decideArchive`, `isStructurallyStuck`) are now thin wrappers that
call `classifyRunDir` with `ctx.kinds` scoped to their own one kind — this is what keeps a
standalone call (a unit test constructing a bare fixture dir, or `trackStuckSkip`'s own narrower
question) answering exactly what it always asked, unaffected by whether the same dir would ALSO
match some other, higher-precedence kind under the full order. Only `archiveMerged()`'s own main
loop passes the full, ordered kind set.

The `checkRunIntegrity` shipped-unclosed evidence gate for `abandoned-interrupted` stays
call-site-only, never folded into the classifier itself (folding it in would misattribute the
`explicit: true` archival path's justification) — the main loop re-classifies scoped to just
`adhoc-superseded` when that companion check fails, so a dir that superficially reads
`abandoned-interrupted` but fails the gate still falls through to the next-lower-precedence kind,
matching the pre-consolidation `&&`-chained early-return exactly.

## No-run-state.json terminal path and consolidated escalation (#1811)

Two additions beyond the branchless MERGED-by-number probe (already covered by `state.pr.number`
handling regardless of whether a worktree was ever stamped — see the by-number fallback in the
main loop, landed via #1962/#2226/#2228/#2231):

- **`isClosedSlugStuck`** — a run dir with `config.yml` but NO `run-state.json` at all (slug
  `{timestamp}-record-{n}[-{m}...]`, e.g. the shape underlying #1811's own original report) has no
  branch, no PR, and nothing the classifier or the by-number probe can resolve — it escalates at
  `structurally-stuck` forever with no path to resolution. Terminal once every record number named
  in the slug (`recordNumbersFromSlug`) independently resolves `CLOSED` via `gh issue view` (not a
  PR — `pr-state.js`'s `resolveIssueStateByNumber`) and the directory has sat past
  `STRUCTURALLY_STUCK_TTL_MS`. Fails closed (leaves the dir in place) on any unresolved record, a
  `gh-absent`/`network-failure` probe on any one of them, or a dir that DOES carry a
  `run-state.json` (however stale) — that shape belongs to the ordinary classifier/branch-resolution
  path instead.
- **Consolidated `structurally-stuck` escalation** — `escalate-residue.js` files ONE open record per
  sweep pass covering every path stuck at `structurally-stuck`, not one per directory (the exact
  symptom that produced seven near-identical records, #1811-#1817, for one underlying defect).
  `residueFingerprint('structurally-stuck', ...)` ignores the path (every other reason keeps its
  path-specific basis, unchanged), so every stuck dir's `trackResidue` call converges on the same
  marker. The record's body carries a `<!-- stuck-paths -->…<!-- /stuck-paths -->` block
  (`parseStuckPaths`/`renderStuckPathsBlock`) edited in place via `gh issue edit --body` on each new
  path (plus a comment, so both the record body and its thread reflect the addition) — never a
  second `issue create`. `cache.js`'s per-path consecutive-failure counter (`trackResidue`,
  `RESIDUE_ESCALATE_THRESHOLD`) is unchanged and reason-agnostic already; only the filing/resolving
  side consolidates. Resolving one path (`resolveResidue` under `reason: 'structurally-stuck'`)
  removes just that path from the shared record's body — the record only actually closes once every
  path it named has resolved, so fixing directory A never silently closes the record while
  directory B is still genuinely stuck.

## gh-absent preflight: accepted MCP gap (#2523)

`reconcile()` (`plugin/bin/lib/reconcile/index.js`) is a plain Node subprocess, not an agent-session
skill — it cannot reach an agent session's MCP tools, only `gh`. When `gh` is absent (a cloud
Routine sandbox with GitHub MCP tools instead of the CLI), every GitHub-dependent check —
`red-tip`, `reap`, `release`, `archive`, `archive-branches`, `remote-prune`, `console` — is skipped
via the preflight gate (`ghHealthCheck`/`ghHealthCheckAsync`, `preflight.js`), reported as
`{"skipped":[{"check":"red-tip,reap,release,archive,archive-branches,remote-prune,console","reason":"preflight-gh-absent"}]}`.
`mirror` is the one exception — pure git, no `gh` call — and keeps running.

This is an **accepted gap, not a bug to fix here**: unlike `/claude-tweaks:dispatch`'s own queue-pull
(`dispatch/mcp-transport.md`), which runs inside an agent-session skill and therefore *can* call
MCP tools directly, `reconcile()` runs as a detached background child process
(`bin/hooks.js`'s `reconcile-background`) with no agent session attached to hand it MCP access —
bridging it would mean either giving a bare Node subprocess its own MCP client (a much larger
architectural change, out of scope here) or moving these checks into an agent-session skill
entirely (changing when/how they run, not just how they reach GitHub).

**Consequence:** in a `gh`-absent sandbox, merged-PR residue (a group's worktree under
`.claude/worktrees/`, its run directory under `.claude-tweaks/pipelines/`) is never reaped or
archived automatically — it accumulates indefinitely across every `gh`-absent firing until either
`gh` becomes available in that sandbox, or a human runs `bin/hooks.js reconcile` manually from an
environment with `gh`. This is harmless (stale local state, not a correctness bug — the merged PR
and closed issue are still the source of truth on GitHub), but it is unbounded, so a project running
its scheduled Routines exclusively in `gh`-absent sandboxes should periodically reconcile from a
`gh`-present environment to bound the residue.

## Referenced by

`CLAUDE.md`'s `### Reconcile` subsection points here for anyone touching
`plugin/bin/lib/reconcile/` or `bin/hooks.js`'s `reconcile` command.
