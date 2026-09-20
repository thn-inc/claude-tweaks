# Hindsight Mode

Action-gate procedures for hindsight mode (invoked by `/claude-tweaks:review` Step 4, or standalone with the `hindsight` keyword).

## Step 2: Run Lenses — Hindsight Mode (5 evaluations)

This is an **action gate** — findings lead to changes, not just observations.

> **"Given everything we've found, should we change something before shipping this?"**

| # | Evaluation | Question |
|---|-----------|----------|
| 1 | **Approach correctness** | Did we solve the right problem, or optimize for the wrong thing? |
| 2 | **Structural debt** | Did we introduce patterns we'll regret? Premature abstractions, wrong boundaries? |
| 3 | **Missing consolidation** | Opportunities to merge, deduplicate, or simplify that are obvious now? |
| 4 | **Convention drift** | Did we accidentally diverge from established project patterns? |
| 5 | **Skill-worthy patterns** | Did the work establish or extend a reusable pattern that should be documented in a project skill? |

For **structural debt** (evaluation 2): when the debt is module-level — a shallow abstraction, a leaky interface, a pass-through wrapper, or a wrong boundary that a depth refactor would address — recommend `/claude-tweaks:deepen` as the follow-up rather than trying to resolve module restructuring inline. Line-level cleanup still routes to `/claude-tweaks:simplify`; reserve the `/claude-tweaks:deepen` recommendation for genuine interface/depth issues.

### Finding Shape (Evidence + Cost)

Every finding any evaluation produces carries two lines beyond its description: an `Evidence:` line and a `Cost this session:` line (one line; `unclear` is valid — retries, hand-work, a reverted decision). **"No finding" is the expected common answer** — an evaluation that cannot be evidenced renders that explicitly rather than manufacturing a finding to look thorough.

**Evidence format is path-specific, and hindsight mode's own timing constrains which pointers are even available:** hindsight mode runs mid-pipeline (during `/claude-tweaks:review`, before the run's later phases — test's full verification, wrap-up's own passes — have happened), so its evidence pointers can only reference the **partial session state visible at that point** — never end-of-run knowledge the rest of the pipeline hasn't produced yet.
- **Inline path** (this evaluation ran in the main thread, no transcript read — hindsight mode's only path, since it never dispatches its own singleton) — a pointer into the session's own context so far: a named tool call, an error message, a file:line, or a user turn already visible at hindsight's point in the run. Never a transcript byte offset — there is no transcript read on this path.

For skill-worthy patterns: if yes, **be prescriptive** — name the target skill and section for an update, or a proposed name and one-line scope for a new skill. Vague "this might be skill-worthy" notes don't survive `/wrap-up`'s analysis; a named target does. Use the phase from Step 4's routing table (`review/hindsight` when invoked by /review, `wrap-up` when invoked by /wrap-up, `reflect` when standalone). Tag the entry body with `[skill: existing-skill-name]` for findings that target a specific skill, or `[skill: NEW - {suggested-name}]` for patterns that don't fit any existing skill (hyphen, not em-dash, for tooling friendliness). `/wrap-up`'s Skills curation row picks these up by scanning ledger entry bodies for the `[skill: …]` tag — phase doesn't have to be `*/skill` for the entry to be skill-routed.

## Step 3: Route Findings — Hindsight Mode

### Auto mode (policy-driven routing)

Identical to full mode — auto-mode routing is shared across every mode, mode-independent: see the auto-routing table in SKILL.md Step 3.

### Interactive mode (batch user routing)

Present all findings as a batch:

```
### Implementation Hindsight

| # | Finding | Recommended |
|---|---------|-------------|
| 1 | {description} | Change now |
| 2 | {description} | Change now |
| 3 | {description} | Defer — bigger scope, not relevant now |
| 4 | {description} | Capture — needs exploration |
```

The table renders as markdown, as above. Same `AskUserQuestion` mechanics as full mode (see `full-mode.md`'s Interactive mode section) — substitute "findings" for "insights" in the question text and header (`question`: `"How do you want to handle these findings?"`, `header`: `"Findings"`); the two options are identical.

**Recommendation rules:** **Defer** and **Capture** are the same as `full-mode.md`'s Recommendation rules (substitute "finding" for "insight" and "files" for "context") — see that section rather than repeating it here; both run `_shared/deferral-gate.md`'s gate and name a `Defer-reason:` exactly as stated there. Both also apply `_shared/materiality-floor.md`'s below-materiality-floor digest routing, including its digest-comment-URL-and-count summary surfacing, exactly as `full-mode.md`'s own Defer and Capture bullets describe — see that file rather than a second copy of the same rule here; this mode's own end-of-run summary states the same digest comment URL and count, since it uses the same insight-routing summary format. What differs in hindsight mode:
- **Change now** — the strong default (full mode's equivalent is "Implement now"). Classify the finding via `skills/_shared/learning-routing.md` **first** — do not restate its destination table — then act on the destination it returns. D1, D2 and D3 outcomes are applied or filed directly; a D4 (memory) or D5 (upstream) outcome is staged for approval, never applied in place. **Classify, then tag — never withhold**, the same rule `build/architecture-alignment.md` applies to its own ledger entries: when the destination is D4 or D5, tag this finding's `review/hindsight` ledger entry body `[route: D4]` or `[route: D5]` (exact literal — `skill-curation.md` greps for it), so `/claude-tweaks:wrap-up`'s Skills curation row hands it to the Memory or Upstream feedback row instead of seeding it as a project-skill update. Most hindsight findings are small enough to fix in a few minutes.
- **Accept as-is** — only when the current approach is genuinely better, or the finding is a false positive. Not a valid option for genuine improvements. (Full mode's equivalent, "Don't capture", covers the same "must state why" requirement.)

If any findings are **"Change now"**, apply the ones whose destination permits direct application; for the rest, write the `[route: D4]`/`[route: D5]` tagged ledger entry above so `/claude-tweaks:wrap-up`'s Skills curation row stages it via the Memory or Upstream feedback row, then re-run `/claude-tweaks:test` (or verification if standalone) and resume.

If no findings, state "No changes needed — approach is sound" and proceed.
