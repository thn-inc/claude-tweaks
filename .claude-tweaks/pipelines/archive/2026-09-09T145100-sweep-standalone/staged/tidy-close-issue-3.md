# Staged: Close (GitHub) — #1784 (already implemented)

**Finding:** `[gh-issue] #1784: verify.js: verify-pass stamp is written by the agent, not the runner` (`enhancement`, `priority:high`) — surfaced by the sweep's specify drain, refused at shaping: the requested change already shipped under #1921. Evidence: `plugin/bin/lib/verify/stamp.js` and `args.js`'s `--no-stamp`/`--stamp-status` flags; `plugin/skills/test/verification.md` Step 2.5 reads "The runner stamps; agents never do (#1921)" and its bullet "(#1784: an agent-written stamp once recorded a `pass: false` run as a pass)" cites this record as the resolved incident.

**Proposed:** Close #1784 as completed — implemented by #1921.

**Why staged:** closing a `github-issues` record is an outward-facing write, Stage at every tier.

**Commands:**
gh issue comment 1784 --body "Closing as implemented: #1921 moved the verify-pass stamp write into bin/verify.js (runner-written on a full green run, --no-stamp for partial runs); skills/test/verification.md Step 2.5 cites this record as the resolved incident. Filed by /claude-tweaks:sweep (run 2026-09-09T145100)."
gh issue close 1784 --reason completed
