---
files:
  - plugin/bin/learned-skills-pr.js
  - plugin/bin/lib/learned-skills/learned-skills.js
  - plugin/bin/lib/learned-skills/land.js
  - plugin/bin/lib/learned-skills/delivered.js
  - plugin/bin/lib/wrap-up/engine-render.js
  - plugin/bin/lib/wrap-up/engine-verify.js
  - plugin/skills/wrap-up/learned-skills-pr.md
  - plugin/skills/wrap-up/curation-engine.md
  - plugin/skills/_shared/github-pr-scan.md
  - plugin/skills/wrap-up/auto-merge-short-circuit.md
  - plugin/bin/console-residue.js
  - plugin/bin/lib/reconcile/archive-branches.js
---

# Review a Run's Learned Skill Edits on Their Own PR

**Persona:** a maintainer whose record carries `auto:merge`. Its wrap-up's Skills row auto-applies an additive edit to a project skill under `.claude/skills/` that the record's own change never touched, and the maintainer expects the record to merge on its own.
**Goal:** the record's PR merges on its own grant, while the learned skill edit waits on a separate PR that only a human merges. Nothing the Skills row learned is lost or delivered twice.
**Entry point:** `/claude-tweaks:wrap-up`'s serial-commit pass (`curation-engine.md` section 4) reaching an applied Skills-row finding on an `integration-model: pr-first` run.
**Success state:**
- The record's branch carries no `.claude/skills/` path, so `merge-check`'s instruction-file floor does not park it, and the record auto-merges.
- One ready, never-armed PR on `learned-skills/{run-id}` holds the skill edits, with the body marker `<!-- wrap-up-skills-pr -->` and `refs #{n}`. Its URL is named where the maintainer looks: the console's Skill updates row, the short-circuit FYI, or the final summary.
- Under `local-merge`, or when the PR route fails, the edit is a staged Review Console proposal instead.

## Steps

### 1. The edit leaves the run branch as it is learned
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/learned-skills-pr.js" capture --run "{run}" --worktree "{worktree}" --merge-base "{merge-base}" --target "{targetPath}" --summary-file "{file}" --row skills`
- **Action:** for each applied Skills-row finding, the controller captures the working-tree edit as a real `git diff` into `{run}/learned-skills/{id}.patch` and reverts it in the run worktree. It does not commit it. A file the record's own commits already touch comes back `run-branch` and commits there as before.
- **Should feel:** invisible. The serial-commit pass reads the same, and the run branch simply stops growing a skill commit.
- **Should understand:**
  - A second finding on the same skill file joins the earlier patch (`shared: true`). The two share one commit later, and each still gets its own log line.
  - A record-owned skill file stays on the run branch on purpose: splitting it would make the two branches conflict, and merge-check's floor rightly applies to the record's own instruction edit.
  - `capture` fails closed. A git failure before the diff was read exits 1 with "nothing was changed": the edit commits on the run branch, a `SKIP … Learned-skills PR capture (degraded)` line names the failure, and merge-check's floor still holds that run. A `--target` outside `.claude/skills/` exits 2 and changes nothing, because that file belongs to its own row's commit or stage.
- **Red flags:**
  - a `.claude/skills/` path in `git diff --name-only {merge-base}..HEAD` of the record's branch after the pass
  - a `captured` finding that was also committed on the run branch

### 2. One learned-skills PR opens after the pass
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/learned-skills-pr.js" land --run "{run}" --worktree "{worktree}" --record {n} --integration-branch "{integration-branch}" --merge-base "{merge-base}"`
- **Action:** after the pass and before any `record` call, `land` builds one plumbing commit per captured patch on a temp index off the integration tip, pushes `learned-skills/{run-id}`, and opens a ready PR. Each landed finding logs `AUTO {time} — Skills row: applied additive update to {skill}/SKILL.md ({section}) on learned-skills PR #{pr}. Reversibility: high; commit: {hash}.`
- **Should feel:** separate and safe. The record's PR is unchanged, and the skill edits arrive as their own small diff.
- **Should understand:**
  - The PR is never armed. `_shared/github-pr-scan.md`'s item 9 skips a `<!-- wrap-up-skills-pr -->` PR on both arm routes, even when the record carries `auto:merge`.
  - On a resumed run, `land` reuses the open PR only when every commit on its branch is this run's verified edit. Anything else stages instead, with a reason naming the branch and the PR.
