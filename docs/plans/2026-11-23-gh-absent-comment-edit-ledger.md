# Open Items — Map or document the gh-absent issue-comment edit in the GitHub write transport

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 17 commits ahead of local HEAD at run start | observation | Post-creation catch-up merged origin/main into the worktree branch (6adac5cd to 9e0c7183) before any work |
| 2 | build | SDD ruling — reword plan-mandated "so every run would store the plan" (planning-answer.md:7) to "so such a run would": ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | review | Error handling (medium): shaping-mode-stamping.md:147 gh-absent listing read had no fail-closed rule; a failed or short-paged issue_read could drop the needs:decision label | fixed | Fixed in 2c8b82997 — a failed or short-paged listing keeps the label; selection and read-failure clauses pinned |
| 4 | review | Architecture (medium): tidy/digest-sweep.md:146 still said the transport has no MCP row for a comment edit | fixed | Fixed in 2c8b82997 — gh-absent rollover applies carried marker edits with update_issue_comment; pinned |
| 5 | review | Convention (low): two conformance-test nits — single-line includes absence check (specify-planning-answer test:256) and a local lineStarting duplicating the shared lineStartingWith (comment-edit test:12) | fixed | Fixed in 2c8b82997 — whitespace-tolerant absence check; shared helper imported |
| 6 | review | Ownability (low): github-write-transport.md:26 edit row's facts had no recorded probe source | fixed | Fixed in 2c8b82997 — row cites github-mcp-server @9a72d8d issues.go:1593 and minimal_types.go:671 |
