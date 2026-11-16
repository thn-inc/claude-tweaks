# Open Items — Delete the evals harness and its workflow

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build/ops | Decide whether to delete the ANTHROPIC_API_KEY Actions secret, which no workflow uses once eval-benchmark.yml is gone (reason-not-auto: requires-judgment — the maintainer may want the key for other planned workflows) | open | — |
| 2 | build | SDD ruling — the promoted SDK notes keep their three sections verbatim, as the spec requires, and one sentence in the opening paragraph explains their dangling "above" and Task / record #46 pointers (Task 1): ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build/ops | Sign off the CI/CD change: this branch deletes .github/workflows/eval-benchmark.yml (a workflow_dispatch-only job, last run in August) and changes no other workflow file; .github/workflows goes from 8 files to 7 (reason-not-auto: requires-signoff) | open | — |
