# Open Items — Record the root cause of the unattended merge-question stall that #2734 was filed for

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 5 commits ahead of local main at run start (auto-continued); caught up by the worktree's post-creation merge (d170e1b4e → d5c432999) | open | — |
| 2 | build | Task 1 injected-reader test weakly discriminating (repo policy.yml is unattended, so the real reader would also deny) | fixed | Fix wave 990cbecd0: run config `supervised` + injected `unattended` proves the injection is used |
| 3 | build | Task 1: no test asserts the deny's friction event lands in events.jsonl | fixed | Fix wave 990cbecd0: event now `gate-denial`/`gate: review-console-ask`, asserted by a test reading events.jsonl |
| 4 | build | docs/hooks.md tiered-posture bullet: the gate description is a long parenthetical in a dense bullet; could move to its own bullet like the Powershell gate | deferred | Readability only, accurate as written (Task 2 + final review: defer) |
| 5 | build | tests/hooks-dispatcher.test.js no-owned-run test passes with or without the matcher (never-break pin only) | deferred | By design — AC6.1 matcher test discriminates registration (final review: accept) |
| 6 | build | Conformance test uses `askLines.some(...)`: a future extra AskUserQuestion line copying the "Review Console" header could mask drift on the real one | deferred | Each console file has exactly one such line today; keying on question text couples to more prose (final review: accept) |
| 7 | build | Under a live prose mutation the conformance drift-control test also goes red (two failures per drift) | deferred | Harmless noise (final review: accept) |
| 8 | build | IL-166 "which read it in one run, asked anyway" ambiguous | fixed | Fix wave 990cbecd0: "which read the equivalent prose in run 1" |
| 9 | build | docs/donts.md IL-166 rule is long for a one-line rule | deferred | Matches IL-154..165 length (task + final review: accept) |
| 10 | build | SDD ruling — Task 3: committed go-red control tests + loud could-not-find-pin failure beyond the plan's manual mutation: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 11 | build | SDD ruling — final-review fix wave also took Minors 3-6 and the IL-166 nit: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 12 | build | SDD ruling — live probe that Claude Code honors a PreToolUse deny on AskUserQuestion routed out of the fix wave: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 13 | build | Deny reason's exit-5 route is implied, not stated — `pre-tool-use.js` deny text should name `_shared/console-on-pr.md`'s Headless conclusion (report pending-review with the PR URL, no question) (parked from SDD final review; one-line wording fix for /review) | open | — |
| 14 | build/skill | pre-tool-use-gate-exemptions documents "every unprovable answer fails CLOSED" for exemptions; the Review Console ask gate (`checkReviewConsoleAskGate`) is the first deny keyed on a non-Bash tool's input field (`AskUserQuestion` header) and deliberately fails OPEN on every unprovable answer — the skill could name the deny-gate direction alongside the exemption one | open | — |
