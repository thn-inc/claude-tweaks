# Discrimination-Check Scratch Recipe (#4556) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give reviewers that must prove a test discriminates one canonical, guard-safe scratch-checkout recipe. The recipe lives in `_shared/subagent-dispatch-core.md`, and the #2740 rule and lens 3f's Vacuity-evidence sentence cite it instead of a bare "scratch `git worktree add`".

**Architecture:** This is a prose contract change plus conformance pins. The recipe contains only shapes the Deliverable 1 probe saw pass. It is stated once, in the core file that the review-dispatch bundle composes. The two rule sites cite it, and each tells its dispatcher to paste the steps into the prompt, because a dispatched agent never reads sibling files. The one shape the probe saw refused (a settings permission rule, not the guard) becomes a §7 row.

**Tech Stack:** Markdown skill files; `node --test` conformance suites using `tests/helpers/read-skill`'s `readText`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T095259-spec-4549-4550-4556/spec-4556/work/4556-spec.md` (in this worktree)

## Global Constraints

- **Deliverable 1 is done.** Its probe table (`/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/ec124c25-8b00-4cfa-8947-0c852b7f7961/scratchpad/probe-4556.md`) goes into the PR description at handoff. No task re-probes.
- **Recipe content.** It holds only probe-passing shapes:
  - `worktree add --detach` into a session-scratch path
  - `git -C {disc} checkout {base} -- {path}`, or Edit on the scratch file
  - `NODE_PATH="{worktree}/node_modules"` with no link
  - `worktree remove --force`, plus a `worktree list` check
  - the Read/Write copy fallback

  It must never mention `ln -s`, `mklink /J`, or the run dir as a place to use.
