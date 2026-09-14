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

## Referenced by

`CLAUDE.md`'s `### Reconcile` subsection points here for anyone touching
`plugin/bin/lib/reconcile/` or `bin/hooks.js`'s `reconcile` command.
