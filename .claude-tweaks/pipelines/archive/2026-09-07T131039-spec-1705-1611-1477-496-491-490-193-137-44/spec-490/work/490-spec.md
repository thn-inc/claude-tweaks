---
record: 490
origin: human
risk: low
size: medium
ceremony: standard
grants: []
surface: infra
---
# 490: /specify decomposition: cross-reference forward-declared facet/behavior changes into sibling sub-issues' Key Files

Surface: infra

## Current State

Building the `needs:definition`/`solution:unjustified` decomposition (#473-#476), #473's own Gotchas text forward-referenced a facet rename ("soon `facets.solutionUnjustified`, per the companion rename sub-issue") that #475 actually needed to make — but #475's Key Files list never named `bin/lib/issues/local-store.js`, and neither did #473's. The gap was caught only by an independent repo-wide grep for the retired label name during #475's build, not by following either sub-issue's own Key Files list. `/claude-tweaks:specify`'s decomposition mode (`decomposition-mode.md` + `record-creation-subissues.md`) currently composes each sub-issue's Key Files list from that sub-issue's own scope only — it never cross-references a sibling sub-issue's forward/backward mentions (a Gotchas note pointing at a sibling, a Prerequisites edge) back into the mentioned sub-issue's own Key Files.

## Deliverables

When `/specify`'s decomposition mode splits a rename or a facet/behavior change across multiple sub-issues, cross-reference each sub-issue's forward/backward references — Gotchas mentions of a sibling sub-issue, Prerequisites edges — into that sibling's own Key Files list at creation time, so the actual full blast radius of a cross-sub-issue change is visible from Key Files alone, not just from prose scattered across sibling bodies.

## Acceptance Criteria

- A decomposition where sub-issue A's Gotchas forward-references a change sub-issue B must make (the #473/#475 pattern) results in B's own Key Files list naming every file A's forward-reference implies B will touch.
- A decomposition with no cross-sub-issue forward/backward references is unaffected — no new files added to any Key Files list when there's nothing to cross-reference.
- A regression test reproducing the #473/#475 pattern (sub-issue A's Gotchas names a rename sub-issue B must implement, touching a file neither A's nor B's own scope-only Key Files list would otherwise include) fails before the fix and passes after.
- `npm test` passes.

## Technical Approach

In `record-creation-subissues.md`'s per-sub-issue Key Files composition step, after each sub-issue's own body is drafted, scan every sub-issue's Gotchas/Prerequisites text for a reference to another sub-issue in the same decomposition (by its working title or placeholder ref, since GitHub issue numbers aren't assigned until creation). When sub-issue A's text implies a specific file or module sub-issue B must touch (a rename, a facet addition, a shared module both sub-issues modify), add that file to B's own composed Key Files list before B is created — not as a courtesy mention, but as an actual entry following `spec-template.md`'s `- \`{path}\` — {what changes}` format, annotated to note it was cross-referenced from a sibling. This runs once per decomposition, after each sub-issue's own scope-only Key Files is drafted and before the batch creation call, so no sub-issue is created twice.

### Key Files

- `plugin/skills/specify/record-creation-subissues.md` — add the cross-referencing step to the per-sub-issue Key Files composition
- `plugin/skills/specify/decomposition-mode.md` — note the new cross-referencing behavior if it changes the documented Step 3 contract
- `tests/` — a new regression test reproducing the #473/#475 forward-reference pattern

## Gotchas

- Scope this to genuine forward/backward references only (a Gotchas sentence naming a specific change a sibling must make) — not every casual mention of a sibling sub-issue's number, which would pollute Key Files with unrelated files.
- The #473/#475 gap was caught by a repo-wide grep, not by process — this record fixes the process gap; it does not imply every past decomposition needs auditing retroactively.

## Original request

/specify decomposition: cross-reference forward-declared facet/behavior changes into sibling sub-issues' Key Files

**Related:** #473, #474, #475, #476

Context: Building the needs:definition/solution:unjustified decomposition (#473-#476), #473's own Gotchas text forward-referenced a facet rename ("soon facets.solutionUnjustified, per the companion rename sub-issue") that #475 actually needed to make — but #475's Key Files list never named bin/lib/issues/local-store.js, and neither did #473's. The gap was caught only by an independent repo-wide grep for the retired label name during #475's build, not by following either sub-issue's own Key Files list.

Scope: When /specify's decomposition-mode splits a rename or a facet/behavior change across multiple sub-issues, cross-reference each sub-issue's forward/backward references (Gotchas mentions of a sibling sub-issue, Prerequisites edges) into that sibling's own Key Files list at creation time — so the actual full blast radius of a cross-sub-issue change is visible from Key Files alone, not just from prose scattered across sibling bodies.

Trigger: Next time /specify decomposes a design doc containing a rename or a change split across 2+ sub-issues.