- **Red flags:**
  - the learned-skills PR has `autoMergeRequest` set, a closing keyword, or a `<!-- claude-tweaks-run:` marker
  - a finding with no AUTO line

### 3. Find the PR where you already look
- **URL:** the Review Console's Skill updates section; on the short-circuit path, the FYI `PushNotification`; the final summary's Phase 2 trace
- **Action:** the console row reads `applied ({commit}, learned-skills PR {url})`. A console-less auto-merge carries the same engine-rendered section in its FYI, and the trace's Skills Detail cell ends with `learned-skills PR {url}`.
- **Should feel:** obvious. The PR's link appears in the same row the maintainer already reads for skill updates.
- **Should understand:** a staged finding never shows a PR URL, only its stage path.
- **Red flags:**
  - a moved edit that names no PR anywhere the maintainer reads
  - `applied (undefined)` in the console

### 4. Review, merge or close the learned-skills PR
- **URL:** the PR on GitHub (`gh pr view {url}`)
- **Action:** the maintainer reads the skill diff, one commit per edited skill file, and merges it, or closes it to reject the learning. To revert one item from the console, they drop it from that PR or close the PR, never `git revert` on the run branch.
- **Should feel:** in control. An instruction change reaches the agents only after a person merged it.
- **Should understand:** reconcile reaps a merged or closed `learned-skills/*` branch through `archive-branches.js`, under the same evidence bar as the other plugin-owned branches.
- **Red flags:**
  - the PR merged with no human action
  - a console revert that ran `git revert` on the run worktree

### 5. Without a forge, or when the PR route fails, review a staged proposal
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/learned-skills-pr.js" stage --run "{run}" --worktree "{worktree}" --reason "integration-model is local-merge" --merge-base "{merge-base}"`, then the Review Console
- **Action:** under `local-merge`, or when `git apply --check`, the push or the PR create fails, each edit is written to `staged/wrap-up-skill-{N}.md` from its real diff. It logs `STAGED {time} — Skills row: skill update for {skill}/SKILL.md ({section}) could not ride a learned-skills PR ({reason}); staged instead. …` and appears in the console's Skill updates section for approval.
- **Should feel:** nothing lost. The edit waits in the same place a restructural skill update already waits.
- **Should understand:** a re-run after a failed manifest write recognises each staged copy and stages nothing twice.
- **Red flags:**
  - a staged edit that also rides a PR
  - two staged files for one edit

### 6. Clear an undelivered capture
- **URL:** `wrap-up-engine.js verify`'s `learned-skills-delivered` row; in a multi-spec run, `console-residue.js --run "$MULTISPEC_PARENT_DIR" --require-verify`'s "Needs a human" line
- **Action:** if `land` or `stage` never ran (an interrupted session), verify fails naming each patch file still `captured`, and the wrap-up verdict blocks. In a multi-spec run, the parent residue scan lists it at summary time instead. The maintainer runs the named `land` (`pr-first`) or `stage` (`local-merge`) against the run dir the row names, then re-runs `verify`.
- **Should feel:** specific and finite: the failing row names each patch file, so the maintainer knows exactly what to re-run.
- **Should understand:** once the run worktree is gone, `--worktree` takes the main checkout's root, since both verbs touch the repository only through git.
- **Red flags:**
  - a run that archives with a `captured` entry in `learned-skills/manifest.json` and no report
  - `record` accepting an applied Skills-row finding with no commit

## Origin
- Created during the build of #5290: `bin/learned-skills-pr.js` (`capture`, `land`, `stage`), `lib/learned-skills/`, the console and trace rendering of the PR URL, item 9's `<!-- wrap-up-skills-pr -->` exclusion, verify's `learned-skills-delivered` row, and `wrap-up/learned-skills-pr.md`.
- Related journeys: `keep-cant-tell-findings-through-a-console-less-auto-merge-4171.md` covers the same console-less short-circuit for review findings. `trust-a-singleton-auto-merge-to-refuse-without-a-verdict-2941.md` covers the merge-check verdict this journey keeps from parking.
