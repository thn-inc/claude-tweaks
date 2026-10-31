# Open Items — qa-agent / stories: scrub one-time secrets from QA artifacts (#4477)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | `/claude-tweaks:walkthrough` runs a story's steps and encodes a shareable GIF with one frame per step; a story declaring `secrets:` would put its revealed value into those frames, and nothing in walkthrough reads `secrets:` (follow-up — #4477 scoped the QA run only) | resolved | Defer-reason: needs-human-decision — filed as follow-up record #4606 |
| 2 | ops | Plan executed in-session: this dispatched Task call had no Agent tool, so no clean-room implementer, per-task reviewer, plan reviewer or code-simplifier ran (execution-mode-policy #491 non-compliance, logged in decisions.md) | resolved | Addressed: this call's `/claude-tweaks:review` (also no Agent tool available) performed an independent self-judged code review of the branch — see decisions.md "Code review" entry. No blocking findings. |
