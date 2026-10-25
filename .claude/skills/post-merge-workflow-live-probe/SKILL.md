---
name: post-merge-workflow-live-probe
description: Use when a new or changed GitHub Actions workflow in this repo triggers only on `push` to `main` (or another post-merge event) and has to be proven on a real runner before the PR merges — `workflow_dispatch` cannot help, because GitHub dispatches only workflows that already exist on the default branch. Covers throwaway `ci-probe/` refs built with `git commit-tree` on a temporary index (the feature branch and worktree never move), the trigger commit that widens `push.branches`, why the clean tip must be an empty commit on top of that trigger commit, the planted-failure tip, polling both runs from one background loop, re-probing the consumer on the real artifacts, and delete-then-push instead of a force push. Also use when a contract claim depends on how GitHub itself treats a PR or an issue (closing links, what a merge closes) and has to be observed on a throwaway PR and issue before the plan is written. Keywords - live probe, forge probe, closingIssuesReferences, throwaway PR, throwaway issue, push-to-main workflow, workflow_dispatch default branch, ci-probe, commit-tree, GIT_INDEX_FILE, planted failure, clean tip, throwaway branch, gh run watch, post-merge CI, windows-regression.
---

# Post-merge workflow live probe

## Overview

A workflow that runs only after merge (`on: push: branches: [main]`) cannot be exercised on its PR: `pull_request` never fires it, and `workflow_dispatch` is only offered for workflows already on the default branch. Unit tests around its scripts cannot see the runner either. #3316's Windows regression guard passed every Linux test and would still have gone red on every `main` push (the `npm test` launcher overflowed the Windows command line, TAP's `# duration_ms` defeated baseline matching, the checkout and temp dir sat on different drives). Only a real run caught them. This skill is the recipe that ran it before merge.

## Key Patterns

### Build probe commits without touching the branch

Create each probe commit with `git commit-tree` against a temporary index, so the feature branch, its index and its working tree never move:

```bash
export GIT_INDEX_FILE=<scratch>/probe.index          # never the worktree's own index
git read-tree <feature-tip>
git apply --cached <scratch>/probe-trigger.patch      # widen push.branches to include ci-probe/**
T=$(git write-tree)
TRIGGER=$(git commit-tree "$T" -p <feature-tip> -m "ci-probe: widen push.branches")
CLEAN=$(git commit-tree "$T" -p "$TRIGGER" -m "ci-probe: clean tip (empty)")
git apply --cached <scratch>/probe-plant.patch        # one deliberate regression
PLANTED=$(git commit-tree "$(git write-tree)" -p "$TRIGGER" -m "ci-probe: planted failure")
git push origin "$CLEAN:refs/heads/ci-probe/<record>-clean" "$PLANTED:refs/heads/ci-probe/<record>-planted"
```

In a worktree-isolated session, put this in a script file and run it; the guard refuses the inline form.

### The clean tip is an empty commit on top of the trigger commit

A new-branch push has an all-zero `github.event.before`, so the workflow falls back to `HEAD^1`. If the clean tip is the trigger commit itself, its base is the feature tip, and the diff between them is the trigger edit. Any test that pins the workflow's own trigger (`branches: [main]`) then fails at HEAD only, and the "clean" run is red by construction. #3316's round 2 lost a 20-minute run that way. An empty commit on top of the trigger commit gives a base and a HEAD with identical trees, so a green run proves the guard, not the edit.

### The planted tip is trigger + exactly one failure

Plant one failure that the guard must attribute (for the Windows guard: a hard-coded `/` expected value next to a `path.resolve`-returning call). Parent it on the trigger commit, so its base is the trigger commit and the plant is the only difference. Success is red with exactly that file attributable, not merely red.

### Poll both runs from one background loop, then re-probe on the real artifacts

Find each run by its ref (`gh run list --branch ci-probe/<record>-clean --json databaseId,status,conclusion`), and wait with one background until-loop for both rather than sleeping in the foreground. After they finish, download the artifacts (`gh run download <id>`) and run the consumer (the filer, a summarizer) locally on the real report and logs. The live run proves the runner side; the local re-probe proves the consumer reads what the runner actually wrote. #3316's excerpt bugs surfaced only there.

### Re-push by delete-then-push, never `--force`

A probe round that needs new commits deletes the old refs (`git push origin --delete ci-probe/<record>-clean`) and pushes fresh ones. The project's git discipline forbids force pushes and has no carve-out for session-owned throwaway refs. #3316 force-pushed its probes twice before this was noticed.

### Clean up and record

Delete both `ci-probe/` refs once the evidence is recorded. Quote both run URLs, their durations and the attribution result in the PR body and the run's ledger, since the runs themselves age out.

### Forge semantics: a throwaway PR and issue, one body edit per variant

The same rule covers GitHub's own behavior when a contract rests on it. #4199's record assumed GitHub keeps the closing link a PR makes when it is opened with `Fixes #N`. A probe disproved that before any code was written, and the plan was rebuilt on the observed table (probe PR #4234 against issue #4233).

- Open a throwaway issue and a draft PR from a throwaway branch (`probe/<topic>-<record>`) of empty commits. A channel the body cannot carry gets its own commit: #4234's second empty commit carried `Fixes #4233` in its message. Never name a real record in a variant: GitHub links it the moment the body is saved.
- Change one variant per edit (`gh pr edit <n> --body-file -`), then read the derived field (`gh pr view <n> --json closingIssuesReferences`) before the next edit. GitHub re-derives on every edit, so each read is that variant's answer. Record the rows as body and observed value.
- Probe the form you will emit as well as the hazard. `closes issue #4233` not linking is what made word insertion the fix; `closes (#4233)` still linking ruled out punctuation.
- Run the built code against the same probe PR before cleanup. Its live re-read is the acceptance evidence.
- Never merge the probe PR: the commit lands on the published `main` for good. Verify merge-time behavior at the input GitHub keys on (`closingIssuesReferences` = `[]`) and waive the merge half in the plan, with that reason.
- Track cleanup as an `ops` row in the run's ledger: close the PR unmerged, delete the branch, close the issue as not planned, and remove any scratch run dir. Mark it fixed only after the built check has run against the probe.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|--------------|
| Planning AC verification via `workflow_dispatch` on a feature branch | GitHub offers dispatch only for workflows on the default branch. The plan stalls at build time |
| Committing the trigger edit onto the feature branch | The widened trigger ships unless someone remembers to revert it, and the branch history carries probe noise |
| Using the trigger commit itself as the clean tip | Its base differs by the trigger edit, so any test pinning the trigger turns the clean run red |
| Calling a red planted run a pass without checking attribution | A run that is red for the wrong file, or for every file, proves nothing about the guard |
| Trusting the live run alone | The consumer's parsing of the real artifacts is a separate claim. Re-probe it locally |

## Reference

- Workflow proven this way: `.github/workflows/windows-regression.yml` (#3316). Runs 39036270004 (clean, green) and 39036272580 (planted, red with exactly `tests/bin-lib/wrap-up/ledger-write.test.js` attributable)
- Related skills: `windows-checkout-test-parity` (the Windows failure classes these runs exposed)
- Origin: #3316's plan Task 4, rounds 1-3
- Forge probe proven this way: #4199's closing-link premise (probe PR #4234, issue #4233); the guard it shaped is `plugin/bin/closing-links.js`
