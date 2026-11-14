# 0032. The whole suite runs in CI; on a developer machine it runs only on request

- **Status:** accepted
- **Date:** 2026-11-13
- **Context:** #5370; builds on #5369 (`localRuns`, `--local`, exit 3), #5319 (a plain `npm test` runs the impact subset), #4347 (the `ci` source), #4024 (impact selection) and #5133 (the push before Common Step 5)

## Context

Pipeline verifies ran the suite on the developer machine even when the PR's CI job already ran it on
the same commit. Across 91 `verify` events in 38 pipeline runs between 9 and 13 November 2026, 21 runs
were unscoped, which cost 149 minutes of test time. Of 9 scoped runs, 6 fell back to a local run on
`head-not-pushed`, because CI could not answer a head that had not been pushed. And a standalone run
was always full, whatever the declaration said.

## Decision

1. **The rule.** On a developer machine a CI-declared suite runs as the whole suite only when someone asks for it by name: `/claude-tweaks:test full`, `verify.js --local` with no `--scope`, or `/claude-tweaks:release`'s run before the version bump. Every pipeline verify takes it from the PR's CI job, and runs the impact subset here only when CI cannot answer. The one exception: when CI cannot answer after a push and one re-run, the `--local` re-run runs what selection chose, and that is the whole suite when selection cannot narrow (a missing or stale map, a full-suite rule such as a change to `tools/run-tests.js`, or a stale stamp anchor). It is rare, and the run's `AUTO` line names the fallback reason. `verify.js` is not changed for it.
2. **What a miss is.** A test whose result a change affects but which selection leaves out. Its causes are reads the tracer cannot see (`#` imports, a package's self-reference, a native addon's content, a non-node child's reads, a wrapper such as `xargs` or `timeout`), reads that differ between CI's trace environment and this machine, and reads a test gained after the map was traced without the test file itself changing: the map may trail HEAD by up to 200 commits (`maxAgeCommits`).
3. **How CI catches it.** When CI answers a pipeline's verify, CI ran the whole suite on that commit, so a miss cannot pass. When `--local` ran the subset, the miss passes on this machine and the PR's `test` job on the same head is red. The merge gate (`plugin/skills/_shared/pr-first-merge.md` Step 2.5) reads the PR's check rollup and its head workflow runs, parks a red PR and waits on a pending one, so the change does not merge.
4. **What CI does not catch.** A failure that happens only on macOS, on Node 22 or on Windows and that the map also misses. CI runs ubuntu on Node 20 (`.github/workflows/test.yml`), and Windows is checked after merge (`windows-regression.yml`). The release's whole-suite run on the developer machine is the remaining check before a version ships.
5. **Who enforces the gate.** The merge gate is the plugin's. A merge made outside it is stopped only when the repository protects its integration branch with the `test` check required.

Pipelines push first and handle exit 3 per `plugin/skills/test/verification.md`, and this repo opts in with `"localRuns": "on-request"`.

## Alternatives considered

- **Keep Common Step 5 full here.** Rejected: it is the 149 minutes.
- **Push only at phase exit.** Rejected: CI cannot answer a head that was not pushed (#5133).
- **Require branch protection.** Rejected: it is a repository setting the plugin does not own, so it is stated as the enforcement boundary instead (Decision 5).

## Consequences

- `windows-regression.yml` passes `--local`; the residue probe reports not run.
- The express lane, implementer affected sets and the driver pass `--local`.
- Installed builds older than #5369 ignore the `localRuns` key, and so still run locally. That is the version floor.
- Revisit if the plugin's CI gains macOS or Node 22: the release's whole-suite run is then no longer the only check there.
