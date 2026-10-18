# Staged: Delete (GitHub) — #986

**Finding:** [parked] "Live-verify #488's chunked Instructions-fill procedure against a multi-KB prompt" — 59d stale — trigger (interactive routine create on a multi-KB prompt) not observed.

**Proposed:** Close as not planned — parked 59d, stale, trigger not met

**Why:** Shape 2 — neither trigger met and the record is Stale; recommendation Re-evaluate or delete. Closing a GitHub issue is outward-facing, so it stages at every tier.

**Commands:**

```bash
gh issue comment 986 --body "Closed by /claude-tweaks:tidy: parked 59d with its trigger unmet; reopen if it fires." && gh issue close 986 --reason "not planned"
```

Re-verify before applying: the record is still open, still `parked`, and its trigger still unmet.
