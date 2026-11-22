---
name: lock-race-test-seam
description: Use when adding or reviewing a test that claims a writer holds a lock (plugin/bin/lib/file-lock.js) across a read-modify-write, so that two concurrent writers cannot lose a row, or that claims a git compare-and-swap (update-ref with an expected old value, a push under --force-with-lease) refuses a concurrent writer. Covers why a two-child-process test cannot prove the lock, the injected read seam that can, the git-runner interleave seam for a ref CAS, and the revert check that shows the test goes red. Keywords - file-lock, withLock, race test, lost update, appendRow, settleRow, read seam, interleave, LOCK_TIMEOUT, update-ref, compare-and-swap, force-with-lease, plan-store.
---

# Lock race test seam

A two-process "concurrent append" test stays green with the lock deleted. Node startup (tens of milliseconds) dwarfs the read-modify-write window (microseconds), so the two children never overlap and each takes the next free number serially. #4439's final review caught it: `tests/hooks-ledger-row.test.js` AC3.1 spawns two children and cannot discriminate the lock.

## What discriminates

Inject a read seam into the locked function (`appendRow({ readLedger })` in `plugin/bin/lib/stage-item/ledger.js`) and, from inside the seam, attempt the second write in-process. The seam runs after the first call has read and before it writes, which is the one moment the lock exists to protect:

1. Run the first call with a short lock wait (`withShortLockWait`), its seam doing `fs.readFileSync` then a second writer call wrapped in try/catch, capturing the error.
2. Assert the captured error has `code === 'LOCK_TIMEOUT'` (the second writer was refused while the first held the lock).
3. Assert the first call's result and the file bytes (no row lost, no row doubled).
4. Retry the second writer after the first returns and assert it takes the next number.

`tests/bin-lib/stage-item/ledger.test.js` ("AC3: a second append attempted between the first call's read and its write ...") is the worked example. Keep the two-child test too when the spec's AC names it: it proves the CLI path end to end, not the lock.

## Prove it goes red

Delete the `withLock` wrapper (or the lock acquisition) and run the seam test: the interleaved append must succeed, the assertion on `LOCK_TIMEOUT` must fail. A race test not run against the lock-removed code has not been shown to test the lock.

## A git compare-and-swap instead of a file lock

The guard can be git's own compare-and-swap rather than `withLock`: `git update-ref <ref> <new> <old>` (an empty `<old>` requires the ref to be absent), or a push under `--force-with-lease={ref}:{sha}`. Two racing processes have the same startup problem, so interleave in-process through the injected git runner: on the first call whose argv carries the guarded verb (`update-ref`, `push`), the wrapper moves the ref itself (`update-ref` in the same checkout, or a push from a second clone) and then delegates to real git. Assert the guarded write lost (failed, or for a write whose push already landed, reported its local ref unmoved) and that the ref still names the interloper's sha. `tests/bin-lib/plan-store/store.test.js` is the worked example for `plugin/bin/lib/plan-store/store.js`'s `writePlan`: "a local writer moving the ref between the prior read and update-ref loses cleanly", one case per push mode so each reports its own red, and "two racing writers: the loser exits no-ref and the winner's ref stands" for the lease. To prove the local case goes red, drop the expected-old argument from the `update-ref` call: the move then succeeds over the interloper and the assertion on the interloper's sha fails.

## Anti-patterns

| Pattern | Why it fails |
|---|---|
| Asserting two spawned children get distinct numbers and calling that the lock test | Serial execution also yields distinct numbers; the test passes without the lock |
| Hand-writing a held lock directory to test the refusal only | Proves the refusal path, not that the read-modify-write sits inside the lock (pair it with the seam test) |
| A seam that calls the second writer outside try/catch | The refusal throws out of the first call and the test never reaches its assertions |
