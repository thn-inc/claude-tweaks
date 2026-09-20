# Review Summary Template

Present this summary after completing all review steps.

## Compact form — clean PASS

When **all** of the following hold, render the compact block below instead of the full template — a zero-findings review does not earn ten mostly-empty section headers:

- Verdict is PASS
- Zero findings in every category (code review, hindsight, visual, design quality, coverage, docs) and zero unresolved QA ledger entries
- Zero tradeoffs accepted, zero autonomous actions performed (no fixes, no simplifier changes, no ledger resolutions)
- No manual steps required
- Zero untracked files reported by the post-fan-out sweep (`step3-lens-dispatch.md`)

```markdown
## Review: {spec number or description} — PASS (clean)

**Review effort:** {tier} ({derivation source, same format as the full template's Review effort line})
**Status:** Spec compliance {met | skipped — fast-lane | n/a — no spec} · Tests pass · QA {status} · Findings 0 · Hindsight clean · Simplification none needed · Visual {status, one word} · Design Quality {skipped ({reason}) | 0 findings} · Fan-out leftovers 0

### Key Learnings
{1-3 insights, or "No key learnings — straightforward review."}

### Next Actions
{resolved exactly as the full template's PASS branch below}
```

The compact form never suppresses information, only empty scaffolding: if any section of the full template would carry real content (a finding, an action, a tradeoff, a manual step, a recommendation beyond one word), render the full template instead. The verdict comment on the PR (`code-mode-steps.md` Step 7) and the Key Learnings handoff to `/claude-tweaks:wrap-up` are unchanged either way.

## Full template

