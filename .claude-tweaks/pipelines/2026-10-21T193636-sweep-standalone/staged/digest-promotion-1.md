# Staged: Propose digest cluster — [hooks] (3 entries)

Finding: [digest] digest container #1426 holds 3 un-promoted entries sharing area `hooks`. That clears the 3-entry threshold for cluster promotion.
Proposed: file one spec-shaped backlog record absorbing them, then append `→ #{new}` to each promoted entry line in #1426 (comment ids: 5405348374, 5657007652, 6294229872).

## Proposed record

**Title:** hooks: resolve 3 accumulated below-floor digest findings

### Current State
The materiality-floor digest (#1426) has accumulated 3 below-floor findings in the `hooks` area. Each was too small to file on its own, but together they make a coherent unit of work.

### Deliverables
- delete-only push exemption grammar admits only the exact `git push <remote> --delete <branch>` shape — the `git -C <path> push …` form worktree sessions standardly use is denied, with the gate message's own `gh api -X DELETE` fallback as the retry path — plugin/bin/lib/hooks/pre-tool-use.js:244 — Defer-reason: pre-existing-outside-diff — 2026-08-24T183516-tidy-followups-standalone
- The working-directory/git-discipline PreToolUse guard denied a plain non-git command (a bin/log-decision.js call) solely because its --text prose string contained the substring 'git show' inside a sentence describing an evidence-gathering method, not an actual git invocation -- the guard appears to pattern-match command text for git-like phrases rather than parsing actual subcommands. — plugin/bin/lib/hooks/pre-tool-use.js — Defer-reason: pre-existing-outside-diff — 2026-09-13T230428-record-2271
- runGit returns stdout.trim(), so a -z reader built on it (archive-merged.js archiveRunDir guard, sweep-stray-run-dirs.js hasTrackedWork) loses leading whitespace on its first path; every affected path today starts with .claude-tweaks/, so no live reader is hit — plugin/bin/lib/hooks/git-exec.js — Defer-reason: pre-existing-outside-diff — 2026-10-20T134331-record-3651

### Acceptance Criteria
- Each Deliverable above is fixed, or explicitly ruled won't-fix with a one-line reason in the closing PR.
- Each promoted digest entry line in #1426 carries `→ #{this record}`.

## Commands
gh issue create --repo thn-inc/claude-tweaks --title "hooks: resolve 3 accumulated below-floor digest findings" --body-file <this proposal's Proposed record section>
