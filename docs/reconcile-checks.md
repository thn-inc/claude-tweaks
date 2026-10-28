# Reconcile checks

`plugin/bin/lib/reconcile/index.js` exports `reconcile()`, the one entry point for the
`integration-model: pr-first` background convergence family — see `docs/plugin-structure.md`'s
`plugin/bin/lib/reconcile/` inventory line for what each existing check module does. This file is
the procedural counterpart: what `index.js` does with those checks, and the full "adding a new
check" registration procedure, in the same spirit as `docs/hooks.md` for `plugin/bin/hooks.js` +
`plugin/bin/lib/hooks/`.

- **Dispatch order is significant, not incidental.** `index.js` runs `mirror → red-tip → console →
  release → archive → archive-branches → remote-prune → ledger-residue → reap`, reap deliberately
  last because it physically removes worktrees — running it earlier would make every later check's
  live `git worktree list`-derived branch lookup fail for exactly the runs `reap` just finished
  with.
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
  | `archive` | `mirror` | `remote-prune` | `localHasMerge` reads `refs/heads/{integration}`, then `origin/{integration}`, and only the shared fetch refreshes the latter. Without it, a PR GitHub merged asynchronously skips as `local-behind-merge`. |
  | `red-tip` | `mirror` | `remote-prune` | It reads `origin/{integration}` right after the shared fetch, and otherwise skips as `no-fetch-this-pass`. |

  `release,archive,reap` runs as `mirror,release,archive,reap`; `reap` alone stays `reap`; a
  subset naming `remote-prune` is not widened, because its `--prune` shared fetch already refreshes
  `origin/{integration}`; `FAST_CHECKS` and `BACKGROUND_CHECKS` expand to themselves. The added
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
  `bin/hooks.js`'s `BACKGROUND_CHECKS` (`release`, `archive`, `archive-branches`, `remote-prune`,
  `ledger-residue`, `reap` — write-only/janitorial, run in a detached `reconcile-background` child
  process) must **partition `ALL_CHECKS` exactly** — no overlap, nothing silently dropped. A new
  check has to join one list or the other.
  The unscoped `hooks.js reconcile` CLI defers three of the six to that same background pass
  (`CLI_DEFERRED_CHECKS`, #4032 — see the Timing contract below); an explicit `--checks` call is
  never deferred.

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
   `reconcile()`'s result shape (`{ mirror, redTip, worktrees, claims, runs, branches,
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

**The 24-hour floor.** `STALE_INTERRUPTED_TTL_MS` is unchanged (maintainer ruling 2026-10-22): a dead verdict still needs the same 24 hours of silence the kind needed before. Revisit trigger: revisit once the owner block has shipped for a release.

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

## The `live` skip and report-only run dispositions (#3977)

Settle findings aggressively, close runs conservatively: closing a run a live sibling session is still driving ends its enforcement and event logging invisibly, while a run left open by mistake costs one more banner line.

**The `live` skip.** `archiveMerged`'s main loop asks the run-liveness verdict once per run dir, at the top of the loop (`verdictAtGuard`, through the `runVerdict` hook — `defaultRunVerdict`), and skips a `live` run with reason `live` before any archive path sees it — `orphaned-mint`, `abandoned-interrupted`, `adhoc-superseded`, `adhoc-session-ended` and the merged path alike. A run dir with no `run-state.json` is `unknown` without asking. `unknown` and `dead` fall through unchanged: each existing path keeps its own evidence (a merged PR, a mint that never wrote `config.yml`, a worktree gone for 30 days, the #4421 verdict floors). The verdict is handed to `classifyRunDir` as `ctx.runLivenessResult`, so `abandoned-interrupted` does not ask a second time. The clean-status sweep has no `live` skip: a clean run is wrap-up's own just-closed run, archived post-merge by the session that is still alive.

**Run dispositions.** After both archive loops, `reportRunDispositions` evaluates `run-liveness/disposition.js` for every non-clean run dir still present (a dir this pass archived is excluded, so a dry run never reports it twice). Its facts come from `run-liveness/facts.js` — the PR state from the same by-number-then-branch join the merged path uses, the branch's local and origin refs and its commit count past the integration branch, the worktree's existence and `git status`, the staged inventory, and the quiet time since the last owner-attributed event. Any probe that fails is the "cannot determine" value, never a value that closes: `pr: 'unknown'` (a `gh`-absent environment, an API error, a run with neither a stamped `pr.number` nor a branch name), `uniqueCommits: null`, `dirty: null`. The rules, in order, first match wins, default `leave` ("staged ok" means `staged/` and every `spec-*/staged/` is empty or holds only review findings — `review-unconfirmed-`, `review-contested-`, `review-debate-`; "other staged" is any other kind, or a `staged/` that cannot be read):

| # | Run shape | Conditions | Disposition |
|---|---|---|---|
| 1 | any | verdict `live` | `leave`; never touched by any archive path |
| 2 | any | verdict `unknown` | `leave` for the new rows; existing paths keep acting on `unknown` |
| 3 | `-adhoc-standalone` | verdict `dead`, staged ok | `close` (`adhoc-dead`, no 30-day wait); `events.jsonl` moves with it |
| 4 | `-adhoc-standalone` | verdict `dead`, other staged | `orphan`, reason `staged items need an outcome` |
| 5 | other standalone (`-tidy-`, `-sweep-`, `-release-standalone`, any other `-standalone`) | verdict `dead`, `staged/` empty | `close` (`standalone-dead`) |
| 6 | other standalone | verdict `dead`, `staged/` not empty | `leave` (the existing staged-proposals banner and #3898 own it) |
| 7 | formal | PR merged | `leave` here; the existing merged path acts, unchanged |
| 8 | formal | verdict `dead`, PR closed unmerged, staged ok | `close`, reason `pr-closed-unmerged`, `dropFindings` set |
| 9 | formal | verdict `dead`, PR closed unmerged, other staged | `orphan`, reason `staged items need an outcome` |
| 10 | formal | verdict `dead`, PR open (draft or ready) | `orphan`, reason `draft PR #N, session gone` or `PR #N open, session gone`; never closed |
| 11 | formal | verdict `dead`, no PR, (`uniqueCommits` greater than 0 or worktree dirty) | `orphan`, reason `unpushed commits on {branch}` or `uncommitted changes in {worktree}` |
| 12 | formal | verdict `dead`, no PR, (branch absent locally and on origin, or `uniqueCommits` 0), (worktree absent or clean), no owner-attributed event for 24 hours, staged ok | `close`, reason `nothing-to-resume`, `dropFindings` set |
| 13 | formal | verdict `dead`, no PR, otherwise as row 12 but other staged | `orphan`, reason `staged items need an outcome` |
| 14 | any | anything else (including any unknown fact) | `leave` |

Row 12's 24-hour floor reuses `STALE_INTERRUPTED_TTL_MS` (`disposition.js`'s `QUIET_FLOOR_MS`, pinned equal by a test); it only narrows what can close. Its branch fact uses the branch name the run recorded (`run-state.json`'s `pr.branch`, or a `decisions.md` PR-early line) even when that branch is gone — "gone everywhere" is what the row asks. `dropFindings` lists the review findings rows 8 and 12 would drop with reason `run-abandoned`; that vocabulary is registered in `_shared/auto-decision-log.md` by #3978, where the drop becomes real.

**Report-only in this release.** The new rows close nothing. `RUN_AUTO_CLOSE_REPORT_ONLY = true` in `archive-merged.js` is read at exactly one site (a source-scan test pins one read), and the pass writes nothing to any run dir — no `run-state.json` change, no `decisions.md` line, no archive move, no staged drop. It is a release step, not a policy key: every consumer project gets a dry run on its own pile first, and the record that enables closing (#3978) flips that one read to the act path and deletes the switch. `archiveMerged` returns the report as `runDispositions: { reportOnly, wouldClose: [{ runId, runDir, reason, evidence, dropFindings }], orphaned: [{ runId, runDir, reason, pr }], unknown }`; `reconcile()` copies it onto its result (and the `--json` output), `format-summary.js` renders one `would close {run} ({reason}, evidence: ...)` line per run plus `orphaned: N run dirs` and `unknown liveness: N run dirs` (each only above 0), and a real (non-dry) pass persists `wouldClose`, `orphaned` and `reportOnlyPassAt` to `reconcile-cache.json` (`applyRunDispositions`, also on the over-budget early return). `reportOnlyPassAt` is the marker #3978 reads: auto-close never acts on a checkout that has not first had a report-only pass. A `would close` line you disagree with is a false positive — report it through `/claude-tweaks:feedback`.

**The SessionStart banner reads the cache.** `session-residue.js`'s `collectStaleRuns` lists a non-clean, non-ad-hoc run only when the cached `orphaned` list names it AND its verdict, re-checked offline now (the lock probe reads SessionStart's one shared `git worktree list`), is still `dead`; newest first, three rows, then `- … and N more orphaned run(s) (newest 3 shown): node "{root}/bin/hooks.js" reconcile --dry-run --json --checks archive`. Nothing is listed before the first reconcile pass. Each row names its reason and a resume command (`PIPELINE_RUN_DIR="{dir}" /claude-tweaks:flow {records}` — `/flow` adopts an anchored run dir with `config.yml` as its Step 3 case 1), keeping the shipped-unclosed and consolidated-pass line texts where they apply.

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
`red-tip`, `reap`, `release`, `archive`, `archive-branches`, `remote-prune`, `ledger-residue`,
`console` — is skipped
via the preflight gate (`ghHealthCheck`/`ghHealthCheckAsync`, `preflight.js`), reported as
`{"skipped":[{"check":"red-tip,reap,release,archive,archive-branches,remote-prune,ledger-residue,console","reason":"preflight-gh-absent"}]}`.
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

## Timing contract (#4032)

An unscoped `hooks.js reconcile` call took about 52.5 s; the contract below is what brings it under
10 s, and what lets the next regression be found by reading the JSON instead of guessing.

- **`timings` rides on every `reconcile()` result** — every return path, early ones included — as
  `{ totalMs, phases: { [phase]: { ms, subprocessMs, subprocessCount, subprocesses: { [family]:
  { count, ms, maxMs } } } } }` (`timing.js`'s `summarizeTimings`, milliseconds to one decimal), or
  `null` when the summarizer itself faulted: measurement never changes what a pass does.
  `hooks.js`'s `reconcile-threw` fallback carries `timings: null` for the same shape reason.
- **Phase names** are `setup`, `mirror`, `red-tip`, `console`, `release`, `archive`,
  `archive-branches`, `remote-prune`, `ledger-residue`, `reap` and `finalize`; only phases that ran
  appear. `setup` is the residual — wall time outside every timed phase — so an early return still
  reports where its time went. `subprocessMs` can exceed `ms` for a phase that runs subprocesses
  concurrently (the `gh-pool.js` mappers), so read it as cost, not as a share of the phase.
- **Every subprocess under `plugin/bin/lib/reconcile/` is timed.** Call `timing.js`'s
  `execFileSyncTimed` / `execFileAsyncTimed`, or git through `runGit` / `runGitAsync`, which route
  through them; `subprocess-timing-conformance.test.js` fails on a direct `child_process` call in
  that directory (exempt: `timing.js` itself and `background-spawn.js`, whose detached child has no
  duration to attribute). An unmeasured spawn would make the report quietly under-count.
- **PR-state cache (`pr-state-cache.js`).** `archive`, `reap` and `release` share one per-pass
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
  pass's `--prune` fetch runs. `/tidy`'s Reconcile-first call names all nine
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
