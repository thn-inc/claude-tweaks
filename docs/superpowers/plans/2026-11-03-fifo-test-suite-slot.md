# FIFO Test-Suite Slot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `acquireSlot` in `tools/run-tests.js` grants slots in arrival order, so a queued run is served before any later arrival.

**Architecture:** Each waiter takes a numbered ticket file in its lane directory, and only the lowest live ticket may try the existing slot locks. Slot exclusivity stays entirely on the existing `slot-<i>.lock` files; tickets decide order only, so a ticket bug can reorder runs but never put two runs in one slot. A dead or silent waiter's ticket is removed by the waiter behind it.

**Tech Stack:** Node 18+ built-ins, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T230235-record-4333/work/4333-spec.md`

Scope keywords: acquireSlot

## Global Constraints

- Keep: a dead holder's slot is reclaimed; the subset lane and full-suite lane stay separate; a nested run holding `CT_TEST_SUITE_SLOT_HELD=1` still skips the wait.
- Tests go in `tests/run-tests-isolation.test.js`.
- `tools/` is maintainer-side and does not ship in the plugin payload, so no plugin contract changes.
- Scope and edit discipline: Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.
- Governing project skills: `windows-checkout-test-parity` names `tools/run-tests.js`, but only for its command-line handling, which this change does not touch. Its applicable consequence is that the new process tests spawn `process.execPath` directly, with no shell. `skill-prose-conformance-tests` names the file only as a test-runner reference and does not apply. `regex-scan-linearity` does not apply: the one new regex is anchored and runs over directory entry names, not unbounded text.
- Sweep result: `git grep` for `acquireSlot`, `slot-0.lock`, `ct-test-suite-slots`, `CT_TEST_SUITE_SLOT_DIR` and `test-suite slot` outside these two files hits only `docs/journeys/run-the-suite-alongside-sibling-sessions-3969.md` (updated at Common Step 6), `tests/fixtures/run-tests/tmpdir-probe.fixture.js` (reads `slot-0.lock`, unaffected), `tests/test-impact-cli.test.js` (sets the dir, unaffected) and one historical ledger. `acquireSlot` has one caller, the main block of `tools/run-tests.js`.

## Review Focus

Each line's test is in Task 1.

- A waiter stalled past `staleTicketMs` (a sleeping laptop) has its own ticket reaped: it rejoins the queue instead of crashing on `ENOENT`.
- A killed waiter whose pid was reused, or a stopped waiter, must not wedge the queue: an old heartbeat makes the ticket stale even when its pid reads as alive.
- The `subset/` directory inside the base lane's directory is never read as a ticket, and a ticket in one lane never blocks the other.
- A failed ticket write (`ENOSPC`) leaves nothing behind; the existing test `acquireSlot leaves no empty lock behind when writing its identity fails` keeps pinning this because the ticket write is the first write.
- `ticket-10` sorts after `ticket-9`: order is numeric, never by string.

---

### Task 1: Ticket queue in `acquireSlot`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tools/run-tests.js` (`readHolder`, `acquireSlot`, new `listTickets`, `takeTicket`, `firstLiveTicketAhead`; the header comment and the "While waiting for a slot" comment in the main block)
- Test: `tests/run-tests-isolation.test.js`

**Interfaces:**
- Produces: `acquireSlot({ ..., staleTicketMs = 60000 })`, same return value. Ticket files are `ticket-<seq>.json` in the lane directory. No new exports.
- Consumes: the existing `createLock`, `readHolder`, `unlinkQuiet`.

- [ ] **Step 1: Write the failing tests**

Add after the `acquireSlot uses a second slot when slots=2` test, with a helper beside `writeLock`:

```js
function writeTicket(dir, seq, pid) {
  const p = path.join(dir, `ticket-${seq}.json`);
  fs.writeFileSync(p, JSON.stringify({ pid, startedAt: '2026-01-01T00:00:00.000Z', cwd: '/work/other' }));
  return p;
}
```

Tests, each inside `withTempDir`, using `slotArgs`:

