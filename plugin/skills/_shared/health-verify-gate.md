# Health Verify Gate — Canonical Adversarial-Verify Discipline

`code-health`, `docs-health`, and `journey-health` each run an adversarial verify gate on their
own judge output, right before fingerprinting/dedup: re-examine every surviving finding and drop
anything that doesn't hold up under scrutiny. `harness-health` follows the identical discipline
but folds it into its JUDGE step via `_shared/harness-health-analysis.md`'s own embedded verify
gate rather than a separate numbered step — its copy lives there, not here.

This file is the one place the *shape* of the discipline is defined, so a refinement made to one
skill's copy (a new question, a tightened drop threshold) can be checked against the same
canonical shape in the other two prose-checklist copies. Per this project's own convention that a
skill file must be self-contained for whichever session reads it, each of the three consumers
still writes out its own question set in full inline, phrased against its own finding schema's
field names — this file is the reference the three copies are kept in sync against, not a
replacement for any of them.

## The shape

For every finding still in the candidate set, ask (adapting the wording to the skill's own
finding schema):

1. **Is it real?** Does the underlying material (code, doc, journey/story/live evidence) actually
   exhibit the problem, or did the judge misread it? If the thing being checked for is correctly
   present, drop the finding.
2. **Is it actionable?** Is the finding's fix field (`suggestedApproach` / `oldString`+`newString`
   / `recommendation`) concrete enough to execute, not a vague gesture like "consider improving
   X"? Drop or tighten it.
3. **Does it reproduce?** Would someone following the finding's own fix field, using only what
   was already gathered, actually resolve the issue without further investigation? If the anchor
   or evidence is too vague to act on, tighten it or drop the finding.
4. **Is the severity/confidence tier justified by the evidence?** The finding's own evidence/
   reason field should ground the claimed tier, not just assert one.
5. **Is effort (where the schema carries it) consistent with the fix field?** A one-line fix
   should not carry a high-effort tier, and vice versa.
6. **Does the replacement text conform to the contract that governs the target?** (Only where the
   schema carries literal replacement text — `oldString`/`newString`.) When the edit writes into a
   structured field whose vocabulary is defined elsewhere in the repo (a ledger `Status` cell, a
   policy key, a frontmatter facet, a label name), locate that definition and check the proposed
   value against it. A finding can be real, actionable, and reproducible and still emit an
   out-of-enum value — the first five questions never look at conformance.

Drop any finding that fails any question, and log the drop reason. A smaller set of high-quality
findings is always preferable to a larger set with noise. This is a judgment step, not a
mechanical check — it cannot be automated, and skipping it under time pressure is exactly the
failure mode it exists to prevent.

## Keeping the three copies in sync

`code-health/SKILL.md`'s VERIFY GATE step, `docs-health/SKILL.md`'s VERIFY GATE step, and
`journey-health/SKILL.md`'s VERIFY GATE step each inline their own version of the questions
above, worded against their own finding schema and covering every question that schema carries
— question 5 is explicitly conditional on an `effort` field, so a skill whose findings derive
`effort` mechanically rather than carrying it as a judged field inlines the rest without it, and
question 6 is likewise conditional on a schema carrying literal replacement text (today only
`docs-health`'s `oldString`/`newString`).
When one skill's copy changes, check the other
two against this file's canonical shape rather than assuming the change was skill-specific — the
discipline itself has no per-skill behavioral variation, only the field names referenced in each
question do. `harness-health`'s embedded copy in `_shared/harness-health-analysis.md` should be
checked too, even though it lives in a different file for a different reason.
