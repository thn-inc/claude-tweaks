---
record: 116
origin: human
risk: low
size: low
ceremony: fast-lane
grants: [build]
surface: backend
---
# 116: Three polish items on assess-agent-autonomy's instruction-file floor (deferred from #78)

Surface: backend

## Current State

#78's whole-branch review triaged three findings as defer-not-block. Recording them here so they are explicitly resolved rather than dropped with the worktree ledger they lived in. All three concern `skills/assess-agent-autonomy/SKILL.md`, Mode: merge-check, Step 2:

1. The class definition includes "in a repository that *is* a plugin — its own `skills/**`/`agents/**` sources" but names no detection method. `.claude-plugin/plugin.json` presence is the obvious tell. Both misclassification directions are safe (over-inclusion only routes to a human), which is why it was deferred.
2. Ambiguous antecedent: after the sentence narrowing the harness-health comparison, "These files encode instructions future agents follow" has harness-health's narrower three-file set as its nearest antecedent rather than the agent-instruction class the sentence exists to justify. True either way since one is a subset of the other, but the rationale attaches to the wrong noun. One-word fix ("Instruction files encode...").
3. In the Calibration table, the reworded-instruction row and the cross-reference-repair row are distinguishable only via the Why column. A diff that relocates a pointer *and* rewords surrounding prose matches neither cleanly — though Step 2's refutation test and the one-non-conforming-hunk rule both resolve it to `needs-human` independently.

A fourth deferred item from the same review needs no action: commit 9f3d7767's message says the fast-lane doc has "five" citations where the true figure is seven. Immutable history, correctly left as record; the prose that would have shipped that count was fixed before filing #114.

## Deliverables

- Apply fix 1: name a detection method for the "repository that is a plugin" class — presence of `.claude-plugin/plugin.json`.
- Apply fix 2: reword the ambiguous antecedent sentence near the harness-health comparison (one-word fix — "Instruction files encode...").
- Resolve item 3: either tighten the Calibration table's two affected rows (reworded-instruction vs. cross-reference-repair) so a diff that both relocates a pointer and rewords surrounding prose is distinguishable without relying solely on the Why column, or explicitly close it with a stated ruling that the general rules (Step 2's refutation test + the one-non-conforming-hunk rule) already cover the overlap.
- Fold all changes into any change already touching `skills/assess-agent-autonomy/SKILL.md` rather than opening a dedicated round.

## Acceptance Criteria

- Item 1 fixed: `skills/assess-agent-autonomy/SKILL.md`'s plugin-repository class definition names `.claude-plugin/plugin.json` presence as its detection method.
- Item 2 fixed: the antecedent near the harness-health comparison is reworded so the rationale clearly attaches to the agent-instruction class, not just harness-health's narrower three-file set.
- Item 3 either fixed (Calibration table's two rows tightened) or explicitly closed with a stated ruling that the general rules suffice.
- All changes land in `skills/assess-agent-autonomy/SKILL.md`, Mode: merge-check, Step 2 (including its Calibration table), folded into an existing change touching that file rather than a standalone round.

## Technical Approach

Small, targeted prose edits to `skills/assess-agent-autonomy/SKILL.md`:

- Add one clause naming `.claude-plugin/plugin.json` presence as the detection method for "repository that is a plugin."
- Reword the antecedent sentence near the harness-health comparison so "Instruction files encode instructions future agents follow" (or equivalent) replaces the current ambiguous phrasing.
- For item 3, either add distinguishing language to the Calibration table's two affected rows, or leave the table as-is with a stated decision that the general rules (refutation test + one-non-conforming-hunk rule) already resolve the case.

### Key Files

- `plugin/skills/assess-agent-autonomy/SKILL.md` — Mode: merge-check, Step 2 (including the Calibration table)

## Gotchas

- These are prose-only edits to a single skill file — no code changes, no tests beyond the skill's own prose-conformance suite.
- Do not open a dedicated round for this; land the fixes alongside any other change already touching `skills/assess-agent-autonomy/SKILL.md`, per the deferral note in the original request.
- Item 3 is genuinely optional — the original whole-branch reviewer judged the general rules sufficient, so "closed with a stated ruling" is an acceptable outcome, not a fallback.

## Original request

Three polish items on assess-agent-autonomy's instruction-file floor (deferred from #78)

**Current State:** #78's whole-branch review triaged three findings as defer-not-block. Recording them so they are explicitly resolved rather than dropped with the worktree ledger they lived in. All three are in `skills/assess-agent-autonomy/SKILL.md`, Mode: merge-check, Step 2.

1. The class definition includes "in a repository that *is* a plugin — its own `skills/**`/`agents/**` sources" but names no detection method. `.claude-plugin/plugin.json` presence is the obvious tell. Both misclassification directions are safe (over-inclusion only routes to a human), which is why it was deferred.

2. Ambiguous antecedent: after the sentence narrowing the harness-health comparison, "These files encode instructions future agents follow" has harness-health's narrower three-file set as its nearest antecedent rather than the agent-instruction class the sentence exists to justify. True either way since one is a subset of the other, but the rationale attaches to the wrong noun. One-word fix ("Instruction files encode...").

3. In the Calibration table, the reworded-instruction row and the cross-reference-repair row are distinguishable only via the Why column. A diff that relocates a pointer *and* rewords surrounding prose matches neither cleanly — though Step 2's refutation test and the one-non-conforming-hunk rule both resolve it to `needs-human` independently.

**Deliverables:** Apply 1 and 2 (each one line). For 3, decide whether the row pair needs tightening or whether the general rules covering the overlap are sufficient — the reviewer judged them sufficient.

**Acceptance Criteria:** items 1 and 2 fixed; item 3 either fixed or closed with a stated ruling. Fold into any change already touching this file rather than opening a dedicated round.

A fourth deferred item needs no action: commit 9f3d7767's message says the fast-lane doc has "five" citations where the true figure is seven. Immutable history, correctly left as record; the prose that would have shipped that count was fixed before filing #114.

