---
files:
  - plugin/bin/learned-skills-pr.js
  - plugin/bin/lib/learned-skills/learned-skills.js
  - plugin/bin/lib/learned-skills/land.js
  - plugin/bin/lib/learned-skills/drain.js
  - plugin/bin/lib/learned-skills/rebuild.js
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
**Goal:** the record's PR merges on its own grant, while the learned skill edit rides a separate PR — merged by wrap-up's drain once CI is fully green when `learned-skills-auto-merge` is on, otherwise by a human. Nothing the Skills row learned is lost or delivered twice.
**Entry point:** `/claude-tweaks:wrap-up`'s serial-commit pass (`curation-engine.md` section 4) reaching an applied Skills-row finding on an `integration-model: pr-first` run.
**Success state:**
- The record's branch carries no `.claude/skills/` path, so `merge-check`'s instruction-file floor does not park it, and the record auto-merges.
- One ready PR on `learned-skills/{run-id}` holds the skill edits, with the body marker `<!-- wrap-up-skills-pr -->` and `refs #{n}`. Its URL is named where the maintainer looks: the console's Skill updates row, the short-circuit FYI, or the final summary.
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
  - With `learned-skills-auto-merge` on, wrap-up's drain merges the PR once CI is green; otherwise a human merges or closes it. `_shared/github-pr-scan.md`'s item 9 skips a `<!-- wrap-up-skills-pr -->` PR on both arm routes, even when the record carries `auto:merge`.
  - On a resumed run, `land` reuses the open PR only when its branch still exists and every commit on it is this run's verified edit. Anything else stages instead, with a reason naming the branch and the PR.
  - A resumed run whose earlier learned-skills PR already merged (its branch deleted on merge) records each edit that PR shipped as landed against it — matched by the run and entry trailers plus `git patch-id --stable`, with the PR's commits read through `gh` and `refs/pull/{n}/head` — and opens no second PR. Edits the merged PR did not ship stage with a reason naming it. A failed PR lookup, fetch or commit read stages every remaining edit and builds nothing.
- **Red flags:**
  - the learned-skills PR has `autoMergeRequest` set, a closing keyword, or a `<!-- claude-tweaks-run:` marker
  - a finding with no AUTO line
  - a second learned-skills PR for the same run after its first one merged, or a staged proposal for an edit the merged PR already carries

### 3. Find the PR where you already look
- **URL:** the Review Console's Skill updates section; on the short-circuit path, the FYI `PushNotification`; the final summary's Phase 2 trace
- **Action:** the console row reads `applied ({commit}, learned-skills PR {url})`. A console-less auto-merge carries the same engine-rendered section in its FYI, and the trace's Skills Detail cell ends with `learned-skills PR {url}`.
- **Should feel:** obvious. The PR's link appears in the same row the maintainer already reads for skill updates.
- **Should understand:** a staged finding never shows a PR URL, only its stage path.
- **Red flags:**
  - a moved edit that names no PR anywhere the maintainer reads
  - `applied (undefined)` in the console

### 4. The drain merges the PR once CI is green (lever on)
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/learned-skills-pr.js" drain --run "{run}" --integration-branch "{integration-branch}" --own-pr {pr-number}` (run by `learned-skills-pr.md`'s `## Drain at the end of wrap-up`, only when `resolve-policy.js --run "{run}" --values learned-skills-auto-merge` prints `true`)
- **Action:** after the Review Console and every `record` call (on the short-circuit path, before the FYI), the drain lists every open PR carrying `<!-- wrap-up-skills-pr -->`, oldest first. It merges a same-repository `learned-skills/*` PR whose files all sit under `.claude/skills/` and whose checks all completed green, after a fresh re-read, pinned to the classified head (`--squash --delete-branch`). This run's own PR is watched up to 900 s while pending (or armed with `--auto` when `merge-when-green` and the PR is `BLOCKED`). It prints one JSON line `{merged, armed, leftOpen:[{pr, reason, detail?}], conflicting, rebuilt}`, logs one decision line per PR (a rebuilt PR also gets its `AUTO` rebuild line) with `[lever: learned-skills-auto-merge=true]`, and writes this run's outcome to `learned-skills/drain.json`.
- **Should feel:** hands-off but safe: a learned-skills PR stops piling up, and nothing merges before its checks finish.
- **Should understand:**
  - The phase-trace Skills row and the short-circuit FYI append this run's outcome after the PR URL: `— merged`, `— armed`, `— conflicting` or `— left open: {reason}`. The console's own disposition carries no suffix (the drain runs after it resolves).
  - `leftOpen` reasons are the closed set `pending`, `timeout`, `red`, `head-changed`, `cross-repository`, `not-learned-skills-branch`, `files-outside-skills`, `merge-failed`, `no-gh`, `lease-rejected`, `git-too-old`, `rebuild-failed`, and `conflict needs a human: {files}`. A PR whose conflict is a pure double append is rebuilt on the integration tip (`rebuilt`) and left `pending`. Another run's PR is merged or left the same way but only appears in the JSON and `decisions.md`.
  - With the lever off, nothing runs and the PR waits for a human (step 5).
