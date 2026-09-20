# Capture — specify drain eligibility admits the digest container (#1426)

**Finding:** the headless bare `specify` drain's eligibility filter (open issues without `ready`, `parked`, `parent-issue`, `bot:in-progress`, or any `needs:*`) admitted #1426 "Digest — rolling container for below-floor deferred findings", whose own body says it is "a container, not a work record — never shaped, scored, or closed as one". This sweep claimed it, recognized it on read, released the claim with reason `failed: shaping — digest container`, and added it to the run's attempted set so it is not re-picked this run. Every future drain will re-claim it once per run until the filter excludes it.

**Proposed:** one backlog record via `/claude-tweaks:capture`:

> **Title:** specify drain: exclude `digest`-labeled container issues from bare-drain eligibility
> **Current State:** `specify/next-mode.md`'s eligibility rule excludes `ready`, `parked`, `parent-issue`, `bot:in-progress`, and `needs:*` only; the digest container (label `digest`, `_shared/materiality-floor.md`) passes the filter and is claimed, read, and refused every run — one wasted claim/release cycle and two log lines per drain.
> **Deliverables:** add `digest` to the excluded label set in `next-mode.md` (and any queue-pull helper that mirrors it); a conformance assertion that the exclusion list names `digest`.
> **Acceptance Criteria:** a bare drain against a queue whose only unshaped open issue is the digest container reports remaining 0 without claiming it; existing exclusions unchanged.
> **Defer-reason:** tangential

**Why staged:** headless sweep never files records on its own; the capture is a human-approved write.

**Rows:**

| # | Issue | Action |
|---|-------|--------|
| 1 | #1426 | Not a work record — refused (claim released); file the exclusion record above |

**Commands:**

```
/claude-tweaks:capture "specify drain: exclude digest-labeled container issues from bare-drain eligibility"
```
