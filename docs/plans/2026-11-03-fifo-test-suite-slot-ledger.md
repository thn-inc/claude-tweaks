# Open Items — Make the test-suite slot in tools/run-tests.js FIFO so a queued run cannot starve

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | flow/ops | Pre-flight branch-divergence check: origin/main was 20 commits ahead of the branch at run start | fixed | Post-creation catch-up merged origin/main into the branch at 284438123 |
| 2 | build | withWaiters (tests/run-tests-isolation.test.js) listens only to the child 'exit' event; a spawn 'error' (practically unreachable with process.execPath) would wait out the 10 s cleanup bound instead of failing fast — test-diagnostics only, no product behaviour | observation | Carried from the SDD final fix wave's scoped re-review (out-of-scope observation) |
| 3 | review/3f | Unparseable tickets were untested (a fresh one blocks every slot index; an old one is reaped), and the JSON-null rejoin test passed with the blocking rule removed | fixed | Added two unparseable-ticket tests and made the null test discriminating; mutants skipping unknown holders and skipping the reap each fail them |
| 4 | review/3f | The rejoin test had no newcomer ticket, so a rejoin at the old number passed | fixed | The test now adds a live newcomer ticket and expects the rejoin at the tail; a mutant reusing the old number fails it |
| 5 | review/3f | One test called acquireSlot with the default no-op sleep, so a regression there would hang instead of fail | fixed | It passes noSleep like its neighbours |
| 6 | review/3a | Two tests wrote ticket JSON inline instead of through writeTicket | fixed | Both use writeTicket |
| 7 | review/3a | ticketIsOurs repeated releaseSlot's read-parse-pid check | fixed | Renamed namesPid; releaseSlot calls it |
| 8 | review/3b | A hand-planted ticket-<2^53 or more>.json makes takeTicket spin with no sleep | accepted | Only the same user can plant it (ensureOwnDir checks ownership) and the same user could already block the queue with a live-pid ticket; not worth a bound |
| 9 | review/3a | ticketsAhead reaps with a bare unlink (no mutex); the two documented races live only in a comment; the acquireSlot comment is long | accepted | Accepted residual risk stated in the comment on purpose; neither race can starve a waiter; the comment's race 1 wording was corrected |
| 10 | review/3f | The real-process arrival-order test fails on the reverted runner about 98 percent of the time, not always | accepted | Stated in the test's own comment; the unit test AC2.1 pins the rule without timing |
| 11 | review/3f | The pre-existing write-failure test now fails at the ticket write, so its title understates what it covers | accepted | The slot-lock write failure is covered by the new #4333 test; only the title is stale |
