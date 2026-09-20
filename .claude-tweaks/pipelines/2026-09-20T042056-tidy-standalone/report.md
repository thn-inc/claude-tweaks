## Tidy Report — 2026-09-20

**Yours (2)**
```text
attention (2)
   #1728  claim stale, but PR #2535 already complete/pending-review    merge #2535 first — see note
   —      [doctor] PRODUCT.md schema-legacy (route)                    /impeccable:impeccable init
```

**Clean:**
```text
backlog (Shape 1)       39 checked
parked (Shape 2)        11 checked
scoring/blocked/legacy  142 checked
design docs             0 checked
plans/ledgers           14 checked
git/worktree/branch     clean (residue.js)
registry                23 entries checked
by:*-health issues      4 checked
parent-gate             3 parents checked
sizing                  0 candidates
patterns                0 artifacts (pr-first model keeps reviews in PR bodies)
digest                  16 entries checked
```

Degraded (partial coverage, disclosed — not reported as clean):
- claims-registry listing capped at 1000 entries (GitHub API cap) — same known gap as #2613
- Step 4.8 repo-wide: 50 open PRs' CI/review-thread/unarmed/unsettled/stale-pending checks not completed (no MCP fallback for per-PR reads; too many round-trips for this firing's budget)
- Step 4.8 acceptance-gap: spot-checked 100/~1556 closed issues only — likely a large standing (info-severity, never-blocking) set, not fully enumerated

Full decision log: .claude-tweaks/pipelines/2026-09-20T042056-tidy-standalone/decisions.md
