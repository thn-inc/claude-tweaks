# Tidy — staged Close (GitHub): #3979

**Action:** Close (GitHub), completed
**Record:** #3979 — Route isDeadRunDir, abandoned-interrupted recency and resume-freshness through run-liveness, then delete the copies
**Reversibility:** med (outward GitHub write; `gh issue reopen 3979` undoes it)

## Why

All four sub-issues of this decomposition parent are closed COMPLETED: #4419 and #4420/#4421 via PR #4425
(squash `07e544d10`), and #4422 via PR #4440 (squash `8c630a24a`). The parent gate is `due`, but the highest
sub-issue risk is `medium`, below the project's `risk-floor: high`. So
`wrap-up/verification-brief-parent-gate.md`'s `exceeds: false` branch applies: "the parent closes cleanly:
no `demo:pending`, no brief". Nothing in the pipeline actually performs that close, though. The parent
stays open with no remaining work, and Step 4.8's `parent-gate` scope filters it out before emitting, so no
later sweep will surface it again.

## Mutation on approval

1. Re-read the sub-issue states (all four must still be CLOSED) before writing.
2. Post a comment, then close:

```
gh issue comment 3979 --repo thn-inc/claude-tweaks --body "All four sub-issues closed: #4419, #4420 and #4421 via PR #4425 (07e544d10), and #4422 via PR #4440 (8c630a24a). Max sub-issue risk is medium, below risk-floor high, so the parent closes cleanly with no demo gate (verification-brief-parent-gate.md, exceeds: false). Closed by /claude-tweaks:tidy."
gh issue close 3979 --repo thn-inc/claude-tweaks --reason completed
```

## Decision-log reference

STAGED — Step 6: Close (GitHub) #3979, a below-floor decomposition parent whose sub-issues are all closed. Stage path: staged/tidy-close-1.md.
