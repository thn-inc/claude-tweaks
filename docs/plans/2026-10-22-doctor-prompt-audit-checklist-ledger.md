# Open Items — Add a /doctor prompt-audit run over plugin/ to the model-version prompting checklist

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — implementer ran focused checks (plan greps + the 4 suites that load docs/skill-authoring.md) instead of the full suite before committing; Common Step 5 runs the full suite: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | Prompt-audit paragraph is one dense 12-line block and pins Claude Code 2.1.305 (task reviewer judged both acceptable; no change) | deferred | origin: SDD Task 1 review minor; files: docs/skill-authoring.md; trigger: revisit at the next model-version checklist run |
| 3 | review | Docs (low): the prompt-audit paragraph cited "the same three-bucket comparison #3056 used" without naming the buckets; nothing in the repo defines them (#3056's comparison lived in a record comment) | fixed | AUTO — buckets named inline in docs/skill-authoring.md; commit d1d76cdc1 |
