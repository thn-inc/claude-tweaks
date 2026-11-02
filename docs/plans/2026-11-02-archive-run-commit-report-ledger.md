# Open Items — archive-run: commits the archive move on the current branch without reporting the commit or that it is unpushed

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build/ops | Pre-flight divergence: origin/main was 20 commits ahead of this branch at run start (reason-not-auto: requires-human-judgment — held note from flow Step 2.5) | fixed | Caught up by the adopt-path merge of origin/main at 02f25d8c9 before any build task |
| 2 | review | hooks.js:1382 comment said archive-run stdout is never parsed by any caller, but tidy and release key on the `archived` success line | fixed | Comment now names the one parsed line; commit 9b11a42fa |
| 3 | review | tests/reconcile.test.js:702 one-spawn test pinned the exact `show` argv, coupling it to the command shape | fixed | Asserts one `show` spawn and no `rev-parse`/`log`; commit 9b11a42fa |
| 4 | review | archive-merged.js:278 archive commit subject literal written in two places (writer and own-commit check) | fixed | `archiveCommitSubject(runId)` shared by both; commit 9b11a42fa |
| 5 | review | tests/archive-run-verb.test.js:655 AC2.2 asserted only a negative, so a verb that printed nothing passed | fixed | Asserts the `archived` line too; commit 9b11a42fa |
| 6 | review | archive-merged.js:311 `archiveCommitLine`'s catch swallows a programming error as `push state unknown` | accepted | Intentional: Deliverable 2 requires the line never fail the verb, the degraded text is truthful, nothing branches on it, and tests/reconcile.test.js pins never-throw |
| 7 | review | sweep-stray-run-dirs.js:163 calls `archiveRunDir` and ignores the new `commit` field | accepted | Not a defect in this change: the script is the one-time #593 cleanup (its header says not steady-state), writes its own summary and log, and the plan classifies it no-change |
