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

### A condition that names an issue is proved by caller searches, not by the issue

A condition may name a trigger issue whose text never mentions the code it gates. #5535's comment tied the `resolve-refutation` verb to issue 3950 closing, and that issue's body names neither the verb nor its function. Read the issue's state, then prove the removal from caller searches for the verb, its function and every export, and put both results in the PR. Say in the PR that the issue does not name the code, so a reader does not take its closing as the proof.

### Check what the condition's check can see

A check runs against one place, and the removed code may serve more than that place. #5536 recorded `FP_RE_LEGACY`'s condition in `plugin/bin/lib/issues/record-fingerprint.js` as a `gh issue list` count of legacy fingerprint markers. That command sees only the repository it runs in, but the reader ships in the plugin and dedups issues in every consumer repo. A 0 here would have read as "condition met", and removing the reader would have re-filed consumer repos' old issues, `wontfix` ones included. The whole-branch review caught it before merge. When recording a condition, and again before acting on its result, compare what the check can see with what the removed code serves. Where the check cannot reach everything the code serves, a 0 is necessary but not sufficient: removal also needs a release note plus a sunset window, or a step that migrates the old data.

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

A name-replacement table has the same hazard at scale. #5544 removed test-only wrappers from `plugin/bin/lib/reconcile/archive-merged.js` and reworded about 40 sentences by a table mapping each removed name to its replacement. Four of them then credited `decideArchiveCore` with behavior it does not have: a no-worktree/no-branch skip and a live-worktree precondition, both of which belong to the main loop. A grep that the old name is gone passed all four. A Task 4 review and the whole-branch review caught them; the whole-branch review's three now say "the merged-PR path". For each sentence the table rewrites, read the replacement's code and check that it does what the sentence now says.

### Re-anchor an absence sentinel built from the removed text

A test that proves a section is excluded by asserting the removed text is absent passes vacuously once that text is deleted. `tests/bin-lib/wrap-up/engine-cli.test.js`'s appendix-exclusion check used the sunset sentence. #3847 replaced it with a string found only in the appendix (`producing **no merge commit at all**`), checked with `grep -c -F` against both the appendix and the head file.

### Inventory a pin's assertions before retargeting it

A retargeted pin keeps the feature it was named for and can still drop a second rule its old fixture covered by accident. #5534 retargeted the `--stamp-status --git-dir` test in `tests/bin-lib/verify/cli.test.js` from the bare-SHA file to the JSON stamp. The bare file had no `dirty` field, so the old test had also covered "a stored `dirty` that is not exactly `false` never verifies HEAD"; the retargeted one did not. Only the whole-branch review's mutation caught it, and `8775229de` added the stored-dirty tests back. Before retargeting, list every assertion the old test made, the incidental ones included, and say which test covers each one afterwards.

### Seed an untouched-file assertion with bytes the removed writer never writes

A test asserting that a file the removed code used to write is left untouched can fail only when the fixture's content differs from what that writer would write. #5534's test for a leftover bare-SHA stamp in `tests/bin-lib/verify/cli.test.js` seeded the file with HEAD, which is exactly what the removed twin write wrote, so restoring the twin left the test green. `2e514d4e4` seeds a sha other than HEAD. Prove the assertion by restoring the writer exactly as it was, not a marked variant of it.

### Behavior the removed thing justified may stay; give it its own reason

`checkPipelineShadowGuard` in `plugin/bin/lib/hooks/pre-tool-use.js` still allows writes into a run dir that already exists in a worktree. Its comment had justified that by the copy-out guard. It now rests on its own ground: a write into an existing directory creates no new shadow. Decide for each such behavior whether it goes with the removed thing or stays with a rewritten rationale, and say which in the spec.

### Give each of the removed thing's tests a verdict: deleted, already pinned, or retargeted

A removed function's tests mix assertions about the function itself with assertions about code it wrapped. Delete the first kind with it. For each of the second kind, cite the surviving test that already pins that behavior, or move the assertion onto the survivor and show it go red. #5542's `listClaimNames` had three tests in `tests/bin-lib/issues/claim-store.test.js`, asserting three things: the name mapping was its own behavior (deleted); the `recursive=1` path and no-`-f` rule were already pinned by `listClaimEntries`' tests (deleted, with those tests cited in the plan); the `gh-absent` failure passthrough had no other pin, so it moved onto `listClaimEntries` and was shown red with the passthrough line removed. #5535's three pins in `tests/review-tiebreak-step-conformance.test.js` read the retired verb's own comment and docs line, so they went with that text. This is the per-assertion inventory `skill-prose-conformance-tests` asks for when retargeting pins.

## Decision Framework

| A hit on the retired vocabulary in… | Verdict |
|---|---|
| live skill prose, `docs/donts.md`, `docs/skill-graph.md`, `docs/plugin-structure.md`, `.claude/skills/` | rewrite or delete |
| a code comment, a test title, a test comment | rewrite; behavior unchanged unless the record says otherwise |
| a test assertion | re-anchor (a sentinel) or retarget (a pin); delete it outright only when what it pins was deleted too, or a surviving test you cite already pins it |
| `docs/incident-log.md`, `CHANGELOG.md`, archived run `work/*.md`, `docs/superpowers/plans/*` | leave: history, not live guidance |
| an accepted decision record in `docs/decisions/`, a `docs/plans/*-ledger.md` | leave: a decision record is superseded rather than edited (ADR-0013); a new decision record states the removal (#5561 left 0012 and 0015 and added 0035) |
| an unrelated step with the same number (Step 3.5 also exists in review, backlog refine, journeys, docs-health, routine status, attention mode) | leave |

## Project Conventions

- The removal is unconditional once a sunset date passes, whatever the condition's check finds; the check's result goes in the PR as a report.
- The incident log's post-mortem is never edited. It is the evidence for why the removed thing existed (#3847 ledger row 7).
- The rule a rationale supported survives the removal unless the record says otherwise; only its stated reason moves.

## Common Operations

1. Run the condition's check from the main checkout and record the command and a count for the PR. Post both to the PR as soon as the check has run, before the first deleting commit is pushed (#5534 ran the check first and posted it after the deletions were pushed).
2. Delete the removed section and its pointer step, keeping later step numbers.
3. Grep the identifiers, then the skip-list and range shapes, then the framing words, across `plugin docs tests .claude/skills` with the history paths excluded. Give each hit a verdict from the Decision Framework. When the record asks for a per-hit verdict table in the PR, build and post it once, after the last code-changing step (simplify, review fixes and any catch-up merge included), and re-run the sweep against the table before posting: every later commit shifts its file:line keys (#5534's table went stale three times).
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
- Pending contract steps recorded in an ADR: the ADR names the removal condition and the parked record that holds it, and the code says only `contract step (#N)` or `expand half`, so the Overview's `removal condition` grep misses them. Also run `git grep -n -i -e 'contract step' -e 'expand half' -- plugin/ docs/decisions/`. Current hits: ADR 0035 (`plugin/bin/lib/issues/trust.js`'s `revocationOnly`, held by #5717) and ADR 0029 (the `demo:*` labels, contract step #4625).
