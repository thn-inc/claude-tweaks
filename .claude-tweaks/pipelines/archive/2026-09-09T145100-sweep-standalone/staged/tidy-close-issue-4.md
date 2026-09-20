# Staged: Close (GitHub) — #1854 (already implemented)

**Finding:** `[gh-issue] #1854: consoleAutoResolve path never writes console.json, so archive-merged.js never archives an unattended-resolved run's directory` (`risk:low`, `size:low`, `type:bug`, `priority:high`) — surfaced by the sweep's specify drain, refused at shaping: the deliverable shipped under #1932 (closed 2026-09-07). Evidence: `plugin/skills/wrap-up/review-console.md`'s Auto-resolution short-circuit now runs `bin/console-resolve.js`, which "writes `{run-dir}/console.json` (`{resolved: true, mode: 'auto-resolve', at, ceiling, items, merge}` — the write the reconciler's archival needs, #1854)"; the run this record cited (`2026-09-04T150648-record-1688`) now sits under `.claude-tweaks/pipelines/archive/`.

**Proposed:** Close #1854 as completed — implemented by #1932.

**Why staged:** closing a `github-issues` record is an outward-facing write, Stage at every tier.

**Commands:**
gh issue comment 1854 --body "Closing as implemented: #1932's console-resolve.js writes {run-dir}/console.json on the consoleAutoResolve path (review-console.md cites this record); the record-1688 run dir has since been archived. Filed by /claude-tweaks:sweep (run 2026-09-09T145100)."
gh issue close 1854 --reason completed
