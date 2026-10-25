---
files:
  - plugin/bin/lib/reconcile/escalate-residue.js
  - plugin/bin/lib/reconcile/archive-merged.js
  - plugin/bin/lib/reconcile/cache.js
---

# Shape the Stuck-Runs Record Without Reconcile Erasing It

**Persona:** A claude-tweaks maintainer working through the backlog, who has just shaped reconcile's consolidated `reconcile: structurally-stuck run directories` issue into a spec with `/claude-tweaks:specify`. Background reconcile passes from every other open session keep touching that issue while they work.
**Goal:** The spec text they wrote stays on the record while reconcile keeps its stuck-path list current. Ad-hoc session dirs that clean themselves up never land in that list, and once every listed dir is gone the record closes without a hand edit.
**Entry point:** Any reconcile pass that adds or removes a stuck path on the consolidated issue: session start's `node plugin/bin/hooks.js reconcile-background` in any session, or a `/claude-tweaks:tidy` sweep.
**Success state:**
- The issue body still carries every heading and line the maintainer wrote. Only the lines between `<!-- stuck-paths -->` and `<!-- /stuck-paths -->` changed, and the thread has an "Also stuck: …" comment for each added path.
- An ad-hoc session dir is never added, and one already listed is removed with a comment saying why.
- A listed dir that reconcile archives comes off the list in the same pass, and the record closes itself when the list empties. Paths another checkout listed stay put.
- The maintainer should feel the record is theirs to shape and reconcile only keeps its path list honest.

## Steps

### 1. Shape the record — `/claude-tweaks:specify #{n}`
- **URL:** `https://github.com/{owner}/{repo}/issues/{n}`
- **Action:** The maintainer rewrites the issue body into spec shape (Current State, Deliverables, Acceptance Criteria, Release Note). They keep the `<!-- stuck-paths -->` block with its markers on their own lines, and they keep the `<!-- fingerprint: reconcile-residue-… -->` marker.
- **Should feel:** Like editing any other backlog record. Nothing in the body is reconcile's except the marked block.
- **Should understand:** Reconcile finds the record by its fingerprint marker and edits only the line-anchored block. A mention of the marker inside prose or inline code is not treated as the block.
- **Red flags:** Deleting the fingerprint marker, which makes the next escalation file a duplicate record; deleting only one of the two block markers.

### 2. A newly stuck dir is added — the next reconcile pass, past the 7-day TTL
- **URL:** `https://github.com/{owner}/{repo}/issues/{n}`
- **Action:** `escalateStructurallyStuck` edits the open issue with `withStuckPaths(hit.body, paths)`. That rewrites just the stuck-paths block, in the body's own line endings, and posts an "Also stuck: `{path}`" comment.
- **Should feel:** Unobtrusive. The spec reads exactly as written, with one more path in the list.
- **Should understand:**
  - A CRLF body saved from the web editor stays CRLF.
  - A body that lost its block entirely gets the block appended rather than overwritten.
  - Only a CLOSED record being reopened is re-rendered in full, because a reopen is a fresh incident.
  - The same edit also drops any listed path under this checkout's own `.claude-tweaks/pipelines/` that is already gone, and the comment names each dropped path (step 4).
- **Red flags:** The issue's edit history showing the whole body replaced by the generic "Reconcile has one or more run directories stuck…" text while the record is open. Mixed line endings in a CRLF body.

### 3. Ad-hoc session dirs stay out of the list — same pass
- **URL:** —
- **Action:** For a `{ts}-adhoc-standalone` dir skipped at `no-branch`, `no-worktree` or `no-pr` whose `run-state.json` records a worktree (linked worktree or main checkout), `isAdHocIntrinsicSkip` is true. `classifyRunDir` then does not classify it `structurally-stuck`. If the dir already has an escalated cache entry, `trackStuckSkip` resolves its path off the record with a comment saying it is an ad-hoc session dir, and clears the entry only once the resolve lands.
- **Should feel:** Quiet. Ad-hoc dirs wait for their own sweep (`adhoc-superseded` for a linked worktree, once the worktree is unregistered and the dir has sat untouched for 30 days; `adhoc-session-ended` for the main checkout, once the session reads dead and the dir has sat untouched for 7 days) without ever appearing in the record.
- **Should understand:**
  - An ad-hoc dir stamped with the main checkout no longer escalates: `adhoc-session-ended` archives it once its session is dead (#4179). One whose liveness stays `unknown` stays in place.
  - An ad-hoc dir stuck at any other tracked reason (`merged-partial`, `pr-not-found`) still escalates.
  - A failed resolve keeps the cache entry, so the next pass retries.
  - `reconcile --dry-run` skips this clear entirely.
- **Red flags:** An ad-hoc path appended to the record. A listed ad-hoc path that never leaves the record after a `gh` failure. A `--dry-run` pass that edits the issue for an ad-hoc dir.

### 4. An archived dir leaves the list, and the record closes itself — the pass that archives it
- **URL:** `https://github.com/{owner}/{repo}/issues/{n}`
- **Action:**
  - When reconcile archives a listed dir, `trackArchiveResult` clears its escalated cache entry through `clearResidue`. That resolves the path off the record with a "no longer exists on disk" comment.
  - The same edit drops any other listed path under this checkout's own `.claude-tweaks/pipelines/` that is already gone. Those paths are named in the comment.
  - When nothing is left, the record closes with a comment.
- **Should feel:** Self-maintaining. The list only ever names dirs that are still stuck, and an emptied list closes the issue with no trip to the GitHub editor.
- **Should understand:**
  - Every checkout of the repo shares this one record, because its fingerprint ignores the path. So a pass judges only paths inside its own run-dir tree. A path from another machine or another clone is never dropped, even though it is absent from this disk.
  - A resolve that fails keeps the cache entry. The same pass's prune retries it once, then drops the entry.
  - Re-escalating a path the record already names makes no edit, so stale paths wait for the next real edit.
- **Red flags:**
  - An archived dir still listed after the pass that archived it succeeded.
  - A record that stays open with an empty list.
  - A path another checkout added disappearing from the list while that checkout's dir is still stuck.

## Origin
- Created during build of #2724 (reconcile: structurally-stuck run directories). The record's own shaped body had been erased by escalation passes on 2026-09-30, 2026-10-21 and 2026-10-24.
- Steps 1-3 built in that session.
- Step 4 added during build of #4202 (reconcile: archiving an escalated stuck dir drops its cache entry without resolving it). That build followed a 2026-10-24 hand cleanup that removed 20 archived-but-still-listed paths before #2724 could close.
- Step 3 widened during build of #4179 (reconcile: sweep main-checkout ad-hoc session dirs by session liveness). Main-checkout ad-hoc dirs are now exempt too, because `adhoc-session-ended` archives them once their session reads dead and 7 days have passed.
- Related journeys: `recover-a-run-stranded-by-a-stale-pr-number-3543.md`, `learn-a-merged-run-needs-you-3297.md` (other reasons that feed the same record).