- **Red flags:**
  - a merge commit whose subject contains `undefined` or a body with `Fixes #`
  - a PR merged while a check was pending, cancelled or the rollup was empty
  - a fork, a non-`learned-skills/*` branch or a file outside `.claude/skills/` merged
  - a rebuilt skill file with conflict markers, a lost closing code fence, a dropped continuation line, or a list number repeated
  - a rebuild push to any branch other than the PR's own `learned-skills/*` branch, or one without `--force-with-lease` on the head the drain read
  - a label written on a red PR's records

### 5. Review, merge or close the learned-skills PR
- **URL:** the PR on GitHub (`gh pr view {url}`)
- **Action:** the maintainer reads the skill diff, one commit per edited skill file, and merges it, or closes it to reject the learning. To revert one item from the console, they drop it from that PR or close the PR, never `git revert` on the run branch.
- **Should feel:** in control. With the lever off, an instruction change reaches the agents only after a person merged it; with it on, the person reviews what the drain left open or reads what it merged.
- **Should understand:** reconcile reaps a merged or closed `learned-skills/*` branch through `archive-branches.js`, under the same evidence bar as the other plugin-owned branches.
- **Red flags:**
  - the PR merged with no human action while `learned-skills-auto-merge` is off
  - a console revert that ran `git revert` on the run worktree

### 6. Without a forge, or when the PR route fails, review a staged proposal
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/learned-skills-pr.js" stage --run "{run}" --worktree "{worktree}" --reason "integration-model is local-merge" --merge-base "{merge-base}"`, then the Review Console
- **Action:** under `local-merge`, or when `git apply --check`, the push or the PR create fails, each edit is written to `staged/wrap-up-skill-{N}.md` from its real diff. It logs `STAGED {time} — Skills row: skill update for {skill}/SKILL.md ({section}) could not ride a learned-skills PR ({reason}); staged instead. …` and appears in the console's Skill updates section for approval.
- **Should feel:** nothing lost. The edit waits in the same place a restructural skill update already waits.
- **Should understand:** a re-run after a failed manifest write recognises each staged copy and stages nothing twice.
- **Red flags:**
  - a staged edit that also rides a PR
  - two staged files for one edit

### 7. Clear an undelivered capture
- **URL:** `wrap-up-engine.js verify`'s `learned-skills-delivered` row; in a multi-spec run, `console-residue.js --run "$MULTISPEC_PARENT_DIR" --require-verify`'s "Needs a human" line
- **Action:** if `land` or `stage` never ran (an interrupted session), verify fails naming each patch file still `captured`, and the wrap-up verdict blocks. In a multi-spec run, the parent residue scan lists it at summary time instead. The maintainer runs the named `land` (`pr-first`) or `stage` (`local-merge`) against the run dir the row names, then re-runs `verify`.
- **Should feel:** specific and finite: the failing row names each patch file, so the maintainer knows exactly what to re-run.
- **Should understand:** once the run worktree is gone, `--worktree` takes the main checkout's root, since both verbs touch the repository only through git.
- **Red flags:**
  - a run that archives with a `captured` entry in `learned-skills/manifest.json` and no report
  - `record` accepting an applied Skills-row finding with no commit

## Origin
- Created during the build of #5290: `bin/learned-skills-pr.js` (`capture`, `land`, `stage`), `lib/learned-skills/`, the console and trace rendering of the PR URL, item 9's `<!-- wrap-up-skills-pr -->` exclusion, verify's `learned-skills-delivered` row, and `wrap-up/learned-skills-pr.md`.
- Updated during the build of #6110: a resumed `land` recognises edits a merged learned-skills PR already shipped, looking the run branch's PRs up whether or not the branch still exists.
- Related journeys: `keep-cant-tell-findings-through-a-console-less-auto-merge-4171.md` covers the same console-less short-circuit for review findings. `trust-a-singleton-auto-merge-to-refuse-without-a-verdict-2941.md` covers the merge-check verdict this journey keeps from parking.
- Updated by #6112: the PR merges once green under `learned-skills-auto-merge` (wrap-up's drain); it is no longer never-armed. Added step 4 (the drain) and renumbered the later steps.
- Updated by #6113: a conflicting learned-skills PR whose conflicts are pure double appends is rebuilt on the integration tip (`lib/learned-skills/rebuild.js`, a leased force-push of one plumbing commit) and then follows the pending path; any other conflict is left open as `conflict needs a human: {files}`.
