### Strengths
- The fix is small and stays local. `shadowPipelineRunDir` gets an opt-in `entryInto` flag (plugin/bin/lib/hooks/pre-tool-use.js:734), and only `copy`/`move`/`install` destinations set it (pre-tool-use.js:785). Every other candidate, including mkdir targets and Write/Edit tool targets, follows the same code path as before.
- The new branch requires exact equality with the worktree's own pipelines dir, plus an `isDirectory()` stat (pre-tool-use.js:755-757). Before this change, a target equal to that dir always returned null, because `isPathContained` defaults to `orEqual: false`. So the new branch cannot change any verdict for a target strictly inside a pipelines dir. It only covers the case that used to fall through.
- `pipelinesDir` is still derived from the target's own worktree (`wtDetect.repoInfo(resolved)`), so a copy into the main checkout's pipelines dir stays allowed. A symlink into main's pipelines dir realpaths away from the worktree's dir and also stays allowed. The test pins the main-checkout control (tests/hooks-pipeline-shadow-guard.test.js:50-53).
- The review-round fix is correct. `install -d P` creates P and nothing under it. Giving those operands the separate action `install-d` (plugin/bin/lib/hooks/git-command.js:3870) keeps them out of the into-dir set without changing any other consumer. Nothing else reads a fileWriteTargets entry's `action`: the worktree gate at pre-tool-use.js:1101 maps only `file`/`lost`/`rel`. The change only splits the dedupe key, which is harmless.
- The tests use the real `pre.run` against real git fixtures. They cover the record's exact OScpNoLost shape (`cd ./x/../.claude-tweaks || cp a <P>/`), the trailing-slash form, and the mv and install variants. The install-d test includes a `mkdir -p` control, and both that control and the install-d assertion would go red if the `entryInto &&` guard were dropped.

### Issues

#### Critical (Must Fix)
None

#### Important (Should Fix)
1. **Acceptance criterion not verified: "No new deny appears against #4303's head over its 1176-command corpus."** The PR body says outright: "I didn't run the 1176-command corpus or a red-turning mutant check." The corpus is not in the repo (`git grep` finds no fixture for it), so nothing in this branch checks this AC. Why it matters: this change widens a guard that runs unconditionally on every Bash call. The record made "no new deny" a required check precisely so that a widening like this cannot add false denies unseen. Fix: replay the #4303 corpus through `pre.run` at base 4e7336a and head b173e6a, and attach the diff of the deny sets (expected: no new denies) to the PR. The mutant AC is in practice met by the tests described above, but the PR should state which mutants were run and that they went red, rather than say they were not checked.

#### Minor (Nice to Have)
1. **The deny message names the wrong thing** (pre-tool-use.js:756 combined with the message at pre-tool-use.js:823). For this branch, `runDirCandidate` is the pipelines dir itself. The user therefore sees "refusing to create `<wt>/.claude-tweaks/pipelines` — a NEW pipeline run directory", which names a directory that already exists and is not a run dir. That can mislead the agent about what was wrong with its command. Fix: carry a flag such as `{ into: true }` on the result and word the message along the lines of "refusing to copy/move into `<pipelines>` — the entry it creates would be a NEW run directory…".
2. **`ln` into an existing pipelines dir is not covered** (pre-tool-use.js:785 omits `link`). `ln -s x <wt>/.claude-tweaks/pipelines` and `ln -t <P> x` also create an entry, a symlink, under the pipelines dir. The record lists only cp/mv/install, so this is a scope note, but a reasonable person would expect the same rule. Either add `link`, or file a follow-up record.
3. **Two parts of the new branch have no test.** No test has a regular file named `pipelines` at the destination, which the `isDirectory()` check exists to allow. No test covers the `-t`/`--target-directory` form (`cp -t <P> a`), which goes through `explicitTargetDir` rather than the last-positional path. Both are one-line additions to the existing loop at tests/hooks-pipeline-shadow-guard.test.js:46.
4. **The new test file is a separate per-record file** (tests/hooks-pipeline-shadow-guard-install-d-4452.test.js). It repeats the setup and `bashInput` helper that tests/hooks-pipeline-shadow-guard.test.js already has. The record's Key Files names only the existing suite, so the test would read better as one more `test(...)` there.
5. **Cosmetic text problems.** The commit subject of b173e6adc4 repeats "— refs — refs #4452". The PR title still names the "dropped absolute cd" shape, which the record moved to #4475 under ADR 0028. The PR body's "git-command.js is unchanged" is out of date since the review fix.

### Recommendations
- Before merge, run the #4303 corpus replay and post its result. That is the only open acceptance criterion.
- Consider a small table-driven unit test of `shadowPipelineRunDir` with `entryInto` true and false against an existing dir, a missing path and a regular file. It would pin the branch without spawning the whole hook.
- Declined to judge:
  - `cp -r src <wt>/.claude-tweaks/pipelines` when the pipelines dir does not exist yet (this creates the dir with run-dir contents). It is allowed at base and at head, and the record scopes the fix to an existing pipelines dir.
  - `cp -r pipelines <wt>/.claude-tweaks`, which creates the pipelines dir through its parent. It is outside the record's shape, which is a literal destination equal to the pipelines dir.
  - `install -d -t <P>`, which still produces action `install` and so would be denied. GNU install rejects `-t` together with `-d`, so the command fails anyway.
  - The A2b/A2c/A2p dropped-absolute-cd shape. The record moved it to #4475.

### Assessment

**Ready to merge?** With fixes

**Reasoning:** The rule is correct and narrowly scoped, and the tests exercise real `pre.run` behaviour, including a mutant-catching control for the install-d case. One stated acceptance criterion, no new deny over the 1176-command corpus, was explicitly not run and needs evidence before this widening of a guard that runs on every Bash call lands.

DONE
