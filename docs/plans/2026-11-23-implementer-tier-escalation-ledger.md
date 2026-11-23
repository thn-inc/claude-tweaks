# Open Items — Take the standard lane's implementer profile from the record rule and escalate once

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | dispatch.md's AC-forwarding and deferral-rulings reads pointed at {run-dir}/work/{n}-spec.md, absent in worktree mode (parked by Task 1's re-review as out-of-scope; final review ruled it fix-now) | fixed | Both reads now use {spec-file} — 83263b7cd5 |
| 2 | build/skill | skill-prose-conformance-tests (enrichment): a pin on a CLI call in prose must run through the argument, not stop at the flag — #5999's CLI_CALL ended at --spec-file, so reverting the argument to a broken path stayed green until review | observation | — |
