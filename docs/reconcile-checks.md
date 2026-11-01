# Reconcile checks

`plugin/bin/lib/reconcile/index.js` exports `reconcile()`, the one entry point for the
`integration-model: pr-first` background convergence family — see `docs/plugin-structure.md`'s
`plugin/bin/lib/reconcile/` inventory line for what each existing check module does. This file is
the procedural counterpart: what `index.js` does with those checks, and the full "adding a new
check" registration procedure, in the same spirit as `docs/hooks.md` for `plugin/bin/hooks.js` +
`plugin/bin/lib/hooks/`.

- **Dispatch order is significant, not incidental.** `index.js` runs `mirror → red-tip → console →
  release → post-merge → archive → archive-branches → remote-prune → ledger-residue → reap`, reap
  deliberately last because it physically removes worktrees — running it earlier would make every
  later check's live `git worktree list`-derived branch lookup fail for exactly the runs `reap` just
  finished with. `post-merge` sits immediately before `archive` because it hands archive the run
  dirs it must leave in place this pass (see the Post-merge closes section below).
  `red-tip` runs immediately after `mirror` so it reads the ref the shared fetch just refreshed
  instead of fetching a second time. See the ordering comment directly above the dispatch block in
  `index.js` before reordering anything.
- **`ALL_CHECKS` is the requested-subset default, not the iteration order.** `index.js`'s own
  `DISPATCH_ORDER` constant is what's actually walked; `ALL_CHECKS` only lists membership.
