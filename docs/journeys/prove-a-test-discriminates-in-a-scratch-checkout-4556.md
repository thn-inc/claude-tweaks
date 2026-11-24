---
files:
  - plugin/skills/_shared/subagent-dispatch-core.md
  - plugin/skills/_shared/scratch-worktree.md
  - plugin/skills/build/dispatch.md
  - plugin/skills/review/step3-lens-dispatch.md
---

# Prove a Test Discriminates in a Scratch Checkout

**Persona:** A reviewer agent dispatched inside a worktree-isolated session. That is either an SDD task reviewer or re-reviewer under `/claude-tweaks:build`, or a `/claude-tweaks:review` lens 3f agent. It has to show that a test fails against reverted code, or stays green with the code under test mutated. The maintainer reads the result.
**Goal:** Get execution evidence without touching the shared worktree, and without spending turns on shapes the harness worktree guard refuses.
**Entry point:** the dispatch prompt. Under `/build`, `dispatch.md`'s #2740 rule tells SDD to paste the recipe's steps into each task-reviewer and re-review prompt, filling in the SHA placeholders for each dispatch. Under `/review`, `step3-lens-dispatch.md`'s dispatcher paragraph pastes them into lens 3f's prompt. The recipe itself is `_shared/subagent-dispatch-core.md`'s **Discrimination checks in a scratch checkout**.
**Success state:** The agent reports a red or green run from a scratch checkout of the reviewed commit, with a control that went red first. `git worktree list` no longer shows the agent's scratch path. The shared worktree's `git status` is unchanged.

## Steps

### 1. Resolve the scratch location
- **URL:** `node "{plugin-root}/bin/session-tmp-resolve.js" --value disc-{id}`, with `{id}` built from the agent's own token (lens and pair member, or task, reviewer role and round).
- **Action:** Paste the printed path into later commands literally.
- **Should feel:** Like one lookup, not a decision.
- **Should understand:**
  - The scratch checkout lives in the session scratchpad. It never goes under the run directory or inside the shared worktree.
  - The run directory is in the main checkout, and a worktree-isolated session cannot write there with its file tools.
- **Red flags:**
  - A `"$VAR"` operand on a later `git -C` or `node` call. §7 refuses runtime-variable operands.
  - Two agents sharing one `{id}`, which makes the second create collide. A `{disc-path}` that already exists is reported `BLOCKED`, never written into or deleted.

### 2. Create the checkout and confirm the commit
- **URL:** `git -C "{worktree}" worktree add --detach "{disc-path}" HEAD`, then `git -C "{disc-path}" rev-parse HEAD`.
- **Action:** Compare the printed SHA with `{reviewed-sha}`. On a mismatch, tear down: the check has no evidence.
- **Should feel:** Two plain commands, both accepted by the guard.
- **Should understand:**
  - A sibling implementer may commit in the shared worktree between the review package and this step. The SHA check catches that.
  - Under `/review`, uncommitted scope skips this step. HEAD would not hold the edits under review, so the agent takes the no-git fallback instead.
- **Red flags:**
  - A `git checkout --` or an edit-then-restore in the shared worktree as a substitute.

### 3. Mutate and run inside the scratch checkout
- **URL:** `git -C "{disc-path}" checkout {base-sha} -- {path}`, or a rewrite under `{disc-path}` with one `node -e` call (never Write/Edit: the path is outside the agent's worktree). Then `NODE_PATH="{worktree}/node_modules" node --test "{disc-path}/{test-file}"`.
- **Action:** First run the unmutated checkout and confirm it passes. A red there means the checkout lacks an input the test needs, so nothing counts. Then run a control: make the mutated file throw at load and confirm the run goes red. Then run the real check.
- **Should feel:** Like an ordinary red/green cycle in a throwaway tree.
- **Should understand:**
  - A control that stays green means the run did not load the scratch copy. The run read the shared tree, or the test never loads the mutated file. Either way there is no evidence.
  - Dependencies come through the search-path variable, never a link (`ln -s`, `mklink /J`): a link leaves a path into the shared tree. Listing the shared worktree's `node_modules` is denied by a settings rule (§7).
  - A module or binary resolution failure is also no evidence. `NODE_PATH` covers CommonJS `require` only.
- **Red flags:**
  - A green run reported without a red control before it.

### 4. Tear down before reporting
- **URL:** `git -C "{worktree}" worktree remove --force "{disc-path}"`, then `git -C "{worktree}" worktree list`.
- **Action:** Confirm the agent's own `{disc-path}` is gone before writing the status word. If teardown fails, report `DONE_WITH_CONCERNS` and name the leftover path.
- **Should feel:** One command and one check.
- **Should understand:**
  - A sibling agent's live `disc-` checkout may still be listed. Only the agent's own path matters.
- **Red flags:**
  - A status word written before the teardown.
  - Removing another agent's checkout.

### 5. Fall back when the checkout cannot be created
- **URL:** the recipe's **No-git fallback**.
- **Action:** Write each file the test loads at its repo-relative path under `{disc-path}`. Use Read for unchanged files and the read-only `git -C "{worktree}" show {base-sha}:{path}` for base content. Run the test per step 3, then `rm -r "{disc-path}"`. A failed delete reports `DONE_WITH_CONCERNS` naming the path.
- **Should feel:** Slower, but still never touching the shared tree.
- **Red flags:**
  - Copying only the touched file, so the test's relative requires miss.

## Origin
- Created during the build of #4556 (flow spec 3/3, PR #4684). A 2026-10-31 probe from a worktree-isolated subagent checked every shape. All scratch-checkout shapes passed. The only refusal was a settings rule on `ls {wt}/node_modules`.
- Pinned by:
  - `tests/discrimination-check-scratch-recipe-conformance.test.js`: the recipe literals, the §7 rows, the lens citation and dispatcher paragraph, and the go-red controls.
  - `tests/build-dispatch-status-token-and-tree-immutability.test.js`: the #2740 citation and the placeholder split.
- Related: `reprove-checks-after-an-inserted-guard-3988.md`, whose re-proof runs in this checkout, and `work-around-a-refused-worktree-bash-command-2776.md`, the §7 table.