- `AC2.1: a later arrival waits behind a live earlier ticket even when a slot is free`. `writeTicket(dir, 1, 222)`, `isAlive: (pid) => pid === 222`. In `sleep`: assert `slot-0.lock` does not exist, then unlink the ticket. Assert the returned lock is `slot-0.lock` and `sleeps === 1`.
- `AC3.1: a ticket left by a dead waiter is removed and does not block the queue`. `writeTicket(dir, 1, 222)`, `isAlive: () => false`, `sleep: noSleep`. Assert the lock is returned and `ticket-1.json` is gone.
- `a ticket with an old heartbeat is removed even when its pid reads as alive`. `writeTicket(dir, 1, 222)`, `fs.utimesSync` it to 61 s ago, `isAlive: () => true`, `sleep: noSleep`. Assert the lock is returned and the ticket is gone.
- `a fresh ticket with a live pid is not removed by the heartbeat check`. Same as above with the mtime 59 s ago and a `sleep` that asserts the ticket still exists, then unlinks it. Assert `sleeps === 1`.
- `a ticket naming our own pid is stale`. `writeTicket(dir, 1, 111)`, `isAlive: () => true`, `sleep: noSleep`. Assert the lock is returned.
- `a waiter refreshes its own heartbeat on every poll`. `writeLock(dir, 0, 333)`, `isAlive: (pid) => pid === 333`. On sleep 1, set `ticket-1.json`'s mtime to 61 s ago. On sleep 2, assert its mtime is within 10 s of now, then unlink the lock. Assert `sleeps === 2`.
- `a waiter whose own ticket was removed rejoins the queue`. `writeLock(dir, 0, 333)`, same `isAlive`. On sleep 1, unlink `ticket-1.json`. On sleep 2, assert a `ticket-*.json` exists again, then unlink the lock. Assert the lock is returned.
- `a new arrival numbers its ticket after the highest existing one`. `writeTicket(dir, 7, 222)`, `isAlive: (pid) => pid === 222`. In `sleep`: assert `ticket-8.json` exists and parses with pid 111, then unlink `ticket-7.json`.
- `acquireSlot leaves only its lock behind once it holds the slot`. No setup. `assert.deepStrictEqual(fs.readdirSync(dir), ['slot-0.lock'])`.
- `a queued waiter logs once, naming the lowest ticket numerically`. `writeTicket(dir, 10, 333)`, `writeTicket(dir, 9, 222)`, both alive. On sleep 1 unlink `ticket-9.json`, on sleep 2 unlink `ticket-10.json`. Assert exactly one log line, equal to `'run-tests.js: waiting for a test-suite slot — queued behind pid 222 (cwd /work/other) since 2026-01-01T00:00:00.000Z; set CT_TEST_SUITE_SLOTS to raise the limit (ticket: ' + path.join(dir, 'ticket-9.json') + ')'`.
- `a ticket in the base lane does not block the subset lane, and the subset directory is not a ticket`. `const { dir: sub } = slotLane(dir, true)`, `fs.mkdirSync(sub)`, `writeTicket(dir, 1, 222)`, `isAlive: (pid) => pid === 222`. `acquireSlot(slotArgs(sub, { sleep: noSleep }))` returns `path.join(sub, 'slot-0.lock')` and `ticket-1.json` still exists. Then unlink `ticket-1.json`, and `acquireSlot(slotArgs(dir, { sleep: noSleep }))` returns `path.join(dir, 'slot-0.lock')` with `subset` still a directory.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="AC2\.1|AC3\.1|heartbeat|rejoins|new arrival|only its lock|queued waiter|ticket in the base lane" tests/run-tests-isolation.test.js`
Expected: FAIL. `AC2.1` fails because the slot is taken with no sleep; the ticket tests fail on missing `ticket-*.json` files.

- [ ] **Step 3: Implement the queue in `tools/run-tests.js`**

Add a trailing optional `staleAfterMs` to the options `readHolder` destructures. Right after the file is read and before the JSON parse, return `{ stale: true }` when `staleAfterMs !== undefined && now() - mtimeMs > staleAfterMs`. Lock callers pass nothing and are unchanged.

Add above `acquireSlot`:

- `listTickets(dir)` returns `{ seq, path }[]` for names matching `/^ticket-(\d+)\.json$/`, sorted numerically by `seq`.
- `takeTicket(dir, pid, cwd, now)` starts at the highest listed `seq` (0 when none), tries `createLock` on `seq + 1`, `seq + 2`, ... until one succeeds, and returns `{ seq, path }`.
- `firstLiveTicketAhead(dir, seq, holderOpts)` walks `listTickets(dir)` in order and stops with `null` at the first entry with `seq >= seq`. A `null` holder is skipped. A stale holder is unlinked with `unlinkQuiet` and skipped. Otherwise it returns `{ ...holder, lockPath: ticket.path, queued: true }`.

Rewrite the body of `acquireSlot` as below, keeping the existing per-slot scan verbatim as the inner loop:

```js
ensureOwnDir(dir);
const holderOpts = { isAlive, now, staleUnparseableMs, staleAfterMs: staleTicketMs };
let ticket = takeTicket(dir, pid, cwd, now);
let logged = false;
try {
  for (;;) {
    try {
      const t = new Date(now());
      fs.utimesSync(ticket.path, t, t);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      ticket = takeTicket(dir, pid, cwd, now);
    }
    let blocker = firstLiveTicketAhead(dir, ticket.seq, holderOpts);
    if (!blocker) {
      // the existing `for (let i = 0; i < slots; i++)` scan, unchanged
    }
    if (!logged) { /* logged = true; log the queued form or the existing held form */ }
    sleep(pollMs);
  }
} finally {
  unlinkQuiet(ticket.path);
}
```

The queued log line is pinned by the test above; the held form stays byte-identical. Why the numbering holds: a later arrival lists the directory after an earlier waiter's ticket exists, so it numbers higher; a number below a live ticket can never be reissued, so reaping a stale ticket ahead cannot delete a newer one.

Update the comments: the file header's slot paragraph gains one sentence on arrival order; the block above `acquireSlot` states that tickets decide order only, that the lowest live ticket alone tries the locks, and that a checkout predating this change ignores tickets; the main block's "nothing is held yet" comment gains that a ticket left by a signal reads as stale once its pid is gone.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/run-tests-isolation.test.js`
Expected: PASS, every test in the file, the existing slot tests unmodified.

