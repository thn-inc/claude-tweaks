# FIFO Test-Suite Slot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `acquireSlot` in `tools/run-tests.js` grants slots in arrival order, so a queued run is served before any later arrival that could use the same slot.

**Architecture:** Each waiter takes a numbered ticket file (`ticket-<seq>.json`) in its lane directory, recording its pid and its own `slots` limit. A waiter may try `slot-<i>.lock` only when no earlier live ticket has `slots > i`. Slot exclusivity stays entirely on the existing `slot-<i>.lock` files: tickets decide order only, so a ticket bug can reorder runs but never put two runs in one slot. A ticket is stale by exactly the rules `readHolder` already applies to slot locks (dead pid, the caller's own pid, or unparseable and older than `staleUnparseableMs`), and the waiter behind it removes it. There is no heartbeat: a ticket's age never makes a live pid's ticket stale.

**Tech Stack:** Node 18+ built-ins, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T120921-record-4333/work/4333-spec.md` — its `## Plan-review answers (2026-11-03)` section is binding and overrides the previous version of this plan.

Scope keywords: acquireSlot

## Global Constraints

- Keep (spec Deliverable 2, verbatim): "a dead holder's slot is reclaimed, the subset lane and full-suite lane stay separate, and a nested run holding `CT_TEST_SUITE_SLOT_HELD=1` still skips the wait."
- Plan-review answer 1 (rule): "A ticket is stale only when its pid is dead, when its pid is the caller's own pid, or when it can't be parsed and is older than `staleUnparseableMs`. … A ticket's age never makes a live pid's ticket stale. Drop the heartbeat entirely: the per-poll `utimesSync`, `staleTicketMs`, the `staleAfterMs` addition to `readHolder`, and their three tests." A waiter that finds its own ticket gone (`ENOENT`) takes a new tail ticket instead of crashing. The queued log line names the ticket path. The comment above `acquireSlot` states the residual risk: a ticket whose pid was reused, or whose waiter is stopped, blocks the queue until a human deletes the ticket the log line names — the same risk slot locks already accept.
- Plan-review answer 2 (rule): "Each ticket records its `slots` limit. A waiter may try `slot-<i>` only when no earlier live ticket has `slots > i`. A ticket whose limit can't be read counts as unlimited and blocks every index." Keep the queued line's "set CT_TEST_SUITE_SLOTS to raise the limit" wording (`set ${slotsVar} to raise the limit`, as today) and journey Step 4 as they are.
- Plan-review answer 3 (rule): the header comment notes that a checkout of `run-tests.js` from before this change ignores tickets and can jump the queue until its worktree catches up.
- Tests go in `tests/run-tests-isolation.test.js`. Every new test name starts with `#4333 ` so the verification commands below select only this task's tests.
- `tools/` is maintainer-side and does not ship in the plugin payload (`docs/decisions/0015-*`), so no plugin contract changes.
- Scope and edit discipline: Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.
- Governing project skills: `.claude/skills/windows-checkout-test-parity/SKILL.md` names `tools/run-tests.js` only for its command-line handling ("It now picks its argv in a pure `buildTestArgs(files, roots, { platform, nodeMajor, concurrency })`…"), which this change does not touch; its one consequence here is that Task 2's waiter processes spawn `process.execPath` directly, with no shell. `.claude/skills/skill-prose-conformance-tests/SKILL.md` names the file only as the test runner ("`npm test` resolves its file list via `tools/run-tests.js`'s `listTestFiles` walk…") and does not apply. `regex-scan-linearity` does not apply: the one new regex, `/^ticket-(\d+)\.json$/`, is anchored and runs over directory entry names.
- Sweep result (`git grep -i` for `acquireSlot`, `test-suite slot`, `ct-test-suite-slots`, `CT_TEST_SUITE_SLOT_DIR`, `readHolder`, `first slot it finds`, `poll-and-take` outside the two target files, `.claude-tweaks/` and `docs/superpowers/plans/`): `docs/journeys/run-the-suite-alongside-sibling-sessions-3969.md` (Step 2's wait line; owned by `/build` Common Step 6, Step 4 unchanged per answer 2), `tests/fixtures/run-tests/tmpdir-probe.fixture.js` (reads `slot-0.lock`, unaffected), `tests/test-impact-cli.test.js` (sets the dir, unaffected), two historical ledgers (no change). `docs/plugin-structure.md`'s `tools/` entry says "each run takes one machine-wide suite slot", which stays true: no change. `acquireSlot` has one caller, the main block of `tools/run-tests.js`.
- Return-shape widening: `readHolder`'s live-holder return gains `slots`. `readHolder` is not exported; its only consumers are `reclaimSlot` (reads `.stale` only) and `acquireSlot` (builds the log line's blocker). No test asserts on its return value.

## Review Focus

Each line's test is in Task 1.

- A waiter whose own ticket was deleted by hand rejoins the queue at the tail instead of crashing on `ENOENT` (`#4333 a waiter whose own ticket was removed rejoins the queue`).
- A ticket taken after ours never holds us back; otherwise two waiters deadlock on each other (`#4333 a ticket taken after ours does not hold us back`).
- The `subset/` directory inside the base lane's directory is never read as a ticket, and a ticket in one lane never blocks the other (`#4333 a ticket in the base lane does not block the subset lane …`).
- A failed write leaves nothing behind: the existing test `acquireSlot leaves no empty lock behind when writing its identity fails` now fails on the ticket write (the first write), and `#4333 a failed slot-lock write after the ticket leaves nothing behind` pins the second write — the empty lock and the ticket are both gone.
- A ticket at our path that is not ours (ours deleted by hand, then a newcomer numbered into the same seq) is never treated as ours and never deleted by us (`#4333 a foreign ticket at our own path makes us rejoin and is left in place`, `#4333 acquireSlot never deletes a ticket at its path that no longer names it`).
- `ticket-10` sorts after `ticket-9`: order is numeric, never by string (`#4333 a queued waiter logs once, naming the lowest live ticket ahead`).

---

### Task 1: Ticket queue in `acquireSlot`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tools/run-tests.js` (`createLock`, `readHolder`, `acquireSlot`; new `listTickets`, `takeTicket`, `ticketsAhead`; the header comment's slot paragraph, the comment above `acquireSlot`, and the main block's "While waiting for a slot nothing is held yet" comment)
- Test: `tests/run-tests-isolation.test.js`

**Interfaces:**
- Produces: `acquireSlot({ dir, slots, pid, cwd, isAlive, now, sleep, log, pollMs, staleUnparseableMs, staleReclaimMs, slotsVar })` — same parameters and return value as today, no new option. Ticket files `ticket-<seq>.json` in the lane directory, body `{ pid, startedAt, cwd, slots }`. No new exports.
- Consumes: the existing `createLock`, `readHolder`, `reclaimSlot`, `releaseSlot`, `unlinkQuiet`, `ensureOwnDir`.

- [ ] **Step 1: Write the failing tests**

Add a helper beside `writeLock`:

```js
function writeTicket(dir, seq, pid, slots = 1) {
  const p = path.join(dir, `ticket-${seq}.json`);
  fs.writeFileSync(p, JSON.stringify({ pid, startedAt: '2026-01-01T00:00:00.000Z', cwd: '/work/other', slots }));
  return p;
}
```

Add after the `acquireSlot uses a second slot when slots=2` test, each inside `withTempDir`, using `slotArgs` (pid 111):

- `#4333 AC2.1: a later arrival waits behind a live earlier ticket even when a slot is free` — `writeTicket(dir, 1, 222)`, `isAlive: (pid) => pid === 222`. In `sleep`: assert `slot-0.lock` does not exist, then unlink `ticket-1.json`. Assert the returned lock is `slot-0.lock` and `sleeps === 1`. (Deleting the earlier-ticket check turns this red.)
- `#4333 AC3.1: a ticket left by a dead waiter is removed and does not block the queue` — `writeTicket(dir, 1, 222)`, `isAlive: () => false`, `sleep: noSleep`. Assert the lock is `slot-0.lock` and `ticket-1.json` is gone.
- `#4333 a live waiter's ticket is never stale by age` — `writeTicket(dir, 1, 222)`, `fs.utimesSync` it to 11 minutes ago, `isAlive: (pid) => pid === 222`. In `sleep`: assert `ticket-1.json` still exists, then unlink it. Assert `sleeps === 1`.
- `#4333 a ticket naming our own pid is stale` — `writeTicket(dir, 1, 111)`, `isAlive: () => true`, `sleep: noSleep`. Assert the lock is returned.
- `#4333 a waiter whose own ticket was removed rejoins the queue` — `writeLock(dir, 0, 333)`, `isAlive: (pid) => pid === 333`. On sleep 1, unlink `ticket-1.json`. On sleep 2, assert some `ticket-*.json` exists again and parses with pid 111, then unlink the lock. Assert the lock is returned and `sleeps === 2`.
- `#4333 a foreign ticket at our own path makes us rejoin and is left in place` — `writeLock(dir, 0, 333)`, `isAlive: (pid) => pid === 333 || pid === 222`. On sleep 1, overwrite `ticket-1.json` (ours) with `{ pid: 222, startedAt: '2026-01-01T00:00:00.000Z', cwd: '/work/other', slots: 1 }`. On sleep 2, assert a ticket naming pid 111 exists at a seq above 1, then unlink `ticket-1.json` and the lock. Assert the lock is returned.
- `#4333 acquireSlot never deletes a ticket at its path that no longer names it` — `writeLock(dir, 0, 333)`, `sleep: noSleep`, and an `isAlive` that, on its first call, overwrites `ticket-1.json` (ours) with `{ pid: 222, startedAt: '2026-01-01T00:00:00.000Z', cwd: '/work/other', slots: 1 }` and then returns `pid === 222` for every call (so 333's lock reads dead and is reclaimed in the same pass). Assert the lock is `slot-0.lock` and that `ticket-1.json` still exists naming pid 222 after `acquireSlot` returns. (An unconditional unlink in `finally` turns this red.)
- `#4333 a failed slot-lock write after the ticket leaves nothing behind` — stub `fs.writeSync` so its first call passes through to the original and every later call throws `ENOSPC` (restore it in `finally`). `assert.throws(() => acquireSlot({ dir, slots: 1, pid: 4242, cwd: '/x', isAlive: () => true, now: Date.now, sleep: () => {}, log: () => {} }), /no space left/)`, then `assert.deepStrictEqual(fs.readdirSync(dir), [])`.
- `#4333 a ticket taken after ours does not hold us back` — `writeLock(dir, 0, 333)`, `isAlive: (pid) => pid === 333 || pid === 222`. On sleep 1, `writeTicket(dir, 2, 222)` (ours is `ticket-1`) and unlink the lock. Assert the lock is `slot-0.lock` and `sleeps === 1`. (Walking tickets past our own seq turns this red.)
- `#4333 a new arrival numbers its ticket after the highest existing one` — `writeTicket(dir, 7, 222)`, `isAlive: (pid) => pid === 222`. In `sleep`: assert `ticket-8.json` exists and parses with `{ pid: 111, cwd: '/work/a', slots: 1 }` (plus `startedAt`), then unlink `ticket-7.json`.
- `#4333 acquireSlot leaves only its lock behind once it holds the slot` — no setup. `assert.deepStrictEqual(fs.readdirSync(dir), ['slot-0.lock'])`.
- `#4333 a queued waiter logs once, naming the lowest live ticket ahead` — `writeTicket(dir, 10, 333)`, `writeTicket(dir, 9, 222)`, both alive. On sleep 1 unlink `ticket-9.json`, on sleep 2 unlink `ticket-10.json`. Assert exactly one log line, equal to `'run-tests.js: waiting for a test-suite slot — queued behind pid 222 (cwd /work/other) since 2026-01-01T00:00:00.000Z; set CT_TEST_SUITE_SLOTS to raise the limit (ticket: ' + path.join(dir, 'ticket-9.json') + ')'`.
- `#4333 a later arrival with a higher limit takes a slot index the waiters ahead of it cannot use` (plan-review answer 2) — `writeLock(dir, 0, 333)`, `writeTicket(dir, 1, 222, 1)`, `isAlive: (pid) => pid === 222 || pid === 333`. First, `acquireSlot(slotArgs(dir, { slots: 2, sleep: noSleep, isAlive }))` returns `slot-1.lock` at once. Then a third arrival, `acquireSlot(slotArgs(dir, { pid: 444, slots: 1, isAlive, sleep, log }))`, whose `sleep` asserts `slot-0.lock` still names pid 333 and `ticket-1.json` exists, then unlinks both. Assert it returns `slot-0.lock`, `sleeps === 1`, and its one log line starts with `'run-tests.js: waiting for a test-suite slot — queued behind pid 222 '`. Finally, the queued line names the ticket that actually blocks: `writeTicket(dir, 1, 222, 1)`, `writeTicket(dir, 2, 333, 3)`, both alive, arrival `slots: 2` whose `sleep` unlinks both tickets; assert its one log line ends with `'(ticket: ' + path.join(dir, 'ticket-2.json') + ')'` (ticket-1's limit of 1 leaves index 1 free, so deleting it alone would not unblock us).
- `#4333 a ticket whose limit cannot be read blocks every slot index` (plan-review answer 2) — write `ticket-1.json` as `{ pid: 222, startedAt: '2026-01-01T00:00:00.000Z', cwd: '/work/other' }` (no `slots`), `isAlive: (pid) => pid === 222`, `slots: 2`. In `sleep`: assert neither `slot-0.lock` nor `slot-1.lock` exists, then unlink the ticket. Assert `sleeps === 1`. (Treating an unreadable limit as 1 turns this red: the arrival would take `slot-1` at once.)
- `#4333 a ticket in the base lane does not block the subset lane, and the subset directory is not a ticket` — `const { dir: sub } = slotLane(dir, true)`, `fs.mkdirSync(sub)`, `writeTicket(dir, 1, 222)`, `isAlive: (pid) => pid === 222`. `acquireSlot(slotArgs(sub, { sleep: noSleep, isAlive }))` returns `path.join(sub, 'slot-0.lock')` and `ticket-1.json` still exists. Then unlink `ticket-1.json`; `acquireSlot(slotArgs(dir, { sleep: noSleep, isAlive }))` returns `path.join(dir, 'slot-0.lock')` with `subset` still a directory.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="#4333" tests/run-tests-isolation.test.js`
Expected: FAIL after Step 1 (before Step 1 the pattern matches no test). The `AC2.1`, unreadable-limit and higher-limit tests fail because a free slot is taken with no sleep; the ticket-file tests fail on missing `ticket-*.json` files.

- [ ] **Step 3: Implement the queue in `tools/run-tests.js`**

- `createLock(lockPath, pid, cwd, now, extra = {})`: the written identity becomes `{ pid, startedAt, cwd, ...extra }`. Lock callers pass nothing and write exactly what they write today.
- `readHolder`: the live-holder return becomes `{ pid, cwd, startedAt, slots: held.slots }`. Nothing else changes; no `staleAfterMs`.
- `listTickets(dir)` returns `{ seq, path }[]` for entry names matching `/^ticket-(\d+)\.json$/`, sorted numerically by `seq`.
- `takeTicket(dir, { pid, cwd, now, slots })` starts at the highest listed `seq` + 1 (1 when none) and calls `createLock(ticketPath, pid, cwd, now, { slots })` on that number, then the next, until one succeeds; returns `{ seq, path }`.
- `ticketsAhead(dir, seq, holderOpts)` walks `listTickets(dir)` in order, stopping at the first entry whose `seq >= seq`. A `null` holder is skipped; a stale holder is unlinked with `unlinkQuiet` and skipped. Returns `{ floor, first }`: `floor` is the largest limit among the live tickets ahead (0 when none), where a ticket's limit is its `slots` when that is a positive integer and `Infinity` otherwise (so `UNKNOWN_HOLDER` blocks every index); `first` is the lowest live ticket ahead whose limit is at least the caller's own `slots` (that ticket alone blocks every index the caller can use), as `{ ...holder, lockPath: ticket.path }`, or `null`; `ticketsAhead` takes the caller's `slots` in `holderOpts` for this. Whenever `floor >= slots`, such a ticket exists.

`acquireSlot`'s body becomes the shape below; the per-slot scan is today's loop body unchanged, only its start index moves from `0` to `floor`:

```js
ensureOwnDir(dir);
const holderOpts = { isAlive, now, staleUnparseableMs };
let ticket = takeTicket(dir, { pid, cwd, now, slots });
let logged = false;
try {
  for (;;) {
    // our ticket must still be ours: missing (deleted by hand), unparseable, or naming another pid
    // (a newcomer numbered into our deleted seq) → ticket = takeTicket(...) again, at the tail
    const { floor, first } = ticketsAhead(dir, ticket.seq, holderOpts);
    let blocker = null;
    for (let i = floor; i < slots; i++) { /* today's scan body, unchanged */ }
    if (!logged) { /* logged = true; floor >= slots ? queued form naming `first` : today's held form, byte-identical */ }
    sleep(pollMs);
  }
} finally {
  releaseSlot(ticket.path, pid); // removes the ticket only while it still names our pid
}
```

The queued form is `run-tests.js: waiting for a test-suite slot — queued behind pid ${first.pid} (cwd ${first.cwd}) since ${first.startedAt}; set ${slotsVar} to raise the limit (ticket: ${first.lockPath})`. A `takeTicket` write failure throws before the `try`, after `createLock` has already removed its file.

Comments: the header's slot paragraph gains one sentence that waiters are served in arrival order through ticket files, and that a `run-tests.js` checkout from before this change ignores tickets and can jump the queue until its worktree catches up (answer 3). The block above `acquireSlot` states that tickets decide order only and locks decide exclusivity; the per-index rule and its unlimited default; that staleness is pid liveness, never age; that a number below a live ticket is never reissued (a later arrival lists the directory while every earlier live waiter's ticket exists), so reaping a stale ticket ahead cannot delete a newer one; and the residual risk from the Global Constraints. The main block's "nothing is held yet" sentence gains that a signal while waiting leaves only a ticket, which reads as stale once the pid is gone.

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
- Consumes: Task 1's `acquireSlot` through its public arguments only, the file's `until` and `RUNNER`, and the `log` callback as the arrival signal. The test must not read ticket files: the same test runs against the reverted implementation, which writes none.

- [ ] **Step 1: Write the tests**

Add after the `run-tests.js waits for a slot held by a live pid, naming the holder` test. Define one waiter program as a string run through `spawn(process.execPath, ['-e', WAITER, RUNNER, slotDir, slots, pollMs, name, outFile])`, with no shell and `stdio: 'ignore'`. It requires `RUNNER`, calls `acquireSlot` with `pid: process.pid`, `isAlive: isPidAlive`, `now: Date.now`, an `Atomics.wait` sleep and the given `slots`/`pollMs`, appends `waiting <name>\n` to `outFile` from the `log` callback and `acquired <name>\n` after `acquireSlot` returns, then polls every 20 ms for the file `release-<name>` in `outFile`'s directory, calls `releaseSlot`, and exits 0. Each test runs in its own `fs.mkdtempSync` directory, removed in `finally` after every child is killed.

- `#4333 AC1.1: N+2 waiters against N slots acquire in arrival order` — N = 2. Start waiters in order A, B, C, D, each only after the previous has reported (`acquired` for A and B, `waiting` for C and D). C polls every 1000 ms and D every 20 ms, so under poll-and-take-first the later, faster D wins the first freed slot. Release A, wait for three `acquired` lines; release B, wait for four. Assert the `acquired` order is exactly `['A', 'B', 'C', 'D']`. Release all and assert every waiter exits 0. `until` bounds are 60000 ms.
- `#4333 AC3.1: a waiter killed in the queue does not block the one behind it` — write `slot-0.lock` naming `process.pid`. Start A (wait for `waiting A`), start B (wait for `waiting B`), `A.kill('SIGKILL')` and wait for its exit, then unlink the lock. Assert B reports `acquired B` within the `until` bound.

- [ ] **Step 2: Run the tests against the Task 1 tree**

Run: `node --test --test-name-pattern="#4333 AC1\.1|#4333 AC3\.1: a waiter killed" tests/run-tests-isolation.test.js`
Expected: PASS. These pin behavior Task 1 already built.

- [ ] **Step 3: Prove the arrival-order test discriminates (AC2.1)**

Never edit this worktree's copy of `tools/run-tests.js` to do this. In a scratch checkout (`_shared/subagent-dispatch-core.md`'s "Discrimination checks in a scratch checkout"), place the base runner from `git show 7737dfb05:tools/run-tests.js` at `tools/run-tests.js` beside this task's `tests/run-tests-isolation.test.js` (plus `tests/fixtures/run-tests/`), and run `node --test --test-name-pattern="#4333 AC1\.1" tests/run-tests-isolation.test.js` there. Expected: FAIL with the acquired order `['A', 'B', 'D', 'C']`.

- [ ] **Step 4: Record the discrimination evidence**

`mkdir -p "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-03T120921-record-4333/evidence"`, then write Step 3's full output to `.../evidence/ac2-revert.txt` in that directory with a plain Bash redirect. Then write one `decisions.md` entry with `node "{plugin-root}/bin/log-decision.js" --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-03T120921-record-4333" --section "/build" --status AUTO --step "AC evidence" --text-file {text-file}`, where `{text-file}` (written with the Write tool to a session temp file) holds one line carrying `AC2.1`, the command shape, the failing order and the evidence path.

- [ ] **Step 5: Commit**

```bash
git add tests/run-tests-isolation.test.js
git commit -m "Pin arrival-order slot grants with real waiter processes — refs #4333"
```

## Spec Coverage

| Clause | Covered by |
|---|---|
| AC1.1 | Task 2 `#4333 AC1.1: N+2 waiters against N slots acquire in arrival order` |
| AC2.1 | Task 2 Step 3 revert proof (evidence in `evidence/ac2-revert.txt`); Task 1 `#4333 AC2.1: a later arrival waits behind a live earlier ticket even when a slot is free` |
| AC3.1 | Task 1 `#4333 AC3.1: a ticket left by a dead waiter is removed and does not block the queue`; Task 2 `#4333 AC3.1: a waiter killed in the queue does not block the one behind it` |

Deliverable 2's guarantees: dead-holder reclaim keeps its existing tests, the lanes have Task 1's `base lane` test, and the nested skip keeps `a nested run with CT_TEST_SUITE_SLOT_HELD=1 skips the slot`, which never reaches `acquireSlot`. Plan-review answers 1 and 2 are pinned by Task 1's `never stale by age`, `rejoins the queue`, `higher limit` and `limit cannot be read` tests.
