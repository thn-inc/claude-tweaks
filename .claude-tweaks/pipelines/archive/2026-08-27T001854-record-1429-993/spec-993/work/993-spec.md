---
record: 993
origin: harness-health
risk: low
size: low
ceremony: standard
grants: [build, merge]
fingerprint: harnesshealth-75526ce6
---
# 993: CLAUDE.md best-practice: CLAUDE — Stack

**CLAUDE.md:** CLAUDE | **Section:** Stack | **Category:** best-practice | **Classification:** additive | **Confidence:** med

## Current State

CLAUDE.md is always-loaded and inherited by every dispatched subagent; the version number adds context cost without changing what the model does today. The project's own incident log (docs/incident-log.md:481) records a real incident where a stale sandbox build treated a version-gated capability's history as current status — hardcoding a shipped-since version in always-loaded prose is exactly the pattern that incident warns against. Removing the version anchor states the same current fact without a value that ages.

## Deliverables

**Current:**
```
Not required since 6.24.0 — a `gh`-absent env (typically cloud Routine sandbox) routes the same CRUD via `_shared/github-write-transport.md`'s MCP path
```

**Proposed:**
```
Not required — a `gh`-absent env (typically cloud Routine sandbox) routes the same CRUD via `_shared/github-write-transport.md`'s MCP path
```

## Acceptance Criteria

The Dependencies row's gh-CLI note carries a hardcoded version anchor ('Not required since 6.24.0') that is pure provenance narration — it explains when a capability shipped rather than what the capability currently is, and drifts as more releases accumulate without informing any current-session behavior.

_Filed by `/claude-tweaks:harness-health`. Close to resolve; label `wontfix` to suppress future reports of this finding._

<!-- work-fingerprint: harnesshealth-75526ce6 -->
