---
files:
  - plugin/bin/console-resolve.js
  - plugin/bin/lib/console/resolve.js
  - plugin/bin/lib/dispatch/merge-verdict.js
  - plugin/skills/wrap-up/execution-and-verification.md
  - plugin/skills/_shared/local-merge-auto-finish.md
  - plugin/skills/flow/multispec-review-console.md
  - plugin/skills/wrap-up/review-console.md
---

# Trust an Unattended Merge to Honour a Late Needs-Human Verdict

**Persona:** A claude-tweaks maintainer who runs records unattended (`autonomy: unattended`, `consoleAutoResolve`) and the next morning reads `decisions.md`, `console.json` and the PR list. They decide whether to keep `auto:merge` grants after a run (#5770, PR #5780) recorded `merge.resolution: merge` 43 seconds before its `merge-check` verdict came back `needs-human`. Only a manual hold kept that PR from merging.
**Goal:** No unattended merge site merges a PR or branch while a `merge-check` verdict asks for a human. It also refuses while a member's passing verdict is missing or malformed, whatever order the console resolve and the verdict line were written in.
**Entry point:** The run reaching one of three merge sites:
- `/claude-tweaks:wrap-up`'s Branch finish (`wrap-up/execution-and-verification.md`, `pr-first`) with a stored `merge`
- the `local-merge` no-prompt finish (`_shared/local-merge-auto-finish.md` step 2a)
- a multi-spec run's Shared teardown (`flow/multispec-review-console.md` step 2)

**Success state:** `decisions.md` holds one `Merge re-check:` line naming the verdict, `console.json`'s stored `merge` now reads `leave-open` with `recheckedFrom: merge`, and the PR or branch is still open, awaiting the maintainer. On an in-order run, where the passing verdict was logged before the resolve, nothing changes: the merge lands as before.

## Steps

### 1. The console resolve names a stale merge half
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --run "$PIPELINE_RUN_DIR" --policy console-auto`
- **Action:** The resolve shape computes the merge half. When a member carries the grants but has no confirmed passing `merge-check` verdict in `decisions.md` yet, it still writes `merge.resolution: merge` and prints `console-resolve.js: merge half stale — #N: no confirmed merge-check verdict in decisions.md yet (latest: none) — …` on stderr.
- **Should feel:** Honest. The console does not pretend a merge decision is final when the verdict it depends on has not been logged.
- **Should understand:** The stored `merge` object is byte-identical to before #5833, so older readers keep working. Staleness is never stored in `console.json`; `--json` carries it as `mergeStale`. A stale half is not a resolved merge, and the merge site's re-check decides.
- **Red flags:** A stale line on stderr for a run whose `decisions.md` already holds `Auto-merge short-circuit: #N assess-agent-autonomy verdict auto-merge` for every member. That means the in-order path regressed.

### 2. The merge site re-checks right before merging
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --run "$PIPELINE_RUN_DIR" --recheck-merge` (for a multi-spec teardown, `--run "$MULTISPEC_PARENT_DIR"`)
- **Action:** Under the console lock, the CLI reads `decisions.md` and `console.json`. A needs-human verdict, a malformed verdict line, or (when the console stored `merge`) a member still unconfirmed is a hit. On a hit it appends one `Merge re-check:` line first, then rewrites the stored `merge` to `leave-open`, and prints `console-resolve.js: recheck-merge leave-open — {verdict}`. On no hit it prints `console-resolve.js: recheck-merge merge — … (stored: {merge|leave-open|none})`.
- **Should feel:** Mechanical. One command, one decisive stdout line, and every exit other than a clean `recheck-merge merge` means "do not merge".
- **Should understand:**
  - Exit codes: 3 means the lock was not taken, a read failed, or a write failed. 5 means `console.json` would not parse. 2 is a malformed call. In each of these cases the site skips the merge and writes one `SKIP` line.
  - Running it twice logs nothing more.
  - An attended "Approve all + merge" in Branch finish skips the re-check, because a human's choice is never re-judged.
  - The `local-merge` finish parks on any needs-human verdict, in-order or late.
- **Red flags:**
  - A merged PR whose `decisions.md` has a needs-human `merge-check` line and no `Merge re-check:` line. The site skipped the re-check.
  - A second `Merge re-check:` line for the same verdict. The duplicate check regressed.

### 3. The run parks where a human will see it
- **URL:** `wrap-up/execution-and-verification.md` Branch finish → `pending-review`; `_shared/local-merge-auto-finish.md` Park branch; multi-spec Shared teardown "leave PR open"
- **Action:** The site skips the merge and lands on the same resting state a console leave-open would.
- **Should feel:** Safe, and it explains itself. The PR is open, and the one log line names exactly which verdict stopped it.
- **Should understand:** `engine-verify`'s pending-review skip reads the rewritten `console.json` `leave-open`, so the parked run does not show up as a failed merge.
- **Red flags:** A parked run whose `console.json` still reads `merge` after a hit. The rewrite failed after the line landed (exit 3); repair `console.json` before trusting the verify verdict.

## Origin
- Created during build of #5833
- Related: #5770 / PR #5780 (the incident), #2941 (`trust-a-singleton-auto-merge-to-refuse-without-a-verdict-2941.md`, the short-circuit's own verdict backstop)