- **An explicit `--checks` subset runs without the wall-clock budget (#3026).** `budget.js`'s 18 s
  ceiling bounds the SessionStart and unscoped passes; the detached `reconcile-background` pass runs under
  its own `BACKGROUND_BUDGET_MS` (120 s, still bounded and under the 5-minute stale-lock window) because
  the hot-path ceiling would skip its last three checks every pass (#4032). The `hooks.js reconcile` CLI
  passes `budgetMs: Infinity` into `reconcile()` whenever `--checks` names a subset, so a named
  check such as `reap`, dispatched last, is never skipped as `budget-exceeded`; it also passes
  `skipCacheStamp`, so a subset never marks the SessionStart freshness cache as fresh (the #644
  `reconcile-summary` opt-out). Runtime is then
  bounded only by each check's own timeouts, so every scripted `--checks` caller (dispatch's
  drain-termination call, `_shared/pr-first-merge-post-merge.md` Step 4.2) keeps an explicit
  150000ms+ Bash timeout.
- **An explicit subset is expanded with its prerequisites (#3630).** For each check that reads
  state another check produces, `index.js`'s `PREREQUISITES` table names the producing check and
  the checks that already provide that state. `expandChecks()` adds a missing one before dispatch;
  `DISPATCH_ORDER` still decides execution order.

  | Check | Prerequisite | Satisfied by | Why |
  |---|---|---|---|
  | `archive` | `mirror` | `remote-prune` | `localHasMerge` reads `refs/heads/{integration}`, then `origin/{integration}` (the fallback only when the main checkout is not on `{integration}` or under `--dry-run`, whose preview assumes mirror's fast-forward succeeds — a dirty, diverged or ahead main skips in the real pass), and only the shared fetch refreshes the latter. Without it, a PR GitHub merged asynchronously skips as `local-behind-merge`; on `{integration}` itself the skip clears only when mirror's fast-forward lands (not just the fetch), so a refused fast-forward (e.g. a dirty tree) keeps it. |
  | `archive` | `post-merge` | — | Archived runs are never walked again, so a run `post-merge` still owes its Steps 4.0 and 4.0b must not be archived first. `post-merge` returns the run dirs it deferred this pass and archive leaves exactly those in place (`post-merge-pending`); without the check in the pass, nothing is deferred. No other check provides that state. |
  | `red-tip` | `mirror` | `remote-prune` | It reads `origin/{integration}` right after the shared fetch, and otherwise skips as `no-fetch-this-pass`. |

  `PREREQUISITES` holds one entry or an array of them per check; `archive` has two, one table row each.
  `release,archive,reap` runs as `mirror,release,post-merge,archive,reap`; `reap` alone stays `reap`; a
  subset naming `remote-prune` is not widened for `mirror`, because its `--prune` shared fetch already
  refreshes `origin/{integration}` (it still gains `post-merge`: `archive,remote-prune` runs as
  `post-merge,archive,remote-prune`); `FAST_CHECKS` and `BACKGROUND_CHECKS` expand to themselves. The added
  prerequisite runs in the same pass, so under the CLI's `--checks` path it shares the unbounded
  budget from the bullet above. `archive-branches` has no entry: when `git cherry` cannot prove
  equivalence it falls back to PR-state squash-merge evidence (#2252), so a stale local ref only
  delays it and never wrongly skips it. An added prerequisite follows the pass's own gates
  rather than overriding them: under `--dry-run` it does not fast-forward (`mirror` reports
  `skipped` / `dry-run` — a `mirror` the caller named behaves the same), and when the gh preflight fails it is dropped along with the check it
  served, since only a `mirror` the caller named survives the preflight narrowing.
- **`--dry-run` writes nothing, with one deliberate exception (#4180).** A dry run skips the end-of-pass
  cache writes, every GitHub write, the declined-learning store prune, the `origin/HEAD` repair, and a
  run's `worktree-reap-skipped` event append; what residue tracking would have done comes back as
  `residuePlan`. The shared `git fetch` still runs and still refreshes remote-tracking refs (and prunes
  them under an explicit `--checks remote-prune`) — a preview over stale refs would be inaccurate, so
  this is the one write a dry run keeps. A new check's dry-run branch must write nothing else. Reads
  stay live: the `gh` preflight probe and the PR-state lookups still run, since a preview that did not
  consult GitHub would report nothing true — so "writes nothing" means no writes, never "makes zero `gh`
  calls" (#4180's AC1 states the zero-call bar over a fixture where the preflight is stubbed and only
  the archive check runs).
- **The fast/background split (#820 D8).** `bin/lib/hooks/session-start.js`'s `FAST_CHECKS`
  (`mirror`, `red-tip`, `console` — cheap read/detect, run inline on every SessionStart) and
  `bin/hooks.js`'s `BACKGROUND_CHECKS` (`release`, `post-merge`, `archive`, `archive-branches`, `remote-prune`,
  `ledger-residue`, `reap` — write-only/janitorial, run in a detached `reconcile-background` child
  process) must **partition `ALL_CHECKS` exactly** — no overlap, nothing silently dropped. A new
  check has to join one list or the other.
  The unscoped `hooks.js reconcile` CLI defers three of the seven to that same background pass
  (`CLI_DEFERRED_CHECKS`, #4032 — see the Timing contract below; `post-merge` is not among them
  and runs inline beside `archive`); an explicit `--checks` call is never deferred.

## Adding a new check

Concrete precedent: `archive-branches.js` was the 7th check added (#517). Grepping its own
registration footprint — `git grep -l archive-branches` — is a faster way to verify this list
against reality than trusting it in the abstract; do that for whichever check you're adding too.

1. **`bin/lib/reconcile/{check}.js`** — the check itself. Follow `release-merged.js`'s /
   `archive-branches.js`'s pattern: pure decision functions, I/O at the edges.
2. **`bin/lib/reconcile/index.js`** — add the name to `ALL_CHECKS`, insert the dispatch call at
   the correct position in `DISPATCH_ORDER` (see the ordering bullet above), and decide which side
   of the fast/background split it belongs on — and, when the check reads state only another check
   produces, add a `PREREQUISITES` entry for it (see the expansion bullet above).
3. **`bin/lib/hooks/session-start.js`'s `FAST_CHECKS`** (cheap read/detect) **or
   `bin/hooks.js`'s `BACKGROUND_CHECKS`** (write-only/janitorial) — add the name to whichever list
   matches the decision from step 2. These two lists are asserted to partition `ALL_CHECKS`
   exactly (`tests/hooks-session-start.test.js`, `tests/bin-lib/hooks/reconcile-background.test.js`)
   — missing this step fails that assertion, not silently. A `BACKGROUND_CHECKS` member whose cost
   would dominate the unscoped CLI's wall time may also join `CLI_DEFERRED_CHECKS` (a subset of
   `BACKGROUND_CHECKS`, pinned by `tests/bin-lib/hooks/reconcile-background.test.js`); a deferred
   check is then absent from the unscoped CLI's inline set. `plugin/skills/tidy/scan-procedures.md`'s
   Reconcile-first call lists every check explicitly for that reason, and
   `tests/reconcile.test.js` pins that list to `ALL_CHECKS`.
4. **`bin/hooks.js`'s `reconcile-threw` fallback** — a **hand-maintained duplicate** of
   `reconcile()`'s result shape (`{ mirror, redTip, worktrees, claims, postMerge, runs, branches,
   remoteBranches, ledgerResidue, console, residuePlan, residueErrors, skipped, timings }`), substituted only when `reconcile()` itself
   throws. If the new check populates a new top-level result key, this literal needs that key
   added too — an omission here doesn't throw or fail a lint; it just silently under-reports on the
   one code path (a genuine throw inside `reconcile()`) that almost never runs in normal testing,
   which is exactly what makes it easy to miss. This hazard has a precedent, not just a
   hypothetical: the fallback silently drifted out of sync by omitting `redTip`, and stayed that
   way until #1009 (`407f6207e`) added it back. The literal is in sync with `reconcile()`'s result
   shape today — re-check it against `index.js` rather than trusting this line.
5. **`bin/lib/reconcile/format-summary.js`'s `CATEGORIES` table** — only if the check's result is
   array-shaped (like `worktrees`/`claims`/`runs`/`branches`/`remoteBranches`/`ledgerResidue`).
   Add a row so `bin/hooks.js reconcile`'s compact human-readable default output covers the new
   check's taken and skipped entries; the `--json` output needs no change, since it echoes the raw
   result object.
6. **`docs/hooks.md`'s Background convergence bullet** — it names every check twice in prose (the
   full set, then the background half). Add the new check to both lists.
7. **Three shape-asserting test files:**
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

**A merged PR is not a finished run (#3503).** When a run's PR is MERGED, the main loop's two
paths still check one more thing before archiving: the branch-joined path (`archiveMergedRun`)
and the by-number fallback. Each checks whether the run's own records all shipped.
`runRecordSet(dir)` gives that record set. It is the manifest's spec ids, minus `failed`/`not-run`
specs and minus deferred-closure entries. With no manifest it is the ids in a
`-record-{n}`/`-spec-{n}` slug, and `null` (no check) for any other slug, for a non-integer
manifest id, or under an explicit `work-backend: local-files`.

A record counts as closed in either of two ways. The first is the merged PR's
`closingIssuesReferences`, read through `release-merged.js`'s `prClosesIssue`. The second, in
`settleMergedPartial`, is that the record's own issue is CLOSED, which covers a record shipped
later by a second PR or at `/release`. When the PR's `closingIssuesReferences` is an empty array,
as on a non-default integration base where GitHub never links closing keywords, only a manifest
spec still `pending`/`running` blocks (`inFlightRecords`).

Three skip reasons come out of this check:

- **`merged-partial`**: carries `unclosed: number[]`, which `reconcile/index.js` passes through to
  `result.runs`. It is in `STRUCTURALLY_STUCK_REASONS`, so a run left waiting escalates after the
  TTL instead of freezing.
- **`closing-issues-unknown`**: the PR object carries no `closingIssuesReferences` array. This
  reason is transport-class and untracked.
- **`no-repo-slug`**: there is no resolvable `origin` slug. This reason is tracked, so it shows in
  the residue summary's stuck count. With no slug there is no repo to file the escalation issue in,
  so it never escalates.

Run-state is never written on any of these skips. The `status: clean` sweep is exempt from this
check: wrap-up already closed that run.

**A review finding with no tiebreak verdict blocks archival too (#3945).** When the run dir, or
any of its `spec-*/` subdirs, holds `review-findings.json` (the findings list `/review` Step 3.7
writes through `review-coordination.js write-findings`), `tiebreak.js`'s `checkRunTiebreakCoverage`
requires a tiebreak verdict line in that same dir's `decisions.md` for every listed finding id.
`decideArchiveCore` evaluates it only at the points that would otherwise return `archive`
(`settleMergedPartial` included), so it runs after every other guard, the record check above
among them. A run with no artifact archives exactly as before. Two skip reasons come out of it,
each carrying a recovery `hint`:

- **`tiebreak-artifact-invalid`**: the artifact is present but unreadable or malformed. It is
  checked before any per-id gap.
- **`tiebreak-coverage-missing`**: carries `missing`, the uncovered ids, with a spec dir's ids
  prefixed `spec-N/`.

Both are in `STRUCTURALLY_STUCK_REASONS`, because only a re-run of the findings writer and the
tiebreak, or deleting a pre-tiebreak artifact, converges them. Unlike the record check, the
`status: clean` sweep applies this gate as well, and its `onSkip` tracks both reasons, so a closed
run skipped here escalates through the same structurally-stuck path as the main loop.
`hooks.js archive-run` refuses on the same two conditions, after its own guards, and
`review-coordination.js check-coverage` prints the same coverage result without refusing anything.

**An unfiled can't-tell finding blocks archival of an auto-merge run (#4171).** An auto-merge
path (the wrap-up short-circuit or the dispatch bundle Auto-merge gate) renders no Review Console
and writes no `console.json`, so a can't-tell tiebreak
finding the run held would otherwise be lost at archive. `unfiledCantTellFindings` (in
`archive-merged.js`) returns `[]` unless `readTopLevelConsoleState` is `none` and
`consoleReplacedByAutoMerge` is true; otherwise it names, via `console/finding-outcomes.js`'s
`unfiledCantTell`, each finding of the run dir and of every `spec-*/` dir (prefixed `spec-N/`)
with no `AUTO … filed as #{n} (work-fingerprint {fp})` line in that dir's `decisions.md`. A read
failure fails closed. `runTiebreakCoverage` carries the list as `unfiledCantTell`, and
`archiveUnlessTiebreakGap`, the single choke point every archive decision that carries a run dir passes (`decideArchive`'s thin wrapper holds none, so it never evaluates the guard), evaluates it
last, after the artifact checks above: the skip reason is **`cant-tell-unfiled`**, carrying
`unfiled` and `CANT_TELL_UNFILED_HINT`. It is in `STRUCTURALLY_STUCK_REASONS`, the `status: clean`
sweep's `onSkip` tracks it, and a rendered console (a `console.json` or a `Review Console:
terminal decision` line) turns the guard off. `hooks.js archive-run` refuses the same condition, inside its
`console-never-rendered-staged-pending` block and after that refusal, printing the hint with the
real run dir in place of `{run-dir}`. The remedy is to file each finding through
`wrap-up/review-console.md`'s Can't-tell filings: a `spec-N/`-prefixed id is filed and logged with
`--run {run-dir}/spec-N` (its own `decisions.md`). Every other run archives exactly as before.

**Console residue (#3949).** `readConsoleState` returns `residue` when a run's console resolved
(or wrote no top-level `console.json`) but `console/residue.js`'s `readRunResidue` still reports an
unacknowledged console holding `pending`/`keep-staged` items (or a PR console item whose outcome is
`filing-failed`/`reverse-failed`), or an unreadable one (fail closed).
Every site that skips `console-unresolved` — `decideArchiveCore`, the `status: clean` by-number
sweep, `hooks.js archive-run` — skips or refuses `console-residue` too, which a human clears with
`console-residue.js --ack` (an unreadable `console.json` must be repaired or removed instead). The
skip carries a `hint` naming the open items and any unreadable
`console.json`, which `reconcile/index.js` passes through to `result.runs` (#4172). Since #4170, when a planned can't-tell filing has no record (`filing-pending`), the hint also names the paste-ready `console-filings.js --only` re-run (`filingRerunRemedy`); the `hooks.js archive-run` refusal prints the same remedy. `console-residue` is
deliberately not in `STRUCTURALLY_STUCK_REASONS`: an acknowledgement (or, for a `filing-pending` item, logging its filed line), not a reconcile re-run, converges it.

**Residue pruning.** After every `archive` pass, `cache.js`'s `pruneResidueFailures` drops any
`residueFailures` entry (reason-agnostic — `move-failed`, `structurally-stuck`, any future reason)
whose tracked path no longer exists on disk: a path can never fail or succeed there again, so it
must stop counting toward a fresh escalation streak. An entry that was already `escalated` also
gets its filed backlog record resolved — `escalate-residue.js`'s `resolveResidue` comments ("no
longer exists on disk — resolved by other means") and closes it, best-effort (a resolution failure
still drops the cache entry; a per-path record is left for a human to close manually, while a path
left on the consolidated `structurally-stuck` record comes off at the next escalate or resolve edit
a pass in this checkout makes — see the consolidated-escalation bullet below). A successful
archive also resolves an escalated `structurally-stuck` entry, through `clearResidue` (#4202): it
is kept on a failed resolve, retried once by the same pass's prune, then dropped. Escalation itself
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
that owns every mtime-TTL comparison (via `isStaleDir`), the events-log recency comparison
(via `ownEventRecency`), and the liveness verdict `adhoc-session-ended` consults (through the injectable
`liveness` argument, default `adHocSessionLiveness`), and the run-liveness verdict `abandoned-interrupted`
consults (through `ctx.runVerdict`, default `defaultRunVerdict`, #4421), returning `{ kind, ttlMs, evidence }` with
`kind ∈ { 'orphaned-mint', 'abandoned-interrupted', 'adhoc-superseded', 'adhoc-session-ended',
'merged', 'structurally-stuck', 'none' }` — a first-match list evaluated in that exact precedence order.
The five pre-consolidation predicates (`isOrphanedMint`, `isAbandonedInterrupted`,
`isAdHocStandaloneSuperseded`, `decideArchive`, `isStructurallyStuck`) are now thin wrappers that
call `classifyRunDir` with `ctx.kinds` scoped to their own one kind — this is what keeps a
standalone call (a unit test constructing a bare fixture dir, or `trackStuckSkip`'s own narrower
question) answering exactly what it always asked, unaffected by whether the same dir would ALSO
match some other, higher-precedence kind under the full order. `adhoc-session-ended` was added
later (#4179) and has no wrapper predicate. Only `archiveMerged()`'s own main
loop passes the full, ordered kind set.

The `checkRunIntegrity` shipped-unclosed evidence gate for `abandoned-interrupted` stays
call-site-only, never folded into the classifier itself (folding it in would misattribute the
`explicit: true` archival path's justification) — the main loop re-classifies scoped to
`adhoc-superseded` and `adhoc-session-ended` when that companion check fails, so a dir that superficially reads
`abandoned-interrupted` but fails the gate still falls through to the next-lower-precedence kind,
matching the pre-consolidation `&&`-chained early-return exactly.

The `structurally-stuck` branch exempts every genuine ad-hoc dir at `no-branch`/`no-worktree`/`no-pr` (`isAdHocIntrinsicSkip`, #2724, widened by #4179) — that is an ad-hoc dir's normal state. A linked-worktree dir is archived by `adhoc-superseded`, once its worktree is no longer registered and `ADHOC_SUPERSEDED_TTL_MS` (30 days) has passed. A main-checkout dir is archived by `adhoc-session-ended` (never for the caller's own session: a dir whose run-state `sessionId` equals the caller's is skipped, mirroring `abandoned-interrupted`'s `ownLive`), once its session reads `dead` from `adHocSessionLiveness` (`runLiveness` with the worktree probes neutralised, since the main checkout's lock and last commit belong to every session) and `ADHOC_SESSION_ENDED_GRACE_MS` (7 days) has passed by dir mtime. A main-checkout dir whose verdict stays `unknown` is left in place, neither swept nor escalated. `trackStuckSkip` clears an exempted dir's cache entry (`clearResidue`) and, if it was already escalated, resolves its path off the consolidated record. Unlike Residue pruning above, an escalated entry is dropped only after that resolve lands (`closed`, `path-removed`, `not-found` or `already-closed`): the dir still exists, so a throw or any other status keeps the entry and the next pass retries. The resolve comment says the path is an ad-hoc session directory rather than "no longer exists on disk" (`resolveResidue`'s optional `why`), and under `reconcile --dry-run` the whole clear is skipped, the same guard `pruneResidueFailures` sits behind.

## `abandoned-interrupted` through run-liveness, and `ownerlessNonClean` (#4421)

**The rule.** The `abandoned-interrupted` branch of `classifyRunDir` asks the run-liveness verdict (`runLiveness`, #3973) instead of reading the events log's age alone. It does so through `ctx.runVerdict` (default `defaultRunVerdict`), a hook kept separate from `ctx.liveness`: neither calls the other. `defaultRunVerdict(dir, now)` is `runLiveness(dir, { now, probes })`, with the worktree-path probe forced to `missing` when `recordedWorktreeIsMainCheckout(dir, state)` holds — the same adjustment `adHocSessionLiveness` makes, but for any run dir whose recorded worktree is the main checkout, ad-hoc or not. `recordedWorktreeIsMainCheckout` compares real paths and is false for any path it cannot prove.

`classifyRunDir` asks the hook only after the cheap guards, in this order: status `interrupted`; not the caller's own session; `events.jsonl` readable; silence past the 24-hour floor. Silence runs from the last own event (`lastOwnMs`), else from `runIdMs(dir)` (the run id's own timestamp); with neither there is no reference time and the run is never abandoned. Both floors use a strict `>`. `runIdMs` and `LIVE_PROBES` are imported from `run-liveness`, never copied. Then:

- **Route (a):** the verdict is `dead`, the evidence array is present, no entry is an `error`, and silence exceeds `STALE_INTERRUPTED_TTL_MS` (24 h).
- **Route (b):** the verdict is `unknown`, the evidence array is present, no `LIVE_PROBES` entry is `positive`, and silence exceeds `LEGACY_DEAD_MS` (72 h). `owner-events` is not a live probe.

A `runVerdict` that throws, returns no evidence array, or returns any other verdict reads as not abandoned. The `shipped-unclosed` gate at `archiveMerged`'s call site is unchanged.

**The 24-hour floor.** `STALE_INTERRUPTED_TTL_MS` is unchanged (maintainer ruling 2026-10-22, kept on revisit 2026-10-31, #4437): a dead verdict still needs the same 24 hours of silence the kind needed before. A dead verdict shows that the owning session has ended, not that the run is abandoned, and interrupted runs are picked up again later. Measured on this checkout on 2026-10-31 over the 1,856 run-id-named directories with an `events.jsonl` (live and archived), counting each own (non-`fallback`) `session-end` event that carries a `sessionId` and whether later activity — an own `skill_invoked`, `commit`, `verify`, `ask-user-question` or `pre-compact` event — followed in the same run: pipeline runs (no `-standalone` suffix) logged 180 session-end events across 125 runs, followed by 82 distinct resumes — 66 within an hour, 10 after 1–6 h, 2 after 6–12 h, 3 after 12–24 h and 1 after 24–72 h, each gap measured from the last session-end before the resume. The 5 resumes after 6–24 h came from 3 runs, so a 12-hour floor, or a 6-hour one, would have made those same 3 runs eligible for archival before they were resumed. The 24–72 h count is an undercount, since a run the current floor archived can no longer show a later resume. Only 4 of the 307 session-end events across all runs came from runs carrying an owner block, too few to judge owner-block runs on their own.

**The bounded fallback (b).** Maintainer ruling 2026-10-26. Without it, owner-block runs that read `unknown` forever would never be archived, where they were archived at 24 hours before. The 72-hour floor is `LEGACY_DEAD_MS`, the same bound the legacy witness uses.

**What changed, row by row.** Every row has status `interrupted`. "Stale" is measured from the last own event, or from the run id when there is none. "Main checkout" means the recorded worktree resolves to the main checkout; such a run reads its lock and commit probes as `no-worktree`, through `defaultRunVerdict`'s adjustment. Rows whose decision is unchanged are omitted, among them the main-checkout row (a non-ad-hoc run whose recorded worktree is the main checkout, owner pid gone): it stays unchanged because of the `recordedWorktreeIsMainCheckout` adjustment, which keeps the shared checkout's fresh commit from reading the run as `live`.

| Owner block | Owner-pid detail | Worktree | Own events | Own session | Old | New | Changed |
|---|---|---|---|---|---|---|---|
| absent | `no-owner-block` | none, linked-and-gone, or main checkout | stale 24–72 h | no | abandoned | not yet (`unknown`); past 72 h the legacy witness reads `dead`, so route a abandons it | yes: the legacy witness needs 72 h |
| absent | `no-owner-block` | any | none own; run id under 24 h | no | abandoned on first pass | not abandoned | yes: measured from the run id (AC5) |
| absent | `no-owner-block` | none or linked-and-gone | none own; run id 24–72 h | no | abandoned | not yet; abandoned once the run id is 72 h old | yes: measured from the run id |
| absent | `no-owner-block` | linked-and-present, lock free, commit 10 min–72 h | stale over 24 h | no | abandoned at 24 h | abandoned past 72 h by route b (no legacy witness while the commit is newer than 72 h) | yes: 24 h becomes 72 h |
| present | `no-pid` or `alive-no-start-time`, no SessionEnd | none, linked-and-gone, or main checkout | stale 24–72 h | no | abandoned | not yet; route b past 72 h | yes: no death witness |
| present | `other-host` | none, linked-and-gone, or main checkout | stale 24–72 h | no | abandoned | not yet; route b past 72 h | yes: no death witness (AC3) |
| present | mismatch (`owner-session-mismatch`) | any without a live positive | stale 24–72 h | no | abandoned | not yet; route b past 72 h | yes: the owner probes error (AC3) |
| present | error (hostname/`pidAlive`/start-time probe throws, `start-time-unavailable`, `invalid-start-time`) | any without a live positive | stale 24–72 h | no | abandoned | not yet; route b past 72 h | yes: `unknown` |
| present | `alive` (start time matches) | any | stale over 24 h | no | abandoned | never while alive (`live`) | yes: a live owner blocks (AC2) |
| any | any | linked-and-present, lock in use or commit under 10 min | stale over 24 h | no | abandoned | never (`live`) | yes: a live probe blocks (AC2) |
| any | `gone`/`pid-reused` or `no-owner-block` | linked-and-present, lock or commit probe errors | stale 24–72 h | no | abandoned | not yet (`unknown`); route b past 72 h | yes: an error never takes route a |

**`ownerlessNonClean`.** `archiveMerged`'s result carries `ownerlessNonClean`: the number of run dirs under the main checkout's `.claude-tweaks/pipelines/` that have no owner block for run-liveness to ask — an owner-less non-clean run state (a missing `status` counts), or no `run-state.json` at all. An absent `run-state.json` counts because run-liveness's legacy route serves an absent file too, so such a run is one the 72-hour legacy route still decides. An unparseable or non-object file counts as neither: it is a file the module cannot read, not a run that never had an owner. The count rides `iterRunDirsWithState`, so it keeps that iterator's run-id, archive-twin and `archiving`-claim filters and never counts `archive/`. It is measured after the pass's archival, so a dir this pass archived is not in it. It is `0` when the pipelines dir does not exist, and absent — never `0` — on a dry run, when there is no main checkout, or when the pipelines dir cannot be read; a skipped or errored archive pass never reaches the copy either. `reconcile()` copies it onto its result, `format-summary.js` renders it as `ownerless non-clean: N run dirs` (also for `0`), and `reconcile-cache.json` persists it — also when an over-budget early return skips `finalize`, where the `overBudget` block writes just the count (never the freshness stamp or the residue index).

`ownerlessNonCleanZeroSince` is an ISO date in the same cache, set by `applyOwnerlessNonClean`: the first pass that counts `0` stamps it, later passes that count `0` keep that stamp, and a count above `0` drops the key — so it always dates the current unbroken run of zero readings. `readCache` keeps either key only when valid (an integer of at least 0; a parseable date string), and the cache writes them only when present.

**Removal condition for the 72-hour legacy route** (`run-liveness/index.js`'s `legacy` witness): remove it when `ownerlessNonCleanZeroSince` is at least 7 days old in this repository's `reconcile-cache.json`, on a plugin build newer than v6.153.0. After the route is removed, fallback (b) still classifies those owner-less `interrupted` runs as `abandoned-interrupted` at the same 72 hours, so removing it changes no archive decision. It does not drain them on its own: archival still needs the `shipped-unclosed` gate, and owner-less runs in any other status have no drain (tracked in the legacy-route removal record).

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
  `gh-absent`/`network-failure`/`invalid-arguments` probe on any one of them, or a dir that DOES carry a
  `run-state.json` (however stale) — that shape belongs to the ordinary classifier/branch-resolution
  path instead.
- **Consolidated `structurally-stuck` escalation** — `escalate-residue.js` files ONE open record per
  sweep pass covering every path stuck at `structurally-stuck`, not one per directory (the exact
  symptom that produced seven near-identical records, #1811-#1817, for one underlying defect).
  `residueFingerprint('structurally-stuck', ...)` ignores the path (every other reason keeps its
  path-specific basis, unchanged), so every stuck dir's `trackResidue` call converges on the same
  marker. The record's body carries a `<!-- stuck-paths -->…<!-- /stuck-paths -->` block
  (`parseStuckPaths`/`renderStuckPathsBlock`) edited in place via `gh issue edit --body` on each new
  path — the edit (`withStuckPaths`) replaces only the line-anchored block (both markers on their own
  lines, CRLF tolerated), keeps every other byte of the body, and appends the block to a non-empty body
  that lost it (#2724), except that a CLOSED record being reopened is re-rendered in full
  (`structurallyStuckBody`: a reopen is a fresh incident, so its fixed remedy text refreshes) — plus a comment, so both the record body and its thread reflect the addition — never a
  second `issue create`. The body's fixed text names every skip reason that feeds the record
  (`no-worktree`, `no-branch`, `no-pr`, `console-never-rendered-pr-closed`, `console-never-rendered-staged-pending` (#3297), #3543's
  `pr-not-found` — a stamped `run-state.json` `pr.number` GitHub's structured GraphQL error confirms
  names no PR, whose remedy is correcting or clearing that stamp), #3503's `merged-partial` (a run
  whose merged PR left records unclosed, carried as `unclosed` on the skip), and #3945's
  `tiebreak-coverage-missing` and `tiebreak-artifact-invalid` (a run whose `review-findings.json`
  lists a finding with no tiebreak verdict line in `decisions.md`, or is malformed; the skip carries
  `missing` ids and a `hint`, which `reconcile/index.js` passes through to `result.runs`, and the body
  carries their remedy line after the `merged-partial` one), and #4171's `cant-tell-unfiled` (an
  auto-merge run holding a can't-tell finding with no filed record, carried as `unfiled` on the
  skip, with its own remedy line after the tiebreak one). `no-repo-slug` is also in
  `STRUCTURALLY_STUCK_REASONS` but is not listed here: it can never be filed into this record, because
  with no repo slug `findOrCreateIssue` returns `escalation-failed`, so it shows only in the residue
  summary's stuck count. Each path's own reason is its
  residue entry's `lastError` (`stuck at {reason}`), not rendered per path. The body also carries
  a fixed remedy line for `console-never-rendered-staged-pending` — a merged run that never
  rendered a Review Console (an auto-merge path — the fast-lane short-circuit or the dispatch bundle Auto-merge gate — writes no `console.json`) while
  its `staged/` or any `spec-*/staged/` still holds pending or unreadable items: apply or delete
  those staged files, or write a resolved `console.json`, and the next reconcile archives the dir
  and drops it from the record. The clean-status sweep (`iterCleanRunDirs`) feeds this reason too
  since #3668, but only for a closed run whose `decisions.md` carries an auto-merge path's own log
  line — the wrap-up short-circuit's, or the dispatch bundle Auto-merge gate's per-member verdict or
  local-merge group line (`consoleReplacedByAutoMerge`, #3740) — the same subset
  `hooks.js archive-run` refuses; every other clean-loop skip stays untracked. The body's
  `merged-partial` remedy line reads: For a `merged-partial` directory, the records the run's merged PR
  was meant to close (the closing-keyword links on that PR) are still open: ship them in a later PR, or
  close/release them if they were abandoned; the next reconcile then archives the dir and drops it from
  this record. `cache.js`'s per-path consecutive-failure counter (`trackResidue`,
  `RESIDUE_ESCALATE_THRESHOLD`) is unchanged and reason-agnostic already; only the filing/resolving
  side consolidates. Resolving one path (`resolveResidue` under `reason: 'structurally-stuck'`)
  removes just that path from the shared record's body — the record only actually closes once its
  stuck-paths list empties, so fixing directory A never silently closes the record while
  directory B is still genuinely stuck. Escalate and resolve edits also drop listed paths inside
  this checkout's own `.claude-tweaks/pipelines/` that are gone from disk (#4202) — paths from
  other checkouts are never judged, since every checkout of a repo appends to the same record —
  and the record closes when that converged list empties. Only an absolute, normalized listed path
  is judged; the list is editable issue text. A resolve whose edit emptied the list but whose
  comment or close failed leaves an open record with nothing listed, and the retry closes it.

## gh-absent preflight: accepted MCP gap (#2523)

`reconcile()` (`plugin/bin/lib/reconcile/index.js`) is a plain Node subprocess, not an agent-session
skill — it cannot reach an agent session's MCP tools, only `gh`. When `gh` is absent (a cloud
Routine sandbox with GitHub MCP tools instead of the CLI), every GitHub-dependent check —
`red-tip`, `reap`, `release`, `post-merge`, `archive`, `archive-branches`, `remote-prune`, `ledger-residue`,
`console` — is skipped
via the preflight gate (`ghHealthCheck`/`ghHealthCheckAsync`, `preflight.js`), reported as
`{"skipped":[{"check":"red-tip,reap,release,post-merge,archive,archive-branches,remote-prune,ledger-residue,console","reason":"preflight-gh-absent"}]}`.
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

## origin/HEAD repair on a fresh clone (#3132)

`worktree-reap.js`'s `resolveIntegrationBranch` falls back to the local `refs/remotes/origin/HEAD`
when `policy.yml` sets no `integration-branch` — and a fresh clone in a cloud/Routine sandbox can
lack that symbolic ref even with a working `origin`. When the resolver returns null and an `origin`
remote is configured, `index.js` runs `git remote set-head origin --auto` once
(`origin-head.js`, bounded by `classify.js`'s `FETCH_TIMEOUT_MS`), drops any cached null for the
root, and re-resolves — every attempt (repaired, failed, or skipped), not only a successful one,
since a concurrent session may have written origin/HEAD in between. A failed `set-head` is
remembered: `cache.js`'s `lastOriginHeadRepairFailedAt` is stamped on failure, and a subsequent
attempt within `DEFAULT_TTL_MS` short-circuits to `{outcome: 'skipped', reason: 'recent-failure'}`
without re-attempting `set-head` — otherwise an offline/auth-rejecting/traffic-dropping remote
would retry on every pass (SessionStart's inline pass AND its detached background pass), since the
no-remote path returns before reconcile ever stamps `lastRunAt`, so `skipIfFresh` never short-
circuits it. The outcome is recorded on the result as `originHeadRepair` —
`{outcome: 'repaired', branch}`, `{outcome: 'failed', reason}`, or `{outcome: 'skipped',
reason: 'recent-failure' | 'dry-run'}` (`dry-run`: under `--dry-run` neither `set-head` nor the
failure stamp is attempted, #4180; any of the three degrades to the `no-remote` skip when
re-resolving still finds nothing, never throws), or `{outcome: 'unresolved'}` when a 'repaired' attempt's
re-resolve still came up empty — and the key is absent when no repair was attempted (no `origin`
remote, or the branch already resolved). A failed or skipped outcome also carries `branch` when
the re-resolve it triggers finds one anyway (the concurrent-winner case). The repair lives in
reconcile, never in the shared resolver: that resolver runs on the pre/post-tool-use hook paths and
stays offline.

## Ledger residue (#3812)

`ledger-residue.js` converges the one leftover a run's own teardown cannot cover: an open-items
ledger (`docs/plans/{name}-ledger.md`) that reached the integration branch because the run's PR was
merged before the teardown that deletes it ran (by a human, the fleet, or a later session).
Decision `docs/decisions/0026-ledger-residue-converges-in-reconcile.md` records why this lives in
`reconcile()` rather than as a merge-time guard.

- **Residue definition.** A direct `docs/plans/*-ledger.md` entry in the tree of
  `origin/{integration}`'s tip (`git ls-tree`, so no checkout is read and no sub-directory matches).
  Nothing but the integration tip is ever examined: an in-flight run's branch legitimately carries
  its ledger until teardown, so an in-flight draft PR branch is never flagged (AC2.1).
- **Removable residue is tidy's orphaned ledger.** Each candidate's blob is read at the tip
  (`git cat-file -p {tip}:{path}`) and kept, as a per-path skip, unless it passes tidy's own
  keep rule (`plugin/skills/tidy/scan-procedures.md`). Data loss is the reason: deleting a ledger
  with unresolved items would silently drop them. The checks run in this order:

  | Kept when | Reason |
  |---|---|
  | the blob cannot be read | `ledger-read-failed` |
  | no `# Open Items` first line or no `\| # \| Phase \| Item \| Status \| Resolution \|` header | `not-a-ledger` |
  | any row's status is `open` (`wrap-up/pack.js`'s `parseLedger`) | `ledger-has-open-rows` |
  | any row's status is neither `open` nor terminal | `ledger-status-unrecognized` |
  | the `.claude-tweaks/pipelines/` listing failed | `run-dir-scan-failed` |
  | a non-`archive` run directory is attributed to it | `run-live` |
  | the open-record list could not be read | `record-scan-failed` (or the classified `gh-absent` / `network-failure`) |
  | an open work record references it | `referenced-by-open-record` (the entry carries `records`) |

  Attribution follows tidy, narrowed from tidy's substring match. Every `#{N}` token on the
  ledger's first line is matched as a whole dash-separated token of a run-dir name after its
  leading timestamp, so `#21` never matches `2026-10-21T…`. When the first line has no `#{N}`, the filename's `{feature}` slug
  (`YYYY-MM-DD-{feature}-ledger.md`) is matched as a substring of the name. A kept ledger is
  still reported, so AC1 holds; it waits for a human or `/claude-tweaks:tidy` to resolve it.

  Referencing records follow tidy's referencing-record pass. An open work record keeps the ledger
  when its `namedTarget` path equals the ledger's path, or its body contains the ledger's filename
  (which covers the full path) or `{feature}` slug; the kept entry carries the matching record
  numbers, ascending. The open-record list is read once per pass, and only when a ledger clears
  every check above, so a pass with no such ledger reads nothing. It comes from
  `gh issue list --state open`, or from `specs/` under `work-backend: local-files` (closed records
  excluded). A failed read fails closed: every ledger that reached this check is kept, as
  `record-scan-failed`, or as the classified `gh-absent` / `network-failure`. One deliberate
  difference from tidy: tidy deletes the ledger and closes the referencing records in one approved
  action, while this background check never closes a record. It keeps the ledger and leaves it to
  `/claude-tweaks:tidy`.
- **Write posture.** A new ref plus a PR, never a push to the integration branch and never a force
  or lease. The removal commit is built with plumbing (`read-tree` → `update-index --force-remove`
  → `write-tree` → `commit-tree`) on a scratch `GIT_INDEX_FILE`, so the checkout's index, HEAD, and
  working tree are untouched, then pushed to `refs/heads/build/ledger-residue-{hash}`. The hash
  covers only the removable set that remains after every skip below. A `commit-tree` failure whose
  error reads `Author identity unknown` or `Committer identity unknown` is
  `committer-identity-unset`; any other plumbing failure is `commit-failed`, and a rejected push
  is `push-failed`. `gh pr create` runs under `GH_TIMEOUT_MS` (`shared-primitives.js`) and is
  never retried, since a timed-out create may still have opened the PR (`pr-create-failed`).
- **Removal-PR states.** Heads are enumerated by ref prefix, not by recency:
  `gh api --paginate repos/{owner}/{repo}/git/matching-refs/heads/build/ledger-residue- --jq '.[].ref'`
  lists every such branch (one ref per line), then `gh pr list --head {branch}
  --state all --json number,state,headRefName,body,isCrossRepository` runs once per branch. That
  sees every earlier removal PR however old, including ones for a residue set that has since
  changed. A fork PR that reuses the branch name is dropped (`isCrossRepository`), since its body
  is not the check's own. A path is "named" by a PR when the body lists it in backticks, as the
  check's own body does.

  | Evidence | Applies to | Reason |
  |---|---|---|
  | any removal PR is `OPEN` | every path the keep rule did not keep | `removal-pr-open` (carries that PR's number) |
  | a `MERGED` removal PR names the path, yet it is still present | that path | `removal-merged-but-present` |
  | a `CLOSED` (unmerged) removal PR names the path | that path, never re-proposed | `removal-pr-declined` |
  | none of the above | the removable set | open the PR (push first when the ref is absent): `pr-opened` / `removal-pr-opened` |

  The list call is classified like `pr-state.js`: `gh-absent` or `network-failure` skips every
  path closed, as does an indeterminate ref check (`ref-check-failed`); any one failing call
  fails the whole list. With no matching refs there are no per-head calls and the list is empty.
  `--dry-run` reports `dry-run` and writes nothing. A declined branch stays on origin:
  `remote-prune` deletes only branches whose PR is `MERGED`. The remaining limit is the branch
  itself: a merged removal PR's branch is deleted after merge (by `remote-prune` or GitHub's
  auto-delete), so `removal-merged-but-present` fires only while that branch survives, and a
  declined branch someone deletes by hand drops its decline.
- **Surfacing.** `bin/hooks.js`'s `reconcile-background` summary records `ledgerResiduePrOpened`
  (removal PRs opened that pass) and `notableLedgerResidue` (per-path skips, minus
  `ledger-residue.js`'s `QUIET_SKIP_REASONS`: `dry-run`, `run-live`, `not-a-ledger`,
  `removal-pr-declined`, `gh-absent`, `network-failure`, `ref-check-failed`).
  `referenced-by-open-record` and `record-scan-failed` are not quiet, so they surface at
  SessionStart. The next SessionStart renders both summary fields in its prior-pass line.
  `/claude-tweaks:tidy`'s Step 6 reports them under its Residue-ledger removal PR row.
- **Fetch.** Reads the ref the pass's shared fetch refreshed (`skipFetch` when that fetch ran and
  succeeded), else fetches `origin {integration}` itself; a failed fetch skips the whole check as
  `fetch-failed` rather than flagging a ledger a merged removal PR already deleted. Hence its slot:
  after `remote-prune` (same fetched ref), before `reap` (which stays last).
- **Side.** `BACKGROUND_CHECKS` — it pushes a ref and opens a PR, so it never runs inline at
  SessionStart.

## Post-merge closes (#4599)

`post-merge.js` runs `_shared/pr-first-merge-post-merge.md`'s Step 4.0 (`bin/closing-links.js
--mode post-merge`) and Step 4.0b (`lib/issues/below-floor-parent-close.js`) once for a PR GitHub
merged after its session ended: an armed auto-merge, a merge-queue merge, or a human clicking merge
in the browser. No session saw that merge, so no session ran the steps, and a below-floor parent
whose last sub-issue merged this way used to wait for a human to approve a tidy row. Step 4.0b's
gate is `lib/issues/parent-gate.js`, the same code the prose runs through `bin/parent-gate.js`
(#4603). The module only decides when the steps run and records that they did. Tidy's
`parent-gate` backstop is unchanged, and every fail-open path below leaves the parent open for it.

- **Population (keyed on the recorded PR, exactly once).** Every top-level run dir, `clean` status
  included (a closed run is the usual armed-auto-merge shape), whose `run-state.json` records a
  positive integer `pr.number`, whose `decisions.md` holds no marker (below), and whose PR is
  `MERGED` on GitHub. It is not limited to armed merges: whatever merged the PR, an unmarked merged
  run gets the steps once. Only `github-issues` projects take part (`work-backend: github-issues`);
  any other value, or none, skips the whole check as `not-github-issues` and writes nothing. A
  checkout without an `origin` slug fails as `no-remote`, and a caller that passes no PR-state
  resolver fails as `no-pr-states` (a programming error, handled like the other two).
- **Marker rule.** A run is done when a `decisions.md` line, read through `parseEntry`, has the
  location `reconcile post-merge` (this check's own summary entry) or one ending in `pr-first-merge
  Step 4.0b` (the merging session's own marker, `(skipped)` form included, and the per-parent
  `closed parent #N …` line a build that logged no summary wrote: it closed a parent there, so its run is
  done; a session that died after its first parent but before its summary is skipped the same way, and
  tidy's backstop recovers the rest). A heading or a hand-written note never matches. The check appends its marker last, after one `AUTO … reconcile post-merge
  parent-close` line per parent it closed (a different location, so it is not a marker), or a single
  `SKIP` marker when Step 4.0 produced no closing set. The marker is read from the top-level
  `decisions.md` and from every `spec-*/decisions.md`: a multi-spec run exports `{parent}/spec-{N}/`
  as `PIPELINE_RUN_DIR`, so the merging session's Step 4.0b may log there. It is re-read once more,
  the same way, under the claim, so a pass that finished in between is not repeated. A
  `reconcile post-merge attempt` line (a transient failure's retry, below) is never a marker.
- **One-time catch-up.** On the first reconcile after this ships, every run that merged without a
  marker gets a late Step 4.0 and Step 4.0b pass once: legacy runs, and runs merged in-session by an
  older installed build, which writes no summary marker. This is bounded three ways. Step 4.0 runs
  with the 10-minute reopen window (`CLOSE_WINDOW_MS`) after `mergedAt`, so a record a human closed
  later is never reopened and counts by its live state, and a record the merge was to close that is
  still open past the window is settled open (`settledOpen`), not pending: no re-run line, and it
  is not a closing record. Step 4.0b runs with `selfInclude: false`, so
  it skips the Self-inclusion rule: that rule assumes a caller seconds after the merge, while this
  one runs at least 10 minutes later, so every closing record counts by its live state too, and a
  sub-issue a human reopened since keeps its parent open. Step 4.0b's own idempotence checks make a
  repeat harmless: a parent already `CLOSED` is a no-op, and an existing trusted heading comment
  means close only, never a second comment.
- **Two concurrency guards.**
  - *Merge grace* (`MERGE_GRACE_MS`, 10 minutes). The merging session runs both steps within seconds
    of `mergedAt` and then writes its marker, so a run whose PR merged no more than the grace ago is
    skipped `merge-grace` with nothing written. A missing or unparseable `mergedAt` counts as inside
    the window, never as old. Because the grace is inclusive and no shorter than `CLOSE_WINDOW_MS`, a
    processed run is always strictly past the close window, which is where `closing-links` settles
    a still-open record (`settledOpen`) instead of logging it pending.
  - *Per-run claim file* (`{runDir}/.post-merge.lock`, created `wx`). Background passes serialize on
    `background-lock.js`, but inline passes (Step 4.2's `--checks mirror,release,archive`, tidy's
    explicit list) do not. A live claim (under `CLAIM_STALE_MS`, 10 minutes) skips `in-flight`; a stale
    one is taken over atomically (renamed aside, so of two takeovers only the rename winner retries
    the create); any other I/O error skips `claim-failed`. The lock is removed after the marker write.
    The dotfile name keeps it out of archive's `staged/` checks.
- **Archive defers what post-merge deferred.** An archived run is never walked again, so a run
  skipped for a retryable reason must not be archived in the same pass, or the "later pass" never
  comes. `postMerge` returns `deferred`, `index.js` hands it to `archiveMerged` as
  `postMergeDeferred`, and `archiveMerged` skips each listed run `post-merge-pending`, resolved-path
  compared, in both the main loop and the clean-status sweep. That skip is never fed to the
  stuck-skip tracker: it is transient, and must never escalate as residue. A run that post-merge
  failed or did not run leaves `deferred` empty, so a failed check never holds archive back.
- **How the guard clears.** Exactly six reasons defer a run: `merge-grace`, `in-flight`,
  `claim-failed`, `network-failure` (the transient PR-state failure), `transient-failure` (below)
  and `budget-exhausted` (below). A run leaves the set once `post-merge` acts on it, which for
  `merge-grace` is within one grace window and for `transient-failure` within `MAX_ATTEMPTS` (3)
  more passes. Nothing else defers. Each reason is normally cleared by a later pass, but two cases
  are not: a persistent `claim-failed` (an `EACCES` or `EROFS` on the run dir every pass) and a
  deterministic per-PR throw (the lookup maps any throw to `network-failure`) defer the run on
  every pass, untracked, so archive never moves it. That is the residual risk of the guard, kept
  because the alternative is archiving a run the reconciler still owes its steps:

  | Skip reason | Deferred | Why |
  |---|---|---|
  | `merge-grace`, `in-flight`, `claim-failed`, `network-failure`, `transient-failure`, `budget-exhausted` | yes | Retryable: the next pass can act. |
  | `pr-not-found`, `invalid-arguments`, `no-pr-state` and any other non-network PR-state failure string | no | A definitive answer a retry will not change. Archive keeps tracking the run as structurally stuck (#3543), so it is not hidden. |
  | `gh-absent`, `dry-run`, `error` | no | Not retryable within the pass. |
  | `marker-write-failed` | no | See the marker-write bullet below. |

- **Transient failures retry, bounded (`transient-failure`).** `closing-links`'s exit codes split
  in two. Exit 5 (`gh pr view` / `gh pr edit` failed, or a required read came back malformed) is gh
  or its transport, so it is transient. Exits 2 (malformed invocation) and 3 (run dir not anchored)
  are deterministic, as is an unreadable exit-0 envelope; exit 4 is pre-merge only. An exit-0
  `baseUnchecked: true` envelope (`base-unchecked`, or `reopen-failed` with that flag: the PR's base
  or the default branch could not be read, so Step 4.0 closed nothing and printed no closing set,
  #4549) is a failed read, so it is transient too; once its retries are spent its marker entry
  carries `step40Failed: true`. A `gh-failed` skip for one parent or record in Step 4.0b is that
  parent's, and the marker is written as usual. A transient failure appends a `SKIP … reconcile
  post-merge attempt` line (`condition: … (attempt N of 3) → fallback: the next reconcile pass
  retries …`), never the marker, and the run is deferred. Once three attempt lines exist, the next transient failure
  writes the marker as a deterministic one does, so the retry is bounded and the parent falls to
  tidy's backstop. A retry re-runs Step 4.0 too, which is idempotent past the close window: a
  record it reopened last time reads open and is settled open.
- **Budget (`budget-exhausted`).** `index.js` hands `postMerge` the pass's own wall-clock budget as
  `budgetExceeded`. It is checked before each run's steps, never mid-run, so a catch-up or several
  armed merges cannot run the inline 18 s passes (the unscoped CLI, Step 4.2, dispatch's calls) past
  their ceiling by more than one run. Once it reads exceeded, every remaining run that would have
  run skips `budget-exhausted` and is deferred, so archive leaves it for the next pass. A `--checks`
  subset runs with an unbounded budget, so it never trips there.
- **Marker-write failure means "nothing re-closes", not "nothing runs twice".** When appending the
  marker fails, the entry is `skipped` / `marker-write-failed` and the run is not deferred. The entry
  still carries `parentsClosed`: those parents are closed on GitHub, only the marker is missing. If
  archive archives it in the same pass, archived runs are never walked again and the steps do not
  repeat. If archive leaves the run in place for its own reasons, Steps 4.0 and 4.0b run again on
  each pass while the write keeps failing. That is safe because both are idempotent: a parent
  already closed is a no-op, and an existing trusted heading comment means close only.
  Any parent still open falls to tidy's backstop.
- **Step 4.0b's after-a-PR-merge rules (#4549).** The mirror applies Step 4.0b as it runs after a PR
  merge, so it has no default-branch check and needs no integration branch. On a non-default base
  the late Step 4.0 closes the PR's still-open `Fixes` records itself, and `closingSet` holds only
  the ones it confirmed closed, so an armed merge into a non-default base closes its records and its
  below-floor parent too. A `closeFailed[]` record (its close or its read failed) joins `reopened[]`,
  `pendingClose[]` and `failed[]` as unsettled, so its parent is skipped `sibling-unsettled` even if
  the close landed despite the error. A `base-unchecked` envelope carries no closing set, so Step
  4.0b never runs for it (the transient-failure bullet above).
- **`gh`-absent skip and fail-open posture.** The check is `gh`-only. `#4602`'s MCP transport covers
  in-session calls, not a Node subprocess, so a `gh`-absent environment gets `skipped` / `gh-absent`
  per run (or the preflight skip for the whole check, see the `gh`-absent section above), no marker,
  and tidy's backstop as the recovery. `--dry-run` writes nothing: no GitHub write and no
  `decisions.md` line; a merged run past the grace window reports `skipped` / `dry-run`, while the
  PR-state reads still run.
- **Fail-closed policy read, host-qualified repo.** An unreadable `.claude-tweaks/policy.yml`
  (any read error but ENOENT/ENOTDIR) or a `risk-floor` value the schema rejects skips Step 4.0b's
  close for the whole pass (`unreadable-policy`, `invalid-risk-floor` on the marker), because the
  schema default (`high`) is looser than a configured `medium` or `low` floor and would close a
  parent below the floor with no sign-off; Step 4.0 still runs and the marker is still written, so
  the run is not retried and tidy's backstop is the recovery. The origin remote's host is kept
  (`git-exec.js`'s `repoSpecOf`), so on a GitHub Enterprise origin the gate's reads and the two
  writes name `host/owner/repo` (`--hostname` on the `gh api` reads); a remote `parseRepo` cannot
  read (an `ssh://` URL) keeps the bare slug it always resolved to.
- **Accepted residual risk: tidy-approval race.** A human approving a tidy `parent-gate` row for the
  same parent in the seconds while a post-merge pass is mid-close can post a second `## Closed below
  the oversight floor` comment, because the two writers share no lock beyond Step 4.0b's own
  read-then-write idempotence check. The window is narrow (one close call), the result is a
  duplicate comment on an already-closing parent, and the parent still ends `CLOSED` once. It is
  accepted rather than closed by a cross-writer lock.

- **Surfacing.** `bin/hooks.js`'s `reconcile-background` summary records `postMergeRan` (runs whose
  steps this pass ran, `action: 'ran'` without `step40Failed`), `postMergeParentsClosed` (the
  parents closed below the floor by those runs), `postMergeUnmarkedParentsClosed` (the parents
  closed by `marker-write-failed` runs, a disjoint count) and `postMergeFailed` (runs
  whose check threw (`skipped` / `error`: no marker, the run is not deferred), or whose Step 4.0 itself failed: the entry carries `step40Failed: true` for a non-zero
  `closing-links` exit, exit 5 or a `base-unchecked` envelope only once its retries are spent, or
  an unreadable envelope, a SKIP marker is written, Step 4.0b never runs, and the parent waits for tidy's backstop; an envelope
  that merely carries no closing set, such as `not-merged`, is not a failure). A failure is never
  counted in `postMergeRan`, and a `transient-failure` retry is in none of them. The next
  SessionStart renders them in its prior-pass line (`post-merge steps ran for N merged run(s),
  closing M parent record(s) below the oversight floor`, counting only those runs' closes, then
  `post-merge steps closed M parent record(s) below the oversight floor in run(s) whose decisions.md
  marker could not be written` for the rest; `post-merge steps failed for N merged run(s) (tidy's
  parent-gate backstop recovers them)`); without them a background parent close, or a failed
  attempt, would never be visible outside GitHub and `decisions.md`.
- **Single-run path (#4692).** The pass above walks the live run dirs only, so a run `/wrap-up`
  already archived is never reached by it. `postMergeOne` (exported from `post-merge.js`) is the
  same guarded path (setup, marker check, merged check, claim, Steps 4.0 and 4.0b, marker last) for
  one named dir, an `archive/{run-id}` dir included, and `bin/post-merge-run.js --run <dir>` runs it.
  `wrap-up/merge-mode.md`'s Already merged section calls it when its Preconditions' `gh pr view
  --json state` finds the PR `MERGED`, and routes on the printed entry. Inside `MERGE_GRACE_MS` it runs under
  the claim with the in-session parameters instead of deferring; an unreadable `mergedAt` skips
  `merged-at-unreadable` with no claim, where the pass defers it as `merge-grace`. The marker and the claim keep it
  and the reconciler from running the steps twice: whichever starts second reads `already-done` or
  `in-flight`. Its entries carry Step 4.0's record lists (`records`) and `logFailed`, Step 4.0b's
  failed closes (`parentFailures`), and the `verdict` and `next` that `classifyEntry` derives for
  merge mode to route on — plus, on a `failed` `ran` entry, `failedSteps` (`4.0` and/or `4.0b`), so
  merge mode reports only the step that failed — which `postMerge` entries never do.

## Timing contract (#4032)

An unscoped `hooks.js reconcile` call took about 52.5 s; the contract below is what brings it under
10 s, and what lets the next regression be found by reading the JSON instead of guessing.

- **`timings` rides on every `reconcile()` result** — every return path, early ones included — as
  `{ totalMs, phases: { [phase]: { ms, subprocessMs, subprocessCount, subprocesses: { [family]:
  { count, ms, maxMs } } } } }` (`timing.js`'s `summarizeTimings`, milliseconds to one decimal), or
  `null` when the summarizer itself faulted: measurement never changes what a pass does.
  `hooks.js`'s `reconcile-threw` fallback carries `timings: null` for the same shape reason.
- **Phase names** are `setup`, `mirror`, `red-tip`, `console`, `release`, `post-merge`, `archive`,
  `archive-branches`, `remote-prune`, `ledger-residue`, `reap` and `finalize`; only phases that ran
  appear. `setup` is the residual — wall time outside every timed phase — so an early return still
  reports where its time went. `subprocessMs` can exceed `ms` for a phase that runs subprocesses
  concurrently (the `gh-pool.js` mappers), so read it as cost, not as a share of the phase.
- **Every subprocess under `plugin/bin/lib/reconcile/` is timed.** Call `timing.js`'s
  `execFileSyncTimed` / `execFileAsyncTimed`, or git through `runGit` / `runGitAsync`, which route
  through them; `subprocess-timing-conformance.test.js` fails on a direct `child_process` call in
  that directory (exempt: `timing.js` itself and `background-spawn.js`, whose detached child has no
  duration to attribute). An unmeasured spawn would make the report quietly under-count.
- **PR-state cache (`pr-state-cache.js`).** `archive`, `reap`, `release` and `post-merge` share one per-pass
  resolver in front of `pr-state.js`: in-pass memo, then a persisted entry still inside its TTL,
  then a live call. Only terminal answers persist (`persistableTtl`, in `reconcile-cache.json`'s
  `prStates` key as `{ v, at }`, keyed `n:{number}` / `b:{branch}`); anything else has TTL 0:

  | Answer | By | TTL |
  |---|---|---|
  | `MERGED` PR | number or branch | `PR_STATE_RETENTION_MS` (30 days) |
  | `pr-not-found` | number | `PR_STATE_RETENTION_MS` |
  | no PR (`null`) | branch | `NO_PR_TTL_MS` (5 min) — a PR can be opened at any time |
  | `OPEN` / `CLOSED` PR, any failure string (`gh-absent`, `network-failure`, `invalid-arguments`) | either | never persisted; failures are not memoized either, so a transient failure is never replayed as an answer |

  `release` alone never consumes a persisted by-branch `null`: it passes `{ freshNull: true }`
  to `byBranchAsync` and `prefetch`, which re-query such a key live (a PR opened inside the
  5-minute TTL would otherwise flip a `pr-open` skip into a release); a `null` learned live in the
  same pass still serves from the memo. `archive` and `reap` keep the persisted answer.

  A persisted `MERGED`-by-branch answer keeps the PR it first saw: if a second PR on the same
  branch also merges, a fresh call would name the newer one. Every consumer acts the same on
  either, because all they check is `MERGED`.

  Entries past retention or malformed are dropped when the pass persists, which re-reads the file
  first so another writer's keys survive. `peekNumber` answers from the memo or a valid persisted
  entry and never makes a live call.
- **`prefetch` warms the memo with one aliased GraphQL read** (`pr-state-batch.js`:
  `BATCH_CHUNK` = 50 aliases per `gh api graphql` query, chunks run under a small concurrency cap;
  branch lookups use `orderBy: CREATED_AT DESC` and the same governing-PR tie-break as
  `pr-state.js`). The batch is an accelerator, never an authority: a `NOT_FOUND` alias, a truncated
  page, a malformed node or any other error leaves that key out, and the per-item `gh` twins
  resolve it, so they stay the sole owner of `pr-not-found` and every failure string. It runs only
  when `origin` is provably on `github.com`, and the query is pinned there with `--hostname
  github.com` so a `GH_HOST` cannot redirect it; any other host takes the per-item path.
  `post-merge` dispatches ahead of `archive`'s warm-up, so it prefetches the recorded PR number of
  every unmarked run itself (`prefetchPostMergePrStates`, clean runs included) before its per-run
  lookups; otherwise each active run would cost one live `gh pr view` per pass.
- **Claim blobs are reused by blob sha** (`release-merged.js`, `claimBlobs` key). An active claim's
  contents are cached by git blob sha and rewritten each pass to that pass's active claims, so it
  stays bounded. The reuse skips only the contents read — classification and the PR/issue join
  re-run every pass — and a stale sha can only make the conditional tombstone write fail
  (`release-write-failed`), never release the wrong claim. `release` also `prefetch`es its
  by-number and then its branch-join lookups before the per-item calls.
- **Residue marker index** (`issue-list-cache.js`, `residueIssueIndex` key,
  `{ "{repo}\n{marker}": issueNumber }`). The residue-escalation dedup lookup
  (`escalate-residue.js`'s `findResidueDuplicate`, reached from `archive` and `reap`) becomes one
  `gh issue view` instead of a full-repo `gh issue list`; it falls back to the list whenever this
  pass already holds the list, the index has no entry, or the viewed issue no longer carries the
  marker (that entry is dropped). **Documented divergence:** with duplicates, the indexed issue
  (canonical at index time) answers even if another process later filed a newer duplicate, where
  the list path would have picked the newer one.
- **One run-integrity cache per pass.** `index.js` hands `archive` a single
  `{ worktreeList, integrationBranch }` cache (the caller's own when it passed one), so the archive
  loop and every per-dir `checkRunIntegrity` spawn `git worktree list` once between them. `reap`
  lists afresh itself, since it removes worktrees.
- **CLI deferral.** The unscoped `hooks.js reconcile` runs `ALL_CHECKS` minus `CLI_DEFERRED_CHECKS`
  (`archive-branches`, `remote-prune`, `ledger-residue` — `archive-branches`' and `remote-prune`'s
  per-branch GraphQL lookups measured 14.8 s and 20.4 s, and `remote-prune` needs the all-refs fetch) and hands those to the detached `reconcile-background`
  pass through `background-spawn.js`'s `spawnBackgroundIfStale`, gated by that pass's own status
  file, as SessionStart does. The JSON gains `background: { checks, spawned, reason }`
  (`reason`: `spawned`, `fresh`, `spawn-failed`, `no-root`, `dry-run`, `not-converged`) and a
  `skipped` entry `deferred-to-background` for the three; an explicit `--checks` call is never
  deferred and carries neither. Nothing is spawned when the pass did not converge —
  `NOT_CONVERGED_REASONS` (`no-repo`, `no-remote`, `fresh-cache`, `local-merge-model`,
  `preflight-gh-absent`, `preflight-github-unreachable`, `reconcile-threw`); report-only skips such
  as `non-canonical-run-dir` or `budget-exceeded` do not count — nor under `--dry-run`, which
  therefore previews none of the three (`skipped` still names them; `background.reason` reads
  `dry-run`, saying nothing was handed over; an explicit `--checks … --dry-run` previews them). The
  background pass runs under `BACKGROUND_BUDGET_MS` (`budget.js`, 120 s) because the 18 s hot-path
  ceiling skipped its last three checks every pass. Without `remote-prune` the inline set is
  mirror-only-shaped, so the unscoped CLI now takes `mirror`'s single-ref `git fetch origin
  {integration}` (5 s `FETCH_TIMEOUT_MS`, concurrent with preflight) where it used to run
  `fetch --prune origin` (10 s); other `refs/remotes/origin/*` refs refresh when the background
  pass's `--prune` fetch runs. `/tidy`'s Reconcile-first call names all ten
  checks explicitly, because the unscoped call defers three.
- **Measured (AC1.1, #4032).** `node plugin/bin/hooks.js reconcile --json`, 20 sequential unscoped
  calls against this repo's main checkout (live network, HEAD baf2964, 2026-10-25): wall time min
  6786 / p50 7266 / p90 7931 / max 8845 ms, against about 52.5 s before (63 s in the record).
  Per-phase p50 ms: setup 495.7, mirror 239.8, red-tip 567.8, console 27.9, release 1594.9, archive
  1737.1, reap 2463.5, finalize 1.2. Wall time exceeded `timings.totalMs` by 58-90 ms on every call
  (process start-up), so the two clocks agree. The deferred checks do not vanish: one background-shaped pass
  (`release,archive,archive-branches,remote-prune,ledger-residue,reap`) took about 45 s, which the
  120 s ceiling lets finish. A live-network wall-time property of this repo's state, so verified by
  this measurement rather than a committed `npm test` assertion; re-measure after changing any
  contract above.

## Referenced by

`CLAUDE.md`'s `### Reconcile` subsection points here for anyone touching
`plugin/bin/lib/reconcile/` or `bin/hooks.js`'s `reconcile` command.
