# Inline Research Method (fallback)

The fallback used by `/claude-tweaks:research` when Claude Code's built-in `/deep-research`
Dynamic Workflow is unavailable (Free plan, workflows disabled, or Claude Code < 2.1.154). It
replicates the built-in's agentic approach: fan out searches, extract evidence, adversarially
verify, synthesize.

## Step 0: Anchor the date

Run `date +%Y-%m-%d` via Bash. Use the returned year for recency-filtered queries — never
assume a year from training data.

## Step 1: Decompose

Break the topic into independent search angles, scaled to the depth tier:

| Tier | Angles | Verification |
|------|--------|--------------|
| quick | 5 | inline self-check |
| standard | 7 | 1 verifier per core claim |
| deep | 10 | 1 verifier per claim |
| ultradeep | 10 | up to 3 parallel refutation verifiers per core claim |

Angles should span: core concept, technical specifics, recent developments (date-filtered),
opposing/critical views, quantitative/benchmark data, and known limitations.

## Step 2: Search (parallel)

Dispatch all angle searches concurrently using `WebSearch` in a single message with multiple
tool calls. For each promising result, use `WebFetch` to pull the supporting passage.

> **Parallel execution:** Use parallel tool calls aggressively — all `WebSearch`/`WebFetch`
> operations in this step are independent and should run concurrently.

## Step 3: Extract evidence

For each source capture: title, URL, the exact supporting quote, and a one-line relevance
note. Maintain source diversity (academic / industry / news / primary docs) and temporal
diversity (recent + foundational).

## Step 4: Adversarially verify (parallel subagents)

For each major claim destined for the report, dispatch a verification subagent that tries to
REFUTE it. Scale the fan-out to the tier (table above). This is generic per-claim refutation
voting, gated by research depth tier — not the plugin's canonical "multi-persona red-team"
primitive (`_shared/multi-agent-coordination.md` Mode 3), which is a fixed Implementer /
Maintainer / Skeptical Reviewer persona roster scoped to surfacing spec ambiguity for
`/claude-tweaks:specify` and gated by a sub-issue's `ceremony:*` label. Don't conflate the two.

> **Parallel execution:** Dispatch claim verification as parallel Task agents — each runs
> independently and returns a verdict. Assemble results after all agents complete.
> **Contract:** Each agent follows the Subagent Contract
> (`skills/_shared/subagent-output-contract.md`) — minimal input (the claim + its source quote
> + URL), one of `STATUS: DONE / STATUS: DONE_WITH_CONCERNS / STATUS: NEEDS_CONTEXT / STATUS: BLOCKED`
> as the last non-empty line of the reply, then
> the literal output format (Template C), inlined verbatim in the dispatch prompt:
> ```
> OUTPUT FORMAT (required):
> First line: "yes" or "no"
> Second line onward: up to 3 bullet lines of evidence (path:line — context).
> Maximum 200 tokens total.
> ```
> Use the Fast or Standard tier.

A claim survives only if it is NOT refuted by a majority of its verifiers. Drop or hedge
refuted claims.

## Step 5: Synthesize + write

Write `report.md` as flowing prose (not bullet dumps) in the output directory. Follow the
citation discipline below. Also write `sources.json` — an array of
`{ "n": 1, "title": "...", "url": "...", "retrieved": "YYYY-MM-DD" }` provenance entries.

## Step 6: Citation self-check (replaces the old script-based validation)

Before finishing, verify:

- Every `[N]` in the body resolves to a bibliography entry, and every bibliography entry is
  cited at least once.
- No fabricated URLs — every cited URL was actually fetched.
- Flag any claim resting on a single source.

## Citation discipline

- **Immediate citation:** every factual claim is followed by `[N]` in the same sentence.
- **No vague attributions:** never "studies show" / "research suggests" / "experts believe."
  Name the source: "Smith et al. (2024) found … [1]."
- **Label speculation:** "This suggests …" — never present inference as fact.
- **Admit uncertainty:** write "No sources found addressing X directly" rather than
  fabricating a citation.
- **Distinguish fact from synthesis:** facts carry a citation; analysis is marked as inference.
- **Precision over hedging:**

  | Vague | Precise |
  |-------|---------|
  | "significantly improved outcomes" | "reduced mortality 23% (p<0.01) [1]" |
  | "several studies suggest" | "5 RCTs (n=1,847) show [2]" |

## Bibliography format

`[N] Author/Org (Year). "Title". Publication. URL (Retrieved: YYYY-MM-DD)` — one entry per
line, every cited source listed, no ranges or "…etc."
