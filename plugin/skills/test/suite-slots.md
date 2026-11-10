The machine-wide suite slot `verify.js` queues for before it runs checks (#5119) — the two lanes, how many slots a project gets, what a held slot sets for its children, and how to size it. Read when a run prints `waiting for a test-suite slot`, a report carries `slot`, or a project wants more than one slot.

# Suite slots

Several sessions on one machine each running a full suite at once is the cost this bounds. `verify.js` takes a slot from a machine-wide lock before it runs a local check, holds it through the checks and their flaky retries, then releases it.

## Lanes

| Lane | A run queues in it when |
|------|-------------------------|
| full | any local suite runs its full command: a `--cmd`, or a declared suite command |
| subset | every local suite runs an impact-subset or tool-scoped command, or only `types`/`lint` run |

- A CI-answered suite (`ci-source.md`) takes no slot while CI answers it. If it fails, its local flaky retry takes a subset-lane slot, and only when a retry actually spawns. A run whose every suite CI answers, with no local retry, takes no slot, and neither does a run with no local check.
- `--baseline` adjudication always takes its own full-lane slot, after the checks' slot is released. Its reruns and its base-side full run queue behind every other full-lane holder.
- A nested `verify.js` or `tools/run-tests.js` (inheriting `CT_TEST_SUITE_SLOT_HELD=1`) takes no slot, so it never waits on its parent.

## How many slots

The slot count, applied to both lanes, is the first of:

1. `concurrency.suiteSlots` in `.claude-tweaks/verify-scope.json`
2. the `verify-suite-slots` policy key (`_shared/policy-schema.md`), passed by the caller as `--default-suite-slots {n}`
3. 1

The declaration block is `{ "concurrency": { "suiteSlots": N } }` with `N` a positive integer; `suiteSlots` is the only allowed key. Anything else fails validation with `concurrency: must be an object`, `concurrency: unknown key(s) "{k}" (allowed: suiteSlots)` or `concurrency.suiteSlots: must be a positive integer`. Without `--scope`, `verify.js` still reads this block from the default declaration. A declaration that fails validation there prints `verify.js: concurrency ignored — {first error}` to stderr and counts as undeclared.

## The lock

The lock dir is `CT_TEST_SUITE_SLOT_DIR`, else `<os tmpdir>/ct-test-suite-slots`. This repo's `tools/run-tests.js` shares it, so a `verify.js` run and a `run-tests.js` run queue against each other. A waiting run prints one stderr line, `verify.js [{lane} lane]: waiting for a test-suite slot — held by pid …`, naming the holder and ending with how to raise the limit. A dead holder's slot is reclaimed.

## While a slot is held

`verify.js` sets these for the checks it spawns:

- `CT_TEST_SUITE_SLOT_HELD=1`, so a nested runner skips the lock.
- `CT_TEST_WORKERS`: `max(1, floor(cores / (2 × slots)))` unless it is already set. A check's command reads it to cap its own parallelism:

```bash
node --test --test-concurrency=$CT_TEST_WORKERS
go test -p $CT_TEST_WORKERS ./...
pytest -n $CT_TEST_WORKERS
```

On SIGINT, SIGTERM or SIGHUP while holding a slot, `verify.js` kills each running check's process tree, frees the slot and exits 128 plus the signal number (130, 143, 129). Each local check runs in its own process group while a slot is held so that kill reaches its whole tree. Known limit: a SIGKILL sent to `verify.js`'s own process group does not reach a running check, so the orphaned check keeps running while its slot is reclaimed as a dead holder's.

`report.json` records the checks' slot as `slot` and the adjudication's as `baselineAdjudicated.slot`: `{lane, index, waitedMs, slots, source}`, where `source` is `declaration`, `flag` or `default`. A run that took no slot has no `slot` field.

## Sizing

The right `suiteSlots` depends on what the suites share (one database server, one device, a port range, memory), not on core count. A 30-minute suite with 9 sessions at 1 slot is a queue of about 4.5 hours, so raise the count until the shared resource, not the queue, is the limit.