- [ ] **Step 5: Commit**

```bash
git add tools/run-tests.js tests/run-tests-isolation.test.js
git commit -m "Make acquireSlot serve waiters in arrival order — refs #4333"
```

### Task 2: Real-process arrival order and killed-waiter tests

**Role:** integration
**Review risk:** high

**Files:**
- Test: `tests/run-tests-isolation.test.js`

**Interfaces:**
- Consumes: Task 1's `acquireSlot` behavior through its public arguments only, the file's `until` and `RUNNER`, and the `log` callback as the arrival signal. The test must not read ticket files: the same test has to run against the reverted implementation, which writes none.

- [ ] **Step 1: Write the failing tests**

Add after the `run-tests.js waits for a slot held by a live pid, naming the holder` test. Define one waiter program as a string run through `spawn(process.execPath, ['-e', WAITER, RUNNER, slotDir, slots, pollMs, name, outFile])`, with no shell. It appends `waiting <name>\n` to `outFile` from the `log` callback and `acquired <name>\n` after `acquireSlot` returns, then polls every 20 ms for the file `release-<name>` in `outFile`'s directory, calls `releaseSlot`, and exits 0. It passes `isPidAlive`, `Date.now` and an `Atomics.wait` sleep.

- `AC1.1, AC2.1: N+2 waiters against N slots acquire in arrival order`. N = 2. Start waiters in order A, B, C, D, each only after the previous has reported: `acquired` for A and B, `waiting` for C and D. C polls every 1000 ms and D every 20 ms, so under poll-and-take-first the later, faster D wins the first freed slot. Release A, wait for three `acquired` lines; release B, wait for four. Assert the `acquired` order is exactly `['A', 'B', 'C', 'D']`. Release all and assert every waiter exits 0. `until` bounds are 60000 ms; kill every child in `finally`.
- `AC3.1: a waiter killed in the queue does not block the one behind it`. Write `slot-0.lock` naming `process.pid`. Start A (`waiting`), start B (`waiting`), `A.kill('SIGKILL')` and wait for its exit, then unlink the lock. Assert B reports `acquired` within the `until` bound.

- [ ] **Step 2: Run the tests against the Task 1 tree**

Run: `node --test --test-name-pattern="N\+2 waiters|killed in the queue" tests/run-tests-isolation.test.js`
Expected: PASS. These pin behavior Task 1 already built.

- [ ] **Step 3: Prove the arrival-order test discriminates**

Never edit this worktree's copy of `tools/run-tests.js` to do this. In a scratch checkout (`_shared/subagent-dispatch-core.md`'s "Discrimination checks in a scratch checkout"), put the base `tools/run-tests.js` from `git show dc02e2700:tools/run-tests.js` beside this task's test file, and run the same command as Step 2 there. Expected: `N+2 waiters` FAILS with `['A', 'B', 'D', 'C']`. The reverted run is a scratch check: record the output per the AC-evidence rule below.

- [ ] **Step 4: Record the discrimination evidence**

Write the Step 3 output to `$PIPELINE_RUN_DIR/evidence/ac2-revert.txt` after `mkdir -p "$PIPELINE_RUN_DIR/evidence"`, using the absolute run-dir path and a plain Bash redirect. Then write one `decisions.md` entry through `log-decision.js --section "/build" --status AUTO --step "AC evidence" --text-file {text-file}`, whose line carries `AC2.1`, the command shape, the failing order, and that path.

- [ ] **Step 5: Commit**

```bash
git add tests/run-tests-isolation.test.js
git commit -m "Pin arrival-order slot grants with real waiter processes — refs #4333"
```

## Spec Coverage

| Clause | Covered by |
|---|---|
| AC1.1 | Task 2 `AC1.1, AC2.1: N+2 waiters against N slots acquire in arrival order` |
| AC2.1 | Task 1 `AC2.1: a later arrival waits behind a live earlier ticket even when a slot is free`; Task 2 revert proof |
| AC3.1 | Task 1 `AC3.1: a ticket left by a dead waiter is removed and does not block the queue`; Task 2 `AC3.1: a waiter killed in the queue does not block the one behind it` |

Deliverable 2's guarantees: dead-holder reclaim keeps its existing tests, the lanes have the Task 1 `base lane` test, and the nested skip keeps `a nested run with CT_TEST_SUITE_SLOT_HELD=1 skips the slot`, which never reaches `acquireSlot`.
