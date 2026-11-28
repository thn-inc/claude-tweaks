## Review: #3831 — Align /visualize and /review on whether review passes --source review (draft PR #6211)

**Review effort:** low (derived from record labels: risk:low × size:low; the diff heuristic agrees: 2 files, 9 lines, no merge-sensitive path)

### Spec Compliance
| Deliverable | Status |
|-------------|--------|
| Remove `review` from `visualize/SKILL.md`'s "Used by" diagram, `--source` callers list, Step 3 placement table, and Component-Skill Contract invoker list | done |
| Leave `step3-doc-freshness-lens.md`'s recommendation a plain direct invocation; if "Used by" still mentions review, describe it as recommending a direct invocation | done — the lens file is untouched; "Used by" now reads "ad-hoc direct invocation (including as recommended by /claude-tweaks:review)" |
| Update `docs/skill-graph.md`'s `/visualize` → `/review` row to the settled relationship | done — `docs/skill-graph.md:759` |

| Acceptance Criterion | Status |
|---------------------|--------|
| Placement table has no `review` row; `--source` callers list names only `journeys` and `specify` | met |
| `visualize/SKILL.md` no longer names `/claude-tweaks:review` as a Component-Skill Contract invoker | met |
| `step3-doc-freshness-lens.md`'s finding text unchanged | met (file not in the diff; line 36 still reads `Consider \`/claude-tweaks:visualize {type} {topic}\``) |
| `docs/skill-graph.md`'s `/review` row no longer describes a divergence | met |
| `npm test` passes, incl. skill-graph / `/help` diagram conformance suites | met — PR CI (`test` + 4 shards) green on 22535de; local impact-selected run after this review's fix: 6598 tests, 0 fail, 1 skipped |

Risk markers: none unresolved. Current-State outcome: reached — the disagreement the record named is resolved in both files it cited. Gotcha check (`/help` diagrams drawing a review→visualize arrow): `/help`'s reference card and context-flow carry no such arrow; `README.md`'s lifecycle diagram did ("review … calls: … visualize"). This review fixed it (finding 1 below). The builder's PR body says it did not check this.

### Verification (from /test)
- Runner stamp: `verifiedHead: true` (scoped pass at 22535de on fullSha 88cdbe8; clean tree)
- PR checks: `test`, shards 1/4–4/4 SUCCESS (label/cleanup jobs skipped)
- Re-verify after the review's fix wave: `npm test` (impact-selected) — 6598 tests, 6597 pass, 0 fail, 1 skipped

### QA Validation (from /test)
- **Status:** Skipped — no stories

### Code Review Findings (confirmed)
| Category | Finding | Severity | Action |
|----------|---------|----------|--------|
| Docs | `README.md:68` — the lifecycle diagram listed `visualize` under review's `calls:`, saying /review invokes /visualize, which contradicts this branch's settlement (review only recommends a direct invocation) | low | fixed — moved to a separate `suggests: visualize (diagram gap finding — Lens 3i-diagram; the user runs it)` line (`2d87c3216a`) |

> Lenses 3b (Security) and 3c (Error Handling) ran as low-tier single reads: both returned "No findings." The confirmed finding above came from the reviewer's own stale-claim sweep and was confirmed by Step 3.7's independent tiebreak. Standalone review: the AskUserQuestion batch prompt was not shown. The run instructions authorized review-applied fixes, so the recommended "Fix now" was applied.

### Tiebreak
**Verdicts:** 1 confirmed · 0 dropped · 1 digest · 0 console
- AUTO 18:00:22 — Reproduction: lens "reviewer" finding README.md:68 confirmed by tiebreak:6040edb0dace. Confirmed. Reversibility: high.
- AUTO 18:00:22 — Tiebreak tiebreak:967a91111516: lens "reviewer" finding plugin/skills/_shared/visual-html-output.md:134 digested: evidence-unverified. Severity: low. Reversibility: high.
- plugin/skills/_shared/visual-html-output.md:134 — Step 6's persist-vs-ephemeral table still names `/review` as a soft-hook caller whose diagram is saved as a project doc without asking. That contradicts this branch's settlement: /review is not a `--source` caller, and its recommendation runs as a direct invocation, which does ask. (low) — Recommendation: file — a one-token fix (drop `/review` from the example list). The judge's reply was `confirmed`, but its evidence quote backslash-escaped the line's backticks, so `resolve-tiebreak` could not verify it and settled it `digest`. Under standalone rules a low can't-tell finding is report-only, so it was **not fixed** in this review and stays open on the PR.

