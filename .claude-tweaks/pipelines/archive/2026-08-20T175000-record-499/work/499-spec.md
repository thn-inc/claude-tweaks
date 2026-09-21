---
record: 499
origin: human
risk: medium
size: low
ceremony: standard
grants: [build]
surface: backend
---
# 499: bin/residue.js branches probe tags every merged-undeleted remote branch as scope:'blast-radius', not just the invoking run's own

Surface: backend

## Current State

`bin/lib/residue/probes/branches.js`'s `probeBranches` tags every merged-but-undeleted remote branch (except the integration branch itself and the current run's own `scope.headBranch`) with `scope: 'blast-radius'` unconditionally:

```js
findings.push(makeFinding({
  kind: 'branch',
  scope: 'blast-radius',
  subject: name,
  remedy: 'auto',
  evidence: `git ${cmd.join(' ')} — merged, not deleted`,
}));
```

`bin/lib/residue/scope-filter.js`'s `--scope blast-radius` CLI flag trusts this per-finding `scope` field verbatim, with no independent way to tell "this run's own worktree branch" apart from "some other, unrelated session's worktree branch that also happens to be merged and undeleted." The sibling `probeWorktrees` (`bin/lib/residue/probes/worktrees.js`) already draws this contrast correctly: every worktree other than the one on `scope.headBranch` is tagged `scope: 'observed'`, never `blast-radius`, with an explicit comment explaining why (anything reaching that point in the loop is, by construction, not this run's own). `probeBranches` has no equivalent contrast — once a branch's name doesn't match `scope.headBranch`, it falls straight into `blast-radius` regardless of provenance.

`remedy: 'auto'` is not inert: `skills/wrap-up/residue-sweep.md` documents that a `remedy: auto` finding (explicitly including "a merged-but-undeleted branch") is "naturally a Phase 1 fix-now candidate" that gets applied automatically during the ledger's resolve gate. So the bug is not just ledger noise — a wrap-up run following the documented `--scope blast-radius` contract literally can auto-delete a merged branch belonging to an unrelated, separately-completed session's run, without a human confirming it. The branch is already merged (recoverable via the PR/commit history), but the auto-deletion still happens without the owning session's knowledge or consent.

Discovered 2026-08-15 during a standalone `/claude-tweaks:wrap-up` invocation's Phase 3 residue sweep, run against the repo after the multi-spec flow batch for #360/#282/#283/#318/#319/#363/#469 (PR #492) had already merged. `node bin/residue.js --base <sha> --integration-branch origin/main --scope blast-radius` returned 3 findings, all tagged `blast-radius`:

1. `origin/worktree-flow-360-282-283-318-319-363-469` — the flow batch's own worktree branch, merged via PR #492, not yet deleted.
2. `origin/worktree-flow-464` — belongs to an unrelated, separately-completed run.
3. `origin/worktree-record-174` — belongs to another unrelated, separately-completed run.

Findings #2 and #3 are unambiguously wrong under `residue-sweep.md`'s own contract ("a finding belongs on this run's ledger only if it is this run's own blast radius"). Finding #1 is genuinely ambiguous: by the time this standalone wrap-up invocation ran, its own `scope.headBranch` no longer matched that branch name (the session had already moved off it), so the *current* `scope.headBranch`-based exclusion wouldn't have caught it as "own" either — it was tagged `blast-radius` by the same unconditional fallthrough as #2 and #3, not by any real provenance signal. Worked around manually this time by inspecting each finding and only actioning #1.

## Deliverables

- Change `probeBranches` so a merged-but-undeleted remote branch is tagged `scope: 'blast-radius'` only on a positive provenance signal tying it to the invoking run — not merely because its name isn't `scope.headBranch`. At minimum, bring it in line with `probeWorktrees`'s existing `scope: 'observed'` contrast for the fallthrough case; see Gotchas for the open design question of whether that strict reading is what's actually wanted, or whether a run-scoped provenance signal beyond `scope.headBranch` needs to exist first.
- Findings that no longer qualify as `blast-radius` must still surface as `scope: 'observed'` (or another explicit non-`blast-radius` value) — the fix must not silently drop them from output. `--scope repo` (the CLI default) must continue to show them.
- Confirm whether `skills/wrap-up/residue-sweep.md`'s documented contract language needs any adjustment once the code is corrected to match it, and note the outcome (the fix is meant to make the code match the doc, not the other way around, so no rewrite is expected — but confirm rather than assume).

## Acceptance Criteria

- [ ] `probeBranches`, given a merged-but-undeleted branch that does not match `scope.headBranch` and carries no other provenance signal tying it to the invoking run, tags it `scope: 'observed'` (or another explicitly non-`blast-radius` value) — not `scope: 'blast-radius'`.
- [ ] A repo state with 2+ merged-but-undeleted branches belonging to unrelated, separately-completed runs, and 0 branches genuinely belonging to the invoking run, produces zero `blast-radius`-scoped branch findings under `node bin/residue.js --scope blast-radius`.
- [ ] The existing correctly-handled case — a branch matching `scope.headBranch`, already excluded outright before the loop even tags it — continues to be excluded from findings entirely (no regression).
- [ ] The branches-probe test suite (`tests/bin-lib/residue/` or equivalent) passes, including new coverage for: a merged branch unrelated to the current run (expect non-`blast-radius`); the existing `scope.headBranch` exclusion (regression coverage); and, if the Technical Approach's design decision adds a provenance check beyond `scope.headBranch`, coverage for a branch that DOES match that new signal (expect `blast-radius`).
- [ ] `probeWorktrees`'s existing `scope: 'observed'` vocabulary is reused for the non-`blast-radius` case rather than introducing a third scope value, unless the chosen design explicitly justifies a different one.
- [ ] `skills/wrap-up/residue-sweep.md` is read against the corrected behavior and updated only if its contract language is actually inaccurate post-fix (not rewritten reflexively).

