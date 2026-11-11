# Staged: Propose digest cluster — hooks (4 entries)

**Container:** #5046 (digest)
**Proposed record title:** Settle 4 below-floor digest findings in hooks

## Current State

4 un-promoted digest entries in #5046 share the area `hooks`. Each was logged below the materiality floor; together they clear the 3-entry cluster threshold.

## Deliverables

- hooks.js ledger-row reports every LOCK_TIMEOUT as "the ledger lock is held … retry once", but file-lock.js returns the same code when the lock directory cannot be created (EACCES/ENOTDIR/EROFS), where a retry can never succeed — plugin/bin/hooks.js:1362, plugin/bin/lib/file-lock.js:105 — Defer-reason: pre-existing-outside-diff — 2026-11-04T064731-release-standalone
- guard-rewrite.js's header says its top level loads only path and ./path-guard; it requires ../path-guard and ../shared-primitives — plugin/bin/lib/hooks/guard-rewrite.js:45 — Defer-reason: pre-existing-outside-diff — 2026-11-04T064731-release-standalone
- repoSpecOf's loose owner/repo fallback gives a remote on an unknown non-GitHub host with a nested path (a GitLab subgroup) a bare slug that resolves to github.com instead of the unknown-host refusal; the fallback predates #4794 and shares its shape with the cloud sandbox proxy remote, so telling them apart needs a decision — plugin/bin/lib/hooks/git-exec.js — Defer-reason: needs-human-decision — 2026-11-04T100347-record-4794
- review tiebreak refuted the claim that repoTargetOf's slug and ghRepo strings are interchangeable by type but its cited evidence line fell outside the verification window, so the verdict is unverified — plugin/bin/lib/hooks/git-exec.js — Defer-reason: tiebreak-cant-tell — 2026-11-04T100347-record-4794

## Acceptance Criteria

- Each Deliverables bullet is fixed or explicitly ruled not-a-defect, with the ruling recorded on the record.
- `npm test` passes.

## On approval

File the record above, then append `→ #{n}` to each promoted entry line in #5046 (digest-sweep.md Cluster promotion).

## Entry fingerprints

- materiality-fingerprint: materiality-390fd5dd — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6637961522
- materiality-fingerprint: materiality-128b2436 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6637961522
- materiality-fingerprint: materiality-70246921 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6650054615
- materiality-fingerprint: materiality-0441e0a2 — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-6650054615
