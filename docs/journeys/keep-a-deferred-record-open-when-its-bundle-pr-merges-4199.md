---
files:
  - plugin/bin/closing-links.js
  - plugin/bin/lib/flow/closing-links.js
  - plugin/bin/lib/flow/manifest.js
  - plugin/bin/lib/compose-subject.js
  - plugin/skills/_shared/pr-checklist-refresh.md
  - plugin/skills/_shared/pr-first-merge.md
  - plugin/skills/_shared/pr-first-merge-post-merge.md
---

# Keep a Deferred Record Open When Its Bundle PR Merges

**Persona:** Maintainer of a `pr-first` claude-tweaks repo whose multi-record `/claude-tweaks:flow` (or `/claude-tweaks:dispatch`) run defers one record's closure (for example, a deferred reason like "follow-up closes #N later") while the rest of the bundle ships. This is the PR #4144 / #2724 shape.
**Goal:** The finished records close when the run's PR merges. The deferred record stays open, and `decisions.md` says how that was ensured.
**Entry point:** The run reaches its pre-merge PR body refresh (`_shared/pr-checklist-refresh.md`), then merges through `_shared/pr-first-merge.md`.
**Success state:** After the merge, `gh issue view {n}` shows the deferred record OPEN. The run's `decisions.md` has the refresh's AUTO entry `rewrote Fixes block for PR #{pr} — {c} complete, {d} deferred, …`. A pre-merge check that found no stray link prints `"action": "clean"` and logs nothing; one that had to unlink a surviving link adds an AUTO entry `unlinked #{n} from PR #{pr} before merge`. If GitHub closed it anyway, there is also an AUTO entry `reopened #{n} after PR #{pr}'s merge closed it`. A clean post-merge pass prints `"action": "nothing-closed"` and logs nothing. The maintainer should feel that deferring a closure inside a bundle is safe.

## Steps

### 1. The pre-merge refresh rewrites the Fixes block — `composeFixesBlock`
- **URL:** `https://github.com/{owner}/{repo}/pull/{pr}`
- **Action:** The run rewrites the deferred record's line to `Refs #{n} — deferred: {reason}`. Any closing phrase inside the reason (`closes #{n}`, `resolves owner/repo#{n}`, `Fixed: <issue URL>`) becomes `closes issue #{n}`, a form GitHub does not link.
- **Should feel:** Invisible. The reason still reads naturally.
- **Should understand:** GitHub re-derives `closingIssuesReferences` from the *current* body on every edit. Any prose closing phrase anywhere in the body links the issue, not only the `Fixes` line.
- **Red flags:** A deferred reason in the PR body that still contains a bare `closes #{n}`.

### 2. The pre-merge closing-link check runs — `node "${CLAUDE_PLUGIN_ROOT}/bin/closing-links.js" --run "{run-dir}" --mode pre-merge`
- **URL:** —
- **Action:** The CLI reads the PR's body, `closingIssuesReferences`, and URL. It computes the linked records that the Fixes block does not name. When there are none (the usual case once step 1 has neutralized the reason), it prints `"action": "clean"` and logs nothing. Otherwise it neutralizes their closing phrases elsewhere in the body, writes the body back, re-reads it, and logs one of two outcomes:
  - `unlinked #{n} from PR #{pr} before merge` (AUTO)
  - `#{n} still linked to PR #{pr} after neutralizing` (SKIP, degraded)
- **Should feel:** One log line, no prompt.
- **Should understand:** The check refuses to edit a PR whose run marker does not match the run (exit 4). Exits 3 to 5 warn and the merge proceeds; the post-merge pass is the safety net. `gh-absent`, exit 4 and exit 5 log their own `SKIP` under `## /wrap-up`; exit 3 is logged by hand.
- **Red flags:** An `unlinked #{n}` entry while a live `gh pr view {pr} --json closingIssuesReferences` still lists `{n}`; any edit to a PR that belongs to a different run.

### 3. The squash merge composes `Refs #{n}` — `compose-subject.js --keep-open {n}`
- **URL:** —
- **Action:** `pr-first-merge.md` Step 3 passes the deferred record as `--keep-open`. The squash body then writes `Refs #{n}` for it and `Fixes #{m}` only for the finished records.
- **Should feel:** Nothing to do. The merge message matches the PR body's intent.
- **Should understand:** The merge commit message is a second closing channel, independent of the PR body. Both have to be clean.
- **Red flags:** `Fixes #{n}` in the merged commit's message for a deferred record.

### 4. The post-merge reopen pass runs — `node "${CLAUDE_PLUGIN_ROOT}/bin/closing-links.js" --run "{run-dir}" --mode post-merge` (`pr-first-merge-post-merge.md` Step 4.0)
- **URL:** `https://github.com/{owner}/{repo}/issues/{n}`
- **Action:** The CLI polls each candidate that could have closed for a short settle window. It reopens any candidate closed at or after the merge, with a comment naming the PR. It prints the worst outcome as `action`, and logs each reopen, failure, and pending close to `decisions.md`:
  - `reopen-failed`
  - `close-pending`
  - `reopened`
  - `nothing-closed`
- **Should feel:** Reassuring. Even if GitHub closed the record, it is back open within seconds, and the comment says why.
- **Should understand:** `close-pending` means the record was still open at the end of the window but may close later. Re-check it with `gh issue view {n}`. The armed-merge (`--auto`) path merges later and is a known gap.
- **Red flags:** The deferred record closed with no `reopened` or `reopen-failed` entry; a reopen of a record the run actually finished.

## Origin
- Created during build of #4199 (pr-first: rewriting Fixes #N to Refs #N before merge does not stop GitHub closing #N)
- Steps 1-4 built in this session; mechanism probed live on throwaway PR #4234 / issue #4233
- Related: #3412 (reconciler keeps an unfinished record's claim when its bundle PR merges early), #2724 (the record PR #4144 closed by mistake)
