# Journey Curation — judge file

Judge file for the `journeys` registry row (`Journeys`), loaded per that row when its gate opens. The gate, the scope, and the row's `SCANNED` line are **engine-owned** — see `curation-engine.md`; this file is judgment only.

Loaded by `/claude-tweaks:wrap-up`'s Journeys curation row to detect journey drift introduced by this work — journeys whose documented flow has fallen out of sync with the diff — and to detect a persona-facing flow this work introduced with zero journey coverage anywhere. Two checks, both always recomputed fresh: J1 judges journeys the diff touches, J2 judges the diff for missing coverage.

## J1: Diff-vs-frontmatter overlap + inline self-review

**Scope:** the journeys in the worklist row's `scope.candidates` — the engine computed the `files:`-frontmatter overlap against this work's diff. Always computed fresh — never reused from `/review`'s Step 6 visual-review recommendation or the 3g-cov lens. Two independent reasons, and both hold: the 3g-cov lens **computes journey-to-story coverage, not diff overlap**, so reusing it would answer a different question than this scope asks; and neither it nor the Step 6 recommendation produces a reusable, persisted artifact, so there would be nothing to reuse even if the measurement matched.

For each journey in scope:

1. Read the journey file in full.
2. Apply the four checks and the structural-validity check from `_shared/journey-self-review.md` (persona, step shape, origin coverage, outcome clarity — structural validity checked first) — the identical criteria `/claude-tweaks:journeys` Step 3.5 (write-time) and `/claude-tweaks:journey-health` (audit-time) already apply, reused inline here as this project's third consumer, rather than invoking either skill as a nested call (same reuse pattern `docs-health-integration.md` already applies to `_shared/criteria-docs-diataxis.md`).
3. A structural-validity failure (missing frontmatter, missing `## Steps`, no steps) is a harder failure than the four content checks — treat it as a finding requiring fix, not a soft note.

Route surviving findings by severity, mirroring the shape `_shared/journey-self-review.md`'s own consumers use:

- **Structural-validity failure, or any content-check failure** → collect as `[journey] {file} — {description}` rows. In every mode they surface in the Review Console's own "Journey updates" section (`review-console.md`), which owns the one terminal decision. Applied at Phase 4's execution step exactly like any other approved fix — never filed as a GitHub issue, unlike `/claude-tweaks:journey-health`'s audit-time pass on journeys nobody has touched recently; wrap-up has full session context on what was just built.
- **Staged file name.** A finding staged as a concrete edit is written to `staged/wrap-up-journey-{N}.md` — the prefix `bin/lib/console/resolve.js`'s `SECTION_MAP` routes to Journey updates. Any other name (e.g. `journey-…`) classifies as `unmapped-prefix` and stays pending, never applied.

## J2: Missing-journey gap-detection

**Scope:** this work's full diff, not any existing journey — mirrors D2's missing-doc gap detection (record #56's documentation curation) structurally.

Ask: did this work introduce a new persona-facing flow (for any persona: end users, admins, developers, internal tooling users) with **zero journey coverage anywhere** in the project — not merely a flow that doesn't map to J1's touched-journey scope, but something no existing journey documents at all? This is a deliberately high bar, identical in spirit to D2's "zero existing doc coverage anywhere." Examples that clear it: a new slash command with a real end-to-end flow, a new persona-facing capability with no journey even adjacent to it. Examples that don't: a change to an existing flow's implementation with no new persona-facing behavior, a bug fix, an internal refactor.

This check runs independent of what `/claude-tweaks:journeys` Step 1 already concluded during build — it is a wrap-up-time safety net for drift introduced after build's own journey check ran, or for a project where the "journeys build-time recalibration" sub-issue's 3-signal checklist (record #57) hasn't caught the gap for some other reason.

On a hit:

1. Propose a `[journey] {new-journey-name} — Create: {one-line rationale}` row, folded into the same Journey updates collection as J1's findings.
2. On approval, Phase 4's execution step creates the new journey file using `journey-template.md` (in `/claude-tweaks:journeys`' skill directory) and fills in real content from this work's own session context — the same reasoning `docs-health-integration.md`'s D2 already documents for why wrap-up (unlike `/claude-tweaks:init` Phase 8.5) writes real content immediately instead of backlogging a template pointer.

**Known narrowing — a project with no journeys never gets a J2 proposal.** The Journeys registry row's gate is `docs/journeys/*.md` existing, so on a project with zero journeys this file is never read and J2 never runs — even though J2 is the check that would name the first one. This is safe rather than accidental: J1 and J2 are both **drift** checks, and drift presupposes an existing journey. First-journey *creation* is `/claude-tweaks:journeys`' job at build time, not this row's. The narrowing is stated here, beside the check it narrows, because the gate that causes it lives in the registry (`bin/lib/wrap-up/registry.js`) and the engine, not in this file — the same treatment `docs-health-integration.md` gives D2's structurally identical narrowing.

Declare **"No journey updates needed"** only when J1 finds no journey in scope (or every in-scope journey passes every check) AND J2 finds no missing-journey gap.
