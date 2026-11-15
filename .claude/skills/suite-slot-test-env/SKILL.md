---
name: suite-slot-test-env
description: Use when writing or reviewing a test that spawns `plugin/bin/verify.js` or `tools/run-tests.js` as a child, or calls `holdSlot` in-process, and especially one that claims a run takes, waits for, skips or releases the machine-wide suite slot. Covers why the suite's own runner makes such a test prove nothing by default, building the child env with `tests/helpers/suite-slot-env.js`, the HELD=1 default every other spawn helper owes, and bounding a hang with the spawn timeout. Keywords - suite slot, slotEnv, CT_TEST_SUITE_SLOT_HELD, CT_TEST_SUITE_SLOT_DIR, CT_TEST_WORKERS, NODE_TEST_CONTEXT, run-tests.js, verify.js child, machine-wide lock, nested run, holdSlot.
---

# Suite slot test env

`tools/run-tests.js` holds a machine-wide suite slot for the whole `npm test` run and spawns its `node --test` child with `CT_TEST_SUITE_SLOT_HELD: '1'`. `verify.js` reads that as "a parent already holds a slot" and takes none (`holdSlot` in `plugin/bin/lib/verify/slot.js` returns `null`; `nestedRun` in `plugin/bin/verify.js`). A test that spawns `verify.js` with `process.env` therefore inherits HELD=1, and an assertion that the run took, waited for or released a slot is checked against a run that never touched the lock. Strip only HELD and the child contends on the real lock dir under the real tmpdir, queued behind every other session's suite on the machine (#5119).

## Tests that exercise the slot

Build the child env with `slotEnv(dir, extra)` from `tests/helpers/suite-slot-env.js`. It:

- deletes `CT_TEST_SUITE_SLOT_HELD`; `CT_TEST_WORKERS` (set when the suite itself runs under a slot-holding `verify.js`, and a value already set wins over the cap `holdSlot` computes); the slot-count knobs `CT_TEST_SUITE_SLOTS` and `CT_TEST_SUBSET_SLOTS` that `tools/run-tests.js` reads; and `NODE_TEST_CONTEXT`, which makes a nested `node --test` run its files as a worker;
- points `CT_TEST_SUITE_SLOT_DIR` at the test's own temp `dir`, never the shared `<tmpdir>/ct-test-suite-slots`;
- applies `extra` last, so a test of the nested-run path passes `slotEnv(dir, { CT_TEST_SUITE_SLOT_HELD: '1' })` and still gets a private lock dir.

The `#5119` tests in `tests/bin-lib/verify/cli-slot.test.js`, `cli-slot-queue.test.js` and `cli-slot-signals.test.js` are the worked example; `ci-cli.test.js` and `impact-cli.test.js` use the same helper. An in-process `holdSlot` test passes an explicit `env` object, never `process.env` (`hold` in `tests/bin-lib/verify/slot.test.js`). `withSandbox` in `tests/run-tests-isolation.test.js` predates the helper and strips the same keys inline for `tools/run-tests.js` children.

## Every other spawn helper defaults to HELD=1

A helper that spawns `verify.js` and is given no env defaults the child to `{ ...process.env, CT_TEST_SUITE_SLOT_HELD: '1' }`, never bare `process.env` (`runCli` in `cli.test.js` and `impact-cli.test.js`, `fakeGhEnv` in `ci-cli.test.js`, `nestedRunEnv` in `cli.test.js`; commit `7a0dd1776`). Under `npm test` the two are the same. A direct `node --test <file>` has no runner and no HELD, so a bare `process.env` default sends every run in that file through the real machine-wide slot. Only tests that exercise acquisition opt back in, through `slotEnv`.

## A hang fails through the spawn timeout

A test that waits on a slot-holding child bounds it with the spawn's own `timeout` and `killSignal: 'SIGKILL'` (`spawnVerifyWithScript` in `cli.test.js`), so a stuck child becomes a failed assertion, never a stuck suite. Never assert a wall-clock budget to catch a hang: under bounded test concurrency and sibling sessions, elapsed time tracks machine load, not the code.

## A slot-holding `--baseline` child writes under its own temp dir

A `verify.js --baseline` child that holds a slot checks the base out at `<os tmpdir>/ct-verify-base/<repo-key>/slot-<index>/wt`, keyed by the repository and the slot's lock dir, and the `slot-<index>/` directory outlives the run (`slotScratchPath` and `addWorktree` in `plugin/bin/lib/verify/baseline.js`, #5150). `slotEnv` leaves the child's temp dir alone. Under `tools/run-tests.js` every test file in the run shares one `TMPDIR`, so a test that asserts the scratch path, or that the temp dir holds no `ct-verify-base-*` path, passes a private one in `extra`: `slotEnv(dir, { TMPDIR: t, TMP: t, TEMP: t })` (`os.tmpdir()` reads `TEMP`/`TMP` on Windows), as the AC5.1 `--baseline` test in `cli.test.js` does. Without it, a direct `node --test` of the file also leaves a `ct-verify-base/<repo-key>/` directory in the real temp dir on every run.

## A bare `tools/run-tests.js` child runs the whole set under the runner

Since #5319 a bare `tools/run-tests.js` (no arguments) selects test files by impact, except when `resolveRunMode` sees `CI` set to any non-empty value or `CT_TEST_SUITE_SLOT_HELD=1`; then it runs the whole set. A test child inherits HELD=1 from `npm test` and `CI` from a CI job, so it never reaches the selection path by default. A test of that path strips both: `withSandbox` (or `slotEnv`) for HELD, plus `delete env.CI` (neither helper removes it), as AC3.7 in `tests/run-tests-isolation.test.js` does. A caller that wants the whole set passes `--full` rather than relying on the inherited variable: `tools/test-impact.js trace` spawns `run-tests.js --full` (`tests/test-impact-cli.test.js`).

## Anti-patterns

| Pattern | Why it fails |
|---|---|
| Spawning `verify.js` with `process.env` in a test that asserts slot behavior | Under `npm test` the child inherits HELD=1 and takes no slot, so the assertion measures a run that never touched the lock |
| Deleting only `CT_TEST_SUITE_SLOT_HELD` | The child uses the real machine-wide lock dir, an inherited `CT_TEST_WORKERS` overrides the computed cap, and an inherited `NODE_TEST_CONTEXT` changes how a nested `node --test` runs |
| A spawn helper whose no-env default is bare `process.env` | A direct `node --test` of that file queues every run on the real lock |
| Asserting elapsed time to catch a hang | Load-sensitive; the spawn timeout turns the hang into a failure instead |

## Reference

- Code: `plugin/bin/lib/suite-slot.js` (the lock), `plugin/bin/lib/verify/slot.js` (`holdSlot`), `tools/run-tests.js` (sets HELD=1 for its child)
- Helper: `tests/helpers/suite-slot-env.js`
- Contract: `plugin/skills/test/suite-slots.md`
- Related skills: `lock-race-test-seam` (proving the read-modify-write lock in `plugin/bin/lib/file-lock.js`, a different lock)
