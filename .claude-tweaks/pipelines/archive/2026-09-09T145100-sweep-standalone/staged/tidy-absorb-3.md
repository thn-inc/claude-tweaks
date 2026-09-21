# Staged: Absorb — #1858 → #1826

**Finding:** `[gh-issue] #1858: Dispatch-adopted, pre-minted-empty run dir: build phase silently skipped BOTH config.yml (Manifesto) and the PR-early bootstrap` (`risk:medium`, `size:medium`, `type:bug`, `priority:high`) — the same defect as #1826 (two-call handoff leaves the run directory uninitialized). The sweep's specify drain shaped #1826 as the consolidated record: its Current State carries this run (`2026-09-04T181649-record-1484`) and #1858's adopt-inherited-run-dir-guard hypothesis as candidate cause (b), its Deliverables include the fixture-repo regression test and the SKIP degrade-trace requirement, and its Acceptance Criteria include #1858's "silence is never a passing outcome" rule for the PR-early bootstrap. The `gh`-absent angle #1858 raises rides #1826's diagnosis deliverable (candidate cause enumeration names the transport).

**Proposed:** Absorb #1858 into #1826 — comment `Absorbed into #1826.` and close with `--reason "not planned"`.

**Why staged:** Absorb of a `github-issues` record closes an issue — Stage at every tier.

**Commands:**
gh issue comment 1858 --body "Absorbed into #1826 (consolidated two-call-handoff record; carries this run's occurrence, the adopt-guard hypothesis, and the silence-never-passes AC)."
gh issue close 1858 --reason "not planned"
