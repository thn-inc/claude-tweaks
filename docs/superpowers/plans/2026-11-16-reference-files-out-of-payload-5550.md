# Reference Files Out Of The Plugin Payload (#5550) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move three reference-only files out of `plugin/skills/` into `docs/reference/`, and delete the eleven "Moved to" stub sections in `plugin/skills/_shared/` after repointing the two citers that name one of them.

**Architecture:** Markdown and one test-constant edit, no code. Task 1 moves the files and fixes everything that names them, stub 2 included, because that stub is the only citer of one moved file. Task 2 deletes the other ten stubs, repoints two citers, corrects one count sentence and updates the project skill that states the stub rule. Task 3 is verification only.

**Tech Stack:** Markdown under `plugin/skills/` and `docs/`, `node --test` suites, `git mv`.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T231106-spec-5550-5551/spec-5550/work/5550-spec.md`

## Global Constraints

- Every line number in the spec is at commit `869785424`. Locate each edit by its heading or quoted text, never by line number.
- No file under `plugin/skills` may grow, except `transcript-judge.md`, which changes by exactly -2 bytes (`subagent-output-contract` to `subagent-dispatch-core`). Byte sizes at the build base: `pipeline-run-dir.md` 24366, `pr-early-run-lifecycle.md` 35340, `subagent-output-contract.md` 30074, `policy-schema.md` 49189, `design-wrapper/SKILL.md` 38787, `transcript-judge.md` 18681.
- Do not rename or renumber any surviving heading. A stub deletion removes the heading line, its body and one of the two blank lines around it, nothing else. The one exception is the pointer Task 2 Step 3 re-resolves in `pipeline-run-dir.md` ("the order below"), which named stub 1.
- Do not edit: `_shared/auto-mode-anti-patterns.md`, `_shared/policy-schema-model-profiles.md`, `_shared/github-pr-scan.md`, `_shared/work-record.md`, the `## Key naming` stub in `policy-schema.md`, any "Extracted to" stub, `CLAUDE.md`, `docs/incident-log.md`, anything under `docs/superpowers/` other than this plan, or any `(contract § Model Selection)` phrase.
- `git grep -E` with `\b` matches nothing on this machine. Use `-F`, `-w` or `-P`.
- One plain command per Bash call in this worktree: no `&&`, no `git` inside `$(...)`, no pipes into `node -e`.
- Commit subjects use `{Verb} {what} — {detail}` with a `refs #5550` body line. Stage files by explicit path. Never `git stash`.
- Quoted from `.claude/skills/shared-contract-extraction/SKILL.md` (the rule this record refines): "When no uncited section frees enough bytes, a cited section may move, but only if its stub keeps every name a citer uses. Derive those citers from the file's path, not the section's names."
- Quoted from `.claude/skills/compose-context-fencing/SKILL.md`: "The check is a grep, not a read-through, and it runs on every transport's bundle." Task 3 applies it as a before-and-after byte comparison of all twelve compose call sites; this record adds no `when:` marker and no numbered-item pointer.
- `.claude/skills/skill-prose-conformance-tests/SKILL.md` ("Retargeting existing pins: diff the assertion inventory") does not apply: no pinned prose moves between governed files. Proof, run at the build base: `git grep -n -F -e "Cite that file, not this stub" -e "— moved" -e "canonical coercion contract" -e "coverage — canonical" -e "derivation — canonical" -- tests plugin/bin tools` matched only three unrelated code comments (`preflight-records.js:119`, `claim-targets.test.js:81`, `session-limit-degrade-conformance.test.js:10`) and `tests/pr-early-run-lifecycle.test.js:181`, a comment above assertions that the lifecycle file does *not* carry the real headings.

### Premises checked at the build base (`026e203f3`)

