---
files:
  - plugin/bin/hooks.js
  - plugin/bin/lib/reconcile/archive-merged.js
  - plugin/bin/lib/reconcile/index.js
---

# See the Commit an Archival Made

**Persona:** A maintainer, or an agent session acting for one, who archives a closed pipeline run from the main checkout and then pushes or deploys from that checkout. Also a script reading `hooks.js reconcile --json`.
**Goal:** Learn from the archival's own output that it committed on the checked-out branch, which commit that was, and whether it is still unpushed, without running `git log` or finding out when a deploy refuses to run.
**Entry point:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" archive-run --run <dir>` for a run whose `work/` is git-tracked.
**Success state:**
- Stdout carries one line naming the commit, the branch and the push state, for example `claude-tweaks: committed 3f2a91c on main (not pushed — 1 ahead of origin/main)`.
- A run with nothing tracked prints no such line.
- `hooks.js reconcile --json` carries the same `commit` object on that run's entry.

## Steps

### 1. Archive a run with tracked work
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" archive-run --run <dir>`
- **Action:** Run the verb from the main checkout or from a linked worktree, and read stdout.
- **Should feel:** Like nothing is hidden. The `moved:` lines and `claude-tweaks: archived {run-id}` are followed by `claude-tweaks: committed {sha} on {branch} ({push state})`.
- **Should understand:**
  - The commit is on the main checkout's branch, even when the verb ran from a worktree.
  - The push state reads `not pushed — {n} ahead of {upstream}`, `no upstream configured` (a detached HEAD included), or `push state unknown`.
  - `claude-tweaks: archived {run-id}` is still the only line that means archived.
- **Red flags:**
  - An archive that moved tracked `work/` files and printed no `committed` line.
  - A count taken from the worktree's branch rather than the main checkout's.

### 2. Archive a run that committed and then refused
- **URL:** The same command, on a run holding a stray git-tracked file outside `work/`.
- **Action:** Read stdout, and fix the refusal it names.
- **Should feel:** Like an honest partial result: the refusal says the archive is not finished, and the next line says the first half already committed.
- **Should understand:** `archival refused — tracked-entry` means not archived. The `committed` line beside it is real, and a retry will not report that commit again, because the moved files are already gone from `work/`.
- **Red flags:** A refusal after a landed commit with no `committed` line, so `ahead 1` shows up later with no explanation.

### 3. Read a line that could not name everything
- **URL:** The same command, when a git probe fails after the commit (a timeout under load) or a sibling session commits in the same instant.
- **Action:** Read the fallback line, then check `git log` for what it could not name.
- **Should feel:** Like a precise admission. `claude-tweaks: committed the archive move on main but could not read its sha (push state unknown)` says what is known and what is not.
- **Should understand:** A placeholder never stands in for a sha, and `detached` appears only when git says HEAD is detached, never because a probe went unanswered.
- **Red flags:** `committed unknown on main`, or a real branch reported as `detached`.

### 4. Read the commit from reconcile
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" reconcile --json`
- **Action:** Find the run's entry in `runs`.
- **Should feel:** Like the same fact in a machine-readable place.
- **Should understand:** An entry whose archival attempt committed carries `commit: { sha, branch }`, whether its `action` is `archived` or `skipped`. An entry whose attempt committed nothing has no `commit` key. `sha` or `branch` is `null` when its probe failed.
- **Red flags:** A `skipped` entry whose attempt committed, with no `commit`.

## Origin
- Created during the build of #3721, reported from a consuming project whose deploy script hard-stops when local `master` is ahead of origin, and seen again here when a sweep left four unreported `[reconcile] archive run` commits on local `main`.
- Related record: #3396 tracks the mechanism that leaves those commits unpushed. This journey covers the output only.