```markdown
## Review: {spec number or description}

**Review effort:** {tier} (derived from {explicit argument | record labels: risk:{x} × size:{y} | diff heuristic: {reasoning}})

### Spec Compliance (spec-based only)
| Deliverable | Status |
|-------------|--------|
| {deliverable} | {done/partial/missing} |

| Acceptance Criterion | Status |
|---------------------|--------|
| {criterion} | {met/partially met/not met} |
(or: No spec — file/commit-based review.)
(or, when skipped: "Skipped — ceremony-profile: fast-lane.")

### Verification (from /test)
- Type check: {pass/fail}
- Lint: {pass/fail}
- Tests: {pass/fail}

### QA Validation (from /test)
- **Status:** {ALL PASSED | PASSED WITH OBSERVATIONS (N stories, M caveats) | PARTIAL FAILURE (N passed, M failed) | ALL FAILED (M failed) | Skipped — no stories | Skipped — no dev server | Not run}

Possible QA statuses (the four canonical values from qa-reporting.md's Status determination, plus /review's own Skipped/Not run variants):
- **ALL PASSED** — every story passed (PASS or PASS_WITH_CAVEATS), no failures
- **PASSED WITH OBSERVATIONS** — every story passed but at least one reported PASS_WITH_CAVEATS
- **PARTIAL FAILURE** — some stories passed, some failed
- **ALL FAILED** — no stories passed
- **Skipped** / **Not run** — QA did not execute

### Code Review Findings (confirmed)
| Category | Finding | Severity | Action |
|----------|---------|----------|--------|
| {convention/security/error/perf/arch/test} | {finding} | {low/medium/high} | {fixed/captured/accepted} |
(or: No findings — code is clean.)

> This table lists `confirmed` findings — findings reproduced by both agents in the per-lens reproduction pair, elevated via the reviewer's own direct-verification override (`step3-lens-dispatch.md`), or upgraded to `confirmed` after a cross-lens debate round (Step 3.5). At `review-effort: xhigh`, `unconfirmed` findings (single-source, or debate converged negative) also appear here, labeled `(low-confidence)`. At `max`, `contested` findings (debate inconclusive) also appear here too, labeled `(contested — {verdicts})`. Below `xhigh`, `unconfirmed`/`contested` findings are staged to the Wrap-Up Review Console instead — they are not silently dropped either way. Override or apply each in batch from the Console.

### Fan-out leftovers
{None | N untracked file(s) left by the review fan-out, reported (not deleted) by the post-fan-out sweep: {paths}}

> Findings whose only evidence is one of these paths are downgraded to `unconfirmed` above, per `step3-lens-dispatch.md`'s post-fan-out sweep.

### Implementation Hindsight
- {finding} → {change now / capture / accept as-is — not an improvement because {reason}}
(or: No changes needed — approach is sound.)
(or, when skipped: "Skipped — ceremony-profile: fast-lane.")

### Tradeoffs Accepted
| Tradeoff | Rationale |
|----------|-----------|
| {what was accepted} | {why — the reasoning that made this acceptable} |
(or: No tradeoffs — all findings were addressed or trivial.)

> `/claude-tweaks:wrap-up` uses this section to decide whether accepted tradeoffs should be documented in CLAUDE.md, skills, or memory files. A tradeoff worth accepting once may be worth documenting as a project convention.

### Visual Review
- **Status:** {Completed (code + visual) | Completed (code + visual, QA-enriched) | Completed (code only — no browser) | Recommended — journeys affected | Recommended — UI changed (no journeys) | Skipped — no UI changes | Skipped — browser tools not configured}
- {If completed: summary of visual/UX findings and ideas from Reimagine step}
- {If completed with QA data: note QA data enrichment — caveats surfaced, page inventories consumed, findings confirmed/resolved}
- {If recommended: `/claude-tweaks:visual-review journey:{name}` or `/claude-tweaks:visual-review {url}`}

### Design Quality (from /claude-tweaks:design-wrapper review)

{Include when the design wrapper returned `result: advisory` with findings. Omit when the wrapper skipped (non-frontend, no Impeccable, kill-switch disabled).}

{If the wrapper returned `score_trend`: render one line above the findings table — **Design Health:** {critique.current}/{critique.max} ({arrow}{delta} from {previous}/{max}, or "first captured score" when `previous` is null) · **Audit Health:** {audit.current}/{audit.max} ({same format}), where `{arrow}` is `↑` for a positive delta, `↓` for a negative delta (render the absolute value), or `→` for zero change. Omit either clause when that score type's key is absent from `score_trend`. Omit this line entirely when `score_trend` is absent from the wrapper's return.}

| File | Source | Severity | Category | Finding | Suggestion |
|------|--------|----------|----------|---------|------------|
| {file} | {critique/audit/finish-review/critic:{provider}} | {info/warning/error} | {category} | {message} | {suggestion if present} |

{`critic:{provider}` rows are `target: "code"` findings only — a `decisions` finding never renders in this table; it renders under the Decisions sub-heading below (standalone) or is staged for the Review Console (pipeline).}

> Findings are advisory — they inform the verdict but were not auto-applied. To action them inline, route through Step 3 Routing's resolution flow with category `Design Quality`. The Phase 1 design wrapper is read-only by design — code-modifying behavior ships in Phase 2's polish phase.

#### Decisions

{Include only when the wrapper returned `target: "decisions"` findings that were **not** staged (`decisions_staged` absent — standalone review). Omit this sub-heading entirely when there are none, or when they were staged for the Review Console.}

These challenge the project's DESIGN.md, not the diff — the wrapper never edits DESIGN.md; act on the remedy or decline.

| Provider | File | Severity | Finding | Remedy |
|----------|------|----------|---------|--------|
| {provider} | {DESIGN.md or .impeccable/design.json} | {info/warning/error} | {message} | {`/claude-tweaks:design-wrapper explore` for `wrapper`; `/impeccable:impeccable document` for any critic} |

(or, when the wrapper skipped entirely — this whole section, Decisions sub-heading included: "Design Quality skipped — {skip reason from wrapper}.")

### Code Simplification
- {summary of simplifier changes, or "No simplifications needed"}

### Manual Steps Required
| # | What | Where |
|---|------|-------|
| 1 | {description} | {source} |
(or: No manual steps — nothing to do outside the codebase.)

> These require action after merging. The pipeline detected them but cannot execute them.
> **In `/flow` pipeline context:** Skip this section — flow's pipeline summary handles it.

### Verdict
**{PASS}** or **{BLOCKED — issues need fixing}**

### Actions Performed

{Include when review fixed findings, simplified code, or resolved ledger items. Omit when review was purely observational.}

| Action | Detail | Ref |
|--------|--------|-----|
| Bug fix | {finding fixed} — `{file}` | `{hash}` |
| Simplified | {simplification} — `{file}` | `{hash}` |
| Ledger fix | {item resolved} ({phase}) — `{file}` | `{hash}` |

Generate from: git log since review start, findings with status `fixed`, ledger entries resolved during review.

### Next Actions

The signal-to-option lookup tables below stay as-is — the assistant's own resolution logic for picking which lines apply this run, never itself shown to the user. Only one branch (PASS or BLOCKED) is ever resolved per actual review run.

**When PASS:**

| Signal | Option |
|--------|--------|
| Always | `/claude-tweaks:wrap-up {N}` — capture learnings and clean up |
| Visual not done + journeys affected + browser | `/claude-tweaks:visual-review journey:{name}` — walk affected journey before wrapping up |
| Visual not done + UI changed + browser | `/claude-tweaks:visual-review {url}` — visual pass before wrapping up |

Once resolved, render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`/claude-tweaks:wrap-up {N}`** — capture learnings and clean up (recommended)
`/claude-tweaks:visual-review journey:{name}` — walk affected journey before wrapping up (when visual not done + journeys affected + browser available; or the `{url}` variant when journeys aren't affected but UI changed)

**When BLOCKED:**

| Signal | Option |
|--------|--------|
| Always | `/claude-tweaks:build {N}` — fix gaps listed above |
| Test failures | `/claude-tweaks:test` — re-verify after fixes |

Once resolved, render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`/claude-tweaks:build {N}`** — fix gaps listed above (recommended)
`/claude-tweaks:test` — re-verify after fixes (when test failures present)
```