- Both `ASSUMPTION — verify at build:` gotchas hold: the initialized-check file states no instruction a skill step must follow, and `git grep -n "initialized-check" -- plugin` prints only the stub at `pipeline-run-dir.md:170`.
- Citers naming a stub's file together with its section, from a whitespace-collapsed sweep over every tracked `.md`/`.js`/`.json`/`.yml` file outside `docs/incident-log.md`, `docs/superpowers/`, `docs/plans/`, `.claude-tweaks/` and `CHANGELOG.md` (file basename followed within 60 characters by a section name): exactly two need repointing, `plugin/skills/_shared/transcript-judge.md` and `docs/skill-authoring.md`, both for stub 6. `docs/skill-graph.md:247` says "#2019 renamed this citation's target from `_shared/pipeline-run-dir.md`'s moved Resolution order section": a statement about history that stays true, no change. `plugin/skills/build/plan-review.md` already names `_shared/subagent-dispatch-core.md`'s Model Selection section. The other eleven hits are files citing `policy-schema.md` beside the word "coverage" for the sibling file, not a stub.
- `_shared/subagent-dispatch-core.md` has `## Model Selection` (line 208), `## Working Directory Discipline`, `## Template A — Review-style (returns findings)`, `## Failed-agent retrieval` and `## How to integrate at a dispatch site`. `_shared/run-dir-resolution.md` has `## Resolution order` and `## Bash snippet (resolution)`. `_shared/pr-checklist-refresh.md` has `## Phase-checklist update (every phase exit)` and `## Pre-merge title/description refresh`.
- `plugin/bin/lib/model-profiles/profiles.js:25` reads `POLICY_KEYS_READ = ['model-profiles', 'model-stance', 'model-ceiling', 'frontier-run-cap']`: four keys. The table under `policy-schema.md`'s `## Model profiles` lists five, `research-mode` last.
- `docs/REGISTRY.md` convention: of the six files in `docs/reference/`, four have a row of their own and two (`claude-quality-levers.md`, `skill-description-audit.md`) rely on the generic `docs/reference/*.md` row, which has no auto-detect pattern. The spec's condition for adding a row ("a reference doc with a row of its own") is met. Decided by the user at plan review (spec's `## Plan Review Clarifications`): add one row, for `pipeline-run-dir-initialized-check.md`, because it documents code (`plugin/bin/hooks.js`'s `resolveRunArg`) and only a row with that auto-detect pattern makes a later change to the resolver prompt a review of the doc. The two comparison files are decision records with no code trigger and stay on the generic row.
- Composed bundle sizes before the change (`node plugin/bin/context-cost-report.js --plugin-root plugin`, twelve call sites, max bytes): `worktree-setup` 52476, `claims` 50392 (four sites), `merge` 52454 (four sites), `manifesto` 27962, `review-dispatch` 52234, `pr-scan` 51650.

Waived plugin/skills/_shared/policy-schema-model-profiles.md: read only, to confirm it already says "these four"; the spec forbids editing it.
Waived plugin/skills/_shared/github-pr-scan.md: named in a Gotcha as a file this record must not edit.
Waived tests/timing-nested-parent-roster.test.js: named in a Gotcha as unaffected; Task 3's full suite runs it.
Waived docs/incident-log.md: historical text, left as is by the spec.

## Review Focus

- A stub deletion that also removes the following real section's heading, or leaves three blank lines. Task 2's heading-list comparison pins the first; a reviewer reads the diff for the second.
- A reader landing on a moved comparison file and following a bare file name (`critics.md`, `impeccable-cli.md`) that no longer has a sibling. Task 1 adds one orientation sentence to each moved comparison file.
- `tests/impeccable-retired-scripts-sweep.test.js` now sweeping the two comparison files at their `docs/` location: it must pass with both `EXEMPT_PATHS` entries removed, not with them repointed.
- The moved initialized-check file still saying "Cited from that section" after the stub that cited it is gone. Task 1 rewrites that header sentence.
- `policy-schema.md` growing because the corrected "four of five" sentence is longer than the stubs removed. Task 2 measures the file after all four edits.

---

### Task 1: Move the three reference files and fix everything that names them

**Files:**
- Delete: `plugin/skills/design-wrapper/third-party-design-skill-comparisons.md`
- Delete: `plugin/skills/design-wrapper/claude-design-skill-comparison.md`
- Delete: `plugin/skills/_shared/pipeline-run-dir-initialized-check.md`
- Create: `docs/reference/third-party-design-skill-comparisons.md`
- Create: `docs/reference/claude-design-skill-comparison.md`
- Create: `docs/reference/pipeline-run-dir-initialized-check.md`
- Modify: `plugin/skills/design-wrapper/SKILL.md`
- Modify: `plugin/skills/_shared/pipeline-run-dir.md`
- Modify: `docs/plugin-structure.md`
- Modify: `docs/REGISTRY.md`
- Modify: `docs/hooks.md`
- Test: `tests/impeccable-retired-scripts-sweep.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: the three files at `docs/reference/{same basename}`; stub 2 (`### Initialized-run-dir requirement (#1566) — moved`) gone from `pipeline-run-dir.md`. Task 2 deletes that file's other two stubs.

- [ ] **Step 1: Record the controls**

Run each as its own call and keep the output for the commit message check in Step 6:

`git grep -n -e "design-skill-comparison" -e "pipeline-run-dir-initialized-check" -- plugin`
Expected: 4 lines (`_shared/pipeline-run-dir.md`, two in `design-wrapper/SKILL.md`, one in `design-wrapper/third-party-design-skill-comparisons.md`).

`git grep -n -e "design-skill-comparison" -e "pipeline-run-dir-initialized-check" -- tests`
Expected: 2 lines, both in `tests/impeccable-retired-scripts-sweep.test.js`.

- [ ] **Step 2: Move the files with `git mv`, one call each**

`git mv plugin/skills/design-wrapper/third-party-design-skill-comparisons.md docs/reference/third-party-design-skill-comparisons.md`
`git mv plugin/skills/design-wrapper/claude-design-skill-comparison.md docs/reference/claude-design-skill-comparison.md`
`git mv plugin/skills/_shared/pipeline-run-dir-initialized-check.md docs/reference/pipeline-run-dir-initialized-check.md`

Commit the three pure renames on their own before editing any moved file, so `git log --follow` keeps history (AC1.2): subject `Move three reference-only files to docs/reference — out of the plugin payload`.

- [ ] **Step 3: Edit the moved files**

In `docs/reference/pipeline-run-dir-initialized-check.md`:
- Replace the opening paragraph (from "Split out of" through "opt out of this check.") with: "Split out of `plugin/skills/_shared/pipeline-run-dir.md`'s Anchoring section (#2722) and moved out of the plugin payload (#5550): `resolveRunArg`'s own initialization-check detail, relevant to a `plugin/bin/*.js` author extending or auditing that resolver, not to a skill-following session doing an ordinary worktree-creation catch-up. Cited from `docs/hooks.md`; read this file only when working on `plugin/bin/hooks.js`'s `resolveRunArg` or auditing which of its 8 shared callers opt out of this check." Keep the 100-column wrapping of the surrounding text.
- In the body, turn each bare skill-file reference into a repo path: `pipeline-run-dir.md`'s "Worktree-local `--run` fallback" becomes `plugin/skills/_shared/pipeline-run-dir.md`'s; `dispatch/SKILL.md` becomes `plugin/skills/dispatch/SKILL.md`; `flow/steps-and-gates.md` becomes `plugin/skills/flow/steps-and-gates.md`; `worktree-setup.md` Step 4.5 becomes `plugin/skills/build/worktree-setup.md` Step 4.5. Change nothing else in the body.

In `docs/reference/third-party-design-skill-comparisons.md`, after the first paragraph (which ends "Reference only — no mode's dispatch logic loads it."), add one paragraph: "Moved here from `plugin/skills/design-wrapper/` (#5550). A bare file name below, such as `critics.md` or `impeccable-cli.md`, names a file in that directory unless the sentence says it belongs to the skill being compared." The sibling reference `claude-design-skill-comparison.md` in the next paragraph stays as it is: both files are siblings again.

In `docs/reference/claude-design-skill-comparison.md`, after the first paragraph (which ends "instead of (or alongside) Impeccable."), add one paragraph: "Moved here from `plugin/skills/design-wrapper/` (#5550). A bare file name below, such as `impeccable-cli.md`, names a file in that directory."

- [ ] **Step 4: Fix the citers**

- `plugin/skills/design-wrapper/SKILL.md`, `## Reference sub-files`: delete the two list items that begin "- `claude-design-skill-comparison.md` —" and "- `third-party-design-skill-comparisons.md` —". The list then ends at the `impeccable-plugin.md` item.
- `plugin/skills/_shared/pipeline-run-dir.md`: delete stub 2, the heading `### Initialized-run-dir requirement (#1566) — moved`, its three-line body beginning "Moved to `_shared/pipeline-run-dir-initialized-check.md` (#2722)" and one blank line, so that `### Worktree-local `--run` fallback (#280)` follows the preceding paragraph after exactly one blank line.
- `docs/plugin-structure.md`, the `| design-wrapper |` row: remove `claude-design-skill-comparison.md, ` and `third-party-design-skill-comparisons.md, ` from the sub-file list, and remove the row's last two clauses, from "; a decision record (#2690) on why" through "— likewise reference only", so the row ends "loaded only when that track resolves |".
- `docs/REGISTRY.md`: add one row directly under the `docs/reference/gh-issue-write-inventory.md` row: `| docs/reference/pipeline-run-dir-initialized-check.md | The initialized-run-dir requirement on `resolveRunArg`'s anchored-directory branch (#1566) and the two callers that opt out through `resolveOpts.allowUninitialized`; moved out of the plugin payload by #5550 | `plugin/bin/hooks.js` |`
- `docs/hooks.md`: append one sentence to the end of the paragraph that begins "The five mutating run-state verbs (`close-run`, `record-worktree`, `record-pr`, `spec-status`, `teardown-run`)": "The initialized-run-dir requirement on `resolveRunArg`'s anchored-directory branch, and the two callers that opt out of it, are in `docs/reference/pipeline-run-dir-initialized-check.md`."
- `tests/impeccable-retired-scripts-sweep.test.js`: delete the two `EXEMPT_PATHS` entries naming the comparison files. Add no entry for their new paths: `docs` is in `SWEPT_DIRS`, so the sweep now reads both files, and it must pass on their content.

- [ ] **Step 5: Verify AC1.1, AC1.2, AC2.1, AC2.2, AC2.3 and the sweep test**

`git ls-files plugin/skills/design-wrapper/third-party-design-skill-comparisons.md plugin/skills/design-wrapper/claude-design-skill-comparison.md plugin/skills/_shared/pipeline-run-dir-initialized-check.md`
Expected: no output (AC1.1).

`git log --follow --oneline -3 -- docs/reference/pipeline-run-dir-initialized-check.md` and the same for the two comparison files.
Expected: each shows at least one commit older than this task's move commit (AC1.2).

`git grep -n -e "design-skill-comparison" -e "pipeline-run-dir-initialized-check" -- plugin`
Expected: no output, exit 1 (AC2.1; Step 1 showed 4 lines).

`git grep -n -e "design-skill-comparison" -e "pipeline-run-dir-initialized-check" -- tests`
Expected: no output, exit 1 (AC2.3; Step 1 showed 2 lines).

`git grep -n -e "design-skill-comparison" -e "pipeline-run-dir-initialized-check" -- docs ":!docs/incident-log.md" ":!docs/superpowers" ":!docs/reference"`
Expected: only lines that name `docs/reference/pipeline-run-dir-initialized-check.md` in full (`docs/REGISTRY.md`, `docs/hooks.md`); no line in `docs/plugin-structure.md` (AC2.2).

`node --test tests/impeccable-retired-scripts-sweep.test.js`
Expected: pass, 1 test.

`wc -c plugin/skills/design-wrapper/SKILL.md plugin/skills/_shared/pipeline-run-dir.md`
Expected: `SKILL.md` below 38787; `pipeline-run-dir.md` below 24366.

- [ ] **Step 6: Commit**

Stage each edited file by path and commit: `Repoint citers of the moved reference files — delete the initialized-check stub`, body `refs #5550`.

### Task 2: Delete the other ten stubs, repoint two citers, correct the key count

**Files:**
- Modify: `plugin/skills/_shared/pipeline-run-dir.md`
- Modify: `plugin/skills/_shared/pr-early-run-lifecycle.md`
- Modify: `plugin/skills/_shared/subagent-output-contract.md`
- Modify: `plugin/skills/_shared/policy-schema.md`
- Modify: `plugin/skills/_shared/transcript-judge.md`
- Modify: `docs/skill-authoring.md`
- Modify: `docs/journeys/compose-a-per-run-context-bundle-1988.md`
- Modify: `.claude/skills/shared-contract-extraction/SKILL.md`

**Interfaces:**
- Consumes: Task 1 already removed stub 2 from `pipeline-run-dir.md`.
- Produces: no `— moved` heading left under `plugin/skills/_shared`; Task 3 measures the result.

- [ ] **Step 1: Record the controls**

`git grep -n -E "^#+ .* — moved$" -- plugin/skills/_shared`
Expected: 7 lines (the spec's eight, less stub 2).

`git grep -n -F -e "canonical coercion contract" -e "coverage — canonical" -e "derivation — canonical" -- plugin/skills/_shared/policy-schema.md`
Expected: 3 lines.

`git grep -n -F "subagent-output-contract.md\`'s Model Selection" -- docs/skill-authoring.md`
Expected: 1 line.

`git grep -n -F "reads these five" -- plugin/skills/_shared/policy-schema.md`
Expected: 1 line.

- [ ] **Step 2: Repoint the two citers of stub 6**

- `plugin/skills/_shared/transcript-judge.md`: in the sentence "per `_shared/subagent-output-contract.md`'s Model Selection section" (wrapped across two lines), change the file name to `_shared/subagent-dispatch-core.md`. Nothing else on either line changes.
- `docs/skill-authoring.md`, the `| Effort-level selection |` row: change "`_shared/subagent-output-contract.md`'s Model Selection section" to "`_shared/subagent-dispatch-core.md`'s Model Selection section".

- [ ] **Step 3: Delete ten stub sections**

For each, delete the heading line, every body line up to the blank line before the next heading, and one blank line. The next heading must be left untouched.

| File | Heading to delete | Next heading (must survive) |
|---|---|---|
| `pipeline-run-dir.md` | `## Resolution order — moved` | `## Resolving it: \`resolve-run-dir\` (preferred over composing \`$RUN_ROOT\` by hand)` |
| `pipeline-run-dir.md` | `## Bash snippet (resolution) — moved` | `## See also` |
| `pr-early-run-lifecycle.md` | `## Phase-checklist update and pre-merge title/description refresh — moved` | `## Skip / degrade behavior` |
| `subagent-output-contract.md` | `## Working Directory Discipline — moved` | `## Waiting for Dispatched Agents` |
| `subagent-output-contract.md` | `## Model Selection and Template A — moved` | `## Template B — Search-style (returns locations)` |
| `subagent-output-contract.md` | `## Failed-agent retrieval — moved` | `## Exemption: third-party agents` |
| `subagent-output-contract.md` | `## How to integrate at a dispatch site — moved` | `## Related primitives` |
| `policy-schema.md` | `` ## `resolveValue` — canonical coercion contract `` | `## Metadata fields` |
| `policy-schema.md` | `` ### `worktree-always` coverage — canonical `` | `## Integration model` |
| `policy-schema.md` | `` ### `merge-verification` derivation — canonical `` | `## Project facts` |

Deleting stub 1 leaves one pointer at nothing. In `pipeline-run-dir.md`'s "**Not the hook-side algorithm.**" paragraph, the sentence "A change to the order below does not change hook behavior, and vice versa." named that stub: change "the order below" to "that order" (the Resolution order the paragraph before it assigns to `_shared/run-dir-resolution.md`). No other above/below pointer in the four files names a stub; a grep of each stub's section name beside "above"/"below" found only this one.

`subagent-output-contract.md`'s opening paragraph ("Five sections — Working Directory Discipline, Model Selection, Template A, Failed-agent retrieval, and the fan-out section … moved to `_shared/subagent-dispatch-core.md` (#2019)") stays unchanged: it is what "the contract's Model Selection section" resolves through once the stubs are gone.

- [ ] **Step 4: Correct the key count in `policy-schema.md`**

Under `## Model profiles`, replace the sentence "Registered by #219; the resolver that actually reads these five is `bin/lib/model-profiles/profiles.js` (`resolve()`)." with "Registered by #219; the resolver, `bin/lib/model-profiles/profiles.js` (`resolve()`), reads four of these five (`model-stance`, `frontier-run-cap`, `model-ceiling`, `model-profiles`); `research-mode` is unrelated to it." The rest of the paragraph ("Full canonical-home/owner-skill/default/meaning table: …") and the five-row table stay unchanged.

- [ ] **Step 5: Update the stub guidance in the project skill**

In `.claude/skills/shared-contract-extraction/SKILL.md`, in the bullet that begins "**When no uncited section frees enough bytes, a cited section may move, but only if its stub keeps every name a citer uses.", append to the end of that bullet: " A stub is not permanent: it stays while something cites its file and section by name or a test pins it, and is deleted once nothing does. #5550 deleted eleven \"Moved to\" stubs after repointing their two by-name citers, and kept the \"Extracted to\" stubs in `_shared/github-pr-scan.md` and `_shared/work-record.md` and the `## Key naming` stub in `_shared/policy-schema.md`, each still cited by name or pinned (`tests/issue-claims-pr-scan-composition.test.js`, `tests/policy-key-naming.test.js`); each goes by the same rule once its reason lapses."

- [ ] **Step 6: Check the journey page**

Create an empty directory `{scratch}/compose-demo`, write a file `{scratch}/compose-demo/config.yml` holding the single line `integration-model: pr-first`, then run from the worktree root:

`node plugin/bin/compose-context.js --run "{scratch}/compose-demo" --step merge plugin/skills/_shared/pr-first-merge.md plugin/skills/_shared/pr-checklist-refresh.md`

then `grep -n -e "^## Phase-checklist update" -e "^## Pre-merge title/description refresh" -e "^## Local-merge fallback" "{scratch}/compose-demo/context/merge.md"`.
Expected: all three headings present. Then the journey page (`docs/journeys/compose-a-per-run-context-bundle-1988.md`, step 6) needs no edit; leave it untouched and say so in the report. Edit the page only if a heading it names is missing from that output.

- [ ] **Step 7: Verify AC3.1, AC3.2, AC3.3, AC4.1, AC4.2, AC6.1, AC6.2, AC7.1, AC8.1, AC8.2**

`git grep -n -E "^#+ .* — moved$" -- plugin/skills/_shared`
Expected: no output, exit 1 (AC3.1; Step 1 showed 7).

`git grep -n -F -e "canonical coercion contract" -e "coverage — canonical" -e "derivation — canonical" -- plugin/skills/_shared/policy-schema.md`
Expected: no output, exit 1 (AC3.2; Step 1 showed 3).

Heading lists without line numbers, the "before" one read from the build base so it covers Task 1's edits too. Each is its own call, redirected to a scratch file:

`git grep -h -E "^#{1,6} " 026e203f3 -- plugin/skills/_shared/pipeline-run-dir.md plugin/skills/_shared/pr-early-run-lifecycle.md plugin/skills/_shared/subagent-output-contract.md plugin/skills/_shared/policy-schema.md plugin/skills/design-wrapper/SKILL.md` (81 lines at the base)

the same command without `026e203f3`, then `diff` the two files.
Expected: exactly eleven removed lines, the ten headings in Step 3's table plus `### Initialized-run-dir requirement (#1566) — moved`, and no added line (AC3.3).

`git grep -n -F "subagent-output-contract.md\`'s Model Selection" -- docs/skill-authoring.md`
Expected: no output, exit 1 (AC4.1).

`git grep -n -F "subagent-dispatch-core.md" -- plugin/skills/_shared/transcript-judge.md`
Expected: 1 line, the repointed sentence (AC4.2).

`git grep -n -F "reads these five" -- plugin/skills/_shared/policy-schema.md`
Expected: no output, exit 1 (AC8.1). `git grep -n -F "reads four of these five" -- plugin/skills/_shared/policy-schema.md` prints 1 line (AC8.2).

`wc -c plugin/skills/_shared/pipeline-run-dir.md plugin/skills/_shared/pr-early-run-lifecycle.md plugin/skills/_shared/subagent-output-contract.md plugin/skills/_shared/policy-schema.md plugin/skills/_shared/transcript-judge.md`
Expected: each of the first four below its Global Constraints figure (AC6.1); `transcript-judge.md` exactly 18679 (AC6.2). Report all five numbers.

`git diff --stat 026e203f3 -- plugin/skills/_shared/auto-mode-anti-patterns.md plugin/skills/_shared/policy-schema-model-profiles.md plugin/skills/_shared/github-pr-scan.md plugin/skills/_shared/work-record.md`
Expected: no output (AC7.1).

`node --test tests/issue-claims-pr-scan-composition.test.js tests/policy-key-naming.test.js tests/pr-early-run-lifecycle.test.js tests/review-dispatch-composition.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: every test passes, 0 fail.

- [ ] **Step 8: Commit**

Stage each edited file by path and commit: `Delete ten Moved-to stubs — repoint the Model Selection citers and correct the model-profile key count`, body `refs #5550`.

### Task 3: Acceptance evidence and full verification

**Files:**
- Test: `tests/issue-claims-pr-scan-composition.test.js`
- Test: `tests/policy-key-naming.test.js`
- Test: `tests/pr-early-run-lifecycle.test.js`
- Test: `tests/review-dispatch-composition.test.js`
- Test: `tests/impeccable-retired-scripts-sweep.test.js`
- Test: `tests/bin-lib/skill-audit/context-cost.test.js`

**Interfaces:**
- Consumes: Tasks 1 and 2 committed.
- Produces: nothing; no file changes. Folded into `/claude-tweaks:build` Common Step 5 (no new code).

- [ ] **Step 1: Verify AC5.1 with the six named suites**

`node --test tests/issue-claims-pr-scan-composition.test.js tests/policy-key-naming.test.js tests/pr-early-run-lifecycle.test.js tests/review-dispatch-composition.test.js tests/impeccable-retired-scripts-sweep.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: 0 fail (AC5.1).

- [ ] **Step 2: Verify composed bundles did not grow**

`node plugin/bin/context-cost-report.js --plugin-root plugin`, saved to a scratch file, compared per call site with the "before" figures in Premises.
Expected: twelve call sites, none larger than before.

- [ ] **Step 3: Verify AC9.1 through the run's verification**

The run's `verify.js` invocation (Common Step 5) is the check for AC9.1; `npm test -- --full` is what its `tests` suite runs, here or in the PR's CI job.

- [ ] **Step 4: Record the AC evidence**

Write the output of Tasks 1-2's verification greps, the heading diff, the `wc -c` table and Step 2's comparison to `$PIPELINE_RUN_DIR/evidence/ac-5550.txt`, and log one `AC evidence` decision naming AC1-AC8, the commands and the counts.

- [ ] **Step 5: State the byte sizes in the pull request (AC6.2)**

Add a `### Byte sizes (#5550)` section to PR #5583's body, below the fixes block: the before and after `wc -c` of the five shrinking files, and `transcript-judge.md`'s change of -2 bytes (18681 to 18679), the length difference between `subagent-output-contract` and `subagent-dispatch-core`.
