# Console-Residue Proposals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the eight staged skill/doc edit proposals recovered by the 2026-10-20 console-residue audit (record #3773), each re-derived from current code rather than copied from its stale staged text.

**Architecture:** Prose-only change across `.claude/skills/`, `docs/`, and one shipped skill sub-file (`plugin/skills/build/plan-authoring-checks.md`). The only new test is a prose pin for the new plan-authoring checks, matching the existing `tests/plan-authoring-*-prose.test.js` convention. Every other edit is verified by grep against the live tree.

**Tech Stack:** Markdown; `node --test` for the one new prose pin.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T174156-record-3773/work/3773-spec.md`. The verbatim proposal texts are the record's comments: `gh issue view 3773 --repo thn-inc/claude-tweaks --json comments --jq '.comments[].body'`. The proposals for checks (a) to (c) are staged reflect files in the main checkout's run archive (paths in Task 5).

## Global Constraints

- The record requires that "every cited path and line was re-verified against current code before writing". A proposal's text is a hypothesis. Where current code contradicts it, write what the code does now, and say so in the task's commit body.
- `npm test` passes in full (spec AC).
- `plugin/skills/build/plan-authoring-checks.md` stays under `RAIL_BYTES` (52,500 B, `plugin/bin/lib/skill-audit/budgets.js`). It is 46,225 B at base, so the headroom is 6,275 B. Budget the three new paragraphs at about 1,000 B each.
- No test may declare a byte-count literal for a skill file: `tests/skill-size-single-source.test.js` fails the suite on one outside `budgets.js`.
- `.claude/skills/**` has no CI byte rail. Its "soft ceiling" is the harness-health bloat scan, which is relative to the corpus. The spec's ceiling AC is met by keeping each edited project skill's net byte growth at or below zero wherever the proposal itself flagged an overage (gh-api-module-pattern).
- Commit style: `{Verb} {what} — {detail}`. The body carries `refs #3773` (never `closes`/`fixes`) and ends with `Claude-Session: https://claude.ai/code/session_01S3U6SmaWdmktEPnhiDYJeo`. Stage files by explicit path only.
- Every git and test command runs as `git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-3773" …`, or from that cwd. One plain command per Bash call, no `cd … &&` chains.

## Already verified at authoring time (facts the tasks build on)

- Check (d) is already present. `plan-authoring-checks.md:39`'s **Prose-held pin check (extends the Moved-prose pin check)** is spec-3319's lesson, with `tests/ceremony-profile-roster.test.js` as its worked example. No edit for (d). Logged in `decisions.md` as a premise reversal.
- `tests/helpers/strip-comments.js` exports `{ stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES }`. It **models regex literals** (#3585); the residual ambiguity is a `/` after `)` or `}`. `stripperVerdict` (#3573) is the compile-oracle backstop. Five scans import it: `tests/windows-hide-spawn-conformance.test.js`, `tests/git-status-optional-locks.test.js`, `tests/path-guard-conformance.test.js`, `tests/path-containment-conformance.test.js`, and `tests/bin-lib/exit-code-conformance.test.js`. The exit-code scan uses `stripComments` plus its own `guardBlankedByStripper`, not `stripperVerdict`. The helper's own tests are in `tests/helpers-strip-comments.test.js`. The floor in `tests/git-status-optional-locks.test.js:136` is `total >= 12`. So proposal 1's stripper paragraphs and proposal 2's Amendment 3 ("does not model regex literals") are both stale.
- `.claude/skills/parse-signal-discipline/SKILL.md` already has items 1 to 16. Item 15 covers the stripper transform. The new item is **17**.
- `isRepoRelativeKeyFilePath` (`plugin/bin/lib/issues/record.js:394`) is called by four producers: `code-health/issue-payload.js:60`, `harness-health/issue-payload.js:179`, `docs-health/issue-payload.js:68`, and `journey-health/issue-payload.js:55`. `grouping.js` skips `endsWith('/')` at lines 91, 241, and 355. Commit `44883e90b` exists.
- `plugin/bin/impeccable-engine.js` exits 2 only on usage (`validateVerbArgs`, line 37). Line 7 of its header states the exit-0-on-`ok:false` posture. `VERBS` in `lib/impeccable-engine/index.js:35` is `['signals','doctor','concept-seed','surface-brief']`, with **no `run` verb**. `FAILURE_REASONS` is frozen at line 26.
- `CLAUDE_TWEAKS_GH_TIMEOUT_MS` (#2567) and `CLAUDE_TWEAKS_GIT_TIMEOUT_MS` (#3051, key `git-timeout-ms`) both sit above `policy.yml` in `plugin/bin/lib/shared-primitives.js`. `resolve-policy.js` reads neither.
- `docs/plugin-structure.md:99`'s review row now also lists `step3-cross-lens-corroboration.md` and `step3-skill-load-delta.md`, so the staged diff's context lines are stale. Rewrite the row from current text.
- No test pins the reworded phrases: `git grep` over `tests plugin` for "maintainer-only mechanism", "A new Step 6.X pass mirroring", "names the layer that decided each value", and the review-row phrases returns nothing outside the target files.
- This repo opts in with `.claude-tweaks/policy.yml:13` `specify-decomposition-log: true`. The key is registered at `plugin/bin/lib/policy-schema.js:115` (`tier: 'advanced'`, default `false`).

## AC coverage

- AC1.1 (each target carries its proposal's invariant, every citation re-verified): Tasks 1 to 5, each in its own "Verify" step. Task 5's prose pin covers the three new checks.
- AC2.1 and AC2.2 (`npm test` passes in full; the prose pins and byte checks hold): `/build` Common Step 5's full-suite run. Each task's targeted `node --test` step runs before that.
- AC3.1 (byte ceilings): Task 2 Steps 1 and 3 (`wc -c` at or below base) and Task 5 Steps 1 and 6 (`wc -c` under `RAIL_BYTES`, plus the `rail:` test). The new skill in Task 1 sits far below any ceiling.

## Review Focus

1. A stale claim copied from a staged proposal. For example, "the helper does not model regex literals", "four scans", or "impeccable-engine's `run` verb". A reader acting on it would write wrong code. Each task's verification greps the cited symbols.
2. `gh-api-module-pattern/SKILL.md` growing past its base size, after the proposal itself flagged it as over the soft ceiling. Task 2 measures the size before and after.
3. `plan-authoring-checks.md` crossing the rail. Task 5 measures it, and the `rail:` test in `tests/bin-lib/skill-audit/context-cost.test.js` runs.
4. A cited commit, line number, or test name that does not exist. The tasks cite symbols, not line numbers, wherever the line can move.
5. A new plan-authoring paragraph whose label collides with an existing one, or that breaks `tests/ceremony-profile-roster.test.js`'s **Batched-plan marker.** lookup. Task 5's pin asserts exactly one of each label, and the full suite runs.

---

### Task 1: Create the `bin-source-scan-conformance` project skill

**Files:**
- Create: `.claude/skills/bin-source-scan-conformance/SKILL.md`

**Interfaces:**
- Consumes: none. Produces: the skill name `bin-source-scan-conformance`, which Task 3's item 17 does not need. Nothing else references it.

- [ ] **Step 1: Read the sources.** Read proposal 1 (comment 1) and proposal 2's five amendments (comment 2), then `tests/helpers/strip-comments.js` (whole header), the top 80 lines of each of the five scans named in "Already verified", and `.claude/skills/parse-signal-discipline/SKILL.md` item 15.
- [ ] **Step 2: Write the SKILL.md.** Use proposal 1's structure (frontmatter, Overview, Key Patterns, Decision Framework, Anti-Patterns, Reference) with proposal 2's amendments 1, 2, 4, and 5 applied. Replace Amendment 3 with current fact: the helper models regex literals (#3585), and its known ambiguity is a `/` after `)` or `}`. `stripperVerdict` (#3573) reports `misparsed`/`unparseable` as an offender, and four scans call it. The exit-code scan uses `guardBlankedByStripper` instead. A mis-parse that still compiles passes unseen. Cite parse-signal-discipline item 15 for the could-not-parse principle rather than restating it. The Overview list names all five scans (add `tests/path-containment-conformance.test.js` with a one-line description taken from its own header comment). The description must keep the trigger keywords and stay under 1,536 characters.
- [ ] **Step 3: Verify every citation resolves.** For each backticked path in the new file, run `git ls-files --error-unmatch {path}`. For each symbol (`stripComments`, `stripperVerdict`, `STRIPPER_VERDICT_MESSAGES`, `guardBlankedByStripper`, `ARGV_STATUS`, `GIT_STATUS_CMD`, `QUOTED`, `total >= 12`), run `git grep -n -F '{symbol}' -- tests`. Expected: every path resolves and every symbol has at least one hit. Drop or fix any that does not.
- [ ] **Step 4: Run** `node --test tests/argument-hint-mirrors.test.js tests/bin-lib/skill-audit/context-cost.test.js`. Expected: pass. The first sweeps `.claude/skills` for retired phrasings; the second checks description length.
- [ ] **Step 5: Commit** with message `Add the bin-source-scan-conformance project skill — written from current strip-comments.js, not the stale #3464 proposal`. The body names the corrections (regex literals modeled, five scans, `stripperVerdict`), then `refs #3773` and the session trailer.

### Task 2: gh-api-module-pattern: `--no-optional-locks` bullet and reason-enum envelope posture

**Files:**
- Modify: `.claude/skills/gh-api-module-pattern/SKILL.md` (the injectable-runner bullet list, after the `windowsHide` bullet)
- Modify: `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` (after the `qa-stamp.js` status-as-data-writer bullet that follows the `--stamp-status` bullet)

- [ ] **Step 1: Measure the base.** Run `wc -c .claude/skills/gh-api-module-pattern/SKILL.md` and expect 58460. Record it.
- [ ] **Step 2: Add the `--no-optional-locks` bullet** from proposal 6 (comment 6) after the `windowsHide` bullet. Check its rule text against `docs/donts.md:136` and its test name against `tests/git-status-optional-locks.test.js`.
- [ ] **Step 3: Trim the same file** by at least the bullet's byte count. Tighten wording in the longest existing bullets without dropping any rule, worked example, or citation. Re-run `wc -c` and expect a value at or below 58460.
- [ ] **Step 4: Add the reason-enum envelope bullet** to `cli-wrapper-contract.md`, from proposal 4 (comment 4), corrected to current code. There is no `run` verb. Name the verb or verbs that actually exec the third-party launcher, after reading `plugin/bin/lib/impeccable-engine/index.js`. Copy the six (or current count of) `FAILURE_REASONS` values as they appear there. Keep conditions (a), (b), and (c). Record the posture as the shipped one: the header comment at `impeccable-engine.js:7` states it. Do not take the optional "four base vocabularies" reword; it is restructural, and the proposal itself excludes it.
- [ ] **Step 5: Verify** with `git grep -n -F 'FAILURE_REASONS' -- plugin/bin/lib/impeccable-engine/index.js` and `git grep -n -F 'validateVerbArgs' -- plugin/bin/impeccable-engine.js`. Expected: both hit. Confirm that each verb name the bullet cites appears in `VERBS`.
- [ ] **Step 6: Commit** with message `Document --no-optional-locks and the reason-enum envelope exit posture in gh-api-module-pattern — net-zero bytes in SKILL.md`, then `refs #3773` and the trailer.

### Task 3: parse-signal-discipline item 17

**Files:**
- Modify: `.claude/skills/parse-signal-discipline/SKILL.md` (append item 17 after item 16; add a "When to use" bullet)

- [ ] **Step 1: Add item 17** from proposal 5 (comment 5), renumbered from 14 to 17. Correct it to current code: four producers call `isRepoRelativeKeyFilePath` (code-health, harness-health, docs-health, journey-health). Read each call site and describe each one's normalization from the code. The proposal named only code-health's anchor strip and harness-health's repo-relative rewrite. Keep the `44883e90b` and #1420 citations, and the item-10 cross-reference. Match the indentation of items 14 to 16.
- [ ] **Step 2: Add the When-to-use bullet** ending `(fix-shape item 17)`.
- [ ] **Step 3: Verify** with `git grep -n -F 'keyFilePathProblem' -- plugin/bin/lib/issues/record.js` and `git grep -n -F "endsWith('/')" -- plugin/bin/lib/issues/grouping.js`. Expected: both hit. Then run `grep -c '^17\. \*\*' .claude/skills/parse-signal-discipline/SKILL.md` and expect `1`.
- [ ] **Step 4: Commit** with message `Add parse-signal-discipline item 17 — a composer's validator owes its readers' skip set`, then `refs #3773` and the trailer.

### Task 4: Doc corrections: REGISTRY row, plugin-structure review row, code-health-focus-vertical, policy-key journey

**Files:**
- Modify: `docs/REGISTRY.md` (the `docs/specify-decomposition-log.md` row)
- Modify: `docs/plugin-structure.md:99` (the `review` row)
- Modify: `.claude/skills/code-health-focus-vertical/SKILL.md` (registration-sites row at :33, re-derivation row at :47, Anti-patterns table)
- Modify: `docs/journeys/resolve-a-policy-key.md` (Step 2 "Should understand" bullet; Origin list)

- [ ] **Step 1: REGISTRY.** Apply proposal 3's replacement row (comment 3), which reads shipped-but-opt-in and names `.claude-tweaks/policy.yml`.
- [ ] **Step 2: plugin-structure.** Edit the current review row in place. Add `focus-criterion-passes.md` to the sub-file list after `code-mode-steps.md`. In code-mode-steps.md's description, replace "security hardening (Step 6.6, #2624), agent trust scope (Step 6.65, #2749)" with "the focus-criterion component passes (Steps 6.6/6.65/6.66, loaded from focus-criterion-passes.md)". Append a clause stating that focus-criterion-passes.md holds Steps 6.6 (#2624), 6.65 (#2749), and 6.66 (App Store readiness, #2628), and is loaded by code-mode-steps.md between Step 6.5 and Step 6.7. Check this against `plugin/skills/review/code-mode-steps.md:342`. Keep the row's later clauses (cross-lens corroboration) intact.
- [ ] **Step 3: code-health-focus-vertical.** Apply proposal 8's row-33 replacement and proposal 9's anti-pattern row. Then re-verify row 47: if the Step 6.X pre-checks now live in `focus-criterion-passes.md` (`grep -n 'Pre-check' plugin/skills/review/focus-criterion-passes.md`), repoint that row's path to it. This is the same stale citation, so fixing it is in scope under the record's re-verify AC.
- [ ] **Step 4: Journey.** Apply proposal 10's two hunks (comment 10), corrected so the env-layer note covers both keys: `gh-timeout-ms` (#2567, `CLAUDE_TWEAKS_GH_TIMEOUT_MS`) was the first, and `git-timeout-ms` (#3051, `CLAUDE_TWEAKS_GIT_TIMEOUT_MS`) followed the same shape. Name `shared-primitives.js`'s getters as the read sites. Add the #2567 Origin bullet as proposed, plus a short #3051 clause.
- [ ] **Step 5: Verify** that `git grep -n -F 'maintainer-only mechanism' -- docs` returns nothing, that `git grep -n -F 'focus-criterion-passes.md' -- docs/plugin-structure.md .claude/skills/code-health-focus-vertical/SKILL.md` returns at least 3 hits, and that `git grep -n -F 'CLAUDE_TWEAKS_GIT_TIMEOUT_MS' -- plugin/bin/lib/shared-primitives.js docs/journeys/resolve-a-policy-key.md` hits both files. Then run `node --test tests/code-health-agent-trust-scope-wiring.test.js tests/code-health-app-store-readiness-wiring.test.js tests/ai-design-tells-lens-rows.test.js`. Expected: pass.
- [ ] **Step 6: Commit** with message `Correct four stale docs rows — decomposition-log opt-in, focus-criterion-passes registration, timeout env layers`, then `refs #3773` and the trailer.

### Task 5: Three plan-authoring checks, with a prose pin

**Files:**
- Modify: `plugin/skills/build/plan-authoring-checks.md`
- Test: `tests/plan-authoring-portability-writer-checks-prose.test.js` (new)

Sources, read in full first (main-checkout archive, read-only):
- (a) `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/2026-10-16T172750-spec-2775-2733-2677/spec-2775/staged/reflect-1.md`
- (b) `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/2026-10-16T172750-spec-2775-2733-2677/spec-2733/staged/reflect-1.md`
- (c) `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/2026-10-16T162827-spec-3023/staged/reflect-3.md`

Labels and placement (each is one blank-line-separated paragraph starting with its bold label):
- `**Already-satisfied ruling check:**`, immediately after the **Behavioral-claim check:** paragraph. Rule: a plan that rules a Deliverable/AC already satisfied *because a producer emits the artifact* cites a count over real archived run artifacts showing the artifact present. Worked example: #2775's claim-log line, 33 of 48 dispatch runs since #2861.
- `**Consumer-portability check:**`, after the Independent-count check paragraph. Rule: a literal encoding this repo's config (`main`, `origin`, the owner/repo slug, a label set) in shipped `plugin/**` code names its resolver or policy key, and carries a test with a non-default value. Worked example: #2733's `MERGE_STATE_RE`, fix `58fc408f6`.
- `**Real-writer fixture check (extends the Real-input probe check):**`, immediately after the Consumer-portability paragraph. Rule: a check reading state another module writes (run-state, a manifest, a ledger) has at least one test that produces that state through the real writer, never through hand-written JSON. Worked example: #3023's `engine-verify.test.js` fixtures used `status:'closed'`, but `closeRunState` writes `status:'clean', worktree:null`. Fix `a7790fbed`.

- [ ] **Step 1: Measure.** Run `wc -c plugin/skills/build/plan-authoring-checks.md` and expect 46225.
- [ ] **Step 2: Verify the worked-example citations** with `git log --oneline -1 58fc408f6`, `git log --oneline -1 a7790fbed`, `git grep -n -F 'closeRunState' -- plugin/bin`, and `git grep -n -F 'MERGE_STATE_RE' -- plugin/bin`. Expected: each resolves. Cite whatever the commands show; if one does not resolve, cite the PR via `gh pr list --search {sha}` or drop the citation.
- [ ] **Step 3: Write the failing test.** Model it on `tests/plan-authoring-retirement-sweep-prose.test.js`. Read the live file and split it on blank lines. `assertCheck(text, label, phrases)` asserts exactly one paragraph starts with `label`, and that each phrase in `phrases` is in it. Three tests, one per label:
  - `AC1.1 (#3773): plan-authoring-checks.md carries the Already-satisfied ruling check`, with phrases `'already satisfied'`, `'archived'`, `'#2775'`
  - `AC1.1 (#3773): … carries the Consumer-portability check`, with phrases `'plugin/**'`, `'non-default value'`, `'#2733'`
  - `AC1.1 (#3773): … carries the Real-writer fixture check`, with phrases `'real writer'`, `'hand-written'`, `'#3023'`

  Add one negative control per label. Each one drops that label's paragraph from the live text, asserts the result differs from the live text, and then runs `assert.throws(() => assertCheck(dropped, label, phrases))`. These controls are the go-red proof for every pin. No edit-and-revert of the skill file is needed.
- [ ] **Step 4: Run** `node --test tests/plan-authoring-portability-writer-checks-prose.test.js`. Expected: FAIL, three paragraphs absent.
- [ ] **Step 5: Write the three paragraphs**, each at most about 1,000 B, in the house shape: rule, why a task review misses it, worked example with its cost.
- [ ] **Step 6: Run** `node --test tests/plan-authoring-portability-writer-checks-prose.test.js tests/ceremony-profile-roster.test.js tests/plan-authoring-retirement-sweep-prose.test.js tests/plan-authoring-ac-evidence-prose.test.js tests/plan-authoring-reader-inventory-prose.test.js tests/plan-authoring-ac-clause-ids-prose.test.js tests/absence-grep-control-check-prose.test.js tests/skill-size-single-source.test.js tests/bin-lib/skill-audit/context-cost.test.js`. Expected: all pass. Re-run `wc -c` and expect less than 52500. Record the headroom in the commit body.
- [ ] **Step 7: Commit** with message `Add three plan-authoring checks — already-satisfied rulings, consumer portability, real-writer fixtures`, then `refs #3773` and the trailer. The body records the byte headroom and notes that check (d) was already present as the Prose-held pin check.