- **Byte rails.**
  - `review/step3-lens-dispatch.md` is at 50,801 B of the 52,500 B rail, so its edit must be a net shrink.
  - The review-dispatch bundle (`subagent-dispatch-core.md` + `run-dir-resolution.md`) is at 46,311 B, so the new core section stays ≤ 2,800 B (raised from 2,000 B by the plan-review amendment's four added rules).
- **Ban phrase.** `never via \`git checkout --\` or an in-place edit-then-restore in this shared worktree` stays byte-identical in `build/dispatch.md`.
- **Existing pins.** Every pin in `tests/review-vacuity-evidence-conformance.test.js` and `tests/plan-authoring-inserted-guard-reprove-prose.test.js` keeps passing, except `/\`git worktree remove\`/`, which Task 2 replaces.
- **Go-red controls.** Each new pin gets a control: `assert.throws` of the pin's predicate against a frozen pre-change text constant held in the test file [IL-105]. Never derive the frozen text from the current file.
- **Shell.** Use one plain command per Bash call with literal absolute paths. The full suite runs centrally via `verify.js`; tasks run their targeted suites only.
- **Commits.**
  - Style: `{Verb} {what} — {detail}`.
  - The body cites `Refs #4556` and ends with `Claude-Session: https://claude.ai/code/session_016yg3zrQKAz6hRNqmKyivqj`.
  - Stage named files only.

## Review Focus

1. **Paste-through.** A subagent reading only its prompt must still get the steps. Both citing sites must tell their dispatcher to paste the section's steps into the prompt, not merely to "see" the core file.
2. **Teardown ordering.** The recipe must say the teardown runs *before the status word*. A dispatch that reports first and tears down later leaves a registered worktree when the agent dies.
3. **Placeholder clarity.** `{disc-path}` must come from `session-tmp-resolve.js --value` and be pasted literally. A `"$VAR"` operand on `git -C` is refused (§7's runtime-operand row).
4. **Fallback trigger.** The no-git fallback applies when *creation* is refused, and the copies are deleted before the status word. It must never fall back to the shared tree; the lens keeps "never mutate the shared tree as a substitute".
5. **#3988 continuity.** "the scratch checkout the rule above requires" must still resolve to #2740's sentence once that sentence says "scratch checkout".

## AC coverage map

| AC clause | Covered by |
|---|---|
| AC1.1 | Handoff: the PR description carries the probe table (Deliverable 1 already ran); verified by reading the PR body at Common Step 7 |
| AC2.1 | Task 1 Step 1 `assertRecipe` + Step 2 |
| AC3.1 | Task 1 Step 1's §7 row test (the one refused shape, `ls {wt}/node_modules`, `permission-rule`) |
| AC4.1 | Task 2 Step 1 `assert2740` + `assertLens` |
| AC4.2 | Task 2 Step 1 `assertLens`'s negative + Step 6's two `grep -c -F` zero counts |
| AC4.3 | Task 2 Step 1 `assert2740`'s byte-identical ban-phrase check |
| AC5.1 | Task 2 Step 6 runs `tests/plan-authoring-inserted-guard-reprove-prose.test.js` |
| AC6.1 | Every new predicate's frozen-constant go-red test (Tasks 1-2); full `npm test` via `verify.js` at Common Step 5 |

Waived docs/skill-authoring.md: read for the cite-don't-restate pattern only; no edit.
Waived _shared/subagent-output-contract.md: read for the scratch-copy pattern only; its line-39 Write/Edit claim is an observation for the console, not an edit here.
Waived build/SKILL.md: #4442 owns its `cd "$WORKTREE" && …` instruction; not touched.

---

### Task 1: Core recipe section, §7 rows, and their pins

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/subagent-dispatch-core.md`. Insert a new `## Discrimination checks in a scratch checkout` section between the end of `## Read-only Reviewer Discipline` (ending "…on the framework's default ports.", line ~143) and `## Model Selection`.
- Modify: `plugin/skills/_shared/scratch-worktree.md`. Add two rows at the end of the §7 table (after the backslash-escaped-space row, line ~280).
- Create: `tests/discrimination-check-scratch-recipe-conformance.test.js`.

**Interfaces:**
- Produces: the heading literal `## Discrimination checks in a scratch checkout`. Task 2 cites it as `**Discrimination checks in a scratch checkout**`.
- Produces: the test file and its helper `sectionOf(md, heading)`, which slices from the heading to the next `## `. Task 2 adds its lens pin to this same file.

- [ ] **Step 1: Write the failing tests** in `tests/discrimination-check-scratch-recipe-conformance.test.js`. Read the core file and `scratch-worktree.md` with `readText`.

  `assertRecipe(section)` collapses whitespace first (`section.replace(/\s+/g, ' ')`, since the section is wrapped prose) and then asserts it contains each of these literals:
  - `session-tmp-resolve.js`
  - `worktree add --detach`
  - `checkout {base-sha} -- {path}`
  - `NODE_PATH="{worktree}/node_modules"`
  - `never a link`
  - `worktree remove --force`
  - `before the status word`
  - `worktree list`
  - `No-git fallback`
  - `#4556`
  - `rev-parse HEAD` and `{reviewed-sha}` (the commit check — plan review, Reading A)
  - `no evidence` (a SHA mismatch or a dependency-resolution failure)
  - `CommonJS` (NODE_PATH's reach)
  - `show {base-sha}:{path}` and `repo-relative path` (the fallback's base content and layout)
  - `DONE_WITH_CONCERNS` (a failed teardown)
  - `substitutes` (the dispatcher fills `{plugin-root}`, `{worktree}`, `{reviewed-sha}`, `{base-sha}`) and `its own` (each agent builds `{id}`)

  It also asserts the section includes `never under the run directory` and does NOT include `ln -s "` (an affirmative link command).

  Tests:
  - `test('core carries the scratch-checkout recipe section after Read-only Reviewer Discipline (#4556)')`
    - Asserts the heading exists exactly once.
    - Asserts its index is greater than `## Read-only Reviewer Discipline`'s and less than `## Model Selection`'s.
    - Calls `assertRecipe`.
  - `test('the recipe pin goes red without the section or with a dropped step (go-red)')`
    - `assert.throws(() => assertRecipe(PRE_4556_CORE_TAIL))`, where `PRE_4556_CORE_TAIL` is the frozen literal of today's Read-only Reviewer Discipline section text (lines 130–143), copied verbatim into the test.
    - `assert.throws` on the live section with `worktree remove --force` replaced by `worktree remove`.
  - `test('§7 records the scratch-checkout shapes as passes and the node_modules listing as permission-rule (#4556)')`
    - Finds exactly one row whose cells[0] mentions `worktree add --detach` and whose cells[2] is `passes`, cells[3] `—`, cells[5] starting `2026-10-31 (#4556)`.
    - Finds exactly one row whose cells[1] contains `ls "{wt}/node_modules"`, with cells[2] `permission-rule` and cells[3] containing `has been denied`. Its cells[4] names `NODE_PATH`.
    - Reuse the `splitRow`/section-7 slicing shape from `tests/scratch-worktree-shell-constraint-table.test.js`, copied locally; do not import it.

- [ ] **Step 2: Run to verify they fail** (covers AC2.1, AC3.1, AC6.1)

Run: `node --test "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow+spec-4549-4550-4556/tests/discrimination-check-scratch-recipe-conformance.test.js"`
Expected: FAIL — the two content tests fail (heading missing, rows missing); the go-red test passes.

- [ ] **Step 3: Write the core section.** Keep it at ≤ 2,800 B and wrapped at ~100 columns like its neighbours. Wording may tighten, but every pinned literal must stay:

```markdown
## Discrimination checks in a scratch checkout

Applies to any dispatch that proves a test discriminates against reverted or edited code:
`/claude-tweaks:build`'s SDD task reviewers (`build/dispatch.md`, #2740) and `/claude-tweaks:review`'s
lens 3f Vacuity-evidence diagnostic. The dispatcher pastes these steps into the prompt — the agent
never reads this file — and substitutes `{plugin-root}`, `{worktree}`, `{reviewed-sha}` and
`{base-sha}` literally; each agent builds `{id}` from its own distinct token (lens and pair member,
or task and reviewer role). Never mutate the shared worktree in place: a sibling agent's in-flight
edit there would be lost. One plain command per Bash call, literal absolute paths:

1. **Location.** `node "{plugin-root}/bin/session-tmp-resolve.js" --value disc-{id}`
   (`_shared/session-tmp-root.md`); paste the printed `{disc-path}` literally — never under the run
   directory or inside the shared worktree.
2. **Create.** `git -C "{worktree}" worktree add --detach "{disc-path}" HEAD`, then
   `git -C "{disc-path}" rev-parse HEAD` must print `{reviewed-sha}`; otherwise tear down (step 6):
   the check has no evidence.
3. **Mutate only there.** `git -C "{disc-path}" checkout {base-sha} -- {path}`, or Edit the file
   under `{disc-path}`.
4. **Run the one targeted test there**, reaching dependencies through the language's search-path
   variable, never a link (`ln -s`, `mklink /J`) — for Node (CommonJS `require` only):
   `NODE_PATH="{worktree}/node_modules" node --test "{disc-path}/{test-file}"`.
5. **A run that fails on module or binary resolution** has no evidence: tear down and report that —
   never fall back to the shared tree.
6. **Tear down before the status word.** `git -C "{worktree}" worktree remove --force "{disc-path}"`;
   `git -C "{worktree}" worktree list` then shows no `disc-` entry. A failed teardown reports
   `DONE_WITH_CONCERNS` naming the leftover path.

**No-git fallback** — when step 2's create is refused: write each file the test loads at its
repo-relative path under `{disc-path}` (Read for unchanged files; for base content, the read-only
`git -C "{worktree}" show {base-sha}:{path}`, written with Write), run the test there, and delete
the copies before the status word.

Every shape above passed the worktree guard from a worktree-isolated dispatched agent (#4556,
2026-10-31; `_shared/scratch-worktree.md` §7).
```

  Note: the `ln -s` mention is negative ("never a link (`ln -s`, …)"), which Step 1's `ln -s "` exclusion deliberately does not match.

- [ ] **Step 4: Add the two §7 rows** at the end of the table. Keep six cells, and escape pipes as `\|`.
  - **The `passes` row.**
    - Shape: `git worktree add --detach` / `worktree remove --force` into a session-scratch path, and `git -C` checkout of a base file inside it (a discrimination-check scratch checkout; `ln -s` into it passes too, but the recipe uses `NODE_PATH`).
    - Example: `` `git -C "<wt>" worktree add --detach "<session-scratch>/disc-a" HEAD`; `git -C "<session-scratch>/disc-a" checkout <sha> -- <path>` ``
    - Verdict, wording, workaround: `passes | — | —`
    - Last verified: `2026-10-31 (#4556)`
  - **The `permission-rule` row.**
    - Shape: listing the shared worktree's `node_modules` (a settings deny rule, not the guard).
    - Example: `` `ls "{wt}/node_modules"` ``
    - Verdict: `permission-rule`
    - Wording: `"Permission to use Bash with command ls … has been denied"`
    - Workaround: reach dependencies by running with `NODE_PATH="{wt}/node_modules"` (`_shared/subagent-dispatch-core.md`'s Discrimination checks in a scratch checkout); never list them.
    - Last verified: `2026-10-31 (#4556)`

- [ ] **Step 5: Run the new suite plus the neighbours it must not break**

  Run each as its own call:
  - `node --test "{wt}/tests/discrimination-check-scratch-recipe-conformance.test.js"` → PASS
  - `node --test "{wt}/tests/scratch-worktree-shell-constraint-table.test.js"` → PASS (shape cells unique, six cells, dated)
  - `node --test "{wt}/tests/review-dispatch-composition.test.js"` → PASS
  - `node --test "{wt}/tests/subagent-dispatch-core-empty-output-prose.test.js"` → PASS
  - `node --test "{wt}/tests/bin-lib/skill-audit/context-cost.test.js"` → PASS

  Then: `wc -c` on `subagent-dispatch-core.md` must show ≤ 34,741 B (current 32,741 B + 2,000 B).

- [ ] **Step 6: Prove discrimination.** Step 2's red run (pins against the pre-edit files) plus the frozen-constant go-red test are the proof; quote both runs' raw output in the report. Never revert a file in the shared worktree to re-show red.

- [ ] **Step 7: Commit**

```bash
git -C "{wt}" add plugin/skills/_shared/subagent-dispatch-core.md plugin/skills/_shared/scratch-worktree.md tests/discrimination-check-scratch-recipe-conformance.test.js
git -C "{wt}" commit -m "Add the scratch-checkout discrimination recipe — core section, §7 rows, pins (#4556)" -m "Refs #4556" -m "Claude-Session: https://claude.ai/code/session_016yg3zrQKAz6hRNqmKyivqj"
```

---

### Task 2: Both rules cite the recipe, the skill-graph edges, and their pins

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/build/dispatch.md:14`, the #2740 sentence and the #3988 phrase.
- Modify: `plugin/skills/review/step3-lens-dispatch.md:232`, the Vacuity-evidence mutation sentence.
- Modify: `docs/skill-graph.md`.
  - The `/build` table gains a `_shared/subagent-dispatch-core.md` row, inserted just above the `_shared/worktree-setup.md` row (line ~122).
  - The `/review` table's existing `_shared/subagent-dispatch-core.md` row (line ~520) gains one sentence.
- Modify: `tests/build-dispatch-status-token-and-tree-immutability.test.js`, test 4.
- Modify: `tests/review-vacuity-evidence-conformance.test.js:35`.
- Modify: `tests/discrimination-check-scratch-recipe-conformance.test.js` (add the lens pin).
- Test: `tests/plan-authoring-inserted-guard-reprove-prose.test.js` (run only, unchanged — #3988 still follows #2740, AC5.1).

**Interfaces:**
- Consumes: Task 1's heading literal `Discrimination checks in a scratch checkout` and its test file.

- [ ] **Step 1: Update and add the failing pins**

  - **Build test 4** (`tests/build-dispatch-status-token-and-tree-immutability.test.js`).
    - Rename it to `'dispatch.md: the tree-immutability directive cites the core scratch-checkout recipe (#4556)'`.
    - Replace its regex with a predicate `assert2740(text)` that matches `` /runs in a scratch checkout per `_shared\/subagent-dispatch-core\.md`'s \*\*Discrimination checks in a scratch checkout\*\* section/ ``.
    - It also checks `text.includes('never via \`git checkout --\` or an in-place edit-then-restore in this shared worktree')` and `/paste[s]? (?:its|that section's) steps/`.
    - Add a go-red test that runs `assert.throws(() => assert2740(PRE_4556_2740))`. `PRE_4556_2740` is the frozen literal of today's sentence: "a discrimination check that needs a reverted or edited file (e.g. proving a new test fails against the pre-fix code) runs in a scratch `git worktree add`, never via `git checkout --` or an in-place edit-then-restore in this shared worktree".
    - Update the header comment's last line to mention #4556.
  - **Vacuity test** (`tests/review-vacuity-evidence-conformance.test.js:35`): replace `` /`git worktree remove`/ `` with `/Discrimination checks in a scratch checkout/`.
  - **New lens test** (`tests/discrimination-check-scratch-recipe-conformance.test.js`): `test('lens 3f\'s Vacuity-evidence sentence cites the core recipe and drops the bare temporary worktree (#4556)')`. Its predicate `assertLens(line)`:
    - Takes the `Vacuity-evidence diagnostic` line of `step3-lens-dispatch.md`.
    - Asserts it includes `**Discrimination checks in a scratch checkout**`, `3f prompt`, and `never mutate the shared tree as a substitute`.
    - Asserts it does not include `a temporary \`git worktree\``.
    - Go-red: `assert.throws(() => assertLens(PRE_4556_LENS))`. `PRE_4556_LENS` is the frozen literal "Make any such mutation in a throwaway copy — under the agent's `SCRATCH:` directory or a temporary `git worktree` — never in the shared tree other lens agents are reading — and remove it before the status word (delete the `SCRATCH:` directory; `git worktree remove` a temporary worktree, not merely its directory). When neither can be created, the finding has no evidence: never mutate the shared tree as a substitute."

- [ ] **Step 2: Run to verify they fail** (covers AC4.1, AC4.2, AC4.3, AC6.1)

Run: `node --test "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow+spec-4549-4550-4556/tests/build-dispatch-status-token-and-tree-immutability.test.js"`
Expected: FAIL after Step 1 — test 4 fails (the #2740 sentence does not cite the recipe yet); its go-red control passes. Then run, each as its own call, `node --test` on `tests/review-vacuity-evidence-conformance.test.js` (first test FAILS) and `tests/discrimination-check-scratch-recipe-conformance.test.js` (the lens test FAILS).

- [ ] **Step 3: Edit `build/dispatch.md:14`.** Make two in-place substitutions inside the one long paragraph; do not rewrap.

  - **The #2740 sentence.** Replace the span "runs in a scratch `git worktree add`, never via" with "runs in a scratch checkout per `_shared/subagent-dispatch-core.md`'s **Discrimination checks in a scratch checkout** section — paste that section's steps into this instruction for SDD to carry into each such dispatch — never via". The rest of the sentence, from "`git checkout --`" to "silently lost.", stays byte-identical.
  - **The #3988 phrase.** Change "in the scratch worktree the rule above requires" to "in the scratch checkout the rule above requires".

- [ ] **Step 4: Edit `review/step3-lens-dispatch.md`'s Vacuity-evidence bullet.** Replace the frozen `PRE_4556_LENS` span with:

  "Make any such mutation in a throwaway copy built per the review-dispatch bundle's **Discrimination checks in a scratch checkout** section (paste its steps into the 3f prompt), never in the shared tree other lens agents are reading. When that copy cannot be created, the finding has no evidence: never mutate the shared tree as a substitute."

  Keep everything before and after the span byte-identical. Check `wc -c` before and after: the file must shrink (from 50,801 B).

- [ ] **Step 5: Edit `docs/skill-graph.md`**
  - **The new `/build` row**, above the `_shared/worktree-setup.md` row: `` | `_shared/subagent-dispatch-core.md` | Since #4556, `build/dispatch.md`'s #2740 tree-immutability instruction sends every SDD task-reviewer and re-review discrimination check to this file's **Discrimination checks in a scratch checkout** section, whose steps `/build` pastes into the SDD invocation instruction (the #3988 downstream re-proof runs in the same scratch checkout). Shared with `/review` (lens 3f; its row). | ``
  - **The `/review` row (line ~520)**: append "Since #4556, lens 3f's Vacuity-evidence diagnostic cites the same bundle's **Discrimination checks in a scratch checkout** section for any mutation it makes, and the dispatcher pastes those steps into the 3f prompt." before the row's closing ` |`.

- [ ] **Step 6: Run the targeted suites**

  Run each as its own call:
  - `node --test` on `tests/build-dispatch-status-token-and-tree-immutability.test.js` → PASS
  - `tests/plan-authoring-inserted-guard-reprove-prose.test.js` → PASS
  - `tests/review-vacuity-evidence-conformance.test.js` → PASS
  - `tests/discrimination-check-scratch-recipe-conformance.test.js` → PASS
  - `tests/skill-graph-table-structure.test.js` and `tests/skill-graph-dangling-pointer.test.js` → PASS
  - `tests/review-dispatch-composition.test.js` → PASS
  - `tests/bin-lib/skill-audit/context-cost.test.js` → PASS

  Then run `grep -c -F "temporary \`git worktree\`"` on `step3-lens-dispatch.md`, expecting `0`, and `grep -c -F "scratch \`git worktree add\`"` on `build/dispatch.md`, expecting `0`.

- [ ] **Step 7: Prove each new pin discriminates**

  Quote the raw output of each go-red control. In addition, to show the tests are not simply green, run the lens pin against the HEAD-before-this-task file:
  1. Write `git -C "{wt}" show HEAD:plugin/skills/review/step3-lens-dispatch.md` to `{session-scratch}/lens-pre.md` (scratch file, never the shared tree).
  2. Feed it to the predicate through a small scratch script.

  Expected: throws.

- [ ] **Step 8: Commit**

```bash
git -C "{wt}" add plugin/skills/build/dispatch.md plugin/skills/review/step3-lens-dispatch.md docs/skill-graph.md tests/build-dispatch-status-token-and-tree-immutability.test.js tests/review-vacuity-evidence-conformance.test.js tests/discrimination-check-scratch-recipe-conformance.test.js
git -C "{wt}" commit -m "Point #2740 and lens 3f at the scratch-checkout recipe — cite, paste-through, pins (#4556)" -m "Refs #4556" -m "Claude-Session: https://claude.ai/code/session_016yg3zrQKAz6hRNqmKyivqj"
```

---

## Gotchas

- **Records that also edit `dispatch.md:14`.** #4243, #4442, #4548 and #4559 (PR #4694) all edit the same paragraph. Do not fold any of their content in. A later merge conflict is resolved by union: keep both sides' sentences.
- **`subagent-output-contract.md:39`.** It says Write/Edit outside the worktree is refused, and the probe contradicts that for session-scratch paths. That is out of scope here; it is an observation for the console only.
- **Teardown and `/tidy`.** A `git worktree add` scratch checkout registers in the shared repo. An agent that dies before teardown leaves a registration behind, which `/claude-tweaks:tidy` reports as orphaned. Do not add a reaper.
