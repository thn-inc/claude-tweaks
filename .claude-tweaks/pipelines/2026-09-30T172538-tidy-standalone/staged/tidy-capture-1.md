## Staged: Capture — readClaimBlobsGitBatch's default runner rejects string input with encoding 'buffer'

Finding: [capture] tidy Step 4.7 batched claim read fails on every blob against a real git store.
Proposed: file a backlog record (bug) with the spec-shaped body below via /claude-tweaks:capture.

## Current State

`plugin/bin/lib/issues/claims-git-cas.js:299` (origin/main) calls
`runner(['cat-file', '--batch'], { input: \`${orderedShas.join('\n')}\n\`, encoding: 'buffer' })`.
With the module's `defaultRunner` (`execFileSync`), Node uses `options.encoding` to encode a
string `input`, and `'buffer'` is not a valid string encoding — Node v22.23.2 throws
`ERR_UNKNOWN_ENCODING` (reproduced: `execFileSync('cat', [], { input: 'x\n', encoding: 'buffer' })`).
The `catch` maps that to `markTransportFailure()`, so every blob returns
`failure: 'transport-failure'` — against this repo's 1293-blob registry, 1293/1293.
`tests/bin-lib/issues/claims-git-cas.test.js` exercises `readClaimBlobsGitBatch` through a fake
runner, so the suite stays green. Downstream effect: tidy Step 4.7's #2613 "never sample" batched
reader is unusable, which pushes scan agents back to sampling — this run's Step 4.7 agent sampled
100 blobs and emitted false release/label-removal rows (every "closed-issue claim" was a
tombstone; every "missed bot:in-progress" issue held a live claim).

## Deliverables

- Pass `input` as a Buffer (`Buffer.from(...)`) or drop `encoding: 'buffer'` in favor of reading
  stdout as a Buffer by default, in `readClaimBlobsGitBatch`.
- A test that runs `readClaimBlobsGitBatch` through the real `defaultRunner` against a temp git
  repo with a `claims-registry` tree (not the fake runner).

## Acceptance Criteria

- `readClaimBlobsGitBatch({ tip })` with the default runner returns content (not
  `transport-failure`) for every blob of a real registry tree.
- The new test fails on the current line 299 and passes after the fix.

Evidence: tidy run 2026-09-30T172538-tidy-standalone, scan/claims-full.jsonl (after a workaround runner).