### Fan-out leftovers
No untracked files left by the review fan-out; agent-scratch empty. 3 new local listeners since the pre-dispatch snapshot, reported (not killed; ownership unattributed — no lens agent ran a server): node:127.0.0.1:59835, rapportd:62252, rapportd:62253.

### Implementation Hindsight
No changes needed — approach is sound. Option b matches the lens's own trigger, which is a persistent-diagram gap that a direct invocation's persist-or-show-me question fills. No new structure, no consolidation gap, and no convention drift beyond the restatement sites already in Step 3's findings. No skill-worthy pattern beyond what the repo already records.

### Tradeoffs Accepted
| Tradeoff | Rationale |
|----------|-----------|
| `visualize/SKILL.md`'s "Used by" diagram still names /review ("including as recommended by /claude-tweaks:review") | The record's Deliverable 2 explicitly allows it when worded as a recommendation; it states no caller edge |
| `visual-html-output.md:134` stale `/review` example left unfixed | The tiebreak settled it `digest` (evidence-unverified); the standalone report-only rule applies. Surfaced above for a human to apply |

### Visual Review
- **Status:** Skipped — no UI changes
- Skill-load gate: "no frontend surface (surface: infra) and no UI trigger file in the diff"; journeys: none

Design Quality skipped — design integration not configured (run /claude-tweaks:init to enable).

### Code Simplification
- No simplifications needed — the scope is prose only (`README.md`, `docs/skill-graph.md`, `plugin/skills/visualize/SKILL.md`), which `/claude-tweaks:simplify` Step 1 filters out as non-code artifacts, so no simplifier dispatch

### Skill Load Delta
Skill load delta (base 88cdbe8 = merge-base with origin/main):

| Entry | Floor | ΔFloor | Closure | ΔClosure | New unresolved |
|---|---|---|---|---|---|
| 40 entries: plugin:accept, plugin:activity, plugin:assess-agent-autonomy, … +37 more | 1,944–52,110 | 0 | 7,468,333–7,508,935 | -111 | — |
| plugin:visualize | 13,166 | -111 | 7,468,333 | -111 | — |

### Manual Steps Required
No manual steps — nothing to do outside the codebase.

Footer: Security Hardening, Agent Trust Scope and App Store Readiness passes skipped at their pre-checks (no client/route, config, or mobile files in scope). Lens 3i: `docs/skill-graph.md` (the registry entry matching `plugin/skills/**/*.md`) was updated in this work — no doc-freshness finding; 3i-diagram: no signal. No open-items ledger (standalone, no run dir) — QA entries could not be merged. PR verdict comment and phase-exit not run (no run directory).

### Verdict
**PASS**

### Actions Performed
| Action | Detail | Ref |
|--------|--------|-----|
| Bug fix | Relabeled review's visualize edge from `calls:` to `suggests:` in the lifecycle diagram — `README.md` | `2d87c3216a` (pushed to `drive-record-3831`) |

### Key Learnings
1. Settling a "who calls whom" relationship needs a repo-wide sweep for every restatement, not just the files the record names. This one lived in three more places (`README.md`'s lifecycle diagram, `_shared/visual-html-output.md`'s Step 6 table, the skill-graph row). The builder fixed only the named files — a record's Key Files list is a floor, not the sweep.
2. A tiebreak judge that backslash-escapes backticks inside its evidence quote fails `resolve-tiebreak`'s verbatim check, so a substantively confirmed finding settles `digest`. A source line holding backticks needs the judge to quote it raw, or the resolver to tolerate that escape.

### Next Actions
**`/claude-tweaks:wrap-up 3831`** — capture learnings and clean up (recommended)
