---
name: lock-race-test-seam
description: Use when adding or reviewing a test that claims a writer holds a lock (plugin/bin/lib/file-lock.js) across a read-modify-write, so that two concurrent writers cannot lose a row. Covers why a two-child-process test cannot prove the lock, the injected read seam that can, and the revert check that shows the test goes red. Keywords - file-lock, withLock, race test, lost update, appendRow, settleRow, read seam, interleave, LOCK_TIMEOUT.
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

## Anti-patterns

| Pattern | Why it fails |
|---|---|
| Asserting two spawned children get distinct numbers and calling that the lock test | Serial execution also yields distinct numbers; the test passes without the lock |
| Hand-writing a held lock directory to test the refusal only | Proves the refusal path, not that the read-modify-write sits inside the lock (pair it with the seam test) |
| A seam that calls the second writer outside try/catch | The refusal throws out of the first call and the test never reaches its assertions |
