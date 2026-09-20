'use strict';
const fs = require('fs');
const { enqueueRetry, dequeueRetry, shouldEscalate, ESCALATE_AFTER_ATTEMPTS } = require('./durable-state');

// Shared retry-queue CLI command bodies for code-health, harness-health,
// journey-health, and docs-health — each CLI calls makeRetryQueueCommands
// bound to its own readDurableState/writeDurableState (from its own
// cache.js) and wires the two returned functions to its `retry-queue
// drain`/`retry-queue update` subcommands. One implementation instead of
// four near-identical copies.
function makeRetryQueueCommands({ readDurableState, writeDurableState }) {
  function drain(args) {
    const root = args.root || process.cwd();
    const { retryQueue } = readDurableState(root);
    process.stdout.write(JSON.stringify(retryQueue.map((e) => e.payload), null, 2) + '\n');
  }

  // results: [{ fingerprint, payload, ok: true }] or
  // [{ fingerprint, payload, ok: false, error }] — one entry per payload this
  // firing just attempted to file (retry-queue drain results and/or brand-new
  // findings that failed this firing's own filing step). Prints the entries
  // that just crossed the 3-strikes escalation threshold, for the calling
  // skill to file a {skill}:filing-failed issue for each.
  function update(args) {
    const root = args.root || process.cwd();
    const resultsPath = args._[1];
    if (!resultsPath) {
      process.stderr.write('usage: <cli>.js retry-queue update <results.json> [--root <dir>]\n');
      return 2;
    }
    let results;
    try {
      results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    } catch (err) {
      process.stderr.write(`retry-queue update: could not read or parse ${resultsPath}: ${err.message}\n`);
      return 1;
    }
    // Declared here but reset to [] on every mutator invocation below: the
    // mutator is re-invoked fresh by writeDurableState's own CAS-retry loop
    // on every rejected attempt (see durable-state.test.js's "retries on a
    // rejected ref update" test), and only the LAST invocation's `next`
    // state is ever actually persisted. Accumulating pushes across every
    // attempt (instead of resetting per-attempt) would report the same
    // crossing-threshold fingerprint duplicated once per retry.
    let escalated = [];
    const result = writeDurableState(root, (current) => {
      escalated = [];
      let queue = current.retryQueue;
      for (const r of results) {
        if (!r || typeof r !== 'object') {
          process.stderr.write('retry-queue update: skipping malformed result entry\n');
          continue;
        }
        if (r.ok) {
          queue = dequeueRetry(queue, r.fingerprint);
        } else {
          // Capture attempts BEFORE this failure is enqueued so escalation is
          // edge-triggered (fires only on the firing that first crosses the
          // threshold), not level-triggered (which would re-report the same
          // fingerprint on every subsequent still-failing firing — attempts
          // only ever increments by 1 per real firing, so "previousAttempts
          // was already >= threshold" reliably means "already escalated").
          const before = queue.find((e) => e.fingerprint === r.fingerprint);
          const previousAttempts = before ? before.attempts : 0;
          queue = enqueueRetry(queue, { fingerprint: r.fingerprint, payload: r.payload, lastError: r.error });
          const entry = queue.find((e) => e.fingerprint === r.fingerprint);
          if (shouldEscalate(entry) && previousAttempts < ESCALATE_AFTER_ATTEMPTS) escalated.push(entry);
        }
      }
      return { ...current, retryQueue: queue };
    });
    if (!result.ok) {
      process.stderr.write(`retry-queue update: health-state persistence failed after retries: ${result.error}\n`);
      // The escalated list above was computed against the final (rejected)
      // mutator attempt's in-memory state, which never actually persisted —
      // printing it would tell the caller a 3rd-strike crossing happened
      // durably when it didn't. Print an empty result instead so the caller's
      // "non-empty output -> file a filing-failed issue" check doesn't act on
      // an escalation that was never actually saved to retry-queue.json.
      process.stdout.write('[]\n');
      // A genuinely failed durable write must not exit 0 — a calling
      // shell/Routine checking $? would otherwise see success and never
      // surface the failure, silently losing this firing's retry-count
      // increments (matching the resultsPath/JSON-parse failure branches
      // above, which both already exit non-zero).
      process.exitCode = 1;
      return;
    }
    process.stdout.write(JSON.stringify(escalated, null, 2) + '\n');
  }

  return { drain, update };
}

module.exports = { makeRetryQueueCommands };
