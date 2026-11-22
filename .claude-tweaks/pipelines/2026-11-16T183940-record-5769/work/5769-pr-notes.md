### Git process counts (Deliverable 5)

Measured on one machine, back to back: `GIT_TRACE2_EVENT=<absolute empty dir> CT_TEST_CONCURRENCY=6 node tools/run-tests.js --files-from <list>`, merge base `e3f9474` (a `git archive` extract) against HEAD `caab4a591`. One trace2 file per git process; "children" are git processes started by another git process (receive-pack, pack-objects, maintenance and so on).

| File | Before (e3f9474) | After (HEAD) | Change | Before: top-level / children | After: top-level / children |
|---|---|---|---|---|---|
| `tests/bin-lib/reconcile/prune-remote.test.js` | 1,150 | 620 | −530 (−46%) | 692 / 458 | 412 / 208 |
| `tests/bin-lib/pre-review-catchup/cli.test.js` | 1,064 | 601 | −463 (−44%) | 593 / 471 | 398 / 203 |
| `tests/bin-lib/issues/claims-git-cas.test.js` | 661 | 446 | −215 (−33%) | 332 / 329 | 260 / 186 |
| **Three files (AC1)** | **2,875** | **1,667** | **−1,208 (−42%)** | 1,617 / 1,258 | 1,070 / 597 |
| `tests/helpers-git-template.test.js` (spawn tests, Deliverable 4) | 131 | 931 | +800 | 93 / 38 | 537 / 394 |
| **Net, four files** | **3,006** | **2,598** | **−408 (−14%)** | | |

The three files run together gave the same totals as the per-file runs (2,875 before, 1,667 after).

**AC1:** 1,667 is under both bounds — 1,725 (60% of 2,875 at 8646f7c) and 60% of the merge-base re-take, which is also 2,875. The record's Decision paragraph left the basis open; this PR applies the stricter of the two, and here they agree.

**The spawn tests cost about 800 git processes.** Deliverable 4 puts one "a second call starts no git process" test per template in `tests/helpers-git-template.test.js`. Each template's warm-up build now also runs in that file's own process, so the suite-wide saving is 408, not 1,208.

Largest subcommands:
- prune-remote before: for-each-ref 97, rev-list 80, push 74, receive-pack 74, remote 73, maintenance 73. After: for-each-ref 62, remote 54, rev-list 45, upload-pack 39, push 38, receive-pack 38.
- pre-review-catchup before: rev-list 115, commit 97, add 96, pack-objects 86, rev-parse 79. After: rev-parse 79, rev-list 66, diff 50, pack-objects 37, fetch 34.
- claims-git-cas before: rev-list 68, push 45, receive-pack 45, maintenance 44. After: rev-list 50, upload-pack 31, show 29, push 27, receive-pack 27.

`maintenance` drops to zero because every templated bare origin calls `disableReceiveAutoGc`. The remaining push, fetch and receive-pack processes come from the code under test (`pruneRemote`'s fetch and delete pushes, the claims compare-and-swap push, the catch-up's fetch and merge) and from the second-clone advances that Deliverable 3 keeps real.

### Choices taken under the record's Decision paragraph ("take the aim, say so in the PR body")

- **Same tests (AC3).** Every test name and count is unchanged: prune-remote 39, catch-up 30, claims 33, all passing at both ends. No pre-existing `assert` line was removed, and no test option changed. `helpers-git-template.test.js` grows from 25 to 51 tests, all added by this record.
- **The `writeBlob` assertion stays per test.** The four `readClaimBlobsGitBatch` tests used to write claims through `writeBlob`, which asserts `fixture setup: claim #N must write cleanly`. They now take one shared registry template. Each test asserts that same message against the builder's recorded write result for every claim it used to write. The builder itself never throws on a failed write.
- **The claims saving is base builds.** The four batch tests share one registry (claims 20, 21, 10, 11, 12, 30 and 40–44, with 13 never written). Each claim was only ever written by one test, so the 11 claim writes are the same before and after. The saving is the three origin-and-clone base builds that are no longer repeated. The keyspace test reads at claim 21's tip, where only 20 and 21 exist, so its `[20, 21]` assertion still holds.
- **Catch-up shapes.** Setup sequences that two or more tests run identically before their first call under test became seeded template variants: `feat-edit-only` (9 tests), `feat-edit-overlapping-upstream` (8) and `conflicting-edit` (2). Single-use setups keep their in-test edits and `pushUpstream()`, because a one-use template costs a build plus a copy and saves nothing.
- **Kept `fetch --prune` in the skipFetch test.** It looks like setup only, but it stands in for the caller's shared fetch, whose already-fetched refs the `skipFetch` path then trusts. Removing it would change the scenario under test.
- **Second-clone delete replaced.** The batch-fails "already deleted" test used a second clone and `push origin --delete build/b1` only to arrange state. It now runs `update-ref -d refs/heads/build/b1` inside the copied bare origin. The refs come out the same: origin lacks `build/b1`, and the repo's `origin/build/b1` tracking ref stays stale. A fixture test pins that state. The second clones that advance a branch stay real.
