The machine-wide suite slot `verify.js` queues for before it runs checks (#5119) — the two lanes, how many slots a project gets, what a held slot sets for its children, and how to size it. Read when a run prints `waiting for a test-suite slot`, a report carries `slot`, or a project wants more than one slot.

# Suite slots

Several sessions on one machine each running a full suite at once is the cost this bounds. `verify.js` takes a slot from a machine-wide lock before it runs a local check, holds it through the checks and their flaky retries, then releases it.

## Lanes

| Lane | A run queues in it when |
|------|-------------------------|
| full | any local suite runs its full command: a `--cmd`, or a declared suite command |
| subset | every local suite runs an impact-subset or tool-scoped command, or only `types`/`lint` run |

- A CI-answered suite (`ci-source.md`) takes no slot while CI answers it. If it fails, its local flaky retry takes a subset-lane slot, and only when a retry actually spawns. A run whose every suite CI answers, with no local retry, takes no slot, and neither does a run with no local check.
- `--baseline` adjudication always takes its own full-lane slot, after the checks' slot is released, and only once a rerun will actually spawn: an adjudication refused before any rerun (no `--baseline-cmd` for a failing check, an unparseable log, no failing file present at base) takes none. Its reruns and its base-side full run queue behind every other full-lane holder.
- A nested `verify.js` (inheriting `CT_TEST_SUITE_SLOT_HELD=1`) takes no slot, so it never waits on its parent; neither does any other runner that honors that variable.

## How many slots

The slot count, applied to both lanes, is the first of:

1. `concurrency.suiteSlots` in `.claude-tweaks/verify-scope.json`
2. the `verify-suite-slots` policy key (`_shared/policy-schema.md`), passed by the caller as `--default-suite-slots {n}`
3. 1

The declaration beats the flag, the reverse of the usual flag-over-config order, because the declaration sits next to the suites the number describes. The flag's name says it is only a default.

The declaration block is `{ "concurrency": { "suiteSlots": N } }` with `N` a positive integer; `suiteSlots` is the only allowed key. Anything else fails validation with `concurrency: must be an object`, `concurrency: unknown key(s) "{k}" (allowed: suiteSlots)` or `concurrency.suiteSlots: must be a positive integer`. Without `--scope`, `verify.js` still reads this block from the default declaration (a nested run, which takes no slot, does not). A declaration that fails validation there prints `verify.js: concurrency ignored — {first error}` to stderr and counts as undeclared.

`verify.js` ignores the `CT_TEST_SUITE_SLOTS` and `CT_TEST_SUBSET_SLOTS` environment variables (the count knobs of the claude-tweaks repo's own maintainer test runner): its count comes only from the declaration, the flag or 1.

## The lock

The lock dir is `CT_TEST_SUITE_SLOT_DIR`, else `<os tmpdir>/ct-test-suite-slots`, one per machine: every project's `verify.js` runs queue in it together. A waiting run prints one stderr line, `verify.js [{lane} lane]: waiting for a test-suite slot — held by pid …` when a slot's holder blocks it, or `… — queued behind pid {n} (cwd …) since …` when an earlier waiter's ticket does, naming that process and ending with how to raise the limit (only `concurrency.suiteSlots` when the declaration set the count, since the policy key loses to it). A dead holder's slot is reclaimed.

The wait counts against the calling tool's timeout: with fewer slots than concurrent sessions, a run can queue behind several full suites before its checks start. `verification.md`'s Foreground rule says which timeout to set and how to read a call that comes back queued.

A lock dir `verify.js` cannot use (not a directory owned by this user, or not writable) prints `verify.js: suite slot unavailable — {message}` and exits 2 before the checks it was queuing for run. A directory another user owns (a shared `/tmp` on a multi-user host) is not this user's to remove, so the message also names the way out: set `CT_TEST_SUITE_SLOT_DIR` to a directory this user owns. At `--baseline` adjudication the same failure is recorded as not adjudicated (`adjudication error: suite slot unavailable — {message}`).

## While a slot is held

`verify.js` sets these for the checks it spawns:

- `CT_TEST_SUITE_SLOT_HELD=1`, so a nested runner skips the lock.
- `CT_TEST_WORKERS`: `max(1, floor(cores / (2 × slots)))` unless it is already set. A check's command reads it to cap its own parallelism:

```bash
node --test --test-concurrency=${CT_TEST_WORKERS:-4}
go test -p ${CT_TEST_WORKERS:-4} ./...
pytest -n ${CT_TEST_WORKERS:-4}
```

`CT_TEST_WORKERS` is set only below a `verify.js` that holds a slot, and a nested `verify.js` there inherits it. It is unset in CI, in a direct run of the test command, and under any other parent runner that does not set it (such as the claude-tweaks repo's own maintainer test runner). So every use needs a default (4 above; the number is the project's choice). Without one, `--test-concurrency=` exits 9 and `go test -p ./...` takes `./...` as the `-p` value. Checks run through `cmd.exe` on Windows, which has no `:-` default: set it in a wrapper script the check command calls (`if not defined CT_TEST_WORKERS set CT_TEST_WORKERS=4`).

On SIGINT, SIGTERM or SIGHUP while holding a slot, `verify.js` sends that signal to each running check's process group and waits up to 5 seconds for them to exit, so a test runner's own teardown (containers, temp databases, worker shutdown) runs. The wait ends as soon as every group has exited (on Linux a group whose processes are all exited but not yet reaped counts as exited), and it prints one stderr line when it starts. A check's output, teardown output included, goes straight to its log file, never through a pipe, so no amount of it stalls the check during the wait. For the same reason a background process a check leaves running does not keep `verify.js` waiting, and whatever it writes after the check exits is not part of the run's result. `verify.js` then kills each tree still alive, frees the slot and exits 128 plus the signal number (130, 143, 129). During `--baseline` adjudication, adjudication's own handler also runs: it removes its scratch worktree and exits with the same code. On Windows there is no signal to forward, so each tree is killed at once. While a slot is held each local check runs in its own session (setsid: its own process group and no controlling terminal), so a terminal's Ctrl-C reaches only `verify.js`, which forwards it, and a check that opens `/dev/tty` gets no terminal. Known limit: a SIGKILL sent to `verify.js`'s own process group does not reach a running check, so the orphaned check keeps running while its slot is reclaimed as a dead holder's.

`report.json` records the checks' slot as `slot`, the adjudication's as `baselineAdjudicated.slot`, and a CI-answered suite's local retry hold as that check's `checks.{suite}.retrySlot`: `{lane, index, waitedMs, slots, source}`, where `source` is `declaration`, `flag` or `default`. A run that took no slot has no `slot` field, and a check whose retry took none has no `retrySlot`.

## Sizing

The right `suiteSlots` depends on what the suites share (one database server, one device, a port range, memory), not on core count. A 30-minute suite with 9 sessions at 1 slot is a queue of about 4.5 hours, so raise the count until the shared resource, not the queue, is the limit.
