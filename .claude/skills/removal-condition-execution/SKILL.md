---
name: removal-condition-execution
description: Use when executing a recorded removal condition in this repo — deleting a transitional guard, deprecated alias, compatibility shim, legacy fallback or transitional twin once its sunset date or condition is met (`_shared/policy-deprecations.md`, a skill's `deprecated-aliases.md`, a `Removal condition:` code comment). Covers running and reporting the condition's own check, keeping surviving step numbers, the three citation shapes a name grep misses, sweeping framing words as well as identifiers (test titles included), re-pointing rationales and qualifiers that leaned on the removed thing, re-anchoring absence sentinels that would pass vacuously, and what stays historical. Keywords - removal condition, sunset, retire, transitional guard, deprecated alias, legacy fallback, transitional twin, IL-85, retirement sweep, step-number citation, skip list, step range, rationale, test title, absence sentinel, vacuous, incident log.
---

# Removal-condition execution

## Overview

This repo records a removal condition beside every deprecated behavior (CLAUDE.md's expand-contract rule, `[IL-85]`). Executing one later is a recurring record shape of its own: #3847 (wrap-up's Section C step 3.5 copy-out guard, sunset 2026-11-07), #666 (`10c912692`, permittedGrants' flat keys at their backstop), #602 (`64159cf7a`, the `worktree.always` transitional twin), and `1cc9d2f16` (clearsFloor's regex fallback, whose condition `9183e57c9` recorded). More are pending: `git grep -n -i 'removal condition' -- plugin/`. The deletion is small. The cost is everything that still cites the removed thing: #3847's spec named nine key files and the build touched eighteen.

## Key Patterns

### Run the condition's own check and report it, even when removal is unconditional

A condition usually names a check. #3847's was `find . -path "*/.claude/worktrees/*/.claude-tweaks/pipelines/*" -maxdepth 6 -type d`, run from the main checkout. Run it and put the result in the PR. Past a sunset the removal proceeds regardless, so a hit is reported as abandoned state, not a blocker. Raw output can exceed GitHub's 65,536-character PR-body limit (#3847's was 15,008 lines): quote the exact command plus a hit/miss count, and say that is what you did.

### Delete the step; never renumber the survivors

Other files cite steps by number. #3847 deleted `3.5.` from `plugin/skills/wrap-up/cleanup-procedures-execution.md` Section C and left 3.6 onward alone.

### A name grep misses three citation shapes

`git grep -i 'step 3\.5'` finds the step by name. It does not find:

- **Skip lists.** "skip steps 3, 3.5, 3.6, 4, and 5" appeared three times in `cleanup-procedures-execution.md`. Drop the number from the list.
- **Ranges.** "steps 3.5-5.5" in `plugin/skills/wrap-up/merge-mode.md` and `docs/skill-graph.md`. A range whose first step was removed starts at the next surviving step (3.6-5.5); deleting the range drops steps that still run.
- **Rationales.** A surviving rule that gave the removed thing as its reason. `[IL-116]`'s "never tear a pipeline worktree down directly" cited step 3.5 in `_shared/ceremony-profile.md`, `dispatch/two-call-gate.md`, `wrap-up/flags.md` and `docs/donts.md`. Keep the rule and re-point the reason at what still enforces it (#3847: step 3.6's close-run and step 4's ordered removal).

#3847's sweep, with the history paths excluded: `git grep -n -i -e 'copy-out guard' -e 'steps 3\.5' -e 'step 3\.5.s' -e '3, 3\.5' -e '3\\\.5-5\\\.5' -e "'3\.5\.'" -- plugin docs tests ':!docs/incident-log.md' ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md'`. Add `.claude/skills` to the roots: project skills restate plugin contracts (`skill-prose-conformance-tests`' sweep-root anti-pattern).

### Sweep the framing words, not only the identifiers

Identifiers (the date, the step number, the guard's name) are what acceptance greps check. The concept the removed thing introduced has words of its own. #3847 swept `2026-11-07`, `transitional guard`, `step 3.5` and `copy-out guard`, and rewrote `tests/hooks-pipeline-shadow-guard.test.js`'s header comment. Two test titles further down the same file still said "(pre-anchoring, tolerated)" and "already-existing (pre-anchoring) run directory". A test title is a string literal no assertion reads, so it stays green while wrong; review caught both (`b40271381`). List the framing words the removed thing used (here `pre-anchoring`, `tolerat`) and grep them across comments and string literals. Classify each hit: a historical mention stays (`plugin/bin/lib/hooks/context.js`'s "the pre-anchoring behavior" describes legacy handling, not the guard).

### Re-check every qualifier a survivor inherits

When a sentence covered the removed step and a survivor together, deleting the step can leave the survivor with a qualifier it never had. #3847's `wrap-up/flags.md` ended up saying step 3.6's close-run runs **unconditionally**, but 3.6 runs only when a run dir was established. Review caught it, and `b40271381` reworded it to "never skipped by `cleanup-only` … conditions included". Read each re-pointed sentence against the survivor's own conditions.

### Re-anchor an absence sentinel built from the removed text

A test that proves a section is excluded by asserting the removed text is absent passes vacuously once that text is deleted. `tests/bin-lib/wrap-up/engine-cli.test.js`'s appendix-exclusion check used the sunset sentence. #3847 replaced it with a string found only in the appendix (`producing **no merge commit at all**`), checked with `grep -c -F` against both the appendix and the head file.

### Behavior the removed thing justified may stay; give it its own reason

`checkPipelineShadowGuard` in `plugin/bin/lib/hooks/pre-tool-use.js` still allows writes into a run dir that already exists in a worktree. Its comment had justified that by the copy-out guard. It now rests on its own ground: a write into an existing directory creates no new shadow. Decide for each such behavior whether it goes with the removed thing or stays with a rewritten rationale, and say which in the spec.

## Decision Framework

| A hit on the retired vocabulary in… | Verdict |
|---|---|
| live skill prose, `docs/donts.md`, `docs/skill-graph.md`, `docs/plugin-structure.md`, `.claude/skills/` | rewrite or delete |
| a code comment, a test title, a test comment | rewrite; behavior unchanged unless the record says otherwise |
| a test assertion | re-anchor (a sentinel) or retarget (a pin), never only delete |
| `docs/incident-log.md`, `CHANGELOG.md`, archived run `work/*.md`, `docs/superpowers/plans/*` | leave: history, not live guidance |
| an unrelated step with the same number (Step 3.5 also exists in review, backlog refine, journeys, docs-health, routine status, attention mode) | leave |

## Project Conventions

- The removal is unconditional once a sunset date passes, whatever the condition's check finds; the check's result goes in the PR as a report.
- The incident log's post-mortem is never edited. It is the evidence for why the removed thing existed (#3847 ledger row 7).
- The rule a rationale supported survives the removal unless the record says otherwise; only its stated reason moves.

## Common Operations

1. Run the condition's check from the main checkout and record the command and a count for the PR.
2. Delete the removed section and its pointer step, keeping later step numbers.
3. Grep the identifiers, then the skip-list and range shapes, then the framing words, across `plugin docs tests .claude/skills` with the history paths excluded. Give each hit a verdict from the Decision Framework.
4. Re-point every rationale and re-read every inherited qualifier against the survivor.
5. Re-anchor each absence sentinel on a string unique to its source and confirm it with `grep -c -F`.
6. Run the full suite: conformance tests pin this prose.

## Anti-Patterns

| Pattern | Why it fails here |
|---|---|
| Treating the acceptance greps as the whole sweep | They pin identifiers only; framing in test titles and an overstated qualifier both passed them (#3847 ledger rows 5-6) |
| Deleting a rationale along with the step it cited | The surviving rule loses its reason and reads as arbitrary; re-point it |
| Renumbering the surviving steps | Every by-number citation elsewhere breaks at once |
| Deleting a range that started at the removed step | Drops steps that still run; move the start to the next survivor |
| Leaving the removed text as an absence sentinel | The exclusion test passes vacuously from then on |

## Reference

- `work-record-facet-rename`'s staged-rename variant: the label-specific removal step.
- `shared-contract-extraction` step 6: proving a retirement by its citations.
- `skill-prose-conformance-tests`: absence assertions fail open; sweep roots include `.claude/skills/`.
- Pending conditions: `plugin/skills/_shared/policy-deprecations.md`, `plugin/skills/{backlog,dispatch,specify}/deprecated-aliases.md`, `Removal condition:` comments under `plugin/bin/`.
