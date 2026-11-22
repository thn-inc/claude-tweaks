---
files:
  - plugin/skills/review/code-mode-steps.md
  - plugin/skills/review/pr-body-deliverables.md
  - plugin/skills/review/review-summary-template.md
  - plugin/skills/build/architecture-alignment.md
  - plugin/skills/build/SKILL.md
---

# Check PR-Body Deliverables Against the PR

**Persona:** A claude-tweaks maintainer running a hands-off `/claude-tweaks:flow #N` on a record whose spec says "the PR body reports X". They want review to read the PR they will actually merge, not grep the codebase for X and call it done.
**Goal:** `/review` judges a deliverable or criterion that must appear in the PR body against the live PR body. `/build` never logs that the body carries something until the body really does.
**Entry point:** `/build` writes a decision line saying the PR body carries an item, or `/review` Step 1 grades a spec item whose content must appear in the PR body (or PR description).
**Success state:** The review's Spec Compliance tables show the item as `done`/`met` because the live body carries it, or as `missing`, `partial` or `unverifiable` with the reason. The PR body on GitHub matches every claim build logged about it.

## Steps

### 1. Let /build put the claim in the PR body first
- **URL:** The run's draft PR body on GitHub, then `{run-dir}/decisions.md`.
- **Action:** Before writing a decision line that says the PR body carries something, `/build` follows `architecture-alignment.md`'s `## Claims about the PR body`. It writes the body to `pr-body-claim-{run-id}-{n}.md`, appends the text below `<!-- fixes-end -->` (`[claude-tweaks-fixes-end]` on the MCP path), runs `gh pr edit --body-file`, and reads the body back. Only then does it log the line.
- **Should feel:** Like the same build step. No new prompt and no stop.
- **Should understand:** The rule covers every build decision line, whether or not Common Step 4.5 runs. A concurrent edit gets one retry. If the edit still cannot land, the line says the body does not carry it instead of claiming it does.
- **Red flags:** A decision line saying "the PR body reports X" while the live body lacks X. Appended text containing a closing phrase (`closes #N`) instead of `issue #N`.

### 2. Watch /review route the item to the PR body
- **URL:** `/claude-tweaks:review` Step 1 item 6, which loads `pr-body-deliverables.md` in the review skill's directory.
- **Action:** Review finds the PR (`pr.number` in `run-state.json`, else `gh pr view --json number`, else `mcp__github__list_pull_requests` with `perPage: 100`) and reads its body (`gh pr view {pr} --json body -q .body`, or `mcp__github__pull_request_read` `get`). It grades the item against that body. Items 1 and 2 skip it.
- **Should feel:** Targeted. Only items whose content must appear in the PR body go this way. A deliverable about PR-body tooling code is still graded against the codebase.
- **Should understand:** The body is the evidence. A matching string in the repo does not make the item `done`.
- **Red flags:** An item marked `done` because a skill file mentions X while the body lacks X. A code deliverable about `pr-body.js` sent to the live body.

### 3. Read the verdict and the gate
- **URL:** Review Step 1's Gate table.
- **Action:** The item is `done` when the body carries it, `partial` when it carries part, `missing` when it lacks it. With no PR, or a failed body read, it is `unverifiable`.
- **Should feel:** Honest and unblocking. A missing PR-body item blocks like any missing deliverable. An `unverifiable` one never blocks.
- **Should understand:** Any number of `unverifiable` items counts as a minor gap, so the review proceeds and names each one.
- **Red flags:** A review that blocks because `gh` was absent or the PR read timed out. An `unverifiable` item counted as present.

### 4. Find the unverifiable items in the summary
- **URL:** The review summary (`review-summary-template.md`).
- **Action:** Read the full Spec Compliance tables, where status reads `unverifiable` next to `done`/`partial`/`missing` (and `met`/`partially met`/`not met`).
- **Should feel:** Visible. A run with an `unverifiable` item never renders the compact clean PASS.
- **Should understand:** Step 7 names each `unverifiable` item, so a human knows which PR-body claims nobody checked.
- **Red flags:** A compact PASS summary on a run with a `partial`, `missing` or `unverifiable` PR-body item.

## Origin
- Created during build of #5340. Before it, a spec item such as "the PR body reports X" was graded against the codebase, and build could log a PR-body claim the body never carried. The plan-review ruling ("Reading B") made a missing PR or a failed read `unverifiable`, never present and never blocking. Pinned by `tests/review-pr-body-deliverables.test.js` and `tests/build-pr-body-claim.test.js`.
