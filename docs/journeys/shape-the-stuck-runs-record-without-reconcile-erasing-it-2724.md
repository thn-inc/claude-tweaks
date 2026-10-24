---
files:
  - plugin/bin/lib/reconcile/escalate-residue.js
  - plugin/bin/lib/reconcile/archive-merged.js
  - plugin/bin/lib/reconcile/cache.js
---

# Shape the Stuck-Runs Record Without Reconcile Erasing It

**Persona:** A claude-tweaks maintainer working through the backlog, who has just shaped reconcile's consolidated `reconcile: structurally-stuck run directories` issue into a spec with `/claude-tweaks:specify`. Background reconcile passes from every other open session keep touching that issue while they work.
**Goal:** The spec text they wrote stays on the record while reconcile keeps its stuck-path list current, and ad-hoc session dirs that clean themselves up never land in that list.
**Entry point:** Any reconcile pass that adds or removes a stuck path on the consolidated issue: session start's `node plugin/bin/hooks.js reconcile-background` in any session, or a `/claude-tweaks:tidy` sweep.
**Success state:**
- The issue body still carries every heading and line the maintainer wrote. Only the lines between `<!-- stuck-paths -->` and `<!-- /stuck-paths -->` changed, and the thread has an "Also stuck: …" comment for each added path.
- An ad-hoc session dir stamped with a linked worktree is never added, and one already listed is removed with a comment saying why.
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
- **Red flags:** The issue's edit history showing the whole body replaced by the generic "Reconcile has one or more run directories stuck…" text while the record is open. Mixed line endings in a CRLF body.

### 3. Ad-hoc session dirs stay out of the list — same pass
- **URL:** —
- **Action:** For a `{ts}-adhoc-standalone` dir skipped at `no-branch`, `no-worktree` or `no-pr` whose `run-state.json` records a linked worktree, `isAdHocIntrinsicSkip` is true. `classifyRunDir` then does not classify it `structurally-stuck`. If the dir already has an escalated cache entry, `trackStuckSkip` resolves its path off the record with a comment saying it is an ad-hoc session dir, and clears the entry only once the resolve lands.
- **Should feel:** Quiet. Ad-hoc dirs wait for their own 30-day `adhoc-superseded` sweep without ever appearing in the record.
- **Should understand:**
  - An ad-hoc dir stamped with the main checkout keeps escalating. The main checkout is always registered, so `adhoc-superseded` can never claim it.
  - An ad-hoc dir stuck at any other tracked reason (`merged-partial`, `pr-not-found`) keeps escalating too.
  - A failed resolve keeps the cache entry, so the next pass retries.
  - `reconcile --dry-run` skips this clear entirely.
- **Red flags:** A linked-worktree ad-hoc path appended to the record. A listed ad-hoc path that never leaves the record after a `gh` failure. A `--dry-run` pass that edits the issue for an ad-hoc dir.

## Origin
- Created during build of #2724 (reconcile: structurally-stuck run directories). The record's own shaped body had been erased by escalation passes on 2026-09-30, 2026-10-21 and 2026-10-24.
- Steps 1-3 built in this session.
- Related journeys: `recover-a-run-stranded-by-a-stale-pr-number-3543.md`, `learn-a-merged-run-needs-you-3297.md` (other reasons that feed the same record).
