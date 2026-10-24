---
files:
  - plugin/skills/reflect/SKILL.md
  - plugin/skills/_shared/integration-branch.md
---

# Drop a Skill Gap Main Already Closed

**Persona:** a maintainer whose `/claude-tweaks:flow` or `/claude-tweaks:dispatch` run uses an installed plugin build. That build can lag the integration branch by hours. The maintainer works through the Wrap-Up Review Console's Queue writes section after `/reflect` has staged its tangential findings.
**Goal:** a tangential `/reflect` finding that says "this skill/contract file lacks X" reaches the Queue writes section only if X is actually missing on the integration branch. A finding about a gap main already closed never turns into a backlog record that asks to undo the fix.
**Entry point:** `/reflect`'s Step 3 auto-mode routing (full, hindsight or light), staging a tangential finding whose Current State claims a repo file is missing something. `plugin/skills/reflect/SKILL.md`'s **Integration-branch probe before an absence claim** paragraph.
**Success state:** a finding that holds on the integration branch is staged with the probe command and its result cited in the record's Current State. A finding main already closed is not staged. `decisions.md` carries `AUTO {time} — Step 3: tangential idea "{summary}" not filed — already on origin/{integration-branch} ({probe command} matched). Reversibility: n/a.`

## Steps

### 1. Probe before staging — the reflect pass inside the run
- **URL:** the `/reflect` pass `/claude-tweaks:wrap-up` runs. Its staged files land under `.claude-tweaks/pipelines/{run-id}/staged/reflect-{n}.md`.
- **Action:** for a tangential finding that claims a skill or contract file lacks something, resolve `{integration-branch}` per `_shared/integration-branch.md`. Run `git fetch origin '{integration-branch}'`. Then run `git grep -n -F -e '{phrase}' 'origin/{integration-branch}' -- '{path}'` and `git log -S '{phrase}' --oneline 'origin/{integration-branch}' -- '{path}'`, one command per Bash call. `{phrase}` is single-quoted with each `'` inside it written as `'\''`.
- **Should feel:** a quick check against the branch the work lands on, not against whatever plugin build this session happens to load. It costs one fetch and two read-only probes.
- **Should understand:**
  - The session's own view of the skill files can predate main. #3817 was filed at 20:57Z from a run on an installed build that predated #3078, nine hours after #3078's 11:19Z merge had already closed the gap.
  - A `git log -S` hit on a commit this session's build predates means the content changed since. Read that commit and re-judge the finding against it. That covers the #3817 shape, where main deliberately deleted what the finding asked to add back.
- **Red flags:**
  - The probe runs against the local checkout or the installed plugin directory instead of `origin/{integration-branch}`.
  - A regex grep on literal skill text, where `-F` is needed. See `prove-an-absence-grep-can-match-3571.md`.
  - A phrase starting with `-` passed without `-e`, so `git grep` reads it as an option and errors.
  - Probing after a failed `git fetch`. The stale `origin/{integration-branch}` ref can miss content main already has.

### 2. Read the outcome — the run's `decisions.md` or the staged record
- **URL:** `.claude-tweaks/pipelines/{run-id}/decisions.md`, under `/reflect`, and the staged `reflect-{n}.md` body.
- **Action:** check which of three outcomes the finding took.
- **Should feel:** settled. Every absence claim either carries its evidence or has been dropped, with the reason written down.
- **Should understand:**
  - Content found on the integration branch: the finding is not staged, and one `AUTO … not filed — already on origin/{integration-branch}` line records the probe that matched.
  - Content absent: `git grep` exited 1, or `git log -S` exited 0 with no output. The finding is staged, and its Current State quotes the probe command and its empty result.
  - Probe couldn't run (no `origin`, the named file is outside this repository, `git fetch` exited non-zero, or `git grep`/`git log` exited other than 0 or 1, such as 128 for a bad ref or pattern): staging proceeds, and the record's Current State says the probe could not run, never that the content is absent.
- **Red flags:**
  - A staged tangential record whose Current State asserts an absence with no probe cited.
  - A Current State that reads a failed fetch or a `git grep` exit 128 as "absent", the #4069 shape.
  - A dropped finding with no `decisions.md` line.

### 3. Approve Queue writes — the Wrap-Up Review Console
- **URL:** the Review Console's Queue writes section.
- **Action:** scan the reflect-sourced record proposals before approving.
- **Should feel:** each proposal names a gap that exists on main, backed by the cited probe. None asks to re-add something main deliberately removed.
- **Should understand:** the probe screens absence claims about this repository's files only. A finding about a third-party plugin's files routes upstream through `/claude-tweaks:feedback`, not through this path.
- **Red flags:** a reflect proposal that duplicates a fix already merged to main, the #3817 shape.

## Origin
- Created during the build of #3987, a reflect hindsight finding from #3817. #3817's Deliverable 1 asked to re-add a carve-out that #3078 had deliberately deleted. The reflect pass that filed it ran an installed build older than #3078.
- Updated during the build of #4069: a failed fetch or a `git grep`/`git log` error exit is now "probe could not run", never "absent", and `{phrase}` passes with `-e` and safe quoting.
- Pinned by `tests/reflect-integration-branch-probe.test.js`.
- Related: `drop-a-refuted-code-is-missing-claim-3329.md` (the same ground-truth-before-staging idea, applied to review lens absence claims) and `verify-a-cited-commit-before-filing.md`.