## Technical Approach

The minimal, lowest-risk fix mirrors `probeWorktrees` exactly: change the `scope: 'blast-radius'` value at the finding-push site to `scope: 'observed'` for every branch that reaches that point in the loop — since anything reaching it has already survived the `scope.headBranch` exclusion, and by the same reasoning `probeWorktrees`'s own comment gives, is therefore never definitively this run's own blast radius under a strict reading.

This resolves findings #2 and #3 from the Current State example outright. It also reclassifies finding #1 (the flow batch's own leftover branch) to `observed`, because `scope.headBranch` no longer matched it by the time the standalone wrap-up ran — see Gotchas for whether that reclassification is the intended outcome.

If a positive provenance signal beyond `scope.headBranch` turns out to be the right call instead (e.g. matching a branch's naming convention — `worktree-flow-{spec-slug}` — against the invoking run's own known spec slug or original branch name), check whether the run directory's own `config.yml`/manifest (`_shared/pipeline-run-dir.md`) already records that slug or a prior branch name the probe could compare against, before inventing new provenance tracking. Prefer reusing an existing signal over adding new state.

## Gotchas

- Real design decision needed before implementing, not a mechanical fix: does "this run's own blast radius" (in `residue-sweep.md`'s sense) mean strictly `scope.headBranch` — the literal branch the current git session is on right now — or does it also cover "the batch this wrap-up invocation is closing out," which may span a branch the session has already moved off of? The original request's own "Suggested fix" section leaves this open ("or track branch provenance some other way"). The mirror-`probeWorktrees` fix in Technical Approach takes the strict reading; a looser reading needs a provenance signal this probe doesn't currently have access to.
- Under the strict reading, finding #1 from the Current State example (the reporter's own flow batch's leftover branch, which they judged "genuinely this run's own") would no longer auto-surface as a blast-radius finding for a standalone-invoked wrap-up run that has since moved off that branch — it would still be visible under `--scope repo` (the default), just not auto-included under `--scope blast-radius`, and so would need manual routing again rather than being caught automatically. Confirm this tradeoff is acceptable before committing to the strict-only fix, or implement the provenance-tracking alternative instead.
- `remedy: 'auto'` on a `blast-radius`-scoped branch finding means the *current* bug's failure mode is not just noisy ledger rows — it's unattended deletion of a merged branch belonging to an unrelated session. The already-merged state makes this recoverable, but a concurrent session could still be relying on the branch's continued existence (e.g. as a reference point) at the moment it disappears.

## Original request

bin/residue.js branches probe tags every merged-undeleted remote branch as scope:'blast-radius', not just the invoking run's own

## Context

Discovered 2026-08-15 during a standalone `/claude-tweaks:wrap-up` invocation's Phase 3 residue sweep (`skills/wrap-up/residue-sweep.md`), run against the repo after the multi-spec flow batch for #360/#282/#283/#318/#319/#363/#469 (PR #492) had already merged.

`node bin/residue.js --base <sha> --integration-branch origin/main --scope blast-radius` returned 3 findings:

1. `origin/worktree-flow-360-282-283-318-319-363-469` — genuinely this run's own leftover branch (the flow batch's own worktree branch, merged via PR #492, not yet deleted).
2. `origin/worktree-flow-464` — belongs to an unrelated, separately-completed run.
3. `origin/worktree-record-174` — belongs to another unrelated, separately-completed run.

## Root cause

`bin/lib/residue/probes/branches.js`'s `probeBranches` tags **every** merged-but-undeleted remote branch (except the integration branch itself and the current run's own `scope.headBranch`) with `scope: 'blast-radius'` unconditionally:

```js
findings.push(makeFinding({
  kind: 'branch',
  scope: 'blast-radius',
  subject: name,
  remedy: 'auto',
  evidence: `git ${cmd.join(' ')} — merged, not deleted`,
}));
```

`bin/lib/residue/scope-filter.js`'s `--scope blast-radius` CLI flag then trusts this per-finding `scope` field verbatim — it has no independent way to tell "this run's own worktree branch" apart from "some other, unrelated session's worktree branch that also happens to be merged and undeleted." Every other probe (worktrees, forge, release) appears to compute `scope` more narrowly relative to the invoking run; this one doesn't.

## Impact

`residue-sweep.md`'s own documented contract says: "a finding belongs on this run's ledger only if it is this run's own blast radius ... `--scope blast-radius` ... is exactly the noise `scope-filter.js` exists to filter out." For the branches probe specifically, that contract doesn't hold — repo-wide merged-branch noise leaks into `--scope blast-radius` output. A wrap-up run following the documented procedure literally would seed its own ledger with other sessions' unrelated cleanup, which is out of scope for a single run's Phase 1 fix-exhaust.

Worked around manually this time by inspecting each finding and only actioning #1.

## Suggested fix

`probeBranches` needs a way to determine whether a given merged branch actually originated from *this* run's own worktree — e.g. compare against `scope.headBranch`'s naming convention (`worktree-flow-{specs}` matching this run's own spec slug) or track branch provenance some other way — rather than assuming every merged-undeleted branch except the current HEAD's own is in scope.

## Files

- `bin/lib/residue/probes/branches.js`
- `bin/lib/residue/scope-filter.js` (trusts the finding's own `scope` field)
- `skills/wrap-up/residue-sweep.md` (documents the contract this violates)

